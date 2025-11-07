#!/bin/bash
set -e

echo "🚀 Iniciando deploy do Hookify..."

PROJECT_DIR="/var/www/hookify"
DEPLOY_DIR="$PROJECT_DIR/deploy"

cd $PROJECT_DIR

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
    export NEXT_PUBLIC_SUPABASE_ANON_KEY=$(get_env_value "$PROJECT_DIR/frontend/.env.local" "NEXT_PUBLIC_SUPABASE_ANON_KEY")
    export NEXT_PUBLIC_API_BASE_URL=$(get_env_value "$PROJECT_DIR/frontend/.env.local" "NEXT_PUBLIC_API_BASE_URL")
    export NEXT_PUBLIC_FB_REDIRECT_URI=$(get_env_value "$PROJECT_DIR/frontend/.env.local" "NEXT_PUBLIC_FB_REDIRECT_URI")
    export NEXT_PUBLIC_USE_REMOTE_API=$(get_env_value "$PROJECT_DIR/frontend/.env.local" "NEXT_PUBLIC_USE_REMOTE_API")
fi

echo "🐳 Parando containers existentes..."
cd $DEPLOY_DIR
docker compose down || echo "⚠️  Nenhum container rodando"

echo "🔨 Fazendo build das imagens..."
docker compose build --no-cache

echo "🚀 Iniciando containers..."
docker compose up -d

# Limpar variáveis sensíveis após o uso (por segurança)
unset FACEBOOK_CLIENT_SECRET
unset SUPABASE_SERVICE_ROLE_KEY
unset ENCRYPTION_KEY

echo "⏳ Aguardando containers iniciarem..."
sleep 5

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
curl -s http://localhost:8000/health || echo "❌ Backend não está respondendo"

echo ""
echo "✅ Deploy finalizado! Acesse: https://hookifyads.com"

