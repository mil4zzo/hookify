#!/usr/bin/env python
"""
Gera supabase/migrations/155_leitura_completada_pelo_inventario.sql.

Por que um gerador: a base do Manager tem 859 linhas e o detalhe 407. Redigitar é
convidar erro; aqui cada mudança é uma troca de texto que PRECISA casar exatamente
uma vez na definição viva (pg_get_functiondef do laboratório, idêntica à de produção
em 14/09/2026). Se a função viva mudar, o gerador para em vez de gerar algo torto.

    LAB_URL=postgresql://hookify_lab@127.0.0.1:5432/hookify_lab \\
      py supabase/tests/gerar_migration_155.py
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "supabase" / "migrations" / "155_leitura_completada_pelo_inventario.sql"
LAB_URL_DEFAULT = "postgresql://hookify_lab@127.0.0.1:5432/hookify_lab"


def psql_path() -> str:
    cand = os.environ.get("PSQL") or shutil.which("psql")
    if cand:
        return cand
    win = Path(r"C:\Program Files\PostgreSQL\17\bin\psql.exe")
    if win.exists():
        return str(win)
    sys.exit("psql nao encontrado: defina PSQL=<caminho>")


def functiondef(name: str) -> str:
    url = os.environ.get("LAB_URL", LAB_URL_DEFAULT)
    if "supabase.co" in url:
        sys.exit("Recusando ler do Supabase remoto: o gerador le do laboratorio.")
    proc = subprocess.run(
        [psql_path(), url, "-w", "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1",
         "-c", f"select pg_get_functiondef('public.{name}'::regproc)"],
        capture_output=True, text=True, encoding="utf-8", env=dict(os.environ, PGCLIENTENCODING="UTF8"),
    )
    if proc.returncode != 0:
        sys.exit(proc.stderr)
    return proc.stdout.replace("\r\n", "\n").rstrip("\n") + "\n"


def trocar(src: str, pares: list[tuple[str, str]], nome: str) -> str:
    for antigo, novo in pares:
        n = src.count(antigo)
        if n != 1:
            sys.exit(f"{nome}: trecho casou {n} vezes (esperado 1):\n{antigo[:200]}")
        src = src.replace(antigo, novo)
    return src


# ---------------------------------------------------------------------------
# Base do Manager
# ---------------------------------------------------------------------------

BASE_INV_CTE = """  ),
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
  -- 2. As linhas: SÓ o read model"""

BASE_SEL_UNION = """      )

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
  -- `coalesce(x,'') <> ''`"""

BASE_REP_OLD = """      am.ad_name as rep_ad_name,
      am.account_id as rep_account_id,
      am.campaign_id as rep_campaign_id,
      am.campaign_name as rep_campaign_name,
      am.adset_id as rep_adset_id,
      am.adset_name as rep_adset_name
    from grp_dec g
    left join public.ad_metrics am on am.user_id = g.rep_user_id and am.pack_id = any(coalesce(p_pack_ids, v_pack_universe)) and am.ad_id = g.rep_ad_id and am.date = g.rep_date
  ),"""

BASE_REP_NEW = """      -- (v155) representante sem dia (só inventário): nomes da linha do inventário.
      case when g.rep_date is null then ri.ad_name else am.ad_name end as rep_ad_name,
      case when g.rep_date is null then ri.account_id else am.account_id end as rep_account_id,
      case when g.rep_date is null then ri.campaign_id else am.campaign_id end as rep_campaign_id,
      case when g.rep_date is null then ri.campaign_name else am.campaign_name end as rep_campaign_name,
      case when g.rep_date is null then ri.adset_id else am.adset_id end as rep_adset_id,
      case when g.rep_date is null then ri.adset_name else am.adset_name end as rep_adset_name
    from grp_dec g
    left join public.ad_metrics am on am.user_id = g.rep_user_id and am.pack_id = any(coalesce(p_pack_ids, v_pack_universe)) and am.ad_id = g.rep_ad_id and am.date = g.rep_date
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
  ),"""


def base_v155() -> str:
    src = functiondef("fetch_manager_performance_base_v145")
    return trocar(src, [
        ("CREATE OR REPLACE FUNCTION public.fetch_manager_performance_base_v145(",
         "CREATE OR REPLACE FUNCTION public.fetch_manager_performance_base_v155("),
        ("  ),\n  -- 2. As linhas: SÓ o read model", BASE_INV_CTE),
        ("      )\n  ),\n  -- `coalesce(x,'') <> ''`", BASE_SEL_UNION),
        # Linha sem dia: '' em vez de NULL (NULL anularia a chave inteira e o max a
        # ignoraria; '' ordena abaixo de qualquer data com as mesmas impressões).
        ("max((lpad(f.impressions::text, 12, '0') || e'\\x1f' || f.date::text) collate \"C\") as rep_enc",
         "max((lpad(f.impressions::text, 12, '0') || e'\\x1f' || coalesce(f.date::text, '')) collate \"C\") as rep_enc"),
        ("(split_part(g.rep_enc, e'\\x1f', 5))::date as rep_date",
         "nullif(split_part(g.rep_enc, e'\\x1f', 5), '')::date as rep_date"),
        (BASE_REP_OLD, BASE_REP_NEW),
    ], "base")


# ---------------------------------------------------------------------------
# Detalhe (entidade)
# ---------------------------------------------------------------------------

ENT_INV_CTE = """    where k.rn = 1
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
  ),"""

ENT_ROWS_OLD = """  rows_ as (
    select
      case when v_group_by = 'ad_id' then d.ad_id else p_entity_id end as group_key,
      d.*
    from dedup k
    join public.ad_performance_daily d on d.user_id = k.user_id and d.pack_id = k.pack_id and d.ad_id = k.ad_id and d.date = k.date
  ),"""

ENT_ROWS_NEW = """  --    (v155) Colunas explícitas: o inventário entra por union, zerado e sem dia
  --    (`date` nulo fica fora da série; arrays vazios não geram conversão nem lead).
  rows_ as (
    select
      case when v_group_by = 'ad_id' then d.ad_id else p_entity_id end as group_key,
      d.user_id, d.pack_id, d.ad_id, d.date,
      d.impressions, d.clicks, d.inline_link_clicks, d.spend, d.lpv, d.plays, d.thruplays,
      d.hook_value, d.scroll_stop_value, d.hold_rate, d.video_watched_p50, d.video_watched_p75,
      d.reach, d.conv_key_ids, d.conv_values, d.lead_scores, d.lead_qtys, d.custom_hist
    from dedup k
    join public.ad_performance_daily d on d.user_id = k.user_id and d.pack_id = k.pack_id and d.ad_id = k.ad_id and d.date = k.date

    union all

    select
      case when v_group_by = 'ad_id' then i.ad_id else p_entity_id end as group_key,
      i.user_id, i.pack_id, i.ad_id, null::date,
      0::bigint, 0::bigint, 0::bigint, 0::numeric, 0::bigint, 0::bigint, 0::bigint,
      0::numeric, 0::numeric, 0::numeric, 0::numeric, 0::numeric,
      0::bigint, '{}'::integer[], '{}'::numeric[], '{}'::numeric[], '{}'::integer[], null::jsonb
    from inv i
  ),"""

ENT_REP_OLD = """      am.ad_name as rep_ad_name,
      am.account_id as rep_account_id,
      am.campaign_id as rep_campaign_id,
      am.campaign_name as rep_campaign_name,
      am.adset_id as rep_adset_id,
      am.adset_name as rep_adset_name,"""

ENT_REP_NEW = """      -- (v155) representante sem dia (só inventário): nomes da linha do inventário.
      case when g.rep_date is null then ri.ad_name else am.ad_name end as rep_ad_name,
      case when g.rep_date is null then ri.account_id else am.account_id end as rep_account_id,
      case when g.rep_date is null then ri.campaign_id else am.campaign_id end as rep_campaign_id,
      case when g.rep_date is null then ri.campaign_name else am.campaign_name end as rep_campaign_name,
      case when g.rep_date is null then ri.adset_id else am.adset_id end as rep_adset_id,
      case when g.rep_date is null then ri.adset_name else am.adset_name end as rep_adset_name,"""

ENT_REP_JOIN_OLD = """    left join public.ad_metrics am on am.user_id = g.rep_user_id and (p_pack_ids is null or am.pack_id = any(p_pack_ids)) and am.ad_id = g.rep_ad_id and am.date = g.rep_date
"""

ENT_REP_JOIN_NEW = """    left join public.ad_metrics am on am.user_id = g.rep_user_id and (p_pack_ids is null or am.pack_id = any(p_pack_ids)) and am.ad_id = g.rep_ad_id and am.date = g.rep_date
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
"""


def entity_v155() -> str:
    src = functiondef("fetch_entity_performance_v145")
    return trocar(src, [
        ("CREATE OR REPLACE FUNCTION public.fetch_entity_performance_v145(",
         "CREATE OR REPLACE FUNCTION public.fetch_entity_performance_v155("),
        ("    where k.rn = 1\n  ),", ENT_INV_CTE),
        ("    from dedup d\n    group by d.ad_id",
         "    -- (v155) mais os packs em que o anúncio só está no inventário\n"
         "    from (select ad_id, pack_id from dedup union all select ad_id, pack_id from inv) d\n"
         "    group by d.ad_id"),
        (ENT_ROWS_OLD, ENT_ROWS_NEW),
        ("max((lpad(r.impressions::text, 12, '0') || e'\\x1f' || r.date::text) collate \"C\") as rep_enc",
         "max((lpad(r.impressions::text, 12, '0') || e'\\x1f' || coalesce(r.date::text, '')) collate \"C\") as rep_enc"),
        ("(split_part(g.rep_enc, e'\\x1f', 5))::date as rep_date",
         "nullif(split_part(g.rep_enc, e'\\x1f', 5), '')::date as rep_date"),
        (ENT_REP_OLD, ENT_REP_NEW),
        (ENT_REP_JOIN_OLD, ENT_REP_JOIN_NEW),
    ], "entity")


def core_wrapper() -> str:
    src = functiondef("fetch_manager_rankings_core_v2")
    if src.count("select public.fetch_manager_performance_base_v155(") == 1:
        return src  # laboratório onde a 155 já foi aplicada: regenerar dá o mesmo texto
    return trocar(src, [
        ("select public.fetch_manager_performance_base_v145(",
         "select public.fetch_manager_performance_base_v155("),
    ], "core_v2")


BASE_ARGS = ("uuid, date, date, text, uuid[], text[], text, text, text, text, boolean, boolean, "
             "integer, integer, text, text, boolean")
ENTITY_ARGS = "uuid, date, date, text, text, uuid[], text, boolean, integer, boolean"

HEADER = """-- 155: Manager e detalhe completados pelo inventário do pack (F5, fase 2).
--
-- POR QUE
-- -------
-- O refresh grava uma linha-zero em ad_metrics por dia da janela para todo anúncio
-- entregável que não teve atividade — 543 mil das 698 mil linhas do laboratório, das
-- quais 163 mil em dias ANTES de o anúncio existir. Elas servem só para uma coisa: o
-- anúncio ativo sem gasto aparecer na lista (e na contagem de ativos). A 154 criou
-- ad_pack_inventory (por pack e anúncio: identidade e o intervalo em que esteve ativo).
-- Esta migration faz as duas leituras que decidem "quem aparece" consultarem esse
-- inventário, para que a 156 possa apagar as linhas-zero.
--
-- REGRA: o anúncio aparece no período se tem dado real nele OU se o intervalo do
-- inventário cruza o período. Sem dado real, entra com zero e com a identidade do
-- inventário (a mais recente).
--
-- O QUE MUDA NA TELA (aceito no plano, §8.9 — documentation/plano-eficiencia-carregamento.md)
--   (a) dias anteriores à criação do anúncio deixam de mostrá-lo;
--   (c) buracos entre períodos ativos passam a mostrá-lo com zero;
--   (e) ativo que gastou em outro trecho do período aparece com zero nos dias sem gasto.
--
-- COEXISTÊNCIA: correta com e sem as linhas-zero. Enquanto existirem, o anúncio que tem
-- linha-zero no período conta como "tem linha" e o inventário não duplica.
--
-- ORDEM DE DEPLOY: 154 → 155 → backend (troca o detalhe para _v155 e para de gravar
-- linhas-zero) → 156 (limpeza). O Manager troca aqui mesmo, pelo wrapper core_v2.
-- ROLLBACK: repontar fetch_manager_rankings_core_v2 para a base_v145 (e o backend para
-- fetch_entity_performance_v145) enquanto a 156 não rodou.
--
-- GERADA por supabase/tests/gerar_migration_155.py a partir das funções vivas.

