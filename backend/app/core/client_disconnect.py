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

COMO FUNCIONA
-------------
`Request.is_disconnected()` e assincrono e nos estamos numa thread. A ponte e
`anyio.from_thread.run`, que agenda a corrotina no event loop e devolve o
resultado para a thread. Funciona porque o FastAPI roda rotas sincronas via
`anyio.to_thread.run_sync` -- threads que a anyio conhece.

O corpo da request ja foi lido e parseado pelo FastAPI antes do handler comecar,
entao o `receive` nao-bloqueante que o `is_disconnected()` faz por dentro nao
corre risco de "roubar" pedaco de corpo.

DUAS REGRAS QUE NAO PODEM SER QUEBRADAS
---------------------------------------
1. **So checar antes de trabalho SOMENTE-LEITURA e best-effort.** Nunca no meio
   de uma sequencia de escrita: abortar entre dois UPDATEs deixaria estado
   parcial no banco, o que e muito pior que desperdicio de CPU. Os pontos
   legitimos hoje sao as hidratacoes do rankings (miniatura, transcricao, tipo
   de midia) -- enriquecimentos opcionais que ja falham em silencio.
2. **Fail-safe: na duvida, o cliente esta presente.** Qualquer erro na deteccao
   devolve "conectado" e o trabalho continua. Um falso positivo aqui cancelaria
   trabalho legitimo e devolveria resposta incompleta ao usuario -- errar para o
   lado do desperdicio e barato; errar para o lado do cancelamento nao e.
"""
from __future__ import annotations

import logging
from contextvars import ContextVar
from typing import Any, Optional

from app.core.config import CLIENT_DISCONNECT_ABORT_ENABLED

logger = logging.getLogger(__name__)

# Preenchido pelo middleware `_set_request_context` (main.py). Fora de um request
# HTTP -- job de background, script, teste -- fica None e tudo se comporta como
# "cliente presente".
current_request: ContextVar[Optional[Any]] = ContextVar("current_request", default=None)


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


def client_is_gone() -> bool:
    """True somente se der para AFIRMAR que o cliente desligou.

    Toda incerteza (sem request no contexto, thread fora do pool da anyio,
    excecao na ponte) devolve False -- ver regra 2 no topo do modulo.
    """
    if not CLIENT_DISCONNECT_ABORT_ENABLED:
        return False

    request = current_request.get()
    if request is None:
        return False

    try:
        import anyio.from_thread

        return bool(anyio.from_thread.run(request.is_disconnected))
    except RuntimeError:
        # Thread que nao pertence ao pool da anyio (job de background, worker
        # proprio). Nao da para consultar o event loop daqui.
        return False
    except Exception as exc:  # nunca deixar a deteccao derrubar a rota
        logger.debug("[client_disconnect] deteccao falhou, assumindo conectado: %s", exc)
        return False


def abort_if_client_gone(stage: str) -> None:
    """Interrompe com `ClientGone` se o cliente ja desligou.

    Chamar APENAS antes de trabalho somente-leitura/best-effort (regra 1).
    `stage` aparece no log e serve para saber onde o corte aconteceu.
    """
    if client_is_gone():
        logger.info("[client_disconnect] cliente desligou; pulando '%s'", stage)
        raise ClientGone(stage)
