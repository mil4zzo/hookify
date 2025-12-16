# Página Insights - Documentação Completa

## Visão Geral

A página **Insights** é uma das principais funcionalidades do Hookify, focada em fornecer análises acionáveis e identificar oportunidades de melhoria nos anúncios. A página é dividida em três seções principais:

1. **Oportunidades** - Cards com anúncios que têm maior potencial de melhoria
2. **Gems** - Top anúncios por diferentes métricas (Hook, CTR, Page Conv, etc.)
3. **Insights Kanban** - Anúncios organizados por tipo de problema/oportunidade

---

## Seção 1: Oportunidades

### Objetivo

Identificar anúncios com maior potencial de melhoria de CPR (Custo por Resultado), mostrando o impacto estimado de otimizações.

### Componente: `OpportunityCards`

#### Funcionamento

1. **Cálculo de Oportunidades**

   - O sistema calcula um **score de oportunidade** para cada anúncio baseado em:
     - CPR atual vs CPR potencial (se todas as métricas chegassem à média)
     - Impacto relativo (% de melhoria)
     - Impacto absoluto (economia/conversões adicionais estimadas)
   - Apenas anúncios que **passam pelos critérios de validação** são considerados
   - Os top 10 anúncios com maior score são exibidos

2. **Estrutura do Card**

   - **Header**: Nome do anúncio e investimento total (spend)
   - **CPR Atual → CPR Meta**: Comparação visual com cores indicativas
   - **Thumbnail com Play**: Botão para abrir vídeo do anúncio
   - **Tabela de Métricas**: Comparação atual vs média para:
     - Hook
     - Hold Rate
     - Link CTR
     - Connect Rate
     - Page Conv
   - **Badges de Medalha**: Anúncios no TOP 3 de cada métrica recebem medalhas (🥇 ouro, 🥈 prata, 🥉 bronze)
   - **Botão INSIGHTS**: Abre modal detalhado com análises específicas

3. **Agrupamento por Packs**

   - Opção de agrupar oportunidades por pack (toggle "Agrupar por Packs")
   - Quando ativado, mostra um slider de oportunidades para cada pack selecionado
   - Cada pack pode ter seu próprio **Action Type** (tipo de conversão) configurado

4. **Modal de Insights**
   - Ao clicar no botão "INSIGHTS" de um card, abre um modal com:
     - **Aba Insights**: Colunas Kanban mostrando métricas abaixo da média
     - **Aba Métricas**: Comparação detalhada com top 5 de cada métrica da seção Gems
     - Análise de impacto potencial de melhorias

### Filtros e Configurações

- **Período**: Filtro de data (início e fim)
- **Action Type**: Tipo de conversão para calcular CPR (ex: purchase, initiate_checkout)
- **Packs**: Seleção de quais packs incluir na análise
- **Usar Datas dos Packs**: Opção para usar automaticamente o período dos packs selecionados
- **Agrupar por Packs**: Toggle para visualizar oportunidades separadas por pack

---

## Seção 2: Gems

### Objetivo

Identificar os **melhores anúncios** (top performers) em cada métrica específica, servindo como referência e inspiração para otimizações.

### Componente: `GemsWidget`

#### Funcionamento

1. **Cálculo de Top Anúncios**

   - Para cada métrica, calcula o **top N** (padrão: 5) anúncios
   - Métricas analisadas:
     - **Hook**: Taxa de retenção inicial (primeiros 3 segundos)
     - **Link CTR**: Taxa de cliques no link
     - **Page Conv**: Taxa de conversão na página
     - **CTR**: Taxa de cliques geral
     - **Hold Rate**: Taxa de retenção geral
   - Apenas anúncios que **passam pelos critérios de validação** são considerados

2. **Estrutura de Colunas**

   - Cada métrica é exibida em uma **coluna Kanban** arrastável
   - Colunas podem ser reordenadas (drag & drop)
   - Colunas podem ser ocultadas/mostradas através do filtro de colunas
   - Cada coluna mostra:
     - **Título**: Nome da métrica
     - **Média**: Valor médio para comparação
     - **Cards**: Top anúncios ordenados por performance

