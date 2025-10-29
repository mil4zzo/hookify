# 🔧 Correção do Erro Facebook OAuth

## ✅ Problema Identificado

O erro `400 Bad Request` ocorre porque a URL de callback `http://localhost:3000/callback` não está configurada no app do Facebook.

## 🛠️ Solução

### 1. Acesse o Facebook Developers

- Vá para: https://developers.facebook.com/
- Faça login com sua conta Facebook

### 2. Configure o App do Facebook

- Selecione seu app: **Hookify** (ID: 1013320407465551)
- Vá para **Configurações** → **Básico**

### 3. Adicione a URL de Callback

- Na seção **URLs de redirecionamento OAuth válidas**
- Adicione: `http://localhost:3000/callback`
- Clique em **Salvar alterações**

### 4. Verifique as Configurações

Certifique-se de que estas URLs estão configuradas:

- ✅ `http://localhost:3000/callback` (para desenvolvimento)
- ✅ `http://localhost:8501/callback` (para Streamlit, se necessário)

## 🧪 Teste Após Configuração

1. **Reinicie o backend**:

   ```bash
   cd backend
   python -m uvicorn app.main:app --reload --port 8000
   ```

2. **Teste o login**:
   - Acesse: http://localhost:3000/login
   - Clique em "Continuar com Facebook"
   - Faça login no popup
   - Deve funcionar sem erro 400

## 📋 Checklist de Configuração

- [ ] App Facebook criado
- [ ] CLIENT_ID e CLIENT_SECRET configurados no backend/.env
- [ ] URL de callback adicionada no Facebook Developers
- [ ] Backend rodando na porta 8000
- [ ] Frontend rodando na porta 3000

## 🔍 Debug Adicional

Se ainda houver problemas, verifique os logs do backend para ver a resposta completa do Facebook:

```bash
# No terminal do backend, você verá logs como:
# Facebook token exchange response: 400
# Response content: {"error":{"message":"Invalid redirect_uri","type":"OAuthException","code":100}}
```

## 📞 Suporte

Se o problema persistir após seguir estes passos, verifique:

1. Se o app Facebook está ativo
2. Se as credenciais estão corretas
3. Se não há restrições de domínio no app
