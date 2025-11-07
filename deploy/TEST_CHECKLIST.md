# ✅ Checklist Antes de Testar

## 🔴 OBRIGATÓRIO - Antes de fazer deploy

### 1. Arquivos .env configurados no VPS

- [x] `backend/.env` criado com todas as variáveis
- [x] `frontend/.env.local` criado com todas as variáveis
- [x] Todas as credenciais preenchidas (não deixar valores vazios)

### 2. DNS configurado

- [x] Domínio `hookifyads.com` apontando para `77.37.126.210`
- [x] Verificar com: `dig hookifyads.com` ou `nslookup hookifyads.com`

### 3. Arquivos no VPS

- [x] Código do projeto em `/var/www/hookify`
- [x] Diretório `deploy/` com todos os arquivos
- [x] Scripts com permissão de execução: `chmod +x deploy.sh`

### 4. Facebook OAuth

- [x] Redirect URI configurado: `https://hookifyads.com/callback`
- [x] Domínio válido adicionado: `hookifyads.com`

## 🟡 RECOMENDADO - Para melhor experiência

- [ ] Backup das configurações atuais (se houver)
- [ ] Verificar espaço em disco: `df -h`
- [ ] Verificar recursos disponíveis: `free -h`

## ✅ Pronto para Testar?

Se todos os itens acima estiverem marcados, você pode executar:

```bash
cd /var/www/hookify/deploy
./deploy.sh
```

## 🧪 Teste Básico Após Deploy

```bash
# 1. Verificar containers
docker compose ps

# 2. Verificar logs
docker compose logs -f

# 3. Testar backend localmente
curl http://localhost:8000/health

# 4. Testar via HTTPS (aguardar alguns minutos para SSL)
curl https://hookifyads.com/health
```

## ⚠️ Problemas Comuns

### Container não inicia

- Verificar logs: `docker compose logs backend`
- Verificar variáveis de ambiente: `docker exec hookify-backend env`

### Traefik não detecta containers

- Aguardar alguns segundos (Traefik precisa detectar)
- Verificar labels: `docker inspect hookify-backend | grep Labels`
- Verificar logs do Traefik: `docker logs root-traefik-1`

### SSL não funciona

- Aguardar alguns minutos (Let's Encrypt pode levar tempo)
- Verificar DNS: `dig hookifyads.com`
- Verificar logs do Traefik: `docker logs root-traefik-1 | grep -i acme`
