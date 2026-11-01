"""Diferencial de versão da Graph API: mesmas leituras em duas versões, lado a lado.

Uso (só leitura — nenhum POST de escrita; o relatório async é uma leitura com janela de 3 dias):
    venv/Scripts/python.exe scripts/meta_version_diff.py --email voce@x.com [--account act_123] \
        [--old v24.0] [--new v26.0] [--out relatorio.json]

Para cada consulta compara: status HTTP, erro da Meta, chaves devolvidas e totais numéricos.
Serve para a migração atual e para as próximas (documentation/plano-upgrade-graph-api-v26.md).
Os campos pedidos vêm do próprio código do app, então o diferencial testa o que roda em produção.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.supabase_client import get_supabase_service  # noqa: E402
from app.services.ads_enricher import AdsEnricher  # noqa: E402
from app.services.graph_api import AD_INSIGHTS_FIELDS  # noqa: E402
from app.services.token_encryption import decrypt_token  # noqa: E402

TOKEN_RE = re.compile(r"access_token=[^&\"']+")


def scrub(value: Any) -> Any:
    """Tira tokens de qualquer string (URLs de paginação trazem access_token)."""
    if isinstance(value, str):
        return TOKEN_RE.sub("access_token=<redacted>", value)
    if isinstance(value, dict):
        return {k: ("<redacted>" if k == "access_token" else scrub(v)) for k, v in value.items()}
    if isinstance(value, list):
        return [scrub(v) for v in value]
    return value


class Graph:
    def __init__(self, version: str, token: str):
        self.base = f"https://graph.facebook.com/{version}/"
        self.token = token

    def get(self, path: str, **params: Any) -> Dict[str, Any]:
        resp = requests.get(self.base + path, params={**params, "access_token": self.token}, timeout=60)
        try:
            body = resp.json()
        except ValueError:
            body = {"_raw": resp.text[:500]}
        return {"http": resp.status_code, "body": body}

    def post(self, path: str, **params: Any) -> Dict[str, Any]:
        resp = requests.post(self.base + path, params={**params, "access_token": self.token}, timeout=60)
        return {"http": resp.status_code, "body": resp.json()}


def user_token(email: str) -> tuple[str, str]:
    sb = get_supabase_service()
    users = sb.auth.admin.list_users(per_page=1000)
    user = next((u for u in users if (u.email or "").lower() == email.lower()), None)
    if not user:
        raise SystemExit(f"usuário {email} não encontrado")
    rows = (
        sb.table("facebook_connections").select("access_token,is_primary,status")
        .eq("user_id", user.id).execute().data or []
    )
    rows.sort(key=lambda r: (r.get("status") != "active", not r.get("is_primary")))
    if not rows:
        raise SystemExit("usuário sem conexão do Facebook")
    return user.id, decrypt_token(rows[0]["access_token"])


# ── Resumo comparável de uma resposta ────────────────────────────────────────

def _keys(node: Any, prefix: str = "", out: Optional[set] = None, depth: int = 0) -> set:
    out = set() if out is None else out
    if depth > 4:
        return out
    if isinstance(node, dict):
        for k, v in node.items():
            if k in ("paging", "cursors", "next", "previous"):
                continue
            out.add(prefix + k)
            _keys(v, prefix + k + ".", out, depth + 1)
    elif isinstance(node, list):
        for v in node[:20]:
            _keys(v, prefix, out, depth + 1)
    return out


def _numeric_totals(rows: List[Dict[str, Any]]) -> Dict[str, float]:
    totals: Dict[str, float] = {}
    for row in rows:
        for k, v in row.items():
            try:
                totals[k] = totals.get(k, 0.0) + float(v)
            except (TypeError, ValueError):
                continue
    return {k: round(v, 4) for k, v in totals.items()}


def summarize(result: Dict[str, Any]) -> Dict[str, Any]:
    body = result.get("body") or {}
    err = body.get("error") if isinstance(body, dict) else None
    data = body.get("data") if isinstance(body, dict) else None
    rows = data if isinstance(data, list) else ([body] if isinstance(body, dict) and not err else [])
    return {
        "http": result.get("http"),
        "error": {k: err.get(k) for k in ("code", "error_subcode", "message")} if err else None,
        "rows": len(rows),
        "keys": sorted(_keys(rows)),
        "totals": _numeric_totals([r for r in rows if isinstance(r, dict)]),
    }


# ── Consultas (espelham o que o app faz) ─────────────────────────────────────

def run_async_insights(g: Graph, act: str, since: str, until: str) -> Dict[str, Any]:
    start = g.post(
        f"{act}/insights",
        fields=AD_INSIGHTS_FIELDS, level="ad", time_increment="1",
        action_attribution_windows="['7d_click','1d_view']", use_account_attribution_setting="true",
        action_breakdowns="action_type", time_range=json.dumps({"since": since, "until": until}), limit=5000,
        **{"async": "true"},
    )
    run_id = (start.get("body") or {}).get("report_run_id")
    if not run_id:
        return start
    status: Dict[str, Any] = {}
    for _ in range(60):
        status = g.get(run_id, fields="async_status,async_percent_completion")
        if (status.get("body") or {}).get("async_status") in ("Job Completed", "Job Failed", "Job Skipped"):
            break
        time.sleep(3)
    if (status.get("body") or {}).get("async_status") != "Job Completed":
        return {"http": status.get("http"), "body": {"error": {"message": f"async: {status.get('body')}"}}}
    rows: List[Dict[str, Any]] = []
    page = g.get(f"{run_id}/insights", limit=500)
    rows.extend((page.get("body") or {}).get("data") or [])
    nxt = ((page.get("body") or {}).get("paging") or {}).get("next")
    while nxt:
        body = requests.get(nxt, timeout=60).json()
        rows.extend(body.get("data") or [])
        nxt = (body.get("paging") or {}).get("next")
    return {"http": page.get("http"), "body": {"data": rows}}


def build_queries(act: str, ad_ids: List[str], igm_ids: List[str], video_id: Optional[str],
                  image_hashes: List[str]) -> Dict[str, Callable[[Graph], Dict[str, Any]]]:
    until = date.today() - timedelta(days=1)
    since = until - timedelta(days=2)
    tr = json.dumps({"since": since.isoformat(), "until": until.isoformat()})
    filt = lambda ids: json.dumps([{"field": "id", "operator": "IN", "value": ids}])  # noqa: E731
    q: Dict[str, Callable[[Graph], Dict[str, Any]]] = {
        "me": lambda g: g.get("me", fields="id,name"),
        "me_permissions": lambda g: g.get("me/permissions"),
        "me_adaccounts": lambda g: g.get("me/adaccounts", fields="name,id,account_status,currency,user_tasks,instagram_accounts{username,id}", limit=200),
        "me_accounts_pages": lambda g: g.get("me/accounts", fields="id,name", limit=200),
        "insights_async_3d": lambda g: run_async_insights(g, act, since.isoformat(), until.isoformat()),
        "insights_attribution_adset": lambda g: g.get(f"{act}/insights", fields="adset_id,attribution_setting", level="adset", time_range=tr, limit=500),
        "campaigns_budget_status": lambda g: g.get(f"{act}/campaigns", fields=AdsEnricher._PARENT_EDGE_FIELDS["campaigns"], limit=200),
        "adsets_budget_status": lambda g: g.get(f"{act}/adsets", fields=AdsEnricher._PARENT_EDGE_FIELDS["adsets"], limit=200),
    }
    if ad_ids:
        q["ads_enrichment"] = lambda g: g.get(f"{act}/ads", fields=AdsEnricher._DETAILS_FIELDS, filtering=filt(ad_ids), limit=100)
        q["ads_effective_status"] = lambda g: g.get(f"{act}/ads", fields="id,effective_status", filtering=filt(ad_ids), limit=100)
    if igm_ids:
        # Chamada que a Meta listou para remoção (GET /?ids= na raiz) — fetch_ig_media_types.
        q["igm_root_ids"] = lambda g: g.get("", ids=",".join(igm_ids), fields="id,media_type,children{media_type}")
        q["igm_single"] = lambda g: g.get(igm_ids[0], fields="id,media_type,media_url,children{media_type}")
    if video_id:
        q["video_source"] = lambda g: g.get(video_id, fields="source,from,status")
    if image_hashes:
        q["adimages"] = lambda g: g.get(f"{act}/adimages", hashes=json.dumps(image_hashes), fields="hash,permalink_url,url,original_width,original_height")
    return q


def pick_samples(g: Graph, act: str) -> Dict[str, Any]:
    """Amostra de ids reais da conta (lidos na versão antiga)."""
    ads = (g.get(f"{act}/ads", fields="id,creative{video_id,image_hash,effective_instagram_media_id,asset_feed_spec{images}}", limit=300).get("body") or {}).get("data") or []
    ad_ids = [a["id"] for a in ads][:25]
    creatives = [a.get("creative") or {} for a in ads]
    igm = [c["effective_instagram_media_id"] for c in creatives if c.get("effective_instagram_media_id")][:10]
    video = next((c["video_id"] for c in creatives if c.get("video_id")), None)
    # Imagem também vive no asset_feed_spec (criativo dinâmico), não só em image_hash.
    hashes = sorted({h for c in creatives for h in [c.get("image_hash")] + [i.get("hash") for i in ((c.get("asset_feed_spec") or {}).get("images") or [])] if h})[:5]
    return {"ad_ids": ad_ids, "igm_ids": igm, "video_id": video, "image_hashes": hashes}


def compare(old: Dict[str, Any], new: Dict[str, Any]) -> List[str]:
    notes: List[str] = []
    if old["http"] != new["http"]:
        notes.append(f"HTTP {old['http']} → {new['http']}")
    if bool(old["error"]) != bool(new["error"]) or (old["error"] and old["error"] != new["error"]):
        notes.append(f"erro {old['error']} → {new['error']}")
    if old["rows"] != new["rows"]:
        notes.append(f"linhas {old['rows']} → {new['rows']}")
    gone = sorted(set(old["keys"]) - set(new["keys"]))
    added = sorted(set(new["keys"]) - set(old["keys"]))
    if gone:
        notes.append(f"campos sumiram: {gone[:15]}")
    if added:
        notes.append(f"campos novos: {added[:15]}")
    for k in sorted(set(old["totals"]) & set(new["totals"])):
        a, b = old["totals"][k], new["totals"][k]
        if abs(a - b) > max(0.01, abs(a) * 0.001):
            notes.append(f"total {k}: {a} → {b}")
    return notes


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--email", required=True)
    ap.add_argument("--account")
    ap.add_argument("--old", default="v24.0")
    ap.add_argument("--new", default="v26.0")
    ap.add_argument("--out")
    args = ap.parse_args()

    _, token = user_token(args.email)
    old_g, new_g = Graph(args.old, token), Graph(args.new, token)
    act = args.account
    if not act:
        accounts = (old_g.get("me/adaccounts", fields="id,account_status", limit=200).get("body") or {}).get("data") or []
        act = next((a["id"] for a in accounts if a.get("account_status") == 1), accounts[0]["id"] if accounts else None)
    if not act:
        raise SystemExit("nenhuma conta de anúncios")
    samples = pick_samples(old_g, act)
    print(f"conta {act} · amostra: {len(samples['ad_ids'])} anúncios, {len(samples['igm_ids'])} mídias IG, "
          f"vídeo={'sim' if samples['video_id'] else 'não'}, {len(samples['image_hashes'])} imagens\n")

    report: Dict[str, Any] = {"account": act, "old": args.old, "new": args.new, "results": {}}
    for name, fn in build_queries(act, **samples).items():
        old_s, new_s = summarize(fn(old_g)), summarize(fn(new_g))
        notes = compare(old_s, new_s)
        report["results"][name] = {"old": old_s, "new": new_s, "diff": notes}
        flag = "OK  " if not notes else "DIFF"
        err = " · ERRO na nova" if new_s["error"] else ""
        print(f"[{flag}] {name}: {old_s['rows']}→{new_s['rows']} linhas{err}")
        for n in notes:
            print(f"        - {n}")

    if args.out:
        Path(args.out).write_text(json.dumps(scrub(report), ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\nrelatório: {args.out}")


if __name__ == "__main__":
    main()
