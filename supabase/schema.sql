--
-- PostgreSQL database dump
--

\restrict 8sGWEXHQpg1DQpanF9Dwl4gc6jm1rRXDu9pRUPC3piNtF8ZJV2ezbMBj5wg5e5x

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: pg_database_owner
--

CREATE SCHEMA public;


ALTER SCHEMA public OWNER TO pg_database_owner;

--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: pg_database_owner
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: batch_add_pack_id_to_arrays(uuid, uuid, text, text[]); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.batch_add_pack_id_to_arrays(p_user_id uuid, p_pack_id uuid, p_table_name text, p_ids_to_update text[]) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  updated_count int := 0;
BEGIN
  IF p_table_name NOT IN ('ads', 'ad_metrics') THEN
    RAISE EXCEPTION 'Tabela inválida: %. Use "ads" ou "ad_metrics"', p_table_name;
  END IF;

  IF p_table_name = 'ads' THEN
    UPDATE public.ads
    SET
      pack_ids = CASE
        WHEN p_pack_id = ANY(COALESCE(pack_ids, ARRAY[]::uuid[])) THEN COALESCE(pack_ids, ARRAY[]::uuid[])
        ELSE array_append(COALESCE(pack_ids, ARRAY[]::uuid[]), p_pack_id)
      END,
      updated_at = now()
    WHERE user_id = p_user_id
      AND ad_id = ANY(p_ids_to_update);

    GET DIAGNOSTICS updated_count = ROW_COUNT;
  ELSE
    UPDATE public.ad_metrics
    SET
      pack_ids = CASE
        WHEN p_pack_id = ANY(COALESCE(pack_ids, ARRAY[]::uuid[])) THEN COALESCE(pack_ids, ARRAY[]::uuid[])
        ELSE array_append(COALESCE(pack_ids, ARRAY[]::uuid[]), p_pack_id)
      END,
      updated_at = now()
    WHERE user_id = p_user_id
      AND id = ANY(p_ids_to_update);

    GET DIAGNOSTICS updated_count = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'rows_updated', updated_count,
    'status', 'success'
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'status', 'error',
      'error_message', SQLERRM,
      'rows_updated', 0
    );
END;
$$;


ALTER FUNCTION public.batch_add_pack_id_to_arrays(p_user_id uuid, p_pack_id uuid, p_table_name text, p_ids_to_update text[]) OWNER TO postgres;

--
-- Name: FUNCTION batch_add_pack_id_to_arrays(p_user_id uuid, p_pack_id uuid, p_table_name text, p_ids_to_update text[]); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.batch_add_pack_id_to_arrays(p_user_id uuid, p_pack_id uuid, p_table_name text, p_ids_to_update text[]) IS 'Anexa pack_id de forma idempotente ao array pack_ids de ads ou ad_metrics em batch.';


--
-- Name: batch_remove_pack_id_from_arrays(uuid, uuid, text, text[]); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.batch_remove_pack_id_from_arrays(p_user_id uuid, p_pack_id uuid, p_table_name text, p_ids_to_update text[]) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  updated_count int;
BEGIN
  -- Validar tabela
  IF p_table_name NOT IN ('ads', 'ad_metrics') THEN
    RAISE EXCEPTION 'Tabela inválida: %. Use "ads" ou "ad_metrics"', p_table_name;
  END IF;
  
  -- Atualizar ads
  IF p_table_name = 'ads' THEN
    UPDATE public.ads
    SET 
      pack_ids = array_remove(pack_ids, p_pack_id),
      updated_at = now()
    WHERE 
      user_id = p_user_id
      AND ad_id = ANY(p_ids_to_update)
      AND p_pack_id = ANY(pack_ids);
    
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    
  -- Atualizar ad_metrics
  ELSIF p_table_name = 'ad_metrics' THEN
    UPDATE public.ad_metrics
    SET 
      pack_ids = array_remove(pack_ids, p_pack_id),
      updated_at = now()
    WHERE 
      user_id = p_user_id
      AND id = ANY(p_ids_to_update)
      AND p_pack_id = ANY(pack_ids);
    
    GET DIAGNOSTICS updated_count = ROW_COUNT;
  END IF;
  
  RETURN jsonb_build_object(
    'rows_updated', updated_count,
    'status', 'success'
  );
EXCEPTION
  WHEN OTHERS THEN
    -- Retornar erro de forma estruturada
    RETURN jsonb_build_object(
      'status', 'error',
      'error_message', SQLERRM,
      'rows_updated', 0
    );
END;
$$;


ALTER FUNCTION public.batch_remove_pack_id_from_arrays(p_user_id uuid, p_pack_id uuid, p_table_name text, p_ids_to_update text[]) OWNER TO postgres;

--
-- Name: FUNCTION batch_remove_pack_id_from_arrays(p_user_id uuid, p_pack_id uuid, p_table_name text, p_ids_to_update text[]); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.batch_remove_pack_id_from_arrays(p_user_id uuid, p_pack_id uuid, p_table_name text, p_ids_to_update text[]) IS 'Remove pack_id do array pack_ids de múltiplos registros em uma única transação. Muito mais eficiente que múltiplas requisições HTTP individuais. Reduz de N requisições para apenas 1. Usado durante a deleção de packs para preservar dados compartilhados entre múltiplos packs.';


