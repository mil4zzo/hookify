-- Migration 046
-- Add video_watched_p50 to averages in fetch_manager_rankings_core_v2.
-- totals CTE was missing total_video_watched_p50_wsum; averages_payload was missing video_watched_p50.
-- video_watched_p50_wsum already existed in group_agg/rows_enriched/rows_metrics (migration 042).

create or replace function public.fetch_manager_rankings_core_v2(
  p_user_id uuid,
  p_date_start date,
  p_date_stop date,
  p_group_by text default 'ad_name',
  p_pack_ids uuid[] default null,
  p_account_ids text[] default null,
  p_campaign_name_contains text default null,
  p_adset_name_contains text default null,
  p_ad_name_contains text default null,
  p_action_type text default null,
  p_include_leadscore boolean default true,
  p_include_available_conversion_types boolean default true,
  p_limit integer default 500,
  p_offset integer default 0,
  p_order_by text default 'spend'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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

grant execute on function public.fetch_manager_rankings_core_v2(
  uuid, date, date, text, uuid[], text[], text, text, text, text, boolean, boolean, integer, integer, text
) to authenticated;

comment on function public.fetch_manager_rankings_core_v2(
  uuid, date, date, text, uuid[], text[], text, text, text, text, boolean, boolean, integer, integer, text
) is
'Manager core v2 RPC: aggregated rows + header + pagination, dedup by (user_id, ad_id, date), selected action metrics only. Averages include hold_rate and video_watched_p50.';
