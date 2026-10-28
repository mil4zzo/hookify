-- ===========================================================================
-- 181 — Pasta compartilhada, como no Google Drive
--
-- O pedido: compartilhar uma pasta inteira — subpastas e packs de hoje E os que
-- entrarem depois — e quem recebe vê A MESMA pasta do dono. O editor mexe nela
-- como o dono: renomeia, cria e desfaz subpastas, move, cria e exclui packs.
--
-- A Decisão 3 da 168 dizia que a pasta NÃO é sujeito de permissão, porque um pack
-- movido para dentro dela herdaria acesso em silêncio. Esta migration a revisa:
--
--   1. A AUTORIZAÇÃO DE PACK CONTINUA NUM LUGAR SÓ: `pack_shares`. `resolve_pack_access`,
--      a RLS de packs e todas as RPCs de analytics ficam exatamente como estão.
--      Nenhuma leitura de métrica consulta pasta.
--   2. `folder_shares` é quem tem a pasta. Gatilhos materializam isso em linhas de
--      `pack_shares` marcadas com `source_folder_id` ("via pasta"). Cada acesso existe
--      como linha e some junto com o motivo.
--   3. A ÁRVORE É UMA SÓ, a do dono (`folders.user_id`). Quem recebe a pasta não ganha
--      cópia: lê e escreve nas linhas do dono, sempre pelas RPCs daqui, que conferem o
--      papel em `folder_access_role`. A RLS das tabelas continua "só o próprio dono" —
--      o caminho do convidado é só por função, nunca por tabela.
--   4. A UI pede confirmação antes de mover um pack para dentro ou fora de uma pasta
--      compartilhada — o silêncio que a 168 temia é tratado na tela.
--
-- REGRAS (uma função só decide o acesso, `folder_grants_desired`):
--   - Pack entra na pasta (ou numa subpasta) -> ganha o acesso. Sai -> perde.
--   - Pasta mudou de pai, foi compartilhada, descompartilhada ou trocou de papel ->
--     a subárvore inteira é recalculada.
--   - Mais de uma pasta cobre a mesma pessoa: a MAIS PRÓXIMA do pack vale.
--   - DENTRO DA PASTA, TUDO SEGUE A PASTA. Acesso direto de quem a pasta cobre é
--     ABSORVIDO (vira "via pasta", com o papel da pasta): tirar a pessoa da pasta tira
--     de todos os packs, sem sobrar convite esquecido num pack. Acesso direto continua
--     servindo para quem NÃO está na pasta e para pack fora de pasta.
--   - Que packs a pasta repassa: os do DONO da árvore e os que o PRÓPRIO dono do pack
--     pôs lá (`pack_folder_members.contributed`, ex.: o editor cria um pack dentro da
--     pasta). Pack de terceiro que alguém só organizou ali não é repassado — ninguém
--     compartilha o que não é seu.
--   - Pack posto pelo editor continua DELE (conexão Meta e conta de anúncio dele). O
--     dono da árvore recebe acesso de editor a ele; quem tem a pasta, o papel da pasta.
--     Ele só fica na árvore alheia ENQUANTO O DONO DO PACK ENXERGA a pasta onde está:
--     saiu da pasta, foi tirado, ou a pasta foi levada para fora do alcance dele, o
--     pack volta para ele. Decisão de produto: deixá-lo lá manteria a pasta puxando
--     dados da conta de anúncio de quem saiu, com o token dele. Transferir o pack a
--     outro membro foi rejeitado: os dados moram no silo do dono do pack e a conta de
--     anúncio pode nem existir na conexão Meta de quem receberia.
--
-- Convidado não sai sozinho de UM pack que vem por pasta (o gatilho o devolveria);
-- sai da PASTA inteira (DELETE da própria linha de folder_shares).
--
-- VOLTA ATRÁS: 181_rollback.sql
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. folders: alvo de FK composta (pasta, dono) — mesmo truque de packs(id, user_id)
-- ---------------------------------------------------------------------------
DO $mig$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'folders_id_user_id_key') THEN
    ALTER TABLE public.folders ADD CONSTRAINT folders_id_user_id_key UNIQUE (id, user_id);
  END IF;
END
$mig$;

