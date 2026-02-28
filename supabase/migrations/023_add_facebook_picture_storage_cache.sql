-- Migration: Cache de imagem de perfil no Supabase Storage (facebook_connections)
-- Data: 2026-02
-- Descrição:
--   Adiciona colunas para referenciar a foto de perfil cacheada no Storage (bucket ad-thumbs, prefixo profile-pics/).

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
    and table_name = 'facebook_connections'
    and column_name = 'picture_storage_path'
  ) then
    alter table public.facebook_connections
    add column picture_storage_path text;
    comment on column public.facebook_connections.picture_storage_path is 'Path do objeto no Supabase Storage (bucket ad-thumbs, profile-pics/).';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
    and table_name = 'facebook_connections'
    and column_name = 'picture_cached_at'
  ) then
    alter table public.facebook_connections
    add column picture_cached_at timestamptz;
    comment on column public.facebook_connections.picture_cached_at is 'Quando a foto de perfil foi cacheada no Storage.';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
    and table_name = 'facebook_connections'
    and column_name = 'picture_source_url'
  ) then
    alter table public.facebook_connections
    add column picture_source_url text;
    comment on column public.facebook_connections.picture_source_url is 'URL original do Meta usada para baixar/cachear a foto.';
  end if;
end $$;
