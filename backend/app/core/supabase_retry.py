"""
Retries para chamadas PostgREST via cliente Supabase (httpx).

HTTP/2 com Supabase/Cloudflare as vezes encerra a conexao (RemoteProtocolError);
repetir a operacao costuma resolver sem mudar a logica de negocio.
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


def with_postgrest_retry(
    operation: str,
    fn: Callable[[], T],
    *,
    attempts: int = 4,
    base_delay: float = 0.15,
) -> T:
    """Executa fn() repetindo em falhas transitórias de rede/HTTP2."""
    transient = _transient_httpx_exceptions()
    if not transient:
        return fn()

    last: BaseException | None = None
    for attempt in range(attempts):
        try:
            return fn()
        except transient as exc:  # type: ignore[misc]
            last = exc
            if attempt + 1 >= attempts:
                logger.warning(
                    "%s: PostgREST/httpx falhou apos %s tentativas: %s: %s",
                    operation,
                    attempts,
                    type(exc).__name__,
                    exc,
                )
                raise
            delay = base_delay * (2**attempt) + random.uniform(0, 0.1)
            if attempt == 0:
                logger.info(
                    "%s: falha transitória (%s), haverá até %s tentativas no total",
                    operation,
                    type(exc).__name__,
                    attempts,
                )
            logger.info(
                "%s: retry %s/%s em %.2fs (%s)",
                operation,
                attempt + 2,
                attempts,
                delay,
                type(exc).__name__,
            )
            time.sleep(delay)
    assert last is not None
    raise last
