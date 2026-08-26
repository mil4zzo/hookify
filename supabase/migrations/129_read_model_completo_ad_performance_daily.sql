-- 129: ad_performance_daily vira o read model COMPLETO do anúncio-dia (números + chaves
--      de agrupamento), não só eventos e leads.
--
-- O QUE A MEDIÇÃO DA 128 MOSTROU (lab, 2026-08-26)
-- ------------------------------------------------
-- Com a 128, a RPC nova ainda precisava buscar os números (spend, impressões, ...) em
-- ad_metrics: 42 mil lookups por carga do Manager (cenário real de 3 packs). Selecionar
-- só 14 colunas NÃO reduz o I/O: a página de heap é lida inteira, e a linha de
-- ad_metrics tem ~1 KB (40% JSON inline) — cabem ~8 por página. São ~5.300 páginas
-- aleatórias por carga; numa instância de 1 GB em swap é exatamente o "fetch frio de
-- 9 s" medido antes. O plano original ("os números já são colunas; o ganho vem de
-- parar o select am.*") estava certo sobre CPU e errado sobre I/O.
--
-- O DESENHO
-- ---------
-- A tabela derivada passa a carregar, por anúncio-dia, tudo o que a leitura agregada
-- consome: chaves de agrupamento (account_id, campaign_id, adset_id, ad_name) e os
-- números já saneados como a RPC faz (coalesce 0, hook/scroll com o fallback da
-- curva). Linha de ~250-300 B, ~27 por página: 3-4× menos páginas que ad_metrics, e
-- uma tabela de ~90 MB que cabe no cache onde os 403 MB de ad_metrics não cabem.
-- A RPC (migration 130) lê SÓ esta tabela + o mapa + `ads`; ad_metrics só entra para
-- a linha REPRESENTANTE de cada grupo (~77 lookups) e para filtros por nome de
-- campanha/conjunto (EXISTS, só quando o filtro é usado).
--
-- Passa a existir UMA linha por anúncio-dia (antes: só com evento ou lead). Os nomes
-- de campanha/conjunto (68 e 48 bytes em média) ficam FORA — seriam +40% de largura
-- para servir ao representante (77 lookups) e ao filtro (raro).
--
-- Mesmo mecanismo da 128: trigger por statement, rebuild por usuário, checagem
-- completa. A derivação continua em UMA função (ad_performance_derive_row), agora
-- recebendo a linha inteira de ad_metrics.
--
-- APLICAR: esta migration (instantânea; colunas com DEFAULT 0 são metadado) e depois
-- o backfill de novo (supabase/scripts/backfill_128_rollup_de_performance.sql — ~3
-- min, app ocioso). Até o backfill, as colunas novas ficam 0 e NADA as lê (a RPC
-- nova só entra na 130).

-- ============================================================================
-- 1. Colunas novas
-- ============================================================================

ALTER TABLE public.ad_performance_daily
  ADD COLUMN IF NOT EXISTS account_id        text,
  ADD COLUMN IF NOT EXISTS campaign_id       text,
  ADD COLUMN IF NOT EXISTS adset_id          text,
  ADD COLUMN IF NOT EXISTS ad_name           text,
  ADD COLUMN IF NOT EXISTS impressions       bigint  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS clicks            bigint  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS inline_link_clicks bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS spend             numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lpv               bigint  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS plays             bigint  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS thruplays         bigint  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS video_watched_p50 numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS video_watched_p75 numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS hold_rate         numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reach             bigint  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS frequency         numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS hook_value        numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS scroll_stop_value numeric NOT NULL DEFAULT 0;

-- Uma linha por anúncio-dia, sempre: cai a exigência de "pelo menos um par".
ALTER TABLE public.ad_performance_daily DROP CONSTRAINT IF EXISTS ad_performance_daily_pairs_chk;
ALTER TABLE public.ad_performance_daily ADD CONSTRAINT ad_performance_daily_pairs_chk CHECK (
  cardinality(conv_key_ids) = cardinality(conv_values)
  AND cardinality(lead_scores) = cardinality(lead_qtys)
);

