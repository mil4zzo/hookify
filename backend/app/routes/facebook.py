from fastapi import APIRouter, Depends, HTTPException, Header, Body, BackgroundTasks
from fastapi.responses import StreamingResponse
from typing import Dict, Any
from datetime import datetime, timezone, timedelta, date
import logging
import requests
import json
import asyncio
from app.services.graph_api import GraphAPI
from app.services import supabase_repo
from app.services.facebook_token_service import (
    get_facebook_token_for_user, 
    TokenFetchError,
    invalidate_token_cache
)
from app.services.facebook_connections_repo import (
    get_primary_facebook_token_with_status,
    update_connection_status
)
from app.core.auth import get_current_user
from app.schemas import AdsRequestFrontend, VideoSourceRequest, ErrorResponse, FacebookTokenRequest, RefreshPackRequest
from app.core.config import (
    FACEBOOK_CLIENT_ID,
    FACEBOOK_CLIENT_SECRET,
    FACEBOOK_TOKEN_URL,
    FACEBOOK_AUTH_BASE_URL,
    FACEBOOK_OAUTH_SCOPES,
)
from fastapi import Query

# Novos imports para arquitetura "2 fases"
from app.services.job_tracker import (
    get_job_tracker,
    STATUS_META_RUNNING,
    STATUS_META_COMPLETED,
    STATUS_PROCESSING,
    STATUS_PERSISTING,
    STATUS_COMPLETED,
    STATUS_FAILED,
)
from app.services.meta_job_client import get_meta_job_client
from app.services.job_processor import process_job_async

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/facebook", tags=["facebook"])
@router.get("/auth/url")
def get_auth_url(redirect_uri: str = Query(..., description="Frontend OAuth redirect URI")):
    """Generate Facebook OAuth authorization URL."""
    try:
        if not FACEBOOK_CLIENT_ID:
            raise HTTPException(status_code=500, detail="Facebook OAuth not configured. Missing CLIENT_ID.")

        params = {
            "client_id": FACEBOOK_CLIENT_ID,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            # scopes mínimos necessários podem ser ajustados conforme necessidade
            "scope": FACEBOOK_OAUTH_SCOPES,
        }
        # Montar URL
        from urllib.parse import urlencode

        auth_url = f"{FACEBOOK_AUTH_BASE_URL}?{urlencode(params)}"
        return {"auth_url": auth_url}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error generating auth URL")
        raise HTTPException(status_code=500, detail=str(e))

def mark_connection_as_expired(user_jwt: str, user_id: str) -> None:
    """
    Marca todas as conexões ativas do usuário como expiradas.
    
    Args:
        user_jwt: JWT do Supabase
        user_id: ID do usuário
    """
    try:
        from app.core.supabase_client import get_supabase_for_user
        sb = get_supabase_for_user(user_jwt)
        connections = sb.table("facebook_connections")\
            .select("facebook_user_id")\
            .eq("user_id", user_id)\
            .eq("status", "active")\
            .execute()
        
        for conn in (connections.data or []):
            update_connection_status(
                user_jwt,
                user_id,
                conn["facebook_user_id"],
                "expired"
            )
        
        # Invalidar cache
        invalidate_token_cache(user_id)
        logger.warning(f"[FB_TOKEN] Marked all active connections as expired for user {user_id[:8]}...")
    except Exception as e:
        logger.error(f"Error marking connections as expired: {e}")


def handle_token_expired_error(
    user_jwt: str,
    user_id: str,
    result: Dict[str, Any],
    api: GraphAPI
) -> None:
    """
    Detecta se erro é de token expirado (código 190) e atualiza status da conexão.
    
    Args:
        user_jwt: JWT do Supabase
        user_id: ID do usuário
        result: Resultado da chamada GraphAPI
        api: Instância GraphAPI (para obter facebook_user_id se necessário)
    """
    if result.get("status") == "auth_error":
        error_code = result.get("error", {}).get("code") if isinstance(result.get("error"), dict) else None
        if error_code == 190:
            mark_connection_as_expired(user_jwt, user_id)


