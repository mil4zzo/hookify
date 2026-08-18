-- Migration 109: dropa fetch_ad_metrics_for_analytics (codigo morto)
--
-- A funcao nao tem caller: o unico era o helper Python _fetch_ad_metrics_via_rpc,
-- que por sua vez nao era chamado por ninguem. Ambos saem juntos — o helper nesta
-- mesma mudanca, em backend/app/routes/analytics.py.
--
-- Ela e a mesma funcao da migration 106, onde recebeu o guard de auth.uid() que
-- faltava e teve o EXECUTE revogado de anon/authenticated. Aquele commit fechou o
-- vazamento; este remove a superficie. A ordem foi deliberada: correcao de
-- seguranca primeiro, minima e visivel no log; remocao depois, como limpeza.
--
-- NAO dropa as bases antigas do Manager (core_v2_base_v093 e _v104). Elas sao o
-- caminho de rollback de uma mudanca aplicada nesta mesma rodada, e trocar o
-- wrapper de volta e uma linha. Dropar rollback recem-criado seria trocar risco
-- por arrumacao. Ficam para uma limpeza futura, quando a v105 tiver rodado em
-- producao.

BEGIN;

DROP FUNCTION IF EXISTS public.fetch_ad_metrics_for_analytics(
  uuid, date, date, uuid[], text[]
);

DO $post$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace
             AND proname='fetch_ad_metrics_for_analytics') THEN
    RAISE EXCEPTION 'ABORTADO: a funcao ainda existe apos o drop.';
  END IF;

  -- As RPCs vivas do read-path seguem de pe.
  IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace
      AND proname IN ('fetch_manager_rankings_core_v2',
                      'fetch_manager_rankings_series_v2',
                      'fetch_manager_rankings_retention_v2',
                      'resolve_pack_access',
                      'resolve_pack_mql_leadscore_min')) <> 5 THEN
    RAISE EXCEPTION 'ABORTADO: alguma RPC viva do read-path desapareceu.';
  END IF;
END
$post$;

COMMIT;
