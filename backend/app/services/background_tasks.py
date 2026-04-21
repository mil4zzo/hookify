"""
Background tasks para packs: cache de thumbnails e cálculo de stats estendidos.

Status armazenado em memória (keyed por job_id) para polling em tempo real.
"""
from __future__ import annotations

import logging
import threading
import time
from typing import Any, Dict, Optional

from app.services import supabase_repo
from app.core.config import THUMB_CACHE_ENABLED, THUMB_CACHE_MIN_TTL_SECONDS
from app.services.thumbnail_cache import (
    cache_first_thumbs_for_ad_names,
    normalize_ad_name,
    select_representative_thumb_url,
    storage_thumb_exists,
)

logger = logging.getLogger(__name__)

CachedThumbReuseStatus = str

# Store em memória: { job_id: { thumbnails, thumbnails_error?, stats_extended, stats_extended_error?, _created_at } }
_background_status: Dict[str, Dict[str, Any]] = {}
_lock = threading.Lock()

_TTL_SECONDS = 600  # 10 minutos
_MAX_ENTRIES = 200


def _is_transient_bg_error(error: Exception) -> bool:
    text = str(error or "")
    markers = (
        "WinError 10035",
        "ReadError",
        "ConnectError",
        "Timeout",
        "temporarily unavailable",
        "connection reset",
    )
    return any(m in text for m in markers)


def _storage_thumb_exists_for_repair(storage_path: str) -> bool:
    return storage_thumb_exists(storage_path, raise_on_error=True)


def _classify_existing_cached_thumb(
    existing_cached: Any,
    *,
    pack_id: str,
    thumb_key: str,
    storage_exists=_storage_thumb_exists_for_repair,
) -> CachedThumbReuseStatus:
    storage_path = str(getattr(existing_cached, "storage_path", "") or "").strip()
    if not storage_path:
        return "missing_object"

    try:
        if storage_exists(storage_path):
            return "valid"
    except Exception as e:
        logger.warning(
            "[BACKGROUND_TASKS] Erro ao validar thumbnail cache pack=%s thumb_key=%s path=%s: %s",
            pack_id,
            thumb_key,
            storage_path,
            e,
        )
        return "validation_error"

    logger.warning(
        "[BACKGROUND_TASKS] Thumbnail cache aponta para objeto ausente pack=%s thumb_key=%s path=%s",
        pack_id,
        thumb_key,
        storage_path,
    )
    return "missing_object"


def _cleanup_stale_entries() -> None:
    """Remove entries mais antigas que _TTL_SECONDS. Deve ser chamada dentro do _lock."""
    if len(_background_status) <= _MAX_ENTRIES:
        return
    now = time.monotonic()
    stale = [
        jid for jid, s in _background_status.items()
        if now - s.get("_created_at", 0) > _TTL_SECONDS
    ]
    for jid in stale:
        del _background_status[jid]
    if stale:
        logger.debug(f"[BACKGROUND_TASKS] Cleanup: {len(stale)} entries removidas (TTL)")


def get_background_status(job_id: str) -> Optional[Dict[str, Any]]:
    """Retorna o status das tasks em background para um job (cópia defensiva)."""
    with _lock:
        entry = _background_status.get(job_id)
        if entry is None:
            return None
        copy = dict(entry)
        copy.pop("_created_at", None)
        return copy


def _set_status(job_id: str, **kwargs: Any) -> None:
    with _lock:
        if job_id not in _background_status:
            _background_status[job_id] = {
                "thumbnails": "pending",
                "stats_extended": "pending",
                "_created_at": time.monotonic(),
            }
            _cleanup_stale_entries()
        _background_status[job_id].update(kwargs)


