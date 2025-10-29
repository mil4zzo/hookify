import os
from pathlib import Path
from dotenv import load_dotenv

# Carregar .env do diretório backend
backend_dir = Path(__file__).parent.parent.parent
env_path = backend_dir / ".env"
load_dotenv(env_path)

CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:8501").split(",")
FACEBOOK_CLIENT_ID = os.getenv("FACEBOOK_CLIENT_ID")
FACEBOOK_CLIENT_SECRET = os.getenv("FACEBOOK_CLIENT_SECRET")
FACEBOOK_AUTH_BASE_URL = os.getenv("FACEBOOK_AUTH_BASE_URL", "https://www.facebook.com/v22.0/dialog/oauth")
FACEBOOK_TOKEN_URL = os.getenv("FACEBOOK_TOKEN_URL", "https://graph.facebook.com/v22.0/oauth/access_token")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
LOG_LEVEL = os.getenv("LOG_LEVEL", "info")
 