from fastapi import FastAPI, HTTPException, Request
import time
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
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
from app.core import client_disconnect
from app.core.client_disconnect import ClientDisconnectMiddleware, ClientGone
from app.core.db_concurrency import DBConcurrencyTimeout
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

# Compressão das respostas. Registrado ANTES DE QUALQUER OUTRO middleware = o
# mais INTERNO de todos, colado na rota. A posição não é estética: os
# `@app.middleware("http")` abaixo são BaseHTTPMiddleware, que reembrulham toda
# resposta como streaming SEM Content-Length. Se o GZip ficar por fora de um
# deles, não consegue saber o tamanho do corpo e comprime TUDO — inclusive o
# /health de 279 bytes (visto no teste ao registrá-lo depois do middleware de
# contexto). Colado na rota, ele vê o Content-Length real e honra minimum_size.
#
# É ASGI puro e só toca `send`; não interfere no leitor único de `receive` do
# ClientDisconnectMiddleware, que fica por fora de tudo.
#
# Medido em 2026-08-26: a API respondia SEM compressão nenhuma (nem aqui, nem no
# Traefik) — o /openapi.json de 128 kB saía com Content-Length 128175 e sem
# Content-Encoding. A resposta do Manager (JSON com arrays numéricos, ~1 MB)
# comprime 4-6x. `minimum_size=1000`: abaixo disso o cabeçalho custa mais que
# o ganho.
app.add_middleware(GZipMiddleware, minimum_size=1000)


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
    try:
        return await call_next(request)
    except DBConcurrencyTimeout as saturated:
        # Banco saturado: não há slot livre. É indisponibilidade temporária, não
        # bug — 503 + Retry-After, e WARNING sem stacktrace (não é exceção
        # inesperada). Devolver 500 aqui seria contraproducente: o TanStack
        # re-tenta 5xx por padrão, então a proteção contra sobrecarga geraria
        # MAIS carga exatamente quando o banco já está no limite.
        logger.warning(
            "Saturação de concorrência de banco em %s %s: %s",
            request.method, request.url.path, saturated,
        )
        return JSONResponse(
            status_code=503,
            content={"detail": "Serviço temporariamente sobrecarregado. Tente novamente."},
            headers={"Retry-After": "5"},
        )
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

# Detector de desconexão do cliente: registrado por ÚLTIMO = o MAIS EXTERNO de
# todos, por fora até do CORS. Precisa ser o leitor único do canal `receive`
# original — empilhado por dentro de um BaseHTTPMiddleware ele recebe o
# `receive_or_disconnect` do middleware de fora e a detecção morre em silêncio
# (foi exatamente esse o bug da primeira versão; ver client_disconnect.py).
#
# Ficar por fora do CORS é seguro: este middleware NÃO gera resposta alguma,
# só observa e delega. As respostas de erro continuam sendo produzidas por
# dentro do CORSMiddleware e portanto continuam carregando os headers.
app.add_middleware(ClientDisconnectMiddleware)


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
        # Cancelamento por desconexao. `checks` alto com `aborts` cravado em zero
        # significa DETECTOR QUEBRADO, nao "ninguem abandona request" — foi assim
        # que a primeira versao passou como no-op sem ninguem notar.
        "client_disconnect": client_disconnect.get_stats(),
    }

@app.get("/health/ready")
def readiness_check():
    """Prova que o app SERVE, nao apenas que o processo subiu.

    POR QUE ESTE ENDPOINT EXISTE
    ----------------------------
    Em 2026-08-25 o backend passou horas respondendo 500 em toda rota que toca o
    banco (o cliente Supabase estourava TypeError na construcao) e os DOIS
    deploys fecharam verdes: o `/health` nao consulta o banco, entao o
    HEALTHCHECK do container atestava apenas que o uvicorn estava de pe.
    Aqui a construcao do cliente e uma consulta real acontecem de verdade -- e o
    que o deploy.sh usa para reprovar um deploy.

    POR QUE SEPARADO DO /health, E NAO DENTRO DELE
    ---------------------------------------------
    O HEALTHCHECK do Docker continua apontando para o `/health` raso de
    proposito: se ele consultasse o banco, uma indisponibilidade do Supabase
    marcaria os containers como unhealthy e o Traefik os tiraria da rotacao --
    um solucao de banco viraria queda total do app, e a protecao seria a causa
    do outage. Liveness (processo vivo) e readiness (consegue servir) sao
    perguntas diferentes e nao podem ter a mesma consequencia.
    """
    from app.core.supabase_client import get_supabase_service

    inicio = time.perf_counter()
    try:
        # Consulta minima de proposito: o valor esta em atravessar o caminho
        # inteiro (construir o cliente, falar PostgREST, voltar), nao no dado.
        get_supabase_service().table("packs").select("id").limit(1).execute()
    except Exception as exc:
        logger.error("[readiness] banco inacessivel: %s", exc, exc_info=True)
        return JSONResponse(
            status_code=503,
            content={
                "status": "unavailable",
                "db": "erro",
                "detail": f"{type(exc).__name__}: {exc}",
            },
        )

    return {
        "status": "ready",
        "db": "ok",
        "db_latency_ms": round((time.perf_counter() - inicio) * 1000, 1),
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
