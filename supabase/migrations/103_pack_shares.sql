-- Migration 103: compartilhamento de packs entre usuarios (P3.1)
--
-- Modelo de dados + primitivas de autorizacao. NAO altera nenhum read-path:
-- nesta fase o pack compartilhado ainda NAO aparece para o convidado. Expor
-- antes da P3.2 (guard das RPCs derivando o dono) mostraria um pack cujo
-- analytics responderia Forbidden.
--
-- PRINCIPIO: o dado nao e copiado. Ele continua no silo do dono (todas as
-- tabelas ja sao particionadas por user_id) e o convidado le de la.
--
-- O DONO NAO E UMA LINHA AQUI. A propriedade vem de packs.user_id; pack_shares
-- guarda apenas os acessos CONCEDIDOS. Por isso role so aceita editor|viewer:
-- gravar o dono como linha abriria a porta para os dois discordarem.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Tabela de grants
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.pack_shares (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_id     uuid NOT NULL,
  -- Denormalizado a partir de packs.user_id. Preenchido SEMPRE pelo servidor,
  -- nunca pelo cliente. Existe para a RLS nao precisar de subquery em packs.
  owner_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  grantee_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role        text NOT NULL DEFAULT 'editor',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pack_shares_role_check CHECK (role IN ('editor', 'viewer')),
  -- Compartilhar consigo mesmo criaria um pack com dois caminhos de acesso
  -- divergentes (dono + grant), e o resolvedor teria que desempatar.
  CONSTRAINT pack_shares_not_self CHECK (owner_id <> grantee_id),
  -- Um convidado tem no maximo UM papel por pack.
  CONSTRAINT pack_shares_unique_grant UNIQUE (pack_id, grantee_id)
);

COMMENT ON TABLE public.pack_shares IS
  'Acessos concedidos a packs. O dono NAO aparece aqui (vem de packs.user_id); esta tabela guarda so os convidados. ON DELETE CASCADE em pack_id implementa "dono apaga o pack -> some para todos".';
COMMENT ON COLUMN public.pack_shares.owner_id IS
  'Denormalizado de packs.user_id, preenchido pelo servidor. Nunca aceitar do cliente.';
COMMENT ON COLUMN public.pack_shares.role IS
  'editor = le e escreve (refresh, pausar, budget). viewer = somente leitura. O papel "dono" nao e representado aqui.';

-- ---------------------------------------------------------------------------
-- 1b. A PROPRIEDADE E GARANTIDA PELO ARMAZENAMENTO, NAO PELA POLICY
-- ---------------------------------------------------------------------------
--
-- Sem isto ha escalonamento de privilegio, verificado empiricamente: a policy de
-- INSERT so consegue exigir `owner_id = auth.uid()`, o que prova que o autor
-- DIZ ser dono — nao que ele E. Qualquer usuario autenticado podia conceder
-- acesso a qualquer pack cujo id conhecesse, declarando-se dono, e o resolvedor
-- honrava o grant forjado.
--
-- A FK COMPOSTA (pack_id, owner_id) -> packs(id, user_id) torna o forjamento
-- impossivel na camada de armazenamento: o par so existe se o pack for mesmo
-- daquele dono. Substitui a FK simples de pack_id (o CASCADE vem junto).
-- O UNIQUE em packs(id, user_id) e redundante para unicidade (id ja e PK), mas
-- e obrigatorio como alvo de FK composta.

DO $mig$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'packs_id_user_id_key') THEN
    ALTER TABLE public.packs ADD CONSTRAINT packs_id_user_id_key UNIQUE (id, user_id);
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pack_shares_pack_id_fkey') THEN
    ALTER TABLE public.pack_shares DROP CONSTRAINT pack_shares_pack_id_fkey;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pack_shares_pack_owner_fkey') THEN
    ALTER TABLE public.pack_shares
      ADD CONSTRAINT pack_shares_pack_owner_fkey
      FOREIGN KEY (pack_id, owner_id)
      REFERENCES public.packs (id, user_id) ON DELETE CASCADE;
  END IF;
END
$mig$;

CREATE INDEX IF NOT EXISTS pack_shares_grantee_idx ON public.pack_shares (grantee_id);
CREATE INDEX IF NOT EXISTS pack_shares_owner_idx   ON public.pack_shares (owner_id);
CREATE INDEX IF NOT EXISTS pack_shares_pack_idx    ON public.pack_shares (pack_id);

