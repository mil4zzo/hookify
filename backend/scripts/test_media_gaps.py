"""Investiga os creatives 'NENHUM' (sem effective_instagram_media_id, sem
video_id, sem image_url/hash): o que sao e qual fallback resolve a midia.

Fallbacks testados, em ordem:
1. creative completo (todos os campos de midia + asset_feed_spec)
2. effective_object_story_id -> attachments com PAGE token (post FB genuino?)
3. object_story_spec do creative

100% read-only. Usage: py scripts/test_media_gaps.py
"""
from __future__ import annotations

import json
import sys
import time
from collections import defaultdict
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

ATT_FIELDS = "attachments{media_type,media,target,type,subattachments,url}"


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

    acc, _ = gget("me/accounts", {"access_token": token, "fields": "id,access_token", "limit": 200}, "/me/accounts")
    page_tokens = {p["id"]: p["access_token"] for p in (acc or {}).get("data", []) if p.get("access_token")}
    print(f"{len(page_tokens)} page tokens")

    # mesma amostragem do coverage
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
        "share_image":         [("creative->>object_type", "eq", "SHARE"), ("media_type", "eq", "image")],
        "share_video_with_id": [("creative->>object_type", "eq", "SHARE"), ("media_type", "eq", "video"), ("primary_video_id", "not.is", "null")],
        "share_video_no_id":   [("creative->>object_type", "eq", "SHARE"), ("media_type", "eq", "video"), ("primary_video_id", "is", "null")],
    }
    samples: Dict[str, List[Dict]] = {}
    for name, filt in buckets_def.items():
        samples[name] = stratified(fetch_bucket(filt), 120)

    cr_index: Dict[str, List[Tuple[str, Dict]]] = defaultdict(list)
    for bucket, rows in samples.items():
        for row in rows:
            crid = str(creative_of(row).get("id") or "")
            if crid:
                cr_index[crid].append((bucket, row))

    cr_ids = list(cr_index.keys())
    CR_FIELDS = ("id,object_type,actor_id,effective_instagram_media_id,video_id,"
                 "image_url,image_hash,instagram_permalink_url,effective_object_story_id,"
                 "object_story_id,asset_feed_spec,object_story_spec")
    cr_results: Dict[str, Dict] = {}
    for i in range(0, len(cr_ids), BATCH):
        chunk = cr_ids[i:i + BATCH]
        data, _ = gget("", {"ids": ",".join(chunk), "fields": CR_FIELDS, "access_token": token}, f"batch {i}")
        if data:
            cr_results.update({k: v for k, v in data.items() if isinstance(v, dict)})
        time.sleep(0.3)

    # identificar os NENHUM
    gaps: List[Tuple[str, Dict, str, Dict]] = []  # (crid, creative, bucket, ad_row)
    for crid, payload in cr_results.items():
        has_media = bool(
            payload.get("effective_instagram_media_id")
            or payload.get("video_id")
            or payload.get("image_url")
            or payload.get("image_hash")
        )
        if not has_media:
            for bucket, ad_row in cr_index[crid]:
                gaps.append((crid, payload, bucket, ad_row))

    print(f"\n{len(gaps)} ads NENHUM identificados")
    report: List[Dict] = []

    for crid, cr, bucket, ad_row in gaps:
        print(f"\n--- ad={ad_row['ad_id']} [{bucket}] {str(ad_row.get('ad_name',''))[:50]}")
        print(f"    created_at(db)={ad_row.get('created_at')}")
        afs = cr.get("asset_feed_spec") or {}
        oss = cr.get("object_story_spec") or {}
        story = cr.get("effective_object_story_id") or cr.get("object_story_id")
        actor = str(cr.get("actor_id") or "")
        entry: Dict[str, Any] = {
            "ad_id": ad_row["ad_id"], "bucket": bucket, "creative_id": crid,
            "creative_keys": sorted(k for k, v in cr.items() if v),
            "asset_feed_videos": len(afs.get("videos") or []),
            "asset_feed_images": len(afs.get("images") or []),
            "oss_keys": sorted(oss.keys()) if isinstance(oss, dict) else [],
            "story_id": story, "actor_id": actor,
            "instagram_permalink_url": cr.get("instagram_permalink_url"),
        }
        print(f"    creative keys: {entry['creative_keys']}")
        print(f"    asset_feed: videos={entry['asset_feed_videos']} images={entry['asset_feed_images']}")
        print(f"    oss keys: {entry['oss_keys']}")
        print(f"    ig_permalink: {entry['instagram_permalink_url']}")

        if afs.get("videos"):
            vids = [v.get("video_id") for v in afs["videos"] if isinstance(v, dict)]
            print(f"    [FALLBACK asset_feed] video_ids={vids}")
            entry["fallback_asset_feed_videos"] = vids
        if afs.get("images"):
            imgs = [(im.get("hash"), im.get("url")) for im in afs["images"] if isinstance(im, dict)]
            print(f"    [FALLBACK asset_feed] images={imgs[:3]}")
            entry["fallback_asset_feed_images"] = imgs

        # fallback: story attachments com page token
        if story and actor and page_tokens.get(actor):
            att, err = gget(str(story), {"access_token": page_tokens[actor], "fields": ATT_FIELDS}, f"story/{story}")
            items = ((att or {}).get("attachments") or {}).get("data") or []
            if items:
                it = items[0]
                tgt = (it.get("target") or {}).get("id")
                print(f"    [FALLBACK story+pagetoken] type={it.get('type')} media_type={it.get('media_type')} target={tgt}")
                entry["fallback_story"] = {"type": it.get("type"), "media_type": it.get("media_type"), "target_id": tgt,
                                           "has_image": bool((it.get('media') or {}).get('image')),
                                           "has_source": bool((it.get('media') or {}).get('source'))}
            else:
                print(f"    [FALLBACK story+pagetoken] vazio (err={bool(err)})")
                entry["fallback_story"] = {"empty": True, "error": err}
        else:
            why = "sem story_id" if not story else ("sem page token p/ actor " + actor)
            print(f"    [FALLBACK story] indisponivel: {why}")
            entry["fallback_story"] = {"unavailable": why}

        report.append(entry)

    out = backend_dir / "scripts" / "debug_output" / "media_gaps_report.json"
    out.write_text(json.dumps(report, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
    print(f"\nRelatorio salvo: {out}")


if __name__ == "__main__":
    main()
