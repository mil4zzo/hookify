#!/bin/bash
set -euo pipefail

echo "🚀 Iniciando deploy do Hookify (SAFE + otimizado)..."

PROJECT_DIR="/var/www/hookify"
DEPLOY_DIR="$PROJECT_DIR/deploy"
COMPOSE_PATH="$DEPLOY_DIR/docker-compose.yml"

SERVICE_BACKEND="backend"
SERVICE_FRONTEND="frontend"

# Health checks locais
BACKEND_HEALTH_URL="http://localhost:8000/health"
FRONTEND_URL="http://localhost:3000"

# Requer pelo menos 5GB livres
REQUIRED_SPACE_KB=5242880

# Política de cache do BuildKit
# Mantém cache pequeno para builds rápidos, sem explodir disco.
BUILDKIT_KEEP_STORAGE="5GB"
BUILDKIT_PRUNE_UNTIL_HOURS=168 # 7 dias (fallback se keep-storage não existir)

# Flags
USE_CACHE=true
DO_PULL=true
RUN_PRE_CLEAN=false

usage() {
  cat <<EOF
Usage: ./deploy.sh [--no-cache] [--skip-pull] [--pre-clean]

  --no-cache   build sem cache (mais lento, 100% determinístico)
  --skip-pull  não faz git pull
  --pre-clean  roda cleanup SAFE antes do build (útil se o disco estiver apertado)
EOF
}

for arg in "${@:-}"; do
  case "$arg" in
    --no-cache) USE_CACHE=false ;;
    --skip-pull) DO_PULL=false ;;
    --pre-clean) RUN_PRE_CLEAN=true ;;
    -h|--help) usage; exit 0 ;;
    *) echo "❌ Argumento desconhecido: $arg"; usage; exit 1 ;;
  esac
done

# Lock: evita 2 deploys ao mesmo tempo
LOCK_FILE="/tmp/hookify_deploy.lock"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "❌ Já existe um deploy rodando (lock: $LOCK_FILE)."
  exit 1
fi

detect_compose() {
  if docker compose version >/dev/null 2>&1; then
    echo "docker compose"
    return
  fi
  if command -v docker-compose >/dev/null 2>&1; then
    echo "docker-compose"
    return
  fi
  echo "❌ Nem 'docker compose' nem 'docker-compose' encontrados."
  exit 1
}

COMPOSE_BIN="$(detect_compose)"

compose() {
  # Wrapper para suportar docker compose e docker-compose
  if [ "$COMPOSE_BIN" = "docker compose" ]; then
    docker compose -f "$COMPOSE_PATH" "$@"
  else
    docker-compose -f "$COMPOSE_PATH" "$@"
  fi
}

get_env_value() {
  local file=$1
  local key=$2
  if [ -f "$file" ]; then
    grep -E "^${key}=" "$file" | head -n 1 | cut -d '=' -f2- | sed 's/^"//;s/"$//'
  fi
}

