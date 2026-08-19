#!/bin/bash
set -euo pipefail

echo "🚀 Iniciando deploy do Hookify (SAFE + otimizado)..."

PROJECT_DIR="/var/www/hookify"
DEPLOY_DIR="$PROJECT_DIR/deploy"
COMPOSE_PATH="$DEPLOY_DIR/docker-compose.yml"

SERVICE_BACKEND="backend"
SERVICE_FRONTEND="frontend"

# Health checks
# Os containers NAO publicam portas no host: existem so na hookify-network e sao
# roteados pelo Traefik. Por isso "http://localhost:8000" no host nunca respondeu
# — o check antigo era falso negativo garantido. Ver health_checks() abaixo.
BACKEND_PUBLIC_HEALTH_URL="https://api.hookifyads.com/health"
FRONTEND_PUBLIC_URL="https://hookifyads.com"

# Vira true se qualquer check interno reprovar. Consumido por final_report().
HEALTH_FAILED=false

# Requer pelo menos 5GB livres.
# Com o build antes do down, as imagens antigas continuam referenciadas pelos
# containers em execucao enquanto as novas sao construidas — o pico de disco e
# mais alto do que era. ~900MB a mais, folgado dentro dos 5GB.
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

for arg in "$@"; do
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

http_code() {
  # Ecoa so o status HTTP. Nunca falha (000 = sem resposta) para nao abortar
  # o script sob `set -e` enquanto ainda estamos em retry.
  #
  # ATENCAO ao `||`: quando o curl nao conecta ele JA imprime "000" via -w e
  # ainda sai com codigo != 0. Um `|| echo "000"` concatena um segundo "000" e
  # o resultado vira "000000" — era exatamente isso que aparecia no log antigo
  # como "❌ Backend falhou (HTTP 000000)". Por isso capturamos primeiro e so
  # completamos se veio vazio.
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$1" 2>/dev/null)" || true
  if [ -n "$code" ]; then
    echo "$code"
  else
    echo "000"
  fi
}

container_ip() {
  docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$1" 2>/dev/null || true
}

# Backend: usa o veredito do HEALTHCHECK nativo (definido no Dockerfile.backend,
# que faz a chamada de DENTRO do container). E a fonte mais fiel — nao depende
# de porta publicada, de rede nem de DNS.
check_backend() {
  echo "Backend (HEALTHCHECK do Docker):"
  local cid i=0 max=60
  local st="" ip="" code=""
  cid="$(compose ps -q "$SERVICE_BACKEND" 2>/dev/null || true)"

  if [ -z "$cid" ]; then
    echo "❌ Backend: container nao encontrado."
    HEALTH_FAILED=true
    return 0
  fi

  while [ $i -lt $max ]; do
    st="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cid" 2>/dev/null || echo "unknown")"
    case "$st" in
      healthy)
        echo "✅ Backend healthy"
        return 0
        ;;
      unhealthy)
        echo "❌ Backend unhealthy"
        compose logs --tail=200 "$SERVICE_BACKEND" || true
        HEALTH_FAILED=true
        return 0
        ;;
      none|unknown)
        # Sem HEALTHCHECK na imagem: cai para checagem pelo IP do container.
        ip="$(container_ip "$cid")"
        code="$(http_code "http://${ip}:8000/health")"
        if [ "$code" = "200" ]; then
          echo "✅ Backend OK (HTTP 200 em http://${ip}:8000/health)"
        else
          echo "❌ Backend falhou (HTTP $code em http://${ip}:8000/health)"
          compose logs --tail=200 "$SERVICE_BACKEND" || true
          HEALTH_FAILED=true
        fi
        return 0
        ;;
    esac
    i=$((i+1))
    echo "⏳ ($i/$max) backend=$st"
    sleep 2
  done

  echo "❌ Backend nao ficou healthy em $((max*2))s (ultimo estado: $st)"
  compose logs --tail=200 "$SERVICE_BACKEND" || true
  HEALTH_FAILED=true
}

