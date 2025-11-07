# Guia de Setup - Deploy Hookify no VPS Hostinger

## 📊 Informações do VPS

- **ID**: 1100701
- **Hostname**: srv1100701.hstgr.cloud
- **IP**: 77.37.126.210
- **OS**: Ubuntu 24.04
- **Recursos**: 1 CPU, 4GB RAM, 50GB disco
- **Status**: ✅ Rodando

## 🔍 Estado Atual

O VPS já possui:
- ✅ Docker instalado
- ✅ Traefik rodando (container: `root-traefik-1`)
- ✅ n8n rodando
- ✅ Portas 80 e 443 abertas

## 🚀 Passos para Deploy

### 1. Conectar ao VPS

```bash
ssh root@77.37.126.210
# ou
ssh root@srv1100701.hstgr.cloud
```

### 2. Preparar Diretório do Projeto

```bash
# Criar diretório
mkdir -p /var/www/hookify
cd /var/www/hookify

# Clonar repositório (ou fazer upload dos arquivos)
# git clone seu-repositorio.git .
```

### 3. Configurar Variáveis de Ambiente

#### Backend
```bash
cd /var/www/hookify/backend
nano .env
```

Cole o conteúdo do template em `deploy/ENV_TEMPLATE.md` e preencha com suas credenciais.

#### Frontend
```bash
cd /var/www/hookify/frontend
nano .env.local
```

Cole o conteúdo do template em `deploy/ENV_TEMPLATE.md` e preencha com suas credenciais.

### 4. Verificar Rede Docker do Traefik

O Traefik precisa estar na mesma rede Docker que os containers do Hookify. Verifique:

```bash
docker network ls
docker inspect root-traefik-1 | grep NetworkMode
```

Se o Traefik estiver usando uma rede específica, você precisa:
1. Usar a mesma rede no docker-compose.yml, OU
2. Conectar os containers à rede do Traefik após criá-los

### 5. Ajustar docker-compose.yml (se necessário)

Se o Traefik estiver em uma rede diferente, você pode:

**Opção A**: Usar a rede existente do Traefik
```yaml
networks:
  hookify-network:
    external: true
    name: nome-da-rede-do-traefik
```

**Opção B**: Conectar após criar
```bash
docker network connect nome-da-rede-do-traefik hookify-backend
docker network connect nome-da-rede-do-traefik hookify-frontend
```

### 6. Primeiro Deploy

```bash
cd /var/www/hookify/deploy
chmod +x deploy.sh
./deploy.sh
```

### 7. Verificar Logs

```bash
cd /var/www/hookify/deploy
docker-compose logs -f
```

### 8. Verificar Health Checks

```bash
# Backend
curl http://localhost:8000/health

# Via Traefik (após SSL ser configurado)
curl https://hookifyads.com/health
```

## 🔧 Configuração do Traefik

O Traefik já está rodando. Você precisa garantir que:

1. **Rede Docker**: Os containers do Hookify estejam na mesma rede do Traefik
2. **Labels**: Os labels no docker-compose.yml estão corretos
3. **SSL**: O Traefik está configurado para usar Let's Encrypt

### Verificar Configuração do Traefik

```bash
docker exec root-traefik-1 cat /etc/traefik/traefik.yml
```

Se necessário, você pode precisar ajustar a configuração do Traefik para aceitar containers de outros projetos Docker.

## 📝 Checklist Antes do Deploy

- [ ] Variáveis de ambiente do backend configuradas (`backend/.env`)
- [ ] Variáveis de ambiente do frontend configuradas (`frontend/.env.local`)
- [ ] Domínio `hookifyads.com` apontando para o IP `77.37.126.210`
- [ ] Facebook OAuth configurado com redirect URI `https://hookifyads.com/callback`
- [ ] Rede Docker verificada (Traefik e containers na mesma rede)
- [ ] Portas 80 e 443 abertas no firewall (já estão abertas)

## 🆘 Troubleshooting

### Container não aparece no Traefik

1. Verifique se os containers estão na mesma rede:
```bash
docker network inspect nome-da-rede
```

2. Verifique os labels:
```bash
docker inspect hookify-backend | grep -A 20 Labels
```

3. Verifique logs do Traefik:
```bash
docker logs root-traefik-1
```

### SSL não está funcionando

1. Verifique se o domínio está apontando corretamente:
```bash
dig hookifyads.com
```

2. Verifique certificados ACME:
```bash
docker exec root-traefik-1 ls -la /etc/traefik/acme.json
```

### Backend não responde

1. Verifique logs:
```bash
docker-compose logs backend
```

2. Verifique se o container está rodando:
```bash
docker-compose ps
```

3. Teste diretamente:
```bash
docker exec hookify-backend curl http://localhost:8000/health
```

## 📞 Próximos Passos

Após o deploy bem-sucedido:

1. Configure o Facebook OAuth com o domínio de produção
2. Teste o fluxo completo de autenticação
3. Configure monitoramento (opcional)
4. Configure backups (opcional)

