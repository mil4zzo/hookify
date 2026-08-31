--
-- PostgreSQL database dump
--

\restrict fHVUVCJIXZ7eo5VaRTa0m13qiYoNDFNrkV6qkahMYLKy64wKDblH9Hc1u3BJdiS

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
	ad_id text,
	date date
);


ALTER TYPE public.ad_metric_key OWNER TO postgres;

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
    video_watched_p75 integer
);


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
-- Name: ad_performance_derive_row(public.ad_metrics); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.ad_performance_derive_row(am public.ad_metrics) RETURNS TABLE(account_id text, campaign_id text, adset_id text, ad_name text, impressions bigint, clicks bigint, inline_link_clicks bigint, spend numeric, lpv bigint, plays bigint, thruplays bigint, video_watched_p50 numeric, video_watched_p75 numeric, hold_rate numeric, reach bigint, frequency numeric, hook_value numeric, scroll_stop_value numeric, conv_key_ids integer[], conv_values numeric[], lead_scores numeric[], lead_qtys integer[])
    LANGUAGE sql STABLE PARALLEL SAFE
    SET search_path TO 'public'
    AS $$
  -- A linha derivada COMPLETA de uma linha de ad_metrics. Números saneados como a RPC
  -- v116 (coalesce 0, casts). Arrays na ordem canônica (por key_id / por score).
  -- Pressupõe que as chaves já existem no dicionário (o chamador garante).
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
    (select coalesce(array_agg(qty   order by score), '{}') from l)
$$;


ALTER FUNCTION public.ad_performance_derive_row(am public.ad_metrics) OWNER TO postgres;

--
-- Name: FUNCTION ad_performance_derive_row(am public.ad_metrics); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.ad_performance_derive_row(am public.ad_metrics) IS 'Fonte única da linha de ad_performance_daily a partir de uma linha de ad_metrics (migration 129): chaves, números saneados como a RPC, arrays de conversões e histograma de leads. Trigger, rebuild e consistency_check usam esta função.';


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
  WHERE d.user_id = k.user_id AND d.ad_id = k.ad_id AND d.date = k.date;

  INSERT INTO public.conversion_keys (key)
  SELECT DISTINCT c.key
  FROM unnest(p_keys) k
  JOIN public.ad_metrics am ON am.user_id = k.user_id AND am.ad_id = k.ad_id AND am.date = k.date
  CROSS JOIN LATERAL public.ad_performance_derive_conversions(am.actions, am.conversions) c
  ON CONFLICT (key) DO NOTHING;

  INSERT INTO public.ad_performance_daily (
    user_id, ad_id, date,
    account_id, campaign_id, adset_id, ad_name,
    impressions, clicks, inline_link_clicks, spend, lpv, plays, thruplays,
    video_watched_p50, video_watched_p75, hold_rate, reach, frequency, hook_value, scroll_stop_value,
    conv_key_ids, conv_values, lead_scores, lead_qtys
  )
  SELECT am.user_id, am.ad_id, am.date, r.*
  FROM unnest(p_keys) k
  JOIN public.ad_metrics am ON am.user_id = k.user_id AND am.ad_id = k.ad_id AND am.date = k.date
  CROSS JOIN LATERAL public.ad_performance_derive_row(am) r;
END;
$$;


ALTER FUNCTION public.ad_performance_rollup_apply(p_keys public.ad_metric_key[]) OWNER TO postgres;

