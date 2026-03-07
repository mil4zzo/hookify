-- Migration: Adiciona column_index para resolver headers duplicados
-- Quando o nome da coluna aparece mais de uma vez no header, o usuário escolhe pelo índice

ALTER TABLE public.ad_sheet_integrations
  ADD COLUMN IF NOT EXISTS ad_id_column_index integer,
  ADD COLUMN IF NOT EXISTS date_column_index integer,
  ADD COLUMN IF NOT EXISTS leadscore_column_index integer,
  ADD COLUMN IF NOT EXISTS cpr_max_column_index integer;

COMMENT ON COLUMN public.ad_sheet_integrations.ad_id_column_index IS
  'Índice da coluna quando há headers duplicados (0-based). Usado apenas quando ad_id_column aparece mais de uma vez.';
