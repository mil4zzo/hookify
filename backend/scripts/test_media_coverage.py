"""Varredura de cobertura: effective_instagram_media_id existe em TODOS os ads?

1. Amostra estratificada por tempo (antigos/meio/novos) dos 3 buckets SHARE
   problematicos + nativos, ~360 ads.
2. Batch GET /?ids=cr1..cr50&fields=effective_instagram_media_id,video_id,
   image_url,image_hash,object_type -> estatistica de cobertura.
3. Para os IG media ids achados: batch GET ?fields=media_type ->
   auditoria media_type oficial vs media_type do DB (precisao da heuristica).

100% read-only. Usage: py scripts/test_media_coverage.py
"""
from __future__ import annotations

import json
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

from dotenv import load_dotenv
load_dotenv(backend_dir / ".env")

import requests
from app.core.config import META_GRAPH_BASE_URL
from app.core.supabase_client import get_supabase_service
from app.services.token_encryption import decrypt_token

GRAPH = META_GRAPH_BASE_URL.rstrip("/")
TIMEOUT = 30
USER_PREFIX = "c08d94e8"
BATCH = 50

report: Dict[str, Any] = {"meta": {"ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}}


def gget(path: str, params: Dict[str, Any], label: str) -> Tuple[Optional[Dict], Optional[Dict]]:
    try:
        resp = requests.get(f"{GRAPH}/{path.lstrip('/')}" if path else GRAPH, params=params, timeout=TIMEOUT)
        data = resp.json()
        if "error" in data:
            e = data["error"]
            print(f"  [ERR] {label}: code={e.get('code')} sub={e.get('error_subcode')} {str(e.get('message',''))[:90]}")
            return None, e
        return data, None
    except Exception as exc:
        print(f"  [EXC] {label}: {exc}")
        return None, {"exception": str(exc)}


def creative_of(row: Dict) -> Dict:
    c = row.get("creative") or {}
    if isinstance(c, str):
        try:
            c = json.loads(c)
        except Exception:
            c = {}
    return c if isinstance(c, dict) else {}


def stratified(rows: List[Dict], n: int) -> List[Dict]:
    """Pega n itens espalhados uniformemente pela lista (ordenada por created_at)."""
    if len(rows) <= n:
        return rows
    step = len(rows) / n
    return [rows[int(i * step)] for i in range(n)]


def main() -> None:
    sb = get_supabase_service()
    conns = sb.table("facebook_connections").select("user_id,access_token").execute().data or []
    conn = next(c for c in conns if str(c["user_id"]).startswith(USER_PREFIX))
    uid = conn["user_id"]
    token = decrypt_token(conn["access_token"])

    me, _ = gget("me", {"access_token": token, "fields": "id,name"}, "/me")
    if not me:
        raise SystemExit("[FATAL] token invalido")
    print(f"Token OK: {me.get('name')}")

    # ------------------------------------------------------------------
    # Amostragem estratificada por bucket
    # ------------------------------------------------------------------
    def fetch_bucket(filters: List[Tuple[str, str, str]]) -> List[Dict]:
        out: List[Dict] = []
        offset = 0
        while True:
            q = sb.table("ads").select("ad_id,ad_name,media_type,primary_video_id,creative,created_at").eq("user_id", uid)
            for col, op, val in filters:
                q = q.filter(col, op, val)
            page = q.order("created_at", desc=False).range(offset, offset + 999).execute().data or []
            out.extend(page)
            if len(page) < 1000:
                break
            offset += 1000
        return out

    buckets_def = {
        "share_image":        [("creative->>object_type", "eq", "SHARE"), ("media_type", "eq", "image")],
        "share_video_with_id": [("creative->>object_type", "eq", "SHARE"), ("media_type", "eq", "video"), ("primary_video_id", "not.is", "null")],
        "share_video_no_id":  [("creative->>object_type", "eq", "SHARE"), ("media_type", "eq", "video"), ("primary_video_id", "is", "null")],
    }
    SAMPLE_PER_BUCKET = 120

    samples: Dict[str, List[Dict]] = {}
    for name, filt in buckets_def.items():
        all_rows = fetch_bucket(filt)
        samples[name] = stratified(all_rows, SAMPLE_PER_BUCKET)
        print(f"bucket {name}: {len(all_rows)} total -> {len(samples[name])} amostrados (estratificado por created_at)")

    # ------------------------------------------------------------------
    # ETAPA 1 - Batch creatives: cobertura de campos de midia
    # ------------------------------------------------------------------
    print("\n" + "=" * 70)
    print("ETAPA 1 - Cobertura de campos no creative (batch ?ids=)")
    print("=" * 70)

    # creative_id -> [(bucket, ad_row)]
    cr_index: Dict[str, List[Tuple[str, Dict]]] = defaultdict(list)
    for bucket, rows in samples.items():
        for row in rows:
            crid = str(creative_of(row).get("id") or "")
            if crid:
                cr_index[crid].append((bucket, row))

    cr_ids = list(cr_index.keys())
    print(f"{len(cr_ids)} creatives distintos a consultar")

    CR_FIELDS = "id,object_type,effective_instagram_media_id,video_id,image_url,image_hash,instagram_permalink_url,actor_id"
    cr_results: Dict[str, Dict] = {}
    cr_errors: List[Dict] = []
    for i in range(0, len(cr_ids), BATCH):
        chunk = cr_ids[i:i + BATCH]
        data, err = gget("", {"ids": ",".join(chunk), "fields": CR_FIELDS, "access_token": token}, f"batch creatives {i}")
        if data:
            for crid, payload in data.items():
                if isinstance(payload, dict) and "error" not in payload:
                    cr_results[crid] = payload
                else:
                    cr_errors.append({"creative_id": crid, "payload": payload})
        elif err:
            cr_errors.append({"chunk_start": i, "error": err})
        time.sleep(0.3)

    print(f"creatives respondidos: {len(cr_results)}/{len(cr_ids)}  (erros: {len(cr_errors)})")

    # estatistica de cobertura por bucket
    cov = defaultdict(Counter)
    igm_by_bucket: Dict[str, List[Tuple[str, str, Dict]]] = defaultdict(list)  # (igm_id, crid, ad_row)
    for crid, payload in cr_results.items():
        igm = payload.get("effective_instagram_media_id")
        has = {
            "igm": bool(igm),
            "video_id": bool(payload.get("video_id")),
            "image": bool(payload.get("image_url") or payload.get("image_hash")),
        }
        for bucket, ad_row in cr_index[crid]:
            cov[bucket]["total"] += 1
            for k, v in has.items():
                if v:
                    cov[bucket][k] += 1
            if not any(has.values()):
                cov[bucket]["NENHUM"] += 1
            if igm:
                igm_by_bucket[bucket].append((str(igm), crid, ad_row))

    print(f"\n{'bucket':<22} {'total':<7} {'igm':<6} {'video_id':<9} {'image':<7} {'NENHUM'}")
    for bucket, c in cov.items():
        print(f"{bucket:<22} {c['total']:<7} {c['igm']:<6} {c['video_id']:<9} {c['image']:<7} {c['NENHUM']}")

    report["coverage"] = {b: dict(c) for b, c in cov.items()}
    report["creative_errors"] = cr_errors[:20]

    # ------------------------------------------------------------------
    # ETAPA 2 - Auditoria: media_type oficial (IG) vs media_type do DB
    # ------------------------------------------------------------------
    print("\n" + "=" * 70)
    print("ETAPA 2 - Auditoria media_type: IG oficial vs DB")
    print("=" * 70)

    # juntar todos os IGM (dedup), max ~360
    igm_map: Dict[str, List[Tuple[str, Dict]]] = defaultdict(list)  # igm -> [(bucket, ad_row)]
    for bucket, triples in igm_by_bucket.items():
        for igm, crid, ad_row in triples:
            igm_map[igm].append((bucket, ad_row))

    igm_ids = list(igm_map.keys())
    print(f"{len(igm_ids)} IG medias distintos a consultar")

    igm_results: Dict[str, Dict] = {}
    igm_errors: List[Dict] = []
    for i in range(0, len(igm_ids), BATCH):
        chunk = igm_ids[i:i + BATCH]
        data, err = gget("", {"ids": ",".join(chunk), "fields": "id,media_type,media_url,permalink", "access_token": token}, f"batch igm {i}")
        if data:
            for igm, payload in data.items():
                if isinstance(payload, dict) and "error" not in payload:
                    igm_results[igm] = payload
                else:
                    igm_errors.append({"igm": igm, "payload": payload})
        elif err:
            igm_errors.append({"chunk_start": i, "error": err})
        time.sleep(0.3)

    print(f"IG medias respondidos: {len(igm_results)}/{len(igm_ids)}  (erros: {len(igm_errors)})")

    # matriz de confusao DB vs IG
    confusion = Counter()
    mismatches: List[Dict] = []
    media_url_count = 0
    for igm, payload in igm_results.items():
        ig_type = str(payload.get("media_type") or "?").upper()
        if payload.get("media_url"):
            media_url_count += 1
        for bucket, ad_row in igm_map[igm]:
            db_type = ad_row.get("media_type")
            confusion[(db_type, ig_type)] += 1
            db_as_ig = {"video": "VIDEO", "image": "IMAGE"}.get(db_type, "?")
            if ig_type not in (db_as_ig, "?") and ig_type != "CAROUSEL_ALBUM":
                mismatches.append({
                    "ad_id": ad_row["ad_id"], "ad_name": ad_row.get("ad_name"),
                    "db": db_type, "ig": ig_type, "bucket": bucket,
                    "permalink": payload.get("permalink"),
                })

    print(f"\nmedia_url presente: {media_url_count}/{len(igm_results)}")
    print(f"\n{'DB':<10} {'IG oficial':<16} count")
    for (db_t, ig_t), n in sorted(confusion.items(), key=lambda x: -x[1]):
        print(f"{db_t:<10} {ig_t:<16} {n}")

    print(f"\nMISMATCHES (DB != IG oficial): {len(mismatches)}")
    for m in mismatches[:15]:
        print(f"  ad={m['ad_id']} [{m['bucket']}] db={m['db']} ig={m['ig']} {str(m['ad_name'])[:40]}")

    report["confusion"] = {f"{k[0]}|{k[1]}": v for k, v in confusion.items()}
    report["mismatches"] = mismatches
    report["igm_errors"] = igm_errors[:20]

    # ------------------------------------------------------------------
    # Salvar
    # ------------------------------------------------------------------
    out = backend_dir / "scripts" / "debug_output" / "media_coverage_report.json"
    out.write_text(json.dumps(report, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
    print(f"\nRelatorio salvo: {out}")


if __name__ == "__main__":
    main()
