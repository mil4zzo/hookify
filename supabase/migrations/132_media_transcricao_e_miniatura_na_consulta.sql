-- 132: media_type, has_transcription e miniatura do grupo calculados NA consulta.
--
-- O QUE A MEDIÇÃO MOSTROU (2026-08-27, cenário real de 3 packs, 397 linhas)
-- --------------------------------------------------------------------------
-- A RPC do Manager volta em 1,2 s, mas a rota /rankings levava 4,5-7,5 s na tela. O
-- resto era "hidratação" via PostgREST, medida rodada a rodada:
--   thumbnails    0,9 s   1 requisição    397 linhas  — e 396 já vinham na própria RPC
--   transcrição   0,3 s   2 requisições   280 linhas
--   tipo de mídia 8,5 s (fria) / 2,2 s (quente)  15 requisições  13.764 linhas
-- A última buscava TODAS as cópias de cada criativo (um nome = dezenas de anúncios;
-- 397 nomes = 13.764 linhas de `ads`, paginadas de 1000 em 1000) para decidir se o
-- grupo é vídeo ou imagem. Verificado no banco: o tipo é consistente entre cópias
-- (0 nomes mistos em 3.451); 38 têm alguma cópia sem tipo, por isso a regra "maior
-- precedência entre as cópias" fica — mas por índice, dentro da consulta.
--
-- O QUE MUDA
-- ----------
-- 1. Índice de cobertura (user_id, ad_name) INCLUDE (media_type) em `ads`: o tipo de
--    mídia de um criativo é um index-only scan de ~40 entradas.
-- 2. O índice de status (user_id, ad_id) passa a incluir thumb_storage_path: o lookup
--    por anúncio que a base já faz (per_ad_status) traz a miniatura de cada cópia sem
--    tocar a heap de `ads` (276 MB).
-- 3. Base v132 = v130 + `media_type`, `has_transcription` (só nos níveis de criativo/
--    anúncio, como a hidratação fazia) e `thumb_storage_path` com fallback para qualquer
--    cópia do grupo — fecha os 13 de 3.451 criativos cujo representante não tem
--    miniatura mas uma cópia tem (a hidratação antiga não cobria esse caso).
-- 4. A rota só hidrata o que a linha NÃO trouxer (backend detecta a presença da chave):
--    com a v132 no ar, zero requisições ao PostgREST depois da RPC.
--
-- Contrato: v130 + 2 campos; `thumbnail`/`thumb_storage_path` só mudam onde o
-- representante não tinha miniatura. Provado por `diff_rankings_rollup.py --v132`.
-- Rollback = reaplicar a migration 130 (entry → v130); os índices podem ficar.

-- ============================================================================
-- 1. Índices
-- ============================================================================

CREATE INDEX IF NOT EXISTS ads_user_ad_name_media_idx
  ON public.ads USING btree (user_id, ad_name) INCLUDE (media_type);

COMMENT ON INDEX public.ads_user_ad_name_media_idx IS
'Tipo de mídia por (usuário, nome do criativo) sem tocar a heap (migration 132): media_type do grupo = maior precedência entre as cópias.';

-- Rebuild do índice de cobertura de status com thumb_storage_path (não dá para ADD
-- INCLUDE num índice existente). 8 MB: segundos.
DROP INDEX IF EXISTS public.ads_user_ad_status_idx;
CREATE INDEX ads_user_ad_status_idx
  ON public.ads USING btree (user_id, ad_id) INCLUDE (effective_status, meta_created_time, thumb_storage_path);

COMMENT ON INDEX public.ads_user_ad_status_idx IS
'Cobertura do lookup por anúncio da RPC do Manager (migrations 124/132): status, data de criação e caminho da miniatura no Storage, index-only.';

-- ============================================================================
-- 2. A base
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fetch_manager_performance_base_v132(
  p_user_id uuid, p_date_start date, p_date_stop date,
  p_group_by text DEFAULT 'ad_name'::text, p_pack_ids uuid[] DEFAULT NULL::uuid[],
  p_account_ids text[] DEFAULT NULL::text[], p_campaign_name_contains text DEFAULT NULL::text,
  p_adset_name_contains text DEFAULT NULL::text, p_ad_name_contains text DEFAULT NULL::text,
  p_action_type text DEFAULT NULL::text, p_include_leadscore boolean DEFAULT true,
  p_include_available_conversion_types boolean DEFAULT true, p_limit integer DEFAULT 500,
  p_offset integer DEFAULT 0, p_order_by text DEFAULT 'spend'::text, p_campaign_id text DEFAULT NULL::text
) RETURNS jsonb
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

COMMENT ON FUNCTION public.fetch_manager_performance_base_v132(uuid, date, date, text, uuid[], text[], text, text, text, text, boolean, boolean, integer, integer, text, text) IS
'Manager base v132 (migration 132): a v130 + media_type, has_transcription e fallback de miniatura (qualquer copia do grupo) calculados na consulta - a rota deixa de hidratar via PostgREST (medido: 15 requisicoes e 13,7 mil linhas por carga so para o tipo de midia).';

-- ============================================================================
-- 3. Entry repontada (mesmo corpo da migration 122; só troca a base)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fetch_manager_rankings_core_v2(
  p_user_id uuid, p_date_start date, p_date_stop date,
  p_group_by text DEFAULT 'ad_name'::text, p_pack_ids uuid[] DEFAULT NULL::uuid[],
  p_account_ids text[] DEFAULT NULL::text[], p_campaign_name_contains text DEFAULT NULL::text,
  p_adset_name_contains text DEFAULT NULL::text, p_ad_name_contains text DEFAULT NULL::text,
  p_action_type text DEFAULT NULL::text, p_include_leadscore boolean DEFAULT true,
  p_include_available_conversion_types boolean DEFAULT true, p_limit integer DEFAULT 500,
  p_offset integer DEFAULT 0, p_order_by text DEFAULT 'spend'::text, p_campaign_id text DEFAULT NULL::text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_group_by text := lower(coalesce(p_group_by, 'ad_name'));
  v_payload jsonb;
  v_data jsonb := '[]'::jsonb;
begin
  select public.fetch_manager_performance_base_v132(
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

COMMENT ON FUNCTION public.fetch_manager_rankings_core_v2(uuid, date, date, text, uuid[], text[], text, text, text, text, boolean, boolean, integer, integer, text, text) IS
'Manager core v2 wrapper: resolve o effective_status de campanha/conjunto a partir de parent_entities (migration 122), enriquece linhas de adset/campanha com budget e ad_count do inventario. Base: fetch_manager_performance_base_v132 (migration 132). Rollback: reaplicar a migration 130 (v130) ou a 122 (v116).';
