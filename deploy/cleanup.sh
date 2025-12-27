#!/bin/bash

echo "🧹 Iniciando limpeza de recursos Docker não utilizados..."
echo ""

# Mostrar uso atual
echo "📊 Uso de espaço ANTES da limpeza:"
docker system df
echo ""

# Limpar containers parados
echo "🗑️  Removendo containers parados..."
docker container prune -f

# Limpar imagens não utilizadas
echo "🗑️  Removendo imagens não utilizadas..."
docker image prune -a -f

# Limpar volumes não utilizados
echo "🗑️  Removendo volumes não utilizados..."
docker volume prune -f

# Limpar build cache
echo "🗑️  Removendo build cache..."
docker builder prune -a -f

# Limpar networks não utilizadas
echo "🗑️  Removendo networks não utilizadas..."
docker network prune -f

echo ""
echo "✅ Limpeza concluída!"
echo ""
echo "📊 Uso de espaço APÓS a limpeza:"
docker system df

echo ""
echo "💾 Espaço em disco disponível:"
df -h / | tail -1 | awk '{print "   Total: " $2 " | Usado: " $3 " | Disponível: " $4 " (" $5 " usado)"}'

