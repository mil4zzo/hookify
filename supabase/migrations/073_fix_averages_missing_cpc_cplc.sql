--
-- Migration 073: Fix cpc e cplc ausentes no objeto averages da RPC de rankings
--
-- Problema:
--   fetch_manager_rankings_core_v2_base_v059 e _v060 nunca incluíram 'cpc' e 'cplc'
--   no CTE averages_payload. A função legada Python os calcula corretamente como:
--     cpc  = total_spend / total_clicks
--     cplc = total_spend / total_inline_link_clicks
--   mas a RPC devolvia null para ambos, gerando divergências no AB shadow.
--
-- Estratégia:
--   Em vez de recriar a função base (~600 linhas), remendamos o wrapper
--   fetch_manager_rankings_core_v2 para injetar cpc e cplc nos averages.
--
--   Equivalência matemática usada (evita precisar dos totais brutos paginados):
--     cpc  = cpm / (1000 × ctr)         (pois cpm = spend*1000/impressions, ctr = clicks/impressions)
--     cplc = cpm / (1000 × website_ctr) (pois website_ctr = inline_link_clicks/impressions)
--
--   cpm, ctr e website_ctr já são calculados sobre TODOS os dados (antes da paginação),
--   portanto o resultado é idêntico a total_spend / total_clicks e total_spend / total_inline.
--
-- Aplicar também nas bases diretamente:
--   As funções _v059 e _v060 foram corrigidas em schema.sql (v059) e migration 072 (v060).
--   Esta migration garante que o banco de dados deployado reflita o estado correto.
--


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
  p_order_by text DEFAULT 'spend'::text
) RETURNS jsonb
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
  ),
  -- Injeta cpc e cplc nos averages usando equivalência matemática:
  --   cpc  = cpm / (1000 * ctr)
  --   cplc = cpm / (1000 * website_ctr)
  -- Isso é idêntico a total_spend/total_clicks e total_spend/total_inline,
  -- mas derivável dos averages já computados pela função base (sobre todos os dados,
  -- antes da paginação), sem precisar dos totais brutos.
  patched_averages as (
    select
      coalesce(p.body->'averages', '{}'::jsonb)
      || jsonb_build_object(
          'cpc',
          case
            when (p.body->'averages'->>'ctr')::numeric > 0
            then to_jsonb(
              (p.body->'averages'->>'cpm')::numeric
              / (1000.0 * (p.body->'averages'->>'ctr')::numeric)
            )
            else to_jsonb(0::numeric)
          end,
          'cplc',
          case
            when (p.body->'averages'->>'website_ctr')::numeric > 0
            then to_jsonb(
              (p.body->'averages'->>'cpm')::numeric
              / (1000.0 * (p.body->'averages'->>'website_ctr')::numeric)
            )
            else to_jsonb(0::numeric)
          end
        ) as averages
    from payload p
  )
  select case
    when jsonb_typeof(p.body) = 'object' then
      p.body
      || jsonb_build_object('data', hd.data)
      || jsonb_build_object('averages', pa.averages)
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
  cross join hydrated_data hd
  cross join patched_averages pa;
$$;
