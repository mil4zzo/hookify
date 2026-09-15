-- Teste da 157: detalhe de entidade com custo linear, saída idêntica à v155.
--
-- A. EQUIVALÊNCIA — cenário sintético que exercita todo campo da resposta (conversões,
--    leads, colunas da planilha, curvas de tamanhos diferentes e com ponto que não
--    parseia, inventário puro e misto, anúncio renomeado, silo do dono de pack
--    compartilhado, ramo legado sem pack, período vazio), comparado como TEXTO contra a
--    v155 em todas as combinações que as rotas usam. As guardas G* rodam só na v155 e
--    garantem que o cenário não é vazio: sem elas, "idêntico" poderia ser "vazio = vazio".
--
-- B. ESCALA — o mesmo nome em 200 e em 1.600 anúncios (5 dias cada, 8× mais anúncios).
--    Critério: tempo(1.600) / tempo(200) < 25, melhor de 3 execuções de cada.
--    Calibrado no laboratório em 15/09 (Postgres 17, jit off), três rodadas:
--      v157 ...... 202 → 2.627 ms, 203 → 1.810 ms, 158 → 2.598 ms  (razão 9 a 16)
--      v155 ...... 532 → 31.212 ms                                   (razão 59)
--    A primeira versão deste teste (300 × 1.200, 3 dias, razão < 8) NÃO pegava a v155
--    (razão 6,6): nesse tamanho a parte quadrática ainda não dominava. A máquina do lab é
--    ruidosa (±40% entre rodadas), por isso a folga larga entre 16 e 59.
--
-- Alvo: `-v alvo=<função>` (padrão fetch_entity_performance_v157).
--
-- Sabotagens que TÊM de fazer este teste falhar:
--   0. -v alvo=fetch_entity_performance_v155 (a montagem N²)             -> falha em B1 (~1 min a mais)
--   1. pack_ids dos totais também no modo 'entity' (não o do representante) -> falha em A
--   2. nomes do representante só de ad_metrics (sem o inventário)           -> falha em A
--   3. dia sem o histograma de leads                                        -> falha em A
--   4. `days` sem o filtro da janela de série                               -> falha em A
--   5. histogramas da planilha fora da dobra final                          -> falha em A
\set ON_ERROR_STOP on
\timing off
\if :{?alvo}
\else
  \set alvo fetch_entity_performance_v157
\endif
BEGIN;
SET LOCAL jit = off;  -- produção roda assim (e os tempos de B não podem pagar compilação)
SELECT set_config('lab.alvo', :'alvo', true);

