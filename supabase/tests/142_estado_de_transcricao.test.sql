-- DIFERENCIAL da migration 142: fetch_manager_performance_base_v140 × _v142.
--
-- O QUE PROVA
--   1. CONTRATO INTACTO — removendo a chave nova (`transcription_no_audio`) de cada
--      linha do resultado da v142, o JSON fica IDÊNTICO ao da v140. A 142 não deveria
--      mudar número nenhum: qualquer diferença é bug. (A lateral de transcrição perdeu
--      o `limit 1` e o filtro de status — é exatamente o tipo de mudança que pode
--      duplicar linha do grupo sem ninguém notar.)
--   2. A CHAVE NOVA É CORRETA — injetando registros de transcrição CONTROLADOS num
--      ad_name real que aparece no resultado, a flag responde como especificado:
--        failed + no_voice_detected  → transcription_no_audio = true,  has = false
--        completed                   → transcription_no_audio = false, has = true
--        failed sem a flag (retriável)→ ambas false (é "ainda não transcrito")
--        sem registro nenhum          → ambas false
--   3. PRECEDÊNCIA ENTRE SILOS — com dois packs de DONOS diferentes na seleção, o
--      mesmo ad_name pode ter 'completed' num silo e 'failed sem áudio' no outro
--      (a UNIQUE é (user_id, ad_name), então só assim os dois coexistem). O texto
--      que existe de fato ganha: has = true e no_audio = false.
--   4. ISOLAMENTO — mexer num ad_name não mexe na flag de nenhum outro.
--   5. NÍVEL DE PAI — em adset_id/campaign_id a chave existe e é sempre false (o
--      "ad_name" ali é o nome do pai; a flag descreveria o criativo errado).
--   6. O TESTE NÃO É VAZIO — exige um mínimo de linhas e que o ad_name-alvo tenha
--      sido REALMENTE encontrado no payload. Sem isso, um banco vazio faz tudo passar.
--
-- COMO RODAR (lab local com o dump restaurado + migrations até a 142 aplicadas):
--   export PATH="/c/Program Files/PostgreSQL/17/bin:$PATH"
--   export PGPASSWORD='lab_hookify_2026'; export PGHOST=127.0.0.1; export PGUSER=hookify_lab
--   psql -d hookify_lab -X -v ON_ERROR_STOP=1 -f supabase/tests/142_estado_de_transcricao.test.sql
-- Sai com código 0 e imprime "OK: N asserções". Roda em transação e termina em ROLLBACK.
--
-- SABOTAGEM (prova de que o teste pega) — as três TEM de fazer o teste falhar, e foram
-- rodadas de fato em 2026-09-05 antes do cutover:
--   a) trocar `bool_or(t.status = 'failed' and ...)` por `bool_or(t.status = 'failed')`
--      → falha retriável passa a contar como "sem áudio"        → quebra D1
--   b) tirar o `and not coalesce(tr.has_transcription, false)` da projeção
--      → transcrito perde a precedência sobre sem-áudio          → quebra G2
--   c) mexer em qualquer número da v142 (ex.: `pr.ad_count + 1`) → quebra A1
--
-- O QUE **NÃO** É SABOTÁVEL, e por quê (registrado para não dar falsa confiança):
-- tirar o `case ... else false` que zera a flag nos níveis de pai NÃO faz a seção F
-- falhar — a própria lateral já tem `v_group_by in ('ad_name','ad_id')` no WHERE, então
-- fora do nível de criativo ela não devolve linha e o coalesce entrega false de todo
-- jeito. O `case` é redundância defensiva (copiada do `has_transcription`, que sempre
-- foi assim); F1/F2 são guarda de regressão, não prova de que aquele `case` funciona.

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

