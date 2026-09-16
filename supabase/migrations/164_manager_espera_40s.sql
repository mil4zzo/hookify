-- ===========================================================================
-- 164 — A função do Manager espera até 40 s (as demais leituras seguem em 20 s)
-- ===========================================================================
--
-- DECISÃO (idealizador, 16/09/2026): uma seleção enorme no Manager (ex.: todos os
-- packs, "Por anúncio", meses de período) é pesada de verdade; esperar 40 s é melhor
-- do que um erro aos 20 s. Só a função do Manager: nas outras telas tudo mede menos
-- de 1 s, e passar de 20 s lá é sinal de defeito — esperar mais só atrasaria o erro.
--
-- POR QUE AGORA É ACEITÁVEL: a 162 derrubou o pico de memória da consulta pela
-- metade (957 -> 400 MB no pior caso do laboratório). Com a v161, segurar essa
-- memória por 40 s numa máquina de ~950 MB seria arriscado.
--
-- COMO FUNCIONA: `SET statement_timeout` na função vale para a chamada pelo
-- PostgREST (ele "iça" esse ajuste para a transação — já em uso na
-- `detect_pack_conflicts` desde a 146). A regra da 159 continua: o banco desiste
-- ANTES do cliente — o backend espera o Manager por 45 s
-- (`MIN_MANAGER_READ_TIMEOUT_SECONDS`), e TODO caminho que chama estas funções usa
-- esse cliente (`_get_analytics_supabase`); o frontend espera 60 s.
--
-- Vale para a v162 e para a v161 (a volta atrás da 162 por configuração).
--
-- VOLTA ATRÁS: `ALTER FUNCTION ... RESET statement_timeout` (volta aos 20 s do papel).
-- ===========================================================================

BEGIN;

ALTER FUNCTION public.fetch_manager_rankings_v162(uuid, date, date, text, uuid[], text[], text, text, text, text, boolean, boolean, integer, integer, text, text, boolean, text)
  SET statement_timeout TO '40s';
ALTER FUNCTION public.fetch_manager_rankings_v161(uuid, date, date, text, uuid[], text[], text, text, text, text, boolean, boolean, integer, integer, text, text, boolean, text)
  SET statement_timeout TO '40s';

-- Prova no próprio arquivo: o teto novo e os ajustes antigos continuam lá.
DO $$
DECLARE
  v_f text;
  v_cfg text[];
BEGIN
  FOREACH v_f IN ARRAY array['v161', 'v162'] LOOP
    SELECT proconfig INTO v_cfg FROM pg_proc
    WHERE oid = ('public.fetch_manager_rankings_' || v_f || '(uuid, date, date, text, uuid[], text[], text, text, text, text, boolean, boolean, integer, integer, text, text, boolean, text)')::regprocedure;
    IF v_cfg IS NULL
       OR NOT ('statement_timeout=40s' = ANY(v_cfg))
       OR NOT ('plan_cache_mode=force_custom_plan' = ANY(v_cfg)) THEN
      RAISE EXCEPTION '164: % sem o teto de 40 s (ou perdeu plan_cache_mode). proconfig=%', v_f, v_cfg;
    END IF;
  END LOOP;
END;
$$;

COMMIT;
