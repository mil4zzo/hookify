-- Rollback da 186. Volte o backend ANTES (ele chama as três funções de consulta).
-- set_folder_judgment volta ao corpo da 185 (sem a regra de dono único).
-- O critério das subpastas apagado ao definir numa pasta-mãe NÃO volta.
BEGIN;

DROP FUNCTION IF EXISTS public.pack_judgment_governors(uuid[]);
DROP FUNCTION IF EXISTS public.folders_with_judgment(uuid[]);
DROP FUNCTION IF EXISTS public.folder_judgment_governor(uuid, boolean);

CREATE OR REPLACE FUNCTION public.set_folder_judgment(p_folder_id uuid, p_judgment jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role text := public.folder_access_role(p_folder_id, (SELECT auth.uid()));
  v_value jsonb := CASE WHEN p_judgment IS NULL OR p_judgment = '{}'::jsonb THEN NULL ELSE p_judgment END;
BEGIN
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'folder_not_found' USING ERRCODE = 'P0001';
  ELSIF v_role NOT IN ('dono', 'editor') THEN
    RAISE EXCEPTION 'folder_forbidden' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.folders SET judgment = v_value WHERE id = p_folder_id;
  RETURN v_value;
END;
$$;

COMMIT;