--
-- Name: batch_update_ad_metrics_enrichment(uuid, jsonb, uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.batch_update_ad_metrics_enrichment(p_user_id uuid, p_updates jsonb, p_pack_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  total_rows_updated int := 0;
  total_ids_sent     int := 0;
  existing_count     int := 0;
  in_pack_count      int := 0;
  all_ids            text[];
BEGIN
  SELECT array_agg(id_val)
  INTO all_ids
  FROM jsonb_array_elements(p_updates) AS item,
  LATERAL jsonb_array_elements_text(item->'ids') AS id_val;

  total_ids_sent := coalesce(array_length(all_ids, 1), 0);

  WITH expanded AS (
    SELECT
      id_val AS id,
      CASE
        WHEN item ? 'leadscore_values'
          AND item->'leadscore_values' IS NOT NULL
          AND item->'leadscore_values' != 'null'::jsonb
          AND jsonb_array_length(item->'leadscore_values') > 0
        THEN ARRAY(
          SELECT v::numeric
          FROM jsonb_array_elements(item->'leadscore_values') AS v
        )
        ELSE NULL
      END AS leadscore_vals
    FROM jsonb_array_elements(p_updates) AS item,
    LATERAL jsonb_array_elements_text(item->'ids') AS id_val
  )
  UPDATE public.ad_metrics am
  SET
    leadscore_values = CASE
      WHEN e.leadscore_vals IS NOT NULL THEN e.leadscore_vals
      ELSE am.leadscore_values
    END,
    updated_at = now()
  FROM expanded e
  WHERE am.id = e.id
    AND am.user_id = p_user_id
    AND (
      p_pack_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.ad_metric_pack_map apm
        WHERE apm.user_id = am.user_id
          AND apm.ad_id = am.ad_id
          AND apm.metric_date = am.date
          AND apm.pack_id = p_pack_id
      )
    );

  GET DIAGNOSTICS total_rows_updated = ROW_COUNT;

  IF total_ids_sent > 0 THEN
    SELECT
      count(*)::int,
      count(*) FILTER (
        WHERE p_pack_id IS NULL
          OR EXISTS (
            SELECT 1 FROM public.ad_metric_pack_map apm2
            WHERE apm2.user_id = p_user_id
              AND apm2.ad_id = am_diag.ad_id
              AND apm2.metric_date = am_diag.date
              AND apm2.pack_id = p_pack_id
          )
      )::int
    INTO existing_count, in_pack_count
    FROM public.ad_metrics am_diag
    WHERE user_id = p_user_id AND id = ANY(all_ids);
  END IF;

  RETURN jsonb_build_object(
    'total_groups_processed', jsonb_array_length(p_updates),
    'total_rows_updated',     total_rows_updated,
    'total_ids_sent',         total_ids_sent,
    'ids_not_found_count',    greatest(0, total_ids_sent - existing_count),
    'ids_out_of_pack_count',  greatest(0, existing_count - in_pack_count),
    'status',                 'success'
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'status',                 'error',
      'error_message',          SQLERRM,
      'total_groups_processed', jsonb_array_length(p_updates),
      'total_rows_updated',     total_rows_updated,
      'total_ids_sent',         total_ids_sent,
      'ids_not_found_count',    0,
      'ids_out_of_pack_count',  0
    );
END;
$$;


ALTER FUNCTION public.batch_update_ad_metrics_enrichment(p_user_id uuid, p_updates jsonb, p_pack_id uuid) OWNER TO postgres;

--
-- Name: FUNCTION batch_update_ad_metrics_enrichment(p_user_id uuid, p_updates jsonb, p_pack_id uuid); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.batch_update_ad_metrics_enrichment(p_user_id uuid, p_updates jsonb, p_pack_id uuid) IS 'Atualiza multiplos registros de ad_metrics em uma unica transacao via UPDATE + CTE, aplicando apenas leadscore_values (fluxo Leadscore-only). Usa dual-read: EXISTS em ad_metric_pack_map + OR fallback pack_ids[].';


--
-- Name: claim_job_processing(text, uuid, text, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.claim_job_processing(p_job_id text, p_user_id uuid, p_owner text, p_lease_seconds integer DEFAULT 300) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_status text;
  v_claimed boolean := false;
BEGIN
  UPDATE public.jobs
  SET
    status = CASE WHEN status = 'meta_completed' THEN 'processing' ELSE status END,
    message = CASE WHEN status = 'meta_completed' THEN 'Iniciando coleta de anúncios...' ELSE message END,
    processing_owner = p_owner,
    processing_claimed_at = now(),
    processing_lease_until = now() + make_interval(secs => GREATEST(p_lease_seconds, 30)),
    processing_attempts = COALESCE(processing_attempts, 0) + 1,
    updated_at = now()
  WHERE id = p_job_id
    AND user_id = p_user_id
    AND status IN ('meta_completed', 'processing', 'persisting')
    AND (
      status = 'meta_completed'
      OR processing_lease_until IS NULL
      OR processing_lease_until <= now()
      OR processing_owner = p_owner
    )
  RETURNING status INTO v_status;

  v_claimed := FOUND;

  RETURN jsonb_build_object(
    'claimed', v_claimed,
    'status', COALESCE(v_status, ''),
    'owner', CASE WHEN v_claimed THEN p_owner ELSE NULL END
  );
END;
$$;


ALTER FUNCTION public.claim_job_processing(p_job_id text, p_user_id uuid, p_owner text, p_lease_seconds integer) OWNER TO postgres;

--
-- Name: FUNCTION claim_job_processing(p_job_id text, p_user_id uuid, p_owner text, p_lease_seconds integer); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.claim_job_processing(p_job_id text, p_user_id uuid, p_owner text, p_lease_seconds integer) IS 'Adquire lease de processamento do job de forma atômica. Permite claim inicial e self-healing apenas quando o lease expirou.';


--
-- Name: diagnose_manager_rpc_timing(uuid, date, date, text, uuid[]); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.diagnose_manager_rpc_timing(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text DEFAULT 'ad_name'::text, p_pack_ids uuid[] DEFAULT NULL::uuid[]) RETURNS TABLE(step_name text, row_count bigint, elapsed_ms numeric)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    SET statement_timeout TO '120s'
    AS $$
DECLARE
  t0 timestamptz;
  t1 timestamptz;
  v_group_by text := lower(coalesce(p_group_by, 'ad_name'));
  v_date_start date := least(p_date_start, p_date_stop);
  v_date_stop date := greatest(p_date_start, p_date_stop);
  v_axis_start date;
  v_mql_min numeric := 0;
  v_cnt bigint;
  v_series_window integer := 7;
BEGIN
  v_axis_start := greatest(v_date_start, (v_date_stop - (v_series_window - 1)));

  -- ── Etapa 0: buscar mql_leadscore_min ──
  t0 := clock_timestamp();
  SELECT coalesce(up.mql_leadscore_min, 0) INTO v_mql_min
    FROM public.user_preferences up WHERE up.user_id = p_user_id LIMIT 1;
  v_mql_min := coalesce(v_mql_min, 0);
  t1 := clock_timestamp();
  step_name := '0_mql_config';
  row_count := 1;
  elapsed_ms := round(extract(epoch FROM (t1 - t0)) * 1000, 2);
  RETURN NEXT;

  -- ── Etapa 1: mgr_base (busca principal + extração de hook/scroll_stop + contagem MQL) ──
  t0 := clock_timestamp();
  DROP TABLE IF EXISTS pg_temp.diag_base;
  CREATE TEMPORARY TABLE pg_temp.diag_base ON COMMIT DROP AS
  SELECT
    CASE
      WHEN v_group_by = 'ad_id'       THEN am.ad_id
      WHEN v_group_by = 'ad_name'     THEN coalesce(nullif(am.ad_name, ''), am.ad_id)
      WHEN v_group_by = 'adset_id'    THEN am.adset_id
      WHEN v_group_by = 'campaign_id' THEN am.campaign_id
      ELSE am.ad_id
    END AS group_key,
    am.account_id,
    am.campaign_id,
    am.campaign_name,
    am.adset_id,
    am.adset_name,
    am.ad_id,
    am.ad_name,
    am.date,
    coalesce(am.impressions, 0)::bigint AS impressions,
    coalesce(am.clicks, 0)::bigint AS clicks,
    coalesce(am.inline_link_clicks, 0)::bigint AS inline_link_clicks,
    coalesce(am.spend, 0)::numeric AS spend,
    coalesce(am.lpv, 0)::bigint AS lpv,
    coalesce(am.video_total_plays, 0)::bigint AS plays,
    coalesce(am.video_total_thruplays, 0)::bigint AS thruplays,
    coalesce(am.video_watched_p50, 0)::numeric AS video_watched_p50,
    coalesce(am.hold_rate, 0)::numeric AS hold_rate,
    coalesce(am.reach, 0)::bigint AS reach,
    coalesce(am.frequency, 0)::numeric AS frequency,
    coalesce(am.leadscore_values, '{}'::numeric[]) AS leadscore_values,
    CASE WHEN jsonb_typeof(am.conversions) = 'array' THEN am.conversions ELSE '[]'::jsonb END AS conversions,
    CASE WHEN jsonb_typeof(am.actions) = 'array' THEN am.actions ELSE '[]'::jsonb END AS actions,
    CASE WHEN jsonb_typeof(am.video_play_curve_actions) = 'array' THEN am.video_play_curve_actions ELSE '[]'::jsonb END AS video_play_curve_actions,
    -- hook extraído da curva (índice 3)
    CASE
      WHEN curve_vals.hook_raw > 1 THEN curve_vals.hook_raw / 100.0
      ELSE curve_vals.hook_raw
    END AS hook_value,
    -- scroll_stop extraído da curva (índice 1)
    CASE
      WHEN curve_vals.scroll_stop_raw > 1 THEN curve_vals.scroll_stop_raw / 100.0
      ELSE curve_vals.scroll_stop_raw
    END AS scroll_stop_value,
    -- contagem de MQLs por linha
    coalesce(
      (SELECT count(*)::integer FROM unnest(coalesce(am.leadscore_values, '{}'::numeric[])) v WHERE v >= v_mql_min),
      0
    ) AS mql_count_row
  FROM public.ad_metrics am
  LEFT JOIN LATERAL (
    SELECT
      CASE
        WHEN jsonb_typeof(am.video_play_curve_actions) = 'array'
         AND jsonb_array_length(am.video_play_curve_actions) > 0
        THEN coalesce(nullif(regexp_replace(coalesce(
               am.video_play_curve_actions ->> least(3, jsonb_array_length(am.video_play_curve_actions) - 1), '0'),
               '[^0-9.-]', '', 'g'), ''), '0')::numeric
        ELSE 0::numeric
      END AS hook_raw,
      CASE
        WHEN jsonb_typeof(am.video_play_curve_actions) = 'array'
         AND jsonb_array_length(am.video_play_curve_actions) > 0
        THEN coalesce(nullif(regexp_replace(coalesce(
               am.video_play_curve_actions ->> least(1, jsonb_array_length(am.video_play_curve_actions) - 1), '0'),
               '[^0-9.-]', '', 'g'), ''), '0')::numeric
        ELSE 0::numeric
      END AS scroll_stop_raw
  ) AS curve_vals ON TRUE
  WHERE am.user_id = p_user_id
    AND am.date >= v_date_start
    AND am.date <= v_date_stop
    AND (p_pack_ids IS NULL OR am.pack_ids && p_pack_ids);

  SELECT count(*) INTO v_cnt FROM pg_temp.diag_base;
  t1 := clock_timestamp();
  step_name := '1_mgr_base';
  row_count := v_cnt;
  elapsed_ms := round(extract(epoch FROM (t1 - t0)) * 1000, 2);
  RETURN NEXT;

  -- ── Etapa 1b: criar índices na temp table ──
  t0 := clock_timestamp();
  CREATE INDEX diag_base_gk ON pg_temp.diag_base (group_key);
  CREATE INDEX diag_base_dt ON pg_temp.diag_base (date);
  t1 := clock_timestamp();
  step_name := '1b_base_indexes';
  row_count := v_cnt;
  elapsed_ms := round(extract(epoch FROM (t1 - t0)) * 1000, 2);
  RETURN NEXT;

  -- ── Etapa 2: mgr_group (agrupamento principal) ──
  t0 := clock_timestamp();
  DROP TABLE IF EXISTS pg_temp.diag_group;
  CREATE TEMPORARY TABLE pg_temp.diag_group ON COMMIT DROP AS
  WITH rep AS (
    SELECT DISTINCT ON (b.group_key)
      b.group_key, b.account_id, b.campaign_id, b.campaign_name,
      b.adset_id, b.adset_name, b.ad_id AS rep_ad_id, b.ad_name AS rep_ad_name
    FROM pg_temp.diag_base b
    ORDER BY b.group_key, b.impressions DESC, b.ad_id DESC
  ),
  agg AS (
    SELECT
      b.group_key,
      sum(b.impressions)::bigint AS impressions,
      sum(b.clicks)::bigint AS clicks,
      sum(b.inline_link_clicks)::bigint AS inline_link_clicks,
      sum(b.spend)::numeric AS spend,
      sum(b.lpv)::bigint AS lpv,
      sum(b.plays)::bigint AS plays,
      sum(b.thruplays)::bigint AS thruplays,
      sum(b.hook_value * b.plays)::numeric AS hook_wsum,
      sum(b.hold_rate * b.plays)::numeric AS hold_rate_wsum,
      sum(b.scroll_stop_value * b.plays)::numeric AS scroll_stop_wsum,
      count(DISTINCT b.ad_id)::integer AS ad_count,
      array_agg(DISTINCT b.ad_id)::text[] AS ad_ids
    FROM pg_temp.diag_base b
    GROUP BY b.group_key
  )
  SELECT a.*, r.rep_ad_id, r.rep_ad_name, r.account_id, r.campaign_id,
         r.campaign_name, r.adset_id, r.adset_name
  FROM agg a JOIN rep r USING (group_key);

  SELECT count(*) INTO v_cnt FROM pg_temp.diag_group;
  t1 := clock_timestamp();
  step_name := '2_mgr_group';
  row_count := v_cnt;
  elapsed_ms := round(extract(epoch FROM (t1 - t0)) * 1000, 2);
  RETURN NEXT;

  -- ── Etapa 3: conv_entries (expansão JSONB de conversions + actions) ──
  t0 := clock_timestamp();
  DROP TABLE IF EXISTS pg_temp.diag_conv;
  CREATE TEMPORARY TABLE pg_temp.diag_conv ON COMMIT DROP AS
  SELECT b.group_key, b.date, 'conversion:' || c.action_type AS conv_key, c.conv_value
  FROM pg_temp.diag_base b
  CROSS JOIN LATERAL (
    SELECT nullif(elem->>'action_type', '') AS action_type,
      coalesce(nullif(regexp_replace(coalesce(elem->>'value', '0'), '[^0-9.-]', '', 'g'), ''), '0')::numeric AS conv_value
    FROM jsonb_array_elements(b.conversions) elem
  ) c WHERE c.action_type IS NOT NULL
  UNION ALL
  SELECT b.group_key, b.date, 'action:' || a.action_type, a.conv_value
  FROM pg_temp.diag_base b
  CROSS JOIN LATERAL (
    SELECT nullif(elem->>'action_type', '') AS action_type,
      coalesce(nullif(regexp_replace(coalesce(elem->>'value', '0'), '[^0-9.-]', '', 'g'), ''), '0')::numeric AS conv_value
    FROM jsonb_array_elements(b.actions) elem
  ) a WHERE a.action_type IS NOT NULL;

  SELECT count(*) INTO v_cnt FROM pg_temp.diag_conv;
  t1 := clock_timestamp();
  step_name := '3_conv_entries';
  row_count := v_cnt;
  elapsed_ms := round(extract(epoch FROM (t1 - t0)) * 1000, 2);
  RETURN NEXT;

  -- ── Etapa 4: conv_group + conv_map (agrupamento de conversions) ──
  t0 := clock_timestamp();
  DROP TABLE IF EXISTS pg_temp.diag_conv_map;
  CREATE TEMPORARY TABLE pg_temp.diag_conv_map ON COMMIT DROP AS
  SELECT group_key, jsonb_object_agg(conv_key, conv_value ORDER BY conv_key) AS conversions
  FROM (
    SELECT group_key, conv_key, sum(conv_value)::numeric AS conv_value
    FROM pg_temp.diag_conv GROUP BY group_key, conv_key
  ) sub
  GROUP BY group_key;

  SELECT count(*) INTO v_cnt FROM pg_temp.diag_conv_map;
  t1 := clock_timestamp();
  step_name := '4_conv_map';
  row_count := v_cnt;
  elapsed_ms := round(extract(epoch FROM (t1 - t0)) * 1000, 2);
  RETURN NEXT;

  -- ── Etapa 5: conv_daily_map (conversions por dia — para sparklines) ──
  t0 := clock_timestamp();
  DROP TABLE IF EXISTS pg_temp.diag_conv_daily;
  CREATE TEMPORARY TABLE pg_temp.diag_conv_daily ON COMMIT DROP AS
  SELECT group_key, date,
    jsonb_object_agg(conv_key, conv_value ORDER BY conv_key) AS conversions
  FROM (
    SELECT group_key, date, conv_key, sum(conv_value)::numeric AS conv_value
    FROM pg_temp.diag_conv GROUP BY group_key, date, conv_key
  ) sub
  GROUP BY group_key, date;

  SELECT count(*) INTO v_cnt FROM pg_temp.diag_conv_daily;
  t1 := clock_timestamp();
  step_name := '5_conv_daily_map';
  row_count := v_cnt;
  elapsed_ms := round(extract(epoch FROM (t1 - t0)) * 1000, 2);
  RETURN NEXT;

  -- ── Etapa 6: mgr_daily (métricas diárias para sparklines) ──
  t0 := clock_timestamp();
  DROP TABLE IF EXISTS pg_temp.diag_daily;
  CREATE TEMPORARY TABLE pg_temp.diag_daily ON COMMIT DROP AS
  SELECT
    b.group_key, b.date,
    sum(b.impressions)::bigint AS impressions,
    sum(b.clicks)::bigint AS clicks,
    sum(b.inline_link_clicks)::bigint AS inline_link_clicks,
    sum(b.spend)::numeric AS spend,
    sum(b.lpv)::bigint AS lpv,
    sum(b.plays)::bigint AS plays,
    sum(b.hook_value * b.plays)::numeric AS hook_wsum,
    sum(b.mql_count_row)::bigint AS mql_count
  FROM pg_temp.diag_base b
  WHERE b.date >= v_axis_start AND b.date <= v_date_stop
  GROUP BY b.group_key, b.date;

  SELECT count(*) INTO v_cnt FROM pg_temp.diag_daily;
  t1 := clock_timestamp();
  step_name := '6_mgr_daily';
  row_count := v_cnt;
  elapsed_ms := round(extract(epoch FROM (t1 - t0)) * 1000, 2);
  RETURN NEXT;

  -- ── Etapa 7: mgr_status (JOIN com tabela ads para status) ──
  t0 := clock_timestamp();
  DROP TABLE IF EXISTS pg_temp.diag_status;
  CREATE TEMPORARY TABLE pg_temp.diag_status ON COMMIT DROP AS
  SELECT
    x.group_key,
    bool_or(upper(coalesce(a.effective_status, '')) = 'ACTIVE') AS has_active,
    count(DISTINCT x.ad_id) FILTER (WHERE upper(coalesce(a.effective_status, '')) = 'ACTIVE')::integer AS active_count
  FROM (
    SELECT g.group_key, unnest(coalesce(g.ad_ids, ARRAY[]::text[])) AS ad_id
    FROM pg_temp.diag_group g
  ) x
  LEFT JOIN public.ads a ON a.user_id = p_user_id AND a.ad_id = x.ad_id
  GROUP BY x.group_key;

  SELECT count(*) INTO v_cnt FROM pg_temp.diag_status;
  t1 := clock_timestamp();
  step_name := '7_mgr_status';
  row_count := v_cnt;
  elapsed_ms := round(extract(epoch FROM (t1 - t0)) * 1000, 2);
  RETURN NEXT;

  -- ── Etapa 8: mgr_rep_ads (thumbnail do anúncio representativo) ──
  t0 := clock_timestamp();
  DROP TABLE IF EXISTS pg_temp.diag_rep;
  CREATE TEMPORARY TABLE pg_temp.diag_rep ON COMMIT DROP AS
  SELECT g.group_key, a.effective_status,
    coalesce(nullif(a.thumbnail_url, ''), nullif(a.adcreatives_videos_thumbs->>0, '')) AS thumbnail
  FROM pg_temp.diag_group g
  LEFT JOIN public.ads a ON a.user_id = p_user_id AND a.ad_id = g.rep_ad_id;

  SELECT count(*) INTO v_cnt FROM pg_temp.diag_rep;
  t1 := clock_timestamp();
  step_name := '8_mgr_rep_ads';
  row_count := v_cnt;
  elapsed_ms := round(extract(epoch FROM (t1 - t0)) * 1000, 2);
  RETURN NEXT;

  -- ── Etapa 9: mgr_leadscore (agregação de leadscore_values) ──
  t0 := clock_timestamp();
  DROP TABLE IF EXISTS pg_temp.diag_ls;
  CREATE TEMPORARY TABLE pg_temp.diag_ls ON COMMIT DROP AS
  SELECT b.group_key, array_agg(v)::numeric[] AS leadscore_values
  FROM pg_temp.diag_base b
  CROSS JOIN LATERAL unnest(coalesce(b.leadscore_values, '{}'::numeric[])) v
  GROUP BY b.group_key;

  SELECT count(*) INTO v_cnt FROM pg_temp.diag_ls;
  t1 := clock_timestamp();
  step_name := '9_leadscore_agg';
  row_count := v_cnt;
  elapsed_ms := round(extract(epoch FROM (t1 - t0)) * 1000, 2);
  RETURN NEXT;

  -- ── Etapa 10: mgr_curve (curva de vídeo ponderada) ──
  t0 := clock_timestamp();
  DROP TABLE IF EXISTS pg_temp.diag_curve;
  CREATE TEMPORARY TABLE pg_temp.diag_curve ON COMMIT DROP AS
  WITH points AS (
    SELECT
      b.group_key,
      (cv.ord - 1)::integer AS idx,
      sum(coalesce(nullif(regexp_replace(cv.val, '[^0-9.-]', '', 'g'), ''), '0')::numeric * b.plays)::numeric AS weighted_sum,
      sum(b.plays)::numeric AS plays_sum
    FROM pg_temp.diag_base b
    CROSS JOIN LATERAL jsonb_array_elements_text(b.video_play_curve_actions)
      WITH ORDINALITY AS cv(val, ord)
    WHERE b.plays > 0
    GROUP BY b.group_key, (cv.ord - 1)
  )
  SELECT group_key,
    jsonb_agg(coalesce(round(weighted_sum / nullif(plays_sum, 0))::int, 0) ORDER BY idx) AS curve
  FROM points GROUP BY group_key;

  SELECT count(*) INTO v_cnt FROM pg_temp.diag_curve;
  t1 := clock_timestamp();
  step_name := '10_curve_agg';
  row_count := v_cnt;
  elapsed_ms := round(extract(epoch FROM (t1 - t0)) * 1000, 2);
  RETURN NEXT;

  -- ── Etapa 11: mgr_series (sparklines — 12 subqueries correlacionadas por grupo) ──
  t0 := clock_timestamp();
  DROP TABLE IF EXISTS pg_temp.diag_axis;
  CREATE TEMPORARY TABLE pg_temp.diag_axis (d date NOT NULL) ON COMMIT DROP;
  INSERT INTO pg_temp.diag_axis (d)
    SELECT generate_series(v_axis_start, v_date_stop, interval '1 day')::date;

  DROP TABLE IF EXISTS pg_temp.diag_series;
  CREATE TEMPORARY TABLE pg_temp.diag_series ON COMMIT DROP AS
  SELECT
    g.group_key,
    jsonb_build_object(
      'axis', (SELECT jsonb_agg(to_char(a.d, 'YYYY-MM-DD') ORDER BY a.d) FROM pg_temp.diag_axis a),
      'hook', (
        SELECT jsonb_agg(CASE WHEN d.plays > 0 THEN d.hook_wsum / d.plays ELSE NULL END ORDER BY a.d)
        FROM pg_temp.diag_axis a
        LEFT JOIN pg_temp.diag_daily d ON d.group_key = g.group_key AND d.date = a.d
      ),
      'spend', (
        SELECT jsonb_agg(CASE WHEN coalesce(d.spend, 0) <> 0 THEN d.spend ELSE NULL END ORDER BY a.d)
        FROM pg_temp.diag_axis a
        LEFT JOIN pg_temp.diag_daily d ON d.group_key = g.group_key AND d.date = a.d
      ),
      'ctr', (
        SELECT jsonb_agg(CASE WHEN d.impressions > 0 THEN d.clicks::numeric / d.impressions ELSE NULL END ORDER BY a.d)
        FROM pg_temp.diag_axis a
        LEFT JOIN pg_temp.diag_daily d ON d.group_key = g.group_key AND d.date = a.d
      ),
      'connect_rate', (
        SELECT jsonb_agg(CASE WHEN d.inline_link_clicks > 0 THEN d.lpv::numeric / d.inline_link_clicks ELSE NULL END ORDER BY a.d)
        FROM pg_temp.diag_axis a
        LEFT JOIN pg_temp.diag_daily d ON d.group_key = g.group_key AND d.date = a.d
      ),
      'lpv', (
        SELECT jsonb_agg(coalesce(d.lpv, 0) ORDER BY a.d)
        FROM pg_temp.diag_axis a
        LEFT JOIN pg_temp.diag_daily d ON d.group_key = g.group_key AND d.date = a.d
      ),
      'impressions', (
        SELECT jsonb_agg(CASE WHEN coalesce(d.impressions, 0) <> 0 THEN d.impressions ELSE NULL END ORDER BY a.d)
        FROM pg_temp.diag_axis a
        LEFT JOIN pg_temp.diag_daily d ON d.group_key = g.group_key AND d.date = a.d
      ),
      'cpm', (
        SELECT jsonb_agg(CASE WHEN d.impressions > 0 THEN (d.spend * 1000.0) / d.impressions ELSE NULL END ORDER BY a.d)
        FROM pg_temp.diag_axis a
        LEFT JOIN pg_temp.diag_daily d ON d.group_key = g.group_key AND d.date = a.d
      ),
      'website_ctr', (
        SELECT jsonb_agg(CASE WHEN d.impressions > 0 THEN d.inline_link_clicks::numeric / d.impressions ELSE NULL END ORDER BY a.d)
        FROM pg_temp.diag_axis a
        LEFT JOIN pg_temp.diag_daily d ON d.group_key = g.group_key AND d.date = a.d
      ),
      'conversions', (
        SELECT jsonb_agg(coalesce(dc.conversions, '{}'::jsonb) ORDER BY a.d)
        FROM pg_temp.diag_axis a
        LEFT JOIN pg_temp.diag_conv_daily dc ON dc.group_key = g.group_key AND dc.date = a.d
      ),
      'cpmql', (
        SELECT jsonb_agg(CASE WHEN coalesce(d.mql_count, 0) > 0 AND coalesce(d.spend, 0) > 0 THEN d.spend / d.mql_count ELSE NULL END ORDER BY a.d)
        FROM pg_temp.diag_axis a
        LEFT JOIN pg_temp.diag_daily d ON d.group_key = g.group_key AND d.date = a.d
      ),
      'mqls', (
        SELECT jsonb_agg(CASE WHEN coalesce(d.mql_count, 0) > 0 THEN d.mql_count ELSE NULL END ORDER BY a.d)
        FROM pg_temp.diag_axis a
        LEFT JOIN pg_temp.diag_daily d ON d.group_key = g.group_key AND d.date = a.d
      )
    ) AS series
  FROM pg_temp.diag_group g;

  SELECT count(*) INTO v_cnt FROM pg_temp.diag_series;
  t1 := clock_timestamp();
  step_name := '11_mgr_series';
  row_count := v_cnt;
  elapsed_ms := round(extract(epoch FROM (t1 - t0)) * 1000, 2);
  RETURN NEXT;

  -- ── Etapa 12: montagem final do JSON ──
  t0 := clock_timestamp();
  PERFORM jsonb_build_object(
    'data_count', (SELECT count(*) FROM pg_temp.diag_group),
    'conversion_types', (SELECT count(DISTINCT conv_key) FROM pg_temp.diag_conv)
  );
  t1 := clock_timestamp();
  step_name := '12_json_build';
  row_count := v_cnt;
  elapsed_ms := round(extract(epoch FROM (t1 - t0)) * 1000, 2);
  RETURN NEXT;

  -- ── Resumo ──
  step_name := '--- RESUMO ---'; row_count := 0; elapsed_ms := 0; RETURN NEXT;
  step_name := 'total_linhas_brutas'; row_count := (SELECT count(*) FROM pg_temp.diag_base); elapsed_ms := 0; RETURN NEXT;
  step_name := 'total_grupos'; row_count := (SELECT count(*) FROM pg_temp.diag_group); elapsed_ms := 0; RETURN NEXT;
  step_name := 'total_conv_entries'; row_count := (SELECT count(*) FROM pg_temp.diag_conv); elapsed_ms := 0; RETURN NEXT;
  step_name := 'total_dias_range'; row_count := (v_date_stop - v_date_start + 1)::bigint; elapsed_ms := 0; RETURN NEXT;
  step_name := 'total_dias_series'; row_count := (SELECT count(*) FROM pg_temp.diag_axis); elapsed_ms := 0; RETURN NEXT;
END;
$$;


ALTER FUNCTION public.diagnose_manager_rpc_timing(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[]) OWNER TO postgres;

--
-- Name: FUNCTION diagnose_manager_rpc_timing(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[]); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.diagnose_manager_rpc_timing(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[]) IS 'Diagnóstico de performance: mede tempo de cada etapa do RPC do Manager. Rodar no SQL Editor com parâmetros reais para identificar gargalos.';


--
-- Name: fetch_ad_metrics_for_analytics(uuid, date, date, uuid[], text[]); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.fetch_ad_metrics_for_analytics(p_user_id uuid, p_date_start date, p_date_stop date, p_pack_ids uuid[] DEFAULT NULL::uuid[], p_account_ids text[] DEFAULT NULL::text[]) RETURNS SETOF jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  RETURN QUERY
  SELECT jsonb_build_object(
    'ad_id',                     am.ad_id,
    'ad_name',                   am.ad_name,
    'account_id',                am.account_id,
    'campaign_id',               am.campaign_id,
    'campaign_name',             am.campaign_name,
    'adset_id',                  am.adset_id,
    'adset_name',                am.adset_name,
    'date',                      am.date,
    'clicks',                    am.clicks,
    'impressions',               am.impressions,
    'inline_link_clicks',        am.inline_link_clicks,
    'spend',                     am.spend,
    'video_total_plays',         am.video_total_plays,
    'video_total_thruplays',     am.video_total_thruplays,
    'video_watched_p50',         am.video_watched_p50,
    'conversions',               am.conversions,
    'actions',                   am.actions,
    'video_play_curve_actions',  am.video_play_curve_actions,
    'hook_rate',                 am.hook_rate,
    'scroll_stop_rate',          am.scroll_stop_rate,
    'hold_rate',                 am.hold_rate,
    'reach',                     am.reach,
    'frequency',                 am.frequency,
    'leadscore_values',          am.leadscore_values,
    'lpv',                       am.lpv
  )
  FROM public.ad_metrics am
  WHERE am.user_id = p_user_id
    AND am.date >= p_date_start
    AND am.date <= p_date_stop
    AND (
      p_pack_ids IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.ad_metric_pack_map apm
        WHERE apm.user_id = am.user_id
          AND apm.ad_id = am.ad_id
          AND apm.metric_date = am.date
          AND apm.pack_id = ANY(p_pack_ids)
      )
    )
    AND (p_account_ids IS NULL OR am.account_id = ANY(p_account_ids));
END;
$$;


ALTER FUNCTION public.fetch_ad_metrics_for_analytics(p_user_id uuid, p_date_start date, p_date_stop date, p_pack_ids uuid[], p_account_ids text[]) OWNER TO postgres;

--
-- Name: fetch_manager_analytics_aggregated(uuid, date, date, text, uuid[], text[], text, text, text, boolean, boolean, integer, integer, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.fetch_manager_analytics_aggregated(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text DEFAULT 'ad_name'::text, p_pack_ids uuid[] DEFAULT NULL::uuid[], p_account_ids text[] DEFAULT NULL::text[], p_campaign_name_contains text DEFAULT NULL::text, p_adset_name_contains text DEFAULT NULL::text, p_ad_name_contains text DEFAULT NULL::text, p_include_series boolean DEFAULT true, p_include_leadscore boolean DEFAULT true, p_series_window integer DEFAULT 7, p_limit integer DEFAULT 10000, p_order_by text DEFAULT 'spend'::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_payload jsonb;
  v_data jsonb := '[]'::jsonb;
  v_averages jsonb := '{}'::jsonb;
  v_total_spend numeric := 0;
  v_total_clicks numeric := 0;
  v_total_inline numeric := 0;
begin
  select public.fetch_manager_analytics_aggregated_base_v049(
    p_user_id,
    p_date_start,
    p_date_stop,
    p_group_by,
    p_pack_ids,
    p_account_ids,
    p_campaign_name_contains,
    p_adset_name_contains,
    p_ad_name_contains,
    p_include_series,
    p_include_leadscore,
    p_series_window,
    p_limit,
    p_order_by
  )
  into v_payload;

  if coalesce(jsonb_typeof(v_payload), '') <> 'object' then
    return jsonb_build_object(
      'data', '[]'::jsonb,
      'available_conversion_types', '[]'::jsonb,
      'averages', '{}'::jsonb
    );
  end if;

  if jsonb_typeof(v_payload->'data') = 'array' then
    with raw as (
      select
        ord,
        item,
        coalesce(nullif(item->>'spend', ''), '0')::numeric as spend,
        coalesce(nullif(item->>'clicks', ''), '0')::numeric as clicks,
        coalesce(nullif(item->>'inline_link_clicks', ''), '0')::numeric as inline_link_clicks
      from jsonb_array_elements(v_payload->'data') with ordinality as t(item, ord)
    )
    select
      coalesce(
        jsonb_agg(
          item || jsonb_build_object(
            'cpc',
            case
              when clicks > 0 then to_jsonb(spend / clicks)
              else 'null'::jsonb
            end,
            'cplc',
            case
              when inline_link_clicks > 0 then to_jsonb(spend / inline_link_clicks)
              else 'null'::jsonb
            end
          )
          order by ord
        ),
        '[]'::jsonb
      ),
      coalesce(sum(spend), 0),
      coalesce(sum(clicks), 0),
      coalesce(sum(inline_link_clicks), 0)
    into v_data, v_total_spend, v_total_clicks, v_total_inline
    from raw;
  end if;

  v_averages :=
    case
      when jsonb_typeof(v_payload->'averages') = 'object' then v_payload->'averages'
      else '{}'::jsonb
    end
    || jsonb_build_object(
      'cpc',
      case
        when v_total_clicks > 0 then to_jsonb(v_total_spend / v_total_clicks)
        else to_jsonb(0::numeric)
      end,
      'cplc',
      case
        when v_total_inline > 0 then to_jsonb(v_total_spend / v_total_inline)
        else to_jsonb(0::numeric)
      end
    );

  return v_payload
    || jsonb_build_object(
      'data', v_data,
      'averages', v_averages
    );
end;
$$;


ALTER FUNCTION public.fetch_manager_analytics_aggregated(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_include_series boolean, p_include_leadscore boolean, p_series_window integer, p_limit integer, p_order_by text) OWNER TO postgres;

--
-- Name: FUNCTION fetch_manager_analytics_aggregated(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_include_series boolean, p_include_leadscore boolean, p_series_window integer, p_limit integer, p_order_by text); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.fetch_manager_analytics_aggregated(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_include_series boolean, p_include_leadscore boolean, p_series_window integer, p_limit integer, p_order_by text) IS 'Manager aggregated RPC wrapper: enriches the payload with native cpc/cplc values and averages while preserving the existing contract.';


--
-- Name: fetch_manager_analytics_aggregated_base_v047(uuid, date, date, text, uuid[], text[], text, text, text, boolean, boolean, integer, integer, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.fetch_manager_analytics_aggregated_base_v047(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text DEFAULT 'ad_name'::text, p_pack_ids uuid[] DEFAULT NULL::uuid[], p_account_ids text[] DEFAULT NULL::text[], p_campaign_name_contains text DEFAULT NULL::text, p_adset_name_contains text DEFAULT NULL::text, p_ad_name_contains text DEFAULT NULL::text, p_include_series boolean DEFAULT true, p_include_leadscore boolean DEFAULT true, p_series_window integer DEFAULT 7, p_limit integer DEFAULT 10000, p_order_by text DEFAULT 'spend'::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_group_by text := lower(coalesce(p_group_by, 'ad_name'));
  v_order_by text := lower(coalesce(p_order_by, 'spend'));
  v_date_start date := least(p_date_start, p_date_stop);
  v_date_stop date := greatest(p_date_start, p_date_stop);
  v_series_window integer := greatest(1, coalesce(p_series_window, 7));
  v_axis_start date;
  v_mql_min numeric := 0;

  v_total_spend numeric := 0;
  v_total_impressions bigint := 0;
  v_total_clicks bigint := 0;
  v_total_inline bigint := 0;
  v_total_lpv bigint := 0;
  v_total_plays bigint := 0;
  v_total_hook_wsum numeric := 0;
  v_total_hold_rate_wsum numeric := 0;
  v_total_scroll_stop_wsum numeric := 0;

  v_available_conversion_types jsonb := '[]'::jsonb;
  v_per_action_type jsonb := '{}'::jsonb;
  v_averages jsonb := '{}'::jsonb;
  v_data jsonb := '[]'::jsonb;
begin
  if auth.uid() is distinct from p_user_id then
    raise exception 'Forbidden: p_user_id must match auth.uid()'
      using errcode = '42501';
  end if;

  if v_group_by not in ('ad_id', 'ad_name', 'adset_id', 'campaign_id') then
    raise exception 'Invalid p_group_by: %, expected ad_id|ad_name|adset_id|campaign_id', v_group_by
      using errcode = '22023';
  end if;

  select coalesce(up.mql_leadscore_min, 0)
    into v_mql_min
  from public.user_preferences up
  where up.user_id = p_user_id
  limit 1;

  v_mql_min := coalesce(v_mql_min, 0);
  v_axis_start := greatest(v_date_start, (v_date_stop - (v_series_window - 1)));

  -- ═══════════════════════════════════════════════════════════════════
  -- mgr_base: busca principal (SEM mql_count_row — movido para mgr_daily)
  -- ═══════════════════════════════════════════════════════════════════
  drop table if exists pg_temp.mgr_base;
  create temporary table pg_temp.mgr_base on commit drop as
  select
    case
      when v_group_by = 'ad_id' then am.ad_id
      when v_group_by = 'ad_name' then coalesce(nullif(am.ad_name, ''), am.ad_id)
      when v_group_by = 'adset_id' then am.adset_id
      when v_group_by = 'campaign_id' then am.campaign_id
      else am.ad_id
    end as group_key,
    am.account_id,
    am.campaign_id,
    am.campaign_name,
    am.adset_id,
    am.adset_name,
    am.ad_id,
    am.ad_name,
    am.date,
    coalesce(am.impressions, 0)::bigint as impressions,
    coalesce(am.clicks, 0)::bigint as clicks,
    coalesce(am.inline_link_clicks, 0)::bigint as inline_link_clicks,
    coalesce(am.spend, 0)::numeric as spend,
    coalesce(am.lpv, 0)::bigint as lpv,
    coalesce(am.video_total_plays, 0)::bigint as plays,
    coalesce(am.video_total_thruplays, 0)::bigint as thruplays,
    coalesce(am.video_watched_p50, 0)::numeric as video_watched_p50,
    coalesce(am.hold_rate, 0)::numeric as hold_rate,
    coalesce(am.reach, 0)::bigint as reach,
    coalesce(am.frequency, 0)::numeric as frequency,
    coalesce(am.leadscore_values, '{}'::numeric[]) as leadscore_values,
    case when jsonb_typeof(am.conversions) = 'array' then am.conversions else '[]'::jsonb end as conversions,
    case when jsonb_typeof(am.actions) = 'array' then am.actions else '[]'::jsonb end as actions,
    case when jsonb_typeof(am.video_play_curve_actions) = 'array' then am.video_play_curve_actions else '[]'::jsonb end as video_play_curve_actions,
    case
      when curve_vals.hook_raw > 1 then curve_vals.hook_raw / 100.0
      else curve_vals.hook_raw
    end as hook_value,
    case
      when curve_vals.scroll_stop_raw > 1 then curve_vals.scroll_stop_raw / 100.0
      else curve_vals.scroll_stop_raw
    end as scroll_stop_value
    -- REMOVIDO: mql_count_row (era unnest+count per-row em 13K+ linhas)
    -- Agora calculado apenas em mgr_daily, só para linhas da janela de séries
  from public.ad_metrics am
  left join lateral (
    select
      case
        when jsonb_typeof(am.video_play_curve_actions) = 'array'
         and jsonb_array_length(am.video_play_curve_actions) > 0
        then coalesce(
               nullif(
                 regexp_replace(
                   coalesce(
                     am.video_play_curve_actions ->> least(3, jsonb_array_length(am.video_play_curve_actions) - 1),
                     '0'
                   ),
                   '[^0-9.-]',
                   '',
                   'g'
                 ),
                 ''
               ),
               '0'
             )::numeric
        else 0::numeric
      end as hook_raw,
      case
        when jsonb_typeof(am.video_play_curve_actions) = 'array'
         and jsonb_array_length(am.video_play_curve_actions) > 0
        then coalesce(
               nullif(
                 regexp_replace(
                   coalesce(
                     am.video_play_curve_actions ->> least(1, jsonb_array_length(am.video_play_curve_actions) - 1),
                     '0'
                   ),
                   '[^0-9.-]',
                   '',
                   'g'
                 ),
                 ''
               ),
               '0'
             )::numeric
        else 0::numeric
      end as scroll_stop_raw
  ) as curve_vals on true
  where am.user_id = p_user_id
    and am.date >= v_date_start
    and am.date <= v_date_stop
    and (p_pack_ids is null or am.pack_ids && p_pack_ids)
    and (p_account_ids is null or am.account_id = any(p_account_ids))
    and (
      p_campaign_name_contains is null
      or p_campaign_name_contains = ''
      or coalesce(am.campaign_name, '') ilike '%' || p_campaign_name_contains || '%'
    )
    and (
      p_adset_name_contains is null
      or p_adset_name_contains = ''
      or coalesce(am.adset_name, '') ilike '%' || p_adset_name_contains || '%'
    )
    and (
      p_ad_name_contains is null
      or p_ad_name_contains = ''
      or coalesce(am.ad_name, '') ilike '%' || p_ad_name_contains || '%'
    );

  create index mgr_base_group_key_idx on pg_temp.mgr_base (group_key);
  create index mgr_base_date_idx on pg_temp.mgr_base (date);

  -- ═══════════════════════════════════════════════════════════════════
  -- mgr_axis: dias para sparklines
  -- ═══════════════════════════════════════════════════════════════════
  drop table if exists pg_temp.mgr_axis;
  create temporary table pg_temp.mgr_axis (
    d date not null
  ) on commit drop;

  insert into pg_temp.mgr_axis (d)
  select generate_series(v_axis_start, v_date_stop, interval '1 day')::date;

  -- ═══════════════════════════════════════════════════════════════════
  -- mgr_group: agrupamento principal (SEM array_agg de ad_ids)
  -- ═══════════════════════════════════════════════════════════════════
  drop table if exists pg_temp.mgr_group;
  create temporary table pg_temp.mgr_group on commit drop as
  with rep as (
    select distinct on (b.group_key)
      b.group_key,
      b.account_id,
      b.campaign_id,
      b.campaign_name,
      b.adset_id,
      b.adset_name,
      b.ad_id as rep_ad_id,
      b.ad_name as rep_ad_name
    from pg_temp.mgr_base b
    order by b.group_key, b.impressions desc, b.ad_id desc
  ),
  agg as (
    select
      b.group_key,
      sum(b.impressions)::bigint as impressions,
      sum(b.clicks)::bigint as clicks,
      sum(b.inline_link_clicks)::bigint as inline_link_clicks,
      sum(b.spend)::numeric as spend,
      sum(b.lpv)::bigint as lpv,
      sum(b.plays)::bigint as plays,
      sum(b.thruplays)::bigint as thruplays,
      sum(b.hook_value * b.plays)::numeric as hook_wsum,
      sum(b.hold_rate * b.plays)::numeric as hold_rate_wsum,
      sum(b.video_watched_p50 * b.plays)::numeric as video_watched_p50_wsum,
      sum(b.scroll_stop_value * b.plays)::numeric as scroll_stop_wsum,
      sum(b.reach)::bigint as reach,
      sum(b.frequency * b.impressions)::numeric as frequency_wsum,
      count(distinct b.ad_id)::integer as ad_id_count,
      count(distinct nullif(b.adset_id, ''))::integer as adset_count
      -- REMOVIDO: array_agg(distinct b.ad_id) (não mais necessário, status usa mgr_base)
    from pg_temp.mgr_base b
    group by b.group_key
  )
  select
    a.group_key,
    r.account_id,
    r.campaign_id,
    r.campaign_name,
    r.adset_id,
    r.adset_name,
    r.rep_ad_id,
    r.rep_ad_name,
    a.impressions,
    a.clicks,
    a.inline_link_clicks,
    a.spend,
    a.lpv,
    a.plays,
    a.thruplays,
    a.hook_wsum,
    a.hold_rate_wsum,
    a.video_watched_p50_wsum,
    a.scroll_stop_wsum,
    a.reach,
    a.frequency_wsum,
    case
      when v_group_by = 'campaign_id' then a.adset_count
      else a.ad_id_count
    end as ad_count
  from agg a
  join rep r using (group_key);

  create index mgr_group_group_key_idx on pg_temp.mgr_group (group_key);

  -- ═══════════════════════════════════════════════════════════════════
  -- conv_entries: expansão JSONB de conversions + actions
  -- ═══════════════════════════════════════════════════════════════════
  drop table if exists pg_temp.mgr_conv_entries;
  create temporary table pg_temp.mgr_conv_entries on commit drop as
  select
    b.group_key,
    b.date,
    'conversion:' || c.action_type as conv_key,
    c.conv_value
  from pg_temp.mgr_base b
  cross join lateral (
    select
      nullif(elem->>'action_type', '') as action_type,
      coalesce(
        nullif(regexp_replace(coalesce(elem->>'value', '0'), '[^0-9.-]', '', 'g'), ''),
        '0'
      )::numeric as conv_value
    from jsonb_array_elements(b.conversions) elem
  ) c
  where c.action_type is not null
  union all
  select
    b.group_key,
    b.date,
    'action:' || a.action_type as conv_key,
    a.conv_value
  from pg_temp.mgr_base b
  cross join lateral (
    select
      nullif(elem->>'action_type', '') as action_type,
      coalesce(
        nullif(regexp_replace(coalesce(elem->>'value', '0'), '[^0-9.-]', '', 'g'), ''),
        '0'
      )::numeric as conv_value
    from jsonb_array_elements(b.actions) elem
  ) a
  where a.action_type is not null;

  create index mgr_conv_entries_group_key_idx on pg_temp.mgr_conv_entries (group_key);
  create index mgr_conv_entries_group_date_idx on pg_temp.mgr_conv_entries (group_key, date);

  -- conv_map: conversions agrupadas por grupo (para totais)
  drop table if exists pg_temp.mgr_conv_map;
  create temporary table pg_temp.mgr_conv_map on commit drop as
  select
    group_key,
    jsonb_object_agg(conv_key, conv_value order by conv_key) as conversions
  from (
    select group_key, conv_key, sum(conv_value)::numeric as conv_value
    from pg_temp.mgr_conv_entries
    group by group_key, conv_key
  ) sub
  group by group_key;

  -- conv_daily_map: conversions por dia (para sparklines)
  drop table if exists pg_temp.mgr_conv_daily_map;
  create temporary table pg_temp.mgr_conv_daily_map on commit drop as
  select
    group_key,
    date,
    jsonb_object_agg(conv_key, conv_value order by conv_key) as conversions
  from (
    select group_key, date, conv_key, sum(conv_value)::numeric as conv_value
    from pg_temp.mgr_conv_entries
    group by group_key, date, conv_key
  ) sub
  group by group_key, date;

  -- NOVO: índice para JOIN na geração de séries
  create index mgr_conv_daily_gk_date_idx on pg_temp.mgr_conv_daily_map (group_key, date);

  -- available_conversion_types
  select coalesce(jsonb_agg(t.conv_key order by t.conv_key), '[]'::jsonb)
    into v_available_conversion_types
  from (
    select distinct conv_key
    from pg_temp.mgr_conv_entries
  ) t;

  -- ═══════════════════════════════════════════════════════════════════
  -- mgr_daily: métricas diárias (com MQL calculado aqui, só janela de séries)
  -- ═══════════════════════════════════════════════════════════════════
  drop table if exists pg_temp.mgr_daily;
  create temporary table pg_temp.mgr_daily on commit drop as
  select
    b.group_key,
    b.date,
    sum(b.impressions)::bigint as impressions,
    sum(b.clicks)::bigint as clicks,
    sum(b.inline_link_clicks)::bigint as inline_link_clicks,
    sum(b.spend)::numeric as spend,
    sum(b.lpv)::bigint as lpv,
    sum(b.plays)::bigint as plays,
    sum(b.hook_value * b.plays)::numeric as hook_wsum,
    -- MQL: agora calculado aqui (só para linhas da janela de séries)
    sum(
      coalesce(
        (select count(*)::integer from unnest(b.leadscore_values) v where v >= v_mql_min),
        0
      )
    )::bigint as mql_count
  from pg_temp.mgr_base b
  where b.date >= v_axis_start
    and b.date <= v_date_stop
  group by b.group_key, b.date;

  create index mgr_daily_group_date_idx on pg_temp.mgr_daily (group_key, date);

  -- ═══════════════════════════════════════════════════════════════════
  -- mgr_status: OTIMIZADO — usa DISTINCT de mgr_base ao invés de unnest
  -- ═══════════════════════════════════════════════════════════════════
  drop table if exists pg_temp.mgr_status;
  create temporary table pg_temp.mgr_status on commit drop as
  with base_ads as (
    select distinct group_key, ad_id
    from pg_temp.mgr_base
  )
  select
    ba.group_key,
    bool_or(upper(coalesce(a.effective_status, '')) = 'ACTIVE') as has_active,
    count(distinct ba.ad_id) filter (where upper(coalesce(a.effective_status, '')) = 'ACTIVE')::integer as active_count,
    min(a.effective_status) filter (where nullif(a.effective_status, '') is not null) as fallback_status
  from base_ads ba
  left join public.ads a
    on a.user_id = p_user_id
   and a.ad_id = ba.ad_id
  group by ba.group_key;

  -- ═══════════════════════════════════════════════════════════════════
  -- mgr_rep_ads: thumbnail do anúncio representativo (sem alteração)
  -- ═══════════════════════════════════════════════════════════════════
  drop table if exists pg_temp.mgr_rep_ads;
  create temporary table pg_temp.mgr_rep_ads on commit drop as
  select
    g.group_key,
    a.effective_status as rep_status,
    coalesce(
      nullif(a.thumbnail_url, ''),
      nullif(a.adcreatives_videos_thumbs->>0, '')
    ) as thumbnail,
    a.adcreatives_videos_thumbs
  from pg_temp.mgr_group g
  left join public.ads a
    on a.user_id = p_user_id
   and a.ad_id = g.rep_ad_id;

  -- ═══════════════════════════════════════════════════════════════════
  -- mgr_leadscore: agregação de leadscore_values (sem alteração)
  -- ═══════════════════════════════════════════════════════════════════
  drop table if exists pg_temp.mgr_leadscore;
  create temporary table pg_temp.mgr_leadscore on commit drop as
  select
    b.group_key,
    array_agg(v)::numeric[] as leadscore_values
  from pg_temp.mgr_base b
  cross join lateral unnest(coalesce(b.leadscore_values, '{}'::numeric[])) v
  group by b.group_key;

  -- ═══════════════════════════════════════════════════════════════════
  -- mgr_curve: curva de vídeo ponderada (sem alteração)
  -- ═══════════════════════════════════════════════════════════════════
  drop table if exists pg_temp.mgr_curve_points;
  create temporary table pg_temp.mgr_curve_points on commit drop as
  select
    b.group_key,
    (cv.ord - 1)::integer as idx,
    sum(
      coalesce(
        nullif(regexp_replace(cv.val, '[^0-9.-]', '', 'g'), ''),
        '0'
      )::numeric * b.plays
    )::numeric as weighted_sum,
    sum(b.plays)::numeric as plays_sum
  from pg_temp.mgr_base b
  cross join lateral jsonb_array_elements_text(b.video_play_curve_actions) with ordinality as cv(val, ord)
  where b.plays > 0
  group by b.group_key, (cv.ord - 1);

  drop table if exists pg_temp.mgr_curve;
  create temporary table pg_temp.mgr_curve on commit drop as
  with mx as (
    select
      group_key,
      max(idx) as max_idx
    from pg_temp.mgr_curve_points
    group by group_key
  )
  select
    mx.group_key,
    jsonb_agg(
      coalesce(round(cp.weighted_sum / nullif(cp.plays_sum, 0))::int, 0)
      order by gs.idx
    ) as curve
  from mx
  cross join lateral generate_series(0, mx.max_idx) as gs(idx)
  left join pg_temp.mgr_curve_points cp
    on cp.group_key = mx.group_key
   and cp.idx = gs.idx
  group by mx.group_key;

  -- ═══════════════════════════════════════════════════════════════════
  -- mgr_series: OTIMIZADO — CROSS JOIN + jsonb_agg (era 12 subqueries per grupo)
  -- Antes: 5096 grupos × 12 subqueries = 61.152 subqueries (67s)
  -- Agora: 1 CROSS JOIN (5096 × 7 = 35.672 linhas) + GROUP BY (<1s)
  -- ═══════════════════════════════════════════════════════════════════
  drop table if exists pg_temp.mgr_series;
  if p_include_series then
    create temporary table pg_temp.mgr_series on commit drop as
    select
      g.group_key,
      jsonb_build_object(
        'axis',         jsonb_agg(to_char(a.d, 'YYYY-MM-DD') order by a.d),
        'hook',         jsonb_agg(case when coalesce(d.plays, 0) > 0 then d.hook_wsum / d.plays else null end order by a.d),
        'spend',        jsonb_agg(case when coalesce(d.spend, 0) <> 0 then d.spend else null end order by a.d),
        'ctr',          jsonb_agg(case when coalesce(d.impressions, 0) > 0 then d.clicks::numeric / d.impressions else null end order by a.d),
        'connect_rate', jsonb_agg(case when coalesce(d.inline_link_clicks, 0) > 0 then d.lpv::numeric / d.inline_link_clicks else null end order by a.d),
        'lpv',          jsonb_agg(coalesce(d.lpv, 0) order by a.d),
        'impressions',  jsonb_agg(case when coalesce(d.impressions, 0) <> 0 then d.impressions else null end order by a.d),
        'cpm',          jsonb_agg(case when coalesce(d.impressions, 0) > 0 then (d.spend * 1000.0) / d.impressions else null end order by a.d),
        'website_ctr',  jsonb_agg(case when coalesce(d.impressions, 0) > 0 then d.inline_link_clicks::numeric / d.impressions else null end order by a.d),
        'conversions',  jsonb_agg(coalesce(dc.conversions, '{}'::jsonb) order by a.d),
        'cpmql',        jsonb_agg(case when coalesce(d.mql_count, 0) > 0 and coalesce(d.spend, 0) > 0 then d.spend / d.mql_count else null end order by a.d),
        'mqls',         jsonb_agg(case when coalesce(d.mql_count, 0) > 0 then d.mql_count else null end order by a.d)
      ) as series
    from pg_temp.mgr_group g
    cross join pg_temp.mgr_axis a
    left join pg_temp.mgr_daily d
      on d.group_key = g.group_key
     and d.date = a.d
    left join pg_temp.mgr_conv_daily_map dc
      on dc.group_key = g.group_key
     and dc.date = a.d
    group by g.group_key;
  else
    create temporary table pg_temp.mgr_series (
      group_key text primary key,
      series jsonb
    ) on commit drop;
  end if;

  -- ═══════════════════════════════════════════════════════════════════
  -- Cálculo de médias globais (sem alteração)
  -- ═══════════════════════════════════════════════════════════════════
  select
    coalesce(sum(g.spend), 0),
    coalesce(sum(g.impressions), 0),
    coalesce(sum(g.clicks), 0),
    coalesce(sum(g.inline_link_clicks), 0),
    coalesce(sum(g.lpv), 0),
    coalesce(sum(g.plays), 0),
    coalesce(sum(g.hook_wsum), 0),
    coalesce(sum(g.hold_rate_wsum), 0),
    coalesce(sum(g.scroll_stop_wsum), 0)
    into
      v_total_spend,
      v_total_impressions,
      v_total_clicks,
      v_total_inline,
      v_total_lpv,
      v_total_plays,
      v_total_hook_wsum,
      v_total_hold_rate_wsum,
      v_total_scroll_stop_wsum
  from pg_temp.mgr_group g;

  select coalesce(
           jsonb_object_agg(
             c.conv_key,
             jsonb_build_object(
               'results', c.total_results,
               'cpr', case when c.total_results > 0 then v_total_spend / c.total_results else 0 end,
               'page_conv', case when v_total_lpv > 0 then c.total_results / v_total_lpv else 0 end
             )
             order by c.conv_key
           ),
           '{}'::jsonb
         )
    into v_per_action_type
  from (
    select
      conv_key,
      sum(conv_value)::numeric as total_results
    from pg_temp.mgr_conv_entries
    group by conv_key
  ) c;

  v_averages := jsonb_build_object(
    'hook', case when v_total_plays > 0 then v_total_hook_wsum / v_total_plays else 0 end,
    'hold_rate', case when v_total_plays > 0 then v_total_hold_rate_wsum / v_total_plays else 0 end,
    'scroll_stop', case when v_total_plays > 0 then v_total_scroll_stop_wsum / v_total_plays else 0 end,
    'ctr', case when v_total_impressions > 0 then v_total_clicks::numeric / v_total_impressions else 0 end,
    'website_ctr', case when v_total_impressions > 0 then v_total_inline::numeric / v_total_impressions else 0 end,
    'connect_rate', case when v_total_inline > 0 then v_total_lpv::numeric / v_total_inline else 0 end,
    'cpm', case when v_total_impressions > 0 then (v_total_spend * 1000.0) / v_total_impressions else 0 end,
    'per_action_type', v_per_action_type
  );

  -- ═══════════════════════════════════════════════════════════════════
  -- Montagem final do JSON (sem alteração no contrato de saída)
  -- ═══════════════════════════════════════════════════════════════════
  with items as (
    select
      g.group_key,
      g.account_id,
      g.campaign_id,
      g.campaign_name,
      g.adset_id,
      g.adset_name,
      g.rep_ad_id as ad_id,
      case
        when v_group_by = 'campaign_id' then coalesce(nullif(g.campaign_name, ''), g.group_key)
        when v_group_by = 'adset_id' then coalesce(nullif(g.adset_name, ''), g.group_key)
        else coalesce(nullif(g.rep_ad_name, ''), g.rep_ad_id)
      end as ad_name,
      case
        when st.has_active then 'ACTIVE'
        else coalesce(st.fallback_status, ra.rep_status)
      end as effective_status,
      case
        when v_group_by = 'campaign_id' then null
        else coalesce(st.active_count, 0)
      end as active_count,
      g.impressions,
      g.clicks,
      g.inline_link_clicks,
      g.spend,
      g.lpv,
      g.plays,
      g.thruplays as video_total_thruplays,
      case when g.plays > 0 then g.hook_wsum / g.plays else 0 end as hook,
      case when g.plays > 0 then g.hold_rate_wsum / g.plays else 0 end as hold_rate,
      round(case when g.plays > 0 then g.video_watched_p50_wsum / g.plays else 0 end)::int as video_watched_p50,
      case when g.impressions > 0 then g.clicks::numeric / g.impressions else 0 end as ctr,
      case when g.inline_link_clicks > 0 then g.lpv::numeric / g.inline_link_clicks else 0 end as connect_rate,
      case when g.impressions > 0 then (g.spend * 1000.0) / g.impressions else 0 end as cpm,
      case when g.impressions > 0 then g.inline_link_clicks::numeric / g.impressions else 0 end as website_ctr,
      g.reach,
      case when g.impressions > 0 then g.frequency_wsum / g.impressions else 0 end as frequency,
      case
        when p_include_leadscore then coalesce(ls.leadscore_values, array[]::numeric[])
        else array[]::numeric[]
      end as leadscore_values,
      coalesce(cm.conversions, '{}'::jsonb) as conversions,
      ra.thumbnail,
      ra.adcreatives_videos_thumbs,
      mc.curve as video_play_curve_actions,
      case when p_include_series then ms.series else null end as series,
      g.ad_count
    from pg_temp.mgr_group g
    left join pg_temp.mgr_status st using (group_key)
    left join pg_temp.mgr_rep_ads ra using (group_key)
    left join pg_temp.mgr_conv_map cm using (group_key)
    left join pg_temp.mgr_curve mc using (group_key)
    left join pg_temp.mgr_series ms using (group_key)
    left join pg_temp.mgr_leadscore ls using (group_key)
  ),
  ranked as (
    select
      row_number() over () as ord,
      jsonb_build_object(
        'unique_id', null,
        'account_id', i.account_id,
        'campaign_id', i.campaign_id,
        'campaign_name', i.campaign_name,
        'adset_id', i.adset_id,
        'adset_name', i.adset_name,
        'ad_id', i.ad_id,
        'ad_name', i.ad_name,
        'effective_status', i.effective_status,
        'active_count', i.active_count,
        'impressions', i.impressions,
        'clicks', i.clicks,
        'inline_link_clicks', i.inline_link_clicks,
        'spend', i.spend,
        'lpv', i.lpv,
        'plays', i.plays,
        'video_total_thruplays', i.video_total_thruplays,
        'hook', i.hook,
        'hold_rate', i.hold_rate,
        'video_watched_p50', i.video_watched_p50,
        'ctr', i.ctr,
        'connect_rate', i.connect_rate,
        'cpm', i.cpm,
        'website_ctr', i.website_ctr,
        'reach', i.reach,
        'frequency', i.frequency,
        'leadscore_values', i.leadscore_values,
        'conversions', i.conversions,
        'ad_count', i.ad_count,
        'thumbnail', i.thumbnail,
        'adcreatives_videos_thumbs', i.adcreatives_videos_thumbs,
        'video_play_curve_actions', i.video_play_curve_actions,
        'series', i.series
      ) as item_json
    from (
      select i.*
      from items i
      order by
        case when v_order_by = 'hook' then i.hook end desc nulls last,
        case when v_order_by = 'hold_rate' then i.hold_rate end desc nulls last,
        case when v_order_by = 'spend' then i.spend end desc nulls last,
        case when v_order_by = 'ctr' then i.ctr end desc nulls last,
        case when v_order_by = 'connect_rate' then i.connect_rate end desc nulls last,
        case when v_order_by = 'cpm' then i.cpm end desc nulls last,
        case when v_order_by = 'website_ctr' then i.website_ctr end desc nulls last,
        case when v_order_by not in ('hook', 'hold_rate', 'spend', 'ctr', 'connect_rate', 'cpm', 'website_ctr') then i.spend end desc nulls last,
        i.group_key
      limit greatest(1, coalesce(p_limit, 10000))
    ) i
  )
  select coalesce(jsonb_agg(r.item_json order by r.ord), '[]'::jsonb)
    into v_data
  from ranked r;

  return jsonb_build_object(
    'data', coalesce(v_data, '[]'::jsonb),
    'available_conversion_types', coalesce(v_available_conversion_types, '[]'::jsonb),
    'averages', coalesce(v_averages, '{}'::jsonb)
  );
end;
$$;


ALTER FUNCTION public.fetch_manager_analytics_aggregated_base_v047(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_include_series boolean, p_include_leadscore boolean, p_series_window integer, p_limit integer, p_order_by text) OWNER TO postgres;

--
-- Name: FUNCTION fetch_manager_analytics_aggregated_base_v047(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_include_series boolean, p_include_leadscore boolean, p_series_window integer, p_limit integer, p_order_by text); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.fetch_manager_analytics_aggregated_base_v047(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_include_series boolean, p_include_leadscore boolean, p_series_window integer, p_limit integer, p_order_by text) IS 'RPC otimizada do Manager v2: agrega métricas por group_by, séries via CROSS JOIN (sem subqueries correlacionadas), MQL calculado só na janela de séries.';


--
-- Name: fetch_manager_analytics_aggregated_base_v048(uuid, date, date, text, uuid[], text[], text, text, text, boolean, boolean, integer, integer, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.fetch_manager_analytics_aggregated_base_v048(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text DEFAULT 'ad_name'::text, p_pack_ids uuid[] DEFAULT NULL::uuid[], p_account_ids text[] DEFAULT NULL::text[], p_campaign_name_contains text DEFAULT NULL::text, p_adset_name_contains text DEFAULT NULL::text, p_ad_name_contains text DEFAULT NULL::text, p_include_series boolean DEFAULT true, p_include_leadscore boolean DEFAULT true, p_series_window integer DEFAULT 7, p_limit integer DEFAULT 10000, p_order_by text DEFAULT 'spend'::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_group_by text := lower(coalesce(p_group_by, 'ad_name'));
  v_order_by text := lower(coalesce(p_order_by, 'spend'));
  v_date_start date := least(p_date_start, p_date_stop);
  v_date_stop date := greatest(p_date_start, p_date_stop);
  v_series_window integer := greatest(1, coalesce(p_series_window, 7));
  v_axis_start date;
  v_mql_min numeric := 0;

  v_total_spend numeric := 0;
  v_total_impressions bigint := 0;
  v_total_clicks bigint := 0;
  v_total_inline bigint := 0;
  v_total_lpv bigint := 0;
  v_total_plays bigint := 0;
  v_total_hook_wsum numeric := 0;
  v_total_hold_rate_wsum numeric := 0;
  v_total_scroll_stop_wsum numeric := 0;

  v_available_conversion_types jsonb := '[]'::jsonb;
  v_per_action_type jsonb := '{}'::jsonb;
  v_averages jsonb := '{}'::jsonb;
  v_data jsonb := '[]'::jsonb;
begin
  if auth.uid() is distinct from p_user_id then
    raise exception 'Forbidden: p_user_id must match auth.uid()'
      using errcode = '42501';
  end if;

  if v_group_by not in ('ad_id', 'ad_name', 'adset_id', 'campaign_id') then
    raise exception 'Invalid p_group_by: %, expected ad_id|ad_name|adset_id|campaign_id', v_group_by
      using errcode = '22023';
  end if;

  select coalesce(up.mql_leadscore_min, 0)
    into v_mql_min
  from public.user_preferences up
  where up.user_id = p_user_id
  limit 1;

  v_mql_min := coalesce(v_mql_min, 0);
  v_axis_start := greatest(v_date_start, (v_date_stop - (v_series_window - 1)));

  -- ═══════════════════════════════════════════════════════════════════
  -- mgr_base: busca principal (SEM mql_count_row — movido para mgr_daily)
  -- ═══════════════════════════════════════════════════════════════════
  drop table if exists pg_temp.mgr_base;
  create temporary table pg_temp.mgr_base on commit drop as
  select
    case
      when v_group_by = 'ad_id' then am.ad_id
      when v_group_by = 'ad_name' then coalesce(nullif(am.ad_name, ''), am.ad_id)
      when v_group_by = 'adset_id' then am.adset_id
      when v_group_by = 'campaign_id' then am.campaign_id
      else am.ad_id
    end as group_key,
    am.account_id,
    am.campaign_id,
    am.campaign_name,
    am.adset_id,
    am.adset_name,
    am.ad_id,
    am.ad_name,
    am.date,
    coalesce(am.impressions, 0)::bigint as impressions,
    coalesce(am.clicks, 0)::bigint as clicks,
    coalesce(am.inline_link_clicks, 0)::bigint as inline_link_clicks,
    coalesce(am.spend, 0)::numeric as spend,
    coalesce(am.lpv, 0)::bigint as lpv,
    coalesce(am.video_total_plays, 0)::bigint as plays,
    coalesce(am.video_total_thruplays, 0)::bigint as thruplays,
    coalesce(am.video_watched_p50, 0)::numeric as video_watched_p50,
    coalesce(am.hold_rate, 0)::numeric as hold_rate,
    coalesce(am.reach, 0)::bigint as reach,
    coalesce(am.frequency, 0)::numeric as frequency,
    coalesce(am.leadscore_values, '{}'::numeric[]) as leadscore_values,
    case when jsonb_typeof(am.conversions) = 'array' then am.conversions else '[]'::jsonb end as conversions,
    case when jsonb_typeof(am.actions) = 'array' then am.actions else '[]'::jsonb end as actions,
    case when jsonb_typeof(am.video_play_curve_actions) = 'array' then am.video_play_curve_actions else '[]'::jsonb end as video_play_curve_actions,
    case
      when curve_vals.hook_raw > 1 then curve_vals.hook_raw / 100.0
      else curve_vals.hook_raw
    end as hook_value,
    case
      when curve_vals.scroll_stop_raw > 1 then curve_vals.scroll_stop_raw / 100.0
      else curve_vals.scroll_stop_raw
    end as scroll_stop_value
    -- REMOVIDO: mql_count_row (era unnest+count per-row em 13K+ linhas)
    -- Agora calculado apenas em mgr_daily, só para linhas da janela de séries
  from public.ad_metrics am
  left join lateral (
    select
      case
        when jsonb_typeof(am.video_play_curve_actions) = 'array'
         and jsonb_array_length(am.video_play_curve_actions) > 0
        then coalesce(
               nullif(
                 regexp_replace(
                   coalesce(
                     am.video_play_curve_actions ->> least(3, jsonb_array_length(am.video_play_curve_actions) - 1),
                     '0'
                   ),
                   '[^0-9.-]',
                   '',
                   'g'
                 ),
                 ''
               ),
               '0'
             )::numeric
        else 0::numeric
      end as hook_raw,
      case
        when jsonb_typeof(am.video_play_curve_actions) = 'array'
         and jsonb_array_length(am.video_play_curve_actions) > 0
        then coalesce(
               nullif(
                 regexp_replace(
                   coalesce(
                     am.video_play_curve_actions ->> least(1, jsonb_array_length(am.video_play_curve_actions) - 1),
                     '0'
                   ),
                   '[^0-9.-]',
                   '',
                   'g'
                 ),
                 ''
               ),
               '0'
             )::numeric
        else 0::numeric
      end as scroll_stop_raw
  ) as curve_vals on true
  where am.user_id = p_user_id
    and am.date >= v_date_start
    and am.date <= v_date_stop
    -- MIGRADO: dual-read — EXISTS em ad_metric_pack_map + fallback legado pack_ids[]
    and (
      p_pack_ids is null
      or exists (
        select 1 from public.ad_metric_pack_map apm
        where apm.user_id = am.user_id
          and apm.ad_id = am.ad_id
          and apm.metric_date = am.date
          and apm.pack_id = any(p_pack_ids)
      )
      or am.pack_ids && p_pack_ids
    )
    and (p_account_ids is null or am.account_id = any(p_account_ids))
    and (
      p_campaign_name_contains is null
      or p_campaign_name_contains = ''
      or coalesce(am.campaign_name, '') ilike '%' || p_campaign_name_contains || '%'
    )
    and (
      p_adset_name_contains is null
      or p_adset_name_contains = ''
      or coalesce(am.adset_name, '') ilike '%' || p_adset_name_contains || '%'
    )
    and (
      p_ad_name_contains is null
      or p_ad_name_contains = ''
      or coalesce(am.ad_name, '') ilike '%' || p_ad_name_contains || '%'
    );

  create index mgr_base_group_key_idx on pg_temp.mgr_base (group_key);
  create index mgr_base_date_idx on pg_temp.mgr_base (date);

  -- ═══════════════════════════════════════════════════════════════════
  -- mgr_axis: dias para sparklines
  -- ═══════════════════════════════════════════════════════════════════
  drop table if exists pg_temp.mgr_axis;
  create temporary table pg_temp.mgr_axis (
    d date not null
  ) on commit drop;

  insert into pg_temp.mgr_axis (d)
  select generate_series(v_axis_start, v_date_stop, interval '1 day')::date;

  -- ═══════════════════════════════════════════════════════════════════
  -- mgr_group: agrupamento principal (SEM array_agg de ad_ids)
  -- ═══════════════════════════════════════════════════════════════════
  drop table if exists pg_temp.mgr_group;
  create temporary table pg_temp.mgr_group on commit drop as
  with rep as (
    select distinct on (b.group_key)
      b.group_key,
      b.account_id,
      b.campaign_id,
      b.campaign_name,
      b.adset_id,
      b.adset_name,
      b.ad_id as rep_ad_id,
      b.ad_name as rep_ad_name
    from pg_temp.mgr_base b
    order by b.group_key, b.impressions desc, b.ad_id desc
  ),
  agg as (
    select
      b.group_key,
      sum(b.impressions)::bigint as impressions,
      sum(b.clicks)::bigint as clicks,
      sum(b.inline_link_clicks)::bigint as inline_link_clicks,
      sum(b.spend)::numeric as spend,
      sum(b.lpv)::bigint as lpv,
      sum(b.plays)::bigint as plays,
      sum(b.thruplays)::bigint as thruplays,
      sum(b.hook_value * b.plays)::numeric as hook_wsum,
      sum(b.hold_rate * b.plays)::numeric as hold_rate_wsum,
      sum(b.video_watched_p50 * b.plays)::numeric as video_watched_p50_wsum,
      sum(b.scroll_stop_value * b.plays)::numeric as scroll_stop_wsum,
      sum(b.reach)::bigint as reach,
      sum(b.frequency * b.impressions)::numeric as frequency_wsum,
      count(distinct b.ad_id)::integer as ad_id_count,
      count(distinct nullif(b.adset_id, ''))::integer as adset_count
      -- REMOVIDO: array_agg(distinct b.ad_id) (não mais necessário, status usa mgr_base)
    from pg_temp.mgr_base b
    group by b.group_key
  )
  select
    a.group_key,
    r.account_id,
    r.campaign_id,
    r.campaign_name,
    r.adset_id,
    r.adset_name,
    r.rep_ad_id,
    r.rep_ad_name,
    a.impressions,
    a.clicks,
    a.inline_link_clicks,
    a.spend,
    a.lpv,
    a.plays,
    a.thruplays,
    a.hook_wsum,
    a.hold_rate_wsum,
    a.video_watched_p50_wsum,
    a.scroll_stop_wsum,
    a.reach,
    a.frequency_wsum,
    case
      when v_group_by = 'campaign_id' then a.adset_count
      else a.ad_id_count
    end as ad_count
  from agg a
  join rep r using (group_key);

  create index mgr_group_group_key_idx on pg_temp.mgr_group (group_key);

  -- ═══════════════════════════════════════════════════════════════════
  -- conv_entries: expansão JSONB de conversions + actions
  -- ═══════════════════════════════════════════════════════════════════
  drop table if exists pg_temp.mgr_conv_entries;
  create temporary table pg_temp.mgr_conv_entries on commit drop as
  select
    b.group_key,
    b.date,
    'conversion:' || c.action_type as conv_key,
    c.conv_value
  from pg_temp.mgr_base b
  cross join lateral (
    select
      nullif(elem->>'action_type', '') as action_type,
      coalesce(
        nullif(regexp_replace(coalesce(elem->>'value', '0'), '[^0-9.-]', '', 'g'), ''),
        '0'
      )::numeric as conv_value
    from jsonb_array_elements(b.conversions) elem
  ) c
  where c.action_type is not null
  union all
  select
    b.group_key,
    b.date,
    'action:' || a.action_type as conv_key,
    a.conv_value
  from pg_temp.mgr_base b
  cross join lateral (
    select
      nullif(elem->>'action_type', '') as action_type,
      coalesce(
        nullif(regexp_replace(coalesce(elem->>'value', '0'), '[^0-9.-]', '', 'g'), ''),
        '0'
      )::numeric as conv_value
    from jsonb_array_elements(b.actions) elem
  ) a
  where a.action_type is not null;

  create index mgr_conv_entries_group_key_idx on pg_temp.mgr_conv_entries (group_key);
  create index mgr_conv_entries_group_date_idx on pg_temp.mgr_conv_entries (group_key, date);

  -- conv_map: conversions agrupadas por grupo (para totais)
  drop table if exists pg_temp.mgr_conv_map;
  create temporary table pg_temp.mgr_conv_map on commit drop as
  select
    group_key,
    jsonb_object_agg(conv_key, conv_value order by conv_key) as conversions
  from (
    select group_key, conv_key, sum(conv_value)::numeric as conv_value
    from pg_temp.mgr_conv_entries
    group by group_key, conv_key
  ) sub
  group by group_key;

  -- conv_daily_map: conversions por dia (para sparklines)
  drop table if exists pg_temp.mgr_conv_daily_map;
  create temporary table pg_temp.mgr_conv_daily_map on commit drop as
  select
    group_key,
    date,
    jsonb_object_agg(conv_key, conv_value order by conv_key) as conversions
  from (
    select group_key, date, conv_key, sum(conv_value)::numeric as conv_value
    from pg_temp.mgr_conv_entries
    group by group_key, date, conv_key
  ) sub
  group by group_key, date;

  -- NOVO: índice para JOIN na geração de séries
  create index mgr_conv_daily_gk_date_idx on pg_temp.mgr_conv_daily_map (group_key, date);

  -- available_conversion_types
  select coalesce(jsonb_agg(t.conv_key order by t.conv_key), '[]'::jsonb)
    into v_available_conversion_types
  from (
    select distinct conv_key
    from pg_temp.mgr_conv_entries
  ) t;

  -- ═══════════════════════════════════════════════════════════════════
  -- mgr_daily: métricas diárias (com MQL calculado aqui, só janela de séries)
  -- ═══════════════════════════════════════════════════════════════════
  drop table if exists pg_temp.mgr_daily;
  create temporary table pg_temp.mgr_daily on commit drop as
  select
    b.group_key,
    b.date,
    sum(b.impressions)::bigint as impressions,
    sum(b.clicks)::bigint as clicks,
    sum(b.inline_link_clicks)::bigint as inline_link_clicks,
    sum(b.spend)::numeric as spend,
    sum(b.lpv)::bigint as lpv,
    sum(b.plays)::bigint as plays,
    sum(b.hook_value * b.plays)::numeric as hook_wsum,
    -- MQL: agora calculado aqui (só para linhas da janela de séries)
    sum(
      coalesce(
        (select count(*)::integer from unnest(b.leadscore_values) v where v >= v_mql_min),
        0
      )
    )::bigint as mql_count
  from pg_temp.mgr_base b
  where b.date >= v_axis_start
    and b.date <= v_date_stop
  group by b.group_key, b.date;

  create index mgr_daily_group_date_idx on pg_temp.mgr_daily (group_key, date);

  -- ═══════════════════════════════════════════════════════════════════
  -- mgr_status: OTIMIZADO — usa DISTINCT de mgr_base ao invés de unnest
  -- ═══════════════════════════════════════════════════════════════════
  drop table if exists pg_temp.mgr_status;
  create temporary table pg_temp.mgr_status on commit drop as
  with base_ads as (
    select distinct group_key, ad_id
    from pg_temp.mgr_base
  )
  select
    ba.group_key,
    bool_or(upper(coalesce(a.effective_status, '')) = 'ACTIVE') as has_active,
    count(distinct ba.ad_id) filter (where upper(coalesce(a.effective_status, '')) = 'ACTIVE')::integer as active_count,
    min(a.effective_status) filter (where nullif(a.effective_status, '') is not null) as fallback_status
  from base_ads ba
  left join public.ads a
    on a.user_id = p_user_id
   and a.ad_id = ba.ad_id
  group by ba.group_key;

  -- ═══════════════════════════════════════════════════════════════════
  -- mgr_rep_ads: thumbnail do anúncio representativo (sem alteração)
  -- ═══════════════════════════════════════════════════════════════════
  drop table if exists pg_temp.mgr_rep_ads;
  create temporary table pg_temp.mgr_rep_ads on commit drop as
  select
    g.group_key,
    a.effective_status as rep_status,
    coalesce(
      nullif(a.thumbnail_url, ''),
      nullif(a.adcreatives_videos_thumbs->>0, '')
    ) as thumbnail,
    a.adcreatives_videos_thumbs
  from pg_temp.mgr_group g
  left join public.ads a
    on a.user_id = p_user_id
   and a.ad_id = g.rep_ad_id;

  -- ═══════════════════════════════════════════════════════════════════
  -- mgr_leadscore: agregação de leadscore_values (sem alteração)
  -- ═══════════════════════════════════════════════════════════════════
  drop table if exists pg_temp.mgr_leadscore;
  create temporary table pg_temp.mgr_leadscore on commit drop as
  select
    b.group_key,
    array_agg(v)::numeric[] as leadscore_values
  from pg_temp.mgr_base b
  cross join lateral unnest(coalesce(b.leadscore_values, '{}'::numeric[])) v
  group by b.group_key;

  -- ═══════════════════════════════════════════════════════════════════
  -- mgr_curve: curva de vídeo ponderada (sem alteração)
  -- ═══════════════════════════════════════════════════════════════════
  drop table if exists pg_temp.mgr_curve_points;
  create temporary table pg_temp.mgr_curve_points on commit drop as
  select
    b.group_key,
    (cv.ord - 1)::integer as idx,
    sum(
      coalesce(
        nullif(regexp_replace(cv.val, '[^0-9.-]', '', 'g'), ''),
        '0'
      )::numeric * b.plays
    )::numeric as weighted_sum,
    sum(b.plays)::numeric as plays_sum
  from pg_temp.mgr_base b
  cross join lateral jsonb_array_elements_text(b.video_play_curve_actions) with ordinality as cv(val, ord)
  where b.plays > 0
  group by b.group_key, (cv.ord - 1);

  drop table if exists pg_temp.mgr_curve;
  create temporary table pg_temp.mgr_curve on commit drop as
  with mx as (
    select
      group_key,
      max(idx) as max_idx
    from pg_temp.mgr_curve_points
    group by group_key
  )
  select
    mx.group_key,
    jsonb_agg(
      coalesce(round(cp.weighted_sum / nullif(cp.plays_sum, 0))::int, 0)
      order by gs.idx
    ) as curve
  from mx
  cross join lateral generate_series(0, mx.max_idx) as gs(idx)
  left join pg_temp.mgr_curve_points cp
    on cp.group_key = mx.group_key
   and cp.idx = gs.idx
  group by mx.group_key;

  -- ═══════════════════════════════════════════════════════════════════
  -- mgr_series: OTIMIZADO — CROSS JOIN + jsonb_agg (era 12 subqueries per grupo)
  -- Antes: 5096 grupos × 12 subqueries = 61.152 subqueries (67s)
  -- Agora: 1 CROSS JOIN (5096 × 7 = 35.672 linhas) + GROUP BY (<1s)
  -- ═══════════════════════════════════════════════════════════════════
  drop table if exists pg_temp.mgr_series;
  if p_include_series then
    create temporary table pg_temp.mgr_series on commit drop as
    select
      g.group_key,
      jsonb_build_object(
        'axis',         jsonb_agg(to_char(a.d, 'YYYY-MM-DD') order by a.d),
        'hook',         jsonb_agg(case when coalesce(d.plays, 0) > 0 then d.hook_wsum / d.plays else null end order by a.d),
        'spend',        jsonb_agg(case when coalesce(d.spend, 0) <> 0 then d.spend else null end order by a.d),
        'ctr',          jsonb_agg(case when coalesce(d.impressions, 0) > 0 then d.clicks::numeric / d.impressions else null end order by a.d),
        'connect_rate', jsonb_agg(case when coalesce(d.inline_link_clicks, 0) > 0 then d.lpv::numeric / d.inline_link_clicks else null end order by a.d),
        'lpv',          jsonb_agg(coalesce(d.lpv, 0) order by a.d),
        'impressions',  jsonb_agg(case when coalesce(d.impressions, 0) <> 0 then d.impressions else null end order by a.d),
        'cpm',          jsonb_agg(case when coalesce(d.impressions, 0) > 0 then (d.spend * 1000.0) / d.impressions else null end order by a.d),
        'website_ctr',  jsonb_agg(case when coalesce(d.impressions, 0) > 0 then d.inline_link_clicks::numeric / d.impressions else null end order by a.d),
        'conversions',  jsonb_agg(coalesce(dc.conversions, '{}'::jsonb) order by a.d),
        'cpmql',        jsonb_agg(case when coalesce(d.mql_count, 0) > 0 and coalesce(d.spend, 0) > 0 then d.spend / d.mql_count else null end order by a.d),
        'mqls',         jsonb_agg(case when coalesce(d.mql_count, 0) > 0 then d.mql_count else null end order by a.d)
      ) as series
    from pg_temp.mgr_group g
    cross join pg_temp.mgr_axis a
    left join pg_temp.mgr_daily d
      on d.group_key = g.group_key
     and d.date = a.d
    left join pg_temp.mgr_conv_daily_map dc
      on dc.group_key = g.group_key
     and dc.date = a.d
    group by g.group_key;
  else
    create temporary table pg_temp.mgr_series (
      group_key text primary key,
      series jsonb
    ) on commit drop;
  end if;

  -- ═══════════════════════════════════════════════════════════════════
  -- Cálculo de médias globais (sem alteração)
  -- ═══════════════════════════════════════════════════════════════════
  select
    coalesce(sum(g.spend), 0),
    coalesce(sum(g.impressions), 0),
    coalesce(sum(g.clicks), 0),
    coalesce(sum(g.inline_link_clicks), 0),
    coalesce(sum(g.lpv), 0),
    coalesce(sum(g.plays), 0),
    coalesce(sum(g.hook_wsum), 0),
    coalesce(sum(g.hold_rate_wsum), 0),
    coalesce(sum(g.scroll_stop_wsum), 0)
    into
      v_total_spend,
      v_total_impressions,
      v_total_clicks,
      v_total_inline,
      v_total_lpv,
      v_total_plays,
      v_total_hook_wsum,
      v_total_hold_rate_wsum,
      v_total_scroll_stop_wsum
  from pg_temp.mgr_group g;

  select coalesce(
           jsonb_object_agg(
             c.conv_key,
             jsonb_build_object(
               'results', c.total_results,
               'cpr', case when c.total_results > 0 then v_total_spend / c.total_results else 0 end,
               'page_conv', case when v_total_lpv > 0 then c.total_results / v_total_lpv else 0 end
             )
             order by c.conv_key
           ),
           '{}'::jsonb
         )
    into v_per_action_type
  from (
    select
      conv_key,
      sum(conv_value)::numeric as total_results
    from pg_temp.mgr_conv_entries
    group by conv_key
  ) c;

  v_averages := jsonb_build_object(
    'hook', case when v_total_plays > 0 then v_total_hook_wsum / v_total_plays else 0 end,
    'hold_rate', case when v_total_plays > 0 then v_total_hold_rate_wsum / v_total_plays else 0 end,
    'scroll_stop', case when v_total_plays > 0 then v_total_scroll_stop_wsum / v_total_plays else 0 end,
    'ctr', case when v_total_impressions > 0 then v_total_clicks::numeric / v_total_impressions else 0 end,
    'website_ctr', case when v_total_impressions > 0 then v_total_inline::numeric / v_total_impressions else 0 end,
    'connect_rate', case when v_total_inline > 0 then v_total_lpv::numeric / v_total_inline else 0 end,
    'cpm', case when v_total_impressions > 0 then (v_total_spend * 1000.0) / v_total_impressions else 0 end,
    'per_action_type', v_per_action_type
  );

  -- ═══════════════════════════════════════════════════════════════════
  -- Montagem final do JSON (sem alteração no contrato de saída)
  -- ═══════════════════════════════════════════════════════════════════
  with items as (
    select
      g.group_key,
      g.account_id,
      g.campaign_id,
      g.campaign_name,
      g.adset_id,
      g.adset_name,
      g.rep_ad_id as ad_id,
      case
        when v_group_by = 'campaign_id' then coalesce(nullif(g.campaign_name, ''), g.group_key)
        when v_group_by = 'adset_id' then coalesce(nullif(g.adset_name, ''), g.group_key)
        else coalesce(nullif(g.rep_ad_name, ''), g.rep_ad_id)
      end as ad_name,
      case
        when st.has_active then 'ACTIVE'
        else coalesce(st.fallback_status, ra.rep_status)
      end as effective_status,
      case
        when v_group_by = 'campaign_id' then null
        else coalesce(st.active_count, 0)
      end as active_count,
      g.impressions,
      g.clicks,
      g.inline_link_clicks,
      g.spend,
      g.lpv,
      g.plays,
      g.thruplays as video_total_thruplays,
      case when g.plays > 0 then g.hook_wsum / g.plays else 0 end as hook,
      case when g.plays > 0 then g.hold_rate_wsum / g.plays else 0 end as hold_rate,
      round(case when g.plays > 0 then g.video_watched_p50_wsum / g.plays else 0 end)::int as video_watched_p50,
      case when g.impressions > 0 then g.clicks::numeric / g.impressions else 0 end as ctr,
      case when g.inline_link_clicks > 0 then g.lpv::numeric / g.inline_link_clicks else 0 end as connect_rate,
      case when g.impressions > 0 then (g.spend * 1000.0) / g.impressions else 0 end as cpm,
      case when g.impressions > 0 then g.inline_link_clicks::numeric / g.impressions else 0 end as website_ctr,
      g.reach,
      case when g.impressions > 0 then g.frequency_wsum / g.impressions else 0 end as frequency,
      case
        when p_include_leadscore then coalesce(ls.leadscore_values, array[]::numeric[])
        else array[]::numeric[]
      end as leadscore_values,
      coalesce(cm.conversions, '{}'::jsonb) as conversions,
      ra.thumbnail,
      ra.adcreatives_videos_thumbs,
      mc.curve as video_play_curve_actions,
      case when p_include_series then ms.series else null end as series,
      g.ad_count
    from pg_temp.mgr_group g
    left join pg_temp.mgr_status st using (group_key)
    left join pg_temp.mgr_rep_ads ra using (group_key)
    left join pg_temp.mgr_conv_map cm using (group_key)
    left join pg_temp.mgr_curve mc using (group_key)
    left join pg_temp.mgr_series ms using (group_key)
    left join pg_temp.mgr_leadscore ls using (group_key)
  ),
  ranked as (
    select
      row_number() over () as ord,
      jsonb_build_object(
        'unique_id', null,
        'account_id', i.account_id,
        'campaign_id', i.campaign_id,
        'campaign_name', i.campaign_name,
        'adset_id', i.adset_id,
        'adset_name', i.adset_name,
        'ad_id', i.ad_id,
        'ad_name', i.ad_name,
        'effective_status', i.effective_status,
        'active_count', i.active_count,
        'impressions', i.impressions,
        'clicks', i.clicks,
        'inline_link_clicks', i.inline_link_clicks,
        'spend', i.spend,
        'lpv', i.lpv,
        'plays', i.plays,
        'video_total_thruplays', i.video_total_thruplays,
        'hook', i.hook,
        'hold_rate', i.hold_rate,
        'video_watched_p50', i.video_watched_p50,
        'ctr', i.ctr,
        'connect_rate', i.connect_rate,
        'cpm', i.cpm,
        'website_ctr', i.website_ctr,
        'reach', i.reach,
        'frequency', i.frequency,
        'leadscore_values', i.leadscore_values,
        'conversions', i.conversions,
        'ad_count', i.ad_count,
        'thumbnail', i.thumbnail,
        'adcreatives_videos_thumbs', i.adcreatives_videos_thumbs,
        'video_play_curve_actions', i.video_play_curve_actions,
        'series', i.series
      ) as item_json
    from (
      select i.*
      from items i
      order by
        case when v_order_by = 'hook' then i.hook end desc nulls last,
        case when v_order_by = 'hold_rate' then i.hold_rate end desc nulls last,
        case when v_order_by = 'spend' then i.spend end desc nulls last,
        case when v_order_by = 'ctr' then i.ctr end desc nulls last,
        case when v_order_by = 'connect_rate' then i.connect_rate end desc nulls last,
        case when v_order_by = 'cpm' then i.cpm end desc nulls last,
        case when v_order_by = 'website_ctr' then i.website_ctr end desc nulls last,
        case when v_order_by not in ('hook', 'hold_rate', 'spend', 'ctr', 'connect_rate', 'cpm', 'website_ctr') then i.spend end desc nulls last,
        i.group_key
      limit greatest(1, coalesce(p_limit, 10000))
    ) i
  )
  select coalesce(jsonb_agg(r.item_json order by r.ord), '[]'::jsonb)
    into v_data
  from ranked r;

  return jsonb_build_object(
    'data', coalesce(v_data, '[]'::jsonb),
    'available_conversion_types', coalesce(v_available_conversion_types, '[]'::jsonb),
    'averages', coalesce(v_averages, '{}'::jsonb)
  );
end;
$$;


ALTER FUNCTION public.fetch_manager_analytics_aggregated_base_v048(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_include_series boolean, p_include_leadscore boolean, p_series_window integer, p_limit integer, p_order_by text) OWNER TO postgres;

--
-- Name: FUNCTION fetch_manager_analytics_aggregated_base_v048(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_include_series boolean, p_include_leadscore boolean, p_series_window integer, p_limit integer, p_order_by text); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.fetch_manager_analytics_aggregated_base_v048(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_include_series boolean, p_include_leadscore boolean, p_series_window integer, p_limit integer, p_order_by text) IS 'Manager aggregated base v048: mesmo que _v047 mas com dual-read (EXISTS em ad_metric_pack_map + OR fallback pack_ids[]).';


--
-- Name: fetch_manager_analytics_aggregated_base_v049(uuid, date, date, text, uuid[], text[], text, text, text, boolean, boolean, integer, integer, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.fetch_manager_analytics_aggregated_base_v049(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text DEFAULT 'ad_name'::text, p_pack_ids uuid[] DEFAULT NULL::uuid[], p_account_ids text[] DEFAULT NULL::text[], p_campaign_name_contains text DEFAULT NULL::text, p_adset_name_contains text DEFAULT NULL::text, p_ad_name_contains text DEFAULT NULL::text, p_include_series boolean DEFAULT true, p_include_leadscore boolean DEFAULT true, p_series_window integer DEFAULT 7, p_limit integer DEFAULT 10000, p_order_by text DEFAULT 'spend'::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_group_by text := lower(coalesce(p_group_by, 'ad_name'));
  v_order_by text := lower(coalesce(p_order_by, 'spend'));
  v_date_start date := least(p_date_start, p_date_stop);
  v_date_stop date := greatest(p_date_start, p_date_stop);
  v_series_window integer := greatest(1, coalesce(p_series_window, 7));
  v_axis_start date;
  v_mql_min numeric := 0;

  v_total_spend numeric := 0;
  v_total_impressions bigint := 0;
  v_total_clicks bigint := 0;
  v_total_inline bigint := 0;
  v_total_lpv bigint := 0;
  v_total_plays bigint := 0;
  v_total_hook_wsum numeric := 0;
  v_total_hold_rate_wsum numeric := 0;
  v_total_scroll_stop_wsum numeric := 0;

  v_available_conversion_types jsonb := '[]'::jsonb;
  v_per_action_type jsonb := '{}'::jsonb;
  v_averages jsonb := '{}'::jsonb;
  v_data jsonb := '[]'::jsonb;
begin
  if auth.uid() is distinct from p_user_id then
    raise exception 'Forbidden: p_user_id must match auth.uid()'
      using errcode = '42501';
  end if;

  if v_group_by not in ('ad_id', 'ad_name', 'adset_id', 'campaign_id') then
    raise exception 'Invalid p_group_by: %, expected ad_id|ad_name|adset_id|campaign_id', v_group_by
      using errcode = '22023';
  end if;

  select coalesce(up.mql_leadscore_min, 0)
    into v_mql_min
  from public.user_preferences up
  where up.user_id = p_user_id
  limit 1;

  v_mql_min := coalesce(v_mql_min, 0);
  v_axis_start := greatest(v_date_start, (v_date_stop - (v_series_window - 1)));

  -- ═══════════════════════════════════════════════════════════════════
  -- mgr_base: busca principal (SEM mql_count_row — movido para mgr_daily)
  -- ═══════════════════════════════════════════════════════════════════
  drop table if exists pg_temp.mgr_base;
  create temporary table pg_temp.mgr_base on commit drop as
  select
    case
      when v_group_by = 'ad_id' then am.ad_id
      when v_group_by = 'ad_name' then coalesce(nullif(am.ad_name, ''), am.ad_id)
      when v_group_by = 'adset_id' then am.adset_id
      when v_group_by = 'campaign_id' then am.campaign_id
      else am.ad_id
    end as group_key,
    am.account_id,
    am.campaign_id,
    am.campaign_name,
    am.adset_id,
    am.adset_name,
    am.ad_id,
    am.ad_name,
    am.date,
    coalesce(am.impressions, 0)::bigint as impressions,
    coalesce(am.clicks, 0)::bigint as clicks,
    coalesce(am.inline_link_clicks, 0)::bigint as inline_link_clicks,
    coalesce(am.spend, 0)::numeric as spend,
    coalesce(am.lpv, 0)::bigint as lpv,
    coalesce(am.video_total_plays, 0)::bigint as plays,
    coalesce(am.video_total_thruplays, 0)::bigint as thruplays,
    coalesce(am.video_watched_p50, 0)::numeric as video_watched_p50,
    coalesce(am.hold_rate, 0)::numeric as hold_rate,
    coalesce(am.reach, 0)::bigint as reach,
    coalesce(am.frequency, 0)::numeric as frequency,
    coalesce(am.leadscore_values, '{}'::numeric[]) as leadscore_values,
    case when jsonb_typeof(am.conversions) = 'array' then am.conversions else '[]'::jsonb end as conversions,
    case when jsonb_typeof(am.actions) = 'array' then am.actions else '[]'::jsonb end as actions,
    case when jsonb_typeof(am.video_play_curve_actions) = 'array' then am.video_play_curve_actions else '[]'::jsonb end as video_play_curve_actions,
    case
      when curve_vals.hook_raw > 1 then curve_vals.hook_raw / 100.0
      else curve_vals.hook_raw
    end as hook_value,
    case
      when curve_vals.scroll_stop_raw > 1 then curve_vals.scroll_stop_raw / 100.0
      else curve_vals.scroll_stop_raw
    end as scroll_stop_value
  from public.ad_metrics am
  left join lateral (
    select
      case
        when jsonb_typeof(am.video_play_curve_actions) = 'array'
         and jsonb_array_length(am.video_play_curve_actions) > 0
        then coalesce(
               nullif(
                 regexp_replace(
                   coalesce(
                     am.video_play_curve_actions ->> least(3, jsonb_array_length(am.video_play_curve_actions) - 1),
                     '0'
                   ),
                   '[^0-9.-]',
                   '',
                   'g'
                 ),
                 ''
               ),
               '0'
             )::numeric
        else 0::numeric
      end as hook_raw,
      case
        when jsonb_typeof(am.video_play_curve_actions) = 'array'
         and jsonb_array_length(am.video_play_curve_actions) > 0
        then coalesce(
               nullif(
                 regexp_replace(
                   coalesce(
                     am.video_play_curve_actions ->> least(1, jsonb_array_length(am.video_play_curve_actions) - 1),
                     '0'
                   ),
                   '[^0-9.-]',
                   '',
                   'g'
                 ),
                 ''
               ),
               '0'
             )::numeric
        else 0::numeric
      end as scroll_stop_raw
  ) as curve_vals on true
  where am.user_id = p_user_id
    and am.date >= v_date_start
    and am.date <= v_date_stop
    and (
      p_pack_ids is null
      or exists (
        select 1 from public.ad_metric_pack_map apm
        where apm.user_id = am.user_id
          and apm.ad_id = am.ad_id
          and apm.metric_date = am.date
          and apm.pack_id = any(p_pack_ids)
      )
    )
    and (p_account_ids is null or am.account_id = any(p_account_ids))
    and (
      p_campaign_name_contains is null
      or p_campaign_name_contains = ''
      or coalesce(am.campaign_name, '') ilike '%' || p_campaign_name_contains || '%'
    )
    and (
      p_adset_name_contains is null
      or p_adset_name_contains = ''
      or coalesce(am.adset_name, '') ilike '%' || p_adset_name_contains || '%'
    )
    and (
      p_ad_name_contains is null
      or p_ad_name_contains = ''
      or coalesce(am.ad_name, '') ilike '%' || p_ad_name_contains || '%'
    );

  create index mgr_base_group_key_idx on pg_temp.mgr_base (group_key);
  create index mgr_base_date_idx on pg_temp.mgr_base (date);

  -- ═══════════════════════════════════════════════════════════════════
  -- mgr_axis: dias para sparklines
  -- ═══════════════════════════════════════════════════════════════════
  drop table if exists pg_temp.mgr_axis;
  create temporary table pg_temp.mgr_axis (
    d date not null
  ) on commit drop;

  insert into pg_temp.mgr_axis (d)
  select generate_series(v_axis_start, v_date_stop, interval '1 day')::date;

  -- ═══════════════════════════════════════════════════════════════════
  -- mgr_group: agrupamento principal (SEM array_agg de ad_ids)
  -- ═══════════════════════════════════════════════════════════════════
  drop table if exists pg_temp.mgr_group;
  create temporary table pg_temp.mgr_group on commit drop as
  with rep as (
    select distinct on (b.group_key)
      b.group_key,
      b.account_id,
      b.campaign_id,
      b.campaign_name,
      b.adset_id,
      b.adset_name,
      b.ad_id as rep_ad_id,
      b.ad_name as rep_ad_name
    from pg_temp.mgr_base b
    order by b.group_key, b.impressions desc, b.ad_id desc
  ),
  agg as (
    select
      b.group_key,
      sum(b.impressions)::bigint as impressions,
      sum(b.clicks)::bigint as clicks,
      sum(b.inline_link_clicks)::bigint as inline_link_clicks,
      sum(b.spend)::numeric as spend,
      sum(b.lpv)::bigint as lpv,
      sum(b.plays)::bigint as plays,
      sum(b.thruplays)::bigint as thruplays,
      sum(b.hook_value * b.plays)::numeric as hook_wsum,
      sum(b.hold_rate * b.plays)::numeric as hold_rate_wsum,
      sum(b.video_watched_p50 * b.plays)::numeric as video_watched_p50_wsum,
      sum(b.scroll_stop_value * b.plays)::numeric as scroll_stop_wsum,
      sum(b.reach)::bigint as reach,
      sum(b.frequency * b.impressions)::numeric as frequency_wsum,
      count(distinct b.ad_id)::integer as ad_id_count,
      count(distinct nullif(b.adset_id, ''))::integer as adset_count
    from pg_temp.mgr_base b
    group by b.group_key
  )
  select
    a.group_key,
    r.account_id,
    r.campaign_id,
    r.campaign_name,
    r.adset_id,
    r.adset_name,
    r.rep_ad_id,
    r.rep_ad_name,
    a.impressions,
    a.clicks,
    a.inline_link_clicks,
    a.spend,
    a.lpv,
    a.plays,
    a.thruplays,
    a.hook_wsum,
    a.hold_rate_wsum,
    a.video_watched_p50_wsum,
    a.scroll_stop_wsum,
    a.reach,
    a.frequency_wsum,
    case
      when v_group_by = 'campaign_id' then a.adset_count
      else a.ad_id_count
    end as ad_count
  from agg a
  join rep r using (group_key);

  create index mgr_group_group_key_idx on pg_temp.mgr_group (group_key);

  -- ═══════════════════════════════════════════════════════════════════
  -- conv_entries: expansão JSONB de conversions + actions
  -- ═══════════════════════════════════════════════════════════════════
  drop table if exists pg_temp.mgr_conv_entries;
  create temporary table pg_temp.mgr_conv_entries on commit drop as
  select
    b.group_key,
    b.date,
    'conversion:' || c.action_type as conv_key,
    c.conv_value
  from pg_temp.mgr_base b
  cross join lateral (
    select
      nullif(elem->>'action_type', '') as action_type,
      coalesce(
        nullif(regexp_replace(coalesce(elem->>'value', '0'), '[^0-9.-]', '', 'g'), ''),
        '0'
      )::numeric as conv_value
    from jsonb_array_elements(b.conversions) elem
  ) c
  where c.action_type is not null
  union all
  select
    b.group_key,
    b.date,
    'action:' || a.action_type as conv_key,
    a.conv_value
  from pg_temp.mgr_base b
  cross join lateral (
    select
      nullif(elem->>'action_type', '') as action_type,
      coalesce(
        nullif(regexp_replace(coalesce(elem->>'value', '0'), '[^0-9.-]', '', 'g'), ''),
        '0'
      )::numeric as conv_value
    from jsonb_array_elements(b.actions) elem
  ) a
  where a.action_type is not null;

  create index mgr_conv_entries_group_key_idx on pg_temp.mgr_conv_entries (group_key);
  create index mgr_conv_entries_group_date_idx on pg_temp.mgr_conv_entries (group_key, date);

  -- conv_map: conversions agrupadas por grupo (para totais)
  drop table if exists pg_temp.mgr_conv_map;
  create temporary table pg_temp.mgr_conv_map on commit drop as
  select
    group_key,
    jsonb_object_agg(conv_key, conv_value order by conv_key) as conversions
  from (
    select group_key, conv_key, sum(conv_value)::numeric as conv_value
    from pg_temp.mgr_conv_entries
    group by group_key, conv_key
  ) sub
  group by group_key;

  -- conv_daily_map: conversions por dia (para sparklines)
  drop table if exists pg_temp.mgr_conv_daily_map;
  create temporary table pg_temp.mgr_conv_daily_map on commit drop as
  select
    group_key,
    date,
    jsonb_object_agg(conv_key, conv_value order by conv_key) as conversions
  from (
    select group_key, date, conv_key, sum(conv_value)::numeric as conv_value
    from pg_temp.mgr_conv_entries
    group by group_key, date, conv_key
  ) sub
  group by group_key, date;

  create index mgr_conv_daily_gk_date_idx on pg_temp.mgr_conv_daily_map (group_key, date);

  -- available_conversion_types
  select coalesce(jsonb_agg(t.conv_key order by t.conv_key), '[]'::jsonb)
    into v_available_conversion_types
  from (
    select distinct conv_key
    from pg_temp.mgr_conv_entries
  ) t;

  -- ═══════════════════════════════════════════════════════════════════
  -- mgr_daily: métricas diárias (com MQL calculado aqui, só janela de séries)
  -- ═══════════════════════════════════════════════════════════════════
  drop table if exists pg_temp.mgr_daily;
  create temporary table pg_temp.mgr_daily on commit drop as
  select
    b.group_key,
    b.date,
    sum(b.impressions)::bigint as impressions,
    sum(b.clicks)::bigint as clicks,
    sum(b.inline_link_clicks)::bigint as inline_link_clicks,
    sum(b.spend)::numeric as spend,
    sum(b.lpv)::bigint as lpv,
    sum(b.plays)::bigint as plays,
    sum(b.hook_value * b.plays)::numeric as hook_wsum,
    sum(
      coalesce(
        (select count(*)::integer from unnest(b.leadscore_values) v where v >= v_mql_min),
        0
      )
    )::bigint as mql_count
  from pg_temp.mgr_base b
  where b.date >= v_axis_start
    and b.date <= v_date_stop
  group by b.group_key, b.date;

  create index mgr_daily_group_date_idx on pg_temp.mgr_daily (group_key, date);

  -- ═══════════════════════════════════════════════════════════════════
  -- mgr_status: usa DISTINCT de mgr_base ao invés de unnest
  -- ═══════════════════════════════════════════════════════════════════
  drop table if exists pg_temp.mgr_status;
  create temporary table pg_temp.mgr_status on commit drop as
  with base_ads as (
    select distinct group_key, ad_id
    from pg_temp.mgr_base
  )
  select
    ba.group_key,
    bool_or(upper(coalesce(a.effective_status, '')) = 'ACTIVE') as has_active,
    count(distinct ba.ad_id) filter (where upper(coalesce(a.effective_status, '')) = 'ACTIVE')::integer as active_count,
    min(a.effective_status) filter (where nullif(a.effective_status, '') is not null) as fallback_status
  from base_ads ba
  left join public.ads a
    on a.user_id = p_user_id
   and a.ad_id = ba.ad_id
  group by ba.group_key;

  -- ═══════════════════════════════════════════════════════════════════
  -- mgr_rep_ads: thumbnail do anúncio representativo
  -- ═══════════════════════════════════════════════════════════════════
  drop table if exists pg_temp.mgr_rep_ads;
  create temporary table pg_temp.mgr_rep_ads on commit drop as
  select
    g.group_key,
    a.effective_status as rep_status,
    coalesce(
      nullif(a.thumbnail_url, ''),
      nullif(a.adcreatives_videos_thumbs->>0, '')
    ) as thumbnail,
    a.adcreatives_videos_thumbs
  from pg_temp.mgr_group g
  left join public.ads a
    on a.user_id = p_user_id
   and a.ad_id = g.rep_ad_id;

  -- ═══════════════════════════════════════════════════════════════════
  -- mgr_leadscore: agregação de leadscore_values
  -- ═══════════════════════════════════════════════════════════════════
  drop table if exists pg_temp.mgr_leadscore;
  create temporary table pg_temp.mgr_leadscore on commit drop as
  select
    b.group_key,
    array_agg(v)::numeric[] as leadscore_values
  from pg_temp.mgr_base b
  cross join lateral unnest(coalesce(b.leadscore_values, '{}'::numeric[])) v
  group by b.group_key;

  -- ═══════════════════════════════════════════════════════════════════
  -- mgr_curve: curva de vídeo ponderada
  -- ═══════════════════════════════════════════════════════════════════
  drop table if exists pg_temp.mgr_curve_points;
  create temporary table pg_temp.mgr_curve_points on commit drop as
  select
    b.group_key,
    (cv.ord - 1)::integer as idx,
    sum(
      coalesce(
        nullif(regexp_replace(cv.val, '[^0-9.-]', '', 'g'), ''),
        '0'
      )::numeric * b.plays
    )::numeric as weighted_sum,
    sum(b.plays)::numeric as plays_sum
  from pg_temp.mgr_base b
  cross join lateral jsonb_array_elements_text(b.video_play_curve_actions) with ordinality as cv(val, ord)
  where b.plays > 0
  group by b.group_key, (cv.ord - 1);

  drop table if exists pg_temp.mgr_curve;
  create temporary table pg_temp.mgr_curve on commit drop as
  with mx as (
    select
      group_key,
      max(idx) as max_idx
    from pg_temp.mgr_curve_points
    group by group_key
  )
  select
    mx.group_key,
    jsonb_agg(
      coalesce(round(cp.weighted_sum / nullif(cp.plays_sum, 0))::int, 0)
      order by gs.idx
    ) as curve
  from mx
  cross join lateral generate_series(0, mx.max_idx) as gs(idx)
  left join pg_temp.mgr_curve_points cp
    on cp.group_key = mx.group_key
   and cp.idx = gs.idx
  group by mx.group_key;

  -- ═══════════════════════════════════════════════════════════════════
  -- mgr_series: CROSS JOIN + jsonb_agg
  -- ═══════════════════════════════════════════════════════════════════
  drop table if exists pg_temp.mgr_series;
  if p_include_series then
    create temporary table pg_temp.mgr_series on commit drop as
    select
      g.group_key,
      jsonb_build_object(
        'axis',         jsonb_agg(to_char(a.d, 'YYYY-MM-DD') order by a.d),
        'hook',         jsonb_agg(case when coalesce(d.plays, 0) > 0 then d.hook_wsum / d.plays else null end order by a.d),
        'spend',        jsonb_agg(case when coalesce(d.spend, 0) <> 0 then d.spend else null end order by a.d),
        'ctr',          jsonb_agg(case when coalesce(d.impressions, 0) > 0 then d.clicks::numeric / d.impressions else null end order by a.d),
        'connect_rate', jsonb_agg(case when coalesce(d.inline_link_clicks, 0) > 0 then d.lpv::numeric / d.inline_link_clicks else null end order by a.d),
        'lpv',          jsonb_agg(coalesce(d.lpv, 0) order by a.d),
        'impressions',  jsonb_agg(case when coalesce(d.impressions, 0) <> 0 then d.impressions else null end order by a.d),
        'cpm',          jsonb_agg(case when coalesce(d.impressions, 0) > 0 then (d.spend * 1000.0) / d.impressions else null end order by a.d),
        'website_ctr',  jsonb_agg(case when coalesce(d.impressions, 0) > 0 then d.inline_link_clicks::numeric / d.impressions else null end order by a.d),
        'conversions',  jsonb_agg(coalesce(dc.conversions, '{}'::jsonb) order by a.d),
        'cpmql',        jsonb_agg(case when coalesce(d.mql_count, 0) > 0 and coalesce(d.spend, 0) > 0 then d.spend / d.mql_count else null end order by a.d),
        'mqls',         jsonb_agg(case when coalesce(d.mql_count, 0) > 0 then d.mql_count else null end order by a.d)
      ) as series
    from pg_temp.mgr_group g
    cross join pg_temp.mgr_axis a
    left join pg_temp.mgr_daily d
      on d.group_key = g.group_key
     and d.date = a.d
    left join pg_temp.mgr_conv_daily_map dc
      on dc.group_key = g.group_key
     and dc.date = a.d
    group by g.group_key;
  else
    create temporary table pg_temp.mgr_series (
      group_key text primary key,
      series jsonb
    ) on commit drop;
  end if;

  -- ═══════════════════════════════════════════════════════════════════
  -- Cálculo de médias globais
  -- ═══════════════════════════════════════════════════════════════════
  select
    coalesce(sum(g.spend), 0),
    coalesce(sum(g.impressions), 0),
    coalesce(sum(g.clicks), 0),
    coalesce(sum(g.inline_link_clicks), 0),
    coalesce(sum(g.lpv), 0),
    coalesce(sum(g.plays), 0),
    coalesce(sum(g.hook_wsum), 0),
    coalesce(sum(g.hold_rate_wsum), 0),
    coalesce(sum(g.scroll_stop_wsum), 0)
    into
      v_total_spend,
      v_total_impressions,
      v_total_clicks,
      v_total_inline,
      v_total_lpv,
      v_total_plays,
      v_total_hook_wsum,
      v_total_hold_rate_wsum,
      v_total_scroll_stop_wsum
  from pg_temp.mgr_group g;

  select coalesce(
           jsonb_object_agg(
             c.conv_key,
             jsonb_build_object(
               'results', c.total_results,
               'cpr', case when c.total_results > 0 then v_total_spend / c.total_results else 0 end,
               'page_conv', case when v_total_lpv > 0 then c.total_results / v_total_lpv else 0 end
             )
             order by c.conv_key
           ),
           '{}'::jsonb
         )
    into v_per_action_type
  from (
    select
      conv_key,
      sum(conv_value)::numeric as total_results
    from pg_temp.mgr_conv_entries
    group by conv_key
  ) c;

  v_averages := jsonb_build_object(
    'hook', case when v_total_plays > 0 then v_total_hook_wsum / v_total_plays else 0 end,
    'hold_rate', case when v_total_plays > 0 then v_total_hold_rate_wsum / v_total_plays else 0 end,
    'scroll_stop', case when v_total_plays > 0 then v_total_scroll_stop_wsum / v_total_plays else 0 end,
    'ctr', case when v_total_impressions > 0 then v_total_clicks::numeric / v_total_impressions else 0 end,
    'website_ctr', case when v_total_impressions > 0 then v_total_inline::numeric / v_total_impressions else 0 end,
    'connect_rate', case when v_total_inline > 0 then v_total_lpv::numeric / v_total_inline else 0 end,
    'cpm', case when v_total_impressions > 0 then (v_total_spend * 1000.0) / v_total_impressions else 0 end,
    'per_action_type', v_per_action_type
  );

  -- ═══════════════════════════════════════════════════════════════════
  -- Montagem final do JSON
  -- ═══════════════════════════════════════════════════════════════════
  with items as (
    select
      g.group_key,
      g.account_id,
      g.campaign_id,
      g.campaign_name,
      g.adset_id,
      g.adset_name,
      g.rep_ad_id as ad_id,
      case
        when v_group_by = 'campaign_id' then coalesce(nullif(g.campaign_name, ''), g.group_key)
        when v_group_by = 'adset_id' then coalesce(nullif(g.adset_name, ''), g.group_key)
        else coalesce(nullif(g.rep_ad_name, ''), g.rep_ad_id)
      end as ad_name,
      case
        when st.has_active then 'ACTIVE'
        else coalesce(st.fallback_status, ra.rep_status)
      end as effective_status,
      case
        when v_group_by = 'campaign_id' then null
        else coalesce(st.active_count, 0)
      end as active_count,
      g.impressions,
      g.clicks,
      g.inline_link_clicks,
      g.spend,
      g.lpv,
      g.plays,
      g.thruplays as video_total_thruplays,
      case when g.plays > 0 then g.hook_wsum / g.plays else 0 end as hook,
      case when g.plays > 0 then g.hold_rate_wsum / g.plays else 0 end as hold_rate,
      round(case when g.plays > 0 then g.video_watched_p50_wsum / g.plays else 0 end)::int as video_watched_p50,
      case when g.impressions > 0 then g.clicks::numeric / g.impressions else 0 end as ctr,
      case when g.inline_link_clicks > 0 then g.lpv::numeric / g.inline_link_clicks else 0 end as connect_rate,
      case when g.impressions > 0 then (g.spend * 1000.0) / g.impressions else 0 end as cpm,
      case when g.impressions > 0 then g.inline_link_clicks::numeric / g.impressions else 0 end as website_ctr,
      g.reach,
      case when g.impressions > 0 then g.frequency_wsum / g.impressions else 0 end as frequency,
      case
        when p_include_leadscore then coalesce(ls.leadscore_values, array[]::numeric[])
        else array[]::numeric[]
      end as leadscore_values,
      coalesce(cm.conversions, '{}'::jsonb) as conversions,
      ra.thumbnail,
      ra.adcreatives_videos_thumbs,
      mc.curve as video_play_curve_actions,
      case when p_include_series then ms.series else null end as series,
      g.ad_count
    from pg_temp.mgr_group g
    left join pg_temp.mgr_status st using (group_key)
    left join pg_temp.mgr_rep_ads ra using (group_key)
    left join pg_temp.mgr_conv_map cm using (group_key)
    left join pg_temp.mgr_curve mc using (group_key)
    left join pg_temp.mgr_series ms using (group_key)
    left join pg_temp.mgr_leadscore ls using (group_key)
  ),
  ranked as (
    select
      row_number() over () as ord,
      jsonb_build_object(
        'unique_id', null,
        'account_id', i.account_id,
        'campaign_id', i.campaign_id,
        'campaign_name', i.campaign_name,
        'adset_id', i.adset_id,
        'adset_name', i.adset_name,
        'ad_id', i.ad_id,
        'ad_name', i.ad_name,
        'effective_status', i.effective_status,
        'active_count', i.active_count,
        'impressions', i.impressions,
        'clicks', i.clicks,
        'inline_link_clicks', i.inline_link_clicks,
        'spend', i.spend,
        'lpv', i.lpv,
        'plays', i.plays,
        'video_total_thruplays', i.video_total_thruplays,
        'hook', i.hook,
        'hold_rate', i.hold_rate,
        'video_watched_p50', i.video_watched_p50,
        'ctr', i.ctr,
        'connect_rate', i.connect_rate,
        'cpm', i.cpm,
        'website_ctr', i.website_ctr,
        'reach', i.reach,
        'frequency', i.frequency,
        'leadscore_values', i.leadscore_values,
        'conversions', i.conversions,
        'ad_count', i.ad_count,
        'thumbnail', i.thumbnail,
        'adcreatives_videos_thumbs', i.adcreatives_videos_thumbs,
        'video_play_curve_actions', i.video_play_curve_actions,
        'series', i.series
      ) as item_json
    from (
      select i.*
      from items i
      order by
        case when v_order_by = 'hook' then i.hook end desc nulls last,
        case when v_order_by = 'hold_rate' then i.hold_rate end desc nulls last,
        case when v_order_by = 'spend' then i.spend end desc nulls last,
        case when v_order_by = 'ctr' then i.ctr end desc nulls last,
        case when v_order_by = 'connect_rate' then i.connect_rate end desc nulls last,
        case when v_order_by = 'cpm' then i.cpm end desc nulls last,
        case when v_order_by = 'website_ctr' then i.website_ctr end desc nulls last,
        case when v_order_by not in ('hook', 'hold_rate', 'spend', 'ctr', 'connect_rate', 'cpm', 'website_ctr') then i.spend end desc nulls last,
        i.group_key
      limit greatest(1, coalesce(p_limit, 10000))
    ) i
  )
  select coalesce(jsonb_agg(r.item_json order by r.ord), '[]'::jsonb)
    into v_data
  from ranked r;

  return jsonb_build_object(
    'data', coalesce(v_data, '[]'::jsonb),
    'available_conversion_types', coalesce(v_available_conversion_types, '[]'::jsonb),
    'averages', coalesce(v_averages, '{}'::jsonb)
  );
end;
$$;


ALTER FUNCTION public.fetch_manager_analytics_aggregated_base_v049(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_include_series boolean, p_include_leadscore boolean, p_series_window integer, p_limit integer, p_order_by text) OWNER TO postgres;

--
-- Name: fetch_manager_rankings_core_v2(uuid, date, date, text, uuid[], text[], text, text, text, text, boolean, boolean, integer, integer, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.fetch_manager_rankings_core_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text DEFAULT 'ad_name'::text, p_pack_ids uuid[] DEFAULT NULL::uuid[], p_account_ids text[] DEFAULT NULL::text[], p_campaign_name_contains text DEFAULT NULL::text, p_adset_name_contains text DEFAULT NULL::text, p_ad_name_contains text DEFAULT NULL::text, p_action_type text DEFAULT NULL::text, p_include_leadscore boolean DEFAULT true, p_include_available_conversion_types boolean DEFAULT true, p_limit integer DEFAULT 500, p_offset integer DEFAULT 0, p_order_by text DEFAULT 'spend'::text) RETURNS jsonb
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with payload as (
    select public.fetch_manager_rankings_core_v2_base_v060(
      p_user_id,
      p_date_start,
      p_date_stop,
      p_group_by,
      p_pack_ids,
      p_account_ids,
      p_campaign_name_contains,
      p_adset_name_contains,
      p_ad_name_contains,
      p_action_type,
      p_include_leadscore,
      p_include_available_conversion_types,
      p_limit,
      p_offset,
      p_order_by
    ) as body
  ),
  data_rows as (
    select
      t.ord,
      t.item,
      nullif(t.item->>'ad_id', '') as ad_id
    from payload p
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(p.body->'data') = 'array' then p.body->'data'
        else '[]'::jsonb
      end
    ) with ordinality as t(item, ord)
  ),
  hydrated_data as (
    select coalesce(
      jsonb_agg(
        dr.item || jsonb_build_object('thumb_storage_path', a.thumb_storage_path)
        order by dr.ord
      ),
      '[]'::jsonb
    ) as data
    from data_rows dr
    left join public.ads a
      on a.user_id = p_user_id
     and a.ad_id = dr.ad_id
  )
  select case
    when jsonb_typeof(p.body) = 'object' then
      p.body || jsonb_build_object('data', hd.data)
    else
      jsonb_build_object(
        'data', '[]'::jsonb,
        'available_conversion_types', '[]'::jsonb,
        'averages', '{}'::jsonb,
        'header_aggregates', '{}'::jsonb,
        'pagination', jsonb_build_object(
          'limit', greatest(1, least(coalesce(p_limit, 500), 10000)),
          'offset', greatest(0, coalesce(p_offset, 0)),
          'total', 0,
          'has_more', false
        )
      )
  end
  from payload p
  cross join hydrated_data hd;
$$;


ALTER FUNCTION public.fetch_manager_rankings_core_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text) OWNER TO postgres;

--
-- Name: fetch_manager_rankings_core_v2(uuid, date, date, text, uuid[], text[], text, text, text, text, boolean, boolean, integer, integer, text, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.fetch_manager_rankings_core_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text DEFAULT 'ad_name'::text, p_pack_ids uuid[] DEFAULT NULL::uuid[], p_account_ids text[] DEFAULT NULL::text[], p_campaign_name_contains text DEFAULT NULL::text, p_adset_name_contains text DEFAULT NULL::text, p_ad_name_contains text DEFAULT NULL::text, p_action_type text DEFAULT NULL::text, p_include_leadscore boolean DEFAULT true, p_include_available_conversion_types boolean DEFAULT true, p_limit integer DEFAULT 500, p_offset integer DEFAULT 0, p_order_by text DEFAULT 'spend'::text, p_campaign_id text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_group_by text := lower(coalesce(p_group_by, 'ad_name'));
  v_payload jsonb;
  v_data jsonb := '[]'::jsonb;
begin
  select public.fetch_manager_rankings_core_v2_base_v067(
    p_user_id,
    p_date_start,
    p_date_stop,
    p_group_by,
    p_pack_ids,
    p_account_ids,
    p_campaign_name_contains,
    p_adset_name_contains,
    p_ad_name_contains,
    p_action_type,
    p_include_leadscore,
    p_include_available_conversion_types,
    p_limit,
    p_offset,
    p_order_by,
    p_campaign_id
  )
  into v_payload;

  if coalesce(jsonb_typeof(v_payload), '') <> 'object' then
    return v_payload;
  end if;

  if v_group_by not in ('adset_id', 'campaign_id') then
    return v_payload;
  end if;

  with raw_rows as (
    select
      t.ord,
      t.item,
      nullif(trim(coalesce(t.item->>'adset_id', '')), '') as adset_id,
      nullif(trim(coalesce(t.item->>'campaign_id', '')), '') as campaign_id
    from jsonb_array_elements(
      case
        when jsonb_typeof(v_payload->'data') = 'array' then v_payload->'data'
        else '[]'::jsonb
      end
    ) with ordinality as t(item, ord)
  ),
  resolved_rows as (
    select
      rr.ord,
      rr.item || jsonb_build_object(
        'effective_status',
        case
          when v_group_by = 'adset_id' and rr.adset_id is not null and exists (
            select 1
            from public.ads a
            where a.user_id = p_user_id
              and a.adset_id = rr.adset_id
              and upper(coalesce(a.effective_status, '')) = 'ADSET_PAUSED'
            limit 1
          ) then 'ADSET_PAUSED'
          when v_group_by = 'campaign_id' and rr.campaign_id is not null and exists (
            select 1
            from public.ads a
            where a.user_id = p_user_id
              and a.campaign_id = rr.campaign_id
              and upper(coalesce(a.effective_status, '')) = 'CAMPAIGN_PAUSED'
            limit 1
          ) then 'CAMPAIGN_PAUSED'
          when v_group_by in ('adset_id', 'campaign_id') then 'ACTIVE'
          else rr.item->>'effective_status'
        end
      ) as item
    from raw_rows rr
  )
  select coalesce(jsonb_agg(item order by ord), '[]'::jsonb)
  into v_data
  from resolved_rows;

  return v_payload || jsonb_build_object('data', v_data);
end;
$$;


ALTER FUNCTION public.fetch_manager_rankings_core_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text) OWNER TO postgres;

--
-- Name: FUNCTION fetch_manager_rankings_core_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.fetch_manager_rankings_core_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text) IS 'Manager core v2 wrapper: resolves campaign/adset effective_status from local hierarchical pause markers while preserving the existing payload contract.';


--
-- Name: fetch_manager_rankings_core_v2_base_v059(uuid, date, date, text, uuid[], text[], text, text, text, text, boolean, boolean, integer, integer, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.fetch_manager_rankings_core_v2_base_v059(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text DEFAULT 'ad_name'::text, p_pack_ids uuid[] DEFAULT NULL::uuid[], p_account_ids text[] DEFAULT NULL::text[], p_campaign_name_contains text DEFAULT NULL::text, p_adset_name_contains text DEFAULT NULL::text, p_ad_name_contains text DEFAULT NULL::text, p_action_type text DEFAULT NULL::text, p_include_leadscore boolean DEFAULT true, p_include_available_conversion_types boolean DEFAULT true, p_limit integer DEFAULT 500, p_offset integer DEFAULT 0, p_order_by text DEFAULT 'spend'::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_group_by text := lower(coalesce(p_group_by, 'ad_name'));
  v_order_by text := lower(coalesce(p_order_by, 'spend'));
  v_date_start date := least(p_date_start, p_date_stop);
  v_date_stop date := greatest(p_date_start, p_date_stop);
  v_limit integer := greatest(1, least(coalesce(p_limit, 500), 10000));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
  v_selected_key text := trim(coalesce(p_action_type, ''));
  v_action_source text := null;
  v_action_name text := null;
  v_include_conv_types boolean := coalesce(p_include_available_conversion_types, true);
  v_result jsonb;
begin
  if auth.uid() is distinct from p_user_id then
    raise exception 'Forbidden: p_user_id must match auth.uid()'
      using errcode = '42501';
  end if;

  if v_group_by not in ('ad_id', 'ad_name', 'adset_id', 'campaign_id') then
    raise exception 'Invalid p_group_by: %, expected ad_id|ad_name|adset_id|campaign_id', v_group_by
      using errcode = '22023';
  end if;

  if v_selected_key like 'conversion:%' then
    v_action_source := 'conversion';
    v_action_name := nullif(substring(v_selected_key from 12), '');
  elsif v_selected_key like 'action:%' then
    v_action_source := 'action';
    v_action_name := nullif(substring(v_selected_key from 8), '');
  elsif v_selected_key <> '' then
    v_action_source := 'conversion';
    v_action_name := v_selected_key;
    v_selected_key := 'conversion:' || v_selected_key;
  end if;

  with base_candidates as (
    select am.*
    from public.ad_metrics am
    where am.user_id = p_user_id
      and am.date >= v_date_start
      and am.date <= v_date_stop
      and (
        p_pack_ids is null
        or exists (
          select 1
          from public.ad_metric_pack_map apm
          where apm.user_id = am.user_id
            and apm.ad_id = am.ad_id
            and apm.metric_date = am.date
            and apm.pack_id = any(p_pack_ids)
        )
        or am.pack_ids && p_pack_ids
      )
      and (p_account_ids is null or am.account_id = any(p_account_ids))
      and (
        p_campaign_name_contains is null
        or p_campaign_name_contains = ''
        or coalesce(am.campaign_name, '') ilike '%' || p_campaign_name_contains || '%'
      )
      and (
        p_adset_name_contains is null
        or p_adset_name_contains = ''
        or coalesce(am.adset_name, '') ilike '%' || p_adset_name_contains || '%'
      )
      and (
        p_ad_name_contains is null
        or p_ad_name_contains = ''
        or coalesce(am.ad_name, '') ilike '%' || p_ad_name_contains || '%'
      )
  ),
  base as (
    select distinct on (am.user_id, am.ad_id, am.date)
      am.*
    from base_candidates am
    order by
      am.user_id,
      am.ad_id,
      am.date,
      am.updated_at desc nulls last,
      am.created_at desc nulls last,
      am.id desc
  ),
  typed as (
    select
      case
        when v_group_by = 'ad_id' then am.ad_id
        when v_group_by = 'ad_name' then coalesce(nullif(am.ad_name, ''), am.ad_id)
        when v_group_by = 'adset_id' then am.adset_id
        when v_group_by = 'campaign_id' then am.campaign_id
        else am.ad_id
      end as group_key,
      am.account_id,
      am.campaign_id,
      am.campaign_name,
      am.adset_id,
      am.adset_name,
      am.ad_id,
      am.ad_name,
      coalesce(am.impressions, 0)::bigint as impressions,
      coalesce(am.clicks, 0)::bigint as clicks,
      coalesce(am.inline_link_clicks, 0)::bigint as inline_link_clicks,
      coalesce(am.spend, 0)::numeric as spend,
      coalesce(am.lpv, 0)::bigint as lpv,
      coalesce(am.video_total_plays, 0)::bigint as plays,
      coalesce(am.video_total_thruplays, 0)::bigint as thruplays,
      coalesce(am.video_watched_p50, 0)::numeric as video_watched_p50,
      coalesce(am.hold_rate, 0)::numeric as hold_rate,
      coalesce(am.reach, 0)::bigint as reach,
      coalesce(am.frequency, 0)::numeric as frequency,
      coalesce(am.leadscore_values, '{}'::numeric[]) as leadscore_values,
      case when jsonb_typeof(am.conversions) = 'array' then am.conversions else '[]'::jsonb end as conversions_json,
      case when jsonb_typeof(am.actions) = 'array' then am.actions else '[]'::jsonb end as actions_json,
      coalesce(
        am.hook_rate,
        case
          when jsonb_typeof(am.video_play_curve_actions) = 'array'
           and jsonb_array_length(am.video_play_curve_actions) > 0
          then (
            coalesce(
              nullif(
                regexp_replace(
                  coalesce(
                    am.video_play_curve_actions ->> least(3, jsonb_array_length(am.video_play_curve_actions) - 1),
                    '0'
                  ),
                  '[^0-9.-]',
                  '',
                  'g'
                ),
                ''
              ),
              '0'
            )::numeric
          ) / (case when coalesce(
              nullif(
                regexp_replace(
                  coalesce(
                    am.video_play_curve_actions ->> least(3, jsonb_array_length(am.video_play_curve_actions) - 1),
                    '0'
                  ),
                  '[^0-9.-]',
                  '',
                  'g'
                ),
                ''
              ),
              '0'
            )::numeric > 1 then 100.0 else 1.0 end)
          else 0::numeric
        end
      ) as hook_value,
      coalesce(
        am.scroll_stop_rate,
        case
          when jsonb_typeof(am.video_play_curve_actions) = 'array'
           and jsonb_array_length(am.video_play_curve_actions) > 0
          then (
            coalesce(
              nullif(
                regexp_replace(
                  coalesce(
                    am.video_play_curve_actions ->> least(1, jsonb_array_length(am.video_play_curve_actions) - 1),
                    '0'
                  ),
                  '[^0-9.-]',
                  '',
                  'g'
                ),
                ''
              ),
              '0'
            )::numeric
          ) / (case when coalesce(
              nullif(
                regexp_replace(
                  coalesce(
                    am.video_play_curve_actions ->> least(1, jsonb_array_length(am.video_play_curve_actions) - 1),
                    '0'
                  ),
                  '[^0-9.-]',
                  '',
                  'g'
                ),
                ''
              ),
              '0'
            )::numeric > 1 then 100.0 else 1.0 end)
          else 0::numeric
        end
      ) as scroll_stop_value
    from base am
  ),
  filtered as (
    select *
    from typed
    where nullif(group_key, '') is not null
  ),
  group_agg as (
    select
      f.group_key,
      sum(f.impressions)::bigint as impressions,
      sum(f.clicks)::bigint as clicks,
      sum(f.inline_link_clicks)::bigint as inline_link_clicks,
      sum(f.spend)::numeric as spend,
      sum(f.lpv)::bigint as lpv,
      sum(f.plays)::bigint as plays,
      sum(f.thruplays)::bigint as thruplays,
      sum(f.hook_value * f.plays)::numeric as hook_wsum,
      sum(f.hold_rate * f.plays)::numeric as hold_rate_wsum,
      sum(f.video_watched_p50 * f.plays)::numeric as video_watched_p50_wsum,
      sum(f.scroll_stop_value * f.plays)::numeric as scroll_stop_wsum,
      sum(f.reach)::bigint as reach,
      sum(f.frequency * f.impressions)::numeric as frequency_wsum,
      count(distinct f.ad_id)::integer as ad_id_count,
      count(distinct nullif(f.adset_id, ''))::integer as adset_count
    from filtered f
    group by f.group_key
  ),
  rep as (
    select distinct on (f.group_key)
      f.group_key,
      f.account_id,
      f.campaign_id,
      f.campaign_name,
      f.adset_id,
      f.adset_name,
      f.ad_id as rep_ad_id,
      f.ad_name as rep_ad_name
    from filtered f
    order by f.group_key, f.impressions desc, f.ad_id desc
  ),
  status_rows as (
    select distinct f.group_key, f.ad_id
    from filtered f
  ),
  status_agg as (
    select
      sr.group_key,
      bool_or(upper(coalesce(a.effective_status, '')) = 'ACTIVE') as has_active,
      count(distinct sr.ad_id) filter (where upper(coalesce(a.effective_status, '')) = 'ACTIVE')::integer as active_count,
      min(a.effective_status) filter (where nullif(a.effective_status, '') is not null) as fallback_status
    from status_rows sr
    left join public.ads a
      on a.user_id = p_user_id
     and a.ad_id = sr.ad_id
    group by sr.group_key
  ),
  rep_ads as (
    select
      r.group_key,
      a.effective_status as rep_status,
      coalesce(
        nullif(a.thumbnail_url, ''),
        nullif(a.adcreatives_videos_thumbs ->> 0, '')
      ) as thumbnail,
      a.adcreatives_videos_thumbs
    from rep r
    left join public.ads a
      on a.user_id = p_user_id
     and a.ad_id = r.rep_ad_id
  ),
  selected_results as (
    select
      f.group_key,
      sum(
        coalesce(
          nullif(regexp_replace(coalesce(e.elem ->> 'value', '0'), '[^0-9.-]', '', 'g'), ''),
          '0'
        )::numeric
      ) as results
    from filtered f
    cross join lateral jsonb_array_elements(
      case
        when v_action_source = 'conversion' then f.conversions_json
        when v_action_source = 'action' then f.actions_json
        else '[]'::jsonb
      end
    ) e(elem)
    where v_action_source is not null
      and v_action_name is not null
      and nullif(e.elem ->> 'action_type', '') = v_action_name
    group by f.group_key
  ),
  leadscore_agg as (
    select
      f.group_key,
      array_agg(v)::numeric[] as leadscore_values
    from filtered f
    cross join lateral unnest(coalesce(f.leadscore_values, '{}'::numeric[])) v
    where coalesce(p_include_leadscore, true)
    group by f.group_key
  ),
  rows_enriched as (
    select
      g.group_key,
      r.account_id,
      r.campaign_id,
      r.campaign_name,
      r.adset_id,
      r.adset_name,
      r.rep_ad_id,
      r.rep_ad_name,
      case
        when v_group_by = 'campaign_id' then coalesce(nullif(r.campaign_name, ''), g.group_key)
        when v_group_by = 'adset_id' then coalesce(nullif(r.adset_name, ''), g.group_key)
        else coalesce(nullif(r.rep_ad_name, ''), r.rep_ad_id)
      end as label_name,
      case
        when v_group_by = 'campaign_id' then null
        when coalesce(st.has_active, false) then 'ACTIVE'
        else coalesce(st.fallback_status, ra.rep_status)
      end as effective_status,
      case
        when v_group_by = 'campaign_id' then null
        else coalesce(st.active_count, 0)
      end as active_count,
      g.impressions,
      g.clicks,
      g.inline_link_clicks,
      g.spend,
      g.lpv,
      g.plays,
      g.thruplays,
      g.hook_wsum,
      g.hold_rate_wsum,
      g.video_watched_p50_wsum,
      g.scroll_stop_wsum,
      g.reach,
      g.frequency_wsum,
      case
        when v_group_by = 'campaign_id' then g.adset_count
        else g.ad_id_count
      end as ad_count,
      coalesce(ls.leadscore_values, array[]::numeric[]) as leadscore_values,
      coalesce(sr.results, 0)::numeric as results,
      ra.thumbnail,
      ra.adcreatives_videos_thumbs
    from group_agg g
    join rep r using (group_key)
    left join status_agg st using (group_key)
    left join rep_ads ra using (group_key)
    left join selected_results sr using (group_key)
    left join leadscore_agg ls using (group_key)
  ),
  rows_metrics as (
    select
      re.*,
      case when re.plays > 0 then re.hook_wsum / re.plays else 0 end as hook,
      case when re.plays > 0 then re.hold_rate_wsum / re.plays else 0 end as hold_rate,
      round(case when re.plays > 0 then re.video_watched_p50_wsum / re.plays else 0 end)::int as video_watched_p50,
      case when re.impressions > 0 then re.clicks::numeric / re.impressions else 0 end as ctr,
      case when re.inline_link_clicks > 0 then re.lpv::numeric / re.inline_link_clicks else 0 end as connect_rate,
      case when re.impressions > 0 then (re.spend * 1000.0) / re.impressions else 0 end as cpm,
      case when re.impressions > 0 then re.inline_link_clicks::numeric / re.impressions else 0 end as website_ctr,
      case when re.impressions > 0 then re.frequency_wsum / re.impressions else 0 end as frequency,
      case when re.results > 0 then re.spend / re.results else 0 end as cpr,
      case when re.lpv > 0 then re.results / re.lpv else 0 end as page_conv,
      case
        when v_selected_key <> '' then jsonb_build_object(v_selected_key, re.results)
        else '{}'::jsonb
      end as conversions
    from rows_enriched re
  ),
  totals as (
    select
      coalesce(sum(rm.spend), 0)::numeric as total_spend,
      coalesce(sum(rm.impressions), 0)::bigint as total_impressions,
      coalesce(sum(rm.clicks), 0)::bigint as total_clicks,
      coalesce(sum(rm.inline_link_clicks), 0)::bigint as total_inline,
      coalesce(sum(rm.lpv), 0)::bigint as total_lpv,
      coalesce(sum(rm.plays), 0)::bigint as total_plays,
      coalesce(sum(rm.hook_wsum), 0)::numeric as total_hook_wsum,
      coalesce(sum(rm.hold_rate_wsum), 0)::numeric as total_hold_rate_wsum,
      coalesce(sum(rm.video_watched_p50_wsum), 0)::numeric as total_video_watched_p50_wsum,
      coalesce(sum(rm.scroll_stop_wsum), 0)::numeric as total_scroll_stop_wsum,
      coalesce(sum(rm.results), 0)::numeric as total_results
    from rows_metrics rm
  ),
  conv_entries_all as (
    select
      'conversion:' || nullif(elem ->> 'action_type', '') as conv_key,
      coalesce(
        nullif(regexp_replace(coalesce(elem ->> 'value', '0'), '[^0-9.-]', '', 'g'), ''),
        '0'
      )::numeric as conv_value
    from filtered f
    cross join lateral jsonb_array_elements(f.conversions_json) elem
    where v_include_conv_types
      and nullif(elem ->> 'action_type', '') is not null

    union all

    select
      'action:' || nullif(elem ->> 'action_type', '') as conv_key,
      coalesce(
        nullif(regexp_replace(coalesce(elem ->> 'value', '0'), '[^0-9.-]', '', 'g'), ''),
        '0'
      )::numeric as conv_value
    from filtered f
    cross join lateral jsonb_array_elements(f.actions_json) elem
    where v_include_conv_types
      and nullif(elem ->> 'action_type', '') is not null
  ),
  available_types as (
    select coalesce(jsonb_agg(t.conv_key order by t.conv_key), '[]'::jsonb) as conv_types
    from (
      select distinct conv_key
      from conv_entries_all
    ) t
  ),
  per_action_all as (
    select
      coalesce(
        jsonb_object_agg(
          c.conv_key,
          jsonb_build_object(
            'results', c.total_results,
            'cpr', case when c.total_results > 0 then t.total_spend / c.total_results else 0 end,
            'page_conv', case when t.total_lpv > 0 then c.total_results / t.total_lpv else 0 end
          )
          order by c.conv_key
        ),
        '{}'::jsonb
      ) as per_action_type
    from (
      select conv_key, sum(conv_value)::numeric as total_results
      from conv_entries_all
      group by conv_key
    ) c
    cross join totals t
  ),
  per_action_selected as (
    select
      case
        when v_selected_key <> '' then jsonb_build_object(
          v_selected_key,
          jsonb_build_object(
            'results', t.total_results,
            'cpr', case when t.total_results > 0 then t.total_spend / t.total_results else 0 end,
            'page_conv', case when t.total_lpv > 0 then t.total_results / t.total_lpv else 0 end
          )
        )
        else '{}'::jsonb
      end as per_action_type
    from totals t
  ),
  averages_payload as (
    select jsonb_build_object(
      'hook', case when t.total_plays > 0 then t.total_hook_wsum / t.total_plays else 0 end,
      'hold_rate', case when t.total_plays > 0 then t.total_hold_rate_wsum / t.total_plays else 0 end,
      'video_watched_p50', case when t.total_plays > 0 then t.total_video_watched_p50_wsum / t.total_plays else 0 end,
      'scroll_stop', case when t.total_plays > 0 then t.total_scroll_stop_wsum / t.total_plays else 0 end,
      'ctr', case when t.total_impressions > 0 then t.total_clicks::numeric / t.total_impressions else 0 end,
      'website_ctr', case when t.total_impressions > 0 then t.total_inline::numeric / t.total_impressions else 0 end,
      'connect_rate', case when t.total_inline > 0 then t.total_lpv::numeric / t.total_inline else 0 end,
      'cpm', case when t.total_impressions > 0 then (t.total_spend * 1000.0) / t.total_impressions else 0 end,
      'per_action_type', case when v_include_conv_types then paa.per_action_type else pas.per_action_type end
    ) as averages
    from totals t
    cross join per_action_all paa
    cross join per_action_selected pas
  ),
  header_payload as (
    select jsonb_build_object(
      'sums', jsonb_build_object(
        'spend', t.total_spend,
        'results', t.total_results,
        'mqls', to_jsonb(null::numeric)
      ),
      'weighted_averages', jsonb_build_object(
        'hook', case when t.total_plays > 0 then t.total_hook_wsum / t.total_plays else 0 end,
        'scroll_stop', case when t.total_plays > 0 then t.total_scroll_stop_wsum / t.total_plays else 0 end,
        'ctr', case when t.total_impressions > 0 then t.total_clicks::numeric / t.total_impressions else 0 end,
        'website_ctr', case when t.total_impressions > 0 then t.total_inline::numeric / t.total_impressions else 0 end,
        'connect_rate', case when t.total_inline > 0 then t.total_lpv::numeric / t.total_inline else 0 end,
        'cpm', case when t.total_impressions > 0 then (t.total_spend * 1000.0) / t.total_impressions else 0 end,
        'page_conv', case when t.total_lpv > 0 then t.total_results / t.total_lpv else 0 end
      )
    ) as header_aggregates
    from totals t
  ),
  ordered as (
    select rm.*
    from rows_metrics rm
    order by
      case when v_order_by = 'cpr' then rm.cpr end asc nulls last,
      case when v_order_by = 'hook' then rm.hook end desc nulls last,
      case when v_order_by = 'hold_rate' then rm.hold_rate end desc nulls last,
      case when v_order_by = 'spend' then rm.spend end desc nulls last,
      case when v_order_by = 'ctr' then rm.ctr end desc nulls last,
      case when v_order_by = 'connect_rate' then rm.connect_rate end desc nulls last,
      case when v_order_by = 'page_conv' then rm.page_conv end desc nulls last,
      case when v_order_by = 'cpm' then rm.cpm end desc nulls last,
      case when v_order_by = 'website_ctr' then rm.website_ctr end desc nulls last,
      case when v_order_by = 'results' then rm.results end desc nulls last,
      case
        when v_order_by not in ('cpr', 'hook', 'hold_rate', 'spend', 'ctr', 'connect_rate', 'page_conv', 'cpm', 'website_ctr', 'results')
        then rm.spend
      end desc nulls last,
      rm.group_key
  ),
  paged_raw as (
    select *
    from ordered
    offset v_offset
    limit v_limit
  ),
  paged as (
    select
      row_number() over () as ord,
      jsonb_build_object(
        'group_key', pr.group_key,
        'unique_id', null,
        'account_id', pr.account_id,
        'campaign_id', pr.campaign_id,
        'campaign_name', pr.campaign_name,
        'adset_id', pr.adset_id,
        'adset_name', pr.adset_name,
        'ad_id', pr.rep_ad_id,
        'ad_name', pr.label_name,
        'effective_status', pr.effective_status,
        'active_count', pr.active_count,
        'impressions', pr.impressions,
        'clicks', pr.clicks,
        'inline_link_clicks', pr.inline_link_clicks,
        'spend', pr.spend,
        'lpv', pr.lpv,
        'plays', pr.plays,
        'video_total_thruplays', pr.thruplays,
        'hook', pr.hook,
        'hold_rate', pr.hold_rate,
        'video_watched_p50', pr.video_watched_p50,
        'ctr', pr.ctr,
        'connect_rate', pr.connect_rate,
        'cpm', pr.cpm,
        'website_ctr', pr.website_ctr,
        'reach', pr.reach,
        'frequency', pr.frequency,
        'leadscore_values', case when coalesce(p_include_leadscore, true) then pr.leadscore_values else array[]::numeric[] end,
        'conversions', pr.conversions,
        'ad_count', pr.ad_count,
        'thumbnail', pr.thumbnail,
        'adcreatives_videos_thumbs', pr.adcreatives_videos_thumbs
      ) as item
    from paged_raw pr
  ),
  total_count as (
    select count(*)::integer as total
    from rows_metrics
  ),
  pagination_payload as (
    select jsonb_build_object(
      'limit', v_limit,
      'offset', v_offset,
      'total', tc.total,
      'has_more', (v_offset + v_limit) < tc.total
    ) as pagination
    from total_count tc
  )
  select jsonb_build_object(
    'data', coalesce((select jsonb_agg(p.item order by p.ord) from paged p), '[]'::jsonb),
    'available_conversion_types',
      case
        when v_include_conv_types then coalesce((select conv_types from available_types), '[]'::jsonb)
        else '[]'::jsonb
      end,
    'averages', coalesce((select averages from averages_payload), '{}'::jsonb),
    'header_aggregates', coalesce((select header_aggregates from header_payload), '{}'::jsonb),
    'pagination', coalesce((select pagination from pagination_payload), jsonb_build_object('limit', v_limit, 'offset', v_offset, 'total', 0, 'has_more', false))
  )
  into v_result;

  return coalesce(v_result, jsonb_build_object(
    'data', '[]'::jsonb,
    'available_conversion_types', '[]'::jsonb,
    'averages', '{}'::jsonb,
    'header_aggregates', '{}'::jsonb,
    'pagination', jsonb_build_object('limit', v_limit, 'offset', v_offset, 'total', 0, 'has_more', false)
  ));
end;
$$;


ALTER FUNCTION public.fetch_manager_rankings_core_v2_base_v059(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text) OWNER TO postgres;

--
-- Name: FUNCTION fetch_manager_rankings_core_v2_base_v059(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.fetch_manager_rankings_core_v2_base_v059(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text) IS 'Manager core v2 RPC: aggregated rows + header + pagination, dedup by (user_id, ad_id, date), selected action metrics only. Averages include hold_rate and video_watched_p50.';


--
-- Name: fetch_manager_rankings_core_v2_base_v060(uuid, date, date, text, uuid[], text[], text, text, text, text, boolean, boolean, integer, integer, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.fetch_manager_rankings_core_v2_base_v060(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text DEFAULT 'ad_name'::text, p_pack_ids uuid[] DEFAULT NULL::uuid[], p_account_ids text[] DEFAULT NULL::text[], p_campaign_name_contains text DEFAULT NULL::text, p_adset_name_contains text DEFAULT NULL::text, p_ad_name_contains text DEFAULT NULL::text, p_action_type text DEFAULT NULL::text, p_include_leadscore boolean DEFAULT true, p_include_available_conversion_types boolean DEFAULT true, p_limit integer DEFAULT 500, p_offset integer DEFAULT 0, p_order_by text DEFAULT 'spend'::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_group_by text := lower(coalesce(p_group_by, 'ad_name'));
  v_order_by text := lower(coalesce(p_order_by, 'spend'));
  v_date_start date := least(p_date_start, p_date_stop);
  v_date_stop date := greatest(p_date_start, p_date_stop);
  v_limit integer := greatest(1, least(coalesce(p_limit, 500), 10000));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
  v_selected_key text := trim(coalesce(p_action_type, ''));
  v_action_source text := null;
  v_action_name text := null;
  v_include_conv_types boolean := coalesce(p_include_available_conversion_types, true);
  v_result jsonb;
begin
  if auth.uid() is distinct from p_user_id then
    raise exception 'Forbidden: p_user_id must match auth.uid()'
      using errcode = '42501';
  end if;

  if v_group_by not in ('ad_id', 'ad_name', 'adset_id', 'campaign_id') then
    raise exception 'Invalid p_group_by: %, expected ad_id|ad_name|adset_id|campaign_id', v_group_by
      using errcode = '22023';
  end if;

  if v_selected_key like 'conversion:%' then
    v_action_source := 'conversion';
    v_action_name := nullif(substring(v_selected_key from 12), '');
  elsif v_selected_key like 'action:%' then
    v_action_source := 'action';
    v_action_name := nullif(substring(v_selected_key from 8), '');
  elsif v_selected_key <> '' then
    v_action_source := 'conversion';
    v_action_name := v_selected_key;
    v_selected_key := 'conversion:' || v_selected_key;
  end if;

  with base_candidates as (
    select am.*
    from public.ad_metrics am
    where am.user_id = p_user_id
      and am.date >= v_date_start
      and am.date <= v_date_stop
      and (
        p_pack_ids is null
        or exists (
          select 1
          from public.ad_metric_pack_map apm
          where apm.user_id = am.user_id
            and apm.ad_id = am.ad_id
            and apm.metric_date = am.date
            and apm.pack_id = any(p_pack_ids)
        )
      )
      and (p_account_ids is null or am.account_id = any(p_account_ids))
      and (
        p_campaign_name_contains is null
        or p_campaign_name_contains = ''
        or coalesce(am.campaign_name, '') ilike '%' || p_campaign_name_contains || '%'
      )
      and (
        p_adset_name_contains is null
        or p_adset_name_contains = ''
        or coalesce(am.adset_name, '') ilike '%' || p_adset_name_contains || '%'
      )
      and (
        p_ad_name_contains is null
        or p_ad_name_contains = ''
        or coalesce(am.ad_name, '') ilike '%' || p_ad_name_contains || '%'
      )
  ),
  base as (
    select distinct on (am.user_id, am.ad_id, am.date)
      am.*
    from base_candidates am
    order by
      am.user_id,
      am.ad_id,
      am.date,
      am.updated_at desc nulls last,
      am.created_at desc nulls last,
      am.id desc
  ),
  typed as (
    select
      case
        when v_group_by = 'ad_id' then am.ad_id
        when v_group_by = 'ad_name' then coalesce(nullif(am.ad_name, ''), am.ad_id)
        when v_group_by = 'adset_id' then am.adset_id
        when v_group_by = 'campaign_id' then am.campaign_id
        else am.ad_id
      end as group_key,
      am.account_id,
      am.campaign_id,
      am.campaign_name,
      am.adset_id,
      am.adset_name,
      am.ad_id,
      am.ad_name,
      coalesce(am.impressions, 0)::bigint as impressions,
      coalesce(am.clicks, 0)::bigint as clicks,
      coalesce(am.inline_link_clicks, 0)::bigint as inline_link_clicks,
      coalesce(am.spend, 0)::numeric as spend,
      coalesce(am.lpv, 0)::bigint as lpv,
      coalesce(am.video_total_plays, 0)::bigint as plays,
      coalesce(am.video_total_thruplays, 0)::bigint as thruplays,
      coalesce(am.video_watched_p50, 0)::numeric as video_watched_p50,
      coalesce(am.hold_rate, 0)::numeric as hold_rate,
      coalesce(am.reach, 0)::bigint as reach,
      coalesce(am.frequency, 0)::numeric as frequency,
      coalesce(am.leadscore_values, '{}'::numeric[]) as leadscore_values,
      case when jsonb_typeof(am.conversions) = 'array' then am.conversions else '[]'::jsonb end as conversions_json,
      case when jsonb_typeof(am.actions) = 'array' then am.actions else '[]'::jsonb end as actions_json,
      coalesce(
        am.hook_rate,
        case
          when jsonb_typeof(am.video_play_curve_actions) = 'array'
           and jsonb_array_length(am.video_play_curve_actions) > 0
          then (
            coalesce(
              nullif(
                regexp_replace(
                  coalesce(
                    am.video_play_curve_actions ->> least(3, jsonb_array_length(am.video_play_curve_actions) - 1),
                    '0'
                  ),
                  '[^0-9.-]',
                  '',
                  'g'
                ),
                ''
              ),
              '0'
            )::numeric
          ) / (case when coalesce(
              nullif(
                regexp_replace(
                  coalesce(
                    am.video_play_curve_actions ->> least(3, jsonb_array_length(am.video_play_curve_actions) - 1),
                    '0'
                  ),
                  '[^0-9.-]',
                  '',
                  'g'
                ),
                ''
              ),
              '0'
            )::numeric > 1 then 100.0 else 1.0 end)
          else 0::numeric
        end
      ) as hook_value,
      coalesce(
        am.scroll_stop_rate,
        case
          when jsonb_typeof(am.video_play_curve_actions) = 'array'
           and jsonb_array_length(am.video_play_curve_actions) > 0
          then (
            coalesce(
              nullif(
                regexp_replace(
                  coalesce(
                    am.video_play_curve_actions ->> least(1, jsonb_array_length(am.video_play_curve_actions) - 1),
                    '0'
                  ),
                  '[^0-9.-]',
                  '',
                  'g'
                ),
                ''
              ),
              '0'
            )::numeric
          ) / (case when coalesce(
              nullif(
                regexp_replace(
                  coalesce(
                    am.video_play_curve_actions ->> least(1, jsonb_array_length(am.video_play_curve_actions) - 1),
                    '0'
                  ),
                  '[^0-9.-]',
                  '',
                  'g'
                ),
                ''
              ),
              '0'
            )::numeric > 1 then 100.0 else 1.0 end)
          else 0::numeric
        end
      ) as scroll_stop_value
    from base am
  ),
  filtered as (
    select *
    from typed
    where nullif(group_key, '') is not null
  ),
  group_agg as (
    select
      f.group_key,
      sum(f.impressions)::bigint as impressions,
      sum(f.clicks)::bigint as clicks,
      sum(f.inline_link_clicks)::bigint as inline_link_clicks,
      sum(f.spend)::numeric as spend,
      sum(f.lpv)::bigint as lpv,
      sum(f.plays)::bigint as plays,
      sum(f.thruplays)::bigint as thruplays,
      sum(f.hook_value * f.plays)::numeric as hook_wsum,
      sum(f.hold_rate * f.plays)::numeric as hold_rate_wsum,
      sum(f.video_watched_p50 * f.plays)::numeric as video_watched_p50_wsum,
      sum(f.scroll_stop_value * f.plays)::numeric as scroll_stop_wsum,
      sum(f.reach)::bigint as reach,
      sum(f.frequency * f.impressions)::numeric as frequency_wsum,
      count(distinct f.ad_id)::integer as ad_id_count,
      count(distinct nullif(f.adset_id, ''))::integer as adset_count
    from filtered f
    group by f.group_key
  ),
  rep as (
    select distinct on (f.group_key)
      f.group_key,
      f.account_id,
      f.campaign_id,
      f.campaign_name,
      f.adset_id,
      f.adset_name,
      f.ad_id as rep_ad_id,
      f.ad_name as rep_ad_name
    from filtered f
    order by f.group_key, f.impressions desc, f.ad_id desc
  ),
  status_rows as (
    select distinct f.group_key, f.ad_id
    from filtered f
  ),
  status_agg as (
    select
      sr.group_key,
      bool_or(upper(coalesce(a.effective_status, '')) = 'ACTIVE') as has_active,
      count(distinct sr.ad_id) filter (where upper(coalesce(a.effective_status, '')) = 'ACTIVE')::integer as active_count,
      min(a.effective_status) filter (where nullif(a.effective_status, '') is not null) as fallback_status
    from status_rows sr
    left join public.ads a
      on a.user_id = p_user_id
     and a.ad_id = sr.ad_id
    group by sr.group_key
  ),
  rep_ads as (
    select
      r.group_key,
      a.effective_status as rep_status,
      coalesce(
        nullif(a.thumbnail_url, ''),
        nullif(a.adcreatives_videos_thumbs ->> 0, '')
      ) as thumbnail,
      a.adcreatives_videos_thumbs
    from rep r
    left join public.ads a
      on a.user_id = p_user_id
     and a.ad_id = r.rep_ad_id
  ),
  selected_results as (
    select
      f.group_key,
      sum(
        coalesce(
          nullif(regexp_replace(coalesce(e.elem ->> 'value', '0'), '[^0-9.-]', '', 'g'), ''),
          '0'
        )::numeric
      ) as results
    from filtered f
    cross join lateral jsonb_array_elements(
      case
        when v_action_source = 'conversion' then f.conversions_json
        when v_action_source = 'action' then f.actions_json
        else '[]'::jsonb
      end
    ) e(elem)
    where v_action_source is not null
      and v_action_name is not null
      and nullif(e.elem ->> 'action_type', '') = v_action_name
    group by f.group_key
  ),
  leadscore_agg as (
    select
      f.group_key,
      array_agg(v)::numeric[] as leadscore_values
    from filtered f
    cross join lateral unnest(coalesce(f.leadscore_values, '{}'::numeric[])) v
    where coalesce(p_include_leadscore, true)
    group by f.group_key
  ),
  rows_enriched as (
    select
      g.group_key,
      r.account_id,
      r.campaign_id,
      r.campaign_name,
      r.adset_id,
      r.adset_name,
      r.rep_ad_id,
      r.rep_ad_name,
      case
        when v_group_by = 'campaign_id' then coalesce(nullif(r.campaign_name, ''), g.group_key)
        when v_group_by = 'adset_id' then coalesce(nullif(r.adset_name, ''), g.group_key)
        else coalesce(nullif(r.rep_ad_name, ''), r.rep_ad_id)
      end as label_name,
      case
        when v_group_by = 'campaign_id' then null
        when coalesce(st.has_active, false) then 'ACTIVE'
        else coalesce(st.fallback_status, ra.rep_status)
      end as effective_status,
      case
        when v_group_by = 'campaign_id' then null
        else coalesce(st.active_count, 0)
      end as active_count,
      g.impressions,
      g.clicks,
      g.inline_link_clicks,
      g.spend,
      g.lpv,
      g.plays,
      g.thruplays,
      g.hook_wsum,
      g.hold_rate_wsum,
      g.video_watched_p50_wsum,
      g.scroll_stop_wsum,
      g.reach,
      g.frequency_wsum,
      case
        when v_group_by = 'campaign_id' then g.adset_count
        else g.ad_id_count
      end as ad_count,
      coalesce(ls.leadscore_values, array[]::numeric[]) as leadscore_values,
      coalesce(sr.results, 0)::numeric as results,
      ra.thumbnail,
      ra.adcreatives_videos_thumbs
    from group_agg g
    join rep r using (group_key)
    left join status_agg st using (group_key)
    left join rep_ads ra using (group_key)
    left join selected_results sr using (group_key)
    left join leadscore_agg ls using (group_key)
  ),
  rows_metrics as (
    select
      re.*,
      case when re.plays > 0 then re.hook_wsum / re.plays else 0 end as hook,
      case when re.plays > 0 then re.hold_rate_wsum / re.plays else 0 end as hold_rate,
      round(case when re.plays > 0 then re.video_watched_p50_wsum / re.plays else 0 end)::int as video_watched_p50,
      case when re.impressions > 0 then re.clicks::numeric / re.impressions else 0 end as ctr,
      case when re.inline_link_clicks > 0 then re.lpv::numeric / re.inline_link_clicks else 0 end as connect_rate,
      case when re.impressions > 0 then (re.spend * 1000.0) / re.impressions else 0 end as cpm,
      case when re.impressions > 0 then re.inline_link_clicks::numeric / re.impressions else 0 end as website_ctr,
      case when re.impressions > 0 then re.frequency_wsum / re.impressions else 0 end as frequency,
      case when re.results > 0 then re.spend / re.results else 0 end as cpr,
      case when re.lpv > 0 then re.results / re.lpv else 0 end as page_conv,
      case
        when v_selected_key <> '' then jsonb_build_object(v_selected_key, re.results)
        else '{}'::jsonb
      end as conversions
    from rows_enriched re
  ),
  totals as (
    select
      coalesce(sum(rm.spend), 0)::numeric as total_spend,
      coalesce(sum(rm.impressions), 0)::bigint as total_impressions,
      coalesce(sum(rm.clicks), 0)::bigint as total_clicks,
      coalesce(sum(rm.inline_link_clicks), 0)::bigint as total_inline,
      coalesce(sum(rm.lpv), 0)::bigint as total_lpv,
      coalesce(sum(rm.plays), 0)::bigint as total_plays,
      coalesce(sum(rm.hook_wsum), 0)::numeric as total_hook_wsum,
      coalesce(sum(rm.hold_rate_wsum), 0)::numeric as total_hold_rate_wsum,
      coalesce(sum(rm.video_watched_p50_wsum), 0)::numeric as total_video_watched_p50_wsum,
      coalesce(sum(rm.scroll_stop_wsum), 0)::numeric as total_scroll_stop_wsum,
      coalesce(sum(rm.results), 0)::numeric as total_results
    from rows_metrics rm
  ),
  conv_entries_all as (
    select
      'conversion:' || nullif(elem ->> 'action_type', '') as conv_key,
      coalesce(
        nullif(regexp_replace(coalesce(elem ->> 'value', '0'), '[^0-9.-]', '', 'g'), ''),
        '0'
      )::numeric as conv_value
    from filtered f
    cross join lateral jsonb_array_elements(f.conversions_json) elem
    where v_include_conv_types
      and nullif(elem ->> 'action_type', '') is not null

    union all

    select
      'action:' || nullif(elem ->> 'action_type', '') as conv_key,
      coalesce(
        nullif(regexp_replace(coalesce(elem ->> 'value', '0'), '[^0-9.-]', '', 'g'), ''),
        '0'
      )::numeric as conv_value
    from filtered f
    cross join lateral jsonb_array_elements(f.actions_json) elem
    where v_include_conv_types
      and nullif(elem ->> 'action_type', '') is not null
  ),
  available_types as (
    select coalesce(jsonb_agg(t.conv_key order by t.conv_key), '[]'::jsonb) as conv_types
    from (
      select distinct conv_key
      from conv_entries_all
    ) t
  ),
  per_action_all as (
    select
      coalesce(
        jsonb_object_agg(
          c.conv_key,
          jsonb_build_object(
            'results', c.total_results,
            'cpr', case when c.total_results > 0 then t.total_spend / c.total_results else 0 end,
            'page_conv', case when t.total_lpv > 0 then c.total_results / t.total_lpv else 0 end
          )
          order by c.conv_key
        ),
        '{}'::jsonb
      ) as per_action_type
    from (
      select conv_key, sum(conv_value)::numeric as total_results
      from conv_entries_all
      group by conv_key
    ) c
    cross join totals t
  ),
  per_action_selected as (
    select
      case
        when v_selected_key <> '' then jsonb_build_object(
          v_selected_key,
          jsonb_build_object(
            'results', t.total_results,
            'cpr', case when t.total_results > 0 then t.total_spend / t.total_results else 0 end,
            'page_conv', case when t.total_lpv > 0 then t.total_results / t.total_lpv else 0 end
          )
        )
        else '{}'::jsonb
      end as per_action_type
    from totals t
  ),
  averages_payload as (
    select jsonb_build_object(
      'hook', case when t.total_plays > 0 then t.total_hook_wsum / t.total_plays else 0 end,
      'hold_rate', case when t.total_plays > 0 then t.total_hold_rate_wsum / t.total_plays else 0 end,
      'video_watched_p50', case when t.total_plays > 0 then t.total_video_watched_p50_wsum / t.total_plays else 0 end,
      'scroll_stop', case when t.total_plays > 0 then t.total_scroll_stop_wsum / t.total_plays else 0 end,
      'ctr', case when t.total_impressions > 0 then t.total_clicks::numeric / t.total_impressions else 0 end,
      'website_ctr', case when t.total_impressions > 0 then t.total_inline::numeric / t.total_impressions else 0 end,
      'connect_rate', case when t.total_inline > 0 then t.total_lpv::numeric / t.total_inline else 0 end,
      'cpm', case when t.total_impressions > 0 then (t.total_spend * 1000.0) / t.total_impressions else 0 end,
      'cpc', case when t.total_clicks > 0 then t.total_spend / t.total_clicks else 0 end,
      'cplc', case when t.total_inline > 0 then t.total_spend / t.total_inline else 0 end,
      'per_action_type', case when v_include_conv_types then paa.per_action_type else pas.per_action_type end
    ) as averages
    from totals t
    cross join per_action_all paa
    cross join per_action_selected pas
  ),
  header_payload as (
    select jsonb_build_object(
      'sums', jsonb_build_object(
        'spend', t.total_spend,
        'results', t.total_results,
        'mqls', to_jsonb(null::numeric)
      ),
      'weighted_averages', jsonb_build_object(
        'hook', case when t.total_plays > 0 then t.total_hook_wsum / t.total_plays else 0 end,
        'scroll_stop', case when t.total_plays > 0 then t.total_scroll_stop_wsum / t.total_plays else 0 end,
        'ctr', case when t.total_impressions > 0 then t.total_clicks::numeric / t.total_impressions else 0 end,
        'website_ctr', case when t.total_impressions > 0 then t.total_inline::numeric / t.total_impressions else 0 end,
        'connect_rate', case when t.total_inline > 0 then t.total_lpv::numeric / t.total_inline else 0 end,
        'cpm', case when t.total_impressions > 0 then (t.total_spend * 1000.0) / t.total_impressions else 0 end,
        'page_conv', case when t.total_lpv > 0 then t.total_results / t.total_lpv else 0 end
      )
    ) as header_aggregates
    from totals t
  ),
  ordered as (
    select rm.*
    from rows_metrics rm
    order by
      case when v_order_by = 'cpr' then rm.cpr end asc nulls last,
      case when v_order_by = 'hook' then rm.hook end desc nulls last,
      case when v_order_by = 'hold_rate' then rm.hold_rate end desc nulls last,
      case when v_order_by = 'spend' then rm.spend end desc nulls last,
      case when v_order_by = 'ctr' then rm.ctr end desc nulls last,
      case when v_order_by = 'connect_rate' then rm.connect_rate end desc nulls last,
      case when v_order_by = 'page_conv' then rm.page_conv end desc nulls last,
      case when v_order_by = 'cpm' then rm.cpm end desc nulls last,
      case when v_order_by = 'website_ctr' then rm.website_ctr end desc nulls last,
      case when v_order_by = 'results' then rm.results end desc nulls last,
      case
        when v_order_by not in ('cpr', 'hook', 'hold_rate', 'spend', 'ctr', 'connect_rate', 'page_conv', 'cpm', 'website_ctr', 'results')
        then rm.spend
      end desc nulls last,
      rm.group_key
  ),
  paged_raw as (
    select *
    from ordered
    offset v_offset
    limit v_limit
  ),
  paged as (
    select
      row_number() over () as ord,
      jsonb_build_object(
        'group_key', pr.group_key,
        'unique_id', null,
        'account_id', pr.account_id,
        'campaign_id', pr.campaign_id,
        'campaign_name', pr.campaign_name,
        'adset_id', pr.adset_id,
        'adset_name', pr.adset_name,
        'ad_id', pr.rep_ad_id,
        'ad_name', pr.label_name,
        'effective_status', pr.effective_status,
        'active_count', pr.active_count,
        'impressions', pr.impressions,
        'clicks', pr.clicks,
        'inline_link_clicks', pr.inline_link_clicks,
        'spend', pr.spend,
        'lpv', pr.lpv,
        'plays', pr.plays,
        'video_total_thruplays', pr.thruplays,
        'hook', pr.hook,
        'hold_rate', pr.hold_rate,
        'video_watched_p50', pr.video_watched_p50,
        'ctr', pr.ctr,
        'connect_rate', pr.connect_rate,
        'cpm', pr.cpm,
        'website_ctr', pr.website_ctr,
        'reach', pr.reach,
        'frequency', pr.frequency,
        'leadscore_values', case when coalesce(p_include_leadscore, true) then pr.leadscore_values else array[]::numeric[] end,
        'conversions', pr.conversions,
        'ad_count', pr.ad_count,
        'thumbnail', pr.thumbnail,
        'adcreatives_videos_thumbs', pr.adcreatives_videos_thumbs
      ) as item
    from paged_raw pr
  ),
  total_count as (
    select count(*)::integer as total
    from rows_metrics
  ),
  pagination_payload as (
    select jsonb_build_object(
      'limit', v_limit,
      'offset', v_offset,
      'total', tc.total,
      'has_more', (v_offset + v_limit) < tc.total
    ) as pagination
    from total_count tc
  )
  select jsonb_build_object(
    'data', coalesce((select jsonb_agg(p.item order by p.ord) from paged p), '[]'::jsonb),
    'available_conversion_types',
      case
        when v_include_conv_types then coalesce((select conv_types from available_types), '[]'::jsonb)
        else '[]'::jsonb
      end,
    'averages', coalesce((select averages from averages_payload), '{}'::jsonb),
    'header_aggregates', coalesce((select header_aggregates from header_payload), '{}'::jsonb),
    'pagination', coalesce((select pagination from pagination_payload), jsonb_build_object('limit', v_limit, 'offset', v_offset, 'total', 0, 'has_more', false))
  )
  into v_result;

  return coalesce(v_result, jsonb_build_object(
    'data', '[]'::jsonb,
    'available_conversion_types', '[]'::jsonb,
    'averages', '{}'::jsonb,
    'header_aggregates', '{}'::jsonb,
    'pagination', jsonb_build_object('limit', v_limit, 'offset', v_offset, 'total', 0, 'has_more', false)
  ));
end;
$$;


ALTER FUNCTION public.fetch_manager_rankings_core_v2_base_v060(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text) OWNER TO postgres;

--
-- Name: fetch_manager_rankings_core_v2_base_v066(uuid, date, date, text, uuid[], text[], text, text, text, text, boolean, boolean, integer, integer, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.fetch_manager_rankings_core_v2_base_v066(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text DEFAULT 'ad_name'::text, p_pack_ids uuid[] DEFAULT NULL::uuid[], p_account_ids text[] DEFAULT NULL::text[], p_campaign_name_contains text DEFAULT NULL::text, p_adset_name_contains text DEFAULT NULL::text, p_ad_name_contains text DEFAULT NULL::text, p_action_type text DEFAULT NULL::text, p_include_leadscore boolean DEFAULT true, p_include_available_conversion_types boolean DEFAULT true, p_limit integer DEFAULT 500, p_offset integer DEFAULT 0, p_order_by text DEFAULT 'spend'::text) RETURNS jsonb
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with payload as (
    select public.fetch_manager_rankings_core_v2_base_v060(
      p_user_id,
      p_date_start,
      p_date_stop,
      p_group_by,
      p_pack_ids,
      p_account_ids,
      p_campaign_name_contains,
      p_adset_name_contains,
      p_ad_name_contains,
      p_action_type,
      p_include_leadscore,
      p_include_available_conversion_types,
      p_limit,
      p_offset,
      p_order_by
    ) as body
  ),
  data_rows as (
    select
      t.ord,
      t.item,
      nullif(t.item->>'ad_id', '') as ad_id
    from payload p
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(p.body->'data') = 'array' then p.body->'data'
        else '[]'::jsonb
      end
    ) with ordinality as t(item, ord)
  ),
  hydrated_data as (
    select coalesce(
      jsonb_agg(
        dr.item || jsonb_build_object('thumb_storage_path', a.thumb_storage_path)
        order by dr.ord
      ),
      '[]'::jsonb
    ) as data
    from data_rows dr
    left join public.ads a
      on a.user_id = p_user_id
     and a.ad_id = dr.ad_id
  )
  select case
    when jsonb_typeof(p.body) = 'object' then
      p.body || jsonb_build_object('data', hd.data)
    else
      jsonb_build_object(
        'data', '[]'::jsonb,
        'available_conversion_types', '[]'::jsonb,
        'averages', '{}'::jsonb,
        'header_aggregates', '{}'::jsonb,
        'pagination', jsonb_build_object(
          'limit', greatest(1, least(coalesce(p_limit, 500), 10000)),
          'offset', greatest(0, coalesce(p_offset, 0)),
          'total', 0,
          'has_more', false
        )
      )
  end
  from payload p
  cross join hydrated_data hd;
$$;


ALTER FUNCTION public.fetch_manager_rankings_core_v2_base_v066(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text) OWNER TO postgres;

--
-- Name: FUNCTION fetch_manager_rankings_core_v2_base_v066(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.fetch_manager_rankings_core_v2_base_v066(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text) IS 'Manager core v2 wrapper: appends ads.thumb_storage_path to each row in data while preserving the existing base implementation.';


--
-- Name: fetch_manager_rankings_core_v2_base_v067(uuid, date, date, text, uuid[], text[], text, text, text, text, boolean, boolean, integer, integer, text, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.fetch_manager_rankings_core_v2_base_v067(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text DEFAULT 'ad_name'::text, p_pack_ids uuid[] DEFAULT NULL::uuid[], p_account_ids text[] DEFAULT NULL::text[], p_campaign_name_contains text DEFAULT NULL::text, p_adset_name_contains text DEFAULT NULL::text, p_ad_name_contains text DEFAULT NULL::text, p_action_type text DEFAULT NULL::text, p_include_leadscore boolean DEFAULT true, p_include_available_conversion_types boolean DEFAULT true, p_limit integer DEFAULT 500, p_offset integer DEFAULT 0, p_order_by text DEFAULT 'spend'::text, p_campaign_id text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with payload as (
    select public.fetch_manager_rankings_core_v2_base_v066(
      p_user_id,
      p_date_start,
      p_date_stop,
      p_group_by,
      p_pack_ids,
      p_account_ids,
      p_campaign_name_contains,
      p_adset_name_contains,
      p_ad_name_contains,
      p_action_type,
      p_include_leadscore,
      p_include_available_conversion_types,
      p_limit,
      p_offset,
      p_order_by
    ) as body
  ),
  data_rows as (
    select
      t.ord,
      t.item
    from payload p
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(p.body->'data') = 'array' then p.body->'data'
        else '[]'::jsonb
      end
    ) with ordinality as t(item, ord)
    where nullif(trim(coalesce(p_campaign_id, '')), '') is null
       or coalesce(t.item->>'campaign_id', '') = trim(p_campaign_id)
  ),
  filtered_data as (
    select
      coalesce(jsonb_agg(dr.item order by dr.ord), '[]'::jsonb) as data,
      count(*)::integer as total
    from data_rows dr
  )
  select case
    when jsonb_typeof(p.body) = 'object' then
      case
        when nullif(trim(coalesce(p_campaign_id, '')), '') is null then
          p.body
        else
          p.body || jsonb_build_object(
            'data', fd.data,
            'pagination', jsonb_build_object(
              'limit', greatest(1, least(coalesce(p_limit, 500), 10000)),
              'offset', 0,
              'total', fd.total,
              'has_more', false
            )
          )
      end
    else
      jsonb_build_object(
        'data', '[]'::jsonb,
        'available_conversion_types', '[]'::jsonb,
        'averages', '{}'::jsonb,
        'header_aggregates', '{}'::jsonb,
        'pagination', jsonb_build_object(
          'limit', greatest(1, least(coalesce(p_limit, 500), 10000)),
          'offset', 0,
          'total', 0,
          'has_more', false
        )
      )
  end
  from payload p
  cross join filtered_data fd;
$$;


ALTER FUNCTION public.fetch_manager_rankings_core_v2_base_v067(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text) OWNER TO postgres;

--
-- Name: FUNCTION fetch_manager_rankings_core_v2_base_v067(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.fetch_manager_rankings_core_v2_base_v067(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text) IS 'Manager core v2 wrapper: preserves the current payload and supports optional exact campaign_id filtering on returned rows.';


--
-- Name: fetch_manager_rankings_retention_v2(uuid, date, date, text, uuid[], text[], text, text, text, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.fetch_manager_rankings_retention_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text DEFAULT 'ad_name'::text, p_pack_ids uuid[] DEFAULT NULL::uuid[], p_account_ids text[] DEFAULT NULL::text[], p_campaign_name_contains text DEFAULT NULL::text, p_adset_name_contains text DEFAULT NULL::text, p_ad_name_contains text DEFAULT NULL::text, p_group_key text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_group_by text := lower(coalesce(p_group_by, 'ad_name'));
  v_date_start date := least(p_date_start, p_date_stop);
  v_date_stop date := greatest(p_date_start, p_date_stop);
  v_group_key text := trim(coalesce(p_group_key, ''));
  v_result jsonb;
begin
  if auth.uid() is distinct from p_user_id then
    raise exception 'Forbidden: p_user_id must match auth.uid()'
      using errcode = '42501';
  end if;

  if v_group_by not in ('ad_id', 'ad_name', 'adset_id', 'campaign_id') then
    raise exception 'Invalid p_group_by: %, expected ad_id|ad_name|adset_id|campaign_id', v_group_by
      using errcode = '22023';
  end if;

  if v_group_key = '' then
    return jsonb_build_object('group_key', v_group_key, 'video_play_curve_actions', '[]'::jsonb);
  end if;

  with base_candidates as (
    select am.*
    from public.ad_metrics am
    where am.user_id = p_user_id
      and am.date >= v_date_start
      and am.date <= v_date_stop
      and (
        p_pack_ids is null
        or exists (
          select 1
          from public.ad_metric_pack_map apm
          where apm.user_id = am.user_id
            and apm.ad_id = am.ad_id
            and apm.metric_date = am.date
            and apm.pack_id = any(p_pack_ids)
        )
      )
      and (p_account_ids is null or am.account_id = any(p_account_ids))
      and (
        p_campaign_name_contains is null
        or p_campaign_name_contains = ''
        or coalesce(am.campaign_name, '') ilike '%' || p_campaign_name_contains || '%'
      )
      and (
        p_adset_name_contains is null
        or p_adset_name_contains = ''
        or coalesce(am.adset_name, '') ilike '%' || p_adset_name_contains || '%'
      )
      and (
        p_ad_name_contains is null
        or p_ad_name_contains = ''
        or coalesce(am.ad_name, '') ilike '%' || p_ad_name_contains || '%'
      )
  ),
  base as (
    select distinct on (am.user_id, am.ad_id, am.date)
      am.*
    from base_candidates am
    order by
      am.user_id,
      am.ad_id,
      am.date,
      am.updated_at desc nulls last,
      am.created_at desc nulls last,
      am.id desc
  ),
  filtered as (
    select
      case
        when v_group_by = 'ad_id' then am.ad_id
        when v_group_by = 'ad_name' then coalesce(nullif(am.ad_name, ''), am.ad_id)
        when v_group_by = 'adset_id' then am.adset_id
        when v_group_by = 'campaign_id' then am.campaign_id
        else am.ad_id
      end as group_key,
      coalesce(am.video_total_plays, 0)::bigint as plays,
      case when jsonb_typeof(am.video_play_curve_actions) = 'array' then am.video_play_curve_actions else '[]'::jsonb end as curve
    from base am
  ),
  target as (
    select *
    from filtered
    where group_key = v_group_key
  ),
  curve_points as (
    select
      (cv.ord - 1)::integer as idx,
      sum(
        coalesce(
          nullif(regexp_replace(cv.val, '[^0-9.-]', '', 'g'), ''),
          '0'
        )::numeric * t.plays
      )::numeric as weighted_sum,
      sum(t.plays)::numeric as plays_sum
    from target t
    cross join lateral jsonb_array_elements_text(t.curve) with ordinality as cv(val, ord)
    where t.plays > 0
    group by (cv.ord - 1)
  ),
  max_idx as (
    select max(cp.idx) as max_idx
    from curve_points cp
  ),
  curve_out as (
    select
      jsonb_agg(
        coalesce(round(cp.weighted_sum / nullif(cp.plays_sum, 0))::int, 0)
        order by gs.idx
      ) as curve
    from max_idx mx
    cross join lateral generate_series(0, coalesce(mx.max_idx, -1)) as gs(idx)
    left join curve_points cp
      on cp.idx = gs.idx
  )
  select jsonb_build_object(
    'group_key', v_group_key,
    'video_play_curve_actions', coalesce((select curve from curve_out), '[]'::jsonb)
  )
  into v_result;

  return coalesce(v_result, jsonb_build_object('group_key', v_group_key, 'video_play_curve_actions', '[]'::jsonb));
end;
$$;


ALTER FUNCTION public.fetch_manager_rankings_retention_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_group_key text) OWNER TO postgres;

--
-- Name: FUNCTION fetch_manager_rankings_retention_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_group_key text); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.fetch_manager_rankings_retention_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_group_key text) IS 'Manager retention v2 RPC: returns weighted retention curve for one group_key, loaded on demand.';


--
-- Name: fetch_manager_rankings_series_v2(uuid, date, date, text, uuid[], text[], text, text, text, text, text[], integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.fetch_manager_rankings_series_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text DEFAULT 'ad_name'::text, p_pack_ids uuid[] DEFAULT NULL::uuid[], p_account_ids text[] DEFAULT NULL::text[], p_campaign_name_contains text DEFAULT NULL::text, p_adset_name_contains text DEFAULT NULL::text, p_ad_name_contains text DEFAULT NULL::text, p_action_type text DEFAULT NULL::text, p_group_keys text[] DEFAULT NULL::text[], p_window integer DEFAULT 5) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_group_by text := lower(coalesce(p_group_by, 'ad_name'));
  v_date_start date := least(p_date_start, p_date_stop);
  v_date_stop date := greatest(p_date_start, p_date_stop);
  v_window integer := greatest(1, least(coalesce(p_window, 5), 30));
  v_axis_start date;
  v_selected_key text := trim(coalesce(p_action_type, ''));
  v_action_source text := null;
  v_action_name text := null;
  v_mql_min numeric := 0;
  v_result jsonb;
begin
  if auth.uid() is distinct from p_user_id then
    raise exception 'Forbidden: p_user_id must match auth.uid()'
      using errcode = '42501';
  end if;

  if v_group_by not in ('ad_id', 'ad_name', 'adset_id', 'campaign_id') then
    raise exception 'Invalid p_group_by: %, expected ad_id|ad_name|adset_id|campaign_id', v_group_by
      using errcode = '22023';
  end if;

  if v_selected_key like 'conversion:%' then
    v_action_source := 'conversion';
    v_action_name := nullif(substring(v_selected_key from 12), '');
  elsif v_selected_key like 'action:%' then
    v_action_source := 'action';
    v_action_name := nullif(substring(v_selected_key from 8), '');
  elsif v_selected_key <> '' then
    v_action_source := 'conversion';
    v_action_name := v_selected_key;
    v_selected_key := 'conversion:' || v_selected_key;
  end if;

  select coalesce(up.mql_leadscore_min, 0)
    into v_mql_min
  from public.user_preferences up
  where up.user_id = p_user_id
  limit 1;

  v_axis_start := greatest(v_date_start, (v_date_stop - (v_window - 1)));

  with requested_groups as (
    select distinct k as group_key
    from unnest(coalesce(p_group_keys, '{}'::text[])) k
    where nullif(trim(k), '') is not null
  ),
  axis as (
    select generate_series(v_axis_start, v_date_stop, interval '1 day')::date as d
  ),
  base_candidates as (
    select am.*
    from public.ad_metrics am
    where am.user_id = p_user_id
      and am.date >= v_date_start
      and am.date <= v_date_stop
      and (
        p_pack_ids is null
        or exists (
          select 1
          from public.ad_metric_pack_map apm
          where apm.user_id = am.user_id
            and apm.ad_id = am.ad_id
            and apm.metric_date = am.date
            and apm.pack_id = any(p_pack_ids)
        )
      )
      and (p_account_ids is null or am.account_id = any(p_account_ids))
      and (
        p_campaign_name_contains is null
        or p_campaign_name_contains = ''
        or coalesce(am.campaign_name, '') ilike '%' || p_campaign_name_contains || '%'
      )
      and (
        p_adset_name_contains is null
        or p_adset_name_contains = ''
        or coalesce(am.adset_name, '') ilike '%' || p_adset_name_contains || '%'
      )
      and (
        p_ad_name_contains is null
        or p_ad_name_contains = ''
        or coalesce(am.ad_name, '') ilike '%' || p_ad_name_contains || '%'
      )
  ),
  base as (
    select distinct on (am.user_id, am.ad_id, am.date)
      am.*
    from base_candidates am
    order by
      am.user_id,
      am.ad_id,
      am.date,
      am.updated_at desc nulls last,
      am.created_at desc nulls last,
      am.id desc
  ),
  typed as (
    select
      case
        when v_group_by = 'ad_id' then am.ad_id
        when v_group_by = 'ad_name' then coalesce(nullif(am.ad_name, ''), am.ad_id)
        when v_group_by = 'adset_id' then am.adset_id
        when v_group_by = 'campaign_id' then am.campaign_id
        else am.ad_id
      end as group_key,
      am.date,
      coalesce(am.impressions, 0)::bigint as impressions,
      coalesce(am.clicks, 0)::bigint as clicks,
      coalesce(am.inline_link_clicks, 0)::bigint as inline_link_clicks,
      coalesce(am.spend, 0)::numeric as spend,
      coalesce(am.lpv, 0)::bigint as lpv,
      coalesce(am.video_total_plays, 0)::bigint as plays,
      coalesce(am.leadscore_values, '{}'::numeric[]) as leadscore_values,
      case when jsonb_typeof(am.conversions) = 'array' then am.conversions else '[]'::jsonb end as conversions_json,
      case when jsonb_typeof(am.actions) = 'array' then am.actions else '[]'::jsonb end as actions_json,
      coalesce(
        am.hook_rate,
        case
          when jsonb_typeof(am.video_play_curve_actions) = 'array'
           and jsonb_array_length(am.video_play_curve_actions) > 0
          then (
            coalesce(
              nullif(
                regexp_replace(
                  coalesce(
                    am.video_play_curve_actions ->> least(3, jsonb_array_length(am.video_play_curve_actions) - 1),
                    '0'
                  ),
                  '[^0-9.-]',
                  '',
                  'g'
                ),
                ''
              ),
              '0'
            )::numeric
          ) / (case when coalesce(
              nullif(
                regexp_replace(
                  coalesce(
                    am.video_play_curve_actions ->> least(3, jsonb_array_length(am.video_play_curve_actions) - 1),
                    '0'
                  ),
                  '[^0-9.-]',
                  '',
                  'g'
                ),
                ''
              ),
              '0'
            )::numeric > 1 then 100.0 else 1.0 end)
          else 0::numeric
        end
      ) as hook_value,
      coalesce(
        am.scroll_stop_rate,
        case
          when jsonb_typeof(am.video_play_curve_actions) = 'array'
           and jsonb_array_length(am.video_play_curve_actions) > 0
          then (
            coalesce(
              nullif(
                regexp_replace(
                  coalesce(
                    am.video_play_curve_actions ->> least(1, jsonb_array_length(am.video_play_curve_actions) - 1),
                    '0'
                  ),
                  '[^0-9.-]',
                  '',
                  'g'
                ),
                ''
              ),
              '0'
            )::numeric
          ) / (case when coalesce(
              nullif(
                regexp_replace(
                  coalesce(
                    am.video_play_curve_actions ->> least(1, jsonb_array_length(am.video_play_curve_actions) - 1),
                    '0'
                  ),
                  '[^0-9.-]',
                  '',
                  'g'
                ),
                ''
              ),
              '0'
            )::numeric > 1 then 100.0 else 1.0 end)
          else 0::numeric
        end
      ) as scroll_stop_value,
      coalesce(am.hold_rate, 0)::numeric as hold_rate_value,
      coalesce(am.video_watched_p50, 0)::numeric as video_watched_p50_value
    from base am
  ),
  filtered as (
    select t.*
    from typed t
    join requested_groups rg
      on rg.group_key = t.group_key
  ),
  daily as (
    select
      f.group_key,
      f.date,
      sum(f.impressions)::bigint as impressions,
      sum(f.clicks)::bigint as clicks,
      sum(f.inline_link_clicks)::bigint as inline_link_clicks,
      sum(f.spend)::numeric as spend,
      sum(f.lpv)::bigint as lpv,
      sum(f.plays)::bigint as plays,
      sum(f.hook_value * f.plays)::numeric as hook_wsum,
      sum(f.scroll_stop_value * f.plays)::numeric as scroll_stop_wsum,
      sum(f.hold_rate_value * f.plays)::numeric as hold_rate_wsum,
      sum(f.video_watched_p50_value * f.plays)::numeric as video_watched_p50_wsum,
      sum(
        coalesce(
          (select count(*)::integer from unnest(f.leadscore_values) v where v >= v_mql_min),
          0
        )
      )::bigint as mql_count
    from filtered f
    where f.date >= v_axis_start
      and f.date <= v_date_stop
    group by f.group_key, f.date
  ),
  conv_daily as (
    select
      f.group_key,
      f.date,
      sum(
        coalesce(
          nullif(regexp_replace(coalesce(e.elem ->> 'value', '0'), '[^0-9.-]', '', 'g'), ''),
          '0'
        )::numeric
      ) as results
    from filtered f
    cross join lateral jsonb_array_elements(
      case
        when v_action_source = 'conversion' then f.conversions_json
        when v_action_source = 'action' then f.actions_json
        else '[]'::jsonb
      end
    ) e(elem)
    where v_action_source is not null
      and v_action_name is not null
      and f.date >= v_axis_start
      and f.date <= v_date_stop
      and nullif(e.elem ->> 'action_type', '') = v_action_name
    group by f.group_key, f.date
  ),
  series_by_group as (
    select
      rg.group_key,
      jsonb_build_object(
        'axis', jsonb_agg(to_char(a.d, 'YYYY-MM-DD') order by a.d),
        'hook', jsonb_agg(case when coalesce(d.plays, 0) > 0 then d.hook_wsum / d.plays else null end order by a.d),
        'scroll_stop', jsonb_agg(case when coalesce(d.plays, 0) > 0 then d.scroll_stop_wsum / d.plays else null end order by a.d),
        'hold_rate', jsonb_agg(case when coalesce(d.plays, 0) > 0 then d.hold_rate_wsum / d.plays else null end order by a.d),
        'video_watched_p50', jsonb_agg(case when coalesce(d.plays, 0) > 0 then d.video_watched_p50_wsum / d.plays else null end order by a.d),
        'spend', jsonb_agg(case when coalesce(d.spend, 0) <> 0 then d.spend else null end order by a.d),
        'clicks', jsonb_agg(case when coalesce(d.clicks, 0) <> 0 then d.clicks else null end order by a.d),
        'inline_link_clicks', jsonb_agg(case when coalesce(d.inline_link_clicks, 0) <> 0 then d.inline_link_clicks else null end order by a.d),
        'ctr', jsonb_agg(case when coalesce(d.impressions, 0) > 0 then d.clicks::numeric / d.impressions else null end order by a.d),
        'connect_rate', jsonb_agg(case when coalesce(d.inline_link_clicks, 0) > 0 then d.lpv::numeric / d.inline_link_clicks else null end order by a.d),
        'lpv', jsonb_agg(coalesce(d.lpv, 0) order by a.d),
        'impressions', jsonb_agg(case when coalesce(d.impressions, 0) <> 0 then d.impressions else null end order by a.d),
        'cpm', jsonb_agg(case when coalesce(d.impressions, 0) > 0 then (d.spend * 1000.0) / d.impressions else null end order by a.d),
        'cpc', jsonb_agg(case when coalesce(d.clicks, 0) > 0 then d.spend / d.clicks else null end order by a.d),
        'cplc', jsonb_agg(case when coalesce(d.inline_link_clicks, 0) > 0 then d.spend / d.inline_link_clicks else null end order by a.d),
        'website_ctr', jsonb_agg(case when coalesce(d.impressions, 0) > 0 then d.inline_link_clicks::numeric / d.impressions else null end order by a.d),
        'conversions', jsonb_agg(
          case
            when v_selected_key <> '' then jsonb_build_object(v_selected_key, coalesce(cd.results, 0))
            else '{}'::jsonb
          end
          order by a.d
        ),
        'cpmql', jsonb_agg(
          case
            when coalesce(d.mql_count, 0) > 0 and coalesce(d.spend, 0) > 0 then d.spend / d.mql_count
            else null
          end
          order by a.d
        ),
        'mqls', jsonb_agg(
          case
            when coalesce(d.mql_count, 0) > 0 then d.mql_count
            else null
          end
          order by a.d
        )
      ) as series
    from requested_groups rg
    cross join axis a
    left join daily d
      on d.group_key = rg.group_key
     and d.date = a.d
    left join conv_daily cd
      on cd.group_key = rg.group_key
     and cd.date = a.d
    group by rg.group_key
  )
  select jsonb_build_object(
    'series_by_group', coalesce(
      (select jsonb_object_agg(sbg.group_key, sbg.series order by sbg.group_key) from series_by_group sbg),
      '{}'::jsonb
    ),
    'window', v_window
  )
  into v_result;

  return coalesce(v_result, jsonb_build_object('series_by_group', '{}'::jsonb, 'window', v_window));
end;
$$;


ALTER FUNCTION public.fetch_manager_rankings_series_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_group_keys text[], p_window integer) OWNER TO postgres;

--
-- Name: FUNCTION fetch_manager_rankings_series_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_group_keys text[], p_window integer); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.fetch_manager_rankings_series_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_group_keys text[], p_window integer) IS 'Manager series v2 RPC: returns sparkline series for requested group_keys, including clicks, inline_link_clicks, cpc and cplc, plus retention metrics.';


--
-- Name: get_admin_users_list(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_admin_users_list() RETURNS TABLE(user_id uuid, email text, name text, tier text, meta_email text, packs_count bigint, created_at timestamp with time zone, expires_at timestamp with time zone, updated_at timestamp with time zone, granted_by uuid)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT
    u.id                                        AS user_id,
    u.email                                     AS email,
    COALESCE(u.raw_user_meta_data->>'name', u.email) AS name,
    COALESCE(s.tier, 'standard')                AS tier,
    fc.facebook_email                           AS meta_email,
    COUNT(DISTINCT p.id)                        AS packs_count,
    s.created_at                                AS created_at,
    s.expires_at                                AS expires_at,
    s.updated_at                                AS updated_at,
    s.granted_by                                AS granted_by
  FROM auth.users u
  LEFT JOIN public.subscriptions s   ON s.user_id = u.id
  LEFT JOIN public.facebook_connections fc
         ON fc.user_id = u.id AND fc.is_primary = true
  LEFT JOIN public.packs p           ON p.user_id = u.id
  GROUP BY u.id, u.email, u.raw_user_meta_data, s.tier, fc.facebook_email,
           s.created_at, s.expires_at, s.updated_at, s.granted_by
  ORDER BY s.created_at DESC NULLS LAST;
$$;


ALTER FUNCTION public.get_admin_users_list() OWNER TO postgres;

--
-- Name: FUNCTION get_admin_users_list(); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.get_admin_users_list() IS 'Admin-only: returns all users with tier, meta account, and packs count. Callable only via service role (no RLS).';


--
-- Name: handle_new_user_subscription(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.handle_new_user_subscription() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  INSERT INTO public.subscriptions (user_id, tier, source)
  VALUES (NEW.id, 'standard', 'manual')
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;


ALTER FUNCTION public.handle_new_user_subscription() OWNER TO postgres;

--
-- Name: release_job_processing_lease(text, uuid, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.release_job_processing_lease(p_job_id text, p_user_id uuid, p_owner text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_released boolean := false;
BEGIN
  UPDATE public.jobs
  SET
    processing_owner = NULL,
    processing_claimed_at = NULL,
    processing_lease_until = NULL,
    updated_at = now()
  WHERE id = p_job_id
    AND user_id = p_user_id
    AND processing_owner = p_owner;

  v_released := FOUND;

  RETURN jsonb_build_object(
    'released', v_released
  );
END;
$$;


ALTER FUNCTION public.release_job_processing_lease(p_job_id text, p_user_id uuid, p_owner text) OWNER TO postgres;

--
-- Name: FUNCTION release_job_processing_lease(p_job_id text, p_user_id uuid, p_owner text); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.release_job_processing_lease(p_job_id text, p_user_id uuid, p_owner text) IS 'Libera o lease do worker que ainda detém o processamento do job.';


--
-- Name: renew_job_processing_lease(text, uuid, text, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.renew_job_processing_lease(p_job_id text, p_user_id uuid, p_owner text, p_lease_seconds integer DEFAULT 300) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_renewed boolean := false;
BEGIN
  UPDATE public.jobs
  SET
    processing_lease_until = now() + make_interval(secs => GREATEST(p_lease_seconds, 30)),
    updated_at = now()
  WHERE id = p_job_id
    AND user_id = p_user_id
    AND processing_owner = p_owner
    AND status IN ('processing', 'persisting');

  v_renewed := FOUND;

  RETURN jsonb_build_object(
    'renewed', v_renewed
  );
END;
$$;


ALTER FUNCTION public.renew_job_processing_lease(p_job_id text, p_user_id uuid, p_owner text, p_lease_seconds integer) OWNER TO postgres;

--
-- Name: FUNCTION renew_job_processing_lease(p_job_id text, p_user_id uuid, p_owner text, p_lease_seconds integer); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.renew_job_processing_lease(p_job_id text, p_user_id uuid, p_owner text, p_lease_seconds integer) IS 'Renova o lease de processamento do worker atual se ele ainda for o owner do job.';


--
-- Name: set_subscriptions_updated_at(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.set_subscriptions_updated_at() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION public.set_subscriptions_updated_at() OWNER TO postgres;

--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION public.set_updated_at() OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: ad_accounts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ad_accounts (
    id text NOT NULL,
    user_id uuid NOT NULL,
    name text,
    account_status integer,
    user_tasks text[],
    business_id text,
    business_name text,
    instagram_accounts jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    connection_id uuid
);


ALTER TABLE public.ad_accounts OWNER TO postgres;

--
-- Name: COLUMN ad_accounts.connection_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.ad_accounts.connection_id IS 'ID da conexão Facebook que concedeu acesso a esta conta de anúncios. NULL mantém compatibilidade com registros antigos.';


--
-- Name: ad_metric_pack_map; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ad_metric_pack_map (
    user_id uuid NOT NULL,
    pack_id uuid NOT NULL,
    ad_id text NOT NULL,
    metric_date date NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.ad_metric_pack_map OWNER TO postgres;

--
-- Name: ad_metrics; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ad_metrics (
    user_id uuid NOT NULL,
    ad_id text NOT NULL,
    account_id text,
    campaign_id text,
    campaign_name text,
    adset_id text,
    adset_name text,
    ad_name text,
    date date NOT NULL,
    clicks integer,
    impressions integer,
    inline_link_clicks integer,
    reach integer,
    video_total_plays integer,
    video_total_thruplays integer,
    video_watched_p50 integer,
    spend numeric,
    cpm numeric,
    ctr numeric,
    frequency numeric,
    website_ctr numeric,
    actions jsonb,
    conversions jsonb,
    cost_per_conversion jsonb,
    video_play_curve_actions jsonb,
    connect_rate numeric,
    profile_ctr numeric,
    raw_data jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    id text NOT NULL,
    hold_rate numeric,
    leadscore_values numeric[],
    lpv integer DEFAULT 0 NOT NULL,
    hook_rate numeric,
    scroll_stop_rate numeric
);


ALTER TABLE public.ad_metrics OWNER TO postgres;

--
-- Name: COLUMN ad_metrics.hold_rate; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.ad_metrics.hold_rate IS 'Taxa de retenção (Hold Rate) calculada como video_thruplay_watched_actions / hook (retention at 3 seconds). 
Representa quantos usuários que passaram do hook inicial continuaram assistindo até o thruplay.';


--
-- Name: COLUMN ad_metrics.leadscore_values; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.ad_metrics.leadscore_values IS 'Array de leadscores individuais daquele ad_id naquela date. Permite calcular média correta quando há múltiplas datas. Exemplo: [24, 100, 80, 19] representa 4 leads com leadscores 24, 100, 80, 19. Média = SUM(leadscore_values) / array_length(leadscore_values, 1)';


--
-- Name: ad_sheet_integrations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ad_sheet_integrations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    spreadsheet_id text NOT NULL,
    worksheet_title text NOT NULL,
    match_strategy text DEFAULT 'AD_ID'::text NOT NULL,
    ad_id_column text NOT NULL,
    date_column text NOT NULL,
    leadscore_column text,
    last_synced_at timestamp with time zone,
    last_sync_status text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    date_format text,
    pack_id uuid,
    connection_id uuid,
    last_successful_sync_at timestamp with time zone,
    ad_id_column_index integer,
    date_column_index integer,
    leadscore_column_index integer,
    spreadsheet_name text
);


ALTER TABLE public.ad_sheet_integrations OWNER TO postgres;

--
-- Name: COLUMN ad_sheet_integrations.date_format; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.ad_sheet_integrations.date_format IS 'Formato de data da planilha: DD/MM/YYYY ou MM/DD/YYYY';


--
-- Name: COLUMN ad_sheet_integrations.connection_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.ad_sheet_integrations.connection_id IS 'ID da conexão Google específica a usar para esta integração. NULL significa usar a primeira conexão disponível (compatibilidade com integrações antigas).';


--
-- Name: COLUMN ad_sheet_integrations.last_successful_sync_at; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.ad_sheet_integrations.last_successful_sync_at IS 'Timestamp da última sincronização bem-sucedida. Este campo é atualizado apenas quando a sincronização é concluída com sucesso, ao contrário de last_synced_at que pode ser atualizado mesmo em caso de falha.';


--
-- Name: COLUMN ad_sheet_integrations.ad_id_column_index; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.ad_sheet_integrations.ad_id_column_index IS 'Índice da coluna quando há headers duplicados (0-based). Usado apenas quando ad_id_column aparece mais de uma vez.';


--
-- Name: ad_transcriptions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ad_transcriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    ad_name text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    full_text text,
    timestamped_text jsonb,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    ad_ids text[] DEFAULT '{}'::text[],
    CONSTRAINT ad_transcriptions_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'failed'::text])))
);


ALTER TABLE public.ad_transcriptions OWNER TO postgres;

--
-- Name: COLUMN ad_transcriptions.ad_ids; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.ad_transcriptions.ad_ids IS 'Array de ad_id dos anúncios que compartilham esta transcrição (mesmo ad_name).';


--
-- Name: ads; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ads (
    ad_id text NOT NULL,
    user_id uuid NOT NULL,
    account_id text,
    campaign_id text,
    campaign_name text,
    adset_id text,
    adset_name text,
    ad_name text,
    effective_status text,
    creative jsonb,
    creative_video_id text,
    thumbnail_url text,
    instagram_permalink_url text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    pack_ids uuid[] DEFAULT '{}'::uuid[],
    adcreatives_videos_ids jsonb,
    adcreatives_videos_thumbs jsonb,
    leadscore numeric,
    thumb_storage_path text,
    thumb_cached_at timestamp with time zone,
    thumb_source_url text,
    transcription_id uuid,
    video_owner_page_id text,
    primary_video_id text,
    media_type text DEFAULT 'unknown'::text NOT NULL,
    CONSTRAINT ads_media_type_check CHECK ((media_type = ANY (ARRAY['video'::text, 'image'::text, 'unknown'::text])))
);


ALTER TABLE public.ads OWNER TO postgres;

--
-- Name: COLUMN ads.adcreatives_videos_ids; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.ads.adcreatives_videos_ids IS 'Array de video IDs do asset_feed_spec';


--
-- Name: COLUMN ads.adcreatives_videos_thumbs; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.ads.adcreatives_videos_thumbs IS 'Array de thumbnail URLs do asset_feed_spec';


--
-- Name: COLUMN ads.thumb_storage_path; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.ads.thumb_storage_path IS 'Path do objeto no Supabase Storage (bucket público ad-thumbs).';


--
-- Name: COLUMN ads.thumb_cached_at; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.ads.thumb_cached_at IS 'Quando o thumbnail foi cacheado no Storage.';


--
-- Name: COLUMN ads.thumb_source_url; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.ads.thumb_source_url IS 'URL original usada para baixar/cachear o thumbnail (normalmente adcreatives_videos_thumbs[0]).';


--
-- Name: COLUMN ads.transcription_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.ads.transcription_id IS 'Referência à transcrição do vídeo (por ad_name). Null se não houver transcrição.';


--
-- Name: bulk_ad_items; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.bulk_ad_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id text NOT NULL,
    user_id uuid NOT NULL,
    file_name text NOT NULL,
    file_index integer NOT NULL,
    adset_id text NOT NULL,
    adset_name text,
    ad_name text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    meta_ad_id text,
    meta_creative_id text,
    error_message text,
    error_code text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    bundle_id text,
    bundle_name text,
    slot_files jsonb,
    is_multi_slot boolean DEFAULT false NOT NULL,
    campaign_name text,
    slot_media jsonb,
    error_details jsonb,
    CONSTRAINT bulk_ad_items_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'uploading_media'::text, 'creating_creative'::text, 'creating_campaign'::text, 'creating_adsets'::text, 'creating_ad'::text, 'success'::text, 'error'::text, 'skipped'::text])))
);


ALTER TABLE public.bulk_ad_items OWNER TO postgres;

--
-- Name: facebook_connections; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.facebook_connections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    facebook_user_id text NOT NULL,
    facebook_name text,
    facebook_email text,
    access_token text NOT NULL,
    refresh_token text,
    expires_at timestamp with time zone,
    scopes text[],
    is_primary boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    facebook_picture_url text,
    status text DEFAULT 'active'::text,
    picture_storage_path text,
    picture_cached_at timestamp with time zone,
    picture_source_url text,
    CONSTRAINT facebook_connections_status_check CHECK ((status = ANY (ARRAY['active'::text, 'expired'::text, 'invalid'::text])))
);


ALTER TABLE public.facebook_connections OWNER TO postgres;

--
-- Name: COLUMN facebook_connections.facebook_picture_url; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.facebook_connections.facebook_picture_url IS 'URL da imagem de perfil do Facebook';


--
-- Name: COLUMN facebook_connections.picture_storage_path; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.facebook_connections.picture_storage_path IS 'Path do objeto no Supabase Storage (bucket ad-thumbs, profile-pics/).';


--
-- Name: COLUMN facebook_connections.picture_cached_at; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.facebook_connections.picture_cached_at IS 'Quando a foto de perfil foi cacheada no Storage.';


--
-- Name: COLUMN facebook_connections.picture_source_url; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.facebook_connections.picture_source_url IS 'URL original do Meta usada para baixar/cachear a foto.';


--
-- Name: google_accounts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.google_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    access_token text NOT NULL,
    refresh_token text,
    expires_at timestamp with time zone,
    scopes text[],
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    google_user_id text,
    google_email text,
    google_name text,
    is_primary boolean DEFAULT true
);


ALTER TABLE public.google_accounts OWNER TO postgres;

--
-- Name: jobs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.jobs (
    id text NOT NULL,
    user_id uuid NOT NULL,
    status text NOT NULL,
    progress integer DEFAULT 0,
    message text,
    payload jsonb,
    result_count integer,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    processing_owner text,
    processing_claimed_at timestamp with time zone,
    processing_lease_until timestamp with time zone,
    processing_attempts integer DEFAULT 0 NOT NULL,
    CONSTRAINT jobs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'completed'::text, 'failed'::text, 'error'::text, 'meta_running'::text, 'meta_completed'::text, 'processing'::text, 'persisting'::text, 'cancelled'::text])))
);


