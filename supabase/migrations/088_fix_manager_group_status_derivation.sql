-- Migration: derivação mais fiel do effective_status de linhas adset/campaign no Manager.
--
-- Contexto: o wrapper fetch_manager_rankings_core_v2 (16 args) derivava o status do grupo
-- como "existe filho com ADSET_PAUSED/CAMPAIGN_PAUSED? senão ACTIVE". Isso fazia conjuntos
-- de uma campanha PAUSADA aparecerem como ACTIVE na aba "por conjunto" (os filhos carregam
-- CAMPAIGN_PAUSED, não ADSET_PAUSED), contradizendo a aba "por campanha" na mesma tela.
--
-- Fix: linha de adset também herda CAMPAIGN_PAUSED quando algum filho tem esse marcador.
-- Ordem dos casos: ADSET_PAUSED (pausa do próprio conjunto) tem precedência sobre
-- CAMPAIGN_PAUSED (pausa herdada de cima), ambos sobre o default ACTIVE.
--
-- Limitação conhecida (documentada em decisoes-tecnicas.md): pai pausado cujos filhos estão
-- TODOS pausados individualmente não deixa marcador X_PAUSED nos filhos (o Meta reporta
-- PAUSED próprio) e segue aparecendo ACTIVE até um refresh trazer marcadores. Sem tabelas de
-- campanha/adset não há onde guardar o status próprio do pai.
--
-- Safe to run multiple times (CREATE OR REPLACE).

CREATE OR REPLACE FUNCTION public.fetch_manager_rankings_core_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text DEFAULT 'ad_name'::text, p_pack_ids uuid[] DEFAULT NULL::uuid[], p_account_ids text[] DEFAULT NULL::text[], p_campaign_name_contains text DEFAULT NULL::text, p_adset_name_contains text DEFAULT NULL::text, p_ad_name_contains text DEFAULT NULL::text, p_action_type text DEFAULT NULL::text, p_include_leadscore boolean DEFAULT true, p_include_available_conversion_types boolean DEFAULT true, p_limit integer DEFAULT 500, p_offset integer DEFAULT 0, p_order_by text DEFAULT 'spend'::text, p_campaign_id text DEFAULT NULL::text) RETURNS jsonb
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
          when v_group_by = 'adset_id' and rr.adset_id is not null and exists (
            select 1
            from public.ads a
            where a.user_id = p_user_id
              and a.adset_id = rr.adset_id
              and upper(coalesce(a.effective_status, '')) = 'CAMPAIGN_PAUSED'
            limit 1
          ) then 'CAMPAIGN_PAUSED'
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

COMMENT ON FUNCTION public.fetch_manager_rankings_core_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text) IS 'Manager core v2 wrapper: resolves campaign/adset effective_status from local hierarchical pause markers (ADSET_PAUSED > CAMPAIGN_PAUSED > ACTIVE) while preserving the existing payload contract.';
