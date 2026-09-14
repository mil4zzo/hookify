-- ===========================================================================
-- 154. Inventário do pack: a presença do anúncio ativo sem entrega sai de
--      `ad_metrics` (linhas-zero diárias) e vira UMA linha por (pack, anúncio).
--
-- POR QUE (F5 do plano de eficiência; revisão e medições em 13/09, §8)
-- -------------------------------------------------------------------
-- Medido em produção (13/09):
-- - 549.625 das 705.075 linhas de `ad_metrics` (78%) são zeros sintéticos;
-- - 94% delas pertencem a anúncios hoje pausados ou arquivados;
-- - 162.960 estão em dias ANTERIORES à criação do anúncio.
-- Na tela, dia com zero e dia sem linha dão o mesmo resultado; a única função real da
-- linha-zero é fazer o anúncio EXISTIR no período (lista, contagens, detalhe, pack).
-- 549.625 linhas-zero comprimem em 61.250 intervalos contínuos, sem nenhum com nome ou
-- pai mudando: a informação cabe numa linha por anúncio com duas datas.
--
-- O QUE ESTA MIGRATION FAZ (fase 1 de 5; NÃO muda leitura nem gravação ainda)
-- ------------------------------------------------------------------------
-- 1. `ad_pack_inventory`: (user, pack, anúncio), identidade e o intervalo em que algum
--    refresh viu o anúncio entregável (`first_active_date`, `last_active_date`).
-- 2. `ad_metrics_is_synthetic_zero(ad_metrics)`: o critério ÚNICO de linha-zero
--    sintética. O mesmo critério faz o backfill daqui e a limpeza da fase 4: quem é
--    apagado de `ad_metrics` é exatamente quem virou inventário. Linha com qualquer
--    número, conversão, leadscore ou coluna vinculada NÃO é sintética e fica.
-- 3. `ad_pack_inventory_backfill(p_user_id)`: preenche a partir das sintéticas,
--    descartando as anteriores à criação (tolerância de 1 dia: `meta_created_time` é
--    UTC e `date` é o dia da conta).
-- 4. `merge_ad_pack_inventory(user, pack, rows)`: por onde o refresh vai gravar. Só
--    estende o intervalo (least/greatest), só troca a identidade que mudou e NÃO
--    regrava o que já está igual (mesmo princípio do F7).
--
-- Sem FK para `packs`, como `ad_metrics` desde a 145: a exclusão de pack apaga o
-- inventário no backend (fase 3).
--
-- Teste: supabase/tests/154_inventario_do_pack.test.sql
-- ===========================================================================
BEGIN;

SET LOCAL statement_timeout = 0;

CREATE TABLE IF NOT EXISTS public.ad_pack_inventory (
  user_id uuid NOT NULL,
  pack_id uuid NOT NULL,
  ad_id text NOT NULL,
  account_id text,
  campaign_id text,
  campaign_name text,
  adset_id text,
  adset_name text,
  ad_name text,
  first_active_date date NOT NULL,
  last_active_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ad_pack_inventory_pkey PRIMARY KEY (user_id, pack_id, ad_id),
  CONSTRAINT ad_pack_inventory_interval_check CHECK (first_active_date <= last_active_date)
);

COMMENT ON TABLE public.ad_pack_inventory IS
  'Inventário do pack (F5): uma linha por (pack, anúncio) visto entregável por algum refresh, '
  'com o intervalo [first_active_date, last_active_date]. Substitui as linhas-zero diárias de '
  'ad_metrics como fonte de presença do anúncio ativo sem entrega.';

ALTER TABLE public.ad_pack_inventory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ad_pack_inventory_modify_own ON public.ad_pack_inventory;
CREATE POLICY ad_pack_inventory_modify_own ON public.ad_pack_inventory
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

