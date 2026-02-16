from __future__ import annotations

import hashlib
import logging
import threading
import time
from typing import Any, Dict, Optional, Tuple

import requests

from app.core.config import META_GRAPH_BASE_URL

logger = logging.getLogger(__name__)

# Cache em memória por usuário para Page Access Tokens obtidos via /me/adaccounts?fields=...promote_pages{access_token}
# Objetivo: evitar chamadas repetidas (e caras) para resolver actor_id -> page_access_token na busca de Video.source.

_cache_lock = threading.RLock()

# {user_id: (token_fingerprint, page_token_by_page_id, cache_expiry_epoch)}
_page_token_cache: Dict[str, Tuple[str, Dict[str, str], float]] = {}

# Circuit breaker simples por usuário (evita martelar a API em falhas consecutivas)
_failed_users: Dict[str, float] = {}

# Configurações
CACHE_TTL_SECONDS = 300  # 5 minutos
CIRCUIT_BREAKER_TTL_SECONDS = 60  # 1 minuto
REQUEST_TIMEOUT_SECONDS = 15
MAX_GRAPH_REQUESTS_PER_REFRESH = 30  # guarda contra loops/paginação excessiva


def invalidate_page_token_cache(user_id: str) -> None:
    """Invalida o cache de page tokens para um usuário (ex.: ao reconectar/expirar token do Facebook)."""
    with _cache_lock:
        _page_token_cache.pop(user_id, None)
        _failed_users.pop(user_id, None)
    logger.debug("[FB_PAGE_TOKEN] Cache invalidated for user %s...", user_id[:8])


def get_page_access_token_for_page_id(
    *,
    user_id: str,
    user_access_token: str,
    page_id: str,
    graph_base_url: str = META_GRAPH_BASE_URL,
    force_refresh: bool = False,
) -> Optional[str]:
    """
    Resolve page_id (actor_id) -> Page Access Token usando /me/adaccounts com promote_pages{access_token}.

    Importante:
    - Não persiste tokens; só cache em memória com TTL curto.
    - Deve ser chamado apenas no backend.
    """
    page_id = str(page_id or "").strip()
    if not page_id:
        return None

    token_fingerprint = _fingerprint_token(user_access_token)
    now = time.time()

    with _cache_lock:
        if user_id in _failed_users:
            failure_time = _failed_users[user_id]
            if now - failure_time < CIRCUIT_BREAKER_TTL_SECONDS:
                logger.debug("[FB_PAGE_TOKEN] Circuit breaker active for user %s...", user_id[:8])
                return None
            _failed_users.pop(user_id, None)

        if not force_refresh and user_id in _page_token_cache:
            cached_fp, page_map, expiry = _page_token_cache[user_id]
            if now < expiry and cached_fp == token_fingerprint:
                return page_map.get(page_id)
            # cache expirado ou token mudou
            _page_token_cache.pop(user_id, None)

    # Carregar fora do lock (não bloquear outras threads enquanto chama a API)
    try:
        page_map = _fetch_page_tokens_via_adaccounts(
            user_access_token=user_access_token,
            graph_base_url=graph_base_url,
        )
    except Exception as e:
        with _cache_lock:
            _failed_users[user_id] = time.time()
        logger.warning("[FB_PAGE_TOKEN] Failed to refresh page tokens for user %s...: %s", user_id[:8], e)
        return None

    with _cache_lock:
        _page_token_cache[user_id] = (token_fingerprint, page_map, time.time() + CACHE_TTL_SECONDS)
        _failed_users.pop(user_id, None)

    return page_map.get(page_id)


def _fingerprint_token(token: str) -> str:
    # Evita armazenar/usar o token como chave direta; fingerprint reduz risco de logs acidentais.
    return hashlib.sha256((token or "").encode("utf-8")).hexdigest()[:16]


def _fetch_page_tokens_via_adaccounts(*, user_access_token: str, graph_base_url: str) -> Dict[str, str]:
    """
    Busca todas as pages disponíveis em promote_pages (com access_token) via /me/adaccounts.
    Retorna dict: {page_id: page_access_token}
    """
    if not user_access_token:
        raise ValueError("user_access_token is required")

    # Campos pedidos pelo usuário + access_token para o fluxo do vídeo
    fields = "id,account_id,business_name,name,promote_pages{id,name,access_token}"

    url = f"{graph_base_url.rstrip('/')}/me/adaccounts"
    params = {
        "access_token": user_access_token,
        "fields": fields,
        "limit": 200,
    }

    page_token_by_page_id: Dict[str, str] = {}
    requests_used = 0

    resp = requests.get(url, params=params, timeout=REQUEST_TIMEOUT_SECONDS)
    requests_used += 1
    resp.raise_for_status()
    payload = resp.json() or {}

    adaccounts = payload.get("data") or []
    requests_used = _merge_promote_pages_into_map(adaccounts, page_token_by_page_id, requests_used)

    next_url = (payload.get("paging") or {}).get("next")
    while next_url and requests_used < MAX_GRAPH_REQUESTS_PER_REFRESH:
        next_resp = requests.get(next_url, timeout=REQUEST_TIMEOUT_SECONDS)
        requests_used += 1
        next_resp.raise_for_status()
        next_payload = next_resp.json() or {}
        requests_used = _merge_promote_pages_into_map(next_payload.get("data") or [], page_token_by_page_id, requests_used)
        next_url = (next_payload.get("paging") or {}).get("next")

    if next_url:
        logger.warning(
            "[FB_PAGE_TOKEN] Pagination truncated (too many requests). Collected %d pages.",
            len(page_token_by_page_id),
        )

    return page_token_by_page_id


def _merge_promote_pages_into_map(adaccounts: Any, out: Dict[str, str], requests_used: int) -> int:
    if not isinstance(adaccounts, list):
        return requests_used

    for acc in adaccounts:
        if not isinstance(acc, dict):
            continue
        promote_pages = acc.get("promote_pages")
        requests_used = _collect_pages_from_promote_pages_node(promote_pages, out, requests_used)

    return requests_used


def _collect_pages_from_promote_pages_node(node: Any, out: Dict[str, str], requests_used: int) -> int:
    # Suporta:
    # - dict: {data:[{id,access_token},...], paging:{next:...}}
    # - list: [{id,access_token}, ...]
    if node is None:
        return requests_used

    if isinstance(node, list):
        for p in node:
            _upsert_page_token(p, out)
        return requests_used

    if not isinstance(node, dict):
        return requests_used

    data = node.get("data")
    if isinstance(data, list):
        for p in data:
            _upsert_page_token(p, out)

    # Paginação interna de promote_pages, se existir.
    next_url = (node.get("paging") or {}).get("next")
    while next_url and requests_used < MAX_GRAPH_REQUESTS_PER_REFRESH:
        next_resp = requests.get(next_url, timeout=REQUEST_TIMEOUT_SECONDS)
        requests_used += 1
        next_resp.raise_for_status()
        next_payload = next_resp.json() or {}
        next_data = next_payload.get("data")
        if isinstance(next_data, list):
            for p in next_data:
                _upsert_page_token(p, out)
        next_url = (next_payload.get("paging") or {}).get("next")

    if next_url:
        logger.warning(
            "[FB_PAGE_TOKEN] promote_pages pagination truncated. Collected %d pages so far.",
            len(out),
        )

    return requests_used


def _upsert_page_token(page_obj: Any, out: Dict[str, str]) -> None:
    if not isinstance(page_obj, dict):
        return
    page_id = str(page_obj.get("id") or "").strip()
    token = str(page_obj.get("access_token") or "").strip()
    if page_id and token:
        out[page_id] = token


