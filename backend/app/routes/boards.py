"""Boards — views de agrupamento de criativos por regra.

Um board e uma LENTE: guarda grupos, e cada grupo guarda uma REGRA. Quais
criativos caem em cada grupo NAO e persistido — e derivado no cliente a cada
abertura, sobre o recorte (packs + periodo) ativo no seletor global. Ver
migration 119 para o porque de nao existir tabela de membership.

O board e sempre do usuario que criou. As regras referenciam tag_id, e tag e
privada por usuario (migration 116), entao um board compartilhado mostraria
grupos vazios para o convidado. Por isso todo acesso aqui passa pelo cliente
com o JWT do usuario, deixando a RLS ser a guarda.
"""
from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.core.auth import get_current_user
from app.core.supabase_client import get_supabase_for_user
from app.core.supabase_retry import with_postgrest_retry

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/boards", tags=["boards"])

# Espelha frontend/lib/tags/colors.ts — paleta fechada sobre os tokens --chart-*.
GROUP_COLORS = {"chart1", "chart2", "chart3", "chart4", "chart5"}
DEFAULT_COLOR = "chart1"

MAX_NAME_LEN = 60           # espelha os CHECK *_name_max_len da migration 119
MAX_BOARDS_PER_USER = 30
MAX_GROUPS_PER_BOARD = 20

# Limites da arvore de regras. Ela e jsonb livre do ponto de vista do banco, e
# quem a interpreta e o cliente — sem teto, um payload grande viraria trabalho
# de parsing por linha da tabela no navegador do usuario.
MAX_CONDITIONS_PER_GROUP = 40
MAX_RULE_DEPTH = 2          # condicao solta + um nivel de subgrupo, nada alem
MAX_CONDITION_VALUE_LEN = 200
MAX_TAG_IDS_PER_CONDITION = 50

SORT_DIRECTIONS = {"asc", "desc"}


class BoardCreate(BaseModel):
    name: str = Field(min_length=1, max_length=MAX_NAME_LEN)


class BoardUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=MAX_NAME_LEN)
    position: Optional[int] = None


class BoardGroupCreate(BaseModel):
    name: str = Field(min_length=1, max_length=MAX_NAME_LEN)
    color: str = DEFAULT_COLOR
    rules: Optional[Dict[str, Any]] = None
    sort_metric: Optional[str] = None
    sort_direction: Optional[str] = None


class BoardGroupUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=MAX_NAME_LEN)
    color: Optional[str] = None
    rules: Optional[Dict[str, Any]] = None
    position: Optional[int] = None
    sort_metric: Optional[str] = None
    sort_direction: Optional[str] = None


class BoardGroupReorder(BaseModel):
    group_ids: List[str] = Field(min_length=1)


def _sb(user: Dict[str, Any]):
    return get_supabase_for_user(user["token"])


def _clean_name(raw: str) -> str:
    name = re.sub(r"\s+", " ", (raw or "").strip())
    if not name:
        raise HTTPException(status_code=422, detail="Nome nao pode ser vazio.")
    if len(name) > MAX_NAME_LEN:
        raise HTTPException(status_code=422, detail="Nome excede %d caracteres." % MAX_NAME_LEN)
    return name


def _clean_color(raw: Optional[str]) -> str:
    color = (raw or DEFAULT_COLOR).strip().lower()
    if color not in GROUP_COLORS:
        raise HTTPException(status_code=422, detail="Cor invalida: %s." % color)
    return color


def _clean_sort_direction(raw: Optional[str]) -> str:
    value = (raw or "desc").strip().lower()
    if value not in SORT_DIRECTIONS:
        raise HTTPException(status_code=422, detail="Direcao de ordenacao invalida: %s." % value)
    return value


def _clean_sort_metric(raw: Optional[str]) -> str:
    """A metrica e validada contra o registry NO CLIENTE, nao aqui.

    Duplicar MANAGER_METRIC_KEYS no backend criaria duas listas para manter em
    sincronia, e o custo de divergir cai na direcao errada: metrica nova no
    frontend deixaria de poder ser salva ate alguem lembrar do Python. O que o
    backend garante e o formato (slug curto), nao o vocabulario.
    """
    value = (raw or "spend").strip()
    if not value or len(value) > 40 or not re.fullmatch(r"[a-z0-9_]+", value):
        raise HTTPException(status_code=422, detail="Metrica de ordenacao invalida.")
    return value