-- ---------------------------------------------------------------------------
-- 2. folder_shares: quem tem a pasta
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.folder_shares (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folder_id   uuid NOT NULL,
  -- Denormalizado de folders.user_id; a FK composta abaixo impede forjar.
  owner_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  grantee_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role        text NOT NULL DEFAULT 'editor',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT folder_shares_role_check CHECK (role IN ('editor', 'viewer')),
  CONSTRAINT folder_shares_not_self CHECK (owner_id <> grantee_id),
  CONSTRAINT folder_shares_unique_grant UNIQUE (folder_id, grantee_id),
  CONSTRAINT folder_shares_folder_owner_fkey
    FOREIGN KEY (folder_id, owner_id) REFERENCES public.folders (id, user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS folder_shares_owner_idx ON public.folder_shares (owner_id);
CREATE INDEX IF NOT EXISTS folder_shares_grantee_idx ON public.folder_shares (grantee_id);

DROP TRIGGER IF EXISTS set_folder_shares_updated_at ON public.folder_shares;
CREATE TRIGGER set_folder_shares_updated_at
  BEFORE UPDATE ON public.folder_shares
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.folder_shares ENABLE ROW LEVEL SECURITY;

-- Dono: tudo. Convidado: lê a própria linha e sai da pasta (apaga a própria linha).
DROP POLICY IF EXISTS folder_shares_owner_all ON public.folder_shares;
CREATE POLICY folder_shares_owner_all ON public.folder_shares
  USING      (owner_id = (SELECT auth.uid()))
  WITH CHECK (owner_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS folder_shares_grantee_read ON public.folder_shares;
CREATE POLICY folder_shares_grantee_read ON public.folder_shares
  FOR SELECT USING (grantee_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS folder_shares_grantee_leave ON public.folder_shares;
CREATE POLICY folder_shares_grantee_leave ON public.folder_shares
  FOR DELETE USING (grantee_id = (SELECT auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.folder_shares TO authenticated;
GRANT ALL ON public.folder_shares TO service_role;

COMMENT ON TABLE public.folder_shares IS
  'Quem tem a pasta (e tudo debaixo dela, hoje e depois). Gatilhos materializam em pack_shares (source_folder_id); as RPCs de pasta conferem o papel aqui (folder_access_role). Migration 181.';

-- ---------------------------------------------------------------------------
-- 3. pack_folder_members.contributed: o DONO DO PACK o pôs na árvore de outra pessoa
--
-- Distingue "o editor criou o pack dele dentro da pasta" (repassado a quem tem a
-- pasta) de "alguém organizou ali um pack de terceiro que recebeu" (não repassado).
-- Só as RPCs escrevem `true`: pela tabela, a policy exige `false` — senão bastaria
-- marcar a linha para repassar o pack de outra pessoa.
-- ---------------------------------------------------------------------------
ALTER TABLE public.pack_folder_members ADD COLUMN IF NOT EXISTS contributed boolean NOT NULL DEFAULT false;

-- Toda reconciliação parte do pack: "onde este pack está, em qualquer árvore".
CREATE INDEX IF NOT EXISTS pack_folder_members_pack_idx ON public.pack_folder_members (pack_id);

DROP POLICY IF EXISTS pack_folder_members_modify_own ON public.pack_folder_members;
CREATE POLICY pack_folder_members_modify_own ON public.pack_folder_members
  USING      (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()) AND NOT contributed);

COMMENT ON COLUMN public.pack_folder_members.contributed IS
  'true = o dono do pack o colocou na arvore de outra pessoa (pasta compartilhada): quem tem a pasta o recebe. So as RPCs da 181 escrevem true.';

-- ---------------------------------------------------------------------------
-- 4. pack_shares.source_folder_id: de onde veio o acesso (NULL = direto)
--
-- FK simples (não composta com owner_id): o pack posto pelo editor é DELE, e a pasta
-- é do dono da árvore — os dois donos diferem por desenho.
-- ---------------------------------------------------------------------------
ALTER TABLE public.pack_shares ADD COLUMN IF NOT EXISTS source_folder_id uuid;

DO $mig$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pack_shares_source_folder_fkey') THEN
    ALTER TABLE public.pack_shares
      ADD CONSTRAINT pack_shares_source_folder_fkey
      FOREIGN KEY (source_folder_id) REFERENCES public.folders (id) ON DELETE CASCADE;
  END IF;
END
$mig$;

CREATE INDEX IF NOT EXISTS pack_shares_source_folder_idx
  ON public.pack_shares (source_folder_id) WHERE source_folder_id IS NOT NULL;

COMMENT ON COLUMN public.pack_shares.source_folder_id IS
  'Pasta que originou este acesso (migration 181). NULL = concedido direto no pack. Linhas com origem sao mantidas pelos gatilhos; ninguem as edita pelo pack.';

-- O convidado sai por conta propria so do que foi concedido direto.
DROP POLICY IF EXISTS pack_shares_grantee_leave ON public.pack_shares;
CREATE POLICY pack_shares_grantee_leave ON public.pack_shares
  FOR DELETE USING (grantee_id = (SELECT auth.uid()) AND source_folder_id IS NULL);

-- ---------------------------------------------------------------------------
-- 5. O papel de alguém numa pasta: 'dono' | 'editor' | 'viewer' | NULL
--
-- Sobe da pasta até a raiz da árvore; a pasta compartilhada MAIS PRÓXIMA vale.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.folder_access_role(p_folder_id uuid, p_actor uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN f.user_id = p_actor THEN 'dono'
    ELSE (
      WITH RECURSIVE up AS (
        SELECT f.id, f.parent_id, 0 AS depth
        UNION ALL
        SELECT g.id, g.parent_id, up.depth + 1
        FROM public.folders g JOIN up ON g.id = up.parent_id
        WHERE g.user_id = f.user_id AND up.depth < 50
      )
      SELECT fs.role
      FROM up JOIN public.folder_shares fs ON fs.folder_id = up.id AND fs.grantee_id = p_actor
      ORDER BY up.depth
      LIMIT 1
    )
  END
  FROM public.folders f
  WHERE f.id = p_folder_id AND p_actor IS NOT NULL
$$;

-- ---------------------------------------------------------------------------
-- 6. O que DEVERIA existir — a única definição da regra de acesso
--
-- Para cada pack pedido que mora numa árvore e que essa árvore pode repassar (pack
-- do dono da árvore, ou posto lá pelo próprio dono do pack): sobe a cadeia e, por
-- pessoa, fica com a pasta compartilhada MAIS PRÓXIMA. O dono da árvore, quando não
-- é o dono do pack, entra como editor.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.folder_grants_desired(p_pack_ids uuid[])
RETURNS TABLE (pack_id uuid, pack_owner uuid, grantee_id uuid, role text, source_folder_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH RECURSIVE placed AS (
    SELECT m.pack_id, m.user_id AS tree_owner, m.folder_id, p.user_id AS pack_owner
    FROM public.pack_folder_members m
    JOIN public.packs p ON p.id = m.pack_id
    -- Conta da árvore sendo apagada: as pastas dela estão caindo em cascata.
    JOIN auth.users tu ON tu.id = m.user_id
    WHERE m.pack_id = ANY (p_pack_ids)
      AND (p.user_id = m.user_id OR m.contributed)
  ),
  chain AS (
    SELECT pl.pack_id, pl.tree_owner, pl.pack_owner, pl.folder_id, 0 AS depth FROM placed pl
    UNION ALL
    SELECT c.pack_id, c.tree_owner, c.pack_owner, f.parent_id, c.depth + 1
    FROM chain c
    JOIN public.folders f ON f.id = c.folder_id AND f.user_id = c.tree_owner
    WHERE f.parent_id IS NOT NULL AND c.depth < 50
  ),
  candidates AS (
    SELECT c.pack_id, c.pack_owner, fs.grantee_id, fs.role, fs.folder_id AS source_folder_id, 1 AS rank, c.depth
    FROM chain c
    JOIN public.folder_shares fs ON fs.folder_id = c.folder_id AND fs.owner_id = c.tree_owner
    -- A pessoa tem de EXISTIR: apagar uma conta apaga os acessos dela em cascata, e um
    -- gatilho rodando no meio disso recriaria o convite de quem acabou de sair.
    JOIN auth.users u ON u.id = fs.grantee_id
    UNION ALL
    SELECT pl.pack_id, pl.pack_owner, pl.tree_owner, 'editor', pl.folder_id, 0, 0
    FROM placed pl
    WHERE pl.pack_owner <> pl.tree_owner
  )
  SELECT DISTINCT ON (x.pack_id, x.grantee_id)
         x.pack_id, x.pack_owner, x.grantee_id, x.role, x.source_folder_id
  FROM candidates x
  WHERE x.grantee_id <> x.pack_owner
  ORDER BY x.pack_id, x.grantee_id, x.rank, x.depth
$$;

-- ---------------------------------------------------------------------------
-- 7. Reconciliação de um conjunto de packs: cria, atualiza e remove o que vem de
--    pasta, e ABSORVE o direto de quem a pasta cobre (ON CONFLICT sem filtro de origem).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_folder_pack_grants(p_pack_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_pack_ids IS NULL OR cardinality(p_pack_ids) = 0 THEN
    RETURN;
  END IF;

  -- Atalho: pack sem acesso por pasta, fora de árvore que compartilhe algo e que
  -- ninguém pôs na árvore alheia não paga nada. É quase todo movimento de pack.
  IF NOT EXISTS (
       SELECT 1 FROM public.pack_shares
       WHERE pack_id = ANY (p_pack_ids) AND source_folder_id IS NOT NULL
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.pack_folder_members m
       WHERE m.pack_id = ANY (p_pack_ids)
         AND (m.contributed OR EXISTS (SELECT 1 FROM public.folder_shares fs WHERE fs.owner_id = m.user_id))
     ) THEN
    RETURN;
  END IF;

  -- Pack posto na árvore alheia pelo próprio dono só fica enquanto ele ENXERGA a pasta
  -- onde está. Saiu da pasta, foi tirado dela, ou a pasta foi levada para fora do que
  -- ele vê: o pack volta para ele (solto). Sem isto a pasta seguiria puxando dados da
  -- conta de anúncio de quem já saiu, com o token dele — e ele, dono, poderia apagar o
  -- pack sem nem ver a pasta. Este DELETE dispara o gatilho de vínculo, que reconcilia
  -- de novo os mesmos packs (já sem a linha); a conta abaixo sai igual.
  DELETE FROM public.pack_folder_members m
  USING public.packs p
  WHERE m.pack_id = ANY (p_pack_ids)
    AND m.contributed
    AND p.id = m.pack_id
    AND public.folder_access_role(m.folder_id, p.user_id) IS NULL;

  WITH d AS MATERIALIZED (
    SELECT * FROM public.folder_grants_desired(p_pack_ids)
  ),
  gone AS (
    DELETE FROM public.pack_shares s
    WHERE s.pack_id = ANY (p_pack_ids)
      AND s.source_folder_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM d WHERE d.pack_id = s.pack_id AND d.grantee_id = s.grantee_id)
    RETURNING 1
  )
  INSERT INTO public.pack_shares (pack_id, owner_id, grantee_id, role, source_folder_id)
  SELECT d.pack_id, d.pack_owner, d.grantee_id, d.role, d.source_folder_id FROM d
  ON CONFLICT (pack_id, grantee_id) DO UPDATE
    SET role = EXCLUDED.role, source_folder_id = EXCLUDED.source_folder_id
    WHERE (public.pack_shares.role, public.pack_shares.source_folder_id)
          IS DISTINCT FROM (EXCLUDED.role, EXCLUDED.source_folder_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. Reconciliação de uma subárvore: os packs de cada pasta pedida e das
--    descendentes, mais os que hoje têm acesso originado nelas (rede de proteção
--    para o pack que já não está lá).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_folder_subtree_grants(p_folder_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_packs uuid[];
BEGIN
  IF p_folder_ids IS NULL OR cardinality(p_folder_ids) = 0 THEN
    RETURN;
  END IF;

  WITH RECURSIVE sub AS (
    SELECT f.id, f.user_id FROM public.folders f WHERE f.id = ANY (p_folder_ids)
    UNION
    SELECT c.id, c.user_id FROM public.folders c JOIN sub ON c.parent_id = sub.id AND c.user_id = sub.user_id
  ),
  affected AS (
    SELECT m.pack_id FROM public.pack_folder_members m JOIN sub ON m.folder_id = sub.id AND m.user_id = sub.user_id
    UNION
    SELECT s.pack_id FROM public.pack_shares s
    WHERE s.source_folder_id = ANY (p_folder_ids) OR s.source_folder_id IN (SELECT id FROM sub)
  )
  SELECT array_agg(pack_id) INTO v_packs FROM affected;

  PERFORM public.sync_folder_pack_grants(v_packs);
END;
$$;

-- ---------------------------------------------------------------------------
-- 9. Gatilhos
-- ---------------------------------------------------------------------------

-- 9a. Pack entrou/saiu/trocou de pasta (statement-level: mover 200 packs é UMA
--     reconciliação, não 200).
CREATE OR REPLACE FUNCTION public.trg_pack_folder_members_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_packs uuid[];
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT array_agg(DISTINCT pack_id) INTO v_packs FROM old_rows;
  ELSE
    SELECT array_agg(DISTINCT pack_id) INTO v_packs FROM new_rows;
  END IF;
  PERFORM public.sync_folder_pack_grants(v_packs);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_pfm_sync_ins ON public.pack_folder_members;
CREATE TRIGGER trg_pfm_sync_ins AFTER INSERT ON public.pack_folder_members
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.trg_pack_folder_members_sync();

-- Sem lista de colunas: gatilho com tabela de transição não aceita.
DROP TRIGGER IF EXISTS trg_pfm_sync_upd ON public.pack_folder_members;
CREATE TRIGGER trg_pfm_sync_upd AFTER UPDATE ON public.pack_folder_members
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.trg_pack_folder_members_sync();

DROP TRIGGER IF EXISTS trg_pfm_sync_del ON public.pack_folder_members;
CREATE TRIGGER trg_pfm_sync_del AFTER DELETE ON public.pack_folder_members
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.trg_pack_folder_members_sync();

-- 9b. Pasta mudou de pai: a subárvore entrou/saiu de uma pasta compartilhada.
CREATE OR REPLACE FUNCTION public.trg_folders_reparent_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.sync_folder_subtree_grants(ARRAY[NEW.id]);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_folders_reparent_sync ON public.folders;
CREATE TRIGGER trg_folders_reparent_sync
  AFTER UPDATE OF parent_id ON public.folders
  FOR EACH ROW WHEN (OLD.parent_id IS DISTINCT FROM NEW.parent_id)
  EXECUTE FUNCTION public.trg_folders_reparent_sync();

-- 9c. Pasta compartilhada, descompartilhada ou com papel trocado.
CREATE OR REPLACE FUNCTION public.trg_folder_shares_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.sync_folder_subtree_grants(ARRAY[OLD.folder_id]);
  ELSE
    PERFORM public.sync_folder_subtree_grants(ARRAY[NEW.folder_id]);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_folder_shares_sync ON public.folder_shares;
CREATE TRIGGER trg_folder_shares_sync
  AFTER INSERT OR UPDATE OR DELETE ON public.folder_shares
  FOR EACH ROW EXECUTE FUNCTION public.trg_folder_shares_sync();

-- ---------------------------------------------------------------------------
-- 10. RPCs da árvore — o ÚNICO caminho para mexer em pasta e vínculo
--
-- SECURITY DEFINER com o ator de auth.uid(): o editor escreve nas linhas do dono,
-- coisa que a RLS (só o próprio dono) não deixa. Cada uma confere o papel antes.
-- Regras do editor:
--   - age em qualquer pasta onde tem papel 'editor' (renomear, criar subpasta);
--   - mover ou desfazer uma pasta exige ser editor da pasta DE CIMA dela: a pasta
--     compartilhada com ele (a raiz do que ele enxerga) só o dono move ou desfaz;
--   - nunca leva nada para fora da árvore do dono, exceto o pack que é dele.
-- Erros saem como P0001 com a mensagem-código (o backend os traduz).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_folder(p_name text, p_parent_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_owner uuid;
  v_role text;
  v_count integer;
  v_next integer;
  v_row public.folders;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  IF p_parent_id IS NULL THEN
    v_owner := v_uid;
  ELSE
    v_role := public.folder_access_role(p_parent_id, v_uid);
    IF v_role IS NULL THEN
      RAISE EXCEPTION 'folder_parent_not_found' USING ERRCODE = 'P0001';
    ELSIF v_role NOT IN ('dono', 'editor') THEN
      RAISE EXCEPTION 'folder_forbidden' USING ERRCODE = 'P0001';
    END IF;
    SELECT user_id INTO v_owner FROM public.folders WHERE id = p_parent_id;
  END IF;

  -- O limite e a posição são da ÁRVORE (do dono), não de quem cria.
  SELECT count(*)::integer, coalesce(max(position) + 1, 0)::integer INTO v_count, v_next
  FROM public.folders WHERE user_id = v_owner;
  IF v_count >= 100 THEN
    RAISE EXCEPTION 'folder_limit' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.folders (user_id, name, parent_id, position)
  VALUES (v_owner, p_name, p_parent_id, v_next)
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'id', v_row.id, 'name', v_row.name, 'parent_id', v_row.parent_id, 'position', v_row.position,
    'created_at', v_row.created_at, 'updated_at', v_row.updated_at, 'owner_id', v_row.user_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.rename_folder(p_folder_id uuid, p_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_role text := public.folder_access_role(p_folder_id, (SELECT auth.uid()));
  v_row public.folders;
BEGIN
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'folder_not_found' USING ERRCODE = 'P0001';
  ELSIF v_role NOT IN ('dono', 'editor') THEN
    RAISE EXCEPTION 'folder_forbidden' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.folders SET name = p_name WHERE id = p_folder_id RETURNING * INTO v_row;
  RETURN jsonb_build_object('id', v_row.id, 'name', v_row.name, 'parent_id', v_row.parent_id, 'position', v_row.position);
END;
$$;

-- place_folder (174) generalizada: a árvore é a do dono da pasta movida.
CREATE OR REPLACE FUNCTION public.place_folder(p_folder_id uuid, p_parent_id uuid, p_sibling_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_owner uuid;
  v_cur_parent uuid;
  v_changed integer;
BEGIN
  IF NOT (p_folder_id = ANY (p_sibling_ids)) THEN
    RAISE EXCEPTION 'folder_not_in_siblings' USING ERRCODE = 'P0001',
      HINT = 'A lista de irmaos precisa conter a pasta movida.';
  END IF;

  SELECT user_id, parent_id INTO v_owner, v_cur_parent FROM public.folders WHERE id = p_folder_id;
  IF NOT FOUND OR public.folder_access_role(p_folder_id, v_uid) IS NULL THEN
    RAISE EXCEPTION 'folder_not_found' USING ERRCODE = 'P0001', HINT = 'Pasta nao encontrada.';
  END IF;

  IF v_owner <> v_uid AND (
       v_cur_parent IS NULL OR public.folder_access_role(v_cur_parent, v_uid) IS DISTINCT FROM 'editor'
       OR p_parent_id IS NULL OR public.folder_access_role(p_parent_id, v_uid) IS DISTINCT FROM 'editor'
     ) THEN
    RAISE EXCEPTION 'folder_forbidden' USING ERRCODE = 'P0001';
  END IF;

  -- Pai em outra árvore: o gatilho folders_check_parent recusa (folder_parent_not_found).
  UPDATE public.folders
  SET parent_id = p_parent_id
  WHERE id = p_folder_id AND parent_id IS DISTINCT FROM p_parent_id;

  WITH wanted AS (
    SELECT t.id, (t.ord - 1)::integer AS pos
    FROM unnest(p_sibling_ids) WITH ORDINALITY AS t(id, ord)
  ),
  changed AS (
    UPDATE public.folders f
    SET position = w.pos
    FROM wanted w
    WHERE f.id = w.id
      AND f.user_id = v_owner
      -- Só quem está MESMO nesse grupo: id de outro nível na lista é ignorado.
      AND f.parent_id IS NOT DISTINCT FROM p_parent_id
      AND f.position IS DISTINCT FROM w.pos
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_changed FROM changed;

  RETURN v_changed;
END;
$$;

-- reorder_folders (173) generalizada: grava a posição das pastas do ator e das que
-- ele edita como editor da pasta de cima. As demais da lista são ignoradas.
CREATE OR REPLACE FUNCTION public.reorder_folders(p_folder_ids uuid[])
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
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
      AND f.position IS DISTINCT FROM w.pos
      AND (
        f.user_id = (SELECT auth.uid())
        OR (f.parent_id IS NOT NULL AND public.folder_access_role(f.parent_id, (SELECT auth.uid())) = 'editor')
      )
    RETURNING 1
  )
  SELECT count(*)::integer FROM changed;
$$;

-- dissolve_folder (174) generalizada: conteúdo sobe um nível na árvore do dono.
CREATE OR REPLACE FUNCTION public.dissolve_folder(p_folder_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_owner uuid;
  v_parent uuid;
  v_pos integer;
  v_folders integer;
  v_packs integer;
BEGIN
  SELECT user_id INTO v_owner FROM public.folders WHERE id = p_folder_id;
  IF NOT FOUND OR public.folder_access_role(p_folder_id, v_uid) IS NULL THEN
    RAISE EXCEPTION 'folder_not_found' USING ERRCODE = 'P0001', HINT = 'Pasta nao encontrada.';
  END IF;

  -- Mesma trava da árvore que o gatilho usa: sem ela, outra aba movendo uma pasta
  -- (ou um pack) para dentro desta DEPOIS da foto abaixo e ANTES do DELETE veria o
  -- conteúdo novo cair na raiz pela FK, em vez de subir um nível.
  PERFORM pg_advisory_xact_lock(hashtextextended('folders_tree:' || v_owner::text, 0));

  SELECT parent_id, position INTO v_parent, v_pos
  FROM public.folders WHERE id = p_folder_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'folder_not_found' USING ERRCODE = 'P0001', HINT = 'Pasta nao encontrada.';
  END IF;

  IF v_owner <> v_uid AND (v_parent IS NULL OR public.folder_access_role(v_parent, v_uid) IS DISTINCT FROM 'editor') THEN
    RAISE EXCEPTION 'folder_forbidden' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*)::integer INTO v_folders FROM public.folders WHERE parent_id = p_folder_id AND user_id = v_owner;

  -- Nova ordem do grupo de cima: os irmãos como estavam, com as subpastas da
  -- desfeita entrando no lugar dela (mesma posição, e a ordem interna delas).
  WITH grp AS (
    SELECT id, position AS p1, 0 AS lvl, 0 AS p2, name
    FROM public.folders
    WHERE user_id = v_owner AND parent_id IS NOT DISTINCT FROM v_parent AND id <> p_folder_id
    UNION ALL
    SELECT id, v_pos, 1, position, name
    FROM public.folders
    WHERE user_id = v_owner AND parent_id = p_folder_id
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
    DELETE FROM public.pack_folder_members WHERE folder_id = p_folder_id AND user_id = v_owner;
  ELSE
    UPDATE public.pack_folder_members SET folder_id = v_parent WHERE folder_id = p_folder_id AND user_id = v_owner;
  END IF;
  GET DIAGNOSTICS v_packs = ROW_COUNT;

  DELETE FROM public.folders WHERE id = p_folder_id AND user_id = v_owner;

  RETURN jsonb_build_object('parent_id', v_parent, 'folders_moved', v_folders, 'packs_moved', v_packs);
END;
$$;

-- Mover packs para uma pasta (ou tirar, com p_folder_id NULL).
--
-- "Onde o pack está", do ponto de vista do ator: primeiro numa árvore ALHEIA que ele
-- enxerga (pasta compartilhada com ele), depois na árvore dele.
--   - Dentro da mesma árvore alheia: exige editor na pasta de origem.
--   - Para dentro de uma árvore alheia vindo de fora: só o pack que é DO ator (fica
--     marcado `contributed`, e quem tem a pasta o recebe).
--   - Pack do próprio ator: um lugar só. Pô-lo em qualquer pasta tira de onde ele
--     estava (inclusive de árvore alheia que ele já não enxerga).
--   - Tirar da pasta: editor da pasta, ou o dono do pack.
-- Um pack recusado recusa o lote inteiro: mover pela metade confundiria mais.
CREATE OR REPLACE FUNCTION public.move_packs_to_folder(p_pack_ids uuid[], p_folder_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_tree uuid;
  v_role text;
  r record;
  v_sp_tree uuid;
  v_sp_folder uuid;
  v_sp_role text;
  v_upd uuid[] := '{}';
  v_ins uuid[] := '{}';
  v_own uuid[] := '{}';
  v_del_tree uuid[] := '{}';
  v_del_pack uuid[] := '{}';
  v_denied integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  IF p_folder_id IS NOT NULL THEN
    v_role := public.folder_access_role(p_folder_id, v_uid);
    IF v_role IS NULL THEN
      RAISE EXCEPTION 'folder_not_found' USING ERRCODE = 'P0001';
    ELSIF v_role NOT IN ('dono', 'editor') THEN
      RAISE EXCEPTION 'folder_forbidden' USING ERRCODE = 'P0001';
    END IF;
    SELECT user_id INTO v_tree FROM public.folders WHERE id = p_folder_id;
    PERFORM pg_advisory_xact_lock(hashtextextended('folders_tree:' || v_tree::text, 0));
  END IF;

  FOR r IN
    SELECT q.pack_id, p.user_id AS pack_owner,
           (p.user_id = v_uid OR EXISTS (
              SELECT 1 FROM public.pack_shares s WHERE s.pack_id = q.pack_id AND s.grantee_id = v_uid
           )) AS has_access
    FROM (SELECT DISTINCT unnest(p_pack_ids) AS pack_id) q
    LEFT JOIN public.packs p ON p.id = q.pack_id
  LOOP
    IF r.pack_owner IS NULL OR NOT r.has_access THEN
      v_denied := v_denied + 1;
      CONTINUE;
    END IF;

    v_sp_tree := NULL; v_sp_folder := NULL; v_sp_role := NULL;
    SELECT m.user_id, m.folder_id, public.folder_access_role(m.folder_id, v_uid)
      INTO v_sp_tree, v_sp_folder, v_sp_role
    FROM public.pack_folder_members m
    WHERE m.pack_id = r.pack_id
      AND m.user_id <> v_uid
      AND (m.contributed OR m.user_id = r.pack_owner)
      AND public.folder_access_role(m.folder_id, v_uid) IS NOT NULL
    LIMIT 1;

    IF p_folder_id IS NOT NULL THEN
      IF v_sp_tree IS NOT NULL AND v_sp_tree = v_tree THEN
        IF v_sp_role = 'editor' OR r.pack_owner = v_uid THEN v_upd := v_upd || r.pack_id; ELSE v_denied := v_denied + 1; END IF;
      ELSIF r.pack_owner = v_uid THEN
        v_own := v_own || r.pack_id;
        v_ins := v_ins || r.pack_id;
      ELSIF v_sp_tree IS NULL AND v_tree = v_uid THEN
        v_ins := v_ins || r.pack_id;
      ELSE
        v_denied := v_denied + 1;
      END IF;
    ELSE
      IF v_sp_tree IS NOT NULL THEN
        IF v_sp_role = 'editor' OR r.pack_owner = v_uid THEN
          v_del_tree := v_del_tree || v_sp_tree;
          v_del_pack := v_del_pack || r.pack_id;
        ELSE
          v_denied := v_denied + 1;
        END IF;
      ELSE
        v_del_tree := v_del_tree || v_uid;
        v_del_pack := v_del_pack || r.pack_id;
      END IF;
    END IF;
  END LOOP;

  IF v_denied > 0 THEN
    RAISE EXCEPTION 'pack_move_forbidden' USING ERRCODE = 'P0001', DETAIL = v_denied::text;
  END IF;

  -- Pack que o editor pôs na pasta só circula por onde ELE também vê: levá-lo para uma
  -- pasta fora do alcance dele o devolveria na hora (ver sync_folder_pack_grants), e um
  -- mover que "some com o pack" é pior que um mover recusado com o motivo.
  IF p_folder_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM unnest(v_upd || v_ins) AS q(id)
    JOIN public.pack_folder_members m ON m.pack_id = q.id AND m.user_id = v_tree AND m.contributed
    JOIN public.packs p ON p.id = q.id
    WHERE public.folder_access_role(p_folder_id, p.user_id) IS NULL
  ) THEN
    RAISE EXCEPTION 'pack_owner_outside' USING ERRCODE = 'P0001';
  END IF;

  IF p_folder_id IS NOT NULL THEN
    IF cardinality(v_upd) > 0 THEN
      UPDATE public.pack_folder_members SET folder_id = p_folder_id
      WHERE user_id = v_tree AND pack_id = ANY (v_upd) AND folder_id IS DISTINCT FROM p_folder_id;
    END IF;

    -- Pack do ator: tira dos outros lugares dele antes de pôr no novo.
    IF cardinality(v_own) > 0 THEN
      DELETE FROM public.pack_folder_members
      WHERE pack_id = ANY (v_own) AND user_id <> v_tree AND (user_id = v_uid OR contributed);
    END IF;

    IF cardinality(v_ins) > 0 THEN
      INSERT INTO public.pack_folder_members (user_id, pack_id, folder_id, contributed)
      SELECT v_tree, q.id, p_folder_id, (p.user_id = v_uid AND v_tree <> v_uid)
      FROM unnest(v_ins) AS q(id) JOIN public.packs p ON p.id = q.id
      ON CONFLICT (user_id, pack_id) DO UPDATE
        SET folder_id = EXCLUDED.folder_id,
            contributed = public.pack_folder_members.contributed OR EXCLUDED.contributed
        -- Só escreve o que mudou: um UPDATE sem mudança dispararia a reconciliação à toa.
        WHERE (public.pack_folder_members.folder_id, public.pack_folder_members.contributed)
              IS DISTINCT FROM (EXCLUDED.folder_id, public.pack_folder_members.contributed OR EXCLUDED.contributed);
    END IF;
  ELSIF cardinality(v_del_pack) > 0 THEN
    DELETE FROM public.pack_folder_members m
    USING unnest(v_del_tree, v_del_pack) AS d(tree, pack)
    WHERE m.user_id = d.tree AND m.pack_id = d.pack;
  END IF;

  RETURN cardinality(v_upd) + cardinality(v_ins) + cardinality(v_del_pack);
END;
$$;

-- O que foi compartilhado COM o ator: as pastas (com o papel dele em cada uma) e
-- onde estão os packs que ele pode ver. A pasta compartilhada mais alta de cada
-- ramo sai com parent_id NULL — é a raiz do que ele enxerga.
CREATE OR REPLACE FUNCTION public.list_shared_folders()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH RECURSIVE sub AS (
    SELECT f.id, f.user_id
    FROM public.folder_shares fs JOIN public.folders f ON f.id = fs.folder_id
    WHERE fs.grantee_id = (SELECT auth.uid())
    UNION
    SELECT c.id, c.user_id FROM public.folders c JOIN sub ON c.parent_id = sub.id AND c.user_id = sub.user_id
  ),
  visible AS (
    SELECT f.id, f.user_id, f.name, f.parent_id, f.position, f.created_at, f.updated_at,
           public.folder_access_role(f.id, (SELECT auth.uid())) AS role,
           (f.parent_id IS NULL OR f.parent_id NOT IN (SELECT id FROM sub)) AS is_root
    FROM public.folders f
    WHERE f.id IN (SELECT id FROM sub)
  )
  SELECT jsonb_build_object(
    'folders', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', v.id, 'name', v.name,
        'parent_id', CASE WHEN v.is_root THEN NULL ELSE v.parent_id END,
        'position', v.position, 'created_at', v.created_at, 'updated_at', v.updated_at,
        'owner_id', v.user_id, 'access', v.role, 'shared_root', v.is_root
      ) ORDER BY v.position, v.name)
      FROM visible v
    ), '[]'::jsonb),
    'members', coalesce((
      SELECT jsonb_agg(jsonb_build_object('pack_id', m.pack_id, 'folder_id', m.folder_id))
      FROM public.pack_folder_members m
      JOIN visible v ON v.id = m.folder_id AND v.user_id = m.user_id
      JOIN public.packs p ON p.id = m.pack_id
      WHERE (p.user_id = m.user_id OR m.contributed)
        AND (p.user_id = (SELECT auth.uid()) OR EXISTS (
              SELECT 1 FROM public.pack_shares s WHERE s.pack_id = m.pack_id AND s.grantee_id = (SELECT auth.uid())
            ))
    ), '[]'::jsonb)
  )
$$;

-- ---------------------------------------------------------------------------
-- 11. Permissões
--
-- Funções internas: ninguém chama pelo PostgREST. Gatilho não depende de EXECUTE do
-- papel que escreve (só é conferido no CREATE TRIGGER), então o revoke é total —
-- inclusive de `authenticated`, que as executaria como DONO (definer).
-- RPCs: só quem está logado. O Supabase dá EXECUTE explícito a `anon` em função nova
-- (migration 180): o revoke de anon é explícito, não basta o de PUBLIC.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  fn regprocedure;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'folder_access_role', 'folder_grants_desired', 'sync_folder_pack_grants', 'sync_folder_subtree_grants',
        'trg_pack_folder_members_sync', 'trg_folders_reparent_sync', 'trg_folder_shares_sync'
      )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
  END LOOP;

  FOR fn IN
    SELECT p.oid::regprocedure
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'create_folder', 'rename_folder', 'place_folder', 'reorder_folders', 'dissolve_folder',
        'move_packs_to_folder', 'list_shared_folders'
      )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn);
  END LOOP;
END $$;

COMMENT ON FUNCTION public.move_packs_to_folder(uuid[], uuid) IS
  'Move packs para a pasta (NULL = tira da pasta), na arvore do dono da pasta. Confere papel por pack; um recusado recusa o lote (pack_move_forbidden). Migration 181.';
COMMENT ON FUNCTION public.list_shared_folders() IS
  'Pastas compartilhadas com o ator (papel em cada uma, raiz de cada ramo com parent_id NULL) e onde estao os packs que ele pode ver. Migration 181.';

-- ---------------------------------------------------------------------------
-- 12. Backfill: nada. A tabela nasce vazia, nenhuma pasta está compartilhada.
-- ---------------------------------------------------------------------------

COMMIT;
