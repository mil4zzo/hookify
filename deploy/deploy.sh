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

# Prefixo das imagens. O compose nomeia as imagens como "<projeto>-<servico>",
# e o projeto e "hookify" (top-level `name:` no docker-compose.yml). Se aquele
# nome mudar, este tem que mudar junto.
IMAGE_PREFIX="hookify"

# Preenchido por git_pull() quando o pull traz migrations novas. So avisa —
# este script nao toca no banco.
PENDING_MIGRATIONS=""

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
HEALTH_ONLY=false
DO_ROLLBACK=false

usage() {
  cat <<EOF
Usage: ./deploy.sh [--no-cache] [--skip-pull] [--pre-clean]
       ./deploy.sh --health-only
       ./deploy.sh --rollback

  --no-cache     build sem cache (mais lento, 100% determinístico)
  --skip-pull    não faz git pull
  --pre-clean    roda cleanup SAFE antes do build (útil se o disco estiver apertado)

  --health-only  só roda os health checks contra o que já está no ar.
                 Não builda, não derruba nada, não pega o lock de deploy.
  --rollback     volta as imagens :prev (a versão anterior) e recria os
                 containers. NÃO mexe no código nem no banco — veja do_rollback().
EOF
}

for arg in "$@"; do
  case "$arg" in
    --no-cache) USE_CACHE=false ;;
    --skip-pull) DO_PULL=false ;;
    --pre-clean) RUN_PRE_CLEAN=true ;;
    --health-only) HEALTH_ONLY=true ;;
    --rollback) DO_ROLLBACK=true ;;
    -h|--help) usage; exit 0 ;;
    *) echo "❌ Argumento desconhecido: $arg"; usage; exit 1 ;;
  esac
done

if [ "$HEALTH_ONLY" = true ] && [ "$DO_ROLLBACK" = true ]; then
  echo "❌ --health-only e --rollback são mutuamente exclusivos."
  exit 1
fi

# Lock: evita 2 deploys ao mesmo tempo.
# --health-only é read-only, então não disputa o lock: dá para checar a saúde
# da produção mesmo com um deploy em andamento (que é justo quando mais se quer).
LOCK_FILE="/tmp/hookify_deploy.lock"
if [ "$HEALTH_ONLY" = false ]; then
  exec 9>"$LOCK_FILE"
  if ! flock -n 9; then
    echo "❌ Já existe um deploy rodando (lock: $LOCK_FILE)."
    exit 1
  fi
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
  if [ "$DO_PULL" = false ]; then
    echo "⏭️  Skip git pull (--skip-pull). Deployando o código local:"
    echo "   $(cd "$PROJECT_DIR" && git log --oneline -1)"
    echo ""
    return 0
  fi

  echo "📦 Fazendo pull do código..."
  cd "$PROJECT_DIR"

  local before after
  before="$(git rev-parse HEAD)"

  # Antes isto era `git pull ... || echo "continuando com código local..."`.
  # Engolir a falha é pior do que parece: o deploy segue e publica um commit
  # DIFERENTE do que se pensa que está sendo publicado — árvore suja, conflito,
  # rede caída, todos viravam "deploy silenciosamente errado". Agora aborta.
  # Para deployar o código local de propósito existe --skip-pull.
  git fetch origin main || true
  if ! git pull origin main; then
    echo ""
    echo "❌ git pull falhou. Abortando ANTES de tocar em qualquer container."
    echo "   Resolva no servidor (git status) ou use --skip-pull para deployar"
    echo "   o código local deliberadamente."
    exit 1
  fi

  after="$(git rev-parse HEAD)"
  echo ""
  echo "📌 Código a deployar: $(git log --oneline -1)"

  detect_new_migrations "$before" "$after"
  echo ""
}

# Este script nunca toca no banco — mas o pull pode trazer migrations que ainda
# não foram aplicadas, e descobrir isso depois de um erro em produção é caro.
# Só avisa: não dá para saber daqui o que já foi aplicado no Supabase.
detect_new_migrations() {
  local before=$1 after=$2
  [ "$before" = "$after" ] && return 0

  local migs
  migs="$(git diff --name-only --diff-filter=AM "$before" "$after" -- supabase/migrations/ 2>/dev/null || true)"
  [ -z "$migs" ] && return 0

  PENDING_MIGRATIONS="$migs"
  echo ""
  echo "⚠️  MIGRATIONS no intervalo puxado — confira se já foram aplicadas no banco:"
  echo "$migs" | sed 's|^supabase/migrations/|   • |'
}

pre_clean_if_requested() {
  if [ "$RUN_PRE_CLEAN" = true ]; then
    echo "🧹 Rodando cleanup SAFE antes do build (--pre-clean)..."
    bash "$DEPLOY_DIR/cleanup.sh" --safe --aggressive || true
    echo ""
  fi
}

# Pega erro de YAML, chave desconhecida ou interpolacao quebrada em segundos —
# antes de buildar, de derrubar, de qualquer coisa.
validate_compose() {
  echo "🧪 Validando docker-compose.yml..."
  cd "$DEPLOY_DIR"
  if ! compose config -q; then
    echo "❌ docker-compose.yml inválido. Abortando antes de tocar em qualquer container."
    exit 1
  fi
  echo "✅ Compose válido."
  echo ""
}