def check_meta_error_for_token_expiry(error_message: str) -> bool:
    """
    Verifica se mensagem de erro do Meta contém indicação de token expirado (código 190).
    
    Args:
        error_message: Mensagem de erro do Meta
        
    Returns:
        True se token está expirado, False caso contrário
    """
    if not error_message:
        return False
    
    # Código 190 = Invalid OAuth 2.0 Access Token
    # Verificar por código 190 ou mensagens relacionadas
    if '"code":190' in error_message or '"code": 190' in error_message:
        return True
    if 'invalid oauth' in error_message.lower() and 'access token' in error_message.lower():
        return True
    if 'token expired' in error_message.lower():
        return True
    
    return False


def get_graph_api(user: Dict[str, Any] = Depends(get_current_user)) -> GraphAPI:
    """
    Busca o token do Facebook do banco de dados (com cache) e cria GraphAPI instance.
    
    Esta função agora:
    - Valida o token do Supabase via get_current_user
    - Busca o token do Facebook do banco (com cache inteligente)
    - Retorna instância GraphAPI configurada
    """
    user_id = user["user_id"]
    user_jwt = user["token"]
    
    try:
        # Buscar token (com cache)
        fb_token = get_facebook_token_for_user(user_jwt, user_id)
        
        if not fb_token:
            raise HTTPException(
                status_code=403,
                detail={
                    "error": "facebook_connection_missing",
                    "message": "Nenhuma conexão do Facebook encontrada. Por favor, conecte sua conta do Facebook primeiro."
                }
            )
        
        return GraphAPI(fb_token)
        
    except TokenFetchError as e:
        # Erro ao buscar token (ex: banco indisponível)
        logger.error(f"Error fetching Facebook token for user {user_id}: {e}")
        raise HTTPException(
            status_code=503,
            detail={
                "error": "token_fetch_failed",
                "message": "Erro temporário ao buscar conexão do Facebook. Tente novamente em alguns instantes."
            }
        )

@router.get("/me")
def get_me(api: GraphAPI = Depends(get_graph_api), user: Dict[str, Any] = Depends(get_current_user)):
    """Get Facebook user account info."""
    try:
        result = api.get_account_info()
        
        # Se token inválido (código 190), atualizar status e retornar erro específico
        if result.get("status") == "auth_error":
            user_jwt = user["token"]
            user_id = user["user_id"]
            handle_token_expired_error(user_jwt, user_id, result, api)
            raise HTTPException(
                status_code=401,
                detail={
                    "error": "facebook_token_expired",
                    "code": "TOKEN_EXPIRED",
                    "message": "Token do Facebook expirado. Por favor, reconecte sua conta do Facebook."
                }
            )
        
        if result["status"] != "success":
            raise HTTPException(status_code=400, detail=result["message"])
        return result["data"]
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error in /me endpoint")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/adaccounts")
def get_ad_accounts(user: Dict[str, Any] = Depends(get_current_user)):
    """Lista contas de anúncios salvas no Supabase para o usuário atual."""
    try:
        data = supabase_repo.list_ad_accounts(user["token"], user.get("user_id"))
        return data
    except Exception as e:
        logger.exception("Error in /adaccounts endpoint")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/adaccounts/sync")
def sync_ad_accounts(api: GraphAPI = Depends(get_graph_api), user: Dict[str, Any] = Depends(get_current_user)):
    """Sincroniza as contas de anúncios do Facebook para o Supabase."""
    try:
        result = api.get_adaccounts()
        if result.get("status") != "success":
            raise HTTPException(status_code=502, detail=result.get("message") or "Falha ao obter ad accounts do Facebook")
        ad_accounts = result.get("data") or []
        supabase_repo.upsert_ad_accounts(user["token"], ad_accounts, user.get("user_id"))
        return {"ok": True, "count": len(ad_accounts)}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error in /adaccounts/sync endpoint")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/ads-progress")
