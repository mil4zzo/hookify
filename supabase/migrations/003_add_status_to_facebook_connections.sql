-- Migration: Add status column to facebook_connections table
-- Safe to run multiple times (guards on existence)

-- Add status column if it doesn't exist
do $$
begin
  if not exists (
    select 1 from information_schema.columns 
    where table_schema = 'public' 
    and table_name = 'facebook_connections' 
    and column_name = 'status'
  ) then
    alter table public.facebook_connections 
    add column status text default 'active' check (status in ('active', 'expired', 'invalid'));
    
    -- Create index for faster queries by status
    create index if not exists facebook_connections_status_idx 
    on public.facebook_connections(user_id, status) 
    where status != 'active'; -- Partial index for non-active connections
  end if;
end $$;

-- Update existing rows to have 'active' status if they don't have one
update public.facebook_connections 
set status = 'active' 
where status is null;

