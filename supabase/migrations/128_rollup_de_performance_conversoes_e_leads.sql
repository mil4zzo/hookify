-- 128: rollup de performance — conversões e leads pré-computados por anúncio-dia.
--
-- O PROBLEMA (medido em 2026-08-26, plano em documentation/plano-rollup-rankings.md)
-- -----------------------------------------------------------------------------------
-- Uma carga do Manager custa ~3,3 s de CPU do banco e 470 MB de arquivos temporários
-- para devolver 77 linhas. A RPC lê `select am.*` (linha média de 995 B, 40% em JSON),
-- abre `actions`/`conversions` elemento a elemento em TODA leitura e explode
-- `leadscore_values` com `unnest` para depois reconcatenar por grupo. Ou seja: calcula
-- na leitura o que só muda na escrita (refresh de pack, sync de planilha).
--
-- O DESENHO
-- ---------
-- `ad_metrics` continua sendo a fonte da verdade e não muda. Esta migration cria UMA
-- tabela DERIVADA, estreita, mantida por trigger, com uma linha por anúncio-dia:
--
--   ad_metrics ──trigger──► ad_performance_daily (user, ad, dia,
--                              conv_key_ids int[]  ‖ conv_values numeric[],   ← pares paralelos
--                              lead_scores numeric[] ‖ lead_qtys int[])       ← histograma
--
-- e um dicionário `conversion_keys` (chave text ↔ id integer): 'action:link_click' tem
-- 31 bytes em média; no array cabe em 4.
--
-- POR QUE ARRAYS, E NÃO UMA LINHA POR (anúncio, dia, chave)
-- ---------------------------------------------------------
-- A primeira versão desta migration (nunca aplicada em produção) tinha uma linha por
-- chave: 1,95 M linhas = 352 MB no lab — o cabeçalho fixo do Postgres (23 B na heap +
-- 4 B de line pointer + 8 B por entrada de índice) pesava mais que o dado. Uma linha
-- por anúncio-dia com arrays carrega a MESMA informação em 164.661 linhas = 61 MB
-- (48 MB de heap + 13 MB de PK), 6,4× menos. Na leitura, achar a chave pedida é
-- `conv_values[array_position(conv_key_ids, id)]` sobre um array de ~7 inteiros — sem
-- JSON, sem regexp, sem unnest.
--
-- CUSTO DE ESCRITA (lab, lote de 500 linhas reais): upsert com JSON alterado 28 ms →
-- 171 ms (+0,29 ms/linha); upsert idêntico 52 ms (nada recomputado); insert 125 ms;
-- delete com cascade 15 ms. Num refresh de 120 mil linhas: ~35 s a mais num processo
-- de minutos. Backfill completo dos 5 usuários: ~2,3 min no lab.
--
-- A RPC nova (migration 129) faz `left join ad_performance_daily` pela chave
-- (user, ad, dia) que ela já usa para ad_metrics. Rollback = repontar a entry para a
-- base anterior; a derivada pode ficar (só espaço) ou cair (`DROP ... CASCADE`).
--
-- POR QUE TRIGGER, E NÃO CÓDIGO PYTHON
-- ------------------------------------
-- `ad_metrics` tem 4 escritores: 2 upserts em supabase_repo.py, 1 delete, e a RPC SQL
-- `batch_update_ad_metrics_enrichment` (sync de leadscore). Só o trigger cobre todos —
-- inclusive os futuros — sem ninguém precisar lembrar. É POR STATEMENT com tabela de
-- transição: um upsert de 500 linhas custa 1 DELETE + 2 INSERTs, não 1.500 comandos.
-- No UPDATE só entram linhas cujas colunas-fonte mudaram de fato. Delete e mudança de
-- chave em ad_metrics propagam por FK (CASCADE).
--
-- SEMÂNTICA (idêntica à RPC atual, provada pelo teste diferencial da fase C)
-- --------------------------------------------------------------------------
-- - chave = 'conversion:'||action_type (de `conversions`) ou 'action:'||action_type
--   (de `actions`); elemento sem action_type é ignorado; JSON que não é array = vazio.
-- - valor = regexp_replace(value, '[^0-9.-]', '') ::numeric, somado por chave.
--   Diferença deliberada: valor que NÃO vira número (ex.: '1-2') conta 0 aqui, onde a
--   RPC estouraria a leitura inteira. Medido: zero ocorrências em 1,95 M elementos.
-- - leads: histograma score → quantidade. Medido: 403 mil scores, zero nulos, zero
--   não-inteiros, 30 distintos. `lead_scores` é numeric[] mesmo assim (sem perda se
--   um dia vier 7.5); a RPC normaliza a chave do histograma com trim_scale().
-- - anúncio-dia sem evento e sem lead NÃO tem linha (left join → vazio).
--
-- FATOS MEDIDOS NO DUMP DE 2026-08-26 (lab local)
-- -----------------------------------------------
-- 260.709 linhas em ad_metrics → 1.952.605 pares (chave, valor) (6,7 por linha, não
-- 70) + 212.024 pares (score, qty); 81 chaves distintas; nenhum action_type repetido
-- dentro do mesmo array (SUM e "primeiro" dariam o mesmo — SUM é o que a RPC faz).
--
-- O BACKFILL NÃO ESTÁ AQUI, de propósito: roda por usuário via psql direto com
-- supabase/scripts/backfill_128_rollup_de_performance.sql (lotes de até 122 mil
-- linhas — fora do statement_timeout do PostgREST). Esta migration só cria o
-- mecanismo; até o backfill rodar, a tabela fica vazia e NADA a lê.

