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

logger = logging.getLogger(__name__)

# Constantes
REQUEST_TIMEOUT = 30  # 30 segundos para verificação de status


class MetaJobClient:
    """Cliente para operações de jobs na Meta API."""
    
    def __init__(
        self,
        access_token: str,
        base_url: str = "https://graph.facebook.com/v22.0/"
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
                error_msg = status_data.get("error", "Job failed without specific error")
                return {
                    "success": True,
                    "status": "failed",
                    "percent": percent_completion,
                    "error": error_msg
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


def get_meta_job_client(access_token: str) -> MetaJobClient:
    """Factory function para criar MetaJobClient."""
    return MetaJobClient(access_token)
