CREATE FUNCTION pg_temp.expect(rotulo text, obtido text, esperado text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF obtido IS DISTINCT FROM esperado THEN
    RAISE EXCEPTION 'FALHOU %: obtido=% esperado=%', rotulo, left(obtido, 300), left(esperado, 300);
  END IF;
END $$;

\set u   '''00000000-0000-4000-8000-000000000157'''
\set o   '''00000000-0000-4000-8000-00000000157a'''
\set p1  '''11111111-1111-4111-8111-000000001571'''
\set p2  '''11111111-1111-4111-8111-000000001572'''
\set p3  '''11111111-1111-4111-8111-000000001573'''

INSERT INTO auth.users (id) VALUES (:u::uuid), (:o::uuid) ON CONFLICT DO NOTHING;

INSERT INTO public.packs (id, user_id, name, level, adaccount_id, date_start, date_stop, ad_ids) VALUES
  (:p1::uuid, :u::uuid, 'lab 157 A', 'ad', 'act_1', '2026-09-01', '2026-09-10', ARRAY[]::text[]),
  (:p2::uuid, :u::uuid, 'lab 157 B', 'ad', 'act_1', '2026-09-01', '2026-09-10', ARRAY[]::text[]),
  (:p3::uuid, :o::uuid, 'lab 157 dono', 'ad', 'act_9', '2026-09-01', '2026-09-10', ARRAY[]::text[]);
INSERT INTO public.pack_shares (id, pack_id, owner_id, grantee_id, role, created_at, updated_at)
VALUES (gen_random_uuid(), :p3::uuid, :o::uuid, :u::uuid, 'viewer', now(), now());

INSERT INTO public.ads (ad_id, user_id, ad_name, adset_id, campaign_id, effective_status, thumb_storage_path) VALUES
  ('t157-a', :u::uuid, 'Criativo', 's1', 'c1', 'ACTIVE', NULL),
  ('t157-b', :u::uuid, 'Criativo', 's2', 'c1', 'PAUSED', 'thumbs/t157-b.jpg'),
  ('t157-c', :u::uuid, 'Criativo', 's1', 'c1', 'ACTIVE', NULL),
  ('t157-c', :o::uuid, 'Criativo', 's1', 'c1', 'ACTIVE', 'thumbs/dono-c.jpg'),
  ('t157-r', :u::uuid, 'Criativo novo', 's1', 'c1', 'ACTIVE', NULL),
  ('t157-i', :u::uuid, 'Criativo', 's1', 'c1', 'ACTIVE', NULL),
  ('t157-j', :u::uuid, 'Sozinho', 's3', 'c2', 'ACTIVE', NULL);

INSERT INTO public.ad_metrics (id, user_id, pack_id, ad_id, date, ad_name, account_id, campaign_id, campaign_name,
    adset_id, adset_name, spend, impressions, clicks, inline_link_clicks, reach, video_total_plays,
    video_total_thruplays, video_play_curve_actions, actions, conversions, leadscore_values, custom_hist) VALUES
  ('2026-09-02-t157-a', :u::uuid, :p1::uuid, 't157-a', '2026-09-02', 'Criativo', 'act_1', 'c1', 'Camp Um', 's1', 'Conj Um',
    10, 100, 5, 4, 90, 50, 20, '[100, 80, 40]',
    '[{"action_type":"link_click","value":"3"},{"action_type":"lead","value":"2"}]',
    '[{"action_type":"purchase","value":"2"}]', '{80,90}', '{"m1": {"25": 2}}'),
  ('2026-09-06-t157-a', :u::uuid, :p1::uuid, 't157-a', '2026-09-06', 'Criativo', 'act_1', 'c1', 'Camp Um', 's1', 'Conj Um',
    30, 400, 9, 7, 250, 120, 60, '[100, 70]',
    '[{"action_type":"link_click","value":"6"}]', '[{"action_type":"purchase","value":"1"}]', '{80}', NULL),
  ('2026-09-09-t157-a', :u::uuid, :p1::uuid, 't157-a', '2026-09-09', 'Criativo', 'act_1', 'c1', 'Camp Um', 's1', 'Conj Um',
    5, 100, 1, 1, 50, 0, 0, NULL, NULL, NULL, NULL, NULL),
  -- (a empata 100 impressões em 02/09 e 09/09: no anúncio, vence o dia mais recente)
  -- b: real no P1 e só inventário no P2; curva com ponto que não parseia
  ('2026-09-05-t157-b', :u::uuid, :p1::uuid, 't157-b', '2026-09-05', 'Criativo', 'act_1', 'c1', 'Camp Um B', 's2', 'Conj Dois',
    12, 300, 3, 2, 280, 10, 5, '["100", "x", 20]',
    '[{"action_type":"video_view","value":"10"}]', '[{"action_type":"purchase","value":"4"}]', '{70,70}',
    '{"m1": {"31": 1}, "m2": {"A": 1}}'),
  -- c: silo do ator (fraco) e silo do dono do pack compartilhado (vence no mesmo dia)
  ('2026-09-07-t157-c', :u::uuid, :p1::uuid, 't157-c', '2026-09-07', 'Criativo', 'act_1', 'c1', 'Camp Um', 's1', 'Conj Um',
    1, 10, 0, 0, 10, 0, 0, NULL, NULL, NULL, NULL, NULL),
  ('2026-09-07-t157-c', :o::uuid, :p3::uuid, 't157-c', '2026-09-07', 'Criativo', 'act_9', 'c1', 'Camp do Dono', 's1', 'Conj do Dono',
    99, 999, 20, 15, 900, 400, 100, '[100, 90, 60, 30]',
    '[{"action_type":"link_click","value":"15"}]', '[{"action_type":"purchase","value":"9"}]', '{95}', '{"m1": {"25": 5}}'),
  ('2026-09-08-t157-c', :o::uuid, :p3::uuid, 't157-c', '2026-09-08', 'Criativo', 'act_9', 'c1', 'Camp do Dono', 's1', 'Conj do Dono',
    50, 500, 10, 8, 450, 200, 50, '[100, 50]', NULL, '[{"action_type":"purchase","value":"3"}]', NULL, NULL),
  -- r: dia real com o nome antigo; o inventário (e ads) têm o nome novo
  ('2026-09-03-t157-r', :u::uuid, :p1::uuid, 't157-r', '2026-09-03', 'Criativo', 'act_1', 'c1', 'Camp Um', 's1', 'Conj Um',
    7, 70, 2, 2, 60, 30, 10, '[100, 60, 30]', NULL, NULL, '{60}', NULL);

INSERT INTO public.ad_pack_inventory (user_id, pack_id, ad_id, account_id, campaign_id, campaign_name, adset_id,
                                      adset_name, ad_name, first_active_date, last_active_date) VALUES
  (:u::uuid, :p1::uuid, 't157-i', 'act_1', 'c1', 'Camp Um', 's1', 'Conj Um', 'Criativo', '2026-09-01', '2026-09-10'),
  (:u::uuid, :p2::uuid, 't157-i', 'act_1', 'c1', 'Camp Um', 's1', 'Conj Um', 'Criativo', '2026-09-04', '2026-09-06'),
  (:u::uuid, :p1::uuid, 't157-r', 'act_1', 'c1', 'Camp Um', 's1', 'Conj Um', 'Criativo novo', '2026-09-01', '2026-09-10'),
  (:u::uuid, :p2::uuid, 't157-b', 'act_1', 'c1', 'Camp Um B', 's2', 'Conj Dois', 'Criativo', '2026-09-01', '2026-09-10'),
  (:u::uuid, :p2::uuid, 't157-j', 'act_1', 'c2', 'Camp Dois', 's3', 'Conj Tres', 'Sozinho', '2026-09-02', '2026-09-09');

-- Uma chamada à v155 e ao alvo com os mesmos parâmetros, como o usuário do JWT.
CREATE FUNCTION pg_temp.chamar(p_fn text, p_uid uuid, p_d0 date, p_d1 date, p_ent text, p_id text, p_packs uuid[],
                               p_group text, p_curve boolean, p_series integer, p_custom boolean) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  EXECUTE format('SELECT public.%I($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)', p_fn)
    INTO r USING p_uid, p_d0, p_d1, p_ent, p_id, p_packs, p_group, p_curve, p_series, p_custom;
  RETURN r;
END $$;

CREATE TEMP TABLE casos (rotulo text, uid uuid, d0 date, d1 date, ent text, id text, packs uuid[],
                         grp text, curve boolean, series integer, custom boolean) ON COMMIT DROP;
INSERT INTO casos
SELECT format('%s|%s|%s|%s|curva=%s|serie=%s|planilha=%s', e.ent, e.id, coalesce(pk.nome, 'sem-pack'), g.grp, c.curve, s.series, cu.custom),
       :u::uuid, '2026-09-01'::date, '2026-09-10'::date, e.ent, e.id, pk.packs, g.grp, c.curve, s.series, cu.custom
FROM (VALUES ('ad_name', 'Criativo'), ('ad_name', 'Criativo novo'), ('ad_name', 'Sozinho'),
             ('adset_id', 's1'), ('adset_id', 's3'), ('ad_id', 't157-a'), ('ad_id', 't157-i'), ('ad_id', 't157-c'))
       AS e(ent, id)
CROSS JOIN (VALUES ('p1', ARRAY[:p1::uuid]), ('p1+p2', ARRAY[:p1::uuid, :p2::uuid]),
                   ('p1+p3-compartilhado', ARRAY[:p1::uuid, :p3::uuid]), (NULL, NULL::uuid[])) AS pk(nome, packs)
CROSS JOIN (VALUES ('entity'), ('ad_id')) AS g(grp)
CROSS JOIN (VALUES (false), (true)) AS c(curve)
CROSS JOIN (VALUES (5), (NULL::integer)) AS s(series)
CROSS JOIN (VALUES (false), (true)) AS cu(custom);
-- período vazio e janela de série mais curta que o período
INSERT INTO casos VALUES
  ('vazio', :u::uuid, '2026-10-01', '2026-10-05', 'ad_name', 'Criativo', ARRAY[:p1::uuid, :p2::uuid], 'ad_id', true, 5, true),
  ('um-dia', :u::uuid, '2026-09-06', '2026-09-06', 'ad_name', 'Criativo', ARRAY[:p1::uuid, :p2::uuid], 'ad_id', false, 5, false),
  ('serie-2', :u::uuid, '2026-09-01', '2026-09-10', 'adset_id', 's1', ARRAY[:p1::uuid, :p3::uuid], 'ad_id', true, 2, true);

CREATE TEMP TABLE saidas ON COMMIT DROP AS
SELECT c.rotulo,
       pg_temp.chamar('fetch_entity_performance_v155', c.uid, c.d0, c.d1, c.ent, c.id, c.packs, c.grp, c.curve, c.series, c.custom) AS ref,
       pg_temp.chamar(current_setting('lab.alvo'), c.uid, c.d0, c.d1, c.ent, c.id, c.packs, c.grp, c.curve, c.series, c.custom) AS alvo
FROM casos c;

-- G: o cenário não é vazio (só sobre a v155).
SELECT pg_temp.expect('G1.cenario-exercita-os-campos',
  (SELECT concat_ws(' ',
     'casos=' || count(*),
     'com-grupos=' || count(*) FILTER (WHERE jsonb_array_length(ref->'groups') > 0),
     'curva=' || count(*) FILTER (WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(ref->'groups') g WHERE jsonb_typeof(g->'curve_wsum') = 'array')),
     'planilha=' || count(*) FILTER (WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(ref->'groups') g WHERE g->'totals'->'custom_histograms' <> '{}')),
     'leads-no-dia=' || count(*) FILTER (WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(ref->'groups') g, jsonb_array_elements(g->'days') d WHERE d->'leads' <> '{}')),
     'so-inventario=' || count(*) FILTER (WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(ref->'groups') g WHERE g->'totals'->>'impressions' = '0' AND jsonb_array_length(g->'days') = 0)),
     'dono-vence=' || count(*) FILTER (WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(ref->'groups') g WHERE g->>'user_id' = '00000000-0000-4000-8000-00000000157a')))
   FROM saidas),
  -- 515 = 8 entidades × 4 seleções × 16 combinações + 3 avulsos. Os 129 sem grupo são esperados:
  -- 'Criativo novo' (renomeado com dia real, 64), 'Sozinho' e s3 fora do P2 (32 + 32), período vazio.
  'casos=515 com-grupos=386 curva=105 planilha=105 leads-no-dia=209 so-inventario=194 dono-vence=49');

