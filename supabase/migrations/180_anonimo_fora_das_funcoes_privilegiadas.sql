-- ===========================================================================
-- 180 — Anônimo fora das funções privilegiadas
--
-- O furo (medido em produção em 2026-10-14): o Supabase concede EXECUTE
-- EXPLÍCITO a `anon` em toda função nova de `public` (default privileges do
-- `postgres` IN SCHEMA public). O PostgREST expõe essas funções em
-- /rest/v1/rpc/<nome>, e a chave publicável vai embutida no site. Resultado:
-- 10 funções SECURITY DEFINER executáveis por quem não está logado.
--
-- A grave: `clear_ad_metrics_enrichment` (apaga leadscore e colunas vinculadas
-- de um pack) trava com `auth.uid() IS NOT NULL AND auth.uid() <> p_user_id` —
-- para o anônimo `auth.uid()` é NULL e a trava PASSA. Conhecendo o id do dono e
-- do pack (o convidado de um pack compartilhado conhece os dois), dava para
-- apagar o leadscore sem login. E o arquivo da planilha é trocado a cada
-- lançamento: o leadscore de lançamento antigo NÃO volta num novo sync.
-- Prova antes da 180: POST /rpc/clear_ad_metrics_enrichment só com a apikey,
-- p_dry_run=true e ids inventados → HTTP 200.
--
-- As leituras do Manager NÃO estavam abertas: `fetch_manager_rankings_core_v2`
-- não tem trava própria, mas delega para `fetch_manager_performance_base_v155`,
-- que trava com `is distinct from` (NULL não passa).
--
-- O que muda:
--   1. `anon` perde EXECUTE em TODA função SECURITY DEFINER de `public` (laço
--      genérico, não lista: lista envelhece). O frontend nunca chama `.rpc()`;
--      o backend chama com o JWT do usuário (`authenticated`) ou `service_role`.
--   2. `authenticated` perde EXECUTE nos auxiliares internos — só funções
--      SECURITY DEFINER os chamam (rodam como `postgres`), nenhum caminho do app:
--        ad_metrics_enrichment_targets  ← clear_ad_metrics_enrichment
--        ad_performance_rollup_apply    ← gatilhos sync_ins / sync_upd
--        ad_performance_rollup_rebuild  ← manutenção manual
--      Sem trava de dono, o logado lia ids/datas de pack alheio (targets) ou
--      forçava recálculo pesado (apply/rebuild).
--   3. Função NOVA de `public` deixa de nascer executável por `anon`
--      (default privilege por schema: aqui é o PRÓPRIO grant do Supabase que se
--      revoga, então o revoke por schema funciona — diferente do PUBLIC, que é
--      built-in e só sai pelo default global).
--
-- Gatilhos (rollup_sync_ins/upd) não dependem de EXECUTE do papel que escreve:
-- o Postgres só confere EXECUTE da função de gatilho no CREATE TRIGGER.
-- As travas `IS NOT NULL AND` ficam como estão: sem o anônimo, o único papel
-- com uid NULL que chega pelo PostgREST é o `service_role`, que deve passar.
-- ===========================================================================
BEGIN;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS fn
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon, PUBLIC', r.fn);
  END LOOP;
END $$;

REVOKE EXECUTE ON FUNCTION public.ad_metrics_enrichment_targets(uuid, uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.ad_performance_rollup_apply(public.ad_metric_key[]) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.ad_performance_rollup_rebuild(uuid) FROM authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;

-- Prova (inventário POSITIVO, por papel): aborta a migration se sobrar algo.
DO $$
DECLARE
  v_open text;
BEGIN
  SELECT string_agg(p.oid::regprocedure::text, ', ')
  INTO v_open
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prosecdef
    AND has_function_privilege('anon', p.oid, 'EXECUTE');
  IF v_open IS NOT NULL THEN
    RAISE EXCEPTION '180: anon ainda executa: %', v_open;
  END IF;

  IF has_function_privilege('authenticated', 'public.ad_metrics_enrichment_targets(uuid, uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.ad_performance_rollup_apply(public.ad_metric_key[])', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.ad_performance_rollup_rebuild(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '180: authenticated ainda executa um auxiliar interno';
  END IF;

  -- O que o app usa continua de pé.
  IF NOT has_function_privilege('authenticated', 'public.clear_ad_metrics_enrichment(uuid, uuid, boolean)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.ad_performance_rollup_rebuild(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '180: revogou demais';
  END IF;
END $$;

-- Função nova nasce fechada para anon (e segue aberta para authenticated).
CREATE FUNCTION public._prova_180() RETURNS int LANGUAGE sql AS 'select 1';
DO $$
BEGIN
  IF has_function_privilege('anon', 'public._prova_180()', 'EXECUTE') THEN
    RAISE EXCEPTION '180: função nova ainda nasce executável por anon';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public._prova_180()', 'EXECUTE') THEN
    RAISE EXCEPTION '180: função nova deixou de nascer executável por authenticated';
  END IF;
END $$;
DROP FUNCTION public._prova_180();

COMMIT;
