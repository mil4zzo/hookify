from fastapi import APIRouter, Depends, HTTPException, Header, Body, BackgroundTasks, UploadFile, File, Form
from fastapi.responses import JSONResponse, StreamingResponse
from typing import Dict, Any, List, Optional, Set
from datetime import datetime, timezone, timedelta, date
import logging
import requests
import json
import asyncio
import threading
import uuid
import tempfile
import os
from app.services.graph_api import GraphAPI, GraphAPIError
from app.services import supabase_repo
from app.core.supabase_client import get_supabase_for_user
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
from pydantic import BaseModel
from pydantic import ValidationError
from app.schemas import AdsRequestFrontend, VideoSourceRequest, ErrorResponse, FacebookTokenRequest, RefreshPackRequest, UpdateStatusRequest, BulkAdConfig, BulkAdRetryRequest, BulkAdItem, CampaignBulkConfig, CampaignBulkItem, CampaignTemplateResponse, CampaignAdsetConfig
from app.core.config import (
    FACEBOOK_CLIENT_ID,
    FACEBOOK_CLIENT_SECRET,
    FACEBOOK_TOKEN_URL,
    FACEBOOK_AUTH_BASE_URL,
    FACEBOOK_OAUTH_SCOPES,
)
from app.services.thumbnail_cache import build_public_storage_url, DEFAULT_BUCKET
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
    STATUS_CANCELLED,
)
from app.services.meta_job_client import get_meta_job_client
from app.services.job_processor import process_job_async
from app.services.background_tasks import get_background_status
from app.services.bulk_ad_service import BulkAdJobContext, BulkAdProcessor
from app.services.campaign_bulk_service import CampaignBulkProcessor
from app.services.meta_campaign_clone import (
    merge_page_id_from_promoted_object,
    object_story_actor_from_creative,
)
from app.services.creative_template import (
    CreativeTemplateError,
    get_template_media_type,
    parse_creative_template,
    validate_template_for_bulk_clone,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/facebook", tags=["facebook"])


def _resolve_ad_thumbnail_url(row: Dict[str, Any]) -> Optional[str]:
    """Retorna URL de thumbnail preferindo Supabase Storage sobre Meta CDN (que expira)."""
    storage_path = str(row.get("thumb_storage_path") or "").strip()
    if storage_path:
        url = build_public_storage_url(DEFAULT_BUCKET, storage_path)
        if url:
            return url
    return row.get("thumbnail_url")


ALLOWED_IMAGE_CONTENT_TYPES = {"image/jpeg", "image/png"}
ALLOWED_VIDEO_CONTENT_TYPES = {"video/mp4", "video/quicktime"}
LARGE_FILE_THRESHOLD_BYTES = 50 * 1024 * 1024


def _normalize_account_id(account_id: str) -> str:
    value = str(account_id or "").strip()
    return value[4:] if value.startswith("act_") else value


def _meta_act_id(account_id: str) -> str:
    normalized = _normalize_account_id(account_id)
    return f"act_{normalized}"


def _validation_error(message: str, *, field: str | None = None) -> HTTPException:
    detail = {
        "error": "validation_error",
        "message": message,
        "details": {"errors": []},
    }
    if field:
        detail["details"]["errors"].append({"field": field, "message": message})
    return HTTPException(status_code=422, detail=detail)


def _build_bulk_summary(items: List[Dict[str, Any]]) -> Dict[str, int]:
    summary = {"total": len(items), "success": 0, "error": 0, "pending": 0}
    for item in items:
        status = str(item.get("status") or "")
        if status == "success":
            summary["success"] += 1
        elif status == "error":
            summary["error"] += 1
        else:
            summary["pending"] += 1
    return summary


def _cleanup_uploaded_temp_files(file_metas: List[Dict[str, Any]]) -> None:
    for meta in file_metas:
        temp_path = meta.get("temp_path")
        if not temp_path:
            continue
        try:
            if os.path.exists(temp_path):
                os.remove(temp_path)
        except Exception:
            logger.warning("[BULK_ADS] Falha ao limpar arquivo temporario %s", temp_path, exc_info=True)


def _item_file_indexes(item: BulkAdItem) -> Set[int]:
    if item.slot_files:
        return {int(file_index) for file_index in item.slot_files.values()}
    if item.file_index is None:
        return set()
    return {int(item.file_index)}


def _primary_item_file_meta(item: BulkAdItem, file_metas: List[Dict[str, Any]]) -> Dict[str, Any]:
    if item.slot_files:
        sorted_slots = sorted(item.slot_files.items(), key=lambda entry: entry[0])
        return file_metas[int(sorted_slots[0][1])]
    return file_metas[int(item.file_index or 0)]


def _validate_bulk_items_against_template(
    *,
    parsed_config: BulkAdConfig,
    creative_template,
    file_metas: List[Dict[str, Any]],
) -> None:
    slot_map = {slot.slot_key: slot for slot in creative_template.media_slots}
    required_slot_keys = {slot.slot_key for slot in creative_template.media_slots if slot.required}
    is_multi_slot = len(creative_template.media_slots) > 1

    for item in parsed_config.items:
        if is_multi_slot:
            if not item.slot_files:
                raise _validation_error(
                    "Templates com multiplos slots exigem slot_files em cada item",
                    field="config.items",
                )
            provided_slot_keys = set(item.slot_files.keys())
            missing_slots = sorted(required_slot_keys - provided_slot_keys)
            if missing_slots:
                raise _validation_error(
                    f"Bundle incompleto. Slots obrigatorios ausentes: {', '.join(missing_slots)}",
                    field="config.items",
                )
            unknown_slots = sorted(provided_slot_keys - set(slot_map.keys()))
            if unknown_slots:
                raise _validation_error(
                    f"slot_files contem slots invalidos: {', '.join(unknown_slots)}",
                    field="config.items",
                )
            for slot_key, file_index in item.slot_files.items():
                slot = slot_map[slot_key]
                file_meta = file_metas[int(file_index)]
                if file_meta["media_type"] != slot.media_type:
                    raise _validation_error(
                        f"O slot {slot_key} aceita apenas midia do tipo {slot.media_type}",
                        field=f"files[{file_index}]",
                    )
        else:
            if item.file_index is None:
                raise _validation_error(
                    "Templates simples exigem file_index em cada item",
                    field="config.items",
                )
            file_meta = file_metas[int(item.file_index)]
            if creative_template.media_kind and file_meta["media_type"] != creative_template.media_kind:
                raise _validation_error(
                    f"O template selecionado aceita apenas midia do tipo {creative_template.media_kind}",
                    field=f"files[{item.file_index}]",
                )

def _raise_meta_error(result: Dict[str, Any], *, user: Dict[str, Any], default_not_found_error: str) -> None:
    if result.get("status") == "auth_error":
        mark_connection_as_expired(user["token"], user["user_id"])
        raise HTTPException(
            status_code=401,
            detail={
                "error": "facebook_token_expired",
                "code": "TOKEN_EXPIRED",
                "message": "Token do Facebook expirado. Por favor, reconecte sua conta do Facebook.",
            },
        )

    status = result.get("status")
    if status == "http_error":
        raise HTTPException(
            status_code=502,
            detail={
                "error": "meta_api_error",
                "message": result.get("message") or "Falha ao consultar a Meta API",
                "details": result.get("error"),
            },
        )

    raise HTTPException(
        status_code=404 if status == "not_found" else 422,
        detail={
            "error": default_not_found_error,
            "message": result.get("message") or "Creative nao encontrado",
            "details": result.get("error"),
        },
    )


def _load_creative_template_or_raise(
    *,
    api: GraphAPI,
    user: Dict[str, Any],
    ad_id: str,
    require_supported: bool,
) -> tuple[Dict[str, Any], Any]:
    result = api.get_ad_creative_details(ad_id)
    if result.get("status") != "success":
        _raise_meta_error(result, user=user, default_not_found_error="creative_not_found")

    data = result.get("data") or {}
    template = parse_creative_template(data)
    if require_supported:
        try:
            validate_template_for_bulk_clone(template)
        except CreativeTemplateError as exc:
            raise HTTPException(
                status_code=422,
                detail={
                    "error": "unsupported_template",
                    "message": exc.message,
                    "details": {
                        "family": template.family,
                        "warnings": template.capabilities.warnings,
                    },
                },
            ) from exc
    return data, template


def _build_ads_tree(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    campaigns: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        campaign_id = str(row.get("campaign_id") or "")
        adset_id = str(row.get("adset_id") or "")
        ad_id = str(row.get("ad_id") or "")
        if not campaign_id or not adset_id or not ad_id:
            continue

        campaign = campaigns.setdefault(
            campaign_id,
            {
                "campaign_id": campaign_id,
                "campaign_name": row.get("campaign_name"),
                "status": row.get("effective_status"),
                "adsets": {},
            },
        )
        adset = campaign["adsets"].setdefault(
            adset_id,
            {
                "adset_id": adset_id,
                "adset_name": row.get("adset_name"),
                "status": row.get("effective_status"),
                "ads": [],
            },
        )
        adset["ads"].append(
            {
                "ad_id": ad_id,
                "ad_name": row.get("ad_name"),
                "account_id": row.get("account_id"),
                "status": row.get("effective_status"),
                "thumbnail_url": _resolve_ad_thumbnail_url(row),
            }
        )

    return [
        {
            "campaign_id": campaign["campaign_id"],
            "campaign_name": campaign["campaign_name"],
            "status": campaign["status"],
            "adsets": list(campaign["adsets"].values()),
        }
        for campaign in campaigns.values()
    ]
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
        
        return GraphAPI(fb_token, user_id=user_id)
        
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


def _assert_entity_belongs_to_user(*, user_jwt: str, user_id: str, entity_type: str, entity_id: str) -> None:
    """
    Valida que a entidade está associada ao usuário.

    Estratégia (simples e segura):
    - Como não temos tabela de adsets/campaigns, validamos via tabela `ads`.
    - Para ad_id: existe linha com ad_id + user_id.
    - Para adset/campaign: existe pelo menos 1 anúncio do usuário com aquele adset_id/campaign_id.
    """
    from app.core.supabase_client import get_supabase_for_user

    sb = get_supabase_for_user(user_jwt)
    if entity_type == "ad":
        res = sb.table("ads").select("ad_id").eq("user_id", user_id).eq("ad_id", entity_id).limit(1).execute()
    elif entity_type == "adset":
        res = sb.table("ads").select("ad_id").eq("user_id", user_id).eq("adset_id", entity_id).limit(1).execute()
    elif entity_type == "campaign":
        res = sb.table("ads").select("ad_id").eq("user_id", user_id).eq("campaign_id", entity_id).limit(1).execute()
    else:
        raise HTTPException(status_code=400, detail={"error": "invalid_entity_type", "message": "entity_type inválido"})

    if not (res.data or []):
        raise HTTPException(status_code=404, detail={"error": "entity_not_found", "message": f"{entity_type} não encontrado para este usuário"})


def _update_local_effective_status(*, user_jwt: str, user_id: str, entity_type: str, entity_id: str, new_status: str) -> None:
    """
    Atualiza o cache local (Supabase `ads.effective_status`) para refletir o status recém aplicado no Meta.

    Observações:
    - Para PAUSED em campaign/adset, marcamos os anúncios relacionados como CAMPAIGN_PAUSED/ADSET_PAUSED.
    - Para ACTIVE em campaign/adset, só revertimos linhas que estavam CAMPAIGN_PAUSED/ADSET_PAUSED (evita sobrescrever pausas individuais).
    """
    from app.core.supabase_client import get_supabase_for_user

    sb = get_supabase_for_user(user_jwt)

    try:
        if entity_type == "ad":
            if new_status == "PAUSED":
                sb.table("ads").update({"effective_status": "PAUSED"}).eq("user_id", user_id).eq("ad_id", entity_id).execute()
            else:
                # Só voltar pra ACTIVE se estava PAUSED (evita sobrescrever outros estados)
                sb.table("ads").update({"effective_status": "ACTIVE"}).eq("user_id", user_id).eq("ad_id", entity_id).eq("effective_status", "PAUSED").execute()
            return

        if entity_type == "adset":
            if new_status == "PAUSED":
                sb.table("ads").update({"effective_status": "ADSET_PAUSED"}).eq("user_id", user_id).eq("adset_id", entity_id).execute()
            else:
                sb.table("ads").update({"effective_status": "ACTIVE"}).eq("user_id", user_id).eq("adset_id", entity_id).eq("effective_status", "ADSET_PAUSED").execute()
            return

        if entity_type == "campaign":
            if new_status == "PAUSED":
                sb.table("ads").update({"effective_status": "CAMPAIGN_PAUSED"}).eq("user_id", user_id).eq("campaign_id", entity_id).execute()
            else:
                sb.table("ads").update({"effective_status": "ACTIVE"}).eq("user_id", user_id).eq("campaign_id", entity_id).eq("effective_status", "CAMPAIGN_PAUSED").execute()
            return
    except Exception:
        # Nunca falhar a operação por erro ao atualizar cache local; logar e seguir
        logger.exception("[UPDATE_STATUS] Falha ao atualizar effective_status local (cache) no Supabase")


@router.post("/ads/{ad_id}/status")
def update_ad_status(
    ad_id: str,
    request: UpdateStatusRequest = Body(...),
    api: GraphAPI = Depends(get_graph_api),
    user: Dict[str, Any] = Depends(get_current_user),
):
    """
    Atualiza status de um anúncio (PAUSED/ACTIVE).

    Backend chama Meta Graph API:
      POST https://graph.facebook.com/v24.0/{ad_id}
      Body {"status": "PAUSED" | "ACTIVE"}
    """
    user_jwt = user["token"]
    user_id = user["user_id"]

    _assert_entity_belongs_to_user(user_jwt=user_jwt, user_id=user_id, entity_type="ad", entity_id=ad_id)

    result = api.update_ad_status(ad_id, request.status)
    if result.get("status") == "auth_error":
        mark_connection_as_expired(user_jwt, user_id)
        raise HTTPException(
            status_code=401,
            detail={
                "error": "facebook_token_expired",
                "code": "TOKEN_EXPIRED",
                "message": "Token do Facebook expirado. Por favor, reconecte sua conta do Facebook.",
            },
        )
    if result.get("status") != "success":
        raise HTTPException(
            status_code=502,
            detail={
                "error": "meta_api_error",
                "message": result.get("message") or "Falha ao atualizar status no Meta",
                "details": result.get("error"),
            },
        )

    _update_local_effective_status(user_jwt=user_jwt, user_id=user_id, entity_type="ad", entity_id=ad_id, new_status=request.status)
    return {"success": True, "entity_id": ad_id, "entity_type": "ad", "status": request.status}


@router.post("/adsets/{adset_id}/status")
def update_adset_status(
    adset_id: str,
    request: UpdateStatusRequest = Body(...),
    api: GraphAPI = Depends(get_graph_api),
    user: Dict[str, Any] = Depends(get_current_user),
):
    """Atualiza status de um conjunto de anúncios (PAUSED/ACTIVE)."""
    user_jwt = user["token"]
    user_id = user["user_id"]

    _assert_entity_belongs_to_user(user_jwt=user_jwt, user_id=user_id, entity_type="adset", entity_id=adset_id)

    result = api.update_adset_status(adset_id, request.status)
    if result.get("status") == "auth_error":
        mark_connection_as_expired(user_jwt, user_id)
        raise HTTPException(
            status_code=401,
            detail={
                "error": "facebook_token_expired",
                "code": "TOKEN_EXPIRED",
                "message": "Token do Facebook expirado. Por favor, reconecte sua conta do Facebook.",
            },
        )
    if result.get("status") != "success":
        raise HTTPException(
            status_code=502,
            detail={
                "error": "meta_api_error",
                "message": result.get("message") or "Falha ao atualizar status no Meta",
                "details": result.get("error"),
            },
        )

    _update_local_effective_status(user_jwt=user_jwt, user_id=user_id, entity_type="adset", entity_id=adset_id, new_status=request.status)
    return {"success": True, "entity_id": adset_id, "entity_type": "adset", "status": request.status}


@router.post("/campaigns/{campaign_id}/status")
def update_campaign_status(
    campaign_id: str,
    request: UpdateStatusRequest = Body(...),
    api: GraphAPI = Depends(get_graph_api),
    user: Dict[str, Any] = Depends(get_current_user),
):
    """Atualiza status de uma campanha (PAUSED/ACTIVE)."""
    user_jwt = user["token"]
    user_id = user["user_id"]

    _assert_entity_belongs_to_user(user_jwt=user_jwt, user_id=user_id, entity_type="campaign", entity_id=campaign_id)

    result = api.update_campaign_status(campaign_id, request.status)
    if result.get("status") == "auth_error":
        mark_connection_as_expired(user_jwt, user_id)
        raise HTTPException(
            status_code=401,
            detail={
                "error": "facebook_token_expired",
                "code": "TOKEN_EXPIRED",
                "message": "Token do Facebook expirado. Por favor, reconecte sua conta do Facebook.",
            },
        )
    if result.get("status") != "success":
        raise HTTPException(
            status_code=502,
            detail={
                "error": "meta_api_error",
                "message": result.get("message") or "Falha ao atualizar status no Meta",
                "details": result.get("error"),
            },
        )

    _update_local_effective_status(user_jwt=user_jwt, user_id=user_id, entity_type="campaign", entity_id=campaign_id, new_status=request.status)
    return {"success": True, "entity_id": campaign_id, "entity_type": "campaign", "status": request.status}


@router.get("/ads/tree")
def get_ads_tree(user: Dict[str, Any] = Depends(get_current_user)):
    try:
        sb = get_supabase_for_user(user["token"])
        _SELECT = "account_id,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,effective_status,thumbnail_url,thumb_storage_path"
        _PAGE_SIZE = 1000
        all_rows: List[Dict[str, Any]] = []
        offset = 0
        while True:
            page = (
                sb.table("ads")
                .select(_SELECT)
                .eq("user_id", user["user_id"])
                .order("campaign_name")
                .order("adset_name")
                .order("ad_name")
                .range(offset, offset + _PAGE_SIZE - 1)
                .execute()
            )
            page_data = page.data or []
            all_rows.extend(page_data)
            if len(page_data) < _PAGE_SIZE:
                break
            offset += _PAGE_SIZE
        logger.info("[ads/tree] %d linhas carregadas para user %s", len(all_rows), user["user_id"][:8])
        return _build_ads_tree(all_rows)
    except Exception as e:
        logger.exception("Error in /ads/tree endpoint")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/ads/search")
def search_ads(
    q: Optional[str] = Query(None, description="Busca em ad_name ou ad_id"),
    q_adset: Optional[str] = Query(None, description="Busca em adset_name"),
    q_campaign: Optional[str] = Query(None, description="Busca em campaign_name"),
    pack_id: Optional[str] = Query(None, description="Filtra por pack (pack_ids @> [pack_id])"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    user: Dict[str, Any] = Depends(get_current_user),
):
    """Busca paginada de ads (flat) para o seletor de template da tela /upload.

    Diferente de /ads/tree, que retorna a hierarquia completa, este endpoint
    retorna itens flat e aplica filtros SQL-native para suportar busca em
    listas grandes sem timeout.
    """
    try:
        sb = get_supabase_for_user(user["token"])
        _SELECT = (
            "account_id,campaign_id,campaign_name,adset_id,adset_name,"
            "ad_id,ad_name,effective_status,thumbnail_url,thumb_storage_path"
        )

        q_clean = (q or "").strip()
        q_adset_clean = (q_adset or "").strip()
        q_campaign_clean = (q_campaign or "").strip()
        pack_clean = (pack_id or "").strip()

        query = (
            sb.table("ads")
            .select(_SELECT)
            .eq("user_id", user["user_id"])
        )

        if q_clean:
            # Busca simultaneamente em ad_name e ad_id (postgrest .or_).
            pattern = f"%{q_clean}%"
            query = query.or_(f"ad_name.ilike.{pattern},ad_id.ilike.{pattern}")
        if q_adset_clean:
            query = query.ilike("adset_name", f"%{q_adset_clean}%")
        if q_campaign_clean:
            query = query.ilike("campaign_name", f"%{q_campaign_clean}%")
        if pack_clean:
            query = query.contains("pack_ids", [pack_clean])

        # Fetch limit+1 para detectar has_more sem um count() extra.
        end = offset + limit
        result = (
            query.order("campaign_name")
            .order("adset_name")
            .order("ad_name")
            .range(offset, end)
            .execute()
        )
        rows = result.data or []
        has_more = len(rows) > limit
        items = rows[:limit]

        flat_items = [
            {
                "ad_id": str(row.get("ad_id") or ""),
                "ad_name": row.get("ad_name"),
                "account_id": row.get("account_id"),
                "adset_id": str(row.get("adset_id") or ""),
                "adset_name": row.get("adset_name"),
                "campaign_id": str(row.get("campaign_id") or ""),
                "campaign_name": row.get("campaign_name"),
                "status": row.get("effective_status"),
                "thumbnail_url": _resolve_ad_thumbnail_url(row),
            }
            for row in items
            if row.get("ad_id") and row.get("adset_id") and row.get("campaign_id")
        ]

        return {
            "items": flat_items,
            "next_offset": (offset + limit) if has_more else None,
            "has_more": has_more,
        }
    except Exception as e:
        logger.exception("Error in /ads/search endpoint")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/ads/{ad_id}/creative")
def get_ad_creative(
    ad_id: str,
    api: GraphAPI = Depends(get_graph_api),
    user: Dict[str, Any] = Depends(get_current_user),
):
    _assert_entity_belongs_to_user(
        user_jwt=user["token"],
        user_id=user["user_id"],
        entity_type="ad",
        entity_id=ad_id,
    )
    data, template = _load_creative_template_or_raise(
        api=api,
        user=user,
        ad_id=ad_id,
        require_supported=False,
    )
    creative = data.get("creative") or {}
    response = template.to_preview_response(creative)

    video_id = (
        creative.get("video_id")
        or (creative.get("object_story_spec") or {}).get("link_data", {}).get("video_id")
        or (creative.get("object_story_spec") or {}).get("video_data", {}).get("video_id")
    )
    if video_id:
        video_result = api.get_video_source(str(video_id))
        if video_result.get("status") == "success":
            response["video_url"] = (video_result.get("data") or {}).get("source")

    return response


@router.post("/bulk-ads", status_code=202)
async def start_bulk_ads(
    files: List[UploadFile] = File(...),
    config: str = Form(...),
    api: GraphAPI = Depends(get_graph_api),
    user: Dict[str, Any] = Depends(get_current_user),
):
    try:
        parsed_config = BulkAdConfig.model_validate(json.loads(config))
    except ValidationError as exc:
        raise _validation_error("Configuracao invalida", field="config") from exc
    except json.JSONDecodeError as exc:
        raise _validation_error("config precisa ser um JSON valido", field="config") from exc

    if not files:
        raise _validation_error("Envie pelo menos um arquivo", field="files")

    sb = get_supabase_for_user(user["token"])
    _assert_entity_belongs_to_user(
        user_jwt=user["token"],
        user_id=user["user_id"],
        entity_type="ad",
        entity_id=parsed_config.template_ad_id,
    )

    if not supabase_repo.validate_adsets_ownership(
        sb,
        user["user_id"],
        [item.adset_id for item in parsed_config.items],
    ):
        raise HTTPException(
            status_code=404,
            detail={"error": "adset_not_found", "message": "Um ou mais adsets nao pertencem ao usuario"},
        )

    available_accounts = {
        _normalize_account_id(str(account.get("id") or ""))
        for account in supabase_repo.list_ad_accounts(user["token"], user["user_id"])
    }
    if _normalize_account_id(parsed_config.account_id) not in available_accounts:
        raise HTTPException(
            status_code=403,
            detail={"error": "account_forbidden", "message": "account_id nao pertence ao usuario"},
        )

    referenced_indexes = {
        file_index
        for item in parsed_config.items
        for file_index in _item_file_indexes(item)
    }
    if any(file_index >= len(files) for file_index in referenced_indexes):
        raise _validation_error(
            "Um ou mais arquivos referenciados nao foram enviados",
            field="config.items",
        )

    files_data: List[Dict[str, Any]] = []
    file_metas: List[Dict[str, Any]] = []
    try:
        for index, upload in enumerate(files):
            content_type = str(upload.content_type or "").lower()
            if content_type not in ALLOWED_IMAGE_CONTENT_TYPES | ALLOWED_VIDEO_CONTENT_TYPES:
                raise _validation_error(
                    "Formato nao suportado",
                    field=f"files[{index}]",
                )

            upload.file.seek(0, os.SEEK_END)
            file_size = upload.file.tell()
            upload.file.seek(0)
            if content_type in ALLOWED_IMAGE_CONTENT_TYPES and file_size > 30 * 1024 * 1024:
                raise _validation_error("Imagem excede o limite de 30MB", field=f"files[{index}]")
            if content_type in ALLOWED_VIDEO_CONTENT_TYPES and file_size > 4 * 1024 * 1024 * 1024:
                raise _validation_error("Video excede o limite de 4GB", field=f"files[{index}]")

            if file_size > LARGE_FILE_THRESHOLD_BYTES:
                temp_file = tempfile.NamedTemporaryFile(delete=False)
                try:
                    while True:
                        chunk = upload.file.read(1024 * 1024)
                        if not chunk:
                            break
                        temp_file.write(chunk)
                    temp_file.flush()
                finally:
                    temp_file.close()
                files_data.append({"temp_path": temp_file.name})
                temp_path = temp_file.name
            else:
                content = await upload.read()
                files_data.append({"content": content})
                temp_path = None

            file_metas.append(
                {
                    "file_index": index,
                    "file_name": upload.filename or f"arquivo-{index}",
                    "content_type": content_type,
                    "media_type": get_template_media_type(content_type),
                    "size": file_size,
                    "temp_path": temp_path,
                }
            )

        template_data, creative_template = _load_creative_template_or_raise(
            api=api,
            user=user,
            ad_id=parsed_config.template_ad_id,
            require_supported=True,
        )
        _validate_bulk_items_against_template(
            parsed_config=parsed_config,
            creative_template=creative_template,
            file_metas=file_metas,
        )
    except Exception:
        _cleanup_uploaded_temp_files(file_metas)
        raise

    job_id = str(uuid.uuid4())
    tracker = get_job_tracker(user["token"], user["user_id"], use_service_role=True)
    try:
        tracker.create_job(
            job_id=job_id,
            status="processing",
            message=f"Criacao de {len(parsed_config.items)} anuncios iniciada",
            payload={
                "type": "bulk_ads",
                "template_ad_id": parsed_config.template_ad_id,
                "account_id": _normalize_account_id(parsed_config.account_id),
                "status": parsed_config.status,
                "media_refs": {},
                "template_creative_data": template_data,
                "creative_template": creative_template.to_payload(),
                "creative_family": creative_template.family,
                "media_slots": [slot.to_payload() for slot in creative_template.media_slots],
                "bundle_strategy": parsed_config.bundle_strategy or ("explicit_bundles" if len(creative_template.media_slots) > 1 else "legacy_single_file"),
                "template_validation": creative_template.capabilities.to_payload(),
            },
        )

        supabase_repo.insert_bulk_ad_items(
            tracker.sb,
            [
                {
                    "job_id": job_id,
                    "user_id": user["user_id"],
                    "file_name": _primary_item_file_meta(item, file_metas)["file_name"],
                    "file_index": _primary_item_file_meta(item, file_metas)["file_index"],
                    "bundle_id": item.bundle_id,
                    "bundle_name": item.bundle_name,
                    "slot_files": item.slot_files,
                    "is_multi_slot": bool(item.slot_files),
                    "adset_id": item.adset_id,
                    "adset_name": item.adset_name,
                    "ad_name": item.ad_name,
                    "status": "pending",
                }
                for item in parsed_config.items
            ],
        )

        def run_bulk_job() -> None:
            try:
                processor = BulkAdProcessor(
                    BulkAdJobContext(
                        user_jwt=user["token"],
                        user_id=user["user_id"],
                        access_token=get_facebook_token_for_user(user["token"], user["user_id"]),
                        job_id=job_id,
                        account_id=_normalize_account_id(parsed_config.account_id),
                    )
                )
                processor.process(files_data, file_metas)
            except Exception as exc:
                _cleanup_uploaded_temp_files(file_metas)
                logger.exception("[BULK_ADS] Falha ao inicializar job %s", job_id)
                tracker.mark_failed(job_id, str(exc), error_code="bulk_ads_bootstrap_failed")

        threading.Thread(target=run_bulk_job, daemon=True).start()
    except Exception:
        _cleanup_uploaded_temp_files(file_metas)
        raise

    return {
        "job_id": job_id,
        "status": "accepted",
        "message": f"Criacao de {len(parsed_config.items)} anuncios iniciada",
        "total_items": len(parsed_config.items),
    }


@router.get("/bulk-ads/{job_id}")
def get_bulk_ads_progress(
    job_id: str,
    user: Dict[str, Any] = Depends(get_current_user),
):
    tracker = get_job_tracker(user["token"], user["user_id"], use_service_role=True)
    job = tracker.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail={"error": "job_not_found", "message": "Job nao encontrado"})

    items = supabase_repo.fetch_bulk_ad_items_for_job(tracker.sb, job_id)
    progress = tracker.get_public_progress(job_id)
    summary = _build_bulk_summary(items)

    return {
        "job_id": job_id,
        "status": progress.get("status"),
        "progress": progress.get("progress", 0),
        "message": progress.get("message", ""),
        "items": [
            {
                "id": item.get("id"),
                "file_name": item.get("file_name"),
                "file_index": item.get("file_index"),
                "bundle_id": item.get("bundle_id"),
                "bundle_name": item.get("bundle_name"),
                "slot_files": item.get("slot_files"),
                "is_multi_slot": item.get("is_multi_slot"),
                "adset_id": item.get("adset_id"),
                "adset_name": item.get("adset_name"),
                "ad_name": item.get("ad_name"),
                "status": item.get("status"),
                "meta_ad_id": item.get("meta_ad_id"),
                "meta_creative_id": item.get("meta_creative_id"),
                "error_message": item.get("error_message"),
                "error_code": item.get("error_code"),
            }
            for item in items
        ],
        "summary": summary,
    }


@router.post("/bulk-ads/{job_id}/retry", status_code=202)
def retry_bulk_ads(
    job_id: str,
    request: BulkAdRetryRequest,
    user: Dict[str, Any] = Depends(get_current_user),
):
    if request.job_id != job_id:
        raise _validation_error("job_id do body deve coincidir com o path", field="job_id")

    tracker = get_job_tracker(user["token"], user["user_id"], use_service_role=True)
    original_job = tracker.get_job(job_id)
    if not original_job:
        raise HTTPException(status_code=404, detail={"error": "job_not_found", "message": "Job nao encontrado"})

    job_payload = original_job.get("payload") or {}
    active_retry = (
        tracker.sb.table("jobs")
        .select("id,status")
        .eq("user_id", user["user_id"])
        .contains("payload", {"retry_of_job_id": job_id, "type": "bulk_ads_retry"})
        .in_("status", ["processing"])
        .limit(1)
        .execute()
    )
    if active_retry.data:
        existing = active_retry.data[0]
        items = supabase_repo.fetch_bulk_ad_items_for_job(tracker.sb, existing["id"])
        return {
            "job_id": existing["id"],
            "status": "accepted",
            "message": "Retry ja estava em andamento",
            "total_items": len(items),
        }

    original_items = {
        str(item["id"]): item
        for item in supabase_repo.fetch_bulk_ad_items_for_job(tracker.sb, job_id)
    }
    retry_items = []
    for item_id in request.item_ids:
        item = original_items.get(item_id)
        if item and item.get("status") == "error":
            retry_items.append(item)

    if not retry_items:
        raise _validation_error("Nenhum item falho valido foi selecionado", field="item_ids")

    cached_media_refs = (job_payload.get("media_refs") or {})
    required_file_indexes: Set[str] = set()
    for item in retry_items:
        slot_files = item.get("slot_files") or {}
        if slot_files:
            required_file_indexes.update(str(file_index) for file_index in slot_files.values())
        else:
            required_file_indexes.add(str(item["file_index"]))
    missing_cached_refs = [file_index for file_index in required_file_indexes if file_index not in cached_media_refs]
    if missing_cached_refs:
        raise _validation_error(
            "Nao foi possivel reutilizar a midia destes itens. Inicie um novo upload.",
            field="item_ids",
        )
    retry_job_id = str(uuid.uuid4())
    tracker.create_job(
        job_id=retry_job_id,
        status="processing",
        message=f"Retry de {len(retry_items)} anuncio(s) iniciado",
        payload={
            **job_payload,
            "type": "bulk_ads_retry",
            "retry_of_job_id": job_id,
        },
    )
    supabase_repo.insert_bulk_ad_items(
        tracker.sb,
        [
            {
                "job_id": retry_job_id,
                "user_id": user["user_id"],
                "file_name": item["file_name"],
                "file_index": item["file_index"],
                "bundle_id": item.get("bundle_id"),
                "bundle_name": item.get("bundle_name"),
                "slot_files": item.get("slot_files"),
                "is_multi_slot": item.get("is_multi_slot") or False,
                "adset_id": item["adset_id"],
                "adset_name": item.get("adset_name"),
                "ad_name": item["ad_name"],
                "status": "pending",
            }
            for item in retry_items
        ],
    )

    retry_file_metas = []
    seen_retry_indexes: Set[int] = set()
    for file_index in sorted(int(value) for value in required_file_indexes):
        if file_index in seen_retry_indexes:
            continue
        seen_retry_indexes.add(file_index)
        cached_ref = cached_media_refs.get(str(file_index)) or {}
        media_type = str(cached_ref.get("media_type") or "image")
        retry_file_metas.append(
            {
                "file_index": file_index,
                "file_name": str(cached_ref.get("file_name") or f"arquivo-{file_index}"),
                "content_type": "application/octet-stream",
                "media_type": media_type,
                "temp_path": None,
            }
        )

    def run_retry_job() -> None:
        try:
            processor = BulkAdProcessor(
                BulkAdJobContext(
                    user_jwt=user["token"],
                    user_id=user["user_id"],
                    access_token=get_facebook_token_for_user(user["token"], user["user_id"]),
                    job_id=retry_job_id,
                    account_id=_normalize_account_id(str(job_payload.get("account_id") or "")),
                )
            )
            processor.process([], retry_file_metas)
        except Exception as exc:
            logger.exception("[BULK_ADS] Falha ao inicializar retry %s", retry_job_id)
            tracker.mark_failed(retry_job_id, str(exc), error_code="bulk_ads_retry_bootstrap_failed")

    threading.Thread(target=run_retry_job, daemon=True).start()

    return {
        "job_id": retry_job_id,
        "status": "accepted",
        "message": f"Retry de {len(retry_items)} anuncio(s) iniciado",
        "total_items": len(retry_items),
    }


@router.get("/campaign-template/{ad_id}")
def get_campaign_template(
    ad_id: str,
    api: GraphAPI = Depends(get_graph_api),
    user: Dict[str, Any] = Depends(get_current_user),
):
    """Retorna a estrutura completa de campanha a partir de um anuncio modelo."""
    _assert_entity_belongs_to_user(
        user_jwt=user["token"],
        user_id=user["user_id"],
        entity_type="ad",
        entity_id=ad_id,
    )

    # Buscar campaign_id e adset_id do anuncio
    parent_result = api.get_ad_parent_info(ad_id)
    if parent_result.get("status") != "success":
        _raise_meta_error(parent_result, user=user, default_not_found_error="ad_not_found")
    parent_data = parent_result.get("data") or {}
    campaign_id = str(parent_data.get("campaign_id") or "")
    ad_name = str(parent_data.get("name") or "")
    if not campaign_id:
        raise HTTPException(status_code=404, detail={"error": "campaign_not_found", "message": "Campanha nao encontrada para este anuncio"})

    # Buscar config da campanha
    campaign_result = api.get_campaign_config(campaign_id)
    if campaign_result.get("status") != "success":
        logger.error("[campaign-template] get_campaign_config failed: %s", campaign_result)
        _raise_meta_error(campaign_result, user=user, default_not_found_error="campaign_not_found")
    campaign_data = campaign_result.get("data") or {}

    # Buscar adsets da campanha
    adsets_result = api.get_adsets_for_campaign(campaign_id)
    if adsets_result.get("status") != "success":
        logger.error("[campaign-template] get_adsets_for_campaign failed: %s", adsets_result)
        _raise_meta_error(adsets_result, user=user, default_not_found_error="adsets_not_found")
    adsets_raw = (adsets_result.get("data") or {}).get("data") or []

    adsets = [
        CampaignAdsetConfig(
            id=str(a.get("id") or ""),
            name=str(a.get("name") or ""),
            status=a.get("status"),
            targeting=a.get("targeting"),
            optimization_goal=a.get("optimization_goal"),
            billing_event=a.get("billing_event"),
            bid_amount=a.get("bid_amount"),
            daily_budget=int(a["daily_budget"]) if a.get("daily_budget") else None,
            lifetime_budget=int(a["lifetime_budget"]) if a.get("lifetime_budget") else None,
            promoted_object=a.get("promoted_object"),
            attribution_spec=a.get("attribution_spec"),
            destination_type=a.get("destination_type"),
            pacing_type=a.get("pacing_type"),
        )
        for a in adsets_raw
        if a.get("id")
    ]

    return CampaignTemplateResponse(
        campaign_id=campaign_id,
        campaign_name=str(campaign_data.get("name") or ""),
        campaign_objective=campaign_data.get("objective"),
        campaign_bid_strategy=campaign_data.get("bid_strategy"),
        campaign_daily_budget=int(campaign_data["daily_budget"]) if campaign_data.get("daily_budget") else None,
        campaign_lifetime_budget=int(campaign_data["lifetime_budget"]) if campaign_data.get("lifetime_budget") else None,
        campaign_budget_optimization=None,
        adsets=adsets,
        ad_id=ad_id,
        ad_name=ad_name,
    )


@router.post("/campaign-bulk", status_code=202)
async def start_campaign_bulk(
    files: List[UploadFile] = File(...),
    config: str = Form(...),
    api: GraphAPI = Depends(get_graph_api),
    user: Dict[str, Any] = Depends(get_current_user),
):
    """Inicia criacao em massa de campanhas duplicando estrutura de um modelo."""
    try:
        parsed_config = CampaignBulkConfig.model_validate(json.loads(config))
    except ValidationError as exc:
        raise _validation_error("Configuracao invalida", field="config") from exc
    except json.JSONDecodeError as exc:
        raise _validation_error("config precisa ser um JSON valido", field="config") from exc

    if not files:
        raise _validation_error("Envie pelo menos um arquivo", field="files")

    _assert_entity_belongs_to_user(
        user_jwt=user["token"],
        user_id=user["user_id"],
        entity_type="ad",
        entity_id=parsed_config.template_ad_id,
    )

    available_accounts = {
        _normalize_account_id(str(account.get("id") or ""))
        for account in supabase_repo.list_ad_accounts(user["token"], user["user_id"])
    }
    if _normalize_account_id(parsed_config.account_id) not in available_accounts:
        raise HTTPException(
            status_code=403,
            detail={"error": "account_forbidden", "message": "account_id nao pertence ao usuario"},
        )

    # Validar file indexes referenciados
    referenced_indexes: Set[int] = set()
    for item in parsed_config.items:
        referenced_indexes.update(item.slot_media.values())
    if any(file_index >= len(files) for file_index in referenced_indexes):
        raise _validation_error("Um ou mais arquivos referenciados nao foram enviados", field="config.items")

    # Ler arquivos
    files_data: List[Dict[str, Any]] = []
    file_metas: List[Dict[str, Any]] = []
    try:
        for index, upload in enumerate(files):
            content_type = str(upload.content_type or "").lower()
            if content_type not in ALLOWED_IMAGE_CONTENT_TYPES | ALLOWED_VIDEO_CONTENT_TYPES:
                raise _validation_error("Formato nao suportado", field=f"files[{index}]")

            upload.file.seek(0, os.SEEK_END)
            file_size = upload.file.tell()
            upload.file.seek(0)
            if content_type in ALLOWED_IMAGE_CONTENT_TYPES and file_size > 30 * 1024 * 1024:
                raise _validation_error("Imagem excede o limite de 30MB", field=f"files[{index}]")
            if content_type in ALLOWED_VIDEO_CONTENT_TYPES and file_size > 4 * 1024 * 1024 * 1024:
                raise _validation_error("Video excede o limite de 4GB", field=f"files[{index}]")

            if file_size > LARGE_FILE_THRESHOLD_BYTES:
                temp_file = tempfile.NamedTemporaryFile(delete=False)
                try:
                    while True:
                        chunk = upload.file.read(1024 * 1024)
                        if not chunk:
                            break
                        temp_file.write(chunk)
                    temp_file.flush()
                finally:
                    temp_file.close()
                files_data.append({"temp_path": temp_file.name})
                temp_path = temp_file.name
            else:
                content = await upload.read()
                files_data.append({"content": content})
                temp_path = None

            file_metas.append({
                "file_index": index,
                "file_name": upload.filename or f"arquivo-{index}",
                "content_type": content_type,
                "media_type": get_template_media_type(content_type),
                "size": file_size,
                "temp_path": temp_path,
            })
    except Exception:
        _cleanup_uploaded_temp_files(file_metas)
        raise

    # Carregar template da campanha
    parent_result = api.get_ad_parent_info(parsed_config.template_ad_id)
    if parent_result.get("status") != "success":
        _cleanup_uploaded_temp_files(file_metas)
        _raise_meta_error(parent_result, user=user, default_not_found_error="ad_not_found")
    parent_data = parent_result.get("data") or {}
    campaign_id = str(parent_data.get("campaign_id") or "")

    campaign_result = api.get_campaign_config(campaign_id)
    if campaign_result.get("status") != "success":
        _cleanup_uploaded_temp_files(file_metas)
        _raise_meta_error(campaign_result, user=user, default_not_found_error="campaign_not_found")
    campaign_config = campaign_result.get("data") or {}

    adsets_result = api.get_adsets_for_campaign(campaign_id)
    if adsets_result.get("status") != "success":
        _cleanup_uploaded_temp_files(file_metas)
        _raise_meta_error(adsets_result, user=user, default_not_found_error="adsets_not_found")
    adsets_raw = (adsets_result.get("data") or {}).get("data") or []

    try:
        creative_data, creative_template = _load_creative_template_or_raise(
            api=api,
            user=user,
            ad_id=parsed_config.template_ad_id,
            require_supported=True,
        )
        if len(creative_template.media_slots) > 2:
            raise _validation_error(
                "Template com mais de 2 slots nao e suportado em duplicacao de campanhas",
                field="config.template_ad_id",
            )
        creative_raw = creative_data.get("creative") or {}
        object_story_actor = object_story_actor_from_creative(creative_raw)
        template_adset_id = str(parent_data.get("adset_id") or "")
        if template_adset_id and not object_story_actor.get("page_id"):
            for row in adsets_raw:
                if str(row.get("id") or "") == template_adset_id:
                    merge_page_id_from_promoted_object(object_story_actor, row.get("promoted_object"))
                    break
            if not object_story_actor.get("page_id"):
                po_result = api.get_adset_fields(template_adset_id, "promoted_object")
                if po_result.get("status") == "success":
                    merge_page_id_from_promoted_object(
                        object_story_actor,
                        (po_result.get("data") or {}).get("promoted_object"),
                    )

        if object_story_actor.get("page_id") and not creative_template.story_spec_base.get("page_id"):
            creative_template.story_spec_base["page_id"] = str(object_story_actor["page_id"])
        for actor_key in ("instagram_user_id", "instagram_actor_id", "actor_id"):
            actor_value = object_story_actor.get(actor_key)
            if actor_value and not creative_template.story_spec_base.get(actor_key):
                creative_template.story_spec_base[actor_key] = str(actor_value)
    except HTTPException:
        _cleanup_uploaded_temp_files(file_metas)
        raise

    job_id = str(uuid.uuid4())
    tracker = get_job_tracker(user["token"], user["user_id"], use_service_role=True)
    try:
        tracker.create_job(
            job_id=job_id,
            status="processing",
            message=f"Criacao de {len(parsed_config.items)} campanha(s) iniciada",
            payload={
                "type": "campaign_bulk",
                "template_ad_id": parsed_config.template_ad_id,
                "account_id": _normalize_account_id(parsed_config.account_id),
                "status": parsed_config.status,
                "adset_ids": parsed_config.adset_ids,
                "campaign_name_template": parsed_config.campaign_name_template,
                "adset_name_template": parsed_config.adset_name_template,
                "campaign_budget_override": parsed_config.campaign_budget_override,
                "campaign_config": campaign_config,
                "adset_configs": adsets_raw,
                "creative_template": creative_template.to_payload(),
                "creative_family": creative_template.family,
                "media_refs": {},
            },
        )

        supabase_repo.insert_bulk_ad_items(
            tracker.sb,
            [
                {
                    "job_id": job_id,
                    "user_id": user["user_id"],
                    "file_name": item.ad_name,
                    "file_index": next(iter(item.slot_media.values()), 0),
                    "bundle_id": None,
                    "bundle_name": None,
                    # slot_media: { "slot_1": file_index, "slot_2": file_index, ... }
                    "slot_media": item.slot_media,
                    "is_multi_slot": True,
                    "adset_id": "",
                    "adset_name": item.adset_name_template,
                    "ad_name": item.ad_name,
                    "campaign_name": item.campaign_name,
                    "status": "pending",
                }
                for item in parsed_config.items
            ],
        )

        logger.info(
            "[CAMPAIGN_BULK] job_persisted job_id=%s user_id=%s items=%s template_ad_id=%s "
            "source_campaign_id=%s adsets_in_template=%s",
            job_id,
            user["user_id"],
            len(parsed_config.items),
            parsed_config.template_ad_id,
            campaign_id,
            len(adsets_raw),
        )

        def run_campaign_bulk_job() -> None:
            try:
                processor = CampaignBulkProcessor(
                    BulkAdJobContext(
                        user_jwt=user["token"],
                        user_id=user["user_id"],
                        access_token=get_facebook_token_for_user(user["token"], user["user_id"]),
                        job_id=job_id,
                        account_id=_normalize_account_id(parsed_config.account_id),
                    )
                )
                processor.process(files_data, file_metas)
            except Exception as exc:
                _cleanup_uploaded_temp_files(file_metas)
                logger.exception(
                    "[CAMPAIGN_BULK] worker_failed job_id=%s err_type=%s",
                    job_id,
                    type(exc).__name__,
                )
                tracker.mark_failed(job_id, str(exc), error_code="campaign_bulk_bootstrap_failed")

        threading.Thread(target=run_campaign_bulk_job, daemon=True).start()
        logger.info("[CAMPAIGN_BULK] worker_thread_started job_id=%s", job_id)
    except Exception:
        _cleanup_uploaded_temp_files(file_metas)
        raise

    return {
        "job_id": job_id,
        "status": "accepted",
        "message": f"Criacao de {len(parsed_config.items)} campanha(s) iniciada",
        "total_items": len(parsed_config.items),
    }


@router.get("/campaign-bulk/{job_id}")
def get_campaign_bulk_progress(
    job_id: str,
    user: Dict[str, Any] = Depends(get_current_user),
):
    """Retorna progresso de um job de criacao de campanhas em massa."""
    tracker = get_job_tracker(user["token"], user["user_id"], use_service_role=True)
    job = tracker.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail={"error": "job_not_found", "message": "Job nao encontrado"})

    items = supabase_repo.fetch_bulk_ad_items_for_job(tracker.sb, job_id)
    progress = tracker.get_public_progress(job_id)
    summary = _build_bulk_summary(items)

    return {
        "job_id": job_id,
        "status": progress.get("status"),
        "progress": progress.get("progress", 0),
        "message": progress.get("message", ""),
        "items": [
            {
                "id": item.get("id"),
                "ad_name": item.get("ad_name"),
                "slot_media": item.get("slot_media"),
                "campaign_name_template": item.get("campaign_name_template"),
                "adset_name_template": item.get("adset_name_template"),
                "status": item.get("status"),
                "meta_creative_id": item.get("meta_creative_id"),
                "error_message": item.get("error_message"),
                "error_code": item.get("error_code"),
            }
            for item in items
        ],
        "summary": summary,
    }

@router.post("/campaign-bulk/{job_id}/retry", status_code=202)
def retry_campaign_bulk(
    job_id: str,
    request: BulkAdRetryRequest,
    user: Dict[str, Any] = Depends(get_current_user),
):
    """Reprocessa itens com erro de um job de criacao de campanhas em massa."""
    if request.job_id != job_id:
        raise _validation_error("job_id do body deve coincidir com o path", field="job_id")

    tracker = get_job_tracker(user["token"], user["user_id"], use_service_role=True)
    original_job = tracker.get_job(job_id)
    if not original_job:
        raise HTTPException(status_code=404, detail={"error": "job_not_found", "message": "Job nao encontrado"})

    job_payload = original_job.get("payload") or {}

    original_items = {
        str(item["id"]): item
        for item in supabase_repo.fetch_bulk_ad_items_for_job(tracker.sb, job_id)
    }
    retry_items = [
        item for item_id in request.item_ids
        if (item := original_items.get(item_id)) and item.get("status") == "error"
    ]
    if not retry_items:
        raise _validation_error("Nenhum item falho valido foi selecionado", field="item_ids")

    cached_media_refs = job_payload.get("media_refs") or {}
    required_file_indexes: Set[str] = set()
    for item in retry_items:
        slot_media = item.get("slot_media") or {}
        required_file_indexes.update(str(fi) for fi in slot_media.values())
    missing = [fi for fi in required_file_indexes if fi not in cached_media_refs]
    if missing:
        raise _validation_error(
            "Nao foi possivel reutilizar a midia destes itens. Inicie um novo upload.",
            field="item_ids",
        )

    retry_job_id = str(uuid.uuid4())
    tracker.create_job(
        job_id=retry_job_id,
        status="processing",
        message=f"Retry de {len(retry_items)} campanha(s) iniciado",
        payload={
            **job_payload,
            "type": "campaign_bulk_retry",
            "retry_of_job_id": job_id,
        },
    )
    supabase_repo.insert_bulk_ad_items(
        tracker.sb,
        [
            {
                "job_id": retry_job_id,
                "user_id": user["user_id"],
                "file_name": item.get("file_name") or item.get("ad_name") or "",
                "file_index": next(iter((item.get("slot_media") or {}).values()), 0),
                "bundle_id": None,
                "bundle_name": None,
                "slot_media": item.get("slot_media"),
                "is_multi_slot": True,
                "adset_id": "",
                "adset_name": item.get("adset_name"),
                "ad_name": item.get("ad_name"),
                "campaign_name": item.get("campaign_name"),
                "status": "pending",
            }
            for item in retry_items
        ],
    )

    def run_retry_campaign_job() -> None:
        try:
            processor = CampaignBulkProcessor(
                BulkAdJobContext(
                    user_jwt=user["token"],
                    user_id=user["user_id"],
                    access_token=get_facebook_token_for_user(user["token"], user["user_id"]),
                    job_id=retry_job_id,
                    account_id=_normalize_account_id(str(job_payload.get("account_id") or "")),
                )
            )
            processor.process([], [])
        except Exception as exc:
            logger.exception("[CAMPAIGN_BULK] retry_worker_failed retry_job_id=%s", retry_job_id)
            tracker.mark_failed(retry_job_id, str(exc), error_code="campaign_bulk_retry_bootstrap_failed")

    threading.Thread(target=run_retry_campaign_job, daemon=True).start()

    return {
        "job_id": retry_job_id,
        "status": "accepted",
        "message": f"Retry de {len(retry_items)} campanha(s) iniciado",
        "total_items": len(retry_items),
    }


@router.post("/ads-progress")
def get_ads_progress(request: AdsRequestFrontend, api: GraphAPI = Depends(get_graph_api), user: Dict[str, Any] = Depends(get_current_user), x_supabase_user_id: str | None = Header(default=None, alias="X-Supabase-User-Id")):
    """Start ads job and return job_id for progress tracking."""
    try:
        logger.info("=== ADS PROGRESS REQUEST DEBUG ===")
        logger.info(f"Request: {request}")

        pack_name = supabase_repo.normalize_pack_name(request.name or "")
        if not pack_name:
            raise HTTPException(status_code=400, detail="Nome do pack não pode ser vazio")
        if supabase_repo.check_pack_name_exists(user["token"], user["user_id"], pack_name):
            raise HTTPException(status_code=409, detail=f"Já existe um pack com o nome '{pack_name}'")
        
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
        try:
            job_id = api.start_ads_job(request.adaccount_id, time_range_dict, filters_list)
        except GraphAPIError as e:
            logger.error(f"GraphAPI returned error: {e.status} - {e.message}")
            if check_meta_error_for_token_expiry(e.message):
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
            raise HTTPException(status_code=502, detail=e.message)

        # registrar job inicial (opcional)
        try:
            supabase_repo.record_job(user["token"], str(job_id), status="running", user_id=user["user_id"], progress=0, message="Job iniciado", payload={
                "adaccount_id": request.adaccount_id,
                "date_start": request.date_start,
                "date_stop": request.date_stop,
                "level": request.level,
                "filters": [f.dict() for f in request.filters],
                "name": pack_name,
                "auto_refresh": request.auto_refresh if request.auto_refresh is not None else False,
                "today_local": getattr(request, "today_local", None),
            })
        except Exception:
            logger.exception("Falha ao registrar job no Supabase (início)")

        return {"job_id": str(job_id), "status": "started", "message": "Job iniciado com sucesso"}
        
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
        user_jwt = user["token"]
        user_id = user["user_id"]
        
        # Criar tracker para este job
        tracker = get_job_tracker(user_jwt, user_id)

        def _progress_with_bg():
            p = tracker.get_public_progress(job_id)
            if p.get("status") == STATUS_COMPLETED:
                bg = get_background_status(job_id)
                if bg:
                    p = dict(p)
                    p["background_tasks_status"] = bg
            return p
        
        # 1) Verificar status atual no Supabase (rápido)
        job = tracker.get_job(job_id)
        current_status = job.get("status") if job else None

        # Se job já está em estado final, retornar diretamente
        if current_status == STATUS_COMPLETED:
            logger.debug(f"[JOB_PROGRESS] Job {job_id} já completado, retornando progresso salvo")
            return _progress_with_bg()
        
        if current_status == STATUS_FAILED:
            logger.debug(f"[JOB_PROGRESS] Job {job_id} já falhou, retornando progresso salvo")
            return _progress_with_bg()

        # ✅ CRÍTICO: Verificar se job foi cancelado - NÃO continuar processamento!
        if current_status == STATUS_CANCELLED:
            logger.info(f"[JOB_PROGRESS] Job {job_id} foi cancelado, retornando status cancelado")
            return _progress_with_bg()

        # Se job está em processing/persisting, retornar progresso atual (background está trabalhando)
        if current_status in (STATUS_PROCESSING, STATUS_PERSISTING):
            if tracker.should_resume_processing(job_id):
                # ✅ CRÍTICO: Verificar novamente se job foi cancelado antes de reiniciar
                # (pode ter sido cancelado entre o início do request e aqui)
                fresh_job = tracker.get_job(job_id)
                if fresh_job and fresh_job.get("status") == STATUS_CANCELLED:
                    logger.info(f"[JOB_PROGRESS] Job {job_id} foi cancelado, não reiniciando self-healing")
                    return _progress_with_bg()

                logger.warning(f"[JOB_PROGRESS] Lease expirado para job {job_id}, tentando retomar...")
                # Buscar token do Facebook para reprocessar
                fb_token = get_facebook_token_for_user(user_jwt, user_id)
                if fb_token and tracker.try_claim_processing(job_id):
                    background_tasks.add_task(
                        process_job_async,
                        user_jwt,
                        user_id,
                        fb_token,
                        job_id,
                        tracker.processing_owner,
                    )
            return _progress_with_bg()
        
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
            tracker.heartbeat(
                job_id,
                status=STATUS_META_RUNNING,
                progress=0,
                message=f"Erro ao verificar status: {error_msg}",
                details={"stage": "meta_status_error"},
            )
            raise HTTPException(
                status_code=502,
                detail={
                    "error": "meta_status_error",
                    "message": f"Erro ao verificar status do job na Meta: {error_msg}",
                }
            )
        
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
            return _progress_with_bg()
        
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
            
            return _progress_with_bg()
        
        elif meta_job_status == "completed":
            # Meta completou! Disparar processamento em background
            logger.info(f"[JOB_PROGRESS] Meta API completou para job {job_id}, disparando processamento...")
            
            # Marcar como meta_completed e iniciar processamento
            tracker.mark_meta_completed(job_id)
            
            # Verificar se podemos adquirir lease de processamento
            if tracker.try_claim_processing(job_id):
                # Disparar processamento em background
                background_tasks.add_task(
                    process_job_async,
                    user_jwt,
                    user_id,
                    fb_token,
                    job_id,
                    tracker.processing_owner,
                )
                logger.info(f"[JOB_PROGRESS] Processamento em background iniciado para job {job_id}")
            
            return _progress_with_bg()
        
        else:
            # Status desconhecido - atualizar e retornar do banco
            tracker.heartbeat(
                job_id,
                status=STATUS_META_RUNNING,
                progress=meta_percent,
                message=f"Status: {meta_job_status}",
                details={"stage": "meta_processing"}
            )
            return _progress_with_bg()
    
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error getting job progress for {job_id}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/video-source")
def get_video_source(
    video_id: str,
    actor_id: str,
    ad_id: str = "",
    video_owner_page_id: str = "",
    api: GraphAPI = Depends(get_graph_api),
    user: Dict[str, Any] = Depends(get_current_user)
):
    """Get Facebook video source URL, resolving video owner page when needed."""
    try:
        result = api.get_video_source_url(
            video_id, actor_id, video_owner_page_id=video_owner_page_id or None
        )

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

        # result is now {"source": url, "video_owner_page_id": id}
        source_url = result.get("source") if isinstance(result, dict) else result
        resolved_owner = result.get("video_owner_page_id") if isinstance(result, dict) else None

        # Persist resolved owner (fire-and-forget, best-effort)
        if ad_id and resolved_owner and resolved_owner != video_owner_page_id:
            try:
                supabase_repo.update_ad_video_owner(
                    user_jwt=user["token"],
                    user_id=user["user_id"],
                    ad_id=ad_id,
                    video_owner_page_id=resolved_owner,
                )
            except Exception:
                pass  # best-effort, already logged inside the function

        return {"source_url": source_url, "video_owner_page_id": resolved_owner}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error in /video-source endpoint")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/image-source")
