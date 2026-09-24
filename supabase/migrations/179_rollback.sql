-- Rollback da 179. Apaga o cadastro da economia do lead de todos os packs junto
-- com a coluna. O backend anterior não lê nem escreve lead_economics; o atual,
-- sem a coluna, falha só ao GRAVAR o cadastro (PATCH /packs/{id}/judgment com a
-- chave) — a leitura por select("*") apenas deixa de trazê-la.
BEGIN;
ALTER TABLE public.packs DROP CONSTRAINT IF EXISTS packs_lead_economics_check;
ALTER TABLE public.packs DROP COLUMN IF EXISTS lead_economics;
COMMIT;
