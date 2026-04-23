"""
MetaUsageLogger: Loga headers de usage retornados pela Meta API e persiste
cada chamada em public.meta_api_usage para dar visibilidade por usuario/rota.

Headers monitorados:
- x-app-usage: uso global do app (call_count, total_cputime, total_time)
- x-business-use-case-usage: uso por ad account
- x-ad-account-usage: uso por ad account (acc_id_util_pct)

Logs stdout sao controlados por LOG_META_USAGE (default: false) e emitem
WARNING quando qualquer metrica ultrapassa THRESHOLD (80%).

A persistencia em Supabase acontece sempre (fire-and-forget em thread
separada) e nao quebra a chamada original em caso de falha.
"""
import json
import logging
import re
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, Optional
from urllib.parse import urlparse

from app.core.config import LOG_META_USAGE
from app.core.request_context import get_current_page_route, get_current_route, get_current_user_id

logger = logging.getLogger(__name__)

_ENABLED: bool = LOG_META_USAGE
_THRESHOLD = 80

_AD_ACCOUNT_RE = re.compile(r"(act_\d+)")

# Thread pool dedicado para inserts fire-and-forget. Tamanho pequeno porque
# cada insert leva ~100-300ms e o throughput de chamadas Meta nao e alto.
_persist_pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="meta-usage-persist")


def log_meta_usage(response, service_name: str) -> None:
    """Extrai e loga headers de usage de uma response HTTP da Meta API.

    Args:
        response: objeto Response (requests ou httpx) com atributo .headers
        service_name: nome do servico chamador (ex: "AdsEnricher")
    """
    headers = getattr(response, "headers", None)
    if headers is None:
        return

    if _ENABLED:
        _log_app_usage(headers, service_name)
        _log_business_use_case_usage(headers, service_name)
        _log_ad_account_usage(headers, service_name)

    # Capture contextvar values NOW in the request thread — ThreadPoolExecutor
    # starts worker threads with a fresh context so contextvars are invisible there.
    user_id = get_current_user_id()
    route = get_current_route()
    page_route = get_current_page_route()
    _persist_pool.submit(_persist_usage, response, service_name, user_id, route, page_route)


def _persist_usage(response, service_name: str, user_id: Optional[str], route: Optional[str], page_route: Optional[str]) -> None:
    """Insere uma linha em meta_api_usage. Executado em thread do pool."""
    try:
        headers = getattr(response, "headers", None)
        if headers is None:
            return

        row = _build_row(response, headers, service_name, user_id, route, page_route)

        # Import local para evitar overhead no import do modulo e
        # permitir que ambientes sem Supabase configurado nao falhem.
        from app.core.supabase_client import get_supabase_service

        sb = get_supabase_service()
        sb.table("meta_api_usage").insert(row).execute()
    except Exception as e:
        logger.warning("[MetaUsage] falha ao persistir uso: %s", e)


def _build_row(response, headers, service_name: str, user_id: Optional[str], route: Optional[str], page_route: Optional[str]) -> Dict[str, Any]:
    app_usage = _parse_app_usage(headers)
    buc_data = _parse_json_header(headers, "x-business-use-case-usage")
    ad_account_data = _parse_json_header(headers, "x-ad-account-usage")
    url = _get_url(response)
    ad_account_id = _extract_ad_account_id(url)
    meta_endpoint = _extract_path(url)

    # Prefer x-app-usage; fall back to max across BUC entries when absent.
    # Most Marketing API calls only return x-business-use-case-usage.
    call_count_pct = app_usage.get("call_count")
    cputime_pct = app_usage.get("total_cputime")
    total_time_pct = app_usage.get("total_time")

    if call_count_pct is None and isinstance(buc_data, dict):
        call_count_pct = _max_buc_metric(buc_data, "call_count")
        cputime_pct = _max_buc_metric(buc_data, "total_cputime")
        total_time_pct = _max_buc_metric(buc_data, "total_time")

    return {
        "user_id": user_id,
        "route": route,
        "page_route": page_route,
        "service_name": service_name,
        "ad_account_id": ad_account_id,
        "meta_endpoint": meta_endpoint,
        "http_method": _get_method(response),
        "http_status": getattr(response, "status_code", None),
        "response_ms": _get_elapsed_ms(response),
        "call_count_pct": call_count_pct,
        "cputime_pct": cputime_pct,
        "total_time_pct": total_time_pct,
        "business_use_case_usage": buc_data if isinstance(buc_data, dict) else None,
        "ad_account_usage": ad_account_data if isinstance(ad_account_data, dict) else None,
    }


def _max_buc_metric(buc_data: Dict[str, Any], metric: str) -> Optional[float]:
    """Returns max value of `metric` across all BUC account entries."""
    max_val: Optional[float] = None
    for entries in buc_data.values():
        if not isinstance(entries, list):
            continue
        for entry in entries:
            val = entry.get(metric)
            if isinstance(val, (int, float)):
                if max_val is None or val > max_val:
                    max_val = float(val)
    return max_val


