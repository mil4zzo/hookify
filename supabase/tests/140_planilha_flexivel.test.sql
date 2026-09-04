-- Teste da migration 140 (planilha flexível): custom_hist atravessa o rollup, o RPC de
-- enriquecimento grava/limpa, a checagem de consistência acusa adulteração direta, e as
-- RPCs somam histogramas por grupo — sem mudar o que a v139/v134 devolviam.
--
-- COMO RODAR (lab com a 140 aplicada, nunca prod):
--   psql -d hookify_lab -X -v ON_ERROR_STOP=1 -f supabase/tests/140_planilha_flexivel.test.sql
-- Sai com código 0 e "OK: N asserções", ou para na primeira asserção que falhar.
-- Tudo numa transação e termina em ROLLBACK.
--
-- SABOTAGENS (o teste TEM de falhar com cada uma, ver README):
--   1. ALTER TABLE public.ad_metrics DISABLE TRIGGER ad_metrics_rollup_sync_upd;  → falha em A
--   2. Tirar `d.custom_hist` do CTE `stored` do consistency_check                  → falha em C
--   3. Trocar `sum(v.value::bigint)` por `max(...)` no custom_by_group da v140      → falha em D

\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned
BEGIN;

CREATE TEMP TABLE t_counter (n integer NOT NULL);
INSERT INTO t_counter VALUES (0);

CREATE FUNCTION pg_temp.expect(p_label text, p_got text, p_want text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p_got IS DISTINCT FROM p_want THEN
    RAISE EXCEPTION E'FALHOU: %\n   esperado: %\n   obtido:   %', p_label, p_want, p_got;
  END IF;
  UPDATE t_counter SET n = n + 1;
END $$;

-- ---------------------------------------------------------------------------
-- Alvo: um pack real com integração de planilha e leads, do dono dele.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE t_alvo AS
SELECT p.id AS pack_id, p.user_id, p.date_start, p.date_stop, p.sheet_integration_id
FROM public.packs p
WHERE p.sheet_integration_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.ad_metric_pack_map m
    JOIN public.ad_metrics am ON am.user_id = m.user_id AND am.ad_id = m.ad_id AND am.date = m.metric_date
    WHERE m.pack_id = p.id AND cardinality(am.leadscore_values) > 0
  )
ORDER BY (SELECT count(*) FROM public.ad_metric_pack_map m WHERE m.pack_id = p.id) DESC
LIMIT 1;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM t_alvo) THEN
    RAISE EXCEPTION 'nenhum pack com planilha e leads no laboratório';
  END IF;
END $$;

-- Dois anúncio-dias do pack com leads (chave (user_id, id): ver achado 1 do plano)
CREATE TEMP TABLE t_rows AS
SELECT am.user_id, am.id, am.ad_id, am.date
FROM t_alvo a
JOIN public.ad_metric_pack_map m ON m.pack_id = a.pack_id
JOIN public.ad_metrics am ON am.user_id = m.user_id AND am.ad_id = m.ad_id AND am.date = m.metric_date
WHERE cardinality(am.leadscore_values) > 0
ORDER BY am.date, am.ad_id
LIMIT 2;

-- Vínculos de teste (ids fixos; somem no ROLLBACK)
INSERT INTO public.sheet_column_mappings (id, integration_id, owner_id, column_index, column_name, label, kind, config, position)
SELECT 'aaaaaaaa-0000-4000-8000-000000000001'::uuid, a.sheet_integration_id, a.user_id, 90, 'T_IDADE', 'Idade (teste)', 'number', '{}'::jsonb, 0 FROM t_alvo a
UNION ALL
SELECT 'aaaaaaaa-0000-4000-8000-000000000002'::uuid, a.sheet_integration_id, a.user_id, 91, 'T_FAIXA', 'Faixa (teste)', 'category', '{}'::jsonb, 1 FROM t_alvo a;

-- O ator é o dono (RPCs exigem auth.uid() = p_user_id)
SELECT set_config('request.jwt.claims', json_build_object('sub', (SELECT user_id FROM t_alvo))::text, true);

