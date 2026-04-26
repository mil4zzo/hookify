# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Hookify** is a Meta Ads management platform. It connects to the Facebook Graph API (v24.0) to pull ad data into a Supabase (PostgreSQL) database, and exposes it through a FastAPI backend consumed by a Next.js 15 frontend.

---

## Development Commands

### Backend (FastAPI — Python)

```bash
cd backend
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt
python app/main.py                 # runs on http://localhost:8000
```

Run tests:
```bash
pytest tests/
pytest tests/test_specific.py     # single test file
```

### Frontend (Next.js 15)

```bash
cd frontend
npm install
npm run dev                        # runs on http://localhost:3000
npm run build
npm run lint
npm run generate:themes            # regenerate Tailwind theme CSS
```

### Docker Deployment (VPS)

```bash
cd deploy
./deploy.sh            # deploy with cache
./deploy.sh --no-cache # full rebuild
docker compose logs -f backend
./cleanup.sh           # free disk space (unused images, volumes, build cache)
```

---

## Architecture

### Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15 (App Router), React 18, TypeScript, Tailwind CSS, shadcn/ui |
| State | Zustand (client state), TanStack Query (server state/caching) |
| Backend | FastAPI + Uvicorn |
| Database | Supabase (PostgreSQL + Auth + RLS) |
| Integrations | Meta Graph API v24.0, Google OAuth + Sheets, AssemblyAI |
| Infra | Docker + Traefik (SSL) on Hostinger VPS |

### Request Flow

```
Frontend (Next.js) → Axios → FastAPI backend → Meta Graph API / Supabase
```

Authentication is handled by Supabase Auth. The frontend stores the JWT from Supabase and passes it in the `Authorization` header to the backend. The backend validates the JWT against `SUPABASE_JWKS_URL`.

The backend never exposes `SUPABASE_SERVICE_ROLE_KEY` to the client — it's used only server-side for privileged queries.

### Key Backend Patterns

**Async Job Tracking**: Long-running Meta API operations (bulk ad/campaign creation) use a two-phase pattern:
1. Submit job → returns `job_id`
2. Client polls `/facebook/jobs/{job_id}` until completion

In-memory `JobTracker` service manages job state during the lifecycle of the request.

**Supabase Client**: Two clients exist — one authenticated as service role (`supabase_client.py`) for backend operations, one using the user JWT for RLS-enforced queries.

**Feature Flags via env vars**: Several behaviors are toggled in `.env`, including:
- `ANALYTICS_MANAGER_RPC_ENABLED` / `ANALYTICS_MANAGER_RPC_FAIL_OPEN` — controls whether analytics uses a Supabase RPC or falls back
- `LOG_SUPPRESS_HTTPX`, `LOG_META_USAGE`, `LOG_AD_ID_TRUNCATED` — logging verbosity

### Key Frontend Patterns

**API client**: Configured in `frontend/lib/api/`. Base URL from `NEXT_PUBLIC_API_BASE_URL`. Auth token is injected via Axios interceptor using the Supabase session.

**Route layout**: Uses Next.js App Router. `(auth)/` wraps authenticated pages. `callback/` handles OAuth redirects (Facebook and Google). Most feature pages live under `/manager`, `/explorer`, `/insights`, `/rankings`, `/upload`.

**UI components**: shadcn/ui (Radix primitives) in `components/ui/`. Project-specific components are in `components/ads/`, `components/manager/`, etc. Do not add raw Radix usage — go through shadcn wrappers.

**Notifications**: Use `sonner` (`toast` from `"sonner"`) for all user-facing toasts. Do not use other toast libraries.

---

## Environment Variables

### Backend (`backend/.env`)

```
FACEBOOK_CLIENT_ID, FACEBOOK_CLIENT_SECRET
SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
SUPABASE_JWKS_URL
ENCRYPTION_KEY                    # base64-encoded, used to encrypt stored tokens
CORS_ORIGINS                      # comma-separated allowed origins
ASSEMBLYAI_API_KEY
GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET
LOG_LEVEL, LOG_SUPPRESS_HTTPX, LOG_META_USAGE, LOG_AD_ID_TRUNCATED
ANALYTICS_MANAGER_RPC_ENABLED, ANALYTICS_MANAGER_RPC_FAIL_OPEN
```

