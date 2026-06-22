-- Migration 084: billing fixes
-- 1. Add status column to stripe_events for safe idempotency (mark processing BEFORE handler,
--    processed AFTER success — avoids losing retries on handler failure)
-- 2. Backfill subscription rows for users created before migration 068 (trigger only covers
--    new signups; pre-068 users have no row and would 500 on checkout)

ALTER TABLE public.stripe_events
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'processed'
    CHECK (status IN ('processing', 'processed')),
  ADD COLUMN IF NOT EXISTS processed_at timestamptz;

-- Default 'processed' keeps existing rows semantically correct and is safe during the deploy
-- window when the old backend (which never writes status) may still be running.

INSERT INTO public.subscriptions (user_id, tier, source)
SELECT id, 'standard', 'manual'
FROM auth.users
ON CONFLICT (user_id) DO NOTHING;