REVOKE ALL ON TABLE public.ad_pack_inventory FROM PUBLIC, anon;
GRANT ALL ON TABLE public.ad_pack_inventory TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Critério único de linha-zero sintética.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ad_metrics_is_synthetic_zero(m public.ad_metrics)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  select coalesce(m.impressions, 0) = 0
     and coalesce(m.clicks, 0) = 0
     and coalesce(m.inline_link_clicks, 0) = 0
     and coalesce(m.reach, 0) = 0
     and coalesce(m.spend, 0) = 0
     and coalesce(m.lpv, 0) = 0
     and coalesce(m.video_total_plays, 0) = 0
     and coalesce(m.video_total_thruplays, 0) = 0
     and coalesce(m.video_watched_p50, 0) = 0
     and coalesce(m.video_watched_p75, 0) = 0
     and coalesce(m.actions, '[]'::jsonb) in ('[]'::jsonb, '{}'::jsonb, 'null'::jsonb)
     and coalesce(m.conversions, '[]'::jsonb) in ('[]'::jsonb, '{}'::jsonb, 'null'::jsonb)
     and coalesce(m.cost_per_conversion, '[]'::jsonb) in ('[]'::jsonb, '{}'::jsonb, 'null'::jsonb)
     and coalesce(m.video_play_curve_actions, '[]'::jsonb) in ('[]'::jsonb, '{}'::jsonb, 'null'::jsonb)
     and coalesce(cardinality(m.leadscore_values), 0) = 0
     and coalesce(m.custom_hist, '{}'::jsonb) in ('{}'::jsonb, 'null'::jsonb)
$$;

COMMENT ON FUNCTION public.ad_metrics_is_synthetic_zero(public.ad_metrics) IS
  'F5: linha de ad_metrics sem nenhum número, conversão, leadscore ou coluna vinculada — a '
  'linha-zero sintetizada pelo inventário. Critério único do backfill (154) e da limpeza (fase 4).';

REVOKE ALL ON FUNCTION public.ad_metrics_is_synthetic_zero(public.ad_metrics) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ad_metrics_is_synthetic_zero(public.ad_metrics) TO service_role;

