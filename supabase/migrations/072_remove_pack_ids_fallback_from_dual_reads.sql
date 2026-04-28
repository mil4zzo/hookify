--
-- Migration 072: Fase 3 — Remover fallback pack_ids[] dos dual-reads
--
-- O que esta migration faz:
--   Remove o "OR am.pack_ids && p_pack_ids" de todas as funções que usavam
--   dual-read (EXISTS em ad_metric_pack_map + fallback no array legado).
--   Após a migration 071 e confirmação de paridade de dados, o fallback não é
--   mais necessário — ad_metric_pack_map é a única fonte de verdade para
--   o relacionamento ad_metric ↔ pack.
--
-- Funções atualizadas:
--   1. fetch_ad_metrics_for_analytics          (in-place)
--   2. fetch_manager_rankings_core_v2_base_v059 → _v060 (nova versão)
--      + wrapper fetch_manager_rankings_core_v2  (aponta para _v060)
--   3. fetch_manager_rankings_retention_v2     (in-place)
--   4. fetch_manager_rankings_series_v2        (in-place)
--   5. fetch_manager_analytics_aggregated_base_v048 → _v049 (nova versão)
--      + wrapper fetch_manager_analytics_aggregated  (aponta para _v049)
--   6. batch_update_ad_metrics_enrichment      (in-place, 2 ocorrências)
--


-- ═══════════════════════════════════════════════════════════════════════════
-- 1. fetch_ad_metrics_for_analytics (in-place)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fetch_ad_metrics_for_analytics(p_user_id uuid, p_date_start date, p_date_stop date, p_pack_ids uuid[] DEFAULT NULL::uuid[], p_account_ids text[] DEFAULT NULL::text[]) RETURNS SETOF jsonb
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


-- ═══════════════════════════════════════════════════════════════════════════
-- 2a. fetch_manager_rankings_core_v2_base_v060
--     Único delta em relação à _v059: removido "or am.pack_ids && p_pack_ids"
-- ═══════════════════════════════════════════════════════════════════════════
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

-- 2b. Atualizar wrapper para chamar _v060
CREATE OR REPLACE FUNCTION public.fetch_manager_rankings_core_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text DEFAULT 'ad_name'::text, p_pack_ids uuid[] DEFAULT NULL::uuid[], p_account_ids text[] DEFAULT NULL::text[], p_campaign_name_contains text DEFAULT NULL::text, p_adset_name_contains text DEFAULT NULL::text, p_ad_name_contains text DEFAULT NULL::text, p_action_type text DEFAULT NULL::text, p_include_leadscore boolean DEFAULT true, p_include_available_conversion_types boolean DEFAULT true, p_limit integer DEFAULT 500, p_offset integer DEFAULT 0, p_order_by text DEFAULT 'spend'::text) RETURNS jsonb
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


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. fetch_manager_rankings_retention_v2 (in-place)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fetch_manager_rankings_retention_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text DEFAULT 'ad_name'::text, p_pack_ids uuid[] DEFAULT NULL::uuid[], p_account_ids text[] DEFAULT NULL::text[], p_campaign_name_contains text DEFAULT NULL::text, p_adset_name_contains text DEFAULT NULL::text, p_ad_name_contains text DEFAULT NULL::text, p_group_key text DEFAULT NULL::text) RETURNS jsonb
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


-- ═══════════════════════════════════════════════════════════════════════════
-- 4. fetch_manager_rankings_series_v2 (in-place)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fetch_manager_rankings_series_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text DEFAULT 'ad_name'::text, p_pack_ids uuid[] DEFAULT NULL::uuid[], p_account_ids text[] DEFAULT NULL::text[], p_campaign_name_contains text DEFAULT NULL::text, p_adset_name_contains text DEFAULT NULL::text, p_ad_name_contains text DEFAULT NULL::text, p_action_type text DEFAULT NULL::text, p_group_keys text[] DEFAULT NULL::text[], p_window integer DEFAULT 5) RETURNS jsonb
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


-- ═══════════════════════════════════════════════════════════════════════════
-- 5a. fetch_manager_analytics_aggregated_base_v049
--     Único delta em relação à _v048: removido "or am.pack_ids && p_pack_ids"
-- ═══════════════════════════════════════════════════════════════════════════
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

-- 5b. Atualizar wrapper para chamar _v049
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


-- ═══════════════════════════════════════════════════════════════════════════
-- 6. batch_update_ad_metrics_enrichment (in-place, remover 2 fallbacks)
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
