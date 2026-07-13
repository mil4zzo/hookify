-- 094: "Ads ativos / total" do conjunto passa a bater com o Gerenciador da Meta.
--
-- PROBLEMA
--   O denominador de "N / M anúncios" (ad_count) vinha de mgr_base, ou seja: anúncios com
--   ALGUMA linha em ad_metrics na janela. Um anúncio PAUSADO que nunca entregou não vem do
--   /insights (não entregou) e não recebe linha-zero sintetizada (select_zero_delivery_ads só
--   aceita DELIVERABLE_STATUSES) — logo não existe em ad_metrics NEM em ads, e some do total.
--   Caso real: conjunto com 19 anúncios na Meta exibia 10/12 (os 7 pausados-sem-entrega sumiam).
--
-- SOLUÇÃO (denominador apenas)
--   O inventário completo já é baixado a cada refresh (ads_enricher.fetch_inventory, edge /ads,
--   que inclui pausados). Passamos a persistir a CONTAGEM por adset em parent_entities.ads_count
--   e o wrapper de leitura usa esse valor como ad_count na aba "Por conjunto".
--   Os 7 pausados continuam FORA de ad_metrics/ads — não viram linhas nem poluem métricas.
--   Só a contagem é corrigida (decisão deliberada: ver documentation/decisoes-tecnicas.md).
--
--   active_count NÃO muda: continua contando ACTIVE via join em ads (10 permanece 10).
--   Resultado: 10 / 19, batendo com o Gerenciador.

-- ───────────────────────────────────────────────────────────────────────────
-- 1) Coluna de snapshot do inventário
-- ───────────────────────────────────────────────────────────────────────────
alter table public.parent_entities
  add column if not exists ads_count integer;

comment on column public.parent_entities.ads_count is
  'Total de anúncios do conjunto conforme o inventário do edge /ads (inclui pausados; exclui '
  'archived/deleted, igual ao Gerenciador). Snapshot escrito no refresh. NULL = ainda não '
  'sincronizado -> o read-path cai no ad_count derivado de ad_metrics.';

-- ───────────────────────────────────────────────────────────────────────────
-- 2) Wrapper de leitura: injeta ad_count do inventário na aba "Por conjunto"
--    Mesma definição viva (delegando a _base_v093), com duas mudanças pontuais:
--      a) pb_self passa a selecionar ads_count
--      b) jsonb_build_object passa a sobrescrever 'ad_count' quando há inventário
--    Nada no _base_v093 (agregação pesada) é tocado.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fetch_manager_rankings_core_v2(
  p_user_id uuid,
  p_date_start date,
  p_date_stop date,
  p_group_by text DEFAULT 'ad_name'::text,
  p_pack_ids uuid[] DEFAULT NULL::uuid[],
  p_account_ids text[] DEFAULT NULL::text[],
  p_campaign_name_contains text DEFAULT NULL::text,
  p_adset_name_contains text DEFAULT NULL::text,
  p_ad_name_contains text DEFAULT NULL::text,
  p_action_type text DEFAULT NULL::text,
  p_include_leadscore boolean DEFAULT true,
  p_include_available_conversion_types boolean DEFAULT true,
  p_limit integer DEFAULT 500,
  p_offset integer DEFAULT 0,
  p_order_by text DEFAULT 'spend'::text,
  p_campaign_id text DEFAULT NULL::text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_group_by text := lower(coalesce(p_group_by, 'ad_name'));
  v_payload jsonb;
  v_data jsonb := '[]'::jsonb;
begin
  select public.fetch_manager_rankings_core_v2_base_v093(
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
        end,
        -- Orçamento (read-only): budget da PRÓPRIA entidade da linha, em subunidade da
        -- moeda da conta. NULL = sem budget nesse nível (CBO↔ABO) OU ainda não sincronizado
        -- — budget_mode NULL distingue o segundo caso.
        'budget_daily', pb_self.daily_budget,
        'budget_lifetime', pb_self.lifetime_budget,
        'budget_mode', pb_mode.budget_mode,
        'budget_currency', acct.currency,
        -- Total de anúncios do CONJUNTO pelo inventário (inclui pausados sem entrega, que não
        -- existem em ad_metrics). Sem snapshot -> preserva o ad_count do base (ad_metrics).
        -- group_by='campaign_id' NÃO é tocado: lá ad_count é contagem de CONJUNTOS.
        'ad_count', coalesce(
          case when v_group_by = 'adset_id' then pb_self.ads_count else null end,
          nullif(rr.item->>'ad_count', '')::integer
        )
      ) as item
    from raw_rows rr
    left join lateral (
      select pb.daily_budget, pb.lifetime_budget, pb.account_id, pb.ads_count
      from public.parent_entities pb
      where pb.user_id = p_user_id
        and pb.entity_id = case when v_group_by = 'adset_id' then rr.adset_id else rr.campaign_id end
      limit 1
    ) pb_self on true
    left join lateral (
      -- Modo é atributo da CAMPANHA (mesmo na aba por-conjunto: diz se o budget do adset
      -- existe ou vive na campanha).
      select pb.budget_mode
      from public.parent_entities pb
      where pb.user_id = p_user_id
        and pb.entity_id = rr.campaign_id
      limit 1
    ) pb_mode on true
    left join lateral (
      -- ads.account_id vem sem prefixo act_; ad_accounts.id vem com — normalizar os dois lados.
      select aa.currency
      from public.ad_accounts aa
      where aa.user_id = p_user_id
        and replace(aa.id, 'act_', '') = replace(pb_self.account_id, 'act_', '')
        and nullif(aa.currency, '') is not null
      limit 1
    ) acct on true
  )
  select coalesce(jsonb_agg(item order by ord), '[]'::jsonb)
  into v_data
  from resolved_rows;

  return v_payload || jsonb_build_object('data', v_data);
end;
$function$;
