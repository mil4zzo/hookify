-- Migration 041
-- Update base ad_metrics RPC to prioritize relational pack map (ad_metric_pack_map)
-- while keeping legacy pack_ids[] fallback during dual-write rollout.

CREATE OR REPLACE FUNCTION public.fetch_ad_metrics_for_analytics(
  p_user_id     uuid,
  p_date_start  date,
  p_date_stop   date,
  p_pack_ids    uuid[] DEFAULT NULL,
  p_account_ids text[] DEFAULT NULL
)
RETURNS SETOF jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT jsonb_build_object(
    'ad_id',                     am.ad_id,
    'ad_name',                   am.ad_name,
    'account_id',                am.account_id,
    'campaign_id',               am.campaign_id,
    'campaign_name',             am.campaign_name,
    'adset_id',                  am.adset_id,
    'adset_name',                am.adset_name,
    'date',                      am.date,
    'clicks',                    am.clicks,
    'impressions',               am.impressions,
    'inline_link_clicks',        am.inline_link_clicks,
    'spend',                     am.spend,
    'video_total_plays',         am.video_total_plays,
    'video_total_thruplays',     am.video_total_thruplays,
    'video_watched_p50',         am.video_watched_p50,
    'conversions',               am.conversions,
    'actions',                   am.actions,
    'video_play_curve_actions',  am.video_play_curve_actions,
    'hook_rate',                 am.hook_rate,
    'scroll_stop_rate',          am.scroll_stop_rate,
    'hold_rate',                 am.hold_rate,
    'reach',                     am.reach,
    'frequency',                 am.frequency,
    'leadscore_values',          am.leadscore_values,
    'lpv',                       am.lpv
  )
  FROM public.ad_metrics am
  WHERE am.user_id = p_user_id
    AND am.date >= p_date_start
    AND am.date <= p_date_stop
    AND (
      p_pack_ids IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.ad_metric_pack_map apm
        WHERE apm.user_id = am.user_id
          AND apm.ad_id = am.ad_id
          AND apm.metric_date = am.date
          AND apm.pack_id = ANY(p_pack_ids)
      )
      OR am.pack_ids && p_pack_ids
    )
    AND (p_account_ids IS NULL OR am.account_id = ANY(p_account_ids));
END;
$$;

GRANT EXECUTE ON FUNCTION public.fetch_ad_metrics_for_analytics(uuid, date, date, uuid[], text[]) TO authenticated;
