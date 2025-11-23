-- Migration: Add date_format field to ad_sheet_integrations
-- Permite que o usuário configure o formato de data da planilha (DD/MM/YYYY ou MM/DD/YYYY)

ALTER TABLE public.ad_sheet_integrations
  ADD COLUMN IF NOT EXISTS date_format text;

-- Valores possíveis: 'DD/MM/YYYY', 'MM/DD/YYYY'
-- NULL = não configurado (deve ser obrigatório no frontend)
COMMENT ON COLUMN public.ad_sheet_integrations.date_format IS 
  'Formato de data da planilha: DD/MM/YYYY ou MM/DD/YYYY';

