-- Migration: Create facebook_connections table with RLS and updated_at trigger
-- Safe to run multiple times (guards on existence)

-- Enable required extension (optional if using pgcrypto later)
create extension if not exists pgcrypto;

-- Table
create table if not exists public.facebook_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  facebook_user_id text not null,
  facebook_name text,
  facebook_email text,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  scopes text[],
  is_primary boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint facebook_connections_user_fb_unique unique (user_id, facebook_user_id)
);

-- Indexes
create index if not exists facebook_connections_user_idx on public.facebook_connections(user_id);
create index if not exists facebook_connections_fbuser_idx on public.facebook_connections(facebook_user_id);

-- Trigger function to update updated_at
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Attach trigger
do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'trg_facebook_connections_set_updated_at'
  ) then
    create trigger trg_facebook_connections_set_updated_at
      before update on public.facebook_connections
      for each row execute function public.set_updated_at();
  end if;
end $$;

-- Enable RLS
alter table public.facebook_connections enable row level security;

-- Policies
do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'facebook_connections' and policyname = 'facebook_connections_select_own'
  ) then
    create policy facebook_connections_select_own on public.facebook_connections
      for select using (user_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'facebook_connections' and policyname = 'facebook_connections_modify_own'
  ) then
    create policy facebook_connections_modify_own on public.facebook_connections
      for all using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
end $$;


