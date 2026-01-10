#!/bin/bash
set -e

echo "🚀 Iniciando deploy do Hookify..."

PROJECT_DIR="/var/www/hookify"
DEPLOY_DIR="$PROJECT_DIR/deploy"

# Verificar se foi passada flag --no-cache
USE_CACHE=true
if [ "$1" == "--no-cache" ]; then
    USE_CACHE=false
    echo "⚠️  Modo: Build sem cache (rebuild completo)"
else
    echo "💡 Modo: Build com cache (mais rápido, reutiliza layers)"
    echo "   Use './deploy.sh --no-cache' para forçar rebuild completo"
fi
echo ""

cd $PROJECT_DIR

# Função para verificar espaço em disco
check_disk_space() {
    echo "💾 Verificando espaço em disco..."
    
    # Obter espaço disponível em KB (partição raiz)
    AVAILABLE_SPACE_KB=$(df / | tail -1 | awk '{print $4}')
    AVAILABLE_SPACE_GB=$(df -h / | tail -1 | awk '{print $4}')
    
    # Requer pelo menos 5GB (5242880 KB) para build seguro
    REQUIRED_SPACE_KB=5242880
    
    if [ "$AVAILABLE_SPACE_KB" -lt "$REQUIRED_SPACE_KB" ]; then
        echo "⚠️  AVISO: Espaço em disco baixo!"
        echo "   Espaço disponível: ${AVAILABLE_SPACE_GB}"
        echo "   Espaço recomendado: 5GB"
        echo ""
        echo "💡 Opções:"
        echo "   1. Executar limpeza automática do Docker (recomendado)"
        echo "   2. Continuar mesmo assim (pode falhar)"
        echo "   3. Cancelar e executar limpeza manual"
        echo ""
        read -p "Escolha uma opção (1/2/3): " -n 1 -r
        echo
        
        case $REPLY in
            1)
                echo "🧹 Executando limpeza automática..."
                if [ -f "$DEPLOY_DIR/cleanup.sh" ]; then
                    bash "$DEPLOY_DIR/cleanup.sh"
                else
                    echo "⚠️  Script cleanup.sh não encontrado, executando limpeza básica..."
                    docker system prune -a --volumes -f
                fi
                echo ""
                echo "💾 Verificando espaço novamente..."
                NEW_AVAILABLE_SPACE_KB=$(df / | tail -1 | awk '{print $4}')
                NEW_AVAILABLE_SPACE_GB=$(df -h / | tail -1 | awk '{print $4}')
                echo "   Novo espaço disponível: ${NEW_AVAILABLE_SPACE_GB}"
                
                if [ "$NEW_AVAILABLE_SPACE_KB" -lt "$REQUIRED_SPACE_KB" ]; then
                    echo "❌ Ainda há pouco espaço. Por favor, libere mais espaço manualmente."
                    exit 1
                fi
                ;;
            2)
                echo "⚠️  Continuando com espaço baixo (pode falhar)..."
                ;;
            3)
                echo "❌ Deploy cancelado. Execute manualmente:"
                echo "   cd $DEPLOY_DIR && bash cleanup.sh"
                exit 1
                ;;
            *)
                echo "❌ Opção inválida. Deploy cancelado."
                exit 1
                ;;
        esac
    else
        echo "✅ Espaço em disco suficiente: ${AVAILABLE_SPACE_GB}"
    fi
    echo ""
}

# Verificar espaço antes de continuar
check_disk_space

echo "📦 Fazendo pull do código..."
git pull origin main || echo "⚠️  Git pull falhou, continuando com código local..."

# Função para ler valor de uma variável de um arquivo .env
get_env_value() {
    local file=$1
    local key=$2
    if [ -f "$file" ]; then
        grep -E "^${key}=" "$file" | cut -d '=' -f2- | sed 's/^"//;s/"$//'
    fi
}

# Carregar variáveis do backend (exportando apenas as necessárias)
if [ -f "$PROJECT_DIR/backend/.env" ]; then
    echo "📝 Carregando variáveis de ambiente do backend..."
    export FACEBOOK_CLIENT_ID=$(get_env_value "$PROJECT_DIR/backend/.env" "FACEBOOK_CLIENT_ID")
    export FACEBOOK_CLIENT_SECRET=$(get_env_value "$PROJECT_DIR/backend/.env" "FACEBOOK_CLIENT_SECRET")
    export SUPABASE_URL=$(get_env_value "$PROJECT_DIR/backend/.env" "SUPABASE_URL")
    export SUPABASE_KEY=$(get_env_value "$PROJECT_DIR/backend/.env" "SUPABASE_KEY")
    export SUPABASE_ANON_KEY=$(get_env_value "$PROJECT_DIR/backend/.env" "SUPABASE_ANON_KEY")
    export SUPABASE_SERVICE_ROLE_KEY=$(get_env_value "$PROJECT_DIR/backend/.env" "SUPABASE_SERVICE_ROLE_KEY")
    export SUPABASE_JWKS_URL=$(get_env_value "$PROJECT_DIR/backend/.env" "SUPABASE_JWKS_URL")
    export ENCRYPTION_KEY=$(get_env_value "$PROJECT_DIR/backend/.env" "ENCRYPTION_KEY")
    export LOG_LEVEL=$(get_env_value "$PROJECT_DIR/backend/.env" "LOG_LEVEL")
fi