3. **Cards de Gems**

   - Cada card mostra:
     - Thumbnail do anúncio
     - Nome do anúncio
     - Valor da métrica destacada
     - Comparação com a média (% de diferença)
     - Badge de rank (#1, #2, #3) se estiver no top 3 global
     - Todas as outras métricas em formato compacto

4. **Modo Compacto vs Expandido**
   - **Compacto** (padrão): Mostra apenas a métrica principal
   - **Expandido**: Mostra todas as métricas do anúncio

### Configurações

- **Modo Compacto**: Toggle para alternar entre visualização compacta e expandida
- **Filtro de Colunas**: Seleção de quais colunas exibir (Hook, Link CTR, CTR, Page, Hold Rate)
- **Limite**: Número de anúncios por coluna (padrão: 5)

---

## Seção 3: Insights Kanban

### Objetivo

Organizar anúncios por **tipo de problema/oportunidade**, facilitando a identificação de ações específicas a serem tomadas.

### Componente: `InsightsKanbanWidget`

#### Funcionamento

1. **Colunas de Insights**
   O widget possui 4 colunas fixas, cada uma identificando um tipo específico de oportunidade:

   **a) Landing Page**

   - **Critérios**: Website CTR > média, Connect Rate > média, Page Conv < média (pelo menos 20% abaixo)
   - **Problema**: Anúncio está gerando tráfego e conectando bem, mas a página não converte
   - **Ação Sugerida**: Otimizar landing page, melhorar copy, ajustar CTA
   - **Impacto**: Conversões adicionais estimadas ao melhorar Page Conv até a média

   **b) CPM**

   - **Critérios**: Website CTR > média, Connect Rate > média, Page Conv > média, CPM >= média \* 1.2 (20% acima)
   - **Problema**: Anúncio converte bem, mas está pagando muito caro por impressão
   - **Ação Sugerida**: Otimizar targeting, ajustar lances, melhorar relevância do anúncio
   - **Impacto**: Economia potencial estimada ao reduzir CPM até a média

   **c) Spend**

   - **Critérios**: Spend > 3% do total, CPR >= média \* 1.1 (10% acima da média)
   - **Problema**: Anúncio com alto investimento e CPR acima da média
   - **Ação Sugerida**: Reduzir investimento ou otimizar para melhorar CPR
   - **Impacto**: Economia potencial estimada ao reduzir CPR até a média

   **d) Hook**

   - **Critérios**: Hook < média, Website CTR > média, Connect Rate > média, Page Conv > média
   - **Problema**: Anúncio tem bom funil (CTR, Connect, Page), mas Hook baixo
   - **Ação Sugerida**: Melhorar primeiros 3 segundos do vídeo, ajustar thumbnail, testar novos hooks
   - **Impacto**: Conversões adicionais estimadas ao melhorar Hook até a média

2. **Cálculo de Impacto**

   - Cada coluna calcula o **impacto estimado** de resolver o problema
   - Impacto é usado para ordenar os anúncios (maior impacto primeiro)
   - Limite de 10 anúncios por coluna

3. **Estrutura de Colunas**
   - Colunas são **arrastáveis** para reordenar
   - Cada coluna tem cor temática diferente (laranja, roxo, verde, azul)
   - Cards mostram métricas relevantes e comparação com média

### Configurações

- **Reordenação**: Colunas podem ser arrastadas para reordenar
- **Limite**: Máximo de 10 anúncios por coluna

---

## Critérios de Validação

### Conceito

Os **critérios de validação** são regras configuráveis pelo usuário que determinam quais anúncios são considerados "válidos" para análise. Anúncios que não passam pelos critérios são **filtrados** de todas as seções.

### Como Funciona

1. **Configuração**

   - Critérios são configurados globalmente (não específicos da página Insights)
   - Exemplos de critérios:
     - Impressões >= 1000
     - Spend >= R$ 100
     - CPM <= R$ 50
     - Website CTR >= 1%

2. **Aplicação**

   - Critérios são aplicados com lógica **AND** (todos devem ser verdadeiros)
   - Se não houver critérios configurados, **todos os anúncios** são considerados válidos
   - Apenas anúncios válidos são usados para:
     - Calcular médias
     - Calcular oportunidades
     - Exibir em Gems
     - Exibir em Insights Kanban