-- Tira `transcription_no_audio` de cada linha, para comparar o resto com a v140.
CREATE FUNCTION pg_temp.strip_new_key(p jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_set(p, '{data}', coalesce((
    SELECT jsonb_agg(d - 'transcription_no_audio' ORDER BY ord)
    FROM jsonb_array_elements(p->'data') WITH ORDINALITY t(d, ord)
  ), '[]'::jsonb))
$$;

-- Lê a flag de um ad_name específico dentro do payload. NULL = ad_name não está lá
-- (o que é falha de cenário, não resultado — as asserções distinguem os dois).
CREATE FUNCTION pg_temp.flag_of(p jsonb, p_ad_name text, p_key text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT (d->>p_key)::boolean
  FROM jsonb_array_elements(p->'data') d
  WHERE d->>'ad_name' = p_ad_name
  LIMIT 1
$$;

-- ---------------------------------------------------------------------------
-- Cenário: o pack com mais linhas de métrica, na janela inteira dele.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE t_alvo AS
SELECT p.id AS pack_id, p.user_id,
       min(m.metric_date) AS d0,
       max(m.metric_date) AS d1
FROM public.packs p
JOIN public.ad_metric_pack_map m ON m.pack_id = p.id
GROUP BY p.id, p.user_id
ORDER BY count(*) DESC
LIMIT 1;

SELECT pg_temp.expect('cenário existe', (SELECT count(*) FROM t_alvo) = 1);

-- O ator é o dono (a RPC exige auth.uid() = p_user_id)
SELECT set_config('request.jwt.claims', json_build_object('sub', (SELECT user_id FROM t_alvo))::text, true);

CREATE FUNCTION pg_temp.call_v140(p_group_by text) RETURNS jsonb
LANGUAGE sql AS $$
  SELECT public.fetch_manager_performance_base_v140(
    a.user_id, a.d0, a.d1, p_group_by, array[a.pack_id], NULL,
    NULL, NULL, NULL, NULL, true, true, 500, 0, 'spend', NULL, false)
  FROM t_alvo a
$$;

CREATE FUNCTION pg_temp.call_v142(p_group_by text) RETURNS jsonb
LANGUAGE sql AS $$
  SELECT public.fetch_manager_performance_base_v142(
    a.user_id, a.d0, a.d1, p_group_by, array[a.pack_id], NULL,
    NULL, NULL, NULL, NULL, true, true, 500, 0, 'spend', NULL, false)
  FROM t_alvo a
$$;

-- ---------------------------------------------------------------------------
-- A. Contrato intacto: sem a chave nova, v142 == v140 em todos os níveis
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE t_base AS SELECT pg_temp.call_v142('ad_name') AS p;

SELECT pg_temp.expect('A0 cenário não é vazio (>= 20 linhas)',
  jsonb_array_length((SELECT p FROM t_base)->'data') >= 20);

SELECT pg_temp.expect('A1 ad_name: v142 sem a chave nova == v140',
  pg_temp.strip_new_key(pg_temp.call_v142('ad_name')) = pg_temp.call_v140('ad_name'));
SELECT pg_temp.expect('A2 ad_id: v142 sem a chave nova == v140',
  pg_temp.strip_new_key(pg_temp.call_v142('ad_id')) = pg_temp.call_v140('ad_id'));
SELECT pg_temp.expect('A3 adset_id: v142 sem a chave nova == v140',
  pg_temp.strip_new_key(pg_temp.call_v142('adset_id')) = pg_temp.call_v140('adset_id'));
SELECT pg_temp.expect('A4 campaign_id: v142 sem a chave nova == v140',
  pg_temp.strip_new_key(pg_temp.call_v142('campaign_id')) = pg_temp.call_v140('campaign_id'));

-- A chave nova existe em TODA linha do nível de criativo (nunca ausente/NULL): o
-- frontend trata ausente como false, e um NULL silencioso esconderia regressão.
SELECT pg_temp.expect('A5 a chave existe em toda linha e é booleana',
  NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements((SELECT p FROM t_base)->'data') d
    WHERE jsonb_typeof(d->'transcription_no_audio') <> 'boolean'));

-- ---------------------------------------------------------------------------
-- Alvo controlado: um ad_name que ESTÁ no payload e não tem registro nenhum de
-- transcrição. Partir do zero deixa cada seção abaixo provar um estado só.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE t_ad AS
SELECT d->>'ad_name' AS ad_name, (SELECT user_id FROM t_alvo) AS user_id
FROM jsonb_array_elements((SELECT p FROM t_base)->'data') d
WHERE NOT EXISTS (
  SELECT 1 FROM public.ad_transcriptions t
  WHERE t.user_id = (SELECT user_id FROM t_alvo) AND t.ad_name = d->>'ad_name')
ORDER BY d->>'ad_name'
LIMIT 1;

SELECT pg_temp.expect('B0 achou ad_name sem registro de transcrição', (SELECT count(*) FROM t_ad) = 1);

-- Uma segunda linha, que NUNCA é tocada: prova de isolamento.
CREATE TEMP TABLE t_vizinho AS
SELECT d->>'ad_name' AS ad_name
FROM jsonb_array_elements((SELECT p FROM t_base)->'data') d
WHERE d->>'ad_name' <> (SELECT ad_name FROM t_ad)
ORDER BY d->>'ad_name'
LIMIT 1;

SELECT pg_temp.expect('B1 achou vizinho', (SELECT count(*) FROM t_vizinho) = 1);

-- ---------------------------------------------------------------------------
-- B. Sem registro nenhum → as duas flags false ("ainda não transcrito")
-- ---------------------------------------------------------------------------
SELECT pg_temp.expect('B2 sem registro: has_transcription = false',
  pg_temp.flag_of((SELECT p FROM t_base), (SELECT ad_name FROM t_ad), 'has_transcription') IS FALSE);
SELECT pg_temp.expect('B3 sem registro: transcription_no_audio = false',
  pg_temp.flag_of((SELECT p FROM t_base), (SELECT ad_name FROM t_ad), 'transcription_no_audio') IS FALSE);

CREATE TEMP TABLE t_vizinho_antes AS
SELECT pg_temp.flag_of((SELECT p FROM t_base), (SELECT ad_name FROM t_vizinho), 'has_transcription') AS has,
       pg_temp.flag_of((SELECT p FROM t_base), (SELECT ad_name FROM t_vizinho), 'transcription_no_audio') AS no_audio;

-- ---------------------------------------------------------------------------
-- C. failed + no_voice_detected → transcription_no_audio = true (o caso novo)
-- ---------------------------------------------------------------------------
INSERT INTO public.ad_transcriptions (user_id, ad_name, status, metadata)
SELECT user_id, ad_name, 'failed',
       '{"provider":"assemblyai","error_message":"language_detection cannot be performed on files with no spoken audio.","no_voice_detected":true}'::jsonb
FROM t_ad;

CREATE TEMP TABLE t_c AS SELECT pg_temp.call_v142('ad_name') AS p;

SELECT pg_temp.expect('C1 sem áudio: transcription_no_audio = true',
  pg_temp.flag_of((SELECT p FROM t_c), (SELECT ad_name FROM t_ad), 'transcription_no_audio') IS TRUE);
SELECT pg_temp.expect('C2 sem áudio: has_transcription continua false',
  pg_temp.flag_of((SELECT p FROM t_c), (SELECT ad_name FROM t_ad), 'has_transcription') IS FALSE);
SELECT pg_temp.expect('C3 isolamento: vizinho não mudou',
  pg_temp.flag_of((SELECT p FROM t_c), (SELECT ad_name FROM t_vizinho), 'transcription_no_audio')
    IS NOT DISTINCT FROM (SELECT no_audio FROM t_vizinho_antes)
  AND pg_temp.flag_of((SELECT p FROM t_c), (SELECT ad_name FROM t_vizinho), 'has_transcription')
    IS NOT DISTINCT FROM (SELECT has FROM t_vizinho_antes));

-- Nenhum número mudou por causa disso: transcrição não entra em métrica.
SELECT pg_temp.expect('C4 métricas intocadas pelo registro de transcrição',
  pg_temp.strip_new_key((SELECT p FROM t_c)) = pg_temp.call_v140('ad_name'));

-- ---------------------------------------------------------------------------
-- D. failed SEM a flag (erro retriável) → ambas false: é "ainda não transcrito"
-- ---------------------------------------------------------------------------
UPDATE public.ad_transcriptions t
SET metadata = '{"provider":"assemblyai","error_message":"ASSEMBLYAI_API_KEY nao configurada"}'::jsonb
FROM t_ad a WHERE t.user_id = a.user_id AND t.ad_name = a.ad_name;

CREATE TEMP TABLE t_d AS SELECT pg_temp.call_v142('ad_name') AS p;

SELECT pg_temp.expect('D1 falha retriável: transcription_no_audio = false',
  pg_temp.flag_of((SELECT p FROM t_d), (SELECT ad_name FROM t_ad), 'transcription_no_audio') IS FALSE);
SELECT pg_temp.expect('D2 falha retriável: has_transcription = false',
  pg_temp.flag_of((SELECT p FROM t_d), (SELECT ad_name FROM t_ad), 'has_transcription') IS FALSE);

-- ---------------------------------------------------------------------------
-- E. completed → has_transcription = true e transcription_no_audio = false
-- ---------------------------------------------------------------------------
UPDATE public.ad_transcriptions t
SET status = 'completed', metadata = '{"provider":"assemblyai"}'::jsonb
FROM t_ad a WHERE t.user_id = a.user_id AND t.ad_name = a.ad_name;

CREATE TEMP TABLE t_e AS SELECT pg_temp.call_v142('ad_name') AS p;

SELECT pg_temp.expect('E1 transcrito: has_transcription = true',
  pg_temp.flag_of((SELECT p FROM t_e), (SELECT ad_name FROM t_ad), 'has_transcription') IS TRUE);
SELECT pg_temp.expect('E2 transcrito: transcription_no_audio = false',
  pg_temp.flag_of((SELECT p FROM t_e), (SELECT ad_name FROM t_ad), 'transcription_no_audio') IS FALSE);

-- ---------------------------------------------------------------------------
-- G. Precedência entre silos (o caso de pack COMPARTILHADO)
-- ---------------------------------------------------------------------------
-- ad_transcriptions tem UNIQUE (user_id, ad_name): dentro de um silo, 'completed' e
-- 'failed sem áudio' JAMAIS coexistem para o mesmo ad_name. Só coexistem quando a
-- seleção junta packs de donos diferentes — e é só aí que a precedência da projeção
-- (`and not has_transcription`) sai da redundância e vira comportamento. Sem esta
-- seção, tirar aquela cláusula não quebraria teste nenhum: foi o que a sabotagem (b)
-- mostrou na primeira rodada.
--
-- A linha injetada no silo do vizinho não precisa ter anúncio correspondente: a
-- lateral casa por (user_id, ad_name), exatamente como faria com um pack real em que
-- o mesmo criativo existe nos dois lados.
CREATE TEMP TABLE t_vizinho_pack AS
SELECT p.id AS pack_id, p.user_id AS owner_id
FROM public.packs p
WHERE p.user_id <> (SELECT user_id FROM t_alvo)
  AND EXISTS (SELECT 1 FROM public.ad_metric_pack_map m WHERE m.pack_id = p.id)
ORDER BY p.id
LIMIT 1;

SELECT pg_temp.expect('G0 achou pack de outro dono', (SELECT count(*) FROM t_vizinho_pack) = 1);

INSERT INTO public.pack_shares (pack_id, owner_id, grantee_id, role)
SELECT v.pack_id, v.owner_id, (SELECT user_id FROM t_alvo), 'viewer' FROM t_vizinho_pack v;

-- O outro silo diz "sem áudio" para o MESMO ad_name que o silo do ator já transcreveu
-- (a seção E deixou o registro do ator em 'completed').
INSERT INTO public.ad_transcriptions (user_id, ad_name, status, metadata)
SELECT v.owner_id, (SELECT ad_name FROM t_ad), 'failed',
       '{"provider":"assemblyai","no_voice_detected":true}'::jsonb
FROM t_vizinho_pack v;

CREATE TEMP TABLE t_g AS
SELECT public.fetch_manager_performance_base_v142(
         a.user_id, a.d0, a.d1, 'ad_name', array[a.pack_id, (SELECT pack_id FROM t_vizinho_pack)], NULL,
         NULL, NULL, NULL, NULL, true, true, 500, 0, 'spend', NULL, false) AS p
FROM t_alvo a;

SELECT pg_temp.expect('G1 dois silos: o ad_name-alvo continua no payload',
  pg_temp.flag_of((SELECT p FROM t_g), (SELECT ad_name FROM t_ad), 'has_transcription') IS NOT NULL);
SELECT pg_temp.expect('G2 transcrito num silo ganha do sem-áudio do outro',
  pg_temp.flag_of((SELECT p FROM t_g), (SELECT ad_name FROM t_ad), 'transcription_no_audio') IS FALSE);
SELECT pg_temp.expect('G3 e o has_transcription segue true',
  pg_temp.flag_of((SELECT p FROM t_g), (SELECT ad_name FROM t_ad), 'has_transcription') IS TRUE);

-- Espelho: sem o 'completed' do ator, o sem-áudio do vizinho é o que vale.
DELETE FROM public.ad_transcriptions t USING t_ad a
WHERE t.user_id = a.user_id AND t.ad_name = a.ad_name;

SELECT pg_temp.expect('G4 sem o transcrito, o sem-áudio do outro silo aparece',
  pg_temp.flag_of(
    (SELECT public.fetch_manager_performance_base_v142(
       a.user_id, a.d0, a.d1, 'ad_name', array[a.pack_id, (SELECT pack_id FROM t_vizinho_pack)], NULL,
       NULL, NULL, NULL, NULL, true, true, 500, 0, 'spend', NULL, false) FROM t_alvo a),
    (SELECT ad_name FROM t_ad), 'transcription_no_audio') IS TRUE);

-- ---------------------------------------------------------------------------
-- F. Níveis de pai: a chave existe e é sempre false
-- ---------------------------------------------------------------------------
SELECT pg_temp.expect('F1 adset_id: transcription_no_audio sempre false',
  NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(pg_temp.call_v142('adset_id')->'data') d
    WHERE (d->>'transcription_no_audio')::boolean IS DISTINCT FROM false));
SELECT pg_temp.expect('F2 campaign_id: transcription_no_audio sempre false',
  NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(pg_temp.call_v142('campaign_id')->'data') d
    WHERE (d->>'transcription_no_audio')::boolean IS DISTINCT FROM false));

-- ---------------------------------------------------------------------------
\pset tuples_only off
SELECT 'OK: ' || n || ' asserções' AS resultado FROM t_counter;

ROLLBACK;
