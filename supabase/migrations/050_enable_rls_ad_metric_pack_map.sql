-- Security fix: enable RLS on ad_metric_pack_map.
-- Without RLS, any authenticated user could read all rows via direct PostgREST queries.
-- The table has user_id, so the same pattern as all other tables applies.
-- Note: SECURITY DEFINER RPCs bypass RLS and are unaffected by this change.

ALTER TABLE public.ad_metric_pack_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY ad_metric_pack_map_select_own ON public.ad_metric_pack_map
  FOR SELECT USING (user_id = (SELECT auth.uid()));

CREATE POLICY ad_metric_pack_map_modify_own ON public.ad_metric_pack_map
  FOR ALL USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
