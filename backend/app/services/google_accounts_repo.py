from __future__ import annotations

import logging
from typing import Any, Dict, Optional, Tuple, List

from app.core.supabase_client import get_supabase_for_user
from app.services.token_encryption import encrypt_token, decrypt_token

logger = logging.getLogger(__name__)


def upsert_google_account(
    user_jwt: str,
    user_id: str,
    access_token: str,
    refresh_token: Optional[str] = None,
    expires_at: Optional[str] = None,
    scopes: Optional[List[str]] = None,
    google_user_id: Optional[str] = None,
    google_email: Optional[str] = None,
    google_name: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Salva/atualiza credenciais do Google para o usuário na tabela google_accounts.
    Tokens são armazenados criptografados.
    Se google_user_id for fornecido, atualiza a conexão existente com esse ID.
    Caso contrário, cria uma nova conexão.
    """
    sb = get_supabase_for_user(user_jwt)

    payload: Dict[str, Any] = {
        "user_id": user_id,
        "access_token": encrypt_token(access_token),
    }
    if refresh_token is not None:
        payload["refresh_token"] = encrypt_token(refresh_token)
    if expires_at is not None:
        payload["expires_at"] = expires_at
    if scopes is not None:
        payload["scopes"] = scopes
    if google_user_id is not None:
        payload["google_user_id"] = google_user_id
    if google_email is not None:
        payload["google_email"] = google_email
    if google_name is not None:
        payload["google_name"] = google_name

    # Estratégia de upsert para evitar criar múltiplas contas:
    # 1. Se temos google_user_id, buscar por (user_id, google_user_id) - mais confiável
    # 2. Se não temos google_user_id mas temos google_email, buscar por (user_id, google_email)
    # 3. Se não temos identificadores, buscar todas as conexões do usuário e pegar a mais recente
    # 4. Se encontrar, atualizar; senão, criar nova
    
    existing = None
    
    if google_user_id:
        # Buscar por google_user_id (mais confiável)
        existing = (
            sb.table("google_accounts")
            .select("*")
            .eq("user_id", user_id)
            .eq("google_user_id", google_user_id)
            .limit(1)
            .execute()
        )
    elif google_email:
        # Se não temos google_user_id mas temos email, buscar por email
        existing = (
            sb.table("google_accounts")
            .select("*")
            .eq("user_id", user_id)
            .eq("google_email", google_email)
            .limit(1)
            .execute()
        )
    else:
        # Se não temos identificadores, buscar todas as conexões do usuário
        # e pegar a mais recente sem google_user_id (para evitar criar múltiplas)
        all_accounts = (
            sb.table("google_accounts")
            .select("*")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .execute()
        )
        
        if all_accounts.data:
            # Filtrar em Python para pegar a primeira sem google_user_id
            for account in all_accounts.data:
                if not account.get("google_user_id"):
                    # Criar objeto similar à resposta do Supabase
                    class MockResponse:
                        def __init__(self, data):
                            self.data = data
                    existing = MockResponse([account])
                    break
    
    if existing and existing.data:
        # Atualizar conexão existente
        existing_id = existing.data[0]["id"]
        sb.table("google_accounts").update(payload).eq("id", existing_id).execute()
        res = (
            sb.table("google_accounts")
            .select("*")
            .eq("id", existing_id)
            .limit(1)
            .execute()
        )
        return (res.data or [{}])[0]

    # Criar nova conexão apenas se não encontrou nenhuma existente
    sb.table("google_accounts").insert(payload).execute()
    
    # Buscar a conexão recém-criada
    if google_user_id:
        res = (
            sb.table("google_accounts")
            .select("*")
            .eq("user_id", user_id)
            .eq("google_user_id", google_user_id)
            .limit(1)
            .execute()
        )
    elif google_email:
        res = (
            sb.table("google_accounts")
            .select("*")
            .eq("user_id", user_id)
            .eq("google_email", google_email)
            .limit(1)
            .execute()
        )
    else:
        res = (
            sb.table("google_accounts")
            .select("*")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
    
    return (res.data or [{}])[0]


def list_google_accounts(
    user_jwt: str,
    user_id: str,
) -> List[Dict[str, Any]]:
    """
    Lista todas as conexões Google do usuário.
    """
    sb = get_supabase_for_user(user_jwt)
    res = (
        sb.table("google_accounts")
        .select("id, google_user_id, google_email, google_name, scopes, created_at, updated_at")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .execute()
    )
    return res.data or []


def delete_google_account(
    user_jwt: str,
    user_id: str,
    account_id: str,
) -> bool:
    """
    Deleta uma conexão Google específica do usuário.
    """
    sb = get_supabase_for_user(user_jwt)
    res = (
        sb.table("google_accounts")
        .delete()
        .eq("id", account_id)
        .eq("user_id", user_id)
        .execute()
    )
    return len(res.data or []) > 0


def get_google_account_tokens(
    user_jwt: str,
    user_id: str,
    connection_id: Optional[str] = None,
) -> Tuple[Optional[str], Optional[str], Optional[float]]:
    """
    Busca tokens do Google para o usuário e descriptografa.
    
    Args:
        user_jwt: JWT do Supabase do usuário
        user_id: ID do usuário
        connection_id: ID da conexão Google específica (opcional). Se não fornecido, retorna a primeira conexão encontrada.

    Returns:
        (access_token, refresh_token, expires_at_timestamp) — qualquer um pode ser None.
    """
    sb = get_supabase_for_user(user_jwt)
    query = (
        sb.table("google_accounts")
        .select("access_token,refresh_token,expires_at")
        .eq("user_id", user_id)
    )
    
    # Se connection_id foi fornecido, filtrar por ele; senão, pegar a primeira (comportamento legado)
    if connection_id:
        query = query.eq("id", connection_id)
    
    res = query.limit(1).execute()
    
    if not res.data:
        return None, None, None

    row = res.data[0]
    enc_access = row.get("access_token")
    enc_refresh = row.get("refresh_token")
    expires_at_str = row.get("expires_at")

    if not enc_access:
        return None, None, None

    access_token = decrypt_token(enc_access)
    refresh_token = decrypt_token(enc_refresh) if enc_refresh else None

    expires_ts: Optional[float] = None
    if expires_at_str:
        try:
            # aceita ISO8601 ou epoch numérico
            from datetime import datetime

            if isinstance(expires_at_str, str):
                dt = datetime.fromisoformat(expires_at_str.replace("Z", "+00:00"))
                expires_ts = dt.timestamp()
            elif isinstance(expires_at_str, (int, float)):
                expires_ts = float(expires_at_str)
        except Exception as e:
            logger.warning(f"Could not parse expires_at for google account: {e}")

    return access_token, refresh_token, expires_ts


