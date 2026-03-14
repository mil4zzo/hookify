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
    Excecao interna para erros do Google Sheets.
    Deve ser convertida para HTTPException com codigo estruturado antes de chegar ao frontend.
    """
    def __init__(self, message: str, code: str = GOOGLE_SHEETS_ERROR, details: Optional[Dict[str, Any]] = None):
        super().__init__(message)
        self.message = message
        self.code = code
        self.details = details or {}


def _build_sheet_range(worksheet_title: str, range_suffix: str | None = None) -> str:
    safe_title = worksheet_title.replace("'", "''")
    base = f"'{safe_title}'"
    if range_suffix:
        return f"{base}!{range_suffix}"
    return base


def _get_access_token_or_raise(
    user_jwt: str,
    user_id: str,
    connection_id: Optional[str],
    operation: str,
) -> str:
    """Obtem access token ou levanta GoogleSheetsError."""
    access_token = get_google_access_token_for_user(user_jwt, user_id, connection_id)
    if not access_token:
        error_msg = "Nenhuma conta Google ativa encontrada."
        if connection_id:
            error_msg += " A conexao configurada pode ter sido revogada. Reconecte sua conta Google para continuar."
            logger.error(f"[GOOGLE] Token nao encontrado | user: {user_id} | connection_id: {connection_id}")
        else:
            error_msg += " Por favor, conecte uma conta Google."
            logger.error(f"[GOOGLE] Nenhuma conexao Google | user: {user_id}")
        raise GoogleSheetsError(
            error_msg,
            code=GOOGLE_CONNECTION_NOT_FOUND,
            details={"connection_id": connection_id, "operation": operation, "user_id": user_id},
        )
    return access_token


def _request_with_retry(
    url: str,
    user_jwt: str,
    user_id: str,
    connection_id: Optional[str],
    operation: str,
    params: Optional[Dict[str, Any]] = None,
    timeout: int = 15,
) -> requests.Response:
    """Faz GET na Google API com retry automatico em 401 (force_refresh do token)."""
    access_token = _get_access_token_or_raise(user_jwt, user_id, connection_id, operation)

    resp = requests.get(
        url,
        headers={"Authorization": f"Bearer {access_token}"},
        params=params,
        timeout=timeout,
    )

    if resp.status_code == 401:
        logger.warning("[GOOGLE] Unauthorized for %s, attempting refresh", operation)
        try:
            access_token = get_google_access_token_for_user(
                user_jwt, user_id, connection_id, force_refresh=True
            )
            if access_token:
                resp = requests.get(
                    url,
                    headers={"Authorization": f"Bearer {access_token}"},
                    params=params,
                    timeout=timeout,
                )
        except Exception as refresh_error:
            logger.warning("[GOOGLE] Refresh failed for %s: %s", operation, refresh_error)

        if resp.status_code == 401:
            raise GoogleSheetsError(
                "Token do Google invalido ou expirado. Refaca a conexao.",
                code=GOOGLE_TOKEN_EXPIRED,
                details={"http_status": 401, "operation": operation},
            )

    return resp


def _check_response(resp: requests.Response, operation: str, error_code: str = GOOGLE_SHEETS_ERROR) -> None:
    """Verifica status da resposta e levanta erro se nao for 200."""
    if resp.status_code != 200:
        logger.error("[GOOGLE] Error in %s: %s - %s", operation, resp.status_code, resp.text)
        raise GoogleSheetsError(
            f"Erro ao acessar Google API (status {resp.status_code}).",
            code=error_code,
            details={"http_status": resp.status_code, "operation": operation},
        )


def fetch_headers(
    user_jwt: str,
    user_id: str,
    spreadsheet_id: str,
    worksheet_title: str,
    connection_id: Optional[str] = None,
) -> List[str]:
    """Busca apenas a primeira linha (headers) da aba."""
    value_range = _build_sheet_range(worksheet_title, "1:1")
    url = f"{SHEETS_API_BASE}/{quote(spreadsheet_id)}/values/{quote(value_range)}"

    resp = _request_with_retry(
        url, user_jwt, user_id, connection_id, "fetch_headers",
        params={"majorDimension": "ROWS"},
    )
    _check_response(resp, "fetch_headers")

    data = resp.json()
    values = data.get("values") or []
    if not values:
        return []
    return [str(h) for h in (values[0] or [])]


def _index_to_column_letter(idx: int) -> str:
    """Converte indice 0-based para letra de coluna (A, B, ..., Z, AA, AB, ...)."""
    result = ""
    idx += 1
    while idx > 0:
        idx -= 1
        result = chr(65 + idx % 26) + result
        idx //= 26
    return result


def fetch_columns_with_duplicate_detection(
    user_jwt: str,
    user_id: str,
    spreadsheet_id: str,
    worksheet_title: str,
    connection_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Busca linhas 1-10 em uma unica requisicao: header + amostra.
    Detecta headers duplicados (mesmo nome apos strip).
    Retorna: {columns, duplicates: {name: [indices]}, sampleRows, columnsWithIndices}.
    """
    value_range = _build_sheet_range(worksheet_title, "1:10")
    url = f"{SHEETS_API_BASE}/{quote(spreadsheet_id)}/values/{quote(value_range)}"

    resp = _request_with_retry(
        url, user_jwt, user_id, connection_id, "fetch_columns",
        params={
            "majorDimension": "ROWS",
            "valueRenderOption": "UNFORMATTED_VALUE",
            "dateTimeRenderOption": "FORMATTED_STRING",
        },
    )
    _check_response(resp, "fetch_columns")

    data = resp.json()
    values = data.get("values") or []
    if not values:
        return {"columns": [], "duplicates": {}, "sampleRows": [], "columnsWithIndices": []}

    raw_headers = values[0] or []
    headers = [str(h).strip() for h in raw_headers]
    sample_rows = [[str(c) for c in (row or [])] for row in values[1:]]

    name_to_indices: Dict[str, List[int]] = {}
    for idx, name in enumerate(headers):
        if name:
            if name not in name_to_indices:
                name_to_indices[name] = []
            name_to_indices[name].append(idx)

    duplicates: Dict[str, List[int]] = {
        name: indices for name, indices in name_to_indices.items() if len(indices) > 1
    }

    columns_with_indices = [
        {"name": name, "index": idx, "label": f"{name} (coluna {_index_to_column_letter(idx)})" if name in duplicates else name}
        for idx, name in enumerate(headers)
    ]

    return {
        "columns": headers,
        "duplicates": duplicates,
        "sampleRows": sample_rows,
        "columnsWithIndices": columns_with_indices,
    }


