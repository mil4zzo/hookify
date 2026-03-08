"""
InsightsCollector: Coleta insights paginados da Meta API.

Responsavel apenas por paginacao de /insights, sem enriquecimento ou formatacao.
"""
import logging
import time
from typing import Any, Callable, Dict, List, Optional, TYPE_CHECKING
import requests

from app.core.config import META_GRAPH_BASE_URL
from app.services.meta_usage_logger import log_meta_usage

if TYPE_CHECKING:
    from app.services.job_tracker import JobTracker

logger = logging.getLogger(__name__)

# Limite de paginas para evitar loops infinitos
MAX_PAGES = 100
# Limite de registros por pagina
PAGE_LIMIT = 500
# Retry config
MAX_RETRIES = 3
RETRY_DELAYS = [2, 4, 8]
# Delay entre paginas para evitar rate limit
PAGE_DELAY_S = 1
# HTTP status codes que justificam retry
_RETRYABLE_STATUS_CODES = {429, 500, 502, 503}


def _is_retryable(exc: Exception) -> bool:
    """Verifica se a excecao justifica retry."""
    if isinstance(exc, requests.exceptions.Timeout):
        return True
    if isinstance(exc, requests.exceptions.HTTPError) and exc.response is not None:
        return exc.response.status_code in _RETRYABLE_STATUS_CODES
    if isinstance(exc, requests.exceptions.ConnectionError):
        return True
    return False


def _fetch_with_retry(url: str, timeout: int = 60) -> requests.Response:
    """Faz GET com retry e backoff exponencial para erros transientes."""
    last_exc: Optional[Exception] = None
    for attempt in range(MAX_RETRIES):
        try:
            response = requests.get(url, timeout=timeout)
            response.raise_for_status()
            log_meta_usage(response, "InsightsCollector")
            return response
        except Exception as exc:
            last_exc = exc
            if not _is_retryable(exc) or attempt >= MAX_RETRIES - 1:
                raise
            delay = RETRY_DELAYS[attempt]
            logger.warning(
                "[InsightsCollector] Tentativa %d/%d falhou (%s), retry em %ds...",
                attempt + 1, MAX_RETRIES, exc, delay,
            )
            time.sleep(delay)
    raise last_exc  # type: ignore[misc]


class InsightsCollector:
    """Coleta insights paginados de um report_run_id da Meta API."""

    def __init__(
        self,
        access_token: str,
        base_url: str = META_GRAPH_BASE_URL,
        on_progress: Optional[Callable[[int, int], None]] = None,
        job_tracker: Optional["JobTracker"] = None,
        job_id: Optional[str] = None
    ):
        self.access_token = access_token
        self.base_url = base_url
        self.on_progress = on_progress
        self.job_tracker = job_tracker
        self.job_id = job_id

    def _is_cancelled(self) -> bool:
        if self.job_tracker and self.job_id:
            from app.services.job_tracker import STATUS_CANCELLED
            job = self.job_tracker.get_job(self.job_id)
            return bool(job and job.get("status") == STATUS_CANCELLED)
        return False

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
            logger.info("[InsightsCollector] Iniciando coleta de insights para %s", report_run_id)

            # Primeira pagina (com retry)
            response = _fetch_with_retry(insights_url)
            insights_data = response.json()

            data = insights_data.get("data", [])
            page_count = 1
            total_collected = len(data)

            logger.info("[InsightsCollector] Pagina %d: %d registros coletados", page_count, len(data))

            if self.on_progress:
                self.on_progress(page_count, total_collected)

            # Paginacao
            while "paging" in insights_data and "next" in insights_data.get("paging", {}):
                if self._is_cancelled():
                    logger.info("[InsightsCollector] Job %s cancelado, interrompendo paginacao na pagina %d", self.job_id, page_count)
                    return {
                        "success": False,
                        "data": data,
                        "page_count": page_count,
                        "total_collected": total_collected,
                        "error": "Job cancelado pelo usuario",
                        "cancelled": True
                    }

                if page_count >= MAX_PAGES:
                    logger.warning("[InsightsCollector] Limite de paginas atingido (%d)", MAX_PAGES)
                    break

                # Delay entre paginas para evitar rate limit
                time.sleep(PAGE_DELAY_S)

                page_count += 1
                next_url = insights_data["paging"]["next"]

                response = _fetch_with_retry(next_url)
                insights_data = response.json()

                page_data = insights_data.get("data", [])
                data.extend(page_data)
                total_collected += len(page_data)

                logger.info("[InsightsCollector] Pagina %d: %d registros (Total: %d)", page_count, len(page_data), total_collected)

                if self.on_progress:
                    self.on_progress(page_count, total_collected)

            logger.info("[InsightsCollector] Coleta completa: %d paginas, %d registros", page_count, total_collected)

            return {
                "success": True,
                "data": data,
                "page_count": page_count,
                "total_collected": total_collected
            }

        except requests.exceptions.Timeout as e:
            logger.error("[InsightsCollector] Timeout ao coletar insights apos retries: %s", e)
            return {
                "success": False,
                "data": [],
                "page_count": 0,
                "total_collected": 0,
                "error": f"Timeout ao coletar insights: {e}"
            }
        except requests.exceptions.HTTPError as e:
            logger.error("[InsightsCollector] Erro HTTP ao coletar insights apos retries: %s", e)
            return {
                "success": False,
                "data": [],
                "page_count": 0,
                "total_collected": 0,
                "error": f"Erro HTTP: {e}"
            }
        except Exception as e:
            logger.exception("[InsightsCollector] Erro ao coletar insights: %s", e)
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
