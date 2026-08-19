"""
Compartilhamento de packs entre usuarios do Hookify — /pack-shares.

NAO confundir com /shares (routes/shares.py): aquilo e link publico com snapshot
congelado, para quem esta FORA do app. Aqui o pack e compartilhado com outro
usuario do Hookify, e o dado NAO e copiado — permanece no silo do dono, que o
convidado passa a ler ao vivo.

Fronteira desta fase (P3.1): modelo de dados e primitivas de autorizacao. O pack
compartilhado ainda NAO aparece na lista do convidado — isso depende da P3.2,
que faz as RPCs derivarem o dono a partir de p_pack_ids. Expor antes mostraria
um pack cujo analytics responderia Forbidden.

Garantias que NAO estao aqui, e sim no banco (migration 103):
- forjar grant sobre pack alheio e impossivel: FK composta
  (pack_id, owner_id) -> packs(id, user_id);
- convidado nao promove o proprio papel: existe policy de DELETE para ele, nao
  de UPDATE;
- dono apaga o pack -> grants somem junto, via ON DELETE CASCADE.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.core.auth import get_current_user
from app.core.supabase_client import get_supabase_for_user, get_supabase_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/pack-shares", tags=["pack-shares"])

VALID_ROLES = ("editor", "viewer")


class ShareUserLookupResponse(BaseModel):
    found: bool
    user_id: Optional[str] = None
    display_name: Optional[str] = None


class CreatePackShareRequest(BaseModel):
    grantee_id: str = Field(..., description="ID do usuario que recebera acesso")
    role: str = Field(default="editor", description="editor | viewer")


class UpdatePackShareRequest(BaseModel):
    role: str = Field(..., description="editor | viewer")


def _assert_owner(user: Dict[str, Any], pack_id: str) -> Dict[str, Any]:
    """Garante que o requisitante e DONO do pack (nao apenas convidado).

    Le com o cliente do usuario, entao a RLS de packs (user_id = auth.uid()) ja
    faz o trabalho: um convidado simplesmente nao encontra a linha. So o dono
    administra grants — decisao travada, sem repasse a terceiros.
    """
    sb = get_supabase_for_user(user["token"])
    res = (
        sb.table("packs")
        .select("id, name, user_id")
        .eq("id", pack_id)
        .eq("user_id", user["user_id"])
        .limit(1)
        .execute()
    )
    rows = res.data or []
    if not rows:
        # 404 e nao 403 de proposito: nao confirmar a existencia de pack alheio.
        raise HTTPException(status_code=404, detail="Pack nao encontrado")
    return rows[0]


def _hydrate_display_names(user_ids: List[str]) -> Dict[str, str]:
    """Resolve nomes de exibicao via RPC (auth.users nao e exposta ao PostgREST)."""
    if not user_ids:
        return {}
    sb = get_supabase_service()
    out: Dict[str, str] = {}
    try:
        res = sb.rpc("lookup_users_by_ids", {"p_user_ids": user_ids}).execute()
        for row in (res.data or []):
            if isinstance(row, dict) and row.get("user_id"):
                out[str(row["user_id"])] = row.get("display_name") or ""
    except Exception as e:
        # Nome e enfeite: a lista de membros nao pode quebrar por causa disso.
        logger.warning("[PACK_SHARES] Falha ao resolver nomes de exibicao: %s", e)
    return out


@router.get("/lookup", response_model=ShareUserLookupResponse)
def lookup_user(email: str = Query(..., min_length=3), user=Depends(get_current_user)):
    """Resolve um e-mail EXATO para (user_id, nome) — passo 1 do convite.

    Match exato de proposito: busca parcial transformaria o app num coletor de
    e-mails cadastrados. Com exato so se confirma um endereco ja conhecido por
    inteiro. A RPC nao e exposta ao PostgREST justamente para que a chamada
    passe por aqui e o rate limit do middleware valha.
    """
    normalized = (email or "").strip().lower()
    if "@" not in normalized:
        raise HTTPException(status_code=400, detail="E-mail invalido")

    try:
        sb = get_supabase_service()
        res = sb.rpc("lookup_user_by_email", {"p_email": normalized}).execute()
    except Exception as e:
        logger.exception("[PACK_SHARES] Erro no lookup por e-mail: %s", e)
        raise HTTPException(status_code=500, detail="Erro ao buscar usuario")

    rows = res.data or []
    if not rows:
        return ShareUserLookupResponse(found=False)

    row = rows[0] if isinstance(rows, list) else rows
    found_id = str(row.get("user_id"))
    if found_id == str(user["user_id"]):
        raise HTTPException(status_code=400, detail="Voce nao pode compartilhar um pack consigo mesmo")

    return ShareUserLookupResponse(
        found=True, user_id=found_id, display_name=row.get("display_name") or None
    )


@router.get("/conflicts")
def get_pack_conflicts(
    pack_ids: List[str] = Query(default=[]),
    user=Depends(get_current_user),
):
    """Grafo de conflito cross-silo entre os packs ACESSIVEIS ao ator.

    Um par conflita quando dois packs de DONOS diferentes contem o mesmo anuncio
    no mesmo dia — selecionar os dois juntos forca o dedup a escolher uma das
    linhas e o total deixa de ser exato. Decisao de produto: "impreciso e
    impreciso" — a UI usa este grafo para DESABILITAR a selecao (camada 1) e
    para o estado bloqueante (camada 3). Mesmo dono nunca conflita.

    Rota declarada ANTES de /{pack_id}: 'conflicts' casaria com o parametro.
    A RPC e revogada do PostgREST; o escopo vem de resolve_pack_access dentro
    dela — pack sem acesso simplesmente nao entra no grafo.
    """
    cleaned = [str(p).strip() for p in (pack_ids or []) if str(p or "").strip()]
    if len(cleaned) < 2:
        return {"success": True, "pairs": []}

    try:
        sb = get_supabase_service()
        res = sb.rpc(
            "detect_pack_conflicts",
            {"p_pack_ids": cleaned, "p_actor_id": str(user["user_id"])},
        ).execute()
    except Exception as e:
        logger.exception("[PACK_SHARES] Erro ao detectar conflitos: %s", e)
        raise HTTPException(status_code=500, detail="Erro ao verificar conflitos entre packs")

    pairs = [
        [str(r["pack_a"]), str(r["pack_b"])]
        for r in (res.data or [])
        if isinstance(r, dict) and r.get("pack_a") and r.get("pack_b")
    ]
    return {"success": True, "pairs": pairs}


@router.get("/{pack_id}")
def list_pack_shares(pack_id: str, user=Depends(get_current_user)):
    """Lista os convidados de um pack. So o dono enxerga."""
    _assert_owner(user, pack_id)

    sb = get_supabase_for_user(user["token"])
    res = (
        sb.table("pack_shares")
        .select("id, grantee_id, role, created_at")
        .eq("pack_id", pack_id)
        .order("created_at")
        .execute()
    )
    rows = res.data or []
    names = _hydrate_display_names([str(r["grantee_id"]) for r in rows if r.get("grantee_id")])

    return {
        "success": True,
        "pack_id": pack_id,
        "shares": [
            {
                "id": r.get("id"),
                "grantee_id": r.get("grantee_id"),
                "display_name": names.get(str(r.get("grantee_id"))) or None,
                "role": r.get("role"),
                "created_at": r.get("created_at"),
            }
            for r in rows
        ],
    }


@router.post("/{pack_id}")
def create_pack_share(
    pack_id: str,
    request: CreatePackShareRequest = Body(...),
    user=Depends(get_current_user),
):
    """Concede acesso a um pack. So o dono compartilha (sem repasse a terceiros)."""
    pack = _assert_owner(user, pack_id)

    if request.role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail="role deve ser 'editor' ou 'viewer'")

    grantee_id = (request.grantee_id or "").strip()
    if not grantee_id:
        raise HTTPException(status_code=400, detail="grantee_id obrigatorio")
    if grantee_id == str(user["user_id"]):
        raise HTTPException(status_code=400, detail="Voce nao pode compartilhar um pack consigo mesmo")

    sb = get_supabase_for_user(user["token"])
    payload = {
        "pack_id": pack_id,
        # owner_id vem do PACK, nunca do cliente. A FK composta no banco recusaria
        # um valor forjado de qualquer forma, mas nao ha razao para tentar.
        "owner_id": str(pack["user_id"]),
        "grantee_id": grantee_id,
        "role": request.role,
    }

    try:
        res = sb.table("pack_shares").upsert(payload, on_conflict="pack_id,grantee_id").execute()
    except Exception as e:
        message = str(e)
        if "pack_shares_not_self" in message:
            raise HTTPException(status_code=400, detail="Voce nao pode compartilhar um pack consigo mesmo")
        if "foreign key" in message.lower() or "fkey" in message:
            raise HTTPException(status_code=400, detail="Usuario convidado nao encontrado")
        logger.exception("[PACK_SHARES] Erro ao compartilhar pack %s: %s", pack_id, e)
        raise HTTPException(status_code=500, detail="Erro ao compartilhar pack")

    rows = res.data or []
    logger.info(
        "[PACK_SHARES] Pack %s compartilhado por %s com %s (role=%s)",
        pack_id, user["user_id"], grantee_id, request.role,
    )
    return {"success": True, "pack_id": pack_id, "share": rows[0] if rows else None}


@router.patch("/{pack_id}/{grantee_id}")
def update_pack_share_role(
    pack_id: str,
    grantee_id: str,
    request: UpdatePackShareRequest = Body(...),
    user=Depends(get_current_user),
):
    """Troca o papel de um convidado. So o dono."""
    _assert_owner(user, pack_id)

    if request.role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail="role deve ser 'editor' ou 'viewer'")

    sb = get_supabase_for_user(user["token"])
    res = (
        sb.table("pack_shares")
        .update({"role": request.role})
        .eq("pack_id", pack_id)
        .eq("grantee_id", grantee_id)
        .execute()
    )
    if not (res.data or []):
        raise HTTPException(status_code=404, detail="Compartilhamento nao encontrado")

    return {"success": True, "pack_id": pack_id, "grantee_id": grantee_id, "role": request.role}


@router.delete("/{pack_id}/me")
def leave_pack(pack_id: str, user=Depends(get_current_user)):
    """Convidado sai do pack sem depender do dono.

    Rota declarada ANTES de /{pack_id}/{grantee_id}: 'me' casaria com o
    parametro de path e cairia no handler de revogacao, que exige ser dono.
    """
    sb = get_supabase_for_user(user["token"])
    res = (
        sb.table("pack_shares")
        .delete()
        .eq("pack_id", pack_id)
        .eq("grantee_id", user["user_id"])
        .execute()
    )
    if not (res.data or []):
        raise HTTPException(status_code=404, detail="Voce nao tem acesso compartilhado a este pack")

    logger.info("[PACK_SHARES] Usuario %s saiu do pack %s", user["user_id"], pack_id)
    return {"success": True, "pack_id": pack_id, "left": True}


@router.delete("/{pack_id}/{grantee_id}")
def revoke_pack_share(pack_id: str, grantee_id: str, user=Depends(get_current_user)):
    """Revoga o acesso de um convidado. So o dono."""
    _assert_owner(user, pack_id)

    sb = get_supabase_for_user(user["token"])
    res = (
        sb.table("pack_shares")
        .delete()
        .eq("pack_id", pack_id)
        .eq("grantee_id", grantee_id)
        .execute()
    )
    if not (res.data or []):
        raise HTTPException(status_code=404, detail="Compartilhamento nao encontrado")

    logger.info("[PACK_SHARES] Acesso de %s ao pack %s revogado por %s", grantee_id, pack_id, user["user_id"])
    return {"success": True, "pack_id": pack_id, "grantee_id": grantee_id, "revoked": True}
