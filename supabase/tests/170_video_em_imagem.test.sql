-- ===========================================================================
-- Teste da migration 170 — métrica de vídeo não se aplica a anúncio de imagem
-- ===========================================================================
--
-- POR QUE ESTE TESTE EXISTE, ALÉM DO DIFERENCIAL
-- ----------------------------------------------
-- O diferencial (`backend/scripts/diff_manager_v170.py`) roda v162 × v170 nos
-- cenários reais do laboratório e prova que só métrica de vídeo de anúncio de imagem
-- muda. Mas os dados reais não têm os dois casos que mais importam:
--
-- C1. NOME MISTURADO: o mesmo criativo veiculado como vídeo e como estático. O nome
--     continua sendo vídeo (precedência da v145), e a métrica de vídeo tem de sair só
--     das variações de vídeo — nem tudo (contaminado), nem nada (apagado).
-- C2. NOME SÓ DE IMAGEM com play espúrio: a linha continua aparecendo com gasto e
--     impressões; a métrica de vídeo é que zera.
-- C3. CAMPANHA/CONJUNTO: o play espúrio sai do denominador de todo mundo.
-- C4. FORMATO DESCONHECIDO não é imagem: quem não tem certeza mantém o número.
-- C5. Todas as sete colunas de vídeo, não só plays e hook.
-- C6. O cabeçalho (média ponderada) desce do mesmo lugar e segue a regra.
--
-- O TESTE NÃO É VAZIO: cada asserção da v170 vem com a mesma conta pela v162, que
-- TEM de dar o número contaminado. Se alguém remover a trava, C1/C2/C3 falham.
--
-- DUAS SABOTAGENS QUE O DIFERENCIAL NÃO VIU E ESTE TESTE PEGOU (19/09/2026)
--   - travar SÓ plays e thruplays, deixando os numeradores de vídeo passarem: num
--     nome misturado o hook SOBE (0,6 em vez de 0,5) — o play da imagem sai do
--     denominador e o hook dela fica no numerador. Parece equivalente e não é;
--     é por isso que as SETE colunas são travadas, não só o denominador (C1).
--   - travar também o formato DESCONHECIDO: "não sei" não é "é imagem" (C3/C4).
--   Os dados reais não têm nome misturado com play espúrio e nenhum anúncio sem formato
--   tem play (dos 1.812, só 2 tiveram entrega) — por isso o diferencial passa ileso nas
--   duas. É exatamente o buraco que este arquivo existe para tapar.
--
-- COMO RODAR (só no laboratório, exige a 170 aplicada)
--   psql -d hookify_lab -X -v ON_ERROR_STOP=1 -f supabase/tests/170_video_em_imagem.test.sql
-- ===========================================================================

BEGIN;