COMMENT ON TABLE public.ad_performance_daily IS
'READ MODEL do anúncio-dia, DERIVADO de ad_metrics (migrations 128/129): uma linha por (user, anúncio, dia) com chaves de agrupamento, números já saneados como a RPC do Manager consome (hook/scroll com fallback da curva), conversões/ações somadas por chave (arrays paralelos conv_key_ids/conv_values → conversion_keys.id) e histograma de leadscore (lead_scores/lead_qtys). Mantida pelos triggers ad_metrics_rollup_sync_ins/_upd; delete/mudança de chave propagam por FK. Reconstruível com ad_performance_rollup_rebuild(user_id). NÃO escrever aqui à mão.';

COMMENT ON COLUMN public.ad_performance_daily.hook_value IS
'coalesce(hook_rate, curva[3]/100 se >1) — a expressão da RPC v116, calculada na escrita (migration 129).';
COMMENT ON COLUMN public.ad_performance_daily.scroll_stop_value IS
'coalesce(scroll_stop_rate, curva[1]/100 se >1) — a expressão da RPC v116, calculada na escrita (migration 129).';

-- ============================================================================
-- 2. Derivação da linha completa (substitui a derive_row da 128)
-- ============================================================================

DROP FUNCTION IF EXISTS public.ad_performance_derive_row(jsonb, jsonb, numeric[]);

CREATE OR REPLACE FUNCTION public.ad_performance_curve_point(p_curve jsonb, p_idx integer)
RETURNS numeric
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path TO 'public'
AS $$
  -- Ponto p_idx da curva de retenção como fração (a RPC v116 divide por 100 quando o
  -- valor vem em percentual). 0 quando não há curva — inclusive curva NULL:
  -- jsonb_typeof(NULL) é NULL, e um NULL solto num WHERE devolveria zero linhas
  -- (= NULL na coluna NOT NULL). O teste da 128 pegou exatamente isso.
  select case
    when coalesce(jsonb_typeof(p_curve) = 'array' and jsonb_array_length(p_curve) > 0, false) then
      (select v / (case when v > 1 then 100.0 else 1.0 end)
       from (select coalesce(nullif(regexp_replace(coalesce(p_curve ->> least(p_idx, jsonb_array_length(p_curve) - 1), '0'), '[^0-9.-]', '', 'g'), ''), '0')::numeric as v) s)
    else 0::numeric
  end
$$;

CREATE OR REPLACE FUNCTION public.ad_performance_derive_row(am public.ad_metrics)
RETURNS TABLE (
  account_id text, campaign_id text, adset_id text, ad_name text,
  impressions bigint, clicks bigint, inline_link_clicks bigint, spend numeric, lpv bigint,
  plays bigint, thruplays bigint, video_watched_p50 numeric, video_watched_p75 numeric,
  hold_rate numeric, reach bigint, frequency numeric, hook_value numeric, scroll_stop_value numeric,
  conv_key_ids integer[], conv_values numeric[], lead_scores numeric[], lead_qtys integer[]
)
LANGUAGE sql STABLE PARALLEL SAFE
SET search_path TO 'public'
AS $$
  -- A linha derivada COMPLETA de uma linha de ad_metrics. Números saneados como a RPC
  -- v116 (coalesce 0, casts). Arrays na ordem canônica (por key_id / por score).
  -- Pressupõe que as chaves já existem no dicionário (o chamador garante).
  with c as (
    select ck.id, d.value
    from public.ad_performance_derive_conversions(am.actions, am.conversions) d
    join public.conversion_keys ck on ck.key = d.key
  ),
  l as (
    select score, qty from public.ad_performance_derive_leads(am.leadscore_values)
  )
  select
    am.account_id, am.campaign_id, am.adset_id, am.ad_name,
    coalesce(am.impressions, 0)::bigint,
    coalesce(am.clicks, 0)::bigint,
    coalesce(am.inline_link_clicks, 0)::bigint,
    coalesce(am.spend, 0)::numeric,
    coalesce(am.lpv, 0)::bigint,
    coalesce(am.video_total_plays, 0)::bigint,
    coalesce(am.video_total_thruplays, 0)::bigint,
    coalesce(am.video_watched_p50, 0)::numeric,
    coalesce(am.video_watched_p75, 0)::numeric,
    coalesce(am.hold_rate, 0)::numeric,
    coalesce(am.reach, 0)::bigint,
    coalesce(am.frequency, 0)::numeric,
    coalesce(am.hook_rate, public.ad_performance_curve_point(am.video_play_curve_actions, 3)),
    coalesce(am.scroll_stop_rate, public.ad_performance_curve_point(am.video_play_curve_actions, 1)),
    (select coalesce(array_agg(id    order by id), '{}') from c),
    (select coalesce(array_agg(value order by id), '{}') from c),
    (select coalesce(array_agg(score order by score), '{}') from l),
    (select coalesce(array_agg(qty   order by score), '{}') from l)