-- ---------------------------------------------------------------------------
-- A. batch_update_ad_metrics_enrichment grava custom_hist e o trigger leva ao rollup
-- ---------------------------------------------------------------------------
SELECT public.batch_update_ad_metrics_enrichment(
  (SELECT user_id FROM t_alvo),
  jsonb_build_array(
    jsonb_build_object(
      'ids', (SELECT jsonb_agg(id) FROM t_rows),
      'custom_hist', '{"aaaaaaaa-0000-4000-8000-000000000001": {"25": 2, "31": 1},
                       "aaaaaaaa-0000-4000-8000-000000000002": {"A": 2, "B": 1}}'::jsonb
    )
  ),
  (SELECT pack_id FROM t_alvo)
) AS res \gset
SELECT pg_temp.expect('A0 rpc status', (:'res'::jsonb)->>'status', 'success');
SELECT pg_temp.expect('A0 rows_updated', (:'res'::jsonb)->>'total_rows_updated', '2');

SELECT pg_temp.expect('A1 ad_metrics tem o histograma',
  (SELECT count(*)::text FROM public.ad_metrics am JOIN t_rows r ON r.user_id = am.user_id AND r.id = am.id
    WHERE am.custom_hist = '{"aaaaaaaa-0000-4000-8000-000000000001": {"25": 2, "31": 1}, "aaaaaaaa-0000-4000-8000-000000000002": {"A": 2, "B": 1}}'::jsonb),
  '2');
SELECT pg_temp.expect('A2 rollup acompanhou (trigger de UPDATE)',
  (SELECT count(*)::text FROM public.ad_performance_daily d JOIN t_rows r ON r.user_id = d.user_id AND r.ad_id = d.ad_id AND r.date = d.date
    WHERE d.custom_hist = '{"aaaaaaaa-0000-4000-8000-000000000001": {"25": 2, "31": 1}, "aaaaaaaa-0000-4000-8000-000000000002": {"A": 2, "B": 1}}'::jsonb),
  '2');
SELECT pg_temp.expect('A3 leadscore_values intocado (item sem a chave)',
  (SELECT count(*)::text FROM public.ad_metrics am JOIN t_rows r ON r.user_id = am.user_id AND r.id = am.id WHERE cardinality(am.leadscore_values) > 0),
  '2');

-- ---------------------------------------------------------------------------
-- B. {} limpa (NULL) e item sem a chave mantém
-- ---------------------------------------------------------------------------
SELECT public.batch_update_ad_metrics_enrichment(
  (SELECT user_id FROM t_alvo),
  jsonb_build_array(jsonb_build_object('ids', (SELECT jsonb_agg(s.id) FROM (SELECT id FROM t_rows ORDER BY id LIMIT 1) s), 'custom_hist', '{}'::jsonb)),
  (SELECT pack_id FROM t_alvo)
) AS res_b \gset
SELECT pg_temp.expect('B1 {} vira NULL em ad_metrics',
  (SELECT (am.custom_hist IS NULL)::text FROM public.ad_metrics am JOIN (SELECT * FROM t_rows ORDER BY id LIMIT 1) r ON r.user_id = am.user_id AND r.id = am.id),
  'true');
SELECT pg_temp.expect('B2 e no rollup',
  (SELECT (d.custom_hist IS NULL)::text FROM public.ad_performance_daily d JOIN (SELECT * FROM t_rows ORDER BY id LIMIT 1) r ON r.user_id = d.user_id AND r.ad_id = d.ad_id AND r.date = d.date),
  'true');
SELECT public.batch_update_ad_metrics_enrichment(
  (SELECT user_id FROM t_alvo),
  jsonb_build_array(jsonb_build_object('ids', (SELECT jsonb_agg(id) FROM t_rows), 'leadscore_values', '[50]'::jsonb)),
  (SELECT pack_id FROM t_alvo)
) AS res_b2 \gset
SELECT pg_temp.expect('B3 item sem custom_hist mantém o da outra linha',
  (SELECT count(*)::text FROM public.ad_metrics am JOIN t_rows r ON r.user_id = am.user_id AND r.id = am.id WHERE am.custom_hist IS NOT NULL),
  '1');

-- Repõe o histograma nas duas linhas para as próximas seções
SELECT public.batch_update_ad_metrics_enrichment(
  (SELECT user_id FROM t_alvo),
  jsonb_build_array(jsonb_build_object('ids', (SELECT jsonb_agg(id) FROM t_rows),
    'custom_hist', '{"aaaaaaaa-0000-4000-8000-000000000001": {"25": 2, "31": 1}, "aaaaaaaa-0000-4000-8000-000000000002": {"A": 2, "B": 1}}'::jsonb)),
  (SELECT pack_id FROM t_alvo)
) AS res_b3 \gset

