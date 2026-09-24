-- ===========================================================================
-- 179 — Economia do lead (teto de CPL e margem por anúncio)
--
-- Plano: documentation/plano-economia-do-lead.md (seções 4 e 9).
--
-- Coluna nova packs.lead_economics: o cadastro de produtos e faixas de nota que
-- responde "quanto eu posso pagar por um lead DESTE anúncio?". A conta roda no
-- cliente (como a do CPMQL), sobre o histograma de leadscore que o Manager já
-- recebe — nenhuma RPC muda.
--
-- Formato (documento inteiro, sempre lido e gravado de uma vez):
--   {
--     "products": [ { "id", "name", "ticket", "contribution_margin", "target_margin" } ],
--     "bands":    [ { "min", "product", "conversion" } ]
--   }
--   products: 1 a 10. `id` estável (renomear não desliga faixas); `ticket` > 0;
--             `contribution_margin` ("quanto sobra") em (0, 1]; `target_margin`
--             (margem desejada, SOBRE O FATURAMENTO) em [0, 1) e menor que a sobra.
--   bands:    1 a 10, cortes contíguos. `min` da primeira é null; os demais
--             estritamente crescentes. `product` aponta para products[].id;
--             `conversion` em [0, 1].
--
-- Por que jsonb e não tabela (decisão D8): o cadastro é sempre lido e salvo
-- inteiro, nunca consultado por faixa. Reusa o endpoint de julgamento
-- (PATCH /packs/{id}/judgment), o controle de papel (dono/editor) e a autoria
-- em pack_action_log. Com cortes contíguos, a proteção que o banco daria com
-- uma tabela por faixa é desnecessária.
--
-- Por isso a VALIDAÇÃO VIVE NA APLICAÇÃO (backend/app/services/lead_economics.py,
-- espelho de frontend/lib/utils/leadEconomics.ts, com as mesmas mensagens). O
-- banco só garante a forma mínima: null ou objeto. O endpoint grava o documento
-- CANÔNICO que o validador devolve, nunca o JSON cru do cliente.
--
-- NULL = não configurado: as colunas Teto de CPL e Margem ficam indisponíveis,
-- nunca zero (zero diria "esse lead não vale nada").
--
-- Custo: coluna nula e aditiva (sem reescrita da tabela). O CHECK varre packs
-- uma vez para validar — tabela de poucas linhas, e a coluna nasce toda NULL.
--
-- VOLTA ATRÁS: 179_rollback.sql
--   (o cadastro gravado se perde junto com a coluna; o backend anterior não lê
--   nem escreve lead_economics, então nada mais quebra)
-- ===========================================================================

BEGIN;

ALTER TABLE public.packs
  ADD COLUMN IF NOT EXISTS lead_economics jsonb;

-- Idempotente: reaplicar a migration não duplica nem falha no constraint.
ALTER TABLE public.packs DROP CONSTRAINT IF EXISTS packs_lead_economics_check;
ALTER TABLE public.packs
  ADD CONSTRAINT packs_lead_economics_check
  CHECK (lead_economics IS NULL OR jsonb_typeof(lead_economics) = 'object');

COMMENT ON COLUMN public.packs.lead_economics IS
  'Economia do lead do pack: {"products": [{"id", "name", "ticket", "contribution_margin", '
  '"target_margin"}], "bands": [{"min", "product", "conversion"}]}. ticket = faturamento '
  'bruto por venda; contribution_margin = fracao que sobra da venda antes do anuncio, em '
  '(0,1]; target_margin = margem de lucro desejada sobre o faturamento, em [0,1) e menor '
  'que contribution_margin; bands = cortes contiguos (min da primeira null, demais '
  'estritamente crescentes; nota >= min), product aponta para products[].id, conversion '
  'em [0,1]. NULL = nao configurado (Teto de CPL e Margem indisponiveis, nunca zero). '
  'A validacao do conteudo vive na aplicacao (decisao D8, backend/app/services/'
  'lead_economics.py); o banco so garante null ou objeto (migration 179).';

COMMIT;
