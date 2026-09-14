-- Teste da 155: Manager (base_v155) e detalhe (entity_v155) completados pelo inventário.
--
-- ORDEM DE PROPÓSITO: cada asserção é a primeira a ver a sabotagem que lhe corresponde.
--
-- Sabotagens que TÊM de fazer este teste falhar:
--   1. Base sem o intervalo (qualquer linha do inventário entra)          -> falha em Q1
--   2. Base sem o anti-join (anúncio com dia real ganha linha zerada)     -> falha em Q2
--   3. Base com rep_enc sem coalesce (linha sem dia anula a chave)        -> falha em Q3
--   4. Base com os nomes do representante só de ad_metrics               -> falha em Q3
--   5. Base sem o filtro de nome de campanha na linha do inventário      -> falha em Q5
--   6. Detalhe sem os packs do inventário em packs_by_ad                 -> falha em E1
--   7. Detalhe com os nomes do representante só de ad_metrics             -> falha em E2
--   8. Detalhe com o anti-join por `keys` (a entidade) e não pelo rollup  -> falha em E3
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

\set u   '''00000000-0000-4000-8000-000000000155'''
\set p1  '''11111111-1111-4111-8111-000000001551'''
\set p2  '''11111111-1111-4111-8111-000000001552'''

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000155"}', true);

INSERT INTO public.packs (id, user_id, name, level, adaccount_id, date_start, date_stop, ad_ids) VALUES
  (:p1::uuid, :u::uuid, 'lab 155 A', 'ad', 'act_1', '2026-09-01', '2026-09-12', ARRAY[]::text[]),
  (:p2::uuid, :u::uuid, 'lab 155 B', 'ad', 'act_1', '2026-09-01', '2026-09-12', ARRAY[]::text[]);

INSERT INTO public.ads (ad_id, user_id, ad_name, adset_id, campaign_id, effective_status) VALUES
  ('t155-r', :u::uuid, 'Real', 's1', 'c1', 'PAUSED'),
  ('t155-i', :u::uuid, 'Inv',  's1', 'c1', 'ACTIVE'),
  ('t155-h', :u::uuid, 'Hole', 's1', 'c1', 'ACTIVE'),
  ('t155-b', :u::uuid, 'Both novo', 's1', 'c1', 'ACTIVE'),
  ('t155-z', :u::uuid, 'Zero', 's2', 'c2', 'ACTIVE');

-- Período das consultas: 04/09..10/09.
INSERT INTO public.ad_metrics (id, user_id, pack_id, ad_id, date, ad_name, account_id, campaign_id, campaign_name,
                               adset_id, adset_name, spend, impressions, clicks) VALUES
  -- r: real, dois dias
  ('2026-09-05-t155-r', :u::uuid, :p1::uuid, 't155-r', '2026-09-05', 'Real', 'act_1', 'c1', 'Camp Um', 's1', 'Conj Um', 10, 100, 1),
  ('2026-09-06-t155-r', :u::uuid, :p1::uuid, 't155-r', '2026-09-06', 'Real', 'act_1', 'c1', 'Camp Um', 's1', 'Conj Um', 5, 50, 1),
  -- b: real num dia, com o nome ANTIGO; o inventário tem o nome novo
  ('2026-09-04-t155-b', :u::uuid, :p1::uuid, 't155-b', '2026-09-04', 'Both', 'act_1', 'c1', 'Camp Um', 's1', 'Conj Um', 1, 10, 0);

