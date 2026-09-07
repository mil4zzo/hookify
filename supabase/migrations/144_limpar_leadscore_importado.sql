-- 144: limpar o leadscore importado de um pack.
--
-- POR QUE ESTA MIGRATION EXISTE
-- -----------------------------
-- `batch_update_ad_metrics_enrichment` (o sync da planilha) é um UPDATE puro:
-- só toca as linhas cujo par (anúncio, dia) veio na carga, e nunca apaga nada.
-- Consequência descoberta em 2026-09-07: trocar a planilha de origem (renomear
-- o arquivo e substituir o conteúdo, por exemplo) deixa o pack com uma MISTURA
-- silenciosa — os dias que existem nas duas planilhas são sobrescritos, e os
-- que só existiam na antiga ficam lá para sempre, indistinguíveis dos novos.
-- Desvincular a integração também não limpa: o DELETE só remove a linha em
-- `ad_sheet_integrations`.
--
-- Não havia nenhuma forma de dizer "esqueça o que veio da planilha". Esta é.
--
-- ESCOPO É OBRIGATORIAMENTE UM PACK
-- ---------------------------------
-- Sem `p_pack_id` o predicado pegaria o silo inteiro do usuário. A função
-- RECUSA nulo em vez de tratar como "tudo", que é o default perigoso.

-- DROP antes de criar: `CREATE OR REPLACE` nao consegue mudar a forma do
-- RETURNS TABLE de uma funcao existente, e esta migration precisa ser
-- re-executavel (foi editada depois de ja ter sido aplicada no laboratorio).
DROP FUNCTION IF EXISTS public.clear_ad_metrics_enrichment(uuid, uuid, boolean);
DROP FUNCTION IF EXISTS public.ad_metrics_enrichment_targets(uuid, uuid);

