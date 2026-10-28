-- Rollback da 181 (pasta compartilhada).
--
-- ATENCAO:
--   - Os acessos que vieram de pasta (pack_shares.source_folder_id) sao APAGADOS — sem a
--     coluna nao ha como distinguir "via pasta" de "direto", e deixa-los viraria acesso
--     permanente que ninguem enxerga de onde veio. Isso inclui o acesso direto que a
--     pasta ABSORVEU: quem precisa continuar com acesso e reconvidado pack a pack.
--   - Pack que um editor pos na pasta do dono (`contributed`) sai da arvore do dono e
--     volta solto para o dono do pack.
--   - place_folder, dissolve_folder e reorder_folders voltam as versoes 173/174
--     (SECURITY INVOKER, so a arvore do proprio ator). Volte o backend ANTES: o backend
--     da 181 chama create_folder, rename_folder, move_packs_to_folder e list_shared_folders.
BEGIN;

DROP TRIGGER IF EXISTS trg_folder_shares_sync ON public.folder_shares;
DROP TRIGGER IF EXISTS trg_folders_reparent_sync ON public.folders;
DROP TRIGGER IF EXISTS trg_pfm_sync_ins ON public.pack_folder_members;
DROP TRIGGER IF EXISTS trg_pfm_sync_upd ON public.pack_folder_members;
DROP TRIGGER IF EXISTS trg_pfm_sync_del ON public.pack_folder_members;

DELETE FROM public.pack_shares WHERE source_folder_id IS NOT NULL;
DELETE FROM public.pack_folder_members WHERE contributed;

DROP FUNCTION IF EXISTS public.list_shared_folders();
DROP FUNCTION IF EXISTS public.move_packs_to_folder(uuid[], uuid);
DROP FUNCTION IF EXISTS public.rename_folder(uuid, text);
DROP FUNCTION IF EXISTS public.create_folder(text, uuid);
DROP FUNCTION IF EXISTS public.trg_folder_shares_sync();
DROP FUNCTION IF EXISTS public.trg_folders_reparent_sync();
DROP FUNCTION IF EXISTS public.trg_pack_folder_members_sync();
DROP FUNCTION IF EXISTS public.sync_folder_subtree_grants(uuid[]);
DROP FUNCTION IF EXISTS public.sync_folder_pack_grants(uuid[]);
DROP FUNCTION IF EXISTS public.folder_grants_desired(uuid[]);

-- 173/174 de volta (corpo identico ao original).
CREATE OR REPLACE FUNCTION public.reorder_folders(p_folder_ids uuid[])
RETURNS integer
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH wanted AS (
    SELECT t.id, (t.ord - 1)::integer AS pos
    FROM unnest(p_folder_ids) WITH ORDINALITY AS t(id, ord)
  ),
  changed AS (
    UPDATE public.folders f
    SET position = w.pos
    FROM wanted w
    WHERE f.id = w.id
      AND f.user_id = (SELECT auth.uid())
      AND f.position IS DISTINCT FROM w.pos
    RETURNING 1
  )
  SELECT count(*)::integer FROM changed;
$$;

