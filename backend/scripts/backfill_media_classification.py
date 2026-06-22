"""Backfill de midia para ads legados do Igor: media_type + creative JSONB + primary_video_id.

Candidatos (SELECT, sem UPDATE):
  - media_type = 'unknown'
  - media_type = 'video' sem primary_video_id E sem effective_instagram_media_id no creative
  - media_type = 'image' sem image_hash/image_url/igm no creative

Fluxo:
  1. SELECT candidatos
  2. Fetch fresh por AD_ID (batch GET /?ids=&fields=creative{...}) — NUNCA usar o
     creative.id do DB, que pode ter sido herdado de homonimo errado (merge por nome)
  3. Batch GET igm -> media_type oficial (VIDEO/IMAGE)
  4. Calcular correcoes: media_type + merge do creative JSONB (preserva chaves
     hidratadas existentes) + primary_video_id (de video_id/asset_feed quando video)
  5. --dry-run (default): relatorio sem gravar
  6. --apply: SELECT de verificacao + UPDATE por ad

Usage:
  py scripts/backfill_media_classification.py            # dry-run (default)
  py scripts/backfill_media_classification.py --apply

Restrictions:
  - Somente user Igor (prefixo c08d94e8)
  - SELECT antes de qualquer UPDATE (padrao do projeto)
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from collections import Counter
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

AD_FIELDS = (
    "id,creative{id,object_type,effective_instagram_media_id,video_id,"
    "image_url,image_hash,asset_feed_spec,object_story_spec}"
)


def gget(params: Dict[str, Any], label: str) -> Tuple[Optional[Dict], Optional[Dict]]:
    try:
        resp = requests.get(GRAPH + "/", params=params, timeout=TIMEOUT)
        data = resp.json()
        if "error" in data:
            e = data["error"]
            print(f"  [ERR] {label}: code={e.get('code')} {str(e.get('message',''))[:80]}")
            return None, e
        return data, None
    except Exception as exc:
        print(f"  [EXC] {label}: {exc}")
        return None, {"exception": str(exc)}


def batch_ids_get(ids: List[str], fields: str, token: str, label: str) -> Dict[str, Dict]:
    """Batch GET /?ids= com split-on-error (um id ruim falha o lote inteiro)."""
    result: Dict[str, Dict] = {}

    def _chunk(chunk: List[str], depth: int = 0) -> None:
        if not chunk:
            return
        data, err = gget({"ids": ",".join(chunk), "fields": fields, "access_token": token}, f"{label} ({len(chunk)})")
        if data:
            for key, payload in data.items():
                if isinstance(payload, dict) and "error" not in payload:
                    result[key] = payload
        elif err and len(chunk) > 1 and depth < 4:
            mid = len(chunk) // 2
            _chunk(chunk[:mid], depth + 1)
            _chunk(chunk[mid:], depth + 1)

    for i in range(0, len(ids), BATCH):
        _chunk(ids[i:i + BATCH])
        time.sleep(0.3)
    return result


def fetch_all(sb: Any, uid: str, filters: List[Tuple[str, str, str]]) -> List[Dict]:
    out: List[Dict] = []
    offset = 0
    while True:
        q = (
            sb.table("ads")
            .select("ad_id,ad_name,media_type,primary_video_id,creative")
            .eq("user_id", uid)
        )
        for col, op, val in filters:
            q = q.filter(col, op, val)
        page = q.range(offset, offset + 999).execute().data or []
        out.extend(page)
        if len(page) < 1000:
            break
        offset += 1000
    return out


def creative_of(row: Dict) -> Dict:
    c = row.get("creative") or {}
    if isinstance(c, str):
        try:
            c = json.loads(c)
        except Exception:
            c = {}
    return c if isinstance(c, dict) else {}


def afs_subset(asset_feed_spec: Any) -> Dict[str, Any]:
    """Subset enxuto do asset_feed_spec (mesmo shape que o enricher injeta)."""
    subset: Dict[str, Any] = {}
    if not isinstance(asset_feed_spec, dict):
        return subset
    videos = asset_feed_spec.get("videos")
    if isinstance(videos, list):
        vids = [
            {"video_id": v.get("video_id"), "thumbnail_url": v.get("thumbnail_url")}
            for v in videos if isinstance(v, dict) and v.get("video_id")
        ]
        if vids:
            subset["videos"] = vids
    images = asset_feed_spec.get("images")
    if isinstance(images, list):
        imgs = [
            {"hash": img.get("hash"), "url": img.get("url")}
            for img in images if isinstance(img, dict) and (img.get("hash") or img.get("url"))
        ]
        if imgs:
            subset["images"] = imgs
    return subset


def main(apply: bool) -> None:
    sb = get_supabase_service()
    conns = sb.table("facebook_connections").select("user_id,access_token").execute().data or []
    conn = next((c for c in conns if str(c["user_id"]).startswith(USER_PREFIX)), None)
    if not conn:
        raise SystemExit("[FATAL] usuario Igor nao encontrado")
    uid = conn["user_id"]
    token = decrypt_token(conn["access_token"])
    print(f"Usuario: {uid[:8]}...")

    # ------------------------------------------------------------------
    # 1. SELECT candidatos
    # ------------------------------------------------------------------
    print("\n[1] Buscando candidatos...")
    unknowns = fetch_all(sb, uid, [("media_type", "eq", "unknown")])
    print(f"  unknown: {len(unknowns)}")

    all_videos_no_pvid = fetch_all(sb, uid, [("media_type", "eq", "video"), ("primary_video_id", "is", "null")])
    videos_no_source = [
        r for r in all_videos_no_pvid
        if not str(creative_of(r).get("effective_instagram_media_id") or "").strip()
    ]
    print(f"  video sem primary_video_id e sem igm: {len(videos_no_source)}")

    all_images = fetch_all(sb, uid, [("media_type", "eq", "image")])
    images_no_source = [
        r for r in all_images
        if not str(creative_of(r).get("image_hash") or "").strip()
        and not str(creative_of(r).get("image_url") or "").strip()
        and not str(creative_of(r).get("effective_instagram_media_id") or "").strip()
    ]
    print(f"  image sem hash/url/igm: {len(images_no_source)}")

    candidates = unknowns + videos_no_source + images_no_source
    by_ad_id = {r["ad_id"]: r for r in candidates}
    print(f"\n  Total candidatos: {len(by_ad_id)}")
    if not by_ad_id:
        print("Nada a corrigir.")
        return

    # ------------------------------------------------------------------
    # 2. Fetch fresh por AD_ID (nao usar creative.id do DB — homonimos)
    # ------------------------------------------------------------------
    print("\n[2] Buscando creatives frescos por ad_id...")
    ad_results = batch_ids_get(list(by_ad_id.keys()), AD_FIELDS, token, "ads")
    print(f"  {len(ad_results)}/{len(by_ad_id)} ads respondidos (ausentes: deletados/sem acesso)")

    fresh_creatives: Dict[str, Dict] = {}
    for ad_id, payload in ad_results.items():
        cr = payload.get("creative")
        if isinstance(cr, dict):
            fresh_creatives[ad_id] = cr

    # ------------------------------------------------------------------
    # 3. Batch igm -> media_type oficial
    # ------------------------------------------------------------------
    print("\n[3] Buscando ig_media_types...")
    igm_ids = list({
        str(cr.get("effective_instagram_media_id") or "")
        for cr in fresh_creatives.values()
        if cr.get("effective_instagram_media_id")
    })
    print(f"  {len(igm_ids)} igm ids distintos")
    igm_raw = batch_ids_get(igm_ids, "id,media_type,children{media_type}", token, "igm") if igm_ids else {}
    igm_types: Dict[str, str] = {}
    for igm_id, payload in igm_raw.items():
        raw = str(payload.get("media_type") or "").upper()
        if raw == "VIDEO":
            igm_types[igm_id] = "video"
        elif raw == "IMAGE":
            igm_types[igm_id] = "image"
        elif raw == "CAROUSEL_ALBUM":
            children = (payload.get("children") or {}).get("data") or []
            child_type = str((children[0] if children else {}).get("media_type") or "").upper()
            if child_type == "VIDEO":
                igm_types[igm_id] = "video"
            elif child_type == "IMAGE":
                igm_types[igm_id] = "image"
    print(f"  {len(igm_types)} tipos resolvidos")

    # ------------------------------------------------------------------
    # 4. Calcular correcoes (media_type + creative merge + primary_video_id)
    # ------------------------------------------------------------------
    print("\n[4] Calculando correcoes...")
    corrections: List[Dict[str, Any]] = []
    no_fresh = 0

    for ad_id, row in by_ad_id.items():
        fresh = fresh_creatives.get(ad_id)
        if not fresh:
            no_fresh += 1
            continue

        db_type = row.get("media_type")
        existing_creative = creative_of(row)

        igm = str(fresh.get("effective_instagram_media_id") or "").strip()
        subset = afs_subset(fresh.get("asset_feed_spec"))

        # media_type: igm oficial > asset_feed > campos nativos > mantem
        new_type: Optional[str] = igm_types.get(igm) if igm else None
        if not new_type:
            if subset.get("videos") or fresh.get("video_id"):
                new_type = "video"
            elif subset.get("images") or fresh.get("image_hash") or fresh.get("image_url"):
                new_type = "image"

        final_type = new_type or db_type

        # primary_video_id: so quando o tipo final e video e o DB nao tem
        new_pvid: Optional[str] = None
        if final_type == "video" and not str(row.get("primary_video_id") or "").strip():
            new_pvid = str(fresh.get("video_id") or "").strip() or None
            if not new_pvid and subset.get("videos"):
                new_pvid = str(subset["videos"][0].get("video_id") or "").strip() or None

        # creative merge: campos frescos de midia entram; chaves existentes preservadas
        merged_creative = dict(existing_creative)
        for key in ("effective_instagram_media_id", "video_id", "image_url", "image_hash", "object_type", "id"):
            value = fresh.get(key)
            if value and not merged_creative.get(key):
                merged_creative[key] = value
        if subset and not merged_creative.get("asset_feed_spec"):
            merged_creative["asset_feed_spec"] = subset

        type_changed = bool(new_type and new_type != db_type)
        creative_changed = merged_creative != existing_creative
        if not (type_changed or creative_changed or new_pvid):
            continue

        corrections.append({
            "ad_id": ad_id,
            "ad_name": str(row.get("ad_name") or "")[:50],
            "db_type": db_type,
            "new_type": new_type if type_changed else None,
            "new_pvid": new_pvid,
            "merged_creative": merged_creative if creative_changed else None,
            "igm": igm or None,
        })

    print(f"  {len(corrections)} ads com alteracao ({no_fresh} sem creative fresco)")
    if not corrections:
        print("Nenhuma correcao necessaria.")
        return

    # ------------------------------------------------------------------
    # Relatorio
    # ------------------------------------------------------------------
    transitions = Counter(
        f"{c['db_type']} -> {c['new_type']}" for c in corrections if c["new_type"]
    )
    creative_only = sum(1 for c in corrections if not c["new_type"])
    pvid_gained = sum(1 for c in corrections if c["new_pvid"])
    igm_gained = sum(1 for c in corrections if c["merged_creative"] and c["igm"])

    print("\n  Transicoes de media_type:")
    for key, count in sorted(transitions.items()):
        print(f"    {key}: {count}")
    print(f"  Somente creative enriquecido (tipo mantido): {creative_only}")
    print(f"  primary_video_id ganho: {pvid_gained}")
    print(f"  igm gravado no creative: {igm_gained}")

    print("\n  Primeiros 20:")
    for c in corrections[:20]:
        marker = f"{c['db_type']} -> {c['new_type']}" if c["new_type"] else f"{c['db_type']} (creative)"
        print(f"    {c['ad_id']} [{marker}] pvid={c['new_pvid'] or '-'} igm={'sim' if c['igm'] else '-'} {c['ad_name']}")

    out = backend_dir / "scripts" / "debug_output" / "backfill_media_report.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(corrections, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
    print(f"\n  Relatorio completo: {out}")

    if not apply:
        print("\n[DRY-RUN] Nenhuma alteracao gravada. Use --apply para aplicar.")
        return

    # ------------------------------------------------------------------
    # 5. SELECT de verificacao antes do UPDATE (padrao do projeto)
    # ------------------------------------------------------------------
    print("\n[5] SELECT de verificacao...")
    ad_ids_to_update = [c["ad_id"] for c in corrections]
    verify_map: Dict[str, str] = {}
    for i in range(0, len(ad_ids_to_update), 200):
        chunk = ad_ids_to_update[i:i + 200]
        rows = (
            sb.table("ads")
            .select("ad_id,media_type")
            .eq("user_id", uid)
            .in_("ad_id", chunk)
            .execute()
            .data or []
        )
        verify_map.update({r["ad_id"]: r["media_type"] for r in rows})
    print(f"  {len(verify_map)}/{len(ad_ids_to_update)} ads verificados no DB")

    # ------------------------------------------------------------------
    # 6. UPDATE por ad (payload distinto por linha — creative JSONB)
    # ------------------------------------------------------------------
    print("\n[6] Aplicando UPDATEs...")
    updated = 0
    skipped = 0
    for idx, c in enumerate(corrections):
        current = verify_map.get(c["ad_id"])
        if current != c["db_type"]:
            print(f"  [SKIP] {c['ad_id']} estado mudou desde o SELECT: {c['db_type']} -> {current}")
            skipped += 1
            continue

        payload: Dict[str, Any] = {}
        if c["new_type"]:
            payload["media_type"] = c["new_type"]
        if c["new_pvid"]:
            payload["primary_video_id"] = c["new_pvid"]
        if c["merged_creative"] is not None:
            payload["creative"] = c["merged_creative"]
        if not payload:
            continue

        sb.table("ads").update(payload).eq("user_id", uid).eq("ad_id", c["ad_id"]).execute()
        updated += 1
        if (idx + 1) % 50 == 0:
            print(f"  ... {idx + 1}/{len(corrections)}")
            time.sleep(0.2)

    print(f"\n[DONE] {updated} atualizados, {skipped} pulados (estado mudou).")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Backfill de midia (media_type + creative + primary_video_id) para ads do Igor")
    parser.add_argument("--apply", action="store_true", default=False, help="Aplicar UPDATE no banco (default: dry-run)")
    args = parser.parse_args()
    main(apply=args.apply)
