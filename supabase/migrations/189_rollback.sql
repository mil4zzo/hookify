-- Rollback da 189: tira o gatilho e volta judgment_move_conflicts ao corpo da 187.
-- (as linhas de arquivamento apagadas pela limpeza eram fantasmas e não são recriadas)
BEGIN;

DROP TRIGGER IF EXISTS trg_pack_shares_drop_archive ON public.pack_shares;
DROP FUNCTION IF EXISTS public.trg_pack_shares_drop_archive();

CREATE OR REPLACE FUNCTION public.judgment_move_conflicts(p_pack_ids uuid[], p_folder_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p.id
  FROM public.packs p
  JOIN public.folders f ON f.id = p_folder_id
  WHERE p.id = ANY (p_pack_ids)
    AND public.folder_access_role(p_folder_id, (SELECT auth.uid())) IS NOT NULL
    AND EXISTS (SELECT 1 FROM public._folder_judgment_owner(p_folder_id, false))
    AND p.user_id <> f.user_id
    AND p.user_id <> (SELECT auth.uid())
$$;

REVOKE EXECUTE ON FUNCTION public.judgment_move_conflicts(uuid[], uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.judgment_move_conflicts(uuid[], uuid) TO authenticated;

COMMIT;
