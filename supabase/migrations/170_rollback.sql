-- Rollback da 170. ATENÇÃO À ORDEM: reverta a 171 e a 172 ANTES — as funções delas
-- (série, detalhe e curva) leem `media_type` pelo índice que este arquivo derruba, e sem
-- ele a leitura deixa de ser só pelo índice (5.406 páginas viram ~21 mil).
-- As duas instruções de índice ficam FORA da transação e são CONCURRENTLY pelo mesmo
-- motivo da 170: `DROP INDEX` comum segura lock exclusivo e enfileira o app.
--
-- O caminho normal de volta atrás é o env
-- `ANALYTICS_MANAGER_COLUMNS_RPC=fetch_manager_rankings_v162` (sem deploy, sem SQL);
-- este arquivo é para desfazer a migration inteira.
SET lock_timeout = '5s';
CREATE INDEX CONCURRENTLY IF NOT EXISTS ads_user_ad_status_idx
  ON public.ads (user_id, ad_id)
  INCLUDE (effective_status, meta_created_time, thumb_storage_path);
DROP INDEX CONCURRENTLY IF EXISTS public.ads_user_ad_status_mt_idx;
RESET lock_timeout;

BEGIN;
DROP FUNCTION IF EXISTS public.fetch_manager_rankings_v170(uuid, date, date, text, uuid[], text[], text, text, text, text, boolean, boolean, integer, integer, text, text, boolean, text);
COMMIT;
