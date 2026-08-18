-- Migration 101: configuracao de julgamento por pack (heranca com override)
--
-- Move a configuracao de julgamento de user_preferences para o pack, mantendo
-- user_preferences como PADRAO. Coluna NULL no pack = herda do usuario.
--
-- Regra de resolucao com multiplos packs selecionados:
--   0 packs                       -> padrao do usuario
--   todos resolvem para o mesmo   -> esse valor
--   divergem entre si             -> padrao do usuario (a UI avisa a divergencia)
--
-- Regressao zero: nenhum pack nasce com override (todos NULL), entao todo mundo
-- continua vendo exatamente o padrao do usuario ate sobrescrever explicitamente.
--
-- validation_criteria NAO migra: e preferencia do analista ("o que considero um
-- anuncio validado"), nao propriedade da campanha.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Colunas de override no pack (NULL = herda)
-- ---------------------------------------------------------------------------

ALTER TABLE public.packs
  ADD COLUMN IF NOT EXISTS mql_leadscore_min numeric,
  ADD COLUMN IF NOT EXISTS target_cpr jsonb,
  ADD COLUMN IF NOT EXISTS diagnostic_cost_metric text;

DO $mig$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'packs_mql_leadscore_min_check'
  ) THEN
    ALTER TABLE public.packs
      ADD CONSTRAINT packs_mql_leadscore_min_check
      CHECK (mql_leadscore_min IS NULL OR mql_leadscore_min >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'packs_diagnostic_cost_metric_check'
  ) THEN
    ALTER TABLE public.packs
      ADD CONSTRAINT packs_diagnostic_cost_metric_check
      CHECK (diagnostic_cost_metric IS NULL OR diagnostic_cost_metric IN ('cpr', 'cpmql'));
  END IF;
END
$mig$;

COMMENT ON COLUMN public.packs.mql_leadscore_min IS
  'Override do leadscore minimo para MQL neste pack. NULL = herda user_preferences.mql_leadscore_min.';
COMMENT ON COLUMN public.packs.target_cpr IS
  'Override do CPR alvo por action_type neste pack (Record<action_type, number>). NULL = herda user_preferences.target_cpr.';
COMMENT ON COLUMN public.packs.diagnostic_cost_metric IS
  'Override da metrica de custo do diagnostico neste pack (cpr|cpmql). NULL = herda user_preferences.diagnostic_cost_metric.';

-- ---------------------------------------------------------------------------
-- 2. Resolvedor compartilhado (mesma regra usada pelo backend Python)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.resolve_pack_mql_leadscore_min(
  p_user_id uuid,
  p_pack_ids uuid[] DEFAULT NULL::uuid[]
) RETURNS numeric
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
AS $fn$
declare
  v_default numeric;
  v_distinct_count integer := 0;
  v_value numeric;
begin
  select coalesce(up.mql_leadscore_min, 0)
    into v_default
  from public.user_preferences up
  where up.user_id = p_user_id
  limit 1;

  v_default := greatest(coalesce(v_default, 0), 0);

  if p_pack_ids is null or array_length(p_pack_ids, 1) is null then
    return v_default;
  end if;

  select count(*), min(s.v)
    into v_distinct_count, v_value
  from (
    select distinct coalesce(p.mql_leadscore_min, v_default) as v
    from public.packs p
    where p.user_id = p_user_id
      and p.id = any(p_pack_ids)
  ) s;

  -- 1 valor efetivo -> usa. 0 packs encontrados ou divergencia -> padrao do usuario.
  if v_distinct_count = 1 then
    return greatest(coalesce(v_value, v_default), 0);
  end if;

  return v_default;
end;
$fn$;

COMMENT ON FUNCTION public.resolve_pack_mql_leadscore_min(uuid, uuid[]) IS
  'Resolve o leadscore minimo de MQL efetivo para um conjunto de packs. Pack sobrescreve o padrao do usuario; packs divergentes caem no padrao. Helper interno — nao exposto ao PostgREST.';

