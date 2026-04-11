alter table public.bulk_ad_items
  add column if not exists bundle_id text,
  add column if not exists bundle_name text,
  add column if not exists slot_files jsonb,
  add column if not exists is_multi_slot boolean not null default false;

create index if not exists bulk_ad_items_bundle_idx on public.bulk_ad_items(job_id, bundle_id);
