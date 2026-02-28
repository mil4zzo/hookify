-- Migration: Correlação bidirecional ads ↔ ad_transcriptions
-- Data: 2026-02-28
-- Descrição:
--   ads.transcription_id: referência ao id da transcrição (lookup O(1) no detalhe do ad)
--   ad_transcriptions.ad_ids: array de ad_ids que compartilham essa transcrição

ALTER TABLE public.ads
ADD COLUMN IF NOT EXISTS transcription_id uuid REFERENCES public.ad_transcriptions(id) ON DELETE SET NULL;

ALTER TABLE public.ad_transcriptions
ADD COLUMN IF NOT EXISTS ad_ids text[] DEFAULT '{}';

CREATE INDEX IF NOT EXISTS ads_transcription_id_idx ON public.ads (transcription_id) WHERE transcription_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ad_transcriptions_ad_ids_gin_idx ON public.ad_transcriptions USING GIN (ad_ids);

COMMENT ON COLUMN public.ads.transcription_id IS 'Referência à transcrição do vídeo (por ad_name). Null se não houver transcrição.';
COMMENT ON COLUMN public.ad_transcriptions.ad_ids IS 'Array de ad_id dos anúncios que compartilham esta transcrição (mesmo ad_name).';
