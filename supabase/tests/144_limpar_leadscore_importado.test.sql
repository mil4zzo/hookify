-- Migration 144 (clear_ad_metrics_enrichment), reescrito para o mundo da 145:
-- a linha de ad_metrics pertence a UM pack.
--
-- O QUE PROVA
--   1. PRÉVIA NÃO ALTERA NADA — dry_run devolve a contagem e o banco fica igual.
--   2. PRÉVIA NÃO MENTE — o número contado na prévia é EXATAMENTE o `rows_cleared`
--      da execução (um único predicado, em ad_metrics_enrichment_targets).
--   3. ISOLAMENTO ENTRE PACKS — é o que a 145 compra. O teste CRIA a situação que
--      antes vazava: uma cópia de um anúncio-dia do pack-alvo num segundo pack, com
--      leadscore próprio. Limpar o alvo tem de deixar a cópia intacta. Antes da 145
--      as duas eram a MESMA linha e a limpeza apagava as duas.
--   4. ESCOPO — leadscore de outros packs do mesmo dono não é tocado.
--   5. MÉTRICA DA META INTACTA — spend continua idêntico.
--   6. GUARD — p_pack_id nulo é RECUSADO, não tratado como "tudo".
--   7. IDEMPOTÊNCIA — segunda passada é no-op.
--   8. CUSTOM_HIST JUNTO — a coluna das colunas vinculadas também é zerada.
--   9. CONTRATO — rows_shared_with_other_packs e other_packs_affected são 0 (não há
--      mais compartilhamento a avisar; o frontend esconde o aviso quando 0).
--  10. O TESTE NÃO É VAZIO — exige um pack-alvo com leadscore de verdade.
--
-- COMO RODAR (lab com o dump restaurado + migrations até a 145):
--   export PATH="/c/Program Files/PostgreSQL/17/bin:$PATH"
--   export PGPASSWORD='lab_hookify_2026'; export PGHOST=127.0.0.1; export PGUSER=hookify_lab
--   psql -d hookify_lab -X -v ON_ERROR_STOP=1 -f supabase/tests/144_limpar_leadscore_importado.test.sql
-- Sai com código 0 e imprime "OK: N asserções". Roda em transação e termina em ROLLBACK.

\set ON_ERROR_STOP on
\pset pager off
BEGIN;

DO $BLOCO$
DECLARE
  v_pack   uuid;
  v_uid    uuid;
  v_outro  uuid := '00000000-0000-4000-8000-000000000144'::uuid;  -- pack sintetico do mesmo dono
  v_ad     text;
  v_dia    date;
  v_previa jsonb;
  v_exec   jsonb;
  v_dentro_antes  int; v_dentro_depois int;
  v_outros_antes  int; v_outros_depois int;
  v_spend_antes   numeric; v_spend_depois numeric;
  v_custom_antes  int; v_custom_depois int;
  v_copia_ls      numeric[];
  v_asserts       int := 0;
