#!/usr/bin/env python3
"""
Script para testar o backend FastAPI.
"""

import os
import sys
from pathlib import Path

# Adicionar o diretório backend ao path
backend_dir = Path(__file__).parent / "backend"
sys.path.insert(0, str(backend_dir))

# Configurar variáveis de ambiente
os.environ["FACEBOOK_CLIENT_ID"] = "1013320407465551"
os.environ["FACEBOOK_CLIENT_SECRET"] = "aff296e102fc1692b97c6c859f314963"
os.environ["FACEBOOK_AUTH_BASE_URL"] = "https://www.facebook.com/v20.0/dialog/oauth"
os.environ["FACEBOOK_TOKEN_URL"] = "https://graph.facebook.com/v20.0/oauth/access_token"
os.environ["SUPABASE_URL"] = "https://yyhiwayyvawsdsptdklx.supabase.co"
os.environ["SUPABASE_KEY"] = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl5aGl3YXl5dmF3c2RzcHRka2x4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg1Nzc4MTQsImV4cCI6MjA3NDE1MzgxNH0.hCvnXlkSiN7-rytLgLh7PkHL2NekNbWe2lfA-z6dGoA"
os.environ["CORS_ORIGINS"] = "http://localhost:3000,http://localhost:8501"
os.environ["LOG_LEVEL"] = "info"

def test_backend():
    """Testa se o backend pode ser importado."""
    try:
        from app.main import app
        print("✅ Backend importado com sucesso!")
        return True
    except Exception as e:
        print(f"❌ Erro ao importar backend: {e}")
        return False

def start_backend():
    """Inicia o backend."""
    try:
        import uvicorn
        from app.main import app
        
        print("🚀 Iniciando backend FastAPI...")
        uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)
    except Exception as e:
        print(f"❌ Erro ao iniciar backend: {e}")
        return False

if __name__ == "__main__":
    if test_backend():
        start_backend()
    else:
        sys.exit(1)