CHUNK_SIZE_ROWS = 5000
MAX_COLUMNS_A1 = "ZZ"


def _fetch_sheet_range(
    user_jwt: str,
    user_id: str,
    connection_id: Optional[str],
    spreadsheet_id: str,
    worksheet_title: str,
    range_suffix: str,
) -> List[List[Any]]:
    """Busca um range especifico da planilha com retry em 401. Qualquer erro propaga (critico)."""
    value_range = _build_sheet_range(worksheet_title, range_suffix)
    url = f"{SHEETS_API_BASE}/{quote(spreadsheet_id)}/values/{quote(value_range)}"
    resp = _request_with_retry(
        url=url,
        user_jwt=user_jwt,
        user_id=user_id,
        connection_id=connection_id,
        operation="fetch_all_rows",
        params={
            "majorDimension": "ROWS",
            "valueRenderOption": "UNFORMATTED_VALUE",
            "dateTimeRenderOption": "FORMATTED_STRING",
        },
        timeout=60,
    )
    _check_response(resp, "fetch_all_rows", error_code=GOOGLE_SHEETS_ERROR)
    data = resp.json()
    return data.get("values") or []


def fetch_all_rows(
    user_jwt: str,
    user_id: str,
    spreadsheet_id: str,
    worksheet_title: str,
    connection_id: Optional[str] = None,
) -> Tuple[List[str], List[List[str]]]:
    """
    Busca toda a aba em chunks: primeira linha e header, demais sao dados.
    Nao corta dados - processa a planilha inteira. Qualquer erro e critico.
    """
    all_rows: List[List[str]] = []
    headers: List[str] = []
    start_row = 1
    chunk_num = 0

    while True:
        chunk_num += 1
        end_row = start_row + CHUNK_SIZE_ROWS
        range_suffix = f"A{start_row}:{MAX_COLUMNS_A1}{end_row}"
        try:
            values = _fetch_sheet_range(
                user_jwt=user_jwt,
                user_id=user_id,
                connection_id=connection_id,
                spreadsheet_id=spreadsheet_id,
                worksheet_title=worksheet_title,
                range_suffix=range_suffix,
            )
        except GoogleSheetsError:
            raise
        except Exception as e:
            logger.exception("[GOOGLE_SHEETS] Erro inesperado ao buscar chunk %s", chunk_num)
            raise GoogleSheetsError(
                f"Erro ao ler planilha do Google: {e}",
                code=GOOGLE_SHEETS_ERROR,
                details={"operation": "fetch_all_rows", "chunk": chunk_num}
            ) from e

        if not values:
            break

        if chunk_num == 1:
            headers = [str(h) for h in (values[0] or [])]
            data_rows = values[1:]
        else:
            data_rows = values

        for row in data_rows:
            all_rows.append([str(c) for c in (row or [])])

        if len(values) < CHUNK_SIZE_ROWS + (1 if chunk_num == 1 else 0):
            break

        start_row = end_row + 1
        if chunk_num > 1 and len(values) < CHUNK_SIZE_ROWS:
            break

    if not headers and not all_rows:
        return [], []

    if not headers:
        raise GoogleSheetsError(
            "Planilha sem header (linha 1 vazia).",
            code=GOOGLE_SHEETS_ERROR,
            details={"operation": "fetch_all_rows"}
        )

    return headers, all_rows


