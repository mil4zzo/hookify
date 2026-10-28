"""Pastas da Biblioteca de packs — /folders.

A pasta e de QUEM ORGANIZA, nao do pack (migration 168). Consequencias no codigo:

  - Na arvore do proprio ator, um convidado arquiva pack compartilhado na pasta dele
    sem tocar no pack do dono.
  - Exclusividade (um pack, uma pasta, por arvore) e da PK (user_id, pack_id). Mover
    e upsert nessa chave, nunca delete + insert — senao duas chamadas concorrentes
    deixariam o pack sem pasta nenhuma no meio do caminho.

Subpastas (migration 174): o banco garante sem ciclo e sem pai alheio (trigger),
mover e desfazer sao RPCs de uma transacao so. Os erros do trigger/RPC chegam
como P0001 com a mensagem-codigo e viram 4xx em `_folder_rpc_error`.

Pasta compartilhada (migration 181, que revisa a Decisao 3 da 168), como no Drive:
quem recebe a pasta ve A MESMA arvore do dono, e o editor mexe nela como o dono.
Por isso TODA escrita aqui passa pelas RPCs da 181 (create_folder, rename_folder,
place_folder, reorder_folders, dissolve_folder, move_packs_to_folder): elas escrevem
nas linhas do dono depois de conferir o papel, coisa que a RLS (so o proprio dono) nao
faria. Nenhum caminho por service role escreve aqui.

Qualquer gesto que muda o que mora debaixo de uma pasta compartilhada concede ou retira
acesso — quem faz isso sao os gatilhos do banco. A rota so FOTOGRAFA antes e depois
(`tracked_access_changes`): registra no feed dos packs e devolve `access_changes`
para a tela dizer o que mudou.
"""
from __future__ import annotations

import logging
import re
import uuid
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException
from postgrest.exceptions import APIError
from pydantic import BaseModel, Field

from app.core.auth import get_current_user
from app.core.supabase_client import get_supabase_for_user
from app.core.supabase_retry import with_postgrest_retry
from app.services import folder_scope
from app.routes.pack_shares import _hydrate_display_names

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/folders", tags=["folders"])

MAX_NAME_LEN = 60          # espelha o CHECK folders_name_max_len da migration 168
MAX_FOLDERS_PER_USER = 100  # espelha o teto da RPC create_folder (181), por arvore
# Teto de packs por chamada de mover: a RPC confere pack a pack num laco, e o arrasto
# real (selecao da tela) fica bem abaixo disto.
MAX_PACKS_PER_MOVE = 1000


class FolderCreate(BaseModel):
    name: str = Field(min_length=1, max_length=MAX_NAME_LEN)
    pack_ids: List[str] = Field(default_factory=list)
    # None = na raiz.
    parent_id: Optional[str] = None


class PlaceRequest(BaseModel):
    # None = raiz.
    parent_id: Optional[str] = None
    # Ordem COMPLETA do grupo de destino, ja com a pasta movida no lugar dela.
    sibling_ids: List[str] = Field(min_length=1, max_length=MAX_FOLDERS_PER_USER)


class FolderRename(BaseModel):
    name: str = Field(min_length=1, max_length=MAX_NAME_LEN)


class ReorderRequest(BaseModel):
    # Ordem COMPLETA das pastas, de cima para baixo. A posicao vira o indice.
    folder_ids: List[str] = Field(min_length=1, max_length=MAX_FOLDERS_PER_USER)


class MoveRequest(BaseModel):
    pack_ids: List[str] = Field(min_length=1, max_length=MAX_PACKS_PER_MOVE)
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


