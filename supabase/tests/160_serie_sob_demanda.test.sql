-- ===========================================================================
-- Teste da migration 160 — `p_series_days = 0` significa NENHUM dia
-- ===========================================================================
--
-- POR QUE ESTE TESTE EXISTE
-- -------------------------
-- A tela de variações recebia, para cada anúncio, uma mini-série de 5 dias que
-- ela não desenha. Medido em produção (630 anúncios, 13 dias): a série custava
-- 35% da saída da função e ~1/3 do tempo. Para poder desligá-la, a v158 dá ao
-- valor 0 o significado de "nenhum dia" — na v157 ele caía junto do NULL e
-- pedia o PERÍODO INTEIRO, o oposto.
--
-- O QUE PRECISA SER VERDADE
-- -------------------------
-- A1. Com 0, nenhum grupo tem dia.
-- A2. **Tirando os dias, a saída com 0 é IDÊNTICA à com 5 e à com NULL.**
--     Esta é a asserção que importa: desligar a série não pode mexer em
--     totais, conversões agregadas, curva, packs, identidade nem inventário.
-- A3. NULL continua sendo "o período inteiro" (o histórico depende disso).
-- A4. N > 0 continua cortando a janela pelo fim do período.
-- A5. Menos dado sai do banco.
--
-- COMO RODAR (só no laboratório)
--   psql -d hookify_lab -X -v ON_ERROR_STOP=1 -f supabase/tests/160_serie_sob_demanda.test.sql
--   psql -d hookify_lab -X -v ON_ERROR_STOP=1 -v alvo=fetch_entity_performance_v157 \
--        -f supabase/tests/160_serie_sob_demanda.test.sql     # sabotagem: DEVE falhar em A1
--
-- SABOTAGENS PROVADAS (15/09/2026)
--   1. Rodar com alvo=v157 (o `case` antigo)     -> A1 falha: obtém 3 dias, esperava 0
--   2. `v_date_stop` em vez de `v_date_stop + 1` -> A1 falha: sobra o último dia (1)
--   3. Fazer a CTE `totals` respeitar `v_series_start` — o jeito ERRADO de zerar os
--      dias, cortando as linhas em vez de só as três CTEs de dia -> A1b falha com
--      `<NULL>`: sem total, o `having bool_or(kind = 'tot')` descarta o grupo e ele
--      SOME da resposta inteira. É o estrago que este teste existe para pegar, e ele
--      aparece antes mesmo do A2.
-- ===========================================================================

\if :{?alvo}
\else
  \set alvo fetch_entity_performance_v158
\endif

BEGIN;

SELECT set_config('lab.alvo', :'alvo', true);

