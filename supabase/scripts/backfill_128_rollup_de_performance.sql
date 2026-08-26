-- Backfill do rollup de performance (migration 128): popula ad_conversions_daily e
-- ad_leads_daily a partir do ad_metrics existente, UM USUÁRIO POR TRANSAÇÃO.
--
-- COMO RODAR — via psql DIRETO no banco (nunca via PostgREST: o maior usuário tem
-- ~122 mil linhas e passa do statement_timeout do authenticator → 57014):
--
--   psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f supabase/scripts/backfill_128_rollup_de_performance.sql
--
-- QUANDO: com o app ocioso (o rebuild de um usuário grande lê ~120 mil linhas de
-- ~1 KB e grava ~900 mil linhas derivadas; numa t4g.micro são dezenas de segundos de
-- CPU e I/O disputando com quem estiver usando o Manager).
--
-- É IDEMPOTENTE: cada rebuild apaga e regrava o silo do usuário. Pode rodar de novo
-- (inclusive só para um usuário: select ad_performance_rollup_rebuild('<uuid>')).
--
-- Cada linha do \gexec é um statement próprio em autocommit → um usuário por
-- transação, do menor para o maior. Se cair no meio, o que já commitou fica; rodar
-- de novo só refaz (idempotente).

\set ON_ERROR_STOP on
\timing on
-- O role postgres do Supabase tem statement_timeout de 2 min; a checagem global
-- (47 s no lab, >120 s em produção) estourou na primeira rodada. Sessão sem
-- timeout e checagem POR USUÁRIO, como o rebuild.
SET statement_timeout = 0;

SELECT format('SELECT public.ad_performance_rollup_rebuild(%L::uuid);', user_id)
FROM (
  SELECT user_id, count(*) AS n
  FROM public.ad_metrics
  GROUP BY user_id
  ORDER BY n
) u
\gexec

ANALYZE public.conversion_keys;
ANALYZE public.ad_performance_daily;

-- DEVE devolver zero linhas por usuário. Qualquer linha = usuário divergente → rodar o
-- rebuild dele.
SELECT format('SELECT %L AS checando, * FROM public.ad_performance_rollup_consistency_check(%L::uuid);', user_id, user_id)
FROM (SELECT DISTINCT user_id FROM public.ad_metrics) u
\gexec

SELECT 'ad_performance_daily' AS tabela, count(*) AS linhas,
       pg_size_pretty(pg_relation_size('public.ad_performance_daily')) AS heap,
       pg_size_pretty(pg_total_relation_size('public.ad_performance_daily')) AS total
FROM public.ad_performance_daily
UNION ALL
SELECT 'conversion_keys', count(*),
       pg_size_pretty(pg_relation_size('public.conversion_keys')),
       pg_size_pretty(pg_total_relation_size('public.conversion_keys'))
FROM public.conversion_keys;
