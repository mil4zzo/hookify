-- ===========================================================================
-- 161 — Manager em colunas, com TODAS as linhas
-- ===========================================================================
--
-- O INCIDENTE (16/09/2026)
-- ------------------------
-- A aba "Por anúncio" do Igor (7 packs, 26/08–15/09) dava 500: `57014` aos 20 s.
-- Sem limite de tempo, a consulta levava 39–44 s — falharia também com os 30 s de
-- antes da 159. E, quando terminava, entregava só 10 mil das 26.015 linhas: o
-- `limit: 10000` nasceu em 03/2026 como "remover o limite de 1.000", e a função
-- repetia o teto. Com o corte, as SOMAS do cabeçalho (calculadas no navegador) e os
-- filtros enxergavam só a fatia de maior gasto.
--
-- A MÁQUINA IMPORTA
-- -----------------
-- Produção roda com 256 MB de memória para um banco de 1,2 GB (`ads` sozinha tem
-- 548 MB). Toda leitura aleatória por anúncio vira espera de disco: no laboratório
-- (tudo em memória) a mesma consulta levava uma fração do tempo. Por isso cada
-- mudança abaixo foi medida EM PRODUÇÃO, com o plano real.
--
-- O QUE MUDA (e quanto pesava, medido em produção no caso do Igor)
-- ----------------------------------------------------------------
-- 1. Mídia, transcrição e tags lidas UMA vez por nome e consultadas num dicionário
--    (antes: uma lateral por linha relendo os anúncios irmãos — N², ~9 s).
-- 2. Nada de junção entre etapas no enriquecimento: histogramas, dados do pai e a
--    ordem viram dicionários {chave: valor} lidos por subconsulta escalar (a lição
--    da 157 — no laboratório, uma estimativa trocada fez `leads_by_group` ser relido
--    inteiro por linha: 67 milhões de linhas, ~15 s).
-- 3. Nomes do representante vindos da linha de `ads` que já é lida para a
--    miniatura, e não da linha do dia em `ad_metrics` (26 mil buscas, ~99 MB de disco
--    por requisição, 12,4 s). Iguais hoje: nenhum dos 58.499 anúncios de produção
--    teve mais de um nome. `ad_metrics` fica como plano B, que só roda sem `ads`.
-- 4. Dicionário `names` montado com os nomes que as linhas já trouxeram; `ads` só
--    para o id desconhecido (antes: 54 mil buscas, ~26 s no pior caso).
-- 5. A ordem calculada sobre `grp` (estreito) e entregue como `row_order`; as linhas
--    largas não são ordenadas nem copiadas no meio do caminho (antes: ~200 MB de
--    arquivos temporários por requisição).
-- 6. Teto de 100 mil linhas (rede de segurança) em vez de 10 mil.
-- 7. Saída em COLUNAS (`data_columns`: listas por campo) — 1,98 -> 1,08 MB na rede
--    por 10 mil linhas.
-- 8. Absorve o que vinha DEPOIS da consulta, para o backend só repassar os bytes:
--    o invólucro `fetch_manager_rankings_core_v2` (status/orçamento/moeda nas abas de
--    conjunto e campanha, agora por conjunto) e a hidratação Python da rota
--    (miniatura do Storage, `status_resolved`).
-- 9. O filtro por campanha (antes um "fold" que relia o JSON pronto) vira um WHERE.
--
-- RESULTADO (produção, 16/09, v155+core_v2 -> v161)
-- -------------------------------------------------
--   por anúncio, 7 packs (26.015 linhas) ... 39–44 s, cortado em 10 mil -> 7,7–10,6 s, completo
--   por conjunto, 38 packs ................ 21,8 s (estourava os 20 s)   -> 11,7 s
--   por criativo, 38 packs ................ 16,6–17,7 s                   -> 12,8–17,1 s
--   por campanha, 38 packs ................ 13,3 s                        -> 12,1 s
--   por anúncio, 38 packs, 120 dias (51 mil linhas) ...................... 36–45 s — AINDA
--     passa dos 20 s. O que sobra é CPU (montar o JSON) e leitura de `ads`; ver o
--     plano pós-157, Bloco 7.
--
-- CONTRATO: para cada linha, o objeto que o frontend monta é o MESMO de antes
-- (mesmas chaves, mesmos valores, mesma ordem) — provado pelo diferencial
-- `backend/scripts/diff_manager_v161.py` (591 cenários do laboratório, 344.605
-- linhas, zero divergências), que compara a resposta HTTP antiga (v155 + core_v2 +
-- hidratação Python) com a nova convertida de volta em linhas. Os ramos que os dados
-- reais não exercitam estão em `supabase/tests/161_manager_em_colunas.test.sql`.
--
-- ROLLBACK: a v155 e o core_v2 ficam intactos; `ANALYTICS_MANAGER_V161=false` no
-- backend volta a chamá-los sem novo deploy de código.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Codificação de caminho igual ao `_quote_path` do backend:
--   "/".join(quote(seg, safe="") for seg in path.split("/"))
-- `quote` mantém A-Z a-z 0-9 _ . - ~ e escreve o resto como %XX (maiúsculo), byte a
-- byte do UTF-8. Em 16/09 os 71.515 caminhos de produção eram todos do conjunto
-- seguro — o laço só roda no caso raro; o atalho devolve o próprio texto.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.url_quote_path(p text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE STRICT
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

REVOKE ALL ON FUNCTION public.url_quote_path(text) FROM PUBLIC, anon;

COMMENT ON FUNCTION public.url_quote_path(text) IS
  '161: mesma codificação do _quote_path do backend (quote por segmento, safe=""). Usada para montar a URL pública da miniatura no Storage.';

CREATE OR REPLACE FUNCTION public.fetch_manager_rankings_v161(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text DEFAULT 'ad_name'::text, p_pack_ids uuid[] DEFAULT NULL::uuid[], p_account_ids text[] DEFAULT NULL::text[], p_campaign_name_contains text DEFAULT NULL::text, p_adset_name_contains text DEFAULT NULL::text, p_ad_name_contains text DEFAULT NULL::text, p_action_type text DEFAULT NULL::text, p_include_leadscore boolean DEFAULT true, p_include_available_conversion_types boolean DEFAULT true, p_limit integer DEFAULT 500, p_offset integer DEFAULT 0, p_order_by text DEFAULT 'spend'::text, p_campaign_id text DEFAULT NULL::text, p_include_custom boolean DEFAULT false, p_thumb_public_prefix text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
 SET work_mem TO '32MB'
AS $function$
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
$function$
;

-- EXECUTE só para quem chama pela API (o default de PUBLIC seria cross-tenant numa
-- SECURITY DEFINER — ver migration 149/150).
REVOKE ALL ON FUNCTION public.fetch_manager_rankings_v161(uuid, date, date, text, uuid[], text[], text, text, text, text, boolean, boolean, integer, integer, text, text, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fetch_manager_rankings_v161(uuid, date, date, text, uuid[], text[], text, text, text, text, boolean, boolean, integer, integer, text, text, boolean, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.fetch_manager_rankings_v161(uuid, date, date, text, uuid[], text[], text, text, text, text, boolean, boolean, integer, integer, text, text, boolean, text) IS
  '161: Manager (4 abas) em colunas e sem o corte de 10 mil. v155 sem as laterais N² por nome, com o core_v2, a miniatura do Storage e o status_resolved absorvidos. Saída: data_columns (lista de blocos {campo: [valores]}), row_count e row_order (posição final de cada linha; o leitor reordena).';

-- Prova no próprio arquivo: configuração de plano e permissões.
DO $$
DECLARE
  v_cfg text[];
BEGIN
  SELECT proconfig INTO v_cfg FROM pg_proc
  WHERE oid = 'public.fetch_manager_rankings_v161(uuid, date, date, text, uuid[], text[], text, text, text, text, boolean, boolean, integer, integer, text, text, boolean, text)'::regprocedure;
  IF v_cfg IS NULL OR NOT ('plan_cache_mode=force_custom_plan' = ANY(v_cfg)) THEN
    RAISE EXCEPTION '161: v161 sem plan_cache_mode. proconfig=%', v_cfg;
  END IF;
  IF has_function_privilege('anon', 'public.fetch_manager_rankings_v161(uuid, date, date, text, uuid[], text[], text, text, text, text, boolean, boolean, integer, integer, text, text, boolean, text)', 'EXECUTE') THEN
    RAISE EXCEPTION '161: anon consegue executar a v161';
  END IF;
  IF public.url_quote_path('thumbs/u1/abc-1_2.webp') <> 'thumbs/u1/abc-1_2.webp'
     OR public.url_quote_path('a b/ç€') <> 'a%20b/%C3%A7%E2%82%AC' THEN
    RAISE EXCEPTION '161: url_quote_path diverge do quote() do Python';
  END IF;
END;
$$;

COMMIT;
