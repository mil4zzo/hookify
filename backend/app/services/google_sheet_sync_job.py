"""
Google Sheet Sync Job: Processa sincronizacao de planilhas Google em background.

Responsavel por:
- Ler dados da planilha Google Sheets
- Processar e validar dados
- Persistir no Supabase (ad_metrics enrichment)
- Atualizar progresso via JobTracker
"""
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional
from app.services.job_tracker import (
    JobTracker,
    get_job_tracker,
    STATUS_PROCESSING,
    STATUS_PERSISTING,
    STATUS_COMPLETED,
    STATUS_FAILED,
    STATUS_CANCELLED,
)
from app.services.ad_metrics_sheet_importer import run_ad_metrics_sheet_import, AdMetricsImportError, AdMetricsImportCancelled

logger = logging.getLogger(__name__)

# Estagios do sync
STAGE_READING = "lendo_planilha"
STAGE_PROCESSING = "processando_dados"
STAGE_PERSISTING = "persistindo"
STAGE_COMPLETE = "completo"


def _check_if_cancelled(tracker: JobTracker, job_id: str) -> bool:
    """Verifica se o job foi cancelado pelo usuario."""
    try:
        job = tracker.get_job(job_id)
        if job and job.get("status") == STATUS_CANCELLED:
            logger.info(f"[GoogleSheetSyncJob] Job {job_id} foi cancelado pelo usuario")
            return True
        return False
    except Exception as e:
        logger.warning(f"[GoogleSheetSyncJob] Erro ao verificar cancelamento do job {job_id}: {e}")
        return False


def _mark_integration_failed(user_jwt: str, user_id: str, integration_id: str) -> None:
    """Atualiza status da integracao para 'failed' (best-effort)."""
    try:
        from app.core.supabase_client import get_supabase_for_user

        sb = get_supabase_for_user(user_jwt)
        now_iso = datetime.now(timezone.utc).isoformat(timespec="seconds")
        sb.table("ad_sheet_integrations").update(
            {
                "last_synced_at": now_iso,
                "last_sync_status": "failed",
                "updated_at": now_iso,
            }
        ).eq("id", integration_id).eq("owner_id", user_id).execute()
    except Exception as update_error:
        logger.warning(
            "[GoogleSheetSyncJob] Falha ao atualizar status da integracao %s: %s",
            integration_id,
            update_error,
        )


def process_sync_job(
    user_jwt: str,
    user_id: str,
    job_id: str,
    integration_id: str,
) -> Dict[str, Any]:
    """
    Processa um job de sincronizacao de planilha Google em background.

    Args:
        user_jwt: JWT do Supabase
        user_id: ID do usuario
        job_id: ID do job
        integration_id: ID da integracao (ad_sheet_integrations)

    Returns:
        Dict com resultado do processamento
    """
    tracker = get_job_tracker(user_jwt, user_id)

    try:
        logger.info(f"[GoogleSheetSyncJob] Iniciando sync do job {job_id} para integracao {integration_id}")

        # Verificar cancelamento antes de iniciar
        if _check_if_cancelled(tracker, job_id):
            return {"success": False, "error": "Job cancelado pelo usuario", "cancelled": True}

        # Marcar como processando e delegar ao importador
        tracker.mark_processing(job_id, STAGE_READING, {"integration_id": integration_id})

        def _on_stage(stage: str) -> None:
            if stage == STAGE_PERSISTING:
                tracker.mark_persisting(job_id, {"integration_id": integration_id})
            else:
                tracker.mark_processing(job_id, stage, {"integration_id": integration_id})

        stats = run_ad_metrics_sheet_import(
            user_jwt=user_jwt,
            user_id=user_id,
            integration_id=integration_id,
            check_cancelled=lambda: _check_if_cancelled(tracker, job_id),
            on_stage_change=_on_stage,
        )

        # Conclusao
        result_count = stats.get("updated_rows", 0)
        tracker.mark_completed(job_id, pack_id="", result_count=result_count, details={
            "integration_id": integration_id,
            "rows_read": stats.get("processed_rows", 0),
            "rows_processed": stats.get("processed_rows", 0),
            "rows_updated": stats.get("updated_rows", 0),
            "rows_skipped": stats.get("skipped_invalid", 0) + stats.get("skipped_no_match", 0),
            "unique_ad_date_pairs": stats.get("unique_ad_date_pairs", 0),
            "total_update_queries": stats.get("total_update_queries", 0),
        })

        logger.info(f"[GoogleSheetSyncJob] Job {job_id} concluido. Atualizados: {result_count}")

        return {"success": True, "stats": stats, "result_count": result_count}

    except AdMetricsImportCancelled:
        logger.info(f"[GoogleSheetSyncJob] Job {job_id} foi cancelado durante a importacao")
        return {"success": False, "error": "Job cancelado pelo usuario", "cancelled": True}

    except AdMetricsImportError as e:
        error_message = e.message if hasattr(e, 'message') else str(e)
        error_code = getattr(e, 'code', None)
        logger.error(f"[GoogleSheetSyncJob] Erro ao processar job {job_id}: {error_message} (code: {error_code})")
        tracker.mark_failed(job_id, error_message, error_code=error_code, details={"integration_id": integration_id})
        _mark_integration_failed(user_jwt, user_id, integration_id)
        return {"success": False, "error": error_message, "error_code": error_code}

    except Exception as e:
        error_message = f"Erro inesperado: {str(e)}"
        logger.exception(f"[GoogleSheetSyncJob] Erro inesperado ao processar job {job_id}")
        tracker.mark_failed(job_id, error_message, details={"integration_id": integration_id})
        _mark_integration_failed(user_jwt, user_id, integration_id)
        return {"success": False, "error": error_message}


def create_sync_job(
    user_jwt: str,
    user_id: str,
    integration_id: str,
) -> str:
    """Cria um novo job de sincronizacao. Retorna job_id."""
    job_id = str(uuid.uuid4())
    tracker = get_job_tracker(user_jwt, user_id)

    payload = {
        "integration_id": integration_id,
        "type": "google_sheet_sync",
    }

    tracker.create_job(
        job_id=job_id,
        payload=payload,
        status=STATUS_PROCESSING,
        message="Iniciando sincronizacao da planilha...",
    )

    logger.info(f"[GoogleSheetSyncJob] Job {job_id} criado para integracao {integration_id}")
    return job_id
