from __future__ import annotations

import base64
import logging
from typing import Optional
from cryptography.fernet import Fernet, InvalidToken

from app.core.config import ENCRYPTION_KEY

logger = logging.getLogger(__name__)

_warned_no_key = False


def _get_fernet() -> Optional[Fernet]:
    global _warned_no_key
    key = ENCRYPTION_KEY
    if not key:
        if not _warned_no_key:
            logger.error(
                "[ENCRYPTION] ENCRYPTION_KEY is not set — tokens will be stored in plaintext. "
                "Set ENCRYPTION_KEY in backend/.env to enable at-rest encryption."
            )
            _warned_no_key = True
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
        return token
    return f.encrypt(token.encode()).decode()


def decrypt_token(token_enc: str) -> str:
    f = _get_fernet()
    if not f:
        return token_enc
    try:
        return f.decrypt(token_enc.encode()).decode()
    except InvalidToken:
        logger.warning("[ENCRYPTION] decrypt_token: InvalidToken — returning as-is (may be plaintext fallback)")
        return token_enc


