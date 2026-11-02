"""Google Drive como origem de mídias da duplicação de campanha.

O servidor lista a pasta e importa cada arquivo Drive→Meta em pedaços, lendo do
Drive por faixa de bytes (header Range) exatamente o pedaço que a Meta pede. Nada
passa pelo navegador nem é gravado em disco: um vídeo de 1 GB não depende da
internet de quem está lançando.

Usa a conexão Google que já existe (escopo drive.readonly, ver core/config.py).
"""
from __future__ import annotations

import logging
import re
import threading
import time
from typing import Any, Callable, Dict, List, Optional, Tuple
from urllib.parse import parse_qs, urlparse

import requests

from app.core.supabase_client import get_supabase_service
from app.services import ad_media_library
from app.services.google_token_service import get_google_access_token_for_user
from app.services.graph_api import GraphAPI

logger = logging.getLogger(__name__)

DRIVE_API = "https://www.googleapis.com/drive/v3"
FOLDER_MIME = "application/vnd.google-apps.folder"
SHORTCUT_MIME = "application/vnd.google-apps.shortcut"
_MEDIA_TYPES = {
    "image/jpeg": "image",
    "image/png": "image",
    "video/mp4": "video",
    "video/quicktime": "video",
}
_FILE_FIELDS = (
    "id,name,mimeType,size,md5Checksum,thumbnailLink,"
    "imageMediaMetadata(width,height),videoMediaMetadata(width,height,durationMillis),"
    "shortcutDetails(targetId,targetMimeType)"
)
_ID_RE = re.compile(r"^[A-Za-z0-9_-]{10,}$")


class DriveError(Exception):
    def __init__(self, code: str, message: str, status_code: int = 400):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


def media_type_for(mime_type: str) -> Optional[str]:
    return _MEDIA_TYPES.get(str(mime_type or "").lower())


def parse_folder_id(value: str) -> Optional[str]:
    """Aceita link de pasta (drive/folders/<id>, drive/u/0/folders/<id>, open?id=<id>) ou o id cru."""
    value = str(value or "").strip()
    if _ID_RE.match(value):
        return value
    try:
        parsed = urlparse(value)
    except ValueError:
        return None
    if "google.com" not in (parsed.netloc or ""):
        return None
    match = re.search(r"/folders/([A-Za-z0-9_-]{10,})", parsed.path or "")
    if match:
        return match.group(1)
    ids = parse_qs(parsed.query or "").get("id")
    if ids and _ID_RE.match(ids[0]):
        return ids[0]
    return None


class _DriveClient:
    def __init__(self, user_jwt: Optional[str], user_id: str):
        self.user_jwt = user_jwt
        self.user_id = user_id
        self._token: Optional[str] = None

    def _access_token(self, force_refresh: bool = False) -> str:
        if self._token and not force_refresh:
            return self._token
        try:
            token = get_google_access_token_for_user(self.user_jwt, self.user_id, force_refresh=force_refresh)
        except Exception as exc:  # noqa: BLE001 — refresh_token revogado etc.
            raise DriveError("google_token_expired", "A conexão com o Google expirou. Reconecte a conta Google.", 401) from exc
        if not token:
            raise DriveError("google_not_connected", "Conecte uma conta Google para usar o Drive.", 400)
        self._token = token
        return token

    def request(self, path: str, *, params: Dict[str, Any], headers: Optional[Dict[str, str]] = None,
                stream: bool = False, timeout: int = 60) -> requests.Response:
        """GET com 1 refresh em 401 e até 3 tentativas em falha transitória."""
        refreshed = False
        for attempt in range(4):
            req_headers = {"Authorization": f"Bearer {self._access_token()}"}
            req_headers.update(headers or {})
            try:
                resp = requests.get(f"{DRIVE_API}/{path}", params=params, headers=req_headers, stream=stream, timeout=timeout)
            except requests.RequestException as exc:
                if attempt == 3:
                    raise DriveError("drive_unreachable", f"Falha ao acessar o Google Drive: {exc}", 502) from exc
                time.sleep(1.5 * (attempt + 1))
                continue
            if resp.status_code == 401 and not refreshed:
                refreshed = True
                self._access_token(force_refresh=True)
                continue
            if resp.status_code in (429, 500, 502, 503, 504) and attempt < 3:
                time.sleep(1.5 * (attempt + 1))
                continue
            return resp
        return resp  # type: ignore[possibly-undefined]


def _common_params() -> Dict[str, Any]:
    # Drives compartilhados exigem os dois flags; sem eles a pasta "não existe".
    return {"supportsAllDrives": "true", "includeItemsFromAllDrives": "true"}


def _raise_for_folder(resp: requests.Response, folder_id: str) -> None:
    if resp.status_code in (403, 404):
        raise DriveError(
            "drive_folder_not_found",
            "Pasta não encontrada ou sem acesso pela conta Google conectada. "
            "Confira o link e se essa conta tem permissão de leitura na pasta.",
            404,
        )
    if resp.status_code >= 400:
        raise DriveError("drive_error", f"Google Drive respondeu {resp.status_code}.", 502)


def _list_children(client: _DriveClient, folder_id: str) -> List[Dict[str, Any]]:
    files: List[Dict[str, Any]] = []
    page_token: Optional[str] = None
    while True:
        params = {
            **_common_params(),
            "q": f"'{folder_id}' in parents and trashed = false",
            "fields": f"nextPageToken,files({_FILE_FIELDS})",
            "pageSize": 1000,
            "orderBy": "name_natural",
        }
        if page_token:
            params["pageToken"] = page_token
        resp = client.request("files", params=params)
        _raise_for_folder(resp, folder_id)
        body = resp.json()
        files.extend(body.get("files") or [])
        page_token = body.get("nextPageToken")
        if not page_token:
            return files


