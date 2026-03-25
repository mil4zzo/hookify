-- Fix "Multiple Permissive Policies" warning.
-- Each table had two permissive policies for SELECT:
--   *_select_own  (FOR SELECT)
--   *_modify_own  (FOR ALL  ← already includes SELECT)
-- Postgres ORs all permissive policies per action, so both ran on every SELECT.
-- Fix: drop the redundant *_select_own policies. FOR ALL covers everything.

DROP POLICY IF EXISTS packs_select_own              ON public.packs;
DROP POLICY IF EXISTS ads_select_own                ON public.ads;
DROP POLICY IF EXISTS ad_metrics_select_own         ON public.ad_metrics;
DROP POLICY IF EXISTS profiles_select_own           ON public.profiles;
DROP POLICY IF EXISTS ad_accounts_select_own        ON public.ad_accounts;
DROP POLICY IF EXISTS user_preferences_select_own   ON public.user_preferences;
DROP POLICY IF EXISTS jobs_select_own               ON public.jobs;
DROP POLICY IF EXISTS ad_transcriptions_select_own  ON public.ad_transcriptions;
DROP POLICY IF EXISTS facebook_connections_select_own ON public.facebook_connections;
DROP POLICY IF EXISTS google_accounts_select_own    ON public.google_accounts;
DROP POLICY IF EXISTS ad_sheet_integrations_select_own ON public.ad_sheet_integrations;
DROP POLICY IF EXISTS ad_metric_pack_map_select_own ON public.ad_metric_pack_map;
