-- Migration 038 (diagnóstico — pode ser removida depois)
-- Função temporária para medir o tempo de cada etapa do RPC do Manager.
-- Uso no SQL Editor:
--
--   SELECT * FROM diagnose_manager_rpc_timing(
--     'SEU_USER_ID'::uuid,
--     '2026-02-18'::date,
--     '2026-03-08'::date,
--     'ad_name',
--     ARRAY['PACK_ID_1','PACK_ID_2']::uuid[]
--   );
--
-- Retorna uma tabela com: etapa | linhas processadas | tempo em ms

CREATE OR REPLACE FUNCTION public.diagnose_manager_rpc_timing(
  p_user_id uuid,
  p_date_start date,
  p_date_stop date,
  p_group_by text DEFAULT 'ad_name',
  p_pack_ids uuid[] DEFAULT NULL
)
RETURNS TABLE(step_name text, row_count bigint, elapsed_ms numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '120s'  -- timeout maior para diagnóstico
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

GRANT EXECUTE ON FUNCTION public.diagnose_manager_rpc_timing(uuid, date, date, text, uuid[]) TO authenticated;

COMMENT ON FUNCTION public.diagnose_manager_rpc_timing IS
'Diagnóstico de performance: mede tempo de cada etapa do RPC do Manager. Rodar no SQL Editor com parâmetros reais para identificar gargalos.';