-- ============================================================================
-- 1. Dicionário de chaves
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.conversion_keys (
  id   integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  key  text NOT NULL UNIQUE
    CHECK (key ~ '^(conversion|action):.+$')
);

COMMENT ON TABLE public.conversion_keys IS
'Dicionário append-only das chaves de evento ("conversion:<action_type>" / "action:<action_type>", o MESMO formato de p_action_type e de packs.conversion_types). Referenciado por id em ad_performance_daily.conv_key_ids (migration 128). Nunca apagar linhas: ids são referenciados sem FK (custo de escrita).';

-- ============================================================================
-- 2. Tabela derivada
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.ad_performance_daily (
  user_id      uuid      NOT NULL,
  ad_id        text      NOT NULL,
  date         date      NOT NULL,
  -- pares paralelos, ordenados por key_id: conv_values[i] é o valor de conv_key_ids[i]
  conv_key_ids integer[] NOT NULL DEFAULT '{}',
  conv_values  numeric[] NOT NULL DEFAULT '{}',
  -- pares paralelos, ordenados por score: lead_qtys[i] é quantas vezes lead_scores[i] aparece
  lead_scores  numeric[] NOT NULL DEFAULT '{}',
  lead_qtys    integer[] NOT NULL DEFAULT '{}',
  CONSTRAINT ad_performance_daily_pkey PRIMARY KEY (user_id, ad_id, date),
  CONSTRAINT ad_performance_daily_metric_fk
    FOREIGN KEY (user_id, ad_id, date)
    REFERENCES public.ad_metrics (user_id, ad_id, date)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT ad_performance_daily_pairs_chk CHECK (
    cardinality(conv_key_ids) = cardinality(conv_values)
    AND cardinality(lead_scores) = cardinality(lead_qtys)
    AND (cardinality(conv_key_ids) > 0 OR cardinality(lead_scores) > 0)
  )
);

COMMENT ON TABLE public.ad_performance_daily IS
'DERIVADA de ad_metrics (migration 128), uma linha por anúncio-dia que tenha evento ou lead: conversões/ações somadas por chave (arrays paralelos conv_key_ids/conv_values, chave → conversion_keys.id) e histograma de leadscore (lead_scores/lead_qtys). Mantida pelos triggers ad_metrics_rollup_sync_ins/_upd; delete/mudança de chave em ad_metrics propagam por FK. Reconstruível com ad_performance_rollup_rebuild(user_id). NÃO escrever aqui à mão.';

-- RLS: a derivada herda o silo de ad_metrics. Só leitura para o cliente; a escrita é
-- exclusiva do trigger/rebuild (SECURITY DEFINER, dono da tabela). O dicionário não
-- tem dado de usuário.
ALTER TABLE public.conversion_keys      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_performance_daily ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conversion_keys_read_all ON public.conversion_keys;
CREATE POLICY conversion_keys_read_all ON public.conversion_keys
  FOR SELECT USING (true);

DROP POLICY IF EXISTS ad_performance_daily_read_own ON public.ad_performance_daily;
CREATE POLICY ad_performance_daily_read_own ON public.ad_performance_daily
  FOR SELECT USING (user_id = (SELECT auth.uid()));

GRANT SELECT ON public.conversion_keys, public.ad_performance_daily TO authenticated;
GRANT ALL    ON public.conversion_keys, public.ad_performance_daily TO service_role;

