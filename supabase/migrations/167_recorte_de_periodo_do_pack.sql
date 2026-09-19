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
  'Recorta os intervalos ativos de ad_pack_inventory de um pack para dentro de [p_start, p_stop] (migration 167): apaga quem nao cruza mais a janela e encolhe quem passa dela. O merge do refresh so ESTENDE (least/greatest), entao sem isto um anuncio seguiria aparecendo como ativo em dia que saiu do pack. MEDIDO em 18/09: sem esta chamada o Manager mostrou 146 linhas onde restavam 143 anuncios.';

REVOKE ALL ON FUNCTION public.pack_clamp_inventory(uuid, uuid, date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pack_clamp_inventory(uuid, uuid, date, date) TO service_role;


-- ── Cabeça do período novo: ausência na resposta = saiu do pack ─────────────
--
-- Único lugar onde "a Meta não trouxe" significa "não pertence mais". Nos N
-- primeiros dias do início novo, as linhas gravadas contavam conversões de
-- cliques ANTERIORES ao novo início — cliques que saíram do pack. A busca da
-- cabeça (que começa no novo início, sem encosto, como o Gerenciador) devolve a
-- verdade daquela janela; o que ela não trouxe tem de sair.
--
-- Fora da cabeça, ausência NUNCA apaga: um filtro de campanha que deixou de casar
-- devolveria vazio e levaria o pack inteiro. Por isso o corte por PERÍODO e o
-- corte por AUSÊNCIA são funções diferentes, e esta exige as chaves.
CREATE OR REPLACE FUNCTION public.pack_trim_head(
  p_owner uuid,
  p_pack uuid,
  p_from date,
  p_to date,
  p_keys jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_apagadas integer;
  v_chaves integer;
BEGIN
  -- Guarda dura: sem chaves, isto apagaria a cabeça inteira. Uma coleta vazia ou
  -- recortada nunca pode chegar aqui (o job já barra em collection_is_complete),
  -- mas a função se protege sozinha — foi assim que R$ 12 mil sumiram em 07/09.
  IF p_keys IS NULL OR jsonb_typeof(p_keys) <> 'array' OR jsonb_array_length(p_keys) = 0 THEN
    RAISE EXCEPTION 'pack_trim_head: p_keys vazio — recusando apagar a cabeca de % a %', p_from, p_to;
  END IF;

  SELECT jsonb_array_length(p_keys) INTO v_chaves;

  WITH vivos AS (
    SELECT (k->>0) AS ad_id, (k->>1)::date AS date
    FROM jsonb_array_elements(p_keys) k
  )
  DELETE FROM public.ad_metrics am
   WHERE am.user_id = p_owner
     AND am.pack_id = p_pack
     AND am.date BETWEEN p_from AND p_to
     AND NOT EXISTS (
       SELECT 1 FROM vivos v WHERE v.ad_id = am.ad_id AND v.date = am.date
     );
  GET DIAGNOSTICS v_apagadas = ROW_COUNT;

  RAISE LOG 'pack_trim_head: pack=% cabeca=%..% chaves=% apagadas=%', p_pack, p_from, p_to, v_chaves, v_apagadas;
  RETURN v_apagadas;
END;
$function$;

COMMENT ON FUNCTION public.pack_trim_head(uuid, uuid, date, date, jsonb) IS
  'Apaga de ad_metrics, nos N primeiros dias do periodo novo, os pares (anuncio, dia) que a busca da cabeca NAO trouxe (migration 167): la a ausencia significa "o clique que gerava esta linha saiu do pack". p_keys = array de [ad_id, "YYYY-MM-DD"]; vazio levanta excecao (uma coleta recortada apagaria a cabeca inteira). Fora da cabeca, corta-se por PERIODO, nunca por ausencia.';

REVOKE ALL ON FUNCTION public.pack_trim_head(uuid, uuid, date, date, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pack_trim_head(uuid, uuid, date, date, jsonb) TO service_role;


-- ── Anúncios que ficaram sem nenhum dia ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pack_prune_ad_ids(
  p_owner uuid,
  p_pack uuid
)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_vivos text[];
  v_antes text[];
  v_saindo text[];
BEGIN
  -- Vivo = tem métrica OU intervalo no inventário (presença sem entrega conta:
  -- é o desenho do F5). O inventário já foi recortado antes desta chamada.
  SELECT coalesce(array_agg(DISTINCT x.ad_id), '{}')
    INTO v_vivos
  FROM (
    SELECT ad_id FROM public.ad_metrics WHERE user_id = p_owner AND pack_id = p_pack
    UNION
    SELECT ad_id FROM public.ad_pack_inventory WHERE user_id = p_owner AND pack_id = p_pack
  ) x;

  SELECT coalesce(ad_ids, '{}') INTO v_antes
    FROM public.packs WHERE id = p_pack AND user_id = p_owner;

  SELECT coalesce(array_agg(a), '{}') INTO v_saindo
    FROM unnest(v_antes) a WHERE NOT (a = ANY(v_vivos));

  UPDATE public.packs SET ad_ids = v_vivos, updated_at = now()
   WHERE id = p_pack AND user_id = p_owner;

  RETURN v_saindo;
END;
$function$;

COMMENT ON FUNCTION public.pack_prune_ad_ids(uuid, uuid) IS
  'Reduz packs.ad_ids aos anuncios que ainda tem metrica ou intervalo no inventario, e DEVOLVE os que sairam (migration 167) — quem chama usa a lista para tirar o pack de ads.pack_ids e recolher miniaturas orfas. update_pack_ad_ids so soma; sem isto o pack carregaria para sempre anuncio sem nenhum dia.';

REVOKE ALL ON FUNCTION public.pack_prune_ad_ids(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pack_prune_ad_ids(uuid, uuid) TO service_role;


-- ── conversion_types depois do corte ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pack_recompute_conversion_types(
  p_owner uuid,
  p_pack uuid
)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_tipos text[];
BEGIN
  -- Mesmo universo de `_extract_conv_keys` no backend: 'conversion:<t>' das
  -- conversions e 'action:<t>' das actions.
  SELECT coalesce(array_agg(DISTINCT chave ORDER BY chave), '{}')
    INTO v_tipos
  FROM (
    SELECT 'conversion:' || (e->>'action_type') AS chave
      FROM public.ad_metrics am, jsonb_array_elements(am.conversions) e
     WHERE am.user_id = p_owner AND am.pack_id = p_pack
       AND jsonb_typeof(am.conversions) = 'array' AND (e->>'action_type') IS NOT NULL
    UNION ALL
    SELECT 'action:' || (e->>'action_type')
      FROM public.ad_metrics am, jsonb_array_elements(am.actions) e
     WHERE am.user_id = p_owner AND am.pack_id = p_pack
       AND jsonb_typeof(am.actions) = 'array' AND (e->>'action_type') IS NOT NULL
  ) x;

  UPDATE public.packs SET conversion_types = v_tipos, updated_at = now()
   WHERE id = p_pack AND user_id = p_owner;

  RETURN v_tipos;
END;
$function$;

COMMENT ON FUNCTION public.pack_recompute_conversion_types(uuid, uuid) IS
  'Recalcula packs.conversion_types do que SOBROU no pack (migration 167). O union do refresh e monotonico (so cresce); depois de um corte, um tipo que so existia nos dias removidos seguiria no dropdown do Manager e devolveria tela vazia — campo oferecido tem de ser respondivel.';

REVOKE ALL ON FUNCTION public.pack_recompute_conversion_types(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pack_recompute_conversion_types(uuid, uuid) TO service_role;

COMMIT;
