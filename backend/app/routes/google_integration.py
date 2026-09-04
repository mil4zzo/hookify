from __future__ import annotations

import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Dict, Any

import requests
from fastapi import APIRouter, Depends, HTTPException, Query, Body, BackgroundTasks
from pydantic import BaseModel

from app.core.auth import get_current_user
from app.core.supabase_client import get_supabase_service
from app.services.pack_access import assert_pack_role
from app.services import pack_action_log
from app.services import sheet_column_mappings
from app.core.config import (
    GOOGLE_OAUTH_CLIENT_ID,
    GOOGLE_OAUTH_CLIENT_SECRET,
    GOOGLE_OAUTH_AUTH_BASE_URL,
    GOOGLE_OAUTH_TOKEN_URL,
    GOOGLE_OAUTH_SCOPES,
)
from app.services.google_accounts_repo import upsert_google_account, list_google_accounts, delete_google_account
from app.services.google_sheets_service import fetch_columns_with_duplicate_detection, list_spreadsheets, list_worksheets, get_spreadsheet_name, GoogleSheetsError
from app.services.google_errors import (
    raise_google_http_error,
    GOOGLE_TOKEN_EXPIRED,
    GOOGLE_SHEETS_ERROR,
    GOOGLE_DRIVE_ERROR,
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
    # Opcao B (pack compartilhado): quando a reconexao foi disparada para um pack
    # de OUTRO usuario, a credencial vai para o silo do DONO. O gate valida que o
    # ator e dono|editor do pack — viewer nao reconecta credencial de terceiro.
    pack_id: Optional[str] = None


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

    # Silo de escrita: por padrao o proprio ator; para pack compartilhado (Opcao B),
    # o DONO do pack, via service role. assert_pack_role bloqueia viewer e quem nao
    # tem grant (403/404) — pack_id vindo do cliente e seguro por causa do gate.
    write_jwt = user["token"]
    silo_user_id = user["user_id"]
    relink_access = None
    if request.pack_id:
        access = assert_pack_role(user["user_id"], request.pack_id, roles=("dono", "editor"))
        relink_access = access
        if access.owner_id and access.owner_id != user["user_id"]:
            write_jwt = None
            silo_user_id = access.owner_id
            logger.info(
                "[GOOGLE_OAUTH] Reconexao de pack compartilhado %s: credencial no silo do dono %s (ator %s)",
                request.pack_id, str(silo_user_id)[:8], str(user["user_id"])[:8],
            )

    rec = upsert_google_account(
        user_jwt=write_jwt,
        user_id=silo_user_id,
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
            link_sb = get_supabase_service() if write_jwt is None else get_supabase_for_user(write_jwt)

            # Buscar todas as integrações do silo de destino (ator ou dono)
            integrations = link_sb.table("ad_sheet_integrations").select("id,connection_id").eq("owner_id", silo_user_id).execute()

            if integrations.data:
                # Buscar todas as conexões ativas com seus google_user_ids
                active_connections = link_sb.table("google_accounts").select("id,google_user_id").eq("user_id", silo_user_id).execute()
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
                        link_sb.table("ad_sheet_integrations").update({
                            "connection_id": new_connection_id,
                            "updated_at": datetime.now(timezone.utc).isoformat()
                        }).eq("id", integration["id"]).eq("owner_id", silo_user_id).execute()

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

    # Autoria (P3.5). A Opcao B deixa o convidado gravar uma credencial Google
    # DENTRO do silo do dono — a acao de maior alcance que um nao-dono executa em
    # todo o app. O dono precisa poder ver que aconteceu, e com que conta.
    if request.pack_id and relink_access is not None:
        pack_action_log.log_pack_action(
            action=pack_action_log.ACTION_PACK_SHEET_RELINK,
            actor_id=str(user["user_id"]),
            actor_role=relink_access.role,
            owner_id=str(silo_user_id),
            pack_ids=[str(request.pack_id)],
            target_type="integration",
            target_ids=[str(rec.get("id") or "")],
            detail={"google_email": rec.get("google_email")},
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
    Retorna colunas (header + amostra) com detecção de duplicatas.
    Usado pelo modal para montar os selects de ad_id, data e Leadscore.
    """
    try:
        result = fetch_columns_with_duplicate_detection(
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

    return {
        "columns": result["columns"],
        "duplicates": result["duplicates"],
        "sampleRows": result["sampleRows"],
        "columnsWithIndices": result["columnsWithIndices"],
    }


class SheetColumnMappingInput(BaseModel):
    """Uma coluna vinculada além do leadscore (migration 140).

    `id` presente = vínculo existente (só rótulo, corte e ordem mudam; `kind` e
    `column_index` são de mão única). Ausente = vínculo novo.
    """
    id: Optional[str] = None
    column_index: int
    column_name: str = ""
    label: str
    kind: str  # leadscore | number | category
    mql_min: Optional[float] = None  # obrigatório para leadscore
    position: Optional[int] = None


class SheetColumnMappingPatch(BaseModel):
    """PUT de um vínculo: campo ausente não mexe. `kind`/`column_index` não existem aqui de propósito."""
    label: Optional[str] = None
    mql_min: Optional[float] = None
    position: Optional[int] = None


class SheetIntegrationRequest(BaseModel):
    spreadsheet_id: str
    worksheet_title: str
    ad_id_column: str
    date_column: str
    date_format: str  # 'DD/MM/YYYY' ou 'MM/DD/YYYY'
    leadscore_column: str
    # Índices explícitos quando há headers duplicados (0-based)
    ad_id_column_index: Optional[int] = None
    date_column_index: Optional[int] = None
    leadscore_column_index: Optional[int] = None
    # Quando informado, a integração passa a ser específica daquele pack
    pack_id: Optional[str] = None
    # ID da conexão Google específica a usar para esta integração
    connection_id: Optional[str] = None
    # 140: conjunto DESEJADO de colunas vinculadas. None = não mexe nos vínculos
    # existentes; lista (mesmo vazia) = reconcilia: atualiza por id, cria os sem id,
    # exclui os que ficaram de fora.
    column_mappings: Optional[List[SheetColumnMappingInput]] = None


def _reconcile_column_mappings(
    sb,
    *,
    owner_id: str,
    integration_id: str,
    payload: SheetIntegrationRequest,
) -> List[Dict[str, Any]]:
    """Aplica `payload.column_mappings` como o conjunto desejado de vínculos.

    Validação ANTES de qualquer escrita: rótulo, tipo, corte, índice único, e a
    coluna não pode ser a de ad_id nem a de data (pode ser a de leadscore — é assim
    que se compara o V1 com o V2 lado a lado). Erro em qualquer vínculo → 400 e
    nada gravado.
    """
    wanted = payload.column_mappings or []
    reserved: Dict[int, str] = {}
    if payload.ad_id_column_index is not None:
        reserved[int(payload.ad_id_column_index)] = "anúncio (ad_id)"
    if payload.date_column_index is not None:
        reserved[int(payload.date_column_index)] = "data"

    existing_by_id: Dict[str, Dict[str, Any]] = {}
    try:
        res = (
            sb.table("sheet_column_mappings")
            .select(sheet_column_mappings.MAPPING_SELECT)
            .eq("integration_id", integration_id)
            .eq("owner_id", owner_id)
            .execute()
        )
        existing_by_id = {str(r["id"]): r for r in (res.data or []) if isinstance(r, dict)}
    except Exception as e:
        logger.exception("[SHEET_COLUMNS] Erro ao listar vínculos existentes")
        raise HTTPException(status_code=500, detail="Erro ao ler as colunas vinculadas.") from e

    to_update: List[tuple[str, Dict[str, Any]]] = []
    to_insert: List[Dict[str, Any]] = []
    seen_index: Dict[int, str] = {}
    keep_ids: set[str] = set()
    for pos, item in enumerate(wanted):
        try:
            kind = sheet_column_mappings.clean_kind(item.kind)
            label = sheet_column_mappings.clean_label(item.label)
            config = sheet_column_mappings.clean_config(kind, item.mql_min)
        except sheet_column_mappings.SheetColumnMappingError as e:
            raise HTTPException(status_code=400, detail=str(e))
        idx = int(item.column_index)
        if idx < 0:
            raise HTTPException(status_code=400, detail=f"Coluna '{label}': índice inválido.")
        if idx in reserved:
            raise HTTPException(status_code=400, detail=f"Coluna '{label}': é a coluna de {reserved[idx]}; escolha outra.")
        if idx in seen_index:
            raise HTTPException(status_code=400, detail=f"Colunas '{seen_index[idx]}' e '{label}' apontam para a mesma coluna da planilha.")
        seen_index[idx] = label
        position = int(item.position) if item.position is not None else pos
        column_name = str(item.column_name or "").strip()[:200]

        if item.id and str(item.id) in existing_by_id:
            cur = existing_by_id[str(item.id)]
            if str(cur.get("kind")) != kind:
                raise HTTPException(
                    status_code=400,
                    detail=f"Coluna '{label}': o tipo não pode mudar depois de criado. Exclua o vínculo e crie outro.",
                )
            if int(cur.get("column_index") or 0) != idx:
                raise HTTPException(
                    status_code=400,
                    detail=f"Coluna '{label}': a coluna da planilha não pode mudar depois de criada. Exclua o vínculo e crie outro.",
                )
            keep_ids.add(str(item.id))
            to_update.append((str(item.id), {"label": label, "config": config, "position": position, "column_name": column_name or cur.get("column_name") or ""}))
        else:
            to_insert.append({
                "integration_id": integration_id,
                "owner_id": owner_id,
                "column_index": idx,
                "column_name": column_name,
                "label": label,
                "kind": kind,
                "config": config,
                "position": position,
            })

    to_delete = [mid for mid in existing_by_id if mid not in keep_ids]
    try:
        for mid in to_delete:
            sb.table("sheet_column_mappings").delete().eq("id", mid).eq("owner_id", owner_id).execute()
        for mid, fields in to_update:
            sb.table("sheet_column_mappings").update(fields).eq("id", mid).eq("owner_id", owner_id).execute()
        if to_insert:
            sb.table("sheet_column_mappings").insert(to_insert).execute()
    except Exception as e:
        logger.exception("[SHEET_COLUMNS] Erro ao gravar vínculos")
        raise HTTPException(status_code=500, detail="Erro ao gravar as colunas vinculadas.") from e

    return sheet_column_mappings.list_for_integrations(sb, [integration_id]).get(str(integration_id), [])


@router.post("/ad-sheet-integrations")
def save_ad_sheet_integration(
    payload: SheetIntegrationRequest,
    user=Depends(get_current_user),
):
    """
    Salva a configuração da integração da planilha para o usuário atual.

    - Caso `pack_id` seja informado, a integração é específica daquele pack
      (um "booster" de leadscore por pack).
    - Caso `pack_id` seja None, a integração é global (modo legado).
    """
    if not payload.leadscore_column:
        raise HTTPException(
            status_code=400,
            detail="É obrigatório selecionar a coluna de Leadscore.",
        )
    
    # Validar formato de data
    if payload.date_format not in ("DD/MM/YYYY", "MM/DD/YYYY"):
        raise HTTPException(
            status_code=400,
            detail="Formato de data inválido. Use 'DD/MM/YYYY' ou 'MM/DD/YYYY'.",
        )

    sb = get_supabase_for_user(user["token"])
    spreadsheet_name: Optional[str] = None
    if payload.spreadsheet_id:
        try:
            spreadsheet_name = get_spreadsheet_name(
                user_jwt=user["token"],
                user_id=user["user_id"],
                spreadsheet_id=payload.spreadsheet_id,
                connection_id=payload.connection_id,
            )
        except Exception as e:
            logger.warning(
                "[AD_SHEET_INTEGRATION] Não foi possível obter spreadsheet_name para %s: %s",
                payload.spreadsheet_id,
                e,
            )

    data = {
        "owner_id": user["user_id"],
        "pack_id": payload.pack_id,
        "spreadsheet_id": payload.spreadsheet_id,
        "spreadsheet_name": spreadsheet_name,
        "worksheet_title": payload.worksheet_title,
        "ad_id_column": payload.ad_id_column,
        "date_column": payload.date_column,
        "date_format": payload.date_format,
        "leadscore_column": payload.leadscore_column,
        "ad_id_column_index": payload.ad_id_column_index,
        "date_column_index": payload.date_column_index,
        "leadscore_column_index": payload.leadscore_column_index,
        "connection_id": payload.connection_id,
    }
    try:
        # Fluxo determinístico:
        # - pack_id NOT NULL: upsert por (owner_id, pack_id)
        # - pack_id NULL: update-or-insert explícito para evitar ambiguidade com NULL em on_conflict
        if payload.pack_id is not None:
            sb.table("ad_sheet_integrations").upsert(
                data,
                on_conflict="owner_id,pack_id",
            ).execute()
            res = (
                sb.table("ad_sheet_integrations")
                .select("*")
                .eq("owner_id", user["user_id"])
                .eq("pack_id", payload.pack_id)
                .limit(1)
                .execute()
            )
        else:
            existing_global = (
                sb.table("ad_sheet_integrations")
                .select("id")
                .eq("owner_id", user["user_id"])
                .is_("pack_id", None)
                .order("updated_at", desc=True)
                .limit(1)
                .execute()
            )
            if existing_global.data:
                global_id = existing_global.data[0]["id"]
                sb.table("ad_sheet_integrations").update(data).eq("id", global_id).eq("owner_id", user["user_id"]).execute()
            else:
                sb.table("ad_sheet_integrations").insert(data).execute()

            res = (
                sb.table("ad_sheet_integrations")
                .select("*")
                .eq("owner_id", user["user_id"])
                .is_("pack_id", None)
                .order("updated_at", desc=True)
                .limit(1)
                .execute()
            )
    except Exception as e:
        logger.exception("[AD_SHEET_INTEGRATION] Erro ao salvar configuração")
        raise HTTPException(status_code=500, detail="Erro ao salvar configuração.")

    rec = (res.data or [{}])[0]
    integration_id = rec.get("id") if isinstance(rec, dict) else None

    # 140: colunas vinculadas. Lista presente = conjunto desejado; None = não mexe.
    if isinstance(rec, dict) and integration_id:
        if payload.column_mappings is not None:
            rec["column_mappings"] = _reconcile_column_mappings(
                sb, owner_id=user["user_id"], integration_id=str(integration_id), payload=payload,
            )
        else:
            sheet_column_mappings.attach_to_integrations(sb, [rec])

    # Se pack_id foi fornecido, atualizar o pack com sheet_integration_id
    if payload.pack_id and integration_id:
        try:
            from datetime import datetime as dt
            now_iso = dt.now(timezone.utc).isoformat(timespec="seconds")
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
        # Caminho proprio: a integracao e do ator (RLS resolve)
        sb = get_supabase_for_user(user["token"])
        integration = (
            sb.table("ad_sheet_integrations")
            .select("*")
            .eq("id", integration_id)
            .eq("owner_id", user["user_id"])
            .limit(1)
            .execute()
        )

        sync_jwt: Optional[str] = user["token"]
        silo_user_id = str(user["user_id"])
        sync_pack_id = str((integration.data or [{}])[0].get("pack_id") or "")
        sync_role = "dono"

        if not integration.data or len(integration.data) == 0:
            # P3.3b: pode ser a integracao de um pack COMPARTILHADO — membro pode
            # disparar o sync do dono (decisao travada). Escopo derivado da
            # PROPRIA integracao (pack_id + owner_id), nunca do cliente.
            svc_rows = (
                get_supabase_service()
                .table("ad_sheet_integrations")
                .select("id, owner_id, pack_id")
                .eq("id", integration_id)
                .limit(1)
                .execute()
                .data
                or []
            )
            if not svc_rows or not svc_rows[0].get("pack_id"):
                raise HTTPException(status_code=404, detail="Integração não encontrada.")
            sync_access = assert_pack_role(
                user["user_id"], str(svc_rows[0]["pack_id"]), roles=("dono", "editor", "viewer")
            )
            sync_jwt = None  # contexto do dono via service role
            silo_user_id = str(svc_rows[0]["owner_id"])
            sync_pack_id = str(svc_rows[0]["pack_id"])
            sync_role = sync_access.role

        # Criar job (no silo do dono da integracao)
        job_id = create_sync_job(
            user_jwt=sync_jwt,
            user_id=silo_user_id,
            integration_id=integration_id,
            actor_id=user["user_id"],
        )
        
        # Iniciar processamento em background
        background_tasks.add_task(
            process_sync_job,
            user_jwt=sync_jwt,
            user_id=silo_user_id,
            job_id=job_id,
            integration_id=integration_id,
        )
        
        logger.info(f"[GOOGLE_SYNC] Job {job_id} iniciado para integração {integration_id}")

        # Autoria (P3.5): o sync roda com a credencial Google DO DONO e reescreve
        # o leadscore do pack — muda MQL e CPMQL para todo mundo que olha.
        pack_action_log.log_pack_action(
            action=pack_action_log.ACTION_PACK_SHEET_SYNC,
            actor_id=str(user["user_id"]),
            actor_role=sync_role,
            owner_id=silo_user_id,
            pack_ids=[sync_pack_id] if sync_pack_id else [],
            target_type="integration",
            target_ids=[str(integration_id)],
            detail={"job_id": str(job_id)},
        )

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
        # P3.3b: o job de sync pode viver no silo do DONO (disparo de membro em
        # pack compartilhado). Mesmo padrao do polling de refresh: localizar o
        # job, e se o silo for alheio exigir acesso ao pack da integracao.
        _rows = (
            get_supabase_service().table("jobs").select("user_id,payload").eq("id", job_id).limit(1).execute().data
            or []
        )
        silo_user_id = str(_rows[0]["user_id"]) if _rows else str(user["user_id"])
        is_guest_poll = silo_user_id != str(user["user_id"])
        if is_guest_poll:
            _integration_id = (_rows[0].get("payload") or {}).get("integration_id")
            _pack_id = None
            if _integration_id:
                _integ = (
                    get_supabase_service()
                    .table("ad_sheet_integrations")
                    .select("pack_id")
                    .eq("id", str(_integration_id))
                    .limit(1)
                    .execute()
                    .data
                    or []
                )
                _pack_id = _integ[0].get("pack_id") if _integ else None
            if not _pack_id:
                raise HTTPException(status_code=404, detail="Job não encontrado.")
            assert_pack_role(user["user_id"], str(_pack_id), roles=("dono", "editor", "viewer"))

        tracker = get_job_tracker(user["token"], silo_user_id, use_service_role=is_guest_poll)
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
                        # `rows_skipped` soma as duas ausências; a tela de resumo as
                        # distingue ("Inválidas" x "Ignoradas") e mostrava zero nas duas.
                        "skipped_invalid": details.get("skipped_invalid", 0),
                        "skipped_no_match": details.get("skipped_no_match", 0),
                        "unique_ad_date_pairs": details.get("unique_ad_date_pairs", 0),
                        "total_update_queries": details.get("total_update_queries", 0),
                        # 140: relatório por coluna vinculada (rótulo, tipo, valores lidos,
                        # células puladas, motivo quando a coluna inteira foi ignorada)
                        "custom_columns": details.get("custom_columns") or {},
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
    Endpoint legado descontinuado.
    Use /ad-sheet-integrations/{integration_id}/sync-job.
    """
    raise HTTPException(
        status_code=410,
        detail="Endpoint legado descontinuado. Utilize o fluxo assíncrono de sync-job.",
    )


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
    
    # Priorizar spreadsheet_name persistido; fallback remoto apenas quando ausente.
    enriched_integrations: List[Dict[str, Any]] = []
    for integration in integrations:
        if not isinstance(integration, dict):
            # Pular integrações que não são dicts (não deveria acontecer, mas type checker precisa)
            continue

        existing_name = integration.get("spreadsheet_name")
        if isinstance(existing_name, str) and existing_name.strip():
            enriched_integrations.append(integration)
            continue

        spreadsheet_id = integration.get("spreadsheet_id")
        connection_id = integration.get("connection_id")

        if spreadsheet_id and isinstance(spreadsheet_id, str):
            try:
                # Fallback pontual para preencher nome faltante em telas de configuração.
                spreadsheet_name = get_spreadsheet_name(
                    user_jwt=user["token"],
                    user_id=user["user_id"],
                    spreadsheet_id=spreadsheet_id,
                    connection_id=connection_id if isinstance(connection_id, str) else None,
                )
                integration["spreadsheet_name"] = spreadsheet_name or "Planilha desconhecida"
            except GoogleSheetsError as e:
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

    # 140: colunas vinculadas dentro de cada integração
    sheet_column_mappings.attach_to_integrations(sb, enriched_integrations)

    return {"integrations": enriched_integrations}


# ---------------------------------------------------------------------------
# 140: edição pontual de um vínculo (rótulo, corte, ordem) e exclusão.
# Gate: dono ou editor do pack da integração (viewer → 403; sem acesso → 404),
# o mesmo padrão do corte de MQL. Escrita por service role, porque a RLS de
# sheet_column_mappings só enxerga o silo do dono e recusaria um editor.
# Integração sem pack (legado global): só o dono.
# ---------------------------------------------------------------------------

def _resolve_mapping_for_write(actor_id: str, integration_id: str, mapping_id: str):
    sb = get_supabase_service()
    try:
        integ_res = (
            sb.table("ad_sheet_integrations")
            .select("id, owner_id, pack_id")
            .eq("id", integration_id)
            .limit(1)
            .execute()
        )
    except Exception as e:
        logger.exception("[SHEET_COLUMNS] Erro ao ler integração %s", integration_id)
        raise HTTPException(status_code=500, detail="Erro ao verificar a integração.") from e
    integ = (integ_res.data or [None])[0]
    if not isinstance(integ, dict):
        raise HTTPException(status_code=404, detail="Integração não encontrada")

    pack_id = integ.get("pack_id")
    if pack_id:
        access = assert_pack_role(actor_id, str(pack_id))  # dono|editor; viewer -> 403
        role, owner_id = access.role, access.owner_id
    else:
        if str(integ.get("owner_id")) != str(actor_id):
            raise HTTPException(status_code=404, detail="Integração não encontrada")
        role, owner_id = "dono", str(actor_id)

    try:
        row_res = (
            sb.table("sheet_column_mappings")
            .select(sheet_column_mappings.MAPPING_SELECT)
            .eq("id", mapping_id)
            .eq("integration_id", integration_id)
            .limit(1)
            .execute()
        )
    except Exception as e:
        logger.exception("[SHEET_COLUMNS] Erro ao ler vínculo %s", mapping_id)
        raise HTTPException(status_code=500, detail="Erro ao verificar a coluna vinculada.") from e
    row = (row_res.data or [None])[0]
    if not isinstance(row, dict):
        raise HTTPException(status_code=404, detail="Coluna vinculada não encontrada")
    return sb, row, role, owner_id, (str(pack_id) if pack_id else None)


@router.put("/ad-sheet-integrations/{integration_id}/columns/{mapping_id}")
def update_sheet_column_mapping(
    integration_id: str,
    mapping_id: str,
    payload: SheetColumnMappingPatch = Body(...),
    user=Depends(get_current_user),
):
    """Edita rótulo, corte de MQL (leadscore) e ordem de um vínculo. Tipo e coluna
    não mudam (exclua e crie outro). Escrevem dono e editor."""
    sb, row, role, owner_id, pack_id = _resolve_mapping_for_write(user["user_id"], integration_id, mapping_id)
    fields = payload.model_dump(exclude_unset=True)
    if not fields:
        raise HTTPException(status_code=400, detail="Nenhum campo enviado")

    update: Dict[str, Any] = {}
    try:
        if "label" in fields:
            update["label"] = sheet_column_mappings.clean_label(fields["label"])
        if "mql_min" in fields:
            if str(row.get("kind")) != sheet_column_mappings.KIND_LEADSCORE:
                raise HTTPException(status_code=400, detail="Só uma coluna do tipo leadscore tem corte de MQL.")
            update["config"] = sheet_column_mappings.clean_config(sheet_column_mappings.KIND_LEADSCORE, fields["mql_min"])
        if "position" in fields and fields["position"] is not None:
            update["position"] = int(fields["position"])
    except sheet_column_mappings.SheetColumnMappingError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not update:
        raise HTTPException(status_code=400, detail="Nenhum campo válido enviado")

    try:
        sb.table("sheet_column_mappings").update(update).eq("id", mapping_id).execute()
        res = sb.table("sheet_column_mappings").select(sheet_column_mappings.MAPPING_SELECT).eq("id", mapping_id).limit(1).execute()
    except Exception as e:
        logger.exception("[SHEET_COLUMNS] Erro ao atualizar vínculo %s", mapping_id)
        raise HTTPException(status_code=500, detail="Erro ao atualizar a coluna vinculada.") from e

    if pack_id:
        pack_action_log.log_pack_action(
            action=pack_action_log.ACTION_PACK_SHEET_COLUMNS,
            actor_id=str(user["user_id"]), actor_role=role, owner_id=owner_id,
            pack_ids=[pack_id], target_type="sheet_column", target_ids=[mapping_id],
            detail={"op": "update", "fields": sorted(update.keys()), "label": update.get("label", row.get("label"))},
        )
    updated = (res.data or [row])[0]
    return {"mapping": sheet_column_mappings.serialize(updated)}


@router.delete("/ad-sheet-integrations/{integration_id}/columns/{mapping_id}")
def delete_sheet_column_mapping(
    integration_id: str,
    mapping_id: str,
    user=Depends(get_current_user),
):
    """Exclui um vínculo. O dado já importado fica em ad_metrics até o próximo sync
    reescrever a linha (sem purge, decisão 11 do plano); a UI só conhece vínculos
    existentes, então a coluna some na hora. Escrevem dono e editor."""
    sb, row, role, owner_id, pack_id = _resolve_mapping_for_write(user["user_id"], integration_id, mapping_id)
    try:
        sb.table("sheet_column_mappings").delete().eq("id", mapping_id).execute()
    except Exception as e:
        logger.exception("[SHEET_COLUMNS] Erro ao excluir vínculo %s", mapping_id)
        raise HTTPException(status_code=500, detail="Erro ao excluir a coluna vinculada.") from e

    if pack_id:
        pack_action_log.log_pack_action(
            action=pack_action_log.ACTION_PACK_SHEET_COLUMNS,
            actor_id=str(user["user_id"]), actor_role=role, owner_id=owner_id,
            pack_ids=[pack_id], target_type="sheet_column", target_ids=[mapping_id],
            detail={"op": "delete", "label": row.get("label"), "kind": row.get("kind")},
        )
    return {"success": True, "mapping_id": mapping_id}


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
            now_iso = dt.now(timezone.utc).isoformat(timespec="seconds")
            sb.table("packs").update({
                "sheet_integration_id": None,
                "updated_at": now_iso
            }).eq("id", pack_id).eq("user_id", user["user_id"]).execute()
            logger.info(f"[AD_SHEET_INTEGRATION] Referência removida do pack {pack_id}")
        except Exception as e:
            logger.warning(f"[AD_SHEET_INTEGRATION] Erro ao remover referência do pack {pack_id}: {e}")
            # Não falhar a operação principal se isso falhar
    
    return {"success": True}
