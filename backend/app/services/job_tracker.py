"""
JobTracker: Gerencia estados e progresso de jobs no Supabase.

Estados do job:
- meta_running: Meta API ainda processando
- meta_completed: Meta terminou, aguardando processamento interno
- processing: Coletando/paginando/enriquecendo/formatando
- persisting: Gravando ads/metrics/pack/stats
- completed: Pack pronto
- failed: Erro
- cancelled: Cancelado pelo usuário
"""
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
from app.core.supabase_client import get_supabase_for_user

logger = logging.getLogger(__name__)

# Constantes de status
STATUS_META_RUNNING = "meta_running"
STATUS_META_COMPLETED = "meta_completed"
STATUS_PROCESSING = "processing"
STATUS_PERSISTING = "persisting"
STATUS_COMPLETED = "completed"
STATUS_FAILED = "failed"
STATUS_CANCELLED = "cancelled"

# Estágios internos (para feedback visual)
STAGE_PAGINATION = "paginação"
STAGE_ENRICHMENT = "enriquecimento"
STAGE_FORMATTING = "formatação"
STAGE_PERSISTENCE = "persistência"
STAGE_COMPLETE = "completo"


def _now_iso() -> str:
    """Retorna timestamp ISO atual em UTC."""
    return datetime.now(timezone.utc).isoformat()


