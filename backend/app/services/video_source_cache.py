"""
Resolução de URL de vídeo (source CDN da Meta) com cache no banco.

A URL devolvida por GET /{video_id}?fields=source é assinada e expira (o expiry
vem no parâmetro oe= da própria URL, em hex). Este módulo centraliza a política:

1. Se o chamador tem uma URL cacheada (ads.video_source_url) com margem de
   validade suficiente → usa, zero chamadas à Meta.
2. Senão → resolve fresco via GraphAPI.get_video_source_url, extrai o expiry
   real da URL e regrava o cache (write-back por primary_video_id, para que
   todos os ads que compartilham o criativo herdem a URL numa tacada só).

Margens por consumidor (min_ttl_seconds): transcrição baixa o vídeo na hora
(1h basta); export gera planilha consumida depois (12h garante links úteis).
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from app.services.graph_api import GraphAPI
from app.services import supabase_repo

logger = logging.getLogger(__name__)

# Margens mínimas de validade restante para servir do cache
TRANSCRIPTION_MIN_TTL_S = 1 * 3600
MODAL_MIN_TTL_S = 1 * 3600
EXPORT_MIN_TTL_S = 12 * 3600

# Quando a URL não traz oe= parseável, assumir validade conservadora
FALLBACK_TTL_S = 4 * 3600

_OE_PARAM_RE = re.compile(r"[?&]oe=([0-9a-fA-F]+)")
_STATUS_CODE_RE = re.compile(r"(\d{3})")


def _is_transient_error_status(status_str: str) -> bool:
    """Classifica o erro da GraphAPI como transitório (vale retry) ou permanente.

    O dict de erro de get_video_source_url traz o HTTP code em "status"
    ("Status: 429 - http_error"). 4xx de permissão/validação é permanente;
    408/429/5xx é transitório. Sem code parseável (exceção genérica, geralmente
    rede) → transitório, EXCETO o "not_found" explícito (vídeo sem source)."""
    status_str = str(status_str or "")
    if status_str == "not_found":
        return False
    match = _STATUS_CODE_RE.search(status_str)
    if not match:
        return True
    code = int(match.group(1))
    return code in (408, 429) or code >= 500


def parse_meta_url_expiry(url: str) -> Optional[datetime]:
    """Extrai o expiry (parâmetro oe=, unix timestamp em hex) de uma URL de CDN da Meta.

    Retorna None se ausente ou implausível (proteção contra mudança de formato)."""
    match = _OE_PARAM_RE.search(url or "")
    if not match:
        return None
    try:
        ts = int(match.group(1), 16)
    except ValueError:
        return None
    expiry = datetime.fromtimestamp(ts, tz=timezone.utc)
    now = datetime.now(timezone.utc)
    # Plausível: entre agora e 30 dias no futuro
    if expiry <= now or expiry > now + timedelta(days=30):
        return None
    return expiry


def _parse_iso(value: Any) -> Optional[datetime]:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except ValueError:
        return None


def resolve_video_source_cached(
    api: GraphAPI,
    *,
    user_jwt: str,
    user_id: str,
    ad_id: str = "",
    video_id: str = "",
    actor_id: str = "",
    ig_media_id: str = "",
    video_owner_page_id: str = "",
    cached_url: Optional[str] = None,
    cached_expires_at: Any = None,
    min_ttl_seconds: int = TRANSCRIPTION_MIN_TTL_S,
) -> Dict[str, Any]:
    """Resolve a URL reproduzível do vídeo, preferindo o cache do banco.

    Retorna {"url", "expires_at" (datetime), "from_cache", "video_owner_page_id"?}
    em sucesso, ou {"error": mensagem} em falha (mensagem amigável da GraphAPI).
    """
    now = datetime.now(timezone.utc)

    cached_expiry = _parse_iso(cached_expires_at)
    if cached_url and cached_expiry and (cached_expiry - now).total_seconds() > min_ttl_seconds:
        return {"url": cached_url, "expires_at": cached_expiry, "from_cache": True}

    try:
        result = api.get_video_source_url(
            video_id or None,
            actor_id,
            video_owner_page_id=video_owner_page_id or None,
            ig_media_id=ig_media_id or None,
        )
    except Exception as e:
        logger.warning(f"[VIDEO_SOURCE_CACHE] Erro ao resolver vídeo {video_id or ig_media_id}: {e}")
        return {"error": str(e), "transient": True}

    source: Optional[str] = None
    resolved_owner: Optional[str] = None
    if isinstance(result, dict):
        source = result.get("source")
        resolved_owner = result.get("video_owner_page_id")
    elif isinstance(result, str):
        source = result

    if not (source and isinstance(source, str) and source.startswith("http")):
        message = result.get("message", "No video source returned") if isinstance(result, dict) else "No video source returned"
        status_str = result.get("status", "") if isinstance(result, dict) else ""
        return {"error": str(message), "transient": _is_transient_error_status(status_str)}

    expires_at = parse_meta_url_expiry(source) or (now + timedelta(seconds=FALLBACK_TTL_S))

    # Write-back best-effort — falha de persistência nunca bloqueia o consumidor
    if user_id and (video_id or ad_id):
        try:
            supabase_repo.update_ad_video_source(
                user_jwt=user_jwt,
                user_id=user_id,
                ad_id=ad_id,
                primary_video_id=video_id,
                url=source,
                expires_at_iso=expires_at.isoformat(),
                video_owner_page_id=(resolved_owner if resolved_owner and resolved_owner != video_owner_page_id else None),
            )
        except Exception as e:
            logger.warning(f"[VIDEO_SOURCE_CACHE] Falha no write-back (best-effort) video_id={video_id}: {e}")

    return {
        "url": source,
        "expires_at": expires_at,
        "from_cache": False,
        "video_owner_page_id": resolved_owner,
    }
