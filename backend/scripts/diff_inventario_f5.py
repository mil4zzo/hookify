#!/usr/bin/env python
"""
Teste DIFERENCIAL da F5 (documentation/plano-eficiencia-carregamento.md, §8.9):
leitura antiga sobre o banco COM linhas-zero × leitura nova (155) sobre o banco SEM
elas (limpas) e com o inventário (154).

    OLD_URL=postgresql://hookify_lab@127.0.0.1:5432/hookify_lab \\
    NEW_URL=postgresql://hookify_lab@127.0.0.1:5432/hookify_lab_b \\
      py backend/scripts/diff_inventario_f5.py [--only manager|entity] [--filter X] [--verbose]

Também serve para a CONVIVÊNCIA (155 aplicada, linhas-zero ainda no banco): as duas
URLs iguais, funções antiga e nova no mesmo banco. Aí (a) não pode aparecer.

O QUE É EXATO
-------------
Tudo que é número: `averages`, `header_aggregates`, `available_conversion_types`, e
em toda linha presente dos dois lados as métricas (impressões, gasto, conversões,
histogramas…). Linha zerada não muda soma — se um total mexeu, é bug.

O QUE PODE MUDAR, E SÓ POR UM MOTIVO CONHECIDO
----------------------------------------------
Quem aparece. Cada anúncio que aparece só de um lado é classificado no banco antigo,
que tem as duas coisas (linhas-zero e inventário):
  (a)   só no antigo, e toda linha-zero dele no período é anterior à criação − 1 dia;
  (c/e) só no novo: o intervalo do inventário cruza o período, mas não há linha nele
        (buraco entre dois trechos ativos);
  nome  o anúncio aparece dos dois lados, mas com outro nome/conjunto/campanha
        (a linha-zero do período carrega o nome daquele dia; o inventário, o mais recente).
Linha só de um lado precisa estar zerada. Em linha presente dos dois lados, campos de
composição (ad_count, active_count, pack_ids, account_ids, representante…) podem mudar
só se o cenário tem anúncio classificado acima. Qualquer outra diferença: NÃO EXPLICADA.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import diff_rankings_rollup as R  # noqa: E402

SEP = "\x1f"
DEFAULT_URL_A = "postgresql://hookify_lab@127.0.0.1:5432/hookify_lab"
DEFAULT_URL_B = "postgresql://hookify_lab@127.0.0.1:5432/hookify_lab_b"

METRIC_KEYS = (
    "impressions", "clicks", "inline_link_clicks", "spend", "lpv", "plays", "video_total_thruplays",
    "hook", "hold_rate", "video_watched_p50", "video_watched_p75", "scroll_stop", "ctr",
    "connect_rate", "cpm", "website_ctr", "reach", "frequency", "leadscore_histogram",
    "custom_histograms", "conversions",
)
ZERO_KEYS = ("impressions", "clicks", "inline_link_clicks", "spend", "lpv", "plays", "video_total_thruplays", "reach")
NAME_KEYS = ("ad_name", "campaign_name", "adset_name", "campaign_id", "adset_id", "account_id")


def run_sql(psql: str, url: str, sql: str) -> str:
    with tempfile.NamedTemporaryFile("w", suffix=".sql", delete=False, encoding="utf-8") as f:
        f.write(sql)
        path = f.name
    try:
        proc = subprocess.run(
            [psql, url, "-w", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-f", path],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            env=dict(os.environ, PGCLIENTENCODING="UTF8"),
        )
    finally:
        os.unlink(path)
    if proc.returncode != 0:
        sys.exit(f"psql falhou em {url}:\n{proc.stderr[-4000:]}")
    return proc.stdout


def q(s):
    return R.q(s)


def q_arr(xs, typ):
    return R.q_arr(xs, typ)


# ---------------------------------------------------------------------------
# Cenários
# ---------------------------------------------------------------------------

def windows(ds: str, de: str) -> list[tuple[str, str, str]]:
    """Período inteiro, últimos 7 dias e um trecho de 5 dias no meio — buraco e
    pré-criação só aparecem em janela curta."""
    d0, d1 = date.fromisoformat(ds), date.fromisoformat(de)
    out = [("full", ds, de)]
    if (d1 - d0).days >= 7:
        out.append(("last7", (d1 - timedelta(days=6)).isoformat(), de))
        mid = d0 + (d1 - d0) / 2
        out.append(("mid5", (mid - timedelta(days=2)).isoformat(), (mid + timedelta(days=2)).isoformat()))
    return out


def manager_scenarios(meta: dict, holes: list[dict]) -> list[dict]:
    scen = R.build_scenarios(meta)
    groups = ["ad_id", "ad_name", "adset_id", "campaign_id"]
    for p in meta["packs"]:
        for tag, ds, de in windows(p["ds"], p["de"])[1:]:
            for g in groups:
                scen.append(dict(id=f"{p['user_id'][:8]}|pack:{p['id'][:8]}|{g}|{tag}",
                                 actor=p["user_id"], packs=[p["id"]], ds=ds, de=de, group_by=g, action=None))
    for h in holes:
        for g in groups:
            scen.append(dict(id=f"{h['user_id'][:8]}|pack:{h['pack_id'][:8]}|{g}|buraco:{h['day']}",
                             actor=h["user_id"], packs=[h["pack_id"]], ds=h["day"], de=h["day"], group_by=g, action=None))
    return scen


# Dias DENTRO do intervalo do inventário sem nenhuma linha (nem real nem zero): o caso (c).
# Raros no laboratório (454 de 425 mil dias) — a matriz de janelas não os acerta sozinha.
HOLES_SQL = r"""
select coalesce(json_agg(x), '[]')::text from (
  select distinct on (i.pack_id) i.user_id, i.pack_id, i.ad_id, i.ad_name, i.adset_id, g::date::text as day
  from public.ad_pack_inventory i
  cross join lateral generate_series(i.first_active_date, i.last_active_date, interval '1 day') g
  where not exists (select 1 from public.ad_metrics m where m.user_id = i.user_id and m.pack_id = i.pack_id
                    and m.ad_id = i.ad_id and m.date = g::date)
  order by i.pack_id, g, i.ad_id
  limit 12
) x;
"""


ENTITY_DISCOVER_SQL = r"""
select coalesce(json_object_agg(pack_id::text, ents), '{}')::text
from (
  select p.id as pack_id, json_build_object(
    'ad_names', (select json_agg(x) from (select d.ad_name as x from public.ad_performance_daily d
                  where d.user_id = p.user_id and d.pack_id = p.id and coalesce(d.ad_name, '') <> ''
                  group by d.ad_name order by count(distinct d.ad_id) desc, d.ad_name limit 2) t),
    'ad_ids', (select json_agg(x) from (select d.ad_id as x from public.ad_performance_daily d
                  where d.user_id = p.user_id and d.pack_id = p.id
                  group by d.ad_id order by sum(d.spend) desc, d.ad_id limit 2) t),
    'adset_ids', (select json_agg(x) from (select d.adset_id as x from public.ad_performance_daily d
                  where d.user_id = p.user_id and d.pack_id = p.id and coalesce(d.adset_id, '') <> ''
                  group by d.adset_id order by count(distinct d.ad_id) desc, d.adset_id limit 2) t),
    -- entidades de anúncios SÓ do inventário (sem nenhuma métrica real): o caso novo
    'inv_only', (select json_agg(json_build_object('ad_id', i.ad_id, 'ad_name', i.ad_name, 'adset_id', i.adset_id))
                 from (select i.* from public.ad_pack_inventory i
                       where i.user_id = p.user_id and i.pack_id = p.id
                         and not exists (select 1 from public.ad_metrics m where m.user_id = i.user_id and m.pack_id = i.pack_id
                                         and m.ad_id = i.ad_id and not public.ad_metrics_is_synthetic_zero(m))
                       order by i.ad_id limit 2) i)
  ) as ents
  from public.packs p
  where p.date_start is not null and p.date_stop is not null
) e;
"""


def entity_scenarios(meta: dict, ents: dict, holes: list[dict]) -> list[dict]:
    out: list[dict] = []
    for h in holes:
        for kind, ent, gb in (("ad_id", h["ad_id"], "entity"), ("ad_name", h.get("ad_name"), "ad_id"),
                              ("adset_id", h.get("adset_id"), "ad_id")):
            if ent:
                out.append(dict(id=f"ent|{h['pack_id'][:8]}|buraco:{h['day']}|{kind}={ent[:24]}|{gb}",
                                actor=h["user_id"], packs=[h["pack_id"]], ds=h["day"], de=h["day"], kind=kind,
                                ent=ent, group_by=gb, sel_packs=[h["pack_id"]]))
    for p in meta["packs"]:
        e = ents.get(p["id"]) or {}
        targets: list[tuple[str, str]] = []
        for kind, key in (("ad_name", "ad_names"), ("ad_id", "ad_ids"), ("adset_id", "adset_ids")):
            targets += [(kind, x) for x in (e.get(key) or [])]
        for inv in e.get("inv_only") or []:
            targets.append(("ad_id", inv["ad_id"]))
            if inv.get("ad_name"):
                targets.append(("ad_name", inv["ad_name"]))
            if inv.get("adset_id"):
                targets.append(("adset_id", inv["adset_id"]))
        for kind, ent in dict.fromkeys(targets):
            for wtag, ds, de in windows(p["ds"], p["de"]):
                for packs, ptag in (([p["id"]], "pack"), (None, "legacy")):
                    if ptag == "legacy" and wtag != "full":
                        continue
                    for gb in (("entity", "ad_id") if kind != "ad_id" else ("entity",)):
                        out.append(dict(id=f"ent|{p['id'][:8]}|{ptag}|{wtag}|{kind}={ent[:24]}|{gb}",
                                        actor=p["user_id"], packs=packs, ds=ds, de=de, kind=kind, ent=ent, group_by=gb,
                                        sel_packs=[p["id"]] if packs else [x["id"] for x in meta["packs"] if x["user_id"] == p["user_id"]]))
    for sh in meta["shares"]:
        e = ents.get(sh["pack"]) or {}
        for kind, key in (("ad_name", "ad_names"), ("adset_id", "adset_ids")):
            for ent in (e.get(key) or [])[:1]:
                out.append(dict(id=f"ent|share:{sh['grantee'][:8]}|{sh['pack'][:8]}|{kind}={ent[:24]}|ad_id",
                                actor=sh["grantee"], packs=[sh["pack"]], ds=sh["ds"], de=sh["de"], kind=kind, ent=ent,
                                group_by="ad_id", sel_packs=[sh["pack"]]))
    return out


def entity_call(fn: str, s: dict) -> str:
    return (f"{fn}({q(s['actor'])}::uuid, {q(s['ds'])}::date, {q(s['de'])}::date, {q(s['kind'])}, {q(s['ent'])}, "
            f"{q_arr(s['packs'], 'uuid')}, {q(s['group_by'])}, true, null, true)")


def batch_sql(scen: list[dict], call) -> str:
    parts = ["\\set ON_ERROR_STOP on", "set work_mem = '3500kB';"]
    for s in scen:
        parts.append("begin;")
        parts.append(f"set local request.jwt.claims = {q(json.dumps({'sub': s['actor']}))};")
        parts.append(f"select {q(s['id'])} || {q(SEP)} || {call(s)}::text;")
        parts.append("rollback;")
    return "\n".join(parts) + "\n"


def run_side(psql: str, url: str, scen: list[dict], call) -> dict[str, dict]:
    out = run_sql(psql, url, batch_sql(scen, call))
    res: dict[str, dict] = {}
    for ln in out.split("\n"):
        if SEP in ln:
            sid, payload = ln.split(SEP, 1)
            res[sid] = R.loads(payload)
    return res


# ---------------------------------------------------------------------------
# Presença por anúncio (roda no banco ANTIGO: tem linhas-zero E inventário)
# ---------------------------------------------------------------------------

def presence_sql(scen: list[dict], packs_key: str) -> str:
    parts = ["\\set ON_ERROR_STOP on"]
    for s in scen:
        packs = s[packs_key]
        # Detalhe: os mesmos conjuntos, restritos aos anúncios DA ENTIDADE (pela linha do dia
        # no antigo, pela identidade do inventário no novo — é assim que cada leitura casa).
        kind, ent = s.get("kind"), s.get("ent")
        col = {"ad_id": "ad_id", "ad_name": "ad_name", "adset_id": "adset_id"}.get(kind or "", None)
        ent_m = f"r.{col} = {q(ent)}" if col else "true"
        ent_i = f"i.{col} = {q(ent)}" if col else "true"
        parts.append(f"""
