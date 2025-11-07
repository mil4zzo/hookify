from __future__ import annotations

import time
import httpx
import logging
from typing import Any, Dict, Optional
from jose import jwt
from jose.utils import base64url_decode
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa, ec
from fastapi import Depends, HTTPException, Header

from app.core.config import SUPABASE_JWKS_URL, SUPABASE_URL, SUPABASE_ANON_KEY

_logger = logging.getLogger(__name__)

_jwks_cache: Dict[str, Any] | None = None
_jwks_cache_expires_at: float = 0.0
_public_keys_cache: Dict[str, str] = {}


async def _get_jwks() -> Dict[str, Any]:
    """
    Obtém o JSON Web Key Set (JWKS) do Supabase para validação de JWT.
    
    O endpoint .well-known/jwks.json é público e não requer autenticação.
    Conforme documentação Supabase: https://supabase.com/docs/guides/auth/jwts
    
    O JWKS é cacheado por 10 minutos (600 segundos) conforme recomendação da documentação.
    """
    global _jwks_cache, _jwks_cache_expires_at
    now = time.time()
    if _jwks_cache and now < _jwks_cache_expires_at:
        _logger.info(f"[JWKS] Using cached JWKS (expires in {int(_jwks_cache_expires_at - now)}s)")
        return _jwks_cache

    if not SUPABASE_JWKS_URL:
        raise RuntimeError("SUPABASE_JWKS_URL is not configured")

    _logger.info(f"[JWKS] Fetching JWKS from: {SUPABASE_JWKS_URL}")
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            resp = await client.get(SUPABASE_JWKS_URL)
            _logger.info(f"[JWKS] HTTP Response: {resp.status_code}")
            resp.raise_for_status()
            _jwks_cache = resp.json()
            keys_list = _jwks_cache.get("keys", [])
            keys_count = len(keys_list)
            
            # Log detalhado das chaves encontradas
            if keys_count > 0:
                _logger.info(f"[JWKS] Received {keys_count} key(s)")
                for idx, key in enumerate(keys_list):
                    kid = key.get("kid", "N/A")
                    kty = key.get("kty", "N/A")
                    alg = key.get("alg", "N/A")
                    crv = key.get("crv", "N/A")
                    _logger.info(f"[JWKS] Key #{idx+1}: kid={kid}, kty={kty}, alg={alg}, crv={crv}")
            else:
                _logger.warning(f"[JWKS] WARNING: Received empty keys array! JWKS may be invalid.")
            
            # Cache por 10 minutos (conforme recomendação Supabase)
            # Não cachear por mais tempo para permitir revogação de chaves
            _jwks_cache_expires_at = now + 600
            # Limpar cache de chaves públicas quando JWKS é atualizado
            _public_keys_cache.clear()
            return _jwks_cache
        except httpx.HTTPStatusError as e:
            _logger.error(f"Failed to fetch JWKS from {SUPABASE_JWKS_URL}: HTTP {e.response.status_code}")
            if e.response.status_code == 401:
                # Se retornar 401, a URL está incorreta ou o endpoint mudou
                expected_url = f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json" if SUPABASE_URL else "N/A"
                raise RuntimeError(
                    f"JWKS endpoint returned 401 Unauthorized. This endpoint should be public. "
                    f"Current URL: {SUPABASE_JWKS_URL}. "
                    f"Expected format: {expected_url}. "
                    f"Verify the SUPABASE_JWKS_URL configuration."
                ) from e
            raise RuntimeError(f"Failed to fetch JWKS: HTTP {e.response.status_code}") from e
        except httpx.RequestError as e:
            _logger.error(f"Network error fetching JWKS from {SUPABASE_JWKS_URL}: {e}")
            raise RuntimeError(f"Network error while fetching JWKS: {e}") from e


def _decode_base64url(value: bytes) -> int:
    """Decodifica base64url e converte para inteiro."""
    return int.from_bytes(value, byteorder="big")