# Carregar variáveis do frontend
if [ -f "$PROJECT_DIR/frontend/.env.local" ]; then
    echo "📝 Carregando variáveis de ambiente do frontend..."
    export NEXT_PUBLIC_SUPABASE_URL=$(get_env_value "$PROJECT_DIR/frontend/.env.local" "NEXT_PUBLIC_SUPABASE_URL")
    export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY=$(get_env_value "$PROJECT_DIR/frontend/.env.local" "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY")
    export NEXT_PUBLIC_API_BASE_URL=$(get_env_value "$PROJECT_DIR/frontend/.env.local" "NEXT_PUBLIC_API_BASE_URL")
    export NEXT_PUBLIC_FB_REDIRECT_URI=$(get_env_value "$PROJECT_DIR/frontend/.env.local" "NEXT_PUBLIC_FB_REDIRECT_URI")
    export NEXT_PUBLIC_USE_REMOTE_API=$(get_env_value "$PROJECT_DIR/frontend/.env.local" "NEXT_PUBLIC_USE_REMOTE_API")
fi

echo "🐳 Parando e removendo containers existentes..."
cd $DEPLOY_DIR
docker compose down -v || echo "⚠️  Nenhum container rodando"

# Remover imagens antigas para forçar rebuild
echo "🗑️  Removendo imagens antigas do projeto..."
docker rmi hookify-frontend hookify-backend 2>/dev/null || echo "⚠️  Imagens não encontradas (normal no primeiro deploy)"

# Fazer build com ou sem cache dependendo da flag
if [ "$USE_CACHE" == "true" ]; then
    echo "🔨 Fazendo build das imagens (com cache - reutilizando layers)..."
    docker compose build --pull
else
    echo "🔨 Fazendo build das imagens (sem cache - rebuild completo)..."
    docker compose build --no-cache --pull
fi

# Verificar se o build foi bem-sucedido
if [ $? -ne 0 ]; then
    echo "❌ Erro no build das imagens!"
    exit 1
fi

echo "🧹 Removendo imagens antigas/orfãs do projeto..."
# Remover imagens dangling (sem tag) - imagens antigas que não estão sendo usadas
# Isso remove automaticamente imagens que foram substituídas por novas builds
docker image prune -f || true

echo "🚀 Criando e iniciando containers..."
# Usar --force-recreate para garantir que containers sejam recriados
docker compose up -d --force-recreate

# Limpar variáveis sensíveis após o uso (por segurança)
unset FACEBOOK_CLIENT_SECRET
unset SUPABASE_SERVICE_ROLE_KEY
unset ENCRYPTION_KEY

echo "⏳ Aguardando containers iniciarem..."
sleep 10

# Verificar se containers estão rodando
echo "🔍 Verificando status dos containers..."
MAX_RETRIES=30
RETRY_COUNT=0
BACKEND_STATUS="not_running"
FRONTEND_STATUS="not_running"

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    BACKEND_STATUS=$(docker compose ps backend --format json 2>/dev/null | grep -o '"State":"[^"]*"' | cut -d'"' -f4 || echo "not_running")
    FRONTEND_STATUS=$(docker compose ps frontend --format json 2>/dev/null | grep -o '"State":"[^"]*"' | cut -d'"' -f4 || echo "not_running")
    
    if [ "$BACKEND_STATUS" == "running" ] && [ "$FRONTEND_STATUS" == "running" ]; then
        echo "✅ Ambos os containers estão rodando!"
        break
    fi
    
    RETRY_COUNT=$((RETRY_COUNT + 1))
    echo "⏳ Aguardando containers... ($RETRY_COUNT/$MAX_RETRIES)"
    sleep 2
done

if [ "$BACKEND_STATUS" != "running" ] || [ "$FRONTEND_STATUS" != "running" ]; then
    echo "❌ ERRO: Containers não iniciaram corretamente!"
    echo "📝 Verificando logs..."
    docker compose logs --tail=50
    exit 1
fi

echo "✅ Deploy concluído!"
echo ""
echo "📊 Status dos containers:"
docker compose ps

echo ""
echo "📝 Logs recentes do backend:"
docker compose logs --tail=20 backend

echo ""
echo "📝 Logs recentes do frontend:"
docker compose logs --tail=20 frontend

echo ""
echo "🔍 Verificando saúde dos serviços..."
echo "Backend health:"
BACKEND_HEALTH=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/health || echo "000")
if [ "$BACKEND_HEALTH" == "200" ]; then
    echo "✅ Backend está respondendo corretamente"
else
    echo "❌ Backend não está respondendo (HTTP $BACKEND_HEALTH)"
fi

echo ""
echo "Frontend health:"
FRONTEND_HEALTH=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000 || echo "000")
if [ "$FRONTEND_HEALTH" == "200" ] || [ "$FRONTEND_HEALTH" == "404" ]; then
    echo "✅ Frontend está respondendo (HTTP $FRONTEND_HEALTH)"
else
    echo "❌ Frontend não está respondendo (HTTP $FRONTEND_HEALTH)"
    echo "📝 Verificando logs do frontend..."
    docker compose logs --tail=30 frontend
fi

echo ""
echo "✅ Deploy finalizado! Acesse: https://hookifyads.com"
echo ""
echo "💡 Se ainda estiver vendo 404, verifique:"
echo "   1. Logs do Traefik: docker logs traefik-container"
echo "   2. Logs do frontend: docker compose logs -f frontend"
echo "   3. Status do Traefik: docker ps | grep traefik"

