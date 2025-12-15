-- Migration: Create batch function to remove pack_id from pack_ids arrays
-- Otimiza o processo de deleção de packs ao remover pack_id de múltiplos registros em uma única operação
-- Em vez de N requisições HTTP individuais, faz 1 requisição SQL que processa todos os registros

CREATE OR REPLACE FUNCTION public.batch_remove_pack_id_from_arrays(
  p_user_id uuid,
  p_pack_id uuid,
  p_table_name text,  -- 'ads' ou 'ad_metrics'
  p_ids_to_update text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_count int;
BEGIN
  -- Validar tabela
  IF p_table_name NOT IN ('ads', 'ad_metrics') THEN
    RAISE EXCEPTION 'Tabela inválida: %. Use "ads" ou "ad_metrics"', p_table_name;
  END IF;
  
  -- Atualizar ads
  IF p_table_name = 'ads' THEN
    UPDATE public.ads
    SET 
      pack_ids = array_remove(pack_ids, p_pack_id),
      updated_at = now()
    WHERE 
      user_id = p_user_id
      AND ad_id = ANY(p_ids_to_update)
      AND p_pack_id = ANY(pack_ids);
    
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    
  -- Atualizar ad_metrics
  ELSIF p_table_name = 'ad_metrics' THEN
    UPDATE public.ad_metrics
    SET 
      pack_ids = array_remove(pack_ids, p_pack_id),
      updated_at = now()
    WHERE 
      user_id = p_user_id
      AND id = ANY(p_ids_to_update)
      AND p_pack_id = ANY(pack_ids);
    
    GET DIAGNOSTICS updated_count = ROW_COUNT;
  END IF;
  
  RETURN jsonb_build_object(
    'rows_updated', updated_count,
    'status', 'success'
  );
EXCEPTION
  WHEN OTHERS THEN
    -- Retornar erro de forma estruturada
    RETURN jsonb_build_object(
      'status', 'error',
      'error_message', SQLERRM,
      'rows_updated', 0
    );
END;
$$;

-- Grant execute to authenticated users (RLS será aplicado via user_id na função)
GRANT EXECUTE ON FUNCTION public.batch_remove_pack_id_from_arrays(uuid, uuid, text, text[]) TO authenticated;

-- Comentário para documentação
COMMENT ON FUNCTION public.batch_remove_pack_id_from_arrays IS 
  'Remove pack_id do array pack_ids de múltiplos registros em uma única transação. Muito mais eficiente que múltiplas requisições HTTP individuais. Reduz de N requisições para apenas 1. Usado durante a deleção de packs para preservar dados compartilhados entre múltiplos packs.';

