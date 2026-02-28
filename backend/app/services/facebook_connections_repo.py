from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Tuple
from datetime import datetime, timezone
from app.core.supabase_client import get_supabase_for_user
from app.services.token_encryption import encrypt_token, decrypt_token
from app.services.thumbnail_cache import build_public_storage_url, DEFAULT_BUCKET

logger = logging.getLogger(__name__)


def _fetch_all_paginated(sb, table_name: str, select_fields: str, filters_func, max_per_page: int = 1000) -> List[Dict[str, Any]]:
    """Busca todos os registros de uma tabela usando paginação para contornar limite de 1000 linhas do Supabase.
    
    Args:
        sb: Cliente Supabase
        table_name: Nome da tabela
        select_fields: Campos a selecionar (ex: "id, pack_ids")
        filters_func: Função que recebe um query builder e retorna o query com filtros aplicados
        max_per_page: Máximo de registros por página (padrão 1000, limite do Supabase)
    
    Returns:
        Lista com todos os registros encontrados
    """
    all_rows = []
    page_size = max_per_page
    offset = 0
    
    while True:
        q = sb.table(table_name).select(select_fields)
        q = filters_func(q)
        q = q.range(offset, offset + page_size - 1)
        
        result = q.execute()
        page_data = result.data or []
        
        if not page_data:
            break
        
        all_rows.extend(page_data)
        
        # Se retornou menos que page_size, chegamos ao fim
        if len(page_data) < page_size:
            break
        
        offset += page_size
    
    return all_rows


def list_connections(user_jwt: str) -> List[Dict[str, Any]]:
    sb = get_supabase_for_user(user_jwt)
    # Return connection metadata only (omit tokens)
    cols = [
        "id",
        "user_id",
        "facebook_user_id",
        "facebook_name",
        "facebook_email",
        "facebook_picture_url",
        "picture_storage_path",
        "picture_cached_at",
        "picture_source_url",
        "expires_at",
        "scopes",
        "is_primary",
        "status",
        "created_at",
        "updated_at",
    ]

    # Usar paginação para contornar limite de 1000 linhas (baixo risco, mas melhor prevenir)
    def filters(q):
        return q.order("created_at", desc=True)

    rows = _fetch_all_paginated(sb, "facebook_connections", ",".join(cols), filters)
    # Preferir URL do Storage quando houver cache (evita URL do Meta que expira)
    for row in rows:
        path = (row.get("picture_storage_path") or "").strip()
        if path:
            url = build_public_storage_url(DEFAULT_BUCKET, path)
            if url:
                row["facebook_picture_url"] = url
    return rows


def upsert_connection(
    user_jwt: str,
    user_id: str,
    facebook_user_id: str,
    access_token: str,
    facebook_name: Optional[str] = None,
    facebook_email: Optional[str] = None,
    facebook_picture_url: Optional[str] = None,
    expires_at: Optional[str] = None,
    scopes: Optional[List[str]] = None,
    is_primary: Optional[bool] = None,
    status: str = "active",
    picture_storage_path: Optional[str] = None,
    picture_cached_at: Optional[str] = None,
    picture_source_url: Optional[str] = None,
) -> Dict[str, Any]:
    sb = get_supabase_for_user(user_jwt)
    payload: Dict[str, Any] = {
        "user_id": user_id,
        "facebook_user_id": facebook_user_id,
        "access_token": encrypt_token(access_token),
        "status": status,  # Sempre setar status ao criar/atualizar conexão
    }
    if facebook_name is not None:
        payload["facebook_name"] = facebook_name
    if facebook_email is not None:
        payload["facebook_email"] = facebook_email
    if facebook_picture_url is not None:
        payload["facebook_picture_url"] = facebook_picture_url
    if expires_at is not None:
        payload["expires_at"] = expires_at
    if scopes is not None:
        payload["scopes"] = scopes
    if is_primary is not None:
        payload["is_primary"] = is_primary
    if picture_storage_path is not None:
        payload["picture_storage_path"] = picture_storage_path
    if picture_cached_at is not None:
        payload["picture_cached_at"] = picture_cached_at
    if picture_source_url is not None:
        payload["picture_source_url"] = picture_source_url

    # Upsert sem select (execute diretamente)
    sb.table("facebook_connections").upsert(payload, on_conflict="user_id,facebook_user_id").execute()
    
    # Buscar o registro inserido/atualizado (deve ser único, então limit(1) é seguro)
    res = sb.table("facebook_connections").select("*").eq("user_id", user_id).eq("facebook_user_id", facebook_user_id).limit(1).execute()
    return (res.data or [{}])[0]


def delete_connection(user_jwt: str, connection_id: str) -> None:
    sb = get_supabase_for_user(user_jwt)
    sb.table("facebook_connections").delete().eq("id", connection_id).execute()


def set_primary(user_jwt: str, connection_id: str, user_id: str) -> None:
    """Define uma conexão como primária, desmarcando todas as outras do mesmo usuário.
    
    Args:
        user_jwt: JWT do Supabase do usuário
        connection_id: ID da conexão a ser definida como primária
        user_id: ID do usuário (para garantir que apenas conexões do usuário sejam atualizadas)
    """
    sb = get_supabase_for_user(user_jwt)
    # Set all to false for this user, then set desired id to true
    # Filtrar por user_id para garantir segurança e evitar problemas com limite de 1000 linhas
    sb.table("facebook_connections").update({"is_primary": False}).eq("user_id", user_id).execute()
    sb.table("facebook_connections").update({"is_primary": True}).eq("id", connection_id).eq("user_id", user_id).execute()