-- G2: no modo entity o pack do representante (a, só no P1) difere da união do grupo (P1+P2):
--     é o que dá à sabotagem 1 onde aparecer.
SELECT pg_temp.expect('G2.pack-do-representante-nao-e-a-uniao',
  (SELECT (g->'pack_ids')::text FROM saidas, jsonb_array_elements(ref->'groups') g
   WHERE rotulo = 'ad_name|Criativo|p1+p2|entity|curva=f|serie=5|planilha=f'),
  '["11111111-1111-4111-8111-000000001571"]');

-- A: idêntico, caso a caso.
SELECT pg_temp.expect('A.' || rotulo, alvo::text, ref::text) FROM saidas ORDER BY rotulo;

-- B. ESCALA ------------------------------------------------------------------------
\set l   '''00000000-0000-4000-8000-00000000157b'''
\set pl  '''11111111-1111-4111-8111-00000000157b'''
INSERT INTO auth.users (id) VALUES (:l::uuid) ON CONFLICT DO NOTHING;
INSERT INTO public.packs (id, user_id, name, level, adaccount_id, date_start, date_stop, ad_ids)
VALUES (:pl::uuid, :l::uuid, 'lab 157 escala', 'ad', 'act_1', '2026-09-01', '2026-09-05', ARRAY[]::text[]);
INSERT INTO public.ad_metrics (id, user_id, pack_id, ad_id, date, ad_name, account_id, campaign_id, adset_id,
                               spend, impressions, clicks, video_total_plays, conversions, leadscore_values)
