-- Teste da 154: inventário do pack (critério de linha sintética, backfill e merge).
--
-- ORDEM DE PROPÓSITO: cada asserção é a primeira a ver a sabotagem que lhe corresponde.
--
-- Sabotagens que TÊM de fazer este teste falhar:
--   1. Critério sem o teste de leadscore                          -> falha em P1
--   2. Backfill sem descartar dia anterior à criação             -> falha em B2a
--   3. Backfill com a identidade do dia MAIS ANTIGO               -> falha em B2b
--   4. Merge com first_active_date = excluded (sem least)         -> falha em M2
--   5. Merge sem o WHERE do ON CONFLICT (regrava igual)           -> falha em M3
--   6. Merge apagando nome com texto vazio (sem nullif/coalesce)  -> falha em M4
--   7. Merge sem o guarda de tenancy                              -> falha em M6
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

\set u   '''00000000-0000-4000-8000-000000000154'''
\set u2  '''00000000-0000-4000-8000-00000000154b'''
\set p   '''11111111-1111-4111-8111-000000000154'''

INSERT INTO public.ads (ad_id, user_id, ad_name, meta_created_time) VALUES
  ('t154-a', :u::uuid, 'A novo', '2026-09-03 12:00:00+00'),  -- criado 03/09 → vale a partir de 02/09
  ('t154-b', :u::uuid, 'B', NULL),                           -- sem data de criação → vale tudo
  ('t154-c', :u::uuid, 'C', '2026-08-01 00:00:00+00'),       -- tem linha real e sintéticas
  ('t154-x', :u2::uuid, 'X', NULL);                          -- outro silo

INSERT INTO public.ad_metrics (id, user_id, pack_id, ad_id, date, ad_name, account_id, campaign_id, adset_id,
                               spend, impressions, clicks, actions, leadscore_values) VALUES
  -- a: 01/09 é anterior à criação (sujeira); 02/09 e 05/09 sintéticas com nomes diferentes
  ('2026-09-01-t154-a', :u::uuid, :p::uuid, 't154-a', '2026-09-01', 'A pre',   'act_1', 'c1', 's1', 0, 0, 0, NULL, NULL),
  ('2026-09-02-t154-a', :u::uuid, :p::uuid, 't154-a', '2026-09-02', 'A velho', 'act_1', 'c1', 's1', 0, 0, 0, NULL, NULL),
  ('2026-09-05-t154-a', :u::uuid, :p::uuid, 't154-a', '2026-09-05', 'A novo',  'act_1', 'c1', 's1', 0, 0, 0, NULL, NULL),
  -- b: sintéticas com buraco
  ('2026-09-01-t154-b', :u::uuid, :p::uuid, 't154-b', '2026-09-01', 'B', 'act_1', 'c1', 's1', 0, 0, 0, '[]', NULL),
  ('2026-09-03-t154-b', :u::uuid, :p::uuid, 't154-b', '2026-09-03', 'B', 'act_1', 'c1', 's1', 0, 0, 0, NULL, '{}'),
  -- c: uma sintética, uma real, uma com leadscore e uma com conversão (as três últimas NÃO são sintéticas)
  ('2026-09-01-t154-c', :u::uuid, :p::uuid, 't154-c', '2026-09-01', 'C', 'act_1', 'c1', 's1', 0, 0, 0, NULL, NULL),
  ('2026-09-02-t154-c', :u::uuid, :p::uuid, 't154-c', '2026-09-02', 'C', 'act_1', 'c1', 's1', 10, 100, 1, NULL, NULL),
  ('2026-09-03-t154-c', :u::uuid, :p::uuid, 't154-c', '2026-09-03', 'C', 'act_1', 'c1', 's1', 0, 0, 0, NULL, ARRAY[80]::numeric[]),
  ('2026-09-04-t154-c', :u::uuid, :p::uuid, 't154-c', '2026-09-04', 'C', 'act_1', 'c1', 's1', 0, 0, 0,
     '[{"action_type":"lead","value":"1"}]', NULL),
  -- x: outro silo
  ('2026-09-01-t154-x', :u2::uuid, :p::uuid, 't154-x', '2026-09-01', 'X', 'act_2', 'c9', 's9', 0, 0, 0, NULL, NULL);

