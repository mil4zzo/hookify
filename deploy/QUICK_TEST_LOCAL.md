# ⚡ Teste Rápido - Modo Produção Local

## 🎯 Testar Frontend (Next.js)

### Passo 1: Ir para o diretório frontend
```powershell
cd frontend
```

### Passo 2: Fazer build (detecta erros de TypeScript)
```powershell
npm run build
```

**O que acontece:**
- ✅ Se passar: Build concluído com sucesso
- ❌ Se falhar: Mostra os erros de TypeScript (igual ao servidor)

### Passo 3: Se build passar, testar servidor de produção
```powershell
npm run start
```

Acesse: `http://localhost:3000`

## 🐍 Testar Backend (FastAPI)

### Passo 1: Ir para o diretório backend
```powershell
cd backend
```

### Passo 2: Ativar venv
```powershell
.\venv\Scripts\Activate.ps1
```

### Passo 3: Iniciar servidor
```powershell
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Ou:
```powershell
python run_backend.py
```

## 🔄 Workflow Recomendado

1. **Desenvolver** → `npm run dev` (modo desenvolvimento)
2. **Antes de commitar** → `npm run build` (verificar erros)
3. **Se build passar** → Pode fazer deploy
4. **Se build falhar** → Corrigir erros e repetir passo 2

## ⚠️ Importante

- `npm run dev` = desenvolvimento (mais permissivo)
- `npm run build` = produção (rigoroso, igual ao servidor)
- **Sempre teste `npm run build` antes do deploy!**

