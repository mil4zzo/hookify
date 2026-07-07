"""Backfill do bug "shift de midia" (creative herdado do source_ad).

Contexto: ate 2026-07-06 o merge_details do AdsEnricher priorizava
source_ad.creative/adcreatives sobre o creative do proprio ad. Ads duplicados
que TROCARAM a midia depois da duplicacao herdaram a midia do ad de origem
(thumb + video + media_type errados, em cadeia). O enricher foi corrigido
(own-first), mas o DB continua com o creative errado — e o refresh reutiliza
o dado existente, entao nada se auto-corrige.

Este script re-sincroniza a IDENTIDADE de midia de todos os ads de cada usuario
a partir do creative/adcreatives PROPRIOS do ad na Meta (nunca source_ad):

  1. SELECT de todos os ads do usuario (paginado)
  2. Fetch fresh por AD_ID (batch GET /?ids=&fields=creative{...},adcreatives{...})
  3. Batch GET igm -> media_type oficial (apenas ads sem tipo estrutural)
  4. Diff por chaves de identidade (video_id, igm, image_hash, arrays, media_type,
     video_owner_page_id) — URLs assinadas (thumbnail_url) NAO entram no diff
  5. --dry-run (default): relatorio sem gravar
  6. --apply: SELECT de verificacao + UPDATE por ad + re-cache de thumbnails
     dos ad_names com identidade de midia alterada (x-upsert sobrescreve o
     objeto by-adname no Storage; a politica normal nunca substitui cache existente)

Usage:
  py scripts/backfill_source_ad_media_swap.py                        # dry-run, todos usuarios
  py scripts/backfill_source_ad_media_swap.py --user-prefix 8363e117 # um usuario
  py scripts/backfill_source_ad_media_swap.py --apply
  py scripts/backfill_source_ad_media_swap.py --apply --skip-thumbs

Restrictions:
  - SELECT antes de qualquer UPDATE (padrao do projeto)
  - Ads sem resposta da Meta (deletados/sem acesso) sao deixados intactos
  - Ads cujo fetch nao trouxe NENHUM dado proprio sao deixados intactos
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from collections import Counter
from datetime import datetime, timezone
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
from app.services.ad_media import (
    resolve_media_type,
    resolve_primary_video_id,
    resolve_structural_media_type,
)
from app.services import supabase_repo
from app.services.thumbnail_cache import (
    cache_first_thumbs_for_ad_names,
    normalize_ad_name,
    select_representative_thumb_url,
)

GRAPH = META_GRAPH_BASE_URL.rstrip("/")
TIMEOUT = 30
BATCH = 50

# Mesmo field set de creative que o enricher usa (sem source_ad — identidade e propria)
AD_FIELDS = (
    "id,name,"
    "creative{actor_id,body,call_to_action_type,instagram_permalink_url,"
    "object_type,title,video_id,thumbnail_url,"
    "effective_instagram_media_id,image_url,image_hash,effective_object_story_id},"
    "adcreatives{asset_feed_spec,object_story_spec}"
)

ADS_SELECT = (
    "ad_id,ad_name,media_type,primary_video_id,creative_video_id,creative,"
    "adcreatives_videos_ids,video_owner_page_id,thumb_storage_path"
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


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

    total_batches = (len(ids) + BATCH - 1) // BATCH
    for i in range(0, len(ids), BATCH):
        _chunk(ids[i:i + BATCH])
        batch_num = (i // BATCH) + 1
        if batch_num % 20 == 0:
            print(f"  ... lote {batch_num}/{total_batches}")
        time.sleep(0.3)
    return result


def fetch_all_ads(sb: Any, uid: str) -> List[Dict]:
    out: List[Dict] = []
    offset = 0
    while True:
        page = (
            sb.table("ads")
            .select(ADS_SELECT)
            .eq("user_id", uid)
            .order("ad_id")
            .range(offset, offset + 999)
            .execute()
            .data or []
        )
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


def extract_own_media(fresh: Dict) -> Tuple[Optional[Dict], List[Dict], Optional[str]]:
    """(creative proprio, asset_feed videos proprios [com video_id], page_id do OSS)."""
    creative = fresh.get("creative") if isinstance(fresh.get("creative"), dict) else None

    adcreatives = fresh.get("adcreatives") or {}
    data = adcreatives.get("data") if isinstance(adcreatives, dict) else None
    first = (data[0] or {}) if data else {}
    afs = first.get("asset_feed_spec") or {}

    videos = [
        v for v in (afs.get("videos") or [])
        if isinstance(v, dict) and v.get("video_id")
    ] if isinstance(afs, dict) else []

    page_id = str(((first.get("object_story_spec") or {}).get("page_id")) or "").strip() or None
    return creative, videos, page_id


def afs_subset(fresh: Dict) -> Dict[str, Any]:
    """Subset enxuto do asset_feed_spec proprio (mesmo shape que o enricher injeta)."""
    adcreatives = fresh.get("adcreatives") or {}
    data = adcreatives.get("data") if isinstance(adcreatives, dict) else None
    afs = ((data[0] or {}) if data else {}).get("asset_feed_spec") or {}
    subset: Dict[str, Any] = {}
    if not isinstance(afs, dict):
        return subset
    videos = [
        {"video_id": v.get("video_id"), "thumbnail_url": v.get("thumbnail_url")}
        for v in (afs.get("videos") or [])
        if isinstance(v, dict) and v.get("video_id")
    ]
    if videos:
        subset["videos"] = videos
    images = [
        {"hash": img.get("hash"), "url": img.get("url")}
        for img in (afs.get("images") or [])
        if isinstance(img, dict) and (img.get("hash") or img.get("url"))
    ]
    if images:
        subset["images"] = images
    return subset


def resolve_igm_types(igm_ids: List[str], token: str) -> Dict[str, str]:
    if not igm_ids:
        return {}
    raw = batch_ids_get(igm_ids, "id,media_type,children{media_type}", token, "igm")
    types: Dict[str, str] = {}
    for igm_id, payload in raw.items():
        t = str(payload.get("media_type") or "").upper()
        if t == "CAROUSEL_ALBUM":
            children = (payload.get("children") or {}).get("data") or []
            t = str((children[0] if children else {}).get("media_type") or "").upper()
        if t == "VIDEO":
            types[igm_id] = "video"
        elif t == "IMAGE":
            types[igm_id] = "image"
    return types


def process_user(
    sb: Any,
    uid: str,
    token: str,
    *,
    apply: bool,
    skip_thumbs: bool,
) -> Dict[str, Any]:
    print(f"\n{'='*70}\nUsuario {uid[:8]}...")

    rows = fetch_all_ads(sb, uid)
    print(f"  {len(rows)} ads no DB")
    if not rows:
        return {"user": uid, "ads": 0, "changed": 0}

    by_ad_id = {str(r["ad_id"]): r for r in rows}

    print("  Buscando creative/adcreatives PROPRIOS na Meta...")
    fresh_map = batch_ids_get(list(by_ad_id.keys()), AD_FIELDS, token, "ads")
    print(f"  {len(fresh_map)}/{len(by_ad_id)} ads respondidos (ausentes: deletados/sem acesso)")

    # ------------------------------------------------------------------
    # Calcular correcoes
    # ------------------------------------------------------------------
    corrections: List[Dict[str, Any]] = []
    skipped_no_own = 0
    pending_igm: Dict[str, List[Dict[str, Any]]] = {}

    for ad_id, row in by_ad_id.items():
        fresh = fresh_map.get(ad_id)
        if not fresh:
            continue

        own_creative, own_videos, own_page_id = extract_own_media(fresh)
        if not own_creative and not own_videos:
            skipped_no_own += 1
            continue

        creative_new = dict(own_creative or {})
        subset = afs_subset(fresh)
        if subset and not creative_new.get("asset_feed_spec"):
            creative_new["asset_feed_spec"] = subset

        videos_ids = [str(v["video_id"]) for v in own_videos]
        videos_thumbs = [str(v["thumbnail_url"]) for v in own_videos if v.get("thumbnail_url")]

        probe: Dict[str, Any] = {
            "creative": creative_new,
            "adcreatives_videos_ids": videos_ids,
            "adcreatives_videos_thumbs": videos_thumbs,
            "creative_video_id": creative_new.get("video_id"),
            "thumbnail_url": creative_new.get("thumbnail_url"),
            # preserva classificacao definitiva quando nao ha evidencia nova
            "media_type": row.get("media_type"),
        }
        pvid = resolve_primary_video_id(probe)

        correction = {
            "ad_id": ad_id,
            "ad_name": str(row.get("ad_name") or ""),
            "row": row,
            "creative_new": creative_new,
            "videos_ids": videos_ids,
            "videos_thumbs": videos_thumbs,
            "pvid_new": pvid,
            "page_id_new": own_page_id,
            "probe": probe,
        }

        igm = str(creative_new.get("effective_instagram_media_id") or "").strip()
        if igm and resolve_structural_media_type(probe, pvid) is None:
            pending_igm.setdefault(igm, []).append(correction)

        corrections.append(correction)

    # igm -> media_type oficial (apenas sem tipo estrutural, espelha o enricher)
    if pending_igm:
        print(f"  Resolvendo media_type de {len(pending_igm)} igm ids (sem tipo estrutural)...")
        igm_types = resolve_igm_types(list(pending_igm.keys()), token)
        for igm, corrs in pending_igm.items():
            ig_type = igm_types.get(igm)
            if ig_type:
                for c in corrs:
                    c["probe"]["ig_media_type"] = ig_type

    # ------------------------------------------------------------------
    # Diff por chaves de identidade (nunca URLs assinadas)
    # ------------------------------------------------------------------
    changed: List[Dict[str, Any]] = []
    for c in corrections:
        row = c["row"]
        old_creative = creative_of(row)
        new_creative = c["creative_new"]
        media_type_new = resolve_media_type(c["probe"], c["pvid_new"])

        old_ids = row.get("adcreatives_videos_ids") or []
        if not isinstance(old_ids, list):
            old_ids = []

        diffs = []
        if str(row.get("primary_video_id") or "") != str(c["pvid_new"] or ""):
            diffs.append("primary_video_id")
        if str(old_creative.get("video_id") or "") != str(new_creative.get("video_id") or ""):
            diffs.append("creative_video_id")
        if str(old_creative.get("effective_instagram_media_id") or "") != str(new_creative.get("effective_instagram_media_id") or ""):
            diffs.append("igm")
        if str(old_creative.get("image_hash") or "") != str(new_creative.get("image_hash") or ""):
            diffs.append("image_hash")
        if [str(v) for v in old_ids] != c["videos_ids"]:
            diffs.append("videos_ids")
        if str(row.get("media_type") or "") != media_type_new:
            diffs.append("media_type")
        if c["page_id_new"] and str(row.get("video_owner_page_id") or "") != c["page_id_new"]:
            diffs.append("video_owner_page_id")

        if not diffs:
            continue

        # identidade de midia mudou (thumb precisa re-cache)? page_id/media_type-only nao conta
        identity_changed = bool(set(diffs) & {"primary_video_id", "creative_video_id", "igm", "image_hash", "videos_ids"})

        c["diffs"] = diffs
        c["identity_changed"] = identity_changed
        c["media_type_new"] = media_type_new
        changed.append(c)

    identity_count = sum(1 for c in changed if c["identity_changed"])
    print(f"\n  {len(changed)} ads com alteracao ({identity_count} com identidade de midia trocada; "
          f"{skipped_no_own} sem dado proprio, intactos)")

    diff_counter = Counter(d for c in changed for d in c["diffs"])
    for key, count in diff_counter.most_common():
        print(f"    {key}: {count}")

    print("\n  Primeiros 15 com identidade trocada:")
    for c in [x for x in changed if x["identity_changed"]][:15]:
        row = c["row"]
        print(f"    {c['ad_id']} pvid {row.get('primary_video_id') or '-'} -> {c['pvid_new'] or '-'} "
              f"[{','.join(c['diffs'])}] {c['ad_name'][:55]}")

    report = [
        {
            "ad_id": c["ad_id"],
            "ad_name": c["ad_name"],
            "diffs": c["diffs"],
            "identity_changed": c["identity_changed"],
            "old_pvid": c["row"].get("primary_video_id"),
            "new_pvid": c["pvid_new"],
            "old_igm": creative_of(c["row"]).get("effective_instagram_media_id"),
            "new_igm": c["creative_new"].get("effective_instagram_media_id"),
            "old_media_type": c["row"].get("media_type"),
            "new_media_type": c["media_type_new"],
        }
        for c in changed
    ]
    out = backend_dir / "scripts" / "debug_output" / f"backfill_source_ad_swap_{uid[:8]}.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(report, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
    print(f"\n  Relatorio completo: {out}")

    if not apply or not changed:
        if not apply:
            print("  [DRY-RUN] Nenhuma alteracao gravada. Use --apply para aplicar.")
        return {"user": uid, "ads": len(rows), "changed": len(changed), "identity": identity_count}

    # ------------------------------------------------------------------
    # SELECT de verificacao antes do UPDATE (padrao do projeto)
    # ------------------------------------------------------------------
    print("\n  SELECT de verificacao...")
    verify_map: Dict[str, Dict] = {}
    ids_to_update = [c["ad_id"] for c in changed]
    for i in range(0, len(ids_to_update), 200):
        chunk = ids_to_update[i:i + 200]
        vr = (
            sb.table("ads")
            .select("ad_id,primary_video_id,creative_video_id")
            .eq("user_id", uid)
            .in_("ad_id", chunk)
            .execute()
            .data or []
        )
        verify_map.update({str(r["ad_id"]): r for r in vr})

    # ------------------------------------------------------------------
    # UPDATE por ad (payload distinto por linha — creative JSONB)
    # ------------------------------------------------------------------
    print("  Aplicando UPDATEs...")
    updated = 0
    skipped_state = 0
    for idx, c in enumerate(changed):
        snap = verify_map.get(c["ad_id"])
        row = c["row"]
        if not snap or (
            str(snap.get("primary_video_id") or "") != str(row.get("primary_video_id") or "")
            or str(snap.get("creative_video_id") or "") != str(row.get("creative_video_id") or "")
        ):
            skipped_state += 1
            continue

        creative_new = c["creative_new"]
        payload: Dict[str, Any] = {
            "creative": creative_new,
            "creative_video_id": creative_new.get("video_id"),
            "primary_video_id": c["pvid_new"],
            "media_type": c["media_type_new"],
            "thumbnail_url": creative_new.get("thumbnail_url"),
            "instagram_permalink_url": creative_new.get("instagram_permalink_url"),
            "adcreatives_videos_ids": c["videos_ids"] or None,
            "adcreatives_videos_thumbs": c["videos_thumbs"] or None,
            "updated_at": _now_iso(),
        }
        if c["page_id_new"]:
            payload["video_owner_page_id"] = c["page_id_new"]

        sb.table("ads").update(payload).eq("user_id", uid).eq("ad_id", c["ad_id"]).execute()
        updated += 1
        if (idx + 1) % 50 == 0:
            print(f"    ... {idx + 1}/{len(changed)}")
            time.sleep(0.2)

    print(f"  {updated} atualizados, {skipped_state} pulados (estado mudou desde o SELECT)")

    # ------------------------------------------------------------------
    # Re-cache de thumbnails dos ad_names com identidade trocada
    # ------------------------------------------------------------------
    thumbs_recached = 0
    if not skip_thumbs:
        # nome -> todos os ad_ids do usuario (o thumb e por ad_name, cobre o grupo inteiro)
        name_to_all_ad_ids: Dict[str, List[str]] = {}
        name_labels: Dict[str, str] = {}
        for r in rows:
            nm = str(r.get("ad_name") or "").strip()
            if not nm:
                continue
            key = normalize_ad_name(nm)
            name_to_all_ad_ids.setdefault(key, []).append(str(r["ad_id"]))
            name_labels.setdefault(key, nm)

        ad_name_to_thumb_url: Dict[str, str] = {}
        for c in sorted((x for x in changed if x["identity_changed"]), key=lambda x: x["ad_id"]):
            nm = c["ad_name"].strip()
            if not nm:
                continue
            key = normalize_ad_name(nm)
            if name_labels.get(key, nm) in ad_name_to_thumb_url:
                continue
            candidates = [
                *(c["videos_thumbs"][:1]),
                str(c["creative_new"].get("thumbnail_url") or ""),
            ]
            thumb_url = select_representative_thumb_url(candidates)
            if thumb_url:
                ad_name_to_thumb_url[name_labels.get(key, nm)] = thumb_url

        print(f"\n  Re-cacheando thumbnails de {len(ad_name_to_thumb_url)} ad_names...")
        cached_by_key = cache_first_thumbs_for_ad_names(
            user_id=uid,
            ad_name_to_thumb_url=ad_name_to_thumb_url,
        )
        thumbs_recached = len(cached_by_key)

        ad_id_to_cached: Dict[str, Any] = {}
        for thumb_key, cached in cached_by_key.items():
            for ad_id in name_to_all_ad_ids.get(thumb_key, []):
                ad_id_to_cached[ad_id] = cached
        if ad_id_to_cached:
            result = supabase_repo.update_ads_thumbnail_cache(user_id=uid, ad_id_to_cached=ad_id_to_cached)
            print(f"  Thumbs: {thumbs_recached}/{len(ad_name_to_thumb_url)} re-cacheadas, "
                  f"{result.get('updated', 0)} linhas de ads atualizadas")

    return {
        "user": uid,
        "ads": len(rows),
        "changed": len(changed),
        "identity": identity_count,
        "updated": updated,
        "thumbs_recached": thumbs_recached,
    }


def main(apply: bool, user_prefix: Optional[str], skip_thumbs: bool) -> None:
    sb = get_supabase_service()
    conns = (
        sb.table("facebook_connections")
        .select("user_id,access_token,status")
        .execute()
        .data or []
    )

    # uma conexao por usuario, preferindo active > degraded (token ainda funciona)
    by_user: Dict[str, Dict] = {}
    rank = {"active": 0, "degraded": 1}
    for conn in conns:
        status = str(conn.get("status") or "")
        if status not in rank:
            continue
        uid = str(conn["user_id"])
        if user_prefix and not uid.startswith(user_prefix):
            continue
        current = by_user.get(uid)
        if current is None or rank[status] < rank[str(current.get("status") or "degraded")]:
            by_user[uid] = conn

    if not by_user:
        raise SystemExit("[FATAL] nenhuma conexao ativa encontrada para o filtro")

    print(f"{len(by_user)} usuario(s) com conexao utilizavel | apply={apply} skip_thumbs={skip_thumbs}")

    summaries = []
    for uid, conn in by_user.items():
        try:
            token = decrypt_token(conn["access_token"])
        except Exception as exc:
            print(f"\n[SKIP] {uid[:8]}...: falha ao decriptar token: {exc}")
            continue

        try:
            me_resp = requests.get(
                GRAPH + "/me", params={"fields": "id", "access_token": token}, timeout=TIMEOUT
            ).json()
        except Exception as exc:
            print(f"[SKIP] {uid[:8]}...: token-check falhou: {exc}")
            continue
        if "error" in me_resp:
            print(f"[SKIP] {uid[:8]}...: token invalido/expirado ({me_resp['error'].get('code')})")
            continue

        try:
            summaries.append(process_user(sb, uid, token, apply=apply, skip_thumbs=skip_thumbs))
        except Exception as exc:
            print(f"[ERRO] {uid[:8]}...: {exc}")

    print(f"\n{'='*70}\nResumo:")
    for s in summaries:
        print(f"  {s['user'][:8]}...: ads={s.get('ads', 0)} alterados={s.get('changed', 0)} "
              f"identidade_trocada={s.get('identity', 0)} aplicados={s.get('updated', '-')} "
              f"thumbs={s.get('thumbs_recached', '-')}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Backfill do bug de midia herdada do source_ad (re-sync own-creative + re-cache thumbs)"
    )
    parser.add_argument("--apply", action="store_true", default=False, help="Aplicar UPDATEs (default: dry-run)")
    parser.add_argument("--user-prefix", default=None, help="Processar apenas usuarios cujo user_id comeca com este prefixo")
    parser.add_argument("--skip-thumbs", action="store_true", default=False, help="Nao re-cachear thumbnails")
    args = parser.parse_args()
    main(apply=args.apply, user_prefix=args.user_prefix, skip_thumbs=args.skip_thumbs)
