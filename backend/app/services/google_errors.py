"""
Helper para erros estruturados do Google Sheets/Drive.
Padroniza respostas de erro com código, mensagem e detalhes.
"""
from fastapi import HTTPException
from typing import Optional, Dict, Any


# Códigos de erro padronizados
GOOGLE_TOKEN_EXPIRED = "GOOGLE_TOKEN_EXPIRED"
GOOGLE_TOKEN_INVALID = "GOOGLE_TOKEN_INVALID"
GOOGLE_CONNECTION_NOT_FOUND = "GOOGLE_CONNECTION_NOT_FOUND"
GOOGLE_SHEETS_ERROR = "GOOGLE_SHEETS_ERROR"
GOOGLE_DRIVE_ERROR = "GOOGLE_DRIVE_ERROR"
GOOGLE_AUTH_ERROR = "GOOGLE_AUTH_ERROR"


def raise_google_http_error(
    code: str,
    message: str,
    status_code: int = 400,
    details: Optional[Dict[str, Any]] = None,
) -> HTTPException:
    """
    Lança HTTPException com erro estruturado do Google.
    
    Args:
        code: Código do erro (ex: "GOOGLE_TOKEN_EXPIRED")
        message: Mensagem legível para o usuário
        status_code: Status HTTP (padrão 400)
        details: Detalhes adicionais opcionais
    
    Returns:
        HTTPException (nunca retorna, sempre lança)
    """
    error_detail: Dict[str, Any] = {
        "code": code,
        "message": message,
    }
    if details:
        error_detail["details"] = details
    
    raise HTTPException(status_code=status_code, detail=error_detail)


def is_token_error(error_message: str) -> bool:
    """
    Verifica se uma mensagem de erro indica problema de token.
    Mantido para compatibilidade durante transição.
    """
    error_lower = error_message.lower()
    return any(
        keyword in error_lower
        for keyword in ["expirado", "revogado", "inválido", "reconecte", "unauthorized", "invalid_grant"]
    )

