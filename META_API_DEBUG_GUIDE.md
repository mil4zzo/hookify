# 🔍 Debug da API Meta - Guia de Uso

## 📋 **O que foi implementado:**

### ✅ **Schemas Flexíveis**

- Todos os schemas Zod agora usam `.passthrough()` para aceitar campos extras
- Campos opcionais onde antes eram obrigatórios
- Validação mais permissiva para evitar rejeição de dados válidos

### ✅ **Debug Detalhado**

- **Backend**: Logs detalhados de todas as chamadas para a API do Meta
- **Frontend**: Console logs das respostas recebidas do backend
- **Informações capturadas**: URL, payload, status code, headers, response body

## 🧪 **Como testar e capturar dados:**

### **1. Iniciar o Backend com Debug**

```bash
cd backend
python -m uvicorn app.main:app --reload --port 8000
```

### **2. Acessar o Frontend**

```bash
cd frontend
npm run dev
```

### **3. Fazer Login e Testar**

1. Acesse: http://localhost:3000/login
2. Faça login com Facebook
3. Acesse: http://localhost:3000/api-test
4. Clique em "Conectar com Facebook" (se não estiver logado)
5. Teste "Buscar Anúncios" com uma conta de anúncios

### **4. Capturar Logs**

#### **Backend (Terminal do FastAPI):**

```
=== META API DEBUG - /me ===
URL: https://graph.facebook.com/v24.0/me?access_token=...
Payload: {'fields': 'email,first_name,last_name,name,picture{url}'}
Status Code: 200
Response Headers: {...}
Response Body: {
  "id": "123456789",
  "name": "João Silva",
  "email": "joao@example.com",
  ...
}
=== END DEBUG ===
```

#### **Frontend (Console do Browser):**

```
=== FRONTEND DEBUG - Meta API Response ===
URL: /facebook/me
Method: get
Status: 200
Headers: {...}
Data: {
  "id": "123456789",
  "name": "João Silva",
  ...
}
=== END DEBUG ===
```

## 📤 **Enviar os Dados Capturados:**

### **Para cada endpoint testado, envie:**

1. **`/me`** - Dados do usuário
2. **`/me/adaccounts`** - Lista de contas de anúncios
3. **`/insights`** - Dados de anúncios (se disponível)

### **Formato sugerido:**

```
## Endpoint: /me
**Backend Log:**
[cole aqui o log completo do backend]

**Frontend Log:**
[cole aqui o log completo do frontend]

## Endpoint: /me/adaccounts
**Backend Log:**
[cole aqui o log completo do backend]

**Frontend Log:**
[cole aqui o log completo do frontend]
```

## 🎯 **Objetivo:**

Com os dados reais capturados, poderei:

1. **Criar schemas Zod precisos** baseados na estrutura real
2. **Otimizar a validação** para aceitar apenas campos necessários
3. **Melhorar a performance** evitando rejeições desnecessárias
4. **Garantir compatibilidade** com a API do Meta

## ⚠️ **Importante:**

- Os logs contêm tokens de acesso - **não compartilhe em locais públicos**
- Teste com diferentes contas se possível
- Capture tanto sucessos quanto erros
- Se não houver contas de anúncios, ainda assim envie os logs do `/me`

**Agora teste e me envie os logs capturados!** 🚀
