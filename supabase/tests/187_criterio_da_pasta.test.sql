-- Teste das 185/186/187: critério de julgamento guardado na pasta, com dono único por galho,
-- e "quem manda num pack é a pasta onde o DONO o colocou".
--
-- Cenário: Ana tem PAI > FILHA > NETA e SOLTA (raiz). O pack P é da Ana e mora em FILHA.
-- P é compartilhado com Bruno, que o arquiva na pasta dele (BX). Q é do Bruno. Carla não
-- tem acesso a nada.
--
-- Sabotagens que TÊM de fazer este teste falhar (todas feitas em 2026-11-09):
--   1. set_folder_judgment sem limpar as subpastas            -> falha em A1
--   2. set_folder_judgment sem checar ancestral (strict)      -> falha em A2
--   3. pack_judgment_governors sem `m.user_id = p.user_id OR m.contributed`
--                                                             -> falha em A4 (arquivo do Bruno governa)
--   4. pack_judgment_governors sem a checagem de acesso ao pack -> falha em A8 (Carla lê)
--   5. judgment_move_conflicts sem `p.user_id <> auth.uid()`  -> falha em A9 (pack próprio barrado na pasta compartilhada)
--   6. folder_governed_pack_ids sem o filtro de colocação do dono -> falha em A6b
--   7. reconcile_folder_judgment_on_place sem limpar           -> falha em A7
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

