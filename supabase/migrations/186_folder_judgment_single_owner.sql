-- 186: o critério de julgamento tem UM dono por galho da árvore de pastas.
--
-- Regra: se uma pasta (ou ancestral) define critério, nada abaixo dela o edita —
-- nem subpasta, nem pack. Quem manda é a pasta mais próxima do topo que define um...
-- na prática, só pode haver uma por galho:
--   - `set_folder_judgment` recusa (folder_judgment_governed) definir critério numa pasta
--     cujo ANCESTRAL já define;
--   - ao definir numa pasta, o critério próprio das subpastas é APAGADO (a pasta passa a
--     mandar nelas, como já manda nos packs).
-- Limpar o critério da pasta (NULL) é sempre permitido e não toca nas subpastas.
--
-- Funções de consulta (a rota e a tela usam para dizer QUEM manda):
--   folder_judgment_governor(pasta, estrito)   -> a pasta que define o critério (a própria
--                                                 ou, com estrito, só ancestral)
--   pack_judgment_governors(packs)             -> por pack, a pasta que manda no critério dele
--   folders_with_judgment(pastas)              -> quais dessas pastas definem critério
-- O nome da pasta só sai se o ator a enxerga (ancestral acima de uma pasta compartilhada
-- não vaza o nome; a pasta vem com folder_name NULL).
-- Deploy: aplicar ANTES do backend.
BEGIN;

CREATE OR REPLACE FUNCTION public.folder_judgment_governor(p_folder_id uuid, p_strict boolean DEFAULT false)
RETURNS TABLE(folder_id uuid, folder_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH RECURSIVE up AS (
    SELECT f.id, f.parent_id, f.user_id, f.name, f.judgment, 0 AS depth
    FROM public.folders f WHERE f.id = p_folder_id
    UNION ALL
    SELECT g.id, g.parent_id, g.user_id, g.name, g.judgment, up.depth + 1
    FROM public.folders g JOIN up ON g.id = up.parent_id
    WHERE g.user_id = up.user_id AND up.depth < 50
  )
  SELECT up.id,
         CASE WHEN public.folder_access_role(up.id, (SELECT auth.uid())) IS NULL THEN NULL ELSE up.name END
  FROM up
  WHERE up.judgment IS NOT NULL
    AND (NOT p_strict OR up.depth > 0)
    AND public.folder_access_role(p_folder_id, (SELECT auth.uid())) IS NOT NULL
  ORDER BY up.depth
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.pack_judgment_governors(p_pack_ids uuid[])
RETURNS TABLE(pack_id uuid, folder_id uuid, folder_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT DISTINCT ON (m.pack_id) m.pack_id, gv.folder_id, gv.folder_name
  FROM public.pack_folder_members m
  CROSS JOIN LATERAL public.folder_judgment_governor(m.folder_id, false) gv
  WHERE m.pack_id = ANY (p_pack_ids)
    AND public.folder_access_role(m.folder_id, (SELECT auth.uid())) IS NOT NULL
  ORDER BY m.pack_id, gv.folder_id
$$;

CREATE OR REPLACE FUNCTION public.folders_with_judgment(p_folder_ids uuid[])
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT f.id FROM public.folders f
  WHERE f.id = ANY (p_folder_ids)
    AND f.judgment IS NOT NULL
    AND public.folder_access_role(f.id, (SELECT auth.uid())) IS NOT NULL
$$;

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

  IF v_value IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.folder_judgment_governor(p_folder_id, true)) THEN
      RAISE EXCEPTION 'folder_judgment_governed' USING ERRCODE = 'P0001';
    END IF;

    -- A pasta passa a mandar nas subpastas: o critério próprio delas sai.
    WITH RECURSIVE down AS (
      SELECT f.id FROM public.folders f WHERE f.parent_id = p_folder_id
      UNION ALL
      SELECT g.id FROM public.folders g JOIN down d ON g.parent_id = d.id
    )
    UPDATE public.folders SET judgment = NULL
    WHERE id IN (SELECT id FROM down) AND judgment IS NOT NULL;
  END IF;

  UPDATE public.folders SET judgment = v_value WHERE id = p_folder_id;
  RETURN v_value;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.folder_judgment_governor(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.folder_judgment_governor(uuid, boolean) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.pack_judgment_governors(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pack_judgment_governors(uuid[]) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.folders_with_judgment(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.folders_with_judgment(uuid[]) TO authenticated;

COMMIT;