INSERT INTO public.ad_pack_inventory (user_id, pack_id, ad_id, account_id, campaign_id, campaign_name, adset_id,
                                      adset_name, ad_name, first_active_date, last_active_date) VALUES
  (:u::uuid, :p1::uuid, 't155-i', 'act_1', 'c1', 'Camp Um', 's1', 'Conj Um', 'Inv', '2026-09-01', '2026-09-08'),
  (:u::uuid, :p1::uuid, 't155-h', 'act_1', 'c1', 'Camp Um', 's1', 'Conj Um', 'Hole', '2026-09-01', '2026-09-02'),
  (:u::uuid, :p1::uuid, 't155-b', 'act_1', 'c1', 'Camp Um', 's1', 'Conj Um', 'Both novo', '2026-09-01', '2026-09-10'),
  (:u::uuid, :p1::uuid, 't155-z', 'act_2', 'c2', 'Camp Dois', 's2', 'Conj Dois', 'Zero', '2026-09-09', '2026-09-12'),
  -- p2: i também está aqui; b está aqui SEM dia real (o dia real dele é no p1)
  (:u::uuid, :p2::uuid, 't155-i', 'act_1', 'c1', 'Camp Um', 's1', 'Conj Um', 'Inv', '2026-09-05', '2026-09-06'),
  (:u::uuid, :p2::uuid, 't155-b', 'act_1', 'c1', 'Camp Um', 's1', 'Conj Um', 'Both', '2026-09-04', '2026-09-05');

CREATE FUNCTION pg_temp.base(p_group text, p_packs uuid[], p_account text[] DEFAULT NULL,
                             p_camp text DEFAULT NULL, p_ad text DEFAULT NULL) RETURNS jsonb
LANGUAGE sql AS $$
  SELECT public.fetch_manager_performance_base_v155(
    '00000000-0000-4000-8000-000000000155'::uuid, '2026-09-04', '2026-09-10', p_group, p_packs, p_account,
    p_camp, NULL, p_ad, NULL, true, false, 500, 0, 'spend', NULL, false) $$;

CREATE FUNCTION pg_temp.linhas(j jsonb) RETURNS text LANGUAGE sql AS $$
  SELECT string_agg((r->>'group_key') || '=' || trim_scale((r->>'spend')::numeric)::text, ',' ORDER BY r->>'group_key')
  FROM jsonb_array_elements(j->'data') r $$;

-- Q1: presença por anúncio. h fica fora (inventário acaba antes do período); b entra uma vez só.
SELECT pg_temp.expect('Q1.presenca',
  pg_temp.linhas(pg_temp.base('ad_id', ARRAY[:p1::uuid])),
  't155-b=1,t155-i=0,t155-r=15,t155-z=0');

-- Q2: por nome. O dia real de b (nome antigo) basta; o nome do inventário não abre grupo.
SELECT pg_temp.expect('Q2.sem-linha-zerada-para-quem-tem-dia',
  pg_temp.linhas(pg_temp.base('ad_name', ARRAY[:p1::uuid])),
  'Both=1,Inv=0,Real=15,Zero=0');

-- Q3: grupo só de inventário tem representante e nomes do inventário.
SELECT pg_temp.expect('Q3.representante-do-inventario',
  (SELECT r->>'ad_id' || '|' || (r->>'ad_name') || '|' || (r->>'campaign_name') || '|' || (r->>'adset_name')
   FROM jsonb_array_elements(pg_temp.base('ad_name', ARRAY[:p1::uuid])->'data') r WHERE r->>'group_key' = 'Inv'),
  't155-i|Inv|Camp Um|Conj Um');

-- Q4: grupo misto — representante é o real de mais impressões; contagem e ativos incluem o zerado.
SELECT pg_temp.expect('Q4.grupo-misto',
  (SELECT r->>'ad_id' || '|' || (r->>'ad_count') || '|' || (r->>'active_count') || '|' || trim_scale((r->>'spend')::numeric)
   FROM jsonb_array_elements(pg_temp.base('adset_id', ARRAY[:p1::uuid])->'data') r WHERE r->>'group_key' = 's1'),
  't155-r|3|2|16');

-- Q5: filtros usam a identidade do inventário.
SELECT pg_temp.expect('Q5a.filtro-de-conta',
  pg_temp.linhas(pg_temp.base('ad_id', ARRAY[:p1::uuid], ARRAY['act_2'])), 't155-z=0');
SELECT pg_temp.expect('Q5b.filtro-de-campanha',
  pg_temp.linhas(pg_temp.base('ad_id', ARRAY[:p1::uuid], NULL, 'Dois')), 't155-z=0');
SELECT pg_temp.expect('Q5c.filtro-de-nome',
  pg_temp.linhas(pg_temp.base('ad_id', ARRAY[:p1::uuid], NULL, NULL, 'Inv')), 't155-i=0');

