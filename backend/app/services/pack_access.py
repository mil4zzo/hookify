"""Autorizacao de escrita em packs — o guard que substitui a RLS nesses caminhos.

CONTEXTO (P3.6). A RLS de `packs` diz `user_id = auth.uid()`: cada um so enxerga
o proprio silo. O compartilhamento quebra isso por definicao — um EDITOR precisa
legitimamente escrever num pack que pertence ao DONO, e o banco recusaria antes
de a regra de papel ser sequer consultada. A saida e a checagem subir para a
aplicacao e o write descer para service role.

A troca tem um custo que este modulo existe para conter: enquanto a RLS era o
guarda, esquecer uma checagem falhava FECHADO (ninguem fazia nada); com service
role, esquecer falha ABERTO. Por isso a regra e uma so e mora aqui:

    TODO endpoint que escreve estado de pack com service role chama
    assert_pack_role() ANTES do write. Sem excecao.

Papeis validos: 'dono' | 'editor' | 'viewer' (resolve_pack_access, migration 103).
Viewer nunca escreve. So o dono compartilha/apaga.
"""
from __future__ import annotations

import logging
from typing import NamedTuple, Sequence

from fastapi import HTTPException

from app.core.supabase_client import get_supabase_service

logger = logging.getLogger(__name__)


class PackAccess(NamedTuple):
    role: str       # 'dono' | 'editor' | 'viewer'
    owner_id: str   # silo onde o pack (e seus dados) vivem — util p/ writes e unicidade


def resolve_pack_role(actor_id: str, pack_id: str) -> PackAccess | None:
    """Papel do ator num pack, ou None se ele nao tem acesso algum.

    Deriva de `resolve_pack_access` (proprio OU grant em `pack_shares`) — nunca
    de input do cliente. Pack inacessivel e indistinguivel de inexistente.
    """
    if not actor_id or not pack_id:
        return None

    sb = get_supabase_service()
    res = sb.rpc(
        "resolve_pack_access",
        {"p_pack_ids": [str(pack_id)], "p_actor_id": str(actor_id)},
    ).execute()

    for row in (res.data or []):
        if isinstance(row, dict) and str(row.get("pack_id")) == str(pack_id):
            role = str(row.get("role") or "")
            owner = str(row.get("owner_id") or "")
            if role and owner:
                return PackAccess(role=role, owner_id=owner)
    return None


def assert_pack_role(
    actor_id: str,
    pack_id: str,
    roles: Sequence[str] = ("dono", "editor"),
) -> PackAccess:
    """Garante que o ator tem um dos papeis exigidos no pack. Devolve (role, owner_id).

    - Sem acesso algum -> 404, nunca 403: quem esta fora nao recebe confirmacao
      de que o pack existe.
    - Com acesso mas papel insuficiente -> 403 com o motivo. Quem tem grant JA
      sabe que o pack existe; aqui a clareza vale mais que o sigilo.
    """
    try:
        access = resolve_pack_role(actor_id, pack_id)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("[PACK_ACCESS] Falha ao resolver acesso ao pack %s: %s", pack_id, e)
        raise HTTPException(status_code=500, detail="Erro ao verificar acesso ao pack")

    if access is None:
        raise HTTPException(status_code=404, detail="Pack nao encontrado")

    if access.role not in roles:
        if tuple(roles) == ("dono",):
            detail = "Somente o dono do pack pode executar esta acao"
        else:
            detail = "Somente dono ou editor podem editar este pack"
        raise HTTPException(status_code=403, detail=detail)

    return access
