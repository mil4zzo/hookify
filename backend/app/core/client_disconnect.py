"""
Parar trabalho quando o navegador ja desligou.

O PROBLEMA
----------
O frontend JA aborta a requisicao anterior quando o usuario troca um filtro no
Manager (`signal` do TanStack Query ligado ao axios). Mas o cancelamento morre
no navegador: as rotas de analytics sao **sincronas** (`def`, nao `async def`),
o FastAPI as roda numa thread do pool, e **thread em execucao nao pode ser
interrompida**. O backend segue ate o fim -- termina a RPC de 16 s, faz as tres
hidratacoes -- e so entao descobre que ninguem esta ouvindo.

Em 2026-08-24, quatro trocas de filtro em ~1 minuto deixaram quatro pipelines
abandonados rodando, cada um segurando conexao de um banco que serve ~40. O teto
de concorrencia (`db_concurrency.py`) impede o afogamento; isto ataca a outra
metade: **nao gastar o slot com trabalho que ninguem vai ler**.

POR QUE UM MIDDLEWARE ASGI PURO, E NAO `Request.is_disconnected()`
------------------------------------------------------------------
A primeira versao lia `Request.is_disconnected()` de dentro da thread, via
`anyio.from_thread.run`. **Era um no-op em producao** e os testes nao pegaram
porque montavam um app com UM middleware, enquanto o `main.py` tem dois.

Motivo: `is_disconnected()` faz um `receive()` nao-bloqueante (`CancelScope` ja
cancelado -- "se a mensagem nao vier na hora, siga"). Com dois
`BaseHTTPMiddleware` empilhados, o `receive` que chega ao Request de fora e o
`receive_or_disconnect` do middleware de dentro, que **sempre** suspende (task
group). A suspensao entrega o cancelamento pendente antes da mensagem, entao
`is_disconnected()` retornava `False` **para sempre**.

Medido nesta base (starlette 0.48.0), cliente ja desconectado:

    1 middleware  (a forma dos testes antigos) -> True
    2 middlewares + CORS (a forma do main.py)  -> False   <-- feature morta

A solucao nao depende de ordem nem de quantos middlewares existem: um middleware
**ASGI puro** no topo da pilha vira o **leitor unico** do canal `receive`. Ele
bombeia as mensagens para uma fila (o app consome dali, sem competicao) e marca
o flag ao ver `http.disconnect`.

Ganho colateral: `client_is_gone()` virou **leitura de um bool**. A versao
anterior fazia um round-trip ao event loop DE DENTRO de um slot de banco -- com
o loop congestionado (exatamente a situacao que a feature existe para aliviar),
segurava um dos 8 slots enquanto esperava ser agendada.

DUAS REGRAS QUE NAO PODEM SER QUEBRADAS
---------------------------------------
1. **So checar antes de trabalho SOMENTE-LEITURA e best-effort.** Nunca no meio
   de uma sequencia de escrita: abortar entre dois UPDATEs deixaria estado
   parcial no banco, o que e muito pior que desperdicio de CPU.
2. **Fail-safe: na duvida, o cliente esta presente.** Sem estado no contexto
   (job de background, script, teste) o trabalho continua. Falso positivo
   cancelaria trabalho legitimo e devolveria resposta incompleta ao usuario --
   errar para o lado do desperdicio e barato; para o lado do cancelamento nao.
"""
from __future__ import annotations

import asyncio
import logging
import threading
from contextvars import ContextVar
from typing import Optional

from app.core.config import CLIENT_DISCONNECT_ABORT_ENABLED

logger = logging.getLogger(__name__)


class _Liveness:
    """Estado por request. MUTAVEL de proposito.

    O middleware (event loop) escreve; a rota (thread do pool) le. Como o
    contextvar carrega a MESMA instancia para a thread, a mutacao e visivel sem
    sincronizacao extra -- e um unico bool, escrito por um unico escritor.
    """

    __slots__ = ("disconnected",)

    def __init__(self) -> None:
        self.disconnected = False


current_liveness: ContextVar[Optional[_Liveness]] = ContextVar("current_liveness", default=None)


