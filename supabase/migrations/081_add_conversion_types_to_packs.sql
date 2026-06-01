-- 081_add_conversion_types_to_packs.sql
--
-- Materializa os conversion types como metadado do pack (compute-on-write).
--
-- Motivação: hoje a lista de conversion types é calculada a CADA leitura
-- (endpoint dedicado fetch_available_conversion_types_v1, rodando sob service_role),
-- o que varre ad_metrics inteiro do range e estoura statement_timeout (57014) sob
-- contenção. Como essa lista muda devagar (só quando entram ad_metrics novos, i.e.
-- no refresh), passamos a materializá-la no próprio pack via UNION INCREMENTAL
-- (monotônico, nunca remove) no momento do refresh — extraída dos dados que o job
-- já tem em memória. O dropdown do Manager passa a derivar da união dos packs
-- selecionados, usando o payload de /analytics/packs que já é carregado em toda tela.
--
-- Chaves no formato 'conversion:<action_type>' / 'action:<action_type>' (mesmo
-- universo do antigo available_conversion_types).
--
-- Esta migration é ADITIVA e segura de rodar a qualquer momento: nada lê a coluna
-- ainda. O backfill abaixo faz o scan completo (one-shot) para semear a lista.

SET statement_timeout = 0;  -- backfill pode levar alguns minutos; rode como superuser

-- 1) Coluna (idempotente)
ALTER TABLE public.packs
  ADD COLUMN IF NOT EXISTS conversion_types text[] NOT NULL DEFAULT '{}'::text[];

COMMENT ON COLUMN public.packs.conversion_types IS
  'Lista materializada (union incremental, monotonica) dos conversion types do pack. '
  'Chaves: conversion:<action_type> / action:<action_type>. Populada no refresh '
  '(union dos dados ingeridos) + backfill inicial. Fonte do dropdown de eventos no Manager.';

-- 2) Backfill one-shot: scan completo por pack a partir de ad_metrics.
WITH conv AS (
  SELECT
    apm.pack_id,
    ck.conv_key
  FROM public.ad_metric_pack_map apm
  JOIN public.ad_metrics am
    ON am.user_id = apm.user_id
   AND am.ad_id   = apm.ad_id
   AND am.date    = apm.metric_date
  CROSS JOIN LATERAL (
    SELECT 'conversion:' || nullif(elem->>'action_type', '') AS conv_key
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(am.conversions) = 'array' THEN am.conversions ELSE '[]'::jsonb END
    ) elem
    WHERE nullif(elem->>'action_type', '') IS NOT NULL
    UNION ALL
    SELECT 'action:' || nullif(elem->>'action_type', '') AS conv_key
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(am.actions) = 'array' THEN am.actions ELSE '[]'::jsonb END
    ) elem
    WHERE nullif(elem->>'action_type', '') IS NOT NULL
  ) ck
  WHERE ck.conv_key IS NOT NULL
),
agg AS (
  SELECT pack_id, array_agg(DISTINCT conv_key ORDER BY conv_key) AS types
  FROM conv
  GROUP BY pack_id
)
UPDATE public.packs p
SET conversion_types = agg.types
FROM agg
WHERE p.id = agg.pack_id;
