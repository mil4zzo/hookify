-- 122: read-path do status de pai passa de `ads` para `parent_entities`.
--
-- POR QUE
-- -------
-- Medido em 2026-08-25 via pg_stat_statements (janela real de uso pos-crash):
-- as tres escritas de status em `ads` + a varredura que as acompanha somam
-- ~43% de todo o tempo de banco do app. A causa e amplificacao: para registrar
-- o status de 1.188 campanhas o app reescreve 70.982 linhas de `ads` (59,7x);
-- nos conjuntos, 19,4x. Cada UPDATE gera ~11 MB de WAL.
--
-- `parent_entities` (migration 091) existe exatamente para isso: UMA linha por
-- pai. Ela ja e escrita ha semanas, mas ninguem le o status dela.
--
-- TESTE DIFERENCIAL (pre-requisito, executado antes desta migration)
-- ------------------------------------------------------------------
-- Comparadas as duas fontes sobre os dados reais:
--   campanhas: 3.183 comparacoes, 0 divergentes, 17 so em `ads` (todos NULL)
--   conjuntos: 9.542 comparacoes, 0 divergentes, 69 so em `ads` (todos NULL)
-- Nenhuma divergencia; toda lacuna e linha onde `ads` nao tem nada a oferecer.
-- `parent_entities` e fonte estritamente melhor.
--
-- O BLOQUEADOR QUE PRECISOU CAIR ANTES
-- ------------------------------------
-- Ate 2026-08-25 o caminho do TOGGLE gravava status so em `ads`; a
-- `parent_entities` so recebia dos syncs de conta inteira. Trocar a leitura
-- sem fechar isso faria a entidade recem-pausada continuar aparecendo ativa
-- ate o proximo sync. O double-write foi fechado no passo 1 (backend), com
-- testes em tests/test_parent_entities_double_write.py.
--
-- O QUE MUDA AQUI
-- ---------------
-- Apenas a FONTE do status na funcao de ENTRADA. A base pesada (_base_v116)
-- nao e tocada: ela nunca leu status.
--
--   antes: subconsulta correlacionada em `ads` por linha, com
--          ORDER BY updated_at DESC LIMIT 1 sobre ~60 linhas por pai
--   agora: a lateral `pb_self` que JA e feita para budget passa a trazer
--          tambem o effective_status — busca por chave primaria
--          (user_id, entity_id), uma linha, sem ordenacao. Zero join novo.
--
-- O fallback por marcadores nos filhos (migration 088) permanece intacto,
-- cobrindo pais sem linha em `parent_entities`.
--
-- NAO MUDA: `ads.adset_status` / `ads.campaign_status` continuam sendo
-- escritas. Esta migration so troca a LEITURA — as colunas ficam como rede de
-- rollback ate o passo 3 parar de escreve-las, em migration separada.

-- ATENCAO: CREATE OR REPLACE FUNCTION DESCARTA as clausulas SET nao
-- respecificadas. Foi assim que a `series_v2` ficou meses sem
-- `plan_cache_mode` (ver backend/scripts/check_plan_cache_mode.py).
-- `SET search_path` abaixo e obrigatorio, nao decorativo.
CREATE OR REPLACE FUNCTION public.fetch_manager_rankings_core_v2(
  p_user_id uuid,
  p_date_start date,
  p_date_stop date,
  p_group_by text DEFAULT 'ad_name'::text,
  p_pack_ids uuid[] DEFAULT NULL::uuid[],
  p_account_ids text[] DEFAULT NULL::text[],
  p_campaign_name_contains text DEFAULT NULL::text,
  p_adset_name_contains text DEFAULT NULL::text,
  p_ad_name_contains text DEFAULT NULL::text,
  p_action_type text DEFAULT NULL::text,
  p_include_leadscore boolean DEFAULT true,
  p_include_available_conversion_types boolean DEFAULT true,
  p_limit integer DEFAULT 500,
  p_offset integer DEFAULT 0,
  p_order_by text DEFAULT 'spend'::text,
  p_campaign_id text DEFAULT NULL::text
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_group_by text := lower(coalesce(p_group_by, 'ad_name'));
  v_payload jsonb;
  v_data jsonb := '[]'::jsonb;
begin
  select public.fetch_manager_rankings_core_v2_base_v116(
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
              -- 122: status OFICIAL do conjunto vindo de `parent_entities` (uma
              -- linha por pai, chave primaria). Antes: subconsulta correlacionada
              -- em `ads` com ORDER BY updated_at DESC sobre ~19 linhas por
              -- conjunto. O desempate por recencia existia para o caso de linhas
              -- do MESMO pai divergirem entre si — impossivel por construcao
              -- quando so existe UMA linha por pai.
              nullif(pb_self.effective_status, ''),
              -- Fallback pre-backfill: inferencia por marcadores nos filhos
              -- (migration 088). Cobre pai sem linha em parent_entities e o
              -- caso em que o status foi deliberadamente anulado apos toggle de
              -- campanha cujo re-read dos conjuntos falhou.
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
              nullif(pb_self.effective_status, ''),
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
      -- 122: `effective_status` entra AQUI, na lateral que ja existia para o
      -- budget da propria entidade. Custo adicional de leitura: zero — mesma
      -- linha, mesma busca por chave primaria.
      select pb.daily_budget, pb.lifetime_budget, pb.account_id, pb.ads_count, pb.effective_status
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

COMMENT ON FUNCTION public.fetch_manager_rankings_core_v2(uuid, date, date, text, uuid[], text[], text, text, text, text, boolean, boolean, integer, integer, text, text) IS
'Manager core v2 wrapper: resolve o effective_status de campanha/conjunto a partir de parent_entities (migration 122; antes: colunas denormalizadas ads.adset_status/campaign_status), com fallback por marcadores hierarquicos para pais sem linha; enriquece linhas de adset/campanha com budget (parent_entities + ad_accounts.currency) e ad_count do inventario. Base: v116.';

COMMENT ON COLUMN public.parent_entities.effective_status IS
'effective_status oficial do pai (campanha/conjunto). FONTE DO READ-PATH desde a migration 122. Escrito pelos syncs de conta inteira (enrich/on-focus) E pelo toggle (double-write fechado em 2026-08-25).';

COMMENT ON COLUMN public.ads.adset_status IS
'DEPRECADO como fonte de leitura desde a migration 122 (o read-path do Manager le parent_entities.effective_status). Ainda escrito, como rede de rollback; a remocao da escrita e a queda da coluna vem em migration separada.';

COMMENT ON COLUMN public.ads.campaign_status IS
'DEPRECADO como fonte de leitura desde a migration 122 (o read-path do Manager le parent_entities.effective_status). Ainda escrito, como rede de rollback; a remocao da escrita e a queda da coluna vem em migration separada.';