--
-- Name: FUNCTION ad_performance_rollup_apply(p_keys public.ad_metric_key[]); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.ad_performance_rollup_apply(p_keys public.ad_metric_key[]) IS 'Worker do rollup (migration 128): apaga e recomputa ad_performance_daily das chaves (user, ad, dia) recebidas, relendo ad_metrics. Chamado pelos triggers por statement; também serve de reparo pontual.';


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
    select am.user_id, am.ad_id, am.date, r.*
    from public.ad_metrics am
    join scope s on s.user_id = am.user_id
    cross join lateral public.ad_performance_derive_row(am) r
  ),
  stored as (
    select d.user_id, d.ad_id, d.date,
           d.account_id, d.campaign_id, d.adset_id, d.ad_name,
           d.impressions, d.clicks, d.inline_link_clicks, d.spend, d.lpv, d.plays, d.thruplays,
           d.video_watched_p50, d.video_watched_p75, d.hold_rate, d.reach, d.frequency, d.hook_value, d.scroll_stop_value,
           d.conv_key_ids, d.conv_values, d.lead_scores, d.lead_qtys
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
    user_id, ad_id, date,
    account_id, campaign_id, adset_id, ad_name,
    impressions, clicks, inline_link_clicks, spend, lpv, plays, thruplays,
    video_watched_p50, video_watched_p75, hold_rate, reach, frequency, hook_value, scroll_stop_value,
    conv_key_ids, conv_values, lead_scores, lead_qtys
  )
  SELECT am.user_id, am.ad_id, am.date, r.*
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
    (SELECT array_agg(ROW(n.user_id, n.ad_id, n.date)::public.ad_metric_key) FROM new_rows n)
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
    (SELECT array_agg(ROW(n.user_id, n.ad_id, n.date)::public.ad_metric_key)
     FROM new_rows n
     JOIN old_rows o ON o.id = n.id AND o.user_id = n.user_id
     WHERE ROW(n.actions, n.conversions, n.leadscore_values,
               n.account_id, n.campaign_id, n.adset_id, n.ad_name,
               n.impressions, n.clicks, n.inline_link_clicks, n.spend, n.lpv,
               n.video_total_plays, n.video_total_thruplays, n.video_watched_p50, n.video_watched_p75,
               n.hold_rate, n.reach, n.frequency, n.hook_rate, n.scroll_stop_rate, n.video_play_curve_actions)
        IS DISTINCT FROM
           ROW(o.actions, o.conversions, o.leadscore_values,
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

COMMENT ON FUNCTION public.ad_performance_rollup_sync_upd() IS 'Trigger por STATEMENT (AFTER UPDATE, old_rows/new_rows) que recomputa ad_performance_daily só das linhas cuja fonte mudou — qualquer coluna que a derivação lê (migrations 128/129).';


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



      pack_ids = CASE



        WHEN p_pack_id = ANY(COALESCE(pack_ids, ARRAY[]::uuid[])) THEN COALESCE(pack_ids, ARRAY[]::uuid[])



        ELSE array_append(COALESCE(pack_ids, ARRAY[]::uuid[]), p_pack_id)



      END,



      updated_at = now()



    WHERE user_id = p_user_id



      AND ad_id = ANY(p_ids_to_update);







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

COMMENT ON FUNCTION public.batch_add_pack_id_to_arrays(p_user_id uuid, p_pack_id uuid, p_table_name text, p_ids_to_update text[]) IS 'Anexa pack_id de forma idempotente ao array pack_ids de ads ou ad_metrics em batch.';


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
  -- Guard de tenancy (migration 113): caller autenticado so opera o PROPRIO
  -- silo; service role (auth.uid() nulo) passa - e o caminho do backend para
  -- operacoes de pack compartilhado (P3.3), que ja derivou o dono via
  -- resolve_pack_access antes de chegar aqui.
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



      END AS leadscore_vals



    FROM jsonb_array_elements(p_updates) AS item,



    LATERAL jsonb_array_elements_text(item->'ids') AS id_val



  )



  UPDATE public.ad_metrics am



  SET



    leadscore_values = CASE



      WHEN e.leadscore_vals IS NOT NULL THEN e.leadscore_vals



      ELSE am.leadscore_values



    END,



    updated_at = now()



  FROM expanded e



  WHERE am.id = e.id



    AND am.user_id = p_user_id



    AND (



      p_pack_id IS NULL



      OR EXISTS (



        SELECT 1 FROM public.ad_metric_pack_map apm



        WHERE apm.user_id = am.user_id



          AND apm.ad_id = am.ad_id



          AND apm.metric_date = am.date



          AND apm.pack_id = p_pack_id



      )



    );







  GET DIAGNOSTICS total_rows_updated = ROW_COUNT;







  IF total_ids_sent > 0 THEN



    SELECT



      count(*)::int,



      count(*) FILTER (



        WHERE p_pack_id IS NULL



          OR EXISTS (



            SELECT 1 FROM public.ad_metric_pack_map apm2



            WHERE apm2.user_id = p_user_id



              AND apm2.ad_id = am_diag.ad_id



              AND apm2.metric_date = am_diag.date



              AND apm2.pack_id = p_pack_id



          )



      )::int



    INTO existing_count, in_pack_count



    FROM public.ad_metrics am_diag



    WHERE user_id = p_user_id AND id = ANY(all_ids);



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

COMMENT ON FUNCTION public.batch_update_ad_metrics_enrichment(p_user_id uuid, p_updates jsonb, p_pack_id uuid) IS 'Atualiza multiplos registros de ad_metrics em uma unica transacao via UPDATE + CTE, aplicando apenas leadscore_values (fluxo Leadscore-only). Usa dual-read: EXISTS em ad_metric_pack_map + OR fallback pack_ids[].';


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
-- Name: detect_pack_conflicts(uuid[], uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.detect_pack_conflicts(p_pack_ids uuid[], p_actor_id uuid) RETURNS TABLE(pack_a uuid, pack_b uuid)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with acc as (
    select a.pack_id, a.owner_id
    from public.resolve_pack_access(p_pack_ids, p_actor_id) a
  )
  select a.pack_id as pack_a, b.pack_id as pack_b
  from acc a
  join acc b
    on a.owner_id <> b.owner_id      -- so cross-silo; mesmo dono nunca conflita
   and a.pack_id < b.pack_id         -- cada par nao-ordenado uma vez
  where exists (
    select 1
    from public.ad_metric_pack_map ma
    join public.ad_metric_pack_map mb
      on mb.user_id = b.owner_id
     and mb.pack_id = b.pack_id
     and mb.metric_date = ma.metric_date
     and mb.ad_id = ma.ad_id
    where ma.user_id = a.owner_id
      and ma.pack_id = a.pack_id
  );
$$;


ALTER FUNCTION public.detect_pack_conflicts(p_pack_ids uuid[], p_actor_id uuid) OWNER TO postgres;

--
-- Name: FUNCTION detect_pack_conflicts(p_pack_ids uuid[], p_actor_id uuid); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.detect_pack_conflicts(p_pack_ids uuid[], p_actor_id uuid) IS 'Pares de packs ACESSIVEIS ao ator (proprios ou compartilhados) que compartilham ao menos um (ad_id, metric_date) entre DONOS diferentes. Alimenta o bloqueio de selecao (camada 1). Mesmo dono nunca conflita. Helper interno — nao exposto ao PostgREST.';


--
-- Name: fetch_entity_performance_v133(uuid, date, date, text, text, uuid[], text, boolean, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.fetch_entity_performance_v133(p_user_id uuid, p_date_start date, p_date_stop date, p_entity text, p_entity_id text, p_pack_ids uuid[] DEFAULT NULL::uuid[], p_group_by text DEFAULT 'entity'::text, p_include_curve boolean DEFAULT false, p_series_days integer DEFAULT NULL::integer) RETURNS jsonb
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
    select am.user_id, am.ad_id, am.date
    from unnest(v_owners) as o(owner_id)
    join public.ad_metrics am
      on am.user_id = o.owner_id
     and am.date >= v_date_start
     and am.date <= v_date_stop
     and (
       (v_entity = 'ad_id' and am.ad_id = p_entity_id)
       or (v_entity = 'ad_name' and am.ad_name = p_entity_id)
       or (v_entity = 'adset_id' and am.adset_id = p_entity_id)
     )
    where p_pack_ids is null
       or exists (
         select 1 from public.ad_metric_pack_map apm
         where apm.user_id = am.user_id
           and apm.ad_id = am.ad_id
           and apm.metric_date = am.date
           and apm.pack_id = any(p_pack_ids)
       )
  ),
  -- 2. Dedup cross-silo: uma linha por (anúncio, dia); vence o silo que NÃO é o do
  --    ator (o dono do pack compartilhado), desempate por uuid — regra da v104/v130.
  dedup as (
    select k.user_id, k.ad_id, k.date
    from (
      select k.*, row_number() over (partition by k.ad_id, k.date order by (k.user_id = p_user_id), k.user_id) as rn
      from keys k
    ) k
    where k.rn = 1
  ),
  -- 3. As linhas: SÓ o read model, pela PK.
  rows_ as (
    select
      case when v_group_by = 'ad_id' then d.ad_id else p_entity_id end as group_key,
      d.*
    from dedup k
    join public.ad_performance_daily d
      on d.user_id = k.user_id
     and d.ad_id = k.ad_id
     and d.date = k.date
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
        'leads', coalesce(l.leads, '{}'::jsonb)
      ) as item
    from totals t
    left join conv_totals c on c.group_key = t.group_key
    left join lead_totals l on l.group_key = t.group_key
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
      a.effective_status,
      coalesce(nullif(a.thumb_storage_path, ''), g.any_thumb_storage_path) as thumb_storage_path
    from grp_dec g
    left join public.ad_metrics am
      on am.user_id = g.rep_user_id
     and am.ad_id = g.rep_ad_id
     and am.date = g.rep_date
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
    join public.ad_metrics am
      on am.user_id = r.user_id
     and am.ad_id = r.ad_id
     and am.date = r.date
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


ALTER FUNCTION public.fetch_entity_performance_v133(p_user_id uuid, p_date_start date, p_date_stop date, p_entity text, p_entity_id text, p_pack_ids uuid[], p_group_by text, p_include_curve boolean, p_series_days integer) OWNER TO postgres;

--
-- Name: FUNCTION fetch_entity_performance_v133(p_user_id uuid, p_date_start date, p_date_stop date, p_entity text, p_entity_id text, p_pack_ids uuid[], p_group_by text, p_include_curve boolean, p_series_days integer); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.fetch_entity_performance_v133(p_user_id uuid, p_date_start date, p_date_stop date, p_entity text, p_entity_id text, p_pack_ids uuid[], p_group_by text, p_include_curve boolean, p_series_days integer) IS 'Detalhe de UMA entidade (ad_id|ad_name|adset_id) sobre o read model ad_performance_daily (migration 133): por grupo (entidade ou cada ad_id), linhas por dia com somas ponderadas, conversoes e histograma de leads; representante (regra do Manager) para nomes/status/miniatura; curva de retencao ponderada opcional (unica leitura de JSON, por entidade). Substitui as 7 rotas que somavam ad_metrics cru em Python. Escopo/dedup identicos a base v130.';


--
-- Name: fetch_entity_performance_v134(uuid, date, date, text, text, uuid[], text, boolean, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.fetch_entity_performance_v134(p_user_id uuid, p_date_start date, p_date_stop date, p_entity text, p_entity_id text, p_pack_ids uuid[] DEFAULT NULL::uuid[], p_group_by text DEFAULT 'entity'::text, p_include_curve boolean DEFAULT false, p_series_days integer DEFAULT NULL::integer) RETURNS jsonb
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
    select am.user_id, am.ad_id, am.date
    from unnest(v_owners) as o(owner_id)
    join public.ad_metrics am
      on am.user_id = o.owner_id
     and am.date >= v_date_start
     and am.date <= v_date_stop
     and (
       (v_entity = 'ad_id' and am.ad_id = p_entity_id)
       or (v_entity = 'ad_name' and am.ad_name = p_entity_id)
       or (v_entity = 'adset_id' and am.adset_id = p_entity_id)
     )
    where p_pack_ids is null
       or exists (
         select 1 from public.ad_metric_pack_map apm
         where apm.user_id = am.user_id
           and apm.ad_id = am.ad_id
           and apm.metric_date = am.date
           and apm.pack_id = any(p_pack_ids)
       )
  ),
  -- 2. Dedup cross-silo: uma linha por (anúncio, dia); vence o silo que NÃO é o do
  --    ator (o dono do pack compartilhado), desempate por uuid — regra da v104/v130.
  dedup as (
    select k.user_id, k.ad_id, k.date
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
        array_agg(distinct apm.pack_id) filter (where apm.pack_id is not null),
        array[]::uuid[]
      ) as pack_ids
    from dedup d
    join public.ad_metric_pack_map apm
      on apm.user_id = d.user_id
     and apm.ad_id = d.ad_id
     and apm.metric_date = d.date
     and (p_pack_ids is null or apm.pack_id = any(p_pack_ids))
    group by d.ad_id
  ),
  -- 3. As linhas: SÓ o read model, pela PK.
  rows_ as (
    select
      case when v_group_by = 'ad_id' then d.ad_id else p_entity_id end as group_key,
      d.*
    from dedup k
    join public.ad_performance_daily d
      on d.user_id = k.user_id
     and d.ad_id = k.ad_id
     and d.date = k.date
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
        'leads', coalesce(l.leads, '{}'::jsonb)
      ) as item
    from totals t
    left join conv_totals c on c.group_key = t.group_key
    left join lead_totals l on l.group_key = t.group_key
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
    left join public.ad_metrics am
      on am.user_id = g.rep_user_id
     and am.ad_id = g.rep_ad_id
     and am.date = g.rep_date
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
    join public.ad_metrics am
      on am.user_id = r.user_id
     and am.ad_id = r.ad_id
     and am.date = r.date
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


ALTER FUNCTION public.fetch_entity_performance_v134(p_user_id uuid, p_date_start date, p_date_stop date, p_entity text, p_entity_id text, p_pack_ids uuid[], p_group_by text, p_include_curve boolean, p_series_days integer) OWNER TO postgres;

--
-- Name: FUNCTION fetch_entity_performance_v134(p_user_id uuid, p_date_start date, p_date_stop date, p_entity text, p_entity_id text, p_pack_ids uuid[], p_group_by text, p_include_curve boolean, p_series_days integer); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.fetch_entity_performance_v134(p_user_id uuid, p_date_start date, p_date_stop date, p_entity text, p_entity_id text, p_pack_ids uuid[], p_group_by text, p_include_curve boolean, p_series_days integer) IS 'Detalhe de UMA entidade sobre ad_performance_daily: v133 + pack_ids por linha-filha (restrito a p_pack_ids), para o filtro por Pack existir na visao expandida. Tags seguem fora: sao do criativo e nao do anuncio.';


--
-- Name: fetch_manager_performance_base_v130(uuid, date, date, text, uuid[], text[], text, text, text, text, boolean, boolean, integer, integer, text, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.fetch_manager_performance_base_v130(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text DEFAULT 'ad_name'::text, p_pack_ids uuid[] DEFAULT NULL::uuid[], p_account_ids text[] DEFAULT NULL::text[], p_campaign_name_contains text DEFAULT NULL::text, p_adset_name_contains text DEFAULT NULL::text, p_ad_name_contains text DEFAULT NULL::text, p_action_type text DEFAULT NULL::text, p_include_leadscore boolean DEFAULT true, p_include_available_conversion_types boolean DEFAULT true, p_limit integer DEFAULT 500, p_offset integer DEFAULT 0, p_order_by text DEFAULT 'spend'::text, p_campaign_id text DEFAULT NULL::text) RETURNS jsonb
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
      apm.metric_date as date,
      (array_agg(apm.user_id order by (apm.user_id = p_user_id), apm.user_id))[1] as user_id,
      (min(apm.user_id::text) is distinct from max(apm.user_id::text)) as x_cross_silo,
      bit_or(set_bit(repeat('0', v_n_packs)::varbit, array_position(v_pack_universe, apm.pack_id) - 1, 1)) as pack_mask
    from unnest(v_owners) as o(owner_id)
    join public.ad_metric_pack_map apm
      on apm.user_id = o.owner_id
     and apm.pack_id = any(p_pack_ids)
     and apm.metric_date >= v_date_start
     and apm.metric_date <= v_date_stop
    where p_pack_ids is not null
    group by apm.ad_id, apm.metric_date

    union all

    -- Ramo legado (sem packs): o silo do ator no período; packs de origem por lookup.
    select
      am.ad_id,
      am.date,
      am.user_id,
      false as x_cross_silo,
      coalesce(pm.pack_mask, repeat('0', v_n_packs)::varbit) as pack_mask
    from public.ad_metrics am
    left join lateral (
      select bit_or(set_bit(repeat('0', v_n_packs)::varbit, array_position(v_pack_universe, apm.pack_id) - 1, 1)) as pack_mask
      from public.ad_metric_pack_map apm
      where apm.user_id = am.user_id and apm.ad_id = am.ad_id and apm.metric_date = am.date
        and apm.pack_id = any(v_pack_universe)
    ) pm on true
    where p_pack_ids is null
      and am.user_id = p_user_id
      and am.date >= v_date_start
      and am.date <= v_date_stop
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
    join public.ad_performance_daily d
      on d.user_id = k.user_id
     and d.ad_id = k.ad_id
     and d.date = k.date
    where (p_account_ids is null or d.account_id = any(p_account_ids))
      and (p_ad_name_contains is null or p_ad_name_contains = ''
           or coalesce(d.ad_name, '') ilike '%' || p_ad_name_contains || '%')
      and (
        (coalesce(p_campaign_name_contains, '') = '' and coalesce(p_adset_name_contains, '') = '')
        or exists (
          select 1 from public.ad_metrics am
          where am.user_id = k.user_id and am.ad_id = k.ad_id and am.date = k.date
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
      a.meta_created_time
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
      bit_or(p.pack_mask) as pack_mask,
      -- representante do grupo = (impressões do dia rep, ad_id) máximos — a ordem
      -- (impressions desc, ad_id desc) da v116; user_id e os campos vão de carona.
      max((substr(p.rep_enc, 1, 12) || e'\x1f' || p.ad_id || e'\x1f' || p.user_id::text
           || e'\x1f' || p.rep_enc) collate "C") as rep_enc,
      bool_or(upper(coalesce(p.effective_status, '')) = 'ACTIVE') as has_active,
      count(distinct p.ad_id) filter (where upper(coalesce(p.effective_status, '')) = 'ACTIVE')::integer as active_count,
      min(p.effective_status) filter (where nullif(p.effective_status, '') is not null) as fallback_status,
      min(p.meta_created_time) as meta_created_min
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
      join public.ad_performance_daily d
        on d.user_id = k.user_id and d.ad_id = k.ad_id and d.date = k.date
      cross join lateral unnest(d.lead_scores, d.lead_qtys) as s(score, qty)
      where v_include_leads
        and cardinality(d.lead_scores) > 0
        and (p_account_ids is null or d.account_id = any(p_account_ids))
        and (p_ad_name_contains is null or p_ad_name_contains = ''
             or coalesce(d.ad_name, '') ilike '%' || p_ad_name_contains || '%')
        and (
          (coalesce(p_campaign_name_contains, '') = '' and coalesce(p_adset_name_contains, '') = '')
          or exists (
            select 1 from public.ad_metrics am
            where am.user_id = k.user_id and am.ad_id = k.ad_id and am.date = k.date
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
    left join public.ad_metrics am
      on am.user_id = g.rep_user_id
     and am.ad_id = g.rep_ad_id
     and am.date = g.rep_date
  ),
  rows_enriched as (
    select
      g.group_key,
      g.rep_account_id as account_id,
      g.account_ids,
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
      g.impressions, g.clicks, g.inline_link_clicks, g.spend, g.lpv, g.plays, g.thruplays,
      g.hook_wsum, g.hold_rate_wsum, g.video_watched_p50_wsum, g.video_watched_p75_wsum,
      g.scroll_stop_wsum, g.reach, g.frequency_wsum,
      case when v_group_by = 'campaign_id' then g.adset_count else g.ad_id_count end as ad_count,
      -- Chave do histograma normalizada (80.0 → "80"); a v116 mandava o array cru.
      coalesce(lg.leadscore_histogram, '{}'::jsonb) as leadscore_histogram,
      g.results,
      g.meta_created_min,
      coalesce(nullif(ra.thumbnail_url, ''), nullif(ra.adcreatives_videos_thumbs ->> 0, '')) as thumbnail,
      ra.adcreatives_videos_thumbs,
      ra.thumb_storage_path,
      coalesce(tg.tags, '[]'::jsonb) as tags
    from grp_rep g
    left join leads_by_group lg
      on lg.group_key = g.group_key
    left join public.ads ra
      on ra.user_id = g.rep_user_id
     and ra.ad_id = g.rep_ad_id
    left join lateral (
      -- v116: tags do ATOR (p_user_id), só nos níveis de criativo/anúncio.
      select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'color', t.color) order by t.name, t.id) as tags
      from public.ad_tags atg
      join public.tags t on t.id = atg.tag_id and t.user_id = p_user_id
      where v_group_by in ('ad_name', 'ad_id')
        and atg.user_id = p_user_id
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
    join public.ad_performance_daily d
      on d.user_id = k.user_id and d.ad_id = k.ad_id and d.date = k.date
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
          select 1 from public.ad_metrics am
          where am.user_id = k.user_id and am.ad_id = k.ad_id and am.date = k.date
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
        'conversions', pr.conversions,
        'ad_count', pr.ad_count,
        'thumbnail', case
          when v_group_by in ('ad_name', 'ad_id') and pr.thumb_storage_path is not null then null
          else pr.thumbnail
        end,
        'thumb_storage_path', pr.thumb_storage_path,
        'adcreatives_videos_thumbs', pr.adcreatives_videos_thumbs
      ) as item
    from paged_raw pr
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
  end if;

  return v_result;
end;
$$;


ALTER FUNCTION public.fetch_manager_performance_base_v130(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text) OWNER TO postgres;

--
-- Name: FUNCTION fetch_manager_performance_base_v130(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.fetch_manager_performance_base_v130(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text) IS 'Manager base v130 (migration 130): passada única sobre o rollup da 128 (ad_performance_daily). Seleção resolvida no mapa (dedup cross-silo + máscara de packs sem ordenar linha larga), ad_metrics lida só nas colunas necessárias, agregação anúncio-dia → anúncio → grupo com agregados de estado constante, representante por max(ad_performance_rep). Mesmo contrato da v116 exceto leadscore_values → leadscore_histogram.';


--
-- Name: fetch_manager_performance_base_v132(uuid, date, date, text, uuid[], text[], text, text, text, text, boolean, boolean, integer, integer, text, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.fetch_manager_performance_base_v132(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text DEFAULT 'ad_name'::text, p_pack_ids uuid[] DEFAULT NULL::uuid[], p_account_ids text[] DEFAULT NULL::text[], p_campaign_name_contains text DEFAULT NULL::text, p_adset_name_contains text DEFAULT NULL::text, p_ad_name_contains text DEFAULT NULL::text, p_action_type text DEFAULT NULL::text, p_include_leadscore boolean DEFAULT true, p_include_available_conversion_types boolean DEFAULT true, p_limit integer DEFAULT 500, p_offset integer DEFAULT 0, p_order_by text DEFAULT 'spend'::text, p_campaign_id text DEFAULT NULL::text) RETURNS jsonb
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
      apm.metric_date as date,
      (array_agg(apm.user_id order by (apm.user_id = p_user_id), apm.user_id))[1] as user_id,
      (min(apm.user_id::text) is distinct from max(apm.user_id::text)) as x_cross_silo,
      bit_or(set_bit(repeat('0', v_n_packs)::varbit, array_position(v_pack_universe, apm.pack_id) - 1, 1)) as pack_mask
    from unnest(v_owners) as o(owner_id)
    join public.ad_metric_pack_map apm
      on apm.user_id = o.owner_id
     and apm.pack_id = any(p_pack_ids)
     and apm.metric_date >= v_date_start
     and apm.metric_date <= v_date_stop
    where p_pack_ids is not null
    group by apm.ad_id, apm.metric_date

    union all

    -- Ramo legado (sem packs): o silo do ator no período; packs de origem por lookup.
    select
      am.ad_id,
      am.date,
      am.user_id,
      false as x_cross_silo,
      coalesce(pm.pack_mask, repeat('0', v_n_packs)::varbit) as pack_mask
    from public.ad_metrics am
    left join lateral (
      select bit_or(set_bit(repeat('0', v_n_packs)::varbit, array_position(v_pack_universe, apm.pack_id) - 1, 1)) as pack_mask
      from public.ad_metric_pack_map apm
      where apm.user_id = am.user_id and apm.ad_id = am.ad_id and apm.metric_date = am.date
        and apm.pack_id = any(v_pack_universe)
    ) pm on true
    where p_pack_ids is null
      and am.user_id = p_user_id
      and am.date >= v_date_start
      and am.date <= v_date_stop
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
    join public.ad_performance_daily d
      on d.user_id = k.user_id
     and d.ad_id = k.ad_id
     and d.date = k.date
    where (p_account_ids is null or d.account_id = any(p_account_ids))
      and (p_ad_name_contains is null or p_ad_name_contains = ''
           or coalesce(d.ad_name, '') ilike '%' || p_ad_name_contains || '%')
      and (
        (coalesce(p_campaign_name_contains, '') = '' and coalesce(p_adset_name_contains, '') = '')
        or exists (
          select 1 from public.ad_metrics am
          where am.user_id = k.user_id and am.ad_id = k.ad_id and am.date = k.date
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
      bit_or(p.pack_mask) as pack_mask,
      -- representante do grupo = (impressões do dia rep, ad_id) máximos — a ordem
      -- (impressions desc, ad_id desc) da v116; user_id e os campos vão de carona.
      max((substr(p.rep_enc, 1, 12) || e'\x1f' || p.ad_id || e'\x1f' || p.user_id::text
           || e'\x1f' || p.rep_enc) collate "C") as rep_enc,
      bool_or(upper(coalesce(p.effective_status, '')) = 'ACTIVE') as has_active,
      count(distinct p.ad_id) filter (where upper(coalesce(p.effective_status, '')) = 'ACTIVE')::integer as active_count,
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
      join public.ad_performance_daily d
        on d.user_id = k.user_id and d.ad_id = k.ad_id and d.date = k.date
      cross join lateral unnest(d.lead_scores, d.lead_qtys) as s(score, qty)
      where v_include_leads
        and cardinality(d.lead_scores) > 0
        and (p_account_ids is null or d.account_id = any(p_account_ids))
        and (p_ad_name_contains is null or p_ad_name_contains = ''
             or coalesce(d.ad_name, '') ilike '%' || p_ad_name_contains || '%')
        and (
          (coalesce(p_campaign_name_contains, '') = '' and coalesce(p_adset_name_contains, '') = '')
          or exists (
            select 1 from public.ad_metrics am
            where am.user_id = k.user_id and am.ad_id = k.ad_id and am.date = k.date
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
    left join public.ad_metrics am
      on am.user_id = g.rep_user_id
     and am.ad_id = g.rep_ad_id
     and am.date = g.rep_date
  ),
  rows_enriched as (
    select
      g.group_key,
      g.rep_account_id as account_id,
      g.account_ids,
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
      g.impressions, g.clicks, g.inline_link_clicks, g.spend, g.lpv, g.plays, g.thruplays,
      g.hook_wsum, g.hold_rate_wsum, g.video_watched_p50_wsum, g.video_watched_p75_wsum,
      g.scroll_stop_wsum, g.reach, g.frequency_wsum,
      case when v_group_by = 'campaign_id' then g.adset_count else g.ad_id_count end as ad_count,
      -- Chave do histograma normalizada (80.0 → "80"); a v116 mandava o array cru.
      coalesce(lg.leadscore_histogram, '{}'::jsonb) as leadscore_histogram,
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
      end as has_transcription
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
      select true as has_transcription
      from public.ad_transcriptions t
      where v_group_by in ('ad_name', 'ad_id')
        and t.user_id = any(v_owners)
        and t.ad_name = coalesce(nullif(g.rep_ad_name, ''), g.rep_ad_id)
        and t.status = 'completed'
      limit 1
    ) tr on true
    left join leads_by_group lg
      on lg.group_key = g.group_key
    left join public.ads ra
      on ra.user_id = g.rep_user_id
     and ra.ad_id = g.rep_ad_id
    left join lateral (
      -- v116: tags do ATOR (p_user_id), só nos níveis de criativo/anúncio.
      select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'color', t.color) order by t.name, t.id) as tags
      from public.ad_tags atg
      join public.tags t on t.id = atg.tag_id and t.user_id = p_user_id
      where v_group_by in ('ad_name', 'ad_id')
        and atg.user_id = p_user_id
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
    join public.ad_performance_daily d
      on d.user_id = k.user_id and d.ad_id = k.ad_id and d.date = k.date
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
          select 1 from public.ad_metrics am
          where am.user_id = k.user_id and am.ad_id = k.ad_id and am.date = k.date
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
        'conversions', pr.conversions,
        'ad_count', pr.ad_count,
        'thumbnail', case
          when v_group_by in ('ad_name', 'ad_id') and pr.thumb_storage_path is not null then null
          else pr.thumbnail
        end,
        'thumb_storage_path', pr.thumb_storage_path,
        'adcreatives_videos_thumbs', pr.adcreatives_videos_thumbs,
        'media_type', pr.media_type,
        'has_transcription', pr.has_transcription
      ) as item
    from paged_raw pr
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
  end if;

  return v_result;
end;
$$;


ALTER FUNCTION public.fetch_manager_performance_base_v132(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text) OWNER TO postgres;

--
-- Name: FUNCTION fetch_manager_performance_base_v132(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.fetch_manager_performance_base_v132(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text) IS 'Manager base v132 (migration 132): a v130 + media_type, has_transcription e fallback de miniatura (qualquer copia do grupo) calculados na consulta - a rota deixa de hidratar via PostgREST (medido: 15 requisicoes e 13,7 mil linhas por carga so para o tipo de midia).';


--
-- Name: fetch_manager_performance_base_v136(uuid, date, date, text, uuid[], text[], text, text, text, text, boolean, boolean, integer, integer, text, text, boolean); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.fetch_manager_performance_base_v136(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text DEFAULT 'ad_name'::text, p_pack_ids uuid[] DEFAULT NULL::uuid[], p_account_ids text[] DEFAULT NULL::text[], p_campaign_name_contains text DEFAULT NULL::text, p_adset_name_contains text DEFAULT NULL::text, p_ad_name_contains text DEFAULT NULL::text, p_action_type text DEFAULT NULL::text, p_include_leadscore boolean DEFAULT true, p_include_available_conversion_types boolean DEFAULT true, p_limit integer DEFAULT 500, p_offset integer DEFAULT 0, p_order_by text DEFAULT 'spend'::text, p_campaign_id text DEFAULT NULL::text, p_include_parent_ids boolean DEFAULT false) RETURNS jsonb
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
  -- Procedencia completa (campaign_ids/adset_ids + dicionario de nomes) e OPT-IN.
  -- Medido no laboratorio: ligada, a aba de criativos cresce 35% (30 dias) a 67%
  -- (13 meses) em bytes comprimidos, porque um criativo colapsa ate 60 conjuntos.
  -- Quem nao filtra por campanha (Explorer; Plano/GOLD/Insights quando o criterio
  -- nao cita campanha) nao paga nada por isso.
  v_include_parents boolean := coalesce(p_include_parent_ids, false);
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
      apm.metric_date as date,
      (array_agg(apm.user_id order by (apm.user_id = p_user_id), apm.user_id))[1] as user_id,
      (min(apm.user_id::text) is distinct from max(apm.user_id::text)) as x_cross_silo,
      bit_or(set_bit(repeat('0', v_n_packs)::varbit, array_position(v_pack_universe, apm.pack_id) - 1, 1)) as pack_mask
    from unnest(v_owners) as o(owner_id)
    join public.ad_metric_pack_map apm
      on apm.user_id = o.owner_id
     and apm.pack_id = any(p_pack_ids)
     and apm.metric_date >= v_date_start
     and apm.metric_date <= v_date_stop
    where p_pack_ids is not null
    group by apm.ad_id, apm.metric_date

    union all

    -- Ramo legado (sem packs): o silo do ator no período; packs de origem por lookup.
    select
      am.ad_id,
      am.date,
      am.user_id,
      false as x_cross_silo,
      coalesce(pm.pack_mask, repeat('0', v_n_packs)::varbit) as pack_mask
    from public.ad_metrics am
    left join lateral (
      select bit_or(set_bit(repeat('0', v_n_packs)::varbit, array_position(v_pack_universe, apm.pack_id) - 1, 1)) as pack_mask
      from public.ad_metric_pack_map apm
      where apm.user_id = am.user_id and apm.ad_id = am.ad_id and apm.metric_date = am.date
        and apm.pack_id = any(v_pack_universe)
    ) pm on true
    where p_pack_ids is null
      and am.user_id = p_user_id
      and am.date >= v_date_start
      and am.date <= v_date_stop
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
    join public.ad_performance_daily d
      on d.user_id = k.user_id
     and d.ad_id = k.ad_id
     and d.date = k.date
    where (p_account_ids is null or d.account_id = any(p_account_ids))
      and (p_ad_name_contains is null or p_ad_name_contains = ''
           or coalesce(d.ad_name, '') ilike '%' || p_ad_name_contains || '%')
      and (
        (coalesce(p_campaign_name_contains, '') = '' and coalesce(p_adset_name_contains, '') = '')
        or exists (
          select 1 from public.ad_metrics am
          where am.user_id = k.user_id and am.ad_id = k.ad_id and am.date = k.date
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
      -- v136: TODAS as campanhas e conjuntos do grupo, nao a do representante.
      -- Mesma passada do account_ids (mesmo group by, nenhuma leitura nova), e o
      -- proprio `filter` carrega o gate: desligado, nao ha acumulacao nem distinct.
      coalesce(array_agg(distinct p.campaign_id) filter (where v_include_parents and p.campaign_id is not null), array[]::text[]) as campaign_ids,
      coalesce(array_agg(distinct p.adset_id) filter (where v_include_parents and p.adset_id is not null), array[]::text[]) as adset_ids,
      bit_or(p.pack_mask) as pack_mask,
      -- representante do grupo = (impressões do dia rep, ad_id) máximos — a ordem
      -- (impressions desc, ad_id desc) da v116; user_id e os campos vão de carona.
      max((substr(p.rep_enc, 1, 12) || e'\x1f' || p.ad_id || e'\x1f' || p.user_id::text
           || e'\x1f' || p.rep_enc) collate "C") as rep_enc,
      bool_or(upper(coalesce(p.effective_status, '')) = 'ACTIVE') as has_active,
      count(distinct p.ad_id) filter (where upper(coalesce(p.effective_status, '')) = 'ACTIVE')::integer as active_count,
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
      join public.ad_performance_daily d
        on d.user_id = k.user_id and d.ad_id = k.ad_id and d.date = k.date
      cross join lateral unnest(d.lead_scores, d.lead_qtys) as s(score, qty)
      where v_include_leads
        and cardinality(d.lead_scores) > 0
        and (p_account_ids is null or d.account_id = any(p_account_ids))
        and (p_ad_name_contains is null or p_ad_name_contains = ''
             or coalesce(d.ad_name, '') ilike '%' || p_ad_name_contains || '%')
        and (
          (coalesce(p_campaign_name_contains, '') = '' and coalesce(p_adset_name_contains, '') = '')
          or exists (
            select 1 from public.ad_metrics am
            where am.user_id = k.user_id and am.ad_id = k.ad_id and am.date = k.date
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
    left join public.ad_metrics am
      on am.user_id = g.rep_user_id
     and am.ad_id = g.rep_ad_id
     and am.date = g.rep_date
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
      g.impressions, g.clicks, g.inline_link_clicks, g.spend, g.lpv, g.plays, g.thruplays,
      g.hook_wsum, g.hold_rate_wsum, g.video_watched_p50_wsum, g.video_watched_p75_wsum,
      g.scroll_stop_wsum, g.reach, g.frequency_wsum,
      case when v_group_by = 'campaign_id' then g.adset_count else g.ad_id_count end as ad_count,
      -- Chave do histograma normalizada (80.0 → "80"); a v116 mandava o array cru.
      coalesce(lg.leadscore_histogram, '{}'::jsonb) as leadscore_histogram,
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
      end as has_transcription
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
      select true as has_transcription
      from public.ad_transcriptions t
      where v_group_by in ('ad_name', 'ad_id')
        and t.user_id = any(v_owners)
        and t.ad_name = coalesce(nullif(g.rep_ad_name, ''), g.rep_ad_id)
        and t.status = 'completed'
      limit 1
    ) tr on true
    left join leads_by_group lg
      on lg.group_key = g.group_key
    left join public.ads ra
      on ra.user_id = g.rep_user_id
     and ra.ad_id = g.rep_ad_id
    left join lateral (
      -- v116: tags do ATOR (p_user_id), só nos níveis de criativo/anúncio.
      select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'color', t.color) order by t.name, t.id) as tags
      from public.ad_tags atg
      join public.tags t on t.id = atg.tag_id and t.user_id = p_user_id
      where v_group_by in ('ad_name', 'ad_id')
        and atg.user_id = p_user_id
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
    join public.ad_performance_daily d
      on d.user_id = k.user_id and d.ad_id = k.ad_id and d.date = k.date
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
          select 1 from public.ad_metrics am
          where am.user_id = k.user_id and am.ad_id = k.ad_id and am.date = k.date
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
        'conversions', pr.conversions,
        'ad_count', pr.ad_count,
        'thumbnail', case
          when v_group_by in ('ad_name', 'ad_id') and pr.thumb_storage_path is not null then null
          else pr.thumbnail
        end,
        'thumb_storage_path', pr.thumb_storage_path,
        'adcreatives_videos_thumbs', pr.adcreatives_videos_thumbs,
        'media_type', pr.media_type,
        'has_transcription', pr.has_transcription
      )
      -- Desligado, a linha sai IDENTICA a da v132 - nem uma chave a mais.
      || case when v_include_parents
              then jsonb_build_object('campaign_ids', pr.campaign_ids, 'adset_ids', pr.adset_ids)
              else '{}'::jsonb end as item
    from paged_raw pr
  ),
  -- v136: dicionario id -> nome, so das campanhas/conjuntos citados nas linhas
  -- DESTA pagina (<= 500 linhas). O nome NAO viaja por linha: o mesmo nome
  -- apareceria dezenas de vezes, e nome de campanha e longo.
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
          where v_include_parents
            and a.user_id = any(v_owners)
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
          where v_include_parents
            and a.user_id = any(v_owners)
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
    'available_conversion_types',
      case when v_include_conv_types then coalesce((select conv_types from available_types), '[]'::jsonb) else '[]'::jsonb end,
    'averages', coalesce((select averages from averages_payload), '{}'::jsonb),
    'header_aggregates', coalesce((select header_aggregates from header_payload), '{}'::jsonb),
    'pagination', coalesce((select pagination from pagination_payload), jsonb_build_object('limit', v_limit, 'offset', v_offset, 'total', 0, 'has_more', false))
  )
  -- Desligado, a raiz nao ganha nem a chave `names`: o payload e o da v132.
  || case when v_include_parents
          then jsonb_build_object('names', coalesce((select names from names_payload), '{}'::jsonb))
          else '{}'::jsonb end
  || case
       when coalesce((select conflict_rows from overlap_stat), 0) > 0
       then jsonb_build_object('overlap', jsonb_build_object('rows', (select conflict_rows from overlap_stat)))
       else '{}'::jsonb
     end
  into v_result;

  v_result := coalesce(v_result, jsonb_build_object(
    'data', '[]'::jsonb,
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
    if v_include_parents then
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
  end if;

  return v_result;
end;
$$;


ALTER FUNCTION public.fetch_manager_performance_base_v136(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text, p_include_parent_ids boolean) OWNER TO postgres;

--
-- Name: fetch_manager_performance_base_v137(uuid, date, date, text, uuid[], text[], text, text, text, text, boolean, boolean, integer, integer, text, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.fetch_manager_performance_base_v137(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text DEFAULT 'ad_name'::text, p_pack_ids uuid[] DEFAULT NULL::uuid[], p_account_ids text[] DEFAULT NULL::text[], p_campaign_name_contains text DEFAULT NULL::text, p_adset_name_contains text DEFAULT NULL::text, p_ad_name_contains text DEFAULT NULL::text, p_action_type text DEFAULT NULL::text, p_include_leadscore boolean DEFAULT true, p_include_available_conversion_types boolean DEFAULT true, p_limit integer DEFAULT 500, p_offset integer DEFAULT 0, p_order_by text DEFAULT 'spend'::text, p_campaign_id text DEFAULT NULL::text) RETURNS jsonb
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
      apm.metric_date as date,
      (array_agg(apm.user_id order by (apm.user_id = p_user_id), apm.user_id))[1] as user_id,
      (min(apm.user_id::text) is distinct from max(apm.user_id::text)) as x_cross_silo,
      bit_or(set_bit(repeat('0', v_n_packs)::varbit, array_position(v_pack_universe, apm.pack_id) - 1, 1)) as pack_mask
    from unnest(v_owners) as o(owner_id)
    join public.ad_metric_pack_map apm
      on apm.user_id = o.owner_id
     and apm.pack_id = any(p_pack_ids)
     and apm.metric_date >= v_date_start
     and apm.metric_date <= v_date_stop
    where p_pack_ids is not null
    group by apm.ad_id, apm.metric_date

    union all

    -- Ramo legado (sem packs): o silo do ator no período; packs de origem por lookup.
    select
      am.ad_id,
      am.date,
      am.user_id,
      false as x_cross_silo,
      coalesce(pm.pack_mask, repeat('0', v_n_packs)::varbit) as pack_mask
    from public.ad_metrics am
    left join lateral (
      select bit_or(set_bit(repeat('0', v_n_packs)::varbit, array_position(v_pack_universe, apm.pack_id) - 1, 1)) as pack_mask
      from public.ad_metric_pack_map apm
      where apm.user_id = am.user_id and apm.ad_id = am.ad_id and apm.metric_date = am.date
        and apm.pack_id = any(v_pack_universe)
    ) pm on true
    where p_pack_ids is null
      and am.user_id = p_user_id
      and am.date >= v_date_start
      and am.date <= v_date_stop
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
    join public.ad_performance_daily d
      on d.user_id = k.user_id
     and d.ad_id = k.ad_id
     and d.date = k.date
    where (p_account_ids is null or d.account_id = any(p_account_ids))
      and (p_ad_name_contains is null or p_ad_name_contains = ''
           or coalesce(d.ad_name, '') ilike '%' || p_ad_name_contains || '%')
      and (
        (coalesce(p_campaign_name_contains, '') = '' and coalesce(p_adset_name_contains, '') = '')
        or exists (
          select 1 from public.ad_metrics am
          where am.user_id = k.user_id and am.ad_id = k.ad_id and am.date = k.date
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
      join public.ad_performance_daily d
        on d.user_id = k.user_id and d.ad_id = k.ad_id and d.date = k.date
      cross join lateral unnest(d.lead_scores, d.lead_qtys) as s(score, qty)
      where v_include_leads
        and cardinality(d.lead_scores) > 0
        and (p_account_ids is null or d.account_id = any(p_account_ids))
        and (p_ad_name_contains is null or p_ad_name_contains = ''
             or coalesce(d.ad_name, '') ilike '%' || p_ad_name_contains || '%')
        and (
          (coalesce(p_campaign_name_contains, '') = '' and coalesce(p_adset_name_contains, '') = '')
          or exists (
            select 1 from public.ad_metrics am
            where am.user_id = k.user_id and am.ad_id = k.ad_id and am.date = k.date
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
    left join public.ad_metrics am
      on am.user_id = g.rep_user_id
     and am.ad_id = g.rep_ad_id
     and am.date = g.rep_date
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
      g.impressions, g.clicks, g.inline_link_clicks, g.spend, g.lpv, g.plays, g.thruplays,
      g.hook_wsum, g.hold_rate_wsum, g.video_watched_p50_wsum, g.video_watched_p75_wsum,
      g.scroll_stop_wsum, g.reach, g.frequency_wsum,
      case when v_group_by = 'campaign_id' then g.adset_count else g.ad_id_count end as ad_count,
      -- Chave do histograma normalizada (80.0 → "80"); a v116 mandava o array cru.
      coalesce(lg.leadscore_histogram, '{}'::jsonb) as leadscore_histogram,
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
      end as has_transcription
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
      select true as has_transcription
      from public.ad_transcriptions t
      where v_group_by in ('ad_name', 'ad_id')
        and t.user_id = any(v_owners)
        and t.ad_name = coalesce(nullif(g.rep_ad_name, ''), g.rep_ad_id)
        and t.status = 'completed'
      limit 1
    ) tr on true
    left join leads_by_group lg
      on lg.group_key = g.group_key
    left join public.ads ra
      on ra.user_id = g.rep_user_id
     and ra.ad_id = g.rep_ad_id
    left join lateral (
      -- v116: tags do ATOR (p_user_id), só nos níveis de criativo/anúncio.
      select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'color', t.color) order by t.name, t.id) as tags
      from public.ad_tags atg
      join public.tags t on t.id = atg.tag_id and t.user_id = p_user_id
      where v_group_by in ('ad_name', 'ad_id')
        and atg.user_id = p_user_id
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
    join public.ad_performance_daily d
      on d.user_id = k.user_id and d.ad_id = k.ad_id and d.date = k.date
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
          select 1 from public.ad_metrics am
          where am.user_id = k.user_id and am.ad_id = k.ad_id and am.date = k.date
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
        'conversions', pr.conversions,
        'ad_count', pr.ad_count,
        'thumbnail', case
          when v_group_by in ('ad_name', 'ad_id') and pr.thumb_storage_path is not null then null
          else pr.thumbnail
        end,
        'thumb_storage_path', pr.thumb_storage_path,
        'adcreatives_videos_thumbs', pr.adcreatives_videos_thumbs,
        'media_type', pr.media_type,
        'has_transcription', pr.has_transcription
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


ALTER FUNCTION public.fetch_manager_performance_base_v137(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text) OWNER TO postgres;

--
-- Name: fetch_manager_performance_series_v131(uuid, date, date, text, uuid[], text[], text, text, text, text, text[], integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.fetch_manager_performance_series_v131(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text DEFAULT 'ad_name'::text, p_pack_ids uuid[] DEFAULT NULL::uuid[], p_account_ids text[] DEFAULT NULL::text[], p_campaign_name_contains text DEFAULT NULL::text, p_adset_name_contains text DEFAULT NULL::text, p_ad_name_contains text DEFAULT NULL::text, p_action_type text DEFAULT NULL::text, p_group_keys text[] DEFAULT NULL::text[], p_window integer DEFAULT 5) RETURNS jsonb
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
      apm.metric_date as date,
      (array_agg(apm.user_id order by (apm.user_id = p_user_id), apm.user_id))[1] as user_id
    from unnest(v_owners) as o(owner_id)
    join public.ad_metric_pack_map apm
      on apm.user_id = o.owner_id
     and apm.pack_id = any(p_pack_ids)
     and apm.metric_date >= v_axis_start
     and apm.metric_date <= v_date_stop
    where p_pack_ids is not null
    group by apm.ad_id, apm.metric_date

    union all

    select am.ad_id, am.date, am.user_id
    from public.ad_metrics am
    where p_pack_ids is null
      and am.user_id = p_user_id
      and am.date >= v_axis_start
      and am.date <= v_date_stop
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
    join public.ad_performance_daily d
      on d.user_id = k.user_id
     and d.ad_id = k.ad_id
     and d.date = k.date
    where (p_account_ids is null or d.account_id = any(p_account_ids))
      and (p_ad_name_contains is null or p_ad_name_contains = ''
           or coalesce(d.ad_name, '') ilike '%' || p_ad_name_contains || '%')
      and (
        (coalesce(p_campaign_name_contains, '') = '' and coalesce(p_adset_name_contains, '') = '')
        or exists (
          select 1 from public.ad_metrics am
          where am.user_id = k.user_id and am.ad_id = k.ad_id and am.date = k.date
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


ALTER FUNCTION public.fetch_manager_performance_series_v131(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_group_keys text[], p_window integer) OWNER TO postgres;

--
-- Name: FUNCTION fetch_manager_performance_series_v131(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_group_keys text[], p_window integer); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.fetch_manager_performance_series_v131(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_group_keys text[], p_window integer) IS 'Série diária do Manager (sparklines) sobre o read model ad_performance_daily (migration 131): lê só a janela pedida, sem JSON nem arrays crus de leadscore. Mesmo contrato da fetch_manager_rankings_series_v2 (que agora é wrapper desta).';


--
-- Name: fetch_manager_rankings_core_v2(uuid, date, date, text, uuid[], text[], text, text, text, text, boolean, boolean, integer, integer, text, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.fetch_manager_rankings_core_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text DEFAULT 'ad_name'::text, p_pack_ids uuid[] DEFAULT NULL::uuid[], p_account_ids text[] DEFAULT NULL::text[], p_campaign_name_contains text DEFAULT NULL::text, p_adset_name_contains text DEFAULT NULL::text, p_ad_name_contains text DEFAULT NULL::text, p_action_type text DEFAULT NULL::text, p_include_leadscore boolean DEFAULT true, p_include_available_conversion_types boolean DEFAULT true, p_limit integer DEFAULT 500, p_offset integer DEFAULT 0, p_order_by text DEFAULT 'spend'::text, p_campaign_id text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_group_by text := lower(coalesce(p_group_by, 'ad_name'));
  v_payload jsonb;
  v_data jsonb := '[]'::jsonb;
begin
  select public.fetch_manager_performance_base_v137(
    p_user_id, p_date_start, p_date_stop, p_group_by, p_pack_ids, p_account_ids,
    p_campaign_name_contains, p_adset_name_contains, p_ad_name_contains, p_action_type,
    p_include_leadscore, p_include_available_conversion_types, p_limit, p_offset,
    p_order_by, p_campaign_id
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


ALTER FUNCTION public.fetch_manager_rankings_core_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text) OWNER TO postgres;

--
-- Name: fetch_manager_rankings_core_v2_base_v093(uuid, date, date, text, uuid[], text[], text, text, text, text, boolean, boolean, integer, integer, text, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.fetch_manager_rankings_core_v2_base_v093(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text DEFAULT 'ad_name'::text, p_pack_ids uuid[] DEFAULT NULL::uuid[], p_account_ids text[] DEFAULT NULL::text[], p_campaign_name_contains text DEFAULT NULL::text, p_adset_name_contains text DEFAULT NULL::text, p_ad_name_contains text DEFAULT NULL::text, p_action_type text DEFAULT NULL::text, p_include_leadscore boolean DEFAULT true, p_include_available_conversion_types boolean DEFAULT true, p_limit integer DEFAULT 500, p_offset integer DEFAULT 0, p_order_by text DEFAULT 'spend'::text, p_campaign_id text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    SET plan_cache_mode TO 'force_custom_plan'
    AS $$
declare
  v_group_by text := lower(coalesce(p_group_by, 'ad_name'));
  v_order_by text := lower(coalesce(p_order_by, 'spend'));
  v_date_start date := least(p_date_start, p_date_stop);
  v_date_stop date := greatest(p_date_start, p_date_stop);
  v_limit integer := greatest(1, least(coalesce(p_limit, 500), 10000));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
  v_selected_key text := trim(coalesce(p_action_type, ''));
  v_action_source text := null;
  v_action_name text := null;
  v_include_conv_types boolean := coalesce(p_include_available_conversion_types, true);
  v_result jsonb;
begin
  if auth.uid() is distinct from p_user_id then
    raise exception 'Forbidden: p_user_id must match auth.uid()'
      using errcode = '42501';
  end if;

  if v_group_by not in ('ad_id', 'ad_name', 'adset_id', 'campaign_id') then
    raise exception 'Invalid p_group_by: %, expected ad_id|ad_name|adset_id|campaign_id', v_group_by
      using errcode = '22023';
  end if;

  if v_selected_key like 'conversion:%' then
    v_action_source := 'conversion';
    v_action_name := nullif(substring(v_selected_key from 12), '');
  elsif v_selected_key like 'action:%' then
    v_action_source := 'action';
    v_action_name := nullif(substring(v_selected_key from 8), '');
  elsif v_selected_key <> '' then
    v_action_source := 'conversion';
    v_action_name := v_selected_key;
    v_selected_key := 'conversion:' || v_selected_key;
  end if;

  with base_candidates as (
    select am.*
    from public.ad_metrics am
    where am.user_id = p_user_id
      and am.date >= v_date_start
      and am.date <= v_date_stop
      and (
        p_pack_ids is null
        or exists (
          select 1
          from public.ad_metric_pack_map apm
          where apm.user_id = am.user_id
            and apm.ad_id = am.ad_id
            and apm.metric_date = am.date
            and apm.pack_id = any(p_pack_ids)
        )
      )
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
  base as (
    select distinct on (am.user_id, am.ad_id, am.date)
      am.*
    from base_candidates am
    order by
      am.user_id,
      am.ad_id,
      am.date,
      am.updated_at desc nulls last,
      am.created_at desc nulls last,
      am.id desc
  ),
  typed as (
    select
      case
        when v_group_by = 'ad_id' then am.ad_id
        when v_group_by = 'ad_name' then coalesce(nullif(am.ad_name, ''), am.ad_id)
        when v_group_by = 'adset_id' then am.adset_id
        when v_group_by = 'campaign_id' then am.campaign_id
        else am.ad_id
      end as group_key,
      -- v093: `date` sobe até `filtered` para permitir o join por (ad_id, metric_date) do pack_agg.
      am.date,
      am.account_id,
      am.campaign_id,
      am.campaign_name,
      am.adset_id,
      am.adset_name,
      am.ad_id,
      am.ad_name,
      coalesce(am.impressions, 0)::bigint as impressions,
      coalesce(am.clicks, 0)::bigint as clicks,
      coalesce(am.inline_link_clicks, 0)::bigint as inline_link_clicks,
      coalesce(am.spend, 0)::numeric as spend,
      coalesce(am.lpv, 0)::bigint as lpv,
      coalesce(am.video_total_plays, 0)::bigint as plays,
      coalesce(am.video_total_thruplays, 0)::bigint as thruplays,
      coalesce(am.video_watched_p50, 0)::numeric as video_watched_p50,
      coalesce(am.video_watched_p75, 0)::numeric as video_watched_p75,
      coalesce(am.hold_rate, 0)::numeric as hold_rate,
      coalesce(am.reach, 0)::bigint as reach,
      coalesce(am.frequency, 0)::numeric as frequency,
      coalesce(am.leadscore_values, '{}'::numeric[]) as leadscore_values,
      case when jsonb_typeof(am.conversions) = 'array' then am.conversions else '[]'::jsonb end as conversions_json,
      case when jsonb_typeof(am.actions) = 'array' then am.actions else '[]'::jsonb end as actions_json,
      coalesce(
        am.hook_rate,
        case
          when jsonb_typeof(am.video_play_curve_actions) = 'array'
           and jsonb_array_length(am.video_play_curve_actions) > 0
          then (
            coalesce(
              nullif(
                regexp_replace(
                  coalesce(
                    am.video_play_curve_actions ->> least(3, jsonb_array_length(am.video_play_curve_actions) - 1),
                    '0'
                  ),
                  '[^0-9.-]',
                  '',
                  'g'
                ),
                ''
              ),
              '0'
            )::numeric
          ) / (case when coalesce(
              nullif(
                regexp_replace(
                  coalesce(
                    am.video_play_curve_actions ->> least(3, jsonb_array_length(am.video_play_curve_actions) - 1),
                    '0'
                  ),
                  '[^0-9.-]',
                  '',
                  'g'
                ),
                ''
              ),
              '0'
            )::numeric > 1 then 100.0 else 1.0 end)
          else 0::numeric
        end
      ) as hook_value,
      coalesce(
        am.scroll_stop_rate,
        case
          when jsonb_typeof(am.video_play_curve_actions) = 'array'
           and jsonb_array_length(am.video_play_curve_actions) > 0
          then (
            coalesce(
              nullif(
                regexp_replace(
                  coalesce(
                    am.video_play_curve_actions ->> least(1, jsonb_array_length(am.video_play_curve_actions) - 1),
                    '0'
                  ),
                  '[^0-9.-]',
                  '',
                  'g'
                ),
                ''
              ),
              '0'
            )::numeric
          ) / (case when coalesce(
              nullif(
                regexp_replace(
                  coalesce(
                    am.video_play_curve_actions ->> least(1, jsonb_array_length(am.video_play_curve_actions) - 1),
                    '0'
                  ),
                  '[^0-9.-]',
                  '',
                  'g'
                ),
                ''
              ),
              '0'
            )::numeric > 1 then 100.0 else 1.0 end)
          else 0::numeric
        end
      ) as scroll_stop_value
    from base am
  ),
  filtered as (
    select *
    from typed
    where nullif(group_key, '') is not null
  ),
  group_agg as (
    select
      f.group_key,
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
      count(distinct f.ad_id)::integer as ad_id_count,
      count(distinct nullif(f.adset_id, ''))::integer as adset_count,
      -- v093: TODAS as contas do grupo. Diferente de rep.account_id (uma conta arbitrária:
      -- a do ad de maior impressões), que mentiria numa linha por ad_name que colapsa contas.
      coalesce(
        array_agg(distinct f.account_id) filter (where nullif(f.account_id, '') is not null),
        array[]::text[]
      ) as account_ids
    from filtered f
    group by f.group_key
  ),
  -- v093: packs de onde vieram as métricas do grupo. Join indexado por
  -- (user_id, ad_id, metric_date) — ad_metric_pack_map_user_ad_date_idx.
  pack_agg as (
    select
      f.group_key,
      array_agg(distinct apm.pack_id) as pack_ids
    from filtered f
    join public.ad_metric_pack_map apm
      on apm.user_id = p_user_id
     and apm.ad_id = f.ad_id
     and apm.metric_date = f.date
    where p_pack_ids is null
       or apm.pack_id = any(p_pack_ids)
    group by f.group_key
  ),
  rep as (
    select distinct on (f.group_key)
      f.group_key,
      f.account_id,
      f.campaign_id,
      f.campaign_name,
      f.adset_id,
      f.adset_name,
      f.ad_id as rep_ad_id,
      f.ad_name as rep_ad_name
    from filtered f
    order by f.group_key, f.impressions desc, f.ad_id desc
  ),
  status_rows as (
    select distinct f.group_key, f.ad_id
    from filtered f
  ),
  status_agg as (
    select
      sr.group_key,
      bool_or(upper(coalesce(a.effective_status, '')) = 'ACTIVE') as has_active,
      count(distinct sr.ad_id) filter (where upper(coalesce(a.effective_status, '')) = 'ACTIVE')::integer as active_count,
      min(a.effective_status) filter (where nullif(a.effective_status, '') is not null) as fallback_status
    from status_rows sr
    left join public.ads a
      on a.user_id = p_user_id
     and a.ad_id = sr.ad_id
    group by sr.group_key
  ),
  rep_ads as (
    select
      r.group_key,
      a.effective_status as rep_status,
      coalesce(
        nullif(a.thumbnail_url, ''),
        nullif(a.adcreatives_videos_thumbs ->> 0, '')
      ) as thumbnail,
      a.adcreatives_videos_thumbs,
      a.thumb_storage_path
    from rep r
    left join public.ads a
      on a.user_id = p_user_id
     and a.ad_id = r.rep_ad_id
  ),
  selected_results as (
    select
      f.group_key,
      sum(
        coalesce(
          nullif(regexp_replace(coalesce(e.elem ->> 'value', '0'), '[^0-9.-]', '', 'g'), ''),
          '0'
        )::numeric
      ) as results
    from filtered f
    cross join lateral jsonb_array_elements(
      case
        when v_action_source = 'conversion' then f.conversions_json
        when v_action_source = 'action' then f.actions_json
        else '[]'::jsonb
      end
    ) e(elem)
    where v_action_source is not null
      and v_action_name is not null
      and nullif(e.elem ->> 'action_type', '') = v_action_name
    group by f.group_key
  ),
  leadscore_agg as (
    select
      f.group_key,
      array_agg(v)::numeric[] as leadscore_values
    from filtered f
    cross join lateral unnest(coalesce(f.leadscore_values, '{}'::numeric[])) v
    where coalesce(p_include_leadscore, true)
    group by f.group_key
  ),
  rows_enriched as (
    select
      g.group_key,
      r.account_id,
      g.account_ids,
      coalesce(pk.pack_ids, array[]::uuid[]) as pack_ids,
      r.campaign_id,
      r.campaign_name,
      r.adset_id,
      r.adset_name,
      r.rep_ad_id,
      r.rep_ad_name,
      case
        when v_group_by = 'campaign_id' then coalesce(nullif(r.campaign_name, ''), g.group_key)
        when v_group_by = 'adset_id' then coalesce(nullif(r.adset_name, ''), g.group_key)
        else coalesce(nullif(r.rep_ad_name, ''), r.rep_ad_id)
      end as label_name,
      case
        when v_group_by = 'campaign_id' then null
        when coalesce(st.has_active, false) then 'ACTIVE'
        else coalesce(st.fallback_status, ra.rep_status)
      end as effective_status,
      case
        when v_group_by = 'campaign_id' then null
        else coalesce(st.active_count, 0)
      end as active_count,
      g.impressions,
      g.clicks,
      g.inline_link_clicks,
      g.spend,
      g.lpv,
      g.plays,
      g.thruplays,
      g.hook_wsum,
      g.hold_rate_wsum,
      g.video_watched_p50_wsum,
      g.video_watched_p75_wsum,
      g.scroll_stop_wsum,
      g.reach,
      g.frequency_wsum,
      case
        when v_group_by = 'campaign_id' then g.adset_count
        else g.ad_id_count
      end as ad_count,
      coalesce(ls.leadscore_values, array[]::numeric[]) as leadscore_values,
      coalesce(sr.results, 0)::numeric as results,
      ra.thumbnail,
      ra.adcreatives_videos_thumbs,
      ra.thumb_storage_path
    from group_agg g
    join rep r using (group_key)
    left join pack_agg pk using (group_key)
    left join status_agg st using (group_key)
    left join rep_ads ra using (group_key)
    left join selected_results sr using (group_key)
    left join leadscore_agg ls using (group_key)
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
      case
        when v_selected_key <> '' then jsonb_build_object(v_selected_key, re.results)
        else '{}'::jsonb
      end as conversions
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
  conv_entries_all as (
    select
      'conversion:' || nullif(elem ->> 'action_type', '') as conv_key,
      coalesce(
        nullif(regexp_replace(coalesce(elem ->> 'value', '0'), '[^0-9.-]', '', 'g'), ''),
        '0'
      )::numeric as conv_value
    from filtered f
    cross join lateral jsonb_array_elements(f.conversions_json) elem
    where v_include_conv_types
      and nullif(elem ->> 'action_type', '') is not null

    union all

    select
      'action:' || nullif(elem ->> 'action_type', '') as conv_key,
      coalesce(
        nullif(regexp_replace(coalesce(elem ->> 'value', '0'), '[^0-9.-]', '', 'g'), ''),
        '0'
      )::numeric as conv_value
    from filtered f
    cross join lateral jsonb_array_elements(f.actions_json) elem
    where v_include_conv_types
      and nullif(elem ->> 'action_type', '') is not null
  ),
  available_types as (
    select coalesce(jsonb_agg(t.conv_key order by t.conv_key), '[]'::jsonb) as conv_types
    from (
      select distinct conv_key
      from conv_entries_all
    ) t
  ),
  per_action_all as (
    select
      coalesce(
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
    from (
      select conv_key, sum(conv_value)::numeric as total_results
      from conv_entries_all
      group by conv_key
    ) c
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
    select *
    from ordered
    offset v_offset
    limit v_limit
  ),
  paged as (
    select
      row_number() over () as ord,
      jsonb_build_object(
        'group_key', pr.group_key,
        'unique_id', null,
        'account_id', pr.account_id,
        'account_ids', pr.account_ids,
        'pack_ids', pr.pack_ids,
        'campaign_id', pr.campaign_id,
        'campaign_name', pr.campaign_name,
        'adset_id', pr.adset_id,
        'adset_name', pr.adset_name,
        'ad_id', pr.rep_ad_id,
        'ad_name', pr.label_name,
        'effective_status', pr.effective_status,
        'active_count', pr.active_count,
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
        'leadscore_values', case when coalesce(p_include_leadscore, true) then pr.leadscore_values else array[]::numeric[] end,
        'conversions', pr.conversions,
        'ad_count', pr.ad_count,
        'thumbnail', pr.thumbnail,
        'thumb_storage_path', pr.thumb_storage_path,
        'adcreatives_videos_thumbs', pr.adcreatives_videos_thumbs
      ) as item
    from paged_raw pr
  ),
  total_count as (
    select count(*)::integer as total
    from rows_metrics
  ),
  pagination_payload as (
    select jsonb_build_object(
      'limit', v_limit,
      'offset', v_offset,
      'total', tc.total,
      'has_more', (v_offset + v_limit) < tc.total
    ) as pagination
    from total_count tc
  )
  select jsonb_build_object(
    'data', coalesce((select jsonb_agg(p.item order by p.ord) from paged p), '[]'::jsonb),
    'available_conversion_types',
      case
        when v_include_conv_types then coalesce((select conv_types from available_types), '[]'::jsonb)
        else '[]'::jsonb
      end,
    'averages', coalesce((select averages from averages_payload), '{}'::jsonb),
    'header_aggregates', coalesce((select header_aggregates from header_payload), '{}'::jsonb),
    'pagination', coalesce((select pagination from pagination_payload), jsonb_build_object('limit', v_limit, 'offset', v_offset, 'total', 0, 'has_more', false))
  )
  into v_result;

  v_result := coalesce(v_result, jsonb_build_object(
    'data', '[]'::jsonb,
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
        case
          when jsonb_typeof(v_result->'data') = 'array' then v_result->'data'
          else '[]'::jsonb
        end
      ) with ordinality as t(item, ord)
      where coalesce(t.item->>'campaign_id', '') = trim(p_campaign_id)
    ),
    filtered_data as (
      select
        coalesce(jsonb_agg(dr.item order by dr.ord), '[]'::jsonb) as data,
        count(*)::integer as total
      from data_rows dr
    )
    select v_result || jsonb_build_object(
      'data', fd.data,
      'pagination', jsonb_build_object(
        'limit', v_limit,
        'offset', 0,
        'total', fd.total,
        'has_more', false
      )
    )
    into v_result
    from filtered_data fd;
  end if;

  return v_result;
end;
$$;


ALTER FUNCTION public.fetch_manager_rankings_core_v2_base_v093(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text) OWNER TO postgres;

--
-- Name: FUNCTION fetch_manager_rankings_core_v2_base_v093(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.fetch_manager_rankings_core_v2_base_v093(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text) IS 'Manager core v2 base v093: base v090 + procedência por linha — pack_ids (packs de origem das métricas, restritos a p_pack_ids; multi-valorado por natureza) e account_ids (todas as contas do grupo, vs account_id que é do representante).';


--
-- Name: fetch_manager_rankings_core_v2_base_v104(uuid, date, date, text, uuid[], text[], text, text, text, text, boolean, boolean, integer, integer, text, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.fetch_manager_rankings_core_v2_base_v104(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text DEFAULT 'ad_name'::text, p_pack_ids uuid[] DEFAULT NULL::uuid[], p_account_ids text[] DEFAULT NULL::text[], p_campaign_name_contains text DEFAULT NULL::text, p_adset_name_contains text DEFAULT NULL::text, p_ad_name_contains text DEFAULT NULL::text, p_action_type text DEFAULT NULL::text, p_include_leadscore boolean DEFAULT true, p_include_available_conversion_types boolean DEFAULT true, p_limit integer DEFAULT 500, p_offset integer DEFAULT 0, p_order_by text DEFAULT 'spend'::text, p_campaign_id text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    SET plan_cache_mode TO 'force_custom_plan'
    AS $$
declare
  v_group_by text := lower(coalesce(p_group_by, 'ad_name'));
  v_order_by text := lower(coalesce(p_order_by, 'spend'));
  v_date_start date := least(p_date_start, p_date_stop);
  v_date_stop date := greatest(p_date_start, p_date_stop);
  v_limit integer := greatest(1, least(coalesce(p_limit, 500), 10000));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
  v_selected_key text := trim(coalesce(p_action_type, ''));
  v_action_source text := null;
  v_action_name text := null;
  v_include_conv_types boolean := coalesce(p_include_available_conversion_types, true);
  v_result jsonb;
  v_owners uuid[];
  v_requested integer;
begin
  -- p_user_id identifica o ATOR (quem pergunta), nao mais o dono do dado.
  -- Assinatura preservada de proposito: mudar a lista de parametros criaria
  -- ambiguidade de overload no PostgREST — a armadilha que a 095 teve que limpar.
  if auth.uid() is distinct from p_user_id then
    raise exception 'Forbidden: p_user_id must match auth.uid()'
      using errcode = '42501';
  end if;

  -- Os donos do dado saem dos packs pedidos, nao do parametro. Pack inacessivel
  -- nao volta do resolvedor, entao a contagem denuncia: falhar aqui e melhor que
  -- devolver agregado silenciosamente incompleto.
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

  if v_selected_key like 'conversion:%' then
    v_action_source := 'conversion';
    v_action_name := nullif(substring(v_selected_key from 12), '');
  elsif v_selected_key like 'action:%' then
    v_action_source := 'action';
    v_action_name := nullif(substring(v_selected_key from 8), '');
  elsif v_selected_key <> '' then
    v_action_source := 'conversion';
    v_action_name := v_selected_key;
    v_selected_key := 'conversion:' || v_selected_key;
  end if;

  -- v104: a query passa a ser DIRIGIDA pelos donos resolvidos, em vez de filtrar
  -- ad_metrics por um user_id escalar. Medido: `am.user_id = any(v_owners)` faria
  -- o planner perder ad_metric_pack_map_user_pack_date_ad_idx e cair no PK varrendo
  -- todos os user_ids — 67ms -> 4010ms. Dirigindo a partir dos donos, o nested loop
  -- liga as 4 colunas do indice composto: 67ms -> 11ms num dono, 197ms/22.9k linhas
  -- em dois silos.
  --
  -- O ramo legado (p_pack_ids nulo, sem map para dirigir) fica num UNION ALL cujo
  -- ramo morto o planner poda por completo — verificado no EXPLAIN.
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
    join public.ad_metric_pack_map apm
      on apm.user_id = o.owner_id
     and apm.pack_id = any(p_pack_ids)
     and apm.metric_date >= v_date_start
     and apm.metric_date <= v_date_stop
    join public.ad_metrics am
      on am.user_id = apm.user_id
     and am.ad_id = apm.ad_id
     and am.date = apm.metric_date
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
  -- v104: dedup CROSS-SILO. O mesmo anuncio/dia pode existir em dois silos quando
  -- o convidado tambem carregou os mesmos anuncios (o passivo do jeito antigo) —
  -- somar os dois contaria o spend em dobro. Custo zero: o Postgres ja eliminava
  -- user_id da chave de ordenacao por ser constante.
  -- Preferencia: vence o silo do DONO do pack compartilhado (o ator perde), com
  -- desempate por uuid. Estavel entre refreshes; "mais recente" faria o numero oscilar.
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
  typed as (
    select
      am.user_id,
      case
        when v_group_by = 'ad_id' then am.ad_id
        when v_group_by = 'ad_name' then coalesce(nullif(am.ad_name, ''), am.ad_id)
        when v_group_by = 'adset_id' then am.adset_id
        when v_group_by = 'campaign_id' then am.campaign_id
        else am.ad_id
      end as group_key,
      -- v093: `date` sobe até `filtered` para permitir o join por (ad_id, metric_date) do pack_agg.
      am.date,
      am.account_id,
      am.campaign_id,
      am.campaign_name,
      am.adset_id,
      am.adset_name,
      am.ad_id,
      am.ad_name,
      coalesce(am.impressions, 0)::bigint as impressions,
      coalesce(am.clicks, 0)::bigint as clicks,
      coalesce(am.inline_link_clicks, 0)::bigint as inline_link_clicks,
      coalesce(am.spend, 0)::numeric as spend,
      coalesce(am.lpv, 0)::bigint as lpv,
      coalesce(am.video_total_plays, 0)::bigint as plays,
      coalesce(am.video_total_thruplays, 0)::bigint as thruplays,
      coalesce(am.video_watched_p50, 0)::numeric as video_watched_p50,
      coalesce(am.video_watched_p75, 0)::numeric as video_watched_p75,
      coalesce(am.hold_rate, 0)::numeric as hold_rate,
      coalesce(am.reach, 0)::bigint as reach,
      coalesce(am.frequency, 0)::numeric as frequency,
      coalesce(am.leadscore_values, '{}'::numeric[]) as leadscore_values,
      case when jsonb_typeof(am.conversions) = 'array' then am.conversions else '[]'::jsonb end as conversions_json,
      case when jsonb_typeof(am.actions) = 'array' then am.actions else '[]'::jsonb end as actions_json,
      coalesce(
        am.hook_rate,
        case
          when jsonb_typeof(am.video_play_curve_actions) = 'array'
           and jsonb_array_length(am.video_play_curve_actions) > 0
          then (
            coalesce(
              nullif(
                regexp_replace(
                  coalesce(
                    am.video_play_curve_actions ->> least(3, jsonb_array_length(am.video_play_curve_actions) - 1),
                    '0'
                  ),
                  '[^0-9.-]',
                  '',
                  'g'
                ),
                ''
              ),
              '0'
            )::numeric
          ) / (case when coalesce(
              nullif(
                regexp_replace(
                  coalesce(
                    am.video_play_curve_actions ->> least(3, jsonb_array_length(am.video_play_curve_actions) - 1),
                    '0'
                  ),
                  '[^0-9.-]',
                  '',
                  'g'
                ),
                ''
              ),
              '0'
            )::numeric > 1 then 100.0 else 1.0 end)
          else 0::numeric
        end
      ) as hook_value,
      coalesce(
        am.scroll_stop_rate,
        case
          when jsonb_typeof(am.video_play_curve_actions) = 'array'
           and jsonb_array_length(am.video_play_curve_actions) > 0
          then (
            coalesce(
              nullif(
                regexp_replace(
                  coalesce(
                    am.video_play_curve_actions ->> least(1, jsonb_array_length(am.video_play_curve_actions) - 1),
                    '0'
                  ),
                  '[^0-9.-]',
                  '',
                  'g'
                ),
                ''
              ),
              '0'
            )::numeric
          ) / (case when coalesce(
              nullif(
                regexp_replace(
                  coalesce(
                    am.video_play_curve_actions ->> least(1, jsonb_array_length(am.video_play_curve_actions) - 1),
                    '0'
                  ),
                  '[^0-9.-]',
                  '',
                  'g'
                ),
                ''
              ),
              '0'
            )::numeric > 1 then 100.0 else 1.0 end)
          else 0::numeric
        end
      ) as scroll_stop_value
    from base am
  ),
  filtered as (
    select *
    from typed
    where nullif(group_key, '') is not null
  ),
  group_agg as (
    select
      f.group_key,
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
      count(distinct f.ad_id)::integer as ad_id_count,
      count(distinct nullif(f.adset_id, ''))::integer as adset_count,
      -- v093: TODAS as contas do grupo. Diferente de rep.account_id (uma conta arbitrária:
      -- a do ad de maior impressões), que mentiria numa linha por ad_name que colapsa contas.
      coalesce(
        array_agg(distinct f.account_id) filter (where nullif(f.account_id, '') is not null),
        array[]::text[]
      ) as account_ids
    from filtered f
    group by f.group_key
  ),
  -- v093: packs de onde vieram as métricas do grupo. Join indexado por
  -- (user_id, ad_id, metric_date) — ad_metric_pack_map_user_ad_date_idx.
  pack_agg as (
    select
      f.group_key,
      array_agg(distinct apm.pack_id) as pack_ids
    from filtered f
    join public.ad_metric_pack_map apm
      on apm.user_id = f.user_id
     and apm.ad_id = f.ad_id
     and apm.metric_date = f.date
    where p_pack_ids is null
       or apm.pack_id = any(p_pack_ids)
    group by f.group_key
  ),
  rep as (
    select distinct on (f.group_key)
      f.group_key,
      f.account_id,
      f.campaign_id,
      f.campaign_name,
      f.adset_id,
      f.adset_name,
      f.user_id as rep_user_id,
      f.ad_id as rep_ad_id,
      f.ad_name as rep_ad_name
    from filtered f
    order by f.group_key, f.impressions desc, f.ad_id desc
  ),
  status_rows as (
    select distinct f.group_key, f.ad_id, f.user_id
    from filtered f
  ),
  status_agg as (
    select
      sr.group_key,
      bool_or(upper(coalesce(a.effective_status, '')) = 'ACTIVE') as has_active,
      count(distinct sr.ad_id) filter (where upper(coalesce(a.effective_status, '')) = 'ACTIVE')::integer as active_count,
      min(a.effective_status) filter (where nullif(a.effective_status, '') is not null) as fallback_status
    from status_rows sr
    left join public.ads a
      on a.user_id = sr.user_id
     and a.ad_id = sr.ad_id
    group by sr.group_key
  ),
  rep_ads as (
    select
      r.group_key,
      a.effective_status as rep_status,
      coalesce(
        nullif(a.thumbnail_url, ''),
        nullif(a.adcreatives_videos_thumbs ->> 0, '')
      ) as thumbnail,
      a.adcreatives_videos_thumbs,
      a.thumb_storage_path
    from rep r
    left join public.ads a
      on a.user_id = r.rep_user_id
     and a.ad_id = r.rep_ad_id
  ),
  selected_results as (
    select
      f.group_key,
      sum(
        coalesce(
          nullif(regexp_replace(coalesce(e.elem ->> 'value', '0'), '[^0-9.-]', '', 'g'), ''),
          '0'
        )::numeric
      ) as results
    from filtered f
    cross join lateral jsonb_array_elements(
      case
        when v_action_source = 'conversion' then f.conversions_json
        when v_action_source = 'action' then f.actions_json
        else '[]'::jsonb
      end
    ) e(elem)
    where v_action_source is not null
      and v_action_name is not null
      and nullif(e.elem ->> 'action_type', '') = v_action_name
    group by f.group_key
  ),
  leadscore_agg as (
    select
      f.group_key,
      array_agg(v)::numeric[] as leadscore_values
    from filtered f
    cross join lateral unnest(coalesce(f.leadscore_values, '{}'::numeric[])) v
    where coalesce(p_include_leadscore, true)
    group by f.group_key
  ),
  rows_enriched as (
    select
      g.group_key,
      r.account_id,
      g.account_ids,
      coalesce(pk.pack_ids, array[]::uuid[]) as pack_ids,
      r.campaign_id,
      r.campaign_name,
      r.adset_id,
      r.adset_name,
      r.rep_ad_id,
      r.rep_ad_name,
      case
        when v_group_by = 'campaign_id' then coalesce(nullif(r.campaign_name, ''), g.group_key)
        when v_group_by = 'adset_id' then coalesce(nullif(r.adset_name, ''), g.group_key)
        else coalesce(nullif(r.rep_ad_name, ''), r.rep_ad_id)
      end as label_name,
      case
        when v_group_by = 'campaign_id' then null
        when coalesce(st.has_active, false) then 'ACTIVE'
        else coalesce(st.fallback_status, ra.rep_status)
      end as effective_status,
      case
        when v_group_by = 'campaign_id' then null
        else coalesce(st.active_count, 0)
      end as active_count,
      g.impressions,
      g.clicks,
      g.inline_link_clicks,
      g.spend,
      g.lpv,
      g.plays,
      g.thruplays,
      g.hook_wsum,
      g.hold_rate_wsum,
      g.video_watched_p50_wsum,
      g.video_watched_p75_wsum,
      g.scroll_stop_wsum,
      g.reach,
      g.frequency_wsum,
      case
        when v_group_by = 'campaign_id' then g.adset_count
        else g.ad_id_count
      end as ad_count,
      coalesce(ls.leadscore_values, array[]::numeric[]) as leadscore_values,
      coalesce(sr.results, 0)::numeric as results,
      ra.thumbnail,
      ra.adcreatives_videos_thumbs,
      ra.thumb_storage_path
    from group_agg g
    join rep r using (group_key)
    left join pack_agg pk using (group_key)
    left join status_agg st using (group_key)
    left join rep_ads ra using (group_key)
    left join selected_results sr using (group_key)
    left join leadscore_agg ls using (group_key)
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
      case
        when v_selected_key <> '' then jsonb_build_object(v_selected_key, re.results)
        else '{}'::jsonb
      end as conversions
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
  conv_entries_all as (
    select
      'conversion:' || nullif(elem ->> 'action_type', '') as conv_key,
      coalesce(
        nullif(regexp_replace(coalesce(elem ->> 'value', '0'), '[^0-9.-]', '', 'g'), ''),
        '0'
      )::numeric as conv_value
    from filtered f
    cross join lateral jsonb_array_elements(f.conversions_json) elem
    where v_include_conv_types
      and nullif(elem ->> 'action_type', '') is not null

    union all

    select
      'action:' || nullif(elem ->> 'action_type', '') as conv_key,
      coalesce(
        nullif(regexp_replace(coalesce(elem ->> 'value', '0'), '[^0-9.-]', '', 'g'), ''),
        '0'
      )::numeric as conv_value
    from filtered f
    cross join lateral jsonb_array_elements(f.actions_json) elem
    where v_include_conv_types
      and nullif(elem ->> 'action_type', '') is not null
  ),
  available_types as (
    select coalesce(jsonb_agg(t.conv_key order by t.conv_key), '[]'::jsonb) as conv_types
    from (
      select distinct conv_key
      from conv_entries_all
    ) t
  ),
  per_action_all as (
    select
      coalesce(
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
    from (
      select conv_key, sum(conv_value)::numeric as total_results
      from conv_entries_all
      group by conv_key
    ) c
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
    select *
    from ordered
    offset v_offset
    limit v_limit
  ),
  paged as (
    select
      row_number() over () as ord,
      jsonb_build_object(
        'group_key', pr.group_key,
        'unique_id', null,
        'account_id', pr.account_id,
        'account_ids', pr.account_ids,
        'pack_ids', pr.pack_ids,
        'campaign_id', pr.campaign_id,
        'campaign_name', pr.campaign_name,
        'adset_id', pr.adset_id,
        'adset_name', pr.adset_name,
        'ad_id', pr.rep_ad_id,
        'ad_name', pr.label_name,
        'effective_status', pr.effective_status,
        'active_count', pr.active_count,
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
        'leadscore_values', case when coalesce(p_include_leadscore, true) then pr.leadscore_values else array[]::numeric[] end,
        'conversions', pr.conversions,
        'ad_count', pr.ad_count,
        'thumbnail', pr.thumbnail,
        'thumb_storage_path', pr.thumb_storage_path,
        'adcreatives_videos_thumbs', pr.adcreatives_videos_thumbs
      ) as item
    from paged_raw pr
  ),
  total_count as (
    select count(*)::integer as total
    from rows_metrics
  ),
  pagination_payload as (
    select jsonb_build_object(
      'limit', v_limit,
      'offset', v_offset,
      'total', tc.total,
      'has_more', (v_offset + v_limit) < tc.total
    ) as pagination
    from total_count tc
  )
  select jsonb_build_object(
    'data', coalesce((select jsonb_agg(p.item order by p.ord) from paged p), '[]'::jsonb),
    'available_conversion_types',
      case
        when v_include_conv_types then coalesce((select conv_types from available_types), '[]'::jsonb)
        else '[]'::jsonb
      end,
    'averages', coalesce((select averages from averages_payload), '{}'::jsonb),
    'header_aggregates', coalesce((select header_aggregates from header_payload), '{}'::jsonb),
    'pagination', coalesce((select pagination from pagination_payload), jsonb_build_object('limit', v_limit, 'offset', v_offset, 'total', 0, 'has_more', false))
  )
  into v_result;

  v_result := coalesce(v_result, jsonb_build_object(
    'data', '[]'::jsonb,
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
        case
          when jsonb_typeof(v_result->'data') = 'array' then v_result->'data'
          else '[]'::jsonb
        end
      ) with ordinality as t(item, ord)
      where coalesce(t.item->>'campaign_id', '') = trim(p_campaign_id)
    ),
    filtered_data as (
      select
        coalesce(jsonb_agg(dr.item order by dr.ord), '[]'::jsonb) as data,
        count(*)::integer as total
      from data_rows dr
    )
    select v_result || jsonb_build_object(
      'data', fd.data,
      'pagination', jsonb_build_object(
        'limit', v_limit,
        'offset', 0,
        'total', fd.total,
        'has_more', false
      )
    )
    into v_result
    from filtered_data fd;
  end if;

  return v_result;
end;
$$;


ALTER FUNCTION public.fetch_manager_rankings_core_v2_base_v104(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text) OWNER TO postgres;

--
-- Name: fetch_manager_rankings_core_v2_base_v105(uuid, date, date, text, uuid[], text[], text, text, text, text, boolean, boolean, integer, integer, text, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.fetch_manager_rankings_core_v2_base_v105(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text DEFAULT 'ad_name'::text, p_pack_ids uuid[] DEFAULT NULL::uuid[], p_account_ids text[] DEFAULT NULL::text[], p_campaign_name_contains text DEFAULT NULL::text, p_adset_name_contains text DEFAULT NULL::text, p_ad_name_contains text DEFAULT NULL::text, p_action_type text DEFAULT NULL::text, p_include_leadscore boolean DEFAULT true, p_include_available_conversion_types boolean DEFAULT true, p_limit integer DEFAULT 500, p_offset integer DEFAULT 0, p_order_by text DEFAULT 'spend'::text, p_campaign_id text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    SET plan_cache_mode TO 'force_custom_plan'
    AS $$
declare
  v_group_by text := lower(coalesce(p_group_by, 'ad_name'));
  v_order_by text := lower(coalesce(p_order_by, 'spend'));
  v_date_start date := least(p_date_start, p_date_stop);
  v_date_stop date := greatest(p_date_start, p_date_stop);
  v_limit integer := greatest(1, least(coalesce(p_limit, 500), 10000));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
  v_selected_key text := trim(coalesce(p_action_type, ''));
  v_action_source text := null;
  v_action_name text := null;
  v_include_conv_types boolean := coalesce(p_include_available_conversion_types, true);
  v_result jsonb;
  v_owners uuid[];
  v_requested integer;
begin
  -- p_user_id identifica o ATOR (quem pergunta), nao mais o dono do dado.
  -- Assinatura preservada de proposito: mudar a lista de parametros criaria
  -- ambiguidade de overload no PostgREST — a armadilha que a 095 teve que limpar.
  if auth.uid() is distinct from p_user_id then
    raise exception 'Forbidden: p_user_id must match auth.uid()'
      using errcode = '42501';
  end if;

  -- Os donos do dado saem dos packs pedidos, nao do parametro. Pack inacessivel
  -- nao volta do resolvedor, entao a contagem denuncia: falhar aqui e melhor que
  -- devolver agregado silenciosamente incompleto.
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

  if v_selected_key like 'conversion:%' then
    v_action_source := 'conversion';
    v_action_name := nullif(substring(v_selected_key from 12), '');
  elsif v_selected_key like 'action:%' then
    v_action_source := 'action';
    v_action_name := nullif(substring(v_selected_key from 8), '');
  elsif v_selected_key <> '' then
    v_action_source := 'conversion';
    v_action_name := v_selected_key;
    v_selected_key := 'conversion:' || v_selected_key;
  end if;

  -- v104: a query passa a ser DIRIGIDA pelos donos resolvidos, em vez de filtrar
  -- ad_metrics por um user_id escalar. Medido: `am.user_id = any(v_owners)` faria
  -- o planner perder ad_metric_pack_map_user_pack_date_ad_idx e cair no PK varrendo
  -- todos os user_ids — 67ms -> 4010ms. Dirigindo a partir dos donos, o nested loop
  -- liga as 4 colunas do indice composto: 67ms -> 11ms num dono, 197ms/22.9k linhas
  -- em dois silos.
  --
  -- O ramo legado (p_pack_ids nulo, sem map para dirigir) fica num UNION ALL cujo
  -- ramo morto o planner poda por completo — verificado no EXPLAIN.
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
    join public.ad_metric_pack_map apm
      on apm.user_id = o.owner_id
     and apm.pack_id = any(p_pack_ids)
     and apm.metric_date >= v_date_start
     and apm.metric_date <= v_date_stop
    join public.ad_metrics am
      on am.user_id = apm.user_id
     and am.ad_id = apm.ad_id
     and am.date = apm.metric_date
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
  -- v104: dedup CROSS-SILO. O mesmo anuncio/dia pode existir em dois silos quando
  -- o convidado tambem carregou os mesmos anuncios (o passivo do jeito antigo) —
  -- somar os dois contaria o spend em dobro. Custo zero: o Postgres ja eliminava
  -- user_id da chave de ordenacao por ser constante.
  -- Preferencia: vence o silo do DONO do pack compartilhado (o ator perde), com
  -- desempate por uuid. Estavel entre refreshes; "mais recente" faria o numero oscilar.
  -- v105: sinal de conflito CROSS-SILO. A mesma janela (ad_id, date) que o dedup
  -- ja ordena responde "esta linha veio de mais de um dono?" — min <> max sobre
  -- user_id. `count(distinct ...) over (...)` nao existe no Postgres; o par
  -- min/max e o jeito de perguntar "ha mais de um valor distinto?" numa janela.
  --
  -- Sobreposicao dentro do MESMO dono (dois packs proprios com anuncios em comum)
  -- e benigna e comum — existe no banco hoje. Por isso o sinal olha o DONO, nao a
  -- simples duplicidade de linha: senao o aviso dispararia para quem nunca
  -- compartilhou nada e seria aprendido como ruido.
  base as (
    select distinct on (am.ad_id, am.date)
      am.*,
      -- cast para text porque uuid nao tem agregado min/max no Postgres; a
      -- ordenacao de text sobre uuid e injetiva, entao "min <> max" continua
      -- respondendo exatamente "ha mais de um dono nesta janela?"
      (min(am.user_id::text) over (partition by am.ad_id, am.date))
        is distinct from
      (max(am.user_id::text) over (partition by am.ad_id, am.date)) as x_cross_silo
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
  typed as (
    select
      am.user_id,
      case
        when v_group_by = 'ad_id' then am.ad_id
        when v_group_by = 'ad_name' then coalesce(nullif(am.ad_name, ''), am.ad_id)
        when v_group_by = 'adset_id' then am.adset_id
        when v_group_by = 'campaign_id' then am.campaign_id
        else am.ad_id
      end as group_key,
      -- v093: `date` sobe até `filtered` para permitir o join por (ad_id, metric_date) do pack_agg.
      am.date,
      am.account_id,
      am.campaign_id,
      am.campaign_name,
      am.adset_id,
      am.adset_name,
      am.ad_id,
      am.ad_name,
      coalesce(am.impressions, 0)::bigint as impressions,
      coalesce(am.clicks, 0)::bigint as clicks,
      coalesce(am.inline_link_clicks, 0)::bigint as inline_link_clicks,
      coalesce(am.spend, 0)::numeric as spend,
      coalesce(am.lpv, 0)::bigint as lpv,
      coalesce(am.video_total_plays, 0)::bigint as plays,
      coalesce(am.video_total_thruplays, 0)::bigint as thruplays,
      coalesce(am.video_watched_p50, 0)::numeric as video_watched_p50,
      coalesce(am.video_watched_p75, 0)::numeric as video_watched_p75,
      coalesce(am.hold_rate, 0)::numeric as hold_rate,
      coalesce(am.reach, 0)::bigint as reach,
      coalesce(am.frequency, 0)::numeric as frequency,
      coalesce(am.leadscore_values, '{}'::numeric[]) as leadscore_values,
      case when jsonb_typeof(am.conversions) = 'array' then am.conversions else '[]'::jsonb end as conversions_json,
      case when jsonb_typeof(am.actions) = 'array' then am.actions else '[]'::jsonb end as actions_json,
      coalesce(
        am.hook_rate,
        case
          when jsonb_typeof(am.video_play_curve_actions) = 'array'
           and jsonb_array_length(am.video_play_curve_actions) > 0
          then (
            coalesce(
              nullif(
                regexp_replace(
                  coalesce(
                    am.video_play_curve_actions ->> least(3, jsonb_array_length(am.video_play_curve_actions) - 1),
                    '0'
                  ),
                  '[^0-9.-]',
                  '',
                  'g'
                ),
                ''
              ),
              '0'
            )::numeric
          ) / (case when coalesce(
              nullif(
                regexp_replace(
                  coalesce(
                    am.video_play_curve_actions ->> least(3, jsonb_array_length(am.video_play_curve_actions) - 1),
                    '0'
                  ),
                  '[^0-9.-]',
                  '',
                  'g'
                ),
                ''
              ),
              '0'
            )::numeric > 1 then 100.0 else 1.0 end)
          else 0::numeric
        end
      ) as hook_value,
      coalesce(
        am.scroll_stop_rate,
        case
          when jsonb_typeof(am.video_play_curve_actions) = 'array'
           and jsonb_array_length(am.video_play_curve_actions) > 0
          then (
            coalesce(
              nullif(
                regexp_replace(
                  coalesce(
                    am.video_play_curve_actions ->> least(1, jsonb_array_length(am.video_play_curve_actions) - 1),
                    '0'
                  ),
                  '[^0-9.-]',
                  '',
                  'g'
                ),
                ''
              ),
              '0'
            )::numeric
          ) / (case when coalesce(
              nullif(
                regexp_replace(
                  coalesce(
                    am.video_play_curve_actions ->> least(1, jsonb_array_length(am.video_play_curve_actions) - 1),
                    '0'
                  ),
                  '[^0-9.-]',
                  '',
                  'g'
                ),
                ''
              ),
              '0'
            )::numeric > 1 then 100.0 else 1.0 end)
          else 0::numeric
        end
      ) as scroll_stop_value
    from base am
  ),
  filtered as (
    select *
    from typed
    where nullif(group_key, '') is not null
  ),
  group_agg as (
    select
      f.group_key,
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
      count(distinct f.ad_id)::integer as ad_id_count,
      count(distinct nullif(f.adset_id, ''))::integer as adset_count,
      -- v093: TODAS as contas do grupo. Diferente de rep.account_id (uma conta arbitrária:
      -- a do ad de maior impressões), que mentiria numa linha por ad_name que colapsa contas.
      coalesce(
        array_agg(distinct f.account_id) filter (where nullif(f.account_id, '') is not null),
        array[]::text[]
      ) as account_ids
    from filtered f
    group by f.group_key
  ),
  -- v093: packs de onde vieram as métricas do grupo. Join indexado por
  -- (user_id, ad_id, metric_date) — ad_metric_pack_map_user_ad_date_idx.
  pack_agg as (
    select
      f.group_key,
      array_agg(distinct apm.pack_id) as pack_ids
    from filtered f
    join public.ad_metric_pack_map apm
      on apm.user_id = f.user_id
     and apm.ad_id = f.ad_id
     and apm.metric_date = f.date
    where p_pack_ids is null
       or apm.pack_id = any(p_pack_ids)
    group by f.group_key
  ),
  rep as (
    select distinct on (f.group_key)
      f.group_key,
      f.account_id,
      f.campaign_id,
      f.campaign_name,
      f.adset_id,
      f.adset_name,
      f.user_id as rep_user_id,
      f.ad_id as rep_ad_id,
      f.ad_name as rep_ad_name
    from filtered f
    order by f.group_key, f.impressions desc, f.ad_id desc
  ),
  status_rows as (
    select distinct f.group_key, f.ad_id, f.user_id
    from filtered f
  ),
  status_agg as (
    select
      sr.group_key,
      bool_or(upper(coalesce(a.effective_status, '')) = 'ACTIVE') as has_active,
      count(distinct sr.ad_id) filter (where upper(coalesce(a.effective_status, '')) = 'ACTIVE')::integer as active_count,
      min(a.effective_status) filter (where nullif(a.effective_status, '') is not null) as fallback_status
    from status_rows sr
    left join public.ads a
      on a.user_id = sr.user_id
     and a.ad_id = sr.ad_id
    group by sr.group_key
  ),
  rep_ads as (
    select
      r.group_key,
      a.effective_status as rep_status,
      coalesce(
        nullif(a.thumbnail_url, ''),
        nullif(a.adcreatives_videos_thumbs ->> 0, '')
      ) as thumbnail,
      a.adcreatives_videos_thumbs,
      a.thumb_storage_path
    from rep r
    left join public.ads a
      on a.user_id = r.rep_user_id
     and a.ad_id = r.rep_ad_id
  ),
  selected_results as (
    select
      f.group_key,
      sum(
        coalesce(
          nullif(regexp_replace(coalesce(e.elem ->> 'value', '0'), '[^0-9.-]', '', 'g'), ''),
          '0'
        )::numeric
      ) as results
    from filtered f
    cross join lateral jsonb_array_elements(
      case
        when v_action_source = 'conversion' then f.conversions_json
        when v_action_source = 'action' then f.actions_json
        else '[]'::jsonb
      end
    ) e(elem)
    where v_action_source is not null
      and v_action_name is not null
      and nullif(e.elem ->> 'action_type', '') = v_action_name
    group by f.group_key
  ),
  leadscore_agg as (
    select
      f.group_key,
      array_agg(v)::numeric[] as leadscore_values
    from filtered f
    cross join lateral unnest(coalesce(f.leadscore_values, '{}'::numeric[])) v
    where coalesce(p_include_leadscore, true)
    group by f.group_key
  ),
  rows_enriched as (
    select
      g.group_key,
      r.account_id,
      g.account_ids,
      coalesce(pk.pack_ids, array[]::uuid[]) as pack_ids,
      r.campaign_id,
      r.campaign_name,
      r.adset_id,
      r.adset_name,
      r.rep_ad_id,
      r.rep_ad_name,
      case
        when v_group_by = 'campaign_id' then coalesce(nullif(r.campaign_name, ''), g.group_key)
        when v_group_by = 'adset_id' then coalesce(nullif(r.adset_name, ''), g.group_key)
        else coalesce(nullif(r.rep_ad_name, ''), r.rep_ad_id)
      end as label_name,
      case
        when v_group_by = 'campaign_id' then null
        when coalesce(st.has_active, false) then 'ACTIVE'
        else coalesce(st.fallback_status, ra.rep_status)
      end as effective_status,
      case
        when v_group_by = 'campaign_id' then null
        else coalesce(st.active_count, 0)
      end as active_count,
      g.impressions,
      g.clicks,
      g.inline_link_clicks,
      g.spend,
      g.lpv,
      g.plays,
      g.thruplays,
      g.hook_wsum,
      g.hold_rate_wsum,
      g.video_watched_p50_wsum,
      g.video_watched_p75_wsum,
      g.scroll_stop_wsum,
      g.reach,
      g.frequency_wsum,
      case
        when v_group_by = 'campaign_id' then g.adset_count
        else g.ad_id_count
      end as ad_count,
      coalesce(ls.leadscore_values, array[]::numeric[]) as leadscore_values,
      coalesce(sr.results, 0)::numeric as results,
      ra.thumbnail,
      ra.adcreatives_videos_thumbs,
      ra.thumb_storage_path
    from group_agg g
    join rep r using (group_key)
    left join pack_agg pk using (group_key)
    left join status_agg st using (group_key)
    left join rep_ads ra using (group_key)
    left join selected_results sr using (group_key)
    left join leadscore_agg ls using (group_key)
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
      case
        when v_selected_key <> '' then jsonb_build_object(v_selected_key, re.results)
        else '{}'::jsonb
      end as conversions
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
  conv_entries_all as (
    select
      'conversion:' || nullif(elem ->> 'action_type', '') as conv_key,
      coalesce(
        nullif(regexp_replace(coalesce(elem ->> 'value', '0'), '[^0-9.-]', '', 'g'), ''),
        '0'
      )::numeric as conv_value
    from filtered f
    cross join lateral jsonb_array_elements(f.conversions_json) elem
    where v_include_conv_types
      and nullif(elem ->> 'action_type', '') is not null

    union all

    select
      'action:' || nullif(elem ->> 'action_type', '') as conv_key,
      coalesce(
        nullif(regexp_replace(coalesce(elem ->> 'value', '0'), '[^0-9.-]', '', 'g'), ''),
        '0'
      )::numeric as conv_value
    from filtered f
    cross join lateral jsonb_array_elements(f.actions_json) elem
    where v_include_conv_types
      and nullif(elem ->> 'action_type', '') is not null
  ),
  available_types as (
    select coalesce(jsonb_agg(t.conv_key order by t.conv_key), '[]'::jsonb) as conv_types
    from (
      select distinct conv_key
      from conv_entries_all
    ) t
  ),
  per_action_all as (
    select
      coalesce(
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
    from (
      select conv_key, sum(conv_value)::numeric as total_results
      from conv_entries_all
      group by conv_key
    ) c
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
    select *
    from ordered
    offset v_offset
    limit v_limit
  ),
  paged as (
    select
      row_number() over () as ord,
      jsonb_build_object(
        'group_key', pr.group_key,
        'unique_id', null,
        'account_id', pr.account_id,
        'account_ids', pr.account_ids,
        'pack_ids', pr.pack_ids,
        'campaign_id', pr.campaign_id,
        'campaign_name', pr.campaign_name,
        'adset_id', pr.adset_id,
        'adset_name', pr.adset_name,
        'ad_id', pr.rep_ad_id,
        'ad_name', pr.label_name,
        'effective_status', pr.effective_status,
        'active_count', pr.active_count,
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
        'leadscore_values', case when coalesce(p_include_leadscore, true) then pr.leadscore_values else array[]::numeric[] end,
        'conversions', pr.conversions,
        'ad_count', pr.ad_count,
        'thumbnail', pr.thumbnail,
        'thumb_storage_path', pr.thumb_storage_path,
        'adcreatives_videos_thumbs', pr.adcreatives_videos_thumbs
      ) as item
    from paged_raw pr
  ),
  total_count as (
    select count(*)::integer as total
    from rows_metrics
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
    select count(*)::bigint as conflict_rows
    from base b
    where b.x_cross_silo
  )
  select jsonb_build_object(
    'data', coalesce((select jsonb_agg(p.item order by p.ord) from paged p), '[]'::jsonb),
    'available_conversion_types',
      case
        when v_include_conv_types then coalesce((select conv_types from available_types), '[]'::jsonb)
        else '[]'::jsonb
      end,
    'averages', coalesce((select averages from averages_payload), '{}'::jsonb),
    'header_aggregates', coalesce((select header_aggregates from header_payload), '{}'::jsonb),
    'pagination', coalesce((select pagination from pagination_payload), jsonb_build_object('limit', v_limit, 'offset', v_offset, 'total', 0, 'has_more', false))
  )
  || case
       when coalesce((select conflict_rows from overlap_stat), 0) > 0
       then jsonb_build_object('overlap', jsonb_build_object(
              'rows', (select conflict_rows from overlap_stat)))
       else '{}'::jsonb
     end
  into v_result;

  v_result := coalesce(v_result, jsonb_build_object(
    'data', '[]'::jsonb,
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
        case
          when jsonb_typeof(v_result->'data') = 'array' then v_result->'data'
          else '[]'::jsonb
        end
      ) with ordinality as t(item, ord)
      where coalesce(t.item->>'campaign_id', '') = trim(p_campaign_id)
    ),
    filtered_data as (
      select
        coalesce(jsonb_agg(dr.item order by dr.ord), '[]'::jsonb) as data,
        count(*)::integer as total
      from data_rows dr
    )
    select v_result || jsonb_build_object(
      'data', fd.data,
      'pagination', jsonb_build_object(
        'limit', v_limit,
        'offset', 0,
        'total', fd.total,
        'has_more', false
      )
    )
    into v_result
    from filtered_data fd;
  end if;

  return v_result;
end;
$$;


ALTER FUNCTION public.fetch_manager_rankings_core_v2_base_v105(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text) OWNER TO postgres;

--
-- Name: fetch_manager_rankings_core_v2_base_v115(uuid, date, date, text, uuid[], text[], text, text, text, text, boolean, boolean, integer, integer, text, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.fetch_manager_rankings_core_v2_base_v115(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text DEFAULT 'ad_name'::text, p_pack_ids uuid[] DEFAULT NULL::uuid[], p_account_ids text[] DEFAULT NULL::text[], p_campaign_name_contains text DEFAULT NULL::text, p_adset_name_contains text DEFAULT NULL::text, p_ad_name_contains text DEFAULT NULL::text, p_action_type text DEFAULT NULL::text, p_include_leadscore boolean DEFAULT true, p_include_available_conversion_types boolean DEFAULT true, p_limit integer DEFAULT 500, p_offset integer DEFAULT 0, p_order_by text DEFAULT 'spend'::text, p_campaign_id text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    SET plan_cache_mode TO 'force_custom_plan'
    AS $$
declare
  v_group_by text := lower(coalesce(p_group_by, 'ad_name'));
  v_order_by text := lower(coalesce(p_order_by, 'spend'));
  v_date_start date := least(p_date_start, p_date_stop);
  v_date_stop date := greatest(p_date_start, p_date_stop);
  v_limit integer := greatest(1, least(coalesce(p_limit, 500), 10000));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
  v_selected_key text := trim(coalesce(p_action_type, ''));
  v_action_source text := null;
  v_action_name text := null;
  v_include_conv_types boolean := coalesce(p_include_available_conversion_types, true);
  v_result jsonb;
  v_owners uuid[];
  v_requested integer;
begin
  -- p_user_id identifica o ATOR (quem pergunta), nao mais o dono do dado.
  -- Assinatura preservada de proposito: mudar a lista de parametros criaria
  -- ambiguidade de overload no PostgREST — a armadilha que a 095 teve que limpar.
  if auth.uid() is distinct from p_user_id then
    raise exception 'Forbidden: p_user_id must match auth.uid()'
      using errcode = '42501';
  end if;

  -- Os donos do dado saem dos packs pedidos, nao do parametro. Pack inacessivel
  -- nao volta do resolvedor, entao a contagem denuncia: falhar aqui e melhor que
  -- devolver agregado silenciosamente incompleto.
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

  if v_selected_key like 'conversion:%' then
    v_action_source := 'conversion';
    v_action_name := nullif(substring(v_selected_key from 12), '');
  elsif v_selected_key like 'action:%' then
    v_action_source := 'action';
    v_action_name := nullif(substring(v_selected_key from 8), '');
  elsif v_selected_key <> '' then
    v_action_source := 'conversion';
    v_action_name := v_selected_key;
    v_selected_key := 'conversion:' || v_selected_key;
  end if;

  -- v104: a query passa a ser DIRIGIDA pelos donos resolvidos, em vez de filtrar
  -- ad_metrics por um user_id escalar. Medido: `am.user_id = any(v_owners)` faria
  -- o planner perder ad_metric_pack_map_user_pack_date_ad_idx e cair no PK varrendo
  -- todos os user_ids — 67ms -> 4010ms. Dirigindo a partir dos donos, o nested loop
  -- liga as 4 colunas do indice composto: 67ms -> 11ms num dono, 197ms/22.9k linhas
  -- em dois silos.
  --
  -- O ramo legado (p_pack_ids nulo, sem map para dirigir) fica num UNION ALL cujo
  -- ramo morto o planner poda por completo — verificado no EXPLAIN.
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
    join public.ad_metric_pack_map apm
      on apm.user_id = o.owner_id
     and apm.pack_id = any(p_pack_ids)
     and apm.metric_date >= v_date_start
     and apm.metric_date <= v_date_stop
    join public.ad_metrics am
      on am.user_id = apm.user_id
     and am.ad_id = apm.ad_id
     and am.date = apm.metric_date
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
  -- v104: dedup CROSS-SILO. O mesmo anuncio/dia pode existir em dois silos quando
  -- o convidado tambem carregou os mesmos anuncios (o passivo do jeito antigo) —
  -- somar os dois contaria o spend em dobro. Custo zero: o Postgres ja eliminava
  -- user_id da chave de ordenacao por ser constante.
  -- Preferencia: vence o silo do DONO do pack compartilhado (o ator perde), com
  -- desempate por uuid. Estavel entre refreshes; "mais recente" faria o numero oscilar.
  -- v105: sinal de conflito CROSS-SILO. A mesma janela (ad_id, date) que o dedup
  -- ja ordena responde "esta linha veio de mais de um dono?" — min <> max sobre
  -- user_id. `count(distinct ...) over (...)` nao existe no Postgres; o par
  -- min/max e o jeito de perguntar "ha mais de um valor distinto?" numa janela.
  --
  -- Sobreposicao dentro do MESMO dono (dois packs proprios com anuncios em comum)
  -- e benigna e comum — existe no banco hoje. Por isso o sinal olha o DONO, nao a
  -- simples duplicidade de linha: senao o aviso dispararia para quem nunca
  -- compartilhou nada e seria aprendido como ruido.
  base as (
    select distinct on (am.ad_id, am.date)
      am.*,
      -- cast para text porque uuid nao tem agregado min/max no Postgres; a
      -- ordenacao de text sobre uuid e injetiva, entao "min <> max" continua
      -- respondendo exatamente "ha mais de um dono nesta janela?"
      (min(am.user_id::text) over (partition by am.ad_id, am.date))
        is distinct from
      (max(am.user_id::text) over (partition by am.ad_id, am.date)) as x_cross_silo
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
  typed as (
    select
      am.user_id,
      case
        when v_group_by = 'ad_id' then am.ad_id
        when v_group_by = 'ad_name' then coalesce(nullif(am.ad_name, ''), am.ad_id)
        when v_group_by = 'adset_id' then am.adset_id
        when v_group_by = 'campaign_id' then am.campaign_id
        else am.ad_id
      end as group_key,
      -- v093: `date` sobe até `filtered` para permitir o join por (ad_id, metric_date) do pack_agg.
      am.date,
      am.account_id,
      am.campaign_id,
      am.campaign_name,
      am.adset_id,
      am.adset_name,
      am.ad_id,
      am.ad_name,
      coalesce(am.impressions, 0)::bigint as impressions,
      coalesce(am.clicks, 0)::bigint as clicks,
      coalesce(am.inline_link_clicks, 0)::bigint as inline_link_clicks,
      coalesce(am.spend, 0)::numeric as spend,
      coalesce(am.lpv, 0)::bigint as lpv,
      coalesce(am.video_total_plays, 0)::bigint as plays,
      coalesce(am.video_total_thruplays, 0)::bigint as thruplays,
      coalesce(am.video_watched_p50, 0)::numeric as video_watched_p50,
      coalesce(am.video_watched_p75, 0)::numeric as video_watched_p75,
      coalesce(am.hold_rate, 0)::numeric as hold_rate,
      coalesce(am.reach, 0)::bigint as reach,
      coalesce(am.frequency, 0)::numeric as frequency,
      coalesce(am.leadscore_values, '{}'::numeric[]) as leadscore_values,
      case when jsonb_typeof(am.conversions) = 'array' then am.conversions else '[]'::jsonb end as conversions_json,
      case when jsonb_typeof(am.actions) = 'array' then am.actions else '[]'::jsonb end as actions_json,
      coalesce(
        am.hook_rate,
        case
          when jsonb_typeof(am.video_play_curve_actions) = 'array'
           and jsonb_array_length(am.video_play_curve_actions) > 0
          then (
            coalesce(
              nullif(
                regexp_replace(
                  coalesce(
                    am.video_play_curve_actions ->> least(3, jsonb_array_length(am.video_play_curve_actions) - 1),
                    '0'
                  ),
                  '[^0-9.-]',
                  '',
                  'g'
                ),
                ''
              ),
              '0'
            )::numeric
          ) / (case when coalesce(
              nullif(
                regexp_replace(
                  coalesce(
                    am.video_play_curve_actions ->> least(3, jsonb_array_length(am.video_play_curve_actions) - 1),
                    '0'
                  ),
                  '[^0-9.-]',
                  '',
                  'g'
                ),
                ''
              ),
              '0'
            )::numeric > 1 then 100.0 else 1.0 end)
          else 0::numeric
        end
      ) as hook_value,
      coalesce(
        am.scroll_stop_rate,
        case
          when jsonb_typeof(am.video_play_curve_actions) = 'array'
           and jsonb_array_length(am.video_play_curve_actions) > 0
          then (
            coalesce(
              nullif(
                regexp_replace(
                  coalesce(
                    am.video_play_curve_actions ->> least(1, jsonb_array_length(am.video_play_curve_actions) - 1),
                    '0'
                  ),
                  '[^0-9.-]',
                  '',
                  'g'
                ),
                ''
              ),
              '0'
            )::numeric
          ) / (case when coalesce(
              nullif(
                regexp_replace(
                  coalesce(
                    am.video_play_curve_actions ->> least(1, jsonb_array_length(am.video_play_curve_actions) - 1),
                    '0'
                  ),
                  '[^0-9.-]',
                  '',
                  'g'
                ),
                ''
              ),
              '0'
            )::numeric > 1 then 100.0 else 1.0 end)
          else 0::numeric
        end
      ) as scroll_stop_value
    from base am
  ),
  filtered as (
    select *
    from typed
    where nullif(group_key, '') is not null
  ),
  group_agg as (
    select
      f.group_key,
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
      count(distinct f.ad_id)::integer as ad_id_count,
      count(distinct nullif(f.adset_id, ''))::integer as adset_count,
      -- v093: TODAS as contas do grupo. Diferente de rep.account_id (uma conta arbitrária:
      -- a do ad de maior impressões), que mentiria numa linha por ad_name que colapsa contas.
      coalesce(
        array_agg(distinct f.account_id) filter (where nullif(f.account_id, '') is not null),
        array[]::text[]
      ) as account_ids
    from filtered f
    group by f.group_key
  ),
  -- v093: packs de onde vieram as métricas do grupo. Join indexado por
  -- (user_id, ad_id, metric_date) — ad_metric_pack_map_user_ad_date_idx.
  pack_agg as (
    select
      f.group_key,
      array_agg(distinct apm.pack_id) as pack_ids
    from filtered f
    join public.ad_metric_pack_map apm
      on apm.user_id = f.user_id
     and apm.ad_id = f.ad_id
     and apm.metric_date = f.date
    where p_pack_ids is null
       or apm.pack_id = any(p_pack_ids)
    group by f.group_key
  ),
  rep as (
    select distinct on (f.group_key)
      f.group_key,
      f.account_id,
      f.campaign_id,
      f.campaign_name,
      f.adset_id,
      f.adset_name,
      f.user_id as rep_user_id,
      f.ad_id as rep_ad_id,
      f.ad_name as rep_ad_name
    from filtered f
    order by f.group_key, f.impressions desc, f.ad_id desc
  ),
  status_rows as (
    select distinct f.group_key, f.ad_id, f.user_id
    from filtered f
  ),
  status_agg as (
    select
      sr.group_key,
      bool_or(upper(coalesce(a.effective_status, '')) = 'ACTIVE') as has_active,
      count(distinct sr.ad_id) filter (where upper(coalesce(a.effective_status, '')) = 'ACTIVE')::integer as active_count,
      min(a.effective_status) filter (where nullif(a.effective_status, '') is not null) as fallback_status,
      -- v115: data de criacao no Meta. MIN porque a linha pode agregar varios ads
      -- (por ad_name/conjunto/campanha): a resposta util e "quando este grupo estreou".
      -- Reusa o join a public.ads que status_agg ja faz — nenhum join novo.
      min(a.meta_created_time) as meta_created_min
    from status_rows sr
    left join public.ads a
      on a.user_id = sr.user_id
     and a.ad_id = sr.ad_id
    group by sr.group_key
  ),
  rep_ads as (
    select
      r.group_key,
      a.effective_status as rep_status,
      coalesce(
        nullif(a.thumbnail_url, ''),
        nullif(a.adcreatives_videos_thumbs ->> 0, '')
      ) as thumbnail,
      a.adcreatives_videos_thumbs,
      a.thumb_storage_path
    from rep r
    left join public.ads a
      on a.user_id = r.rep_user_id
     and a.ad_id = r.rep_ad_id
  ),
  selected_results as (
    select
      f.group_key,
      sum(
        coalesce(
          nullif(regexp_replace(coalesce(e.elem ->> 'value', '0'), '[^0-9.-]', '', 'g'), ''),
          '0'
        )::numeric
      ) as results
    from filtered f
    cross join lateral jsonb_array_elements(
      case
        when v_action_source = 'conversion' then f.conversions_json
        when v_action_source = 'action' then f.actions_json
        else '[]'::jsonb
      end
    ) e(elem)
    where v_action_source is not null
      and v_action_name is not null
      and nullif(e.elem ->> 'action_type', '') = v_action_name
    group by f.group_key
  ),
  leadscore_agg as (
    select
      f.group_key,
      array_agg(v)::numeric[] as leadscore_values
    from filtered f
    cross join lateral unnest(coalesce(f.leadscore_values, '{}'::numeric[])) v
    where coalesce(p_include_leadscore, true)
    group by f.group_key
  ),
  rows_enriched as (
    select
      g.group_key,
      r.account_id,
      g.account_ids,
      coalesce(pk.pack_ids, array[]::uuid[]) as pack_ids,
      r.campaign_id,
      r.campaign_name,
      r.adset_id,
      r.adset_name,
      r.rep_ad_id,
      r.rep_ad_name,
      case
        when v_group_by = 'campaign_id' then coalesce(nullif(r.campaign_name, ''), g.group_key)
        when v_group_by = 'adset_id' then coalesce(nullif(r.adset_name, ''), g.group_key)
        else coalesce(nullif(r.rep_ad_name, ''), r.rep_ad_id)
      end as label_name,
      case
        when v_group_by = 'campaign_id' then null
        when coalesce(st.has_active, false) then 'ACTIVE'
        else coalesce(st.fallback_status, ra.rep_status)
      end as effective_status,
      case
        when v_group_by = 'campaign_id' then null
        else coalesce(st.active_count, 0)
      end as active_count,
      g.impressions,
      g.clicks,
      g.inline_link_clicks,
      g.spend,
      g.lpv,
      g.plays,
      g.thruplays,
      g.hook_wsum,
      g.hold_rate_wsum,
      g.video_watched_p50_wsum,
      g.video_watched_p75_wsum,
      g.scroll_stop_wsum,
      g.reach,
      g.frequency_wsum,
      case
        when v_group_by = 'campaign_id' then g.adset_count
        else g.ad_id_count
      end as ad_count,
      coalesce(ls.leadscore_values, array[]::numeric[]) as leadscore_values,
      coalesce(sr.results, 0)::numeric as results,
      st.meta_created_min,
      ra.thumbnail,
      ra.adcreatives_videos_thumbs,
      ra.thumb_storage_path
    from group_agg g
    join rep r using (group_key)
    left join pack_agg pk using (group_key)
    left join status_agg st using (group_key)
    left join rep_ads ra using (group_key)
    left join selected_results sr using (group_key)
    left join leadscore_agg ls using (group_key)
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
      case
        when v_selected_key <> '' then jsonb_build_object(v_selected_key, re.results)
        else '{}'::jsonb
      end as conversions
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
  conv_entries_all as (
    select
      'conversion:' || nullif(elem ->> 'action_type', '') as conv_key,
      coalesce(
        nullif(regexp_replace(coalesce(elem ->> 'value', '0'), '[^0-9.-]', '', 'g'), ''),
        '0'
      )::numeric as conv_value
    from filtered f
    cross join lateral jsonb_array_elements(f.conversions_json) elem
    where v_include_conv_types
      and nullif(elem ->> 'action_type', '') is not null

    union all

    select
      'action:' || nullif(elem ->> 'action_type', '') as conv_key,
      coalesce(
        nullif(regexp_replace(coalesce(elem ->> 'value', '0'), '[^0-9.-]', '', 'g'), ''),
        '0'
      )::numeric as conv_value
    from filtered f
    cross join lateral jsonb_array_elements(f.actions_json) elem
    where v_include_conv_types
      and nullif(elem ->> 'action_type', '') is not null
  ),
  available_types as (
    select coalesce(jsonb_agg(t.conv_key order by t.conv_key), '[]'::jsonb) as conv_types
    from (
      select distinct conv_key
      from conv_entries_all
    ) t
  ),
  per_action_all as (
    select
      coalesce(
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
    from (
      select conv_key, sum(conv_value)::numeric as total_results
      from conv_entries_all
      group by conv_key
    ) c
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
    select *
    from ordered
    offset v_offset
    limit v_limit
  ),
  paged as (
    select
      row_number() over () as ord,
      jsonb_build_object(
        'group_key', pr.group_key,
        'unique_id', null,
        'account_id', pr.account_id,
        'account_ids', pr.account_ids,
        'pack_ids', pr.pack_ids,
        'meta_created_time', pr.meta_created_min,
        'campaign_id', pr.campaign_id,
        'campaign_name', pr.campaign_name,
        'adset_id', pr.adset_id,
        'adset_name', pr.adset_name,
        'ad_id', pr.rep_ad_id,
        'ad_name', pr.label_name,
        'effective_status', pr.effective_status,
        'active_count', pr.active_count,
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
        'leadscore_values', case when coalesce(p_include_leadscore, true) then pr.leadscore_values else array[]::numeric[] end,
        'conversions', pr.conversions,
        'ad_count', pr.ad_count,
        'thumbnail', pr.thumbnail,
        'thumb_storage_path', pr.thumb_storage_path,
        'adcreatives_videos_thumbs', pr.adcreatives_videos_thumbs
      ) as item
    from paged_raw pr
  ),
  total_count as (
    select count(*)::integer as total
    from rows_metrics
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
    select count(*)::bigint as conflict_rows
    from base b
    where b.x_cross_silo
  )
  select jsonb_build_object(
    'data', coalesce((select jsonb_agg(p.item order by p.ord) from paged p), '[]'::jsonb),
    'available_conversion_types',
      case
        when v_include_conv_types then coalesce((select conv_types from available_types), '[]'::jsonb)
        else '[]'::jsonb
      end,
    'averages', coalesce((select averages from averages_payload), '{}'::jsonb),
    'header_aggregates', coalesce((select header_aggregates from header_payload), '{}'::jsonb),
    'pagination', coalesce((select pagination from pagination_payload), jsonb_build_object('limit', v_limit, 'offset', v_offset, 'total', 0, 'has_more', false))
  )
  || case
       when coalesce((select conflict_rows from overlap_stat), 0) > 0
       then jsonb_build_object('overlap', jsonb_build_object(
              'rows', (select conflict_rows from overlap_stat)))
       else '{}'::jsonb
     end
  into v_result;

  v_result := coalesce(v_result, jsonb_build_object(
    'data', '[]'::jsonb,
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
        case
          when jsonb_typeof(v_result->'data') = 'array' then v_result->'data'
          else '[]'::jsonb
        end
      ) with ordinality as t(item, ord)
      where coalesce(t.item->>'campaign_id', '') = trim(p_campaign_id)
    ),
    filtered_data as (
      select
        coalesce(jsonb_agg(dr.item order by dr.ord), '[]'::jsonb) as data,
        count(*)::integer as total
      from data_rows dr
    )
    select v_result || jsonb_build_object(
      'data', fd.data,
      'pagination', jsonb_build_object(
        'limit', v_limit,
        'offset', 0,
        'total', fd.total,
        'has_more', false
      )
    )
    into v_result
    from filtered_data fd;
  end if;

  return v_result;
end;
$$;


ALTER FUNCTION public.fetch_manager_rankings_core_v2_base_v115(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text) OWNER TO postgres;

--
-- Name: FUNCTION fetch_manager_rankings_core_v2_base_v115(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.fetch_manager_rankings_core_v2_base_v115(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text) IS 'Manager core v2 base v115: base v105 + meta_created_time por linha (MIN de ads.meta_created_time no grupo — data de CRIACAO no Meta, nao inicio de veiculacao). Pega carona no join a public.ads que status_agg ja faz.';


--
-- Name: fetch_manager_rankings_core_v2_base_v116(uuid, date, date, text, uuid[], text[], text, text, text, text, boolean, boolean, integer, integer, text, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.fetch_manager_rankings_core_v2_base_v116(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text DEFAULT 'ad_name'::text, p_pack_ids uuid[] DEFAULT NULL::uuid[], p_account_ids text[] DEFAULT NULL::text[], p_campaign_name_contains text DEFAULT NULL::text, p_adset_name_contains text DEFAULT NULL::text, p_ad_name_contains text DEFAULT NULL::text, p_action_type text DEFAULT NULL::text, p_include_leadscore boolean DEFAULT true, p_include_available_conversion_types boolean DEFAULT true, p_limit integer DEFAULT 500, p_offset integer DEFAULT 0, p_order_by text DEFAULT 'spend'::text, p_campaign_id text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    SET plan_cache_mode TO 'force_custom_plan'
    AS $$
declare
  v_group_by text := lower(coalesce(p_group_by, 'ad_name'));
  v_order_by text := lower(coalesce(p_order_by, 'spend'));
  v_date_start date := least(p_date_start, p_date_stop);
  v_date_stop date := greatest(p_date_start, p_date_stop);
  v_limit integer := greatest(1, least(coalesce(p_limit, 500), 10000));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
  v_selected_key text := trim(coalesce(p_action_type, ''));
  v_action_source text := null;
  v_action_name text := null;
  v_include_conv_types boolean := coalesce(p_include_available_conversion_types, true);
  v_result jsonb;
  v_owners uuid[];
  v_requested integer;
begin
  -- p_user_id identifica o ATOR (quem pergunta), nao mais o dono do dado.
  -- Assinatura preservada de proposito: mudar a lista de parametros criaria
  -- ambiguidade de overload no PostgREST — a armadilha que a 095 teve que limpar.
  if auth.uid() is distinct from p_user_id then
    raise exception 'Forbidden: p_user_id must match auth.uid()'
      using errcode = '42501';
  end if;

  -- Os donos do dado saem dos packs pedidos, nao do parametro. Pack inacessivel
  -- nao volta do resolvedor, entao a contagem denuncia: falhar aqui e melhor que
  -- devolver agregado silenciosamente incompleto.
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

  if v_selected_key like 'conversion:%' then
    v_action_source := 'conversion';
    v_action_name := nullif(substring(v_selected_key from 12), '');
  elsif v_selected_key like 'action:%' then
    v_action_source := 'action';
    v_action_name := nullif(substring(v_selected_key from 8), '');
  elsif v_selected_key <> '' then
    v_action_source := 'conversion';
    v_action_name := v_selected_key;
    v_selected_key := 'conversion:' || v_selected_key;
  end if;

  -- v104: a query passa a ser DIRIGIDA pelos donos resolvidos, em vez de filtrar
  -- ad_metrics por um user_id escalar. Medido: `am.user_id = any(v_owners)` faria
  -- o planner perder ad_metric_pack_map_user_pack_date_ad_idx e cair no PK varrendo
  -- todos os user_ids — 67ms -> 4010ms. Dirigindo a partir dos donos, o nested loop
  -- liga as 4 colunas do indice composto: 67ms -> 11ms num dono, 197ms/22.9k linhas
  -- em dois silos.
  --
  -- O ramo legado (p_pack_ids nulo, sem map para dirigir) fica num UNION ALL cujo
  -- ramo morto o planner poda por completo — verificado no EXPLAIN.
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
    join public.ad_metric_pack_map apm
      on apm.user_id = o.owner_id
     and apm.pack_id = any(p_pack_ids)
     and apm.metric_date >= v_date_start
     and apm.metric_date <= v_date_stop
    join public.ad_metrics am
      on am.user_id = apm.user_id
     and am.ad_id = apm.ad_id
     and am.date = apm.metric_date
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
  -- v104: dedup CROSS-SILO. O mesmo anuncio/dia pode existir em dois silos quando
  -- o convidado tambem carregou os mesmos anuncios (o passivo do jeito antigo) —
  -- somar os dois contaria o spend em dobro. Custo zero: o Postgres ja eliminava
  -- user_id da chave de ordenacao por ser constante.
  -- Preferencia: vence o silo do DONO do pack compartilhado (o ator perde), com
  -- desempate por uuid. Estavel entre refreshes; "mais recente" faria o numero oscilar.
  -- v105: sinal de conflito CROSS-SILO. A mesma janela (ad_id, date) que o dedup
  -- ja ordena responde "esta linha veio de mais de um dono?" — min <> max sobre
  -- user_id. `count(distinct ...) over (...)` nao existe no Postgres; o par
  -- min/max e o jeito de perguntar "ha mais de um valor distinto?" numa janela.
  --
  -- Sobreposicao dentro do MESMO dono (dois packs proprios com anuncios em comum)
  -- e benigna e comum — existe no banco hoje. Por isso o sinal olha o DONO, nao a
  -- simples duplicidade de linha: senao o aviso dispararia para quem nunca
  -- compartilhou nada e seria aprendido como ruido.
  base as (
    select distinct on (am.ad_id, am.date)
      am.*,
      -- cast para text porque uuid nao tem agregado min/max no Postgres; a
      -- ordenacao de text sobre uuid e injetiva, entao "min <> max" continua
      -- respondendo exatamente "ha mais de um dono nesta janela?"
      (min(am.user_id::text) over (partition by am.ad_id, am.date))
        is distinct from
      (max(am.user_id::text) over (partition by am.ad_id, am.date)) as x_cross_silo
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
  typed as (
    select
      am.user_id,
      case
        when v_group_by = 'ad_id' then am.ad_id
        when v_group_by = 'ad_name' then coalesce(nullif(am.ad_name, ''), am.ad_id)
        when v_group_by = 'adset_id' then am.adset_id
        when v_group_by = 'campaign_id' then am.campaign_id
        else am.ad_id
      end as group_key,
      -- v093: `date` sobe até `filtered` para permitir o join por (ad_id, metric_date) do pack_agg.
      am.date,
      am.account_id,
      am.campaign_id,
      am.campaign_name,
      am.adset_id,
      am.adset_name,
      am.ad_id,
      am.ad_name,
      coalesce(am.impressions, 0)::bigint as impressions,
      coalesce(am.clicks, 0)::bigint as clicks,
      coalesce(am.inline_link_clicks, 0)::bigint as inline_link_clicks,
      coalesce(am.spend, 0)::numeric as spend,
      coalesce(am.lpv, 0)::bigint as lpv,
      coalesce(am.video_total_plays, 0)::bigint as plays,
      coalesce(am.video_total_thruplays, 0)::bigint as thruplays,
      coalesce(am.video_watched_p50, 0)::numeric as video_watched_p50,
      coalesce(am.video_watched_p75, 0)::numeric as video_watched_p75,
      coalesce(am.hold_rate, 0)::numeric as hold_rate,
      coalesce(am.reach, 0)::bigint as reach,
      coalesce(am.frequency, 0)::numeric as frequency,
      coalesce(am.leadscore_values, '{}'::numeric[]) as leadscore_values,
      case when jsonb_typeof(am.conversions) = 'array' then am.conversions else '[]'::jsonb end as conversions_json,
      case when jsonb_typeof(am.actions) = 'array' then am.actions else '[]'::jsonb end as actions_json,
      coalesce(
        am.hook_rate,
        case
          when jsonb_typeof(am.video_play_curve_actions) = 'array'
           and jsonb_array_length(am.video_play_curve_actions) > 0
          then (
            coalesce(
              nullif(
                regexp_replace(
                  coalesce(
                    am.video_play_curve_actions ->> least(3, jsonb_array_length(am.video_play_curve_actions) - 1),
                    '0'
                  ),
                  '[^0-9.-]',
                  '',
                  'g'
                ),
                ''
              ),
              '0'
            )::numeric
          ) / (case when coalesce(
              nullif(
                regexp_replace(
                  coalesce(
                    am.video_play_curve_actions ->> least(3, jsonb_array_length(am.video_play_curve_actions) - 1),
                    '0'
                  ),
                  '[^0-9.-]',
                  '',
                  'g'
                ),
                ''
              ),
              '0'
            )::numeric > 1 then 100.0 else 1.0 end)
          else 0::numeric
        end
      ) as hook_value,
      coalesce(
        am.scroll_stop_rate,
        case
          when jsonb_typeof(am.video_play_curve_actions) = 'array'
           and jsonb_array_length(am.video_play_curve_actions) > 0
          then (
            coalesce(
              nullif(
                regexp_replace(
                  coalesce(
                    am.video_play_curve_actions ->> least(1, jsonb_array_length(am.video_play_curve_actions) - 1),
                    '0'
                  ),
                  '[^0-9.-]',
                  '',
                  'g'
                ),
                ''
              ),
              '0'
            )::numeric
          ) / (case when coalesce(
              nullif(
                regexp_replace(
                  coalesce(
                    am.video_play_curve_actions ->> least(1, jsonb_array_length(am.video_play_curve_actions) - 1),
                    '0'
                  ),
                  '[^0-9.-]',
                  '',
                  'g'
                ),
                ''
              ),
              '0'
            )::numeric > 1 then 100.0 else 1.0 end)
          else 0::numeric
        end
      ) as scroll_stop_value
    from base am
  ),
  filtered as (
    select *
    from typed
    where nullif(group_key, '') is not null
  ),
  group_agg as (
    select
      f.group_key,
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
      count(distinct f.ad_id)::integer as ad_id_count,
      count(distinct nullif(f.adset_id, ''))::integer as adset_count,
      -- v093: TODAS as contas do grupo. Diferente de rep.account_id (uma conta arbitrária:
      -- a do ad de maior impressões), que mentiria numa linha por ad_name que colapsa contas.
      coalesce(
        array_agg(distinct f.account_id) filter (where nullif(f.account_id, '') is not null),
        array[]::text[]
      ) as account_ids
    from filtered f
    group by f.group_key
  ),
  -- v093: packs de onde vieram as métricas do grupo. Join indexado por
  -- (user_id, ad_id, metric_date) — ad_metric_pack_map_user_ad_date_idx.
  pack_agg as (
    select
      f.group_key,
      array_agg(distinct apm.pack_id) as pack_ids
    from filtered f
    join public.ad_metric_pack_map apm
      on apm.user_id = f.user_id
     and apm.ad_id = f.ad_id
     and apm.metric_date = f.date
    where p_pack_ids is null
       or apm.pack_id = any(p_pack_ids)
    group by f.group_key
  ),
  rep as (
    select distinct on (f.group_key)
      f.group_key,
      f.account_id,
      f.campaign_id,
      f.campaign_name,
      f.adset_id,
      f.adset_name,
      f.user_id as rep_user_id,
      f.ad_id as rep_ad_id,
      f.ad_name as rep_ad_name
    from filtered f
    order by f.group_key, f.impressions desc, f.ad_id desc
  ),
  status_rows as (
    select distinct f.group_key, f.ad_id, f.user_id
    from filtered f
  ),
  status_agg as (
    select
      sr.group_key,
      bool_or(upper(coalesce(a.effective_status, '')) = 'ACTIVE') as has_active,
      count(distinct sr.ad_id) filter (where upper(coalesce(a.effective_status, '')) = 'ACTIVE')::integer as active_count,
      min(a.effective_status) filter (where nullif(a.effective_status, '') is not null) as fallback_status,
      -- v115: data de criacao no Meta. MIN porque a linha pode agregar varios ads
      -- (por ad_name/conjunto/campanha): a resposta util e "quando este grupo estreou".
      -- Reusa o join a public.ads que status_agg ja faz — nenhum join novo.
      min(a.meta_created_time) as meta_created_min
    from status_rows sr
    left join public.ads a
      on a.user_id = sr.user_id
     and a.ad_id = sr.ad_id
    group by sr.group_key
  ),
  rep_ads as (
    select
      r.group_key,
      a.effective_status as rep_status,
      coalesce(
        nullif(a.thumbnail_url, ''),
        nullif(a.adcreatives_videos_thumbs ->> 0, '')
      ) as thumbnail,
      a.adcreatives_videos_thumbs,
      a.thumb_storage_path
    from rep r
    left join public.ads a
      on a.user_id = r.rep_user_id
     and a.ad_id = r.rep_ad_id
  ),
  -- v116: tags do ATOR (p_user_id), nunca do dono das linhas. Num pack
  -- compartilhado cada um enxerga o proprio vocabulario — compartilhar pack nao
  -- vaza tag. So faz sentido nos niveis de criativo/anuncio: numa linha de
  -- conjunto ou campanha a tag do representante descreveria o grupo errado.
  tag_names as (
    select
      r.group_key,
      coalesce(nullif(r.rep_ad_name, ''), r.rep_ad_id) as ad_name
    from rep r
    where v_group_by in ('ad_name', 'ad_id')
  ),
  tag_agg as (
    select
      tn.group_key,
      jsonb_agg(
        jsonb_build_object('id', t.id, 'name', t.name, 'color', t.color)
        order by t.name, t.id
      ) as tags
    from tag_names tn
    join public.ad_tags atg
      on atg.user_id = p_user_id
     and atg.ad_name = tn.ad_name
    join public.tags t
      on t.id = atg.tag_id
     and t.user_id = p_user_id
    group by tn.group_key
  ),
  selected_results as (
    select
      f.group_key,
      sum(
        coalesce(
          nullif(regexp_replace(coalesce(e.elem ->> 'value', '0'), '[^0-9.-]', '', 'g'), ''),
          '0'
        )::numeric
      ) as results
    from filtered f
    cross join lateral jsonb_array_elements(
      case
        when v_action_source = 'conversion' then f.conversions_json
        when v_action_source = 'action' then f.actions_json
        else '[]'::jsonb
      end
    ) e(elem)
    where v_action_source is not null
      and v_action_name is not null
      and nullif(e.elem ->> 'action_type', '') = v_action_name
    group by f.group_key
  ),
  leadscore_agg as (
    select
      f.group_key,
      array_agg(v)::numeric[] as leadscore_values
    from filtered f
    cross join lateral unnest(coalesce(f.leadscore_values, '{}'::numeric[])) v
    where coalesce(p_include_leadscore, true)
    group by f.group_key
  ),
  rows_enriched as (
    select
      g.group_key,
      r.account_id,
      g.account_ids,
      coalesce(pk.pack_ids, array[]::uuid[]) as pack_ids,
      r.campaign_id,
      r.campaign_name,
      r.adset_id,
      r.adset_name,
      r.rep_ad_id,
      r.rep_ad_name,
      case
        when v_group_by = 'campaign_id' then coalesce(nullif(r.campaign_name, ''), g.group_key)
        when v_group_by = 'adset_id' then coalesce(nullif(r.adset_name, ''), g.group_key)
        else coalesce(nullif(r.rep_ad_name, ''), r.rep_ad_id)
      end as label_name,
      case
        when v_group_by = 'campaign_id' then null
        when coalesce(st.has_active, false) then 'ACTIVE'
        else coalesce(st.fallback_status, ra.rep_status)
      end as effective_status,
      case
        when v_group_by = 'campaign_id' then null
        else coalesce(st.active_count, 0)
      end as active_count,
      g.impressions,
      g.clicks,
      g.inline_link_clicks,
      g.spend,
      g.lpv,
      g.plays,
      g.thruplays,
      g.hook_wsum,
      g.hold_rate_wsum,
      g.video_watched_p50_wsum,
      g.video_watched_p75_wsum,
      g.scroll_stop_wsum,
      g.reach,
      g.frequency_wsum,
      case
        when v_group_by = 'campaign_id' then g.adset_count
        else g.ad_id_count
      end as ad_count,
      coalesce(ls.leadscore_values, array[]::numeric[]) as leadscore_values,
      coalesce(sr.results, 0)::numeric as results,
      st.meta_created_min,
      ra.thumbnail,
      ra.adcreatives_videos_thumbs,
      ra.thumb_storage_path,
      coalesce(tg.tags, '[]'::jsonb) as tags
    from group_agg g
    join rep r using (group_key)
    left join pack_agg pk using (group_key)
    left join status_agg st using (group_key)
    left join rep_ads ra using (group_key)
    left join selected_results sr using (group_key)
    left join leadscore_agg ls using (group_key)
    left join tag_agg tg using (group_key)
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
      case
        when v_selected_key <> '' then jsonb_build_object(v_selected_key, re.results)
        else '{}'::jsonb
      end as conversions
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
  conv_entries_all as (
    select
      'conversion:' || nullif(elem ->> 'action_type', '') as conv_key,
      coalesce(
        nullif(regexp_replace(coalesce(elem ->> 'value', '0'), '[^0-9.-]', '', 'g'), ''),
        '0'
      )::numeric as conv_value
    from filtered f
    cross join lateral jsonb_array_elements(f.conversions_json) elem
    where v_include_conv_types
      and nullif(elem ->> 'action_type', '') is not null

    union all

    select
      'action:' || nullif(elem ->> 'action_type', '') as conv_key,
      coalesce(
        nullif(regexp_replace(coalesce(elem ->> 'value', '0'), '[^0-9.-]', '', 'g'), ''),
        '0'
      )::numeric as conv_value
    from filtered f
    cross join lateral jsonb_array_elements(f.actions_json) elem
    where v_include_conv_types
      and nullif(elem ->> 'action_type', '') is not null
  ),
  available_types as (
    select coalesce(jsonb_agg(t.conv_key order by t.conv_key), '[]'::jsonb) as conv_types
    from (
      select distinct conv_key
      from conv_entries_all
    ) t
  ),
  per_action_all as (
    select
      coalesce(
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
    from (
      select conv_key, sum(conv_value)::numeric as total_results
      from conv_entries_all
      group by conv_key
    ) c
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
    select *
    from ordered
    offset v_offset
    limit v_limit
  ),
  paged as (
    select
      row_number() over () as ord,
      jsonb_build_object(
        'group_key', pr.group_key,
        'unique_id', null,
        'account_id', pr.account_id,
        'account_ids', pr.account_ids,
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
        'leadscore_values', case when coalesce(p_include_leadscore, true) then pr.leadscore_values else array[]::numeric[] end,
        'conversions', pr.conversions,
        'ad_count', pr.ad_count,
        'thumbnail', case
          when v_group_by in ('ad_name', 'ad_id') and pr.thumb_storage_path is not null then null
          else pr.thumbnail
        end,
        'thumb_storage_path', pr.thumb_storage_path,
        'adcreatives_videos_thumbs', pr.adcreatives_videos_thumbs
      ) as item
    from paged_raw pr
  ),
  total_count as (
    select count(*)::integer as total
    from rows_metrics
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
    select count(*)::bigint as conflict_rows
    from base b
    where b.x_cross_silo
  )
  select jsonb_build_object(
    'data', coalesce((select jsonb_agg(p.item order by p.ord) from paged p), '[]'::jsonb),
    'available_conversion_types',
      case
        when v_include_conv_types then coalesce((select conv_types from available_types), '[]'::jsonb)
        else '[]'::jsonb
      end,
    'averages', coalesce((select averages from averages_payload), '{}'::jsonb),
    'header_aggregates', coalesce((select header_aggregates from header_payload), '{}'::jsonb),
    'pagination', coalesce((select pagination from pagination_payload), jsonb_build_object('limit', v_limit, 'offset', v_offset, 'total', 0, 'has_more', false))
  )
  || case
       when coalesce((select conflict_rows from overlap_stat), 0) > 0
       then jsonb_build_object('overlap', jsonb_build_object(
              'rows', (select conflict_rows from overlap_stat)))
       else '{}'::jsonb
     end
  into v_result;

  v_result := coalesce(v_result, jsonb_build_object(
    'data', '[]'::jsonb,
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
        case
          when jsonb_typeof(v_result->'data') = 'array' then v_result->'data'
          else '[]'::jsonb
        end
      ) with ordinality as t(item, ord)
      where coalesce(t.item->>'campaign_id', '') = trim(p_campaign_id)
    ),
    filtered_data as (
      select
        coalesce(jsonb_agg(dr.item order by dr.ord), '[]'::jsonb) as data,
        count(*)::integer as total
      from data_rows dr
    )
    select v_result || jsonb_build_object(
      'data', fd.data,
      'pagination', jsonb_build_object(
        'limit', v_limit,
        'offset', 0,
        'total', fd.total,
        'has_more', false
      )
    )
    into v_result
    from filtered_data fd;
  end if;

  return v_result;
end;
$$;


ALTER FUNCTION public.fetch_manager_rankings_core_v2_base_v116(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text) OWNER TO postgres;

--
-- Name: FUNCTION fetch_manager_rankings_core_v2_base_v116(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.fetch_manager_rankings_core_v2_base_v116(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text) IS 'Manager core v2 base v116: base v115 + tags por linha (do ator, niveis ad_name/ad_id) e poda da thumbnail do CDN da Meta quando ha thumb_storage_path (exceto adset_id, cujo consumidor nao hidrata).';


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
    join public.ad_metric_pack_map apm
      on apm.user_id = o.owner_id
     and apm.pack_id = any(p_pack_ids)
     and apm.metric_date >= v_date_start
     and apm.metric_date <= v_date_stop
    join public.ad_metrics am
      on am.user_id = apm.user_id
     and am.ad_id = apm.ad_id
     and am.date = apm.metric_date
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
  select public.fetch_manager_performance_series_v131(
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
-- Name: ad_metric_pack_map; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ad_metric_pack_map (
    user_id uuid NOT NULL,
    pack_id uuid NOT NULL,
    ad_id text NOT NULL,
    metric_date date NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.ad_metric_pack_map OWNER TO postgres;

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
    CONSTRAINT ad_performance_daily_pairs_chk CHECK (((cardinality(conv_key_ids) = cardinality(conv_values)) AND (cardinality(lead_scores) = cardinality(lead_qtys))))
);


ALTER TABLE public.ad_performance_daily OWNER TO postgres;

--
-- Name: TABLE ad_performance_daily; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.ad_performance_daily IS 'READ MODEL do anúncio-dia, DERIVADO de ad_metrics (migrations 128/129): uma linha por (user, anúncio, dia) com chaves de agrupamento, números já saneados como a RPC do Manager consome (hook/scroll com fallback da curva), conversões/ações somadas por chave (arrays paralelos conv_key_ids/conv_values → conversion_keys.id) e histograma de leadscore (lead_scores/lead_qtys). Mantida pelos triggers ad_metrics_rollup_sync_ins/_upd; delete/mudança de chave propagam por FK. Reconstruível com ad_performance_rollup_rebuild(user_id). NÃO escrever aqui à mão.';


--
-- Name: COLUMN ad_performance_daily.hook_value; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.ad_performance_daily.hook_value IS 'coalesce(hook_rate, curva[3]/100 se >1) — a expressão da RPC v116, calculada na escrita (migration 129).';


--
-- Name: COLUMN ad_performance_daily.scroll_stop_value; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.ad_performance_daily.scroll_stop_value IS 'coalesce(scroll_stop_rate, curva[1]/100 se >1) — a expressão da RPC v116, calculada na escrita (migration 129).';


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
    spreadsheet_name text
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
-- Name: ad_tags; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ad_tags (
    user_id uuid NOT NULL,
    tag_id uuid NOT NULL,
    ad_name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ad_tags_ad_name_not_blank CHECK ((btrim(ad_name) <> ''::text))
);


ALTER TABLE public.ad_tags OWNER TO postgres;

--
-- Name: TABLE ad_tags; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.ad_tags IS 'Marcacao tag <-> criativo. Chaveada por ad_name (criativo), nao ad_id, e sem FK para ads: a tag sobrevive ao anuncio sumir da Meta.';


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
);


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
    refresh_progress_json jsonb,
    ad_ids text[] DEFAULT '{}'::text[],
    sheet_integration_id uuid,
    conversion_types text[] DEFAULT '{}'::text[] NOT NULL,
    mql_leadscore_min numeric,
    target_cpr jsonb,
    diagnostic_cost_metric text,
    last_status_sync_at timestamp with time zone,
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
    ADD CONSTRAINT ad_metrics_pkey PRIMARY KEY (id, user_id);


--
-- Name: ad_metrics ad_metrics_user_ad_date_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ad_metrics
    ADD CONSTRAINT ad_metrics_user_ad_date_key UNIQUE (user_id, ad_id, date);


--
-- Name: ad_performance_daily ad_performance_daily_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ad_performance_daily
    ADD CONSTRAINT ad_performance_daily_pkey PRIMARY KEY (user_id, ad_id, date);


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
-- Name: ad_metrics_ad_name_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ad_metrics_ad_name_idx ON public.ad_metrics USING btree (ad_name);


--
-- Name: ad_metrics_user_adset_date_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ad_metrics_user_adset_date_idx ON public.ad_metrics USING btree (user_id, adset_id, date);


--
-- Name: ad_metrics_user_campaign_date_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ad_metrics_user_campaign_date_idx ON public.ad_metrics USING btree (user_id, campaign_id, date);


--
-- Name: ad_metrics_user_date_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ad_metrics_user_date_idx ON public.ad_metrics USING btree (user_id, date);


--
-- Name: ad_metrics_user_name_date_ad_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ad_metrics_user_name_date_ad_idx ON public.ad_metrics USING btree (user_id, ad_name, date, ad_id);


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
-- Name: ads_user_ad_status_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ads_user_ad_status_idx ON public.ads USING btree (user_id, ad_id) INCLUDE (effective_status, meta_created_time, thumb_storage_path);


--
-- Name: INDEX ads_user_ad_status_idx; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON INDEX public.ads_user_ad_status_idx IS 'Cobertura do lookup por anúncio da RPC do Manager (migrations 124/132): status, data de criação e caminho da miniatura no Storage, index-only.';


--
-- Name: ads_user_adset_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ads_user_adset_idx ON public.ads USING btree (user_id, adset_id);


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
-- Name: packs_refresh_lock_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX packs_refresh_lock_idx ON public.packs USING btree (auto_refresh, refresh_status, refresh_lock_until) WHERE (refresh_lock_until IS NOT NULL);


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
-- Name: google_accounts trg_google_accounts_set_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_google_accounts_set_updated_at BEFORE UPDATE ON public.google_accounts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


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
    ADD CONSTRAINT ad_metric_pack_map_metric_fk FOREIGN KEY (user_id, ad_id, metric_date) REFERENCES public.ad_metrics(user_id, ad_id, date) ON DELETE CASCADE;


--
-- Name: ad_performance_daily ad_performance_daily_metric_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ad_performance_daily
    ADD CONSTRAINT ad_performance_daily_metric_fk FOREIGN KEY (user_id, ad_id, date) REFERENCES public.ad_metrics(user_id, ad_id, date) ON UPDATE CASCADE ON DELETE CASCADE;


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
-- Name: facebook_connections facebook_connections_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.facebook_connections
    ADD CONSTRAINT facebook_connections_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


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
-- Name: FUNCTION ad_performance_curve_point(p_curve jsonb, p_idx integer); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.ad_performance_curve_point(p_curve jsonb, p_idx integer) TO anon;
GRANT ALL ON FUNCTION public.ad_performance_curve_point(p_curve jsonb, p_idx integer) TO authenticated;
GRANT ALL ON FUNCTION public.ad_performance_curve_point(p_curve jsonb, p_idx integer) TO service_role;


--
-- Name: FUNCTION ad_performance_derive_conversions(p_actions jsonb, p_conversions jsonb); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.ad_performance_derive_conversions(p_actions jsonb, p_conversions jsonb) TO anon;
GRANT ALL ON FUNCTION public.ad_performance_derive_conversions(p_actions jsonb, p_conversions jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.ad_performance_derive_conversions(p_actions jsonb, p_conversions jsonb) TO service_role;


--
-- Name: FUNCTION ad_performance_derive_leads(p_values numeric[]); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.ad_performance_derive_leads(p_values numeric[]) TO anon;
GRANT ALL ON FUNCTION public.ad_performance_derive_leads(p_values numeric[]) TO authenticated;
GRANT ALL ON FUNCTION public.ad_performance_derive_leads(p_values numeric[]) TO service_role;


--
-- Name: TABLE ad_metrics; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.ad_metrics TO anon;
GRANT ALL ON TABLE public.ad_metrics TO authenticated;
GRANT ALL ON TABLE public.ad_metrics TO service_role;


--
-- Name: FUNCTION ad_performance_derive_row(am public.ad_metrics); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.ad_performance_derive_row(am public.ad_metrics) TO anon;
GRANT ALL ON FUNCTION public.ad_performance_derive_row(am public.ad_metrics) TO authenticated;
GRANT ALL ON FUNCTION public.ad_performance_derive_row(am public.ad_metrics) TO service_role;


--
-- Name: FUNCTION ad_performance_parse_value(p_raw text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.ad_performance_parse_value(p_raw text) TO anon;
GRANT ALL ON FUNCTION public.ad_performance_parse_value(p_raw text) TO authenticated;
GRANT ALL ON FUNCTION public.ad_performance_parse_value(p_raw text) TO service_role;


--
-- Name: FUNCTION ad_performance_rollup_apply(p_keys public.ad_metric_key[]); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.ad_performance_rollup_apply(p_keys public.ad_metric_key[]) TO anon;
GRANT ALL ON FUNCTION public.ad_performance_rollup_apply(p_keys public.ad_metric_key[]) TO authenticated;
GRANT ALL ON FUNCTION public.ad_performance_rollup_apply(p_keys public.ad_metric_key[]) TO service_role;


--
-- Name: FUNCTION ad_performance_rollup_consistency_check(p_user_id uuid); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.ad_performance_rollup_consistency_check(p_user_id uuid) TO anon;
GRANT ALL ON FUNCTION public.ad_performance_rollup_consistency_check(p_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.ad_performance_rollup_consistency_check(p_user_id uuid) TO service_role;


--
-- Name: FUNCTION ad_performance_rollup_rebuild(p_user_id uuid); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.ad_performance_rollup_rebuild(p_user_id uuid) TO anon;
GRANT ALL ON FUNCTION public.ad_performance_rollup_rebuild(p_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.ad_performance_rollup_rebuild(p_user_id uuid) TO service_role;


--
-- Name: FUNCTION ad_performance_rollup_sync_ins(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.ad_performance_rollup_sync_ins() TO anon;
GRANT ALL ON FUNCTION public.ad_performance_rollup_sync_ins() TO authenticated;
GRANT ALL ON FUNCTION public.ad_performance_rollup_sync_ins() TO service_role;


--
-- Name: FUNCTION ad_performance_rollup_sync_upd(); Type: ACL; Schema: public; Owner: postgres
--

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
-- Name: FUNCTION check_plan_cache_mode_gaps(); Type: ACL; Schema: public; Owner: postgres
--

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
-- Name: FUNCTION detect_pack_conflicts(p_pack_ids uuid[], p_actor_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.detect_pack_conflicts(p_pack_ids uuid[], p_actor_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.detect_pack_conflicts(p_pack_ids uuid[], p_actor_id uuid) TO service_role;


--
-- Name: FUNCTION fetch_entity_performance_v133(p_user_id uuid, p_date_start date, p_date_stop date, p_entity text, p_entity_id text, p_pack_ids uuid[], p_group_by text, p_include_curve boolean, p_series_days integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.fetch_entity_performance_v133(p_user_id uuid, p_date_start date, p_date_stop date, p_entity text, p_entity_id text, p_pack_ids uuid[], p_group_by text, p_include_curve boolean, p_series_days integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fetch_entity_performance_v133(p_user_id uuid, p_date_start date, p_date_stop date, p_entity text, p_entity_id text, p_pack_ids uuid[], p_group_by text, p_include_curve boolean, p_series_days integer) TO authenticated;
GRANT ALL ON FUNCTION public.fetch_entity_performance_v133(p_user_id uuid, p_date_start date, p_date_stop date, p_entity text, p_entity_id text, p_pack_ids uuid[], p_group_by text, p_include_curve boolean, p_series_days integer) TO service_role;


--
-- Name: FUNCTION fetch_entity_performance_v134(p_user_id uuid, p_date_start date, p_date_stop date, p_entity text, p_entity_id text, p_pack_ids uuid[], p_group_by text, p_include_curve boolean, p_series_days integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.fetch_entity_performance_v134(p_user_id uuid, p_date_start date, p_date_stop date, p_entity text, p_entity_id text, p_pack_ids uuid[], p_group_by text, p_include_curve boolean, p_series_days integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fetch_entity_performance_v134(p_user_id uuid, p_date_start date, p_date_stop date, p_entity text, p_entity_id text, p_pack_ids uuid[], p_group_by text, p_include_curve boolean, p_series_days integer) TO authenticated;
GRANT ALL ON FUNCTION public.fetch_entity_performance_v134(p_user_id uuid, p_date_start date, p_date_stop date, p_entity text, p_entity_id text, p_pack_ids uuid[], p_group_by text, p_include_curve boolean, p_series_days integer) TO service_role;


--
-- Name: FUNCTION fetch_manager_performance_base_v130(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.fetch_manager_performance_base_v130(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text) TO anon;
GRANT ALL ON FUNCTION public.fetch_manager_performance_base_v130(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text) TO authenticated;
GRANT ALL ON FUNCTION public.fetch_manager_performance_base_v130(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text) TO service_role;


--
-- Name: FUNCTION fetch_manager_performance_base_v132(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.fetch_manager_performance_base_v132(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text) TO anon;
GRANT ALL ON FUNCTION public.fetch_manager_performance_base_v132(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text) TO authenticated;
GRANT ALL ON FUNCTION public.fetch_manager_performance_base_v132(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text) TO service_role;


--
-- Name: FUNCTION fetch_manager_performance_base_v136(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text, p_include_parent_ids boolean); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.fetch_manager_performance_base_v136(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text, p_include_parent_ids boolean) TO anon;
GRANT ALL ON FUNCTION public.fetch_manager_performance_base_v136(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text, p_include_parent_ids boolean) TO authenticated;
GRANT ALL ON FUNCTION public.fetch_manager_performance_base_v136(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text, p_include_parent_ids boolean) TO service_role;


--
-- Name: FUNCTION fetch_manager_performance_base_v137(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.fetch_manager_performance_base_v137(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text) TO anon;
GRANT ALL ON FUNCTION public.fetch_manager_performance_base_v137(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text) TO authenticated;
GRANT ALL ON FUNCTION public.fetch_manager_performance_base_v137(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text) TO service_role;


--
-- Name: FUNCTION fetch_manager_performance_series_v131(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_group_keys text[], p_window integer); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.fetch_manager_performance_series_v131(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_group_keys text[], p_window integer) TO anon;
GRANT ALL ON FUNCTION public.fetch_manager_performance_series_v131(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_group_keys text[], p_window integer) TO authenticated;
GRANT ALL ON FUNCTION public.fetch_manager_performance_series_v131(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_group_keys text[], p_window integer) TO service_role;


--
-- Name: FUNCTION fetch_manager_rankings_core_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.fetch_manager_rankings_core_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text) TO anon;
GRANT ALL ON FUNCTION public.fetch_manager_rankings_core_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text) TO authenticated;
GRANT ALL ON FUNCTION public.fetch_manager_rankings_core_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text) TO service_role;


--
-- Name: FUNCTION fetch_manager_rankings_core_v2_base_v093(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.fetch_manager_rankings_core_v2_base_v093(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text) TO anon;
GRANT ALL ON FUNCTION public.fetch_manager_rankings_core_v2_base_v093(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text) TO authenticated;
GRANT ALL ON FUNCTION public.fetch_manager_rankings_core_v2_base_v093(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text) TO service_role;


--
-- Name: FUNCTION fetch_manager_rankings_core_v2_base_v104(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.fetch_manager_rankings_core_v2_base_v104(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text) TO anon;
GRANT ALL ON FUNCTION public.fetch_manager_rankings_core_v2_base_v104(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text) TO authenticated;
GRANT ALL ON FUNCTION public.fetch_manager_rankings_core_v2_base_v104(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text) TO service_role;


--
-- Name: FUNCTION fetch_manager_rankings_core_v2_base_v105(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.fetch_manager_rankings_core_v2_base_v105(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text) TO anon;
GRANT ALL ON FUNCTION public.fetch_manager_rankings_core_v2_base_v105(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text) TO authenticated;
GRANT ALL ON FUNCTION public.fetch_manager_rankings_core_v2_base_v105(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text) TO service_role;


--
-- Name: FUNCTION fetch_manager_rankings_core_v2_base_v115(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.fetch_manager_rankings_core_v2_base_v115(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text) TO anon;
GRANT ALL ON FUNCTION public.fetch_manager_rankings_core_v2_base_v115(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text) TO authenticated;
GRANT ALL ON FUNCTION public.fetch_manager_rankings_core_v2_base_v115(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text) TO service_role;


--
-- Name: FUNCTION fetch_manager_rankings_core_v2_base_v116(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.fetch_manager_rankings_core_v2_base_v116(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text) TO anon;
GRANT ALL ON FUNCTION public.fetch_manager_rankings_core_v2_base_v116(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text) TO authenticated;
GRANT ALL ON FUNCTION public.fetch_manager_rankings_core_v2_base_v116(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text) TO service_role;


--
-- Name: FUNCTION fetch_manager_rankings_retention_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_group_key text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.fetch_manager_rankings_retention_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_group_key text) TO authenticated;
GRANT ALL ON FUNCTION public.fetch_manager_rankings_retention_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_group_key text) TO service_role;


--
-- Name: FUNCTION fetch_manager_rankings_series_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_group_keys text[], p_window integer); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.fetch_manager_rankings_series_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_group_keys text[], p_window integer) TO authenticated;
GRANT ALL ON FUNCTION public.fetch_manager_rankings_series_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_group_keys text[], p_window integer) TO service_role;


--
-- Name: FUNCTION get_admin_users_list(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.get_admin_users_list() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_admin_users_list() TO service_role;


--
-- Name: FUNCTION handle_new_user_subscription(); Type: ACL; Schema: public; Owner: postgres
--

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
-- Name: FUNCTION preserve_ads_meta_created_time(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.preserve_ads_meta_created_time() TO anon;
GRANT ALL ON FUNCTION public.preserve_ads_meta_created_time() TO authenticated;
GRANT ALL ON FUNCTION public.preserve_ads_meta_created_time() TO service_role;


--
-- Name: FUNCTION purge_pack_action_log(); Type: ACL; Schema: public; Owner: postgres
--

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

GRANT ALL ON FUNCTION public.set_subscriptions_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.set_subscriptions_updated_at() TO service_role;


--
-- Name: FUNCTION set_updated_at(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.set_updated_at() TO anon;
GRANT ALL ON FUNCTION public.set_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.set_updated_at() TO service_role;


--
-- Name: TABLE ad_accounts; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.ad_accounts TO anon;
GRANT ALL ON TABLE public.ad_accounts TO authenticated;
GRANT ALL ON TABLE public.ad_accounts TO service_role;


--
-- Name: TABLE ad_metric_pack_map; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.ad_metric_pack_map TO anon;
GRANT ALL ON TABLE public.ad_metric_pack_map TO authenticated;
GRANT ALL ON TABLE public.ad_metric_pack_map TO service_role;


--
-- Name: TABLE ad_performance_daily; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.ad_performance_daily TO anon;
GRANT ALL ON TABLE public.ad_performance_daily TO authenticated;
GRANT ALL ON TABLE public.ad_performance_daily TO service_role;


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
-- Name: TABLE ad_transcriptions; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.ad_transcriptions TO anon;
GRANT ALL ON TABLE public.ad_transcriptions TO authenticated;
GRANT ALL ON TABLE public.ad_transcriptions TO service_role;


--
-- Name: TABLE ads; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.ads TO anon;
GRANT ALL ON TABLE public.ads TO authenticated;
GRANT ALL ON TABLE public.ads TO service_role;


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
-- Name: TABLE conversion_keys; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.conversion_keys TO anon;
GRANT ALL ON TABLE public.conversion_keys TO authenticated;
GRANT ALL ON TABLE public.conversion_keys TO service_role;


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
-- Name: TABLE pack_shares; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.pack_shares TO anon;
GRANT ALL ON TABLE public.pack_shares TO authenticated;
GRANT ALL ON TABLE public.pack_shares TO service_role;


--
-- Name: TABLE packs; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.packs TO anon;
GRANT ALL ON TABLE public.packs TO authenticated;
GRANT ALL ON TABLE public.packs TO service_role;


--
-- Name: TABLE parent_entities; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.parent_entities TO anon;
GRANT ALL ON TABLE public.parent_entities TO authenticated;
GRANT ALL ON TABLE public.parent_entities TO service_role;


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

\unrestrict fHVUVCJIXZ7eo5VaRTa0m13qiYoNDFNrkV6qkahMYLKy64wKDblH9Hc1u3BJdiS

