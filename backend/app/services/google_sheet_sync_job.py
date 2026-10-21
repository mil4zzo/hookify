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
from typing import Any, Dict, List, Optional
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


def _mark_integration_failed(user_jwt, user_id: str, integration_id: str) -> None:
    """Atualiza status da integracao para 'failed' (best-effort). jwt None => service role."""
    try:
        from app.core.supabase_client import get_supabase_for_user, get_supabase_service

        sb = get_supabase_service() if user_jwt is None else get_supabase_for_user(user_jwt)
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
    user_jwt: Optional[str],
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
    # jwt None => disparo de convidado: o job e os writes vivem no silo do
    # DONO (user_id) e o tracker precisa de service role (RLS nao alcanca).
    tracker = get_job_tracker(user_jwt, user_id, use_service_role=user_jwt is None)

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
            # As duas parcelas separadas: a tela de resumo distingue "Inválidas" (linha da
            # planilha sem ad_id/data/leadscore) de "Ignoradas" (par (ad_id, data) sem match).
            "skipped_invalid": stats.get("skipped_invalid", 0),
            "skipped_no_match": stats.get("skipped_no_match", 0),
            "unique_ad_date_pairs": stats.get("unique_ad_date_pairs", 0),
            "total_update_queries": stats.get("total_update_queries", 0),
            # As duas parcelas de "sem match". O resumo já as exibia, mas elas nunca
            # saíam daqui — o tooltip ficava permanentemente vazio.
            "ids_not_found_count": stats.get("ids_not_found_count"),
            "ids_out_of_pack_count": stats.get("ids_out_of_pack_count"),
            # 140: relatório por coluna vinculada (rótulo, tipo, valores, puladas, motivo)
            "custom_columns": stats.get("custom_columns") or {},
            # Desfecho do sync: "success" | "no_match" | "empty". O job continua
            # completed (nada quebrou) — quem pinta o aviso amarelo é este campo.
            "sync_outcome": stats.get("sync_outcome"),
            "outcome_reason": stats.get("outcome_reason"),
            "outcome_message": stats.get("outcome_message"),
            # Nome atual + nome anterior quando a planilha foi renomeada na origem.
            "spreadsheet_name": stats.get("spreadsheet_name"),
            "spreadsheet_renamed_from": stats.get("spreadsheet_renamed_from"),
            "sheet_date_min": stats.get("sheet_date_min"),
            "sheet_date_max": stats.get("sheet_date_max"),
            "pack_date_start": stats.get("pack_date_start"),
            "pack_date_stop": stats.get("pack_date_stop"),
        })

        outcome = stats.get("sync_outcome")
        if outcome and outcome != "success":
            logger.warning(
                f"[GoogleSheetSyncJob] Job {job_id} concluido SEM APLICAR NADA "
                f"({outcome}/{stats.get('outcome_reason')}): {stats.get('outcome_message')}"
            )
        else:
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
        # Mensagem do usuário fica legível; o repr da exceção vai só para o log e
        # para details.technical (linha de diagnóstico do toast).
        error_message = "Erro inesperado ao sincronizar a planilha."
        logger.exception(f"[GoogleSheetSyncJob] Erro inesperado ao processar job {job_id}")
        tracker.mark_failed(
            job_id,
            error_message,
            details={"integration_id": integration_id, "technical": f"{type(e).__name__}: {e}"},
        )
        _mark_integration_failed(user_jwt, user_id, integration_id)
        return {"success": False, "error": error_message}


def create_sync_job(
    user_jwt: Optional[str],
    user_id: str,
    integration_id: str,
    actor_id: Optional[str] = None,
) -> str:
    """Cria um novo job de sincronizacao. Retorna job_id. jwt None => service role (silo de dono).

    `actor_id`: QUEM disparou (pode diferir de `user_id`, que e o silo do dono num
    pack compartilhado). E o que permite ao convidado re-anexar/cancelar o proprio
    job depois de um reload — sem isso o job fica invisivel para ele.
    """
    job_id = str(uuid.uuid4())
    tracker = get_job_tracker(user_jwt, user_id, use_service_role=user_jwt is None)

    payload = {
        "integration_id": integration_id,
        "type": "google_sheet_sync",
        "actor_id": str(actor_id or user_id),
        "silo_user_id": str(user_id),
    }

    tracker.create_job(
        job_id=job_id,
        payload=payload,
        status=STATUS_PROCESSING,
        message="Iniciando sincronizacao da planilha...",
    )

    logger.info(f"[GoogleSheetSyncJob] Job {job_id} criado para integracao {integration_id}")
    return job_id


# ── Sync em massa: um job, N integrações, uma leitura por arquivo ────────────────

