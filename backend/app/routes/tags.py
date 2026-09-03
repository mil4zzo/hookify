"""Tags de criativo.

A tag e do CRIATIVO (ad_name), nunca do anuncio (ad_id): o Manager agrupa por
nome e o fan-out medido e de ~34 ad_ids por nome. Marcar por ad_id faria a tag
faltar nas outras 33 linhas do mesmo criativo. Ver migration 116.

A tag e do SILO DO PACK, nao de quem olha (migration 139). Num pack compartilhado
qualquer editor marca e todos veem a mesma coisa — que e como a transcricao ja
funcionava. Consequencias no codigo:

  - `user_id` em tags/ad_tags e o DONO do pack, nao o ator.
  - `ad_tags.created_by` guarda o ator: num pack compartilhado sao pessoas
    diferentes, e este e o unico registro dessa autoria.
  - Escrita em silo alheio nao passa por RLS (a policy e user_id = auth.uid()),
    entao vai por service role — depois de o papel ser conferido aqui. Mesmo
    padrao da reconexao do Google em pack compartilhado.
  - Viewer LE o vocabulario (senao o filtro abre vazio para ele) e nao escreve.
"""
from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, Optional, Sequence, Set

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.core.auth import get_current_user
from app.core.supabase_client import get_supabase_for_user, get_supabase_service
from app.core.supabase_retry import with_postgrest_retry
from app.services.pack_access import resolve_entity_pack_scope, resolve_pack_silo

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/tags", tags=["tags"])

# Paleta fechada, sobre os tokens --chart-* do design system (paleta categorica,
# tema-aware). Espelhada em frontend/lib/tags/colors.ts — mudar aqui exige mudar
# la, senao a cor volta do banco sem classe correspondente na UI.
TAG_COLORS = {"chart1", "chart2", "chart3", "chart4", "chart5"}
DEFAULT_COLOR = "chart1"

MAX_NAME_LEN = 40          # espelha o CHECK tags_name_max_len da migration 116
MAX_TAGS_PER_USER = 200
MAX_AD_NAMES_PER_CALL = 5000

READ_ROLES = ("dono", "editor", "viewer")
WRITE_ROLES = ("dono", "editor")

# ad_name e texto livre e longo (~38 bytes de media, cauda bem maior). PostgREST
# monta o .in_() na URL, entao lote grande estoura o limite de tamanho — mesmo
# problema que ja mordeu com ad_id. 100 nomes deixa margem confortavel.
DELETE_BATCH = 100
UPSERT_BATCH = 500


class TagCreate(BaseModel):
    name: str = Field(min_length=1, max_length=MAX_NAME_LEN)
    color: str = DEFAULT_COLOR
    pack_ids: List[str] = Field(default_factory=list)


class TagUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=MAX_NAME_LEN)
    color: Optional[str] = None
    pack_ids: List[str] = Field(default_factory=list)


class TagAssignment(BaseModel):
    tag_ids: List[str] = Field(min_length=1)
    ad_names: List[str] = Field(min_length=1)
    pack_ids: List[str] = Field(default_factory=list)


def _clean_name(raw: str) -> str:
    name = re.sub(r"\s+", " ", (raw or "").strip())
    if not name:
        raise HTTPException(status_code=422, detail="Nome da tag nao pode ser vazio.")
    if len(name) > MAX_NAME_LEN:
        raise HTTPException(status_code=422, detail="Nome da tag excede %d caracteres." % MAX_NAME_LEN)
    return name


def _clean_color(raw: Optional[str]) -> str:
    color = (raw or DEFAULT_COLOR).strip().lower()
    if color not in TAG_COLORS:
        raise HTTPException(status_code=422, detail="Cor invalida: %s." % color)
    return color


def _clean_ad_names(raw: Sequence[str]) -> List[str]:
    """Dedup preservando ordem. Nome em branco e descartado (CHECK do banco)."""
    seen: Set[str] = set()
    out: List[str] = []
    for value in raw:
        name = (value or "").strip()
        if not name or name in seen:
            continue
        seen.add(name)
        out.append(name)
    if not out:
        raise HTTPException(status_code=422, detail="Nenhum criativo valido na selecao.")
    if len(out) > MAX_AD_NAMES_PER_CALL:
        raise HTTPException(
            status_code=422,
            detail="Selecao excede %d criativos por chamada." % MAX_AD_NAMES_PER_CALL,
        )
    return out


def _is_unique_violation(exc: Exception) -> bool:
    text = str(exc)
    return "23505" in text or "duplicate key" in text.lower()


def _client_for(user: Dict[str, Any], is_guest: bool):
    """Service role SO quando o silo e alheio.

    No silo do proprio ator o cliente com JWT mantem a RLS como defesa em
    profundidade; trocar tudo por service role apagaria essa rede sem ganho.
    """
    return get_supabase_service() if is_guest else get_supabase_for_user(user["token"])


