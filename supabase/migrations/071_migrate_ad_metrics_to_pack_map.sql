-- Migration 071: Migrar ad_metrics de pack_ids[] para ad_metric_pack_map
--
-- O que esta migration faz:
--   1. Backfill: popula ad_metric_pack_map com dados históricos de pack_ids[]
--   2. Cria fetch_manager_analytics_aggregated_base_v048 com dual-read
--   3. Atualiza wrapper fetch_manager_analytics_aggregated → _v048
--   4. Atualiza batch_update_ad_metrics_enrichment → usa EXISTS em ad_metric_pack_map
--
-- Fases posteriores (não nesta migration):
--   - Remover fallback OR pack_ids && p_pack_ids após confirmar paridade (Fase 3)
--   - Parar dual-write no Python (Fase 4)
--   - Dropar coluna ad_metrics.pack_ids (Fase 5)


-- ═══════════════════════════════════════════════════════════════════════════
-- FASE 0: Backfill — popula ad_metric_pack_map com dados históricos
-- ═══════════════════════════════════════════════════════════════════════════
INSERT INTO public.ad_metric_pack_map (user_id, pack_id, ad_id, metric_date, created_at)
SELECT
  am.user_id,
  unnest(am.pack_ids) AS pack_id,
  am.ad_id,
  am.date AS metric_date,
  now()
FROM public.ad_metrics am
WHERE am.pack_ids IS NOT NULL AND array_length(am.pack_ids, 1) > 0
ON CONFLICT (user_id, pack_id, ad_id, metric_date) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
-- FASE 1a: Criar fetch_manager_analytics_aggregated_base_v048
-- Única mudança em relação à _v047: a cláusula de filtro por pack usa dual-read
-- (EXISTS em ad_metric_pack_map + OR fallback no array legado)
-- ═══════════════════════════════════════════════════════════════════════════
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

COMMENT ON FUNCTION public.fetch_manager_analytics_aggregated_base_v048(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_include_series boolean, p_include_leadscore boolean, p_series_window integer, p_limit integer, p_order_by text) IS 'Manager aggregated base v048: mesmo que _v047 mas com dual-read (EXISTS em ad_metric_pack_map + OR fallback pack_ids[]).';


-- ═══════════════════════════════════════════════════════════════════════════
-- FASE 1a (cont.): Atualizar wrapper para chamar _v048 em vez de _v047
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fetch_manager_analytics_aggregated(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text DEFAULT 'ad_name'::text, p_pack_ids uuid[] DEFAULT NULL::uuid[], p_account_ids text[] DEFAULT NULL::text[], p_campaign_name_contains text DEFAULT NULL::text, p_adset_name_contains text DEFAULT NULL::text, p_ad_name_contains text DEFAULT NULL::text, p_include_series boolean DEFAULT true, p_include_leadscore boolean DEFAULT true, p_series_window integer DEFAULT 7, p_limit integer DEFAULT 10000, p_order_by text DEFAULT 'spend'::text) RETURNS jsonb
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
  select public.fetch_manager_analytics_aggregated_base_v048(
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

COMMENT ON FUNCTION public.fetch_manager_analytics_aggregated(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_include_series boolean, p_include_leadscore boolean, p_series_window integer, p_limit integer, p_order_by text) IS 'Manager aggregated RPC wrapper: enriches the payload with native cpc/cplc values and averages while preserving the existing contract.';


-- ═══════════════════════════════════════════════════════════════════════════
-- FASE 1b: Atualizar batch_update_ad_metrics_enrichment
-- Substituir pack_ids @> ARRAY[p_pack_id] por EXISTS em ad_metric_pack_map
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.batch_update_ad_metrics_enrichment(p_user_id uuid, p_updates jsonb, p_pack_id uuid DEFAULT NULL::uuid) RETURNS jsonb
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
  -- Collect all IDs in SQL aggregate (avoids O(n²) concatenation in PL/pgSQL loop)
  SELECT array_agg(id_val)
  INTO all_ids
  FROM jsonb_array_elements(p_updates) AS item,
  LATERAL jsonb_array_elements_text(item->'ids') AS id_val;

  total_ids_sent := coalesce(array_length(all_ids, 1), 0);

  -- Single UPDATE via expanded CTE
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
    -- MIGRADO: usa ad_metric_pack_map + fallback legado pack_ids[]
    AND (
      p_pack_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.ad_metric_pack_map apm
        WHERE apm.user_id = am.user_id
          AND apm.ad_id = am.ad_id
          AND apm.metric_date = am.date
          AND apm.pack_id = p_pack_id
      )
      OR am.pack_ids @> ARRAY[p_pack_id]::uuid[]
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
          OR pack_ids @> ARRAY[p_pack_id]::uuid[]
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

COMMENT ON FUNCTION public.batch_update_ad_metrics_enrichment(p_user_id uuid, p_updates jsonb, p_pack_id uuid) IS 'Atualiza multiplos registros de ad_metrics em uma unica transacao via UPDATE + CTE, aplicando apenas leadscore_values (fluxo Leadscore-only). Usa dual-read: EXISTS em ad_metric_pack_map + OR fallback pack_ids[].';
