-- ===========================================================================
-- Teste da migration 162 — Manager em pedaços
-- ===========================================================================
--
-- A 162 é a 161 com a SAÍDA trocada (uma linha por pedaço, para o banco não montar
-- um JSON gigante na memória) e dois campos a menos. Este teste roda o MESMO cenário
-- sintético da 161 — os ramos que os dados reais não exercitam (status vazio,
-- miniatura codificada, conjunto, renome, 10.050 linhas) — sobre a 162, juntando os
-- pedaços como os leitores juntam, e repete todas as verificações C1–C8. Depois:
--
-- C9. forma da 162: um pedaço de metadados só; um campo por pedaço; sem
--     `adcreatives_videos_thumbs`; `thumb_storage_path` só sem prefixo; razões sem
--     as 20 casas do numeric; e as LINHAS iguais às da v161 (tirando os dois campos,
--     razões comparadas como float8 — o número que o navegador lê).
--
-- O diferencial (`backend/scripts/diff_manager_v162.py`) cobre os dados reais.
--
-- COMO RODAR (só no laboratório; precisa das migrations 161 e 162)
--   psql -d hookify_lab -X -v ON_ERROR_STOP=1 -f supabase/tests/162_manager_em_pedacos.test.sql
--
-- SABOTAGENS PROVADAS (16/09/2026) — ver README dos testes
-- ===========================================================================

BEGIN;

