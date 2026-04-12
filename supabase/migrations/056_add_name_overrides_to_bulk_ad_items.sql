-- Migration 056: adiciona coluna campaign_name em bulk_ad_items.
--
-- campaign_name: nome final da campanha criada (após substituição de variáveis).
--   Registra o nome real independente de ter sido definido pelo template global
--   ou editado manualmente pelo usuário antes do envio.
--
-- Nota: a coluna adset_name já existe na tabela (migration 052) e passa a ser
--   utilizada para registrar o template parcial do nome do conjunto por item
--   (com {template_adset_name} ainda presente, substituído pelo backend por adset).

ALTER TABLE public.bulk_ad_items
  ADD COLUMN IF NOT EXISTS campaign_name text;
