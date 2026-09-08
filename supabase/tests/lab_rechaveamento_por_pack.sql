-- EXPERIMENTO: e se cada linha de ad_metrics pertencesse a UM pack?
--
-- Nao altera nada de producao. Constroi as versoes "_v2" (com pack na chave) ao
-- lado das atuais, no laboratorio, e responde quatro perguntas com numero:
--
--   1. CUSTO   — quantas linhas a mais, quanto disco (tabela e indice)?
--   2. NUMERO  — os totais de uma selecao de packs continuam iguais?
--   3. LEITURA — as formas de consulta do Manager (agregado, por nome, por
--                adset, detalhe de uma entidade) ficam mais lentas?
--   4. ESCRITA — reescrever as linhas de um pack (um refresh) custa mais?
--
-- RESULTADO EM 2026-09-07, laboratorio restaurado do dump de PRODUCAO
-- (698.419 linhas em ad_metrics, 42 packs):
--   custo    -12.598 linhas (orfas somem; duplicacao = 0, producao nao tem
--            packs sobrepostos); indices 233 MB -> 101 MB com o desenho enxuto
--   numero   identicos ate o centavo (5 packs)
--   leitura  3-7x mais rapido nas 4 formas (some o join no mapa e o dedup)
--   escrita  empate dentro do ruido (~30%) com 8 indices; ver saida com 3
--
-- POR QUE OS INDICES SAO DESENHADOS PELO USO E NAO TRADUZIDOS
-- A traducao ingenua (pack_id em 6 dos 8 indices) inflou os indices em 46%.
-- As estatisticas de producao (pg_stat_user_indexes, nunca resetadas) mostram
-- que dois indices carregam 99,9% do uso — user_ad_date_key (11,6M) e a pkey
-- (6,7M). O maior de todos (user_name_date_ad, 99 MB) foi usado 445 vezes;
-- ad_name_idx, uma vez. Depois da re-chaveagem, agrupar por nome/adset/campanha
-- acontece em memoria dentro do pack ja selecionado pela PK — esses indices
-- deixam de ter funcao.
--
-- COMO RODAR
--   export PATH="/c/Program Files/PostgreSQL/17/bin:$PATH"
--   export PGPASSWORD='lab_hookify_2026'; export PGHOST=127.0.0.1; export PGUSER=hookify_lab
--   psql -d hookify_lab -X -v ON_ERROR_STOP=1 -f supabase/tests/lab_rechaveamento_por_pack.sql 2>&1 | grep -v NOTA
-- Tempos: procure "Execution Time" na saida. Rode 2-3x e descarte a primeira
-- (cache frio). NAO rode nada em paralelo no mesmo banco durante a medicao.

\set ON_ERROR_STOP on
\pset pager off
\timing off

-- ---------------------------------------------------------------------------
-- 1. Construir as versoes por pack
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS lab_ad_metrics_v2;
DROP TABLE IF EXISTS lab_rollup_v2;

\echo ''
\echo '### Construindo ad_metrics_v2 (uma linha por pack-anuncio-dia)...'
CREATE TABLE lab_ad_metrics_v2 AS
SELECT apm.pack_id, am.*
FROM ad_metric_pack_map apm
JOIN ad_metrics am
  ON am.user_id = apm.user_id AND am.ad_id = apm.ad_id AND am.date = apm.metric_date;

-- CONJUNTO ENXUTO, desenhado pelo uso real de producao.
-- 1. PK com o pack na frente: "todas as linhas do pack X" e um intervalo do indice.
--    Substitui user_ad_date_key E o filtro pelo mapa.
ALTER TABLE lab_ad_metrics_v2 ADD PRIMARY KEY (user_id, pack_id, ad_id, date);
-- 2. Compatibilidade: importador da planilha e delete_pack ainda casam por `id`.
--    Nao-unico (o mesmo anuncio-dia pode existir em 2 packs). Some na fase 2,
--    quando os consumidores casarem pela PK nova (-44 MB).
CREATE INDEX lab_v2_id_user ON lab_ad_metrics_v2 (id, user_id);
-- 3. Lookup por anuncio (rotas de detalhe): 2.123 usos em producao, 6 MB. Fica.
CREATE INDEX lab_v2_ad_id ON lab_ad_metrics_v2 (ad_id);
-- FORA: ad_name (1 uso), user_name_date_ad (99 MB / 445 usos), adset (21 usos),
--       campaign (41 usos), user_date (fetch_entity_performance: vira intervalo do pack).