def get_primary_facebook_token(
    user_jwt: str, 
    user_id: str
) -> Tuple[Optional[str], Optional[float]]:
    """
    Busca o token do Facebook primário para o usuário e descriptografa.
    Filtra apenas conexões com status 'active'.
    
    Returns:
        Tupla (token_descriptografado, expires_at_timestamp) ou (None, None)
        expires_at_timestamp é epoch timestamp (float) ou None se não disponível
    """
    token, expires_at, _ = get_primary_facebook_token_with_status(user_jwt, user_id)
    return token, expires_at


def update_connection_status(
    user_jwt: str,
    user_id: str,
    facebook_user_id: str,
    status: str,
) -> None:
    """
    Atualiza o status de uma conexão do Facebook.
    
    Args:
        user_jwt: JWT do Supabase do usuário
        user_id: ID do usuário
        facebook_user_id: ID do usuário no Facebook
        status: Status a definir ('active', 'expired', 'invalid')
    """
    sb = get_supabase_for_user(user_jwt)
    sb.table("facebook_connections")\
        .update({"status": status})\
        .eq("user_id", user_id)\
        .eq("facebook_user_id", facebook_user_id)\
        .execute()
    logger.info(f"Updated connection status to '{status}' for user {user_id[:8]}... facebook_user_id {facebook_user_id[:8]}...")


def get_primary_facebook_token_with_status(
    user_jwt: str, 
    user_id: str
) -> Tuple[Optional[str], Optional[float], Optional[str]]:
    """
    Busca o token do Facebook primário para o usuário, descriptografa e retorna status.
    
    Returns:
        Tupla (token_descriptografado, expires_at_timestamp, status) ou (None, None, None)
        Filtra apenas conexões com status 'active'
    """
    sb = get_supabase_for_user(user_jwt)
    
    # Buscar conexão primária APENAS se status for 'active'
    res = sb.table("facebook_connections")\
        .select("access_token,is_primary,expires_at,status")\
        .eq("user_id", user_id)\
        .eq("status", "active")\
        .order("is_primary", desc=True)\
        .order("created_at", desc=True)\
        .limit(1)\
        .execute()
    
    if not res.data or len(res.data) == 0:
        return None, None, None
    
    connection = res.data[0]
    encrypted_token = connection.get("access_token")
    status = connection.get("status", "active")
    
    if not encrypted_token:
        return None, None, status
    
    # Converter expires_at para timestamp se disponível
    expires_at = None
    expires_at_str = connection.get("expires_at")
    if expires_at_str:
        try:
            if isinstance(expires_at_str, str):
                dt = datetime.fromisoformat(expires_at_str.replace('Z', '+00:00'))
                expires_at = dt.timestamp()
            elif isinstance(expires_at_str, (int, float)):
                expires_at = float(expires_at_str)
        except (ValueError, AttributeError) as e:
            logger.warning(f"Could not parse expires_at: {expires_at_str}, error: {e}")
    
    token = decrypt_token(encrypted_token)
    return token, expires_at, status


def get_facebook_token_for_connection(
    user_jwt: str,
    user_id: str,
    connection_id: Optional[str] = None,
) -> Tuple[Optional[str], Optional[float], Optional[str]]:
    """
    Busca o token de uma conexão Facebook específica ou primária, descriptografa e retorna status.
    
    Args:
        user_jwt: JWT do Supabase do usuário
        user_id: ID do usuário
        connection_id: ID da conexão específica (opcional). Se não fornecido, retorna a primária.
    
    Returns:
        Tupla (token_descriptografado, expires_at_timestamp, status) ou (None, None, None)
        Filtra apenas conexões com status 'active'
    """
    sb = get_supabase_for_user(user_jwt)
    
    query = (
        sb.table("facebook_connections")
        .select("access_token,is_primary,expires_at,status")
        .eq("user_id", user_id)
        .eq("status", "active")
    )
    
    # Se connection_id foi fornecido, filtrar por ele; senão, pegar a primária (comportamento legado)
    if connection_id:
        query = query.eq("id", connection_id)
    else:
        query = query.order("is_primary", desc=True).order("created_at", desc=True)
    
    res = query.limit(1).execute()
    
    if not res.data or len(res.data) == 0:
        return None, None, None
    
    connection = res.data[0]
    encrypted_token = connection.get("access_token")
    status = connection.get("status", "active")
    
    if not encrypted_token:
        return None, None, status
    
    # Converter expires_at para timestamp se disponível
    expires_at = None
    expires_at_str = connection.get("expires_at")
    if expires_at_str:
        try:
            if isinstance(expires_at_str, str):
                dt = datetime.fromisoformat(expires_at_str.replace('Z', '+00:00'))
                expires_at = dt.timestamp()
            elif isinstance(expires_at_str, (int, float)):
                expires_at = float(expires_at_str)
        except (ValueError, AttributeError) as e:
            logger.warning(f"Could not parse expires_at: {expires_at_str}, error: {e}")
    
    token = decrypt_token(encrypted_token)
    return token, expires_at, status


