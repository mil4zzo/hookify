-- Teste da 151: `present_parent_ids` tem de devolver EXATAMENTE o mesmo escopo
-- que a varredura paginada de `ads` que ela substitui — nos casos de borda e em
-- todo silo do laboratorio.
--
-- ORDEM DE PROPOSITO: bordas (B) ANTES do diferencial (A).
-- O diferencial e uma rede tao ampla que pega quase tudo primeiro, e uma
-- assercao que nunca dispara sozinha nao esta provada. Com as bordas na frente,
-- cada uma foi vista falhando pela sabotagem que lhe corresponde. O diferencial
-- fica por ultimo, como rede de seguranca — e cobre tambem os silos sinteticos
-- criados aqui, porque ele varre `select distinct user_id from ads`.
--
-- Sabotagens que TEM de fazer este teste falhar. As quatro foram RODADAS contra
-- este arquivo em 09/09, e cada uma foi vista falhando na assercao indicada —
-- e por isso que a ordem e esta:
--   1. `limit 1000` na funcao                     -> falha em B4
--   2. Tirar o `filter (where ... is not null)`   -> falha em B2
--   3. Tirar o `where user_id = p_user_id`        -> falha em B5
--   4. Trocar `coalesce(..., '{}')` por NULL      -> falha em B3
--   5. Trocar o `distinct` interno por nada       -> NAO falha, e esta certo:
--      o resultado e o mesmo, so fica lento (ordena em disco). O ganho de tempo
--      e medido a parte, no EXPLAIN registrado no cabecalho da migration.
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

-- ===========================================================================
-- B. CASOS DE BORDA, em silos sinteticos
-- ===========================================================================
-- B_vazio  : silo sem nenhum ad
-- B_nulos  : silo so com ads de campaign_id/adset_id NULL
-- B_grande : silo com 1.200 campanhas distintas — ACIMA do teto de 1.000 linhas
--            do PostgREST, que e a razao de esta funcao existir agregando no
--            servidor em vez de o backend filtrar por ids e paginar linhas.
-- B_vizinho: silo separado, para provar que um silo nao enxerga o outro.
\set u_vazio  '''00000000-0000-4000-8000-000000000149'''
\set u_nulos  '''00000000-0000-4000-8000-00000000014a'''
\set u_grande '''00000000-0000-4000-8000-00000000014b'''
\set u_vizin  '''00000000-0000-4000-8000-00000000014c'''

INSERT INTO public.ads (ad_id, user_id, campaign_id, adset_id) VALUES
  ('t151-nulo-1', :u_nulos::uuid, NULL, NULL),
  ('t151-nulo-2', :u_nulos::uuid, NULL, 'adset-real-151');

INSERT INTO public.ads (ad_id, user_id, campaign_id, adset_id)
SELECT 't151-g-' || i, :u_grande::uuid, 'camp-' || lpad(i::text, 5, '0'), 'adset-' || lpad(i::text, 5, '0')
FROM generate_series(1, 1200) i;

INSERT INTO public.ads (ad_id, user_id, campaign_id, adset_id) VALUES
  ('t151-vizinho', :u_vizin::uuid, 'camp-do-vizinho', 'adset-do-vizinho');

-- B5 PRIMEIRO: silo nao vaza para silo. Vem antes de B4 porque a sabotagem que
-- tira o `where user_id` tambem quebraria a contagem de B4 — com B4 na frente,
-- B5 nunca seria vista falhando e ficaria sem prova.
SELECT pg_temp.expect(
  'B5.grande-nao-ve-vizinho',
  (SELECT ('camp-do-vizinho' = ANY(campaign_ids))::text FROM public.present_parent_ids(:u_grande::uuid)),
  'false');
SELECT pg_temp.expect(
  'B5.vizinho-tem-o-seu',
  (SELECT campaign_ids::text FROM public.present_parent_ids(:u_vizin::uuid)),
  '{camp-do-vizinho}');

-- B4: e a assercao que justifica o desenho da funcao.
-- AS 1.200 CAMPANHAS VOLTAM — prova de que a resposta e um par de arrays, e nao
-- uma lista de linhas sujeita ao teto silencioso de 1.000 do PostgREST. Foi por
-- causa deste teto que a ideia original (backend filtrando por ids e paginando
-- linhas de `ads`) foi descartada: ela truncaria sem erro e sumiria com
-- campanhas do escopo, deixando orcamento e status por gravar.
SELECT pg_temp.expect(
  'B4.mil-e-duzentas-campanhas',
  (SELECT cardinality(campaign_ids)::text FROM public.present_parent_ids(:u_grande::uuid)),
  '1200');
SELECT pg_temp.expect(
  'B4.mil-e-duzentos-conjuntos',
  (SELECT cardinality(adset_ids)::text FROM public.present_parent_ids(:u_grande::uuid)),
  '1200');
