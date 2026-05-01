-- Add missing index on ad_accounts.connection_id (FK used in queries by get_ad_account_connection_id).
CREATE INDEX IF NOT EXISTS ad_accounts_connection_id_idx ON public.ad_accounts (connection_id);

-- Drop indexes confirmed unused by backend code analysis:
-- bulk_ad_items: user_id is never filtered; items are always fetched by job_id
DROP INDEX IF EXISTS public.bulk_ad_items_user_idx;

-- packs: (user_id, ad_account_id) composite never queried together
DROP INDEX IF EXISTS public.packs_user_adaccount_idx;

-- ad_transcriptions: GIN index for ad_ids array containment (@>), but no such queries exist
DROP INDEX IF EXISTS public.ad_transcriptions_ad_ids_gin_idx;

-- ad_sheet_integrations: last_successful_sync_at is only SELECTed, never used in WHERE/ORDER
DROP INDEX IF EXISTS public.ad_sheet_integrations_last_successful_sync_at_idx;