# Frontend: nao tem HEALTHCHECK na imagem, entao vamos pelo IP do container na
# rede — o host alcanca o IP do container direto, mesmo sem porta publicada.
check_frontend() {
  echo ""
  echo "Frontend (IP na rede do compose):"
  local cid i=0 max=30
  local ip="" code=""
  cid="$(compose ps -q "$SERVICE_FRONTEND" 2>/dev/null || true)"

  if [ -z "$cid" ]; then
    echo "❌ Frontend: container nao encontrado."
    HEALTH_FAILED=true
    return 0
  fi

  ip="$(container_ip "$cid")"
  if [ -z "$ip" ]; then
    echo "❌ Frontend: container sem IP na rede."
    HEALTH_FAILED=true
    return 0
  fi

  while [ $i -lt $max ]; do
    code="$(http_code "http://${ip}:3000")"
    case "$code" in
      200|307|308|404)
        echo "✅ Frontend respondendo (HTTP $code em http://${ip}:3000)"
        return 0
        ;;
    esac
    i=$((i+1))
    echo "⏳ ($i/$max) frontend=HTTP $code"
    sleep 2
  done

  echo "❌ Frontend falhou (ultimo HTTP $code em http://${ip}:3000)"
  compose logs --tail=200 "$SERVICE_FRONTEND" || true
  HEALTH_FAILED=true
}

# Ponta a ponta, atravessando Traefik + DNS + Cloudflare. E o que o usuario ve,
# mas depende de infra FORA deste deploy — por isso e AVISO, nunca reprovacao:
# um soluco de DNS/CF nao deve marcar como falho um deploy que esta de pe.
# Tem retry porque o Traefik leva alguns segundos para registrar o container novo.
check_public() {
  echo ""
  echo "Publico (Traefik/DNS/Cloudflare) — informativo, nao reprova o deploy:"
  local i=0 max=15
  local bc="000" fc="000"

  while [ $i -lt $max ]; do
    bc="$(http_code "$BACKEND_PUBLIC_HEALTH_URL")"
    [ "$bc" = "200" ] && break
    i=$((i+1))
    sleep 2
  done

  fc="$(http_code "$FRONTEND_PUBLIC_URL")"

  if [ "$bc" = "200" ]; then
    echo "✅ $BACKEND_PUBLIC_HEALTH_URL (HTTP $bc)"
  else
    echo "⚠️  $BACKEND_PUBLIC_HEALTH_URL (HTTP $bc) — cheque Traefik/DNS"
  fi

  case "$fc" in
    200|307|308) echo "✅ $FRONTEND_PUBLIC_URL (HTTP $fc)" ;;
    *)           echo "⚠️  $FRONTEND_PUBLIC_URL (HTTP $fc) — cheque Traefik/DNS" ;;
  esac
}

health_checks() {
  echo "🔍 Health checks..."
  check_backend
  check_frontend
  check_public
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
  echo "📌 Commit em producao: $(cd "$PROJECT_DIR" && git log --oneline -1 2>/dev/null || echo "desconhecido")"
  echo ""

  # Um check que nao tem consequencia nao e um check. Antes daqui o script
  # imprimia "✅ Deploy finalizado!" mesmo com os health checks reprovando —
  # um deploy quebrado aparecia como verde.
  if [ "$HEALTH_FAILED" = true ]; then
    echo "❌ Deploy CONCLUIDO COM FALHA nos health checks — a aplicacao pode estar fora do ar."
    echo "   Logs:     cd $DEPLOY_DIR && $COMPOSE_BIN -f docker-compose.yml logs -f"
    exit 1
  fi

  echo "✅ Deploy finalizado! https://hookifyads.com"
}

trap unset_sensitive_env EXIT

# Pipeline
#
# ORDEM IMPORTA: build ANTES do stop_stack. O `docker compose build` nao toca
# nos containers em execucao, entao a producao segue no ar durante o build
# inteiro (que e a parte lenta — o `npm run build` do frontend leva minutos).
# Se o build falhar, `set -e` aborta AQUI e a versao antiga continua servindo:
# a indisponibilidade fica restrita ao recreate, e um build quebrado deixa de
# derrubar o site. Antes era o contrario — o down vinha primeiro e qualquer
# erro de compilacao virava outage.
#
# post_build_cleanup vem DEPOIS do wait_running de proposito: so entao a imagem
# antiga deixa de ter container apontando para ela e o `image prune` a recolhe —
# e o prune nao concorre por I/O durante a subida dos containers.
check_disk_space
git_pull
load_env_minimal
pre_clean_if_requested
build_images
stop_stack
start_stack
wait_running
post_build_cleanup
health_checks
final_report