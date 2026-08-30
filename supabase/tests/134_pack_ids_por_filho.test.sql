-- DIFERENCIAL da migration 134: fetch_entity_performance_v133 × v134.
--
-- O QUE PROVA
--   1. CONTRATO INTACTO — removendo a chave nova (`pack_ids`) do resultado da v134,
--      o JSON fica IDÊNTICO ao da v133, para toda combinação de cenário. Qualquer
--      diferença é bug: a 134 não deveria mudar número nenhum.
--   2. A CHAVE NOVA É CORRETA — `pack_ids` existe em toda linha-filha, e todo id
--      devolvido está dentro da seleção pedida (`p_pack_ids`). Devolver pack fora
--      da seleção faria o filtro da tela oferecer pack que não está lá.
--   3. O TESTE NÃO É VAZIO — exige um número mínimo de cenários e de linhas com
--      pack não-vazio. Sem isso, um banco sem dados faria tudo "passar".
--
-- COMO RODAR (lab local com o dump restaurado + migrations 128..134 aplicadas):
--   psql "$LAB_URL" -X -v ON_ERROR_STOP=1 -f supabase/tests/134_pack_ids_por_filho.test.sql
-- Sai com código 0 e imprime "OK: N asserções". Roda em transação e termina em ROLLBACK.
--
-- SABOTAGEM (prova de que o teste pega) — qualquer uma TEM de fazer o teste falhar:
--   a) tirar o filtro da seleção no CTE packs_by_ad (`and (p_pack_ids is null or ...)`)
--   b) trocar `left join packs_by_ad` por um array fixo
--   c) mexer em qualquer número da v134 (ex.: somar 1 a impressions)

\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned

BEGIN;

CREATE TEMP TABLE t_counter (n integer NOT NULL);
INSERT INTO t_counter VALUES (0);

CREATE FUNCTION pg_temp.expect(p_label text, p_ok boolean) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT coalesce(p_ok, false) THEN
    RAISE EXCEPTION 'FALHOU: %', p_label;
  END IF;
  UPDATE t_counter SET n = n + 1;
END;
$$;