def get_ads_progress(request: AdsRequestFrontend, api: GraphAPI = Depends(get_graph_api), user: Dict[str, Any] = Depends(get_current_user), x_supabase_user_id: str | None = Header(default=None, alias="X-Supabase-User-Id")):
    """Start ads job and return job_id for progress tracking."""
    try:
        logger.info("=== ADS PROGRESS REQUEST DEBUG ===")
        logger.info(f"Request: {request}")
        
        # Converter formato do frontend para formato esperado pelo GraphAPI
        time_range_dict = {
            "since": request.date_start,
            "until": request.date_stop
        }
        filters_list = []
        
        # Converter filtros do frontend para o formato esperado pelo GraphAPI
        for filter_rule in request.filters:
            filters_list.append({
                "field": filter_rule.field,
                "operator": filter_rule.operator,
                "value": filter_rule.value
            })
        
        logger.info(f"Converted filters: {filters_list}")
        
        # Iniciar job e retornar job_id
        job_id = api.start_ads_job(request.adaccount_id, time_range_dict, filters_list)
        
        if isinstance(job_id, dict) and "status" in job_id:
            logger.error(f"GraphAPI returned error: {job_id}")
            error_msg = job_id.get("message", "")
            
            # Verificar se é erro de token expirado
            if check_meta_error_for_token_expiry(error_msg):
                user_jwt = user["token"]
                user_id = user["user_id"]
                mark_connection_as_expired(user_jwt, user_id)
                raise HTTPException(
                    status_code=401,
                    detail={
                        "error": "facebook_token_expired",
                        "code": "TOKEN_EXPIRED",
                        "message": "Token do Facebook expirado. Por favor, reconecte sua conta do Facebook."
                    }
                )
            
            raise HTTPException(status_code=502, detail=error_msg)
        
        # registrar job inicial (opcional)
        try:
            supabase_repo.record_job(user["token"], str(job_id), status="running", user_id=user["user_id"], progress=0, message="Job iniciado", payload={
                "adaccount_id": request.adaccount_id,
                "date_start": request.date_start,
                "date_stop": request.date_stop,
                "level": request.level,
                "filters": [f.dict() for f in request.filters],
                "name": request.name,
                "auto_refresh": request.auto_refresh if request.auto_refresh is not None else False,
                "today_local": getattr(request, "today_local", None),
            })
        except Exception:
            logger.exception("Falha ao registrar job no Supabase (início)")

        return {"job_id": job_id, "status": "started", "message": "Job iniciado com sucesso"}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error in /ads-progress endpoint")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/ads-progress/{job_id}")
