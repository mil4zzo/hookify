-- Migration: Adiciona p_pack_id ao batch_update_ad_metrics_enrichment
-- Motivo: o filtro de pack agora vive no UPDATE (WHERE pack_ids @> ARRAY[p_pack_id])
-- em vez de um GET prévio de verificação, simplificando o fluxo do importador.
--
-- DROP da assinatura antiga (uuid, jsonb) é necessário porque CREATE OR REPLACE
-- com assinatura diferente cria uma sobrecarga, gerando ambiguidade.
DROP FUNCTION IF EXISTS public.batch_update_ad_metrics_enrichment(uuid, jsonb);

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
  ids_array text[];
  leadscore_vals numeric[];
  cpr_max_val numeric;
BEGIN
  -- p_updates é um array de objetos:
  -- [{"ids": ["id1", "id2"], "leadscore_values": [1,2,3], "cpr_max": 10.5}, ...]

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
    'status', 'success'
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'status', 'error',
      'error_message', SQLERRM,
      'total_groups_processed', total_groups,
      'total_rows_updated', total_rows_updated
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.batch_update_ad_metrics_enrichment(uuid, jsonb, uuid) TO authenticated;

COMMENT ON FUNCTION public.batch_update_ad_metrics_enrichment IS
  'Atualiza múltiplos registros de ad_metrics em uma única transação. '
  'Aceita p_pack_id opcional: quando informado, restringe o UPDATE às métricas '
  'cujo pack_ids contém esse pack (pack_ids @> ARRAY[p_pack_id]). '
  'Elimina a necessidade de um GET prévio de verificação no importador.';
