"""
MetaJobClient: Cliente leve para operações de job na Meta API.

Responsável apenas por:
- Iniciar jobs async
- Verificar status de jobs (rápido, sem paginação)
"""
import json
import logging
import urllib.parse
from typing import Any, Dict, List, Optional, Union
import requests

from app.core.config import META_GRAPH_BASE_URL
from app.services.meta_usage_logger import log_meta_usage

logger = logging.getLogger(__name__)

# Constantes
REQUEST_TIMEOUT = 30  # 30 segundos para verificação de status


def _extract_meta_error_fields(status_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Extrai campos de erro estruturados de uma response de async report da Meta.

    Meta às vezes popula `error` (objeto), às vezes apenas `failure_reason`,
    às vezes nada. Esta função normaliza para um dict consumível pelo frontend.
    """
    err_obj = status_data.get("error") if isinstance(status_data.get("error"), dict) else {}
    extracted: Dict[str, Any] = {
        "code": err_obj.get("code"),
        "subcode": err_obj.get("error_subcode"),
        "type": err_obj.get("type"),
        "message": err_obj.get("message"),
        "user_title": err_obj.get("error_user_title"),
        "user_msg": err_obj.get("error_user_msg"),
        "fbtrace_id": err_obj.get("fbtrace_id"),
        "failure_reason": status_data.get("failure_reason") or status_data.get("async_status_error"),
        "account_id": status_data.get("account_id"),
        "time_ref": status_data.get("time_ref"),
        "date_start": status_data.get("date_start"),
        "date_stop": status_data.get("date_stop"),
    }
    return {k: v for k, v in extracted.items() if v not in (None, "")}


def _build_async_failure_message(
    *,
    job_id: str,
    percent: int,
    status_data: Dict[str, Any],
    meta_error: Dict[str, Any],
) -> str:
    """Mensagem curta e legível para o usuário (a versão estruturada vai em `meta_error`)."""
    headline = (
        meta_error.get("user_msg")
        or meta_error.get("message")
        or meta_error.get("failure_reason")
    )
    if headline:
        return f"Meta async report falhou (job={job_id}, {percent}%): {headline}"

    # Sem campo de erro: provavelmente quota/throttle ou job killed silenciosamente.
    hint = (
        "sem erro explícito na resposta — geralmente quota de async insights "
        "ou throttle no act_id; verifique meta_api_usage e tente novamente em alguns minutos"
    )
    return f"Meta async report falhou (job={job_id}, {percent}%): {hint}"


def _parse_error_envelope(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Normaliza um envelope `{"error": {...}}` da Meta em dict consumível.

    A Meta às vezes retorna `error_user_msg`/`error_user_title` no nível do error,
    às vezes não popula. Mantemos só os campos com valor.
    """
    err = payload.get("error") if isinstance(payload.get("error"), dict) else {}
    extracted = {
        "code": err.get("code"),
        "subcode": err.get("error_subcode"),
        "type": err.get("type"),
        "message": err.get("message"),
        "user_title": err.get("error_user_title"),
        "user_msg": err.get("error_user_msg"),
        "fbtrace_id": err.get("fbtrace_id"),
    }
    return {k: v for k, v in extracted.items() if v not in (None, "")}


class MetaJobClient:
    """Cliente para operações de jobs na Meta API."""
    
    def __init__(
        self,
        access_token: str,
        base_url: str = META_GRAPH_BASE_URL
    ):
        self.access_token = access_token
        self.base_url = base_url
    
    def start_job(
        self,
        act_id: str,
        time_range: Dict[str, str],
        filters: Optional[List[Dict[str, Any]]] = None,
        level: str = "ad",
        limit: int = 5000
    ) -> Dict[str, Any]:
        """
        Inicia um job async na Meta API.
        
        Args:
            act_id: ID da conta de anúncios
            time_range: Dict com 'since' e 'until'
            filters: Lista de filtros opcionais
            level: Nível do relatório (ad, adset, campaign)
            limit: Limite de registros
        
        Returns:
            Dict com:
            - success: bool
            - job_id: str (report_run_id)
            - error: str (se houver)
        """
        url = f"{self.base_url}{act_id}/insights?access_token={self.access_token}"
        json_filters = [json.dumps(f) for f in filters] if filters else []
        
        payload = {
            "fields": "actions,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,clicks,conversions,cost_per_conversion,cpm,ctr,frequency,impressions,inline_link_clicks,reach,spend,video_play_actions,video_thruplay_watched_actions,video_play_curve_actions,video_p50_watched_actions,website_ctr",
            "limit": limit,
            "level": level,
            "action_attribution_windows": "['7d_click','1d_view']",
            "use_account_attribution_setting": "true",
            "action_breakdowns": "action_type",
            "time_range": json.dumps(time_range),
            "time_increment": "1",
            "async": "true",
        }
        
        if json_filters:
            payload["filtering"] = "[" + ",".join(json_filters) + "]"
        
        try:
            response = requests.post(url, params=payload, timeout=REQUEST_TIMEOUT)
            response.raise_for_status()
            log_meta_usage(response, "MetaJobClient.start_job")
            resp_data = response.json()

            report_run_id = resp_data.get("report_run_id")
            if not report_run_id:
                return {"success": False, "error": "Failed to get report_run_id"}
            
            logger.info(f"[MetaJobClient] Job iniciado: {report_run_id}")
            return {"success": True, "job_id": str(report_run_id)}
            
        except requests.exceptions.HTTPError as http_err:
            decoded_text = urllib.parse.unquote(http_err.response.text)
            logger.error(f"[MetaJobClient] HTTP error ao iniciar job: {http_err.response.status_code} - {decoded_text[:200]}")
            return {"success": False, "error": f"Meta API Error {http_err.response.status_code}: {decoded_text}"}
        except Exception as err:
            logger.exception(f"[MetaJobClient] Erro ao iniciar job: {err}")
            return {"success": False, "error": str(err)}
    
    def get_status(self, job_id: str) -> Dict[str, Any]:
        """
        Verifica o status de um job na Meta API (rápido, sem paginação).
        
        Args:
            job_id: ID do job (report_run_id)
        
        Returns:
            Dict com:
            - success: bool
            - status: str ('running' | 'completed' | 'failed')
            - percent: int (0-100)
            - error: str (se houver)
        """
        try:
            status_url = f"{self.base_url}{job_id}?access_token={self.access_token}"
            
            response = requests.get(status_url, timeout=REQUEST_TIMEOUT)
            response.raise_for_status()
            log_meta_usage(response, "MetaJobClient.get_status")
            status_data = response.json()
            
            async_status = status_data.get("async_status", "Unknown")
            percent_completion = status_data.get("async_percent_completion", 0)

            # Mapear status da Meta para nosso status
            if async_status == "Job Completed" and percent_completion == 100:
                return {
                    "success": True,
                    "status": "completed",
                    "percent": 100
                }
            elif async_status == "Job Failed":
                # O endpoint /<job_id> raramente popula `error` direto. Truque descoberto
                # em produção: `GET /<job_id>?fields=error_message` retorna o envelope
                # de erro real (`(#3) ...`, `(#100) ...`, etc.). Combinamos as duas fontes.
                logger.error(
                    f"[MetaJobClient] Meta async report falhou job_id={job_id} "
                    f"percent={percent_completion} response={json.dumps(status_data)[:1500]}"
                )
                status_error = _extract_meta_error_fields(status_data)
                fetched_error = self._fetch_job_error(job_id)

                # Mergear: campos do fetch dedicado têm prioridade, mas mantemos
                # account_id/time_ref/dates do status (não vêm no fetch).
                meta_error = {**status_error, **fetched_error}

                if fetched_error:
                    logger.info(
                        "[MetaJobClient.error_fetch] job_id=%s code=%s subcode=%s fbtrace=%s message=%s",
                        job_id,
                        fetched_error.get("code"),
                        fetched_error.get("subcode"),
                        fetched_error.get("fbtrace_id"),
                        fetched_error.get("message"),
                    )

                error_msg = _build_async_failure_message(
                    job_id=job_id,
                    percent=percent_completion,
                    status_data=status_data,
                    meta_error=meta_error,
                )
                return {
                    "success": True,
                    "status": "failed",
                    "percent": percent_completion,
                    "error": error_msg,
                    "meta_error": meta_error,
                }
            else:
                return {
                    "success": True,
                    "status": "running",
                    "percent": percent_completion
                }
                
        except requests.exceptions.Timeout:
            logger.warning(f"[MetaJobClient] Timeout ao verificar status do job {job_id}")
            return {
                "success": False,
                "status": "unknown",
                "percent": 0,
                "error": "Timeout ao verificar status"
            }
        except requests.exceptions.HTTPError as http_err:
            decoded_text = urllib.parse.unquote(http_err.response.text)
            logger.error(f"[MetaJobClient] HTTP error ao verificar status: {http_err.response.status_code} - {decoded_text[:200]}")
            return {
                "success": False,
                "status": "error",
                "percent": 0,
                "error": f"HTTP {http_err.response.status_code}: {decoded_text[:200]}"
            }
        except Exception as err:
            logger.exception(f"[MetaJobClient] Erro ao verificar status do job {job_id}: {err}")
            return {
                "success": False,
                "status": "error",
                "percent": 0,
                "error": str(err)
            }

    def _fetch_job_error(self, job_id: str) -> Dict[str, Any]:
        """
        Recupera o envelope de erro real de um async report que falhou.

        Truque descoberto: `GET /<job_id>?fields=error_message` retorna a envelope
        `{"error": {message, code, type, error_subcode, error_user_msg, fbtrace_id}}`
        com a causa real do `Job Failed`. `?fields=error_code` retorna meta-erro de
        campo inválido — não usar.

        Defensivo: timeout curto, qualquer erro retorna dict vazio para não cascatear.
        """
        try:
            url = f"{self.base_url}{job_id}?access_token={self.access_token}&fields=error_message"
            response = requests.get(url, timeout=10)
            try:
                data = response.json()
            except ValueError:
                logger.warning("[MetaJobClient._fetch_job_error] resposta não-JSON para job_id=%s", job_id)
                return {}

            return _parse_error_envelope(data)
        except requests.exceptions.Timeout:
            logger.warning("[MetaJobClient._fetch_job_error] timeout para job_id=%s", job_id)
            return {}
        except Exception as err:
            logger.warning("[MetaJobClient._fetch_job_error] erro para job_id=%s: %s", job_id, err)
            return {}


def get_meta_job_client(access_token: str) -> MetaJobClient:
    """Factory function para criar MetaJobClient."""
    return MetaJobClient(access_token)




































