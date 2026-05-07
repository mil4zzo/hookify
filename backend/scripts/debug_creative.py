"""
Debug script para isolar a criação de creative no Meta sem passar pela máquina
de jobs/heartbeat/UI do bulk. Roda localmente, lê DEBUG_FACEBOOK_TOKEN do .env,
imprime e salva em disco TUDO que vai e volta do Meta.

Uso:

  # 1) Classificar uma lista de ads (story_spec_simple vs asset_feed_spec_labeled)
  python -m scripts.debug_creative classify --ad-ids 120246019469590782 120246025167150782

  # 2) Testar fluxo de criação de creative (NÃO cria adset/ad — só /adcreatives)
  python -m scripts.debug_creative test --ad-id 120246019469590782 --files scripts/test_files/image_square.jpg

Saída em backend/scripts/debug_output/<timestamp>_<tag>/:
  - 00_template.json        — creative_template parseado
  - 01_raw_creative.json    — payload bruto do GET /<ad_id>?fields=...
  - 02_uploaded_media.json  — image_hash / video_id de cada arquivo enviado
  - 03_creative_params.json — payload EXATO que vai pro POST /act_*/adcreatives
  - 04_response.json        — resposta do Meta (sucesso ou erro completo)
"""

from __future__ import annotations

import argparse
import json
import logging
import mimetypes
import os
import sys
import time
from dataclasses import asdict, is_dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

# Garantir que o backend/ root está no path (executar como `python -m scripts.debug_creative`
# já cuida disso; manter como segurança quando executado como `python scripts/debug_creative.py`).
_BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from dotenv import load_dotenv  # type: ignore

load_dotenv(_BACKEND_DIR / ".env")

# ── Logging simples e verboso ────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("debug_creative")

# Imports do app (depois do path setup)
from app.services.graph_api import GraphAPI
from app.services.creative_template import (
    parse_creative_template,
    validate_template_for_bulk_clone,
    CreativeTemplateError,
)
from app.services.bulk_ad_service import (
    StorySpecCreativeBuilder,
    AssetFeedCreativeBuilder,
    MediaRef,
    BundleMediaRef,
)


# ── Helpers ──────────────────────────────────────────────────────────────────

def _to_jsonable(obj: Any) -> Any:
    """Converte dataclasses, sets, etc para algo serializável em JSON."""
    if is_dataclass(obj):
        return _to_jsonable(asdict(obj))
    if isinstance(obj, dict):
        return {str(k): _to_jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple, set)):
        return [_to_jsonable(v) for v in obj]
    if isinstance(obj, bytes):
        return f"<bytes len={len(obj)}>"
    return obj


