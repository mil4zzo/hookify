-- Validacao da migration 145 — parte 2: DEPOIS.
--
-- Roda no laboratorio JA COM a 145. Para cada retrato guardado por
-- lab_145_antes.sql, chama a RPC nova com os mesmos argumentos e compara o
-- JSON inteiro. Depois confere as invariantes estruturais.
--
--   psql -d hookify_lab -X -v ON_ERROR_STOP=1 -f supabase/tests/lab_145_depois.sql
-- Termina com "OK: N comparacoes identicas" ou falha na primeira divergencia.

\set ON_ERROR_STOP on
\pset pager off

SELECT payload->>'uid' AS uid, payload->>'pk1' AS pk1, payload->>'pk2' AS pk2,
       payload->>'d0' AS d0, payload->>'d1' AS d1, payload->>'nome' AS nome,
       payload->>'conjunto' AS conjunto
FROM lab_snapshot WHERE name = '_alvo' \gset
SELECT array_agg(x)::text AS todos FROM jsonb_array_elements_text((SELECT payload->'todos' FROM lab_snapshot WHERE name='_alvo')) x \gset

SELECT set_config('request.jwt.claims', json_build_object('sub', :'uid', 'role', 'authenticated')::text, false);

DROP TABLE IF EXISTS lab_depois;
CREATE TEMP TABLE lab_depois (name text PRIMARY KEY, payload jsonb);

INSERT INTO lab_depois VALUES ('manager_ad_name', public.fetch_manager_rankings_core_v2(
  p_user_id => :'uid', p_date_start => :'d0', p_date_stop => :'d1', p_group_by => 'ad_name', p_pack_ids => ARRAY[:'pk1']::uuid[]));
INSERT INTO lab_depois VALUES ('manager_adset_filtro', public.fetch_manager_rankings_core_v2(
  p_user_id => :'uid', p_date_start => :'d0', p_date_stop => :'d1', p_group_by => 'adset_id', p_pack_ids => ARRAY[:'pk1']::uuid[], p_campaign_name_contains => 'cap'));
INSERT INTO lab_depois VALUES ('manager_2packs_ad_id_custom', public.fetch_manager_rankings_core_v2(
  p_user_id => :'uid', p_date_start => :'d0', p_date_stop => :'d1', p_group_by => 'ad_id', p_pack_ids => ARRAY[:'pk1', :'pk2']::uuid[], p_include_custom => true));
INSERT INTO lab_depois VALUES ('manager_campaign', public.fetch_manager_rankings_core_v2(
  p_user_id => :'uid', p_date_start => :'d0', p_date_stop => :'d1', p_group_by => 'campaign_id', p_pack_ids => ARRAY[:'pk1']::uuid[]));
INSERT INTO lab_depois VALUES ('series_ad_name', public.fetch_manager_rankings_series_v2(
  p_user_id => :'uid', p_date_start => :'d0', p_date_stop => :'d1', p_group_by => 'ad_name', p_pack_ids => ARRAY[:'pk1']::uuid[],
  p_group_keys => ARRAY[:'nome']::text[]));
INSERT INTO lab_depois VALUES ('entity_nome', public.fetch_entity_performance_v145(
  :'uid', :'d0', :'d1', 'ad_name', :'nome', ARRAY[:'pk1']::uuid[]));
INSERT INTO lab_depois VALUES ('entity_nome_filhos', public.fetch_entity_performance_v145(
  :'uid', :'d0', :'d1', 'ad_name', :'nome', ARRAY[:'pk1']::uuid[], 'ad_id'));
INSERT INTO lab_depois VALUES ('entity_adset_curva', public.fetch_entity_performance_v145(
  :'uid', :'d0', :'d1', 'adset_id', :'conjunto', ARRAY[:'pk1']::uuid[], 'entity', true));
INSERT INTO lab_depois VALUES ('retention_nome', public.fetch_manager_rankings_retention_v2(
  p_user_id => :'uid', p_date_start => :'d0', p_date_stop => :'d1', p_group_by => 'ad_name', p_pack_ids => ARRAY[:'pk1']::uuid[], p_group_key => :'nome'));
