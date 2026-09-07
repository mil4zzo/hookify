-- Migration 144: clear_ad_metrics_enrichment (limpar o leadscore importado).
--
-- O QUE PROVA
--   1. PRÉVIA NÃO ALTERA NADA — dry_run devolve a contagem e o banco fica igual.
--   2. PRÉVIA NÃO MENTE — o número contado na prévia é EXATAMENTE o `rows_cleared`
--      da execução. É a razão de existir `ad_metrics_enrichment_targets`: um único
--      predicado alimenta as duas. Escrito duas vezes, ele divergiria e a prévia
--      prometeria um número que o UPDATE não cumpre.
--   3. ESCOPO — leadscore de FORA do pack não é tocado. É a asserção que separa
--      "limpar um pack" de "limpar o silo".
--   4. MÉTRICA DA META INTACTA — spend continua idêntico. A limpeza é só do que
--      veio da planilha.
--   5. COMPARTILHAMENTO ENTRE PACKS É REAL E MEDIDO — `leadscore_values` mora na
--      linha do anúncio-dia, então um dia em dois packs perde o dado nos dois. O
--      teste exige que `rows_shared_with_other_packs` bata AO NÚMERO com o que os
--      outros packs de fato perderam. Se esse aviso mentir, o usuário confirma
--      uma limpeza achando que ela é local.
--   6. GUARD DE ESCOPO — p_pack_id nulo é RECUSADO, não tratado como "tudo".
--   7. IDEMPOTÊNCIA — rodar de novo num pack já limpo é no-op (0 linhas).
--   8. CUSTOM_HIST JUNTO — a coluna das colunas vinculadas também é zerada.
--   9. O TESTE NÃO É VAZIO — exige um pack-alvo com leadscore de verdade e com
--      compartilhamento; num banco vazio ele FALHA em vez de passar à toa.
--
-- COMO RODAR (lab local com o dump restaurado + migrations até a 144 aplicadas):
--   export PATH="/c/Program Files/PostgreSQL/17/bin:$PATH"
--   export PGPASSWORD='lab_hookify_2026'; export PGHOST=127.0.0.1; export PGUSER=hookify_lab
--   psql -d hookify_lab -X -v ON_ERROR_STOP=1 -f supabase/tests/144_limpar_leadscore_importado.test.sql
-- Sai com código 0 e imprime "OK: N asserções". Roda em transação e termina em ROLLBACK.

\set ON_ERROR_STOP on
\pset pager off
BEGIN;

DO $BLOCO$
DECLARE
  v_pack uuid;
  v_uid  uuid;
  v_previa        jsonb;
  v_exec          jsonb;
  v_dentro_antes  int;
  v_dentro_depois int;
  v_fora_antes    int;
  v_fora_depois   int;
  v_outros_antes  int;
  v_outros_depois int;
  v_spend_antes   numeric;
  v_spend_depois  numeric;
  v_custom_antes  int;
  v_custom_depois int;
  v_asserts       int := 0;