BEGIN
  -- ALVO: o pack com mais leadscore importado.
  SELECT am.pack_id, am.user_id INTO v_pack, v_uid
  FROM ad_metrics am WHERE am.leadscore_values IS NOT NULL
  GROUP BY 1, 2 ORDER BY count(*) DESC LIMIT 1;
  IF v_pack IS NULL THEN
    RAISE EXCEPTION 'TESTE VAZIO: nenhum pack com leadscore. Restaure o dump antes de rodar.';
  END IF;

  -- Semear custom_hist em algumas linhas do alvo (asserção 8).
  UPDATE ad_metrics am SET custom_hist = '{"m1": {"18-24": 3}}'::jsonb
  WHERE am.user_id = v_uid AND am.pack_id = v_pack
    AND am.id IN (SELECT t.id FROM ad_metrics_enrichment_targets(v_uid, v_pack) t LIMIT 25);

  -- 3. A situação que vazava: o MESMO anúncio-dia num segundo pack, com leadscore
  --    próprio. Gatilhos ligados: o rollup do segundo pack nasce junto.
  SELECT am.ad_id, am.date INTO v_ad, v_dia
  FROM ad_metrics am WHERE am.user_id = v_uid AND am.pack_id = v_pack AND am.leadscore_values IS NOT NULL
  LIMIT 1;
  INSERT INTO ad_metrics
  SELECT (jsonb_populate_record(am, jsonb_build_object('pack_id', v_outro, 'leadscore_values', ARRAY[77.0, 78.0]))).*
  FROM ad_metrics am WHERE am.user_id = v_uid AND am.pack_id = v_pack AND am.ad_id = v_ad AND am.date = v_dia;

  -- ---- Estado ANTES -------------------------------------------------------
  SELECT count(*) FILTER (WHERE leadscore_values IS NOT NULL), count(*) FILTER (WHERE custom_hist IS NOT NULL), coalesce(sum(spend), 0)
  INTO v_dentro_antes, v_custom_antes, v_spend_antes
  FROM ad_metrics WHERE user_id = v_uid AND pack_id = v_pack;
  SELECT count(*) INTO v_outros_antes FROM ad_metrics WHERE leadscore_values IS NOT NULL AND pack_id <> v_pack;
  IF v_dentro_antes = 0 OR v_custom_antes = 0 THEN
    RAISE EXCEPTION 'TESTE VAZIO: alvo sem leadscore (%) ou sem custom_hist (%)', v_dentro_antes, v_custom_antes;
  END IF;

  -- ---- 1: prévia conta e não altera ---------------------------------------
  v_previa := clear_ad_metrics_enrichment(v_uid, v_pack, true);
  IF (v_previa->>'rows_cleared')::int <> 0 THEN
    RAISE EXCEPTION 'ASSERT 1 FALHOU: dry_run reportou % linhas limpas', v_previa->>'rows_cleared';
  END IF;
  v_asserts := v_asserts + 1;
  SELECT count(*) FILTER (WHERE leadscore_values IS NOT NULL) INTO v_dentro_depois
  FROM ad_metrics WHERE user_id = v_uid AND pack_id = v_pack;
  IF v_dentro_depois <> v_dentro_antes THEN
    RAISE EXCEPTION 'ASSERT 1 FALHOU: dry_run mexeu no banco (% -> %)', v_dentro_antes, v_dentro_depois;
  END IF;
  v_asserts := v_asserts + 1;

  -- ---- 9: contrato — sem compartilhamento a avisar -------------------------
  IF (v_previa->>'rows_shared_with_other_packs')::int <> 0 OR (v_previa->>'other_packs_affected')::int <> 0 THEN
    RAISE EXCEPTION 'ASSERT 9 FALHOU: previa acusa compartilhamento (% / %)', v_previa->>'rows_shared_with_other_packs', v_previa->>'other_packs_affected';
  END IF;
  v_asserts := v_asserts + 1;

  -- ---- 6: guard de escopo -------------------------------------------------
  BEGIN
    PERFORM clear_ad_metrics_enrichment(v_uid, NULL, true);
    RAISE EXCEPTION 'ASSERT 6 FALHOU: aceitou p_pack_id nulo';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%exige p_pack_id%' THEN RAISE; END IF;
    v_asserts := v_asserts + 1;
  END;

  -- ---- Execução -----------------------------------------------------------
  v_exec := clear_ad_metrics_enrichment(v_uid, v_pack, false);

  -- 2: a prévia prometeu o que a execução cumpriu
  IF (v_previa->>'rows_matched')::int <> (v_exec->>'rows_cleared')::int THEN
    RAISE EXCEPTION 'ASSERT 2 FALHOU: previa dizia % e a execucao limpou %', v_previa->>'rows_matched', v_exec->>'rows_cleared';
  END IF;
  v_asserts := v_asserts + 1;

  SELECT count(*) FILTER (WHERE leadscore_values IS NOT NULL), count(*) FILTER (WHERE custom_hist IS NOT NULL), coalesce(sum(spend), 0)
  INTO v_dentro_depois, v_custom_depois, v_spend_depois
  FROM ad_metrics WHERE user_id = v_uid AND pack_id = v_pack;

  -- dentro zerou; custom_hist foi junto; metrica intacta
  IF v_dentro_depois <> 0 THEN RAISE EXCEPTION 'ASSERT FALHOU: sobraram % linhas com leadscore no pack', v_dentro_depois; END IF;
  v_asserts := v_asserts + 1;
  IF v_custom_depois <> 0 THEN RAISE EXCEPTION 'ASSERT 8 FALHOU: sobraram % linhas com custom_hist', v_custom_depois; END IF;
  v_asserts := v_asserts + 1;
  IF v_spend_depois <> v_spend_antes THEN RAISE EXCEPTION 'ASSERT 5 FALHOU: spend mudou (% -> %)', v_spend_antes, v_spend_depois; END IF;
  v_asserts := v_asserts + 1;

  -- 3: A COPIA NO OUTRO PACK ESTA INTACTA (o que a 145 compra)
  SELECT leadscore_values INTO v_copia_ls FROM ad_metrics
  WHERE user_id = v_uid AND pack_id = v_outro AND ad_id = v_ad AND date = v_dia;
  IF v_copia_ls IS DISTINCT FROM ARRAY[77.0::numeric, 78.0::numeric] THEN
    RAISE EXCEPTION 'ASSERT 3 FALHOU: limpar o pack A tocou o mesmo anuncio-dia no pack B (leadscore = %)', v_copia_ls;
  END IF;
  v_asserts := v_asserts + 1;
  -- ... e o rollup dela tambem (o gatilho nao foi disparado para o outro pack)
  IF NOT EXISTS (SELECT 1 FROM ad_performance_daily d WHERE d.user_id = v_uid AND d.pack_id = v_outro
                 AND d.ad_id = v_ad AND d.date = v_dia AND cardinality(d.lead_scores) > 0) THEN
    RAISE EXCEPTION 'ASSERT 3 FALHOU: o rollup do pack B perdeu o histograma de leads';
  END IF;
  v_asserts := v_asserts + 1;

  -- 4: os outros packs (inclusive o sintetico) nao perderam nada
  SELECT count(*) INTO v_outros_depois FROM ad_metrics WHERE leadscore_values IS NOT NULL AND pack_id <> v_pack;
  IF v_outros_depois <> v_outros_antes THEN
    RAISE EXCEPTION 'ASSERT 4 FALHOU: leadscore fora do pack mudou (% -> %)', v_outros_antes, v_outros_depois;
  END IF;
  v_asserts := v_asserts + 1;

  -- 7: idempotência
  IF (clear_ad_metrics_enrichment(v_uid, v_pack, false)->>'rows_cleared')::int <> 0 THEN
    RAISE EXCEPTION 'ASSERT 7 FALHOU: segunda passada nao foi no-op';
  END IF;
  v_asserts := v_asserts + 1;

  RAISE NOTICE 'OK: % assercoes (pack %, % linhas limpas; copia em outro pack intacta)', v_asserts, v_pack, v_exec->>'rows_cleared';
END $BLOCO$;

ROLLBACK;
