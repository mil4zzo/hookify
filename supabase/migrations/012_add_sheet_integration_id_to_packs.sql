-- Migration: Add sheet_integration_id to packs
-- Permite buscar dados da integração diretamente via JOIN ao buscar packs
-- Objetivo: simplificar frontend - dados da integração já vêm junto com o pack

-- 1) Adicionar coluna sheet_integration_id referenciando ad_sheet_integrations
ALTER TABLE public.packs
  ADD COLUMN IF NOT EXISTS sheet_integration_id uuid;

-- 2) FK para manter integridade referencial
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'packs_sheet_integration_id_fkey'
  ) THEN
    ALTER TABLE public.packs
      ADD CONSTRAINT packs_sheet_integration_id_fkey
      FOREIGN KEY (sheet_integration_id) REFERENCES public.ad_sheet_integrations(id)
      ON DELETE SET NULL; -- Se integração for deletada, remove referência mas mantém pack
  END IF;
END $$;

-- 3) Índice para JOINs eficientes
CREATE INDEX IF NOT EXISTS packs_sheet_integration_id_idx
  ON public.packs(sheet_integration_id);

-- 4) Comentário para documentação
COMMENT ON COLUMN public.packs.sheet_integration_id IS 
  'Referência à integração de planilha Google Sheets associada a este pack. Permite buscar dados da integração diretamente via JOIN ao buscar packs.';

