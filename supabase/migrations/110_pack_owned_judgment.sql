-- Migration 110: o criterio de julgamento e inerente ao PACK
--
-- MUDANCA DE MODELO
--   `mql_leadscore_min` e `target_cpr` deixam de ser preferencia de usuario com
--   override por pack, e passam a existir SO no pack. `validation_criteria` e
--   `diagnostic_cost_metric` seguem no usuario — sao controles de visualizacao.
--
--   A linha que separa os dois grupos: o corte de leadscore descreve a PLANILHA
--   que produziu o dado (sem ela o numero nao tem referente), e a meta de CPR
--   descreve o NEGOCIO daquele conjunto de campanhas. Os outros dois descrevem
--   como o usuario quer olhar. A P2 tratou os quatro como iguais porque estavam
--   na mesma tabela; nao sao.
--
--   Consequencia direta no compartilhamento: o pack passa a carregar o proprio
--   criterio, e a pergunta "o default e de quem?" deixa de existir. A classe de
--   bug corrigida na 108 some por construcao, nao por cuidado.
--
-- NULL = NAO DEFINIDO, E NAO ZERO
--   Corte indefinido (pack legado) ou nao-unico (packs selecionados divergem)
--   passa a ser NULL, e MQL/CPMQL ficam INDISPONIVEIS. Zero seria "todo lead e
--   MQL" — um numero otimo e falso, na direcao que ninguem investiga.
--
-- ESTA MIGRATION NAO DROPA NADA
--   As colunas em user_preferences continuam existindo, ignoradas. O codigo em
--   producao ainda as le; dropar aqui derrubaria a producao no ato. O DROP vai
--   numa migration separada, depois do deploy.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Backfill — preserva o comportamento vigente
--
--    Sem isto, 20 packs perderiam o corte de uma vez e o CPMQL sumiria da tela
--    de quem ja usa. Copiar o valor vigente custa duas linhas.
--
--    Quem tem default 0 NAO recebe 0: fica NULL. Zero nunca foi escolha, e
--    grava-lo como se fosse perpetuaria "todo lead e MQL" com cara de decisao.
-- ---------------------------------------------------------------------------

UPDATE public.packs pk
   SET mql_leadscore_min = up.mql_leadscore_min,
       updated_at = now()
  FROM public.user_preferences up
 WHERE up.user_id = pk.user_id
   AND pk.mql_leadscore_min IS NULL
   AND pk.sheet_integration_id IS NOT NULL   -- so faz sentido onde ha leadscore
   AND coalesce(up.mql_leadscore_min, 0) > 0;

UPDATE public.packs pk
   SET target_cpr = up.target_cpr,
       updated_at = now()
  FROM public.user_preferences up
 WHERE up.user_id = pk.user_id
   AND pk.target_cpr IS NULL
   AND up.target_cpr IS NOT NULL
   AND up.target_cpr <> '{}'::jsonb;

-- ---------------------------------------------------------------------------
-- 2. Resolver: so o pack, sem heranca, sem ator no fallback
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
$fn$;

COMMENT ON FUNCTION public.resolve_pack_mql_leadscore_min(uuid, uuid[]) IS
  'Corte de leadscore para MQL dos packs selecionados. Vem SO do pack — sem heranca de user_preferences. Retorna NULL quando indefinido ou divergente entre packs, e nesse caso MQL/CPMQL ficam indisponiveis. Helper interno — nao exposto ao PostgREST.';

REVOKE ALL ON FUNCTION public.resolve_pack_mql_leadscore_min(uuid, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_pack_mql_leadscore_min(uuid, uuid[]) FROM anon;
REVOKE ALL ON FUNCTION public.resolve_pack_mql_leadscore_min(uuid, uuid[]) FROM authenticated;

-- ---------------------------------------------------------------------------
-- 3. series_v2 tolerante a corte NULL
--
--    `v >= NULL` nao conta ninguem, entao mql_count virava 0. `cpmql` e `mqls`
--    escapavam por acaso (o guard `mql_count > 0` os leva a null), mas
--    `mql_rate` dividia direto: 0/N = 0, publicado como "0% qualificados".
--
--    Corpo abaixo gerado a partir da funcao VIVA (pg_get_functiondef) com tres
--    substituicoes cirurgicas — nao e uma reescrita manual.
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
  v_mql_min numeric;  -- null = corte NAO definido (nao e zero)
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
  -- P3.2: dirigido pelos DONOS resolvidos, nao filtrado por um user_id escalar.
  -- Medido na RPC principal: `am.user_id = any(v_owners)` faz o planner perder
  -- ad_metric_pack_map_user_pack_date_ad_idx e cair no PK varrendo todos os
  -- user_ids (67ms -> 4010ms). Dirigindo a partir dos donos, o nested loop liga
  -- as 4 colunas do indice composto. O ramo legado (p_pack_ids nulo, sem map
  -- para dirigir) fica no UNION ALL e o planner poda o ramo morto.
  base_candidates as (
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
      (case
        when v_mql_min is null then null
        else sum(
          coalesce(
            (select count(*)::integer from unnest(f.leadscore_values) v where v >= v_mql_min),
            0
          )
        )
      end)::bigint as mql_count,
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

-- ---------------------------------------------------------------------------
-- Pos-condicoes
-- ---------------------------------------------------------------------------
DO $post$
DECLARE
  v_orfaos integer;
  v_rate_guard integer;
BEGIN
  -- Nenhum pack com planilha ficou sem corte por engano: os unicos aceitos sao
  -- os do dono cujo default era 0 (nunca configurado).
  SELECT count(*) INTO v_orfaos
  FROM public.packs pk
  LEFT JOIN public.user_preferences up ON up.user_id = pk.user_id
  WHERE pk.sheet_integration_id IS NOT NULL
    AND pk.mql_leadscore_min IS NULL
    AND coalesce(up.mql_leadscore_min, 0) > 0;

  IF v_orfaos <> 0 THEN
    RAISE EXCEPTION 'ABORTADO: % packs com planilha ficaram sem corte apesar de o dono ter default > 0.', v_orfaos;
  END IF;

  -- O guard de mql_rate entrou de fato no corpo publicado.
  SELECT count(*) INTO v_rate_guard
  FROM pg_proc
  WHERE pronamespace = 'public'::regnamespace
    AND proname = 'fetch_manager_rankings_series_v2'
    AND prosrc LIKE '%d.mql_count is not null and coalesce(d.leadscore_count, 0) > 0%';

  IF v_rate_guard <> 1 THEN
    RAISE EXCEPTION 'ABORTADO: guard de mql_rate ausente em fetch_manager_rankings_series_v2.';
  END IF;
END
$post$;

COMMIT;