load_env_minimal() {
  # Mantém compatível com o que você já faz.
  # Mesmo com env_file no compose, exportar ajuda em build args e substitutions.
  if [ -f "$PROJECT_DIR/backend/.env" ]; then
    export FACEBOOK_CLIENT_ID="$(get_env_value "$PROJECT_DIR/backend/.env" "FACEBOOK_CLIENT_ID")"
    export FACEBOOK_CLIENT_SECRET="$(get_env_value "$PROJECT_DIR/backend/.env" "FACEBOOK_CLIENT_SECRET")"
    export SUPABASE_URL="$(get_env_value "$PROJECT_DIR/backend/.env" "SUPABASE_URL")"
    export SUPABASE_KEY="$(get_env_value "$PROJECT_DIR/backend/.env" "SUPABASE_KEY")"
    export SUPABASE_ANON_KEY="$(get_env_value "$PROJECT_DIR/backend/.env" "SUPABASE_ANON_KEY")"
    export SUPABASE_SERVICE_ROLE_KEY="$(get_env_value "$PROJECT_DIR/backend/.env" "SUPABASE_SERVICE_ROLE_KEY")"
    export SUPABASE_JWKS_URL="$(get_env_value "$PROJECT_DIR/backend/.env" "SUPABASE_JWKS_URL")"
    export ENCRYPTION_KEY="$(get_env_value "$PROJECT_DIR/backend/.env" "ENCRYPTION_KEY")"
    export LOG_LEVEL="$(get_env_value "$PROJECT_DIR/backend/.env" "LOG_LEVEL")"
  fi

  if [ -f "$PROJECT_DIR/frontend/.env.local" ]; then
    export NEXT_PUBLIC_SUPABASE_URL="$(get_env_value "$PROJECT_DIR/frontend/.env.local" "NEXT_PUBLIC_SUPABASE_URL")"
    export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY="$(get_env_value "$PROJECT_DIR/frontend/.env.local" "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY")"
    export NEXT_PUBLIC_API_BASE_URL="$(get_env_value "$PROJECT_DIR/frontend/.env.local" "NEXT_PUBLIC_API_BASE_URL")"
    export NEXT_PUBLIC_FB_REDIRECT_URI="$(get_env_value "$PROJECT_DIR/frontend/.env.local" "NEXT_PUBLIC_FB_REDIRECT_URI")"
    export NEXT_PUBLIC_USE_REMOTE_API="$(get_env_value "$PROJECT_DIR/frontend/.env.local" "NEXT_PUBLIC_USE_REMOTE_API")"
  fi
}

unset_sensitive_env() {
  unset FACEBOOK_CLIENT_SECRET || true
  unset SUPABASE_SERVICE_ROLE_KEY || true
  unset ENCRYPTION_KEY || true
}

check_disk_space() {
  echo "💾 Verificando espaço em disco..."
  local available_kb available_h
  available_kb=$(df / | tail -1 | awk '{print $4}')
  available_h=$(df -h / | tail -1 | awk '{print $4}')

  if [ "$available_kb" -lt "$REQUIRED_SPACE_KB" ]; then
    echo "⚠️  Espaço baixo: ${available_h} disponível (recomendado ≥ 5GB)."
    echo "🧹 Rodando cleanup SAFE..."
    bash "$DEPLOY_DIR/cleanup.sh" --safe || true
    available_kb=$(df / | tail -1 | awk '{print $4}')
    available_h=$(df -h / | tail -1 | awk '{print $4}')
    echo "💾 Depois do cleanup: ${available_h}"

    if [ "$available_kb" -lt "$REQUIRED_SPACE_KB" ]; then
      echo "❌ Ainda sem espaço suficiente. Libere espaço e tente novamente."
      exit 1
    fi
  else
    echo "✅ Espaço ok: ${available_h} disponível"
  fi
  echo ""
}

git_pull() {
  if [ "$DO_PULL" = true ]; then
    echo "📦 Fazendo pull do código..."
    cd "$PROJECT_DIR"
    git fetch origin main || true
    git pull origin main || echo "⚠️  Git pull falhou, continuando com código local..."
    echo ""
  else
    echo "⏭️  Skip git pull (--skip-pull)."
    echo ""
  fi
}

pre_clean_if_requested() {
  if [ "$RUN_PRE_CLEAN" = true ]; then
    echo "🧹 Rodando cleanup SAFE antes do build (--pre-clean)..."
    bash "$DEPLOY_DIR/cleanup.sh" --safe --aggressive || true
    echo ""
  fi
}

stop_stack() {
  echo "🐳 Parando stack (SEM remover volumes)..."
  cd "$DEPLOY_DIR"
  compose down || echo "⚠️  Nada para parar (ok)."
  echo ""
}

build_images() {
  echo "🔨 Build das imagens..."
  cd "$DEPLOY_DIR"
  if [ "$USE_CACHE" = true ]; then
    echo "💡 Build com cache (rápido) + --pull"
    compose build --pull
  else
    echo "⚠️  Build sem cache (--no-cache) + --pull"
    compose build --no-cache --pull
  fi
  echo ""
}

