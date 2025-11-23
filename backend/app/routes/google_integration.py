from __future__ import annotations

import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, List

import requests
from fastapi import APIRouter, Depends, HTTPException, Query, Body
from pydantic import BaseModel

from app.core.auth import get_current_user
from app.core.config import (
    GOOGLE_OAUTH_CLIENT_ID,
    GOOGLE_OAUTH_CLIENT_SECRET,
    GOOGLE_OAUTH_AUTH_BASE_URL,
    GOOGLE_OAUTH_TOKEN_URL,
    GOOGLE_OAUTH_SCOPES,
)
from app.services.google_accounts_repo import upsert_google_account, list_google_accounts, delete_google_account
from app.services.google_sheets_service import fetch_headers, list_spreadsheets, list_worksheets, GoogleSheetsError
from app.services.ad_metrics_sheet_importer import (
    run_ad_metrics_sheet_import,
    AdMetricsImportError,
)
from app.core.supabase_client import get_supabase_for_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/integrations/google", tags=["google-integration"])


class GoogleAuthUrlRequest(BaseModel):
    redirect_uri: str
    state: Optional[str] = None


@router.post("/auth-url")
def get_google_auth_url(
    payload: GoogleAuthUrlRequest = Body(...),
    user=Depends(get_current_user),
):
    """
    Gera a URL de autorização do Google OAuth para conectar o Sheets.
    """
    if not GOOGLE_OAUTH_CLIENT_ID:
        raise HTTPException(
            status_code=500,
            detail="Google OAuth não configurado. Falta GOOGLE_OAUTH_CLIENT_ID.",
        )

    from urllib.parse import urlencode

    params = {
        "client_id": GOOGLE_OAUTH_CLIENT_ID,
        "redirect_uri": payload.redirect_uri,
        "response_type": "code",
        "access_type": "offline",
        "prompt": "consent",
        "scope": GOOGLE_OAUTH_SCOPES,
        "include_granted_scopes": "true",
    }
    if payload.state:
        params["state"] = payload.state

    url = f"{GOOGLE_OAUTH_AUTH_BASE_URL}?{urlencode(params)}"
    return {"auth_url": url}


class GoogleCallbackRequest(BaseModel):
    code: str
    redirect_uri: str


@router.post("/callback")
def google_oauth_callback(
    request: GoogleCallbackRequest,
    user=Depends(get_current_user),
):
    """
    Trata o callback do Google OAuth: troca code por tokens e persiste no Supabase.
    """
    if not GOOGLE_OAUTH_CLIENT_ID or not GOOGLE_OAUTH_CLIENT_SECRET:
        raise HTTPException(
            status_code=500,
            detail=(
                "Google OAuth não configurado. "
                "Faltando GOOGLE_OAUTH_CLIENT_ID ou GOOGLE_OAUTH_CLIENT_SECRET."
            ),
        )

    data = {
        "code": request.code,
        "client_id": GOOGLE_OAUTH_CLIENT_ID,
        "client_secret": GOOGLE_OAUTH_CLIENT_SECRET,
        "redirect_uri": request.redirect_uri,
        "grant_type": "authorization_code",
    }

    try:
        resp = requests.post(GOOGLE_OAUTH_TOKEN_URL, data=data, timeout=15)
    except requests.RequestException as e:
        logger.exception("Erro de rede ao chamar token endpoint do Google")
        raise HTTPException(status_code=502, detail=f"Erro ao conectar com Google: {e}")

    if resp.status_code != 200:
        logger.error(
            "Erro na resposta do token endpoint do Google: %s - %s",
            resp.status_code,
            resp.text,
        )
        raise HTTPException(
            status_code=502,
            detail=f"Erro no token endpoint do Google: {resp.status_code}",
        )

    token_data = resp.json()
    access_token = token_data.get("access_token")
    refresh_token = token_data.get("refresh_token")
    expires_in = token_data.get("expires_in")

    if not access_token:
        raise HTTPException(
            status_code=400,
            detail="Resposta do Google não contém access_token.",
        )

    expires_at_str = None
    if isinstance(expires_in, (int, float)) and expires_in > 0:
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=int(expires_in))
        expires_at_str = expires_at.isoformat()

    # Scopes retornados podem vir em string separada por espaço
    scopes_raw = token_data.get("scope") or GOOGLE_OAUTH_SCOPES
    scopes: List[str] = []
    if isinstance(scopes_raw, str):
        scopes = [s for s in scopes_raw.split(" ") if s]
    elif isinstance(scopes_raw, list):
        scopes = [str(s) for s in scopes_raw if s]

    # Buscar informações do usuário do Google
    google_user_id = None
    google_email = None
    google_name = None
    try:
        userinfo_resp = requests.get(
            "https://www.googleapis.com/oauth2/v2/userinfo",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=10,
        )
        if userinfo_resp.status_code == 200:
            userinfo = userinfo_resp.json()
            google_user_id = userinfo.get("id")
            google_email = userinfo.get("email")
            google_name = userinfo.get("name")
    except Exception as e:
        logger.warning(f"Erro ao buscar informações do usuário Google: {e}")

    rec = upsert_google_account(
        user_jwt=user["token"],
        user_id=user["user_id"],
        access_token=access_token,
        refresh_token=refresh_token,
        expires_at=expires_at_str,
        scopes=scopes,
        google_user_id=google_user_id,
        google_email=google_email,
        google_name=google_name,
    )

    logger.info(
        "[GOOGLE_OAUTH] Conta Google conectada/atualizada para user_id=%s",
        user.get("user_id"),
    )

    return {
        "connection": {
            "id": rec.get("id"),
            "google_user_id": rec.get("google_user_id"),
            "google_email": rec.get("google_email"),
            "google_name": rec.get("google_name"),
            "scopes": rec.get("scopes"),
        }
    }


