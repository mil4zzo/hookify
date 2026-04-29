--
-- Migration 074: Drop ad_metrics.pack_ids column (pack_ids[] fully migrated to ad_metric_pack_map)
--
-- Prerequisite: Migration 072 must be applied (all reads migrated to ad_metric_pack_map,
-- dual-write stopped, fallback ORs removed). This ensures the column is no longer referenced.
--
-- Cleanup:
--   1. DROP INDEX ad_metrics_pack_ids_gin (GIN index used by && operator)
--   2. DROP COLUMN ad_metrics.pack_ids (legacy array, now redundant with ad_metric_pack_map)
--

DROP INDEX IF EXISTS public.ad_metrics_pack_ids_gin;

ALTER TABLE public.ad_metrics
  DROP COLUMN IF EXISTS pack_ids;
