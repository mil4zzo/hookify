from __future__ import annotations

import base64
import os
from typing import Optional
from cryptography.fernet import Fernet, InvalidToken

from app.core.config import ENCRYPTION_KEY


def _get_fernet() -> Optional[Fernet]:
    key = ENCRYPTION_KEY
    if not key:
        return None
    # Accept raw 32-byte key or base64-encoded
    try:
        if len(key) == 44 and key.endswith("="):
            fkey = key.encode()
        else:
            fkey = base64.urlsafe_b64encode(key.encode().ljust(32, b"0")[:32])
        return Fernet(fkey)
    except Exception:
        return None


def encrypt_token(token: str) -> str:
    f = _get_fernet()
    if not f:
        # Fallback: return plain if no key is configured
        return token
    return f.encrypt(token.encode()).decode()


def decrypt_token(token_enc: str) -> str:
    f = _get_fernet()
    if not f:
        return token_enc
    try:
        return f.decrypt(token_enc.encode()).decode()
    except InvalidToken:
        # Not encrypted with our key; return as-is
        return token_enc


