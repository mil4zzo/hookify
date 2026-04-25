-- Manager rankings core v2: optional exact campaign_id filter for targeted consumers.
-- This preserves the existing wrapper behavior and adds a thin filtered entrypoint.

do $$
begin
  if to_regprocedure('public.fetch_manager_rankings_core_v2_base_v066(uuid,date,date,text,uuid[],text[],text,text,text,text,boolean,boolean,integer,integer,text)') is null then
    alter function public.fetch_manager_rankings_core_v2(
      uuid, date, date, text, uuid[], text[], text, text, text, text, boolean, boolean, integer, integer, text
    ) rename to fetch_manager_rankings_core_v2_base_v066;
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
  p_order_by text default 'spend',
  p_campaign_id text default null
)
returns jsonb
language sql
security definer
set search_path = public
as $$
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

grant execute on function public.fetch_manager_rankings_core_v2(
  uuid, date, date, text, uuid[], text[], text, text, text, text, boolean, boolean, integer, integer, text, text
) to authenticated;

comment on function public.fetch_manager_rankings_core_v2(
  uuid, date, date, text, uuid[], text[], text, text, text, text, boolean, boolean, integer, integer, text, text
) is
'Manager core v2 wrapper: preserves the current payload and supports optional exact campaign_id filtering on returned rows.';