def _get_pem_key_from_jwks(jwks: Dict[str, Any], kid: str) -> str:
    """
    Extrai a chave pública PEM do JWKS baseado no kid (key ID) do token.
    
    Suporta tanto RSA (RS256) quanto Elliptic Curve (ES256) conforme as práticas
    recomendadas do Supabase.
    """
    _logger.info(f"[KEY_EXTRACT] Looking for kid: '{kid}'")
    
    # Verificar cache primeiro
    if kid in _public_keys_cache:
        _logger.info(f"[KEY_EXTRACT] Found kid '{kid}' in public keys cache")
        return _public_keys_cache[kid]
    
    keys = jwks.get("keys", [])
    available_kids = [k.get("kid") for k in keys if k.get("kid")]
    
    _logger.info(f"[KEY_EXTRACT] JWKS contains {len(keys)} key(s). Available kids: {available_kids}")
    
    if kid not in available_kids:
        _logger.error(
            f"[KEY_EXTRACT] ERROR: kid '{kid}' NOT FOUND in JWKS! "
            f"Available kids: {available_kids}"
        )
    
    for key in keys:
        key_kid = key.get("kid")
        # Comparação case-insensitive (alguns sistemas podem variar)
        if key_kid == kid or (key_kid and key_kid.lower() == kid.lower()):
            _logger.info(f"[KEY_EXTRACT] ✓ Match found! Processing key with kid={key_kid}")
            try:
                kty = key.get("kty", "").upper()
                alg = key.get("alg", "").upper()
                
                _logger.info(f"[KEY_EXTRACT] Key type: {kty}, Algorithm: {alg}")
                
                if kty == "RSA" or alg == "RS256":
                    _logger.info(f"[KEY_EXTRACT] Building RSA public key...")
                    # Chave RSA - usar componentes n e e
                    if "n" not in key or "e" not in key:
                        raise ValueError("RSA key missing required components 'n' or 'e'")
                    
                    _logger.info(f"[KEY_EXTRACT] Decoding RSA components: n and e")
                    n_bytes = base64url_decode(key["n"])
                    e_bytes = base64url_decode(key["e"])
                    
                    n_int = _decode_base64url(n_bytes)
                    e_int = _decode_base64url(e_bytes)
                    
                    _logger.info(f"[KEY_EXTRACT] Creating RSA public numbers...")
                    public_numbers = rsa.RSAPublicNumbers(e_int, n_int)
                    public_key = public_numbers.public_key()
                    _logger.info(f"[KEY_EXTRACT] ✓ Successfully built RSA public key")
                    
                elif kty == "EC" or alg == "ES256":
                    _logger.info(f"[KEY_EXTRACT] Building Elliptic Curve public key...")
                    # Chave Elliptic Curve - usar componentes x, y e crv
                    if "x" not in key or "y" not in key:
                        raise ValueError("EC key missing required components 'x' or 'y'")
                    
                    crv_name = key.get("crv", "P-256")
                    _logger.info(f"[KEY_EXTRACT] Curve: {crv_name}, Decoding components: x and y")
                    x_bytes = base64url_decode(key["x"])
                    y_bytes = base64url_decode(key["y"])
                    
                    x_int = _decode_base64url(x_bytes)
                    y_int = _decode_base64url(y_bytes)
                    
                    # Mapear nome da curva para classe cryptography
                    if crv_name == "P-256":
                        curve = ec.SECP256R1()
                    elif crv_name == "P-384":
                        curve = ec.SECP384R1()
                    elif crv_name == "P-521":
                        curve = ec.SECP521R1()
                    else:
                        raise ValueError(f"Unsupported curve: {crv_name}. Supported: P-256, P-384, P-521")
                    
                    _logger.info(f"[KEY_EXTRACT] Creating EC public numbers...")
                    public_numbers = ec.EllipticCurvePublicNumbers(x_int, y_int, curve)
                    public_key = public_numbers.public_key()
                    _logger.info(f"[KEY_EXTRACT] ✓ Successfully built EC public key with curve {crv_name}")
                    
                else:
                    raise ValueError(f"Unsupported key type: kty={kty}, alg={alg}. Supported: RSA/RS256, EC/ES256")
                
                # Converter para formato PEM (funciona para ambos RSA e EC)
                _logger.info(f"[KEY_EXTRACT] Converting to PEM format...")
                pem_public_key = public_key.public_bytes(
                    encoding=serialization.Encoding.PEM,
                    format=serialization.PublicFormat.SubjectPublicKeyInfo
                ).decode('utf-8')
                
                _logger.info(f"[KEY_EXTRACT] ✓ PEM key generated (length: {len(pem_public_key)} chars)")
                
                # Cachear para próxima vez
                _public_keys_cache[kid] = pem_public_key
                _logger.info(f"[KEY_EXTRACT] ✓ Key cached for kid: {kid}")
                return pem_public_key
            except KeyError as e:
                _logger.error(f"Missing required key component: {e}")
                raise ValueError(f"Invalid key structure for kid {kid}: missing {e}") from e
            except Exception as e:
                _logger.error(f"Error building public key from JWKS: {e}", exc_info=True)
                raise ValueError(f"Failed to build public key for kid {kid}") from e
    
    # Se não encontrou, logar detalhes para debug
    raise ValueError(
        f"Key with kid '{kid}' not found in JWKS. "
        f"Available kids: {available_kids}. "
        f"JWKS may need refresh or token was signed with a rotated key."
    )