\echo '### Construindo rollup_v2 (mesma coisa para o read model)...'
CREATE TABLE lab_rollup_v2 AS
SELECT apm.pack_id, d.*
FROM ad_metric_pack_map apm
JOIN ad_performance_daily d
  ON d.user_id = apm.user_id AND d.ad_id = apm.ad_id AND d.date = apm.metric_date;
ALTER TABLE lab_rollup_v2 ADD PRIMARY KEY (user_id, pack_id, ad_id, date);

VACUUM (ANALYZE) lab_ad_metrics_v2;
VACUUM (ANALYZE) lab_rollup_v2;

-- ---------------------------------------------------------------------------
-- 2. CUSTO
-- ---------------------------------------------------------------------------
\echo ''
\echo '=========== 1. CUSTO: linhas e disco ==========='
SELECT 'ad_metrics (8 indices)' AS tabela,
  (SELECT count(*) FROM ad_metrics) AS linhas,
  pg_size_pretty(pg_relation_size('ad_metrics')) AS dados,
  pg_size_pretty(pg_indexes_size('ad_metrics')) AS indices
UNION ALL SELECT 'ad_metrics_v2 (3 indices)',
  (SELECT count(*) FROM lab_ad_metrics_v2),
  pg_size_pretty(pg_relation_size('lab_ad_metrics_v2')),
  pg_size_pretty(pg_indexes_size('lab_ad_metrics_v2'))
UNION ALL SELECT 'rollup',
  (SELECT count(*) FROM ad_performance_daily),
  pg_size_pretty(pg_relation_size('ad_performance_daily')),
  pg_size_pretty(pg_indexes_size('ad_performance_daily'))
UNION ALL SELECT 'rollup_v2',
  (SELECT count(*) FROM lab_rollup_v2),
  pg_size_pretty(pg_relation_size('lab_rollup_v2')),
  pg_size_pretty(pg_indexes_size('lab_rollup_v2'));

\echo '--- duplicacao real x orfas que somem'
SELECT
  (SELECT count(*) FROM lab_ad_metrics_v2) - (SELECT count(DISTINCT (user_id, ad_id, date)) FROM lab_ad_metrics_v2) AS linhas_duplicadas,
  (SELECT count(*) FROM ad_metrics am WHERE NOT EXISTS (SELECT 1 FROM ad_metric_pack_map apm
     WHERE apm.user_id=am.user_id AND apm.ad_id=am.ad_id AND apm.metric_date=am.date)) AS orfas_que_somem;

-- ---------------------------------------------------------------------------
-- 3. NUMERO
-- ---------------------------------------------------------------------------
\echo ''
\echo '=========== 2. NUMERO: totais por pack, hoje x v2 ==========='
WITH alvo AS (SELECT pack_id, user_id FROM ad_metric_pack_map GROUP BY 1,2 ORDER BY count(*) DESC LIMIT 5),
hoje AS (
  SELECT a.pack_id, round(sum(d.spend)::numeric,2) AS spend, sum(d.impressions) AS impressoes
  FROM alvo a
  JOIN ad_metric_pack_map apm ON apm.pack_id=a.pack_id AND apm.user_id=a.user_id
  JOIN ad_performance_daily d ON d.user_id=apm.user_id AND d.ad_id=apm.ad_id AND d.date=apm.metric_date
  GROUP BY 1),
v2 AS (
  SELECT a.pack_id, round(sum(r.spend)::numeric,2) AS spend, sum(r.impressions) AS impressoes
  FROM alvo a JOIN lab_rollup_v2 r ON r.pack_id=a.pack_id AND r.user_id=a.user_id
  GROUP BY 1)
SELECT p.name, hoje.spend AS spend_hoje, v2.spend AS spend_v2, hoje.impressoes AS impr_hoje, v2.impressoes AS impr_v2,
  CASE WHEN hoje.spend IS NOT DISTINCT FROM v2.spend AND hoje.impressoes IS NOT DISTINCT FROM v2.impressoes
       THEN 'IDENTICO' ELSE '>>> DIVERGIU <<<' END AS veredito
FROM hoje JOIN v2 USING (pack_id) JOIN packs p ON p.id=hoje.pack_id ORDER BY 2 DESC;

