"""Pasta compartilhada — /folder-shares (migration 181).

Compartilhar uma pasta e dizer "esta pasta, com tudo que tem debaixo dela hoje e o
que entrar depois, e de fulano" — como no Drive: a pessoa ve a mesma pasta do dono e,
como editor, mexe nela. Este modulo grava quem tem a pasta (`folder_shares`). Quem
transforma isso em acesso aos packs sao os gatilhos do banco, que escrevem linhas em
`pack_shares` marcadas com `source_folder_id`:

  - a autorizacao de pack continua num lugar so (`resolve_pack_access` nao mudou);
  - o acesso por pasta aparece no "Compartilhar pack" do dono, com a origem;
  - dentro da pasta, tudo segue a pasta: o convite direto de quem a pasta cobre e
    ABSORVIDO, e sai junto quando a pessoa sai da pasta;
  - sai junto com o motivo: pack sai da pasta, pessoa sai da pasta, pasta e desfeita.

So o DONO da pasta convida. Entram os packs dele e os que o proprio dono de cada pack
pos la (o editor que criou o pack dele dentro da pasta). Pack de terceiro que alguem
so organizou ali fica fora — o filtro esta no banco (`folder_grants_desired`) e aqui
so e contado para a tela avisar.

O convidado sai da pasta inteira sozinho (DELETE /{folder_id}/me). De UM pack dela,
nao: o acesso volta pela pasta.
"""
from __future__ import annotations

import logging
import uuid
from typing import Any, Dict, List

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel, Field

from app.core.auth import get_current_user
from app.core.supabase_client import get_supabase_for_user, get_supabase_service
from app.core.supabase_retry import with_postgrest_retry
from app.routes.pack_shares import VALID_ROLES, _hydrate_display_names
from app.services import folder_scope

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/folder-shares", tags=["folder-shares"])


class CreateFolderShareRequest(BaseModel):
    grantee_id: str = Field(..., description="ID do usuario que recebera acesso")
    role: str = Field(default="editor", description="editor | viewer")


class UpdateFolderShareRequest(BaseModel):
    role: str = Field(..., description="editor | viewer")


def _valid_uuid(value: str, field: str) -> str:
    try:
        uuid.UUID(str(value))
    except (ValueError, AttributeError):
        raise HTTPException(status_code=400, detail=f"{field} invalido")
    return str(value)


def _assert_folder_owner(sb, folder_id: str, actor_id: str) -> Dict[str, Any]:
    """A RLS esconde pasta alheia: sem linha, nao e do ator (404, nunca 403)."""
    rows = with_postgrest_retry(
        "folder_shares.folder",
        lambda: sb.table("folders").select("id, name, parent_id").eq("id", folder_id).eq("user_id", actor_id).limit(1).execute(),
    ).data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Pasta nao encontrada")
    return rows[0]


def _scope(sb, actor_id: str, folder_id: str) -> Dict[str, Any]:
    """O que a pasta cobre: subpastas, packs que ela repassa (do ator, ou postos la pelo
    proprio dono do pack) e packs de terceiros que ficam de fora."""
    folders, members = folder_scope.load_tree(sb, actor_id)
    sub_ids = folder_scope.subtree_folder_ids(folders, folder_id)
    pack_ids = folder_scope.pack_ids_in_folders(members, sub_ids)
    owned = set(folder_scope.owned_pack_ids(sb, actor_id, pack_ids))
    owned.update(folder_scope.contributed_pack_ids(sb, actor_id, pack_ids))
    covered = [p for p in pack_ids if p in owned]
    return {
        "folders": folders,
        "subfolders": max(len(sub_ids) - 1, 0),
        "pack_ids": pack_ids,
        "covered_pack_ids": covered,
        "foreign_packs": len(pack_ids) - len(covered),
    }


def _scope_summary(scope: Dict[str, Any]) -> Dict[str, int]:
    return {
        "subfolders": scope["subfolders"],
        "owned_packs": len(scope["covered_pack_ids"]),
        "foreign_packs": scope["foreign_packs"],
    }


def _direct_count(grantee_id: str, pack_ids: List[str]) -> int:
    """Packs do escopo em que a pessoa tem acesso DIRETO. Lido antes de compartilhar:
    e o que a pasta vai absorver (passa a valer "via pasta", com o papel da pasta)."""
    total = 0
    sb = get_supabase_service()
    for i in range(0, len(pack_ids), folder_scope.ID_BATCH):
        chunk = pack_ids[i : i + folder_scope.ID_BATCH]
        rows = with_postgrest_retry(
            "folder_shares.direct_count",
            lambda chunk=chunk: sb.table("pack_shares")
            .select("pack_id")
            .eq("grantee_id", grantee_id)
            .in_("pack_id", chunk)
            .is_("source_folder_id", "null")
            .execute(),
        ).data or []
        total += len(rows)
    return total