-- ---------------------------------------------------------------------------
-- Backfill a partir das linhas-zero sintéticas.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ad_pack_inventory_backfill(p_user_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
declare
  v_count integer;
begin
  with kept as (
    select m.user_id, m.pack_id, m.ad_id, m.date,
           m.account_id, m.campaign_id, m.campaign_name, m.adset_id, m.adset_name, m.ad_name
    from public.ad_metrics m
    left join public.ads a on a.user_id = m.user_id and a.ad_id = m.ad_id
    where (p_user_id is null or m.user_id = p_user_id)
      and public.ad_metrics_is_synthetic_zero(m)
      -- Linha anterior à criação do anúncio não é "ativo sem entrega": é sujeira
      -- (162.960 delas, gravadas numa só noite, 06→07/09). Tolerância de 1 dia: fuso.
      and (a.meta_created_time is null
           or m.date >= (a.meta_created_time at time zone 'UTC')::date - 1)
  ),
  intervals as (
    select user_id, pack_id, ad_id, min(date) as first_d, max(date) as last_d
    from kept
    group by user_id, pack_id, ad_id
  ),
  last_identity as (
    -- Identidade do dia mais recente: é o nome que o anúncio tinha no último refresh.
    select distinct on (k.user_id, k.pack_id, k.ad_id)
           k.user_id, k.pack_id, k.ad_id,
           k.account_id, k.campaign_id, k.campaign_name, k.adset_id, k.adset_name, k.ad_name
    from kept k
    order by k.user_id, k.pack_id, k.ad_id, k.date desc
  )
  insert into public.ad_pack_inventory as inv (
    user_id, pack_id, ad_id, account_id, campaign_id, campaign_name, adset_id, adset_name, ad_name,
    first_active_date, last_active_date
  )
  select i.user_id, i.pack_id, i.ad_id,
         li.account_id, li.campaign_id, li.campaign_name, li.adset_id, li.adset_name, li.ad_name,
         i.first_d, i.last_d
  from intervals i
  join last_identity li using (user_id, pack_id, ad_id)
  on conflict (user_id, pack_id, ad_id) do update set
    first_active_date = least(inv.first_active_date, excluded.first_active_date),
    last_active_date = greatest(inv.last_active_date, excluded.last_active_date),
    updated_at = now()
  where excluded.first_active_date < inv.first_active_date
     or excluded.last_active_date > inv.last_active_date;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

COMMENT ON FUNCTION public.ad_pack_inventory_backfill(uuid) IS
  'F5: preenche ad_pack_inventory a partir das linhas-zero sintéticas de ad_metrics (sem as '
  'anteriores à criação do anúncio). Idempotente. Uso administrativo (migration e laboratório).';

REVOKE ALL ON FUNCTION public.ad_pack_inventory_backfill(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Gravação pelo refresh.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.merge_ad_pack_inventory(p_user_id uuid, p_pack_id uuid, p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
declare
  v_count integer;
begin
  -- Mesmo guarda de tenancy das RPCs de gravação (113): cliente autenticado só grava no
  -- próprio silo; service role (auth.uid() nulo) é o caminho de pack compartilhado.
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'Forbidden: p_user_id must match auth.uid()' using errcode = '42501';
  end if;

  with incoming as (
    select r.*
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
      ad_id text, account_id text, campaign_id text, campaign_name text,
      adset_id text, adset_name text, ad_name text,
      first_active_date date, last_active_date date
    )
    where coalesce(r.ad_id, '') <> ''
      and r.first_active_date is not null
      and r.last_active_date is not null
      and r.first_active_date <= r.last_active_date
  ),
  -- Um anúncio repetido no mesmo lote não pode chegar duas vezes ao ON CONFLICT
  -- ("command cannot affect row a second time"): junta aqui, identidade do mais recente.
  -- Os agregados têm nome PRÓPRIO (first_d/last_d): no ORDER BY de um DISTINCT ON, o nome de
  -- coluna de saída vence o de entrada, e `order by last_active_date` ordenaria pelo máximo do
  -- grupo (igual em todas as linhas) — a identidade "mais recente" virava sorte (teste M5).
  deduped as (
    select distinct on (i.ad_id)
           i.ad_id, i.account_id, i.campaign_id, i.campaign_name, i.adset_id, i.adset_name, i.ad_name,
           min(i.first_active_date) over (partition by i.ad_id) as first_d,
           max(i.last_active_date) over (partition by i.ad_id) as last_d
    from incoming i
    order by i.ad_id, i.last_active_date desc
  )
  insert into public.ad_pack_inventory as inv (
    user_id, pack_id, ad_id, account_id, campaign_id, campaign_name, adset_id, adset_name, ad_name,
    first_active_date, last_active_date
  )
  select p_user_id, p_pack_id, d.ad_id, d.account_id, d.campaign_id, d.campaign_name,
         d.adset_id, d.adset_name, d.ad_name, d.first_d, d.last_d
  from deduped d
  on conflict (user_id, pack_id, ad_id) do update set
    first_active_date = least(inv.first_active_date, excluded.first_active_date),
    last_active_date = greatest(inv.last_active_date, excluded.last_active_date),
    account_id = coalesce(nullif(excluded.account_id, ''), inv.account_id),
    campaign_id = coalesce(nullif(excluded.campaign_id, ''), inv.campaign_id),
    campaign_name = coalesce(nullif(excluded.campaign_name, ''), inv.campaign_name),
    adset_id = coalesce(nullif(excluded.adset_id, ''), inv.adset_id),
    adset_name = coalesce(nullif(excluded.adset_name, ''), inv.adset_name),
    ad_name = coalesce(nullif(excluded.ad_name, ''), inv.ad_name),
    updated_at = now()
  -- Não regrava o que já está igual.
  where excluded.first_active_date < inv.first_active_date
     or excluded.last_active_date > inv.last_active_date
     or coalesce(nullif(excluded.account_id, ''), inv.account_id) is distinct from inv.account_id
     or coalesce(nullif(excluded.campaign_id, ''), inv.campaign_id) is distinct from inv.campaign_id
     or coalesce(nullif(excluded.campaign_name, ''), inv.campaign_name) is distinct from inv.campaign_name
     or coalesce(nullif(excluded.adset_id, ''), inv.adset_id) is distinct from inv.adset_id
     or coalesce(nullif(excluded.adset_name, ''), inv.adset_name) is distinct from inv.adset_name
     or coalesce(nullif(excluded.ad_name, ''), inv.ad_name) is distinct from inv.ad_name;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

COMMENT ON FUNCTION public.merge_ad_pack_inventory(uuid, uuid, jsonb) IS
  'F5: grava o inventário do pack a partir do refresh. Estende o intervalo (least/greatest), '
  'troca só a identidade não vazia que mudou e não regrava linha igual. Devolve linhas gravadas.';

REVOKE ALL ON FUNCTION public.merge_ad_pack_inventory(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merge_ad_pack_inventory(uuid, uuid, jsonb) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Backfill de todos os silos.
-- ---------------------------------------------------------------------------
SELECT public.ad_pack_inventory_backfill(NULL) AS inventario_preenchido;

COMMIT;
