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
from typing import Dict, List, NamedTuple, Optional, Sequence

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


# ── Escrita por ENTIDADE (P3.3b-resto) ───────────────────────────────────────
# As escritas de status/budget/transcricao nao recebem pack_id: recebem ad_id,
# adset_id ou campaign_id. Sem saber a que pack a entidade pertence, nao ha como
# autorizar nem escolher o silo — e o caminho legado (silo do ator) falha FECHADO
# para convidado (a RLS nao acha entidade alheia).
#
# O elo e o CONTEXTO DE PACK enviado pelo cliente. Ele NAO e confiavel sozinho e
# nunca e usado como escopo: serve so para propor candidatos. O que autoriza e
# (a) assert de papel dono|editor no pack, e (b) a entidade existir NAQUELE pack
# DENTRO do silo do dono. Um pack_id forjado nao passa em (a); um ad_id alheio
# nao passa em (b).

_ENTITY_COLUMN = {"ad": "ad_id", "adset": "adset_id", "campaign": "campaign_id"}
_ENTITY_IN_BATCH = 200  # limite de URL do PostgREST


class EntityWriteScope(NamedTuple):
    owner_id: str          # silo onde a entidade vive — destino do write
    is_guest: bool         # True => service role + credencial do DONO
    role: str              # papel do ator no pack que autorizou
    pack_ids: tuple        # packs do contexto que autorizaram
    allowed_ids: tuple     # ids que realmente pertencem ao silo/pack (ordem preservada)


def resolve_entity_write_scope(
    actor_id: str,
    entity_type: str,
    entity_ids: Sequence[str],
    pack_ids: Optional[Sequence[str]],
) -> Optional[EntityWriteScope]:
    """Silo e autorizacao para escrever numa entidade, a partir do contexto de pack.

    Devolve None quando o contexto nao resolve (sem pack_ids, nenhum pack com
    papel de escrita, ou a entidade nao pertence a nenhum deles). None NAO e erro:
    o chamador segue pelo caminho legado (silo do ator), que ja falha fechado.

    Regra de desempate quando a entidade aparece em mais de um silo:
    - Silo do PROPRIO ator vence (comportamento historico preservado, sem service role).
    - Senao, um unico dono estrangeiro -> caminho de convidado.
    - Dois donos distintos -> 409: escrever no silo errado e pior que nao escrever.
      (A UI ja impede selecao de packs cross-silo conflitantes — P3.2c.)
    """
    column = _ENTITY_COLUMN.get(entity_type)
    ids = [str(i).strip() for i in (entity_ids or []) if str(i or "").strip()]
    packs = [str(p).strip() for p in (pack_ids or []) if str(p or "").strip()]
    if not column or not ids or not packs or not actor_id:
        return None

    sb = get_supabase_service()
    try:
        res = sb.rpc(
            "resolve_pack_access",
            {"p_pack_ids": packs, "p_actor_id": str(actor_id)},
        ).execute()
    except Exception as e:
        logger.exception("[PACK_ACCESS] Falha ao resolver contexto de pack: %s", e)
        raise HTTPException(status_code=500, detail="Erro ao verificar acesso ao pack")

    # Só papeis de ESCRITA propoem silo. Viewer no contexto e simplesmente ignorado
    # aqui — ele cai no caminho legado e recebe o 404/erro de sempre.
    packs_by_owner: Dict[str, List[str]] = {}
    role_by_owner: Dict[str, str] = {}
    for row in (res.data or []):
        if not isinstance(row, dict):
            continue
        role = str(row.get("role") or "")
        owner = str(row.get("owner_id") or "")
        pack_id = str(row.get("pack_id") or "")
        if role in ("dono", "editor") and owner and pack_id:
            packs_by_owner.setdefault(owner, []).append(pack_id)
            role_by_owner[owner] = role
    if not packs_by_owner:
        return None

    # A entidade pertence a algum desses packs, no silo do dono?
    hits: Dict[str, List[str]] = {}
    for owner_id, owner_packs in packs_by_owner.items():
        found: set = set()
        for i in range(0, len(ids), _ENTITY_IN_BATCH):
            batch = ids[i:i + _ENTITY_IN_BATCH]
            rows = (
                sb.table("ads")
                .select(column)
                .eq("user_id", owner_id)
                .in_(column, batch)
                .overlaps("pack_ids", owner_packs)
                .execute()
            )
            for r in (rows.data or []):
                val = str(r.get(column) or "").strip()
                if val:
                    found.add(val)
        if found:
            hits[owner_id] = [i for i in ids if i in found]

    if not hits:
        return None

    actor = str(actor_id)
    if actor in hits:
        chosen = actor
    elif len(hits) == 1:
        chosen = next(iter(hits))
    else:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "entity_in_multiple_silos",
                "message": "Esta entidade existe em mais de uma conta. Selecione um pack de cada vez.",
            },
        )

    return EntityWriteScope(
        owner_id=chosen,
        is_guest=chosen != actor,
        role=role_by_owner.get(chosen, ""),
        pack_ids=tuple(packs_by_owner[chosen]),
        allowed_ids=tuple(hits[chosen]),
    )
