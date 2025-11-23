-- Supabase schema for Hookify (packs, ads, ad_metrics, profiles, ad_accounts, user_preferences, jobs)
-- Run this in Supabase SQL Editor. Enable RLS policies after creation.

-- ============ TABLES ============

create table if not exists public.packs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  adaccount_id text,
  name text not null,
  date_start date not null,
  date_stop date not null,
  level text not null check (level in ('campaign','adset','ad')),
  filters jsonb not null default '[]'::jsonb,
  stats jsonb,
  auto_refresh boolean not null default false,
  last_refreshed_at date,
  refresh_status text default 'idle' check (refresh_status in ('idle', 'queued', 'running', 'cancel_requested', 'canceled', 'success', 'failed')),
  last_prompted_at date,
  refresh_lock_until timestamp,
  refresh_progress_json jsonb,
  sheet_integration_id uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.ads (
  ad_id text primary key,
  user_id uuid not null,
  account_id text,
  campaign_id text,
  campaign_name text,
  adset_id text,
  adset_name text,
  ad_name text,
  effective_status text,
  creative jsonb,
  creative_video_id text,
  thumbnail_url text,
  instagram_permalink_url text,
  adcreatives_videos_ids jsonb,
  adcreatives_videos_thumbs jsonb,
  leadscore numeric,
  cpr_max numeric,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.ad_metrics (
  id text primary key,  -- ID composto gerado no backend: {date}-{ad_id} (ex: "2024-01-15-123456789")
  user_id uuid not null,
  ad_id text not null,
  account_id text,
  campaign_id text,
  campaign_name text,
  adset_id text,
  adset_name text,
  ad_name text,
  date date not null,
  clicks integer,
  impressions integer,
  inline_link_clicks integer,
  reach integer,
  video_total_plays integer,
  video_total_thruplays integer,
  video_watched_p50 integer,
  spend numeric,
  cpm numeric,
  ctr numeric,
  frequency numeric,
  website_ctr numeric,
  actions jsonb,
  conversions jsonb,
  cost_per_conversion jsonb,
  video_play_curve_actions jsonb,
  hold_rate numeric,
  connect_rate numeric,
  profile_ctr numeric,
   -- enrichment via Google Sheets
  leadscore numeric,
  cpr_max numeric,
  raw_data jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.ad_sheet_integrations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  -- Integração pode ser global (pack_id NULL) ou específica de um pack
  pack_id uuid,
  spreadsheet_id text not null,
  worksheet_title text not null,
  match_strategy text not null default 'AD_ID',
  ad_id_column text not null,
  date_column text not null,
  -- Formato de data configurado pelo usuário (DD/MM/YYYY ou MM/DD/YYYY)
  date_format text,
  leadscore_column text,
  cpr_max_column text,
  last_synced_at timestamptz,
  last_sync_status text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.profiles (
  user_id uuid primary key,
  fb_user_id text,
  name text,
  email text,
  picture_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.ad_accounts (
  id text primary key,
  user_id uuid not null,
  name text,
  account_status integer,
  user_tasks text[],
  business_id text,
  business_name text,
  instagram_accounts jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.user_preferences (
  user_id uuid primary key,
  locale text,
  timezone text,
  currency text,
  theme text,
  default_adaccount_id text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.jobs (
  id text primary key,
  user_id uuid not null,
  status text not null check (status in ('pending','running','completed','failed','error')),
  progress int default 0,
  message text,
  payload jsonb,
  result_count int,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============ INDEXES ============

create index if not exists packs_user_idx on public.packs(user_id);
create index if not exists packs_user_created_idx on public.packs(user_id, created_at desc);
create index if not exists packs_user_adaccount_idx on public.packs(user_id, adaccount_id);
create index if not exists packs_refresh_lock_idx on public.packs(auto_refresh, refresh_status, refresh_lock_until) where refresh_lock_until is not null;
create index if not exists packs_refresh_status_date_idx on public.packs(refresh_status, last_refreshed_at);

create index if not exists ads_user_idx on public.ads(user_id);
create index if not exists ads_account_idx on public.ads(account_id);
create index if not exists ads_campaign_idx on public.ads(campaign_id);
create index if not exists ads_video_idx on public.ads(creative_video_id);
create index if not exists ads_videos_ids_idx on public.ads using gin(adcreatives_videos_ids) where adcreatives_videos_ids is not null;

-- Constraint única (ad_id, date) mantida como backup para integridade referencial
-- O id composto já garante unicidade, mas este índice ajuda em queries por ad_id ou date
create unique index if not exists ad_metrics_unique_day on public.ad_metrics(ad_id, date);
create index if not exists ad_metrics_user_date_idx on public.ad_metrics(user_id, date);
create index if not exists ad_metrics_user_campaign_date_idx on public.ad_metrics(user_id, campaign_id, date);
create index if not exists ad_metrics_user_ad_date_idx on public.ad_metrics(user_id, ad_id, date);

-- Índices para ranking por ad_name e join rápido com ads
create index if not exists ad_metrics_user_name_date_ad_idx on public.ad_metrics(user_id, ad_name, date, ad_id);
create index if not exists ads_user_adid_idx on public.ads(user_id, ad_id);

create index if not exists profiles_email_idx on public.profiles(email);

create index if not exists ad_accounts_user_idx on public.ad_accounts(user_id);

create index if not exists jobs_user_idx on public.jobs(user_id);

-- ============ RLS ============

alter table public.packs enable row level security;
alter table public.ads enable row level security;
alter table public.ad_metrics enable row level security;
alter table public.profiles enable row level security;
alter table public.ad_accounts enable row level security;
alter table public.user_preferences enable row level security;
alter table public.jobs enable row level security;

-- Policies (simplificadas; ajuste conforme necessidade)
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'packs' and policyname = 'packs_select_own') then
    create policy packs_select_own on public.packs for select using (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'packs' and policyname = 'packs_modify_own') then
    create policy packs_modify_own on public.packs for all using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ads' and policyname = 'ads_select_own') then
    create policy ads_select_own on public.ads for select using (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ads' and policyname = 'ads_modify_own') then
    create policy ads_modify_own on public.ads for all using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ad_metrics' and policyname = 'ad_metrics_select_own') then
    create policy ad_metrics_select_own on public.ad_metrics for select using (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ad_metrics' and policyname = 'ad_metrics_modify_own') then
    create policy ad_metrics_modify_own on public.ad_metrics for all using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_select_own') then
    create policy profiles_select_own on public.profiles for select using (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_modify_own') then
    create policy profiles_modify_own on public.profiles for all using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ad_accounts' and policyname = 'ad_accounts_select_own') then
    create policy ad_accounts_select_own on public.ad_accounts for select using (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ad_accounts' and policyname = 'ad_accounts_modify_own') then
    create policy ad_accounts_modify_own on public.ad_accounts for all using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_preferences' and policyname = 'user_preferences_select_own') then
    create policy user_preferences_select_own on public.user_preferences for select using (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_preferences' and policyname = 'user_preferences_modify_own') then
    create policy user_preferences_modify_own on public.user_preferences for all using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'jobs' and policyname = 'jobs_select_own') then
    create policy jobs_select_own on public.jobs for select using (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'jobs' and policyname = 'jobs_modify_own') then
    create policy jobs_modify_own on public.jobs for all using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
end $$;


