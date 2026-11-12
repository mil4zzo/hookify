-- 192: a linha de pack_folder_members só pode apontar para pasta da MESMA pessoa.
--
-- Achado na revisão independente da 190: nada impedia (user_id = A, folder_id = pasta de B).
-- A RLS só exige user_id = auth.uid(), então quem soubesse o UUID de uma pasta alheia podia:
--   * ler o critério de julgamento dela (pack_judgment_governors devolvia a pasta que "manda");
--   * descobrir se a pasta existe e se manda (os gatilhos da 190 respondem diferente).
-- As rotas sempre gravaram a linha em nome do dono da árvore (user_id = dono da pasta), então
-- a regra já era verdadeira para todo dado real: em produção, 0 linhas violavam (conferido em
-- 2026-11-12, 57 linhas). Agora o banco a garante. Mesmo ON DELETE CASCADE da chave simples
-- que já existe (apagar a pasta apaga as colocações).
BEGIN;
-- Se outra transação segura a tabela, falha limpo em vez de enfileirar escritas atrás de si.
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pack_folder_members_folder_owner_fkey') THEN
    ALTER TABLE public.pack_folder_members
      ADD CONSTRAINT pack_folder_members_folder_owner_fkey
      FOREIGN KEY (folder_id, user_id) REFERENCES public.folders (id, user_id) ON DELETE CASCADE;
  END IF;
END $$;

COMMIT;
