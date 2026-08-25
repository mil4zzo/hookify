from typing import Optional
import logging

import httpx
from supabase import create_client, Client, ClientOptions
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


class _SlottedHTTPXClient(httpx.Client):
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
    tudo. Ponto de extensao oficial do supabase-py (`ClientOptions.httpx_client`),
    nao remendo em internals.

    SO PostgREST, nunca Storage
    ---------------------------
    O supabase-py compartilha este MESMO cliente httpx com o Storage (verificado).
    Upload de miniatura nao consome conexao de banco e nao pode disputar um dos 8
    slots -- por isso o filtro por `/rest/v1/`. O Auth (GoTrue) tem cliente
    proprio e nao passa por aqui.

    A reentrancia do `db_slot` faz o slot ser contado UMA vez quando a chamada ja
    vem de dentro de um `with_postgrest_retry` (que tambem pega slot, para poder
    solta-lo entre as tentativas).
    """

    def send(self, request: httpx.Request, **kwargs):  # type: ignore[override]
        if "/rest/v1/" in request.url.path:
            # `send` com stream=False (o que o postgrest usa) le o corpo aqui
            # dentro, entao o slot cobre a chamada inteira -- nao so o handshake.
            with db_slot(f"postgrest:{request.method}"):
                return super().send(request, **kwargs)
        return super().send(request, **kwargs)


def _make_httpx_client(timeout_seconds: float) -> httpx.Client:
    return _SlottedHTTPXClient(timeout=timeout_seconds)


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

    _service_client = create_client(
        SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY,
        options=ClientOptions(
            postgrest_client_timeout=POSTGREST_TIMEOUT_SECONDS,
            httpx_client=_make_httpx_client(POSTGREST_TIMEOUT_SECONDS),
        ),
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
    client = create_client(
        SUPABASE_URL,
        SUPABASE_ANON_KEY,
        options=ClientOptions(
            postgrest_client_timeout=timeout_seconds,
            httpx_client=_make_httpx_client(timeout_seconds),
        ),
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
