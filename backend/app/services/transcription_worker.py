"""
Worker de transcrição em batch para vídeos de anúncios.

Responsável por:
- Deduplicar ads por ad_name
- Consultar transcrições existentes (skip_if_exists)
- Resolver URL do vídeo via Meta Graph API
- Chamar transcription_service e persistir resultado
"""
from __future__ import annotations

import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable, Dict, List, Optional

from app.core.config import TRANSCRIPTION_CONCURRENCY
from app.services.job_tracker import (
    STATUS_CANCELLED,
    STATUS_COMPLETED,
    STATUS_FAILED,
    STATUS_PROCESSING,
    get_job_tracker,
)
from app.services.supabase_repo import is_no_audio_error_message
from app.services.graph_api import GraphAPI
from app.services.transcription_service import TranscriptionResult, transcribe_video
from app.services import supabase_repo
from app.services.video_source_cache import TRANSCRIPTION_MIN_TTL_S, resolve_video_source_cached

logger = logging.getLogger(__name__)


def _extract_video_info(
    formatted_ads: List[Dict[str, Any]],
) -> Dict[str, Dict[str, str]]:
    """Extrai mapa ad_name -> {video_id, actor_id, ig_media_id} (primeiro com vídeo).

    Fonte da mídia para transcrever: primary_video_id (clássico/multi-asset) OU
    effective_instagram_media_id (SHARE single-asset, sem video_id) — em ambos a
    URL reproduzível é resolvida por get_video_source_url.
    """
    result: Dict[str, Dict[str, str]] = {}

    for ad in formatted_ads:
        ad_name = str(ad.get("ad_name") or "").strip()
        if not ad_name or ad_name in result:
            continue

        creative = ad.get("creative") or {}
        video_id = str(ad.get("primary_video_id") or "").strip()
        ig_media_id = str(creative.get("effective_instagram_media_id") or "").strip()
        actor_id = str(creative.get("actor_id") or "").strip()
        media_type = str(ad.get("media_type") or "").strip().lower()

        is_video = media_type == "video" or (media_type not in ("image",) and bool(video_id))
        # SHARE single-asset (vídeo): sem video_id, mas a mídia vem do igm.
        if is_video and (video_id or ig_media_id):
            result[ad_name] = {
                "video_id": video_id,
                "actor_id": actor_id,
                "ig_media_id": ig_media_id,
                "ad_id": str(ad.get("ad_id") or "").strip(),
                "video_owner_page_id": str(ad.get("video_owner_page_id") or "").strip(),
            }

    return result


def count_pending_transcriptions(
    *,
    user_jwt: str,
    user_id: str,
    formatted_ads: List[Dict[str, Any]],
    force_no_audio: bool = False,
) -> int:
    """Conta quantos ad_names ainda não possuem transcrição (skip_if_exists)."""
    video_map = _extract_video_info(formatted_ads)
    if not video_map:
        return 0

    ad_names = list(video_map.keys())
    existing = supabase_repo.get_existing_transcriptions(
        user_jwt, user_id, ad_names, include_no_audio_failed=not force_no_audio
    )
    pending = [name for name in ad_names if name not in existing]
    return len(pending)


def _resolve_video_url(
    api: GraphAPI,
    user_jwt: str,
    user_id: str,
    video_id: str,
    actor_id: str,
    ig_media_id: str = "",
    *,
    ad_id: str = "",
    video_owner_page_id: str = "",
    cached_url: Optional[str] = None,
    cached_expires_at: Optional[str] = None,
) -> Optional[str]:
    """Resolve URL do vídeo (cache do banco → Meta Graph API). Retorna None se falhar.

    Aceita ig_media_id como fonte para SHARE single-asset (sem video_id)."""
    result = resolve_video_source_cached(
        api,
        user_jwt=user_jwt,
        user_id=user_id,
        ad_id=ad_id,
        video_id=video_id,
        actor_id=actor_id,
        ig_media_id=ig_media_id,
        video_owner_page_id=video_owner_page_id,
        cached_url=cached_url,
        cached_expires_at=cached_expires_at,
        min_ttl_seconds=TRANSCRIPTION_MIN_TTL_S,
    )
    if result.get("error"):
        logger.warning(f"[TRANSCRIPTION] Falha ao resolver vídeo {video_id or ig_media_id}: {result['error']}")
        return None
    return result.get("url")


