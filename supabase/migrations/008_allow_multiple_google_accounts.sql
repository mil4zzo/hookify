-- Migration: Allow multiple Google accounts per user
-- Remove unique constraint on user_id and add google_user_id/email fields

-- Remover constraint unique em user_id se existir
alter table public.google_accounts
  drop constraint if exists google_accounts_user_unique;

-- Adicionar colunas google_user_id, google_email, google_name se não existirem
alter table public.google_accounts
  add column if not exists google_user_id text,
  add column if not exists google_email text,
  add column if not exists google_name text,
  add column if not exists is_primary boolean default true;

-- Criar constraint única para (user_id, google_user_id) se não existir
-- Usar índice parcial para permitir múltiplos NULLs
do $$
begin
  if not exists (
    select 1 from pg_constraint 
    where conname = 'google_accounts_user_google_unique'
  ) then
    -- Criar índice único parcial (permite múltiplos NULLs)
    create unique index if not exists google_accounts_user_google_unique_idx
      on public.google_accounts(user_id, google_user_id)
      where google_user_id is not null;
  end if;
end $$;

-- Criar índice para google_user_id se não existir
create index if not exists google_accounts_googleuser_idx 
  on public.google_accounts(google_user_id);

