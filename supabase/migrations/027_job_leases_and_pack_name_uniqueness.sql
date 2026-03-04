-- Migration: adiciona lease de jobs, unicidade case-insensitive para packs
-- e RPC batch para anexar pack_id aos arrays sem lookup prévio.

-- ========= PACK NAME NORMALIZATION / UNIQUENESS =========

UPDATE public.packs
SET name = btrim(name)
WHERE name IS NOT NULL
  AND name <> btrim(name);

WITH duplicate_packs AS (
  SELECT
    id,
    user_id,
    btrim(name) AS trimmed_name,
    row_number() OVER (
      PARTITION BY user_id, lower(btrim(name))
      ORDER BY created_at NULLS FIRST, id
    ) AS rn
  FROM public.packs
)
UPDATE public.packs AS p
SET name = duplicate_packs.trimmed_name || ' (' || left(p.id::text, 8) || ')'
FROM duplicate_packs
WHERE p.id = duplicate_packs.id
  AND duplicate_packs.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS packs_user_normalized_name_unique_idx
  ON public.packs (user_id, lower(btrim(name)));

COMMENT ON INDEX public.packs_user_normalized_name_unique_idx IS
  'Garante unicidade de nome de pack por usuário usando trim + lower.';

-- ========= JOB PROCESSING LEASES =========

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS processing_owner text,
  ADD COLUMN IF NOT EXISTS processing_claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS processing_lease_until timestamptz,
  ADD COLUMN IF NOT EXISTS processing_attempts integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS jobs_processing_lease_idx
  ON public.jobs (user_id, status, processing_lease_until);

CREATE OR REPLACE FUNCTION public.claim_job_processing(
  p_job_id text,
  p_user_id uuid,
  p_owner text,
  p_lease_seconds integer DEFAULT 300
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_claimed boolean := false;
BEGIN
  UPDATE public.jobs
  SET
    status = CASE WHEN status = 'meta_completed' THEN 'processing' ELSE status END,
    message = CASE WHEN status = 'meta_completed' THEN 'Iniciando coleta de anúncios...' ELSE message END,
    processing_owner = p_owner,
    processing_claimed_at = now(),
    processing_lease_until = now() + make_interval(secs => GREATEST(p_lease_seconds, 30)),
    processing_attempts = COALESCE(processing_attempts, 0) + 1,
    updated_at = now()
  WHERE id = p_job_id
    AND user_id = p_user_id
    AND status IN ('meta_completed', 'processing', 'persisting')
    AND (
      status = 'meta_completed'
      OR processing_lease_until IS NULL
      OR processing_lease_until <= now()
      OR processing_owner = p_owner
    )
  RETURNING status INTO v_status;

  v_claimed := FOUND;

  RETURN jsonb_build_object(
    'claimed', v_claimed,
    'status', COALESCE(v_status, ''),
    'owner', CASE WHEN v_claimed THEN p_owner ELSE NULL END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_job_processing(text, uuid, text, integer) TO authenticated;

COMMENT ON FUNCTION public.claim_job_processing(text, uuid, text, integer) IS
  'Adquire lease de processamento do job de forma atômica. Permite claim inicial e self-healing apenas quando o lease expirou.';

CREATE OR REPLACE FUNCTION public.renew_job_processing_lease(
  p_job_id text,
  p_user_id uuid,
  p_owner text,
  p_lease_seconds integer DEFAULT 300
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_renewed boolean := false;
BEGIN
  UPDATE public.jobs
  SET
    processing_lease_until = now() + make_interval(secs => GREATEST(p_lease_seconds, 30)),
    updated_at = now()
  WHERE id = p_job_id
    AND user_id = p_user_id
    AND processing_owner = p_owner
    AND status IN ('processing', 'persisting');

  v_renewed := FOUND;

  RETURN jsonb_build_object(
    'renewed', v_renewed
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.renew_job_processing_lease(text, uuid, text, integer) TO authenticated;

COMMENT ON FUNCTION public.renew_job_processing_lease(text, uuid, text, integer) IS
  'Renova o lease de processamento do worker atual se ele ainda for o owner do job.';

CREATE OR REPLACE FUNCTION public.release_job_processing_lease(
  p_job_id text,
  p_user_id uuid,
  p_owner text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_released boolean := false;
BEGIN
  UPDATE public.jobs
  SET
    processing_owner = NULL,
    processing_claimed_at = NULL,
    processing_lease_until = NULL,
    updated_at = now()
  WHERE id = p_job_id
    AND user_id = p_user_id
    AND processing_owner = p_owner;

  v_released := FOUND;

  RETURN jsonb_build_object(
    'released', v_released
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.release_job_processing_lease(text, uuid, text) TO authenticated;

COMMENT ON FUNCTION public.release_job_processing_lease(text, uuid, text) IS
  'Libera o lease do worker que ainda detém o processamento do job.';

-- ========= PACK_ID BATCH ATTACH =========

CREATE OR REPLACE FUNCTION public.batch_add_pack_id_to_arrays(
  p_user_id uuid,
  p_pack_id uuid,
  p_table_name text,
  p_ids_to_update text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_count int := 0;
BEGIN
  IF p_table_name NOT IN ('ads', 'ad_metrics') THEN
    RAISE EXCEPTION 'Tabela inválida: %. Use "ads" ou "ad_metrics"', p_table_name;
  END IF;

  IF p_table_name = 'ads' THEN
    UPDATE public.ads
    SET
      pack_ids = CASE
        WHEN p_pack_id = ANY(COALESCE(pack_ids, ARRAY[]::uuid[])) THEN COALESCE(pack_ids, ARRAY[]::uuid[])
        ELSE array_append(COALESCE(pack_ids, ARRAY[]::uuid[]), p_pack_id)
      END,
      updated_at = now()
    WHERE user_id = p_user_id
      AND ad_id = ANY(p_ids_to_update);

    GET DIAGNOSTICS updated_count = ROW_COUNT;
  ELSE
    UPDATE public.ad_metrics
    SET
      pack_ids = CASE
        WHEN p_pack_id = ANY(COALESCE(pack_ids, ARRAY[]::uuid[])) THEN COALESCE(pack_ids, ARRAY[]::uuid[])
        ELSE array_append(COALESCE(pack_ids, ARRAY[]::uuid[]), p_pack_id)
      END,
      updated_at = now()
    WHERE user_id = p_user_id
      AND id = ANY(p_ids_to_update);

    GET DIAGNOSTICS updated_count = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'rows_updated', updated_count,
    'status', 'success'
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'status', 'error',
      'error_message', SQLERRM,
      'rows_updated', 0
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.batch_add_pack_id_to_arrays(uuid, uuid, text, text[]) TO authenticated;

COMMENT ON FUNCTION public.batch_add_pack_id_to_arrays(uuid, uuid, text, text[]) IS
  'Anexa pack_id de forma idempotente ao array pack_ids de ads ou ad_metrics em batch.';
