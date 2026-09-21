--
-- PostgreSQL database dump
--

\restrict IYEnJW1GkcuvWIPZCds190I9iL4Du0IVqzO0HceQGf1Uwm76hyxdGJpJ4GiL1aL

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: pg_database_owner
--

CREATE SCHEMA public;


ALTER SCHEMA public OWNER TO pg_database_owner;

--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: pg_database_owner
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: ad_metric_key; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.ad_metric_key AS (
	user_id uuid,
	pack_id uuid,
	ad_id text,
	date date
);


ALTER TYPE public.ad_metric_key OWNER TO postgres;

--
-- Name: ad_metrics_enrichment_targets(uuid, uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.ad_metrics_enrichment_targets(p_user_id uuid, p_pack_id uuid) RETURNS TABLE(id text, ad_id text, metric_date date, has_leadscore boolean, has_custom boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  -- Direto pela PK: as linhas do pack SAO as linhas a limpar.
  SELECT am.id, am.ad_id, am.date, am.leadscore_values IS NOT NULL, am.custom_hist IS NOT NULL
  FROM public.ad_metrics am
  WHERE am.user_id = p_user_id AND am.pack_id = p_pack_id
    AND (am.leadscore_values IS NOT NULL OR am.custom_hist IS NOT NULL);
$$;


ALTER FUNCTION public.ad_metrics_enrichment_targets(p_user_id uuid, p_pack_id uuid) OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: ad_metrics; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ad_metrics (
    user_id uuid NOT NULL,
    ad_id text NOT NULL,
    account_id text,
    campaign_id text,
    campaign_name text,
    adset_id text,
    adset_name text,
    ad_name text,
    date date NOT NULL,
    clicks integer,
    impressions integer,
    inline_link_clicks integer,
    reach integer,
    video_total_plays integer,
    video_total_thruplays integer,
    video_watched_p50 integer,
    spend numeric,
    cpm numeric,
    ctr numeric,
    frequency numeric,
    website_ctr numeric,
    actions jsonb,
    conversions jsonb,
    cost_per_conversion jsonb,
    video_play_curve_actions jsonb,
    connect_rate numeric,
    profile_ctr numeric,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    id text NOT NULL,
    hold_rate numeric,
    leadscore_values numeric[],
    lpv integer DEFAULT 0 NOT NULL,
    hook_rate numeric,
    scroll_stop_rate numeric,
    video_watched_p75 integer,
    custom_hist jsonb,
    pack_id uuid NOT NULL
)
WITH (autovacuum_vacuum_scale_factor='0.02', autovacuum_vacuum_insert_scale_factor='0.02', autovacuum_analyze_scale_factor='0.05');


ALTER TABLE public.ad_metrics OWNER TO postgres;

--
-- Name: COLUMN ad_metrics.hold_rate; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.ad_metrics.hold_rate IS 'Taxa de retenção (Hold Rate) calculada como video_thruplay_watched_actions / hook (retention at 3 seconds). 
Representa quantos usuários que passaram do hook inicial continuaram assistindo até o thruplay.';


--
-- Name: COLUMN ad_metrics.leadscore_values; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.ad_metrics.leadscore_values IS 'Array de leadscores individuais daquele ad_id naquela date. Permite calcular média correta quando há múltiplas datas. Exemplo: [24, 100, 80, 19] representa 4 leads com leadscores 24, 100, 80, 19. Média = SUM(leadscore_values) / array_length(leadscore_values, 1)';


--
-- Name: COLUMN ad_metrics.video_watched_p75; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.ad_metrics.video_watched_p75 IS 'Percentual inteiro (0-100) de plays que atingiram 75% do vídeo (video_p75_watched_actions / video_play_actions). NULL em linhas anteriores à migration 090 ainda não re-sincronizadas.';


--
-- Name: COLUMN ad_metrics.custom_hist; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.ad_metrics.custom_hist IS 'Histogramas das colunas vinculadas da planilha (migration 140): {"<mapping_id>": {"<valor>": quantidade}} por anúncio-dia. Gravado inteiro pelo sync (batch_update_ad_metrics_enrichment); NULL para quem não vincula coluna nenhuma. Sem valor por lead: o histograma é sem perda para média, mínimo, máximo, mediana, corte e contagem por resposta.';


--
-- Name: ad_metrics_is_synthetic_zero(public.ad_metrics); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.ad_metrics_is_synthetic_zero(m public.ad_metrics) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
  select coalesce(m.impressions, 0) = 0
     and coalesce(m.clicks, 0) = 0
     and coalesce(m.inline_link_clicks, 0) = 0
     and coalesce(m.reach, 0) = 0
     and coalesce(m.spend, 0) = 0
     and coalesce(m.lpv, 0) = 0
     and coalesce(m.video_total_plays, 0) = 0
     and coalesce(m.video_total_thruplays, 0) = 0
     and coalesce(m.video_watched_p50, 0) = 0
     and coalesce(m.video_watched_p75, 0) = 0
     and coalesce(m.actions, '[]'::jsonb) in ('[]'::jsonb, '{}'::jsonb, 'null'::jsonb)
     and coalesce(m.conversions, '[]'::jsonb) in ('[]'::jsonb, '{}'::jsonb, 'null'::jsonb)
     and coalesce(m.cost_per_conversion, '[]'::jsonb) in ('[]'::jsonb, '{}'::jsonb, 'null'::jsonb)
     and coalesce(m.video_play_curve_actions, '[]'::jsonb) in ('[]'::jsonb, '{}'::jsonb, 'null'::jsonb)
     and coalesce(cardinality(m.leadscore_values), 0) = 0
     and coalesce(m.custom_hist, '{}'::jsonb) in ('{}'::jsonb, 'null'::jsonb)
$$;


ALTER FUNCTION public.ad_metrics_is_synthetic_zero(m public.ad_metrics) OWNER TO postgres;

--
-- Name: FUNCTION ad_metrics_is_synthetic_zero(m public.ad_metrics); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.ad_metrics_is_synthetic_zero(m public.ad_metrics) IS 'F5: linha de ad_metrics sem nenhum número, conversão, leadscore ou coluna vinculada — a linha-zero sintetizada pelo inventário. Critério único do backfill (154) e da limpeza (fase 4).';


--
-- Name: ad_pack_inventory_backfill(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.ad_pack_inventory_backfill(p_user_id uuid DEFAULT NULL::uuid) RETURNS integer
    LANGUAGE plpgsql
    SET search_path TO 'public'
    SET plan_cache_mode TO 'force_custom_plan'
    AS $$
declare
  v_count integer;
begin
  with kept as (
    select m.user_id, m.pack_id, m.ad_id, m.date,
           m.account_id, m.campaign_id, m.campaign_name, m.adset_id, m.adset_name, m.ad_name
    from public.ad_metrics m
    left join public.ads a on a.user_id = m.user_id and a.ad_id = m.ad_id
    where (p_user_id is null or m.user_id = p_user_id)
      and public.ad_metrics_is_synthetic_zero(m)
      -- Linha anterior à criação do anúncio não é "ativo sem entrega": é sujeira
      -- (162.960 delas, gravadas numa só noite, 06→07/09). Tolerância de 1 dia: fuso.
      and (a.meta_created_time is null
           or m.date >= (a.meta_created_time at time zone 'UTC')::date - 1)
  ),
  intervals as (
    select user_id, pack_id, ad_id, min(date) as first_d, max(date) as last_d
    from kept
    group by user_id, pack_id, ad_id
  ),
  last_identity as (
    -- Identidade do dia mais recente: é o nome que o anúncio tinha no último refresh.
    select distinct on (k.user_id, k.pack_id, k.ad_id)
           k.user_id, k.pack_id, k.ad_id,
           k.account_id, k.campaign_id, k.campaign_name, k.adset_id, k.adset_name, k.ad_name
    from kept k
    order by k.user_id, k.pack_id, k.ad_id, k.date desc
  )
  insert into public.ad_pack_inventory as inv (
    user_id, pack_id, ad_id, account_id, campaign_id, campaign_name, adset_id, adset_name, ad_name,
    first_active_date, last_active_date
  )
  select i.user_id, i.pack_id, i.ad_id,
         li.account_id, li.campaign_id, li.campaign_name, li.adset_id, li.adset_name, li.ad_name,
         i.first_d, i.last_d
  from intervals i
  join last_identity li using (user_id, pack_id, ad_id)
  on conflict (user_id, pack_id, ad_id) do update set
    first_active_date = least(inv.first_active_date, excluded.first_active_date),
    last_active_date = greatest(inv.last_active_date, excluded.last_active_date),
    updated_at = now()
  where excluded.first_active_date < inv.first_active_date
     or excluded.last_active_date > inv.last_active_date;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;


ALTER FUNCTION public.ad_pack_inventory_backfill(p_user_id uuid) OWNER TO postgres;

--
-- Name: FUNCTION ad_pack_inventory_backfill(p_user_id uuid); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.ad_pack_inventory_backfill(p_user_id uuid) IS 'F5: preenche ad_pack_inventory a partir das linhas-zero sintéticas de ad_metrics (sem as anteriores à criação do anúncio). Idempotente. Uso administrativo (migration e laboratório). Tem plan_cache_mode=force_custom_plan (158) — se recriar a função, repita o ALTER.';


--
-- Name: ad_performance_curve_point(jsonb, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.ad_performance_curve_point(p_curve jsonb, p_idx integer) RETURNS numeric
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    SET search_path TO 'public'
    AS $$
  -- Ponto p_idx da curva de retenção como fração (a RPC v116 divide por 100 quando o
  -- valor vem em percentual). 0 quando não há curva — inclusive curva NULL:
  -- jsonb_typeof(NULL) é NULL, e um NULL solto num WHERE devolveria zero linhas
  -- (= NULL na coluna NOT NULL). O teste da 128 pegou exatamente isso.
  select case
    when coalesce(jsonb_typeof(p_curve) = 'array' and jsonb_array_length(p_curve) > 0, false) then
      (select v / (case when v > 1 then 100.0 else 1.0 end)
       from (select coalesce(nullif(regexp_replace(coalesce(p_curve ->> least(p_idx, jsonb_array_length(p_curve) - 1), '0'), '[^0-9.-]', '', 'g'), ''), '0')::numeric as v) s)
    else 0::numeric
  end
$$;


ALTER FUNCTION public.ad_performance_curve_point(p_curve jsonb, p_idx integer) OWNER TO postgres;

--
-- Name: ad_performance_derive_conversions(jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.ad_performance_derive_conversions(p_actions jsonb, p_conversions jsonb) RETURNS TABLE(key text, value numeric)
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


ALTER FUNCTION public.ad_performance_derive_conversions(p_actions jsonb, p_conversions jsonb) OWNER TO postgres;

--
-- Name: FUNCTION ad_performance_derive_conversions(p_actions jsonb, p_conversions jsonb); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.ad_performance_derive_conversions(p_actions jsonb, p_conversions jsonb) IS 'Fonte única da derivação de conversões/ações a partir de uma linha de ad_metrics (migration 128): (chave, valor somado). Trigger, rebuild e consistency_check usam esta função — mudar a semântica aqui muda em todos.';


--
-- Name: ad_performance_derive_leads(numeric[]); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.ad_performance_derive_leads(p_values numeric[]) RETURNS TABLE(score numeric, qty integer)
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    SET search_path TO 'public'
    AS $$
  select v as score, count(*)::integer as qty
  from unnest(coalesce(p_values, '{}'::numeric[])) v
  where v is not null
  group by v
$$;


ALTER FUNCTION public.ad_performance_derive_leads(p_values numeric[]) OWNER TO postgres;

--
-- Name: FUNCTION ad_performance_derive_leads(p_values numeric[]); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.ad_performance_derive_leads(p_values numeric[]) IS 'Fonte única da derivação do histograma de leadscore (score → quantidade) a partir de leadscore_values (migration 128).';


--
-- Name: ad_performance_derive_row(public.ad_metrics); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.ad_performance_derive_row(am public.ad_metrics) RETURNS TABLE(account_id text, campaign_id text, adset_id text, ad_name text, impressions bigint, clicks bigint, inline_link_clicks bigint, spend numeric, lpv bigint, plays bigint, thruplays bigint, video_watched_p50 numeric, video_watched_p75 numeric, hold_rate numeric, reach bigint, frequency numeric, hook_value numeric, scroll_stop_value numeric, conv_key_ids integer[], conv_values numeric[], lead_scores numeric[], lead_qtys integer[], custom_hist jsonb)
    LANGUAGE sql STABLE PARALLEL SAFE
    SET search_path TO 'public'
    AS $$
  -- A linha derivada COMPLETA de uma linha de ad_metrics. Números saneados como a RPC
  -- v116 (coalesce 0, casts). Arrays na ordem canônica (por key_id / por score).
  -- Pressupõe que as chaves já existem no dicionário (o chamador garante).
  -- 140: custom_hist copiada tal qual ({} vira NULL, para a linha sem vínculo ficar nula).
  with c as (
    select ck.id, d.value
    from public.ad_performance_derive_conversions(am.actions, am.conversions) d
    join public.conversion_keys ck on ck.key = d.key
  ),
  l as (
    select score, qty from public.ad_performance_derive_leads(am.leadscore_values)
  )
  select
    am.account_id, am.campaign_id, am.adset_id, am.ad_name,
    coalesce(am.impressions, 0)::bigint,
    coalesce(am.clicks, 0)::bigint,
    coalesce(am.inline_link_clicks, 0)::bigint,
    coalesce(am.spend, 0)::numeric,
    coalesce(am.lpv, 0)::bigint,
    coalesce(am.video_total_plays, 0)::bigint,
    coalesce(am.video_total_thruplays, 0)::bigint,
    coalesce(am.video_watched_p50, 0)::numeric,
    coalesce(am.video_watched_p75, 0)::numeric,
    coalesce(am.hold_rate, 0)::numeric,
    coalesce(am.reach, 0)::bigint,
    coalesce(am.frequency, 0)::numeric,
    coalesce(am.hook_rate, public.ad_performance_curve_point(am.video_play_curve_actions, 3)),
    coalesce(am.scroll_stop_rate, public.ad_performance_curve_point(am.video_play_curve_actions, 1)),
    (select coalesce(array_agg(id    order by id), '{}') from c),
    (select coalesce(array_agg(value order by id), '{}') from c),
    (select coalesce(array_agg(score order by score), '{}') from l),
    (select coalesce(array_agg(qty   order by score), '{}') from l),
    nullif(am.custom_hist, '{}'::jsonb)
$$;


ALTER FUNCTION public.ad_performance_derive_row(am public.ad_metrics) OWNER TO postgres;

--
-- Name: FUNCTION ad_performance_derive_row(am public.ad_metrics); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.ad_performance_derive_row(am public.ad_metrics) IS 'Fonte única da linha de ad_performance_daily a partir de uma linha de ad_metrics (migrations 129/140): chaves, números saneados como a RPC, arrays de conversões, histograma de leads e custom_hist. Trigger, rebuild e consistency_check usam esta função.';


--
-- Name: ad_performance_parse_value(text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.ad_performance_parse_value(p_raw text) RETURNS numeric
    LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
    SET search_path TO 'public'
    AS $_$
  -- Mesmo saneamento da RPC (regexp_replace '[^0-9.-]'), mas nunca estoura: o que não
  -- vira número conta 0. Uma linha ruim não pode derrubar o upsert de um lote inteiro.
  select case
    when cleaned ~ '^-?([0-9]+\.?[0-9]*|\.[0-9]+)$' then cleaned::numeric
    else 0::numeric
  end
  from (select regexp_replace(coalesce(p_raw, '0'), '[^0-9.-]', '', 'g') as cleaned) s
$_$;


ALTER FUNCTION public.ad_performance_parse_value(p_raw text) OWNER TO postgres;

--
-- Name: FUNCTION ad_performance_parse_value(p_raw text); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.ad_performance_parse_value(p_raw text) IS 'Saneia o campo value dos itens de actions/conversions como a RPC do Manager faz (só [0-9.-]); inválido → 0 em vez de erro (migration 128).';


--
-- Name: ad_performance_rollup_apply(public.ad_metric_key[]); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.ad_performance_rollup_apply(p_keys public.ad_metric_key[]) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF p_keys IS NULL OR cardinality(p_keys) = 0 THEN
    RETURN;
  END IF;

  DELETE FROM public.ad_performance_daily d
  USING unnest(p_keys) k
  WHERE d.user_id = k.user_id AND d.pack_id = k.pack_id AND d.ad_id = k.ad_id AND d.date = k.date;

  INSERT INTO public.conversion_keys (key)
  SELECT DISTINCT c.key
  FROM unnest(p_keys) k
  JOIN public.ad_metrics am
    ON am.user_id = k.user_id AND am.pack_id = k.pack_id AND am.ad_id = k.ad_id AND am.date = k.date
  CROSS JOIN LATERAL public.ad_performance_derive_conversions(am.actions, am.conversions) c
  ON CONFLICT (key) DO NOTHING;

  INSERT INTO public.ad_performance_daily (
    user_id, pack_id, ad_id, date,
    account_id, campaign_id, adset_id, ad_name,
    impressions, clicks, inline_link_clicks, spend, lpv, plays, thruplays,
    video_watched_p50, video_watched_p75, hold_rate, reach, frequency, hook_value, scroll_stop_value,
    conv_key_ids, conv_values, lead_scores, lead_qtys, custom_hist
  )
  SELECT am.user_id, am.pack_id, am.ad_id, am.date, r.*
  FROM unnest(p_keys) k
  JOIN public.ad_metrics am
    ON am.user_id = k.user_id AND am.pack_id = k.pack_id AND am.ad_id = k.ad_id AND am.date = k.date
  CROSS JOIN LATERAL public.ad_performance_derive_row(am) r;
END;
$$;


ALTER FUNCTION public.ad_performance_rollup_apply(p_keys public.ad_metric_key[]) OWNER TO postgres;

--
-- Name: FUNCTION ad_performance_rollup_apply(p_keys public.ad_metric_key[]); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.ad_performance_rollup_apply(p_keys public.ad_metric_key[]) IS 'Worker do rollup (128; chave com pack desde a 145): apaga e recompoe as linhas de ad_performance_daily das chaves (user, pack, anuncio, dia) a partir de ad_metrics. derive_row nao muda: recebe a linha de ad_metrics e le campos por nome.';


--
-- Name: ad_performance_rollup_consistency_check(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.ad_performance_rollup_consistency_check(p_user_id uuid DEFAULT NULL::uuid) RETURNS TABLE(user_id uuid, missing bigint, extra bigint)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    SET plan_cache_mode TO 'force_custom_plan'
    AS $$
  with scope as (
    select distinct am.user_id
    from public.ad_metrics am
    where p_user_id is null or am.user_id = p_user_id
  ),
  expected as (
    select am.user_id, am.pack_id, am.ad_id, am.date, r.*
    from public.ad_metrics am
    join scope s on s.user_id = am.user_id
    cross join lateral public.ad_performance_derive_row(am) r
  ),
  stored as (
    select d.user_id, d.pack_id, d.ad_id, d.date,
           d.account_id, d.campaign_id, d.adset_id, d.ad_name,
           d.impressions, d.clicks, d.inline_link_clicks, d.spend, d.lpv, d.plays, d.thruplays,
           d.video_watched_p50, d.video_watched_p75, d.hold_rate, d.reach, d.frequency, d.hook_value, d.scroll_stop_value,
           d.conv_key_ids, d.conv_values, d.lead_scores, d.lead_qtys, d.custom_hist
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


ALTER FUNCTION public.ad_performance_rollup_consistency_check(p_user_id uuid) OWNER TO postgres;

--
-- Name: FUNCTION ad_performance_rollup_consistency_check(p_user_id uuid); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.ad_performance_rollup_consistency_check(p_user_id uuid) IS 'Guarda-chuva do rollup (migration 128). DEVE devolver zero linhas: qualquer linha = usuário cuja derivada diverge de ad_metrics. Fix: select ad_performance_rollup_rebuild(user_id). Sem argumento checa todos os usuários — rodar via psql direto (custo O(ad_metrics)).';


--
-- Name: ad_performance_rollup_rebuild(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.ad_performance_rollup_rebuild(p_user_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_t0   timestamptz := clock_timestamp();
  v_rows bigint;
BEGIN
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

  INSERT INTO public.ad_performance_daily (
    user_id, pack_id, ad_id, date,
    account_id, campaign_id, adset_id, ad_name,
    impressions, clicks, inline_link_clicks, spend, lpv, plays, thruplays,
    video_watched_p50, video_watched_p75, hold_rate, reach, frequency, hook_value, scroll_stop_value,
    conv_key_ids, conv_values, lead_scores, lead_qtys, custom_hist
  )
  SELECT am.user_id, am.pack_id, am.ad_id, am.date, r.*
  FROM public.ad_metrics am
  CROSS JOIN LATERAL public.ad_performance_derive_row(am) r
  WHERE am.user_id = p_user_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  RETURN jsonb_build_object(
    'user_id', p_user_id,
    'rows', v_rows,
    'ms', round(extract(epoch from clock_timestamp() - v_t0) * 1000)
  );
END;
$$;


ALTER FUNCTION public.ad_performance_rollup_rebuild(p_user_id uuid) OWNER TO postgres;

--
-- Name: FUNCTION ad_performance_rollup_rebuild(p_user_id uuid); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.ad_performance_rollup_rebuild(p_user_id uuid) IS 'Reconstrói ad_performance_daily de UM usuário a partir de ad_metrics (migration 128). Usado no backfill (supabase/scripts/backfill_128_rollup_de_performance.sql) e como reparo. Rodar via psql direto: um usuário grande (~120 mil linhas) ultrapassa o statement_timeout do PostgREST.';


--
-- Name: ad_performance_rollup_sync_ins(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.ad_performance_rollup_sync_ins() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  PERFORM public.ad_performance_rollup_apply(
    (SELECT array_agg(ROW(n.user_id, n.pack_id, n.ad_id, n.date)::public.ad_metric_key) FROM new_rows n)
  );
  RETURN NULL;
END;
$$;


ALTER FUNCTION public.ad_performance_rollup_sync_ins() OWNER TO postgres;

--
-- Name: FUNCTION ad_performance_rollup_sync_ins(); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.ad_performance_rollup_sync_ins() IS 'Trigger por STATEMENT (AFTER INSERT, tabela de transição new_rows) que mantém ad_performance_daily (migration 128). Cobre os 4 escritores de ad_metrics sem que nenhum precise saber do rollup.';


--
-- Name: ad_performance_rollup_sync_upd(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.ad_performance_rollup_sync_upd() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  PERFORM public.ad_performance_rollup_apply(
    (SELECT array_agg(ROW(n.user_id, n.pack_id, n.ad_id, n.date)::public.ad_metric_key)
     FROM new_rows n
     JOIN old_rows o
       ON o.user_id = n.user_id AND o.pack_id = n.pack_id AND o.ad_id = n.ad_id AND o.date = n.date
     WHERE ROW(n.actions, n.conversions, n.leadscore_values, n.custom_hist,
               n.account_id, n.campaign_id, n.adset_id, n.ad_name,
               n.impressions, n.clicks, n.inline_link_clicks, n.spend, n.lpv,
               n.video_total_plays, n.video_total_thruplays, n.video_watched_p50, n.video_watched_p75,
               n.hold_rate, n.reach, n.frequency, n.hook_rate, n.scroll_stop_rate, n.video_play_curve_actions)
        IS DISTINCT FROM
           ROW(o.actions, o.conversions, o.leadscore_values, o.custom_hist,
               o.account_id, o.campaign_id, o.adset_id, o.ad_name,
               o.impressions, o.clicks, o.inline_link_clicks, o.spend, o.lpv,
               o.video_total_plays, o.video_total_thruplays, o.video_watched_p50, o.video_watched_p75,
               o.hold_rate, o.reach, o.frequency, o.hook_rate, o.scroll_stop_rate, o.video_play_curve_actions))
  );
  RETURN NULL;
END;
$$;


ALTER FUNCTION public.ad_performance_rollup_sync_upd() OWNER TO postgres;

--
-- Name: FUNCTION ad_performance_rollup_sync_upd(); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.ad_performance_rollup_sync_upd() IS 'Trigger por STATEMENT (AFTER UPDATE, old_rows/new_rows) que recomputa ad_performance_daily só das linhas cuja fonte mudou — qualquer coluna que a derivação lê (migrations 128/129/140).';


--
-- Name: batch_add_pack_id_to_arrays(uuid, uuid, text, text[]); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.batch_add_pack_id_to_arrays(p_user_id uuid, p_pack_id uuid, p_table_name text, p_ids_to_update text[]) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  updated_count int := 0;
BEGIN
  -- Guard de tenancy (migration 113): caller autenticado so opera o PROPRIO
  -- silo; service role (auth.uid() nulo) passa - e o caminho do backend para
  -- operacoes de pack compartilhado (P3.3), que ja derivou o dono via
  -- resolve_pack_access antes de chegar aqui.
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Forbidden: p_user_id must match auth.uid()';
  END IF;
  IF p_table_name NOT IN ('ads', 'ad_metrics') THEN
    RAISE EXCEPTION 'Tabela inválida: %. Use "ads" ou "ad_metrics"', p_table_name;
  END IF;
  IF p_table_name = 'ads' THEN
    UPDATE public.ads
    SET
      pack_ids = array_append(COALESCE(pack_ids, ARRAY[]::uuid[]), p_pack_id),
      updated_at = now()
    WHERE user_id = p_user_id
      AND ad_id = ANY(p_ids_to_update)
      -- 153: quem já tem o pack não é regravado.
      AND NOT COALESCE(p_pack_id = ANY(pack_ids), false);
    GET DIAGNOSTICS updated_count = ROW_COUNT;
  ELSE
    UPDATE public.ad_metrics
    SET
      pack_ids = CASE
        WHEN p_pack_id = ANY(COALESCE(pack_ids, ARRAY[]::uuid[])) THEN COALESCE(pack_ids, ARRAY[]::uuid[])
        ELSE array_append(COALESCE(pack_ids, ARRAY[]::uuid[]), p_pack_id)
      END,
      updated_at = now()
    WHERE user_id = p_user_id
      AND id = ANY(p_ids_to_update);
    GET DIAGNOSTICS updated_count = ROW_COUNT;
  END IF;
  RETURN jsonb_build_object(
    'rows_updated', updated_count,
    'status', 'success'
  );
EXCEPTION
  WHEN OTHERS THEN
    IF SQLERRM LIKE 'Forbidden: p_user_id%' THEN RAISE; END IF;
    RETURN jsonb_build_object(
      'status', 'error',
      'error_message', SQLERRM,
      'rows_updated', 0
    );
END;
$$;


ALTER FUNCTION public.batch_add_pack_id_to_arrays(p_user_id uuid, p_pack_id uuid, p_table_name text, p_ids_to_update text[]) OWNER TO postgres;

--
-- Name: FUNCTION batch_add_pack_id_to_arrays(p_user_id uuid, p_pack_id uuid, p_table_name text, p_ids_to_update text[]); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.batch_add_pack_id_to_arrays(p_user_id uuid, p_pack_id uuid, p_table_name text, p_ids_to_update text[]) IS 'Anexa pack_id ao array pack_ids em batch. Idempotente; desde a 153 regrava só as linhas de ads que ainda não têm o pack.';


--
-- Name: batch_remove_pack_id_from_arrays(uuid, uuid, text, text[]); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.batch_remove_pack_id_from_arrays(p_user_id uuid, p_pack_id uuid, p_table_name text, p_ids_to_update text[]) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$



DECLARE



  updated_count int;



BEGIN
  -- Guard de tenancy (migration 113): caller autenticado so opera o PROPRIO
  -- silo; service role (auth.uid() nulo) passa - e o caminho do backend para
  -- operacoes de pack compartilhado (P3.3), que ja derivou o dono via
  -- resolve_pack_access antes de chegar aqui.
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Forbidden: p_user_id must match auth.uid()';
  END IF;











  -- Validar tabela



  IF p_table_name NOT IN ('ads', 'ad_metrics') THEN



    RAISE EXCEPTION 'Tabela inválida: %. Use "ads" ou "ad_metrics"', p_table_name;



  END IF;



  



  -- Atualizar ads



  IF p_table_name = 'ads' THEN



    UPDATE public.ads



    SET 



      pack_ids = array_remove(pack_ids, p_pack_id),



      updated_at = now()



    WHERE 



      user_id = p_user_id



      AND ad_id = ANY(p_ids_to_update)



      AND p_pack_id = ANY(pack_ids);



    



    GET DIAGNOSTICS updated_count = ROW_COUNT;



    



  -- Atualizar ad_metrics



  ELSIF p_table_name = 'ad_metrics' THEN



    UPDATE public.ad_metrics



    SET 



      pack_ids = array_remove(pack_ids, p_pack_id),



      updated_at = now()



    WHERE 



      user_id = p_user_id



      AND id = ANY(p_ids_to_update)



      AND p_pack_id = ANY(pack_ids);



    



    GET DIAGNOSTICS updated_count = ROW_COUNT;



  END IF;



  



  RETURN jsonb_build_object(



    'rows_updated', updated_count,



    'status', 'success'



  );



EXCEPTION



  WHEN OTHERS THEN
    IF SQLERRM LIKE 'Forbidden: p_user_id%' THEN RAISE; END IF;



    -- Retornar erro de forma estruturada



    RETURN jsonb_build_object(



      'status', 'error',



      'error_message', SQLERRM,



      'rows_updated', 0



    );



END;



$$;


ALTER FUNCTION public.batch_remove_pack_id_from_arrays(p_user_id uuid, p_pack_id uuid, p_table_name text, p_ids_to_update text[]) OWNER TO postgres;

--
-- Name: FUNCTION batch_remove_pack_id_from_arrays(p_user_id uuid, p_pack_id uuid, p_table_name text, p_ids_to_update text[]); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.batch_remove_pack_id_from_arrays(p_user_id uuid, p_pack_id uuid, p_table_name text, p_ids_to_update text[]) IS 'Remove pack_id do array pack_ids de múltiplos registros em uma única transação. Muito mais eficiente que múltiplas requisições HTTP individuais. Reduz de N requisições para apenas 1. Usado durante a deleção de packs para preservar dados compartilhados entre múltiplos packs.';


--
-- Name: batch_update_ad_metrics_enrichment(uuid, jsonb, uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.batch_update_ad_metrics_enrichment(p_user_id uuid, p_updates jsonb, p_pack_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    SET plan_cache_mode TO 'force_custom_plan'
    AS $$
DECLARE
  total_rows_updated int := 0;
  total_ids_sent     int := 0;
  existing_count     int := 0;
  in_pack_count      int := 0;
  all_ids            text[];
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Forbidden: p_user_id must match auth.uid()';
  END IF;

  SELECT array_agg(id_val)
  INTO all_ids
  FROM jsonb_array_elements(p_updates) AS item,
  LATERAL jsonb_array_elements_text(item->'ids') AS id_val;

  total_ids_sent := coalesce(array_length(all_ids, 1), 0);

  WITH expanded AS (
    SELECT
      id_val AS id,
      CASE
        WHEN item ? 'leadscore_values'
          AND item->'leadscore_values' IS NOT NULL
          AND item->'leadscore_values' != 'null'::jsonb
          AND jsonb_array_length(item->'leadscore_values') > 0
        THEN ARRAY(
          SELECT v::numeric
          FROM jsonb_array_elements(item->'leadscore_values') AS v
        )
        ELSE NULL
      END AS leadscore_vals,
      (item ? 'custom_hist' AND jsonb_typeof(item->'custom_hist') = 'object') AS has_custom,
      CASE
        WHEN item ? 'custom_hist' AND jsonb_typeof(item->'custom_hist') = 'object'
        THEN nullif(item->'custom_hist', '{}'::jsonb)
        ELSE NULL
      END AS custom_hist_val
    FROM jsonb_array_elements(p_updates) AS item,
    LATERAL jsonb_array_elements_text(item->'ids') AS id_val
  )
  -- `id` ({data}-{ad_id}) deixou de ser unico: o mesmo anuncio-dia pode existir
  -- em outro pack. O filtro por pack e o que garante que a planilha do pack A
  -- escreve so na linha do pack A. Sem pack (integracao antiga) escreve em
  -- todas as copias, como sempre escreveu na linha unica.
  UPDATE public.ad_metrics am
  SET
    leadscore_values = CASE
      WHEN e.leadscore_vals IS NOT NULL THEN e.leadscore_vals
      ELSE am.leadscore_values
    END,
    custom_hist = CASE
      WHEN e.has_custom THEN e.custom_hist_val
      ELSE am.custom_hist
    END,
    updated_at = now()
  FROM expanded e
  WHERE am.id = e.id
    AND am.user_id = p_user_id
    AND (p_pack_id IS NULL OR am.pack_id = p_pack_id);
  GET DIAGNOSTICS total_rows_updated = ROW_COUNT;

  IF total_ids_sent > 0 THEN
    -- DISTINCT id: com copias por pack, contar linhas contaria o mesmo id 2x.
    SELECT
      count(DISTINCT am_diag.id)::int,
      count(DISTINCT am_diag.id) FILTER (WHERE p_pack_id IS NULL OR am_diag.pack_id = p_pack_id)::int
    INTO existing_count, in_pack_count
    FROM public.ad_metrics am_diag
    WHERE am_diag.user_id = p_user_id AND am_diag.id = ANY(all_ids);
  END IF;

  RETURN jsonb_build_object(
    'total_groups_processed', jsonb_array_length(p_updates),
    'total_rows_updated',     total_rows_updated,
    'total_ids_sent',         total_ids_sent,
    'ids_not_found_count',    greatest(0, total_ids_sent - existing_count),
    'ids_out_of_pack_count',  greatest(0, existing_count - in_pack_count),
    'status',                 'success'
  );
EXCEPTION
  WHEN OTHERS THEN
    IF SQLERRM LIKE 'Forbidden: p_user_id%' THEN RAISE; END IF;
    RETURN jsonb_build_object(
      'status',                 'error',
      'error_message',          SQLERRM,
      'total_groups_processed', jsonb_array_length(p_updates),
      'total_rows_updated',     total_rows_updated,
      'total_ids_sent',         total_ids_sent,
      'ids_not_found_count',    0,
      'ids_out_of_pack_count',  0
    );
END;
$$;


ALTER FUNCTION public.batch_update_ad_metrics_enrichment(p_user_id uuid, p_updates jsonb, p_pack_id uuid) OWNER TO postgres;

--
-- Name: FUNCTION batch_update_ad_metrics_enrichment(p_user_id uuid, p_updates jsonb, p_pack_id uuid); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.batch_update_ad_metrics_enrichment(p_user_id uuid, p_updates jsonb, p_pack_id uuid) IS 'Atualiza leadscore_values e custom_hist de ad_metrics em lote (planilha). Desde a 145 escreve na LINHA DO PACK (am.pack_id = p_pack_id): a planilha do pack A nao toca o pack B. Sem p_pack_id, todas as copias do id.';


--
-- Name: chat_claim_lease(uuid, uuid, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.chat_claim_lease(p_user_id uuid, p_message_id uuid, p_seconds integer DEFAULT 180) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_secs integer := greatest(10, least(coalesce(p_seconds, 180), 900));
  v_row public.chat_user_leases%ROWTYPE;
BEGIN
  IF p_user_id IS NULL OR p_message_id IS NULL THEN
    RAISE EXCEPTION 'chat_claim_lease: usuario e mensagem sao obrigatorios' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.chat_user_leases (user_id, busy_until, message_id)
  VALUES (p_user_id, pg_catalog.now() + make_interval(secs => v_secs), p_message_id)
  ON CONFLICT (user_id) DO UPDATE
    SET busy_until = EXCLUDED.busy_until, message_id = EXCLUDED.message_id
    WHERE public.chat_user_leases.busy_until <= pg_catalog.now()
  RETURNING * INTO v_row;
  IF v_row.user_id IS NULL THEN
    SELECT * INTO v_row FROM public.chat_user_leases WHERE user_id = p_user_id;
    RETURN jsonb_build_object('claimed', false, 'message_id', v_row.message_id, 'busy_until', v_row.busy_until);
  END IF;
  RETURN jsonb_build_object('claimed', true, 'message_id', v_row.message_id, 'busy_until', v_row.busy_until);
END $$;


ALTER FUNCTION public.chat_claim_lease(p_user_id uuid, p_message_id uuid, p_seconds integer) OWNER TO postgres;

--
-- Name: chat_close_scope(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.chat_close_scope(p_token uuid) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$ DELETE FROM chat.query_scopes WHERE token = p_token; $$;


ALTER FUNCTION public.chat_close_scope(p_token uuid) OWNER TO postgres;

--
-- Name: chat_open_scope(uuid, uuid[], text, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.chat_open_scope(p_actor_id uuid, p_pack_ids uuid[], p_action_key text DEFAULT NULL::text, p_ttl_seconds integer DEFAULT 300) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_token uuid := pg_catalog.gen_random_uuid();
  v_key text := pg_catalog.btrim(coalesce(p_action_key, ''));
  v_key_id integer;
  v_mql numeric;
  v_packs jsonb;
  v_pairs jsonb;
  v_ids uuid[];
  v_missing jsonb;
  v_start date;
  v_stop date;
BEGIN
  IF p_actor_id IS NULL OR p_pack_ids IS NULL OR pg_catalog.cardinality(p_pack_ids) = 0 THEN
    RAISE EXCEPTION 'chat_open_scope: ator e packs sao obrigatorios' USING ERRCODE = '22023';
  END IF;

  -- Acesso e dono: proprio OU compartilhado. Pack inacessivel nao entra.
  -- Datas ATUAIS dos packs (auto_refresh avança date_stop). Ordem = a pedida.
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'pack_id', x.pack_id, 'owner_id', x.owner_id, 'role', x.role, 'name', x.name,
           'date_start', x.date_start, 'date_stop', x.date_stop) ORDER BY x.ord), '[]'::jsonb),
         coalesce(jsonb_agg(jsonb_build_object('pack_id', x.pack_id, 'owner_id', x.owner_id) ORDER BY x.ord), '[]'::jsonb),
         pg_catalog.array_agg(x.pack_id ORDER BY x.ord),
         min(least(x.date_start, x.date_stop)),
         max(greatest(x.date_start, x.date_stop))
    INTO v_packs, v_pairs, v_ids, v_start, v_stop
  FROM (
    SELECT DISTINCT ON (a.pack_id) a.pack_id, a.owner_id, a.role, p.name, p.date_start, p.date_stop, req.ord
    FROM pg_catalog.unnest(p_pack_ids) WITH ORDINALITY AS req(pack_id, ord)
    JOIN public.resolve_pack_access(p_pack_ids, p_actor_id) a ON a.pack_id = req.pack_id
    JOIN public.packs p ON p.id = a.pack_id AND p.user_id = a.owner_id
    ORDER BY a.pack_id, req.ord
  ) x;

  SELECT coalesce(jsonb_agg(req.pack_id ORDER BY req.ord), '[]'::jsonb) INTO v_missing
  FROM pg_catalog.unnest(p_pack_ids) WITH ORDINALITY AS req(pack_id, ord)
  WHERE NOT (req.pack_id = ANY (coalesce(v_ids, ARRAY[]::uuid[])));

  -- Evento: mesma normalizacao da RPC do Manager (sem prefixo => 'conversion:').
  -- Chave desconhecida => NULL => `resultados` 0, como na v145.
  IF v_key <> '' AND v_key NOT LIKE 'conversion:%' AND v_key NOT LIKE 'action:%' THEN
    v_key := 'conversion:' || v_key;
  END IF;
  IF v_key = '' THEN
    v_key := NULL;
  ELSE
    SELECT ck.id INTO v_key_id FROM public.conversion_keys ck WHERE ck.key = v_key;
  END IF;

  -- Corte unico de MQL para a selecao acessivel; NULL = indisponivel (nunca 0).
  IF v_ids IS NOT NULL THEN
    v_mql := public.resolve_pack_mql_leadscore_min(p_actor_id, v_ids);
    IF v_mql IS NOT NULL AND v_mql < 0 THEN v_mql := NULL; END IF;
  END IF;

  IF v_ids IS NOT NULL THEN
    INSERT INTO chat.query_scopes (token, pairs, conv_key_id, mql_cut, fence_start, fence_stop, expires_at)
    VALUES (v_token, v_pairs, v_key_id, v_mql, v_start, v_stop,
            pg_catalog.now() + make_interval(secs => greatest(30, least(coalesce(p_ttl_seconds, 300), 900))));
  ELSE
    v_token := NULL;   -- nada acessivel: nao ha escopo a abrir
  END IF;

  RETURN jsonb_build_object(
    'token', v_token,
    'packs', v_packs,
    'missing_pack_ids', v_missing,
    'action_key', v_key,
    'conv_key_id', v_key_id,
    'mql_cut', v_mql,
    'fence_start', v_start,
    'fence_stop', v_stop
  );
END $$;


ALTER FUNCTION public.chat_open_scope(p_actor_id uuid, p_pack_ids uuid[], p_action_key text, p_ttl_seconds integer) OWNER TO postgres;

--
-- Name: chat_release_lease(uuid, uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.chat_release_lease(p_user_id uuid, p_message_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE v_n integer;
BEGIN
  DELETE FROM public.chat_user_leases WHERE user_id = p_user_id AND message_id = p_message_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n > 0;
END $$;


ALTER FUNCTION public.chat_release_lease(p_user_id uuid, p_message_id uuid) OWNER TO postgres;

--
-- Name: check_plan_cache_mode_gaps(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.check_plan_cache_mode_gaps() RETURNS TABLE(funcao text, motivo text)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  select
    p.oid::regprocedure::text as funcao,
    'usa o padrao "p_x is null or" e esta SEM plan_cache_mode=force_custom_plan' as motivo
  from pg_proc p
  join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public'
    and p.prokind = 'f'
    -- exclui a si mesma: o corpo desta funcao contem o padrao que ela procura
    and p.proname <> 'check_plan_cache_mode_gaps'
    and p.prosrc ~ 'p_\w+ is null or'
    and coalesce(array_to_string(p.proconfig, ','), '')
        not like '%plan_cache_mode=force_custom_plan%'
  order by 1
$$;


ALTER FUNCTION public.check_plan_cache_mode_gaps() OWNER TO postgres;

--
-- Name: FUNCTION check_plan_cache_mode_gaps(); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.check_plan_cache_mode_gaps() IS 'Guarda-chuva da migration 120. DEVE retornar zero linhas. Qualquer linha = RPC com parametro opcional sem plan_cache_mode=force_custom_plan, sujeita ao cliff de generic plan (~270x, vira 57014). Fix: ALTER FUNCTION <sig> SET plan_cache_mode = force_custom_plan;';


--
-- Name: claim_job_processing(text, uuid, text, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.claim_job_processing(p_job_id text, p_user_id uuid, p_owner text, p_lease_seconds integer DEFAULT 300) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$



DECLARE



  v_status text;



  v_claimed boolean := false;



BEGIN
  -- Guard de tenancy (migration 113): caller autenticado so opera o PROPRIO
  -- silo; service role (auth.uid() nulo) passa - e o caminho do backend para
  -- operacoes de pack compartilhado (P3.3), que ja derivou o dono via
  -- resolve_pack_access antes de chegar aqui.
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Forbidden: p_user_id must match auth.uid()';
  END IF;











  UPDATE public.jobs



  SET



    status = CASE WHEN status = 'meta_completed' THEN 'processing' ELSE status END,



    message = CASE WHEN status = 'meta_completed' THEN 'Iniciando coleta de anúncios...' ELSE message END,



    processing_owner = p_owner,



    processing_claimed_at = now(),



    processing_lease_until = now() + make_interval(secs => GREATEST(p_lease_seconds, 30)),



    processing_attempts = COALESCE(processing_attempts, 0) + 1,



    updated_at = now()



  WHERE id = p_job_id



    AND user_id = p_user_id



    AND status IN ('meta_completed', 'processing', 'persisting')



    AND (



      status = 'meta_completed'



      OR processing_lease_until IS NULL



      OR processing_lease_until <= now()



      OR processing_owner = p_owner



    )



  RETURNING status INTO v_status;







  v_claimed := FOUND;







  RETURN jsonb_build_object(



    'claimed', v_claimed,



    'status', COALESCE(v_status, ''),



    'owner', CASE WHEN v_claimed THEN p_owner ELSE NULL END



  );



END;



$$;


ALTER FUNCTION public.claim_job_processing(p_job_id text, p_user_id uuid, p_owner text, p_lease_seconds integer) OWNER TO postgres;

--
-- Name: FUNCTION claim_job_processing(p_job_id text, p_user_id uuid, p_owner text, p_lease_seconds integer); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.claim_job_processing(p_job_id text, p_user_id uuid, p_owner text, p_lease_seconds integer) IS 'Adquire lease de processamento do job de forma atômica. Permite claim inicial e self-healing apenas quando o lease expirou.';


--
-- Name: clear_ad_metrics_enrichment(uuid, uuid, boolean); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.clear_ad_metrics_enrichment(p_user_id uuid, p_pack_id uuid, p_dry_run boolean DEFAULT true) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    SET plan_cache_mode TO 'force_custom_plan'
    AS $$
DECLARE
  v_leadscore_rows int := 0;
  v_custom_rows    int := 0;
  v_total_rows     int := 0;
  v_cleared        int := 0;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Forbidden: p_user_id must match auth.uid()';
  END IF;
  IF p_pack_id IS NULL THEN
    RAISE EXCEPTION 'clear_ad_metrics_enrichment exige p_pack_id: sem pack o predicado pegaria o silo inteiro';
  END IF;

  SELECT count(*)::int, count(*) FILTER (WHERE t.has_leadscore)::int, count(*) FILTER (WHERE t.has_custom)::int
  INTO v_total_rows, v_leadscore_rows, v_custom_rows
  FROM public.ad_metrics_enrichment_targets(p_user_id, p_pack_id) t;

  IF NOT p_dry_run AND v_total_rows > 0 THEN
    -- Pelo pack, nao por `id IN (...)`: o id deixou de ser unico e apagaria a
    -- copia de outro pack.
    UPDATE public.ad_metrics am
    SET leadscore_values = NULL, custom_hist = NULL, updated_at = now()
    WHERE am.user_id = p_user_id AND am.pack_id = p_pack_id
      AND (am.leadscore_values IS NOT NULL OR am.custom_hist IS NOT NULL);
    GET DIAGNOSTICS v_cleared = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'status', 'success',
    'dry_run', p_dry_run,
    'rows_matched', v_total_rows,
    'rows_with_leadscore', v_leadscore_rows,
    'rows_with_custom', v_custom_rows,
    'rows_cleared', v_cleared,
    -- Desde a 145 a linha e do pack: limpar A nunca alcanca B. Campos mantidos
    -- pelo contrato do frontend, sempre zero.
    'rows_shared_with_other_packs', 0,
    'other_packs_affected', 0
  );
END;
$$;


ALTER FUNCTION public.clear_ad_metrics_enrichment(p_user_id uuid, p_pack_id uuid, p_dry_run boolean) OWNER TO postgres;

--
-- Name: FUNCTION clear_ad_metrics_enrichment(p_user_id uuid, p_pack_id uuid, p_dry_run boolean); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.clear_ad_metrics_enrichment(p_user_id uuid, p_pack_id uuid, p_dry_run boolean) IS 'Apaga leadscore_values e custom_hist das linhas de ad_metrics de UM pack. p_dry_run=true so conta. Desde a 145 a linha pertence ao pack: nao ha compartilhamento a avisar.';


--
-- Name: detect_pack_conflicts(uuid[], uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.detect_pack_conflicts(p_pack_ids uuid[], p_actor_id uuid) RETURNS TABLE(pack_a uuid, pack_b uuid)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    SET statement_timeout TO '20s'
    AS $$
  with acc as (
    select a.pack_id, a.owner_id
    from public.resolve_pack_access(p_pack_ids, p_actor_id) a
  ),
  scoped as (
    select m.pack_id, m.ad_id, m.metric_date
    from acc a
    join public.ad_metric_pack_map m
      on m.user_id = a.owner_id
     and m.pack_id = a.pack_id
  ),
  dup as (
    -- (user_id, pack_id, ad_id, metric_date) e a PK do mapa, entao count(*) > 1
    -- num grupo (ad_id, metric_date) ja significa "mais de um pack".
    select ad_id, metric_date, array_agg(pack_id) as packs
    from scoped
    group by ad_id, metric_date
    having count(*) > 1
  )
  select distinct p1 as pack_a, p2 as pack_b
  from dup, unnest(packs) p1, unnest(packs) p2
  where p1 < p2;
$$;


ALTER FUNCTION public.detect_pack_conflicts(p_pack_ids uuid[], p_actor_id uuid) OWNER TO postgres;

--
-- Name: FUNCTION detect_pack_conflicts(p_pack_ids uuid[], p_actor_id uuid); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.detect_pack_conflicts(p_pack_ids uuid[], p_actor_id uuid) IS 'Pares de packs acessiveis ao ator que compartilham ao menos um (ad_id, dia) — qualquer dono, desde a 145. Le o pertencimento do mapa, sem pre-filtro por metadado do pack: janela e ad_ids do pack podem estar defasados do mapa e esconderiam conflito real (146). statement_timeout proprio de 25s porque o papel de servico do PostgREST so tem 8s.';


--
-- Name: dissolve_folder(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.dissolve_folder(p_folder_id uuid) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_parent uuid;
  v_pos integer;
  v_folders integer;
  v_packs integer;
BEGIN
  -- Mesma trava da árvore que o trigger usa: sem ela, outra aba movendo uma pasta
  -- (ou um pack) para dentro desta DEPOIS da foto abaixo e ANTES do DELETE veria o
  -- conteúdo novo cair na raiz pela FK, em vez de subir um nível.
  PERFORM pg_advisory_xact_lock(hashtextextended('folders_tree:' || v_uid::text, 0));

  SELECT parent_id, position INTO v_parent, v_pos
  FROM public.folders WHERE id = p_folder_id AND user_id = v_uid
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'folder_not_found' USING ERRCODE = 'P0001', HINT = 'Pasta nao encontrada.';
  END IF;

  SELECT count(*)::integer INTO v_folders FROM public.folders WHERE parent_id = p_folder_id AND user_id = v_uid;

  -- Nova ordem do grupo de cima: os irmãos como estavam, com as subpastas da
  -- desfeita entrando no lugar dela (mesma posição, e a ordem interna delas).
  WITH grp AS (
    SELECT id, position AS p1, 0 AS lvl, 0 AS p2, name
    FROM public.folders
    WHERE user_id = v_uid AND parent_id IS NOT DISTINCT FROM v_parent AND id <> p_folder_id
    UNION ALL
    SELECT id, v_pos, 1, position, name
    FROM public.folders
    WHERE user_id = v_uid AND parent_id = p_folder_id
  ),
  ranked AS (
    SELECT id, (row_number() OVER (ORDER BY p1, lvl, p2, name) - 1)::integer AS pos FROM grp
  )
  UPDATE public.folders f
  SET parent_id = v_parent, position = r.pos
  FROM ranked r
  WHERE f.id = r.id
    AND (f.parent_id IS DISTINCT FROM v_parent OR f.position IS DISTINCT FROM r.pos);

  IF v_parent IS NULL THEN
    DELETE FROM public.pack_folder_members WHERE folder_id = p_folder_id AND user_id = v_uid;
  ELSE
    UPDATE public.pack_folder_members SET folder_id = v_parent WHERE folder_id = p_folder_id AND user_id = v_uid;
  END IF;
  GET DIAGNOSTICS v_packs = ROW_COUNT;

  DELETE FROM public.folders WHERE id = p_folder_id AND user_id = v_uid;

  RETURN jsonb_build_object('parent_id', v_parent, 'folders_moved', v_folders, 'packs_moved', v_packs);
END;
$$;


ALTER FUNCTION public.dissolve_folder(p_folder_id uuid) OWNER TO postgres;

--
-- Name: FUNCTION dissolve_folder(p_folder_id uuid); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.dissolve_folder(p_folder_id uuid) IS 'Desfaz a pasta: subpastas e packs sobem para a pasta de cima, no lugar dela; na raiz os packs ficam soltos (migration 174).';


--
-- Name: fetch_entity_performance_v145(uuid, date, date, text, text, uuid[], text, boolean, integer, boolean); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.fetch_entity_performance_v145(p_user_id uuid, p_date_start date, p_date_stop date, p_entity text, p_entity_id text, p_pack_ids uuid[] DEFAULT NULL::uuid[], p_group_by text DEFAULT 'entity'::text, p_include_curve boolean DEFAULT false, p_series_days integer DEFAULT NULL::integer, p_include_custom boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    SET plan_cache_mode TO 'force_custom_plan'
    AS $$
declare
  v_entity text := lower(coalesce(p_entity, ''));
  v_group_by text := lower(coalesce(p_group_by, 'entity'));
  v_date_start date := least(p_date_start, p_date_stop);
  v_date_stop date := greatest(p_date_start, p_date_stop);
  v_include_curve boolean := coalesce(p_include_curve, false);
  -- Linhas por DIA só da janela pedida (as telas de detalhe/filhos usam 5 dias de
  -- sparkline; só o histórico usa o período inteiro). Medido: os filhos do conjunto
  -- mais pesado (29 anúncios × 9 meses) saíam com 1,4 MB de dias que ninguém lia.
  v_series_start date;
  v_owners uuid[];
  v_requested integer;
  v_mql numeric;
  -- 140: histogramas das colunas vinculadas so quando pedidos (opt-in).
  v_include_custom boolean := coalesce(p_include_custom, false);
  v_result jsonb;
begin
  if auth.uid() is distinct from p_user_id then
    raise exception 'Forbidden: p_user_id must match auth.uid()'
      using errcode = '42501';
  end if;
  if v_entity not in ('ad_id', 'ad_name', 'adset_id') then
    raise exception 'Invalid p_entity: %, expected ad_id|ad_name|adset_id', v_entity
      using errcode = '22023';
  end if;
  if v_group_by not in ('entity', 'ad_id') then
    raise exception 'Invalid p_group_by: %, expected entity|ad_id', v_group_by
      using errcode = '22023';
  end if;
  if coalesce(p_entity_id, '') = '' then
    raise exception 'p_entity_id is required' using errcode = '22023';
  end if;

  -- Escopo: idêntico à base do Manager (v130/v132).
  if p_pack_ids is null then
    v_owners := array[p_user_id];
  else
    select array_agg(distinct a.owner_id), count(distinct a.pack_id)
      into v_owners, v_requested
    from public.resolve_pack_access(p_pack_ids, p_user_id) a;
    if coalesce(v_requested, 0) < (select count(distinct x) from unnest(p_pack_ids) x) then
      raise exception 'Forbidden: pack inacessivel na selecao'
        using errcode = '42501';
    end if;
    if v_owners is null or array_length(v_owners, 1) is null then
      v_owners := array[p_user_id];
    end if;
  end if;

  -- Corte de MQL dos packs (NULL = indefinido ou divergente; sem packs = NULL).
  v_mql := public.resolve_pack_mql_leadscore_min(p_user_id, p_pack_ids);

  v_series_start := case
    when p_series_days is null or p_series_days <= 0 then v_date_start
    else greatest(v_date_start, v_date_stop - (p_series_days - 1))
  end;

  with
  -- 1. Chaves (silo, anúncio, dia) da entidade no período, por índice de ad_metrics.
  --    Os três ramos do OR são constantes sob force_custom_plan: o planner poda os
  --    dois falsos e usa o índice do verdadeiro.
  keys as (
    select am.user_id, am.pack_id, am.ad_id, am.date
    from unnest(v_owners) as o(owner_id)
    join public.ad_performance_daily am
      on am.user_id = o.owner_id
     and am.date >= v_date_start
     and am.date <= v_date_stop
     and (
       (v_entity = 'ad_id' and am.ad_id = p_entity_id)
       or (v_entity = 'ad_name' and am.ad_name = p_entity_id)
       or (v_entity = 'adset_id' and am.adset_id = p_entity_id)
     )
    where p_pack_ids is null
       or am.pack_id = any(p_pack_ids)
  ),
  -- 2. Dedup cross-silo: uma linha por (anúncio, dia); vence o silo que NÃO é o do
  --    ator (o dono do pack compartilhado), desempate por uuid — regra da v104/v130.
  dedup as (
    select k.user_id, k.pack_id, k.ad_id, k.date
    from (
      select k.*, row_number() over (partition by k.ad_id, k.date order by (k.user_id = p_user_id), k.user_id) as rn
      from keys k
    ) k
    where k.rn = 1
  ),
  -- 2b. (v134) Packs de cada anúncio, para a linha-filha poder ser filtrada por
  --     Pack. Segunda visita a ad_metric_pack_map — a primeira, em `keys`, só
  --     decide se o anúncio-dia entra; aqui coletamos os ids. Roda sobre `dedup`
  --     (uma linha por anúncio-dia, já resolvido o cross-silo) e agrega por
  --     anúncio, não por dia.
  --
  --     RESTRITO À SELEÇÃO, igual ao `pack_ids` da base do Manager: devolver o
  --     universo faria o filtro oferecer pack que não está na tela e produzir
  --     tabela vazia sem explicação.
  packs_by_ad as (
    select
      d.ad_id,
      coalesce(
        array_agg(distinct d.pack_id),
        array[]::uuid[]
      ) as pack_ids
    from dedup d
    group by d.ad_id
  ),
  -- 3. As linhas: SÓ o read model, pela PK.
  rows_ as (
    select
      case when v_group_by = 'ad_id' then d.ad_id else p_entity_id end as group_key,
      d.*
    from dedup k
    join public.ad_performance_daily d on d.user_id = k.user_id and d.pack_id = k.pack_id and d.ad_id = k.ad_id and d.date = k.date
  ),
  -- 4. Grupo × dia (só a janela de série): somas e somas ponderadas por plays (as
  --    razões saem em Python, com a mesma fórmula do Manager).
  days as (
    select
      r.group_key,
      r.date,
      sum(r.impressions)::bigint as impressions,
      sum(r.clicks)::bigint as clicks,
      sum(r.inline_link_clicks)::bigint as inline_link_clicks,
      sum(r.spend)::numeric as spend,
      sum(r.lpv)::bigint as lpv,
      sum(r.plays)::bigint as plays,
      sum(r.thruplays)::bigint as thruplays,
      sum(r.hook_value * r.plays)::numeric as hook_wsum,
      sum(r.scroll_stop_value * r.plays)::numeric as scroll_stop_wsum,
      sum(r.hold_rate * r.plays)::numeric as hold_rate_wsum,
      sum(r.video_watched_p50 * r.plays)::numeric as video_watched_p50_wsum,
      sum(r.video_watched_p75 * r.plays)::numeric as video_watched_p75_wsum,
      sum(r.reach)::bigint as reach
    from rows_ r
    where r.date >= v_series_start
    group by r.group_key, r.date
  ),
  -- Conversões por (grupo, dia): agrupa por id da chave ANTES de juntar o dicionário
  -- (lição da v130: juntar par a par antes de agrupar custava segundos).
  conv_days as (
    select s.group_key, s.date,
           jsonb_object_agg(ck.key, s.total order by ck.key) as conversions
    from (
      select r.group_key, r.date, pr.key_id, sum(pr.value)::numeric as total
      from rows_ r
      cross join lateral unnest(r.conv_key_ids, r.conv_values) as pr(key_id, value)
      where r.date >= v_series_start
      group by r.group_key, r.date, pr.key_id
    ) s
    join public.conversion_keys ck on ck.id = s.key_id
    group by s.group_key, s.date
  ),
  -- Leads por (grupo, dia): histograma score → quantidade (chave normalizada, 80.0 → "80").
  lead_days as (
    select s.group_key, s.date,
           jsonb_object_agg(trim_scale(s.score)::text, s.qty order by s.score) as leads
    from (
      select r.group_key, r.date, l.score, sum(l.qty)::integer as qty
      from rows_ r
      cross join lateral unnest(r.lead_scores, r.lead_qtys) as l(score, qty)
      where r.date >= v_series_start
      group by r.group_key, r.date, l.score
    ) s
    group by s.group_key, s.date
  ),
  -- Totais do período inteiro por grupo (as telas de detalhe/filhos somam o período
  -- todo e mostram só 5 dias de série).
  totals as (
    select
      r.group_key,
      sum(r.impressions)::bigint as impressions,
      sum(r.clicks)::bigint as clicks,
      sum(r.inline_link_clicks)::bigint as inline_link_clicks,
      sum(r.spend)::numeric as spend,
      sum(r.lpv)::bigint as lpv,
      sum(r.plays)::bigint as plays,
      sum(r.thruplays)::bigint as thruplays,
      sum(r.hook_value * r.plays)::numeric as hook_wsum,
      sum(r.scroll_stop_value * r.plays)::numeric as scroll_stop_wsum,
      sum(r.hold_rate * r.plays)::numeric as hold_rate_wsum,
      sum(r.video_watched_p50 * r.plays)::numeric as video_watched_p50_wsum,
      sum(r.video_watched_p75 * r.plays)::numeric as video_watched_p75_wsum,
      sum(r.reach)::bigint as reach
    from rows_ r
    group by r.group_key
  ),
  conv_totals as (
    select s.group_key, jsonb_object_agg(ck.key, s.total order by ck.key) as conversions
    from (
      select r.group_key, pr.key_id, sum(pr.value)::numeric as total
      from rows_ r
      cross join lateral unnest(r.conv_key_ids, r.conv_values) as pr(key_id, value)
      group by r.group_key, pr.key_id
    ) s
    join public.conversion_keys ck on ck.id = s.key_id
    group by s.group_key
  ),
  lead_totals as (
    select s.group_key, jsonb_object_agg(trim_scale(s.score)::text, s.qty order by s.score) as leads
    from (
      select r.group_key, l.score, sum(l.qty)::integer as qty
      from rows_ r
      cross join lateral unnest(r.lead_scores, r.lead_qtys) as l(score, qty)
      group by r.group_key, l.score
    ) s
    group by s.group_key
  ),
  -- 140: histogramas das colunas vinculadas, somados no PERIODO inteiro por grupo
  -- (a entidade, ou cada filho). Sem serie por dia no v1. Opt-in por p_include_custom.
  custom_totals as (
    select y.group_key, jsonb_object_agg(y.mapping_id, y.hist) as custom_histograms
    from (
      select x.group_key, x.mapping_id, jsonb_object_agg(x.val, x.qty) as hist
      from (
        select r.group_key, m.key as mapping_id, v.key as val, sum(v.value::bigint)::bigint as qty
        from rows_ r
        cross join lateral jsonb_each(r.custom_hist) as m(key, value)
        cross join lateral jsonb_each_text(m.value) as v(key, value)
        where v_include_custom and r.custom_hist is not null
        group by r.group_key, m.key, v.key
      ) x
      group by x.group_key, x.mapping_id
    ) y
    group by y.group_key
  ),
  total_rows as (
    select
      t.group_key,
      jsonb_build_object(
        'impressions', t.impressions,
        'clicks', t.clicks,
        'inline_link_clicks', t.inline_link_clicks,
        'spend', t.spend,
        'lpv', t.lpv,
        'plays', t.plays,
        'thruplays', t.thruplays,
        'hook_wsum', t.hook_wsum,
        'scroll_stop_wsum', t.scroll_stop_wsum,
        'hold_rate_wsum', t.hold_rate_wsum,
        'video_watched_p50_wsum', t.video_watched_p50_wsum,
        'video_watched_p75_wsum', t.video_watched_p75_wsum,
        'reach', t.reach,
        'conversions', coalesce(c.conversions, '{}'::jsonb),
        'leads', coalesce(l.leads, '{}'::jsonb),
        'custom_histograms', coalesce(cu.custom_histograms, '{}'::jsonb)
      ) as item
    from totals t
    left join conv_totals c on c.group_key = t.group_key
    left join lead_totals l on l.group_key = t.group_key
    left join custom_totals cu on cu.group_key = t.group_key
  ),
  day_rows as (
    select
      d.group_key,
      d.date,
      jsonb_build_object(
        'date', d.date,
        'impressions', d.impressions,
        'clicks', d.clicks,
        'inline_link_clicks', d.inline_link_clicks,
        'spend', d.spend,
        'lpv', d.lpv,
        'plays', d.plays,
        'thruplays', d.thruplays,
        'hook_wsum', d.hook_wsum,
        'scroll_stop_wsum', d.scroll_stop_wsum,
        'hold_rate_wsum', d.hold_rate_wsum,
        'video_watched_p50_wsum', d.video_watched_p50_wsum,
        'video_watched_p75_wsum', d.video_watched_p75_wsum,
        'reach', d.reach,
        'conversions', coalesce(c.conversions, '{}'::jsonb),
        'leads', coalesce(l.leads, '{}'::jsonb)
      ) as item
    from days d
    left join conv_days c on c.group_key = d.group_key and c.date = d.date
    left join lead_days l on l.group_key = d.group_key and l.date = d.date
  ),
  -- 5. Representante — MESMA regra da base do Manager: por anúncio, o dia de mais
  --    impressões (desempate: mais recente); no grupo, (impressões, ad_id) máximos.
  per_ad as (
    select
      r.group_key,
      r.user_id,
      r.ad_id,
      max((lpad(r.impressions::text, 12, '0') || e'\x1f' || r.date::text) collate "C") as rep_enc
    from rows_ r
    group by r.group_key, r.user_id, r.ad_id
  ),
  grp as (
    select
      p.group_key,
      count(distinct p.ad_id)::integer as ad_count,
      max((substr(p.rep_enc, 1, 12) || e'\x1f' || p.ad_id || e'\x1f' || p.user_id::text
           || e'\x1f' || p.rep_enc) collate "C") as rep_enc,
      -- fallback de miniatura: qualquer cópia do grupo com arquivo no Storage (v132)
      max(nullif(a.thumb_storage_path, '')) as any_thumb_storage_path
    from per_ad p
    left join public.ads a
      on a.user_id = p.user_id
     and a.ad_id = p.ad_id
    group by p.group_key
  ),
  grp_dec as (
    select
      g.*,
      (split_part(g.rep_enc, e'\x1f', 2) collate "default") as rep_ad_id,
      (split_part(g.rep_enc, e'\x1f', 3))::uuid as rep_user_id,
      (split_part(g.rep_enc, e'\x1f', 5))::date as rep_date
    from grp g
  ),
  grp_rep as (
    select
      g.group_key,
      g.ad_count,
      g.rep_user_id,
      g.rep_ad_id,
      am.ad_name as rep_ad_name,
      am.account_id as rep_account_id,
      am.campaign_id as rep_campaign_id,
      am.campaign_name as rep_campaign_name,
      am.adset_id as rep_adset_id,
      am.adset_name as rep_adset_name,
      -- v134: a filha É um anúncio, então o pack do representante é o pack dela.
      coalesce(pba.pack_ids, array[]::uuid[]) as pack_ids,
      a.effective_status,
      coalesce(nullif(a.thumb_storage_path, ''), g.any_thumb_storage_path) as thumb_storage_path
    from grp_dec g
    left join packs_by_ad pba on pba.ad_id = g.rep_ad_id
    left join public.ad_metrics am on am.user_id = g.rep_user_id and (p_pack_ids is null or am.pack_id = any(p_pack_ids)) and am.ad_id = g.rep_ad_id and am.date = g.rep_date
    left join public.ads a
      on a.user_id = g.rep_user_id
     and a.ad_id = g.rep_ad_id
  ),
  -- 6. Curva de retenção ponderada por plays (só quando pedida): Σ ponto×plays e
  --    Σ plays POR ÍNDICE — uma linha de curva mais curta não pesa nos índices que
  --    não tem (semântica da rota antiga). A divisão e o arredondamento ficam em Python.
  curve as (
    select
      r.group_key,
      (e.idx - 1)::integer as idx,
      sum(public.ad_performance_parse_value(e.val #>> '{}') * r.plays)::numeric as wsum,
      sum(r.plays)::bigint as psum
    from rows_ r
    join public.ad_metrics am on am.user_id = r.user_id and am.pack_id = r.pack_id and am.ad_id = r.ad_id and am.date = r.date
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(am.video_play_curve_actions) = 'array' then am.video_play_curve_actions else '[]'::jsonb end
    ) with ordinality as e(val, idx)
    where v_include_curve
      and r.plays > 0
    group by r.group_key, e.idx
  ),
  curve_arr as (
    select
      m.group_key,
      jsonb_agg(coalesce(x.wsum, 0) order by i) as curve_wsum,
      jsonb_agg(coalesce(x.psum, 0) order by i) as curve_psum
    from (select c.group_key, max(c.idx) as mx from curve c group by c.group_key) m
    cross join generate_series(0, m.mx) as i
    left join curve x on x.group_key = m.group_key and x.idx = i
    group by m.group_key
  )
  select jsonb_build_object(
    'mql_leadscore_min', v_mql,
    'groups', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'group_key', g.group_key,
          'ad_count', g.ad_count,
          'user_id', g.rep_user_id,
          'ad_id', g.rep_ad_id,
          'ad_name', g.rep_ad_name,
          'account_id', g.rep_account_id,
          'pack_ids', g.pack_ids,
          'campaign_id', g.rep_campaign_id,
          'campaign_name', g.rep_campaign_name,
          'adset_id', g.rep_adset_id,
          'adset_name', g.rep_adset_name,
          'effective_status', g.effective_status,
          'thumb_storage_path', g.thumb_storage_path,
          'curve_wsum', ca.curve_wsum,
          'curve_psum', ca.curve_psum,
          'totals', tr.item,
          'days', coalesce((
            select jsonb_agg(dr.item order by dr.date)
            from day_rows dr
            where dr.group_key = g.group_key
          ), '[]'::jsonb)
        )
        order by g.group_key
      )
      from grp_rep g
      join total_rows tr on tr.group_key = g.group_key
      left join curve_arr ca on ca.group_key = g.group_key
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;


ALTER FUNCTION public.fetch_entity_performance_v145(p_user_id uuid, p_date_start date, p_date_stop date, p_entity text, p_entity_id text, p_pack_ids uuid[], p_group_by text, p_include_curve boolean, p_series_days integer, p_include_custom boolean) OWNER TO postgres;

--
-- Name: FUNCTION fetch_entity_performance_v145(p_user_id uuid, p_date_start date, p_date_stop date, p_entity text, p_entity_id text, p_pack_ids uuid[], p_group_by text, p_include_curve boolean, p_series_days integer, p_include_custom boolean); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.fetch_entity_performance_v145(p_user_id uuid, p_date_start date, p_date_stop date, p_entity text, p_entity_id text, p_pack_ids uuid[], p_group_by text, p_include_curve boolean, p_series_days integer, p_include_custom boolean) IS 'Detalhe de uma entidade (145): a v135 sobre a chave com pack; packs_by_ad sem a segunda visita ao mapa.';


--
-- Name: fetch_entity_performance_v155(uuid, date, date, text, text, uuid[], text, boolean, integer, boolean); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.fetch_entity_performance_v155(p_user_id uuid, p_date_start date, p_date_stop date, p_entity text, p_entity_id text, p_pack_ids uuid[] DEFAULT NULL::uuid[], p_group_by text DEFAULT 'entity'::text, p_include_curve boolean DEFAULT false, p_series_days integer DEFAULT NULL::integer, p_include_custom boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    SET plan_cache_mode TO 'force_custom_plan'
    AS $$
declare
  v_entity text := lower(coalesce(p_entity, ''));
  v_group_by text := lower(coalesce(p_group_by, 'entity'));
  v_date_start date := least(p_date_start, p_date_stop);
  v_date_stop date := greatest(p_date_start, p_date_stop);
  v_include_curve boolean := coalesce(p_include_curve, false);
  -- Linhas por DIA só da janela pedida (as telas de detalhe/filhos usam 5 dias de
  -- sparkline; só o histórico usa o período inteiro). Medido: os filhos do conjunto
  -- mais pesado (29 anúncios × 9 meses) saíam com 1,4 MB de dias que ninguém lia.
  v_series_start date;
  v_owners uuid[];
  v_requested integer;
  v_mql numeric;
  -- 140: histogramas das colunas vinculadas so quando pedidos (opt-in).
  v_include_custom boolean := coalesce(p_include_custom, false);
  v_result jsonb;
begin
  if auth.uid() is distinct from p_user_id then
    raise exception 'Forbidden: p_user_id must match auth.uid()'
      using errcode = '42501';
  end if;
  if v_entity not in ('ad_id', 'ad_name', 'adset_id') then
    raise exception 'Invalid p_entity: %, expected ad_id|ad_name|adset_id', v_entity
      using errcode = '22023';
  end if;
  if v_group_by not in ('entity', 'ad_id') then
    raise exception 'Invalid p_group_by: %, expected entity|ad_id', v_group_by
      using errcode = '22023';
  end if;
  if coalesce(p_entity_id, '') = '' then
    raise exception 'p_entity_id is required' using errcode = '22023';
  end if;

  -- Escopo: idêntico à base do Manager (v130/v132).
  if p_pack_ids is null then
    v_owners := array[p_user_id];
  else
    select array_agg(distinct a.owner_id), count(distinct a.pack_id)
      into v_owners, v_requested
    from public.resolve_pack_access(p_pack_ids, p_user_id) a;
    if coalesce(v_requested, 0) < (select count(distinct x) from unnest(p_pack_ids) x) then
      raise exception 'Forbidden: pack inacessivel na selecao'
        using errcode = '42501';
    end if;
    if v_owners is null or array_length(v_owners, 1) is null then
      v_owners := array[p_user_id];
    end if;
  end if;

  -- Corte de MQL dos packs (NULL = indefinido ou divergente; sem packs = NULL).
  v_mql := public.resolve_pack_mql_leadscore_min(p_user_id, p_pack_ids);

  v_series_start := case
    when p_series_days is null or p_series_days <= 0 then v_date_start
    else greatest(v_date_start, v_date_stop - (p_series_days - 1))
  end;

  with
  -- 1. Chaves (silo, anúncio, dia) da entidade no período, por índice de ad_metrics.
  --    Os três ramos do OR são constantes sob force_custom_plan: o planner poda os
  --    dois falsos e usa o índice do verdadeiro.
  keys as (
    select am.user_id, am.pack_id, am.ad_id, am.date
    from unnest(v_owners) as o(owner_id)
    join public.ad_performance_daily am
      on am.user_id = o.owner_id
     and am.date >= v_date_start
     and am.date <= v_date_stop
     and (
       (v_entity = 'ad_id' and am.ad_id = p_entity_id)
       or (v_entity = 'ad_name' and am.ad_name = p_entity_id)
       or (v_entity = 'adset_id' and am.adset_id = p_entity_id)
     )
    where p_pack_ids is null
       or am.pack_id = any(p_pack_ids)
  ),
  -- 2. Dedup cross-silo: uma linha por (anúncio, dia); vence o silo que NÃO é o do
  --    ator (o dono do pack compartilhado), desempate por uuid — regra da v104/v130.
  dedup as (
    select k.user_id, k.pack_id, k.ad_id, k.date
    from (
      select k.*, row_number() over (partition by k.ad_id, k.date order by (k.user_id = p_user_id), k.user_id) as rn
      from keys k
    ) k
    where k.rn = 1
  ),
  -- 2a. (v155) Inventário da entidade: anúncio ativo no período sem linha de métrica
  --     neste (silo, pack). Entra zerado e sem dias — o backend já preenche com zero o
  --     dia sem dado. Entre silos, a mesma preferência do dedup (vence o dono do pack
  --     compartilhado); dentro do silo vencedor, todos os packs (viram pack_ids).
  inv as (
    select x.user_id, x.pack_id, x.ad_id
    from (
      select i.user_id, i.pack_id, i.ad_id,
             dense_rank() over (partition by i.ad_id order by (i.user_id = p_user_id), i.user_id) as rk
      from unnest(v_owners) as o(owner_id)
      join public.ad_pack_inventory i
        on i.user_id = o.owner_id
       and i.first_active_date <= v_date_stop
       and i.last_active_date >= v_date_start
       and (
         (v_entity = 'ad_id' and i.ad_id = p_entity_id)
         or (v_entity = 'ad_name' and i.ad_name = p_entity_id)
         or (v_entity = 'adset_id' and i.adset_id = p_entity_id)
       )
      where (p_pack_ids is null or i.pack_id = any(p_pack_ids))
        -- Pelo read model e não por `keys`: `keys` só tem as linhas que casam com a
        -- entidade, e um anúncio renomeado tem linhas reais com o nome antigo.
        and not exists (
          select 1 from public.ad_performance_daily d
          where d.user_id = i.user_id and d.pack_id = i.pack_id and d.ad_id = i.ad_id
            and d.date >= v_date_start and d.date <= v_date_stop
        )
    ) x
    where x.rk = 1
  ),
  -- 2b. (v134) Packs de cada anúncio, para a linha-filha poder ser filtrada por
  --     Pack. Segunda visita a ad_metric_pack_map — a primeira, em `keys`, só
  --     decide se o anúncio-dia entra; aqui coletamos os ids. Roda sobre `dedup`
  --     (uma linha por anúncio-dia, já resolvido o cross-silo) e agrega por
  --     anúncio, não por dia.
  --
  --     RESTRITO À SELEÇÃO, igual ao `pack_ids` da base do Manager: devolver o
  --     universo faria o filtro oferecer pack que não está na tela e produzir
  --     tabela vazia sem explicação.
  packs_by_ad as (
    select
      d.ad_id,
      coalesce(
        array_agg(distinct d.pack_id),
        array[]::uuid[]
      ) as pack_ids
    -- (v155) mais os packs em que o anúncio só está no inventário
    from (select ad_id, pack_id from dedup union all select ad_id, pack_id from inv) d
    group by d.ad_id
  ),
  -- 3. As linhas: SÓ o read model, pela PK.
  --    (v155) Colunas explícitas: o inventário entra por union, zerado e sem dia
  --    (`date` nulo fica fora da série; arrays vazios não geram conversão nem lead).
  rows_ as (
    select
      case when v_group_by = 'ad_id' then d.ad_id else p_entity_id end as group_key,
      d.user_id, d.pack_id, d.ad_id, d.date,
      d.impressions, d.clicks, d.inline_link_clicks, d.spend, d.lpv, d.plays, d.thruplays,
      d.hook_value, d.scroll_stop_value, d.hold_rate, d.video_watched_p50, d.video_watched_p75,
      d.reach, d.conv_key_ids, d.conv_values, d.lead_scores, d.lead_qtys, d.custom_hist
    from dedup k
    join public.ad_performance_daily d on d.user_id = k.user_id and d.pack_id = k.pack_id and d.ad_id = k.ad_id and d.date = k.date

    union all

    select
      case when v_group_by = 'ad_id' then i.ad_id else p_entity_id end as group_key,
      i.user_id, i.pack_id, i.ad_id, null::date,
      0::bigint, 0::bigint, 0::bigint, 0::numeric, 0::bigint, 0::bigint, 0::bigint,
      0::numeric, 0::numeric, 0::numeric, 0::numeric, 0::numeric,
      0::bigint, '{}'::integer[], '{}'::numeric[], '{}'::numeric[], '{}'::integer[], null::jsonb
    from inv i
  ),
  -- 4. Grupo × dia (só a janela de série): somas e somas ponderadas por plays (as
  --    razões saem em Python, com a mesma fórmula do Manager).
  days as (
    select
      r.group_key,
      r.date,
      sum(r.impressions)::bigint as impressions,
      sum(r.clicks)::bigint as clicks,
      sum(r.inline_link_clicks)::bigint as inline_link_clicks,
      sum(r.spend)::numeric as spend,
      sum(r.lpv)::bigint as lpv,
      sum(r.plays)::bigint as plays,
      sum(r.thruplays)::bigint as thruplays,
      sum(r.hook_value * r.plays)::numeric as hook_wsum,
      sum(r.scroll_stop_value * r.plays)::numeric as scroll_stop_wsum,
      sum(r.hold_rate * r.plays)::numeric as hold_rate_wsum,
      sum(r.video_watched_p50 * r.plays)::numeric as video_watched_p50_wsum,
      sum(r.video_watched_p75 * r.plays)::numeric as video_watched_p75_wsum,
      sum(r.reach)::bigint as reach
    from rows_ r
    where r.date >= v_series_start
    group by r.group_key, r.date
  ),
  -- Conversões por (grupo, dia): agrupa por id da chave ANTES de juntar o dicionário
  -- (lição da v130: juntar par a par antes de agrupar custava segundos).
  conv_days as (
    select s.group_key, s.date,
           jsonb_object_agg(ck.key, s.total order by ck.key) as conversions
    from (
      select r.group_key, r.date, pr.key_id, sum(pr.value)::numeric as total
      from rows_ r
      cross join lateral unnest(r.conv_key_ids, r.conv_values) as pr(key_id, value)
      where r.date >= v_series_start
      group by r.group_key, r.date, pr.key_id
    ) s
    join public.conversion_keys ck on ck.id = s.key_id
    group by s.group_key, s.date
  ),
  -- Leads por (grupo, dia): histograma score → quantidade (chave normalizada, 80.0 → "80").
  lead_days as (
    select s.group_key, s.date,
           jsonb_object_agg(trim_scale(s.score)::text, s.qty order by s.score) as leads
    from (
      select r.group_key, r.date, l.score, sum(l.qty)::integer as qty
      from rows_ r
      cross join lateral unnest(r.lead_scores, r.lead_qtys) as l(score, qty)
      where r.date >= v_series_start
      group by r.group_key, r.date, l.score
    ) s
    group by s.group_key, s.date
  ),
  -- Totais do período inteiro por grupo (as telas de detalhe/filhos somam o período
  -- todo e mostram só 5 dias de série).
  totals as (
    select
      r.group_key,
      sum(r.impressions)::bigint as impressions,
      sum(r.clicks)::bigint as clicks,
      sum(r.inline_link_clicks)::bigint as inline_link_clicks,
      sum(r.spend)::numeric as spend,
      sum(r.lpv)::bigint as lpv,
      sum(r.plays)::bigint as plays,
      sum(r.thruplays)::bigint as thruplays,
      sum(r.hook_value * r.plays)::numeric as hook_wsum,
      sum(r.scroll_stop_value * r.plays)::numeric as scroll_stop_wsum,
      sum(r.hold_rate * r.plays)::numeric as hold_rate_wsum,
      sum(r.video_watched_p50 * r.plays)::numeric as video_watched_p50_wsum,
      sum(r.video_watched_p75 * r.plays)::numeric as video_watched_p75_wsum,
      sum(r.reach)::bigint as reach
    from rows_ r
    group by r.group_key
  ),
  conv_totals as (
    select s.group_key, jsonb_object_agg(ck.key, s.total order by ck.key) as conversions
    from (
      select r.group_key, pr.key_id, sum(pr.value)::numeric as total
      from rows_ r
      cross join lateral unnest(r.conv_key_ids, r.conv_values) as pr(key_id, value)
      group by r.group_key, pr.key_id
    ) s
    join public.conversion_keys ck on ck.id = s.key_id
    group by s.group_key
  ),
  lead_totals as (
    select s.group_key, jsonb_object_agg(trim_scale(s.score)::text, s.qty order by s.score) as leads
    from (
      select r.group_key, l.score, sum(l.qty)::integer as qty
      from rows_ r
      cross join lateral unnest(r.lead_scores, r.lead_qtys) as l(score, qty)
      group by r.group_key, l.score
    ) s
    group by s.group_key
  ),
  -- 140: histogramas das colunas vinculadas, somados no PERIODO inteiro por grupo
  -- (a entidade, ou cada filho). Sem serie por dia no v1. Opt-in por p_include_custom.
  custom_totals as (
    select y.group_key, jsonb_object_agg(y.mapping_id, y.hist) as custom_histograms
    from (
      select x.group_key, x.mapping_id, jsonb_object_agg(x.val, x.qty) as hist
      from (
        select r.group_key, m.key as mapping_id, v.key as val, sum(v.value::bigint)::bigint as qty
        from rows_ r
        cross join lateral jsonb_each(r.custom_hist) as m(key, value)
        cross join lateral jsonb_each_text(m.value) as v(key, value)
        where v_include_custom and r.custom_hist is not null
        group by r.group_key, m.key, v.key
      ) x
      group by x.group_key, x.mapping_id
    ) y
    group by y.group_key
  ),
  total_rows as (
    select
      t.group_key,
      jsonb_build_object(
        'impressions', t.impressions,
        'clicks', t.clicks,
        'inline_link_clicks', t.inline_link_clicks,
        'spend', t.spend,
        'lpv', t.lpv,
        'plays', t.plays,
        'thruplays', t.thruplays,
        'hook_wsum', t.hook_wsum,
        'scroll_stop_wsum', t.scroll_stop_wsum,
        'hold_rate_wsum', t.hold_rate_wsum,
        'video_watched_p50_wsum', t.video_watched_p50_wsum,
        'video_watched_p75_wsum', t.video_watched_p75_wsum,
        'reach', t.reach,
        'conversions', coalesce(c.conversions, '{}'::jsonb),
        'leads', coalesce(l.leads, '{}'::jsonb),
        'custom_histograms', coalesce(cu.custom_histograms, '{}'::jsonb)
      ) as item
    from totals t
    left join conv_totals c on c.group_key = t.group_key
    left join lead_totals l on l.group_key = t.group_key
    left join custom_totals cu on cu.group_key = t.group_key
  ),
  day_rows as (
    select
      d.group_key,
      d.date,
      jsonb_build_object(
        'date', d.date,
        'impressions', d.impressions,
        'clicks', d.clicks,
        'inline_link_clicks', d.inline_link_clicks,
        'spend', d.spend,
        'lpv', d.lpv,
        'plays', d.plays,
        'thruplays', d.thruplays,
        'hook_wsum', d.hook_wsum,
        'scroll_stop_wsum', d.scroll_stop_wsum,
        'hold_rate_wsum', d.hold_rate_wsum,
        'video_watched_p50_wsum', d.video_watched_p50_wsum,
        'video_watched_p75_wsum', d.video_watched_p75_wsum,
        'reach', d.reach,
        'conversions', coalesce(c.conversions, '{}'::jsonb),
        'leads', coalesce(l.leads, '{}'::jsonb)
      ) as item
    from days d
    left join conv_days c on c.group_key = d.group_key and c.date = d.date
    left join lead_days l on l.group_key = d.group_key and l.date = d.date
  ),
  -- 5. Representante — MESMA regra da base do Manager: por anúncio, o dia de mais
  --    impressões (desempate: mais recente); no grupo, (impressões, ad_id) máximos.
  per_ad as (
    select
      r.group_key,
      r.user_id,
      r.ad_id,
      max((lpad(r.impressions::text, 12, '0') || e'\x1f' || coalesce(r.date::text, '') || e'\x1f' || r.pack_id::text) collate "C") as rep_enc
    from rows_ r
    group by r.group_key, r.user_id, r.ad_id
  ),
  grp as (
    select
      p.group_key,
      count(distinct p.ad_id)::integer as ad_count,
      max((substr(p.rep_enc, 1, 12) || e'\x1f' || p.ad_id || e'\x1f' || p.user_id::text
           || e'\x1f' || p.rep_enc) collate "C") as rep_enc,
      -- fallback de miniatura: qualquer cópia do grupo com arquivo no Storage (v132)
      max(nullif(a.thumb_storage_path, '')) as any_thumb_storage_path
    from per_ad p
    left join public.ads a
      on a.user_id = p.user_id
     and a.ad_id = p.ad_id
    group by p.group_key
  ),
  grp_dec as (
    select
      g.*,
      (split_part(g.rep_enc, e'\x1f', 2) collate "default") as rep_ad_id,
      (split_part(g.rep_enc, e'\x1f', 3))::uuid as rep_user_id,
      nullif(split_part(g.rep_enc, e'\x1f', 5), '')::date as rep_date,
      nullif(split_part(g.rep_enc, e'\x1f', 6), '')::uuid as rep_pack_id
    from grp g
  ),
  grp_rep as (
    select
      g.group_key,
      g.ad_count,
      g.rep_user_id,
      g.rep_ad_id,
      -- (v155) representante sem dia (só inventário): nomes da linha do inventário.
      case when g.rep_date is null then ri.ad_name else am.ad_name end as rep_ad_name,
      case when g.rep_date is null then ri.account_id else am.account_id end as rep_account_id,
      case when g.rep_date is null then ri.campaign_id else am.campaign_id end as rep_campaign_id,
      case when g.rep_date is null then ri.campaign_name else am.campaign_name end as rep_campaign_name,
      case when g.rep_date is null then ri.adset_id else am.adset_id end as rep_adset_id,
      case when g.rep_date is null then ri.adset_name else am.adset_name end as rep_adset_name,
      -- v134: a filha É um anúncio, então o pack do representante é o pack dela.
      coalesce(pba.pack_ids, array[]::uuid[]) as pack_ids,
      a.effective_status,
      coalesce(nullif(a.thumb_storage_path, ''), g.any_thumb_storage_path) as thumb_storage_path
    from grp_dec g
    left join packs_by_ad pba on pba.ad_id = g.rep_ad_id
    left join public.ad_metrics am on am.user_id = g.rep_user_id and am.pack_id = g.rep_pack_id and am.ad_id = g.rep_ad_id and am.date = g.rep_date
    left join lateral (
      select i.ad_name, i.account_id, i.campaign_id, i.campaign_name, i.adset_id, i.adset_name
      from public.ad_pack_inventory i
      where g.rep_date is null
        and i.user_id = g.rep_user_id
        and (p_pack_ids is null or i.pack_id = any(p_pack_ids))
        and i.ad_id = g.rep_ad_id
      order by i.last_active_date desc, i.pack_id
      limit 1
    ) ri on true
    left join public.ads a
      on a.user_id = g.rep_user_id
     and a.ad_id = g.rep_ad_id
  ),
  -- 6. Curva de retenção ponderada por plays (só quando pedida): Σ ponto×plays e
  --    Σ plays POR ÍNDICE — uma linha de curva mais curta não pesa nos índices que
  --    não tem (semântica da rota antiga). A divisão e o arredondamento ficam em Python.
  curve as (
    select
      r.group_key,
      (e.idx - 1)::integer as idx,
      sum(public.ad_performance_parse_value(e.val #>> '{}') * r.plays)::numeric as wsum,
      sum(r.plays)::bigint as psum
    from rows_ r
    join public.ad_metrics am on am.user_id = r.user_id and am.pack_id = r.pack_id and am.ad_id = r.ad_id and am.date = r.date
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(am.video_play_curve_actions) = 'array' then am.video_play_curve_actions else '[]'::jsonb end
    ) with ordinality as e(val, idx)
    where v_include_curve
      and r.plays > 0
    group by r.group_key, e.idx
  ),
  curve_arr as (
    select
      m.group_key,
      jsonb_agg(coalesce(x.wsum, 0) order by i) as curve_wsum,
      jsonb_agg(coalesce(x.psum, 0) order by i) as curve_psum
    from (select c.group_key, max(c.idx) as mx from curve c group by c.group_key) m
    cross join generate_series(0, m.mx) as i
    left join curve x on x.group_key = m.group_key and x.idx = i
    group by m.group_key
  )
  select jsonb_build_object(
    'mql_leadscore_min', v_mql,
    'groups', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'group_key', g.group_key,
          'ad_count', g.ad_count,
          'user_id', g.rep_user_id,
          'ad_id', g.rep_ad_id,
          'ad_name', g.rep_ad_name,
          'account_id', g.rep_account_id,
          'pack_ids', g.pack_ids,
          'campaign_id', g.rep_campaign_id,
          'campaign_name', g.rep_campaign_name,
          'adset_id', g.rep_adset_id,
          'adset_name', g.rep_adset_name,
          'effective_status', g.effective_status,
          'thumb_storage_path', g.thumb_storage_path,
          'curve_wsum', ca.curve_wsum,
          'curve_psum', ca.curve_psum,
          'totals', tr.item,
          'days', coalesce((
            select jsonb_agg(dr.item order by dr.date)
            from day_rows dr
            where dr.group_key = g.group_key
          ), '[]'::jsonb)
        )
        order by g.group_key
      )
      from grp_rep g
      join total_rows tr on tr.group_key = g.group_key
      left join curve_arr ca on ca.group_key = g.group_key
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;


ALTER FUNCTION public.fetch_entity_performance_v155(p_user_id uuid, p_date_start date, p_date_stop date, p_entity text, p_entity_id text, p_pack_ids uuid[], p_group_by text, p_include_curve boolean, p_series_days integer, p_include_custom boolean) OWNER TO postgres;

--
-- Name: fetch_entity_performance_v157(uuid, date, date, text, text, uuid[], text, boolean, integer, boolean); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.fetch_entity_performance_v157(p_user_id uuid, p_date_start date, p_date_stop date, p_entity text, p_entity_id text, p_pack_ids uuid[] DEFAULT NULL::uuid[], p_group_by text DEFAULT 'entity'::text, p_include_curve boolean DEFAULT false, p_series_days integer DEFAULT NULL::integer, p_include_custom boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    SET plan_cache_mode TO 'force_custom_plan'
    AS $$
declare
  v_entity text := lower(coalesce(p_entity, ''));
  v_group_by text := lower(coalesce(p_group_by, 'entity'));
  v_date_start date := least(p_date_start, p_date_stop);
  v_date_stop date := greatest(p_date_start, p_date_stop);
  v_include_curve boolean := coalesce(p_include_curve, false);
  -- Linhas por DIA só da janela pedida (as telas de detalhe/filhos usam 5 dias de
  -- sparkline; só o histórico usa o período inteiro). Medido: os filhos do conjunto
  -- mais pesado (29 anúncios × 9 meses) saíam com 1,4 MB de dias que ninguém lia.
  v_series_start date;
  v_owners uuid[];
  v_requested integer;
  v_mql numeric;
  -- 140: histogramas das colunas vinculadas so quando pedidos (opt-in).
  v_include_custom boolean := coalesce(p_include_custom, false);
  v_result jsonb;
begin
  if auth.uid() is distinct from p_user_id then
    raise exception 'Forbidden: p_user_id must match auth.uid()'
      using errcode = '42501';
  end if;
  if v_entity not in ('ad_id', 'ad_name', 'adset_id') then
    raise exception 'Invalid p_entity: %, expected ad_id|ad_name|adset_id', v_entity
      using errcode = '22023';
  end if;
  if v_group_by not in ('entity', 'ad_id') then
    raise exception 'Invalid p_group_by: %, expected entity|ad_id', v_group_by
      using errcode = '22023';
  end if;
  if coalesce(p_entity_id, '') = '' then
    raise exception 'p_entity_id is required' using errcode = '22023';
  end if;

  -- Escopo: idêntico à base do Manager (v130/v132).
  if p_pack_ids is null then
    v_owners := array[p_user_id];
  else
    select array_agg(distinct a.owner_id), count(distinct a.pack_id)
      into v_owners, v_requested
    from public.resolve_pack_access(p_pack_ids, p_user_id) a;
    if coalesce(v_requested, 0) < (select count(distinct x) from unnest(p_pack_ids) x) then
      raise exception 'Forbidden: pack inacessivel na selecao'
        using errcode = '42501';
    end if;
    if v_owners is null or array_length(v_owners, 1) is null then
      v_owners := array[p_user_id];
    end if;
  end if;

  -- Corte de MQL dos packs (NULL = indefinido ou divergente; sem packs = NULL).
  v_mql := public.resolve_pack_mql_leadscore_min(p_user_id, p_pack_ids);

  v_series_start := case
    when p_series_days is null or p_series_days <= 0 then v_date_start
    else greatest(v_date_start, v_date_stop - (p_series_days - 1))
  end;

  with
  -- 1. Chaves (silo, anúncio, dia) da entidade no período, por índice de ad_metrics.
  --    Os três ramos do OR são constantes sob force_custom_plan: o planner poda os
  --    dois falsos e usa o índice do verdadeiro.
  keys as (
    select am.user_id, am.pack_id, am.ad_id, am.date
    from unnest(v_owners) as o(owner_id)
    join public.ad_performance_daily am
      on am.user_id = o.owner_id
     and am.date >= v_date_start
     and am.date <= v_date_stop
     and (
       (v_entity = 'ad_id' and am.ad_id = p_entity_id)
       or (v_entity = 'ad_name' and am.ad_name = p_entity_id)
       or (v_entity = 'adset_id' and am.adset_id = p_entity_id)
     )
    where p_pack_ids is null
       or am.pack_id = any(p_pack_ids)
  ),
  -- 2. Dedup cross-silo: uma linha por (anúncio, dia); vence o silo que NÃO é o do
  --    ator (o dono do pack compartilhado), desempate por uuid — regra da v104/v130.
  dedup as (
    select k.user_id, k.pack_id, k.ad_id, k.date
    from (
      select k.*, row_number() over (partition by k.ad_id, k.date order by (k.user_id = p_user_id), k.user_id) as rn
      from keys k
    ) k
    where k.rn = 1
  ),
  -- 2a. (v155) Inventário da entidade: anúncio ativo no período sem linha de métrica
  --     neste (silo, pack). Entra zerado e sem dias — o backend já preenche com zero o
  --     dia sem dado. Entre silos, a mesma preferência do dedup (vence o dono do pack
  --     compartilhado); dentro do silo vencedor, todos os packs (viram pack_ids).
  inv as (
    select x.user_id, x.pack_id, x.ad_id
    from (
      select i.user_id, i.pack_id, i.ad_id,
             dense_rank() over (partition by i.ad_id order by (i.user_id = p_user_id), i.user_id) as rk
      from unnest(v_owners) as o(owner_id)
      join public.ad_pack_inventory i
        on i.user_id = o.owner_id
       and i.first_active_date <= v_date_stop
       and i.last_active_date >= v_date_start
       and (
         (v_entity = 'ad_id' and i.ad_id = p_entity_id)
         or (v_entity = 'ad_name' and i.ad_name = p_entity_id)
         or (v_entity = 'adset_id' and i.adset_id = p_entity_id)
       )
      where (p_pack_ids is null or i.pack_id = any(p_pack_ids))
        -- Pelo read model e não por `keys`: `keys` só tem as linhas que casam com a
        -- entidade, e um anúncio renomeado tem linhas reais com o nome antigo.
        and not exists (
          select 1 from public.ad_performance_daily d
          where d.user_id = i.user_id and d.pack_id = i.pack_id and d.ad_id = i.ad_id
            and d.date >= v_date_start and d.date <= v_date_stop
        )
    ) x
    where x.rk = 1
  ),
  -- 2b. (v134) Packs de cada anúncio, para a linha-filha poder ser filtrada por
  --     Pack. Segunda visita a ad_metric_pack_map — a primeira, em `keys`, só
  --     decide se o anúncio-dia entra; aqui coletamos os ids. Roda sobre `dedup`
  --     (uma linha por anúncio-dia, já resolvido o cross-silo) e agrega por
  --     anúncio, não por dia.
  --
  --     RESTRITO À SELEÇÃO, igual ao `pack_ids` da base do Manager: devolver o
  --     universo faria o filtro oferecer pack que não está na tela e produzir
  --     tabela vazia sem explicação.
  packs_by_ad as (
    select
      d.ad_id,
      coalesce(
        array_agg(distinct d.pack_id),
        array[]::uuid[]
      ) as pack_ids
    -- (v155) mais os packs em que o anúncio só está no inventário
    from (select ad_id, pack_id from dedup union all select ad_id, pack_id from inv) d
    group by d.ad_id
  ),
  -- 3. As linhas: SÓ o read model, pela PK.
  --    (v155) Colunas explícitas: o inventário entra por union, zerado e sem dia
  --    (`date` nulo fica fora da série; arrays vazios não geram conversão nem lead).
  rows_ as (
    select
      case when v_group_by = 'ad_id' then d.ad_id else p_entity_id end as group_key,
      d.user_id, d.pack_id, d.ad_id, d.date,
      d.impressions, d.clicks, d.inline_link_clicks, d.spend, d.lpv, d.plays, d.thruplays,
      d.hook_value, d.scroll_stop_value, d.hold_rate, d.video_watched_p50, d.video_watched_p75,
      d.reach, d.conv_key_ids, d.conv_values, d.lead_scores, d.lead_qtys, d.custom_hist
    from dedup k
    join public.ad_performance_daily d on d.user_id = k.user_id and d.pack_id = k.pack_id and d.ad_id = k.ad_id and d.date = k.date

    union all

    select
      case when v_group_by = 'ad_id' then i.ad_id else p_entity_id end as group_key,
      i.user_id, i.pack_id, i.ad_id, null::date,
      0::bigint, 0::bigint, 0::bigint, 0::numeric, 0::bigint, 0::bigint, 0::bigint,
      0::numeric, 0::numeric, 0::numeric, 0::numeric, 0::numeric,
      0::bigint, '{}'::integer[], '{}'::numeric[], '{}'::numeric[], '{}'::integer[], null::jsonb
    from inv i
  ),
  -- ------------------------------------------------------------------------------
  -- (v157) DAQUI PARA BAIXO NINGUÉM JUNTA ETAPA COM ETAPA.
  --
  -- O planner estima 1 linha para toda etapa derivada de `keys` (não tem como saber
  -- que um nome de criativo repete em 600 anúncios). Com 1 linha estimada, qualquer
  -- junção entre duas etapas vira laço aninhado, e o lado de dentro é re-executado
  -- ou re-varrido POR GRUPO: custo N². Medido em produção (14-15/09, conta com 630
  -- anúncios num nome): v145 = 19 s a mais de 200 s; v155 = 0,3 a 2,4 s conforme o
  -- plano sorteado. MATERIALIZED pontual não resolve (13,6 s com um, 0,8 s com todos,
  -- ainda N²); lista de chaves pré-resolvida por unnest também não (15,5 s).
  --
  -- O desenho: cada parte do grupo (totais, conversões, leads, histogramas, curva,
  -- dias, representante) é calculada UMA vez por agregação e empilhada numa lista só
  -- (`parts`, `day_parts`) marcada pelo tipo; uma agregação por grupo monta o objeto.
  -- Agregar é linear seja qual for a estimativa. Os únicos laços que sobram são
  -- buscas por índice de uma linha (ads, ad_metrics, inventário) — N buscas, não N².
  -- Saída byte a byte idêntica à v155 (diferencial em 14 telas de produção e teste 157).
  -- ------------------------------------------------------------------------------

  -- 4. Grupo × dia (só a janela de série): somas e somas ponderadas por plays (as
  --    razões saem em Python, com a mesma fórmula do Manager).
  days as (
    select
      r.group_key,
      r.date,
      sum(r.impressions)::bigint as impressions,
      sum(r.clicks)::bigint as clicks,
      sum(r.inline_link_clicks)::bigint as inline_link_clicks,
      sum(r.spend)::numeric as spend,
      sum(r.lpv)::bigint as lpv,
      sum(r.plays)::bigint as plays,
      sum(r.thruplays)::bigint as thruplays,
      sum(r.hook_value * r.plays)::numeric as hook_wsum,
      sum(r.scroll_stop_value * r.plays)::numeric as scroll_stop_wsum,
      sum(r.hold_rate * r.plays)::numeric as hold_rate_wsum,
      sum(r.video_watched_p50 * r.plays)::numeric as video_watched_p50_wsum,
      sum(r.video_watched_p75 * r.plays)::numeric as video_watched_p75_wsum,
      sum(r.reach)::bigint as reach
    from rows_ r
    where r.date >= v_series_start
    group by r.group_key, r.date
  ),
  -- (v157) Dicionário de chaves de evento como UM objeto {id: chave}. Juntar com a
  -- tabela a cada (grupo, dia, chave) dependeria do planner escolher hash; a busca
  -- no objeto (~85 chaves) não depende de estimativa nenhuma. Lido por subconsulta
  -- escalar (roda uma vez) e só o NOME da chave segue adiante: com `cross join ck` o
  -- objeto inteiro ia dentro de cada linha e a ordenação de 3,4 mil linhas escorria
  -- 14 MB para disco (medido).
  ck as (
    select coalesce(jsonb_object_agg(k.id::text, k.key), '{}'::jsonb) as m
    from public.conversion_keys k
  ),
  -- Conversões por (grupo, dia): agrupa por id da chave ANTES de traduzir para o nome
  -- (lição da v130: juntar par a par antes de agrupar custava segundos). Chave sem
  -- entrada no dicionário fica fora, como no inner join da v155.
  --   (v157) Sem `order by` dentro do jsonb_object_agg: o jsonb guarda as chaves na
  --   ordem dele, e a ordem de entrada só decide empate de chave repetida — que não
  --   existe (key_id agrupado, conversion_keys.key é UNIQUE). A ordenação por texto com
  --   colação era o maior custo que sobrava no histórico longo de um anúncio.
  conv_days as (
    select s.group_key, s.date,
           jsonb_object_agg(s.key, s.total) as conversions
    from (
      select x.group_key, x.date, (select ck.m from ck) ->> x.key_id::text as key, x.total
      from (
        select r.group_key, r.date, pr.key_id, sum(pr.value)::numeric as total
        from rows_ r
        cross join lateral unnest(r.conv_key_ids, r.conv_values) as pr(key_id, value)
        where r.date >= v_series_start
        group by r.group_key, r.date, pr.key_id
      ) x
      where (select ck.m from ck) ? x.key_id::text
    ) s
    group by s.group_key, s.date
  ),
  -- Leads por (grupo, dia): histograma score → quantidade (chave normalizada, 80.0 → "80").
  --   (v157) Sem `order by`: o score já vem agrupado como número (80 e 80.0 são o mesmo
  --   grupo), então a chave de texto nunca repete.
  lead_days as (
    select s.group_key, s.date,
           jsonb_object_agg(trim_scale(s.score)::text, s.qty) as leads
    from (
      select r.group_key, r.date, l.score, sum(l.qty)::integer as qty
      from rows_ r
      cross join lateral unnest(r.lead_scores, r.lead_qtys) as l(score, qty)
      where r.date >= v_series_start
      group by r.group_key, r.date, l.score
    ) s
    group by s.group_key, s.date
  ),
  -- (v157) O item de cada dia: números, conversões e leads empilhados e dobrados por
  -- (grupo, dia). Só existe dia que tem números (`having`): conversão e lead vêm das
  -- mesmas linhas, então nunca aparecem num dia sem números — a guarda documenta o
  -- left join da v155.
  day_parts as (
    select d.group_key, d.date, 's'::text as kind,
      jsonb_build_object(
        'date', d.date,
        'impressions', d.impressions,
        'clicks', d.clicks,
        'inline_link_clicks', d.inline_link_clicks,
        'spend', d.spend,
        'lpv', d.lpv,
        'plays', d.plays,
        'thruplays', d.thruplays,
        'hook_wsum', d.hook_wsum,
        'scroll_stop_wsum', d.scroll_stop_wsum,
        'hold_rate_wsum', d.hold_rate_wsum,
        'video_watched_p50_wsum', d.video_watched_p50_wsum,
        'video_watched_p75_wsum', d.video_watched_p75_wsum,
        'reach', d.reach
      ) as obj
    from days d
    union all
    select c.group_key, c.date, 'c', c.conversions from conv_days c
    union all
    select l.group_key, l.date, 'l', l.leads from lead_days l
  ),
  day_rows as (
    select
      p.group_key,
      p.date,
      (array_agg(p.obj) filter (where p.kind = 's'))[1]
        || jsonb_build_object(
             'conversions', coalesce((array_agg(p.obj) filter (where p.kind = 'c'))[1], '{}'::jsonb),
             'leads', coalesce((array_agg(p.obj) filter (where p.kind = 'l'))[1], '{}'::jsonb)
           ) as item
    from day_parts p
    group by p.group_key, p.date
    having bool_or(p.kind = 's')
  ),
  -- Totais do período inteiro por grupo (as telas de detalhe/filhos somam o período
  -- todo e mostram só 5 dias de série).
  --   (v157) `pack_ids`: com group_by = 'ad_id' o grupo É o anúncio, e os packs dele
  --   são os das suas linhas (reais e de inventário) — exatamente o `packs_by_ad` do
  --   anúncio, sem juntar. Com group_by = 'entity' o grupo tem vários anúncios e vale
  --   o pack do representante (ver grp_rep).
  totals as (
    select
      r.group_key,
      sum(r.impressions)::bigint as impressions,
      sum(r.clicks)::bigint as clicks,
      sum(r.inline_link_clicks)::bigint as inline_link_clicks,
      sum(r.spend)::numeric as spend,
      sum(r.lpv)::bigint as lpv,
      sum(r.plays)::bigint as plays,
      sum(r.thruplays)::bigint as thruplays,
      sum(r.hook_value * r.plays)::numeric as hook_wsum,
      sum(r.scroll_stop_value * r.plays)::numeric as scroll_stop_wsum,
      sum(r.hold_rate * r.plays)::numeric as hold_rate_wsum,
      sum(r.video_watched_p50 * r.plays)::numeric as video_watched_p50_wsum,
      sum(r.video_watched_p75 * r.plays)::numeric as video_watched_p75_wsum,
      sum(r.reach)::bigint as reach,
      array_agg(distinct r.pack_id) as pack_ids
    from rows_ r
    group by r.group_key
  ),
  conv_totals as (
    select s.group_key, jsonb_object_agg(s.key, s.total) as conversions
    from (
      select x.group_key, (select ck.m from ck) ->> x.key_id::text as key, x.total
      from (
        select r.group_key, pr.key_id, sum(pr.value)::numeric as total
        from rows_ r
        cross join lateral unnest(r.conv_key_ids, r.conv_values) as pr(key_id, value)
        group by r.group_key, pr.key_id
      ) x
      where (select ck.m from ck) ? x.key_id::text
    ) s
    group by s.group_key
  ),
  lead_totals as (
    select s.group_key, jsonb_object_agg(trim_scale(s.score)::text, s.qty) as leads
    from (
      select r.group_key, l.score, sum(l.qty)::integer as qty
      from rows_ r
      cross join lateral unnest(r.lead_scores, r.lead_qtys) as l(score, qty)
      group by r.group_key, l.score
    ) s
    group by s.group_key
  ),
  -- 140: histogramas das colunas vinculadas, somados no PERIODO inteiro por grupo
  -- (a entidade, ou cada filho). Sem serie por dia no v1. Opt-in por p_include_custom.
  custom_totals as (
    select y.group_key, jsonb_object_agg(y.mapping_id, y.hist) as custom_histograms
    from (
      select x.group_key, x.mapping_id, jsonb_object_agg(x.val, x.qty) as hist
      from (
        select r.group_key, m.key as mapping_id, v.key as val, sum(v.value::bigint)::bigint as qty
        from rows_ r
        cross join lateral jsonb_each(r.custom_hist) as m(key, value)
        cross join lateral jsonb_each_text(m.value) as v(key, value)
        where v_include_custom and r.custom_hist is not null
        group by r.group_key, m.key, v.key
      ) x
      group by x.group_key, x.mapping_id
    ) y
    group by y.group_key
  ),
  -- 5. Representante — MESMA regra da base do Manager: por anúncio, o dia de mais
  --    impressões (desempate: mais recente); no grupo, (impressões, ad_id) máximos.
  per_ad as (
    select
      r.group_key,
      r.user_id,
      r.ad_id,
      max((lpad(r.impressions::text, 12, '0') || e'\x1f' || coalesce(r.date::text, '') || e'\x1f' || r.pack_id::text) collate "C") as rep_enc
    from rows_ r
    group by r.group_key, r.user_id, r.ad_id
  ),
  grp as (
    select
      p.group_key,
      count(distinct p.ad_id)::integer as ad_count,
      max((substr(p.rep_enc, 1, 12) || e'\x1f' || p.ad_id || e'\x1f' || p.user_id::text
           || e'\x1f' || p.rep_enc) collate "C") as rep_enc,
      -- fallback de miniatura: qualquer cópia do grupo com arquivo no Storage (v132)
      max(nullif(a.thumb_storage_path, '')) as any_thumb_storage_path
    from per_ad p
    left join public.ads a
      on a.user_id = p.user_id
     and a.ad_id = p.ad_id
    group by p.group_key
  ),
  grp_dec as (
    select
      g.*,
      (split_part(g.rep_enc, e'\x1f', 2) collate "default") as rep_ad_id,
      (split_part(g.rep_enc, e'\x1f', 3))::uuid as rep_user_id,
      nullif(split_part(g.rep_enc, e'\x1f', 5), '')::date as rep_date,
      nullif(split_part(g.rep_enc, e'\x1f', 6), '')::uuid as rep_pack_id
    from grp g
  ),
  -- (v157) O representante já sai como o objeto do grupo. Os três laços daqui são
  -- buscas de UMA linha por índice (ad_metrics pela PK, inventário, ads).
  --   `rep_pack_ids` só com group_by = 'entity' (um grupo: a subconsulta roda uma vez).
  --   Com group_by = 'ad_id' o CASE é constante sob force_custom_plan e a subconsulta
  --   some do plano — se não sumisse, seria uma varredura de packs_by_ad POR anúncio.
  grp_rep as (
    select
      g.group_key,
      jsonb_build_object(
        'group_key', g.group_key,
        'ad_count', g.ad_count,
        'user_id', g.rep_user_id,
        'ad_id', g.rep_ad_id,
        -- (v155) representante sem dia (só inventário): nomes da linha do inventário.
        'ad_name', case when g.rep_date is null then ri.ad_name else am.ad_name end,
        'account_id', case when g.rep_date is null then ri.account_id else am.account_id end,
        'campaign_id', case when g.rep_date is null then ri.campaign_id else am.campaign_id end,
        'campaign_name', case when g.rep_date is null then ri.campaign_name else am.campaign_name end,
        'adset_id', case when g.rep_date is null then ri.adset_id else am.adset_id end,
        'adset_name', case when g.rep_date is null then ri.adset_name else am.adset_name end,
        'effective_status', a.effective_status,
        'thumb_storage_path', coalesce(nullif(a.thumb_storage_path, ''), g.any_thumb_storage_path)
      ) as obj,
      case when v_group_by = 'ad_id' then null
           else (select pba.pack_ids from packs_by_ad pba where pba.ad_id = g.rep_ad_id)
      end as rep_pack_ids
    from grp_dec g
    left join public.ad_metrics am on am.user_id = g.rep_user_id and am.pack_id = g.rep_pack_id and am.ad_id = g.rep_ad_id and am.date = g.rep_date
    left join lateral (
      select i.ad_name, i.account_id, i.campaign_id, i.campaign_name, i.adset_id, i.adset_name
      from public.ad_pack_inventory i
      where g.rep_date is null
        and i.user_id = g.rep_user_id
        and (p_pack_ids is null or i.pack_id = any(p_pack_ids))
        and i.ad_id = g.rep_ad_id
      order by i.last_active_date desc, i.pack_id
      limit 1
    ) ri on true
    left join public.ads a
      on a.user_id = g.rep_user_id
     and a.ad_id = g.rep_ad_id
  ),
  -- 6. Curva de retenção ponderada por plays (só quando pedida): Σ ponto×plays e
  --    Σ plays POR ÍNDICE — uma linha de curva mais curta não pesa nos índices que
  --    não tem (semântica da rota antiga). A divisão e o arredondamento ficam em Python.
  curve as (
    select
      r.group_key,
      (e.idx - 1)::integer as idx,
      sum(public.ad_performance_parse_value(e.val #>> '{}') * r.plays)::numeric as wsum,
      sum(r.plays)::bigint as psum
    from rows_ r
    join public.ad_metrics am on am.user_id = r.user_id and am.pack_id = r.pack_id and am.ad_id = r.ad_id and am.date = r.date
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(am.video_play_curve_actions) = 'array' then am.video_play_curve_actions else '[]'::jsonb end
    ) with ordinality as e(val, idx)
    where v_include_curve
      and r.plays > 0
    group by r.group_key, e.idx
  ),
  -- (v157) Sem generate_series + junção para tapar buracos: os índices de um grupo
  -- são sempre contíguos a partir de 0 (a linha de curva mais longa contribui com
  -- todos eles), então basta agregar em ordem. Índice cujo ponto não parseia tem
  -- wsum nulo e continua existindo — vira 0, como no coalesce da v155.
  curve_arr as (
    select
      c.group_key,
      jsonb_agg(coalesce(c.wsum, 0) order by c.idx) as curve_wsum,
      jsonb_agg(coalesce(c.psum, 0) order by c.idx) as curve_psum
    from curve c
    group by c.group_key
  ),
  -- (v157) Todas as partes de todos os grupos numa lista só. `aux` carrega os
  -- pack_ids da fonte certa para o modo (representante em 'entity', totais em 'ad_id').
  parts as (
    select g.group_key, 'rep'::text as kind, null::date as date, g.obj,
           case when v_group_by = 'ad_id' then null
                else to_jsonb(coalesce(g.rep_pack_ids, array[]::uuid[])) end as aux
    from grp_rep g
    union all
    select t.group_key, 'tot', null,
      jsonb_build_object(
        'impressions', t.impressions,
        'clicks', t.clicks,
        'inline_link_clicks', t.inline_link_clicks,
        'spend', t.spend,
        'lpv', t.lpv,
        'plays', t.plays,
        'thruplays', t.thruplays,
        'hook_wsum', t.hook_wsum,
        'scroll_stop_wsum', t.scroll_stop_wsum,
        'hold_rate_wsum', t.hold_rate_wsum,
        'video_watched_p50_wsum', t.video_watched_p50_wsum,
        'video_watched_p75_wsum', t.video_watched_p75_wsum,
        'reach', t.reach
      ),
      case when v_group_by = 'ad_id' then to_jsonb(t.pack_ids) else null end
    from totals t
    union all
    select c.group_key, 'conv', null, c.conversions, null from conv_totals c
    union all
    select l.group_key, 'lead', null, l.leads, null from lead_totals l
    union all
    select cu.group_key, 'cust', null, cu.custom_histograms, null from custom_totals cu
    union all
    select ca.group_key, 'curve', null, jsonb_build_object('w', ca.curve_wsum, 'p', ca.curve_psum), null from curve_arr ca
    union all
    select dr.group_key, 'day', dr.date, dr.item, null from day_rows dr
  ),
  -- (v157) Uma agregação por grupo monta o objeto final. O `having` reproduz o inner
  -- join grp_rep × total_rows da v155 (os dois vêm de rows_, então é só guarda).
  -- jsonb normaliza a ordem das chaves: `||` e jsonb_build_object dão o mesmo valor.
  groups_ as (
    select
      p.group_key,
      (array_agg(p.obj) filter (where p.kind = 'rep'))[1]
        || jsonb_build_object(
             'pack_ids', coalesce((array_agg(p.aux) filter (where p.aux is not null))[1], '[]'::jsonb),
             'curve_wsum', (array_agg(p.obj) filter (where p.kind = 'curve'))[1] -> 'w',
             'curve_psum', (array_agg(p.obj) filter (where p.kind = 'curve'))[1] -> 'p',
             'totals', (array_agg(p.obj) filter (where p.kind = 'tot'))[1]
               || jsonb_build_object(
                    'conversions', coalesce((array_agg(p.obj) filter (where p.kind = 'conv'))[1], '{}'::jsonb),
                    'leads', coalesce((array_agg(p.obj) filter (where p.kind = 'lead'))[1], '{}'::jsonb),
                    'custom_histograms', coalesce((array_agg(p.obj) filter (where p.kind = 'cust'))[1], '{}'::jsonb)
                  ),
             'days', coalesce(jsonb_agg(p.obj order by p.date) filter (where p.kind = 'day'), '[]'::jsonb)
           ) as item
    from parts p
    group by p.group_key
    having bool_or(p.kind = 'rep') and bool_or(p.kind = 'tot')
  )
  select jsonb_build_object(
    'mql_leadscore_min', v_mql,
    'groups', coalesce((select jsonb_agg(g.item order by g.group_key) from groups_ g), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;


ALTER FUNCTION public.fetch_entity_performance_v157(p_user_id uuid, p_date_start date, p_date_stop date, p_entity text, p_entity_id text, p_pack_ids uuid[], p_group_by text, p_include_curve boolean, p_series_days integer, p_include_custom boolean) OWNER TO postgres;

--
-- Name: FUNCTION fetch_entity_performance_v157(p_user_id uuid, p_date_start date, p_date_stop date, p_entity text, p_entity_id text, p_pack_ids uuid[], p_group_by text, p_include_curve boolean, p_series_days integer, p_include_custom boolean); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.fetch_entity_performance_v157(p_user_id uuid, p_date_start date, p_date_stop date, p_entity text, p_entity_id text, p_pack_ids uuid[], p_group_by text, p_include_curve boolean, p_series_days integer, p_include_custom boolean) IS 'Detalhe de uma entidade (157): a v155 com a montagem final linear no número de anúncios (partes empilhadas e agregadas por grupo, sem junção entre etapas). Saída idêntica à v155.';


--
-- Name: fetch_entity_performance_v158(uuid, date, date, text, text, uuid[], text, boolean, integer, boolean); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.fetch_entity_performance_v158(p_user_id uuid, p_date_start date, p_date_stop date, p_entity text, p_entity_id text, p_pack_ids uuid[] DEFAULT NULL::uuid[], p_group_by text DEFAULT 'entity'::text, p_include_curve boolean DEFAULT false, p_series_days integer DEFAULT NULL::integer, p_include_custom boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    SET plan_cache_mode TO 'force_custom_plan'
    AS $$
declare
  v_entity text := lower(coalesce(p_entity, ''));
  v_group_by text := lower(coalesce(p_group_by, 'entity'));
  v_date_start date := least(p_date_start, p_date_stop);
  v_date_stop date := greatest(p_date_start, p_date_stop);
  v_include_curve boolean := coalesce(p_include_curve, false);
  -- Linhas por DIA só da janela pedida (as telas de detalhe/filhos usam 5 dias de
  -- sparkline; só o histórico usa o período inteiro). Medido: os filhos do conjunto
  -- mais pesado (29 anúncios × 9 meses) saíam com 1,4 MB de dias que ninguém lia.
  v_series_start date;
  v_owners uuid[];
  v_requested integer;
  v_mql numeric;
  -- 140: histogramas das colunas vinculadas so quando pedidos (opt-in).
  v_include_custom boolean := coalesce(p_include_custom, false);
  v_result jsonb;
begin
  if auth.uid() is distinct from p_user_id then
    raise exception 'Forbidden: p_user_id must match auth.uid()'
      using errcode = '42501';
  end if;
  if v_entity not in ('ad_id', 'ad_name', 'adset_id') then
    raise exception 'Invalid p_entity: %, expected ad_id|ad_name|adset_id', v_entity
      using errcode = '22023';
  end if;
  if v_group_by not in ('entity', 'ad_id') then
    raise exception 'Invalid p_group_by: %, expected entity|ad_id', v_group_by
      using errcode = '22023';
  end if;
  if coalesce(p_entity_id, '') = '' then
    raise exception 'p_entity_id is required' using errcode = '22023';
  end if;

  -- Escopo: idêntico à base do Manager (v130/v132).
  if p_pack_ids is null then
    v_owners := array[p_user_id];
  else
    select array_agg(distinct a.owner_id), count(distinct a.pack_id)
      into v_owners, v_requested
    from public.resolve_pack_access(p_pack_ids, p_user_id) a;
    if coalesce(v_requested, 0) < (select count(distinct x) from unnest(p_pack_ids) x) then
      raise exception 'Forbidden: pack inacessivel na selecao'
        using errcode = '42501';
    end if;
    if v_owners is null or array_length(v_owners, 1) is null then
      v_owners := array[p_user_id];
    end if;
  end if;

  -- Corte de MQL dos packs (NULL = indefinido ou divergente; sem packs = NULL).
  v_mql := public.resolve_pack_mql_leadscore_min(p_user_id, p_pack_ids);

  -- (v158) Três significados, não dois:
  --   NULL  -> o período inteiro (o histórico usa isto)
  --   0     -> NENHUM dia. É o que a tela de variações precisa: ela não desenha a
  --            mini-série, e montá-la custava 44% da saída desta função.
  --   N > 0 -> os últimos N dias.
  -- Na v157 o zero caía junto do NULL e pedia o PERÍODO INTEIRO — o oposto do que
  -- "zero dias de série" quer dizer. Ninguém passava 0 (as rotas passavam 5 ou NULL),
  -- então o valor estava livre para receber o significado certo.
  -- Uma data depois do fim zera as três CTEs de dia (`day_nums`, `conv_days`,
  -- `lead_days`, todas com `r.date >= v_series_start`) sem tocar em totais nem curva.
  v_series_start := case
    when p_series_days is null then v_date_start
    when p_series_days <= 0 then v_date_stop + 1
    else greatest(v_date_start, v_date_stop - (p_series_days - 1))
  end;

  with
  -- 1. Chaves (silo, anúncio, dia) da entidade no período, por índice de ad_metrics.
  --    Os três ramos do OR são constantes sob force_custom_plan: o planner poda os
  --    dois falsos e usa o índice do verdadeiro.
  keys as (
    select am.user_id, am.pack_id, am.ad_id, am.date
    from unnest(v_owners) as o(owner_id)
    join public.ad_performance_daily am
      on am.user_id = o.owner_id
     and am.date >= v_date_start
     and am.date <= v_date_stop
     and (
       (v_entity = 'ad_id' and am.ad_id = p_entity_id)
       or (v_entity = 'ad_name' and am.ad_name = p_entity_id)
       or (v_entity = 'adset_id' and am.adset_id = p_entity_id)
     )
    where p_pack_ids is null
       or am.pack_id = any(p_pack_ids)
  ),
  -- 2. Dedup cross-silo: uma linha por (anúncio, dia); vence o silo que NÃO é o do
  --    ator (o dono do pack compartilhado), desempate por uuid — regra da v104/v130.
  dedup as (
    select k.user_id, k.pack_id, k.ad_id, k.date
    from (
      select k.*, row_number() over (partition by k.ad_id, k.date order by (k.user_id = p_user_id), k.user_id) as rn
      from keys k
    ) k
    where k.rn = 1
  ),
  -- 2a. (v155) Inventário da entidade: anúncio ativo no período sem linha de métrica
  --     neste (silo, pack). Entra zerado e sem dias — o backend já preenche com zero o
  --     dia sem dado. Entre silos, a mesma preferência do dedup (vence o dono do pack
  --     compartilhado); dentro do silo vencedor, todos os packs (viram pack_ids).
  inv as (
    select x.user_id, x.pack_id, x.ad_id
    from (
      select i.user_id, i.pack_id, i.ad_id,
             dense_rank() over (partition by i.ad_id order by (i.user_id = p_user_id), i.user_id) as rk
      from unnest(v_owners) as o(owner_id)
      join public.ad_pack_inventory i
        on i.user_id = o.owner_id
       and i.first_active_date <= v_date_stop
       and i.last_active_date >= v_date_start
       and (
         (v_entity = 'ad_id' and i.ad_id = p_entity_id)
         or (v_entity = 'ad_name' and i.ad_name = p_entity_id)
         or (v_entity = 'adset_id' and i.adset_id = p_entity_id)
       )
      where (p_pack_ids is null or i.pack_id = any(p_pack_ids))
        -- Pelo read model e não por `keys`: `keys` só tem as linhas que casam com a
        -- entidade, e um anúncio renomeado tem linhas reais com o nome antigo.
        and not exists (
          select 1 from public.ad_performance_daily d
          where d.user_id = i.user_id and d.pack_id = i.pack_id and d.ad_id = i.ad_id
            and d.date >= v_date_start and d.date <= v_date_stop
        )
    ) x
    where x.rk = 1
  ),
  -- 2b. (v134) Packs de cada anúncio, para a linha-filha poder ser filtrada por
  --     Pack. Segunda visita a ad_metric_pack_map — a primeira, em `keys`, só
  --     decide se o anúncio-dia entra; aqui coletamos os ids. Roda sobre `dedup`
  --     (uma linha por anúncio-dia, já resolvido o cross-silo) e agrega por
  --     anúncio, não por dia.
  --
  --     RESTRITO À SELEÇÃO, igual ao `pack_ids` da base do Manager: devolver o
  --     universo faria o filtro oferecer pack que não está na tela e produzir
  --     tabela vazia sem explicação.
  packs_by_ad as (
    select
      d.ad_id,
      coalesce(
        array_agg(distinct d.pack_id),
        array[]::uuid[]
      ) as pack_ids
    -- (v155) mais os packs em que o anúncio só está no inventário
    from (select ad_id, pack_id from dedup union all select ad_id, pack_id from inv) d
    group by d.ad_id
  ),
  -- 3. As linhas: SÓ o read model, pela PK.
  --    (v155) Colunas explícitas: o inventário entra por union, zerado e sem dia
  --    (`date` nulo fica fora da série; arrays vazios não geram conversão nem lead).
  rows_ as (
    select
      case when v_group_by = 'ad_id' then d.ad_id else p_entity_id end as group_key,
      d.user_id, d.pack_id, d.ad_id, d.date,
      d.impressions, d.clicks, d.inline_link_clicks, d.spend, d.lpv, d.plays, d.thruplays,
      d.hook_value, d.scroll_stop_value, d.hold_rate, d.video_watched_p50, d.video_watched_p75,
      d.reach, d.conv_key_ids, d.conv_values, d.lead_scores, d.lead_qtys, d.custom_hist
    from dedup k
    join public.ad_performance_daily d on d.user_id = k.user_id and d.pack_id = k.pack_id and d.ad_id = k.ad_id and d.date = k.date

    union all

    select
      case when v_group_by = 'ad_id' then i.ad_id else p_entity_id end as group_key,
      i.user_id, i.pack_id, i.ad_id, null::date,
      0::bigint, 0::bigint, 0::bigint, 0::numeric, 0::bigint, 0::bigint, 0::bigint,
      0::numeric, 0::numeric, 0::numeric, 0::numeric, 0::numeric,
      0::bigint, '{}'::integer[], '{}'::numeric[], '{}'::numeric[], '{}'::integer[], null::jsonb
    from inv i
  ),
  -- ------------------------------------------------------------------------------
  -- (v157) DAQUI PARA BAIXO NINGUÉM JUNTA ETAPA COM ETAPA.
  --
  -- O planner estima 1 linha para toda etapa derivada de `keys` (não tem como saber
  -- que um nome de criativo repete em 600 anúncios). Com 1 linha estimada, qualquer
  -- junção entre duas etapas vira laço aninhado, e o lado de dentro é re-executado
  -- ou re-varrido POR GRUPO: custo N². Medido em produção (14-15/09, conta com 630
  -- anúncios num nome): v145 = 19 s a mais de 200 s; v155 = 0,3 a 2,4 s conforme o
  -- plano sorteado. MATERIALIZED pontual não resolve (13,6 s com um, 0,8 s com todos,
  -- ainda N²); lista de chaves pré-resolvida por unnest também não (15,5 s).
  --
  -- O desenho: cada parte do grupo (totais, conversões, leads, histogramas, curva,
  -- dias, representante) é calculada UMA vez por agregação e empilhada numa lista só
  -- (`parts`, `day_parts`) marcada pelo tipo; uma agregação por grupo monta o objeto.
  -- Agregar é linear seja qual for a estimativa. Os únicos laços que sobram são
  -- buscas por índice de uma linha (ads, ad_metrics, inventário) — N buscas, não N².
  -- Saída byte a byte idêntica à v155 (diferencial em 14 telas de produção e teste 157).
  -- ------------------------------------------------------------------------------

  -- 4. Grupo × dia (só a janela de série): somas e somas ponderadas por plays (as
  --    razões saem em Python, com a mesma fórmula do Manager).
  days as (
    select
      r.group_key,
      r.date,
      sum(r.impressions)::bigint as impressions,
      sum(r.clicks)::bigint as clicks,
      sum(r.inline_link_clicks)::bigint as inline_link_clicks,
      sum(r.spend)::numeric as spend,
      sum(r.lpv)::bigint as lpv,
      sum(r.plays)::bigint as plays,
      sum(r.thruplays)::bigint as thruplays,
      sum(r.hook_value * r.plays)::numeric as hook_wsum,
      sum(r.scroll_stop_value * r.plays)::numeric as scroll_stop_wsum,
      sum(r.hold_rate * r.plays)::numeric as hold_rate_wsum,
      sum(r.video_watched_p50 * r.plays)::numeric as video_watched_p50_wsum,
      sum(r.video_watched_p75 * r.plays)::numeric as video_watched_p75_wsum,
      sum(r.reach)::bigint as reach
    from rows_ r
    where r.date >= v_series_start
    group by r.group_key, r.date
  ),
  -- (v157) Dicionário de chaves de evento como UM objeto {id: chave}. Juntar com a
  -- tabela a cada (grupo, dia, chave) dependeria do planner escolher hash; a busca
  -- no objeto (~85 chaves) não depende de estimativa nenhuma. Lido por subconsulta
  -- escalar (roda uma vez) e só o NOME da chave segue adiante: com `cross join ck` o
  -- objeto inteiro ia dentro de cada linha e a ordenação de 3,4 mil linhas escorria
  -- 14 MB para disco (medido).
  ck as (
    select coalesce(jsonb_object_agg(k.id::text, k.key), '{}'::jsonb) as m
    from public.conversion_keys k
  ),
  -- Conversões por (grupo, dia): agrupa por id da chave ANTES de traduzir para o nome
  -- (lição da v130: juntar par a par antes de agrupar custava segundos). Chave sem
  -- entrada no dicionário fica fora, como no inner join da v155.
  --   (v157) Sem `order by` dentro do jsonb_object_agg: o jsonb guarda as chaves na
  --   ordem dele, e a ordem de entrada só decide empate de chave repetida — que não
  --   existe (key_id agrupado, conversion_keys.key é UNIQUE). A ordenação por texto com
  --   colação era o maior custo que sobrava no histórico longo de um anúncio.
  conv_days as (
    select s.group_key, s.date,
           jsonb_object_agg(s.key, s.total) as conversions
    from (
      select x.group_key, x.date, (select ck.m from ck) ->> x.key_id::text as key, x.total
      from (
        select r.group_key, r.date, pr.key_id, sum(pr.value)::numeric as total
        from rows_ r
        cross join lateral unnest(r.conv_key_ids, r.conv_values) as pr(key_id, value)
        where r.date >= v_series_start
        group by r.group_key, r.date, pr.key_id
      ) x
      where (select ck.m from ck) ? x.key_id::text
    ) s
    group by s.group_key, s.date
  ),
  -- Leads por (grupo, dia): histograma score → quantidade (chave normalizada, 80.0 → "80").
  --   (v157) Sem `order by`: o score já vem agrupado como número (80 e 80.0 são o mesmo
  --   grupo), então a chave de texto nunca repete.
  lead_days as (
    select s.group_key, s.date,
           jsonb_object_agg(trim_scale(s.score)::text, s.qty) as leads
    from (
      select r.group_key, r.date, l.score, sum(l.qty)::integer as qty
      from rows_ r
      cross join lateral unnest(r.lead_scores, r.lead_qtys) as l(score, qty)
      where r.date >= v_series_start
      group by r.group_key, r.date, l.score
    ) s
    group by s.group_key, s.date
  ),
  -- (v157) O item de cada dia: números, conversões e leads empilhados e dobrados por
  -- (grupo, dia). Só existe dia que tem números (`having`): conversão e lead vêm das
  -- mesmas linhas, então nunca aparecem num dia sem números — a guarda documenta o
  -- left join da v155.
  day_parts as (
    select d.group_key, d.date, 's'::text as kind,
      jsonb_build_object(
        'date', d.date,
        'impressions', d.impressions,
        'clicks', d.clicks,
        'inline_link_clicks', d.inline_link_clicks,
        'spend', d.spend,
        'lpv', d.lpv,
        'plays', d.plays,
        'thruplays', d.thruplays,
        'hook_wsum', d.hook_wsum,
        'scroll_stop_wsum', d.scroll_stop_wsum,
        'hold_rate_wsum', d.hold_rate_wsum,
        'video_watched_p50_wsum', d.video_watched_p50_wsum,
        'video_watched_p75_wsum', d.video_watched_p75_wsum,
        'reach', d.reach
      ) as obj
    from days d
    union all
    select c.group_key, c.date, 'c', c.conversions from conv_days c
    union all
    select l.group_key, l.date, 'l', l.leads from lead_days l
  ),
  day_rows as (
    select
      p.group_key,
      p.date,
      (array_agg(p.obj) filter (where p.kind = 's'))[1]
        || jsonb_build_object(
             'conversions', coalesce((array_agg(p.obj) filter (where p.kind = 'c'))[1], '{}'::jsonb),
             'leads', coalesce((array_agg(p.obj) filter (where p.kind = 'l'))[1], '{}'::jsonb)
           ) as item
    from day_parts p
    group by p.group_key, p.date
    having bool_or(p.kind = 's')
  ),
  -- Totais do período inteiro por grupo (as telas de detalhe/filhos somam o período
  -- todo e mostram só 5 dias de série).
  --   (v157) `pack_ids`: com group_by = 'ad_id' o grupo É o anúncio, e os packs dele
  --   são os das suas linhas (reais e de inventário) — exatamente o `packs_by_ad` do
  --   anúncio, sem juntar. Com group_by = 'entity' o grupo tem vários anúncios e vale
  --   o pack do representante (ver grp_rep).
  totals as (
    select
      r.group_key,
      sum(r.impressions)::bigint as impressions,
      sum(r.clicks)::bigint as clicks,
      sum(r.inline_link_clicks)::bigint as inline_link_clicks,
      sum(r.spend)::numeric as spend,
      sum(r.lpv)::bigint as lpv,
      sum(r.plays)::bigint as plays,
      sum(r.thruplays)::bigint as thruplays,
      sum(r.hook_value * r.plays)::numeric as hook_wsum,
      sum(r.scroll_stop_value * r.plays)::numeric as scroll_stop_wsum,
      sum(r.hold_rate * r.plays)::numeric as hold_rate_wsum,
      sum(r.video_watched_p50 * r.plays)::numeric as video_watched_p50_wsum,
      sum(r.video_watched_p75 * r.plays)::numeric as video_watched_p75_wsum,
      sum(r.reach)::bigint as reach,
      array_agg(distinct r.pack_id) as pack_ids
    from rows_ r
    group by r.group_key
  ),
  conv_totals as (
    select s.group_key, jsonb_object_agg(s.key, s.total) as conversions
    from (
      select x.group_key, (select ck.m from ck) ->> x.key_id::text as key, x.total
      from (
        select r.group_key, pr.key_id, sum(pr.value)::numeric as total
        from rows_ r
        cross join lateral unnest(r.conv_key_ids, r.conv_values) as pr(key_id, value)
        group by r.group_key, pr.key_id
      ) x
      where (select ck.m from ck) ? x.key_id::text
    ) s
    group by s.group_key
  ),
  lead_totals as (
    select s.group_key, jsonb_object_agg(trim_scale(s.score)::text, s.qty) as leads
    from (
      select r.group_key, l.score, sum(l.qty)::integer as qty
      from rows_ r
      cross join lateral unnest(r.lead_scores, r.lead_qtys) as l(score, qty)
      group by r.group_key, l.score
    ) s
    group by s.group_key
  ),
  -- 140: histogramas das colunas vinculadas, somados no PERIODO inteiro por grupo
  -- (a entidade, ou cada filho). Sem serie por dia no v1. Opt-in por p_include_custom.
  custom_totals as (
    select y.group_key, jsonb_object_agg(y.mapping_id, y.hist) as custom_histograms
    from (
      select x.group_key, x.mapping_id, jsonb_object_agg(x.val, x.qty) as hist
      from (
        select r.group_key, m.key as mapping_id, v.key as val, sum(v.value::bigint)::bigint as qty
        from rows_ r
        cross join lateral jsonb_each(r.custom_hist) as m(key, value)
        cross join lateral jsonb_each_text(m.value) as v(key, value)
        where v_include_custom and r.custom_hist is not null
        group by r.group_key, m.key, v.key
      ) x
      group by x.group_key, x.mapping_id
    ) y
    group by y.group_key
  ),
  -- 5. Representante — MESMA regra da base do Manager: por anúncio, o dia de mais
  --    impressões (desempate: mais recente); no grupo, (impressões, ad_id) máximos.
  per_ad as (
    select
      r.group_key,
      r.user_id,
      r.ad_id,
      max((lpad(r.impressions::text, 12, '0') || e'\x1f' || coalesce(r.date::text, '') || e'\x1f' || r.pack_id::text) collate "C") as rep_enc
    from rows_ r
    group by r.group_key, r.user_id, r.ad_id
  ),
  grp as (
    select
      p.group_key,
      count(distinct p.ad_id)::integer as ad_count,
      max((substr(p.rep_enc, 1, 12) || e'\x1f' || p.ad_id || e'\x1f' || p.user_id::text
           || e'\x1f' || p.rep_enc) collate "C") as rep_enc,
      -- fallback de miniatura: qualquer cópia do grupo com arquivo no Storage (v132)
      max(nullif(a.thumb_storage_path, '')) as any_thumb_storage_path
    from per_ad p
    left join public.ads a
      on a.user_id = p.user_id
     and a.ad_id = p.ad_id
    group by p.group_key
  ),
  grp_dec as (
    select
      g.*,
      (split_part(g.rep_enc, e'\x1f', 2) collate "default") as rep_ad_id,
      (split_part(g.rep_enc, e'\x1f', 3))::uuid as rep_user_id,
      nullif(split_part(g.rep_enc, e'\x1f', 5), '')::date as rep_date,
      nullif(split_part(g.rep_enc, e'\x1f', 6), '')::uuid as rep_pack_id
    from grp g
  ),
  -- (v157) O representante já sai como o objeto do grupo. Os três laços daqui são
  -- buscas de UMA linha por índice (ad_metrics pela PK, inventário, ads).
  --   `rep_pack_ids` só com group_by = 'entity' (um grupo: a subconsulta roda uma vez).
  --   Com group_by = 'ad_id' o CASE é constante sob force_custom_plan e a subconsulta
  --   some do plano — se não sumisse, seria uma varredura de packs_by_ad POR anúncio.
  grp_rep as (
    select
      g.group_key,
      jsonb_build_object(
        'group_key', g.group_key,
        'ad_count', g.ad_count,
        'user_id', g.rep_user_id,
        'ad_id', g.rep_ad_id,
        -- (v155) representante sem dia (só inventário): nomes da linha do inventário.
        'ad_name', case when g.rep_date is null then ri.ad_name else am.ad_name end,
        'account_id', case when g.rep_date is null then ri.account_id else am.account_id end,
        'campaign_id', case when g.rep_date is null then ri.campaign_id else am.campaign_id end,
        'campaign_name', case when g.rep_date is null then ri.campaign_name else am.campaign_name end,
        'adset_id', case when g.rep_date is null then ri.adset_id else am.adset_id end,
        'adset_name', case when g.rep_date is null then ri.adset_name else am.adset_name end,
        'effective_status', a.effective_status,
        'thumb_storage_path', coalesce(nullif(a.thumb_storage_path, ''), g.any_thumb_storage_path)
      ) as obj,
      case when v_group_by = 'ad_id' then null
           else (select pba.pack_ids from packs_by_ad pba where pba.ad_id = g.rep_ad_id)
      end as rep_pack_ids
    from grp_dec g
    left join public.ad_metrics am on am.user_id = g.rep_user_id and am.pack_id = g.rep_pack_id and am.ad_id = g.rep_ad_id and am.date = g.rep_date
    left join lateral (
      select i.ad_name, i.account_id, i.campaign_id, i.campaign_name, i.adset_id, i.adset_name
      from public.ad_pack_inventory i
      where g.rep_date is null
        and i.user_id = g.rep_user_id
        and (p_pack_ids is null or i.pack_id = any(p_pack_ids))
        and i.ad_id = g.rep_ad_id
      order by i.last_active_date desc, i.pack_id
      limit 1
    ) ri on true
    left join public.ads a
      on a.user_id = g.rep_user_id
     and a.ad_id = g.rep_ad_id
  ),
  -- 6. Curva de retenção ponderada por plays (só quando pedida): Σ ponto×plays e
  --    Σ plays POR ÍNDICE — uma linha de curva mais curta não pesa nos índices que
  --    não tem (semântica da rota antiga). A divisão e o arredondamento ficam em Python.
  curve as (
    select
      r.group_key,
      (e.idx - 1)::integer as idx,
      sum(public.ad_performance_parse_value(e.val #>> '{}') * r.plays)::numeric as wsum,
      sum(r.plays)::bigint as psum
    from rows_ r
    join public.ad_metrics am on am.user_id = r.user_id and am.pack_id = r.pack_id and am.ad_id = r.ad_id and am.date = r.date
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(am.video_play_curve_actions) = 'array' then am.video_play_curve_actions else '[]'::jsonb end
    ) with ordinality as e(val, idx)
    where v_include_curve
      and r.plays > 0
    group by r.group_key, e.idx
  ),
  -- (v157) Sem generate_series + junção para tapar buracos: os índices de um grupo
  -- são sempre contíguos a partir de 0 (a linha de curva mais longa contribui com
  -- todos eles), então basta agregar em ordem. Índice cujo ponto não parseia tem
  -- wsum nulo e continua existindo — vira 0, como no coalesce da v155.
  curve_arr as (
    select
      c.group_key,
      jsonb_agg(coalesce(c.wsum, 0) order by c.idx) as curve_wsum,
      jsonb_agg(coalesce(c.psum, 0) order by c.idx) as curve_psum
    from curve c
    group by c.group_key
  ),
  -- (v157) Todas as partes de todos os grupos numa lista só. `aux` carrega os
  -- pack_ids da fonte certa para o modo (representante em 'entity', totais em 'ad_id').
  parts as (
    select g.group_key, 'rep'::text as kind, null::date as date, g.obj,
           case when v_group_by = 'ad_id' then null
                else to_jsonb(coalesce(g.rep_pack_ids, array[]::uuid[])) end as aux
    from grp_rep g
    union all
    select t.group_key, 'tot', null,
      jsonb_build_object(
        'impressions', t.impressions,
        'clicks', t.clicks,
        'inline_link_clicks', t.inline_link_clicks,
        'spend', t.spend,
        'lpv', t.lpv,
        'plays', t.plays,
        'thruplays', t.thruplays,
        'hook_wsum', t.hook_wsum,
        'scroll_stop_wsum', t.scroll_stop_wsum,
        'hold_rate_wsum', t.hold_rate_wsum,
        'video_watched_p50_wsum', t.video_watched_p50_wsum,
        'video_watched_p75_wsum', t.video_watched_p75_wsum,
        'reach', t.reach
      ),
      case when v_group_by = 'ad_id' then to_jsonb(t.pack_ids) else null end
    from totals t
    union all
    select c.group_key, 'conv', null, c.conversions, null from conv_totals c
    union all
    select l.group_key, 'lead', null, l.leads, null from lead_totals l
    union all
    select cu.group_key, 'cust', null, cu.custom_histograms, null from custom_totals cu
    union all
    select ca.group_key, 'curve', null, jsonb_build_object('w', ca.curve_wsum, 'p', ca.curve_psum), null from curve_arr ca
    union all
    select dr.group_key, 'day', dr.date, dr.item, null from day_rows dr
  ),
  -- (v157) Uma agregação por grupo monta o objeto final. O `having` reproduz o inner
  -- join grp_rep × total_rows da v155 (os dois vêm de rows_, então é só guarda).
  -- jsonb normaliza a ordem das chaves: `||` e jsonb_build_object dão o mesmo valor.
  groups_ as (
    select
      p.group_key,
      (array_agg(p.obj) filter (where p.kind = 'rep'))[1]
        || jsonb_build_object(
             'pack_ids', coalesce((array_agg(p.aux) filter (where p.aux is not null))[1], '[]'::jsonb),
             'curve_wsum', (array_agg(p.obj) filter (where p.kind = 'curve'))[1] -> 'w',
             'curve_psum', (array_agg(p.obj) filter (where p.kind = 'curve'))[1] -> 'p',
             'totals', (array_agg(p.obj) filter (where p.kind = 'tot'))[1]
               || jsonb_build_object(
                    'conversions', coalesce((array_agg(p.obj) filter (where p.kind = 'conv'))[1], '{}'::jsonb),
                    'leads', coalesce((array_agg(p.obj) filter (where p.kind = 'lead'))[1], '{}'::jsonb),
                    'custom_histograms', coalesce((array_agg(p.obj) filter (where p.kind = 'cust'))[1], '{}'::jsonb)
                  ),
             'days', coalesce(jsonb_agg(p.obj order by p.date) filter (where p.kind = 'day'), '[]'::jsonb)
           ) as item
    from parts p
    group by p.group_key
    having bool_or(p.kind = 'rep') and bool_or(p.kind = 'tot')
  )
  select jsonb_build_object(
    'mql_leadscore_min', v_mql,
    'groups', coalesce((select jsonb_agg(g.item order by g.group_key) from groups_ g), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;


ALTER FUNCTION public.fetch_entity_performance_v158(p_user_id uuid, p_date_start date, p_date_stop date, p_entity text, p_entity_id text, p_pack_ids uuid[], p_group_by text, p_include_curve boolean, p_series_days integer, p_include_custom boolean) OWNER TO postgres;

--
-- Name: FUNCTION fetch_entity_performance_v158(p_user_id uuid, p_date_start date, p_date_stop date, p_entity text, p_entity_id text, p_pack_ids uuid[], p_group_by text, p_include_curve boolean, p_series_days integer, p_include_custom boolean); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.fetch_entity_performance_v158(p_user_id uuid, p_date_start date, p_date_stop date, p_entity text, p_entity_id text, p_pack_ids uuid[], p_group_by text, p_include_curve boolean, p_series_days integer, p_include_custom boolean) IS 'Detalhe de uma entidade (158): a v157 (montagem linear) com p_series_days = 0 significando NENHUM dia de série, em vez de o período inteiro. Saída idêntica à v157 para NULL e para N > 0.';


--
-- Name: fetch_entity_performance_v171(uuid, date, date, text, text, uuid[], text, boolean, integer, boolean); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.fetch_entity_performance_v171(p_user_id uuid, p_date_start date, p_date_stop date, p_entity text, p_entity_id text, p_pack_ids uuid[] DEFAULT NULL::uuid[], p_group_by text DEFAULT 'entity'::text, p_include_curve boolean DEFAULT false, p_series_days integer DEFAULT NULL::integer, p_include_custom boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    SET plan_cache_mode TO 'force_custom_plan'
    AS $$
declare
  v_entity text := lower(coalesce(p_entity, ''));
  v_group_by text := lower(coalesce(p_group_by, 'entity'));
  v_date_start date := least(p_date_start, p_date_stop);
  v_date_stop date := greatest(p_date_start, p_date_stop);
  v_include_curve boolean := coalesce(p_include_curve, false);
  -- Linhas por DIA só da janela pedida (as telas de detalhe/filhos usam 5 dias de
  -- sparkline; só o histórico usa o período inteiro). Medido: os filhos do conjunto
  -- mais pesado (29 anúncios × 9 meses) saíam com 1,4 MB de dias que ninguém lia.
  v_series_start date;
  v_owners uuid[];
  v_requested integer;
  v_mql numeric;
  -- 140: histogramas das colunas vinculadas so quando pedidos (opt-in).
  v_include_custom boolean := coalesce(p_include_custom, false);
  v_result jsonb;
begin
  if auth.uid() is distinct from p_user_id then
    raise exception 'Forbidden: p_user_id must match auth.uid()'
      using errcode = '42501';
  end if;
  if v_entity not in ('ad_id', 'ad_name', 'adset_id') then
    raise exception 'Invalid p_entity: %, expected ad_id|ad_name|adset_id', v_entity
      using errcode = '22023';
  end if;
  if v_group_by not in ('entity', 'ad_id') then
    raise exception 'Invalid p_group_by: %, expected entity|ad_id', v_group_by
      using errcode = '22023';
  end if;
  if coalesce(p_entity_id, '') = '' then
    raise exception 'p_entity_id is required' using errcode = '22023';
  end if;

  -- Escopo: idêntico à base do Manager (v130/v132).
  if p_pack_ids is null then
    v_owners := array[p_user_id];
  else
    select array_agg(distinct a.owner_id), count(distinct a.pack_id)
      into v_owners, v_requested
    from public.resolve_pack_access(p_pack_ids, p_user_id) a;
    if coalesce(v_requested, 0) < (select count(distinct x) from unnest(p_pack_ids) x) then
      raise exception 'Forbidden: pack inacessivel na selecao'
        using errcode = '42501';
    end if;
    if v_owners is null or array_length(v_owners, 1) is null then
      v_owners := array[p_user_id];
    end if;
  end if;

  -- Corte de MQL dos packs (NULL = indefinido ou divergente; sem packs = NULL).
  v_mql := public.resolve_pack_mql_leadscore_min(p_user_id, p_pack_ids);

  -- (v158) Três significados, não dois:
  --   NULL  -> o período inteiro (o histórico usa isto)
  --   0     -> NENHUM dia. É o que a tela de variações precisa: ela não desenha a
  --            mini-série, e montá-la custava 44% da saída desta função.
  --   N > 0 -> os últimos N dias.
  -- Na v157 o zero caía junto do NULL e pedia o PERÍODO INTEIRO — o oposto do que
  -- "zero dias de série" quer dizer. Ninguém passava 0 (as rotas passavam 5 ou NULL),
  -- então o valor estava livre para receber o significado certo.
  -- Uma data depois do fim zera as três CTEs de dia (`day_nums`, `conv_days`,
  -- `lead_days`, todas com `r.date >= v_series_start`) sem tocar em totais nem curva.
  v_series_start := case
    when p_series_days is null then v_date_start
    when p_series_days <= 0 then v_date_stop + 1
    else greatest(v_date_start, v_date_stop - (p_series_days - 1))
  end;

  with
  -- 1. Chaves (silo, anúncio, dia) da entidade no período, por índice de ad_metrics.
  --    Os três ramos do OR são constantes sob force_custom_plan: o planner poda os
  --    dois falsos e usa o índice do verdadeiro.
  keys as (
    select am.user_id, am.pack_id, am.ad_id, am.date
    from unnest(v_owners) as o(owner_id)
    join public.ad_performance_daily am
      on am.user_id = o.owner_id
     and am.date >= v_date_start
     and am.date <= v_date_stop
     and (
       (v_entity = 'ad_id' and am.ad_id = p_entity_id)
       or (v_entity = 'ad_name' and am.ad_name = p_entity_id)
       or (v_entity = 'adset_id' and am.adset_id = p_entity_id)
     )
    where p_pack_ids is null
       or am.pack_id = any(p_pack_ids)
  ),
  -- 2. Dedup cross-silo: uma linha por (anúncio, dia); vence o silo que NÃO é o do
  --    ator (o dono do pack compartilhado), desempate por uuid — regra da v104/v130.
  dedup as (
    select k.user_id, k.pack_id, k.ad_id, k.date
    from (
      select k.*, row_number() over (partition by k.ad_id, k.date order by (k.user_id = p_user_id), k.user_id) as rn
      from keys k
    ) k
    where k.rn = 1
  ),
  -- 2a. (v155) Inventário da entidade: anúncio ativo no período sem linha de métrica
  --     neste (silo, pack). Entra zerado e sem dias — o backend já preenche com zero o
  --     dia sem dado. Entre silos, a mesma preferência do dedup (vence o dono do pack
  --     compartilhado); dentro do silo vencedor, todos os packs (viram pack_ids).
  inv as (
    select x.user_id, x.pack_id, x.ad_id
    from (
      select i.user_id, i.pack_id, i.ad_id,
             dense_rank() over (partition by i.ad_id order by (i.user_id = p_user_id), i.user_id) as rk
      from unnest(v_owners) as o(owner_id)
      join public.ad_pack_inventory i
        on i.user_id = o.owner_id
       and i.first_active_date <= v_date_stop
       and i.last_active_date >= v_date_start
       and (
         (v_entity = 'ad_id' and i.ad_id = p_entity_id)
         or (v_entity = 'ad_name' and i.ad_name = p_entity_id)
         or (v_entity = 'adset_id' and i.adset_id = p_entity_id)
       )
      where (p_pack_ids is null or i.pack_id = any(p_pack_ids))
        -- Pelo read model e não por `keys`: `keys` só tem as linhas que casam com a
        -- entidade, e um anúncio renomeado tem linhas reais com o nome antigo.
        and not exists (
          select 1 from public.ad_performance_daily d
          where d.user_id = i.user_id and d.pack_id = i.pack_id and d.ad_id = i.ad_id
            and d.date >= v_date_start and d.date <= v_date_stop
        )
    ) x
    where x.rk = 1
  ),
  -- 2b. (v134) Packs de cada anúncio, para a linha-filha poder ser filtrada por
  --     Pack. Segunda visita a ad_metric_pack_map — a primeira, em `keys`, só
  --     decide se o anúncio-dia entra; aqui coletamos os ids. Roda sobre `dedup`
  --     (uma linha por anúncio-dia, já resolvido o cross-silo) e agrega por
  --     anúncio, não por dia.
  --
  --     RESTRITO À SELEÇÃO, igual ao `pack_ids` da base do Manager: devolver o
  --     universo faria o filtro oferecer pack que não está na tela e produzir
  --     tabela vazia sem explicação.
  packs_by_ad as (
    select
      d.ad_id,
      coalesce(
        array_agg(distinct d.pack_id),
        array[]::uuid[]
      ) as pack_ids
    -- (v155) mais os packs em que o anúncio só está no inventário
    from (select ad_id, pack_id from dedup union all select ad_id, pack_id from inv) d
    group by d.ad_id
  ),
  -- 3. As linhas: SÓ o read model, pela PK.
  --    (v155) Colunas explícitas: o inventário entra por union, zerado e sem dia
  --    (`date` nulo fica fora da série; arrays vazios não geram conversão nem lead).
  rows_ as (
    select
      case when v_group_by = 'ad_id' then d.ad_id else p_entity_id end as group_key,
      d.user_id, d.pack_id, d.ad_id, d.date,
      -- (171) anuncio de IMAGEM nao contribui para metrica de video. Aqui pega tudo:
      -- totais, serie e a curva de retencao (que exige plays > 0).
      d.impressions, d.clicks, d.inline_link_clicks, d.spend, d.lpv, case when a.media_type = 'image' then 0 else d.plays end as plays, case when a.media_type = 'image' then 0 else d.thruplays end as thruplays,
      case when a.media_type = 'image' then 0 else d.hook_value end as hook_value, case when a.media_type = 'image' then 0 else d.scroll_stop_value end as scroll_stop_value, case when a.media_type = 'image' then 0 else d.hold_rate end as hold_rate, case when a.media_type = 'image' then 0 else d.video_watched_p50 end as video_watched_p50, case when a.media_type = 'image' then 0 else d.video_watched_p75 end as video_watched_p75,
      d.reach, d.conv_key_ids, d.conv_values, d.lead_scores, d.lead_qtys, d.custom_hist
    from dedup k
    join public.ad_performance_daily d on d.user_id = k.user_id and d.pack_id = k.pack_id and d.ad_id = k.ad_id and d.date = k.date
    left join public.ads a on a.user_id = d.user_id and a.ad_id = d.ad_id

    union all

    select
      case when v_group_by = 'ad_id' then i.ad_id else p_entity_id end as group_key,
      i.user_id, i.pack_id, i.ad_id, null::date,
      0::bigint, 0::bigint, 0::bigint, 0::numeric, 0::bigint, 0::bigint, 0::bigint,
      0::numeric, 0::numeric, 0::numeric, 0::numeric, 0::numeric,
      0::bigint, '{}'::integer[], '{}'::numeric[], '{}'::numeric[], '{}'::integer[], null::jsonb
    from inv i
  ),
  -- ------------------------------------------------------------------------------
  -- (v157) DAQUI PARA BAIXO NINGUÉM JUNTA ETAPA COM ETAPA.
  --
  -- O planner estima 1 linha para toda etapa derivada de `keys` (não tem como saber
  -- que um nome de criativo repete em 600 anúncios). Com 1 linha estimada, qualquer
  -- junção entre duas etapas vira laço aninhado, e o lado de dentro é re-executado
  -- ou re-varrido POR GRUPO: custo N². Medido em produção (14-15/09, conta com 630
  -- anúncios num nome): v145 = 19 s a mais de 200 s; v155 = 0,3 a 2,4 s conforme o
  -- plano sorteado. MATERIALIZED pontual não resolve (13,6 s com um, 0,8 s com todos,
  -- ainda N²); lista de chaves pré-resolvida por unnest também não (15,5 s).
  --
  -- O desenho: cada parte do grupo (totais, conversões, leads, histogramas, curva,
  -- dias, representante) é calculada UMA vez por agregação e empilhada numa lista só
  -- (`parts`, `day_parts`) marcada pelo tipo; uma agregação por grupo monta o objeto.
  -- Agregar é linear seja qual for a estimativa. Os únicos laços que sobram são
  -- buscas por índice de uma linha (ads, ad_metrics, inventário) — N buscas, não N².
  -- Saída byte a byte idêntica à v155 (diferencial em 14 telas de produção e teste 157).
  -- ------------------------------------------------------------------------------

  -- 4. Grupo × dia (só a janela de série): somas e somas ponderadas por plays (as
  --    razões saem em Python, com a mesma fórmula do Manager).
  days as (
    select
      r.group_key,
      r.date,
      sum(r.impressions)::bigint as impressions,
      sum(r.clicks)::bigint as clicks,
      sum(r.inline_link_clicks)::bigint as inline_link_clicks,
      sum(r.spend)::numeric as spend,
      sum(r.lpv)::bigint as lpv,
      sum(r.plays)::bigint as plays,
      sum(r.thruplays)::bigint as thruplays,
      sum(r.hook_value * r.plays)::numeric as hook_wsum,
      sum(r.scroll_stop_value * r.plays)::numeric as scroll_stop_wsum,
      sum(r.hold_rate * r.plays)::numeric as hold_rate_wsum,
      sum(r.video_watched_p50 * r.plays)::numeric as video_watched_p50_wsum,
      sum(r.video_watched_p75 * r.plays)::numeric as video_watched_p75_wsum,
      sum(r.reach)::bigint as reach
    from rows_ r
    where r.date >= v_series_start
    group by r.group_key, r.date
  ),
  -- (v157) Dicionário de chaves de evento como UM objeto {id: chave}. Juntar com a
  -- tabela a cada (grupo, dia, chave) dependeria do planner escolher hash; a busca
  -- no objeto (~85 chaves) não depende de estimativa nenhuma. Lido por subconsulta
  -- escalar (roda uma vez) e só o NOME da chave segue adiante: com `cross join ck` o
  -- objeto inteiro ia dentro de cada linha e a ordenação de 3,4 mil linhas escorria
  -- 14 MB para disco (medido).
  ck as (
    select coalesce(jsonb_object_agg(k.id::text, k.key), '{}'::jsonb) as m
    from public.conversion_keys k
  ),
  -- Conversões por (grupo, dia): agrupa por id da chave ANTES de traduzir para o nome
  -- (lição da v130: juntar par a par antes de agrupar custava segundos). Chave sem
  -- entrada no dicionário fica fora, como no inner join da v155.
  --   (v157) Sem `order by` dentro do jsonb_object_agg: o jsonb guarda as chaves na
  --   ordem dele, e a ordem de entrada só decide empate de chave repetida — que não
  --   existe (key_id agrupado, conversion_keys.key é UNIQUE). A ordenação por texto com
  --   colação era o maior custo que sobrava no histórico longo de um anúncio.
  conv_days as (
    select s.group_key, s.date,
           jsonb_object_agg(s.key, s.total) as conversions
    from (
      select x.group_key, x.date, (select ck.m from ck) ->> x.key_id::text as key, x.total
      from (
        select r.group_key, r.date, pr.key_id, sum(pr.value)::numeric as total
        from rows_ r
        cross join lateral unnest(r.conv_key_ids, r.conv_values) as pr(key_id, value)
        where r.date >= v_series_start
        group by r.group_key, r.date, pr.key_id
      ) x
      where (select ck.m from ck) ? x.key_id::text
    ) s
    group by s.group_key, s.date
  ),
  -- Leads por (grupo, dia): histograma score → quantidade (chave normalizada, 80.0 → "80").
  --   (v157) Sem `order by`: o score já vem agrupado como número (80 e 80.0 são o mesmo
  --   grupo), então a chave de texto nunca repete.
  lead_days as (
    select s.group_key, s.date,
           jsonb_object_agg(trim_scale(s.score)::text, s.qty) as leads
    from (
      select r.group_key, r.date, l.score, sum(l.qty)::integer as qty
      from rows_ r
      cross join lateral unnest(r.lead_scores, r.lead_qtys) as l(score, qty)
      where r.date >= v_series_start
      group by r.group_key, r.date, l.score
    ) s
    group by s.group_key, s.date
  ),
  -- (v157) O item de cada dia: números, conversões e leads empilhados e dobrados por
  -- (grupo, dia). Só existe dia que tem números (`having`): conversão e lead vêm das
  -- mesmas linhas, então nunca aparecem num dia sem números — a guarda documenta o
  -- left join da v155.
  day_parts as (
    select d.group_key, d.date, 's'::text as kind,
      jsonb_build_object(
        'date', d.date,
        'impressions', d.impressions,
        'clicks', d.clicks,
        'inline_link_clicks', d.inline_link_clicks,
        'spend', d.spend,
        'lpv', d.lpv,
        'plays', d.plays,
        'thruplays', d.thruplays,
        'hook_wsum', d.hook_wsum,
        'scroll_stop_wsum', d.scroll_stop_wsum,
        'hold_rate_wsum', d.hold_rate_wsum,
        'video_watched_p50_wsum', d.video_watched_p50_wsum,
        'video_watched_p75_wsum', d.video_watched_p75_wsum,
        'reach', d.reach
      ) as obj
    from days d
    union all
    select c.group_key, c.date, 'c', c.conversions from conv_days c
    union all
    select l.group_key, l.date, 'l', l.leads from lead_days l
  ),
  day_rows as (
    select
      p.group_key,
      p.date,
      (array_agg(p.obj) filter (where p.kind = 's'))[1]
        || jsonb_build_object(
             'conversions', coalesce((array_agg(p.obj) filter (where p.kind = 'c'))[1], '{}'::jsonb),
             'leads', coalesce((array_agg(p.obj) filter (where p.kind = 'l'))[1], '{}'::jsonb)
           ) as item
    from day_parts p
    group by p.group_key, p.date
    having bool_or(p.kind = 's')
  ),
  -- Totais do período inteiro por grupo (as telas de detalhe/filhos somam o período
  -- todo e mostram só 5 dias de série).
  --   (v157) `pack_ids`: com group_by = 'ad_id' o grupo É o anúncio, e os packs dele
  --   são os das suas linhas (reais e de inventário) — exatamente o `packs_by_ad` do
  --   anúncio, sem juntar. Com group_by = 'entity' o grupo tem vários anúncios e vale
  --   o pack do representante (ver grp_rep).
  totals as (
    select
      r.group_key,
      sum(r.impressions)::bigint as impressions,
      sum(r.clicks)::bigint as clicks,
      sum(r.inline_link_clicks)::bigint as inline_link_clicks,
      sum(r.spend)::numeric as spend,
      sum(r.lpv)::bigint as lpv,
      sum(r.plays)::bigint as plays,
      sum(r.thruplays)::bigint as thruplays,
      sum(r.hook_value * r.plays)::numeric as hook_wsum,
      sum(r.scroll_stop_value * r.plays)::numeric as scroll_stop_wsum,
      sum(r.hold_rate * r.plays)::numeric as hold_rate_wsum,
      sum(r.video_watched_p50 * r.plays)::numeric as video_watched_p50_wsum,
      sum(r.video_watched_p75 * r.plays)::numeric as video_watched_p75_wsum,
      sum(r.reach)::bigint as reach,
      array_agg(distinct r.pack_id) as pack_ids
    from rows_ r
    group by r.group_key
  ),
  conv_totals as (
    select s.group_key, jsonb_object_agg(s.key, s.total) as conversions
    from (
      select x.group_key, (select ck.m from ck) ->> x.key_id::text as key, x.total
      from (
        select r.group_key, pr.key_id, sum(pr.value)::numeric as total
        from rows_ r
        cross join lateral unnest(r.conv_key_ids, r.conv_values) as pr(key_id, value)
        group by r.group_key, pr.key_id
      ) x
      where (select ck.m from ck) ? x.key_id::text
    ) s
    group by s.group_key
  ),
  lead_totals as (
    select s.group_key, jsonb_object_agg(trim_scale(s.score)::text, s.qty) as leads
    from (
      select r.group_key, l.score, sum(l.qty)::integer as qty
      from rows_ r
      cross join lateral unnest(r.lead_scores, r.lead_qtys) as l(score, qty)
      group by r.group_key, l.score
    ) s
    group by s.group_key
  ),
  -- 140: histogramas das colunas vinculadas, somados no PERIODO inteiro por grupo
  -- (a entidade, ou cada filho). Sem serie por dia no v1. Opt-in por p_include_custom.
  custom_totals as (
    select y.group_key, jsonb_object_agg(y.mapping_id, y.hist) as custom_histograms
    from (
      select x.group_key, x.mapping_id, jsonb_object_agg(x.val, x.qty) as hist
      from (
        select r.group_key, m.key as mapping_id, v.key as val, sum(v.value::bigint)::bigint as qty
        from rows_ r
        cross join lateral jsonb_each(r.custom_hist) as m(key, value)
        cross join lateral jsonb_each_text(m.value) as v(key, value)
        where v_include_custom and r.custom_hist is not null
        group by r.group_key, m.key, v.key
      ) x
      group by x.group_key, x.mapping_id
    ) y
    group by y.group_key
  ),
  -- 5. Representante — MESMA regra da base do Manager: por anúncio, o dia de mais
  --    impressões (desempate: mais recente); no grupo, (impressões, ad_id) máximos.
  per_ad as (
    select
      r.group_key,
      r.user_id,
      r.ad_id,
      max((lpad(r.impressions::text, 12, '0') || e'\x1f' || coalesce(r.date::text, '') || e'\x1f' || r.pack_id::text) collate "C") as rep_enc
    from rows_ r
    group by r.group_key, r.user_id, r.ad_id
  ),
  grp as (
    select
      p.group_key,
      count(distinct p.ad_id)::integer as ad_count,
      max((substr(p.rep_enc, 1, 12) || e'\x1f' || p.ad_id || e'\x1f' || p.user_id::text
           || e'\x1f' || p.rep_enc) collate "C") as rep_enc,
      -- fallback de miniatura: qualquer cópia do grupo com arquivo no Storage (v132)
      max(nullif(a.thumb_storage_path, '')) as any_thumb_storage_path
    from per_ad p
    left join public.ads a
      on a.user_id = p.user_id
     and a.ad_id = p.ad_id
    group by p.group_key
  ),
  grp_dec as (
    select
      g.*,
      (split_part(g.rep_enc, e'\x1f', 2) collate "default") as rep_ad_id,
      (split_part(g.rep_enc, e'\x1f', 3))::uuid as rep_user_id,
      nullif(split_part(g.rep_enc, e'\x1f', 5), '')::date as rep_date,
      nullif(split_part(g.rep_enc, e'\x1f', 6), '')::uuid as rep_pack_id
    from grp g
  ),
  -- (v157) O representante já sai como o objeto do grupo. Os três laços daqui são
  -- buscas de UMA linha por índice (ad_metrics pela PK, inventário, ads).
  --   `rep_pack_ids` só com group_by = 'entity' (um grupo: a subconsulta roda uma vez).
  --   Com group_by = 'ad_id' o CASE é constante sob force_custom_plan e a subconsulta
  --   some do plano — se não sumisse, seria uma varredura de packs_by_ad POR anúncio.
  grp_rep as (
    select
      g.group_key,
      jsonb_build_object(
        'group_key', g.group_key,
        'ad_count', g.ad_count,
        'user_id', g.rep_user_id,
        'ad_id', g.rep_ad_id,
        -- (v155) representante sem dia (só inventário): nomes da linha do inventário.
        'ad_name', case when g.rep_date is null then ri.ad_name else am.ad_name end,
        'account_id', case when g.rep_date is null then ri.account_id else am.account_id end,
        'campaign_id', case when g.rep_date is null then ri.campaign_id else am.campaign_id end,
        'campaign_name', case when g.rep_date is null then ri.campaign_name else am.campaign_name end,
        'adset_id', case when g.rep_date is null then ri.adset_id else am.adset_id end,
        'adset_name', case when g.rep_date is null then ri.adset_name else am.adset_name end,
        'effective_status', a.effective_status,
        'thumb_storage_path', coalesce(nullif(a.thumb_storage_path, ''), g.any_thumb_storage_path)
      ) as obj,
      case when v_group_by = 'ad_id' then null
           else (select pba.pack_ids from packs_by_ad pba where pba.ad_id = g.rep_ad_id)
      end as rep_pack_ids
    from grp_dec g
    left join public.ad_metrics am on am.user_id = g.rep_user_id and am.pack_id = g.rep_pack_id and am.ad_id = g.rep_ad_id and am.date = g.rep_date
    left join lateral (
      select i.ad_name, i.account_id, i.campaign_id, i.campaign_name, i.adset_id, i.adset_name
      from public.ad_pack_inventory i
      where g.rep_date is null
        and i.user_id = g.rep_user_id
        and (p_pack_ids is null or i.pack_id = any(p_pack_ids))
        and i.ad_id = g.rep_ad_id
      order by i.last_active_date desc, i.pack_id
      limit 1
    ) ri on true
    left join public.ads a
      on a.user_id = g.rep_user_id
     and a.ad_id = g.rep_ad_id
  ),
  -- 6. Curva de retenção ponderada por plays (só quando pedida): Σ ponto×plays e
  --    Σ plays POR ÍNDICE — uma linha de curva mais curta não pesa nos índices que
  --    não tem (semântica da rota antiga). A divisão e o arredondamento ficam em Python.
  curve as (
    select
      r.group_key,
      (e.idx - 1)::integer as idx,
      sum(public.ad_performance_parse_value(e.val #>> '{}') * r.plays)::numeric as wsum,
      sum(r.plays)::bigint as psum
    from rows_ r
    join public.ad_metrics am on am.user_id = r.user_id and am.pack_id = r.pack_id and am.ad_id = r.ad_id and am.date = r.date
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(am.video_play_curve_actions) = 'array' then am.video_play_curve_actions else '[]'::jsonb end
    ) with ordinality as e(val, idx)
    where v_include_curve
      and r.plays > 0
    group by r.group_key, e.idx
  ),
  -- (v157) Sem generate_series + junção para tapar buracos: os índices de um grupo
  -- são sempre contíguos a partir de 0 (a linha de curva mais longa contribui com
  -- todos eles), então basta agregar em ordem. Índice cujo ponto não parseia tem
  -- wsum nulo e continua existindo — vira 0, como no coalesce da v155.
  curve_arr as (
    select
      c.group_key,
      jsonb_agg(coalesce(c.wsum, 0) order by c.idx) as curve_wsum,
      jsonb_agg(coalesce(c.psum, 0) order by c.idx) as curve_psum
    from curve c
    group by c.group_key
  ),
  -- (v157) Todas as partes de todos os grupos numa lista só. `aux` carrega os
  -- pack_ids da fonte certa para o modo (representante em 'entity', totais em 'ad_id').
  parts as (
    select g.group_key, 'rep'::text as kind, null::date as date, g.obj,
           case when v_group_by = 'ad_id' then null
                else to_jsonb(coalesce(g.rep_pack_ids, array[]::uuid[])) end as aux
    from grp_rep g
    union all
    select t.group_key, 'tot', null,
      jsonb_build_object(
        'impressions', t.impressions,
        'clicks', t.clicks,
        'inline_link_clicks', t.inline_link_clicks,
        'spend', t.spend,
        'lpv', t.lpv,
        'plays', t.plays,
        'thruplays', t.thruplays,
        'hook_wsum', t.hook_wsum,
        'scroll_stop_wsum', t.scroll_stop_wsum,
        'hold_rate_wsum', t.hold_rate_wsum,
        'video_watched_p50_wsum', t.video_watched_p50_wsum,
        'video_watched_p75_wsum', t.video_watched_p75_wsum,
        'reach', t.reach
      ),
      case when v_group_by = 'ad_id' then to_jsonb(t.pack_ids) else null end
    from totals t
    union all
    select c.group_key, 'conv', null, c.conversions, null from conv_totals c
    union all
    select l.group_key, 'lead', null, l.leads, null from lead_totals l
    union all
    select cu.group_key, 'cust', null, cu.custom_histograms, null from custom_totals cu
    union all
    select ca.group_key, 'curve', null, jsonb_build_object('w', ca.curve_wsum, 'p', ca.curve_psum), null from curve_arr ca
    union all
    select dr.group_key, 'day', dr.date, dr.item, null from day_rows dr
  ),
  -- (v157) Uma agregação por grupo monta o objeto final. O `having` reproduz o inner
  -- join grp_rep × total_rows da v155 (os dois vêm de rows_, então é só guarda).
  -- jsonb normaliza a ordem das chaves: `||` e jsonb_build_object dão o mesmo valor.
  groups_ as (
    select
      p.group_key,
      (array_agg(p.obj) filter (where p.kind = 'rep'))[1]
        || jsonb_build_object(
             'pack_ids', coalesce((array_agg(p.aux) filter (where p.aux is not null))[1], '[]'::jsonb),
             'curve_wsum', (array_agg(p.obj) filter (where p.kind = 'curve'))[1] -> 'w',
             'curve_psum', (array_agg(p.obj) filter (where p.kind = 'curve'))[1] -> 'p',
             'totals', (array_agg(p.obj) filter (where p.kind = 'tot'))[1]
               || jsonb_build_object(
                    'conversions', coalesce((array_agg(p.obj) filter (where p.kind = 'conv'))[1], '{}'::jsonb),
                    'leads', coalesce((array_agg(p.obj) filter (where p.kind = 'lead'))[1], '{}'::jsonb),
                    'custom_histograms', coalesce((array_agg(p.obj) filter (where p.kind = 'cust'))[1], '{}'::jsonb)
                  ),
             'days', coalesce(jsonb_agg(p.obj order by p.date) filter (where p.kind = 'day'), '[]'::jsonb)
           ) as item
    from parts p
    group by p.group_key
    having bool_or(p.kind = 'rep') and bool_or(p.kind = 'tot')
  )
  select jsonb_build_object(
    'mql_leadscore_min', v_mql,
    'groups', coalesce((select jsonb_agg(g.item order by g.group_key) from groups_ g), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;


ALTER FUNCTION public.fetch_entity_performance_v171(p_user_id uuid, p_date_start date, p_date_stop date, p_entity text, p_entity_id text, p_pack_ids uuid[], p_group_by text, p_include_curve boolean, p_series_days integer, p_include_custom boolean) OWNER TO postgres;

--
-- Name: FUNCTION fetch_entity_performance_v171(p_user_id uuid, p_date_start date, p_date_stop date, p_entity text, p_entity_id text, p_pack_ids uuid[], p_group_by text, p_include_curve boolean, p_series_days integer, p_include_custom boolean); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.fetch_entity_performance_v171(p_user_id uuid, p_date_start date, p_date_stop date, p_entity text, p_entity_id text, p_pack_ids uuid[], p_group_by text, p_include_curve boolean, p_series_days integer, p_include_custom boolean) IS '171: o detalhe de entidade (v158) com a regra da 170 — vale para totais, série e curva de retenção.';


--
-- Name: fetch_manager_performance_base_v145(uuid, date, date, text, uuid[], text[], text, text, text, text, boolean, boolean, integer, integer, text, text, boolean); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.fetch_manager_performance_base_v145(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text DEFAULT 'ad_name'::text, p_pack_ids uuid[] DEFAULT NULL::uuid[], p_account_ids text[] DEFAULT NULL::text[], p_campaign_name_contains text DEFAULT NULL::text, p_adset_name_contains text DEFAULT NULL::text, p_ad_name_contains text DEFAULT NULL::text, p_action_type text DEFAULT NULL::text, p_include_leadscore boolean DEFAULT true, p_include_available_conversion_types boolean DEFAULT true, p_limit integer DEFAULT 500, p_offset integer DEFAULT 0, p_order_by text DEFAULT 'spend'::text, p_campaign_id text DEFAULT NULL::text, p_include_custom boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    SET plan_cache_mode TO 'force_custom_plan'
    SET work_mem TO '32MB'
    AS $$
declare
  v_group_by text := lower(coalesce(p_group_by, 'ad_name'));
  v_order_by text := lower(coalesce(p_order_by, 'spend'));
  v_date_start date := least(p_date_start, p_date_stop);
  v_date_stop date := greatest(p_date_start, p_date_stop);
  v_limit integer := greatest(1, least(coalesce(p_limit, 500), 10000));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
  v_selected_key text := trim(coalesce(p_action_type, ''));
  v_key_id integer := null;
  v_include_conv_types boolean := coalesce(p_include_available_conversion_types, true);
  v_include_leads boolean := coalesce(p_include_leadscore, true);
  -- 140: histogramas das colunas vinculadas so quando pedidos (opt-in).
  v_include_custom boolean := coalesce(p_include_custom, false);
  v_result jsonb;
  v_owners uuid[];
  v_requested integer;
  -- universo de packs para a máscara: a seleção pedida, ou (ramo legado) todos os
  -- packs do ator. Posição i do array ↔ bit i-1 da máscara.
  v_pack_universe uuid[];
  v_n_packs integer;
begin
  if auth.uid() is distinct from p_user_id then
    raise exception 'Forbidden: p_user_id must match auth.uid()'
      using errcode = '42501';
  end if;

  if p_pack_ids is null then
    v_owners := array[p_user_id];
    select coalesce(array_agg(id order by id), array[]::uuid[])
      into v_pack_universe
    from public.packs where user_id = p_user_id;
  else
    select array_agg(distinct a.owner_id), count(distinct a.pack_id)
      into v_owners, v_requested
    from public.resolve_pack_access(p_pack_ids, p_user_id) a;
    if coalesce(v_requested, 0) < (select count(distinct x) from unnest(p_pack_ids) x) then
      raise exception 'Forbidden: pack inacessivel na selecao'
        using errcode = '42501';
    end if;
    if v_owners is null or array_length(v_owners, 1) is null then
      v_owners := array[p_user_id];
    end if;
    select array_agg(distinct x order by x) into v_pack_universe from unnest(p_pack_ids) x;
  end if;
  v_n_packs := greatest(1, coalesce(cardinality(v_pack_universe), 0));

  if v_group_by not in ('ad_id', 'ad_name', 'adset_id', 'campaign_id') then
    raise exception 'Invalid p_group_by: %, expected ad_id|ad_name|adset_id|campaign_id', v_group_by
      using errcode = '22023';
  end if;

  -- Normalização da chave pedida, idêntica à v116 (sem prefixo = 'conversion:').
  if v_selected_key <> '' and v_selected_key not like 'conversion:%' and v_selected_key not like 'action:%' then
    v_selected_key := 'conversion:' || v_selected_key;
  end if;
  if v_selected_key <> '' then
    -- Chave nunca vista no dicionário = nenhum anúncio tem esse evento → resultados 0,
    -- exatamente como a v116 (nenhum elemento casava).
    select id into v_key_id from public.conversion_keys where key = v_selected_key;
  end if;

  with
  -- 1. A seleção, resolvida no MAPA (índice composto user/pack/date/ad; ~40 B por linha).
  --    GROUP BY (ad_id, dia) faz de uma vez: (a) dedup cross-silo com a MESMA preferência
  --    da v116 — vence o dono do pack compartilhado, o ator perde, desempate por uuid;
  --    (b) dedup de sobreposição entre packs do mesmo dono; (c) sinal de conflito
  --    cross-silo (min <> max do dono); (d) máscara dos packs de origem (bit por pack).
  keys as (
    select
      apm.ad_id,
      apm.date as date,
      apm.user_id,
      false as x_cross_silo,
      set_bit(repeat('0', v_n_packs)::varbit, array_position(v_pack_universe, apm.pack_id) - 1, 1) as pack_mask,
      apm.pack_id
    from unnest(v_owners) as o(owner_id)
    join public.ad_performance_daily apm
      on apm.user_id = o.owner_id
     and apm.pack_id = any(p_pack_ids)
     and apm.date >= v_date_start
     and apm.date <= v_date_stop
    where p_pack_ids is not null

    union all

    -- Ramo legado (sem packs): o silo do ator no período; packs de origem por lookup.
    select
      am.ad_id,
      am.date,
      p_user_id as user_id,
      false as x_cross_silo,
      coalesce(bit_or(set_bit(repeat('0', v_n_packs)::varbit, array_position(v_pack_universe, am.pack_id) - 1, 1)), repeat('0', v_n_packs)::varbit) as pack_mask,
      -- Postgres nao tem min(uuid): "um pack qualquer, deterministico" via array_agg ordenado.
      (array_agg(am.pack_id order by am.pack_id))[1] as pack_id
    from public.ad_performance_daily am
    where p_pack_ids is null
      and am.user_id = p_user_id
      and am.date >= v_date_start
      and am.date <= v_date_stop
    group by am.ad_id, am.date
  ),
  -- 2. As linhas: SÓ o read model (ad_performance_daily, migration 129), pela chave
  --    única. ad_metrics não entra aqui — entra só para a linha representante (fim) e
  --    para filtros por nome de campanha/conjunto (EXISTS abaixo, podado quando o
  --    filtro está vazio: o predicado é constante sob force_custom_plan).
  sel as (
    select
      k.user_id,
      k.ad_id,
      k.date,
      k.pack_mask,
      k.pack_id,
      case
        when v_group_by = 'ad_id' then d.ad_id
        when v_group_by = 'ad_name' then coalesce(nullif(d.ad_name, ''), d.ad_id)
        when v_group_by = 'adset_id' then d.adset_id
        when v_group_by = 'campaign_id' then d.campaign_id
        else d.ad_id
      end as group_key,
      -- Só o que a agregação consome. Nomes de campanha/conjunto NÃO viajam por
      -- linha: saem da linha REPRESENTANTE no fim (77 lookups em ad_metrics).
      d.account_id,
      d.adset_id,
      d.campaign_id,
      d.impressions,
      d.clicks,
      d.inline_link_clicks,
      d.spend,
      d.lpv,
      d.plays,
      d.thruplays,
      d.video_watched_p50,
      d.video_watched_p75,
      d.hold_rate,
      d.reach,
      d.frequency,
      d.hook_value,
      d.scroll_stop_value,
      -- conversão pedida por posição no array (leads: CTE próprio, leads_by_group)
      coalesce(d.conv_values[array_position(d.conv_key_ids, v_key_id)], 0)::numeric as results
    from keys k
    join public.ad_performance_daily d on d.user_id = k.user_id and d.pack_id = k.pack_id and d.ad_id = k.ad_id and d.date = k.date
    where (p_account_ids is null or d.account_id = any(p_account_ids))
      and (p_ad_name_contains is null or p_ad_name_contains = ''
           or coalesce(d.ad_name, '') ilike '%' || p_ad_name_contains || '%')
      and (
        (coalesce(p_campaign_name_contains, '') = '' and coalesce(p_adset_name_contains, '') = '')
        or exists (
          select 1 from public.ad_metrics am where am.user_id = k.user_id and am.pack_id = k.pack_id and am.ad_id = k.ad_id and am.date = k.date
            and (coalesce(p_campaign_name_contains, '') = ''
                 or coalesce(am.campaign_name, '') ilike '%' || p_campaign_name_contains || '%')
            and (coalesce(p_adset_name_contains, '') = ''
                 or coalesce(am.adset_name, '') ilike '%' || p_adset_name_contains || '%')
        )
      )
  ),
  -- `coalesce(x,'') <> ''` e não `nullif(x,'') is not null`: mesma semântica, mas o
  -- planner dá seletividade ~1 ao `<>` e 0,005 ao `is not null` sobre expressão —
  -- com 0,005 ele estimava 1 linha aqui e escolhia agregação por ordenação (spill).
  filtered as (
    select * from sel where coalesce(group_key, '') <> ''
  ),
  -- 3. Anúncio-dia → anúncio (por silo). Só agregados de estado constante.
  per_ad as (
    select
      f.group_key,
      f.user_id,
      f.ad_id,
      sum(f.impressions)::bigint as impressions,
      sum(f.clicks)::bigint as clicks,
      sum(f.inline_link_clicks)::bigint as inline_link_clicks,
      sum(f.spend)::numeric as spend,
      sum(f.lpv)::bigint as lpv,
      sum(f.plays)::bigint as plays,
      sum(f.thruplays)::bigint as thruplays,
      sum(f.hook_value * f.plays)::numeric as hook_wsum,
      sum(f.hold_rate * f.plays)::numeric as hold_rate_wsum,
      sum(f.video_watched_p50 * f.plays)::numeric as video_watched_p50_wsum,
      sum(f.video_watched_p75 * f.plays)::numeric as video_watched_p75_wsum,
      sum(f.scroll_stop_value * f.plays)::numeric as scroll_stop_wsum,
      sum(f.reach)::bigint as reach,
      sum(f.frequency * f.impressions)::numeric as frequency_wsum,
      sum(f.results)::numeric as results,
      -- um anúncio pertence a UMA conta e a UM conjunto: min() é exato
      min(nullif(f.account_id, '')) as account_id,
      min(nullif(f.adset_id, '')) as adset_id,
      min(nullif(f.campaign_id, '')) as campaign_id,
      bit_or(f.pack_mask) as pack_mask,
      -- dia representante deste anúncio: max impressões (desempate: dia mais recente)
      max((lpad(f.impressions::text, 12, '0') || e'\x1f' || f.date::text) collate "C") as rep_enc
    from filtered f
    group by f.group_key, f.user_id, f.ad_id
  ),
  -- 4. Um lookup em `ads` por anúncio (índice de cobertura ads_user_ad_status_idx).
  per_ad_status as (
    select
      pa.*,
      a.effective_status,
      a.meta_created_time,
      a.thumb_storage_path
    from per_ad pa
    left join public.ads a
      on a.user_id = pa.user_id
     and a.ad_id = pa.ad_id
  ),
  -- 5. Anúncio → grupo.
  grp as (
    select
      p.group_key,
      sum(p.impressions)::bigint as impressions,
      sum(p.clicks)::bigint as clicks,
      sum(p.inline_link_clicks)::bigint as inline_link_clicks,
      sum(p.spend)::numeric as spend,
      sum(p.lpv)::bigint as lpv,
      sum(p.plays)::bigint as plays,
      sum(p.thruplays)::bigint as thruplays,
      sum(p.hook_wsum)::numeric as hook_wsum,
      sum(p.hold_rate_wsum)::numeric as hold_rate_wsum,
      sum(p.video_watched_p50_wsum)::numeric as video_watched_p50_wsum,
      sum(p.video_watched_p75_wsum)::numeric as video_watched_p75_wsum,
      sum(p.scroll_stop_wsum)::numeric as scroll_stop_wsum,
      sum(p.reach)::bigint as reach,
      sum(p.frequency_wsum)::numeric as frequency_wsum,
      sum(p.results)::numeric as results,
      count(distinct p.ad_id)::integer as ad_id_count,
      count(distinct p.adset_id)::integer as adset_count,
      coalesce(array_agg(distinct p.account_id) filter (where p.account_id is not null), array[]::text[]) as account_ids,
      -- v136/137: TODAS as campanhas e conjuntos do grupo, nao a do representante.
      -- Mesma passada do account_ids: mesmo group by, nenhuma leitura nova.
      coalesce(array_agg(distinct p.campaign_id) filter (where p.campaign_id is not null), array[]::text[]) as campaign_ids,
      coalesce(array_agg(distinct p.adset_id) filter (where p.adset_id is not null), array[]::text[]) as adset_ids,
      bit_or(p.pack_mask) as pack_mask,
      -- representante do grupo = (impressões do dia rep, ad_id) máximos — a ordem
      -- (impressions desc, ad_id desc) da v116; user_id e os campos vão de carona.
      max((substr(p.rep_enc, 1, 12) || e'\x1f' || p.ad_id || e'\x1f' || p.user_id::text
           || e'\x1f' || p.rep_enc) collate "C") as rep_enc,
      bool_or(upper(coalesce(p.effective_status, '')) = 'ACTIVE') as has_active,
      count(distinct p.ad_id) filter (where upper(coalesce(p.effective_status, '')) = 'ACTIVE')::integer as active_count,
      -- v138: por que o grupo esta parado. `fallback_status` (o min alfabetico logo
      -- abaixo) responde "algum anuncio esta assim, e foi o primeiro do alfabeto" -
      -- por isso um criativo com um anuncio arquivado aparece como ARCHIVED. Contar
      -- permite a pergunta certa: TODOS estao pausados pelo mesmo motivo?
      -- Mesma passada e mesmo group by do active_count: nenhuma leitura nova.
      count(distinct p.ad_id) filter (where upper(coalesce(p.effective_status, '')) = 'PAUSED')::integer as paused_self_count,
      count(distinct p.ad_id) filter (where upper(coalesce(p.effective_status, '')) = 'ADSET_PAUSED')::integer as adset_paused_count,
      count(distinct p.ad_id) filter (where upper(coalesce(p.effective_status, '')) = 'CAMPAIGN_PAUSED')::integer as campaign_paused_count,
      min(p.effective_status) filter (where nullif(p.effective_status, '') is not null) as fallback_status,
      min(p.meta_created_time) as meta_created_min,
      -- fallback de miniatura: qualquer anúncio do grupo com arquivo no Storage
      -- (medido: 13 de 3.451 criativos têm o representante sem e uma cópia com)
      max(p.thumb_storage_path) filter (where nullif(p.thumb_storage_path, '') is not null) as any_thumb_storage_path
    from per_ad_status p
    group by p.group_key
  ),
  -- Leads: CTE próprio e ESTREITO. Só 23% dos anúncio-dias têm leads; parte do
  -- rollup (sem JSON), busca em ad_metrics só o necessário para o group_key e os
  -- filtros, e soma o histograma por (grupo, score). Fora da passada principal
  -- para não carregar JSON por duas camadas de agregação. MATERIALIZED: referenciado
  -- uma vez, o planner o inlinaria como lado interno de um nested loop e o
  -- recalcularia por grupo (medido: 397 execuções, 4,4 s).
  leads_by_group as materialized (
    select
      x.group_key,
      jsonb_object_agg(trim_scale(x.score)::text, x.qty order by x.score) as leadscore_histogram
    from (
      select
        case
          when v_group_by = 'ad_id' then d.ad_id
          when v_group_by = 'ad_name' then coalesce(nullif(d.ad_name, ''), d.ad_id)
          when v_group_by = 'adset_id' then d.adset_id
          when v_group_by = 'campaign_id' then d.campaign_id
          else d.ad_id
        end as group_key,
        s.score,
        sum(s.qty)::integer as qty
      from keys k
      join public.ad_performance_daily d on d.user_id = k.user_id and d.pack_id = k.pack_id and d.ad_id = k.ad_id and d.date = k.date
      cross join lateral unnest(d.lead_scores, d.lead_qtys) as s(score, qty)
      where v_include_leads
        and cardinality(d.lead_scores) > 0
        and (p_account_ids is null or d.account_id = any(p_account_ids))
        and (p_ad_name_contains is null or p_ad_name_contains = ''
             or coalesce(d.ad_name, '') ilike '%' || p_ad_name_contains || '%')
        and (
          (coalesce(p_campaign_name_contains, '') = '' and coalesce(p_adset_name_contains, '') = '')
          or exists (
            select 1 from public.ad_metrics am where am.user_id = k.user_id and am.pack_id = k.pack_id and am.ad_id = k.ad_id and am.date = k.date
              and (coalesce(p_campaign_name_contains, '') = ''
                   or coalesce(am.campaign_name, '') ilike '%' || p_campaign_name_contains || '%')
              and (coalesce(p_adset_name_contains, '') = ''
                   or coalesce(am.adset_name, '') ilike '%' || p_adset_name_contains || '%')
          )
        )
      group by 1, s.score
    ) x
    where coalesce(x.group_key, '') <> ''
    group by x.group_key
  ),
  -- 140: histogramas das colunas vinculadas, somados por (grupo, vinculo, valor).
  -- Mesma forma do leads_by_group: CTE estreito, MATERIALIZED, mesmos filtros, e
  -- opt-in por p_include_custom. Quem nao vincula coluna nenhuma tem a coluna nula
  -- e o frontend nem pede: custo zero fora do caso de uso.
  custom_by_group as materialized (
    select
      y.group_key,
      jsonb_object_agg(y.mapping_id, y.hist) as custom_histograms
    from (
      select x.group_key, x.mapping_id, jsonb_object_agg(x.val, x.qty) as hist
      from (
        select
          case
            when v_group_by = 'ad_id' then d.ad_id
            when v_group_by = 'ad_name' then coalesce(nullif(d.ad_name, ''), d.ad_id)
            when v_group_by = 'adset_id' then d.adset_id
            when v_group_by = 'campaign_id' then d.campaign_id
            else d.ad_id
          end as group_key,
          m.key as mapping_id,
          v.key as val,
          sum(v.value::bigint)::bigint as qty
        from keys k
        join public.ad_performance_daily d on d.user_id = k.user_id and d.pack_id = k.pack_id and d.ad_id = k.ad_id and d.date = k.date
        cross join lateral jsonb_each(d.custom_hist) as m(key, value)
        cross join lateral jsonb_each_text(m.value) as v(key, value)
        where v_include_custom
          and d.custom_hist is not null
          and (p_account_ids is null or d.account_id = any(p_account_ids))
          and (p_ad_name_contains is null or p_ad_name_contains = ''
               or coalesce(d.ad_name, '') ilike '%' || p_ad_name_contains || '%')
          and (
            (coalesce(p_campaign_name_contains, '') = '' and coalesce(p_adset_name_contains, '') = '')
            or exists (
              select 1 from public.ad_metrics am where am.user_id = k.user_id and am.pack_id = k.pack_id and am.ad_id = k.ad_id and am.date = k.date
                and (coalesce(p_campaign_name_contains, '') = ''
                     or coalesce(am.campaign_name, '') ilike '%' || p_campaign_name_contains || '%')
                and (coalesce(p_adset_name_contains, '') = ''
                     or coalesce(am.adset_name, '') ilike '%' || p_adset_name_contains || '%')
            )
          )
        group by 1, m.key, v.key
      ) x
      where coalesce(x.group_key, '') <> ''
      group by x.group_key, x.mapping_id
    ) y
    group by y.group_key
  ),
  -- 6. Enriquecimento por grupo (~77 linhas): representante em `ads`, tags do ATOR,
  --    packs da máscara, histograma de leads.
  -- Decodifica o representante (posições da chave: 1 impressões | 2 ad_id | 3 user_id
  -- | 4 impressões do dia | 5 date) e busca a LINHA representante em ad_metrics para
  -- os nomes — 77 lookups pela chave única, em vez de carregar nomes em 42 mil linhas.
  -- `collate "default"`: a chave é comparada em "C"; os pedaços voltam à colação das
  -- colunas, senão o `=` contra ads/ad_metrics não usa índice (medido: bitmap scan
  -- de 21 mil linhas por grupo).
  grp_dec as (
    select
      g.*,
      (split_part(g.rep_enc, e'\x1f', 2) collate "default") as rep_ad_id,
      (split_part(g.rep_enc, e'\x1f', 3))::uuid as rep_user_id,
      (split_part(g.rep_enc, e'\x1f', 5))::date as rep_date
    from grp g
  ),
  grp_rep as (
    select
      g.*,
      am.ad_name as rep_ad_name,
      am.account_id as rep_account_id,
      am.campaign_id as rep_campaign_id,
      am.campaign_name as rep_campaign_name,
      am.adset_id as rep_adset_id,
      am.adset_name as rep_adset_name
    from grp_dec g
    left join public.ad_metrics am on am.user_id = g.rep_user_id and am.pack_id = any(coalesce(p_pack_ids, v_pack_universe)) and am.ad_id = g.rep_ad_id and am.date = g.rep_date
  ),
  rows_enriched as (
    select
      g.group_key,
      g.rep_account_id as account_id,
      g.account_ids,
      g.campaign_ids,
      g.adset_ids,
      coalesce((
        select array_agg(v_pack_universe[i] order by i)
        from generate_series(1, v_n_packs) i
        where get_bit(g.pack_mask, i - 1) = 1
      ), array[]::uuid[]) as pack_ids,
      g.rep_campaign_id as campaign_id,
      g.rep_campaign_name as campaign_name,
      g.rep_adset_id as adset_id,
      g.rep_adset_name as adset_name,
      g.rep_ad_id,
      g.rep_ad_name,
      case
        when v_group_by = 'campaign_id' then coalesce(nullif(g.rep_campaign_name, ''), g.group_key)
        when v_group_by = 'adset_id' then coalesce(nullif(g.rep_adset_name, ''), g.group_key)
        else coalesce(nullif(g.rep_ad_name, ''), g.rep_ad_id)
      end as label_name,
      case
        when v_group_by = 'campaign_id' then null
        when coalesce(g.has_active, false) then 'ACTIVE'
        else coalesce(g.fallback_status, ra.effective_status)
      end as effective_status,
      case
        when v_group_by = 'campaign_id' then null
        else coalesce(g.active_count, 0)
      end as active_count,
      -- Contadores de motivo SO nas abas que agregam anuncios. Em conjunto e
      -- campanha a linha E a propria entidade, e o status dela vem de
      -- `parent_entities` (o estado do Meta) - mandar contadores la faria a tela
      -- classificar um CONJUNTO pausado como "pausado pelo conjunto", que e a
      -- resposta certa para o anuncio e errada para o conjunto. A ausencia e o
      -- sinal: sem contadores, a tela le `effective_status` direto.
      case when v_group_by in ('ad_name', 'ad_id') then coalesce(g.paused_self_count, 0) end as paused_self_count,
      case when v_group_by in ('ad_name', 'ad_id') then coalesce(g.adset_paused_count, 0) end as adset_paused_count,
      case when v_group_by in ('ad_name', 'ad_id') then coalesce(g.campaign_paused_count, 0) end as campaign_paused_count,
      g.impressions, g.clicks, g.inline_link_clicks, g.spend, g.lpv, g.plays, g.thruplays,
      g.hook_wsum, g.hold_rate_wsum, g.video_watched_p50_wsum, g.video_watched_p75_wsum,
      g.scroll_stop_wsum, g.reach, g.frequency_wsum,
      case when v_group_by = 'campaign_id' then g.adset_count else g.ad_id_count end as ad_count,
      -- Chave do histograma normalizada (80.0 → "80"); a v116 mandava o array cru.
      coalesce(lg.leadscore_histogram, '{}'::jsonb) as leadscore_histogram,
      -- 140: {"<mapping_id>": {"<valor>": quantidade}}; {} quando nao pedido ou sem dado.
      coalesce(cg.custom_histograms, '{}'::jsonb) as custom_histograms,
      g.results,
      g.meta_created_min,
      coalesce(nullif(ra.thumbnail_url, ''), nullif(ra.adcreatives_videos_thumbs ->> 0, '')) as thumbnail,
      ra.adcreatives_videos_thumbs,
      coalesce(nullif(ra.thumb_storage_path, ''), g.any_thumb_storage_path) as thumb_storage_path,
      coalesce(tg.tags, '[]'::jsonb) as tags,
      -- v132: o que a rota hidratava com 15 requisições e 13,7 mil linhas por carga
      -- (medido) agora vem daqui. Só nos níveis de criativo/anúncio, como a hidratação
      -- fazia (num nível de conjunto/campanha o "ad_name" é o nome do pai).
      -- media_type = maior precedência entre as cópias do nome (vídeo > imagem; 'unknown'
      -- e NULL ignorados) — a semântica exata de _hydrate_media_type_for_rankings_rows.
      case
        when v_group_by in ('ad_name', 'ad_id') then mt.media_type
        else null
      end as media_type,
      case
        when v_group_by in ('ad_name', 'ad_id') then coalesce(tr.has_transcription, false)
        else false
      end as has_transcription,
      -- Transcrito GANHA de sem-audio: num pack compartilhado os dois silos podem ter
      -- registros diferentes para o mesmo ad_name, e o texto que existe de fato vale
      -- mais do que a falha registrada no silo vizinho.
      case
        when v_group_by in ('ad_name', 'ad_id')
          then coalesce(tr.no_audio, false) and not coalesce(tr.has_transcription, false)
        else false
      end as transcription_no_audio
    from grp_rep g
    left join lateral (
      select case max(case a.media_type when 'video' then 2 when 'image' then 1 end)
               when 2 then 'video' when 1 then 'image' end as media_type
      from public.ads a
      where v_group_by in ('ad_name', 'ad_id')
        and a.user_id = any(v_owners)
        and a.ad_name = coalesce(nullif(g.rep_ad_name, ''), g.rep_ad_id)
    ) mt on true
    left join lateral (
      -- 142: a lateral deixa de responder "existe transcricao?" e passa a responder
      -- "em que estado esta esta midia?". O `limit 1` e o filtro de status saem porque
      -- agora e preciso VER a linha de falha para distinguir "sem audio detectavel"
      -- (permanente: nunca vai ser transcrito) de "ainda nao transcrito" (acionavel).
      -- Nao ha custo novo: ad_transcriptions tem UNIQUE (user_id, ad_name), entao a
      -- lateral le no maximo uma linha por dono (v_owners tem 1, ou 2 em pack
      -- compartilhado) pelo mesmo index scan de antes.
      --
      -- `no_voice_detected` e escrito pelos DOIS caminhos de falha do worker
      -- (transcription_worker.py) desde que a normalizacao existe; as linhas antigas
      -- que so tinham a frase no `error_message` sao corrigidas pelo backfill no fim
      -- desta migration. Por isso o SQL le so a flag e nao repete aqui a lista de
      -- frases que vive em supabase_repo._NO_AUDIO_PHRASES: uma regra, um lugar.
      select
        bool_or(t.status = 'completed') as has_transcription,
        bool_or(t.status = 'failed' and coalesce(t.metadata ->> 'no_voice_detected', '') = 'true') as no_audio
      from public.ad_transcriptions t
      where v_group_by in ('ad_name', 'ad_id')
        and t.user_id = any(v_owners)
        and t.ad_name = coalesce(nullif(g.rep_ad_name, ''), g.rep_ad_id)
    ) tr on true
    left join leads_by_group lg
      on lg.group_key = g.group_key
    left join custom_by_group cg
      on cg.group_key = g.group_key
    left join public.ads ra
      on ra.user_id = g.rep_user_id
     and ra.ad_id = g.rep_ad_id
    left join lateral (
      -- v116: tags do ATOR (p_user_id), só nos níveis de criativo/anúncio.
      select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'color', t.color) order by t.name, t.id) as tags
      -- v139: tags do SILO DO PACK, nao do ator. Mesma forma das duas laterais
      -- vizinhas (media_type e has_transcription), que ja liam por any(v_owners).
      from public.ad_tags atg
      join public.tags t on t.id = atg.tag_id and t.user_id = atg.user_id
      where v_group_by in ('ad_name', 'ad_id')
        and atg.user_id = any(v_owners)
        and atg.ad_name = coalesce(nullif(g.rep_ad_name, ''), g.rep_ad_id)
    ) tg on true
  ),
  rows_metrics as (
    select
      re.*,
      case when re.plays > 0 then re.hook_wsum / re.plays else 0 end as hook,
      case when re.plays > 0 then re.hold_rate_wsum / re.plays else 0 end as hold_rate,
      round(case when re.plays > 0 then re.video_watched_p50_wsum / re.plays else 0 end)::int as video_watched_p50,
      round(case when re.plays > 0 then re.video_watched_p75_wsum / re.plays else 0 end)::int as video_watched_p75,
      case when re.plays > 0 then re.scroll_stop_wsum / re.plays else 0 end as scroll_stop,
      case when re.impressions > 0 then re.clicks::numeric / re.impressions else 0 end as ctr,
      case when re.inline_link_clicks > 0 then re.lpv::numeric / re.inline_link_clicks else 0 end as connect_rate,
      case when re.impressions > 0 then (re.spend * 1000.0) / re.impressions else 0 end as cpm,
      case when re.impressions > 0 then re.inline_link_clicks::numeric / re.impressions else 0 end as website_ctr,
      case when re.impressions > 0 then re.frequency_wsum / re.impressions else 0 end as frequency,
      case when re.results > 0 then re.spend / re.results else 0 end as cpr,
      case when re.lpv > 0 then re.results / re.lpv else 0 end as page_conv,
      case when v_selected_key <> '' then jsonb_build_object(v_selected_key, re.results) else '{}'::jsonb end as conversions
    from rows_enriched re
  ),
  totals as (
    select
      coalesce(sum(rm.spend), 0)::numeric as total_spend,
      coalesce(sum(rm.impressions), 0)::bigint as total_impressions,
      coalesce(sum(rm.clicks), 0)::bigint as total_clicks,
      coalesce(sum(rm.inline_link_clicks), 0)::bigint as total_inline,
      coalesce(sum(rm.lpv), 0)::bigint as total_lpv,
      coalesce(sum(rm.plays), 0)::bigint as total_plays,
      coalesce(sum(rm.hook_wsum), 0)::numeric as total_hook_wsum,
      coalesce(sum(rm.hold_rate_wsum), 0)::numeric as total_hold_rate_wsum,
      coalesce(sum(rm.video_watched_p50_wsum), 0)::numeric as total_video_watched_p50_wsum,
      coalesce(sum(rm.video_watched_p75_wsum), 0)::numeric as total_video_watched_p75_wsum,
      coalesce(sum(rm.scroll_stop_wsum), 0)::numeric as total_scroll_stop_wsum,
      coalesce(sum(rm.results), 0)::numeric as total_results
    from rows_metrics rm
  ),
  -- Tipos disponíveis + per_action_type de TODAS as chaves: só quando pedido (o
  -- predicado é constante sob force_custom_plan → o planner poda o ramo inteiro).
  -- Relê a seleção estreita (keys, já materializada) + filtros de nome em ad_metrics +
  -- os arrays do rollup; sem JSON.
  -- Soma por key_id ANTES de juntar com o dicionário: são ≤ 81 linhas depois do GROUP
  -- BY. Juntar antes custou 10,6 s no cenário de 30 packs (826 mil pares desempacotados
  -- materializados e varridos uma vez por chave do dicionário).
  conv_all as (
    select ck.key as conv_key, c.total_results
    from (
    select pr.key_id, sum(pr.value)::numeric as total_results
    from keys k
    join public.ad_performance_daily d on d.user_id = k.user_id and d.pack_id = k.pack_id and d.ad_id = k.ad_id and d.date = k.date
    cross join lateral unnest(d.conv_key_ids, d.conv_values) as pr(key_id, value)
    where v_include_conv_types
      and coalesce(case
        when v_group_by = 'ad_id' then d.ad_id
        when v_group_by = 'ad_name' then coalesce(nullif(d.ad_name, ''), d.ad_id)
        when v_group_by = 'adset_id' then d.adset_id
        when v_group_by = 'campaign_id' then d.campaign_id
        else d.ad_id end, '') <> ''
      and (p_account_ids is null or d.account_id = any(p_account_ids))
      and (p_ad_name_contains is null or p_ad_name_contains = ''
           or coalesce(d.ad_name, '') ilike '%' || p_ad_name_contains || '%')
      and (
        (coalesce(p_campaign_name_contains, '') = '' and coalesce(p_adset_name_contains, '') = '')
        or exists (
          select 1 from public.ad_metrics am where am.user_id = k.user_id and am.pack_id = k.pack_id and am.ad_id = k.ad_id and am.date = k.date
            and (coalesce(p_campaign_name_contains, '') = ''
                 or coalesce(am.campaign_name, '') ilike '%' || p_campaign_name_contains || '%')
            and (coalesce(p_adset_name_contains, '') = ''
                 or coalesce(am.adset_name, '') ilike '%' || p_adset_name_contains || '%')
        )
      )
    group by pr.key_id
    ) c
    join public.conversion_keys ck on ck.id = c.key_id
  ),
  available_types as (
    select coalesce(jsonb_agg(c.conv_key order by c.conv_key), '[]'::jsonb) as conv_types
    from conv_all c
  ),
  per_action_all as (
    select coalesce(
      jsonb_object_agg(
        c.conv_key,
        jsonb_build_object(
          'results', c.total_results,
          'cpr', case when c.total_results > 0 then t.total_spend / c.total_results else 0 end,
          'page_conv', case when t.total_lpv > 0 then c.total_results / t.total_lpv else 0 end
        )
        order by c.conv_key
      ),
      '{}'::jsonb
    ) as per_action_type
    from conv_all c
    cross join totals t
  ),
  per_action_selected as (
    select
      case
        when v_selected_key <> '' then jsonb_build_object(
          v_selected_key,
          jsonb_build_object(
            'results', t.total_results,
            'cpr', case when t.total_results > 0 then t.total_spend / t.total_results else 0 end,
            'page_conv', case when t.total_lpv > 0 then t.total_results / t.total_lpv else 0 end
          )
        )
        else '{}'::jsonb
      end as per_action_type
    from totals t
  ),
  averages_payload as (
    select jsonb_build_object(
      'hook', case when t.total_plays > 0 then t.total_hook_wsum / t.total_plays else 0 end,
      'hold_rate', case when t.total_plays > 0 then t.total_hold_rate_wsum / t.total_plays else 0 end,
      'video_watched_p50', case when t.total_plays > 0 then t.total_video_watched_p50_wsum / t.total_plays else 0 end,
      'video_watched_p75', case when t.total_plays > 0 then t.total_video_watched_p75_wsum / t.total_plays else 0 end,
      'scroll_stop', case when t.total_plays > 0 then t.total_scroll_stop_wsum / t.total_plays else 0 end,
      'ctr', case when t.total_impressions > 0 then t.total_clicks::numeric / t.total_impressions else 0 end,
      'website_ctr', case when t.total_impressions > 0 then t.total_inline::numeric / t.total_impressions else 0 end,
      'connect_rate', case when t.total_inline > 0 then t.total_lpv::numeric / t.total_inline else 0 end,
      'cpm', case when t.total_impressions > 0 then (t.total_spend * 1000.0) / t.total_impressions else 0 end,
      'cpc', case when t.total_clicks > 0 then t.total_spend / t.total_clicks else 0 end,
      'cplc', case when t.total_inline > 0 then t.total_spend / t.total_inline else 0 end,
      'per_action_type', case when v_include_conv_types then paa.per_action_type else pas.per_action_type end
    ) as averages
    from totals t
    cross join per_action_all paa
    cross join per_action_selected pas
  ),
  header_payload as (
    select jsonb_build_object(
      'sums', jsonb_build_object(
        'spend', t.total_spend,
        'results', t.total_results,
        'mqls', to_jsonb(null::numeric)
      ),
      'weighted_averages', jsonb_build_object(
        'hook', case when t.total_plays > 0 then t.total_hook_wsum / t.total_plays else 0 end,
        'scroll_stop', case when t.total_plays > 0 then t.total_scroll_stop_wsum / t.total_plays else 0 end,
        'ctr', case when t.total_impressions > 0 then t.total_clicks::numeric / t.total_impressions else 0 end,
        'website_ctr', case when t.total_impressions > 0 then t.total_inline::numeric / t.total_impressions else 0 end,
        'connect_rate', case when t.total_inline > 0 then t.total_lpv::numeric / t.total_inline else 0 end,
        'cpm', case when t.total_impressions > 0 then (t.total_spend * 1000.0) / t.total_impressions else 0 end,
        'page_conv', case when t.total_lpv > 0 then t.total_results / t.total_lpv else 0 end
      )
    ) as header_aggregates
    from totals t
  ),
  ordered as (
    select rm.*
    from rows_metrics rm
    order by
      case when v_order_by = 'cpr' then rm.cpr end asc nulls last,
      case when v_order_by = 'hook' then rm.hook end desc nulls last,
      case when v_order_by = 'hold_rate' then rm.hold_rate end desc nulls last,
      case when v_order_by = 'spend' then rm.spend end desc nulls last,
      case when v_order_by = 'ctr' then rm.ctr end desc nulls last,
      case when v_order_by = 'connect_rate' then rm.connect_rate end desc nulls last,
      case when v_order_by = 'page_conv' then rm.page_conv end desc nulls last,
      case when v_order_by = 'cpm' then rm.cpm end desc nulls last,
      case when v_order_by = 'website_ctr' then rm.website_ctr end desc nulls last,
      case when v_order_by = 'results' then rm.results end desc nulls last,
      case
        when v_order_by not in ('cpr', 'hook', 'hold_rate', 'spend', 'ctr', 'connect_rate', 'page_conv', 'cpm', 'website_ctr', 'results')
        then rm.spend
      end desc nulls last,
      rm.group_key
  ),
  paged_raw as (
    select * from ordered offset v_offset limit v_limit
  ),
  paged as (
    select
      row_number() over () as ord,
      jsonb_build_object(
        'group_key', pr.group_key,
        'unique_id', null,
        'account_id', pr.account_id,
        'account_ids', pr.account_ids,
        'campaign_ids', pr.campaign_ids,
        'adset_ids', pr.adset_ids,
        'pack_ids', pr.pack_ids,
        'tags', pr.tags,
        'meta_created_time', pr.meta_created_min,
        'campaign_id', pr.campaign_id,
        'campaign_name', pr.campaign_name,
        'adset_id', pr.adset_id,
        'adset_name', pr.adset_name,
        'ad_id', pr.rep_ad_id,
        'ad_name', pr.label_name,
        'effective_status', pr.effective_status,
        'active_count', pr.active_count,
        'paused_self_count', pr.paused_self_count,
        'adset_paused_count', pr.adset_paused_count,
        'campaign_paused_count', pr.campaign_paused_count,
        'impressions', pr.impressions,
        'clicks', pr.clicks,
        'inline_link_clicks', pr.inline_link_clicks,
        'spend', pr.spend,
        'lpv', pr.lpv,
        'plays', pr.plays,
        'video_total_thruplays', pr.thruplays,
        'hook', pr.hook,
        'hold_rate', pr.hold_rate,
        'video_watched_p50', pr.video_watched_p50,
        'video_watched_p75', pr.video_watched_p75,
        'scroll_stop', pr.scroll_stop,
        'ctr', pr.ctr,
        'connect_rate', pr.connect_rate,
        'cpm', pr.cpm,
        'website_ctr', pr.website_ctr,
        'reach', pr.reach,
        'frequency', pr.frequency,
        'leadscore_histogram', pr.leadscore_histogram,
        'custom_histograms', pr.custom_histograms,
        'conversions', pr.conversions,
        'ad_count', pr.ad_count,
        'thumbnail', case
          when v_group_by in ('ad_name', 'ad_id') and pr.thumb_storage_path is not null then null
          else pr.thumbnail
        end,
        'thumb_storage_path', pr.thumb_storage_path,
        'adcreatives_videos_thumbs', pr.adcreatives_videos_thumbs,
        'media_type', pr.media_type,
        'has_transcription', pr.has_transcription,
        'transcription_no_audio', pr.transcription_no_audio
      ) as item
    from paged_raw pr
  ),
  -- Dicionario id -> nome, so das campanhas/conjuntos citados nas linhas DESTA
  -- pagina. O nome NAO viaja por linha: com ~23 campanhas por criativo o mesmo
  -- nome apareceria milhares de vezes, e nome de campanha e longo.
  paged_parent_ids as (
    select
      coalesce((select array_agg(distinct c) from paged_raw p, unnest(p.campaign_ids) c where c is not null), array[]::text[]) as campaign_ids,
      coalesce((select array_agg(distinct a) from paged_raw p, unnest(p.adset_ids) a where a is not null), array[]::text[]) as adset_ids
  ),
  -- `max(nome)`: um mesmo id pode carregar nomes diferentes entre os anuncios
  -- (a campanha foi renomeada entre dois sincronismos). Escolher e deterministico,
  -- e o rotulo continua identificando a mesma campanha.
  names_payload as (
    select jsonb_build_object(
      'campaigns', coalesce((
        select jsonb_object_agg(x.id, x.name)
        from (
          select a.campaign_id as id, max(a.campaign_name) as name
          from public.ads a, paged_parent_ids pp
          where a.user_id = any(v_owners)
            and a.campaign_id = any(pp.campaign_ids)
            and nullif(a.campaign_name, '') is not null
          group by a.campaign_id
        ) x
      ), '{}'::jsonb),
      'adsets', coalesce((
        select jsonb_object_agg(x.id, x.name)
        from (
          select a.adset_id as id, max(a.adset_name) as name
          from public.ads a, paged_parent_ids pp
          where a.user_id = any(v_owners)
            and a.adset_id = any(pp.adset_ids)
            and nullif(a.adset_name, '') is not null
          group by a.adset_id
        ) x
      ), '{}'::jsonb)
    ) as names
  ),
  total_count as (
    select count(*)::integer as total from rows_metrics
  ),
  pagination_payload as (
    select jsonb_build_object(
      'limit', v_limit,
      'offset', v_offset,
      'total', tc.total,
      'has_more', (v_offset + v_limit) < tc.total
    ) as pagination
    from total_count tc
  ),
  overlap_stat as (
    select count(*)::bigint as conflict_rows from keys k where k.x_cross_silo
  )
  select jsonb_build_object(
    'data', coalesce((select jsonb_agg(p.item order by p.ord) from paged p), '[]'::jsonb),
    'names', coalesce((select names from names_payload), '{}'::jsonb),
    'available_conversion_types',
      case when v_include_conv_types then coalesce((select conv_types from available_types), '[]'::jsonb) else '[]'::jsonb end,
    'averages', coalesce((select averages from averages_payload), '{}'::jsonb),
    'header_aggregates', coalesce((select header_aggregates from header_payload), '{}'::jsonb),
    'pagination', coalesce((select pagination from pagination_payload), jsonb_build_object('limit', v_limit, 'offset', v_offset, 'total', 0, 'has_more', false))
  )
  || case
       when coalesce((select conflict_rows from overlap_stat), 0) > 0
       then jsonb_build_object('overlap', jsonb_build_object('rows', (select conflict_rows from overlap_stat)))
       else '{}'::jsonb
     end
  into v_result;

  v_result := coalesce(v_result, jsonb_build_object(
    'data', '[]'::jsonb,
    'names', '{}'::jsonb,
    'available_conversion_types', '[]'::jsonb,
    'averages', '{}'::jsonb,
    'header_aggregates', '{}'::jsonb,
    'pagination', jsonb_build_object('limit', v_limit, 'offset', v_offset, 'total', 0, 'has_more', false)
  ));

  -- Fold do wrapper v067: filtro por campaign_id PÓS-agregação/paginação (averages e
  -- available_conversion_types permanecem do payload completo), pagination resetada.
  if nullif(trim(coalesce(p_campaign_id, '')), '') is not null then
    with data_rows as (
      select t.ord, t.item
      from jsonb_array_elements(
        case when jsonb_typeof(v_result->'data') = 'array' then v_result->'data' else '[]'::jsonb end
      ) with ordinality as t(item, ord)
      where coalesce(t.item->>'campaign_id', '') = trim(p_campaign_id)
    ),
    filtered_data as (
      select coalesce(jsonb_agg(dr.item order by dr.ord), '[]'::jsonb) as data, count(*)::integer as total
      from data_rows dr
    )
    select v_result || jsonb_build_object(
      'data', fd.data,
      'pagination', jsonb_build_object('limit', v_limit, 'offset', 0, 'total', fd.total, 'has_more', false)
    )
    into v_result
    from filtered_data fd;

    -- O dicionario foi montado para a pagina ANTES deste corte. Sem podar, uma
    -- consulta que sobra com 3 linhas carregaria os nomes de TODOS os pais da pagina
    -- inteira - o diferencial mediu a sobra: 2.011 conjuntos, ~186 kB de dicionario
    -- que nenhuma linha consulta. Roda so dentro do fold, e o custo e nomes x linhas
    -- restantes, que aqui sao poucas por definicao.
    select v_result || jsonb_build_object('names', jsonb_build_object(
      'campaigns', coalesce((
        select jsonb_object_agg(e.key, e.value)
        from jsonb_each_text(coalesce(v_result->'names'->'campaigns', '{}'::jsonb)) e
        where exists (
          select 1 from jsonb_array_elements(v_result->'data') r where r->'campaign_ids' ? e.key
        )
      ), '{}'::jsonb),
      'adsets', coalesce((
        select jsonb_object_agg(e.key, e.value)
        from jsonb_each_text(coalesce(v_result->'names'->'adsets', '{}'::jsonb)) e
        where exists (
          select 1 from jsonb_array_elements(v_result->'data') r where r->'adset_ids' ? e.key
        )
      ), '{}'::jsonb)
    )) into v_result;
  end if;

  return v_result;
end;
$$;


ALTER FUNCTION public.fetch_manager_performance_base_v145(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text, p_include_custom boolean) OWNER TO postgres;

--
-- Name: FUNCTION fetch_manager_performance_base_v145(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text, p_include_custom boolean); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.fetch_manager_performance_base_v145(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text, p_include_custom boolean) IS 'Manager (145): base da v142 sobre ad_metrics/ad_performance_daily com pack na chave. keys sem GROUP BY no ramo por pack (o bloqueio de selecao garante 1 pack por anuncio-dia); o ramo sem selecao mantem o dedup. JSON identico a v142 no diferencial.';


--
-- Name: fetch_manager_performance_base_v155(uuid, date, date, text, uuid[], text[], text, text, text, text, boolean, boolean, integer, integer, text, text, boolean); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.fetch_manager_performance_base_v155(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text DEFAULT 'ad_name'::text, p_pack_ids uuid[] DEFAULT NULL::uuid[], p_account_ids text[] DEFAULT NULL::text[], p_campaign_name_contains text DEFAULT NULL::text, p_adset_name_contains text DEFAULT NULL::text, p_ad_name_contains text DEFAULT NULL::text, p_action_type text DEFAULT NULL::text, p_include_leadscore boolean DEFAULT true, p_include_available_conversion_types boolean DEFAULT true, p_limit integer DEFAULT 500, p_offset integer DEFAULT 0, p_order_by text DEFAULT 'spend'::text, p_campaign_id text DEFAULT NULL::text, p_include_custom boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    SET plan_cache_mode TO 'force_custom_plan'
    SET work_mem TO '32MB'
    AS $$
declare
  v_group_by text := lower(coalesce(p_group_by, 'ad_name'));
  v_order_by text := lower(coalesce(p_order_by, 'spend'));
  v_date_start date := least(p_date_start, p_date_stop);
  v_date_stop date := greatest(p_date_start, p_date_stop);
  v_limit integer := greatest(1, least(coalesce(p_limit, 500), 10000));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
  v_selected_key text := trim(coalesce(p_action_type, ''));
  v_key_id integer := null;
  v_include_conv_types boolean := coalesce(p_include_available_conversion_types, true);
  v_include_leads boolean := coalesce(p_include_leadscore, true);
  -- 140: histogramas das colunas vinculadas so quando pedidos (opt-in).
  v_include_custom boolean := coalesce(p_include_custom, false);
  v_result jsonb;
  v_owners uuid[];
  v_requested integer;
  -- universo de packs para a máscara: a seleção pedida, ou (ramo legado) todos os
  -- packs do ator. Posição i do array ↔ bit i-1 da máscara.
  v_pack_universe uuid[];
  v_n_packs integer;
begin
  if auth.uid() is distinct from p_user_id then
    raise exception 'Forbidden: p_user_id must match auth.uid()'
      using errcode = '42501';
  end if;

  if p_pack_ids is null then
    v_owners := array[p_user_id];
    select coalesce(array_agg(id order by id), array[]::uuid[])
      into v_pack_universe
    from public.packs where user_id = p_user_id;
  else
    select array_agg(distinct a.owner_id), count(distinct a.pack_id)
      into v_owners, v_requested
    from public.resolve_pack_access(p_pack_ids, p_user_id) a;
    if coalesce(v_requested, 0) < (select count(distinct x) from unnest(p_pack_ids) x) then
      raise exception 'Forbidden: pack inacessivel na selecao'
        using errcode = '42501';
    end if;
    if v_owners is null or array_length(v_owners, 1) is null then
      v_owners := array[p_user_id];
    end if;
    select array_agg(distinct x order by x) into v_pack_universe from unnest(p_pack_ids) x;
  end if;
  v_n_packs := greatest(1, coalesce(cardinality(v_pack_universe), 0));

  if v_group_by not in ('ad_id', 'ad_name', 'adset_id', 'campaign_id') then
    raise exception 'Invalid p_group_by: %, expected ad_id|ad_name|adset_id|campaign_id', v_group_by
      using errcode = '22023';
  end if;

  -- Normalização da chave pedida, idêntica à v116 (sem prefixo = 'conversion:').
  if v_selected_key <> '' and v_selected_key not like 'conversion:%' and v_selected_key not like 'action:%' then
    v_selected_key := 'conversion:' || v_selected_key;
  end if;
  if v_selected_key <> '' then
    -- Chave nunca vista no dicionário = nenhum anúncio tem esse evento → resultados 0,
    -- exatamente como a v116 (nenhum elemento casava).
    select id into v_key_id from public.conversion_keys where key = v_selected_key;
  end if;

  with
  -- 1. A seleção, resolvida no MAPA (índice composto user/pack/date/ad; ~40 B por linha).
  --    GROUP BY (ad_id, dia) faz de uma vez: (a) dedup cross-silo com a MESMA preferência
  --    da v116 — vence o dono do pack compartilhado, o ator perde, desempate por uuid;
  --    (b) dedup de sobreposição entre packs do mesmo dono; (c) sinal de conflito
  --    cross-silo (min <> max do dono); (d) máscara dos packs de origem (bit por pack).
  keys as (
    select
      apm.ad_id,
      apm.date as date,
      apm.user_id,
      false as x_cross_silo,
      set_bit(repeat('0', v_n_packs)::varbit, array_position(v_pack_universe, apm.pack_id) - 1, 1) as pack_mask,
      apm.pack_id
    from unnest(v_owners) as o(owner_id)
    join public.ad_performance_daily apm
      on apm.user_id = o.owner_id
     and apm.pack_id = any(p_pack_ids)
     and apm.date >= v_date_start
     and apm.date <= v_date_stop
    where p_pack_ids is not null

    union all

    -- Ramo legado (sem packs): o silo do ator no período; packs de origem por lookup.
    select
      am.ad_id,
      am.date,
      p_user_id as user_id,
      false as x_cross_silo,
      coalesce(bit_or(set_bit(repeat('0', v_n_packs)::varbit, array_position(v_pack_universe, am.pack_id) - 1, 1)), repeat('0', v_n_packs)::varbit) as pack_mask,
      -- Postgres nao tem min(uuid): "um pack qualquer, deterministico" via array_agg ordenado.
      (array_agg(am.pack_id order by am.pack_id))[1] as pack_id
    from public.ad_performance_daily am
    where p_pack_ids is null
      and am.user_id = p_user_id
      and am.date >= v_date_start
      and am.date <= v_date_stop
    group by am.ad_id, am.date
  ),
  -- 1b. (v155) Inventário: anúncio ativo no período (o intervalo first/last_active_date
  --     cruza a janela) SEM linha de métrica neste (silo, pack) no período. Substitui as
  --     linhas-zero que o refresh gravava em ad_metrics. Uma linha por (silo, pack,
  --     anúncio), zerada: somar zero não muda soma, a contagem é count(distinct ad_id) e
  --     o representante é o de maior impressão (a linha zerada perde para qualquer real,
  --     ver rep_enc). O anti-join vai ao read model pela PK, não a `keys`: no ramo
  --     legado `keys` guarda um pack só por anúncio-dia.
  inv as (
    select i.user_id, i.pack_id, i.ad_id, i.account_id, i.campaign_id, i.campaign_name,
           i.adset_id, i.adset_name, i.ad_name
    from unnest(v_owners) as o(owner_id)
    join public.ad_pack_inventory i
      on i.user_id = o.owner_id
     and i.pack_id = any(v_pack_universe)
     and i.first_active_date <= v_date_stop
     and i.last_active_date >= v_date_start
    where not exists (
      select 1 from public.ad_performance_daily d
      where d.user_id = i.user_id and d.pack_id = i.pack_id and d.ad_id = i.ad_id
        and d.date >= v_date_start and d.date <= v_date_stop
    )
  ),
  -- 2. As linhas: SÓ o read model (ad_performance_daily, migration 129), pela chave
  --    única. ad_metrics não entra aqui — entra só para a linha representante (fim) e
  --    para filtros por nome de campanha/conjunto (EXISTS abaixo, podado quando o
  --    filtro está vazio: o predicado é constante sob force_custom_plan).
  sel as (
    select
      k.user_id,
      k.ad_id,
      k.date,
      k.pack_mask,
      k.pack_id,
      case
        when v_group_by = 'ad_id' then d.ad_id
        when v_group_by = 'ad_name' then coalesce(nullif(d.ad_name, ''), d.ad_id)
        when v_group_by = 'adset_id' then d.adset_id
        when v_group_by = 'campaign_id' then d.campaign_id
        else d.ad_id
      end as group_key,
      -- Só o que a agregação consome. Nomes de campanha/conjunto NÃO viajam por
      -- linha: saem da linha REPRESENTANTE no fim (77 lookups em ad_metrics).
      d.account_id,
      d.adset_id,
      d.campaign_id,
      d.impressions,
      d.clicks,
      d.inline_link_clicks,
      d.spend,
      d.lpv,
      d.plays,
      d.thruplays,
      d.video_watched_p50,
      d.video_watched_p75,
      d.hold_rate,
      d.reach,
      d.frequency,
      d.hook_value,
      d.scroll_stop_value,
      -- conversão pedida por posição no array (leads: CTE próprio, leads_by_group)
      coalesce(d.conv_values[array_position(d.conv_key_ids, v_key_id)], 0)::numeric as results
    from keys k
    join public.ad_performance_daily d on d.user_id = k.user_id and d.pack_id = k.pack_id and d.ad_id = k.ad_id and d.date = k.date
    where (p_account_ids is null or d.account_id = any(p_account_ids))
      and (p_ad_name_contains is null or p_ad_name_contains = ''
           or coalesce(d.ad_name, '') ilike '%' || p_ad_name_contains || '%')
      and (
        (coalesce(p_campaign_name_contains, '') = '' and coalesce(p_adset_name_contains, '') = '')
        or exists (
          select 1 from public.ad_metrics am where am.user_id = k.user_id and am.pack_id = k.pack_id and am.ad_id = k.ad_id and am.date = k.date
            and (coalesce(p_campaign_name_contains, '') = ''
                 or coalesce(am.campaign_name, '') ilike '%' || p_campaign_name_contains || '%')
            and (coalesce(p_adset_name_contains, '') = ''
                 or coalesce(am.adset_name, '') ilike '%' || p_adset_name_contains || '%')
        )
      )

    union all

    -- (v155) O inventário, zerado. Identidade e nomes vêm da própria linha (os mais
    -- recentes que o refresh viu); os filtros usam esses mesmos campos. `date` nulo:
    -- a linha não é um dia, e o rep_enc a põe abaixo de qualquer dia real.
    select
      i.user_id,
      i.ad_id,
      null::date as date,
      set_bit(repeat('0', v_n_packs)::varbit, array_position(v_pack_universe, i.pack_id) - 1, 1) as pack_mask,
      i.pack_id,
      case
        when v_group_by = 'ad_id' then i.ad_id
        when v_group_by = 'ad_name' then coalesce(nullif(i.ad_name, ''), i.ad_id)
        when v_group_by = 'adset_id' then i.adset_id
        when v_group_by = 'campaign_id' then i.campaign_id
        else i.ad_id
      end as group_key,
      i.account_id,
      i.adset_id,
      i.campaign_id,
      0::bigint as impressions,
      0::bigint as clicks,
      0::bigint as inline_link_clicks,
      0::numeric as spend,
      0::bigint as lpv,
      0::bigint as plays,
      0::bigint as thruplays,
      0::numeric as video_watched_p50,
      0::numeric as video_watched_p75,
      0::numeric as hold_rate,
      0::bigint as reach,
      0::numeric as frequency,
      0::numeric as hook_value,
      0::numeric as scroll_stop_value,
      0::numeric as results
    from inv i
    where (p_account_ids is null or i.account_id = any(p_account_ids))
      and (p_ad_name_contains is null or p_ad_name_contains = ''
           or coalesce(i.ad_name, '') ilike '%' || p_ad_name_contains || '%')
      and (coalesce(p_campaign_name_contains, '') = ''
           or coalesce(i.campaign_name, '') ilike '%' || p_campaign_name_contains || '%')
      and (coalesce(p_adset_name_contains, '') = ''
           or coalesce(i.adset_name, '') ilike '%' || p_adset_name_contains || '%')
  ),
  -- `coalesce(x,'') <> ''` e não `nullif(x,'') is not null`: mesma semântica, mas o
  -- planner dá seletividade ~1 ao `<>` e 0,005 ao `is not null` sobre expressão —
  -- com 0,005 ele estimava 1 linha aqui e escolhia agregação por ordenação (spill).
  filtered as (
    select * from sel where coalesce(group_key, '') <> ''
  ),
  -- 3. Anúncio-dia → anúncio (por silo). Só agregados de estado constante.
  per_ad as (
    select
      f.group_key,
      f.user_id,
      f.ad_id,
      sum(f.impressions)::bigint as impressions,
      sum(f.clicks)::bigint as clicks,
      sum(f.inline_link_clicks)::bigint as inline_link_clicks,
      sum(f.spend)::numeric as spend,
      sum(f.lpv)::bigint as lpv,
      sum(f.plays)::bigint as plays,
      sum(f.thruplays)::bigint as thruplays,
      sum(f.hook_value * f.plays)::numeric as hook_wsum,
      sum(f.hold_rate * f.plays)::numeric as hold_rate_wsum,
      sum(f.video_watched_p50 * f.plays)::numeric as video_watched_p50_wsum,
      sum(f.video_watched_p75 * f.plays)::numeric as video_watched_p75_wsum,
      sum(f.scroll_stop_value * f.plays)::numeric as scroll_stop_wsum,
      sum(f.reach)::bigint as reach,
      sum(f.frequency * f.impressions)::numeric as frequency_wsum,
      sum(f.results)::numeric as results,
      -- um anúncio pertence a UMA conta e a UM conjunto: min() é exato
      min(nullif(f.account_id, '')) as account_id,
      min(nullif(f.adset_id, '')) as adset_id,
      min(nullif(f.campaign_id, '')) as campaign_id,
      bit_or(f.pack_mask) as pack_mask,
      -- dia representante deste anúncio: max impressões (desempate: dia mais recente)
      max((lpad(f.impressions::text, 12, '0') || e'\x1f' || coalesce(f.date::text, '') || e'\x1f' || f.pack_id::text) collate "C") as rep_enc
    from filtered f
    group by f.group_key, f.user_id, f.ad_id
  ),
  -- 4. Um lookup em `ads` por anúncio (índice de cobertura ads_user_ad_status_idx).
  per_ad_status as (
    select
      pa.*,
      a.effective_status,
      a.meta_created_time,
      a.thumb_storage_path
    from per_ad pa
    left join public.ads a
      on a.user_id = pa.user_id
     and a.ad_id = pa.ad_id
  ),
  -- 5. Anúncio → grupo.
  grp as (
    select
      p.group_key,
      sum(p.impressions)::bigint as impressions,
      sum(p.clicks)::bigint as clicks,
      sum(p.inline_link_clicks)::bigint as inline_link_clicks,
      sum(p.spend)::numeric as spend,
      sum(p.lpv)::bigint as lpv,
      sum(p.plays)::bigint as plays,
      sum(p.thruplays)::bigint as thruplays,
      sum(p.hook_wsum)::numeric as hook_wsum,
      sum(p.hold_rate_wsum)::numeric as hold_rate_wsum,
      sum(p.video_watched_p50_wsum)::numeric as video_watched_p50_wsum,
      sum(p.video_watched_p75_wsum)::numeric as video_watched_p75_wsum,
      sum(p.scroll_stop_wsum)::numeric as scroll_stop_wsum,
      sum(p.reach)::bigint as reach,
      sum(p.frequency_wsum)::numeric as frequency_wsum,
      sum(p.results)::numeric as results,
      count(distinct p.ad_id)::integer as ad_id_count,
      count(distinct p.adset_id)::integer as adset_count,
      coalesce(array_agg(distinct p.account_id) filter (where p.account_id is not null), array[]::text[]) as account_ids,
      -- v136/137: TODAS as campanhas e conjuntos do grupo, nao a do representante.
      -- Mesma passada do account_ids: mesmo group by, nenhuma leitura nova.
      coalesce(array_agg(distinct p.campaign_id) filter (where p.campaign_id is not null), array[]::text[]) as campaign_ids,
      coalesce(array_agg(distinct p.adset_id) filter (where p.adset_id is not null), array[]::text[]) as adset_ids,
      bit_or(p.pack_mask) as pack_mask,
      -- representante do grupo = (impressões do dia rep, ad_id) máximos — a ordem
      -- (impressions desc, ad_id desc) da v116; user_id e os campos vão de carona.
      max((substr(p.rep_enc, 1, 12) || e'\x1f' || p.ad_id || e'\x1f' || p.user_id::text
           || e'\x1f' || p.rep_enc) collate "C") as rep_enc,
      bool_or(upper(coalesce(p.effective_status, '')) = 'ACTIVE') as has_active,
      count(distinct p.ad_id) filter (where upper(coalesce(p.effective_status, '')) = 'ACTIVE')::integer as active_count,
      -- v138: por que o grupo esta parado. `fallback_status` (o min alfabetico logo
      -- abaixo) responde "algum anuncio esta assim, e foi o primeiro do alfabeto" -
      -- por isso um criativo com um anuncio arquivado aparece como ARCHIVED. Contar
      -- permite a pergunta certa: TODOS estao pausados pelo mesmo motivo?
      -- Mesma passada e mesmo group by do active_count: nenhuma leitura nova.
      count(distinct p.ad_id) filter (where upper(coalesce(p.effective_status, '')) = 'PAUSED')::integer as paused_self_count,
      count(distinct p.ad_id) filter (where upper(coalesce(p.effective_status, '')) = 'ADSET_PAUSED')::integer as adset_paused_count,
      count(distinct p.ad_id) filter (where upper(coalesce(p.effective_status, '')) = 'CAMPAIGN_PAUSED')::integer as campaign_paused_count,
      min(p.effective_status) filter (where nullif(p.effective_status, '') is not null) as fallback_status,
      min(p.meta_created_time) as meta_created_min,
      -- fallback de miniatura: qualquer anúncio do grupo com arquivo no Storage
      -- (medido: 13 de 3.451 criativos têm o representante sem e uma cópia com)
      max(p.thumb_storage_path) filter (where nullif(p.thumb_storage_path, '') is not null) as any_thumb_storage_path
    from per_ad_status p
    group by p.group_key
  ),
  -- Leads: CTE próprio e ESTREITO. Só 23% dos anúncio-dias têm leads; parte do
  -- rollup (sem JSON), busca em ad_metrics só o necessário para o group_key e os
  -- filtros, e soma o histograma por (grupo, score). Fora da passada principal
  -- para não carregar JSON por duas camadas de agregação. MATERIALIZED: referenciado
  -- uma vez, o planner o inlinaria como lado interno de um nested loop e o
  -- recalcularia por grupo (medido: 397 execuções, 4,4 s).
  leads_by_group as materialized (
    select
      x.group_key,
      jsonb_object_agg(trim_scale(x.score)::text, x.qty order by x.score) as leadscore_histogram
    from (
      select
        case
          when v_group_by = 'ad_id' then d.ad_id
          when v_group_by = 'ad_name' then coalesce(nullif(d.ad_name, ''), d.ad_id)
          when v_group_by = 'adset_id' then d.adset_id
          when v_group_by = 'campaign_id' then d.campaign_id
          else d.ad_id
        end as group_key,
        s.score,
        sum(s.qty)::integer as qty
      from keys k
      join public.ad_performance_daily d on d.user_id = k.user_id and d.pack_id = k.pack_id and d.ad_id = k.ad_id and d.date = k.date
      cross join lateral unnest(d.lead_scores, d.lead_qtys) as s(score, qty)
      where v_include_leads
        and cardinality(d.lead_scores) > 0
        and (p_account_ids is null or d.account_id = any(p_account_ids))
        and (p_ad_name_contains is null or p_ad_name_contains = ''
             or coalesce(d.ad_name, '') ilike '%' || p_ad_name_contains || '%')
        and (
          (coalesce(p_campaign_name_contains, '') = '' and coalesce(p_adset_name_contains, '') = '')
          or exists (
            select 1 from public.ad_metrics am where am.user_id = k.user_id and am.pack_id = k.pack_id and am.ad_id = k.ad_id and am.date = k.date
              and (coalesce(p_campaign_name_contains, '') = ''
                   or coalesce(am.campaign_name, '') ilike '%' || p_campaign_name_contains || '%')
              and (coalesce(p_adset_name_contains, '') = ''
                   or coalesce(am.adset_name, '') ilike '%' || p_adset_name_contains || '%')
          )
        )
      group by 1, s.score
    ) x
    where coalesce(x.group_key, '') <> ''
    group by x.group_key
  ),
  -- 140: histogramas das colunas vinculadas, somados por (grupo, vinculo, valor).
  -- Mesma forma do leads_by_group: CTE estreito, MATERIALIZED, mesmos filtros, e
  -- opt-in por p_include_custom. Quem nao vincula coluna nenhuma tem a coluna nula
  -- e o frontend nem pede: custo zero fora do caso de uso.
  custom_by_group as materialized (
    select
      y.group_key,
      jsonb_object_agg(y.mapping_id, y.hist) as custom_histograms
    from (
      select x.group_key, x.mapping_id, jsonb_object_agg(x.val, x.qty) as hist
      from (
        select
          case
            when v_group_by = 'ad_id' then d.ad_id
            when v_group_by = 'ad_name' then coalesce(nullif(d.ad_name, ''), d.ad_id)
            when v_group_by = 'adset_id' then d.adset_id
            when v_group_by = 'campaign_id' then d.campaign_id
            else d.ad_id
          end as group_key,
          m.key as mapping_id,
          v.key as val,
          sum(v.value::bigint)::bigint as qty
        from keys k
        join public.ad_performance_daily d on d.user_id = k.user_id and d.pack_id = k.pack_id and d.ad_id = k.ad_id and d.date = k.date
        cross join lateral jsonb_each(d.custom_hist) as m(key, value)
        cross join lateral jsonb_each_text(m.value) as v(key, value)
        where v_include_custom
          and d.custom_hist is not null
          and (p_account_ids is null or d.account_id = any(p_account_ids))
          and (p_ad_name_contains is null or p_ad_name_contains = ''
               or coalesce(d.ad_name, '') ilike '%' || p_ad_name_contains || '%')
          and (
            (coalesce(p_campaign_name_contains, '') = '' and coalesce(p_adset_name_contains, '') = '')
            or exists (
              select 1 from public.ad_metrics am where am.user_id = k.user_id and am.pack_id = k.pack_id and am.ad_id = k.ad_id and am.date = k.date
                and (coalesce(p_campaign_name_contains, '') = ''
                     or coalesce(am.campaign_name, '') ilike '%' || p_campaign_name_contains || '%')
                and (coalesce(p_adset_name_contains, '') = ''
                     or coalesce(am.adset_name, '') ilike '%' || p_adset_name_contains || '%')
            )
          )
        group by 1, m.key, v.key
      ) x
      where coalesce(x.group_key, '') <> ''
      group by x.group_key, x.mapping_id
    ) y
    group by y.group_key
  ),
  -- 6. Enriquecimento por grupo (~77 linhas): representante em `ads`, tags do ATOR,
  --    packs da máscara, histograma de leads.
  -- Decodifica o representante (posições da chave: 1 impressões | 2 ad_id | 3 user_id
  -- | 4 impressões do dia | 5 date) e busca a LINHA representante em ad_metrics para
  -- os nomes — 77 lookups pela chave única, em vez de carregar nomes em 42 mil linhas.
  -- `collate "default"`: a chave é comparada em "C"; os pedaços voltam à colação das
  -- colunas, senão o `=` contra ads/ad_metrics não usa índice (medido: bitmap scan
  -- de 21 mil linhas por grupo).
  grp_dec as (
    select
      g.*,
      (split_part(g.rep_enc, e'\x1f', 2) collate "default") as rep_ad_id,
      (split_part(g.rep_enc, e'\x1f', 3))::uuid as rep_user_id,
      nullif(split_part(g.rep_enc, e'\x1f', 5), '')::date as rep_date,
      nullif(split_part(g.rep_enc, e'\x1f', 6), '')::uuid as rep_pack_id
    from grp g
  ),
  grp_rep as (
    select
      g.*,
      -- (v155) representante sem dia (só inventário): nomes da linha do inventário.
      case when g.rep_date is null then ri.ad_name else am.ad_name end as rep_ad_name,
      case when g.rep_date is null then ri.account_id else am.account_id end as rep_account_id,
      case when g.rep_date is null then ri.campaign_id else am.campaign_id end as rep_campaign_id,
      case when g.rep_date is null then ri.campaign_name else am.campaign_name end as rep_campaign_name,
      case when g.rep_date is null then ri.adset_id else am.adset_id end as rep_adset_id,
      case when g.rep_date is null then ri.adset_name else am.adset_name end as rep_adset_name
    from grp_dec g
    left join public.ad_metrics am on am.user_id = g.rep_user_id and am.pack_id = g.rep_pack_id and am.ad_id = g.rep_ad_id and am.date = g.rep_date
    left join lateral (
      -- O anúncio pode estar no inventário de mais de um pack da seleção: vale o que
      -- esteve ativo por último (a mesma regra da linha-zero mais recente de antes).
      select i.ad_name, i.account_id, i.campaign_id, i.campaign_name, i.adset_id, i.adset_name
      from public.ad_pack_inventory i
      where g.rep_date is null
        and i.user_id = g.rep_user_id
        and i.pack_id = any(coalesce(p_pack_ids, v_pack_universe))
        and i.ad_id = g.rep_ad_id
      order by i.last_active_date desc, i.pack_id
      limit 1
    ) ri on true
  ),
  rows_enriched as (
    select
      g.group_key,
      g.rep_account_id as account_id,
      g.account_ids,
      g.campaign_ids,
      g.adset_ids,
      coalesce((
        select array_agg(v_pack_universe[i] order by i)
        from generate_series(1, v_n_packs) i
        where get_bit(g.pack_mask, i - 1) = 1
      ), array[]::uuid[]) as pack_ids,
      g.rep_campaign_id as campaign_id,
      g.rep_campaign_name as campaign_name,
      g.rep_adset_id as adset_id,
      g.rep_adset_name as adset_name,
      g.rep_ad_id,
      g.rep_ad_name,
      case
        when v_group_by = 'campaign_id' then coalesce(nullif(g.rep_campaign_name, ''), g.group_key)
        when v_group_by = 'adset_id' then coalesce(nullif(g.rep_adset_name, ''), g.group_key)
        else coalesce(nullif(g.rep_ad_name, ''), g.rep_ad_id)
      end as label_name,
      case
        when v_group_by = 'campaign_id' then null
        when coalesce(g.has_active, false) then 'ACTIVE'
        else coalesce(g.fallback_status, ra.effective_status)
      end as effective_status,
      case
        when v_group_by = 'campaign_id' then null
        else coalesce(g.active_count, 0)
      end as active_count,
      -- Contadores de motivo SO nas abas que agregam anuncios. Em conjunto e
      -- campanha a linha E a propria entidade, e o status dela vem de
      -- `parent_entities` (o estado do Meta) - mandar contadores la faria a tela
      -- classificar um CONJUNTO pausado como "pausado pelo conjunto", que e a
      -- resposta certa para o anuncio e errada para o conjunto. A ausencia e o
      -- sinal: sem contadores, a tela le `effective_status` direto.
      case when v_group_by in ('ad_name', 'ad_id') then coalesce(g.paused_self_count, 0) end as paused_self_count,
      case when v_group_by in ('ad_name', 'ad_id') then coalesce(g.adset_paused_count, 0) end as adset_paused_count,
      case when v_group_by in ('ad_name', 'ad_id') then coalesce(g.campaign_paused_count, 0) end as campaign_paused_count,
      g.impressions, g.clicks, g.inline_link_clicks, g.spend, g.lpv, g.plays, g.thruplays,
      g.hook_wsum, g.hold_rate_wsum, g.video_watched_p50_wsum, g.video_watched_p75_wsum,
      g.scroll_stop_wsum, g.reach, g.frequency_wsum,
      case when v_group_by = 'campaign_id' then g.adset_count else g.ad_id_count end as ad_count,
      -- Chave do histograma normalizada (80.0 → "80"); a v116 mandava o array cru.
      coalesce(lg.leadscore_histogram, '{}'::jsonb) as leadscore_histogram,
      -- 140: {"<mapping_id>": {"<valor>": quantidade}}; {} quando nao pedido ou sem dado.
      coalesce(cg.custom_histograms, '{}'::jsonb) as custom_histograms,
      g.results,
      g.meta_created_min,
      coalesce(nullif(ra.thumbnail_url, ''), nullif(ra.adcreatives_videos_thumbs ->> 0, '')) as thumbnail,
      ra.adcreatives_videos_thumbs,
      coalesce(nullif(ra.thumb_storage_path, ''), g.any_thumb_storage_path) as thumb_storage_path,
      coalesce(tg.tags, '[]'::jsonb) as tags,
      -- v132: o que a rota hidratava com 15 requisições e 13,7 mil linhas por carga
      -- (medido) agora vem daqui. Só nos níveis de criativo/anúncio, como a hidratação
      -- fazia (num nível de conjunto/campanha o "ad_name" é o nome do pai).
      -- media_type = maior precedência entre as cópias do nome (vídeo > imagem; 'unknown'
      -- e NULL ignorados) — a semântica exata de _hydrate_media_type_for_rankings_rows.
      case
        when v_group_by in ('ad_name', 'ad_id') then mt.media_type
        else null
      end as media_type,
      case
        when v_group_by in ('ad_name', 'ad_id') then coalesce(tr.has_transcription, false)
        else false
      end as has_transcription,
      -- Transcrito GANHA de sem-audio: num pack compartilhado os dois silos podem ter
      -- registros diferentes para o mesmo ad_name, e o texto que existe de fato vale
      -- mais do que a falha registrada no silo vizinho.
      case
        when v_group_by in ('ad_name', 'ad_id')
          then coalesce(tr.no_audio, false) and not coalesce(tr.has_transcription, false)
        else false
      end as transcription_no_audio
    from grp_rep g
    left join lateral (
      select case max(case a.media_type when 'video' then 2 when 'image' then 1 end)
               when 2 then 'video' when 1 then 'image' end as media_type
      from public.ads a
      where v_group_by in ('ad_name', 'ad_id')
        and a.user_id = any(v_owners)
        and a.ad_name = coalesce(nullif(g.rep_ad_name, ''), g.rep_ad_id)
    ) mt on true
    left join lateral (
      -- 142: a lateral deixa de responder "existe transcricao?" e passa a responder
      -- "em que estado esta esta midia?". O `limit 1` e o filtro de status saem porque
      -- agora e preciso VER a linha de falha para distinguir "sem audio detectavel"
      -- (permanente: nunca vai ser transcrito) de "ainda nao transcrito" (acionavel).
      -- Nao ha custo novo: ad_transcriptions tem UNIQUE (user_id, ad_name), entao a
      -- lateral le no maximo uma linha por dono (v_owners tem 1, ou 2 em pack
      -- compartilhado) pelo mesmo index scan de antes.
      --
      -- `no_voice_detected` e escrito pelos DOIS caminhos de falha do worker
      -- (transcription_worker.py) desde que a normalizacao existe; as linhas antigas
      -- que so tinham a frase no `error_message` sao corrigidas pelo backfill no fim
      -- desta migration. Por isso o SQL le so a flag e nao repete aqui a lista de
      -- frases que vive em supabase_repo._NO_AUDIO_PHRASES: uma regra, um lugar.
      select
        bool_or(t.status = 'completed') as has_transcription,
        bool_or(t.status = 'failed' and coalesce(t.metadata ->> 'no_voice_detected', '') = 'true') as no_audio
      from public.ad_transcriptions t
      where v_group_by in ('ad_name', 'ad_id')
        and t.user_id = any(v_owners)
        and t.ad_name = coalesce(nullif(g.rep_ad_name, ''), g.rep_ad_id)
    ) tr on true
    left join leads_by_group lg
      on lg.group_key = g.group_key
    left join custom_by_group cg
      on cg.group_key = g.group_key
    left join public.ads ra
      on ra.user_id = g.rep_user_id
     and ra.ad_id = g.rep_ad_id
    left join lateral (
      -- v116: tags do ATOR (p_user_id), só nos níveis de criativo/anúncio.
      select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'color', t.color) order by t.name, t.id) as tags
      -- v139: tags do SILO DO PACK, nao do ator. Mesma forma das duas laterais
      -- vizinhas (media_type e has_transcription), que ja liam por any(v_owners).
      from public.ad_tags atg
      join public.tags t on t.id = atg.tag_id and t.user_id = atg.user_id
      where v_group_by in ('ad_name', 'ad_id')
        and atg.user_id = any(v_owners)
        and atg.ad_name = coalesce(nullif(g.rep_ad_name, ''), g.rep_ad_id)
    ) tg on true
  ),
  rows_metrics as (
    select
      re.*,
      case when re.plays > 0 then re.hook_wsum / re.plays else 0 end as hook,
      case when re.plays > 0 then re.hold_rate_wsum / re.plays else 0 end as hold_rate,
      round(case when re.plays > 0 then re.video_watched_p50_wsum / re.plays else 0 end)::int as video_watched_p50,
      round(case when re.plays > 0 then re.video_watched_p75_wsum / re.plays else 0 end)::int as video_watched_p75,
      case when re.plays > 0 then re.scroll_stop_wsum / re.plays else 0 end as scroll_stop,
      case when re.impressions > 0 then re.clicks::numeric / re.impressions else 0 end as ctr,
      case when re.inline_link_clicks > 0 then re.lpv::numeric / re.inline_link_clicks else 0 end as connect_rate,
      case when re.impressions > 0 then (re.spend * 1000.0) / re.impressions else 0 end as cpm,
      case when re.impressions > 0 then re.inline_link_clicks::numeric / re.impressions else 0 end as website_ctr,
      case when re.impressions > 0 then re.frequency_wsum / re.impressions else 0 end as frequency,
      case when re.results > 0 then re.spend / re.results else 0 end as cpr,
      case when re.lpv > 0 then re.results / re.lpv else 0 end as page_conv,
      case when v_selected_key <> '' then jsonb_build_object(v_selected_key, re.results) else '{}'::jsonb end as conversions
    from rows_enriched re
  ),
  totals as (
    select
      coalesce(sum(rm.spend), 0)::numeric as total_spend,
      coalesce(sum(rm.impressions), 0)::bigint as total_impressions,
      coalesce(sum(rm.clicks), 0)::bigint as total_clicks,
      coalesce(sum(rm.inline_link_clicks), 0)::bigint as total_inline,
      coalesce(sum(rm.lpv), 0)::bigint as total_lpv,
      coalesce(sum(rm.plays), 0)::bigint as total_plays,
      coalesce(sum(rm.hook_wsum), 0)::numeric as total_hook_wsum,
      coalesce(sum(rm.hold_rate_wsum), 0)::numeric as total_hold_rate_wsum,
      coalesce(sum(rm.video_watched_p50_wsum), 0)::numeric as total_video_watched_p50_wsum,
      coalesce(sum(rm.video_watched_p75_wsum), 0)::numeric as total_video_watched_p75_wsum,
      coalesce(sum(rm.scroll_stop_wsum), 0)::numeric as total_scroll_stop_wsum,
      coalesce(sum(rm.results), 0)::numeric as total_results
    from rows_metrics rm
  ),
  -- Tipos disponíveis + per_action_type de TODAS as chaves: só quando pedido (o
  -- predicado é constante sob force_custom_plan → o planner poda o ramo inteiro).
  -- Relê a seleção estreita (keys, já materializada) + filtros de nome em ad_metrics +
  -- os arrays do rollup; sem JSON.
  -- Soma por key_id ANTES de juntar com o dicionário: são ≤ 81 linhas depois do GROUP
  -- BY. Juntar antes custou 10,6 s no cenário de 30 packs (826 mil pares desempacotados
  -- materializados e varridos uma vez por chave do dicionário).
  conv_all as (
    select ck.key as conv_key, c.total_results
    from (
    select pr.key_id, sum(pr.value)::numeric as total_results
    from keys k
    join public.ad_performance_daily d on d.user_id = k.user_id and d.pack_id = k.pack_id and d.ad_id = k.ad_id and d.date = k.date
    cross join lateral unnest(d.conv_key_ids, d.conv_values) as pr(key_id, value)
    where v_include_conv_types
      and coalesce(case
        when v_group_by = 'ad_id' then d.ad_id
        when v_group_by = 'ad_name' then coalesce(nullif(d.ad_name, ''), d.ad_id)
        when v_group_by = 'adset_id' then d.adset_id
        when v_group_by = 'campaign_id' then d.campaign_id
        else d.ad_id end, '') <> ''
      and (p_account_ids is null or d.account_id = any(p_account_ids))
      and (p_ad_name_contains is null or p_ad_name_contains = ''
           or coalesce(d.ad_name, '') ilike '%' || p_ad_name_contains || '%')
      and (
        (coalesce(p_campaign_name_contains, '') = '' and coalesce(p_adset_name_contains, '') = '')
        or exists (
          select 1 from public.ad_metrics am where am.user_id = k.user_id and am.pack_id = k.pack_id and am.ad_id = k.ad_id and am.date = k.date
            and (coalesce(p_campaign_name_contains, '') = ''
                 or coalesce(am.campaign_name, '') ilike '%' || p_campaign_name_contains || '%')
            and (coalesce(p_adset_name_contains, '') = ''
                 or coalesce(am.adset_name, '') ilike '%' || p_adset_name_contains || '%')
        )
      )
    group by pr.key_id
    ) c
    join public.conversion_keys ck on ck.id = c.key_id
  ),
  available_types as (
    select coalesce(jsonb_agg(c.conv_key order by c.conv_key), '[]'::jsonb) as conv_types
    from conv_all c
  ),
  per_action_all as (
    select coalesce(
      jsonb_object_agg(
        c.conv_key,
        jsonb_build_object(
          'results', c.total_results,
          'cpr', case when c.total_results > 0 then t.total_spend / c.total_results else 0 end,
          'page_conv', case when t.total_lpv > 0 then c.total_results / t.total_lpv else 0 end
        )
        order by c.conv_key
      ),
      '{}'::jsonb
    ) as per_action_type
    from conv_all c
    cross join totals t
  ),
  per_action_selected as (
    select
      case
        when v_selected_key <> '' then jsonb_build_object(
          v_selected_key,
          jsonb_build_object(
            'results', t.total_results,
            'cpr', case when t.total_results > 0 then t.total_spend / t.total_results else 0 end,
            'page_conv', case when t.total_lpv > 0 then t.total_results / t.total_lpv else 0 end
          )
        )
        else '{}'::jsonb
      end as per_action_type
    from totals t
  ),
  averages_payload as (
    select jsonb_build_object(
      'hook', case when t.total_plays > 0 then t.total_hook_wsum / t.total_plays else 0 end,
      'hold_rate', case when t.total_plays > 0 then t.total_hold_rate_wsum / t.total_plays else 0 end,
      'video_watched_p50', case when t.total_plays > 0 then t.total_video_watched_p50_wsum / t.total_plays else 0 end,
      'video_watched_p75', case when t.total_plays > 0 then t.total_video_watched_p75_wsum / t.total_plays else 0 end,
      'scroll_stop', case when t.total_plays > 0 then t.total_scroll_stop_wsum / t.total_plays else 0 end,
      'ctr', case when t.total_impressions > 0 then t.total_clicks::numeric / t.total_impressions else 0 end,
      'website_ctr', case when t.total_impressions > 0 then t.total_inline::numeric / t.total_impressions else 0 end,
      'connect_rate', case when t.total_inline > 0 then t.total_lpv::numeric / t.total_inline else 0 end,
      'cpm', case when t.total_impressions > 0 then (t.total_spend * 1000.0) / t.total_impressions else 0 end,
      'cpc', case when t.total_clicks > 0 then t.total_spend / t.total_clicks else 0 end,
      'cplc', case when t.total_inline > 0 then t.total_spend / t.total_inline else 0 end,
      'per_action_type', case when v_include_conv_types then paa.per_action_type else pas.per_action_type end
    ) as averages
    from totals t
    cross join per_action_all paa
    cross join per_action_selected pas
  ),
  header_payload as (
    select jsonb_build_object(
      'sums', jsonb_build_object(
        'spend', t.total_spend,
        'results', t.total_results,
        'mqls', to_jsonb(null::numeric)
      ),
      'weighted_averages', jsonb_build_object(
        'hook', case when t.total_plays > 0 then t.total_hook_wsum / t.total_plays else 0 end,
        'scroll_stop', case when t.total_plays > 0 then t.total_scroll_stop_wsum / t.total_plays else 0 end,
        'ctr', case when t.total_impressions > 0 then t.total_clicks::numeric / t.total_impressions else 0 end,
        'website_ctr', case when t.total_impressions > 0 then t.total_inline::numeric / t.total_impressions else 0 end,
        'connect_rate', case when t.total_inline > 0 then t.total_lpv::numeric / t.total_inline else 0 end,
        'cpm', case when t.total_impressions > 0 then (t.total_spend * 1000.0) / t.total_impressions else 0 end,
        'page_conv', case when t.total_lpv > 0 then t.total_results / t.total_lpv else 0 end
      )
    ) as header_aggregates
    from totals t
  ),
  ordered as (
    select rm.*
    from rows_metrics rm
    order by
      case when v_order_by = 'cpr' then rm.cpr end asc nulls last,
      case when v_order_by = 'hook' then rm.hook end desc nulls last,
      case when v_order_by = 'hold_rate' then rm.hold_rate end desc nulls last,
      case when v_order_by = 'spend' then rm.spend end desc nulls last,
      case when v_order_by = 'ctr' then rm.ctr end desc nulls last,
      case when v_order_by = 'connect_rate' then rm.connect_rate end desc nulls last,
      case when v_order_by = 'page_conv' then rm.page_conv end desc nulls last,
      case when v_order_by = 'cpm' then rm.cpm end desc nulls last,
      case when v_order_by = 'website_ctr' then rm.website_ctr end desc nulls last,
      case when v_order_by = 'results' then rm.results end desc nulls last,
      case
        when v_order_by not in ('cpr', 'hook', 'hold_rate', 'spend', 'ctr', 'connect_rate', 'page_conv', 'cpm', 'website_ctr', 'results')
        then rm.spend
      end desc nulls last,
      rm.group_key
  ),
  paged_raw as (
    select * from ordered offset v_offset limit v_limit
  ),
  paged as (
    select
      row_number() over () as ord,
      jsonb_build_object(
        'group_key', pr.group_key,
        'unique_id', null,
        'account_id', pr.account_id,
        'account_ids', pr.account_ids,
        'campaign_ids', pr.campaign_ids,
        'adset_ids', pr.adset_ids,
        'pack_ids', pr.pack_ids,
        'tags', pr.tags,
        'meta_created_time', pr.meta_created_min,
        'campaign_id', pr.campaign_id,
        'campaign_name', pr.campaign_name,
        'adset_id', pr.adset_id,
        'adset_name', pr.adset_name,
        'ad_id', pr.rep_ad_id,
        'ad_name', pr.label_name,
        'effective_status', pr.effective_status,
        'active_count', pr.active_count,
        'paused_self_count', pr.paused_self_count,
        'adset_paused_count', pr.adset_paused_count,
        'campaign_paused_count', pr.campaign_paused_count,
        'impressions', pr.impressions,
        'clicks', pr.clicks,
        'inline_link_clicks', pr.inline_link_clicks,
        'spend', pr.spend,
        'lpv', pr.lpv,
        'plays', pr.plays,
        'video_total_thruplays', pr.thruplays,
        'hook', pr.hook,
        'hold_rate', pr.hold_rate,
        'video_watched_p50', pr.video_watched_p50,
        'video_watched_p75', pr.video_watched_p75,
        'scroll_stop', pr.scroll_stop,
        'ctr', pr.ctr,
        'connect_rate', pr.connect_rate,
        'cpm', pr.cpm,
        'website_ctr', pr.website_ctr,
        'reach', pr.reach,
        'frequency', pr.frequency,
        'leadscore_histogram', pr.leadscore_histogram,
        'custom_histograms', pr.custom_histograms,
        'conversions', pr.conversions,
        'ad_count', pr.ad_count,
        'thumbnail', case
          when v_group_by in ('ad_name', 'ad_id') and pr.thumb_storage_path is not null then null
          else pr.thumbnail
        end,
        'thumb_storage_path', pr.thumb_storage_path,
        'adcreatives_videos_thumbs', pr.adcreatives_videos_thumbs,
        'media_type', pr.media_type,
        'has_transcription', pr.has_transcription,
        'transcription_no_audio', pr.transcription_no_audio
      ) as item
    from paged_raw pr
  ),
  -- Dicionario id -> nome, so das campanhas/conjuntos citados nas linhas DESTA
  -- pagina. O nome NAO viaja por linha: com ~23 campanhas por criativo o mesmo
  -- nome apareceria milhares de vezes, e nome de campanha e longo.
  paged_parent_ids as (
    select
      coalesce((select array_agg(distinct c) from paged_raw p, unnest(p.campaign_ids) c where c is not null), array[]::text[]) as campaign_ids,
      coalesce((select array_agg(distinct a) from paged_raw p, unnest(p.adset_ids) a where a is not null), array[]::text[]) as adset_ids
  ),
  -- `max(nome)`: um mesmo id pode carregar nomes diferentes entre os anuncios
  -- (a campanha foi renomeada entre dois sincronismos). Escolher e deterministico,
  -- e o rotulo continua identificando a mesma campanha.
  names_payload as (
    select jsonb_build_object(
      'campaigns', coalesce((
        select jsonb_object_agg(x.id, x.name)
        from (
          select a.campaign_id as id, max(a.campaign_name) as name
          from public.ads a, paged_parent_ids pp
          where a.user_id = any(v_owners)
            and a.campaign_id = any(pp.campaign_ids)
            and nullif(a.campaign_name, '') is not null
          group by a.campaign_id
        ) x
      ), '{}'::jsonb),
      'adsets', coalesce((
        select jsonb_object_agg(x.id, x.name)
        from (
          select a.adset_id as id, max(a.adset_name) as name
          from public.ads a, paged_parent_ids pp
          where a.user_id = any(v_owners)
            and a.adset_id = any(pp.adset_ids)
            and nullif(a.adset_name, '') is not null
          group by a.adset_id
        ) x
      ), '{}'::jsonb)
    ) as names
  ),
  total_count as (
    select count(*)::integer as total from rows_metrics
  ),
  pagination_payload as (
    select jsonb_build_object(
      'limit', v_limit,
      'offset', v_offset,
      'total', tc.total,
      'has_more', (v_offset + v_limit) < tc.total
    ) as pagination
    from total_count tc
  ),
  overlap_stat as (
    select count(*)::bigint as conflict_rows from keys k where k.x_cross_silo
  )
  select jsonb_build_object(
    'data', coalesce((select jsonb_agg(p.item order by p.ord) from paged p), '[]'::jsonb),
    'names', coalesce((select names from names_payload), '{}'::jsonb),
    'available_conversion_types',
      case when v_include_conv_types then coalesce((select conv_types from available_types), '[]'::jsonb) else '[]'::jsonb end,
    'averages', coalesce((select averages from averages_payload), '{}'::jsonb),
    'header_aggregates', coalesce((select header_aggregates from header_payload), '{}'::jsonb),
    'pagination', coalesce((select pagination from pagination_payload), jsonb_build_object('limit', v_limit, 'offset', v_offset, 'total', 0, 'has_more', false))
  )
  || case
       when coalesce((select conflict_rows from overlap_stat), 0) > 0
       then jsonb_build_object('overlap', jsonb_build_object('rows', (select conflict_rows from overlap_stat)))
       else '{}'::jsonb
     end
  into v_result;

  v_result := coalesce(v_result, jsonb_build_object(
    'data', '[]'::jsonb,
    'names', '{}'::jsonb,
    'available_conversion_types', '[]'::jsonb,
    'averages', '{}'::jsonb,
    'header_aggregates', '{}'::jsonb,
    'pagination', jsonb_build_object('limit', v_limit, 'offset', v_offset, 'total', 0, 'has_more', false)
  ));

  -- Fold do wrapper v067: filtro por campaign_id PÓS-agregação/paginação (averages e
  -- available_conversion_types permanecem do payload completo), pagination resetada.
  if nullif(trim(coalesce(p_campaign_id, '')), '') is not null then
    with data_rows as (
      select t.ord, t.item
      from jsonb_array_elements(
        case when jsonb_typeof(v_result->'data') = 'array' then v_result->'data' else '[]'::jsonb end
      ) with ordinality as t(item, ord)
      where coalesce(t.item->>'campaign_id', '') = trim(p_campaign_id)
    ),
    filtered_data as (
      select coalesce(jsonb_agg(dr.item order by dr.ord), '[]'::jsonb) as data, count(*)::integer as total
      from data_rows dr
    )
    select v_result || jsonb_build_object(
      'data', fd.data,
      'pagination', jsonb_build_object('limit', v_limit, 'offset', 0, 'total', fd.total, 'has_more', false)
    )
    into v_result
    from filtered_data fd;

    -- O dicionario foi montado para a pagina ANTES deste corte. Sem podar, uma
    -- consulta que sobra com 3 linhas carregaria os nomes de TODOS os pais da pagina
    -- inteira - o diferencial mediu a sobra: 2.011 conjuntos, ~186 kB de dicionario
    -- que nenhuma linha consulta. Roda so dentro do fold, e o custo e nomes x linhas
    -- restantes, que aqui sao poucas por definicao.
    select v_result || jsonb_build_object('names', jsonb_build_object(
      'campaigns', coalesce((
        select jsonb_object_agg(e.key, e.value)
        from jsonb_each_text(coalesce(v_result->'names'->'campaigns', '{}'::jsonb)) e
        where exists (
          select 1 from jsonb_array_elements(v_result->'data') r where r->'campaign_ids' ? e.key
        )
      ), '{}'::jsonb),
      'adsets', coalesce((
        select jsonb_object_agg(e.key, e.value)
        from jsonb_each_text(coalesce(v_result->'names'->'adsets', '{}'::jsonb)) e
        where exists (
          select 1 from jsonb_array_elements(v_result->'data') r where r->'adset_ids' ? e.key
        )
      ), '{}'::jsonb)
    )) into v_result;
  end if;

  return v_result;
end;
$$;


ALTER FUNCTION public.fetch_manager_performance_base_v155(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text, p_include_custom boolean) OWNER TO postgres;

--
-- Name: fetch_manager_performance_series_v145(uuid, date, date, text, uuid[], text[], text, text, text, text, text[], integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.fetch_manager_performance_series_v145(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text DEFAULT 'ad_name'::text, p_pack_ids uuid[] DEFAULT NULL::uuid[], p_account_ids text[] DEFAULT NULL::text[], p_campaign_name_contains text DEFAULT NULL::text, p_adset_name_contains text DEFAULT NULL::text, p_ad_name_contains text DEFAULT NULL::text, p_action_type text DEFAULT NULL::text, p_group_keys text[] DEFAULT NULL::text[], p_window integer DEFAULT 5) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    SET plan_cache_mode TO 'force_custom_plan'
    SET work_mem TO '32MB'
    AS $$
declare
  v_group_by text := lower(coalesce(p_group_by, 'ad_name'));
  v_date_start date := least(p_date_start, p_date_stop);
  v_date_stop date := greatest(p_date_start, p_date_stop);
  v_window integer := greatest(1, least(coalesce(p_window, 5), 30));
  v_axis_start date;
  v_selected_key text := trim(coalesce(p_action_type, ''));
  v_key_id integer := null;
  v_mql_min numeric;  -- null = corte NAO definido (nao e zero)
  v_result jsonb;
  v_owners uuid[];
  v_requested integer;
begin
  if auth.uid() is distinct from p_user_id then
    raise exception 'Forbidden: p_user_id must match auth.uid()'
      using errcode = '42501';
  end if;

  if p_pack_ids is null then
    v_owners := array[p_user_id];
  else
    select array_agg(distinct a.owner_id), count(distinct a.pack_id)
      into v_owners, v_requested
    from public.resolve_pack_access(p_pack_ids, p_user_id) a;
    if coalesce(v_requested, 0) < (select count(distinct x) from unnest(p_pack_ids) x) then
      raise exception 'Forbidden: pack inacessivel na selecao'
        using errcode = '42501';
    end if;
    if v_owners is null or array_length(v_owners, 1) is null then
      v_owners := array[p_user_id];
    end if;
  end if;

  if v_group_by not in ('ad_id', 'ad_name', 'adset_id', 'campaign_id') then
    raise exception 'Invalid p_group_by: %, expected ad_id|ad_name|adset_id|campaign_id', v_group_by
      using errcode = '22023';
  end if;

  -- Normalização da chave pedida, idêntica à série antiga (sem prefixo = 'conversion:').
  if v_selected_key <> '' and v_selected_key not like 'conversion:%' and v_selected_key not like 'action:%' then
    v_selected_key := 'conversion:' || v_selected_key;
  end if;
  if v_selected_key <> '' then
    select id into v_key_id from public.conversion_keys where key = v_selected_key;
  end if;

  -- Resolucao com heranca: pack sobrescreve o padrao do usuario (ver funcao).
  v_mql_min := public.resolve_pack_mql_leadscore_min(p_user_id, p_pack_ids);
  v_axis_start := greatest(v_date_start, (v_date_stop - (v_window - 1)));

  with requested_groups as (
    select distinct k as group_key
    from unnest(coalesce(p_group_keys, '{}'::text[])) k
    where nullif(trim(k), '') is not null
  ),
  axis as (
    select generate_series(v_axis_start, v_date_stop, interval '1 day')::date as d
  ),
  -- A seleção, SÓ na janela, resolvida no mapa (dedup cross-silo com a preferência da
  -- série antiga: vence o dono do pack compartilhado, o ator perde, desempate por uuid).
  keys as (
    select
      apm.ad_id,
      apm.date as date,
      apm.user_id,
      apm.pack_id
    from unnest(v_owners) as o(owner_id)
    join public.ad_performance_daily apm
      on apm.user_id = o.owner_id
     and apm.pack_id = any(p_pack_ids)
     and apm.date >= v_axis_start
     and apm.date <= v_date_stop
    where p_pack_ids is not null

    union all

    -- Sem selecao = o silo inteiro. Um anuncio-dia em dois packs sao duas linhas:
    -- o GROUP BY devolve uma, com um pack deterministico para o join seguinte.
    select am.ad_id, am.date, p_user_id as user_id,
           (array_agg(am.pack_id order by am.pack_id))[1] as pack_id
    from public.ad_performance_daily am
    where p_pack_ids is null
      and am.user_id = p_user_id
      and am.date >= v_axis_start
      and am.date <= v_date_stop
    group by am.ad_id, am.date
  ),
  sel as (
    select
      case
        when v_group_by = 'ad_id' then d.ad_id
        when v_group_by = 'ad_name' then coalesce(nullif(d.ad_name, ''), d.ad_id)
        when v_group_by = 'adset_id' then d.adset_id
        when v_group_by = 'campaign_id' then d.campaign_id
        else d.ad_id
      end as group_key,
      d.date,
      d.impressions, d.clicks, d.inline_link_clicks, d.spend, d.lpv, d.plays, d.thruplays, d.reach,
      d.hook_value, d.scroll_stop_value, d.hold_rate, d.video_watched_p50, d.video_watched_p75,
      coalesce(d.conv_values[array_position(d.conv_key_ids, v_key_id)], 0)::numeric as results,
      d.lead_scores,
      d.lead_qtys
    from keys k
    join public.ad_performance_daily d on d.user_id = k.user_id and d.pack_id = k.pack_id and d.ad_id = k.ad_id and d.date = k.date
    where (p_account_ids is null or d.account_id = any(p_account_ids))
      and (p_ad_name_contains is null or p_ad_name_contains = ''
           or coalesce(d.ad_name, '') ilike '%' || p_ad_name_contains || '%')
      and (
        (coalesce(p_campaign_name_contains, '') = '' and coalesce(p_adset_name_contains, '') = '')
        or exists (
          select 1 from public.ad_metrics am where am.user_id = k.user_id and am.pack_id = k.pack_id and am.ad_id = k.ad_id and am.date = k.date
            and (coalesce(p_campaign_name_contains, '') = ''
                 or coalesce(am.campaign_name, '') ilike '%' || p_campaign_name_contains || '%')
            and (coalesce(p_adset_name_contains, '') = ''
                 or coalesce(am.adset_name, '') ilike '%' || p_adset_name_contains || '%')
        )
      )
  ),
  filtered as (
    select s.*
    from sel s
    join requested_groups rg on rg.group_key = s.group_key
  ),
  daily as (
    select
      f.group_key,
      f.date,
      sum(f.impressions)::bigint as impressions,
      sum(f.clicks)::bigint as clicks,
      sum(f.inline_link_clicks)::bigint as inline_link_clicks,
      sum(f.spend)::numeric as spend,
      sum(f.lpv)::bigint as lpv,
      sum(f.plays)::bigint as plays,
      sum(f.thruplays)::bigint as thruplays,
      sum(f.reach)::bigint as reach,
      sum(f.hook_value * f.plays)::numeric as hook_wsum,
      sum(f.scroll_stop_value * f.plays)::numeric as scroll_stop_wsum,
      sum(f.hold_rate * f.plays)::numeric as hold_rate_wsum,
      sum(f.video_watched_p50 * f.plays)::numeric as video_watched_p50_wsum,
      sum(f.video_watched_p75 * f.plays)::numeric as video_watched_p75_wsum,
      sum(f.results)::numeric as results,
      -- histograma: MQLs = soma das quantidades com score >= corte; soma = Σ score×qty;
      -- contagem = Σ qty. Idêntico a contar/somar o array cru, sem desempacotar 1 KB.
      (case
        when v_mql_min is null then null
        else sum(coalesce((select sum(s.q) from unnest(f.lead_scores, f.lead_qtys) as s(v, q) where s.v >= v_mql_min), 0))
      end)::bigint as mql_count,
      sum(coalesce((select sum(s.v * s.q) from unnest(f.lead_scores, f.lead_qtys) as s(v, q)), 0))::numeric as leadscore_sum,
      sum(coalesce((select sum(s.q) from unnest(f.lead_qtys) as s(q)), 0))::bigint as leadscore_count
    from filtered f
    group by f.group_key, f.date
  ),
  series_by_group as (
    select
      rg.group_key,
      jsonb_build_object(
        'axis', jsonb_agg(to_char(a.d, 'YYYY-MM-DD') order by a.d),
        'hook', jsonb_agg(case when coalesce(d.plays, 0) > 0 then d.hook_wsum / d.plays else null end order by a.d),
        'scroll_stop', jsonb_agg(case when coalesce(d.plays, 0) > 0 then d.scroll_stop_wsum / d.plays else null end order by a.d),
        'hold_rate', jsonb_agg(case when coalesce(d.plays, 0) > 0 then d.hold_rate_wsum / d.plays else null end order by a.d),
        'video_watched_p50', jsonb_agg(case when coalesce(d.plays, 0) > 0 then d.video_watched_p50_wsum / d.plays else null end order by a.d),
        'video_watched_p75', jsonb_agg(case when coalesce(d.plays, 0) > 0 then d.video_watched_p75_wsum / d.plays else null end order by a.d),
        'spend', jsonb_agg(case when coalesce(d.spend, 0) <> 0 then d.spend else null end order by a.d),
        'clicks', jsonb_agg(case when coalesce(d.clicks, 0) <> 0 then d.clicks else null end order by a.d),
        'inline_link_clicks', jsonb_agg(case when coalesce(d.inline_link_clicks, 0) <> 0 then d.inline_link_clicks else null end order by a.d),
        'ctr', jsonb_agg(case when coalesce(d.impressions, 0) > 0 then d.clicks::numeric / d.impressions else null end order by a.d),
        'connect_rate', jsonb_agg(case when coalesce(d.inline_link_clicks, 0) > 0 then d.lpv::numeric / d.inline_link_clicks else null end order by a.d),
        'lpv', jsonb_agg(coalesce(d.lpv, 0) order by a.d),
        'impressions', jsonb_agg(case when coalesce(d.impressions, 0) <> 0 then d.impressions else null end order by a.d),
        'plays', jsonb_agg(case when coalesce(d.plays, 0) <> 0 then d.plays else null end order by a.d),
        'thruplays', jsonb_agg(case when coalesce(d.thruplays, 0) <> 0 then d.thruplays else null end order by a.d),
        'reach', jsonb_agg(case when coalesce(d.reach, 0) <> 0 then d.reach else null end order by a.d),
        'cpm', jsonb_agg(case when coalesce(d.impressions, 0) > 0 then (d.spend * 1000.0) / d.impressions else null end order by a.d),
        'cpc', jsonb_agg(case when coalesce(d.clicks, 0) > 0 then d.spend / d.clicks else null end order by a.d),
        'cplc', jsonb_agg(case when coalesce(d.inline_link_clicks, 0) > 0 then d.spend / d.inline_link_clicks else null end order by a.d),
        'website_ctr', jsonb_agg(case when coalesce(d.impressions, 0) > 0 then d.inline_link_clicks::numeric / d.impressions else null end order by a.d),
        'conversions', jsonb_agg(
          case
            when v_selected_key <> '' then jsonb_build_object(v_selected_key, coalesce(d.results, 0))
            else '{}'::jsonb
          end
          order by a.d
        ),
        'cpmql', jsonb_agg(
          case
            when coalesce(d.mql_count, 0) > 0 and coalesce(d.spend, 0) > 0 then d.spend / d.mql_count
            else null
          end
          order by a.d
        ),
        'mqls', jsonb_agg(
          case when coalesce(d.mql_count, 0) > 0 then d.mql_count else null end
          order by a.d
        ),
        'leadscore_avg', jsonb_agg(
          case
            when coalesce(d.leadscore_count, 0) > 0 then d.leadscore_sum / d.leadscore_count
            else null
          end
          order by a.d
        ),
        -- Taxa de qualificação do dia: MQLs sobre o TOTAL de leads (escala 0-1).
        'mql_rate', jsonb_agg(
          case
            when d.mql_count is not null and coalesce(d.leadscore_count, 0) > 0
              then d.mql_count::numeric / d.leadscore_count
            else null
          end
          order by a.d
        )
      ) as series
    from requested_groups rg
    cross join axis a
    left join daily d
      on d.group_key = rg.group_key
     and d.date = a.d
    group by rg.group_key
  )
  select jsonb_build_object(
    'series_by_group', coalesce(
      (select jsonb_object_agg(sbg.group_key, sbg.series order by sbg.group_key) from series_by_group sbg),
      '{}'::jsonb
    ),
    'window', v_window
  )
  into v_result;

  return coalesce(v_result, jsonb_build_object('series_by_group', '{}'::jsonb, 'window', v_window));
end;
$$;


ALTER FUNCTION public.fetch_manager_performance_series_v145(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_group_keys text[], p_window integer) OWNER TO postgres;

--
-- Name: FUNCTION fetch_manager_performance_series_v145(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_group_keys text[], p_window integer); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.fetch_manager_performance_series_v145(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_group_keys text[], p_window integer) IS 'Serie diaria do Manager (145): a v131 sobre a chave com pack.';


--
-- Name: fetch_manager_performance_series_v171(uuid, date, date, text, uuid[], text[], text, text, text, text, text[], integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.fetch_manager_performance_series_v171(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text DEFAULT 'ad_name'::text, p_pack_ids uuid[] DEFAULT NULL::uuid[], p_account_ids text[] DEFAULT NULL::text[], p_campaign_name_contains text DEFAULT NULL::text, p_adset_name_contains text DEFAULT NULL::text, p_ad_name_contains text DEFAULT NULL::text, p_action_type text DEFAULT NULL::text, p_group_keys text[] DEFAULT NULL::text[], p_window integer DEFAULT 5) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    SET plan_cache_mode TO 'force_custom_plan'
    SET work_mem TO '32MB'
    AS $$
declare
  v_group_by text := lower(coalesce(p_group_by, 'ad_name'));
  v_date_start date := least(p_date_start, p_date_stop);
  v_date_stop date := greatest(p_date_start, p_date_stop);
  v_window integer := greatest(1, least(coalesce(p_window, 5), 30));
  v_axis_start date;
  v_selected_key text := trim(coalesce(p_action_type, ''));
  v_key_id integer := null;
  v_mql_min numeric;  -- null = corte NAO definido (nao e zero)
  v_result jsonb;
  v_owners uuid[];
  v_requested integer;
begin
  if auth.uid() is distinct from p_user_id then
    raise exception 'Forbidden: p_user_id must match auth.uid()'
      using errcode = '42501';
  end if;

  if p_pack_ids is null then
    v_owners := array[p_user_id];
  else
    select array_agg(distinct a.owner_id), count(distinct a.pack_id)
      into v_owners, v_requested
    from public.resolve_pack_access(p_pack_ids, p_user_id) a;
    if coalesce(v_requested, 0) < (select count(distinct x) from unnest(p_pack_ids) x) then
      raise exception 'Forbidden: pack inacessivel na selecao'
        using errcode = '42501';
    end if;
    if v_owners is null or array_length(v_owners, 1) is null then
      v_owners := array[p_user_id];
    end if;
  end if;

  if v_group_by not in ('ad_id', 'ad_name', 'adset_id', 'campaign_id') then
    raise exception 'Invalid p_group_by: %, expected ad_id|ad_name|adset_id|campaign_id', v_group_by
      using errcode = '22023';
  end if;

  -- Normalização da chave pedida, idêntica à série antiga (sem prefixo = 'conversion:').
  if v_selected_key <> '' and v_selected_key not like 'conversion:%' and v_selected_key not like 'action:%' then
    v_selected_key := 'conversion:' || v_selected_key;
  end if;
  if v_selected_key <> '' then
    select id into v_key_id from public.conversion_keys where key = v_selected_key;
  end if;

  -- Resolucao com heranca: pack sobrescreve o padrao do usuario (ver funcao).
  v_mql_min := public.resolve_pack_mql_leadscore_min(p_user_id, p_pack_ids);
  v_axis_start := greatest(v_date_start, (v_date_stop - (v_window - 1)));

  with requested_groups as (
    select distinct k as group_key
    from unnest(coalesce(p_group_keys, '{}'::text[])) k
    where nullif(trim(k), '') is not null
  ),
  axis as (
    select generate_series(v_axis_start, v_date_stop, interval '1 day')::date as d
  ),
  -- A seleção, SÓ na janela, resolvida no mapa (dedup cross-silo com a preferência da
  -- série antiga: vence o dono do pack compartilhado, o ator perde, desempate por uuid).
  keys as (
    select
      apm.ad_id,
      apm.date as date,
      apm.user_id,
      apm.pack_id
    from unnest(v_owners) as o(owner_id)
    join public.ad_performance_daily apm
      on apm.user_id = o.owner_id
     and apm.pack_id = any(p_pack_ids)
     and apm.date >= v_axis_start
     and apm.date <= v_date_stop
    where p_pack_ids is not null

    union all

    -- Sem selecao = o silo inteiro. Um anuncio-dia em dois packs sao duas linhas:
    -- o GROUP BY devolve uma, com um pack deterministico para o join seguinte.
    select am.ad_id, am.date, p_user_id as user_id,
           (array_agg(am.pack_id order by am.pack_id))[1] as pack_id
    from public.ad_performance_daily am
    where p_pack_ids is null
      and am.user_id = p_user_id
      and am.date >= v_axis_start
      and am.date <= v_date_stop
    group by am.ad_id, am.date
  ),
  sel as (
    select
      case
        when v_group_by = 'ad_id' then d.ad_id
        when v_group_by = 'ad_name' then coalesce(nullif(d.ad_name, ''), d.ad_id)
        when v_group_by = 'adset_id' then d.adset_id
        when v_group_by = 'campaign_id' then d.campaign_id
        else d.ad_id
      end as group_key,
      d.date,
      d.impressions, d.clicks, d.inline_link_clicks, d.spend, d.lpv,
      -- (171) anuncio de IMAGEM nao contribui para metrica de video: com plays em 0,
      -- o dia sai NULL na serie ("nao se aplica"), nao 0.
      case when a.media_type = 'image' then 0 else d.plays end as plays, case when a.media_type = 'image' then 0 else d.thruplays end as thruplays, d.reach,
      case when a.media_type = 'image' then 0 else d.hook_value end as hook_value, case when a.media_type = 'image' then 0 else d.scroll_stop_value end as scroll_stop_value, case when a.media_type = 'image' then 0 else d.hold_rate end as hold_rate,
      case when a.media_type = 'image' then 0 else d.video_watched_p50 end as video_watched_p50, case when a.media_type = 'image' then 0 else d.video_watched_p75 end as video_watched_p75,
      coalesce(d.conv_values[array_position(d.conv_key_ids, v_key_id)], 0)::numeric as results,
      d.lead_scores,
      d.lead_qtys
    from keys k
    join public.ad_performance_daily d on d.user_id = k.user_id and d.pack_id = k.pack_id and d.ad_id = k.ad_id and d.date = k.date
    -- (171) o tipo de midia da variacao, pelo indice de cobertura (170)
    left join public.ads a on a.user_id = d.user_id and a.ad_id = d.ad_id
    where (p_account_ids is null or d.account_id = any(p_account_ids))
      and (p_ad_name_contains is null or p_ad_name_contains = ''
           or coalesce(d.ad_name, '') ilike '%' || p_ad_name_contains || '%')
      and (
        (coalesce(p_campaign_name_contains, '') = '' and coalesce(p_adset_name_contains, '') = '')
        or exists (
          select 1 from public.ad_metrics am where am.user_id = k.user_id and am.pack_id = k.pack_id and am.ad_id = k.ad_id and am.date = k.date
            and (coalesce(p_campaign_name_contains, '') = ''
                 or coalesce(am.campaign_name, '') ilike '%' || p_campaign_name_contains || '%')
            and (coalesce(p_adset_name_contains, '') = ''
                 or coalesce(am.adset_name, '') ilike '%' || p_adset_name_contains || '%')
        )
      )
  ),
  filtered as (
    select s.*
    from sel s
    join requested_groups rg on rg.group_key = s.group_key
  ),
  daily as (
    select
      f.group_key,
      f.date,
      sum(f.impressions)::bigint as impressions,
      sum(f.clicks)::bigint as clicks,
      sum(f.inline_link_clicks)::bigint as inline_link_clicks,
      sum(f.spend)::numeric as spend,
      sum(f.lpv)::bigint as lpv,
      sum(f.plays)::bigint as plays,
      sum(f.thruplays)::bigint as thruplays,
      sum(f.reach)::bigint as reach,
      sum(f.hook_value * f.plays)::numeric as hook_wsum,
      sum(f.scroll_stop_value * f.plays)::numeric as scroll_stop_wsum,
      sum(f.hold_rate * f.plays)::numeric as hold_rate_wsum,
      sum(f.video_watched_p50 * f.plays)::numeric as video_watched_p50_wsum,
      sum(f.video_watched_p75 * f.plays)::numeric as video_watched_p75_wsum,
      sum(f.results)::numeric as results,
      -- histograma: MQLs = soma das quantidades com score >= corte; soma = Σ score×qty;
      -- contagem = Σ qty. Idêntico a contar/somar o array cru, sem desempacotar 1 KB.
      (case
        when v_mql_min is null then null
        else sum(coalesce((select sum(s.q) from unnest(f.lead_scores, f.lead_qtys) as s(v, q) where s.v >= v_mql_min), 0))
      end)::bigint as mql_count,
      sum(coalesce((select sum(s.v * s.q) from unnest(f.lead_scores, f.lead_qtys) as s(v, q)), 0))::numeric as leadscore_sum,
      sum(coalesce((select sum(s.q) from unnest(f.lead_qtys) as s(q)), 0))::bigint as leadscore_count
    from filtered f
    group by f.group_key, f.date
  ),
  series_by_group as (
    select
      rg.group_key,
      jsonb_build_object(
        'axis', jsonb_agg(to_char(a.d, 'YYYY-MM-DD') order by a.d),
        'hook', jsonb_agg(case when coalesce(d.plays, 0) > 0 then d.hook_wsum / d.plays else null end order by a.d),
        'scroll_stop', jsonb_agg(case when coalesce(d.plays, 0) > 0 then d.scroll_stop_wsum / d.plays else null end order by a.d),
        'hold_rate', jsonb_agg(case when coalesce(d.plays, 0) > 0 then d.hold_rate_wsum / d.plays else null end order by a.d),
        'video_watched_p50', jsonb_agg(case when coalesce(d.plays, 0) > 0 then d.video_watched_p50_wsum / d.plays else null end order by a.d),
        'video_watched_p75', jsonb_agg(case when coalesce(d.plays, 0) > 0 then d.video_watched_p75_wsum / d.plays else null end order by a.d),
        'spend', jsonb_agg(case when coalesce(d.spend, 0) <> 0 then d.spend else null end order by a.d),
        'clicks', jsonb_agg(case when coalesce(d.clicks, 0) <> 0 then d.clicks else null end order by a.d),
        'inline_link_clicks', jsonb_agg(case when coalesce(d.inline_link_clicks, 0) <> 0 then d.inline_link_clicks else null end order by a.d),
        'ctr', jsonb_agg(case when coalesce(d.impressions, 0) > 0 then d.clicks::numeric / d.impressions else null end order by a.d),
        'connect_rate', jsonb_agg(case when coalesce(d.inline_link_clicks, 0) > 0 then d.lpv::numeric / d.inline_link_clicks else null end order by a.d),
        'lpv', jsonb_agg(coalesce(d.lpv, 0) order by a.d),
        'impressions', jsonb_agg(case when coalesce(d.impressions, 0) <> 0 then d.impressions else null end order by a.d),
        'plays', jsonb_agg(case when coalesce(d.plays, 0) <> 0 then d.plays else null end order by a.d),
        'thruplays', jsonb_agg(case when coalesce(d.thruplays, 0) <> 0 then d.thruplays else null end order by a.d),
        'reach', jsonb_agg(case when coalesce(d.reach, 0) <> 0 then d.reach else null end order by a.d),
        'cpm', jsonb_agg(case when coalesce(d.impressions, 0) > 0 then (d.spend * 1000.0) / d.impressions else null end order by a.d),
        'cpc', jsonb_agg(case when coalesce(d.clicks, 0) > 0 then d.spend / d.clicks else null end order by a.d),
        'cplc', jsonb_agg(case when coalesce(d.inline_link_clicks, 0) > 0 then d.spend / d.inline_link_clicks else null end order by a.d),
        'website_ctr', jsonb_agg(case when coalesce(d.impressions, 0) > 0 then d.inline_link_clicks::numeric / d.impressions else null end order by a.d),
        'conversions', jsonb_agg(
          case
            when v_selected_key <> '' then jsonb_build_object(v_selected_key, coalesce(d.results, 0))
            else '{}'::jsonb
          end
          order by a.d
        ),
        'cpmql', jsonb_agg(
          case
            when coalesce(d.mql_count, 0) > 0 and coalesce(d.spend, 0) > 0 then d.spend / d.mql_count
            else null
          end
          order by a.d
        ),
        'mqls', jsonb_agg(
          case when coalesce(d.mql_count, 0) > 0 then d.mql_count else null end
          order by a.d
        ),
        'leadscore_avg', jsonb_agg(
          case
            when coalesce(d.leadscore_count, 0) > 0 then d.leadscore_sum / d.leadscore_count
            else null
          end
          order by a.d
        ),
        -- Taxa de qualificação do dia: MQLs sobre o TOTAL de leads (escala 0-1).
        'mql_rate', jsonb_agg(
          case
            when d.mql_count is not null and coalesce(d.leadscore_count, 0) > 0
              then d.mql_count::numeric / d.leadscore_count
            else null
          end
          order by a.d
        )
      ) as series
    from requested_groups rg
    cross join axis a
    left join daily d
      on d.group_key = rg.group_key
     and d.date = a.d
    group by rg.group_key
  )
  select jsonb_build_object(
    'series_by_group', coalesce(
      (select jsonb_object_agg(sbg.group_key, sbg.series order by sbg.group_key) from series_by_group sbg),
      '{}'::jsonb
    ),
    'window', v_window
  )
  into v_result;

  return coalesce(v_result, jsonb_build_object('series_by_group', '{}'::jsonb, 'window', v_window));
end;
$$;


ALTER FUNCTION public.fetch_manager_performance_series_v171(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_group_keys text[], p_window integer) OWNER TO postgres;

--
-- Name: FUNCTION fetch_manager_performance_series_v171(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_group_keys text[], p_window integer); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.fetch_manager_performance_series_v171(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_group_keys text[], p_window integer) IS '171: a série do Manager (v145) com a regra da 170 — variação de imagem não contribui para métrica de vídeo; com plays em 0 o dia sai NULL na série.';


--
-- Name: fetch_manager_rankings_core_v2(uuid, date, date, text, uuid[], text[], text, text, text, text, boolean, boolean, integer, integer, text, text, boolean); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.fetch_manager_rankings_core_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text DEFAULT 'ad_name'::text, p_pack_ids uuid[] DEFAULT NULL::uuid[], p_account_ids text[] DEFAULT NULL::text[], p_campaign_name_contains text DEFAULT NULL::text, p_adset_name_contains text DEFAULT NULL::text, p_ad_name_contains text DEFAULT NULL::text, p_action_type text DEFAULT NULL::text, p_include_leadscore boolean DEFAULT true, p_include_available_conversion_types boolean DEFAULT true, p_limit integer DEFAULT 500, p_offset integer DEFAULT 0, p_order_by text DEFAULT 'spend'::text, p_campaign_id text DEFAULT NULL::text, p_include_custom boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_group_by text := lower(coalesce(p_group_by, 'ad_name'));
  v_payload jsonb;
  v_data jsonb := '[]'::jsonb;
begin
  select public.fetch_manager_performance_base_v155(
    p_user_id, p_date_start, p_date_stop, p_group_by, p_pack_ids, p_account_ids,
    p_campaign_name_contains, p_adset_name_contains, p_ad_name_contains, p_action_type,
    p_include_leadscore, p_include_available_conversion_types, p_limit, p_offset,
    p_order_by, p_campaign_id, p_include_custom
  )
  into v_payload;
  if coalesce(jsonb_typeof(v_payload), '') <> 'object' then
    return v_payload;
  end if;
  if v_group_by not in ('adset_id', 'campaign_id') then
    return v_payload;
  end if;
  with raw_rows as (
    select
      t.ord,
      t.item,
      nullif(trim(coalesce(t.item->>'adset_id', '')), '') as adset_id,
      nullif(trim(coalesce(t.item->>'campaign_id', '')), '') as campaign_id
    from jsonb_array_elements(
      case when jsonb_typeof(v_payload->'data') = 'array' then v_payload->'data' else '[]'::jsonb end
    ) with ordinality as t(item, ord)
  ),
  resolved_rows as (
    select
      rr.ord,
      rr.item || jsonb_build_object(
        'effective_status',
        case
          when v_group_by = 'adset_id' and rr.adset_id is not null then
            coalesce(
              nullif(pb_self.effective_status, ''),
              case
                when exists (
                  select 1 from public.ads a
                  where a.user_id = p_user_id and a.adset_id = rr.adset_id
                    and upper(coalesce(a.effective_status, '')) = 'ADSET_PAUSED'
                  limit 1
                ) then 'ADSET_PAUSED'
                when exists (
                  select 1 from public.ads a
                  where a.user_id = p_user_id and a.adset_id = rr.adset_id
                    and upper(coalesce(a.effective_status, '')) = 'CAMPAIGN_PAUSED'
                  limit 1
                ) then 'CAMPAIGN_PAUSED'
                else 'ACTIVE'
              end
            )
          when v_group_by = 'campaign_id' and rr.campaign_id is not null then
            coalesce(
              nullif(pb_self.effective_status, ''),
              case
                when exists (
                  select 1 from public.ads a
                  where a.user_id = p_user_id and a.campaign_id = rr.campaign_id
                    and upper(coalesce(a.effective_status, '')) = 'CAMPAIGN_PAUSED'
                  limit 1
                ) then 'CAMPAIGN_PAUSED'
                else 'ACTIVE'
              end
            )
          when v_group_by in ('adset_id', 'campaign_id') then 'ACTIVE'
          else rr.item->>'effective_status'
        end,
        'budget_daily', pb_self.daily_budget,
        'budget_lifetime', pb_self.lifetime_budget,
        'budget_mode', pb_mode.budget_mode,
        'budget_currency', acct.currency,
        'ad_count', coalesce(
          case when v_group_by = 'adset_id' then pb_self.ads_count else null end,
          nullif(rr.item->>'ad_count', '')::integer
        )
      ) as item
    from raw_rows rr
    left join lateral (
      select pb.daily_budget, pb.lifetime_budget, pb.account_id, pb.ads_count, pb.effective_status
      from public.parent_entities pb
      where pb.user_id = p_user_id
        and pb.entity_id = case when v_group_by = 'adset_id' then rr.adset_id else rr.campaign_id end
      limit 1
    ) pb_self on true
    left join lateral (
      select pb.budget_mode
      from public.parent_entities pb
      where pb.user_id = p_user_id and pb.entity_id = rr.campaign_id
      limit 1
    ) pb_mode on true
    left join lateral (
      select aa.currency
      from public.ad_accounts aa
      where aa.user_id = p_user_id
        and replace(aa.id, 'act_', '') = replace(pb_self.account_id, 'act_', '')
        and nullif(aa.currency, '') is not null
      limit 1
    ) acct on true
  )
  select coalesce(jsonb_agg(item order by ord), '[]'::jsonb)
  into v_data
  from resolved_rows;
  return v_payload || jsonb_build_object('data', v_data);
end;
$$;


ALTER FUNCTION public.fetch_manager_rankings_core_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text, p_include_custom boolean) OWNER TO postgres;

--
-- Name: FUNCTION fetch_manager_rankings_core_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text, p_include_custom boolean); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.fetch_manager_rankings_core_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text, p_include_custom boolean) IS 'Entry do Manager (migration 140): delega a fetch_manager_performance_base_v140 e resolve status/orcamento de conjunto/campanha por parent_entities. p_include_custom (default false) liga os histogramas das colunas vinculadas da planilha.';


--
-- Name: fetch_manager_rankings_retention_v172(uuid, date, date, text, uuid[], text[], text, text, text, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.fetch_manager_rankings_retention_v172(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text DEFAULT 'ad_name'::text, p_pack_ids uuid[] DEFAULT NULL::uuid[], p_account_ids text[] DEFAULT NULL::text[], p_campaign_name_contains text DEFAULT NULL::text, p_adset_name_contains text DEFAULT NULL::text, p_ad_name_contains text DEFAULT NULL::text, p_group_key text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    SET plan_cache_mode TO 'force_custom_plan'
    AS $$
declare
  v_group_by text := lower(coalesce(p_group_by, 'ad_name'));
  v_date_start date := least(p_date_start, p_date_stop);
  v_date_stop date := greatest(p_date_start, p_date_stop);
  v_group_key text := trim(coalesce(p_group_key, ''));
  v_result jsonb;
  v_owners uuid[];
  v_requested integer;
begin
  -- p_user_id identifica o ATOR. Assinatura preservada: mudar a lista de
  -- parametros cria ambiguidade de overload no PostgREST (ver migration 095).
  if auth.uid() is distinct from p_user_id then
    raise exception 'Forbidden: p_user_id must match auth.uid()'
      using errcode = '42501';
  end if;

  -- Os donos do dado saem dos packs pedidos. Pack inacessivel nao volta do
  -- resolvedor, e a contagem denuncia: falhar alto e melhor que devolver
  -- agregado silenciosamente incompleto.
  if p_pack_ids is null then
    v_owners := array[p_user_id];
  else
    select array_agg(distinct a.owner_id), count(distinct a.pack_id)
      into v_owners, v_requested
    from public.resolve_pack_access(p_pack_ids, p_user_id) a;

    if coalesce(v_requested, 0) < (select count(distinct x) from unnest(p_pack_ids) x) then
      raise exception 'Forbidden: pack inacessivel na selecao'
        using errcode = '42501';
    end if;

    if v_owners is null or array_length(v_owners, 1) is null then
      v_owners := array[p_user_id];
    end if;
  end if;

  if v_group_by not in ('ad_id', 'ad_name', 'adset_id', 'campaign_id') then
    raise exception 'Invalid p_group_by: %, expected ad_id|ad_name|adset_id|campaign_id', v_group_by
      using errcode = '22023';
  end if;

  if v_group_key = '' then
    return jsonb_build_object('group_key', v_group_key, 'video_play_curve_actions', '[]'::jsonb);
  end if;

  -- P3.2: dirigido pelos DONOS resolvidos, nao filtrado por um user_id escalar.
  -- Medido na RPC principal: `am.user_id = any(v_owners)` faz o planner perder
  -- ad_metric_pack_map_user_pack_date_ad_idx e cair no PK varrendo todos os
  -- user_ids (67ms -> 4010ms). Dirigindo a partir dos donos, o nested loop liga
  -- as 4 colunas do indice composto. O ramo legado (p_pack_ids nulo, sem map
  -- para dirigir) fica no UNION ALL e o planner poda o ramo morto.
  with base_candidates as (
    select am.*
    from public.ad_metrics am
    where p_pack_ids is null
      and am.user_id = p_user_id
      and am.date >= v_date_start
      and am.date <= v_date_stop
      and (p_account_ids is null or am.account_id = any(p_account_ids))
      and (
        p_campaign_name_contains is null
        or p_campaign_name_contains = ''
        or coalesce(am.campaign_name, '') ilike '%' || p_campaign_name_contains || '%'
      )
      and (
        p_adset_name_contains is null
        or p_adset_name_contains = ''
        or coalesce(am.adset_name, '') ilike '%' || p_adset_name_contains || '%'
      )
      and (
        p_ad_name_contains is null
        or p_ad_name_contains = ''
        or coalesce(am.ad_name, '') ilike '%' || p_ad_name_contains || '%'
      )
    union all
    select am.*
    from unnest(v_owners) as o(owner_id)
    join public.ad_metrics am
      on am.user_id = o.owner_id
     and am.pack_id = any(p_pack_ids)
     and am.date >= v_date_start
     and am.date <= v_date_stop
    where p_pack_ids is not null
      and (p_account_ids is null or am.account_id = any(p_account_ids))
      and (
        p_campaign_name_contains is null
        or p_campaign_name_contains = ''
        or coalesce(am.campaign_name, '') ilike '%' || p_campaign_name_contains || '%'
      )
      and (
        p_adset_name_contains is null
        or p_adset_name_contains = ''
        or coalesce(am.adset_name, '') ilike '%' || p_adset_name_contains || '%'
      )
      and (
        p_ad_name_contains is null
        or p_ad_name_contains = ''
        or coalesce(am.ad_name, '') ilike '%' || p_ad_name_contains || '%'
      )
  ),
  -- P3.2: dedup CROSS-SILO. Vence o silo do DONO do pack compartilhado (o ator
  -- perde), desempate por uuid — estavel entre refreshes. Custo zero: o Postgres
  -- ja eliminava user_id da chave de ordenacao por ser constante.
  base as (
    select distinct on (am.ad_id, am.date)
      am.*
    from base_candidates am
    order by
      am.ad_id,
      am.date,
      (am.user_id = p_user_id),
      am.user_id,
      am.updated_at desc nulls last,
      am.created_at desc nulls last,
      am.id desc
  ),
  filtered as (
    select
      case
        when v_group_by = 'ad_id' then am.ad_id
        when v_group_by = 'ad_name' then coalesce(nullif(am.ad_name, ''), am.ad_id)
        when v_group_by = 'adset_id' then am.adset_id
        when v_group_by = 'campaign_id' then am.campaign_id
        else am.ad_id
      end as group_key,
      -- (172) Anúncio de IMAGEM não tem curva de retenção: a Meta às vezes manda uma,
      -- e com plays zerado o `where t.plays > 0` de `curve_points` descarta a linha
      -- inteira. Mesma regra da 170 (linhas) e da 171 (série e detalhe), no mesmo
      -- lugar: uma vez, sobre a linha anúncio-dia.
      coalesce(case when adm.media_type = 'image' then 0 else am.video_total_plays end, 0)::bigint as plays,
      case when jsonb_typeof(am.video_play_curve_actions) = 'array' then am.video_play_curve_actions else '[]'::jsonb end as curve
    from base am
    left join public.ads adm on adm.user_id = am.user_id and adm.ad_id = am.ad_id
  ),
  target as (
    select *
    from filtered
    where group_key = v_group_key
  ),
  curve_points as (
    select
      (cv.ord - 1)::integer as idx,
      sum(
        coalesce(
          nullif(regexp_replace(cv.val, '[^0-9.-]', '', 'g'), ''),
          '0'
        )::numeric * t.plays
      )::numeric as weighted_sum,
      sum(t.plays)::numeric as plays_sum
    from target t
    cross join lateral jsonb_array_elements_text(t.curve) with ordinality as cv(val, ord)
    where t.plays > 0
    group by (cv.ord - 1)
  ),
  max_idx as (
    select max(cp.idx) as max_idx
    from curve_points cp
  ),
  curve_out as (
    select
      jsonb_agg(
        coalesce(round(cp.weighted_sum / nullif(cp.plays_sum, 0))::int, 0)
        order by gs.idx
      ) as curve
    from max_idx mx
    cross join lateral generate_series(0, coalesce(mx.max_idx, -1)) as gs(idx)
    left join curve_points cp
      on cp.idx = gs.idx
  )
  select jsonb_build_object(
    'group_key', v_group_key,
    'video_play_curve_actions', coalesce((select curve from curve_out), '[]'::jsonb)
  )
  into v_result;

  return coalesce(v_result, jsonb_build_object('group_key', v_group_key, 'video_play_curve_actions', '[]'::jsonb));
end;
$$;


ALTER FUNCTION public.fetch_manager_rankings_retention_v172(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_group_key text) OWNER TO postgres;

--
-- Name: FUNCTION fetch_manager_rankings_retention_v172(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_group_key text); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.fetch_manager_rankings_retention_v172(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_group_key text) IS '172: a curva de retenção do Manager (v2) com a regra da 170 — variação de imagem não entra na curva (plays zerado, e o filtro plays > 0 a descarta).';


--
-- Name: fetch_manager_rankings_retention_v2(uuid, date, date, text, uuid[], text[], text, text, text, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.fetch_manager_rankings_retention_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text DEFAULT 'ad_name'::text, p_pack_ids uuid[] DEFAULT NULL::uuid[], p_account_ids text[] DEFAULT NULL::text[], p_campaign_name_contains text DEFAULT NULL::text, p_adset_name_contains text DEFAULT NULL::text, p_ad_name_contains text DEFAULT NULL::text, p_group_key text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    SET plan_cache_mode TO 'force_custom_plan'
    AS $$
declare
  v_group_by text := lower(coalesce(p_group_by, 'ad_name'));
  v_date_start date := least(p_date_start, p_date_stop);
  v_date_stop date := greatest(p_date_start, p_date_stop);
  v_group_key text := trim(coalesce(p_group_key, ''));
  v_result jsonb;
  v_owners uuid[];
  v_requested integer;
begin
  -- p_user_id identifica o ATOR. Assinatura preservada: mudar a lista de
  -- parametros cria ambiguidade de overload no PostgREST (ver migration 095).
  if auth.uid() is distinct from p_user_id then
    raise exception 'Forbidden: p_user_id must match auth.uid()'
      using errcode = '42501';
  end if;

  -- Os donos do dado saem dos packs pedidos. Pack inacessivel nao volta do
  -- resolvedor, e a contagem denuncia: falhar alto e melhor que devolver
  -- agregado silenciosamente incompleto.
  if p_pack_ids is null then
    v_owners := array[p_user_id];
  else
    select array_agg(distinct a.owner_id), count(distinct a.pack_id)
      into v_owners, v_requested
    from public.resolve_pack_access(p_pack_ids, p_user_id) a;

    if coalesce(v_requested, 0) < (select count(distinct x) from unnest(p_pack_ids) x) then
      raise exception 'Forbidden: pack inacessivel na selecao'
        using errcode = '42501';
    end if;

    if v_owners is null or array_length(v_owners, 1) is null then
      v_owners := array[p_user_id];
    end if;
  end if;

  if v_group_by not in ('ad_id', 'ad_name', 'adset_id', 'campaign_id') then
    raise exception 'Invalid p_group_by: %, expected ad_id|ad_name|adset_id|campaign_id', v_group_by
      using errcode = '22023';
  end if;

  if v_group_key = '' then
    return jsonb_build_object('group_key', v_group_key, 'video_play_curve_actions', '[]'::jsonb);
  end if;

  -- P3.2: dirigido pelos DONOS resolvidos, nao filtrado por um user_id escalar.
  -- Medido na RPC principal: `am.user_id = any(v_owners)` faz o planner perder
  -- ad_metric_pack_map_user_pack_date_ad_idx e cair no PK varrendo todos os
  -- user_ids (67ms -> 4010ms). Dirigindo a partir dos donos, o nested loop liga
  -- as 4 colunas do indice composto. O ramo legado (p_pack_ids nulo, sem map
  -- para dirigir) fica no UNION ALL e o planner poda o ramo morto.
  with base_candidates as (
    select am.*
    from public.ad_metrics am
    where p_pack_ids is null
      and am.user_id = p_user_id
      and am.date >= v_date_start
      and am.date <= v_date_stop
      and (p_account_ids is null or am.account_id = any(p_account_ids))
      and (
        p_campaign_name_contains is null
        or p_campaign_name_contains = ''
        or coalesce(am.campaign_name, '') ilike '%' || p_campaign_name_contains || '%'
      )
      and (
        p_adset_name_contains is null
        or p_adset_name_contains = ''
        or coalesce(am.adset_name, '') ilike '%' || p_adset_name_contains || '%'
      )
      and (
        p_ad_name_contains is null
        or p_ad_name_contains = ''
        or coalesce(am.ad_name, '') ilike '%' || p_ad_name_contains || '%'
      )
    union all
    select am.*
    from unnest(v_owners) as o(owner_id)
    join public.ad_metrics am
      on am.user_id = o.owner_id
     and am.pack_id = any(p_pack_ids)
     and am.date >= v_date_start
     and am.date <= v_date_stop
    where p_pack_ids is not null
      and (p_account_ids is null or am.account_id = any(p_account_ids))
      and (
        p_campaign_name_contains is null
        or p_campaign_name_contains = ''
        or coalesce(am.campaign_name, '') ilike '%' || p_campaign_name_contains || '%'
      )
      and (
        p_adset_name_contains is null
        or p_adset_name_contains = ''
        or coalesce(am.adset_name, '') ilike '%' || p_adset_name_contains || '%'
      )
      and (
        p_ad_name_contains is null
        or p_ad_name_contains = ''
        or coalesce(am.ad_name, '') ilike '%' || p_ad_name_contains || '%'
      )
  ),
  -- P3.2: dedup CROSS-SILO. Vence o silo do DONO do pack compartilhado (o ator
  -- perde), desempate por uuid — estavel entre refreshes. Custo zero: o Postgres
  -- ja eliminava user_id da chave de ordenacao por ser constante.
  base as (
    select distinct on (am.ad_id, am.date)
      am.*
    from base_candidates am
    order by
      am.ad_id,
      am.date,
      (am.user_id = p_user_id),
      am.user_id,
      am.updated_at desc nulls last,
      am.created_at desc nulls last,
      am.id desc
  ),
  filtered as (
    select
      case
        when v_group_by = 'ad_id' then am.ad_id
        when v_group_by = 'ad_name' then coalesce(nullif(am.ad_name, ''), am.ad_id)
        when v_group_by = 'adset_id' then am.adset_id
        when v_group_by = 'campaign_id' then am.campaign_id
        else am.ad_id
      end as group_key,
      coalesce(am.video_total_plays, 0)::bigint as plays,
      case when jsonb_typeof(am.video_play_curve_actions) = 'array' then am.video_play_curve_actions else '[]'::jsonb end as curve
    from base am
  ),
  target as (
    select *
    from filtered
    where group_key = v_group_key
  ),
  curve_points as (
    select
      (cv.ord - 1)::integer as idx,
      sum(
        coalesce(
          nullif(regexp_replace(cv.val, '[^0-9.-]', '', 'g'), ''),
          '0'
        )::numeric * t.plays
      )::numeric as weighted_sum,
      sum(t.plays)::numeric as plays_sum
    from target t
    cross join lateral jsonb_array_elements_text(t.curve) with ordinality as cv(val, ord)
    where t.plays > 0
    group by (cv.ord - 1)
  ),
  max_idx as (
    select max(cp.idx) as max_idx
    from curve_points cp
  ),
  curve_out as (
    select
      jsonb_agg(
        coalesce(round(cp.weighted_sum / nullif(cp.plays_sum, 0))::int, 0)
        order by gs.idx
      ) as curve
    from max_idx mx
    cross join lateral generate_series(0, coalesce(mx.max_idx, -1)) as gs(idx)
    left join curve_points cp
      on cp.idx = gs.idx
  )
  select jsonb_build_object(
    'group_key', v_group_key,
    'video_play_curve_actions', coalesce((select curve from curve_out), '[]'::jsonb)
  )
  into v_result;

  return coalesce(v_result, jsonb_build_object('group_key', v_group_key, 'video_play_curve_actions', '[]'::jsonb));
end;
$$;


ALTER FUNCTION public.fetch_manager_rankings_retention_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_group_key text) OWNER TO postgres;

--
-- Name: FUNCTION fetch_manager_rankings_retention_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_group_key text); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.fetch_manager_rankings_retention_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_group_key text) IS 'Manager retention v2 RPC: returns weighted retention curve for one group_key, loaded on demand.';


--
-- Name: fetch_manager_rankings_series_v2(uuid, date, date, text, uuid[], text[], text, text, text, text, text[], integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.fetch_manager_rankings_series_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text DEFAULT 'ad_name'::text, p_pack_ids uuid[] DEFAULT NULL::uuid[], p_account_ids text[] DEFAULT NULL::text[], p_campaign_name_contains text DEFAULT NULL::text, p_adset_name_contains text DEFAULT NULL::text, p_ad_name_contains text DEFAULT NULL::text, p_action_type text DEFAULT NULL::text, p_group_keys text[] DEFAULT NULL::text[], p_window integer DEFAULT 5) RETURNS jsonb
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    SET plan_cache_mode TO 'force_custom_plan'
    AS $$
  select public.fetch_manager_performance_series_v171(
    p_user_id, p_date_start, p_date_stop, p_group_by, p_pack_ids, p_account_ids,
    p_campaign_name_contains, p_adset_name_contains, p_ad_name_contains, p_action_type,
    p_group_keys, p_window
  )
$$;


ALTER FUNCTION public.fetch_manager_rankings_series_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_group_keys text[], p_window integer) OWNER TO postgres;

--
-- Name: FUNCTION fetch_manager_rankings_series_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_group_keys text[], p_window integer); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.fetch_manager_rankings_series_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_group_keys text[], p_window integer) IS 'Wrapper: chama fetch_manager_performance_series_v131 (migration 131, read model + só a janela). Rollback = reaplicar a função da migration 110.';


--
-- Name: fetch_manager_rankings_v161(uuid, date, date, text, uuid[], text[], text, text, text, text, boolean, boolean, integer, integer, text, text, boolean, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.fetch_manager_rankings_v161(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text DEFAULT 'ad_name'::text, p_pack_ids uuid[] DEFAULT NULL::uuid[], p_account_ids text[] DEFAULT NULL::text[], p_campaign_name_contains text DEFAULT NULL::text, p_adset_name_contains text DEFAULT NULL::text, p_ad_name_contains text DEFAULT NULL::text, p_action_type text DEFAULT NULL::text, p_include_leadscore boolean DEFAULT true, p_include_available_conversion_types boolean DEFAULT true, p_limit integer DEFAULT 500, p_offset integer DEFAULT 0, p_order_by text DEFAULT 'spend'::text, p_campaign_id text DEFAULT NULL::text, p_include_custom boolean DEFAULT false, p_thumb_public_prefix text DEFAULT NULL::text) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    SET plan_cache_mode TO 'force_custom_plan'
    SET work_mem TO '32MB'
    SET statement_timeout TO '40s'
    AS $$
declare
  v_group_by text := lower(coalesce(p_group_by, 'ad_name'));
  v_order_by text := lower(coalesce(p_order_by, 'spend'));
  v_date_start date := least(p_date_start, p_date_stop);
  v_date_stop date := greatest(p_date_start, p_date_stop);
  -- (v161) teto 100 mil: o de 10 mil cortava a aba "Por anúncio" em silêncio (26 mil
  -- linhas num caso real). É rede de segurança, não orçamento.
  v_limit integer := greatest(1, least(coalesce(p_limit, 500), 100000));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
  v_selected_key text := trim(coalesce(p_action_type, ''));
  v_key_id integer := null;
  v_include_conv_types boolean := coalesce(p_include_available_conversion_types, true);
  v_include_leads boolean := coalesce(p_include_leadscore, true);
  -- 140: histogramas das colunas vinculadas so quando pedidos (opt-in).
  v_include_custom boolean := coalesce(p_include_custom, false);
  v_result json;
  -- (v161) filtro por campaign_id (antes: fold sobre o JSON pronto, no fim).
  v_campaign text := nullif(btrim(coalesce(p_campaign_id, '')), '');
  -- (v161) espaços que o `str.strip()` do Python removia na hidratação.
  v_ws constant text := E' \t\n\r\x0b\x0c';
  v_owners uuid[];
  v_requested integer;
  -- universo de packs para a máscara: a seleção pedida, ou (ramo legado) todos os
  -- packs do ator. Posição i do array ↔ bit i-1 da máscara.
  v_pack_universe uuid[];
  v_n_packs integer;
begin
  if auth.uid() is distinct from p_user_id then
    raise exception 'Forbidden: p_user_id must match auth.uid()'
      using errcode = '42501';
  end if;

  if p_pack_ids is null then
    v_owners := array[p_user_id];
    select coalesce(array_agg(id order by id), array[]::uuid[])
      into v_pack_universe
    from public.packs where user_id = p_user_id;
  else
    select array_agg(distinct a.owner_id), count(distinct a.pack_id)
      into v_owners, v_requested
    from public.resolve_pack_access(p_pack_ids, p_user_id) a;
    if coalesce(v_requested, 0) < (select count(distinct x) from unnest(p_pack_ids) x) then
      raise exception 'Forbidden: pack inacessivel na selecao'
        using errcode = '42501';
    end if;
    if v_owners is null or array_length(v_owners, 1) is null then
      v_owners := array[p_user_id];
    end if;
    select array_agg(distinct x order by x) into v_pack_universe from unnest(p_pack_ids) x;
  end if;
  v_n_packs := greatest(1, coalesce(cardinality(v_pack_universe), 0));

  if v_group_by not in ('ad_id', 'ad_name', 'adset_id', 'campaign_id') then
    raise exception 'Invalid p_group_by: %, expected ad_id|ad_name|adset_id|campaign_id', v_group_by
      using errcode = '22023';
  end if;

  -- Normalização da chave pedida, idêntica à v116 (sem prefixo = 'conversion:').
  if v_selected_key <> '' and v_selected_key not like 'conversion:%' and v_selected_key not like 'action:%' then
    v_selected_key := 'conversion:' || v_selected_key;
  end if;
  if v_selected_key <> '' then
    -- Chave nunca vista no dicionário = nenhum anúncio tem esse evento → resultados 0,
    -- exatamente como a v116 (nenhum elemento casava).
    select id into v_key_id from public.conversion_keys where key = v_selected_key;
  end if;

  with
  -- 1. A seleção, resolvida no MAPA (índice composto user/pack/date/ad; ~40 B por linha).
  --    GROUP BY (ad_id, dia) faz de uma vez: (a) dedup cross-silo com a MESMA preferência
  --    da v116 — vence o dono do pack compartilhado, o ator perde, desempate por uuid;
  --    (b) dedup de sobreposição entre packs do mesmo dono; (c) sinal de conflito
  --    cross-silo (min <> max do dono); (d) máscara dos packs de origem (bit por pack).
  keys as (
    select
      apm.ad_id,
      apm.date as date,
      apm.user_id,
      false as x_cross_silo,
      set_bit(repeat('0', v_n_packs)::varbit, array_position(v_pack_universe, apm.pack_id) - 1, 1) as pack_mask,
      apm.pack_id
    from unnest(v_owners) as o(owner_id)
    join public.ad_performance_daily apm
      on apm.user_id = o.owner_id
     and apm.pack_id = any(p_pack_ids)
     and apm.date >= v_date_start
     and apm.date <= v_date_stop
    where p_pack_ids is not null

    union all

    -- Ramo legado (sem packs): o silo do ator no período; packs de origem por lookup.
    select
      am.ad_id,
      am.date,
      p_user_id as user_id,
      false as x_cross_silo,
      coalesce(bit_or(set_bit(repeat('0', v_n_packs)::varbit, array_position(v_pack_universe, am.pack_id) - 1, 1)), repeat('0', v_n_packs)::varbit) as pack_mask,
      -- Postgres nao tem min(uuid): "um pack qualquer, deterministico" via array_agg ordenado.
      (array_agg(am.pack_id order by am.pack_id))[1] as pack_id
    from public.ad_performance_daily am
    where p_pack_ids is null
      and am.user_id = p_user_id
      and am.date >= v_date_start
      and am.date <= v_date_stop
    group by am.ad_id, am.date
  ),
  -- 1b. (v155) Inventário: anúncio ativo no período (o intervalo first/last_active_date
  --     cruza a janela) SEM linha de métrica neste (silo, pack) no período. Substitui as
  --     linhas-zero que o refresh gravava em ad_metrics. Uma linha por (silo, pack,
  --     anúncio), zerada: somar zero não muda soma, a contagem é count(distinct ad_id) e
  --     o representante é o de maior impressão (a linha zerada perde para qualquer real,
  --     ver rep_enc). O anti-join vai ao read model pela PK, não a `keys`: no ramo
  --     legado `keys` guarda um pack só por anúncio-dia.
  inv as (
    select i.user_id, i.pack_id, i.ad_id, i.account_id, i.campaign_id, i.campaign_name,
           i.adset_id, i.adset_name, i.ad_name
    from unnest(v_owners) as o(owner_id)
    join public.ad_pack_inventory i
      on i.user_id = o.owner_id
     and i.pack_id = any(v_pack_universe)
     and i.first_active_date <= v_date_stop
     and i.last_active_date >= v_date_start
    where not exists (
      select 1 from public.ad_performance_daily d
      where d.user_id = i.user_id and d.pack_id = i.pack_id and d.ad_id = i.ad_id
        and d.date >= v_date_start and d.date <= v_date_stop
    )
  ),
  -- 2. As linhas: SÓ o read model (ad_performance_daily, migration 129), pela chave
  --    única. ad_metrics não entra aqui — entra só para a linha representante (fim) e
  --    para filtros por nome de campanha/conjunto (EXISTS abaixo, podado quando o
  --    filtro está vazio: o predicado é constante sob force_custom_plan).
  sel as (
    select
      k.user_id,
      k.ad_id,
      k.date,
      k.pack_mask,
      k.pack_id,
      case
        when v_group_by = 'ad_id' then d.ad_id
        when v_group_by = 'ad_name' then coalesce(nullif(d.ad_name, ''), d.ad_id)
        when v_group_by = 'adset_id' then d.adset_id
        when v_group_by = 'campaign_id' then d.campaign_id
        else d.ad_id
      end as group_key,
      -- Só o que a agregação consome. Nomes de campanha/conjunto NÃO viajam por
      -- linha: saem da linha REPRESENTANTE no fim (77 lookups em ad_metrics).
      d.account_id,
      d.adset_id,
      d.campaign_id,
      d.impressions,
      d.clicks,
      d.inline_link_clicks,
      d.spend,
      d.lpv,
      d.plays,
      d.thruplays,
      d.video_watched_p50,
      d.video_watched_p75,
      d.hold_rate,
      d.reach,
      d.frequency,
      d.hook_value,
      d.scroll_stop_value,
      -- conversão pedida por posição no array (leads: CTE próprio, leads_by_group)
      coalesce(d.conv_values[array_position(d.conv_key_ids, v_key_id)], 0)::numeric as results
    from keys k
    join public.ad_performance_daily d on d.user_id = k.user_id and d.pack_id = k.pack_id and d.ad_id = k.ad_id and d.date = k.date
    where (p_account_ids is null or d.account_id = any(p_account_ids))
      and (p_ad_name_contains is null or p_ad_name_contains = ''
           or coalesce(d.ad_name, '') ilike '%' || p_ad_name_contains || '%')
      and (
        (coalesce(p_campaign_name_contains, '') = '' and coalesce(p_adset_name_contains, '') = '')
        or exists (
          select 1 from public.ad_metrics am where am.user_id = k.user_id and am.pack_id = k.pack_id and am.ad_id = k.ad_id and am.date = k.date
            and (coalesce(p_campaign_name_contains, '') = ''
                 or coalesce(am.campaign_name, '') ilike '%' || p_campaign_name_contains || '%')
            and (coalesce(p_adset_name_contains, '') = ''
                 or coalesce(am.adset_name, '') ilike '%' || p_adset_name_contains || '%')
        )
      )

    union all

    -- (v155) O inventário, zerado. Identidade e nomes vêm da própria linha (os mais
    -- recentes que o refresh viu); os filtros usam esses mesmos campos. `date` nulo:
    -- a linha não é um dia, e o rep_enc a põe abaixo de qualquer dia real.
    select
      i.user_id,
      i.ad_id,
      null::date as date,
      set_bit(repeat('0', v_n_packs)::varbit, array_position(v_pack_universe, i.pack_id) - 1, 1) as pack_mask,
      i.pack_id,
      case
        when v_group_by = 'ad_id' then i.ad_id
        when v_group_by = 'ad_name' then coalesce(nullif(i.ad_name, ''), i.ad_id)
        when v_group_by = 'adset_id' then i.adset_id
        when v_group_by = 'campaign_id' then i.campaign_id
        else i.ad_id
      end as group_key,
      i.account_id,
      i.adset_id,
      i.campaign_id,
      0::bigint as impressions,
      0::bigint as clicks,
      0::bigint as inline_link_clicks,
      0::numeric as spend,
      0::bigint as lpv,
      0::bigint as plays,
      0::bigint as thruplays,
      0::numeric as video_watched_p50,
      0::numeric as video_watched_p75,
      0::numeric as hold_rate,
      0::bigint as reach,
      0::numeric as frequency,
      0::numeric as hook_value,
      0::numeric as scroll_stop_value,
      0::numeric as results
    from inv i
    where (p_account_ids is null or i.account_id = any(p_account_ids))
      and (p_ad_name_contains is null or p_ad_name_contains = ''
           or coalesce(i.ad_name, '') ilike '%' || p_ad_name_contains || '%')
      and (coalesce(p_campaign_name_contains, '') = ''
           or coalesce(i.campaign_name, '') ilike '%' || p_campaign_name_contains || '%')
      and (coalesce(p_adset_name_contains, '') = ''
           or coalesce(i.adset_name, '') ilike '%' || p_adset_name_contains || '%')
  ),
  -- `coalesce(x,'') <> ''` e não `nullif(x,'') is not null`: mesma semântica, mas o
  -- planner dá seletividade ~1 ao `<>` e 0,005 ao `is not null` sobre expressão —
  -- com 0,005 ele estimava 1 linha aqui e escolhia agregação por ordenação (spill).
  filtered as (
    select * from sel where coalesce(group_key, '') <> ''
  ),
  -- 3. Anúncio-dia → anúncio (por silo). Só agregados de estado constante.
  per_ad as (
    select
      f.group_key,
      f.user_id,
      f.ad_id,
      sum(f.impressions)::bigint as impressions,
      sum(f.clicks)::bigint as clicks,
      sum(f.inline_link_clicks)::bigint as inline_link_clicks,
      sum(f.spend)::numeric as spend,
      sum(f.lpv)::bigint as lpv,
      sum(f.plays)::bigint as plays,
      sum(f.thruplays)::bigint as thruplays,
      sum(f.hook_value * f.plays)::numeric as hook_wsum,
      sum(f.hold_rate * f.plays)::numeric as hold_rate_wsum,
      sum(f.video_watched_p50 * f.plays)::numeric as video_watched_p50_wsum,
      sum(f.video_watched_p75 * f.plays)::numeric as video_watched_p75_wsum,
      sum(f.scroll_stop_value * f.plays)::numeric as scroll_stop_wsum,
      sum(f.reach)::bigint as reach,
      sum(f.frequency * f.impressions)::numeric as frequency_wsum,
      sum(f.results)::numeric as results,
      -- um anúncio pertence a UMA conta e a UM conjunto: min() é exato
      min(nullif(f.account_id, '')) as account_id,
      min(nullif(f.adset_id, '')) as adset_id,
      min(nullif(f.campaign_id, '')) as campaign_id,
      bit_or(f.pack_mask) as pack_mask,
      -- dia representante deste anúncio: max impressões (desempate: dia mais recente)
      max((lpad(f.impressions::text, 12, '0') || e'\x1f' || coalesce(f.date::text, '') || e'\x1f' || f.pack_id::text) collate "C") as rep_enc
    from filtered f
    group by f.group_key, f.user_id, f.ad_id
  ),
  -- 4. Um lookup em `ads` por anúncio (índice de cobertura ads_user_ad_status_idx).
  per_ad_status as (
    select
      pa.*,
      a.effective_status,
      a.meta_created_time,
      a.thumb_storage_path
    from per_ad pa
    left join public.ads a
      on a.user_id = pa.user_id
     and a.ad_id = pa.ad_id
  ),
  -- 5. Anúncio → grupo.
  grp as (
    select
      p.group_key,
      sum(p.impressions)::bigint as impressions,
      sum(p.clicks)::bigint as clicks,
      sum(p.inline_link_clicks)::bigint as inline_link_clicks,
      sum(p.spend)::numeric as spend,
      sum(p.lpv)::bigint as lpv,
      sum(p.plays)::bigint as plays,
      sum(p.thruplays)::bigint as thruplays,
      sum(p.hook_wsum)::numeric as hook_wsum,
      sum(p.hold_rate_wsum)::numeric as hold_rate_wsum,
      sum(p.video_watched_p50_wsum)::numeric as video_watched_p50_wsum,
      sum(p.video_watched_p75_wsum)::numeric as video_watched_p75_wsum,
      sum(p.scroll_stop_wsum)::numeric as scroll_stop_wsum,
      sum(p.reach)::bigint as reach,
      sum(p.frequency_wsum)::numeric as frequency_wsum,
      sum(p.results)::numeric as results,
      count(distinct p.ad_id)::integer as ad_id_count,
      count(distinct p.adset_id)::integer as adset_count,
      coalesce(array_agg(distinct p.account_id) filter (where p.account_id is not null), array[]::text[]) as account_ids,
      -- v136/137: TODAS as campanhas e conjuntos do grupo, nao a do representante.
      -- Mesma passada do account_ids: mesmo group by, nenhuma leitura nova.
      coalesce(array_agg(distinct p.campaign_id) filter (where p.campaign_id is not null), array[]::text[]) as campaign_ids,
      coalesce(array_agg(distinct p.adset_id) filter (where p.adset_id is not null), array[]::text[]) as adset_ids,
      bit_or(p.pack_mask) as pack_mask,
      -- representante do grupo = (impressões do dia rep, ad_id) máximos — a ordem
      -- (impressions desc, ad_id desc) da v116; user_id e os campos vão de carona.
      max((substr(p.rep_enc, 1, 12) || e'\x1f' || p.ad_id || e'\x1f' || p.user_id::text
           || e'\x1f' || p.rep_enc) collate "C") as rep_enc,
      bool_or(upper(coalesce(p.effective_status, '')) = 'ACTIVE') as has_active,
      count(distinct p.ad_id) filter (where upper(coalesce(p.effective_status, '')) = 'ACTIVE')::integer as active_count,
      -- v138: por que o grupo esta parado. `fallback_status` (o min alfabetico logo
      -- abaixo) responde "algum anuncio esta assim, e foi o primeiro do alfabeto" -
      -- por isso um criativo com um anuncio arquivado aparece como ARCHIVED. Contar
      -- permite a pergunta certa: TODOS estao pausados pelo mesmo motivo?
      -- Mesma passada e mesmo group by do active_count: nenhuma leitura nova.
      count(distinct p.ad_id) filter (where upper(coalesce(p.effective_status, '')) = 'PAUSED')::integer as paused_self_count,
      count(distinct p.ad_id) filter (where upper(coalesce(p.effective_status, '')) = 'ADSET_PAUSED')::integer as adset_paused_count,
      count(distinct p.ad_id) filter (where upper(coalesce(p.effective_status, '')) = 'CAMPAIGN_PAUSED')::integer as campaign_paused_count,
      min(p.effective_status) filter (where nullif(p.effective_status, '') is not null) as fallback_status,
      min(p.meta_created_time) as meta_created_min,
      -- fallback de miniatura: qualquer anúncio do grupo com arquivo no Storage
      -- (medido: 13 de 3.451 criativos têm o representante sem e uma cópia com)
      max(p.thumb_storage_path) filter (where nullif(p.thumb_storage_path, '') is not null) as any_thumb_storage_path
    from per_ad_status p
    group by p.group_key
  ),
  -- Leads: CTE próprio e ESTREITO. Só 23% dos anúncio-dias têm leads; parte do
  -- rollup (sem JSON), busca em ad_metrics só o necessário para o group_key e os
  -- filtros, e soma o histograma por (grupo, score). Fora da passada principal
  -- para não carregar JSON por duas camadas de agregação. MATERIALIZED: referenciado
  -- uma vez, o planner o inlinaria como lado interno de um nested loop e o
  -- recalcularia por grupo (medido: 397 execuções, 4,4 s).
  leads_by_group as materialized (
    select
      x.group_key,
      jsonb_object_agg(trim_scale(x.score)::text, x.qty order by x.score) as leadscore_histogram
    from (
      select
        case
          when v_group_by = 'ad_id' then d.ad_id
          when v_group_by = 'ad_name' then coalesce(nullif(d.ad_name, ''), d.ad_id)
          when v_group_by = 'adset_id' then d.adset_id
          when v_group_by = 'campaign_id' then d.campaign_id
          else d.ad_id
        end as group_key,
        s.score,
        sum(s.qty)::integer as qty
      from keys k
      join public.ad_performance_daily d on d.user_id = k.user_id and d.pack_id = k.pack_id and d.ad_id = k.ad_id and d.date = k.date
      cross join lateral unnest(d.lead_scores, d.lead_qtys) as s(score, qty)
      where v_include_leads
        and cardinality(d.lead_scores) > 0
        and (p_account_ids is null or d.account_id = any(p_account_ids))
        and (p_ad_name_contains is null or p_ad_name_contains = ''
             or coalesce(d.ad_name, '') ilike '%' || p_ad_name_contains || '%')
        and (
          (coalesce(p_campaign_name_contains, '') = '' and coalesce(p_adset_name_contains, '') = '')
          or exists (
            select 1 from public.ad_metrics am where am.user_id = k.user_id and am.pack_id = k.pack_id and am.ad_id = k.ad_id and am.date = k.date
              and (coalesce(p_campaign_name_contains, '') = ''
                   or coalesce(am.campaign_name, '') ilike '%' || p_campaign_name_contains || '%')
              and (coalesce(p_adset_name_contains, '') = ''
                   or coalesce(am.adset_name, '') ilike '%' || p_adset_name_contains || '%')
          )
        )
      group by 1, s.score
    ) x
    where coalesce(x.group_key, '') <> ''
    group by x.group_key
  ),
  -- 140: histogramas das colunas vinculadas, somados por (grupo, vinculo, valor).
  -- Mesma forma do leads_by_group: CTE estreito, MATERIALIZED, mesmos filtros, e
  -- opt-in por p_include_custom. Quem nao vincula coluna nenhuma tem a coluna nula
  -- e o frontend nem pede: custo zero fora do caso de uso.
  custom_by_group as materialized (
    select
      y.group_key,
      jsonb_object_agg(y.mapping_id, y.hist) as custom_histograms
    from (
      select x.group_key, x.mapping_id, jsonb_object_agg(x.val, x.qty) as hist
      from (
        select
          case
            when v_group_by = 'ad_id' then d.ad_id
            when v_group_by = 'ad_name' then coalesce(nullif(d.ad_name, ''), d.ad_id)
            when v_group_by = 'adset_id' then d.adset_id
            when v_group_by = 'campaign_id' then d.campaign_id
            else d.ad_id
          end as group_key,
          m.key as mapping_id,
          v.key as val,
          sum(v.value::bigint)::bigint as qty
        from keys k
        join public.ad_performance_daily d on d.user_id = k.user_id and d.pack_id = k.pack_id and d.ad_id = k.ad_id and d.date = k.date
        cross join lateral jsonb_each(d.custom_hist) as m(key, value)
        cross join lateral jsonb_each_text(m.value) as v(key, value)
        where v_include_custom
          and d.custom_hist is not null
          and (p_account_ids is null or d.account_id = any(p_account_ids))
          and (p_ad_name_contains is null or p_ad_name_contains = ''
               or coalesce(d.ad_name, '') ilike '%' || p_ad_name_contains || '%')
          and (
            (coalesce(p_campaign_name_contains, '') = '' and coalesce(p_adset_name_contains, '') = '')
            or exists (
              select 1 from public.ad_metrics am where am.user_id = k.user_id and am.pack_id = k.pack_id and am.ad_id = k.ad_id and am.date = k.date
                and (coalesce(p_campaign_name_contains, '') = ''
                     or coalesce(am.campaign_name, '') ilike '%' || p_campaign_name_contains || '%')
                and (coalesce(p_adset_name_contains, '') = ''
                     or coalesce(am.adset_name, '') ilike '%' || p_adset_name_contains || '%')
            )
          )
        group by 1, m.key, v.key
      ) x
      where coalesce(x.group_key, '') <> ''
      group by x.group_key, x.mapping_id
    ) y
    group by y.group_key
  ),
  -- 6. Enriquecimento por grupo (~77 linhas): representante em `ads`, tags do ATOR,
  --    packs da máscara, histograma de leads.
  -- Decodifica o representante (posições da chave: 1 impressões | 2 ad_id | 3 user_id
  -- | 4 impressões do dia | 5 date) e busca a LINHA representante em ad_metrics para
  -- os nomes — 77 lookups pela chave única, em vez de carregar nomes em 42 mil linhas.
  -- `collate "default"`: a chave é comparada em "C"; os pedaços voltam à colação das
  -- colunas, senão o `=` contra ads/ad_metrics não usa índice (medido: bitmap scan
  -- de 21 mil linhas por grupo).
  grp_dec as (
    select
      g.*,
      (split_part(g.rep_enc, e'\x1f', 2) collate "default") as rep_ad_id,
      (split_part(g.rep_enc, e'\x1f', 3))::uuid as rep_user_id,
      nullif(split_part(g.rep_enc, e'\x1f', 5), '')::date as rep_date,
      nullif(split_part(g.rep_enc, e'\x1f', 6), '')::uuid as rep_pack_id
    from grp g
  ),
  grp_rep as (
    select
      g.*,
      -- (v155) representante sem dia (só inventário): nomes da linha do inventário.
      case when g.rep_date is null then ri.ad_name when ra.ad_id is not null then ra.ad_name else am.ad_name end as rep_ad_name,
      case when g.rep_date is null then ri.account_id when ra.ad_id is not null then ra.account_id else am.account_id end as rep_account_id,
      case when g.rep_date is null then ri.campaign_id when ra.ad_id is not null then ra.campaign_id else am.campaign_id end as rep_campaign_id,
      case when g.rep_date is null then ri.campaign_name when ra.ad_id is not null then ra.campaign_name else am.campaign_name end as rep_campaign_name,
      case when g.rep_date is null then ri.adset_id when ra.ad_id is not null then ra.adset_id else am.adset_id end as rep_adset_id,
      case when g.rep_date is null then ri.adset_name when ra.ad_id is not null then ra.adset_name else am.adset_name end as rep_adset_name,
      -- (v161) a chave por NOME das buscas de mídia/transcrição/tags (antes, dentro
      -- de cada lateral).
      coalesce(nullif(case when g.rep_date is null then ri.ad_name when ra.ad_id is not null then ra.ad_name else am.ad_name end, ''), g.rep_ad_id) as name_key,
      -- (v161) o que o enriquecimento lia de `ads` numa SEGUNDA busca pelo mesmo anúncio
      ra.effective_status as ra_effective_status,
      ra.thumbnail_url as ra_thumbnail_url,
      ra.adcreatives_videos_thumbs as ra_adcreatives_videos_thumbs,
      ra.thumb_storage_path as ra_thumb_storage_path,
      -- (v161) pares id -> nome já lidos, para o dicionário `names` (ver names_payload)
      ra.campaign_id as ra_campaign_id,
      ra.campaign_name as ra_campaign_name,
      ra.adset_id as ra_adset_id,
      ra.adset_name as ra_adset_name
    from grp_dec g
    -- (v161) Os nomes do representante vêm da linha de `ads`, e não mais da linha do
    -- DIA em `ad_metrics`. Em produção esta leitura era o maior custo da consulta:
    -- 26 mil buscas aleatórias numa tabela larga, 12.665 páginas (≈99 MB) do disco por
    -- requisição numa instância com 256 MB de memória — 12,4 s de 29 s. As duas fontes
    -- são IGUAIS hoje: medido em 16/09 sobre todo o banco, nenhum dos 58.499 anúncios
    -- teve mais de um nome de campanha/conjunto/anúncio, e o mais recente bate com
    -- `ads` em todos. Num renome futuro, a linha passa a mostrar o nome ATUAL — o mesmo
    -- do dicionário `names`, que já vinha de `ads`.
    -- `ad_metrics` fica só para o anúncio sem linha em `ads` (nenhum hoje); o filtro sem
    -- coluna da tabela vira One-Time Filter e a busca nem acontece.
    left join public.ads ra
      on ra.user_id = g.rep_user_id
     and ra.ad_id = g.rep_ad_id
    left join lateral (
      select m.ad_name, m.account_id, m.campaign_id, m.campaign_name, m.adset_id, m.adset_name
      from public.ad_metrics m
      where g.rep_date is not null
        and ra.ad_id is null
        and m.user_id = g.rep_user_id and m.pack_id = g.rep_pack_id
        and m.ad_id = g.rep_ad_id and m.date = g.rep_date
      -- `limit 1` não muda o resultado (a PK garante no máximo uma linha): impede o
      -- planner de achatar a subconsulta numa junção comum. Achatada, a condição
      -- `ra.ad_id is null` virava filtro DEPOIS da busca, e as 26 mil buscas
      -- continuavam (medido em produção, 16/09: 5,2 s e 10 mil páginas do disco).
      -- Com o limit, ela vira One-Time Filter e a busca não acontece.
      limit 1
    ) am on true
    left join lateral (
      -- O anúncio pode estar no inventário de mais de um pack da seleção: vale o que
      -- esteve ativo por último (a mesma regra da linha-zero mais recente de antes).
      select i.ad_name, i.account_id, i.campaign_id, i.campaign_name, i.adset_id, i.adset_name
      from public.ad_pack_inventory i
      where g.rep_date is null
        and i.user_id = g.rep_user_id
        and i.pack_id = any(coalesce(p_pack_ids, v_pack_universe))
        and i.ad_id = g.rep_ad_id
      order by i.last_active_date desc, i.pack_id
      limit 1
    ) ri on true
  ),
  -- (v161) A ORDEM, calculada sobre `grp` — as somas, sem nomes, miniaturas nem
  -- histogramas. A v155 ordenava as linhas LARGAS (1,7 KB cada) e depois as copiava
  -- de novo para numerar e paginar: medido em produção (16/09, 51 mil linhas), duas
  -- ordenações de 75–80 MB escritas em disco a cada requisição. Aqui a posição de
  -- cada grupo vira um dicionário {group_key: posição}; as linhas largas não são
  -- ordenadas por ninguém — a saída leva a posição numa coluna (`row_order`) e o
  -- leitor as põe na ordem.
  -- Mesmas expressões e mesmo desempate (group_key) do `ordered` da v155, sobre os
  -- mesmos valores (as métricas de `rows_metrics` são essas fórmulas sobre `grp`).
  ranked as (
    select
      g.group_key,
      row_number() over (
        order by
          case when v_order_by = 'cpr' then d.cpr end asc nulls last,
          case when v_order_by = 'hook' then d.hook end desc nulls last,
          case when v_order_by = 'hold_rate' then d.hold_rate end desc nulls last,
          case when v_order_by = 'spend' then g.spend end desc nulls last,
          case when v_order_by = 'ctr' then d.ctr end desc nulls last,
          case when v_order_by = 'connect_rate' then d.connect_rate end desc nulls last,
          case when v_order_by = 'page_conv' then d.page_conv end desc nulls last,
          case when v_order_by = 'cpm' then d.cpm end desc nulls last,
          case when v_order_by = 'website_ctr' then d.website_ctr end desc nulls last,
          case when v_order_by = 'results' then g.results end desc nulls last,
          case
            when v_order_by not in ('cpr', 'hook', 'hold_rate', 'spend', 'ctr', 'connect_rate', 'page_conv', 'cpm', 'website_ctr', 'results')
            then g.spend
          end desc nulls last,
          g.group_key
      ) as ord
    from grp g
    cross join lateral (
      select
        case when g.results > 0 then g.spend / g.results else 0 end as cpr,
        case when g.plays > 0 then g.hook_wsum / g.plays else 0 end as hook,
        case when g.plays > 0 then g.hold_rate_wsum / g.plays else 0 end as hold_rate,
        case when g.impressions > 0 then g.clicks::numeric / g.impressions else 0 end as ctr,
        case when g.inline_link_clicks > 0 then g.lpv::numeric / g.inline_link_clicks else 0 end as connect_rate,
        case when g.lpv > 0 then g.results / g.lpv else 0 end as page_conv,
        case when g.impressions > 0 then (g.spend * 1000.0) / g.impressions else 0 end as cpm,
        case when g.impressions > 0 then g.inline_link_clicks::numeric / g.impressions else 0 end as website_ctr
    ) d
  ),
  rank_dict as (
    select coalesce(jsonb_object_agg(r.group_key, r.ord), '{}'::jsonb) as m
    from ranked r
  ),
  -- (v161) UMA passada pelos representantes para tudo que é por nome: os nomes a
  -- buscar (mídia/transcrição/tags) e os pares id -> nome que as linhas já trouxeram
  -- de `ads` (dicionário `names`). Cada leitura extra de `grp_rep` relia do disco a
  -- cópia dela (40 MB com 26 mil linhas).
  -- Pares por `jsonb_object_agg`: com id repetido fica um dos nomes — e um id tem um
  -- nome só (conferido em 16/09 sobre todo o banco: nenhuma das 2.719 campanhas e dos
  -- 8.086 conjuntos tem dois nomes entre os anúncios).
  rep_scan as materialized (
    select
      array_agg(distinct g.name_key) filter (
        where v_group_by in ('ad_name', 'ad_id') and g.name_key is not null
      ) as name_keys,
      coalesce(jsonb_object_agg(g.ra_campaign_id, g.ra_campaign_name) filter (
        where g.ra_campaign_id is not null and nullif(g.ra_campaign_name, '') is not null
      ), '{}'::jsonb) as campaign_names,
      coalesce(jsonb_object_agg(g.ra_adset_id, g.ra_adset_name) filter (
        where g.ra_adset_id is not null and nullif(g.ra_adset_name, '') is not null
      ), '{}'::jsonb) as adset_names
    from grp_rep g
  ),
  -- (v161) Mídia, transcrição e tags dependem só do NOME. Nas laterais da v155 cada
  -- linha relia todos os anúncios irmãos: no nível por anúncio isso é N² (medido em
  -- 16/09: 26 mil linhas x 353 irmãos = 9 milhões de leituras, ~9 s). Aqui cada nome
  -- é lido uma vez e juntado por igualdade.
  name_keys as materialized (
    select unnest(rs.name_keys) as name_key
    from rep_scan rs
  ),
  mt_by_name as materialized (
    select a.ad_name as name_key,
           case max(case a.media_type when 'video' then 2 when 'image' then 1 end)
             when 2 then 'video' when 1 then 'image' end as media_type
    from name_keys n
    join public.ads a
      on a.user_id = any(v_owners)
     and a.ad_name = n.name_key
    group by a.ad_name
  ),
  tr_by_name as materialized (
    -- 142: estado da mídia (transcrito / sem áudio); ver a v155 para o porquê.
    select t.ad_name as name_key,
           bool_or(t.status = 'completed') as has_transcription,
           bool_or(t.status = 'failed' and coalesce(t.metadata ->> 'no_voice_detected', '') = 'true') as no_audio
    from name_keys n
    join public.ad_transcriptions t
      on t.user_id = any(v_owners)
     and t.ad_name = n.name_key
    group by t.ad_name
  ),
  tg_by_name as materialized (
    -- v139: tags do SILO DO PACK.
    select atg.ad_name as name_key,
           jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'color', t.color) order by t.name, t.id) as tags
    from name_keys n
    join public.ad_tags atg
      on atg.user_id = any(v_owners)
     and atg.ad_name = n.name_key
    join public.tags t on t.id = atg.tag_id and t.user_id = atg.user_id
    group by atg.ad_name
  ),
  -- (v161) DICIONÁRIOS em vez de junções. Juntar uma CTE com outra deixa o plano
  -- à mercê da estimativa (1 linha para tudo que deriva da seleção): no laboratório,
  -- em 16/09, a mera troca de estimativa fez `leads_by_group` ser relido INTEIRO para
  -- cada linha (14.886 x 4.522 = 67 milhões de linhas, ~15 s). A v155 só escapava
  -- porque o plano sorteado era outro. Um objeto {chave: valor} montado uma vez e lido
  -- por subconsulta escalar não depende de estimativa nenhuma (o mesmo `ck` da 157).
  name_dict as (
    select coalesce(jsonb_object_agg(s.name_key, s.o), '{}'::jsonb) as m
    from (
      select p.name_key, jsonb_object_agg(p.kind, p.v) as o
      from (
        select name_key, 'mt'::text as kind, to_jsonb(media_type) as v from mt_by_name
        union all
        select name_key, 'ht', to_jsonb(has_transcription) from tr_by_name
        union all
        select name_key, 'na', to_jsonb(no_audio) from tr_by_name
        union all
        select name_key, 'tg', tags from tg_by_name
      ) p
      group by p.name_key
    ) s
  ),
  leads_dict as (
    select coalesce(jsonb_object_agg(l.group_key, l.leadscore_histogram), '{}'::jsonb) as m
    from leads_by_group l
  ),
  custom_dict as (
    select coalesce(jsonb_object_agg(c.group_key, c.custom_histograms), '{}'::jsonb) as m
    from custom_by_group c
  ),
  rows_enriched as (
    select
      g.group_key,
      g.rep_account_id as account_id,
      g.account_ids,
      g.campaign_ids,
      g.adset_ids,
      coalesce((
        select array_agg(v_pack_universe[i] order by i)
        from generate_series(1, v_n_packs) i
        where get_bit(g.pack_mask, i - 1) = 1
      ), array[]::uuid[]) as pack_ids,
      g.rep_campaign_id as campaign_id,
      g.rep_campaign_name as campaign_name,
      g.rep_adset_id as adset_id,
      g.rep_adset_name as adset_name,
      g.rep_ad_id,
      g.rep_ad_name,
      nd.ord,
      case
        when v_group_by = 'campaign_id' then coalesce(nullif(g.rep_campaign_name, ''), g.group_key)
        when v_group_by = 'adset_id' then coalesce(nullif(g.rep_adset_name, ''), g.group_key)
        else coalesce(nullif(g.rep_ad_name, ''), g.rep_ad_id)
      end as label_name,
      case
        when v_group_by = 'campaign_id' then null
        when coalesce(g.has_active, false) then 'ACTIVE'
        else coalesce(g.fallback_status, g.ra_effective_status)
      end as effective_status,
      case
        when v_group_by = 'campaign_id' then null
        else coalesce(g.active_count, 0)
      end as active_count,
      -- Contadores de motivo SO nas abas que agregam anuncios. Em conjunto e
      -- campanha a linha E a propria entidade, e o status dela vem de
      -- `parent_entities` (o estado do Meta) - mandar contadores la faria a tela
      -- classificar um CONJUNTO pausado como "pausado pelo conjunto", que e a
      -- resposta certa para o anuncio e errada para o conjunto. A ausencia e o
      -- sinal: sem contadores, a tela le `effective_status` direto.
      case when v_group_by in ('ad_name', 'ad_id') then coalesce(g.paused_self_count, 0) end as paused_self_count,
      case when v_group_by in ('ad_name', 'ad_id') then coalesce(g.adset_paused_count, 0) end as adset_paused_count,
      case when v_group_by in ('ad_name', 'ad_id') then coalesce(g.campaign_paused_count, 0) end as campaign_paused_count,
      g.impressions, g.clicks, g.inline_link_clicks, g.spend, g.lpv, g.plays, g.thruplays,
      g.hook_wsum, g.hold_rate_wsum, g.video_watched_p50_wsum, g.video_watched_p75_wsum,
      g.scroll_stop_wsum, g.reach, g.frequency_wsum,
      case when v_group_by = 'campaign_id' then g.adset_count else g.ad_id_count end as ad_count,
      -- Chave do histograma normalizada (80.0 → "80"); a v116 mandava o array cru.
      coalesce(nd.lh, '{}'::jsonb) as leadscore_histogram,
      -- 140: {"<mapping_id>": {"<valor>": quantidade}}; {} quando nao pedido ou sem dado.
      coalesce(nd.ch, '{}'::jsonb) as custom_histograms,
      g.results,
      g.meta_created_min,
      coalesce(nullif(g.ra_thumbnail_url, ''), nullif(g.ra_adcreatives_videos_thumbs ->> 0, '')) as thumbnail,
      g.ra_adcreatives_videos_thumbs as adcreatives_videos_thumbs,
      coalesce(nullif(g.ra_thumb_storage_path, ''), g.any_thumb_storage_path) as thumb_storage_path,
      coalesce(nd.o -> 'tg', '[]'::jsonb) as tags,
      -- v132: o que a rota hidratava com 15 requisições e 13,7 mil linhas por carga
      -- (medido) agora vem daqui. Só nos níveis de criativo/anúncio, como a hidratação
      -- fazia (num nível de conjunto/campanha o "ad_name" é o nome do pai).
      -- media_type = maior precedência entre as cópias do nome (vídeo > imagem; 'unknown'
      -- e NULL ignorados) — a semântica exata de _hydrate_media_type_for_rankings_rows.
      case
        when v_group_by in ('ad_name', 'ad_id') then nd.o ->> 'mt'
        else null
      end as media_type,
      case
        when v_group_by in ('ad_name', 'ad_id') then coalesce((nd.o ->> 'ht')::boolean, false)
        else false
      end as has_transcription,
      -- Transcrito GANHA de sem-audio: num pack compartilhado os dois silos podem ter
      -- registros diferentes para o mesmo ad_name, e o texto que existe de fato vale
      -- mais do que a falha registrada no silo vizinho.
      case
        when v_group_by in ('ad_name', 'ad_id')
          then coalesce((nd.o ->> 'na')::boolean, false) and not coalesce((nd.o ->> 'ht')::boolean, false)
        else false
      end as transcription_no_audio
    from grp_rep g
    -- (v161) uma leitura por linha em cada dicionário; as subconsultas escalares
    -- não dependem da linha e rodam uma vez só.
    cross join lateral (
      select
        (select d.m from name_dict d) -> g.name_key as o,
        (select d.m from leads_dict d) -> g.group_key as lh,
        (select d.m from custom_dict d) -> g.group_key as ch,
        ((select d.m from rank_dict d) ->> g.group_key)::integer as ord
    ) nd
  ),
  rows_metrics as (
    select
      re.*,
      case when re.plays > 0 then re.hook_wsum / re.plays else 0 end as hook,
      case when re.plays > 0 then re.hold_rate_wsum / re.plays else 0 end as hold_rate,
      round(case when re.plays > 0 then re.video_watched_p50_wsum / re.plays else 0 end)::int as video_watched_p50,
      round(case when re.plays > 0 then re.video_watched_p75_wsum / re.plays else 0 end)::int as video_watched_p75,
      case when re.plays > 0 then re.scroll_stop_wsum / re.plays else 0 end as scroll_stop,
      case when re.impressions > 0 then re.clicks::numeric / re.impressions else 0 end as ctr,
      case when re.inline_link_clicks > 0 then re.lpv::numeric / re.inline_link_clicks else 0 end as connect_rate,
      case when re.impressions > 0 then (re.spend * 1000.0) / re.impressions else 0 end as cpm,
      case when re.impressions > 0 then re.inline_link_clicks::numeric / re.impressions else 0 end as website_ctr,
      case when re.impressions > 0 then re.frequency_wsum / re.impressions else 0 end as frequency,
      case when re.results > 0 then re.spend / re.results else 0 end as cpr,
      case when re.lpv > 0 then re.results / re.lpv else 0 end as page_conv,
      case when v_selected_key <> '' then jsonb_build_object(v_selected_key, re.results) else '{}'::jsonb end as conversions
    from rows_enriched re
  ),
  totals as (
    select
      coalesce(sum(rm.spend), 0)::numeric as total_spend,
      coalesce(sum(rm.impressions), 0)::bigint as total_impressions,
      coalesce(sum(rm.clicks), 0)::bigint as total_clicks,
      coalesce(sum(rm.inline_link_clicks), 0)::bigint as total_inline,
      coalesce(sum(rm.lpv), 0)::bigint as total_lpv,
      coalesce(sum(rm.plays), 0)::bigint as total_plays,
      coalesce(sum(rm.hook_wsum), 0)::numeric as total_hook_wsum,
      coalesce(sum(rm.hold_rate_wsum), 0)::numeric as total_hold_rate_wsum,
      coalesce(sum(rm.video_watched_p50_wsum), 0)::numeric as total_video_watched_p50_wsum,
      coalesce(sum(rm.video_watched_p75_wsum), 0)::numeric as total_video_watched_p75_wsum,
      coalesce(sum(rm.scroll_stop_wsum), 0)::numeric as total_scroll_stop_wsum,
      coalesce(sum(rm.results), 0)::numeric as total_results
    -- (v161) de `grp`, e não de `rows_metrics`: mesmas somas (uma linha por grupo nos
    -- dois), sem obrigar a guardar as linhas LARGAS para ler três vezes.
    from grp rm
  ),
  -- Tipos disponíveis + per_action_type de TODAS as chaves: só quando pedido (o
  -- predicado é constante sob force_custom_plan → o planner poda o ramo inteiro).
  -- Relê a seleção estreita (keys, já materializada) + filtros de nome em ad_metrics +
  -- os arrays do rollup; sem JSON.
  -- Soma por key_id ANTES de juntar com o dicionário: são ≤ 81 linhas depois do GROUP
  -- BY. Juntar antes custou 10,6 s no cenário de 30 packs (826 mil pares desempacotados
  -- materializados e varridos uma vez por chave do dicionário).
  conv_all as (
    select ck.key as conv_key, c.total_results
    from (
    select pr.key_id, sum(pr.value)::numeric as total_results
    from keys k
    join public.ad_performance_daily d on d.user_id = k.user_id and d.pack_id = k.pack_id and d.ad_id = k.ad_id and d.date = k.date
    cross join lateral unnest(d.conv_key_ids, d.conv_values) as pr(key_id, value)
    where v_include_conv_types
      and coalesce(case
        when v_group_by = 'ad_id' then d.ad_id
        when v_group_by = 'ad_name' then coalesce(nullif(d.ad_name, ''), d.ad_id)
        when v_group_by = 'adset_id' then d.adset_id
        when v_group_by = 'campaign_id' then d.campaign_id
        else d.ad_id end, '') <> ''
      and (p_account_ids is null or d.account_id = any(p_account_ids))
      and (p_ad_name_contains is null or p_ad_name_contains = ''
           or coalesce(d.ad_name, '') ilike '%' || p_ad_name_contains || '%')
      and (
        (coalesce(p_campaign_name_contains, '') = '' and coalesce(p_adset_name_contains, '') = '')
        or exists (
          select 1 from public.ad_metrics am where am.user_id = k.user_id and am.pack_id = k.pack_id and am.ad_id = k.ad_id and am.date = k.date
            and (coalesce(p_campaign_name_contains, '') = ''
                 or coalesce(am.campaign_name, '') ilike '%' || p_campaign_name_contains || '%')
            and (coalesce(p_adset_name_contains, '') = ''
                 or coalesce(am.adset_name, '') ilike '%' || p_adset_name_contains || '%')
        )
      )
    group by pr.key_id
    ) c
    join public.conversion_keys ck on ck.id = c.key_id
  ),
  available_types as (
    select coalesce(jsonb_agg(c.conv_key order by c.conv_key), '[]'::jsonb) as conv_types
    from conv_all c
  ),
  per_action_all as (
    select coalesce(
      jsonb_object_agg(
        c.conv_key,
        jsonb_build_object(
          'results', c.total_results,
          'cpr', case when c.total_results > 0 then t.total_spend / c.total_results else 0 end,
          'page_conv', case when t.total_lpv > 0 then c.total_results / t.total_lpv else 0 end
        )
        order by c.conv_key
      ),
      '{}'::jsonb
    ) as per_action_type
    from conv_all c
    cross join totals t
  ),
  per_action_selected as (
    select
      case
        when v_selected_key <> '' then jsonb_build_object(
          v_selected_key,
          jsonb_build_object(
            'results', t.total_results,
            'cpr', case when t.total_results > 0 then t.total_spend / t.total_results else 0 end,
            'page_conv', case when t.total_lpv > 0 then t.total_results / t.total_lpv else 0 end
          )
        )
        else '{}'::jsonb
      end as per_action_type
    from totals t
  ),
  averages_payload as (
    select jsonb_build_object(
      'hook', case when t.total_plays > 0 then t.total_hook_wsum / t.total_plays else 0 end,
      'hold_rate', case when t.total_plays > 0 then t.total_hold_rate_wsum / t.total_plays else 0 end,
      'video_watched_p50', case when t.total_plays > 0 then t.total_video_watched_p50_wsum / t.total_plays else 0 end,
      'video_watched_p75', case when t.total_plays > 0 then t.total_video_watched_p75_wsum / t.total_plays else 0 end,
      'scroll_stop', case when t.total_plays > 0 then t.total_scroll_stop_wsum / t.total_plays else 0 end,
      'ctr', case when t.total_impressions > 0 then t.total_clicks::numeric / t.total_impressions else 0 end,
      'website_ctr', case when t.total_impressions > 0 then t.total_inline::numeric / t.total_impressions else 0 end,
      'connect_rate', case when t.total_inline > 0 then t.total_lpv::numeric / t.total_inline else 0 end,
      'cpm', case when t.total_impressions > 0 then (t.total_spend * 1000.0) / t.total_impressions else 0 end,
      'cpc', case when t.total_clicks > 0 then t.total_spend / t.total_clicks else 0 end,
      'cplc', case when t.total_inline > 0 then t.total_spend / t.total_inline else 0 end,
      'per_action_type', case when v_include_conv_types then paa.per_action_type else pas.per_action_type end
    ) as averages
    from totals t
    cross join per_action_all paa
    cross join per_action_selected pas
  ),
  header_payload as (
    select jsonb_build_object(
      'sums', jsonb_build_object(
        'spend', t.total_spend,
        'results', t.total_results,
        'mqls', to_jsonb(null::numeric)
      ),
      'weighted_averages', jsonb_build_object(
        'hook', case when t.total_plays > 0 then t.total_hook_wsum / t.total_plays else 0 end,
        'scroll_stop', case when t.total_plays > 0 then t.total_scroll_stop_wsum / t.total_plays else 0 end,
        'ctr', case when t.total_impressions > 0 then t.total_clicks::numeric / t.total_impressions else 0 end,
        'website_ctr', case when t.total_impressions > 0 then t.total_inline::numeric / t.total_impressions else 0 end,
        'connect_rate', case when t.total_inline > 0 then t.total_lpv::numeric / t.total_inline else 0 end,
        'cpm', case when t.total_impressions > 0 then (t.total_spend * 1000.0) / t.total_impressions else 0 end,
        'page_conv', case when t.total_lpv > 0 then t.total_results / t.total_lpv else 0 end
      )
    ) as header_aggregates
    from totals t
  ),
  -- (v161) As linhas que SAEM, em versão ESTREITA: posição, ids do pai e as listas de
  -- ids (para o dicionário de nomes). Página e filtro por campanha como na v155:
  -- paginação sobre a ordem completa; o filtro por campanha (antes um "fold" que relia
  -- o JSON pronto) depois dela, sem mexer em médias e tipos de conversão.
  page_reps as materialized (
    select g.group_key, x.ord, g.rep_adset_id, g.rep_campaign_id, g.campaign_ids, g.adset_ids
    from grp_rep g
    cross join lateral (
      select ((select d.m from rank_dict d) ->> g.group_key)::integer as ord
    ) x
    where x.ord between v_offset + 1 and v_offset + v_limit
      and (v_campaign is null or coalesce(g.rep_campaign_id, '') = v_campaign)
  ),
  -- (v161) O que o invólucro core_v2 fazia nas abas de conjunto e campanha, relendo o
  -- JSON e consultando `ads` linha a linha: status efetivo, orçamento e moeda. Aqui por
  -- conjunto — os anúncios pausados do ATOR (p_user_id, como no core_v2) lidos uma vez.
  paused_ads as materialized (
    select a.adset_id, a.campaign_id, upper(coalesce(a.effective_status, '')) as st
    from public.ads a
    where v_group_by in ('adset_id', 'campaign_id')
      and a.user_id = p_user_id
      and upper(coalesce(a.effective_status, '')) in ('ADSET_PAUSED', 'CAMPAIGN_PAUSED')
  ),
  adset_flags as (
    select pa.adset_id,
           bool_or(pa.st = 'ADSET_PAUSED') as adset_paused,
           bool_or(pa.st = 'CAMPAIGN_PAUSED') as campaign_paused
    from paused_ads pa
    where pa.adset_id is not null
    group by pa.adset_id
  ),
  campaign_flags as (
    select pa.campaign_id,
           bool_or(pa.st = 'CAMPAIGN_PAUSED') as campaign_paused
    from paused_ads pa
    where pa.campaign_id is not null
    group by pa.campaign_id
  ),
  parent_keys as (
    -- `btrim` sem lista = só espaços, como o `trim()` do core_v2.
    select pr.group_key,
           nullif(btrim(coalesce(pr.rep_adset_id, '')), '') as k_adset,
           nullif(btrim(coalesce(pr.rep_campaign_id, '')), '') as k_campaign
    from page_reps pr
    where v_group_by in ('adset_id', 'campaign_id')
  ),
  parent_row as (
    select
      pk.group_key,
      case
        when v_group_by = 'adset_id' and pk.k_adset is not null then
          coalesce(
            nullif(pb_self.effective_status, ''),
            case
              when coalesce(af.adset_paused, false) then 'ADSET_PAUSED'
              when coalesce(af.campaign_paused, false) then 'CAMPAIGN_PAUSED'
              else 'ACTIVE'
            end)
        when v_group_by = 'campaign_id' and pk.k_campaign is not null then
          coalesce(
            nullif(pb_self.effective_status, ''),
            case when coalesce(cf.campaign_paused, false) then 'CAMPAIGN_PAUSED' else 'ACTIVE' end)
        else 'ACTIVE'
      end as effective_status,
      pb_self.daily_budget as budget_daily,
      pb_self.lifetime_budget as budget_lifetime,
      pb_mode.budget_mode,
      acct.currency as budget_currency,
      case when v_group_by = 'adset_id' then pb_self.ads_count end as self_ads_count
    from parent_keys pk
    -- PK (user_id, entity_id): o `limit 1` do core_v2 era no máximo uma linha mesmo.
    left join public.parent_entities pb_self
      on pb_self.user_id = p_user_id
     and pb_self.entity_id = case when v_group_by = 'adset_id' then pk.k_adset else pk.k_campaign end
    left join public.parent_entities pb_mode
      on pb_mode.user_id = p_user_id
     and pb_mode.entity_id = pk.k_campaign
    left join adset_flags af on af.adset_id = pk.k_adset
    left join campaign_flags cf on cf.campaign_id = pk.k_campaign
    left join lateral (
      select aa.currency
      from public.ad_accounts aa
      where aa.user_id = p_user_id
        and replace(aa.id, 'act_', '') = replace(pb_self.account_id, 'act_', '')
        and nullif(aa.currency, '') is not null
      limit 1
    ) acct on true
  ),
  -- Dicionário em vez de junção (vazio nas abas de anúncio): juntar com as linhas
  -- obrigava a ordenar as linhas LARGAS pela chave (40 MB em disco com 26 mil).
  parent_dict as (
    select coalesce(jsonb_object_agg(p.group_key, jsonb_build_object(
             'st', p.effective_status,
             'bd', p.budget_daily,
             'bl', p.budget_lifetime,
             'bm', p.budget_mode,
             'bc', p.budget_currency,
             'ac', p.self_ads_count)), '{}'::jsonb) as m
    from parent_row p
  ),
  -- (v161) A linha final, com o que a ROTA fazia em Python depois da consulta:
  --   * miniatura do Storage: `_hydrate_storage_thumbnails_for_rankings_rows`
  --     (linha sem ad_id fica como está; miniatura que já é do Storage fica; com
  --     caminho, vira prefixo + caminho codificado como o `_quote_path`);
  --   * `status_resolved`: `bool(str(status).strip())`, falso para nulo.
  -- `rows_metrics` tem este consumidor só: as linhas largas passam direto para a
  -- montagem das colunas, sem cópia no meio.
  out_rows as (
    select
      pf.ord,
      pf.group_key,
      pf.account_id,
      pf.account_ids,
      pf.campaign_ids,
      pf.adset_ids,
      pf.pack_ids,
      pf.tags,
      pf.meta_created_min,
      pf.campaign_id,
      pf.campaign_name,
      pf.adset_id,
      pf.adset_name,
      pf.rep_ad_id,
      pf.label_name,
      x.final_status,
      coalesce(btrim(x.final_status, v_ws) <> '', false) as status_resolved,
      pf.active_count,
      pf.paused_self_count,
      pf.adset_paused_count,
      pf.campaign_paused_count,
      case
        when v_group_by in ('adset_id', 'campaign_id') then coalesce((pp.pd ->> 'ac')::integer, pf.ad_count)
        else pf.ad_count
      end as ad_count,
      case
        when btrim(coalesce(pf.rep_ad_id, ''), v_ws) = '' then x.thumb_sql
        when strpos(coalesce(x.thumb_sql, ''), '/storage/v1/object/public/') > 0 then x.thumb_sql
        when p_thumb_public_prefix is not null
         and btrim(coalesce(pf.thumb_storage_path, ''), v_ws) <> ''
          then p_thumb_public_prefix || public.url_quote_path(btrim(pf.thumb_storage_path, v_ws))
        else x.thumb_sql
      end as thumbnail,
      pf.thumb_storage_path,
      pf.adcreatives_videos_thumbs,
      pf.media_type,
      pf.has_transcription,
      pf.transcription_no_audio,
      pf.impressions,
      pf.clicks,
      pf.inline_link_clicks,
      pf.spend,
      pf.lpv,
      pf.plays,
      pf.thruplays,
      pf.hook,
      pf.hold_rate,
      pf.video_watched_p50,
      pf.video_watched_p75,
      pf.scroll_stop,
      pf.ctr,
      pf.connect_rate,
      pf.cpm,
      pf.website_ctr,
      pf.reach,
      pf.frequency,
      pf.leadscore_histogram,
      pf.custom_histograms,
      pf.conversions,
      (pp.pd ->> 'bd')::bigint as budget_daily,
      (pp.pd ->> 'bl')::bigint as budget_lifetime,
      pp.pd ->> 'bm' as budget_mode,
      pp.pd ->> 'bc' as budget_currency
    from rows_metrics pf
    cross join lateral (
      select (select d.m from parent_dict d) -> pf.group_key as pd
    ) pp
    cross join lateral (
      select
        case
          when v_group_by in ('adset_id', 'campaign_id') then pp.pd ->> 'st'
          else pf.effective_status
        end as final_status,
        case
          when v_group_by in ('ad_name', 'ad_id') and pf.thumb_storage_path is not null then null
          else pf.thumbnail
        end as thumb_sql
    ) x
    where pf.ord between v_offset + 1 and v_offset + v_limit
      and (v_campaign is null or coalesce(pf.campaign_id, '') = v_campaign)
  ),
  -- (v161) A SAÍDA EM COLUNAS: uma lista por campo. Medido com 10 mil linhas reais: 45%
  -- menos na rede do que um objeto por linha, porque valores parecidos ficam juntos.
  -- `json_build_object` aceita no máximo 100 argumentos (50 campos), daí os blocos; o
  -- leitor funde todos.
  -- SEM `order by` nas agregações, de propósito: ordenar aqui ordenaria as linhas
  -- largas (o que a ordem estreita acima existe para evitar). Um único nó de agregação
  -- alimenta todas as listas com as mesmas linhas na mesma sequência, então as
  -- colunas ficam alinhadas entre si; `row_order` diz a posição final de cada linha, e
  -- o leitor reordena (`app/services/manager_columns.py`, `lib/api/managerColumns.ts`).
  cols as (
    select
      count(*)::integer as n,
      json_agg(o.ord) as row_order,
      json_build_object(
        'group_key', json_agg(o.group_key),
        'unique_id', json_agg(null::text),
        'account_id', json_agg(o.account_id),
        'account_ids', json_agg(o.account_ids),
        'campaign_ids', json_agg(o.campaign_ids),
        'adset_ids', json_agg(o.adset_ids),
        'pack_ids', json_agg(o.pack_ids),
        'tags', json_agg(o.tags),
        'meta_created_time', json_agg(o.meta_created_min),
        'campaign_id', json_agg(o.campaign_id),
        'campaign_name', json_agg(o.campaign_name),
        'adset_id', json_agg(o.adset_id),
        'adset_name', json_agg(o.adset_name),
        'ad_id', json_agg(o.rep_ad_id),
        'ad_name', json_agg(o.label_name),
        'effective_status', json_agg(o.final_status),
        'status_resolved', json_agg(o.status_resolved),
        'active_count', json_agg(o.active_count),
        'paused_self_count', json_agg(o.paused_self_count),
        'adset_paused_count', json_agg(o.adset_paused_count),
        'campaign_paused_count', json_agg(o.campaign_paused_count),
        'ad_count', json_agg(o.ad_count),
        'thumbnail', json_agg(o.thumbnail),
        'thumb_storage_path', json_agg(o.thumb_storage_path),
        'adcreatives_videos_thumbs', json_agg(o.adcreatives_videos_thumbs),
        'media_type', json_agg(o.media_type),
        'has_transcription', json_agg(o.has_transcription),
        'transcription_no_audio', json_agg(o.transcription_no_audio)
      ) as bloco_a,
      json_build_object(
        'impressions', json_agg(o.impressions),
        'clicks', json_agg(o.clicks),
        'inline_link_clicks', json_agg(o.inline_link_clicks),
        'spend', json_agg(o.spend),
        'lpv', json_agg(o.lpv),
        'plays', json_agg(o.plays),
        'video_total_thruplays', json_agg(o.thruplays),
        'hook', json_agg(o.hook),
        'hold_rate', json_agg(o.hold_rate),
        'video_watched_p50', json_agg(o.video_watched_p50),
        'video_watched_p75', json_agg(o.video_watched_p75),
        'scroll_stop', json_agg(o.scroll_stop),
        'ctr', json_agg(o.ctr),
        'connect_rate', json_agg(o.connect_rate),
        'cpm', json_agg(o.cpm),
        'website_ctr', json_agg(o.website_ctr),
        'reach', json_agg(o.reach),
        'frequency', json_agg(o.frequency),
        'leadscore_histogram', json_agg(o.leadscore_histogram),
        'custom_histograms', json_agg(o.custom_histograms),
        'conversions', json_agg(o.conversions)
      ) as bloco_b,
      -- Só nas abas de conjunto e campanha: nas de anúncio o core_v2 não criava
      -- estes campos, e o leitor não deve criá-los.
      case when v_group_by in ('adset_id', 'campaign_id') then
        json_build_object(
          'budget_daily', json_agg(o.budget_daily),
          'budget_lifetime', json_agg(o.budget_lifetime),
          'budget_mode', json_agg(o.budget_mode),
          'budget_currency', json_agg(o.budget_currency)
        )
      end as bloco_c
    from out_rows o
  ),
  -- Dicionario id -> nome, so das campanhas/conjuntos citados nas linhas que SAEM
  -- (v161: depois do filtro por campanha — o mesmo resultado da poda que a v155
  -- fazia no fold). O nome NAO viaja por linha.
  paged_parent_ids as (
    select
      coalesce((select array_agg(distinct c) from page_reps p, unnest(p.campaign_ids) c where c is not null), array[]::text[]) as campaign_ids,
      coalesce((select array_agg(distinct a) from page_reps p, unnest(p.adset_ids) a where a is not null), array[]::text[]) as adset_ids
  ),
  -- (v161) Para cada id citado: o nome que as linhas JÁ trouxeram de `ads` (rep_scan);
  -- senão, `ads` (como a v155 fazia para todos). Na v155 esta leitura era, no pior
  -- caso medido (16/09, 38 packs, 51 mil linhas), 54 mil buscas aleatórias e ~26 s —
  -- o maior custo da consulta inteira. A condição sobre o dicionário não depende da
  -- tabela e vira One-Time Filter: a busca só acontece para o id desconhecido (nas
  -- abas agregadas, as campanhas que nenhum representante trouxe).
  names_payload as (
    select jsonb_build_object(
      'campaigns', coalesce((
        select jsonb_object_agg(x.id, x.name)
        from (
          select c.id,
                 coalesce((select rs.campaign_names from rep_scan rs) ->> c.id, lk.name) as name
          from paged_parent_ids pp
          cross join lateral unnest(pp.campaign_ids) as c(id)
          left join lateral (
            select max(a.campaign_name) as name
            from public.ads a
            where ((select rs.campaign_names from rep_scan rs) ->> c.id) is null
              and a.user_id = any(v_owners)
              and a.campaign_id = c.id
              and nullif(a.campaign_name, '') is not null
          ) lk on true
        ) x
        where x.name is not null
      ), '{}'::jsonb),
      'adsets', coalesce((
        select jsonb_object_agg(x.id, x.name)
        from (
          select c.id,
                 coalesce((select rs.adset_names from rep_scan rs) ->> c.id, lk.name) as name
          from paged_parent_ids pp
          cross join lateral unnest(pp.adset_ids) as c(id)
          left join lateral (
            select max(a.adset_name) as name
            from public.ads a
            where ((select rs.adset_names from rep_scan rs) ->> c.id) is null
              and a.user_id = any(v_owners)
              and a.adset_id = c.id
              and nullif(a.adset_name, '') is not null
          ) lk on true
        ) x
        where x.name is not null
      ), '{}'::jsonb)
    ) as names
  ),
  pagination_payload as (
    select case
      when v_campaign is not null then
        -- como o fold da v155: paginação zerada e total = linhas que sobraram
        jsonb_build_object('limit', v_limit, 'offset', 0,
                           'total', (select c.n from cols c), 'has_more', false)
      else
        jsonb_build_object('limit', v_limit, 'offset', v_offset,
                           'total', tc.total, 'has_more', (v_offset + v_limit) < tc.total)
    end as pagination
    -- (v161) contagem de `grp`: uma linha por grupo, como `rows_metrics`.
    from (select count(*)::integer as total from grp) tc
  )
  -- (v161) sem `overlap`: `keys.x_cross_silo` é a constante false nos dois ramos da
  -- seleção, então a v155 nunca emitia a chave — mas pagava uma varredura de `keys`
  -- inteira para contar zero (169 ms no caso do Igor).
  select json_build_object(
    'data_columns', case
      when c.bloco_c is null then json_build_array(c.bloco_a, c.bloco_b)
      else json_build_array(c.bloco_a, c.bloco_b, c.bloco_c)
    end,
    'row_count', c.n,
    'row_order', c.row_order,
    'names', coalesce((select names from names_payload), '{}'::jsonb),
    'available_conversion_types',
      case when v_include_conv_types then coalesce((select conv_types from available_types), '[]'::jsonb) else '[]'::jsonb end,
    'averages', coalesce((select averages from averages_payload), '{}'::jsonb),
    'header_aggregates', coalesce((select header_aggregates from header_payload), '{}'::jsonb),
    'pagination', (select pagination from pagination_payload)
  )
  from cols c
  into v_result;

  return v_result;
end;
$$;


ALTER FUNCTION public.fetch_manager_rankings_v161(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text, p_include_custom boolean, p_thumb_public_prefix text) OWNER TO postgres;

--
-- Name: FUNCTION fetch_manager_rankings_v161(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text, p_include_custom boolean, p_thumb_public_prefix text); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.fetch_manager_rankings_v161(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text, p_include_custom boolean, p_thumb_public_prefix text) IS '161: Manager (4 abas) em colunas e sem o corte de 10 mil. v155 sem as laterais N² por nome, com o core_v2, a miniatura do Storage e o status_resolved absorvidos. Saída: data_columns (lista de blocos {campo: [valores]}), row_count e row_order (posição final de cada linha; o leitor reordena).';


--
-- Name: fetch_manager_rankings_v162(uuid, date, date, text, uuid[], text[], text, text, text, text, boolean, boolean, integer, integer, text, text, boolean, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.fetch_manager_rankings_v162(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text DEFAULT 'ad_name'::text, p_pack_ids uuid[] DEFAULT NULL::uuid[], p_account_ids text[] DEFAULT NULL::text[], p_campaign_name_contains text DEFAULT NULL::text, p_adset_name_contains text DEFAULT NULL::text, p_ad_name_contains text DEFAULT NULL::text, p_action_type text DEFAULT NULL::text, p_include_leadscore boolean DEFAULT true, p_include_available_conversion_types boolean DEFAULT true, p_limit integer DEFAULT 500, p_offset integer DEFAULT 0, p_order_by text DEFAULT 'spend'::text, p_campaign_id text DEFAULT NULL::text, p_include_custom boolean DEFAULT false, p_thumb_public_prefix text DEFAULT NULL::text) RETURNS SETOF json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    SET plan_cache_mode TO 'force_custom_plan'
    SET work_mem TO '16MB'
    SET statement_timeout TO '40s'
    AS $$
declare
  v_group_by text := lower(coalesce(p_group_by, 'ad_name'));
  v_order_by text := lower(coalesce(p_order_by, 'spend'));
  v_date_start date := least(p_date_start, p_date_stop);
  v_date_stop date := greatest(p_date_start, p_date_stop);
  -- (v161) teto 100 mil: o de 10 mil cortava a aba "Por anúncio" em silêncio (26 mil
  -- linhas num caso real). É rede de segurança, não orçamento.
  v_limit integer := greatest(1, least(coalesce(p_limit, 500), 100000));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
  v_selected_key text := trim(coalesce(p_action_type, ''));
  v_key_id integer := null;
  v_include_conv_types boolean := coalesce(p_include_available_conversion_types, true);
  v_include_leads boolean := coalesce(p_include_leadscore, true);
  -- 140: histogramas das colunas vinculadas so quando pedidos (opt-in).
  v_include_custom boolean := coalesce(p_include_custom, false);
  -- (v161) filtro por campaign_id (antes: fold sobre o JSON pronto, no fim).
  v_campaign text := nullif(btrim(coalesce(p_campaign_id, '')), '');
  -- (v161) espaços que o `str.strip()` do Python removia na hidratação.
  v_ws constant text := E' \t\n\r\x0b\x0c';
  v_owners uuid[];
  v_requested integer;
  -- universo de packs para a máscara: a seleção pedida, ou (ramo legado) todos os
  -- packs do ator. Posição i do array ↔ bit i-1 da máscara.
  v_pack_universe uuid[];
  v_n_packs integer;
begin
  if auth.uid() is distinct from p_user_id then
    raise exception 'Forbidden: p_user_id must match auth.uid()'
      using errcode = '42501';
  end if;

  if p_pack_ids is null then
    v_owners := array[p_user_id];
    select coalesce(array_agg(id order by id), array[]::uuid[])
      into v_pack_universe
    from public.packs where user_id = p_user_id;
  else
    select array_agg(distinct a.owner_id), count(distinct a.pack_id)
      into v_owners, v_requested
    from public.resolve_pack_access(p_pack_ids, p_user_id) a;
    if coalesce(v_requested, 0) < (select count(distinct x) from unnest(p_pack_ids) x) then
      raise exception 'Forbidden: pack inacessivel na selecao'
        using errcode = '42501';
    end if;
    if v_owners is null or array_length(v_owners, 1) is null then
      v_owners := array[p_user_id];
    end if;
    select array_agg(distinct x order by x) into v_pack_universe from unnest(p_pack_ids) x;
  end if;
  v_n_packs := greatest(1, coalesce(cardinality(v_pack_universe), 0));

  if v_group_by not in ('ad_id', 'ad_name', 'adset_id', 'campaign_id') then
    raise exception 'Invalid p_group_by: %, expected ad_id|ad_name|adset_id|campaign_id', v_group_by
      using errcode = '22023';
  end if;

  -- Normalização da chave pedida, idêntica à v116 (sem prefixo = 'conversion:').
  if v_selected_key <> '' and v_selected_key not like 'conversion:%' and v_selected_key not like 'action:%' then
    v_selected_key := 'conversion:' || v_selected_key;
  end if;
  if v_selected_key <> '' then
    -- Chave nunca vista no dicionário = nenhum anúncio tem esse evento → resultados 0,
    -- exatamente como a v116 (nenhum elemento casava).
    select id into v_key_id from public.conversion_keys where key = v_selected_key;
  end if;

  return query
  with
  -- 1. A seleção, resolvida no MAPA (índice composto user/pack/date/ad; ~40 B por linha).
  --    GROUP BY (ad_id, dia) faz de uma vez: (a) dedup cross-silo com a MESMA preferência
  --    da v116 — vence o dono do pack compartilhado, o ator perde, desempate por uuid;
  --    (b) dedup de sobreposição entre packs do mesmo dono; (c) sinal de conflito
  --    cross-silo (min <> max do dono); (d) máscara dos packs de origem (bit por pack).
  keys as (
    select
      apm.ad_id,
      apm.date as date,
      apm.user_id,
      false as x_cross_silo,
      set_bit(repeat('0', v_n_packs)::varbit, array_position(v_pack_universe, apm.pack_id) - 1, 1) as pack_mask,
      apm.pack_id
    from unnest(v_owners) as o(owner_id)
    join public.ad_performance_daily apm
      on apm.user_id = o.owner_id
     and apm.pack_id = any(p_pack_ids)
     and apm.date >= v_date_start
     and apm.date <= v_date_stop
    where p_pack_ids is not null

    union all

    -- Ramo legado (sem packs): o silo do ator no período; packs de origem por lookup.
    select
      am.ad_id,
      am.date,
      p_user_id as user_id,
      false as x_cross_silo,
      coalesce(bit_or(set_bit(repeat('0', v_n_packs)::varbit, array_position(v_pack_universe, am.pack_id) - 1, 1)), repeat('0', v_n_packs)::varbit) as pack_mask,
      -- Postgres nao tem min(uuid): "um pack qualquer, deterministico" via array_agg ordenado.
      (array_agg(am.pack_id order by am.pack_id))[1] as pack_id
    from public.ad_performance_daily am
    where p_pack_ids is null
      and am.user_id = p_user_id
      and am.date >= v_date_start
      and am.date <= v_date_stop
    group by am.ad_id, am.date
  ),
  -- 1b. (v155) Inventário: anúncio ativo no período (o intervalo first/last_active_date
  --     cruza a janela) SEM linha de métrica neste (silo, pack) no período. Substitui as
  --     linhas-zero que o refresh gravava em ad_metrics. Uma linha por (silo, pack,
  --     anúncio), zerada: somar zero não muda soma, a contagem é count(distinct ad_id) e
  --     o representante é o de maior impressão (a linha zerada perde para qualquer real,
  --     ver rep_enc). O anti-join vai ao read model pela PK, não a `keys`: no ramo
  --     legado `keys` guarda um pack só por anúncio-dia.
  inv as (
    select i.user_id, i.pack_id, i.ad_id, i.account_id, i.campaign_id, i.campaign_name,
           i.adset_id, i.adset_name, i.ad_name
    from unnest(v_owners) as o(owner_id)
    join public.ad_pack_inventory i
      on i.user_id = o.owner_id
     and i.pack_id = any(v_pack_universe)
     and i.first_active_date <= v_date_stop
     and i.last_active_date >= v_date_start
    where not exists (
      select 1 from public.ad_performance_daily d
      where d.user_id = i.user_id and d.pack_id = i.pack_id and d.ad_id = i.ad_id
        and d.date >= v_date_start and d.date <= v_date_stop
    )
  ),
  -- 2. As linhas: SÓ o read model (ad_performance_daily, migration 129), pela chave
  --    única. ad_metrics não entra aqui — entra só para a linha representante (fim) e
  --    para filtros por nome de campanha/conjunto (EXISTS abaixo, podado quando o
  --    filtro está vazio: o predicado é constante sob force_custom_plan).
  sel as (
    select
      k.user_id,
      k.ad_id,
      k.date,
      k.pack_mask,
      k.pack_id,
      case
        when v_group_by = 'ad_id' then d.ad_id
        when v_group_by = 'ad_name' then coalesce(nullif(d.ad_name, ''), d.ad_id)
        when v_group_by = 'adset_id' then d.adset_id
        when v_group_by = 'campaign_id' then d.campaign_id
        else d.ad_id
      end as group_key,
      -- Só o que a agregação consome. Nomes de campanha/conjunto NÃO viajam por
      -- linha: saem da linha REPRESENTANTE no fim (77 lookups em ad_metrics).
      d.account_id,
      d.adset_id,
      d.campaign_id,
      d.impressions,
      d.clicks,
      d.inline_link_clicks,
      d.spend,
      d.lpv,
      d.plays,
      d.thruplays,
      d.video_watched_p50,
      d.video_watched_p75,
      d.hold_rate,
      d.reach,
      d.frequency,
      d.hook_value,
      d.scroll_stop_value,
      -- conversão pedida por posição no array (leads: CTE próprio, leads_by_group)
      coalesce(d.conv_values[array_position(d.conv_key_ids, v_key_id)], 0)::numeric as results
    from keys k
    join public.ad_performance_daily d on d.user_id = k.user_id and d.pack_id = k.pack_id and d.ad_id = k.ad_id and d.date = k.date
    where (p_account_ids is null or d.account_id = any(p_account_ids))
      and (p_ad_name_contains is null or p_ad_name_contains = ''
           or coalesce(d.ad_name, '') ilike '%' || p_ad_name_contains || '%')
      and (
        (coalesce(p_campaign_name_contains, '') = '' and coalesce(p_adset_name_contains, '') = '')
        or exists (
          select 1 from public.ad_metrics am where am.user_id = k.user_id and am.pack_id = k.pack_id and am.ad_id = k.ad_id and am.date = k.date
            and (coalesce(p_campaign_name_contains, '') = ''
                 or coalesce(am.campaign_name, '') ilike '%' || p_campaign_name_contains || '%')
            and (coalesce(p_adset_name_contains, '') = ''
                 or coalesce(am.adset_name, '') ilike '%' || p_adset_name_contains || '%')
        )
      )

    union all

    -- (v155) O inventário, zerado. Identidade e nomes vêm da própria linha (os mais
    -- recentes que o refresh viu); os filtros usam esses mesmos campos. `date` nulo:
    -- a linha não é um dia, e o rep_enc a põe abaixo de qualquer dia real.
    select
      i.user_id,
      i.ad_id,
      null::date as date,
      set_bit(repeat('0', v_n_packs)::varbit, array_position(v_pack_universe, i.pack_id) - 1, 1) as pack_mask,
      i.pack_id,
      case
        when v_group_by = 'ad_id' then i.ad_id
        when v_group_by = 'ad_name' then coalesce(nullif(i.ad_name, ''), i.ad_id)
        when v_group_by = 'adset_id' then i.adset_id
        when v_group_by = 'campaign_id' then i.campaign_id
        else i.ad_id
      end as group_key,
      i.account_id,
      i.adset_id,
      i.campaign_id,
      0::bigint as impressions,
      0::bigint as clicks,
      0::bigint as inline_link_clicks,
      0::numeric as spend,
      0::bigint as lpv,
      0::bigint as plays,
      0::bigint as thruplays,
      0::numeric as video_watched_p50,
      0::numeric as video_watched_p75,
      0::numeric as hold_rate,
      0::bigint as reach,
      0::numeric as frequency,
      0::numeric as hook_value,
      0::numeric as scroll_stop_value,
      0::numeric as results
    from inv i
    where (p_account_ids is null or i.account_id = any(p_account_ids))
      and (p_ad_name_contains is null or p_ad_name_contains = ''
           or coalesce(i.ad_name, '') ilike '%' || p_ad_name_contains || '%')
      and (coalesce(p_campaign_name_contains, '') = ''
           or coalesce(i.campaign_name, '') ilike '%' || p_campaign_name_contains || '%')
      and (coalesce(p_adset_name_contains, '') = ''
           or coalesce(i.adset_name, '') ilike '%' || p_adset_name_contains || '%')
  ),
  -- `coalesce(x,'') <> ''` e não `nullif(x,'') is not null`: mesma semântica, mas o
  -- planner dá seletividade ~1 ao `<>` e 0,005 ao `is not null` sobre expressão —
  -- com 0,005 ele estimava 1 linha aqui e escolhia agregação por ordenação (spill).
  filtered as (
    select * from sel where coalesce(group_key, '') <> ''
  ),
  -- 3. Anúncio-dia → anúncio (por silo). Só agregados de estado constante.
  per_ad as (
    select
      f.group_key,
      f.user_id,
      f.ad_id,
      sum(f.impressions)::bigint as impressions,
      sum(f.clicks)::bigint as clicks,
      sum(f.inline_link_clicks)::bigint as inline_link_clicks,
      sum(f.spend)::numeric as spend,
      sum(f.lpv)::bigint as lpv,
      sum(f.plays)::bigint as plays,
      sum(f.thruplays)::bigint as thruplays,
      sum(f.hook_value * f.plays)::numeric as hook_wsum,
      sum(f.hold_rate * f.plays)::numeric as hold_rate_wsum,
      sum(f.video_watched_p50 * f.plays)::numeric as video_watched_p50_wsum,
      sum(f.video_watched_p75 * f.plays)::numeric as video_watched_p75_wsum,
      sum(f.scroll_stop_value * f.plays)::numeric as scroll_stop_wsum,
      sum(f.reach)::bigint as reach,
      sum(f.frequency * f.impressions)::numeric as frequency_wsum,
      sum(f.results)::numeric as results,
      -- um anúncio pertence a UMA conta e a UM conjunto: min() é exato
      min(nullif(f.account_id, '')) as account_id,
      min(nullif(f.adset_id, '')) as adset_id,
      min(nullif(f.campaign_id, '')) as campaign_id,
      bit_or(f.pack_mask) as pack_mask,
      -- dia representante deste anúncio: max impressões (desempate: dia mais recente)
      max((lpad(f.impressions::text, 12, '0') || e'\x1f' || coalesce(f.date::text, '') || e'\x1f' || f.pack_id::text) collate "C") as rep_enc
    from filtered f
    group by f.group_key, f.user_id, f.ad_id
  ),
  -- 4. Um lookup em `ads` por anúncio (índice de cobertura ads_user_ad_status_idx).
  per_ad_status as (
    select
      pa.*,
      a.effective_status,
      a.meta_created_time,
      a.thumb_storage_path
    from per_ad pa
    left join public.ads a
      on a.user_id = pa.user_id
     and a.ad_id = pa.ad_id
  ),
  -- 5. Anúncio → grupo.
  grp as (
    select
      p.group_key,
      sum(p.impressions)::bigint as impressions,
      sum(p.clicks)::bigint as clicks,
      sum(p.inline_link_clicks)::bigint as inline_link_clicks,
      sum(p.spend)::numeric as spend,
      sum(p.lpv)::bigint as lpv,
      sum(p.plays)::bigint as plays,
      sum(p.thruplays)::bigint as thruplays,
      sum(p.hook_wsum)::numeric as hook_wsum,
      sum(p.hold_rate_wsum)::numeric as hold_rate_wsum,
      sum(p.video_watched_p50_wsum)::numeric as video_watched_p50_wsum,
      sum(p.video_watched_p75_wsum)::numeric as video_watched_p75_wsum,
      sum(p.scroll_stop_wsum)::numeric as scroll_stop_wsum,
      sum(p.reach)::bigint as reach,
      sum(p.frequency_wsum)::numeric as frequency_wsum,
      sum(p.results)::numeric as results,
      count(distinct p.ad_id)::integer as ad_id_count,
      count(distinct p.adset_id)::integer as adset_count,
      coalesce(array_agg(distinct p.account_id) filter (where p.account_id is not null), array[]::text[]) as account_ids,
      -- v136/137: TODAS as campanhas e conjuntos do grupo, nao a do representante.
      -- Mesma passada do account_ids: mesmo group by, nenhuma leitura nova.
      coalesce(array_agg(distinct p.campaign_id) filter (where p.campaign_id is not null), array[]::text[]) as campaign_ids,
      coalesce(array_agg(distinct p.adset_id) filter (where p.adset_id is not null), array[]::text[]) as adset_ids,
      bit_or(p.pack_mask) as pack_mask,
      -- representante do grupo = (impressões do dia rep, ad_id) máximos — a ordem
      -- (impressions desc, ad_id desc) da v116; user_id e os campos vão de carona.
      max((substr(p.rep_enc, 1, 12) || e'\x1f' || p.ad_id || e'\x1f' || p.user_id::text
           || e'\x1f' || p.rep_enc) collate "C") as rep_enc,
      bool_or(upper(coalesce(p.effective_status, '')) = 'ACTIVE') as has_active,
      count(distinct p.ad_id) filter (where upper(coalesce(p.effective_status, '')) = 'ACTIVE')::integer as active_count,
      -- v138: por que o grupo esta parado. `fallback_status` (o min alfabetico logo
      -- abaixo) responde "algum anuncio esta assim, e foi o primeiro do alfabeto" -
      -- por isso um criativo com um anuncio arquivado aparece como ARCHIVED. Contar
      -- permite a pergunta certa: TODOS estao pausados pelo mesmo motivo?
      -- Mesma passada e mesmo group by do active_count: nenhuma leitura nova.
      count(distinct p.ad_id) filter (where upper(coalesce(p.effective_status, '')) = 'PAUSED')::integer as paused_self_count,
      count(distinct p.ad_id) filter (where upper(coalesce(p.effective_status, '')) = 'ADSET_PAUSED')::integer as adset_paused_count,
      count(distinct p.ad_id) filter (where upper(coalesce(p.effective_status, '')) = 'CAMPAIGN_PAUSED')::integer as campaign_paused_count,
      min(p.effective_status) filter (where nullif(p.effective_status, '') is not null) as fallback_status,
      min(p.meta_created_time) as meta_created_min,
      -- fallback de miniatura: qualquer anúncio do grupo com arquivo no Storage
      -- (medido: 13 de 3.451 criativos têm o representante sem e uma cópia com)
      max(p.thumb_storage_path) filter (where nullif(p.thumb_storage_path, '') is not null) as any_thumb_storage_path
    from per_ad_status p
    group by p.group_key
  ),
  -- Leads: CTE próprio e ESTREITO. Só 23% dos anúncio-dias têm leads; parte do
  -- rollup (sem JSON), busca em ad_metrics só o necessário para o group_key e os
  -- filtros, e soma o histograma por (grupo, score). Fora da passada principal
  -- para não carregar JSON por duas camadas de agregação. MATERIALIZED: referenciado
  -- uma vez, o planner o inlinaria como lado interno de um nested loop e o
  -- recalcularia por grupo (medido: 397 execuções, 4,4 s).
  leads_by_group as materialized (
    select
      x.group_key,
      jsonb_object_agg(trim_scale(x.score)::text, x.qty order by x.score) as leadscore_histogram
    from (
      select
        case
          when v_group_by = 'ad_id' then d.ad_id
          when v_group_by = 'ad_name' then coalesce(nullif(d.ad_name, ''), d.ad_id)
          when v_group_by = 'adset_id' then d.adset_id
          when v_group_by = 'campaign_id' then d.campaign_id
          else d.ad_id
        end as group_key,
        s.score,
        sum(s.qty)::integer as qty
      from keys k
      join public.ad_performance_daily d on d.user_id = k.user_id and d.pack_id = k.pack_id and d.ad_id = k.ad_id and d.date = k.date
      cross join lateral unnest(d.lead_scores, d.lead_qtys) as s(score, qty)
      where v_include_leads
        and cardinality(d.lead_scores) > 0
        and (p_account_ids is null or d.account_id = any(p_account_ids))
        and (p_ad_name_contains is null or p_ad_name_contains = ''
             or coalesce(d.ad_name, '') ilike '%' || p_ad_name_contains || '%')
        and (
          (coalesce(p_campaign_name_contains, '') = '' and coalesce(p_adset_name_contains, '') = '')
          or exists (
            select 1 from public.ad_metrics am where am.user_id = k.user_id and am.pack_id = k.pack_id and am.ad_id = k.ad_id and am.date = k.date
              and (coalesce(p_campaign_name_contains, '') = ''
                   or coalesce(am.campaign_name, '') ilike '%' || p_campaign_name_contains || '%')
              and (coalesce(p_adset_name_contains, '') = ''
                   or coalesce(am.adset_name, '') ilike '%' || p_adset_name_contains || '%')
          )
        )
      group by 1, s.score
    ) x
    where coalesce(x.group_key, '') <> ''
    group by x.group_key
  ),
  -- 140: histogramas das colunas vinculadas, somados por (grupo, vinculo, valor).
  -- Mesma forma do leads_by_group: CTE estreito, MATERIALIZED, mesmos filtros, e
  -- opt-in por p_include_custom. Quem nao vincula coluna nenhuma tem a coluna nula
  -- e o frontend nem pede: custo zero fora do caso de uso.
  custom_by_group as materialized (
    select
      y.group_key,
      jsonb_object_agg(y.mapping_id, y.hist) as custom_histograms
    from (
      select x.group_key, x.mapping_id, jsonb_object_agg(x.val, x.qty) as hist
      from (
        select
          case
            when v_group_by = 'ad_id' then d.ad_id
            when v_group_by = 'ad_name' then coalesce(nullif(d.ad_name, ''), d.ad_id)
            when v_group_by = 'adset_id' then d.adset_id
            when v_group_by = 'campaign_id' then d.campaign_id
            else d.ad_id
          end as group_key,
          m.key as mapping_id,
          v.key as val,
          sum(v.value::bigint)::bigint as qty
        from keys k
        join public.ad_performance_daily d on d.user_id = k.user_id and d.pack_id = k.pack_id and d.ad_id = k.ad_id and d.date = k.date
        cross join lateral jsonb_each(d.custom_hist) as m(key, value)
        cross join lateral jsonb_each_text(m.value) as v(key, value)
        where v_include_custom
          and d.custom_hist is not null
          and (p_account_ids is null or d.account_id = any(p_account_ids))
          and (p_ad_name_contains is null or p_ad_name_contains = ''
               or coalesce(d.ad_name, '') ilike '%' || p_ad_name_contains || '%')
          and (
            (coalesce(p_campaign_name_contains, '') = '' and coalesce(p_adset_name_contains, '') = '')
            or exists (
              select 1 from public.ad_metrics am where am.user_id = k.user_id and am.pack_id = k.pack_id and am.ad_id = k.ad_id and am.date = k.date
                and (coalesce(p_campaign_name_contains, '') = ''
                     or coalesce(am.campaign_name, '') ilike '%' || p_campaign_name_contains || '%')
                and (coalesce(p_adset_name_contains, '') = ''
                     or coalesce(am.adset_name, '') ilike '%' || p_adset_name_contains || '%')
            )
          )
        group by 1, m.key, v.key
      ) x
      where coalesce(x.group_key, '') <> ''
      group by x.group_key, x.mapping_id
    ) y
    group by y.group_key
  ),
  -- 6. Enriquecimento por grupo (~77 linhas): representante em `ads`, tags do ATOR,
  --    packs da máscara, histograma de leads.
  -- Decodifica o representante (posições da chave: 1 impressões | 2 ad_id | 3 user_id
  -- | 4 impressões do dia | 5 date) e busca a LINHA representante em ad_metrics para
  -- os nomes — 77 lookups pela chave única, em vez de carregar nomes em 42 mil linhas.
  -- `collate "default"`: a chave é comparada em "C"; os pedaços voltam à colação das
  -- colunas, senão o `=` contra ads/ad_metrics não usa índice (medido: bitmap scan
  -- de 21 mil linhas por grupo).
  grp_dec as (
    select
      g.*,
      (split_part(g.rep_enc, e'\x1f', 2) collate "default") as rep_ad_id,
      (split_part(g.rep_enc, e'\x1f', 3))::uuid as rep_user_id,
      nullif(split_part(g.rep_enc, e'\x1f', 5), '')::date as rep_date,
      nullif(split_part(g.rep_enc, e'\x1f', 6), '')::uuid as rep_pack_id
    from grp g
  ),
  grp_rep as (
    select
      g.*,
      -- (v155) representante sem dia (só inventário): nomes da linha do inventário.
      case when g.rep_date is null then ri.ad_name when ra.ad_id is not null then ra.ad_name else am.ad_name end as rep_ad_name,
      case when g.rep_date is null then ri.account_id when ra.ad_id is not null then ra.account_id else am.account_id end as rep_account_id,
      case when g.rep_date is null then ri.campaign_id when ra.ad_id is not null then ra.campaign_id else am.campaign_id end as rep_campaign_id,
      case when g.rep_date is null then ri.campaign_name when ra.ad_id is not null then ra.campaign_name else am.campaign_name end as rep_campaign_name,
      case when g.rep_date is null then ri.adset_id when ra.ad_id is not null then ra.adset_id else am.adset_id end as rep_adset_id,
      case when g.rep_date is null then ri.adset_name when ra.ad_id is not null then ra.adset_name else am.adset_name end as rep_adset_name,
      -- (v161) a chave por NOME das buscas de mídia/transcrição/tags (antes, dentro
      -- de cada lateral).
      coalesce(nullif(case when g.rep_date is null then ri.ad_name when ra.ad_id is not null then ra.ad_name else am.ad_name end, ''), g.rep_ad_id) as name_key,
      -- (v161) o que o enriquecimento lia de `ads` numa SEGUNDA busca pelo mesmo anúncio
      ra.effective_status as ra_effective_status,
      ra.thumbnail_url as ra_thumbnail_url,
      -- (v162) só o 1º item: é tudo que a miniatura de fallback usa.
      ra.adcreatives_videos_thumbs ->> 0 as ra_first_video_thumb,
      ra.thumb_storage_path as ra_thumb_storage_path,
      -- (v161) pares id -> nome já lidos, para o dicionário `names` (ver names_payload)
      ra.campaign_id as ra_campaign_id,
      ra.campaign_name as ra_campaign_name,
      ra.adset_id as ra_adset_id,
      ra.adset_name as ra_adset_name
    from grp_dec g
    -- (v161) Os nomes do representante vêm da linha de `ads`, e não mais da linha do
    -- DIA em `ad_metrics`. Em produção esta leitura era o maior custo da consulta:
    -- 26 mil buscas aleatórias numa tabela larga, 12.665 páginas (≈99 MB) do disco por
    -- requisição numa instância com 256 MB de memória — 12,4 s de 29 s. As duas fontes
    -- são IGUAIS hoje: medido em 16/09 sobre todo o banco, nenhum dos 58.499 anúncios
    -- teve mais de um nome de campanha/conjunto/anúncio, e o mais recente bate com
    -- `ads` em todos. Num renome futuro, a linha passa a mostrar o nome ATUAL — o mesmo
    -- do dicionário `names`, que já vinha de `ads`.
    -- `ad_metrics` fica só para o anúncio sem linha em `ads` (nenhum hoje); o filtro sem
    -- coluna da tabela vira One-Time Filter e a busca nem acontece.
    left join public.ads ra
      on ra.user_id = g.rep_user_id
     and ra.ad_id = g.rep_ad_id
    left join lateral (
      select m.ad_name, m.account_id, m.campaign_id, m.campaign_name, m.adset_id, m.adset_name
      from public.ad_metrics m
      where g.rep_date is not null
        and ra.ad_id is null
        and m.user_id = g.rep_user_id and m.pack_id = g.rep_pack_id
        and m.ad_id = g.rep_ad_id and m.date = g.rep_date
      -- `limit 1` não muda o resultado (a PK garante no máximo uma linha): impede o
      -- planner de achatar a subconsulta numa junção comum. Achatada, a condição
      -- `ra.ad_id is null` virava filtro DEPOIS da busca, e as 26 mil buscas
      -- continuavam (medido em produção, 16/09: 5,2 s e 10 mil páginas do disco).
      -- Com o limit, ela vira One-Time Filter e a busca não acontece.
      limit 1
    ) am on true
    left join lateral (
      -- O anúncio pode estar no inventário de mais de um pack da seleção: vale o que
      -- esteve ativo por último (a mesma regra da linha-zero mais recente de antes).
      select i.ad_name, i.account_id, i.campaign_id, i.campaign_name, i.adset_id, i.adset_name
      from public.ad_pack_inventory i
      where g.rep_date is null
        and i.user_id = g.rep_user_id
        and i.pack_id = any(coalesce(p_pack_ids, v_pack_universe))
        and i.ad_id = g.rep_ad_id
      order by i.last_active_date desc, i.pack_id
      limit 1
    ) ri on true
  ),
  -- (v161) A ORDEM, calculada sobre `grp` — as somas, sem nomes, miniaturas nem
  -- histogramas. A v155 ordenava as linhas LARGAS (1,7 KB cada) e depois as copiava
  -- de novo para numerar e paginar: medido em produção (16/09, 51 mil linhas), duas
  -- ordenações de 75–80 MB escritas em disco a cada requisição. Aqui a posição de
  -- cada grupo vira um dicionário {group_key: posição}; as linhas largas não são
  -- ordenadas por ninguém — a saída leva a posição numa coluna (`row_order`) e o
  -- leitor as põe na ordem.
  -- Mesmas expressões e mesmo desempate (group_key) do `ordered` da v155, sobre os
  -- mesmos valores (as métricas de `rows_metrics` são essas fórmulas sobre `grp`).
  ranked as (
    select
      g.group_key,
      row_number() over (
        order by
          case when v_order_by = 'cpr' then d.cpr end asc nulls last,
          case when v_order_by = 'hook' then d.hook end desc nulls last,
          case when v_order_by = 'hold_rate' then d.hold_rate end desc nulls last,
          case when v_order_by = 'spend' then g.spend end desc nulls last,
          case when v_order_by = 'ctr' then d.ctr end desc nulls last,
          case when v_order_by = 'connect_rate' then d.connect_rate end desc nulls last,
          case when v_order_by = 'page_conv' then d.page_conv end desc nulls last,
          case when v_order_by = 'cpm' then d.cpm end desc nulls last,
          case when v_order_by = 'website_ctr' then d.website_ctr end desc nulls last,
          case when v_order_by = 'results' then g.results end desc nulls last,
          case
            when v_order_by not in ('cpr', 'hook', 'hold_rate', 'spend', 'ctr', 'connect_rate', 'page_conv', 'cpm', 'website_ctr', 'results')
            then g.spend
          end desc nulls last,
          g.group_key
      ) as ord
    from grp g
    cross join lateral (
      select
        case when g.results > 0 then g.spend / g.results else 0 end as cpr,
        case when g.plays > 0 then g.hook_wsum / g.plays else 0 end as hook,
        case when g.plays > 0 then g.hold_rate_wsum / g.plays else 0 end as hold_rate,
        case when g.impressions > 0 then g.clicks::numeric / g.impressions else 0 end as ctr,
        case when g.inline_link_clicks > 0 then g.lpv::numeric / g.inline_link_clicks else 0 end as connect_rate,
        case when g.lpv > 0 then g.results / g.lpv else 0 end as page_conv,
        case when g.impressions > 0 then (g.spend * 1000.0) / g.impressions else 0 end as cpm,
        case when g.impressions > 0 then g.inline_link_clicks::numeric / g.impressions else 0 end as website_ctr
    ) d
  ),
  rank_dict as (
    select coalesce(jsonb_object_agg(r.group_key, r.ord), '{}'::jsonb) as m
    from ranked r
  ),
  -- (v161) UMA passada pelos representantes para tudo que é por nome: os nomes a
  -- buscar (mídia/transcrição/tags) e os pares id -> nome que as linhas já trouxeram
  -- de `ads` (dicionário `names`). Cada leitura extra de `grp_rep` relia do disco a
  -- cópia dela (40 MB com 26 mil linhas).
  -- Pares por `jsonb_object_agg`: com id repetido fica um dos nomes — e um id tem um
  -- nome só (conferido em 16/09 sobre todo o banco: nenhuma das 2.719 campanhas e dos
  -- 8.086 conjuntos tem dois nomes entre os anúncios).
  rep_scan as materialized (
    select
      array_agg(distinct g.name_key) filter (
        where v_group_by in ('ad_name', 'ad_id') and g.name_key is not null
      ) as name_keys,
      coalesce(jsonb_object_agg(g.ra_campaign_id, g.ra_campaign_name) filter (
        where g.ra_campaign_id is not null and nullif(g.ra_campaign_name, '') is not null
      ), '{}'::jsonb) as campaign_names,
      coalesce(jsonb_object_agg(g.ra_adset_id, g.ra_adset_name) filter (
        where g.ra_adset_id is not null and nullif(g.ra_adset_name, '') is not null
      ), '{}'::jsonb) as adset_names
    from grp_rep g
  ),
  -- (v161) Mídia, transcrição e tags dependem só do NOME. Nas laterais da v155 cada
  -- linha relia todos os anúncios irmãos: no nível por anúncio isso é N² (medido em
  -- 16/09: 26 mil linhas x 353 irmãos = 9 milhões de leituras, ~9 s). Aqui cada nome
  -- é lido uma vez e juntado por igualdade.
  name_keys as materialized (
    select unnest(rs.name_keys) as name_key
    from rep_scan rs
  ),
  mt_by_name as materialized (
    select a.ad_name as name_key,
           case max(case a.media_type when 'video' then 2 when 'image' then 1 end)
             when 2 then 'video' when 1 then 'image' end as media_type
    from name_keys n
    join public.ads a
      on a.user_id = any(v_owners)
     and a.ad_name = n.name_key
    group by a.ad_name
  ),
  tr_by_name as materialized (
    -- 142: estado da mídia (transcrito / sem áudio); ver a v155 para o porquê.
    select t.ad_name as name_key,
           bool_or(t.status = 'completed') as has_transcription,
           bool_or(t.status = 'failed' and coalesce(t.metadata ->> 'no_voice_detected', '') = 'true') as no_audio
    from name_keys n
    join public.ad_transcriptions t
      on t.user_id = any(v_owners)
     and t.ad_name = n.name_key
    group by t.ad_name
  ),
  tg_by_name as materialized (
    -- v139: tags do SILO DO PACK.
    select atg.ad_name as name_key,
           jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'color', t.color) order by t.name, t.id) as tags
    from name_keys n
    join public.ad_tags atg
      on atg.user_id = any(v_owners)
     and atg.ad_name = n.name_key
    join public.tags t on t.id = atg.tag_id and t.user_id = atg.user_id
    group by atg.ad_name
  ),
  -- (v161) DICIONÁRIOS em vez de junções. Juntar uma CTE com outra deixa o plano
  -- à mercê da estimativa (1 linha para tudo que deriva da seleção): no laboratório,
  -- em 16/09, a mera troca de estimativa fez `leads_by_group` ser relido INTEIRO para
  -- cada linha (14.886 x 4.522 = 67 milhões de linhas, ~15 s). A v155 só escapava
  -- porque o plano sorteado era outro. Um objeto {chave: valor} montado uma vez e lido
  -- por subconsulta escalar não depende de estimativa nenhuma (o mesmo `ck` da 157).
  name_dict as (
    select coalesce(jsonb_object_agg(s.name_key, s.o), '{}'::jsonb) as m
    from (
      select p.name_key, jsonb_object_agg(p.kind, p.v) as o
      from (
        select name_key, 'mt'::text as kind, to_jsonb(media_type) as v from mt_by_name
        union all
        select name_key, 'ht', to_jsonb(has_transcription) from tr_by_name
        union all
        select name_key, 'na', to_jsonb(no_audio) from tr_by_name
        union all
        select name_key, 'tg', tags from tg_by_name
      ) p
      group by p.name_key
    ) s
  ),
  leads_dict as (
    select coalesce(jsonb_object_agg(l.group_key, l.leadscore_histogram), '{}'::jsonb) as m
    from leads_by_group l
  ),
  custom_dict as (
    select coalesce(jsonb_object_agg(c.group_key, c.custom_histograms), '{}'::jsonb) as m
    from custom_by_group c
  ),
  rows_enriched as (
    select
      g.group_key,
      g.rep_account_id as account_id,
      g.account_ids,
      g.campaign_ids,
      g.adset_ids,
      coalesce((
        select array_agg(v_pack_universe[i] order by i)
        from generate_series(1, v_n_packs) i
        where get_bit(g.pack_mask, i - 1) = 1
      ), array[]::uuid[]) as pack_ids,
      g.rep_campaign_id as campaign_id,
      g.rep_campaign_name as campaign_name,
      g.rep_adset_id as adset_id,
      g.rep_adset_name as adset_name,
      g.rep_ad_id,
      g.rep_ad_name,
      nd.ord,
      case
        when v_group_by = 'campaign_id' then coalesce(nullif(g.rep_campaign_name, ''), g.group_key)
        when v_group_by = 'adset_id' then coalesce(nullif(g.rep_adset_name, ''), g.group_key)
        else coalesce(nullif(g.rep_ad_name, ''), g.rep_ad_id)
      end as label_name,
      case
        when v_group_by = 'campaign_id' then null
        when coalesce(g.has_active, false) then 'ACTIVE'
        else coalesce(g.fallback_status, g.ra_effective_status)
      end as effective_status,
      case
        when v_group_by = 'campaign_id' then null
        else coalesce(g.active_count, 0)
      end as active_count,
      -- Contadores de motivo SO nas abas que agregam anuncios. Em conjunto e
      -- campanha a linha E a propria entidade, e o status dela vem de
      -- `parent_entities` (o estado do Meta) - mandar contadores la faria a tela
      -- classificar um CONJUNTO pausado como "pausado pelo conjunto", que e a
      -- resposta certa para o anuncio e errada para o conjunto. A ausencia e o
      -- sinal: sem contadores, a tela le `effective_status` direto.
      case when v_group_by in ('ad_name', 'ad_id') then coalesce(g.paused_self_count, 0) end as paused_self_count,
      case when v_group_by in ('ad_name', 'ad_id') then coalesce(g.adset_paused_count, 0) end as adset_paused_count,
      case when v_group_by in ('ad_name', 'ad_id') then coalesce(g.campaign_paused_count, 0) end as campaign_paused_count,
      g.impressions, g.clicks, g.inline_link_clicks, g.spend, g.lpv, g.plays, g.thruplays,
      g.hook_wsum, g.hold_rate_wsum, g.video_watched_p50_wsum, g.video_watched_p75_wsum,
      g.scroll_stop_wsum, g.reach, g.frequency_wsum,
      case when v_group_by = 'campaign_id' then g.adset_count else g.ad_id_count end as ad_count,
      -- Chave do histograma normalizada (80.0 → "80"); a v116 mandava o array cru.
      coalesce(nd.lh, '{}'::jsonb) as leadscore_histogram,
      -- 140: {"<mapping_id>": {"<valor>": quantidade}}; {} quando nao pedido ou sem dado.
      coalesce(nd.ch, '{}'::jsonb) as custom_histograms,
      g.results,
      g.meta_created_min,
      coalesce(nullif(g.ra_thumbnail_url, ''), nullif(g.ra_first_video_thumb, '')) as thumbnail,
      coalesce(nullif(g.ra_thumb_storage_path, ''), g.any_thumb_storage_path) as thumb_storage_path,
      coalesce(nd.o -> 'tg', '[]'::jsonb) as tags,
      -- v132: o que a rota hidratava com 15 requisições e 13,7 mil linhas por carga
      -- (medido) agora vem daqui. Só nos níveis de criativo/anúncio, como a hidratação
      -- fazia (num nível de conjunto/campanha o "ad_name" é o nome do pai).
      -- media_type = maior precedência entre as cópias do nome (vídeo > imagem; 'unknown'
      -- e NULL ignorados) — a semântica exata de _hydrate_media_type_for_rankings_rows.
      case
        when v_group_by in ('ad_name', 'ad_id') then nd.o ->> 'mt'
        else null
      end as media_type,
      case
        when v_group_by in ('ad_name', 'ad_id') then coalesce((nd.o ->> 'ht')::boolean, false)
        else false
      end as has_transcription,
      -- Transcrito GANHA de sem-audio: num pack compartilhado os dois silos podem ter
      -- registros diferentes para o mesmo ad_name, e o texto que existe de fato vale
      -- mais do que a falha registrada no silo vizinho.
      case
        when v_group_by in ('ad_name', 'ad_id')
          then coalesce((nd.o ->> 'na')::boolean, false) and not coalesce((nd.o ->> 'ht')::boolean, false)
        else false
      end as transcription_no_audio
    from grp_rep g
    -- (v161) uma leitura por linha em cada dicionário; as subconsultas escalares
    -- não dependem da linha e rodam uma vez só.
    cross join lateral (
      select
        (select d.m from name_dict d) -> g.name_key as o,
        (select d.m from leads_dict d) -> g.group_key as lh,
        (select d.m from custom_dict d) -> g.group_key as ch,
        ((select d.m from rank_dict d) ->> g.group_key)::integer as ord
    ) nd
  ),
  rows_metrics as (
    select
      re.*,
      case when re.plays > 0 then re.hook_wsum / re.plays else 0 end as hook,
      case when re.plays > 0 then re.hold_rate_wsum / re.plays else 0 end as hold_rate,
      round(case when re.plays > 0 then re.video_watched_p50_wsum / re.plays else 0 end)::int as video_watched_p50,
      round(case when re.plays > 0 then re.video_watched_p75_wsum / re.plays else 0 end)::int as video_watched_p75,
      case when re.plays > 0 then re.scroll_stop_wsum / re.plays else 0 end as scroll_stop,
      case when re.impressions > 0 then re.clicks::numeric / re.impressions else 0 end as ctr,
      case when re.inline_link_clicks > 0 then re.lpv::numeric / re.inline_link_clicks else 0 end as connect_rate,
      case when re.impressions > 0 then (re.spend * 1000.0) / re.impressions else 0 end as cpm,
      case when re.impressions > 0 then re.inline_link_clicks::numeric / re.impressions else 0 end as website_ctr,
      case when re.impressions > 0 then re.frequency_wsum / re.impressions else 0 end as frequency,
      case when re.results > 0 then re.spend / re.results else 0 end as cpr,
      case when re.lpv > 0 then re.results / re.lpv else 0 end as page_conv,
      case when v_selected_key <> '' then jsonb_build_object(v_selected_key, re.results) else '{}'::jsonb end as conversions
    from rows_enriched re
  ),
  totals as (
    select
      coalesce(sum(rm.spend), 0)::numeric as total_spend,
      coalesce(sum(rm.impressions), 0)::bigint as total_impressions,
      coalesce(sum(rm.clicks), 0)::bigint as total_clicks,
      coalesce(sum(rm.inline_link_clicks), 0)::bigint as total_inline,
      coalesce(sum(rm.lpv), 0)::bigint as total_lpv,
      coalesce(sum(rm.plays), 0)::bigint as total_plays,
      coalesce(sum(rm.hook_wsum), 0)::numeric as total_hook_wsum,
      coalesce(sum(rm.hold_rate_wsum), 0)::numeric as total_hold_rate_wsum,
      coalesce(sum(rm.video_watched_p50_wsum), 0)::numeric as total_video_watched_p50_wsum,
      coalesce(sum(rm.video_watched_p75_wsum), 0)::numeric as total_video_watched_p75_wsum,
      coalesce(sum(rm.scroll_stop_wsum), 0)::numeric as total_scroll_stop_wsum,
      coalesce(sum(rm.results), 0)::numeric as total_results
    -- (v161) de `grp`, e não de `rows_metrics`: mesmas somas (uma linha por grupo nos
    -- dois), sem obrigar a guardar as linhas LARGAS para ler três vezes.
    from grp rm
  ),
  -- Tipos disponíveis + per_action_type de TODAS as chaves: só quando pedido (o
  -- predicado é constante sob force_custom_plan → o planner poda o ramo inteiro).
  -- Relê a seleção estreita (keys, já materializada) + filtros de nome em ad_metrics +
  -- os arrays do rollup; sem JSON.
  -- Soma por key_id ANTES de juntar com o dicionário: são ≤ 81 linhas depois do GROUP
  -- BY. Juntar antes custou 10,6 s no cenário de 30 packs (826 mil pares desempacotados
  -- materializados e varridos uma vez por chave do dicionário).
  conv_all as (
    select ck.key as conv_key, c.total_results
    from (
    select pr.key_id, sum(pr.value)::numeric as total_results
    from keys k
    join public.ad_performance_daily d on d.user_id = k.user_id and d.pack_id = k.pack_id and d.ad_id = k.ad_id and d.date = k.date
    cross join lateral unnest(d.conv_key_ids, d.conv_values) as pr(key_id, value)
    where v_include_conv_types
      and coalesce(case
        when v_group_by = 'ad_id' then d.ad_id
        when v_group_by = 'ad_name' then coalesce(nullif(d.ad_name, ''), d.ad_id)
        when v_group_by = 'adset_id' then d.adset_id
        when v_group_by = 'campaign_id' then d.campaign_id
        else d.ad_id end, '') <> ''
      and (p_account_ids is null or d.account_id = any(p_account_ids))
      and (p_ad_name_contains is null or p_ad_name_contains = ''
           or coalesce(d.ad_name, '') ilike '%' || p_ad_name_contains || '%')
      and (
        (coalesce(p_campaign_name_contains, '') = '' and coalesce(p_adset_name_contains, '') = '')
        or exists (
          select 1 from public.ad_metrics am where am.user_id = k.user_id and am.pack_id = k.pack_id and am.ad_id = k.ad_id and am.date = k.date
            and (coalesce(p_campaign_name_contains, '') = ''
                 or coalesce(am.campaign_name, '') ilike '%' || p_campaign_name_contains || '%')
            and (coalesce(p_adset_name_contains, '') = ''
                 or coalesce(am.adset_name, '') ilike '%' || p_adset_name_contains || '%')
        )
      )
    group by pr.key_id
    ) c
    join public.conversion_keys ck on ck.id = c.key_id
  ),
  available_types as (
    select coalesce(jsonb_agg(c.conv_key order by c.conv_key), '[]'::jsonb) as conv_types
    from conv_all c
  ),
  per_action_all as (
    select coalesce(
      jsonb_object_agg(
        c.conv_key,
        jsonb_build_object(
          'results', c.total_results,
          'cpr', case when c.total_results > 0 then t.total_spend / c.total_results else 0 end,
          'page_conv', case when t.total_lpv > 0 then c.total_results / t.total_lpv else 0 end
        )
        order by c.conv_key
      ),
      '{}'::jsonb
    ) as per_action_type
    from conv_all c
    cross join totals t
  ),
  per_action_selected as (
    select
      case
        when v_selected_key <> '' then jsonb_build_object(
          v_selected_key,
          jsonb_build_object(
            'results', t.total_results,
            'cpr', case when t.total_results > 0 then t.total_spend / t.total_results else 0 end,
            'page_conv', case when t.total_lpv > 0 then t.total_results / t.total_lpv else 0 end
          )
        )
        else '{}'::jsonb
      end as per_action_type
    from totals t
  ),
  averages_payload as (
    select jsonb_build_object(
      'hook', case when t.total_plays > 0 then t.total_hook_wsum / t.total_plays else 0 end,
      'hold_rate', case when t.total_plays > 0 then t.total_hold_rate_wsum / t.total_plays else 0 end,
      'video_watched_p50', case when t.total_plays > 0 then t.total_video_watched_p50_wsum / t.total_plays else 0 end,
      'video_watched_p75', case when t.total_plays > 0 then t.total_video_watched_p75_wsum / t.total_plays else 0 end,
      'scroll_stop', case when t.total_plays > 0 then t.total_scroll_stop_wsum / t.total_plays else 0 end,
      'ctr', case when t.total_impressions > 0 then t.total_clicks::numeric / t.total_impressions else 0 end,
      'website_ctr', case when t.total_impressions > 0 then t.total_inline::numeric / t.total_impressions else 0 end,
      'connect_rate', case when t.total_inline > 0 then t.total_lpv::numeric / t.total_inline else 0 end,
      'cpm', case when t.total_impressions > 0 then (t.total_spend * 1000.0) / t.total_impressions else 0 end,
      'cpc', case when t.total_clicks > 0 then t.total_spend / t.total_clicks else 0 end,
      'cplc', case when t.total_inline > 0 then t.total_spend / t.total_inline else 0 end,
      'per_action_type', case when v_include_conv_types then paa.per_action_type else pas.per_action_type end
    ) as averages
    from totals t
    cross join per_action_all paa
    cross join per_action_selected pas
  ),
  header_payload as (
    select jsonb_build_object(
      'sums', jsonb_build_object(
        'spend', t.total_spend,
        'results', t.total_results,
        'mqls', to_jsonb(null::numeric)
      ),
      'weighted_averages', jsonb_build_object(
        'hook', case when t.total_plays > 0 then t.total_hook_wsum / t.total_plays else 0 end,
        'scroll_stop', case when t.total_plays > 0 then t.total_scroll_stop_wsum / t.total_plays else 0 end,
        'ctr', case when t.total_impressions > 0 then t.total_clicks::numeric / t.total_impressions else 0 end,
        'website_ctr', case when t.total_impressions > 0 then t.total_inline::numeric / t.total_impressions else 0 end,
        'connect_rate', case when t.total_inline > 0 then t.total_lpv::numeric / t.total_inline else 0 end,
        'cpm', case when t.total_impressions > 0 then (t.total_spend * 1000.0) / t.total_impressions else 0 end,
        'page_conv', case when t.total_lpv > 0 then t.total_results / t.total_lpv else 0 end
      )
    ) as header_aggregates
    from totals t
  ),
  -- (v161) As linhas que SAEM, em versão ESTREITA: posição, ids do pai e as listas de
  -- ids (para o dicionário de nomes). Página e filtro por campanha como na v155:
  -- paginação sobre a ordem completa; o filtro por campanha (antes um "fold" que relia
  -- o JSON pronto) depois dela, sem mexer em médias e tipos de conversão.
  page_reps as materialized (
    select g.group_key, x.ord, g.rep_adset_id, g.rep_campaign_id, g.campaign_ids, g.adset_ids
    from grp_rep g
    cross join lateral (
      select ((select d.m from rank_dict d) ->> g.group_key)::integer as ord
    ) x
    where x.ord between v_offset + 1 and v_offset + v_limit
      and (v_campaign is null or coalesce(g.rep_campaign_id, '') = v_campaign)
  ),
  -- (v161) O que o invólucro core_v2 fazia nas abas de conjunto e campanha, relendo o
  -- JSON e consultando `ads` linha a linha: status efetivo, orçamento e moeda. Aqui por
  -- conjunto — os anúncios pausados do ATOR (p_user_id, como no core_v2) lidos uma vez.
  paused_ads as materialized (
    select a.adset_id, a.campaign_id, upper(coalesce(a.effective_status, '')) as st
    from public.ads a
    where v_group_by in ('adset_id', 'campaign_id')
      and a.user_id = p_user_id
      and upper(coalesce(a.effective_status, '')) in ('ADSET_PAUSED', 'CAMPAIGN_PAUSED')
  ),
  adset_flags as (
    select pa.adset_id,
           bool_or(pa.st = 'ADSET_PAUSED') as adset_paused,
           bool_or(pa.st = 'CAMPAIGN_PAUSED') as campaign_paused
    from paused_ads pa
    where pa.adset_id is not null
    group by pa.adset_id
  ),
  campaign_flags as (
    select pa.campaign_id,
           bool_or(pa.st = 'CAMPAIGN_PAUSED') as campaign_paused
    from paused_ads pa
    where pa.campaign_id is not null
    group by pa.campaign_id
  ),
  parent_keys as (
    -- `btrim` sem lista = só espaços, como o `trim()` do core_v2.
    select pr.group_key,
           nullif(btrim(coalesce(pr.rep_adset_id, '')), '') as k_adset,
           nullif(btrim(coalesce(pr.rep_campaign_id, '')), '') as k_campaign
    from page_reps pr
    where v_group_by in ('adset_id', 'campaign_id')
  ),
  parent_row as (
    select
      pk.group_key,
      case
        when v_group_by = 'adset_id' and pk.k_adset is not null then
          coalesce(
            nullif(pb_self.effective_status, ''),
            case
              when coalesce(af.adset_paused, false) then 'ADSET_PAUSED'
              when coalesce(af.campaign_paused, false) then 'CAMPAIGN_PAUSED'
              else 'ACTIVE'
            end)
        when v_group_by = 'campaign_id' and pk.k_campaign is not null then
          coalesce(
            nullif(pb_self.effective_status, ''),
            case when coalesce(cf.campaign_paused, false) then 'CAMPAIGN_PAUSED' else 'ACTIVE' end)
        else 'ACTIVE'
      end as effective_status,
      pb_self.daily_budget as budget_daily,
      pb_self.lifetime_budget as budget_lifetime,
      pb_mode.budget_mode,
      acct.currency as budget_currency,
      case when v_group_by = 'adset_id' then pb_self.ads_count end as self_ads_count
    from parent_keys pk
    -- PK (user_id, entity_id): o `limit 1` do core_v2 era no máximo uma linha mesmo.
    left join public.parent_entities pb_self
      on pb_self.user_id = p_user_id
     and pb_self.entity_id = case when v_group_by = 'adset_id' then pk.k_adset else pk.k_campaign end
    left join public.parent_entities pb_mode
      on pb_mode.user_id = p_user_id
     and pb_mode.entity_id = pk.k_campaign
    left join adset_flags af on af.adset_id = pk.k_adset
    left join campaign_flags cf on cf.campaign_id = pk.k_campaign
    left join lateral (
      select aa.currency
      from public.ad_accounts aa
      where aa.user_id = p_user_id
        and replace(aa.id, 'act_', '') = replace(pb_self.account_id, 'act_', '')
        and nullif(aa.currency, '') is not null
      limit 1
    ) acct on true
  ),
  -- Dicionário em vez de junção (vazio nas abas de anúncio): juntar com as linhas
  -- obrigava a ordenar as linhas LARGAS pela chave (40 MB em disco com 26 mil).
  parent_dict as (
    select coalesce(jsonb_object_agg(p.group_key, jsonb_build_object(
             'st', p.effective_status,
             'bd', p.budget_daily,
             'bl', p.budget_lifetime,
             'bm', p.budget_mode,
             'bc', p.budget_currency,
             'ac', p.self_ads_count)), '{}'::jsonb) as m
    from parent_row p
  ),
  -- (v161) A linha final, com o que a ROTA fazia em Python depois da consulta:
  --   * miniatura do Storage: `_hydrate_storage_thumbnails_for_rankings_rows`
  --     (linha sem ad_id fica como está; miniatura que já é do Storage fica; com
  --     caminho, vira prefixo + caminho codificado como o `_quote_path`);
  --   * `status_resolved`: `bool(str(status).strip())`, falso para nulo.
  -- `rows_metrics` tem este consumidor só: as linhas largas passam direto para a
  -- montagem das colunas, sem cópia no meio.
  out_rows as (
    select
      pf.ord,
      pf.group_key,
      pf.account_id,
      pf.account_ids,
      pf.campaign_ids,
      pf.adset_ids,
      pf.pack_ids,
      pf.tags,
      pf.meta_created_min,
      pf.campaign_id,
      pf.campaign_name,
      pf.adset_id,
      pf.adset_name,
      pf.rep_ad_id,
      pf.label_name,
      x.final_status,
      coalesce(btrim(x.final_status, v_ws) <> '', false) as status_resolved,
      pf.active_count,
      pf.paused_self_count,
      pf.adset_paused_count,
      pf.campaign_paused_count,
      case
        when v_group_by in ('adset_id', 'campaign_id') then coalesce((pp.pd ->> 'ac')::integer, pf.ad_count)
        else pf.ad_count
      end as ad_count,
      case
        when btrim(coalesce(pf.rep_ad_id, ''), v_ws) = '' then x.thumb_sql
        when strpos(coalesce(x.thumb_sql, ''), '/storage/v1/object/public/') > 0 then x.thumb_sql
        when p_thumb_public_prefix is not null
         and btrim(coalesce(pf.thumb_storage_path, ''), v_ws) <> ''
          then p_thumb_public_prefix || public.url_quote_path(btrim(pf.thumb_storage_path, v_ws))
        else x.thumb_sql
      end as thumbnail,
      pf.thumb_storage_path,
      pf.media_type,
      pf.has_transcription,
      pf.transcription_no_audio,
      pf.impressions,
      pf.clicks,
      pf.inline_link_clicks,
      pf.spend,
      pf.lpv,
      pf.plays,
      pf.thruplays,
      pf.hook,
      pf.hold_rate,
      pf.video_watched_p50,
      pf.video_watched_p75,
      pf.scroll_stop,
      pf.ctr,
      pf.connect_rate,
      pf.cpm,
      pf.website_ctr,
      pf.reach,
      pf.frequency,
      pf.leadscore_histogram,
      pf.custom_histograms,
      pf.conversions,
      (pp.pd ->> 'bd')::bigint as budget_daily,
      (pp.pd ->> 'bl')::bigint as budget_lifetime,
      pp.pd ->> 'bm' as budget_mode,
      pp.pd ->> 'bc' as budget_currency
    from rows_metrics pf
    cross join lateral (
      select (select d.m from parent_dict d) -> pf.group_key as pd
    ) pp
    cross join lateral (
      select
        case
          when v_group_by in ('adset_id', 'campaign_id') then pp.pd ->> 'st'
          else pf.effective_status
        end as final_status,
        case
          when v_group_by in ('ad_name', 'ad_id') and pf.thumb_storage_path is not null then null
          else pf.thumbnail
        end as thumb_sql
    ) x
    where pf.ord between v_offset + 1 and v_offset + v_limit
      and (v_campaign is null or coalesce(pf.campaign_id, '') = v_campaign)
  ),
  -- (v161) A SAÍDA EM COLUNAS: uma lista por campo. Medido com 10 mil linhas reais: 45%
  -- menos na rede do que um objeto por linha, porque valores parecidos ficam juntos.
  -- `json_build_object` aceita no máximo 100 argumentos (50 campos), daí os blocos; o
  -- leitor funde todos.
  -- SEM `order by` nas agregações, de propósito: ordenar aqui ordenaria as linhas
  -- largas (o que a ordem estreita acima existe para evitar). Um único nó de agregação
  -- alimenta todas as listas com as mesmas linhas na mesma sequência, então as
  -- colunas ficam alinhadas entre si; `row_order` diz a posição final de cada linha, e
  -- o leitor reordena (`app/services/manager_columns.py`, `lib/api/managerColumns.ts`).
  -- (v162) A SAÍDA EM COLUNAS, uma agregação por campo e NENHUMA montagem por cima:
  -- a v161 embrulhava as listas em blocos, lista e objeto, e cada camada era uma
  -- cópia viva até o fim da consulta (pico medido: ~11x o tamanho da resposta).
  -- Razões em float8: o mesmo número no navegador, com metade dos dígitos.
  -- SEM `order by` (ver `row_order`): um único nó de agregação mantém as listas
  -- alinhadas entre si.
  cols as (
    select
      count(*)::integer as n,
      json_agg(o.ord) as row_order,
      json_agg(o.group_key) as c_group_key,
      json_agg(null::text) as c_unique_id,
      json_agg(o.account_id) as c_account_id,
      json_agg(o.account_ids) as c_account_ids,
      json_agg(o.campaign_ids) as c_campaign_ids,
      json_agg(o.adset_ids) as c_adset_ids,
      json_agg(o.pack_ids) as c_pack_ids,
      json_agg(o.tags) as c_tags,
      json_agg(o.meta_created_min) as c_meta_created_time,
      json_agg(o.campaign_id) as c_campaign_id,
      json_agg(o.campaign_name) as c_campaign_name,
      json_agg(o.adset_id) as c_adset_id,
      json_agg(o.adset_name) as c_adset_name,
      json_agg(o.rep_ad_id) as c_ad_id,
      json_agg(o.label_name) as c_ad_name,
      json_agg(o.final_status) as c_effective_status,
      json_agg(o.status_resolved) as c_status_resolved,
      json_agg(o.active_count) as c_active_count,
      json_agg(o.paused_self_count) as c_paused_self_count,
      json_agg(o.adset_paused_count) as c_adset_paused_count,
      json_agg(o.campaign_paused_count) as c_campaign_paused_count,
      json_agg(o.ad_count) as c_ad_count,
      json_agg(o.thumbnail) as c_thumbnail,
      json_agg(o.thumb_storage_path) filter (where p_thumb_public_prefix is null) as c_thumb_storage_path,
      json_agg(o.media_type) as c_media_type,
      json_agg(o.has_transcription) as c_has_transcription,
      json_agg(o.transcription_no_audio) as c_transcription_no_audio,
      json_agg(o.impressions) as c_impressions,
      json_agg(o.clicks) as c_clicks,
      json_agg(o.inline_link_clicks) as c_inline_link_clicks,
      json_agg(o.spend) as c_spend,
      json_agg(o.lpv) as c_lpv,
      json_agg(o.plays) as c_plays,
      json_agg(o.thruplays) as c_video_total_thruplays,
      json_agg(o.hook::float8) as c_hook,
      json_agg(o.hold_rate::float8) as c_hold_rate,
      json_agg(o.video_watched_p50) as c_video_watched_p50,
      json_agg(o.video_watched_p75) as c_video_watched_p75,
      json_agg(o.scroll_stop::float8) as c_scroll_stop,
      json_agg(o.ctr::float8) as c_ctr,
      json_agg(o.connect_rate::float8) as c_connect_rate,
      json_agg(o.cpm::float8) as c_cpm,
      json_agg(o.website_ctr::float8) as c_website_ctr,
      json_agg(o.reach) as c_reach,
      json_agg(o.frequency::float8) as c_frequency,
      json_agg(o.leadscore_histogram) as c_leadscore_histogram,
      json_agg(o.custom_histograms) as c_custom_histograms,
      json_agg(o.conversions) as c_conversions,
      json_agg(o.budget_daily) filter (where v_group_by in ('adset_id', 'campaign_id')) as c_budget_daily,
      json_agg(o.budget_lifetime) filter (where v_group_by in ('adset_id', 'campaign_id')) as c_budget_lifetime,
      json_agg(o.budget_mode) filter (where v_group_by in ('adset_id', 'campaign_id')) as c_budget_mode,
      json_agg(o.budget_currency) filter (where v_group_by in ('adset_id', 'campaign_id')) as c_budget_currency
    from out_rows o
  ),
  -- Dicionario id -> nome, so das campanhas/conjuntos citados nas linhas que SAEM
  -- (v161: depois do filtro por campanha — o mesmo resultado da poda que a v155
  -- fazia no fold). O nome NAO viaja por linha.
  paged_parent_ids as (
    select
      coalesce((select array_agg(distinct c) from page_reps p, unnest(p.campaign_ids) c where c is not null), array[]::text[]) as campaign_ids,
      coalesce((select array_agg(distinct a) from page_reps p, unnest(p.adset_ids) a where a is not null), array[]::text[]) as adset_ids
  ),
  -- (v161) Para cada id citado: o nome que as linhas JÁ trouxeram de `ads` (rep_scan);
  -- senão, `ads` (como a v155 fazia para todos). Na v155 esta leitura era, no pior
  -- caso medido (16/09, 38 packs, 51 mil linhas), 54 mil buscas aleatórias e ~26 s —
  -- o maior custo da consulta inteira. A condição sobre o dicionário não depende da
  -- tabela e vira One-Time Filter: a busca só acontece para o id desconhecido (nas
  -- abas agregadas, as campanhas que nenhum representante trouxe).
  names_payload as (
    select jsonb_build_object(
      'campaigns', coalesce((
        select jsonb_object_agg(x.id, x.name)
        from (
          select c.id,
                 coalesce((select rs.campaign_names from rep_scan rs) ->> c.id, lk.name) as name
          from paged_parent_ids pp
          cross join lateral unnest(pp.campaign_ids) as c(id)
          left join lateral (
            select max(a.campaign_name) as name
            from public.ads a
            where ((select rs.campaign_names from rep_scan rs) ->> c.id) is null
              and a.user_id = any(v_owners)
              and a.campaign_id = c.id
              and nullif(a.campaign_name, '') is not null
          ) lk on true
        ) x
        where x.name is not null
      ), '{}'::jsonb),
      'adsets', coalesce((
        select jsonb_object_agg(x.id, x.name)
        from (
          select c.id,
                 coalesce((select rs.adset_names from rep_scan rs) ->> c.id, lk.name) as name
          from paged_parent_ids pp
          cross join lateral unnest(pp.adset_ids) as c(id)
          left join lateral (
            select max(a.adset_name) as name
            from public.ads a
            where ((select rs.adset_names from rep_scan rs) ->> c.id) is null
              and a.user_id = any(v_owners)
              and a.adset_id = c.id
              and nullif(a.adset_name, '') is not null
          ) lk on true
        ) x
        where x.name is not null
      ), '{}'::jsonb)
    ) as names
  ),
  pagination_payload as (
    select case
      when v_campaign is not null then
        -- como o fold da v155: paginação zerada e total = linhas que sobraram
        -- (v162) o total entra na linha de metadados, que já lê `cols`
        null::jsonb
      else
        jsonb_build_object('limit', v_limit, 'offset', v_offset,
                           'total', tc.total, 'has_more', (v_offset + v_limit) < tc.total)
    end as pagination
    -- (v161) contagem de `grp`: uma linha por grupo, como `rows_metrics`.
    from (select count(*)::integer as total from grp) tc
  )
  -- (v161) sem `overlap`: `keys.x_cross_silo` é a constante false nos dois ramos da
  -- seleção, então a v155 nunca emitia a chave — mas pagava uma varredura de `keys`
  -- inteira para contar zero (169 ms no caso do Igor).
  -- (v162) UMA LINHA POR PEDAÇO: metadados ({row_count, row_order, names, ...}) e um
  -- objeto {campo: [valores]} por campo. `return query` manda cada linha para o
  -- armazenamento da função (que vai a disco além do work_mem) e o PostgREST as junta
  -- num array. Nenhum pedaço depende da ordem das linhas: o leitor funde os objetos.
  select x.v
  from cols c
  cross join lateral (values
    (json_build_object(
      'row_count', c.n,
      'row_order', c.row_order,
      'names', coalesce((select names from names_payload), '{}'::jsonb),
      'available_conversion_types',
        case when v_include_conv_types then coalesce((select conv_types from available_types), '[]'::jsonb) else '[]'::jsonb end,
      'averages', coalesce((select averages from averages_payload), '{}'::jsonb),
      'header_aggregates', coalesce((select header_aggregates from header_payload), '{}'::jsonb),
      'pagination', case
        when v_campaign is not null then
          jsonb_build_object('limit', v_limit, 'offset', 0, 'total', c.n, 'has_more', false)
        else (select pagination from pagination_payload)
      end
    )),
    (json_build_object('group_key', c.c_group_key)),
    (json_build_object('unique_id', c.c_unique_id)),
    (json_build_object('account_id', c.c_account_id)),
    (json_build_object('account_ids', c.c_account_ids)),
    (json_build_object('campaign_ids', c.c_campaign_ids)),
    (json_build_object('adset_ids', c.c_adset_ids)),
    (json_build_object('pack_ids', c.c_pack_ids)),
    (json_build_object('tags', c.c_tags)),
    (json_build_object('meta_created_time', c.c_meta_created_time)),
    (json_build_object('campaign_id', c.c_campaign_id)),
    (json_build_object('campaign_name', c.c_campaign_name)),
    (json_build_object('adset_id', c.c_adset_id)),
    (json_build_object('adset_name', c.c_adset_name)),
    (json_build_object('ad_id', c.c_ad_id)),
    (json_build_object('ad_name', c.c_ad_name)),
    (json_build_object('effective_status', c.c_effective_status)),
    (json_build_object('status_resolved', c.c_status_resolved)),
    (json_build_object('active_count', c.c_active_count)),
    (json_build_object('paused_self_count', c.c_paused_self_count)),
    (json_build_object('adset_paused_count', c.c_adset_paused_count)),
    (json_build_object('campaign_paused_count', c.c_campaign_paused_count)),
    (json_build_object('ad_count', c.c_ad_count)),
    (json_build_object('thumbnail', c.c_thumbnail)),
    (case when p_thumb_public_prefix is null then json_build_object('thumb_storage_path', c.c_thumb_storage_path) end),
    (json_build_object('media_type', c.c_media_type)),
    (json_build_object('has_transcription', c.c_has_transcription)),
    (json_build_object('transcription_no_audio', c.c_transcription_no_audio)),
    (json_build_object('impressions', c.c_impressions)),
    (json_build_object('clicks', c.c_clicks)),
    (json_build_object('inline_link_clicks', c.c_inline_link_clicks)),
    (json_build_object('spend', c.c_spend)),
    (json_build_object('lpv', c.c_lpv)),
    (json_build_object('plays', c.c_plays)),
    (json_build_object('video_total_thruplays', c.c_video_total_thruplays)),
    (json_build_object('hook', c.c_hook)),
    (json_build_object('hold_rate', c.c_hold_rate)),
    (json_build_object('video_watched_p50', c.c_video_watched_p50)),
    (json_build_object('video_watched_p75', c.c_video_watched_p75)),
    (json_build_object('scroll_stop', c.c_scroll_stop)),
    (json_build_object('ctr', c.c_ctr)),
    (json_build_object('connect_rate', c.c_connect_rate)),
    (json_build_object('cpm', c.c_cpm)),
    (json_build_object('website_ctr', c.c_website_ctr)),
    (json_build_object('reach', c.c_reach)),
    (json_build_object('frequency', c.c_frequency)),
    (json_build_object('leadscore_histogram', c.c_leadscore_histogram)),
    (json_build_object('custom_histograms', c.c_custom_histograms)),
    (json_build_object('conversions', c.c_conversions)),
    (case when v_group_by in ('adset_id', 'campaign_id') then json_build_object('budget_daily', c.c_budget_daily) end),
    (case when v_group_by in ('adset_id', 'campaign_id') then json_build_object('budget_lifetime', c.c_budget_lifetime) end),
    (case when v_group_by in ('adset_id', 'campaign_id') then json_build_object('budget_mode', c.c_budget_mode) end),
    (case when v_group_by in ('adset_id', 'campaign_id') then json_build_object('budget_currency', c.c_budget_currency) end)
  ) x(v)
  where x.v is not null;

  return;
end;
$$;


ALTER FUNCTION public.fetch_manager_rankings_v162(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text, p_include_custom boolean, p_thumb_public_prefix text) OWNER TO postgres;

--
-- Name: FUNCTION fetch_manager_rankings_v162(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text, p_include_custom boolean, p_thumb_public_prefix text); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.fetch_manager_rankings_v162(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text, p_include_custom boolean, p_thumb_public_prefix text) IS '162: a resposta da v161 em pedaços (SETOF json: 1 linha de metadados + 1 linha {campo: [valores]} por campo), sem montar o JSON inteiro na memória do banco. Sem adcreatives_videos_thumbs; thumb_storage_path só sem prefixo; razões em float8.';


--
-- Name: fetch_manager_rankings_v170(uuid, date, date, text, uuid[], text[], text, text, text, text, boolean, boolean, integer, integer, text, text, boolean, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.fetch_manager_rankings_v170(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text DEFAULT 'ad_name'::text, p_pack_ids uuid[] DEFAULT NULL::uuid[], p_account_ids text[] DEFAULT NULL::text[], p_campaign_name_contains text DEFAULT NULL::text, p_adset_name_contains text DEFAULT NULL::text, p_ad_name_contains text DEFAULT NULL::text, p_action_type text DEFAULT NULL::text, p_include_leadscore boolean DEFAULT true, p_include_available_conversion_types boolean DEFAULT true, p_limit integer DEFAULT 500, p_offset integer DEFAULT 0, p_order_by text DEFAULT 'spend'::text, p_campaign_id text DEFAULT NULL::text, p_include_custom boolean DEFAULT false, p_thumb_public_prefix text DEFAULT NULL::text) RETURNS SETOF json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    SET plan_cache_mode TO 'force_custom_plan'
    SET work_mem TO '16MB'
    AS $$
declare
  v_group_by text := lower(coalesce(p_group_by, 'ad_name'));
  v_order_by text := lower(coalesce(p_order_by, 'spend'));
  v_date_start date := least(p_date_start, p_date_stop);
  v_date_stop date := greatest(p_date_start, p_date_stop);
  -- (v161) teto 100 mil: o de 10 mil cortava a aba "Por anúncio" em silêncio (26 mil
  -- linhas num caso real). É rede de segurança, não orçamento.
  v_limit integer := greatest(1, least(coalesce(p_limit, 500), 100000));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
  v_selected_key text := trim(coalesce(p_action_type, ''));
  v_key_id integer := null;
  v_include_conv_types boolean := coalesce(p_include_available_conversion_types, true);
  v_include_leads boolean := coalesce(p_include_leadscore, true);
  -- 140: histogramas das colunas vinculadas so quando pedidos (opt-in).
  v_include_custom boolean := coalesce(p_include_custom, false);
  -- (v161) filtro por campaign_id (antes: fold sobre o JSON pronto, no fim).
  v_campaign text := nullif(btrim(coalesce(p_campaign_id, '')), '');
  -- (v161) espaços que o `str.strip()` do Python removia na hidratação.
  v_ws constant text := E' \t\n\r\x0b\x0c';
  v_owners uuid[];
  v_requested integer;
  -- universo de packs para a máscara: a seleção pedida, ou (ramo legado) todos os
  -- packs do ator. Posição i do array ↔ bit i-1 da máscara.
  v_pack_universe uuid[];
  v_n_packs integer;
begin
  if auth.uid() is distinct from p_user_id then
    raise exception 'Forbidden: p_user_id must match auth.uid()'
      using errcode = '42501';
  end if;

  if p_pack_ids is null then
    v_owners := array[p_user_id];
    select coalesce(array_agg(id order by id), array[]::uuid[])
      into v_pack_universe
    from public.packs where user_id = p_user_id;
  else
    select array_agg(distinct a.owner_id), count(distinct a.pack_id)
      into v_owners, v_requested
    from public.resolve_pack_access(p_pack_ids, p_user_id) a;
    if coalesce(v_requested, 0) < (select count(distinct x) from unnest(p_pack_ids) x) then
      raise exception 'Forbidden: pack inacessivel na selecao'
        using errcode = '42501';
    end if;
    if v_owners is null or array_length(v_owners, 1) is null then
      v_owners := array[p_user_id];
    end if;
    select array_agg(distinct x order by x) into v_pack_universe from unnest(p_pack_ids) x;
  end if;
  v_n_packs := greatest(1, coalesce(cardinality(v_pack_universe), 0));

  if v_group_by not in ('ad_id', 'ad_name', 'adset_id', 'campaign_id') then
    raise exception 'Invalid p_group_by: %, expected ad_id|ad_name|adset_id|campaign_id', v_group_by
      using errcode = '22023';
  end if;

  -- Normalização da chave pedida, idêntica à v116 (sem prefixo = 'conversion:').
  if v_selected_key <> '' and v_selected_key not like 'conversion:%' and v_selected_key not like 'action:%' then
    v_selected_key := 'conversion:' || v_selected_key;
  end if;
  if v_selected_key <> '' then
    -- Chave nunca vista no dicionário = nenhum anúncio tem esse evento → resultados 0,
    -- exatamente como a v116 (nenhum elemento casava).
    select id into v_key_id from public.conversion_keys where key = v_selected_key;
  end if;

  return query
  with
  -- 1. A seleção, resolvida no MAPA (índice composto user/pack/date/ad; ~40 B por linha).
  --    GROUP BY (ad_id, dia) faz de uma vez: (a) dedup cross-silo com a MESMA preferência
  --    da v116 — vence o dono do pack compartilhado, o ator perde, desempate por uuid;
  --    (b) dedup de sobreposição entre packs do mesmo dono; (c) sinal de conflito
  --    cross-silo (min <> max do dono); (d) máscara dos packs de origem (bit por pack).
  keys as (
    select
      apm.ad_id,
      apm.date as date,
      apm.user_id,
      false as x_cross_silo,
      set_bit(repeat('0', v_n_packs)::varbit, array_position(v_pack_universe, apm.pack_id) - 1, 1) as pack_mask,
      apm.pack_id
    from unnest(v_owners) as o(owner_id)
    join public.ad_performance_daily apm
      on apm.user_id = o.owner_id
     and apm.pack_id = any(p_pack_ids)
     and apm.date >= v_date_start
     and apm.date <= v_date_stop
    where p_pack_ids is not null

    union all

    -- Ramo legado (sem packs): o silo do ator no período; packs de origem por lookup.
    select
      am.ad_id,
      am.date,
      p_user_id as user_id,
      false as x_cross_silo,
      coalesce(bit_or(set_bit(repeat('0', v_n_packs)::varbit, array_position(v_pack_universe, am.pack_id) - 1, 1)), repeat('0', v_n_packs)::varbit) as pack_mask,
      -- Postgres nao tem min(uuid): "um pack qualquer, deterministico" via array_agg ordenado.
      (array_agg(am.pack_id order by am.pack_id))[1] as pack_id
    from public.ad_performance_daily am
    where p_pack_ids is null
      and am.user_id = p_user_id
      and am.date >= v_date_start
      and am.date <= v_date_stop
    group by am.ad_id, am.date
  ),
  -- 1b. (v155) Inventário: anúncio ativo no período (o intervalo first/last_active_date
  --     cruza a janela) SEM linha de métrica neste (silo, pack) no período. Substitui as
  --     linhas-zero que o refresh gravava em ad_metrics. Uma linha por (silo, pack,
  --     anúncio), zerada: somar zero não muda soma, a contagem é count(distinct ad_id) e
  --     o representante é o de maior impressão (a linha zerada perde para qualquer real,
  --     ver rep_enc). O anti-join vai ao read model pela PK, não a `keys`: no ramo
  --     legado `keys` guarda um pack só por anúncio-dia.
  inv as (
    select i.user_id, i.pack_id, i.ad_id, i.account_id, i.campaign_id, i.campaign_name,
           i.adset_id, i.adset_name, i.ad_name
    from unnest(v_owners) as o(owner_id)
    join public.ad_pack_inventory i
      on i.user_id = o.owner_id
     and i.pack_id = any(v_pack_universe)
     and i.first_active_date <= v_date_stop
     and i.last_active_date >= v_date_start
    where not exists (
      select 1 from public.ad_performance_daily d
      where d.user_id = i.user_id and d.pack_id = i.pack_id and d.ad_id = i.ad_id
        and d.date >= v_date_start and d.date <= v_date_stop
    )
  ),
  -- 2. As linhas: SÓ o read model (ad_performance_daily, migration 129), pela chave
  --    única. ad_metrics não entra aqui — entra só para a linha representante (fim) e
  --    para filtros por nome de campanha/conjunto (EXISTS abaixo, podado quando o
  --    filtro está vazio: o predicado é constante sob force_custom_plan).
  sel as (
    select
      k.user_id,
      k.ad_id,
      k.date,
      k.pack_mask,
      k.pack_id,
      case
        when v_group_by = 'ad_id' then d.ad_id
        when v_group_by = 'ad_name' then coalesce(nullif(d.ad_name, ''), d.ad_id)
        when v_group_by = 'adset_id' then d.adset_id
        when v_group_by = 'campaign_id' then d.campaign_id
        else d.ad_id
      end as group_key,
      -- Só o que a agregação consome. Nomes de campanha/conjunto NÃO viajam por
      -- linha: saem da linha REPRESENTANTE no fim (77 lookups em ad_metrics).
      d.account_id,
      d.adset_id,
      d.campaign_id,
      d.impressions,
      d.clicks,
      d.inline_link_clicks,
      d.spend,
      d.lpv,
      d.plays,
      d.thruplays,
      d.video_watched_p50,
      d.video_watched_p75,
      d.hold_rate,
      d.reach,
      d.frequency,
      d.hook_value,
      d.scroll_stop_value,
      -- conversão pedida por posição no array (leads: CTE próprio, leads_by_group)
      coalesce(d.conv_values[array_position(d.conv_key_ids, v_key_id)], 0)::numeric as results
    from keys k
    join public.ad_performance_daily d on d.user_id = k.user_id and d.pack_id = k.pack_id and d.ad_id = k.ad_id and d.date = k.date
    where (p_account_ids is null or d.account_id = any(p_account_ids))
      and (p_ad_name_contains is null or p_ad_name_contains = ''
           or coalesce(d.ad_name, '') ilike '%' || p_ad_name_contains || '%')
      and (
        (coalesce(p_campaign_name_contains, '') = '' and coalesce(p_adset_name_contains, '') = '')
        or exists (
          select 1 from public.ad_metrics am where am.user_id = k.user_id and am.pack_id = k.pack_id and am.ad_id = k.ad_id and am.date = k.date
            and (coalesce(p_campaign_name_contains, '') = ''
                 or coalesce(am.campaign_name, '') ilike '%' || p_campaign_name_contains || '%')
            and (coalesce(p_adset_name_contains, '') = ''
                 or coalesce(am.adset_name, '') ilike '%' || p_adset_name_contains || '%')
        )
      )

    union all

    -- (v155) O inventário, zerado. Identidade e nomes vêm da própria linha (os mais
    -- recentes que o refresh viu); os filtros usam esses mesmos campos. `date` nulo:
    -- a linha não é um dia, e o rep_enc a põe abaixo de qualquer dia real.
    select
      i.user_id,
      i.ad_id,
      null::date as date,
      set_bit(repeat('0', v_n_packs)::varbit, array_position(v_pack_universe, i.pack_id) - 1, 1) as pack_mask,
      i.pack_id,
      case
        when v_group_by = 'ad_id' then i.ad_id
        when v_group_by = 'ad_name' then coalesce(nullif(i.ad_name, ''), i.ad_id)
        when v_group_by = 'adset_id' then i.adset_id
        when v_group_by = 'campaign_id' then i.campaign_id
        else i.ad_id
      end as group_key,
      i.account_id,
      i.adset_id,
      i.campaign_id,
      0::bigint as impressions,
      0::bigint as clicks,
      0::bigint as inline_link_clicks,
      0::numeric as spend,
      0::bigint as lpv,
      0::bigint as plays,
      0::bigint as thruplays,
      0::numeric as video_watched_p50,
      0::numeric as video_watched_p75,
      0::numeric as hold_rate,
      0::bigint as reach,
      0::numeric as frequency,
      0::numeric as hook_value,
      0::numeric as scroll_stop_value,
      0::numeric as results
    from inv i
    where (p_account_ids is null or i.account_id = any(p_account_ids))
      and (p_ad_name_contains is null or p_ad_name_contains = ''
           or coalesce(i.ad_name, '') ilike '%' || p_ad_name_contains || '%')
      and (coalesce(p_campaign_name_contains, '') = ''
           or coalesce(i.campaign_name, '') ilike '%' || p_campaign_name_contains || '%')
      and (coalesce(p_adset_name_contains, '') = ''
           or coalesce(i.adset_name, '') ilike '%' || p_adset_name_contains || '%')
  ),
  -- `coalesce(x,'') <> ''` e não `nullif(x,'') is not null`: mesma semântica, mas o
  -- planner dá seletividade ~1 ao `<>` e 0,005 ao `is not null` sobre expressão —
  -- com 0,005 ele estimava 1 linha aqui e escolhia agregação por ordenação (spill).
  filtered as (
    select * from sel where coalesce(group_key, '') <> ''
  ),
  -- 3. Anúncio-dia → anúncio (por silo). Só agregados de estado constante.
  per_ad as (
    select
      f.group_key,
      f.user_id,
      f.ad_id,
      sum(f.impressions)::bigint as impressions,
      sum(f.clicks)::bigint as clicks,
      sum(f.inline_link_clicks)::bigint as inline_link_clicks,
      sum(f.spend)::numeric as spend,
      sum(f.lpv)::bigint as lpv,
      sum(f.plays)::bigint as plays,
      sum(f.thruplays)::bigint as thruplays,
      sum(f.hook_value * f.plays)::numeric as hook_wsum,
      sum(f.hold_rate * f.plays)::numeric as hold_rate_wsum,
      sum(f.video_watched_p50 * f.plays)::numeric as video_watched_p50_wsum,
      sum(f.video_watched_p75 * f.plays)::numeric as video_watched_p75_wsum,
      sum(f.scroll_stop_value * f.plays)::numeric as scroll_stop_wsum,
      sum(f.reach)::bigint as reach,
      sum(f.frequency * f.impressions)::numeric as frequency_wsum,
      sum(f.results)::numeric as results,
      -- um anúncio pertence a UMA conta e a UM conjunto: min() é exato
      min(nullif(f.account_id, '')) as account_id,
      min(nullif(f.adset_id, '')) as adset_id,
      min(nullif(f.campaign_id, '')) as campaign_id,
      bit_or(f.pack_mask) as pack_mask,
      -- dia representante deste anúncio: max impressões (desempate: dia mais recente)
      max((lpad(f.impressions::text, 12, '0') || e'\x1f' || coalesce(f.date::text, '') || e'\x1f' || f.pack_id::text) collate "C") as rep_enc
    from filtered f
    group by f.group_key, f.user_id, f.ad_id
  ),
  -- 4. Um lookup em `ads` por anúncio (índice de cobertura ads_user_ad_status_idx).
  per_ad_status as (
    select
      pa.*,
      a.effective_status,
      a.meta_created_time,
      a.thumb_storage_path,
      -- (170) o tipo de mídia vem no MESMO lookup, pelo índice de cobertura.
      a.media_type
    from per_ad pa
    left join public.ads a
      on a.user_id = pa.user_id
     and a.ad_id = pa.ad_id
  ),
  -- 5. Anúncio → grupo. (170) Anúncio de IMAGEM não contribui para métrica de
  --    VÍDEO: a Meta às vezes manda plays num estático (na cópia de 08/09, 82 anúncios
  --    e 572 linhas-dia), e "hook de 100% vindo de 1 play" vencia ranking. Não é zero
  --    do anúncio: é métrica que não se aplica a ele — quem decide como mostrar é a
  --    tela (ícone de formato). Em campanha/conjunto isso tira o play espúrio do
  --    denominador de todo mundo.
  grp as (
    select
      p.group_key,
      sum(p.impressions)::bigint as impressions,
      sum(p.clicks)::bigint as clicks,
      sum(p.inline_link_clicks)::bigint as inline_link_clicks,
      sum(p.spend)::numeric as spend,
      sum(p.lpv)::bigint as lpv,
      sum(case when p.media_type = 'image' then 0 else p.plays end)::bigint as plays,
      sum(case when p.media_type = 'image' then 0 else p.thruplays end)::bigint as thruplays,
      sum(case when p.media_type = 'image' then 0 else p.hook_wsum end)::numeric as hook_wsum,
      sum(case when p.media_type = 'image' then 0 else p.hold_rate_wsum end)::numeric as hold_rate_wsum,
      sum(case when p.media_type = 'image' then 0 else p.video_watched_p50_wsum end)::numeric as video_watched_p50_wsum,
      sum(case when p.media_type = 'image' then 0 else p.video_watched_p75_wsum end)::numeric as video_watched_p75_wsum,
      sum(case when p.media_type = 'image' then 0 else p.scroll_stop_wsum end)::numeric as scroll_stop_wsum,
      -- (170) o formato da VARIAÇÃO. No grão do anúncio o grupo É um anúncio só, então
      -- min() é exato; nos outros grãos a linha usa o formato do NOME (mt_by_name).
      min(p.media_type) as variacao_media_type,
      sum(p.reach)::bigint as reach,
      sum(p.frequency_wsum)::numeric as frequency_wsum,
      sum(p.results)::numeric as results,
      count(distinct p.ad_id)::integer as ad_id_count,
      count(distinct p.adset_id)::integer as adset_count,
      coalesce(array_agg(distinct p.account_id) filter (where p.account_id is not null), array[]::text[]) as account_ids,
      -- v136/137: TODAS as campanhas e conjuntos do grupo, nao a do representante.
      -- Mesma passada do account_ids: mesmo group by, nenhuma leitura nova.
      coalesce(array_agg(distinct p.campaign_id) filter (where p.campaign_id is not null), array[]::text[]) as campaign_ids,
      coalesce(array_agg(distinct p.adset_id) filter (where p.adset_id is not null), array[]::text[]) as adset_ids,
      bit_or(p.pack_mask) as pack_mask,
      -- representante do grupo = (impressões do dia rep, ad_id) máximos — a ordem
      -- (impressions desc, ad_id desc) da v116; user_id e os campos vão de carona.
      max((substr(p.rep_enc, 1, 12) || e'\x1f' || p.ad_id || e'\x1f' || p.user_id::text
           || e'\x1f' || p.rep_enc) collate "C") as rep_enc,
      bool_or(upper(coalesce(p.effective_status, '')) = 'ACTIVE') as has_active,
      count(distinct p.ad_id) filter (where upper(coalesce(p.effective_status, '')) = 'ACTIVE')::integer as active_count,
      -- v138: por que o grupo esta parado. `fallback_status` (o min alfabetico logo
      -- abaixo) responde "algum anuncio esta assim, e foi o primeiro do alfabeto" -
      -- por isso um criativo com um anuncio arquivado aparece como ARCHIVED. Contar
      -- permite a pergunta certa: TODOS estao pausados pelo mesmo motivo?
      -- Mesma passada e mesmo group by do active_count: nenhuma leitura nova.
      count(distinct p.ad_id) filter (where upper(coalesce(p.effective_status, '')) = 'PAUSED')::integer as paused_self_count,
      count(distinct p.ad_id) filter (where upper(coalesce(p.effective_status, '')) = 'ADSET_PAUSED')::integer as adset_paused_count,
      count(distinct p.ad_id) filter (where upper(coalesce(p.effective_status, '')) = 'CAMPAIGN_PAUSED')::integer as campaign_paused_count,
      min(p.effective_status) filter (where nullif(p.effective_status, '') is not null) as fallback_status,
      min(p.meta_created_time) as meta_created_min,
      -- fallback de miniatura: qualquer anúncio do grupo com arquivo no Storage
      -- (medido: 13 de 3.451 criativos têm o representante sem e uma cópia com)
      max(p.thumb_storage_path) filter (where nullif(p.thumb_storage_path, '') is not null) as any_thumb_storage_path
    from per_ad_status p
    group by p.group_key
  ),
  -- Leads: CTE próprio e ESTREITO. Só 23% dos anúncio-dias têm leads; parte do
  -- rollup (sem JSON), busca em ad_metrics só o necessário para o group_key e os
  -- filtros, e soma o histograma por (grupo, score). Fora da passada principal
  -- para não carregar JSON por duas camadas de agregação. MATERIALIZED: referenciado
  -- uma vez, o planner o inlinaria como lado interno de um nested loop e o
  -- recalcularia por grupo (medido: 397 execuções, 4,4 s).
  leads_by_group as materialized (
    select
      x.group_key,
      jsonb_object_agg(trim_scale(x.score)::text, x.qty order by x.score) as leadscore_histogram
    from (
      select
        case
          when v_group_by = 'ad_id' then d.ad_id
          when v_group_by = 'ad_name' then coalesce(nullif(d.ad_name, ''), d.ad_id)
          when v_group_by = 'adset_id' then d.adset_id
          when v_group_by = 'campaign_id' then d.campaign_id
          else d.ad_id
        end as group_key,
        s.score,
        sum(s.qty)::integer as qty
      from keys k
      join public.ad_performance_daily d on d.user_id = k.user_id and d.pack_id = k.pack_id and d.ad_id = k.ad_id and d.date = k.date
      cross join lateral unnest(d.lead_scores, d.lead_qtys) as s(score, qty)
      where v_include_leads
        and cardinality(d.lead_scores) > 0
        and (p_account_ids is null or d.account_id = any(p_account_ids))
        and (p_ad_name_contains is null or p_ad_name_contains = ''
             or coalesce(d.ad_name, '') ilike '%' || p_ad_name_contains || '%')
        and (
          (coalesce(p_campaign_name_contains, '') = '' and coalesce(p_adset_name_contains, '') = '')
          or exists (
            select 1 from public.ad_metrics am where am.user_id = k.user_id and am.pack_id = k.pack_id and am.ad_id = k.ad_id and am.date = k.date
              and (coalesce(p_campaign_name_contains, '') = ''
                   or coalesce(am.campaign_name, '') ilike '%' || p_campaign_name_contains || '%')
              and (coalesce(p_adset_name_contains, '') = ''
                   or coalesce(am.adset_name, '') ilike '%' || p_adset_name_contains || '%')
          )
        )
      group by 1, s.score
    ) x
    where coalesce(x.group_key, '') <> ''
    group by x.group_key
  ),
  -- 140: histogramas das colunas vinculadas, somados por (grupo, vinculo, valor).
  -- Mesma forma do leads_by_group: CTE estreito, MATERIALIZED, mesmos filtros, e
  -- opt-in por p_include_custom. Quem nao vincula coluna nenhuma tem a coluna nula
  -- e o frontend nem pede: custo zero fora do caso de uso.
  custom_by_group as materialized (
    select
      y.group_key,
      jsonb_object_agg(y.mapping_id, y.hist) as custom_histograms
    from (
      select x.group_key, x.mapping_id, jsonb_object_agg(x.val, x.qty) as hist
      from (
        select
          case
            when v_group_by = 'ad_id' then d.ad_id
            when v_group_by = 'ad_name' then coalesce(nullif(d.ad_name, ''), d.ad_id)
            when v_group_by = 'adset_id' then d.adset_id
            when v_group_by = 'campaign_id' then d.campaign_id
            else d.ad_id
          end as group_key,
          m.key as mapping_id,
          v.key as val,
          sum(v.value::bigint)::bigint as qty
        from keys k
        join public.ad_performance_daily d on d.user_id = k.user_id and d.pack_id = k.pack_id and d.ad_id = k.ad_id and d.date = k.date
        cross join lateral jsonb_each(d.custom_hist) as m(key, value)
        cross join lateral jsonb_each_text(m.value) as v(key, value)
        where v_include_custom
          and d.custom_hist is not null
          and (p_account_ids is null or d.account_id = any(p_account_ids))
          and (p_ad_name_contains is null or p_ad_name_contains = ''
               or coalesce(d.ad_name, '') ilike '%' || p_ad_name_contains || '%')
          and (
            (coalesce(p_campaign_name_contains, '') = '' and coalesce(p_adset_name_contains, '') = '')
            or exists (
              select 1 from public.ad_metrics am where am.user_id = k.user_id and am.pack_id = k.pack_id and am.ad_id = k.ad_id and am.date = k.date
                and (coalesce(p_campaign_name_contains, '') = ''
                     or coalesce(am.campaign_name, '') ilike '%' || p_campaign_name_contains || '%')
                and (coalesce(p_adset_name_contains, '') = ''
                     or coalesce(am.adset_name, '') ilike '%' || p_adset_name_contains || '%')
            )
          )
        group by 1, m.key, v.key
      ) x
      where coalesce(x.group_key, '') <> ''
      group by x.group_key, x.mapping_id
    ) y
    group by y.group_key
  ),
  -- 6. Enriquecimento por grupo (~77 linhas): representante em `ads`, tags do ATOR,
  --    packs da máscara, histograma de leads.
  -- Decodifica o representante (posições da chave: 1 impressões | 2 ad_id | 3 user_id
  -- | 4 impressões do dia | 5 date) e busca a LINHA representante em ad_metrics para
  -- os nomes — 77 lookups pela chave única, em vez de carregar nomes em 42 mil linhas.
  -- `collate "default"`: a chave é comparada em "C"; os pedaços voltam à colação das
  -- colunas, senão o `=` contra ads/ad_metrics não usa índice (medido: bitmap scan
  -- de 21 mil linhas por grupo).
  grp_dec as (
    select
      g.*,
      (split_part(g.rep_enc, e'\x1f', 2) collate "default") as rep_ad_id,
      (split_part(g.rep_enc, e'\x1f', 3))::uuid as rep_user_id,
      nullif(split_part(g.rep_enc, e'\x1f', 5), '')::date as rep_date,
      nullif(split_part(g.rep_enc, e'\x1f', 6), '')::uuid as rep_pack_id
    from grp g
  ),
  grp_rep as (
    select
      g.*,
      -- (v155) representante sem dia (só inventário): nomes da linha do inventário.
      case when g.rep_date is null then ri.ad_name when ra.ad_id is not null then ra.ad_name else am.ad_name end as rep_ad_name,
      case when g.rep_date is null then ri.account_id when ra.ad_id is not null then ra.account_id else am.account_id end as rep_account_id,
      case when g.rep_date is null then ri.campaign_id when ra.ad_id is not null then ra.campaign_id else am.campaign_id end as rep_campaign_id,
      case when g.rep_date is null then ri.campaign_name when ra.ad_id is not null then ra.campaign_name else am.campaign_name end as rep_campaign_name,
      case when g.rep_date is null then ri.adset_id when ra.ad_id is not null then ra.adset_id else am.adset_id end as rep_adset_id,
      case when g.rep_date is null then ri.adset_name when ra.ad_id is not null then ra.adset_name else am.adset_name end as rep_adset_name,
      -- (v161) a chave por NOME das buscas de mídia/transcrição/tags (antes, dentro
      -- de cada lateral).
      coalesce(nullif(case when g.rep_date is null then ri.ad_name when ra.ad_id is not null then ra.ad_name else am.ad_name end, ''), g.rep_ad_id) as name_key,
      -- (v161) o que o enriquecimento lia de `ads` numa SEGUNDA busca pelo mesmo anúncio
      ra.effective_status as ra_effective_status,
      ra.thumbnail_url as ra_thumbnail_url,
      -- (v162) só o 1º item: é tudo que a miniatura de fallback usa.
      ra.adcreatives_videos_thumbs ->> 0 as ra_first_video_thumb,
      ra.thumb_storage_path as ra_thumb_storage_path,
      -- (v161) pares id -> nome já lidos, para o dicionário `names` (ver names_payload)
      ra.campaign_id as ra_campaign_id,
      ra.campaign_name as ra_campaign_name,
      ra.adset_id as ra_adset_id,
      ra.adset_name as ra_adset_name
    from grp_dec g
    -- (v161) Os nomes do representante vêm da linha de `ads`, e não mais da linha do
    -- DIA em `ad_metrics`. Em produção esta leitura era o maior custo da consulta:
    -- 26 mil buscas aleatórias numa tabela larga, 12.665 páginas (≈99 MB) do disco por
    -- requisição numa instância com 256 MB de memória — 12,4 s de 29 s. As duas fontes
    -- são IGUAIS hoje: medido em 16/09 sobre todo o banco, nenhum dos 58.499 anúncios
    -- teve mais de um nome de campanha/conjunto/anúncio, e o mais recente bate com
    -- `ads` em todos. Num renome futuro, a linha passa a mostrar o nome ATUAL — o mesmo
    -- do dicionário `names`, que já vinha de `ads`.
    -- `ad_metrics` fica só para o anúncio sem linha em `ads` (nenhum hoje); o filtro sem
    -- coluna da tabela vira One-Time Filter e a busca nem acontece.
    left join public.ads ra
      on ra.user_id = g.rep_user_id
     and ra.ad_id = g.rep_ad_id
    left join lateral (
      select m.ad_name, m.account_id, m.campaign_id, m.campaign_name, m.adset_id, m.adset_name
      from public.ad_metrics m
      where g.rep_date is not null
        and ra.ad_id is null
        and m.user_id = g.rep_user_id and m.pack_id = g.rep_pack_id
        and m.ad_id = g.rep_ad_id and m.date = g.rep_date
      -- `limit 1` não muda o resultado (a PK garante no máximo uma linha): impede o
      -- planner de achatar a subconsulta numa junção comum. Achatada, a condição
      -- `ra.ad_id is null` virava filtro DEPOIS da busca, e as 26 mil buscas
      -- continuavam (medido em produção, 16/09: 5,2 s e 10 mil páginas do disco).
      -- Com o limit, ela vira One-Time Filter e a busca não acontece.
      limit 1
    ) am on true
    left join lateral (
      -- O anúncio pode estar no inventário de mais de um pack da seleção: vale o que
      -- esteve ativo por último (a mesma regra da linha-zero mais recente de antes).
      select i.ad_name, i.account_id, i.campaign_id, i.campaign_name, i.adset_id, i.adset_name
      from public.ad_pack_inventory i
      where g.rep_date is null
        and i.user_id = g.rep_user_id
        and i.pack_id = any(coalesce(p_pack_ids, v_pack_universe))
        and i.ad_id = g.rep_ad_id
      order by i.last_active_date desc, i.pack_id
      limit 1
    ) ri on true
  ),
  -- (v161) A ORDEM, calculada sobre `grp` — as somas, sem nomes, miniaturas nem
  -- histogramas. A v155 ordenava as linhas LARGAS (1,7 KB cada) e depois as copiava
  -- de novo para numerar e paginar: medido em produção (16/09, 51 mil linhas), duas
  -- ordenações de 75–80 MB escritas em disco a cada requisição. Aqui a posição de
  -- cada grupo vira um dicionário {group_key: posição}; as linhas largas não são
  -- ordenadas por ninguém — a saída leva a posição numa coluna (`row_order`) e o
  -- leitor as põe na ordem.
  -- Mesmas expressões e mesmo desempate (group_key) do `ordered` da v155, sobre os
  -- mesmos valores (as métricas de `rows_metrics` são essas fórmulas sobre `grp`).
  ranked as (
    select
      g.group_key,
      row_number() over (
        order by
          case when v_order_by = 'cpr' then d.cpr end asc nulls last,
          case when v_order_by = 'hook' then d.hook end desc nulls last,
          case when v_order_by = 'hold_rate' then d.hold_rate end desc nulls last,
          case when v_order_by = 'spend' then g.spend end desc nulls last,
          case when v_order_by = 'ctr' then d.ctr end desc nulls last,
          case when v_order_by = 'connect_rate' then d.connect_rate end desc nulls last,
          case when v_order_by = 'page_conv' then d.page_conv end desc nulls last,
          case when v_order_by = 'cpm' then d.cpm end desc nulls last,
          case when v_order_by = 'website_ctr' then d.website_ctr end desc nulls last,
          case when v_order_by = 'results' then g.results end desc nulls last,
          case
            when v_order_by not in ('cpr', 'hook', 'hold_rate', 'spend', 'ctr', 'connect_rate', 'page_conv', 'cpm', 'website_ctr', 'results')
            then g.spend
          end desc nulls last,
          g.group_key
      ) as ord
    from grp g
    cross join lateral (
      select
        case when g.results > 0 then g.spend / g.results else 0 end as cpr,
        case when g.plays > 0 then g.hook_wsum / g.plays else 0 end as hook,
        case when g.plays > 0 then g.hold_rate_wsum / g.plays else 0 end as hold_rate,
        case when g.impressions > 0 then g.clicks::numeric / g.impressions else 0 end as ctr,
        case when g.inline_link_clicks > 0 then g.lpv::numeric / g.inline_link_clicks else 0 end as connect_rate,
        case when g.lpv > 0 then g.results / g.lpv else 0 end as page_conv,
        case when g.impressions > 0 then (g.spend * 1000.0) / g.impressions else 0 end as cpm,
        case when g.impressions > 0 then g.inline_link_clicks::numeric / g.impressions else 0 end as website_ctr
    ) d
  ),
  rank_dict as (
    select coalesce(jsonb_object_agg(r.group_key, r.ord), '{}'::jsonb) as m
    from ranked r
  ),
  -- (v161) UMA passada pelos representantes para tudo que é por nome: os nomes a
  -- buscar (mídia/transcrição/tags) e os pares id -> nome que as linhas já trouxeram
  -- de `ads` (dicionário `names`). Cada leitura extra de `grp_rep` relia do disco a
  -- cópia dela (40 MB com 26 mil linhas).
  -- Pares por `jsonb_object_agg`: com id repetido fica um dos nomes — e um id tem um
  -- nome só (conferido em 16/09 sobre todo o banco: nenhuma das 2.719 campanhas e dos
  -- 8.086 conjuntos tem dois nomes entre os anúncios).
  rep_scan as materialized (
    select
      array_agg(distinct g.name_key) filter (
        where v_group_by in ('ad_name', 'ad_id') and g.name_key is not null
      ) as name_keys,
      coalesce(jsonb_object_agg(g.ra_campaign_id, g.ra_campaign_name) filter (
        where g.ra_campaign_id is not null and nullif(g.ra_campaign_name, '') is not null
      ), '{}'::jsonb) as campaign_names,
      coalesce(jsonb_object_agg(g.ra_adset_id, g.ra_adset_name) filter (
        where g.ra_adset_id is not null and nullif(g.ra_adset_name, '') is not null
      ), '{}'::jsonb) as adset_names
    from grp_rep g
  ),
  -- (v161) Mídia, transcrição e tags dependem só do NOME. Nas laterais da v155 cada
  -- linha relia todos os anúncios irmãos: no nível por anúncio isso é N² (medido em
  -- 16/09: 26 mil linhas x 353 irmãos = 9 milhões de leituras, ~9 s). Aqui cada nome
  -- é lido uma vez e juntado por igualdade.
  name_keys as materialized (
    select unnest(rs.name_keys) as name_key
    from rep_scan rs
  ),
  mt_by_name as materialized (
    -- (170) só o grão do NOME lê isto; no grão do anúncio a linha usa o formato da
    -- própria variação, e nos de conjunto/campanha o campo nem vai na resposta.
    -- Sob force_custom_plan o predicado é constante: a CTE some do plano.
    select a.ad_name as name_key,
           case max(case a.media_type when 'video' then 2 when 'image' then 1 end)
             when 2 then 'video' when 1 then 'image' end as media_type
    from name_keys n
    join public.ads a
      on a.user_id = any(v_owners)
     and a.ad_name = n.name_key
    where v_group_by = 'ad_name'
    group by a.ad_name
  ),
  tr_by_name as materialized (
    -- 142: estado da mídia (transcrito / sem áudio); ver a v155 para o porquê.
    select t.ad_name as name_key,
           bool_or(t.status = 'completed') as has_transcription,
           bool_or(t.status = 'failed' and coalesce(t.metadata ->> 'no_voice_detected', '') = 'true') as no_audio
    from name_keys n
    join public.ad_transcriptions t
      on t.user_id = any(v_owners)
     and t.ad_name = n.name_key
    group by t.ad_name
  ),
  tg_by_name as materialized (
    -- v139: tags do SILO DO PACK.
    select atg.ad_name as name_key,
           jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'color', t.color) order by t.name, t.id) as tags
    from name_keys n
    join public.ad_tags atg
      on atg.user_id = any(v_owners)
     and atg.ad_name = n.name_key
    join public.tags t on t.id = atg.tag_id and t.user_id = atg.user_id
    group by atg.ad_name
  ),
  -- (v161) DICIONÁRIOS em vez de junções. Juntar uma CTE com outra deixa o plano
  -- à mercê da estimativa (1 linha para tudo que deriva da seleção): no laboratório,
  -- em 16/09, a mera troca de estimativa fez `leads_by_group` ser relido INTEIRO para
  -- cada linha (14.886 x 4.522 = 67 milhões de linhas, ~15 s). A v155 só escapava
  -- porque o plano sorteado era outro. Um objeto {chave: valor} montado uma vez e lido
  -- por subconsulta escalar não depende de estimativa nenhuma (o mesmo `ck` da 157).
  name_dict as (
    select coalesce(jsonb_object_agg(s.name_key, s.o), '{}'::jsonb) as m
    from (
      select p.name_key, jsonb_object_agg(p.kind, p.v) as o
      from (
        select name_key, 'mt'::text as kind, to_jsonb(media_type) as v from mt_by_name
        union all
        select name_key, 'ht', to_jsonb(has_transcription) from tr_by_name
        union all
        select name_key, 'na', to_jsonb(no_audio) from tr_by_name
        union all
        select name_key, 'tg', tags from tg_by_name
      ) p
      group by p.name_key
    ) s
  ),
  leads_dict as (
    select coalesce(jsonb_object_agg(l.group_key, l.leadscore_histogram), '{}'::jsonb) as m
    from leads_by_group l
  ),
  custom_dict as (
    select coalesce(jsonb_object_agg(c.group_key, c.custom_histograms), '{}'::jsonb) as m
    from custom_by_group c
  ),
  rows_enriched as (
    select
      g.group_key,
      g.rep_account_id as account_id,
      g.account_ids,
      g.campaign_ids,
      g.adset_ids,
      coalesce((
        select array_agg(v_pack_universe[i] order by i)
        from generate_series(1, v_n_packs) i
        where get_bit(g.pack_mask, i - 1) = 1
      ), array[]::uuid[]) as pack_ids,
      g.rep_campaign_id as campaign_id,
      g.rep_campaign_name as campaign_name,
      g.rep_adset_id as adset_id,
      g.rep_adset_name as adset_name,
      g.rep_ad_id,
      g.rep_ad_name,
      nd.ord,
      case
        when v_group_by = 'campaign_id' then coalesce(nullif(g.rep_campaign_name, ''), g.group_key)
        when v_group_by = 'adset_id' then coalesce(nullif(g.rep_adset_name, ''), g.group_key)
        else coalesce(nullif(g.rep_ad_name, ''), g.rep_ad_id)
      end as label_name,
      case
        when v_group_by = 'campaign_id' then null
        when coalesce(g.has_active, false) then 'ACTIVE'
        else coalesce(g.fallback_status, g.ra_effective_status)
      end as effective_status,
      case
        when v_group_by = 'campaign_id' then null
        else coalesce(g.active_count, 0)
      end as active_count,
      -- Contadores de motivo SO nas abas que agregam anuncios. Em conjunto e
      -- campanha a linha E a propria entidade, e o status dela vem de
      -- `parent_entities` (o estado do Meta) - mandar contadores la faria a tela
      -- classificar um CONJUNTO pausado como "pausado pelo conjunto", que e a
      -- resposta certa para o anuncio e errada para o conjunto. A ausencia e o
      -- sinal: sem contadores, a tela le `effective_status` direto.
      case when v_group_by in ('ad_name', 'ad_id') then coalesce(g.paused_self_count, 0) end as paused_self_count,
      case when v_group_by in ('ad_name', 'ad_id') then coalesce(g.adset_paused_count, 0) end as adset_paused_count,
      case when v_group_by in ('ad_name', 'ad_id') then coalesce(g.campaign_paused_count, 0) end as campaign_paused_count,
      g.impressions, g.clicks, g.inline_link_clicks, g.spend, g.lpv, g.plays, g.thruplays,
      g.hook_wsum, g.hold_rate_wsum, g.video_watched_p50_wsum, g.video_watched_p75_wsum,
      g.scroll_stop_wsum, g.reach, g.frequency_wsum,
      case when v_group_by = 'campaign_id' then g.adset_count else g.ad_id_count end as ad_count,
      -- Chave do histograma normalizada (80.0 → "80"); a v116 mandava o array cru.
      coalesce(nd.lh, '{}'::jsonb) as leadscore_histogram,
      -- 140: {"<mapping_id>": {"<valor>": quantidade}}; {} quando nao pedido ou sem dado.
      coalesce(nd.ch, '{}'::jsonb) as custom_histograms,
      g.results,
      g.meta_created_min,
      coalesce(nullif(g.ra_thumbnail_url, ''), nullif(g.ra_first_video_thumb, '')) as thumbnail,
      coalesce(nullif(g.ra_thumb_storage_path, ''), g.any_thumb_storage_path) as thumb_storage_path,
      coalesce(nd.o -> 'tg', '[]'::jsonb) as tags,
      -- v132: o que a rota hidratava com 15 requisições e 13,7 mil linhas por carga
      -- (medido) agora vem daqui. Só nos níveis de criativo/anúncio, como a hidratação
      -- fazia (num nível de conjunto/campanha o "ad_name" é o nome do pai).
      -- No grão do NOME, o formato é a maior precedência entre as cópias (vídeo >
      -- imagem; 'unknown' e NULL ignorados) — a semântica de
      -- _hydrate_media_type_for_rankings_rows. No grão do ANÚNCIO é o formato DA
      -- VARIAÇÃO (170): a linha é um anúncio só, e rotulá-la pelo nome fazia a variação
      -- estática de um nome misto sair como "vídeo" — a tela então mostrava "hook 0%"
      -- em vez do ícone de "não se aplica".
      case
        when v_group_by = 'ad_id' then g.variacao_media_type
        when v_group_by = 'ad_name' then nd.o ->> 'mt'
        else null
      end as media_type,
      case
        when v_group_by in ('ad_name', 'ad_id') then coalesce((nd.o ->> 'ht')::boolean, false)
        else false
      end as has_transcription,
      -- Transcrito GANHA de sem-audio: num pack compartilhado os dois silos podem ter
      -- registros diferentes para o mesmo ad_name, e o texto que existe de fato vale
      -- mais do que a falha registrada no silo vizinho.
      case
        when v_group_by in ('ad_name', 'ad_id')
          then coalesce((nd.o ->> 'na')::boolean, false) and not coalesce((nd.o ->> 'ht')::boolean, false)
        else false
      end as transcription_no_audio
    from grp_rep g
    -- (v161) uma leitura por linha em cada dicionário; as subconsultas escalares
    -- não dependem da linha e rodam uma vez só.
    cross join lateral (
      select
        (select d.m from name_dict d) -> g.name_key as o,
        (select d.m from leads_dict d) -> g.group_key as lh,
        (select d.m from custom_dict d) -> g.group_key as ch,
        ((select d.m from rank_dict d) ->> g.group_key)::integer as ord
    ) nd
  ),
  rows_metrics as (
    select
      re.*,
      case when re.plays > 0 then re.hook_wsum / re.plays else 0 end as hook,
      case when re.plays > 0 then re.hold_rate_wsum / re.plays else 0 end as hold_rate,
      round(case when re.plays > 0 then re.video_watched_p50_wsum / re.plays else 0 end)::int as video_watched_p50,
      round(case when re.plays > 0 then re.video_watched_p75_wsum / re.plays else 0 end)::int as video_watched_p75,
      case when re.plays > 0 then re.scroll_stop_wsum / re.plays else 0 end as scroll_stop,
      case when re.impressions > 0 then re.clicks::numeric / re.impressions else 0 end as ctr,
      case when re.inline_link_clicks > 0 then re.lpv::numeric / re.inline_link_clicks else 0 end as connect_rate,
      case when re.impressions > 0 then (re.spend * 1000.0) / re.impressions else 0 end as cpm,
      case when re.impressions > 0 then re.inline_link_clicks::numeric / re.impressions else 0 end as website_ctr,
      case when re.impressions > 0 then re.frequency_wsum / re.impressions else 0 end as frequency,
      case when re.results > 0 then re.spend / re.results else 0 end as cpr,
      case when re.lpv > 0 then re.results / re.lpv else 0 end as page_conv,
      case when v_selected_key <> '' then jsonb_build_object(v_selected_key, re.results) else '{}'::jsonb end as conversions
    from rows_enriched re
  ),
  totals as (
    select
      coalesce(sum(rm.spend), 0)::numeric as total_spend,
      coalesce(sum(rm.impressions), 0)::bigint as total_impressions,
      coalesce(sum(rm.clicks), 0)::bigint as total_clicks,
      coalesce(sum(rm.inline_link_clicks), 0)::bigint as total_inline,
      coalesce(sum(rm.lpv), 0)::bigint as total_lpv,
      coalesce(sum(rm.plays), 0)::bigint as total_plays,
      coalesce(sum(rm.hook_wsum), 0)::numeric as total_hook_wsum,
      coalesce(sum(rm.hold_rate_wsum), 0)::numeric as total_hold_rate_wsum,
      coalesce(sum(rm.video_watched_p50_wsum), 0)::numeric as total_video_watched_p50_wsum,
      coalesce(sum(rm.video_watched_p75_wsum), 0)::numeric as total_video_watched_p75_wsum,
      coalesce(sum(rm.scroll_stop_wsum), 0)::numeric as total_scroll_stop_wsum,
      coalesce(sum(rm.results), 0)::numeric as total_results
    -- (v161) de `grp`, e não de `rows_metrics`: mesmas somas (uma linha por grupo nos
    -- dois), sem obrigar a guardar as linhas LARGAS para ler três vezes.
    from grp rm
  ),
  -- Tipos disponíveis + per_action_type de TODAS as chaves: só quando pedido (o
  -- predicado é constante sob force_custom_plan → o planner poda o ramo inteiro).
  -- Relê a seleção estreita (keys, já materializada) + filtros de nome em ad_metrics +
  -- os arrays do rollup; sem JSON.
  -- Soma por key_id ANTES de juntar com o dicionário: são ≤ 81 linhas depois do GROUP
  -- BY. Juntar antes custou 10,6 s no cenário de 30 packs (826 mil pares desempacotados
  -- materializados e varridos uma vez por chave do dicionário).
  conv_all as (
    select ck.key as conv_key, c.total_results
    from (
    select pr.key_id, sum(pr.value)::numeric as total_results
    from keys k
    join public.ad_performance_daily d on d.user_id = k.user_id and d.pack_id = k.pack_id and d.ad_id = k.ad_id and d.date = k.date
    cross join lateral unnest(d.conv_key_ids, d.conv_values) as pr(key_id, value)
    where v_include_conv_types
      and coalesce(case
        when v_group_by = 'ad_id' then d.ad_id
        when v_group_by = 'ad_name' then coalesce(nullif(d.ad_name, ''), d.ad_id)
        when v_group_by = 'adset_id' then d.adset_id
        when v_group_by = 'campaign_id' then d.campaign_id
        else d.ad_id end, '') <> ''
      and (p_account_ids is null or d.account_id = any(p_account_ids))
      and (p_ad_name_contains is null or p_ad_name_contains = ''
           or coalesce(d.ad_name, '') ilike '%' || p_ad_name_contains || '%')
      and (
        (coalesce(p_campaign_name_contains, '') = '' and coalesce(p_adset_name_contains, '') = '')
        or exists (
          select 1 from public.ad_metrics am where am.user_id = k.user_id and am.pack_id = k.pack_id and am.ad_id = k.ad_id and am.date = k.date
            and (coalesce(p_campaign_name_contains, '') = ''
                 or coalesce(am.campaign_name, '') ilike '%' || p_campaign_name_contains || '%')
            and (coalesce(p_adset_name_contains, '') = ''
                 or coalesce(am.adset_name, '') ilike '%' || p_adset_name_contains || '%')
        )
      )
    group by pr.key_id
    ) c
    join public.conversion_keys ck on ck.id = c.key_id
  ),
  available_types as (
    select coalesce(jsonb_agg(c.conv_key order by c.conv_key), '[]'::jsonb) as conv_types
    from conv_all c
  ),
  per_action_all as (
    select coalesce(
      jsonb_object_agg(
        c.conv_key,
        jsonb_build_object(
          'results', c.total_results,
          'cpr', case when c.total_results > 0 then t.total_spend / c.total_results else 0 end,
          'page_conv', case when t.total_lpv > 0 then c.total_results / t.total_lpv else 0 end
        )
        order by c.conv_key
      ),
      '{}'::jsonb
    ) as per_action_type
    from conv_all c
    cross join totals t
  ),
  per_action_selected as (
    select
      case
        when v_selected_key <> '' then jsonb_build_object(
          v_selected_key,
          jsonb_build_object(
            'results', t.total_results,
            'cpr', case when t.total_results > 0 then t.total_spend / t.total_results else 0 end,
            'page_conv', case when t.total_lpv > 0 then t.total_results / t.total_lpv else 0 end
          )
        )
        else '{}'::jsonb
      end as per_action_type
    from totals t
  ),
  averages_payload as (
    select jsonb_build_object(
      'hook', case when t.total_plays > 0 then t.total_hook_wsum / t.total_plays else 0 end,
      'hold_rate', case when t.total_plays > 0 then t.total_hold_rate_wsum / t.total_plays else 0 end,
      'video_watched_p50', case when t.total_plays > 0 then t.total_video_watched_p50_wsum / t.total_plays else 0 end,
      'video_watched_p75', case when t.total_plays > 0 then t.total_video_watched_p75_wsum / t.total_plays else 0 end,
      'scroll_stop', case when t.total_plays > 0 then t.total_scroll_stop_wsum / t.total_plays else 0 end,
      'ctr', case when t.total_impressions > 0 then t.total_clicks::numeric / t.total_impressions else 0 end,
      'website_ctr', case when t.total_impressions > 0 then t.total_inline::numeric / t.total_impressions else 0 end,
      'connect_rate', case when t.total_inline > 0 then t.total_lpv::numeric / t.total_inline else 0 end,
      'cpm', case when t.total_impressions > 0 then (t.total_spend * 1000.0) / t.total_impressions else 0 end,
      'cpc', case when t.total_clicks > 0 then t.total_spend / t.total_clicks else 0 end,
      'cplc', case when t.total_inline > 0 then t.total_spend / t.total_inline else 0 end,
      'per_action_type', case when v_include_conv_types then paa.per_action_type else pas.per_action_type end
    ) as averages
    from totals t
    cross join per_action_all paa
    cross join per_action_selected pas
  ),
  header_payload as (
    select jsonb_build_object(
      'sums', jsonb_build_object(
        'spend', t.total_spend,
        'results', t.total_results,
        'mqls', to_jsonb(null::numeric)
      ),
      'weighted_averages', jsonb_build_object(
        'hook', case when t.total_plays > 0 then t.total_hook_wsum / t.total_plays else 0 end,
        'scroll_stop', case when t.total_plays > 0 then t.total_scroll_stop_wsum / t.total_plays else 0 end,
        'ctr', case when t.total_impressions > 0 then t.total_clicks::numeric / t.total_impressions else 0 end,
        'website_ctr', case when t.total_impressions > 0 then t.total_inline::numeric / t.total_impressions else 0 end,
        'connect_rate', case when t.total_inline > 0 then t.total_lpv::numeric / t.total_inline else 0 end,
        'cpm', case when t.total_impressions > 0 then (t.total_spend * 1000.0) / t.total_impressions else 0 end,
        'page_conv', case when t.total_lpv > 0 then t.total_results / t.total_lpv else 0 end
      )
    ) as header_aggregates
    from totals t
  ),
  -- (v161) As linhas que SAEM, em versão ESTREITA: posição, ids do pai e as listas de
  -- ids (para o dicionário de nomes). Página e filtro por campanha como na v155:
  -- paginação sobre a ordem completa; o filtro por campanha (antes um "fold" que relia
  -- o JSON pronto) depois dela, sem mexer em médias e tipos de conversão.
  page_reps as materialized (
    select g.group_key, x.ord, g.rep_adset_id, g.rep_campaign_id, g.campaign_ids, g.adset_ids
    from grp_rep g
    cross join lateral (
      select ((select d.m from rank_dict d) ->> g.group_key)::integer as ord
    ) x
    where x.ord between v_offset + 1 and v_offset + v_limit
      and (v_campaign is null or coalesce(g.rep_campaign_id, '') = v_campaign)
  ),
  -- (v161) O que o invólucro core_v2 fazia nas abas de conjunto e campanha, relendo o
  -- JSON e consultando `ads` linha a linha: status efetivo, orçamento e moeda. Aqui por
  -- conjunto — os anúncios pausados do ATOR (p_user_id, como no core_v2) lidos uma vez.
  paused_ads as materialized (
    select a.adset_id, a.campaign_id, upper(coalesce(a.effective_status, '')) as st
    from public.ads a
    where v_group_by in ('adset_id', 'campaign_id')
      and a.user_id = p_user_id
      and upper(coalesce(a.effective_status, '')) in ('ADSET_PAUSED', 'CAMPAIGN_PAUSED')
  ),
  adset_flags as (
    select pa.adset_id,
           bool_or(pa.st = 'ADSET_PAUSED') as adset_paused,
           bool_or(pa.st = 'CAMPAIGN_PAUSED') as campaign_paused
    from paused_ads pa
    where pa.adset_id is not null
    group by pa.adset_id
  ),
  campaign_flags as (
    select pa.campaign_id,
           bool_or(pa.st = 'CAMPAIGN_PAUSED') as campaign_paused
    from paused_ads pa
    where pa.campaign_id is not null
    group by pa.campaign_id
  ),
  parent_keys as (
    -- `btrim` sem lista = só espaços, como o `trim()` do core_v2.
    select pr.group_key,
           nullif(btrim(coalesce(pr.rep_adset_id, '')), '') as k_adset,
           nullif(btrim(coalesce(pr.rep_campaign_id, '')), '') as k_campaign
    from page_reps pr
    where v_group_by in ('adset_id', 'campaign_id')
  ),
  parent_row as (
    select
      pk.group_key,
      case
        when v_group_by = 'adset_id' and pk.k_adset is not null then
          coalesce(
            nullif(pb_self.effective_status, ''),
            case
              when coalesce(af.adset_paused, false) then 'ADSET_PAUSED'
              when coalesce(af.campaign_paused, false) then 'CAMPAIGN_PAUSED'
              else 'ACTIVE'
            end)
        when v_group_by = 'campaign_id' and pk.k_campaign is not null then
          coalesce(
            nullif(pb_self.effective_status, ''),
            case when coalesce(cf.campaign_paused, false) then 'CAMPAIGN_PAUSED' else 'ACTIVE' end)
        else 'ACTIVE'
      end as effective_status,
      pb_self.daily_budget as budget_daily,
      pb_self.lifetime_budget as budget_lifetime,
      pb_mode.budget_mode,
      acct.currency as budget_currency,
      case when v_group_by = 'adset_id' then pb_self.ads_count end as self_ads_count
    from parent_keys pk
    -- PK (user_id, entity_id): o `limit 1` do core_v2 era no máximo uma linha mesmo.
    left join public.parent_entities pb_self
      on pb_self.user_id = p_user_id
     and pb_self.entity_id = case when v_group_by = 'adset_id' then pk.k_adset else pk.k_campaign end
    left join public.parent_entities pb_mode
      on pb_mode.user_id = p_user_id
     and pb_mode.entity_id = pk.k_campaign
    left join adset_flags af on af.adset_id = pk.k_adset
    left join campaign_flags cf on cf.campaign_id = pk.k_campaign
    left join lateral (
      select aa.currency
      from public.ad_accounts aa
      where aa.user_id = p_user_id
        and replace(aa.id, 'act_', '') = replace(pb_self.account_id, 'act_', '')
        and nullif(aa.currency, '') is not null
      limit 1
    ) acct on true
  ),
  -- Dicionário em vez de junção (vazio nas abas de anúncio): juntar com as linhas
  -- obrigava a ordenar as linhas LARGAS pela chave (40 MB em disco com 26 mil).
  parent_dict as (
    select coalesce(jsonb_object_agg(p.group_key, jsonb_build_object(
             'st', p.effective_status,
             'bd', p.budget_daily,
             'bl', p.budget_lifetime,
             'bm', p.budget_mode,
             'bc', p.budget_currency,
             'ac', p.self_ads_count)), '{}'::jsonb) as m
    from parent_row p
  ),
  -- (v161) A linha final, com o que a ROTA fazia em Python depois da consulta:
  --   * miniatura do Storage: `_hydrate_storage_thumbnails_for_rankings_rows`
  --     (linha sem ad_id fica como está; miniatura que já é do Storage fica; com
  --     caminho, vira prefixo + caminho codificado como o `_quote_path`);
  --   * `status_resolved`: `bool(str(status).strip())`, falso para nulo.
  -- `rows_metrics` tem este consumidor só: as linhas largas passam direto para a
  -- montagem das colunas, sem cópia no meio.
  out_rows as (
    select
      pf.ord,
      pf.group_key,
      pf.account_id,
      pf.account_ids,
      pf.campaign_ids,
      pf.adset_ids,
      pf.pack_ids,
      pf.tags,
      pf.meta_created_min,
      pf.campaign_id,
      pf.campaign_name,
      pf.adset_id,
      pf.adset_name,
      pf.rep_ad_id,
      pf.label_name,
      x.final_status,
      coalesce(btrim(x.final_status, v_ws) <> '', false) as status_resolved,
      pf.active_count,
      pf.paused_self_count,
      pf.adset_paused_count,
      pf.campaign_paused_count,
      case
        when v_group_by in ('adset_id', 'campaign_id') then coalesce((pp.pd ->> 'ac')::integer, pf.ad_count)
        else pf.ad_count
      end as ad_count,
      case
        when btrim(coalesce(pf.rep_ad_id, ''), v_ws) = '' then x.thumb_sql
        when strpos(coalesce(x.thumb_sql, ''), '/storage/v1/object/public/') > 0 then x.thumb_sql
        when p_thumb_public_prefix is not null
         and btrim(coalesce(pf.thumb_storage_path, ''), v_ws) <> ''
          then p_thumb_public_prefix || public.url_quote_path(btrim(pf.thumb_storage_path, v_ws))
        else x.thumb_sql
      end as thumbnail,
      pf.thumb_storage_path,
      pf.media_type,
      pf.has_transcription,
      pf.transcription_no_audio,
      pf.impressions,
      pf.clicks,
      pf.inline_link_clicks,
      pf.spend,
      pf.lpv,
      pf.plays,
      pf.thruplays,
      pf.hook,
      pf.hold_rate,
      pf.video_watched_p50,
      pf.video_watched_p75,
      pf.scroll_stop,
      pf.ctr,
      pf.connect_rate,
      pf.cpm,
      pf.website_ctr,
      pf.reach,
      pf.frequency,
      pf.leadscore_histogram,
      pf.custom_histograms,
      pf.conversions,
      (pp.pd ->> 'bd')::bigint as budget_daily,
      (pp.pd ->> 'bl')::bigint as budget_lifetime,
      pp.pd ->> 'bm' as budget_mode,
      pp.pd ->> 'bc' as budget_currency
    from rows_metrics pf
    cross join lateral (
      select (select d.m from parent_dict d) -> pf.group_key as pd
    ) pp
    cross join lateral (
      select
        case
          when v_group_by in ('adset_id', 'campaign_id') then pp.pd ->> 'st'
          else pf.effective_status
        end as final_status,
        case
          when v_group_by in ('ad_name', 'ad_id') and pf.thumb_storage_path is not null then null
          else pf.thumbnail
        end as thumb_sql
    ) x
    where pf.ord between v_offset + 1 and v_offset + v_limit
      and (v_campaign is null or coalesce(pf.campaign_id, '') = v_campaign)
  ),
  -- (v161) A SAÍDA EM COLUNAS: uma lista por campo. Medido com 10 mil linhas reais: 45%
  -- menos na rede do que um objeto por linha, porque valores parecidos ficam juntos.
  -- `json_build_object` aceita no máximo 100 argumentos (50 campos), daí os blocos; o
  -- leitor funde todos.
  -- SEM `order by` nas agregações, de propósito: ordenar aqui ordenaria as linhas
  -- largas (o que a ordem estreita acima existe para evitar). Um único nó de agregação
  -- alimenta todas as listas com as mesmas linhas na mesma sequência, então as
  -- colunas ficam alinhadas entre si; `row_order` diz a posição final de cada linha, e
  -- o leitor reordena (`app/services/manager_columns.py`, `lib/api/managerColumns.ts`).
  -- (v162) A SAÍDA EM COLUNAS, uma agregação por campo e NENHUMA montagem por cima:
  -- a v161 embrulhava as listas em blocos, lista e objeto, e cada camada era uma
  -- cópia viva até o fim da consulta (pico medido: ~11x o tamanho da resposta).
  -- Razões em float8: o mesmo número no navegador, com metade dos dígitos.
  -- SEM `order by` (ver `row_order`): um único nó de agregação mantém as listas
  -- alinhadas entre si.
  cols as (
    select
      count(*)::integer as n,
      json_agg(o.ord) as row_order,
      json_agg(o.group_key) as c_group_key,
      json_agg(null::text) as c_unique_id,
      json_agg(o.account_id) as c_account_id,
      json_agg(o.account_ids) as c_account_ids,
      json_agg(o.campaign_ids) as c_campaign_ids,
      json_agg(o.adset_ids) as c_adset_ids,
      json_agg(o.pack_ids) as c_pack_ids,
      json_agg(o.tags) as c_tags,
      json_agg(o.meta_created_min) as c_meta_created_time,
      json_agg(o.campaign_id) as c_campaign_id,
      json_agg(o.campaign_name) as c_campaign_name,
      json_agg(o.adset_id) as c_adset_id,
      json_agg(o.adset_name) as c_adset_name,
      json_agg(o.rep_ad_id) as c_ad_id,
      json_agg(o.label_name) as c_ad_name,
      json_agg(o.final_status) as c_effective_status,
      json_agg(o.status_resolved) as c_status_resolved,
      json_agg(o.active_count) as c_active_count,
      json_agg(o.paused_self_count) as c_paused_self_count,
      json_agg(o.adset_paused_count) as c_adset_paused_count,
      json_agg(o.campaign_paused_count) as c_campaign_paused_count,
      json_agg(o.ad_count) as c_ad_count,
      json_agg(o.thumbnail) as c_thumbnail,
      json_agg(o.thumb_storage_path) filter (where p_thumb_public_prefix is null) as c_thumb_storage_path,
      json_agg(o.media_type) as c_media_type,
      json_agg(o.has_transcription) as c_has_transcription,
      json_agg(o.transcription_no_audio) as c_transcription_no_audio,
      json_agg(o.impressions) as c_impressions,
      json_agg(o.clicks) as c_clicks,
      json_agg(o.inline_link_clicks) as c_inline_link_clicks,
      json_agg(o.spend) as c_spend,
      json_agg(o.lpv) as c_lpv,
      json_agg(o.plays) as c_plays,
      json_agg(o.thruplays) as c_video_total_thruplays,
      json_agg(o.hook::float8) as c_hook,
      json_agg(o.hold_rate::float8) as c_hold_rate,
      json_agg(o.video_watched_p50) as c_video_watched_p50,
      json_agg(o.video_watched_p75) as c_video_watched_p75,
      json_agg(o.scroll_stop::float8) as c_scroll_stop,
      json_agg(o.ctr::float8) as c_ctr,
      json_agg(o.connect_rate::float8) as c_connect_rate,
      json_agg(o.cpm::float8) as c_cpm,
      json_agg(o.website_ctr::float8) as c_website_ctr,
      json_agg(o.reach) as c_reach,
      json_agg(o.frequency::float8) as c_frequency,
      json_agg(o.leadscore_histogram) as c_leadscore_histogram,
      json_agg(o.custom_histograms) as c_custom_histograms,
      json_agg(o.conversions) as c_conversions,
      json_agg(o.budget_daily) filter (where v_group_by in ('adset_id', 'campaign_id')) as c_budget_daily,
      json_agg(o.budget_lifetime) filter (where v_group_by in ('adset_id', 'campaign_id')) as c_budget_lifetime,
      json_agg(o.budget_mode) filter (where v_group_by in ('adset_id', 'campaign_id')) as c_budget_mode,
      json_agg(o.budget_currency) filter (where v_group_by in ('adset_id', 'campaign_id')) as c_budget_currency
    from out_rows o
  ),
  -- Dicionario id -> nome, so das campanhas/conjuntos citados nas linhas que SAEM
  -- (v161: depois do filtro por campanha — o mesmo resultado da poda que a v155
  -- fazia no fold). O nome NAO viaja por linha.
  paged_parent_ids as (
    select
      coalesce((select array_agg(distinct c) from page_reps p, unnest(p.campaign_ids) c where c is not null), array[]::text[]) as campaign_ids,
      coalesce((select array_agg(distinct a) from page_reps p, unnest(p.adset_ids) a where a is not null), array[]::text[]) as adset_ids
  ),
  -- (v161) Para cada id citado: o nome que as linhas JÁ trouxeram de `ads` (rep_scan);
  -- senão, `ads` (como a v155 fazia para todos). Na v155 esta leitura era, no pior
  -- caso medido (16/09, 38 packs, 51 mil linhas), 54 mil buscas aleatórias e ~26 s —
  -- o maior custo da consulta inteira. A condição sobre o dicionário não depende da
  -- tabela e vira One-Time Filter: a busca só acontece para o id desconhecido (nas
  -- abas agregadas, as campanhas que nenhum representante trouxe).
  names_payload as (
    select jsonb_build_object(
      'campaigns', coalesce((
        select jsonb_object_agg(x.id, x.name)
        from (
          select c.id,
                 coalesce((select rs.campaign_names from rep_scan rs) ->> c.id, lk.name) as name
          from paged_parent_ids pp
          cross join lateral unnest(pp.campaign_ids) as c(id)
          left join lateral (
            select max(a.campaign_name) as name
            from public.ads a
            where ((select rs.campaign_names from rep_scan rs) ->> c.id) is null
              and a.user_id = any(v_owners)
              and a.campaign_id = c.id
              and nullif(a.campaign_name, '') is not null
          ) lk on true
        ) x
        where x.name is not null
      ), '{}'::jsonb),
      'adsets', coalesce((
        select jsonb_object_agg(x.id, x.name)
        from (
          select c.id,
                 coalesce((select rs.adset_names from rep_scan rs) ->> c.id, lk.name) as name
          from paged_parent_ids pp
          cross join lateral unnest(pp.adset_ids) as c(id)
          left join lateral (
            select max(a.adset_name) as name
            from public.ads a
            where ((select rs.adset_names from rep_scan rs) ->> c.id) is null
              and a.user_id = any(v_owners)
              and a.adset_id = c.id
              and nullif(a.adset_name, '') is not null
          ) lk on true
        ) x
        where x.name is not null
      ), '{}'::jsonb)
    ) as names
  ),
  pagination_payload as (
    select case
      when v_campaign is not null then
        -- como o fold da v155: paginação zerada e total = linhas que sobraram
        -- (v162) o total entra na linha de metadados, que já lê `cols`
        null::jsonb
      else
        jsonb_build_object('limit', v_limit, 'offset', v_offset,
                           'total', tc.total, 'has_more', (v_offset + v_limit) < tc.total)
    end as pagination
    -- (v161) contagem de `grp`: uma linha por grupo, como `rows_metrics`.
    from (select count(*)::integer as total from grp) tc
  )
  -- (v161) sem `overlap`: `keys.x_cross_silo` é a constante false nos dois ramos da
  -- seleção, então a v155 nunca emitia a chave — mas pagava uma varredura de `keys`
  -- inteira para contar zero (171 ms no caso do Igor).
  -- (v162) UMA LINHA POR PEDAÇO: metadados ({row_count, row_order, names, ...}) e um
  -- objeto {campo: [valores]} por campo. `return query` manda cada linha para o
  -- armazenamento da função (que vai a disco além do work_mem) e o PostgREST as junta
  -- num array. Nenhum pedaço depende da ordem das linhas: o leitor funde os objetos.
  select x.v
  from cols c
  cross join lateral (values
    (json_build_object(
      'row_count', c.n,
      'row_order', c.row_order,
      'names', coalesce((select names from names_payload), '{}'::jsonb),
      'available_conversion_types',
        case when v_include_conv_types then coalesce((select conv_types from available_types), '[]'::jsonb) else '[]'::jsonb end,
      'averages', coalesce((select averages from averages_payload), '{}'::jsonb),
      'header_aggregates', coalesce((select header_aggregates from header_payload), '{}'::jsonb),
      'pagination', case
        when v_campaign is not null then
          jsonb_build_object('limit', v_limit, 'offset', 0, 'total', c.n, 'has_more', false)
        else (select pagination from pagination_payload)
      end
    )),
    (json_build_object('group_key', c.c_group_key)),
    (json_build_object('unique_id', c.c_unique_id)),
    (json_build_object('account_id', c.c_account_id)),
    (json_build_object('account_ids', c.c_account_ids)),
    (json_build_object('campaign_ids', c.c_campaign_ids)),
    (json_build_object('adset_ids', c.c_adset_ids)),
    (json_build_object('pack_ids', c.c_pack_ids)),
    (json_build_object('tags', c.c_tags)),
    (json_build_object('meta_created_time', c.c_meta_created_time)),
    (json_build_object('campaign_id', c.c_campaign_id)),
    (json_build_object('campaign_name', c.c_campaign_name)),
    (json_build_object('adset_id', c.c_adset_id)),
    (json_build_object('adset_name', c.c_adset_name)),
    (json_build_object('ad_id', c.c_ad_id)),
    (json_build_object('ad_name', c.c_ad_name)),
    (json_build_object('effective_status', c.c_effective_status)),
    (json_build_object('status_resolved', c.c_status_resolved)),
    (json_build_object('active_count', c.c_active_count)),
    (json_build_object('paused_self_count', c.c_paused_self_count)),
    (json_build_object('adset_paused_count', c.c_adset_paused_count)),
    (json_build_object('campaign_paused_count', c.c_campaign_paused_count)),
    (json_build_object('ad_count', c.c_ad_count)),
    (json_build_object('thumbnail', c.c_thumbnail)),
    (case when p_thumb_public_prefix is null then json_build_object('thumb_storage_path', c.c_thumb_storage_path) end),
    (json_build_object('media_type', c.c_media_type)),
    (json_build_object('has_transcription', c.c_has_transcription)),
    (json_build_object('transcription_no_audio', c.c_transcription_no_audio)),
    (json_build_object('impressions', c.c_impressions)),
    (json_build_object('clicks', c.c_clicks)),
    (json_build_object('inline_link_clicks', c.c_inline_link_clicks)),
    (json_build_object('spend', c.c_spend)),
    (json_build_object('lpv', c.c_lpv)),
    (json_build_object('plays', c.c_plays)),
    (json_build_object('video_total_thruplays', c.c_video_total_thruplays)),
    (json_build_object('hook', c.c_hook)),
    (json_build_object('hold_rate', c.c_hold_rate)),
    (json_build_object('video_watched_p50', c.c_video_watched_p50)),
    (json_build_object('video_watched_p75', c.c_video_watched_p75)),
    (json_build_object('scroll_stop', c.c_scroll_stop)),
    (json_build_object('ctr', c.c_ctr)),
    (json_build_object('connect_rate', c.c_connect_rate)),
    (json_build_object('cpm', c.c_cpm)),
    (json_build_object('website_ctr', c.c_website_ctr)),
    (json_build_object('reach', c.c_reach)),
    (json_build_object('frequency', c.c_frequency)),
    (json_build_object('leadscore_histogram', c.c_leadscore_histogram)),
    (json_build_object('custom_histograms', c.c_custom_histograms)),
    (json_build_object('conversions', c.c_conversions)),
    (case when v_group_by in ('adset_id', 'campaign_id') then json_build_object('budget_daily', c.c_budget_daily) end),
    (case when v_group_by in ('adset_id', 'campaign_id') then json_build_object('budget_lifetime', c.c_budget_lifetime) end),
    (case when v_group_by in ('adset_id', 'campaign_id') then json_build_object('budget_mode', c.c_budget_mode) end),
    (case when v_group_by in ('adset_id', 'campaign_id') then json_build_object('budget_currency', c.c_budget_currency) end)
  ) x(v)
  where x.v is not null;

  return;
end;
$$;


ALTER FUNCTION public.fetch_manager_rankings_v170(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text, p_include_custom boolean, p_thumb_public_prefix text) OWNER TO postgres;

--
-- Name: FUNCTION fetch_manager_rankings_v170(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text, p_include_custom boolean, p_thumb_public_prefix text); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.fetch_manager_rankings_v170(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text, p_include_custom boolean, p_thumb_public_prefix text) IS '170: a v162 com a regra "métrica de vídeo não se aplica a anúncio de imagem" — anúncio com media_type=image não contribui para plays, thruplays, hook, hold rate, scroll stop, 50% e 75% (nem nas linhas, nem nos totais). Resto idêntico à v162.';


--
-- Name: folders_check_parent(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.folders_check_parent() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Uma árvore por usuário: serializa quem mexe em pai na MESMA árvore.
  PERFORM pg_advisory_xact_lock(hashtextextended('folders_tree:' || NEW.user_id::text, 0));

  IF NOT EXISTS (
    SELECT 1 FROM public.folders p WHERE p.id = NEW.parent_id AND p.user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'folder_parent_not_found' USING ERRCODE = 'P0001',
      HINT = 'A pasta de destino nao existe.';
  END IF;

  -- Sobe a partir do pai novo; se passar pela própria pasta, seria ciclo.
  -- UNION (não UNION ALL): termina mesmo se um ciclo já existisse.
  IF EXISTS (
    WITH RECURSIVE up AS (
      SELECT f.id, f.parent_id FROM public.folders f WHERE f.id = NEW.parent_id
      UNION
      SELECT f.id, f.parent_id FROM public.folders f JOIN up ON f.id = up.parent_id
    )
    SELECT 1 FROM up WHERE up.id = NEW.id
  ) THEN
    RAISE EXCEPTION 'folder_cycle' USING ERRCODE = 'P0001',
      HINT = 'Uma pasta nao pode ir para dentro dela mesma.';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION public.folders_check_parent() OWNER TO postgres;

--
-- Name: get_admin_users_list(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_admin_users_list() RETURNS TABLE(user_id uuid, email text, name text, tier text, meta_email text, packs_count bigint, created_at timestamp with time zone, expires_at timestamp with time zone, updated_at timestamp with time zone, granted_by uuid)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT
    u.id                                        AS user_id,
    u.email                                     AS email,
    COALESCE(u.raw_user_meta_data->>'name', u.email) AS name,
    COALESCE(s.tier, 'standard')                AS tier,
    fc.facebook_email                           AS meta_email,
    COUNT(DISTINCT p.id)                        AS packs_count,
    s.created_at                                AS created_at,
    s.expires_at                                AS expires_at,
    s.updated_at                                AS updated_at,
    s.granted_by                                AS granted_by
  FROM auth.users u
  LEFT JOIN public.subscriptions s   ON s.user_id = u.id
  LEFT JOIN public.facebook_connections fc
         ON fc.user_id = u.id AND fc.is_primary = true
  LEFT JOIN public.packs p           ON p.user_id = u.id
  GROUP BY u.id, u.email, u.raw_user_meta_data, s.tier, fc.facebook_email,
           s.created_at, s.expires_at, s.updated_at, s.granted_by
  ORDER BY s.created_at DESC NULLS LAST;
$$;


ALTER FUNCTION public.get_admin_users_list() OWNER TO postgres;

--
-- Name: FUNCTION get_admin_users_list(); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.get_admin_users_list() IS 'Admin-only: returns all users with tier, meta account, and packs count. Callable only via service role (no RLS).';


--
-- Name: handle_new_user_subscription(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.handle_new_user_subscription() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  INSERT INTO public.subscriptions (user_id, tier, source)
  VALUES (NEW.id, 'standard', 'manual')
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;


ALTER FUNCTION public.handle_new_user_subscription() OWNER TO postgres;

--
-- Name: lookup_user_by_email(text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.lookup_user_by_email(p_email text) RETURNS TABLE(user_id uuid, display_name text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select
    u.id,
    coalesce(nullif(trim(u.raw_user_meta_data->>'name'), ''), split_part(u.email, '@', 1))
  from auth.users u
  where lower(u.email) = lower(trim(p_email))
    and nullif(trim(p_email), '') is not null
  limit 1;
$$;


ALTER FUNCTION public.lookup_user_by_email(p_email text) OWNER TO postgres;

--
-- Name: FUNCTION lookup_user_by_email(p_email text); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.lookup_user_by_email(p_email text) IS 'Resolve e-mail EXATO -> (user_id, nome de exibicao) para o convite de pack. Match exato e payload minimo evitam enumeracao de cadastro. Helper interno: o backend chama com service role, para o rate limit do middleware valer.';


--
-- Name: lookup_users_by_ids(uuid[]); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.lookup_users_by_ids(p_user_ids uuid[]) RETURNS TABLE(user_id uuid, display_name text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select
    u.id,
    coalesce(nullif(trim(u.raw_user_meta_data->>'name'), ''), split_part(u.email, '@', 1))
  from auth.users u
  where p_user_ids is not null
    and u.id = any(p_user_ids);
$$;


ALTER FUNCTION public.lookup_users_by_ids(p_user_ids uuid[]) OWNER TO postgres;

--
-- Name: FUNCTION lookup_users_by_ids(p_user_ids uuid[]); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.lookup_users_by_ids(p_user_ids uuid[]) IS 'Troca ids conhecidos por nomes de exibicao na lista de membros de um pack. Nao e busca: o chamador ja tem os ids. Helper interno, chamado pelo backend com service role.';


--
-- Name: merge_ad_pack_inventory(uuid, uuid, jsonb); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.merge_ad_pack_inventory(p_user_id uuid, p_pack_id uuid, p_rows jsonb) RETURNS integer
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  v_count integer;
begin
  -- Mesmo guarda de tenancy das RPCs de gravação (113): cliente autenticado só grava no
  -- próprio silo; service role (auth.uid() nulo) é o caminho de pack compartilhado.
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'Forbidden: p_user_id must match auth.uid()' using errcode = '42501';
  end if;

  with incoming as (
    select r.*
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
      ad_id text, account_id text, campaign_id text, campaign_name text,
      adset_id text, adset_name text, ad_name text,
      first_active_date date, last_active_date date
    )
    where coalesce(r.ad_id, '') <> ''
      and r.first_active_date is not null
      and r.last_active_date is not null
      and r.first_active_date <= r.last_active_date
  ),
  -- Um anúncio repetido no mesmo lote não pode chegar duas vezes ao ON CONFLICT
  -- ("command cannot affect row a second time"): junta aqui, identidade do mais recente.
  -- Os agregados têm nome PRÓPRIO (first_d/last_d): no ORDER BY de um DISTINCT ON, o nome de
  -- coluna de saída vence o de entrada, e `order by last_active_date` ordenaria pelo máximo do
  -- grupo (igual em todas as linhas) — a identidade "mais recente" virava sorte (teste M5).
  deduped as (
    select distinct on (i.ad_id)
           i.ad_id, i.account_id, i.campaign_id, i.campaign_name, i.adset_id, i.adset_name, i.ad_name,
           min(i.first_active_date) over (partition by i.ad_id) as first_d,
           max(i.last_active_date) over (partition by i.ad_id) as last_d
    from incoming i
    order by i.ad_id, i.last_active_date desc
  )
  insert into public.ad_pack_inventory as inv (
    user_id, pack_id, ad_id, account_id, campaign_id, campaign_name, adset_id, adset_name, ad_name,
    first_active_date, last_active_date
  )
  select p_user_id, p_pack_id, d.ad_id, d.account_id, d.campaign_id, d.campaign_name,
         d.adset_id, d.adset_name, d.ad_name, d.first_d, d.last_d
  from deduped d
  on conflict (user_id, pack_id, ad_id) do update set
    first_active_date = least(inv.first_active_date, excluded.first_active_date),
    last_active_date = greatest(inv.last_active_date, excluded.last_active_date),
    account_id = coalesce(nullif(excluded.account_id, ''), inv.account_id),
    campaign_id = coalesce(nullif(excluded.campaign_id, ''), inv.campaign_id),
    campaign_name = coalesce(nullif(excluded.campaign_name, ''), inv.campaign_name),
    adset_id = coalesce(nullif(excluded.adset_id, ''), inv.adset_id),
    adset_name = coalesce(nullif(excluded.adset_name, ''), inv.adset_name),
    ad_name = coalesce(nullif(excluded.ad_name, ''), inv.ad_name),
    updated_at = now()
  -- Não regrava o que já está igual.
  where excluded.first_active_date < inv.first_active_date
     or excluded.last_active_date > inv.last_active_date
     or coalesce(nullif(excluded.account_id, ''), inv.account_id) is distinct from inv.account_id
     or coalesce(nullif(excluded.campaign_id, ''), inv.campaign_id) is distinct from inv.campaign_id
     or coalesce(nullif(excluded.campaign_name, ''), inv.campaign_name) is distinct from inv.campaign_name
     or coalesce(nullif(excluded.adset_id, ''), inv.adset_id) is distinct from inv.adset_id
     or coalesce(nullif(excluded.adset_name, ''), inv.adset_name) is distinct from inv.adset_name
     or coalesce(nullif(excluded.ad_name, ''), inv.ad_name) is distinct from inv.ad_name;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;


ALTER FUNCTION public.merge_ad_pack_inventory(p_user_id uuid, p_pack_id uuid, p_rows jsonb) OWNER TO postgres;

--
-- Name: FUNCTION merge_ad_pack_inventory(p_user_id uuid, p_pack_id uuid, p_rows jsonb); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.merge_ad_pack_inventory(p_user_id uuid, p_pack_id uuid, p_rows jsonb) IS 'F5: grava o inventário do pack a partir do refresh. Estende o intervalo (least/greatest), troca só a identidade não vazia que mudou e não regrava linha igual. Devolve linhas gravadas.';


--
-- Name: pack_acquire_refresh_lock(uuid, uuid, uuid, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.pack_acquire_refresh_lock(p_owner uuid, p_pack uuid, p_actor uuid, p_ttl_minutes integer) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


ALTER FUNCTION public.pack_acquire_refresh_lock(p_owner uuid, p_pack uuid, p_actor uuid, p_ttl_minutes integer) OWNER TO postgres;

--
-- Name: FUNCTION pack_acquire_refresh_lock(p_owner uuid, p_pack uuid, p_actor uuid, p_ttl_minutes integer); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.pack_acquire_refresh_lock(p_owner uuid, p_pack uuid, p_actor uuid, p_ttl_minutes integer) IS 'Compare-and-set da trava de refresh do pack (migration 166): marca running + prazo + ator SO se o pack nao estiver running com prazo vigente. true = adquiriu; false = ocupado. Liberacao continua por update_pack_refresh_status (status terminal) ou pela varredura da 141.';


--
-- Name: pack_clamp_inventory(uuid, uuid, date, date); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.pack_clamp_inventory(p_owner uuid, p_pack uuid, p_start date, p_stop date) RETURNS TABLE(ajustados integer, removidos integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


ALTER FUNCTION public.pack_clamp_inventory(p_owner uuid, p_pack uuid, p_start date, p_stop date) OWNER TO postgres;

--
-- Name: FUNCTION pack_clamp_inventory(p_owner uuid, p_pack uuid, p_start date, p_stop date); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.pack_clamp_inventory(p_owner uuid, p_pack uuid, p_start date, p_stop date) IS 'Recorta os intervalos ativos de ad_pack_inventory de um pack para dentro de [p_start, p_stop] (migration 167): apaga quem nao cruza mais a janela e encolhe quem passa dela. O merge do refresh so ESTENDE (least/greatest), entao sem isto um anuncio seguiria aparecendo como ativo em dia que saiu do pack. MEDIDO em 18/09: sem esta chamada o Manager mostrou 146 linhas onde restavam 143 anuncios.';


--
-- Name: pack_prune_ad_ids(uuid, uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.pack_prune_ad_ids(p_owner uuid, p_pack uuid) RETURNS text[]
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


ALTER FUNCTION public.pack_prune_ad_ids(p_owner uuid, p_pack uuid) OWNER TO postgres;

--
-- Name: FUNCTION pack_prune_ad_ids(p_owner uuid, p_pack uuid); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.pack_prune_ad_ids(p_owner uuid, p_pack uuid) IS 'Reduz packs.ad_ids aos anuncios que ainda tem metrica ou intervalo no inventario, e DEVOLVE os que sairam (migration 167) — quem chama usa a lista para tirar o pack de ads.pack_ids e recolher miniaturas orfas. update_pack_ad_ids so soma; sem isto o pack carregaria para sempre anuncio sem nenhum dia.';


--
-- Name: pack_recompute_conversion_types(uuid, uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.pack_recompute_conversion_types(p_owner uuid, p_pack uuid) RETURNS text[]
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


ALTER FUNCTION public.pack_recompute_conversion_types(p_owner uuid, p_pack uuid) OWNER TO postgres;

--
-- Name: FUNCTION pack_recompute_conversion_types(p_owner uuid, p_pack uuid); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.pack_recompute_conversion_types(p_owner uuid, p_pack uuid) IS 'Recalcula packs.conversion_types do que SOBROU no pack (migration 167). O union do refresh e monotonico (so cresce); depois de um corte, um tipo que so existia nos dias removidos seguiria no dropdown do Manager e devolveria tela vazia — campo oferecido tem de ser respondivel.';


--
-- Name: pack_trim_head(uuid, uuid, date, date, jsonb); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.pack_trim_head(p_owner uuid, p_pack uuid, p_from date, p_to date, p_keys jsonb) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
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
$_$;


ALTER FUNCTION public.pack_trim_head(p_owner uuid, p_pack uuid, p_from date, p_to date, p_keys jsonb) OWNER TO postgres;

--
-- Name: FUNCTION pack_trim_head(p_owner uuid, p_pack uuid, p_from date, p_to date, p_keys jsonb); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.pack_trim_head(p_owner uuid, p_pack uuid, p_from date, p_to date, p_keys jsonb) IS 'Apaga de ad_metrics, nos N primeiros dias do periodo novo, os pares (anuncio, dia) que a busca da cabeca NAO trouxe (migration 167): la a ausencia significa "o clique que gerava esta linha saiu do pack". p_keys = array de [ad_id, "YYYY-MM-DD"]; vazio levanta excecao (uma coleta recortada apagaria a cabeca inteira). Fora da cabeca, corta-se por PERIODO, nunca por ausencia.';


--
-- Name: pack_trim_preview(uuid, uuid, date, date); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.pack_trim_preview(p_owner uuid, p_pack uuid, p_start date, p_stop date) RETURNS TABLE(dias integer, investimento numeric, linhas bigint, anuncios bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT
    count(DISTINCT am.date)::integer          AS dias,
    coalesce(sum(am.spend), 0)::numeric       AS investimento,
    count(*)::bigint                          AS linhas,
    count(DISTINCT am.ad_id)::bigint          AS anuncios
  FROM public.ad_metrics am
  WHERE am.user_id = p_owner
    AND am.pack_id = p_pack
    AND (am.date < p_start OR am.date > p_stop);
$$;


ALTER FUNCTION public.pack_trim_preview(p_owner uuid, p_pack uuid, p_start date, p_stop date) OWNER TO postgres;

--
-- Name: FUNCTION pack_trim_preview(p_owner uuid, p_pack uuid, p_start date, p_stop date); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.pack_trim_preview(p_owner uuid, p_pack uuid, p_start date, p_stop date) IS 'Previa do recorte de periodo de um pack (migration 167): dias, investimento, linhas e anuncios que ficam FORA de [p_start, p_stop]. Conta o dado real, inclusive linhas fora da janela declarada do pack. So leitura.';


--
-- Name: place_folder(uuid, uuid, uuid[]); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.place_folder(p_folder_id uuid, p_parent_id uuid, p_sibling_ids uuid[]) RETURNS integer
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_changed integer;
BEGIN
  IF NOT (p_folder_id = ANY (p_sibling_ids)) THEN
    RAISE EXCEPTION 'folder_not_in_siblings' USING ERRCODE = 'P0001',
      HINT = 'A lista de irmaos precisa conter a pasta movida.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.folders WHERE id = p_folder_id AND user_id = v_uid) THEN
    RAISE EXCEPTION 'folder_not_found' USING ERRCODE = 'P0001', HINT = 'Pasta nao encontrada.';
  END IF;

  UPDATE public.folders
  SET parent_id = p_parent_id
  WHERE id = p_folder_id AND user_id = v_uid AND parent_id IS DISTINCT FROM p_parent_id;

  WITH wanted AS (
    SELECT t.id, (t.ord - 1)::integer AS pos
    FROM unnest(p_sibling_ids) WITH ORDINALITY AS t(id, ord)
  ),
  changed AS (
    UPDATE public.folders f
    SET position = w.pos
    FROM wanted w
    WHERE f.id = w.id
      AND f.user_id = v_uid
      -- Só quem está MESMO nesse grupo: id de outro nível na lista é ignorado.
      AND f.parent_id IS NOT DISTINCT FROM p_parent_id
      AND f.position IS DISTINCT FROM w.pos
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_changed FROM changed;

  RETURN v_changed;
END;
$$;


ALTER FUNCTION public.place_folder(p_folder_id uuid, p_parent_id uuid, p_sibling_ids uuid[]) OWNER TO postgres;

--
-- Name: FUNCTION place_folder(p_folder_id uuid, p_parent_id uuid, p_sibling_ids uuid[]); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.place_folder(p_folder_id uuid, p_parent_id uuid, p_sibling_ids uuid[]) IS 'Move a pasta para p_parent_id (NULL = raiz) e grava a ordem completa do grupo de destino; so escreve o que mudou (migration 174).';


--
-- Name: present_parent_ids(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.present_parent_ids(p_user_id uuid) RETURNS TABLE(campaign_ids text[], adset_ids text[])
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  -- O `distinct` dos pares primeiro é o que evita o sort em disco: 46.581 linhas
  -- viram ~5.090 pares distintos, e só esses chegam ao array_agg.
  with pares as (
    select distinct campaign_id, adset_id
    from public.ads
    where user_id = p_user_id
  )
  select
    coalesce(array_agg(distinct campaign_id) filter (where campaign_id is not null), '{}'::text[]),
    coalesce(array_agg(distinct adset_id)    filter (where adset_id    is not null), '{}'::text[])
  from pares;
$$;


ALTER FUNCTION public.present_parent_ids(p_user_id uuid) OWNER TO postgres;

--
-- Name: FUNCTION present_parent_ids(p_user_id uuid); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.present_parent_ids(p_user_id uuid) IS 'Campanhas e conjuntos com anúncio importado no silo do usuário, como dois arrays. Filtro de escopo de upsert_parent_entities. SECURITY INVOKER de propósito: a RLS de `ads` vale para o cliente com JWT, e o service role usa p_user_id como silo explícito (convenção P3.3b). Ver migration 151.';


--
-- Name: preserve_ads_meta_created_time(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.preserve_ads_meta_created_time() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- Data de criacao e imutavel: um upsert sem o valor (ad fora do inventario) nao pode
  -- reescrever como NULL o que ja foi lido da Meta.
  IF NEW.meta_created_time IS NULL THEN
    NEW.meta_created_time := OLD.meta_created_time;
  END IF;
  RETURN NEW;
END
$$;


ALTER FUNCTION public.preserve_ads_meta_created_time() OWNER TO postgres;

--
-- Name: purge_pack_action_log(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.purge_pack_action_log() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  deleted integer;
BEGIN
  DELETE FROM public.pack_action_log
   WHERE created_at < now() - interval '365 days';
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END;
$$;


ALTER FUNCTION public.purge_pack_action_log() OWNER TO postgres;

--
-- Name: FUNCTION purge_pack_action_log(); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.purge_pack_action_log() IS 'Retencao de 365 dias do pack_action_log (decisao travada 2026-08-17). Agendada por pg_cron; chamavel manualmente se o agendamento nao existir.';


--
-- Name: release_job_processing_lease(text, uuid, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.release_job_processing_lease(p_job_id text, p_user_id uuid, p_owner text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$



DECLARE



  v_released boolean := false;



BEGIN
  -- Guard de tenancy (migration 113): caller autenticado so opera o PROPRIO
  -- silo; service role (auth.uid() nulo) passa - e o caminho do backend para
  -- operacoes de pack compartilhado (P3.3), que ja derivou o dono via
  -- resolve_pack_access antes de chegar aqui.
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Forbidden: p_user_id must match auth.uid()';
  END IF;











  UPDATE public.jobs



  SET



    processing_owner = NULL,



    processing_claimed_at = NULL,



    processing_lease_until = NULL,



    updated_at = now()



  WHERE id = p_job_id



    AND user_id = p_user_id



    AND processing_owner = p_owner;







  v_released := FOUND;







  RETURN jsonb_build_object(



    'released', v_released



  );



END;



$$;


ALTER FUNCTION public.release_job_processing_lease(p_job_id text, p_user_id uuid, p_owner text) OWNER TO postgres;

--
-- Name: FUNCTION release_job_processing_lease(p_job_id text, p_user_id uuid, p_owner text); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.release_job_processing_lease(p_job_id text, p_user_id uuid, p_owner text) IS 'Libera o lease do worker que ainda detém o processamento do job.';


--
-- Name: renew_job_processing_lease(text, uuid, text, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.renew_job_processing_lease(p_job_id text, p_user_id uuid, p_owner text, p_lease_seconds integer DEFAULT 300) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$



DECLARE



  v_renewed boolean := false;



BEGIN
  -- Guard de tenancy (migration 113): caller autenticado so opera o PROPRIO
  -- silo; service role (auth.uid() nulo) passa - e o caminho do backend para
  -- operacoes de pack compartilhado (P3.3), que ja derivou o dono via
  -- resolve_pack_access antes de chegar aqui.
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Forbidden: p_user_id must match auth.uid()';
  END IF;











  UPDATE public.jobs



  SET



    processing_lease_until = now() + make_interval(secs => GREATEST(p_lease_seconds, 30)),



    updated_at = now()



  WHERE id = p_job_id



    AND user_id = p_user_id



    AND processing_owner = p_owner



    AND status IN ('processing', 'persisting');







  v_renewed := FOUND;







  RETURN jsonb_build_object(



    'renewed', v_renewed



  );



END;



$$;


ALTER FUNCTION public.renew_job_processing_lease(p_job_id text, p_user_id uuid, p_owner text, p_lease_seconds integer) OWNER TO postgres;

--
-- Name: FUNCTION renew_job_processing_lease(p_job_id text, p_user_id uuid, p_owner text, p_lease_seconds integer); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.renew_job_processing_lease(p_job_id text, p_user_id uuid, p_owner text, p_lease_seconds integer) IS 'Renova o lease de processamento do worker atual se ele ainda for o owner do job.';


--
-- Name: reorder_folders(uuid[]); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.reorder_folders(p_folder_ids uuid[]) RETURNS integer
    LANGUAGE sql
    SET search_path TO ''
    AS $$
  WITH wanted AS (
    SELECT t.id, (t.ord - 1)::integer AS pos
    FROM unnest(p_folder_ids) WITH ORDINALITY AS t(id, ord)
  ),
  changed AS (
    UPDATE public.folders f
    SET position = w.pos
    FROM wanted w
    WHERE f.id = w.id
      AND f.user_id = (SELECT auth.uid())
      AND f.position IS DISTINCT FROM w.pos
    RETURNING 1
  )
  SELECT count(*)::integer FROM changed;
$$;


ALTER FUNCTION public.reorder_folders(p_folder_ids uuid[]) OWNER TO postgres;

--
-- Name: FUNCTION reorder_folders(p_folder_ids uuid[]); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.reorder_folders(p_folder_ids uuid[]) IS 'Grava a ordem das pastas do ator: p_folder_ids e a lista completa, de cima para baixo; position = indice. Um UPDATE so, escrevendo apenas o que mudou. Devolve quantas linhas mudaram (migration 173).';


--
-- Name: resolve_pack_access(uuid[], uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.resolve_pack_access(p_pack_ids uuid[], p_actor_id uuid DEFAULT NULL::uuid) RETURNS TABLE(pack_id uuid, owner_id uuid, role text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select
    p.id                                   as pack_id,
    p.user_id                              as owner_id,
    case when p.user_id = coalesce(p_actor_id, auth.uid())
         then 'dono'
         else s.role
    end                                    as role
  from public.packs p
  left join public.pack_shares s
    on s.pack_id = p.id
   and s.grantee_id = coalesce(p_actor_id, auth.uid())
    -- Redundante com a FK composta, de proposito: se alguem dropar a constraint,
    -- o resolvedor ainda recusa grant cujo owner_id nao seja o dono real.
   and s.owner_id = p.user_id
  where p_pack_ids is not null
    and p.id = any(p_pack_ids)
    and (
      p.user_id = coalesce(p_actor_id, auth.uid())
      or s.id is not null
    );
$$;


ALTER FUNCTION public.resolve_pack_access(p_pack_ids uuid[], p_actor_id uuid) OWNER TO postgres;

--
-- Name: FUNCTION resolve_pack_access(p_pack_ids uuid[], p_actor_id uuid); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.resolve_pack_access(p_pack_ids uuid[], p_actor_id uuid) IS 'Packs acessiveis pelo ator entre os pedidos, com dono e papel (dono|editor|viewer). Pack inacessivel nao retorna — o chamador compara a contagem. Helper interno, nao exposto ao PostgREST.';


--
-- Name: resolve_pack_mql_leadscore_min(uuid, uuid[]); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.resolve_pack_mql_leadscore_min(p_user_id uuid, p_pack_ids uuid[] DEFAULT NULL::uuid[]) RETURNS numeric
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    SET plan_cache_mode TO 'force_custom_plan'
    AS $$
declare
  v_distinct_count integer := 0;
  v_value numeric;
begin
  if p_pack_ids is null or array_length(p_pack_ids, 1) is null then
    return null;
  end if;

  -- Um valor por pack ACESSIVEL (proprio ou compartilhado). Pack sem acesso nao
  -- aparece em resolve_pack_access, entao nao ha como sondar pack alheio aqui.
  --
  -- `select distinct` trata NULL como valor: se um pack tem corte e outro nao,
  -- o conjunto tem 2 elementos e cai em divergencia — que e o desejado, porque
  -- misturar "cortado em 40" com "sem corte" nao produz um numero honesto.
  select count(*), min(s.v)
    into v_distinct_count, v_value
  from (
    select distinct pk.mql_leadscore_min as v
    from public.resolve_pack_access(p_pack_ids, p_user_id) a
    join public.packs pk on pk.id = a.pack_id
  ) s;

  if v_distinct_count = 1 then
    return v_value;  -- pode ser NULL: pack unico e sem corte definido
  end if;

  -- 0 packs acessiveis, ou divergencia -> indefinido. Sem fallback: nao existe
  -- mais "padrao do ator" para onde cair, e inventar um recriaria o furo.
  return null;
end;
$$;


ALTER FUNCTION public.resolve_pack_mql_leadscore_min(p_user_id uuid, p_pack_ids uuid[]) OWNER TO postgres;

--
-- Name: FUNCTION resolve_pack_mql_leadscore_min(p_user_id uuid, p_pack_ids uuid[]); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.resolve_pack_mql_leadscore_min(p_user_id uuid, p_pack_ids uuid[]) IS 'Corte de leadscore para MQL dos packs selecionados. Vem SO do pack — sem heranca de user_preferences. Retorna NULL quando indefinido ou divergente entre packs, e nesse caso MQL/CPMQL ficam indisponiveis. Helper interno — nao exposto ao PostgREST.';


--
-- Name: set_subscriptions_updated_at(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.set_subscriptions_updated_at() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION public.set_subscriptions_updated_at() OWNER TO postgres;

--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION public.set_updated_at() OWNER TO postgres;

--
-- Name: sweep_stale_pack_refresh(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.sweep_stale_pack_refresh() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  afetados integer;
BEGIN
  -- `refresh_lock_until` e `timestamp` SEM timezone e guarda UTC. Comparar direto
  -- com `now()` (timestamptz) faria o Postgres interpretar a coluna no fuso da
  -- SESSAO: correto hoje (o banco esta em UTC), silenciosamente errado no dia em
  -- que alguem mudar isso. `now() at time zone 'utc'` torna a comparacao
  -- naive-contra-naive e imune ao fuso da sessao.
  UPDATE public.packs
     SET refresh_status = 'failed',
         refresh_lock_until = NULL,
         refresh_actor_id = NULL
   WHERE refresh_status = 'running'
     AND refresh_lock_until IS NOT NULL
     AND refresh_lock_until < (now() AT TIME ZONE 'utc');

  GET DIAGNOSTICS afetados = ROW_COUNT;
  RETURN afetados;
END;
$$;


ALTER FUNCTION public.sweep_stale_pack_refresh() OWNER TO postgres;

--
-- Name: FUNCTION sweep_stale_pack_refresh(); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.sweep_stale_pack_refresh() IS 'Marca como failed os packs presos em refresh_status=running cujo prazo (refresh_lock_until) venceu — job que morreu sem escrever o status final. Agendada por pg_cron; chamavel manualmente se o agendamento nao existir.';


--
-- Name: url_quote_path(text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.url_quote_path(p text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE STRICT
    SET search_path TO 'public'
    AS $$
declare
  b bytea;
  c integer;
  i integer;
  o text := '';
begin
  -- Atalho exato: sem faixas de regex (`A-Z` depende de colação em alguns locales),
  -- apaga os caracteres seguros um a um e vê se sobrou algo.
  if translate(p, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789/_.~-', '') = '' then
    return p;
  end if;
  b := convert_to(p, 'UTF8');
  for i in 0 .. length(b) - 1 loop
    c := get_byte(b, i);
    if c = 47                          -- '/', o separador de segmentos
       or c between 48 and 57          -- 0-9
       or c between 65 and 90          -- A-Z
       or c between 97 and 122         -- a-z
       or c in (45, 46, 95, 126)       -- - . _ ~
    then
      o := o || chr(c);
    else
      o := o || '%' || upper(lpad(to_hex(c), 2, '0'));
    end if;
  end loop;
  return o;
end;
$$;


ALTER FUNCTION public.url_quote_path(p text) OWNER TO postgres;

--
-- Name: FUNCTION url_quote_path(p text); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.url_quote_path(p text) IS '161: mesma codificação do _quote_path do backend (quote por segmento, safe=""). Usada para montar a URL pública da miniatura no Storage.';


--
-- Name: ad_accounts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ad_accounts (
    id text NOT NULL,
    user_id uuid NOT NULL,
    name text,
    account_status integer,
    user_tasks text[],
    business_id text,
    business_name text,
    instagram_accounts jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    connection_id uuid,
    requires_ads_transparency boolean DEFAULT false NOT NULL,
    currency text
);


ALTER TABLE public.ad_accounts OWNER TO postgres;

--
-- Name: COLUMN ad_accounts.connection_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.ad_accounts.connection_id IS 'ID da conexão Facebook que concedeu acesso a esta conta de anúncios. NULL mantém compatibilidade com registros antigos.';


--
-- Name: COLUMN ad_accounts.requires_ads_transparency; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.ad_accounts.requires_ads_transparency IS 'True when Meta has rejected an adset creation on this account with subcode 3858495 (compliance_section). Set automatically by campaign_bulk_service when the error occurs. Used by the frontend to warn before submission.';


--
-- Name: COLUMN ad_accounts.currency; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.ad_accounts.currency IS 'Moeda da conta de anúncio (ex.: BRL, USD, JPY). Fonte: Meta API /me/adaccounts?fields=currency. Budgets/spend da Meta são expressos em subunidade desta moeda. NULL = ainda não sincronizado.';


--
-- Name: ad_performance_daily; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ad_performance_daily (
    user_id uuid NOT NULL,
    ad_id text NOT NULL,
    date date NOT NULL,
    conv_key_ids integer[] DEFAULT '{}'::integer[] NOT NULL,
    conv_values numeric[] DEFAULT '{}'::numeric[] NOT NULL,
    lead_scores numeric[] DEFAULT '{}'::numeric[] NOT NULL,
    lead_qtys integer[] DEFAULT '{}'::integer[] NOT NULL,
    account_id text,
    campaign_id text,
    adset_id text,
    ad_name text,
    impressions bigint DEFAULT 0 NOT NULL,
    clicks bigint DEFAULT 0 NOT NULL,
    inline_link_clicks bigint DEFAULT 0 NOT NULL,
    spend numeric DEFAULT 0 NOT NULL,
    lpv bigint DEFAULT 0 NOT NULL,
    plays bigint DEFAULT 0 NOT NULL,
    thruplays bigint DEFAULT 0 NOT NULL,
    video_watched_p50 numeric DEFAULT 0 NOT NULL,
    video_watched_p75 numeric DEFAULT 0 NOT NULL,
    hold_rate numeric DEFAULT 0 NOT NULL,
    reach bigint DEFAULT 0 NOT NULL,
    frequency numeric DEFAULT 0 NOT NULL,
    hook_value numeric DEFAULT 0 NOT NULL,
    scroll_stop_value numeric DEFAULT 0 NOT NULL,
    custom_hist jsonb,
    pack_id uuid NOT NULL,
    CONSTRAINT ad_performance_daily_pairs_chk CHECK (((cardinality(conv_key_ids) = cardinality(conv_values)) AND (cardinality(lead_scores) = cardinality(lead_qtys))))
)
WITH (autovacuum_vacuum_scale_factor='0.02', autovacuum_vacuum_insert_scale_factor='0.02', autovacuum_analyze_scale_factor='0.05');


ALTER TABLE public.ad_performance_daily OWNER TO postgres;

--
-- Name: TABLE ad_performance_daily; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.ad_performance_daily IS 'READ MODEL do anuncio-dia POR PACK (145): uma linha por (user, pack, anuncio, dia), derivada de ad_metrics pelos gatilhos ad_metrics_rollup_sync_ins/_upd; delete/mudanca de chave propagam por FK. Reconstruivel com ad_performance_rollup_rebuild(user_id). NAO escrever aqui a mao.';


--
-- Name: COLUMN ad_performance_daily.hook_value; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.ad_performance_daily.hook_value IS 'coalesce(hook_rate, curva[3]/100 se >1) — a expressão da RPC v116, calculada na escrita (migration 129).';


--
-- Name: COLUMN ad_performance_daily.scroll_stop_value; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.ad_performance_daily.scroll_stop_value IS 'coalesce(scroll_stop_rate, curva[1]/100 se >1) — a expressão da RPC v116, calculada na escrita (migration 129).';


--
-- Name: COLUMN ad_performance_daily.custom_hist; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.ad_performance_daily.custom_hist IS 'Cópia de ad_metrics.custom_hist (derivação = identidade, {} vira NULL). Migration 140.';


--
-- Name: ads; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ads (
    ad_id text NOT NULL,
    user_id uuid NOT NULL,
    account_id text,
    campaign_id text,
    campaign_name text,
    adset_id text,
    adset_name text,
    ad_name text,
    effective_status text,
    creative jsonb,
    creative_video_id text,
    thumbnail_url text,
    instagram_permalink_url text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    pack_ids uuid[] DEFAULT '{}'::uuid[],
    adcreatives_videos_ids jsonb,
    adcreatives_videos_thumbs jsonb,
    leadscore numeric,
    thumb_storage_path text,
    thumb_cached_at timestamp with time zone,
    thumb_source_url text,
    transcription_id uuid,
    video_owner_page_id text,
    primary_video_id text,
    media_type text DEFAULT 'unknown'::text NOT NULL,
    adset_status text,
    campaign_status text,
    video_source_url text,
    video_source_expires_at timestamp with time zone,
    image_source_url text,
    image_source_expires_at timestamp with time zone,
    meta_created_time timestamp with time zone,
    CONSTRAINT ads_media_type_check CHECK ((media_type = ANY (ARRAY['video'::text, 'image'::text, 'unknown'::text])))
)
WITH (autovacuum_vacuum_scale_factor='0.02', autovacuum_vacuum_insert_scale_factor='0.02', autovacuum_analyze_scale_factor='0.05');


ALTER TABLE public.ads OWNER TO postgres;

--
-- Name: COLUMN ads.effective_status; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.ads.effective_status IS 'effective_status do PROPRIO anuncio (nao confundir com o status do pai, que vive em parent_entities). Continua escrito e lido: alimenta a cascata de marcadores ADSET_PAUSED/CAMPAIGN_PAUSED usada como fallback pelo wrapper do Manager.';


--
-- Name: COLUMN ads.adcreatives_videos_ids; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.ads.adcreatives_videos_ids IS 'Array de video IDs do asset_feed_spec';


--
-- Name: COLUMN ads.adcreatives_videos_thumbs; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.ads.adcreatives_videos_thumbs IS 'Array de thumbnail URLs do asset_feed_spec';


--
-- Name: COLUMN ads.thumb_storage_path; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.ads.thumb_storage_path IS 'Path do objeto no Supabase Storage (bucket público ad-thumbs).';


--
-- Name: COLUMN ads.thumb_cached_at; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.ads.thumb_cached_at IS 'Quando o thumbnail foi cacheado no Storage.';


--
-- Name: COLUMN ads.thumb_source_url; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.ads.thumb_source_url IS 'URL original usada para baixar/cachear o thumbnail (normalmente adcreatives_videos_thumbs[0]).';


--
-- Name: COLUMN ads.transcription_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.ads.transcription_id IS 'Referência à transcrição do vídeo (por ad_name). Null se não houver transcrição.';


--
-- Name: COLUMN ads.adset_status; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.ads.adset_status IS 'MORTA desde a migration 123: sem leitor (desde a 122) e sem escritor. Os valores estao congelados no estado de 2026-08-25 e envelhecem — NAO usar. Verdade do status do conjunto: parent_entities.effective_status. Mantida apenas para viabilizar rollback da 122; DROP em migration futura.';


--
-- Name: COLUMN ads.campaign_status; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.ads.campaign_status IS 'MORTA desde a migration 123: sem leitor (desde a 122) e sem escritor. Os valores estao congelados no estado de 2026-08-25 e envelhecem — NAO usar. Verdade do status da campanha: parent_entities.effective_status. Mantida apenas para viabilizar rollback da 122; DROP em migration futura.';


--
-- Name: COLUMN ads.video_source_url; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.ads.video_source_url IS 'Última URL de source do vídeo resolvida na Meta (CDN assinada, perecível). Usar apenas se video_source_expires_at ainda tiver margem.';


--
-- Name: COLUMN ads.video_source_expires_at; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.ads.video_source_expires_at IS 'Expiry da video_source_url (extraído do parâmetro oe= da URL; fallback conservador quando ausente).';


--
-- Name: COLUMN ads.meta_created_time; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.ads.meta_created_time IS 'created_time do no Ad da Graph API: quando o anuncio foi CRIADO no Meta. Nao confundir com created_at (quando a linha entrou neste banco) nem com inicio de veiculacao (o Meta nao expoe esse campo). NULL = ad ainda nao ressincronizado desde a migration 115.';


--
-- Name: packs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.packs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    adaccount_id text,
    name text NOT NULL,
    date_start date NOT NULL,
    date_stop date NOT NULL,
    level text NOT NULL,
    filters jsonb DEFAULT '[]'::jsonb NOT NULL,
    stats jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    auto_refresh boolean DEFAULT false NOT NULL,
    last_refreshed_at date,
    refresh_status text DEFAULT 'idle'::text,
    last_prompted_at date,
    refresh_lock_until timestamp without time zone,
    ad_ids text[] DEFAULT '{}'::text[],
    sheet_integration_id uuid,
    conversion_types text[] DEFAULT '{}'::text[] NOT NULL,
    mql_leadscore_min numeric,
    target_cpr jsonb,
    diagnostic_cost_metric text,
    last_status_sync_at timestamp with time zone,
    refresh_actor_id uuid,
    attribution_window_days integer,
    attribution_setting text,
    CONSTRAINT packs_diagnostic_cost_metric_check CHECK (((diagnostic_cost_metric IS NULL) OR (diagnostic_cost_metric = ANY (ARRAY['cpr'::text, 'cpmql'::text])))),
    CONSTRAINT packs_level_check CHECK ((level = ANY (ARRAY['campaign'::text, 'adset'::text, 'ad'::text]))),
    CONSTRAINT packs_mql_leadscore_min_check CHECK (((mql_leadscore_min IS NULL) OR (mql_leadscore_min >= (0)::numeric))),
    CONSTRAINT packs_refresh_status_check CHECK ((refresh_status = ANY (ARRAY['idle'::text, 'queued'::text, 'running'::text, 'cancel_requested'::text, 'canceled'::text, 'success'::text, 'failed'::text])))
);


ALTER TABLE public.packs OWNER TO postgres;

--
-- Name: COLUMN packs.sheet_integration_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.packs.sheet_integration_id IS 'Referência à integração de planilha Google Sheets associada a este pack. Permite buscar dados da integração diretamente via JOIN ao buscar packs.';


--
-- Name: COLUMN packs.conversion_types; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.packs.conversion_types IS 'Lista materializada (union incremental, monotonica) dos conversion types do pack. Chaves: conversion:<action_type> / action:<action_type>. Populada no refresh (union dos dados ingeridos) + backfill inicial. Fonte do dropdown de eventos no Manager.';


--
-- Name: COLUMN packs.mql_leadscore_min; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.packs.mql_leadscore_min IS 'Override do leadscore minimo para MQL neste pack. NULL = herda user_preferences.mql_leadscore_min.';


--
-- Name: COLUMN packs.target_cpr; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.packs.target_cpr IS 'Override do CPR alvo por action_type neste pack (Record<action_type, number>). NULL = herda user_preferences.target_cpr.';


--
-- Name: COLUMN packs.diagnostic_cost_metric; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.packs.diagnostic_cost_metric IS 'Override da metrica de custo do diagnostico neste pack (cpr|cpmql). NULL = herda user_preferences.diagnostic_cost_metric.';


--
-- Name: COLUMN packs.last_status_sync_at; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.packs.last_status_sync_at IS 'Instante do ultimo sync de status on-focus deste pack (TTL de 5 min). Fonte de verdade COMPARTILHADA entre os 4 workers do uvicorn -- antes vivia num dict de processo e o TTL era anulado pela quantidade de workers (migration 127). NULL = nunca sincronizado ou slot liberado apos falha, para permitir retry.';


--
-- Name: COLUMN packs.refresh_actor_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.packs.refresh_actor_id IS 'Ator do refresh em andamento (quem disparou; num pack compartilhado difere do dono). Escrito junto com refresh_status=running, limpo em qualquer status terminal. Le-se sempre com refresh_status + refresh_lock_until, nunca sozinho.';


--
-- Name: COLUMN packs.attribution_window_days; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.packs.attribution_window_days IS 'Recuo (dias) do refresh incremental = maior janela de atribuicao vista nas linhas do pack. NULL = ainda nao calibrado (codigo usa 7).';


--
-- Name: COLUMN packs.attribution_setting; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.packs.attribution_setting IS 'Valor cru do attribution_setting da Meta que originou attribution_window_days (ex.: 1d_view_7d_click).';


--
-- Name: conversion_keys; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.conversion_keys (
    id integer NOT NULL,
    key text NOT NULL,
    CONSTRAINT conversion_keys_key_check CHECK ((key ~ '^(conversion|action):.+$'::text))
);


ALTER TABLE public.conversion_keys OWNER TO postgres;

--
-- Name: TABLE conversion_keys; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.conversion_keys IS 'Dicionário append-only das chaves de evento ("conversion:<action_type>" / "action:<action_type>", o MESMO formato de p_action_type e de packs.conversion_types). Referenciado por id em ad_performance_daily.conv_key_ids (migration 128). Nunca apagar linhas: ids são referenciados sem FK (custo de escrita).';


--
-- Name: ad_transcriptions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ad_transcriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    ad_name text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    full_text text,
    timestamped_text jsonb,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    ad_ids text[] DEFAULT '{}'::text[],
    CONSTRAINT ad_transcriptions_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'failed'::text])))
);


ALTER TABLE public.ad_transcriptions OWNER TO postgres;

--
-- Name: COLUMN ad_transcriptions.ad_ids; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.ad_transcriptions.ad_ids IS 'Array de ad_id dos anúncios que compartilham esta transcrição (mesmo ad_name).';


--
-- Name: ad_metric_pack_map; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ad_metric_pack_map (
    user_id uuid NOT NULL,
    pack_id uuid NOT NULL,
    ad_id text NOT NULL,
    metric_date date NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
)
WITH (autovacuum_vacuum_scale_factor='0.02', autovacuum_vacuum_insert_scale_factor='0.02', autovacuum_analyze_scale_factor='0.05');


ALTER TABLE public.ad_metric_pack_map OWNER TO postgres;

--
-- Name: ad_pack_inventory; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ad_pack_inventory (
    user_id uuid NOT NULL,
    pack_id uuid NOT NULL,
    ad_id text NOT NULL,
    account_id text,
    campaign_id text,
    campaign_name text,
    adset_id text,
    adset_name text,
    ad_name text,
    first_active_date date NOT NULL,
    last_active_date date NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ad_pack_inventory_interval_check CHECK ((first_active_date <= last_active_date))
);


ALTER TABLE public.ad_pack_inventory OWNER TO postgres;

--
-- Name: TABLE ad_pack_inventory; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.ad_pack_inventory IS 'Inventário do pack (F5): uma linha por (pack, anúncio) visto entregável por algum refresh, com o intervalo [first_active_date, last_active_date]. Substitui as linhas-zero diárias de ad_metrics como fonte de presença do anúncio ativo sem entrega.';


--
-- Name: ad_shares; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ad_shares (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    token text NOT NULL,
    date_start date NOT NULL,
    date_stop date NOT NULL,
    currency text,
    items jsonb DEFAULT '[]'::jsonb NOT NULL,
    view_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    revoked_at timestamp with time zone,
    averages jsonb,
    highlight_metrics jsonb DEFAULT '[]'::jsonb NOT NULL
);


ALTER TABLE public.ad_shares OWNER TO postgres;

--
-- Name: TABLE ad_shares; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.ad_shares IS 'Links públicos de compartilhamento de criativos (formato stories, /s/{token}). Snapshot autocontido: o read-path público (backend, service role) lê só esta tabela. Sem policy anon — acesso anônimo é intermediado pelo backend.';


--
-- Name: COLUMN ad_shares.token; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.ad_shares.token IS 'Token não-adivinhável do link público (secrets.token_urlsafe no backend). Unique.';


--
-- Name: COLUMN ad_shares.currency; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.ad_shares.currency IS 'Moeda das métricas monetárias do snapshot (ex.: BRL). Congelada na criação — a conta pode mudar depois, o share não.';


--
-- Name: COLUMN ad_shares.items; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.ad_shares.items IS 'Array de slides: {ad_name, media: {type, thumbnail_url, video_url, video_expires_at, image_url}, metrics: {...}}. video_url expira (oe= da CDN da Meta) — o viewer compara video_expires_at com o relógio e degrada para aviso, por design.';


--
-- Name: COLUMN ad_shares.view_count; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.ad_shares.view_count IS 'Contador best-effort de aberturas do link público (incremento não-atômico; precisão aproximada é suficiente).';


--
-- Name: COLUMN ad_shares.expires_at; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.ad_shares.expires_at IS 'Expiração do LINK inteiro (default: criação + 30 dias, gravado pelo backend). NULL = sem expiração (não usado no MVP). Independente da expiração do vídeo de cada slide.';


--
-- Name: COLUMN ad_shares.revoked_at; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.ad_shares.revoked_at IS 'Revogação manual pelo dono (DELETE /shares/{id} faz UPDATE aqui, preservando view_count para histórico). NULL = ativo.';


--
-- Name: COLUMN ad_shares.averages; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.ad_shares.averages IS 'Medias do conjunto de criativos no momento da criacao (mesmas chaves de items[].metrics). Congeladas junto com as metricas: comparar valor de ontem com media de hoje mentiria. NULL = share criado antes desta migration (viewer degrada para cards neutros, sem cor/delta).';


--
-- Name: COLUMN ad_shares.highlight_metrics; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.ad_shares.highlight_metrics IS 'Ate 2 chaves de metrica exibidas no painel "espiado" do viewer, sem expandir. [] = nenhuma em destaque (painel so abre no toque).';


--
-- Name: ad_sheet_integrations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ad_sheet_integrations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    spreadsheet_id text NOT NULL,
    worksheet_title text NOT NULL,
    match_strategy text DEFAULT 'AD_ID'::text NOT NULL,
    ad_id_column text NOT NULL,
    date_column text NOT NULL,
    leadscore_column text,
    last_synced_at timestamp with time zone,
    last_sync_status text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    date_format text,
    pack_id uuid,
    connection_id uuid,
    last_successful_sync_at timestamp with time zone,
    ad_id_column_index integer,
    date_column_index integer,
    leadscore_column_index integer,
    spreadsheet_name text,
    spreadsheet_renamed_from text
);


ALTER TABLE public.ad_sheet_integrations OWNER TO postgres;

--
-- Name: COLUMN ad_sheet_integrations.date_format; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.ad_sheet_integrations.date_format IS 'Formato de data da planilha: DD/MM/YYYY ou MM/DD/YYYY';


--
-- Name: COLUMN ad_sheet_integrations.connection_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.ad_sheet_integrations.connection_id IS 'ID da conexão Google específica a usar para esta integração. NULL significa usar a primeira conexão disponível (compatibilidade com integrações antigas).';


--
-- Name: COLUMN ad_sheet_integrations.last_successful_sync_at; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.ad_sheet_integrations.last_successful_sync_at IS 'Timestamp da última sincronização bem-sucedida. Este campo é atualizado apenas quando a sincronização é concluída com sucesso, ao contrário de last_synced_at que pode ser atualizado mesmo em caso de falha.';


--
-- Name: COLUMN ad_sheet_integrations.ad_id_column_index; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.ad_sheet_integrations.ad_id_column_index IS 'Índice da coluna quando há headers duplicados (0-based). Usado apenas quando ad_id_column aparece mais de uma vez.';


--
-- Name: COLUMN ad_sheet_integrations.spreadsheet_renamed_from; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.ad_sheet_integrations.spreadsheet_renamed_from IS 'Nome imediatamente anterior da planilha, quando uma renomeacao foi detectada no Drive. NULL = nunca renomeada, ja reconciliada por um sync que aplicou linhas, ou dispensada pelo usuario ("estou ciente"). Alimenta o aviso "Renomeada: antes era X." no card do pack.';


--
-- Name: ad_tags; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ad_tags (
    user_id uuid NOT NULL,
    tag_id uuid NOT NULL,
    ad_name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    CONSTRAINT ad_tags_ad_name_not_blank CHECK ((btrim(ad_name) <> ''::text))
);


ALTER TABLE public.ad_tags OWNER TO postgres;

--
-- Name: TABLE ad_tags; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.ad_tags IS 'Marcacao tag <-> criativo. Chaveada por ad_name (criativo), nao ad_id, e sem FK para ads: a tag sobrevive ao anuncio sumir da Meta.';


--
-- Name: COLUMN ad_tags.created_by; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.ad_tags.created_by IS 'Quem aplicou a marcacao. user_id e o SILO (dono do pack); created_by e o ATOR. Num pack compartilhado sao pessoas diferentes, e este e o unico registro dessa autoria.';


--
-- Name: board_groups; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.board_groups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    board_id uuid NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    color text DEFAULT 'chart1'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    rules jsonb DEFAULT '{"logic": "AND", "conditions": []}'::jsonb NOT NULL,
    sort_metric text DEFAULT 'spend'::text NOT NULL,
    sort_direction text DEFAULT 'desc'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT board_groups_name_max_len CHECK ((char_length(name) <= 60)),
    CONSTRAINT board_groups_name_not_blank CHECK ((btrim(name) <> ''::text)),
    CONSTRAINT board_groups_rules_object CHECK ((jsonb_typeof(rules) = 'object'::text)),
    CONSTRAINT board_groups_sort_direction CHECK ((sort_direction = ANY (ARRAY['asc'::text, 'desc'::text])))
);


ALTER TABLE public.board_groups OWNER TO postgres;

--
-- Name: TABLE board_groups; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.board_groups IS 'Grupo de um board. Pertencimento e DERIVADO de rules (jsonb), nunca manual — nao existe tabela de membership.';


--
-- Name: COLUMN board_groups.rules; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.board_groups.rules IS 'Arvore {logic, conditions} avaliada no cliente. Valor de condicao percentual fica na escala digitada (30 = 30%).';


--
-- Name: boards; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.boards (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT boards_name_max_len CHECK ((char_length(name) <= 60)),
    CONSTRAINT boards_name_not_blank CHECK ((btrim(name) <> ''::text))
);


ALTER TABLE public.boards OWNER TO postgres;

--
-- Name: TABLE boards; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.boards IS 'Board = lente de agrupamento de criativos. Nao guarda pack nem periodo: o recorte vem do seletor global.';


--
-- Name: bulk_ad_items; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.bulk_ad_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id text NOT NULL,
    user_id uuid NOT NULL,
    file_name text NOT NULL,
    file_index integer NOT NULL,
    adset_id text NOT NULL,
    adset_name text,
    ad_name text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    meta_ad_id text,
    meta_creative_id text,
    error_message text,
    error_code text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    bundle_id text,
    bundle_name text,
    slot_files jsonb,
    is_multi_slot boolean DEFAULT false NOT NULL,
    campaign_name text,
    slot_media jsonb,
    error_details jsonb,
    CONSTRAINT bulk_ad_items_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'uploading_media'::text, 'creating_creative'::text, 'creating_campaign'::text, 'creating_adsets'::text, 'creating_ad'::text, 'success'::text, 'error'::text, 'skipped'::text])))
);


ALTER TABLE public.bulk_ad_items OWNER TO postgres;

--
-- Name: chat_conversations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.chat_conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    title text,
    pack_ids uuid[] NOT NULL,
    action_type text,
    focus_date_start date NOT NULL,
    focus_date_stop date NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    cancel_requested_at timestamp with time zone,
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_conversations_status_check CHECK ((status = ANY (ARRAY['active'::text, 'pack_unavailable'::text])))
);


ALTER TABLE public.chat_conversations OWNER TO postgres;

--
-- Name: chat_messages; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.chat_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text NOT NULL,
    content text,
    status text DEFAULT 'complete'::text NOT NULL,
    failure_reason text,
    progress jsonb DEFAULT '[]'::jsonb NOT NULL,
    tool_calls jsonb DEFAULT '[]'::jsonb NOT NULL,
    usage jsonb,
    action_type text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    CONSTRAINT chat_messages_role_check CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text, 'system'::text]))),
    CONSTRAINT chat_messages_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'complete'::text, 'partial'::text, 'failed'::text, 'cancelled'::text])))
);


ALTER TABLE public.chat_messages OWNER TO postgres;

--
-- Name: chat_user_leases; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.chat_user_leases (
    user_id uuid NOT NULL,
    busy_until timestamp with time zone NOT NULL,
    message_id uuid
);


ALTER TABLE public.chat_user_leases OWNER TO postgres;

--
-- Name: conversion_keys_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.conversion_keys ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.conversion_keys_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: facebook_connections; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.facebook_connections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    facebook_user_id text NOT NULL,
    facebook_name text,
    facebook_email text,
    access_token text NOT NULL,
    refresh_token text,
    expires_at timestamp with time zone,
    scopes text[],
    is_primary boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    facebook_picture_url text,
    status text DEFAULT 'active'::text,
    picture_storage_path text,
    picture_cached_at timestamp with time zone,
    picture_source_url text,
    CONSTRAINT facebook_connections_status_check CHECK ((status = ANY (ARRAY['active'::text, 'expired'::text, 'invalid'::text, 'degraded'::text])))
);


ALTER TABLE public.facebook_connections OWNER TO postgres;

--
-- Name: COLUMN facebook_connections.facebook_picture_url; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.facebook_connections.facebook_picture_url IS 'URL da imagem de perfil do Facebook';


--
-- Name: COLUMN facebook_connections.picture_storage_path; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.facebook_connections.picture_storage_path IS 'Path do objeto no Supabase Storage (bucket ad-thumbs, profile-pics/).';


--
-- Name: COLUMN facebook_connections.picture_cached_at; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.facebook_connections.picture_cached_at IS 'Quando a foto de perfil foi cacheada no Storage.';


--
-- Name: COLUMN facebook_connections.picture_source_url; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.facebook_connections.picture_source_url IS 'URL original do Meta usada para baixar/cachear a foto.';


--
-- Name: folders; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.folders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    parent_id uuid,
    "position" integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT folders_name_max_len CHECK ((char_length(name) <= 60)),
    CONSTRAINT folders_name_not_blank CHECK ((btrim(name) <> ''::text)),
    CONSTRAINT folders_no_self_parent CHECK (((parent_id IS NULL) OR (parent_id <> id)))
);


ALTER TABLE public.folders OWNER TO postgres;

--
-- Name: TABLE folders; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.folders IS 'Pasta da Biblioteca de packs. E de QUEM ORGANIZA (user_id = ator), nao do pack: um convidado arquiva pack compartilhado na pasta dele sem tocar no pack do dono. Nao e sujeito de permissao — nao existe folder_shares.';


--
-- Name: COLUMN folders.parent_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.folders.parent_id IS 'Pasta de cima (NULL = raiz). Ciclo e pai de outro usuario barrados por trg_folders_check_parent (migration 174).';


--
-- Name: google_accounts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.google_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    access_token text NOT NULL,
    refresh_token text,
    expires_at timestamp with time zone,
    scopes text[],
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    google_user_id text,
    google_email text,
    google_name text,
    is_primary boolean DEFAULT true
);


ALTER TABLE public.google_accounts OWNER TO postgres;

--
-- Name: jobs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.jobs (
    id text NOT NULL,
    user_id uuid NOT NULL,
    status text NOT NULL,
    progress integer DEFAULT 0,
    message text,
    payload jsonb,
    result_count integer,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    processing_owner text,
    processing_claimed_at timestamp with time zone,
    processing_lease_until timestamp with time zone,
    processing_attempts integer DEFAULT 0 NOT NULL,
    CONSTRAINT jobs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'completed'::text, 'failed'::text, 'error'::text, 'meta_running'::text, 'meta_completed'::text, 'processing'::text, 'persisting'::text, 'cancelled'::text])))
);


ALTER TABLE public.jobs OWNER TO postgres;

--
-- Name: meta_api_usage; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.meta_api_usage (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id uuid,
    route text,
    service_name text,
    ad_account_id text,
    meta_endpoint text,
    http_method text,
    http_status integer,
    response_ms integer,
    call_count_pct numeric,
    cputime_pct numeric,
    total_time_pct numeric,
    business_use_case_usage jsonb,
    ad_account_usage jsonb,
    page_route text,
    regain_access_minutes integer
);


ALTER TABLE public.meta_api_usage OWNER TO postgres;

--
-- Name: TABLE meta_api_usage; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.meta_api_usage IS 'One row per outgoing Meta Graph API call. Populated by services/meta_usage_logger.py.';


--
-- Name: pack_action_log; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.pack_action_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    pack_ids uuid[] NOT NULL,
    pack_name text,
    owner_id uuid NOT NULL,
    actor_id uuid NOT NULL,
    actor_role text NOT NULL,
    action text NOT NULL,
    target_type text,
    target_ids text[] DEFAULT '{}'::text[] NOT NULL,
    target_count integer DEFAULT 0 NOT NULL,
    detail jsonb,
    status text DEFAULT 'ok'::text NOT NULL,
    error text,
    route text,
    CONSTRAINT pack_action_log_packs_chk CHECK ((array_length(pack_ids, 1) >= 1)),
    CONSTRAINT pack_action_log_role_chk CHECK ((actor_role = ANY (ARRAY['dono'::text, 'editor'::text, 'viewer'::text]))),
    CONSTRAINT pack_action_log_status_chk CHECK ((status = ANY (ARRAY['ok'::text, 'error'::text, 'partial'::text])))
);


ALTER TABLE public.pack_action_log OWNER TO postgres;

--
-- Name: TABLE pack_action_log; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.pack_action_log IS 'P3.5 — quem fez o que num pack. Unico rastro de autoria em pack compartilhado: na Meta a acao do convidado aparece como sendo do dono. Retencao 365 dias.';


--
-- Name: pack_folder_members; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.pack_folder_members (
    user_id uuid NOT NULL,
    pack_id uuid NOT NULL,
    folder_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.pack_folder_members OWNER TO postgres;

--
-- Name: TABLE pack_folder_members; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.pack_folder_members IS 'Vinculo pack->pasta, por usuario. A PK (user_id, pack_id) e onde mora a EXCLUSIVIDADE: um pack tem uma pasta so, por pessoa. Mover = upsert nessa chave.';


--
-- Name: pack_shares; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.pack_shares (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    pack_id uuid NOT NULL,
    owner_id uuid NOT NULL,
    grantee_id uuid NOT NULL,
    role text DEFAULT 'editor'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pack_shares_not_self CHECK ((owner_id <> grantee_id)),
    CONSTRAINT pack_shares_role_check CHECK ((role = ANY (ARRAY['editor'::text, 'viewer'::text])))
);


ALTER TABLE public.pack_shares OWNER TO postgres;

--
-- Name: TABLE pack_shares; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.pack_shares IS 'Acessos concedidos a packs. O dono NAO aparece aqui (vem de packs.user_id); esta tabela guarda so os convidados. ON DELETE CASCADE em pack_id implementa "dono apaga o pack -> some para todos".';


--
-- Name: COLUMN pack_shares.owner_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.pack_shares.owner_id IS 'Denormalizado de packs.user_id, preenchido pelo servidor. Nunca aceitar do cliente.';


--
-- Name: COLUMN pack_shares.role; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.pack_shares.role IS 'editor = le e escreve (refresh, pausar, budget). viewer = somente leitura. O papel "dono" nao e representado aqui.';


--
-- Name: parent_entities; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.parent_entities (
    user_id uuid NOT NULL,
    entity_id text NOT NULL,
    level text NOT NULL,
    account_id text,
    campaign_id text,
    daily_budget bigint,
    lifetime_budget bigint,
    budget_mode text,
    effective_status text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    ads_count integer,
    CONSTRAINT parent_entities_budget_mode_check CHECK ((budget_mode = ANY (ARRAY['cbo'::text, 'abo'::text, 'abo_shared'::text]))),
    CONSTRAINT parent_entities_level_check CHECK ((level = ANY (ARRAY['campaign'::text, 'adset'::text])))
);


ALTER TABLE public.parent_entities OWNER TO postgres;

--
-- Name: TABLE parent_entities; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.parent_entities IS 'Snapshot de orçamento de campanhas/adsets lido dos edges da Meta (enrich do refresh + sync on-focus). Valores em SUBUNIDADE da moeda da conta (ver ad_accounts.currency). daily/lifetime NULL = entidade sem budget nesse nível (ex.: campanha ABO).';


--
-- Name: COLUMN parent_entities.level; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.parent_entities.level IS 'campaign | adset (nível da entidade entity_id)';


--
-- Name: COLUMN parent_entities.campaign_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.parent_entities.campaign_id IS 'Para level=adset: campanha pai (o budget_mode dela diz se o budget vive no adset). NULL para campanhas.';


--
-- Name: COLUMN parent_entities.budget_mode; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.parent_entities.budget_mode IS 'Só level=campaign: cbo (Advantage Campaign Budget — budget na campanha) | abo (budget nos adsets) | abo_shared (ABO com is_adset_budget_sharing_enabled — Meta move até 20% entre adsets).';


--
-- Name: COLUMN parent_entities.effective_status; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.parent_entities.effective_status IS 'effective_status oficial do pai (campanha/conjunto). FONTE DO READ-PATH desde a migration 122. Escrito pelos syncs de conta inteira (enrich/on-focus) E pelo toggle (double-write fechado em 2026-08-25).';


--
-- Name: COLUMN parent_entities.ads_count; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.parent_entities.ads_count IS 'Total de anúncios do conjunto conforme o inventário do edge /ads (inclui pausados; exclui archived/deleted, igual ao Gerenciador). Snapshot escrito no refresh. NULL = ainda não sincronizado -> o read-path cai no ad_count derivado de ad_metrics.';


--
-- Name: sheet_column_mappings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.sheet_column_mappings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    integration_id uuid NOT NULL,
    owner_id uuid NOT NULL,
    column_index integer NOT NULL,
    column_name text DEFAULT ''::text NOT NULL,
    label text NOT NULL,
    kind text NOT NULL,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sheet_column_mappings_column_index_check CHECK ((column_index >= 0)),
    CONSTRAINT sheet_column_mappings_kind_check CHECK ((kind = ANY (ARRAY['leadscore'::text, 'number'::text, 'category'::text]))),
    CONSTRAINT sheet_column_mappings_label_check CHECK (((length(btrim(label)) >= 1) AND (length(btrim(label)) <= 60)))
);


ALTER TABLE public.sheet_column_mappings OWNER TO postgres;

--
-- Name: TABLE sheet_column_mappings; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.sheet_column_mappings IS 'Colunas da planilha vinculadas além do leadscore (migration 140). O id é a chave estável da coluna no app (custom:<id>:<faceta>); renomear o cabeçalho na planilha não quebra regra, preferência nem Board. kind é decisão de mão única (leadscore = número com corte de MQL em config.mql_min; number = média/mín/máx/mediana; category = distribuição, até 20 valores distintos).';


--
-- Name: COLUMN sheet_column_mappings.column_index; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.sheet_column_mappings.column_index IS 'Posição da coluna na planilha (0-based), como ad_sheet_integrations.*_column_index.';


--
-- Name: COLUMN sheet_column_mappings.config; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.sheet_column_mappings.config IS 'leadscore: {"mql_min": numeric}. Demais: {}.';


--
-- Name: stripe_events; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.stripe_events (
    event_id text NOT NULL,
    type text NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'processed'::text NOT NULL,
    processed_at timestamp with time zone,
    CONSTRAINT stripe_events_status_check CHECK ((status = ANY (ARRAY['processing'::text, 'processed'::text])))
);


ALTER TABLE public.stripe_events OWNER TO postgres;

--
-- Name: subscriptions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    tier text DEFAULT 'standard'::text NOT NULL,
    source text DEFAULT 'manual'::text,
    plan_id text,
    granted_by uuid,
    starts_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    stripe_customer_id text,
    stripe_subscription_id text,
    stripe_status text,
    cancel_at_period_end boolean DEFAULT false NOT NULL,
    CONSTRAINT subscriptions_source_check CHECK ((source = ANY (ARRAY['manual'::text, 'stripe'::text, 'promo'::text]))),
    CONSTRAINT subscriptions_tier_check CHECK ((tier = ANY (ARRAY['standard'::text, 'insider'::text, 'admin'::text])))
);


ALTER TABLE public.subscriptions OWNER TO postgres;

--
-- Name: tags; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.tags (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    slug text GENERATED ALWAYS AS (translate(lower(btrim(regexp_replace(name, '\s+'::text, ' '::text, 'g'::text))), 'áàâãäéèêëíìîïóòôõöúùûüçñ'::text, 'aaaaaeeeeiiiiooooouuuucn'::text)) STORED,
    color text DEFAULT 'chart1'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tags_name_max_len CHECK ((char_length(name) <= 40)),
    CONSTRAINT tags_name_not_blank CHECK ((btrim(name) <> ''::text))
);


ALTER TABLE public.tags OWNER TO postgres;

--
-- Name: TABLE tags; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.tags IS 'Vocabulario de tags do usuario (plano, sem namespace). slug e gerado e unico por usuario.';


--
-- Name: COLUMN tags.color; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.tags.color IS 'Token da paleta de tags (chart1..chart5). Validado no backend (TAG_COLORS) e mapeado em frontend/lib/tags/colors.ts.';


--
-- Name: user_preferences; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.user_preferences (
    user_id uuid NOT NULL,
    locale text,
    timezone text,
    currency text,
    theme text,
    default_adaccount_id text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    validation_criteria jsonb DEFAULT '[]'::jsonb,
    mql_leadscore_min numeric DEFAULT 0,
    has_completed_onboarding boolean DEFAULT false,
    niche text,
    target_cpr jsonb DEFAULT '{}'::jsonb,
    diagnostic_cost_metric text DEFAULT 'cpr'::text
);


ALTER TABLE public.user_preferences OWNER TO postgres;

--
-- Name: COLUMN user_preferences.mql_leadscore_min; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.user_preferences.mql_leadscore_min IS 'Leadscore mínimo para considerar um lead como MQL (Marketing Qualified Lead). Valores >= este número são considerados MQLs. Usado para calcular quantidade de MQLs e custo por MQL.';


--
-- Name: COLUMN user_preferences.niche; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.user_preferences.niche IS 'Nicho de negócio do usuário (texto livre)';


--
-- Name: COLUMN user_preferences.target_cpr; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.user_preferences.target_cpr IS 'CPR alvo por action_type (ex: {"purchase": 15.00, "lead": 8.50}). Usado pelo Plano de Ação para vereditos absolutos. Quando ausente, o plano usa modo relativo (vs. média do pack).';


--
-- Name: COLUMN user_preferences.diagnostic_cost_metric; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.user_preferences.diagnostic_cost_metric IS 'Métrica de custo escolhida no bloco de comparação do /plano: ''cpr'' ou ''cpmql''. Default ''cpr''. CPMQL exige dado de MQL; senão o app cai para CPR.';


--
-- Name: ad_accounts ad_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ad_accounts
    ADD CONSTRAINT ad_accounts_pkey PRIMARY KEY (id, user_id);


--
-- Name: ad_metric_pack_map ad_metric_pack_map_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ad_metric_pack_map
    ADD CONSTRAINT ad_metric_pack_map_pkey PRIMARY KEY (user_id, pack_id, ad_id, metric_date);


--
-- Name: ad_metrics ad_metrics_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ad_metrics
    ADD CONSTRAINT ad_metrics_pkey PRIMARY KEY (user_id, pack_id, ad_id, date);


--
-- Name: ad_pack_inventory ad_pack_inventory_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ad_pack_inventory
    ADD CONSTRAINT ad_pack_inventory_pkey PRIMARY KEY (user_id, pack_id, ad_id);


--
-- Name: ad_performance_daily ad_performance_daily_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ad_performance_daily
    ADD CONSTRAINT ad_performance_daily_pkey PRIMARY KEY (user_id, pack_id, ad_id, date);


--
-- Name: ad_shares ad_shares_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ad_shares
    ADD CONSTRAINT ad_shares_pkey PRIMARY KEY (id);


--
-- Name: ad_sheet_integrations ad_sheet_integrations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ad_sheet_integrations
    ADD CONSTRAINT ad_sheet_integrations_pkey PRIMARY KEY (id);


--
-- Name: ad_tags ad_tags_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ad_tags
    ADD CONSTRAINT ad_tags_pkey PRIMARY KEY (user_id, tag_id, ad_name);


--
-- Name: ad_transcriptions ad_transcriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ad_transcriptions
    ADD CONSTRAINT ad_transcriptions_pkey PRIMARY KEY (id);


--
-- Name: ad_transcriptions ad_transcriptions_user_id_ad_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ad_transcriptions
    ADD CONSTRAINT ad_transcriptions_user_id_ad_name_key UNIQUE (user_id, ad_name);


--
-- Name: ads ads_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ads
    ADD CONSTRAINT ads_pkey PRIMARY KEY (ad_id, user_id);


--
-- Name: board_groups board_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.board_groups
    ADD CONSTRAINT board_groups_pkey PRIMARY KEY (id);


--
-- Name: boards boards_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.boards
    ADD CONSTRAINT boards_pkey PRIMARY KEY (id);


--
-- Name: bulk_ad_items bulk_ad_items_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bulk_ad_items
    ADD CONSTRAINT bulk_ad_items_pkey PRIMARY KEY (id);


--
-- Name: chat_conversations chat_conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chat_conversations
    ADD CONSTRAINT chat_conversations_pkey PRIMARY KEY (id);


--
-- Name: chat_messages chat_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_pkey PRIMARY KEY (id);


--
-- Name: chat_user_leases chat_user_leases_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chat_user_leases
    ADD CONSTRAINT chat_user_leases_pkey PRIMARY KEY (user_id);


--
-- Name: conversion_keys conversion_keys_key_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.conversion_keys
    ADD CONSTRAINT conversion_keys_key_key UNIQUE (key);


--
-- Name: conversion_keys conversion_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.conversion_keys
    ADD CONSTRAINT conversion_keys_pkey PRIMARY KEY (id);


--
-- Name: facebook_connections facebook_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.facebook_connections
    ADD CONSTRAINT facebook_connections_pkey PRIMARY KEY (id);


--
-- Name: facebook_connections facebook_connections_user_fb_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.facebook_connections
    ADD CONSTRAINT facebook_connections_user_fb_unique UNIQUE (user_id, facebook_user_id);


--
-- Name: folders folders_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.folders
    ADD CONSTRAINT folders_pkey PRIMARY KEY (id);


--
-- Name: google_accounts google_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.google_accounts
    ADD CONSTRAINT google_accounts_pkey PRIMARY KEY (id);


--
-- Name: jobs jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT jobs_pkey PRIMARY KEY (id);


--
-- Name: meta_api_usage meta_api_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.meta_api_usage
    ADD CONSTRAINT meta_api_usage_pkey PRIMARY KEY (id);


--
-- Name: pack_action_log pack_action_log_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pack_action_log
    ADD CONSTRAINT pack_action_log_pkey PRIMARY KEY (id);


--
-- Name: pack_folder_members pack_folder_members_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pack_folder_members
    ADD CONSTRAINT pack_folder_members_pkey PRIMARY KEY (user_id, pack_id);


--
-- Name: pack_shares pack_shares_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pack_shares
    ADD CONSTRAINT pack_shares_pkey PRIMARY KEY (id);


--
-- Name: pack_shares pack_shares_unique_grant; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pack_shares
    ADD CONSTRAINT pack_shares_unique_grant UNIQUE (pack_id, grantee_id);


--
-- Name: packs packs_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.packs
    ADD CONSTRAINT packs_id_user_id_key UNIQUE (id, user_id);


--
-- Name: packs packs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.packs
    ADD CONSTRAINT packs_pkey PRIMARY KEY (id);


--
-- Name: parent_entities parent_entities_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.parent_entities
    ADD CONSTRAINT parent_entities_pkey PRIMARY KEY (user_id, entity_id);


--
-- Name: sheet_column_mappings sheet_column_mappings_integration_id_column_index_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sheet_column_mappings
    ADD CONSTRAINT sheet_column_mappings_integration_id_column_index_key UNIQUE (integration_id, column_index);


--
-- Name: sheet_column_mappings sheet_column_mappings_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sheet_column_mappings
    ADD CONSTRAINT sheet_column_mappings_pkey PRIMARY KEY (id);


--
-- Name: stripe_events stripe_events_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stripe_events
    ADD CONSTRAINT stripe_events_pkey PRIMARY KEY (event_id);


--
-- Name: subscriptions subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);


--
-- Name: subscriptions subscriptions_user_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_user_id_key UNIQUE (user_id);


--
-- Name: tags tags_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tags
    ADD CONSTRAINT tags_pkey PRIMARY KEY (id);


--
-- Name: user_preferences user_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_preferences
    ADD CONSTRAINT user_preferences_pkey PRIMARY KEY (user_id);


--
-- Name: ad_accounts_connection_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ad_accounts_connection_id_idx ON public.ad_accounts USING btree (connection_id);


--
-- Name: ad_accounts_user_connection_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ad_accounts_user_connection_idx ON public.ad_accounts USING btree (user_id, connection_id);


--
-- Name: ad_accounts_user_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ad_accounts_user_idx ON public.ad_accounts USING btree (user_id);


--
-- Name: ad_metric_pack_map_user_ad_date_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ad_metric_pack_map_user_ad_date_idx ON public.ad_metric_pack_map USING btree (user_id, ad_id, metric_date);


--
-- Name: ad_metric_pack_map_user_pack_date_ad_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ad_metric_pack_map_user_pack_date_ad_idx ON public.ad_metric_pack_map USING btree (user_id, pack_id, metric_date, ad_id);


--
-- Name: ad_metrics_ad_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ad_metrics_ad_id_idx ON public.ad_metrics USING btree (ad_id);


--
-- Name: ad_metrics_id_user_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ad_metrics_id_user_idx ON public.ad_metrics USING btree (id, user_id);


--
-- Name: ad_metrics_user_pack_date_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ad_metrics_user_pack_date_idx ON public.ad_metrics USING btree (user_id, pack_id, date);


--
-- Name: ad_pack_inventory_user_ad_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ad_pack_inventory_user_ad_idx ON public.ad_pack_inventory USING btree (user_id, ad_id);


--
-- Name: ad_pack_inventory_user_ad_name_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ad_pack_inventory_user_ad_name_idx ON public.ad_pack_inventory USING btree (user_id, ad_name);


--
-- Name: ad_pack_inventory_user_adset_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ad_pack_inventory_user_adset_idx ON public.ad_pack_inventory USING btree (user_id, adset_id);


--
-- Name: ad_shares_token_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX ad_shares_token_key ON public.ad_shares USING btree (token);


--
-- Name: ad_shares_user_created_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ad_shares_user_created_idx ON public.ad_shares USING btree (user_id, created_at DESC);


--
-- Name: ad_sheet_integrations_connection_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ad_sheet_integrations_connection_id_idx ON public.ad_sheet_integrations USING btree (connection_id);


--
-- Name: ad_sheet_integrations_owner_global_unique; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX ad_sheet_integrations_owner_global_unique ON public.ad_sheet_integrations USING btree (owner_id) WHERE (pack_id IS NULL);


--
-- Name: ad_sheet_integrations_owner_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ad_sheet_integrations_owner_idx ON public.ad_sheet_integrations USING btree (owner_id);


--
-- Name: ad_sheet_integrations_owner_pack_unique; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX ad_sheet_integrations_owner_pack_unique ON public.ad_sheet_integrations USING btree (owner_id, pack_id);


--
-- Name: ad_sheet_integrations_pack_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ad_sheet_integrations_pack_id_idx ON public.ad_sheet_integrations USING btree (pack_id);


--
-- Name: ad_tags_tag_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ad_tags_tag_id_idx ON public.ad_tags USING btree (tag_id);


--
-- Name: ad_tags_user_name_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ad_tags_user_name_idx ON public.ad_tags USING btree (user_id, ad_name);


--
-- Name: ad_transcriptions_user_status_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ad_transcriptions_user_status_idx ON public.ad_transcriptions USING btree (user_id, status);


--
-- Name: ads_account_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ads_account_idx ON public.ads USING btree (account_id);


--
-- Name: ads_ad_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ads_ad_id_idx ON public.ads USING btree (ad_id);


--
-- Name: ads_ad_name_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ads_ad_name_idx ON public.ads USING btree (ad_name);


--
-- Name: ads_campaign_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ads_campaign_idx ON public.ads USING btree (campaign_id);


--
-- Name: ads_pack_ids_gin; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ads_pack_ids_gin ON public.ads USING gin (pack_ids);


--
-- Name: ads_primary_video_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ads_primary_video_id_idx ON public.ads USING btree (primary_video_id) WHERE (primary_video_id IS NOT NULL);


--
-- Name: ads_thumb_cached_at_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ads_thumb_cached_at_idx ON public.ads USING btree (thumb_cached_at) WHERE (thumb_cached_at IS NOT NULL);


--
-- Name: ads_transcription_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ads_transcription_id_idx ON public.ads USING btree (transcription_id) WHERE (transcription_id IS NOT NULL);


--
-- Name: ads_user_ad_name_media_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ads_user_ad_name_media_idx ON public.ads USING btree (user_id, ad_name) INCLUDE (media_type);


--
-- Name: INDEX ads_user_ad_name_media_idx; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON INDEX public.ads_user_ad_name_media_idx IS 'Tipo de mídia por (usuário, nome do criativo) sem tocar a heap (migration 132): media_type do grupo = maior precedência entre as cópias.';


--
-- Name: ads_user_ad_status_mt_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ads_user_ad_status_mt_idx ON public.ads USING btree (user_id, ad_id) INCLUDE (effective_status, meta_created_time, thumb_storage_path, media_type);


--
-- Name: INDEX ads_user_ad_status_mt_idx; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON INDEX public.ads_user_ad_status_mt_idx IS 'Cobre o lookup por anúncio da RPC do Manager (passo 4): status, criação, miniatura e
tipo de mídia sem tocar na tabela. media_type entrou na 170 — sem ele a leitura deixa de
ser index-only e vira varredura.';


--
-- Name: ads_user_adset_campaign_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ads_user_adset_campaign_idx ON public.ads USING btree (user_id, adset_id) INCLUDE (campaign_id);


--
-- Name: ads_user_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ads_user_idx ON public.ads USING btree (user_id);


--
-- Name: ads_video_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ads_video_idx ON public.ads USING btree (creative_video_id);


--
-- Name: ads_videos_ids_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ads_videos_ids_idx ON public.ads USING gin (adcreatives_videos_ids) WHERE (adcreatives_videos_ids IS NOT NULL);


--
-- Name: board_groups_board_position_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX board_groups_board_position_idx ON public.board_groups USING btree (board_id, "position", created_at);


--
-- Name: boards_user_position_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX boards_user_position_idx ON public.boards USING btree (user_id, "position", created_at);


--
-- Name: bulk_ad_items_bundle_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX bulk_ad_items_bundle_idx ON public.bulk_ad_items USING btree (job_id, bundle_id);


--
-- Name: bulk_ad_items_job_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX bulk_ad_items_job_idx ON public.bulk_ad_items USING btree (job_id);


--
-- Name: chat_conversations_user_updated_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX chat_conversations_user_updated_idx ON public.chat_conversations USING btree (user_id, updated_at DESC);


--
-- Name: chat_messages_conversation_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX chat_messages_conversation_idx ON public.chat_messages USING btree (conversation_id, created_at);


--
-- Name: chat_messages_user_created_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX chat_messages_user_created_idx ON public.chat_messages USING btree (user_id, created_at DESC);


--
-- Name: facebook_connections_fbuser_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX facebook_connections_fbuser_idx ON public.facebook_connections USING btree (facebook_user_id);


--
-- Name: facebook_connections_status_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX facebook_connections_status_idx ON public.facebook_connections USING btree (user_id, status) WHERE (status <> 'active'::text);


--
-- Name: facebook_connections_user_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX facebook_connections_user_idx ON public.facebook_connections USING btree (user_id);


--
-- Name: folders_parent_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX folders_parent_idx ON public.folders USING btree (parent_id) WHERE (parent_id IS NOT NULL);


--
-- Name: folders_user_position_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX folders_user_position_idx ON public.folders USING btree (user_id, "position", name);


--
-- Name: google_accounts_googleuser_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX google_accounts_googleuser_idx ON public.google_accounts USING btree (google_user_id);


--
-- Name: google_accounts_user_google_unique_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX google_accounts_user_google_unique_idx ON public.google_accounts USING btree (user_id, google_user_id) WHERE (google_user_id IS NOT NULL);


--
-- Name: google_accounts_user_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX google_accounts_user_idx ON public.google_accounts USING btree (user_id);


--
-- Name: jobs_processing_lease_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX jobs_processing_lease_idx ON public.jobs USING btree (user_id, status, processing_lease_until);


--
-- Name: jobs_user_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX jobs_user_idx ON public.jobs USING btree (user_id);


--
-- Name: meta_api_usage_created_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX meta_api_usage_created_idx ON public.meta_api_usage USING btree (created_at DESC);


--
-- Name: meta_api_usage_route_created_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX meta_api_usage_route_created_idx ON public.meta_api_usage USING btree (user_id, route, created_at DESC);


--
-- Name: meta_api_usage_user_created_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX meta_api_usage_user_created_idx ON public.meta_api_usage USING btree (user_id, created_at DESC);


--
-- Name: pack_action_log_actor_created_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX pack_action_log_actor_created_idx ON public.pack_action_log USING btree (actor_id, created_at DESC);


--
-- Name: pack_action_log_created_at_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX pack_action_log_created_at_idx ON public.pack_action_log USING btree (created_at DESC);


--
-- Name: pack_action_log_pack_ids_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX pack_action_log_pack_ids_idx ON public.pack_action_log USING gin (pack_ids);


--
-- Name: pack_folder_members_folder_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX pack_folder_members_folder_idx ON public.pack_folder_members USING btree (folder_id, pack_id);


--
-- Name: pack_shares_grantee_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX pack_shares_grantee_idx ON public.pack_shares USING btree (grantee_id);


--
-- Name: pack_shares_owner_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX pack_shares_owner_idx ON public.pack_shares USING btree (owner_id);


--
-- Name: pack_shares_pack_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX pack_shares_pack_idx ON public.pack_shares USING btree (pack_id);


--
-- Name: packs_refresh_status_date_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX packs_refresh_status_date_idx ON public.packs USING btree (refresh_status, last_refreshed_at);


--
-- Name: packs_sheet_integration_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX packs_sheet_integration_id_idx ON public.packs USING btree (sheet_integration_id);


--
-- Name: packs_user_created_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX packs_user_created_idx ON public.packs USING btree (user_id, created_at DESC);


--
-- Name: packs_user_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX packs_user_idx ON public.packs USING btree (user_id);


--
-- Name: packs_user_normalized_name_unique_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX packs_user_normalized_name_unique_idx ON public.packs USING btree (user_id, lower(btrim(name)));


--
-- Name: INDEX packs_user_normalized_name_unique_idx; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON INDEX public.packs_user_normalized_name_unique_idx IS 'Garante unicidade de nome de pack por usuário usando trim + lower.';


--
-- Name: sheet_column_mappings_owner_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX sheet_column_mappings_owner_idx ON public.sheet_column_mappings USING btree (owner_id);


--
-- Name: subscriptions_granted_by_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX subscriptions_granted_by_idx ON public.subscriptions USING btree (granted_by);


--
-- Name: subscriptions_stripe_customer_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX subscriptions_stripe_customer_id_idx ON public.subscriptions USING btree (stripe_customer_id) WHERE (stripe_customer_id IS NOT NULL);


--
-- Name: subscriptions_stripe_subscription_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX subscriptions_stripe_subscription_id_idx ON public.subscriptions USING btree (stripe_subscription_id) WHERE (stripe_subscription_id IS NOT NULL);


--
-- Name: tags_user_slug_uidx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX tags_user_slug_uidx ON public.tags USING btree (user_id, slug);


--
-- Name: ad_metrics ad_metrics_rollup_sync_ins; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER ad_metrics_rollup_sync_ins AFTER INSERT ON public.ad_metrics REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.ad_performance_rollup_sync_ins();


--
-- Name: ad_metrics ad_metrics_rollup_sync_upd; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER ad_metrics_rollup_sync_upd AFTER UPDATE ON public.ad_metrics REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.ad_performance_rollup_sync_upd();


--
-- Name: chat_conversations chat_conversations_set_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER chat_conversations_set_updated_at BEFORE UPDATE ON public.chat_conversations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: pack_shares set_pack_shares_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER set_pack_shares_updated_at BEFORE UPDATE ON public.pack_shares FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: ads trg_ads_preserve_meta_created_time; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_ads_preserve_meta_created_time BEFORE UPDATE ON public.ads FOR EACH ROW EXECUTE FUNCTION public.preserve_ads_meta_created_time();


--
-- Name: board_groups trg_board_groups_set_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_board_groups_set_updated_at BEFORE UPDATE ON public.board_groups FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: boards trg_boards_set_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_boards_set_updated_at BEFORE UPDATE ON public.boards FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: facebook_connections trg_facebook_connections_set_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_facebook_connections_set_updated_at BEFORE UPDATE ON public.facebook_connections FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: folders trg_folders_check_parent; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_folders_check_parent BEFORE INSERT OR UPDATE OF parent_id ON public.folders FOR EACH ROW EXECUTE FUNCTION public.folders_check_parent();


--
-- Name: folders trg_folders_set_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_folders_set_updated_at BEFORE UPDATE ON public.folders FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: google_accounts trg_google_accounts_set_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_google_accounts_set_updated_at BEFORE UPDATE ON public.google_accounts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: sheet_column_mappings trg_sheet_column_mappings_set_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_sheet_column_mappings_set_updated_at BEFORE UPDATE ON public.sheet_column_mappings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: subscriptions trg_subscriptions_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_subscriptions_updated_at BEFORE UPDATE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION public.set_subscriptions_updated_at();


--
-- Name: ad_accounts ad_accounts_connection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ad_accounts
    ADD CONSTRAINT ad_accounts_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.facebook_connections(id) ON DELETE SET NULL;


--
-- Name: ad_metric_pack_map ad_metric_pack_map_metric_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ad_metric_pack_map
    ADD CONSTRAINT ad_metric_pack_map_metric_fk FOREIGN KEY (user_id, pack_id, ad_id, metric_date) REFERENCES public.ad_metrics(user_id, pack_id, ad_id, date) ON DELETE CASCADE;


--
-- Name: ad_performance_daily ad_performance_daily_metric_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ad_performance_daily
    ADD CONSTRAINT ad_performance_daily_metric_fk FOREIGN KEY (user_id, pack_id, ad_id, date) REFERENCES public.ad_metrics(user_id, pack_id, ad_id, date) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ad_sheet_integrations ad_sheet_integrations_pack_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ad_sheet_integrations
    ADD CONSTRAINT ad_sheet_integrations_pack_id_fkey FOREIGN KEY (pack_id) REFERENCES public.packs(id) ON DELETE CASCADE;


--
-- Name: ad_tags ad_tags_tag_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ad_tags
    ADD CONSTRAINT ad_tags_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES public.tags(id) ON DELETE CASCADE;


--
-- Name: ads ads_transcription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ads
    ADD CONSTRAINT ads_transcription_id_fkey FOREIGN KEY (transcription_id) REFERENCES public.ad_transcriptions(id) ON DELETE SET NULL;


--
-- Name: board_groups board_groups_board_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.board_groups
    ADD CONSTRAINT board_groups_board_id_fkey FOREIGN KEY (board_id) REFERENCES public.boards(id) ON DELETE CASCADE;


--
-- Name: chat_conversations chat_conversations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chat_conversations
    ADD CONSTRAINT chat_conversations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: chat_messages chat_messages_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.chat_conversations(id) ON DELETE CASCADE;


--
-- Name: chat_messages chat_messages_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: chat_user_leases chat_user_leases_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chat_user_leases
    ADD CONSTRAINT chat_user_leases_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: facebook_connections facebook_connections_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.facebook_connections
    ADD CONSTRAINT facebook_connections_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: folders folders_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.folders
    ADD CONSTRAINT folders_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.folders(id) ON DELETE SET NULL;


--
-- Name: google_accounts google_accounts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.google_accounts
    ADD CONSTRAINT google_accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: meta_api_usage meta_api_usage_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.meta_api_usage
    ADD CONSTRAINT meta_api_usage_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: pack_folder_members pack_folder_members_folder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pack_folder_members
    ADD CONSTRAINT pack_folder_members_folder_id_fkey FOREIGN KEY (folder_id) REFERENCES public.folders(id) ON DELETE CASCADE;


--
-- Name: pack_folder_members pack_folder_members_pack_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pack_folder_members
    ADD CONSTRAINT pack_folder_members_pack_id_fkey FOREIGN KEY (pack_id) REFERENCES public.packs(id) ON DELETE CASCADE;


--
-- Name: pack_shares pack_shares_grantee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pack_shares
    ADD CONSTRAINT pack_shares_grantee_id_fkey FOREIGN KEY (grantee_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: pack_shares pack_shares_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pack_shares
    ADD CONSTRAINT pack_shares_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: pack_shares pack_shares_pack_owner_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pack_shares
    ADD CONSTRAINT pack_shares_pack_owner_fkey FOREIGN KEY (pack_id, owner_id) REFERENCES public.packs(id, user_id) ON DELETE CASCADE;


--
-- Name: packs packs_sheet_integration_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.packs
    ADD CONSTRAINT packs_sheet_integration_id_fkey FOREIGN KEY (sheet_integration_id) REFERENCES public.ad_sheet_integrations(id) ON DELETE SET NULL;


--
-- Name: sheet_column_mappings sheet_column_mappings_integration_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sheet_column_mappings
    ADD CONSTRAINT sheet_column_mappings_integration_id_fkey FOREIGN KEY (integration_id) REFERENCES public.ad_sheet_integrations(id) ON DELETE CASCADE;


--
-- Name: subscriptions subscriptions_granted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES auth.users(id);


--
-- Name: subscriptions subscriptions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: bulk_ad_items Users insert own bulk_ad_items; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users insert own bulk_ad_items" ON public.bulk_ad_items FOR INSERT WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: bulk_ad_items Users read own bulk_ad_items; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users read own bulk_ad_items" ON public.bulk_ad_items FOR SELECT USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: bulk_ad_items Users update own bulk_ad_items; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Users update own bulk_ad_items" ON public.bulk_ad_items FOR UPDATE USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: ad_accounts; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.ad_accounts ENABLE ROW LEVEL SECURITY;

--
-- Name: ad_accounts ad_accounts_modify_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY ad_accounts_modify_own ON public.ad_accounts USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: ad_metric_pack_map; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.ad_metric_pack_map ENABLE ROW LEVEL SECURITY;

--
-- Name: ad_metric_pack_map ad_metric_pack_map_modify_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY ad_metric_pack_map_modify_own ON public.ad_metric_pack_map USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: ad_metrics; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.ad_metrics ENABLE ROW LEVEL SECURITY;

--
-- Name: ad_metrics ad_metrics_modify_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY ad_metrics_modify_own ON public.ad_metrics USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: ad_pack_inventory; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.ad_pack_inventory ENABLE ROW LEVEL SECURITY;

--
-- Name: ad_pack_inventory ad_pack_inventory_modify_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY ad_pack_inventory_modify_own ON public.ad_pack_inventory USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: ad_performance_daily; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.ad_performance_daily ENABLE ROW LEVEL SECURITY;

--
-- Name: ad_performance_daily ad_performance_daily_read_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY ad_performance_daily_read_own ON public.ad_performance_daily FOR SELECT USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: ad_shares; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.ad_shares ENABLE ROW LEVEL SECURITY;

--
-- Name: ad_shares ad_shares_modify_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY ad_shares_modify_own ON public.ad_shares USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: ad_sheet_integrations; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.ad_sheet_integrations ENABLE ROW LEVEL SECURITY;

--
-- Name: ad_sheet_integrations ad_sheet_integrations_modify_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY ad_sheet_integrations_modify_own ON public.ad_sheet_integrations USING ((owner_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((owner_id = ( SELECT auth.uid() AS uid)));


--
-- Name: ad_tags; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.ad_tags ENABLE ROW LEVEL SECURITY;

--
-- Name: ad_tags ad_tags_modify_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY ad_tags_modify_own ON public.ad_tags USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: ad_transcriptions; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.ad_transcriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: ad_transcriptions ad_transcriptions_modify_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY ad_transcriptions_modify_own ON public.ad_transcriptions USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: ads; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.ads ENABLE ROW LEVEL SECURITY;

--
-- Name: ads ads_modify_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY ads_modify_own ON public.ads USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: board_groups; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.board_groups ENABLE ROW LEVEL SECURITY;

--
-- Name: board_groups board_groups_modify_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY board_groups_modify_own ON public.board_groups USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: boards; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.boards ENABLE ROW LEVEL SECURITY;

--
-- Name: boards boards_modify_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY boards_modify_own ON public.boards USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: bulk_ad_items; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.bulk_ad_items ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_conversations; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.chat_conversations ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_conversations chat_conversations_select_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY chat_conversations_select_own ON public.chat_conversations FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: chat_messages; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_messages chat_messages_select_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY chat_messages_select_own ON public.chat_messages FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: chat_user_leases; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.chat_user_leases ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_user_leases chat_user_leases_select_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY chat_user_leases_select_own ON public.chat_user_leases FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: conversion_keys; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.conversion_keys ENABLE ROW LEVEL SECURITY;

--
-- Name: conversion_keys conversion_keys_read_all; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY conversion_keys_read_all ON public.conversion_keys FOR SELECT USING (true);


--
-- Name: facebook_connections; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.facebook_connections ENABLE ROW LEVEL SECURITY;

--
-- Name: facebook_connections facebook_connections_modify_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY facebook_connections_modify_own ON public.facebook_connections USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: folders; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.folders ENABLE ROW LEVEL SECURITY;

--
-- Name: folders folders_modify_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY folders_modify_own ON public.folders USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: google_accounts; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.google_accounts ENABLE ROW LEVEL SECURITY;

--
-- Name: google_accounts google_accounts_modify_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY google_accounts_modify_own ON public.google_accounts USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: jobs; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: jobs jobs_modify_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY jobs_modify_own ON public.jobs USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: meta_api_usage; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.meta_api_usage ENABLE ROW LEVEL SECURITY;

--
-- Name: meta_api_usage meta_usage_read_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY meta_usage_read_own ON public.meta_api_usage FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: pack_action_log; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.pack_action_log ENABLE ROW LEVEL SECURITY;

--
-- Name: pack_folder_members; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.pack_folder_members ENABLE ROW LEVEL SECURITY;

--
-- Name: pack_folder_members pack_folder_members_modify_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY pack_folder_members_modify_own ON public.pack_folder_members USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: pack_shares; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.pack_shares ENABLE ROW LEVEL SECURITY;

--
-- Name: pack_shares pack_shares_grantee_leave; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY pack_shares_grantee_leave ON public.pack_shares FOR DELETE USING ((grantee_id = ( SELECT auth.uid() AS uid)));


--
-- Name: pack_shares pack_shares_grantee_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY pack_shares_grantee_select ON public.pack_shares FOR SELECT USING ((grantee_id = ( SELECT auth.uid() AS uid)));


--
-- Name: pack_shares pack_shares_owner_all; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY pack_shares_owner_all ON public.pack_shares USING ((owner_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((owner_id = ( SELECT auth.uid() AS uid)));


--
-- Name: packs; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.packs ENABLE ROW LEVEL SECURITY;

--
-- Name: packs packs_modify_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY packs_modify_own ON public.packs USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: parent_entities; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.parent_entities ENABLE ROW LEVEL SECURITY;

--
-- Name: parent_entities parent_entities_modify_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY parent_entities_modify_own ON public.parent_entities USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: sheet_column_mappings; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.sheet_column_mappings ENABLE ROW LEVEL SECURITY;

--
-- Name: sheet_column_mappings sheet_column_mappings_modify_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY sheet_column_mappings_modify_own ON public.sheet_column_mappings USING ((owner_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((owner_id = ( SELECT auth.uid() AS uid)));


--
-- Name: stripe_events; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.stripe_events ENABLE ROW LEVEL SECURITY;

--
-- Name: subscriptions; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: subscriptions subscriptions_select_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY subscriptions_select_own ON public.subscriptions FOR SELECT USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: tags; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;

--
-- Name: tags tags_modify_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tags_modify_own ON public.tags USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: user_preferences; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

--
-- Name: user_preferences user_preferences_modify_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY user_preferences_modify_own ON public.user_preferences USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: pg_database_owner
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION ad_metrics_enrichment_targets(p_user_id uuid, p_pack_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.ad_metrics_enrichment_targets(p_user_id uuid, p_pack_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.ad_metrics_enrichment_targets(p_user_id uuid, p_pack_id uuid) TO anon;
GRANT ALL ON FUNCTION public.ad_metrics_enrichment_targets(p_user_id uuid, p_pack_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.ad_metrics_enrichment_targets(p_user_id uuid, p_pack_id uuid) TO service_role;


--
-- Name: TABLE ad_metrics; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.ad_metrics TO anon;
GRANT ALL ON TABLE public.ad_metrics TO authenticated;
GRANT ALL ON TABLE public.ad_metrics TO service_role;


--
-- Name: FUNCTION ad_metrics_is_synthetic_zero(m public.ad_metrics); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.ad_metrics_is_synthetic_zero(m public.ad_metrics) FROM PUBLIC;
GRANT ALL ON FUNCTION public.ad_metrics_is_synthetic_zero(m public.ad_metrics) TO service_role;


--
-- Name: FUNCTION ad_pack_inventory_backfill(p_user_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.ad_pack_inventory_backfill(p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.ad_pack_inventory_backfill(p_user_id uuid) TO service_role;


--
-- Name: FUNCTION ad_performance_curve_point(p_curve jsonb, p_idx integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.ad_performance_curve_point(p_curve jsonb, p_idx integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.ad_performance_curve_point(p_curve jsonb, p_idx integer) TO anon;
GRANT ALL ON FUNCTION public.ad_performance_curve_point(p_curve jsonb, p_idx integer) TO authenticated;
GRANT ALL ON FUNCTION public.ad_performance_curve_point(p_curve jsonb, p_idx integer) TO service_role;


--
-- Name: FUNCTION ad_performance_derive_conversions(p_actions jsonb, p_conversions jsonb); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.ad_performance_derive_conversions(p_actions jsonb, p_conversions jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.ad_performance_derive_conversions(p_actions jsonb, p_conversions jsonb) TO anon;
GRANT ALL ON FUNCTION public.ad_performance_derive_conversions(p_actions jsonb, p_conversions jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.ad_performance_derive_conversions(p_actions jsonb, p_conversions jsonb) TO service_role;


--
-- Name: FUNCTION ad_performance_derive_leads(p_values numeric[]); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.ad_performance_derive_leads(p_values numeric[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.ad_performance_derive_leads(p_values numeric[]) TO anon;
GRANT ALL ON FUNCTION public.ad_performance_derive_leads(p_values numeric[]) TO authenticated;
GRANT ALL ON FUNCTION public.ad_performance_derive_leads(p_values numeric[]) TO service_role;


--
-- Name: FUNCTION ad_performance_derive_row(am public.ad_metrics); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.ad_performance_derive_row(am public.ad_metrics) FROM PUBLIC;
GRANT ALL ON FUNCTION public.ad_performance_derive_row(am public.ad_metrics) TO anon;
GRANT ALL ON FUNCTION public.ad_performance_derive_row(am public.ad_metrics) TO authenticated;
GRANT ALL ON FUNCTION public.ad_performance_derive_row(am public.ad_metrics) TO service_role;


--
-- Name: FUNCTION ad_performance_parse_value(p_raw text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.ad_performance_parse_value(p_raw text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.ad_performance_parse_value(p_raw text) TO anon;
GRANT ALL ON FUNCTION public.ad_performance_parse_value(p_raw text) TO authenticated;
GRANT ALL ON FUNCTION public.ad_performance_parse_value(p_raw text) TO service_role;


--
-- Name: FUNCTION ad_performance_rollup_apply(p_keys public.ad_metric_key[]); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.ad_performance_rollup_apply(p_keys public.ad_metric_key[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.ad_performance_rollup_apply(p_keys public.ad_metric_key[]) TO anon;
GRANT ALL ON FUNCTION public.ad_performance_rollup_apply(p_keys public.ad_metric_key[]) TO authenticated;
GRANT ALL ON FUNCTION public.ad_performance_rollup_apply(p_keys public.ad_metric_key[]) TO service_role;


--
-- Name: FUNCTION ad_performance_rollup_consistency_check(p_user_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.ad_performance_rollup_consistency_check(p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.ad_performance_rollup_consistency_check(p_user_id uuid) TO anon;
GRANT ALL ON FUNCTION public.ad_performance_rollup_consistency_check(p_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.ad_performance_rollup_consistency_check(p_user_id uuid) TO service_role;


--
-- Name: FUNCTION ad_performance_rollup_rebuild(p_user_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.ad_performance_rollup_rebuild(p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.ad_performance_rollup_rebuild(p_user_id uuid) TO anon;
GRANT ALL ON FUNCTION public.ad_performance_rollup_rebuild(p_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.ad_performance_rollup_rebuild(p_user_id uuid) TO service_role;


--
-- Name: FUNCTION ad_performance_rollup_sync_ins(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.ad_performance_rollup_sync_ins() FROM PUBLIC;
GRANT ALL ON FUNCTION public.ad_performance_rollup_sync_ins() TO anon;
GRANT ALL ON FUNCTION public.ad_performance_rollup_sync_ins() TO authenticated;
GRANT ALL ON FUNCTION public.ad_performance_rollup_sync_ins() TO service_role;


--
-- Name: FUNCTION ad_performance_rollup_sync_upd(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.ad_performance_rollup_sync_upd() FROM PUBLIC;
GRANT ALL ON FUNCTION public.ad_performance_rollup_sync_upd() TO anon;
GRANT ALL ON FUNCTION public.ad_performance_rollup_sync_upd() TO authenticated;
GRANT ALL ON FUNCTION public.ad_performance_rollup_sync_upd() TO service_role;


--
-- Name: FUNCTION batch_add_pack_id_to_arrays(p_user_id uuid, p_pack_id uuid, p_table_name text, p_ids_to_update text[]); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.batch_add_pack_id_to_arrays(p_user_id uuid, p_pack_id uuid, p_table_name text, p_ids_to_update text[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.batch_add_pack_id_to_arrays(p_user_id uuid, p_pack_id uuid, p_table_name text, p_ids_to_update text[]) TO authenticated;
GRANT ALL ON FUNCTION public.batch_add_pack_id_to_arrays(p_user_id uuid, p_pack_id uuid, p_table_name text, p_ids_to_update text[]) TO service_role;


--
-- Name: FUNCTION batch_remove_pack_id_from_arrays(p_user_id uuid, p_pack_id uuid, p_table_name text, p_ids_to_update text[]); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.batch_remove_pack_id_from_arrays(p_user_id uuid, p_pack_id uuid, p_table_name text, p_ids_to_update text[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.batch_remove_pack_id_from_arrays(p_user_id uuid, p_pack_id uuid, p_table_name text, p_ids_to_update text[]) TO authenticated;
GRANT ALL ON FUNCTION public.batch_remove_pack_id_from_arrays(p_user_id uuid, p_pack_id uuid, p_table_name text, p_ids_to_update text[]) TO service_role;


--
-- Name: FUNCTION batch_update_ad_metrics_enrichment(p_user_id uuid, p_updates jsonb, p_pack_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.batch_update_ad_metrics_enrichment(p_user_id uuid, p_updates jsonb, p_pack_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.batch_update_ad_metrics_enrichment(p_user_id uuid, p_updates jsonb, p_pack_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.batch_update_ad_metrics_enrichment(p_user_id uuid, p_updates jsonb, p_pack_id uuid) TO service_role;


--
-- Name: FUNCTION chat_claim_lease(p_user_id uuid, p_message_id uuid, p_seconds integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.chat_claim_lease(p_user_id uuid, p_message_id uuid, p_seconds integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.chat_claim_lease(p_user_id uuid, p_message_id uuid, p_seconds integer) TO service_role;


--
-- Name: FUNCTION chat_close_scope(p_token uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.chat_close_scope(p_token uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.chat_close_scope(p_token uuid) TO service_role;


--
-- Name: FUNCTION chat_open_scope(p_actor_id uuid, p_pack_ids uuid[], p_action_key text, p_ttl_seconds integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.chat_open_scope(p_actor_id uuid, p_pack_ids uuid[], p_action_key text, p_ttl_seconds integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.chat_open_scope(p_actor_id uuid, p_pack_ids uuid[], p_action_key text, p_ttl_seconds integer) TO service_role;


--
-- Name: FUNCTION chat_release_lease(p_user_id uuid, p_message_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.chat_release_lease(p_user_id uuid, p_message_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.chat_release_lease(p_user_id uuid, p_message_id uuid) TO service_role;


--
-- Name: FUNCTION check_plan_cache_mode_gaps(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.check_plan_cache_mode_gaps() FROM PUBLIC;
GRANT ALL ON FUNCTION public.check_plan_cache_mode_gaps() TO anon;
GRANT ALL ON FUNCTION public.check_plan_cache_mode_gaps() TO authenticated;
GRANT ALL ON FUNCTION public.check_plan_cache_mode_gaps() TO service_role;


--
-- Name: FUNCTION claim_job_processing(p_job_id text, p_user_id uuid, p_owner text, p_lease_seconds integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.claim_job_processing(p_job_id text, p_user_id uuid, p_owner text, p_lease_seconds integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_job_processing(p_job_id text, p_user_id uuid, p_owner text, p_lease_seconds integer) TO authenticated;
GRANT ALL ON FUNCTION public.claim_job_processing(p_job_id text, p_user_id uuid, p_owner text, p_lease_seconds integer) TO service_role;


--
-- Name: FUNCTION clear_ad_metrics_enrichment(p_user_id uuid, p_pack_id uuid, p_dry_run boolean); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.clear_ad_metrics_enrichment(p_user_id uuid, p_pack_id uuid, p_dry_run boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.clear_ad_metrics_enrichment(p_user_id uuid, p_pack_id uuid, p_dry_run boolean) TO anon;
GRANT ALL ON FUNCTION public.clear_ad_metrics_enrichment(p_user_id uuid, p_pack_id uuid, p_dry_run boolean) TO authenticated;
GRANT ALL ON FUNCTION public.clear_ad_metrics_enrichment(p_user_id uuid, p_pack_id uuid, p_dry_run boolean) TO service_role;


--
-- Name: FUNCTION detect_pack_conflicts(p_pack_ids uuid[], p_actor_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.detect_pack_conflicts(p_pack_ids uuid[], p_actor_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.detect_pack_conflicts(p_pack_ids uuid[], p_actor_id uuid) TO service_role;


--
-- Name: FUNCTION dissolve_folder(p_folder_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.dissolve_folder(p_folder_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.dissolve_folder(p_folder_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.dissolve_folder(p_folder_id uuid) TO service_role;


--
-- Name: FUNCTION fetch_entity_performance_v145(p_user_id uuid, p_date_start date, p_date_stop date, p_entity text, p_entity_id text, p_pack_ids uuid[], p_group_by text, p_include_curve boolean, p_series_days integer, p_include_custom boolean); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.fetch_entity_performance_v145(p_user_id uuid, p_date_start date, p_date_stop date, p_entity text, p_entity_id text, p_pack_ids uuid[], p_group_by text, p_include_curve boolean, p_series_days integer, p_include_custom boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fetch_entity_performance_v145(p_user_id uuid, p_date_start date, p_date_stop date, p_entity text, p_entity_id text, p_pack_ids uuid[], p_group_by text, p_include_curve boolean, p_series_days integer, p_include_custom boolean) TO anon;
GRANT ALL ON FUNCTION public.fetch_entity_performance_v145(p_user_id uuid, p_date_start date, p_date_stop date, p_entity text, p_entity_id text, p_pack_ids uuid[], p_group_by text, p_include_curve boolean, p_series_days integer, p_include_custom boolean) TO authenticated;
GRANT ALL ON FUNCTION public.fetch_entity_performance_v145(p_user_id uuid, p_date_start date, p_date_stop date, p_entity text, p_entity_id text, p_pack_ids uuid[], p_group_by text, p_include_curve boolean, p_series_days integer, p_include_custom boolean) TO service_role;


--
-- Name: FUNCTION fetch_entity_performance_v155(p_user_id uuid, p_date_start date, p_date_stop date, p_entity text, p_entity_id text, p_pack_ids uuid[], p_group_by text, p_include_curve boolean, p_series_days integer, p_include_custom boolean); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.fetch_entity_performance_v155(p_user_id uuid, p_date_start date, p_date_stop date, p_entity text, p_entity_id text, p_pack_ids uuid[], p_group_by text, p_include_curve boolean, p_series_days integer, p_include_custom boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fetch_entity_performance_v155(p_user_id uuid, p_date_start date, p_date_stop date, p_entity text, p_entity_id text, p_pack_ids uuid[], p_group_by text, p_include_curve boolean, p_series_days integer, p_include_custom boolean) TO authenticated;
GRANT ALL ON FUNCTION public.fetch_entity_performance_v155(p_user_id uuid, p_date_start date, p_date_stop date, p_entity text, p_entity_id text, p_pack_ids uuid[], p_group_by text, p_include_curve boolean, p_series_days integer, p_include_custom boolean) TO service_role;


--
-- Name: FUNCTION fetch_entity_performance_v157(p_user_id uuid, p_date_start date, p_date_stop date, p_entity text, p_entity_id text, p_pack_ids uuid[], p_group_by text, p_include_curve boolean, p_series_days integer, p_include_custom boolean); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.fetch_entity_performance_v157(p_user_id uuid, p_date_start date, p_date_stop date, p_entity text, p_entity_id text, p_pack_ids uuid[], p_group_by text, p_include_curve boolean, p_series_days integer, p_include_custom boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fetch_entity_performance_v157(p_user_id uuid, p_date_start date, p_date_stop date, p_entity text, p_entity_id text, p_pack_ids uuid[], p_group_by text, p_include_curve boolean, p_series_days integer, p_include_custom boolean) TO authenticated;
GRANT ALL ON FUNCTION public.fetch_entity_performance_v157(p_user_id uuid, p_date_start date, p_date_stop date, p_entity text, p_entity_id text, p_pack_ids uuid[], p_group_by text, p_include_curve boolean, p_series_days integer, p_include_custom boolean) TO service_role;


--
-- Name: FUNCTION fetch_entity_performance_v158(p_user_id uuid, p_date_start date, p_date_stop date, p_entity text, p_entity_id text, p_pack_ids uuid[], p_group_by text, p_include_curve boolean, p_series_days integer, p_include_custom boolean); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.fetch_entity_performance_v158(p_user_id uuid, p_date_start date, p_date_stop date, p_entity text, p_entity_id text, p_pack_ids uuid[], p_group_by text, p_include_curve boolean, p_series_days integer, p_include_custom boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fetch_entity_performance_v158(p_user_id uuid, p_date_start date, p_date_stop date, p_entity text, p_entity_id text, p_pack_ids uuid[], p_group_by text, p_include_curve boolean, p_series_days integer, p_include_custom boolean) TO authenticated;
GRANT ALL ON FUNCTION public.fetch_entity_performance_v158(p_user_id uuid, p_date_start date, p_date_stop date, p_entity text, p_entity_id text, p_pack_ids uuid[], p_group_by text, p_include_curve boolean, p_series_days integer, p_include_custom boolean) TO service_role;


--
-- Name: FUNCTION fetch_entity_performance_v171(p_user_id uuid, p_date_start date, p_date_stop date, p_entity text, p_entity_id text, p_pack_ids uuid[], p_group_by text, p_include_curve boolean, p_series_days integer, p_include_custom boolean); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.fetch_entity_performance_v171(p_user_id uuid, p_date_start date, p_date_stop date, p_entity text, p_entity_id text, p_pack_ids uuid[], p_group_by text, p_include_curve boolean, p_series_days integer, p_include_custom boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fetch_entity_performance_v171(p_user_id uuid, p_date_start date, p_date_stop date, p_entity text, p_entity_id text, p_pack_ids uuid[], p_group_by text, p_include_curve boolean, p_series_days integer, p_include_custom boolean) TO authenticated;
GRANT ALL ON FUNCTION public.fetch_entity_performance_v171(p_user_id uuid, p_date_start date, p_date_stop date, p_entity text, p_entity_id text, p_pack_ids uuid[], p_group_by text, p_include_curve boolean, p_series_days integer, p_include_custom boolean) TO service_role;


--
-- Name: FUNCTION fetch_manager_performance_base_v145(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text, p_include_custom boolean); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.fetch_manager_performance_base_v145(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text, p_include_custom boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fetch_manager_performance_base_v145(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text, p_include_custom boolean) TO anon;
GRANT ALL ON FUNCTION public.fetch_manager_performance_base_v145(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text, p_include_custom boolean) TO authenticated;
GRANT ALL ON FUNCTION public.fetch_manager_performance_base_v145(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text, p_include_custom boolean) TO service_role;


--
-- Name: FUNCTION fetch_manager_performance_base_v155(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text, p_include_custom boolean); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.fetch_manager_performance_base_v155(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text, p_include_custom boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fetch_manager_performance_base_v155(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text, p_include_custom boolean) TO authenticated;
GRANT ALL ON FUNCTION public.fetch_manager_performance_base_v155(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text, p_include_custom boolean) TO service_role;


--
-- Name: FUNCTION fetch_manager_performance_series_v145(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_group_keys text[], p_window integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.fetch_manager_performance_series_v145(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_group_keys text[], p_window integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fetch_manager_performance_series_v145(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_group_keys text[], p_window integer) TO anon;
GRANT ALL ON FUNCTION public.fetch_manager_performance_series_v145(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_group_keys text[], p_window integer) TO authenticated;
GRANT ALL ON FUNCTION public.fetch_manager_performance_series_v145(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_group_keys text[], p_window integer) TO service_role;


--
-- Name: FUNCTION fetch_manager_performance_series_v171(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_group_keys text[], p_window integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.fetch_manager_performance_series_v171(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_group_keys text[], p_window integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fetch_manager_performance_series_v171(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_group_keys text[], p_window integer) TO authenticated;
GRANT ALL ON FUNCTION public.fetch_manager_performance_series_v171(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_group_keys text[], p_window integer) TO service_role;


--
-- Name: FUNCTION fetch_manager_rankings_core_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text, p_include_custom boolean); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.fetch_manager_rankings_core_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text, p_include_custom boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fetch_manager_rankings_core_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text, p_include_custom boolean) TO anon;
GRANT ALL ON FUNCTION public.fetch_manager_rankings_core_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text, p_include_custom boolean) TO authenticated;
GRANT ALL ON FUNCTION public.fetch_manager_rankings_core_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text, p_include_custom boolean) TO service_role;


--
-- Name: FUNCTION fetch_manager_rankings_retention_v172(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_group_key text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.fetch_manager_rankings_retention_v172(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_group_key text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fetch_manager_rankings_retention_v172(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_group_key text) TO authenticated;
GRANT ALL ON FUNCTION public.fetch_manager_rankings_retention_v172(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_group_key text) TO service_role;


--
-- Name: FUNCTION fetch_manager_rankings_retention_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_group_key text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.fetch_manager_rankings_retention_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_group_key text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fetch_manager_rankings_retention_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_group_key text) TO authenticated;
GRANT ALL ON FUNCTION public.fetch_manager_rankings_retention_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_group_key text) TO service_role;


--
-- Name: FUNCTION fetch_manager_rankings_series_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_group_keys text[], p_window integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.fetch_manager_rankings_series_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_group_keys text[], p_window integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fetch_manager_rankings_series_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_group_keys text[], p_window integer) TO authenticated;
GRANT ALL ON FUNCTION public.fetch_manager_rankings_series_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_group_keys text[], p_window integer) TO service_role;


--
-- Name: FUNCTION fetch_manager_rankings_v161(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text, p_include_custom boolean, p_thumb_public_prefix text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.fetch_manager_rankings_v161(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text, p_include_custom boolean, p_thumb_public_prefix text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fetch_manager_rankings_v161(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text, p_include_custom boolean, p_thumb_public_prefix text) TO authenticated;
GRANT ALL ON FUNCTION public.fetch_manager_rankings_v161(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text, p_include_custom boolean, p_thumb_public_prefix text) TO service_role;


--
-- Name: FUNCTION fetch_manager_rankings_v162(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text, p_include_custom boolean, p_thumb_public_prefix text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.fetch_manager_rankings_v162(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text, p_include_custom boolean, p_thumb_public_prefix text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fetch_manager_rankings_v162(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text, p_include_custom boolean, p_thumb_public_prefix text) TO authenticated;
GRANT ALL ON FUNCTION public.fetch_manager_rankings_v162(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text, p_include_custom boolean, p_thumb_public_prefix text) TO service_role;


--
-- Name: FUNCTION fetch_manager_rankings_v170(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text, p_include_custom boolean, p_thumb_public_prefix text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.fetch_manager_rankings_v170(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text, p_include_custom boolean, p_thumb_public_prefix text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fetch_manager_rankings_v170(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text, p_include_custom boolean, p_thumb_public_prefix text) TO authenticated;
GRANT ALL ON FUNCTION public.fetch_manager_rankings_v170(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text, p_include_custom boolean, p_thumb_public_prefix text) TO service_role;


--
-- Name: FUNCTION folders_check_parent(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.folders_check_parent() FROM PUBLIC;
GRANT ALL ON FUNCTION public.folders_check_parent() TO authenticated;
GRANT ALL ON FUNCTION public.folders_check_parent() TO service_role;


--
-- Name: FUNCTION get_admin_users_list(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.get_admin_users_list() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_admin_users_list() TO service_role;


--
-- Name: FUNCTION handle_new_user_subscription(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.handle_new_user_subscription() FROM PUBLIC;
GRANT ALL ON FUNCTION public.handle_new_user_subscription() TO authenticated;
GRANT ALL ON FUNCTION public.handle_new_user_subscription() TO service_role;


--
-- Name: FUNCTION lookup_user_by_email(p_email text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.lookup_user_by_email(p_email text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.lookup_user_by_email(p_email text) TO service_role;


--
-- Name: FUNCTION lookup_users_by_ids(p_user_ids uuid[]); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.lookup_users_by_ids(p_user_ids uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.lookup_users_by_ids(p_user_ids uuid[]) TO service_role;


--
-- Name: FUNCTION merge_ad_pack_inventory(p_user_id uuid, p_pack_id uuid, p_rows jsonb); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.merge_ad_pack_inventory(p_user_id uuid, p_pack_id uuid, p_rows jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.merge_ad_pack_inventory(p_user_id uuid, p_pack_id uuid, p_rows jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.merge_ad_pack_inventory(p_user_id uuid, p_pack_id uuid, p_rows jsonb) TO service_role;


--
-- Name: FUNCTION pack_acquire_refresh_lock(p_owner uuid, p_pack uuid, p_actor uuid, p_ttl_minutes integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.pack_acquire_refresh_lock(p_owner uuid, p_pack uuid, p_actor uuid, p_ttl_minutes integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.pack_acquire_refresh_lock(p_owner uuid, p_pack uuid, p_actor uuid, p_ttl_minutes integer) TO service_role;


--
-- Name: FUNCTION pack_clamp_inventory(p_owner uuid, p_pack uuid, p_start date, p_stop date); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.pack_clamp_inventory(p_owner uuid, p_pack uuid, p_start date, p_stop date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.pack_clamp_inventory(p_owner uuid, p_pack uuid, p_start date, p_stop date) TO service_role;


--
-- Name: FUNCTION pack_prune_ad_ids(p_owner uuid, p_pack uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.pack_prune_ad_ids(p_owner uuid, p_pack uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.pack_prune_ad_ids(p_owner uuid, p_pack uuid) TO service_role;


--
-- Name: FUNCTION pack_recompute_conversion_types(p_owner uuid, p_pack uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.pack_recompute_conversion_types(p_owner uuid, p_pack uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.pack_recompute_conversion_types(p_owner uuid, p_pack uuid) TO service_role;


--
-- Name: FUNCTION pack_trim_head(p_owner uuid, p_pack uuid, p_from date, p_to date, p_keys jsonb); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.pack_trim_head(p_owner uuid, p_pack uuid, p_from date, p_to date, p_keys jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.pack_trim_head(p_owner uuid, p_pack uuid, p_from date, p_to date, p_keys jsonb) TO service_role;


--
-- Name: FUNCTION pack_trim_preview(p_owner uuid, p_pack uuid, p_start date, p_stop date); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.pack_trim_preview(p_owner uuid, p_pack uuid, p_start date, p_stop date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.pack_trim_preview(p_owner uuid, p_pack uuid, p_start date, p_stop date) TO service_role;


--
-- Name: FUNCTION place_folder(p_folder_id uuid, p_parent_id uuid, p_sibling_ids uuid[]); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.place_folder(p_folder_id uuid, p_parent_id uuid, p_sibling_ids uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.place_folder(p_folder_id uuid, p_parent_id uuid, p_sibling_ids uuid[]) TO authenticated;
GRANT ALL ON FUNCTION public.place_folder(p_folder_id uuid, p_parent_id uuid, p_sibling_ids uuid[]) TO service_role;


--
-- Name: FUNCTION present_parent_ids(p_user_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.present_parent_ids(p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.present_parent_ids(p_user_id uuid) TO anon;
GRANT ALL ON FUNCTION public.present_parent_ids(p_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.present_parent_ids(p_user_id uuid) TO service_role;


--
-- Name: FUNCTION preserve_ads_meta_created_time(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.preserve_ads_meta_created_time() FROM PUBLIC;
GRANT ALL ON FUNCTION public.preserve_ads_meta_created_time() TO anon;
GRANT ALL ON FUNCTION public.preserve_ads_meta_created_time() TO authenticated;
GRANT ALL ON FUNCTION public.preserve_ads_meta_created_time() TO service_role;


--
-- Name: FUNCTION purge_pack_action_log(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.purge_pack_action_log() FROM PUBLIC;
GRANT ALL ON FUNCTION public.purge_pack_action_log() TO service_role;


--
-- Name: FUNCTION release_job_processing_lease(p_job_id text, p_user_id uuid, p_owner text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.release_job_processing_lease(p_job_id text, p_user_id uuid, p_owner text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.release_job_processing_lease(p_job_id text, p_user_id uuid, p_owner text) TO authenticated;
GRANT ALL ON FUNCTION public.release_job_processing_lease(p_job_id text, p_user_id uuid, p_owner text) TO service_role;


--
-- Name: FUNCTION renew_job_processing_lease(p_job_id text, p_user_id uuid, p_owner text, p_lease_seconds integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.renew_job_processing_lease(p_job_id text, p_user_id uuid, p_owner text, p_lease_seconds integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.renew_job_processing_lease(p_job_id text, p_user_id uuid, p_owner text, p_lease_seconds integer) TO authenticated;
GRANT ALL ON FUNCTION public.renew_job_processing_lease(p_job_id text, p_user_id uuid, p_owner text, p_lease_seconds integer) TO service_role;


--
-- Name: FUNCTION reorder_folders(p_folder_ids uuid[]); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.reorder_folders(p_folder_ids uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reorder_folders(p_folder_ids uuid[]) TO authenticated;
GRANT ALL ON FUNCTION public.reorder_folders(p_folder_ids uuid[]) TO service_role;


--
-- Name: FUNCTION resolve_pack_access(p_pack_ids uuid[], p_actor_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.resolve_pack_access(p_pack_ids uuid[], p_actor_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.resolve_pack_access(p_pack_ids uuid[], p_actor_id uuid) TO service_role;


--
-- Name: FUNCTION resolve_pack_mql_leadscore_min(p_user_id uuid, p_pack_ids uuid[]); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.resolve_pack_mql_leadscore_min(p_user_id uuid, p_pack_ids uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.resolve_pack_mql_leadscore_min(p_user_id uuid, p_pack_ids uuid[]) TO service_role;


--
-- Name: FUNCTION set_subscriptions_updated_at(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.set_subscriptions_updated_at() FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_subscriptions_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.set_subscriptions_updated_at() TO service_role;


--
-- Name: FUNCTION set_updated_at(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_updated_at() TO anon;
GRANT ALL ON FUNCTION public.set_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.set_updated_at() TO service_role;


--
-- Name: FUNCTION sweep_stale_pack_refresh(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.sweep_stale_pack_refresh() FROM PUBLIC;
GRANT ALL ON FUNCTION public.sweep_stale_pack_refresh() TO service_role;


--
-- Name: FUNCTION url_quote_path(p text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.url_quote_path(p text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.url_quote_path(p text) TO authenticated;
GRANT ALL ON FUNCTION public.url_quote_path(p text) TO service_role;


--
-- Name: TABLE ad_accounts; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.ad_accounts TO anon;
GRANT ALL ON TABLE public.ad_accounts TO authenticated;
GRANT ALL ON TABLE public.ad_accounts TO service_role;


--
-- Name: TABLE ad_performance_daily; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.ad_performance_daily TO anon;
GRANT ALL ON TABLE public.ad_performance_daily TO authenticated;
GRANT ALL ON TABLE public.ad_performance_daily TO service_role;


--
-- Name: TABLE ads; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.ads TO anon;
GRANT ALL ON TABLE public.ads TO authenticated;
GRANT ALL ON TABLE public.ads TO service_role;


--
-- Name: TABLE packs; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.packs TO anon;
GRANT ALL ON TABLE public.packs TO authenticated;
GRANT ALL ON TABLE public.packs TO service_role;


--
-- Name: TABLE conversion_keys; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.conversion_keys TO anon;
GRANT ALL ON TABLE public.conversion_keys TO authenticated;
GRANT ALL ON TABLE public.conversion_keys TO service_role;


--
-- Name: TABLE ad_transcriptions; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.ad_transcriptions TO anon;
GRANT ALL ON TABLE public.ad_transcriptions TO authenticated;
GRANT ALL ON TABLE public.ad_transcriptions TO service_role;


--
-- Name: TABLE ad_metric_pack_map; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.ad_metric_pack_map TO anon;
GRANT ALL ON TABLE public.ad_metric_pack_map TO authenticated;
GRANT ALL ON TABLE public.ad_metric_pack_map TO service_role;


--
-- Name: TABLE ad_pack_inventory; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.ad_pack_inventory TO authenticated;
GRANT ALL ON TABLE public.ad_pack_inventory TO service_role;


--
-- Name: TABLE ad_shares; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.ad_shares TO anon;
GRANT ALL ON TABLE public.ad_shares TO authenticated;
GRANT ALL ON TABLE public.ad_shares TO service_role;


--
-- Name: TABLE ad_sheet_integrations; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.ad_sheet_integrations TO anon;
GRANT ALL ON TABLE public.ad_sheet_integrations TO authenticated;
GRANT ALL ON TABLE public.ad_sheet_integrations TO service_role;


--
-- Name: TABLE ad_tags; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.ad_tags TO anon;
GRANT ALL ON TABLE public.ad_tags TO authenticated;
GRANT ALL ON TABLE public.ad_tags TO service_role;


--
-- Name: TABLE board_groups; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.board_groups TO anon;
GRANT ALL ON TABLE public.board_groups TO authenticated;
GRANT ALL ON TABLE public.board_groups TO service_role;


--
-- Name: TABLE boards; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.boards TO anon;
GRANT ALL ON TABLE public.boards TO authenticated;
GRANT ALL ON TABLE public.boards TO service_role;


--
-- Name: TABLE bulk_ad_items; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.bulk_ad_items TO anon;
GRANT ALL ON TABLE public.bulk_ad_items TO authenticated;
GRANT ALL ON TABLE public.bulk_ad_items TO service_role;


--
-- Name: TABLE chat_conversations; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,MAINTAIN ON TABLE public.chat_conversations TO authenticated;
GRANT ALL ON TABLE public.chat_conversations TO service_role;


--
-- Name: TABLE chat_messages; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,MAINTAIN ON TABLE public.chat_messages TO authenticated;
GRANT ALL ON TABLE public.chat_messages TO service_role;


--
-- Name: TABLE chat_user_leases; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,MAINTAIN ON TABLE public.chat_user_leases TO authenticated;
GRANT ALL ON TABLE public.chat_user_leases TO service_role;


--
-- Name: SEQUENCE conversion_keys_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.conversion_keys_id_seq TO anon;
GRANT ALL ON SEQUENCE public.conversion_keys_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.conversion_keys_id_seq TO service_role;


--
-- Name: TABLE facebook_connections; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.facebook_connections TO anon;
GRANT ALL ON TABLE public.facebook_connections TO authenticated;
GRANT ALL ON TABLE public.facebook_connections TO service_role;


--
-- Name: TABLE folders; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.folders TO anon;
GRANT ALL ON TABLE public.folders TO authenticated;
GRANT ALL ON TABLE public.folders TO service_role;


--
-- Name: TABLE google_accounts; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.google_accounts TO anon;
GRANT ALL ON TABLE public.google_accounts TO authenticated;
GRANT ALL ON TABLE public.google_accounts TO service_role;


--
-- Name: TABLE jobs; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.jobs TO anon;
GRANT ALL ON TABLE public.jobs TO authenticated;
GRANT ALL ON TABLE public.jobs TO service_role;


--
-- Name: TABLE meta_api_usage; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.meta_api_usage TO anon;
GRANT ALL ON TABLE public.meta_api_usage TO authenticated;
GRANT ALL ON TABLE public.meta_api_usage TO service_role;


--
-- Name: TABLE pack_action_log; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.pack_action_log TO service_role;


--
-- Name: TABLE pack_folder_members; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.pack_folder_members TO anon;
GRANT ALL ON TABLE public.pack_folder_members TO authenticated;
GRANT ALL ON TABLE public.pack_folder_members TO service_role;


--
-- Name: TABLE pack_shares; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.pack_shares TO anon;
GRANT ALL ON TABLE public.pack_shares TO authenticated;
GRANT ALL ON TABLE public.pack_shares TO service_role;


--
-- Name: TABLE parent_entities; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.parent_entities TO anon;
GRANT ALL ON TABLE public.parent_entities TO authenticated;
GRANT ALL ON TABLE public.parent_entities TO service_role;


--
-- Name: TABLE sheet_column_mappings; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.sheet_column_mappings TO anon;
GRANT ALL ON TABLE public.sheet_column_mappings TO authenticated;
GRANT ALL ON TABLE public.sheet_column_mappings TO service_role;


--
-- Name: TABLE stripe_events; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.stripe_events TO anon;
GRANT ALL ON TABLE public.stripe_events TO authenticated;
GRANT ALL ON TABLE public.stripe_events TO service_role;


--
-- Name: TABLE subscriptions; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.subscriptions TO anon;
GRANT ALL ON TABLE public.subscriptions TO authenticated;
GRANT ALL ON TABLE public.subscriptions TO service_role;


--
-- Name: TABLE tags; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.tags TO anon;
GRANT ALL ON TABLE public.tags TO authenticated;
GRANT ALL ON TABLE public.tags TO service_role;


--
-- Name: TABLE user_preferences; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.user_preferences TO anon;
GRANT ALL ON TABLE public.user_preferences TO authenticated;
GRANT ALL ON TABLE public.user_preferences TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- PostgreSQL database dump complete
--

\unrestrict IYEnJW1GkcuvWIPZCds190I9iL4Du0IVqzO0HceQGf1Uwm76hyxdGJpJ4GiL1aL

