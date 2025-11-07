# 🚀 Instruções de Deploy - Hookify

## ✅ Arquivos Criados

Todos os arquivos necessários foram criados no diretório `deploy/`:

- ✅ `Dockerfile.backend` - Dockerfile para o backend Python
- ✅ `Dockerfile.frontend` - Dockerfile para o frontend Next.js
- ✅ `docker-compose.yml` - Orquestração dos containers
- ✅ `deploy.sh` - Script automatizado de deploy
- ✅ `ENV_TEMPLATE.md` - Template de variáveis de ambiente
- ✅ `SETUP_GUIDE.md` - Guia completo de setup
- ✅ `.dockerignore` - Arquivos ignorados no build

## 📋 Checklist Antes de Começar

Antes de fazer o deploy, você precisa ter:

### 1. Credenciais do Facebook OAuth
- [ ] `FACEBOOK_CLIENT_ID`
- [ ] `FACEBOOK_CLIENT_SECRET`
- [ ] Configurar redirect URI: `https://hookifyads.com/callback`
- [ ] Adicionar domínio válido: `hookifyads.com`

### 2. Credenciais do Supabase
- [ ] `SUPABASE_URL`
- [ ] `SUPABASE_ANON_KEY`
- [ ] `SUPABASE_SERVICE_ROLE_KEY`
- [ ] `SUPABASE_JWKS_URL` (geralmente: `{SUPABASE_URL}/auth/v1/.well-known/jwks.json`)

### 3. Chave de Criptografia
- [ ] `ENCRYPTION_KEY` (gerar uma chave segura de 32 caracteres)

### 4. DNS Configurado
- [ ] Domínio `hookifyads.com` apontando para `77.37.126.210`
- [ ] Domínio `www.hookifyads.com` apontando para `77.37.126.210` (opcional)

## 🔧 Passos para Deploy

### Passo 1: Preparar Arquivos no VPS

Você tem duas opções:

**Opção A: Via Git (Recomendado)**
```bash
ssh root@77.37.126.210
cd /var/www
git clone seu-repositorio.git hookify
cd hookify
```

**Opção B: Via Upload**
Faça upload dos arquivos do projeto para `/var/www/hookify` no VPS.

### Passo 2: Configurar Variáveis de Ambiente

#### Backend
```bash
cd /var/www/hookify/backend
nano .env
```

Cole e preencha com suas credenciais (veja `deploy/ENV_TEMPLATE.md`):
```bash
FACEBOOK_CLIENT_ID=seu_valor
FACEBOOK_CLIENT_SECRET=seu_valor
# ... (veja template completo)
```

#### Frontend
```bash
cd /var/www/hookify/frontend
nano .env.local
```

Cole e preencha com suas credenciais:
```bash
NEXT_PUBLIC_API_BASE_URL=https://hookifyads.com/api
NEXT_PUBLIC_FB_REDIRECT_URI=https://hookifyads.com/callback
NEXT_PUBLIC_USE_REMOTE_API=true
NEXT_PUBLIC_SUPABASE_URL=seu_valor
NEXT_PUBLIC_SUPABASE_ANON_KEY=seu_valor
```

### Passo 3: Verificar Rede Docker

O Traefik já está rodando. Verifique se os containers do Hookify serão detectados:

```bash
# Ver redes Docker existentes
docker network ls

# O Traefik detecta automaticamente containers na mesma rede
# Nossa rede será criada automaticamente pelo docker-compose
```

### Passo 4: Executar Deploy

```bash
cd /var/www/hookify/deploy
chmod +x deploy.sh
./deploy.sh
```

O script irá:
1. Fazer pull do código (se usar Git)
2. Parar containers existentes
3. Fazer build das imagens
4. Iniciar os containers
5. Mostrar logs e status

### Passo 5: Verificar Deploy

