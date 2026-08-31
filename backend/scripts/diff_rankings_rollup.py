#!/usr/bin/env python
"""
Teste DIFERENCIAL: base antiga (fetch_manager_rankings_core_v2_base_v116) x base nova
(fetch_manager_performance_base_v130) — fase C do plano do rollup
(documentation/plano-rollup-rankings.md).

O QUE PROVA
-----------
Que a RPC nova devolve o MESMO contrato da antiga para toda combinação relevante de
parâmetros, sobre dados reais. Critério: ZERO divergências. Qualquer diferença é bug ou
semântica a decidir — não se troca com diferença conhecida.

ONDE RODA
---------
No laboratório local (Postgres 17 com o dump restaurado — ver supabase/tests/README.md),
nunca em produção: cada par custa 1-2 s de CPU e há centenas de pares.

    LAB_URL=postgresql://postgres@127.0.0.1:5433/hookify_lab \
      py backend/scripts/diff_rankings_rollup.py [--limit N] [--verbose]

Sem driver Python de Postgres no projeto, o script fala com o banco via `psql`
(PSQL=caminho do executável; default: PATH ou C:\\Program Files\\PostgreSQL\\17\\bin).

CENÁRIOS
--------
Para cada usuário com packs:
  - cada pack sozinho × 4 group_by × {sem evento, evento mais frequente do pack}
  - todos os packs do usuário × 4 group_by × {sem evento, evento mais frequente}
    com available_conversion_types=true (o caminho do Explorer)
  - extras sobre "todos os packs" (ad_name): order_by cpr/hook/results/ctr, paginação
    (limit 50 / offset 50), filtro por campaign_id, filtro por nome de campanha,
    de conjunto e de anúncio (pedaços de nomes reais), filtro por conta,
    include_leadscore=false
Para cada compartilhamento (pack_shares): o convidado pedindo o pack do dono
(caminho cross-silo), 4 group_by.

COMPARAÇÃO
----------
Blocos `pagination`, `available_conversion_types`, `overlap` exatos; `averages` e
`header_aggregates` numéricos com tolerância; `data`: mesmo nº de linhas, mesma ORDEM de
group_key, mesmo conjunto de campos por linha (leadscore_values ↔ leadscore_histogram),
inteiros exatos, razões com tolerância relativa 1e-9 (ordem de soma), leads = array
ordenado da antiga vs expansão do histograma da nova.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from decimal import Decimal
from pathlib import Path

OLD_FN = "public.fetch_manager_rankings_core_v2_base_v116"
NEW_FN = "public.fetch_manager_performance_base_v130"
REL_TOL = Decimal("1e-9")
LAB_URL_DEFAULT = "postgresql://postgres@127.0.0.1:5433/hookify_lab"
SEP = "\x1f"


# O console do Windows abre em cp1252; um nome de campanha com "ç" ou "~" derrubava
# o script NO MEIO do relatorio, depois de 45 minutos de execucao.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass


def find_psql() -> str:
    cand = os.environ.get("PSQL") or shutil.which("psql")
    if cand:
        return cand
    win = Path(r"C:\Program Files\PostgreSQL\17\bin\psql.exe")
    if win.exists():
        return str(win)
    sys.exit("psql nao encontrado: defina PSQL=<caminho>")


def run_sql(psql: str, url: str, sql: str, timeout: int = 3600) -> str:
    with tempfile.NamedTemporaryFile("w", suffix=".sql", delete=False, encoding="utf-8") as f:
        f.write(sql)
        path = f.name
    try:
        env = dict(os.environ, PGCLIENTENCODING="UTF8")
        proc = subprocess.run(
            [psql, url, "-w", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-f", path],
            capture_output=True, text=True, encoding="utf-8", errors="replace", env=env, timeout=timeout,
        )
    finally:
        os.unlink(path)
    if proc.returncode != 0:
        sys.exit(f"psql falhou (exit {proc.returncode}):\n{proc.stderr[-4000:]}")
    return proc.stdout


def q(s: str | None) -> str:
    """Literal SQL (ou NULL)."""
    if s is None:
        return "null"
    return "'" + s.replace("'", "''") + "'"


def q_arr(xs: list[str] | None, typ: str) -> str:
    if xs is None:
        return f"null::{typ}[]"
    return "array[" + ",".join(q(x) for x in xs) + f"]::{typ}[]"


# ---------------------------------------------------------------------------
# Descoberta dos cenários (metadados do lab)
# ---------------------------------------------------------------------------

def discover(psql: str, url: str) -> dict:
    sql = r"""
