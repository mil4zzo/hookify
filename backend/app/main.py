from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import logging
from app.core.config import (
    BACKEND_THREADPOOL_LIMIT,
    CORS_ORIGINS,
    DB_MAX_CONCURRENT_CALLS,
    LOG_AD_ID_TRUNCATED,
    LOG_LEVEL,
    LOG_SUPPRESS_HTTPX,
)
from app.core import db_concurrency
from app.core.logging_config import setup_httpx_logging_filter
from app.core.rate_limit import rate_limit_middleware
from app.core.request_context import current_page_route, current_route
from app.core.client_disconnect import ClientGone, current_request
from app.routes.facebook import router as facebook_router
from app.routes.analytics import router as analytics_router
from app.routes.connectors_facebook import router as fb_connector_router
from app.routes.google_integration import router as google_integration_router
from app.routes.meta_usage import router as meta_usage_router
from app.routes.onboarding import router as onboarding_router
from app.routes.user import router as user_router
from app.routes.admin import router as admin_router
from app.routes.billing import router as billing_router
from app.routes.shares import router as shares_router
from app.routes.pack_shares import router as pack_shares_router
from app.routes.tags import router as tags_router
from app.routes.boards import router as boards_router

# Configure logging
logging.basicConfig(level=getattr(logging, LOG_LEVEL.upper()))
logger = logging.getLogger(__name__)

# Configurar filtro para truncar URLs longas nos logs do httpx
# LOG_AD_ID_TRUNCATED controla se id=in.(...) vira id=in.(...N IDs...)
setup_httpx_logging_filter(
    max_url_length=300,
    truncate_ad_ids=LOG_AD_ID_TRUNCATED,
)
# Suprimir logs INFO do httpx/httpcore (só WARNING+); desative com LOG_SUPPRESS_HTTPX=false
if LOG_SUPPRESS_HTTPX:
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)

# Create FastAPI app
app = FastAPI(
    title="Hookify Backend API",
    description="Backend API for Hookify Facebook Ads Analytics",
    version="0.1.0"
)

@app.middleware("http")
async def _set_request_context(request: Request, call_next):
    """Sets backend route and optional frontend page slug as request-scoped contextvars.

    Também converte exceções não-tratadas num JSON 500 AQUI (por dentro do
    CORSMiddleware, que é registrado depois deste e portanto fica por fora).
    Sem isso, o ServerErrorMiddleware do Starlette — sempre o mais externo —
    emite o 500 por fora do CORS, sem o header Access-Control-Allow-Origin. O
    browser então rejeita a resposta como um "Network Error" opaco em vez de
    expor o status/corpo real (foi o que mascarou o 23514 no callback do Facebook).
    HTTPExceptions não passam por aqui (o ExceptionMiddleware já as resolve como
    resposta), então continuam com status/corpo corretos.
    """
    t_route = current_route.set(request.url.path)
    t_page = current_page_route.set(request.headers.get("x-page-route") or None)
    # Expõe o Request para as rotas SÍNCRONAS poderem perguntar "o cliente ainda
    # está aí?" nos checkpoints (ver app/core/client_disconnect.py). Contextvars
    # são copiadas para a thread do pool, então o valor chega lá dentro.
    t_req = current_request.set(request)
    try:
        return await call_next(request)
    except ClientGone as gone:
        # Não é erro: o navegador desligou (ex.: troca de filtro no Manager) e a
        # rota cortou o trabalho restante. Ninguém vai ler esta resposta — ela
        # existe só para fechar o ciclo. Log em INFO, sem stacktrace e sem Sentry.
        logger.info(
            "Cliente desconectou em %s %s (etapa: %s) — trabalho restante abortado",
            request.method, request.url.path, gone.stage,
        )
        return JSONResponse(status_code=499, content={"detail": "Client Closed Request"})
    except Exception:
        logger.exception("Unhandled exception on %s %s", request.method, request.url.path)
        return JSONResponse(status_code=500, content={"detail": "Internal Server Error"})
    finally:
        current_route.reset(t_route)
        current_page_route.reset(t_page)
        current_request.reset(t_req)


# Rate limit registrado ANTES do CORSMiddleware (que é adicionado por último e
# portanto fica mais externo): os 429 precisam sair COM headers CORS, senão o
# browser os mascara como "Network Error" opaco (mesma armadilha do 500 acima).
app.middleware("http")(rate_limit_middleware)

# CORS deve envolver os middlewares acima (registrado por último = mais externo)
# para que as respostas de erro carreguem os headers CORS.
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,  # nunca "*" — guard de boot em config.py
    allow_credentials=True,
    # Explícitos em vez de "*": o app só usa estes verbos e cabeçalhos. Reduz a
    # superfície e faz um método/header novo aparecer como erro de CORS no dev
    # (sinal claro) em vez de passar despercebido.
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Page-Route"],
)


# Include routers
app.include_router(facebook_router)
app.include_router(analytics_router)
app.include_router(fb_connector_router)
app.include_router(google_integration_router)
app.include_router(meta_usage_router)
app.include_router(onboarding_router)
app.include_router(user_router)
app.include_router(admin_router)
app.include_router(billing_router)
app.include_router(shares_router)
app.include_router(pack_shares_router)
app.include_router(tags_router)
app.include_router(boards_router)

@app.on_event("startup")
async def _cap_threadpool() -> None:
    """Limita o threadpool das rotas sincronas (rede de seguranca de concorrencia).

    Toda rota `def` (nao `async def`) roda numa thread desse pool. O padrao do
    Starlette e 40 threads POR PROCESSO; com `uvicorn --workers 4` isso da ate
    160 operacoes bloqueantes simultaneas contra um banco que serve ~45
    conexoes. Em 2026-08-24 esse desequilibrio terminou em esgotamento de pool
    (53300) e crash do Postgres.

    Isto NAO substitui o semaforo de `app/core/db_concurrency.py`: aquele e
    cirurgico (so trabalho de banco, deixa chamada a Meta passar), este e o
    teto duro do processo. Os dois juntos evitam tanto o afogamento do banco
    quanto o crescimento indefinido de threads.
    """
    try:
        import anyio.to_thread

        limiter = anyio.to_thread.current_default_thread_limiter()
        previous = limiter.total_tokens
        limiter.total_tokens = BACKEND_THREADPOOL_LIMIT
        logger.info(
            "[startup] threadpool de rotas sincronas: %s -> %s por worker "
            "(teto do processo; concorrencia de banco = %s por worker)",
            previous,
            BACKEND_THREADPOOL_LIMIT,
            DB_MAX_CONCURRENT_CALLS,
        )
    except Exception as exc:  # nunca derrubar o boot por causa do limitador
        logger.warning("[startup] nao foi possivel ajustar o threadpool: %s", exc)


@app.get("/")
def root():
    """Health check endpoint."""
    return {"message": "Hookify Backend API is running", "version": "0.1.0"}

@app.get("/health")
def health_check():
    """Detailed health check."""
    return {
        "status": "healthy",
        "service": "hookify-backend",
        "version": "0.1.0",
        # Saturacao de banco por processo. Com --workers 4, cada worker responde
        # com os SEUS numeros: acquire_timeouts > 0 em qualquer um = teto atingido.
        "db_concurrency": db_concurrency.get_stats(),
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