ALTER TABLE public.jobs OWNER TO postgres;

--
-- Name: meta_api_usage; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.meta_api_usage (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id uuid,
    route text,
    service_name text,
    ad_account_id text,
    meta_endpoint text,
    http_method text,
    http_status integer,
    response_ms integer,
    call_count_pct numeric,
    cputime_pct numeric,
    total_time_pct numeric,
    business_use_case_usage jsonb,
    ad_account_usage jsonb,
    page_route text,
    regain_access_minutes integer
);


ALTER TABLE public.meta_api_usage OWNER TO postgres;

--
-- Name: TABLE meta_api_usage; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.meta_api_usage IS 'One row per outgoing Meta Graph API call. Populated by services/meta_usage_logger.py.';


--
-- Name: packs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.packs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    adaccount_id text,
    name text NOT NULL,
    date_start date NOT NULL,
    date_stop date NOT NULL,
    level text NOT NULL,
    filters jsonb DEFAULT '[]'::jsonb NOT NULL,
    stats jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    auto_refresh boolean DEFAULT false NOT NULL,
    last_refreshed_at date,
    refresh_status text DEFAULT 'idle'::text,
    last_prompted_at date,
    refresh_lock_until timestamp without time zone,
    refresh_progress_json jsonb,
    ad_ids text[] DEFAULT '{}'::text[],
    sheet_integration_id uuid,
    CONSTRAINT packs_level_check CHECK ((level = ANY (ARRAY['campaign'::text, 'adset'::text, 'ad'::text]))),
    CONSTRAINT packs_refresh_status_check CHECK ((refresh_status = ANY (ARRAY['idle'::text, 'queued'::text, 'running'::text, 'cancel_requested'::text, 'canceled'::text, 'success'::text, 'failed'::text])))
);