$$;

COMMENT ON FUNCTION public.ad_performance_derive_row(public.ad_metrics) IS
'Fonte única da linha de ad_performance_daily a partir de uma linha de ad_metrics (migration 129): chaves, números saneados como a RPC, arrays de conversões e histograma de leads. Trigger, rebuild e consistency_check usam esta função.';

-- ============================================================================
-- 3. Worker, rebuild e checagem: mesmas funções, linha completa
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ad_performance_rollup_apply(p_keys public.ad_metric_key[])
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF p_keys IS NULL OR cardinality(p_keys) = 0 THEN
    RETURN;
  END IF;

  DELETE FROM public.ad_performance_daily d
  USING unnest(p_keys) k
  WHERE d.user_id = k.user_id AND d.ad_id = k.ad_id AND d.date = k.date;

  INSERT INTO public.conversion_keys (key)
  SELECT DISTINCT c.key
  FROM unnest(p_keys) k
  JOIN public.ad_metrics am ON am.user_id = k.user_id AND am.ad_id = k.ad_id AND am.date = k.date
  CROSS JOIN LATERAL public.ad_performance_derive_conversions(am.actions, am.conversions) c
  ON CONFLICT (key) DO NOTHING;

  INSERT INTO public.ad_performance_daily (
    user_id, ad_id, date,
    account_id, campaign_id, adset_id, ad_name,
    impressions, clicks, inline_link_clicks, spend, lpv, plays, thruplays,
    video_watched_p50, video_watched_p75, hold_rate, reach, frequency, hook_value, scroll_stop_value,
    conv_key_ids, conv_values, lead_scores, lead_qtys
  )
  SELECT am.user_id, am.ad_id, am.date, r.*
  FROM unnest(p_keys) k
  JOIN public.ad_metrics am ON am.user_id = k.user_id AND am.ad_id = k.ad_id AND am.date = k.date
  CROSS JOIN LATERAL public.ad_performance_derive_row(am) r;
END;
$$;

