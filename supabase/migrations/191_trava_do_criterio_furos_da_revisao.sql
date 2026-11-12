-- 191: furos da revisão independente da 190.
--
-- 1. Falso alarme (regressão da 190): o dono da árvore reposiciona, pela RPC, um pack que um
--    colaborador contribuiu. A RPC faz INSERT ... ON CONFLICT DO UPDATE com contributed=false;
--    o gatilho enxergava a linha PROPOSTA e recusava, embora o ON CONFLICT mantenha
--    contributed=true (nenhum arquivamento nasce). Agora, se a linha contribuída já existe,
--    o INSERT passa.
-- 2. UPDATE de pack_id/user_id numa linha existente contornava o gatilho (só olhava
--    folder_id/contributed): trocar o pack de uma linha própria por um compartilhado.
-- 3. "Fantasma" que ressuscitava: a linha de arquivamento criada ANTES do compartilhamento
--    (a RLS só exige user_id = auth.uid()) passava, e depois o compartilhamento nascia dentro
--    de pasta que já manda. Agora, ao nascer (ou mudar) o compartilhamento, essa linha pré-
--    existente que cairia em pasta com critério é apagada (era um fantasma, a pessoa nem
--    tinha acesso ao pack quando a criou).
-- 4. Pasta criada JÁ com critério (INSERT direto) ignorava a regra de dono único.
-- 5. UPDATE de parent_id + judgment na mesma instrução: a checagem de "ancestral manda" lia o
--    pai ANTIGO. Agora lê o pai novo.
BEGIN;

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
  IF TG_OP = 'UPDATE'
     AND OLD.folder_id IS NOT DISTINCT FROM NEW.folder_id
     AND OLD.contributed = NEW.contributed
     AND OLD.pack_id = NEW.pack_id
     AND OLD.user_id = NEW.user_id THEN
    RETURN NEW;
  END IF;

  -- Colocação do dono do pack nunca é arquivamento.
  SELECT user_id INTO v_owner FROM public.packs WHERE id = NEW.pack_id;
  IF v_owner IS NULL OR v_owner = NEW.user_id THEN
    RETURN NEW;
  END IF;

  -- INSERT ... ON CONFLICT DO UPDATE sobre a linha que o dono contribuiu: o ON CONFLICT
  -- preserva contributed=true, então nenhum arquivamento nasce.
  IF TG_OP = 'INSERT' AND EXISTS (
    SELECT 1 FROM public.pack_folder_members x
    WHERE x.user_id = NEW.user_id AND x.pack_id = NEW.pack_id AND x.contributed
  ) THEN
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
  IF TG_OP = 'UPDATE' AND NEW.parent_id IS NOT NULL AND NEW.parent_id IS DISTINCT FROM OLD.parent_id THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('folders_tree:' || NEW.user_id::text, 0));
    IF EXISTS (SELECT 1 FROM public._folder_judgment_owner(NEW.parent_id, false))
       AND public._folder_subtree_has_archived(NEW.id) THEN
      RAISE EXCEPTION 'judgment_shared_pack_conflict' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF NEW.judgment IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.judgment IS DISTINCT FROM OLD.judgment) THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('folders_tree:' || NEW.user_id::text, 0));
    -- pai NOVO: num UPDATE que muda parent_id junto, a pasta ainda não está sob o pai novo na tabela
    IF NEW.parent_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM public._folder_judgment_owner(NEW.parent_id, false)) THEN
      RAISE EXCEPTION 'folder_judgment_governed' USING ERRCODE = 'P0001';
    END IF;
    IF TG_OP = 'UPDATE' AND public._folder_subtree_has_archived(NEW.id) THEN
      RAISE EXCEPTION 'folder_has_shared_packs' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Compartilhamento novo (ou que muda de pack/pessoa): arquivamento pré-existente da pessoa
-- que cairia em pasta com critério era fantasma; sai.
CREATE OR REPLACE FUNCTION public.trg_pack_shares_ghost_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  r record;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.pack_id = NEW.pack_id AND OLD.grantee_id = NEW.grantee_id THEN
    RETURN NULL;
  END IF;
  FOR r IN
    SELECT m.user_id, m.folder_id, f.user_id AS tree
    FROM public.pack_folder_members m
    JOIN public.packs p ON p.id = m.pack_id
    JOIN public.folders f ON f.id = m.folder_id
    WHERE m.pack_id = NEW.pack_id
      AND m.user_id = NEW.grantee_id
      AND m.user_id <> p.user_id
      AND NOT m.contributed
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('folders_tree:' || r.tree::text, 0));
    IF EXISTS (SELECT 1 FROM public._folder_judgment_owner(r.folder_id, false)) THEN
      DELETE FROM public.pack_folder_members
      WHERE user_id = r.user_id AND pack_id = NEW.pack_id AND folder_id = r.folder_id AND NOT contributed;
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_pfm_judgment_guard ON public.pack_folder_members;
CREATE TRIGGER trg_pfm_judgment_guard
  BEFORE INSERT OR UPDATE OF folder_id, contributed, pack_id, user_id ON public.pack_folder_members
  FOR EACH ROW EXECUTE FUNCTION public.trg_pfm_judgment_guard();

DROP TRIGGER IF EXISTS trg_folders_judgment_guard ON public.folders;
CREATE TRIGGER trg_folders_judgment_guard
  BEFORE INSERT OR UPDATE OF parent_id, judgment ON public.folders
  FOR EACH ROW EXECUTE FUNCTION public.trg_folders_judgment_guard();

DROP TRIGGER IF EXISTS trg_pack_shares_ghost_guard ON public.pack_shares;
CREATE TRIGGER trg_pack_shares_ghost_guard
  AFTER INSERT OR UPDATE OF pack_id, grantee_id ON public.pack_shares
  FOR EACH ROW EXECUTE FUNCTION public.trg_pack_shares_ghost_guard();

REVOKE EXECUTE ON FUNCTION public.trg_pfm_judgment_guard() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_folders_judgment_guard() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_pack_shares_ghost_guard() FROM PUBLIC, anon, authenticated;

COMMIT;
