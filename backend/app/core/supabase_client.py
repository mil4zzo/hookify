from typing import Dict, Optional, Union
import logging

import httpx
from httpx import Timeout
from postgrest import SyncPostgrestClient
from postgrest.utils import SyncClient as PostgrestSession
from supabase import Client, ClientOptions
from app.core.config import (
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY,
)
from app.core.db_concurrency import db_slot


_logger = logging.getLogger(__name__)
_service_client: Optional[Client] = None

# Timeout padrao para operacoes PostgREST (upsert em lotes, etc.)
POSTGREST_TIMEOUT_SECONDS = 15.0


def _operation_label(request: "httpx.Request") -> str:
    """`rpc/fetch_manager_rankings_core_v2` ou `GET ads` — alvo legivel no log."""
    path = request.url.path
    alvo = path.split("/rest/v1/", 1)[-1].strip("/") if "/rest/v1/" in path else path
    if alvo.startswith("rpc/"):
        return alvo
    return f"{request.method} {alvo or '?'}"


class _SlottedHTTPXClient(PostgrestSession):
    """Cliente HTTP do Supabase que respeita o teto de concorrencia de banco.

    POR QUE AQUI, E NAO EM CADA CHAMADA
    -----------------------------------
    O teto (`db_concurrency.py`) so vale onde alguem lembra de aplica-lo. Medido
    em 2026-08-24: o backend tinha **262** `.execute()` e apenas 78 passavam por
    `with_postgrest_retry` -- ou seja, ~184 chamadas furavam a fila. Proteger
    call-site por call-site sempre deixa cauda, e cada arquivo novo nasce
    desprotegido.

    Interceptando aqui, no unico ponto por onde TODA chamada ao PostgREST passa,
    a garantia vale **por construcao**: `.execute()`, `.rpc()`, codigo futuro,
    tudo. A fabrica do cliente PostgREST e sobrescrita em
    `_SlottedSupabaseClient` (veja la por que nao da para injetar por parametro
    nem trocar a sessao depois).

    SO PostgREST, nunca Storage
    ---------------------------
    Storage e Auth (GoTrue) constroem cada um o SEU proprio cliente httpx e nao
    passam por aqui. O filtro por `/rest/v1/` fica como cinto e suspensorio: se
    alguma versao voltar a compartilhar a sessao, upload de miniatura nao pode
    disputar um dos 8 slots de banco.

    A reentrancia do `db_slot` faz o slot ser contado UMA vez quando a chamada ja
    vem de dentro de um `with_postgrest_retry` (que tambem pega slot, para poder
    solta-lo entre as tentativas).
    """

    def send(self, request: httpx.Request, **kwargs):  # type: ignore[override]
        if "/rest/v1/" in request.url.path:
            # `send` com stream=False (o que o postgrest usa) le o corpo aqui
            # dentro, entao o slot cobre a chamada inteira -- nao so o handshake.
            # Rotulo com o alvo real (tabela ou RPC) e nao so o verbo: quando o
            # log disser "esperou 2.3s por slot", ele precisa dizer ESPERANDO O QUE.
            # E o que torna os db_slot explicitos por call-site desnecessarios.
            with db_slot(f"postgrest:{_operation_label(request)}"):
                return super().send(request, **kwargs)
        return super().send(request, **kwargs)


class _SlottedPostgrestClient(SyncPostgrestClient):
    """Cliente PostgREST do supabase-py, so que com a sessao que pega slot."""

    def create_session(
        self,
        base_url: str,
        headers: Dict[str, str],
        timeout: Union[int, float, Timeout],
        verify: bool = True,
    ) -> _SlottedHTTPXClient:
        # Mesmos parametros do original (postgrest/_sync/client.py). Mexer em
        # follow_redirects/http2 aqui seria mudar comportamento de rede de
        # carona numa mudanca de concorrencia.
        return _SlottedHTTPXClient(
            base_url=base_url,
            headers=headers,
            timeout=timeout,
            verify=verify,
            follow_redirects=True,
            http2=True,
        )


class _SlottedSupabaseClient(Client):
    """Client do supabase-py que constroi o PostgREST com a sessao com slot.

    POR QUE SUBCLASSE, E NAO PARAMETRO NEM TROCA POSTERIOR
    ------------------------------------------------------
    A primeira versao passava `ClientOptions(httpx_client=...)`. Esse campo NAO
    existe no supabase-py -- conferido no 2.6.0 (o que o `requirements.txt`
    resolve) e no 2.27.0. Resultado: TODO `create_client` estourava TypeError e
    o backend inteiro respondia 500, com o `/health` passando porque nao toca no
    banco. Custou um outage; nao reintroduzir.

    Trocar `client.postgrest.session` depois de criado tambem nao serve: a
    propriedade e lazy e o proprio supabase zera `_postgrest` em SIGNED_IN,
    TOKEN_REFRESHED e SIGNED_OUT, o que descartaria a sessao com slot em
    silencio no meio da vida do cliente. Sobrescrever a fabrica cobre tambem
    essas reconstrucoes.
    """

    @staticmethod
    def _init_postgrest_client(
        rest_url: str,
        headers: Dict[str, str],
        schema: str,
        timeout: Union[int, float, Timeout] = POSTGREST_TIMEOUT_SECONDS,
        verify: bool = True,
        **kwargs,
    ) -> _SlottedPostgrestClient:
        return _SlottedPostgrestClient(
            rest_url,
            headers=headers,
            schema=schema,
            timeout=timeout,
            verify=verify,
        )


def _coerce_postgrest_timeout(timeout_seconds: Optional[float]) -> float:
    """Normaliza timeout PostgREST garantindo valor minimo de 1s."""
    if timeout_seconds is None:
        return POSTGREST_TIMEOUT_SECONDS
    try:
        return max(1.0, float(timeout_seconds))
    except (TypeError, ValueError):
        return POSTGREST_TIMEOUT_SECONDS


def get_supabase() -> Client:
    """Legacy: returns a service-level client (bypasses RLS). Prefer get_supabase_for_user."""
    return get_supabase_service()


def get_supabase_service() -> Client:
    """Service client using service role key (bypasses RLS). For admin/scripts only."""
    global _service_client
    if _service_client is not None:
        return _service_client

    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise RuntimeError("Supabase not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in env.")

    _service_client = _SlottedSupabaseClient(
        SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY,
        options=ClientOptions(postgrest_client_timeout=POSTGREST_TIMEOUT_SECONDS),
    )
    _logger.info("Supabase service client initialized (service role)")
    return _service_client


def get_supabase_for_user(
    jwt_token: str,
    *,
    postgrest_timeout_seconds: Optional[float] = None,
) -> Client:
    """Creates a per-request client authenticated as the user to enforce RLS.

    The client will use the JWT token in requests to enable Row Level Security.
    """
    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        raise RuntimeError("Supabase not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY in env.")

    timeout_seconds = _coerce_postgrest_timeout(postgrest_timeout_seconds)

    # Create client with anon key (for RLS to work, we need anon key, not service role)
    client = _SlottedSupabaseClient(
        SUPABASE_URL,
        SUPABASE_ANON_KEY,
        options=ClientOptions(postgrest_client_timeout=timeout_seconds),
    )

    # Set the JWT token for PostgREST to enable RLS.
    try:
        if hasattr(client, "postgrest") and hasattr(client.postgrest, "auth"):
            client.postgrest.auth(jwt_token)
        elif hasattr(client, "set_session"):
            client.set_session(jwt_token)
    except AttributeError:
        pass

    return client
