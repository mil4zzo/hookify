-- Teste da 181: pasta compartilhada como no Drive.
--
-- Prova que (a) a pasta cobre packs de hoje e de amanhã e some quando o pack ou a pasta
-- sai de baixo dela, (b) dentro da pasta tudo segue a pasta — o acesso direto de quem a
-- pasta cobre é absorvido e sai junto com a pessoa, (c) o editor mexe na árvore do dono
-- só pelas RPCs e só onde é editor, (d) pack posto pelo editor é repassado, pack de
-- terceiro não, (e) ninguém forja origem nem marca `contributed` pela tabela.
--
-- Roda COMO `authenticated` onde a RLS ou o auth.uid() importam; o resto como superusuário.
--
-- Sabotagens que TÊM de fazer este teste falhar (injete logo após o BEGIN, ou edite a
-- função na migration e reaplique no lab):
--   1. DROP TRIGGER trg_pfm_sync_ins ON public.pack_folder_members;       -> A2
--   2. DROP TRIGGER trg_pfm_sync_del ON public.pack_folder_members;       -> A3b
--   3. DROP TRIGGER trg_folders_reparent_sync ON public.folders;          -> A7
--   4. folder_grants_desired: `x.depth` -> `x.depth DESC` no ORDER BY      -> A4
--   5. folder_grants_desired: tirar o `OR m.contributed`                  -> A12b
--  5b. folder_grants_desired: trocar `(p.user_id = m.user_id OR m.contributed)` por `true` -> A8
--   6. sync_folder_pack_grants: pôr `AND public.pack_shares.source_folder_id IS NOT NULL`
--      no WHERE do ON CONFLICT (não absorve o direto)                     -> A6
--   7. Policy pack_folder_members_modify_own sem `AND NOT contributed`    -> A9
--   8. move_packs_to_folder: aceitar pack alheio no ramo `ELSIF r.pack_owner = v_uid`
--      (trocar por `ELSIF true`)                                           -> A14
--   9. dissolve_folder: tirar o teste do papel na pasta de cima           -> A11c
--  10. DROP TRIGGER trg_folder_shares_sync ON public.folder_shares;       -> A1
--  11. folder_access_role: `ORDER BY up.depth` -> `up.depth DESC`         -> A10b
--  12. sync_folder_pack_grants: tirar o DELETE do pack que o dono deixou de ver -> A17
--  13. move_packs_to_folder: tirar o bloco `pack_owner_outside`          -> A18
--
-- A24 e A26 são regressão, não sabotáveis: remover os `JOIN auth.users` de folder_grants_desired
-- NÃO o derruba no lab, porque a cascata limpa o que o gatilho recriou antes do fim do
-- comando. Fica como cinto e suspensório para a exclusão de conta.
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

