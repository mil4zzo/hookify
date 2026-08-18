-- Migration 106: fecha vazamento de dados em fetch_ad_metrics_for_analytics
--
-- VULNERABILIDADE (pre-existente, nao introduzida pela P3)
--   A funcao e SECURITY DEFINER, recebe p_user_id e estava concedida a
--   `authenticated` SEM nenhuma validacao de auth.uid(). Qualquer usuario logado
--   podia ler as metricas de qualquer outro, chamando direto via PostgREST com o
--   uuid alheio. Confirmado explorando: um usuario leu 58.001 linhas de outro.
--
--   Todas as outras RPCs de analytics ja tinham esse guard. Esta ficou de fora.
--
-- DUPLA CORRECAO (defesa em profundidade)
--   1. Guard de auth.uid() no corpo — fecha independente de quem chame.
--   2. REVOKE de anon/authenticated — a funcao nao precisa ser chamavel pelo
--      cliente. Hoje nada a chama: o unico caller era o helper Python
--      _fetch_ad_metrics_via_rpc, que virou codigo morto (nenhum chamador).
--
--   Manter as duas: se um dia alguem reconceder o EXECUTE, o guard segura.
--
-- Nada legitimo quebra: o backend sempre passou o proprio user_id do ator, e o
-- unico caminho que usava a funcao ja nao e exercitado.
--
-- A funcao NAO e dropada aqui de proposito. Correcao de seguranca deve ser
-- minima e obviamente correta; remover funcao e outra classe de mudanca, e fica
-- para uma limpeza propria (junto com o helper Python morto).

BEGIN;

CREATE OR REPLACE FUNCTION public.fetch_ad_metrics_for_analytics(p_user_id uuid, p_date_start date, p_date_stop date, p_pack_ids uuid[] DEFAULT NULL::uuid[], p_account_ids text[] DEFAULT NULL::text[])
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
BEGIN
  -- Guard que faltava. Sem ele esta funcao era um vazamento de dados: SECURITY
  -- DEFINER, concedida a `authenticated`, recebendo p_user_id sem validacao —
  -- qualquer usuario logado lia as metricas de qualquer outro passando o uuid
  -- alheio. Verificado explorando: 58.001 linhas de outro usuario.
  IF auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'Forbidden: p_user_id must match auth.uid()'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT jsonb_build_object(
    'ad_id',                     am.ad_id,
    'ad_name',                   am.ad_name,
    'account_id',                am.account_id,
    'campaign_id',               am.campaign_id,
    'campaign_name',             am.campaign_name,
    'adset_id',                  am.adset_id,
    'adset_name',                am.adset_name,
    'date',                      am.date,
    'clicks',                    am.clicks,
    'impressions',               am.impressions,
    'inline_link_clicks',        am.inline_link_clicks,
    'spend',                     am.spend,
    'video_total_plays',         am.video_total_plays,
    'video_total_thruplays',     am.video_total_thruplays,
    'video_watched_p50',         am.video_watched_p50,
    'conversions',               am.conversions,
    'actions',                   am.actions,
    'video_play_curve_actions',  am.video_play_curve_actions,
    'hook_rate',                 am.hook_rate,
    'scroll_stop_rate',          am.scroll_stop_rate,
    'hold_rate',                 am.hold_rate,
    'reach',                     am.reach,
    'frequency',                 am.frequency,
    'leadscore_values',          am.leadscore_values,
    'lpv',                       am.lpv
  )
  FROM public.ad_metrics am
  WHERE am.user_id = p_user_id
    AND am.date >= p_date_start
    AND am.date <= p_date_stop
    AND (
      p_pack_ids IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.ad_metric_pack_map apm
        WHERE apm.user_id = am.user_id
          AND apm.ad_id = am.ad_id
          AND apm.metric_date = am.date
          AND apm.pack_id = ANY(p_pack_ids)
      )
    )
    AND (p_account_ids IS NULL OR am.account_id = ANY(p_account_ids));
END;
$function$;

REVOKE ALL ON FUNCTION public.fetch_ad_metrics_for_analytics(uuid, date, date, uuid[], text[]) FROM anon;
REVOKE ALL ON FUNCTION public.fetch_ad_metrics_for_analytics(uuid, date, date, uuid[], text[]) FROM authenticated;

DO $post$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.routine_privileges
    WHERE routine_schema = 'public'
      AND routine_name = 'fetch_ad_metrics_for_analytics'
      AND grantee IN ('anon', 'authenticated')
  ) THEN
    RAISE EXCEPTION 'ABORTADO: a funcao segue chamavel por anon/authenticated.';
  END IF;

  IF position('auth.uid()' in (
       SELECT prosrc FROM pg_proc
       WHERE pronamespace = 'public'::regnamespace
         AND proname = 'fetch_ad_metrics_for_analytics')) = 0 THEN
    RAISE EXCEPTION 'ABORTADO: guard de auth.uid() nao esta no corpo da funcao.';
  END IF;
END
$post$;

COMMIT;
