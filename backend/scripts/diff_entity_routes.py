#!/usr/bin/env python
"""
Teste DIFERENCIAL das 7 rotas de detalhe: rota ANTIGA (Python somando ad_metrics cru
via PostgREST) × rota NOVA (RPC fetch_entity_performance_v133 sobre o read model,
migration 133).

O QUE PROVA
-----------
Que cada rota devolve o MESMO contrato de antes, sobre dados reais, para toda
combinação relevante de (ator, packs, período, entidade). As duas implementações rodam
no MESMO processo, contra o MESMO banco de laboratório: a antiga vem do git (commit
anterior à 133) e é executada com um cliente Supabase falso que traduz o query builder
do PostgREST para SQL; a nova é o código do working tree.

ONDE RODA
---------
Só no laboratório local (Postgres 17 com o dump restaurado + migration 133 aplicada —
ver supabase/tests/README.md). Recusa URLs do Supabase. Precisa de `psycopg` no venv
(dependência SÓ de laboratório: `pip install "psycopg[binary]"`; não está no
requirements.txt de propósito — produção fala PostgREST, não Postgres).

    LAB_URL=postgresql://postgres@127.0.0.1:5433/hookify_lab \\
      backend/venv/Scripts/python backend/scripts/diff_entity_routes.py \\
        [--old-ref 516dd37] [--limit N] [--filter TEXTO] [--verbose]

CENÁRIOS (descobertos no banco)
-------------------------------
Para cada pack com período: os ad_names com mais cópias, com leads e com conversões;
ad_ids e adset_ids do pack; período inteiro e só os 5 últimos dias; o pack sozinho e
todos os packs do dono. Para cada compartilhamento (pack_shares): o convidado pedindo
o pack do dono (caminho cross-silo). Ramo legado (sem pack_ids) para alguns. Para
cada cenário rodam as rotas aplicáveis à entidade:
  ad_id    → /ad-id/{id}, /ad-id/{id}/history
  ad_name  → /ad-name/{n}/details, /ad-name/{n}/children (sem ordem e order_by=spend),
             /ad-name/{n}/history
  adset_id → /adset-id/{id}, /adset-id/{id}/children

COMPARAÇÃO (o que é exato e o que é tolerado, e por quê)
--------------------------------------------------------
Exato: todo campo, inteiros idênticos, razões com tolerância relativa 1e-9 (ordem de
soma float × numeric). Listas de filhos casadas por ad_id (a antiga saía na ordem
física do PostgREST, que não é contrato); com order_by, a nova precisa estar ordenada.
Tolerado, contado e listado no relatório:
  * `leadscore_values`: comparado como MULTICONJUNTO (a antiga concatenava na ordem
    das linhas; a nova expande o histograma ordenado — nenhum consumidor lê a ordem).
  * nomes (ad_name/campaign_name/adset_name/account_id/campaign_id/adset_id): a
    antiga pegava a PRIMEIRA linha que o PostgREST devolvesse (ordem física); a nova
    usa a linha representante do Manager (dia de mais impressões). Diferença só é
    aceita se AMBOS os valores existem na entidade no período (verificado no banco) —
    entidade renomeada no meio do período.
  * `thumbnail` no detalhe por ad_name: a antiga usava o menor ad_id; a nova, o
    representante com fallback para qualquer cópia. Aceito só quando a antiga era
    nula ou quando os dois caminhos são não-nulos (cópias do mesmo criativo
    compartilham a mídia).
  * detalhe do conjunto: `series.hold_rate/scroll_stop/video_watched_p50/p75` — a
    rota antiga alimentava ZEROS nesses acumuladores (bug: mostrava 0 com plays > 0);
    a nova manda os valores reais. Exceção documentada, não tolerância silenciosa.
Qualquer outra diferença é bug. Critério de saída: 0 divergências não classificadas.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import types
from decimal import Decimal
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))

LAB_URL_DEFAULT = "postgresql://postgres@127.0.0.1:5433/hookify_lab"
OLD_REF_DEFAULT = "516dd37"
REL_TOL = 1e-9
NAME_KEYS = ("ad_name", "campaign_name", "adset_name", "account_id", "campaign_id", "adset_id")
ADSET_SERIES_EXEMPT = ("hold_rate", "scroll_stop", "video_watched_p50", "video_watched_p75")


# ---------------------------------------------------------------------------
# Cliente Supabase falso: query builder do PostgREST → SQL no laboratório
# ---------------------------------------------------------------------------

class _Res:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, conn, table: str):
        self._conn = conn
        self._table = table
        self._cols = "*"
        self._where: list[tuple[str, list]] = []
        self._order: list[str] = []
        self._limit: int | None = None
        self._offset: int | None = None

    def select(self, cols: str):
        self._cols = ", ".join(c.strip() for c in cols.split(",") if c.strip())
        return self

    def eq(self, col, val):
        self._where.append((f"{col} = %s", [val]))
        return self

    def neq(self, col, val):
        self._where.append((f"{col} <> %s", [val]))
        return self

    def gte(self, col, val):
        self._where.append((f"{col} >= %s", [val]))
        return self

    def lte(self, col, val):
        self._where.append((f"{col} <= %s", [val]))
        return self

    def in_(self, col, vals):
        self._where.append((f"{col} = any(%s)", [list(vals)]))
        return self

    def is_(self, col, val):
        self._where.append((f"{col} is {'null' if val in (None, 'null') else val}", []))
        return self

    def order(self, col, desc: bool = False, **_):
        self._order.append(f"{col} {'desc' if desc else 'asc'}")
        return self

    def limit(self, n: int):
        self._limit = int(n)
        return self

    def range(self, a: int, b: int):
        self._offset = int(a)
        self._limit = int(b) - int(a) + 1
        return self

    def execute(self):
        sql = f"select {self._cols} from public.{self._table}"
        params: list = []
        if self._where:
            sql += " where " + " and ".join(w for w, _ in self._where)
            for _, p in self._where:
                params.extend(p)
        # Sem ORDER BY explícito, ordem FÍSICA (ctid): a paginação por offset da rota
        # antiga exige uma ordem estável entre páginas — ordenar por uma coluna não
        # única (ad_id) perdia/duplicava linhas na fronteira das páginas.
        sql += " order by " + (", ".join(self._order) if self._order else "ctid")
        if self._limit is not None:
            sql += f" limit {self._limit}"
        if self._offset:
            sql += f" offset {self._offset}"
        with self._conn.cursor() as cur:
            cur.execute(f"select coalesce(json_agg(t), '[]'::json)::text from ({sql}) t", params)
            raw = cur.fetchone()[0]
        return _Res(json.loads(raw))


class _Rpc:
    def __init__(self, conn, sig_cache: dict, name: str, params: dict):
        self._conn, self._sig, self._name, self._params = conn, sig_cache, name, params

    def _signature(self):
        if self._name not in self._sig:
            with self._conn.cursor() as cur:
                cur.execute(
                    """
                    select p.proargnames, p.proretset,
                           (select array_agg(format_type(t, null) order by ord)
                              from unnest(p.proargtypes::oid[]) with ordinality as u(t, ord))
                    from pg_proc p
                    where p.pronamespace = 'public'::regnamespace and p.proname = %s
                    order by p.pronargs desc limit 1
                    """,
                    [self._name],
                )
                row = cur.fetchone()
            if not row:
                raise RuntimeError(f"RPC desconhecida no lab: {self._name}")
            names, retset, types_ = row
            self._sig[self._name] = (list(names or []), bool(retset), list(types_ or []))
        return self._sig[self._name]

    def execute(self):
        names, retset, types_ = self._signature()
        typed = dict(zip(names, types_))
        args, params = [], []
        for k, v in self._params.items():
            if k not in typed:
                raise RuntimeError(f"{self._name}: parametro {k} nao existe")
            t = typed[k]
            if isinstance(v, (dict, list)) and t.startswith("json"):
                v = json.dumps(v)
            args.append(f"{k} => %s::{t}")
            params.append(v)
        call = f"public.{self._name}({', '.join(args)})"
        with self._conn.cursor() as cur:
            if retset:
                cur.execute(f"select coalesce(json_agg(t), '[]'::json)::text from {call} t", params)
                return _Res(json.loads(cur.fetchone()[0]))
            cur.execute(f"select to_json({call})::text", params)
            raw = cur.fetchone()[0]
            return _Res(None if raw is None else json.loads(raw))


class FakeSupabase:
    """O subconjunto do supabase-py que as rotas (antiga e nova) usam."""

    def __init__(self, conn):
        self._conn = conn
        self._sig: dict = {}

    def table(self, name: str):
        return _Query(self._conn, name)

    def rpc(self, name: str, params: dict | None = None):
        return _Rpc(self._conn, self._sig, name, dict(params or {}))


# ---------------------------------------------------------------------------
# Módulos: antigo (git) e novo (working tree)
# ---------------------------------------------------------------------------

def load_from_git(ref: str, rel_path: str, mod_name: str) -> types.ModuleType:
    src = subprocess.run(
        ["git", "show", f"{ref}:{rel_path}"], cwd=str(ROOT), check=True,
        capture_output=True, text=True, encoding="utf-8",
    ).stdout
    mod = types.ModuleType(mod_name)
    mod.__file__ = f"<git:{ref}:{rel_path}>"
    sys.modules[mod_name] = mod
    exec(compile(src, mod.__file__, "exec"), mod.__dict__)
    return mod


def patch_clients(mod: types.ModuleType, sb: FakeSupabase):
    for attr in ("get_supabase_for_user", "get_supabase_service"):
        if hasattr(mod, attr):
            setattr(mod, attr, lambda *a, _sb=sb, **k: _sb)


# ---------------------------------------------------------------------------
# Cenários
# ---------------------------------------------------------------------------

DISCOVER_SQL = r"""
select json_build_object(
  'packs', (select coalesce(json_agg(json_build_object('user_id', p.user_id, 'id', p.id, 'ds', p.date_start, 'de', p.date_stop) order by p.user_id, p.id), '[]')
            from public.packs p where p.date_start is not null and p.date_stop is not null),
  'shares', (select coalesce(json_agg(json_build_object('grantee', s.grantee_id, 'owner', s.owner_id, 'pack', s.pack_id, 'ds', p.date_start, 'de', p.date_stop)), '[]')
             from public.pack_shares s join public.packs p on p.id = s.pack_id
             where p.date_start is not null and p.date_stop is not null),
  'entities', (
    select coalesce(json_object_agg(pack_id::text, ents), '{}')
    from (
      select m.pack_id, json_build_object(
        'ad_names', (
          select json_agg(x.ad_name) from (
            (select am.ad_name, 1 as pri from public.ad_metric_pack_map q join public.ad_metrics am on am.user_id = q.user_id and am.ad_id = q.ad_id and am.date = q.metric_date
               where q.pack_id = m.pack_id and coalesce(am.ad_name, '') <> '' group by am.ad_name order by count(distinct am.ad_id) desc limit 2)
            union all
            (select am.ad_name, 2 from public.ad_metric_pack_map q join public.ad_performance_daily d on d.user_id = q.user_id and d.ad_id = q.ad_id and d.date = q.metric_date
               join public.ad_metrics am on am.user_id = q.user_id and am.ad_id = q.ad_id and am.date = q.metric_date
               where q.pack_id = m.pack_id and cardinality(d.lead_scores) > 0 and coalesce(am.ad_name, '') <> '' group by am.ad_name order by sum(cardinality(d.lead_scores)) desc limit 1)
            union all
            (select am.ad_name, 3 from public.ad_metric_pack_map q join public.ad_performance_daily d on d.user_id = q.user_id and d.ad_id = q.ad_id and d.date = q.metric_date
               join public.ad_metrics am on am.user_id = q.user_id and am.ad_id = q.ad_id and am.date = q.metric_date
               where q.pack_id = m.pack_id and cardinality(d.conv_key_ids) > 0 and coalesce(am.ad_name, '') <> '' group by am.ad_name order by sum(cardinality(d.conv_key_ids)) desc limit 1)
          ) x
        ),
        'ad_ids', (
          select json_agg(x.ad_id) from (
            (select q.ad_id from public.ad_metric_pack_map q where q.pack_id = m.pack_id group by q.ad_id order by count(*) desc limit 2)
            union all
            (select q.ad_id from public.ad_metric_pack_map q join public.ad_performance_daily d on d.user_id = q.user_id and d.ad_id = q.ad_id and d.date = q.metric_date
               where q.pack_id = m.pack_id and cardinality(d.lead_scores) > 0 group by q.ad_id order by sum(cardinality(d.lead_scores)) desc limit 1)
          ) x
        ),
        'adset_ids', (
          select json_agg(x.adset_id) from (
            select am.adset_id from public.ad_metric_pack_map q join public.ad_metrics am on am.user_id = q.user_id and am.ad_id = q.ad_id and am.date = q.metric_date
            where q.pack_id = m.pack_id and coalesce(am.adset_id, '') <> '' group by am.adset_id order by count(distinct am.ad_id) desc limit 2
          ) x
        )
      ) as ents
      from (select distinct pack_id from public.ad_metric_pack_map) m
    ) e
  )
)::text;
"""


def discover(conn) -> dict:
    with conn.cursor() as cur:
        cur.execute(DISCOVER_SQL)
        return json.loads(cur.fetchone()[0])


def last5(de: str) -> str:
    from datetime import date, timedelta
    d = date.fromisoformat(de)
    return (d - timedelta(days=4)).isoformat()


def build_scenarios(meta: dict) -> list[dict]:
    out: list[dict] = []
    packs_by_user: dict[str, list[dict]] = {}
    for p in meta["packs"]:
        packs_by_user.setdefault(p["user_id"], []).append(p)

    def add(actor, packs, ds, de, kind, ent, tag):
        out.append({"actor": actor, "packs": packs, "ds": ds, "de": de, "kind": kind, "id": ent, "tag": tag})

    for user, packs in packs_by_user.items():
        all_ids = [p["id"] for p in packs]
        ds_all = min(p["ds"] for p in packs)
        de_all = max(p["de"] for p in packs)
        for p in packs:
            ents = meta["entities"].get(p["id"]) or {}
            for kind, key in (("ad_name", "ad_names"), ("ad_id", "ad_ids"), ("adset_id", "adset_ids")):
                for i, ent in enumerate(dict.fromkeys(ents.get(key) or [])):
                    add(user, [p["id"]], p["ds"], p["de"], kind, ent, f"pack:{kind}:{i}")
                    if i == 0:
                        add(user, [p["id"]], last5(p["de"]), p["de"], kind, ent, f"pack5d:{kind}")
                        if len(all_ids) > 1:
                            add(user, all_ids, ds_all, de_all, kind, ent, f"allpacks:{kind}")
                        add(user, None, p["ds"], p["de"], kind, ent, f"legacy:{kind}")
    for s in meta["shares"]:
        ents = meta["entities"].get(s["pack"]) or {}
        for kind, key in (("ad_name", "ad_names"), ("ad_id", "ad_ids"), ("adset_id", "adset_ids")):
            for ent in list(dict.fromkeys(ents.get(key) or []))[:1]:
                add(s["grantee"], [s["pack"]], s["ds"], s["de"], kind, ent, f"share:{kind}")
    # inexistente: as duas rotas de detalhe têm de responder 404 igual
    if meta["packs"]:
        p = meta["packs"][0]
        add(p["user_id"], [p["id"]], p["ds"], p["de"], "ad_id", "0", "missing:ad_id")
        add(p["user_id"], [p["id"]], p["ds"], p["de"], "ad_name", "\x1f nome que nao existe", "missing:ad_name")
        add(p["user_id"], [p["id"]], p["ds"], p["de"], "adset_id", "0", "missing:adset_id")
    return out


# ---------------------------------------------------------------------------
# Execução das rotas
# ---------------------------------------------------------------------------

class _Http:
    def __init__(self, status: int, detail: Any):
        self.status, self.detail = status, detail


def call(fn, **kw):
    from fastapi import HTTPException
    try:
        return fn(**kw)
    except HTTPException as e:
        return _Http(e.status_code, e.detail)


def routes_for(mod, s: dict) -> list[tuple[str, Any, dict]]:
    user = {"user_id": s["actor"], "token": "lab"}
    base = dict(date_start=s["ds"], date_stop=s["de"], pack_ids=s["packs"], user=user)
    k, ent = s["kind"], s["id"]
    if k == "ad_id":
        return [
            ("ad_details", mod.get_ad_details, dict(ad_id=ent, **base)),
            ("ad_history", mod.get_ad_history, dict(ad_id=ent, **base)),
        ]
    if k == "ad_name":
        return [
            ("ad_name_details", mod.get_ad_name_details, dict(ad_name=ent, include_leadscore=True, **base)),
            ("ad_name_children", mod.get_rankings_children, dict(ad_name=ent, order_by=None, include_leadscore=True, **base)),
            ("ad_name_children_spend", mod.get_rankings_children, dict(ad_name=ent, order_by="spend", include_leadscore=True, **base)),
            ("ad_name_history", mod.get_ad_name_history, dict(ad_name=ent, **base)),
        ]
    return [
        ("adset_details", mod.get_adset_details, dict(adset_id=ent, **base)),
        ("adset_children", mod.get_adset_children, dict(adset_id=ent, order_by=None, include_leadscore=True, **base)),
    ]


# ---------------------------------------------------------------------------
# Comparação
# ---------------------------------------------------------------------------

def num_eq(a, b) -> bool:
    if a == b:
        return True
    try:
        fa, fb = float(a), float(b)
    except (TypeError, ValueError):
        return False
    scale = max(abs(fa), abs(fb))
    return abs(fa - fb) <= REL_TOL * scale


def is_num(x) -> bool:
    return isinstance(x, (int, float, Decimal)) and not isinstance(x, bool)


def cmp(path: str, a, b, diffs: list):
    if is_num(a) and is_num(b):
        if not num_eq(a, b):
            diffs.append((path, a, b))
        return
    if isinstance(a, dict) and isinstance(b, dict):
        if set(a) != set(b):
            diffs.append((path + ".<keys>", sorted(set(a) - set(b)), sorted(set(b) - set(a))))
        for k in a:
            if k in b:
                cmp(f"{path}.{k}", a[k], b[k], diffs)
        return
    if isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            diffs.append((path + ".<len>", len(a), len(b)))
            return
        for i, (x, y) in enumerate(zip(a, b)):
            cmp(f"{path}[{i}]", x, y, diffs)
        return
    if a != b:
        diffs.append((path, a, b))


class Tolerated:
    def __init__(self):
        self.counts: dict[str, int] = {}
        self.samples: dict[str, list] = {}

    def add(self, kind: str, sample):
        self.counts[kind] = self.counts.get(kind, 0) + 1
        self.samples.setdefault(kind, [])
        if len(self.samples[kind]) < 3:
            self.samples[kind].append(sample)


def entity_has_both_values(conn, s: dict, field: str, a, b) -> bool:
    """Ambos os valores existem na entidade no período? (renomeada no meio)."""
    col = {"ad_id": "ad_id", "ad_name": "ad_name", "adset_id": "adset_id"}[s["kind"]]
    sql = f"""
      select count(distinct {field}) filter (where {field} = any(%s))
      from public.ad_metrics
      where {col} = %s and date >= %s and date <= %s
    """
    with conn.cursor() as cur:
        cur.execute(sql, [[a, b], s["id"], s["ds"], s["de"]])
        return cur.fetchone()[0] == 2


def compare_item(route: str, path: str, old: dict, new: dict, s: dict, conn, diffs: list, tol: Tolerated):
    """Um objeto de detalhe/filho: tudo exato, salvo as tolerâncias documentadas."""
    o = dict(old)
    n = dict(new)
    # leads: multiconjunto
    lo = sorted(float(x) for x in (o.pop("leadscore_values", None) or []))
    ln = sorted(float(x) for x in (n.pop("leadscore_values", None) or []))
    if lo != ln:
        diffs.append((f"{path}.leadscore_values", f"{len(lo)} valores", f"{len(ln)} valores"))
    elif lo and (old.get("leadscore_values") or []) != (new.get("leadscore_values") or []):
        tol.add("leads:ordem", s["tag"])
    # nomes: representante ≠ primeira linha física
    for k in NAME_KEYS:
        if k in o and k in n and o[k] != n[k]:
            if o[k] is not None and n[k] is not None and entity_has_both_values(conn, s, k, o[k], n[k]):
                tol.add(f"nome:{k}", (s["tag"], o[k], n[k]))
                o.pop(k)
                n.pop(k)
    # miniatura no ad_name: representante/fallback
    if route == "ad_name_details" and o.get("thumbnail") != n.get("thumbnail"):
        if o.get("thumbnail") is None or (o.get("thumbnail") and n.get("thumbnail")):
            tol.add("thumb:ad_name", (s["tag"], o.get("thumbnail"), n.get("thumbnail")))
            o.pop("thumbnail", None)
            n.pop("thumbnail", None)
    # detalhe do conjunto: séries que a antiga zerava
    if route == "adset_details":
        so, sn = o.get("series") or {}, n.get("series") or {}
        for k in ADSET_SERIES_EXEMPT:
            if k in so and so[k] != sn.get(k):
                tol.add(f"adset_series:{k}", s["tag"])
                so = dict(so)
                sn = dict(sn)
                so.pop(k)
                sn.pop(k, None)
                o["series"], n["series"] = so, sn
    cmp(path, o, n, diffs)


def compare_route(route: str, old, new, s: dict, conn, diffs: list, tol: Tolerated):
    if isinstance(old, _Http) or isinstance(new, _Http):
        so = old.status if isinstance(old, _Http) else 200
        sn = new.status if isinstance(new, _Http) else 200
        if so != sn:
            diffs.append((f"{route}.<status>", so, sn))
        return
    if route.endswith("history"):
        cmp(route, old, new, diffs)
        return
    if route.endswith("children") or route.endswith("children_spend"):
        od = {str(x.get("ad_id")): x for x in old.get("data", [])}
        nd = {str(x.get("ad_id")): x for x in new.get("data", [])}
        if set(od) != set(nd):
            diffs.append((f"{route}.<ad_ids>", sorted(set(od) - set(nd)), sorted(set(nd) - set(od))))
        for aid in sorted(set(od) & set(nd)):
            compare_item(route, f"{route}[{aid}]", od[aid], nd[aid], s, conn, diffs, tol)
        if route.endswith("_spend"):
            vals = [x.get("spend") or 0 for x in new.get("data", [])]
            if vals != sorted(vals, reverse=True):
                diffs.append((f"{route}.<ordem spend desc>", "ordenado", "desordenado"))
        return
    compare_item(route, route, old, new, s, conn, diffs, tol)


# ---------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lab-url", default=os.environ.get("LAB_URL", LAB_URL_DEFAULT))
    ap.add_argument("--old-ref", default=OLD_REF_DEFAULT)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--filter", default="")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    if "supabase.co" in args.lab_url:
        sys.exit("recusado: este script roda SO no laboratorio local")
    try:
        import psycopg
    except ImportError:
        sys.exit("psycopg ausente: pip install \"psycopg[binary]\" (so no venv de laboratorio)")

    conn = psycopg.connect(args.lab_url, autocommit=True)
    sb = FakeSupabase(conn)

    # módulos
    os.environ.setdefault("CLIENT_DISCONNECT_ABORT_ENABLED", "false")
    from app.routes import analytics as new_mod
    from app.services import entity_performance as new_ep
    old_repo = load_from_git(args.old_ref, "backend/app/services/supabase_repo.py", "supabase_repo_legacy")
    old_mod = load_from_git(args.old_ref, "backend/app/routes/analytics.py", "analytics_legacy")
    old_mod.supabase_repo = old_repo
    for m in (new_mod, new_ep, old_mod, old_repo):
        patch_clients(m, sb)

    meta = discover(conn)
    scen = build_scenarios(meta)
    if args.filter:
        scen = [s for s in scen if args.filter in s["tag"] or args.filter in s["id"]]
    if args.limit:
        scen = scen[: args.limit]
    print(f"{len(scen)} cenarios ({len(meta['packs'])} packs, {len(meta['shares'])} compartilhamentos)")

    tol = Tolerated()
    total_routes = 0
    bad = 0
    for i, s in enumerate(scen, 1):
        with conn.cursor() as cur:
            cur.execute("select set_config('request.jwt.claims', %s, false)", [json.dumps({"sub": s["actor"], "role": "authenticated"})])
        for route, _fn, kw in routes_for(old_mod, s):
            total_routes += 1
            old = call(getattr(old_mod, _fn.__name__), **kw)
            new = call(getattr(new_mod, _fn.__name__), **kw)
            diffs: list = []
            compare_route(route, old, new, s, conn, diffs, tol)
            if diffs:
                bad += 1
                print(f"[{i}] DIVERGE {route} {s['tag']} {s['kind']}={s['id']!r} packs={s['packs']} {s['ds']}..{s['de']}")
                for d in diffs[:12]:
                    print("     ", d)
            elif args.verbose:
                print(f"[{i}] ok {route} {s['tag']}")
    print()
    print(f"{total_routes} chamadas de rota; {bad} divergentes")
    if tol.counts:
        print("toleradas (documentadas no cabecalho):")
        for k, v in sorted(tol.counts.items()):
            print(f"  {k}: {v}  ex.: {tol.samples[k][:2]}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
