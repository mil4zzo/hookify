from __future__ import annotations

import logging
import json
from typing import Any, Dict, Optional
from datetime import datetime, timezone, timedelta

import requests
from fastapi import APIRouter, Depends, HTTPException, Query, Body
from pydantic import BaseModel

from app.core.auth import get_current_user
from app.core.config import (
    FACEBOOK_AUTH_BASE_URL,
    FACEBOOK_CLIENT_ID,
    FACEBOOK_CLIENT_SECRET,
    FACEBOOK_TOKEN_URL,
    FACEBOOK_OAUTH_SCOPES,
)
from app.services.facebook_connections_repo import (
    list_connections,
    upsert_connection,
    delete_connection,
    set_primary,
    get_facebook_token_for_connection,
    update_connection_status,
)
from app.services.graph_api import GraphAPI, test_facebook_connection
from app.services.thumbnail_cache import cache_profile_picture, build_public_storage_url, DEFAULT_BUCKET
from app.services import supabase_repo
from app.services.facebook_token_service import invalidate_token_cache

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/facebook", tags=["facebook-connector"])


@router.post("/connect/url")
def get_connect_url(redirect_uri: str = Query(..., description="OAuth redirect URI"), state: Optional[str] = Query(None), user=Depends(get_current_user)):
    if not FACEBOOK_CLIENT_ID:
        raise HTTPException(status_code=500, detail="Facebook OAuth not configured. Missing CLIENT_ID.")

    from urllib.parse import urlencode

    params = {
        "client_id": FACEBOOK_CLIENT_ID,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": FACEBOOK_OAUTH_SCOPES,
    }
    if state:
        params["state"] = state
    url = f"{FACEBOOK_AUTH_BASE_URL}?{urlencode(params)}"
    return {"auth_url": url}


class FacebookCallbackRequest(BaseModel):
    code: str
    redirect_uri: str


@router.post("/connect/callback")
def connect_callback(
    request: FacebookCallbackRequest,
    user=Depends(get_current_user),
):
    code = request.code
    redirect_uri = request.redirect_uri
    if not FACEBOOK_CLIENT_ID or not FACEBOOK_CLIENT_SECRET:
        raise HTTPException(status_code=500, detail="Facebook OAuth not configured. Missing CLIENT_ID or CLIENT_SECRET.")

    params = {
        "client_id": FACEBOOK_CLIENT_ID,
        "client_secret": FACEBOOK_CLIENT_SECRET,
        "redirect_uri": redirect_uri,
        "code": code,
    }
    response = requests.get(FACEBOOK_TOKEN_URL, params=params)
    if response.status_code != 200:
        logger.error(f"Facebook API error: {response.status_code} - {response.text}")
        raise HTTPException(status_code=502, detail=f"Facebook API error: {response.status_code}")
    token_data = response.json()
    if "error" in token_data:
        raise HTTPException(status_code=400, detail=f"Facebook OAuth error: {token_data['error'].get('message', 'Unknown error')}")

    access_token = token_data.get("access_token")
    if not access_token:
        raise HTTPException(status_code=400, detail="No access token received from Facebook")

    # Calculate expires_at from expires_in if available
    expires_at_str = None
    expires_in = token_data.get("expires_in")
    
    # Log RAW completo da resposta do Meta para debug
    logger.info(f"=== FACEBOOK TOKEN RAW RESPONSE (Meta API) ===")
    logger.info(f"Full token_data: {json.dumps(token_data, indent=2)}")
    logger.info(f"expires_in value: {expires_in}, type: {type(expires_in)}")
    logger.info(f"Available keys: {list(token_data.keys())}")
    logger.info(f"=== END FACEBOOK TOKEN RESPONSE ===")
    
    if expires_in is None:
        logger.warning(f"Facebook did not return expires_in in token response")
    
    # Verificar se expires_in existe e é um número válido (> 0)
    if expires_in is not None and isinstance(expires_in, (int, float)) and expires_in > 0:
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=int(expires_in))
        expires_at_str = expires_at.isoformat()
        logger.info(f"Token expires in {expires_in} seconds (at {expires_at_str})")
    elif expires_in is not None:
        logger.warning(f"Facebook returned invalid expires_in value: {expires_in} (type: {type(expires_in)}). Token expiration will not be saved.")

    # Validate by fetching user info
    api = GraphAPI(access_token, user_id=user.get("user_id"))
    info = api.get_account_info()
    if info.get("status") != "success":
        raise HTTPException(status_code=400, detail=f"Invalid access token: {info.get('message')}")

    fb = info["data"]
    # Extract profile picture URL (Facebook Graph API returns picture as { data: { url: "..." } })
    picture_url = None
    picture_obj = fb.get("picture")
    if isinstance(picture_obj, dict):
        picture_data = picture_obj.get("data", {})
        if isinstance(picture_data, dict):
            picture_url = picture_data.get("url")

    user_id = user["user_id"]
    facebook_user_id = str(fb.get("id"))
    picture_storage_path = None
    picture_cached_at = None
    picture_source_url = None
    if picture_url and str(picture_url).strip():
        cached = cache_profile_picture(
            user_id=user_id,
            facebook_user_id=facebook_user_id,
            picture_url=picture_url,
        )
        if cached:
            picture_storage_path = cached.storage_path
            picture_cached_at = cached.cached_at
            picture_source_url = cached.source_url

    # Persist connection with expires_at and status="active" (new connection or reconnection)
    rec = upsert_connection(
        user_jwt=user["token"],
        user_id=user_id,
        facebook_user_id=facebook_user_id,
        access_token=access_token,
        facebook_name=fb.get("name"),
        facebook_email=fb.get("email"),
        facebook_picture_url=picture_url,
        expires_at=expires_at_str,
        status="active",  # Sempre "active" ao conectar/reconectar
        picture_storage_path=picture_storage_path,
        picture_cached_at=picture_cached_at,
        picture_source_url=picture_source_url,
    )
    
    # Invalidate cache to force refresh with new token
    invalidate_token_cache(user["user_id"])

    # Sincronizar contas de anúncios deste usuário no Supabase (best-effort)
    try:
        logger.info(f"Synchronizing ad accounts for user {user.get('user_id')} after Facebook connection")
        adacc_result = api.get_adaccounts()
        if adacc_result.get("status") == "success":
            ad_accounts_data = adacc_result.get("data") or []
            logger.info(f"Received {len(ad_accounts_data)} ad accounts from Facebook API")
            if ad_accounts_data:
                supabase_repo.upsert_ad_accounts(user["token"], ad_accounts_data, user.get("user_id"))
                logger.info(f"Successfully synchronized {len(ad_accounts_data)} ad accounts to Supabase")
            else:
                logger.warning(f"No ad accounts returned from Facebook API for user {user.get('user_id')}")
        else:
            logger.warning(f"Failed to fetch ad accounts from Facebook API: {adacc_result.get('message')}")
    except Exception as e:
        # Log mas não falha o fluxo de conexão se a sincronização de ad accounts falhar
        logger.exception(f"Error synchronizing ad accounts after Facebook connection (non-fatal): {e}")

    # Enriquecer rec com URL do Storage quando houver cache (consistente com list_connections)
    if rec.get("picture_storage_path"):
        url = build_public_storage_url(DEFAULT_BUCKET, rec["picture_storage_path"])
        if url:
            rec["facebook_picture_url"] = url

    return {"connection": rec}