def list_spreadsheets(
    user_jwt: str,
    user_id: str,
    query: Optional[str] = None,
    page_size: int = 20,
    page_token: Optional[str] = None,
    connection_id: Optional[str] = None,
) -> Tuple[List[dict], Optional[str]]:
    """Lista planilhas do Google Drive do usuario, ordenadas por modificacao recente."""
    drive_query = "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false"
    if query and query.strip():
        safe_query = query.strip().replace("'", "\\'")
        drive_query += f" and name contains '{safe_query}'"

    params = {
        "q": drive_query,
        "pageSize": min(page_size, 100),
        "fields": "nextPageToken, files(id, name, modifiedTime, webViewLink)",
        "orderBy": "modifiedTime desc",
    }
    if page_token:
        params["pageToken"] = page_token

    resp = _request_with_retry(
        f"{DRIVE_API_BASE}/files",
        user_jwt, user_id, connection_id, "list_spreadsheets",
        params=params,
    )
    _check_response(resp, "list_spreadsheets", error_code=GOOGLE_DRIVE_ERROR)

    data = resp.json()
    files = data.get("files") or []
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
    """Lista todas as abas (worksheets) de uma planilha do Google Sheets."""
    url = f"{SHEETS_API_BASE}/{quote(spreadsheet_id)}"

    resp = _request_with_retry(
        url, user_jwt, user_id, connection_id, "list_worksheets",
        params={"fields": "sheets.properties"},
    )
    _check_response(resp, "list_worksheets")

    data = resp.json()
    sheets = data.get("sheets") or []
    worksheets = [
        {
            "id": sheet.get("properties", {}).get("sheetId"),
            "title": sheet.get("properties", {}).get("title", "Sem nome"),
            "index": sheet.get("properties", {}).get("index", 0),
            "sheet_type": sheet.get("properties", {}).get("sheetType", "GRID"),
        }
        for sheet in sheets
        if sheet.get("properties", {}).get("sheetType") == "GRID"
    ]
    worksheets.sort(key=lambda x: x.get("index", 0))
    return worksheets


def get_spreadsheet_name(
    user_jwt: str,
    user_id: str,
    spreadsheet_id: str,
    connection_id: Optional[str] = None,
) -> Optional[str]:
    """Busca apenas o nome de uma planilha especifica pelo ID."""
    access_token = _get_access_token_or_raise(user_jwt, user_id, connection_id, "get_spreadsheet_name")
    url = f"{DRIVE_API_BASE}/files/{quote(spreadsheet_id)}"

    # Usar request manual aqui porque 404 e um caso valido (nao e erro)
    resp = requests.get(
        url,
        headers={"Authorization": f"Bearer {access_token}"},
        params={"fields": "name"},
        timeout=15,
    )

    if resp.status_code == 401:
        logger.warning("[GOOGLE_DRIVE] Unauthorized for get_spreadsheet_name, attempting refresh")
        try:
            access_token = get_google_access_token_for_user(
                user_jwt, user_id, connection_id, force_refresh=True
            )
            if access_token:
                resp = requests.get(
                    url,
                    headers={"Authorization": f"Bearer {access_token}"},
                    params={"fields": "name"},
                    timeout=15,
                )
        except Exception as refresh_error:
            logger.warning("[GOOGLE_DRIVE] Refresh failed: %s", refresh_error)

        if resp.status_code == 401:
            raise GoogleSheetsError(
                "Token do Google invalido ou expirado. Refaca a conexao.",
                code=GOOGLE_TOKEN_EXPIRED,
                details={"http_status": 401, "operation": "get_spreadsheet_name"},
            )

    if resp.status_code == 404:
        logger.warning(f"[GOOGLE_DRIVE] Spreadsheet {spreadsheet_id} not found or no access")
        return None

    if resp.status_code != 200:
        logger.error("[GOOGLE_DRIVE] Error getting spreadsheet name: %s - %s", resp.status_code, resp.text)
        return None

    data = resp.json()
    return data.get("name")