def get_image_source(
    ad_id: str,
    actor_id: str,
    api: GraphAPI = Depends(get_graph_api),
    user: Dict[str, Any] = Depends(get_current_user)
):
    """Get fresh image URL for an image ad."""
    try:
        result = api.get_image_source_url(ad_id, actor_id)

        if isinstance(result, dict) and "status" in result:
            error_msg = result.get("message", "")
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
            raise HTTPException(status_code=400, detail=error_msg)

        return {"image_url": result.get("image_url")}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error in /image-source endpoint")
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

        # Validar until_date
        try:
            until_date_parsed = date.fromisoformat(request.until_date)
        except (ValueError, TypeError):
            raise HTTPException(status_code=400, detail=f"until_date inválido: '{request.until_date}'. Use formato YYYY-MM-DD.")

        # Calcular range de datas baseado no refresh_type (datas lógicas YYYY-MM-DD)
        if refresh_type == "since_last_refresh":
            # Opção 1: Desde a última atualização
            if not pack.get("last_refreshed_at"):
                raise HTTPException(status_code=400, detail="Pack não tem last_refreshed_at configurado. Use 'full_period' para atualizar todo o período.")

            last_refreshed_str = pack["last_refreshed_at"]
            # Parsing robusto: funciona com "YYYY-MM-DD" e "YYYY-MM-DDThh:mm:ss..."
            since_date = date.fromisoformat(last_refreshed_str[:10]) - timedelta(days=1)
            since_str = since_date.strftime("%Y-%m-%d")
            until_str = request.until_date

            if since_date > until_date_parsed:
                raise HTTPException(status_code=400, detail=f"Range inválido: since ({since_str}) > until ({until_str})")

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

        # Converter filtros para formato do GraphAPI (ignorar filtros com campos vazios)
        filters_list = []
        for filter_rule in filters:
            if isinstance(filter_rule, dict):
                field = filter_rule.get("field", "")
                operator = filter_rule.get("operator", "")
                value = filter_rule.get("value", "")
                if field and operator and value:
                    filters_list.append({
                        "field": field,
                        "operator": operator,
                        "value": value
                    })

        # Preparar time_range
        time_range_dict = {
            "since": since_str,
            "until": until_str
        }

        # Iniciar job no Meta
        try:
            job_id = api.start_ads_job(pack["adaccount_id"], time_range_dict, filters_list)
        except GraphAPIError as e:
            logger.error(f"[REFRESH_PACK] GraphAPI returned error: {e.status} - {e.message}")
            supabase_repo.update_pack_refresh_status(
                user["token"],
                pack_id,
                user["user_id"],
                refresh_status="failed"
            )
            if check_meta_error_for_token_expiry(e.message):
                mark_connection_as_expired(user["token"], user["user_id"])
                raise HTTPException(
                    status_code=401,
                    detail={
                        "error": "facebook_token_expired",
                        "code": "TOKEN_EXPIRED",
                        "message": "Token do Facebook expirado. Por favor, reconecte sua conta do Facebook."
                    }
                )
            raise HTTPException(status_code=502, detail=e.message)

        # Preparar payload do job (usar filters_list limpo para consistência)
        payload_data = {
            "pack_id": pack_id,
            "adaccount_id": pack["adaccount_id"],
            "date_start": since_str,
            "date_stop": until_str,
            "level": pack.get("level", "ad"),
            "filters": filters_list,
            "name": pack.get("name", ""),
            "auto_refresh": pack.get("auto_refresh", False),
            "is_refresh": True,
        }

        # Verificar se pack tem integração Sheets e criar job paralelo
        sheet_integration_id = pack.get("sheet_integration_id")
        sync_job_id = None
        sync_details = None

        if sheet_integration_id and not request.skip_sheets_sync:
            try:
                from app.services.google_sheet_sync_job import create_sync_job, process_sync_job

                logger.info(f"[REFRESH_PACK] Pack {pack_id} tem integração Sheets ({sheet_integration_id}). Criando job paralelo...")

                sync_job_id = create_sync_job(
                    user_jwt=user["token"],
                    user_id=user["user_id"],
                    integration_id=sheet_integration_id,
                )

                # Details separado do payload — passado via parâmetro details de record_job
                sync_details = {
                    "sync_job_id": sync_job_id,
                    "integration_id": sheet_integration_id,
                    "has_sheet_sync": True
                }

                # Iniciar processamento em thread separada (daemon=False para não ser morta em restart)
                def run_sync():
                    try:
                        logger.info(f"[REFRESH_PACK] Iniciando processamento do sync job {sync_job_id} em thread separada")
                        process_sync_job(
                            user_jwt=user["token"],
                            user_id=user["user_id"],
                            job_id=sync_job_id,
                            integration_id=sheet_integration_id,
                        )
                        logger.info(f"[REFRESH_PACK] Sync job {sync_job_id} concluído com sucesso")
                    except Exception as e:
                        logger.error(f"[REFRESH_PACK] Erro ao processar sync job {sync_job_id}: {e}")

                thread = threading.Thread(target=run_sync, daemon=False)
                thread.start()
                logger.info(f"[REFRESH_PACK] Thread de sync Sheets iniciada para job {sync_job_id}")

            except Exception as e:
                # Não falhar refresh se criação do sync job falhar
                logger.warning(f"[REFRESH_PACK] Erro ao criar job de sync Sheets para pack {pack_id}: {e}")

        # Registrar job no Supabase (crítico — se falhar, abortar refresh)
        supabase_repo.record_job(
            user["token"],
            str(job_id),
            status="running",
            user_id=user["user_id"],
            progress=0,
            message="Refresh de pack iniciado",
            payload=payload_data,
            details=sync_details
        )

        logger.info(f"[REFRESH_PACK] ✓ Job {job_id} iniciado para refresh do pack {pack_id}")

        return {
            "job_id": str(job_id),
            "status": "started",
            "message": "Refresh de pack iniciado com sucesso",
            "pack_id": pack_id,
            "date_range": {
                "since": since_str,
                "until": until_str
            },
            "sync_job_id": sync_job_id,
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


@router.post("/jobs/cancel-batch")
def cancel_jobs_batch(
    request: Dict[str, Any] = Body(...),
    user: Dict[str, Any] = Depends(get_current_user)
):
    """Cancela múltiplos jobs de uma vez (útil para logout).
    
    Request body:
    {
        "job_ids": ["job_id_1", "job_id_2", ...],
        "reason": "Cancelado durante logout" (opcional)
    }
    """
    try:
        job_ids = request.get("job_ids", [])
        reason = request.get("reason", "Cancelado durante logout")
        
        if not job_ids:
            return {"cancelled_count": 0, "total_requested": 0, "message": "Nenhum job para cancelar"}
        
        if not isinstance(job_ids, list):
            raise HTTPException(status_code=400, detail="job_ids deve ser uma lista")
        
        tracker = get_job_tracker(user["token"], user["user_id"])
        cancelled_count = tracker.cancel_jobs_batch(job_ids, reason)
        
        logger.info(f"[CANCEL_JOBS_BATCH] Cancelados {cancelled_count}/{len(job_ids)} jobs para usuário {user['user_id']}")
        
        return {
            "cancelled_count": cancelled_count,
            "total_requested": len(job_ids),
            "message": f"{cancelled_count} job(s) cancelado(s)"
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"[CANCEL_JOBS_BATCH] Erro ao cancelar jobs: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class TranscriptionRetryRequest(BaseModel):
    ad_name: str


@router.post("/transcription/retry", status_code=202)
def retry_transcription(
    request: TranscriptionRetryRequest,
    user: Dict[str, Any] = Depends(get_current_user),
    api: GraphAPI = Depends(get_graph_api),
):
    """Retry assíncrono de transcrição para um ad_name com status=failed."""
    user_id = user["user_id"]
    user_jwt = user["token"]
    ad_name = request.ad_name.strip()

    if not ad_name:
        raise HTTPException(status_code=400, detail="ad_name é obrigatório")

    existing = supabase_repo.get_transcription(user_jwt, user_id, ad_name)
    if not existing:
        raise HTTPException(status_code=404, detail=f"Transcrição não encontrada para ad_name={ad_name!r}")
    if existing.get("status") != "failed":
        raise HTTPException(
            status_code=409,
            detail=f"Transcrição não está com status=failed (atual: {existing.get('status')})"
        )

    sb = supabase_repo.get_supabase_for_user(user_jwt)
    try:
        ads_res = (
            sb.table("ads")
            .select("creative")
            .eq("user_id", user_id)
            .eq("ad_name", ad_name)
            .limit(1)
            .execute()
        )
    except Exception as e:
        logger.error(f"[TRANSCRIPTION_RETRY] Erro ao buscar ad: {e}")
        raise HTTPException(status_code=500, detail="Erro ao buscar dados do anúncio")

    if not ads_res.data or len(ads_res.data) == 0:
        raise HTTPException(status_code=404, detail=f"Nenhum anúncio encontrado com ad_name={ad_name!r}")

    creative = ads_res.data[0].get("creative") or {}
    video_id = str(creative.get("video_id") or "").strip()
    actor_id = str(creative.get("actor_id") or "").strip()

    if not video_id or not actor_id:
        raise HTTPException(status_code=400, detail="Anúncio não possui video_id/actor_id no creative")

    access_token = api.access_token

    def _run_retry():
        try:
            from app.services.transcription_worker import retry_single_transcription
            retry_single_transcription(user_jwt, user_id, access_token, ad_name, video_id, actor_id)
        except Exception as e:
            logger.warning(f"[TRANSCRIPTION_RETRY] Falha no retry de {ad_name!r}: {e}")

    threading.Thread(target=_run_retry, daemon=True).start()

    return JSONResponse(
        status_code=202,
        content={"message": "Retry iniciado", "ad_name": ad_name},
    )


@router.post("/packs/{pack_id}/transcribe", status_code=202)
def start_pack_transcription(
    pack_id: str,
    api: GraphAPI = Depends(get_graph_api),
    user: Dict[str, Any] = Depends(get_current_user),
):
    """Inicia apenas o processo de transcrição dos vídeos dos anúncios do pack (sem refresh de dados).
    Útil para testes ou para rodar transcrição após um refresh que não a disparou.
    """
    from app.core.supabase_client import get_supabase_for_user
    from app.services.transcription_worker import count_pending_transcriptions, run_transcription_batch

    try:
        sb = get_supabase_for_user(user["token"])
        pack_res = sb.table("packs").select("*").eq("id", pack_id).eq("user_id", user["user_id"]).limit(1).execute()
        if not pack_res.data or len(pack_res.data) == 0:
            raise HTTPException(status_code=404, detail="Pack não encontrado")

        pack = pack_res.data[0]
        pack_name = pack.get("name") or pack_id

        ads = supabase_repo.get_ads_for_pack(user["token"], pack, user["user_id"])
        if not ads:
            return JSONResponse(
                status_code=202,
                content={
                    "message": "Nenhum anúncio encontrado no pack",
                    "pack_id": pack_id,
                    "pack_name": pack_name,
                    "transcription_job_id": None,
                },
            )

        # Garantir que cada ad tenha "creative" como dict (Supabase pode retornar já como dict)
        formatted_ads = []
        for ad in ads:
            a = dict(ad)
            if not isinstance(a.get("creative"), dict):
                a["creative"] = {}
            formatted_ads.append(a)

        pending = count_pending_transcriptions(
            user_jwt=user["token"],
            user_id=user["user_id"],
            formatted_ads=formatted_ads,
        )
        if pending <= 0:
            return JSONResponse(
                status_code=202,
                content={
                    "message": "Nenhuma transcrição pendente",
                    "pack_id": pack_id,
                    "pack_name": pack_name,
                    "transcription_job_id": None,
                },
            )

        transcription_job_id = str(uuid.uuid4())
        tracker = get_job_tracker(user["token"], user["user_id"])
        tracker.create_job(
            job_id=transcription_job_id,
            payload={
                "type": "transcription",
                "pack_id": pack_id,
                "total": pending,
            },
            status=STATUS_PROCESSING,
            message="Transcrevendo vídeos...",
        )
        tracker.heartbeat(
            transcription_job_id,
            status=STATUS_PROCESSING,
            progress=0,
            message=f"Transcrevendo 0 de {pending}",
            details={
                "stage": "transcription",
                "type": "transcription",
                "done": 0,
                "total": pending,
                "pack_id": pack_id,
            },
        )

        def _run():
            try:
                run_transcription_batch(
                    user["token"],
                    user["user_id"],
                    api.access_token,
                    formatted_ads,
                    transcription_job_id=transcription_job_id,
                )
            except Exception as e:
                logger.warning(f"[TRANSCRIBE_PACK] Transcription batch failed: {e}")

        threading.Thread(target=_run, daemon=True).start()
        logger.info(f"[TRANSCRIBE_PACK] Pack {pack_id}: job {transcription_job_id} iniciado ({pending} pendentes)")

        return JSONResponse(
            status_code=202,
            content={
                "message": "Transcrição iniciada",
                "pack_id": pack_id,
                "pack_name": pack_name,
                "transcription_job_id": transcription_job_id,
            },
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"[TRANSCRIBE_PACK] Erro ao iniciar transcrição do pack {pack_id}: {e}")
        raise HTTPException(status_code=500, detail="Erro ao iniciar transcrição")


@router.get("/transcription-progress/{job_id}")
def get_transcription_progress(
    job_id: str,
    user=Depends(get_current_user),
):
    """Retorna progresso de um job de transcrição."""
    try:
        tracker = get_job_tracker(user["token"], user["user_id"])
        progress = tracker.get_public_progress(job_id)

        if not progress or progress.get("status") == "error":
            raise HTTPException(status_code=404, detail="Job não encontrado.")

        job = tracker.get_job(job_id)
        payload = (job or {}).get("payload") or {}
        if payload.get("type") != "transcription":
            raise HTTPException(status_code=404, detail="Job de transcrição não encontrado.")

        return progress
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"[TRANSCRIPTION_PROGRESS] Erro ao obter progresso de job {job_id}")
        raise HTTPException(status_code=500, detail=f"Erro ao obter progresso: {str(e)}")
