-- Teste da 146: o grafo de conflito tem de acusar par que a versao da 145
-- (pre-filtro por metadado do pack) deixava passar.
--
-- Sabotagens que TEM de fazer este teste falhar:
--   1. Voltar o pre-filtro "a.date_start <= b.date_stop and ..."   -> falha em B2
--   2. Voltar a excecao de mesmo dono                              -> falha em B1
--   3. Trocar count(*) > 1 por count(*) > 2                        -> falha em B1
\set ON_ERROR_STOP on
\timing off
BEGIN;

CREATE FUNCTION pg_temp.expect(rotulo text, obtido text, esperado text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF obtido IS DISTINCT FROM esperado THEN
    RAISE EXCEPTION 'FALHOU %: obtido=% esperado=%', rotulo, obtido, esperado;
  END IF;
END $$;

-- Usuario com mais dados, e um ad-dia real dele para reaproveitar.
CREATE TEMP TABLE t_base AS
SELECT am.user_id, am.pack_id AS pack_origem, am.ad_id, am.date, am.account_id
FROM public.ad_metrics am
WHERE am.user_id = (SELECT user_id FROM public.ad_metrics GROUP BY 1 ORDER BY count(*) DESC LIMIT 1)
ORDER BY am.date DESC
LIMIT 1;

-- Dois packs sinteticos do MESMO dono. O pack B declara uma janela que NAO
-- cobre o ad-dia (metadado defasado — o caso das 847 linhas em producao).
INSERT INTO public.packs (id, user_id, name, level, adaccount_id, date_start, date_stop, ad_ids)
SELECT '00000000-0000-4000-8000-000000000146'::uuid, b.user_id, 'lab 146 A', 'ad', b.account_id,
       b.date, b.date, ARRAY[b.ad_id]
FROM t_base b;
INSERT INTO public.packs (id, user_id, name, level, adaccount_id, date_start, date_stop, ad_ids)
SELECT '00000000-0000-4000-8000-000000000147'::uuid, b.user_id, 'lab 146 B', 'ad', b.account_id,
       b.date + 400, b.date + 401, ARRAY[]::text[]   -- janela e ad_ids mentem
FROM t_base b;

-- Os dois packs contem o MESMO ad-dia, de verdade (metricas + mapa).
INSERT INTO public.ad_metrics (id, user_id, pack_id, ad_id, date, account_id, spend, impressions)
SELECT gen_random_uuid()::text, b.user_id, p.id, b.ad_id, b.date, b.account_id, 1, 1
FROM t_base b CROSS JOIN (VALUES ('00000000-0000-4000-8000-000000000146'::uuid),
                                 ('00000000-0000-4000-8000-000000000147'::uuid)) p(id);
INSERT INTO public.ad_metric_pack_map (user_id, pack_id, ad_id, metric_date)
SELECT b.user_id, p.id, b.ad_id, b.date
FROM t_base b CROSS JOIN (VALUES ('00000000-0000-4000-8000-000000000146'::uuid),
                                 ('00000000-0000-4000-8000-000000000147'::uuid)) p(id);

-- ---------------------------------------------------------------------------
-- A. O ator enxerga os dois packs (senao o teste nao prova nada)
-- ---------------------------------------------------------------------------
SELECT pg_temp.expect('A1 os dois packs sao acessiveis ao dono',
  (SELECT count(*)::text FROM public.resolve_pack_access(
     ARRAY['00000000-0000-4000-8000-000000000146','00000000-0000-4000-8000-000000000147']::uuid[],
     (SELECT user_id FROM t_base))),
  '2');

-- ---------------------------------------------------------------------------
-- B. O conflito e acusado — mesmo dono e mesmo com a janela do pack B mentindo
-- ---------------------------------------------------------------------------
SELECT pg_temp.expect('B1 par de mesmo dono e acusado',
  (SELECT count(*)::text FROM public.detect_pack_conflicts(
     ARRAY['00000000-0000-4000-8000-000000000146','00000000-0000-4000-8000-000000000147']::uuid[],
     (SELECT user_id FROM t_base))),
  '1');

SELECT pg_temp.expect('B2 o par vem ordenado (a < b)',
  (SELECT pack_a::text || '|' || pack_b::text FROM public.detect_pack_conflicts(
     ARRAY['00000000-0000-4000-8000-000000000146','00000000-0000-4000-8000-000000000147']::uuid[],
     (SELECT user_id FROM t_base))),
  '00000000-0000-4000-8000-000000000146|00000000-0000-4000-8000-000000000147');

-- ---------------------------------------------------------------------------
-- C. Sem dia em comum nao ha par (nao vira "bloqueia tudo")
-- ---------------------------------------------------------------------------
DELETE FROM public.ad_metric_pack_map
WHERE pack_id = '00000000-0000-4000-8000-000000000147';
SELECT pg_temp.expect('C1 sem ad-dia compartilhado, nenhum par',
  (SELECT count(*)::text FROM public.detect_pack_conflicts(
     ARRAY['00000000-0000-4000-8000-000000000146','00000000-0000-4000-8000-000000000147']::uuid[],
     (SELECT user_id FROM t_base))),
  '0');

-- ---------------------------------------------------------------------------
-- D. Pack fora do escopo do ator nao entra no grafo
-- ---------------------------------------------------------------------------
SELECT pg_temp.expect('D1 ator sem acesso nao recebe par',
  (SELECT count(*)::text FROM public.detect_pack_conflicts(
     ARRAY['00000000-0000-4000-8000-000000000146','00000000-0000-4000-8000-000000000147']::uuid[],
     '00000000-0000-4000-8000-0000000000ff'::uuid)),
  '0');

DO $$ BEGIN RAISE NOTICE 'OK: 5 assercoes'; END $$;
ROLLBACK;
