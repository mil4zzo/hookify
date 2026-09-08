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
-- @@BASE_V145@@

-- @@SERIES_V145@@

-- @@ENTITY_V145@@

-- @@RETENTION_V2@@

-- Os wrappers que o backend chama passam a apontar para a v145.
-- @@CORE_V2@@

-- @@SERIES_V2@@

-- @@GRANTS_V145@@

-- ===========================================================================
-- 11. Versoes mortas fora. Nenhuma e chamada pelo backend nem por wrapper vivo
--     (conferido por grep no backend e no schema). Deixa-las seria pior que
--     apaga-las: contra a chave nova, cada uma devolveria numero errado em
--     silencio se alguem a chamasse.
-- ===========================================================================
-- @@DROPS@@

COMMIT;

ANALYZE public.ad_metrics;
ANALYZE public.ad_performance_daily;
