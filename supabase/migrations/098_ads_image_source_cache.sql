-- 098: cache de URL de source de IMAGEM em alta resolução (espelho do 097 para vídeo).
--
-- image_source_url: preferencialmente o permalink_url do /adimages (facebook.com/ads/
-- image/?d=... — redireciona para o CDN com assinatura fresca a cada acesso, então é
-- efetivamente permanente; gravamos expiry longo e renovamos no cache-miss). Fallbacks
-- (igm media_url, creative.image_url, adimages url) são URLs de CDN perecíveis com oe=.
ALTER TABLE public.ads
ADD COLUMN IF NOT EXISTS image_source_url text,
ADD COLUMN IF NOT EXISTS image_source_expires_at timestamptz;
