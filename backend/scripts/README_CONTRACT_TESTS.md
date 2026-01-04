# Testes de Contrato - Endpoints de Analytics

Este documento descreve como executar os testes de contrato para os endpoints de Analytics.

## O que são Testes de Contrato?

Os testes de contrato garantem que os endpoints de Analytics retornam dados no formato esperado e que os valores são consistentes:

- **Campos essenciais presentes**: Todos os campos obrigatórios estão na resposta
- **Valores não-negativos**: Campos numéricos base (impressions, clicks, etc.) são >= 0
- **Ratios consistentes**: Ratios (CTR, Link CTR, Connect Rate, CPM, Page Conv) são calculados corretamente a partir de seus numeradores/denominadores

## Pré-requisitos

1. Backend rodando (por padrão em `http://localhost:8000`)
2. Token de acesso válido do Facebook (ACCESS_TOKEN)
3. Python 3.8+ com dependências instaladas

## Como Executar

### 1. Configurar Variáveis de Ambiente

```bash
export ACCESS_TOKEN="seu_token_do_facebook_aqui"
export BASE_URL="http://localhost:8000"  # opcional, padrão é localhost:8000
```

### 2. Executar os Testes

```bash
python backend/scripts/contract_test_analytics.py
```

### 3. Interpretar os Resultados

- **✓ Verde**: Teste passou
- **✗ Vermelho**: Erro de contrato encontrado
- **⚠ Amarelo**: Aviso (ex: lista vazia, mas pode ser esperado)
- **ℹ Azul**: Informação

O script retorna código de saída:

- `0`: Todos os testes passaram
- `1`: Um ou mais testes falharam

## Endpoints Testados

O runner testa automaticamente os seguintes endpoints:

1. **POST /analytics/rankings** - Endpoint principal de rankings
2. **POST /analytics/ad-performance** - Alias de rankings
3. **GET /analytics/rankings/ad-id/{ad_id}** - Detalhes de um anúncio
4. **GET /analytics/rankings/ad-id/{ad_id}/history** - Histórico de um anúncio
5. **GET /analytics/rankings/ad-name/{ad_name}/children** - Filhos de um ad_name
6. **GET /analytics/rankings/ad-name/{ad_name}/history** - Histórico de um ad_name
7. **GET /analytics/rankings/adset-id/{adset_id}** - Detalhes de um adset
8. **POST /analytics/dashboard** - Dashboard agregado

## Estratégia de Teste

1. O runner começa testando `/analytics/rankings` com uma janela de 7 dias
2. Se a resposta contiver dados, extrai `ad_id`, `ad_name` e `adset_id` do primeiro item
3. Usa esses IDs para testar os endpoints dependentes
4. Todos os endpoints são validados contra o mesmo contrato

## Contrato Validado

### Campos Base (sempre presentes)

- `impressions` (int, >= 0)
- `clicks` (int, >= 0)
- `inline_link_clicks` (int, >= 0)
- `spend` (float, >= 0)
- `lpv` (int, >= 0)

### Ratios (quando presentes)

- **CTR**: `ctr ≈ clicks / impressions` (ou 0 se impressions = 0)
- **Website CTR**: `website_ctr ≈ inline_link_clicks / impressions` (ou 0 se impressions = 0)
- **Connect Rate**: `connect_rate ≈ lpv / inline_link_clicks` (ou 0 se inline_link_clicks = 0)
- **CPM**: `cpm ≈ (spend / impressions) * 1000` (ou 0 se impressions = 0)
- **Page Conv**: `page_conv ≈ results / lpv` (quando results disponível, ou 0 se lpv = 0)

### Tolerância

Os ratios são comparados com tolerância de `1e-6` para lidar com arredondamentos de ponto flutuante.

## Integração com CI

### GitHub Actions (Exemplo)

```yaml
name: Contract Tests

on:
  workflow_dispatch: # Execução manual
  schedule:
    - cron: "0 2 * * *" # Diariamente às 2h

jobs:
  contract-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Set up Python
        uses: actions/setup-python@v4
        with:
          python-version: "3.10"

      - name: Install dependencies
        run: |
          cd backend
          pip install -r requirements.txt
          pip install requests

      - name: Run contract tests
        env:
          ACCESS_TOKEN: ${{ secrets.FB_ACCESS_TOKEN }}
          BASE_URL: ${{ secrets.BACKEND_URL }}
        run: |
          python backend/scripts/contract_test_analytics.py
```

### Execução Manual no CI

Para executar manualmente (quando necessário):

```bash
# No ambiente CI, com secrets configurados
export ACCESS_TOKEN="$FB_ACCESS_TOKEN"
export BASE_URL="$BACKEND_URL"
python backend/scripts/contract_test_analytics.py
```

## Troubleshooting

### Erro: "Variável de ambiente ACCESS_TOKEN não encontrada"

**Solução**: Defina a variável antes de executar:

```bash
export ACCESS_TOKEN="seu_token"
```

### Erro: "Connection refused" ou "Connection timeout"

**Solução**: Verifique se o backend está rodando:

```bash
# Verificar se o backend responde
curl http://localhost:8000/health
```

### Erro: "401 Unauthorized"

**Solução**: Verifique se o token está válido e não expirou.

### Erro: "Campo obrigatório 'X' ausente"

**Solução**: Isso indica uma quebra de contrato. Verifique:

1. Se a migração do banco foi aplicada (especialmente para `lpv`)
2. Se há dados suficientes no período testado
3. Se o código do endpoint foi modificado recentemente

### Aviso: "Resposta contém lista vazia"

**Solução**: Isso pode ser esperado se não houver dados no período testado. O teste ainda valida a estrutura da resposta.

## Manutenção

### Adicionar Novo Endpoint

1. Adicione o método de teste em `ContractTestRunner` (ex: `test_new_endpoint`)
2. Chame o método em `run_all()`
3. Use o validador apropriado de `analytics_contracts.py` ou crie um novo se necessário

### Modificar Contrato

1. Atualize os validadores em `backend/app/contracts/analytics_contracts.py`
2. Execute os testes para verificar se há quebras
3. Atualize este documento se necessário

## Arquivos Relacionados

- **Validador**: `backend/app/contracts/analytics_contracts.py`
- **Runner**: `backend/scripts/contract_test_analytics.py`
- **Endpoints**: `backend/app/routes/analytics.py`