-- ---------------------------------------------------------------------------
-- C. Sabotagem embutida: adulterar o rollup por fora do trigger TEM de ser acusado
-- ---------------------------------------------------------------------------
-- Checagem ESCOPADA às duas linhas (a função real varre o usuário inteiro: ~3 min no
-- lab; usada uma vez só, em C1, que é onde a sabotagem precisa ser provada).
CREATE FUNCTION pg_temp.scoped_diffs() RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*)
  FROM t_rows r
  JOIN public.ad_metrics am ON am.user_id = r.user_id AND am.id = r.id
  CROSS JOIN LATERAL public.ad_performance_derive_row(am) x
  JOIN public.ad_performance_daily d ON d.user_id = r.user_id AND d.ad_id = r.ad_id AND d.date = r.date
  WHERE ROW(x.custom_hist, x.lead_scores, x.lead_qtys, x.spend, x.impressions)
        IS DISTINCT FROM ROW(d.custom_hist, d.lead_scores, d.lead_qtys, d.spend, d.impressions)
$$;
SELECT pg_temp.expect('C0 antes: consistente', pg_temp.scoped_diffs()::text, '0');
UPDATE public.ad_performance_daily d
SET custom_hist = '{"aaaaaaaa-0000-4000-8000-000000000001": {"25": 999}}'::jsonb
FROM (SELECT * FROM t_rows ORDER BY id LIMIT 1) r
WHERE d.user_id = r.user_id AND d.ad_id = r.ad_id AND d.date = r.date;
SELECT pg_temp.expect('C1 adulteração direta é acusada (missing=1, extra=1)',
  (SELECT missing::text || '/' || extra::text FROM public.ad_performance_rollup_consistency_check((SELECT user_id FROM t_alvo))),
  '1/1');
-- reparo pontual pelo worker do rollup
SELECT public.ad_performance_rollup_apply((SELECT array_agg(ROW(r.user_id, r.ad_id, r.date)::public.ad_metric_key) FROM t_rows r));
SELECT pg_temp.expect('C2 depois do reparo: consistente', pg_temp.scoped_diffs()::text, '0');

-- ---------------------------------------------------------------------------
-- D. RPC v140 soma os histogramas por grupo (contra uma agregação manual)
-- ---------------------------------------------------------------------------
-- Esperado: por ad_name, dentro do pack e do período do pack, somando as duas linhas.
CREATE TEMP TABLE t_expected AS
WITH sel AS (
  SELECT d.*
  FROM t_alvo a
  JOIN public.ad_metric_pack_map m ON m.pack_id = a.pack_id
  JOIN public.ad_performance_daily d ON d.user_id = m.user_id AND d.ad_id = m.ad_id AND d.date = m.metric_date
  WHERE d.date BETWEEN a.date_start AND a.date_stop AND d.custom_hist IS NOT NULL
)
SELECT gk, jsonb_object_agg(mapping_id, hist) AS custom_histograms
FROM (
  SELECT gk, mapping_id, jsonb_object_agg(val, qty) AS hist
  FROM (
    SELECT coalesce(nullif(s.ad_name, ''), s.ad_id) AS gk, m.key AS mapping_id, v.key AS val, sum(v.value::bigint) AS qty
    FROM sel s
    CROSS JOIN LATERAL jsonb_each(s.custom_hist) m
    CROSS JOIN LATERAL jsonb_each_text(m.value) v
    GROUP BY 1, 2, 3
  ) x GROUP BY gk, mapping_id
) y GROUP BY gk;

SELECT public.fetch_manager_performance_base_v140(
  (SELECT user_id FROM t_alvo), (SELECT date_start FROM t_alvo), (SELECT date_stop FROM t_alvo),
  'ad_name', ARRAY[(SELECT pack_id FROM t_alvo)], NULL, NULL, NULL, NULL, NULL,
  true, false, 10000, 0, 'spend', NULL, true) AS v140_on \gset

SELECT pg_temp.expect('D1 todo grupo esperado aparece com o histograma igual',
  (SELECT count(*)::text FROM t_expected e
    WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements((:'v140_on'::jsonb)->'data') it
      WHERE it->>'group_key' = e.gk AND it->'custom_histograms' = e.custom_histograms)),
  '0');
SELECT pg_temp.expect('D2 grupo sem vínculo devolve {}',
  (SELECT count(*)::text FROM jsonb_array_elements((:'v140_on'::jsonb)->'data') it
    WHERE it->>'group_key' NOT IN (SELECT gk FROM t_expected) AND it->'custom_histograms' <> '{}'::jsonb),
  '0');
SELECT pg_temp.expect('D3 há pelo menos um grupo com histograma',
  (SELECT (count(*) > 0)::text FROM t_expected), 'true');