-- UPDATE: recomputa só linhas cuja fonte (qualquer coluna que a derivação lê) mudou.
CREATE OR REPLACE FUNCTION public.ad_performance_rollup_sync_upd()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.ad_performance_rollup_apply(
    (SELECT array_agg(ROW(n.user_id, n.ad_id, n.date)::public.ad_metric_key)
     FROM new_rows n
     JOIN old_rows o ON o.id = n.id AND o.user_id = n.user_id
     WHERE ROW(n.actions, n.conversions, n.leadscore_values,
               n.account_id, n.campaign_id, n.adset_id, n.ad_name,
               n.impressions, n.clicks, n.inline_link_clicks, n.spend, n.lpv,
               n.video_total_plays, n.video_total_thruplays, n.video_watched_p50, n.video_watched_p75,
               n.hold_rate, n.reach, n.frequency, n.hook_rate, n.scroll_stop_rate, n.video_play_curve_actions)
        IS DISTINCT FROM
           ROW(o.actions, o.conversions, o.leadscore_values,
               o.account_id, o.campaign_id, o.adset_id, o.ad_name,
               o.impressions, o.clicks, o.inline_link_clicks, o.spend, o.lpv,
               o.video_total_plays, o.video_total_thruplays, o.video_watched_p50, o.video_watched_p75,
               o.hold_rate, o.reach, o.frequency, o.hook_rate, o.scroll_stop_rate, o.video_play_curve_actions))
  );
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.ad_performance_rollup_sync_upd() IS
'Trigger por STATEMENT (AFTER UPDATE, old_rows/new_rows) que recomputa ad_performance_daily só das linhas cuja fonte mudou — qualquer coluna que a derivação lê (migrations 128/129).';

CREATE OR REPLACE FUNCTION public.ad_performance_rollup_rebuild(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_t0   timestamptz := clock_timestamp();
  v_rows bigint;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Forbidden: p_user_id must match auth.uid()';
  END IF;

  DELETE FROM public.ad_performance_daily WHERE user_id = p_user_id;

  INSERT INTO public.conversion_keys (key)
  SELECT DISTINCT c.key
  FROM public.ad_metrics am
  CROSS JOIN LATERAL public.ad_performance_derive_conversions(am.actions, am.conversions) c
  WHERE am.user_id = p_user_id
  ON CONFLICT (key) DO NOTHING;

  INSERT INTO public.ad_performance_daily (
    user_id, ad_id, date,
    account_id, campaign_id, adset_id, ad_name,
    impressions, clicks, inline_link_clicks, spend, lpv, plays, thruplays,
    video_watched_p50, video_watched_p75, hold_rate, reach, frequency, hook_value, scroll_stop_value,
    conv_key_ids, conv_values, lead_scores, lead_qtys
  )
  SELECT am.user_id, am.ad_id, am.date, r.*
  FROM public.ad_metrics am
  CROSS JOIN LATERAL public.ad_performance_derive_row(am) r
  WHERE am.user_id = p_user_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  RETURN jsonb_build_object(
    'user_id', p_user_id,
    'rows', v_rows,
    'ms', round(extract(epoch from clock_timestamp() - v_t0) * 1000)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.ad_performance_rollup_consistency_check(p_user_id uuid DEFAULT NULL)
RETURNS TABLE (user_id uuid, missing bigint, extra bigint)
LANGUAGE sql STABLE
SET search_path TO 'public'
SET plan_cache_mode TO 'force_custom_plan'
AS $$
  with scope as (
    select distinct am.user_id
    from public.ad_metrics am
    where p_user_id is null or am.user_id = p_user_id
  ),
  expected as (
    select am.user_id, am.ad_id, am.date, r.*
    from public.ad_metrics am
    join scope s on s.user_id = am.user_id
    cross join lateral public.ad_performance_derive_row(am) r
  ),
  stored as (
    select d.user_id, d.ad_id, d.date,
           d.account_id, d.campaign_id, d.adset_id, d.ad_name,
           d.impressions, d.clicks, d.inline_link_clicks, d.spend, d.lpv, d.plays, d.thruplays,
           d.video_watched_p50, d.video_watched_p75, d.hold_rate, d.reach, d.frequency, d.hook_value, d.scroll_stop_value,
           d.conv_key_ids, d.conv_values, d.lead_scores, d.lead_qtys
    from public.ad_performance_daily d
    join scope s on s.user_id = d.user_id
  ),
  diffs as (
    select user_id, 1 as m, 0 as e from (table expected except all table stored) x
    union all
    select user_id, 0, 1 from (table stored except all table expected) x
  )
  select user_id, sum(m), sum(e)
  from diffs
  group by user_id
  order by user_id
$$;
