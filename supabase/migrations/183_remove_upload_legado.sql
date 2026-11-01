-- 183 — Remove os restos do upload legado (tela antiga de "Upload em massa").
--
-- O backend que escrevia aqui (/facebook/bulk-ads*, /facebook/campaign-bulk*) foi
-- removido em 2026-11-01; a duplicação nova usa campaign_launch_items (182).
-- Sem dado a preservar (decisão do idealizador em 2026-11-01): 18 linhas de teste.
--
-- Aplicar DEPOIS do deploy do backend sem as rotas legadas (o antigo ainda escreveria aqui).

BEGIN;

-- Jobs dos fluxos legados: só histórico de progresso, ninguém lê.
DELETE FROM public.jobs
 WHERE payload->>'type' IN ('bulk_ads', 'bulk_ads_retry', 'campaign_bulk', 'campaign_bulk_retry');

DROP TABLE IF EXISTS public.bulk_ad_items;

COMMIT;
