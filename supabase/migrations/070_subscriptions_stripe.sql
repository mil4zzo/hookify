-- Extend subscriptions table with Stripe billing columns
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS stripe_customer_id     text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS stripe_status          text,
  ADD COLUMN IF NOT EXISTS cancel_at_period_end   boolean NOT NULL DEFAULT false;

-- Indexes for webhook lookups (both come in on every event)
CREATE INDEX IF NOT EXISTS subscriptions_stripe_customer_id_idx
  ON public.subscriptions (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS subscriptions_stripe_subscription_id_idx
  ON public.subscriptions (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

-- Idempotency table: each Stripe event is inserted once; duplicates are no-ops
CREATE TABLE IF NOT EXISTS public.stripe_events (
  event_id    text        PRIMARY KEY,
  type        text        NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

-- RLS: this table is written/read only by service role (no user-facing access)
ALTER TABLE public.stripe_events ENABLE ROW LEVEL SECURITY;
-- No SELECT/INSERT policies for authenticated role — service role bypasses RLS
