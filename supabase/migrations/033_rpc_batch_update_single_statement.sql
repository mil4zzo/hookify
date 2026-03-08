-- Migration: Reescrever batch_update_ad_metrics_enrichment para usar UPDATE único via CTE
-- Motivo: a versão anterior fazia N UPDATEs individuais em loop + O(n²) na concatenação
-- de all_ids, causando statement_timeout em packs com muitos anúncios.
-- Nova abordagem: um único UPDATE via CTE expandida (jsonb_array_elements + LATERAL unnest),
-- eliminando o loop e resolvendo o problema de performance na raiz.

CREATE OR REPLACE FUNCTION public.batch_update_ad_metrics_enrichment(
  p_user_id uuid,
  p_updates jsonb,
  p_pack_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  total_rows_updated int := 0;
  total_ids_sent     int := 0;
  existing_count     int := 0;
  in_pack_count      int := 0;
  all_ids            text[];
BEGIN
  -- Coletar todos os IDs via SQL aggregate (evita O(n²) de concatenação em loop plpgsql)
  SELECT array_agg(id_val)
  INTO all_ids
  FROM jsonb_array_elements(p_updates) AS item,
  LATERAL jsonb_array_elements_text(item->'ids') AS id_val;

  total_ids_sent := coalesce(array_length(all_ids, 1), 0);

  -- UPDATE único via CTE expandida — elimina o loop de N updates individuais
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
      END AS leadscore_vals,
      CASE
        WHEN item ? 'cpr_max'
          AND item->'cpr_max' IS NOT NULL
          AND item->'cpr_max' != 'null'::jsonb
        THEN (item->>'cpr_max')::numeric
        ELSE NULL
      END AS cpr_max_val
    FROM jsonb_array_elements(p_updates) AS item,
    LATERAL jsonb_array_elements_text(item->'ids') AS id_val
  )
  UPDATE public.ad_metrics am
  SET
    leadscore_values = CASE
      WHEN e.leadscore_vals IS NOT NULL THEN e.leadscore_vals
      ELSE am.leadscore_values
    END,
    cpr_max = CASE
      WHEN e.cpr_max_val IS NOT NULL THEN e.cpr_max_val
      ELSE am.cpr_max
    END,
    updated_at = now()
  FROM expanded e
  WHERE am.id = e.id
    AND am.user_id = p_user_id
    AND (p_pack_id IS NULL OR am.pack_ids @> ARRAY[p_pack_id]::uuid[]);

  GET DIAGNOSTICS total_rows_updated = ROW_COUNT;

  -- Breakdown: contar existentes e dentro do pack para estatísticas
  IF total_ids_sent > 0 THEN
    SELECT
      count(*)::int,
      count(*) FILTER (
        WHERE p_pack_id IS NULL OR pack_ids @> ARRAY[p_pack_id]::uuid[]
      )::int
    INTO existing_count, in_pack_count
    FROM public.ad_metrics
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

GRANT EXECUTE ON FUNCTION public.batch_update_ad_metrics_enrichment(uuid, jsonb, uuid) TO authenticated;

COMMENT ON FUNCTION public.batch_update_ad_metrics_enrichment IS
  'Atualiza múltiplos registros de ad_metrics em uma única transação via UPDATE + CTE. '
  'Usa jsonb_array_elements + LATERAL unnest para expandir todos os IDs em um único '
  'UPDATE statement, evitando loop de N updates que causava statement_timeout em packs grandes. '
  'Aceita p_pack_id opcional para restringir às métricas cujo pack_ids contém esse pack.';
