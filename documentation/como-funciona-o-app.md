# Como Funciona o Hookify

## Visão Geral

O **Hookify** é uma plataforma de análise de anúncios do Facebook que permite importar, organizar e analisar performance de campanhas publicitárias. O sistema trabalha com o conceito de **Packs de Anúncios**, que são coleções de anúncios agrupados por critérios específicos (período, conta, filtros).

## Principais Funcionalidades

### 1. **ADs Loader** - Gerenciamento de Packs

Página principal para criar e gerenciar packs de anúncios.

### 2. **Dashboard** - Visão Geral

Visualização de métricas agregadas e estatísticas gerais.

### 3. **Rankings** - Performance Comparativa

Rankings de anúncios por diferentes métricas (Hook, CTR, CPR, etc.).

### 4. **Insights** - Análises Detalhadas

Análises aprofundadas e insights sobre os anúncios.

---

## Como Funciona a Importação de Anúncios

### Processo de Criação de um Pack

1. **Configuração Inicial**

   - **Nome do Pack**: Identificação descritiva (ex: "Black Friday Campaign")
   - **Conta de Anúncios**: Seleção da conta do Facebook conectada
   - **Período**: Data de início e data de fim para buscar anúncios
   - **Filtros Opcionais**: Filtros por nome de campanha, adset ou anúncio
   - **Auto-refresh**: Opção para manter o pack atualizado automaticamente (apenas se data final = hoje)

2. **Processo de Importação (Job Assíncrono)**

   - O sistema cria um **job assíncrono** que busca anúncios da API do Facebook
   - O job processa os dados em lotes, coletando:
     - Informações básicas (IDs, nomes, status)
     - Métricas de performance (impressões, cliques, gastos, etc.)
     - Dados de criativos (vídeos, thumbnails)
     - Informações de campanha e adset
   - Durante o processamento, o frontend faz **polling** a cada 2 segundos para verificar o progresso
   - O job pode levar de alguns segundos a vários minutos, dependendo do volume de dados

3. **Armazenamento**

   - Os anúncios são salvos na tabela `ads` do Supabase
   - As métricas diárias são armazenadas na tabela `ad_metrics` (uma linha por anúncio por dia)
   - O pack é criado na tabela `packs` com metadados e estatísticas agregadas
   - Os dados também são armazenados em cache local (IndexedDB) para acesso rápido

4. **Resultado**
   - Pack criado com estatísticas agregadas (total de anúncios, campanhas, adsets, investimento total)
   - Anúncios disponíveis para análise nas outras páginas do sistema

### Atualização de Packs (Refresh)

- **Manual**: O usuário pode atualizar um pack a qualquer momento, buscando novos dados desde a última atualização até hoje
- **Automático**: Packs com `auto_refresh` ativado são atualizados automaticamente quando a data final é "hoje"
- O processo de refresh segue o mesmo fluxo de importação, mas apenas para o período novo

---

## Como Funciona o Enriquecimento via Planilhas (Google Sheets)

### Objetivo

Enriquecer os dados dos anúncios com informações de **leadscore** e **CPR máximo** que vêm de sistemas externos (CRM, planilhas de leads, etc.).

### Processo de Configuração

1. **Conectar Planilha do Google**

   - O usuário seleciona um pack e escolhe "Enriquecer leadscore (Google Sheets)"
   - O sistema solicita permissão para acessar Google Sheets (OAuth)
   - O usuário seleciona:
     - **Planilha**: Arquivo do Google Sheets
     - **Aba**: Worksheet específica dentro da planilha
     - **Coluna de Ad ID**: Coluna que contém o ID do anúncio
     - **Coluna de Data**: Coluna que contém a data do lead
     - **Formato de Data**: DD/MM/YYYY ou MM/DD/YYYY
     - **Coluna de Leadscore** (opcional): Valores de leadscore por lead
     - **Coluna de CPR Max** (opcional): Valor máximo de CPR aceitável

2. **Salvamento da Configuração**
   - A configuração é salva na tabela `ad_sheet_integrations`
   - O pack é vinculado à integração através do campo `sheet_integration_id`

### Processo de Sincronização (Importação)

1. **Leitura da Planilha**

   - O sistema lê todas as linhas da planilha configurada
   - Cada linha representa um lead/conversão

2. **Agregação de Dados**

   - Os dados são agregados por par **(ad_id, data)**:
     - **Leadscore**: Valores são coletados em um array (preserva valores individuais)
     - **CPR Max**: Usa o maior valor encontrado para o par (ad_id, data)

3. **Geração de IDs de Métricas**

   - Para cada par (ad_id, data), gera um ID no formato: `"{data}-{ad_id}"`
   - Este ID é a chave primária da tabela `ad_metrics`

4. **Verificação de Existência**

   - O sistema verifica quais IDs existem na tabela `ad_metrics`
   - Apenas registros existentes são atualizados (não cria novos)
   - Se a integração estiver vinculada a um pack específico, filtra apenas métricas daquele pack

