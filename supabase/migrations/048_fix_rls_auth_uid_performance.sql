-- Fix RLS performance: replace auth.uid() with (select auth.uid()) in all policies.
-- This prevents Postgres from re-evaluating auth.uid() for every row scanned.
-- See: https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select

-- packs
DROP POLICY IF EXISTS packs_select_own ON public.packs;
DROP POLICY IF EXISTS packs_modify_own ON public.packs;
CREATE POLICY packs_select_own ON public.packs
  FOR SELECT USING (user_id = (SELECT auth.uid()));
CREATE POLICY packs_modify_own ON public.packs
  FOR ALL USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));

-- ads
DROP POLICY IF EXISTS ads_select_own ON public.ads;
DROP POLICY IF EXISTS ads_modify_own ON public.ads;
CREATE POLICY ads_select_own ON public.ads
  FOR SELECT USING (user_id = (SELECT auth.uid()));
CREATE POLICY ads_modify_own ON public.ads
  FOR ALL USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));

-- ad_metrics
DROP POLICY IF EXISTS ad_metrics_select_own ON public.ad_metrics;
DROP POLICY IF EXISTS ad_metrics_modify_own ON public.ad_metrics;
CREATE POLICY ad_metrics_select_own ON public.ad_metrics
  FOR SELECT USING (user_id = (SELECT auth.uid()));
CREATE POLICY ad_metrics_modify_own ON public.ad_metrics
  FOR ALL USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));

-- profiles
DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
DROP POLICY IF EXISTS profiles_modify_own ON public.profiles;
CREATE POLICY profiles_select_own ON public.profiles
  FOR SELECT USING (user_id = (SELECT auth.uid()));
CREATE POLICY profiles_modify_own ON public.profiles
  FOR ALL USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));

-- ad_accounts
DROP POLICY IF EXISTS ad_accounts_select_own ON public.ad_accounts;
DROP POLICY IF EXISTS ad_accounts_modify_own ON public.ad_accounts;
CREATE POLICY ad_accounts_select_own ON public.ad_accounts
  FOR SELECT USING (user_id = (SELECT auth.uid()));
CREATE POLICY ad_accounts_modify_own ON public.ad_accounts
  FOR ALL USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));

-- user_preferences
DROP POLICY IF EXISTS user_preferences_select_own ON public.user_preferences;
DROP POLICY IF EXISTS user_preferences_modify_own ON public.user_preferences;
CREATE POLICY user_preferences_select_own ON public.user_preferences
  FOR SELECT USING (user_id = (SELECT auth.uid()));
CREATE POLICY user_preferences_modify_own ON public.user_preferences
  FOR ALL USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));

-- jobs
DROP POLICY IF EXISTS jobs_select_own ON public.jobs;
DROP POLICY IF EXISTS jobs_modify_own ON public.jobs;
CREATE POLICY jobs_select_own ON public.jobs
  FOR SELECT USING (user_id = (SELECT auth.uid()));
CREATE POLICY jobs_modify_own ON public.jobs
  FOR ALL USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));

-- ad_transcriptions
DROP POLICY IF EXISTS ad_transcriptions_select_own ON public.ad_transcriptions;
DROP POLICY IF EXISTS ad_transcriptions_modify_own ON public.ad_transcriptions;
CREATE POLICY ad_transcriptions_select_own ON public.ad_transcriptions
  FOR SELECT USING (user_id = (SELECT auth.uid()));
CREATE POLICY ad_transcriptions_modify_own ON public.ad_transcriptions
  FOR ALL USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));

-- facebook_connections
DROP POLICY IF EXISTS facebook_connections_select_own ON public.facebook_connections;
DROP POLICY IF EXISTS facebook_connections_modify_own ON public.facebook_connections;
CREATE POLICY facebook_connections_select_own ON public.facebook_connections
  FOR SELECT USING (user_id = (SELECT auth.uid()));
CREATE POLICY facebook_connections_modify_own ON public.facebook_connections
  FOR ALL USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));

-- google_accounts
DROP POLICY IF EXISTS google_accounts_select_own ON public.google_accounts;
DROP POLICY IF EXISTS google_accounts_modify_own ON public.google_accounts;
CREATE POLICY google_accounts_select_own ON public.google_accounts
  FOR SELECT USING (user_id = (SELECT auth.uid()));
CREATE POLICY google_accounts_modify_own ON public.google_accounts
  FOR ALL USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));

-- ad_sheet_integrations
DROP POLICY IF EXISTS ad_sheet_integrations_select_own ON public.ad_sheet_integrations;
DROP POLICY IF EXISTS ad_sheet_integrations_modify_own ON public.ad_sheet_integrations;
CREATE POLICY ad_sheet_integrations_select_own ON public.ad_sheet_integrations
  FOR SELECT USING (owner_id = (SELECT auth.uid()));
CREATE POLICY ad_sheet_integrations_modify_own ON public.ad_sheet_integrations
  FOR ALL USING (owner_id = (SELECT auth.uid())) WITH CHECK (owner_id = (SELECT auth.uid()));
