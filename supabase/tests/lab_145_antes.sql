-- Validacao da migration 145 — parte 1: o RETRATO ANTES.
--
-- Roda no laboratorio AINDA SEM a 145. Guarda em lab_snapshot o JSON inteiro de
-- cada RPC viva para telas reais, mais as contagens. lab_145_depois.sql compara.
-- Tambem apaga os artefatos do experimento (lab_*), que nao fazem parte do banco.
--
--   psql -d hookify_lab -X -v ON_ERROR_STOP=1 -f supabase/tests/lab_145_antes.sql

\set ON_ERROR_STOP on
\pset pager off

-- artefatos do experimento fora (nao sao parte do schema)
DROP FUNCTION IF EXISTS public.lab_manager_v2(uuid, date, date, text, uuid[], text[], text, text, text, text, boolean, boolean, integer, integer, text, text, boolean);
DROP FUNCTION IF EXISTS public.lab_manager_v2s(uuid, date, date, text, uuid[], text[], text, text, text, text, boolean, boolean, integer, integer, text, text, boolean);
DROP FUNCTION IF EXISTS public.lab_entity_v2(uuid, date, date, text, text, uuid[], text, boolean, integer);
DROP FUNCTION IF EXISTS public.lab_rollup_apply_v2(public.lab_key_v2[]);
DROP FUNCTION IF EXISTS public.lab_derive_row_v2(public.lab_ad_metrics_v2);
DROP TYPE IF EXISTS public.lab_key_v2 CASCADE;
DROP TABLE IF EXISTS public.lab_ad_metrics_v2;
DROP TABLE IF EXISTS public.lab_rollup_v2;

DROP TABLE IF EXISTS public.lab_snapshot;
CREATE TABLE public.lab_snapshot (name text PRIMARY KEY, payload jsonb);

-- alvo: o dono do maior pack, o periodo dele, um segundo pack do mesmo dono,
-- a entidade mais gasta por nome e por conjunto
SELECT p.user_id AS uid, p.id AS pk1, p.date_start AS d0, p.date_stop AS d1
FROM ad_metric_pack_map apm JOIN packs p ON p.id = apm.pack_id
GROUP BY 1,2,3,4 ORDER BY count(*) DESC LIMIT 1 \gset
SELECT p.id AS pk2 FROM packs p WHERE p.user_id = :'uid' AND p.id <> :'pk1'
ORDER BY (SELECT count(*) FROM ad_metric_pack_map m WHERE m.pack_id = p.id) DESC LIMIT 1 \gset
SELECT d.ad_name AS nome FROM ad_metric_pack_map m JOIN ad_performance_daily d
  ON d.user_id = m.user_id AND d.ad_id = m.ad_id AND d.date = m.metric_date
WHERE m.pack_id = :'pk1' GROUP BY 1 ORDER BY sum(d.spend) DESC LIMIT 1 \gset
SELECT d.adset_id AS conjunto FROM ad_metric_pack_map m JOIN ad_performance_daily d
  ON d.user_id = m.user_id AND d.ad_id = m.ad_id AND d.date = m.metric_date
WHERE m.pack_id = :'pk1' GROUP BY 1 ORDER BY sum(d.spend) DESC LIMIT 1 \gset
SELECT array_agg(id)::text AS todos FROM packs WHERE user_id = :'uid' \gset

SELECT set_config('request.jwt.claims', json_build_object('sub', :'uid', 'role', 'authenticated')::text, false);

-- os parametros do alvo, para o "depois" usar exatamente os mesmos
INSERT INTO lab_snapshot VALUES ('_alvo', jsonb_build_object(
  'uid', :'uid', 'pk1', :'pk1', 'pk2', :'pk2', 'd0', :'d0', 'd1', :'d1',
  'nome', :'nome', 'conjunto', :'conjunto', 'todos', :'todos'::uuid[]));

