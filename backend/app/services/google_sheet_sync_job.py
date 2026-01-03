"""
Google Sheet Sync Job: Processa sincronização de planilhas Google em background.

Responsável por:
- Ler dados da planilha Google Sheets
- Processar e validar dados
- Persistir no Supabase (ad_metrics enrichment)
- Atualizar progresso via JobTracker
"""
import logging
import uuid
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

# Estágios do sync
STAGE_READING = "lendo_planilha"
STAGE_PROCESSING = "processando_dados"
STAGE_PERSISTING = "persistindo"
STAGE_COMPLETE = "completo"


def _check_if_cancelled(tracker: JobTracker, job_id: str) -> bool:
    """
    Verifica se o job foi cancelado pelo usuário.
    Retorna True se o job está com status CANCELLED.
    """
    try:
        job = tracker.get_job(job_id)
        if job and job.get("status") == STATUS_CANCELLED:
            logger.info(f"[GoogleSheetSyncJob] Job {job_id} foi cancelado pelo usuário")
            return True
        return False
    except Exception as e:
        logger.warning(f"[GoogleSheetSyncJob] Erro ao verificar cancelamento do job {job_id}: {e}")
        return False


def process_sync_job(
    user_jwt: str,
    user_id: str,
    job_id: str,
    integration_id: str,
) -> Dict[str, Any]:
    """
    Processa um job de sincronização de planilha Google em background.

    Args:
        user_jwt: JWT do Supabase
        user_id: ID do usuário
        job_id: ID do job
        integration_id: ID da integração (ad_sheet_integrations)

    Returns:
        Dict com resultado do processamento
    """
    tracker = get_job_tracker(user_jwt, user_id)

    try:
        logger.info(f"[GoogleSheetSyncJob] Iniciando sync do job {job_id} para integração {integration_id}")

        # ✅ VERIFICAR CANCELAMENTO ANTES DE INICIAR
        if _check_if_cancelled(tracker, job_id):
            logger.info(f"[GoogleSheetSyncJob] Job {job_id} cancelado antes de iniciar processamento")
            return {
                "success": False,
                "error": "Job cancelado pelo usuário",
                "cancelled": True,
            }

        # ===== FASE 1: LENDO PLANILHA =====
        tracker.mark_processing(job_id, STAGE_READING, {
            "integration_id": integration_id,
            "rows_read": 0,
        })

        # ✅ VERIFICAR CANCELAMENTO APÓS MARCAR LEITURA
        if _check_if_cancelled(tracker, job_id):
            logger.info(f"[GoogleSheetSyncJob] Job {job_id} cancelado durante leitura da planilha")
            return {
                "success": False,
                "error": "Job cancelado pelo usuário",
                "cancelled": True,
            }

        # ===== FASE 2: PROCESSANDO DADOS =====
        tracker.mark_processing(job_id, STAGE_PROCESSING, {
            "integration_id": integration_id,
            "rows_processed": 0,
        })

        # ✅ VERIFICAR CANCELAMENTO ANTES DE PROCESSAR
        if _check_if_cancelled(tracker, job_id):
            logger.info(f"[GoogleSheetSyncJob] Job {job_id} cancelado antes de processar dados")
            return {
                "success": False,
                "error": "Job cancelado pelo usuário",
                "cancelled": True,
            }

        # ===== FASE 3: PERSISTINDO =====
        tracker.mark_persisting(job_id, {
            "integration_id": integration_id,
        })

        # ✅ VERIFICAR CANCELAMENTO ANTES DE PERSISTIR
        if _check_if_cancelled(tracker, job_id):
            logger.info(f"[GoogleSheetSyncJob] Job {job_id} cancelado antes de persistir dados")
            return {
                "success": False,
                "error": "Job cancelado pelo usuário",
                "cancelled": True,
            }

        # Executar importação (já faz todo o trabalho: ler, processar, persistir)
        # Passar callback de cancelamento para verificar durante o processamento
        stats = run_ad_metrics_sheet_import(
            user_jwt=user_jwt,
            user_id=user_id,
            integration_id=integration_id,
            check_cancelled=lambda: _check_if_cancelled(tracker, job_id),
        )
        
        # ===== CONCLUSÃO =====
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
        
        logger.info(
            f"[GoogleSheetSyncJob] Job {job_id} concluído com sucesso. "
            f"Processados: {result_count} linhas"
        )
        
        return {
            "success": True,
            "stats": stats,
            "result_count": result_count,
        }

    except AdMetricsImportCancelled:
        # ✅ TRATAMENTO ESPECÍFICO PARA CANCELAMENTO
        logger.info(f"[GoogleSheetSyncJob] Job {job_id} foi cancelado durante a importação")
        # Não marcar como failed - já está marcado como cancelled via API
        return {
            "success": False,
            "error": "Job cancelado pelo usuário",
            "cancelled": True,
        }

    except AdMetricsImportError as e:
        error_message = e.message if hasattr(e, 'message') else str(e)
        error_code = getattr(e, 'code', None)
        logger.error(f"[GoogleSheetSyncJob] Erro ao processar job {job_id}: {error_message} (code: {error_code})")
        tracker.mark_failed(job_id, error_message, error_code=error_code, details={"integration_id": integration_id})

        # Atualizar status da integração para "failed"
        try:
            from datetime import datetime as dt
            from app.core.supabase_client import get_supabase_for_user

            sb = get_supabase_for_user(user_jwt)
            now_iso = dt.utcnow().isoformat(timespec="seconds") + "Z"
            sb.table("ad_sheet_integrations").update(
                {
                    "last_synced_at": now_iso,
                    # last_successful_sync_at não é atualizado em caso de falha
                    "last_sync_status": "failed",
                    "updated_at": now_iso,
                }
            ).eq("id", integration_id).eq("owner_id", user_id).execute()
        except Exception as update_error:
            logger.warning(
                "[GoogleSheetSyncJob] Falha ao atualizar status da integração %s: %s",
                integration_id,
                update_error,
            )

        return {
            "success": False,
            "error": error_message,
            "error_code": error_code,
        }
    except Exception as e:
        error_message = f"Erro inesperado: {str(e)}"
        logger.exception(f"[GoogleSheetSyncJob] Erro inesperado ao processar job {job_id}")
        tracker.mark_failed(job_id, error_message, details={"integration_id": integration_id})

        # Atualizar status da integração para "failed"
        try:
            from datetime import datetime as dt
            from app.core.supabase_client import get_supabase_for_user

            sb = get_supabase_for_user(user_jwt)
            now_iso = dt.utcnow().isoformat(timespec="seconds") + "Z"
            sb.table("ad_sheet_integrations").update(
                {
                    "last_synced_at": now_iso,
                    # last_successful_sync_at não é atualizado em caso de falha
                    "last_sync_status": "failed",
                    "updated_at": now_iso,
                }
            ).eq("id", integration_id).eq("owner_id", user_id).execute()
        except Exception as update_error:
            logger.warning(
                "[GoogleSheetSyncJob] Falha ao atualizar status da integração %s: %s",
                integration_id,
                update_error,
            )

        return {
            "success": False,
            "error": error_message,
        }


def create_sync_job(
    user_jwt: str,
    user_id: str,
    integration_id: str,
) -> str:
    """
    Cria um novo job de sincronização.
    
    Args:
        user_jwt: JWT do Supabase
        user_id: ID do usuário
        integration_id: ID da integração
    
    Returns:
        ID do job criado
    """
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
        message="Iniciando sincronização da planilha...",
    )
    
    logger.info(f"[GoogleSheetSyncJob] Job {job_id} criado para integração {integration_id}")
    
    return job_id