# Mensagens-codigo levantadas pelo trigger e pelas RPCs da 174 e da 181.
_FOLDER_ERRORS = {
    "folder_cycle": (422, "Uma pasta nao pode ir para dentro dela mesma."),
    "folder_parent_not_found": (404, "A pasta de destino nao existe."),
    "folder_not_found": (404, "Pasta nao encontrada."),
    "folder_not_in_siblings": (422, "Ordem invalida para a pasta movida."),
    "folder_limit": (422, f"Limite de {MAX_FOLDERS_PER_USER} pastas atingido."),
    "folder_forbidden": (403, "Esta acao e so de quem edita esta pasta."),
    "pack_move_forbidden": (
        403,
        "Algum pack nao pode ir para la. Numa pasta compartilhada com voce, so entram os packs que sao seus, "
        "e os packs do dono so saem dela para outra pasta dela.",
    ),
    "pack_owner_outside": (
        403,
        "Este pack e de quem o criou e so pode ficar em pastas que essa pessoa ve. Para tira-lo da pasta, use Tirar da pasta.",
    ),
    "not_authenticated": (401, "Sessao expirada."),
}


def _folder_rpc_error(e: Exception) -> HTTPException:
    """Erro de regra da arvore vira 4xx legivel; o resto segue como 500."""
    message = getattr(e, "message", None) or str(e)
    for code, (status, detail) in _FOLDER_ERRORS.items():
        if code in message:
            return HTTPException(status_code=status, detail=detail)
    logger.exception("[FOLDERS] Erro inesperado: %s", e)
    return HTTPException(status_code=500, detail="Erro ao salvar as pastas.")


def _rpc(sb, name: str, params: Dict[str, Any]):
    try:
        return with_postgrest_retry(f"folders.{name}", lambda: sb.rpc(name, params).execute()).data
    except APIError as e:
        raise _folder_rpc_error(e)


def _subtree_pack_ids(sb, folder_id: str) -> List[str]:
    """Packs da pasta e de todas as subpastas (na arvore do dono): os que podem mudar de
    acesso quando a pasta muda de lugar ou e desfeita. Quem nunca compartilhou nem
    recebeu pasta paga uma leitura (o atalho) e sai com lista vazia, sem varrer a arvore."""
    try:
        if not folder_scope.actor_has_folder_shares(sb):
            return []
        return folder_scope.subtree_pack_ids(folder_id)
    except Exception as e:  # leitura de apoio (so alimenta a foto): nunca derruba o gesto
        logger.warning("[FOLDERS] Nao deu para ler a subarvore de %s: %s", folder_id, e)
        return []


def _members_for(sb, actor_id: str) -> List[Dict[str, Any]]:
    res = with_postgrest_retry(
        "folders.members",
        lambda: sb.table("pack_folder_members").select("pack_id, folder_id").eq("user_id", actor_id).execute(),
    )
    return res.data or []


