"""Registro de autoria de acoes num pack (P3.5).

POR QUE EXISTE. Num pack compartilhado a credencial e SEMPRE do dono. Quando o
convidado pausa um anuncio, o log do Gerenciador de Anuncios da Meta mostra o
DONO — a Meta nao tem como saber que houve um segundo humano. Esta tabela e o
unico lugar do mundo que sabe quem realmente agiu.

ONDE CHAMAR. Depois do efeito, nunca antes. Era tentador pendurar o registro em
`assert_pack_role` / `resolve_entity_pack_scope`, que ja rodam antes de toda
escrita — mas aqueles sao AUTORIZACAO: rodam antes de a acao acontecer, e o de
midia roda em leitura tambem. Logar la registraria tentativa, nao resultado.
Por isso o registro e explicito em cada rota, com `status` ok|error|partial.

COMO FALHA. Fire-and-forget, no espirito do `meta_usage_logger`: o insert vai
para uma thread e uma falha ao gravar NUNCA derruba a acao do usuario. Um log
perdido e ruim; um anuncio que nao pausa porque o log caiu e pior.

SEM CONTEXTO DE PACK NAO HA REGISTRO. `pack_ids` e obrigatorio (a tabela exige
>= 1) porque o feed e lido por pack — uma linha sem pack nao teria onde aparecer.
Na pratica o contexto sempre chega: o Manager so opera com packs selecionados.
Quando nao chega, isto emite WARNING em vez de inventar um pack.
"""
from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from typing import Any, Dict, Iterator, List, Optional, Sequence

from fastapi import HTTPException

from app.core.request_context import get_current_route

logger = logging.getLogger(__name__)

# Pool pequeno: o volume e de acoes humanas (dezenas por dia), nao de chamadas
# de API. Dedicado para nao competir com o pool do meta_usage_logger.
_persist_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="pack-action-log")

# Bulk grande guarda AMOSTRA + contagem real. Guardar 5000 ids incharia a linha
# sem responder nada que `target_count` ja nao responda.
_MAX_TARGET_IDS = 200
_MAX_ERROR_CHARS = 300


# ── Vocabulario canonico ────────────────────────────────────────────────────
# Fechado de proposito: a UI traduz verbo -> texto em portugues, e um verbo
# inventado numa rota nova apareceria como cru na tela. `_KNOWN_ACTIONS` existe
# para o teste pegar isso, nao para bloquear em runtime.

# Efeito EXTERNO (chegam na Meta / gastam credencial do dono) — o nucleo da P3.5
ACTION_AD_STATUS = "ad.status"
ACTION_ADSET_STATUS = "adset.status"
ACTION_CAMPAIGN_STATUS = "campaign.status"
ACTION_ADSET_BUDGET = "adset.budget"
ACTION_CAMPAIGN_BUDGET = "campaign.budget"
ACTION_PACK_REFRESH = "pack.refresh"
ACTION_PACK_TRANSCRIBE = "pack.transcribe"
ACTION_PACK_SHEET_SYNC = "pack.sheet_sync"
ACTION_PACK_SHEET_RELINK = "pack.sheet_relink"
ACTION_JOB_CANCEL = "job.cancel"
# NAO existe verbo para o status-sync on-focus: ele reconcilia o cache local com
# a verdade da Meta, nao muda nada la fora, e dispara a cada troca de aba. Seria
# a linha mais frequente do feed e a menos informativa.

# Configuracao do pack
ACTION_PACK_JUDGMENT = "pack.judgment"
ACTION_PACK_AUTO_REFRESH = "pack.auto_refresh"
ACTION_PACK_RENAME = "pack.rename"
ACTION_PACK_DELETE = "pack.delete"
# 140: vínculo de coluna da planilha editado/excluído (rótulo, corte de MQL, ordem).
# Muda o que o time inteiro lê numa coluna do Manager, como o julgamento.
ACTION_PACK_SHEET_COLUMNS = "pack.sheet_columns"

# Compartilhamento
ACTION_SHARE_GRANT = "share.grant"
ACTION_SHARE_ROLE = "share.role"
ACTION_SHARE_REVOKE = "share.revoke"
ACTION_SHARE_LEAVE = "share.leave"

_KNOWN_ACTIONS = frozenset({
    ACTION_AD_STATUS, ACTION_ADSET_STATUS, ACTION_CAMPAIGN_STATUS,
    ACTION_ADSET_BUDGET, ACTION_CAMPAIGN_BUDGET,
    ACTION_PACK_REFRESH, ACTION_PACK_TRANSCRIBE,
    ACTION_PACK_SHEET_SYNC, ACTION_PACK_SHEET_RELINK, ACTION_JOB_CANCEL,
    ACTION_PACK_JUDGMENT, ACTION_PACK_AUTO_REFRESH,
    ACTION_PACK_RENAME, ACTION_PACK_DELETE, ACTION_PACK_SHEET_COLUMNS,
    ACTION_SHARE_GRANT, ACTION_SHARE_ROLE, ACTION_SHARE_REVOKE, ACTION_SHARE_LEAVE,
})


def _clean_ids(values: Optional[Sequence[Any]]) -> List[str]:
    return [str(v).strip() for v in (values or []) if str(v or "").strip()]


