-- Migration: Add pack_id to ad_sheet_integrations and support per-pack integrations
-- Objetivo: permitir que cada pack tenha sua própria integração de planilha ("booster"),
-- em vez de apenas uma configuração global por usuário.

-- 1) Adicionar coluna pack_id referenciando packs
ALTER TABLE public.ad_sheet_integrations
  ADD COLUMN IF NOT EXISTS pack_id uuid;

-- Opcional: FK para manter integridade com packs
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ad_sheet_integrations_pack_id_fkey'
  ) THEN
    ALTER TABLE public.ad_sheet_integrations
      ADD CONSTRAINT ad_sheet_integrations_pack_id_fkey
      FOREIGN KEY (pack_id) REFERENCES public.packs(id)
      ON DELETE CASCADE;
  END IF;
END $$;

-- 2) Remover UNIQUE global por owner_id (permitir múltiplas integrações por usuário)
ALTER TABLE public.ad_sheet_integrations
  DROP CONSTRAINT IF EXISTS ad_sheet_integrations_owner_unique;

-- 3) Criar índice único por (owner_id, pack_id)
-- - Garante no máximo 1 integração por (usuário, pack)
-- - Para integrações antigas sem pack_id (NULL), continua havendo no máximo 1 por usuário
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'i'
      AND c.relname = 'ad_sheet_integrations_owner_pack_unique'
      AND n.nspname = 'public'
  ) THEN
    CREATE UNIQUE INDEX ad_sheet_integrations_owner_pack_unique
      ON public.ad_sheet_integrations(owner_id, pack_id);
  END IF;
END $$;

-- 4) Índice auxiliar por pack_id para consultas rápidas por pack
CREATE INDEX IF NOT EXISTS ad_sheet_integrations_pack_id_idx
  ON public.ad_sheet_integrations(pack_id);


