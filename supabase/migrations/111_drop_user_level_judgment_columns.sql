-- Migration 111: remove as colunas de julgamento que deixaram de existir no usuario
--
-- ############################################################################
-- ##  NAO APLICAR ANTES DO DEPLOY DO CODIGO DA 110.                         ##
-- ##                                                                        ##
-- ##  O backend em producao ainda le `user_preferences.mql_leadscore_min`.  ##
-- ##  Dropar a coluna antes do deploy derruba a producao no ato.            ##
-- ##  Esta migration e a SEGUNDA metade da 110, deliberadamente separada.   ##
-- ############################################################################
--
-- O QUE SAI E POR QUE
--   user_preferences.mql_leadscore_min  -> o corte descreve a PLANILHA do pack,
--                                          nao o usuario; um corte sem a planilha
--                                          que o produziu nao tem referente.
--   user_preferences.target_cpr         -> indexado por action_type, que vem de
--                                          packs.conversion_types. A granularidade
--                                          sempre esteve errada: um mapa global
--                                          carrega chaves que o pack nao tem.
--   packs.diagnostic_cost_metric        -> o inverso: e controle de VISUALIZACAO
--                                          e vive so no usuario. O override por
--                                          pack (criado na 101) nunca teve uso.
--
--   Ficam de pe: user_preferences.diagnostic_cost_metric e validation_criteria.
--
-- APOS ESTA MIGRATION nao existe mais heranca em lugar nenhum: cada campo de
-- julgamento existe em exatamente um lugar.

BEGIN;

-- ---------------------------------------------------------------------------
-- Guarda: a 110 rodou? Sem ela, dropar as colunas do usuario apaga o unico
-- lugar onde o valor existe — os packs ainda nao teriam recebido o backfill.
-- ---------------------------------------------------------------------------
DO $guard$
DECLARE
  v_resolver_ok integer;
  v_packs_com_corte integer;
BEGIN
  SELECT count(*) INTO v_resolver_ok
  FROM pg_proc
  WHERE pronamespace = 'public'::regnamespace
    AND proname = 'resolve_pack_mql_leadscore_min'
    AND prosrc LIKE '%resolve_pack_access%'
    AND prosrc NOT LIKE '%user_preferences%';

  IF v_resolver_ok <> 1 THEN
    RAISE EXCEPTION
      'ABORTADO: resolve_pack_mql_leadscore_min ainda consulta user_preferences. Aplique a 110 primeiro.';
  END IF;

  SELECT count(*) INTO v_packs_com_corte
  FROM public.packs
  WHERE mql_leadscore_min IS NOT NULL;

  IF v_packs_com_corte = 0 THEN
    RAISE EXCEPTION
      'ABORTADO: nenhum pack tem corte definido. O backfill da 110 nao rodou — dropar agora perderia o valor.';
  END IF;
END
$guard$;

-- ---------------------------------------------------------------------------
-- Drops
-- ---------------------------------------------------------------------------

ALTER TABLE public.user_preferences DROP COLUMN IF EXISTS mql_leadscore_min;
ALTER TABLE public.user_preferences DROP COLUMN IF EXISTS target_cpr;

ALTER TABLE public.packs DROP COLUMN IF EXISTS diagnostic_cost_metric;

-- ---------------------------------------------------------------------------
-- Pos-condicao: sumiram as tres, e as duas que ficam seguem de pe
-- ---------------------------------------------------------------------------
DO $post$
DECLARE
  v_sobraram integer;
  v_ficaram integer;
BEGIN
  SELECT count(*) INTO v_sobraram
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND (
      (table_name = 'user_preferences' AND column_name IN ('mql_leadscore_min', 'target_cpr'))
      OR (table_name = 'packs' AND column_name = 'diagnostic_cost_metric')
    );

  IF v_sobraram <> 0 THEN
    RAISE EXCEPTION 'ABORTADO: % colunas sobreviveram aos drops.', v_sobraram;
  END IF;

  SELECT count(*) INTO v_ficaram
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'user_preferences'
    AND column_name IN ('diagnostic_cost_metric', 'validation_criteria');

  IF v_ficaram <> 2 THEN
    RAISE EXCEPTION
      'ABORTADO: esperava 2 colunas de visualizacao em user_preferences, encontrei %.', v_ficaram;
  END IF;
END
$post$;

COMMIT;