-- Passa se a mensagem obtida CONTÉM o trecho esperado (erros do banco vêm com contexto).
CREATE FUNCTION pg_temp.expect_has(rotulo text, obtido text, trecho text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF obtido IS NULL OR position(trecho IN obtido) = 0 THEN
    RAISE EXCEPTION 'FALHOU %: obtido=% esperado conter=%', rotulo, obtido, trecho;
  END IF;
  RAISE NOTICE 'ok %', rotulo;
END $$;

CREATE FUNCTION pg_temp.as_user(uid uuid, sql text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE r text;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
    PERFORM set_config('role', 'authenticated', true);
    EXECUTE sql INTO r;
    PERFORM set_config('role', 'none', true);
    RETURN coalesce(r, 'ok');
  EXCEPTION WHEN others THEN
    PERFORM set_config('role', 'none', true);
    -- SQLSTATE na frente: o lab responde em português, o código não muda de idioma.
    RETURN SQLSTATE || ' ' || SQLERRM;
  END;
END $$;

-- O que uma pessoa tem em cada pack: "01:editor@0a,02:viewer@0b". Direto = "@-".
CREATE FUNCTION pg_temp.access_of(grantee uuid) RETURNS text
LANGUAGE sql AS $$
  SELECT coalesce(string_agg(
           right(s.pack_id::text, 2) || ':' || s.role || '@' ||
           coalesce(right(s.source_folder_id::text, 2), '-'), ',' ORDER BY s.pack_id), '')
  FROM public.pack_shares s
  WHERE s.grantee_id = grantee AND s.pack_id::text LIKE '18100000-0000-4000-8000-0000000000%'
$$;

-- Quem tem um pack: "a0:editor@0b,a2:viewer@0a".
CREATE FUNCTION pg_temp.grantees_of(pack uuid) RETURNS text
LANGUAGE sql AS $$
  SELECT coalesce(string_agg(
           right(s.grantee_id::text, 2) || ':' || s.role || '@' ||
           coalesce(right(s.source_folder_id::text, 2), '-'), ',' ORDER BY s.grantee_id), '')
  FROM public.pack_shares s WHERE s.pack_id = pack
$$;

-- Onde um pack mora, em todas as árvores: "a0>0b*" (* = contributed).
CREATE FUNCTION pg_temp.placement_of(pack uuid) RETURNS text
LANGUAGE sql AS $$
  SELECT coalesce(string_agg(
           right(m.user_id::text, 2) || '>' || right(m.folder_id::text, 2) || CASE WHEN m.contributed THEN '*' ELSE '' END,
           ',' ORDER BY m.user_id), '')
  FROM public.pack_folder_members m WHERE m.pack_id = pack
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.folders, public.pack_folder_members, public.pack_shares, public.folder_shares TO authenticated;

-- Atores: O (dono), A (editor), B (leitura / direto), G (outro dono), H (conta apagada).
INSERT INTO auth.users (id) VALUES
  ('18100000-0000-4000-8000-0000000000a0'),  -- O
  ('18100000-0000-4000-8000-0000000000a1'),  -- A
  ('18100000-0000-4000-8000-0000000000a2'),  -- B
  ('18100000-0000-4000-8000-0000000000a3')   -- G
ON CONFLICT DO NOTHING;

-- Packs: p01..p05 de O; p06 de A; p09 de G.
INSERT INTO public.packs (id, user_id, name, level, date_start, date_stop) VALUES
  ('18100000-0000-4000-8000-000000000001', '18100000-0000-4000-8000-0000000000a0', 'p01', 'ad', '2026-01-01', '2026-01-02'),
  ('18100000-0000-4000-8000-000000000002', '18100000-0000-4000-8000-0000000000a0', 'p02', 'ad', '2026-01-01', '2026-01-02'),
  ('18100000-0000-4000-8000-000000000003', '18100000-0000-4000-8000-0000000000a0', 'p03', 'ad', '2026-01-01', '2026-01-02'),
  ('18100000-0000-4000-8000-000000000004', '18100000-0000-4000-8000-0000000000a0', 'p04', 'ad', '2026-01-01', '2026-01-02'),
  ('18100000-0000-4000-8000-000000000005', '18100000-0000-4000-8000-0000000000a0', 'p05', 'ad', '2026-01-01', '2026-01-02'),
  ('18100000-0000-4000-8000-000000000006', '18100000-0000-4000-8000-0000000000a1', 'p06', 'ad', '2026-01-01', '2026-01-02'),
  ('18100000-0000-4000-8000-000000000009', '18100000-0000-4000-8000-0000000000a3', 'p09', 'ad', '2026-01-01', '2026-01-02');

-- Pastas de O: R(0a) -> S(0b) | T(0c) na raiz.  G: GR(d0).  A: AF(e0).
INSERT INTO public.folders (id, user_id, name, parent_id, position) VALUES
  ('18100000-0000-4000-8000-00000000000a', '18100000-0000-4000-8000-0000000000a0', 'R', NULL, 0),
  ('18100000-0000-4000-8000-00000000000b', '18100000-0000-4000-8000-0000000000a0', 'S', '18100000-0000-4000-8000-00000000000a', 0),
  ('18100000-0000-4000-8000-00000000000c', '18100000-0000-4000-8000-0000000000a0', 'T', NULL, 1),
  ('18100000-0000-4000-8000-0000000000d0', '18100000-0000-4000-8000-0000000000a3', 'GR', NULL, 0),
  ('18100000-0000-4000-8000-0000000000e0', '18100000-0000-4000-8000-0000000000a1', 'AF', NULL, 0);

INSERT INTO public.pack_folder_members (user_id, pack_id, folder_id) VALUES
  ('18100000-0000-4000-8000-0000000000a0', '18100000-0000-4000-8000-000000000001', '18100000-0000-4000-8000-00000000000a'),
  ('18100000-0000-4000-8000-0000000000a0', '18100000-0000-4000-8000-000000000002', '18100000-0000-4000-8000-00000000000b'),
  ('18100000-0000-4000-8000-0000000000a0', '18100000-0000-4000-8000-000000000003', '18100000-0000-4000-8000-00000000000c');

SELECT pg_temp.expect('A0 nada compartilhado, nada concedido', pg_temp.access_of('18100000-0000-4000-8000-0000000000a1'), '');

-- ── Cobertura ───────────────────────────────────────────────────────────────
INSERT INTO public.folder_shares (folder_id, owner_id, grantee_id, role)
VALUES ('18100000-0000-4000-8000-00000000000a', '18100000-0000-4000-8000-0000000000a0', '18100000-0000-4000-8000-0000000000a1', 'editor');
SELECT pg_temp.expect('A1 pasta compartilhada cobre os packs de hoje, com subpastas',
  pg_temp.access_of('18100000-0000-4000-8000-0000000000a1'), '01:editor@0a,02:editor@0a');

INSERT INTO public.pack_folder_members (user_id, pack_id, folder_id) VALUES
  ('18100000-0000-4000-8000-0000000000a0', '18100000-0000-4000-8000-000000000004', '18100000-0000-4000-8000-00000000000b');
SELECT pg_temp.expect('A2 pack que entra depois ganha o acesso',
  pg_temp.access_of('18100000-0000-4000-8000-0000000000a1'), '01:editor@0a,02:editor@0a,04:editor@0a');

UPDATE public.pack_folder_members SET folder_id = '18100000-0000-4000-8000-00000000000c'
 WHERE pack_id = '18100000-0000-4000-8000-000000000004';
SELECT pg_temp.expect('A3 pack movido para pasta nao compartilhada perde o acesso',
  pg_temp.access_of('18100000-0000-4000-8000-0000000000a1'), '01:editor@0a,02:editor@0a');
DELETE FROM public.pack_folder_members WHERE pack_id = '18100000-0000-4000-8000-000000000002';
SELECT pg_temp.expect('A3b pack solto da pasta perde o acesso',
  pg_temp.access_of('18100000-0000-4000-8000-0000000000a1'), '01:editor@0a');
INSERT INTO public.pack_folder_members (user_id, pack_id, folder_id) VALUES
  ('18100000-0000-4000-8000-0000000000a0', '18100000-0000-4000-8000-000000000002', '18100000-0000-4000-8000-00000000000b');

INSERT INTO public.folder_shares (folder_id, owner_id, grantee_id, role)
VALUES ('18100000-0000-4000-8000-00000000000b', '18100000-0000-4000-8000-0000000000a0', '18100000-0000-4000-8000-0000000000a1', 'viewer');
SELECT pg_temp.expect('A4 subpasta aperta o papel; a pasta de cima segue valendo para o resto',
  pg_temp.access_of('18100000-0000-4000-8000-0000000000a1'), '01:editor@0a,02:viewer@0b');
DELETE FROM public.folder_shares WHERE folder_id = '18100000-0000-4000-8000-00000000000b';
SELECT pg_temp.expect('A5 sem a subpasta, volta o papel da pasta de cima',
  pg_temp.access_of('18100000-0000-4000-8000-0000000000a1'), '01:editor@0a,02:editor@0a');
UPDATE public.folder_shares SET role = 'viewer' WHERE folder_id = '18100000-0000-4000-8000-00000000000a';
SELECT pg_temp.expect('A5b papel trocado na pasta chega nos packs',
  pg_temp.access_of('18100000-0000-4000-8000-0000000000a1'), '01:viewer@0a,02:viewer@0a');
UPDATE public.folder_shares SET role = 'editor' WHERE folder_id = '18100000-0000-4000-8000-00000000000a';

-- ── Dentro da pasta, tudo segue a pasta (absorção) ──────────────────────────
-- B tem direto: editor em p01 (vai para dentro de R) e leitura em p03 (fica fora).
INSERT INTO public.pack_shares (pack_id, owner_id, grantee_id, role) VALUES
  ('18100000-0000-4000-8000-000000000001', '18100000-0000-4000-8000-0000000000a0', '18100000-0000-4000-8000-0000000000a2', 'editor'),
  ('18100000-0000-4000-8000-000000000003', '18100000-0000-4000-8000-0000000000a0', '18100000-0000-4000-8000-0000000000a2', 'viewer');
INSERT INTO public.folder_shares (folder_id, owner_id, grantee_id, role)
VALUES ('18100000-0000-4000-8000-00000000000a', '18100000-0000-4000-8000-0000000000a0', '18100000-0000-4000-8000-0000000000a2', 'viewer');
SELECT pg_temp.expect('A6 direto de quem a pasta cobre vira "via pasta", com o papel DA PASTA; fora dela fica direto',
  pg_temp.access_of('18100000-0000-4000-8000-0000000000a2'), '01:viewer@0a,02:viewer@0a,03:viewer@-');
DELETE FROM public.folder_shares
 WHERE folder_id = '18100000-0000-4000-8000-00000000000a' AND grantee_id = '18100000-0000-4000-8000-0000000000a2';
SELECT pg_temp.expect('A6b tirar da pasta tira de TODOS os packs dela, inclusive o que era direto',
  pg_temp.access_of('18100000-0000-4000-8000-0000000000a2'), '03:viewer@-');

-- ── Pasta que muda de pai ───────────────────────────────────────────────────
UPDATE public.folders SET parent_id = '18100000-0000-4000-8000-00000000000a' WHERE id = '18100000-0000-4000-8000-00000000000c';
SELECT pg_temp.expect('A7 pasta movida para dentro da compartilhada leva os packs junto',
  pg_temp.access_of('18100000-0000-4000-8000-0000000000a1'), '01:editor@0a,02:editor@0a,03:editor@0a,04:editor@0a');
UPDATE public.folders SET parent_id = NULL WHERE id = '18100000-0000-4000-8000-00000000000c';
SELECT pg_temp.expect('A7b pasta que sai leva o acesso embora',
  pg_temp.access_of('18100000-0000-4000-8000-0000000000a1'), '01:editor@0a,02:editor@0a');

-- ── Pack de terceiro organizado na pasta não é repassado ────────────────────
INSERT INTO public.pack_folder_members (user_id, pack_id, folder_id) VALUES
  ('18100000-0000-4000-8000-0000000000a0', '18100000-0000-4000-8000-000000000009', '18100000-0000-4000-8000-00000000000a');
SELECT pg_temp.expect('A8 pack de G organizado na pasta de O nao concede nada',
  pg_temp.grantees_of('18100000-0000-4000-8000-000000000009'), '');
INSERT INTO public.folder_shares (folder_id, owner_id, grantee_id, role)
VALUES ('18100000-0000-4000-8000-0000000000d0', '18100000-0000-4000-8000-0000000000a3', '18100000-0000-4000-8000-0000000000a2', 'editor');
INSERT INTO public.pack_folder_members (user_id, pack_id, folder_id) VALUES
  ('18100000-0000-4000-8000-0000000000a3', '18100000-0000-4000-8000-000000000005', '18100000-0000-4000-8000-0000000000d0');
SELECT pg_temp.expect('A8b G nao repassa pack de O pela pasta de G',
  pg_temp.grantees_of('18100000-0000-4000-8000-000000000005'), '');
DELETE FROM public.pack_folder_members WHERE pack_id = '18100000-0000-4000-8000-000000000009';
DELETE FROM public.folder_shares WHERE folder_id = '18100000-0000-4000-8000-0000000000d0';

-- A9: marcar `contributed` pela tabela é barrado (seria repassar pack alheio)
SELECT pg_temp.expect_has('A9 contributed pela tabela barrado pela RLS',
  pg_temp.as_user('18100000-0000-4000-8000-0000000000a0'::uuid,
    $q$INSERT INTO public.pack_folder_members (user_id, pack_id, folder_id, contributed)
       VALUES ('18100000-0000-4000-8000-0000000000a0', '18100000-0000-4000-8000-000000000009',
               '18100000-0000-4000-8000-00000000000a', true) RETURNING 'x'$q$),
  '42501');

-- ── O que o convidado enxerga ───────────────────────────────────────────────
SELECT pg_temp.expect('A10 A ve a arvore do dono a partir da pasta compartilhada (raiz sem pai)',
  pg_temp.as_user('18100000-0000-4000-8000-0000000000a1'::uuid, $q$
    SELECT string_agg(right(f->>'id', 2) || ':' || coalesce(right(f->>'parent_id', 2), '-') || ':' || (f->>'access'), ',' ORDER BY f->>'id')
    FROM jsonb_array_elements(public.list_shared_folders()->'folders') f$q$),
  '0a:-:editor,0b:0a:editor');
SELECT pg_temp.expect('A10a e onde estao os packs que pode ver',
  pg_temp.as_user('18100000-0000-4000-8000-0000000000a1'::uuid, $q$
    SELECT string_agg(right(m->>'pack_id', 2) || ':' || right(m->>'folder_id', 2), ',' ORDER BY m->>'pack_id')
    FROM jsonb_array_elements(public.list_shared_folders()->'members') m$q$),
  '01:0a,02:0b');
INSERT INTO public.folder_shares (folder_id, owner_id, grantee_id, role)
VALUES ('18100000-0000-4000-8000-00000000000b', '18100000-0000-4000-8000-0000000000a0', '18100000-0000-4000-8000-0000000000a1', 'viewer');
SELECT pg_temp.expect('A10b papel por pasta: a mais proxima vale',
  pg_temp.as_user('18100000-0000-4000-8000-0000000000a1'::uuid, $q$
    SELECT string_agg(right(f->>'id', 2) || ':' || (f->>'access'), ',' ORDER BY f->>'id')
    FROM jsonb_array_elements(public.list_shared_folders()->'folders') f$q$),
  '0a:editor,0b:viewer');
DELETE FROM public.folder_shares
 WHERE folder_id = '18100000-0000-4000-8000-00000000000b' AND grantee_id = '18100000-0000-4000-8000-0000000000a1';
SELECT pg_temp.expect('A10c quem nao tem pasta nenhuma ve lista vazia',
  pg_temp.as_user('18100000-0000-4000-8000-0000000000a2'::uuid, $q$SELECT public.list_shared_folders()::text$q$),
  '{"folders": [], "members": []}');

-- ── O editor mexe na árvore do dono ─────────────────────────────────────────
SELECT pg_temp.expect('A11 editor renomeia a pasta compartilhada',
  pg_temp.as_user('18100000-0000-4000-8000-0000000000a1'::uuid,
    $q$SELECT public.rename_folder('18100000-0000-4000-8000-00000000000a', 'R2')->>'name'$q$), 'R2');
SELECT pg_temp.expect('A11a editor cria subpasta — ela nasce NA ARVORE DO DONO',
  pg_temp.as_user('18100000-0000-4000-8000-0000000000a1'::uuid,
    $q$SELECT public.create_folder('N', '18100000-0000-4000-8000-00000000000a')->>'owner_id'$q$),
  '18100000-0000-4000-8000-0000000000a0');
SELECT pg_temp.expect('A11b editor move a subpasta dentro do que edita',
  pg_temp.as_user('18100000-0000-4000-8000-0000000000a1'::uuid, format(
    $q$SELECT public.place_folder(%L::uuid, %L::uuid, ARRAY[%L::uuid])::text$q$,
    (SELECT id FROM public.folders WHERE name = 'N'), '18100000-0000-4000-8000-00000000000b',
    (SELECT id FROM public.folders WHERE name = 'N'))), '1');
SELECT pg_temp.expect_has('A11c editor NAO desfaz a pasta compartilhada com ele (a raiz do que ve)',
  pg_temp.as_user('18100000-0000-4000-8000-0000000000a1'::uuid,
    $q$SELECT public.dissolve_folder('18100000-0000-4000-8000-00000000000a')::text$q$), 'folder_forbidden');
SELECT pg_temp.expect_has('A11d editor NAO leva subpasta para fora da arvore do dono',
  pg_temp.as_user('18100000-0000-4000-8000-0000000000a1'::uuid,
    $q$SELECT public.place_folder('18100000-0000-4000-8000-00000000000b', NULL, ARRAY['18100000-0000-4000-8000-00000000000b'::uuid])::text$q$),
  'folder_forbidden');
SELECT pg_temp.expect('A11e editor desfaz subpasta',
  pg_temp.as_user('18100000-0000-4000-8000-0000000000a1'::uuid, format(
    $q$SELECT (public.dissolve_folder(%L::uuid))->>'folders_moved'$q$, (SELECT id FROM public.folders WHERE name = 'N'))), '0');
SELECT pg_temp.expect_has('A11f editor nao enxerga pasta fora do que foi compartilhado',
  pg_temp.as_user('18100000-0000-4000-8000-0000000000a1'::uuid,
    $q$SELECT public.rename_folder('18100000-0000-4000-8000-00000000000c', 'x')::text$q$), 'folder_not_found');

-- ── Pack do editor dentro da pasta do dono ──────────────────────────────────
INSERT INTO public.folder_shares (folder_id, owner_id, grantee_id, role)
VALUES ('18100000-0000-4000-8000-00000000000a', '18100000-0000-4000-8000-0000000000a0', '18100000-0000-4000-8000-0000000000a2', 'viewer');
SELECT pg_temp.expect('A12 setup: A arquiva o proprio p06 na pasta dele',
  pg_temp.as_user('18100000-0000-4000-8000-0000000000a1'::uuid,
    $q$SELECT public.move_packs_to_folder(ARRAY['18100000-0000-4000-8000-000000000006'::uuid], '18100000-0000-4000-8000-0000000000e0')::text$q$), '1');
SELECT pg_temp.expect('A12a A poe o p06 dentro de S: sai da pasta dele, entra na do dono marcado',
  (SELECT pg_temp.as_user('18100000-0000-4000-8000-0000000000a1'::uuid,
    $q$SELECT public.move_packs_to_folder(ARRAY['18100000-0000-4000-8000-000000000006'::uuid], '18100000-0000-4000-8000-00000000000b')::text$q$)
   || '|' || pg_temp.placement_of('18100000-0000-4000-8000-000000000006')), '1|a0>0b*');
SELECT pg_temp.expect('A12b o dono da arvore vira editor do p06; quem tem a pasta recebe o papel dela',
  pg_temp.grantees_of('18100000-0000-4000-8000-000000000006'), 'a0:editor@0b,a2:viewer@0a');
SELECT pg_temp.expect('A12c B (leitura) ve o p06 na pasta',
  pg_temp.as_user('18100000-0000-4000-8000-0000000000a2'::uuid, $q$
    SELECT string_agg(right(m->>'pack_id', 2) || ':' || right(m->>'folder_id', 2), ',' ORDER BY m->>'pack_id')
    FROM jsonb_array_elements(public.list_shared_folders()->'members') m$q$),
  '01:0a,02:0b,06:0b');
SELECT pg_temp.expect('A13 A leva o p06 de volta para a pasta dele: a pasta deixa de repassa-lo',
  (SELECT pg_temp.as_user('18100000-0000-4000-8000-0000000000a1'::uuid,
    $q$SELECT public.move_packs_to_folder(ARRAY['18100000-0000-4000-8000-000000000006'::uuid], '18100000-0000-4000-8000-0000000000e0')::text$q$)
   || '|' || pg_temp.placement_of('18100000-0000-4000-8000-000000000006') || '|' || pg_temp.grantees_of('18100000-0000-4000-8000-000000000006')),
  '1|a1>e0|');
SELECT pg_temp.as_user('18100000-0000-4000-8000-0000000000a1'::uuid,
  $q$SELECT public.move_packs_to_folder(ARRAY['18100000-0000-4000-8000-000000000006'::uuid], '18100000-0000-4000-8000-00000000000b')::text$q$);

-- ── Recusas ─────────────────────────────────────────────────────────────────
INSERT INTO public.pack_shares (pack_id, owner_id, grantee_id, role)
VALUES ('18100000-0000-4000-8000-000000000009', '18100000-0000-4000-8000-0000000000a3', '18100000-0000-4000-8000-0000000000a1', 'editor');
SELECT pg_temp.expect_has('A14 editor nao repassa pack de terceiro pondo-o na pasta',
  pg_temp.as_user('18100000-0000-4000-8000-0000000000a1'::uuid,
    $q$SELECT public.move_packs_to_folder(ARRAY['18100000-0000-4000-8000-000000000009'::uuid], '18100000-0000-4000-8000-00000000000a')::text$q$),
  'pack_move_forbidden');
SELECT pg_temp.expect_has('A14b editor nao leva pack do dono para a pasta pessoal dele',
  pg_temp.as_user('18100000-0000-4000-8000-0000000000a1'::uuid,
    $q$SELECT public.move_packs_to_folder(ARRAY['18100000-0000-4000-8000-000000000001'::uuid], '18100000-0000-4000-8000-0000000000e0')::text$q$),
  'pack_move_forbidden');
SELECT pg_temp.expect_has('A14c um recusado recusa o lote (p01 nao se mexeu)',
  pg_temp.as_user('18100000-0000-4000-8000-0000000000a1'::uuid,
    $q$SELECT public.move_packs_to_folder(ARRAY['18100000-0000-4000-8000-000000000001'::uuid, '18100000-0000-4000-8000-000000000003'::uuid], '18100000-0000-4000-8000-00000000000b')::text$q$)
  || pg_temp.placement_of('18100000-0000-4000-8000-000000000001'), 'pack_move_forbidden');
SELECT pg_temp.expect('A14d (p01 continua em R)', pg_temp.placement_of('18100000-0000-4000-8000-000000000001'), 'a0>0a');
SELECT pg_temp.expect('A15 editor tira pack do dono da pasta: o pack volta solto para o dono e A perde o acesso',
  (SELECT pg_temp.as_user('18100000-0000-4000-8000-0000000000a1'::uuid,
    $q$SELECT public.move_packs_to_folder(ARRAY['18100000-0000-4000-8000-000000000002'::uuid], NULL)::text$q$)
   || '|' || pg_temp.placement_of('18100000-0000-4000-8000-000000000002') || '|' || pg_temp.grantees_of('18100000-0000-4000-8000-000000000002')),
  '1||');
INSERT INTO public.pack_folder_members (user_id, pack_id, folder_id) VALUES
  ('18100000-0000-4000-8000-0000000000a0', '18100000-0000-4000-8000-000000000002', '18100000-0000-4000-8000-00000000000b');
SELECT pg_temp.expect_has('A16 leitura nao renomeia',
  pg_temp.as_user('18100000-0000-4000-8000-0000000000a2'::uuid,
    $q$SELECT public.rename_folder('18100000-0000-4000-8000-00000000000a', 'x')::text$q$), 'folder_forbidden');
SELECT pg_temp.expect_has('A16b leitura nao move para dentro',
  pg_temp.as_user('18100000-0000-4000-8000-0000000000a2'::uuid,
    $q$SELECT public.move_packs_to_folder(ARRAY['18100000-0000-4000-8000-000000000001'::uuid], '18100000-0000-4000-8000-00000000000b')::text$q$),
  'folder_forbidden');
SELECT pg_temp.expect_has('A16c leitura nao tira da pasta',
  pg_temp.as_user('18100000-0000-4000-8000-0000000000a2'::uuid,
    $q$SELECT public.move_packs_to_folder(ARRAY['18100000-0000-4000-8000-000000000001'::uuid], NULL)::text$q$),
  'pack_move_forbidden');
SELECT pg_temp.expect_has('A16d leitura nao cria subpasta',
  pg_temp.as_user('18100000-0000-4000-8000-0000000000a2'::uuid,
    $q$SELECT public.create_folder('y', '18100000-0000-4000-8000-00000000000a')::text$q$), 'folder_forbidden');

-- ── Saída do editor ─────────────────────────────────────────────────────────
DELETE FROM public.folder_shares
 WHERE folder_id = '18100000-0000-4000-8000-00000000000a' AND grantee_id = '18100000-0000-4000-8000-0000000000a1';
SELECT pg_temp.expect('A17 A saiu: perde a pasta, e o p06 que ele pos la SAI JUNTO (volta solto para ele)',
  pg_temp.access_of('18100000-0000-4000-8000-0000000000a1') || '|' || pg_temp.placement_of('18100000-0000-4000-8000-000000000006')
  || '|' || pg_temp.grantees_of('18100000-0000-4000-8000-000000000006'),
  '09:editor@-||');

-- A18: o pack do editor so circula por onde ele ve
INSERT INTO public.folder_shares (folder_id, owner_id, grantee_id, role)
VALUES ('18100000-0000-4000-8000-00000000000a', '18100000-0000-4000-8000-0000000000a0', '18100000-0000-4000-8000-0000000000a1', 'editor');
SELECT pg_temp.as_user('18100000-0000-4000-8000-0000000000a1'::uuid,
  $q$SELECT public.move_packs_to_folder(ARRAY['18100000-0000-4000-8000-000000000006'::uuid], '18100000-0000-4000-8000-00000000000b')::text$q$);
SELECT pg_temp.expect_has('A18 dono da arvore nao leva o p06 para pasta que A nao ve (T)',
  pg_temp.as_user('18100000-0000-4000-8000-0000000000a0'::uuid,
    $q$SELECT public.move_packs_to_folder(ARRAY['18100000-0000-4000-8000-000000000006'::uuid], '18100000-0000-4000-8000-00000000000c')::text$q$)
  || pg_temp.placement_of('18100000-0000-4000-8000-000000000006'), 'pack_owner_outside');
SELECT pg_temp.expect('A18a (p06 continua em S)', pg_temp.placement_of('18100000-0000-4000-8000-000000000006'), 'a0>0b*');
SELECT pg_temp.expect('A18b dono leva a SUBPASTA para fora da compartilhada: o p06 volta para A',
  pg_temp.as_user('18100000-0000-4000-8000-0000000000a0'::uuid,
    $q$SELECT public.place_folder('18100000-0000-4000-8000-00000000000b', NULL, ARRAY['18100000-0000-4000-8000-00000000000b'::uuid])::text$q$)
  || '|' || pg_temp.placement_of('18100000-0000-4000-8000-000000000006') || '|' || pg_temp.grantees_of('18100000-0000-4000-8000-000000000006'), '0||');
UPDATE public.folders SET parent_id = '18100000-0000-4000-8000-00000000000a' WHERE id = '18100000-0000-4000-8000-00000000000b';
SELECT pg_temp.as_user('18100000-0000-4000-8000-0000000000a1'::uuid,
  $q$SELECT public.move_packs_to_folder(ARRAY['18100000-0000-4000-8000-000000000006'::uuid], '18100000-0000-4000-8000-00000000000b')::text$q$);
SELECT pg_temp.expect('A18c A sai da pasta por conta propria: o p06 sai junto',
  pg_temp.as_user('18100000-0000-4000-8000-0000000000a1'::uuid,
    $q$WITH d AS (DELETE FROM public.folder_shares WHERE folder_id = '18100000-0000-4000-8000-00000000000a' RETURNING 1) SELECT count(*)::text FROM d$q$)
  || '|' || pg_temp.placement_of('18100000-0000-4000-8000-000000000006'), '1|');

-- ── Convidado sai sozinho: da pasta sim, de um pack dela não ─────────────────
SELECT pg_temp.expect('A19 B nao sai de UM pack que vem pela pasta',
  pg_temp.as_user('18100000-0000-4000-8000-0000000000a2'::uuid,
    $q$WITH d AS (DELETE FROM public.pack_shares WHERE pack_id = '18100000-0000-4000-8000-000000000001'
                  AND grantee_id = '18100000-0000-4000-8000-0000000000a2' RETURNING 1)
       SELECT count(*)::text FROM d$q$), '0');
SELECT pg_temp.expect('A19a B le so a propria linha de folder_shares',
  pg_temp.as_user('18100000-0000-4000-8000-0000000000a2'::uuid, $q$SELECT count(*)::text FROM public.folder_shares$q$), '1');
SELECT pg_temp.expect('A19b B sai da pasta inteira',
  pg_temp.as_user('18100000-0000-4000-8000-0000000000a2'::uuid,
    $q$WITH d AS (DELETE FROM public.folder_shares WHERE folder_id = '18100000-0000-4000-8000-00000000000a' RETURNING 1)
       SELECT count(*)::text FROM d$q$)
  || '|' || pg_temp.access_of('18100000-0000-4000-8000-0000000000a2'), '1|03:viewer@-');
SELECT pg_temp.expect('A19c B nao apaga a linha de outro convidado',
  pg_temp.as_user('18100000-0000-4000-8000-0000000000a2'::uuid,
    $q$WITH d AS (DELETE FROM public.folder_shares WHERE grantee_id <> '18100000-0000-4000-8000-0000000000a2' RETURNING 1)
       SELECT count(*)::text FROM d$q$), '0');

-- ── Forjar ──────────────────────────────────────────────────────────────────
DO $$
DECLARE msg text := 'aceito';
BEGIN
  BEGIN
    INSERT INTO public.folder_shares (folder_id, owner_id, grantee_id, role)
    VALUES ('18100000-0000-4000-8000-0000000000d0', '18100000-0000-4000-8000-0000000000a0',
            '18100000-0000-4000-8000-0000000000a1', 'editor');
  EXCEPTION WHEN foreign_key_violation THEN msg := 'fk';
  END;
  PERFORM pg_temp.expect('A20 folder_shares com dono forjado recusado', msg, 'fk');
END $$;
SELECT pg_temp.expect_has('A20b compartilhar pasta alheia pela tabela barrado pela RLS',
  pg_temp.as_user('18100000-0000-4000-8000-0000000000a1'::uuid,
    $q$INSERT INTO public.folder_shares (folder_id, owner_id, grantee_id, role)
       VALUES ('18100000-0000-4000-8000-00000000000a', '18100000-0000-4000-8000-0000000000a0',
               '18100000-0000-4000-8000-0000000000a2', 'editor') RETURNING 'x'$q$),
  '42501');

-- ── Quem pode chamar ────────────────────────────────────────────────────────
SELECT pg_temp.expect('A21 RPCs: authenticated sim, anon nao; funcoes internas: ninguem',
  concat_ws(',',
    has_function_privilege('authenticated', 'public.move_packs_to_folder(uuid[], uuid)', 'EXECUTE'),
    has_function_privilege('anon', 'public.move_packs_to_folder(uuid[], uuid)', 'EXECUTE'),
    has_function_privilege('anon', 'public.list_shared_folders()', 'EXECUTE'),
    has_function_privilege('anon', 'public.dissolve_folder(uuid)', 'EXECUTE'),
    has_function_privilege('authenticated', 'public.folder_access_role(uuid, uuid)', 'EXECUTE'),
    has_function_privilege('authenticated', 'public.sync_folder_pack_grants(uuid[])', 'EXECUTE')),
  't,f,f,f,f,f');
DO $$
DECLARE msg text := 'aceito';
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);
  BEGIN
    PERFORM public.move_packs_to_folder(ARRAY[]::uuid[], NULL);
  EXCEPTION WHEN others THEN msg := SQLERRM;
  END;
  PERFORM pg_temp.expect('A21b RPC sem login recusa', msg, 'not_authenticated');
END $$;

-- ── Ciclo de vida ───────────────────────────────────────────────────────────
INSERT INTO public.folder_shares (folder_id, owner_id, grantee_id, role)
VALUES ('18100000-0000-4000-8000-00000000000a', '18100000-0000-4000-8000-0000000000a0', '18100000-0000-4000-8000-0000000000a1', 'editor');
DELETE FROM public.packs WHERE id = '18100000-0000-4000-8000-000000000002';
SELECT pg_temp.expect('A22 pack apagado some do acesso',
  pg_temp.access_of('18100000-0000-4000-8000-0000000000a1'), '01:editor@0a,09:editor@-');

INSERT INTO public.pack_folder_members (user_id, pack_id, folder_id) VALUES
  ('18100000-0000-4000-8000-0000000000a3', '18100000-0000-4000-8000-000000000009', '18100000-0000-4000-8000-0000000000d0')
ON CONFLICT (user_id, pack_id) DO UPDATE SET folder_id = EXCLUDED.folder_id;
SELECT pg_temp.expect('A23 upsert de membro (ON CONFLICT) nao quebra',
  pg_temp.placement_of('18100000-0000-4000-8000-000000000009'), 'a3>d0');

INSERT INTO auth.users (id) VALUES ('18100000-0000-4000-8000-0000000000a4') ON CONFLICT DO NOTHING;  -- H
INSERT INTO public.pack_shares (pack_id, owner_id, grantee_id, role)
VALUES ('18100000-0000-4000-8000-000000000003', '18100000-0000-4000-8000-0000000000a0', '18100000-0000-4000-8000-0000000000a4', 'viewer');
INSERT INTO public.folder_shares (folder_id, owner_id, grantee_id, role)
VALUES ('18100000-0000-4000-8000-00000000000c', '18100000-0000-4000-8000-0000000000a0', '18100000-0000-4000-8000-0000000000a4', 'editor');
SELECT pg_temp.expect('A24 setup: H coberto por T (o direto em p03 foi absorvido)',
  pg_temp.access_of('18100000-0000-4000-8000-0000000000a4'), '03:editor@0c,04:editor@0c');
DELETE FROM auth.users WHERE id = '18100000-0000-4000-8000-0000000000a4';
SELECT pg_temp.expect('A24 conta do convidado apagada sem erro',
  (SELECT count(*)::text FROM public.pack_shares WHERE grantee_id = '18100000-0000-4000-8000-0000000000a4'), '0');

SELECT pg_temp.expect('A25 dono desfaz a pasta compartilhada: o acesso por ela termina',
  pg_temp.as_user('18100000-0000-4000-8000-0000000000a0'::uuid,
    $q$SELECT (public.dissolve_folder('18100000-0000-4000-8000-00000000000a'))->>'packs_moved'$q$)
  || '|' || pg_temp.access_of('18100000-0000-4000-8000-0000000000a1'), '1|09:editor@-');

-- A26: apagar a CONTA do dono da arvore, com pack de editor dentro dela, nao pode falhar
INSERT INTO public.folder_shares (folder_id, owner_id, grantee_id, role)
VALUES ('18100000-0000-4000-8000-00000000000b', '18100000-0000-4000-8000-0000000000a0', '18100000-0000-4000-8000-0000000000a1', 'editor');
SELECT pg_temp.as_user('18100000-0000-4000-8000-0000000000a1'::uuid,
  $q$SELECT public.move_packs_to_folder(ARRAY['18100000-0000-4000-8000-000000000006'::uuid], '18100000-0000-4000-8000-00000000000b')::text$q$);
SELECT pg_temp.expect('A26 setup: p06 de A dentro de S de O', pg_temp.placement_of('18100000-0000-4000-8000-000000000006'), 'a0>0b*');
DELETE FROM auth.users WHERE id = '18100000-0000-4000-8000-0000000000a0';
SELECT pg_temp.expect('A26 conta do dono da arvore apagada sem erro; o p06 segue de A, solto',
  (SELECT count(*)::text FROM public.packs WHERE id = '18100000-0000-4000-8000-000000000006') || '|' || pg_temp.placement_of('18100000-0000-4000-8000-000000000006')
  || '|' || pg_temp.grantees_of('18100000-0000-4000-8000-000000000006'), '1||');

DO $$ BEGIN RAISE NOTICE 'OK: 181 pastas compartilhadas'; END $$;
ROLLBACK;
