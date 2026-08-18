-- 102: remove a cadeia MORTA de fetch_manager_analytics_aggregated.
--
-- CONTEXTO
--   Diferente da 095 (que tinha um wrapper vivo e um morto), aqui a cadeia INTEIRA
--   e orfa: nao existe caller vivo em lugar nenhum.
--
--     fetch_manager_analytics_aggregated        -> _base_v049   (entrada, sem caller)
--     fetch_manager_analytics_aggregated_base_v049                (so chamada pela entrada)
--     fetch_manager_analytics_aggregated_base_v048                (orfa)
--     fetch_manager_analytics_aggregated_base_v047                (orfa)
--
--   O backend chama exatamente 5 RPCs (varredura de `.rpc("` em backend/app):
--     fetch_ad_metrics_for_analytics, fetch_manager_rankings_core_v2,
--     fetch_manager_rankings_series_v2, fetch_manager_rankings_retention_v2,
--     get_admin_users_list
--   O frontend nao chama RPC alguma diretamente (zero ocorrencias de `.rpc(`).
--
--   Motivador: as tres bases ainda liam `user_preferences.mql_leadscore_min` direto,
--   ou seja, carregavam a regra de MQL ANTERIOR a 101 (heranca por pack). Codigo morto
--   com regra desatualizada e pior que codigo morto neutro — some antes que alguem
--   ressuscite por engano.
--
-- GRAFO VERIFICADO ANTES DO DROP
--   - Nenhuma outra funcao de `public` cita o nome no corpo (varredura em pg_proc.prosrc)
--   - Nenhuma view/matview referencia (varredura em pg_get_viewdef)
--   - Exatamente 1 overload por nome (sem ambiguidade de assinatura)
--
-- NOTA (mesma da 095): corpo de plpgsql NAO e rastreado como dependencia pelo Postgres —
-- a resolucao e por nome, em runtime. O DROP nao protege contra referencia viva, entao a
-- checagem abaixo e a unica rede. Refeita aqui como guarda de execucao.

BEGIN;

-- ---------------------------------------------------------------------------
-- Guarda 1: ninguem mais no banco cita essas funcoes
-- ---------------------------------------------------------------------------
DO $guard$
DECLARE
  v_callers text;
  v_views text;
BEGIN
  SELECT string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', ', ')
    INTO v_callers
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname NOT LIKE 'fetch_manager_analytics_aggregated%'
    AND p.prosrc LIKE '%fetch_manager_analytics_aggregated%';

  IF v_callers IS NOT NULL THEN
    RAISE EXCEPTION
      'ABORTADO: funcoes ainda referenciam fetch_manager_analytics_aggregated: %', v_callers;
  END IF;

  SELECT string_agg(c.relname, ', ')
    INTO v_views
  FROM pg_class c
  WHERE c.relnamespace = 'public'::regnamespace
    AND c.relkind IN ('v', 'm')
    AND pg_get_viewdef(c.oid) LIKE '%fetch_manager_analytics_aggregated%';

  IF v_views IS NOT NULL THEN
    RAISE EXCEPTION
      'ABORTADO: views ainda referenciam fetch_manager_analytics_aggregated: %', v_views;
  END IF;
END
$guard$;

-- ---------------------------------------------------------------------------
-- Guarda 2: a cadeia e exatamente a esperada (4 funcoes, 1 overload cada)
-- ---------------------------------------------------------------------------
DO $guard$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM pg_proc
  WHERE pronamespace = 'public'::regnamespace
    AND proname LIKE 'fetch_manager_analytics_aggregated%';

  IF v_count <> 4 THEN
    RAISE EXCEPTION
      'ABORTADO: esperava 4 funcoes na cadeia (entrada + 3 bases), encontrei %. Retracear antes de dropar.',
      v_count;
  END IF;
END
$guard$;

-- ---------------------------------------------------------------------------
-- Drops — caller antes de callee (irrelevante para plpgsql, mas mantem a leitura honesta)
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.fetch_manager_analytics_aggregated(
  uuid, date, date, text, uuid[], text[], text, text, text, boolean, boolean, integer, integer, text
);

DROP FUNCTION IF EXISTS public.fetch_manager_analytics_aggregated_base_v049(
  uuid, date, date, text, uuid[], text[], text, text, text, boolean, boolean, integer, integer, text
);

DROP FUNCTION IF EXISTS public.fetch_manager_analytics_aggregated_base_v048(
  uuid, date, date, text, uuid[], text[], text, text, text, boolean, boolean, integer, integer, text
);

DROP FUNCTION IF EXISTS public.fetch_manager_analytics_aggregated_base_v047(
  uuid, date, date, text, uuid[], text[], text, text, text, boolean, boolean, integer, integer, text
);

-- ---------------------------------------------------------------------------
-- Pos-condicao: a cadeia sumiu por completo, e as RPCs vivas seguem de pe
-- ---------------------------------------------------------------------------
DO $post$
DECLARE
  v_remaining integer;
  v_alive integer;
BEGIN
  SELECT count(*) INTO v_remaining
  FROM pg_proc
  WHERE pronamespace = 'public'::regnamespace
    AND proname LIKE 'fetch_manager_analytics_aggregated%';

  IF v_remaining <> 0 THEN
    RAISE EXCEPTION 'ABORTADO: sobraram % funcoes da cadeia apos os drops.', v_remaining;
  END IF;

  SELECT count(*) INTO v_alive
  FROM pg_proc
  WHERE pronamespace = 'public'::regnamespace
    AND proname IN (
      'fetch_ad_metrics_for_analytics',
      'fetch_manager_rankings_core_v2',
      'fetch_manager_rankings_core_v2_base_v093',
      'fetch_manager_rankings_series_v2',
      'fetch_manager_rankings_retention_v2',
      'resolve_pack_mql_leadscore_min'
    );

  IF v_alive <> 6 THEN
    RAISE EXCEPTION
      'ABORTADO: esperava 6 funcoes vivas do read-path, encontrei %. Algo alem da cadeia morta foi afetado.',
      v_alive;
  END IF;
END
$post$;

COMMIT;
