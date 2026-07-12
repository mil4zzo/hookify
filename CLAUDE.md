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

**Design system (OBRIGATÓRIO ao criar/editar UI)**: antes de criar qualquer componente visual, leia `documentation/authenticated-app-visual-standard.md` — em especial as seções "Contrato de controles (sizing)" e "Contrato de tokens". Regras inegociáveis:
- Altura de controle (Button, Input, SelectTrigger, Combobox, FilterSelectButton) SEMPRE via prop `size` (`"default"` 40px | `"sm"` 32px), NUNCA via `h-8`/`h-9`/`h-10` em className. Se o tamanho não existe, adicione variant em `components/ui/`.
- Micro-texto: `text-2xs` (10px), nunca `text-[Npx]`. Sombras: só `shadow-elevation-flat/raised/overlay`. Camadas de app: só `z-sticky/overlay/modal/dropdown/toast/tooltip` (stacking local dentro de container pode usar `z-10`/`z-20` core).
- O `cn()` usa `extendTailwindMerge` com os tokens custom registrados (`lib/utils/cn.ts`). Novo token no tailwind.config → registrar também lá (spacing em `SPACING_TOKENS`; shadow/z/fontSize em `classGroups`).
- `npm run check:design-system` + `tsc --noEmit` rodam no pre-commit (husky). Exceção pontual: `// design-system-exception: rule-id - razão` na linha acima da violação.

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

O default é **NÃO registrar**. A memória existe para carregar, em toda sessão
futura, apenas o que mudaria uma decisão — não para arquivar o que foi feito
(isso é o git). Cada memória tem custo permanente: ocupa contexto e leitura em
todas as conversas seguintes. Registre com parcimônia.

### Teste antes de registrar (todos precisam ser "sim")

1. **Mudaria uma decisão futura?** Sem esta nota, eu (ou outro Claude)
   repetiria um erro ou tomaria uma decisão pior numa próxima tarefa?
2. **É não-derivável?** A informação NÃO pode ser recuperada lendo o código,
   o schema, o histórico git ou o próprio `CLAUDE.md`?
3. **É durável?** Continua verdadeira depois que a tarefa atual fechar (não é
   estado de trabalho em andamento)?

Na dúvida em qualquer um dos três → **não registre**. É melhor perder uma nota
marginal do que inflar o contexto de todas as sessões futuras.

### Casos que tipicamente passam no teste

- Comportamento inesperado/contra-intuitivo de API externa (Meta, Supabase) que
  já custou um bug e voltaria a custar.
- Restrição de negócio/técnica que o código não revela e que limita escolhas
  futuras.
- Decisão de arquitetura cuja motivação foi rejeitada em favor de outra — o
  "por que NÃO fizemos X" que se perde no git.

### Casos que NÃO registrar

- Qualquer coisa derivável lendo código, schema ou git (estrutura, o fix em si).
- Padrão de código "boa prática" genérico sem sutileza específica do projeto.
- Detalhe de tarefa em andamento (use tasks).
- O que já está no `CLAUDE.md`.
- Uma sutileza a mais sobre um tema que já tem memória → **atualize a existente,
  não crie um arquivo novo**.

### Consolidação (preferir sobre criação)

Antes de criar, procure memória existente que cubra o mesmo tema e **edite-a**.
Se duas memórias tratam do mesmo assunto, funda-as. Uma memória que se provou
errada deve ser **removida**, não deixada como ruído. O objetivo é um conjunto
pequeno e afiado, não um log que só cresce.

### Como registrar (quando passar no teste)

Atualizar **ambos**:

1. `C:\Users\worki\.claude\projects\C--projetos-Hookify\memory\` — arquivo
   individual + índice `MEMORY.md`.
2. `/documentation/decisoes-tecnicas.md` — espelho humano, versionado em git.

### Notificação

Ao criar, atualizar ou remover uma memória, informar ao final da mensagem: o que
foi feito e qual arquivo. (Não notificar quando decidir **não** registrar — isso
é o comportamento normal, não um evento.)
