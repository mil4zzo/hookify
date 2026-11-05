-- Rollback da 184. Antes: voltar o backend para a v170/v171
-- (`ANALYTICS_MANAGER_COLUMNS_RPC` / `ANALYTICS_ENTITY_RPC`), senão a rota chama função apagada.
BEGIN;
DROP FUNCTION IF EXISTS public.fetch_manager_rankings_v184(uuid, date, date, text, uuid[], text[], text, text, text, text, boolean, boolean, integer, integer, text, text, boolean, text, date[]);
DROP FUNCTION IF EXISTS public.fetch_entity_performance_v184(uuid, date, date, text, text, uuid[], text, boolean, integer, boolean, date[]);
COMMIT;
