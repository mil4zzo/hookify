-- Rollback da 191: tira o gatilho dos compartilhamentos e volta os dois gatilhos da 190
-- aos corpos da 190 (as linhas de arquivamento fantasma apagadas não são recriadas).
BEGIN;
DROP TRIGGER IF EXISTS trg_pack_shares_ghost_guard ON public.pack_shares;
DROP FUNCTION IF EXISTS public.trg_pack_shares_ghost_guard();
CREATE OR REPLACE FUNCTION public.trg_pfm_judgment_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_owner uuid;
  v_tree uuid;
BEGIN
  IF NEW.folder_id IS NULL OR NEW.contributed THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.folder_id IS NOT DISTINCT FROM NEW.folder_id AND OLD.contributed = NEW.contributed THEN
    RETURN NEW;
  END IF;

  -- Colocação do dono do pack nunca é arquivamento.
  SELECT user_id INTO v_owner FROM public.packs WHERE id = NEW.pack_id;
  IF v_owner IS NULL OR v_owner = NEW.user_id THEN
    RETURN NEW;
  END IF;

  SELECT user_id INTO v_tree FROM public.folders WHERE id = NEW.folder_id;
  IF v_tree IS NULL THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('folders_tree:' || v_tree::text, 0));

  IF EXISTS (SELECT 1 FROM public._folder_judgment_owner(NEW.folder_id, false)) THEN
    RAISE EXCEPTION 'judgment_shared_pack_conflict' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_folders_judgment_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL AND NEW.parent_id IS DISTINCT FROM OLD.parent_id THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('folders_tree:' || NEW.user_id::text, 0));
    IF EXISTS (SELECT 1 FROM public._folder_judgment_owner(NEW.parent_id, false))
       AND public._folder_subtree_has_archived(NEW.id) THEN
      RAISE EXCEPTION 'judgment_shared_pack_conflict' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF NEW.judgment IS NOT NULL AND NEW.judgment IS DISTINCT FROM OLD.judgment THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('folders_tree:' || NEW.user_id::text, 0));
    IF EXISTS (SELECT 1 FROM public._folder_judgment_owner(NEW.id, true)) THEN
      RAISE EXCEPTION 'folder_judgment_governed' USING ERRCODE = 'P0001';
    END IF;
    IF public._folder_subtree_has_archived(NEW.id) THEN
      RAISE EXCEPTION 'folder_has_shared_packs' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pfm_judgment_guard ON public.pack_folder_members;
CREATE TRIGGER trg_pfm_judgment_guard
  BEFORE INSERT OR UPDATE OF folder_id, contributed ON public.pack_folder_members
  FOR EACH ROW EXECUTE FUNCTION public.trg_pfm_judgment_guard();

DROP TRIGGER IF EXISTS trg_folders_judgment_guard ON public.folders;
CREATE TRIGGER trg_folders_judgment_guard
  BEFORE UPDATE OF parent_id, judgment ON public.folders
  FOR EACH ROW EXECUTE FUNCTION public.trg_folders_judgment_guard();

REVOKE EXECUTE ON FUNCTION public._folder_subtree_has_archived(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_pfm_judgment_guard() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_folders_judgment_guard() FROM PUBLIC, anon, authenticated;

COMMIT;
