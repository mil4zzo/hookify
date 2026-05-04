from __future__ import annotations

import hashlib
import logging
import threading
import time
from typing import Dict, Optional, Tuple

import requests

from app.core.config import META_GRAPH_BASE_URL

logger = logging.getLogger(__name__)

# Cache em memória por usuário para Page Access Tokens obtidos via /me/accounts.
_cache_lock = threading.RLock()

# {user_id: (token_fingerprint, page_token_by_page_id, cache_expiry_epoch)}
_page_token_cache: Dict[str, Tuple[str, Dict[str, str], float]] = {}

# Side-channel name cache — populated on same /me/accounts fetch, no separate TTL needed
# {user_id: {page_id: page_name}}
_page_name_cache: Dict[str, Dict[str, str]] = {}

CACHE_TTL_SECONDS = 300
REQUEST_TIMEOUT_SECONDS = 15


def invalidate_page_token_cache(user_id: str) -> None:
    """Invalida o cache de page tokens para um usuário (ex.: ao reconectar/expirar token do Facebook)."""
    with _cache_lock:
        _page_token_cache.pop(user_id, None)
        _page_name_cache.pop(user_id, None)
    logger.info("[FB_PAGE_TOKEN] Cache invalidated for user %s...", user_id[:8])


def get_page_access_token_for_page_id(
    *,
    user_id: str,
    user_access_token: str,
    page_id: str,
    graph_base_url: str = META_GRAPH_BASE_URL,
    force_refresh: bool = False,
) -> Optional[str]:
    """
    Resolve page_id (actor_id) -> Page Access Token usando GET /me/accounts.
    Não persiste tokens; só cache em memória com TTL curto.
    """
    page_id = str(page_id or "").strip()
    if not page_id:
        return None

    token_fingerprint = _fingerprint_token(user_access_token)
    now = time.time()

    with _cache_lock:
        if not force_refresh and user_id in _page_token_cache:
            cached_fp, page_map, expiry = _page_token_cache[user_id]
            if now < expiry and cached_fp == token_fingerprint:
                result = page_map.get(page_id)
                logger.info(
                    "[FB_PAGE_TOKEN] Cache hit user=%s... page_id=%s: %s (cache has %d pages)",
                    user_id[:8], page_id, "found" if result else "NOT FOUND", len(page_map),
                )
                return result
            _page_token_cache.pop(user_id, None)

    try:
        page_map, name_map = _fetch_page_tokens_via_me_accounts(
            user_access_token=user_access_token,
            graph_base_url=graph_base_url,
        )
    except Exception as e:
        logger.warning("[FB_PAGE_TOKEN] Failed to fetch /me/accounts for user %s...: %s", user_id[:8], e)
        return None

    with _cache_lock:
        _page_token_cache[user_id] = (token_fingerprint, page_map, time.time() + CACHE_TTL_SECONDS)
        _page_name_cache[user_id] = name_map

    result = page_map.get(page_id)
    logger.info(
        "[FB_PAGE_TOKEN] Fetched %d pages via /me/accounts for user=%s... | page_id=%s: %s",
        len(page_map), user_id[:8], page_id, "found" if result else "NOT FOUND",
    )
    return result


def get_user_page_access_info(
    *,
    user_id: str,
    user_access_token: str,
    page_id: str,
    graph_base_url: str = META_GRAPH_BASE_URL,
) -> Tuple[bool, Optional[str]]:
    """Returns (is_administered, page_name).

    is_administered=True when the token user administers page_id via /me/accounts.
    page_name is the human-readable name if available, else None.
    """
    token = get_page_access_token_for_page_id(
        user_id=user_id,
        user_access_token=user_access_token,
        page_id=page_id,
        graph_base_url=graph_base_url,
    )
    is_administered = token is not None

    with _cache_lock:
        name_map = _page_name_cache.get(user_id) or {}
    page_name = name_map.get(page_id) or None

    return is_administered, page_name


def _fingerprint_token(token: str) -> str:
    return hashlib.sha256((token or "").encode("utf-8")).hexdigest()[:16]


def _fetch_page_tokens_via_me_accounts(
    *, user_access_token: str, graph_base_url: str
) -> Tuple[Dict[str, str], Dict[str, str]]:
    """
    Busca page access tokens via GET /me/accounts (endpoint oficial da Pages API).
    Retorna (token_map, name_map): {page_id: page_access_token}, {page_id: page_name}
    """
    if not user_access_token:
        raise ValueError("user_access_token is required")

    url = f"{graph_base_url.rstrip('/')}/me/accounts"
    params = {
        "access_token": user_access_token,
        "fields": "id,name,access_token",
        "limit": 200,
    }

    token_map: Dict[str, str] = {}
    name_map: Dict[str, str] = {}

    resp = requests.get(url, params=params, timeout=REQUEST_TIMEOUT_SECONDS)
    resp.raise_for_status()
    payload = resp.json() or {}
    _collect_pages(payload.get("data") or [], token_map, name_map)

    next_url = (payload.get("paging") or {}).get("next")
    while next_url:
        next_resp = requests.get(next_url, timeout=REQUEST_TIMEOUT_SECONDS)
        next_resp.raise_for_status()
        next_payload = next_resp.json() or {}
        _collect_pages(next_payload.get("data") or [], token_map, name_map)
        next_url = (next_payload.get("paging") or {}).get("next")

    return token_map, name_map


def _collect_pages(data: list, out_tokens: Dict[str, str], out_names: Dict[str, str]) -> None:
    for page in data:
        if not isinstance(page, dict):
            continue
        page_id = str(page.get("id") or "").strip()
        token = str(page.get("access_token") or "").strip()
        name = str(page.get("name") or "").strip()
        if page_id and token:
            out_tokens[page_id] = token
        if page_id and name:
            out_names[page_id] = name
