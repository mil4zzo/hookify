import json
import time
import urllib.parse
import logging
from typing import Any, BinaryIO, Callable, Dict, List, Optional, Union
import requests
from app.core.config import META_GRAPH_BASE_URL
from app.services.facebook_page_token_service import get_page_access_token_for_page_id
from app.services.meta_api_errors import (
    MetaAPIError,
    extract_data_or_raise,
    sanitize_error_dict_for_log,
)
from app.services.meta_usage_logger import log_meta_usage

logger = logging.getLogger(__name__)


class GraphAPIError(Exception):
    """Raised when a Meta Graph API call fails."""

    def __init__(self, status: str, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


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
        url = f"{META_GRAPH_BASE_URL}me?access_token={access_token}"
        payload = {'fields': 'id,name'}
        
        response = requests.get(url, params=payload, timeout=10)
        response.raise_for_status()
        log_meta_usage(response, "GraphAPI.test_connection")
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
        self.base_url = META_GRAPH_BASE_URL
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
            response = requests.get(url, params=payload, timeout=10)
            response.raise_for_status()
            log_meta_usage(response, "GraphAPI.get_account_info")
            data = response.json()

            logger.debug("get_account_info status=%s adaccounts=%d", response.status_code, len(data.get('adaccounts', {}).get('data', [])) if isinstance(data.get('adaccounts'), dict) else 0)

            # Normalização: coletar todas as adaccounts (paginado) e remover containers de paging
            try:
                if isinstance(data.get('adaccounts'), dict):
                    ad_node = data.get('adaccounts') or {}
                    accounts: List[Dict[str, Any]] = list(ad_node.get('data', []))

                    # Paginação interna do edge adaccounts
                    while isinstance(ad_node, dict) and 'paging' in ad_node and ad_node['paging'] and ad_node['paging'].get('next'):
                        next_url = ad_node['paging']['next']
                        next_resp = requests.get(next_url, timeout=10)
                        next_resp.raise_for_status()
                        log_meta_usage(next_resp, "GraphAPI.get_account_info.pagination")
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
            decoded_text = urllib.parse.unquote(http_err.response.text)
            logger.error("get_account_info http_error: status=%s body=%s", http_err.response.status_code, decoded_text[:300])
            try:
                error_code = http_err.response.json().get('error', {}).get('code')
            except (ValueError, AttributeError):
                error_code = None
            if error_code == 190:
                return {'status': 'auth_error', 'message': decoded_text}
            return {'status': 'http_error', 'message': decoded_text}
        except Exception as err:
            logger.exception("get_account_info error: %s", err)
            return {'status': 'error', 'message': str(err)}

    def get_adaccounts(self) -> Dict[str, Any]:
        url = self.base_url + 'me/adaccounts' + self.user_token
        payload = {'fields': 'name,id,account_status,user_tasks,instagram_accounts{username,id}'}
        try:
            response = requests.get(url, params=payload, timeout=10)
            response.raise_for_status()
            log_meta_usage(response, "GraphAPI.get_adaccounts")
            data = response.json()

            logger.debug("get_adaccounts status=%s count=%d", response.status_code, len(data.get('data', [])))

            return {'status': 'success', 'data': data.get('data', [])}
        except requests.exceptions.HTTPError as http_err:
            decoded_text = urllib.parse.unquote(http_err.response.text)
            logger.error("get_adaccounts http_error: status=%s body=%s", http_err.response.status_code, decoded_text[:300])
            try:
                error_code = http_err.response.json().get('error', {}).get('code')
            except (ValueError, AttributeError):
                error_code = None
            if error_code == 190:
                return {'status': 'auth_error', 'message': decoded_text}
            return {'status': 'http_error', 'message': decoded_text}
        except Exception as err:
            logger.exception("get_adaccounts error: %s", err)
            return {'status': 'error', 'message': str(err)}

    def start_ads_job(self, act_id: str, time_range: Dict[str, str], filters: List[Dict[str, Any]]) -> str:
        """Start async ads job and return report_run_id.

        Raises:
            GraphAPIError: on any Meta API or network error.
        """
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

        # Log full params for Graph API Explorer debugging (no token)
        explorer_params = {k: v for k, v in payload.items()}
        logger.info(
            "[GraphAPI] === Graph API Explorer ===\n"
            "  Endpoint : %s/insights\n"
            "  Method   : POST\n"
            "  Params   :\n%s",
            act_id,
            '\n'.join(f"    {k} = {v}" for k, v in explorer_params.items()),
        )

        try:
            resp = requests.post(url, params=payload, timeout=30)
            resp.raise_for_status()
            log_meta_usage(resp, "GraphAPI.start_ads_job")
            resp_data = resp.json()

            report_run_id = resp_data.get('report_run_id')
            if not report_run_id:
                raise GraphAPIError("error", "Failed to get report_run_id")

            return report_run_id

        except requests.exceptions.HTTPError as http_err:
            decoded_text = urllib.parse.unquote(http_err.response.text)
            raise GraphAPIError("http_error", f"Meta API Error {http_err.response.status_code}: {decoded_text}") from http_err
        except GraphAPIError:
            raise
        except Exception as err:
            logger.exception("start_ads_job error: %s", err)
            raise GraphAPIError("error", str(err)) from err

    ## GET MEDIA SOURCE URLS

    def get_page_access_token(self, actor_id: str) -> str:
        """
        Resolve o Page Access Token a partir do actor_id (Page ID) via /me/accounts.

        Estratégia:
        - Usa GET /me/accounts com cache em memória por user_id.
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

    def get_video_owner_page_id(self, video_id: Union[str, int]) -> Optional[str]:
        """Resolve o page_id do dono real do vídeo via GET /{video_id}?fields=from."""
        try:
            video_url = self.base_url + str(video_id) + self.user_token
            resp = requests.get(video_url, params={'fields': 'from'}, timeout=15)
            resp.raise_for_status()
            log_meta_usage(resp, "GraphAPI.get_video_owner_page_id")
            from_data = resp.json().get('from')
            if from_data and from_data.get('id'):
                owner_id = str(from_data['id'])
                logger.info("Video %s owner resolved: from.id=%s", video_id, owner_id)
                return owner_id
        except Exception as e:
            logger.warning("get_video_owner_page_id failed for video %s: %s", video_id, e)
        return None

    def _fetch_video_source_with_token(self, video_id: Union[str, int], page_token: str) -> Optional[str]:
        """Tenta buscar source do vídeo com o token fornecido. Retorna source ou None."""
        try:
            video_url = self.base_url + str(video_id) + page_token
            resp = requests.get(video_url, params={'fields': 'source'}, timeout=15)
            resp.raise_for_status()
            log_meta_usage(resp, "GraphAPI.fetch_video_source")
            return resp.json().get('source')
        except Exception:
            return None

    def get_video_source_url(self, video_id: Union[str, int], actor_id: Optional[str] = None, video_owner_page_id: Optional[str] = None) -> Union[str, Dict[str, Any]]:
        if not video_id:
            raise ValueError("video_id is required")

        actor_id = str(actor_id or "").strip()
        resolved_owner_page_id = str(video_owner_page_id or "").strip() or None

        try:
            # 1. Se já temos o owner, usar direto
            if resolved_owner_page_id:
                owner_token = self.get_page_access_token(resolved_owner_page_id)
                source = self._fetch_video_source_with_token(video_id, owner_token)
                if source:
                    return {"source": source, "video_owner_page_id": resolved_owner_page_id}

            # 2. Se não temos owner, resolver via GET /{video_id}?fields=from
            if not resolved_owner_page_id:
                resolved_owner_page_id = self.get_video_owner_page_id(video_id)

            # 3. Tentar com token do owner resolvido (se diferente do actor_id)
            if resolved_owner_page_id and resolved_owner_page_id != actor_id:
                owner_token = self.get_page_access_token(resolved_owner_page_id)
                source = self._fetch_video_source_with_token(video_id, owner_token)
                if source:
                    return {"source": source, "video_owner_page_id": resolved_owner_page_id}

            # 4. Fallback: tentar com actor_id (comportamento original)
            if actor_id:
                page_token = self.get_page_access_token(actor_id)
                video_url = self.base_url + str(video_id) + page_token
                payload = {'fields': 'source'}
                resp = requests.get(video_url, params=payload, timeout=15)
                resp.raise_for_status()
                log_meta_usage(resp, "GraphAPI.get_video_source_url")
                source = resp.json().get('source')
                if source:
                    return {"source": source, "video_owner_page_id": resolved_owner_page_id or actor_id}
            return {"status": "not_found", "message": "No video source returned"}
        except requests.exceptions.HTTPError as http_err:
            decoded_text = urllib.parse.unquote(http_err.response.text)
            owner_reference = resolved_owner_page_id or actor_id or "desconhecida"
            try:
                error_data = json.loads(decoded_text)
                error_message = error_data.get('error', {}).get('message', decoded_text)
                error_code = error_data.get('error', {}).get('code')

                # Mensagens de erro mais claras baseadas no código de erro
                if error_code == 100:
                    user_friendly_message = (
                        f"Sua conta do Facebook não tem acesso à página {owner_reference}. "
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

            logger.error(
                "get_video_source_url http_error: status=%s video_id=%s actor_id=%s owner_page_id=%s body=%s",
                http_err.response.status_code,
                video_id,
                actor_id,
                resolved_owner_page_id,
                decoded_text[:300],
            )
            return {
                'status': f"Status: {http_err.response.status_code} - http_error",
                'message': user_friendly_message
            }
        except Exception as err:
            error_message = str(err)
            owner_reference = resolved_owner_page_id or actor_id or "desconhecida"
            if "Page with ID" in error_message and "not found" in error_message:
                user_friendly_message = (
                    f"Sua conta do Facebook não tem acesso à página {owner_reference}. "
                    f"O vídeo pode estar associado a uma página que você não gerencia."
                )
            else:
                user_friendly_message = (
                    f"Erro ao acessar o vídeo: {error_message}"
                )

            logger.exception("get_video_source_url error: %s", err)
            return {'status': 'error', 'message': user_friendly_message}

    def get_image_source_url(self, ad_id: str, actor_id: str) -> Dict[str, Any]:
        """Fetch a fresh, high-quality image URL for an image ad.

        Cascade:
        1. Read ad + creative (account_id, asset_feed_spec, object_story_spec, image_hash, image_url).
        2. Collect candidate image hashes in priority order.
        3. If any hash, query /act_{account_id}/adimages to get permalink_url/url (stable, original size).
        4. Fallback to creative.image_url. Never use thumbnail_url (low quality).
        """
        if not actor_id or not ad_id:
            raise ValueError("actor_id and ad_id are required")
        try:
            page_token = self.get_page_access_token(actor_id)
            ad_url = self.base_url + str(ad_id) + page_token
            fields = "account_id,creative{id,image_hash,image_url,asset_feed_spec,object_story_spec}"
            resp = requests.get(ad_url, params={"fields": fields}, timeout=15)
            resp.raise_for_status()
            log_meta_usage(resp, "GraphAPI.get_image_source_url.ad_read")

            data = resp.json() or {}
            account_id_raw = str(data.get("account_id") or "").strip()
            creative = data.get("creative") or {}
            creative_image_url = creative.get("image_url")

            # Step 2: collect candidate hashes in priority order, deduped.
            candidate_hashes: List[str] = []
            seen = set()

            def _add_hash(h: Optional[str]) -> None:
                if h and isinstance(h, str) and h not in seen:
                    seen.add(h)
                    candidate_hashes.append(h)

            asset_feed = creative.get("asset_feed_spec") or {}
            for img in (asset_feed.get("images") or []):
                if isinstance(img, dict):
                    _add_hash(img.get("hash"))

            oss = creative.get("object_story_spec") or {}
            link_data = oss.get("link_data") or {}
            _add_hash(link_data.get("image_hash"))
            photo_data = oss.get("photo_data") or {}
            _add_hash(photo_data.get("image_hash"))

            _add_hash(creative.get("image_hash"))

            # Step 3: resolve via /adimages when we have hashes and account_id.
            if candidate_hashes and account_id_raw:
                act_id = account_id_raw if account_id_raw.startswith("act_") else f"act_{account_id_raw}"
                try:
                    adimages_url = self.base_url + act_id + "/adimages" + self.user_token
                    adimages_resp = requests.get(
                        adimages_url,
                        params={
                            "hashes": json.dumps(candidate_hashes),
                            "fields": "hash,permalink_url,url,original_width,original_height",
                        },
                        timeout=15,
                    )
                    adimages_resp.raise_for_status()
                    log_meta_usage(adimages_resp, "GraphAPI.get_image_source_url.adimages_lookup")

                    by_hash: Dict[str, Dict[str, Any]] = {}
                    for item in (adimages_resp.json() or {}).get("data", []):
                        h = item.get("hash")
                        if h:
                            by_hash[h] = item

                    for h in candidate_hashes:
                        item = by_hash.get(h)
                        if not item:
                            continue
                        url = item.get("permalink_url") or item.get("url")
                        if url:
                            return {"image_url": url}
                except requests.exceptions.HTTPError as http_err:
                    decoded_text = urllib.parse.unquote(http_err.response.text)
                    logger.warning(
                        "get_image_source_url adimages_lookup http_error: status=%s act_id=%s body=%s",
                        http_err.response.status_code, act_id, decoded_text[:300],
                    )
                except Exception as lookup_err:
                    logger.warning("get_image_source_url adimages_lookup failed: %s", lookup_err)

            # Step 4: fallback to creative.image_url. Never thumbnail_url.
            if creative_image_url:
                logger.info(
                    "get_image_source_url falling back to creative.image_url ad_id=%s hashes_found=%d",
                    ad_id, len(candidate_hashes),
                )
                return {"image_url": creative_image_url}

            return {"status": "not_found", "message": "No image hash or URL available"}
        except requests.exceptions.HTTPError as http_err:
            decoded_text = urllib.parse.unquote(http_err.response.text)
            logger.error("get_image_source_url http_error: status=%s ad_id=%s body=%s",
                        http_err.response.status_code, ad_id, decoded_text[:300])
            return {"status": f"Status: {http_err.response.status_code} - http_error", "message": decoded_text}
        except Exception as err:
            logger.exception("get_image_source_url error: %s", err)
            return {"status": "error", "message": str(err)}

    ## MANAGE STATUS

    def _update_entity_status(self, entity_id: str, status: str) -> Dict[str, Any]:
        """
        Atualiza o campo `status` de uma entidade no Meta via Graph API.

        Endpoint:
          POST https://graph.facebook.com/v24.0/{entity_id}?access_token=...

        Body:
          {"status": "PAUSED" | "ACTIVE"}
        """
        if not entity_id:
            return {"status": "error", "message": "entity_id é obrigatório"}
        if status not in ("PAUSED", "ACTIVE"):
            return {"status": "error", "message": "status deve ser PAUSED ou ACTIVE"}

        url = f"{self.base_url}{entity_id}"
        params = {"access_token": self.access_token}
        payload = {"status": status}

        try:
            resp = requests.post(url, params=params, json=payload, timeout=30)
            resp.raise_for_status()
            log_meta_usage(resp, "GraphAPI.update_entity_status")
            data = resp.json() if resp.content else {}

            # Normalmente, a API retorna {"success": true}
            if isinstance(data, dict) and data.get("success") is True:
                return {"status": "success", "data": data}

            # Se o response for incomum, ainda assim considerar sucesso HTTP como sucesso
            return {"status": "success", "data": data}

        except requests.exceptions.HTTPError as http_err:
            error_data = http_err.response.json() if http_err.response is not None and http_err.response.content else {}
            error_obj = error_data.get("error", {}) if isinstance(error_data, dict) else {}
            error_code = error_obj.get("code")
            error_message = error_obj.get("message") or str(http_err)

            if error_code == 190:
                return {"status": "auth_error", "message": error_message, "error": error_obj}

            return {"status": "http_error", "message": error_message, "error": error_obj}

        except Exception as err:
            logger.exception("_update_entity_status error: %s", err)
            return {"status": "error", "message": str(err)}

    def _handle_graph_request(
        self,
        *,
        method: str,
        path: str,
        operation_name: str,
        params: Optional[Dict[str, Any]] = None,
        json_payload: Optional[Dict[str, Any]] = None,
        data: Optional[Dict[str, Any]] = None,
        files: Optional[Dict[str, Any]] = None,
        timeout: int = 60,
    ) -> Dict[str, Any]:
        url = f"{self.base_url}{path}"
        request_params = {"access_token": self.access_token}
        if params:
            request_params.update(params)

        try:
            response = requests.request(
                method=method,
                url=url,
                params=request_params,
                json=json_payload,
                data=data,
                files=files,
                timeout=timeout,
            )
            response.raise_for_status()
            log_meta_usage(response, operation_name)
            return {"status": "success", "data": response.json() if response.content else {}}
        except requests.exceptions.HTTPError as http_err:
            status_code = http_err.response.status_code if http_err.response is not None else None
            error_data = {}
            response_text = ""
            if http_err.response is not None and http_err.response.content:
                response_text = http_err.response.text
                try:
                    error_data = http_err.response.json()
                except ValueError:
                    error_data = {}
            error_obj = error_data.get("error", {}) if isinstance(error_data, dict) else {}
            error_code = error_obj.get("code")
            error_message = error_obj.get("message") or response_text[:500] or str(http_err)
            if isinstance(error_obj, dict) and error_obj:
                logger.warning(
                    "%s Meta API HTTP error: %s",
                    operation_name,
                    sanitize_error_dict_for_log(dict(error_obj)),
                )
            if json_payload:
                logger.warning(
                    "%s request_payload: %s",
                    operation_name,
                    json.dumps(sanitize_error_dict_for_log(json_payload), ensure_ascii=False)[:3000],
                )
            if error_code == 190:
                return {"status": "auth_error", "message": error_message, "error": error_obj, "http_status": status_code}
            return {"status": "http_error", "message": error_message, "error": error_obj, "http_status": status_code}
        except Exception as err:
            logger.exception("%s error: %s", operation_name, err)
            return {"status": "error", "message": str(err)}

    def update_ad_status(self, ad_id: str, status: str) -> Dict[str, Any]:
        """Atualiza status de um anúncio (PAUSED/ACTIVE) via Meta Graph API."""
        return self._update_entity_status(ad_id, status)

    def update_adset_status(self, adset_id: str, status: str) -> Dict[str, Any]:
        """Atualiza status de um conjunto de anúncios (PAUSED/ACTIVE) via Meta Graph API."""
        return self._update_entity_status(adset_id, status)

    def update_campaign_status(self, campaign_id: str, status: str) -> Dict[str, Any]:
        """Atualiza status de uma campanha (PAUSED/ACTIVE) via Meta Graph API."""
        return self._update_entity_status(campaign_id, status)

    ## BULK CREATE ADS

    def get_ad_parent_info(self, ad_id: str) -> Dict[str, Any]:
        """Retorna campaign_id, adset_id e account_id de um anuncio."""
        return self._handle_graph_request(
            method="GET",
            path=ad_id,
            operation_name="GraphAPI.get_ad_parent_info",
            params={"fields": "id,name,campaign_id,adset_id,account_id"},
            timeout=30,
        )

    def get_ad_account(self, act_id: str) -> Dict[str, Any]:
        """Valida se o token atual possui acesso a uma conta de anúncios."""
        return self._handle_graph_request(
            method="GET",
            path=act_id,
            operation_name="GraphAPI.get_ad_account",
            params={"fields": "id,name,account_status"},
            timeout=30,
        )

    def get_campaign_config(self, campaign_id: str) -> Dict[str, Any]:
        """Retorna configuracoes da campanha para duplicacao."""
        # Apenas campos do no Campaign (ex.: start_time/end_time/pacing_type sao do AdSet).
        fields = (
            "id,name,objective,status,buying_type,bid_strategy,"
            "daily_budget,lifetime_budget,special_ad_categories,special_ad_category_country,"
            "spend_cap"
        )
        return self._handle_graph_request(
            method="GET",
            path=campaign_id,
            operation_name="GraphAPI.get_campaign_config",
            params={"fields": fields},
            timeout=30,
        )

    def get_adset_fields(self, adset_id: str, fields: str) -> Dict[str, Any]:
        """GET em um ad set por id (ex.: promoted_object para resolver page_id)."""
        return self._handle_graph_request(
            method="GET",
            path=adset_id,
            operation_name="GraphAPI.get_adset_fields",
            params={"fields": fields},
            timeout=30,
        )

    def get_adsets_for_campaign(self, campaign_id: str) -> Dict[str, Any]:
        """Retorna todos os adsets de uma campanha com suas configuracoes."""
        fields = (
            "id,name,status,targeting,optimization_goal,billing_event,"
            "bid_amount,daily_budget,lifetime_budget,promoted_object,"
            "attribution_spec,destination_type,frequency_control_specs,bid_constraints,"
            "pacing_type,start_time,end_time,bid_strategy"
        )
        return self._handle_graph_request(
            method="GET",
            path=f"{campaign_id}/adsets",
            operation_name="GraphAPI.get_adsets_for_campaign",
            params={"fields": fields, "limit": 50},
            timeout=30,
        )

    def create_campaign(self, act_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
        """Cria uma nova campanha na conta de anuncios."""
        return self._handle_graph_request(
            method="POST",
            path=f"{act_id}/campaigns",
            operation_name="GraphAPI.create_campaign",
            json_payload=params,
            timeout=60,
        )

    def create_adset(self, act_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
        """Cria um novo conjunto de anuncios na conta."""
        return self._handle_graph_request(
            method="POST",
            path=f"{act_id}/adsets",
            operation_name="GraphAPI.create_adset",
            json_payload=params,
            timeout=60,
        )

    def get_ad_creative_details(self, ad_id: str) -> Dict[str, Any]:
        # dsa_* nao sao campos do no AdCreative na Graph API (usar nivel de anuncio/conta se necessario).
        fields = (
            "id,name,creative{actor_id,body,title,call_to_action,call_to_action_type,"
            "link_url,url_tags,object_type,asset_feed_spec,image_hash,"
            "image_url,video_id,thumbnail_url,object_story_spec}"
        )
        return self._handle_graph_request(
            method="GET",
            path=ad_id,
            operation_name="GraphAPI.get_ad_creative_details",
            params={"fields": fields},
            timeout=30,
        )

    def get_video_source(self, video_id: str) -> Dict[str, Any]:
        return self._handle_graph_request(
            method="GET",
            path=video_id,
            operation_name="GraphAPI.get_video_source",
            params={"fields": "source"},
            timeout=15,
        )

    def upload_ad_image(self, act_id: str, filename: str, file_bytes: bytes) -> Dict[str, Any]:
        return self._handle_graph_request(
            method="POST",
            path=f"{act_id}/adimages",
            operation_name="GraphAPI.upload_ad_image",
            files={"filename": (filename, file_bytes)},
            timeout=300,
        )

    # ── Chunked video upload via /act_{id}/advideos ───────────────────────────
    # Mirrors Meta's official Python SDK (facebook-python-business-sdk).
    # Server drives chunk sizing via start_offset/end_offset in each response;
    # caller loops until start_offset == end_offset, then calls finish.

    def start_chunked_video_upload(self, act_id: str, file_size: int) -> Dict[str, Any]:
        return self._handle_graph_request(
            method="POST",
            path=f"{act_id}/advideos",
            operation_name="GraphAPI.start_chunked_video_upload",
            data={"upload_phase": "start", "file_size": file_size},
            timeout=30,
        )

    def transfer_video_chunk(
        self,
        act_id: str,
        session_id: str,
        start_offset: int,
        chunk_bytes: bytes,
        file_name: str,
        timeout: int = 180,
    ) -> Dict[str, Any]:
        return self._handle_graph_request(
            method="POST",
            path=f"{act_id}/advideos",
            operation_name="GraphAPI.transfer_video_chunk",
            data={
                "upload_phase": "transfer",
                "upload_session_id": session_id,
                "start_offset": start_offset,
            },
            files={"video_file_chunk": (file_name, chunk_bytes, "application/octet-stream")},
            timeout=timeout,
        )

    def finish_chunked_video_upload(
        self, act_id: str, session_id: str, file_name: str,
    ) -> Dict[str, Any]:
        return self._handle_graph_request(
            method="POST",
            path=f"{act_id}/advideos",
            operation_name="GraphAPI.finish_chunked_video_upload",
            data={
                "upload_phase": "finish",
                "upload_session_id": session_id,
                "title": file_name,
            },
            timeout=60,
        )

    def upload_ad_video_chunked(
        self,
        act_id: str,
        file_name: str,
        file_source: BinaryIO,
        file_size: int,
        on_progress: Optional[Callable[[int, int], None]] = None,
        on_check_cancel: Optional[Callable[[], None]] = None,
    ) -> Dict[str, Any]:
        """Upload a video via Meta's chunked /advideos flow.

        file_source must be a seekable binary stream (open file, BytesIO).
        Caller owns the stream lifecycle (open/close).
        Returns {'status': 'success', 'data': {'id': video_id}} matching the old
        upload_ad_video shape so existing callers keep working.
        """
        t0 = time.monotonic()

        # Phase 1 — start
        start_result = self.start_chunked_video_upload(act_id, file_size)
        try:
            start_data = extract_data_or_raise(start_result, log_context="upload_ad_video_chunked")
        except MetaAPIError:
            return start_result

        session_id = str(start_data["upload_session_id"])
        video_id = str(start_data["video_id"])
        start_offset = int(start_data["start_offset"])
        end_offset = int(start_data["end_offset"])
        logger.info(
            "[CHUNKED_UPLOAD] start act_id=%s video_id=%s session_id=%s file_size=%d first_chunk=%d-%d",
            act_id, video_id, session_id, file_size, start_offset, end_offset,
        )

        # Phase 2 — transfer loop
        # Per-file retry budget mirrors Meta's SDK: ~1 retry per 10MB, min 2.
        retry_budget = max(file_size // (10 * 1024 * 1024), 2)
        transient_budget = 10
        chunks_sent = 0

        while start_offset != end_offset:
            if on_check_cancel is not None:
                on_check_cancel()  # caller raises to abort

            file_source.seek(start_offset)
            chunk = file_source.read(end_offset - start_offset)

            t_chunk = time.monotonic()
            transfer_result = self.transfer_video_chunk(
                act_id, session_id, start_offset, chunk, file_name,
            )

            try:
                transfer_data = extract_data_or_raise(transfer_result, log_context="upload_ad_video_chunked")
            except MetaAPIError as exc:
                # Meta subcode 1363037 means "we have a different offset for you" — recoverable.
                if str(exc.subcode) == "1363037" and retry_budget > 0:
                    raw = exc.raw_error or {}
                    err_data = raw.get("error_data") or {}
                    new_start = err_data.get("start_offset")
                    new_end = err_data.get("end_offset")
                    if new_start is not None and new_end is not None:
                        retry_budget -= 1
                        logger.warning(
                            "[CHUNKED_UPLOAD] subcode_1363037_recover act_id=%s video_id=%s "
                            "old=%d-%d new=%s-%s retries_left=%d",
                            act_id, video_id, start_offset, end_offset, new_start, new_end, retry_budget,
                        )
                        start_offset = int(new_start)
                        end_offset = int(new_end)
                        continue
                # Transient errors: short backoff, then retry the same chunk.
                if (exc.raw_error or {}).get("is_transient") and transient_budget > 0:
                    transient_budget -= 1
                    logger.warning(
                        "[CHUNKED_UPLOAD] transient_retry act_id=%s video_id=%s offset=%d retries_left=%d msg=%s",
                        act_id, video_id, start_offset, transient_budget, str(exc.message)[:200],
                    )
                    time.sleep(1.0)
                    continue
                logger.error(
                    "[CHUNKED_UPLOAD] transfer_failed act_id=%s video_id=%s offset=%d msg=%s",
                    act_id, video_id, start_offset, str(exc.message)[:300],
                )
                return transfer_result

            chunks_sent += 1
            chunk_size = end_offset - start_offset
            chunk_elapsed = time.monotonic() - t_chunk
            chunk_mbps = (chunk_size * 8 / (1024 * 1024)) / max(chunk_elapsed, 0.001)
            new_start = int(transfer_data["start_offset"])
            new_end = int(transfer_data["end_offset"])
            logger.info(
                "[CHUNKED_UPLOAD] chunk_ok act_id=%s video_id=%s chunk=%d offset=%d->%d size=%d elapsed_s=%.2f mbps=%.1f next=%d-%d",
                act_id, video_id, chunks_sent, start_offset, start_offset + chunk_size,
                chunk_size, chunk_elapsed, chunk_mbps, new_start, new_end,
            )
            start_offset = new_start
            end_offset = new_end

            if on_progress is not None:
                try:
                    on_progress(start_offset, file_size)
                except Exception:
                    logger.debug("upload_ad_video_chunked on_progress raised", exc_info=True)

        # Phase 3 — finish
        finish_result = self.finish_chunked_video_upload(act_id, session_id, file_name)
        try:
            extract_data_or_raise(finish_result, log_context="upload_ad_video_chunked")
        except MetaAPIError:
            return finish_result

        total_elapsed = time.monotonic() - t0
        overall_mbps = (file_size * 8 / (1024 * 1024)) / max(total_elapsed, 0.001)
        logger.info(
            "[CHUNKED_UPLOAD] finish_ok act_id=%s video_id=%s chunks=%d total_elapsed_s=%.2f overall_mbps=%.1f",
            act_id, video_id, chunks_sent, total_elapsed, overall_mbps,
        )
        return {"status": "success", "data": {"id": video_id}}

    def create_ad_creative(self, act_id: str, creative_params: Dict[str, Any]) -> Dict[str, Any]:
        return self._handle_graph_request(
            method="POST",
            path=f"{act_id}/adcreatives",
            operation_name="GraphAPI.create_ad_creative",
            json_payload=creative_params,
            timeout=60,
        )

    def create_ad(self, act_id: str, ad_params: Dict[str, Any]) -> Dict[str, Any]:
        return self._handle_graph_request(
            method="POST",
            path=f"{act_id}/ads",
            operation_name="GraphAPI.create_ad",
            json_payload=ad_params,
            timeout=60,
        )

    def get_video_status(self, video_id: Union[str, int]) -> Dict[str, Any]:
        return self._handle_graph_request(
            method="GET",
            path=str(video_id),
            operation_name="GraphAPI.get_video_status",
            params={"fields": "status"},
            timeout=30,
        )
