"""
InsightsCollector: Coleta insights paginados da Meta API.

Responsável apenas por paginação de /insights, sem enriquecimento ou formatação.
"""
import logging
from typing import Any, Callable, Dict, List, Optional, TYPE_CHECKING
import requests

if TYPE_CHECKING:
    from app.services.job_tracker import JobTracker

logger = logging.getLogger(__name__)

# Limite de páginas para evitar loops infinitos
MAX_PAGES = 100
# Limite de registros por página
PAGE_LIMIT = 500


class InsightsCollector:
    """Coleta insights paginados de um report_run_id da Meta API."""
    
    def __init__(
        self,
        access_token: str,
        base_url: str = "https://graph.facebook.com/v22.0/",
        on_progress: Optional[Callable[[int, int], None]] = None,
        job_tracker: Optional["JobTracker"] = None,
        job_id: Optional[str] = None
    ):
        """
        Args:
            access_token: Token de acesso da Meta API
            base_url: URL base da Graph API
            on_progress: Callback opcional para progresso (page_count, total_collected)
            job_tracker: Tracker opcional para verificar cancelamento
            job_id: ID do job opcional para verificar cancelamento
        """
        self.access_token = access_token
        self.base_url = base_url
        self.on_progress = on_progress
        self.job_tracker = job_tracker
        self.job_id = job_id
    
    def collect(self, report_run_id: str) -> Dict[str, Any]:
        """
        Coleta todos os insights paginados de um report_run_id.
        
        Returns:
            Dict com:
            - success: bool
            - data: List[Dict] com os registros coletados
            - page_count: int
            - total_collected: int
            - error: str (se houver erro)
        """
        try:
            insights_url = f"{self.base_url}{report_run_id}/insights?access_token={self.access_token}&limit={PAGE_LIMIT}"
            logger.info(f"[InsightsCollector] Iniciando coleta de insights para {report_run_id}")
            
            # Primeira página
            response = requests.get(insights_url, timeout=60)
            response.raise_for_status()
            insights_data = response.json()
            
            data = insights_data.get("data", [])
            page_count = 1
            total_collected = len(data)
            
            logger.info(f"[InsightsCollector] Página {page_count}: {len(data)} registros coletados")
            
            if self.on_progress:
                self.on_progress(page_count, total_collected)
            
            # Paginação
            while "paging" in insights_data and "next" in insights_data.get("paging", {}):
                # Verificar cancelamento antes de continuar paginação
                if self.job_tracker and self.job_id:
                    from app.services.job_tracker import STATUS_CANCELLED
                    job = self.job_tracker.get_job(self.job_id)
                    if job and job.get("status") == STATUS_CANCELLED:
                        logger.info(f"[InsightsCollector] ⛔ Job {self.job_id} cancelado, interrompendo paginação na página {page_count}")
                        return {
                            "success": False,
                            "data": data,  # Retornar dados coletados até agora
                            "page_count": page_count,
                            "total_collected": total_collected,
                            "error": "Job cancelado pelo usuário",
                            "cancelled": True
                        }

                if page_count >= MAX_PAGES:
                    logger.warning(f"[InsightsCollector] Limite de páginas atingido ({MAX_PAGES})")
                    break

                page_count += 1
                next_url = insights_data["paging"]["next"]
                
                response = requests.get(next_url, timeout=60)
                response.raise_for_status()
                insights_data = response.json()
                
                page_data = insights_data.get("data", [])
                data.extend(page_data)
                total_collected += len(page_data)
                
                logger.info(f"[InsightsCollector] Página {page_count}: {len(page_data)} registros (Total: {total_collected})")
                
                if self.on_progress:
                    self.on_progress(page_count, total_collected)
            
            logger.info(f"[InsightsCollector] Coleta completa: {page_count} páginas, {total_collected} registros")
            
            return {
                "success": True,
                "data": data,
                "page_count": page_count,
                "total_collected": total_collected
            }
            
        except requests.exceptions.Timeout as e:
            logger.error(f"[InsightsCollector] Timeout ao coletar insights: {e}")
            return {
                "success": False,
                "data": [],
                "page_count": 0,
                "total_collected": 0,
                "error": f"Timeout ao coletar insights: {str(e)}"
            }
        except requests.exceptions.HTTPError as e:
            logger.error(f"[InsightsCollector] Erro HTTP ao coletar insights: {e}")
            return {
                "success": False,
                "data": [],
                "page_count": 0,
                "total_collected": 0,
                "error": f"Erro HTTP: {str(e)}"
            }
        except Exception as e:
            logger.exception(f"[InsightsCollector] Erro ao coletar insights: {e}")
            return {
                "success": False,
                "data": [],
                "page_count": 0,
                "total_collected": 0,
                "error": str(e)
            }


def get_insights_collector(
    access_token: str,
    on_progress: Optional[Callable[[int, int], None]] = None,
    job_tracker: Optional["JobTracker"] = None,
    job_id: Optional[str] = None
) -> InsightsCollector:
    """Factory function para criar InsightsCollector."""
    return InsightsCollector(
        access_token,
        on_progress=on_progress,
        job_tracker=job_tracker,
        job_id=job_id
    )




































