-- ===========================================================================
-- Teste da migration 171 — série e detalhe seguem a regra de imagem
-- ===========================================================================
--
-- A 170 tratou as LINHAS do Manager; a 171 trata os dois caminhos que entregam
-- número dia a dia. Este arquivo cobre o que o dado real não tem (nome misturado com
-- play espúrio) e o que o diferencial não enxerga (a curva de retenção, que só sai
-- quando se pede `include_curve`).
--
-- S1. Série de um nome SÓ de imagem: o dia sai NULL nas razões de vídeo (não 0 — a
--     série já escreve `case when plays > 0 ... else null`) e 0 em plays/thruplays.
-- S2. Série de um nome MISTURADO (a mesma peça como vídeo e como estático): o hook do
--     dia é o do VÍDEO (0,5), não a média contaminada (0,545).
-- S3. Formato DESCONHECIDO não é imagem: a série continua igual.
-- S4. Detalhe do modal (totais + série + CURVA) de um nome de imagem: tudo zerado e
--     SEM curva — ela exige `plays > 0`, e plays passa a ser 0.
-- S5. Detalhe de um nome misturado: totais só do vídeo.
--
-- O TESTE NÃO É VAZIO: cada asserção vem pareada com a mesma conta pelas funções
-- ANTIGAS (v145 e v158), que têm de dar o número contaminado.
--
-- POR QUE AQUI SÓ `plays` E `thruplays` SÃO DETECTÁVEIS (medido por sabotagem em 20/09).
-- Nestas duas funções as somas ponderadas nascem DEPOIS da trava — `sum(hook_value *
-- plays)` com o `plays` já zerado dá zero de qualquer jeito. Ou seja, as outras cinco
-- travas são redundantes por construção e NENHUM teste consegue distingui-las; ficam
-- como defesa para o dia em que alguém trocar o denominador. Na 170 é o oposto: lá as
-- somas chegam prontas do passo anterior, cada trava sustenta a sua, e apagar UMA
-- passava por tudo — por isso o teste de lá afirma as sete no nome misto.
--
-- COMO RODAR (só no laboratório, exige a 170 e a 171 aplicadas)
--   psql -d hookify_lab -X -v ON_ERROR_STOP=1 -f supabase/tests/171_serie_em_imagem.test.sql
-- ===========================================================================

BEGIN;