# Referencia de imagem que um servico esta usando AGORA (ex: "hookify-backend").
image_ref_of() {
  local svc=$1 cid img
  cid="$(compose ps -q "$svc" 2>/dev/null || true)"
  if [ -n "$cid" ]; then
    img="$(docker inspect -f '{{.Config.Image}}' "$cid" 2>/dev/null || true)"
    if [ -n "$img" ]; then
      echo "$img"
      return 0
    fi
  fi
  echo "${IMAGE_PREFIX}-${svc}"
}

# Rede de seguranca: marca as imagens em producao como :prev ANTES do build.
# Sem isto, se o build passa mas o app quebra em runtime, o unico caminho de
# volta e rebuildar do commit anterior — minutos. Com a tag, --rollback resolve
# em segundos porque a imagem antiga ainda esta no disco.
tag_prev_images() {
  echo "🏷️  Marcando as imagens atuais como :prev (rede de segurança p/ --rollback)..."
  local svc ref base
  for svc in "$SERVICE_BACKEND" "$SERVICE_FRONTEND"; do
    ref="$(image_ref_of "$svc")"
    base="${ref%%:*}"
    if docker image inspect "$ref" >/dev/null 2>&1; then
      docker tag "$ref" "${base}:prev"
      echo "   ✅ $ref → ${base}:prev"
    else
      echo "   ⏭️  $ref ainda não existe (primeiro deploy?) — sem :prev para este serviço."
    fi
  done
  echo ""
}

# ATENCAO ao escopo: rollback troca a IMAGEM, e so isso.
#   - NAO mexe no codigo em $PROJECT_DIR (o git segue no commit novo, entao um
#     ./deploy.sh depois disto republica a versao quebrada);
#   - NAO desfaz migration nenhuma.
# Serve para parar a sangria rapido; o conserto de verdade e reverter o commit.
do_rollback() {
  echo "⏪ ROLLBACK: voltando para as imagens :prev..."
  cd "$DEPLOY_DIR"

  local svc ref base missing=false
  for svc in "$SERVICE_BACKEND" "$SERVICE_FRONTEND"; do
    ref="$(image_ref_of "$svc")"
    base="${ref%%:*}"
    if ! docker image inspect "${base}:prev" >/dev/null 2>&1; then
      echo "   ❌ ${base}:prev não existe."
      missing=true
    fi
  done

  if [ "$missing" = true ]; then
    echo ""
    echo "❌ Sem imagens :prev para voltar. A tag só passa a existir a partir do"
    echo "   primeiro deploy feito com esta versão do script."
    exit 1
  fi

  for svc in "$SERVICE_BACKEND" "$SERVICE_FRONTEND"; do
    ref="$(image_ref_of "$svc")"
    base="${ref%%:*}"
    docker tag "${base}:prev" "${base}:latest"
    echo "   ✅ ${base}:prev → ${base}:latest"
  done
  echo ""

  start_stack
  wait_running
  health_checks

  echo "⚠️  O código em $PROJECT_DIR continua no commit novo:"
  echo "   $(cd "$PROJECT_DIR" && git log --oneline -1)"
  echo "   Um ./deploy.sh agora republica a versão que você acabou de tirar do ar."
  echo "   Para consertar de verdade: reverta o commit e faça deploy."
  echo ""

  final_report
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
# Um unico check parametrizado para os dois servicos: eles so diferem em porta,
# path e codigos aceitos. Prefere o veredito do HEALTHCHECK nativo da imagem
# (a chamada sai de DENTRO do container — nao depende de rede nem de DNS) e cai
# para curl no IP do container quando a imagem nao define HEALTHCHECK.
#
# O fallback nao e teorico: o Dockerfile.frontend so ganhou HEALTHCHECK agora,
# entao um container criado de uma imagem antiga ainda cai por aqui.
check_service() {
  local label=$1 svc=$2 port=$3 path=$4 accept=$5
  local cid st="" ip="" code="" i=0 max=60

  echo "${label}:"
  cid="$(compose ps -q "$svc" 2>/dev/null || true)"
  if [ -z "$cid" ]; then
    echo "❌ ${label}: container não encontrado."
    HEALTH_FAILED=true
    return 0
  fi

  while [ $i -lt $max ]; do
    st="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cid" 2>/dev/null || echo "unknown")"
    case "$st" in
      healthy)
        echo "✅ ${label} healthy (HEALTHCHECK da imagem)"
        return 0
        ;;
      unhealthy)
        echo "❌ ${label} unhealthy (HEALTHCHECK da imagem)"
        compose logs --tail=200 "$svc" || true
        HEALTH_FAILED=true
        return 0
        ;;
      none|unknown)
        check_service_by_ip "$label" "$svc" "$cid" "$port" "$path" "$accept"
        return 0
        ;;
    esac
    i=$((i+1))
    echo "⏳ ($i/$max) ${svc}=$st"
    sleep 2
  done

  echo "❌ ${label} não ficou healthy em $((max*2))s (último estado: $st)"
  compose logs --tail=200 "$svc" || true
  HEALTH_FAILED=true
}

