-- Add pack_ids arrays to ads and ad_metrics, and ad_ids to packs
-- Also add GIN indexes for efficient membership queries

-- ads.pack_ids
alter table if exists public.ads
  add column if not exists pack_ids uuid[] default '{}';

create index if not exists ads_pack_ids_gin on public.ads using gin (pack_ids);

-- ad_metrics.pack_ids
alter table if exists public.ad_metrics
  add column if not exists pack_ids uuid[] default '{}';

create index if not exists ad_metrics_pack_ids_gin on public.ad_metrics using gin (pack_ids);

-- packs.ad_ids
alter table if exists public.packs
  add column if not exists ad_ids text[] default '{}';