-- ============================================================================
-- 3. Derivação — UMA fonte de verdade, usada pelo trigger, pelo rebuild e pela checagem
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ad_performance_parse_value(p_raw text)
RETURNS numeric
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
SET search_path TO 'public'
AS $$
  -- Mesmo saneamento da RPC (regexp_replace '[^0-9.-]'), mas nunca estoura: o que não
  -- vira número conta 0. Uma linha ruim não pode derrubar o upsert de um lote inteiro.
  select case
    when cleaned ~ '^-?([0-9]+\.?[0-9]*|\.[0-9]+)$' then cleaned::numeric
    else 0::numeric
  end
  from (select regexp_replace(coalesce(p_raw, '0'), '[^0-9.-]', '', 'g') as cleaned) s
$$;

COMMENT ON FUNCTION public.ad_performance_parse_value(text) IS
'Saneia o campo value dos itens de actions/conversions como a RPC do Manager faz (só [0-9.-]); inválido → 0 em vez de erro (migration 128).';

CREATE OR REPLACE FUNCTION public.ad_performance_derive_conversions(p_actions jsonb, p_conversions jsonb)
RETURNS TABLE (key text, value numeric)
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path TO 'public'
AS $$
  -- Um par (chave, valor somado) por action_type presente. Chave no formato de
  -- p_action_type. Elemento sem action_type é ignorado; JSON que não é array = vazio.
  select k.key, sum(k.value)
  from (
    select 'conversion:' || nullif(elem ->> 'action_type', '') as key,
           public.ad_performance_parse_value(elem ->> 'value')  as value
    from jsonb_array_elements(case when jsonb_typeof(p_conversions) = 'array' then p_conversions else '[]'::jsonb end) elem
    union all
    select 'action:' || nullif(elem ->> 'action_type', ''),
           public.ad_performance_parse_value(elem ->> 'value')
    from jsonb_array_elements(case when jsonb_typeof(p_actions) = 'array' then p_actions else '[]'::jsonb end) elem
  ) k
  where k.key is not null
  group by k.key
$$;

COMMENT ON FUNCTION public.ad_performance_derive_conversions(jsonb, jsonb) IS
'Fonte única da derivação de conversões/ações a partir de uma linha de ad_metrics (migration 128): (chave, valor somado). Trigger, rebuild e consistency_check usam esta função — mudar a semântica aqui muda em todos.';

CREATE OR REPLACE FUNCTION public.ad_performance_derive_leads(p_values numeric[])
RETURNS TABLE (score numeric, qty integer)
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path TO 'public'
AS $$
  select v as score, count(*)::integer as qty
  from unnest(coalesce(p_values, '{}'::numeric[])) v
  where v is not null
  group by v
$$;

COMMENT ON FUNCTION public.ad_performance_derive_leads(numeric[]) IS
'Fonte única da derivação do histograma de leadscore (score → quantidade) a partir de leadscore_values (migration 128).';

-- A linha derivada COMPLETA de uma linha de ad_metrics, já nos arrays paralelos e na
-- ordem canônica (por key_id / por score). Devolve zero linhas quando não há nada a
-- guardar. Pressupõe que as chaves já existem no dicionário (o chamador garante).
CREATE OR REPLACE FUNCTION public.ad_performance_derive_row(p_actions jsonb, p_conversions jsonb, p_leadscore_values numeric[])
RETURNS TABLE (conv_key_ids integer[], conv_values numeric[], lead_scores numeric[], lead_qtys integer[])
LANGUAGE sql STABLE PARALLEL SAFE
SET search_path TO 'public'
AS $$
  with c as (
    select ck.id, d.value
    from public.ad_performance_derive_conversions(p_actions, p_conversions) d
    join public.conversion_keys ck on ck.key = d.key
  ),
  l as (
    select score, qty from public.ad_performance_derive_leads(p_leadscore_values)
  ),
  packed as (
    select
      (select coalesce(array_agg(id    order by id), '{}') from c) as conv_key_ids,
      (select coalesce(array_agg(value order by id), '{}') from c) as conv_values,
      (select coalesce(array_agg(score order by score), '{}') from l) as lead_scores,
      (select coalesce(array_agg(qty   order by score), '{}') from l) as lead_qtys
  )
  select * from packed
  where cardinality(conv_key_ids) > 0 or cardinality(lead_scores) > 0
$$;

COMMENT ON FUNCTION public.ad_performance_derive_row(jsonb, jsonb, numeric[]) IS
'Empacota a derivação de uma linha de ad_metrics nos arrays paralelos de ad_performance_daily, na ordem canônica (migration 128). Zero linhas = nada a guardar.';

-- ============================================================================
-- 4. Worker + triggers por statement em ad_metrics
-- ============================================================================

