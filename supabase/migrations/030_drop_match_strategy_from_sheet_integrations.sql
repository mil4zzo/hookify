-- Migration: Remove match_strategy from ad_sheet_integrations (dead code)
-- Match is always by ad_id; this column was never used in the importer logic.
ALTER TABLE public.ad_sheet_integrations
  DROP COLUMN IF EXISTS match_strategy;