@router.get("/{folder_id}")
def list_folder_shares(folder_id: str, user=Depends(get_current_user)):
    """Quem tem a pasta, o que ela cobre, e o que vem herdado das pastas de cima."""
    folder_id = _valid_uuid(folder_id, "folder_id")
    actor_id = str(user["user_id"])
    sb = get_supabase_for_user(user["token"])
    folder = _assert_folder_owner(sb, folder_id, actor_id)

    scope = _scope(sb, actor_id, folder_id)
    above = folder_scope.ancestor_ids(scope["folders"], folder_id)
    names = {str(f["id"]): f.get("name") for f in scope["folders"]}

    wanted = [folder_id] + above
    rows = with_postgrest_retry(
        "folder_shares.list",
        lambda: sb.table("folder_shares")
        .select("id, folder_id, grantee_id, role, created_at")
        .in_("folder_id", wanted)
        .order("created_at")
        .execute(),
    ).data or []
    display = _hydrate_display_names(sorted({str(r["grantee_id"]) for r in rows if r.get("grantee_id")}))

    def row(r: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "id": r.get("id"),
            "folder_id": r.get("folder_id"),
            "folder_name": names.get(str(r.get("folder_id"))),
            "grantee_id": r.get("grantee_id"),
            "display_name": display.get(str(r.get("grantee_id"))) or None,
            "role": r.get("role"),
            "created_at": r.get("created_at"),
        }

    return {
        "success": True,
        "folder": {"id": folder["id"], "name": folder.get("name")},
        "shares": [row(r) for r in rows if str(r.get("folder_id")) == folder_id],
        "inherited": [row(r) for r in rows if str(r.get("folder_id")) != folder_id],
        "scope": _scope_summary(scope),
    }


@router.post("/{folder_id}")
def create_folder_share(
    folder_id: str,
    request: CreateFolderShareRequest = Body(...),
    user=Depends(get_current_user),
):
    """Compartilha a pasta (com tudo debaixo dela, hoje e depois). So o dono.

    O convite direto que a pessoa ja tinha em algum pack da pasta e absorvido: passa a
    valer pela pasta, com o papel dela, e sai junto quando ela sair da pasta.
    """
    folder_id = _valid_uuid(folder_id, "folder_id")
    actor_id = str(user["user_id"])
    if request.role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail="role deve ser 'editor' ou 'viewer'")
    grantee_id = _valid_uuid((request.grantee_id or "").strip(), "grantee_id")
    if grantee_id == actor_id:
        raise HTTPException(status_code=400, detail="Voce nao pode compartilhar uma pasta consigo mesmo")

    sb = get_supabase_for_user(user["token"])
    _assert_folder_owner(sb, folder_id, actor_id)
    scope = _scope(sb, actor_id, folder_id)

    payload = {
        "folder_id": folder_id,
        # owner_id vem do ATOR, nunca do cliente; a FK composta (pasta, dono)
        # recusaria um valor forjado de qualquer forma.
        "owner_id": actor_id,
        "grantee_id": grantee_id,
        "role": request.role,
    }
    absorbed = _direct_count(grantee_id, scope["covered_pack_ids"])
    with folder_scope.tracked_access_changes(sb, actor_id, scope["covered_pack_ids"]) as changes:
        try:
            res = with_postgrest_retry(
                "folder_shares.upsert",
                lambda: sb.table("folder_shares").upsert(payload, on_conflict="folder_id,grantee_id").execute(),
            )
        except Exception as e:
            message = str(e)
            if "folder_shares_not_self" in message:
                raise HTTPException(status_code=400, detail="Voce nao pode compartilhar uma pasta consigo mesmo")
            if "foreign key" in message.lower() or "fkey" in message:
                raise HTTPException(status_code=400, detail="Usuario convidado nao encontrado")
            logger.exception("[FOLDER_SHARES] Erro ao compartilhar pasta %s: %s", folder_id, e)
            raise HTTPException(status_code=500, detail="Erro ao compartilhar a pasta")

    logger.info(
        "[FOLDER_SHARES] Pasta %s compartilhada por %s com %s (role=%s, packs=%s, absorvidos=%s)",
        folder_id, actor_id, grantee_id, request.role, len(scope["covered_pack_ids"]), absorbed,
    )
    rows = res.data or []
    return {
        "success": True,
        "share": rows[0] if rows else None,
        "access_changes": changes,
        "absorbed": absorbed,
        "scope": _scope_summary(scope),
    }


