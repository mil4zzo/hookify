-- Migration: Tabela de transcrições de vídeos de anúncios (speech-to-text)
-- Data: 2026-02-28
-- Descrição:
--   Cria tabela ad_transcriptions para armazenar transcrições de vídeos
--   deduplicadas por (user_id, ad_name). Todos os ads com mesmo nome
--   compartilham a mesma transcrição.

CREATE TABLE IF NOT EXISTS public.ad_transcriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  ad_name text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  full_text text,
  timestamped_text jsonb,
  metadata jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (user_id, ad_name)
);

CREATE INDEX IF NOT EXISTS ad_transcriptions_user_status_idx
  ON public.ad_transcriptions (user_id, status);

-- RLS
ALTER TABLE public.ad_transcriptions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'ad_transcriptions'
      AND policyname = 'ad_transcriptions_select_own'
  ) THEN
    CREATE POLICY ad_transcriptions_select_own
      ON public.ad_transcriptions FOR SELECT
      USING (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'ad_transcriptions'
      AND policyname = 'ad_transcriptions_modify_own'
  ) THEN
    CREATE POLICY ad_transcriptions_modify_own
      ON public.ad_transcriptions FOR ALL
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;
END $$;
