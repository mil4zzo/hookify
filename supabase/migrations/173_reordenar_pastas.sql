-- ===========================================================================
-- 173 — Reordenar pastas numa ida só
--
-- A coluna folders.position existe desde a 168, mas ninguém a escrevia: toda
-- pasta nascia com 0 e a tela caía na ordem alfabética (desempate do ORDER BY).
-- Agora o explorer deixa arrastar pasta para cima e para baixo.
--
-- Por que uma função e não um UPDATE por pasta:
--   Levar a pasta 7 para o topo muda a posição de 7 pastas (a que subiu e as 6
--   que desceram uma casa). Um UPDATE por pasta seriam 7 idas ao banco em série
--   — com a latência do PostgREST (~50 ms cada), ~0,35 s, e numa lista de 30
--   pastas ~1,5 s. Upsert em lote não serve: o INSERT do upsert exige `name`
--   (NOT NULL), e mandar o nome de volta sobrescreveria um rename concorrente.
--   Aqui é UM UPDATE com a lista inteira, numa transação só.
--
-- Contrato: p_folder_ids é a ordem COMPLETA do grupo, de cima para baixo. A
-- posição vira o índice na lista (0, 1, 2...). Só é escrito o que MUDOU
-- (`IS DISTINCT FROM`): mover a última pasta para o penúltimo lugar toca 2
-- linhas, não todas — o banco só é tocado quando o dado mudou.
--
-- SECURITY INVOKER: roda com a RLS de quem chama. O filtro por auth.uid() é
-- redundante com a policy folders_modify_own, e fica de propósito: id de pasta
-- alheia na lista é ignorado em vez de depender só da policy.
--
-- VOLTA ATRÁS:
--   DROP FUNCTION public.reorder_folders(uuid[]);
--   (as posições já gravadas ficam, e continuam válidas para o ORDER BY)
-- ===========================================================================

BEGIN;

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

-- Função nova nasce executável por PUBLIC (inclui anon). Só quem está logado.
REVOKE EXECUTE ON FUNCTION public.reorder_folders(uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reorder_folders(uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.reorder_folders(uuid[]) TO authenticated;

COMMENT ON FUNCTION public.reorder_folders(uuid[]) IS
  'Grava a ordem das pastas do ator: p_folder_ids e a lista completa, de cima para baixo; position = indice. Um UPDATE so, escrevendo apenas o que mudou. Devolve quantas linhas mudaram (migration 173).';

COMMIT;
