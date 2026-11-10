-- Rollback da 190: tira os gatilhos e as funções (a regra volta a valer só nas rotas).
BEGIN;
DROP TRIGGER IF EXISTS trg_pfm_judgment_guard ON public.pack_folder_members;
DROP TRIGGER IF EXISTS trg_folders_judgment_guard ON public.folders;
DROP FUNCTION IF EXISTS public.trg_pfm_judgment_guard();
DROP FUNCTION IF EXISTS public.trg_folders_judgment_guard();
DROP FUNCTION IF EXISTS public._folder_subtree_has_archived(uuid);
COMMIT;
