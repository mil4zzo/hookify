-- ===========================================================================
-- 171 — A SÉRIE DIA A DIA E O DETALHE SEGUEM A REGRA DA 170
--
-- A 170 tirou métrica de vídeo de anúncio de imagem nas LINHAS do Manager. Faltavam
-- os dois caminhos que entregam número dia a dia:
--   - `fetch_manager_performance_series_v145` → o sparkline de cada célula (o backend
--     chama pelo wrapper `fetch_manager_rankings_series_v2`);
--   - `fetch_entity_performance_v158` → o modal do anúncio: totais, série e a curva
--     de retenção.
--
-- Hoje isso não chega ao usuário (a célula de métrica de vídeo numa linha de imagem
-- mostra o ícone de formato e não desenha sparkline; o modal esconde a curva), mas o
-- número errado continuava saindo do banco — e qualquer leitor novo o pegaria. É a
-- diferença entre esconder o sintoma e não produzir o número.
--
-- ONDE ENTRA: as duas funções descem tudo de UM CTE por anúncio-dia (`sel` na série,
-- `rows_` no detalhe). Travar ali pega série, totais e curva de uma vez — a curva
-- porque ela exige `plays > 0`, e plays passa a ser 0 na imagem.
--
-- COM PLAYS EM 0, O DIA SAI NULL, NÃO 0: a série já escreve `case when plays > 0 then
-- wsum/plays else null end`. Ou seja, o gráfico fica sem ponto naquele dia em vez de
-- desenhar zero — que é o certo para "não se aplica".
--
-- DEPENDE DA 170: as duas funções daqui leem `media_type` pelo índice de cobertura que a
-- 170 recriou (`ads_user_ad_status_mt_idx`). Aplicar esta sem aquela, ou rodar o rollback
-- da 170 com esta de pé, troca leitura só pelo índice por varredura da tabela — medido:
-- 5.406 páginas contra ~21 mil.
--
-- VOLTA ATRÁS: `171_rollback.sql` devolve o wrapper da série para a v145 (uma
-- instrução, sem deploy) e, para o detalhe, `ANALYTICS_ENTITY_RPC=
-- fetch_entity_performance_v158` no backend. As duas funções antigas ficam intactas.
--
-- PROVA: supabase/tests/171_serie_em_imagem.test.sql (cenário sintético: imagem com
-- play espúrio, nome misturado e formato desconhecido) e
-- backend/scripts/diff_series_v171.py (v145/v158 × v171 nos cenários do laboratório:
-- só métrica de vídeo de anúncio de imagem pode mudar).
-- ===========================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.fetch_manager_performance_series_v171(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text DEFAULT 'ad_name'::text, p_pack_ids uuid[] DEFAULT NULL::uuid[], p_account_ids text[] DEFAULT NULL::text[], p_campaign_name_contains text DEFAULT NULL::text, p_adset_name_contains text DEFAULT NULL::text, p_ad_name_contains text DEFAULT NULL::text, p_action_type text DEFAULT NULL::text, p_group_keys text[] DEFAULT NULL::text[], p_window integer DEFAULT 5)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
 SET work_mem TO '32MB'
AS $function$
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
$function$
;
REVOKE ALL ON FUNCTION public.fetch_manager_performance_series_v171(uuid, date, date, text, uuid[], text[], text, text, text, text, text[], integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fetch_manager_performance_series_v171(uuid, date, date, text, uuid[], text[], text, text, text, text, text[], integer) TO authenticated, service_role;

-- O wrapper que o backend chama passa a apontar para a v171. É por aqui que se volta
-- atrás (a v145 continua existindo, intacta).
CREATE OR REPLACE FUNCTION public.fetch_manager_rankings_series_v2(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text DEFAULT 'ad_name'::text, p_pack_ids uuid[] DEFAULT NULL::uuid[], p_account_ids text[] DEFAULT NULL::text[], p_campaign_name_contains text DEFAULT NULL::text, p_adset_name_contains text DEFAULT NULL::text, p_ad_name_contains text DEFAULT NULL::text, p_action_type text DEFAULT NULL::text, p_group_keys text[] DEFAULT NULL::text[], p_window integer DEFAULT 5)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
  select public.fetch_manager_performance_series_v171(
    p_user_id, p_date_start, p_date_stop, p_group_by, p_pack_ids, p_account_ids,
    p_campaign_name_contains, p_adset_name_contains, p_ad_name_contains, p_action_type,
    p_group_keys, p_window
  )
$function$;

CREATE OR REPLACE FUNCTION public.fetch_entity_performance_v171(p_user_id uuid, p_date_start date, p_date_stop date, p_entity text, p_entity_id text, p_pack_ids uuid[] DEFAULT NULL::uuid[], p_group_by text DEFAULT 'entity'::text, p_include_curve boolean DEFAULT false, p_series_days integer DEFAULT NULL::integer, p_include_custom boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
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
$function$
;
REVOKE ALL ON FUNCTION public.fetch_entity_performance_v171(uuid, date, date, text, text, uuid[], text, boolean, integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fetch_entity_performance_v171(uuid, date, date, text, text, uuid[], text, boolean, integer, boolean) TO authenticated, service_role;

COMMENT ON FUNCTION public.fetch_manager_performance_series_v171(uuid, date, date, text, uuid[], text[], text, text, text, text, text[], integer) IS
  '171: a série do Manager (v145) com a regra da 170 — variação de imagem não contribui para métrica de vídeo; com plays em 0 o dia sai NULL na série.';
COMMENT ON FUNCTION public.fetch_entity_performance_v171(uuid, date, date, text, text, uuid[], text, boolean, integer, boolean) IS
  '171: o detalhe de entidade (v158) com a regra da 170 — vale para totais, série e curva de retenção.';

-- Prova no próprio arquivo: as duas novas existem, são SECURITY DEFINER, anon não
-- executa, as antigas continuam de pé (volta atrás) e o wrapper aponta para a v171.
DO $$
DECLARE v_src text;
BEGIN
  IF has_function_privilege('anon', 'public.fetch_manager_performance_series_v171(uuid, date, date, text, uuid[], text[], text, text, text, text, text[], integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fetch_entity_performance_v171(uuid, date, date, text, text, uuid[], text, boolean, integer, boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION '171: anon consegue executar';
  END IF;
  IF (SELECT count(*) FROM pg_proc WHERE proname IN ('fetch_manager_performance_series_v145','fetch_entity_performance_v158')) <> 2 THEN
    RAISE EXCEPTION '171: as funcoes antigas sumiram — elas sao a volta atras';
  END IF;
  SELECT prosrc INTO v_src FROM pg_proc WHERE proname = 'fetch_manager_rankings_series_v2';
  IF position('series_v171' in v_src) = 0 THEN
    RAISE EXCEPTION '171: o wrapper da serie nao aponta para a v171';
  END IF;
  FOR v_src IN SELECT prosrc FROM pg_proc WHERE proname IN ('fetch_manager_performance_series_v171','fetch_entity_performance_v171') LOOP
    IF (length(v_src) - length(replace(v_src, 'media_type = ''image''', ''))) / length('media_type = ''image''') < 7 THEN
      RAISE EXCEPTION '171: faltou trava em alguma das sete colunas de video';
    END IF;
  END LOOP;
END;
$$;

COMMIT;
