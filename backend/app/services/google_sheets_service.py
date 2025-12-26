from __future__ import annotations

import logging
from typing import List, Tuple, Optional, Dict, Any
from urllib.parse import quote

import requests

from app.services.google_token_service import get_google_access_token_for_user
from app.services.google_errors import (
    raise_google_http_error,
    GOOGLE_TOKEN_EXPIRED,
    GOOGLE_SHEETS_ERROR,
    GOOGLE_DRIVE_ERROR,
    GOOGLE_CONNECTION_NOT_FOUND,
)

logger = logging.getLogger(__name__)

SHEETS_API_BASE = "https://sheets.googleapis.com/v4/spreadsheets"
DRIVE_API_BASE = "https://www.googleapis.com/drive/v3"


class GoogleSheetsError(Exception):
    """
    Exceção interna para erros do Google Sheets.
    Deve ser convertida para HTTPException com código estruturado antes de chegar ao frontend.
    """
    def __init__(self, message: str, code: str = GOOGLE_SHEETS_ERROR, details: Optional[Dict[str, Any]] = None):
        super().__init__(message)
        self.message = message
        self.code = code
        self.details = details or {}


def _build_sheet_range(worksheet_title: str, range_suffix: str | None = None) -> str:
    """
    Monta o range no formato esperado pela API do Sheets, escapando o título da aba.
    Ex: worksheet_title='Minha aba' -> 'Minha aba'!A1:Z
    """
    # O título da aba deve ser entre aspas simples se tiver espaços, conforme a API.
    safe_title = worksheet_title.replace("'", "''")
    base = f"'{safe_title}'"
    if range_suffix:
        return f"{base}!{range_suffix}"
    return base


def fetch_headers(
    user_jwt: str,
    user_id: str,
    spreadsheet_id: str,
    worksheet_title: str,
    connection_id: Optional[str] = None,
) -> List[str]:
    """
    Busca apenas a primeira linha (headers) da aba para montar os selects no frontend.
    
    Args:
        user_jwt: JWT do Supabase do usuário
        user_id: ID do usuário
        spreadsheet_id: ID da planilha
        worksheet_title: Título da aba
        connection_id: ID da conexão Google específica (opcional)
    """
    access_token = get_google_access_token_for_user(user_jwt, user_id, connection_id)
    if not access_token:
        raise GoogleSheetsError(
            "Conta Google não conectada para este usuário.",
            code=GOOGLE_CONNECTION_NOT_FOUND,
            details={"connection_id": connection_id, "operation": "fetch_headers"}
        )

    value_range = _build_sheet_range(worksheet_title, "1:1")
    url = f"{SHEETS_API_BASE}/{quote(spreadsheet_id)}/values/{quote(value_range)}"

    resp = requests.get(
        url,
        headers={"Authorization": f"Bearer {access_token}"},
        params={"majorDimension": "ROWS"},
        timeout=15,
    )

    # Retry com force_refresh se receber 401
    if resp.status_code == 401:
        logger.warning("[GOOGLE_SHEETS] Unauthorized when fetching headers, attempting refresh")
        try:
            # Tentar refresh forçado do token
            access_token = get_google_access_token_for_user(
                user_jwt, user_id, connection_id, force_refresh=True
            )
            if access_token:
                # Retry com token atualizado
                resp = requests.get(
                    url,
                    headers={"Authorization": f"Bearer {access_token}"},
                    params={"majorDimension": "ROWS"},
                    timeout=15,
                )
        except Exception as refresh_error:
            logger.warning(f"[GOOGLE_SHEETS] Refresh failed: {refresh_error}")
        
        # Se ainda for 401 após retry, lançar erro
        if resp.status_code == 401:
            logger.warning("[GOOGLE_SHEETS] Unauthorized after refresh when fetching headers")
            raise GoogleSheetsError(
                "Token do Google inválido ou expirado. Refaça a conexão.",
                code=GOOGLE_TOKEN_EXPIRED,
                details={"http_status": 401, "operation": "fetch_headers"}
            )
    if resp.status_code != 200:
        logger.error(
            "[GOOGLE_SHEETS] Error fetching headers: %s - %s",
            resp.status_code,
            resp.text,
        )
        raise GoogleSheetsError(
            f"Erro ao ler planilha do Google (status {resp.status_code}).",
            code=GOOGLE_SHEETS_ERROR,
            details={"http_status": resp.status_code, "operation": "fetch_headers"}
        )

    data = resp.json()
    values = data.get("values") or []
    if not values:
        return []

    headers = values[0] or []
    # Normalizar para string
    return [str(h) for h in headers]


