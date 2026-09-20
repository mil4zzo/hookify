-- ===========================================================================
-- 172 — A CURVA DE RETENÇÃO SEGUE A REGRA DE IMAGEM
--
-- Terceira e última porta da regra "métrica de vídeo não se aplica a anúncio de
-- imagem". A 170 tratou as linhas do Manager; a 171, a série e o detalhe do modal;
-- faltava `fetch_manager_rankings_retention_v2`, que o backend chama direto
-- (`/analytics/rankings/retention`) para desenhar a curva de um grupo. Ela lê
-- `ad_metrics` cru e pondera por plays sem olhar o formato.
--
-- ACHADO DA REVISÃO (20/09): a 171 PIOROU a exposição a esta função. Como o detalhe
-- passou a devolver curva vazia para imagem, o modal conclui "não veio curva da fonte
-- primária" e cai no fallback — ou seja, passou a chamar MAIS a função não tratada.
-- Na cópia de produção são 453 linhas-dia de 82 anúncios de imagem com curva.
--
-- ONDE ENTRA: no CTE `filtered`, sobre a linha anúncio-dia, como nas outras duas. Com
-- plays em 0, o `where t.plays > 0` de `curve_points` descarta a linha e a resposta sai
-- com a curva vazia — que é o que a tela já espera de um estático.
--
-- VOLTA ATRÁS sem deploy: `ANALYTICS_RETENTION_RPC=fetch_manager_rankings_retention_v2`.
-- A função antiga fica intacta.
--
-- PROVA: supabase/tests/172_curva_em_imagem.test.sql.
-- ===========================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.fetch_manager_rankings_retention_v172(p_user_id uuid, p_date_start date, p_date_stop date, p_group_by text DEFAULT 'ad_name'::text, p_pack_ids uuid[] DEFAULT NULL::uuid[], p_account_ids text[] DEFAULT NULL::text[], p_campaign_name_contains text DEFAULT NULL::text, p_adset_name_contains text DEFAULT NULL::text, p_ad_name_contains text DEFAULT NULL::text, p_group_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
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
$function$
;

REVOKE ALL ON FUNCTION public.fetch_manager_rankings_retention_v172(uuid, date, date, text, uuid[], text[], text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fetch_manager_rankings_retention_v172(uuid, date, date, text, uuid[], text[], text, text, text, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.fetch_manager_rankings_retention_v172(uuid, date, date, text, uuid[], text[], text, text, text, text) IS
  '172: a curva de retenção do Manager (v2) com a regra da 170 — variação de imagem não entra na curva (plays zerado, e o filtro plays > 0 a descarta).';

DO $$
DECLARE v_src text;
BEGIN
  IF has_function_privilege('anon', 'public.fetch_manager_rankings_retention_v172(uuid, date, date, text, uuid[], text[], text, text, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION '172: anon consegue executar';
  END IF;
  IF (SELECT count(*) FROM pg_proc WHERE proname = 'fetch_manager_rankings_retention_v2') <> 1 THEN
    RAISE EXCEPTION '172: a v2 sumiu — ela é a volta atrás sem deploy';
  END IF;
  SELECT prosrc INTO v_src FROM pg_proc WHERE proname = 'fetch_manager_rankings_retention_v172';
  IF position('adm.media_type = ''image''' in v_src) = 0 THEN
    RAISE EXCEPTION '172: a trava de imagem nao esta na funcao';
  END IF;
END;
$$;

COMMIT;
