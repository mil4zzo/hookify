-- Migration: Add facebook_picture_url column to facebook_connections table
-- Safe to run multiple times (guards on existence)

-- Add column if it doesn't exist
do $$
begin
  if not exists (
    select 1 from information_schema.columns 
    where table_schema = 'public' 
    and table_name = 'facebook_connections' 
    and column_name = 'facebook_picture_url'
  ) then
    alter table public.facebook_connections
    add column facebook_picture_url text;
    
    comment on column public.facebook_connections.facebook_picture_url is 'URL da imagem de perfil do Facebook';
  end if;
end $$;

