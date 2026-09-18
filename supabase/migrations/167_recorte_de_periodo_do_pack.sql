-- ===========================================================================
-- 167 — Recorte de período do pack: prévia e corte do inventário (Etapa 2)
-- ===========================================================================
--
-- Contexto: documentation/plano-edicao-periodo-pack.md, Etapa 2 (reduzir). A
-- Etapa 1 (ampliar) já está em produção e não apaga nada. Reduzir precisa de
-- duas peças que só o banco consegue fazer barato:
--
-- 1. `pack_trim_preview` — o que SAI do pack, para o aviso "X dias saem, somando
--    R$ Y" antes de confirmar. Conta o que EXISTE, não o que o período declara:
--    em produção há linhas fora da janela declarada do próprio pack (847 no mapa,
--    medido na 146 — metadado defasa do dado), e elas também saem no recorte.
--
-- 2. `pack_clamp_inventory` — o inventário (`ad_pack_inventory`, F5/154) guarda
--    o INTERVALO ativo de cada anúncio e só sabe crescer (`merge_ad_pack_inventory`
--    usa least/greatest). Sem recortar, um anúncio continuaria aparecendo como
--    "ativo, sem entrega" nos dias que saíram do pack.
--
-- O apagamento de `ad_metrics` NÃO vira função aqui: fica em Python, dia a dia
-- por (user, pack, date) no índice `ad_metrics_user_pack_date_idx`, como
-- `delete_pack` já faz — cada requisição bem abaixo do teto de 8 s que o papel
-- de serviço herda do `authenticator`. A cascata das FKs leva mapa e rollup.
--
-- Sem parâmetro opcional em nenhuma das duas: "p_x is null or" degrada o plano
-- na 6ª execução (ver decisoes-tecnicas, generic plan).
--
-- VOLTA ATRÁS:
--   DROP FUNCTION public.pack_trim_preview(uuid, uuid, date, date);
--   DROP FUNCTION public.pack_clamp_inventory(uuid, uuid, date, date);
-- ===========================================================================

BEGIN;

-- ── Prévia: o que sai do pack ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pack_trim_preview(
  p_owner uuid,
  p_pack uuid,
  p_start date,
  p_stop date
)
RETURNS TABLE (dias integer, investimento numeric, linhas bigint, anuncios bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT
    count(DISTINCT am.date)::integer          AS dias,
    coalesce(sum(am.spend), 0)::numeric       AS investimento,
    count(*)::bigint                          AS linhas,
    count(DISTINCT am.ad_id)::bigint          AS anuncios
  FROM public.ad_metrics am
  WHERE am.user_id = p_owner
    AND am.pack_id = p_pack
    AND (am.date < p_start OR am.date > p_stop);
$function$;

COMMENT ON FUNCTION public.pack_trim_preview(uuid, uuid, date, date) IS
  'Previa do recorte de periodo de um pack (migration 167): dias, investimento, linhas e anuncios que ficam FORA de [p_start, p_stop]. Conta o dado real, inclusive linhas fora da janela declarada do pack. So leitura.';

REVOKE ALL ON FUNCTION public.pack_trim_preview(uuid, uuid, date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pack_trim_preview(uuid, uuid, date, date) TO service_role;


-- ── Recorte do inventário ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pack_clamp_inventory(
  p_owner uuid,
  p_pack uuid,
  p_start date,
  p_stop date
)
RETURNS TABLE (ajustados integer, removidos integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_removidos integer;
  v_ajustados integer;
BEGIN
  -- Intervalo que não cruza mais a janela: o anúncio não tem presença nenhuma
  -- no período novo. Sai do inventário do pack.
  DELETE FROM public.ad_pack_inventory i
   WHERE i.user_id = p_owner
     AND i.pack_id = p_pack
     AND (i.last_active_date < p_start OR i.first_active_date > p_stop);
  GET DIAGNOSTICS v_removidos = ROW_COUNT;

  -- Intervalo que cruza a janela mas passa dela: encolhe para dentro.
  UPDATE public.ad_pack_inventory i
     SET first_active_date = greatest(i.first_active_date, p_start),
         last_active_date  = least(i.last_active_date, p_stop),
         updated_at = now()
   WHERE i.user_id = p_owner
     AND i.pack_id = p_pack
     AND (i.first_active_date < p_start OR i.last_active_date > p_stop);
  GET DIAGNOSTICS v_ajustados = ROW_COUNT;

  RETURN QUERY SELECT v_ajustados, v_removidos;
END;
$function$;

COMMENT ON FUNCTION public.pack_clamp_inventory(uuid, uuid, date, date) IS
  'Recorta os intervalos ativos de ad_pack_inventory de um pack para dentro de [p_start, p_stop] (migration 167): apaga quem nao cruza mais a janela e encolhe quem passa dela. O merge do refresh so ESTENDE (least/greatest), entao sem isto um anuncio seguiria aparecendo como ativo em dia que saiu do pack.';

REVOKE ALL ON FUNCTION public.pack_clamp_inventory(uuid, uuid, date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pack_clamp_inventory(uuid, uuid, date, date) TO service_role;

COMMIT;
