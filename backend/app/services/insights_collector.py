"""
InsightsCollector: Coleta insights paginados da Meta API.

Responsavel apenas por paginacao de /insights, sem enriquecimento ou formatacao.
"""
import logging
import time
from typing import Any, Callable, Dict, List, Optional, TYPE_CHECKING
import requests

from app.core.config import META_GRAPH_BASE_URL
from app.services.meta_usage_logger import (
    _max_buc_metric,
    _max_buc_regain,
    _parse_app_usage,
    _parse_json_header,
    log_meta_usage,
)

if TYPE_CHECKING:
    from app.services.job_tracker import JobTracker

logger = logging.getLogger(__name__)

# Teto: MAX_PAGES x PAGE_LIMIT = 50.000 linhas. E protecao contra gravar recorte como se
# fosse o relatorio inteiro (ver `collection_is_complete`), nao detalhe de paginacao: ao
# mexer num, ajustar o outro para o teto continuar em 50.000.
MAX_PAGES = 50
# Registros por pagina. 1000 medido em 2026-09-13: o mesmo relatorio (3.758 linhas) veio
# identico ao de 500, em ~40% menos tempo (15-17 s contra 25-28 s). 2000 devolveu HTTP 500
# em 2026-09-07.
PAGE_LIMIT = 1000
# Retry de falha transitoria (rede, 5xx)
MAX_RETRIES = 3
RETRY_DELAYS = [2, 4, 8]
# Espera quando a Meta responde "limite atingido". Somadas (105 s) ficam abaixo do lease de
# processamento do job (300 s): o job nao perde a posse enquanto espera.
RATE_LIMIT_DELAYS = [15, 30, 60]
# Codigos de limite da Graph/Marketing API: #4 app, #17 usuario, #32 pagina, #613 chamadas,
# 80000-80014 business use case.
_RATE_LIMIT_CODES = {4, 17, 32, 613}
_BUC_RATE_LIMIT_CODES = range(80000, 80015)
# Espera entre paginas. O 1 s fixo nao protegia contra nada medido: em 14 dias (4.291
# paginas) o uso informado pela Meta nunca passou de 1%, e o bloqueio #4 de 2026-09-07 veio
# de 40+ relatorios criados no dia, nao da leitura de paginas. A espera agora e curta e cresce
# com o uso que a propria resposta informa; sem cabecalho legivel, fica como era.
PAGE_DELAY_S = 0.25
PAGE_DELAY_NO_HEADER_S = 1.0
# HTTP status codes que justificam retry
_RETRYABLE_STATUS_CODES = {429, 500, 502, 503}


def _fmt_int(n: int) -> str:
    """50000 -> '50.000' (separador pt-BR) para a mensagem que o usuário lê."""
    return f"{int(n):,}".replace(",", ".")


def _is_retryable(exc: Exception) -> bool:
    """Verifica se a excecao justifica retry."""
    if isinstance(exc, requests.exceptions.Timeout):
        return True
    if isinstance(exc, requests.exceptions.HTTPError) and exc.response is not None:
        return exc.response.status_code in _RETRYABLE_STATUS_CODES
    if isinstance(exc, requests.exceptions.ConnectionError):
        return True
    return False


def _rate_limit_code(exc: Exception) -> Optional[int]:
    """Codigo de erro da Meta quando a excecao e "limite atingido"; senao None."""
    if not isinstance(exc, requests.exceptions.HTTPError) or exc.response is None:
        return None
    try:
        code = int(((exc.response.json() or {}).get("error") or {}).get("code"))
    except Exception:
        return None
    if code in _RATE_LIMIT_CODES or code in _BUC_RATE_LIMIT_CODES:
        return code
    return None