@router.patch("/{folder_id}/{grantee_id}")
def update_folder_share_role(
    folder_id: str,
    grantee_id: str,
    request: UpdateFolderShareRequest = Body(...),
    user=Depends(get_current_user),
):
    """Troca o papel da pessoa na pasta; chega em todos os packs cobertos."""
    folder_id = _valid_uuid(folder_id, "folder_id")
    grantee_id = _valid_uuid(grantee_id, "grantee_id")
    actor_id = str(user["user_id"])
    if request.role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail="role deve ser 'editor' ou 'viewer'")

    sb = get_supabase_for_user(user["token"])
    _assert_folder_owner(sb, folder_id, actor_id)
    scope = _scope(sb, actor_id, folder_id)

    with folder_scope.tracked_access_changes(sb, actor_id, scope["covered_pack_ids"]) as changes:
        res = with_postgrest_retry(
            "folder_shares.update",
            lambda: sb.table("folder_shares")
            .update({"role": request.role})
            .eq("folder_id", folder_id)
            .eq("grantee_id", grantee_id)
            .execute(),
        )
        if not (res.data or []):
            raise HTTPException(status_code=404, detail="Compartilhamento nao encontrado")

    return {"success": True, "folder_id": folder_id, "grantee_id": grantee_id, "role": request.role, "access_changes": changes}


@router.delete("/{folder_id}/me")
def leave_folder(folder_id: str, user=Depends(get_current_user)):
    """O convidado sai da pasta inteira, sem depender do dono.

    Rota declarada ANTES de /{folder_id}/{grantee_id}: 'me' casaria com o parametro
    de path e cairia no handler de revogacao, que exige ser dono.
    """
    folder_id = _valid_uuid(folder_id, "folder_id")
    actor_id = str(user["user_id"])
    sb = get_supabase_for_user(user["token"])

    try:
        affected = folder_scope.subtree_pack_ids(folder_id)
    except Exception as e:  # leitura de apoio (so alimenta a foto)
        logger.warning("[FOLDER_SHARES] Nao deu para ler a subarvore de %s: %s", folder_id, e)
        affected = []
    with folder_scope.tracked_access_changes(sb, actor_id, affected) as changes:
        # A policy de DELETE do convidado so alcanca a PROPRIA linha.
        res = with_postgrest_retry(
            "folder_shares.leave",
            lambda: sb.table("folder_shares").delete().eq("folder_id", folder_id).eq("grantee_id", actor_id).execute(),
        )
        if not (res.data or []):
            raise HTTPException(status_code=404, detail="Pasta nao encontrada")

    logger.info("[FOLDER_SHARES] %s saiu da pasta %s", actor_id, folder_id)
    return {"success": True, "folder_id": folder_id, "left": True, "access_changes": changes}


@router.delete("/{folder_id}/{grantee_id}")
def revoke_folder_share(folder_id: str, grantee_id: str, user=Depends(get_current_user)):
    """Tira a pessoa da pasta: perde o acesso a TUDO que esta nela, inclusive o pack
    que tinha recebido direto antes (a pasta o absorveu). Pack que ela mesma pos la
    continua na pasta e continua dela."""
    folder_id = _valid_uuid(folder_id, "folder_id")
    grantee_id = _valid_uuid(grantee_id, "grantee_id")
    actor_id = str(user["user_id"])

    sb = get_supabase_for_user(user["token"])
    _assert_folder_owner(sb, folder_id, actor_id)
    scope = _scope(sb, actor_id, folder_id)

    with folder_scope.tracked_access_changes(sb, actor_id, scope["covered_pack_ids"]) as changes:
        res = with_postgrest_retry(
            "folder_shares.delete",
            lambda: sb.table("folder_shares").delete().eq("folder_id", folder_id).eq("grantee_id", grantee_id).execute(),
        )
        if not (res.data or []):
            raise HTTPException(status_code=404, detail="Compartilhamento nao encontrado")

    logger.info("[FOLDER_SHARES] Acesso de %s a pasta %s revogado por %s", grantee_id, folder_id, actor_id)
    return {"success": True, "folder_id": folder_id, "grantee_id": grantee_id, "revoked": True, "access_changes": changes}