def get_job_progress(
    job_id: str,
    background_tasks: BackgroundTasks,
    api: GraphAPI = Depends(get_graph_api),
    user: Dict[str, Any] = Depends(get_current_user),
    x_supabase_user_id: str | None = Header(default=None, alias="X-Supabase-User-Id")
):
    """
    Get progress of ads job (arquitetura "2 fases").
    
    - Fase 1: Consulta rápida do status na Meta API
    - Fase 2: Quando Meta completa, dispara processamento em background
    
    O frontend recebe respostas rápidas e não fica bloqueado.
    """
    try:
        from datetime import datetime, timezone

        user_jwt = user["token"]
        user_id = user["user_id"]
        
        # Criar tracker para este job
        tracker = get_job_tracker(user_jwt, user_id)
        
        # 1) Verificar status atual no Supabase (rápido)
        job = tracker.get_job(job_id)
        current_status = job.get("status") if job else None

        def _is_job_stale(job_row: Dict[str, Any], stale_threshold_seconds: int = 120) -> bool:
            # Sem updated_at, assumir stale para tentar self-healing
            updated_at_str = job_row.get("updated_at")
            if not updated_at_str:
                return True
            try:
                # updated_at costuma vir ISO com Z
                updated_at = datetime.fromisoformat(str(updated_at_str).replace("Z", "+00:00"))
                now = datetime.now(timezone.utc)
                return (now - updated_at).total_seconds() > stale_threshold_seconds
            except Exception:
                # Se não conseguir parsear, tentar retomar
                return True
        
        # Se job já está em estado final, retornar diretamente
        if current_status == STATUS_COMPLETED:
            logger.debug(f"[JOB_PROGRESS] Job {job_id} já completado, retornando progresso salvo")
            return tracker.get_public_progress(job_id)
        
        if current_status == STATUS_FAILED:
            logger.debug(f"[JOB_PROGRESS] Job {job_id} já falhou, retornando progresso salvo")
            return tracker.get_public_progress(job_id)
        
        # Se job está em processing/persisting, retornar progresso atual (background está trabalhando)
        if current_status in (STATUS_PROCESSING, STATUS_PERSISTING):
            # Verificar se precisa retomar (self-healing para jobs "stale")
            if job and _is_job_stale(job):
                logger.warning(f"[JOB_PROGRESS] Job {job_id} parece stale, tentando retomar...")
                # Buscar token do Facebook para reprocessar
                fb_token = get_facebook_token_for_user(user_jwt, user_id)
                if fb_token:
                    background_tasks.add_task(
                        process_job_async,
                        user_jwt,
                        user_id,
                        fb_token,
                        job_id
                    )
            return tracker.get_public_progress(job_id)
        
        # 2) Consultar status na Meta API (rápido, sem paginação)
        fb_token = get_facebook_token_for_user(user_jwt, user_id)
        if not fb_token:
            raise HTTPException(
                status_code=403,
                detail="Token do Facebook não encontrado. Conecte sua conta do Facebook."
            )
        
        meta_client = get_meta_job_client(fb_token)
        meta_status = meta_client.get_status(job_id)
        
        # Verificar erros da Meta
        if not meta_status.get("success"):
            error_msg = meta_status.get("error", "Erro desconhecido")
            if check_meta_error_for_token_expiry(error_msg):
                mark_connection_as_expired(user_jwt, user_id)
            raise HTTPException(
                status_code=401,
                detail={
                    "error": "facebook_token_expired",
                    "code": "TOKEN_EXPIRED",
                    "message": "Token do Facebook expirado. Por favor, reconecte sua conta do Facebook."
                }
            )
            # Se Meta falhou mas não é erro de token, atualizar status
            tracker.heartbeat(
                job_id,
                status=STATUS_META_RUNNING,
                progress=0,
                message=f"Erro ao verificar status: {error_msg}"
            )
            return tracker.get_public_progress(job_id)
        
        # 3) Processar resultado da Meta
        meta_job_status = meta_status.get("status")
        meta_percent = meta_status.get("percent", 0)
        
        if meta_job_status == "running":
            # Meta ainda processando - atualizar progresso e retornar
            tracker.heartbeat(
                job_id, 
                status=STATUS_META_RUNNING,
                progress=meta_percent,
                message="Solicitando pack ao Meta...",
                details={"stage": "meta_processing"}
            )
            return tracker.get_public_progress(job_id)
        
        elif meta_job_status == "failed":
            # Meta falhou
            error_msg = meta_status.get("error", "Job falhou na Meta API")
            tracker.mark_failed(job_id, error_msg)
            
            if check_meta_error_for_token_expiry(error_msg):
                mark_connection_as_expired(user_jwt, user_id)
                raise HTTPException(
                    status_code=401,
                    detail={
                        "error": "facebook_token_expired",
                        "code": "TOKEN_EXPIRED",
                        "message": "Token do Facebook expirado. Por favor, reconecte sua conta do Facebook."
                    }
                )
            
            return tracker.get_public_progress(job_id)
        
        elif meta_job_status == "completed":
            # Meta completou! Disparar processamento em background
            logger.info(f"[JOB_PROGRESS] Meta API completou para job {job_id}, disparando processamento...")
            
            # Marcar como meta_completed e iniciar processamento
            tracker.mark_meta_completed(job_id)
            
            # Verificar se podemos marcar como processing (lock otimista)
            if tracker.try_mark_processing(job_id):
                # Disparar processamento em background
                background_tasks.add_task(
                    process_job_async,
                    user_jwt,
                    user_id,
                    fb_token,
                    job_id
                )
                logger.info(f"[JOB_PROGRESS] Processamento em background iniciado para job {job_id}")
            
            return tracker.get_public_progress(job_id)
        
        else:
            # Status desconhecido - atualizar e retornar do banco
            tracker.heartbeat(
                job_id,
                status=STATUS_META_RUNNING,
                progress=meta_percent,
                message=f"Status: {meta_job_status}",
                details={"stage": "meta_processing"}
            )
            return tracker.get_public_progress(job_id)
    
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error getting job progress for {job_id}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/video-source")
def get_video_source(
    video_id: str, 
    actor_id: str, 
    api: GraphAPI = Depends(get_graph_api),
    user: Dict[str, Any] = Depends(get_current_user)
):
    """Get Facebook video source URL."""
    try:
        result = api.get_video_source_url(video_id, actor_id)
        
        # Check if result is an error dict
        if isinstance(result, dict) and "status" in result:
            error_msg = result.get("message", "")
            
            # Verificar se é erro de token expirado
            if check_meta_error_for_token_expiry(error_msg):
                user_jwt = user["token"]
                user_id = user["user_id"]
                mark_connection_as_expired(user_jwt, user_id)
                raise HTTPException(
                    status_code=401,
                    detail={
                        "error": "facebook_token_expired",
                        "code": "TOKEN_EXPIRED",
                        "message": "Token do Facebook expirado. Por favor, reconecte sua conta do Facebook."
                    }
                )
            
            raise HTTPException(status_code=400, detail=error_msg)
        
        return {"source_url": result}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error in /video-source endpoint")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/auth/token")
