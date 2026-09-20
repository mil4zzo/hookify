-- Rollback da 172. O caminho normal é o env
-- `ANALYTICS_RETENTION_RPC=fetch_manager_rankings_retention_v2` (sem deploy).
BEGIN;
DROP FUNCTION IF EXISTS public.fetch_manager_rankings_retention_v172(uuid, date, date, text, uuid[], text[], text, text, text, text);
COMMIT;