-- P1: critério. 3 (a) + 2 (b) + 1 (c) = 6 sintéticas no silo u; leadscore, conversão e gasto ficam fora.
SELECT pg_temp.expect(
  'P1.criterio-de-sintetica',
  (SELECT string_agg(m.ad_id || '@' || m.date, ',' ORDER BY m.ad_id, m.date)
   FROM public.ad_metrics m WHERE m.user_id = :u::uuid AND public.ad_metrics_is_synthetic_zero(m)),
  't154-a@2026-09-01,t154-a@2026-09-02,t154-a@2026-09-05,t154-b@2026-09-01,t154-b@2026-09-03,t154-c@2026-09-01');

-- Backfill só do silo u.
CREATE TEMP TABLE r_backfill AS SELECT public.ad_pack_inventory_backfill(:u::uuid) AS n;
SELECT pg_temp.expect('B1.tres-anuncios', (SELECT n::text FROM r_backfill), '3');

-- B2a: dia anterior à criação descartado.
SELECT pg_temp.expect(
  'B2a.sem-dia-anterior-a-criacao',
  (SELECT first_active_date || '..' || last_active_date FROM public.ad_pack_inventory
   WHERE user_id = :u::uuid AND pack_id = :p::uuid AND ad_id = 't154-a'),
  '2026-09-02..2026-09-05');

-- B2b: identidade do dia mais recente.
SELECT pg_temp.expect(
  'B2b.nome-do-dia-mais-recente',
  (SELECT ad_name FROM public.ad_pack_inventory WHERE user_id = :u::uuid AND ad_id = 't154-a'),
  'A novo');

-- B3: sem data de criação, vale o intervalo inteiro (buraco incluído, divergência (c) aceita).
SELECT pg_temp.expect(
  'B3.sem-data-de-criacao',
  (SELECT first_active_date || '..' || last_active_date FROM public.ad_pack_inventory
   WHERE user_id = :u::uuid AND ad_id = 't154-b'),
  '2026-09-01..2026-09-03');

-- B4: só as sintéticas entram no intervalo; a real, a com leadscore e a com conversão não.
SELECT pg_temp.expect(
  'B4.so-sinteticas',
  (SELECT first_active_date || '..' || last_active_date FROM public.ad_pack_inventory
   WHERE user_id = :u::uuid AND ad_id = 't154-c'),
  '2026-09-01..2026-09-01');

-- B5: outro silo intocado.
SELECT pg_temp.expect(
  'B5.outro-silo-intocado',
  (SELECT count(*)::text FROM public.ad_pack_inventory WHERE user_id = :u2::uuid),
  '0');

-- B6: idempotente.
SELECT pg_temp.expect('B6.idempotente', public.ad_pack_inventory_backfill(:u::uuid)::text, '0');

-- IMPORTANTE: a gravação e a leitura ficam em instruções SEPARADAS. Numa mesma instrução o
-- Postgres lê a foto tirada no início dela e não enxerga o que a função acabou de gravar.
CREATE FUNCTION pg_temp.merge(p jsonb) RETURNS integer LANGUAGE sql AS $$
  SELECT public.merge_ad_pack_inventory('00000000-0000-4000-8000-000000000154'::uuid,
                                        '11111111-1111-4111-8111-000000000154'::uuid, p) $$;
CREATE FUNCTION pg_temp.inv(p_ad text) RETURNS text LANGUAGE sql AS $$
  SELECT first_active_date || '..' || last_active_date || ' ' || coalesce(ad_name, '<null>')
  FROM public.ad_pack_inventory
  WHERE user_id = '00000000-0000-4000-8000-000000000154'::uuid AND ad_id = p_ad $$;

-- M1: merge insere anúncio novo.
CREATE TEMP TABLE m1 AS SELECT pg_temp.merge(
  '[{"ad_id":"t154-d","ad_name":"D","account_id":"act_1","campaign_id":"c1","adset_id":"s1",
     "first_active_date":"2026-09-06","last_active_date":"2026-09-13"}]'::jsonb) AS n;