-- Alvos da limpeza. Existe como função própria para que a prévia e a execução
-- usem LITERALMENTE o mesmo predicado — escrito duas vezes, ele divergiria, e a
-- prévia passaria a prometer um número diferente do que o UPDATE faz.
CREATE OR REPLACE FUNCTION public.ad_metrics_enrichment_targets(
  p_user_id uuid,
  p_pack_id uuid
)
RETURNS TABLE (id text, ad_id text, metric_date date, has_leadscore boolean, has_custom boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  -- Dirigido pelo mapa (índice user_id, pack_id, metric_date, ad_id) e não por
  -- uma varredura de ad_metrics com EXISTS linha a linha.
  SELECT
    am.id,
    am.ad_id,
    am.date,
    am.leadscore_values IS NOT NULL,
    am.custom_hist IS NOT NULL
  FROM public.ad_metric_pack_map apm
  JOIN public.ad_metrics am
    ON am.user_id = apm.user_id
   AND am.ad_id   = apm.ad_id
   AND am.date    = apm.metric_date
  WHERE apm.user_id = p_user_id
    AND apm.pack_id = p_pack_id
    AND (am.leadscore_values IS NOT NULL OR am.custom_hist IS NOT NULL);
$$;

ALTER FUNCTION public.ad_metrics_enrichment_targets(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.ad_metrics_enrichment_targets(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ad_metrics_enrichment_targets(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ad_metrics_enrichment_targets(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.ad_metrics_enrichment_targets(uuid, uuid) IS
  'Linhas de ad_metrics de um pack que carregam dado vindo da planilha (leadscore_values ou custom_hist). Fonte unica do predicado usado por clear_ad_metrics_enrichment na previa e na execucao.';


CREATE OR REPLACE FUNCTION public.clear_ad_metrics_enrichment(
  p_user_id uuid,
  p_pack_id uuid,
  p_dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET plan_cache_mode TO 'force_custom_plan'
AS $$
DECLARE
  v_leadscore_rows int := 0;
  v_custom_rows    int := 0;
  v_total_rows     int := 0;
  v_cleared        int := 0;
  v_shared_rows    int := 0;
  v_other_packs    int := 0;
BEGIN
  -- Mesmo guard de tenancy do batch_update (113): caller autenticado só opera o
  -- próprio silo; service role (auth.uid() nulo) passa, e é o caminho do backend.
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Forbidden: p_user_id must match auth.uid()';
  END IF;

  IF p_pack_id IS NULL THEN
    RAISE EXCEPTION 'clear_ad_metrics_enrichment exige p_pack_id: sem pack o predicado pegaria o silo inteiro';
  END IF;

  -- A prévia roda SEMPRE, inclusive na execução: é o "SELECT com os filtros do
  -- WHERE antes do UPDATE destrutivo", e o número devolvido é o que foi contado.
  SELECT
    count(*)::int,
    count(*) FILTER (WHERE t.has_leadscore)::int,
    count(*) FILTER (WHERE t.has_custom)::int
  INTO v_total_rows, v_leadscore_rows, v_custom_rows
  FROM public.ad_metrics_enrichment_targets(p_user_id, p_pack_id) t;

  -- QUANTO DISSO E COMPARTILHADO COM OUTROS PACKS
  -- ----------------------------------------------
  -- `leadscore_values` mora na linha do anuncio-dia, nao no par (pack, linha).
  -- Se o mesmo anuncio-dia pertence a dois packs, limpar "o pack A" apaga o
  -- leadscore que o pack B tambem le. Nao da para evitar sem mudar o modelo
  -- (rastrear a origem por linha) — entao o minimo honesto e CONTAR e avisar
  -- antes, para a limpeza nunca ser uma surpresa em outro lugar.
  IF v_total_rows > 0 THEN
    SELECT count(*)::int, count(DISTINCT apm.pack_id)::int
    INTO v_shared_rows, v_other_packs
    FROM public.ad_metrics_enrichment_targets(p_user_id, p_pack_id) t
    JOIN public.ad_metric_pack_map apm
      ON apm.user_id  = p_user_id
     AND apm.ad_id    = t.ad_id
     AND apm.metric_date = t.metric_date
     AND apm.pack_id  <> p_pack_id;
  END IF;

  IF NOT p_dry_run AND v_total_rows > 0 THEN
    UPDATE public.ad_metrics am
    SET leadscore_values = NULL,
        custom_hist      = NULL,
        updated_at       = now()
    WHERE am.user_id = p_user_id
      AND am.id IN (SELECT t.id FROM public.ad_metrics_enrichment_targets(p_user_id, p_pack_id) t);
    GET DIAGNOSTICS v_cleared = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'status',            'success',
    'dry_run',           p_dry_run,
    'rows_matched',      v_total_rows,
    'rows_with_leadscore', v_leadscore_rows,
    'rows_with_custom',  v_custom_rows,
    'rows_cleared',      v_cleared,
    -- Dias-alvo que outros packs tambem enxergam, e quantos packs sao.
    'rows_shared_with_other_packs', v_shared_rows,
    'other_packs_affected',         v_other_packs
  );
END;
$$;

ALTER FUNCTION public.clear_ad_metrics_enrichment(uuid, uuid, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.clear_ad_metrics_enrichment(uuid, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.clear_ad_metrics_enrichment(uuid, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.clear_ad_metrics_enrichment(uuid, uuid, boolean) TO service_role;

COMMENT ON FUNCTION public.clear_ad_metrics_enrichment(uuid, uuid, boolean) IS
  'Apaga leadscore_values e custom_hist das linhas de ad_metrics de UM pack (dado vindo da planilha; metrica da Meta nao e tocada). p_dry_run=true so conta. Recusa p_pack_id nulo. ATENCAO: leadscore mora na linha do anuncio-dia, entao um dia que pertence a dois packs perde o leadscore nos dois — rows_shared_with_other_packs mede isso. Nao ha desfazer: so um novo sync repovoa.';