@router.get("/connections")
def list_google_connections(
    user=Depends(get_current_user),
):
    """
    Lista todas as conexões Google do usuário.
    """
    try:
        accounts = list_google_accounts(
            user_jwt=user["token"],
            user_id=user["user_id"],
        )
    except Exception as e:
        logger.exception("[GOOGLE_OAUTH] Erro inesperado ao listar conexões")
        raise HTTPException(status_code=500, detail="Erro ao listar conexões Google")

    return {"connections": accounts}


@router.delete("/connections/{connection_id}")
def delete_google_connection(
    connection_id: str,
    user=Depends(get_current_user),
):
    """
    Deleta uma conexão Google específica do usuário.
    """
    try:
        deleted = delete_google_account(
            user_jwt=user["token"],
            user_id=user["user_id"],
            account_id=connection_id,
        )
        if not deleted:
            raise HTTPException(status_code=404, detail="Conexão não encontrada")
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("[GOOGLE_OAUTH] Erro inesperado ao deletar conexão")
        raise HTTPException(status_code=500, detail="Erro ao deletar conexão Google")

    return {"success": True}


@router.get("/spreadsheets")
def list_user_spreadsheets(
    query: Optional[str] = Query(None, description="Busca por nome da planilha"),
    page_size: int = Query(20, ge=1, le=100, description="Número de resultados por página"),
    page_token: Optional[str] = Query(None, description="Token de paginação para próxima página"),
    user=Depends(get_current_user),
):
    """
    Lista planilhas do Google Drive do usuário, ordenadas por modificação recente.
    Suporta busca por nome e paginação para lazy loading.
    """
    try:
        spreadsheets, next_page_token = list_spreadsheets(
            user_jwt=user["token"],
            user_id=user["user_id"],
            query=query,
            page_size=page_size,
            page_token=page_token,
        )
    except GoogleSheetsError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("[GOOGLE_DRIVE] Erro inesperado ao listar planilhas")
        raise HTTPException(status_code=500, detail="Erro ao listar planilhas do Google Drive")

    return {
        "spreadsheets": spreadsheets,
        "next_page_token": next_page_token,
    }


@router.get("/spreadsheets/{spreadsheet_id}/worksheets")
def list_spreadsheet_worksheets(
    spreadsheet_id: str,
    user=Depends(get_current_user),
):
    """
    Lista todas as abas (worksheets) de uma planilha do Google Sheets.
    """
    try:
        worksheets = list_worksheets(
            user_jwt=user["token"],
            user_id=user["user_id"],
            spreadsheet_id=spreadsheet_id,
        )
    except GoogleSheetsError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("[GOOGLE_SHEETS] Erro inesperado ao listar abas")
        raise HTTPException(status_code=500, detail="Erro ao listar abas da planilha")

    return {"worksheets": worksheets}


