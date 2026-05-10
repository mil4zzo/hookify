# Template de Variáveis de Ambiente

## Backend - backend/.env

Crie o arquivo `backend/.env` com o seguinte conteúdo:

```bash
FACEBOOK_CLIENT_ID=seu_client_id_aqui
FACEBOOK_CLIENT_SECRET=seu_client_secret_aqui
FACEBOOK_AUTH_BASE_URL=https://www.facebook.com/v24.0/dialog/oauth
FACEBOOK_TOKEN_URL=https://graph.facebook.com/v24.0/oauth/access_token

SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_KEY=sua_anon_key_aqui
SUPABASE_ANON_KEY=sua_anon_key_aqui
SUPABASE_SERVICE_ROLE_KEY=sua_service_role_key_aqui
SUPABASE_JWKS_URL=https://seu-projeto.supabase.co/auth/v1/.well-known/jwks.json

CORS_ORIGINS=https://hookifyads.com,https://www.hookifyads.com
LOG_LEVEL=info
ENCRYPTION_KEY=sua_chave_de_criptografia_aqui

# AssemblyAI (transcrição de vídeos)
ASSEMBLYAI_API_KEY=sua_chave_assemblyai_aqui

# Google OAuth (Leadscore via Google Sheets)
GOOGLE_OAUTH_CLIENT_ID=seu_google_client_id_aqui
GOOGLE_OAUTH_CLIENT_SECRET=seu_google_client_secret_aqui
# Opcional: fixar um redirect por ambiente (senão é derivado do request)
# GOOGLE_OAUTH_REDIRECT_URI=https://hookifyads.com/callback/google
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

### AssemblyAI
1. Acesse https://www.assemblyai.com/app/account
2. Em "API Keys", copie a chave existente ou crie uma nova
3. Cole em `ASSEMBLYAI_API_KEY`. Sem essa chave a transcrição falha com `ASSEMBLYAI_API_KEY não configurada`.

### Google OAuth (Leadscore via Sheets)
1. Acesse https://console.cloud.google.com/apis/credentials no projeto Google Cloud
2. Em "OAuth 2.0 Client IDs", abra o client (ou crie um do tipo "Web application")
3. Adicione como Authorized redirect URI: `https://hookifyads.com/callback/google`
4. Copie Client ID e Client Secret para `GOOGLE_OAUTH_CLIENT_ID` e `GOOGLE_OAUTH_CLIENT_SECRET`
5. Confirme que as APIs "Google Sheets API" e "Google Drive API" estão habilitadas no projeto

