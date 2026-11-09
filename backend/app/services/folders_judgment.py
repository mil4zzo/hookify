"""Critério de julgamento guardado na pasta (migration 185) e herdado pelo pack que entra.

O documento da pasta tem a forma do corpo do `POST /analytics/packs/bulk-judgment`
(sem `pack_ids`) e só guarda o que DEFINE valor: limpar um campo na pasta tira a chave,
não grava null — "limpar" não se propaga a pack novo.

A leitura/escrita passa pelas RPCs `resolve_folder_judgment` / `set_folder_judgment`
(papel conferido no banco), nunca por service role: a convenção de /folders é que a
árvore só é escrita por quem tem papel nela.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from postgrest.exceptions import APIError

from app.core.supabase_client import get_supabase_for_user
from app.core.supabase_retry import with_postgrest_retry

logger = logging.getLogger(__name__)

_FIELDS = ("mql_leadscore_min", "target_cpr", "lead_economics")


def merge_folder_judgment(stored: Optional[Dict[str, Any]], fields: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Funde o que a ação em massa pediu (`fields`, já validado) no documento da pasta.

    Valor define; null (ou evento null em `target_cpr`) remove a chave. Devolve None
    quando não sobra nada (a pasta deixa de definir critério).
    """
    out: Dict[str, Any] = {k: v for k, v in (stored or {}).items() if k in _FIELDS and v is not None}
    for key in _FIELDS:
        if key not in fields:
            continue
        value = fields[key]
        if key == "target_cpr" and isinstance(value, dict):
            targets = {k: v for k, v in (out.get("target_cpr") or {}).items()}
            for event, cutoff in value.items():
                if cutoff is None:
                    targets.pop(event, None)
                else:
                    targets[event] = cutoff
            value = targets or None
        if value is None:
            out.pop(key, None)
        else:
            out[key] = value
    return out or None


def _rpc(sb, name: str, params: Dict[str, Any]):
    return with_postgrest_retry(f"folders_judgment.{name}", lambda: sb.rpc(name, params).execute()).data


def _rpc_or_http(sb, name: str, params: Dict[str, Any]):
    """RPC das pastas com os erros de regra traduzidos em 4xx (o resto sobe)."""
    from fastapi import HTTPException

    try:
        return _rpc(sb, name, params)
    except APIError as e:
        message = getattr(e, "message", None) or str(e)
        if "folder_forbidden" in message:
            raise HTTPException(status_code=403, detail="Esta acao e so de quem edita esta pasta.")
        if "folder_not_found" in message:
            raise HTTPException(status_code=404, detail="Pasta nao encontrada.")
        if "folder_judgment_governed" in message:
            raise HTTPException(status_code=409, detail=governed_message(None))
        raise


