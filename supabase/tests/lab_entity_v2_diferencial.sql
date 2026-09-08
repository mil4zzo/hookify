-- DIFERENCIAL das rotas de detalhe: fetch_entity_performance_v135 (producao) x
-- lab_entity_v2 (porte para tabelas com pack na chave). JSON identico ou o
-- porte esta errado; a cronometragem so vale depois que o JSON bate.
--
-- Pre-requisitos: tabelas _v2 (lab_rechaveamento_por_pack.sql), VACUUM feito,
-- jit=off no banco (producao roda assim), e
--   python supabase/tests/port_entity_v135_para_pack.py <entity_v135 extraida> <saida>
--   psql -d hookify_lab -f <saida>
-- Como rodar (em sessao limpa, nada em paralelo no banco):
--   psql -d hookify_lab -X -v ON_ERROR_STOP=1 -f supabase/tests/lab_entity_v2_diferencial.sql

\set ON_ERROR_STOP on
\pset pager off
\timing off

SELECT p.user_id AS uid, p.id AS pk1, p.date_start AS d0, p.date_stop AS d1
FROM ad_metric_pack_map apm JOIN packs p ON p.id = apm.pack_id
GROUP BY 1,2,3,4 ORDER BY count(*) DESC LIMIT 1 \gset
SELECT set_config('request.jwt.claims', json_build_object('sub', :'uid', 'role', 'authenticated')::text, false);
-- A entidade mais gasta do pack, por nome e por conjunto (telas reais de detalhe).
SELECT r.ad_name AS nome FROM lab_rollup_v2 r WHERE r.user_id = :'uid' AND r.pack_id = :'pk1'
GROUP BY 1 ORDER BY sum(r.spend) DESC LIMIT 1 \gset
SELECT r.adset_id AS conjunto FROM lab_rollup_v2 r WHERE r.user_id = :'uid' AND r.pack_id = :'pk1'
GROUP BY 1 ORDER BY sum(r.spend) DESC LIMIT 1 \gset

\echo ''
\echo '=========== DIFERENCIAL (JSON inteiro) ==========='
\echo '--- tela 1: detalhe de um ad_name, agrupado na entidade'
SELECT CASE WHEN a = b THEN 'IDENTICO' ELSE '>>> DIVERGIU <<<' END AS veredito, jsonb_typeof(a) AS tipo
FROM public.fetch_entity_performance_v135(:'uid', :'d0', :'d1', 'ad_name', :'nome', ARRAY[:'pk1']::uuid[]) a,
     public.lab_entity_v2(:'uid', :'d0', :'d1', 'ad_name', :'nome', ARRAY[:'pk1']::uuid[]) b;

\echo '--- tela 2: mesmo ad_name, uma linha por ad_id filho (exercita packs_by_ad da 134)'
SELECT CASE WHEN a = b THEN 'IDENTICO' ELSE '>>> DIVERGIU <<<' END AS veredito
FROM public.fetch_entity_performance_v135(:'uid', :'d0', :'d1', 'ad_name', :'nome', ARRAY[:'pk1']::uuid[], 'ad_id') a,
     public.lab_entity_v2(:'uid', :'d0', :'d1', 'ad_name', :'nome', ARRAY[:'pk1']::uuid[], 'ad_id') b;

\echo '--- tela 3: detalhe de um adset_id com curva de retencao (exercita o join da curva)'
SELECT CASE WHEN a = b THEN 'IDENTICO' ELSE '>>> DIVERGIU <<<' END AS veredito
FROM public.fetch_entity_performance_v135(:'uid', :'d0', :'d1', 'adset_id', :'conjunto', ARRAY[:'pk1']::uuid[], 'entity', true) a,
     public.lab_entity_v2(:'uid', :'d0', :'d1', 'adset_id', :'conjunto', ARRAY[:'pk1']::uuid[], 'entity', true) b;

\echo ''
\echo '=========== TEMPO: tela 1, 3 rodadas alternadas ==========='
\timing on
\echo '--- v135'
SELECT jsonb_typeof(public.fetch_entity_performance_v135(:'uid', :'d0', :'d1', 'ad_name', :'nome', ARRAY[:'pk1']::uuid[]));
\echo '--- v2'
SELECT jsonb_typeof(public.lab_entity_v2(:'uid', :'d0', :'d1', 'ad_name', :'nome', ARRAY[:'pk1']::uuid[]));
\echo '--- v135'
SELECT jsonb_typeof(public.fetch_entity_performance_v135(:'uid', :'d0', :'d1', 'ad_name', :'nome', ARRAY[:'pk1']::uuid[]));
\echo '--- v2'
SELECT jsonb_typeof(public.lab_entity_v2(:'uid', :'d0', :'d1', 'ad_name', :'nome', ARRAY[:'pk1']::uuid[]));
\echo '--- v135'
SELECT jsonb_typeof(public.fetch_entity_performance_v135(:'uid', :'d0', :'d1', 'ad_name', :'nome', ARRAY[:'pk1']::uuid[]));
\echo '--- v2'
SELECT jsonb_typeof(public.lab_entity_v2(:'uid', :'d0', :'d1', 'ad_name', :'nome', ARRAY[:'pk1']::uuid[]));
\echo '--- tela 3 (curva), v135'
SELECT jsonb_typeof(public.fetch_entity_performance_v135(:'uid', :'d0', :'d1', 'adset_id', :'conjunto', ARRAY[:'pk1']::uuid[], 'entity', true));
\echo '--- tela 3 (curva), v2'
SELECT jsonb_typeof(public.lab_entity_v2(:'uid', :'d0', :'d1', 'adset_id', :'conjunto', ARRAY[:'pk1']::uuid[], 'entity', true));
\timing off
