-- Migration: RPC para buscar ad_metrics para analytics sem paginação client-side
-- Motivo: _fetch_all_paginated fazia ~13 roundtrips HTTP com filtros OR de pack_ids
-- que causavam statement_timeout (57014) intermitente no Supabase.
-- Nova abordagem: query única server-side usando operador && (overlap) com índice GIN.

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
    AND (p_pack_ids IS NULL OR am.pack_ids && p_pack_ids)
    AND (p_account_ids IS NULL OR am.account_id = ANY(p_account_ids));
END;
$$;

GRANT EXECUTE ON FUNCTION public.fetch_ad_metrics_for_analytics(uuid, date, date, uuid[], text[]) TO authenticated;