select jsonb_build_object(
  'packs', (select coalesce(jsonb_agg(jsonb_build_object('user_id', p.user_id, 'id', p.id, 'ds', p.date_start, 'de', p.date_stop) order by p.user_id, p.id), '[]')
            from public.packs p where p.date_start is not null and p.date_stop is not null),
  'shares', (select coalesce(jsonb_agg(jsonb_build_object('grantee', s.grantee_id, 'owner', s.owner_id, 'pack', s.pack_id, 'ds', p.date_start, 'de', p.date_stop)), '[]')
             from public.pack_shares s join public.packs p on p.id = s.pack_id
             where p.date_start is not null and p.date_stop is not null),
  'top_key', (
     select coalesce(jsonb_object_agg(pack_id::text, key), '{}')
     from (
       select distinct on (m.pack_id) m.pack_id, ck.key
       from public.ad_metric_pack_map m
       join public.ad_performance_daily d on d.user_id = m.user_id and d.ad_id = m.ad_id and d.date = m.metric_date
       cross join lateral unnest(d.conv_key_ids) kid
       join public.conversion_keys ck on ck.id = kid
       group by m.pack_id, ck.key
       order by m.pack_id, count(*) desc, ck.key
     ) t),
  'sample', (
     select coalesce(jsonb_object_agg(user_id::text, s), '{}')
     from (
       select am.user_id, jsonb_build_object(
         'campaign_word', (select split_part(campaign_name, ' ', 1) from public.ad_metrics x where x.user_id = am.user_id and length(split_part(campaign_name,' ',1)) >= 3 order by date desc limit 1),
         'adset_word',    (select split_part(adset_name, ' ', 1)    from public.ad_metrics x where x.user_id = am.user_id and length(split_part(adset_name,' ',1)) >= 3 order by date desc limit 1),
         'ad_word',       (select split_part(ad_name, ' ', 1)       from public.ad_metrics x where x.user_id = am.user_id and length(split_part(ad_name,' ',1)) >= 3 order by date desc limit 1),
         'account_id',    (select account_id from public.ad_metrics x where x.user_id = am.user_id and account_id is not null order by date desc limit 1),
         'campaign_id',   (select campaign_id from public.ad_metrics x where x.user_id = am.user_id and campaign_id is not null order by date desc limit 1)
       ) as s
       from (select distinct user_id from public.ad_metrics) am
     ) u)
)::text;
"""
    out = run_sql(psql, url, sql).strip()
    return json.loads(out)


def build_scenarios(meta: dict) -> list[dict]:
    groups = ["ad_id", "ad_name", "adset_id", "campaign_id"]
    scen: list[dict] = []
    by_user: dict[str, list[dict]] = {}
    for p in meta["packs"]:
        by_user.setdefault(p["user_id"], []).append(p)
    top = meta["top_key"]
    sample = meta["sample"]

    def add(sid, actor, packs, ds, de, group_by, action=None, **kw):
        scen.append(dict(id=sid, actor=actor, packs=packs, ds=ds, de=de, group_by=group_by, action=action, **kw))

    for user, packs in by_user.items():
        for p in packs:
            for g in groups:
                # dict.fromkeys: {None, top} sem duplicar quando o pack nao tem evento
                for act in dict.fromkeys([None, top.get(p["id"])]):
                    add(f"{user[:8]}|pack:{p['id'][:8]}|{g}|{act or 'none'}", user, [p["id"]], p["ds"], p["de"], g, act)
        all_ids = [p["id"] for p in packs]
        ds = min(p["ds"] for p in packs)
        de = max(p["de"] for p in packs)
        # evento mais frequente entre os packs do usuário (o mais comum dos top por pack)
        tops = [top.get(p["id"]) for p in packs if top.get(p["id"])]
        act_all = max(set(tops), key=tops.count) if tops else None
        for g in groups:
            for act in dict.fromkeys([None, act_all]):
                add(f"{user[:8]}|all|{g}|{act or 'none'}", user, all_ids, ds, de, g, act, include_conv_types=True)
        s = sample.get(user, {})
        for ob in ("cpr", "hook", "results", "ctr", "page_conv"):
            add(f"{user[:8]}|all|ad_name|order:{ob}", user, all_ids, ds, de, "ad_name", act_all, order_by=ob)
        add(f"{user[:8]}|all|ad_name|page", user, all_ids, ds, de, "ad_name", act_all, limit=50, offset=50)
        add(f"{user[:8]}|all|ad_name|no_leads", user, all_ids, ds, de, "ad_name", act_all, include_leadscore=False)
        if s.get("campaign_id"):
            add(f"{user[:8]}|all|ad_name|campaign_id", user, all_ids, ds, de, "ad_name", act_all, campaign_id=s["campaign_id"])
        if s.get("campaign_word"):
            add(f"{user[:8]}|all|ad_name|campaign_contains", user, all_ids, ds, de, "ad_name", act_all, campaign_contains=s["campaign_word"])
        if s.get("adset_word"):
            add(f"{user[:8]}|all|adset_id|adset_contains", user, all_ids, ds, de, "adset_id", act_all, adset_contains=s["adset_word"])
        if s.get("ad_word"):
            add(f"{user[:8]}|all|ad_name|ad_contains", user, all_ids, ds, de, "ad_name", act_all, ad_contains=s["ad_word"])
        if s.get("account_id"):
            add(f"{user[:8]}|all|campaign_id|account", user, all_ids, ds, de, "campaign_id", act_all, account_ids=[s["account_id"]])
    for sh in meta["shares"]:
        for g in groups:
            add(f"share:{sh['grantee'][:8]}<-{sh['owner'][:8]}|{sh['pack'][:8]}|{g}", sh["grantee"], [sh["pack"]], sh["ds"], sh["de"], g, top.get(sh["pack"]))
    return scen


OLD_SERIES_FN = "public.fetch_manager_rankings_series_v2_legacy"   # renomeada no lab antes da 131
NEW_SERIES_FN = "public.fetch_manager_rankings_series_v2"          # wrapper da _v131


def build_series_scenarios(meta: dict) -> list[dict]:
    """Série: por (ator, packs) × 4 group_by × {sem evento, top} × janela {5, 30}.
    group_keys = até 500 chaves reais da seleção (subconsulta no read model)."""
    groups = ["ad_id", "ad_name", "adset_id", "campaign_id"]
    scen: list[dict] = []
    by_user: dict[str, list[dict]] = {}
    for p in meta["packs"]:
        by_user.setdefault(p["user_id"], []).append(p)
    top = meta["top_key"]

    def add(sid, actor, owners, packs, ds, de, g, act, window):
        scen.append(dict(id=sid, actor=actor, owners=owners, packs=packs, ds=ds, de=de, group_by=g, action=act, window=window))

    for user, packs in by_user.items():
        for p in packs:
            for g in groups:
                for act in dict.fromkeys([None, top.get(p["id"])]):
                    add(f"series|{user[:8]}|pack:{p['id'][:8]}|{g}|{act or 'none'}|w5", user, [user], [p["id"]], p["ds"], p["de"], g, act, 5)
        all_ids = [p["id"] for p in packs]
        ds, de = min(p["ds"] for p in packs), max(p["de"] for p in packs)
        tops = [top.get(p["id"]) for p in packs if top.get(p["id"])]
        act_all = max(set(tops), key=tops.count) if tops else None
        for g in groups:
            for w in (5, 30):
                for act in dict.fromkeys([None, act_all]):
                    add(f"series|{user[:8]}|all|{g}|{act or 'none'}|w{w}", user, [user], all_ids, ds, de, g, act, w)
    for sh in meta["shares"]:
        for g in groups:
            add(f"series|share:{sh['grantee'][:8]}<-{sh['owner'][:8]}|{sh['pack'][:8]}|{g}|w5", sh["grantee"], [sh["owner"]], [sh["pack"]], sh["ds"], sh["de"], g, top.get(sh["pack"]), 5)
    return scen


def series_keys_sql(s: dict) -> str:
    gk = {
        "ad_id": "d.ad_id",
        "ad_name": "coalesce(nullif(d.ad_name, ''), d.ad_id)",
        "adset_id": "d.adset_id",
        "campaign_id": "d.campaign_id",
    }[s["group_by"]]
    return (
        "(select array_agg(gk) from (select distinct " + gk + " as gk "
        "from public.ad_metric_pack_map m join public.ad_performance_daily d "
        "on d.user_id = m.user_id and d.ad_id = m.ad_id and d.date = m.metric_date "
        f"where m.user_id = any({q_arr(s['owners'], 'uuid')}) and m.pack_id = any({q_arr(s['packs'], 'uuid')}) "
        f"and m.metric_date between {q(s['ds'])}::date and {q(s['de'])}::date "
        f"and coalesce({gk}, '') <> '' order by 1 limit 500) x)"
    )


def call_series_sql(fn: str, s: dict) -> str:
    return (
        f"{fn}({q(s['actor'])}::uuid, {q(s['ds'])}::date, {q(s['de'])}::date, {q(s['group_by'])}, "
        f"{q_arr(s['packs'], 'uuid')}, null::text[], null, null, null, {q(s.get('action'))}, "
        f"{series_keys_sql(s)}, {int(s['window'])})"
    )


def series_scenario_sql(scen: list[dict]) -> str:
    parts = ["\\set ON_ERROR_STOP on", "set work_mem = '3500kB';"]
    for s in scen:
        claims = json.dumps({"sub": s["actor"]})
        parts.append("begin;")
        parts.append(f"set local request.jwt.claims = {q(claims)};")
        parts.append(
            "select " + q(s["id"]) + f" || {q(SEP)} || {call_series_sql(OLD_SERIES_FN, s)}::text || {q(SEP)} || {call_series_sql(NEW_SERIES_FN, s)}::text;"
        )
        parts.append("rollback;")
    return "\n".join(parts) + "\n"


def call_sql(fn: str, s: dict, extra: str = "") -> str:
    return (
        f"{fn}({q(s['actor'])}::uuid, {q(s['ds'])}::date, {q(s['de'])}::date, {q(s['group_by'])}, "
        f"{q_arr(s['packs'], 'uuid')}, {q_arr(s.get('account_ids'), 'text')}, "
        f"{q(s.get('campaign_contains'))}, {q(s.get('adset_contains'))}, {q(s.get('ad_contains'))}, "
        f"{q(s.get('action'))}, {'true' if s.get('include_leadscore', True) else 'false'}, "
        f"{'true' if s.get('include_conv_types', False) else 'false'}, "
        f"{int(s.get('limit', 500))}, {int(s.get('offset', 0))}, {q(s.get('order_by', 'spend'))}, {q(s.get('campaign_id'))}{extra})"
    )


# Sufixo por funcao: a v136 recebe `p_include_parent_ids`. O diferencial roda com ele
# LIGADO — desligado a igualdade ja esta provada por jsonb `=` (gate_off), e o que
# falta provar e que ligar so ACRESCENTA.
EXTRA_ARGS: dict = {}


def scenario_sql(scen: list[dict]) -> str:
    parts = ["\\set ON_ERROR_STOP on", "set work_mem = '3500kB';"]
    for s in scen:
        claims = json.dumps({"sub": s["actor"]})
        parts.append("begin;")
        parts.append(f"set local request.jwt.claims = {q(claims)};")
        parts.append(
            "select " + q(s["id"])
            + f" || {q(SEP)} || {call_sql(OLD_FN, s, EXTRA_ARGS.get(OLD_FN, ''))}::text"
            + f" || {q(SEP)} || {call_sql(NEW_FN, s, EXTRA_ARGS.get(NEW_FN, ''))}::text;"
        )
        parts.append("rollback;")
    return "\n".join(parts) + "\n"


# ---------------------------------------------------------------------------
# Comparação
# ---------------------------------------------------------------------------

def loads(s: str):
    return json.loads(s, parse_float=Decimal, parse_int=Decimal)


def num_eq(a: Decimal, b: Decimal) -> bool:
    if a == b:
        return True
    scale = max(abs(a), abs(b))
    return abs(a - b) <= REL_TOL * scale


def cmp_value(path: str, a, b, diffs: list):
    if isinstance(a, Decimal) and isinstance(b, Decimal):
        if not num_eq(a, b):
            diffs.append((path, str(a), str(b)))
        return
    if isinstance(a, dict) and isinstance(b, dict):
        if set(a) != set(b):
            diffs.append((path + ".<keys>", sorted(set(a) - set(b)), sorted(set(b) - set(a))))
        for k in a:
            if k in b:
                cmp_value(f"{path}.{k}", a[k], b[k], diffs)
        return
    if isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            diffs.append((path + ".<len>", len(a), len(b)))
            return
        for i, (x, y) in enumerate(zip(a, b)):
            cmp_value(f"{path}[{i}]", x, y, diffs)
        return
    if a != b:
        diffs.append((path, a, b))


def expand_hist(h: dict) -> list[Decimal]:
    out: list[Decimal] = []
    for k, v in (h or {}).items():
        out.extend([Decimal(k)] * int(v))
    return sorted(out)


def compare(old: dict, new: dict) -> list:
    diffs: list = []
    for key in ("pagination", "available_conversion_types", "averages", "header_aggregates"):
        cmp_value(key, old.get(key), new.get(key), diffs)
    cmp_value("overlap", old.get("overlap"), new.get("overlap"), diffs)
    od, nd = old.get("data", []), new.get("data", [])
    if len(od) != len(nd):
        diffs.append(("data.<len>", len(od), len(nd)))
        return diffs
    for i, (ro, rn) in enumerate(zip(od, nd)):
        gk = ro.get("group_key")
        if gk != rn.get("group_key"):
            diffs.append((f"data[{i}].group_key (ordem)", gk, rn.get("group_key")))
            continue
        ro2 = {k: v for k, v in ro.items() if k != "leadscore_values"}
        rn2 = {k: v for k, v in rn.items() if k != "leadscore_histogram"}
        cmp_value(f"data[{gk}]", ro2, rn2, diffs)
        lo = sorted(Decimal(x) for x in (ro.get("leadscore_values") or []))
        ln = expand_hist(rn.get("leadscore_histogram") or {})
        if lo != ln:
            diffs.append((f"data[{gk}].leads", f"{len(lo)} valores", f"{len(ln)} valores"))
    return diffs


V132_NEW_KEYS = ("media_type", "has_transcription")
V132_THUMB_KEYS = ("thumb_storage_path", "thumbnail")


def compare_v132(old: dict, new: dict) -> list:
    """v130 x v132: tudo igual, exceto (a) campos novos, que devem existir em toda linha, e
    (b) miniatura, que só pode mudar de NULL para algo (o fallback para uma cópia)."""
    diffs: list = []
    for key in ("pagination", "available_conversion_types", "averages", "header_aggregates"):
        cmp_value(key, old.get(key), new.get(key), diffs)
    cmp_value("overlap", old.get("overlap"), new.get("overlap"), diffs)
    od, nd = old.get("data", []), new.get("data", [])
    if len(od) != len(nd):
        diffs.append(("data.<len>", len(od), len(nd)))
        return diffs
    for i, (ro, rn) in enumerate(zip(od, nd)):
        gk = ro.get("group_key")
        if gk != rn.get("group_key"):
            diffs.append((f"data[{i}].group_key (ordem)", gk, rn.get("group_key")))
            continue
        for k in V132_NEW_KEYS:
            if k not in rn:
                diffs.append((f"data[{gk}].{k}", "<ausente>", "esperado presente"))
        if rn.get("media_type") not in (None, "video", "image"):
            diffs.append((f"data[{gk}].media_type", "video|image|null", rn.get("media_type")))
        if not isinstance(rn.get("has_transcription"), bool):
            diffs.append((f"data[{gk}].has_transcription", "bool", rn.get("has_transcription")))
        ro2 = {k: v for k, v in ro.items() if k not in V132_THUMB_KEYS}
        rn2 = {k: v for k, v in rn.items() if k not in V132_THUMB_KEYS and k not in V132_NEW_KEYS}
        cmp_value(f"data[{gk}]", ro2, rn2, diffs)
        if ro.get("thumb_storage_path") is not None:
            # representante tinha miniatura: nada pode mudar
            for k in V132_THUMB_KEYS:
                cmp_value(f"data[{gk}].{k}", ro.get(k), rn.get(k), diffs)
        # senão: a v132 pode ter achado a miniatura de uma cópia (fallback) — permitido
    return diffs


V136_NEW_KEYS = ("campaign_ids", "adset_ids")


def compare_v136(old: dict, new: dict) -> list:
    """v132 x v136: tudo igual, mais tres invariantes sobre o que e novo.

    1. `campaign_ids`/`adset_ids` existem em TODA linha e sao listas.
    2. Coerencia com o que ja existia: o pai do REPRESENTANTE (`campaign_id`/
       `adset_id`, que a v132 ja devolvia) tem de estar dentro do array. Se nao
       estiver, a agregacao nova esta olhando outro conjunto de anuncios — e o
       diferencial de campos antigos nao pegaria isso, porque os antigos nao mudam.
    3. O dicionario `names` nao inventa: toda chave dele aparece em alguma linha.
       A cobertura inversa (todo id ter nome) e reportada, nao exigida: um anuncio
       cuja copia em `ads` esta sem `campaign_name` nao tem nome a oferecer, e o
       avaliador ja ignora id sem nome.
    """
    diffs: list = []
    for key in ("pagination", "available_conversion_types", "averages", "header_aggregates"):
        cmp_value(key, old.get(key), new.get(key), diffs)
    cmp_value("overlap", old.get("overlap"), new.get("overlap"), diffs)

    names = new.get("names")
    if not isinstance(names, dict):
        diffs.append(("names", "objeto", type(names).__name__))
        names = {}
    campanhas = names.get("campaigns") or {}
    conjuntos = names.get("adsets") or {}

    od, nd = old.get("data", []), new.get("data", [])
    if len(od) != len(nd):
        diffs.append(("data.<len>", len(od), len(nd)))
        return diffs

    vistos_camp: set = set()
    vistos_adset: set = set()
    for i, (ro, rn) in enumerate(zip(od, nd)):
        gk = ro.get("group_key")
        if gk != rn.get("group_key"):
            diffs.append((f"data[{i}].group_key (ordem)", gk, rn.get("group_key")))
            continue
        for k in V136_NEW_KEYS:
            v = rn.get(k)
            if not isinstance(v, list):
                diffs.append((f"data[{gk}].{k}", "lista", repr(v)))
        cids = [str(x) for x in (rn.get("campaign_ids") or [])]
        aids = [str(x) for x in (rn.get("adset_ids") or [])]
        vistos_camp.update(cids)
        vistos_adset.update(aids)
        # invariante 2: o pai do representante esta no array
        rep_c = ro.get("campaign_id")
        if rep_c and str(rep_c) not in cids:
            diffs.append((f"data[{gk}].campaign_ids", f"contem o representante {rep_c}", cids[:5]))
        rep_a = ro.get("adset_id")
        if rep_a and str(rep_a) not in aids:
            diffs.append((f"data[{gk}].adset_ids", f"contem o representante {rep_a}", aids[:5]))
        # Campos antigos: identicos, INCLUSIVE o histograma de leads. Os dois lados
        # ja o devolvem nesse formato (a conversao leadscore_values -> histograma foi
        # na v130); comparar um contra o outro direto e mais forte que reexpandir.
        rn2 = {k: v for k, v in rn.items() if k not in V136_NEW_KEYS}
        cmp_value(f"data[{gk}]", ro, rn2, diffs)

    # invariante 3: o dicionario nao tem chave que nenhuma linha cita
    sobra_c = set(campanhas) - vistos_camp
    sobra_a = set(conjuntos) - vistos_adset
    if sobra_c:
        diffs.append(("names.campaigns", "so ids das linhas", f"{len(sobra_c)} sobrando"))
    if sobra_a:
        diffs.append(("names.adsets", "so ids das linhas", f"{len(sobra_a)} sobrando"))
    return diffs


# ---------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="rodar só os N primeiros cenários")
    ap.add_argument("--verbose", action="store_true")
    ap.add_argument("--filter", default="", help="substring do id do cenário")
    ap.add_argument("--series", action="store_true",
                    help="compara a serie (fetch_manager_rankings_series_v2_legacy x wrapper da _v131) em vez da core")
    ap.add_argument("--v136", action="store_true",
                    help="compara base_v132 x base_v136: campos antigos identicos; campaign_ids/adset_ids "
                         "novos e coerentes com o representante; dicionario `names` cobre os ids das linhas")
    ap.add_argument("--v132", action="store_true",
                    help="compara base_v130 x base_v132: campos antigos identicos; media_type/has_transcription novos; "
                         "thumb so muda onde a v130 nao tinha")
    args = ap.parse_args()
    global OLD_FN, NEW_FN
    if args.v132:
        OLD_FN = "public.fetch_manager_performance_base_v130"
        NEW_FN = "public.fetch_manager_performance_base_v132"
    if args.v136:
        OLD_FN = "public.fetch_manager_performance_base_v132"
        NEW_FN = "public.fetch_manager_performance_base_v136"
        EXTRA_ARGS[NEW_FN] = ", true"   # p_include_parent_ids

    psql = find_psql()
    url = os.environ.get("LAB_URL", LAB_URL_DEFAULT)
    if "supabase.co" in url:
        sys.exit("Recusando rodar contra o Supabase remoto: o diferencial e para o lab local.")

    meta = discover(psql, url)
    scen = build_series_scenarios(meta) if args.series else build_scenarios(meta)
    if args.filter:
        scen = [s for s in scen if args.filter in s["id"]]
    if args.limit:
        scen = scen[: args.limit]
    print(f"{len(scen)} cenarios ({len(meta['packs'])} packs, {len(meta['shares'])} compartilhamentos)"
          + (" [serie]" if args.series else ""))

    out = run_sql(psql, url, series_scenario_sql(scen) if args.series else scenario_sql(scen))
    lines = [ln for ln in out.split("\n") if SEP in ln]
    if len(lines) != len(scen):
        print(f"AVISO: {len(lines)} resultados para {len(scen)} cenarios")

    total_diffs = 0
    bad = 0
    for ln in lines:
        sid, old_s, new_s = ln.split(SEP, 2)
        old, new = loads(old_s), loads(new_s)
        if args.series:
            diffs = []
            cmp_value("series", old, new, diffs)   # contrato integral: window + series_by_group
        elif args.v136:
            diffs = compare_v136(old, new)
        elif args.v132:
            diffs = compare_v132(old, new)
        else:
            diffs = compare(old, new)
        if diffs:
            bad += 1
            total_diffs += len(diffs)
            print(f"\nDIVERGE {sid}: {len(diffs)} diferenca(s)")
            for d in diffs[: (50 if args.verbose else 5)]:
                print("   ", d)
        elif args.verbose:
            print(f"ok {sid} ({len(old.get('data', []))} linhas)")

    print(f"\n{len(lines) - bad}/{len(lines)} cenarios identicos; {bad} divergentes; {total_diffs} diferencas")
    return 0 if bad == 0 and len(lines) == len(scen) else 1


if __name__ == "__main__":
    sys.exit(main())
