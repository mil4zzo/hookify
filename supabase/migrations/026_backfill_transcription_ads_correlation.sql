-- Migration: Backfill da correlação ads ↔ ad_transcriptions
-- Data: 2026-02-28
-- Descrição:
--   Preenche ad_ids e transcription_id para dados já existentes.
--   Deve ser executada após 025_add_transcription_ads_correlation.

-- 1) Preencher ads.transcription_id a partir de (user_id, ad_name)
UPDATE public.ads a
SET
  transcription_id = t.id,
  updated_at = now()
FROM public.ad_transcriptions t
WHERE a.user_id = t.user_id
  AND a.ad_name = t.ad_name
  AND a.transcription_id IS DISTINCT FROM t.id;

-- 2) Preencher ad_transcriptions.ad_ids com array de ad_id dos ads com mesmo (user_id, ad_name)
UPDATE public.ad_transcriptions at
SET
  ad_ids = COALESCE(
    (
      SELECT array_agg(a.ad_id ORDER BY a.ad_id)
      FROM public.ads a
      WHERE a.user_id = at.user_id
        AND a.ad_name = at.ad_name
    ),
    '{}'
  ),
  updated_at = now();