### Frontend (`frontend/.env.local`)

```
NEXT_PUBLIC_API_BASE_URL          # backend URL (http://localhost:8000 dev)
NEXT_PUBLIC_FB_REDIRECT_URI       # Facebook OAuth redirect
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY
NEXT_PUBLIC_SENTRY_DSN
```

---

## Database

Supabase PostgreSQL with Row-Level Security (RLS). Migrations live in `supabase/migrations/`. The full schema is in `supabase/schema.sql`.

### Arquivos de referência do schema

| Arquivo | Quando usar |
|---|---|
| `supabase/schema_map.md` | Consulta rápida de tabelas e colunas — leia este primeiro |
| `supabase/schema.sql` | Detalhes de constraints, índices, RLS policies, funções/RPCs, triggers |
| `supabase/migrations/` | Histórico de alterações — não consultar para entender o schema atual |

**Fluxo de leitura:** sempre comece pelo `schema_map.md`. Só vá ao `schema.sql` se precisar de algo além de nomes de colunas e tipos (ex: corpo de uma função RPC, política RLS específica, índice).

**Não é necessário consultar os arquivos de `migrations/`** para entender o schema — eles servem apenas para rastrear histórico de alterações.

### Sincronizar schema com o banco remoto

Quando o banco remoto evoluir (nova migration aplicada), sincronize os arquivos locais:

```bash
# 1. Atualizar schema.sql
pg_dump "postgresql://postgres:SENHA@db.yyhiwayyvawsdsptdklx.supabase.co:5432/postgres" \
  --schema-only --schema=public -f supabase/schema.sql

# 2. Regenerar schema_map.md
py supabase/generate_schema_map.py
```

Tabelas: `ad_accounts`, `ad_metric_pack_map`, `ad_metrics`, `ad_sheet_integrations`, `ad_transcriptions`, `ads`, `bulk_ad_items`, `facebook_connections`, `google_accounts`, `jobs`, `packs`, `user_preferences`.

All schema changes must go through migration files — never edit `schema.sql` directly without a corresponding migration.

---

## Documentation

Internal docs in `/documentation/`:
- `authenticated-app-visual-standard.md` — UI/UX visual standards to follow
- `como-funciona-o-app.md` — feature explanations in Portuguese
- `explorer-page-design.md`, `pagina-insights.md` — page-level specs
- `decisoes-tecnicas.md` — decisões de arquitetura e lições aprendidas (espelho humano da memória do Claude)

Deployment docs in `/deploy/`: `README.md`, `QUICK_START.md`, `ENV_TEMPLATE.md`, `SETUP_GUIDE.md`, `TEST_CHECKLIST.md`.

## Gerenciamento de memória e decisões técnicas

Claude deve gerenciar memórias de forma autônoma e proativa ao longo do desenvolvimento. Sempre que identificar algo que vale registrar, deve fazê-lo sem precisar ser solicitado — e **sempre notificar o usuário** ao final da mensagem quando uma memória for criada, atualizada ou removida.

### Quando criar/atualizar uma memória

- Decisão de arquitetura ou abordagem com motivação não-óbvia
- Lição aprendida a partir de um bug ou comportamento inesperado de API externa (ex.: Meta, Supabase)
- Padrão validado que deve ser seguido em contextos similares
- Restrição de negócio ou técnica que afeta escolhas futuras

### Quando NÃO criar memória

- Padrões de código deriváveis lendo o próprio código
- Detalhes de tarefas em andamento (usar tasks para isso)
- Informações já documentadas no `CLAUDE.md`

### Como registrar

Sempre atualizar **ambos**:

1. `C:\Users\worki\.claude\projects\C--projetos-Hookify\memory\` — arquivo individual + índice `MEMORY.md` (carregado pelo Claude em futuras conversas)
2. `/documentation/decisoes-tecnicas.md` — espelho legível por humanos, versionado em git

### Notificação obrigatória

Toda vez que uma memória for criada, atualizada ou removida — seja por solicitação do usuário ou por iniciativa própria — Claude deve informar explicitamente ao final da mensagem: o que foi feito e qual arquivo foi afetado.
