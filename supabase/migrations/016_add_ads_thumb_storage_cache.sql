-- Migration: Cache de thumbnail no Supabase Storage (bucket público)
-- Data: 2025-12-14
-- Descrição:
--   Adiciona colunas na tabela public.ads para referenciar thumbnail cacheada no Storage.

ALTER TABLE public.ads
ADD COLUMN IF NOT EXISTS thumb_storage_path text,
ADD COLUMN IF NOT EXISTS thumb_cached_at timestamptz,
ADD COLUMN IF NOT EXISTS thumb_source_url text;

COMMENT ON COLUMN public.ads.thumb_storage_path IS 'Path do objeto no Supabase Storage (bucket público ad-thumbs).';
COMMENT ON COLUMN public.ads.thumb_cached_at IS 'Quando o thumbnail foi cacheado no Storage.';
COMMENT ON COLUMN public.ads.thumb_source_url IS 'URL original usada para baixar/cachear o thumbnail (normalmente adcreatives_videos_thumbs[0]).';

-- Índice opcional para auditoria/debug (não é crítico para query principal por ad_id)
CREATE INDEX IF NOT EXISTS ads_thumb_cached_at_idx ON public.ads (thumb_cached_at) WHERE thumb_cached_at IS NOT NULL;