post_build_cleanup() {
  echo "🧹 Limpando cache de build (BuildKit) para não explodir /var..."

  # Tenta manter até 5GB (se suportado), senão usa filtro por idade.
  if docker builder prune -af --keep-storage "$BUILDKIT_KEEP_STORAGE" >/dev/null 2>&1; then
    echo "✅ Build cache reduzido (mantendo ~${BUILDKIT_KEEP_STORAGE})."
  else
    docker builder prune -af --filter "until=${BUILDKIT_PRUNE_UNTIL_HOURS}h" >/dev/null 2>&1 || true
    echo "✅ Build cache reduzido (mais velho que ${BUILDKIT_PRUNE_UNTIL_HOURS}h)."
  fi

  # Remove só dangling images (seguro)
  docker image prune -f >/dev/null 2>&1 || true
  echo ""
}

start_stack() {
  echo "🚀 Subindo stack..."
  cd "$DEPLOY_DIR"
  compose up -d --force-recreate
  echo ""
}

wait_running() {
  echo "⏳ Aguardando containers ficarem 'running'..."
  local max=30
  local i=0

  while [ $i -lt $max ]; do
    local b_id f_id b_st f_st
    b_id="$(compose ps -q "$SERVICE_BACKEND" 2>/dev/null || true)"
    f_id="$(compose ps -q "$SERVICE_FRONTEND" 2>/dev/null || true)"
    b_st="not_running"
    f_st="not_running"

    if [ -n "$b_id" ]; then b_st="$(docker inspect -f '{{.State.Status}}' "$b_id" 2>/dev/null || echo not_running)"; fi
    if [ -n "$f_id" ]; then f_st="$(docker inspect -f '{{.State.Status}}' "$f_id" 2>/dev/null || echo not_running)"; fi

    if [ "$b_st" = "running" ] && [ "$f_st" = "running" ]; then
      echo "✅ Containers running."
      echo ""
      return 0
    fi

    i=$((i+1))
    echo "⏳ ($i/$max) backend=$b_st frontend=$f_st"
    sleep 2
  done

  echo "❌ Containers não ficaram running a tempo."
  compose ps || true
  echo "📝 Logs recentes:"
  compose logs --tail=120 || true
  exit 1
}

health_checks() {
  echo "🔍 Health checks..."

  echo "Backend (/health, 8000):"
  local b_code
  b_code="$(curl -s -o /dev/null -w "%{http_code}" "$BACKEND_HEALTH_URL" || echo "000")"
  if [ "$b_code" = "200" ]; then
    echo "✅ Backend OK (HTTP 200)"
  else
    echo "❌ Backend falhou (HTTP $b_code)"
    echo "📝 Logs backend:"
    compose logs --tail=200 "$SERVICE_BACKEND" || true
  fi

  echo ""
  echo "Frontend (3000):"
  local f_code
  f_code="$(curl -s -o /dev/null -w "%{http_code}" "$FRONTEND_URL" || echo "000")"
  if [ "$f_code" = "200" ] || [ "$f_code" = "404" ]; then
    echo "✅ Frontend respondendo (HTTP $f_code)"
  else
    echo "❌ Frontend falhou (HTTP $f_code)"
    echo "📝 Logs frontend:"
    compose logs --tail=200 "$SERVICE_FRONTEND" || true
  fi

  echo ""
}

final_report() {
  echo "📊 Status final:"
  compose ps || true
  echo ""
  echo "🐳 Docker disk usage:"
  docker system df || true
  echo ""
  echo "💾 Disco:"
  df -h / || true
  echo ""
  echo "✅ Deploy finalizado! https://hookifyads.com"
}

trap unset_sensitive_env EXIT

# Pipeline
check_disk_space
git_pull
load_env_minimal
pre_clean_if_requested
stop_stack
build_images
post_build_cleanup
start_stack
wait_running
health_checks
final_report