-- Q6: dois packs e ramo legado. i conta uma vez, com os dois packs; b ganha o p2 (só inventário lá).
SELECT pg_temp.expect('Q6a.dois-packs',
  (SELECT string_agg((r->>'group_key') || ':' || (r->>'pack_ids'), ' ' ORDER BY r->>'group_key')
   FROM jsonb_array_elements(pg_temp.base('ad_id', ARRAY[:p1::uuid, :p2::uuid])->'data') r
   WHERE r->>'group_key' IN ('t155-i', 't155-b')),
  't155-b:["11111111-1111-4111-8111-000000001551", "11111111-1111-4111-8111-000000001552"] '
  || 't155-i:["11111111-1111-4111-8111-000000001551", "11111111-1111-4111-8111-000000001552"]');
SELECT pg_temp.expect('Q6b.legado',
  (SELECT (pg_temp.base('adset_id', NULL)->'data'->0->>'ad_count')), '3');

-- Q7: convivência. Com uma linha-zero antiga no período, i não é contado duas vezes.
INSERT INTO public.ad_metrics (id, user_id, pack_id, ad_id, date, ad_name, account_id, campaign_id, adset_id, spend, impressions, clicks)
VALUES ('2026-09-07-t155-i', :u::uuid, :p1::uuid, 't155-i', '2026-09-07', 'Inv', 'act_1', 'c1', 's1', 0, 0, 0);
SELECT pg_temp.expect('Q7.convivencia',
  (SELECT r->>'ad_count' FROM jsonb_array_elements(pg_temp.base('adset_id', ARRAY[:p1::uuid])->'data') r
   WHERE r->>'group_key' = 's1') || ' ' || pg_temp.linhas(pg_temp.base('ad_id', ARRAY[:p1::uuid])),
  '3 t155-b=1,t155-i=0,t155-r=15,t155-z=0');
DELETE FROM public.ad_metrics WHERE id = '2026-09-07-t155-i' AND user_id = :u::uuid;

CREATE FUNCTION pg_temp.ent(p_kind text, p_id text, p_group text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.fetch_entity_performance_v155(
    '00000000-0000-4000-8000-000000000155'::uuid, '2026-09-04', '2026-09-10', p_kind, p_id,
    ARRAY['11111111-1111-4111-8111-000000001551'::uuid, '11111111-1111-4111-8111-000000001552'::uuid],
    p_group, true, NULL, false) $$;

-- E1: filhos do conjunto — i entra zerado, sem dias, com os dois packs.
SELECT pg_temp.expect('E1.filhos-do-conjunto',
  (SELECT string_agg((g->>'group_key') || '=' || trim_scale((g->'totals'->>'spend')::numeric)
                     || '/d' || jsonb_array_length(g->'days') || '/p' || jsonb_array_length(g->'pack_ids'), ','
                     ORDER BY g->>'group_key')
   FROM jsonb_array_elements(pg_temp.ent('adset_id', 's1', 'ad_id')->'groups') g),
  't155-b=1/d1/p2,t155-i=0/d0/p2,t155-r=15/d2/p1');

-- E2: detalhe de um anúncio só de inventário, com os nomes do inventário.
SELECT pg_temp.expect('E2.anuncio-so-inventario',
  (SELECT (g->>'ad_count') || '|' || (g->>'ad_name') || '|' || (g->>'campaign_name') || '|' || (g->'totals'->>'impressions')
   FROM jsonb_array_elements(pg_temp.ent('ad_id', 't155-i', 'entity')->'groups') g),
  '1|Inv|Camp Um|0');

-- E3: renomeado. O nome novo (só no inventário do p1) não traz b de volta: ele tem dia real no p1.
--     No p2 o inventário diz "Both" (nome antigo), então "Both novo" não tem nenhum anúncio.
SELECT pg_temp.expect('E3.renomeado-nao-duplica',
  (SELECT count(*)::text FROM jsonb_array_elements(pg_temp.ent('ad_name', 'Both novo', 'entity')->'groups')),
  '0');

SELECT '155 OK — 13 asserções';
ROLLBACK;
