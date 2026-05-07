"""
Retries para chamadas PostgREST via cliente Supabase (httpx).

Cobre dois tipos de falha transitória:
1. HTTP/2 drops com Supabase/Cloudflare (RemoteProtocolError, ReadError, etc.)
2. Deadlocks do Postgres (SQLSTATE 40P01) entre caminhos concorrentes que
   tocam ad_metrics — ex: upsert_ad_metrics (Meta refresh) vs
   batch_update_ad_metrics_enrichment (Leadscore RPC). Postgres mata uma das
   tx no ciclo; retry da vítima é seguro porque ambas as operações são
   idempotentes (escrevem valores absolutos, não read-modify-write) e tocam
   colunas disjuntas.
"""
from __future__ import annotations

import logging
import random
import time
from typing import Callable, TypeVar

try:
    import httpx
except ImportError:
    httpx = None  # type: ignore

try:
    import httpcore
except ImportError:
    httpcore = None  # type: ignore

logger = logging.getLogger(__name__)

T = TypeVar("T")


def _transient_httpx_exceptions() -> tuple:
    if httpx is None:
        return tuple()
    errs: list = [
        httpx.RemoteProtocolError,
        httpx.ReadError,
        httpx.ConnectError,
        httpx.TimeoutException,
        httpx.PoolTimeout,
    ]
    ct = getattr(httpx, "ConnectTimeout", None)
    if ct is not None:
        errs.append(ct)
    rt = getattr(httpx, "ReadTimeout", None)
    if rt is not None and rt not in errs:
        errs.append(rt)
    if httpcore is not None:
        rpe = getattr(httpcore, "RemoteProtocolError", None)
        if rpe is not None and rpe not in errs:
            errs.append(rpe)
    return tuple(errs)


def _is_deadlock(exc: BaseException) -> bool:
    """Detecta erro de deadlock do Postgres (SQLSTATE 40P01).

    O erro pode chegar como postgrest.APIError (com .code/.details) ou como
    Exception genérica com a mensagem JSON serializada — checa ambos.
    """
    code = getattr(exc, "code", None)
    if code == "40P01":
        return True
    details = getattr(exc, "details", None)
    if isinstance(details, dict) and details.get("code") == "40P01":
        return True
    msg = str(exc) if exc else ""
    return "40P01" in msg or "deadlock detected" in msg.lower()


def with_postgrest_retry(
    operation: str,
    fn: Callable[[], T],
    *,
    attempts: int = 4,
    base_delay: float = 0.15,
) -> T:
    """Executa fn() repetindo em falhas transitórias de rede/HTTP2 e deadlocks (40P01)."""
    transient = _transient_httpx_exceptions()

    last: BaseException | None = None
    for attempt in range(attempts):
        try:
            return fn()
        except Exception as exc:
            is_transient = bool(transient) and isinstance(exc, transient)
            is_deadlock = _is_deadlock(exc)
            if not (is_transient or is_deadlock):
                raise
            last = exc
            if attempt + 1 >= attempts:
                logger.warning(
                    "%s: falha persistente apos %s tentativas (%s): %s: %s",
                    operation,
                    attempts,
                    "deadlock" if is_deadlock else "transitoria",
                    type(exc).__name__,
                    exc,
                )
                raise
            # Jitter maior em deadlock dispersa tx concorrentes que retornam juntas
            jitter_max = 0.4 if is_deadlock else 0.1
            delay = base_delay * (2**attempt) + random.uniform(0, jitter_max)
            kind = "deadlock" if is_deadlock else "transitoria"
            if attempt == 0:
                logger.info(
                    "%s: falha %s (%s), havera ate %s tentativas no total",
                    operation,
                    kind,
                    type(exc).__name__,
                    attempts,
                )
            logger.info(
                "%s: retry %s/%s em %.2fs (%s, %s)",
                operation,
                attempt + 2,
                attempts,
                delay,
                kind,
                type(exc).__name__,
            )
            time.sleep(delay)
    assert last is not None
    raise last