-- Tira `pack_ids` de cada grupo, para comparar o resto com a v133.
CREATE FUNCTION pg_temp.strip_pack_ids(p jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_set(p, '{groups}', coalesce((
    SELECT jsonb_agg(g - 'pack_ids' ORDER BY ord)
    FROM jsonb_array_elements(p->'groups') WITH ORDINALITY t(g, ord)
  ), '[]'::jsonb))
$$;

-- ---------------------------------------------------------------------------
-- Cenários descobertos no banco: para cada pack com dados, as entidades com mais
-- linhas (é onde há filho suficiente para o array significar algo).
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE t_cases AS
WITH packs AS (
  SELECT p.id AS pack_id, p.user_id
  FROM public.packs p
  WHERE EXISTS (SELECT 1 FROM public.ad_metric_pack_map m WHERE m.pack_id = p.id)
  ORDER BY p.id
  LIMIT 4
),
janela AS (
  SELECT pk.pack_id, pk.user_id,
         min(m.metric_date) AS d0,
         max(m.metric_date) AS d1
  FROM packs pk
  JOIN public.ad_metric_pack_map m ON m.pack_id = pk.pack_id
  GROUP BY pk.pack_id, pk.user_id
),
-- o ad_name com mais anúncios distintos no pack: o caso rico de linha-filha
top_ad_name AS (
  SELECT DISTINCT ON (j.pack_id)
         j.pack_id, j.user_id, j.d0, j.d1, 'ad_name'::text AS entity, am.ad_name AS entity_id
  FROM janela j
  JOIN public.ad_metric_pack_map m ON m.pack_id = j.pack_id
  JOIN public.ad_metrics am ON am.user_id = m.user_id AND am.ad_id = m.ad_id AND am.date = m.metric_date
  WHERE nullif(am.ad_name, '') IS NOT NULL
  GROUP BY j.pack_id, j.user_id, j.d0, j.d1, am.ad_name
  ORDER BY j.pack_id, count(DISTINCT am.ad_id) DESC, am.ad_name
),
top_adset AS (
  SELECT DISTINCT ON (j.pack_id)
         j.pack_id, j.user_id, j.d0, j.d1, 'adset_id'::text AS entity, am.adset_id AS entity_id
  FROM janela j
  JOIN public.ad_metric_pack_map m ON m.pack_id = j.pack_id
  JOIN public.ad_metrics am ON am.user_id = m.user_id AND am.ad_id = m.ad_id AND am.date = m.metric_date
  WHERE nullif(am.adset_id, '') IS NOT NULL
  GROUP BY j.pack_id, j.user_id, j.d0, j.d1, am.adset_id
  ORDER BY j.pack_id, count(DISTINCT am.ad_id) DESC, am.adset_id
),
top_ad_id AS (
  SELECT DISTINCT ON (j.pack_id)
         j.pack_id, j.user_id, j.d0, j.d1, 'ad_id'::text AS entity, am.ad_id AS entity_id
  FROM janela j
  JOIN public.ad_metric_pack_map m ON m.pack_id = j.pack_id
  JOIN public.ad_metrics am ON am.user_id = m.user_id AND am.ad_id = m.ad_id AND am.date = m.metric_date
  GROUP BY j.pack_id, j.user_id, j.d0, j.d1, am.ad_id
  ORDER BY j.pack_id, count(*) DESC, am.ad_id
),
-- CENÁRIO CRÍTICO: entidade que contém um ANÚNCIO-DIA mapeado para 2+ packs,
-- pedindo só UM deles.
--
-- A condição precisa ser por (anúncio, DIA), não por ad_name: o filtro do CTE atua
-- na linha do mapa, que é anúncio-dia. Um ad_name com o anúncio X no pack A e o
-- anúncio Y no pack B não exercita nada — cada linha do mapa tem um pack só, e
-- tirar o filtro não muda resposta. Foi assim que as sabotagens (a) e (d)
-- passaram despercebidas nas duas primeiras rodadas.
multi_pack AS (
  SELECT DISTINCT ON (am.ad_name)
         (array_agg(DISTINCT dup.pack_id ORDER BY dup.pack_id))[1] AS pack_id,
         dup.user_id,
         min(dup.metric_date) AS d0,
         max(dup.metric_date) AS d1,
         'ad_name'::text AS entity,
         am.ad_name AS entity_id
  FROM (
    SELECT m.user_id, m.ad_id, m.metric_date, m.pack_id
    FROM public.ad_metric_pack_map m
    JOIN (
      SELECT user_id, ad_id, metric_date
      FROM public.ad_metric_pack_map
      GROUP BY 1, 2, 3
      HAVING count(DISTINCT pack_id) > 1
    ) d ON d.user_id = m.user_id AND d.ad_id = m.ad_id AND d.metric_date = m.metric_date
  ) dup
  JOIN public.ad_metrics am
    ON am.user_id = dup.user_id AND am.ad_id = dup.ad_id AND am.date = dup.metric_date
  JOIN public.packs p ON p.id = dup.pack_id AND p.user_id = dup.user_id
  WHERE nullif(am.ad_name, '') IS NOT NULL
  GROUP BY am.ad_name, dup.user_id
  ORDER BY am.ad_name, count(DISTINCT dup.ad_id) DESC
  LIMIT 3
)
SELECT * FROM top_ad_name
UNION ALL SELECT * FROM top_adset
UNION ALL SELECT * FROM top_ad_id
UNION ALL SELECT * FROM multi_pack;

DO $$
DECLARE
  c record;
  gb text;
  packs uuid[];
  v133 jsonb;
  v134 jsonb;
  grp jsonb;
  pid text;
  i integer;
  n_casos integer := 0;
  n_com_pack integer := 0;
BEGIN
  FOR c IN SELECT * FROM t_cases LOOP
    -- o ator é o dono do pack (a função exige auth.uid() = p_user_id)
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c.user_id)::text, true);

    -- group_by 'ad_id' é o caso das LINHAS-FILHAS, que é o alvo da 134;
    -- o outro agrupa na própria entidade (o cabeçalho do detalhe).
    FOREACH gb IN ARRAY ARRAY['ad_id', 'entity'] LOOP
      -- com a seleção de packs e sem ela (ramo legado). Não dá para varrer os dois
      -- num ARRAY[] só: um array de arrays exige dimensões iguais, e NULL não tem.
      FOR i IN 1..2 LOOP
        packs := CASE WHEN i = 1 THEN ARRAY[c.pack_id] ELSE NULL::uuid[] END;

        -- Por NOME: a assinatura tem 9 parâmetros e p_pack_ids vem ANTES de
        -- p_group_by. Posicional aqui já custou um erro.
        v133 := public.fetch_entity_performance_v133(
          p_user_id => c.user_id, p_date_start => c.d0, p_date_stop => c.d1,
          p_entity => c.entity, p_entity_id => c.entity_id,
          p_pack_ids => packs, p_group_by => gb,
          p_include_curve => false, p_series_days => NULL);

        v134 := public.fetch_entity_performance_v134(
          p_user_id => c.user_id, p_date_start => c.d0, p_date_stop => c.d1,
          p_entity => c.entity, p_entity_id => c.entity_id,
          p_pack_ids => packs, p_group_by => gb,
          p_include_curve => false, p_series_days => NULL);

        n_casos := n_casos + 1;

        -- (1) contrato: tirando pack_ids, tem de ser byte a byte o mesmo JSON
        PERFORM pg_temp.expect(
          format('contrato %s/%s/%s packs=%s', c.entity, c.entity_id, gb, coalesce(packs::text, 'NULL')),
          pg_temp.strip_pack_ids(v134) = v133);

        -- (2) a chave nova existe em todo grupo, e respeita a seleção
        FOR grp IN SELECT jsonb_array_elements(v134->'groups') LOOP
          PERFORM pg_temp.expect(
            format('pack_ids presente %s/%s', c.entity, c.entity_id),
            grp ? 'pack_ids' AND jsonb_typeof(grp->'pack_ids') = 'array');

          IF jsonb_array_length(grp->'pack_ids') > 0 THEN
            n_com_pack := n_com_pack + 1;
            IF packs IS NOT NULL THEN
              FOR pid IN SELECT jsonb_array_elements_text(grp->'pack_ids') LOOP
                PERFORM pg_temp.expect(
                  format('pack fora da selecao: %s nao esta em %s', pid, packs::text),
                  pid::uuid = ANY(packs));
              END LOOP;
            END IF;
          END IF;
        END LOOP;

      END LOOP;
    END LOOP;
  END LOOP;

  -- (3) o teste não pode passar por vacuidade
  PERFORM pg_temp.expect(format('cenarios demais de menos: %s', n_casos), n_casos >= 8);
  PERFORM pg_temp.expect(format('nenhuma linha com pack: %s', n_com_pack), n_com_pack >= 5);
  -- Sem um caso de anúncio em 2+ packs, o recorte por seleção não é testado: tirar
  -- o filtro do CTE passaria batido. Esta asserção é a guarda contra esse vazio.
  PERFORM pg_temp.expect(
    'nenhum cenario com anuncio em 2+ packs — o recorte por selecao nao foi exercitado',
    -- alias `tc`: `c` é a variável do laço deste bloco e tornaria a coluna ambígua.
    -- Condição por ANÚNCIO-DIA (não por ad_name): é o grão em que o filtro atua.
    (SELECT count(*) FROM t_cases tc
      WHERE tc.entity = 'ad_name'
        AND EXISTS (
          SELECT 1
          FROM public.ad_metric_pack_map m
          JOIN public.ad_metrics am
            ON am.user_id = m.user_id AND am.ad_id = m.ad_id AND am.date = m.metric_date
          WHERE am.ad_name = tc.entity_id
          GROUP BY m.user_id, m.ad_id, m.metric_date
          HAVING count(DISTINCT m.pack_id) > 1
        )) >= 1);

  RAISE NOTICE 'cenarios=% grupos_com_pack=%', n_casos, n_com_pack;
