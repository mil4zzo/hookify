"""Pastas da Biblioteca de packs — /folders.

A pasta e de QUEM ORGANIZA, nao do pack (migration 168). Consequencias no codigo:

  - `user_id` e sempre o ATOR (`user["user_id"]`), nunca o dono do pack. Um
    convidado arquiva um pack compartilhado na pasta dele sem tocar no pack do
    dono — e por isso nao ha checagem de papel aqui, so de ACESSO.
  - Tudo passa pela RLS com o cliente do usuario. Nao existe caminho por service
    role nesta rota: se a policy nao deixa, e porque nao e do ator mesmo.
  - Exclusividade (um pack, uma pasta) e da PK (user_id, pack_id). Mover e
    upsert nessa chave, nunca delete + insert — senao duas chamadas concorrentes
    deixariam o pack sem pasta nenhuma no meio do caminho.

NAO existe compartilhamento de pasta, e nao deve passar a existir: ver Decisao 3
na migration 168. "Compartilhar pasta" e acucar de UI sobre /pack-shares, um
pack de cada vez, com os packs que estao na pasta NAQUELE momento.
"""
from __future__ import annotations

import logging
import re
import uuid
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel, Field

from app.core.auth import get_current_user
from app.core.supabase_client import get_supabase_for_user, get_supabase_service
from app.core.supabase_retry import with_postgrest_retry

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/folders", tags=["folders"])

MAX_NAME_LEN = 60          # espelha o CHECK folders_name_max_len da migration 168
MAX_FOLDERS_PER_USER = 100
# PostgREST monta o .in_() na URL: lote grande estoura o limite de tamanho.
# Mesmo teto usado no resto do projeto para listas de uuid.
ID_BATCH = 200


class FolderCreate(BaseModel):
    name: str = Field(min_length=1, max_length=MAX_NAME_LEN)
    pack_ids: List[str] = Field(default_factory=list)


class FolderRename(BaseModel):
    name: str = Field(min_length=1, max_length=MAX_NAME_LEN)


class ReorderRequest(BaseModel):
    # Ordem COMPLETA das pastas, de cima para baixo. A posicao vira o indice.
    folder_ids: List[str] = Field(min_length=1, max_length=MAX_FOLDERS_PER_USER)


class MoveRequest(BaseModel):
    pack_ids: List[str] = Field(min_length=1)
    # None = tirar da pasta (volta para "packs soltos").
    folder_id: Optional[str] = None


def _clean_name(raw: str) -> str:
    name = re.sub(r"\s+", " ", (raw or "").strip())
    if not name:
        raise HTTPException(status_code=422, detail="Nome da pasta nao pode ser vazio.")
    if len(name) > MAX_NAME_LEN:
        raise HTTPException(status_code=422, detail=f"Nome da pasta passa de {MAX_NAME_LEN} caracteres.")
    return name


def _valid_uuids(raw: List[str], field: str) -> List[str]:
    """Id nao-uuid estouraria como erro de cast do Postgres (500 opaco) — 400 aqui."""
    out: List[str] = []
    for item in raw or []:
        value = str(item or "").strip()
        if not value:
            continue
        try:
            uuid.UUID(value)
        except (ValueError, AttributeError):
            raise HTTPException(status_code=400, detail=f"{field} invalido: {value[:40]}")
        if value not in out:
            out.append(value)
    return out


def _assert_folder_owner(sb, folder_id: str, actor_id: str) -> Dict[str, Any]:
    """A RLS ja esconde pasta alheia: se nao veio linha, nao e do ator."""
    res = with_postgrest_retry(
        "folders.get",
        lambda: sb.table("folders").select("id, name, parent_id").eq("id", folder_id).limit(1).execute(),
    )
    rows = res.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Pasta nao encontrada.")
    return rows[0]