3. **Médias Validadas**
   - As médias exibidas são calculadas **apenas com anúncios válidos**
   - Isso garante que comparações sejam justas e relevantes

---

## Cálculo de Oportunidades (Detalhado)

### Fórmula de Score

O score de oportunidade é calculado considerando:

1. **CPR Atual**

   ```
   CPR Atual = Spend / Conversões
   ```

2. **CPR Potencial**

   - Calcula o CPR se todas as métricas abaixo da média chegassem à média
   - Considera melhorias em:
     - Website CTR
     - Connect Rate
     - Page Conv
   - Fórmula: `CPR Potencial = CPR Atual / (melhoria_website_ctr * melhoria_connect_rate * melhoria_page_conv)`

3. **Impacto Relativo**

   ```
   Impacto Relativo = ((CPR Atual - CPR Potencial) / CPR Atual) * 100
   ```

4. **Impacto Absoluto**

   ```
   Impacto Absoluto (Economia) = (CPR Atual - CPR Potencial) * Conversões Atuais
   Impacto Absoluto (Conversões) = Conversões Adicionais Estimadas
   ```

5. **Score Final**
   - Combina impacto relativo e absoluto
   - Pesa pelo investimento (spend) do anúncio
   - Ordena por score decrescente

### Exemplo Prático

**Anúncio A:**

- Spend: R$ 10.000
- Conversões: 100
- CPR Atual: R$ 100
- Website CTR: 0.5% (média: 1%)
- Connect Rate: 50% (média: 60%)
- Page Conv: 2% (média: 3%)

**Cálculo:**

- Melhoria Website CTR: 1% / 0.5% = 2x
- Melhoria Connect Rate: 60% / 50% = 1.2x
- Melhoria Page Conv: 3% / 2% = 1.5x
- Melhoria Total: 2 _ 1.2 _ 1.5 = 3.6x
- CPR Potencial: R$ 100 / 3.6 = R$ 27.78
- Impacto Relativo: ((100 - 27.78) / 100) \* 100 = 72.22%
- Impacto Absoluto: (100 - 27.78) \* 100 = R$ 7.222 de economia potencial

---

## Rankings Globais

### Conceito

O sistema calcula **rankings globais** de métricas para identificar anúncios no TOP 3 de cada métrica. Esses rankings são usados para:

