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

### Filtros de Busca (ao CRIAR o pack)

Estes decidem **quais anúncios entram no pack** e são enviados ao Meta na importação.
Não confundir com os filtros de análise, que são outra coisa — ver abaixo.

- **Campo**: Nome de campanha, adset ou anúncio
- **Operador**: CONTAIN, EQUAL, NOT_EQUAL, NOT_CONTAIN, STARTS_WITH, ENDS_WITH
- **Valor**: Texto a ser buscado

---

## Filtros de Análise (Manager, Boards e Critério de Validação)

As três telas usam **o mesmo construtor de regra**. Aprender numa vale para as outras: o
operador, a escala e o significado são idênticos; o que muda é só quais campos cada tela
oferece.

### O que dá para escrever

- **E / OU no topo**, e **subgrupos** com lógica própria. `hook > 30% E (gasto > 1000 OU
  resultados > 50)` é exprimível.
- **Texto**: contém, não contém, começa com, termina com, é igual, é diferente, **casa com a
  expressão** (regex) e **está vazio / tem valor**.
- **Métrica**: `> < >= <= = !=`, mais **"está vazio (não se aplica)"** e **"tem valor"**.
- **Dimensões**: tags, status, "criado em", pack, conta, campanha, conjunto.

### Porcentagem é a escala que você digita

`2` é 2%. `0,5` é 0,5%. Vale nas três telas e no filtro das linhas-filhas — antes cada uma
tinha uma convenção diferente e `hook > 0,5%` não funcionava em lugar nenhum.

### Status: os quatro rótulos, e o que cada aba lê

As opções são as mesmas do Gerenciador do Meta — **Ativo**, **Pausado**, **Pausado
(Conjunto)**, **Pausado (Campanha)** — em caixas de marcar (marcar mais de uma é "ou").
As duas últimas respondem a pergunta que "pausado" sozinho não responde: *está parado
porque eu parei, ou porque o pai está parado?*

O que cada aba considera:

| aba | o que é lido |
|---|---|
| **Anúncios** | o status do próprio anúncio, exato |
| **Conjuntos** | o estado do **conjunto**, como veio do Meta |
| **Campanhas** | o estado da **campanha**, como veio do Meta |
| **Criativos** | a única que agrega — ver abaixo |

Um conjunto pausado tem todos os seus anúncios em "Pausado (Conjunto)". Se a aba de
Conjuntos lesse os anúncios, ele apareceria como *Pausado (Conjunto)* — resposta certa
para o anúncio e errada para o conjunto, que está simplesmente **Pausado**. Por isso
cada aba lê o que lhe corresponde.

**Na aba Criativos**, a linha soma dezenas de anúncios:

- **Ativo** = tem pelo menos um anúncio ativo. E só isso — com algum no ar, nenhum
  motivo de pausa se aplica.
- Se **nenhum** está ativo, o criativo aparece em **cada motivo presente** entre seus
  anúncios. Um criativo parado com 30 anúncios pausados pelo conjunto e 1 pausado por
  você aparece tanto em *Pausado (Conjunto)* quanto em *Pausado*.

Por que "cada motivo presente" e não "todos pelo mesmo motivo": medido sobre 400
criativos reais, **motivo misturado é a regra** — só 88 tinham todos os anúncios parados
pela mesma razão, porque um criativo roda em várias campanhas e cada anúncio para por um
motivo. Com a regra estrita, as duas opções específicas ficariam quase vazias.

### Anúncios ativos: contagem, com corte

Campo numérico separado do status: *"criativos com mais de 3 anúncios ativos"*. O status
responde "tem algum"; este responde "quantos". Disponível nas abas **Criativos** e
**Conjuntos** — na de Anúncios seria sempre 0 ou 1, e na de Campanhas o número não vem
do servidor.

### Zero e "sem dado" são coisas diferentes

Uma métrica que é **divisão** fica *sem dado* quando o divisor é zero: hook de um anúncio de
imagem (não houve vídeo), CPR de um anúncio sem conversão, CTR de um anúncio sem impressão.
Linha sem dado **não entra em `< x` nem em `>= x`** — não há número para afirmar ou negar.
Para pedir essas linhas de propósito, use **"está vazio"**.

Antes, o zero que o servidor fabricava nesses casos era indistinguível de um zero real: era
por isso que "hook < 5%" trazia todo anúncio estático e "CPR mais barato" começava por quem
não converteu.

Métrica de **contagem** (gasto, impressões, plays, resultados) nunca fica sem dado — zero é
zero de verdade.

### Campanha e conjunto: "ALGUMA", não "a principal"

Uma linha da aba Criativos não é um anúncio — é o mesmo criativo somando dezenas de anúncios,
que podem estar espalhados por várias campanhas (22% deles estão). Filtrar por campanha
pergunta **"alguma campanha deste criativo é X"**. Antes comparava só com a campanha do
anúncio de maior entrega, e escondia o resto em silêncio.

O negativo funciona ao contrário, como se espera: **"nenhuma campanha contém X"** só é
verdade se nenhuma contiver.

### Onde cada campo aparece, e por quê

| Campo | Manager | Linhas-filhas | Boards | Critério |
|---|:-:|:-:|:-:|:-:|
| Métricas, nome do criativo, status, criado em | ✓ | ✓ | ✓ | ✓ |
| Anúncios ativos (contagem) | Criativos e Conjuntos | — | — | — |
| Tags | Criativos e Anúncios | — | ✓ | ✓ |
| Pack, Conta | ✓ | ✓ | ✓ | ✓ |
| Campanha / Conjunto (escolher da lista) | ✓ | — | ✓ | — |
| Nome da campanha / do conjunto (texto) | ✓ | ✓ | ✓ | ✓ |
| Métricas de MQL | só com planilha | só com planilha | só com planilha | — |

As ausências são deliberadas, e todas pela mesma razão: **um campo só é oferecido onde a tela
consegue responder a pergunta.**

- **Tags nas abas Conjunto e Campanha:** a tag é do criativo; a do representante descreveria o
  grupo errado. O servidor devolve lista vazia ali de propósito, então o filtro zeraria a
  tabela sempre.
- **Escolher campanha da lista nas linhas-filhas e no Critério:** uma lista precisa vir de
  algum lugar — as opções saem das linhas na tela. A linha-filha é um anúncio só e traz o
  *nome* do pai, não o id; e o Critério vive nas Configurações, onde não há período nem pack
  selecionado. Nos dois, a pergunta se faz por **nome**, que é texto e não precisa de lista.

### O funil no cabeçalho da coluna

Ele **mostra** onde aquela coluna está sendo filtrada — abre o construtor e rola até a
condição. Não cria condição nova: numa regra com "ou" e subgrupos não existe resposta óbvia
para onde ela entraria, e o mesmo clique faria coisas opostas conforme o lugar.

Numa regra que usa "ou" cruzando colunas, o funil acende nas duas. É honesto: as duas
participam da decisão.

### Onde cada filtro é guardado

- **Manager**: na sessão do navegador, por aba. É recorte de trabalho, não preferência — fecha
  o navegador, some.
- **Boards**: no banco, junto do grupo.
- **Critério de validação**: no banco, em `user_preferences`. É ele que decide quais anúncios
  são elegíveis a julgamento no G.O.L.D., no plano de ação e nas oportunidades — quem não
  atende fica "em fase de teste".

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