class ClientGone(Exception):
    """O cliente desligou; o trabalho restante nao tem para quem ir.

    Cancelamento nao e erro de aplicacao: nao vira 500, nao vai para o Sentry e
    nao polui log de erro. O middleware a converte numa resposta 499 curta que,
    por definicao, ninguem vai ler.

    **NAO trocar para BaseException.** A ideia e tentadora (e o que o
    `asyncio.CancelledError` faz, justamente para nao ser engolido por
    `except Exception` de best-effort), mas foi **testada e nao funciona aqui**:
    o `BaseHTTPMiddleware` do Starlette 0.48 perde BaseException que sobe da
    rota e o cliente recebe `RuntimeError: No response returned.` -> 500. Com
    `Exception`, o `except ClientGone` do middleware pega e devolve 499
    corretamente. Verificado com TestClient nas duas variantes.

    **A consequencia disso e uma REGRA DE USO:** como ela e uma Exception comum,
    qualquer `except Exception` no caminho a engole. Por isso o checkpoint so
    pode ficar no nivel de cima da rota -- **nunca dentro de um bloco
    try/except Exception** (que neste codebase quase sempre significa
    "best-effort, siga em frente"). Se precisar de um checkpoint dentro de um
    bloco desses, re-lance explicitamente:

        except ClientGone:
            raise
        except Exception:
            ...  # best-effort de verdade
    """

    def __init__(self, stage: str) -> None:
        self.stage = stage
        super().__init__(f"cliente desconectou antes de '{stage}'")


# --- Observabilidade -------------------------------------------------------
# Sem isto, "o detector esta quebrado" e "ninguem abandona request" sao
# indistinguiveis nos logs -- foi assim que a versao no-op passou despercebida.
# `checks` alto com `aborts` cravado em zero = detector morto.
_stats_lock = threading.Lock()
_checks = 0
_aborts = 0
_aborts_by_stage: dict[str, int] = {}


def client_is_gone() -> bool:
    """True somente se der para AFIRMAR que o cliente desligou (ver regra 2)."""
    global _checks

    if not CLIENT_DISCONNECT_ABORT_ENABLED:
        return False

    state = current_liveness.get()
    if state is None:
        # Fora de um request HTTP: job de background, script, teste.
        return False

    with _stats_lock:
        _checks += 1
    return state.disconnected


def abort_if_client_gone(stage: str) -> None:
    """Interrompe com `ClientGone` se o cliente ja desligou.

    Chamar APENAS antes de trabalho somente-leitura/best-effort (regra 1).
    `stage` aparece no log e nas metricas -- serve para saber onde o corte
    aconteceu e qual etapa mais economiza trabalho.
    """
    global _aborts

    if client_is_gone():
        with _stats_lock:
            _aborts += 1
            _aborts_by_stage[stage] = _aborts_by_stage.get(stage, 0) + 1
        logger.info("[client_disconnect] cliente desligou; pulando '%s'", stage)
        raise ClientGone(stage)


def get_stats() -> dict:
    """Snapshot para /health. Valores sao POR PROCESSO (x4 com --workers 4).

    `checks` > 0 e `aborts` == 0 por muito tempo em uso real e sinal de detector
    quebrado, nao de ausencia de cancelamento.
    """
    with _stats_lock:
        return {
            "enabled": CLIENT_DISCONNECT_ABORT_ENABLED,
            "checks": _checks,
            "aborts": _aborts,
            "aborts_by_stage": dict(_aborts_by_stage),
        }


class ClientDisconnectMiddleware:
    """Middleware ASGI puro: leitor unico do canal `receive`.

    Registrar como o **mais externo** (`add_middleware` por ultimo). Ele nao
    gera resposta nenhuma -- so observa e delega -- entao nao interfere na regra
    de o CORSMiddleware envolver quem produz erro.

    Nao usa `BaseHTTPMiddleware` de proposito: e justamente o empilhamento de
    BaseHTTPMiddleware que quebrava a deteccao (ver o topo do modulo).
    """

    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http" or not CLIENT_DISCONNECT_ABORT_ENABLED:
            await self.app(scope, receive, send)
            return

        state = _Liveness()
        token = current_liveness.set(state)
        queue: asyncio.Queue = asyncio.Queue()

        async def pump() -> None:
            """Unico consumidor do `receive` real.

            Repassa tudo para a fila (o corpo da request continua chegando ao
            app normalmente) e marca o flag ao ver a desconexao. Ser o leitor
            unico e o que evita competir com o app pelo canal.
            """
            while True:
                message = await receive()
                if message.get("type") == "http.disconnect":
                    state.disconnected = True
                    await queue.put(message)
                    return
                await queue.put(message)

        async def wrapped_receive():
            return await queue.get()

        pump_task = asyncio.ensure_future(pump())
        try:
            await self.app(scope, wrapped_receive, send)
        finally:
            pump_task.cancel()
            current_liveness.reset(token)