def fetch_all_rows(
    user_jwt: str,
    user_id: str,
    spreadsheet_id: str,
    worksheet_title: str,
    connection_id: Optional[str] = None,
) -> Tuple[List[str], List[List[str]]]:
    """
    Busca toda a aba: primeira linha é header, demais são dados.

    Args:
        user_jwt: JWT do Supabase do usuário
        user_id: ID do usuário
        spreadsheet_id: ID da planilha
        worksheet_title: Título da aba
        connection_id: ID da conexão Google específica (opcional)

    Retorna:
        headers, rows (sem incluir o header).
    """
    access_token = get_google_access_token_for_user(user_jwt, user_id, connection_id)
    if not access_token:
        raise GoogleSheetsError(
            "Conta Google não conectada para este usuário.",
            code=GOOGLE_CONNECTION_NOT_FOUND,
            details={"connection_id": connection_id, "operation": "fetch_headers"}
        )

    value_range = _build_sheet_range(worksheet_title)
    url = f"{SHEETS_API_BASE}/{quote(spreadsheet_id)}/values/{quote(value_range)}"

    resp = requests.get(
        url,
        headers={"Authorization": f"Bearer {access_token}"},
        params={
            "majorDimension": "ROWS",
            "valueRenderOption": "UNFORMATTED_VALUE",
            "dateTimeRenderOption": "FORMATTED_STRING",
        },
        timeout=30,
    )

    # Retry com force_refresh se receber 401
    if resp.status_code == 401:
        logger.warning("[GOOGLE_SHEETS] Unauthorized when fetching rows, attempting refresh")
        try:
            # Tentar refresh forçado do token
            access_token = get_google_access_token_for_user(
                user_jwt, user_id, connection_id, force_refresh=True
            )
            if access_token:
                # Retry com token atualizado
                resp = requests.get(
                    url,
                    headers={"Authorization": f"Bearer {access_token}"},
                    params={
                        "majorDimension": "ROWS",
                        "valueRenderOption": "UNFORMATTED_VALUE",
                        "dateTimeRenderOption": "FORMATTED_STRING",
                    },
                    timeout=30,
                )
        except Exception as refresh_error:
            logger.warning(f"[GOOGLE_SHEETS] Refresh failed: {refresh_error}")
        
        # Se ainda for 401 após retry, lançar erro
        if resp.status_code == 401:
            logger.warning("[GOOGLE_SHEETS] Unauthorized after refresh when fetching rows")
            raise GoogleSheetsError(
                "Token do Google inválido ou expirado. Refaça a conexão.",
                code=GOOGLE_TOKEN_EXPIRED,
                details={"http_status": 401, "operation": "fetch_all_rows"}
            )
    if resp.status_code != 200:
        logger.error(
            "[GOOGLE_SHEETS] Error fetching rows: %s - %s",
            resp.status_code,
            resp.text,
        )
        raise GoogleSheetsError(
            f"Erro ao ler planilha do Google (status {resp.status_code}).",
            code=GOOGLE_SHEETS_ERROR,
            details={"http_status": resp.status_code, "operation": "fetch_all_rows"}
        )

    data = resp.json()
    values = data.get("values") or []
    if not values:
        return [], []

    headers = [str(h) for h in (values[0] or [])]
    rows = [[str(c) for c in (row or [])] for row in values[1:]]
    return headers, rows


