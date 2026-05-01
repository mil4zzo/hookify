-- Migration 079: dedicated RPC for available_conversion_types lookup
--
-- Replaces the wasteful "probe" pattern of calling fetch_manager_rankings_core_v2
-- with limit=1 just to extract the available_conversion_types array.
--
-- The probe was paying full aggregation cost on the heavy RPC even though all
-- it needed was a DISTINCT list of action_types from ad_metrics.conversions
-- and ad_metrics.actions JSONB arrays.
--
-- Logic is copied verbatim from fetch_manager_rankings_core_v2_base_v060
-- (schema.sql:3819-3863 and 4161-4192) to guarantee parity. Specifically:
--   - Same WHERE filters (date range, account_ids, ILIKE name filters,
--     pack_ids via EXISTS on ad_metric_pack_map — NOT via the legacy
--     pack_ids[] && fallback removed in migration 072).
--   - Same DISTINCT ON dedup by (user_id, ad_id, date) with the same
--     ORDER BY tie-break (updated_at DESC, created_at DESC, id DESC).
--   - Same prefixing scheme: 'conversion:' for entries from conversions JSONB,
--     'action:' for entries from actions JSONB.
--   - Same nullif/sort behavior in the final aggregation.
--
-- Intentionally omitted from the new RPC (these do NOT affect the conversion
-- types universe — they are pure metric filters):
--   - p_action_type
--   - p_campaign_id (the v067 exact-match filter)

CREATE OR REPLACE FUNCTION public.fetch_available_conversion_types_v1(
  p_user_id uuid,
  p_date_start date,
  p_date_stop date,
  p_pack_ids uuid[],
  p_account_ids text[] DEFAULT NULL::text[],
  p_campaign_name_contains text DEFAULT NULL::text,
  p_adset_name_contains text DEFAULT NULL::text,
  p_ad_name_contains text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH base_candidates AS (
    SELECT am.user_id, am.ad_id, am.date, am.updated_at, am.created_at, am.id,
           am.conversions, am.actions
    FROM public.ad_metrics am
    WHERE am.user_id = p_user_id
      AND am.date >= p_date_start
      AND am.date <= p_date_stop
      AND (
        p_pack_ids IS NULL
        OR EXISTS (
          SELECT 1
          FROM public.ad_metric_pack_map apm
          WHERE apm.user_id = am.user_id
            AND apm.ad_id = am.ad_id
            AND apm.metric_date = am.date
            AND apm.pack_id = ANY(p_pack_ids)
        )
      )
      AND (p_account_ids IS NULL OR am.account_id = ANY(p_account_ids))
      AND (
        p_campaign_name_contains IS NULL
        OR p_campaign_name_contains = ''
        OR coalesce(am.campaign_name, '') ILIKE '%' || p_campaign_name_contains || '%'
      )
      AND (
        p_adset_name_contains IS NULL
        OR p_adset_name_contains = ''
        OR coalesce(am.adset_name, '') ILIKE '%' || p_adset_name_contains || '%'
      )
      AND (
        p_ad_name_contains IS NULL
        OR p_ad_name_contains = ''
        OR coalesce(am.ad_name, '') ILIKE '%' || p_ad_name_contains || '%'
      )
  ),
  base AS (
    SELECT DISTINCT ON (am.user_id, am.ad_id, am.date)
      am.conversions, am.actions
    FROM base_candidates am
    ORDER BY
      am.user_id,
      am.ad_id,
      am.date,
      am.updated_at DESC NULLS LAST,
      am.created_at DESC NULLS LAST,
      am.id DESC
  ),
  conv_entries_all AS (
    SELECT 'conversion:' || nullif(elem ->> 'action_type', '') AS conv_key
    FROM base b
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(b.conversions) = 'array' THEN b.conversions ELSE '[]'::jsonb END
    ) elem
    WHERE nullif(elem ->> 'action_type', '') IS NOT NULL

    UNION ALL

    SELECT 'action:' || nullif(elem ->> 'action_type', '') AS conv_key
    FROM base b
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(b.actions) = 'array' THEN b.actions ELSE '[]'::jsonb END
    ) elem
    WHERE nullif(elem ->> 'action_type', '') IS NOT NULL
  )
  SELECT coalesce(jsonb_agg(t.conv_key ORDER BY t.conv_key), '[]'::jsonb)
  FROM (
    SELECT DISTINCT conv_key FROM conv_entries_all
  ) t;
$$;

ALTER FUNCTION public.fetch_available_conversion_types_v1(uuid, date, date, uuid[], text[], text, text, text) OWNER TO postgres;

COMMENT ON FUNCTION public.fetch_available_conversion_types_v1(uuid, date, date, uuid[], text[], text, text, text) IS
  'Lightweight lookup for available_conversion_types. Replaces the limit=1 probe on fetch_manager_rankings_core_v2. Logic mirrors v060 conv_entries_all/available_types CTEs verbatim. See migration 079.';

REVOKE EXECUTE ON FUNCTION public.fetch_available_conversion_types_v1(uuid, date, date, uuid[], text[], text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fetch_available_conversion_types_v1(uuid, date, date, uuid[], text[], text, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fetch_available_conversion_types_v1(uuid, date, date, uuid[], text[], text, text, text) TO service_role;
