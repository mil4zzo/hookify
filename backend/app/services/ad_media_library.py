"""Biblioteca de mídias enviadas à Meta para a duplicação de campanha.

"Mídia primeiro": a mídia chega à biblioteca da conta na Meta ANTES do job de
criação, que depois só trabalha com ids (`image_hash` / `video_id`).

Ciclo de uma mídia (tabela `ad_media_library`, migration 182):
    uploading  → bytes indo para a Meta (computador: o navegador manda pedaço a
                 pedaço pelo backend; Drive: o servidor baixa e envia)
    processing → Meta codificando o vídeo (imagem pula direto para ready)
    ready      → pronto para criativo (vídeo já com capa própria em thumbnail_hash)
    error      → falhou; error_message diz o porquê

A impressão digital (fingerprint) deduplica por conta: reenviar o mesmo arquivo
para a mesma conta devolve a linha existente sem tocar na Meta.
"""
from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Any, Callable, Dict, Iterable, List, Optional

import requests

from app.core.supabase_retry import with_postgrest_retry
from app.services.creative_media_swap import MediaRef
from app.services.graph_api import GraphAPI
from app.services.meta_api_errors import MetaAPIError, extract_data_or_raise

logger = logging.getLogger(__name__)

TABLE = "ad_media_library"

IMAGE_MAX_BYTES = 30 * 1024 * 1024
VIDEO_MAX_BYTES = 4 * 1024 * 1024 * 1024
IMAGE_CONTENT_TYPES = {"image/jpeg", "image/png"}
VIDEO_CONTENT_TYPES = {"video/mp4", "video/quicktime"}

# A Meta às vezes vira ready→error na finalização do encoding: exigimos 2 leituras
# seguidas de "ready" antes de confiar (mesma regra do upload legado).
_READY_READS_REQUIRED = 2


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _act(account_id: str) -> str:
    value = str(account_id or "").strip()
    return value if value.startswith("act_") else f"act_{value}"


def normalize_account_id(account_id: str) -> str:
    value = str(account_id or "").strip()
    return value[4:] if value.startswith("act_") else value


# ── Repositório ──────────────────────────────────────────────────────────────

def fetch_media(sb, user_id: str, media_ids: Iterable[str]) -> Dict[str, Dict[str, Any]]:
    ids = sorted({str(m) for m in media_ids if m})
    if not ids:
        return {}
    result = with_postgrest_retry(
        "ad_media_library.fetch",
        lambda: sb.table(TABLE).select("*").eq("user_id", user_id).in_("id", ids).execute(),
    )
    return {str(row["id"]): row for row in (result.data or [])}


def find_by_fingerprint(sb, user_id: str, account_id: str, fingerprint: str) -> Optional[Dict[str, Any]]:
    result = with_postgrest_retry(
        "ad_media_library.find",
        lambda: sb.table(TABLE)
        .select("*")
        .eq("user_id", user_id)
        .eq("account_id", normalize_account_id(account_id))
        .eq("fingerprint", fingerprint)
        .limit(1)
        .execute(),
    )
    rows = result.data or []
    return rows[0] if rows else None


def insert_media(sb, row: Dict[str, Any]) -> Dict[str, Any]:
    result = with_postgrest_retry(
        "ad_media_library.insert",
        lambda: sb.table(TABLE).insert(row).execute(),
    )
    return (result.data or [row])[0]


def update_media(sb, media_id: str, patch: Dict[str, Any]) -> Dict[str, Any]:
    data = {**patch, "updated_at": _now_iso()}
    result = with_postgrest_retry(
        "ad_media_library.update",
        lambda: sb.table(TABLE).update(data).eq("id", media_id).execute(),
    )
    return (result.data or [data])[0]


def public_media(row: Dict[str, Any]) -> Dict[str, Any]:
    """Forma exposta ao frontend (sem sessão de upload interna)."""
    session = row.get("upload_session") or {}
    return {
        "id": row.get("id"),
        "source": row.get("source"),
        "file_name": row.get("file_name"),
        "media_type": row.get("media_type"),
        "size_bytes": row.get("size_bytes"),
        "width": row.get("width"),
        "height": row.get("height"),
        "duration_ms": row.get("duration_ms"),
        "status": row.get("status"),
        "bytes_sent": row.get("bytes_sent") or 0,
        "error_message": row.get("error_message"),
        "start_offset": session.get("start_offset"),
        "end_offset": session.get("end_offset"),
    }


