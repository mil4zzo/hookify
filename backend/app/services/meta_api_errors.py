from __future__ import annotations

import json
import logging
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)


def sanitize_error_dict_for_log(error: Dict[str, Any]) -> Dict[str, Any]:
    """Remove valores sensíveis de um dict de erro da Meta (cópia rasa recursiva limitada)."""
    out: Dict[str, Any] = {}
    for k, v in error.items():
        lk = str(k).lower()
        if "access_token" in lk or lk in {"token", "oauth_token"}:
            out[k] = "<redacted>"
            continue
        if isinstance(v, dict):
            out[k] = sanitize_error_dict_for_log(v)
        elif isinstance(v, str) and len(v) > 12 and v.startswith("EAA"):
            out[k] = "<redacted>"
        else:
            out[k] = v
    return out


def _blame_fields_to_str(spec: Any) -> Optional[str]:
    if spec is None:
        return None
    try:
        return json.dumps(spec, ensure_ascii=False)[:800]
    except (TypeError, ValueError):
        return str(spec)[:800]


def _compose_meta_message(
    base: str,
    *,
    subcode: Any = None,
    user_title: Optional[str] = None,
    user_msg: Optional[str] = None,
    blame_fields: Optional[str] = None,
) -> str:
    parts = [base]
    if user_title:
        parts.append(str(user_title))
    if user_msg:
        parts.append(str(user_msg))
    if subcode is not None and str(subcode) != "":
        parts.append(f"subcode={subcode}")
    if blame_fields:
        parts.append(f"blame={blame_fields}")
    return " | ".join(parts)


class MetaAPIError(RuntimeError):
    """Erro vindo da Meta Graph API ou validação pré-POST."""

    def __init__(
        self,
        message: str,
        error_code: Optional[str] = None,
        *,
        subcode: Any = None,
        user_title: Optional[str] = None,
        user_msg: Optional[str] = None,
        blame_fields: Optional[str] = None,
        raw_error: Optional[Dict[str, Any]] = None,
    ):
        full = _compose_meta_message(
            message,
            subcode=subcode,
            user_title=user_title,
            user_msg=user_msg,
            blame_fields=blame_fields,
        )
        super().__init__(full)
        self.message = full
        self.error_code = error_code
        self.subcode = subcode
        self.user_title = user_title
        self.user_msg = user_msg
        self.blame_fields = blame_fields
        self.raw_error = raw_error

    @staticmethod
    def from_graph_result(result: Dict[str, Any]) -> "MetaAPIError":
        error_obj = result.get("error") if isinstance(result.get("error"), dict) else {}
        base = str(
            error_obj.get("message")
            or result.get("message")
            or "Erro ao comunicar com a Meta API",
        )
        code = error_obj.get("code")
        return MetaAPIError(
            base,
            str(code) if code is not None else None,
            subcode=error_obj.get("error_subcode"),
            user_title=error_obj.get("error_user_title"),
            user_msg=error_obj.get("error_user_msg"),
            blame_fields=_blame_fields_to_str(
                error_obj.get("error_blame_field_specs") or error_obj.get("blame_field_specs"),
            ),
            raw_error=dict(error_obj) if error_obj else None,
        )


class TokenExpiredError(MetaAPIError):
    def __init__(
        self,
        message: str,
        error_code: str = "190",
        *,
        subcode: Any = None,
        user_msg: Optional[str] = None,
        raw_error: Optional[Dict[str, Any]] = None,
    ):
        super().__init__(
            message,
            error_code,
            subcode=subcode,
            user_msg=user_msg,
            raw_error=raw_error,
        )


def raise_for_graph_result(result: Dict[str, Any], *, log_context: Optional[str] = None) -> None:
    status = result.get("status")
    if status == "success":
        return
    error_obj = result.get("error") if isinstance(result.get("error"), dict) else {}
    if log_context and status == "http_error":
        body = str(result.get("message") or "")[:600]
        logger.warning(
            "%s graph_http_error %s",
            log_context,
            sanitize_error_dict_for_log(error_obj) if error_obj else body,
        )
    # Falhas http_error também podem ser logadas em GraphAPI; aqui reforça o contexto (ex.: job_id).
    if (
        log_context
        and status not in ("http_error",)
        and status in ("error", "auth_error")
        and error_obj
    ):
        logger.warning(
            "%s graph_error status=%s %s",
            log_context,
            status,
            sanitize_error_dict_for_log(error_obj),
        )
    code = str(error_obj.get("code") or "")
    if status == "auth_error" or code == "190":
        raise TokenExpiredError(
            str(error_obj.get("message") or result.get("message") or "Token expirado ou invalido"),
            code or "190",
            subcode=error_obj.get("error_subcode"),
            user_msg=error_obj.get("error_user_msg"),
            raw_error=dict(error_obj) if error_obj else None,
        )
    raise MetaAPIError.from_graph_result(result)


def extract_data_or_raise(result: Dict[str, Any], *, log_context: Optional[str] = None) -> Dict[str, Any]:
    if result.get("status") == "success":
        return result.get("data") or {}
    raise_for_graph_result(result, log_context=log_context)
