-- 156: limpeza das linhas-zero (F5, fase 4). IRREVERSÍVEL.
--
-- POR QUE
-- -------
-- Desde a 155 as leituras completam a lista pelo inventário (ad_pack_inventory) e, com
-- o backend novo, o refresh não grava mais linha-zero. As que existem só ocupam espaço:
-- 543.622 das 688.485 linhas de ad_metrics no laboratório (79%), espelhadas 1:1 no
-- rollup (ad_performance_daily) e no mapa (ad_metric_pack_map).
--
-- PRÉ-CONDIÇÕES (verificar ANTES de rodar)
-- ----------------------------------------
--   1. 154 e 155 aplicadas; backend novo no ar há pelo menos um dia de refreshes.
--   2. Nenhum refresh rodando (a etapa 4 trava as tabelas).
--   3. Idealizador avisado do horário: o Manager e o refresh ficam parados durante a etapa 4.
--
-- NÃO roda numa transação só: o apagamento faz COMMIT por pack (lotes curtos, sem segurar
-- lock nem gerar um WAL gigante) e o VACUUM FULL não roda dentro de transação. Rodar com:
--     psql "<conexão direta>" -v ON_ERROR_STOP=1 -f 156_limpeza_das_linhas_zero.sql
--
-- ETAPAS
--   1. Inventário de novo: pega as linhas-zero gravadas pelo backend antigo entre a 154 e o
--      deploy (sem isto, pack sem refresh depois do deploy perderia esses anúncios).
--   2. Contagem antes (registro).
--   3. Apagar por pack, com COMMIT a cada pack. A FK ON DELETE CASCADE leva rollup e mapa.
--   4. VACUUM FULL das três tabelas: devolve o espaço ao disco. TRAVA leitura e escrita delas
--      enquanto roda (medido no laboratório; ver plano §8.9).
--   5. Contagem depois (registro) e remoção da procedure.

\echo '== 1. inventário a partir das linhas-zero atuais'
SELECT public.ad_pack_inventory_backfill(NULL) AS intervalos_novos_ou_estendidos;

\echo '== 2. antes'
SELECT count(*) FILTER (WHERE public.ad_metrics_is_synthetic_zero(m)) AS linhas_zero,
       count(*) AS linhas_total,
       pg_size_pretty(pg_total_relation_size('public.ad_metrics')) AS ad_metrics,
       pg_size_pretty(pg_total_relation_size('public.ad_performance_daily')) AS rollup,
       pg_size_pretty(pg_total_relation_size('public.ad_metric_pack_map')) AS mapa
FROM public.ad_metrics m;

-- Sem `SET search_path`: procedure com SET não pode dar COMMIT ("encerramento de transação
-- inválido"). Por isso todo nome abaixo é qualificado com public.
CREATE OR REPLACE PROCEDURE public.f5_apagar_linhas_zero()
LANGUAGE plpgsql
AS $$
declare
  r record;
  n bigint;
  total bigint := 0;
begin
  -- Por (silo, pack): cada DELETE anda pelo prefixo da PK e fica pequeno.
  for r in select distinct user_id, pack_id from public.ad_metrics order by user_id, pack_id loop
    delete from public.ad_metrics m
    where m.user_id = r.user_id
      and m.pack_id = r.pack_id
      and public.ad_metrics_is_synthetic_zero(m);
    get diagnostics n = row_count;
    total := total + n;
    commit;
    if n > 0 then
      raise notice 'pack %: % linhas-zero apagadas (total %)', r.pack_id, n, total;
    end if;
  end loop;
  raise notice 'fim: % linhas-zero apagadas', total;
end;
$$;

REVOKE ALL ON PROCEDURE public.f5_apagar_linhas_zero() FROM PUBLIC, anon, authenticated;

\echo '== 3. apagando por pack'
\timing on
CALL public.f5_apagar_linhas_zero();

\echo '== 4. VACUUM FULL (tabelas travadas a partir daqui)'
VACUUM (FULL, ANALYZE) public.ad_metrics;
VACUUM (FULL, ANALYZE) public.ad_performance_daily;
VACUUM (FULL, ANALYZE) public.ad_metric_pack_map;
\timing off

\echo '== 5. depois'
DROP PROCEDURE public.f5_apagar_linhas_zero();
SELECT count(*) FILTER (WHERE public.ad_metrics_is_synthetic_zero(m)) AS linhas_zero,
       count(*) AS linhas_total,
       pg_size_pretty(pg_total_relation_size('public.ad_metrics')) AS ad_metrics,
       pg_size_pretty(pg_total_relation_size('public.ad_performance_daily')) AS rollup,
       pg_size_pretty(pg_total_relation_size('public.ad_metric_pack_map')) AS mapa
FROM public.ad_metrics m;
