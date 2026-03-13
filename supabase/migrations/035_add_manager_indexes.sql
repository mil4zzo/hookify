-- Migration 035
-- Objetivo: garantir índices críticos usados pelas 4 abas do Manager.
-- Estes índices já podem existir em alguns ambientes; IF NOT EXISTS mantém a migration idempotente.

create index if not exists ad_metrics_user_adset_date_idx
  on public.ad_metrics using btree (user_id, adset_id, date);

create index if not exists ads_user_adset_idx
  on public.ads using btree (user_id, adset_id);

