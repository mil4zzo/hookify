from __future__ import annotations

import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Dict, Any

import requests
from fastapi import APIRouter, Depends, HTTPException, Query, Body, BackgroundTasks
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
from app.services.google_sheets_service import fetch_headers, list_spreadsheets, list_worksheets, get_spreadsheet_name, GoogleSheetsError
from app.services.google_errors import (
    raise_google_http_error,
    GOOGLE_TOKEN_EXPIRED,
    GOOGLE_SHEETS_ERROR,
    GOOGLE_DRIVE_ERROR,
)
from app.services.ad_metrics_sheet_importer import (
    run_ad_metrics_sheet_import,
    AdMetricsImportError,
)
from app.core.supabase_client import get_supabase_for_user
from app.services.google_sheet_sync_job import create_sync_job, process_sync_job
from app.services.job_tracker import get_job_tracker

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
            logger.info(
                "[GOOGLE_OAUTH] Informações do usuário obtidas: email=%s, name=%s, id=%s",
                google_email,
                google_name,
                google_user_id,
            )
        else:
            logger.warning(
                "[GOOGLE_OAUTH] Erro ao buscar informações do usuário: status=%s, response=%s",
                userinfo_resp.status_code,
                userinfo_resp.text[:200],
            )
    except Exception as e:
        logger.warning(f"[GOOGLE_OAUTH] Erro ao buscar informações do usuário Google: {e}", exc_info=True)

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

    # Atualizar integrações que referenciam conexões antigas/revogadas
    new_connection_id = rec.get("id")
    new_google_user_id = rec.get("google_user_id")

    if new_connection_id:
        try:
            from app.core.supabase_client import get_supabase_for_user
            sb = get_supabase_for_user(user["token"])

            # Buscar todas as integrações do usuário
            integrations = sb.table("ad_sheet_integrations").select("id,connection_id").eq("owner_id", user["user_id"]).execute()

            if integrations.data:
                # Buscar todas as conexões ativas com seus google_user_ids
                active_connections = sb.table("google_accounts").select("id,google_user_id").eq("user_id", user["user_id"]).execute()
                active_connection_map = {conn["id"]: conn.get("google_user_id") for conn in (active_connections.data or [])}

                # Atualizar integrações que referenciam conexões revogadas ou da mesma conta Google
                updated_count = 0
                for integration in integrations.data:
                    old_connection_id = integration.get("connection_id")
                    should_update = False
                    update_reason = ""

                    if not old_connection_id:
                        # Integração sem connection_id
                        should_update = True
                        update_reason = "sem connection_id"
                    elif old_connection_id not in active_connection_map:
                        # Connection_id não existe mais (revogado/deletado)
                        should_update = True
                        update_reason = "conexão revogada"
                    elif new_google_user_id and active_connection_map.get(old_connection_id) == new_google_user_id:
                        # Mesma conta Google sendo reconectada - atualizar para usar a nova conexão
                        should_update = True
                        update_reason = "mesma conta reconectada"

                    if should_update:
                        sb.table("ad_sheet_integrations").update({
                            "connection_id": new_connection_id,
                            "updated_at": datetime.now(timezone.utc).isoformat()
                        }).eq("id", integration["id"]).eq("owner_id", user["user_id"]).execute()

                        updated_count += 1
                        logger.info(
                            f"[GOOGLE_OAUTH] Integração {integration['id']} atualizada ({update_reason}): {old_connection_id or 'null'} -> {new_connection_id}"
                        )

                if updated_count > 0:
                    logger.info(f"[GOOGLE_OAUTH] {updated_count} integração(ões) atualizada(s) para nova conexão")
                else:
                    logger.info(f"[GOOGLE_OAUTH] Nenhuma integração precisou ser atualizada")
        except Exception as e:
            # Não falhar o OAuth se atualização de integrações falhar
            logger.warning(f"[GOOGLE_OAUTH] Erro ao atualizar integrações: {e}", exc_info=True)

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


@router.get("/connections/{connection_id}/test")
def test_google_connection(
    connection_id: str,
    user=Depends(get_current_user),
):
    """
    Testa se uma conexão Google específica está válida.
    Faz uma requisição simples para listar planilhas usando os tokens dessa conexão.
    """
    try:
        # Tentar listar planilhas usando essa conexão específica (apenas 1 resultado para teste rápido)
        spreadsheets, _ = list_spreadsheets(
            user_jwt=user["token"],
            user_id=user["user_id"],
            connection_id=connection_id,
            page_size=1,
        )
        return {"valid": True, "message": "Conexão válida"}
    except GoogleSheetsError as e:
        error_message = e.message if hasattr(e, 'message') else str(e)
        error_code = getattr(e, 'code', None)
        # Verificar se é erro de token expirado/revogado usando código estruturado
        is_expired = error_code == GOOGLE_TOKEN_EXPIRED
        return {
            "valid": False,
            "expired": is_expired,
            "message": error_message,
            "code": error_code,
        }
    except Exception as e:
        logger.exception(f"[GOOGLE_CONNECTION_TEST] Erro inesperado ao testar conexão {connection_id}")
        return {
            "valid": False,
            "expired": False,
            "message": f"Erro ao testar conexão: {str(e)}",
        }


