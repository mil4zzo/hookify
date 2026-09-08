-- DIFERENCIAL da RPC real do Manager: fetch_manager_performance_base_v142 (o que
-- producao roda) x lab_manager_v2 (o porte para tabelas com pack na chave).
--
-- Mesmos argumentos, tres telas. JSON IDENTICO ou o porte esta errado — e a
-- cronometragem so vale depois que o JSON bate.
--
-- Pre-requisitos no lab: lab_rechaveamento_por_pack.sql (tabelas _v2) e
--   python supabase/tests/port_v142_para_pack.py <v142 extraida> <saida>
--   psql -d hookify_lab -f <saida>
-- Como rodar:
--   psql -d hookify_lab -X -v ON_ERROR_STOP=1 -f supabase/tests/lab_manager_v2_diferencial.sql

\set ON_ERROR_STOP on
\pset pager off
\timing off

-- Alvo: o dono do maior pack, o periodo do pack, e um segundo pack do mesmo dono.
SELECT p.user_id AS uid, p.id AS pk1, p.date_start AS d0, p.date_stop AS d1
FROM ad_metric_pack_map apm JOIN packs p ON p.id = apm.pack_id
GROUP BY 1,2,3,4 ORDER BY count(*) DESC LIMIT 1 \gset
-- As RPCs de leitura tem guard de tenancy (auth.uid() = p_user_id). No lab,
-- auth.uid() le request.jwt.claims (stub do lab_prep): simular o JWT do dono.
SELECT set_config('request.jwt.claims', json_build_object('sub', :'uid', 'role', 'authenticated')::text, false);
SELECT p.id AS pk2 FROM packs p
WHERE p.user_id = :'uid' AND p.id <> :'pk1'
ORDER BY (SELECT count(*) FROM ad_metric_pack_map m WHERE m.pack_id = p.id) DESC LIMIT 1 \gset

\echo ''
\echo '=========== DIFERENCIAL (JSON inteiro) ==========='
\echo '--- tela 1: 1 pack, por ad_name (a tela padrao do Manager)'
SELECT jsonb_array_length(a->'data') AS linhas_v142, jsonb_array_length(b->'data') AS linhas_v2,
       CASE WHEN a = b THEN 'IDENTICO' ELSE '>>> DIVERGIU <<<' END AS veredito
FROM public.fetch_manager_performance_base_v142(:'uid', :'d0', :'d1', 'ad_name', ARRAY[:'pk1']::uuid[]) a,
     public.lab_manager_v2(:'uid', :'d0', :'d1', 'ad_name', ARRAY[:'pk1']::uuid[]) b;

\echo '--- tela 2: 1 pack, por adset_id, filtro de nome de campanha (exercita o EXISTS)'
SELECT jsonb_array_length(a->'data') AS linhas_v142, jsonb_array_length(b->'data') AS linhas_v2,
       CASE WHEN a = b THEN 'IDENTICO' ELSE '>>> DIVERGIU <<<' END AS veredito
FROM public.fetch_manager_performance_base_v142(:'uid', :'d0', :'d1', 'adset_id', ARRAY[:'pk1']::uuid[], NULL, 'cap') a,
     public.lab_manager_v2(:'uid', :'d0', :'d1', 'adset_id', ARRAY[:'pk1']::uuid[], NULL, 'cap') b;

\echo '--- tela 3: 2 packs do mesmo dono, por ad_id, com colunas vinculadas (opt-in 140)'
SELECT jsonb_array_length(a->'data') AS linhas_v142, jsonb_array_length(b->'data') AS linhas_v2,
       CASE WHEN a = b THEN 'IDENTICO' ELSE '>>> DIVERGIU <<<' END AS veredito
FROM public.fetch_manager_performance_base_v142(:'uid', :'d0', :'d1', 'ad_id', ARRAY[:'pk1', :'pk2']::uuid[],
       NULL, NULL, NULL, NULL, NULL, true, true, 500, 0, 'spend', NULL, true) a,
     public.lab_manager_v2(:'uid', :'d0', :'d1', 'ad_id', ARRAY[:'pk1', :'pk2']::uuid[],
       NULL, NULL, NULL, NULL, NULL, true, true, 500, 0, 'spend', NULL, true) b;

\echo '--- chaves de topo do JSON que diferem na tela 1 (vazio = nada diverge)'
SELECT k AS chave_divergente FROM (
  SELECT jsonb_object_keys(a) AS k, a, b
  FROM public.fetch_manager_performance_base_v142(:'uid', :'d0', :'d1', 'ad_name', ARRAY[:'pk1']::uuid[]) a,
       public.lab_manager_v2(:'uid', :'d0', :'d1', 'ad_name', ARRAY[:'pk1']::uuid[]) b
) x WHERE a->k IS DISTINCT FROM b->k;

\echo ''
\echo '=========== TEMPO: tela 1, 3 rodadas alternadas (descartar a 1a) ==========='
\timing on
\echo '--- v142'
SELECT jsonb_array_length(public.fetch_manager_performance_base_v142(:'uid', :'d0', :'d1', 'ad_name', ARRAY[:'pk1']::uuid[])->'data') AS linhas;
\echo '--- v2'
SELECT jsonb_array_length(public.lab_manager_v2(:'uid', :'d0', :'d1', 'ad_name', ARRAY[:'pk1']::uuid[])->'data') AS linhas;
\echo '--- v142'
SELECT jsonb_array_length(public.fetch_manager_performance_base_v142(:'uid', :'d0', :'d1', 'ad_name', ARRAY[:'pk1']::uuid[])->'data') AS linhas;
\echo '--- v2'
SELECT jsonb_array_length(public.lab_manager_v2(:'uid', :'d0', :'d1', 'ad_name', ARRAY[:'pk1']::uuid[])->'data') AS linhas;
\echo '--- v142'
SELECT jsonb_array_length(public.fetch_manager_performance_base_v142(:'uid', :'d0', :'d1', 'ad_name', ARRAY[:'pk1']::uuid[])->'data') AS linhas;
\echo '--- v2'
SELECT jsonb_array_length(public.lab_manager_v2(:'uid', :'d0', :'d1', 'ad_name', ARRAY[:'pk1']::uuid[])->'data') AS linhas;
\timing off
