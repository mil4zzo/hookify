"""
Background tasks para packs: cache de thumbnails e cálculo de stats estendidos.

Status armazenado em memória (keyed por job_id) para polling em tempo real.
"""
from __future__ import annotations

import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, Optional

from app.services import supabase_repo
from app.services.thumbnail_cache import cache_first_thumbs_for_ads

logger = logging.getLogger(__name__)

# Store em memória: { job_id: { thumbnails, thumbnails_error?, stats_extended, stats_extended_error?, _created_at } }
_background_status: Dict[str, Dict[str, Any]] = {}
_lock = threading.Lock()

_TTL_SECONDS = 600  # 10 minutos
_MAX_ENTRIES = 200


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
            groups_total = len(ad_name_groups)
            uploads_requested = 0
            uploads_succeeded = 0
            ads_updated = 0
            groups_failed = 0

            if ad_name_groups:
                rep_ad_id_to_thumb_url: Dict[str, str] = {}
                rep_ad_id_to_ad_ids: Dict[str, list[str]] = {}

                for group in ad_name_groups.values():
                    rep_ad_id = str(group.get("rep_ad_id") or "").strip()
                    thumb_url = str(group.get("thumb_url") or "").strip()
                    ad_ids_raw = group.get("ad_ids") or []
                    if not rep_ad_id or not thumb_url or not isinstance(ad_ids_raw, list):
                        continue

                    ad_ids = sorted({str(ad_id).strip() for ad_id in ad_ids_raw if str(ad_id).strip()})
                    if not ad_ids:
                        continue

                    rep_ad_id_to_thumb_url[rep_ad_id] = thumb_url
                    rep_ad_id_to_ad_ids[rep_ad_id] = ad_ids

                uploads_requested = len(rep_ad_id_to_thumb_url)

                cached_by_rep_ad_id = cache_first_thumbs_for_ads(
                    user_id=user_id,
                    ad_id_to_thumb_url=rep_ad_id_to_thumb_url,
                )
                uploads_succeeded = len(cached_by_rep_ad_id)
                groups_failed = max(0, uploads_requested - uploads_succeeded)

                ad_id_to_cached = {}
                for rep_ad_id, cached_thumb in cached_by_rep_ad_id.items():
                    for ad_id in rep_ad_id_to_ad_ids.get(rep_ad_id, []):
                        ad_id_to_cached[ad_id] = cached_thumb

                if ad_id_to_cached:
                    supabase_repo.update_ads_thumbnail_cache(user_id=user_id, ad_id_to_cached=ad_id_to_cached)
                    ads_updated = len(ad_id_to_cached)

            logger.info(
                "[BACKGROUND_TASKS] Thumbnail cache summary pack=%s groups_total=%s uploads_requested=%s "
                "uploads_succeeded=%s groups_failed=%s ads_updated=%s",
                pack_id,
                groups_total,
                uploads_requested,
                uploads_succeeded,
                groups_failed,
                ads_updated,
            )
            _set_status(job_id, thumbnails="completed")
        except Exception as e:
            logger.exception(f"[BACKGROUND_TASKS] Falha ao cachear thumbnails para pack {pack_id}: {e}")
            _set_status(job_id, thumbnails="failed", thumbnails_error=str(e))

    def _run_stats_extended() -> None:
        try:
            stats = supabase_repo.calculate_pack_stats(
                user_jwt, pack_id, user_id, sb_client=sb
            )
            if stats and stats.get("totalSpend") is not None:
                supabase_repo.update_pack_stats(
                    user_jwt, pack_id, stats, user_id, sb_client=sb
                )
                logger.info(f"[BACKGROUND_TASKS] Stats estendidos salvos para pack {pack_id}")
            _set_status(job_id, stats_extended="completed")
        except Exception as e:
            logger.exception(f"[BACKGROUND_TASKS] Falha ao calcular stats para pack {pack_id}: {e}")
            _set_status(job_id, stats_extended="failed", stats_extended_error=str(e))

    with ThreadPoolExecutor(max_workers=2) as executor:
        thumb_future = executor.submit(_run_thumbnails)
        stats_future = executor.submit(_run_stats_extended)
        # Aguardar ambas terminarem (error handling já é interno a cada task)
        thumb_future.result()
        stats_future.result()


def spawn_pack_background_tasks(
    job_id: str,
    pack_id: str,
    user_id: str,
    user_jwt: str,
    ad_name_groups: Dict[str, Dict[str, Any]],
    *,
    use_service_role: bool = False,
) -> None:
    """Spawna run_pack_background_tasks em thread daemon (não bloqueia shutdown)."""
    _set_status(job_id, thumbnails="pending", stats_extended="pending")

    def _run():
        run_pack_background_tasks(
            job_id, pack_id, user_id, user_jwt, ad_name_groups,
            use_service_role=use_service_role,
        )

    thread = threading.Thread(target=_run, daemon=True)
    thread.start()
    logger.info(f"[BACKGROUND_TASKS] Thread iniciada para job {job_id}, pack {pack_id}")
