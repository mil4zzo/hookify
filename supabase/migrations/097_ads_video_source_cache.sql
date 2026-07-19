-- Migration: Cache da URL reproduzível do vídeo (CDN Meta) com expiry explícito
-- Data: 2026-07-18
-- Descrição:
--   A URL de source do vídeo (GET /{video_id}?fields=source) é assinada e expira
--   (~horas a ~48h, expiry no parâmetro oe= da própria URL). Transcrição, export
--   e o player do modal precisam dela; sem cache, cada consumidor refaz as mesmas
--   chamadas à Meta. Estas colunas guardam a última URL resolvida + validade —
--   consumidores usam se ainda restar margem, senão renovam e regravam (lazy
--   write-through). Nunca tratar video_source_url como permanente: validar
--   video_source_expires_at antes de usar.

ALTER TABLE public.ads
ADD COLUMN IF NOT EXISTS video_source_url text,
ADD COLUMN IF NOT EXISTS video_source_expires_at timestamptz;

COMMENT ON COLUMN public.ads.video_source_url IS 'Última URL de source do vídeo resolvida na Meta (CDN assinada, perecível). Usar apenas se video_source_expires_at ainda tiver margem.';
COMMENT ON COLUMN public.ads.video_source_expires_at IS 'Expiry da video_source_url (extraído do parâmetro oe= da URL; fallback conservador quando ausente).';
