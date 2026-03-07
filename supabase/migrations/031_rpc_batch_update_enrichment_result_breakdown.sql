-- Migration: Estender batch_update_ad_metrics_enrichment para retornar breakdown completo
-- Retorna: total_ids_sent, ids_not_found_count, ids_out_of_pack_count para o frontend

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
  update_item jsonb;
  updated_count int := 0;
  total_groups int := 0;
  total_rows_updated int := 0;
  total_ids_sent int := 0;
  ids_array text[];
  all_ids text[] := '{}';
  leadscore_vals numeric[];
  cpr_max_val numeric;
  existing_count int := 0;
  in_pack_count int := 0;
BEGIN
  -- Coletar todos os IDs enviados (pode haver duplicatas entre grupos, usamos array agregado)
  FOR update_item IN SELECT * FROM jsonb_array_elements(p_updates)
  LOOP
    ids_array := ARRAY(SELECT jsonb_array_elements_text(update_item->'ids'));
    all_ids := all_ids || ids_array;
  END LOOP;

  total_ids_sent := array_length(all_ids, 1);
  IF total_ids_sent IS NULL THEN
    total_ids_sent := 0;
  END IF;

  -- Uma única query para obter existing_count e in_pack_count
  IF total_ids_sent > 0 THEN
    SELECT
      count(*)::int,
      count(*) FILTER (WHERE p_pack_id IS NULL OR pack_ids @> ARRAY[p_pack_id]::uuid[])::int
    INTO existing_count, in_pack_count
    FROM public.ad_metrics
    WHERE user_id = p_user_id AND id = ANY(all_ids);
  END IF;

  -- Loop de UPDATE (igual ao anterior)
  FOR update_item IN SELECT * FROM jsonb_array_elements(p_updates)
  LOOP
    total_groups := total_groups + 1;

    ids_array := ARRAY(SELECT jsonb_array_elements_text(update_item->'ids'));

    IF update_item ? 'leadscore_values'
       AND update_item->'leadscore_values' IS NOT NULL
       AND update_item->'leadscore_values' != 'null'::jsonb
       AND jsonb_array_length(update_item->'leadscore_values') > 0 THEN
      leadscore_vals := ARRAY(
        SELECT value::numeric
        FROM jsonb_array_elements(update_item->'leadscore_values') AS value
      );
    ELSE
      leadscore_vals := NULL;
    END IF;

    IF update_item ? 'cpr_max'
       AND update_item->'cpr_max' IS NOT NULL
       AND update_item->'cpr_max' != 'null'::jsonb THEN
      cpr_max_val := (update_item->>'cpr_max')::numeric;
    ELSE
      cpr_max_val := NULL;
    END IF;

    IF array_length(ids_array, 1) > 0 THEN
      UPDATE public.ad_metrics
      SET
        leadscore_values = CASE
          WHEN leadscore_vals IS NOT NULL THEN leadscore_vals
          ELSE leadscore_values
        END,
        cpr_max = CASE
          WHEN cpr_max_val IS NOT NULL THEN cpr_max_val
          ELSE cpr_max
        END,
        updated_at = now()
      WHERE
        user_id = p_user_id
        AND id = ANY(ids_array)
        AND (p_pack_id IS NULL OR pack_ids @> ARRAY[p_pack_id]::uuid[]);

      GET DIAGNOSTICS updated_count = ROW_COUNT;
      total_rows_updated := total_rows_updated + updated_count;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'total_groups_processed', total_groups,
    'total_rows_updated', total_rows_updated,
    'total_ids_sent', total_ids_sent,
    'ids_not_found_count', greatest(0, total_ids_sent - existing_count),
    'ids_out_of_pack_count', greatest(0, existing_count - in_pack_count),
    'status', 'success'
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'status', 'error',
      'error_message', SQLERRM,
      'total_groups_processed', total_groups,
      'total_rows_updated', total_rows_updated,
      'total_ids_sent', total_ids_sent,
      'ids_not_found_count', 0,
      'ids_out_of_pack_count', 0
    );
END;
$$;

COMMENT ON FUNCTION public.batch_update_ad_metrics_enrichment(uuid, jsonb, uuid) IS
  'Atualiza múltiplos registros de ad_metrics em uma única transação. '
  'Retorna breakdown: total_ids_sent, ids_not_found_count, ids_out_of_pack_count.';
