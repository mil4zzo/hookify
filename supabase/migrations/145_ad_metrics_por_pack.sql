-- 145: ad_metrics com o pack na chave.
--
-- ESTE E O TEMPLATE. A migration final (145_ad_metrics_por_pack.sql) e este
-- arquivo com os marcadores @@...@@ substituidos pelos corpos gerados a partir
-- do schema.sql pelos geradores em supabase/tests/port_*_para_pack.py — para
-- que 2.000 linhas de RPC nao sejam digitadas a mao. Edite AQUI, gere, valide
-- no lab (supabase/tests/lab_145_antes.sql / lab_145_depois.sql), commite os dois.
--
-- POR QUE
-- -------
-- Uma linha de ad_metrics era o anuncio-dia, compartilhada por todo pack que o
-- contivesse (ad_metric_pack_map dizia quem). Tudo que e escrito NA LINHA —
-- leadscore_values, custom_hist, e a propria metrica da Meta a cada refresh —
-- vazava entre packs: a planilha do pack A gravava leadscore que o pack B lia,
-- limpar A apagava B, e atualizar A deixava B com metade dos dias mais maduros
-- que a outra metade (a janela de atribuicao amadurece conversoes por dias).
-- delete_pack precisava classificar "linhas exclusivas" a mao e, quando falhava,
-- deixava orfas (12.598 em producao, todas fora do periodo de qualquer pack).
--
-- Agora cada linha pertence a UM pack: (user_id, pack_id, ad_id, date). Um
-- anuncio-dia em dois packs sao duas linhas. Producao nao tem nenhum hoje
-- (medido: 0 pares de packs do mesmo dono com anuncio-dia em comum), e a
-- selecao de packs sobrepostos passa a ser bloqueada (detect_pack_conflicts
-- perde a excecao "mesmo dono nunca conflita" — ela existia porque a linha era
-- a mesma; deixou de ser).
--
-- MEDIDO NO LAB COM O DUMP DE PRODUCAO (698.419 linhas) ANTES DE ESCREVER ISTO
-- --------------------------------------------------------------------------
--   linhas      -12.598 (as orfas); duplicacao = 0
--   indices     233 MB -> ~101 MB (desenho pelo uso real: pg_stat_user_indexes)
--   escrita     3-7x mais rapida (3 indices em vez de 8)
--   rollup      gatilho identico (o custo mora em derive_row, nao na chave)
--   Manager     1,59 s -> 1,38-1,41 s (JSON identico em 3 telas)
--   detalhe     ~70 ms -> ~68 ms por nome; 48 -> 69 ms por adset (o indice de
--               adset saiu; o prefixo do pack varre o pack e filtra em memoria)
--   Nao e uma jogada de performance de leitura. E de correcao e de escrita.
--
-- O MAPA (ad_metric_pack_map) FICA NESTA FASE
-- --------------------------------------------
-- Continua sendo escrito pelo refresh e lido por detect_pack_conflicts e por
-- leitores do backend (get_ads_for_pack, stats). Passa a ter FK para a chave
-- nova, e vira derivavel de ad_metrics.pack_id. Sai na fase 2, junto com o
-- indice de compatibilidade (id, user_id), quando nenhum consumidor casar por
-- `id` — hoje casam: batch_update_ad_metrics_enrichment e calculate_pack_stats.
--
-- ORDEM DE DEPLOY: esta migration ANTES do backend. O backend novo grava
-- pack_id na linha e faz upsert pela PK nova; o antigo faz upsert por
-- (id, user_id), que deixa de ser unico. Os dois nao coexistem.
--
-- TUDO NUMA TRANSACAO: se qualquer passo falhar, nada muda.

BEGIN;

-- ===========================================================================
-- 0. Gatilhos do rollup fora durante a migracao. O backfill escreve em massa e
--    o rollup e re-chaveado por backfill (secao 4), nao por gatilho. Voltam na
--    secao 6 ja com a chave nova.
-- ===========================================================================
DROP TRIGGER IF EXISTS ad_metrics_rollup_sync_ins ON public.ad_metrics;
DROP TRIGGER IF EXISTS ad_metrics_rollup_sync_upd ON public.ad_metrics;

-- Os 5 indices que vao embora saem ANTES do backfill, nao depois: o UPDATE da
-- secao 2 reescreve todas as ~700k linhas (coluna nova, pagina cheia = sem HOT),
-- e cada indice de pe e uma entrada a mais por linha reescrita. Medido no lab
-- com os 8 de pe: o backfill era a etapa mais longa da migration. Ficam, ate a
-- secao 3, so os que a secao 2 precisa: a PK, a UNIQUE (a FK antiga do rollup
-- aponta para ela — e o que cascateia as orfas em 2b) e ad_id_idx.
DROP INDEX IF EXISTS public.ad_metrics_ad_name_idx;
DROP INDEX IF EXISTS public.ad_metrics_user_adset_date_idx;
DROP INDEX IF EXISTS public.ad_metrics_user_campaign_date_idx;
DROP INDEX IF EXISTS public.ad_metrics_user_date_idx;
DROP INDEX IF EXISTS public.ad_metrics_user_name_date_ad_idx;

-- ===========================================================================
-- 1. A coluna.
-- ===========================================================================
ALTER TABLE public.ad_metrics ADD COLUMN pack_id uuid;

-- ===========================================================================
-- 2. Backfill a partir do mapa.
-- ===========================================================================
-- 2a. Filiacao principal de cada anuncio-dia: o menor pack_id (deterministico;
--     Postgres nao tem min(uuid), dai o array_agg ordenado).
UPDATE public.ad_metrics am
SET pack_id = m.pack_id
FROM (
  SELECT user_id, ad_id, metric_date, (array_agg(pack_id ORDER BY pack_id))[1] AS pack_id
  FROM public.ad_metric_pack_map
  GROUP BY 1, 2, 3
) m
WHERE m.user_id = am.user_id AND m.ad_id = am.ad_id AND m.metric_date = am.date;

-- 2b. Orfas: linha sem nenhum vinculo no mapa. Medido em producao: 12.598,
--     todas fora do periodo de qualquer pack vivo e sem escrita ha meses —
--     restos de delete_pack que falhou em silencio. A FK do rollup (ainda a
--     antiga, ON DELETE CASCADE) leva as linhas derivadas junto.
DELETE FROM public.ad_metrics WHERE pack_id IS NULL;

ALTER TABLE public.ad_metrics ALTER COLUMN pack_id SET NOT NULL;

-- ===========================================================================
-- 3. A chave.
-- ===========================================================================
-- 3a. Tudo que aponta para a chave antiga sai antes dela.
ALTER TABLE public.ad_performance_daily DROP CONSTRAINT IF EXISTS ad_performance_daily_metric_fk;
ALTER TABLE public.ad_metric_pack_map   DROP CONSTRAINT IF EXISTS ad_metric_pack_map_metric_fk;
ALTER TABLE public.ad_metrics           DROP CONSTRAINT IF EXISTS ad_metrics_user_ad_date_key;
ALTER TABLE public.ad_metrics           DROP CONSTRAINT IF EXISTS ad_metrics_pkey;

-- 3b. Filiacoes extras (anuncio-dia em N>1 packs): uma copia da linha por pack
--     a mais. jsonb_populate_record(linha, {pack_id}) copia a linha inteira
--     trocando so o pack — sem lista de 40 colunas para envelhecer. So possivel
--     depois de 3a (a UNIQUE antiga recusaria a copia). Producao: 0 hoje.
INSERT INTO public.ad_metrics
SELECT (jsonb_populate_record(am, jsonb_build_object('pack_id', apm.pack_id))).*
FROM public.ad_metric_pack_map apm
JOIN public.ad_metrics am
  ON am.user_id = apm.user_id AND am.ad_id = apm.ad_id AND am.date = apm.metric_date
WHERE apm.pack_id <> am.pack_id;

-- 3c. A PK nova e os indices desenhados pelo uso real (pg_stat_user_indexes de
--     producao, nunca resetadas): user_ad_date_key 11,6M usos e a pkey 6,7M
--     carregavam 99,9%; user_name_date_ad (99 MB) 445 usos; ad_name 1 uso;
--     adset 21; campaign 41. Agrupar por nome/adset/campanha acontece em
--     memoria dentro do pack ja selecionado pela PK.
ALTER TABLE public.ad_metrics ADD CONSTRAINT ad_metrics_pkey PRIMARY KEY (user_id, pack_id, ad_id, date);

-- Compatibilidade (fase 1): quem ainda casa por id = {data}-{ad_id}. Nao-unico.
CREATE INDEX ad_metrics_id_user_idx ON public.ad_metrics (id, user_id);
-- delete_pack por dia e janelas de data dentro do pack.
CREATE INDEX ad_metrics_user_pack_date_idx ON public.ad_metrics (user_id, pack_id, date);
-- ad_metrics_ad_id_idx fica (lookup por anuncio nas rotas de detalhe, 2.123 usos).
-- Os 5 indices mortos ja sairam na secao 0, antes do backfill.

-- ===========================================================================
-- 4. O read model (ad_performance_daily) segue a mesma chave.
-- ===========================================================================
ALTER TABLE public.ad_performance_daily ADD COLUMN pack_id uuid;

UPDATE public.ad_performance_daily d
SET pack_id = m.pack_id
FROM (
  SELECT user_id, ad_id, metric_date, (array_agg(pack_id ORDER BY pack_id))[1] AS pack_id
  FROM public.ad_metric_pack_map
  GROUP BY 1, 2, 3
) m
WHERE m.user_id = d.user_id AND m.ad_id = d.ad_id AND m.metric_date = d.date;

-- Linha derivada sem origem (nao deveria existir: a FK antiga cascateou 2b).
DELETE FROM public.ad_performance_daily WHERE pack_id IS NULL;
ALTER TABLE public.ad_performance_daily ALTER COLUMN pack_id SET NOT NULL;
ALTER TABLE public.ad_performance_daily DROP CONSTRAINT IF EXISTS ad_performance_daily_pkey;

INSERT INTO public.ad_performance_daily
SELECT (jsonb_populate_record(d, jsonb_build_object('pack_id', apm.pack_id))).*
FROM public.ad_metric_pack_map apm
JOIN public.ad_performance_daily d
  ON d.user_id = apm.user_id AND d.ad_id = apm.ad_id AND d.date = apm.metric_date
WHERE apm.pack_id <> d.pack_id;

ALTER TABLE public.ad_performance_daily
  ADD CONSTRAINT ad_performance_daily_pkey PRIMARY KEY (user_id, pack_id, ad_id, date);
ALTER TABLE public.ad_performance_daily
  ADD CONSTRAINT ad_performance_daily_metric_fk
  FOREIGN KEY (user_id, pack_id, ad_id, date)
  REFERENCES public.ad_metrics (user_id, pack_id, ad_id, date)
  ON UPDATE CASCADE ON DELETE CASCADE;

-- ===========================================================================
-- 5. O mapa aponta para a chave nova. Toda linha do mapa tem sua linha em
--    ad_metrics (2a deu o pack principal, 3b as copias) e vice-versa (2b).
-- ===========================================================================
ALTER TABLE public.ad_metric_pack_map
  ADD CONSTRAINT ad_metric_pack_map_metric_fk
  FOREIGN KEY (user_id, pack_id, ad_id, metric_date)
  REFERENCES public.ad_metrics (user_id, pack_id, ad_id, date)
  ON DELETE CASCADE;

-- Sem FK de ad_metrics para packs DE PROPOSITO: deletar um pack cascatearia
-- ~77k linhas x 3 tabelas numa unica instrucao, sob o statement_timeout do
-- PostgREST. delete_pack apaga por (pack, dia) em lotes, no backend.

-- ===========================================================================
-- 6. O rollup: tipo de chave, worker, gatilhos, rebuild.
-- ===========================================================================
-- O tipo tem o pack. DROP CASCADE derruba ad_performance_rollup_apply (a unica
-- funcao com o tipo na assinatura); os gatilhos ja sairam na secao 0.
DROP TYPE IF EXISTS public.ad_metric_key CASCADE;
CREATE TYPE public.ad_metric_key AS (
  user_id uuid,
  pack_id uuid,
  ad_id text,
  date date
);

CREATE FUNCTION public.ad_performance_rollup_apply(p_keys public.ad_metric_key[]) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF p_keys IS NULL OR cardinality(p_keys) = 0 THEN
    RETURN;
  END IF;

  DELETE FROM public.ad_performance_daily d
  USING unnest(p_keys) k
  WHERE d.user_id = k.user_id AND d.pack_id = k.pack_id AND d.ad_id = k.ad_id AND d.date = k.date;

  INSERT INTO public.conversion_keys (key)
  SELECT DISTINCT c.key
  FROM unnest(p_keys) k
  JOIN public.ad_metrics am
    ON am.user_id = k.user_id AND am.pack_id = k.pack_id AND am.ad_id = k.ad_id AND am.date = k.date
  CROSS JOIN LATERAL public.ad_performance_derive_conversions(am.actions, am.conversions) c
  ON CONFLICT (key) DO NOTHING;

  INSERT INTO public.ad_performance_daily (
    user_id, pack_id, ad_id, date,
    account_id, campaign_id, adset_id, ad_name,
    impressions, clicks, inline_link_clicks, spend, lpv, plays, thruplays,
    video_watched_p50, video_watched_p75, hold_rate, reach, frequency, hook_value, scroll_stop_value,
    conv_key_ids, conv_values, lead_scores, lead_qtys, custom_hist
  )
  SELECT am.user_id, am.pack_id, am.ad_id, am.date, r.*
  FROM unnest(p_keys) k
  JOIN public.ad_metrics am
    ON am.user_id = k.user_id AND am.pack_id = k.pack_id AND am.ad_id = k.ad_id AND am.date = k.date
  CROSS JOIN LATERAL public.ad_performance_derive_row(am) r;