def _parse_app_usage(headers) -> Dict[str, Any]:
    raw = headers.get("x-app-usage")
    if not raw:
        return {}
    try:
        return json.loads(raw) or {}
    except (json.JSONDecodeError, TypeError):
        return {}


def _parse_json_header(headers, name: str) -> Optional[Any]:
    raw = headers.get(name)
    if not raw:
        return None
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return None


def _get_url(response) -> str:
    url = getattr(response, "url", "")
    return str(url) if url else ""


def _get_method(response) -> Optional[str]:
    request = getattr(response, "request", None)
    if request is None:
        return None
    method = getattr(request, "method", None)
    return str(method) if method else None


def _get_elapsed_ms(response) -> Optional[int]:
    elapsed = getattr(response, "elapsed", None)
    if elapsed is None:
        return None
    try:
        return int(elapsed.total_seconds() * 1000)
    except (AttributeError, TypeError):
        return None


def _extract_ad_account_id(url: str) -> Optional[str]:
    if not url:
        return None
    match = _AD_ACCOUNT_RE.search(url)
    return match.group(1) if match else None


def _extract_path(url: str) -> Optional[str]:
    if not url:
        return None
    try:
        return urlparse(url).path or None
    except Exception:
        return None


def _log_app_usage(headers, service_name: str) -> None:
    raw = headers.get("x-app-usage")
    if not raw:
        return
    try:
        data = json.loads(raw)
        call_count = data.get("call_count", 0)
        total_cputime = data.get("total_cputime", 0)
        total_time = data.get("total_time", 0)

        logger.info(
            "[MetaUsage] service=%s | x-app-usage: call_count=%s%%, total_cputime=%s%%, total_time=%s%%",
            service_name, call_count, total_cputime, total_time,
        )

        for metric, value in [("call_count", call_count), ("total_cputime", total_cputime), ("total_time", total_time)]:
            if isinstance(value, (int, float)) and value >= _THRESHOLD:
                logger.warning(
                    "[MetaUsage] service=%s | THRESHOLD ALERT: x-app-usage %s=%s%% (>=%s%%)",
                    service_name, metric, value, _THRESHOLD,
                )
    except (json.JSONDecodeError, TypeError, AttributeError) as e:
        logger.debug("[MetaUsage] service=%s | Falha ao parsear x-app-usage: %s", service_name, e)


def _log_business_use_case_usage(headers, service_name: str) -> None:
    raw = headers.get("x-business-use-case-usage")
    if not raw:
        return
    try:
        data = json.loads(raw)
        for account_id, entries in data.items():
            if not isinstance(entries, list):
                continue
            for entry in entries:
                call_count = entry.get("call_count", 0)
                total_cputime = entry.get("total_cputime", 0)
                total_time = entry.get("total_time", 0)
                usage_type = entry.get("type", "unknown")
                estimated_regain = entry.get("estimated_time_to_regain_access", 0)

                logger.info(
                    "[MetaUsage] service=%s | x-business-use-case-usage: account=%s, type=%s, "
                    "call_count=%s%%, total_cputime=%s%%, total_time=%s%%, estimated_time_to_regain_access=%s",
                    service_name, account_id, usage_type,
                    call_count, total_cputime, total_time, estimated_regain,
                )

                for metric, value in [("call_count", call_count), ("total_cputime", total_cputime), ("total_time", total_time)]:
                    if isinstance(value, (int, float)) and value >= _THRESHOLD:
                        logger.warning(
                            "[MetaUsage] service=%s | THRESHOLD ALERT: x-business-use-case-usage account=%s %s=%s%% (>=%s%%)",
                            service_name, account_id, metric, value, _THRESHOLD,
                        )
    except (json.JSONDecodeError, TypeError, AttributeError) as e:
        logger.debug("[MetaUsage] service=%s | Falha ao parsear x-business-use-case-usage: %s", service_name, e)


def _log_ad_account_usage(headers, service_name: str) -> None:
    raw = headers.get("x-ad-account-usage")
    if not raw:
        return
    try:
        data = json.loads(raw)
        acc_pct = data.get("acc_id_util_pct", 0)

        logger.info(
            "[MetaUsage] service=%s | x-ad-account-usage: acc_id_util_pct=%s%%",
            service_name, acc_pct,
        )

        if isinstance(acc_pct, (int, float)) and acc_pct >= _THRESHOLD:
            logger.warning(
                "[MetaUsage] service=%s | THRESHOLD ALERT: x-ad-account-usage acc_id_util_pct=%s%% (>=%s%%)",
                service_name, acc_pct, _THRESHOLD,
            )
    except (json.JSONDecodeError, TypeError, AttributeError) as e:
        logger.debug("[MetaUsage] service=%s | Falha ao parsear x-ad-account-usage: %s", service_name, e)