ALTER TABLE public.packs OWNER TO postgres;

--
-- Name: COLUMN packs.sheet_integration_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.packs.sheet_integration_id IS 'Referência à integração de planilha Google Sheets associada a este pack. Permite buscar dados da integração diretamente via JOIN ao buscar packs.';


--
-- Name: subscriptions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    tier text DEFAULT 'standard'::text NOT NULL,
    source text DEFAULT 'manual'::text,
    plan_id text,
    granted_by uuid,
    starts_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT subscriptions_source_check CHECK ((source = ANY (ARRAY['manual'::text, 'stripe'::text, 'promo'::text]))),
    CONSTRAINT subscriptions_tier_check CHECK ((tier = ANY (ARRAY['standard'::text, 'insider'::text, 'admin'::text])))
);


ALTER TABLE public.subscriptions OWNER TO postgres;

--
-- Name: user_preferences; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.user_preferences (
    user_id uuid NOT NULL,
    locale text,
    timezone text,
    currency text,
    theme text,
    default_adaccount_id text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    validation_criteria jsonb DEFAULT '[]'::jsonb,
    mql_leadscore_min numeric DEFAULT 0,
    has_completed_onboarding boolean DEFAULT false,
    niche text
);


ALTER TABLE public.user_preferences OWNER TO postgres;