INSERT INTO lab_depois VALUES ('conflitos', (SELECT coalesce(jsonb_agg(jsonb_build_object('a', pack_a, 'b', pack_b) ORDER BY pack_a, pack_b), '[]'::jsonb)
  FROM public.detect_pack_conflicts(:'todos'::uuid[], :'uid')));
-- a previa da limpeza: os campos de compartilhamento passam a ser 0 por contrato;
-- o resto tem de bater
INSERT INTO lab_depois VALUES ('clear_previa', public.clear_ad_metrics_enrichment(:'uid', :'pk1', true)
  - 'rows_shared_with_other_packs' - 'other_packs_affected');
UPDATE lab_snapshot SET payload = payload - 'rows_shared_with_other_packs' - 'other_packs_affected' WHERE name = 'clear_previa';

\echo ''
\echo '=========== DIFERENCIAL antes x depois (JSON inteiro) ==========='
SELECT a.name,
       CASE WHEN a.payload = d.payload THEN 'IDENTICO' ELSE '>>> DIVERGIU <<<' END AS veredito,
       pg_size_pretty(length(a.payload::text)::bigint) AS tamanho
FROM lab_snapshot a JOIN lab_depois d USING (name)
ORDER BY a.name;

DO $$
DECLARE v_bad int; v_ok int;
BEGIN
  SELECT count(*) FILTER (WHERE a.payload <> d.payload), count(*) FILTER (WHERE a.payload = d.payload)
  INTO v_bad, v_ok
  FROM lab_snapshot a JOIN lab_depois d USING (name);
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'DIFERENCIAL FALHOU: % comparacao(oes) divergiram', v_bad;
  END IF;
  RAISE NOTICE 'OK: % comparacoes identicas', v_ok;
END $$;

\echo ''
\echo '=========== INVARIANTES ESTRUTURAIS ==========='
DO $$
DECLARE
  antes jsonb := (SELECT payload FROM lab_snapshot WHERE name = 'contagens');
  v int; v2 int; v3 numeric;
