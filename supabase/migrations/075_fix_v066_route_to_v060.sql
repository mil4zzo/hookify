--
-- Migration 075: Fix _v066 to call _v060 (não _v059) — desbloqueia drop de ad_metrics.pack_ids
--
-- Contexto:
--   Após aplicar migration 074 (drop column ad_metrics.pack_ids), o endpoint
--   /analytics/ad-performance passou a falhar com:
--     'column am.pack_ids does not exist'
--
-- Investigação revelou cadeia de chamadas no DB remoto:
--   wrapper fetch_manager_rankings_core_v2 (com p_campaign_id)
--     → _v067 (campaign_id filter layer)
--       → _v066 (passthrough)
--         → _v059  ← AQUI: ainda referenciava am.pack_ids
--
--   Migration 072 trocou o wrapper para chamar _v060 (sem pack_ids), mas
--   _v066/_v067 (versões introduzidas direto no remoto, sem migration local)
--   continuavam apontando para _v059. Resultado: _v060 ficou órfão e a coluna
--   dropada quebrou a cadeia _v067 → _v066 → _v059.
--
-- Fix:
--   Reescreve _v066 para chamar _v060 em vez de _v059. Mudança de uma única linha
--   no corpo da função.
--
-- Pós-aplicação:
--   _v059 ainda existe mas fica não-referenciado (pode ser dropado em cleanup futuro).
--   _v060 volta a ser de fato usado pela cadeia.
--

CREATE OR REPLACE FUNCTION public.fetch_manager_rankings_core_v2_base_v066(
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