SELECT pg_temp.expect('M1.insere-novo', (SELECT n::text FROM m1) || ' ' || pg_temp.inv('t154-d'),
  '1 2026-09-06..2026-09-13 D');

-- M2: merge só estende (first continua 02/09, last vai a 10/09).
CREATE TEMP TABLE m2 AS SELECT pg_temp.merge(
  '[{"ad_id":"t154-a","ad_name":"A novo","account_id":"act_1","campaign_id":"c1","adset_id":"s1",
     "first_active_date":"2026-09-03","last_active_date":"2026-09-10"}]'::jsonb) AS n;
SELECT pg_temp.expect('M2.so-estende', (SELECT n::text FROM m2) || ' ' || pg_temp.inv('t154-a'),
  '1 2026-09-02..2026-09-10 A novo');

-- M3: merge idêntico não regrava (0 e mesma posição física).
CREATE TEMP TABLE pos_a AS
  SELECT ctid::text AS pos FROM public.ad_pack_inventory WHERE user_id = :u::uuid AND ad_id = 't154-a';
CREATE TEMP TABLE m3 AS SELECT pg_temp.merge(
  '[{"ad_id":"t154-a","ad_name":"A novo","account_id":"act_1","campaign_id":"c1","adset_id":"s1",
     "first_active_date":"2026-09-04","last_active_date":"2026-09-09"}]'::jsonb) AS n;
SELECT pg_temp.expect('M3.igual-nao-regrava',
  (SELECT n::text FROM m3) || ' '
  || ((SELECT ctid::text FROM public.ad_pack_inventory WHERE user_id = :u::uuid AND ad_id = 't154-a')
      = (SELECT pos FROM pos_a))::text,
  '0 true');

-- M4: nome vazio não apaga; nome novo troca.
CREATE TEMP TABLE m4a AS SELECT pg_temp.merge(
  '[{"ad_id":"t154-a","ad_name":"","first_active_date":"2026-09-04","last_active_date":"2026-09-09"}]'::jsonb) AS n;
SELECT pg_temp.expect('M4a.vazio-nao-apaga', (SELECT n::text FROM m4a) || ' ' || pg_temp.inv('t154-a'),
  '0 2026-09-02..2026-09-10 A novo');
CREATE TEMP TABLE m4b AS SELECT pg_temp.merge(
  '[{"ad_id":"t154-a","ad_name":"A renomeado","first_active_date":"2026-09-04","last_active_date":"2026-09-09"}]'::jsonb) AS n;
SELECT pg_temp.expect('M4b.nome-novo-troca', (SELECT n::text FROM m4b) || ' ' || pg_temp.inv('t154-a'),
  '1 2026-09-02..2026-09-10 A renomeado');

-- M5: anúncio repetido no mesmo lote não quebra e junta o intervalo.
CREATE TEMP TABLE m5 AS SELECT pg_temp.merge(
  '[{"ad_id":"t154-e","ad_name":"E1","first_active_date":"2026-09-01","last_active_date":"2026-09-02"},
    {"ad_id":"t154-e","ad_name":"E2","first_active_date":"2026-09-05","last_active_date":"2026-09-07"}]'::jsonb) AS n;
SELECT pg_temp.expect('M5.repetido-no-lote', (SELECT n::text FROM m5) || ' ' || pg_temp.inv('t154-e'),
  '1 2026-09-01..2026-09-07 E2');

-- M6: cliente autenticado não grava no silo de outro.
CREATE TEMP TABLE r_forbidden (msg text);
DO $$
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000154b"}', true);
  BEGIN
    PERFORM public.merge_ad_pack_inventory('00000000-0000-4000-8000-000000000154'::uuid,
      '11111111-1111-4111-8111-000000000154'::uuid,
      '[{"ad_id":"t154-z","first_active_date":"2026-09-01","last_active_date":"2026-09-01"}]'::jsonb);
    INSERT INTO r_forbidden VALUES ('gravou');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO r_forbidden VALUES ('recusou');
  END;
  PERFORM set_config('request.jwt.claims', '', true);
END $$;
SELECT pg_temp.expect('M6.outro-silo-recusado', (SELECT msg FROM r_forbidden), 'recusou');

SELECT '154 OK — 14 asserções' AS resultado;
ROLLBACK;