def media_ref_from_row(row: Dict[str, Any], index: int = 0) -> MediaRef:
    return MediaRef(
        file_index=index,
        file_name=str(row.get("file_name") or ""),
        media_type=str(row.get("media_type") or "image"),
        image_hash=row.get("image_hash"),
        video_id=row.get("video_id"),
        thumbnail_hash=row.get("thumbnail_hash"),
    )


# ── Registro (dedupe) ────────────────────────────────────────────────────────

def register_media(
    sb,
    *,
    user_id: str,
    account_id: str,
    source: str,
    fingerprint: str,
    file_name: str,
    media_type: str,
    size_bytes: Optional[int],
    width: Optional[int] = None,
    height: Optional[int] = None,
    duration_ms: Optional[int] = None,
    drive_file_id: Optional[str] = None,
) -> tuple[Dict[str, Any], bool]:
    """Devolve (linha, reaproveitada). Linha com erro é reiniciada para nova tentativa."""
    existing = find_by_fingerprint(sb, user_id, account_id, fingerprint)
    if existing and existing.get("status") != "error":
        return existing, True
    fresh = {
        "status": "uploading",
        "bytes_sent": 0,
        "upload_session": None,
        "image_hash": None,
        "video_id": None,
        "thumbnail_hash": None,
        "error_message": None,
        "file_name": file_name,
        "size_bytes": size_bytes,
        "width": width,
        "height": height,
        "duration_ms": duration_ms,
        "drive_file_id": drive_file_id,
    }
    if existing:
        return update_media(sb, str(existing["id"]), fresh), False
    row = insert_media(
        sb,
        {
            **fresh,
            "user_id": user_id,
            "account_id": normalize_account_id(account_id),
            "source": source,
            "fingerprint": fingerprint,
            "media_type": media_type,
        },
    )
    return row, False


_STALE_UPLOAD_SECONDS = 120


def is_stale_upload(row: Dict[str, Any]) -> bool:
    """Envio servidor→Meta parado (thread morta num deploy): pode ser reiniciado.
    O importador grava bytes_sent a cada ~2 s, então 2 min sem update = morto."""
    if row.get("status") != "uploading":
        return False
    try:
        updated = datetime.fromisoformat(str(row.get("updated_at")).replace("Z", "+00:00"))
    except ValueError:
        return True
    return (datetime.now(timezone.utc) - updated).total_seconds() > _STALE_UPLOAD_SECONDS


def mark_error(sb, media_id: str, message: str) -> Dict[str, Any]:
    return update_media(sb, media_id, {"status": "error", "error_message": message[:1000]})


# ── Imagem ───────────────────────────────────────────────────────────────────

def upload_image_bytes(api: GraphAPI, account_id: str, file_name: str, content: bytes) -> str:
    result = api.upload_ad_image(_act(account_id), file_name, content)
    data = extract_data_or_raise(result, log_context="[MEDIA_LIBRARY] upload_image")
    image_info = ((data.get("images") or {}).get(file_name) or {})
    image_hash = image_info.get("hash") or data.get("hash")
    if not image_hash:
        # /adimages devolve {images: {<nome>: {hash}}}; nome pode ser normalizado
        for info in (data.get("images") or {}).values():
            if isinstance(info, dict) and info.get("hash"):
                image_hash = info["hash"]
                break
    if not image_hash:
        raise MetaAPIError("Meta nao retornou image_hash", "image_missing_hash")
    return str(image_hash)


def store_image(sb, api: GraphAPI, row: Dict[str, Any], content: bytes) -> Dict[str, Any]:
    try:
        image_hash = upload_image_bytes(api, row["account_id"], row["file_name"], content)
    except MetaAPIError as exc:
        return mark_error(sb, str(row["id"]), exc.message)
    return update_media(
        sb,
        str(row["id"]),
        {"status": "ready", "image_hash": image_hash, "bytes_sent": len(content)},
    )


# ── Vídeo: sessão em pedaços (/advideos start → transfer → finish) ───────────

def start_video_session(sb, api: GraphAPI, row: Dict[str, Any]) -> Dict[str, Any]:
    """Abre (ou reaproveita) a sessão de upload em pedaços na Meta."""
    session = row.get("upload_session") or {}
    if session.get("upload_session_id") and row.get("status") == "uploading":
        return row
    result = api.start_chunked_video_upload(_act(row["account_id"]), int(row.get("size_bytes") or 0))
    data = extract_data_or_raise(result, log_context="[MEDIA_LIBRARY] video_start")
    session = {
        "upload_session_id": str(data["upload_session_id"]),
        "start_offset": int(data["start_offset"]),
        "end_offset": int(data["end_offset"]),
        "ready_reads": 0,
    }
    return update_media(
        sb,
        str(row["id"]),
        {"upload_session": session, "video_id": str(data["video_id"]), "status": "uploading", "bytes_sent": 0},
    )


