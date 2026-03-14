-- Migration 043: Leadscore-only integration and sheet integration hardening
-- Goals:
-- 1) Enforce deterministic uniqueness for global sheet integrations (pack_id IS NULL)
-- 2) Persist spreadsheet_name in ad_sheet_integrations (avoid expensive Drive lookups in pack listings)
-- 3) Remove CPR_MAX from Google Sheets enrichment flow
-- 4) Keep batch enrichment RPC focused on leadscore_values

-- -----------------------------------------------------------------------------
-- 1) Schema adjustments
-- -----------------------------------------------------------------------------

ALTER TABLE public.ad_sheet_integrations
  ADD COLUMN IF NOT EXISTS spreadsheet_name text;

-- Remove CPR_MAX mapping fields from integration config
ALTER TABLE public.ad_sheet_integrations
  DROP COLUMN IF EXISTS cpr_max_column,
  DROP COLUMN IF EXISTS cpr_max_column_index;

-- Remove CPR_MAX storage from ads/ad_metrics (Leadscore-only enrichment)
ALTER TABLE public.ads
  DROP COLUMN IF EXISTS cpr_max;

ALTER TABLE public.ad_metrics
  DROP COLUMN IF EXISTS cpr_max;

-- -----------------------------------------------------------------------------
-- 2) Data consistency + indexes
-- -----------------------------------------------------------------------------

-- Deduplicate global integrations (owner_id + pack_id NULL), keep newest row per owner.
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY owner_id
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
    ) AS rn
  FROM public.ad_sheet_integrations
  WHERE pack_id IS NULL
)
DELETE FROM public.ad_sheet_integrations asi
USING ranked r
WHERE asi.id = r.id
  AND r.rn > 1;

-- Drop old broad unique index (NULL semantics are not sufficient for global uniqueness)
DROP INDEX IF EXISTS public.ad_sheet_integrations_owner_pack_unique;

-- Unique global integration per owner (pack_id IS NULL)
CREATE UNIQUE INDEX IF NOT EXISTS ad_sheet_integrations_owner_global_unique
  ON public.ad_sheet_integrations(owner_id)
  WHERE pack_id IS NULL;

-- Unique integration per (owner, pack) only for non-null pack_id
CREATE UNIQUE INDEX IF NOT EXISTS ad_sheet_integrations_owner_pack_not_null_unique
  ON public.ad_sheet_integrations(owner_id, pack_id)
  WHERE pack_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 3) RPC: leadscore-only enrichment (single UPDATE strategy preserved)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.batch_update_ad_metrics_enrichment(
  p_user_id uuid,
  p_updates jsonb,
  p_pack_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  total_rows_updated int := 0;
  total_ids_sent     int := 0;
  existing_count     int := 0;
  in_pack_count      int := 0;
  all_ids            text[];
BEGIN
  -- Collect all IDs in SQL aggregate (avoids O(n²) concatenation in PL/pgSQL loop)
  SELECT array_agg(id_val)
  INTO all_ids
  FROM jsonb_array_elements(p_updates) AS item,
  LATERAL jsonb_array_elements_text(item->'ids') AS id_val;

  total_ids_sent := coalesce(array_length(all_ids, 1), 0);

  -- Single UPDATE via expanded CTE
  WITH expanded AS (
    SELECT
      id_val AS id,
      CASE
        WHEN item ? 'leadscore_values'
          AND item->'leadscore_values' IS NOT NULL
          AND item->'leadscore_values' != 'null'::jsonb
          AND jsonb_array_length(item->'leadscore_values') > 0
        THEN ARRAY(
          SELECT v::numeric
          FROM jsonb_array_elements(item->'leadscore_values') AS v
        )
        ELSE NULL
      END AS leadscore_vals
    FROM jsonb_array_elements(p_updates) AS item,
    LATERAL jsonb_array_elements_text(item->'ids') AS id_val
  )
  UPDATE public.ad_metrics am
  SET
    leadscore_values = CASE
      WHEN e.leadscore_vals IS NOT NULL THEN e.leadscore_vals
      ELSE am.leadscore_values
    END,
    updated_at = now()
  FROM expanded e
  WHERE am.id = e.id
    AND am.user_id = p_user_id
    AND (p_pack_id IS NULL OR am.pack_ids @> ARRAY[p_pack_id]::uuid[]);

  GET DIAGNOSTICS total_rows_updated = ROW_COUNT;

  IF total_ids_sent > 0 THEN
    SELECT
      count(*)::int,
      count(*) FILTER (
        WHERE p_pack_id IS NULL OR pack_ids @> ARRAY[p_pack_id]::uuid[]
      )::int
    INTO existing_count, in_pack_count
    FROM public.ad_metrics
    WHERE user_id = p_user_id AND id = ANY(all_ids);
  END IF;

  RETURN jsonb_build_object(
    'total_groups_processed', jsonb_array_length(p_updates),
    'total_rows_updated',     total_rows_updated,
    'total_ids_sent',         total_ids_sent,
    'ids_not_found_count',    greatest(0, total_ids_sent - existing_count),
    'ids_out_of_pack_count',  greatest(0, existing_count - in_pack_count),
    'status',                 'success'
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'status',                 'error',
      'error_message',          SQLERRM,
      'total_groups_processed', jsonb_array_length(p_updates),
      'total_rows_updated',     total_rows_updated,
      'total_ids_sent',         total_ids_sent,
      'ids_not_found_count',    0,
      'ids_out_of_pack_count',  0
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.batch_update_ad_metrics_enrichment(uuid, jsonb, uuid) TO authenticated;

COMMENT ON FUNCTION public.batch_update_ad_metrics_enrichment IS
  'Atualiza multiplos registros de ad_metrics em uma unica transacao via UPDATE + CTE, '
  'aplicando apenas leadscore_values (fluxo Leadscore-only). '
  'Aceita p_pack_id opcional para restringir as metricas cujo pack_ids contem esse pack.';