def exchange_code_for_token(request: FacebookTokenRequest):
    """Exchange Facebook authorization code for access token."""
    try:
        # Validate required config
        if not FACEBOOK_CLIENT_ID or not FACEBOOK_CLIENT_SECRET:
            raise HTTPException(
                status_code=500, 
                detail="Facebook OAuth not configured. Missing CLIENT_ID or CLIENT_SECRET."
            )
        
        # Exchange code for token
        params = {
            'client_id': FACEBOOK_CLIENT_ID,
            'client_secret': FACEBOOK_CLIENT_SECRET,
            'redirect_uri': request.redirect_uri,
            'code': request.code
        }
        
        # Log dos parâmetros para debug
        logger.info(f"Token exchange params: client_id={FACEBOOK_CLIENT_ID}, redirect_uri={request.redirect_uri}")
        logger.info(f"Code length: {len(request.code) if request.code else 0}")
        
        response = requests.get(FACEBOOK_TOKEN_URL, params=params)
        
        # Log da resposta para debug
        logger.info(f"Facebook token exchange response: {response.status_code}")
        logger.info(f"Response content: {response.text}")
        
        if response.status_code != 200:
            logger.error(f"Facebook API error: {response.status_code} - {response.text}")
            raise HTTPException(
                status_code=502,
                detail=f"Facebook API error: {response.status_code} - {response.text}"
            )
        
        token_data = response.json()
        
        # Check for Facebook API errors
        if 'error' in token_data:
            raise HTTPException(
                status_code=400,
                detail=f"Facebook OAuth error: {token_data['error'].get('message', 'Unknown error')}"
            )
        
        access_token = token_data.get('access_token')
        if not access_token:
            raise HTTPException(
                status_code=400,
                detail="No access token received from Facebook"
            )
        
        # Calculate expires_at from expires_in if available
        expires_at_str = None
        expires_in = token_data.get('expires_in')
        if expires_in:
            expires_at = datetime.now(timezone.utc) + timedelta(seconds=expires_in)
            expires_at_str = expires_at.isoformat()
            logger.info(f"Token expires in {expires_in} seconds (at {expires_at_str})")
        
        # Validate the token by getting user info
        try:
            api = GraphAPI(access_token)
            user_info = api.get_account_info()
            if user_info["status"] != "success":
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid access token: {user_info['message']}"
                )
        except Exception as e:
            raise HTTPException(
                status_code=400,
                detail=f"Token validation failed: {str(e)}"
            )
        
        return {
            "access_token": access_token,
            "token_type": "bearer",
            "expires_in": expires_in,
            "expires_at": expires_at_str,
            "user_info": user_info["data"]
        }
        
    except HTTPException:
        raise
    except requests.exceptions.RequestException as e:
        logger.exception("Error exchanging code for token")
        raise HTTPException(status_code=502, detail=f"Facebook API error: {str(e)}")
    except Exception as e:
        logger.exception("Unexpected error in token exchange")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/refresh-pack/{pack_id}")