@router.get("/connections")
def get_connections(user=Depends(get_current_user)):
    return list_connections(user["token"])


@router.delete("/connections/{connection_id}")
def remove_connection(connection_id: str, user=Depends(get_current_user)):
    delete_connection(user["token"], connection_id)
    return {"ok": True}


@router.post("/connections/{connection_id}/primary")
def make_primary(connection_id: str, user=Depends(get_current_user)):
    set_primary(user["token"], connection_id, user["user_id"])
    return {"ok": True}


@router.get("/connections/{connection_id}/test")
def test_facebook_connection_endpoint(
    connection_id: str,
    user=Depends(get_current_user),
):
    """
    Testa se uma conexão Facebook específica está válida.
    Faz uma chamada simples para a API do Facebook usando os tokens dessa conexão.
    """
    try:
        # Buscar token da conexão específica
        access_token, expires_at, status = get_facebook_token_for_connection(
            user_jwt=user["token"],
            user_id=user["user_id"],
            connection_id=connection_id,
        )
        
        if not access_token:
            return {
                "valid": False,
                "expired": True,
                "message": "Conexão não encontrada ou token não disponível",
            }
        
        # Testar o token
        result = test_facebook_connection(access_token)
        
        if result.get("status") == "success":
            # Token válido - atualizar status para active se não estiver
            if status != "active":
                # Buscar facebook_user_id para atualizar status
                connections = list_connections(user["token"])
                connection = next((c for c in connections if c.get("id") == connection_id), None)
                if connection:
                    update_connection_status(
                        user_jwt=user["token"],
                        user_id=user["user_id"],
                        facebook_user_id=connection.get("facebook_user_id"),
                        status="active",
                    )
            
            return {
                "valid": True,
                "expired": False,
                "message": "Conexão válida",
            }
        elif result.get("status") == "auth_error":
            # Token expirado/inválido - atualizar status
            connections = list_connections(user["token"])
            connection = next((c for c in connections if c.get("id") == connection_id), None)
            if connection:
                update_connection_status(
                    user_jwt=user["token"],
                    user_id=user["user_id"],
                    facebook_user_id=connection.get("facebook_user_id"),
                    status="expired",
                )
            
            return {
                "valid": False,
                "expired": True,
                "message": result.get("message", "Token expirado ou inválido"),
            }
        else:
            # Outro tipo de erro
            return {
                "valid": False,
                "expired": False,
                "message": result.get("message", "Erro ao testar conexão"),
            }
            
    except Exception as e:
        logger.exception(f"[FACEBOOK_CONNECTION_TEST] Erro inesperado ao testar conexão {connection_id}")
        return {
            "valid": False,
            "expired": False,
            "message": f"Erro ao testar conexão: {str(e)}",
        }


