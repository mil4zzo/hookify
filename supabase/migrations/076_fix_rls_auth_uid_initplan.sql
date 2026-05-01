-- Fix auth_rls_initplan warnings: wrap auth.uid() in (select auth.uid()) so
-- PostgreSQL evaluates it once per statement instead of once per row.

-- bulk_ad_items
DROP POLICY IF EXISTS "Users read own bulk_ad_items" ON public.bulk_ad_items;
DROP POLICY IF EXISTS "Users insert own bulk_ad_items" ON public.bulk_ad_items;
DROP POLICY IF EXISTS "Users update own bulk_ad_items" ON public.bulk_ad_items;

CREATE POLICY "Users read own bulk_ad_items"
  ON public.bulk_ad_items FOR SELECT
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY "Users insert own bulk_ad_items"
  ON public.bulk_ad_items FOR INSERT
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Users update own bulk_ad_items"
  ON public.bulk_ad_items FOR UPDATE
  USING (user_id = (SELECT auth.uid()));

-- meta_api_usage
DROP POLICY IF EXISTS meta_usage_read_own ON public.meta_api_usage;

CREATE POLICY meta_usage_read_own
  ON public.meta_api_usage FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- subscriptions
DROP POLICY IF EXISTS subscriptions_select_own ON public.subscriptions;

CREATE POLICY subscriptions_select_own
  ON public.subscriptions FOR SELECT
  USING (user_id = (SELECT auth.uid()));