def build_row(
    *,
    action: str,
    actor_id: str,
    actor_role: str,
    owner_id: str,
    pack_ids: Sequence[str],
    target_type: Optional[str] = None,
    target_ids: Optional[Sequence[str]] = None,
    target_count: Optional[int] = None,
    detail: Optional[Dict[str, Any]] = None,
    status: str = "ok",
    error: Optional[str] = None,
    pack_name: Optional[str] = None,
    route: Optional[str] = None,
) -> Dict[str, Any]:
    """Monta a linha. Separado do insert para o teste poder verificar a forma."""
    ids = _clean_ids(target_ids)
    packs = _clean_ids(pack_ids)
    return {
        "action": str(action),
        "actor_id": str(actor_id),
        "actor_role": str(actor_role),
        "owner_id": str(owner_id),
        "pack_ids": packs,
        "pack_name": pack_name,
        "target_type": target_type,
        "target_ids": ids[:_MAX_TARGET_IDS],
        "target_count": int(target_count if target_count is not None else len(ids)),
        "detail": detail or None,
        "status": status,
        "error": (str(error)[:_MAX_ERROR_CHARS] if error else None),
        "route": route,
    }


def _persist(row: Dict[str, Any]) -> None:
    """Insert numa thread do pool. Toda falha morre aqui."""
    try:
        from app.core.supabase_client import get_supabase_service

        get_supabase_service().table("pack_action_log").insert(row).execute()
    except Exception as e:
        # WARNING e nao exception: o rastro se perdeu, mas a acao do usuario ja
        # aconteceu e nao ha nada a desfazer.
        logger.warning("[ACTION_LOG] falha ao registrar %s: %s", row.get("action"), e)


def log_pack_action(
    *,
    action: str,
    actor_id: str,
    actor_role: str,
    owner_id: str,
    pack_ids: Optional[Sequence[str]],
    target_type: Optional[str] = None,
    target_ids: Optional[Sequence[str]] = None,
    target_count: Optional[int] = None,
    detail: Optional[Dict[str, Any]] = None,
    status: str = "ok",
    error: Optional[str] = None,
    pack_name: Optional[str] = None,
) -> None:
    """Registra uma acao. Nunca levanta — chamador nao precisa de try/except."""
    try:
        packs = _clean_ids(pack_ids)
        if not packs or not actor_id or not owner_id:
            logger.warning(
                "[ACTION_LOG] %s sem contexto de pack (packs=%s, ator=%s) — nao registrado",
                action, len(packs), str(actor_id or "")[:8],
            )
            return

        row = build_row(
            action=action, actor_id=actor_id, actor_role=actor_role, owner_id=owner_id,
            pack_ids=packs, target_type=target_type, target_ids=target_ids,
            target_count=target_count, detail=detail, status=status, error=error,
            pack_name=pack_name,
            # Contextvar lida AQUI, na thread do request: a thread do pool nasce
            # com contexto vazio e enxergaria None (licao do meta_usage_logger).
            route=get_current_route(),
        )
        _persist_pool.submit(_persist, row)
    except Exception as e:
        logger.warning("[ACTION_LOG] falha ao preparar registro de %s: %s", action, e)


def _http_error_text(exc: HTTPException) -> str:
    """Texto curto de um HTTPException, que pode ter detail dict ou string."""
    detail = exc.detail
    if isinstance(detail, dict):
        return str(detail.get("message") or detail.get("error") or detail)
    return str(detail)


@contextmanager
def record_action(
    *,
    action: str,
    actor_id: str,
    actor_role: str,
    owner_id: str,
    pack_ids: Optional[Sequence[str]],
    target_type: Optional[str] = None,
    target_ids: Optional[Sequence[str]] = None,
    target_count: Optional[int] = None,
    detail: Optional[Dict[str, Any]] = None,
    pack_name: Optional[str] = None,
) -> Iterator[Dict[str, Any]]:
    """Envolve a acao e registra o DESFECHO — sucesso ou falha.

    A falha entra no log de proposito: "o convidado tentou pausar e a Meta
    recusou" e exatamente o tipo de pergunta que chega no suporte, e sem registro
    nao ha como responder.

    Cede um dict mutavel para o que so se sabe DEPOIS da acao (o valor anterior
    de um budget, quantos itens de um lote deram certo). O que for escrito nele
    e mesclado em `detail`; a chave `status` sobrescreve o desfecho (para o caso
    'partial', que nao levanta excecao).
    """
    extra: Dict[str, Any] = {}
    base = dict(detail or {})

    def _emit(status: str, error: Optional[str]) -> None:
        merged = {**base, **{k: v for k, v in extra.items() if k != "status"}}
        log_pack_action(
            action=action, actor_id=actor_id, actor_role=actor_role, owner_id=owner_id,
            pack_ids=pack_ids, target_type=target_type,
            target_ids=(extra.get("target_ids") or target_ids),
            target_count=(extra.get("target_count") if extra.get("target_count") is not None else target_count),
            detail=(merged or None), status=status, error=error, pack_name=pack_name,
        )

    try:
        yield extra
    except HTTPException as e:
        _emit("error", _http_error_text(e))
        raise
    except Exception as e:
        _emit("error", str(e))
        raise
    else:
        _emit(str(extra.get("status") or "ok"), extra.get("error"))
