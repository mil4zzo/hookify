"""
Teto de concorrencia para chamadas ao banco (PostgREST/Supabase).

POR QUE ISTO EXISTE
-------------------
O banco aceita **60 conexoes** (`max_connections`), das quais 3 sao reservadas
para superuser e ~10 ficam fixas com o Auth (GoTrue) -> sobram ~45 para a
aplicacao, ainda divididas com Storage/Realtime.

Do outro lado, o backend sobe com `uvicorn --workers 4` e cada worker tem o
threadpool padrao do Starlette (40 threads). Ou seja: o processo consegue
exigir ate **4 x 40 = 160 operacoes simultaneas** de um banco que serve ~45.
O backend estava dimensionado para pedir ~3x mais do que o outro lado aguenta.

Em 2026-08-24 isso terminou em `53300 remaining connection slots are reserved`
(~40 FATALs em 15 s), pilha de locks, deadlock e crash do Postgres com recovery
de WAL. Nao foi volume de usuarios -- foram poucas acoes de UMA pessoa
multiplicadas pelo fan-out (cada tela do Manager dispara 4 endpoints, e cada
endpoint faz ~4 idas ao banco).

Agrava: rota sincrona (`def`, nao `async def`) roda em thread do pool e
**nao pode ser interrompida**. Quando o navegador aborta (troca de filtro), o
trabalho continua ate o fim segurando a conexao. Cancelar no cliente nao
devolve o slot -- por isso o teto tem de ser do lado do servidor.

DECISAO
-------
Semaforo global POR PROCESSO na chamada ao PostgREST. Com `--workers 4`, o
teto real e `DB_MAX_CONCURRENT_CALLS x 4` (mesma armadilha do rate limit em
memoria: estado de processo vale N vezes). O default 8 => 32 no total, que
cabe com folga nos ~45 disponiveis.

Preferido ao corte do threadpool porque e cirurgico: limita so trabalho de
banco e deixa chamada a Meta (lenta, sem conexao de banco) passar livre.
O corte do threadpool existe como rede de seguranca em `main.py`.

Esperar e o comportamento desejado: ficar lento alguns segundos e infinitamente
melhor que derrubar o banco. Mas a espera e limitada -- passou do teto, falha
rapido em vez de acumular thread parada.
"""
from __future__ import annotations

import logging
import threading
import time
from contextlib import contextmanager
from typing import Callable, Iterator, TypeVar

from app.core.config import DB_MAX_CONCURRENT_CALLS, DB_SLOT_ACQUIRE_TIMEOUT_S

logger = logging.getLogger(__name__)

T = TypeVar("T")


class DBConcurrencyTimeout(Exception):
    """Nao houve slot de banco livre dentro do timeout.

    Sinaliza saturacao real. NAO e falha transitoria de rede: nao deve ser
    re-tentada em loop apertado pelo `with_postgrest_retry` (retry so aumenta a
    fila). O caller deve degradar (503/best-effort), nao insistir.
    """


_semaphore = threading.BoundedSemaphore(DB_MAX_CONCURRENT_CALLS)

# REENTRANCIA (nao remover).
# Alguns caminhos ja embrulhados chamam helpers que tambem embrulham -- ex.:
# uma hidratacao que por dentro usa `with_postgrest_retry`. Sem esta guarda a
# MESMA thread pegaria 2 slots e, com varias threads na mesma situacao, cada
# uma segurando 1 e esperando o 2o, o backend inteiro travava (deadlock
# classico de semaforo). Com a guarda, o slot e da OPERACAO MAIS EXTERNA: a
# aninhada vira no-op e devolve o controle sem tocar no semaforo.
_local = threading.local()

# Observabilidade: sem isto a saturacao e invisivel ate virar incidente.
_stats_lock = threading.Lock()
_in_flight = 0
_peak_in_flight = 0
_waited_calls = 0
_timeouts = 0

# Espera acima disto vira log -- sinal de que o teto esta apertado demais
# (ou de que ha query lenta segurando slot).
_SLOW_WAIT_LOG_S = 1.0


@contextmanager
def db_slot(operation: str = "db") -> Iterator[None]:
    """Reserva um slot de concorrencia de banco pela duracao do bloco.

    Uso:
        with db_slot("rankings_rpc"):
            sb.rpc(...).execute()

    Envolver APENAS a chamada em si. Nunca segurar o slot durante `sleep` de
    retry, loop de varios lotes ou processamento em memoria -- isso serializa o
    backend inteiro e transforma a protecao em gargalo.
    """
    global _in_flight, _peak_in_flight, _waited_calls, _timeouts

    # Ja dentro de um slot nesta thread: nao pega outro (ver _local acima).
    if getattr(_local, "held", False):
        yield
        return

    t0 = time.monotonic()
    acquired = _semaphore.acquire(timeout=DB_SLOT_ACQUIRE_TIMEOUT_S)
    waited = time.monotonic() - t0

    if not acquired:
        with _stats_lock:
            _timeouts += 1
            timeouts = _timeouts
        logger.warning(
            "[db_concurrency] %s: sem slot livre apos %.1fs (limite=%d/processo, "
            "timeouts acumulados=%d) -- banco saturado, degradando em vez de enfileirar",
            operation,
            DB_SLOT_ACQUIRE_TIMEOUT_S,
            DB_MAX_CONCURRENT_CALLS,
            timeouts,
        )
        raise DBConcurrencyTimeout(
            f"{operation}: sem slot de banco livre apos {DB_SLOT_ACQUIRE_TIMEOUT_S}s "
            f"(limite {DB_MAX_CONCURRENT_CALLS} por processo)"
        )

    with _stats_lock:
        _in_flight += 1
        if _in_flight > _peak_in_flight:
            _peak_in_flight = _in_flight
        if waited > 0.001:
            _waited_calls += 1
        current = _in_flight

    if waited >= _SLOW_WAIT_LOG_S:
        logger.info(
            "[db_concurrency] %s: esperou %.2fs por slot (em voo=%d/%d)",
            operation,
            waited,
            current,
            DB_MAX_CONCURRENT_CALLS,
        )

    _local.held = True
    try:
        yield
    finally:
        _local.held = False
        with _stats_lock:
            _in_flight -= 1
        _semaphore.release()


def with_db_slot(operation: str, fn: Callable[[], T]) -> T:
    """Versao funcional de `db_slot` para embrulhar uma chamada existente."""
    with db_slot(operation):
        return fn()


def get_stats() -> dict:
    """Snapshot para /health e diagnostico. Valores sao POR PROCESSO."""
    with _stats_lock:
        return {
            "limit_per_process": DB_MAX_CONCURRENT_CALLS,
            "in_flight": _in_flight,
            "peak_in_flight": _peak_in_flight,
            "waited_calls": _waited_calls,
            "acquire_timeouts": _timeouts,
        }
