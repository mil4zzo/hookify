-- Manager rankings core v2: resolve campaign/adset status from local parent pause markers.
--
-- Parent rows should represent the entity status, not whether child ads can deliver.
-- - adset_id rows are paused only when ads.effective_status contains ADSET_PAUSED.
-- - campaign_id rows are paused only when ads.effective_status contains CAMPAIGN_PAUSED.

do $$
begin
  if to_regprocedure('public.fetch_manager_rankings_core_v2_base_v067(uuid,date,date,text,uuid[],text[],text,text,text,text,boolean,boolean,integer,integer,text,text)') is null then
    alter function public.fetch_manager_rankings_core_v2(
      uuid, date, date, text, uuid[], text[], text, text, text, text, boolean, boolean, integer, integer, text, text
    ) rename to fetch_manager_rankings_core_v2_base_v067;
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
language plpgsql
security definer
set search_path = public
as $$
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

grant execute on function public.fetch_manager_rankings_core_v2(
  uuid, date, date, text, uuid[], text[], text, text, text, text, boolean, boolean, integer, integer, text, text
) to authenticated;

comment on function public.fetch_manager_rankings_core_v2(
  uuid, date, date, text, uuid[], text[], text, text, text, text, boolean, boolean, integer, integer, text, text
) is
'Manager core v2 wrapper: resolves campaign/adset effective_status from local hierarchical pause markers while preserving the existing payload contract.';
