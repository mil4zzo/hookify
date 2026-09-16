-- ===========================================================================
-- 158 — plan_cache_mode no backfill do inventário (fecha a lacuna da 154)
-- ===========================================================================
--
-- O QUE ESTÁ ERRADO
-- -----------------
-- A migration 154 criou `ad_pack_inventory_backfill(p_user_id uuid DEFAULT NULL)`
-- com o padrão de parâmetro opcional:
--
--     where (p_user_id is null or m.user_id = p_user_id)
--
-- e **sem** `plan_cache_mode = force_custom_plan`. Esse é exatamente o padrão que
-- o gate `public.check_plan_cache_mode_gaps()` (migration 120) existe para pegar:
-- com plano genérico o planner não sabe se o filtro por usuário vale, usa
-- seletividade default e pode escolher um plano catastrófico — medido em outra
-- função: 860 ms -> 233.814 ms (~270x), terminando em `57014 statement timeout`.
--
-- POR QUE CORRIGIR MESMO SENDO FUNÇÃO ADMINISTRATIVA
-- --------------------------------------------------
-- O risco de produção aqui é baixo: a função é chamada por migration e no
-- laboratório, nunca pelo PostgREST (ela é REVOKE de PUBLIC/anon/authenticated),
-- então não há conexão persistente reexecutando o plano cacheado.
--
-- O risco de PROCESSO é que importa. Desde a 154 o workflow
-- `.github/workflows/db-guardrails.yml` falha em todo push para a main. Alarme
-- que vive vermelho deixa de ser lido — e aí o dia em que uma função de LEITURA
-- entrar com a mesma lacuna, ninguém vai reparar. O gate só protege enquanto
-- verde significa alguma coisa.
--
-- Este arquivo não muda comportamento nem plano de consulta de nada que o app
-- leia: só carimba a configuração na função e zera o gate.
--
-- CONFERIR DEPOIS DE APLICAR
-- --------------------------
--     select * from public.check_plan_cache_mode_gaps();   -- deve vir vazio
-- ===========================================================================

ALTER FUNCTION public.ad_pack_inventory_backfill(uuid)
  SET plan_cache_mode TO 'force_custom_plan';

-- Verificação no próprio arquivo: falha alto se a config não pegou.
-- Identificar a função por `regprocedure` e NÃO por
-- `pg_get_function_identity_arguments(oid) = 'uuid'` — essa função devolve o
-- nome do parâmetro junto ('p_user_id uuid'), a comparação não casa linha
-- nenhuma, o SELECT INTO deixa NULL e a prova acusa uma falha que não houve.
DO $$
DECLARE
  v_oid oid;
  v_cfg text[];
BEGIN
  SELECT p.oid, p.proconfig INTO v_oid, v_cfg
  FROM pg_proc p
  WHERE p.oid = 'public.ad_pack_inventory_backfill(uuid)'::regprocedure;

  IF v_oid IS NULL THEN
    RAISE EXCEPTION '158: public.ad_pack_inventory_backfill(uuid) não existe — a 154 foi aplicada?';
  END IF;

  IF v_cfg IS NULL OR NOT ('plan_cache_mode=force_custom_plan' = ANY(v_cfg)) THEN
    RAISE EXCEPTION '158: plan_cache_mode não ficou na função. proconfig=%', v_cfg;
  END IF;
END;
$$;

-- Lembrete para quem recriar esta função um dia: recriar NÃO herda o ALTER.
-- Foi assim que a fetch_manager_rankings_series_v2 ficou meses sem proteção.
COMMENT ON FUNCTION public.ad_pack_inventory_backfill(uuid) IS
  'F5: preenche ad_pack_inventory a partir das linhas-zero sintéticas de ad_metrics (sem as '
  'anteriores à criação do anúncio). Idempotente. Uso administrativo (migration e laboratório). '
  'Tem plan_cache_mode=force_custom_plan (158) — se recriar a função, repita o ALTER.';