--
-- Name: COLUMN user_preferences.mql_leadscore_min; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.user_preferences.mql_leadscore_min IS 'Leadscore mínimo para considerar um lead como MQL (Marketing Qualified Lead). Valores >= este número são considerados MQLs. Usado para calcular quantidade de MQLs e custo por MQL.';


--
-- Name: COLUMN user_preferences.niche; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.user_preferences.niche IS 'Nicho de negócio do usuário (texto livre)';


--
-- Name: ad_accounts ad_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ad_accounts
    ADD CONSTRAINT ad_accounts_pkey PRIMARY KEY (id, user_id);


--
-- Name: ad_metric_pack_map ad_metric_pack_map_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ad_metric_pack_map
    ADD CONSTRAINT ad_metric_pack_map_pkey PRIMARY KEY (user_id, pack_id, ad_id, metric_date);


--
-- Name: ad_metrics ad_metrics_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ad_metrics
    ADD CONSTRAINT ad_metrics_pkey PRIMARY KEY (id, user_id);


--
-- Name: ad_metrics ad_metrics_user_ad_date_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ad_metrics
    ADD CONSTRAINT ad_metrics_user_ad_date_key UNIQUE (user_id, ad_id, date);


--
-- Name: ad_sheet_integrations ad_sheet_integrations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ad_sheet_integrations
    ADD CONSTRAINT ad_sheet_integrations_pkey PRIMARY KEY (id);