def _build_video_source_cache_map(
    user_jwt: str, user_id: str, ad_names: List[str], video_map: Dict[str, Dict[str, str]]
) -> Dict[str, Dict[str, Any]]:
    """Mapa ad_name -> {url, expires_at} do cache em ads (migration 097).

    Só aceita a linha cujo primary_video_id bate com o vídeo escolhido para o
    ad_name — evita usar URL cacheada de um vídeo diferente sob o mesmo nome."""
    try:
        rows = supabase_repo.get_ads_video_fields_by_names(user_jwt, user_id, ad_names)
    except Exception as e:
        logger.warning(f"[TRANSCRIPTION] Falha ao ler cache de video_source (best-effort): {e}")
        return {}

    cache: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        ad_name = str(row.get("ad_name") or "").strip()
        info = video_map.get(ad_name)
        url = row.get("video_source_url")
        if not info or not url or ad_name in cache:
            continue
        row_video_id = str(row.get("primary_video_id") or "").strip()
        if info["video_id"] and row_video_id != info["video_id"]:
            continue
        cache[ad_name] = {"url": url, "expires_at": row.get("video_source_expires_at")}
    return cache


def _transcribe_single(
    user_jwt: str,
    user_id: str,
    ad_name: str,
    video_url: str,
    video_id: str,
    actor_id: str,
    check_cancelled: Callable[[], bool],
) -> TranscriptionResult:
    """Transcreve um único vídeo e persiste o resultado."""
    supabase_repo.upsert_transcription(
        user_jwt, user_id, ad_name, status="processing"
    )

    result = transcribe_video(video_url, check_cancelled=check_cancelled)

    if result.success:
        metadata = {
            "language_code": result.language_code,
            "audio_duration_seconds": result.audio_duration_seconds,
            "provider": "assemblyai",
            "assemblyai_transcript_id": result.assemblyai_id,
            "source_video_id": video_id,
            "actor_id": actor_id,
        }
        supabase_repo.upsert_transcription(
            user_jwt,
            user_id,
            ad_name,
            status="completed",
            full_text=result.full_text,
            timestamped_text=result.timestamped_words,
            metadata=metadata,
        )
        return result

    error_message = result.error or "Transcrição cancelada pelo usuário"
    metadata = {
        "provider": "assemblyai",
        "source_video_id": video_id,
        "actor_id": actor_id,
        "error_message": error_message,
    }
    if is_no_audio_error_message(result.error):
        metadata["no_voice_detected"] = True
    supabase_repo.upsert_transcription(
        user_jwt,
        user_id,
        ad_name,
        status="failed",
        metadata=metadata,
    )
    return result


