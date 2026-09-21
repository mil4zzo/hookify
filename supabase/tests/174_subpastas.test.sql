-- Teste da 174: subpastas — ciclo, pai alheio, mover (place_folder) e desfazer
-- (dissolve_folder) subindo o conteúdo um nível.
--
-- Roda as chamadas COMO `authenticated` (com a RLS valendo), exceto A2b, que roda
-- como superusuário de propósito: é o único jeito de provar a checagem de user_id
-- do trigger, que a RLS esconderia.
--
-- Sabotagens que TÊM de fazer este teste falhar:
--   1. Sem o trigger (DROP TRIGGER trg_folders_check_parent)    -> falha em A1 (ciclo aceito)
--   2. Trigger sem `p.user_id = NEW.user_id`                    -> falha em A2b (pai alheio aceito)
--   3. dissolve sem o UPDATE das subpastas (FK SET NULL assume)  -> falha em A3 (C1/C2 na raiz mas fora de ordem: posições velhas 0,1 empatam com X)
--   4. dissolve apagando membros em vez de subir (sempre DELETE) -> falha em A4 (pack some da pasta de cima)
--   5. place_folder sem o filtro de grupo                        -> falha em A6 (pasta de outro nível renumerada)
--   6. FK de volta em CASCADE                                    -> falha em A7 (subpasta apagada junto)
\set ON_ERROR_STOP on
\timing off
BEGIN;