def _validate_conditions(items: List[Any], depth: int) -> int:
    """Retorna quantas condicoes-folha existem na subarvore."""
    if depth > MAX_RULE_DEPTH:
        raise HTTPException(status_code=422, detail="Regras aninhadas demais.")

    leaves = 0
    for item in items:
        if not isinstance(item, dict):
            raise HTTPException(status_code=422, detail="Condicao invalida.")

        kind = item.get("type")
        if kind == "group":
            nested = item.get("conditions")
            if not isinstance(nested, list):
                raise HTTPException(status_code=422, detail="Subgrupo sem `conditions`.")
            group_logic = str(item.get("logic") or "AND").upper()
            if group_logic not in ("AND", "OR"):
                raise HTTPException(status_code=422, detail="Operador de subgrupo invalido.")
            leaves += _validate_conditions(nested, depth + 1)
            continue

        if kind != "condition":
            raise HTTPException(status_code=422, detail="Tipo de condicao invalido: %s." % kind)

        field = item.get("field")
        if not isinstance(field, str) or not field.strip():
            raise HTTPException(status_code=422, detail="Condicao sem campo.")

        value = item.get("value")
        if isinstance(value, str) and len(value) > MAX_CONDITION_VALUE_LEN:
            raise HTTPException(status_code=422, detail="Valor de condicao longo demais.")
        if isinstance(value, list):
            if len(value) > MAX_TAG_IDS_PER_CONDITION:
                raise HTTPException(
                    status_code=422,
                    detail="Condicao excede %d itens." % MAX_TAG_IDS_PER_CONDITION,
                )
            for entry in value:
                if not isinstance(entry, str) or len(entry) > MAX_CONDITION_VALUE_LEN:
                    raise HTTPException(status_code=422, detail="Item de condicao invalido.")

        leaves += 1

    return leaves