def _dump(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(_to_jsonable(data), f, ensure_ascii=False, indent=2)
    logger.info("dumped %s", path.relative_to(_BACKEND_DIR))


def _require_env(name: str) -> str:
    val = os.getenv(name)
    if not val:
        sys.exit(f"FATAL: variável {name} não está definida em backend/.env")
    return val


def _media_type_for(file_path: Path) -> str:
    mt, _ = mimetypes.guess_type(file_path.name)
    if mt and mt.startswith("video/"):
        return "video"
    if mt and mt.startswith("image/"):
        return "image"
    # Fallback por extensão
    ext = file_path.suffix.lower()
    if ext in {".mp4", ".mov", ".m4v", ".webm"}:
        return "video"
    if ext in {".jpg", ".jpeg", ".png", ".webp"}:
        return "image"
    sys.exit(f"FATAL: não consegui determinar tipo de mídia para {file_path}")


def _build_api() -> GraphAPI:
    token = _require_env("DEBUG_FACEBOOK_TOKEN")
    return GraphAPI(token, user_id="debug-script")


def _fetch_template_or_die(api: GraphAPI, ad_id: str):
    res = api.get_ad_creative_details(ad_id)
    if res.get("status") != "success":
        logger.error("get_ad_creative_details FAILED: %s", json.dumps(res, ensure_ascii=False)[:1500])
        sys.exit(1)
    raw = res.get("data") or {}
    template = parse_creative_template(raw)
    return raw, template


# ── Mode: classify ───────────────────────────────────────────────────────────

def cmd_classify(args: argparse.Namespace) -> None:
    api = _build_api()
    print()
    print(f"{'AD_ID':<22} | {'family':<28} | {'media_kind':<8} | swap | bulk | reason")
    print("-" * 110)
    for ad_id in args.ad_ids:
        try:
            raw, template = _fetch_template_or_die(api, ad_id)
            caps = template.capabilities
            reason = caps.blocking_reason or "—"
            print(
                f"{ad_id:<22} | {template.family or '?':<28} | "
                f"{template.media_kind or '?':<8} | "
                f"{'Y' if caps.supports_media_swap else 'N':<4} | "
                f"{'Y' if caps.supports_bulk_clone else 'N':<4} | "
                f"{reason}"
            )
        except Exception as exc:
            print(f"{ad_id:<22} | ERROR: {exc}")
    print()


# ── Mode: test (the heart of the debug) ─────────────────────────────────────

def cmd_test(args: argparse.Namespace) -> None:
    act_id = f"act_{_require_env('DEBUG_AD_ACCOUNT_ID')}"
    api = _build_api()

    files: List[Path] = [Path(p).resolve() for p in args.files]
    for fp in files:
        if not fp.exists():
            sys.exit(f"FATAL: arquivo nao encontrado: {fp}")

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    short_ad = args.ad_id[-8:]
    out_dir = _BACKEND_DIR / "scripts" / "debug_output" / f"{timestamp}_ad{short_ad}"
    out_dir.mkdir(parents=True, exist_ok=True)
    logger.info("output dir: %s", out_dir.relative_to(_BACKEND_DIR))

    # Step 1 — Fetch + classify template
    raw, template = _fetch_template_or_die(api, args.ad_id)
    _dump(out_dir / "01_raw_creative.json", raw)
    _dump(out_dir / "00_template.json", template)
    logger.info(
        "template family=%s media_kind=%s swap=%s bulk=%s slots=%s",
        template.family, template.media_kind,
        template.capabilities.supports_media_swap,
        template.capabilities.supports_bulk_clone,
        len(template.media_slots),
    )
    if not template.capabilities.supports_bulk_clone:
        logger.warning(
            "Template NÃO suporta bulk_clone — reason=%s. Continuando mesmo assim.",
            template.capabilities.blocking_reason,
        )

    # Step 2 — Upload media (mirroring bulk_ad_service logic — image direct, video chunked)
    media_refs: Dict[int, MediaRef] = {}
    upload_log: List[Dict[str, Any]] = []
    for idx, fp in enumerate(files):
        media_type = _media_type_for(fp)
        size = fp.stat().st_size
        logger.info("[upload %d/%d] %s (%s, %.1f MB)", idx + 1, len(files), fp.name, media_type, size / 1024 / 1024)
        t0 = time.monotonic()
        if media_type == "image":
            with fp.open("rb") as fh:
                content = fh.read()
            res = api.upload_ad_image(act_id, fp.name, content)
            if res.get("status") != "success":
                _dump(out_dir / f"02b_upload_error_{idx}.json", res)
                sys.exit(f"FATAL: upload de image falhou em {fp.name}. Veja 02b_upload_error_{idx}.json")
            data = res.get("data") or {}
            image_info = ((data.get("images") or {}).get(fp.name) or {})
            image_hash = image_info.get("hash") or data.get("hash")
            if not image_hash:
                _dump(out_dir / f"02b_upload_unexpected_{idx}.json", res)
                sys.exit(f"FATAL: upload OK mas sem image_hash em {fp.name}")
            ref = MediaRef(
                file_index=idx, file_name=fp.name, media_type="image", image_hash=str(image_hash),
            )
        else:
            # Video → chunked
            with fp.open("rb") as fh:
                res = api.upload_ad_video_chunked(
                    act_id, fp.name, fh, size,
                )
            if res.get("status") != "success":
                _dump(out_dir / f"02b_upload_error_{idx}.json", res)
                sys.exit(f"FATAL: upload de video falhou em {fp.name}. Veja 02b_upload_error_{idx}.json")
            data = res.get("data") or {}
            video_id = str(data.get("id") or "")
            if not video_id:
                _dump(out_dir / f"02b_upload_unexpected_{idx}.json", res)
                sys.exit(f"FATAL: upload OK mas sem video_id em {fp.name}")
            ref = MediaRef(
                file_index=idx, file_name=fp.name, media_type="video", video_id=video_id,
            )
            # Aguardar o video processar (pequeno: 5 leituras a 3s)
            for poll in range(20):
                stat = api.get_video_status(video_id)
                if stat.get("status") == "success":
                    sd = (stat.get("data") or {}).get("status") or {}
                    vstatus = str(sd.get("video_status") or "").lower()
                    if vstatus in {"ready", "active"}:
                        break
                    if vstatus in {"error", "failed"}:
                        _dump(out_dir / f"02c_video_processing_failed_{idx}.json", stat)
                        sys.exit(f"FATAL: video {video_id} falhou no processamento. Veja 02c_video_processing_failed_{idx}.json")
                time.sleep(3)
        media_refs[idx] = ref
        upload_log.append({
            "file_index": idx,
            "file_name": fp.name,
            "media_type": media_type,
            "size_bytes": size,
            "duration_ms": int((time.monotonic() - t0) * 1000),
            "image_hash": ref.image_hash,
            "video_id": ref.video_id,
        })
    _dump(out_dir / "02_uploaded_media.json", upload_log)

    # Step 3 — Build creative_params (use the EXACT same builders as bulk)
    item: Dict[str, Any] = {
        "id": "debug-item",
        "ad_name": f"DEBUG-{short_ad}-{timestamp}",
        "campaign_name": "debug",
    }

    # Map slots to refs, mirroring _map_slot_files_to_template (without the type-mismatch gate)
    slot_refs: Dict[str, MediaRef] = {}
    for slot_idx, slot in enumerate(template.media_slots):
        if slot_idx >= len(media_refs):
            logger.warning("Slot %s sem mídia correspondente (passou %d arquivos para %d slots)",
                           slot.slot_key, len(media_refs), len(template.media_slots))
            continue
        ref = media_refs[slot_idx]
        if slot.media_type != ref.media_type:
            logger.info("CROSS-TYPE swap: slot=%s expected=%s uploaded=%s",
                        slot.slot_key, slot.media_type, ref.media_type)
        slot_refs[slot.slot_key] = ref
    if not slot_refs:
        sys.exit("FATAL: nenhum slot mapeado — verifica se o template tem media_slots")

    bundle = BundleMediaRef(bundle_id="debug-bundle", slot_refs=slot_refs)

    if template.family == "story_spec_simple":
        builder = StorySpecCreativeBuilder()
    elif template.family == "asset_feed_spec_labeled":
        builder = AssetFeedCreativeBuilder()
    else:
        sys.exit(f"FATAL: family não suportada para teste: {template.family}")

    creative_params = builder.build(item, template, bundle)
    _dump(out_dir / "03_creative_params.json", creative_params)
    logger.info("creative_params construído (ver 03_creative_params.json)")

    # Step 4 — POST /act_*/adcreatives
    logger.info("POST %s/adcreatives ...", act_id)
    t0 = time.monotonic()
    response = api.create_ad_creative(act_id, creative_params)
    duration_ms = int((time.monotonic() - t0) * 1000)
    response["_debug_duration_ms"] = duration_ms
    _dump(out_dir / "04_response.json", response)

    status = response.get("status")
    if status == "success":
        creative_id = (response.get("data") or {}).get("id")
        logger.info("✅ SUCESSO! creative_id=%s duration_ms=%s", creative_id, duration_ms)
        logger.info("    Diretório de saída: %s", out_dir.relative_to(_BACKEND_DIR))
    else:
        err = response.get("error") or {}
        logger.error("❌ FALHA. status=%s code=%s subcode=%s message=%s",
                     status, err.get("code"), err.get("error_subcode"),
                     err.get("message") or response.get("message"))
        logger.error("    Detalhes completos em %s/04_response.json", out_dir.relative_to(_BACKEND_DIR))
    print()
    print(f"Output dir: {out_dir}")


# ── CLI ──────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Debug isolado de criação de creative no Meta")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_classify = sub.add_parser("classify", help="Classificar templates por ad_id")
    p_classify.add_argument("--ad-ids", nargs="+", required=True, help="Um ou mais ad_ids")
    p_classify.set_defaults(func=cmd_classify)

    p_test = sub.add_parser("test", help="Testar pipeline ate POST /adcreatives (sem criar adset/ad)")
    p_test.add_argument("--ad-id", required=True, help="Template ad_id")
    p_test.add_argument("--files", nargs="+", required=True, help="Caminhos para 1+ arquivos (1 por slot)")
    p_test.set_defaults(func=cmd_test)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