SELECT d::date::text || '-e' || n, :l::uuid, :pl::uuid, 'e' || n, d::date,
       CASE WHEN n <= 200 THEN 'Escala-200' ELSE 'Escala-1600' END, 'act_1', 'c1', 's' || (n % 7),
       n % 50, 100 + n % 997, n % 13, n % 40,
       '[{"action_type":"purchase","value":"1"},{"action_type":"lead","value":"2"}]', '{80,90}'
FROM generate_series(1, 1800) n, generate_series('2026-09-01'::date, '2026-09-05'::date, '1 day') d;
ANALYZE public.ad_metrics, public.ad_performance_daily;

CREATE FUNCTION pg_temp.ms(p_fn text, p_nome text, p_esperado int) RETURNS numeric
LANGUAGE plpgsql AS $$
DECLARE t0 timestamptz; melhor numeric; r jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000157b","role":"authenticated"}', true);
  FOR i IN 1..3 LOOP
    t0 := clock_timestamp();
    EXECUTE format('SELECT public.%I($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)', p_fn) INTO r
      USING '00000000-0000-4000-8000-00000000157b'::uuid, '2026-09-01'::date, '2026-09-05'::date, 'ad_name', p_nome,
            ARRAY['11111111-1111-4111-8111-00000000157b'::uuid], 'ad_id', false, 5, false;
    melhor := least(coalesce(melhor, 1e12), extract(epoch FROM clock_timestamp() - t0) * 1000);
  END LOOP;
  IF jsonb_array_length(r->'groups') <> p_esperado THEN
    RAISE EXCEPTION 'FALHOU B0: % devolveu % grupos, esperado %', p_nome, jsonb_array_length(r->'groups'), p_esperado;
  END IF;
  RETURN round(melhor);
END $$;

CREATE TEMP TABLE tempos ON COMMIT DROP AS
SELECT pg_temp.ms(current_setting('lab.alvo'), 'Escala-200', 200) AS n200,
       pg_temp.ms(current_setting('lab.alvo'), 'Escala-1600', 1600) AS n1600;
SELECT current_setting('lab.alvo') AS alvo, n200 AS "ms 200 anúncios", n1600 AS "ms 1600 anúncios",
       round(n1600 / nullif(n200, 0), 1) AS razao FROM tempos;
SELECT pg_temp.expect('B1.escala-linear (razao 1600/200 < 25)',
  (SELECT (n1600 / nullif(n200, 0) < 25)::text FROM tempos), 'true');

SELECT '157 OK — ' || (SELECT count(*) FROM saidas) || ' telas idênticas à v155 + escala linear' AS resultado;
ROLLBACK;
