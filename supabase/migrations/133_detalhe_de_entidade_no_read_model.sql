-- 133: telas de detalhe (7 rotas) sobre o read model — uma matemática só.
--
-- O PROBLEMA (2026-08-27)
-- ------------------------
-- As 7 rotas de detalhe do Manager (anúncio, criativo, conjunto; filhos; histórico
-- por dia) baixavam as linhas CRUAS de `ad_metrics` via PostgREST — com os JSONs de
-- `actions`, `conversions`, `leadscore_values` e a curva inteira — e somavam em
-- Python. Sete cópias do mesmo bloco, cada uma com o próprio fallback de `lpv`, o
-- próprio dedup de pack compartilhado e a própria derivação de conversão. Isso era
-- uma SEGUNDA implementação da matemática que `ad_performance_daily` (migration 129)
-- faz em SQL: o número do Manager e o número do modal saíam de dois códigos
-- diferentes, e o diferencial das migrations 130-132 nunca cobriu o modal.
--
-- Verificado no laboratório (260.709 anúncio-dias) antes de desenhar: a matemática
-- por linha é idêntica nos dois lados — hook (hook_rate nunca preenchido → curva[3]),
-- scroll-stop (scroll_stop_rate nunca nulo com curva), lpv (coluna nunca zerada com
-- landing_page_view em actions), p50/p75 e curva sem casas decimais.
--
-- O QUE ESTA FUNÇÃO FAZ
-- ---------------------
-- `fetch_entity_performance_v133`: dado UM entidade (ad_id | ad_name | adset_id) e o
-- escopo (packs selecionados ou, no ramo legado, o silo do ator), devolve por grupo
-- (a entidade, ou cada ad_id dela quando p_group_by = 'ad_id'):
--   * os TOTAIS do período (somas já ponderadas: hook_wsum = Σ hook×plays etc.,
--     conversões {chave: valor}, histograma de leads {score: qtd}) e uma linha por
--     DIA da janela pedida (p_series_days; NULL = o período todo, para o histórico)
--     — tudo do read model, sem JSON;
--   * a linha representante (mesma regra da RPC do Manager: dia de mais impressões,
--     desempate ad_id) para nomes de campanha/conjunto/anúncio, status e miniatura
--     (com fallback para qualquer cópia do grupo, como a v132);
--   * opcionalmente a curva de retenção ponderada por plays — a ÚNICA leitura de
--     `ad_metrics` além das chaves e da linha representante, porque a curva completa
--     não está no read model (guardá-la custaria ~80 MB por 260 mil linhas para uma
--     aba que se abre por entidade).
-- As razões finais (ctr, cpm, frequência…), a série de 5 dias e o formato de cada
-- rota continuam em Python — mas em UM agregador compartilhado
-- (app/services/entity_performance.py), não em sete.
--
-- CHAVES: descobertas pelos índices de `ad_metrics` (user_id, ad_name, date, ad_id) e
-- (user_id, adset_id, date) — por entidade, centenas a poucos milhares de linhas —
-- e os números vêm de `ad_performance_daily` pela PK. Zero índice novo (os dois que
-- o read model precisaria custariam ~30 MB numa instância de 1 GB).
--
-- Escopo e dedup cross-silo: os MESMOS da base v130/v132 (resolve_pack_access;
-- vence o silo do dono do pack compartilhado, desempate por uuid). Pack inacessível
-- na seleção = 42501, como no Manager.
--
-- Contrato provado por `backend/scripts/diff_entity_routes.py` (rota antiga em Python
-- × rota nova, sobre o laboratório). Rollback: as rotas antigas estão no git
-- (commit anterior à 133); a função pode ficar.

CREATE OR REPLACE FUNCTION public.fetch_entity_performance_v133(
  p_user_id uuid,
  p_date_start date,
  p_date_stop date,
  p_entity text,
  p_entity_id text,
  p_pack_ids uuid[] DEFAULT NULL,
  p_group_by text DEFAULT 'entity',
  p_include_curve boolean DEFAULT false,
  p_series_days integer DEFAULT NULL
) RETURNS jsonb
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

COMMENT ON FUNCTION public.fetch_entity_performance_v133(uuid, date, date, text, text, uuid[], text, boolean, integer) IS
'Detalhe de UMA entidade (ad_id|ad_name|adset_id) sobre o read model ad_performance_daily (migration 133): por grupo (entidade ou cada ad_id), linhas por dia com somas ponderadas, conversoes e histograma de leads; representante (regra do Manager) para nomes/status/miniatura; curva de retencao ponderada opcional (unica leitura de JSON, por entidade). Substitui as 7 rotas que somavam ad_metrics cru em Python. Escopo/dedup identicos a base v130.';

-- Só o ator autenticado (a função exige auth.uid() = p_user_id) e o backend.
REVOKE ALL ON FUNCTION public.fetch_entity_performance_v133(uuid, date, date, text, text, uuid[], text, boolean, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fetch_entity_performance_v133(uuid, date, date, text, text, uuid[], text, boolean, integer) TO authenticated, service_role;