-- Reforco idempotente das constraints (a tabela pode ja existir de uma execucao anterior).
DO $mig$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pack_shares_not_self') THEN
    ALTER TABLE public.pack_shares ADD CONSTRAINT pack_shares_not_self CHECK (owner_id <> grantee_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pack_shares_role_check') THEN
    ALTER TABLE public.pack_shares ADD CONSTRAINT pack_shares_role_check CHECK (role IN ('editor', 'viewer'));
  END IF;
END
$mig$;

DROP TRIGGER IF EXISTS set_pack_shares_updated_at ON public.pack_shares;
CREATE TRIGGER set_pack_shares_updated_at
  BEFORE UPDATE ON public.pack_shares
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.pack_shares ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pack_shares_owner_all      ON public.pack_shares;
DROP POLICY IF EXISTS pack_shares_grantee_select ON public.pack_shares;
DROP POLICY IF EXISTS pack_shares_grantee_leave  ON public.pack_shares;

-- Dono: controle total sobre os grants dos SEUS packs.
CREATE POLICY pack_shares_owner_all ON public.pack_shares
  USING      (owner_id = (SELECT auth.uid()))
  WITH CHECK (owner_id = (SELECT auth.uid()));

-- Convidado: enxerga o proprio grant (precisa saber a que tem acesso)...
CREATE POLICY pack_shares_grantee_select ON public.pack_shares
  FOR SELECT USING (grantee_id = (SELECT auth.uid()));

-- ...e pode sair do pack sem depender do dono. Nao pode alterar o proprio papel:
-- so ha politica de DELETE, nao de UPDATE.
CREATE POLICY pack_shares_grantee_leave ON public.pack_shares
  FOR DELETE USING (grantee_id = (SELECT auth.uid()));

-- ---------------------------------------------------------------------------
-- 3. Resolvedor de acesso — primitiva que a P3.2 vai plugar nas RPCs
-- ---------------------------------------------------------------------------
--
-- Devolve UMA LINHA POR PACK ACESSIVEL. Pack sem acesso simplesmente nao volta,
-- entao o chamador compara a contagem: se vier menos do que pediu, algum pack e
-- inacessivel -> Forbidden. Esse contrato evita vazar a existencia de um pack
-- alheio (nao ha diferenca observavel entre "nao existe" e "nao e seu").

CREATE OR REPLACE FUNCTION public.resolve_pack_access(
  p_pack_ids uuid[],
  p_actor_id uuid DEFAULT NULL::uuid
) RETURNS TABLE (pack_id uuid, owner_id uuid, role text)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
AS $fn$
  select
    p.id                                   as pack_id,
    p.user_id                              as owner_id,
    case when p.user_id = coalesce(p_actor_id, auth.uid())
         then 'dono'
         else s.role
    end                                    as role
  from public.packs p
  left join public.pack_shares s
    on s.pack_id = p.id
   and s.grantee_id = coalesce(p_actor_id, auth.uid())
    -- Redundante com a FK composta, de proposito: se alguem dropar a constraint,
    -- o resolvedor ainda recusa grant cujo owner_id nao seja o dono real.
   and s.owner_id = p.user_id
  where p_pack_ids is not null
    and p.id = any(p_pack_ids)
    and (
      p.user_id = coalesce(p_actor_id, auth.uid())
      or s.id is not null
    );
$fn$;

COMMENT ON FUNCTION public.resolve_pack_access(uuid[], uuid) IS
  'Packs acessiveis pelo ator entre os pedidos, com dono e papel (dono|editor|viewer). Pack inacessivel nao retorna — o chamador compara a contagem. Helper interno, nao exposto ao PostgREST.';

REVOKE ALL ON FUNCTION public.resolve_pack_access(uuid[], uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_pack_access(uuid[], uuid) FROM anon;
REVOKE ALL ON FUNCTION public.resolve_pack_access(uuid[], uuid) FROM authenticated;

-- ---------------------------------------------------------------------------
-- 4. Busca de convidado por e-mail EXATO
-- ---------------------------------------------------------------------------
--
-- Match exato de proposito: busca parcial transformaria o app num coletor de
-- e-mails cadastrados. Com match exato so se confirma um endereco ja conhecido
-- por inteiro — mesmo compromisso que Slack/Notion/Linear adotam.
--
-- Devolve o minimo: id e nome de exibicao. Nunca tier, conta Meta ou qualquer
-- outro dado da conta.

CREATE OR REPLACE FUNCTION public.lookup_user_by_email(p_email text)
RETURNS TABLE (user_id uuid, display_name text)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
AS $fn$
  select
    u.id,
    coalesce(nullif(trim(u.raw_user_meta_data->>'name'), ''), split_part(u.email, '@', 1))
  from auth.users u
  where lower(u.email) = lower(trim(p_email))
    and nullif(trim(p_email), '') is not null
  limit 1;
$fn$;

COMMENT ON FUNCTION public.lookup_user_by_email(text) IS
  'Resolve e-mail EXATO -> (user_id, nome de exibicao) para o convite de pack. Match exato e payload minimo evitam enumeracao de cadastro. Helper interno: o backend chama com service role, para o rate limit do middleware valer.';

REVOKE ALL ON FUNCTION public.lookup_user_by_email(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lookup_user_by_email(text) FROM anon;
REVOKE ALL ON FUNCTION public.lookup_user_by_email(text) FROM authenticated;

-- ---------------------------------------------------------------------------
-- 5. Nomes de exibicao para a lista de membros
-- ---------------------------------------------------------------------------
--
-- Lote por ids ja conhecidos — nao e busca. Quem chama ja provou ser dono do
-- pack e ja tem os grantee_id em maos; isto so troca id por nome. Mesmo payload
-- minimo do lookup por e-mail: nunca tier, conta Meta ou e-mail.

CREATE OR REPLACE FUNCTION public.lookup_users_by_ids(p_user_ids uuid[])
RETURNS TABLE (user_id uuid, display_name text)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
AS $fn$
  select
    u.id,
    coalesce(nullif(trim(u.raw_user_meta_data->>'name'), ''), split_part(u.email, '@', 1))
  from auth.users u
  where p_user_ids is not null
    and u.id = any(p_user_ids);
$fn$;

COMMENT ON FUNCTION public.lookup_users_by_ids(uuid[]) IS
  'Troca ids conhecidos por nomes de exibicao na lista de membros de um pack. Nao e busca: o chamador ja tem os ids. Helper interno, chamado pelo backend com service role.';

REVOKE ALL ON FUNCTION public.lookup_users_by_ids(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lookup_users_by_ids(uuid[]) FROM anon;
REVOKE ALL ON FUNCTION public.lookup_users_by_ids(uuid[]) FROM authenticated;

COMMIT;