CREATE FUNCTION pg_temp.expect(rotulo text, obtido text, esperado text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF obtido IS DISTINCT FROM esperado THEN
    RAISE EXCEPTION 'FALHOU %: obtido=% esperado=%', rotulo, left(obtido, 400), left(esperado, 400);
  END IF;
END $$;

\set u  '''00000000-0000-4000-8000-000000000170'''
\set p  '''11111111-1111-4111-8111-000000001701'''

INSERT INTO auth.users (id) VALUES (:u::uuid) ON CONFLICT DO NOTHING;

INSERT INTO public.packs (id, user_id, name, level, adaccount_id, date_start, date_stop, ad_ids) VALUES
  (:p::uuid, :u::uuid, 'lab 170 video em imagem', 'ad', 'act_170', '2026-09-01', '2026-09-02', ARRAY[]::text[]);

-- Quatro anúncios na MESMA campanha: um vídeo e uma imagem compartilhando o nome
-- "Misto", uma imagem sozinha e um formato desconhecido.
INSERT INTO public.ads (ad_id, user_id, ad_name, account_id, adset_id, adset_name, campaign_id, campaign_name,
                        effective_status, media_type)
SELECT x.ad_id, :u::uuid, x.nome, 'act_170', 's170', 'Conj 170', 'c170', 'Camp 170', 'ACTIVE', x.mt
FROM (VALUES
  ('t170-v1', 'Misto',       'video'),
  ('t170-i1', 'Misto',       'image'),     -- mesma peça rodando como estático
  ('t170-i2', 'So imagem',   'image'),
  ('t170-u1', 'Sem formato', 'unknown')
) AS x(ad_id, nome, mt);

-- 2 dias iguais: o esperado é o dobro de cada número por dia.
INSERT INTO public.ad_metrics (id, user_id, pack_id, ad_id, date, ad_name, account_id, campaign_id, campaign_name,
    adset_id, adset_name, spend, impressions, clicks, inline_link_clicks, lpv, reach, frequency,
    video_total_plays, video_total_thruplays, video_watched_p50, video_watched_p75, hold_rate,
    hook_rate, scroll_stop_rate)
SELECT '2026-09-0' || d || '-' || a.ad_id, :u::uuid, :p::uuid, a.ad_id, ('2026-09-0' || d)::date, n.nome,
       'act_170', 'c170', 'Camp 170', 's170', 'Conj 170',
       a.spend, a.imp, 10, 8, 5, a.imp, 1.0,
       a.plays, a.thru, a.p50, a.p75, a.hold, a.hook, a.scroll
FROM (VALUES
  --        gasto  impr   plays  thru  p50  p75  hold  hook  scroll
  ('t170-v1', 100, 10000, 1000,  100,  40,  30,  0.20, 0.50, 0.60),
  ('t170-i1',  50,  5000,  100,   50, 100, 100,  1.00, 1.00, 0.90),   -- play espúrio da Meta
  ('t170-i2',  20,  2000,   10,    5, 100, 100,  1.00, 1.00, 0.90),   -- idem
  ('t170-u1',  30,  3000,  500,   50,  20,  10,  0.10, 0.30, 0.40)
) AS a(ad_id, spend, imp, plays, thru, p50, p75, hold, hook, scroll)
CROSS JOIN generate_series(1, 2) AS d
CROSS JOIN LATERAL (SELECT CASE a.ad_id WHEN 't170-v1' THEN 'Misto' WHEN 't170-i1' THEN 'Misto'
                                        WHEN 't170-i2' THEN 'So imagem' ELSE 'Sem formato' END AS nome) n;

-- Chamada e leitura: as mesmas da prova da 162 (pedaços -> colunas -> linhas).
CREATE FUNCTION pg_temp.chama(p_fn text, p_group text) RETURNS json
LANGUAGE plpgsql AS $$
DECLARE r json;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-000000000170', 'role', 'authenticated')::text, true);
  EXECUTE format($q$
    SELECT coalesce(json_agg(v), '[]') FROM public.%I('00000000-0000-4000-8000-000000000170'::uuid,
      '2026-09-01'::date, '2026-09-02'::date, %L, ARRAY['11111111-1111-4111-8111-000000001701']::uuid[],
      null, null, null, null, null, true, false, 500, 0, 'spend', null, false, null) v $q$, p_fn, p_group)
  INTO r;
  RETURN r;
END $$;

CREATE FUNCTION pg_temp.juntar(partes json) RETURNS json
LANGUAGE sql AS $$
  SELECT CASE WHEN count(*) FILTER (WHERE x::jsonb ? 'row_count') = 1 THEN
    ((jsonb_agg(x::jsonb) FILTER (WHERE x::jsonb ? 'row_count')) -> 0
      || jsonb_build_object('data_columns', coalesce(jsonb_agg(x::jsonb) FILTER (WHERE NOT x::jsonb ? 'row_count'), '[]')))::json
  END
  FROM json_array_elements(partes) x
$$;

CREATE FUNCTION pg_temp.linhas(p json) RETURNS TABLE (i integer, linha jsonb)
LANGUAGE sql AS $$
  SELECT (p->'row_order'->>(k - 1))::integer, jsonb_object_agg(c.key, (c.value::jsonb) -> (k - 1))
  FROM generate_series(1, (p->>'row_count')::integer) k
  CROSS JOIN LATERAL json_array_elements(p->'data_columns') b
  CROSS JOIN LATERAL json_each(b) c
  GROUP BY k
$$;

CREATE TEMP TABLE r ON COMMIT DROP AS
SELECT aba, fn, pg_temp.juntar(partes) AS out FROM (
  SELECT 'nome'::text AS aba, 'v170'::text AS fn, pg_temp.chama('fetch_manager_rankings_v170', 'ad_name') AS partes
  UNION ALL SELECT 'nome',     'v162', pg_temp.chama('fetch_manager_rankings_v162', 'ad_name')
  UNION ALL SELECT 'anuncio',  'v170', pg_temp.chama('fetch_manager_rankings_v170', 'ad_id')
  UNION ALL SELECT 'anuncio',  'v162', pg_temp.chama('fetch_manager_rankings_v162', 'ad_id')
  UNION ALL SELECT 'campanha', 'v170', pg_temp.chama('fetch_manager_rankings_v170', 'campaign_id')
  UNION ALL SELECT 'campanha', 'v162', pg_temp.chama('fetch_manager_rankings_v162', 'campaign_id')
) t;

CREATE TEMP TABLE l ON COMMIT DROP AS
SELECT r.aba, r.fn, x.linha FROM r CROSS JOIN LATERAL pg_temp.linhas(r.out) x;

-- Um jeito só de ler uma métrica de uma linha, arredondada (as razões são float8).
CREATE FUNCTION pg_temp.m(p_aba text, p_fn text, p_chave text, p_campo text) RETURNS text
LANGUAGE sql AS $$
  SELECT CASE WHEN (linha->>p_campo) IS NULL THEN '<ausente>'
              ELSE trim(trailing '.' from trim(trailing '0' from round((linha->>p_campo)::numeric, 6)::text)) END
  FROM l WHERE aba = p_aba AND fn = p_fn
    AND coalesce(linha->>'group_key', linha->>'ad_id') = p_chave
$$;

-- ---------------------------------------------------------------------------
-- C1. Nome misturado: a métrica de vídeo sai SÓ das variações de vídeo.
--     v1 (vídeo): 1000 plays/dia × 2 = 2000, hook 0,50, thru 100/dia × 2 = 200.
--     i1 (imagem): 100 plays/dia entram na v162 e não entram na v170.
-- ---------------------------------------------------------------------------
SELECT pg_temp.expect('C1.plays-do-nome-misto',    pg_temp.m('nome', 'v170', 'Misto', 'plays'), '2000');
SELECT pg_temp.expect('C1.hook-do-nome-misto',     pg_temp.m('nome', 'v170', 'Misto', 'hook'), '0.5');
SELECT pg_temp.expect('C1.thruplays-nome-misto',   pg_temp.m('nome', 'v170', 'Misto', 'video_total_thruplays'), '200');
-- o nome continua sendo VÍDEO (precedência entre as variações) e o gasto é de todas
SELECT pg_temp.expect('C1.formato-do-nome-misto',  (SELECT linha->>'media_type' FROM l WHERE aba='nome' AND fn='v170' AND linha->>'group_key'='Misto'), 'video');
SELECT pg_temp.expect('C1.gasto-nao-muda',         pg_temp.m('nome', 'v170', 'Misto', 'spend'), '300');
-- As OUTRAS QUATRO razões de vídeo no mesmo nome misto. Elas não são redundantes: a
-- trava é um `case` por coluna, e cada um sustenta a sua sozinho. Sem estas linhas,
-- apagar a trava de `hold_rate_wsum` passava ileso pelo teste E pelo diferencial
-- (provado por sabotagem em 2026-09-20).
SELECT pg_temp.expect('C1.hold-do-nome-misto',    pg_temp.m('nome', 'v170', 'Misto', 'hold_rate'), '0.2');
SELECT pg_temp.expect('C1.scroll-do-nome-misto',  pg_temp.m('nome', 'v170', 'Misto', 'scroll_stop'), '0.6');
SELECT pg_temp.expect('C1.p50-do-nome-misto',     pg_temp.m('nome', 'v170', 'Misto', 'video_watched_p50'), '40');
SELECT pg_temp.expect('C1.p75-do-nome-misto',     pg_temp.m('nome', 'v170', 'Misto', 'video_watched_p75'), '30');

-- sem a trava, o mesmo nome vinha contaminado (prova de que o teste não é vazio)
SELECT pg_temp.expect('C1.v162-contaminada-plays', pg_temp.m('nome', 'v162', 'Misto', 'plays'), '2200');
SELECT pg_temp.expect('C1.v162-contaminada-hook',  pg_temp.m('nome', 'v162', 'Misto', 'hook'), '0.545455');
SELECT pg_temp.expect('C1.v162-contaminada-hold',  pg_temp.m('nome', 'v162', 'Misto', 'hold_rate'), '0.272727');
SELECT pg_temp.expect('C1.v162-contaminada-scroll',pg_temp.m('nome', 'v162', 'Misto', 'scroll_stop'), '0.627273');
SELECT pg_temp.expect('C1.v162-contaminada-p50',   pg_temp.m('nome', 'v162', 'Misto', 'video_watched_p50'), '45');
SELECT pg_temp.expect('C1.v162-contaminada-p75',   pg_temp.m('nome', 'v162', 'Misto', 'video_watched_p75'), '36');

-- ---------------------------------------------------------------------------
-- C2. Nome só de imagem: a linha fica, o número de vídeo zera.
-- ---------------------------------------------------------------------------
SELECT pg_temp.expect('C2.linha-continua',      pg_temp.m('nome', 'v170', 'So imagem', 'spend'), '40');
SELECT pg_temp.expect('C2.impressoes-ficam',    pg_temp.m('nome', 'v170', 'So imagem', 'impressions'), '4000');
SELECT pg_temp.expect('C2.plays-zeram',         pg_temp.m('nome', 'v170', 'So imagem', 'plays'), '0');
SELECT pg_temp.expect('C2.hook-zera',           pg_temp.m('nome', 'v170', 'So imagem', 'hook'), '0');
SELECT pg_temp.expect('C2.v162-dava-hook-1',    pg_temp.m('nome', 'v162', 'So imagem', 'hook'), '1');

-- ---------------------------------------------------------------------------
-- C3. Campanha: o play espúrio sai do denominador de todo mundo.
--     v170: plays 2000 (vídeo) + 1000 (desconhecido) = 3000;
--           hook (0,5×2000 + 0,3×1000) / 3000 = 0,433333
--     v162: plays 3220; hook (0,5×2000 + 1×200 + 1×20 + 0,3×1000) / 3220 = 0,472050
-- ---------------------------------------------------------------------------
SELECT pg_temp.expect('C3.plays-da-campanha',      pg_temp.m('campanha', 'v170', 'c170', 'plays'), '3000');
SELECT pg_temp.expect('C3.hook-da-campanha',       pg_temp.m('campanha', 'v170', 'c170', 'hook'), '0.433333');
SELECT pg_temp.expect('C3.v162-plays-contaminado', pg_temp.m('campanha', 'v162', 'c170', 'plays'), '3220');
SELECT pg_temp.expect('C3.v162-hook-contaminado',  pg_temp.m('campanha', 'v162', 'c170', 'hook'), '0.47205');

-- ---------------------------------------------------------------------------
-- C1b. O RÓTULO de formato da linha (170): no grão do NOME é a precedência entre as
--      cópias (vídeo > imagem); no grão do ANÚNCIO é o formato DA VARIAÇÃO. Sem isto,
--      a variação estática de um nome misto saía como "vídeo" e a tela mostrava
--      "hook 0%" no lugar do ícone de "não se aplica".
-- ---------------------------------------------------------------------------
SELECT pg_temp.expect('C1b.nome-misto-e-video',
  (SELECT linha->>'media_type' FROM l WHERE aba='nome' AND fn='v170' AND linha->>'group_key'='Misto'), 'video');
SELECT pg_temp.expect('C1b.variacao-estatica-e-imagem',
  (SELECT linha->>'media_type' FROM l WHERE aba='anuncio' AND fn='v170' AND linha->>'ad_id'='t170-i1'), 'image');
SELECT pg_temp.expect('C1b.variacao-de-video-e-video',
  (SELECT linha->>'media_type' FROM l WHERE aba='anuncio' AND fn='v170' AND linha->>'ad_id'='t170-v1'), 'video');
SELECT pg_temp.expect('C1b.variacao-sem-formato',
  (SELECT coalesce(linha->>'media_type', '<nulo>') FROM l WHERE aba='anuncio' AND fn='v170' AND linha->>'ad_id'='t170-u1'), 'unknown');
-- a v162 rotulava a variação estática pelo NOME: saía 'video'
SELECT pg_temp.expect('C1b.v162-rotulava-pelo-nome',
  (SELECT linha->>'media_type' FROM l WHERE aba='anuncio' AND fn='v162' AND linha->>'ad_id'='t170-i1'), 'video');

-- ---------------------------------------------------------------------------
-- C4. Formato desconhecido NÃO é imagem: mantém o número.
-- ---------------------------------------------------------------------------
SELECT pg_temp.expect('C4.desconhecido-mantem-plays', pg_temp.m('nome', 'v170', 'Sem formato', 'plays'), '1000');
SELECT pg_temp.expect('C4.desconhecido-mantem-hook',  pg_temp.m('nome', 'v170', 'Sem formato', 'hook'), '0.3');

-- ---------------------------------------------------------------------------
-- C5. As SETE colunas de vídeo, no grão do anúncio (não só plays e hook).
--     A imagem zera todas; o vídeo mantém todas.
-- ---------------------------------------------------------------------------
SELECT pg_temp.expect('C5.imagem.' || campo, pg_temp.m('anuncio', 'v170', 't170-i1', campo), '0')
FROM unnest(ARRAY['plays', 'video_total_thruplays', 'hook', 'hold_rate', 'scroll_stop',
                  'video_watched_p50', 'video_watched_p75']) AS campo;

SELECT pg_temp.expect('C5.video.' || x.campo, pg_temp.m('anuncio', 'v170', 't170-v1', x.campo), x.esperado)
FROM (VALUES ('plays', '2000'), ('video_total_thruplays', '200'), ('hook', '0.5'), ('hold_rate', '0.2'),
             ('scroll_stop', '0.6'), ('video_watched_p50', '40'), ('video_watched_p75', '30')) AS x(campo, esperado);

-- ---------------------------------------------------------------------------
-- C6. Cabeçalho: a média ponderada do topo desce do mesmo lugar.
--     Mesma conta da campanha, porque o pack inteiro é uma campanha só.
-- ---------------------------------------------------------------------------
SELECT pg_temp.expect('C6.hook-do-cabecalho',
  (SELECT round((out->'header_aggregates'->'weighted_averages'->>'hook')::numeric, 6)::text FROM r WHERE aba='nome' AND fn='v170'),
  '0.433333');
SELECT pg_temp.expect('C6.v162-cabecalho-contaminado',
  (SELECT round((out->'header_aggregates'->'weighted_averages'->>'hook')::numeric, 6)::text FROM r WHERE aba='nome' AND fn='v162'),
  '0.472050');

DO $$ BEGIN RAISE NOTICE 'OK: 170 — video em imagem, 39 checagens'; END $$;

ROLLBACK;
