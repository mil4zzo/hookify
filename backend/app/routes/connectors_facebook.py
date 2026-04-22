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
    get_connection_by_id,
    get_facebook_token_for_connection,
    update_connection_picture,
    update_connection_status,
)
from app.services.graph_api import GraphAPI, test_facebook_connection
from app.services.thumbnail_cache import (
    cache_profile_picture,
    build_public_storage_url,
    storage_thumb_exists,
    DEFAULT_BUCKET,
)
from app.services import supabase_repo
from app.services.facebook_token_service import invalidate_token_cache

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/facebook", tags=["facebook-connector"])


def _extract_profile_picture_url(fb_payload: Dict[str, Any]) -> Optional[str]:
    picture_obj = fb_payload.get("picture")
    if not isinstance(picture_obj, dict):
        return None
    picture_data = picture_obj.get("data", {})
    if not isinstance(picture_data, dict):
        return None
    picture_url = picture_data.get("url")
    if not picture_url or not str(picture_url).strip():
        return None
    return str(picture_url).strip()


def _has_valid_picture_cache(connection: Dict[str, Any]) -> bool:
    storage_path = str(connection.get("picture_storage_path") or "").strip()
    if not storage_path:
        return False
    return storage_thumb_exists(storage_path, bucket=DEFAULT_BUCKET)


@router.post("/connect/url")
def get_connect_url(
    redirect_uri: str = Query(..., description="OAuth redirect URI"),
    state: Optional[str] = Query(None),
    reauth: bool = Query(False, description="Force a reconnect flow to request newly-added scopes"),
    user=Depends(get_current_user),
):
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
    if reauth:
        # When new permissions are added after the first connection, the app must
        # run the OAuth dialog again instead of only testing the current token.
        params["auth_type"] = "rerequest"
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
    
    # Verificar se expires_in existe e Ã© um nÃºmero vÃ¡lido (> 0)
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
    picture_url = _extract_profile_picture_url(fb)

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
    cached_picture_public_url = (
        build_public_storage_url(DEFAULT_BUCKET, picture_storage_path)
        if picture_storage_path
        else None
    )

    # Persist connection with expires_at and status="active" (new connection or reconnection)
    rec = upsert_connection(
        user_jwt=user["token"],
        user_id=user_id,
        facebook_user_id=facebook_user_id,
        access_token=access_token,
        facebook_name=fb.get("name"),
        facebook_email=fb.get("email"),
        # Nunca salvar URL direta do Meta; somente URL de Storage (ou null).
        facebook_picture_url=cached_picture_public_url,
        expires_at=expires_at_str,
        status="active",  # Sempre "active" ao conectar/reconectar
        picture_storage_path=picture_storage_path,
        picture_cached_at=picture_cached_at,
        picture_source_url=picture_source_url,
    )
    
    # Invalidate cache to force refresh with new token
    invalidate_token_cache(user["user_id"])

    # Sincronizar contas de anÃºncios deste usuÃ¡rio no Supabase (best-effort)
    try:
        logger.info(f"Synchronizing ad accounts for user {user.get('user_id')} after Facebook connection")
        adacc_result = api.get_adaccounts()
        if adacc_result.get("status") == "success":
            ad_accounts_data = adacc_result.get("data") or []
            logger.info(f"Received {len(ad_accounts_data)} ad accounts from Facebook API")
            if ad_accounts_data:
                supabase_repo.upsert_ad_accounts(
                    user["token"],
                    ad_accounts_data,
                    user.get("user_id"),
                    connection_id=str(rec.get("id") or "").strip() or None,
                )
                logger.info(f"Successfully synchronized {len(ad_accounts_data)} ad accounts to Supabase")
            else:
                logger.warning(f"No ad accounts returned from Facebook API for user {user.get('user_id')}")
        else:
            logger.warning(f"Failed to fetch ad accounts from Facebook API: {adacc_result.get('message')}")
    except Exception as e:
        # Log mas nÃ£o falha o fluxo de conexÃ£o se a sincronizaÃ§Ã£o de ad accounts falhar
        logger.exception(f"Error synchronizing ad accounts after Facebook connection (non-fatal): {e}")

    # Enriquecer rec com URL do Storage quando houver cache (consistente com list_connections).
    # Sem cache, o avatar deve ser nulo (nÃ£o usar fallback direto da Meta).
    if rec.get("picture_storage_path"):
        rec["facebook_picture_url"] = build_public_storage_url(DEFAULT_BUCKET, rec["picture_storage_path"])
    else:
        rec["facebook_picture_url"] = None

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