BEGIN
  -- 1. ad_metrics = antes - orfas (producao: sem duplicacao)
  SELECT count(*) INTO v FROM ad_metrics;
  IF v <> (antes->>'ad_metrics')::int - (antes->>'orfas')::int THEN
    RAISE EXCEPTION 'ad_metrics: esperado % (antes - orfas), obtido %', (antes->>'ad_metrics')::int - (antes->>'orfas')::int, v;
  END IF;
  -- 2. rollup espelha ad_metrics 1:1
  SELECT count(*) INTO v2 FROM ad_performance_daily;
  IF v2 <> v THEN RAISE EXCEPTION 'rollup: % linhas, ad_metrics: %', v2, v; END IF;
  -- 3. toda linha tem pack e toda linha do mapa tem sua linha (FK garante; conferir de todo modo)
  SELECT count(*) INTO v FROM ad_metrics WHERE pack_id IS NULL;
  IF v > 0 THEN RAISE EXCEPTION '% linhas sem pack', v; END IF;
  SELECT count(*) INTO v FROM ad_metric_pack_map m WHERE NOT EXISTS
    (SELECT 1 FROM ad_metrics am WHERE am.user_id=m.user_id AND am.pack_id=m.pack_id AND am.ad_id=m.ad_id AND am.date=m.metric_date);
  IF v > 0 THEN RAISE EXCEPTION '% linhas do mapa sem linha em ad_metrics', v; END IF;
  SELECT count(*) INTO v FROM ad_metrics am WHERE NOT EXISTS
    (SELECT 1 FROM ad_metric_pack_map m WHERE m.user_id=am.user_id AND m.pack_id=am.pack_id AND m.ad_id=am.ad_id AND m.metric_date=am.date);
  IF v > 0 THEN RAISE EXCEPTION '% linhas de ad_metrics sem vinculo no mapa', v; END IF;
  -- 4. o gasto total nao mudou (as orfas nao contavam: nao estavam em pack nenhum)
  SELECT round(sum(spend)::numeric, 2) INTO v3 FROM ad_metrics;
  IF v3 <> (antes->>'spend_total')::numeric THEN
    RAISE EXCEPTION 'spend total: antes %, depois %', antes->>'spend_total', v3;
  END IF;
  -- 5. o leadscore importado sobreviveu (fora das orfas)
  SELECT count(*) INTO v FROM ad_metrics WHERE leadscore_values IS NOT NULL;
  RAISE NOTICE 'leadscore: % linhas antes (incl. orfas), % depois', antes->>'leadscore_rows', v;
  -- 6. PK e indices esperados
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE tablename='ad_metrics' AND indexdef LIKE '%(user_id, pack_id, ad_id, date)%') THEN
    RAISE EXCEPTION 'PK nova de ad_metrics nao encontrada';
  END IF;
  SELECT count(*) INTO v FROM pg_indexes WHERE tablename = 'ad_metrics';
  IF v <> 4 THEN RAISE EXCEPTION 'ad_metrics deveria ter 4 indices (pk, id_user, user_pack_date, ad_id); tem %', v; END IF;
  -- 7. gatilhos de volta, tipo com pack
  SELECT count(*) INTO v FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relname='ad_metrics' AND NOT t.tgisinternal;
  IF v <> 2 THEN RAISE EXCEPTION 'esperados 2 gatilhos em ad_metrics, ha %', v; END IF;
  -- 8. versoes mortas fora, vivas dentro
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname IN ('fetch_manager_performance_base_v142','fetch_manager_performance_series_v131','fetch_entity_performance_v135','fetch_manager_rankings_core_v2_base_v116')) THEN
    RAISE EXCEPTION 'versao morta ainda existe';
  END IF;
  IF (SELECT count(*) FROM pg_proc WHERE proname IN ('fetch_manager_performance_base_v145','fetch_manager_performance_series_v145','fetch_entity_performance_v145')) <> 3 THEN
    RAISE EXCEPTION 'faltou funcao v145';
  END IF;
  RAISE NOTICE 'OK: invariantes estruturais';
END $$;

\echo ''
\echo '=========== O GATILHO NOVO FUNCIONA: update de leadscore num pack nao toca o rollup do outro ==========='
BEGIN;
DO $$
DECLARE
  r record; before_ls numeric[]; after_ls numeric[]; other_before numeric[]; other_after numeric[];
BEGIN
  -- um anuncio-dia qualquer com leadscore, e o rollup dele
  SELECT am.user_id, am.pack_id, am.ad_id, am.date INTO r FROM ad_metrics am
   WHERE am.leadscore_values IS NOT NULL LIMIT 1;
  SELECT lead_scores INTO before_ls FROM ad_performance_daily d
   WHERE d.user_id=r.user_id AND d.pack_id=r.pack_id AND d.ad_id=r.ad_id AND d.date=r.date;
  UPDATE ad_metrics SET leadscore_values = ARRAY[42.0, 42.0, 99.0]
   WHERE user_id=r.user_id AND pack_id=r.pack_id AND ad_id=r.ad_id AND date=r.date;
  SELECT lead_scores INTO after_ls FROM ad_performance_daily d
   WHERE d.user_id=r.user_id AND d.pack_id=r.pack_id AND d.ad_id=r.ad_id AND d.date=r.date;
  IF after_ls IS NOT DISTINCT FROM before_ls THEN RAISE EXCEPTION 'gatilho nao recompos o rollup'; END IF;
  IF NOT (after_ls @> ARRAY[42.0::numeric, 99.0::numeric]) THEN RAISE EXCEPTION 'rollup recomposto com valores errados: %', after_ls; END IF;
  RAISE NOTICE 'OK: gatilho recompoe o rollup do pack (% -> %)', before_ls, after_ls;
END $$;
ROLLBACK;

\echo ''
\echo 'Validacao da 145 concluida.'