def _assert_packs_accessible(pack_ids: List[str], user: Dict[str, Any]) -> None:
    """Arquivar exige ACESSO ao pack, nao posse — o convidado organiza a tela dele.

    Sem esta checagem daria para inventar um pack_id qualquer e criar um vinculo
    apontando para pack alheio: a RLS de pack_folder_members so olha user_id, que
    seria o do proprio atacante, entao ela deixaria passar.

    Uma chamada so para a lista inteira. `resolve_pack_role` resolveria um pack
    por vez — N idas ao banco para arrastar N packs de uma vez.
    """
    if not pack_ids:
        return
    try:
        sb = get_supabase_service()
        res = sb.rpc(
            "resolve_pack_access",
            {"p_pack_ids": pack_ids, "p_actor_id": str(user["user_id"])},
        ).execute()
    except Exception as e:
        logger.exception("[FOLDERS] Falha ao resolver acesso aos packs: %s", e)
        raise HTTPException(status_code=500, detail="Erro ao verificar acesso aos packs")

    allowed = {
        str(row.get("pack_id"))
        for row in (res.data or [])
        if isinstance(row, dict) and row.get("pack_id") and row.get("role")
    }
    missing = [pid for pid in pack_ids if pid not in allowed]
    if missing:
        # 403 e nao 404: quem organiza ja sabe que o pack existe (ele esta na
        # lista dele). Esconder aqui so confundiria.
        raise HTTPException(status_code=403, detail=f"Sem acesso a {len(missing)} pack(s) informado(s).")


def _members_for(sb, actor_id: str) -> List[Dict[str, Any]]:
    res = with_postgrest_retry(
        "folders.members",
        lambda: sb.table("pack_folder_members").select("pack_id, folder_id").eq("user_id", actor_id).execute(),
    )
    return res.data or []


@router.get("")
def list_folders(user=Depends(get_current_user)):
    """Pastas do ator + o vinculo pack->pasta.

    Devolve os dois juntos de proposito: a tela precisa das duas coisas para
    desenhar uma vez so, e separar em duas rotas daria um frame com as pastas
    ja na tela e todo pack ainda solto.
    """
    sb = get_supabase_for_user(user["token"])
    actor_id = str(user["user_id"])

    folders = with_postgrest_retry(
        "folders.list",
        lambda: sb.table("folders")
        .select("id, name, parent_id, position, created_at, updated_at")
        .eq("user_id", actor_id)
        .order("position")
        .order("name")
        .execute(),
    ).data or []

    members = _members_for(sb, actor_id)

    return {
        "success": True,
        "folders": folders,
        # {pack_id: folder_id} — o cliente deriva contagem e conteudo a partir
        # dos packs que a pagina ja carregou. Zero query por pasta.
        "members": {str(m["pack_id"]): str(m["folder_id"]) for m in members if m.get("pack_id") and m.get("folder_id")},
    }


@router.post("")
def create_folder(payload: FolderCreate = Body(...), user=Depends(get_current_user)):
    """Cria a pasta e, se vierem pack_ids, ja move os packs para dentro."""
    sb = get_supabase_for_user(user["token"])
    actor_id = str(user["user_id"])
    name = _clean_name(payload.name)
    pack_ids = _valid_uuids(payload.pack_ids, "pack_id")

    # Uma ida so traz a contagem (limite) e a maior posicao (pasta nova vai para
    # o FIM da lista, nao para o meio da ordem que o usuario montou).
    last = with_postgrest_retry(
        "folders.count",
        lambda: sb.table("folders")
        .select("position", count="exact")
        .eq("user_id", actor_id)
        .order("position", desc=True)
        .limit(1)
        .execute(),
    )
    count = last.count or 0
    next_position = (int((last.data or [{}])[0].get("position") or 0) + 1) if last.data else 0
    if count >= MAX_FOLDERS_PER_USER:
        raise HTTPException(status_code=422, detail=f"Limite de {MAX_FOLDERS_PER_USER} pastas atingido.")

    if pack_ids:
        _assert_packs_accessible(pack_ids, user)

    created = with_postgrest_retry(
        "folders.create",
        lambda: sb.table("folders").insert({"user_id": actor_id, "name": name, "position": next_position}).execute(),
    ).data
    if not created:
        raise HTTPException(status_code=500, detail="Erro ao criar a pasta.")
    folder = created[0]

    moved = 0
    if pack_ids:
        moved = _upsert_members(sb, actor_id, pack_ids, str(folder["id"]))

    return {"success": True, "folder": folder, "moved": moved}