-- Helper interno: nao deve ser chamavel pelo cliente.
REVOKE ALL ON FUNCTION public.resolve_pack_mql_leadscore_min(uuid, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_pack_mql_leadscore_min(uuid, uuid[]) FROM anon;
REVOKE ALL ON FUNCTION public.resolve_pack_mql_leadscore_min(uuid, uuid[]) FROM authenticated;

-- ---------------------------------------------------------------------------
-- 3. Series RPC passa a resolver o MQL pelos packs selecionados
--    (corpo identico ao atual, exceto a leitura do mql_leadscore_min)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fetch_manager_rankings_series_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text DEFAULT 'ad_name'::text, p_pack_ids uuid[] DEFAULT NULL::uuid[], p_account_ids text[] DEFAULT NULL::text[], p_campaign_name_contains text DEFAULT NULL::text, p_adset_name_contains text DEFAULT NULL::text, p_ad_name_contains text DEFAULT NULL::text, p_action_type text DEFAULT NULL::text, p_group_keys text[] DEFAULT NULL::text[], p_window integer DEFAULT 5)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_group_by text := lower(coalesce(p_group_by, 'ad_name'));
  v_date_start date := least(p_date_start, p_date_stop);
  v_date_stop date := greatest(p_date_start, p_date_stop);
  v_window integer := greatest(1, least(coalesce(p_window, 5), 30));
  v_axis_start date;
  v_selected_key text := trim(coalesce(p_action_type, ''));
  v_action_source text := null;
  v_action_name text := null;
  v_mql_min numeric := 0;
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

  -- Resolucao com heranca: pack sobrescreve o padrao do usuario.
  -- Packs divergentes entre si caem no padrao do usuario (ver funcao).
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
  base_candidates as (
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
      am.date,
      coalesce(am.impressions, 0)::bigint as impressions,
      coalesce(am.clicks, 0)::bigint as clicks,
      coalesce(am.inline_link_clicks, 0)::bigint as inline_link_clicks,
      coalesce(am.spend, 0)::numeric as spend,
      coalesce(am.lpv, 0)::bigint as lpv,
      coalesce(am.video_total_plays, 0)::bigint as plays,
      coalesce(am.video_total_thruplays, 0)::bigint as thruplays,
      coalesce(am.reach, 0)::bigint as reach,
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
      ) as scroll_stop_value,
      coalesce(am.hold_rate, 0)::numeric as hold_rate_value,
      coalesce(am.video_watched_p50, 0)::numeric as video_watched_p50_value,
      coalesce(am.video_watched_p75, 0)::numeric as video_watched_p75_value
    from base am
  ),
  filtered as (
    select t.*
    from typed t
    join requested_groups rg
      on rg.group_key = t.group_key
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
      sum(f.hold_rate_value * f.plays)::numeric as hold_rate_wsum,
      sum(f.video_watched_p50_value * f.plays)::numeric as video_watched_p50_wsum,
      sum(f.video_watched_p75_value * f.plays)::numeric as video_watched_p75_wsum,
      sum(
        coalesce(
          (select count(*)::integer from unnest(f.leadscore_values) v where v >= v_mql_min),
          0
        )
      )::bigint as mql_count,
      sum(
        coalesce((select sum(v) from unnest(f.leadscore_values) v), 0)
      )::numeric as leadscore_sum,
      sum(
        coalesce(array_length(f.leadscore_values, 1), 0)
      )::bigint as leadscore_count
    from filtered f
    where f.date >= v_axis_start
      and f.date <= v_date_stop
    group by f.group_key, f.date
  ),
  conv_daily as (
    select
      f.group_key,
      f.date,
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
      and f.date >= v_axis_start
      and f.date <= v_date_stop
      and nullif(e.elem ->> 'action_type', '') = v_action_name
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
            when v_selected_key <> '' then jsonb_build_object(v_selected_key, coalesce(cd.results, 0))
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
          case
            when coalesce(d.mql_count, 0) > 0 then d.mql_count
            else null
          end
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
        -- Denominador é leadscore_count (todos os leads), nunca (leads - mqls).
        'mql_rate', jsonb_agg(
          case
            when coalesce(d.leadscore_count, 0) > 0 then d.mql_count::numeric / d.leadscore_count
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
    left join conv_daily cd
      on cd.group_key = rg.group_key
     and cd.date = a.d
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
$function$;

COMMIT;