@router.get("")
def list_folders(user=Depends(get_current_user)):
    """Pastas do ator + as compartilhadas com ele + o vinculo pack->pasta.

    Devolve tudo junto de proposito: a tela precisa das coisas para desenhar uma vez
    so, e separar em rotas daria um frame com as pastas ja na tela e todo pack solto.
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
    folders = [{**f, "access": "dono", "owner_id": actor_id} for f in folders]

    members = {str(m["pack_id"]): str(m["folder_id"]) for m in _members_for(sb, actor_id) if m.get("pack_id") and m.get("folder_id")}

    # Pastas que outras pessoas compartilharam com o ator: a MESMA arvore do dono, a
    # partir da pasta compartilhada (que sai com parent_id nulo — a raiz do que ele ve).
    shared = with_postgrest_retry("folders.shared", lambda: sb.rpc("list_shared_folders", {}).execute()).data or {}
    shared_folders = shared.get("folders") or []
    if shared_folders:
        owners = _hydrate_display_names(sorted({str(f["owner_id"]) for f in shared_folders if f.get("owner_id")}))
        folders.extend({**f, "owner_name": owners.get(str(f.get("owner_id"))) or None} for f in shared_folders)
        # Onde o dono pos o pack vale mais que onde o ator o tinha arquivado: o pack
        # esta NA pasta compartilhada, e e la que ele aparece.
        for m in shared.get("members") or []:
            if m.get("pack_id") and m.get("folder_id"):
                members[str(m["pack_id"])] = str(m["folder_id"])

    # Quem tem cada pasta do ator: a tela precisa saber QUAL pasta esta compartilhada,
    # e com quem, para avisar antes de mover um pack para dentro dela. O nome so e
    # buscado quando ha compartilhamento (uma RPC).
    folder_shares = with_postgrest_retry(
        "folders.shares",
        lambda: sb.table("folder_shares").select("folder_id, grantee_id, role").eq("owner_id", actor_id).execute(),
    ).data or []
    direct_shares: List[Dict[str, Any]] = []
    if folder_shares:
        names = _hydrate_display_names(sorted({str(r["grantee_id"]) for r in folder_shares if r.get("grantee_id")}))
        folder_shares = [{**r, "display_name": names.get(str(r.get("grantee_id"))) or None} for r in folder_shares]
        # Acesso DIRETO dos packs do ator: a pasta o absorve ao cobrir a pessoa ("Ana tinha
        # editor neste pack; passa a valer o papel da pasta"). Sem pasta compartilhada,
        # nada a absorver — por isso so e lido aqui.
        direct_shares = with_postgrest_retry(
            "folders.direct_shares",
            lambda: sb.table("pack_shares")
            .select("pack_id, grantee_id, role")
            .eq("owner_id", actor_id)
            .is_("source_folder_id", "null")
            .execute(),
        ).data or []

    return {
        "success": True,
        "folders": folders,
        "folder_shares": folder_shares,
        "direct_shares": direct_shares,
        # {pack_id: folder_id} — o cliente deriva contagem e conteudo a partir
        # dos packs que a pagina ja carregou. Zero query por pasta.
        "members": members,
    }


@router.post("")
def create_folder(payload: FolderCreate = Body(...), user=Depends(get_current_user)):
    """Cria a pasta (na arvore de quem tem a pasta de cima) e, se vierem pack_ids, ja
    move os packs para dentro."""
    sb = get_supabase_for_user(user["token"])
    actor_id = str(user["user_id"])
    name = _clean_name(payload.name)
    pack_ids = _valid_uuids(payload.pack_ids, "pack_id")
    parent_id = (payload.parent_id or "").strip() or None
    if parent_id:
        _valid_uuids([parent_id], "parent_id")

    folder = _rpc(sb, "create_folder", {"p_name": name, "p_parent_id": parent_id})
    if not folder:
        raise HTTPException(status_code=500, detail="Erro ao criar a pasta.")

    moved = 0
    access_changes = {"granted": 0, "revoked": 0, "changed": 0}
    if pack_ids:
        try:
            with folder_scope.tracked_access_changes(sb, actor_id, pack_ids) as access_changes:
                moved = int(_rpc(sb, "move_packs_to_folder", {"p_pack_ids": pack_ids, "p_folder_id": folder["id"]}) or 0)
        except HTTPException:
            # Pasta vazia que o usuario nao pediu: desfaz antes de devolver o erro.
            try:
                _rpc(sb, "dissolve_folder", {"p_folder_id": folder["id"]})
            except HTTPException:
                logger.warning("[FOLDERS] Pasta %s ficou vazia apos falha ao mover packs", folder["id"])
            raise

    return {"success": True, "folder": folder, "moved": moved, "access_changes": access_changes}


@router.patch("/{folder_id}")
def rename_folder(folder_id: str, payload: FolderRename = Body(...), user=Depends(get_current_user)):
    sb = get_supabase_for_user(user["token"])
    _valid_uuids([folder_id], "folder_id")
    name = _clean_name(payload.name)
    folder = _rpc(sb, "rename_folder", {"p_folder_id": folder_id, "p_name": name})
    if not folder:
        raise HTTPException(status_code=404, detail="Pasta nao encontrada.")
    return {"success": True, "folder": folder}


@router.delete("/{folder_id}")
def delete_folder(folder_id: str, user=Depends(get_current_user)):
    """Desfaz a pasta. Nada e apagado alem dela: subpastas e packs SOBEM um nivel,
    no lugar que ela ocupava; na raiz, os packs ficam soltos (RPC dissolve_folder).

    Nenhum dado de pack e tocado aqui: so o vinculo muda de pasta.
    """
    sb = get_supabase_for_user(user["token"])
    _valid_uuids([folder_id], "folder_id")
    actor_id = str(user["user_id"])
    affected = _subtree_pack_ids(sb, folder_id)
    with folder_scope.tracked_access_changes(sb, actor_id, affected) as access_changes:
        result = _rpc(sb, "dissolve_folder", {"p_folder_id": folder_id}) or {}
    return {
        "access_changes": access_changes,
        "success": True,
        "deleted": True,
        "id": folder_id,
        "parent_id": result.get("parent_id"),
        "folders_moved": int(result.get("folders_moved") or 0),
        "packs_moved": int(result.get("packs_moved") or 0),
    }


@router.post("/{folder_id}/place")
def place_folder(folder_id: str, payload: PlaceRequest = Body(...), user=Depends(get_current_user)):
    """Move a pasta para outro pai (ou a raiz) e grava a ordem do grupo de destino,
    numa transacao so (RPC place_folder). Ciclo e pai alheio: barrados no banco.
    """
    sb = get_supabase_for_user(user["token"])
    _valid_uuids([folder_id], "folder_id")
    parent_id = (payload.parent_id or "").strip() or None
    if parent_id:
        _valid_uuids([parent_id], "parent_id")
    sibling_ids = _valid_uuids(payload.sibling_ids, "folder_id")
    if folder_id not in sibling_ids:
        raise HTTPException(status_code=422, detail="Ordem invalida para a pasta movida.")

    actor_id = str(user["user_id"])
    affected = _subtree_pack_ids(sb, folder_id)
    with folder_scope.tracked_access_changes(sb, actor_id, affected) as access_changes:
        changed = _rpc(
            sb, "place_folder", {"p_folder_id": folder_id, "p_parent_id": parent_id, "p_sibling_ids": sibling_ids}
        )
    return {"success": True, "changed": int(changed or 0), "parent_id": parent_id, "access_changes": access_changes}


@router.post("/reorder")
def reorder_folders(payload: ReorderRequest = Body(...), user=Depends(get_current_user)):
    """Grava a ordem das pastas numa ida so (RPC reorder_folders, migrations 173/181).

    Um UPDATE por pasta seriam N idas em serie; a RPC faz um UPDATE com a lista
    inteira e escreve so as linhas cuja posicao mudou. Pasta que o ator nao edita
    e ignorada pela propria funcao.
    """
    sb = get_supabase_for_user(user["token"])
    folder_ids = _valid_uuids(payload.folder_ids, "folder_id")
    if not folder_ids:
        raise HTTPException(status_code=422, detail="Nenhuma pasta informada.")

    changed = _rpc(sb, "reorder_folders", {"p_folder_ids": folder_ids})
    return {"success": True, "changed": int(changed or 0)}


@router.post("/move")
def move_packs(payload: MoveRequest = Body(...), user=Depends(get_current_user)):
    """Move packs para uma pasta, ou tira da pasta quando folder_id vem nulo.

    A RPC confere, pack a pack, se o ator tem acesso ao pack e o papel nas duas pontas
    (pasta de origem e de destino); um recusado recusa o lote inteiro.
    """
    sb = get_supabase_for_user(user["token"])
    actor_id = str(user["user_id"])
    pack_ids = _valid_uuids(payload.pack_ids, "pack_id")
    if not pack_ids:
        raise HTTPException(status_code=422, detail="Nenhum pack informado.")

    folder_id = (payload.folder_id or "").strip() or None
    if folder_id:
        _valid_uuids([folder_id], "folder_id")

    with folder_scope.tracked_access_changes(sb, actor_id, pack_ids) as access_changes:
        moved = int(_rpc(sb, "move_packs_to_folder", {"p_pack_ids": pack_ids, "p_folder_id": folder_id}) or 0)

    return {"success": True, "moved": moved, "folder_id": folder_id, "access_changes": access_changes}
