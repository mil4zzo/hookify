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

# Stripe billing
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_INSIDER_MONTHLY=price_...
STRIPE_PRICE_INSIDER_ANNUAL=price_...
# Pix no plano anual (pagamento avulso de 12 meses, sem renovação automática).
# Exige Pix habilitado no Dashboard + NEXT_PUBLIC_BILLING_PIX_ENABLED=true no frontend.
STRIPE_PIX_ENABLED=false
STRIPE_PIX_ANNUAL_AMOUNT_CENTS=79000
FRONTEND_BASE_URL=https://hookifyads.com
```

## Frontend - frontend/.env.local

Crie o arquivo `frontend/.env.local` com o seguinte conteúdo:

```bash
NEXT_PUBLIC_API_BASE_URL=https://hookifyads.com/api
NEXT_PUBLIC_FB_REDIRECT_URI=https://hookifyads.com/callback
NEXT_PUBLIC_USE_REMOTE_API=true
NEXT_PUBLIC_SUPABASE_URL=https://seu-projeto.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sua_anon_key_aqui
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY=sua_publishable_key_aqui
NEXT_PUBLIC_SENTRY_DSN=
# Mostrar botão "Pagar anual com Pix" — ligar junto com STRIPE_PIX_ENABLED do backend
NEXT_PUBLIC_BILLING_PIX_ENABLED=false
# SENTRY_AUTH_TOKEN é consumido como SECRET do BuildKit (não como build arg), para não
# ficar gravado nas camadas da imagem. Continua sendo lido daqui — só muda o transporte.
SENTRY_AUTH_TOKEN=
SENTRY_ORG=
SENTRY_PROJECT=
```

## Deploy - deploy/.env (necessário em produção)

`docker-compose` resolve `${VAR}` em **build args** consultando o `.env` da pasta onde o compose roda (ou variáveis exportadas no shell). Como os build args do Next (`NEXT_PUBLIC_*`, `SENTRY_*`) precisam ser resolvidos em build-time — e não podem vir do `env_file` — você **precisa** ter um `deploy/.env` no servidor com pelo menos os valores que o Next embeda no bundle:

```bash
# deploy/.env (no VPS, NÃO commitar — fica fora do git)
NEXT_PUBLIC_API_BASE_URL=https://api.hookifyads.com
NEXT_PUBLIC_FB_REDIRECT_URI=https://hookifyads.com/callback
NEXT_PUBLIC_USE_REMOTE_API=true
NEXT_PUBLIC_SUPABASE_URL=https://seu-projeto.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY=sua_publishable_key_aqui
NEXT_PUBLIC_SENTRY_DSN=
# Mostrar botão "Pagar anual com Pix" — ligar junto com STRIPE_PIX_ENABLED do backend
NEXT_PUBLIC_BILLING_PIX_ENABLED=false
# SENTRY_AUTH_TOKEN é consumido como SECRET do BuildKit (não como build arg), para não
# ficar gravado nas camadas da imagem. Continua sendo lido daqui — só muda o transporte.
SENTRY_AUTH_TOKEN=
SENTRY_ORG=
SENTRY_PROJECT=
```

**Atalho prático (assumindo que `frontend/.env.local` já contém os mesmos valores):**

```bash
cd /var/www/hookify/deploy
ln -sf ../frontend/.env.local .env
chmod 600 ../frontend/.env.local
```

Sem esse arquivo o build do Next sai com `NEXT_PUBLIC_SUPABASE_URL=""` embedado no bundle e o frontend não consegue autenticar (login redireciona infinitamente).

> Vars de **runtime** do backend (Supabase, Facebook, AssemblyAI, etc.) NÃO precisam estar em `deploy/.env` — elas vêm via `env_file: ../backend/.env` direto pro container.

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

### Stripe (billing Insider)
1. Acesse https://dashboard.stripe.com → **Products** → crie produto "Insider"
2. Adicione dois preços recorrentes:
   - Mensal: R$97,00 / mês → copie o `price_...` como `STRIPE_PRICE_INSIDER_MONTHLY`
   - Anual: R$790,00 / ano → copie o `price_...` como `STRIPE_PRICE_INSIDER_ANNUAL`
3. Para parcelamento no plano anual: **Settings → Payment methods → Card installments** → habilitar
4. **Developers → Webhooks** → Add endpoint: `https://api.hookifyads.com/billing/webhook`
   - Eventos: `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
     `customer.subscription.updated`, `customer.subscription.deleted`,
     `invoice.payment_succeeded`, `invoice.payment_failed`, `invoice.payment_action_required`
   - Copie o Signing secret como `STRIPE_WEBHOOK_SECRET`
5. **Developers → API keys** → copie a Secret key como `STRIPE_SECRET_KEY`
6. **Settings → Customer portal** → habilitar e configurar opções de cancelamento/troca
7. **Dunning (obrigatório conferir):** Settings → Billing → **Subscriptions and emails** →
   "Manage failed payments" → em *If all retries fail*, selecionar **Cancel the subscription**
   (o backend depende do evento `customer.subscription.deleted` para rebaixar o tier; o código
   tem guarda extra que não estende `expires_at` em `past_due`/`unpaid`, mas cancelar é o correto)
8. **Pix (opcional, plano anual avulso):** Settings → **Payment methods** → habilitar Pix →
   depois setar `STRIPE_PIX_ENABLED=true` (backend) e `NEXT_PUBLIC_BILLING_PIX_ENABLED=true`
   (frontend) — os dois juntos. Valor cobrado: `STRIPE_PIX_ANNUAL_AMOUNT_CENTS` (padrão R$790)
7. Em desenvolvimento, use `stripe listen --forward-to localhost:8000/billing/webhook` e copie
   o webhook secret impresso no terminal como `STRIPE_WEBHOOK_SECRET`

### Google OAuth (Leadscore via Sheets)
1. Acesse https://console.cloud.google.com/apis/credentials no projeto Google Cloud
2. Em "OAuth 2.0 Client IDs", abra o client (ou crie um do tipo "Web application")
3. Adicione como Authorized redirect URI: `https://hookifyads.com/callback/google`
4. Copie Client ID e Client Secret para `GOOGLE_OAUTH_CLIENT_ID` e `GOOGLE_OAUTH_CLIENT_SECRET`
5. Confirme que as APIs "Google Sheets API" e "Google Drive API" estão habilitadas no projeto