CREATE FUNCTION pg_temp.expect(rotulo text, obtido text, esperado text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF obtido IS DISTINCT FROM esperado THEN
    RAISE EXCEPTION 'FALHOU %: obtido=% esperado=%', rotulo, left(obtido, 400), left(esperado, 400);
  END IF;
END $$;

\set u   '''00000000-0000-4000-8000-000000000161'''
\set p1  '''11111111-1111-4111-8111-000000001611'''
\set p2  '''11111111-1111-4111-8111-000000001612'''
\set pre '''https://exemplo.supabase.co/storage/v1/object/public/ad-thumbs/'''

INSERT INTO auth.users (id) VALUES (:u::uuid) ON CONFLICT DO NOTHING;

INSERT INTO public.packs (id, user_id, name, level, adaccount_id, date_start, date_stop, ad_ids) VALUES
  (:p1::uuid, :u::uuid, 'lab 161 bordas', 'ad', 'act_1', '2026-09-01', '2026-09-03', ARRAY[]::text[]),
  (:p2::uuid, :u::uuid, 'lab 161 volume', 'ad', 'act_1', '2026-09-01', '2026-09-01', ARRAY[]::text[]);

-- Anúncios das bordas. `t161-nulo` NÃO tem linha em `ads` (status nulo).
INSERT INTO public.ads (ad_id, user_id, ad_name, account_id, adset_id, adset_name, campaign_id, campaign_name,
                        effective_status, thumb_storage_path, thumbnail_url, media_type)
SELECT x.ad_id, :u::uuid, x.nome, 'act_1', x.adset, 'Conj', 'c1', x.camp, x.st, x.caminho, x.url, x.mt
FROM (VALUES
  ('t161-ok',      'Ok',      's-ok',  'Camp',      'ACTIVE',          'thumbs/u/ok.webp',     null, 'video'),
  ('t161-esp',     'Esp',     's-ok',  'Camp',      'ACTIVE',          'thumbs/u/a b/ç€.webp', null, 'image'),
  ('t161-espaco',  'Espaco',  's-ok',  'Camp',      '   ',             null,                   null, 'unknown'),
  ('t161-storage', 'Storage', 's-st',  'Camp',      'ACTIVE',          'thumbs/u/novo.webp',
      'https://outro.supabase.co/storage/v1/object/public/ad-thumbs/antigo.webp', 'image'),
  ('t161-pa',      'Pausa',   's-pa',  'Camp',      'ADSET_PAUSED',    null,                   null, 'unknown'),
  ('t161-pc',      'Pausa',   's-pa',  'Camp',      'CAMPAIGN_PAUSED', null,                   null, 'unknown'),
  -- renomeado: os dias em ad_metrics guardam 'Camp'; `ads` já tem o nome novo
  ('t161-ren',     'Renomeado', 's-ren', 'Camp Nova', 'ACTIVE',        null,                   null, 'unknown')
) AS x(ad_id, nome, adset, camp, st, caminho, url, mt);

INSERT INTO public.parent_entities (user_id, entity_id, level, account_id, daily_budget, lifetime_budget, budget_mode, ads_count)
SELECT :u::uuid, x.id, x.tp, 'act_1', x.daily, null, x.mode, x.n
FROM (VALUES ('s-ok', 'adset', 5000, null::text, 3), ('c1', 'campaign', null, 'cbo', null)) AS x(id, tp, daily, mode, n)
ON CONFLICT DO NOTHING;

INSERT INTO public.ad_metrics (id, user_id, pack_id, ad_id, date, ad_name, account_id, campaign_id, campaign_name,
    adset_id, adset_name, spend, impressions, clicks, inline_link_clicks, reach, video_total_plays,
    video_total_thruplays, video_play_curve_actions, actions, conversions, leadscore_values, custom_hist)
SELECT '2026-09-0' || d || '-' || a.ad_id, :u::uuid, :p1::uuid, a.ad_id, ('2026-09-0' || d)::date, a.nome,
       'act_1', 'c1', 'Camp', a.adset, 'Conj', 10 * d, a.imp * d, 3, 2, 50, 20, 5, null, null, null, null, null
FROM (VALUES ('t161-ok', 'Ok', 's-ok', 100), ('t161-esp', 'Esp', 's-ok', 90), ('t161-espaco', 'Espaco', 's-ok', 80),
             ('t161-nulo', 'Nulo', 's-nulo', 70), ('t161-storage', 'Storage', 's-st', 60),
             ('t161-pa', 'Pausa', 's-pa', 50), ('t161-pc', 'Pausa', 's-pa', 40),
             ('t161-ren', 'Renomeado', 's-ren', 30)) AS a(ad_id, nome, adset, imp)
CROSS JOIN generate_series(1, 3) AS d;

-- Volume: 10.050 anúncios num dia, para passar do corte antigo.
INSERT INTO public.ad_metrics (id, user_id, pack_id, ad_id, date, ad_name, account_id, campaign_id, campaign_name,
    adset_id, adset_name, spend, impressions, clicks, inline_link_clicks, reach, video_total_plays,
    video_total_thruplays, video_play_curve_actions, actions, conversions, leadscore_values, custom_hist)
SELECT '2026-09-01-t161-v' || g, :u::uuid, :p2::uuid, 't161-v' || g, '2026-09-01', 'Vol ' || (g % 7),
       'act_1', 'c2', 'Camp V', 's-v' || (g % 13), 'Conj V', g, g, 1, 1, 1, 0, 0, null, null, null, null, null
FROM generate_series(1, 10050) AS g;

CREATE FUNCTION pg_temp.v161(p_packs uuid[], p_group text, p_prefix text, p_limit integer DEFAULT 100000) RETURNS json
LANGUAGE plpgsql AS $$
DECLARE r json;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-000000000161', 'role', 'authenticated')::text, true);
  SELECT public.fetch_manager_rankings_v161('00000000-0000-4000-8000-000000000161'::uuid, '2026-09-01', '2026-09-03', p_group,
         p_packs, null, null, null, null, null, true, false, p_limit, 0, 'spend', null, false, p_prefix) INTO r;
  RETURN r;
END $$;

-- As linhas de uma resposta em colunas, NA ORDEM de `row_order` (o que o leitor
-- faz): `i` é a posição final.
CREATE FUNCTION pg_temp.linhas(p json) RETURNS TABLE (i integer, linha jsonb)
LANGUAGE sql AS $$
  SELECT (p->'row_order'->>(k - 1))::integer, jsonb_object_agg(c.key, (c.value::jsonb) -> (k - 1))
  FROM generate_series(1, (p->>'row_count')::integer) k
  CROSS JOIN LATERAL json_array_elements(p->'data_columns') b
  CROSS JOIN LATERAL json_each(b) c
  GROUP BY k
$$;

-- A 162 como o PostgREST a entrega: os pedaços num array.
CREATE FUNCTION pg_temp.v162(p_packs uuid[], p_group text, p_prefix text, p_limit integer DEFAULT 100000) RETURNS json
LANGUAGE plpgsql AS $$
DECLARE r json;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-000000000161', 'role', 'authenticated')::text, true);
  SELECT coalesce(json_agg(v), '[]') INTO r
  FROM public.fetch_manager_rankings_v162('00000000-0000-4000-8000-000000000161'::uuid, '2026-09-01', '2026-09-03', p_group,
         p_packs, null, null, null, null, null, true, false, p_limit, 0, 'spend', null, false, p_prefix) v;
  RETURN r;
END $$;

-- Pedaços -> o formato da 161 (o que `from_parts`/`fromParts` fazem). Com zero ou
-- dois pedaços de metadados devolve NULL, e as verificações abaixo falham.
CREATE FUNCTION pg_temp.juntar(partes json) RETURNS json
LANGUAGE sql AS $$
  SELECT CASE WHEN count(*) FILTER (WHERE x::jsonb ? 'row_count') = 1 THEN
    ((jsonb_agg(x::jsonb) FILTER (WHERE x::jsonb ? 'row_count')) -> 0
      || jsonb_build_object('data_columns', coalesce(jsonb_agg(x::jsonb) FILTER (WHERE NOT x::jsonb ? 'row_count'), '[]')))::json
  END
  FROM json_array_elements(partes) x
$$;

CREATE TEMP TABLE r ON COMMIT DROP AS
SELECT aba, partes, pg_temp.juntar(partes) AS out FROM (
  SELECT 'ad_id'::text AS aba, pg_temp.v162(ARRAY[:p1::uuid], 'ad_id', :pre) AS partes
  UNION ALL SELECT 'ad_id_sem_prefixo', pg_temp.v162(ARRAY[:p1::uuid], 'ad_id', NULL)
  UNION ALL SELECT 'adset_id', pg_temp.v162(ARRAY[:p1::uuid], 'adset_id', :pre)
  UNION ALL SELECT 'volume', pg_temp.v162(ARRAY[:p2::uuid], 'ad_id', :pre)
  UNION ALL SELECT 'volume_limitado', pg_temp.v162(ARRAY[:p2::uuid], 'ad_id', :pre, 50)
) t;

CREATE TEMP TABLE l ON COMMIT DROP AS
SELECT r.aba, x.i, x.linha FROM r CROSS JOIN LATERAL pg_temp.linhas(r.out) x
WHERE r.aba <> 'volume';

-- A mesma coisa pela v161, para a equivalência (C9).
CREATE TEMP TABLE l161 ON COMMIT DROP AS
SELECT t.aba, x.i, x.linha FROM (
  SELECT 'ad_id'::text AS aba, pg_temp.v161(ARRAY[:p1::uuid], 'ad_id', :pre) AS out
  UNION ALL SELECT 'ad_id_sem_prefixo', pg_temp.v161(ARRAY[:p1::uuid], 'ad_id', NULL)
  UNION ALL SELECT 'adset_id', pg_temp.v161(ARRAY[:p1::uuid], 'adset_id', :pre)
  UNION ALL SELECT 'volume_limitado', pg_temp.v161(ARRAY[:p2::uuid], 'ad_id', :pre, 50)
) t CROSS JOIN LATERAL pg_temp.linhas(t.out) x;

-- C1. Mais de 10 mil linhas saem inteiras; o limite pedido continua valendo.
SELECT pg_temp.expect('C1.volume-inteiro',
  (SELECT (out->>'row_count') || '/' || (out->'pagination'->>'total') || '/' || (out->'pagination'->>'has_more') FROM r WHERE aba = 'volume'),
  '10050/10050/false');
SELECT pg_temp.expect('C1.limite-pedido-vale',
  (SELECT (out->>'row_count') || '/' || (out->'pagination'->>'total') || '/' || (out->'pagination'->>'has_more') FROM r WHERE aba = 'volume_limitado'),
  '50/10050/true');

-- C2. status_resolved como o Python: falso para nulo e para só-espaços.
SELECT pg_temp.expect('C2.' || (linha->>'ad_id'),
  coalesce(linha->>'effective_status', '<nulo>') || ' -> ' || (linha->>'status_resolved'),
  CASE linha->>'ad_id'
    WHEN 't161-nulo' THEN '<nulo> -> false'
    WHEN 't161-espaco' THEN '    -> false'
    ELSE (linha->>'effective_status') || ' -> true'
  END)
FROM l WHERE aba = 'ad_id' ORDER BY linha->>'ad_id';

-- C3. prefixo + caminho codificado (quote(seg, safe="") por segmento).
SELECT pg_temp.expect('C3.' || (linha->>'ad_id'),
  linha->>'thumbnail',
  CASE linha->>'ad_id'
    WHEN 't161-ok' THEN 'https://exemplo.supabase.co/storage/v1/object/public/ad-thumbs/thumbs/u/ok.webp'
    WHEN 't161-esp' THEN 'https://exemplo.supabase.co/storage/v1/object/public/ad-thumbs/thumbs/u/a%20b/%C3%A7%E2%82%AC.webp'
    WHEN 't161-storage' THEN 'https://exemplo.supabase.co/storage/v1/object/public/ad-thumbs/thumbs/u/novo.webp'
    ELSE NULL
  END)
FROM l WHERE aba = 'ad_id' ORDER BY linha->>'ad_id';

-- C4. No nível de conjunto a miniatura da linha é a do anúncio representante; se ela
--     já é do Storage, fica (a rota Python pulava a linha).
SELECT pg_temp.expect('C4.conjunto-storage-fica',
  (SELECT linha->>'thumbnail' FROM l WHERE aba = 'adset_id' AND linha->>'group_key' = 's-st'),
  'https://outro.supabase.co/storage/v1/object/public/ad-thumbs/antigo.webp');
SELECT pg_temp.expect('C4.conjunto-com-caminho-vira-storage',
  (SELECT linha->>'thumbnail' FROM l WHERE aba = 'adset_id' AND linha->>'group_key' = 's-ok'),
  'https://exemplo.supabase.co/storage/v1/object/public/ad-thumbs/thumbs/u/ok.webp');

-- C5. Sem prefixo, nenhuma URL montada (nível de anúncio com caminho = null).
SELECT pg_temp.expect('C5.sem-prefixo',
  (SELECT string_agg(coalesce(linha->>'thumbnail', '-'), ',' ORDER BY linha->>'ad_id') FROM l WHERE aba = 'ad_id_sem_prefixo'),
  '-,-,-,-,-,-,-,-');

-- C6. Conjunto: motivo da pausa e orçamento.
SELECT pg_temp.expect('C6.' || (linha->>'group_key'),
  concat_ws('|', linha->>'effective_status', linha->>'budget_daily', linha->>'budget_mode', linha->>'ad_count'),
  CASE linha->>'group_key'
    WHEN 's-ok'   THEN 'ACTIVE|5000|cbo|3'
    WHEN 's-pa'   THEN 'ADSET_PAUSED|cbo|2'
    WHEN 's-st'   THEN 'ACTIVE|cbo|1'
    WHEN 's-nulo' THEN 'ACTIVE|cbo|1'
    WHEN 's-ren'  THEN 'ACTIVE|cbo|1'
  END)
FROM l WHERE aba = 'adset_id' ORDER BY linha->>'group_key';

-- C7. Formato.
SELECT pg_temp.expect('C7.' || aba || '.listas-do-tamanho-certo',
  (SELECT bool_and(json_array_length(c.value) = (out->>'row_count')::integer)::text
   FROM json_array_elements(out->'data_columns') b CROSS JOIN LATERAL json_each(b) c),
  'true')
FROM r ORDER BY aba;
SELECT pg_temp.expect('C7.' || aba || '.sem-campo-repetido',
  (SELECT (count(*) = count(DISTINCT c.key))::text
   FROM json_array_elements(out->'data_columns') b CROSS JOIN LATERAL json_each(b) c),
  'true')
FROM r ORDER BY aba;
SELECT pg_temp.expect('C7.' || aba || '.orcamento-so-em-conjunto',
  (SELECT bool_or(c.key = 'budget_mode')::text
   FROM json_array_elements(out->'data_columns') b CROSS JOIN LATERAL json_each(b) c),
  CASE WHEN aba = 'adset_id' THEN 'true' ELSE 'false' END)
FROM r ORDER BY aba;
-- C7b. `row_order` é uma permutação das posições da página, e a ordem por gasto
--      (padrão) sai decrescente quando as linhas são postas nela.
SELECT pg_temp.expect('C7b.' || aba || '.row_order-permutacao',
  (SELECT (count(*) = (out->>'row_count')::integer
           AND count(DISTINCT v::integer) = count(*)
           AND min(v::integer) = (out->'pagination'->>'offset')::integer + 1)::text
   FROM json_array_elements_text(out->'row_order') v),
  'true')
FROM r WHERE aba <> 'volume' ORDER BY aba;
SELECT pg_temp.expect('C7b.volume.row_order-permutacao',
  (SELECT (count(*) = 10050 AND count(DISTINCT v::integer) = 10050 AND min(v::integer) = 1 AND max(v::integer) = 10050)::text
   FROM r, json_array_elements_text(r.out->'row_order') v WHERE r.aba = 'volume'),
  'true');
SELECT pg_temp.expect('C7b.ordem-por-gasto',
  (SELECT bool_and(a.g >= b.g)::text
   FROM (SELECT i, (linha->>'spend')::numeric AS g FROM l WHERE aba = 'ad_id') a
   JOIN (SELECT i, (linha->>'spend')::numeric AS g FROM l WHERE aba = 'ad_id') b ON b.i = a.i + 1),
  'true');

SELECT pg_temp.expect('C7.sem-data-em-linhas',
  (SELECT bool_or(out::jsonb ? 'data')::text FROM r), 'false');

-- C8. Nomes: `ads` quando existe (nome atual), `ad_metrics` do dia quando não.
SELECT pg_temp.expect('C8.' || (linha->>'ad_id'),
  concat_ws('|', linha->>'campaign_name', linha->>'adset_name', linha->>'account_id'),
  CASE linha->>'ad_id'
    WHEN 't161-ren'  THEN 'Camp Nova|Conj|act_1'
    WHEN 't161-nulo' THEN 'Camp|Conj|act_1'
    ELSE 'Camp|Conj|act_1'
  END)
FROM l WHERE aba = 'ad_id' ORDER BY linha->>'ad_id';
SELECT pg_temp.expect('C8.nome-do-anuncio-sem-ads-vem-do-dia',
  (SELECT linha->>'ad_name' FROM l WHERE aba = 'ad_id' AND linha->>'ad_id' = 't161-nulo'), 'Nulo');

-- C9. Forma da 162.
SELECT pg_temp.expect('C9.' || aba || '.um-pedaco-de-metadados',
  (SELECT count(*)::text FROM json_array_elements(partes) x WHERE x::jsonb ? 'row_count'), '1')
FROM r ORDER BY aba;
SELECT pg_temp.expect('C9.' || aba || '.um-campo-por-pedaco',
  (SELECT bool_and((SELECT count(*) FROM json_object_keys(x)) = 1)::text
   FROM json_array_elements(partes) x WHERE NOT x::jsonb ? 'row_count'), 'true')
FROM r ORDER BY aba;
SELECT pg_temp.expect('C9.' || aba || '.campos-de-miniatura',
  (SELECT coalesce(string_agg(k, ',' ORDER BY k), '-')
   FROM json_array_elements(partes) x, json_object_keys(x) k
   WHERE k IN ('adcreatives_videos_thumbs', 'thumb_storage_path')),
  CASE WHEN aba = 'ad_id_sem_prefixo' THEN 'thumb_storage_path' ELSE '-' END)
FROM r ORDER BY aba;
SELECT pg_temp.expect('C9.' || aba || '.razoes-sem-casas-do-numeric',
  (SELECT bool_or(x::text ~ '\.[0-9]*0[],]')::text
   FROM json_array_elements(partes) x, json_object_keys(x) k
   WHERE k IN ('hook', 'hold_rate', 'scroll_stop', 'ctr', 'connect_rate', 'cpm', 'website_ctr', 'frequency')),
  'false')
FROM r ORDER BY aba;

-- Linha comparável: sem os dois campos, razões como float8.
CREATE FUNCTION pg_temp.norm(linha jsonb) RETURNS jsonb
LANGUAGE sql AS $$
  SELECT jsonb_object_agg(e.key,
    CASE WHEN e.key IN ('hook', 'hold_rate', 'scroll_stop', 'ctr', 'connect_rate', 'cpm', 'website_ctr', 'frequency')
              AND jsonb_typeof(e.value) = 'number'
         THEN to_jsonb((e.value #>> '{}')::float8) ELSE e.value END)
  FROM jsonb_each(linha - 'adcreatives_videos_thumbs' - 'thumb_storage_path') e
$$;
SELECT pg_temp.expect('C9.' || a.aba || '.linhas-iguais-a-v161',
  (SELECT jsonb_agg(pg_temp.norm(linha) ORDER BY i)::text FROM l WHERE l.aba = a.aba),
  (SELECT jsonb_agg(pg_temp.norm(linha) ORDER BY i)::text FROM l161 WHERE l161.aba = a.aba))
FROM (VALUES ('ad_id'), ('ad_id_sem_prefixo'), ('adset_id'), ('volume_limitado')) a(aba);
SELECT pg_temp.expect('C9.caminho-sem-prefixo-igual-a-v161',
  (SELECT string_agg(coalesce(linha->>'thumb_storage_path', '-'), ',' ORDER BY i) FROM l WHERE aba = 'ad_id_sem_prefixo'),
  (SELECT string_agg(coalesce(linha->>'thumb_storage_path', '-'), ',' ORDER BY i) FROM l161 WHERE aba = 'ad_id_sem_prefixo'));
SELECT pg_temp.expect('C9.meta-igual-a-v161',
  (SELECT (out::jsonb - 'data_columns' - 'row_order')::text FROM r WHERE aba = 'volume_limitado'),
  (SELECT (pg_temp.v161(ARRAY[:p2::uuid], 'ad_id', :pre, 50)::jsonb - 'data_columns' - 'row_order')::text));

SELECT '162 OK — bordas da 161 sobre os pedaços, forma da 162 e linhas iguais às da v161' AS resultado;

ROLLBACK;
