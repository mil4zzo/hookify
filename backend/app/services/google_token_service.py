from __future__ import annotations

import logging
import time
from typing import Optional

import requests

from app.core.config import (
    GOOGLE_OAUTH_CLIENT_ID,
    GOOGLE_OAUTH_CLIENT_SECRET,
    GOOGLE_OAUTH_TOKEN_URL,
)
from app.services.google_accounts_repo import (
    get_google_account_tokens,
    upsert_google_account,
)

logger = logging.getLogger(__name__)

# Margem para tentar refresh antes do vencimento real
PRE_REFRESH_BUFFER = 300  # 5 minutos


def get_google_access_token_for_user(
    user_jwt: str,
    user_id: str,
    connection_id: Optional[str] = None,
    force_refresh: bool = False,
) -> Optional[str]:
    """
    Retorna access_token válido do Google para o usuário.
    Tenta refresh com refresh_token se estiver próximo de expirar.
    
    Args:
        user_jwt: JWT do Supabase do usuário
        user_id: ID do usuário
        connection_id: ID da conexão Google específica (opcional). Se não fornecido, usa a primeira conexão encontrada.
        force_refresh: Se True, força refresh do token mesmo que ainda não esteja próximo de expirar
    
    Raises:
        GoogleSheetsError: Se o refresh_token estiver inválido/expirado
    """
    access_token, refresh_token, expires_ts = get_google_account_tokens(
        user_jwt=user_jwt,
        user_id=user_id,
        connection_id=connection_id,
    )

    if not access_token:
        return None

    now = time.time()
    should_refresh = False

    if force_refresh:
        should_refresh = True
    elif expires_ts is not None and (expires_ts - now) < PRE_REFRESH_BUFFER:
        should_refresh = True

    if should_refresh and refresh_token and GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET:
        try:
            data = {
                "client_id": GOOGLE_OAUTH_CLIENT_ID,
                "client_secret": GOOGLE_OAUTH_CLIENT_SECRET,
                "refresh_token": refresh_token,
                "grant_type": "refresh_token",
            }
            resp = requests.post(GOOGLE_OAUTH_TOKEN_URL, data=data, timeout=15)
            if resp.status_code == 200:
                token_data = resp.json()
                new_access = token_data.get("access_token")
                expires_in = token_data.get("expires_in")

                if new_access:
                    from datetime import datetime, timezone, timedelta

                    expires_at_str = None
                    if isinstance(expires_in, (int, float)) and expires_in > 0:
                        expires_at = datetime.now(timezone.utc) + timedelta(
                            seconds=int(expires_in)
                        )
                        expires_at_str = expires_at.isoformat()

                    # Preservar connection_id ao fazer refresh
                    # Buscar dados da conexão atual para preservar google_user_id, google_email, etc.
                    from app.core.supabase_client import get_supabase_for_user
                    sb = get_supabase_for_user(user_jwt)
                    account_query = sb.table("google_accounts").select("google_user_id,google_email,google_name,scopes").eq("user_id", user_id)
                    if connection_id:
                        account_query = account_query.eq("id", connection_id)
                    account_res = account_query.limit(1).execute()
                    
                    account_data = account_res.data[0] if account_res.data else {}
                    
                    upsert_google_account(
                        user_jwt=user_jwt,
                        user_id=user_id,
                        access_token=new_access,
                        refresh_token=refresh_token,
                        expires_at=expires_at_str,
                        scopes=account_data.get("scopes"),
                        google_user_id=account_data.get("google_user_id"),
                        google_email=account_data.get("google_email"),
                        google_name=account_data.get("google_name"),
                    )
                    logger.info(
                        "[GOOGLE_TOKEN] Access token refreshed for user %s", user_id
                    )
                    return new_access
                else:
                    logger.warning(
                        "[GOOGLE_TOKEN] Refresh response without access_token: %s",
                        token_data,
                    )
            else:
                # Detectar erro de token inválido/expirado
                try:
                    error_data = resp.json() if resp.content else {}
                    error_code = error_data.get("error", "")
                    error_description = error_data.get("error_description", "")
                    
                    if resp.status_code == 400 and error_code == "invalid_grant":
                        logger.warning(
                            "[GOOGLE_TOKEN] Refresh token invalid/expired for user %s: %s",
                            user_id,
                            error_description,
                        )
                        # Importar aqui para evitar circular dependency
                        from app.services.google_sheets_service import GoogleSheetsError
                        raise GoogleSheetsError(
                            "Token do Google expirado ou revogado. Por favor, reconecte sua conta Google."
                        )
                except (ValueError, KeyError):
                    # Se não conseguir parsear JSON, continuar com log normal
                    pass
                
                logger.error(
                    "[GOOGLE_TOKEN] Error refreshing token: %s - %s",
                    resp.status_code,
                    resp.text,
                )
        except requests.RequestException as e:
            logger.error("[GOOGLE_TOKEN] Network error refreshing token: %s", e)

    # Se não precisou/ conseguiu refrescar, usa o token atual
    return access_token


