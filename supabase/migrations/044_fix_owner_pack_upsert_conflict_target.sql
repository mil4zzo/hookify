-- Migration 044: Fix ON CONFLICT target for (owner_id, pack_id) upsert
-- Context:
-- - Route save_ad_sheet_integration uses upsert(..., on_conflict="owner_id,pack_id")
-- - Postgres can not infer conflict target from a partial unique index.
-- - We keep global uniqueness via partial index on owner_id WHERE pack_id IS NULL.
-- - For pack-specific rows, we need a non-partial unique index on (owner_id, pack_id).

-- -----------------------------------------------------------------------------
-- 1) Deduplicate pack-specific integrations (owner_id + pack_id NOT NULL)
-- -----------------------------------------------------------------------------
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY owner_id, pack_id
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
    ) AS rn
  FROM public.ad_sheet_integrations
  WHERE pack_id IS NOT NULL
)
DELETE FROM public.ad_sheet_integrations asi
USING ranked r
WHERE asi.id = r.id
  AND r.rn > 1;

-- -----------------------------------------------------------------------------
-- 2) Replace partial non-null index with non-partial unique index
-- -----------------------------------------------------------------------------
DROP INDEX IF EXISTS public.ad_sheet_integrations_owner_pack_not_null_unique;

-- Required for ON CONFLICT (owner_id, pack_id) inference.
CREATE UNIQUE INDEX IF NOT EXISTS ad_sheet_integrations_owner_pack_unique
  ON public.ad_sheet_integrations(owner_id, pack_id);

