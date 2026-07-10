-- Migration: read-path de orçamento (Fases 0 e 1 do gerenciamento de budget).
--
-- Contexto: budgets da Meta são int64 em SUBUNIDADE da moeda da conta de anúncio
-- (offset 100 na maioria; moedas sem centavos como JPY usam offset 1), e vivem na
-- campanha (CBO/Advantage Campaign Budget) OU nos adsets (ABO) — nunca nos dois.
--
-- 1. ad_accounts.currency: moeda da conta (GET /act_{id}?fields=currency), pré-requisito
--    para formatar/converter qualquer budget. Preenche no próximo /adaccounts/sync ou connect.
--
-- 2. parent_entities: snapshot por entidade-pai (orçamento + status), keyed por
--    (user_id, entity_id). DIFERENTE do status (poucos valores distintos → UPDATE agrupado
--    nas colunas denormalizadas de ads), budget é alta-cardinalidade — cada campanha/adset
--    tem um valor próprio, e o padrão de UPDATE-por-valor viraria 1 UPDATE por entidade.
--    Tabela dedicada permite um upsert único por sync e elimina por construção a classe de
--    divergência entre linhas do mesmo pai. Escrita: supabase_repo.upsert_parent_entities
--    (edges /act_{id}/campaigns|adsets no enrich do refresh + sync on-focus TTL 5min).
--    Semântica de NULL em daily/lifetime: entidade PRESENTE no edge sem budget grava NULL
--    (verdade — ex.: campanha ABO não tem budget próprio); entidade AUSENTE não é tocada.
--    effective_status: DOUBLE-WRITE PASSIVO — o read-path do status continua nas colunas
--    ads.adset_status/campaign_status (088/089); esta coluna acumula backfill e confiança
--    para a migração futura do status para cá (só sync de conta inteira escreve aqui; os
--    writes pontuais do toggle/self-heal ainda não).
--
-- 3. Entry fetch_manager_rankings_core_v2: recriada (corpo da 090, base v090 inalterada)
--    anexando budget_daily/budget_lifetime (da própria entidade da linha), budget_mode
--    (da campanha: cbo|abo|abo_shared) e budget_currency (ad_accounts.currency) às linhas
--    das abas por-conjunto/por-campanha.
--
-- Aplicar ANTES do deploy do backend/frontend. Safe to run multiple times.

alter table public.ad_accounts add column if not exists currency text;
comment on column public.ad_accounts.currency is 'Moeda da conta de anúncio (ex.: BRL, USD, JPY). Fonte: Meta API /me/adaccounts?fields=currency. Budgets/spend da Meta são expressos em subunidade desta moeda. NULL = ainda não sincronizado.';

create table if not exists public.parent_entities (
  user_id uuid not null,
  entity_id text not null,
  level text not null check (level in ('campaign', 'adset')),
  account_id text,
  campaign_id text,
  daily_budget bigint,
  lifetime_budget bigint,
  budget_mode text check (budget_mode in ('cbo', 'abo', 'abo_shared')),
  effective_status text,
  updated_at timestamp with time zone not null default now(),
  primary key (user_id, entity_id)
);

comment on table public.parent_entities is 'Snapshot de orçamento de campanhas/adsets lido dos edges da Meta (enrich do refresh + sync on-focus). Valores em SUBUNIDADE da moeda da conta (ver ad_accounts.currency). daily/lifetime NULL = entidade sem budget nesse nível (ex.: campanha ABO).';
comment on column public.parent_entities.level is 'campaign | adset (nível da entidade entity_id)';
comment on column public.parent_entities.campaign_id is 'Para level=adset: campanha pai (o budget_mode dela diz se o budget vive no adset). NULL para campanhas.';
comment on column public.parent_entities.budget_mode is 'Só level=campaign: cbo (Advantage Campaign Budget — budget na campanha) | abo (budget nos adsets) | abo_shared (ABO com is_adset_budget_sharing_enabled — Meta move até 20% entre adsets).';
comment on column public.parent_entities.effective_status is 'DOUBLE-WRITE PASSIVO: effective_status oficial do pai. Read-path do status segue em ads.adset_status/campaign_status até a migração deliberada; escrito apenas pelos syncs de conta inteira (enrich/on-focus), não pelos writes pontuais do toggle.';

alter table public.parent_entities enable row level security;

drop policy if exists parent_entities_modify_own on public.parent_entities;
create policy parent_entities_modify_own on public.parent_entities
  using ((user_id = ( select auth.uid() as uid)))
  with check ((user_id = ( select auth.uid() as uid)));

grant all on table public.parent_entities to authenticated;
grant all on table public.parent_entities to service_role;

--
-- Entry: recriada com enriquecimento de budget nas linhas de adset/campanha.
-- Corpo idêntico ao da migration 090 exceto os laterais pb_self/pb_mode/acct e as
-- 4 chaves novas no jsonb_build_object.
--

create or replace function public.fetch_manager_rankings_core_v2(
  p_user_id uuid,
  p_date_start date,
  p_date_stop date,
  p_group_by text default 'ad_name'::text,
  p_pack_ids uuid[] default null::uuid[],
  p_account_ids text[] default null::text[],
  p_campaign_name_contains text default null::text,
  p_adset_name_contains text default null::text,
  p_ad_name_contains text default null::text,
  p_action_type text default null::text,
  p_include_leadscore boolean default true,
  p_include_available_conversion_types boolean default true,
  p_limit integer default 500,
  p_offset integer default 0,
  p_order_by text default 'spend'::text,
  p_campaign_id text default null::text
) returns jsonb
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_group_by text := lower(coalesce(p_group_by, 'ad_name'));
  v_payload jsonb;
  v_data jsonb := '[]'::jsonb;
begin
  select public.fetch_manager_rankings_core_v2_base_v090(
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
        'budget_currency', acct.currency
      ) as item
    from raw_rows rr
    left join lateral (
      select pb.daily_budget, pb.lifetime_budget, pb.account_id
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

comment on function public.fetch_manager_rankings_core_v2(uuid, date, date, text, uuid[], text[], text, text, text, text, boolean, boolean, integer, integer, text, text) is
  'Manager core v2 wrapper: resolves campaign/adset effective_status preferring the official denormalized parent status (ads.adset_status/campaign_status), falling back to hierarchical pause markers for pre-backfill rows; enriches adset/campaign rows with budget (parent_entities + ad_accounts.currency). Base: v090.';
