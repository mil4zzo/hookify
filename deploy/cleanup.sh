#!/bin/bash
set -euo pipefail

MODE_SAFE=true
MODE_AGGRESSIVE=false
MODE_DANGEROUS_VOLUMES=false

usage() {
  cat <<EOF
Usage: ./cleanup.sh [--safe] [--aggressive] [--dangerous-volumes]

  --safe               Default. Não remove volumes.
  --aggressive         Ainda safe: remove imagens não usadas (sem volumes).
  --dangerous-volumes  Remove volumes não usados (RISCO). Requer confirmar "SIM".
EOF
}

for arg in "$@"; do
  case "$arg" in
    --safe) MODE_SAFE=true ;;
    --aggressive) MODE_AGGRESSIVE=true ;;
    --dangerous-volumes) MODE_DANGEROUS_VOLUMES=true ;;
    -h|--help) usage; exit 0 ;;
    *) echo "❌ Arg desconhecido: $arg"; usage; exit 1 ;;
  esac
done

echo "🧹 Cleanup Docker iniciado..."
echo ""

echo "📊 ANTES:"
docker system df || true
echo ""
echo "💾 Disco (antes):"
df -h / || true
echo ""

echo "🗑️  Containers parados..."
docker container prune -f || true

echo "🗑️  Networks não usadas..."
docker network prune -f || true

echo "🗑️  Imagens dangling..."
docker image prune -f || true

echo "🧱 Build cache (BuildKit) - reduzindo para não explodir /var..."
# tenta keep-storage (melhor), senão usa "until"
if docker builder prune -af --keep-storage 5GB >/dev/null 2>&1; then
  echo "✅ Build cache reduzido (mantendo ~5GB)."
else
  docker builder prune -af --filter "until=168h" >/dev/null 2>&1 || true
  echo "✅ Build cache reduzido (mais velho que 7 dias)."
fi

if [ "$MODE_AGGRESSIVE" = true ]; then
  echo ""
  echo "⚠️  Aggressive SAFE: removendo imagens não usadas (sem volumes)..."
  docker image prune -af || true
fi

if [ "$MODE_DANGEROUS_VOLUMES" = true ]; then
  echo ""
  echo "⚠️  PERIGO: volume prune pode apagar dados se algum volume estiver desconectado no momento."
  read -p "Digite 'SIM' para continuar: " CONFIRM
  if [ "$CONFIRM" != "SIM" ]; then
    echo "Cancelado."
    exit 0
  fi
  echo "🗑️  Volumes não usados..."
  docker volume prune -f || true
fi

echo ""
echo "✅ Cleanup concluído."
echo ""
echo "📊 DEPOIS:"
docker system df || true
echo ""
echo "💾 Disco (depois):"
df -h / || true