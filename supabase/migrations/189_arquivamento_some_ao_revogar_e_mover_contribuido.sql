-- 189: dois furos achados na revisão independente da 187/188.
--
-- 1. Arquivamento "fantasma" voltava a valer. Quando o dono revoga o compartilhamento de um
--    pack, a linha de pack_folder_members que o convidado tinha (o pack arquivado na pasta
--    DELE) ficava para trás. A 188 passou a ignorá-la, mas, se o dono compartilhasse o pack de
--    novo, a linha ressuscitava dentro de uma pasta que já manda. Agora a linha SOME junto com
--    o compartilhamento (gatilho) e as que já ficaram para trás são limpas aqui.
--    Só sai a colocação de quem NÃO é dono do pack e NÃO a contribuiu (o arquivamento alheio);
--    a do dono e a contribuída nunca são tocadas.
--
-- 2. judgment_move_conflicts dava falso alarme: o editor de uma pasta compartilhada não
--    conseguia mover um pack que o dono do pack já pôs (contribuiu) na árvore, porque a
--    função só olhava "o pack não é meu nem do dono da pasta". O que a regra quer evitar é
--    CRIAR um arquivamento alheio: se já existe a colocação contribuída na árvore da pasta de
--    destino, o mover só a reposiciona e não há conflito.
BEGIN;

-- 1a. Gatilho: revogou/saiu do compartilhamento -> o arquivamento do convidado vai embora.
CREATE OR REPLACE FUNCTION public.trg_pack_shares_drop_archive()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  DELETE FROM public.pack_folder_members m
  USING public.packs p
  WHERE m.pack_id = OLD.pack_id
    AND m.user_id = OLD.grantee_id
    AND p.id = m.pack_id
    AND m.user_id <> p.user_id
    AND NOT m.contributed;
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.trg_pack_shares_drop_archive() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_pack_shares_drop_archive ON public.pack_shares;
CREATE TRIGGER trg_pack_shares_drop_archive
  AFTER DELETE ON public.pack_shares
  FOR EACH ROW EXECUTE FUNCTION public.trg_pack_shares_drop_archive();

-- 1b. Limpeza do que já ficou para trás: arquivamento alheio de pack que a pessoa não recebe mais.
DELETE FROM public.pack_folder_members m
USING public.packs p
WHERE p.id = m.pack_id
  AND m.user_id <> p.user_id
  AND NOT m.contributed
  AND NOT EXISTS (SELECT 1 FROM public.pack_shares s WHERE s.pack_id = m.pack_id AND s.grantee_id = m.user_id);

-- 2. Falso alarme do mover.
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
    -- o dono do pack já o pôs na árvore da pasta: o mover só reposiciona, não arquiva
    AND NOT EXISTS (
      SELECT 1 FROM public.pack_folder_members m
      WHERE m.pack_id = p.id AND m.user_id = f.user_id AND m.contributed
    )
$$;

REVOKE EXECUTE ON FUNCTION public.judgment_move_conflicts(uuid[], uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.judgment_move_conflicts(uuid[], uuid) TO authenticated;

COMMIT;
