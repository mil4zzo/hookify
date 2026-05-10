"""
Validação de scopes pós-OAuth do Facebook.

A Meta tornou quase todos os scopes opcionais com checkbox em 2018: o usuário
pode desmarcar `business_management`/`pages_show_list` durante o consent e o
token resultante autentica normalmente, mas falha em queries que dependem deles
— gerando o sintoma `Job Failed 0%` mascarando ausência de scope.

Após o callback OAuth, chamamos `/me/permissions` com o token recém-emitido
para registrar quais scopes vieram realmente `granted`. Connections com scope
crítico ausente ficam com `status='degraded'` (não bloqueia uso parcial; a UI
sinaliza o impacto).
"""
from __future__ import annotations

import logging
from typing import List, Tuple

import requests

from app.core.config import META_GRAPH_BASE_URL

logger = logging.getLogger(__name__)


# Lista de scopes considerados "críticos" para o uso normal da Hookify.
# Se algum vier ausente do `/me/permissions`, marcamos a connection como `degraded`.
# Nota: email/public_profile ficam de fora — são identidade, sem impacto operacional.
CRITICAL_SCOPES: Tuple[str, ...] = (
    "ads_read",
    "ads_management",
    "business_management",
    "pages_show_list",
)


def fetch_granted_scopes(access_token: str) -> List[str]:
    """Lista scopes com status='granted' retornados por GET /me/permissions."""
    url = f"{META_GRAPH_BASE_URL}me/permissions?access_token={access_token}"
    try:
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        data = response.json() or {}
        items = data.get("data") or []
        return [
            item["permission"]
            for item in items
            if isinstance(item, dict)
            and item.get("status") == "granted"
            and item.get("permission")
        ]
    except Exception as err:
        logger.warning("[FacebookScopes] falha ao chamar /me/permissions: %s", err)
        return []


def evaluate_token_scopes(access_token: str) -> Tuple[List[str], List[str], str]:
    """
    Retorna `(granted_scopes, missing_critical, status)`.

    - `granted_scopes`: scopes que o usuário autorizou (lista real, não a config).
    - `missing_critical`: scopes em `CRITICAL_SCOPES` que NÃO vieram granted.
    - `status`: `'active'` se nenhum crítico falta, `'degraded'` caso contrário.

    Fail-open: se a chamada `/me/permissions` falhar, retornamos status='active'
    e granted=[]. Não penalizamos o usuário por uma chamada de validação que
    talvez tenha caído em transient. O pipeline antigo funciona normal.
    """
    granted = fetch_granted_scopes(access_token)
    if not granted:
        return [], [], "active"

    missing = [s for s in CRITICAL_SCOPES if s not in granted]
    status = "degraded" if missing else "active"
    return granted, missing, status
