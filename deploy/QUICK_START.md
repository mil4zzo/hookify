# 🚀 Quick Start - Deploy Hookify

## ⚡ Resumo Rápido

1. **Preparar credenciais** (veja `ENV_TEMPLATE.md`)
2. **Configurar arquivos `.env`** no VPS
3. **Executar deploy**: `./deploy.sh`

## 📝 Passo a Passo Simplificado

### 1. No seu computador local

Certifique-se de ter todas as credenciais prontas:
- ✅ Facebook OAuth (Client ID e Secret)
- ✅ Supabase (URL, Anon Key, Service Role Key)
- ✅ Encryption Key (gerar uma chave segura)

### 2. No VPS (via SSH)

```bash
# Conectar
ssh root@77.37.126.210

# Ir para o diretório do projeto
cd /var/www/hookify

# Configurar backend
cd backend
nano .env
# Cole e preencha as variáveis (veja ENV_TEMPLATE.md)

# Configurar frontend
cd ../frontend
nano .env.local
# Cole e preencha as variáveis (veja ENV_TEMPLATE.md)

# Fazer deploy
cd ../deploy
chmod +x deploy.sh
chmod +x check-traefik-network.sh
./deploy.sh
```

### 3. Aguardar e Verificar

```bash
# Aguardar alguns minutos para build e SSL
# Depois verificar:
docker compose ps
docker compose logs -f

# Testar
curl https://hookifyads.com/health
```

## ✅ Pronto!

Se tudo estiver correto, acesse:
- **Frontend**: https://hookifyads.com
- **API Health**: https://hookifyads.com/health
- **API**: https://hookifyads.com/api/health

## 🆘 Problemas?

Veja `DEPLOY_INSTRUCTIONS.md` para troubleshooting detalhado.

