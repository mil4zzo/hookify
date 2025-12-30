import json
import time
import urllib.parse
import logging
from typing import Any, Dict, List, Optional, Union
import requests
from app.services.dataformatter import split_date_range, format_ads_for_api
from app.services.facebook_page_token_service import get_page_access_token_for_page_id

logger = logging.getLogger(__name__)

# Armazena metadados temporários de jobs para enriquecimento posterior
JOBS_META: Dict[str, Dict[str, Any]] = {}


def test_facebook_connection(access_token: str) -> Dict[str, Any]:
    """
    Testa se um token do Facebook está válido fazendo uma chamada simples à API.
    
    Args:
        access_token: Token de acesso do Facebook
    
    Returns:
        Dict com:
        - status: 'success' se válido, 'auth_error' se token expirado/inválido, 'error' para outros erros
        - message: Mensagem de erro (se houver)
        - data: Dados do usuário (se válido)
    """
    try:
        # Fazer chamada simples para /me com campos mínimos (mais rápido)
        url = f"https://graph.facebook.com/v22.0/me?access_token={access_token}"
        payload = {'fields': 'id,name'}
        
        response = requests.get(url, params=payload, timeout=10)
        response.raise_for_status()
        data = response.json()
        
        # Se chegou aqui, o token é válido
        return {'status': 'success', 'data': data}
        
    except requests.exceptions.HTTPError as http_err:
        error_data = http_err.response.json() if http_err.response.content else {}
        error_code = error_data.get('error', {}).get('code')
        error_message = error_data.get('error', {}).get('message', '')
        
        # Código 190 = Token expirado/inválido
        if error_code == 190:
            return {'status': 'auth_error', 'message': error_message or 'Token expirado ou inválido'}
        
        return {'status': 'http_error', 'message': error_message or str(http_err)}
        
    except Exception as err:
        logger.exception("test_facebook_connection error: %s", err)
        return {'status': 'error', 'message': str(err)}

