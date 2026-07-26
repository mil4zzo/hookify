-- Migration: medias e metricas em destaque no snapshot de ad_shares.
--
-- Contexto: a pagina publica /s/{token} passa a colorir as metricas por
-- qualidade (vs. media) e a mostrar delta, exatamente como o modal de
-- detalhamento do Manager. Como o read-path publico NAO toca ad_metrics
-- (snapshot autocontido, ver migration 099), a media precisa viajar dentro
-- do proprio share — congelada junto com as metricas que ela compara.
--
-- highlight_metrics: ate 2 chaves escolhidas na criacao do link; sao as
-- metricas exibidas com o painel apenas "espiado" (sem expandir tudo).
--
-- Safe to run multiple times.

alter table public.ad_shares add column if not exists averages jsonb;
alter table public.ad_shares add column if not exists highlight_metrics jsonb not null default '[]'::jsonb;

comment on column public.ad_shares.averages is 'Medias do conjunto de criativos no momento da criacao (mesmas chaves de items[].metrics). Congeladas junto com as metricas: comparar valor de ontem com media de hoje mentiria. NULL = share criado antes desta migration (viewer degrada para cards neutros, sem cor/delta).';
comment on column public.ad_shares.highlight_metrics is 'Ate 2 chaves de metrica exibidas no painel "espiado" do viewer, sem expandir. [] = nenhuma em destaque (painel so abre no toque).';