CREATE FUNCTION pg_temp.expect(rotulo text, obtido text, esperado text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF obtido IS DISTINCT FROM esperado THEN
    RAISE EXCEPTION 'FALHOU %: obtido=% esperado=%', rotulo, left(obtido, 400), left(esperado, 400);
  END IF;
END $$;

\set u   '''00000000-0000-4000-8000-000000000160'''
\set p1  '''11111111-1111-4111-8111-000000001601'''

INSERT INTO auth.users (id) VALUES (:u::uuid) ON CONFLICT DO NOTHING;

INSERT INTO public.packs (id, user_id, name, level, adaccount_id, date_start, date_stop, ad_ids) VALUES
  (:p1::uuid, :u::uuid, 'lab 160', 'ad', 'act_1', '2026-09-01', '2026-09-10', ARRAY[]::text[]);

INSERT INTO public.ads (ad_id, user_id, ad_name, adset_id, campaign_id, effective_status, thumb_storage_path) VALUES
  ('t160-a', :u::uuid, 'Criativo 160', 's1', 'c1', 'ACTIVE', NULL),
  ('t160-b', :u::uuid, 'Criativo 160', 's1', 'c1', 'PAUSED', 'thumbs/t160-b.jpg'),
  ('t160-c', :u::uuid, 'Criativo 160', 's2', 'c1', 'ACTIVE', NULL);

-- Dias DENTRO (06..10) e FORA (01..05) da janela de 5 dias, com conversões e
-- leadscore, para que as três CTEs de dia (`day_nums`, `conv_days`, `lead_days`)
-- tenham o que montar — um cenário sem conversão não provaria nada sobre elas.
INSERT INTO public.ad_metrics (id, user_id, pack_id, ad_id, date, ad_name, account_id, campaign_id, campaign_name,
    adset_id, adset_name, spend, impressions, clicks, inline_link_clicks, reach, video_total_plays,
    video_total_thruplays, video_play_curve_actions, actions, conversions, leadscore_values, custom_hist) VALUES
  ('2026-09-02-t160-a', :u::uuid, :p1::uuid, 't160-a', '2026-09-02', 'Criativo 160', 'act_1', 'c1', 'Camp', 's1', 'Conj',
    10, 100, 5, 4, 90, 50, 20, '[100, 80, 40]',
    '[{"action_type":"link_click","value":"3"}]', '[{"action_type":"purchase","value":"2"}]', '{80,90}', '{"m1": {"25": 2}}'),
  ('2026-09-07-t160-a', :u::uuid, :p1::uuid, 't160-a', '2026-09-07', 'Criativo 160', 'act_1', 'c1', 'Camp', 's1', 'Conj',
    30, 400, 9, 7, 250, 120, 60, '[100, 70]',
    '[{"action_type":"link_click","value":"6"}]', '[{"action_type":"purchase","value":"1"}]', '{80}', NULL),
  ('2026-09-10-t160-a', :u::uuid, :p1::uuid, 't160-a', '2026-09-10', 'Criativo 160', 'act_1', 'c1', 'Camp', 's1', 'Conj',
    5, 100, 1, 1, 50, 0, 0, NULL, NULL, '[{"action_type":"lead","value":"3"}]', '{70}', NULL),
  ('2026-09-03-t160-b', :u::uuid, :p1::uuid, 't160-b', '2026-09-03', 'Criativo 160', 'act_1', 'c1', 'Camp', 's1', 'Conj',
    12, 300, 3, 2, 280, 10, 5, '[100, 50, 20]',
    '[{"action_type":"video_view","value":"10"}]', '[{"action_type":"purchase","value":"4"}]', '{70,70}', '{"m1": {"31": 1}}'),
  ('2026-09-08-t160-b', :u::uuid, :p1::uuid, 't160-b', '2026-09-08', 'Criativo 160', 'act_1', 'c1', 'Camp', 's1', 'Conj',
    8, 80, 2, 1, 70, 20, 8, '[100, 60]', NULL, NULL, '{95}', NULL),
  ('2026-09-06-t160-c', :u::uuid, :p1::uuid, 't160-c', '2026-09-06', 'Criativo 160', 'act_1', 'c1', 'Camp', 's2', 'Conj Dois',
    20, 200, 6, 5, 180, 60, 30, '[100, 90, 40]',
    '[{"action_type":"link_click","value":"5"}]', '[{"action_type":"purchase","value":"7"}]', '{60,85}', '{"m2": {"A": 1}}');

CREATE FUNCTION pg_temp.chamar(p_uid uuid, p_ent text, p_id text, p_group text, p_series integer) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  EXECUTE format('SELECT public.%I($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)', current_setting('lab.alvo'))
    INTO r USING p_uid, '2026-09-01'::date, '2026-09-10'::date, p_ent, p_id,
                 ARRAY[(SELECT id FROM public.packs WHERE name = 'lab 160')], p_group, true, p_series, true;
  RETURN r;
END $$;

-- A saída sem a lista de dias de cada grupo: é o que tem de ficar igual.
CREATE FUNCTION pg_temp.sem_dias(p jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_set(p, '{groups}',
    coalesce((SELECT jsonb_agg(g - 'days' ORDER BY g->>'group_key') FROM jsonb_array_elements(p->'groups') g),
             '[]'::jsonb));
$$;

CREATE TEMP TABLE casos (rotulo text, ent text, id text, grp text) ON COMMIT DROP;
INSERT INTO casos VALUES
  ('ad_name/por-anuncio', 'ad_name', 'Criativo 160', 'ad_id'),
  ('ad_name/agregado',    'ad_name', 'Criativo 160', 'entity'),
  ('adset/por-anuncio',   'adset_id', 's1', 'ad_id'),
  ('ad_id/agregado',      'ad_id', 't160-a', 'entity');

CREATE TEMP TABLE saidas ON COMMIT DROP AS
SELECT c.rotulo,
       pg_temp.chamar(:u::uuid, c.ent, c.id, c.grp, 0)            AS s0,
       pg_temp.chamar(:u::uuid, c.ent, c.id, c.grp, 5)            AS s5,
       pg_temp.chamar(:u::uuid, c.ent, c.id, c.grp, NULL::integer) AS snull
FROM casos c;

-- G. O cenário exercita mesmo os campos (um cenário vazio passaria em tudo).
SELECT pg_temp.expect('G.cenario-nao-e-vazio',
  (SELECT concat_ws(' ',
     'casos=' || count(*),
     'com-grupos=' || count(*) FILTER (WHERE jsonb_array_length(s5->'groups') > 0),
     'com-dias-em-5=' || count(*) FILTER (WHERE (SELECT sum(jsonb_array_length(g->'days')) FROM jsonb_array_elements(s5->'groups') g) > 0),
     'com-conversao-no-dia=' || count(*) FILTER (WHERE snull::text LIKE '%purchase%'),
     'com-lead-no-dia=' || count(*) FILTER (WHERE snull::text LIKE '%leads%'))
   FROM saidas),
  'casos=4 com-grupos=4 com-dias-em-5=4 com-conversao-no-dia=4 com-lead-no-dia=4');

-- A1. Com 0, nenhum grupo tem dia.
SELECT pg_temp.expect('A1.' || rotulo || '.zero-dias',
  (SELECT coalesce(sum(jsonb_array_length(g->'days')), 0)::text FROM jsonb_array_elements(s0->'groups') g),
  '0')
FROM saidas ORDER BY rotulo;

-- A1b. E o campo continua existindo, como lista vazia — não some do contrato.
SELECT pg_temp.expect('A1b.' || rotulo || '.days-existe-vazio',
  (SELECT bool_and(g ? 'days' AND g->'days' = '[]'::jsonb)::text FROM jsonb_array_elements(s0->'groups') g),
  'true')
FROM saidas ORDER BY rotulo;

-- A2. A ASSERÇÃO QUE IMPORTA: fora os dias, 0 é idêntico a 5 e a NULL.
SELECT pg_temp.expect('A2.' || rotulo || '.resto-identico-a-5',
  pg_temp.sem_dias(s0)::text, pg_temp.sem_dias(s5)::text)
FROM saidas ORDER BY rotulo;

SELECT pg_temp.expect('A2.' || rotulo || '.resto-identico-a-null',
  pg_temp.sem_dias(s0)::text, pg_temp.sem_dias(snull)::text)
FROM saidas ORDER BY rotulo;

-- A3. NULL = período inteiro: traz os dias anteriores à janela de 5 (02/09 e 03/09).
--     A conta, para o número não ser mágico — dias < 06/09 por caso:
--       ad_name/por-anuncio  a(02) + b(03)            = 2
--       ad_name/agregado     os mesmos dois, num grupo = 2
--       adset s1/por-anuncio a(02) + b(03)            = 2   (c está em s2)
--       ad_id t160-a         a(02)                    = 1
--                                                      ---
--                                                        7
SELECT pg_temp.expect('A3.null-traz-o-periodo-inteiro',
  (SELECT count(*)::text FROM saidas s, jsonb_array_elements(s.snull->'groups') g,
          jsonb_array_elements(g->'days') d
   WHERE (d->>'date')::date < '2026-09-06'),
  '7');

-- A4. N > 0 corta pelo fim do período: nada antes de 06/09.
SELECT pg_temp.expect('A4.cinco-dias-corta-a-janela',
  (SELECT count(*)::text FROM saidas s, jsonb_array_elements(s.s5->'groups') g,
          jsonb_array_elements(g->'days') d
   WHERE (d->>'date')::date < '2026-09-06'),
  '0');

-- A5. Sai menos dado do banco.
SELECT pg_temp.expect('A5.saida-menor',
  (SELECT bool_and(length(s0::text) < length(s5::text) AND length(s5::text) <= length(snull::text))::text
   FROM saidas),
  'true');

SELECT format('160 OK — %s casos: sem série, o resto é idêntico (5 e NULL); economia média de %s%%',
              count(*), round(avg(100.0 * (length(s5::text) - length(s0::text)) / length(s5::text)))) AS resultado
FROM saidas;

ROLLBACK;