@router.get("/sheets/{spreadsheet_id}/worksheets/{worksheet_title}/columns")
def list_sheet_columns(
    spreadsheet_id: str,
    worksheet_title: str,
    user=Depends(get_current_user),
):
    """
    Retorna as colunas (header da primeira linha) de uma aba específica da planilha.
    Usado pelo modal para montar os selects de ad_id, data, Leadscore e CPR max.
    """
    try:
        headers = fetch_headers(
            user_jwt=user["token"],
            user_id=user["user_id"],
            spreadsheet_id=spreadsheet_id,
            worksheet_title=worksheet_title,
        )
    except GoogleSheetsError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("[GOOGLE_SHEETS] Erro inesperado ao listar colunas")
        raise HTTPException(status_code=500, detail="Erro ao listar colunas da planilha")

    return {"columns": headers}


class SheetIntegrationRequest(BaseModel):
    spreadsheet_id: str
    worksheet_title: str
    ad_id_column: str
    date_column: str
    date_format: str  # 'DD/MM/YYYY' ou 'MM/DD/YYYY'
    leadscore_column: Optional[str] = None
    cpr_max_column: Optional[str] = None
    # Quando informado, a integração passa a ser específica daquele pack
    pack_id: Optional[str] = None


@router.post("/ad-sheet-integrations")
def save_ad_sheet_integration(
    payload: SheetIntegrationRequest,
    user=Depends(get_current_user),
):
    """
    Salva a configuração da integração da planilha para o usuário atual.

    - Caso `pack_id` seja informado, a integração é específica daquele pack
      (um "booster" de leadscore/CPR max por pack).
    - Caso `pack_id` seja None, a integração é global (modo legado).
    """
    if not payload.leadscore_column and not payload.cpr_max_column:
        raise HTTPException(
            status_code=400,
            detail="É obrigatório selecionar pelo menos uma coluna (Leadscore ou CPR max).",
        )
    
    # Validar formato de data
    if payload.date_format not in ("DD/MM/YYYY", "MM/DD/YYYY"):
        raise HTTPException(
            status_code=400,
            detail="Formato de data inválido. Use 'DD/MM/YYYY' ou 'MM/DD/YYYY'.",
        )

    sb = get_supabase_for_user(user["token"])
    data = {
        "owner_id": user["user_id"],
        "pack_id": payload.pack_id,
        "spreadsheet_id": payload.spreadsheet_id,
        "worksheet_title": payload.worksheet_title,
        "match_strategy": "AD_ID",
        "ad_id_column": payload.ad_id_column,
        "date_column": payload.date_column,
        "date_format": payload.date_format,
        "leadscore_column": payload.leadscore_column,
        "cpr_max_column": payload.cpr_max_column,
    }
    try:
        # A partir de agora, permitimos múltiplas integrações por usuário (uma por pack).
        # Usamos on_conflict em (owner_id, pack_id):
        # - pack_id NULL ⇒ integração global (legado), no máximo 1 por usuário
        # - pack_id NOT NULL ⇒ no máximo 1 integração por (usuário, pack)
        sb.table("ad_sheet_integrations").upsert(data, on_conflict="owner_id,pack_id").execute()

        # Buscar o registro inserido/atualizado
        query = (
            sb.table("ad_sheet_integrations")
            .select("*")
            .eq("owner_id", user["user_id"])
        )
        if payload.pack_id is not None:
            query = query.eq("pack_id", payload.pack_id)
        else:
            query = query.is_("pack_id", None)

        res = query.limit(1).execute()
    except Exception as e:
        logger.exception("[AD_SHEET_INTEGRATION] Erro ao salvar configuração")
        raise HTTPException(status_code=500, detail="Erro ao salvar configuração.")

    rec = (res.data or [{}])[0]
    integration_id = rec.get("id")
    
    # Se pack_id foi fornecido, atualizar o pack com sheet_integration_id
    if payload.pack_id and integration_id:
        try:
            from datetime import datetime as dt
            now_iso = dt.utcnow().isoformat(timespec="seconds") + "Z"
            sb.table("packs").update({
                "sheet_integration_id": integration_id,
                "updated_at": now_iso
            }).eq("id", payload.pack_id).eq("user_id", user["user_id"]).execute()
            logger.info(f"[AD_SHEET_INTEGRATION] Pack {payload.pack_id} atualizado com sheet_integration_id={integration_id}")
        except Exception as e:
            logger.warning(f"[AD_SHEET_INTEGRATION] Erro ao atualizar pack {payload.pack_id}: {e}")
            # Não falhar a operação principal se isso falhar
    
    return {"integration": rec}