class GraphAPI:
    def __init__(self, access_token: str, user_id: Optional[str] = None):
        self.base_url = "https://graph.facebook.com/v22.0/"
        self.access_token = access_token
        self.user_token = f"?access_token={access_token}"
        self.user_id = user_id
        self.limit = 5000
        self.level = "ad"
        self.action_attribution_windows = '["7d_click","1d_view"]'
        self.use_account_attribution_setting = "true"
        self.action_breakdowns = "action_type"

    def get_account_info(self) -> Dict[str, Any]:
        url = self.base_url + 'me' + self.user_token
        payload = {
            'fields': 'id,email,name,picture{url},adaccounts{name,id,account_status,user_tasks,instagram_accounts{username,id}}'
        }
        try:
            logger.debug("get_account_info url=%s payload=%s", url, payload)
            response = requests.get(url, params=payload)
            response.raise_for_status()
            data = response.json()
            
            # DEBUG: Log da resposta real do Meta
            logger.info("=== META API DEBUG - /me ===")
            logger.info(f"URL: {url}")
            logger.info(f"Payload: {payload}")
            logger.info(f"Status Code: {response.status_code}")
            logger.info(f"Response Headers: {dict(response.headers)}")
            logger.info(f"Response Body: {json.dumps(data, indent=2)}")
            logger.info("=== END DEBUG ===")
            
            # Normalização: coletar todas as adaccounts (paginado) e remover containers de paging
            try:
                if isinstance(data.get('adaccounts'), dict):
                    ad_node = data.get('adaccounts') or {}
                    accounts: List[Dict[str, Any]] = list(ad_node.get('data', []))

                    # Paginação interna do edge adaccounts
                    while isinstance(ad_node, dict) and 'paging' in ad_node and ad_node['paging'] and ad_node['paging'].get('next'):
                        next_url = ad_node['paging']['next']
                        next_resp = requests.get(next_url)
                        next_resp.raise_for_status()
                        next_json = next_resp.json()
                        accounts.extend(next_json.get('data', []))
                        ad_node = next_json

                    # Normalizar instagram_accounts para array simples (se vier como { data: [...] })
                    for acc in accounts:
                        insta = acc.get('instagram_accounts')
                        if isinstance(insta, dict):
                            acc['instagram_accounts'] = insta.get('data', [])

                    data['adaccounts'] = accounts

            except Exception as norm_err:
                # Não falhar a requisição por erro de normalização; logar e seguir
                logger.exception("Normalization error in get_account_info: %s", norm_err)

            return {'status': 'success', 'data': data}
        except requests.exceptions.HTTPError as http_err:
            decoded_url = urllib.parse.unquote(http_err.request.url)  # type: ignore
            decoded_text = urllib.parse.unquote(http_err.response.text)
            logger.error("get_account_info http_error: %s %s for %s", http_err.response.status_code, decoded_text, decoded_url)
            if http_err.response.json().get('error', {}).get('code') == 190:
                return {'status': 'auth_error', 'message': decoded_text}
            return {'status': 'http_error', 'message': decoded_text}
        except Exception as err:
            logger.exception("get_account_info error: %s", err)
            return {'status': 'error', 'message': str(err)}

    def get_adaccounts(self) -> Dict[str, Any]:
        url = self.base_url + 'me/adaccounts' + self.user_token
        payload = {'fields': 'name,id,account_status,user_tasks,instagram_accounts{username,id}'}
        try:
            logger.debug("get_adaccounts url=%s payload=%s", url, payload)
            response = requests.get(url, params=payload)
            response.raise_for_status()
            data = response.json()
            
            # DEBUG: Log da resposta real do Meta
            logger.info("=== META API DEBUG - /me/adaccounts ===")
            logger.info(f"URL: {url}")
            logger.info(f"Payload: {payload}")
            logger.info(f"Status Code: {response.status_code}")
            logger.info(f"Response Headers: {dict(response.headers)}")
            logger.info(f"Response Body: {json.dumps(data, indent=2)}")
            logger.info("=== END DEBUG ===")
            
            return {'status': 'success', 'data': data.get('data', [])}
        except requests.exceptions.HTTPError as http_err:
            decoded_url = urllib.parse.unquote(http_err.request.url)  # type: ignore
            decoded_text = urllib.parse.unquote(http_err.response.text)
            logger.error("get_adaccounts http_error: %s %s for %s", http_err.response.status_code, decoded_text, decoded_url)
            if http_err.response.json().get('error', {}).get('code') == 190:
                return {'status': 'auth_error', 'message': decoded_text}
            return {'status': 'http_error', 'message': decoded_text}
        except Exception as err:
            logger.exception("get_adaccounts error: %s", err)
            return {'status': 'error', 'message': str(err)}

    def get_page_access_token(self, actor_id: str) -> str:
        """
        Resolve o Page Access Token a partir do actor_id (Page ID) sem chamar /me/accounts.

        Estratégia:
        - Usa /me/adaccounts?fields=...promote_pages{access_token} com cache em memória por user_id.
        - Fallback: se não encontrar token da página, usa token do usuário (pode funcionar em alguns casos).
        """
        if not actor_id:
            return self.user_token

        # Sem user_id (ex.: fluxos de validação/diagnóstico), não cacheia e não tenta resolver.
        if not self.user_id:
            return self.user_token

        try:
            page_access_token = get_page_access_token_for_page_id(
                user_id=self.user_id,
                user_access_token=self.access_token,
                page_id=str(actor_id),
                graph_base_url=self.base_url,
            )
            if page_access_token:
                return f"?access_token={page_access_token}"
        except Exception as e:
            logger.warning("get_page_access_token fallback to user token due to error: %s", e)

        logger.warning(
            "Não foi possível resolver Page Access Token para page_id=%s. Usando token do usuário como fallback.",
            actor_id,
        )
        return self.user_token

    def get_ads_details(self, act_id: str, time_range: Dict[str, str], ads_ids: List[str]) -> Optional[List[Dict[str, Any]]]:
        if not ads_ids:
            return []
        
        # Processar em lotes menores para evitar timeouts e melhorar performance
        # Lotes de 50 anúncios por vez para balancear performance e confiabilidade
        batch_size = 50
        all_results = []
        total_batches = (len(ads_ids) + batch_size - 1) // batch_size
        
        logger.info(f"[GET_ADS_DETAILS] Iniciando busca de detalhes para {len(ads_ids)} anúncios em {total_batches} lote(s)")
        
        for i in range(0, len(ads_ids), batch_size):
            batch_ids = ads_ids[i:i + batch_size]
            batch_num = (i // batch_size) + 1
            
            logger.info(f"[GET_ADS_DETAILS] Processando lote {batch_num}/{total_batches} ({len(batch_ids)} anúncios)")
            
            url = self.base_url + act_id + '/ads' + self.user_token
            payload = {
                # Importante: incluir "id" para permitir mapeamento por ad_id quando necessário
                'fields': 'id,name,effective_status,creative{actor_id,body,call_to_action_type,instagram_permalink_url,object_type,title,video_id,thumbnail_url,effective_object_story_id{attachments,properties}},adcreatives{asset_feed_spec}',
                'limit': self.limit,
                'filtering': "[{'field':'id','operator':'IN','value':['" + "','".join(batch_ids) +"']}]",
            }
            
            try:
                logger.debug(f"[GET_ADS_DETAILS] Fazendo requisição para Meta API (lote {batch_num})...")
                # Timeout de 90 segundos por lote (suficiente para processar 50 anúncios)
                response = requests.get(url, params=payload, timeout=90)
                response.raise_for_status()
                batch_data = response.json().get('data', [])
                all_results.extend(batch_data)
                logger.info(f"[GET_ADS_DETAILS] Lote {batch_num} concluído: {len(batch_data)} anúncios retornados")
            except requests.exceptions.Timeout:
                logger.error(f"[GET_ADS_DETAILS] Timeout no lote {batch_num} após 90 segundos")
                # Continuar com próximos lotes mesmo se um falhar
                continue
            except requests.exceptions.HTTPError as http_err:
                decoded_text = urllib.parse.unquote(http_err.response.text)
                # Meta error: reduce the amount of data → fazer split recursivo
                if '"code":1' in decoded_text and "reduce the amount of data" in decoded_text:
                    logger.warning(f"[GET_ADS_DETAILS] Meta API pediu para reduzir dados no lote {batch_num}, dividindo...")
                    mid = len(batch_ids) // 2
                    first = self.get_ads_details(act_id, time_range, batch_ids[:mid])
                    second = self.get_ads_details(act_id, time_range, batch_ids[mid:])
                    if first is not None:
                        all_results.extend(first)
                    if second is not None:
                        all_results.extend(second)
                    continue
                decoded_url = urllib.parse.unquote(http_err.request.url) if http_err.request.url else 'decode-error'
                logger.error(f"[GET_ADS_DETAILS] HTTP error no lote {batch_num}: {http_err.response.status_code} - {decoded_text[:200]}")
                # Continuar com próximos lotes mesmo se um falhar
                continue
            except Exception as err:
                logger.exception(f"[GET_ADS_DETAILS] Erro inesperado no lote {batch_num}: {err}")
                # Continuar com próximos lotes mesmo se um falhar
                continue
        
        logger.info(f"[GET_ADS_DETAILS] Busca de detalhes concluída: {len(all_results)} anúncios retornados de {len(ads_ids)} solicitados")
        return all_results if all_results else None

    def get_ads_status_only(self, act_id: str, time_range: Dict[str, str], ads_ids: List[str]) -> Optional[List[Dict[str, Any]]]:
        """Busca apenas id + effective_status dos anúncios (requisição leve).

        Objetivo: permitir status correto por ad_id mesmo quando há múltiplos ad_ids com o mesmo ad_name,
        sem carregar payload pesado de creative/adcreatives.
        """
        if not ads_ids:
            return []

        batch_size = 50
        all_results: List[Dict[str, Any]] = []
        total_batches = (len(ads_ids) + batch_size - 1) // batch_size

        logger.info(f"[GET_ADS_STATUS_ONLY] Iniciando busca de status para {len(ads_ids)} anúncios em {total_batches} lote(s)")

        for i in range(0, len(ads_ids), batch_size):
            batch_ids = ads_ids[i:i + batch_size]
            batch_num = (i // batch_size) + 1
            logger.info(f"[GET_ADS_STATUS_ONLY] Processando lote {batch_num}/{total_batches} ({len(batch_ids)} anúncios)")

            url = self.base_url + act_id + '/ads' + self.user_token
            payload = {
                'fields': 'id,effective_status',
                'limit': self.limit,
                'filtering': "[{'field':'id','operator':'IN','value':['" + "','".join(batch_ids) + "']}]",
            }

            try:
                response = requests.get(url, params=payload, timeout=90)
                response.raise_for_status()
                batch_data = response.json().get('data', [])
                all_results.extend(batch_data)
                logger.info(f"[GET_ADS_STATUS_ONLY] Lote {batch_num} concluído: {len(batch_data)} anúncios retornados")
            except requests.exceptions.Timeout:
                logger.error(f"[GET_ADS_STATUS_ONLY] Timeout no lote {batch_num} após 90 segundos")
                continue
            except requests.exceptions.HTTPError as http_err:
                decoded_text = urllib.parse.unquote(http_err.response.text)
                # Meta error: reduce the amount of data → split recursivo
                if '"code":1' in decoded_text and "reduce the amount of data" in decoded_text:
                    logger.warning(f"[GET_ADS_STATUS_ONLY] Meta API pediu para reduzir dados no lote {batch_num}, dividindo...")
                    mid = len(batch_ids) // 2
                    first = self.get_ads_status_only(act_id, time_range, batch_ids[:mid])
                    second = self.get_ads_status_only(act_id, time_range, batch_ids[mid:])
                    if first is not None:
                        all_results.extend(first)
                    if second is not None:
                        all_results.extend(second)
                    continue
                decoded_url = urllib.parse.unquote(http_err.request.url) if http_err.request.url else 'decode-error'
                logger.error(f"[GET_ADS_STATUS_ONLY] HTTP error no lote {batch_num}: {http_err.response.status_code} - {decoded_text[:200]} ({decoded_url})")
                continue
            except Exception as err:
                logger.exception(f"[GET_ADS_STATUS_ONLY] Erro inesperado no lote {batch_num}: {err}")
                continue

        logger.info(f"[GET_ADS_STATUS_ONLY] Busca de status concluída: {len(all_results)} anúncios retornados de {len(ads_ids)} solicitados")
        return all_results if all_results else None

    def get_ads(self, act_id: str, time_range: Dict[str, str], filters: List[Dict[str, Any]]) -> Union[List[Dict[str, Any]], Any]:
        total_data: List[Dict[str, Any]] = []
        chunks = split_date_range(time_range, max_days=7)

        url = self.base_url + act_id + '/insights' + self.user_token
        json_filters = [json.dumps(f) for f in filters] if filters else []
        
        logger.info(f"=== FILTROS DEBUG ===")
        logger.info(f"Filtros recebidos: {filters}")
        logger.info(f"Filtros JSON: {json_filters}")
        logger.info(f"Total de chunks de data: {len(chunks)}")
        logger.info(f"Chunks: {chunks}")

        for chunk_index, dates in enumerate(chunks, start=1):
            payload = {
                'fields': 'actions,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,clicks,conversions,cost_per_conversion,cpm,ctr,frequency,impressions,inline_link_clicks,reach,spend,video_play_actions,video_thruplay_watched_actions,video_play_curve_actions,video_p50_watched_actions,website_ctr',
                'limit': self.limit,
                'level': self.level,
                'action_attribution_windows': self.action_attribution_windows,
                'use_account_attribution_setting': self.use_account_attribution_setting,
                'action_breakdowns': self.action_breakdowns,
                'time_range': json.dumps(dates),
                'time_increment': '1',
                'async': 'true',
            }
            # incluir filtering apenas quando houver filtros
            if json_filters:
                payload['filtering'] = '[' + ','.join(json_filters) + ']'
            try:
                # DEBUG: Log da requisição de insights
                logger.info("=== META API DEBUG - /insights (POST) ===")
                logger.info(f"URL: {url}")
                logger.info(f"Payload: {json.dumps(payload, indent=2)}")
                
                # 1) inicia job
                resp = requests.post(url, params=payload)
                resp.raise_for_status()
                resp_data = resp.json()
                
                logger.info(f"Status Code: {resp.status_code}")
                logger.info(f"Response Headers: {dict(resp.headers)}")
                logger.info(f"Response Body: {json.dumps(resp_data, indent=2)}")
                logger.info("=== END DEBUG ===")
                
                report_run_id = resp_data.get('report_run_id')
                if not report_run_id:
                    return {"status": "error", "message": "Failed to get report_run_id"}

                # 2) polling com logs de progresso
                status_url = self.base_url + report_run_id
                poll_count = 0
                max_polls = 60  # 5 minutos máximo (60 * 5s)
                
                logger.info(f"Iniciando polling para report_run_id: {report_run_id}")
                
                while poll_count < max_polls:
                    status_resp = requests.get(status_url + self.user_token)
                    status_resp.raise_for_status()
                    status_data = status_resp.json()
                    
                    async_status = status_data.get('async_status', 'Unknown')
                    percent_completion = status_data.get('async_percent_completion', 0)
                    
                    logger.info(f"Poll #{poll_count + 1}: Status={async_status}, Progress={percent_completion}%")
                    
                    if async_status == 'Job Completed' and percent_completion == 100:
                        logger.info("Job completado com sucesso!")
                        break
                    elif async_status == 'Job Failed':
                        error_msg = status_data.get('error', 'Job failed without specific error')
                        logger.error(f"Job falhou: {error_msg}")
                        return {"status": "job_failed", "message": f"Meta API job failed: {error_msg}"}
                    
                    poll_count += 1
                    time.sleep(5)
                
                if poll_count >= max_polls:
                    logger.error(f"Timeout no polling após {max_polls} tentativas")
                    return {"status": "timeout", "message": "Meta API job timeout - processamento demorou mais que 5 minutos"}

                # 3) coleta resultados
                insights_url = self.base_url + report_run_id + '/insights' + self.user_token + '&limit=500'
                insights_resp = requests.get(insights_url)
                insights_resp.raise_for_status()
                insights_data = insights_resp.json()
                
                # DEBUG: Log da resposta de insights
                logger.info("=== META API DEBUG - /insights (GET) ===")
                logger.info(f"URL: {insights_url}")
                logger.info(f"Status Code: {insights_resp.status_code}")
                logger.info(f"Response Headers: {dict(insights_resp.headers)}")
                logger.info(f"Response Body: {json.dumps(insights_data, indent=2)}")
                logger.info("=== END DEBUG ===")
                
                data = insights_data.get('data', [])
                while 'paging' in insights_resp.json() and 'next' in insights_resp.json()['paging']:
                    insights_resp = requests.get(insights_resp.json()['paging']['next'])
                    insights_resp.raise_for_status()
                    data.extend(insights_resp.json().get('data', []))

                if data:
                    # OTIMIZAÇÃO HÍBRIDA:
                    # - creative/mídia: buscar 1 ad_id por ad_name (payload pesado)
                    # - effective_status: buscar por ad_id (payload leve)
                    unique_ad_ids: set[str] = set()
                    ad_name_to_rep_ad_id: Dict[str, str] = {}
                    for ad in data:
                        ad_id = ad.get("ad_id")
                        ad_name = ad.get("ad_name")
                        if ad_id:
                            unique_ad_ids.add(str(ad_id))
                        if ad_name and ad_id and ad_name not in ad_name_to_rep_ad_id:
                            ad_name_to_rep_ad_id[str(ad_name)] = str(ad_id)

                    # 1) creative/mídia (1 por ad_name)
                    creative_by_name: Dict[str, Any] = {}
                    status_fallback_by_name: Dict[str, Any] = {}
                    videos_by_name: Dict[str, Any] = {}
                    rep_ids = list(ad_name_to_rep_ad_id.values())
                    ads_details = self.get_ads_details(act_id, time_range, rep_ids)
                    if ads_details is not None:
                        creative_by_name = {str(d.get('name') or ""): d.get('creative') for d in ads_details if d.get('name')}
                        status_fallback_by_name = {str(d.get('name') or ""): d.get('effective_status') for d in ads_details if d.get('name')}
                        videos_by_name = {
                            str(d.get('name') or ""): d['adcreatives']['data'][0]['asset_feed_spec']['videos']
                            for d in ads_details
                            if d.get('name')
                            and 'adcreatives' in d and d['adcreatives'].get('data')
                            and 'asset_feed_spec' in d['adcreatives']['data'][0]
                            and 'videos' in d['adcreatives']['data'][0]['asset_feed_spec']
                        }

                    # 2) status por ad_id (leve)
                    status_by_ad_id: Dict[str, Any] = {}
                    status_details = self.get_ads_status_only(act_id, time_range, list(unique_ad_ids))
                    if status_details is not None:
                        for d in status_details:
                            aid = d.get("id")
                            if aid:
                                status_by_ad_id[str(aid)] = d.get("effective_status")

                    # 3) merge nos insights
                    for ad in data:
                        ad_id = str(ad.get("ad_id") or "")
                        ad_name = str(ad.get("ad_name") or "")

                        if ad_name:
                            ad['creative'] = creative_by_name.get(ad_name)
                            adcreatives = videos_by_name.get(ad_name)
                            video_ids, video_thumbs = [], []
                            if adcreatives:
                                for v in adcreatives:
                                    video_ids.append(v.get('video_id'))
                                    video_thumbs.append(v.get('thumbnail_url'))
                            ad['adcreatives_videos_ids'] = video_ids
                            ad['adcreatives_videos_thumbs'] = video_thumbs

                        # status correto por ad_id; fallback por ad_name se não vier (evita regressão)
                        if ad_id:
                            ad['effective_status'] = status_by_ad_id.get(ad_id)
                        if not ad.get('effective_status') and ad_name:
                            ad['effective_status'] = status_fallback_by_name.get(ad_name)

                    total_data.extend(data)

            except requests.exceptions.HTTPError as http_err:
                decoded_url = urllib.parse.unquote(http_err.request.url)  # type: ignore
                decoded_text = urllib.parse.unquote(http_err.response.text)
                
                # DEBUG: Log detalhado do erro HTTP
                logger.error("=== META API ERROR - /insights ===")
                logger.error(f"HTTP Status: {http_err.response.status_code}")
                logger.error(f"Request URL: {decoded_url}")
                logger.error(f"Request Headers: {dict(http_err.request.headers) if http_err.request else 'N/A'}")
                logger.error(f"Response Headers: {dict(http_err.response.headers)}")
                logger.error(f"Response Body: {decoded_text}")
                logger.error("=== END ERROR DEBUG ===")
                
                return {"status": "http_error", "message": f"Meta API Error {http_err.response.status_code}: {decoded_text}"}
            except requests.exceptions.ConnectionError as conn_err:
                logger.error("=== CONNECTION ERROR ===")
                logger.error(f"Connection Error: {str(conn_err)}")
                logger.error(f"URL: {url}")
                logger.error("=== END CONNECTION ERROR ===")
                return {"status": "connection_error", "message": f"Falha de conexão com Meta API: {str(conn_err)}"}
            except requests.exceptions.Timeout as timeout_err:
                logger.error("=== TIMEOUT ERROR ===")
                logger.error(f"Timeout Error: {str(timeout_err)}")
                logger.error(f"URL: {url}")
                logger.error("=== END TIMEOUT ERROR ===")
                return {"status": "timeout_error", "message": f"Timeout na Meta API: {str(timeout_err)}"}
            except Exception as err:
                logger.exception("get_ads error: %s", err)
                return {"status": "error", "message": str(err)}

        return total_data

    def start_ads_job(self, act_id: str, time_range: Dict[str, str], filters: List[Dict[str, Any]]) -> Union[str, Dict[str, Any]]:
        """Start async ads job and return report_run_id."""
        url = self.base_url + act_id + '/insights' + self.user_token
        json_filters = [json.dumps(f) for f in filters] if filters else []
        
        payload = {
            'fields': 'actions,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,clicks,conversions,cost_per_conversion,cpm,ctr,frequency,impressions,inline_link_clicks,reach,spend,video_play_actions,video_thruplay_watched_actions,video_play_curve_actions,video_p50_watched_actions,website_ctr',
            'limit': self.limit,
            'level': self.level,
            'action_attribution_windows': self.action_attribution_windows,
            'use_account_attribution_setting': self.use_account_attribution_setting,
            'action_breakdowns': self.action_breakdowns,
            'time_range': json.dumps(time_range),
            'time_increment': '1',
            'async': 'true',
        }
        if json_filters:
            payload['filtering'] = '[' + ','.join(json_filters) + ']'
        
        try:
            resp = requests.post(url, params=payload)
            resp.raise_for_status()
            resp_data = resp.json()
            
            report_run_id = resp_data.get('report_run_id')
            if not report_run_id:
                return {"status": "error", "message": "Failed to get report_run_id"}
            
            # Guardar metadados do job para enriquecimento posterior
            JOBS_META[report_run_id] = {"act_id": act_id, "time_range": time_range}

            return report_run_id
            
        except requests.exceptions.HTTPError as http_err:
            decoded_text = urllib.parse.unquote(http_err.response.text)
            return {"status": "http_error", "message": f"Meta API Error {http_err.response.status_code}: {decoded_text}"}
        except Exception as err:
            logger.exception("start_ads_job error: %s", err)
            return {"status": "error", "message": str(err)}

    def get_job_progress(self, report_run_id: str) -> Dict[str, Any]:
        """Get progress of async job."""
        try:
            status_url = self.base_url + report_run_id + self.user_token
            status_resp = requests.get(status_url)
            status_resp.raise_for_status()
            status_data = status_resp.json()
            
            async_status = status_data.get('async_status', 'Unknown')
            percent_completion = status_data.get('async_percent_completion', 0)
            
            if async_status == 'Job Completed' and percent_completion == 100:
                # Job completed, get results
                insights_url = self.base_url + report_run_id + '/insights' + self.user_token + '&limit=500'
                logger.info(f"=== PAGINAÇÃO DEBUG - Iniciando coleta de dados ===")
                logger.info(f"URL inicial: {insights_url}")
                
                # Inicializar detalhes de progresso
                progress_details = {
                    "stage": "paginação",
                    "page_count": 0,
                    "total_collected": 0,
                    "enrichment_batches": 0,
                    "enrichment_total": 0,
                    "ads_before_dedup": 0,
                    "ads_after_dedup": 0,
                    "ads_enriched": 0,
                    "ads_formatted": 0
                }
                
                insights_resp = requests.get(insights_url)
                insights_resp.raise_for_status()
                insights_data = insights_resp.json()
                
                data = insights_data.get('data', [])
                logger.info(f"Página 1: {len(data)} anúncios coletados")
                progress_details["page_count"] = 1
                progress_details["total_collected"] = len(data)
                
                # Handle pagination
                page_count = 1
                total_collected = len(data)
                
                while 'paging' in insights_resp.json() and 'next' in insights_resp.json()['paging']:
                    page_count += 1
                    next_url = insights_resp.json()['paging']['next']
                    logger.info(f"Página {page_count}: Coletando dados de {next_url}")
                    
                    insights_resp = requests.get(next_url)
                    insights_resp.raise_for_status()
                    page_data = insights_resp.json().get('data', [])
                    
                    data.extend(page_data)
                    total_collected += len(page_data)
                    logger.info(f"Página {page_count}: {len(page_data)} anúncios coletados (Total: {total_collected})")
                    progress_details["page_count"] = page_count
                    progress_details["total_collected"] = total_collected
                    
                    # Safety check para evitar loops infinitos
                    if page_count > 100:
                        logger.warning(f"PAGINAÇÃO: Parando após {page_count} páginas para evitar loop infinito")
                        break
                
                logger.info(f"=== PAGINAÇÃO COMPLETA ===")
                logger.info(f"Total de páginas processadas: {page_count}")
                logger.info(f"Total de anúncios coletados: {total_collected}")
                logger.info(f"Tamanho final do array data: {len(data)}")
                
                # Enriquecimento com detalhes do anúncio (creative e asset_feed_spec videos)
                job_meta = JOBS_META.get(report_run_id)
                progress_details["stage"] = "enriquecimento"
                progress_details["ads_before_dedup"] = len(data)
                
                if job_meta and data:
                    try:
                        logger.info(f"=== ENRIQUECIMENTO DEBUG - Iniciando processo ===")
                        logger.info(f"Total de anúncios antes da deduplicação: {len(data)}")
                        
                        # OTIMIZAÇÃO HÍBRIDA:
                        # - creative/mídia: buscar 1 ad_id por ad_name (payload pesado)
                        # - effective_status: buscar por ad_id (payload leve)
                        unique_ad_ids: set[str] = set()
                        ad_name_to_rep_ad_id: Dict[str, str] = {}
                        for ad in data:
                            ad_name = ad.get('ad_name')
                            ad_id = ad.get('ad_id')
                            if ad_id:
                                unique_ad_ids.add(str(ad_id))
                            if ad_name and ad_id and str(ad_name) not in ad_name_to_rep_ad_id:
                                ad_name_to_rep_ad_id[str(ad_name)] = str(ad_id)
                        
                        unique_ids = list(ad_name_to_rep_ad_id.values())
                        logger.info(f"Anúncios únicos para CREATIVE após deduplicação por nome: {len(unique_ids)}")
                        logger.info(f"Anúncios removidos na deduplicação (somente para CREATIVE): {len(data) - len(unique_ids)}")
                        progress_details["ads_after_dedup"] = len(unique_ids)
                        
                        # Calcular número de lotes para enriquecimento
                        batch_size = 50
                        total_batches = (len(unique_ids) + batch_size - 1) // batch_size
                        progress_details["enrichment_total"] = total_batches
                        
                        logger.info(f"[ENRIQUECIMENTO] Iniciando busca de detalhes de CREATIVE (1 por ad_name) na Meta API...")
                        ads_details = self.get_ads_details(job_meta['act_id'], job_meta['time_range'], unique_ids)
                        logger.info(f"[ENRIQUECIMENTO] Detalhes de CREATIVE coletados: {len(ads_details) if ads_details else 0}")
                        progress_details["ads_enriched"] = len(ads_details) if ads_details else 0
                        progress_details["enrichment_batches"] = total_batches

                        creative_by_name: Dict[str, Any] = {}
                        status_fallback_by_name: Dict[str, Any] = {}
                        videos_by_name: Dict[str, Any] = {}
                        if ads_details is not None:
                            creative_by_name = {str(d.get('name') or ""): d.get('creative') for d in ads_details if d.get('name')}
                            status_fallback_by_name = {str(d.get('name') or ""): d.get('effective_status') for d in ads_details if d.get('name')}
                            videos_by_name = {
                                str(d.get('name') or ""): d['adcreatives']['data'][0]['asset_feed_spec']['videos']
                                for d in ads_details
                                if d.get('name')
                                and 'adcreatives' in d and d['adcreatives'].get('data')
                                and 'asset_feed_spec' in d['adcreatives']['data'][0]
                                and 'videos' in d['adcreatives']['data'][0]['asset_feed_spec']
                            }

                        logger.info(f"[ENRIQUECIMENTO] Iniciando busca de STATUS (por ad_id) na Meta API...")
                        status_details = self.get_ads_status_only(job_meta['act_id'], job_meta['time_range'], list(unique_ad_ids))
                        status_by_ad_id: Dict[str, Any] = {}
                        if status_details is not None:
                            for d in status_details:
                                aid = d.get("id")
                                if aid:
                                    status_by_ad_id[str(aid)] = d.get("effective_status")

                        for ad in data:
                            ad_id = str(ad.get('ad_id') or "")
                            ad_name = str(ad.get('ad_name') or "")

                            if ad_name:
                                ad['creative'] = creative_by_name.get(ad_name)
                                adcreatives = videos_by_name.get(ad_name)
                                video_ids, video_thumbs = [], []
                                if adcreatives:
                                    for v in adcreatives:
                                        video_ids.append(v.get('video_id'))
                                        video_thumbs.append(v.get('thumbnail_url'))
                                ad['adcreatives_videos_ids'] = video_ids
                                ad['adcreatives_videos_thumbs'] = video_thumbs

                            if ad_id:
                                ad['effective_status'] = status_by_ad_id.get(ad_id)
                            if not ad.get('effective_status') and ad_name:
                                ad['effective_status'] = status_fallback_by_name.get(ad_name)
                    except Exception:
                        logger.exception("Erro no enriquecimento de detalhes dos anúncios")
                
                logger.info(f"=== RESULTADO FINAL (RAW) ===")
                logger.info(f"Anúncios coletados (raw): {len(data)}")
                progress_details["stage"] = "formatação"

                # Formatar para o schema do frontend antes de retornar
                try:
                    act_id = job_meta.get('act_id') if job_meta else ''
                    formatted = format_ads_for_api(data, act_id or '')
                    logger.info(f"=== RESULTADO FINAL (FORMATADO) ===")
                    logger.info(f"Anúncios formatados: {len(formatted)}")
                    progress_details["ads_formatted"] = len(formatted)
                    progress_details["stage"] = "completo"
                    
                    if formatted:
                        sample = formatted[0]
                        logger.info(f"Campos exemplo: {list(sample.keys())[:12]} ... total={len(sample.keys())}")
                        # Tipos de alguns campos chave
                        logger.info(f"Tipos exemplo: clicks={type(sample.get('clicks'))}, ctr={type(sample.get('ctr'))}, actions={type(sample.get('actions'))}")
                    return {
                        "status": "completed",
                        "progress": 100,
                        "message": f"Job completado! {len(formatted)} anúncios encontrados.",
                        "data": formatted,
                        "details": progress_details
                    }
                except Exception:
                    logger.exception("Falha ao formatar anúncios para resposta do frontend")
                    # Fallback: retornar raw
                    progress_details["stage"] = "completo"
                    progress_details["ads_formatted"] = len(data)
                    return {
                        "status": "completed",
                        "progress": 100,
                        "message": f"Job completado! {len(data)} anúncios encontrados (raw).",
                        "data": data,
                        "details": progress_details
                    }
            elif async_status == 'Job Failed':
                error_msg = status_data.get('error', 'Job failed without specific error')
                return {
                    "status": "failed",
                    "progress": 100,
                    "message": f"Job falhou: {error_msg}"
                }
            else:
                return {
                    "status": "running",
                    "progress": percent_completion,
                    "message": f"Processando... {percent_completion}%"
                }
                
        except Exception as err:
            logger.exception("get_job_progress error: %s", err)
            return {
                "status": "error",
                "progress": 0,
                "message": str(err)
            }

    def get_video_source_url(self, video_id: Union[str, int], actor_id: str) -> Union[str, Dict[str, Any]]:
        if not actor_id or not video_id:
            raise ValueError("actor_id and video_id are required")

        try:
            # Tentar obter token da página (com fallback para token do usuário)
            page_token = self.get_page_access_token(actor_id)
            video_url = self.base_url + str(video_id) + page_token
            payload = {'fields': 'source'}
            resp = requests.get(video_url, params=payload)
            resp.raise_for_status()
            source = resp.json().get('source')
            if source:
                return source
            return {"status": "not_found", "message": "No video source returned"}
        except requests.exceptions.HTTPError as http_err:
            decoded_url = urllib.parse.unquote(http_err.request.url)  # type: ignore
            decoded_text = urllib.parse.unquote(http_err.response.text)
            try:
                error_data = json.loads(decoded_text)
                error_message = error_data.get('error', {}).get('message', decoded_text)
                error_code = error_data.get('error', {}).get('code')
                
                # Mensagens de erro mais claras baseadas no código de erro
                if error_code == 100:
                    user_friendly_message = (
                        f"Sua conta do Facebook não tem acesso à página {actor_id}. "
                        f"O vídeo pode estar associado a uma página que você não gerencia ou que foi removida."
                    )
                elif error_code == 190:
                    user_friendly_message = (
                        f"Token do Facebook expirado ou inválido. "
                        f"Por favor, reconecte sua conta do Facebook."
                    )
                elif "does not exist" in error_message.lower() or "not found" in error_message.lower():
                    user_friendly_message = (
                        f"O vídeo {video_id} não foi encontrado ou não está mais disponível. "
                        f"Isso pode acontecer se o anúncio foi removido ou se você não tem permissão para acessá-lo."
                    )
                else:
                    user_friendly_message = (
                        f"Não foi possível acessar o vídeo. "
                        f"Erro da API do Facebook: {error_message}"
                    )
            except Exception:
                user_friendly_message = (
                    f"Não foi possível acessar o vídeo do anúncio. "
                    f"Verifique se sua conta do Facebook tem as permissões necessárias."
                )
            
            logger.error("get_video_source_url http_error: %s %s for %s", http_err.response.status_code, decoded_text, decoded_url)
            return {
                'status': f"Status: {http_err.response.status_code} - http_error", 
                'message': user_friendly_message
            }
        except Exception as err:
            error_message = str(err)
            if "Page with ID" in error_message and "not found" in error_message:
                user_friendly_message = (
                    f"Sua conta do Facebook não tem acesso à página {actor_id}. "
                    f"O vídeo pode estar associado a uma página que você não gerencia."
                )
            else:
                user_friendly_message = (
                    f"Erro ao acessar o vídeo: {error_message}"
                )
            
            logger.exception("get_video_source_url error: %s", err)
            return {'status': 'error', 'message': user_friendly_message}