END;
$$;

-- ---------------------------------------------------------------------------
-- CASO SINTÉTICO: o pack de FORA da janela não pode vazar.
--
-- POR QUE PRECISA SER FABRICADO
--   O join de `packs_by_ad` casa por (usuário, anúncio, DIA). Tirar a condição de
--   dia é um bug real — passaria a colher packs de datas fora do período pedido —
--   mas é INVISÍVEL nos dados reais deste banco, onde o vínculo pack↔anúncio nunca
--   muda ao longo do tempo. Sem este caso, a sabotagem "d" passa despercebida.
--
--   Tudo aqui é inserido dentro da transação e some no ROLLBACK.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  alvo record;
  pack_intruso uuid := gen_random_uuid();
  res jsonb;
  vazou boolean;
BEGIN
  -- Um anúncio com pelo menos dois dias distintos: o mapa tem FK para ad_metrics,
  -- então o vínculo "de fora da janela" precisa cair num dia que EXISTE.
  SELECT am.user_id, am.ad_id, min(am.date) AS dia_de_fora, max(am.date) AS dia_pedido
  INTO alvo
  FROM public.ad_metrics am
  JOIN public.ad_metric_pack_map m
    ON m.user_id = am.user_id AND m.ad_id = am.ad_id AND m.metric_date = am.date
  GROUP BY am.user_id, am.ad_id
  HAVING count(DISTINCT am.date) >= 2
  LIMIT 1;

  PERFORM pg_temp.expect('nao achei anuncio com 2+ dias para o caso sintetico', alvo.ad_id IS NOT NULL);

  INSERT INTO public.packs (id, user_id, name, date_start, date_stop, level, filters, auto_refresh, conversion_types)
  VALUES (pack_intruso, alvo.user_id, 'PACK INTRUSO (teste)', alvo.dia_de_fora, alvo.dia_de_fora, 'ad', '{}'::jsonb, false, '{}'::text[]);

  -- vínculo do MESMO anúncio, num dia que FICA FORA da janela que será pedida
  INSERT INTO public.ad_metric_pack_map (user_id, pack_id, ad_id, metric_date, created_at)
  VALUES (alvo.user_id, pack_intruso, alvo.ad_id, alvo.dia_de_fora, now())
  ON CONFLICT DO NOTHING;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', alvo.user_id)::text, true);

  -- Janela de UM dia (o último), e sem seleção de packs: assim a ÚNICA coisa que
  -- pode barrar o intruso é a condição de dia no join de packs_by_ad.
  res := public.fetch_entity_performance_v134(
    p_user_id => alvo.user_id, p_date_start => alvo.dia_pedido, p_date_stop => alvo.dia_pedido,
    p_entity => 'ad_id', p_entity_id => alvo.ad_id,
    p_pack_ids => NULL, p_group_by => 'ad_id',
    p_include_curve => false, p_series_days => NULL);

  SELECT bool_or(g->'pack_ids' @> to_jsonb(pack_intruso::text))
  INTO vazou
  FROM jsonb_array_elements(res->'groups') g;

  PERFORM pg_temp.expect(
    'pack de fora da janela vazou para a linha-filha (condicao de dia no join)',
    NOT coalesce(vazou, false));
END;
$$;

\pset tuples_only off
SELECT 'OK: ' || n || ' asserções' FROM t_counter;

ROLLBACK;
