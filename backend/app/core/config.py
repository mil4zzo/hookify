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

# Facebook OAuth scopes
# Nota: para obter o vídeo (Video.source) de anúncios de forma consistente, geralmente é necessário
# conseguir um Page Access Token. No Hookify, nós resolvemos isso via:
# /me/adaccounts?fields=...promote_pages{access_token} (token de usuário + permissões adequadas).
# Em produção, permissões de Pages podem exigir App Review dependendo do cenário.
FACEBOOK_OAUTH_SCOPES = os.getenv(
    "FACEBOOK_OAUTH_SCOPES",
    "public_profile,email,ads_read,ads_management,pages_show_list,pages_read_engagement",
)

# Google OAuth / Sheets
GOOGLE_OAUTH_CLIENT_ID = os.getenv("GOOGLE_OAUTH_CLIENT_ID")
GOOGLE_OAUTH_CLIENT_SECRET = os.getenv("GOOGLE_OAUTH_CLIENT_SECRET")
# Opcional: usado apenas se você quiser fixar um redirect por ambiente
GOOGLE_OAUTH_REDIRECT_URI = os.getenv("GOOGLE_OAUTH_REDIRECT_URI")
GOOGLE_SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly"
GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly"
GOOGLE_USERINFO_EMAIL_SCOPE = "https://www.googleapis.com/auth/userinfo.email"
GOOGLE_USERINFO_PROFILE_SCOPE = "https://www.googleapis.com/auth/userinfo.profile"
GOOGLE_OAUTH_SCOPES = f"{GOOGLE_SHEETS_SCOPE} {GOOGLE_DRIVE_SCOPE} {GOOGLE_USERINFO_EMAIL_SCOPE} {GOOGLE_USERINFO_PROFILE_SCOPE}"
GOOGLE_OAUTH_AUTH_BASE_URL = os.getenv(
    "GOOGLE_OAUTH_AUTH_BASE_URL",
    "https://accounts.google.com/o/oauth2/v2/auth",
)
GOOGLE_OAUTH_TOKEN_URL = os.getenv(
    "GOOGLE_OAUTH_TOKEN_URL",
    "https://oauth2.googleapis.com/token",
)

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
LOG_LEVEL = os.getenv("LOG_LEVEL", "info")

# Supabase Auth (Frontend JWT validation and RLS usage)
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")  # NUNCA expor no frontend

# JWKS URL para validar JWT emitidos pelo Supabase
# Conforme documentação: https://supabase.com/docs/guides/auth/jwts
# O endpoint correto é: /auth/v1/.well-known/jwks.json (público, não requer autenticação)
SUPABASE_JWKS_URL = os.getenv("SUPABASE_JWKS_URL") or (
    f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json" if SUPABASE_URL else None
)

# Chave de criptografia para tokens de conectores (se usar app-level encryption)
ENCRYPTION_KEY = os.getenv("ENCRYPTION_KEY")
 