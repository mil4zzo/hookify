-- Fluxo campaign-bulk (campaign_bulk_service) usa creating_campaign e creating_adsets;
-- a constraint original em 052 só tinha creating_creative / creating_ad.
alter table public.bulk_ad_items
  drop constraint if exists bulk_ad_items_status_check;

alter table public.bulk_ad_items
  add constraint bulk_ad_items_status_check
  check (status in (
    'pending',
    'uploading_media',
    'creating_creative',
    'creating_campaign',
    'creating_adsets',
    'creating_ad',
    'success',
    'error',
    'skipped'
  ));