def save_folder_judgment(token: str, folder_id: str, fields: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Guarda na pasta o que a ação em massa aplicou. Quem não edita a pasta recebe 403/404 da RPC."""
    sb = get_supabase_for_user(token)
    current = _rpc_or_http(sb, "resolve_folder_judgment", {"p_folder_id": folder_id, "p_own_only": True})
    merged = merge_folder_judgment(current, fields)
    _rpc_or_http(sb, "set_folder_judgment", {"p_folder_id": folder_id, "p_judgment": merged})
    return merged


def own_folder_judgment(token: str, folder_id: str) -> Optional[Dict[str, Any]]:
    """O critério guardado NA pasta (sem subir): é o que a tela de edição da pasta mostra."""
    return _rpc_or_http(get_supabase_for_user(token), "resolve_folder_judgment", {"p_folder_id": folder_id, "p_own_only": True})


# ── Dono único do critério (migrations 186/187) ─────────────────────────────────
# Se uma pasta (ou ancestral) define critério, nada abaixo dela o edita. O que trava são
# SÓ os campos que a pasta define (no CPR alvo, só os eventos dela): o resto continua do
# pack. Quem manda num pack é a pasta onde o DONO o colocou — o arquivamento de quem
# recebeu o pack compartilhado nunca governa (migration 187).

def governed_message(folder_name: Optional[str]) -> str:
    where = f"pela pasta “{folder_name}”" if folder_name else "por uma pasta acima"
    return f"Este critério é definido {where}. Para mudar, edite o critério dessa pasta."


def pack_governors(token: str, pack_ids: List[str]) -> Dict[str, Dict[str, Any]]:
    """{pack_id: {"folder_name": str | None, "judgment": {...}}} só para os packs governados.

    O nome é None quando a pasta é de outra pessoa e o ator não a enxerga. Falha de leitura
    NÃO bloqueia (devolve {} e registra): a tela já trava os campos, e barrar toda edição
    por uma RPC fora do ar seria pior que deixar passar.
    """
    if not pack_ids:
        return {}
    try:
        rows = _rpc(get_supabase_for_user(token), "pack_judgment_governors", {"p_pack_ids": pack_ids}) or []
        return {
            str(r["pack_id"]): {"folder_name": r.get("folder_name"), "judgment": r.get("judgment") or {}}
            for r in rows if r.get("folder_id")
        }
    except Exception:
        logger.exception("[FOLDERS_JUDGMENT] Nao deu para ler quem governa o criterio dos packs")
        return {}


def _same_number(a: Any, b: Any) -> bool:
    if a is None or b is None:
        return a is None and b is None
    try:
        return abs(float(a) - float(b)) < 1e-9
    except (TypeError, ValueError):
        return False


def locked_field_changed(fields: Dict[str, Any], judgment: Dict[str, Any]) -> bool:
    """PATCH de UM pack: muda algum campo travado pela pasta? (`target_cpr` é o mapa inteiro.)

    Mandar o mesmo valor da pasta é permitido — a tela do pack manda o formulário todo.
    """
    if "mql_leadscore_min" in judgment and "mql_leadscore_min" in fields:
        if not _same_number(fields["mql_leadscore_min"], judgment["mql_leadscore_min"]):
            return True
    if "lead_economics" in judgment and "lead_economics" in fields:
        if fields["lead_economics"] != judgment["lead_economics"]:
            return True
    locked_events = judgment.get("target_cpr") or {}
    if locked_events and "target_cpr" in fields:
        sent = fields["target_cpr"] or {}
        if any(not _same_number(sent.get(ev), val) for ev, val in locked_events.items()):
            return True
    return False


def strip_locked_fields(fields: Dict[str, Any], judgment: Dict[str, Any]) -> Dict[str, Any]:
    """Ação em massa por seleção: o que sobra do pedido para um pack governado.

    Campos que a pasta define saem; no CPR alvo (patch por evento) saem só os eventos dela.
    `target_cpr: null` (limpar todas as metas) também sai quando a pasta define algum evento:
    limpar apagaria a meta travada.
    """
    out = {k: v for k, v in fields.items() if k not in judgment or k == "target_cpr"}
    locked_events = judgment.get("target_cpr") or {}
    if "target_cpr" in out and locked_events:
        if out["target_cpr"] is None:
            out.pop("target_cpr")
        else:
            rest = {ev: v for ev, v in out["target_cpr"].items() if ev not in locked_events}
            if rest:
                out["target_cpr"] = rest
            else:
                out.pop("target_cpr")
    return out


def folder_governor(token: str, folder_id: str) -> Optional[Dict[str, Any]]:
    """O ANCESTRAL (nunca a própria pasta) que já define critério, ou None."""
    rows = _rpc(get_supabase_for_user(token), "folder_judgment_governor", {"p_folder_id": folder_id, "p_strict": True}) or []
    return rows[0] if rows else None


def folder_governed_pack_ids(token: str, folder_id: str) -> List[str]:
    """Packs que a pasta governa (colocação do dono, na subárvore). 403/404 se o ator não
    edita a pasta — chamado ANTES de gravar qualquer pack."""
    rows = _rpc_or_http(get_supabase_for_user(token), "folder_governed_pack_ids", {"p_folder_id": folder_id}) or []
    return [str(r) for r in rows]


def move_conflicts(token: str, pack_ids: List[str], folder_id: str) -> List[str]:
    """Packs compartilhados com o ator que não podem entrar nesta pasta: ela (ou acima) tem critério."""
    rows = _rpc(get_supabase_for_user(token), "judgment_move_conflicts", {"p_pack_ids": pack_ids, "p_folder_id": folder_id}) or []
    return [str(r) for r in rows]


def reconcile_on_place(user: Dict[str, Any], folder_id: str) -> Optional[List[Dict[str, Any]]]:
    """Pasta arrastada para dentro de outra que já manda: perde o critério próprio (banco) e os
    packs da subárvore herdam o da nova mãe. Nunca levanta: a pasta já foi movida."""
    try:
        sb = get_supabase_for_user(user["token"])
        governor = _rpc(sb, "reconcile_folder_judgment_on_place", {"p_folder_id": folder_id})
        if not governor:
            return None
        pack_ids = folder_governed_pack_ids(user["token"], folder_id)
        return inherit_folder_judgment(user, folder_id, pack_ids) if pack_ids else None
    except Exception:
        logger.exception("[FOLDERS_JUDGMENT] Pasta %s movida, mas a reconciliacao do criterio falhou", folder_id)
        return None


def folders_with_judgment(token: str, folder_ids: List[str]) -> set:
    """Quais dessas pastas definem critério (a tela deriva o resto subindo pela árvore)."""
    if not folder_ids:
        return set()
    try:
        return {str(x) for x in (_rpc(get_supabase_for_user(token), "folders_with_judgment", {"p_folder_ids": folder_ids}) or [])}
    except Exception:
        logger.exception("[FOLDERS_JUDGMENT] Nao deu para ler quais pastas definem criterio")
        return set()


def inherit_folder_judgment(user: Dict[str, Any], folder_id: str, pack_ids: List[str]) -> Optional[List[Dict[str, Any]]]:
    """Aplica aos `pack_ids` recém-chegados o critério da pasta mais próxima que defina um.

    Devolve os resultados por pack (o mesmo formato do bulk) ou None se nada a herdar.
    Nunca levanta: o pack já está na pasta, e falhar aqui não pode desfazer nem mascarar o mover.
    """
    try:
        sb = get_supabase_for_user(user["token"])
        judgment = _rpc(sb, "resolve_folder_judgment", {"p_folder_id": folder_id, "p_own_only": False})
        if not judgment or not pack_ids:
            return None
        # Import tardio: analytics importa este módulo.
        from app.routes import analytics

        fields = {k: v for k, v in judgment.items() if k in _FIELDS}
        if not fields:
            return None
        return analytics.apply_judgment_to_packs(str(user["user_id"]), pack_ids, fields)
    except Exception:
        logger.exception("[FOLDERS_JUDGMENT] Pack movido, mas a heranca do criterio da pasta %s falhou", folder_id)
        return None
