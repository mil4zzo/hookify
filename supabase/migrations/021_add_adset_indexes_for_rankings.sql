-- Add indexes to speed up adset-based aggregations in analytics endpoints
-- Safe to run multiple times

create index if not exists ad_metrics_user_adset_date_idx
  on public.ad_metrics(user_id, adset_id, date);

create index if not exists ads_user_adset_idx
  on public.ads(user_id, adset_id);



