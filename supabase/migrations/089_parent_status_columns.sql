-- Migration: colunas denormalizadas com o status OFICIAL dos pais + wrapper preferindo-as.
--
-- Contexto: sem tabelas de campanha/adset, o status das linhas de grupo do Manager era
-- INFERIDO dos marcadores X_PAUSED nos filhos — uma implicação de mão única: a presença de
-- ADSET_PAUSED/CAMPAIGN_PAUSED num filho prova pai pausado, mas a AUSÊNCIA não prova pai
-- ativo (pai pausado com todos os filhos pausados individualmente não deixa marcador).
--
-- Fix estrutural: ads.adset_status / ads.campaign_status guardam o effective_status oficial
-- do pai, lido do Meta (edges /act_{id}/adsets|campaigns no enrich; verify no toggle de pai;
-- sync on-focus). O wrapper fetch_manager_rankings_core_v2 passa a preferir essas colunas e
-- só cai na inferência por marcadores (semântica da migration 088) quando ainda NULL
-- (linhas pré-backfill — preenchem no próximo refresh de cada pack).
--
-- Escrita SEMPRE por parent_id (supabase_repo.write_parent_statuses / _write_parent_status_column),
-- nunca por linha de ad — evita linhas do mesmo pai divergentes entre packs. Todas as escritas
-- são best-effort (apenas logam erro se as colunas não existirem), mas aplicar esta migration
-- ANTES do deploy do backend para as colunas começarem a preencher imediatamente.
-- Safe to run multiple times.

alter table public.ads add column if not exists adset_status text;
alter table public.ads add column if not exists campaign_status text;

comment on column public.ads.adset_status is 'effective_status oficial do adset pai (denormalizado; fonte: Meta API — enrich/toggle/sync). NULL = ainda não sincronizado.';
comment on column public.ads.campaign_status is 'effective_status oficial da campanha pai (denormalizado; fonte: Meta API — enrich/toggle/sync). NULL = ainda não sincronizado.';

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
          when v_group_by = 'adset_id' and rr.adset_id is not null then
            coalesce(
              -- Status OFICIAL do adset (denormalizado). Escrito por parent_id em todas as
              -- linhas do pai; o ORDER BY por recência é defesa em profundidade caso linhas
              -- do mesmo pai divirjam (ex.: escrita parcial interrompida).
              (
                select nullif(a.adset_status, '')
                from public.ads a
                where a.user_id = p_user_id
                  and a.adset_id = rr.adset_id
                  and nullif(a.adset_status, '') is not null
                order by a.updated_at desc nulls last
                limit 1
              ),
              -- Fallback pré-backfill: inferência por marcadores nos filhos (migration 088)
              case
                when exists (
                  select 1 from public.ads a
                  where a.user_id = p_user_id
                    and a.adset_id = rr.adset_id
                    and upper(coalesce(a.effective_status, '')) = 'ADSET_PAUSED'
                  limit 1
                ) then 'ADSET_PAUSED'
                when exists (
                  select 1 from public.ads a
                  where a.user_id = p_user_id
                    and a.adset_id = rr.adset_id
                    and upper(coalesce(a.effective_status, '')) = 'CAMPAIGN_PAUSED'
                  limit 1
                ) then 'CAMPAIGN_PAUSED'
                else 'ACTIVE'
              end
            )
          when v_group_by = 'campaign_id' and rr.campaign_id is not null then
            coalesce(
              (
                select nullif(a.campaign_status, '')
                from public.ads a
                where a.user_id = p_user_id
                  and a.campaign_id = rr.campaign_id
                  and nullif(a.campaign_status, '') is not null
                order by a.updated_at desc nulls last
                limit 1
              ),
              case
                when exists (
                  select 1 from public.ads a
                  where a.user_id = p_user_id
                    and a.campaign_id = rr.campaign_id
                    and upper(coalesce(a.effective_status, '')) = 'CAMPAIGN_PAUSED'
                  limit 1
                ) then 'CAMPAIGN_PAUSED'
                else 'ACTIVE'
              end
            )
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

COMMENT ON FUNCTION public.fetch_manager_rankings_core_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text) IS 'Manager core v2 wrapper: resolves campaign/adset effective_status preferring the official denormalized parent status (ads.adset_status/campaign_status), falling back to hierarchical pause markers for pre-backfill rows.';