def list_spreadsheets(
    user_jwt: str,
    user_id: str,
    query: Optional[str] = None,
    page_size: int = 20,
    page_token: Optional[str] = None,
    connection_id: Optional[str] = None,
) -> Tuple[List[dict], Optional[str]]:
    """
    Lista planilhas do Google Drive do usuário, ordenadas por modificação recente.
    
    Args:
        user_jwt: JWT do Supabase do usuário
        user_id: ID do usuário
        query: Query de busca opcional (ex: "name contains 'test'")
        page_size: Número de resultados por página (padrão 20, máximo 100)
        page_token: Token de paginação para próxima página (None = primeira página)
        connection_id: ID da conexão Google específica (opcional)
    
    Returns:
        Tupla (lista_de_planilhas, next_page_token) onde:
        - lista_de_planilhas: Lista de dicts com {id, name, modifiedTime, webViewLink}
        - next_page_token: Token para próxima página ou None se não houver mais
    """
    access_token = get_google_access_token_for_user(user_jwt, user_id, connection_id)
    if not access_token:
        raise GoogleSheetsError(
            "Conta Google não conectada para este usuário.",
            code=GOOGLE_CONNECTION_NOT_FOUND,
            details={"connection_id": connection_id, "operation": "fetch_headers"}
        )

    # Construir query para buscar apenas arquivos do tipo spreadsheet
    # MIME type do Google Sheets: application/vnd.google-apps.spreadsheet
    drive_query = "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false"
    
    # Adicionar busca por nome se fornecido
    if query and query.strip():
        # Escapar aspas simples na query
        safe_query = query.strip().replace("'", "\\'")
        drive_query += f" and name contains '{safe_query}'"
    
    params = {
        "q": drive_query,
        "pageSize": min(page_size, 100),  # Máximo da API é 100
        "fields": "nextPageToken, files(id, name, modifiedTime, webViewLink)",
        "orderBy": "modifiedTime desc",  # Mais recentes primeiro
    }
    
    if page_token:
        params["pageToken"] = page_token

    resp = requests.get(
        f"{DRIVE_API_BASE}/files",
        headers={"Authorization": f"Bearer {access_token}"},
        params=params,
        timeout=15,
    )

    # Retry com force_refresh se receber 401
    if resp.status_code == 401:
        logger.warning("[GOOGLE_DRIVE] Unauthorized when listing spreadsheets, attempting refresh")
        try:
            # Tentar refresh forçado do token
            access_token = get_google_access_token_for_user(
                user_jwt, user_id, connection_id, force_refresh=True
            )
            if access_token:
                # Retry com token atualizado
                resp = requests.get(
                    f"{DRIVE_API_BASE}/files",
                    headers={"Authorization": f"Bearer {access_token}"},
                    params=params,
                    timeout=15,
                )
        except Exception as refresh_error:
            logger.warning(f"[GOOGLE_DRIVE] Refresh failed: {refresh_error}")
        
        # Se ainda for 401 após retry, lançar erro
        if resp.status_code == 401:
            logger.warning("[GOOGLE_DRIVE] Unauthorized after refresh when listing spreadsheets")
            raise GoogleSheetsError(
                "Token do Google inválido ou expirado. Refaça a conexão.",
                code=GOOGLE_TOKEN_EXPIRED,
                details={"http_status": 401, "operation": "list_spreadsheets"}
            )
    if resp.status_code != 200:
        logger.error(
            "[GOOGLE_DRIVE] Error listing spreadsheets: %s - %s",
            resp.status_code,
            resp.text,
        )
        raise GoogleSheetsError(
            f"Erro ao listar planilhas do Google (status {resp.status_code}).",
            code=GOOGLE_DRIVE_ERROR,
            details={"http_status": resp.status_code, "operation": "list_spreadsheets"}
        )

    data = resp.json()
    files = data.get("files") or []
    
    # Formatar resultados
    spreadsheets = [
        {
            "id": f.get("id"),
            "name": f.get("name", "Sem nome"),
            "modified_time": f.get("modifiedTime"),
            "web_view_link": f.get("webViewLink"),
        }
        for f in files
    ]
    
    next_page_token = data.get("nextPageToken")
    
    return spreadsheets, next_page_token