--
-- Name: ad_transcriptions ad_transcriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ad_transcriptions
    ADD CONSTRAINT ad_transcriptions_pkey PRIMARY KEY (id);


--
-- Name: ad_transcriptions ad_transcriptions_user_id_ad_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ad_transcriptions
    ADD CONSTRAINT ad_transcriptions_user_id_ad_name_key UNIQUE (user_id, ad_name);


--
-- Name: ads ads_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ads
    ADD CONSTRAINT ads_pkey PRIMARY KEY (ad_id, user_id);


--
-- Name: bulk_ad_items bulk_ad_items_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bulk_ad_items
    ADD CONSTRAINT bulk_ad_items_pkey PRIMARY KEY (id);


--
-- Name: facebook_connections facebook_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.facebook_connections
    ADD CONSTRAINT facebook_connections_pkey PRIMARY KEY (id);


--
-- Name: facebook_connections facebook_connections_user_fb_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.facebook_connections
    ADD CONSTRAINT facebook_connections_user_fb_unique UNIQUE (user_id, facebook_user_id);


--
-- Name: google_accounts google_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.google_accounts
    ADD CONSTRAINT google_accounts_pkey PRIMARY KEY (id);


--
-- Name: jobs jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT jobs_pkey PRIMARY KEY (id);