-- Chave de uma linha de ad_metrics (a chave única ad_metrics_user_ad_date_key).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ad_metric_key' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public.ad_metric_key AS (user_id uuid, ad_id text, date date);
  END IF;
END $$;

-- O worker: recomputa a derivada das chaves recebidas. Relê ad_metrics pela chave (o
-- trigger é AFTER, a linha já está visível) — uma busca por índice por linha, nada
-- perto do custo de abrir o JSON. Um único código para INSERT, UPDATE e reparo.
CREATE OR REPLACE FUNCTION public.ad_performance_rollup_apply(p_keys public.ad_metric_key[])
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF p_keys IS NULL OR cardinality(p_keys) = 0 THEN
    RETURN;
  END IF;

  -- Apaga-e-reinsere por chave → idempotente por construção.
  DELETE FROM public.ad_performance_daily d
  USING unnest(p_keys) k
  WHERE d.user_id = k.user_id AND d.ad_id = k.ad_id AND d.date = k.date;

  -- Dicionário: garante o id de toda chave nova antes de empacotar.
  INSERT INTO public.conversion_keys (key)
  SELECT DISTINCT c.key
  FROM unnest(p_keys) k
  JOIN public.ad_metrics am ON am.user_id = k.user_id AND am.ad_id = k.ad_id AND am.date = k.date
  CROSS JOIN LATERAL public.ad_performance_derive_conversions(am.actions, am.conversions) c
  ON CONFLICT (key) DO NOTHING;

  INSERT INTO public.ad_performance_daily (user_id, ad_id, date, conv_key_ids, conv_values, lead_scores, lead_qtys)
  SELECT am.user_id, am.ad_id, am.date, r.conv_key_ids, r.conv_values, r.lead_scores, r.lead_qtys
  FROM unnest(p_keys) k
  JOIN public.ad_metrics am ON am.user_id = k.user_id AND am.ad_id = k.ad_id AND am.date = k.date
  CROSS JOIN LATERAL public.ad_performance_derive_row(am.actions, am.conversions, am.leadscore_values) r;
END;
$$;

COMMENT ON FUNCTION public.ad_performance_rollup_apply(public.ad_metric_key[]) IS
'Worker do rollup (migration 128): apaga e recomputa ad_performance_daily das chaves (user, ad, dia) recebidas, relendo ad_metrics. Chamado pelos triggers por statement; também serve de reparo pontual.';

-- INSERT: toda linha inserida entra.
CREATE OR REPLACE FUNCTION public.ad_performance_rollup_sync_ins()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.ad_performance_rollup_apply(
    (SELECT array_agg(ROW(n.user_id, n.ad_id, n.date)::public.ad_metric_key) FROM new_rows n)
  );
  RETURN NULL;
END;
$$;

-- UPDATE: só linhas cujas colunas-FONTE mudaram de fato. Não dá para usar `UPDATE OF
-- colunas` aqui (o Postgres não aceita tabela de transição com lista de colunas), e
-- comparar OLD/NEW é melhor: um upsert que regrava o mesmo JSON não recomputa nada.
-- Mudança só de user_id/ad_id/date propaga pela FK (ON UPDATE CASCADE), sem recomputar.
CREATE OR REPLACE FUNCTION public.ad_performance_rollup_sync_upd()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.ad_performance_rollup_apply(
    (SELECT array_agg(ROW(n.user_id, n.ad_id, n.date)::public.ad_metric_key)
     FROM new_rows n
     JOIN old_rows o ON o.id = n.id AND o.user_id = n.user_id
     WHERE n.actions          IS DISTINCT FROM o.actions
        OR n.conversions      IS DISTINCT FROM o.conversions
        OR n.leadscore_values IS DISTINCT FROM o.leadscore_values)
  );
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.ad_performance_rollup_sync_ins() IS
'Trigger por STATEMENT (AFTER INSERT, tabela de transição new_rows) que mantém ad_performance_daily (migration 128). Cobre os 4 escritores de ad_metrics sem que nenhum precise saber do rollup.';
COMMENT ON FUNCTION public.ad_performance_rollup_sync_upd() IS
'Trigger por STATEMENT (AFTER UPDATE, old_rows/new_rows) que recomputa ad_performance_daily só das linhas cujas actions/conversions/leadscore_values mudaram (migration 128).';

-- Um trigger por evento: o Postgres não aceita tabela de transição num trigger com
-- mais de um evento nem com lista de colunas.
DROP TRIGGER IF EXISTS ad_metrics_rollup_sync_ins ON public.ad_metrics;
DROP TRIGGER IF EXISTS ad_metrics_rollup_sync_upd ON public.ad_metrics;