def transfer_video_chunk(sb, api: GraphAPI, row: Dict[str, Any], start_offset: int, chunk: bytes) -> Dict[str, Any]:
    """Repassa 1 pedaço à Meta. Pedaço fora de ordem não é enviado: devolve a linha
    com os offsets que a Meta espera, e o cliente se re-sincroniza por eles."""
    session = dict(row.get("upload_session") or {})
    expected = int(session.get("start_offset") or 0)
    end = int(session.get("end_offset") or 0)
    if row.get("status") != "uploading" or not session.get("upload_session_id"):
        return row
    if start_offset != expected or len(chunk) != end - expected:
        return row

    result = api.transfer_video_chunk(
        _act(row["account_id"]), session["upload_session_id"], start_offset, chunk, row["file_name"],
    )
    try:
        data = extract_data_or_raise(result, log_context="[MEDIA_LIBRARY] video_transfer")
        session["start_offset"] = int(data["start_offset"])
        session["end_offset"] = int(data["end_offset"])
    except MetaAPIError as exc:
        err_data = (exc.raw_error or {}).get("error_data") or {}
        if str(exc.subcode) == "1363037" and err_data.get("start_offset") is not None:
            # A Meta tem outro offset para nós — o cliente reenvia a partir dele.
            session["start_offset"] = int(err_data["start_offset"])
            session["end_offset"] = int(err_data["end_offset"])
            return update_media(sb, str(row["id"]), {"upload_session": session})
        if (exc.raw_error or {}).get("is_transient"):
            return row  # cliente reenvia o mesmo pedaço
        return mark_error(sb, str(row["id"]), exc.message)

    patch: Dict[str, Any] = {"upload_session": session, "bytes_sent": session["start_offset"]}
    if session["start_offset"] == session["end_offset"]:
        finish = api.finish_chunked_video_upload(
            _act(row["account_id"]), session["upload_session_id"], row["file_name"],
        )
        try:
            extract_data_or_raise(finish, log_context="[MEDIA_LIBRARY] video_finish")
        except MetaAPIError as exc:
            return mark_error(sb, str(row["id"]), exc.message)
        patch.update({"status": "processing", "bytes_sent": int(row.get("size_bytes") or 0)})
    return update_media(sb, str(row["id"]), patch)


def upload_video_stream(
    sb,
    api: GraphAPI,
    row: Dict[str, Any],
    source,
    *,
    on_check_cancel: Optional[Callable[[], None]] = None,
) -> Dict[str, Any]:
    """Upload servidor→Meta (Drive) com `source` legível por faixa (seek/read)."""
    act_id = _act(row["account_id"])

    def _progress(bytes_sent: int, total: int) -> None:
        update_media(sb, str(row["id"]), {"bytes_sent": bytes_sent})

    last = [0.0]

    def _throttled(bytes_sent: int, total: int) -> None:
        now = time.monotonic()
        if now - last[0] >= 2.0:
            last[0] = now
            _progress(bytes_sent, total)

    result = api.upload_ad_video_chunked(
        act_id,
        row["file_name"],
        source,
        int(row.get("size_bytes") or 0),
        on_progress=_throttled,
        on_check_cancel=on_check_cancel,
    )
    try:
        data = extract_data_or_raise(result, log_context="[MEDIA_LIBRARY] video_stream")
    except MetaAPIError as exc:
        return mark_error(sb, str(row["id"]), exc.message)
    return update_media(
        sb,
        str(row["id"]),
        {
            "status": "processing",
            "video_id": str(data.get("id") or ""),
            "bytes_sent": int(row.get("size_bytes") or 0),
            "upload_session": {"ready_reads": 0},
        },
    )


# ── Vídeo: processamento na Meta + capa ──────────────────────────────────────