-- ---------------------------------------------------------------------------
-- 4. LEITURA: as quatro formas do Manager. "HOJE" reproduz o formato da RPC
--    (chaves pelo mapa -> dedup -> join no rollup por PK); "V2" filtra o
--    rollup_v2 direto pela PK. Procure "Execution Time".
-- ---------------------------------------------------------------------------
\echo ''
\echo '=========== 3. LEITURA ==========='
\echo '--- FORMA 1 HOJE: agregado do pack'
EXPLAIN (ANALYZE, TIMING OFF, COSTS OFF)
WITH alvo AS (SELECT pack_id, user_id FROM ad_metric_pack_map GROUP BY 1,2 ORDER BY count(*) DESC LIMIT 1),
keys AS (SELECT am.user_id, am.ad_id, am.date FROM ad_metrics am WHERE EXISTS (SELECT 1 FROM ad_metric_pack_map apm JOIN alvo a ON a.pack_id=apm.pack_id WHERE apm.user_id=am.user_id AND apm.ad_id=am.ad_id AND apm.metric_date=am.date)),
dedup AS (SELECT user_id, ad_id, date FROM (SELECT k.*, row_number() over (partition by k.ad_id, k.date order by k.user_id) rn FROM keys k) z WHERE rn=1),
r AS (SELECT d.* FROM dedup k JOIN ad_performance_daily d ON d.user_id=k.user_id AND d.ad_id=k.ad_id AND d.date=k.date)
SELECT count(*), sum(spend) FROM r;
\echo '--- FORMA 1 V2'
EXPLAIN (ANALYZE, TIMING OFF, COSTS OFF)
WITH alvo AS (SELECT pack_id, user_id FROM ad_metric_pack_map GROUP BY 1,2 ORDER BY count(*) DESC LIMIT 1)
SELECT count(*), sum(r.spend) FROM alvo a JOIN lab_rollup_v2 r ON r.user_id=a.user_id AND r.pack_id=a.pack_id;

\echo '--- FORMA 2 HOJE: por ad_name'
EXPLAIN (ANALYZE, TIMING OFF, COSTS OFF)
WITH alvo AS (SELECT pack_id, user_id FROM ad_metric_pack_map GROUP BY 1,2 ORDER BY count(*) DESC LIMIT 1),
keys AS (SELECT am.user_id, am.ad_id, am.date FROM ad_metrics am WHERE EXISTS (SELECT 1 FROM ad_metric_pack_map apm JOIN alvo a ON a.pack_id=apm.pack_id WHERE apm.user_id=am.user_id AND apm.ad_id=am.ad_id AND apm.metric_date=am.date)),
dedup AS (SELECT user_id, ad_id, date FROM (SELECT k.*, row_number() over (partition by k.ad_id, k.date order by k.user_id) rn FROM keys k) z WHERE rn=1),
r AS (SELECT d.* FROM dedup k JOIN ad_performance_daily d ON d.user_id=k.user_id AND d.ad_id=k.ad_id AND d.date=k.date)
SELECT ad_name, sum(spend), sum(impressions) FROM r GROUP BY 1;
\echo '--- FORMA 2 V2'
EXPLAIN (ANALYZE, TIMING OFF, COSTS OFF)
WITH alvo AS (SELECT pack_id, user_id FROM ad_metric_pack_map GROUP BY 1,2 ORDER BY count(*) DESC LIMIT 1)
SELECT r.ad_name, sum(r.spend), sum(r.impressions) FROM alvo a JOIN lab_rollup_v2 r ON r.user_id=a.user_id AND r.pack_id=a.pack_id GROUP BY 1;

\echo '--- FORMA 3 HOJE: por adset'
EXPLAIN (ANALYZE, TIMING OFF, COSTS OFF)
WITH alvo AS (SELECT pack_id, user_id FROM ad_metric_pack_map GROUP BY 1,2 ORDER BY count(*) DESC LIMIT 1),
keys AS (SELECT am.user_id, am.ad_id, am.date FROM ad_metrics am WHERE EXISTS (SELECT 1 FROM ad_metric_pack_map apm JOIN alvo a ON a.pack_id=apm.pack_id WHERE apm.user_id=am.user_id AND apm.ad_id=am.ad_id AND apm.metric_date=am.date)),
dedup AS (SELECT user_id, ad_id, date FROM (SELECT k.*, row_number() over (partition by k.ad_id, k.date order by k.user_id) rn FROM keys k) z WHERE rn=1),
r AS (SELECT d.* FROM dedup k JOIN ad_performance_daily d ON d.user_id=k.user_id AND d.ad_id=k.ad_id AND d.date=k.date)
SELECT adset_id, sum(spend), sum(clicks) FROM r GROUP BY 1;
\echo '--- FORMA 3 V2'
EXPLAIN (ANALYZE, TIMING OFF, COSTS OFF)
WITH alvo AS (SELECT pack_id, user_id FROM ad_metric_pack_map GROUP BY 1,2 ORDER BY count(*) DESC LIMIT 1)
SELECT r.adset_id, sum(r.spend), sum(r.clicks) FROM alvo a JOIN lab_rollup_v2 r ON r.user_id=a.user_id AND r.pack_id=a.pack_id GROUP BY 1;