def run_pack_background_tasks(
    job_id: str,
    pack_id: str,
    user_id: str,
    user_jwt: str,
    ad_name_groups: Dict[str, Dict[str, Any]],
    is_refresh: bool = False,
    *,
    use_service_role: bool = False,
) -> None:
    """
    Executa cache de thumbnails e cálculo de stats estendidos em background (paralelo).
    Atualiza status em memória para polling em tempo real.
    """
    from app.core.supabase_client import get_supabase_service

    _set_status(job_id, thumbnails="running", stats_extended="running")
    sb = get_supabase_service() if use_service_role else None

    def _run_thumbnails() -> None:
        try:
            if not THUMB_CACHE_ENABLED:
                logger.info(
                    "[BACKGROUND_TASKS] Thumbnail cache desativado por THUMB_CACHE_ENABLED=false (pack=%s)",
                    pack_id,
                )
                _set_status(job_id, thumbnails="completed")
                return

            ad_names_total = len(ad_name_groups)
            uploads_requested = 0  # ad_names novos enviados para cache
            uploads_succeeded = 0
            ads_updated = 0
            write_retries = 0
            write_failures = 0
            already_cached = 0
            reused_for_new_ad_ids = 0
            skipped_invalid_url = 0
            cache_validated = 0
            cache_missing_object = 0
            cache_validation_errors = 0
            recached_missing_object = 0

            if ad_name_groups:
                ad_name_list = [
                    str(group.get("ad_name") or "").strip()
                    for group in ad_name_groups.values()
                    if str(group.get("ad_name") or "").strip()
                ]
                existing_cache_by_key = supabase_repo.get_cached_thumbs_by_ad_names(
                    user_id=user_id,
                    ad_names=ad_name_list,
                )

                ad_id_to_cached: Dict[str, Any] = {}
                ad_name_to_thumb_url: Dict[str, str] = {}
                ad_name_to_ad_ids: Dict[str, list[str]] = {}

                for group in ad_name_groups.values():
                    ad_name = str(group.get("ad_name") or "").strip()
                    if not ad_name:
                        continue
                    thumb_key = str(group.get("thumb_key") or normalize_ad_name(ad_name))
                    ad_ids_raw = group.get("ad_ids") or []
                    if not isinstance(ad_ids_raw, list):
                        continue

                    ad_ids = sorted({str(ad_id).strip() for ad_id in ad_ids_raw if str(ad_id).strip()})
                    if not ad_ids:
                        continue

                    existing_cached = existing_cache_by_key.get(thumb_key)
                    if existing_cached:
                        cache_validated += 1
                        cache_status = _classify_existing_cached_thumb(
                            existing_cached,
                            pack_id=pack_id,
                            thumb_key=thumb_key,
                        )
                        if cache_status == "valid":
                            already_cached += 1
                            reused_for_new_ad_ids += len(ad_ids)
                            for ad_id in ad_ids:
                                ad_id_to_cached[ad_id] = existing_cached
                            continue
                        if cache_status == "validation_error":
                            cache_validation_errors += 1
                        else:
                            cache_missing_object += 1

                    # Política por fase:
                    # - criação inicial: cachear todos sem cache prévio
                    # - update: cachear somente ad_names sem cache prévio (mesma regra prática)
                    thumb_candidates = group.get("thumb_candidates") or []
                    if not isinstance(thumb_candidates, list):
                        thumb_candidates = []
                    thumb_url = select_representative_thumb_url(
                        thumb_candidates,
                        min_ttl_seconds=THUMB_CACHE_MIN_TTL_SECONDS,
                    )
                    if not thumb_url:
                        skipped_invalid_url += 1
                        continue

                    ad_name_to_thumb_url[ad_name] = thumb_url
                    ad_name_to_ad_ids[thumb_key] = ad_ids
                    if existing_cached:
                        recached_missing_object += 1

                uploads_requested = len(ad_name_to_thumb_url)

                cached_by_thumb_key = cache_first_thumbs_for_ad_names(
                    user_id=user_id,
                    ad_name_to_thumb_url=ad_name_to_thumb_url,
                )
                uploads_succeeded = len(cached_by_thumb_key)

                for thumb_key, cached_thumb in cached_by_thumb_key.items():
                    for ad_id in ad_name_to_ad_ids.get(thumb_key, []):
                        ad_id_to_cached[ad_id] = cached_thumb

                if ad_id_to_cached:
                    write_result = supabase_repo.update_ads_thumbnail_cache(
                        user_id=user_id,
                        ad_id_to_cached=ad_id_to_cached,
                    )
                    ads_updated = int(write_result.get("updated", 0))
                    write_retries = int(write_result.get("retries", 0))
                    write_failures = int(write_result.get("failed_batches", 0))

            logger.info(
                "[BACKGROUND_TASKS] Thumbnail cache summary pack=%s is_refresh=%s ad_names_total=%s "
                "already_cached=%s uploads_requested=%s new_cached=%s reused_for_new_ad_ids=%s "
                "skipped_invalid_url=%s ads_updated=%s write_retries=%s write_failures=%s "
                "cache_validated=%s cache_missing_object=%s cache_validation_errors=%s recached_missing_object=%s",
                pack_id,
                is_refresh,
                ad_names_total,
                already_cached,
                uploads_requested,
                uploads_succeeded,
                reused_for_new_ad_ids,
                skipped_invalid_url,
                ads_updated,
                write_retries,
                write_failures,
                cache_validated,
                cache_missing_object,
                cache_validation_errors,
                recached_missing_object,
            )
            _set_status(job_id, thumbnails="completed")
        except Exception as e:
            logger.exception(f"[BACKGROUND_TASKS] Falha ao cachear thumbnails para pack {pack_id}: {e}")
            _set_status(job_id, thumbnails="failed", thumbnails_error=str(e))

    _run_thumbnails()


def spawn_pack_background_tasks(
    job_id: str,
    pack_id: str,
    user_id: str,
    user_jwt: str,
    ad_name_groups: Dict[str, Dict[str, Any]],
    is_refresh: bool = False,
    *,
    use_service_role: bool = False,
) -> None:
    """Spawna run_pack_background_tasks em thread daemon (não bloqueia shutdown)."""
    _set_status(job_id, thumbnails="pending")

    def _run():
        run_pack_background_tasks(
            job_id, pack_id, user_id, user_jwt, ad_name_groups,
            is_refresh=is_refresh,
            use_service_role=use_service_role,
        )

    thread = threading.Thread(target=_run, daemon=True)
    thread.start()
    logger.info(f"[BACKGROUND_TASKS] Thread iniciada para job {job_id}, pack {pack_id}")
