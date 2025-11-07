-- Migration: Adicionar campos de fallback para vídeos e thumbnails na tabela ads
-- Data: 2025-01-XX
-- Descrição: Adiciona campos adcreatives_videos_ids e adcreatives_videos_thumbs para armazenar
--            arrays de video IDs e thumbnail URLs que podem ser usados como fallback no frontend
--            quando creative.video_id ou creative.thumbnail_url não estão disponíveis.

-- Adicionar colunas (se não existirem)
ALTER TABLE public.ads 
ADD COLUMN IF NOT EXISTS adcreatives_videos_ids jsonb,
ADD COLUMN IF NOT EXISTS adcreatives_videos_thumbs jsonb;

-- Criar índice GIN para busca eficiente nos arrays JSONB (opcional, mas recomendado)
CREATE INDEX IF NOT EXISTS ads_videos_ids_idx 
ON public.ads USING gin(adcreatives_videos_ids) 
WHERE adcreatives_videos_ids IS NOT NULL;

-- Comentários para documentação
COMMENT ON COLUMN public.ads.adcreatives_videos_ids IS 'Array de video IDs do asset_feed_spec (fallback para creative.video_id)';
COMMENT ON COLUMN public.ads.adcreatives_videos_thumbs IS 'Array de thumbnail URLs do asset_feed_spec (fallback para creative.thumbnail_url, geralmente com maior resolução)';