class JobTracker:
    """Gerencia estados de jobs no Supabase."""
    
    def __init__(self, user_jwt: str, user_id: str):
        self.user_jwt = user_jwt
        self.user_id = user_id
        self._sb = None
    
    @property
    def sb(self):
        if self._sb is None:
            self._sb = get_supabase_for_user(self.user_jwt)
        return self._sb
    
    def get_job(self, job_id: str) -> Optional[Dict[str, Any]]:
        """Busca job pelo ID."""
        try:
            result = self.sb.table("jobs").select("*").eq("id", job_id).eq("user_id", self.user_id).execute()
            if result.data and len(result.data) > 0:
                return result.data[0]
            return None
        except Exception as e:
            logger.exception(f"[JobTracker] Erro ao buscar job {job_id}: {e}")
            return None
    
    def get_payload(self, job_id: str) -> Optional[Dict[str, Any]]:
        """Busca apenas o payload do job."""
        try:
            result = self.sb.table("jobs").select("payload").eq("id", job_id).eq("user_id", self.user_id).execute()
            if result.data and len(result.data) > 0:
                return result.data[0].get("payload")
            return None
        except Exception as e:
            logger.exception(f"[JobTracker] Erro ao buscar payload do job {job_id}: {e}")
            return None
    
    def create_job(
        self,
        job_id: str,
        payload: Dict[str, Any],
        status: str = STATUS_META_RUNNING,
        message: str = "Job iniciado"
    ) -> bool:
        """Cria um novo registro de job."""
        try:
            data = {
                "id": job_id,
                "user_id": self.user_id,
                "status": status,
                "progress": 0,
                "message": message,
                "payload": payload,
                "created_at": _now_iso(),
                "updated_at": _now_iso(),
            }
            self.sb.table("jobs").upsert(data, on_conflict="id").execute()
            logger.info(f"[JobTracker] Job {job_id} criado com status {status}")
            return True
        except Exception as e:
            logger.exception(f"[JobTracker] Erro ao criar job {job_id}: {e}")
            return False
    
    def heartbeat(
        self,
        job_id: str,
        status: str,
        progress: int = 0,
        message: Optional[str] = None,
        details: Optional[Dict[str, Any]] = None,
        result_count: Optional[int] = None
    ) -> bool:
        """Atualiza status/progresso do job (heartbeat)."""
        try:
            data: Dict[str, Any] = {
                "status": status,
                "progress": progress,
                "updated_at": _now_iso(),
            }
            
            if message is not None:
                data["message"] = message
            
            if result_count is not None:
                data["result_count"] = result_count
            
            # Se tiver details, mesclar no payload existente
            if details is not None:
                existing = self.get_payload(job_id) or {}
                if "details" not in existing:
                    existing["details"] = {}
                existing["details"].update(details)
                data["payload"] = existing
            
            self.sb.table("jobs").update(data).eq("id", job_id).eq("user_id", self.user_id).execute()
            return True
        except Exception as e:
            logger.exception(f"[JobTracker] Erro ao atualizar heartbeat do job {job_id}: {e}")
            return False
    
    def try_mark_processing(self, job_id: str) -> bool:
        """
        Tenta marcar job como 'processing' (lock otimista).
        Retorna True se conseguiu (era meta_completed), False caso contrário.
        """
        try:
            # Buscar status atual
            job = self.get_job(job_id)
            if not job:
                return False

            current_status = job.get("status")

            # ✅ CRÍTICO: Se job foi cancelado, NÃO iniciar processamento
            if current_status == STATUS_CANCELLED:
                logger.info(f"[JobTracker] Job {job_id} foi cancelado, não iniciando processamento")
                return False

            # Só pode transicionar de meta_completed para processing
            if current_status == STATUS_META_COMPLETED:
                self.heartbeat(
                    job_id,
                    status=STATUS_PROCESSING,
                    progress=100,
                    message="Iniciando coleta de anúncios...",
                    details={"stage": STAGE_PAGINATION, "started_processing_at": _now_iso()}
                )
                logger.info(f"[JobTracker] Job {job_id} marcado como processing")
                return True
            
            # Se já está em processing/persisting, não precisa marcar novamente
            if current_status in (STATUS_PROCESSING, STATUS_PERSISTING):
                logger.debug(f"[JobTracker] Job {job_id} já está em {current_status}")
                return False
            
            return False
        except Exception as e:
            logger.exception(f"[JobTracker] Erro ao tentar marcar processing para job {job_id}: {e}")
            return False
    
    def mark_meta_completed(self, job_id: str) -> bool:
        """Marca job como meta_completed (Meta terminou, aguardando processamento)."""
        return self.heartbeat(
            job_id,
            status=STATUS_META_COMPLETED,
            progress=100,
            message="Iniciando coleta de anúncios..."
        )
    
    def mark_processing(
        self,
        job_id: str,
        stage: str = STAGE_PAGINATION,
        details: Optional[Dict[str, Any]] = None
    ) -> bool:
        """Marca job como processing com estágio específico."""
        full_details = {"stage": stage}
        if details:
            full_details.update(details)
        
        # Mensagens customizadas por stage
        stage_messages = {
            STAGE_PAGINATION: "Coletando dados: bloco 1...",
            STAGE_ENRICHMENT: "Enriquecendo dados...",
            STAGE_FORMATTING: "Deixando tudo perfeito...",
        }
        message = stage_messages.get(stage, f"Processando: {stage}...")
        
        return self.heartbeat(
            job_id,
            status=STATUS_PROCESSING,
            progress=100,
            message=message,
            details=full_details
        )
    
    def mark_persisting(self, job_id: str, details: Optional[Dict[str, Any]] = None) -> bool:
        """Marca job como persisting."""
        full_details = {"stage": STAGE_PERSISTENCE}
        if details:
            full_details.update(details)
        return self.heartbeat(
            job_id,
            status=STATUS_PERSISTING,
            progress=100,
            message="Salvando dados...",
            details=full_details
        )
    
    def mark_completed(
        self,
        job_id: str,
        pack_id: str,
        result_count: int = 0,
        details: Optional[Dict[str, Any]] = None
    ) -> bool:
        """Marca job como completed."""
        full_details = {"stage": STAGE_COMPLETE, "pack_id": pack_id}
        if details:
            full_details.update(details)
        return self.heartbeat(
            job_id,
            status=STATUS_COMPLETED,
            progress=100,
            message=f"Concluído! {result_count} anúncios coletados.",
            details=full_details,
            result_count=result_count
        )
    
    def mark_failed(self, job_id: str, error_message: str, error_code: str | None = None, details: Optional[Dict[str, Any]] = None) -> bool:
        """Marca job como failed."""
        fail_details = {"stage": "erro", "error": error_message}
        if error_code:
            fail_details["error_code"] = error_code
        # Mesclar com details adicionais se fornecidos
        if details:
            fail_details.update(details)
        return self.heartbeat(
            job_id,
            status=STATUS_FAILED,
            progress=0,
            message=f"Erro: {error_message}",
            details=fail_details
        )
    
    def mark_cancelled(self, job_id: str, reason: str = "Cancelado pelo usuário") -> bool:
        """Marca job como cancelled."""
        return self.heartbeat(
            job_id,
            status=STATUS_CANCELLED,
            progress=0,
            message=f"Cancelado: {reason}",
            details={"stage": "cancelado", "cancelled_at": _now_iso(), "reason": reason}
        )
    
    def cancel_jobs_batch(self, job_ids: List[str], reason: str = "Cancelado durante logout") -> int:
        """Cancela múltiplos jobs de uma vez. Retorna quantidade cancelada."""
        cancelled_count = 0
        for job_id in job_ids:
            try:
                # Verificar se o job existe e está em estado cancelável
                job = self.get_job(job_id)
                if job:
                    current_status = job.get("status")
                    # Só cancelar se não estiver em estado final
                    if current_status not in (STATUS_COMPLETED, STATUS_FAILED, STATUS_CANCELLED):
                        if self.mark_cancelled(job_id, reason):
                            cancelled_count += 1
                            logger.info(f"[JobTracker] Job {job_id} cancelado: {reason}")
                    else:
                        logger.debug(f"[JobTracker] Job {job_id} já está em estado final ({current_status}), ignorando cancelamento")
            except Exception as e:
                logger.warning(f"[JobTracker] Erro ao cancelar job {job_id}: {e}")
                # Continuar com os próximos jobs mesmo se um falhar
        return cancelled_count
    
    def get_public_progress(self, job_id: str) -> Dict[str, Any]:
        """Retorna progresso público do job para o frontend."""
        job = self.get_job(job_id)
        if not job:
            return {
                "status": "error",
                "progress": 0,
                "message": "Job não encontrado"
            }
        
        payload = job.get("payload") or {}
        details = payload.get("details") or {}
        
        response: Dict[str, Any] = {
            "status": job.get("status", "unknown"),
            "progress": job.get("progress", 0),
            "message": job.get("message", ""),
        }
        
        if details:
            response["details"] = details
        
        # Se completed, incluir pack_id e result_count
        if job.get("status") == STATUS_COMPLETED:
            if details.get("pack_id"):
                response["pack_id"] = details["pack_id"]
            if job.get("result_count") is not None:
                response["result_count"] = job["result_count"]
        
        return response
    
    def should_resume_processing(self, job_id: str, stale_threshold_seconds: int = 120) -> bool:
        """
        Verifica se o job deve ser retomado (self-healing).
        Retorna True se job está em processing/persisting mas sem update recente.
        """
        try:
            job = self.get_job(job_id)
            if not job:
                return False
            
            status = job.get("status")
            if status not in (STATUS_PROCESSING, STATUS_PERSISTING):
                return False
            
            # Verificar se updated_at está muito velho
            updated_at_str = job.get("updated_at")
            if not updated_at_str:
                return True  # Sem updated_at, tentar retomar
            
            try:
                updated_at = datetime.fromisoformat(updated_at_str.replace("Z", "+00:00"))
                now = datetime.now(timezone.utc)
                diff_seconds = (now - updated_at).total_seconds()
                
                if diff_seconds > stale_threshold_seconds:
                    logger.warning(f"[JobTracker] Job {job_id} está stale ({diff_seconds:.0f}s sem update)")
                    return True
            except Exception:
                return True  # Se não conseguir parsear, tentar retomar
            
            return False
        except Exception as e:
            logger.exception(f"[JobTracker] Erro ao verificar resumo para job {job_id}: {e}")
            return False


def get_job_tracker(user_jwt: str, user_id: str) -> JobTracker:
    """Factory function para criar JobTracker."""
    return JobTracker(user_jwt, user_id)









