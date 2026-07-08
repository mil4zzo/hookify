-- Verifica linhas-zero em ad_metrics (ads sem entrega vindos do inventário /ads).
-- Critério: todas as métricas de entrega zeradas (spend, impressions, clicks, reach, plays).
-- Real ads com atividade zerada em TODAS essas colunas ao mesmo tempo são extremamente raros
-- (na prática, isso é a assinatura da linha sintetizada por ad_inventory.synthesize_zero_raw_rows).

-- 1) Visão geral: quantas linhas-zero existem, por usuário
SELECT
  user_id,
  count(*) AS zero_rows,
  count(DISTINCT ad_id) AS zero_ads,
  min(date) AS first_date,
  max(date) AS last_date
FROM public.ad_metrics
WHERE spend = 0
  AND impressions = 0
  AND clicks = 0
  AND reach = 0
  AND video_total_plays = 0
GROUP BY user_id
ORDER BY zero_rows DESC;

-- 2) Detalhe por ad: útil pra conferir o caso real (adset com ads "ativos zerados")
SELECT
  am.user_id,
  am.ad_id,
  am.ad_name,
  am.adset_id,
  am.adset_name,
  am.campaign_name,
  a.effective_status,
  count(*) AS zero_days,
  min(am.date) AS first_zero_date,
  max(am.date) AS last_zero_date
FROM public.ad_metrics am
LEFT JOIN public.ads a
  ON a.user_id = am.user_id AND a.ad_id = am.ad_id
WHERE am.spend = 0
  AND am.impressions = 0
  AND am.clicks = 0
  AND am.reach = 0
  AND am.video_total_plays = 0
GROUP BY am.user_id, am.ad_id, am.ad_name, am.adset_id, am.adset_name, am.campaign_name, a.effective_status
ORDER BY zero_days DESC
LIMIT 200;

-- 3) Filtrar por um usuário específico (troque o UUID) e opcionalmente por pack
-- SELECT am.*
-- FROM public.ad_metrics am
-- WHERE am.user_id = '00000000-0000-0000-0000-000000000000'
--   AND am.spend = 0 AND am.impressions = 0 AND am.clicks = 0
--   AND am.reach = 0 AND am.video_total_plays = 0
-- ORDER BY am.ad_id, am.date;

-- 4) Cruzar com ad_metric_pack_map pra ver a quais packs essas linhas-zero pertencem
SELECT
  apm.pack_id,
  p.name AS pack_name,
  count(*) AS zero_rows,
  count(DISTINCT am.ad_id) AS zero_ads
FROM public.ad_metrics am
JOIN public.ad_metric_pack_map apm
  ON apm.user_id = am.user_id AND apm.ad_id = am.ad_id AND apm.metric_date = am.date
LEFT JOIN public.packs p
  ON p.id = apm.pack_id
WHERE am.spend = 0
  AND am.impressions = 0
  AND am.clicks = 0
  AND am.reach = 0
  AND am.video_total_plays = 0
GROUP BY apm.pack_id, p.name
ORDER BY zero_rows DESC;
