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
from typing import Any, Dict, List, Optional

from app.services.job_tracker import (
    STATUS_COMPLETED,
    STATUS_FAILED,
    STATUS_PROCESSING,
    get_job_tracker,
)
from app.services.graph_api import GraphAPI
from app.services.transcription_service import transcribe_video
from app.services import supabase_repo

logger = logging.getLogger(__name__)


def _extract_video_info(
    formatted_ads: List[Dict[str, Any]],
) -> Dict[str, Dict[str, str]]:
    """Extrai mapa ad_name -> {video_id, actor_id} (primeiro encontrado com vídeo).

    video_id vem de: creative.video_id, creative_video_id (nível do ad) ou
    adcreatives_videos_ids[0] (vídeo em asset_feed_spec quando creative não tem video_id).
    """
    result: Dict[str, Dict[str, str]] = {}

    for ad in formatted_ads:
        ad_name = str(ad.get("ad_name") or "").strip()
        if not ad_name or ad_name in result:
            continue

        creative = ad.get("creative") or {}
        video_id = str(creative.get("video_id") or "").strip()
        actor_id = str(creative.get("actor_id") or "").strip()

        if not video_id:
            video_id = str(ad.get("creative_video_id") or "").strip()
        if not video_id:
            ids = ad.get("adcreatives_videos_ids") or []
            if ids and len(ids) > 0:
                video_id = str(ids[0] or "").strip()

        if video_id and actor_id:
            result[ad_name] = {"video_id": video_id, "actor_id": actor_id}

    return result


def count_pending_transcriptions(
    *,
    user_jwt: str,
    user_id: str,
    formatted_ads: List[Dict[str, Any]],
) -> int:
    """Conta quantos ad_names ainda não possuem transcrição (skip_if_exists)."""
    video_map = _extract_video_info(formatted_ads)
    if not video_map:
        return 0

    ad_names = list(video_map.keys())
    existing = supabase_repo.get_existing_transcriptions(user_jwt, user_id, ad_names)
    pending = [name for name in ad_names if name not in existing]
    return len(pending)


def _resolve_video_url(api: GraphAPI, video_id: str, actor_id: str) -> Optional[str]:
    """Resolve URL do vídeo via Meta Graph API. Retorna None se falhar."""
    try:
        result = api.get_video_source_url(video_id, actor_id)
        if isinstance(result, str) and result.startswith("http"):
            return result
        if isinstance(result, dict):
            logger.warning(
                f"[TRANSCRIPTION] get_video_source_url retornou erro: {result.get('message', result)}"
            )
        return None
    except Exception as e:
        logger.warning(f"[TRANSCRIPTION] Erro ao resolver vídeo {video_id}: {e}")
        return None


def _transcribe_single(
    user_jwt: str,
    user_id: str,
    ad_name: str,
    video_url: str,
    video_id: str,
    actor_id: str,
) -> None:
    """Transcreve um único vídeo e persiste o resultado."""
    supabase_repo.upsert_transcription(
        user_jwt, user_id, ad_name, status="processing"
    )

    result = transcribe_video(video_url)

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
    else:
        metadata = {
            "provider": "assemblyai",
            "source_video_id": video_id,
            "actor_id": actor_id,
            "error_message": result.error,
        }
        supabase_repo.upsert_transcription(
            user_jwt,
            user_id,
            ad_name,
            status="failed",
            metadata=metadata,
        )


def run_transcription_batch(
    user_jwt: str,
    user_id: str,
    access_token: str,
    formatted_ads: List[Dict[str, Any]],
    transcription_job_id: Optional[str] = None,
) -> None:
    """Processa transcrições em batch (sequencial, best-effort, skip_if_exists)."""
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
            extras={"success_count": 0, "fail_count": 0},
        )
        return

    ad_names = list(video_map.keys())
    existing = supabase_repo.get_existing_transcriptions(user_jwt, user_id, ad_names)

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
            extras={"success_count": 0, "fail_count": 0, "skipped_existing": len(existing)},
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

    api = GraphAPI(access_token, user_id=user_id)
    success_count = 0
    fail_count = 0
    processed = 0

    for ad_name in pending:
        info = video_map[ad_name]
        video_id = info["video_id"]
        actor_id = info["actor_id"]

        try:
            video_url = _resolve_video_url(api, video_id, actor_id)
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
                        "error_message": "Não foi possível obter URL do vídeo via Meta API",
                    },
                )
                fail_count += 1
                processed += 1
                _heartbeat(
                    status=STATUS_PROCESSING,
                    done=processed,
                    total=total,
                    message=f"Transcrevendo {processed} de {total}",
                    extras={"success_count": success_count, "fail_count": fail_count},
                )
                continue

            _transcribe_single(user_jwt, user_id, ad_name, video_url, video_id, actor_id)
            success_count += 1
            processed += 1
            _heartbeat(
                status=STATUS_PROCESSING,
                done=processed,
                total=total,
                message=f"Transcrevendo {processed} de {total}",
                extras={"success_count": success_count, "fail_count": fail_count},
            )
        except Exception as e:
            logger.warning(f"[TRANSCRIPTION] Erro ao transcrever ad_name={ad_name!r}: {e}")
            try:
                supabase_repo.upsert_transcription(
                    user_jwt,
                    user_id,
                    ad_name,
                    status="failed",
                    metadata={
                        "provider": "assemblyai",
                        "source_video_id": video_id,
                        "actor_id": actor_id,
                        "error_message": str(e),
                    },
                )
            except Exception:
                pass
            fail_count += 1
            processed += 1
            _heartbeat(
                status=STATUS_PROCESSING,
                done=processed,
                total=total,
                message=f"Transcrevendo {processed} de {total}",
                extras={"success_count": success_count, "fail_count": fail_count},
            )

    final_status = STATUS_COMPLETED if success_count > 0 else STATUS_FAILED
    final_message = (
        f"Transcrição concluída: {success_count} sucesso(s), {fail_count} falha(s)"
        if final_status == STATUS_COMPLETED
        else f"Transcrição falhou: {fail_count} falha(s)"
    )
    _heartbeat(
        status=final_status,
        done=processed,
        total=total,
        message=final_message,
        extras={"success_count": success_count, "fail_count": fail_count},
    )
    logger.info(
        f"[TRANSCRIPTION] Batch concluído: {success_count} ok, {fail_count} falhas, "
        f"{len(existing)} já existentes"
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
    video_url = _resolve_video_url(api, video_id, actor_id)

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

    _transcribe_single(user_jwt, user_id, ad_name, video_url, video_id, actor_id)
