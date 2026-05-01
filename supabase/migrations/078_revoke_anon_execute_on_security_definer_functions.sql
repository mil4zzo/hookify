-- All SECURITY DEFINER functions in public schema are callable by `anon` by default
-- because Supabase grants EXECUTE to anon on creation. These functions require an
-- authenticated user; revoke anon access so unauthenticated requests are rejected
-- before execution. `authenticated` role keeps EXECUTE.
--
-- Most critical: get_admin_users_list() was reachable at /rest/v1/rpc/get_admin_users_list
-- without any JWT, exposing admin user emails.

REVOKE EXECUTE ON FUNCTION public.batch_add_pack_id_to_arrays(uuid, uuid, text, text[])
  FROM anon;

REVOKE EXECUTE ON FUNCTION public.batch_remove_pack_id_from_arrays(uuid, uuid, text, text[])
  FROM anon;

REVOKE EXECUTE ON FUNCTION public.batch_update_ad_metrics_enrichment(uuid, jsonb, uuid)
  FROM anon;

REVOKE EXECUTE ON FUNCTION public.claim_job_processing(text, uuid, text, integer)
  FROM anon;

REVOKE EXECUTE ON FUNCTION public.diagnose_manager_rpc_timing(uuid, date, date, text, uuid[])
  FROM anon;

REVOKE EXECUTE ON FUNCTION public.fetch_ad_metrics_for_analytics(uuid, date, date, uuid[], text[])
  FROM anon;

REVOKE EXECUTE ON FUNCTION public.fetch_manager_analytics_aggregated(uuid, date, date, text, uuid[], text[], text, text, text, boolean, boolean, integer, integer, text)
  FROM anon;

REVOKE EXECUTE ON FUNCTION public.fetch_manager_analytics_aggregated_base_v047(uuid, date, date, text, uuid[], text[], text, text, text, boolean, boolean, integer, integer, text)
  FROM anon;

REVOKE EXECUTE ON FUNCTION public.fetch_manager_analytics_aggregated_base_v048(uuid, date, date, text, uuid[], text[], text, text, text, boolean, boolean, integer, integer, text)
  FROM anon;

REVOKE EXECUTE ON FUNCTION public.fetch_manager_analytics_aggregated_base_v049(uuid, date, date, text, uuid[], text[], text, text, text, boolean, boolean, integer, integer, text)
  FROM anon;

-- Two overloads: 15-param (sql) and 16-param with p_campaign_id (plpgsql)
REVOKE EXECUTE ON FUNCTION public.fetch_manager_rankings_core_v2(uuid, date, date, text, uuid[], text[], text, text, text, text, boolean, boolean, integer, integer, text)
  FROM anon;

REVOKE EXECUTE ON FUNCTION public.fetch_manager_rankings_core_v2(uuid, date, date, text, uuid[], text[], text, text, text, text, boolean, boolean, integer, integer, text, text)
  FROM anon;

REVOKE EXECUTE ON FUNCTION public.fetch_manager_rankings_core_v2_base_v059(uuid, date, date, text, uuid[], text[], text, text, text, text, boolean, boolean, integer, integer, text)
  FROM anon;

REVOKE EXECUTE ON FUNCTION public.fetch_manager_rankings_core_v2_base_v060(uuid, date, date, text, uuid[], text[], text, text, text, text, boolean, boolean, integer, integer, text)
  FROM anon;

REVOKE EXECUTE ON FUNCTION public.fetch_manager_rankings_core_v2_base_v066(uuid, date, date, text, uuid[], text[], text, text, text, text, boolean, boolean, integer, integer, text)
  FROM anon;

REVOKE EXECUTE ON FUNCTION public.fetch_manager_rankings_core_v2_base_v067(uuid, date, date, text, uuid[], text[], text, text, text, text, boolean, boolean, integer, integer, text, text)
  FROM anon;

REVOKE EXECUTE ON FUNCTION public.fetch_manager_rankings_retention_v2(uuid, date, date, text, uuid[], text[], text, text, text, text)
  FROM anon;

REVOKE EXECUTE ON FUNCTION public.fetch_manager_rankings_series_v2(uuid, date, date, text, uuid[], text[], text, text, text, text, text[], integer)
  FROM anon;

REVOKE EXECUTE ON FUNCTION public.get_admin_users_list()
  FROM anon;

REVOKE EXECUTE ON FUNCTION public.handle_new_user_subscription()
  FROM anon;

REVOKE EXECUTE ON FUNCTION public.release_job_processing_lease(text, uuid, text)
  FROM anon;

REVOKE EXECUTE ON FUNCTION public.renew_job_processing_lease(text, uuid, text, integer)
  FROM anon;

REVOKE EXECUTE ON FUNCTION public.set_subscriptions_updated_at()
  FROM anon;