def refresh_pack(
    pack_id: str,
    request: RefreshPackRequest = Body(...),
    api: GraphAPI = Depends(get_graph_api),
    user: Dict[str, Any] = Depends(get_current_user),
):
    """Atualiza um pack existente buscando novos dados do Meta.
    
    Calcula o range de datas baseado no refresh_type:
    - 'since_last_refresh': desde last_refreshed_at - 1 dia até until_date
    - 'full_period': desde date_start até date_stop (ou até hoje se auto_refresh estiver ativado)
    
    Args:
        pack_id: ID do pack a atualizar
    """
    try:
        logger.info(f"[REFRESH_PACK] Iniciando refresh do pack {pack_id}")
        
        # Buscar pack do Supabase para obter dados necessários
        from app.core.supabase_client import get_supabase_for_user
        sb = get_supabase_for_user(user["token"])
        pack_res = sb.table("packs").select("*").eq("id", pack_id).eq("user_id", user["user_id"]).limit(1).execute()
        
        if not pack_res.data or len(pack_res.data) == 0:
            raise HTTPException(status_code=404, detail=f"Pack {pack_id} não encontrado")
        
        pack = pack_res.data[0]
        
        # Validar dados necessários
        if not pack.get("adaccount_id"):
            raise HTTPException(status_code=400, detail="Pack não tem adaccount_id configurado")
        
        # Obter filtros do pack
        filters = pack.get("filters", [])
        if not isinstance(filters, list):
            filters = []
        
        # Validar refresh_type
        refresh_type = request.refresh_type
        if refresh_type not in ["since_last_refresh", "full_period"]:
            raise HTTPException(status_code=400, detail="refresh_type deve ser 'since_last_refresh' ou 'full_period'")
        
        # Calcular range de datas baseado no refresh_type (datas lógicas YYYY-MM-DD)
        if refresh_type == "since_last_refresh":
            # Opção 1: Desde a última atualização
            if not pack.get("last_refreshed_at"):
                raise HTTPException(status_code=400, detail="Pack não tem last_refreshed_at configurado. Use 'full_period' para atualizar todo o período.")
            
            last_refreshed_str = pack["last_refreshed_at"]
            last_refreshed_date = datetime.strptime(last_refreshed_str, "%Y-%m-%d").date()
            since_date = last_refreshed_date - timedelta(days=1)
            since_str = since_date.strftime("%Y-%m-%d")
            until_str = request.until_date
            
            logger.info(f"[REFRESH_PACK] Pack {pack_id} - Tipo: desde última atualização - Range: {since_str} até {until_str} (last_refreshed: {last_refreshed_str})")
        else:
            # Opção 2: Todo o período
            if not pack.get("date_start"):
                raise HTTPException(status_code=400, detail="Pack não tem date_start configurado")
            
            since_str = pack["date_start"]
            
            # Se auto_refresh estiver ativado, usar até hoje (until_date), senão usar date_stop
            auto_refresh = pack.get("auto_refresh", False)
            if auto_refresh:
                until_str = request.until_date
            else:
                if not pack.get("date_stop"):
                    raise HTTPException(status_code=400, detail="Pack não tem date_stop configurado")
                until_str = pack["date_stop"]
            
            logger.info(f"[REFRESH_PACK] Pack {pack_id} - Tipo: todo o período - Range: {since_str} até {until_str} (auto_refresh: {auto_refresh})")
        
        # Atualizar status do pack para "running"
        supabase_repo.update_pack_refresh_status(
            user["token"],
            pack_id,
            user["user_id"],
            refresh_status="running"
        )
        
        # Converter filtros para formato do GraphAPI
        filters_list = []
        for filter_rule in filters:
            if isinstance(filter_rule, dict):
                filters_list.append({
                    "field": filter_rule.get("field", ""),
                    "operator": filter_rule.get("operator", ""),
                    "value": filter_rule.get("value", "")
                })
        
        # Preparar time_range
        time_range_dict = {
            "since": since_str,
            "until": until_str
        }
        
        # Iniciar job no Meta
        job_id = api.start_ads_job(pack["adaccount_id"], time_range_dict, filters_list)
        
        if isinstance(job_id, dict) and "status" in job_id:
            logger.error(f"[REFRESH_PACK] GraphAPI returned error: {job_id}")
            error_msg = job_id.get("message", "")
            
            # Atualizar status para failed
            supabase_repo.update_pack_refresh_status(
                user["token"],
                pack_id,
                user["user_id"],
                refresh_status="failed"
            )
            
            # Verificar se é erro de token expirado
            if check_meta_error_for_token_expiry(error_msg):
                mark_connection_as_expired(user["token"], user["user_id"])
                raise HTTPException(
                    status_code=401,
                    detail={
                        "error": "facebook_token_expired",
                        "code": "TOKEN_EXPIRED",
                        "message": "Token do Facebook expirado. Por favor, reconecte sua conta do Facebook."
                    }
                )
            
            raise HTTPException(status_code=502, detail=error_msg)
        
        # Registrar job no Supabase com payload indicando que é refresh
        try:
            supabase_repo.record_job(
                user["token"],
                str(job_id),
                status="running",
                user_id=user["user_id"],
                progress=0,
                message="Refresh de pack iniciado",
                payload={
                    "pack_id": pack_id,
                    "adaccount_id": pack["adaccount_id"],
                    "date_start": since_str,
                    "date_stop": until_str,
                    "level": pack.get("level", "ad"),
                    "filters": filters,
                    "name": pack.get("name", ""),
                    "auto_refresh": pack.get("auto_refresh", False),
                    "is_refresh": True,  # Flag para identificar que é refresh
                }
            )
        except Exception:
            logger.exception("Falha ao registrar job no Supabase (refresh)")
        
        logger.info(f"[REFRESH_PACK] ✓ Job {job_id} iniciado para refresh do pack {pack_id}")
        
        return {
            "job_id": job_id,
            "status": "started",
            "message": "Refresh de pack iniciado com sucesso",
            "pack_id": pack_id,
            "date_range": {
                "since": since_str,
                "until": until_str
            }
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"[REFRESH_PACK] Erro ao iniciar refresh do pack {pack_id}: {e}")
        # Tentar atualizar status para failed em caso de erro
        try:
            supabase_repo.update_pack_refresh_status(
                user["token"],
                pack_id,
                user["user_id"],
                refresh_status="failed"
            )
        except:
            pass
        raise HTTPException(status_code=500, detail=str(e))
