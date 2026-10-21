-- Rollback da 180. Devolve EXECUTE a anon nas funções SECURITY DEFINER de
-- public e aos auxiliares internos para authenticated, e o default privilege do
-- Supabase. REABRE o furo descrito na 180 — só para destravar algo que ela
-- tenha quebrado, nunca como estado final.
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
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon', r.fn);
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION public.ad_metrics_enrichment_targets(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ad_performance_rollup_apply(public.ad_metric_key[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ad_performance_rollup_rebuild(uuid) TO authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon;

COMMIT;
