# Deploy Hookify - Guia de Configuração

Este diretório contém todos os arquivos necessários para fazer o deploy do Hookify no VPS da Hostinger usando Docker e Traefik.

## 📋 Pré-requisitos

- Docker e Docker Compose instalados
- Traefik rodando e configurado
- Domínio `hookifyads.com` apontando para o VPS
- Acesso SSH ao VPS

## 🚀 Configuração Inicial

### 1. Configurar Variáveis de Ambiente

#### Backend (.env)
Crie o arquivo `backend/.env` com as seguintes variáveis:

```bash
FACEBOOK_CLIENT_ID=seu_client_id
FACEBOOK_CLIENT_SECRET=seu_client_secret
FACEBOOK_AUTH_BASE_URL=https://www.facebook.com/v22.0/dialog/oauth
FACEBOOK_TOKEN_URL=https://graph.facebook.com/v22.0/oauth/access_token
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_KEY=sua_anon_key
SUPABASE_ANON_KEY=sua_anon_key
SUPABASE_SERVICE_ROLE_KEY=sua_service_role_key
SUPABASE_JWKS_URL=https://seu-projeto.supabase.co/auth/v1/.well-known/jwks.json
CORS_ORIGINS=https://hookifyads.com,https://www.hookifyads.com
LOG_LEVEL=info
ENCRYPTION_KEY=sua_chave_de_criptografia
```

#### Frontend (.env.local)
Crie o arquivo `frontend/.env.local` com:

```bash
NEXT_PUBLIC_API_BASE_URL=https://hookifyads.com/api
NEXT_PUBLIC_FB_REDIRECT_URI=https://hookifyads.com/callback
NEXT_PUBLIC_USE_REMOTE_API=true
NEXT_PUBLIC_SUPABASE_URL=https://seu-projeto.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sua_anon_key
```

### 2. Configurar Traefik

O Traefik deve estar configurado para usar a rede Docker `hookify-network`. 

Se o Traefik estiver rodando em um container separado, certifique-se de que ele está na mesma rede:

```bash
docker network create hookify-network
docker network connect hookify-network traefik-container
```

Ou configure o Traefik para criar/gerenciar a rede automaticamente.

### 3. Primeiro Deploy

```bash
cd /var/www/hookify/deploy
chmod +x deploy.sh
./deploy.sh
```

## 🔄 Deploy Contínuo

Para fazer um novo deploy após mudanças no código:

```bash
cd /var/www/hookify/deploy
./deploy.sh
```

## 📊 Monitoramento

### Ver logs em tempo real:
```bash
docker compose logs -f
```

### Ver logs de um serviço específico:
```bash
docker compose logs -f backend
docker compose logs -f frontend
```

### Verificar status:
```bash
docker compose ps
```

### Health checks:
```bash
# Backend
curl http://localhost:8000/health

# Frontend (via Traefik)
curl https://hookifyads.com
```

## 🛠️ Comandos Úteis

### Parar serviços:
```bash
docker compose down
```

### Reiniciar um serviço específico:
```bash
docker compose restart backend
docker compose restart frontend
```

### Rebuild sem cache:
```bash
docker compose build --no-cache
docker compose up -d
```

### Ver uso de recursos:
```bash
docker stats
```

## 🔧 Troubleshooting

### Container não inicia:
```bash
docker compose logs nome-do-container
```

### Problemas de rede:
```bash
docker network ls
docker network inspect hookify-network
```

### Limpar tudo e recomeçar:
```bash
docker compose down -v
docker compose build --no-cache
docker compose up -d
```

## 📝 Notas

- O Traefik gerencia automaticamente o SSL via Let's Encrypt
- Os containers são reiniciados automaticamente em caso de falha
- Health checks estão configurados para monitorar a saúde dos serviços
- A rede Docker `hookify-network` é criada automaticamente