@router.post("/connections/{connection_id}/refresh-picture")
def refresh_profile_picture(connection_id: str, user=Depends(get_current_user)):
    """
    Re-busca a foto de perfil do Facebook e salva no Storage.
    Ãštil para contas antigas que tinham apenas facebook_picture_url (URL expirada).
    """
    user_jwt = user["token"]
    user_id = user["user_id"]

    conn = get_connection_by_id(user_jwt, user_id, connection_id)
    if not conn:
        raise HTTPException(status_code=404, detail="ConexÃ£o nÃ£o encontrada")
    if conn.get("status") != "active":
        raise HTTPException(
            status_code=400,
            detail="ConexÃ£o nÃ£o estÃ¡ ativa. Use reconectar para renovar o token.",
        )

    access_token, _, _ = get_facebook_token_for_connection(
        user_jwt=user_jwt,
        user_id=user_id,
        connection_id=connection_id,
    )
    if not access_token:
        raise HTTPException(
            status_code=400,
            detail="Token nÃ£o disponÃ­vel. Reconecte a conta do Facebook.",
        )

    api = GraphAPI(access_token, user_id=user_id)
    info = api.get_account_info()
    if info.get("status") != "success":
        msg = info.get("message", "Token invÃ¡lido ou expirado")
        if info.get("status") == "auth_error":
            raise HTTPException(status_code=400, detail=msg)
        raise HTTPException(status_code=502, detail=msg)

    fb = info["data"]
    picture_url = _extract_profile_picture_url(fb)

    facebook_user_id = str(conn.get("facebook_user_id") or fb.get("id", ""))
    if not picture_url or not str(picture_url).strip():
        raise HTTPException(
            status_code=502,
            detail="Facebook nÃ£o retornou URL da foto de perfil",
        )

    cached = cache_profile_picture(
        user_id=user_id,
        facebook_user_id=facebook_user_id,
        picture_url=picture_url,
    )
    if not cached:
        raise HTTPException(
            status_code=502,
            detail="Falha ao baixar ou salvar a foto no Storage",
        )

    update_connection_picture(
        user_jwt=user_jwt,
        user_id=user_id,
        connection_id=connection_id,
        picture_storage_path=cached.storage_path,
        picture_cached_at=cached.cached_at,
        picture_source_url=cached.source_url,
    )

    connections = list_connections(user_jwt)
    rec = next((c for c in connections if c.get("id") == connection_id), None)
    if rec:
        if rec.get("picture_storage_path"):
            rec["facebook_picture_url"] = build_public_storage_url(DEFAULT_BUCKET, rec["picture_storage_path"])
        else:
            rec["facebook_picture_url"] = None
    return {"connection": rec}


@router.get("/connections/{connection_id}/test")
def test_facebook_connection_endpoint(
    connection_id: str,
    user=Depends(get_current_user),
):
    """
    Testa se uma conexÃ£o Facebook especÃ­fica estÃ¡ vÃ¡lida.
    Faz uma chamada simples para a API do Facebook usando os tokens dessa conexÃ£o.
    """
    try:
        # Buscar token da conexÃ£o especÃ­fica
        access_token, expires_at, status = get_facebook_token_for_connection(
            user_jwt=user["token"],
            user_id=user["user_id"],
            connection_id=connection_id,
        )
        
        if not access_token:
            return {
                "valid": False,
                "expired": True,
                "message": "ConexÃ£o nÃ£o encontrada ou token nÃ£o disponÃ­vel",
            }
        
        # Testar o token
        result = test_facebook_connection(access_token)
        
        if result.get("status") == "success":
            connections = list_connections(user["token"])
            connection = next((c for c in connections if c.get("id") == connection_id), None)

            # Token valido - atualizar status para active se nao estiver
            if status != "active" and connection:
                update_connection_status(
                    user_jwt=user["token"],
                    user_id=user["user_id"],
                    facebook_user_id=connection.get("facebook_user_id"),
                    status="active",
                )

            # Auto-repair do avatar durante refresh/teste da conexao quando
            # ainda nao existe cache no Storage ou o objeto salvo virou 404.
            if connection and not _has_valid_picture_cache(connection):
                try:
                    api = GraphAPI(access_token, user_id=user["user_id"])

                    info = api.get_account_info()
                    if info.get("status") == "success":
                        fb = info["data"]
                        picture_url = _extract_profile_picture_url(fb)
                        facebook_user_id = str(connection.get("facebook_user_id") or fb.get("id", ""))
                        if picture_url and facebook_user_id:
                            logger.info(
                                "[FACEBOOK_CONNECTION_TEST] Recaching avatar from fresh Meta picture URL for connection %s",
                                connection_id,
                            )
                            cached = cache_profile_picture(
                                user_id=user["user_id"],
                                facebook_user_id=facebook_user_id,
                                picture_url=picture_url,
                            )
                            if cached:
                                update_connection_picture(
                                    user_jwt=user["token"],
                                    user_id=user["user_id"],
                                    connection_id=connection_id,
                                    picture_storage_path=cached.storage_path,
                                    picture_cached_at=cached.cached_at,
                                    picture_source_url=cached.source_url,
                                )
                                logger.info(
                                    "[FACEBOOK_CONNECTION_TEST] Avatar recached to Storage path=%s for connection %s",
                                    cached.storage_path,
                                    connection_id,
                                )
                            else:
                                logger.warning(
                                    "[FACEBOOK_CONNECTION_TEST] Fresh Meta picture URL was returned but cache_profile_picture failed for connection %s",
                                    connection_id,
                                )
                        else:
                            logger.warning(
                                "[FACEBOOK_CONNECTION_TEST] Meta did not return a usable picture URL for connection %s",
                                connection_id,
                            )
                except Exception as pic_err:
                    logger.warning(
                        "[FACEBOOK_CONNECTION_TEST] Avatar auto-repair failed for connection %s: %s",
                        connection_id,
                        pic_err,
                    )

            return {
                "valid": True,
                "expired": False,
                "message": "Conexao valida",
            }
        elif result.get("status") == "auth_error":
            # Token expirado/invÃ¡lido - atualizar status
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
                "message": result.get("message", "Token expirado ou invÃ¡lido"),
            }
        else:
            # Outro tipo de erro
            return {
                "valid": False,
                "expired": False,
                "message": result.get("message", "Erro ao testar conexÃ£o"),
            }
            
    except Exception as e:
        logger.exception(f"[FACEBOOK_CONNECTION_TEST] Erro inesperado ao testar conexÃ£o {connection_id}")
        return {
            "valid": False,
            "expired": False,
            "message": f"Erro ao testar conexÃ£o: {str(e)}",
        }
