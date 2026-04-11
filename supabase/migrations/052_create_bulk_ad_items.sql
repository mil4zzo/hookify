create table if not exists public.bulk_ad_items (
  id uuid primary key default gen_random_uuid(),
  job_id text not null,
  user_id uuid not null,
  file_name text not null,
  file_index int not null,
  adset_id text not null,
  adset_name text,
  ad_name text not null,
  status text not null default 'pending'
    check (status in ('pending','uploading_media','creating_creative','creating_ad','success','error','skipped')),
  meta_ad_id text,
  meta_creative_id text,
  error_message text,
  error_code text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists bulk_ad_items_job_idx on public.bulk_ad_items(job_id);
create index if not exists bulk_ad_items_user_idx on public.bulk_ad_items(user_id);

alter table public.bulk_ad_items enable row level security;

drop policy if exists "Users read own bulk_ad_items" on public.bulk_ad_items;
create policy "Users read own bulk_ad_items"
  on public.bulk_ad_items
  for select
  using (user_id = auth.uid());

drop policy if exists "Users insert own bulk_ad_items" on public.bulk_ad_items;
create policy "Users insert own bulk_ad_items"
  on public.bulk_ad_items
  for insert
  with check (user_id = auth.uid());

drop policy if exists "Users update own bulk_ad_items" on public.bulk_ad_items;
create policy "Users update own bulk_ad_items"
  on public.bulk_ad_items
  for update
  using (user_id = auth.uid());
