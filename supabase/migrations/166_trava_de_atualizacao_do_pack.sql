-- ===========================================================================
-- 166 — Trava de atualização do pack: só um adquire (0.2 do plano de edição de período)
-- ===========================================================================
--
-- PROBLEMA. `refresh_status = 'running'` era um UPDATE incondicional: duas
-- atualizações do mesmo pack (outro membro, outra aba) escreviam as duas, abriam
-- dois relatórios na Meta e a segunda a terminar sobrescrevia `date_stop` e
-- `last_refreshed_at` da primeira. A fila que o usuário vê é do NAVEGADOR
-- (`REFRESH_MAX_CONCURRENCY = 1` em usePackRefresh.ts) e só serializa o que ele
-- mesmo dispara. O guard 409 da rota dependia de `REFRESH_SERVER_CHAIN_ENABLED`.
--
-- A edição de período (em construção) apaga e regrava dias do pack: um refresh
-- concorrente no meio disso é o pior caso possível. A trava passa a ser do banco,
-- compare-and-set, e a mesma para atualização e edição.
--
-- REGRA. Ocupado = `refresh_status = 'running'` E `refresh_lock_until` no futuro.
-- Qualquer outro estado (status terminal, prazo vencido, prazo nulo) está livre —
-- é o mesmo critério da varredura da 141 (`sweep_stale_pack_refresh`), então um
-- job que morreu sem escrever o status final libera o pack sozinho em 15 min.
--
-- `refresh_lock_until` é `timestamp` SEM fuso e guarda UTC: comparar com
-- `now() AT TIME ZONE 'utc'` (naive contra naive), como na 141.
--
-- VOLTA ATRÁS: DROP FUNCTION public.pack_acquire_refresh_lock(uuid, uuid, uuid, integer);
-- o backend volta a marcar 'running' com UPDATE simples.
-- ===========================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.pack_acquire_refresh_lock(
  p_owner uuid,
  p_pack uuid,
  p_actor uuid,
  p_ttl_minutes integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  afetados integer;
BEGIN
  UPDATE public.packs
     SET refresh_status = 'running',
         refresh_lock_until = (now() AT TIME ZONE 'utc') + make_interval(mins => p_ttl_minutes),
         refresh_actor_id = p_actor
   WHERE id = p_pack
     AND user_id = p_owner
     AND (
       refresh_status IS DISTINCT FROM 'running'
       OR refresh_lock_until IS NULL
       OR refresh_lock_until < (now() AT TIME ZONE 'utc')
     );

  GET DIAGNOSTICS afetados = ROW_COUNT;
  RETURN afetados = 1;
END;
$function$;

COMMENT ON FUNCTION public.pack_acquire_refresh_lock(uuid, uuid, uuid, integer) IS
  'Compare-and-set da trava de refresh do pack (migration 166): marca running + prazo + ator SO se o pack nao estiver running com prazo vigente. true = adquiriu; false = ocupado. Liberacao continua por update_pack_refresh_status (status terminal) ou pela varredura da 141.';

-- Só o papel de serviço (a rota) chama; nenhum cliente direto.
REVOKE ALL ON FUNCTION public.pack_acquire_refresh_lock(uuid, uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pack_acquire_refresh_lock(uuid, uuid, uuid, integer) TO service_role;

COMMIT;