- **Medalhas**: Anúncios no TOP 3 recebem medalhas (🥇 #1, 🥈 #2, 🥉 #3)
- **Badges**: Cards mostram badges coloridos para métricas premiadas
- **Destaque Visual**: Anúncios top performers são destacados visualmente

### Métricas Rankeadas

- Hook Rank
- Hold Rate Rank
- Website CTR Rank
- Connect Rate Rank
- Page Conv Rank
- CTR Rank
- Spend Rank

### Cálculo

- Rankings são calculados apenas com anúncios que passam pelos critérios de validação
- Ordenação: Maior valor = melhor (exceto para CPM e CPR, onde menor é melhor)
- Empates: Anúncios com mesmo valor recebem o mesmo rank

---

## Filtros e Persistência

### Filtros Disponíveis

1. **Período (Date Range)**

   - Data de início e fim
   - Salvo no localStorage
   - Opção "Usar Datas dos Packs" para usar automaticamente o período dos packs selecionados

2. **Action Type**

   - Tipo de conversão para calcular CPR
   - Salvo no localStorage
   - Pode ser diferente por pack quando "Agrupar por Packs" está ativo

3. **Packs Selecionados**

   - Checkboxes para selecionar quais packs incluir
   - Preferências salvas no localStorage
   - Novos packs são automaticamente selecionados por padrão

4. **Agrupar por Packs**

   - Toggle para visualizar oportunidades separadas por pack
   - Salvo no localStorage

5. **Modo Compacto (Gems)**

   - Toggle para alternar visualização compacta/expandida
   - Salvo no localStorage

6. **Colunas Ativas (Gems)**
   - Seleção de quais colunas exibir
   - Salvo no localStorage

### Persistência

- Todas as preferências são salvas no **localStorage** do navegador
- Preferências são restauradas automaticamente ao recarregar a página
- Chaves de storage:
  - `hookify-insights-selected-packs`
  - `hookify-insights-action-type`
  - `hookify-insights-group-by-packs`
  - `hookify-insights-date-range`
  - `hookify-insights-use-pack-dates`
  - `hookify-insights-pack-action-types`
  - `hookify-insights-gems-compact`
  - `hookify-insights-gems-columns`

---

## Fluxo de Dados

```
1. Usuário acessa página Insights
   ↓
2. Sistema busca dados de Ad Performance do backend
   (endpoint: /analytics/ad-performance)
   ↓
3. Dados são filtrados por:
   - Packs selecionados
   - Período configurado
   ↓
4. Critérios de validação são aplicados
   ↓
5. Médias são calculadas (apenas com anúncios válidos)
   ↓
6. Três seções são populadas:
   a) Oportunidades: Calcula scores e top 10
   b) Gems: Calcula top 5 por métrica
   c) Insights Kanban: Filtra e organiza por tipo de problema
   ↓
7. Rankings globais são calculados (para medalhas)
   ↓
8. Interface é renderizada com todos os dados
```

---

## Interações do Usuário

### Cards de Oportunidade

- **Clique no card**: Abre modal com detalhes completos do anúncio
- **Clique no botão Play**: Abre modal na aba de vídeo
- **Clique em "INSIGHTS"**: Abre modal de insights específicos do anúncio

### Cards de Gems

- **Clique no card**: Abre modal com detalhes completos do anúncio
- **Clique no botão Play**: Abre modal na aba de vídeo
- **Arrastar colunas**: Reordena colunas (drag & drop)

### Cards de Insights Kanban

- **Clique no card**: Abre modal com detalhes completos do anúncio
- **Clique no botão Play**: Abre modal na aba de vídeo
- **Arrastar colunas**: Reordena colunas (drag & drop)

### Modal de Detalhes

- **Aba Overview**: Métricas gerais e histórico
- **Aba Video**: Player de vídeo e métricas de vídeo
- **Aba Trends**: Gráficos de evolução temporal
- **Aba Conversions**: Detalhes de conversões por tipo

---

## Observações Importantes

1. **Performance**:

   - Cálculos são feitos no frontend para responsividade
   - Cache de dados é usado quando disponível
   - Rankings são calculados apenas uma vez e reutilizados

2. **Validação**:

   - Sempre verifique se há critérios de validação configurados
   - Anúncios sem dados suficientes podem não aparecer

3. **Médias**:

   - Médias são calculadas apenas com anúncios válidos
   - Isso garante comparações justas e relevantes

4. **Action Type**:

   - O Action Type selecionado afeta o cálculo de CPR e Page Conv
   - Certifique-se de selecionar o tipo de conversão correto

5. **Agrupamento por Packs**:

   - Quando ativado, cada pack pode ter seu próprio Action Type
   - Útil quando diferentes packs têm diferentes objetivos de conversão

6. **Limites**:
   - Oportunidades: Top 10
   - Gems: Top 5 por métrica (configurável)
   - Insights Kanban: Top 10 por coluna

---

## Exemplos de Uso

### Cenário 1: Identificar Anúncios com Maior Potencial

1. Configure critérios de validação (ex: Spend >= R$ 500)
2. Selecione packs relevantes
3. Configure Action Type (ex: purchase)
4. Visualize seção "Oportunidades"
5. Anúncios são ordenados por impacto potencial

### Cenário 2: Encontrar Referências (Best Practices)

1. Configure critérios de validação
2. Visualize seção "Gems"
3. Cada coluna mostra os melhores anúncios em uma métrica específica
4. Use como inspiração para otimizações

### Cenário 3: Resolver Problemas Específicos

1. Configure critérios de validação
2. Visualize seção "Insights Kanban"
3. Cada coluna identifica um tipo específico de problema
4. Foque em resolver problemas da coluna com maior impacto

### Cenário 4: Análise por Pack

1. Ative "Agrupar por Packs"
2. Configure Action Type específico para cada pack
3. Visualize oportunidades separadas por pack
4. Compare performance entre packs