CREATE FUNCTION pg_temp.expect(rotulo text, obtido text, esperado text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF obtido IS DISTINCT FROM esperado THEN
    RAISE EXCEPTION 'FALHOU %: obtido=% esperado=%', rotulo, obtido, esperado;
  END IF;
  RAISE NOTICE 'ok %', rotulo;
END $$;

-- Executa `sql` como authenticated (RLS ligada) e devolve o resultado ou a mensagem de erro.
CREATE FUNCTION pg_temp.as_user(sql text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE r text;
BEGIN
  BEGIN
    PERFORM set_config('role', 'authenticated', true);
    EXECUTE sql INTO r;
    PERFORM set_config('role', 'none', true);
    RETURN coalesce(r, 'ok');
  EXCEPTION WHEN others THEN
    RETURN SQLERRM;
  END;
END $$;

CREATE FUNCTION pg_temp.order_of(p_parent uuid) RETURNS text
LANGUAGE sql AS $$
  SELECT string_agg(name, ',' ORDER BY position, name) FROM public.folders
  WHERE user_id = '00000000-0000-4000-8000-000000000174' AND parent_id IS NOT DISTINCT FROM p_parent
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.folders, public.pack_folder_members TO authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000174","role":"authenticated"}', true);

-- Árvore do usuário u:
--   X(0)  M(1)[C1(0), C2(1)]  Y(2)
--   X tem N[D]; N tem o pack p2; M tem o pack p1
INSERT INTO public.folders (id, user_id, name, parent_id, position) VALUES
  ('17400000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-000000000174', 'X',  NULL, 0),
  ('17400000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-000000000174', 'M',  NULL, 1),
  ('17400000-0000-4000-8000-00000000000c', '00000000-0000-4000-8000-000000000174', 'Y',  NULL, 2),
  ('17400000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-000000000174', 'C1', '17400000-0000-4000-8000-00000000000b', 0),
  ('17400000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-000000000174', 'C2', '17400000-0000-4000-8000-00000000000b', 1),
  ('17400000-0000-4000-8000-0000000000d0', '00000000-0000-4000-8000-000000000174', 'N',  '17400000-0000-4000-8000-00000000000a', 0),
  ('17400000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-000000000174', 'D',  '17400000-0000-4000-8000-0000000000d0', 0),
  -- pasta de OUTRO usuário
  ('17400000-0000-4000-8000-0000000000ff', '00000000-0000-4000-8000-00000000017f', 'ALHEIA', NULL, 0);

INSERT INTO public.pack_folder_members (user_id, pack_id, folder_id)
SELECT '00000000-0000-4000-8000-000000000174', id, '17400000-0000-4000-8000-00000000000b' FROM public.packs ORDER BY id LIMIT 1;
INSERT INTO public.pack_folder_members (user_id, pack_id, folder_id)
SELECT '00000000-0000-4000-8000-000000000174', id, '17400000-0000-4000-8000-0000000000d0' FROM public.packs ORDER BY id OFFSET 1 LIMIT 1;

-- A1: X para dentro de D (neta de X) = ciclo
SELECT pg_temp.expect('A1 ciclo barrado',
  pg_temp.as_user($q$UPDATE public.folders SET parent_id = '17400000-0000-4000-8000-0000000000d1' WHERE id = '17400000-0000-4000-8000-00000000000a' RETURNING 'aceito'$q$),
  'folder_cycle');

-- A2: como usuário, pai alheio é invisível -> não encontrado
SELECT pg_temp.expect('A2 pai alheio (RLS)',
  pg_temp.as_user($q$UPDATE public.folders SET parent_id = '17400000-0000-4000-8000-0000000000ff' WHERE id = '17400000-0000-4000-8000-00000000000c' RETURNING 'aceito'$q$),
  'folder_parent_not_found');

-- A2b: mesmo sem RLS (superusuário), o trigger confere o dono do pai
DO $$
DECLARE msg text := 'aceito';
BEGIN
  BEGIN
    UPDATE public.folders SET parent_id = '17400000-0000-4000-8000-0000000000ff' WHERE id = '17400000-0000-4000-8000-00000000000c';
  EXCEPTION WHEN others THEN msg := SQLERRM;
  END;
  PERFORM pg_temp.expect('A2b pai alheio (sem RLS)', msg, 'folder_parent_not_found');
END $$;

-- A3: desfazer M (na raiz): C1, C2 entram no lugar de M; o pack p1 fica solto
SELECT pg_temp.expect('A3 retorno do dissolve M',
  pg_temp.as_user($q$SELECT public.dissolve_folder('17400000-0000-4000-8000-00000000000b')::text$q$),
  '{"parent_id": null, "packs_moved": 1, "folders_moved": 2}');
SELECT pg_temp.expect('A3 ordem da raiz', pg_temp.order_of(NULL), 'X,C1,C2,Y');
SELECT pg_temp.expect('A3 p1 solto',
  (SELECT count(*)::text FROM public.pack_folder_members WHERE user_id = '00000000-0000-4000-8000-000000000174' AND folder_id = '17400000-0000-4000-8000-00000000000b'), '0');

-- A4: desfazer N (dentro de X): D sobe para X, o pack p2 vai para X
SELECT pg_temp.expect('A4 retorno do dissolve N',
  pg_temp.as_user($q$SELECT public.dissolve_folder('17400000-0000-4000-8000-0000000000d0')::text$q$),
  '{"parent_id": "17400000-0000-4000-8000-00000000000a", "packs_moved": 1, "folders_moved": 1}');
SELECT pg_temp.expect('A4 D dentro de X', pg_temp.order_of('17400000-0000-4000-8000-00000000000a'), 'D');
SELECT pg_temp.expect('A4 p2 em X',
  (SELECT count(*)::text FROM public.pack_folder_members WHERE user_id = '00000000-0000-4000-8000-000000000174' AND folder_id = '17400000-0000-4000-8000-00000000000a'), '1');

-- A5: mover Y para dentro de X, antes de D
SELECT pg_temp.expect('A5 place Y em X',
  pg_temp.as_user($q$SELECT public.place_folder('17400000-0000-4000-8000-00000000000c', '17400000-0000-4000-8000-00000000000a',
    ARRAY['17400000-0000-4000-8000-00000000000c','17400000-0000-4000-8000-0000000000d1']::uuid[])::text$q$),
  '2');
SELECT pg_temp.expect('A5 ordem em X', pg_temp.order_of('17400000-0000-4000-8000-00000000000a'), 'Y,D');
SELECT pg_temp.expect('A5 raiz sem Y', pg_temp.order_of(NULL), 'X,C1,C2');

-- A6: C1 (raiz) na lista de X é de outro nível: não pode ser renumerada. Ela vai
-- no índice 0 de propósito — a posição atual dela é 1, então só um place SEM o
-- filtro de grupo a mudaria. (Com C1 no índice 1 a sabotagem passava calada.)
-- Esperado 1: só Y muda (0 -> 2); D já está em 1.
SELECT pg_temp.expect('A6 place com intruso',
  pg_temp.as_user($q$SELECT public.place_folder('17400000-0000-4000-8000-0000000000d1', '17400000-0000-4000-8000-00000000000a',
    ARRAY['17400000-0000-4000-8000-0000000000c1','17400000-0000-4000-8000-0000000000d1','17400000-0000-4000-8000-00000000000c']::uuid[])::text$q$),
  '1');
SELECT pg_temp.expect('A6 C1 intacta', (SELECT position::text || coalesce(parent_id::text, 'raiz') FROM public.folders WHERE id = '17400000-0000-4000-8000-0000000000c1'), '1raiz');

-- A6b: pasta movida precisa estar na lista
SELECT pg_temp.expect('A6b lista sem a pasta',
  pg_temp.as_user($q$SELECT public.place_folder('17400000-0000-4000-8000-0000000000d1', NULL, ARRAY['17400000-0000-4000-8000-00000000000a']::uuid[])::text$q$),
  'folder_not_in_siblings');

-- A7: DELETE direto do pai não leva a subpasta junto (FK SET NULL)
DELETE FROM public.folders WHERE id = '17400000-0000-4000-8000-00000000000a';
SELECT pg_temp.expect('A7 D sobreviveu na raiz',
  (SELECT coalesce(parent_id::text, 'raiz') FROM public.folders WHERE id = '17400000-0000-4000-8000-0000000000d1'), 'raiz');

-- A8: anon não executa
SELECT pg_temp.expect('A8 anon sem EXECUTE',
  has_function_privilege('anon', 'public.dissolve_folder(uuid)', 'EXECUTE')::text || has_function_privilege('anon', 'public.place_folder(uuid,uuid,uuid[])', 'EXECUTE')::text,
  'falsefalse');

ROLLBACK;
