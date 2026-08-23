-- Migration 114: pack_action_log — o rastro do ATOR (P3.5)
--
-- POR QUE ESTA TABELA EXISTE
--   Num pack compartilhado a credencial e SEMPRE do dono (decisao travada de
--   2026-08-17). Quando o convidado pausa um anuncio, quem aparece no log do
--   Gerenciador de Anuncios da Meta e o DONO — a Meta nao tem como saber que
--   houve um segundo humano. Este banco e o unico lugar do mundo que sabe.
--
--   Por isso o registro nao e "nice to have": e o UNICO rastro possivel de
--   autoria em toda a superficie compartilhada.
--
-- FORMA
--   pack_ids ARRAY, nao pack_id escalar: uma escrita e autorizada pelo CONTEXTO
--   de packs que o cliente enviou, e a mesma entidade costuma viver em mais de
--   um pack do mesmo dono. Guardar um so exigiria escolher arbitrariamente qual.
--   Mesmo padrao (e mesmo operador de leitura, &&) de public.ads.pack_ids.
--
--   SEM foreign key para packs. Deliberado: "quem apagou o pack" e exatamente
--   uma das perguntas que o log existe para responder, e um ON DELETE CASCADE
--   apagaria a resposta junto com a pergunta. O preco e linha orfa, que a
--   retencao de 365 dias recolhe.
--
--   Um bulk de 500 anuncios e UMA linha (target_ids + target_count), nao 500:
--   quem le quer "Fulano pausou 500 anuncios as 14h", nao 500 entradas iguais.
--
-- ACESSO
--   RLS ligada e NENHUMA policy: PostgREST nao le nem escreve. O acesso passa
--   pelo backend, que ja e o guarda do compartilhamento (assert_pack_role).
--   Coerente com a disciplina da P3.6 — a autorizacao mora na aplicacao porque
--   o compartilhamento quebra `user_id = auth.uid()` por definicao.
--
-- RETENCAO
--   365 dias (decisao travada de 2026-08-17). O mecanismo e a funcao
--   purge_pack_action_log(); o pg_cron so a dispara. Se o agendamento falhar, a
--   funcao continua chamavel — a retencao nao fica presa a uma extensao.
--   Nada sera apagado antes de 2027-08: o mecanismo existe agora para nao ser
--   lembrado tarde demais.

BEGIN;

CREATE TABLE IF NOT EXISTS public.pack_action_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   timestamptz NOT NULL DEFAULT now(),

  pack_ids     uuid[]      NOT NULL,           -- packs que autorizaram/contextualizaram
  pack_name    text,                           -- snapshot: o pack pode ser renomeado ou apagado
  owner_id     uuid        NOT NULL,           -- silo onde a acao teve efeito
  actor_id     uuid        NOT NULL,           -- QUEM fez (o dado que so existe aqui)
  actor_role   text        NOT NULL,           -- papel no momento da acao

  action       text        NOT NULL,           -- verbo canonico: 'ad.status', 'pack.rename', ...
  target_type  text,                           -- 'ad' | 'adset' | 'campaign' | 'pack' | 'share' | 'integration'
  target_ids   text[]      NOT NULL DEFAULT '{}',
  target_count integer     NOT NULL DEFAULT 0, -- pode ser > array_length quando a lista e truncada
  detail       jsonb,                          -- {"to":"PAUSED"} | {"daily_budget":{"from":5000,"to":8000}}

  status       text        NOT NULL DEFAULT 'ok',
  error        text,                           -- mensagem curta quando status <> 'ok'
  route        text,                           -- rota HTTP de origem (mesmo espirito de meta_api_usage)

  CONSTRAINT pack_action_log_status_chk
    CHECK (status IN ('ok', 'error', 'partial')),
  CONSTRAINT pack_action_log_role_chk
    CHECK (actor_role IN ('dono', 'editor', 'viewer')),
  CONSTRAINT pack_action_log_packs_chk
    CHECK (array_length(pack_ids, 1) >= 1)
);

COMMENT ON TABLE public.pack_action_log IS
  'P3.5 — quem fez o que num pack. Unico rastro de autoria em pack compartilhado: '
  'na Meta a acao do convidado aparece como sendo do dono. Retencao 365 dias.';

-- Leitura quente: "as N acoes mais recentes DESTE pack".
CREATE INDEX IF NOT EXISTS pack_action_log_pack_ids_idx
  ON public.pack_action_log USING gin (pack_ids);

-- Ordenacao/paginacao do feed e varredura da retencao.
CREATE INDEX IF NOT EXISTS pack_action_log_created_at_idx
  ON public.pack_action_log (created_at DESC);

-- "O que o Fulano andou fazendo" — filtro por pessoa dentro do feed.
CREATE INDEX IF NOT EXISTS pack_action_log_actor_created_idx
  ON public.pack_action_log (actor_id, created_at DESC);

ALTER TABLE public.pack_action_log ENABLE ROW LEVEL SECURITY;
-- Sem policy de proposito: so o service role (backend) enxerga.
REVOKE ALL ON public.pack_action_log FROM anon, authenticated;


-- ── Retencao ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.purge_pack_action_log()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  deleted integer;
BEGIN
  DELETE FROM public.pack_action_log
   WHERE created_at < now() - interval '365 days';
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END;
$fn$;

COMMENT ON FUNCTION public.purge_pack_action_log() IS
  'Retencao de 365 dias do pack_action_log (decisao travada 2026-08-17). '
  'Agendada por pg_cron; chamavel manualmente se o agendamento nao existir.';

REVOKE ALL ON FUNCTION public.purge_pack_action_log() FROM anon, authenticated;

COMMIT;

-- ── Agendamento (fora da transacao: CREATE EXTENSION nao volta atras) ───────
-- Aplicado em 2026-08-22 no projeto yyhiwayyvawsdsptdklx (jobid 1). Roda 04:23
-- UTC. Se falhar num ambiente sem pg_cron, a tabela e a funcao continuam de pe
-- e a retencao passa a ser uma chamada manual — degrada, nao quebra.
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-pack-action-log') THEN
    PERFORM cron.schedule(
      'purge-pack-action-log',
      '23 4 * * *',
      'SELECT public.purge_pack_action_log()'
    );
  END IF;
END
$do$;