@router.get("/spreadsheets")
def list_user_spreadsheets(
    query: Optional[str] = Query(None, description="Busca por nome da planilha"),
    page_size: int = Query(20, ge=1, le=100, description="Número de resultados por página"),
    page_token: Optional[str] = Query(None, description="Token de paginação para próxima página"),
    connection_id: Optional[str] = Query(None, description="ID da conexão Google específica a usar"),
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
            connection_id=connection_id,
        )
    except GoogleSheetsError as e:
        error_code = getattr(e, 'code', GOOGLE_SHEETS_ERROR)
        error_message = e.message if hasattr(e, 'message') else str(e)
        error_details = getattr(e, 'details', {})
        raise_google_http_error(
            code=error_code,
            message=error_message,
            status_code=400,
            details=error_details,
        )
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
    connection_id: Optional[str] = Query(None, description="ID da conexão Google específica a usar"),
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
            connection_id=connection_id,
        )
    except GoogleSheetsError as e:
        error_code = getattr(e, 'code', GOOGLE_SHEETS_ERROR)
        error_message = e.message if hasattr(e, 'message') else str(e)
        error_details = getattr(e, 'details', {})
        raise_google_http_error(
            code=error_code,
            message=error_message,
            status_code=400,
            details=error_details,
        )
    except Exception as e:
        logger.exception("[GOOGLE_SHEETS] Erro inesperado ao listar abas")
        raise HTTPException(status_code=500, detail="Erro ao listar abas da planilha")

    return {"worksheets": worksheets}


@router.get("/sheets/{spreadsheet_id}/worksheets/{worksheet_title}/columns")
def list_sheet_columns(
    spreadsheet_id: str,
    worksheet_title: str,
    connection_id: Optional[str] = Query(None, description="ID da conexão Google específica a usar"),
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
            connection_id=connection_id,
        )
    except GoogleSheetsError as e:
        error_code = getattr(e, 'code', GOOGLE_SHEETS_ERROR)
        error_message = e.message if hasattr(e, 'message') else str(e)
        error_details = getattr(e, 'details', {})
        raise_google_http_error(
            code=error_code,
            message=error_message,
            status_code=400,
            details=error_details,
        )
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
    # ID da conexão Google específica a usar para esta integração
    connection_id: Optional[str] = None


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
        "connection_id": payload.connection_id,
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
    integration_id = rec.get("id") if isinstance(rec, dict) else None
    
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


@router.post("/ad-sheet-integrations/{integration_id}/sync-job")
def start_sync_job(
    integration_id: str,
    background_tasks: BackgroundTasks,
    user=Depends(get_current_user),
):
    """
    Inicia um job assíncrono de sincronização da planilha Google Sheets.
    Retorna job_id para polling de progresso.
    """
    try:
        # Verificar se a integração existe
        sb = get_supabase_for_user(user["token"])
        integration = (
            sb.table("ad_sheet_integrations")
            .select("*")
            .eq("id", integration_id)
            .eq("owner_id", user["user_id"])
            .limit(1)
            .execute()
        )
        
        if not integration.data or len(integration.data) == 0:
            raise HTTPException(
                status_code=404,
                detail="Integração não encontrada.",
            )
        
        # Criar job
        job_id = create_sync_job(
            user_jwt=user["token"],
            user_id=user["user_id"],
            integration_id=integration_id,
        )
        
        # Iniciar processamento em background
        background_tasks.add_task(
            process_sync_job,
            user_jwt=user["token"],
            user_id=user["user_id"],
            job_id=job_id,
            integration_id=integration_id,
        )
        
        logger.info(f"[GOOGLE_SYNC] Job {job_id} iniciado para integração {integration_id}")
        
        return {"job_id": job_id}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"[GOOGLE_SYNC] Erro ao iniciar job para integração {integration_id}")
        raise HTTPException(status_code=500, detail=f"Erro ao iniciar sincronização: {str(e)}")


