-- Migration 115: data de criacao do anuncio NO META (ads.meta_created_time)
--
-- PROBLEMA
--   ads.created_at e a data em que a LINHA entrou no nosso Postgres (primeiro sync do
--   pack). Um anuncio de marco importado ontem tem created_at = ontem. Nao servia para
--   nenhuma pergunta do tipo "quais anuncios subiram na primeira semana de agosto".
--
-- O DADO JA CHEGAVA E ERA DESCARTADO
--   _INVENTORY_FIELDS (ads_enricher.py) ja pede created_time em toda sincronizacao — o
--   campo era usado so em memoria, para clampar a sintese de linhas-zero a vida real do
--   ad (ad_inventory.py), e morria ali. Persistir custa ZERO chamada nova a Graph API.
--
-- CRIACAO != INICIO DE VEICULACAO
--   created_time e quando o objeto passou a existir. O Meta NAO expoe "comecou a
--   entregar" no no Ad; o mais proximo e adset.start_time (agendamento do conjunto) e,
--   empiricamente, a primeira data com impressao. Ad em review ou criado pausado tem as
--   duas datas divergentes. Esta coluna e a de CRIACAO, e so ela.
--
-- POR QUE UM TRIGGER
--   O edge /ads omite ARCHIVED e DELETED: esses anuncios chegam pelo /insights sem linha
--   de inventario, entao o upsert manda meta_created_time = NULL para eles. Sem guarda,
--   todo sync apagaria a data de criacao justamente dos anuncios antigos. O trigger faz
--   o coalesce no banco — a data de criacao nunca "desliga", so preenche.
--   (A hidratacao equivalente em _apply_existing_fixed_fields cobre so o caminho de
--   refresh; o trigger cobre tambem o sync completo, onde existing_ads_map vem vazio.)
--
-- SEM BACKFILL POSSIVEL
--   Linhas antigas ficam NULL ate o proximo sync do pack que as contem. Nao ha de onde
--   ler a data retroativamente sem consultar a Meta ad a ad.
--
-- RPC: v105 -> v115, so aditivo (nova chave meta_created_time por linha). v105 e MANTIDA;
-- reverter e trocar uma linha no wrapper.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Coluna
-- ---------------------------------------------------------------------------
ALTER TABLE public.ads ADD COLUMN IF NOT EXISTS meta_created_time timestamptz;

COMMENT ON COLUMN public.ads.meta_created_time IS
  'created_time do no Ad da Graph API: quando o anuncio foi CRIADO no Meta. Nao confundir com created_at (quando a linha entrou neste banco) nem com inicio de veiculacao (o Meta nao expoe esse campo). NULL = ad ainda nao ressincronizado desde a migration 115.';

-- ---------------------------------------------------------------------------
-- 2) Guarda: NULL nunca apaga uma data ja conhecida
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.preserve_ads_meta_created_time()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  -- Data de criacao e imutavel: um upsert sem o valor (ad fora do inventario) nao pode
  -- reescrever como NULL o que ja foi lido da Meta.
  IF NEW.meta_created_time IS NULL THEN
    NEW.meta_created_time := OLD.meta_created_time;
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS trg_ads_preserve_meta_created_time ON public.ads;
CREATE TRIGGER trg_ads_preserve_meta_created_time
  BEFORE UPDATE ON public.ads
  FOR EACH ROW
  EXECUTE FUNCTION public.preserve_ads_meta_created_time();

-- ---------------------------------------------------------------------------
-- 3) Base v115 = v105 + meta_created_time por linha
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fetch_manager_rankings_core_v2_base_v115(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text DEFAULT 'ad_name'::text, p_pack_ids uuid[] DEFAULT NULL::uuid[], p_account_ids text[] DEFAULT NULL::text[], p_campaign_name_contains text DEFAULT NULL::text, p_adset_name_contains text DEFAULT NULL::text, p_ad_name_contains text DEFAULT NULL::text, p_action_type text DEFAULT NULL::text, p_include_leadscore boolean DEFAULT true, p_include_available_conversion_types boolean DEFAULT true, p_limit integer DEFAULT 500, p_offset integer DEFAULT 0, p_order_by text DEFAULT 'spend'::text, p_campaign_id text DEFAULT NULL::text) RETURNS jsonb
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

