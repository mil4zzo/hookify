-- Migration: Add connection_id to ad_sheet_integrations
-- This allows each integration to use a specific Google connection

ALTER TABLE public.ad_sheet_integrations
  ADD COLUMN IF NOT EXISTS connection_id uuid;

COMMENT ON COLUMN public.ad_sheet_integrations.connection_id IS 
  'ID da conexão Google específica a usar para esta integração. NULL significa usar a primeira conexão disponível (compatibilidade com integrações antigas).';

-- Adicionar índice para melhorar performance de queries
CREATE INDEX IF NOT EXISTS ad_sheet_integrations_connection_id_idx
  ON public.ad_sheet_integrations(connection_id);

