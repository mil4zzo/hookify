-- Rollback da 185. Volte o backend ANTES: ele chama set_folder_judgment e resolve_folder_judgment.
-- Os critérios guardados nas pastas se perdem (os packs já herdados ficam como estão).
BEGIN;

DROP FUNCTION IF EXISTS public.resolve_folder_judgment(uuid, boolean);
DROP FUNCTION IF EXISTS public.set_folder_judgment(uuid, jsonb);
ALTER TABLE public.folders DROP CONSTRAINT IF EXISTS folders_judgment_is_object;
ALTER TABLE public.folders DROP COLUMN IF EXISTS judgment;

COMMIT;