@router.post("/ad-sheet-integrations/{integration_id}/sync")
def sync_ad_sheet_integration(
    integration_id: str,
    user=Depends(get_current_user),
):
    """
    Dispara o import/patch da planilha para ad_metrics.
    Para o MVP, roda síncrono e retorna estatísticas simples.
    """
    try:
        stats = run_ad_metrics_sheet_import(
            user_jwt=user["token"],
            user_id=user["user_id"],
            integration_id=integration_id,
        )
    except AdMetricsImportError as e:
        # Atualizar status da integração como erro
        try:
            sb = get_supabase_for_user(user["token"])
            from datetime import datetime as dt

            now_iso = dt.utcnow().isoformat(timespec="seconds") + "Z"
            sb.table("ad_sheet_integrations").update(
                {
                    "last_synced_at": now_iso,
                    "last_sync_status": f"ERROR: {e}",
                    "updated_at": now_iso,
                }
            ).eq("id", integration_id).eq("owner_id", user["user_id"]).execute()
        except Exception:
            logger.warning(
                "[AD_SHEET_INTEGRATION] Falha ao registrar erro de sync para integração %s",
                integration_id,
            )

        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("[AD_SHEET_INTEGRATION] Erro inesperado ao rodar sync")
        raise HTTPException(
            status_code=500, detail="Erro inesperado ao sincronizar planilha."
        )

    return {"status": "ok", "stats": stats}


@router.get("/ad-sheet-integrations")
def list_ad_sheet_integrations(
    pack_id: Optional[str] = Query(None, description="Filtrar por pack_id. Se não fornecido, retorna todas as integrações do usuário."),
    user=Depends(get_current_user),
):
    """
    Lista integrações de planilhas do usuário.
    Se pack_id for fornecido, retorna apenas a integração daquele pack (se existir).
    """
    sb = get_supabase_for_user(user["token"])
    
    query = (
        sb.table("ad_sheet_integrations")
        .select("*")
        .eq("owner_id", user["user_id"])
    )
    
    if pack_id:
        query = query.eq("pack_id", pack_id)
    else:
        # Se não fornecer pack_id, retorna todas (incluindo globais com pack_id NULL)
        pass
    
    res = query.order("created_at", desc=True).execute()
    
    integrations = res.data or []
    
    # Para cada integração, buscar nome da planilha via Google API
    # (spreadsheet_id está armazenado, mas nome não)
    enriched_integrations = []
    for integration in integrations:
        spreadsheet_id = integration.get("spreadsheet_id")
        if spreadsheet_id:
            try:
                # Buscar nome da planilha via Google API
                from app.services.google_sheets_service import list_spreadsheets
                spreadsheets, _ = list_spreadsheets(
                    user_jwt=user["token"],
                    user_id=user["user_id"],
                    query=None,
                    page_size=100,  # Buscar até 100 para encontrar a planilha
                )
                # Encontrar a planilha pelo ID
                matching_spreadsheet = next(
                    (s for s in spreadsheets if s.get("id") == spreadsheet_id),
                    None
                )
                if matching_spreadsheet:
                    integration["spreadsheet_name"] = matching_spreadsheet.get("name", "Planilha desconhecida")
                else:
                    integration["spreadsheet_name"] = None  # Não encontrada ou sem acesso
            except Exception as e:
                logger.warning(
                    "[AD_SHEET_INTEGRATION] Erro ao buscar nome da planilha %s: %s",
                    spreadsheet_id,
                    e,
                )
                integration["spreadsheet_name"] = None
        else:
            integration["spreadsheet_name"] = None
        
        enriched_integrations.append(integration)
    
    return {"integrations": enriched_integrations}



