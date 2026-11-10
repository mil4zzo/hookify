-- 190: a regra "pasta com critério não guarda pack compartilhado" passa a valer NO BANCO.
--
-- Até a 189 a regra morava nas rotas do backend: quem chamava o banco direto (PostgREST,
-- que a RLS permite nas próprias linhas) a contornava, e duas abas ao mesmo tempo podiam
-- furá-la entre "checar" e "gravar". Agora três gatilhos recusam o estado proibido, todos
-- sob o mesmo trinco de árvore (advisory lock 'folders_tree:<dono>') que set_folder_judgment
-- e as RPCs de mover já usam: quem chega depois espera e enxerga o que o outro gravou.
--
--  1. pack_folder_members: arquivar (colocação de quem NÃO é dono nem contribuiu) um pack em
--     pasta que tem critério (ou ancestral) -> 'judgment_shared_pack_conflict'.
--  2. folders.parent_id: levar para dentro de quem manda uma pasta com pack arquivado
--     -> 'judgment_shared_pack_conflict'.
--  3. folders.judgment: gravar critério direto numa pasta governada por ancestral
--     ('folder_judgment_governed') ou com pack arquivado na subárvore ('folder_has_shared_packs').
--
-- As rotas continuam checando antes (mensagem com os nomes dos packs); o banco é a rede de
-- proteção. Dado antigo (pasta com critério + pack arquivado) não é alterado nem bloqueia
-- leitura: só o NOVO movimento é recusado.
BEGIN;

-- Há pack arquivado (de quem ainda recebe) na pasta ou em alguma subpasta? Sem checar quem
-- pergunta: é para os gatilhos. Interna.
CREATE OR REPLACE FUNCTION public._folder_subtree_has_archived(p_folder_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH RECURSIVE down AS (
    SELECT f.id, f.user_id FROM public.folders f WHERE f.id = p_folder_id
    UNION ALL
    SELECT g.id, g.user_id FROM public.folders g JOIN down d ON g.parent_id = d.id
  )
  SELECT EXISTS (
    SELECT 1
    FROM public.pack_folder_members m
    JOIN down d ON d.id = m.folder_id AND d.user_id = m.user_id
    JOIN public.packs p ON p.id = m.pack_id
    WHERE NOT (m.user_id = p.user_id OR m.contributed)
      AND EXISTS (SELECT 1 FROM public.pack_shares s WHERE s.pack_id = p.id AND s.grantee_id = m.user_id)
  )
$$;

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
