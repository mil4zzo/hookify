-- Teste do rollup de performance (migration 128): os triggers de ad_metrics refletem
-- insert, update, upsert, lote, mudança de chave e delete nas tabelas derivadas.
--
-- COMO RODAR (contra um banco com a migration 128 aplicada — o lab local, nunca prod):
--   psql "$LAB_URL" -X -v ON_ERROR_STOP=1 -f supabase/tests/128_rollup_de_performance.test.sql
-- Sai com código 0 e imprime "OK: N asserções" — ou para na primeira asserção que falhar.
-- Tudo roda numa transação e termina em ROLLBACK: não deixa rastro.
--
-- SABOTAGEM (prova de que o teste pega): rode com um dos triggers desabilitado
--   (ALTER TABLE public.ad_metrics DISABLE TRIGGER ad_metrics_rollup_sync_upd;)
-- logo depois do BEGIN — o teste TEM de falhar. Ver supabase/tests/README.md.

\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned
BEGIN;

-- ---------------------------------------------------------------------------
-- Infra do teste (vive em pg_temp: some no ROLLBACK)
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE t_counter (n integer NOT NULL);
INSERT INTO t_counter VALUES (0);

CREATE FUNCTION pg_temp.expect(p_label text, p_got text, p_want text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p_got IS DISTINCT FROM p_want THEN
    RAISE EXCEPTION E'FALHOU: %\n   esperado: %\n   obtido:   %', p_label, p_want, p_got;
  END IF;
  UPDATE t_counter SET n = n + 1;
END $$;

-- Foto da derivada de um (user, ad, dia): texto canônico, ordenado. Desempacota os
-- arrays paralelos como a RPC fará (posição i de um array ↔ posição i do outro).
CREATE FUNCTION pg_temp.conv_of(p_user uuid, p_ad text, p_date date) RETURNS text
LANGUAGE sql AS $$
  SELECT coalesce(string_agg(ck.key || '=' || p.value::text, ', ' ORDER BY ck.key), '<vazio>')
  FROM public.ad_performance_daily d
  CROSS JOIN LATERAL unnest(d.conv_key_ids, d.conv_values) AS p(key_id, value)
  JOIN public.conversion_keys ck ON ck.id = p.key_id
  WHERE d.user_id = p_user AND d.ad_id = p_ad AND d.date = p_date
$$;

CREATE FUNCTION pg_temp.leads_of(p_user uuid, p_ad text, p_date date) RETURNS text
LANGUAGE sql AS $$
  SELECT coalesce(string_agg(p.score::text || 'x' || p.qty, ', ' ORDER BY p.score), '<vazio>')
  FROM public.ad_performance_daily d
  CROSS JOIN LATERAL unnest(d.lead_scores, d.lead_qtys) AS p(score, qty)
  WHERE d.user_id = p_user AND d.ad_id = p_ad AND d.date = p_date
$$;

-- Linha existe? (desde a 129, TODO anúncio-dia tem linha — é o read model completo)
CREATE FUNCTION pg_temp.row_exists(p_user uuid, p_ad text, p_date date) RETURNS text
LANGUAGE sql AS $$
  SELECT (EXISTS (SELECT 1 FROM public.ad_performance_daily d
                  WHERE d.user_id = p_user AND d.ad_id = p_ad AND d.date = p_date))::text
$$;

-- Números derivados (129): spend/impressões/hook, já saneados como a RPC.
CREATE FUNCTION pg_temp.nums_of(p_user uuid, p_ad text, p_date date) RETURNS text
LANGUAGE sql AS $$
  SELECT coalesce(string_agg(d.spend::text || '/' || d.impressions || '/' || trim_scale(d.hook_value)::text || '/' || coalesce(d.ad_name, '<null>'), ''), '<vazio>')
  FROM public.ad_performance_daily d
  WHERE d.user_id = p_user AND d.ad_id = p_ad AND d.date = p_date
$$;

-- Usuário sintético: nunca colide com dados reais.
\set U '''00000000-0000-4000-8000-000000000128''::uuid'
DELETE FROM public.ad_metrics WHERE user_id = :U;

-- ---------------------------------------------------------------------------
-- A. INSERT simples
-- ---------------------------------------------------------------------------
INSERT INTO public.ad_metrics (id, user_id, ad_id, date, spend, actions, conversions, leadscore_values)
VALUES (
  '2026-01-01-T1', :U, 'T1', '2026-01-01', 10,
  '[{"action_type":"link_click","value":"3"},{"action_type":"link_click","value":"2"},{"action_type":"lead","value":"1.5"}]',
  '[{"action_type":"purchase","value":"7"}]',
  '{80,80,90}'
);
SELECT pg_temp.expect('A conv: soma por chave, dois prefixos',
  pg_temp.conv_of(:U, 'T1', '2026-01-01'),
  'action:lead=1.5, action:link_click=5, conversion:purchase=7');
SELECT pg_temp.expect('A leads: histograma',
  pg_temp.leads_of(:U, 'T1', '2026-01-01'), '80x2, 90x1');
SELECT pg_temp.expect('A números (129): spend, impressões null→0, hook sem curva=0, ad_name null',
  pg_temp.nums_of(:U, 'T1', '2026-01-01'), '10/0/0/<null>');

-- ---------------------------------------------------------------------------
-- B. UPDATE de coluna-fonte (actions) recomputa; o que sumiu do JSON some da derivada
-- ---------------------------------------------------------------------------
UPDATE public.ad_metrics SET actions = '[{"action_type":"link_click","value":"10"}]'
WHERE user_id = :U AND ad_id = 'T1' AND date = '2026-01-01';
SELECT pg_temp.expect('B conv após update de actions',
  pg_temp.conv_of(:U, 'T1', '2026-01-01'), 'action:link_click=10, conversion:purchase=7');
SELECT pg_temp.expect('B leads intocados', pg_temp.leads_of(:U, 'T1', '2026-01-01'), '80x2, 90x1');

-- ---------------------------------------------------------------------------
-- C. UPDATE de número (spend) e de coluna que NÃO é fonte (updated_at)
-- ---------------------------------------------------------------------------
UPDATE public.ad_metrics SET spend = 99, hook_rate = 0.42, ad_name = 'Criativo X'
WHERE user_id = :U AND ad_id = 'T1' AND date = '2026-01-01';
SELECT pg_temp.expect('C números seguem a fonte', pg_temp.nums_of(:U, 'T1', '2026-01-01'), '99/0/0.42/Criativo X');
SELECT pg_temp.expect('C conv intocada', pg_temp.conv_of(:U, 'T1', '2026-01-01'), 'action:link_click=10, conversion:purchase=7');
SELECT pg_temp.expect('C leads intocados', pg_temp.leads_of(:U, 'T1', '2026-01-01'), '80x2, 90x1');
UPDATE public.ad_metrics SET updated_at = now() WHERE user_id = :U AND ad_id = 'T1' AND date = '2026-01-01';
SELECT pg_temp.expect('C updated_at não muda nada', pg_temp.nums_of(:U, 'T1', '2026-01-01'), '99/0/0.42/Criativo X');

-- ---------------------------------------------------------------------------
-- D. UPDATE só de leadscore_values (o caminho do sync de planilha:
--    batch_update_ad_metrics_enrichment faz UPDATE ... SET leadscore_values = ...)
-- ---------------------------------------------------------------------------
UPDATE public.ad_metrics SET leadscore_values = '{90}' WHERE user_id = :U AND ad_id = 'T1' AND date = '2026-01-01';
SELECT pg_temp.expect('D leads após sync', pg_temp.leads_of(:U, 'T1', '2026-01-01'), '90x1');
SELECT pg_temp.expect('D conv intocada', pg_temp.conv_of(:U, 'T1', '2026-01-01'), 'action:link_click=10, conversion:purchase=7');

-- ---------------------------------------------------------------------------
-- E. UPSERT no formato que o PostgREST gera (on_conflict=id,user_id) — o refresh de pack
-- ---------------------------------------------------------------------------
INSERT INTO public.ad_metrics (id, user_id, ad_id, date, spend, actions, conversions, leadscore_values)
VALUES ('2026-01-01-T1', :U, 'T1', '2026-01-01', 12,
        '[{"action_type":"link_click","value":"10"}]',
        '[{"action_type":"purchase","value":"1"},{"action_type":"lead","value":"2"}]',
        '{90}')
ON CONFLICT (id, user_id) DO UPDATE SET
  spend = EXCLUDED.spend, actions = EXCLUDED.actions, conversions = EXCLUDED.conversions,
  leadscore_values = EXCLUDED.leadscore_values;
SELECT pg_temp.expect('E conv após upsert',
  pg_temp.conv_of(:U, 'T1', '2026-01-01'), 'action:link_click=10, conversion:lead=2, conversion:purchase=1');
SELECT pg_temp.expect('E leads após upsert (iguais → continuam)', pg_temp.leads_of(:U, 'T1', '2026-01-01'), '90x1');

-- ---------------------------------------------------------------------------
-- F. LOTE num único statement, com casos de borda: JSON que não é array, array vazio,
--    elemento sem action_type, valor com lixo, leads nulos
-- ---------------------------------------------------------------------------
INSERT INTO public.ad_metrics (id, user_id, ad_id, date, actions, conversions, leadscore_values) VALUES
  ('2026-01-02-T2', :U, 'T2', '2026-01-02', '{"nao":"array"}', '[]', NULL),
  ('2026-01-02-T3', :U, 'T3', '2026-01-02', '[{"value":"5"},{"action_type":"","value":"5"},{"action_type":"comment","value":"R$ 1.234"}]', 'null', '{}'),
  ('2026-01-02-T4', :U, 'T4', '2026-01-02', '[{"action_type":"video_view","value":"1"}]', '[{"action_type":"lead","value":"1-2"}]', '{50,50,50,261}');
SELECT pg_temp.expect('F T2: não-array = nada', pg_temp.conv_of(:U, 'T2', '2026-01-02'), '<vazio>');
SELECT pg_temp.expect('F T2: leads null = nada', pg_temp.leads_of(:U, 'T2', '2026-01-02'), '<vazio>');
SELECT pg_temp.expect('F T2: sem evento e sem lead ainda tem linha (read model completo, 129)', pg_temp.row_exists(:U, 'T2', '2026-01-02'), 'true');
SELECT pg_temp.expect('F T3: sem action_type ignorado; "R$ 1.234" → 1.234',
  pg_temp.conv_of(:U, 'T3', '2026-01-02'), 'action:comment=1.234');
SELECT pg_temp.expect('F T4: valor inválido conta 0 em vez de estourar',
  pg_temp.conv_of(:U, 'T4', '2026-01-02'), 'action:video_view=1, conversion:lead=0');
SELECT pg_temp.expect('F T4: leads', pg_temp.leads_of(:U, 'T4', '2026-01-02'), '50x3, 261x1');

-- Lote de UPDATE também (um statement, várias linhas, só uma muda de fato)
UPDATE public.ad_metrics SET actions = CASE WHEN ad_id = 'T4' THEN '[{"action_type":"video_view","value":"2"}]'::jsonb ELSE actions END
WHERE user_id = :U AND date = '2026-01-02';
SELECT pg_temp.expect('F update em lote: T4 recomputado', pg_temp.conv_of(:U, 'T4', '2026-01-02'), 'action:video_view=2, conversion:lead=0');
SELECT pg_temp.expect('F update em lote: T3 intacto', pg_temp.conv_of(:U, 'T3', '2026-01-02'), 'action:comment=1.234');

-- Esvaziar todas as fontes de uma linha apaga a linha derivada
UPDATE public.ad_metrics SET actions = '[]', conversions = '[]', leadscore_values = NULL
WHERE user_id = :U AND ad_id = 'T3' AND date = '2026-01-02';
SELECT pg_temp.expect('F T3 esvaziado: arrays vazios, linha continua', pg_temp.conv_of(:U, 'T3', '2026-01-02') || '|' || pg_temp.leads_of(:U, 'T3', '2026-01-02') || '|' || pg_temp.row_exists(:U, 'T3', '2026-01-02'), '<vazio>|<vazio>|true');

-- ---------------------------------------------------------------------------
-- G. Mudança da CHAVE (date) segue pela FK ON UPDATE CASCADE, sem recomputar
-- ---------------------------------------------------------------------------
UPDATE public.ad_metrics SET date = '2026-01-03' WHERE user_id = :U AND ad_id = 'T4' AND date = '2026-01-02';
SELECT pg_temp.expect('G chave antiga vazia', pg_temp.conv_of(:U, 'T4', '2026-01-02'), '<vazio>');
SELECT pg_temp.expect('G chave nova com as derivadas', pg_temp.conv_of(:U, 'T4', '2026-01-03'), 'action:video_view=2, conversion:lead=0');
SELECT pg_temp.expect('G leads seguiram', pg_temp.leads_of(:U, 'T4', '2026-01-03'), '50x3, 261x1');

-- ---------------------------------------------------------------------------
-- H. DELETE propaga (FK ON DELETE CASCADE) — o caminho de supabase_repo (delete por id)
-- ---------------------------------------------------------------------------
DELETE FROM public.ad_metrics WHERE id = '2026-01-01-T1' AND user_id = :U;
SELECT pg_temp.expect('H conv após delete', pg_temp.conv_of(:U, 'T1', '2026-01-01'), '<vazio>');
SELECT pg_temp.expect('H leads após delete', pg_temp.leads_of(:U, 'T1', '2026-01-01'), '<vazio>');

-- ---------------------------------------------------------------------------
-- I. Consistency check do usuário: zero linhas
-- ---------------------------------------------------------------------------
SELECT pg_temp.expect('I consistency_check(user) vazio',
  (SELECT count(*)::text FROM public.ad_performance_rollup_consistency_check(:U)), '0');

-- ... e a checagem PEGA divergência: corrompe uma derivada à mão e espera 1 linha.
UPDATE public.ad_performance_daily SET lead_qtys[1] = lead_qtys[1] + 1 WHERE user_id = :U AND ad_id = 'T4';
SELECT pg_temp.expect('I consistency_check acusa corrupção',
  (SELECT count(*)::text FROM public.ad_performance_rollup_consistency_check(:U)), '1');

-- ... e o rebuild conserta.
SELECT public.ad_performance_rollup_rebuild(:U) AS rebuild_result \gset
SELECT pg_temp.expect('I rebuild conserta',
  (SELECT count(*)::text FROM public.ad_performance_rollup_consistency_check(:U)), '0');
SELECT pg_temp.expect('I rebuild reproduz o mesmo conteúdo', pg_temp.leads_of(:U, 'T4', '2026-01-03'), '50x3, 261x1');

-- ---------------------------------------------------------------------------
-- J. Dicionário: chave repetida não duplica; formato validado
-- ---------------------------------------------------------------------------
SELECT pg_temp.expect('J dicionário sem duplicata',
  (SELECT count(*)::text FROM public.conversion_keys WHERE key = 'action:video_view'), '1');

\set QUIET off
SELECT 'OK: ' || n || ' asserções' AS resultado FROM t_counter;
ROLLBACK;
