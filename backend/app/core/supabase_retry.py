"""
Retries para chamadas PostgREST via cliente Supabase (httpx).

REGRA: só repete quando o TRABALHO NÃO ACONTECEU
------------------------------------------------
Repetir uma chamada só recupera alguma coisa se a anterior não chegou a rodar.
Se o banco recebeu o pedido e está trabalhando, repetir não cancela nada: soma
uma cópia da mesma consulta e multiplica a carga exatamente quando o banco já
está apertado.

Isso não é teoria. Medido em produção em 2026-09-15: um cliente que desiste em
0,15 s de uma leitura de ~3 s deixa a consulta rodando no banco por mais de 1 s
depois — a "consulta órfã". No incidente de 14/09 ("Erro ao carregar variações."),
uma consulta de 18 s contra um teto de cliente de 15 s virou **4 tentativas de
15 s**: 1 minuto de espera para o usuário e até 4 cópias da mesma consulta no
banco, cada uma continuando a rodar depois que o backend já tinha desistido.

  REPETE (o trabalho não aconteceu)     | NÃO REPETE (aconteceu ou está acontecendo)
  --------------------------------------|-------------------------------------------
  ConnectError, ConnectTimeout          | ReadTimeout  <- o banco está trabalhando
  PoolTimeout (nem saiu do cliente)     | WriteTimeout <- pedido pela metade
  RemoteProtocolError, ReadError        | 57014 statement timeout (o banco desistiu)
  WriteError (conexão caiu no envio)    | DBConcurrencyTimeout (saturação real)
  deadlock 40P01 (o Postgres desfez)    | ClientGone (o usuário foi embora)

Cuidado com `httpx.TimeoutException`: é a classe-MÃE de ReadTimeout. Listá-la
arrasta o ReadTimeout de volta em silêncio — foi exatamente assim que ele entrou.
Por isso este módulo nunca cita a classe-mãe, só as folhas.

ESCRITA: por que repetir é seguro aqui
--------------------------------------
Este helper embrulha ~87 chamadas, incluindo ESCRITAS (upsert_ad_metrics do
refresh, enriquecimento em lote do Leadscore). Numa escrita, "deu erro" é
ambíguo: pode ter gravado. Repetir é seguro **porque estas escritas são
idempotentes** — gravam valores absolutos, não read-modify-write, e tocam
colunas disjuntas. Rodar duas vezes deixa o mesmo estado final.

Se um dia entrar aqui uma escrita que NÃO seja idempotente (um contador `x = x+1`,
uma inserção sem chave natural), esta garantia cai e a chamada precisa sair do
helper. Deadlock (40P01) é o caso mais claro do lado seguro: o Postgres desfez a
transação inteira antes de devolver o erro, então nada foi gravado.
"""
from __future__ import annotations

import logging
import random
import time
from typing import Callable, TypeVar

from app.core.client_disconnect import ClientGone
from app.core.db_concurrency import db_slot

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


# Falhas em que o pedido comprovadamente NÃO foi executado pelo banco: ou nem
# saiu do cliente, ou a conexão caiu antes de a resposta começar. Só folhas —
# citar `TimeoutException` (a classe-mãe) arrastaria ReadTimeout junto.
_NOMES_REPETIVEIS = (
    "ConnectError",        # não conseguiu abrir a conexão
    "ConnectTimeout",      # idem, por tempo
    "PoolTimeout",         # não conseguiu nem uma conexão do pool local
    "RemoteProtocolError",  # o outro lado derrubou o HTTP/2 (Supabase/Cloudflare)
    "ReadError",           # conexão morreu; sem resposta
    "WriteError",          # conexão morreu durante o envio do pedido
)

# Explicitamente FORA, com o motivo. Existe para que a decisão fique escrita e
# para o teste conseguir afirmar a ausência (ver test_supabase_retry.py).
_NOMES_NAO_REPETIVEIS = (
    "ReadTimeout",       # pedido entregue: o banco ESTÁ trabalhando. Repetir soma cópias.
    "WriteTimeout",      # pedido pela metade; repetir reenvia o corpo inteiro na rede já engasgada
    "TimeoutException",  # classe-mãe das duas acima — nunca listar
)


def _transient_httpx_exceptions() -> tuple:
    """Classes de exceção que autorizam repetir, colhidas de httpx e httpcore."""
    errs: list = []
    for modulo in (httpx, httpcore):
        if modulo is None:
            continue
        for nome in _NOMES_REPETIVEIS:
            cls = getattr(modulo, nome, None)
            if isinstance(cls, type) and cls not in errs:
                errs.append(cls)
    return tuple(errs)


def _e_repetivel(exc: BaseException, repetiveis: tuple) -> bool:
    """Verdadeiro só para falha de "não aconteceu".

    A checagem por NOME vem primeiro e é o que dá a garantia: `ReadTimeout`
    herda de `ConnectTimeout`? Não — mas herda de `TimeoutException`, e um
    `isinstance` contra uma lista que um dia volte a conter a mãe classificaria
    errado sem ninguém perceber. Barrar pelo nome exato da classe fecha essa
    porta de vez.
    """
    if type(exc).__name__ in _NOMES_NAO_REPETIVEIS:
        return False
    return bool(repetiveis) and isinstance(exc, repetiveis)


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
    """Executa fn() repetindo APENAS falhas em que o trabalho não aconteceu.

    Queda de conexão/HTTP2, falta de conexão no pool e deadlock (40P01). Timeout
    de leitura NÃO entra: ver a tabela no topo do módulo.

    Cada tentativa roda dentro de um slot de concorrência de banco (`db_slot`).
    O slot é pego POR TENTATIVA, de propósito: segurá-lo durante o `time.sleep()`
    do backoff bloquearia um slot escasso sem usar o banco — o retry viraria o
    gargalo em vez da proteção. Ver `app/core/db_concurrency.py`.

    `DBConcurrencyTimeout` (saturação real) não é transitória: cai no `raise`
    abaixo e sobe. Re-tentar saturação só alonga a fila.
    """
    transient = _transient_httpx_exceptions()

    last: BaseException | None = None
    for attempt in range(attempts):
        try:
            with db_slot(operation):
                return fn()
        except ClientGone:
            # Guarda defensiva: hoje nenhum checkpoint e alcancavel daqui, mas este
            # helper embrulha ESCRITAS (upserts, enriquecimento em lote). Se um dia
            # um checkpoint cair sob ele, sem esta linha o cancelamento seria
            # classificado por `_is_deadlock` (que faz match de substring na
            # mensagem) e poderia virar RETRY DE UMA ESCRITA. Barato agora,
            # caro de descobrir depois.
            raise
        except Exception as exc:
            is_transient = _e_repetivel(exc, transient)
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
