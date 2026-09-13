-- ===========================================================================
-- 153. Vincular anúncio ao pack só regrava quem ainda não está no pack.
--
-- POR QUE (F7 do plano de eficiência, 2026-09-13)
-- -----------------------------------------------
-- `batch_add_pack_id_to_arrays` roda em TODO refresh, para TODOS os anúncios do
-- pack (lotes de 200). O CASE já deixava `pack_ids` igual quando o pack estava lá,
-- mas o UPDATE acontecia do mesmo jeito, com `updated_at = now()`: uma versão nova
-- de cada linha, sem mudar nada. Isso gera WAL e tupla morta e tira a página do
-- mapa de visibilidade, desfazendo o index-only scan da migration 152.
--
-- O QUE MUDA
-- ----------
-- Um filtro a mais no ramo `ads`: só entram as linhas em que o pack AINDA NÃO está
-- em `pack_ids`. O resultado final de `pack_ids` é idêntico (a função já era
-- idempotente); muda só quem é regravado. `rows_updated` passa a contar os vínculos
-- realmente feitos. Nenhum chamador lê esse número (conferido em 13/09).
--
-- O `COALESCE(..., false)` no filtro não é enfeite: com `pack_ids` NULL, ou com um
-- ELEMENTO NULL dentro dele (`{NULL,outro}`), `x = ANY(...)` vale NULL, `NOT NULL` também,
-- e a linha seria pulada para sempre, nunca ganhando o pack (revisão do F7, 13/09).
--
-- Partiu da definição VIVA em produção (pg_get_functiondef, 13/09), não do
-- schema.sql. O ramo `ad_metrics` ficou como estava: é código morto (a coluna
-- `ad_metrics.pack_ids` não existe desde a 145) e está fora do escopo.
--
-- Ordem de deploy: indiferente. O backend atual e o do F7 funcionam com a versão
-- antiga e com a nova. CREATE OR REPLACE preserva os GRANTs existentes.
--
-- Teste: supabase/tests/153_vinculo_pack_so_quem_falta.test.sql
-- ===========================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.batch_add_pack_id_to_arrays(p_user_id uuid, p_pack_id uuid, p_table_name text, p_ids_to_update text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  updated_count int := 0;
BEGIN
  -- Guard de tenancy (migration 113): caller autenticado so opera o PROPRIO
  -- silo; service role (auth.uid() nulo) passa - e o caminho do backend para
  -- operacoes de pack compartilhado (P3.3), que ja derivou o dono via
  -- resolve_pack_access antes de chegar aqui.
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Forbidden: p_user_id must match auth.uid()';
  END IF;
  IF p_table_name NOT IN ('ads', 'ad_metrics') THEN
    RAISE EXCEPTION 'Tabela inválida: %. Use "ads" ou "ad_metrics"', p_table_name;
  END IF;
  IF p_table_name = 'ads' THEN
    UPDATE public.ads
    SET
      pack_ids = array_append(COALESCE(pack_ids, ARRAY[]::uuid[]), p_pack_id),
      updated_at = now()
    WHERE user_id = p_user_id
      AND ad_id = ANY(p_ids_to_update)
      -- 153: quem já tem o pack não é regravado.
      AND NOT COALESCE(p_pack_id = ANY(pack_ids), false);
    GET DIAGNOSTICS updated_count = ROW_COUNT;
  ELSE
    UPDATE public.ad_metrics
    SET
      pack_ids = CASE
        WHEN p_pack_id = ANY(COALESCE(pack_ids, ARRAY[]::uuid[])) THEN COALESCE(pack_ids, ARRAY[]::uuid[])
        ELSE array_append(COALESCE(pack_ids, ARRAY[]::uuid[]), p_pack_id)
      END,
      updated_at = now()
    WHERE user_id = p_user_id
      AND id = ANY(p_ids_to_update);
    GET DIAGNOSTICS updated_count = ROW_COUNT;
  END IF;
  RETURN jsonb_build_object(
    'rows_updated', updated_count,
    'status', 'success'
  );
EXCEPTION
  WHEN OTHERS THEN
    IF SQLERRM LIKE 'Forbidden: p_user_id%' THEN RAISE; END IF;
    RETURN jsonb_build_object(
      'status', 'error',
      'error_message', SQLERRM,
      'rows_updated', 0
    );
END;
$function$;

COMMENT ON FUNCTION public.batch_add_pack_id_to_arrays(p_user_id uuid, p_pack_id uuid, p_table_name text, p_ids_to_update text[]) IS
  'Anexa pack_id ao array pack_ids em batch. Idempotente; desde a 153 regrava só as linhas de ads que ainda não têm o pack.';

COMMIT;