5. **Atualização em Lote**

   - Os dados são agrupados por valores similares (leadscore_values, cpr_max)
   - Atualizações são feitas em lotes usando uma função RPC do Supabase (`batch_update_ad_metrics_enrichment`)
   - Isso é muito mais eficiente que updates individuais (10-50x mais rápido)

6. **Resultado**
   - Os campos `leadscore_values` (array) e `cpr_max` são atualizados em `ad_metrics`
   - Estatísticas são calculadas (média de leadscore, contagem de leads, etc.)
   - O status da integração é atualizado com data/hora da última sincronização

### Sincronização Manual

- O usuário pode sincronizar a planilha manualmente a qualquer momento
- O processo é o mesmo descrito acima
- O sistema mostra progresso e estatísticas finais (linhas processadas, atualizadas, puladas)

---

## Estrutura de Dados

### Tabela `packs`

- Armazena metadados dos packs (nome, período, filtros, stats agregadas)
- Vinculado a `ad_sheet_integrations` via `sheet_integration_id`

### Tabela `ads`

- Armazena informações básicas dos anúncios (um registro por anúncio único)
- Campos: ad_id, nomes, IDs de campanha/adset, criativos, thumbnails

### Tabela `ad_metrics`

- Armazena métricas diárias (um registro por anúncio por dia)
- Chave primária: `"{date}-{ad_id}"`
- Campos: métricas do Facebook (impressões, cliques, gastos, etc.)
- Campos de enriquecimento: `leadscore_values` (array), `cpr_max`, `mql_count`, etc.

### Tabela `ad_sheet_integrations`

- Armazena configurações de integração com Google Sheets
- Campos: spreadsheet_id, worksheet_title, mapeamento de colunas, formato de data

---

## Fluxo de Dados Completo

```
1. Usuário cria pack
   ↓
2. Job assíncrono busca anúncios do Facebook
   ↓
3. Dados são salvos em ads e ad_metrics
   ↓
4. Pack é criado com stats agregadas
   ↓
5. (Opcional) Usuário conecta planilha do Google
   ↓
6. (Opcional) Sincronização enriquece ad_metrics com leadscore/CPR
   ↓
7. Dados enriquecidos são usados em Rankings, Insights e Dashboard
```

---

## Opções e Configurações

### Packs

- **Renomear**: Alterar nome do pack
- **Atualizar**: Buscar novos dados desde última atualização
- **Auto-refresh**: Atualização automática (apenas se data final = hoje)
- **Remover**: Deletar pack e todos os dados relacionados
- **Visualizar Tabela**: Ver todos os anúncios em formato tabular
- **Exportar CSV/JSON**: Exportar dados brutos

### Integrações de Planilha

- **Conectar**: Configurar nova integração
- **Sincronizar**: Atualizar dados da planilha manualmente
- **Status**: Visualizar última sincronização e status

### Filtros de Busca

- **Campo**: Nome de campanha, adset ou anúncio
- **Operador**: CONTAIN, EQUAL, NOT_EQUAL, NOT_CONTAIN, STARTS_WITH, ENDS_WITH
- **Valor**: Texto a ser buscado

---

## Métricas e Análises Disponíveis

### Métricas Básicas

- **Spend**: Investimento total
- **Impressions**: Impressões
- **Clicks**: Cliques
- **CTR**: Taxa de cliques
- **CPM**: Custo por mil impressões
- **CPC**: Custo por clique

### Métricas de Vídeo

- **Hook Rate**: Taxa de retenção inicial (primeiros 3 segundos)
- **Hold Rate**: Taxa de retenção geral
- **Plays**: Reproduções
- **ThruPlays**: Reproduções completas

### Métricas de Conversão

- **CPR**: Custo por resultado/conversão
- **Page Conversion**: Taxa de conversão na página
- **Connect Rate**: Taxa de conexão (cliques no link → landing page)

### Métricas Enriquecidas (via Planilha)

- **Leadscore**: Pontuação de qualidade do lead (array de valores)
- **CPR Max**: Valor máximo de CPR aceitável
- **MQL Count**: Contagem de Marketing Qualified Leads
- **CPMQL**: Custo por MQL

---

## Observações Importantes

1. **Performance**: O sistema é otimizado para processar grandes volumes de dados usando atualizações em lote e cache local

2. **Segurança**: Todos os dados são isolados por usuário (Row Level Security no Supabase)

3. **Autenticação**: Requer conexão com Facebook (OAuth) e Google (para planilhas)

4. **Cache**: Dados são armazenados localmente (IndexedDB) para acesso rápido, mas sempre sincronizados com o servidor

5. **Limitações**:
   - Auto-refresh só funciona se a data final do pack for "hoje"
   - A sincronização de planilhas só atualiza registros existentes (não cria novos)
   - O formato de data da planilha deve ser configurado corretamente (DD/MM/YYYY ou MM/DD/YYYY)