--
-- Name: meta_api_usage meta_api_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.meta_api_usage
    ADD CONSTRAINT meta_api_usage_pkey PRIMARY KEY (id);


--
-- Name: packs packs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.packs
    ADD CONSTRAINT packs_pkey PRIMARY KEY (id);


--
-- Name: subscriptions subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);


--
-- Name: subscriptions subscriptions_user_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_user_id_key UNIQUE (user_id);


--
-- Name: user_preferences user_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_preferences
    ADD CONSTRAINT user_preferences_pkey PRIMARY KEY (user_id);


--
-- Name: ad_accounts_user_connection_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ad_accounts_user_connection_idx ON public.ad_accounts USING btree (user_id, connection_id);


--
-- Name: ad_accounts_user_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ad_accounts_user_idx ON public.ad_accounts USING btree (user_id);


--
-- Name: ad_metric_pack_map_user_ad_date_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ad_metric_pack_map_user_ad_date_idx ON public.ad_metric_pack_map USING btree (user_id, ad_id, metric_date);


--
-- Name: ad_metric_pack_map_user_pack_date_ad_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ad_metric_pack_map_user_pack_date_ad_idx ON public.ad_metric_pack_map USING btree (user_id, pack_id, metric_date, ad_id);


--
-- Name: ad_metrics_ad_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ad_metrics_ad_id_idx ON public.ad_metrics USING btree (ad_id);


