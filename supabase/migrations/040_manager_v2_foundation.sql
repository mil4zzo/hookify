-- Migration 040
-- Manager v2 foundation:
-- 1) canonical metric grain uniqueness (user_id, ad_id, date)
-- 2) relational pack mapping (ad_metric_pack_map)
-- 3) precomputed hook/scroll_stop columns in ad_metrics

-- Ensure canonical uniqueness for fact grain used by Manager v2.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ad_metrics_user_ad_date_key'
      AND conrelid = 'public.ad_metrics'::regclass
  ) THEN
    ALTER TABLE public.ad_metrics
      ADD CONSTRAINT ad_metrics_user_ad_date_key UNIQUE (user_id, ad_id, date);
  END IF;
END $$;

-- Add precomputed rates used heavily by manager queries.
ALTER TABLE public.ad_metrics
  ADD COLUMN IF NOT EXISTS hook_rate numeric,
  ADD COLUMN IF NOT EXISTS scroll_stop_rate numeric;

-- Backfill hook_rate and scroll_stop_rate from existing curve payload.
WITH curve_values AS (
  SELECT
    am.id,
    am.user_id,
    CASE
      WHEN jsonb_typeof(am.video_play_curve_actions) = 'array'
        AND jsonb_array_length(am.video_play_curve_actions) > 0
      THEN coalesce(
        nullif(
          regexp_replace(
            coalesce(
              am.video_play_curve_actions ->> least(3, jsonb_array_length(am.video_play_curve_actions) - 1),
              '0'
            ),
            '[^0-9.-]',
            '',
            'g'
          ),
          ''
        ),
        '0'
      )::numeric
      ELSE 0::numeric
    END AS hook_raw,
    CASE
      WHEN jsonb_typeof(am.video_play_curve_actions) = 'array'
        AND jsonb_array_length(am.video_play_curve_actions) > 0
      THEN coalesce(
        nullif(
          regexp_replace(
            coalesce(
              am.video_play_curve_actions ->> least(1, jsonb_array_length(am.video_play_curve_actions) - 1),
              '0'
            ),
            '[^0-9.-]',
            '',
            'g'
          ),
          ''
        ),
        '0'
      )::numeric
      ELSE 0::numeric
    END AS scroll_raw
  FROM public.ad_metrics am
)
UPDATE public.ad_metrics am
SET
  hook_rate = CASE WHEN c.hook_raw > 1 THEN c.hook_raw / 100.0 ELSE c.hook_raw END,
  scroll_stop_rate = CASE WHEN c.scroll_raw > 1 THEN c.scroll_raw / 100.0 ELSE c.scroll_raw END
FROM curve_values c
WHERE am.id = c.id
  AND am.user_id = c.user_id
  AND (
    am.hook_rate IS NULL
    OR am.scroll_stop_rate IS NULL
  );

-- Relational mapping table for pack association.
CREATE TABLE IF NOT EXISTS public.ad_metric_pack_map (
  user_id uuid NOT NULL,
  pack_id uuid NOT NULL,
  ad_id text NOT NULL,
  metric_date date NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT ad_metric_pack_map_pkey PRIMARY KEY (user_id, pack_id, ad_id, metric_date),
  CONSTRAINT ad_metric_pack_map_metric_fk
    FOREIGN KEY (user_id, ad_id, metric_date)
    REFERENCES public.ad_metrics (user_id, ad_id, date)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS ad_metric_pack_map_user_pack_date_ad_idx
  ON public.ad_metric_pack_map USING btree (user_id, pack_id, metric_date, ad_id);

CREATE INDEX IF NOT EXISTS ad_metric_pack_map_user_ad_date_idx
  ON public.ad_metric_pack_map USING btree (user_id, ad_id, metric_date);

-- Backfill mapping from legacy pack_ids array.
INSERT INTO public.ad_metric_pack_map (user_id, pack_id, ad_id, metric_date)
SELECT
  am.user_id,
  p.pack_id,
  am.ad_id,
  am.date
FROM public.ad_metrics am
CROSS JOIN LATERAL unnest(coalesce(am.pack_ids, '{}'::uuid[])) AS p(pack_id)
ON CONFLICT (user_id, pack_id, ad_id, metric_date) DO NOTHING;
