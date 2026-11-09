-- 187: quem manda no critério de um pack é a pasta onde o DONO do pack o colocou.
--
-- Revisão da 186 depois da revisão independente:
--
-- 1. Pack compartilhado sozinho aparece na Biblioteca de quem recebeu, que o arquiva nas
--    pastas DELE (pack_folder_members tem uma linha por pessoa). O critério, porém, é um
--    só (vive no pack). Então só a colocação "do dono" governa: a linha na árvore do dono
--    do pack (m.user_id = dono) ou a que o dono pôs numa pasta compartilhada de outra
--    pessoa (m.contributed). O arquivamento de quem recebeu NUNCA governa — e o nome da
--    pasta do dono só sai se quem pergunta a enxerga.
-- 2. Pack compartilhado com você não entra numa pasta SUA que tenha critério
--    (judgment_move_conflicts — a rota recusa o mover).
-- 3. A ação "pela pasta" não confia na lista de packs do navegador: o servidor calcula os
--    packs que a pasta governa (folder_governed_pack_ids), depois de conferir o papel.
-- 4. Pasta arrastada para dentro de outra que já manda perde o critério próprio (e o das
--    subpastas): reconcile_folder_judgment_on_place, chamada pela rota depois do place.
-- 5. set_folder_judgment trava a árvore (o mesmo advisory lock de move_packs_to_folder):
--    mãe e filha definidas ao mesmo tempo não terminam as duas com critério.
--
-- Deploy: aplicar ANTES do backend (pack_judgment_governors muda de forma: ganha `judgment`).
BEGIN;

-- Interno: a pasta que define critério para p_folder_id (ela mesma ou ancestral; com
-- p_strict, só ancestral), SEM checar quem pergunta. Não é exposto ao cliente.
CREATE OR REPLACE FUNCTION public._folder_judgment_owner(p_folder_id uuid, p_strict boolean)
RETURNS TABLE(folder_id uuid, folder_name text, judgment jsonb)
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
  SELECT up.id, up.name, up.judgment
  FROM up
  WHERE up.judgment IS NOT NULL AND (NOT p_strict OR up.depth > 0)
  ORDER BY up.depth
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.folder_judgment_governor(p_folder_id uuid, p_strict boolean DEFAULT false)
RETURNS TABLE(folder_id uuid, folder_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT o.folder_id,
         CASE WHEN public.folder_access_role(o.folder_id, (SELECT auth.uid())) IS NULL THEN NULL ELSE o.folder_name END
  FROM public._folder_judgment_owner(p_folder_id, p_strict) o
  WHERE public.folder_access_role(p_folder_id, (SELECT auth.uid())) IS NOT NULL
$$;

-- Muda a forma (ganha `judgment`): precisa de DROP.
DROP FUNCTION IF EXISTS public.pack_judgment_governors(uuid[]);
CREATE FUNCTION public.pack_judgment_governors(p_pack_ids uuid[])
RETURNS TABLE(pack_id uuid, folder_id uuid, folder_name text, judgment jsonb)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT m.pack_id, o.folder_id,
         CASE WHEN public.folder_access_role(o.folder_id, (SELECT auth.uid())) IS NULL THEN NULL ELSE o.folder_name END,
         o.judgment
  FROM public.pack_folder_members m
  JOIN public.packs p ON p.id = m.pack_id
  CROSS JOIN LATERAL public._folder_judgment_owner(m.folder_id, false) o
  WHERE m.pack_id = ANY (p_pack_ids)
    -- só a colocação do dono governa (a PK garante uma só por pessoa; o dono tem uma
    -- entre a árvore dele e a que contribuiu numa pasta compartilhada)
    AND (m.user_id = p.user_id OR m.contributed)
    -- quem pergunta precisa ter acesso ao PACK (o critério já está gravado nele)
    AND (
      p.user_id = (SELECT auth.uid())
      OR EXISTS (SELECT 1 FROM public.pack_shares s WHERE s.pack_id = p.id AND s.grantee_id = (SELECT auth.uid()))
    )
$$;

-- Packs que NÃO podem ir para p_folder_id por causa do critério: a pasta (ou ancestral)
-- define critério e a colocação seria de quem não é dono do pack (arquivamento alheio).
-- Espelha o move_packs_to_folder: a árvore de destino é a do dono da pasta; o pack do
-- próprio ator entra como colocação dele (contributed), que governa.
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

-- Packs que a pasta governa: colocação do dono do pack, na subárvore da pasta.
-- Só para quem edita a pasta (dono/editor); senão erro, ANTES de qualquer gravação.
CREATE OR REPLACE FUNCTION public.folder_governed_pack_ids(p_folder_id uuid)
RETURNS SETOF uuid
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
  SELECT m.pack_id
  FROM public.pack_folder_members m
  JOIN down d ON d.id = m.folder_id AND d.user_id = m.user_id
  JOIN public.packs p ON p.id = m.pack_id
  WHERE m.user_id = p.user_id OR m.contributed;
END;
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
  v_tree uuid;
BEGIN
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'folder_not_found' USING ERRCODE = 'P0001';
  ELSIF v_role NOT IN ('dono', 'editor') THEN
    RAISE EXCEPTION 'folder_forbidden' USING ERRCODE = 'P0001';
  END IF;

  SELECT user_id INTO v_tree FROM public.folders WHERE id = p_folder_id;
  PERFORM pg_advisory_xact_lock(hashtextextended('folders_tree:' || v_tree::text, 0));

  IF v_value IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public._folder_judgment_owner(p_folder_id, true)) THEN
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

-- Depois de mover a pasta: se a nova mãe (ou acima) manda, o critério próprio da pasta e
-- das subpastas sai. Devolve o critério que passa a valer na subárvore (NULL = nenhum).
CREATE OR REPLACE FUNCTION public.reconcile_folder_judgment_on_place(p_folder_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role text := public.folder_access_role(p_folder_id, (SELECT auth.uid()));
  v_tree uuid;
  v_governor jsonb;
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('dono', 'editor') THEN
    RETURN NULL;
  END IF;

  SELECT user_id INTO v_tree FROM public.folders WHERE id = p_folder_id;
  PERFORM pg_advisory_xact_lock(hashtextextended('folders_tree:' || v_tree::text, 0));

  SELECT o.judgment INTO v_governor FROM public._folder_judgment_owner(p_folder_id, true) o;
  IF v_governor IS NULL THEN
    RETURN NULL;
  END IF;

  WITH RECURSIVE down AS (
    SELECT f.id FROM public.folders f WHERE f.id = p_folder_id
    UNION ALL
    SELECT g.id FROM public.folders g JOIN down d ON g.parent_id = d.id
  )
  UPDATE public.folders SET judgment = NULL
  WHERE id IN (SELECT id FROM down) AND judgment IS NOT NULL;

  RETURN v_governor;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._folder_judgment_owner(uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.folder_judgment_governor(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.folder_judgment_governor(uuid, boolean) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.pack_judgment_governors(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pack_judgment_governors(uuid[]) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.judgment_move_conflicts(uuid[], uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.judgment_move_conflicts(uuid[], uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.folder_governed_pack_ids(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.folder_governed_pack_ids(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.set_folder_judgment(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_folder_judgment(uuid, jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.reconcile_folder_judgment_on_place(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reconcile_folder_judgment_on_place(uuid) TO authenticated;

COMMIT;