def _store_thumbnail(api: GraphAPI, row: Dict[str, Any]) -> Optional[str]:
    """Capa preferida da Meta → /adimages → image_hash (Meta pede não usar URL do CDN)."""
    result = api.get_video_thumbnails(str(row["video_id"]))
    try:
        data = extract_data_or_raise(result, log_context="[MEDIA_LIBRARY] thumbnails")
    except MetaAPIError:
        return None
    thumbs: List[Dict[str, Any]] = data.get("data") or []
    if not thumbs:
        return None
    chosen = next((t for t in thumbs if t.get("is_preferred")), thumbs[0])
    uri = chosen.get("uri")
    if not uri:
        return None
    try:
        resp = requests.get(uri, timeout=30)
        resp.raise_for_status()
        return upload_image_bytes(api, row["account_id"], f"capa_{row['video_id']}.jpg", resp.content)
    except (requests.RequestException, MetaAPIError) as exc:
        logger.warning("[MEDIA_LIBRARY] thumbnail_failed video_id=%s err=%s", row.get("video_id"), exc)
        return None


def refresh_processing(sb, api: GraphAPI, row: Dict[str, Any]) -> Dict[str, Any]:
    """1 passo (não bloqueia): lê o status do vídeo na Meta e avança a linha."""
    if row.get("status") != "processing" or not row.get("video_id"):
        return row
    result = api.get_video_status(str(row["video_id"]))
    try:
        data = extract_data_or_raise(result, log_context="[MEDIA_LIBRARY] video_status")
    except MetaAPIError as exc:
        if (exc.raw_error or {}).get("is_transient"):
            return row
        return mark_error(sb, str(row["id"]), exc.message)
    status = data.get("status") or {}
    video_status = str(status.get("video_status") or "").lower()
    phases = [
        str((status.get(k) or {}).get("status") or "").lower()
        for k in ("uploading_phase", "processing_phase")
    ]
    if video_status in {"error", "failed"} or any(p in {"error", "failed"} for p in phases):
        return mark_error(sb, str(row["id"]), f"A Meta não conseguiu processar o vídeo ({video_status or 'erro'}).")

    session = dict(row.get("upload_session") or {})
    if video_status in {"ready", "active"}:
        session["ready_reads"] = int(session.get("ready_reads") or 0) + 1
    else:
        session["ready_reads"] = 0
    if session["ready_reads"] < _READY_READS_REQUIRED:
        return update_media(sb, str(row["id"]), {"upload_session": session})

    thumbnail_hash = _store_thumbnail(api, row)
    if not thumbnail_hash:
        # Sem capa própria o criativo herdaria a do modelo — melhor tentar de novo
        # no próximo passo do que publicar com a capa errada.
        return update_media(sb, str(row["id"]), {"upload_session": session})
    return update_media(
        sb,
        str(row["id"]),
        {"status": "ready", "thumbnail_hash": thumbnail_hash, "upload_session": None},
    )


def wait_until_ready(
    sb,
    api: GraphAPI,
    user_id: str,
    media_ids: List[str],
    *,
    heartbeat: Callable[[str], None],
    max_wait_seconds: int = 900,
) -> Dict[str, Dict[str, Any]]:
    """Bloqueia até todas as mídias estarem ready (usado pelo job de criação).

    Mídia `uploading` é responsabilidade de quem envia (navegador ou importador do
    Drive): aqui só esperamos. `processing` avançamos nós mesmos.
    """
    started = time.monotonic()
    sleep_seconds = 2.0
    while True:
        rows = fetch_media(sb, user_id, media_ids)
        missing = [m for m in media_ids if m not in rows]
        if missing:
            raise MetaAPIError("Mídia não encontrada na biblioteca.", "bundle_missing_media")
        failed = [r for r in rows.values() if r.get("status") == "error"]
        if failed:
            raise MetaAPIError(
                f"A mídia '{failed[0].get('file_name')}' falhou: {failed[0].get('error_message') or 'erro'}",
                "media_failed",
            )
        pending = [r for r in rows.values() if r.get("status") != "ready"]
        if not pending:
            return rows
        for row in pending:
            if row.get("status") == "processing":
                refresh_processing(sb, api, row)
        if time.monotonic() - started > max_wait_seconds:
            names = ", ".join(str(r.get("file_name")) for r in pending[:3])
            raise MetaAPIError(f"Mídia ainda não ficou pronta: {names}", "media_not_ready")
        uploading = sum(1 for r in pending if r.get("status") == "uploading")
        heartbeat(
            f"Aguardando {len(pending)} mídia(s) ficarem prontas na Meta"
            + (f" ({uploading} ainda enviando)" if uploading else "")
            + "..."
        )
        time.sleep(sleep_seconds)
        sleep_seconds = min(sleep_seconds * 1.5, 10.0)
