import os
from pathlib import Path
from dotenv import load_dotenv

# Carregar .env do diretório backend
backend_dir = Path(__file__).parent.parent.parent
env_path = backend_dir / ".env"
load_dotenv(env_path)

CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:3000,https://localhost:3000,http://localhost:8501").split(",")

# Meta Graph API – versão centralizada
META_API_VERSION = os.getenv("META_API_VERSION", "v24.0")
META_GRAPH_BASE_URL = f"https://graph.facebook.com/{META_API_VERSION}/"

FACEBOOK_CLIENT_ID = os.getenv("FACEBOOK_CLIENT_ID")
FACEBOOK_CLIENT_SECRET = os.getenv("FACEBOOK_CLIENT_SECRET")
FACEBOOK_AUTH_BASE_URL = os.getenv("FACEBOOK_AUTH_BASE_URL", f"https://www.facebook.com/{META_API_VERSION}/dialog/oauth")
FACEBOOK_TOKEN_URL = os.getenv("FACEBOOK_TOKEN_URL", f"https://graph.facebook.com/{META_API_VERSION}/oauth/access_token")

# Facebook OAuth scopes
# Nota: para obter o vídeo (Video.source) de anúncios de forma consistente, geralmente é necessário
# conseguir um Page Access Token. No Hookify, nós resolvemos isso via:
# /me/accounts (token de usuário + permissões adequadas).
# Em produção, permissões de Pages podem exigir App Review dependendo do cenário.
FACEBOOK_OAUTH_SCOPES = os.getenv(
    "FACEBOOK_OAUTH_SCOPES",
    "public_profile,email,ads_read,ads_management,pages_show_list,pages_read_engagement,business_management",
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

# Logging flags - controle de verbosidade dos logs httpx/httpcore
# LOG_AD_ID_TRUNCATED: trunca id=in.(...) para id=in.(...N IDs...) nos logs.
#   Use false para ver URLs completas.
# LOG_SUPPRESS_HTTPX: se true, não emite logs INFO do httpx/httpcore (só WARNING+).
#   Use false para ver requisições HTTP nos logs.
LOG_AD_ID_TRUNCATED = os.getenv("LOG_AD_ID_TRUNCATED", "true").lower() in ("true", "1", "yes")
LOG_SUPPRESS_HTTPX = os.getenv("LOG_SUPPRESS_HTTPX", "true").lower() in ("true", "1", "yes")
# LOG_META_USAGE: se true, loga headers de usage (x-app-usage, x-business-use-case-usage,
#   x-ad-account-usage) retornados pela Meta API em cada request.
#   Use para observar consumo de quota antes de atingir rate limit.
LOG_META_USAGE = os.getenv("LOG_META_USAGE", "false").lower() in ("true", "1", "yes")

# Analytics (cutover gradual da RPC agregada do Manager)
ANALYTICS_MANAGER_RPC_ENABLED = os.getenv("ANALYTICS_MANAGER_RPC_ENABLED", "false").lower() in ("true", "1", "yes")
ANALYTICS_MANAGER_RPC_AB_COMPARE_ENABLED = os.getenv("ANALYTICS_MANAGER_RPC_AB_COMPARE_ENABLED", "false").lower() in ("true", "1", "yes")
ANALYTICS_MANAGER_RPC_FAIL_OPEN = os.getenv("ANALYTICS_MANAGER_RPC_FAIL_OPEN", "true").lower() in ("true", "1", "yes")
try:
    ANALYTICS_MANAGER_RPC_AB_SAMPLE_RATE = float(os.getenv("ANALYTICS_MANAGER_RPC_AB_SAMPLE_RATE", "0.1"))
except ValueError:
    ANALYTICS_MANAGER_RPC_AB_SAMPLE_RATE = 0.1
ANALYTICS_MANAGER_RPC_AB_SAMPLE_RATE = max(0.0, min(1.0, ANALYTICS_MANAGER_RPC_AB_SAMPLE_RATE))
try:
    ANALYTICS_MANAGER_POSTGREST_TIMEOUT_SECONDS = float(
        os.getenv("ANALYTICS_MANAGER_POSTGREST_TIMEOUT_SECONDS", "35")
    )
except ValueError:
    ANALYTICS_MANAGER_POSTGREST_TIMEOUT_SECONDS = 35.0
ANALYTICS_MANAGER_POSTGREST_TIMEOUT_SECONDS = max(1.0, ANALYTICS_MANAGER_POSTGREST_TIMEOUT_SECONDS)

# Supabase Auth (Frontend JWT validation and RLS usage)
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")  # NUNCA expor no frontend

# Thumbnail cache (best-effort, não bloqueia refresh principal)
THUMB_CACHE_ENABLED = os.getenv("THUMB_CACHE_ENABLED", "true").lower() in ("true", "1", "yes")
try:
    THUMB_CACHE_MIN_TTL_SECONDS = int(os.getenv("THUMB_CACHE_MIN_TTL_SECONDS", "900"))
except ValueError:
    THUMB_CACHE_MIN_TTL_SECONDS = 900
THUMB_CACHE_MIN_TTL_SECONDS = max(0, THUMB_CACHE_MIN_TTL_SECONDS)

# JWKS URL para validar JWT emitidos pelo Supabase
# Conforme documentação: https://supabase.com/docs/guides/auth/jwts
# O endpoint correto é: /auth/v1/.well-known/jwks.json (público, não requer autenticação)
SUPABASE_JWKS_URL = os.getenv("SUPABASE_JWKS_URL") or (
    f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json" if SUPABASE_URL else None
)

# AssemblyAI (speech-to-text para transcrição de vídeos de anúncios)
ASSEMBLYAI_API_KEY = os.getenv("ASSEMBLYAI_API_KEY")

# Chave de criptografia para tokens de conectores (se usar app-level encryption)
ENCRYPTION_KEY = os.getenv("ENCRYPTION_KEY")
 