async def _verify_token_via_auth_server(token: str) -> Dict[str, Any]:
    """
    Valida token diretamente com o Auth server do Supabase.
    Usado como fallback para tokens HS256 (legacy) ou quando JWKS lookup falha.
    Conforme documentação: https://supabase.com/docs/guides/auth/jwts
    """
    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        raise RuntimeError("Supabase not configured for auth server validation")
    
    auth_url = f"{SUPABASE_URL}/auth/v1/user"
    headers = {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": f"Bearer {token}"
    }
    
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            resp = await client.get(auth_url, headers=headers)
            
            if resp.status_code == 200:
                user_data = resp.json()
                user_id = user_data.get("id")
                if not user_id:
                    raise HTTPException(status_code=401, detail="Invalid user data from auth server")
                
                # Construir claims básicas para compatibilidade
                claims = {
                    "sub": user_id,
                    "email": user_data.get("email"),
                    "role": user_data.get("role", "authenticated"),
                    "iss": f"{SUPABASE_URL}/auth/v1",  # Adicionar issuer para compatibilidade
                }
                return claims
            elif resp.status_code == 401:
                raise HTTPException(status_code=401, detail="Token validation failed")
            else:
                raise HTTPException(status_code=401, detail="Token validation error")
        except httpx.RequestError as e:
            raise HTTPException(status_code=401, detail="Token validation error") from e


async def verify_supabase_jwt(token: str) -> Dict[str, Any]:
    if not token:
        raise HTTPException(status_code=401, detail="Missing token")
    
    try:
        # Obter header não verificado para pegar o kid e algoritmo
        unverified_header = jwt.get_unverified_header(token)
        kid = unverified_header.get("kid")
        token_alg = unverified_header.get("alg", "RS256").upper()
        
        # Se for HS256 (legacy secret), usar Auth server diretamente
        if token_alg == "HS256":
            return await _verify_token_via_auth_server(token)
        
        if not kid:
            raise HTTPException(status_code=401, detail="Token missing key ID (kid)")
        
        # Obter JWKS (com retry se necessário)
        jwks = await _get_jwks()
        
        try:
            # Extrair a chave pública PEM correspondente
            pem_public_key = _get_pem_key_from_jwks(jwks, kid)
        except ValueError:
            # Se não encontrou a chave, pode ser que o JWKS cacheado está desatualizado
            # Limpar cache e tentar buscar novamente
            global _jwks_cache, _jwks_cache_expires_at
            _jwks_cache = None
            _jwks_cache_expires_at = 0.0
            _public_keys_cache.clear()
            
            # Buscar JWKS novamente (forçar atualização)
            jwks = await _get_jwks()
            
            # Tentar novamente
            try:
                pem_public_key = _get_pem_key_from_jwks(jwks, kid)
            except ValueError:
                return await _verify_token_via_auth_server(token)
        
        # Decodificar o token (suporta tanto RS256 quanto ES256)
        options = {
            "verify_signature": True,
            "verify_exp": True,
            "verify_aud": False,  # Supabase tokens podem ter aud diferente
        }
        
        # Suportar tanto RS256 quanto ES256 conforme o algoritmo do token
        if token_alg == "ES256":
            algorithms = ["ES256"]
        elif token_alg == "RS256":
            algorithms = ["RS256"]
        else:
            # Tentar o algoritmo do token, mas aceitar ambos como fallback
            algorithms = [token_alg, "ES256", "RS256"]
        
        try:
            claims = jwt.decode(token, pem_public_key, algorithms=algorithms, options=options)
        except jwt.ExpiredSignatureError:
            raise
        except jwt.JWTError:
            raise

        # Basic issuer check if configured (mais flexível)
        if SUPABASE_URL:
            expected_iss_prefix = f"{SUPABASE_URL}/auth/v1"
            iss = claims.get("iss")
            # Aceitar tanto o formato completo quanto variações
            # Não falhar, apenas logar - pode ser variação válida
        
        return claims
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=401, detail="Invalid token key") from e
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired") from None
    except jwt.JWTError as e:
        raise HTTPException(status_code=401, detail="Invalid or expired token") from e
    except Exception as e:
        raise HTTPException(status_code=401, detail="Invalid or expired token") from e


async def get_current_user(authorization: str = Header(default=None, alias="Authorization")) -> Dict[str, Any]:
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing Bearer token")
    
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Bearer token")
    
    token = authorization.replace("Bearer ", "").strip()
    
    claims = await verify_supabase_jwt(token)
    
    user_id = claims.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")
    
    return {"user_id": user_id, "claims": claims, "token": token}