INSERT INTO lab_snapshot VALUES ('contagens', jsonb_build_object(
  'ad_metrics', (SELECT count(*) FROM ad_metrics),
  'rollup', (SELECT count(*) FROM ad_performance_daily),
  'mapa', (SELECT count(*) FROM ad_metric_pack_map),
  'orfas', (SELECT count(*) FROM ad_metrics am WHERE NOT EXISTS (SELECT 1 FROM ad_metric_pack_map m
            WHERE m.user_id=am.user_id AND m.ad_id=am.ad_id AND m.metric_date=am.date)),
  'spend_total', (SELECT round(sum(spend)::numeric, 2) FROM ad_metrics am WHERE EXISTS (SELECT 1 FROM ad_metric_pack_map m
            WHERE m.user_id=am.user_id AND m.ad_id=am.ad_id AND m.metric_date=am.date)),
  'leadscore_rows', (SELECT count(*) FROM ad_metrics WHERE leadscore_values IS NOT NULL)));

-- Manager (wrapper que o backend chama), 3 telas
INSERT INTO lab_snapshot VALUES ('manager_ad_name', public.fetch_manager_rankings_core_v2(
  p_user_id => :'uid', p_date_start => :'d0', p_date_stop => :'d1', p_group_by => 'ad_name', p_pack_ids => ARRAY[:'pk1']::uuid[]));
INSERT INTO lab_snapshot VALUES ('manager_adset_filtro', public.fetch_manager_rankings_core_v2(
  p_user_id => :'uid', p_date_start => :'d0', p_date_stop => :'d1', p_group_by => 'adset_id', p_pack_ids => ARRAY[:'pk1']::uuid[], p_campaign_name_contains => 'cap'));
INSERT INTO lab_snapshot VALUES ('manager_2packs_ad_id_custom', public.fetch_manager_rankings_core_v2(
  p_user_id => :'uid', p_date_start => :'d0', p_date_stop => :'d1', p_group_by => 'ad_id', p_pack_ids => ARRAY[:'pk1', :'pk2']::uuid[], p_include_custom => true));
INSERT INTO lab_snapshot VALUES ('manager_campaign', public.fetch_manager_rankings_core_v2(
  p_user_id => :'uid', p_date_start => :'d0', p_date_stop => :'d1', p_group_by => 'campaign_id', p_pack_ids => ARRAY[:'pk1']::uuid[]));

-- Serie (sparklines)
INSERT INTO lab_snapshot VALUES ('series_ad_name', public.fetch_manager_rankings_series_v2(
  p_user_id => :'uid', p_date_start => :'d0', p_date_stop => :'d1', p_group_by => 'ad_name', p_pack_ids => ARRAY[:'pk1']::uuid[],
  p_group_keys => ARRAY[:'nome']::text[]));

-- Detalhe (chamada direta, como o backend faz)
INSERT INTO lab_snapshot VALUES ('entity_nome', public.fetch_entity_performance_v135(
  :'uid', :'d0', :'d1', 'ad_name', :'nome', ARRAY[:'pk1']::uuid[]));
INSERT INTO lab_snapshot VALUES ('entity_nome_filhos', public.fetch_entity_performance_v135(
  :'uid', :'d0', :'d1', 'ad_name', :'nome', ARRAY[:'pk1']::uuid[], 'ad_id'));
INSERT INTO lab_snapshot VALUES ('entity_adset_curva', public.fetch_entity_performance_v135(
  :'uid', :'d0', :'d1', 'adset_id', :'conjunto', ARRAY[:'pk1']::uuid[], 'entity', true));

-- Retencao
INSERT INTO lab_snapshot VALUES ('retention_nome', public.fetch_manager_rankings_retention_v2(
  p_user_id => :'uid', p_date_start => :'d0', p_date_stop => :'d1', p_group_by => 'ad_name', p_pack_ids => ARRAY[:'pk1']::uuid[], p_group_key => :'nome'));

-- Conflitos entre todos os packs do dono (hoje: so cross-silo; depois: qualquer dono)
INSERT INTO lab_snapshot VALUES ('conflitos', (SELECT coalesce(jsonb_agg(jsonb_build_object('a', pack_a, 'b', pack_b) ORDER BY pack_a, pack_b), '[]'::jsonb)
  FROM public.detect_pack_conflicts(:'todos'::uuid[], :'uid')));

-- Previa da limpeza (144): so conta, nao altera
INSERT INTO lab_snapshot VALUES ('clear_previa', public.clear_ad_metrics_enrichment(:'uid', :'pk1', true));

\echo ''
SELECT name, pg_size_pretty(length(payload::text)::bigint) AS tamanho FROM lab_snapshot ORDER BY name;
\echo 'Retrato ANTES guardado em lab_snapshot.'
