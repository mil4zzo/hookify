-- Migration: Fix bug in batch_update_ad_metrics_enrichment function
-- Remove duplicate GET DIAGNOSTICS that was causing incorrect row count
-- This fixes the function that was created in migration 013_batch_update_ad_metrics_enrichment_function.sql

CREATE OR REPLACE FUNCTION public.batch_update_ad_metrics_enrichment(
  p_user_id uuid,
  p_updates jsonb
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
    
    -- Converter array de IDs para formato PostgreSQL
    ids_array := ARRAY(SELECT jsonb_array_elements_text(update_item->'ids'));
    
    -- Parse leadscore_values se presente
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
    
    -- Parse cpr_max se presente
    IF update_item ? 'cpr_max' 
       AND update_item->'cpr_max' IS NOT NULL
       AND update_item->'cpr_max' != 'null'::jsonb THEN
      cpr_max_val := (update_item->>'cpr_max')::numeric;
    ELSE
      cpr_max_val := NULL;
    END IF;
    
    -- Atualizar registros apenas se houver IDs
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
        AND id = ANY(ids_array);
      
      GET DIAGNOSTICS updated_count = ROW_COUNT;
      total_rows_updated := total_rows_updated + updated_count;
    END IF;
    -- BUG CORRIGIDO: Removidas linhas duplicadas de GET DIAGNOSTICS que estavam fora do IF
  END LOOP;
  
  RETURN jsonb_build_object(
    'total_groups_processed', total_groups,
    'total_rows_updated', total_rows_updated,
    'status', 'success'
  );
EXCEPTION
  WHEN OTHERS THEN
    -- Retornar erro de forma estruturada
    RETURN jsonb_build_object(
      'status', 'error',
      'error_message', SQLERRM,
      'total_groups_processed', total_groups,
      'total_rows_updated', total_rows_updated
    );
END;
$$;

-- Grant execute to authenticated users (RLS será aplicado via user_id na função)
GRANT EXECUTE ON FUNCTION public.batch_update_ad_metrics_enrichment(uuid, jsonb) TO authenticated;

-- Comentário para documentação
COMMENT ON FUNCTION public.batch_update_ad_metrics_enrichment IS 
  'Atualiza múltiplos registros de ad_metrics em uma única transação. Recebe array de updates com ids, leadscore_values e cpr_max. Muito mais eficiente que múltiplas requisições HTTP individuais. Reduz de N requisições para apenas 1. BUG CORRIGIDO: Removida contagem duplicada de linhas atualizadas.';

