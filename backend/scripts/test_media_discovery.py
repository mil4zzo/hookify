"""Exploracao: descobrir o caminho definitivo para obter a midia de QUALQUER ad.

Estrategia:
1. Amostrar ads do DB em 4 buckets (SHARE/video+id, SHARE/video sem id,
   SHARE/image, VIDEO) do usuario autenticado (Igor).
2. Introspeccao oficial: GET /{creative_id}?metadata=1 lista TODOS os campos
   disponiveis no node AdCreative (sem chutar nomes de campos).
3. Buscar o creative completo (kitchen-sink validado pela introspeccao).
4. Probar caminhos derivados de midia:
   - video_id -> GET /{vid}?fields=source (page token)
   - effective_instagram_media_id -> GET /{igm}?fields=media_type,media_url
   - image_hash -> GET /act_{acc}/adimages?hashes=[...]
   - thumbnail_url com thumbnail_width/height grandes

100% read-only. Saida ASCII (console cp1252).

Usage: py scripts/test_media_discovery.py
"""
from __future__ import annotations

import json
import sys
import time
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
TIMEOUT = 20
USER_PREFIX = "c08d94e8"

report: Dict[str, Any] = {"meta": {"ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}, "sections": {}}


def gget(path: str, params: Dict[str, Any], label: str) -> Tuple[Optional[Dict], Optional[Dict]]:
    """Returns (data, error). Prints errors compactly."""
    try:
        resp = requests.get(f"{GRAPH}/{path.lstrip('/')}", params=params, timeout=TIMEOUT)
        data = resp.json()
        if "error" in data:
            e = data["error"]
            print(f"    [ERR] {label}: code={e.get('code')} sub={e.get('error_subcode')} {str(e.get('message',''))[:100]}")
            return None, e
        return data, None
    except Exception as exc:
        print(f"    [EXC] {label}: {exc}")
        return None, {"exception": str(exc)}


def creative_of(ad_row: Dict) -> Dict:
    c = ad_row.get("creative") or {}
    if isinstance(c, str):
        try:
            c = json.loads(c)
        except Exception:
            c = {}
    return c if isinstance(c, dict) else {}


def main() -> None:
    # ------------------------------------------------------------------
    # Credenciais
    # ------------------------------------------------------------------
    print("=" * 70)
    print("ETAPA 0 - Credenciais + amostragem")
    print("=" * 70)
    sb = get_supabase_service()
    conns = sb.table("facebook_connections").select("user_id,access_token,facebook_name").execute().data or []
    conn = next(c for c in conns if str(c["user_id"]).startswith(USER_PREFIX))
    uid = conn["user_id"]
    user_token = decrypt_token(conn["access_token"])

    me, err = gget("me", {"access_token": user_token, "fields": "id,name"}, "/me")
    if not me:
        raise SystemExit("[FATAL] token invalido")
    print(f"  Token OK: {me.get('name')} ({me['id']})")

    # page tokens
    acc, _ = gget("me/accounts", {"access_token": user_token, "fields": "id,name,access_token", "limit": 200}, "/me/accounts")
    page_tokens = {p["id"]: p["access_token"] for p in (acc or {}).get("data", []) if p.get("access_token")}
    print(f"  {len(page_tokens)} page tokens")

    # ------------------------------------------------------------------
    # Amostragem por bucket
    # ------------------------------------------------------------------
    def sample(filters: List[Tuple[str, str, str]], limit: int) -> List[Dict]:
        q = sb.table("ads").select("ad_id,ad_name,account_id,media_type,primary_video_id,creative,instagram_permalink_url").eq("user_id", uid)
        for col, op, val in filters:
            q = q.filter(col, op, val)
        return q.order("created_at", desc=True).limit(limit).execute().data or []

    buckets = {
        "share_video_with_id": sample([("creative->>object_type", "eq", "SHARE"), ("media_type", "eq", "video"), ("primary_video_id", "not.is", "null")], 3),
        "share_video_no_id":   sample([("creative->>object_type", "eq", "SHARE"), ("media_type", "eq", "video"), ("primary_video_id", "is", "null")], 5),
        "share_image":         sample([("creative->>object_type", "eq", "SHARE"), ("media_type", "eq", "image")], 5),
        "native_video":        sample([("creative->>object_type", "eq", "VIDEO")], 2),
    }
    for name, ads in buckets.items():
        print(f"  bucket {name}: {len(ads)} ads")

    # ------------------------------------------------------------------
    # ETAPA 1 - Introspeccao oficial do node AdCreative (?metadata=1)
    # ------------------------------------------------------------------
    print("\n" + "=" * 70)
    print("ETAPA 1 - Introspeccao ?metadata=1 do AdCreative")
    print("=" * 70)
    probe_ad = (buckets["share_video_no_id"] or buckets["share_image"])[0]
    cr_id = creative_of(probe_ad).get("id")
    print(f"  probe ad={probe_ad['ad_id']} creative={cr_id}")

    meta_data, _ = gget(str(cr_id), {"access_token": user_token, "metadata": "1", "fields": "id"}, "creative metadata")
    available_fields: List[str] = []
    if meta_data:
        available_fields = sorted(f["name"] for f in (meta_data.get("metadata", {}).get("fields") or []))
        print(f"  {len(available_fields)} campos disponiveis no AdCreative:")
        for i in range(0, len(available_fields), 6):
            print("    " + ", ".join(available_fields[i:i+6]))
    report["sections"]["adcreative_available_fields"] = available_fields

    # ------------------------------------------------------------------
    # ETAPA 2 - Creative kitchen-sink por bucket
    # ------------------------------------------------------------------
    print("\n" + "=" * 70)
    print("ETAPA 2 - Creative completo por bucket")
    print("=" * 70)

    # campos de interesse, filtrados pela lista oficial da introspeccao
    wanted = [
        "id", "name", "object_type", "actor_id", "status",
        "object_story_id", "effective_object_story_id",
        "video_id", "image_url", "image_hash", "thumbnail_url", "thumbnail_id",
        "instagram_permalink_url", "effective_instagram_media_id",
        "instagram_user_id", "source_instagram_media_id",
        "asset_feed_spec", "object_story_spec", "object_id", "object_url",
        "link_url", "link_og_id", "product_set_id", "template_url",
    ]
    if available_fields:
        fields_to_request = [f for f in wanted if f in available_fields]
        skipped = [f for f in wanted if f not in available_fields]
        if skipped:
            print(f"  (campos inexistentes pulados: {', '.join(skipped)})")
    else:
        fields_to_request = wanted
    fields_str = ",".join(fields_to_request)

    kitchen: Dict[str, List[Dict]] = {}
    for bucket_name, ads in buckets.items():
        print(f"\n  --- bucket: {bucket_name} ---")
        kitchen[bucket_name] = []
        for ad in ads:
            cr = creative_of(ad)
            crid = cr.get("id")
            if not crid:
                print(f"    ad {ad['ad_id']}: sem creative.id no DB - SKIP")
                continue
            full, err = gget(str(crid), {"access_token": user_token, "fields": fields_str}, f"creative {crid}")
            if not full:
                continue
            present = {k: v for k, v in full.items() if v not in (None, "", [], {})}
            media_keys = [k for k in ("video_id", "image_url", "image_hash", "effective_instagram_media_id",
                                      "source_instagram_media_id", "asset_feed_spec", "object_story_spec",
                                      "object_id", "link_og_id") if k in present]
            print(f"    ad {ad['ad_id']} ({str(ad.get('ad_name',''))[:40]})")
            print(f"      campos com valor: {sorted(present.keys())}")
            print(f"      campos de midia : {media_keys or 'NENHUM'}")
            kitchen[bucket_name].append({"ad_id": ad["ad_id"], "ad_name": ad.get("ad_name"),
                                         "db_primary_video_id": ad.get("primary_video_id"),
                                         "db_media_type": ad.get("media_type"),
                                         "full_creative": full})
    report["sections"]["kitchen_sink"] = kitchen

    # ------------------------------------------------------------------
    # ETAPA 3 - Probar caminhos derivados de midia
    # ------------------------------------------------------------------
    print("\n" + "=" * 70)
    print("ETAPA 3 - Caminhos derivados")
    print("=" * 70)
    derived: List[Dict] = []

    for bucket_name, items in kitchen.items():
        for item in items:
            fc = item["full_creative"]
            ad_id = item["ad_id"]
            actor = str(fc.get("actor_id") or "")
            ptok = page_tokens.get(actor)
            probes: Dict[str, Any] = {"ad_id": ad_id, "bucket": bucket_name}

            # 3a. effective_instagram_media_id -> IG Media
            igm = fc.get("effective_instagram_media_id") or fc.get("source_instagram_media_id")
            if igm:
                for tok_label, tok in (("user_token", user_token), ("page_token", ptok)):
                    if not tok:
                        continue
                    ig_data, ig_err = gget(str(igm), {"access_token": tok, "fields": "id,media_type,media_url,thumbnail_url,permalink"}, f"igmedia/{igm}/{tok_label}")
                    probes[f"ig_media_{tok_label}"] = ig_data or {"error": ig_err}
                    if ig_data:
                        print(f"  [IG-MEDIA OK] ad={ad_id} via {tok_label}: media_type={ig_data.get('media_type')} media_url={'SIM' if ig_data.get('media_url') else 'nao'}")
                        break

            # 3b. video_id -> source
            vid = fc.get("video_id") or item.get("db_primary_video_id")
            if vid:
                for tok_label, tok in (("page_token", ptok), ("user_token", user_token)):
                    if not tok:
                        continue
                    v_data, v_err = gget(str(vid), {"access_token": tok, "fields": "id,source,picture"}, f"video/{vid}/{tok_label}")
                    probes[f"video_source_{tok_label}"] = {"ok": bool(v_data and v_data.get("source")), "error": v_err}
                    if v_data and v_data.get("source"):
                        print(f"  [VIDEO-SRC OK] ad={ad_id} video={vid} via {tok_label}")
                        break

            # 3c. image_hash -> adimages
            ih = fc.get("image_hash")
            acct = item.get("account_id") or ""
            if ih:
                # account_id vem do DB sem prefixo act_
                db_ad = next((a for ads in buckets.values() for a in ads if a["ad_id"] == ad_id), {})
                acct = str(db_ad.get("account_id") or "")
                if acct:
                    act_path = acct if acct.startswith("act_") else f"act_{acct}"
                    img_data, img_err = gget(f"{act_path}/adimages", {"access_token": user_token, "hashes": json.dumps([ih]), "fields": "url,permalink_url,width,height"}, f"adimages/{ih[:12]}")
                    probes["adimage"] = img_data or {"error": img_err}
                    if img_data and img_data.get("data"):
                        print(f"  [ADIMAGE OK] ad={ad_id} hash={ih[:12]}... url={'SIM' if img_data['data'][0].get('url') else 'nao'}")

            # 3d. thumbnail em alta resolucao (documentado: thumbnail_width/height)
            crid = fc.get("id")
            if crid:
                th_data, th_err = gget(str(crid), {"access_token": user_token, "fields": "thumbnail_url", "thumbnail_width": 1080, "thumbnail_height": 1080}, f"thumb1080/{crid}")
                if th_data and th_data.get("thumbnail_url"):
                    probes["thumbnail_1080"] = th_data["thumbnail_url"]

            derived.append(probes)

    report["sections"]["derived_probes"] = derived

    # ------------------------------------------------------------------
    # Salvar relatorio
    # ------------------------------------------------------------------
    out = backend_dir / "scripts" / "debug_output" / "media_discovery_report.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
    print(f"\nRelatorio salvo: {out}")


if __name__ == "__main__":
    main()