@router.patch("/{folder_id}")
def rename_folder(folder_id: str, payload: FolderRename = Body(...), user=Depends(get_current_user)):
    sb = get_supabase_for_user(user["token"])
    _assert_folder_owner(sb, folder_id, str(user["user_id"]))
    name = _clean_name(payload.name)

    updated = with_postgrest_retry(
        "folders.rename",
        lambda: sb.table("folders").update({"name": name}).eq("id", folder_id).execute(),
    ).data
    if not updated:
        raise HTTPException(status_code=404, detail="Pasta nao encontrada.")
    return {"success": True, "folder": updated[0]}


@router.delete("/{folder_id}")
def delete_folder(folder_id: str, user=Depends(get_current_user)):
    """Desfaz a pasta. Os PACKS FICAM — voltam para "soltos" pela cascata da FK.

    Nenhum dado de pack e tocado aqui: o vinculo e que some.
    """
    sb = get_supabase_for_user(user["token"])
    _assert_folder_owner(sb, folder_id, str(user["user_id"]))

    with_postgrest_retry("folders.delete", lambda: sb.table("folders").delete().eq("id", folder_id).execute())
    return {"success": True, "deleted": True, "id": folder_id}


@router.post("/reorder")
def reorder_folders(payload: ReorderRequest = Body(...), user=Depends(get_current_user)):
    """Grava a ordem das pastas numa ida so (RPC reorder_folders, migration 173).

    Um UPDATE por pasta seriam N idas em serie; a RPC faz um UPDATE com a lista
    inteira e escreve so as linhas cuja posicao mudou. Id de pasta alheia e
    ignorado pela RLS e pelo filtro da propria funcao.
    """
    sb = get_supabase_for_user(user["token"])
    folder_ids = _valid_uuids(payload.folder_ids, "folder_id")
    if not folder_ids:
        raise HTTPException(status_code=422, detail="Nenhuma pasta informada.")

    changed = with_postgrest_retry(
        "folders.reorder",
        lambda: sb.rpc("reorder_folders", {"p_folder_ids": folder_ids}).execute(),
    ).data
    return {"success": True, "changed": int(changed or 0)}


def _upsert_members(sb, actor_id: str, pack_ids: List[str], folder_id: str) -> int:
    """Upsert em (user_id, pack_id) — a chave que carrega a exclusividade.

    Nunca delete + insert: duas chamadas concorrentes deixariam o pack sem pasta
    nenhuma na janela entre as duas, e a tela mostraria o pack solto por engano.
    """
    total = 0
    for i in range(0, len(pack_ids), ID_BATCH):
        chunk = pack_ids[i : i + ID_BATCH]
        rows = [{"user_id": actor_id, "pack_id": pid, "folder_id": folder_id} for pid in chunk]
        with_postgrest_retry(
            "folders.move.upsert",
            lambda rows=rows: sb.table("pack_folder_members").upsert(rows, on_conflict="user_id,pack_id").execute(),
        )
        total += len(chunk)
    return total


@router.post("/move")
def move_packs(payload: MoveRequest = Body(...), user=Depends(get_current_user)):
    """Move packs para uma pasta, ou tira da pasta quando folder_id vem nulo."""
    sb = get_supabase_for_user(user["token"])
    actor_id = str(user["user_id"])
    pack_ids = _valid_uuids(payload.pack_ids, "pack_id")
    if not pack_ids:
        raise HTTPException(status_code=422, detail="Nenhum pack informado.")

    _assert_packs_accessible(pack_ids, user)

    folder_id = (payload.folder_id or "").strip() or None
    if folder_id:
        _valid_uuids([folder_id], "folder_id")
        _assert_folder_owner(sb, folder_id, actor_id)
        moved = _upsert_members(sb, actor_id, pack_ids, folder_id)
    else:
        moved = 0
        for i in range(0, len(pack_ids), ID_BATCH):
            chunk = pack_ids[i : i + ID_BATCH]
            with_postgrest_retry(
                "folders.move.clear",
                lambda chunk=chunk: sb.table("pack_folder_members")
                .delete()
                .eq("user_id", actor_id)
                .in_("pack_id", chunk)
                .execute(),
            )
            moved += len(chunk)

    return {"success": True, "moved": moved, "folder_id": folder_id}
