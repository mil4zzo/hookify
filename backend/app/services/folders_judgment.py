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


def save_folder_judgment(token: str, folder_id: str, fields: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Guarda na pasta o que a ação em massa aplicou. Quem não edita a pasta recebe 403/404 da RPC."""
    from fastapi import HTTPException

    sb = get_supabase_for_user(token)
    try:
        current = _rpc(sb, "resolve_folder_judgment", {"p_folder_id": folder_id, "p_own_only": True})
        merged = merge_folder_judgment(current, fields)
        _rpc(sb, "set_folder_judgment", {"p_folder_id": folder_id, "p_judgment": merged})
    except APIError as e:
        message = getattr(e, "message", None) or str(e)
        if "folder_forbidden" in message:
            raise HTTPException(status_code=403, detail="Esta acao e so de quem edita esta pasta.")
        if "folder_not_found" in message:
            raise HTTPException(status_code=404, detail="Pasta nao encontrada.")
        raise
    return merged


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
