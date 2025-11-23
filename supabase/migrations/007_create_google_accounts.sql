-- Migration: Create google_accounts table for storing per-user Google OAuth tokens
-- Safe to run multiple times (guards on existence)

create table if not exists public.google_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Tokens serão armazenados criptografados pela aplicação
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  scopes text[],
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint google_accounts_user_unique unique (user_id)
);

create index if not exists google_accounts_user_idx
  on public.google_accounts(user_id);

-- Reutilizar função genérica de updated_at se já existir (ver 001_create_facebook_connections.sql)
do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'trg_google_accounts_set_updated_at'
  ) then
    create trigger trg_google_accounts_set_updated_at
      before update on public.google_accounts
      for each row execute function public.set_updated_at();
  end if;
end $$;

-- Enable RLS
alter table public.google_accounts enable row level security;

-- Policies (próximas ao modelo de facebook_connections)
do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'google_accounts' and policyname = 'google_accounts_select_own'
  ) then
    create policy google_accounts_select_own on public.google_accounts
      for select using (user_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'google_accounts' and policyname = 'google_accounts_modify_own'
  ) then
    create policy google_accounts_modify_own on public.google_accounts
      for all using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
end $$;