```bash
# Ver status dos containers
cd /var/www/hookify/deploy
docker-compose ps

# Ver logs
docker-compose logs -f

# Testar backend
curl http://localhost:8000/health

# Verificar no Traefik (após alguns segundos)
# Os containers devem aparecer no dashboard do Traefik
```

### Passo 6: Verificar SSL

O Traefik irá automaticamente:
1. Detectar os novos containers
2. Gerar certificados SSL via Let's Encrypt
3. Configurar HTTPS

Aguarde alguns minutos para o SSL ser configurado, depois acesse:
- https://hookifyads.com

## 🔍 Verificação Pós-Deploy

### 1. Containers Rodando
```bash
docker-compose ps
# Deve mostrar: hookify-backend e hookify-frontend como "Up"
```

### 2. Logs Sem Erros
```bash
docker-compose logs backend | tail -50
docker-compose logs frontend | tail -50
```

### 3. Health Check Backend
```bash
curl http://localhost:8000/health
# Deve retornar: {"status": "healthy", ...}
```

### 4. Acesso via HTTPS
```bash
curl https://hookifyads.com
# Deve retornar HTML do frontend
```

### 5. API Funcionando
```bash
curl https://hookifyads.com/api/health
# Deve retornar: {"status": "healthy", ...}
```

## 🆘 Troubleshooting

### Container não aparece no Traefik

**Problema**: Traefik não detecta os containers

**Solução**:
1. Verifique se os containers estão rodando:
```bash
docker-compose ps
```

2. Verifique os labels:
```bash
docker inspect hookify-backend | grep -A 30 Labels
```

3. Verifique logs do Traefik:
```bash
docker logs root-traefik-1 | tail -50
```

4. Verifique rede Docker:
```bash
docker network inspect hookify-network
# Deve mostrar os containers conectados
```

### SSL não funciona

**Problema**: Certificado não é gerado

**Solução**:
1. Verifique se o domínio está apontando corretamente:
```bash
dig hookifyads.com
# Deve mostrar: 77.37.126.210
```

2. Verifique logs do Traefik:
```bash
docker logs root-traefik-1 | grep -i acme
```

3. Aguarde alguns minutos (Let's Encrypt pode levar tempo)

### Backend não responde

**Problema**: Erro 502 ou timeout

**Solução**:
1. Verifique logs do backend:
```bash
docker-compose logs backend
```

2. Verifique se o container está rodando:
```bash
docker-compose ps backend
```

3. Teste diretamente no container:
```bash
docker exec hookify-backend curl http://localhost:8000/health
```

4. Verifique variáveis de ambiente:
```bash
docker exec hookify-backend env | grep SUPABASE
```

### Frontend não carrega

**Problema**: Página em branco ou erro

**Solução**:
1. Verifique logs do frontend:
```bash
docker-compose logs frontend
```

2. Verifique build:
```bash
docker-compose logs frontend | grep -i error
```

3. Verifique variáveis de ambiente:
```bash
docker exec hookify-frontend env | grep NEXT_PUBLIC
```

## 📞 Próximos Passos Após Deploy Bem-Sucedido

1. ✅ Testar autenticação Facebook OAuth
2. ✅ Testar conexão com Supabase
3. ✅ Verificar todas as rotas da API
4. ✅ Configurar monitoramento (opcional)
5. ✅ Configurar backups (opcional)

## 🔄 Atualizações Futuras

Para fazer deploy de atualizações:

```bash
cd /var/www/hookify/deploy
./deploy.sh
```

O script automaticamente:
- Para containers antigos
- Faz rebuild das imagens
- Inicia novos containers

## 📝 Notas Importantes

- ⚠️ **Nunca commite arquivos `.env` ou `.env.local` no Git**
- ✅ O Traefik gerencia SSL automaticamente
- ✅ Containers reiniciam automaticamente em caso de falha
- ✅ Health checks estão configurados
- ✅ Logs podem ser visualizados com `docker-compose logs`