BEGIN
  -- ALVO: pack com leadscore de verdade E com dias compartilhados com outro pack,
  -- para que a asserção 5 seja realmente exercitada.
  SELECT apm.pack_id, apm.user_id INTO v_pack, v_uid
  FROM ad_metric_pack_map apm
  JOIN ad_metrics am
    ON am.user_id = apm.user_id AND am.ad_id = apm.ad_id AND am.date = apm.metric_date
  JOIN ad_metric_pack_map o
    ON o.user_id = apm.user_id AND o.ad_id = apm.ad_id
   AND o.metric_date = apm.metric_date AND o.pack_id <> apm.pack_id
  WHERE am.leadscore_values IS NOT NULL
  GROUP BY 1, 2
  ORDER BY count(*) DESC
  LIMIT 1;

  IF v_pack IS NULL THEN
    RAISE EXCEPTION 'TESTE VAZIO: nenhum pack com leadscore compartilhado. Restaure o dump antes de rodar.';
  END IF;

  -- Semear custom_hist em algumas linhas do alvo, para a asserção 8 ter o que provar.
  UPDATE ad_metrics am
  SET custom_hist = '{"m1": {"18-24": 3}}'::jsonb
  WHERE am.user_id = v_uid
    AND am.id IN (SELECT t.id FROM ad_metrics_enrichment_targets(v_uid, v_pack) t LIMIT 25);

  -- ---- Estado ANTES -------------------------------------------------------
  SELECT count(*) FILTER (WHERE am.leadscore_values IS NOT NULL),
         count(*) FILTER (WHERE am.custom_hist IS NOT NULL),
         coalesce(sum(am.spend), 0)
  INTO v_dentro_antes, v_custom_antes, v_spend_antes
  FROM ad_metric_pack_map apm
  JOIN ad_metrics am ON am.user_id = apm.user_id AND am.ad_id = apm.ad_id AND am.date = apm.metric_date
  WHERE apm.pack_id = v_pack;

  SELECT count(*) INTO v_fora_antes FROM ad_metrics am
  WHERE am.leadscore_values IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM ad_metric_pack_map apm
                    WHERE apm.user_id = am.user_id AND apm.ad_id = am.ad_id
                      AND apm.metric_date = am.date AND apm.pack_id = v_pack);

  SELECT count(*) INTO v_outros_antes FROM (
    SELECT DISTINCT am.user_id, am.ad_id, am.date FROM ad_metrics am
    JOIN ad_metric_pack_map o ON o.user_id = am.user_id AND o.ad_id = am.ad_id
                             AND o.metric_date = am.date AND o.pack_id <> v_pack
    WHERE am.leadscore_values IS NOT NULL
  ) x;

  IF v_dentro_antes = 0 OR v_custom_antes = 0 THEN
    RAISE EXCEPTION 'TESTE VAZIO: alvo sem leadscore (%) ou sem custom_hist (%)', v_dentro_antes, v_custom_antes;
  END IF;

  -- ---- 1: prévia conta e não altera ---------------------------------------
  v_previa := clear_ad_metrics_enrichment(v_uid, v_pack, true);

  IF (v_previa->>'rows_cleared')::int <> 0 THEN
    RAISE EXCEPTION 'ASSERT 1 FALHOU: dry_run reportou % linhas limpas', v_previa->>'rows_cleared';
  END IF;
  v_asserts := v_asserts + 1;

  SELECT count(*) FILTER (WHERE am.leadscore_values IS NOT NULL) INTO v_dentro_depois
  FROM ad_metric_pack_map apm
  JOIN ad_metrics am ON am.user_id = apm.user_id AND am.ad_id = apm.ad_id AND am.date = apm.metric_date
  WHERE apm.pack_id = v_pack;
  IF v_dentro_depois <> v_dentro_antes THEN
    RAISE EXCEPTION 'ASSERT 1 FALHOU: dry_run mexeu no banco (% -> %)', v_dentro_antes, v_dentro_depois;
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
    RAISE EXCEPTION 'ASSERT 2 FALHOU: previa dizia % e a execucao limpou %',
      v_previa->>'rows_matched', v_exec->>'rows_cleared';
  END IF;
  v_asserts := v_asserts + 1;

  SELECT count(*) FILTER (WHERE am.leadscore_values IS NOT NULL),
         count(*) FILTER (WHERE am.custom_hist IS NOT NULL),
         coalesce(sum(am.spend), 0)
  INTO v_dentro_depois, v_custom_depois, v_spend_depois
  FROM ad_metric_pack_map apm
  JOIN ad_metrics am ON am.user_id = apm.user_id AND am.ad_id = apm.ad_id AND am.date = apm.metric_date
  WHERE apm.pack_id = v_pack;

  -- 3: dentro zerou
  IF v_dentro_depois <> 0 THEN
    RAISE EXCEPTION 'ASSERT 3 FALHOU: sobraram % linhas com leadscore no pack', v_dentro_depois;
  END IF;
  v_asserts := v_asserts + 1;

  -- 8: custom_hist foi junto
  IF v_custom_depois <> 0 THEN
    RAISE EXCEPTION 'ASSERT 8 FALHOU: sobraram % linhas com custom_hist', v_custom_depois;
  END IF;
  v_asserts := v_asserts + 1;

  -- 4: métrica da Meta intacta
  IF v_spend_depois <> v_spend_antes THEN
    RAISE EXCEPTION 'ASSERT 4 FALHOU: spend mudou (% -> %)', v_spend_antes, v_spend_depois;
  END IF;
  v_asserts := v_asserts + 1;

  -- 3 (escopo): leadscore fora do pack intocado
  SELECT count(*) INTO v_fora_depois FROM ad_metrics am
  WHERE am.leadscore_values IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM ad_metric_pack_map apm
                    WHERE apm.user_id = am.user_id AND apm.ad_id = am.ad_id
                      AND apm.metric_date = am.date AND apm.pack_id = v_pack);
  IF v_fora_depois <> v_fora_antes THEN
    RAISE EXCEPTION 'ASSERT 3 FALHOU: leadscore fora do pack mudou (% -> %)', v_fora_antes, v_fora_depois;
  END IF;
  v_asserts := v_asserts + 1;

  -- 5: o aviso de compartilhamento bate AO NÚMERO com a perda real dos outros packs
  SELECT count(*) INTO v_outros_depois FROM (
    SELECT DISTINCT am.user_id, am.ad_id, am.date FROM ad_metrics am
    JOIN ad_metric_pack_map o ON o.user_id = am.user_id AND o.ad_id = am.ad_id
                             AND o.metric_date = am.date AND o.pack_id <> v_pack
    WHERE am.leadscore_values IS NOT NULL
  ) x;

  IF (v_exec->>'rows_shared_with_other_packs')::int <> (v_outros_antes - v_outros_depois) THEN
    RAISE EXCEPTION 'ASSERT 5 FALHOU: aviso dizia % dias compartilhados, mas outros packs perderam %',
      v_exec->>'rows_shared_with_other_packs', (v_outros_antes - v_outros_depois);
  END IF;
  IF (v_exec->>'rows_shared_with_other_packs')::int = 0 THEN
    RAISE EXCEPTION 'TESTE VAZIO: alvo sem compartilhamento, a assercao 5 nao provou nada';
  END IF;
  v_asserts := v_asserts + 1;

  -- 7: idempotência
  IF (clear_ad_metrics_enrichment(v_uid, v_pack, false)->>'rows_cleared')::int <> 0 THEN
    RAISE EXCEPTION 'ASSERT 7 FALHOU: segunda passada nao foi no-op';
  END IF;
  v_asserts := v_asserts + 1;

  RAISE NOTICE 'OK: % assercoes (pack %, % linhas limpas, % compartilhadas com % outro(s) pack(s))',
    v_asserts, v_pack, v_exec->>'rows_cleared',
    v_exec->>'rows_shared_with_other_packs', v_exec->>'other_packs_affected';
END $BLOCO$;

ROLLBACK;