def _valid_tag_ids(sb, raw: Sequence[str], owner_id: str) -> List[str]:
    """So aceita tags que existem NO SILO alvo.

    Sem isto um tag_id de outro silo entraria no insert: a RLS de ad_tags olha o
    user_id da LINHA, nao o dono da tag que a FK aponta — e com service role nem
    RLS existe.
    """
    wanted = sorted({str(t).strip() for t in raw if str(t).strip()})
    if not wanted:
        raise HTTPException(status_code=422, detail="Nenhuma tag informada.")
    try:
        res = sb.table("tags").select("id").eq("user_id", owner_id).in_("id", wanted).execute()
    except Exception as e:
        logger.exception("[tags] falha ao validar tag_ids: %s", e)
        raise HTTPException(status_code=500, detail="Erro ao validar tags.")

    found = [str(r.get("id")) for r in (res.data or [])]
    if len(found) != len(wanted):
        raise HTTPException(status_code=404, detail="Tag nao encontrada.")
    return found


@router.get("")
def list_tags(
    pack_ids: List[str] = Query(default_factory=list),
    user=Depends(get_current_user),
) -> Dict[str, Any]:
    """Vocabulario do SILO + quantos criativos cada tag marca.

    Viewer entra aqui: sem a lista, o filtro por tag abriria vazio para quem so
    tem leitura, embora as tags apareçam nas linhas.
    """
    silo = resolve_pack_silo(user["user_id"], pack_ids, roles=READ_ROLES)
    sb = _client_for(user, silo.is_guest)
    try:
        res = with_postgrest_retry(
            "tags.list",
            lambda: sb.table("tags")
            .select("id,name,slug,color,created_at,ad_tags(count)")
            .eq("user_id", silo.owner_id)
            .order("name")
            .execute(),
        )
    except Exception as e:
        logger.exception("[tags] falha ao listar: %s", e)
        raise HTTPException(status_code=500, detail="Erro ao listar tags.")

    items: List[Dict[str, Any]] = []
    for row in (res.data or []):
        # PostgREST devolve o agregado embutido como [{"count": N}] (ou [] sem uso).
        embedded = row.get("ad_tags") or []
        usage = 0
        if isinstance(embedded, list) and embedded:
            usage = int(embedded[0].get("count") or 0)
        elif isinstance(embedded, dict):
            usage = int(embedded.get("count") or 0)
        items.append({
            "id": row.get("id"),
            "name": row.get("name"),
            "slug": row.get("slug"),
            "color": row.get("color"),
            "created_at": row.get("created_at"),
            "usage_count": usage,
        })
    return {"data": items, "owner_id": silo.owner_id, "role": silo.role}


@router.post("", status_code=201)
def create_tag(payload: TagCreate, user=Depends(get_current_user)) -> Dict[str, Any]:
    silo = resolve_pack_silo(user["user_id"], payload.pack_ids, roles=WRITE_ROLES)
    sb = _client_for(user, silo.is_guest)
    name = _clean_name(payload.name)
    color = _clean_color(payload.color)

    try:
        existing = sb.table("tags").select("id", count="exact").eq("user_id", silo.owner_id).limit(1).execute()
        if (existing.count or 0) >= MAX_TAGS_PER_USER:
            raise HTTPException(
                status_code=422,
                detail="Limite de %d tags atingido." % MAX_TAGS_PER_USER,
            )
    except HTTPException:
        raise
    except Exception as e:
        logger.warning("[tags] falha ao contar tags (seguindo): %s", e)

    try:
        res = with_postgrest_retry(
            "tags.create",
            lambda: sb.table("tags")
            .insert({"user_id": silo.owner_id, "name": name, "color": color})
            .execute(),
        )
    except Exception as e:
        if _is_unique_violation(e):
            # O slug e gerado no banco: 'Black Friday' e 'black  friday' colidem.
            raise HTTPException(status_code=409, detail="Ja existe uma tag com esse nome.")
        logger.exception("[tags] falha ao criar: %s", e)
        raise HTTPException(status_code=500, detail="Erro ao criar tag.")

    row = (res.data or [{}])[0]
    return {"data": {**row, "usage_count": 0}}


@router.patch("/{tag_id}")
def update_tag(tag_id: str, payload: TagUpdate, user=Depends(get_current_user)) -> Dict[str, Any]:
    """Renomear preserva o id — as marcacoes existentes nao sao tocadas."""
    silo = resolve_pack_silo(user["user_id"], payload.pack_ids, roles=WRITE_ROLES)
    sb = _client_for(user, silo.is_guest)
    patch: Dict[str, Any] = {}
    if payload.name is not None:
        patch["name"] = _clean_name(payload.name)
    if payload.color is not None:
        patch["color"] = _clean_color(payload.color)
    if not patch:
        raise HTTPException(status_code=422, detail="Nada para atualizar.")

    try:
        res = with_postgrest_retry(
            "tags.update",
            lambda: sb.table("tags")
            .update(patch)
            .eq("id", tag_id)
            .eq("user_id", silo.owner_id)
            .execute(),
        )
    except Exception as e:
        if _is_unique_violation(e):
            raise HTTPException(status_code=409, detail="Ja existe uma tag com esse nome.")
        logger.exception("[tags] falha ao atualizar %s: %s", tag_id, e)
        raise HTTPException(status_code=500, detail="Erro ao atualizar tag.")

    if not (res.data or []):
        raise HTTPException(status_code=404, detail="Tag nao encontrada.")
    return {"data": res.data[0]}


