-- Migration: Add refresh-related columns to packs table for on-demand refresh
-- Safe to run multiple times (guards on existence)

-- Add auto_refresh column if it doesn't exist
do $$
begin
  if not exists (
    select 1 from information_schema.columns 
    where table_schema = 'public' 
    and table_name = 'packs' 
    and column_name = 'auto_refresh'
  ) then
    alter table public.packs 
    add column auto_refresh boolean not null default false;
  end if;
end $$;

-- Add last_refreshed_at column if it doesn't exist
do $$
begin
  if not exists (
    select 1 from information_schema.columns 
    where table_schema = 'public' 
    and table_name = 'packs' 
    and column_name = 'last_refreshed_at'
  ) then
    alter table public.packs 
    add column last_refreshed_at date;
  end if;
end $$;

-- Add refresh_status column if it doesn't exist
do $$
begin
  if not exists (
    select 1 from information_schema.columns 
    where table_schema = 'public' 
    and table_name = 'packs' 
    and column_name = 'refresh_status'
  ) then
    alter table public.packs 
    add column refresh_status text default 'idle' 
    check (refresh_status in ('idle', 'queued', 'running', 'cancel_requested', 'canceled', 'success', 'failed'));
  end if;
end $$;

-- Add last_prompted_at column if it doesn't exist
do $$
begin
  if not exists (
    select 1 from information_schema.columns 
    where table_schema = 'public' 
    and table_name = 'packs' 
    and column_name = 'last_prompted_at'
  ) then
    alter table public.packs 
    add column last_prompted_at date;
  end if;
end $$;

-- Add refresh_lock_until column if it doesn't exist (timestamp without timezone for lock only)
do $$
begin
  if not exists (
    select 1 from information_schema.columns 
    where table_schema = 'public' 
    and table_name = 'packs' 
    and column_name = 'refresh_lock_until'
  ) then
    alter table public.packs 
    add column refresh_lock_until timestamp;
  end if;
end $$;

-- Add refresh_progress_json column if it doesn't exist
do $$
begin
  if not exists (
    select 1 from information_schema.columns 
    where table_schema = 'public' 
    and table_name = 'packs' 
    and column_name = 'refresh_progress_json'
  ) then
    alter table public.packs 
    add column refresh_progress_json jsonb;
  end if;
end $$;

-- Set default refresh_status to 'idle' for existing rows
update public.packs 
set refresh_status = 'idle' 
where refresh_status is null;

-- Initialize last_refreshed_at with current date for existing packs (first load scenario)
update public.packs 
set last_refreshed_at = current_date 
where last_refreshed_at is null;

-- Create indexes for refresh queries

-- Index for (auto_refresh, refresh_status, refresh_lock_until)
create index if not exists packs_refresh_lock_idx 
on public.packs(auto_refresh, refresh_status, refresh_lock_until)
where refresh_lock_until is not null;

-- Index for (refresh_status, last_refreshed_at)
create index if not exists packs_refresh_status_date_idx 
on public.packs(refresh_status, last_refreshed_at);

