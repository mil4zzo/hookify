-- 188: o arquivamento "fantasma" não trava mais a pasta.
--
-- Revisão independente da 187: quando o dono revoga o compartilhamento de um pack (ou o
-- convidado sai), a linha de pack_folder_members de quem recebeu continua. A 187 a contava
-- como "pack compartilhado na pasta" e a pasta ficava sem poder definir critério, sem que a
-- pessoa conseguisse tirar o pack (ela já não tem acesso a ele). Agora só conta o arquivamento
-- de quem ainda recebe o pack.
BEGIN;

CREATE OR REPLACE FUNCTION public.judgment_archived_packs(p_folder_id uuid)
RETURNS TABLE(pack_id uuid, pack_name text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role text := public.folder_access_role(p_folder_id, (SELECT auth.uid()));
BEGIN
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'folder_not_found' USING ERRCODE = 'P0001';
  ELSIF v_role NOT IN ('dono', 'editor') THEN
    RAISE EXCEPTION 'folder_forbidden' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  WITH RECURSIVE down AS (
    SELECT f.id, f.user_id FROM public.folders f WHERE f.id = p_folder_id
    UNION ALL
    SELECT g.id, g.user_id FROM public.folders g JOIN down d ON g.parent_id = d.id
  )
  SELECT p.id,
         CASE WHEN p.user_id = (SELECT auth.uid())
                OR EXISTS (SELECT 1 FROM public.pack_shares s WHERE s.pack_id = p.id AND s.grantee_id = (SELECT auth.uid()))
              THEN p.name END
  FROM public.pack_folder_members m
  JOIN down d ON d.id = m.folder_id AND d.user_id = m.user_id
  JOIN public.packs p ON p.id = m.pack_id
  WHERE NOT (m.user_id = p.user_id OR m.contributed)
    -- só conta quem AINDA recebe o pack: se o dono revogou o compartilhamento, a linha de
    -- arquivamento ficou para trás e a pessoa nem consegue tirá-la da pasta (sem acesso ao pack)
    AND EXISTS (SELECT 1 FROM public.pack_shares s WHERE s.pack_id = p.id AND s.grantee_id = m.user_id)
  ORDER BY p.name, p.id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.judgment_archived_packs(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.judgment_archived_packs(uuid) TO authenticated;

COMMIT;
