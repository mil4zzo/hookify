from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import logging
from app.core.config import CORS_ORIGINS, LOG_AD_ID_TRUNCATED, LOG_LEVEL, LOG_SUPPRESS_HTTPX
from app.core.logging_config import setup_httpx_logging_filter
from app.routes.facebook import router as facebook_router
from app.routes.analytics import router as analytics_router
from app.routes.connectors_facebook import router as fb_connector_router
from app.routes.google_integration import router as google_integration_router
from app.routes.onboarding import router as onboarding_router
from app.routes.user import router as user_router

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

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(facebook_router)
app.include_router(analytics_router)
app.include_router(fb_connector_router)
app.include_router(google_integration_router)
app.include_router(onboarding_router)
app.include_router(user_router)

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
        "version": "0.1.0"
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
