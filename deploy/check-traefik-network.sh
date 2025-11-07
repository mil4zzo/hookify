#!/bin/bash
# Script para verificar e conectar containers à rede do Traefik (se necessário)

echo "🔍 Verificando configuração do Traefik..."

# Verificar se o Traefik está rodando
if ! docker ps | grep -q traefik; then
    echo "❌ Traefik não está rodando!"
    exit 1
fi

echo "✅ Traefik está rodando"

# Verificar redes Docker
echo ""
echo "📊 Redes Docker disponíveis:"
docker network ls

# Verificar se os containers do Hookify estão rodando
if docker ps | grep -q hookify-backend; then
    echo ""
    echo "✅ Containers do Hookify estão rodando"
    
    # Verificar em qual rede estão
    echo ""
    echo "📊 Rede dos containers do Hookify:"
    docker inspect hookify-backend | grep -A 10 Networks
    
    # Verificar se o Traefik pode acessá-los
    echo ""
    echo "🔍 Verificando se Traefik detecta os containers..."
    docker logs root-traefik-1 2>&1 | tail -20 | grep -i hookify || echo "⚠️  Containers não aparecem nos logs do Traefik ainda"
    
    echo ""
    echo "💡 Dica: O Traefik deve detectar automaticamente containers com labels corretos"
    echo "   Se não detectar, verifique os labels com: docker inspect hookify-backend | grep Labels"
else
    echo ""
    echo "⚠️  Containers do Hookify não estão rodando ainda"
    echo "   Execute: cd /var/www/hookify/deploy && docker-compose up -d"
fi

