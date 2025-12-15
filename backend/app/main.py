from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import logging
from app.core.config import CORS_ORIGINS, LOG_LEVEL
from app.core.logging_config import setup_httpx_logging_filter
from app.routes.facebook import router as facebook_router
from app.routes.analytics import router as analytics_router
from app.routes.connectors_facebook import router as fb_connector_router
from app.routes.google_integration import router as google_integration_router
from app.routes.onboarding import router as onboarding_router

# Configure logging
logging.basicConfig(level=getattr(logging, LOG_LEVEL.upper()))
logger = logging.getLogger(__name__)

# Configurar filtro para truncar URLs longas nos logs do httpx
# Limita URLs a 300 caracteres para preservar legibilidade
setup_httpx_logging_filter(max_url_length=300)

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