def _clean_rules(raw: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Valida a arvore {logic, conditions} sem interpretar o significado dela.

    O backend nao sabe (nem precisa saber) quais campos existem — isso vive no
    registry do frontend. O que ele impede e payload malformado ou sem teto.
    """
    if raw is None:
        return {"logic": "AND", "conditions": []}
    if not isinstance(raw, dict):
        raise HTTPException(status_code=422, detail="Regras devem ser um objeto.")

    logic = str(raw.get("logic") or "AND").upper()
    if logic not in ("AND", "OR"):
        raise HTTPException(status_code=422, detail="Operador logico invalido: %s." % logic)

    conditions = raw.get("conditions")
    if conditions is None:
        conditions = []
    if not isinstance(conditions, list):
        raise HTTPException(status_code=422, detail="`conditions` deve ser uma lista.")

    total = _validate_conditions(conditions, depth=1)
    if total > MAX_CONDITIONS_PER_GROUP:
        raise HTTPException(
            status_code=422,
            detail="Grupo excede %d condicoes." % MAX_CONDITIONS_PER_GROUP,
        )

    return {"logic": logic, "conditions": conditions}


def _serialize_group(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": row.get("id"),
        "board_id": row.get("board_id"),
        "name": row.get("name"),
        "color": row.get("color"),
        "position": row.get("position"),
        "rules": row.get("rules") or {"logic": "AND", "conditions": []},
        "sort_metric": row.get("sort_metric"),
        "sort_direction": row.get("sort_direction"),
    }


def _owned_board(sb, board_id: str) -> Dict[str, Any]:
    """Carrega o board pela RLS. 404 cobre tanto inexistente quanto de outro dono."""
    try:
        res = sb.table("boards").select("id,name,position").eq("id", board_id).limit(1).execute()
    except Exception as e:
        logger.exception("[boards] falha ao carregar %s: %s", board_id, e)
        raise HTTPException(status_code=500, detail="Erro ao carregar board.")
    rows = res.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Board nao encontrado.")
    return rows[0]


@router.get("")
def list_boards(user=Depends(get_current_user)) -> Dict[str, Any]:
    """Boards do usuario, com os grupos embutidos.

    Uma chamada so: a tela sempre precisa dos grupos junto, e a cardinalidade e
    minuscula (teto de 30 x 20 por usuario).
    """
    sb = _sb(user)
    try:
        res = with_postgrest_retry(
            "boards.list",
            lambda: sb.table("boards")
            .select(
                "id,name,position,created_at,updated_at,"
                "board_groups(id,board_id,name,color,position,rules,sort_metric,sort_direction)"
            )
            .order("position")
            .order("created_at")
            .execute(),
        )
    except Exception as e:
        logger.exception("[boards] falha ao listar: %s", e)
        raise HTTPException(status_code=500, detail="Erro ao listar boards.")

    items: List[Dict[str, Any]] = []
    for row in (res.data or []):
        groups = [_serialize_group(g) for g in (row.get("board_groups") or [])]
        # PostgREST nao ordena o embedded — a ordem dos grupos e a da UI, entao
        # ordenar aqui evita o board "embaralhar" a cada reload.
        groups.sort(key=lambda g: ((g.get("position") or 0), str(g.get("id"))))
        items.append({
            "id": row.get("id"),
            "name": row.get("name"),
            "position": row.get("position"),
            "created_at": row.get("created_at"),
            "updated_at": row.get("updated_at"),
            "groups": groups,
        })
    return {"data": items}


@router.post("", status_code=201)
def create_board(payload: BoardCreate, user=Depends(get_current_user)) -> Dict[str, Any]:
    sb = _sb(user)
    name = _clean_name(payload.name)

    try:
        existing = sb.table("boards").select("id", count="exact").execute()
    except Exception as e:
        logger.exception("[boards] falha ao contar boards: %s", e)
        raise HTTPException(status_code=500, detail="Erro ao criar board.")

    total = existing.count or 0
    if total >= MAX_BOARDS_PER_USER:
        raise HTTPException(status_code=422, detail="Limite de %d boards atingido." % MAX_BOARDS_PER_USER)

    try:
        res = with_postgrest_retry(
            "boards.create",
            lambda: sb.table("boards")
            .insert({"user_id": user["user_id"], "name": name, "position": total})
            .execute(),
        )
    except Exception as e:
        logger.exception("[boards] falha ao criar: %s", e)
        raise HTTPException(status_code=500, detail="Erro ao criar board.")

    row = (res.data or [{}])[0]
    return {"data": {**row, "groups": []}}


@router.patch("/{board_id}")
def update_board(board_id: str, payload: BoardUpdate, user=Depends(get_current_user)) -> Dict[str, Any]:
    sb = _sb(user)
    patch: Dict[str, Any] = {}
    if payload.name is not None:
        patch["name"] = _clean_name(payload.name)
    if payload.position is not None:
        patch["position"] = int(payload.position)
    if not patch:
        raise HTTPException(status_code=422, detail="Nada para atualizar.")

    try:
        res = with_postgrest_retry(
            "boards.update",
            lambda: sb.table("boards").update(patch).eq("id", board_id).execute(),
        )
    except Exception as e:
        logger.exception("[boards] falha ao atualizar %s: %s", board_id, e)
        raise HTTPException(status_code=500, detail="Erro ao atualizar board.")

    if not (res.data or []):
        raise HTTPException(status_code=404, detail="Board nao encontrado.")
    return {"data": res.data[0]}


@router.delete("/{board_id}")
def delete_board(board_id: str, user=Depends(get_current_user)) -> Dict[str, Any]:
    """Apaga o board e, por ON DELETE CASCADE, seus grupos.

    Nenhum criativo e afetado: o board nunca guardou membership, so regras.
    """
    sb = _sb(user)
    try:
        res = with_postgrest_retry(
            "boards.delete",
            lambda: sb.table("boards").delete().eq("id", board_id).execute(),
        )
    except Exception as e:
        logger.exception("[boards] falha ao apagar %s: %s", board_id, e)
        raise HTTPException(status_code=500, detail="Erro ao apagar board.")

    if not (res.data or []):
        raise HTTPException(status_code=404, detail="Board nao encontrado.")
    return {"deleted": True, "id": board_id}


@router.post("/{board_id}/groups", status_code=201)
def create_group(board_id: str, payload: BoardGroupCreate, user=Depends(get_current_user)) -> Dict[str, Any]:
    sb = _sb(user)
    _owned_board(sb, board_id)

    name = _clean_name(payload.name)
    color = _clean_color(payload.color)
    rules = _clean_rules(payload.rules)
    sort_metric = _clean_sort_metric(payload.sort_metric)
    sort_direction = _clean_sort_direction(payload.sort_direction)

    try:
        existing = sb.table("board_groups").select("id", count="exact").eq("board_id", board_id).execute()
    except Exception as e:
        logger.exception("[boards] falha ao contar grupos de %s: %s", board_id, e)
        raise HTTPException(status_code=500, detail="Erro ao criar grupo.")

    total = existing.count or 0
    if total >= MAX_GROUPS_PER_BOARD:
        raise HTTPException(
            status_code=422,
            detail="Limite de %d grupos por board atingido." % MAX_GROUPS_PER_BOARD,
        )

    try:
        res = with_postgrest_retry(
            "boards.group.create",
            lambda: sb.table("board_groups")
            .insert({
                "board_id": board_id,
                "user_id": user["user_id"],
                "name": name,
                "color": color,
                "position": total,
                "rules": rules,
                "sort_metric": sort_metric,
                "sort_direction": sort_direction,
            })
            .execute(),
        )
    except Exception as e:
        logger.exception("[boards] falha ao criar grupo em %s: %s", board_id, e)
        raise HTTPException(status_code=500, detail="Erro ao criar grupo.")

    return {"data": _serialize_group((res.data or [{}])[0])}


@router.patch("/{board_id}/groups/{group_id}")
def update_group(
    board_id: str,
    group_id: str,
    payload: BoardGroupUpdate,
    user=Depends(get_current_user),
) -> Dict[str, Any]:
    sb = _sb(user)
    patch: Dict[str, Any] = {}
    if payload.name is not None:
        patch["name"] = _clean_name(payload.name)
    if payload.color is not None:
        patch["color"] = _clean_color(payload.color)
    if payload.rules is not None:
        patch["rules"] = _clean_rules(payload.rules)
    if payload.position is not None:
        patch["position"] = int(payload.position)
    if payload.sort_metric is not None:
        patch["sort_metric"] = _clean_sort_metric(payload.sort_metric)
    if payload.sort_direction is not None:
        patch["sort_direction"] = _clean_sort_direction(payload.sort_direction)
    if not patch:
        raise HTTPException(status_code=422, detail="Nada para atualizar.")

    try:
        res = with_postgrest_retry(
            "boards.group.update",
            lambda: sb.table("board_groups")
            .update(patch)
            .eq("id", group_id)
            .eq("board_id", board_id)
            .execute(),
        )
    except Exception as e:
        logger.exception("[boards] falha ao atualizar grupo %s: %s", group_id, e)
        raise HTTPException(status_code=500, detail="Erro ao atualizar grupo.")

    if not (res.data or []):
        raise HTTPException(status_code=404, detail="Grupo nao encontrado.")
    return {"data": _serialize_group(res.data[0])}


@router.delete("/{board_id}/groups/{group_id}")
def delete_group(board_id: str, group_id: str, user=Depends(get_current_user)) -> Dict[str, Any]:
    sb = _sb(user)
    try:
        res = with_postgrest_retry(
            "boards.group.delete",
            lambda: sb.table("board_groups")
            .delete()
            .eq("id", group_id)
            .eq("board_id", board_id)
            .execute(),
        )
    except Exception as e:
        logger.exception("[boards] falha ao apagar grupo %s: %s", group_id, e)
        raise HTTPException(status_code=500, detail="Erro ao apagar grupo.")

    if not (res.data or []):
        raise HTTPException(status_code=404, detail="Grupo nao encontrado.")
    return {"deleted": True, "id": group_id}


@router.post("/{board_id}/groups/reorder")
def reorder_groups(board_id: str, payload: BoardGroupReorder, user=Depends(get_current_user)) -> Dict[str, Any]:
    """Reescreve `position` na ordem recebida.

    So aceita ids que ja pertencem ao board: sem essa checagem, mandar um id
    alheio faria o update passar batido pela RLS como no-op e a resposta mentiria
    "reordenado" sobre um grupo que nao existe aqui.
    """
    sb = _sb(user)
    _owned_board(sb, board_id)

    wanted = [str(g).strip() for g in payload.group_ids if str(g).strip()]
    if not wanted:
        raise HTTPException(status_code=422, detail="Nenhum grupo informado.")

    try:
        current = sb.table("board_groups").select("id").eq("board_id", board_id).execute()
    except Exception as e:
        logger.exception("[boards] falha ao ler grupos de %s: %s", board_id, e)
        raise HTTPException(status_code=500, detail="Erro ao reordenar grupos.")

    known = {str(r.get("id")) for r in (current.data or [])}
    unknown = [g for g in wanted if g not in known]
    if unknown:
        raise HTTPException(status_code=404, detail="Grupo nao encontrado neste board.")

    for index, group_id in enumerate(wanted):
        try:
            with_postgrest_retry(
                "boards.group.reorder[%d]" % index,
                lambda gid=group_id, pos=index: sb.table("board_groups")
                .update({"position": pos})
                .eq("id", gid)
                .eq("board_id", board_id)
                .execute(),
            )
        except Exception as e:
            logger.exception("[boards] falha ao reordenar grupo %s: %s", group_id, e)
            raise HTTPException(status_code=500, detail="Erro ao reordenar grupos.")

    return {"board_id": board_id, "group_ids": wanted}