@router.get("/sync-jobs/{job_id}")
def get_sync_job_progress(
    job_id: str,
    user=Depends(get_current_user),
):
    """
    Retorna o progresso de um job de sincronização.
    """
    try:
        tracker = get_job_tracker(user["token"], user["user_id"])
        progress = tracker.get_public_progress(job_id)
        
        if not progress or progress.get("status") == "error":
            raise HTTPException(
                status_code=404,
                detail="Job não encontrado.",
            )
        
        # Se completed, incluir stats do payload
        if progress.get("status") == "completed":
            job = tracker.get_job(job_id)
            if job and job.get("payload"):
                details = job.get("payload", {}).get("details", {})
                if details:
                    progress["stats"] = {
                        "rows_read": details.get("rows_read", 0),
                        "rows_processed": details.get("rows_processed", 0),
                        "rows_updated": details.get("rows_updated", 0),
                        "rows_skipped": details.get("rows_skipped", 0),
                        "errors": details.get("errors", []),
                    }
        
        return progress
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"[GOOGLE_SYNC] Erro ao obter progresso do job {job_id}")
        raise HTTPException(status_code=500, detail=f"Erro ao obter progresso: {str(e)}")


@router.post("/ad-sheet-integrations/{integration_id}/sync")
def sync_ad_sheet_integration(
    integration_id: str,
    user=Depends(get_current_user),
):
    """
    Dispara o import/patch da planilha para ad_metrics (síncrono - legado).
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
                    # last_successful_sync_at não é atualizado em caso de erro
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
    
    # Enriquecer com nomes das planilhas usando connection_id salvo
    enriched_integrations: List[Dict[str, Any]] = []
    for integration in integrations:
        if not isinstance(integration, dict):
            # Pular integrações que não são dicts (não deveria acontecer, mas type checker precisa)
            continue
            
        spreadsheet_id = integration.get("spreadsheet_id")
        connection_id = integration.get("connection_id")
        
        if spreadsheet_id and isinstance(spreadsheet_id, str):
            try:
                # Buscar nome da planilha diretamente pelo ID (muito mais eficiente)
                spreadsheet_name = get_spreadsheet_name(
                    user_jwt=user["token"],
                    user_id=user["user_id"],
                    spreadsheet_id=spreadsheet_id,
                    connection_id=connection_id if isinstance(connection_id, str) else None,
                )
                integration["spreadsheet_name"] = spreadsheet_name or "Planilha desconhecida"
            except GoogleSheetsError as e:
                # Se for erro de token expirado, não falhar completamente
                error_code = getattr(e, 'code', None)
                if error_code == GOOGLE_TOKEN_EXPIRED:
                    logger.warning(
                        "[AD_SHEET_INTEGRATION] Token expirado ao buscar nome da planilha %s (connection_id: %s)",
                        spreadsheet_id,
                        connection_id,
                    )
                else:
                    logger.warning(
                        "[AD_SHEET_INTEGRATION] Erro ao buscar nome da planilha %s: %s",
                        spreadsheet_id,
                        e,
                    )
                integration["spreadsheet_name"] = None
            except Exception as e:
                logger.warning(
                    "[AD_SHEET_INTEGRATION] Erro inesperado ao buscar nome da planilha %s: %s",
                    spreadsheet_id,
                    e,
                )
                integration["spreadsheet_name"] = None
        else:
            integration["spreadsheet_name"] = None
        
        enriched_integrations.append(integration)
    
    return {"integrations": enriched_integrations}


@router.delete("/ad-sheet-integrations/{integration_id}")
def delete_ad_sheet_integration(
    integration_id: str,
    user=Depends(get_current_user),
):
    """
    Deleta uma integração de planilha específica.
    Se a integração estiver associada a um pack, remove a referência do pack também.
    """
    sb = get_supabase_for_user(user["token"])
    
    # Buscar a integração para verificar se existe e se pertence ao usuário
    res = (
        sb.table("ad_sheet_integrations")
        .select("id, pack_id")
        .eq("id", integration_id)
        .eq("owner_id", user["user_id"])
        .limit(1)
        .execute()
    )
    
    if not res.data:
        raise HTTPException(status_code=404, detail="Integração não encontrada")
    
    integration = res.data[0]
    pack_id = integration.get("pack_id") if isinstance(integration, dict) else None
    
    # Deletar a integração
    try:
        sb.table("ad_sheet_integrations").delete().eq("id", integration_id).eq("owner_id", user["user_id"]).execute()
    except Exception as e:
        logger.exception("[AD_SHEET_INTEGRATION] Erro ao deletar integração")
        raise HTTPException(status_code=500, detail="Erro ao deletar integração")
    
    # Se estava associada a um pack, remover a referência do pack
    if pack_id:
        try:
            from datetime import datetime as dt
            now_iso = dt.utcnow().isoformat(timespec="seconds") + "Z"
            sb.table("packs").update({
                "sheet_integration_id": None,
                "updated_at": now_iso
            }).eq("id", pack_id).eq("user_id", user["user_id"]).execute()
            logger.info(f"[AD_SHEET_INTEGRATION] Referência removida do pack {pack_id}")
        except Exception as e:
            logger.warning(f"[AD_SHEET_INTEGRATION] Erro ao remover referência do pack {pack_id}: {e}")
            # Não falhar a operação principal se isso falhar
    
    return {"success": True}