--
-- Name: ad_metrics_ad_name_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ad_metrics_ad_name_idx ON public.ad_metrics USING btree (ad_name);


--
-- Name: ad_metrics_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ad_metrics_id_idx ON public.ad_metrics USING btree (id);


--
-- Name: ad_metrics_user_ad_date_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ad_metrics_user_ad_date_idx ON public.ad_metrics USING btree (user_id, ad_id, date);


--
-- Name: ad_metrics_user_adset_date_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ad_metrics_user_adset_date_idx ON public.ad_metrics USING btree (user_id, adset_id, date);


--
-- Name: ad_metrics_user_campaign_date_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ad_metrics_user_campaign_date_idx ON public.ad_metrics USING btree (user_id, campaign_id, date);


--
-- Name: ad_metrics_user_date_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ad_metrics_user_date_idx ON public.ad_metrics USING btree (user_id, date);


--
-- Name: ad_metrics_user_name_date_ad_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ad_metrics_user_name_date_ad_idx ON public.ad_metrics USING btree (user_id, ad_name, date, ad_id);


--
-- Name: ad_sheet_integrations_connection_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ad_sheet_integrations_connection_id_idx ON public.ad_sheet_integrations USING btree (connection_id);


--
-- Name: ad_sheet_integrations_last_successful_sync_at_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ad_sheet_integrations_last_successful_sync_at_idx ON public.ad_sheet_integrations USING btree (last_successful_sync_at) WHERE (last_successful_sync_at IS NOT NULL);


--
-- Name: ad_sheet_integrations_owner_global_unique; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX ad_sheet_integrations_owner_global_unique ON public.ad_sheet_integrations USING btree (owner_id) WHERE (pack_id IS NULL);


--
-- Name: ad_sheet_integrations_owner_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ad_sheet_integrations_owner_idx ON public.ad_sheet_integrations USING btree (owner_id);


--
-- Name: ad_sheet_integrations_owner_pack_unique; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX ad_sheet_integrations_owner_pack_unique ON public.ad_sheet_integrations USING btree (owner_id, pack_id);


--
-- Name: ad_sheet_integrations_pack_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ad_sheet_integrations_pack_id_idx ON public.ad_sheet_integrations USING btree (pack_id);


--
-- Name: ad_transcriptions_ad_ids_gin_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ad_transcriptions_ad_ids_gin_idx ON public.ad_transcriptions USING gin (ad_ids);


--
-- Name: ad_transcriptions_user_status_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ad_transcriptions_user_status_idx ON public.ad_transcriptions USING btree (user_id, status);


--
-- Name: ads_account_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ads_account_idx ON public.ads USING btree (account_id);


--
-- Name: ads_ad_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ads_ad_id_idx ON public.ads USING btree (ad_id);


--
-- Name: ads_ad_name_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ads_ad_name_idx ON public.ads USING btree (ad_name);


--
-- Name: ads_campaign_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ads_campaign_idx ON public.ads USING btree (campaign_id);


--
-- Name: ads_pack_ids_gin; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ads_pack_ids_gin ON public.ads USING gin (pack_ids);


--
-- Name: ads_primary_video_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ads_primary_video_id_idx ON public.ads USING btree (primary_video_id) WHERE (primary_video_id IS NOT NULL);


--
-- Name: ads_thumb_cached_at_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ads_thumb_cached_at_idx ON public.ads USING btree (thumb_cached_at) WHERE (thumb_cached_at IS NOT NULL);


--
-- Name: ads_transcription_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ads_transcription_id_idx ON public.ads USING btree (transcription_id) WHERE (transcription_id IS NOT NULL);


--
-- Name: ads_user_adid_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ads_user_adid_idx ON public.ads USING btree (user_id, ad_id);


--
-- Name: ads_user_adset_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ads_user_adset_idx ON public.ads USING btree (user_id, adset_id);


--
-- Name: ads_user_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ads_user_idx ON public.ads USING btree (user_id);


--
-- Name: ads_video_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ads_video_idx ON public.ads USING btree (creative_video_id);


--
-- Name: ads_videos_ids_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ads_videos_ids_idx ON public.ads USING gin (adcreatives_videos_ids) WHERE (adcreatives_videos_ids IS NOT NULL);


--
-- Name: bulk_ad_items_bundle_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX bulk_ad_items_bundle_idx ON public.bulk_ad_items USING btree (job_id, bundle_id);


--
-- Name: bulk_ad_items_job_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX bulk_ad_items_job_idx ON public.bulk_ad_items USING btree (job_id);


--
-- Name: bulk_ad_items_user_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX bulk_ad_items_user_idx ON public.bulk_ad_items USING btree (user_id);


--
-- Name: facebook_connections_fbuser_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX facebook_connections_fbuser_idx ON public.facebook_connections USING btree (facebook_user_id);


--
-- Name: facebook_connections_status_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX facebook_connections_status_idx ON public.facebook_connections USING btree (user_id, status) WHERE (status <> 'active'::text);


--
-- Name: facebook_connections_user_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX facebook_connections_user_idx ON public.facebook_connections USING btree (user_id);


--
-- Name: google_accounts_googleuser_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX google_accounts_googleuser_idx ON public.google_accounts USING btree (google_user_id);


--
-- Name: google_accounts_user_google_unique_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX google_accounts_user_google_unique_idx ON public.google_accounts USING btree (user_id, google_user_id) WHERE (google_user_id IS NOT NULL);


--
-- Name: google_accounts_user_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX google_accounts_user_idx ON public.google_accounts USING btree (user_id);


--
-- Name: jobs_processing_lease_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX jobs_processing_lease_idx ON public.jobs USING btree (user_id, status, processing_lease_until);


--
-- Name: jobs_user_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX jobs_user_idx ON public.jobs USING btree (user_id);


--
-- Name: meta_api_usage_created_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX meta_api_usage_created_idx ON public.meta_api_usage USING btree (created_at DESC);


--
-- Name: meta_api_usage_route_created_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX meta_api_usage_route_created_idx ON public.meta_api_usage USING btree (user_id, route, created_at DESC);


--
-- Name: meta_api_usage_user_created_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX meta_api_usage_user_created_idx ON public.meta_api_usage USING btree (user_id, created_at DESC);


--
-- Name: packs_refresh_lock_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX packs_refresh_lock_idx ON public.packs USING btree (auto_refresh, refresh_status, refresh_lock_until) WHERE (refresh_lock_until IS NOT NULL);


--
-- Name: packs_refresh_status_date_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX packs_refresh_status_date_idx ON public.packs USING btree (refresh_status, last_refreshed_at);


--
-- Name: packs_sheet_integration_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX packs_sheet_integration_id_idx ON public.packs USING btree (sheet_integration_id);


--
-- Name: packs_user_adaccount_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX packs_user_adaccount_idx ON public.packs USING btree (user_id, adaccount_id);


--
-- Name: packs_user_created_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX packs_user_created_idx ON public.packs USING btree (user_id, created_at DESC);


--
-- Name: packs_user_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX packs_user_idx ON public.packs USING btree (user_id);


--
-- Name: packs_user_normalized_name_unique_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX packs_user_normalized_name_unique_idx ON public.packs USING btree (user_id, lower(btrim(name)));


--
-- Name: INDEX packs_user_normalized_name_unique_idx; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON INDEX public.packs_user_normalized_name_unique_idx IS 'Garante unicidade de nome de pack por usuário usando trim + lower.';


--
-- Name: facebook_connections trg_facebook_connections_set_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_facebook_connections_set_updated_at BEFORE UPDATE ON public.facebook_connections FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: google_accounts trg_google_accounts_set_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_google_accounts_set_updated_at BEFORE UPDATE ON public.google_accounts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: subscriptions trg_subscriptions_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_subscriptions_updated_at BEFORE UPDATE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION public.set_subscriptions_updated_at();


--
-- Name: ad_accounts ad_accounts_connection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ad_accounts
    ADD CONSTRAINT ad_accounts_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.facebook_connections(id) ON DELETE SET NULL;


--
-- Name: ad_metric_pack_map ad_metric_pack_map_metric_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ad_metric_pack_map
    ADD CONSTRAINT ad_metric_pack_map_metric_fk FOREIGN KEY (user_id, ad_id, metric_date) REFERENCES public.ad_metrics(user_id, ad_id, date) ON DELETE CASCADE;


--
-- Name: ad_sheet_integrations ad_sheet_integrations_pack_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ad_sheet_integrations
    ADD CONSTRAINT ad_sheet_integrations_pack_id_fkey FOREIGN KEY (pack_id) REFERENCES public.packs(id) ON DELETE CASCADE;


--
-- Name: ads ads_transcription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ads
    ADD CONSTRAINT ads_transcription_id_fkey FOREIGN KEY (transcription_id) REFERENCES public.ad_transcriptions(id) ON DELETE SET NULL;


--
-- Name: facebook_connections facebook_connections_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.facebook_connections
    ADD CONSTRAINT facebook_connections_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: google_accounts google_accounts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.google_accounts
    ADD CONSTRAINT google_accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: meta_api_usage meta_api_usage_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.meta_api_usage
    ADD CONSTRAINT meta_api_usage_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: packs packs_sheet_integration_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.packs
    ADD CONSTRAINT packs_sheet_integration_id_fkey FOREIGN KEY (sheet_integration_id) REFERENCES public.ad_sheet_integrations(id) ON DELETE SET NULL;


--
-- Name: subscriptions subscriptions_granted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES auth.users(id);


--
-- Name: subscriptions subscriptions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: bulk_ad_items Users insert own bulk_ad_items; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users insert own bulk_ad_items" ON public.bulk_ad_items FOR INSERT WITH CHECK ((user_id = (SELECT auth.uid())));


--
-- Name: bulk_ad_items Users read own bulk_ad_items; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users read own bulk_ad_items" ON public.bulk_ad_items FOR SELECT USING ((user_id = (SELECT auth.uid())));


--
-- Name: bulk_ad_items Users update own bulk_ad_items; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users update own bulk_ad_items" ON public.bulk_ad_items FOR UPDATE USING ((user_id = (SELECT auth.uid())));


--
-- Name: ad_accounts; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.ad_accounts ENABLE ROW LEVEL SECURITY;

--
-- Name: ad_accounts ad_accounts_modify_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY ad_accounts_modify_own ON public.ad_accounts USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: ad_metric_pack_map; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.ad_metric_pack_map ENABLE ROW LEVEL SECURITY;

--
-- Name: ad_metric_pack_map ad_metric_pack_map_modify_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY ad_metric_pack_map_modify_own ON public.ad_metric_pack_map USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: ad_metrics; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.ad_metrics ENABLE ROW LEVEL SECURITY;

--
-- Name: ad_metrics ad_metrics_modify_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY ad_metrics_modify_own ON public.ad_metrics USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: ad_sheet_integrations; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.ad_sheet_integrations ENABLE ROW LEVEL SECURITY;

--
-- Name: ad_sheet_integrations ad_sheet_integrations_modify_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY ad_sheet_integrations_modify_own ON public.ad_sheet_integrations USING ((owner_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((owner_id = ( SELECT auth.uid() AS uid)));


--
-- Name: ad_transcriptions; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.ad_transcriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: ad_transcriptions ad_transcriptions_modify_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY ad_transcriptions_modify_own ON public.ad_transcriptions USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: ads; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.ads ENABLE ROW LEVEL SECURITY;

--
-- Name: ads ads_modify_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY ads_modify_own ON public.ads USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: bulk_ad_items; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.bulk_ad_items ENABLE ROW LEVEL SECURITY;

--
-- Name: facebook_connections; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.facebook_connections ENABLE ROW LEVEL SECURITY;

--
-- Name: facebook_connections facebook_connections_modify_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY facebook_connections_modify_own ON public.facebook_connections USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: google_accounts; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.google_accounts ENABLE ROW LEVEL SECURITY;

--
-- Name: google_accounts google_accounts_modify_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY google_accounts_modify_own ON public.google_accounts USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: jobs; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: jobs jobs_modify_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY jobs_modify_own ON public.jobs USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: meta_api_usage; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.meta_api_usage ENABLE ROW LEVEL SECURITY;

--
-- Name: meta_api_usage meta_usage_read_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY meta_usage_read_own ON public.meta_api_usage FOR SELECT TO authenticated USING ((user_id = (SELECT auth.uid())));


--
-- Name: packs; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.packs ENABLE ROW LEVEL SECURITY;

--
-- Name: packs packs_modify_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY packs_modify_own ON public.packs USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: subscriptions; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: subscriptions subscriptions_select_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY subscriptions_select_own ON public.subscriptions FOR SELECT USING ((user_id = (SELECT auth.uid())));


--
-- Name: user_preferences; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

--
-- Name: user_preferences user_preferences_modify_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY user_preferences_modify_own ON public.user_preferences USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: pg_database_owner
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION batch_add_pack_id_to_arrays(p_user_id uuid, p_pack_id uuid, p_table_name text, p_ids_to_update text[]); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.batch_add_pack_id_to_arrays(p_user_id uuid, p_pack_id uuid, p_table_name text, p_ids_to_update text[]) TO anon;
GRANT ALL ON FUNCTION public.batch_add_pack_id_to_arrays(p_user_id uuid, p_pack_id uuid, p_table_name text, p_ids_to_update text[]) TO authenticated;
GRANT ALL ON FUNCTION public.batch_add_pack_id_to_arrays(p_user_id uuid, p_pack_id uuid, p_table_name text, p_ids_to_update text[]) TO service_role;


--
-- Name: FUNCTION batch_remove_pack_id_from_arrays(p_user_id uuid, p_pack_id uuid, p_table_name text, p_ids_to_update text[]); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.batch_remove_pack_id_from_arrays(p_user_id uuid, p_pack_id uuid, p_table_name text, p_ids_to_update text[]) TO anon;
GRANT ALL ON FUNCTION public.batch_remove_pack_id_from_arrays(p_user_id uuid, p_pack_id uuid, p_table_name text, p_ids_to_update text[]) TO authenticated;
GRANT ALL ON FUNCTION public.batch_remove_pack_id_from_arrays(p_user_id uuid, p_pack_id uuid, p_table_name text, p_ids_to_update text[]) TO service_role;


--
-- Name: FUNCTION batch_update_ad_metrics_enrichment(p_user_id uuid, p_updates jsonb, p_pack_id uuid); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.batch_update_ad_metrics_enrichment(p_user_id uuid, p_updates jsonb, p_pack_id uuid) TO anon;
GRANT ALL ON FUNCTION public.batch_update_ad_metrics_enrichment(p_user_id uuid, p_updates jsonb, p_pack_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.batch_update_ad_metrics_enrichment(p_user_id uuid, p_updates jsonb, p_pack_id uuid) TO service_role;


--
-- Name: FUNCTION claim_job_processing(p_job_id text, p_user_id uuid, p_owner text, p_lease_seconds integer); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.claim_job_processing(p_job_id text, p_user_id uuid, p_owner text, p_lease_seconds integer) TO anon;
GRANT ALL ON FUNCTION public.claim_job_processing(p_job_id text, p_user_id uuid, p_owner text, p_lease_seconds integer) TO authenticated;
GRANT ALL ON FUNCTION public.claim_job_processing(p_job_id text, p_user_id uuid, p_owner text, p_lease_seconds integer) TO service_role;


--
-- Name: FUNCTION diagnose_manager_rpc_timing(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[]); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.diagnose_manager_rpc_timing(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[]) TO anon;
GRANT ALL ON FUNCTION public.diagnose_manager_rpc_timing(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[]) TO authenticated;
GRANT ALL ON FUNCTION public.diagnose_manager_rpc_timing(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[]) TO service_role;


--
-- Name: FUNCTION fetch_ad_metrics_for_analytics(p_user_id uuid, p_date_start date, p_date_stop date, p_pack_ids uuid[], p_account_ids text[]); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.fetch_ad_metrics_for_analytics(p_user_id uuid, p_date_start date, p_date_stop date, p_pack_ids uuid[], p_account_ids text[]) TO anon;
GRANT ALL ON FUNCTION public.fetch_ad_metrics_for_analytics(p_user_id uuid, p_date_start date, p_date_stop date, p_pack_ids uuid[], p_account_ids text[]) TO authenticated;
GRANT ALL ON FUNCTION public.fetch_ad_metrics_for_analytics(p_user_id uuid, p_date_start date, p_date_stop date, p_pack_ids uuid[], p_account_ids text[]) TO service_role;


--
-- Name: FUNCTION fetch_manager_analytics_aggregated(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_include_series boolean, p_include_leadscore boolean, p_series_window integer, p_limit integer, p_order_by text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.fetch_manager_analytics_aggregated(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_include_series boolean, p_include_leadscore boolean, p_series_window integer, p_limit integer, p_order_by text) TO anon;
GRANT ALL ON FUNCTION public.fetch_manager_analytics_aggregated(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_include_series boolean, p_include_leadscore boolean, p_series_window integer, p_limit integer, p_order_by text) TO authenticated;
GRANT ALL ON FUNCTION public.fetch_manager_analytics_aggregated(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_include_series boolean, p_include_leadscore boolean, p_series_window integer, p_limit integer, p_order_by text) TO service_role;


--
-- Name: FUNCTION fetch_manager_analytics_aggregated_base_v047(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_include_series boolean, p_include_leadscore boolean, p_series_window integer, p_limit integer, p_order_by text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.fetch_manager_analytics_aggregated_base_v047(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_include_series boolean, p_include_leadscore boolean, p_series_window integer, p_limit integer, p_order_by text) TO anon;
GRANT ALL ON FUNCTION public.fetch_manager_analytics_aggregated_base_v047(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_include_series boolean, p_include_leadscore boolean, p_series_window integer, p_limit integer, p_order_by text) TO authenticated;
GRANT ALL ON FUNCTION public.fetch_manager_analytics_aggregated_base_v047(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_include_series boolean, p_include_leadscore boolean, p_series_window integer, p_limit integer, p_order_by text) TO service_role;


--
-- Name: FUNCTION fetch_manager_analytics_aggregated_base_v048(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_include_series boolean, p_include_leadscore boolean, p_series_window integer, p_limit integer, p_order_by text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.fetch_manager_analytics_aggregated_base_v048(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_include_series boolean, p_include_leadscore boolean, p_series_window integer, p_limit integer, p_order_by text) TO anon;
GRANT ALL ON FUNCTION public.fetch_manager_analytics_aggregated_base_v048(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_include_series boolean, p_include_leadscore boolean, p_series_window integer, p_limit integer, p_order_by text) TO authenticated;
GRANT ALL ON FUNCTION public.fetch_manager_analytics_aggregated_base_v048(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_include_series boolean, p_include_leadscore boolean, p_series_window integer, p_limit integer, p_order_by text) TO service_role;


--
-- Name: FUNCTION fetch_manager_analytics_aggregated_base_v049(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_include_series boolean, p_include_leadscore boolean, p_series_window integer, p_limit integer, p_order_by text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.fetch_manager_analytics_aggregated_base_v049(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_include_series boolean, p_include_leadscore boolean, p_series_window integer, p_limit integer, p_order_by text) TO anon;
GRANT ALL ON FUNCTION public.fetch_manager_analytics_aggregated_base_v049(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_include_series boolean, p_include_leadscore boolean, p_series_window integer, p_limit integer, p_order_by text) TO authenticated;
GRANT ALL ON FUNCTION public.fetch_manager_analytics_aggregated_base_v049(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_include_series boolean, p_include_leadscore boolean, p_series_window integer, p_limit integer, p_order_by text) TO service_role;


--
-- Name: FUNCTION fetch_manager_rankings_core_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.fetch_manager_rankings_core_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text) TO anon;
GRANT ALL ON FUNCTION public.fetch_manager_rankings_core_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text) TO authenticated;
GRANT ALL ON FUNCTION public.fetch_manager_rankings_core_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text) TO service_role;


--
-- Name: FUNCTION fetch_manager_rankings_core_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.fetch_manager_rankings_core_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text) TO anon;
GRANT ALL ON FUNCTION public.fetch_manager_rankings_core_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text) TO authenticated;
GRANT ALL ON FUNCTION public.fetch_manager_rankings_core_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text) TO service_role;


--
-- Name: FUNCTION fetch_manager_rankings_core_v2_base_v059(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.fetch_manager_rankings_core_v2_base_v059(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text) TO anon;
GRANT ALL ON FUNCTION public.fetch_manager_rankings_core_v2_base_v059(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text) TO authenticated;
GRANT ALL ON FUNCTION public.fetch_manager_rankings_core_v2_base_v059(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text) TO service_role;


--
-- Name: FUNCTION fetch_manager_rankings_core_v2_base_v060(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.fetch_manager_rankings_core_v2_base_v060(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text) TO anon;
GRANT ALL ON FUNCTION public.fetch_manager_rankings_core_v2_base_v060(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text) TO authenticated;
GRANT ALL ON FUNCTION public.fetch_manager_rankings_core_v2_base_v060(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text) TO service_role;


--
-- Name: FUNCTION fetch_manager_rankings_core_v2_base_v066(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.fetch_manager_rankings_core_v2_base_v066(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text) TO anon;
GRANT ALL ON FUNCTION public.fetch_manager_rankings_core_v2_base_v066(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text) TO authenticated;
GRANT ALL ON FUNCTION public.fetch_manager_rankings_core_v2_base_v066(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text) TO service_role;


--
-- Name: FUNCTION fetch_manager_rankings_core_v2_base_v067(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.fetch_manager_rankings_core_v2_base_v067(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text) TO anon;
GRANT ALL ON FUNCTION public.fetch_manager_rankings_core_v2_base_v067(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text) TO authenticated;
GRANT ALL ON FUNCTION public.fetch_manager_rankings_core_v2_base_v067(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text) TO service_role;


--
-- Name: FUNCTION fetch_manager_rankings_retention_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_group_key text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.fetch_manager_rankings_retention_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_group_key text) TO anon;
GRANT ALL ON FUNCTION public.fetch_manager_rankings_retention_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_group_key text) TO authenticated;
GRANT ALL ON FUNCTION public.fetch_manager_rankings_retention_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_group_key text) TO service_role;


--
-- Name: FUNCTION fetch_manager_rankings_series_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_group_keys text[], p_window integer); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.fetch_manager_rankings_series_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_group_keys text[], p_window integer) TO anon;
GRANT ALL ON FUNCTION public.fetch_manager_rankings_series_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_group_keys text[], p_window integer) TO authenticated;
GRANT ALL ON FUNCTION public.fetch_manager_rankings_series_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_group_keys text[], p_window integer) TO service_role;


--
-- Name: FUNCTION get_admin_users_list(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.get_admin_users_list() TO anon;
GRANT ALL ON FUNCTION public.get_admin_users_list() TO authenticated;
GRANT ALL ON FUNCTION public.get_admin_users_list() TO service_role;


--
-- Name: FUNCTION handle_new_user_subscription(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.handle_new_user_subscription() TO anon;
GRANT ALL ON FUNCTION public.handle_new_user_subscription() TO authenticated;
GRANT ALL ON FUNCTION public.handle_new_user_subscription() TO service_role;


--
-- Name: FUNCTION release_job_processing_lease(p_job_id text, p_user_id uuid, p_owner text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.release_job_processing_lease(p_job_id text, p_user_id uuid, p_owner text) TO anon;
GRANT ALL ON FUNCTION public.release_job_processing_lease(p_job_id text, p_user_id uuid, p_owner text) TO authenticated;
GRANT ALL ON FUNCTION public.release_job_processing_lease(p_job_id text, p_user_id uuid, p_owner text) TO service_role;


--
-- Name: FUNCTION renew_job_processing_lease(p_job_id text, p_user_id uuid, p_owner text, p_lease_seconds integer); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.renew_job_processing_lease(p_job_id text, p_user_id uuid, p_owner text, p_lease_seconds integer) TO anon;
GRANT ALL ON FUNCTION public.renew_job_processing_lease(p_job_id text, p_user_id uuid, p_owner text, p_lease_seconds integer) TO authenticated;
GRANT ALL ON FUNCTION public.renew_job_processing_lease(p_job_id text, p_user_id uuid, p_owner text, p_lease_seconds integer) TO service_role;


--
-- Name: FUNCTION set_subscriptions_updated_at(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.set_subscriptions_updated_at() TO anon;
GRANT ALL ON FUNCTION public.set_subscriptions_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.set_subscriptions_updated_at() TO service_role;


--
-- Name: FUNCTION set_updated_at(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.set_updated_at() TO anon;
GRANT ALL ON FUNCTION public.set_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.set_updated_at() TO service_role;


--
-- Name: TABLE ad_accounts; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.ad_accounts TO anon;
GRANT ALL ON TABLE public.ad_accounts TO authenticated;
GRANT ALL ON TABLE public.ad_accounts TO service_role;


--
-- Name: TABLE ad_metric_pack_map; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.ad_metric_pack_map TO anon;
GRANT ALL ON TABLE public.ad_metric_pack_map TO authenticated;
GRANT ALL ON TABLE public.ad_metric_pack_map TO service_role;


--
-- Name: TABLE ad_metrics; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.ad_metrics TO anon;
GRANT ALL ON TABLE public.ad_metrics TO authenticated;
GRANT ALL ON TABLE public.ad_metrics TO service_role;


--
-- Name: TABLE ad_sheet_integrations; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.ad_sheet_integrations TO anon;
GRANT ALL ON TABLE public.ad_sheet_integrations TO authenticated;
GRANT ALL ON TABLE public.ad_sheet_integrations TO service_role;


--
-- Name: TABLE ad_transcriptions; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.ad_transcriptions TO anon;
GRANT ALL ON TABLE public.ad_transcriptions TO authenticated;
GRANT ALL ON TABLE public.ad_transcriptions TO service_role;


--
-- Name: TABLE ads; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.ads TO anon;
GRANT ALL ON TABLE public.ads TO authenticated;
GRANT ALL ON TABLE public.ads TO service_role;


--
-- Name: TABLE bulk_ad_items; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.bulk_ad_items TO anon;
GRANT ALL ON TABLE public.bulk_ad_items TO authenticated;
GRANT ALL ON TABLE public.bulk_ad_items TO service_role;


--
-- Name: TABLE facebook_connections; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.facebook_connections TO anon;
GRANT ALL ON TABLE public.facebook_connections TO authenticated;
GRANT ALL ON TABLE public.facebook_connections TO service_role;


--
-- Name: TABLE google_accounts; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.google_accounts TO anon;
GRANT ALL ON TABLE public.google_accounts TO authenticated;
GRANT ALL ON TABLE public.google_accounts TO service_role;


--
-- Name: TABLE jobs; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.jobs TO anon;
GRANT ALL ON TABLE public.jobs TO authenticated;
GRANT ALL ON TABLE public.jobs TO service_role;


--
-- Name: TABLE meta_api_usage; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.meta_api_usage TO anon;
GRANT ALL ON TABLE public.meta_api_usage TO authenticated;
GRANT ALL ON TABLE public.meta_api_usage TO service_role;


--
-- Name: TABLE packs; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.packs TO anon;
GRANT ALL ON TABLE public.packs TO authenticated;
GRANT ALL ON TABLE public.packs TO service_role;


--
-- Name: TABLE subscriptions; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.subscriptions TO anon;
GRANT ALL ON TABLE public.subscriptions TO authenticated;
GRANT ALL ON TABLE public.subscriptions TO service_role;


--
-- Name: TABLE user_preferences; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.user_preferences TO anon;
GRANT ALL ON TABLE public.user_preferences TO authenticated;
GRANT ALL ON TABLE public.user_preferences TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- PostgreSQL database dump complete
--

\unrestrict 8sGWEXHQpg1DQpanF9Dwl4gc6jm1rRXDu9pRUPC3piNtF8ZJV2ezbMBj5wg5e5x

