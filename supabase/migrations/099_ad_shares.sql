-- Migration: ad_shares — links públicos de compartilhamento de criativos (stories).
--
-- Contexto: gestor seleciona criativos na aba Criativos do Manager e gera um link
-- público /s/{token} que exibe os anúncios em formato stories com métricas.
--
-- Decisões de segurança (deliberadas):
-- 1. O snapshot é AUTOCONTIDO (items jsonb): métricas congeladas na criação +
--    URLs de mídia resolvidas na hora (thumbnail do Storage é permanente; vídeo
--    da CDN da Meta é perecível e o expiry viaja junto no snapshot). O read-path
--    público lê SOMENTE esta tabela — nunca faz join em ads/ad_metrics.
-- 2. NENHUMA policy para anon: o acesso público passa exclusivamente pelo
--    backend (GET /shares/{token} com service role, filtrado por token). A
--    tabela só é legível diretamente pelo próprio dono (RLS owner).
-- 3. token é gerado no backend com secrets.token_urlsafe (não-adivinhável);
--    unique index é a defesa contra colisão (retry na criação).
--
-- Safe to run multiple times.

create table if not exists public.ad_shares (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  token text not null,
  date_start date not null,
  date_stop date not null,
  currency text,
  items jsonb not null default '[]'::jsonb,
  view_count integer not null default 0,
  created_at timestamp with time zone not null default now(),
  expires_at timestamp with time zone,
  revoked_at timestamp with time zone
);

comment on table public.ad_shares is 'Links públicos de compartilhamento de criativos (formato stories, /s/{token}). Snapshot autocontido: o read-path público (backend, service role) lê só esta tabela. Sem policy anon — acesso anônimo é intermediado pelo backend.';
comment on column public.ad_shares.token is 'Token não-adivinhável do link público (secrets.token_urlsafe no backend). Unique.';
comment on column public.ad_shares.currency is 'Moeda das métricas monetárias do snapshot (ex.: BRL). Congelada na criação — a conta pode mudar depois, o share não.';
comment on column public.ad_shares.items is 'Array de slides: {ad_name, media: {type, thumbnail_url, video_url, video_expires_at, image_url}, metrics: {...}}. video_url expira (oe= da CDN da Meta) — o viewer compara video_expires_at com o relógio e degrada para aviso, por design.';
comment on column public.ad_shares.expires_at is 'Expiração do LINK inteiro (default: criação + 30 dias, gravado pelo backend). NULL = sem expiração (não usado no MVP). Independente da expiração do vídeo de cada slide.';
comment on column public.ad_shares.revoked_at is 'Revogação manual pelo dono (DELETE /shares/{id} faz UPDATE aqui, preservando view_count para histórico). NULL = ativo.';
comment on column public.ad_shares.view_count is 'Contador best-effort de aberturas do link público (incremento não-atômico; precisão aproximada é suficiente).';

create unique index if not exists ad_shares_token_key on public.ad_shares (token);
create index if not exists ad_shares_user_created_idx on public.ad_shares (user_id, created_at desc);

alter table public.ad_shares enable row level security;

drop policy if exists ad_shares_modify_own on public.ad_shares;
create policy ad_shares_modify_own on public.ad_shares
  using ((user_id = ( select auth.uid() as uid)))
  with check ((user_id = ( select auth.uid() as uid)));

grant all on table public.ad_shares to authenticated;
grant all on table public.ad_shares to service_role;
