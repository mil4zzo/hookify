-- Teste da 167: as pecas do recorte de periodo de um pack.
--
-- Sabotagens que TEM de fazer este teste falhar:
--   1. Tirar "and pack_id = p_pack" de qualquer funcao        -> falha em B (pack vizinho mexido)
--   2. Deixar pack_trim_head aceitar p_keys vazio             -> falha em E
--   3. Trocar greatest/least no clamp por least/greatest      -> falha em C
--   4. Fazer pack_prune_ad_ids ignorar o inventario           -> falha em D1 (ad4 so tem intervalo)
--   5. pack_recompute_conversion_types virar union monotonico -> falha em F
\set ON_ERROR_STOP on
\timing off
BEGIN;

CREATE FUNCTION pg_temp.expect(rotulo text, obtido text, esperado text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF obtido IS DISTINCT FROM esperado THEN
    RAISE EXCEPTION 'FALHOU %: obtido=% esperado=%', rotulo, obtido, esperado;
  END IF;
END $$;

-- Dono real do laboratorio, para as FKs existirem.
CREATE TEMP TABLE t_dono AS SELECT user_id FROM public.packs GROUP BY 1 ORDER BY count(*) DESC LIMIT 1;

-- DOIS packs sinteticos do mesmo dono: A e o alvo do recorte, B e a testemunha
-- (desde a 145 cada pack tem as proprias linhas; nada em A pode tocar B).
INSERT INTO public.packs (id, user_id, name, level, adaccount_id, date_start, date_stop, ad_ids, conversion_types)
SELECT '00000000-0000-4000-8000-000000000167'::uuid, user_id, 'lab 167 A', 'ad', 'act_lab167',
       date '2026-01-01', date '2026-01-31', ARRAY['ad1','ad2','ad3','ad4'], ARRAY[]::text[] FROM t_dono;
INSERT INTO public.packs (id, user_id, name, level, adaccount_id, date_start, date_stop, ad_ids, conversion_types)
SELECT '00000000-0000-4000-8000-000000000168'::uuid, user_id, 'lab 167 B', 'ad', 'act_lab167',
       date '2026-01-01', date '2026-01-31', ARRAY['ad1'], ARRAY[]::text[] FROM t_dono;

-- Metricas: ad1 em 01, 05, 10, 20; ad2 so em 01 (sai no corte); ad3 so em 20.
-- 'lento' so aparece no dia 01 -> tem de sumir do conversion_types apos o corte.
INSERT INTO public.ad_metrics (id, user_id, pack_id, ad_id, date, account_id, spend, impressions, conversions, actions)
SELECT d.dia::text || '-' || a.ad, t.user_id, '00000000-0000-4000-8000-000000000167'::uuid, a.ad, d.dia,
       'act_lab167', 100, 10,
       CASE WHEN d.dia = date '2026-01-01' THEN '[{"action_type":"lento","value":1}]'::jsonb
            ELSE '[{"action_type":"rapido","value":2}]'::jsonb END,
       '[{"action_type":"click","value":3}]'::jsonb
FROM t_dono t,
     (VALUES ('ad1', date '2026-01-01'), ('ad1', date '2026-01-05'), ('ad1', date '2026-01-10'),
             ('ad1', date '2026-01-20'), ('ad2', date '2026-01-01'), ('ad3', date '2026-01-20')) a(ad, dia_ignorada)
     CROSS JOIN LATERAL (SELECT a.dia_ignorada AS dia) d
;
INSERT INTO public.ad_metric_pack_map (user_id, pack_id, ad_id, metric_date)
SELECT user_id, pack_id, ad_id, date FROM public.ad_metrics
WHERE pack_id = '00000000-0000-4000-8000-000000000167'::uuid;

-- Testemunha: o pack B tem o MESMO anuncio-dia que o A no dia 01.
INSERT INTO public.ad_metrics (id, user_id, pack_id, ad_id, date, account_id, spend, impressions, conversions, actions)
SELECT '2026-01-01-ad1', user_id, '00000000-0000-4000-8000-000000000168'::uuid, 'ad1', date '2026-01-01',
       'act_lab167', 999, 99, '[{"action_type":"lento","value":1}]'::jsonb, '[]'::jsonb FROM t_dono;
INSERT INTO public.ad_metric_pack_map (user_id, pack_id, ad_id, metric_date)
SELECT user_id, '00000000-0000-4000-8000-000000000168'::uuid, 'ad1', date '2026-01-01' FROM t_dono;

-- Inventario do A: ad1 de 01 a 20; ad2 so 01..02 (some); ad3 15..20 (encolhe).
INSERT INTO public.ad_pack_inventory (user_id, pack_id, ad_id, first_active_date, last_active_date)
SELECT user_id, '00000000-0000-4000-8000-000000000167'::uuid, v.ad, v.pri, v.ult FROM t_dono,
  (VALUES ('ad1', date '2026-01-01', date '2026-01-20'),
          ('ad2', date '2026-01-01', date '2026-01-02'),
          ('ad3', date '2026-01-15', date '2026-01-20'),
          -- ad4 existe SO no inventario, dentro da janela nova: e o anuncio
          -- entregavel sem entrega do F5. Se o prune olhar so ad_metrics, ele
          -- some do pack — e a tela para de mostrar um anuncio que existe.
          ('ad4', date '2026-01-15', date '2026-01-20')) v(ad, pri, ult);
-- Testemunha tambem no inventario, com intervalo que o corte de A destruiria se
-- alguma funcao esquecesse o filtro por pack.
INSERT INTO public.ad_pack_inventory (user_id, pack_id, ad_id, first_active_date, last_active_date)
SELECT user_id, '00000000-0000-4000-8000-000000000168'::uuid, 'ad1', date '2026-01-01', date '2026-01-02' FROM t_dono;

-- ── A. PREVIA: o que sai ao passar a comecar em 10/01 ──────────────────────
SELECT pg_temp.expect('A1 dias que saem',
  (SELECT dias::text FROM public.pack_trim_preview((SELECT user_id FROM t_dono),
     '00000000-0000-4000-8000-000000000167'::uuid, date '2026-01-10', date '2026-01-31')), '2');
SELECT pg_temp.expect('A2 investimento que sai',
  (SELECT investimento::text FROM public.pack_trim_preview((SELECT user_id FROM t_dono),
     '00000000-0000-4000-8000-000000000167'::uuid, date '2026-01-10', date '2026-01-31')), '300');

-- ── B. CORTE POR PERIODO: apaga so o pack A ────────────────────────────────
DELETE FROM public.ad_metrics
 WHERE user_id = (SELECT user_id FROM t_dono)
   AND pack_id = '00000000-0000-4000-8000-000000000167'::uuid
   AND date < date '2026-01-10';

SELECT pg_temp.expect('B1 linhas restantes em A',
  (SELECT count(*)::text FROM public.ad_metrics WHERE pack_id = '00000000-0000-4000-8000-000000000167'::uuid), '3');
SELECT pg_temp.expect('B2 pack vizinho INTACTO',
  (SELECT count(*)::text FROM public.ad_metrics WHERE pack_id = '00000000-0000-4000-8000-000000000168'::uuid), '1');
SELECT pg_temp.expect('B3 mapa caiu por cascata',
  (SELECT count(*)::text FROM public.ad_metric_pack_map
    WHERE pack_id = '00000000-0000-4000-8000-000000000167'::uuid AND metric_date < date '2026-01-10'), '0');
SELECT pg_temp.expect('B4 rollup caiu por cascata',
  (SELECT count(*)::text FROM public.ad_performance_daily
    WHERE pack_id = '00000000-0000-4000-8000-000000000167'::uuid AND date < date '2026-01-10'), '0');

-- ── C. INVENTARIO: encolhe, apaga o que nao cruza mais, nao toca no vizinho ─
SELECT pg_temp.expect('C1 ajustados/removidos',
  (SELECT ajustados || '/' || removidos FROM public.pack_clamp_inventory((SELECT user_id FROM t_dono),
     '00000000-0000-4000-8000-000000000167'::uuid, date '2026-01-10', date '2026-01-31')), '1/1');
SELECT pg_temp.expect('C2 ad2 saiu do inventario',
  (SELECT count(*)::text FROM public.ad_pack_inventory
    WHERE pack_id = '00000000-0000-4000-8000-000000000167'::uuid AND ad_id = 'ad2'), '0');
SELECT pg_temp.expect('C4b ad4 (so inventario) sobrevive ao clamp',
  (SELECT count(*)::text FROM public.ad_pack_inventory
    WHERE pack_id = '00000000-0000-4000-8000-000000000167'::uuid AND ad_id = 'ad4'), '1');
SELECT pg_temp.expect('C3 ad1 comeca no novo inicio',
  (SELECT first_active_date::text FROM public.ad_pack_inventory
    WHERE pack_id = '00000000-0000-4000-8000-000000000167'::uuid AND ad_id = 'ad1'), '2026-01-10');
SELECT pg_temp.expect('C4 ad3 intocado (ja estava dentro)',
  (SELECT first_active_date::text FROM public.ad_pack_inventory
    WHERE pack_id = '00000000-0000-4000-8000-000000000167'::uuid AND ad_id = 'ad3'), '2026-01-15');
SELECT pg_temp.expect('C5 inventario do vizinho INTACTO',
  (SELECT first_active_date::text || '..' || last_active_date::text FROM public.ad_pack_inventory
    WHERE pack_id = '00000000-0000-4000-8000-000000000168'::uuid), '2026-01-01..2026-01-02');

-- ── D. ad_ids: sai quem ficou sem dia E sem intervalo ──────────────────────
SELECT pg_temp.expect('D1 devolve quem saiu',
  (SELECT array_to_string(public.pack_prune_ad_ids((SELECT user_id FROM t_dono),
     '00000000-0000-4000-8000-000000000167'::uuid), ',')), 'ad2');
SELECT pg_temp.expect('D2 ad_ids do pack agora (ad4 fica: existe no inventario)',
  (SELECT array_to_string(ad_ids, ',') FROM public.packs WHERE id = '00000000-0000-4000-8000-000000000167'::uuid), 'ad1,ad3,ad4');

-- ── E. CABECA: ausencia so apaga aqui, e nunca com lista vazia ─────────────
-- Cabeca 10..10: a busca devolveu so (ad1, 10). Nao ha outro par nesse dia.
SELECT pg_temp.expect('E1 cabeca sem sobra',
  public.pack_trim_head((SELECT user_id FROM t_dono), '00000000-0000-4000-8000-000000000167'::uuid,
    date '2026-01-10', date '2026-01-10', '[["ad1","2026-01-10"]]'::jsonb)::text, '0');
-- Agora a busca NAO trouxe (ad1, 10): a linha sai.
SELECT pg_temp.expect('E2 par ausente sai',
  public.pack_trim_head((SELECT user_id FROM t_dono), '00000000-0000-4000-8000-000000000167'::uuid,
    date '2026-01-10', date '2026-01-10', '[["ad9","2026-01-10"]]'::jsonb)::text, '1');
-- Fora da cabeca nada foi tocado (dia 20 continua com 2 linhas).
SELECT pg_temp.expect('E3 fora da cabeca intacto',
  (SELECT count(*)::text FROM public.ad_metrics
    WHERE pack_id = '00000000-0000-4000-8000-000000000167'::uuid AND date = date '2026-01-20'), '2');
-- Lista vazia e recusada (seria apagar a cabeca inteira).
DO $$
BEGIN
  PERFORM public.pack_trim_head((SELECT user_id FROM public.packs WHERE id='00000000-0000-4000-8000-000000000167'),
    '00000000-0000-4000-8000-000000000167'::uuid, date '2026-01-20', date '2026-01-20', '[]'::jsonb);
  RAISE EXCEPTION 'FALHOU E4: p_keys vazio foi aceito';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM LIKE 'FALHOU E4%' THEN RAISE; END IF;
END $$;

-- ── F. conversion_types: some o tipo que so existia nos dias removidos ─────
SELECT pg_temp.expect('F1 recalculo',
  (SELECT array_to_string(public.pack_recompute_conversion_types((SELECT user_id FROM t_dono),
     '00000000-0000-4000-8000-000000000167'::uuid), ',')), 'action:click,conversion:rapido');
SELECT pg_temp.expect('F2 vizinho nao perdeu o dele',
  (SELECT count(*)::text FROM public.ad_metrics
    WHERE pack_id = '00000000-0000-4000-8000-000000000168'::uuid
      AND conversions @> '[{"action_type":"lento"}]'::jsonb), '1');

SELECT 'OK: 18 asserções' AS resultado;
ROLLBACK;