-- E o conteudo, nao so a contagem: contagem certa com elemento trocado passaria.
SELECT pg_temp.expect(
  'B4.conteudo-primeiro-e-ultimo',
  (SELECT (SELECT min(x) FROM unnest(campaign_ids) x) || '..' || (SELECT max(x) FROM unnest(campaign_ids) x)
   FROM public.present_parent_ids(:u_grande::uuid)),
  'camp-00001..camp-01200');

-- B3 ANTES DE B2: array vazio, nunca NULL — o backend testa pertencimento em
--     cima disso, e NULL viraria "nenhum pai esta no escopo" em silencio.
--     Vem antes porque a sabotagem que tira o `coalesce` tambem faz B2 falhar
--     (o silo de nulos devolveria NULL); com B2 na frente, B3 ficaria sem prova.
SELECT pg_temp.expect(
  'B3.vazio-nao-e-null',
  (SELECT (campaign_ids IS NOT NULL AND adset_ids IS NOT NULL)::text
   FROM public.present_parent_ids(:u_vazio::uuid)),
  'true');

-- B2: NULL nunca entra no array; o id real do mesmo silo entra.
SELECT pg_temp.expect(
  'B2.nulos-fora-do-array',
  (SELECT campaign_ids::text || ' / ' || adset_ids::text FROM public.present_parent_ids(:u_nulos::uuid)),
  '{} / {adset-real-151}');

-- B1: silo sem ads devolve UMA linha com dois arrays vazios (nao zero linhas).
--     Guarda de FORMA, nao de logica: agregacao sem GROUP BY sempre devolve uma
--     linha, entao nenhuma sabotagem plausivel da implementacao atual a quebra.
--     Existe para travar o contrato contra uma reescrita futura que devolva
--     linhas (`select distinct campaign_id ...`), que daria zero linhas aqui.
SELECT pg_temp.expect(
  'B1.silo-vazio-tem-linha',
  (SELECT count(*)::text FROM public.present_parent_ids(:u_vazio::uuid)),
  '1');

-- ===========================================================================
-- A. DIFERENCIAL CONTRA A IMPLEMENTACAO ANTIGA — todo silo, real e sintetico
--
-- A varredura antiga era, em Python: paginar `select campaign_id, adset_id from
-- ads where user_id = X` e jogar cada valor nao-nulo em dois `set()`. O
-- equivalente exato em SQL e o `select distinct` abaixo. Comparo CONJUNTO com
-- CONJUNTO (ordenado), nao contagem.
-- ===========================================================================
CREATE TEMP TABLE t_dif AS
WITH silos AS (SELECT DISTINCT user_id FROM public.ads),
antiga AS (
  SELECT s.user_id,
         (SELECT coalesce(array_agg(DISTINCT a.campaign_id ORDER BY a.campaign_id), '{}')
          FROM public.ads a WHERE a.user_id = s.user_id AND a.campaign_id IS NOT NULL) AS c_old,
         (SELECT coalesce(array_agg(DISTINCT a.adset_id ORDER BY a.adset_id), '{}')
          FROM public.ads a WHERE a.user_id = s.user_id AND a.adset_id IS NOT NULL) AS a_old
  FROM silos s
),
nova AS (
  SELECT s.user_id,
         (SELECT coalesce(array_agg(x ORDER BY x), '{}')
          FROM unnest((SELECT campaign_ids FROM public.present_parent_ids(s.user_id))) x) AS c_new,
         (SELECT coalesce(array_agg(x ORDER BY x), '{}')
          FROM unnest((SELECT adset_ids FROM public.present_parent_ids(s.user_id))) x) AS a_new
  FROM silos s
)
SELECT antiga.user_id, c_old, a_old, c_new, a_new
FROM antiga JOIN nova USING (user_id);

SELECT pg_temp.expect(
  'A.silos-com-divergencia',
  (SELECT count(*)::text FROM t_dif WHERE c_old IS DISTINCT FROM c_new OR a_old IS DISTINCT FROM a_new),
  '0');

-- Guarda contra o teste vazio: sem silo, o zero acima e falso conforto.
-- 5 silos reais no laboratorio + 3 sinteticos com ads (o vazio nao entra).
SELECT pg_temp.expect(
  'A.tem-silo-para-comparar',
  (SELECT (count(*) >= 4)::text FROM t_dif),
  'true');

-- E contra o teste trivial: pelo menos um silo com escopo NAO vazio dos dois lados.
SELECT pg_temp.expect(
  'A.tem-escopo-nao-vazio',
  (SELECT (count(*) >= 1)::text FROM t_dif WHERE cardinality(c_new) > 0 AND cardinality(a_new) > 0),
  'true');

SELECT '151 OK — 8 bordas + diferencial em todos os silos' AS resultado;

ROLLBACK;
