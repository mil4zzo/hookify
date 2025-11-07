#!/bin/bash
set -e

echo "🚀 Iniciando deploy do Hookify..."

PROJECT_DIR="/var/www/hookify"
DEPLOY_DIR="$PROJECT_DIR/deploy"

cd $PROJECT_DIR

echo "📦 Fazendo pull do código..."
git pull origin main || echo "⚠️  Git pull falhou, continuando com código local..."

echo "🐳 Parando containers existentes..."
cd $DEPLOY_DIR
docker compose down || echo "⚠️  Nenhum container rodando"

echo "🔨 Fazendo build das imagens..."
docker compose build --no-cache

echo "🚀 Iniciando containers..."
docker compose up -d

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

