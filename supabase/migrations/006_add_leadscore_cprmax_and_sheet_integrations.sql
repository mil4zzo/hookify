-- Migration: Add leadscore/cpr_max to ad_metrics and ads, and create ad_sheet_integrations

-- 1) Add enrichment columns to time-series metrics table
ALTER TABLE public.ad_metrics
  ADD COLUMN IF NOT EXISTS leadscore numeric,
  ADD COLUMN IF NOT EXISTS cpr_max numeric;

-- 2) Add enrichment columns to aggregated ads table
ALTER TABLE public.ads
  ADD COLUMN IF NOT EXISTS leadscore numeric,
  ADD COLUMN IF NOT EXISTS cpr_max numeric;

-- 3) Configuration table for Google Sheets → ad_metrics integration
CREATE TABLE IF NOT EXISTS public.ad_sheet_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- dono da integração (ajuste o FK conforme seu modelo: usuário, workspace, conta etc.)
  owner_id uuid NOT NULL,
  spreadsheet_id text NOT NULL,
  worksheet_title text NOT NULL,
  match_strategy text NOT NULL DEFAULT 'AD_ID',
  ad_id_column text NOT NULL,
  date_column text NOT NULL,
  leadscore_column text,
  cpr_max_column text,
  last_synced_at timestamptz,
  last_sync_status text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT ad_sheet_integrations_owner_unique UNIQUE (owner_id)
);

-- Opcional: índice para consultas por owner
CREATE INDEX IF NOT EXISTS ad_sheet_integrations_owner_idx
  ON public.ad_sheet_integrations(owner_id);

-- Enable RLS
ALTER TABLE public.ad_sheet_integrations ENABLE ROW LEVEL SECURITY;

-- Policies (seguindo o padrão das outras tabelas)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'ad_sheet_integrations' 
    AND policyname = 'ad_sheet_integrations_select_own'
  ) THEN
    CREATE POLICY ad_sheet_integrations_select_own ON public.ad_sheet_integrations
      FOR SELECT USING (owner_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'ad_sheet_integrations' 
    AND policyname = 'ad_sheet_integrations_modify_own'
  ) THEN
    CREATE POLICY ad_sheet_integrations_modify_own ON public.ad_sheet_integrations
      FOR ALL USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
  END IF;
END $$;