CREATE FUNCTION pg_temp.expect(rotulo text, obtido text, esperado text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF obtido IS DISTINCT FROM esperado THEN
    RAISE EXCEPTION 'FALHOU %: obtido=% esperado=%', rotulo, left(obtido, 400), left(esperado, 400);
  END IF;
END $$;

\set u  '''00000000-0000-4000-8000-000000000171'''
\set p  '''11111111-1111-4111-8111-000000001711'''

INSERT INTO auth.users (id) VALUES (:u::uuid) ON CONFLICT DO NOTHING;

INSERT INTO public.packs (id, user_id, name, level, adaccount_id, date_start, date_stop, ad_ids) VALUES
  (:p::uuid, :u::uuid, 'lab 171 serie', 'ad', 'act_171', '2026-09-01', '2026-09-02', ARRAY[]::text[]);

INSERT INTO public.ads (ad_id, user_id, ad_name, account_id, adset_id, adset_name, campaign_id, campaign_name,
                        effective_status, media_type)
SELECT x.ad_id, :u::uuid, x.nome, 'act_171', 's171', 'Conj 171', 'c171', 'Camp 171', 'ACTIVE', x.mt
FROM (VALUES
  ('t171-v1', 'Misto',       'video'),
  ('t171-i1', 'Misto',       'image'),      -- a mesma peça rodando como estático
  ('t171-i2', 'So imagem',   'image'),
  ('t171-u1', 'Sem formato', 'unknown')
) AS x(ad_id, nome, mt);

-- 2 dias iguais. A curva entra em TODOS (a Meta manda curva até em imagem — por isso
-- ela nunca serviu como sinal de formato).
INSERT INTO public.ad_metrics (id, user_id, pack_id, ad_id, date, ad_name, account_id, campaign_id, campaign_name,
    adset_id, adset_name, spend, impressions, clicks, inline_link_clicks, lpv, reach, frequency,
    video_total_plays, video_total_thruplays, video_watched_p50, video_watched_p75, hold_rate,
    hook_rate, scroll_stop_rate, video_play_curve_actions)
SELECT '2026-09-0' || d || '-' || a.ad_id, :u::uuid, :p::uuid, a.ad_id, ('2026-09-0' || d)::date, n.nome,
       'act_171', 'c171', 'Camp 171', 's171', 'Conj 171',
       a.spend, a.imp, 10, 8, 5, a.imp, 1.0,
       a.plays, a.thru, a.p50, a.p75, a.hold, a.hook, a.scroll,
       jsonb_build_array(1.0, a.hook, a.hold)
FROM (VALUES
  --        gasto  impr   plays  thru  p50  p75  hold  hook  scroll
  ('t171-v1', 100, 10000, 1000,  100,  40,  30,  0.20, 0.50, 0.60),
  ('t171-i1',  50,  5000,  100,   50, 100, 100,  1.00, 1.00, 0.90),   -- play espúrio da Meta
  ('t171-i2',  20,  2000,   10,    5, 100, 100,  1.00, 1.00, 0.90),   -- idem
  ('t171-u1',  30,  3000,  500,   50,  20,  10,  0.10, 0.30, 0.40)
) AS a(ad_id, spend, imp, plays, thru, p50, p75, hold, hook, scroll)
CROSS JOIN generate_series(1, 2) AS d
CROSS JOIN LATERAL (SELECT CASE a.ad_id WHEN 't171-v1' THEN 'Misto' WHEN 't171-i1' THEN 'Misto'
                                        WHEN 't171-i2' THEN 'So imagem' ELSE 'Sem formato' END AS nome) n;

-- ---------------------------------------------------------------------------
-- A série, pelas duas funções
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.serie(p_fn text) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-000000000171', 'role', 'authenticated')::text, true);
  EXECUTE format($q$
    SELECT public.%I('00000000-0000-4000-8000-000000000171'::uuid, '2026-09-01'::date, '2026-09-02'::date,
      -- a série só devolve os grupos PEDIDOS (`p_group_keys`): é a tela quem diz quais
      -- linhas estão à vista. Sem isso a resposta vem vazia.
      'ad_name', ARRAY['11111111-1111-4111-8111-000000001711']::uuid[], null, null, null, null, null,
      ARRAY['Misto', 'So imagem', 'Sem formato']::text[], 7) $q$, p_fn)
  INTO r;
  RETURN r -> 'series_by_group';
END $$;

-- O valor de 01/09 (o eixo da série cobre a JANELA inteira, e os dias sem dado vêm
-- nulos — pegar a posição 0 pegaria um dia anterior ao cenário). Procura a data no
-- próprio eixo, que é como o navegador lê.
CREATE FUNCTION pg_temp.dia1(p_serie jsonb, p_grupo text, p_metrica text) RETURNS text
LANGUAGE sql AS $$
  WITH i AS (
    SELECT (o - 1)::int AS idx FROM jsonb_array_elements_text(p_serie -> p_grupo -> 'axis')
      WITH ORDINALITY AS e(d, o) WHERE d = '2026-09-01'
  )
  SELECT CASE WHEN (SELECT idx FROM i) IS NULL THEN '<dia fora do eixo>'
              WHEN jsonb_typeof(p_serie -> p_grupo -> p_metrica -> (SELECT idx FROM i)) IN ('null') THEN '<nulo>'
              WHEN (p_serie -> p_grupo -> p_metrica -> (SELECT idx FROM i)) IS NULL THEN '<nulo>'
              ELSE trim(trailing '.' from trim(trailing '0' from
                   round(((p_serie -> p_grupo -> p_metrica ->> (SELECT idx FROM i)))::numeric, 6)::text)) END
$$;

CREATE TEMP TABLE s ON COMMIT DROP AS
SELECT 'v171'::text AS fn, pg_temp.serie('fetch_manager_performance_series_v171') AS out
UNION ALL SELECT 'v145', pg_temp.serie('fetch_manager_performance_series_v145');

-- S1. Nome só de imagem: razão de vídeo NULA no dia, contagem zerada.
SELECT pg_temp.expect('S1.hook-do-dia', pg_temp.dia1((SELECT out FROM s WHERE fn='v171'), 'So imagem', 'hook'), '<nulo>');
SELECT pg_temp.expect('S1.hold-do-dia', pg_temp.dia1((SELECT out FROM s WHERE fn='v171'), 'So imagem', 'hold_rate'), '<nulo>');
SELECT pg_temp.expect('S1.p50-do-dia',  pg_temp.dia1((SELECT out FROM s WHERE fn='v171'), 'So imagem', 'video_watched_p50'), '<nulo>');
SELECT pg_temp.expect('S1.gasto-do-dia-continua', pg_temp.dia1((SELECT out FROM s WHERE fn='v171'), 'So imagem', 'spend'), '20');
SELECT pg_temp.expect('S1.plays-do-dia-zerado', pg_temp.dia1((SELECT out FROM s WHERE fn='v171'), 'So imagem', 'plays'), '<nulo>');
SELECT pg_temp.expect('S1.thruplays-do-dia-zerado', pg_temp.dia1((SELECT out FROM s WHERE fn='v171'), 'So imagem', 'thruplays'), '<nulo>');
SELECT pg_temp.expect('S1.v145-dava-thruplays', pg_temp.dia1((SELECT out FROM s WHERE fn='v145'), 'So imagem', 'thruplays'), '5');
SELECT pg_temp.expect('S1.v145-dava-hook-1', pg_temp.dia1((SELECT out FROM s WHERE fn='v145'), 'So imagem', 'hook'), '1');
SELECT pg_temp.expect('S1.v145-dava-plays', pg_temp.dia1((SELECT out FROM s WHERE fn='v145'), 'So imagem', 'plays'), '10');

-- S2. Nome misturado: o hook do dia é o do vídeo.
SELECT pg_temp.expect('S2.hook-do-misto', pg_temp.dia1((SELECT out FROM s WHERE fn='v171'), 'Misto', 'hook'), '0.5');
SELECT pg_temp.expect('S2.hold-do-misto',   pg_temp.dia1((SELECT out FROM s WHERE fn='v171'), 'Misto', 'hold_rate'), '0.2');
SELECT pg_temp.expect('S2.scroll-do-misto', pg_temp.dia1((SELECT out FROM s WHERE fn='v171'), 'Misto', 'scroll_stop'), '0.6');
SELECT pg_temp.expect('S2.p50-do-misto',    pg_temp.dia1((SELECT out FROM s WHERE fn='v171'), 'Misto', 'video_watched_p50'), '40');
SELECT pg_temp.expect('S2.p75-do-misto',    pg_temp.dia1((SELECT out FROM s WHERE fn='v171'), 'Misto', 'video_watched_p75'), '30');
SELECT pg_temp.expect('S2.v145-contaminada', pg_temp.dia1((SELECT out FROM s WHERE fn='v145'), 'Misto', 'hook'), '0.545455');
SELECT pg_temp.expect('S2.v145-contaminada-hold', pg_temp.dia1((SELECT out FROM s WHERE fn='v145'), 'Misto', 'hold_rate'), '0.272727');

-- S3. Formato desconhecido não é imagem.
SELECT pg_temp.expect('S3.desconhecido-intacto', pg_temp.dia1((SELECT out FROM s WHERE fn='v171'), 'Sem formato', 'hook'), '0.3');
SELECT pg_temp.expect('S3.desconhecido-igual-na-v145',
  pg_temp.dia1((SELECT out FROM s WHERE fn='v171'), 'Sem formato', 'hook'),
  pg_temp.dia1((SELECT out FROM s WHERE fn='v145'), 'Sem formato', 'hook'));

-- ---------------------------------------------------------------------------
-- O detalhe do modal: totais, série e CURVA
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.detalhe(p_fn text, p_nome text) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-000000000171', 'role', 'authenticated')::text, true);
  EXECUTE format($q$
    SELECT public.%I('00000000-0000-4000-8000-000000000171'::uuid, '2026-09-01'::date, '2026-09-02'::date,
      'ad_name', %L, ARRAY['11111111-1111-4111-8111-000000001711']::uuid[], 'entity', true, 7, false) $q$, p_fn, p_nome)
  INTO r;
  RETURN r;
END $$;

CREATE TEMP TABLE det ON COMMIT DROP AS
SELECT fn, nome, pg_temp.detalhe(fn, nome) AS out FROM (
  SELECT 'fetch_entity_performance_v171'::text AS fn, x.nome FROM (VALUES ('So imagem'), ('Misto')) x(nome)
  UNION ALL SELECT 'fetch_entity_performance_v158', x.nome FROM (VALUES ('So imagem'), ('Misto')) x(nome)
) t;

-- A resposta e {groups: [ {group_key, totals: {...}, days: [...], curve_wsum, ...} ]}.
CREATE FUNCTION pg_temp.tot(p_fn text, p_nome text, p_campo text) RETURNS text
LANGUAGE sql AS $$
  SELECT CASE WHEN (out #> ARRAY['groups', '0', 'totals', p_campo]) IS NULL THEN '<ausente>'
              ELSE trim(trailing '.' from trim(trailing '0' from
                   round((out #>> ARRAY['groups', '0', 'totals', p_campo])::numeric, 6)::text)) END
  FROM det WHERE fn = p_fn AND nome = p_nome
$$;

-- Quantos pontos tem a curva de retenção. Sem curva o campo vem nulo (escalar), e
-- `jsonb_array_length` num escalar é erro — daí o teste do tipo.
CREATE FUNCTION pg_temp.curva(p_fn text, p_nome text) RETURNS integer
LANGUAGE sql AS $$
  SELECT CASE WHEN jsonb_typeof(out #> ARRAY['groups', '0', 'curve_wsum']) = 'array'
              THEN jsonb_array_length(out #> ARRAY['groups', '0', 'curve_wsum']) ELSE 0 END
  FROM det WHERE fn = p_fn AND nome = p_nome
$$;

-- S4. Nome de imagem no modal: nada de vídeo, e a curva não existe.
SELECT pg_temp.expect('S4.plays-zerado',  pg_temp.tot('fetch_entity_performance_v171', 'So imagem', 'plays'), '0');
SELECT pg_temp.expect('S4.hook-wsum-zerado', pg_temp.tot('fetch_entity_performance_v171', 'So imagem', 'hook_wsum'), '0');
SELECT pg_temp.expect('S4.gasto-continua', pg_temp.tot('fetch_entity_performance_v171', 'So imagem', 'spend'), '40');
SELECT pg_temp.expect('S4.sem-curva', pg_temp.curva('fetch_entity_performance_v171', 'So imagem')::text, '0');
SELECT pg_temp.expect('S4.v158-tinha-curva',
  (pg_temp.curva('fetch_entity_performance_v158', 'So imagem') > 0)::text, 'true');
SELECT pg_temp.expect('S4.v158-tinha-plays', pg_temp.tot('fetch_entity_performance_v158', 'So imagem', 'plays'), '20');

-- S5. Nome misturado no modal: só o vídeo entra na métrica de vídeo.
SELECT pg_temp.expect('S5.plays-so-do-video', pg_temp.tot('fetch_entity_performance_v171', 'Misto', 'plays'), '2000');
SELECT pg_temp.expect('S5.v158-contaminada', pg_temp.tot('fetch_entity_performance_v158', 'Misto', 'plays'), '2200');
SELECT pg_temp.expect('S5.gasto-de-todos', pg_temp.tot('fetch_entity_performance_v171', 'Misto', 'spend'), '300');
-- as somas ponderadas do detalhe no nome misto: é delas que o modal tira hook/hold/etc.
-- Sem estas, apagar a trava de uma coluna do detalhe passava ileso (achado da revisão).
SELECT pg_temp.expect('S5.thruplays-so-do-video', pg_temp.tot('fetch_entity_performance_v171', 'Misto', 'thruplays'), '200');
SELECT pg_temp.expect('S5.v158-thruplays-contaminada', pg_temp.tot('fetch_entity_performance_v158', 'Misto', 'thruplays'), '300');
SELECT pg_temp.expect('S5.hook-wsum-so-do-video', pg_temp.tot('fetch_entity_performance_v171', 'Misto', 'hook_wsum'), '1000');
SELECT pg_temp.expect('S5.hold-wsum-so-do-video', pg_temp.tot('fetch_entity_performance_v171', 'Misto', 'hold_rate_wsum'), '400');
SELECT pg_temp.expect('S5.p50-wsum-so-do-video',  pg_temp.tot('fetch_entity_performance_v171', 'Misto', 'video_watched_p50_wsum'), '80000');
SELECT pg_temp.expect('S5.v158-hook-wsum-contaminada', pg_temp.tot('fetch_entity_performance_v158', 'Misto', 'hook_wsum'), '1200');
SELECT pg_temp.expect('S5.v158-hold-wsum-contaminada', pg_temp.tot('fetch_entity_performance_v158', 'Misto', 'hold_rate_wsum'), '600');

DO $$ BEGIN RAISE NOTICE 'OK: 171 — serie e detalhe em imagem, 34 checagens'; END $$;

ROLLBACK;