COMMENT ON FUNCTION public.fetch_manager_rankings_core_v2_base_v115(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text) IS
  'Manager core v2 base v115: base v105 + meta_created_time por linha (MIN de ads.meta_created_time no grupo — data de CRIACAO no Meta, nao inicio de veiculacao). Pega carona no join a public.ads que status_agg ja faz.';

GRANT ALL ON FUNCTION public.fetch_manager_rankings_core_v2_base_v115(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text) TO anon;
GRANT ALL ON FUNCTION public.fetch_manager_rankings_core_v2_base_v115(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text) TO authenticated;
GRANT ALL ON FUNCTION public.fetch_manager_rankings_core_v2_base_v115(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text) TO service_role;

-- ---------------------------------------------------------------------------
-- 4) Wrapper repontado para a v115
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fetch_manager_rankings_core_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text DEFAULT 'ad_name'::text, p_pack_ids uuid[] DEFAULT NULL::uuid[], p_account_ids text[] DEFAULT NULL::text[], p_campaign_name_contains text DEFAULT NULL::text, p_adset_name_contains text DEFAULT NULL::text, p_ad_name_contains text DEFAULT NULL::text, p_action_type text DEFAULT NULL::text, p_include_leadscore boolean DEFAULT true, p_include_available_conversion_types boolean DEFAULT true, p_limit integer DEFAULT 500, p_offset integer DEFAULT 0, p_order_by text DEFAULT 'spend'::text, p_campaign_id text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_group_by text := lower(coalesce(p_group_by, 'ad_name'));
  v_payload jsonb;
  v_data jsonb := '[]'::jsonb;