CREATE TRIGGER ad_metrics_rollup_sync_ins
  AFTER INSERT ON public.ad_metrics
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.ad_performance_rollup_sync_ins();

CREATE TRIGGER ad_metrics_rollup_sync_upd
  AFTER UPDATE ON public.ad_metrics
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.ad_performance_rollup_sync_upd();

-- ============================================================================
-- 5. Rebuild por usuário (backfill e reparo)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ad_performance_rollup_rebuild(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_t0   timestamptz := clock_timestamp();
  v_rows bigint;
BEGIN
  -- Guard de tenancy (padrão da migration 113): autenticado só reconstrói o próprio
  -- silo; service role / psql direto (auth.uid() nulo) passam.
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Forbidden: p_user_id must match auth.uid()';
  END IF;

  DELETE FROM public.ad_performance_daily WHERE user_id = p_user_id;

  INSERT INTO public.conversion_keys (key)
  SELECT DISTINCT c.key
  FROM public.ad_metrics am
  CROSS JOIN LATERAL public.ad_performance_derive_conversions(am.actions, am.conversions) c
  WHERE am.user_id = p_user_id
  ON CONFLICT (key) DO NOTHING;

  INSERT INTO public.ad_performance_daily (user_id, ad_id, date, conv_key_ids, conv_values, lead_scores, lead_qtys)
  SELECT am.user_id, am.ad_id, am.date, r.conv_key_ids, r.conv_values, r.lead_scores, r.lead_qtys
  FROM public.ad_metrics am
  CROSS JOIN LATERAL public.ad_performance_derive_row(am.actions, am.conversions, am.leadscore_values) r
  WHERE am.user_id = p_user_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  RETURN jsonb_build_object(
    'user_id', p_user_id,
    'rows', v_rows,
    'ms', round(extract(epoch from clock_timestamp() - v_t0) * 1000)
  );
END;
$$;

COMMENT ON FUNCTION public.ad_performance_rollup_rebuild(uuid) IS
'Reconstrói ad_performance_daily de UM usuário a partir de ad_metrics (migration 128). Usado no backfill (supabase/scripts/backfill_128_rollup_de_performance.sql) e como reparo. Rodar via psql direto: um usuário grande (~120 mil linhas) ultrapassa o statement_timeout do PostgREST.';

-- ============================================================================
-- 6. Checagem de consistência — DEVE devolver zero linhas
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ad_performance_rollup_consistency_check(p_user_id uuid DEFAULT NULL)
RETURNS TABLE (
  user_id uuid,
  missing bigint,   -- derivável de ad_metrics mas ausente/diferente na tabela
  extra   bigint    -- na tabela mas não derivável de ad_metrics
)
LANGUAGE sql STABLE
SET search_path TO 'public'
SET plan_cache_mode TO 'force_custom_plan'
AS $$
  -- Compara a derivação COMPLETA (não só contagens) nos dois sentidos, por usuário.
  -- Cobre trigger e backfill; a semântica da derivação em si é provada pelo teste
  -- diferencial contra a RPC antiga (fase C do plano). Custo O(linhas do usuário):
  -- rodar via psql, não via PostgREST.
  with scope as (
    select distinct am.user_id
    from public.ad_metrics am
    where p_user_id is null or am.user_id = p_user_id
  ),
  expected as (
    select am.user_id, am.ad_id, am.date, r.conv_key_ids, r.conv_values, r.lead_scores, r.lead_qtys
    from public.ad_metrics am
    join scope s on s.user_id = am.user_id
    cross join lateral public.ad_performance_derive_row(am.actions, am.conversions, am.leadscore_values) r
  ),
  stored as (
    select d.user_id, d.ad_id, d.date, d.conv_key_ids, d.conv_values, d.lead_scores, d.lead_qtys
    from public.ad_performance_daily d
    join scope s on s.user_id = d.user_id
  ),
  diffs as (
    select user_id, 1 as m, 0 as e from (table expected except all table stored) x
    union all
    select user_id, 0, 1 from (table stored except all table expected) x
  )
  select user_id, sum(m), sum(e)
  from diffs
  group by user_id
  order by user_id
$$;

COMMENT ON FUNCTION public.ad_performance_rollup_consistency_check(uuid) IS
'Guarda-chuva do rollup (migration 128). DEVE devolver zero linhas: qualquer linha = usuário cuja derivada diverge de ad_metrics. Fix: select ad_performance_rollup_rebuild(user_id). Sem argumento checa todos os usuários — rodar via psql direto (custo O(ad_metrics)).';