def list_worksheets(
    user_jwt: str,
    user_id: str,
    spreadsheet_id: str,
    connection_id: Optional[str] = None,
) -> List[dict]:
    """
    Lista todas as abas (worksheets) de uma planilha do Google Sheets.
    
    Args:
        user_jwt: JWT do Supabase do usuário
        user_id: ID do usuário
        spreadsheet_id: ID da planilha
        connection_id: ID da conexão Google específica (opcional)
    
    Returns:
        Lista de dicts com {id, title, index, sheetType}
    """
    access_token = get_google_access_token_for_user(user_jwt, user_id, connection_id)
    if not access_token:
        raise GoogleSheetsError(
            "Conta Google não conectada para este usuário.",
            code=GOOGLE_CONNECTION_NOT_FOUND,
            details={"connection_id": connection_id, "operation": "fetch_headers"}
        )

    url = f"{SHEETS_API_BASE}/{quote(spreadsheet_id)}"
    
    resp = requests.get(
        url,
        headers={"Authorization": f"Bearer {access_token}"},
        params={"fields": "sheets.properties"},
        timeout=15,
    )

    # Retry com force_refresh se receber 401
    if resp.status_code == 401:
        logger.warning("[GOOGLE_SHEETS] Unauthorized when listing worksheets, attempting refresh")
        try:
            # Tentar refresh forçado do token
            access_token = get_google_access_token_for_user(
                user_jwt, user_id, connection_id, force_refresh=True
            )
            if access_token:
                # Retry com token atualizado
                resp = requests.get(
                    url,
                    headers={"Authorization": f"Bearer {access_token}"},
                    params={"fields": "sheets.properties"},
                    timeout=15,
                )
        except Exception as refresh_error:
            logger.warning(f"[GOOGLE_SHEETS] Refresh failed: {refresh_error}")
        
        # Se ainda for 401 após retry, lançar erro
        if resp.status_code == 401:
            logger.warning("[GOOGLE_SHEETS] Unauthorized after refresh when listing worksheets")
            raise GoogleSheetsError(
                "Token do Google inválido ou expirado. Refaça a conexão.",
                code=GOOGLE_TOKEN_EXPIRED,
                details={"http_status": 401, "operation": "list_worksheets"}
            )
    if resp.status_code != 200:
        logger.error(
            "[GOOGLE_SHEETS] Error listing worksheets: %s - %s",
            resp.status_code,
            resp.text,
        )
        raise GoogleSheetsError(
            f"Erro ao listar abas da planilha (status {resp.status_code}).",
            code=GOOGLE_SHEETS_ERROR,
            details={"http_status": resp.status_code, "operation": "list_worksheets"}
        )

    data = resp.json()
    sheets = data.get("sheets") or []
    
    # Formatar resultados
    worksheets = [
        {
            "id": sheet.get("properties", {}).get("sheetId"),
            "title": sheet.get("properties", {}).get("title", "Sem nome"),
            "index": sheet.get("properties", {}).get("index", 0),
            "sheet_type": sheet.get("properties", {}).get("sheetType", "GRID"),
        }
        for sheet in sheets
        if sheet.get("properties", {}).get("sheetType") == "GRID"  # Apenas abas normais, não gráficos
    ]
    
    # Ordenar por índice
    worksheets.sort(key=lambda x: x.get("index", 0))
    
    return worksheets


def get_spreadsheet_name(
    user_jwt: str,
    user_id: str,
    spreadsheet_id: str,
    connection_id: Optional[str] = None,
) -> Optional[str]:
    """
    Busca apenas o nome de uma planilha específica pelo ID.
    Muito mais eficiente que listar todas as planilhas.
    
    Args:
        user_jwt: JWT do Supabase do usuário
        user_id: ID do usuário
        spreadsheet_id: ID da planilha
        connection_id: ID da conexão Google específica (opcional)
    
    Returns:
        Nome da planilha ou None se não encontrada/sem acesso
    """
    access_token = get_google_access_token_for_user(user_jwt, user_id, connection_id)
    if not access_token:
        raise GoogleSheetsError(
            "Conta Google não conectada para este usuário.",
            code=GOOGLE_CONNECTION_NOT_FOUND,
            details={"connection_id": connection_id, "operation": "get_spreadsheet_name"}
        )

    # Usar files.get para buscar apenas o arquivo específico
    url = f"{DRIVE_API_BASE}/files/{quote(spreadsheet_id)}"
    
    resp = requests.get(
        url,
        headers={"Authorization": f"Bearer {access_token}"},
        params={"fields": "name"},
        timeout=15,
    )

    # Retry com force_refresh se receber 401
    if resp.status_code == 401:
        logger.warning("[GOOGLE_DRIVE] Unauthorized when getting spreadsheet name, attempting refresh")
        try:
            # Tentar refresh forçado do token
            access_token = get_google_access_token_for_user(
                user_jwt, user_id, connection_id, force_refresh=True
            )
            if access_token:
                # Retry com token atualizado
                resp = requests.get(
                    url,
                    headers={"Authorization": f"Bearer {access_token}"},
                    params={"fields": "name"},
                    timeout=15,
                )
        except Exception as refresh_error:
            logger.warning(f"[GOOGLE_DRIVE] Refresh failed: {refresh_error}")
        
        # Se ainda for 401 após retry, lançar erro
        if resp.status_code == 401:
            logger.warning("[GOOGLE_DRIVE] Unauthorized after refresh when getting spreadsheet name")
            raise GoogleSheetsError(
                "Token do Google inválido ou expirado. Refaça a conexão.",
                code=GOOGLE_TOKEN_EXPIRED,
                details={"http_status": 401, "operation": "get_spreadsheet_name"}
            )
    
    if resp.status_code == 404:
        # Planilha não encontrada ou sem acesso
        logger.warning(f"[GOOGLE_DRIVE] Spreadsheet {spreadsheet_id} not found or no access")
        return None
    
    if resp.status_code != 200:
        logger.error(
            "[GOOGLE_DRIVE] Error getting spreadsheet name: %s - %s",
            resp.status_code,
            resp.text,
        )
        return None

    data = resp.json()
    return data.get("name")