with rows_p as (
  select m.ad_id, m.date, public.ad_metrics_is_synthetic_zero(m) as synth,
         m.ad_name, m.adset_id, m.campaign_id, m.campaign_name, m.adset_name, m.account_id,
         (m.date < (a.meta_created_time at time zone 'UTC')::date - 1) as pre
  from public.ad_metrics m
  join public.packs p on p.id = m.pack_id and p.user_id = m.user_id
  left join public.ads a on a.user_id = m.user_id and a.ad_id = m.ad_id
  where m.user_id in (select x.user_id from public.packs x where x.id = any({q_arr(packs, 'uuid')}))
    and m.pack_id = any({q_arr(packs, 'uuid')}) and m.date between {q(s['ds'])}::date and {q(s['de'])}::date
),
inv as (
  select i.* from public.ad_pack_inventory i join public.packs p on p.id = i.pack_id and p.user_id = i.user_id
  where i.user_id in (select x.user_id from public.packs x where x.id = any({q_arr(packs, 'uuid')}))
    and i.pack_id = any({q_arr(packs, 'uuid')})
    and i.first_active_date <= {q(s['de'])}::date and i.last_active_date >= {q(s['ds'])}::date
),
real_ads as (select distinct ad_id from rows_p where not synth),
synth_ads as (select distinct ad_id from rows_p where synth),
a_only as (select ad_id from synth_ads except select ad_id from real_ads except select ad_id from inv),
b_only as (select ad_id from inv except select ad_id from real_ads except select ad_id from synth_ads),
renamed as (
  select distinct r.ad_id from rows_p r join inv i on i.ad_id = r.ad_id
  where r.synth and r.ad_id not in (select ad_id from real_ads)
    and (r.ad_name, r.adset_id, r.campaign_id, r.campaign_name, r.adset_name, r.account_id)
        is distinct from (i.ad_name, i.adset_id, i.campaign_id, i.campaign_name, i.adset_name, i.account_id)
)
select {q(s['id'])} || {q(SEP)} || jsonb_build_object(
  'a_only', (select coalesce(jsonb_agg(ad_id order by ad_id), '[]') from a_only),
  'a_only_nao_pre', (select coalesce(jsonb_agg(distinct r.ad_id), '[]') from rows_p r
                     where r.synth and r.ad_id in (select ad_id from a_only) and not coalesce(r.pre, false)),
  'b_only', (select coalesce(jsonb_agg(ad_id order by ad_id), '[]') from b_only),
  'renamed', (select coalesce(jsonb_agg(ad_id order by ad_id), '[]') from renamed),
  'a_only_ent', (select coalesce(jsonb_agg(distinct r.ad_id), '[]') from rows_p r
                 where r.synth and {ent_m} and r.ad_id in (select ad_id from a_only)),
  'b_only_ent', (select coalesce(jsonb_agg(distinct i.ad_id), '[]') from inv i
                 where {ent_i} and i.ad_id in (select ad_id from b_only))
)::text;""")
    return "\n".join(parts) + "\n"


# ---------------------------------------------------------------------------
# Comparação
# ---------------------------------------------------------------------------

def is_zero_row(r: dict, keys=ZERO_KEYS) -> bool:
    for k in keys:
        if Decimal(str(r.get(k) or 0)) != 0:
            return False
    for k in ("conversions",):
        for v in (r.get(k) or {}).values():
            if Decimal(str(v or 0)) != 0:
                return False
    return not (r.get("leadscore_histogram") or {})


def diff_fields(path: str, a: dict, b: dict, keys) -> list:
    diffs: list = []
    for k in keys:
        R.cmp_value(f"{path}.{k}", a.get(k), b.get(k), diffs)
    return diffs


def compare_manager(s: dict, old: dict, new: dict, pres: dict, cat: Counter) -> list:
    bad: list = []
    for key in ("averages", "header_aggregates", "available_conversion_types"):
        d: list = []
        R.cmp_value(key, old.get(key), new.get(key), d)
        bad += d
    explained = bool(pres["a_only"] or pres["b_only"] or pres["renamed"])
    if pres["a_only_nao_pre"]:
        bad.append(("presenca.a_only nao e pre-criacao", pres["a_only_nao_pre"][:5], ""))
    cat["(a) anuncios so no antigo"] += len(pres["a_only"])
    cat["(c/e) anuncios so no novo"] += len(pres["b_only"])
    cat["nome diferente"] += len(pres["renamed"])

    od = {r["group_key"]: r for r in old.get("data", [])}
    nd = {r["group_key"]: r for r in new.get("data", [])}
    paged = int(s.get("offset", 0) or 0) > 0
    # Só com a lista inteira dos dois lados dá para exigir igualdade de conjunto: com mais de
    # `limit` linhas, a página corta no meio das de gasto 0, que empatam e desempatam por
    # group_key — uma zerada nova do inventário empurra para fora uma de gasto 0 com impressão.
    inteira = not (old.get("pagination") or {}).get("has_more") and not (new.get("pagination") or {}).get("has_more")

    def empurrada(r):
        return not inteira and explained and Decimal(str(r.get("spend") or 0)) == 0

    for gk in od.keys() - nd.keys():
        if not is_zero_row(od[gk]):
            if empurrada(od[gk]):
                cat["gasto 0 empurrada para fora da pagina"] += 1
            elif not paged:
                bad.append((f"data[{gk}] so no antigo e NAO zerada", "", ""))
        elif not explained:
            bad.append((f"data[{gk}] so no antigo sem anuncio classificado", "", ""))
        else:
            cat["linhas zeradas so no antigo"] += 1
    for gk in nd.keys() - od.keys():
        if not is_zero_row(nd[gk]):
            if empurrada(nd[gk]):
                cat["gasto 0 empurrada para fora da pagina"] += 1
            elif not paged:
                bad.append((f"data[{gk}] so no novo e NAO zerada", "", ""))
        elif not explained:
            bad.append((f"data[{gk}] so no novo sem anuncio classificado", "", ""))
        else:
            cat["linhas zeradas so no novo"] += 1
    if s["group_by"] == "ad_id" and inteira and not paged and not any(s.get(k) for k in ("campaign_contains", "adset_contains", "ad_contains", "account_ids", "campaign_id")):
        if set(od) - set(nd) != set(pres["a_only"]):
            bad.append(("ad_id: linhas so no antigo != (a)", sorted(set(od) - set(nd))[:5], pres["a_only"][:5]))
        if set(nd) - set(od) != set(pres["b_only"]):
            bad.append(("ad_id: linhas so no novo != (c/e)", sorted(set(nd) - set(od))[:5], pres["b_only"][:5]))

    for gk in od.keys() & nd.keys():
        ro, rn = od[gk], nd[gk]
        bad += diff_fields(f"data[{gk}]", ro, rn, METRIC_KEYS)
        comp = [k for k in ro.keys() | rn.keys() if k not in METRIC_KEYS and k != "group_key"]
        d = diff_fields(f"data[{gk}]", ro, rn, comp)
        if d:
            if explained:
                for path, *_ in d:
                    cat["composicao: " + path.rsplit(".", 1)[-1].split("[")[0]] += 1
            else:
                bad += d
    if not paged:
        common_o = [r["group_key"] for r in old.get("data", []) if r["group_key"] in nd]
        common_n = [r["group_key"] for r in new.get("data", []) if r["group_key"] in od]
        if common_o != common_n:
            bad.append(("ordem das linhas comuns mudou", common_o[:5], common_n[:5]))
        if old.get("pagination", {}).get("total") != new.get("pagination", {}).get("total") and not explained:
            bad.append(("pagination.total", old.get("pagination"), new.get("pagination")))
    return bad


def nonzero_days(days: list) -> list:
    out = []
    for d in days or []:
        zero = all(Decimal(str(d.get(k) or 0)) == 0 for k in ZERO_KEYS if k != "video_total_thruplays") \
            and Decimal(str(d.get("thruplays") or 0)) == 0 \
            and not d.get("leads") and all(Decimal(str(v or 0)) == 0 for v in (d.get("conversions") or {}).values())
        if not zero:
            out.append(d)
    return out


def compare_entity(s: dict, old: dict, new: dict, pres: dict, cat: Counter) -> list:
    bad: list = []
    R.cmp_value("mql_leadscore_min", old.get("mql_leadscore_min"), new.get("mql_leadscore_min"), bad)
    explained = bool(pres["a_only"] or pres["b_only"] or pres["renamed"])
    if pres["a_only_nao_pre"]:
        bad.append(("presenca.a_only nao e pre-criacao", pres["a_only_nao_pre"][:5], ""))
    og = {g["group_key"]: g for g in old.get("groups", [])}
    ng = {g["group_key"]: g for g in new.get("groups", [])}
    a_ent, b_ent = set(pres.get("a_only_ent") or []), set(pres.get("b_only_ent") or [])
    if s["group_by"] == "ad_id":
        # Filhos: quem entra e quem sai tem de ser EXATAMENTE o classificado para a entidade.
        if set(og) - set(ng) != a_ent:
            bad.append(("filhos so no antigo != (a) da entidade", sorted(set(og) - set(ng))[:5], sorted(a_ent)[:5]))
        if set(ng) - set(og) != b_ent:
            bad.append(("filhos so no novo != (c/e) da entidade", sorted(set(ng) - set(og))[:5], sorted(b_ent)[:5]))
    else:
        # Entidade: com anúncio só-novo o grupo tem de existir no novo; sumir exige (a).
        if b_ent and not ng:
            bad.append(("entidade sem grupo no novo, com anuncio (c/e)", sorted(b_ent)[:5], ""))
        if og and not ng and not a_ent:
            bad.append(("entidade sumiu no novo sem (a)", "", ""))
        if ng and not og and not b_ent:
            bad.append(("entidade apareceu no novo sem (c/e)", "", ""))

    def zero_group(g):
        t = g.get("totals") or {}
        return is_zero_row({**t, "video_total_thruplays": t.get("thruplays"), "leadscore_histogram": t.get("leads")}) \
            and not nonzero_days(g.get("days"))

    for side, a, b in (("antigo", og, ng), ("novo", ng, og)):
        for gk in a.keys() - b.keys():
            if not zero_group(a[gk]):
                bad.append((f"groups[{gk}] so no {side} e NAO zerado", "", ""))
            elif not explained:
                bad.append((f"groups[{gk}] so no {side} sem anuncio classificado", "", ""))
            else:
                cat[f"grupos zerados so no {side}"] += 1
    for gk in og.keys() & ng.keys():
        go, gn = og[gk], ng[gk]
        R.cmp_value(f"groups[{gk}].totals", go.get("totals"), gn.get("totals"), bad)
        R.cmp_value(f"groups[{gk}].days(nao zerados)", nonzero_days(go.get("days")), nonzero_days(gn.get("days")), bad)
        for k in ("curve_wsum", "curve_psum"):
            R.cmp_value(f"groups[{gk}].{k}", go.get(k), gn.get(k), bad)
        comp = [k for k in go.keys() | gn.keys() if k not in ("totals", "days", "curve_wsum", "curve_psum", "group_key")]
        d: list = []
        for k in comp:
            R.cmp_value(f"groups[{gk}].{k}", go.get(k), gn.get(k), d)
        if d:
            if explained:
                for path, *_ in d:
                    cat["composicao: " + path.rsplit(".", 1)[-1]] += 1
            else:
                bad += d
    return bad


# ---------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--old-url", default=os.environ.get("OLD_URL", DEFAULT_URL_A))
    ap.add_argument("--new-url", default=os.environ.get("NEW_URL", DEFAULT_URL_B))
    ap.add_argument("--old-base", default="public.fetch_manager_performance_base_v145")
    ap.add_argument("--new-base", default="public.fetch_manager_performance_base_v155")
    ap.add_argument("--old-entity", default="public.fetch_entity_performance_v145")
    ap.add_argument("--new-entity", default="public.fetch_entity_performance_v155")
    ap.add_argument("--only", choices=("manager", "entity"), default=None)
    ap.add_argument("--filter", default="")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--verbose", action="store_true")
    ap.add_argument("--convivencia", action="store_true",
                    help="as duas leituras no MESMO banco, com as linhas-zero ainda la: (a) tem de ser vazio")
    args = ap.parse_args()
    for u in (args.old_url, args.new_url):
        if "supabase.co" in u:
            sys.exit("Recusando: o diferencial e so para o laboratorio.")

    psql = R.find_psql()
    meta = R.discover(psql, args.old_url)
    holes = json.loads(run_sql(psql, args.old_url, HOLES_SQL).strip())
    print(f"{len(holes)} buracos de inventario usados como janela")
    total_bad = 0
    total = 0
    cat: Counter = Counter()

    jobs = []
    if args.only in (None, "manager"):
        scen = manager_scenarios(meta, holes)
        jobs.append(("manager", scen, lambda s: R.call_sql(args.old_base, s), lambda s: R.call_sql(args.new_base, s),
                     compare_manager, "packs"))
    if args.only in (None, "entity"):
        ents = json.loads(run_sql(psql, args.old_url, ENTITY_DISCOVER_SQL).strip())
        scen = entity_scenarios(meta, ents, holes)
        jobs.append(("entity", scen, lambda s: entity_call(args.old_entity, s), lambda s: entity_call(args.new_entity, s),
                     compare_entity, "sel_packs"))

    for name, scen, call_old, call_new, cmp_fn, packs_key in jobs:
        if args.filter:
            scen = [s for s in scen if args.filter in s["id"]]
        if args.limit:
            scen = scen[: args.limit]
        ids = [s["id"] for s in scen]
        if len(set(ids)) != len(ids):
            dup = [k for k, v in Counter(ids).items() if v > 1]
            sys.exit(f"{name}: ids de cenario repetidos: {dup[:3]}")
        print(f"{name}: {len(scen)} cenarios", flush=True)
        with ThreadPoolExecutor(max_workers=3) as ex:
            f_old = ex.submit(run_side, psql, args.old_url, scen, call_old)
            f_new = ex.submit(run_side, psql, args.new_url, scen, call_new)
            f_pres = ex.submit(lambda: {ln.split(SEP, 1)[0]: json.loads(ln.split(SEP, 1)[1])
                                        for ln in run_sql(psql, args.old_url, presence_sql(scen, packs_key)).split("\n") if SEP in ln})
            old, new, pres = f_old.result(), f_new.result(), f_pres.result()
        bad_n = 0
        for s in scen:
            sid = s["id"]
            total += 1
            if sid not in old or sid not in new or sid not in pres:
                print(f"FALTOU RESULTADO {sid}")
                bad_n += 1
                continue
            pr = pres[sid]
            if args.convivencia:
                # Linha-zero ainda existe: o anúncio pré-criação continua aparecendo nos dois lados.
                pr = {**pr, "a_only": [], "a_only_nao_pre": [], "a_only_ent": []}
            d = cmp_fn(s, old[sid], new[sid], pr, cat)
            if d:
                bad_n += 1
                print(f"\nNAO EXPLICADA {sid}: {len(d)}")
                for x in d[: (40 if args.verbose else 6)]:
                    print("   ", x)
            elif args.verbose:
                print(f"ok {sid}")
        total_bad += bad_n
        print(f"{name}: {len(scen) - bad_n}/{len(scen)} sem divergencia nao explicada", flush=True)

    print("\nclassificadas:")
    for k, v in sorted(cat.items()):
        print(f"  {k}: {v}")
    print(f"\n{total - total_bad}/{total} cenarios ok")
    return 1 if total_bad else 0


if __name__ == "__main__":
    sys.exit(main())
