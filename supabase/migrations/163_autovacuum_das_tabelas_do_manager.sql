-- ===========================================================================
-- 163 — Autovacuum mais frequente nas tabelas que o Manager lê
-- ===========================================================================
--
-- POR QUÊ (16/09/2026)
-- --------------------
-- O Manager lê estas tabelas por índice, e o Postgres só responde SEM ir à tabela
-- (index-only) nas páginas marcadas como "visíveis" — e só o VACUUM marca. Antes do
-- VACUUM manual de 16/09: `ad_performance_daily` 67% marcada, `ads` 82%,
-- `ad_metrics` 0%. Na aba "Por anúncio" com 7 packs do Igor isso eram ~74 mil idas à
-- tabela por requisição (39 mil só para achar as chaves); depois do VACUUM, zero.
-- Com o cache quente o tempo quase não muda; com o cache frio (instância de 1 GB para
-- 1,2 GB de banco) cada ida à tabela é uma leitura de disco.
--
-- O padrão do autovacuum (20% da tabela alterada) deixa a marca envelhecer por dias:
-- ~34 mil linhas mudadas em `ad_performance_daily` antes de agir, e cada refresh de
-- pack reescreve as linhas do pack. Com 2%, ele passa a cada ~3,4 mil. O custo é
-- pequeno: com o mapa de visibilidade em dia, o VACUUM só visita as páginas que
-- mudaram, e o autovacuum é freado (`autovacuum_vacuum_cost_delay`).
--
-- Vale também para inserções (`..._insert_scale_factor`): tabela que só recebe
-- linhas novas nunca era marcada até o limiar de 20%.
--
-- VOLTA ATRÁS: `ALTER TABLE ... RESET (autovacuum_vacuum_scale_factor,
-- autovacuum_vacuum_insert_scale_factor, autovacuum_analyze_scale_factor)`.
-- ===========================================================================

BEGIN;

ALTER TABLE public.ad_performance_daily SET (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_vacuum_insert_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.05
);

ALTER TABLE public.ads SET (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_vacuum_insert_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.05
);

ALTER TABLE public.ad_metrics SET (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_vacuum_insert_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.05
);

-- Prova no próprio arquivo.
DO $$
DECLARE
  v_t text;
  v_opts text[];
BEGIN
  FOREACH v_t IN ARRAY array['ad_performance_daily', 'ads', 'ad_metrics'] LOOP
    SELECT reloptions INTO v_opts FROM pg_class WHERE oid = ('public.' || v_t)::regclass;
    IF v_opts IS NULL
       OR NOT ('autovacuum_vacuum_scale_factor=0.02' = ANY(v_opts))
       OR NOT ('autovacuum_vacuum_insert_scale_factor=0.02' = ANY(v_opts)) THEN
      RAISE EXCEPTION '163: % sem o ajuste de autovacuum. reloptions=%', v_t, v_opts;
    END IF;
  END LOOP;
END;
$$;

COMMIT;
