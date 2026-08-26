from __future__ import annotations

import time
import logging
import threading
from typing import Optional, Dict
from app.services.facebook_page_token_service import invalidate_page_token_cache

logger = logging.getLogger(__name__)

# Cache thread-safe com lock para concorrência
_cache_lock = threading.RLock()
_token_cache: Dict[str, tuple[str, float, Optional[float]]] = {}  # {user_id: (token, cache_expiry, token_expiry)}
_failed_users: Dict[str, float] = {}  # {user_id: failure_time} para circuit breaker

# Configurações
CACHE_TTL = 300  # 5 minutos cache padrão
CIRCUIT_BREAKER_TTL = 60  # 1 minuto antes de tentar novamente após falha
PRE_REFRESH_BUFFER = 300  # 5 minutos antes do token expirar, buscar novo

def get_facebook_token_for_silo(owner_id: str, force_refresh: bool = False) -> Optional[str]:
    """Token do Facebook do DONO indicado, com o MESMO cache/circuit breaker.

    Versao service-role de get_facebook_token_for_user, para operacoes de pack
    compartilhado (a credencial e sempre a do dono; o ator pode nem ter Meta).
    O cache e compartilhado por user_id — o token que o proprio dono usa e o
    mesmo objeto que um convidado usa, entao hit de um aquece o outro.

    Autorizacao e responsabilidade do chamador (assert_pack_role ANTES).
    """
    owner_id = str(owner_id or "")
    if not owner_id:
        return None

    with _cache_lock:
        if owner_id in _failed_users:
            if time.time() - _failed_users[owner_id] < CIRCUIT_BREAKER_TTL:
                return None
            _failed_users.pop(owner_id, None)

        if not force_refresh and owner_id in _token_cache:
            token, cache_expiry, _token_expiry = _token_cache[owner_id]
            if time.time() < cache_expiry:
                return token
            _token_cache.pop(owner_id, None)

    try:
        from app.services.facebook_connections_repo import get_primary_facebook_token_for_silo

        fb_token, token_expires_at = get_primary_facebook_token_for_silo(owner_id)
        if not fb_token:
            with _cache_lock:
                _failed_users[owner_id] = time.time()
            logger.warning(f"[FB_TOKEN] No Facebook token found for silo {owner_id[:8]}...")
            return None

        now = time.time()
        cache_ttl = max(CACHE_TTL, token_expires_at - now - PRE_REFRESH_BUFFER) if token_expires_at else CACHE_TTL
        with _cache_lock:
            _token_cache[owner_id] = (fb_token, now + cache_ttl, token_expires_at)
            _failed_users.pop(owner_id, None)
        return fb_token
    except Exception as e:
        with _cache_lock:
            _failed_users[owner_id] = time.time()
        logger.error(f"[FB_TOKEN] Error fetching token for silo {owner_id[:8]}...: {e}")
        raise TokenFetchError(f"Failed to fetch Facebook token for silo: {e}") from e


class TokenFetchError(Exception):
    """Erro ao buscar token do Facebook"""
    pass

def get_facebook_token_for_user(
    user_jwt: str, 
    user_id: str, 
    force_refresh: bool = False
) -> Optional[str]:
    """
    Busca o token do Facebook para o usuário com cache inteligente.
    
    Features:
    - Cache em memória thread-safe
    - TTL baseado em expires_at do token (quando disponível)
    - Circuit breaker para evitar cascata de erros
    - Pre-refresh antes de expirar
    - Retry automático após falha temporária
    
    Args:
        user_jwt: JWT do Supabase do usuário
        user_id: ID do usuário
        force_refresh: Se True, ignora cache
    
    Returns:
        Token do Facebook descriptografado ou None se não encontrado
    """
    with _cache_lock:
        # Circuit breaker: se falhou recentemente, evitar requisições repetidas
        if user_id in _failed_users:
            failure_time = _failed_users[user_id]
            if time.time() - failure_time < CIRCUIT_BREAKER_TTL:
                logger.debug(f"[FB_TOKEN] Circuit breaker active for user {user_id[:8]}...")
                return None
            # Passou o TTL, remover do circuit breaker
            _failed_users.pop(user_id, None)
        
        # Verificar cache
        if not force_refresh and user_id in _token_cache:
            token, cache_expiry, token_expiry = _token_cache[user_id]
            now = time.time()
            
            # Cache ainda válido?
            if now < cache_expiry:
                # Se temos token_expiry e está próximo de expirar, marcar para refresh
                if token_expiry and now > (token_expiry - PRE_REFRESH_BUFFER):
                    logger.debug(f"[FB_TOKEN] Token expiring soon for {user_id[:8]}..., will refresh on next request")
                    # Mas ainda retornar o token atual (não é crítico)
                
                logger.debug(f"[FB_TOKEN] Cache hit for user {user_id[:8]}...")
                return token
            
            # Cache expirado, remover
            _token_cache.pop(user_id, None)
    
    # Buscar do banco de dados (fora do lock para não bloquear outras threads)
    try:
        from app.services.facebook_connections_repo import get_primary_facebook_token
        
        fb_token, token_expires_at = get_primary_facebook_token(user_jwt, user_id)
        
        if not fb_token:
            with _cache_lock:
                _failed_users[user_id] = time.time()
            logger.warning(f"[FB_TOKEN] No Facebook token found for user {user_id[:8]}...")
            return None
        
        # Calcular TTL do cache baseado no expires_at do token se disponível
        now = time.time()
        if token_expires_at:
            # Cache até 5 min antes do token expirar, ou 5 min mínimo
            cache_ttl = max(CACHE_TTL, token_expires_at - now - PRE_REFRESH_BUFFER)
        else:
            cache_ttl = CACHE_TTL
        
        # Armazenar no cache (com lock)
        with _cache_lock:
            _token_cache[user_id] = (fb_token, now + cache_ttl, token_expires_at)
            # Remover do circuit breaker se estava lá
            _failed_users.pop(user_id, None)
        
        logger.info(f"[FB_TOKEN] Token cached for user {user_id[:8]}... (TTL: {int(cache_ttl)}s)")
        return fb_token
        
    except Exception as e:
        # Em caso de erro (ex: banco indisponível), ativar circuit breaker
        with _cache_lock:
            _failed_users[user_id] = time.time()
        logger.error(f"[FB_TOKEN] Error fetching token for user {user_id[:8]}...: {e}")
        raise TokenFetchError(f"Failed to fetch Facebook token: {e}") from e

def invalidate_token_cache(user_id: str) -> None:
    """Invalidar cache quando token é atualizado/expirado."""
    with _cache_lock:
        _token_cache.pop(user_id, None)
        _failed_users.pop(user_id, None)
    # Invalidação em cascata: Page Access Tokens dependem do user access_token.
    invalidate_page_token_cache(user_id)
    logger.debug(f"[FB_TOKEN] Cache invalidated for user {user_id[:8]}...")