def _resolve_shortcuts(client: _DriveClient, entries: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    resolved: List[Dict[str, Any]] = []
    for entry in entries:
        if entry.get("mimeType") != SHORTCUT_MIME:
            resolved.append(entry)
            continue
        target = (entry.get("shortcutDetails") or {}).get("targetId")
        if not target:
            continue
        resp = client.request(f"files/{target}", params={**_common_params(), "fields": _FILE_FIELDS})
        if resp.status_code == 200:
            data = resp.json()
            data["name"] = entry.get("name") or data.get("name")
            resolved.append(data)
    return resolved


def _media_view(entry: Dict[str, Any], group: Optional[str]) -> Optional[Dict[str, Any]]:
    media_type = media_type_for(entry.get("mimeType"))
    if not media_type or not entry.get("size"):
        return None
    meta = entry.get("videoMediaMetadata") or entry.get("imageMediaMetadata") or {}
    return {
        "id": entry["id"],
        "name": entry.get("name") or entry["id"],
        "mime_type": entry.get("mimeType"),
        "media_type": media_type,
        "size_bytes": int(entry["size"]),
        "md5": entry.get("md5Checksum"),
        "width": meta.get("width"),
        "height": meta.get("height"),
        "duration_ms": int(meta["durationMillis"]) if meta.get("durationMillis") else None,
        "thumbnail_url": entry.get("thumbnailLink"),
        # Subpasta de 1º nível: convenção "1 subpasta = 1 criativo" no agrupamento.
        "group": group,
    }


def list_folder_media(user_jwt: str, user_id: str, folder_id: str) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
    client = _DriveClient(user_jwt, user_id)
    meta_resp = client.request(f"files/{folder_id}", params={**_common_params(), "fields": "id,name,mimeType"})
    _raise_for_folder(meta_resp, folder_id)
    folder = meta_resp.json()
    if folder.get("mimeType") != FOLDER_MIME:
        raise DriveError("drive_not_a_folder", "O link é de um arquivo, não de uma pasta.", 422)

    media: List[Dict[str, Any]] = []
    for entry in _resolve_shortcuts(client, _list_children(client, folder_id)):
        if entry.get("mimeType") == FOLDER_MIME:
            for child in _resolve_shortcuts(client, _list_children(client, entry["id"])):
                view = _media_view(child, entry.get("name"))
                if view:
                    media.append(view)
            continue
        view = _media_view(entry, None)
        if view:
            media.append(view)
    return {"id": folder.get("id"), "name": folder.get("name")}, media


class DriveRangeReader:
    """Arquivo do Drive visto como stream "seekable": cada read() é um GET com Range.

    É o contrato que GraphAPI.upload_ad_video_chunked espera (seek + read do pedaço
    que a Meta pediu), então o vídeo vai Drive→Meta sem tocar o disco.
    """

    def __init__(self, client: _DriveClient, file_id: str, size: int):
        self._client = client
        self._file_id = file_id
        self._size = size
        self._pos = 0

    def seek(self, offset: int, whence: int = 0) -> int:
        self._pos = offset if whence == 0 else (self._pos + offset if whence == 1 else self._size + offset)
        return self._pos

    def tell(self) -> int:
        return self._pos

    def read(self, n: int = -1) -> bytes:
        if self._pos >= self._size:
            return b""
        end = self._size - 1 if n is None or n < 0 else min(self._pos + n, self._size) - 1
        resp = self._client.request(
            f"files/{self._file_id}",
            params={**_common_params(), "alt": "media"},
            headers={"Range": f"bytes={self._pos}-{end}"},
            timeout=180,
        )
        if resp.status_code not in (200, 206):
            raise DriveError("drive_download_failed", f"Falha ao baixar do Drive ({resp.status_code}).", 502)
        data = resp.content
        self._pos += len(data)
        return data

    def close(self) -> None:
        return None


def _import_one(client: _DriveClient, sb, api: GraphAPI, row: Dict[str, Any],
                on_check_cancel: Optional[Callable[[], None]] = None) -> None:
    file_id = str(row.get("drive_file_id") or "")
    size = int(row.get("size_bytes") or 0)
    reader = DriveRangeReader(client, file_id, size)
    if row.get("media_type") == "image":
        content = reader.read(-1)
        ad_media_library.store_image(sb, api, row, content)
        return
    ad_media_library.upload_video_stream(sb, api, row, reader, on_check_cancel=on_check_cancel)


def import_in_background(*, user_jwt: str, user_id: str, api: GraphAPI, rows: List[Dict[str, Any]]) -> None:
    """Importa em sequência numa thread (a Meta é o gargalo; paralelo só disputaria banda)."""

    def _run() -> None:
        sb = get_supabase_service()
        # Service role (jwt None, escopo por user_id): o JWT da requisição vence em ~1 h e a
        # importação de vídeo grande passa disso — o refresh do token do Google cairia junto.
        client = _DriveClient(None, user_id)
        for row in rows:
            try:
                ad_media_library.update_media(sb, str(row["id"]), {"status": "uploading", "bytes_sent": 0})
                _import_one(client, sb, api, row)
            except DriveError as exc:
                ad_media_library.mark_error(sb, str(row["id"]), exc.message)
            except Exception as exc:  # noqa: BLE001 — uma mídia ruim não derruba as outras
                logger.exception("[DRIVE_IMPORT] failed media_id=%s", row.get("id"))
                ad_media_library.mark_error(sb, str(row["id"]), f"Falha ao importar do Drive: {exc}")

    threading.Thread(target=_run, daemon=True, name="drive-import").start()
