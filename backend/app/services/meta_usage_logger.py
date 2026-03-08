"""
MetaUsageLogger: Loga headers de usage retornados pela Meta API.

Headers monitorados:
- x-app-usage: uso global do app (call_count, total_cputime, total_time)
- x-business-use-case-usage: uso por ad account
- x-ad-account-usage: uso por ad account (acc_id_util_pct)

Controlado pela variavel de ambiente LOG_META_USAGE (default: false).
Emite WARNING quando qualquer metrica ultrapassa THRESHOLD (80%).
"""
import json
import logging

from app.core.config import LOG_META_USAGE

logger = logging.getLogger(__name__)

_ENABLED: bool = LOG_META_USAGE
_THRESHOLD = 80


def log_meta_usage(response, service_name: str) -> None:
    """Extrai e loga headers de usage de uma response HTTP da Meta API.

    Args:
        response: objeto Response (requests ou httpx) com atributo .headers
        service_name: nome do servico chamador (ex: "AdsEnricher")
    """
    if not _ENABLED:
        return

    headers = getattr(response, "headers", None)
    if headers is None:
        return

    _log_app_usage(headers, service_name)
    _log_business_use_case_usage(headers, service_name)
    _log_ad_account_usage(headers, service_name)


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
        # Estrutura: { "account_id": [ { "type": "...", "call_count": N, ... } ] }
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