def _page_delay(headers) -> float:
    """Quanto esperar antes da proxima pagina, pelo uso que a Meta informou nesta resposta.

    Cresce com o maior uso visto entre x-business-use-case-usage, x-app-usage e
    x-ad-account-usage. Conta ja bloqueada (estimated_time_to_regain_access > 0) espera o
    primeiro degrau do limite. Sem nenhum valor legivel, mantem o 1 s de antes: sem sinal,
    nao acelera.
    """
    if headers is None:
        return PAGE_DELAY_NO_HEADER_S
    buc = _parse_json_header(headers, "x-business-use-case-usage")
    app = _parse_app_usage(headers)
    acc = _parse_json_header(headers, "x-ad-account-usage")

    values: List[float] = []
    if isinstance(buc, dict):
        if _max_buc_regain(buc):
            return float(RATE_LIMIT_DELAYS[0])
        for metric in ("call_count", "total_cputime", "total_time"):
            value = _max_buc_metric(buc, metric)
            if value is not None:
                values.append(value)
    if isinstance(app, dict):
        values.extend(
            float(app[m]) for m in ("call_count", "total_cputime", "total_time")
            if isinstance(app.get(m), (int, float))
        )
    if isinstance(acc, dict) and isinstance(acc.get("acc_id_util_pct"), (int, float)):
        values.append(float(acc["acc_id_util_pct"]))

    if not values:
        return PAGE_DELAY_NO_HEADER_S
    usage = max(values)
    if usage >= 90:
        return 15.0
    if usage >= 75:
        return 5.0
    if usage >= 50:
        return 2.0
    return PAGE_DELAY_S


def _fetch_with_retry(url: str, timeout: int = 60) -> requests.Response:
    """GET com retry: backoff curto para falha transitoria, espera longa para limite da Meta.

    Antes, "limite atingido" (HTTP 400 com codigo #4/#17/#613/800xx) nao era retentado e
    derrubava o job inteiro. Agora espera RATE_LIMIT_DELAYS e tenta de novo; se o limite
    persistir depois de todas as esperas, levanta como antes.
    """
    attempt = 0
    rate_limit_waits = 0
    while True:
        try:
            response = requests.get(url, timeout=timeout)
            response.raise_for_status()
            log_meta_usage(response, "InsightsCollector")
            return response
        except Exception as exc:
            code = _rate_limit_code(exc)
            if code is not None:
                if rate_limit_waits >= len(RATE_LIMIT_DELAYS):
                    raise
                delay = RATE_LIMIT_DELAYS[rate_limit_waits]
                rate_limit_waits += 1
                logger.warning(
                    "[InsightsCollector] Meta informou limite atingido (#%s); esperando %ds (%d/%d)",
                    code, delay, rate_limit_waits, len(RATE_LIMIT_DELAYS),
                )
                time.sleep(delay)
                continue
            if not _is_retryable(exc) or attempt >= MAX_RETRIES - 1:
                raise
            delay = RETRY_DELAYS[attempt]
            logger.warning(
                "[InsightsCollector] Tentativa %d/%d falhou (%s), retry em %ds...",
                attempt + 1, MAX_RETRIES, exc, delay,
            )
            attempt += 1
            time.sleep(delay)


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
                    # Teto com paginas SOBRANDO = coleta incompleta. Isto NUNCA pode
                    # virar sucesso: a sintese de linhas-zero do inventario trata
                    # "ausente do insights" como "entregou 0" e gravaria zero por
                    # cima de gasto real dos anuncios que ficaram nas paginas nao
                    # lidas. Aconteceu em 2026-09-07 (6 packs, R$ 12 mil zerados
                    # num deles). Falhar alto e devolver nada e o unico caminho seguro.
                    logger.error(
                        "[InsightsCollector] Relatorio %s passou do teto de %d paginas (%d linhas) e ainda "
                        "tinha paginas: coleta INCOMPLETA, abortando sem gravar",
                        report_run_id, MAX_PAGES, total_collected,
                    )
                    return {
                        "success": False,
                        "complete": False,
                        "data": [],
                        "page_count": page_count,
                        "total_collected": total_collected,
                        "error": (
                            f"Relatório maior que o limite de {_fmt_int(MAX_PAGES * PAGE_LIMIT)} linhas "
                            f"({_fmt_int(total_collected)} lidas e ainda havia mais). Reduza o período do pack "
                            f"ou o filtro; nada foi gravado para não corromper os dados."
                        ),
                    }

                # Espera guiada pelo uso que a pagina anterior informou
                time.sleep(_page_delay(getattr(response, "headers", None)))

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
                "complete": True,
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


def collection_is_complete(result: Optional[Dict[str, Any]]) -> bool:
    """A coleta trouxe o relatorio INTEIRO?

    So um resultado `success=True` e `complete=True` autoriza o pipeline a tratar
    "anuncio ausente do insights" como "entregou 0" (sintese de linhas-zero).
    Qualquer outra coisa — teto de paginas, cancelamento, erro de rede — e um
    recorte, e um recorte nunca pode ser interpretado como ausencia.
    """
    if not isinstance(result, dict):
        return False
    return bool(result.get("success")) and result.get("complete") is True


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
