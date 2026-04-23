-- Migration 063: track outgoing Meta Graph API calls per user/route
-- Registers every call made via services/meta_usage_logger.py so users can
-- diagnose which flows burn their Meta quota.

CREATE TABLE IF NOT EXISTS public.meta_api_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),

  -- Who/where triggered the call
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  route text,
  service_name text,
  ad_account_id text,

  -- Which Meta endpoint was hit
  meta_endpoint text,
  http_method text,
  http_status integer,
  response_ms integer,

  -- Cost signals from X-App-Usage (percent of quota, 0-100)
  call_count_pct numeric,
  cputime_pct numeric,
  total_time_pct numeric,

  -- Raw breakdowns kept flexible
  business_use_case_usage jsonb,
  ad_account_usage jsonb
);

CREATE INDEX IF NOT EXISTS meta_api_usage_user_created_idx
  ON public.meta_api_usage (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS meta_api_usage_created_idx
  ON public.meta_api_usage (created_at DESC);

CREATE INDEX IF NOT EXISTS meta_api_usage_route_created_idx
  ON public.meta_api_usage (user_id, route, created_at DESC);

ALTER TABLE public.meta_api_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "meta_usage_read_own" ON public.meta_api_usage;
CREATE POLICY "meta_usage_read_own"
  ON public.meta_api_usage FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

COMMENT ON TABLE public.meta_api_usage IS
  'One row per outgoing Meta Graph API call. Populated by services/meta_usage_logger.py.';