-- ---------------------------------------------------------------------------
-- E. Contrato intacto: v140 sem o parâmetro == v139, tirando a chave nova
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.strip_custom(p jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT (p - 'data') || jsonb_build_object('data',
    coalesce((SELECT jsonb_agg(it - 'custom_histograms') FROM jsonb_array_elements(p->'data') it), '[]'::jsonb))
$$;
DO $$
DECLARE
  a t_alvo%ROWTYPE;
  gb text;
  v139 jsonb; v140 jsonb;
BEGIN
  SELECT * INTO a FROM t_alvo;
  FOREACH gb IN ARRAY ARRAY['ad_name', 'ad_id', 'adset_id', 'campaign_id'] LOOP
    v139 := public.fetch_manager_performance_base_v139(a.user_id, a.date_start, a.date_stop, gb, ARRAY[a.pack_id], NULL, NULL, NULL, NULL, NULL, true, true, 200, 0, 'spend', NULL);
    v140 := public.fetch_manager_performance_base_v140(a.user_id, a.date_start, a.date_stop, gb, ARRAY[a.pack_id], NULL, NULL, NULL, NULL, NULL, true, true, 200, 0, 'spend', NULL, false);
    PERFORM pg_temp.expect('E ' || gb || ': v140(false) == v139 sem custom_histograms', (pg_temp.strip_custom(v140) = v139)::text, 'true');
    PERFORM pg_temp.expect('E ' || gb || ': sem o parâmetro toda linha traz {}',
      (SELECT count(*)::text FROM jsonb_array_elements(v140->'data') it WHERE it->'custom_histograms' <> '{}'::jsonb), '0');
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- F. Entry repontada e v135 (detalhe) com totals.custom_histograms
-- ---------------------------------------------------------------------------
SELECT public.fetch_manager_rankings_core_v2(
  p_user_id => (SELECT user_id FROM t_alvo), p_date_start => (SELECT date_start FROM t_alvo), p_date_stop => (SELECT date_stop FROM t_alvo),
  p_group_by => 'ad_name', p_pack_ids => ARRAY[(SELECT pack_id FROM t_alvo)], p_limit => 10000, p_include_custom => true) AS entry_on \gset
SELECT pg_temp.expect('F1 entry passa p_include_custom',
  (SELECT count(*)::text FROM jsonb_array_elements((:'entry_on'::jsonb)->'data') it WHERE it->'custom_histograms' <> '{}'::jsonb),
  (SELECT count(*)::text FROM t_expected));

DO $$
DECLARE
  a t_alvo%ROWTYPE;
  gk text;
  det jsonb;
  det_off jsonb;
  want jsonb;
BEGIN
  SELECT * INTO a FROM t_alvo;
  SELECT e.gk, e.custom_histograms INTO gk, want FROM t_expected e ORDER BY e.gk LIMIT 1;
  det := public.fetch_entity_performance_v135(
    p_user_id => a.user_id, p_date_start => a.date_start, p_date_stop => a.date_stop,
    p_entity => 'ad_name', p_entity_id => gk, p_pack_ids => ARRAY[a.pack_id], p_group_by => 'entity',
    p_include_curve => false, p_series_days => 5, p_include_custom => true);
  PERFORM pg_temp.expect('F2 v135 totals.custom_histograms == esperado',
    (det->'groups'->0->'totals'->'custom_histograms')::text, want::text);
  det_off := public.fetch_entity_performance_v135(
    p_user_id => a.user_id, p_date_start => a.date_start, p_date_stop => a.date_stop,
    p_entity => 'ad_name', p_entity_id => gk, p_pack_ids => ARRAY[a.pack_id], p_group_by => 'entity',
    p_include_curve => false, p_series_days => 5, p_include_custom => false);
  PERFORM pg_temp.expect('F3 v135 sem o parâmetro devolve {}',
    (det_off->'groups'->0->'totals'->'custom_histograms')::text, '{}');
  PERFORM pg_temp.expect('F4 v135 sem o parâmetro == v134 (tirando a chave)',
    ((det_off #- '{groups,0,totals,custom_histograms}') = public.fetch_entity_performance_v134(
      p_user_id => a.user_id, p_date_start => a.date_start, p_date_stop => a.date_stop,
      p_entity => 'ad_name', p_entity_id => gk, p_pack_ids => ARRAY[a.pack_id], p_group_by => 'entity',
      p_include_curve => false, p_series_days => 5))::text, 'true');
END $$;

SELECT 'OK: ' || n || ' asserções' FROM t_counter;
ROLLBACK;