# Fallback: o host alcanca o IP do container direto na bridge, mesmo sem porta
# publicada — que e exatamente o que o check antigo (localhost:8000) nao fazia.
check_service_by_ip() {
  local label=$1 svc=$2 cid=$3 port=$4 path=$5 accept=$6
  local ip code="" i=0 max=30 url

  ip="$(container_ip "$cid")"
  if [ -z "$ip" ]; then
    echo "❌ ${label}: container sem IP na rede."
    HEALTH_FAILED=true
    return 0
  fi

  url="http://${ip}:${port}${path}"
  echo "   (imagem sem HEALTHCHECK — checando ${url})"

  while [ $i -lt $max ]; do
    code="$(http_code "$url")"
    if echo " $accept " | grep -q " $code "; then
      echo "✅ ${label} respondendo (HTTP $code em $url)"
      return 0
    fi
    i=$((i+1))
    echo "⏳ ($i/$max) ${svc}=HTTP $code"
    sleep 2
  done

  echo "❌ ${label} falhou (último HTTP $code em $url)"
  compose logs --tail=200 "$svc" || true
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

# Health de verdade. O `/health` responde 200 com o app inteiro quebrado: ele nao
# toca no banco. Foi assim que os dois deploys de 2026-08-25 fecharam verdes com
# 100% das rotas em 500 -- o cliente Supabase estourava na construcao e o unico
# sintoma visivel era o navegador do usuario.
#
# Este check REPROVA o deploy de proposito (diferente do check_public, que e so
# aviso): se o backend nao consegue consultar o banco, nao ha deploy bom.
check_readiness() {
  local cid ip url code i=0 max=20
  echo ""
  echo "Readiness (constrói o cliente Supabase e consulta o banco de verdade):"

  cid="$(compose ps -q "$SERVICE_BACKEND" 2>/dev/null || true)"
  if [ -z "$cid" ]; then
    echo "❌ Readiness: container do backend não encontrado."
    HEALTH_FAILED=true
    return 0
  fi

  ip="$(container_ip "$cid")"
  if [ -z "$ip" ]; then
    echo "❌ Readiness: container sem IP na rede."
    HEALTH_FAILED=true
    return 0
  fi

  url="http://${ip}:8000/health/ready"
  while [ $i -lt $max ]; do
    code="$(http_code "$url")"
    if [ "$code" = "200" ]; then
      echo "✅ Backend pronto — consulta ao banco OK ($url)"
      return 0
    fi
    i=$((i+1))
    echo "⏳ ($i/$max) readiness=HTTP $code"
    sleep 2
  done

  echo "❌ Backend NÃO consegue servir (último HTTP $code em $url)."
  echo "   503 aqui = processo de pé, banco inalcançável. O corpo diz qual erro:"
  curl -s --max-time 10 "$url" | head -c 600 || true
  echo ""
  compose logs --tail=100 "$SERVICE_BACKEND" || true
  HEALTH_FAILED=true
}

health_checks() {
  echo "🔍 Health checks..."
  check_service "Backend"  "$SERVICE_BACKEND"  8000 "/health" "200"
  check_readiness
  echo ""
  check_service "Frontend" "$SERVICE_FRONTEND" 3000 ""        "200 307 308 404"
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

  # Repetido aqui de proposito: o aviso do git_pull rolou centenas de linhas de
  # build atras e ninguem ia ve-lo.
  if [ -n "$PENDING_MIGRATIONS" ]; then
    echo "⚠️  MIGRATIONS vieram neste pull — confirme se já estão aplicadas no banco:"
    echo "$PENDING_MIGRATIONS" | sed 's|^supabase/migrations/|   • |'
    echo ""
  fi

  # Um check que nao tem consequencia nao e um check. Antes daqui o script
  # imprimia "✅ Deploy finalizado!" mesmo com os health checks reprovando —
  # um deploy quebrado aparecia como verde.
  if [ "$HEALTH_FAILED" = true ]; then
    echo "❌ Deploy CONCLUÍDO COM FALHA nos health checks — a aplicação pode estar fora do ar."
    echo "   Logs:      cd $DEPLOY_DIR && $COMPOSE_BIN -f docker-compose.yml logs -f"
    echo "   Rollback:  cd $DEPLOY_DIR && ./deploy.sh --rollback"
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

# Modos curtos, antes do pipeline normal.
if [ "$HEALTH_ONLY" = true ]; then
  cd "$DEPLOY_DIR"
  health_checks
  if [ "$HEALTH_FAILED" = true ]; then
    echo "❌ Health checks reprovaram."
    exit 1
  fi
  echo "✅ Tudo saudável."
  exit 0
fi

if [ "$DO_ROLLBACK" = true ]; then
  do_rollback
  exit 0
fi

check_disk_space
git_pull
load_env_minimal
validate_compose
pre_clean_if_requested
tag_prev_images
build_images
stop_stack
start_stack
wait_running
post_build_cleanup
health_checks
final_report