CREATE OR REPLACE FUNCTION public.place_folder(p_folder_id uuid, p_parent_id uuid, p_sibling_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_changed integer;
BEGIN
  IF NOT (p_folder_id = ANY (p_sibling_ids)) THEN
    RAISE EXCEPTION 'folder_not_in_siblings' USING ERRCODE = 'P0001',
      HINT = 'A lista de irmaos precisa conter a pasta movida.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.folders WHERE id = p_folder_id AND user_id = v_uid) THEN
    RAISE EXCEPTION 'folder_not_found' USING ERRCODE = 'P0001', HINT = 'Pasta nao encontrada.';
  END IF;

  UPDATE public.folders
  SET parent_id = p_parent_id
  WHERE id = p_folder_id AND user_id = v_uid AND parent_id IS DISTINCT FROM p_parent_id;

  WITH wanted AS (
    SELECT t.id, (t.ord - 1)::integer AS pos
    FROM unnest(p_sibling_ids) WITH ORDINALITY AS t(id, ord)
  ),
  changed AS (
    UPDATE public.folders f
    SET position = w.pos
    FROM wanted w
    WHERE f.id = w.id
      AND f.user_id = v_uid
      AND f.parent_id IS NOT DISTINCT FROM p_parent_id
      AND f.position IS DISTINCT FROM w.pos
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_changed FROM changed;

  RETURN v_changed;
END;
$$;

CREATE OR REPLACE FUNCTION public.dissolve_folder(p_folder_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_parent uuid;
  v_pos integer;
  v_folders integer;
  v_packs integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('folders_tree:' || v_uid::text, 0));

  SELECT parent_id, position INTO v_parent, v_pos
  FROM public.folders WHERE id = p_folder_id AND user_id = v_uid
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'folder_not_found' USING ERRCODE = 'P0001', HINT = 'Pasta nao encontrada.';
  END IF;

  SELECT count(*)::integer INTO v_folders FROM public.folders WHERE parent_id = p_folder_id AND user_id = v_uid;

  WITH grp AS (
    SELECT id, position AS p1, 0 AS lvl, 0 AS p2, name
    FROM public.folders
    WHERE user_id = v_uid AND parent_id IS NOT DISTINCT FROM v_parent AND id <> p_folder_id
    UNION ALL
    SELECT id, v_pos, 1, position, name
    FROM public.folders
    WHERE user_id = v_uid AND parent_id = p_folder_id
  ),
  ranked AS (
    SELECT id, (row_number() OVER (ORDER BY p1, lvl, p2, name) - 1)::integer AS pos FROM grp
  )
  UPDATE public.folders f
  SET parent_id = v_parent, position = r.pos
  FROM ranked r
  WHERE f.id = r.id
    AND (f.parent_id IS DISTINCT FROM v_parent OR f.position IS DISTINCT FROM r.pos);

  IF v_parent IS NULL THEN
    DELETE FROM public.pack_folder_members WHERE folder_id = p_folder_id AND user_id = v_uid;
  ELSE
    UPDATE public.pack_folder_members SET folder_id = v_parent WHERE folder_id = p_folder_id AND user_id = v_uid;
  END IF;
  GET DIAGNOSTICS v_packs = ROW_COUNT;

  DELETE FROM public.folders WHERE id = p_folder_id AND user_id = v_uid;

  RETURN jsonb_build_object('parent_id', v_parent, 'folders_moved', v_folders, 'packs_moved', v_packs);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reorder_folders(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reorder_folders(uuid[]) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.place_folder(uuid, uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.place_folder(uuid, uuid, uuid[]) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.dissolve_folder(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dissolve_folder(uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.folder_access_role(uuid, uuid);

DROP POLICY IF EXISTS pack_shares_grantee_leave ON public.pack_shares;
CREATE POLICY pack_shares_grantee_leave ON public.pack_shares
  FOR DELETE USING (grantee_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS pack_folder_members_modify_own ON public.pack_folder_members;
CREATE POLICY pack_folder_members_modify_own ON public.pack_folder_members
  USING ((user_id = (SELECT auth.uid()))) WITH CHECK ((user_id = (SELECT auth.uid())));
DROP INDEX IF EXISTS public.pack_folder_members_pack_idx;
ALTER TABLE public.pack_folder_members DROP COLUMN IF EXISTS contributed;

ALTER TABLE public.pack_shares DROP CONSTRAINT IF EXISTS pack_shares_source_folder_fkey;
DROP INDEX IF EXISTS public.pack_shares_source_folder_idx;
ALTER TABLE public.pack_shares DROP COLUMN IF EXISTS source_folder_id;

DROP TABLE IF EXISTS public.folder_shares;
ALTER TABLE public.folders DROP CONSTRAINT IF EXISTS folders_id_user_id_key;

COMMIT;