def process_bulk_sync_job(
    user_jwt: Optional[str],
    user_id: str,
    job_id: str,
    items: List[Dict[str, str]],
) -> Dict[str, Any]:
    """Sincroniza N integrações (`items`: {integration_id, pack_id}) em SÉRIE, lendo cada arquivo uma vez.

    POR QUE UM JOB SÓ, E EM SÉRIE
      A configuração em massa liga N packs ao mesmo arquivo. N jobs independentes
      eram N leituras do arquivo inteiro na API do Google ao mesmo tempo e N
      gravações em paralelo no banco — o que a fila de refresh existe para evitar.
      Aqui a leitura sai do `sheet_cache` a partir do segundo pack e as gravações
      vão uma depois da outra.

    Falha de UM pack não derruba os outros: vira resultado "failed" daquele pack.
    Só o cancelamento (entre um pack e o próximo) para o job. O resultado de cada
    pack vai em `details.bulk_results` — a tela mostra quem aplicou, quem não casou
    nada (pack de lançamento antigo ligado ao arquivo do lançamento atual) e quem falhou.
    """
    tracker = get_job_tracker(user_jwt, user_id, use_service_role=user_jwt is None)
    total = len(items)
    results: List[Dict[str, Any]] = []
    sheet_cache: Dict[Any, Any] = {}

    def _heartbeat(done: int, status: str = STATUS_PROCESSING) -> None:
        tracker.heartbeat(
            job_id,
            status=status,
            progress=int(done * 100 / total) if total else 100,
            message=f"Sincronizando planilha: pack {min(done + 1, total)} de {total}...",
            details={"stage": STAGE_PROCESSING, "bulk_total": total, "bulk_done": done, "bulk_results": results},
        )

    try:
        for i, item in enumerate(items):
            integration_id = str(item["integration_id"])
            if _check_if_cancelled(tracker, job_id):
                return {"success": False, "error": "Job cancelado pelo usuario", "cancelled": True, "results": results}
            _heartbeat(i)
            entry: Dict[str, Any] = {"integration_id": integration_id, "pack_id": item.get("pack_id")}
            try:
                stats = run_ad_metrics_sheet_import(
                    user_jwt=user_jwt,
                    user_id=user_id,
                    integration_id=integration_id,
                    check_cancelled=lambda: _check_if_cancelled(tracker, job_id),
                    sheet_cache=sheet_cache,
                )
                entry.update({
                    "status": "completed",
                    "rows_updated": stats.get("updated_rows", 0),
                    "sync_outcome": stats.get("sync_outcome"),
                    "outcome_message": stats.get("outcome_message"),
                    "spreadsheet_renamed_from": stats.get("spreadsheet_renamed_from"),
                })
            except AdMetricsImportCancelled:
                return {"success": False, "error": "Job cancelado pelo usuario", "cancelled": True, "results": results}
            except AdMetricsImportError as e:
                message = e.message if hasattr(e, "message") else str(e)
                entry.update({"status": "failed", "error": message, "error_code": getattr(e, "code", None)})
                _mark_integration_failed(user_jwt, user_id, integration_id)
            except Exception as e:
                logger.exception(f"[GoogleSheetSyncJob] Bulk {job_id}: erro inesperado na integracao {integration_id}")
                entry.update({
                    "status": "failed",
                    "error": "Erro inesperado ao sincronizar a planilha.",
                    "technical": f"{type(e).__name__}: {e}",
                })
                _mark_integration_failed(user_jwt, user_id, integration_id)
            results.append(entry)

        updated = sum(int(r.get("rows_updated") or 0) for r in results)
        tracker.mark_completed(job_id, pack_id="", result_count=updated, details={
            "bulk_total": total,
            "bulk_done": total,
            "bulk_results": results,
            "sheet_reads": sum(1 for k in sheet_cache if isinstance(k, tuple) and k and k[0] == "rows"),
        })
        logger.info(
            "[GoogleSheetSyncJob] Bulk %s concluido: %d integracoes, %d leitura(s) de planilha, %d linhas",
            job_id, total, sum(1 for k in sheet_cache if isinstance(k, tuple) and k and k[0] == "rows"), updated,
        )
        return {"success": True, "results": results}
    except Exception as e:
        logger.exception(f"[GoogleSheetSyncJob] Bulk {job_id}: falha fora de um pack")
        tracker.mark_failed(
            job_id,
            "Erro inesperado ao sincronizar as planilhas.",
            details={"bulk_results": results, "technical": f"{type(e).__name__}: {e}"},
        )
        return {"success": False, "error": str(e), "results": results}


def create_bulk_sync_job(user_jwt: Optional[str], user_id: str, items: List[Dict[str, str]]) -> str:
    """Cria o job do sync em massa (sempre no silo do próprio usuário: só o dono dispara)."""
    job_id = str(uuid.uuid4())
    tracker = get_job_tracker(user_jwt, user_id, use_service_role=user_jwt is None)
    tracker.create_job(
        job_id=job_id,
        payload={
            "type": "google_sheet_bulk_sync",
            "integration_ids": [str(i["integration_id"]) for i in items],
            "actor_id": str(user_id),
            "silo_user_id": str(user_id),
        },
        status=STATUS_PROCESSING,
        message="Iniciando sincronizacao das planilhas...",
    )
    logger.info(f"[GoogleSheetSyncJob] Bulk {job_id} criado para {len(items)} integracoes")
    return job_id
