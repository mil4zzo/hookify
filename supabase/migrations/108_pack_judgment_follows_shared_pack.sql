-- Migration 108: criterio de julgamento acompanha o pack compartilhado
--
-- BUG NA COSTURA P2 <-> P3 (encontrado ao concluir a P3.2)
--   resolve_pack_mql_leadscore_min filtrava `p.user_id = p_user_id`. Num pack
--   COMPARTILHADO, packs.user_id e o DONO, nao o ator — entao o convidado nunca
--   encontrava o pack e caia no proprio default.
--
--   Verificado: pack com override 40, dono com default 80, convidado com default
--   80. O dono via 40; o convidado via 80. Ou seja, os dois julgavam o MESMO pack
--   por criterios diferentes — exatamente o que a P2 existia para impedir, e a
--   razao declarada de ela ser pre-requisito da P3.
--
-- REGRA CORRIGIDA (por pack)
--   valor efetivo = override do pack  ??  default do DONO do pack
--
--   O default passa a ser o do dono, nao o do ator. Sem isso, dois membros olhando
--   um pack compartilhado SEM override continuariam divergindo — o furo so mudaria
--   de lugar. O pack e a linguagem comum do time; quem o compartilha define a
--   regra de leitura dele.
--
--   Com varios packs selecionados a regra de conflito da P2 nao muda: todos
--   concordam -> esse valor; divergem -> default do ATOR (terreno neutro), e a UI
--   avisa a divergencia.
--
-- Acesso agora vem de resolve_pack_access (P3.1), que ja resolve proprio + grant.
-- Pack inacessivel simplesmente nao entra na conta — nao ha como sondar pack
-- alheio por este caminho.

BEGIN;

CREATE OR REPLACE FUNCTION public.resolve_pack_mql_leadscore_min(
  p_user_id uuid,
  p_pack_ids uuid[] DEFAULT NULL::uuid[]
) RETURNS numeric
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
AS $fn$
declare
  v_actor_default numeric;
  v_distinct_count integer := 0;
  v_value numeric;
begin
  select coalesce(up.mql_leadscore_min, 0)
    into v_actor_default
  from public.user_preferences up
  where up.user_id = p_user_id
  limit 1;

  v_actor_default := greatest(coalesce(v_actor_default, 0), 0);

  if p_pack_ids is null or array_length(p_pack_ids, 1) is null then
    return v_actor_default;
  end if;

  -- Um valor efetivo por pack ACESSIVEL: override do pack, senao o default do
  -- DONO daquele pack. Pack sem acesso nao aparece em resolve_pack_access.
  select count(*), min(s.v)
    into v_distinct_count, v_value
  from (
    select distinct greatest(
             coalesce(
               p.mql_leadscore_min,
               (select coalesce(owner_prefs.mql_leadscore_min, 0)
                  from public.user_preferences owner_prefs
                 where owner_prefs.user_id = a.owner_id),
               0
             ), 0) as v
    from public.resolve_pack_access(p_pack_ids, p_user_id) a
    join public.packs p on p.id = a.pack_id
  ) s;

  if v_distinct_count = 1 then
    return greatest(coalesce(v_value, v_actor_default), 0);
  end if;

  -- 0 packs acessiveis, ou divergencia: terreno neutro e o default do ator.
  return v_actor_default;
end;
$fn$;

COMMENT ON FUNCTION public.resolve_pack_mql_leadscore_min(uuid, uuid[]) IS
  'Leadscore minimo de MQL efetivo para um conjunto de packs. Por pack: override do pack, senao o default do DONO do pack (o criterio acompanha o pack compartilhado). Packs divergentes caem no default do ator. Acesso via resolve_pack_access. Helper interno — nao exposto ao PostgREST.';

REVOKE ALL ON FUNCTION public.resolve_pack_mql_leadscore_min(uuid, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_pack_mql_leadscore_min(uuid, uuid[]) FROM anon;
REVOKE ALL ON FUNCTION public.resolve_pack_mql_leadscore_min(uuid, uuid[]) FROM authenticated;

COMMIT;