END;
$$;
ALTER FUNCTION public.ad_performance_rollup_apply(public.ad_metric_key[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.ad_performance_rollup_apply(public.ad_metric_key[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.ad_performance_rollup_apply(public.ad_metric_key[]) TO anon;
GRANT ALL ON FUNCTION public.ad_performance_rollup_apply(public.ad_metric_key[]) TO authenticated;
GRANT ALL ON FUNCTION public.ad_performance_rollup_apply(public.ad_metric_key[]) TO service_role;
COMMENT ON FUNCTION public.ad_performance_rollup_apply(public.ad_metric_key[]) IS
  'Worker do rollup (128; chave com pack desde a 145): apaga e recompoe as linhas de ad_performance_daily das chaves (user, pack, anuncio, dia) a partir de ad_metrics. derive_row nao muda: recebe a linha de ad_metrics e le campos por nome.';

CREATE OR REPLACE FUNCTION public.ad_performance_rollup_sync_ins() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  PERFORM public.ad_performance_rollup_apply(
    (SELECT array_agg(ROW(n.user_id, n.pack_id, n.ad_id, n.date)::public.ad_metric_key) FROM new_rows n)
  );
  RETURN NULL;
END;
$$;

-- Linha velha casa com a nova pela PK de 4 colunas. Antes casava por (id, user_id):
-- com o mesmo anuncio-dia em dois packs, isso cruzaria 2x2 e recomporia o pack
-- errado. Mudanca de chave (pack/anuncio/dia) propaga pela FK ON UPDATE CASCADE.
CREATE OR REPLACE FUNCTION public.ad_performance_rollup_sync_upd() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  PERFORM public.ad_performance_rollup_apply(
    (SELECT array_agg(ROW(n.user_id, n.pack_id, n.ad_id, n.date)::public.ad_metric_key)
     FROM new_rows n
     JOIN old_rows o
       ON o.user_id = n.user_id AND o.pack_id = n.pack_id AND o.ad_id = n.ad_id AND o.date = n.date
     WHERE ROW(n.actions, n.conversions, n.leadscore_values, n.custom_hist,
               n.account_id, n.campaign_id, n.adset_id, n.ad_name,
               n.impressions, n.clicks, n.inline_link_clicks, n.spend, n.lpv,
               n.video_total_plays, n.video_total_thruplays, n.video_watched_p50, n.video_watched_p75,
               n.hold_rate, n.reach, n.frequency, n.hook_rate, n.scroll_stop_rate, n.video_play_curve_actions)
        IS DISTINCT FROM
           ROW(o.actions, o.conversions, o.leadscore_values, o.custom_hist,
               o.account_id, o.campaign_id, o.adset_id, o.ad_name,
               o.impressions, o.clicks, o.inline_link_clicks, o.spend, o.lpv,
               o.video_total_plays, o.video_total_thruplays, o.video_watched_p50, o.video_watched_p75,
               o.hold_rate, o.reach, o.frequency, o.hook_rate, o.scroll_stop_rate, o.video_play_curve_actions))
  );
  RETURN NULL;
END;
$$;

CREATE TRIGGER ad_metrics_rollup_sync_ins
  AFTER INSERT ON public.ad_metrics
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.ad_performance_rollup_sync_ins();
CREATE TRIGGER ad_metrics_rollup_sync_upd
  AFTER UPDATE ON public.ad_metrics
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.ad_performance_rollup_sync_upd();

CREATE OR REPLACE FUNCTION public.ad_performance_rollup_rebuild(p_user_id uuid) RETURNS jsonb
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
    user_id, pack_id, ad_id, date,
    account_id, campaign_id, adset_id, ad_name,
    impressions, clicks, inline_link_clicks, spend, lpv, plays, thruplays,
    video_watched_p50, video_watched_p75, hold_rate, reach, frequency, hook_value, scroll_stop_value,
    conv_key_ids, conv_values, lead_scores, lead_qtys, custom_hist
  )
  SELECT am.user_id, am.pack_id, am.ad_id, am.date, r.*
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

COMMENT ON TABLE public.ad_performance_daily IS
  'READ MODEL do anuncio-dia POR PACK (145): uma linha por (user, pack, anuncio, dia), derivada de ad_metrics pelos gatilhos ad_metrics_rollup_sync_ins/_upd; delete/mudanca de chave propagam por FK. Reconstruivel com ad_performance_rollup_rebuild(user_id). NAO escrever aqui a mao.';

-- A verificacao de consistencia compara linha a linha esperado x guardado. O pack
-- entra nas duas projecoes: sem ele, duas copias do mesmo anuncio-dia em packs
-- diferentes seriam indistinguiveis e uma divergencia ficaria atribuida ao pack errado.
CREATE OR REPLACE FUNCTION public.ad_performance_rollup_consistency_check(p_user_id uuid DEFAULT NULL::uuid) RETURNS TABLE(user_id uuid, missing bigint, extra bigint)
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
    select am.user_id, am.pack_id, am.ad_id, am.date, r.*
    from public.ad_metrics am
    join scope s on s.user_id = am.user_id
    cross join lateral public.ad_performance_derive_row(am) r
  ),
  stored as (
    select d.user_id, d.pack_id, d.ad_id, d.date,
           d.account_id, d.campaign_id, d.adset_id, d.ad_name,
           d.impressions, d.clicks, d.inline_link_clicks, d.spend, d.lpv, d.plays, d.thruplays,
           d.video_watched_p50, d.video_watched_p75, d.hold_rate, d.reach, d.frequency, d.hook_value, d.scroll_stop_value,
           d.conv_key_ids, d.conv_values, d.lead_scores, d.lead_qtys, d.custom_hist
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

-- ===========================================================================
-- 7. A planilha (leadscore) escreve na linha do pack — nao vaza mais.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.batch_update_ad_metrics_enrichment(p_user_id uuid, p_updates jsonb, p_pack_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    SET plan_cache_mode TO 'force_custom_plan'
    AS $$
DECLARE
  total_rows_updated int := 0;
  total_ids_sent     int := 0;
  existing_count     int := 0;
  in_pack_count      int := 0;
  all_ids            text[];
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Forbidden: p_user_id must match auth.uid()';
  END IF;

  SELECT array_agg(id_val)
  INTO all_ids
  FROM jsonb_array_elements(p_updates) AS item,
  LATERAL jsonb_array_elements_text(item->'ids') AS id_val;

  total_ids_sent := coalesce(array_length(all_ids, 1), 0);

  WITH expanded AS (
    SELECT
      id_val AS id,
      CASE
        WHEN item ? 'leadscore_values'
          AND item->'leadscore_values' IS NOT NULL
          AND item->'leadscore_values' != 'null'::jsonb
          AND jsonb_array_length(item->'leadscore_values') > 0
        THEN ARRAY(
          SELECT v::numeric
          FROM jsonb_array_elements(item->'leadscore_values') AS v
        )
        ELSE NULL
      END AS leadscore_vals,
      (item ? 'custom_hist' AND jsonb_typeof(item->'custom_hist') = 'object') AS has_custom,
      CASE
        WHEN item ? 'custom_hist' AND jsonb_typeof(item->'custom_hist') = 'object'
        THEN nullif(item->'custom_hist', '{}'::jsonb)
        ELSE NULL
      END AS custom_hist_val
    FROM jsonb_array_elements(p_updates) AS item,
    LATERAL jsonb_array_elements_text(item->'ids') AS id_val
  )
  -- `id` ({data}-{ad_id}) deixou de ser unico: o mesmo anuncio-dia pode existir
  -- em outro pack. O filtro por pack e o que garante que a planilha do pack A
  -- escreve so na linha do pack A. Sem pack (integracao antiga) escreve em
  -- todas as copias, como sempre escreveu na linha unica.
  UPDATE public.ad_metrics am
  SET
    leadscore_values = CASE
      WHEN e.leadscore_vals IS NOT NULL THEN e.leadscore_vals
      ELSE am.leadscore_values
    END,
    custom_hist = CASE
      WHEN e.has_custom THEN e.custom_hist_val
      ELSE am.custom_hist
    END,
    updated_at = now()
  FROM expanded e
  WHERE am.id = e.id
    AND am.user_id = p_user_id
    AND (p_pack_id IS NULL OR am.pack_id = p_pack_id);
  GET DIAGNOSTICS total_rows_updated = ROW_COUNT;

  IF total_ids_sent > 0 THEN
    -- DISTINCT id: com copias por pack, contar linhas contaria o mesmo id 2x.
    SELECT
      count(DISTINCT am_diag.id)::int,
      count(DISTINCT am_diag.id) FILTER (WHERE p_pack_id IS NULL OR am_diag.pack_id = p_pack_id)::int
    INTO existing_count, in_pack_count
    FROM public.ad_metrics am_diag
    WHERE am_diag.user_id = p_user_id AND am_diag.id = ANY(all_ids);
  END IF;

  RETURN jsonb_build_object(
    'total_groups_processed', jsonb_array_length(p_updates),
    'total_rows_updated',     total_rows_updated,
    'total_ids_sent',         total_ids_sent,
    'ids_not_found_count',    greatest(0, total_ids_sent - existing_count),
    'ids_out_of_pack_count',  greatest(0, existing_count - in_pack_count),
    'status',                 'success'
  );
EXCEPTION
  WHEN OTHERS THEN
    IF SQLERRM LIKE 'Forbidden: p_user_id%' THEN RAISE; END IF;
    RETURN jsonb_build_object(
      'status',                 'error',
      'error_message',          SQLERRM,
      'total_groups_processed', jsonb_array_length(p_updates),
      'total_rows_updated',     total_rows_updated,
      'total_ids_sent',         total_ids_sent,
      'ids_not_found_count',    0,
      'ids_out_of_pack_count',  0
    );
END;
$$;
COMMENT ON FUNCTION public.batch_update_ad_metrics_enrichment(uuid, jsonb, uuid) IS
  'Atualiza leadscore_values e custom_hist de ad_metrics em lote (planilha). Desde a 145 escreve na LINHA DO PACK (am.pack_id = p_pack_id): a planilha do pack A nao toca o pack B. Sem p_pack_id, todas as copias do id.';

-- ===========================================================================
-- 8. Limpar o leadscore importado (144) — agora sem vazar para o vizinho.
-- ===========================================================================
DROP FUNCTION IF EXISTS public.clear_ad_metrics_enrichment(uuid, uuid, boolean);
DROP FUNCTION IF EXISTS public.ad_metrics_enrichment_targets(uuid, uuid);

CREATE FUNCTION public.ad_metrics_enrichment_targets(p_user_id uuid, p_pack_id uuid)
RETURNS TABLE (id text, ad_id text, metric_date date, has_leadscore boolean, has_custom boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  -- Direto pela PK: as linhas do pack SAO as linhas a limpar.
  SELECT am.id, am.ad_id, am.date, am.leadscore_values IS NOT NULL, am.custom_hist IS NOT NULL
  FROM public.ad_metrics am
  WHERE am.user_id = p_user_id AND am.pack_id = p_pack_id
    AND (am.leadscore_values IS NOT NULL OR am.custom_hist IS NOT NULL);
$$;
ALTER FUNCTION public.ad_metrics_enrichment_targets(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.ad_metrics_enrichment_targets(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ad_metrics_enrichment_targets(uuid, uuid) TO authenticated, service_role;

CREATE FUNCTION public.clear_ad_metrics_enrichment(p_user_id uuid, p_pack_id uuid, p_dry_run boolean DEFAULT true) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET plan_cache_mode TO 'force_custom_plan' AS $$
DECLARE
  v_leadscore_rows int := 0;
  v_custom_rows    int := 0;
  v_total_rows     int := 0;
  v_cleared        int := 0;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Forbidden: p_user_id must match auth.uid()';
  END IF;
  IF p_pack_id IS NULL THEN
    RAISE EXCEPTION 'clear_ad_metrics_enrichment exige p_pack_id: sem pack o predicado pegaria o silo inteiro';
  END IF;

  SELECT count(*)::int, count(*) FILTER (WHERE t.has_leadscore)::int, count(*) FILTER (WHERE t.has_custom)::int
  INTO v_total_rows, v_leadscore_rows, v_custom_rows
  FROM public.ad_metrics_enrichment_targets(p_user_id, p_pack_id) t;

  IF NOT p_dry_run AND v_total_rows > 0 THEN
    -- Pelo pack, nao por `id IN (...)`: o id deixou de ser unico e apagaria a
    -- copia de outro pack.
    UPDATE public.ad_metrics am
    SET leadscore_values = NULL, custom_hist = NULL, updated_at = now()
    WHERE am.user_id = p_user_id AND am.pack_id = p_pack_id
      AND (am.leadscore_values IS NOT NULL OR am.custom_hist IS NOT NULL);
    GET DIAGNOSTICS v_cleared = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'status', 'success',
    'dry_run', p_dry_run,
    'rows_matched', v_total_rows,
    'rows_with_leadscore', v_leadscore_rows,
    'rows_with_custom', v_custom_rows,
    'rows_cleared', v_cleared,
    -- Desde a 145 a linha e do pack: limpar A nunca alcanca B. Campos mantidos
    -- pelo contrato do frontend, sempre zero.
    'rows_shared_with_other_packs', 0,
    'other_packs_affected', 0
  );
END;
$$;
ALTER FUNCTION public.clear_ad_metrics_enrichment(uuid, uuid, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.clear_ad_metrics_enrichment(uuid, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.clear_ad_metrics_enrichment(uuid, uuid, boolean) TO authenticated, service_role;
COMMENT ON FUNCTION public.clear_ad_metrics_enrichment(uuid, uuid, boolean) IS
  'Apaga leadscore_values e custom_hist das linhas de ad_metrics de UM pack. p_dry_run=true so conta. Desde a 145 a linha pertence ao pack: nao ha compartilhamento a avisar.';

-- ===========================================================================
-- 9. Conflito de selecao: qualquer par de packs que compartilhe anuncio-dia,
--    mesmo dono incluido. A excecao "mesmo dono nunca conflita" existia porque
--    os dois liam a MESMA linha fisica; agora sao duas linhas e somar duplica.
--    Pre-filtro barato antes do EXISTS caro: um anuncio pertence a uma conta,
--    e dois packs so se cruzam se as janelas se cruzam (649 pares -> 53; 538 ms
--    -> 40 ms no lab).
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.detect_pack_conflicts(p_pack_ids uuid[], p_actor_id uuid) RETURNS TABLE(pack_a uuid, pack_b uuid)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with acc as (
    select a.pack_id, a.owner_id, p.adaccount_id, p.date_start, p.date_stop
    from public.resolve_pack_access(p_pack_ids, p_actor_id) a
    join public.packs p on p.id = a.pack_id
  )
  select a.pack_id as pack_a, b.pack_id as pack_b
  from acc a
  join acc b
    on a.pack_id < b.pack_id
   and a.adaccount_id is not distinct from b.adaccount_id
   and a.date_start <= b.date_stop
   and a.date_stop  >= b.date_start
  where exists (
    select 1
    from public.ad_metric_pack_map ma
    join public.ad_metric_pack_map mb
      on mb.user_id = b.owner_id
     and mb.pack_id = b.pack_id
     and mb.metric_date = ma.metric_date
     and mb.ad_id = ma.ad_id
    where ma.user_id = a.owner_id
      and ma.pack_id = a.pack_id
  );
$$;
COMMENT ON FUNCTION public.detect_pack_conflicts(uuid[], uuid) IS
  'Pares de packs acessiveis ao ator que compartilham ao menos um (ad_id, dia) — qualquer dono, desde a 145 (a linha de ad_metrics e do pack). Pre-filtro por conta e janela antes do EXISTS no mapa. Alimenta o bloqueio de selecao (camada 1).';

-- ===========================================================================
-- 10. As RPCs de leitura vivas, portadas (corpos gerados; ver template).
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.fetch_manager_performance_base_v145(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text DEFAULT 'ad_name'::text, p_pack_ids uuid[] DEFAULT NULL::uuid[], p_account_ids text[] DEFAULT NULL::text[], p_campaign_name_contains text DEFAULT NULL::text, p_adset_name_contains text DEFAULT NULL::text, p_ad_name_contains text DEFAULT NULL::text, p_action_type text DEFAULT NULL::text, p_include_leadscore boolean DEFAULT true, p_include_available_conversion_types boolean DEFAULT true, p_limit integer DEFAULT 500, p_offset integer DEFAULT 0, p_order_by text DEFAULT 'spend'::text, p_campaign_id text DEFAULT NULL::text, p_include_custom boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    SET plan_cache_mode TO 'force_custom_plan'
    SET work_mem TO '32MB'
    AS $$
declare
  v_group_by text := lower(coalesce(p_group_by, 'ad_name'));
  v_order_by text := lower(coalesce(p_order_by, 'spend'));
  v_date_start date := least(p_date_start, p_date_stop);
  v_date_stop date := greatest(p_date_start, p_date_stop);
  v_limit integer := greatest(1, least(coalesce(p_limit, 500), 10000));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
  v_selected_key text := trim(coalesce(p_action_type, ''));
  v_key_id integer := null;
  v_include_conv_types boolean := coalesce(p_include_available_conversion_types, true);
  v_include_leads boolean := coalesce(p_include_leadscore, true);
  -- 140: histogramas das colunas vinculadas so quando pedidos (opt-in).
  v_include_custom boolean := coalesce(p_include_custom, false);
  v_result jsonb;
  v_owners uuid[];
  v_requested integer;
  -- universo de packs para a máscara: a seleção pedida, ou (ramo legado) todos os
  -- packs do ator. Posição i do array ↔ bit i-1 da máscara.
  v_pack_universe uuid[];
  v_n_packs integer;
begin
  if auth.uid() is distinct from p_user_id then
    raise exception 'Forbidden: p_user_id must match auth.uid()'
      using errcode = '42501';
  end if;

  if p_pack_ids is null then
    v_owners := array[p_user_id];
    select coalesce(array_agg(id order by id), array[]::uuid[])
      into v_pack_universe
    from public.packs where user_id = p_user_id;
  else
    select array_agg(distinct a.owner_id), count(distinct a.pack_id)
      into v_owners, v_requested
    from public.resolve_pack_access(p_pack_ids, p_user_id) a;
    if coalesce(v_requested, 0) < (select count(distinct x) from unnest(p_pack_ids) x) then
      raise exception 'Forbidden: pack inacessivel na selecao'
        using errcode = '42501';
    end if;
    if v_owners is null or array_length(v_owners, 1) is null then
      v_owners := array[p_user_id];
    end if;
    select array_agg(distinct x order by x) into v_pack_universe from unnest(p_pack_ids) x;
  end if;
  v_n_packs := greatest(1, coalesce(cardinality(v_pack_universe), 0));

  if v_group_by not in ('ad_id', 'ad_name', 'adset_id', 'campaign_id') then
    raise exception 'Invalid p_group_by: %, expected ad_id|ad_name|adset_id|campaign_id', v_group_by
      using errcode = '22023';
  end if;

  -- Normalização da chave pedida, idêntica à v116 (sem prefixo = 'conversion:').
  if v_selected_key <> '' and v_selected_key not like 'conversion:%' and v_selected_key not like 'action:%' then
    v_selected_key := 'conversion:' || v_selected_key;
  end if;
  if v_selected_key <> '' then
    -- Chave nunca vista no dicionário = nenhum anúncio tem esse evento → resultados 0,
    -- exatamente como a v116 (nenhum elemento casava).
    select id into v_key_id from public.conversion_keys where key = v_selected_key;
  end if;

  with
  -- 1. A seleção, resolvida no MAPA (índice composto user/pack/date/ad; ~40 B por linha).
  --    GROUP BY (ad_id, dia) faz de uma vez: (a) dedup cross-silo com a MESMA preferência
  --    da v116 — vence o dono do pack compartilhado, o ator perde, desempate por uuid;
  --    (b) dedup de sobreposição entre packs do mesmo dono; (c) sinal de conflito
  --    cross-silo (min <> max do dono); (d) máscara dos packs de origem (bit por pack).
  keys as (
    select
      apm.ad_id,
      apm.date as date,
      apm.user_id,
      false as x_cross_silo,
      set_bit(repeat('0', v_n_packs)::varbit, array_position(v_pack_universe, apm.pack_id) - 1, 1) as pack_mask,
      apm.pack_id
    from unnest(v_owners) as o(owner_id)
    join public.ad_performance_daily apm
      on apm.user_id = o.owner_id
     and apm.pack_id = any(p_pack_ids)
     and apm.date >= v_date_start
     and apm.date <= v_date_stop
    where p_pack_ids is not null

    union all

    -- Ramo legado (sem packs): o silo do ator no período; packs de origem por lookup.
    select
      am.ad_id,
      am.date,
      p_user_id as user_id,
      false as x_cross_silo,
      coalesce(bit_or(set_bit(repeat('0', v_n_packs)::varbit, array_position(v_pack_universe, am.pack_id) - 1, 1)), repeat('0', v_n_packs)::varbit) as pack_mask,
      -- Postgres nao tem min(uuid): "um pack qualquer, deterministico" via array_agg ordenado.
      (array_agg(am.pack_id order by am.pack_id))[1] as pack_id
    from public.ad_performance_daily am
    where p_pack_ids is null
      and am.user_id = p_user_id
      and am.date >= v_date_start
      and am.date <= v_date_stop
    group by am.ad_id, am.date
  ),
  -- 2. As linhas: SÓ o read model (ad_performance_daily, migration 129), pela chave
  --    única. ad_metrics não entra aqui — entra só para a linha representante (fim) e
  --    para filtros por nome de campanha/conjunto (EXISTS abaixo, podado quando o
  --    filtro está vazio: o predicado é constante sob force_custom_plan).
  sel as (
    select
      k.user_id,
      k.ad_id,
      k.date,
      k.pack_mask,
      k.pack_id,
      case
        when v_group_by = 'ad_id' then d.ad_id
        when v_group_by = 'ad_name' then coalesce(nullif(d.ad_name, ''), d.ad_id)
        when v_group_by = 'adset_id' then d.adset_id
        when v_group_by = 'campaign_id' then d.campaign_id
        else d.ad_id
      end as group_key,
      -- Só o que a agregação consome. Nomes de campanha/conjunto NÃO viajam por
      -- linha: saem da linha REPRESENTANTE no fim (77 lookups em ad_metrics).
      d.account_id,
      d.adset_id,
      d.campaign_id,
      d.impressions,
      d.clicks,
      d.inline_link_clicks,
      d.spend,
      d.lpv,
      d.plays,
      d.thruplays,
      d.video_watched_p50,
      d.video_watched_p75,
      d.hold_rate,
      d.reach,
      d.frequency,
      d.hook_value,
      d.scroll_stop_value,
      -- conversão pedida por posição no array (leads: CTE próprio, leads_by_group)
      coalesce(d.conv_values[array_position(d.conv_key_ids, v_key_id)], 0)::numeric as results
    from keys k
    join public.ad_performance_daily d on d.user_id = k.user_id and d.pack_id = k.pack_id and d.ad_id = k.ad_id and d.date = k.date
    where (p_account_ids is null or d.account_id = any(p_account_ids))
      and (p_ad_name_contains is null or p_ad_name_contains = ''
           or coalesce(d.ad_name, '') ilike '%' || p_ad_name_contains || '%')
      and (
        (coalesce(p_campaign_name_contains, '') = '' and coalesce(p_adset_name_contains, '') = '')
        or exists (
          select 1 from public.ad_metrics am where am.user_id = k.user_id and am.pack_id = k.pack_id and am.ad_id = k.ad_id and am.date = k.date
            and (coalesce(p_campaign_name_contains, '') = ''
                 or coalesce(am.campaign_name, '') ilike '%' || p_campaign_name_contains || '%')
            and (coalesce(p_adset_name_contains, '') = ''
                 or coalesce(am.adset_name, '') ilike '%' || p_adset_name_contains || '%')
        )
      )
  ),
  -- `coalesce(x,'') <> ''` e não `nullif(x,'') is not null`: mesma semântica, mas o
  -- planner dá seletividade ~1 ao `<>` e 0,005 ao `is not null` sobre expressão —
  -- com 0,005 ele estimava 1 linha aqui e escolhia agregação por ordenação (spill).
  filtered as (
    select * from sel where coalesce(group_key, '') <> ''
  ),
  -- 3. Anúncio-dia → anúncio (por silo). Só agregados de estado constante.
  per_ad as (
    select
      f.group_key,
      f.user_id,
      f.ad_id,
      sum(f.impressions)::bigint as impressions,
      sum(f.clicks)::bigint as clicks,
      sum(f.inline_link_clicks)::bigint as inline_link_clicks,
      sum(f.spend)::numeric as spend,
      sum(f.lpv)::bigint as lpv,
      sum(f.plays)::bigint as plays,
      sum(f.thruplays)::bigint as thruplays,
      sum(f.hook_value * f.plays)::numeric as hook_wsum,
      sum(f.hold_rate * f.plays)::numeric as hold_rate_wsum,
      sum(f.video_watched_p50 * f.plays)::numeric as video_watched_p50_wsum,
      sum(f.video_watched_p75 * f.plays)::numeric as video_watched_p75_wsum,
      sum(f.scroll_stop_value * f.plays)::numeric as scroll_stop_wsum,
      sum(f.reach)::bigint as reach,
      sum(f.frequency * f.impressions)::numeric as frequency_wsum,
      sum(f.results)::numeric as results,
      -- um anúncio pertence a UMA conta e a UM conjunto: min() é exato
      min(nullif(f.account_id, '')) as account_id,
      min(nullif(f.adset_id, '')) as adset_id,
      min(nullif(f.campaign_id, '')) as campaign_id,
      bit_or(f.pack_mask) as pack_mask,
      -- dia representante deste anúncio: max impressões (desempate: dia mais recente)
      max((lpad(f.impressions::text, 12, '0') || e'\x1f' || f.date::text) collate "C") as rep_enc
    from filtered f
    group by f.group_key, f.user_id, f.ad_id
  ),
  -- 4. Um lookup em `ads` por anúncio (índice de cobertura ads_user_ad_status_idx).
  per_ad_status as (
    select
      pa.*,
      a.effective_status,
      a.meta_created_time,
      a.thumb_storage_path
    from per_ad pa
    left join public.ads a
      on a.user_id = pa.user_id
     and a.ad_id = pa.ad_id
  ),
  -- 5. Anúncio → grupo.
  grp as (
    select
      p.group_key,
      sum(p.impressions)::bigint as impressions,
      sum(p.clicks)::bigint as clicks,
      sum(p.inline_link_clicks)::bigint as inline_link_clicks,
      sum(p.spend)::numeric as spend,
      sum(p.lpv)::bigint as lpv,
      sum(p.plays)::bigint as plays,
      sum(p.thruplays)::bigint as thruplays,
      sum(p.hook_wsum)::numeric as hook_wsum,
      sum(p.hold_rate_wsum)::numeric as hold_rate_wsum,
      sum(p.video_watched_p50_wsum)::numeric as video_watched_p50_wsum,
      sum(p.video_watched_p75_wsum)::numeric as video_watched_p75_wsum,
      sum(p.scroll_stop_wsum)::numeric as scroll_stop_wsum,
      sum(p.reach)::bigint as reach,
      sum(p.frequency_wsum)::numeric as frequency_wsum,
      sum(p.results)::numeric as results,
      count(distinct p.ad_id)::integer as ad_id_count,
      count(distinct p.adset_id)::integer as adset_count,
      coalesce(array_agg(distinct p.account_id) filter (where p.account_id is not null), array[]::text[]) as account_ids,
      -- v136/137: TODAS as campanhas e conjuntos do grupo, nao a do representante.
      -- Mesma passada do account_ids: mesmo group by, nenhuma leitura nova.
      coalesce(array_agg(distinct p.campaign_id) filter (where p.campaign_id is not null), array[]::text[]) as campaign_ids,
      coalesce(array_agg(distinct p.adset_id) filter (where p.adset_id is not null), array[]::text[]) as adset_ids,
      bit_or(p.pack_mask) as pack_mask,
      -- representante do grupo = (impressões do dia rep, ad_id) máximos — a ordem
      -- (impressions desc, ad_id desc) da v116; user_id e os campos vão de carona.
      max((substr(p.rep_enc, 1, 12) || e'\x1f' || p.ad_id || e'\x1f' || p.user_id::text
           || e'\x1f' || p.rep_enc) collate "C") as rep_enc,
      bool_or(upper(coalesce(p.effective_status, '')) = 'ACTIVE') as has_active,
      count(distinct p.ad_id) filter (where upper(coalesce(p.effective_status, '')) = 'ACTIVE')::integer as active_count,
      -- v138: por que o grupo esta parado. `fallback_status` (o min alfabetico logo
      -- abaixo) responde "algum anuncio esta assim, e foi o primeiro do alfabeto" -
      -- por isso um criativo com um anuncio arquivado aparece como ARCHIVED. Contar
      -- permite a pergunta certa: TODOS estao pausados pelo mesmo motivo?
      -- Mesma passada e mesmo group by do active_count: nenhuma leitura nova.
      count(distinct p.ad_id) filter (where upper(coalesce(p.effective_status, '')) = 'PAUSED')::integer as paused_self_count,
      count(distinct p.ad_id) filter (where upper(coalesce(p.effective_status, '')) = 'ADSET_PAUSED')::integer as adset_paused_count,
      count(distinct p.ad_id) filter (where upper(coalesce(p.effective_status, '')) = 'CAMPAIGN_PAUSED')::integer as campaign_paused_count,
      min(p.effective_status) filter (where nullif(p.effective_status, '') is not null) as fallback_status,
      min(p.meta_created_time) as meta_created_min,
      -- fallback de miniatura: qualquer anúncio do grupo com arquivo no Storage
      -- (medido: 13 de 3.451 criativos têm o representante sem e uma cópia com)
      max(p.thumb_storage_path) filter (where nullif(p.thumb_storage_path, '') is not null) as any_thumb_storage_path
    from per_ad_status p
    group by p.group_key
  ),
  -- Leads: CTE próprio e ESTREITO. Só 23% dos anúncio-dias têm leads; parte do
  -- rollup (sem JSON), busca em ad_metrics só o necessário para o group_key e os
  -- filtros, e soma o histograma por (grupo, score). Fora da passada principal
  -- para não carregar JSON por duas camadas de agregação. MATERIALIZED: referenciado
  -- uma vez, o planner o inlinaria como lado interno de um nested loop e o
  -- recalcularia por grupo (medido: 397 execuções, 4,4 s).
  leads_by_group as materialized (
    select
      x.group_key,
      jsonb_object_agg(trim_scale(x.score)::text, x.qty order by x.score) as leadscore_histogram
    from (
      select
        case
          when v_group_by = 'ad_id' then d.ad_id
          when v_group_by = 'ad_name' then coalesce(nullif(d.ad_name, ''), d.ad_id)
          when v_group_by = 'adset_id' then d.adset_id
          when v_group_by = 'campaign_id' then d.campaign_id
          else d.ad_id
        end as group_key,
        s.score,
        sum(s.qty)::integer as qty
      from keys k
      join public.ad_performance_daily d on d.user_id = k.user_id and d.pack_id = k.pack_id and d.ad_id = k.ad_id and d.date = k.date
      cross join lateral unnest(d.lead_scores, d.lead_qtys) as s(score, qty)
      where v_include_leads
        and cardinality(d.lead_scores) > 0
        and (p_account_ids is null or d.account_id = any(p_account_ids))
        and (p_ad_name_contains is null or p_ad_name_contains = ''
             or coalesce(d.ad_name, '') ilike '%' || p_ad_name_contains || '%')
        and (
          (coalesce(p_campaign_name_contains, '') = '' and coalesce(p_adset_name_contains, '') = '')
          or exists (
            select 1 from public.ad_metrics am where am.user_id = k.user_id and am.pack_id = k.pack_id and am.ad_id = k.ad_id and am.date = k.date
              and (coalesce(p_campaign_name_contains, '') = ''
                   or coalesce(am.campaign_name, '') ilike '%' || p_campaign_name_contains || '%')
              and (coalesce(p_adset_name_contains, '') = ''
                   or coalesce(am.adset_name, '') ilike '%' || p_adset_name_contains || '%')
          )
        )
      group by 1, s.score
    ) x
    where coalesce(x.group_key, '') <> ''
    group by x.group_key
  ),
  -- 140: histogramas das colunas vinculadas, somados por (grupo, vinculo, valor).
  -- Mesma forma do leads_by_group: CTE estreito, MATERIALIZED, mesmos filtros, e
  -- opt-in por p_include_custom. Quem nao vincula coluna nenhuma tem a coluna nula
  -- e o frontend nem pede: custo zero fora do caso de uso.
  custom_by_group as materialized (
    select
      y.group_key,
      jsonb_object_agg(y.mapping_id, y.hist) as custom_histograms
    from (
      select x.group_key, x.mapping_id, jsonb_object_agg(x.val, x.qty) as hist
      from (
        select
          case
            when v_group_by = 'ad_id' then d.ad_id
            when v_group_by = 'ad_name' then coalesce(nullif(d.ad_name, ''), d.ad_id)
            when v_group_by = 'adset_id' then d.adset_id
            when v_group_by = 'campaign_id' then d.campaign_id
            else d.ad_id
          end as group_key,
          m.key as mapping_id,
          v.key as val,
          sum(v.value::bigint)::bigint as qty
        from keys k
        join public.ad_performance_daily d on d.user_id = k.user_id and d.pack_id = k.pack_id and d.ad_id = k.ad_id and d.date = k.date
        cross join lateral jsonb_each(d.custom_hist) as m(key, value)
        cross join lateral jsonb_each_text(m.value) as v(key, value)
        where v_include_custom
          and d.custom_hist is not null
          and (p_account_ids is null or d.account_id = any(p_account_ids))
          and (p_ad_name_contains is null or p_ad_name_contains = ''
               or coalesce(d.ad_name, '') ilike '%' || p_ad_name_contains || '%')
          and (
            (coalesce(p_campaign_name_contains, '') = '' and coalesce(p_adset_name_contains, '') = '')
            or exists (
              select 1 from public.ad_metrics am where am.user_id = k.user_id and am.pack_id = k.pack_id and am.ad_id = k.ad_id and am.date = k.date
                and (coalesce(p_campaign_name_contains, '') = ''
                     or coalesce(am.campaign_name, '') ilike '%' || p_campaign_name_contains || '%')
                and (coalesce(p_adset_name_contains, '') = ''
                     or coalesce(am.adset_name, '') ilike '%' || p_adset_name_contains || '%')
            )
          )
        group by 1, m.key, v.key
      ) x
      where coalesce(x.group_key, '') <> ''
      group by x.group_key, x.mapping_id
    ) y
    group by y.group_key
  ),
  -- 6. Enriquecimento por grupo (~77 linhas): representante em `ads`, tags do ATOR,
  --    packs da máscara, histograma de leads.
  -- Decodifica o representante (posições da chave: 1 impressões | 2 ad_id | 3 user_id
  -- | 4 impressões do dia | 5 date) e busca a LINHA representante em ad_metrics para
  -- os nomes — 77 lookups pela chave única, em vez de carregar nomes em 42 mil linhas.
  -- `collate "default"`: a chave é comparada em "C"; os pedaços voltam à colação das
  -- colunas, senão o `=` contra ads/ad_metrics não usa índice (medido: bitmap scan
  -- de 21 mil linhas por grupo).
  grp_dec as (
    select
      g.*,
      (split_part(g.rep_enc, e'\x1f', 2) collate "default") as rep_ad_id,
      (split_part(g.rep_enc, e'\x1f', 3))::uuid as rep_user_id,
      (split_part(g.rep_enc, e'\x1f', 5))::date as rep_date
    from grp g
  ),
  grp_rep as (
    select
      g.*,
      am.ad_name as rep_ad_name,
      am.account_id as rep_account_id,
      am.campaign_id as rep_campaign_id,
      am.campaign_name as rep_campaign_name,
      am.adset_id as rep_adset_id,
      am.adset_name as rep_adset_name
    from grp_dec g
    left join public.ad_metrics am on am.user_id = g.rep_user_id and am.pack_id = any(coalesce(p_pack_ids, v_pack_universe)) and am.ad_id = g.rep_ad_id and am.date = g.rep_date
  ),
  rows_enriched as (
    select
      g.group_key,
      g.rep_account_id as account_id,
      g.account_ids,
      g.campaign_ids,
      g.adset_ids,
      coalesce((
        select array_agg(v_pack_universe[i] order by i)
        from generate_series(1, v_n_packs) i
        where get_bit(g.pack_mask, i - 1) = 1
      ), array[]::uuid[]) as pack_ids,
      g.rep_campaign_id as campaign_id,
      g.rep_campaign_name as campaign_name,
      g.rep_adset_id as adset_id,
      g.rep_adset_name as adset_name,
      g.rep_ad_id,
      g.rep_ad_name,
      case
        when v_group_by = 'campaign_id' then coalesce(nullif(g.rep_campaign_name, ''), g.group_key)
        when v_group_by = 'adset_id' then coalesce(nullif(g.rep_adset_name, ''), g.group_key)
        else coalesce(nullif(g.rep_ad_name, ''), g.rep_ad_id)
      end as label_name,
      case
        when v_group_by = 'campaign_id' then null
        when coalesce(g.has_active, false) then 'ACTIVE'
        else coalesce(g.fallback_status, ra.effective_status)
      end as effective_status,
      case
        when v_group_by = 'campaign_id' then null
        else coalesce(g.active_count, 0)
      end as active_count,
      -- Contadores de motivo SO nas abas que agregam anuncios. Em conjunto e
      -- campanha a linha E a propria entidade, e o status dela vem de
      -- `parent_entities` (o estado do Meta) - mandar contadores la faria a tela
      -- classificar um CONJUNTO pausado como "pausado pelo conjunto", que e a
      -- resposta certa para o anuncio e errada para o conjunto. A ausencia e o
      -- sinal: sem contadores, a tela le `effective_status` direto.
      case when v_group_by in ('ad_name', 'ad_id') then coalesce(g.paused_self_count, 0) end as paused_self_count,
      case when v_group_by in ('ad_name', 'ad_id') then coalesce(g.adset_paused_count, 0) end as adset_paused_count,
      case when v_group_by in ('ad_name', 'ad_id') then coalesce(g.campaign_paused_count, 0) end as campaign_paused_count,
      g.impressions, g.clicks, g.inline_link_clicks, g.spend, g.lpv, g.plays, g.thruplays,
      g.hook_wsum, g.hold_rate_wsum, g.video_watched_p50_wsum, g.video_watched_p75_wsum,
      g.scroll_stop_wsum, g.reach, g.frequency_wsum,
      case when v_group_by = 'campaign_id' then g.adset_count else g.ad_id_count end as ad_count,
      -- Chave do histograma normalizada (80.0 → "80"); a v116 mandava o array cru.
      coalesce(lg.leadscore_histogram, '{}'::jsonb) as leadscore_histogram,
      -- 140: {"<mapping_id>": {"<valor>": quantidade}}; {} quando nao pedido ou sem dado.
      coalesce(cg.custom_histograms, '{}'::jsonb) as custom_histograms,
      g.results,
      g.meta_created_min,
      coalesce(nullif(ra.thumbnail_url, ''), nullif(ra.adcreatives_videos_thumbs ->> 0, '')) as thumbnail,
      ra.adcreatives_videos_thumbs,
      coalesce(nullif(ra.thumb_storage_path, ''), g.any_thumb_storage_path) as thumb_storage_path,
      coalesce(tg.tags, '[]'::jsonb) as tags,
      -- v132: o que a rota hidratava com 15 requisições e 13,7 mil linhas por carga
      -- (medido) agora vem daqui. Só nos níveis de criativo/anúncio, como a hidratação
      -- fazia (num nível de conjunto/campanha o "ad_name" é o nome do pai).
      -- media_type = maior precedência entre as cópias do nome (vídeo > imagem; 'unknown'
      -- e NULL ignorados) — a semântica exata de _hydrate_media_type_for_rankings_rows.
      case
        when v_group_by in ('ad_name', 'ad_id') then mt.media_type
        else null
      end as media_type,
      case
        when v_group_by in ('ad_name', 'ad_id') then coalesce(tr.has_transcription, false)
        else false
      end as has_transcription,
      -- Transcrito GANHA de sem-audio: num pack compartilhado os dois silos podem ter
      -- registros diferentes para o mesmo ad_name, e o texto que existe de fato vale
      -- mais do que a falha registrada no silo vizinho.
      case
        when v_group_by in ('ad_name', 'ad_id')
          then coalesce(tr.no_audio, false) and not coalesce(tr.has_transcription, false)
        else false
      end as transcription_no_audio
    from grp_rep g
    left join lateral (
      select case max(case a.media_type when 'video' then 2 when 'image' then 1 end)
               when 2 then 'video' when 1 then 'image' end as media_type
      from public.ads a
      where v_group_by in ('ad_name', 'ad_id')
        and a.user_id = any(v_owners)
        and a.ad_name = coalesce(nullif(g.rep_ad_name, ''), g.rep_ad_id)
    ) mt on true
    left join lateral (
      -- 142: a lateral deixa de responder "existe transcricao?" e passa a responder
      -- "em que estado esta esta midia?". O `limit 1` e o filtro de status saem porque
      -- agora e preciso VER a linha de falha para distinguir "sem audio detectavel"
      -- (permanente: nunca vai ser transcrito) de "ainda nao transcrito" (acionavel).
      -- Nao ha custo novo: ad_transcriptions tem UNIQUE (user_id, ad_name), entao a
      -- lateral le no maximo uma linha por dono (v_owners tem 1, ou 2 em pack
      -- compartilhado) pelo mesmo index scan de antes.
      --
      -- `no_voice_detected` e escrito pelos DOIS caminhos de falha do worker
      -- (transcription_worker.py) desde que a normalizacao existe; as linhas antigas
      -- que so tinham a frase no `error_message` sao corrigidas pelo backfill no fim
      -- desta migration. Por isso o SQL le so a flag e nao repete aqui a lista de
      -- frases que vive em supabase_repo._NO_AUDIO_PHRASES: uma regra, um lugar.
      select
        bool_or(t.status = 'completed') as has_transcription,
        bool_or(t.status = 'failed' and coalesce(t.metadata ->> 'no_voice_detected', '') = 'true') as no_audio
      from public.ad_transcriptions t
      where v_group_by in ('ad_name', 'ad_id')
        and t.user_id = any(v_owners)
        and t.ad_name = coalesce(nullif(g.rep_ad_name, ''), g.rep_ad_id)
    ) tr on true
    left join leads_by_group lg
      on lg.group_key = g.group_key
    left join custom_by_group cg
      on cg.group_key = g.group_key
    left join public.ads ra
      on ra.user_id = g.rep_user_id
     and ra.ad_id = g.rep_ad_id
    left join lateral (
      -- v116: tags do ATOR (p_user_id), só nos níveis de criativo/anúncio.
      select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'color', t.color) order by t.name, t.id) as tags
      -- v139: tags do SILO DO PACK, nao do ator. Mesma forma das duas laterais
      -- vizinhas (media_type e has_transcription), que ja liam por any(v_owners).
      from public.ad_tags atg
      join public.tags t on t.id = atg.tag_id and t.user_id = atg.user_id
      where v_group_by in ('ad_name', 'ad_id')
        and atg.user_id = any(v_owners)
        and atg.ad_name = coalesce(nullif(g.rep_ad_name, ''), g.rep_ad_id)
    ) tg on true
  ),
  rows_metrics as (
    select
      re.*,
      case when re.plays > 0 then re.hook_wsum / re.plays else 0 end as hook,
      case when re.plays > 0 then re.hold_rate_wsum / re.plays else 0 end as hold_rate,
      round(case when re.plays > 0 then re.video_watched_p50_wsum / re.plays else 0 end)::int as video_watched_p50,
      round(case when re.plays > 0 then re.video_watched_p75_wsum / re.plays else 0 end)::int as video_watched_p75,
      case when re.plays > 0 then re.scroll_stop_wsum / re.plays else 0 end as scroll_stop,
      case when re.impressions > 0 then re.clicks::numeric / re.impressions else 0 end as ctr,
      case when re.inline_link_clicks > 0 then re.lpv::numeric / re.inline_link_clicks else 0 end as connect_rate,
      case when re.impressions > 0 then (re.spend * 1000.0) / re.impressions else 0 end as cpm,
      case when re.impressions > 0 then re.inline_link_clicks::numeric / re.impressions else 0 end as website_ctr,
      case when re.impressions > 0 then re.frequency_wsum / re.impressions else 0 end as frequency,
      case when re.results > 0 then re.spend / re.results else 0 end as cpr,
      case when re.lpv > 0 then re.results / re.lpv else 0 end as page_conv,
      case when v_selected_key <> '' then jsonb_build_object(v_selected_key, re.results) else '{}'::jsonb end as conversions
    from rows_enriched re
  ),
  totals as (
    select
      coalesce(sum(rm.spend), 0)::numeric as total_spend,
      coalesce(sum(rm.impressions), 0)::bigint as total_impressions,
      coalesce(sum(rm.clicks), 0)::bigint as total_clicks,
      coalesce(sum(rm.inline_link_clicks), 0)::bigint as total_inline,
      coalesce(sum(rm.lpv), 0)::bigint as total_lpv,
      coalesce(sum(rm.plays), 0)::bigint as total_plays,
      coalesce(sum(rm.hook_wsum), 0)::numeric as total_hook_wsum,
      coalesce(sum(rm.hold_rate_wsum), 0)::numeric as total_hold_rate_wsum,
      coalesce(sum(rm.video_watched_p50_wsum), 0)::numeric as total_video_watched_p50_wsum,
      coalesce(sum(rm.video_watched_p75_wsum), 0)::numeric as total_video_watched_p75_wsum,
      coalesce(sum(rm.scroll_stop_wsum), 0)::numeric as total_scroll_stop_wsum,
      coalesce(sum(rm.results), 0)::numeric as total_results
    from rows_metrics rm
  ),
  -- Tipos disponíveis + per_action_type de TODAS as chaves: só quando pedido (o
  -- predicado é constante sob force_custom_plan → o planner poda o ramo inteiro).
  -- Relê a seleção estreita (keys, já materializada) + filtros de nome em ad_metrics +
  -- os arrays do rollup; sem JSON.
  -- Soma por key_id ANTES de juntar com o dicionário: são ≤ 81 linhas depois do GROUP
  -- BY. Juntar antes custou 10,6 s no cenário de 30 packs (826 mil pares desempacotados
  -- materializados e varridos uma vez por chave do dicionário).
  conv_all as (
    select ck.key as conv_key, c.total_results
    from (
    select pr.key_id, sum(pr.value)::numeric as total_results
    from keys k
    join public.ad_performance_daily d on d.user_id = k.user_id and d.pack_id = k.pack_id and d.ad_id = k.ad_id and d.date = k.date
    cross join lateral unnest(d.conv_key_ids, d.conv_values) as pr(key_id, value)
    where v_include_conv_types
      and coalesce(case
        when v_group_by = 'ad_id' then d.ad_id
        when v_group_by = 'ad_name' then coalesce(nullif(d.ad_name, ''), d.ad_id)
        when v_group_by = 'adset_id' then d.adset_id
        when v_group_by = 'campaign_id' then d.campaign_id
        else d.ad_id end, '') <> ''
      and (p_account_ids is null or d.account_id = any(p_account_ids))
      and (p_ad_name_contains is null or p_ad_name_contains = ''
           or coalesce(d.ad_name, '') ilike '%' || p_ad_name_contains || '%')
      and (
        (coalesce(p_campaign_name_contains, '') = '' and coalesce(p_adset_name_contains, '') = '')
        or exists (
          select 1 from public.ad_metrics am where am.user_id = k.user_id and am.pack_id = k.pack_id and am.ad_id = k.ad_id and am.date = k.date
            and (coalesce(p_campaign_name_contains, '') = ''
                 or coalesce(am.campaign_name, '') ilike '%' || p_campaign_name_contains || '%')
            and (coalesce(p_adset_name_contains, '') = ''
                 or coalesce(am.adset_name, '') ilike '%' || p_adset_name_contains || '%')
        )
      )
    group by pr.key_id
    ) c
    join public.conversion_keys ck on ck.id = c.key_id
  ),
  available_types as (
    select coalesce(jsonb_agg(c.conv_key order by c.conv_key), '[]'::jsonb) as conv_types
    from conv_all c
  ),
  per_action_all as (
    select coalesce(
      jsonb_object_agg(
        c.conv_key,
        jsonb_build_object(
          'results', c.total_results,
          'cpr', case when c.total_results > 0 then t.total_spend / c.total_results else 0 end,
          'page_conv', case when t.total_lpv > 0 then c.total_results / t.total_lpv else 0 end
        )
        order by c.conv_key
      ),
      '{}'::jsonb
    ) as per_action_type
    from conv_all c
    cross join totals t
  ),
  per_action_selected as (
    select
      case
        when v_selected_key <> '' then jsonb_build_object(
          v_selected_key,
          jsonb_build_object(
            'results', t.total_results,
            'cpr', case when t.total_results > 0 then t.total_spend / t.total_results else 0 end,
            'page_conv', case when t.total_lpv > 0 then t.total_results / t.total_lpv else 0 end
          )
        )
        else '{}'::jsonb
      end as per_action_type
    from totals t
  ),
  averages_payload as (
    select jsonb_build_object(
      'hook', case when t.total_plays > 0 then t.total_hook_wsum / t.total_plays else 0 end,
      'hold_rate', case when t.total_plays > 0 then t.total_hold_rate_wsum / t.total_plays else 0 end,
      'video_watched_p50', case when t.total_plays > 0 then t.total_video_watched_p50_wsum / t.total_plays else 0 end,
      'video_watched_p75', case when t.total_plays > 0 then t.total_video_watched_p75_wsum / t.total_plays else 0 end,
      'scroll_stop', case when t.total_plays > 0 then t.total_scroll_stop_wsum / t.total_plays else 0 end,
      'ctr', case when t.total_impressions > 0 then t.total_clicks::numeric / t.total_impressions else 0 end,
      'website_ctr', case when t.total_impressions > 0 then t.total_inline::numeric / t.total_impressions else 0 end,
      'connect_rate', case when t.total_inline > 0 then t.total_lpv::numeric / t.total_inline else 0 end,
      'cpm', case when t.total_impressions > 0 then (t.total_spend * 1000.0) / t.total_impressions else 0 end,
      'cpc', case when t.total_clicks > 0 then t.total_spend / t.total_clicks else 0 end,
      'cplc', case when t.total_inline > 0 then t.total_spend / t.total_inline else 0 end,
      'per_action_type', case when v_include_conv_types then paa.per_action_type else pas.per_action_type end
    ) as averages
    from totals t
    cross join per_action_all paa
    cross join per_action_selected pas
  ),
  header_payload as (
    select jsonb_build_object(
      'sums', jsonb_build_object(
        'spend', t.total_spend,
        'results', t.total_results,
        'mqls', to_jsonb(null::numeric)
      ),
      'weighted_averages', jsonb_build_object(
        'hook', case when t.total_plays > 0 then t.total_hook_wsum / t.total_plays else 0 end,
        'scroll_stop', case when t.total_plays > 0 then t.total_scroll_stop_wsum / t.total_plays else 0 end,
        'ctr', case when t.total_impressions > 0 then t.total_clicks::numeric / t.total_impressions else 0 end,
        'website_ctr', case when t.total_impressions > 0 then t.total_inline::numeric / t.total_impressions else 0 end,
        'connect_rate', case when t.total_inline > 0 then t.total_lpv::numeric / t.total_inline else 0 end,
        'cpm', case when t.total_impressions > 0 then (t.total_spend * 1000.0) / t.total_impressions else 0 end,
        'page_conv', case when t.total_lpv > 0 then t.total_results / t.total_lpv else 0 end
      )
    ) as header_aggregates
    from totals t
  ),
  ordered as (
    select rm.*
    from rows_metrics rm
    order by
      case when v_order_by = 'cpr' then rm.cpr end asc nulls last,
      case when v_order_by = 'hook' then rm.hook end desc nulls last,
      case when v_order_by = 'hold_rate' then rm.hold_rate end desc nulls last,
      case when v_order_by = 'spend' then rm.spend end desc nulls last,
      case when v_order_by = 'ctr' then rm.ctr end desc nulls last,
      case when v_order_by = 'connect_rate' then rm.connect_rate end desc nulls last,
      case when v_order_by = 'page_conv' then rm.page_conv end desc nulls last,
      case when v_order_by = 'cpm' then rm.cpm end desc nulls last,
      case when v_order_by = 'website_ctr' then rm.website_ctr end desc nulls last,
      case when v_order_by = 'results' then rm.results end desc nulls last,
      case
        when v_order_by not in ('cpr', 'hook', 'hold_rate', 'spend', 'ctr', 'connect_rate', 'page_conv', 'cpm', 'website_ctr', 'results')
        then rm.spend
      end desc nulls last,
      rm.group_key
  ),
  paged_raw as (
    select * from ordered offset v_offset limit v_limit
  ),
  paged as (
    select
      row_number() over () as ord,
      jsonb_build_object(
        'group_key', pr.group_key,
        'unique_id', null,
        'account_id', pr.account_id,
        'account_ids', pr.account_ids,
        'campaign_ids', pr.campaign_ids,
        'adset_ids', pr.adset_ids,
        'pack_ids', pr.pack_ids,
        'tags', pr.tags,
        'meta_created_time', pr.meta_created_min,
        'campaign_id', pr.campaign_id,
        'campaign_name', pr.campaign_name,
        'adset_id', pr.adset_id,
        'adset_name', pr.adset_name,
        'ad_id', pr.rep_ad_id,
        'ad_name', pr.label_name,
        'effective_status', pr.effective_status,
        'active_count', pr.active_count,
        'paused_self_count', pr.paused_self_count,
        'adset_paused_count', pr.adset_paused_count,
        'campaign_paused_count', pr.campaign_paused_count,
        'impressions', pr.impressions,
        'clicks', pr.clicks,
        'inline_link_clicks', pr.inline_link_clicks,
        'spend', pr.spend,
        'lpv', pr.lpv,
        'plays', pr.plays,
        'video_total_thruplays', pr.thruplays,
        'hook', pr.hook,
        'hold_rate', pr.hold_rate,
        'video_watched_p50', pr.video_watched_p50,
        'video_watched_p75', pr.video_watched_p75,
        'scroll_stop', pr.scroll_stop,
        'ctr', pr.ctr,
        'connect_rate', pr.connect_rate,
        'cpm', pr.cpm,
        'website_ctr', pr.website_ctr,
        'reach', pr.reach,
        'frequency', pr.frequency,
        'leadscore_histogram', pr.leadscore_histogram,
        'custom_histograms', pr.custom_histograms,
        'conversions', pr.conversions,
        'ad_count', pr.ad_count,
        'thumbnail', case
          when v_group_by in ('ad_name', 'ad_id') and pr.thumb_storage_path is not null then null
          else pr.thumbnail
        end,
        'thumb_storage_path', pr.thumb_storage_path,
        'adcreatives_videos_thumbs', pr.adcreatives_videos_thumbs,
        'media_type', pr.media_type,
        'has_transcription', pr.has_transcription,
        'transcription_no_audio', pr.transcription_no_audio
      ) as item
    from paged_raw pr
  ),
  -- Dicionario id -> nome, so das campanhas/conjuntos citados nas linhas DESTA
  -- pagina. O nome NAO viaja por linha: com ~23 campanhas por criativo o mesmo
  -- nome apareceria milhares de vezes, e nome de campanha e longo.
  paged_parent_ids as (
    select
      coalesce((select array_agg(distinct c) from paged_raw p, unnest(p.campaign_ids) c where c is not null), array[]::text[]) as campaign_ids,
      coalesce((select array_agg(distinct a) from paged_raw p, unnest(p.adset_ids) a where a is not null), array[]::text[]) as adset_ids
  ),
  -- `max(nome)`: um mesmo id pode carregar nomes diferentes entre os anuncios
  -- (a campanha foi renomeada entre dois sincronismos). Escolher e deterministico,
  -- e o rotulo continua identificando a mesma campanha.
  names_payload as (
    select jsonb_build_object(
      'campaigns', coalesce((
        select jsonb_object_agg(x.id, x.name)
        from (
          select a.campaign_id as id, max(a.campaign_name) as name
          from public.ads a, paged_parent_ids pp
          where a.user_id = any(v_owners)
            and a.campaign_id = any(pp.campaign_ids)
            and nullif(a.campaign_name, '') is not null
          group by a.campaign_id
        ) x
      ), '{}'::jsonb),
      'adsets', coalesce((
        select jsonb_object_agg(x.id, x.name)
        from (
          select a.adset_id as id, max(a.adset_name) as name
          from public.ads a, paged_parent_ids pp
          where a.user_id = any(v_owners)
            and a.adset_id = any(pp.adset_ids)
            and nullif(a.adset_name, '') is not null
          group by a.adset_id
        ) x
      ), '{}'::jsonb)
    ) as names
  ),
  total_count as (
    select count(*)::integer as total from rows_metrics
  ),
  pagination_payload as (
    select jsonb_build_object(
      'limit', v_limit,
      'offset', v_offset,
      'total', tc.total,
      'has_more', (v_offset + v_limit) < tc.total
    ) as pagination
    from total_count tc
  ),
  overlap_stat as (
    select count(*)::bigint as conflict_rows from keys k where k.x_cross_silo
  )
  select jsonb_build_object(
    'data', coalesce((select jsonb_agg(p.item order by p.ord) from paged p), '[]'::jsonb),
    'names', coalesce((select names from names_payload), '{}'::jsonb),
    'available_conversion_types',
      case when v_include_conv_types then coalesce((select conv_types from available_types), '[]'::jsonb) else '[]'::jsonb end,
    'averages', coalesce((select averages from averages_payload), '{}'::jsonb),
    'header_aggregates', coalesce((select header_aggregates from header_payload), '{}'::jsonb),
    'pagination', coalesce((select pagination from pagination_payload), jsonb_build_object('limit', v_limit, 'offset', v_offset, 'total', 0, 'has_more', false))
  )
  || case
       when coalesce((select conflict_rows from overlap_stat), 0) > 0
       then jsonb_build_object('overlap', jsonb_build_object('rows', (select conflict_rows from overlap_stat)))
       else '{}'::jsonb
     end
  into v_result;

  v_result := coalesce(v_result, jsonb_build_object(
    'data', '[]'::jsonb,
    'names', '{}'::jsonb,
    'available_conversion_types', '[]'::jsonb,
    'averages', '{}'::jsonb,
    'header_aggregates', '{}'::jsonb,
    'pagination', jsonb_build_object('limit', v_limit, 'offset', v_offset, 'total', 0, 'has_more', false)
  ));

  -- Fold do wrapper v067: filtro por campaign_id PÓS-agregação/paginação (averages e
  -- available_conversion_types permanecem do payload completo), pagination resetada.
  if nullif(trim(coalesce(p_campaign_id, '')), '') is not null then
    with data_rows as (
      select t.ord, t.item
      from jsonb_array_elements(
        case when jsonb_typeof(v_result->'data') = 'array' then v_result->'data' else '[]'::jsonb end
      ) with ordinality as t(item, ord)
      where coalesce(t.item->>'campaign_id', '') = trim(p_campaign_id)
    ),
    filtered_data as (
      select coalesce(jsonb_agg(dr.item order by dr.ord), '[]'::jsonb) as data, count(*)::integer as total
      from data_rows dr
    )
    select v_result || jsonb_build_object(
      'data', fd.data,
      'pagination', jsonb_build_object('limit', v_limit, 'offset', 0, 'total', fd.total, 'has_more', false)
    )
    into v_result
    from filtered_data fd;

    -- O dicionario foi montado para a pagina ANTES deste corte. Sem podar, uma
    -- consulta que sobra com 3 linhas carregaria os nomes de TODOS os pais da pagina
    -- inteira - o diferencial mediu a sobra: 2.011 conjuntos, ~186 kB de dicionario
    -- que nenhuma linha consulta. Roda so dentro do fold, e o custo e nomes x linhas
    -- restantes, que aqui sao poucas por definicao.
    select v_result || jsonb_build_object('names', jsonb_build_object(
      'campaigns', coalesce((
        select jsonb_object_agg(e.key, e.value)
        from jsonb_each_text(coalesce(v_result->'names'->'campaigns', '{}'::jsonb)) e
        where exists (
          select 1 from jsonb_array_elements(v_result->'data') r where r->'campaign_ids' ? e.key
        )
      ), '{}'::jsonb),
      'adsets', coalesce((
        select jsonb_object_agg(e.key, e.value)
        from jsonb_each_text(coalesce(v_result->'names'->'adsets', '{}'::jsonb)) e
        where exists (
          select 1 from jsonb_array_elements(v_result->'data') r where r->'adset_ids' ? e.key
        )
      ), '{}'::jsonb)
    )) into v_result;
  end if;

  return v_result;
end;
$$;


CREATE OR REPLACE FUNCTION public.fetch_manager_performance_series_v145(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text DEFAULT 'ad_name'::text, p_pack_ids uuid[] DEFAULT NULL::uuid[], p_account_ids text[] DEFAULT NULL::text[], p_campaign_name_contains text DEFAULT NULL::text, p_adset_name_contains text DEFAULT NULL::text, p_ad_name_contains text DEFAULT NULL::text, p_action_type text DEFAULT NULL::text, p_group_keys text[] DEFAULT NULL::text[], p_window integer DEFAULT 5) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    SET plan_cache_mode TO 'force_custom_plan'
    SET work_mem TO '32MB'
    AS $$
declare
  v_group_by text := lower(coalesce(p_group_by, 'ad_name'));
  v_date_start date := least(p_date_start, p_date_stop);
  v_date_stop date := greatest(p_date_start, p_date_stop);
  v_window integer := greatest(1, least(coalesce(p_window, 5), 30));
  v_axis_start date;
  v_selected_key text := trim(coalesce(p_action_type, ''));
  v_key_id integer := null;
  v_mql_min numeric;  -- null = corte NAO definido (nao e zero)
  v_result jsonb;
  v_owners uuid[];
  v_requested integer;
begin
  if auth.uid() is distinct from p_user_id then
    raise exception 'Forbidden: p_user_id must match auth.uid()'
      using errcode = '42501';
  end if;

  if p_pack_ids is null then
    v_owners := array[p_user_id];
  else
    select array_agg(distinct a.owner_id), count(distinct a.pack_id)
      into v_owners, v_requested
    from public.resolve_pack_access(p_pack_ids, p_user_id) a;
    if coalesce(v_requested, 0) < (select count(distinct x) from unnest(p_pack_ids) x) then
      raise exception 'Forbidden: pack inacessivel na selecao'
        using errcode = '42501';
    end if;
    if v_owners is null or array_length(v_owners, 1) is null then
      v_owners := array[p_user_id];
    end if;
  end if;

  if v_group_by not in ('ad_id', 'ad_name', 'adset_id', 'campaign_id') then
    raise exception 'Invalid p_group_by: %, expected ad_id|ad_name|adset_id|campaign_id', v_group_by
      using errcode = '22023';
  end if;

  -- Normalização da chave pedida, idêntica à série antiga (sem prefixo = 'conversion:').
  if v_selected_key <> '' and v_selected_key not like 'conversion:%' and v_selected_key not like 'action:%' then
    v_selected_key := 'conversion:' || v_selected_key;
  end if;
  if v_selected_key <> '' then
    select id into v_key_id from public.conversion_keys where key = v_selected_key;
  end if;

  -- Resolucao com heranca: pack sobrescreve o padrao do usuario (ver funcao).
  v_mql_min := public.resolve_pack_mql_leadscore_min(p_user_id, p_pack_ids);
  v_axis_start := greatest(v_date_start, (v_date_stop - (v_window - 1)));

  with requested_groups as (
    select distinct k as group_key
    from unnest(coalesce(p_group_keys, '{}'::text[])) k
    where nullif(trim(k), '') is not null
  ),
  axis as (
    select generate_series(v_axis_start, v_date_stop, interval '1 day')::date as d
  ),
  -- A seleção, SÓ na janela, resolvida no mapa (dedup cross-silo com a preferência da
  -- série antiga: vence o dono do pack compartilhado, o ator perde, desempate por uuid).
  keys as (
    select
      apm.ad_id,
      apm.date as date,
      apm.user_id,
      apm.pack_id
    from unnest(v_owners) as o(owner_id)
    join public.ad_performance_daily apm
      on apm.user_id = o.owner_id
     and apm.pack_id = any(p_pack_ids)
     and apm.date >= v_axis_start
     and apm.date <= v_date_stop
    where p_pack_ids is not null

    union all

    -- Sem selecao = o silo inteiro. Um anuncio-dia em dois packs sao duas linhas:
    -- o GROUP BY devolve uma, com um pack deterministico para o join seguinte.
    select am.ad_id, am.date, p_user_id as user_id,
           (array_agg(am.pack_id order by am.pack_id))[1] as pack_id
    from public.ad_performance_daily am
    where p_pack_ids is null
      and am.user_id = p_user_id
      and am.date >= v_axis_start
      and am.date <= v_date_stop
    group by am.ad_id, am.date
  ),
  sel as (
    select
      case
        when v_group_by = 'ad_id' then d.ad_id
        when v_group_by = 'ad_name' then coalesce(nullif(d.ad_name, ''), d.ad_id)
        when v_group_by = 'adset_id' then d.adset_id
        when v_group_by = 'campaign_id' then d.campaign_id
        else d.ad_id
      end as group_key,
      d.date,
      d.impressions, d.clicks, d.inline_link_clicks, d.spend, d.lpv, d.plays, d.thruplays, d.reach,
      d.hook_value, d.scroll_stop_value, d.hold_rate, d.video_watched_p50, d.video_watched_p75,
      coalesce(d.conv_values[array_position(d.conv_key_ids, v_key_id)], 0)::numeric as results,
      d.lead_scores,
      d.lead_qtys
    from keys k
    join public.ad_performance_daily d on d.user_id = k.user_id and d.pack_id = k.pack_id and d.ad_id = k.ad_id and d.date = k.date
    where (p_account_ids is null or d.account_id = any(p_account_ids))
      and (p_ad_name_contains is null or p_ad_name_contains = ''
           or coalesce(d.ad_name, '') ilike '%' || p_ad_name_contains || '%')
      and (
        (coalesce(p_campaign_name_contains, '') = '' and coalesce(p_adset_name_contains, '') = '')
        or exists (
          select 1 from public.ad_metrics am where am.user_id = k.user_id and am.pack_id = k.pack_id and am.ad_id = k.ad_id and am.date = k.date
            and (coalesce(p_campaign_name_contains, '') = ''
                 or coalesce(am.campaign_name, '') ilike '%' || p_campaign_name_contains || '%')
            and (coalesce(p_adset_name_contains, '') = ''
                 or coalesce(am.adset_name, '') ilike '%' || p_adset_name_contains || '%')
        )
      )
  ),
  filtered as (
    select s.*
    from sel s
    join requested_groups rg on rg.group_key = s.group_key
  ),
  daily as (
    select
      f.group_key,
      f.date,
      sum(f.impressions)::bigint as impressions,
      sum(f.clicks)::bigint as clicks,
      sum(f.inline_link_clicks)::bigint as inline_link_clicks,
      sum(f.spend)::numeric as spend,
      sum(f.lpv)::bigint as lpv,
      sum(f.plays)::bigint as plays,
      sum(f.thruplays)::bigint as thruplays,
      sum(f.reach)::bigint as reach,
      sum(f.hook_value * f.plays)::numeric as hook_wsum,
      sum(f.scroll_stop_value * f.plays)::numeric as scroll_stop_wsum,
      sum(f.hold_rate * f.plays)::numeric as hold_rate_wsum,
      sum(f.video_watched_p50 * f.plays)::numeric as video_watched_p50_wsum,
      sum(f.video_watched_p75 * f.plays)::numeric as video_watched_p75_wsum,
      sum(f.results)::numeric as results,
      -- histograma: MQLs = soma das quantidades com score >= corte; soma = Σ score×qty;
      -- contagem = Σ qty. Idêntico a contar/somar o array cru, sem desempacotar 1 KB.
      (case
        when v_mql_min is null then null
        else sum(coalesce((select sum(s.q) from unnest(f.lead_scores, f.lead_qtys) as s(v, q) where s.v >= v_mql_min), 0))
      end)::bigint as mql_count,
      sum(coalesce((select sum(s.v * s.q) from unnest(f.lead_scores, f.lead_qtys) as s(v, q)), 0))::numeric as leadscore_sum,
      sum(coalesce((select sum(s.q) from unnest(f.lead_qtys) as s(q)), 0))::bigint as leadscore_count
    from filtered f
    group by f.group_key, f.date
  ),
  series_by_group as (
    select
      rg.group_key,
      jsonb_build_object(
        'axis', jsonb_agg(to_char(a.d, 'YYYY-MM-DD') order by a.d),
        'hook', jsonb_agg(case when coalesce(d.plays, 0) > 0 then d.hook_wsum / d.plays else null end order by a.d),
        'scroll_stop', jsonb_agg(case when coalesce(d.plays, 0) > 0 then d.scroll_stop_wsum / d.plays else null end order by a.d),
        'hold_rate', jsonb_agg(case when coalesce(d.plays, 0) > 0 then d.hold_rate_wsum / d.plays else null end order by a.d),
        'video_watched_p50', jsonb_agg(case when coalesce(d.plays, 0) > 0 then d.video_watched_p50_wsum / d.plays else null end order by a.d),
        'video_watched_p75', jsonb_agg(case when coalesce(d.plays, 0) > 0 then d.video_watched_p75_wsum / d.plays else null end order by a.d),
        'spend', jsonb_agg(case when coalesce(d.spend, 0) <> 0 then d.spend else null end order by a.d),
        'clicks', jsonb_agg(case when coalesce(d.clicks, 0) <> 0 then d.clicks else null end order by a.d),
        'inline_link_clicks', jsonb_agg(case when coalesce(d.inline_link_clicks, 0) <> 0 then d.inline_link_clicks else null end order by a.d),
        'ctr', jsonb_agg(case when coalesce(d.impressions, 0) > 0 then d.clicks::numeric / d.impressions else null end order by a.d),
        'connect_rate', jsonb_agg(case when coalesce(d.inline_link_clicks, 0) > 0 then d.lpv::numeric / d.inline_link_clicks else null end order by a.d),
        'lpv', jsonb_agg(coalesce(d.lpv, 0) order by a.d),
        'impressions', jsonb_agg(case when coalesce(d.impressions, 0) <> 0 then d.impressions else null end order by a.d),
        'plays', jsonb_agg(case when coalesce(d.plays, 0) <> 0 then d.plays else null end order by a.d),
        'thruplays', jsonb_agg(case when coalesce(d.thruplays, 0) <> 0 then d.thruplays else null end order by a.d),
        'reach', jsonb_agg(case when coalesce(d.reach, 0) <> 0 then d.reach else null end order by a.d),
        'cpm', jsonb_agg(case when coalesce(d.impressions, 0) > 0 then (d.spend * 1000.0) / d.impressions else null end order by a.d),
        'cpc', jsonb_agg(case when coalesce(d.clicks, 0) > 0 then d.spend / d.clicks else null end order by a.d),
        'cplc', jsonb_agg(case when coalesce(d.inline_link_clicks, 0) > 0 then d.spend / d.inline_link_clicks else null end order by a.d),
        'website_ctr', jsonb_agg(case when coalesce(d.impressions, 0) > 0 then d.inline_link_clicks::numeric / d.impressions else null end order by a.d),
        'conversions', jsonb_agg(
          case
            when v_selected_key <> '' then jsonb_build_object(v_selected_key, coalesce(d.results, 0))
            else '{}'::jsonb
          end
          order by a.d
        ),
        'cpmql', jsonb_agg(
          case
            when coalesce(d.mql_count, 0) > 0 and coalesce(d.spend, 0) > 0 then d.spend / d.mql_count
            else null
          end
          order by a.d
        ),
        'mqls', jsonb_agg(
          case when coalesce(d.mql_count, 0) > 0 then d.mql_count else null end
          order by a.d
        ),
        'leadscore_avg', jsonb_agg(
          case
            when coalesce(d.leadscore_count, 0) > 0 then d.leadscore_sum / d.leadscore_count
            else null
          end
          order by a.d
        ),
        -- Taxa de qualificação do dia: MQLs sobre o TOTAL de leads (escala 0-1).
        'mql_rate', jsonb_agg(
          case
            when d.mql_count is not null and coalesce(d.leadscore_count, 0) > 0
              then d.mql_count::numeric / d.leadscore_count
            else null
          end
          order by a.d
        )
      ) as series
    from requested_groups rg
    cross join axis a
    left join daily d
      on d.group_key = rg.group_key
     and d.date = a.d
    group by rg.group_key
  )
  select jsonb_build_object(
    'series_by_group', coalesce(
      (select jsonb_object_agg(sbg.group_key, sbg.series order by sbg.group_key) from series_by_group sbg),
      '{}'::jsonb
    ),
    'window', v_window
  )
  into v_result;

  return coalesce(v_result, jsonb_build_object('series_by_group', '{}'::jsonb, 'window', v_window));
end;
$$;


CREATE OR REPLACE FUNCTION public.fetch_entity_performance_v145(p_user_id uuid, p_date_start date, p_date_stop date, p_entity text, p_entity_id text, p_pack_ids uuid[] DEFAULT NULL::uuid[], p_group_by text DEFAULT 'entity'::text, p_include_curve boolean DEFAULT false, p_series_days integer DEFAULT NULL::integer, p_include_custom boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    SET plan_cache_mode TO 'force_custom_plan'
    AS $$
declare
  v_entity text := lower(coalesce(p_entity, ''));
  v_group_by text := lower(coalesce(p_group_by, 'entity'));
  v_date_start date := least(p_date_start, p_date_stop);
  v_date_stop date := greatest(p_date_start, p_date_stop);
  v_include_curve boolean := coalesce(p_include_curve, false);
  -- Linhas por DIA só da janela pedida (as telas de detalhe/filhos usam 5 dias de
  -- sparkline; só o histórico usa o período inteiro). Medido: os filhos do conjunto
  -- mais pesado (29 anúncios × 9 meses) saíam com 1,4 MB de dias que ninguém lia.
  v_series_start date;
  v_owners uuid[];
  v_requested integer;
  v_mql numeric;
  -- 140: histogramas das colunas vinculadas so quando pedidos (opt-in).
  v_include_custom boolean := coalesce(p_include_custom, false);
  v_result jsonb;
begin
  if auth.uid() is distinct from p_user_id then
    raise exception 'Forbidden: p_user_id must match auth.uid()'
      using errcode = '42501';
  end if;
  if v_entity not in ('ad_id', 'ad_name', 'adset_id') then
    raise exception 'Invalid p_entity: %, expected ad_id|ad_name|adset_id', v_entity
      using errcode = '22023';
  end if;
  if v_group_by not in ('entity', 'ad_id') then
    raise exception 'Invalid p_group_by: %, expected entity|ad_id', v_group_by
      using errcode = '22023';
  end if;
  if coalesce(p_entity_id, '') = '' then
    raise exception 'p_entity_id is required' using errcode = '22023';
  end if;

  -- Escopo: idêntico à base do Manager (v130/v132).
  if p_pack_ids is null then
    v_owners := array[p_user_id];
  else
    select array_agg(distinct a.owner_id), count(distinct a.pack_id)
      into v_owners, v_requested
    from public.resolve_pack_access(p_pack_ids, p_user_id) a;
    if coalesce(v_requested, 0) < (select count(distinct x) from unnest(p_pack_ids) x) then
      raise exception 'Forbidden: pack inacessivel na selecao'
        using errcode = '42501';
    end if;
    if v_owners is null or array_length(v_owners, 1) is null then
      v_owners := array[p_user_id];
    end if;
  end if;

  -- Corte de MQL dos packs (NULL = indefinido ou divergente; sem packs = NULL).
  v_mql := public.resolve_pack_mql_leadscore_min(p_user_id, p_pack_ids);

  v_series_start := case
    when p_series_days is null or p_series_days <= 0 then v_date_start
    else greatest(v_date_start, v_date_stop - (p_series_days - 1))
  end;

  with
  -- 1. Chaves (silo, anúncio, dia) da entidade no período, por índice de ad_metrics.
  --    Os três ramos do OR são constantes sob force_custom_plan: o planner poda os
  --    dois falsos e usa o índice do verdadeiro.
  keys as (
    select am.user_id, am.pack_id, am.ad_id, am.date
    from unnest(v_owners) as o(owner_id)
    join public.ad_performance_daily am
      on am.user_id = o.owner_id
     and am.date >= v_date_start
     and am.date <= v_date_stop
     and (
       (v_entity = 'ad_id' and am.ad_id = p_entity_id)
       or (v_entity = 'ad_name' and am.ad_name = p_entity_id)
       or (v_entity = 'adset_id' and am.adset_id = p_entity_id)
     )
    where p_pack_ids is null
       or am.pack_id = any(p_pack_ids)
  ),
  -- 2. Dedup cross-silo: uma linha por (anúncio, dia); vence o silo que NÃO é o do
  --    ator (o dono do pack compartilhado), desempate por uuid — regra da v104/v130.
  dedup as (
    select k.user_id, k.pack_id, k.ad_id, k.date
    from (
      select k.*, row_number() over (partition by k.ad_id, k.date order by (k.user_id = p_user_id), k.user_id) as rn
      from keys k
    ) k
    where k.rn = 1
  ),
  -- 2b. (v134) Packs de cada anúncio, para a linha-filha poder ser filtrada por
  --     Pack. Segunda visita a ad_metric_pack_map — a primeira, em `keys`, só
  --     decide se o anúncio-dia entra; aqui coletamos os ids. Roda sobre `dedup`
  --     (uma linha por anúncio-dia, já resolvido o cross-silo) e agrega por
  --     anúncio, não por dia.
  --
  --     RESTRITO À SELEÇÃO, igual ao `pack_ids` da base do Manager: devolver o
  --     universo faria o filtro oferecer pack que não está na tela e produzir
  --     tabela vazia sem explicação.
  packs_by_ad as (
    select
      d.ad_id,
      coalesce(
        array_agg(distinct d.pack_id),
        array[]::uuid[]
      ) as pack_ids
    from dedup d
    group by d.ad_id
  ),
  -- 3. As linhas: SÓ o read model, pela PK.
  rows_ as (
    select
      case when v_group_by = 'ad_id' then d.ad_id else p_entity_id end as group_key,
      d.*
    from dedup k
    join public.ad_performance_daily d on d.user_id = k.user_id and d.pack_id = k.pack_id and d.ad_id = k.ad_id and d.date = k.date
  ),
  -- 4. Grupo × dia (só a janela de série): somas e somas ponderadas por plays (as
  --    razões saem em Python, com a mesma fórmula do Manager).
  days as (
    select
      r.group_key,
      r.date,
      sum(r.impressions)::bigint as impressions,
      sum(r.clicks)::bigint as clicks,
      sum(r.inline_link_clicks)::bigint as inline_link_clicks,
      sum(r.spend)::numeric as spend,
      sum(r.lpv)::bigint as lpv,
      sum(r.plays)::bigint as plays,
      sum(r.thruplays)::bigint as thruplays,
      sum(r.hook_value * r.plays)::numeric as hook_wsum,
      sum(r.scroll_stop_value * r.plays)::numeric as scroll_stop_wsum,
      sum(r.hold_rate * r.plays)::numeric as hold_rate_wsum,
      sum(r.video_watched_p50 * r.plays)::numeric as video_watched_p50_wsum,
      sum(r.video_watched_p75 * r.plays)::numeric as video_watched_p75_wsum,
      sum(r.reach)::bigint as reach
    from rows_ r
    where r.date >= v_series_start
    group by r.group_key, r.date
  ),
  -- Conversões por (grupo, dia): agrupa por id da chave ANTES de juntar o dicionário
  -- (lição da v130: juntar par a par antes de agrupar custava segundos).
  conv_days as (
    select s.group_key, s.date,
           jsonb_object_agg(ck.key, s.total order by ck.key) as conversions
    from (
      select r.group_key, r.date, pr.key_id, sum(pr.value)::numeric as total
      from rows_ r
      cross join lateral unnest(r.conv_key_ids, r.conv_values) as pr(key_id, value)
      where r.date >= v_series_start
      group by r.group_key, r.date, pr.key_id
    ) s
    join public.conversion_keys ck on ck.id = s.key_id
    group by s.group_key, s.date
  ),
  -- Leads por (grupo, dia): histograma score → quantidade (chave normalizada, 80.0 → "80").
  lead_days as (
    select s.group_key, s.date,
           jsonb_object_agg(trim_scale(s.score)::text, s.qty order by s.score) as leads
    from (
      select r.group_key, r.date, l.score, sum(l.qty)::integer as qty
      from rows_ r
      cross join lateral unnest(r.lead_scores, r.lead_qtys) as l(score, qty)
      where r.date >= v_series_start
      group by r.group_key, r.date, l.score
    ) s
    group by s.group_key, s.date
  ),
  -- Totais do período inteiro por grupo (as telas de detalhe/filhos somam o período
  -- todo e mostram só 5 dias de série).
  totals as (
    select
      r.group_key,
      sum(r.impressions)::bigint as impressions,
      sum(r.clicks)::bigint as clicks,
      sum(r.inline_link_clicks)::bigint as inline_link_clicks,
      sum(r.spend)::numeric as spend,
      sum(r.lpv)::bigint as lpv,
      sum(r.plays)::bigint as plays,
      sum(r.thruplays)::bigint as thruplays,
      sum(r.hook_value * r.plays)::numeric as hook_wsum,
      sum(r.scroll_stop_value * r.plays)::numeric as scroll_stop_wsum,
      sum(r.hold_rate * r.plays)::numeric as hold_rate_wsum,
      sum(r.video_watched_p50 * r.plays)::numeric as video_watched_p50_wsum,
      sum(r.video_watched_p75 * r.plays)::numeric as video_watched_p75_wsum,
      sum(r.reach)::bigint as reach
    from rows_ r
    group by r.group_key
  ),
  conv_totals as (
    select s.group_key, jsonb_object_agg(ck.key, s.total order by ck.key) as conversions
    from (
      select r.group_key, pr.key_id, sum(pr.value)::numeric as total
      from rows_ r
      cross join lateral unnest(r.conv_key_ids, r.conv_values) as pr(key_id, value)
      group by r.group_key, pr.key_id
    ) s
    join public.conversion_keys ck on ck.id = s.key_id
    group by s.group_key
  ),
  lead_totals as (
    select s.group_key, jsonb_object_agg(trim_scale(s.score)::text, s.qty order by s.score) as leads
    from (
      select r.group_key, l.score, sum(l.qty)::integer as qty
      from rows_ r
      cross join lateral unnest(r.lead_scores, r.lead_qtys) as l(score, qty)
      group by r.group_key, l.score
    ) s
    group by s.group_key
  ),
  -- 140: histogramas das colunas vinculadas, somados no PERIODO inteiro por grupo
  -- (a entidade, ou cada filho). Sem serie por dia no v1. Opt-in por p_include_custom.
  custom_totals as (
    select y.group_key, jsonb_object_agg(y.mapping_id, y.hist) as custom_histograms
    from (
      select x.group_key, x.mapping_id, jsonb_object_agg(x.val, x.qty) as hist
      from (
        select r.group_key, m.key as mapping_id, v.key as val, sum(v.value::bigint)::bigint as qty
        from rows_ r
        cross join lateral jsonb_each(r.custom_hist) as m(key, value)
        cross join lateral jsonb_each_text(m.value) as v(key, value)
        where v_include_custom and r.custom_hist is not null
        group by r.group_key, m.key, v.key
      ) x
      group by x.group_key, x.mapping_id
    ) y
    group by y.group_key
  ),
  total_rows as (
    select
      t.group_key,
      jsonb_build_object(
        'impressions', t.impressions,
        'clicks', t.clicks,
        'inline_link_clicks', t.inline_link_clicks,
        'spend', t.spend,
        'lpv', t.lpv,
        'plays', t.plays,
        'thruplays', t.thruplays,
        'hook_wsum', t.hook_wsum,
        'scroll_stop_wsum', t.scroll_stop_wsum,
        'hold_rate_wsum', t.hold_rate_wsum,
        'video_watched_p50_wsum', t.video_watched_p50_wsum,
        'video_watched_p75_wsum', t.video_watched_p75_wsum,
        'reach', t.reach,
        'conversions', coalesce(c.conversions, '{}'::jsonb),
        'leads', coalesce(l.leads, '{}'::jsonb),
        'custom_histograms', coalesce(cu.custom_histograms, '{}'::jsonb)
      ) as item
    from totals t
    left join conv_totals c on c.group_key = t.group_key
    left join lead_totals l on l.group_key = t.group_key
    left join custom_totals cu on cu.group_key = t.group_key
  ),
  day_rows as (
    select
      d.group_key,
      d.date,
      jsonb_build_object(
        'date', d.date,
        'impressions', d.impressions,
        'clicks', d.clicks,
        'inline_link_clicks', d.inline_link_clicks,
        'spend', d.spend,
        'lpv', d.lpv,
        'plays', d.plays,
        'thruplays', d.thruplays,
        'hook_wsum', d.hook_wsum,
        'scroll_stop_wsum', d.scroll_stop_wsum,
        'hold_rate_wsum', d.hold_rate_wsum,
        'video_watched_p50_wsum', d.video_watched_p50_wsum,
        'video_watched_p75_wsum', d.video_watched_p75_wsum,
        'reach', d.reach,
        'conversions', coalesce(c.conversions, '{}'::jsonb),
        'leads', coalesce(l.leads, '{}'::jsonb)
      ) as item
    from days d
    left join conv_days c on c.group_key = d.group_key and c.date = d.date
    left join lead_days l on l.group_key = d.group_key and l.date = d.date
  ),
  -- 5. Representante — MESMA regra da base do Manager: por anúncio, o dia de mais
  --    impressões (desempate: mais recente); no grupo, (impressões, ad_id) máximos.
  per_ad as (
    select
      r.group_key,
      r.user_id,
      r.ad_id,
      max((lpad(r.impressions::text, 12, '0') || e'\x1f' || r.date::text) collate "C") as rep_enc
    from rows_ r
    group by r.group_key, r.user_id, r.ad_id
  ),
  grp as (
    select
      p.group_key,
      count(distinct p.ad_id)::integer as ad_count,
      max((substr(p.rep_enc, 1, 12) || e'\x1f' || p.ad_id || e'\x1f' || p.user_id::text
           || e'\x1f' || p.rep_enc) collate "C") as rep_enc,
      -- fallback de miniatura: qualquer cópia do grupo com arquivo no Storage (v132)
      max(nullif(a.thumb_storage_path, '')) as any_thumb_storage_path
    from per_ad p
    left join public.ads a
      on a.user_id = p.user_id
     and a.ad_id = p.ad_id
    group by p.group_key
  ),
  grp_dec as (
    select
      g.*,
      (split_part(g.rep_enc, e'\x1f', 2) collate "default") as rep_ad_id,
      (split_part(g.rep_enc, e'\x1f', 3))::uuid as rep_user_id,
      (split_part(g.rep_enc, e'\x1f', 5))::date as rep_date
    from grp g
  ),
  grp_rep as (
    select
      g.group_key,
      g.ad_count,
      g.rep_user_id,
      g.rep_ad_id,
      am.ad_name as rep_ad_name,
      am.account_id as rep_account_id,
      am.campaign_id as rep_campaign_id,
      am.campaign_name as rep_campaign_name,
      am.adset_id as rep_adset_id,
      am.adset_name as rep_adset_name,
      -- v134: a filha É um anúncio, então o pack do representante é o pack dela.
      coalesce(pba.pack_ids, array[]::uuid[]) as pack_ids,
      a.effective_status,
      coalesce(nullif(a.thumb_storage_path, ''), g.any_thumb_storage_path) as thumb_storage_path
    from grp_dec g
    left join packs_by_ad pba on pba.ad_id = g.rep_ad_id
    left join public.ad_metrics am on am.user_id = g.rep_user_id and (p_pack_ids is null or am.pack_id = any(p_pack_ids)) and am.ad_id = g.rep_ad_id and am.date = g.rep_date
    left join public.ads a
      on a.user_id = g.rep_user_id
     and a.ad_id = g.rep_ad_id
  ),
  -- 6. Curva de retenção ponderada por plays (só quando pedida): Σ ponto×plays e
  --    Σ plays POR ÍNDICE — uma linha de curva mais curta não pesa nos índices que
  --    não tem (semântica da rota antiga). A divisão e o arredondamento ficam em Python.
  curve as (
    select
      r.group_key,
      (e.idx - 1)::integer as idx,
      sum(public.ad_performance_parse_value(e.val #>> '{}') * r.plays)::numeric as wsum,
      sum(r.plays)::bigint as psum
    from rows_ r
    join public.ad_metrics am on am.user_id = r.user_id and am.pack_id = r.pack_id and am.ad_id = r.ad_id and am.date = r.date
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(am.video_play_curve_actions) = 'array' then am.video_play_curve_actions else '[]'::jsonb end
    ) with ordinality as e(val, idx)
    where v_include_curve
      and r.plays > 0
    group by r.group_key, e.idx
  ),
  curve_arr as (
    select
      m.group_key,
      jsonb_agg(coalesce(x.wsum, 0) order by i) as curve_wsum,
      jsonb_agg(coalesce(x.psum, 0) order by i) as curve_psum
    from (select c.group_key, max(c.idx) as mx from curve c group by c.group_key) m
    cross join generate_series(0, m.mx) as i
    left join curve x on x.group_key = m.group_key and x.idx = i
    group by m.group_key
  )
  select jsonb_build_object(
    'mql_leadscore_min', v_mql,
    'groups', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'group_key', g.group_key,
          'ad_count', g.ad_count,
          'user_id', g.rep_user_id,
          'ad_id', g.rep_ad_id,
          'ad_name', g.rep_ad_name,
          'account_id', g.rep_account_id,
          'pack_ids', g.pack_ids,
          'campaign_id', g.rep_campaign_id,
          'campaign_name', g.rep_campaign_name,
          'adset_id', g.rep_adset_id,
          'adset_name', g.rep_adset_name,
          'effective_status', g.effective_status,
          'thumb_storage_path', g.thumb_storage_path,
          'curve_wsum', ca.curve_wsum,
          'curve_psum', ca.curve_psum,
          'totals', tr.item,
          'days', coalesce((
            select jsonb_agg(dr.item order by dr.date)
            from day_rows dr
            where dr.group_key = g.group_key
          ), '[]'::jsonb)
        )
        order by g.group_key
      )
      from grp_rep g
      join total_rows tr on tr.group_key = g.group_key
      left join curve_arr ca on ca.group_key = g.group_key
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;


CREATE OR REPLACE FUNCTION public.fetch_manager_rankings_retention_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text DEFAULT 'ad_name'::text, p_pack_ids uuid[] DEFAULT NULL::uuid[], p_account_ids text[] DEFAULT NULL::text[], p_campaign_name_contains text DEFAULT NULL::text, p_adset_name_contains text DEFAULT NULL::text, p_ad_name_contains text DEFAULT NULL::text, p_group_key text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    SET plan_cache_mode TO 'force_custom_plan'
    AS $$
declare
  v_group_by text := lower(coalesce(p_group_by, 'ad_name'));
  v_date_start date := least(p_date_start, p_date_stop);
  v_date_stop date := greatest(p_date_start, p_date_stop);
  v_group_key text := trim(coalesce(p_group_key, ''));
  v_result jsonb;
  v_owners uuid[];
  v_requested integer;
begin
  -- p_user_id identifica o ATOR. Assinatura preservada: mudar a lista de
  -- parametros cria ambiguidade de overload no PostgREST (ver migration 095).
  if auth.uid() is distinct from p_user_id then
    raise exception 'Forbidden: p_user_id must match auth.uid()'
      using errcode = '42501';
  end if;

  -- Os donos do dado saem dos packs pedidos. Pack inacessivel nao volta do
  -- resolvedor, e a contagem denuncia: falhar alto e melhor que devolver
  -- agregado silenciosamente incompleto.
  if p_pack_ids is null then
    v_owners := array[p_user_id];
  else
    select array_agg(distinct a.owner_id), count(distinct a.pack_id)
      into v_owners, v_requested
    from public.resolve_pack_access(p_pack_ids, p_user_id) a;

    if coalesce(v_requested, 0) < (select count(distinct x) from unnest(p_pack_ids) x) then
      raise exception 'Forbidden: pack inacessivel na selecao'
        using errcode = '42501';
    end if;

    if v_owners is null or array_length(v_owners, 1) is null then
      v_owners := array[p_user_id];
    end if;
  end if;

  if v_group_by not in ('ad_id', 'ad_name', 'adset_id', 'campaign_id') then
    raise exception 'Invalid p_group_by: %, expected ad_id|ad_name|adset_id|campaign_id', v_group_by
      using errcode = '22023';
  end if;

  if v_group_key = '' then
    return jsonb_build_object('group_key', v_group_key, 'video_play_curve_actions', '[]'::jsonb);
  end if;

  -- P3.2: dirigido pelos DONOS resolvidos, nao filtrado por um user_id escalar.
  -- Medido na RPC principal: `am.user_id = any(v_owners)` faz o planner perder
  -- ad_metric_pack_map_user_pack_date_ad_idx e cair no PK varrendo todos os
  -- user_ids (67ms -> 4010ms). Dirigindo a partir dos donos, o nested loop liga
  -- as 4 colunas do indice composto. O ramo legado (p_pack_ids nulo, sem map
  -- para dirigir) fica no UNION ALL e o planner poda o ramo morto.
  with base_candidates as (
    select am.*
    from public.ad_metrics am
    where p_pack_ids is null
      and am.user_id = p_user_id
      and am.date >= v_date_start
      and am.date <= v_date_stop
      and (p_account_ids is null or am.account_id = any(p_account_ids))
      and (
        p_campaign_name_contains is null
        or p_campaign_name_contains = ''
        or coalesce(am.campaign_name, '') ilike '%' || p_campaign_name_contains || '%'
      )
      and (
        p_adset_name_contains is null
        or p_adset_name_contains = ''
        or coalesce(am.adset_name, '') ilike '%' || p_adset_name_contains || '%'
      )
      and (
        p_ad_name_contains is null
        or p_ad_name_contains = ''
        or coalesce(am.ad_name, '') ilike '%' || p_ad_name_contains || '%'
      )
    union all
    select am.*
    from unnest(v_owners) as o(owner_id)
    join public.ad_metrics am
      on am.user_id = o.owner_id
     and am.pack_id = any(p_pack_ids)
     and am.date >= v_date_start
     and am.date <= v_date_stop
    where p_pack_ids is not null
      and (p_account_ids is null or am.account_id = any(p_account_ids))
      and (
        p_campaign_name_contains is null
        or p_campaign_name_contains = ''
        or coalesce(am.campaign_name, '') ilike '%' || p_campaign_name_contains || '%'
      )
      and (
        p_adset_name_contains is null
        or p_adset_name_contains = ''
        or coalesce(am.adset_name, '') ilike '%' || p_adset_name_contains || '%'
      )
      and (
        p_ad_name_contains is null
        or p_ad_name_contains = ''
        or coalesce(am.ad_name, '') ilike '%' || p_ad_name_contains || '%'
      )
  ),
  -- P3.2: dedup CROSS-SILO. Vence o silo do DONO do pack compartilhado (o ator
  -- perde), desempate por uuid — estavel entre refreshes. Custo zero: o Postgres
  -- ja eliminava user_id da chave de ordenacao por ser constante.
  base as (
    select distinct on (am.ad_id, am.date)
      am.*
    from base_candidates am
    order by
      am.ad_id,
      am.date,
      (am.user_id = p_user_id),
      am.user_id,
      am.updated_at desc nulls last,
      am.created_at desc nulls last,
      am.id desc
  ),
  filtered as (
    select
      case
        when v_group_by = 'ad_id' then am.ad_id
        when v_group_by = 'ad_name' then coalesce(nullif(am.ad_name, ''), am.ad_id)
        when v_group_by = 'adset_id' then am.adset_id
        when v_group_by = 'campaign_id' then am.campaign_id
        else am.ad_id
      end as group_key,
      coalesce(am.video_total_plays, 0)::bigint as plays,
      case when jsonb_typeof(am.video_play_curve_actions) = 'array' then am.video_play_curve_actions else '[]'::jsonb end as curve
    from base am
  ),
  target as (
    select *
    from filtered
    where group_key = v_group_key
  ),
  curve_points as (
    select
      (cv.ord - 1)::integer as idx,
      sum(
        coalesce(
          nullif(regexp_replace(cv.val, '[^0-9.-]', '', 'g'), ''),
          '0'
        )::numeric * t.plays
      )::numeric as weighted_sum,
      sum(t.plays)::numeric as plays_sum
    from target t
    cross join lateral jsonb_array_elements_text(t.curve) with ordinality as cv(val, ord)
    where t.plays > 0
    group by (cv.ord - 1)
  ),
  max_idx as (
    select max(cp.idx) as max_idx
    from curve_points cp
  ),
  curve_out as (
    select
      jsonb_agg(
        coalesce(round(cp.weighted_sum / nullif(cp.plays_sum, 0))::int, 0)
        order by gs.idx
      ) as curve
    from max_idx mx
    cross join lateral generate_series(0, coalesce(mx.max_idx, -1)) as gs(idx)
    left join curve_points cp
      on cp.idx = gs.idx
  )
  select jsonb_build_object(
    'group_key', v_group_key,
    'video_play_curve_actions', coalesce((select curve from curve_out), '[]'::jsonb)
  )
  into v_result;

  return coalesce(v_result, jsonb_build_object('group_key', v_group_key, 'video_play_curve_actions', '[]'::jsonb));
end;
$$;


-- Os wrappers que o backend chama passam a apontar para a v145.
CREATE OR REPLACE FUNCTION public.fetch_manager_rankings_core_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text DEFAULT 'ad_name'::text, p_pack_ids uuid[] DEFAULT NULL::uuid[], p_account_ids text[] DEFAULT NULL::text[], p_campaign_name_contains text DEFAULT NULL::text, p_adset_name_contains text DEFAULT NULL::text, p_ad_name_contains text DEFAULT NULL::text, p_action_type text DEFAULT NULL::text, p_include_leadscore boolean DEFAULT true, p_include_available_conversion_types boolean DEFAULT true, p_limit integer DEFAULT 500, p_offset integer DEFAULT 0, p_order_by text DEFAULT 'spend'::text, p_campaign_id text DEFAULT NULL::text, p_include_custom boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_group_by text := lower(coalesce(p_group_by, 'ad_name'));
  v_payload jsonb;
  v_data jsonb := '[]'::jsonb;
begin
  select public.fetch_manager_performance_base_v145(
    p_user_id, p_date_start, p_date_stop, p_group_by, p_pack_ids, p_account_ids,
    p_campaign_name_contains, p_adset_name_contains, p_ad_name_contains, p_action_type,
    p_include_leadscore, p_include_available_conversion_types, p_limit, p_offset,
    p_order_by, p_campaign_id, p_include_custom
  )
  into v_payload;
  if coalesce(jsonb_typeof(v_payload), '') <> 'object' then
    return v_payload;
  end if;
  if v_group_by not in ('adset_id', 'campaign_id') then
    return v_payload;
  end if;
  with raw_rows as (
    select
      t.ord,
      t.item,
      nullif(trim(coalesce(t.item->>'adset_id', '')), '') as adset_id,
      nullif(trim(coalesce(t.item->>'campaign_id', '')), '') as campaign_id
    from jsonb_array_elements(
      case when jsonb_typeof(v_payload->'data') = 'array' then v_payload->'data' else '[]'::jsonb end
    ) with ordinality as t(item, ord)
  ),
  resolved_rows as (
    select
      rr.ord,
      rr.item || jsonb_build_object(
        'effective_status',
        case
          when v_group_by = 'adset_id' and rr.adset_id is not null then
            coalesce(
              nullif(pb_self.effective_status, ''),
              case
                when exists (
                  select 1 from public.ads a
                  where a.user_id = p_user_id and a.adset_id = rr.adset_id
                    and upper(coalesce(a.effective_status, '')) = 'ADSET_PAUSED'
                  limit 1
                ) then 'ADSET_PAUSED'
                when exists (
                  select 1 from public.ads a
                  where a.user_id = p_user_id and a.adset_id = rr.adset_id
                    and upper(coalesce(a.effective_status, '')) = 'CAMPAIGN_PAUSED'
                  limit 1
                ) then 'CAMPAIGN_PAUSED'
                else 'ACTIVE'
              end
            )
          when v_group_by = 'campaign_id' and rr.campaign_id is not null then
            coalesce(
              nullif(pb_self.effective_status, ''),
              case
                when exists (
                  select 1 from public.ads a
                  where a.user_id = p_user_id and a.campaign_id = rr.campaign_id
                    and upper(coalesce(a.effective_status, '')) = 'CAMPAIGN_PAUSED'
                  limit 1
                ) then 'CAMPAIGN_PAUSED'
                else 'ACTIVE'
              end
            )
          when v_group_by in ('adset_id', 'campaign_id') then 'ACTIVE'
          else rr.item->>'effective_status'
        end,
        'budget_daily', pb_self.daily_budget,
        'budget_lifetime', pb_self.lifetime_budget,
        'budget_mode', pb_mode.budget_mode,
        'budget_currency', acct.currency,
        'ad_count', coalesce(
          case when v_group_by = 'adset_id' then pb_self.ads_count else null end,
          nullif(rr.item->>'ad_count', '')::integer
        )
      ) as item
    from raw_rows rr
    left join lateral (
      select pb.daily_budget, pb.lifetime_budget, pb.account_id, pb.ads_count, pb.effective_status
      from public.parent_entities pb
      where pb.user_id = p_user_id
        and pb.entity_id = case when v_group_by = 'adset_id' then rr.adset_id else rr.campaign_id end
      limit 1
    ) pb_self on true
    left join lateral (
      select pb.budget_mode
      from public.parent_entities pb
      where pb.user_id = p_user_id and pb.entity_id = rr.campaign_id
      limit 1
    ) pb_mode on true
    left join lateral (
      select aa.currency
      from public.ad_accounts aa
      where aa.user_id = p_user_id
        and replace(aa.id, 'act_', '') = replace(pb_self.account_id, 'act_', '')
        and nullif(aa.currency, '') is not null
      limit 1
    ) acct on true
  )
  select coalesce(jsonb_agg(item order by ord), '[]'::jsonb)
  into v_data
  from resolved_rows;
  return v_payload || jsonb_build_object('data', v_data);
end;
$$;


CREATE OR REPLACE FUNCTION public.fetch_manager_rankings_series_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text DEFAULT 'ad_name'::text, p_pack_ids uuid[] DEFAULT NULL::uuid[], p_account_ids text[] DEFAULT NULL::text[], p_campaign_name_contains text DEFAULT NULL::text, p_adset_name_contains text DEFAULT NULL::text, p_ad_name_contains text DEFAULT NULL::text, p_action_type text DEFAULT NULL::text, p_group_keys text[] DEFAULT NULL::text[], p_window integer DEFAULT 5) RETURNS jsonb
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    SET plan_cache_mode TO 'force_custom_plan'
    AS $$
  select public.fetch_manager_performance_series_v145(
    p_user_id, p_date_start, p_date_stop, p_group_by, p_pack_ids, p_account_ids,
    p_campaign_name_contains, p_adset_name_contains, p_ad_name_contains, p_action_type,
    p_group_keys, p_window
  )
$$;


ALTER FUNCTION public.fetch_manager_performance_base_v145(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text, p_include_custom boolean) OWNER TO postgres;
GRANT ALL ON FUNCTION public.fetch_manager_performance_base_v145(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text, p_include_custom boolean) TO anon;
GRANT ALL ON FUNCTION public.fetch_manager_performance_base_v145(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text, p_include_custom boolean) TO authenticated;
GRANT ALL ON FUNCTION public.fetch_manager_performance_base_v145(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text, p_include_custom boolean) TO service_role;
ALTER FUNCTION public.fetch_manager_performance_series_v145(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_group_keys text[], p_window integer) OWNER TO postgres;
GRANT ALL ON FUNCTION public.fetch_manager_performance_series_v145(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_group_keys text[], p_window integer) TO anon;
GRANT ALL ON FUNCTION public.fetch_manager_performance_series_v145(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_group_keys text[], p_window integer) TO authenticated;
GRANT ALL ON FUNCTION public.fetch_manager_performance_series_v145(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_group_keys text[], p_window integer) TO service_role;
ALTER FUNCTION public.fetch_entity_performance_v145(p_user_id uuid, p_date_start date, p_date_stop date, p_entity text, p_entity_id text, p_pack_ids uuid[], p_group_by text, p_include_curve boolean, p_series_days integer, p_include_custom boolean) OWNER TO postgres;
GRANT ALL ON FUNCTION public.fetch_entity_performance_v145(p_user_id uuid, p_date_start date, p_date_stop date, p_entity text, p_entity_id text, p_pack_ids uuid[], p_group_by text, p_include_curve boolean, p_series_days integer, p_include_custom boolean) TO anon;
GRANT ALL ON FUNCTION public.fetch_entity_performance_v145(p_user_id uuid, p_date_start date, p_date_stop date, p_entity text, p_entity_id text, p_pack_ids uuid[], p_group_by text, p_include_curve boolean, p_series_days integer, p_include_custom boolean) TO authenticated;
GRANT ALL ON FUNCTION public.fetch_entity_performance_v145(p_user_id uuid, p_date_start date, p_date_stop date, p_entity text, p_entity_id text, p_pack_ids uuid[], p_group_by text, p_include_curve boolean, p_series_days integer, p_include_custom boolean) TO service_role;
COMMENT ON FUNCTION public.fetch_manager_performance_base_v145(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text, p_include_custom boolean) IS 'Manager (145): base da v142 sobre ad_metrics/ad_performance_daily com pack na chave. keys sem GROUP BY no ramo por pack (o bloqueio de selecao garante 1 pack por anuncio-dia); o ramo sem selecao mantem o dedup. JSON identico a v142 no diferencial.';
COMMENT ON FUNCTION public.fetch_manager_performance_series_v145(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_group_keys text[], p_window integer) IS 'Serie diaria do Manager (145): a v131 sobre a chave com pack.';
COMMENT ON FUNCTION public.fetch_entity_performance_v145(p_user_id uuid, p_date_start date, p_date_stop date, p_entity text, p_entity_id text, p_pack_ids uuid[], p_group_by text, p_include_curve boolean, p_series_days integer, p_include_custom boolean) IS 'Detalhe de uma entidade (145): a v135 sobre a chave com pack; packs_by_ad sem a segunda visita ao mapa.';


-- ===========================================================================
-- 11. Versoes mortas fora. Nenhuma e chamada pelo backend nem por wrapper vivo
--     (conferido por grep no backend e no schema). Deixa-las seria pior que
--     apaga-las: contra a chave nova, cada uma devolveria numero errado em
--     silencio se alguem a chamasse.
-- ===========================================================================
DROP FUNCTION IF EXISTS public.fetch_entity_performance_v133(p_user_id uuid, p_date_start date, p_date_stop date, p_entity text, p_entity_id text, p_pack_ids uuid[], p_group_by text, p_include_curve boolean, p_series_days integer);
DROP FUNCTION IF EXISTS public.fetch_entity_performance_v134(p_user_id uuid, p_date_start date, p_date_stop date, p_entity text, p_entity_id text, p_pack_ids uuid[], p_group_by text, p_include_curve boolean, p_series_days integer);
DROP FUNCTION IF EXISTS public.fetch_entity_performance_v135(p_user_id uuid, p_date_start date, p_date_stop date, p_entity text, p_entity_id text, p_pack_ids uuid[], p_group_by text, p_include_curve boolean, p_series_days integer, p_include_custom boolean);
DROP FUNCTION IF EXISTS public.fetch_manager_performance_base_v130(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text);
DROP FUNCTION IF EXISTS public.fetch_manager_performance_base_v132(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text);
DROP FUNCTION IF EXISTS public.fetch_manager_performance_base_v136(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text, p_include_parent_ids boolean);
DROP FUNCTION IF EXISTS public.fetch_manager_performance_base_v137(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text);
DROP FUNCTION IF EXISTS public.fetch_manager_performance_base_v138(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text);
DROP FUNCTION IF EXISTS public.fetch_manager_performance_base_v139(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text);
DROP FUNCTION IF EXISTS public.fetch_manager_performance_base_v140(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text, p_include_custom boolean);
DROP FUNCTION IF EXISTS public.fetch_manager_performance_base_v142(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text, p_include_custom boolean);
DROP FUNCTION IF EXISTS public.fetch_manager_performance_series_v131(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_group_keys text[], p_window integer);
DROP FUNCTION IF EXISTS public.fetch_manager_rankings_core_v2_base_v093(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text);
DROP FUNCTION IF EXISTS public.fetch_manager_rankings_core_v2_base_v104(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text);
DROP FUNCTION IF EXISTS public.fetch_manager_rankings_core_v2_base_v105(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text);
DROP FUNCTION IF EXISTS public.fetch_manager_rankings_core_v2_base_v115(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text);
DROP FUNCTION IF EXISTS public.fetch_manager_rankings_core_v2_base_v116(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text);


COMMIT;

ANALYZE public.ad_metrics;
ANALYZE public.ad_performance_daily;