@router.delete("/{tag_id}")
def delete_tag(
    tag_id: str,
    pack_ids: List[str] = Query(default_factory=list),
    user=Depends(get_current_user),
) -> Dict[str, Any]:
    """Apaga a tag e, por ON DELETE CASCADE, todas as suas marcacoes."""
    silo = resolve_pack_silo(user["user_id"], pack_ids, roles=WRITE_ROLES)
    sb = _client_for(user, silo.is_guest)
    try:
        res = with_postgrest_retry(
            "tags.delete",
            lambda: sb.table("tags")
            .delete()
            .eq("id", tag_id)
            .eq("user_id", silo.owner_id)
            .execute(),
        )
    except Exception as e:
        logger.exception("[tags] falha ao apagar %s: %s", tag_id, e)
        raise HTTPException(status_code=500, detail="Erro ao apagar tag.")

    if not (res.data or []):
        raise HTTPException(status_code=404, detail="Tag nao encontrada.")
    return {"deleted": True, "id": tag_id}


def _resolve_marking_scope(user: Dict[str, Any], ad_names: List[str], pack_ids: List[str]):
    """Silo + criativos autorizados para marcar/desmarcar.

    Ancora em resolve_entity_pack_scope("adname"): ele confere o papel no pack E
    que os nomes realmente pertencem aquele pack dentro do silo do dono. Um
    pack_id forjado nao passa no primeiro; um ad_name alheio nao passa no segundo.
    Dois donos distintos na selecao -> 409 vindo de la.

    Sem contexto de pack ele devolve None; ai a operacao e no silo do proprio ator.
    """
    scope = resolve_entity_pack_scope(
        actor_id=str(user["user_id"]),
        entity_type="adname",
        entity_ids=ad_names,
        pack_ids=pack_ids,
        roles=WRITE_ROLES,
    )
    if scope is None:
        return str(user["user_id"]), False, ad_names
    return scope.owner_id, scope.is_guest, list(scope.allowed_ids)


@router.post("/assign")
def assign_tags(payload: TagAssignment, user=Depends(get_current_user)) -> Dict[str, Any]:
    """Aplica N tags a M criativos. Idempotente: reaplicar nao duplica nem falha."""
    requested = _clean_ad_names(payload.ad_names)
    owner_id, is_guest, ad_names = _resolve_marking_scope(user, requested, payload.pack_ids)
    if not ad_names:
        raise HTTPException(status_code=404, detail="Nenhum criativo da selecao pertence ao pack.")

    sb = _client_for(user, is_guest)
    tag_ids = _valid_tag_ids(sb, payload.tag_ids, owner_id)

    rows = [
        {
            "user_id": owner_id,          # silo (dono do pack)
            "tag_id": tag_id,
            "ad_name": ad_name,
            "created_by": str(user["user_id"]),  # ator: a autoria que o silo perde
        }
        for tag_id in tag_ids
        for ad_name in ad_names
    ]

    for i in range(0, len(rows), UPSERT_BATCH):
        batch = rows[i : i + UPSERT_BATCH]
        try:
            with_postgrest_retry(
                "tags.assign[%d]" % i,
                lambda b=batch: sb.table("ad_tags")
                .upsert(b, on_conflict="user_id,tag_id,ad_name", ignore_duplicates=True)
                .execute(),
            )
        except Exception as e:
            logger.exception("[tags] falha ao marcar lote %s: %s", i, e)
            raise HTTPException(status_code=500, detail="Erro ao aplicar tags.")

    return {"tag_ids": tag_ids, "ad_names": len(ad_names), "pairs": len(rows), "owner_id": owner_id}


@router.post("/unassign")
def unassign_tags(payload: TagAssignment, user=Depends(get_current_user)) -> Dict[str, Any]:
    requested = _clean_ad_names(payload.ad_names)
    owner_id, is_guest, ad_names = _resolve_marking_scope(user, requested, payload.pack_ids)
    if not ad_names:
        raise HTTPException(status_code=404, detail="Nenhum criativo da selecao pertence ao pack.")

    sb = _client_for(user, is_guest)
    tag_ids = _valid_tag_ids(sb, payload.tag_ids, owner_id)

    removed = 0
    for i in range(0, len(ad_names), DELETE_BATCH):
        batch = ad_names[i : i + DELETE_BATCH]
        try:
            res = with_postgrest_retry(
                "tags.unassign[%d]" % i,
                lambda b=batch: sb.table("ad_tags")
                .delete()
                .eq("user_id", owner_id)
                .in_("tag_id", tag_ids)
                .in_("ad_name", b)
                .execute(),
            )
            removed += len(res.data or [])
        except Exception as e:
            logger.exception("[tags] falha ao desmarcar lote %s: %s", i, e)
            raise HTTPException(status_code=500, detail="Erro ao remover tags.")

    return {"tag_ids": tag_ids, "ad_names": len(ad_names), "removed": removed, "owner_id": owner_id}
