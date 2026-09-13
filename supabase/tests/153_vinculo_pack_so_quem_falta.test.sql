-- Teste da 153: vincular anúncio ao pack só regrava quem ainda não está no pack,
-- e o resultado final de `pack_ids` continua idêntico ao de antes.
--
-- ORDEM DE PROPÓSITO: o resultado de cada chamada é guardado primeiro, e as
-- asserções vêm na ordem em que cada uma é a PRIMEIRA a ver a sua sabotagem —
-- senão uma asserção anterior pegaria a sabotagem e a seguinte ficaria sem prova.
--
-- Sabotagens que TÊM de fazer este teste falhar:
--   0. Função ANTIGA (sem o filtro)                             -> falha em A1 (conta 5: regrava quem já tinha)
--   1. Filtro sem COALESCE: `NOT (p_pack_id = ANY(pack_ids))`   -> falha em A1 (pack_ids NULL nunca ganha o pack)
--   1b. COALESCE só no array: `NOT (p = ANY(COALESCE(pack_ids,'{}')))` -> falha em A1 (elemento NULL nunca ganha o pack)
--   2. Sem `user_id = p_user_id`                                -> falha em A4 (vaza para o silo vizinho)
--   A2 é GUARDA do caso do refresh, não asserção provada: todo defeito plausível que regrava
--   na segunda chamada já regrava na primeira e cai em A1 antes.
--   Não é sabotagem: tirar o COALESCE do array_append — array_append(NULL, x) = {x}.
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

\set u      '''00000000-0000-4000-8000-000000000153'''
\set u_viz  '''00000000-0000-4000-8000-00000000153a'''
\set p1     '''11111111-1111-4111-8111-000000000153'''
\set p2     '''22222222-2222-4222-8222-000000000153'''

-- a-nulo : pack_ids NULL          (o caso que exige COALESCE no filtro)
-- a-elem : pack_ids {NULL}        (elemento NULL: exige COALESCE no RESULTADO do ANY)
-- a-vazio: pack_ids '{}'
-- a-outro: já está em OUTRO pack  (o pack novo é acrescentado, o antigo fica)
-- a-ja   : já está no p1          (não pode ser regravado)
-- vizinho: mesmo ad_id em outro silo, sem pack (não pode ser tocado)
INSERT INTO public.ads (ad_id, user_id, pack_ids) VALUES
  ('t153-a-nulo',  :u::uuid, NULL),
  ('t153-a-elem',  :u::uuid, ARRAY[NULL]::uuid[]),
  ('t153-a-vazio', :u::uuid, '{}'),
  ('t153-a-outro', :u::uuid, ARRAY[:p2::uuid]),
  ('t153-a-ja',    :u::uuid, ARRAY[:p1::uuid]),
  ('t153-a-nulo',  :u_viz::uuid, NULL);

CREATE TEMP TABLE antes AS
  SELECT ad_id, user_id, ctid::text AS pos FROM public.ads WHERE ad_id LIKE 't153-%';

-- Primeira vinculação (criação do pack).
CREATE TEMP TABLE r1 AS
  SELECT (public.batch_add_pack_id_to_arrays(:u::uuid, :p1::uuid, 'ads',
            ARRAY['t153-a-nulo','t153-a-elem','t153-a-vazio','t153-a-outro','t153-a-ja']))->>'rows_updated' AS n;

-- A4: o mesmo ad_id no silo vizinho não foi tocado.
SELECT pg_temp.expect(
  'A4.vizinho-intocado',
  (SELECT coalesce(pack_ids::text, 'NULL') FROM public.ads WHERE ad_id = 't153-a-nulo' AND user_id = :u_viz::uuid),
  'NULL');

-- A1: só os quatro que não tinham p1 foram vinculados, e o pack_ids final é o de sempre.
SELECT pg_temp.expect('A1.vinculou-so-os-quatro-que-faltavam', (SELECT n FROM r1), '4');
SELECT pg_temp.expect(
  'A1.pack_ids-final',
  (SELECT string_agg(ad_id || '=' || pack_ids::text, ' ' ORDER BY ad_id)
   FROM public.ads WHERE user_id = :u::uuid AND ad_id LIKE 't153-%'),
  't153-a-elem={NULL,' || :p1 || '} t153-a-ja={' || :p1 || '} t153-a-nulo={' || :p1 || '} t153-a-outro={' || :p2 || ',' || :p1 || '} t153-a-vazio={' || :p1 || '}');

-- A3: quem já tinha o pack não foi regravado nem na primeira chamada (ctid igual).
SELECT pg_temp.expect(
  'A3.ja-vinculado-nao-regravado',
  (SELECT (a.pos = b.ctid::text)::text FROM public.ads b JOIN antes a USING (ad_id, user_id)
   WHERE b.ad_id = 't153-a-ja' AND b.user_id = :u::uuid),
  'true');

CREATE TEMP TABLE depois_1 AS
  SELECT ad_id, user_id, ctid::text AS pos FROM public.ads WHERE ad_id LIKE 't153-%';

-- Segunda vinculação do mesmo pack — é o que TODO refresh faz.
CREATE TEMP TABLE r2 AS
  SELECT (public.batch_add_pack_id_to_arrays(:u::uuid, :p1::uuid, 'ads',
            ARRAY['t153-a-nulo','t153-a-elem','t153-a-vazio','t153-a-outro','t153-a-ja']))->>'rows_updated' AS n;

-- A2: nada é regravado.
SELECT pg_temp.expect('A2.segunda-vinculacao-nao-regrava-nada', (SELECT n FROM r2), '0');
SELECT pg_temp.expect(
  'A2.nenhuma-linha-mudou-de-lugar',
  (SELECT count(*)::text FROM public.ads b JOIN depois_1 d USING (ad_id, user_id)
   WHERE b.ctid::text <> d.pos),
  '0');

SELECT '153 OK — 6 asserções (5 anúncios, incluindo elemento NULL)' AS resultado;
ROLLBACK;
