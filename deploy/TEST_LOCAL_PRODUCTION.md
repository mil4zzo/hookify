# 🧪 Como Testar em Modo Produção Localmente

Este guia mostra como rodar o frontend e backend em modo produção localmente para identificar erros antes do deploy.

## 🎯 Por que testar localmente?

- **Identificar erros de TypeScript** antes do deploy
- **Testar o build de produção** sem precisar fazer deploy
- **Economizar tempo** - correções são mais rápidas localmente
- **Debug mais fácil** - logs e erros mais acessíveis

## 📋 Pré-requisitos

- Node.js instalado
- Python 3.11+ instalado
- Todas as dependências instaladas

## 🚀 Testando o Frontend em Modo Produção

### 1. Instalar dependências (se ainda não fez)

```powershell
cd frontend
npm install
```

### 2. Fazer build de produção

```powershell
npm run build
```

Este comando:
- ✅ Compila TypeScript com verificação rigorosa
- ✅ Gera os arquivos otimizados em `.next/`
- ✅ **Falha se houver erros de tipo** (igual ao servidor)

### 3. Se o build passar, testar o servidor de produção

```powershell
npm run start
```

Isso inicia o servidor Next.js em modo produção na porta 3000.

### 4. Acessar no navegador

```
http://localhost:3000
```

## 🐍 Testando o Backend em Modo Produção

### 1. Ativar ambiente virtual

```powershell
cd backend
.\venv\Scripts\Activate.ps1
```

### 2. Instalar dependências (se necessário)

```powershell
pip install -r requirements.txt
```

### 3. Verificar configuração

```powershell
python scripts/check_config.py
```

### 4. Iniciar servidor

```powershell
uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4
```

Ou usar o script:

```powershell
python run_backend.py
```

## 🔍 Comandos Úteis para Debug

### Frontend

```powershell
# Build com mais informações
npm run build -- --debug

# Verificar tipos sem build
npx tsc --noEmit

# Lint
npm run lint
```

### Backend

```powershell
# Verificar tipos (se usar mypy)
# mypy app/

# Testar importação
python -c "from app.main import app; print('OK')"
```

## ⚠️ Diferenças entre Dev e Produção

| Aspecto | Dev (`npm run dev`) | Produção (`npm run build`) |
|---------|---------------------|---------------------------|
| TypeScript | Verificação relaxada | Verificação rigorosa |
| Erros de tipo | Avisos apenas | **Falha o build** |
| Performance | Mais lento | Otimizado |
| Hot reload | Sim | Não |
| Source maps | Completos | Minimizados |

## 🐛 Resolvendo Erros Comuns

### Erro: "Type X is not assignable to type Y"

**Solução**: Converter o tipo explicitamente:
```typescript
// ❌ Errado
disabled={isTogglingAutoRefresh}

// ✅ Correto
disabled={!!isTogglingAutoRefresh}
```

### Erro: "Property X is possibly undefined"

**Solução**: Usar optional chaining ou valores padrão:
```typescript
// ❌ Errado
value={dateRange.start}

// ✅ Correto
value={dateRange.start || ""}
// ou
value={dateRange.start ?? ""}
```

### Erro: "Unterminated regexp literal"

**Solução**: Geralmente é erro de sintaxe HTML/JSX. Verificar tags não fechadas.

## 📝 Checklist Antes do Deploy

- [ ] `npm run build` passa sem erros
- [ ] `npm run start` funciona localmente
- [ ] Backend inicia sem erros
- [ ] Testes básicos funcionam
- [ ] Variáveis de ambiente configuradas

## 🎯 Workflow Recomendado

1. **Desenvolver** → `npm run dev` (desenvolvimento rápido)
2. **Testar build** → `npm run build` (verificar erros)
3. **Testar produção** → `npm run start` (simular servidor)
4. **Corrigir erros** → Voltar ao passo 2
5. **Deploy** → Apenas quando build passar localmente

## 💡 Dica

Crie um script no `package.json` para facilitar:

```json
{
  "scripts": {
    "build:check": "npm run build && echo 'Build OK!'",
    "test:prod": "npm run build && npm run start"
  }
}
```