def run_transcription_batch(
    user_jwt: str,
    user_id: str,
    access_token: str,
    formatted_ads: List[Dict[str, Any]],
    transcription_job_id: Optional[str] = None,
    force_no_audio: bool = False,
) -> None:
    """Processa transcrições em batch (paralelo, best-effort, skip_if_exists).

    force_no_audio=True retenta também ads com falha permanente de sem-áudio
    (escape para falsos positivos — ex.: Meta serviu rendition ruim do vídeo).
    """
    tracker = get_job_tracker(user_jwt, user_id) if transcription_job_id else None

    def _heartbeat(
        *,
        status: str,
        done: int,
        total: int,
        message: str,
        extras: Optional[Dict[str, Any]] = None,
    ) -> None:
        if not tracker or not transcription_job_id:
            return
        details: Dict[str, Any] = {
            "stage": "transcription",
            "type": "transcription",
            "done": done,
            "total": total,
        }
        if extras:
            details.update(extras)
        progress = int((done / total) * 100) if total > 0 else 100
        tracker.heartbeat(
            transcription_job_id,
            status=status,
            progress=max(0, min(progress, 100)),
            message=message,
            details=details,
        )

    video_map = _extract_video_info(formatted_ads)
    if not video_map:
        logger.info("[TRANSCRIPTION] Nenhum ad com vídeo encontrado; pulando transcrição")
        _heartbeat(
            status=STATUS_COMPLETED,
            done=0,
            total=0,
            message="Nenhuma transcrição pendente",
            extras={
                "success_count": 0,
                "fail_count": 0,
                "no_audio_count": 0,
                "skipped_existing": 0,
                "completed_with_failures": False,
            },
        )
        return

    ad_names = list(video_map.keys())
    existing = supabase_repo.get_existing_transcriptions(
        user_jwt, user_id, ad_names, include_no_audio_failed=not force_no_audio
    )

    pending = [name for name in ad_names if name not in existing]
    if not pending:
        logger.info(
            f"[TRANSCRIPTION] Todos os {len(ad_names)} ad_names já possuem transcrição; pulando"
        )
        _heartbeat(
            status=STATUS_COMPLETED,
            done=0,
            total=0,
            message="Nenhuma transcrição pendente",
            extras={
                "success_count": 0,
                "fail_count": 0,
                "no_audio_count": 0,
                "skipped_existing": len(existing),
                "completed_with_failures": False,
            },
        )
        return

    logger.info(
        f"[TRANSCRIPTION] Iniciando batch: {len(pending)} pendentes de {len(ad_names)} com vídeo"
    )
    total = len(pending)
    _heartbeat(
        status=STATUS_PROCESSING,
        done=0,
        total=total,
        message=f"Transcrevendo 0 de {total}",
        extras={"skipped_existing": len(existing)},
    )

    # Cancelamento com cache (TTL curto): o polling do AssemblyAI checa a cada
    # 5s em até TRANSCRIPTION_CONCURRENCY threads — sem cache, viraria uma
    # rajada constante de SELECTs na tabela jobs.
    cancel_state = {"cancelled": False, "checked_at": 0.0}
    cancel_lock = threading.Lock()
    CANCEL_CHECK_TTL_S = 2.0

    def _check_if_cancelled() -> bool:
        """Verifica se o job foi cancelado pelo usuário (cacheado por TTL)."""
        if not tracker or not transcription_job_id:
            return False
        with cancel_lock:
            if cancel_state["cancelled"]:
                return True
            if time.monotonic() - cancel_state["checked_at"] < CANCEL_CHECK_TTL_S:
                return False
            cancel_state["checked_at"] = time.monotonic()
        try:
            job = tracker.get_job(transcription_job_id)
            is_cancelled = job is not None and job.get("status") == STATUS_CANCELLED
        except Exception as e:
            logger.warning(f"[TRANSCRIPTION] Erro ao verificar cancelamento do job {transcription_job_id}: {e}")
            return False
        if is_cancelled:
            with cancel_lock:
                cancel_state["cancelled"] = True
        return is_cancelled

    api = GraphAPI(access_token, user_id=user_id)
    # Cache de URLs já resolvidas (ads.video_source_url) — evita chamadas à Meta
    # para vídeos com URL ainda válida (ex.: re-transcrição, export recente).
    video_source_cache = _build_video_source_cache_map(user_jwt, user_id, pending, video_map)
    success_count = 0
    fail_count = 0  # apenas falhas reais (rede, Meta API, provider) — sem-áudio conta à parte
    no_audio_count = 0
    processed = 0
    last_error_message: Optional[str] = None
    counters_lock = threading.Lock()

    def _mark_job_cancelled() -> None:
        logger.info(
            f"[TRANSCRIPTION] Job {transcription_job_id} cancelado pelo usuário, interrompendo"
        )
        _heartbeat(
            status=STATUS_CANCELLED,
            done=processed,
            total=total,
            message="Transcrição cancelada pelo usuário",
            extras={
                "success_count": success_count,
                "fail_count": fail_count,
                "no_audio_count": no_audio_count,
                "cancelled": True,
            },
        )

    def _record_result(success: bool, error: Optional[str]) -> None:
        """Atualiza contadores e emite heartbeat. Heartbeat dentro do lock para
        garantir 'done' monotônico na UI (conclusões chegam fora de ordem)."""
        nonlocal success_count, fail_count, no_audio_count, processed, last_error_message
        with counters_lock:
            if success:
                success_count += 1
            elif is_no_audio_error_message(error):
                no_audio_count += 1
            else:
                fail_count += 1
                if error:
                    last_error_message = error
            processed += 1
            _heartbeat(
                status=STATUS_PROCESSING,
                done=processed,
                total=total,
                message=f"Transcrevendo {processed} de {total}",
                extras={
                    "success_count": success_count,
                    "fail_count": fail_count,
                    "no_audio_count": no_audio_count,
                },
            )

    def _fail_item(ad_name: str, video_id: str, actor_id: str, error_message: str) -> None:
        try:
            metadata: Dict[str, Any] = {
                "provider": "assemblyai",
                "source_video_id": video_id,
                "actor_id": actor_id,
                "error_message": error_message,
            }
            if is_no_audio_error_message(error_message):
                metadata["no_voice_detected"] = True
            supabase_repo.upsert_transcription(
                user_jwt,
                user_id,
                ad_name,
                status="failed",
                metadata=metadata,
            )
        except Exception:
            pass
        _record_result(success=False, error=error_message)

    def _process_one(ad_name: str) -> None:
        if _check_if_cancelled():
            return
        info = video_map[ad_name]
        video_id = info["video_id"]
        actor_id = info["actor_id"]
        ig_media_id = info.get("ig_media_id", "")

        try:
            cached = video_source_cache.get(ad_name) or {}
            video_url = _resolve_video_url(
                api,
                user_jwt,
                user_id,
                video_id,
                actor_id,
                ig_media_id,
                ad_id=info.get("ad_id", ""),
                video_owner_page_id=info.get("video_owner_page_id", ""),
                cached_url=cached.get("url"),
                cached_expires_at=cached.get("expires_at"),
            )
            if not video_url:
                _fail_item(ad_name, video_id, actor_id, "Não foi possível obter URL do vídeo via Meta API")
                return

            if _check_if_cancelled():
                return
            result = _transcribe_single(
                user_jwt,
                user_id,
                ad_name,
                video_url,
                video_id,
                actor_id,
                _check_if_cancelled,
            )
            if result.cancelled:
                return
            _record_result(success=result.success, error=result.error)
        except Exception as e:
            logger.warning(f"[TRANSCRIPTION] Erro ao transcrever ad_name={ad_name!r}: {e}")
            _fail_item(ad_name, video_id, actor_id, str(e))

    # Keepalive: prova de vida para o frontend mesmo sem conclusões (um vídeo
    # longo pode ficar minutos sem mudar done/total). O frontend só declara o
    # job morto quando este sinal para — nunca por relógio com o job vivo.
    keepalive_stop = threading.Event()

    def _keepalive_loop() -> None:
        while not keepalive_stop.wait(30):
            with counters_lock:
                _heartbeat(
                    status=STATUS_PROCESSING,
                    done=processed,
                    total=total,
                    message=f"Transcrevendo {processed} de {total}",
                    extras={
                        "success_count": success_count,
                        "fail_count": fail_count,
                        "no_audio_count": no_audio_count,
                        "keepalive_at": int(time.time()),
                    },
                )

    max_workers = min(TRANSCRIPTION_CONCURRENCY, total)
    logger.info(f"[TRANSCRIPTION] Processando com {max_workers} worker(s) em paralelo")
    keepalive_thread = threading.Thread(
        target=_keepalive_loop, name="transcription-keepalive", daemon=True
    )
    keepalive_thread.start()
    try:
        with ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="transcription") as pool:
            list(pool.map(_process_one, pending))
    finally:
        # Parar o keepalive ANTES do heartbeat final para não ressuscitar
        # status "processing" depois de completed/cancelled.
        keepalive_stop.set()
        keepalive_thread.join(timeout=5)

    if _check_if_cancelled():
        _mark_job_cancelled()
        return

    # Sem-áudio é constatação, não falha: só termina "failed" se houve erro real
    # sem nenhum sucesso. Batch 100% sem-áudio termina "completed".
    final_status = STATUS_COMPLETED if success_count > 0 or fail_count == 0 else STATUS_FAILED
    completed_with_failures = final_status == STATUS_COMPLETED and fail_count > 0
    if final_status == STATUS_COMPLETED:
        if completed_with_failures:
            final_message = (
                f"Transcrição concluída parcialmente: {success_count} sucesso(s), "
                f"{fail_count} falha(s)"
            )
        elif success_count == 0 and no_audio_count > 0:
            final_message = (
                f"Nenhum áudio para transcrever: {no_audio_count} "
                f"vídeo(s) sem áudio detectável"
            )
        else:
            final_message = f"Transcrição concluída com sucesso: {success_count} sucesso(s)"
    else:
        if last_error_message:
            final_message = (
                f"Transcrição falhou ({fail_count} de {total}): {last_error_message}"
            )
        else:
            final_message = f"Transcrição falhou: {fail_count} falha(s)"
    _heartbeat(
        status=final_status,
        done=processed,
        total=total,
        message=final_message,
        extras={
            "success_count": success_count,
            "fail_count": fail_count,
            "no_audio_count": no_audio_count,
            "skipped_existing": len(existing),
            "completed_with_failures": completed_with_failures,
            "last_error_message": last_error_message,
        },
    )
    logger.info(
        f"[TRANSCRIPTION] Batch concluído: {success_count} ok, {fail_count} falhas, "
        f"{no_audio_count} sem áudio, {len(existing)} já existentes"
    )


def retry_single_transcription(
    user_jwt: str,
    user_id: str,
    access_token: str,
    ad_name: str,
    video_id: str,
    actor_id: str,
) -> None:
    """Retry de transcrição individual (chamado pelo endpoint de retry)."""
    api = GraphAPI(access_token, user_id=user_id)
    # Retry não consulta cache: a tentativa anterior falhou, queremos URL fresca.
    video_url = _resolve_video_url(api, user_jwt, user_id, video_id, actor_id)

    if not video_url:
        supabase_repo.upsert_transcription(
            user_jwt,
            user_id,
            ad_name,
            status="failed",
            metadata={
                "provider": "assemblyai",
                "source_video_id": video_id,
                "actor_id": actor_id,
                "error_message": "Não foi possível obter URL do vídeo via Meta API (retry)",
            },
        )
        return

    _transcribe_single(
        user_jwt,
        user_id,
        ad_name,
        video_url,
        video_id,
        actor_id,
        lambda: False,
    )
