# Template de Variáveis de Ambiente

## Backend - backend/.env

Crie o arquivo `backend/.env` com o seguinte conteúdo:

```bash
FACEBOOK_CLIENT_ID=seu_client_id_aqui
FACEBOOK_CLIENT_SECRET=seu_client_secret_aqui
FACEBOOK_AUTH_BASE_URL=https://www.facebook.com/v22.0/dialog/oauth
FACEBOOK_TOKEN_URL=https://graph.facebook.com/v22.0/oauth/access_token

SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_KEY=sua_anon_key_aqui
SUPABASE_ANON_KEY=sua_anon_key_aqui
SUPABASE_SERVICE_ROLE_KEY=sua_service_role_key_aqui
SUPABASE_JWKS_URL=https://seu-projeto.supabase.co/auth/v1/.well-known/jwks.json

CORS_ORIGINS=https://hookifyads.com,https://www.hookifyads.com
LOG_LEVEL=info
ENCRYPTION_KEY=sua_chave_de_criptografia_aqui
```

## Frontend - frontend/.env.local

Crie o arquivo `frontend/.env.local` com o seguinte conteúdo:

```bash
NEXT_PUBLIC_API_BASE_URL=https://hookifyads.com/api
NEXT_PUBLIC_FB_REDIRECT_URI=https://hookifyads.com/callback
NEXT_PUBLIC_USE_REMOTE_API=true
NEXT_PUBLIC_SUPABASE_URL=https://seu-projeto.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sua_anon_key_aqui
```

## Como obter as credenciais

### Facebook OAuth
1. Acesse https://developers.facebook.com/
2. Vá em "Meus Apps" > Seu App
3. Em "Configurações" > "Básico", você encontra:
   - App ID (FACEBOOK_CLIENT_ID)
   - App Secret (FACEBOOK_CLIENT_SECRET)
4. Em "Produtos" > "Facebook Login" > "Configurações", adicione:
   - URL de redirecionamento válido: `https://hookifyads.com/callback`
   - Domínios de aplicativo válidos: `hookifyads.com`

### Supabase
1. Acesse seu projeto no Supabase
2. Vá em "Settings" > "API"
3. Você encontrará:
   - Project URL (SUPABASE_URL)
   - anon/public key (SUPABASE_ANON_KEY)
   - service_role key (SUPABASE_SERVICE_ROLE_KEY) - **NUNCA exponha no frontend**

### ENCRYPTION_KEY
Use uma chave segura de 32 caracteres. Você pode gerar com:
```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