\echo '--- FORMA 4 HOJE: detalhe de UM ad_name, ultimos 14 dias (rotas de detalhe)'
EXPLAIN (ANALYZE, TIMING OFF, COSTS OFF)
WITH alvo AS (SELECT pack_id, user_id FROM ad_metric_pack_map GROUP BY 1,2 ORDER BY count(*) DESC LIMIT 1),
nome AS (SELECT r.ad_name FROM lab_rollup_v2 r JOIN alvo a ON a.pack_id=r.pack_id GROUP BY 1 ORDER BY sum(r.spend) DESC LIMIT 1),
keys AS (SELECT am.user_id, am.ad_id, am.date FROM ad_metrics am WHERE EXISTS (SELECT 1 FROM ad_metric_pack_map apm JOIN alvo a ON a.pack_id=apm.pack_id WHERE apm.user_id=am.user_id AND apm.ad_id=am.ad_id AND apm.metric_date=am.date)),
dedup AS (SELECT user_id, ad_id, date FROM (SELECT k.*, row_number() over (partition by k.ad_id, k.date order by k.user_id) rn FROM keys k) z WHERE rn=1),
r AS (SELECT d.* FROM dedup k JOIN ad_performance_daily d ON d.user_id=k.user_id AND d.ad_id=k.ad_id AND d.date=k.date)
SELECT date, sum(spend), sum(impressions) FROM r WHERE ad_name=(SELECT ad_name FROM nome) AND date >= (SELECT max(date) FROM r) - 13 GROUP BY 1;
\echo '--- FORMA 4 V2'
EXPLAIN (ANALYZE, TIMING OFF, COSTS OFF)
WITH alvo AS (SELECT pack_id, user_id FROM ad_metric_pack_map GROUP BY 1,2 ORDER BY count(*) DESC LIMIT 1),
nome AS (SELECT r.ad_name FROM lab_rollup_v2 r JOIN alvo a ON a.pack_id=r.pack_id GROUP BY 1 ORDER BY sum(r.spend) DESC LIMIT 1),
r AS (SELECT r.* FROM alvo a JOIN lab_rollup_v2 r ON r.user_id=a.user_id AND r.pack_id=a.pack_id)
SELECT date, sum(spend), sum(impressions) FROM r WHERE ad_name=(SELECT ad_name FROM nome) AND date >= (SELECT max(date) FROM r) - 13 GROUP BY 1;

-- ---------------------------------------------------------------------------
-- 5. ESCRITA: reescrever as linhas do maior pack (um refresh), sem o gatilho
--    do rollup (que custa o mesmo nos dois lados: mesmas chaves). Em
--    transacao com ROLLBACK. Ruido alto (~30%): rode 3x e olhe a mediana.
--    ATENCAO: a tabela recem-criada nao tem espaco livre nas paginas e sai
--    mais lenta na 1a rodada — e artefato, nao resultado (ver VACUUM acima).
-- ---------------------------------------------------------------------------
\echo ''
\echo '=========== 4. ESCRITA (Tempo do UPDATE) ==========='
\timing on
BEGIN;
SELECT pack_id AS pk, user_id AS uid FROM ad_metric_pack_map GROUP BY 1,2 ORDER BY count(*) DESC LIMIT 1 \gset
\echo '--- HOJE (8 indices, filtro pelo mapa)'
ALTER TABLE ad_metrics DISABLE TRIGGER ad_metrics_rollup_sync_upd;
UPDATE ad_metrics am SET spend = am.spend
WHERE am.user_id = :'uid' AND EXISTS (SELECT 1 FROM ad_metric_pack_map apm
  WHERE apm.user_id=am.user_id AND apm.ad_id=am.ad_id AND apm.metric_date=am.date AND apm.pack_id = :'pk');
ROLLBACK;
BEGIN;
SELECT pack_id AS pk, user_id AS uid FROM ad_metric_pack_map GROUP BY 1,2 ORDER BY count(*) DESC LIMIT 1 \gset
\echo '--- V2 (3 indices, filtro pela PK)'
UPDATE lab_ad_metrics_v2 v SET spend = v.spend WHERE v.user_id = :'uid' AND v.pack_id = :'pk';
ROLLBACK;
\timing off

\echo ''
\echo '### Pronto. lab_ad_metrics_v2 / lab_rollup_v2 ficam no banco para inspecao.'
