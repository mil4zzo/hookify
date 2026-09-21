-- ===========================================================================
-- 174 — Subpastas
--
-- A 168 já trazia folders.parent_id com a UI plana. Esta migration faz o banco
-- garantir o que a UI aninhada passa a permitir:
--
-- 1. SEM CICLO e SEM PAI ALHEIO (trigger folders_check_parent).
--    A 168 só barrava "pasta pai de si mesma". A dentro de B dentro de A tiraria
--    as duas da tela — nenhuma das duas teria caminho até a raiz — e a RLS só
--    confere o user_id da PRÓPRIA linha, então sem isto dava para pendurar uma
--    pasta sob a pasta de outra pessoa.
--    A corrida também é coberta: duas abas movendo A→B e B→A ao mesmo tempo
--    passariam cada uma na checagem da outra ainda não gravada. O trigger pega
--    uma trava por usuário (advisory de transação) antes de olhar a árvore.
--
-- 2. DESFAZER PASTA SOBE O CONTEÚDO UM NÍVEL (dissolve_folder).
--    Antes o DELETE levava as subpastas junto (FK em CASCADE) e soltava os packs.
--    Agora subpastas e packs vão para a pasta de cima, no lugar que a pasta
--    desfeita ocupava. Na raiz, os packs ficam soltos, como antes.
--    A FK vira SET NULL: se algum caminho apagar direto, a subpasta cai na raiz
--    em vez de sumir.
--
-- 3. MOVER PASTA NUMA IDA (place_folder).
--    Trocar de pai e reordenar os irmãos do destino é uma operação só; em duas
--    chamadas, uma falha no meio deixaria a pasta no pai novo com posição velha.
--
-- Todas SECURITY INVOKER: rodam com a RLS de quem chama.
--
-- VOLTA ATRÁS:
--   DROP FUNCTION public.place_folder(uuid, uuid, uuid[]);
--   DROP FUNCTION public.dissolve_folder(uuid);
--   DROP TRIGGER trg_folders_check_parent ON public.folders;
--   DROP FUNCTION public.folders_check_parent();
--   ALTER TABLE public.folders DROP CONSTRAINT folders_parent_id_fkey,
--     ADD CONSTRAINT folders_parent_id_fkey FOREIGN KEY (parent_id)
--     REFERENCES public.folders(id) ON DELETE CASCADE;
--   (backend anterior apaga com DELETE direto — subpastas iriam para a raiz)
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. FK: CASCADE -> SET NULL
-- ---------------------------------------------------------------------------
ALTER TABLE public.folders DROP CONSTRAINT IF EXISTS folders_parent_id_fkey;
ALTER TABLE public.folders
  ADD CONSTRAINT folders_parent_id_fkey FOREIGN KEY (parent_id)
  REFERENCES public.folders(id) ON DELETE SET NULL;

-- Filhos de uma pasta: a árvore e o dissolve buscam por aqui.
CREATE INDEX IF NOT EXISTS folders_parent_idx
  ON public.folders (parent_id) WHERE parent_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Trigger: pai existe, é do mesmo usuário, e não é descendente
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.folders_check_parent()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Uma árvore por usuário: serializa quem mexe em pai na MESMA árvore.
  PERFORM pg_advisory_xact_lock(hashtextextended('folders_tree:' || NEW.user_id::text, 0));

  IF NOT EXISTS (
    SELECT 1 FROM public.folders p WHERE p.id = NEW.parent_id AND p.user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'folder_parent_not_found' USING ERRCODE = 'P0001',
      HINT = 'A pasta de destino nao existe.';
  END IF;

  -- Sobe a partir do pai novo; se passar pela própria pasta, seria ciclo.
  -- UNION (não UNION ALL): termina mesmo se um ciclo já existisse.
  IF EXISTS (
    WITH RECURSIVE up AS (
      SELECT f.id, f.parent_id FROM public.folders f WHERE f.id = NEW.parent_id
      UNION
      SELECT f.id, f.parent_id FROM public.folders f JOIN up ON f.id = up.parent_id
    )
    SELECT 1 FROM up WHERE up.id = NEW.id
  ) THEN
    RAISE EXCEPTION 'folder_cycle' USING ERRCODE = 'P0001',
      HINT = 'Uma pasta nao pode ir para dentro dela mesma.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_folders_check_parent ON public.folders;
CREATE TRIGGER trg_folders_check_parent
  BEFORE INSERT OR UPDATE OF parent_id ON public.folders
  FOR EACH ROW EXECUTE FUNCTION public.folders_check_parent();

-- ---------------------------------------------------------------------------
-- 3. place_folder: muda o pai (se mudou) e grava a ordem dos irmãos do destino
--
-- p_sibling_ids = ordem COMPLETA do grupo de destino, de cima para baixo, já
-- com a pasta movida no lugar dela. Só é escrito o que mudou.
-- ---------------------------------------------------------------------------
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
      -- Só quem está MESMO nesse grupo: id de outro nível na lista é ignorado.
      AND f.parent_id IS NOT DISTINCT FROM p_parent_id
      AND f.position IS DISTINCT FROM w.pos
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_changed FROM changed;

  RETURN v_changed;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. dissolve_folder: conteúdo sobe um nível, no lugar da pasta desfeita
-- ---------------------------------------------------------------------------
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
  -- Mesma trava da árvore que o trigger usa: sem ela, outra aba movendo uma pasta
  -- (ou um pack) para dentro desta DEPOIS da foto abaixo e ANTES do DELETE veria o
  -- conteúdo novo cair na raiz pela FK, em vez de subir um nível.
  PERFORM pg_advisory_xact_lock(hashtextextended('folders_tree:' || v_uid::text, 0));

  SELECT parent_id, position INTO v_parent, v_pos
  FROM public.folders WHERE id = p_folder_id AND user_id = v_uid
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'folder_not_found' USING ERRCODE = 'P0001', HINT = 'Pasta nao encontrada.';
  END IF;

  SELECT count(*)::integer INTO v_folders FROM public.folders WHERE parent_id = p_folder_id AND user_id = v_uid;

  -- Nova ordem do grupo de cima: os irmãos como estavam, com as subpastas da
  -- desfeita entrando no lugar dela (mesma posição, e a ordem interna delas).
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

REVOKE EXECUTE ON FUNCTION public.place_folder(uuid, uuid, uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.place_folder(uuid, uuid, uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.place_folder(uuid, uuid, uuid[]) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.dissolve_folder(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.dissolve_folder(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.dissolve_folder(uuid) TO authenticated;
-- Função de trigger não é chamada por ninguém diretamente.
REVOKE EXECUTE ON FUNCTION public.folders_check_parent() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.folders_check_parent() FROM anon;

COMMENT ON FUNCTION public.place_folder(uuid, uuid, uuid[]) IS
  'Move a pasta para p_parent_id (NULL = raiz) e grava a ordem completa do grupo de destino; so escreve o que mudou (migration 174).';
COMMENT ON FUNCTION public.dissolve_folder(uuid) IS
  'Desfaz a pasta: subpastas e packs sobem para a pasta de cima, no lugar dela; na raiz os packs ficam soltos (migration 174).';
COMMENT ON COLUMN public.folders.parent_id IS
  'Pasta de cima (NULL = raiz). Ciclo e pai de outro usuario barrados por trg_folders_check_parent (migration 174).';

COMMIT;
