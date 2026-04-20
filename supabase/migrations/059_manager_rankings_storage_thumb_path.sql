-- Migration 059
-- Manager rankings RPC: include ads.thumb_storage_path in each returned row item.
-- Keep the current core implementation intact and wrap its JSON payload.

do $$
begin
  if to_regprocedure('public.fetch_manager_rankings_core_v2_base_v059(uuid,date,date,text,uuid[],text[],text,text,text,text,boolean,boolean,integer,integer,text)') is null then
    alter function public.fetch_manager_rankings_core_v2(
      uuid, date, date, text, uuid[], text[], text, text, text, text, boolean, boolean, integer, integer, text
    ) rename to fetch_manager_rankings_core_v2_base_v059;
  end if;
end;
$$;

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
language sql
security definer
set search_path = public
as $$
  with payload as (
    select public.fetch_manager_rankings_core_v2_base_v059(
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

grant execute on function public.fetch_manager_rankings_core_v2(
  uuid, date, date, text, uuid[], text[], text, text, text, text, boolean, boolean, integer, integer, text
) to authenticated;

comment on function public.fetch_manager_rankings_core_v2(
  uuid, date, date, text, uuid[], text[], text, text, text, text, boolean, boolean, integer, integer, text
) is
'Manager core v2 wrapper: appends ads.thumb_storage_path to each row in data while preserving the existing base implementation.';
