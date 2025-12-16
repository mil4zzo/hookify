# Hookify Frontend

Frontend Next.js para o Hookify, migrado do Streamlit.

## 🚀 Quick Start

### 1. Instalar dependências

```bash
npm install
```

### 2. Configurar variáveis de ambiente

Crie um arquivo `.env.local` na raiz do frontend:

```bash
# Frontend Environment Variables
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
NEXT_PUBLIC_FB_REDIRECT_URI=http://localhost:3000/callback

# Feature Flags
NEXT_PUBLIC_USE_REMOTE_API=true

# Development
NODE_ENV=development
```

### 3. Rodar o servidor de desenvolvimento

```bash
npm run dev
```

Acesse `http://localhost:3000`

## 📁 Estrutura

```
frontend/
├── app/                    # Next.js App Router
│   ├── ui-demo/           # Página de demonstração dos componentes
│   ├── test-ui/           # Página de teste dos estados
│   └── layout.tsx         # Layout raiz
├── components/
│   ├── ui/                # Componentes shadcn/ui
│   ├── common/            # Componentes comuns (States, etc)
│   └── providers/         # Providers (React Query, etc)
├── lib/
│   ├── config/            # Configurações (env, etc)
│   └── utils/             # Utilitários (errors, toast, cn)
└── tailwind.config.ts     # Configuração do Tailwind
```

## 🎨 Design System

### Cores (Dark Theme)

- **Background**: `#111315` (bg)
- **Surface**: `#1A1D21` (surface), `#23272B` (surface2)
- **Text**: `#E5E7EB` (text), `#9CA3AF` (muted)
- **Brand**: `#2E7D32` (brand), `#256D2A` (brand-600)
- **Status**: `#EF4444` (danger), `#F59E0B` (warning), `#3B82F6` (info)

### Tipografia

- **Sans**: Inter (UI)
- **Mono**: Roboto Mono (números/métricas)

### Componentes

- **Button**: Variantes (default, secondary, outline, ghost, destructive, link)
- **Input**: Campos de texto com estados
- **Card**: Containers com header/content/footer
- **Dialog**: Modais acessíveis
- **Skeleton**: Estados de loading
- **States**: Loading, Error, Empty padronizados

## 🧪 Testes

### Páginas de Teste

- `/ui-demo` - Demonstração completa dos componentes
- `/test-ui` - Teste dos estados de UI

### Responsividade

Teste em diferentes breakpoints:

- **375px** (mobile)
- **768px** (tablet)
- **1280px** (desktop)

## 🔧 Próximos Passos

1. ✅ Design System básico
2. ✅ Componentes shadcn/ui
3. ✅ Estados padronizados
4. ✅ Sistema de toast/erro
5. 🔄 Camada de API (Axios + TanStack Query)
6. 🔄 Estado global (Zustand)
7. 🔄 OAuth Facebook
8. 🔄 Páginas principais (Login, Ads Loader, Rankings, Insights, etc)

## 📦 Dependências Principais

- **Next.js 15** - Framework React
- **Tailwind CSS** - Estilização
- **shadcn/ui** - Componentes UI
- **TanStack Query** - Cache e sincronização de dados
- **Zustand** - Estado global
- **Zod** - Validação de schemas
- **Axios** - Cliente HTTP
- **Sonner** - Sistema de toast