"""


def main() -> None:
    base = base_v155()
    entity = entity_v155()
    core = core_wrapper()
    parts = [
        HEADER,
        "BEGIN;\n\n",
        "-- Detalhe filtra o inventário por nome de criativo e por conjunto (sem pack no\n"
        "-- ramo legado). Tabela pequena (uma linha por pack × anúncio): índice direto.\n",
        "CREATE INDEX IF NOT EXISTS ad_pack_inventory_user_ad_name_idx\n"
        "  ON public.ad_pack_inventory (user_id, ad_name);\n",
        "CREATE INDEX IF NOT EXISTS ad_pack_inventory_user_adset_idx\n"
        "  ON public.ad_pack_inventory (user_id, adset_id);\n",
        "CREATE INDEX IF NOT EXISTS ad_pack_inventory_user_ad_idx\n"
        "  ON public.ad_pack_inventory (user_id, ad_id);\n\n",
        base.rstrip("\n") + ";\n\n",
        f"REVOKE ALL ON FUNCTION public.fetch_manager_performance_base_v155({BASE_ARGS}) FROM PUBLIC, anon;\n",
        f"GRANT EXECUTE ON FUNCTION public.fetch_manager_performance_base_v155({BASE_ARGS}) TO authenticated, service_role;\n\n",
        entity.rstrip("\n") + ";\n\n",
        f"REVOKE ALL ON FUNCTION public.fetch_entity_performance_v155({ENTITY_ARGS}) FROM PUBLIC, anon;\n",
        f"GRANT EXECUTE ON FUNCTION public.fetch_entity_performance_v155({ENTITY_ARGS}) TO authenticated, service_role;\n\n",
        "-- O Manager passa a ler a base nova (mesma assinatura, mesmas permissões).\n",
        core.rstrip("\n") + ";\n\n",
        "COMMIT;\n",
    ]
    OUT.write_text("".join(parts), encoding="utf-8", newline="\n")
    print(f"gerada: {OUT.relative_to(ROOT)} ({sum(p.count(chr(10)) for p in parts)} linhas)")


if __name__ == "__main__":
    main()