begin
  select public.fetch_manager_rankings_core_v2_base_v115(
    p_user_id,
    p_date_start,
    p_date_stop,
    p_group_by,
    p_pack_ids,
    p_account_ids,
    p_campaign_name_contains,
    p_adset_name_contains,
    p_ad_name_contains,
    p_action_type,
    p_include_leadscore,
    p_include_available_conversion_types,
    p_limit,
    p_offset,
    p_order_by,
    p_campaign_id
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
      case
        when jsonb_typeof(v_payload->'data') = 'array' then v_payload->'data'
        else '[]'::jsonb
      end
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
              -- Status OFICIAL do adset (denormalizado). Escrito por parent_id em todas as
              -- linhas do pai; o ORDER BY por recência é defesa em profundidade caso linhas
              -- do mesmo pai divirjam (ex.: escrita parcial interrompida).
              (
                select nullif(a.adset_status, '')
                from public.ads a
                where a.user_id = p_user_id
                  and a.adset_id = rr.adset_id
                  and nullif(a.adset_status, '') is not null
                order by a.updated_at desc nulls last
                limit 1
              ),
              -- Fallback pré-backfill: inferência por marcadores nos filhos (migration 088)
              case
                when exists (
                  select 1 from public.ads a
                  where a.user_id = p_user_id
                    and a.adset_id = rr.adset_id
                    and upper(coalesce(a.effective_status, '')) = 'ADSET_PAUSED'
                  limit 1
                ) then 'ADSET_PAUSED'
                when exists (
                  select 1 from public.ads a
                  where a.user_id = p_user_id
                    and a.adset_id = rr.adset_id
                    and upper(coalesce(a.effective_status, '')) = 'CAMPAIGN_PAUSED'
                  limit 1
                ) then 'CAMPAIGN_PAUSED'
                else 'ACTIVE'
              end
            )
          when v_group_by = 'campaign_id' and rr.campaign_id is not null then
            coalesce(
              (
                select nullif(a.campaign_status, '')
                from public.ads a
                where a.user_id = p_user_id
                  and a.campaign_id = rr.campaign_id
                  and nullif(a.campaign_status, '') is not null
                order by a.updated_at desc nulls last
                limit 1
              ),
              case
                when exists (
                  select 1 from public.ads a
                  where a.user_id = p_user_id
                    and a.campaign_id = rr.campaign_id
                    and upper(coalesce(a.effective_status, '')) = 'CAMPAIGN_PAUSED'
                  limit 1
                ) then 'CAMPAIGN_PAUSED'
                else 'ACTIVE'
              end
            )
          when v_group_by in ('adset_id', 'campaign_id') then 'ACTIVE'
          else rr.item->>'effective_status'
        end,
        -- Orçamento (read-only): budget da PRÓPRIA entidade da linha, em subunidade da
        -- moeda da conta. NULL = sem budget nesse nível (CBO↔ABO) OU ainda não sincronizado
        -- — budget_mode NULL distingue o segundo caso.
        'budget_daily', pb_self.daily_budget,
        'budget_lifetime', pb_self.lifetime_budget,
        'budget_mode', pb_mode.budget_mode,
        'budget_currency', acct.currency,
        -- Total de anúncios do CONJUNTO pelo inventário (inclui pausados sem entrega, que não
        -- existem em ad_metrics). Sem snapshot -> preserva o ad_count do base (ad_metrics).
        -- group_by='campaign_id' NÃO é tocado: lá ad_count é contagem de CONJUNTOS.
        'ad_count', coalesce(
          case when v_group_by = 'adset_id' then pb_self.ads_count else null end,
          nullif(rr.item->>'ad_count', '')::integer
        )
      ) as item
    from raw_rows rr
    left join lateral (
      select pb.daily_budget, pb.lifetime_budget, pb.account_id, pb.ads_count
      from public.parent_entities pb
      where pb.user_id = p_user_id
        and pb.entity_id = case when v_group_by = 'adset_id' then rr.adset_id else rr.campaign_id end
      limit 1
    ) pb_self on true
    left join lateral (
      -- Modo é atributo da CAMPANHA (mesmo na aba por-conjunto: diz se o budget do adset
      -- existe ou vive na campanha).
      select pb.budget_mode
      from public.parent_entities pb
      where pb.user_id = p_user_id
        and pb.entity_id = rr.campaign_id
      limit 1
    ) pb_mode on true
    left join lateral (
      -- ads.account_id vem sem prefixo act_; ad_accounts.id vem com — normalizar os dois lados.
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

COMMENT ON FUNCTION public.fetch_manager_rankings_core_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text, p_pack_ids uuid[], p_account_ids text[], p_campaign_name_contains text, p_adset_name_contains text, p_ad_name_contains text, p_action_type text, p_include_leadscore boolean, p_include_available_conversion_types boolean, p_limit integer, p_offset integer, p_order_by text, p_campaign_id text) IS
  'Manager core v2 wrapper: resolves campaign/adset effective_status preferring the official denormalized parent status (ads.adset_status/campaign_status), falling back to hierarchical pause markers for pre-backfill rows; enriches adset/campaign rows with budget (parent_entities + ad_accounts.currency). Base: v115 (meta_created_time por linha).';

-- ---------------------------------------------------------------------------
-- 5) Guardas pos-migration
-- ---------------------------------------------------------------------------
DO $post$
DECLARE v_base text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ads' AND column_name = 'meta_created_time'
  ) THEN
    RAISE EXCEPTION 'ABORTADO: ads.meta_created_time nao foi criada.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.ads'::regclass AND tgname = 'trg_ads_preserve_meta_created_time'
  ) THEN
    RAISE EXCEPTION 'ABORTADO: trigger de preservacao ausente — sync apagaria a data de criacao.';
  END IF;

  SELECT substring(pg_get_functiondef(p.oid) from 'core_v2_base_v[0-9]+') INTO v_base
  FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname = 'fetch_manager_rankings_core_v2' AND p.pronargs = 16;
  IF v_base IS DISTINCT FROM 'core_v2_base_v115' THEN
    RAISE EXCEPTION 'ABORTADO: wrapper delega a %, esperava core_v2_base_v115.', coalesce(v_base, '(nenhuma)');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace
                 AND proname = 'fetch_manager_rankings_core_v2_base_v105') THEN
    RAISE EXCEPTION 'ABORTADO: v105 sumiu — sem caminho de rollback.';
  END IF;
END
$post$;

COMMIT;