-- Roda `sql` como `actor` e devolve o código da exceção levantada (NULL = não levantou).
CREATE FUNCTION pg_temp.erro_de(actor uuid, sql text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', actor, 'role', 'authenticated')::text, true);
  EXECUTE sql;
  RETURN NULL;
EXCEPTION WHEN others THEN
  RETURN SQLERRM;
END $$;

CREATE FUNCTION pg_temp.como(actor uuid) RETURNS void
LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', actor, 'role', 'authenticated')::text, true);
$$;

\set ana    '''00000000-0000-4000-8000-0000000187a0'''
\set bruno  '''00000000-0000-4000-8000-0000000187b0'''
\set carla  '''00000000-0000-4000-8000-0000000187c0'''
\set pai    '''00000000-0000-4000-8000-0000000187f1'''
\set filha  '''00000000-0000-4000-8000-0000000187f2'''
\set neta   '''00000000-0000-4000-8000-0000000187f3'''
\set solta  '''00000000-0000-4000-8000-0000000187f4'''
\set bx     '''00000000-0000-4000-8000-0000000187f5'''
\set p      '''00000000-0000-4000-8000-0000000187d1'''
\set q      '''00000000-0000-4000-8000-0000000187d2'''

INSERT INTO auth.users (id) VALUES (:ana::uuid), (:bruno::uuid), (:carla::uuid) ON CONFLICT DO NOTHING;
INSERT INTO public.folders (id, user_id, name, parent_id) VALUES
  (:pai::uuid,   :ana::uuid,   'PAI',   NULL),
  (:filha::uuid, :ana::uuid,   'FILHA', :pai::uuid),
  (:neta::uuid,  :ana::uuid,   'NETA',  :filha::uuid),
  (:solta::uuid, :ana::uuid,   'SOLTA', NULL),
  (:bx::uuid,    :bruno::uuid, 'BX',    NULL);
INSERT INTO public.packs (id, user_id, name, date_start, date_stop, level) VALUES
  (:p::uuid, :ana::uuid,   't187-P', '2026-01-01', '2026-01-31', 'ad'),
  (:q::uuid, :bruno::uuid, 't187-Q', '2026-01-01', '2026-01-31', 'ad');
INSERT INTO public.pack_shares (pack_id, owner_id, grantee_id) VALUES (:p::uuid, :ana::uuid, :bruno::uuid);
INSERT INTO public.pack_folder_members (user_id, pack_id, folder_id) VALUES
  (:ana::uuid,   :p::uuid, :filha::uuid),
  (:bruno::uuid, :p::uuid, :bx::uuid);

-- A1: FILHA define; depois PAI define -> o critério da FILHA sai (dono único por galho).
SELECT pg_temp.expect('A1a filha define', pg_temp.erro_de(:ana::uuid, format('select public.set_folder_judgment(%L, %L)', :filha, '{"mql_leadscore_min":50}')), NULL);
SELECT pg_temp.expect('A1b pai define', pg_temp.erro_de(:ana::uuid, format('select public.set_folder_judgment(%L, %L)', :pai, '{"mql_leadscore_min":70}')), NULL);
SELECT pg_temp.expect('A1 filha perdeu o critério', (SELECT judgment::text FROM public.folders WHERE id = :filha::uuid), NULL);

-- A2: NETA não pode definir: um ancestral (PAI) já manda.
SELECT pg_temp.expect('A2 neta recusada',
  pg_temp.erro_de(:ana::uuid, format('select public.set_folder_judgment(%L, %L)', :neta, '{"mql_leadscore_min":10}')),
  'folder_judgment_governed');

-- A3: para o Bruno (que só recebeu o pack), quem manda em P é a pasta da Ana — sem o nome.
SELECT pg_temp.como(:bruno::uuid);
SELECT pg_temp.expect('A3 governa P (visto pelo Bruno)',
  (SELECT folder_id::text || '|' || coalesce(folder_name, '<oculto>') || '|' || (judgment->>'mql_leadscore_min')
   FROM public.pack_judgment_governors(ARRAY[:p::uuid])),
  :pai || '|<oculto>|70');

-- A4: Bruno dá critério à pasta dele (onde arquivou P): o arquivo dele NÃO governa P.
SELECT pg_temp.expect('A4a BX define', pg_temp.erro_de(:bruno::uuid, format('select public.set_folder_judgment(%L, %L)', :bx, '{"mql_leadscore_min":50}')), NULL);
SELECT pg_temp.como(:bruno::uuid);
SELECT pg_temp.expect('A4 só a pasta da Ana governa P',
  (SELECT string_agg(folder_id::text, ',') FROM public.pack_judgment_governors(ARRAY[:p::uuid])),
  :pai);

-- A5: pack compartilhado não entra em pasta própria com critério; pack próprio entra.
SELECT pg_temp.como(:bruno::uuid);
SELECT pg_temp.expect('A5a P barrado em BX',
  (SELECT string_agg(x::text, ',') FROM public.judgment_move_conflicts(ARRAY[:p::uuid], :bx::uuid) x), :p);
SELECT pg_temp.expect('A5b Q (do Bruno) livre',
  (SELECT string_agg(x::text, ',') FROM public.judgment_move_conflicts(ARRAY[:q::uuid], :bx::uuid) x), NULL);

-- A6: a pasta governa só a colocação do dono; quem não edita a pasta recebe erro.
SELECT pg_temp.como(:ana::uuid);
SELECT pg_temp.expect('A6a PAI governa P',
  (SELECT string_agg(x::text, ',') FROM public.folder_governed_pack_ids(:pai::uuid) x), :p);
SELECT pg_temp.como(:bruno::uuid);
SELECT pg_temp.expect('A6b BX não governa P (arquivo)',
  (SELECT string_agg(x::text, ',') FROM public.folder_governed_pack_ids(:bx::uuid) x), NULL);
SELECT pg_temp.expect('A6c Bruno não edita PAI',
  pg_temp.erro_de(:bruno::uuid, format('select public.folder_governed_pack_ids(%L)', :pai)), 'folder_not_found');

-- A7: SOLTA (com critério) é arrastada para dentro de PAI -> perde o critério próprio
-- e passa a valer o de PAI.
SELECT pg_temp.expect('A7a solta define', pg_temp.erro_de(:ana::uuid, format('select public.set_folder_judgment(%L, %L)', :solta, '{"mql_leadscore_min":30}')), NULL);
UPDATE public.folders SET parent_id = :pai::uuid WHERE id = :solta::uuid;
SELECT pg_temp.como(:ana::uuid);
SELECT pg_temp.expect('A7b passa a valer o de PAI',
  (SELECT public.reconcile_folder_judgment_on_place(:solta::uuid)->>'mql_leadscore_min'), '70');
SELECT pg_temp.expect('A7 solta perdeu o critério', (SELECT judgment::text FROM public.folders WHERE id = :solta::uuid), NULL);

-- A8: quem não tem acesso ao pack não lê nada sobre ele.
SELECT pg_temp.como(:carla::uuid);
SELECT pg_temp.expect('A8 Carla não lê', (SELECT count(*)::text FROM public.pack_judgment_governors(ARRAY[:p::uuid])), '0');

-- A9: Ana compartilha PAI com o Bruno (editor). O pack do PRÓPRIO Bruno pode entrar em PAI
-- (vira colocação do dono, que governa); P, que é da Ana, também pode (árvore da dona).
INSERT INTO public.folder_shares (folder_id, owner_id, grantee_id, role) VALUES (:pai::uuid, :ana::uuid, :bruno::uuid, 'editor');
SELECT pg_temp.como(:bruno::uuid);
SELECT pg_temp.expect('A9 Q e P livres em PAI',
  (SELECT string_agg(x::text, ',') FROM public.judgment_move_conflicts(ARRAY[:q::uuid, :p::uuid], :pai::uuid) x), NULL);

\echo 'OK: 17 asserções'
ROLLBACK;
