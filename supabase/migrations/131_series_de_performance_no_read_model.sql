-- 131: série diária (sparklines) do Manager lida do read model, e só da janela pedida.
--
-- O QUE A MEDIÇÃO MOSTROU (produção, pg_stat_statements, 2026-08-26 pós-cutover da 130)
-- ---------------------------------------------------------------------------------------
-- fetch_manager_rankings_series_v2: 181 chamadas, 1,7 s em média, 12,6 s no pior caso,
-- 1,3 GB de arquivos temporários acumulados. Na tela, com o Manager frio e disputando as
-- 2 vCPUs com a RPC principal: 11 s — virou o gargalo visível depois que a core caiu
-- para 1,2 s.
--
-- Dois desperdícios, ambos estruturais:
-- 1. Lia `ad_metrics` cru (`select am.*`, linhas de ~1 KB com JSON inline), deduplicava
--    com DISTINCT ON e abria o JSON de conversões por dia — o mesmo custo que a 130 tirou
--    da core.
-- 2. Lia o PERÍODO INTEIRO da seleção (`p_date_start..p_date_stop`, ex.: 57 dias) para
--    depois filtrar a JANELA (`p_window`, 5 dias) só no GROUP BY diário. Mais de 90% das
--    linhas buscadas eram descartadas.
--
-- ESTA VERSÃO
-- -----------
-- - Seleção resolvida no mapa de packs restrita a `v_axis_start..v_date_stop` (a janela),
--   com o mesmo dedup cross-silo da série antiga (vence o dono do pack compartilhado).
-- - Linhas do read model `ad_performance_daily` (migration 129): números já saneados,
--   `hook_value`/`scroll_stop_value` prontos, conversão pedida por
--   `conv_values[array_position(conv_key_ids, id)]`, leads em histograma
--   (`lead_scores`/`lead_qtys`) → MQLs, soma e contagem por dia sem `unnest` de array cru.
-- - `ad_metrics` só entra para filtros por nome de campanha/conjunto (EXISTS, podado
--   quando o filtro está vazio — predicado constante sob force_custom_plan).
--
-- CONTRATO: idêntico ao da série antiga — `{series_by_group: {group_key: {axis, hook,
-- ..., conversions, cpmql, mqls, leadscore_avg, mql_rate}}, window}`. A série nunca
-- expôs arrays de leadscore (calcula por dia com o corte do pack via
-- resolve_pack_mql_leadscore_min), então NADA muda no backend ou no frontend.
-- Provado pelo diferencial (`backend/scripts/diff_rankings_rollup.py --series`).
--
-- `fetch_manager_rankings_series_v2` vira wrapper fino sobre a base nova (o padrão da
-- core: entry estável, base versionada). Rollback = reaplicar a função da migration 110.
--
-- Regras herdadas: SET plan_cache_mode + SET search_path aqui; entrada = ator, donos via
-- resolve_pack_access; consulta dirigida pelo mapa.

CREATE OR REPLACE FUNCTION public.fetch_manager_performance_series_v131(
  p_user_id uuid, p_date_start date, p_date_stop date,
  p_group_by text DEFAULT 'ad_name'::text, p_pack_ids uuid[] DEFAULT NULL::uuid[],
  p_account_ids text[] DEFAULT NULL::text[], p_campaign_name_contains text DEFAULT NULL::text,
  p_adset_name_contains text DEFAULT NULL::text, p_ad_name_contains text DEFAULT NULL::text,
  p_action_type text DEFAULT NULL::text, p_group_keys text[] DEFAULT NULL::text[],
  p_window integer DEFAULT 5
) RETURNS jsonb
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

COMMENT ON FUNCTION public.fetch_manager_performance_series_v131(uuid, date, date, text, uuid[], text[], text, text, text, text, text[], integer) IS
'Série diária do Manager (sparklines) sobre o read model ad_performance_daily (migration 131): lê só a janela pedida, sem JSON nem arrays crus de leadscore. Mesmo contrato da fetch_manager_rankings_series_v2 (que agora é wrapper desta).';

-- ============================================================================
-- Entry repontada: wrapper fino, mesma assinatura (PostgREST resolve pelo nome/args).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fetch_manager_rankings_series_v2(
  p_user_id uuid, p_date_start date, p_date_stop date,
  p_group_by text DEFAULT 'ad_name'::text, p_pack_ids uuid[] DEFAULT NULL::uuid[],
  p_account_ids text[] DEFAULT NULL::text[], p_campaign_name_contains text DEFAULT NULL::text,
  p_adset_name_contains text DEFAULT NULL::text, p_ad_name_contains text DEFAULT NULL::text,
  p_action_type text DEFAULT NULL::text, p_group_keys text[] DEFAULT NULL::text[],
  p_window integer DEFAULT 5
) RETURNS jsonb
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

COMMENT ON FUNCTION public.fetch_manager_rankings_series_v2(uuid, date, date, text, uuid[], text[], text, text, text, text, text[], integer) IS
'Wrapper: chama fetch_manager_performance_series_v131 (migration 131, read model + só a janela). Rollback = reaplicar a função da migration 110.';
