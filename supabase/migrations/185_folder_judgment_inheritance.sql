-- 185: pasta guarda o critério de julgamento; pack que entra nela o herda.
--
-- Antes a ação "Critérios de julgamento" do menu da pasta só COPIAVA o critério nos
-- packs que estavam lá naquele momento. Agora a pasta também o guarda (`folders.judgment`)
-- e o backend o reaplica ao pack que entrar (mover / criar pasta já com packs).
--
-- Forma do documento (a mesma do POST /analytics/packs/bulk-judgment, sem pack_ids):
--   { "mql_leadscore_min": 60, "target_cpr": {"conversion:lead": 12.5}, "lead_economics": {...} }
-- Só guarda o que DEFINE valor: "limpar" um campo na pasta tira a chave daqui, não grava
-- null (limpar não se propaga a pack novo — o pack entra com o que já tinha).
-- NULL = a pasta não define nada. Herda-se da pasta mais próxima, subindo pelos pais.
--
-- Escrita por RPC (dono ou editor da pasta, como rename_folder): a RLS de `folders` só
-- deixa o dono escrever, e o editor de uma pasta compartilhada também configura.
-- Deploy: aplicar esta migration ANTES do backend (o backend chama as duas RPCs).
BEGIN;

ALTER TABLE public.folders
  ADD COLUMN IF NOT EXISTS judgment jsonb
  CONSTRAINT folders_judgment_is_object CHECK (judgment IS NULL OR jsonb_typeof(judgment) = 'object');

COMMENT ON COLUMN public.folders.judgment IS
  'Critério de julgamento que o pack herda ao entrar na pasta (ou numa subpasta sem critério próprio). NULL = não define. Migration 185.';

CREATE OR REPLACE FUNCTION public.set_folder_judgment(p_folder_id uuid, p_judgment jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role text := public.folder_access_role(p_folder_id, (SELECT auth.uid()));
  v_value jsonb := CASE WHEN p_judgment IS NULL OR p_judgment = '{}'::jsonb THEN NULL ELSE p_judgment END;
BEGIN
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'folder_not_found' USING ERRCODE = 'P0001';
  ELSIF v_role NOT IN ('dono', 'editor') THEN
    RAISE EXCEPTION 'folder_forbidden' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.folders SET judgment = v_value WHERE id = p_folder_id;
  RETURN v_value;
END;
$$;

-- O critério da pasta mais próxima (ela mesma ou o ancestral mais perto que defina um),
-- na árvore do dono da pasta. NULL se nenhuma define. Qualquer papel na pasta lê.
-- `p_own_only`: só o da própria pasta, sem subir (é o que a tela de edição funde com o novo).
CREATE OR REPLACE FUNCTION public.resolve_folder_judgment(p_folder_id uuid, p_own_only boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF public.folder_access_role(p_folder_id, (SELECT auth.uid())) IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN (
    WITH RECURSIVE up AS (
      SELECT f.id, f.parent_id, f.user_id, f.judgment, 0 AS depth
      FROM public.folders f WHERE f.id = p_folder_id
      UNION ALL
      SELECT g.id, g.parent_id, g.user_id, g.judgment, up.depth + 1
      FROM public.folders g JOIN up ON g.id = up.parent_id
      WHERE g.user_id = up.user_id AND up.depth < 50 AND NOT p_own_only
    )
    SELECT up.judgment FROM up WHERE up.judgment IS NOT NULL ORDER BY up.depth LIMIT 1
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_folder_judgment(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_folder_judgment(uuid, jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.resolve_folder_judgment(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_folder_judgment(uuid, boolean) TO authenticated;

COMMIT;
