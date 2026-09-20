-- Rollback da 171. O caminho normal: o wrapper volta para a v145 (série) e
-- `ANALYTICS_ENTITY_RPC=fetch_entity_performance_v158` no backend (detalhe).
BEGIN;
CREATE OR REPLACE FUNCTION public.fetch_manager_rankings_series_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text DEFAULT 'ad_name'::text, p_pack_ids uuid[] DEFAULT NULL::uuid[], p_account_ids text[] DEFAULT NULL::text[], p_campaign_name_contains text DEFAULT NULL::text, p_adset_name_contains text DEFAULT NULL::text, p_ad_name_contains text DEFAULT NULL::text, p_action_type text DEFAULT NULL::text, p_group_keys text[] DEFAULT NULL::text[], p_window integer DEFAULT 5)
 RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' SET plan_cache_mode TO 'force_custom_plan'
AS $function$
  select public.fetch_manager_performance_series_v145(
    p_user_id, p_date_start, p_date_stop, p_group_by, p_pack_ids, p_account_ids,
    p_campaign_name_contains, p_adset_name_contains, p_ad_name_contains, p_action_type,
    p_group_keys, p_window
  )
$function$;
DROP FUNCTION IF EXISTS public.fetch_manager_performance_series_v171(uuid, date, date, text, uuid[], text[], text, text, text, text, text[], integer);
DROP FUNCTION IF EXISTS public.fetch_entity_performance_v171(uuid, date, date, text, text, uuid[], text, boolean, integer, boolean);
COMMIT;
