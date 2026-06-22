# Plano de Ação (To-Do List Acionável) — Design v0

**Status:** Design validado (saída do brainstorming) — pré-implementação
**Data:** 2026-06-14
**Modo:** Manage (read-only). Recycle/Create são modos futuros.
**Princípio central:** **reuso/redesign sobre fonte única de verdade**, não reconstrução. O Plano de Ação é uma *camada de apresentação + um veredito* em cima de dois motores que já existem (G.O.L.D. e Oportunidades).

---

## 1. Understanding Summary

- **O quê:** nova página **"Plano de Ação"** que transforma os ads já carregados num **to-do list priorizado e agrupado** com 4 vereditos — **Scale / Fix / Pause / Observe**.
- **Por quê:** mover o Hookify de "dashboards que reportam o passado" para "diz o que fazer agora". É o v0 do norte do produto ([[product_north_star_action_engine]]), feito para **validar valor rápido e com risco baixo**.
- **Para quem:** ICP pré-lançamento; beachhead = gestores/agências que já carregaram packs e (idealmente) configuraram validation_criteria.
- **Como classifica:** reusa `splitAdsIntoGoldBuckets`, parametrizado por um **eixo de custo** que alterna **CPR ↔ CPMQL** (CPMQL default quando há leadscore — o que automaticamente bloqueia o "escalar lead-lixo"). `validation_criteria` é o gate de maturidade; quem não passa → Observe.
- **Como prescreve:** cada linha = thumbnail + veredito + o **"porquê" + o número**, ordenada por **impacto em R$** (do `opportunity.ts`); Oportunidades caem em Scale mas marcadas distintas dos Golds com uma nota "corrija esta alavanca"; clique → `AdDetailsDialog` existente.
- **Restrição-chave:** **somente leitura** — recomendações apenas, sem escrever na Meta no v0 (execução 1-clique é fase posterior).

---

## 2. Decision Log

| # | Decisão | Alternativas | Por quê |
|---|---|---|---|
| **D1** | Nível = **Ad/creative** (group_by `ad_name`) | adset, ad+adset, hierarquia completa | mais rápido; reusa motor por-ad; "scale" é conselho, não ação de budget (ok p/ read-only) |
| **D2** | Vereditos **Scale/Fix/Observe/Pause**, alinhados ao G.O.L.D. | 3 estados, binário, lista plana | mapeia no framework existente; "Fix" é a ponte p/ Recycle/Create |
| **D3** | Mapeamento bucket→veredito; **Oportunidades→Scale** com anotação "corrija X", distinta de Golds | Oportunidades como 5º veredito / como Fix | colapsa limpo no eixo de custo; preserva nuance "escale + alavanca" |
| **D4** | Eixo de custo **CPR↔CPMQL** togglável; **CPMQL default** quando há leadscore | CPR-only; CPMQL guardrail; display-only | qualidade > quantidade; CPMQL alto = lead-lixo nunca vira Gold (guardrail embutido) |
| **D5** | Gate de maturidade = **validation_criteria apenas** (sem piso de volume separado) | +piso de volume; thresholds fixos; tempo | reusa máquina existente; simplicidade. Risco em R1 |
| **D6** | UI = **lista agrupada por veredito, ordenada por impacto R$** dentro de cada grupo | stack plano; reusar Kanban; dois modos | mantém modelo mental G.O.L.D. E lê como to-do real |
| **D7** | **Página dedicada nova** no nav ("Plano de Ação"); herda `useFilters` | aba no G.O.L.D.; home pós-load; aba no Manager | focado, reversível, fácil de validar; promover a home depois |
| **D8** | **Reuso/redesign sobre fonte única**, não reconstruir regras | reescrever lógica nova | evita drift; lógica já testada em produção |
| **D9** | Conjuntos de métricas **mantidos distintos por propósito** | unificar em 4; usar só o set do funil | hook = alavanca *criativa* (→ Recycle/Create); rates = alavancas de *otimização* |

### Assumptions (aceitas salvo objeção)
- **A1 — Compute:** client-side. Reusa `api.analytics.getAdPerformance` (a mesma chamada do G.O.L.D.), classifica + pontua no browser. Sem backend novo.
- **A2 — Safety:** read-only; zero mutações na Meta.
- **A3 — Escopo:** packs + período correntes (`useFilters`), group_by `ad_name`, limit 1000.
- **A4 — CPR oficial:** `spend/results` para veredito/eixo; o CPR do funil (`cpm/(1000·funnel)`) só para o cálculo de potencial/economia.
- **A5 — Ordenação do Scale:** por `spend` desc (maiores vencedores comprovados primeiro), pois Oportunidades não pontua ads sem gargalo.
- **A6 — CPMQL parametrização:** ao trocar o eixo, troca-se só a métrica de **custo**; a contagem "métricas acima da média" segue em {hook, website_ctr, page_conv}.
- **A7 — Tier:** Insider no v0 (consistente com G.O.L.D.); packaging revisto depois.
- **A8 — UI:** pt-BR, design-system, `sonner` p/ toasts.

---

## 3. Mapa exato dos motores reaproveitados

### G.O.L.D. (`/gold`)
- **Dados:** `getAdPerformance` (group_by `ad_name`, limit 1000, packs+período).
- **Gate:** `evaluateValidationCriteria(criteria, metrics, "AND")` → validados.
- **Médias:** `computeValidatedAveragesFromAdPerformance(validados)` (ponderadas, sobre o set validado).
- **Eixo:** **CPR = spend/results** (`computeAdDerivedMetrics`; Infinity se results=0).
- **Métricas julgadas:** **hook, website_ctr, page_conv** (3) vs média.
- **Classificador:** `classifyGoldBucket` → Golds / Oportunidades / Lições / Descartes / Neutros.
- **UI:** `GoldKanbanWidget` (5 colunas). Sem lead-quality.

### Oportunidades (`/insights` → `OpportunityWidget`)
- **Dados/Gate/Médias:** idênticos ao G.O.L.D.
- **Modelo:** funil **website_ctr × connect_rate × page_conv**; CPR = `cpm/(1000×funil)`.
- **CPR potencial:** eleva cada etapa abaixo da média até a média → `cpr_potential`.
- **"Se corrigir só X":** `cpr_if_website_ctr_only` / `_connect_rate_only` / `_page_conv_only`.
- **Gargalo:** `below_avg_flags` {website_ctr, connect_rate, page_conv}.
- **Impacto:** `improvement_pct`; **`impact_relative = improvement_pct × (spend/totalSpend)`**; `impact_abs_savings` (R$).
- **Lead-quality:** `leadscore_avg`, `mql_count`, `cpmql` já calculados (hoje só exibidos).
- **Filtro:** só ads com ≥1 gargalo → **exclui os Golds**.
- **Ordenação:** `impact_relative` desc. **UI:** cards horizontais "CPR Atual → CPR Meta".

### As 3 costuras reconciliadas
1. **Dois CPRs** → oficial = `spend/results` (A4); funil só p/ potencial.
2. **Sets diferentes** (hook vs connect_rate) → **mantidos distintos** (D9): veredito em {hook, website_ctr, page_conv}; alavanca-de-correção em {website_ctr, connect_rate, page_conv}; **hook abaixo da média = sinal criativo** → futuro Recycle/Create.
3. **Oportunidades exclui Golds** → Scale ordenado por spend (A5).

---

## 4. Final Design

### 4.1 Data flow
```
useFilters (packs + período + actionType)
  → api.analytics.getAdPerformance({ group_by:"ad_name", limit:1000, pack_ids, date_start, date_stop })
  → [reuse] isRankingInSelectedPacks  (filtra aos packs)
  → [reuse] evaluateValidationCriteria → validated[] + notValidated[]
  → [reuse+param] computeValidatedAveragesFromAdPerformance(validated, costAxis)  // + avg CPMQL quando aplicável
  → [new]  costAxis = (leadscore presente ? "cpmql" : "cpr")  // togglável no header
  → [reuse+param] splitAdsIntoGoldBuckets(validated, averages, actionType, costAxis) → 5 buckets
  → [reuse] computeOpportunityScores(validated, averages, actionType, mqlLeadscoreMin) → impacto/below_avg/cpr_potential (por ad)
  → [new]  buildActionPlan(buckets, opportunityRows, notValidated) → ActionItem[] agrupado por veredito
  → [new UI] PlanoDeAcaoPage → lista agrupada (Scale/Fix/Pause/Observe), linha → AdDetailsDialog
```

### 4.2 Mapeamento bucket → veredito
> ⚠️ Esta tabela é o **fallback relativo** (quando `target_cpr` está vazio). Com `target_cpr` definido, o eixo primário é o **alvo absoluto** — ver **§8.6** (modelo definitivo).

| Bucket G.O.L.D. | Veredito | Anotação na linha | Ordenação |
|---|---|---|---|
| Golds | **Scale** | "seus melhores — escale" | spend desc |
| Oportunidades | **Scale** | "escale + corrija: {fixLever}" (de `below_avg_flags`) | spend desc |
| Lições | **Fix** | "recicle o que funciona; corrija {fixLever} → economiza R${impact_abs_savings}" | impact_abs_savings desc |
| Descartes | **Pause** | "todas as métricas fracas — pause (gasto R${spend} desperdiçado)" | spend desc |
| Neutros + não-validados | **Observe** | "aguardando dados / análise" | spend desc |

### 4.3 Contrato `ActionItem`
```ts
type Verdict = "scale" | "fix" | "pause" | "observe";
type ActionItem = {
  ad: RankingsItem;
  verdict: Verdict;
  sourceBucket: GoldBucket | "not_validated";
  costAxis: "cpr" | "cpmql";
  costActual: number;            // CPR ou CPMQL
  costAvg: number;
  fixLever?: "website_ctr" | "connect_rate" | "page_conv";  // pior below_avg_flag
  costPotential?: number;        // cpr_potential (só fix/oportunidades)
  impactSavings?: number;        // impact_abs_savings em R$
  reason: string;                // copy pt-BR do "porquê"
  priority: number;              // chave de ordenação dentro do veredito
};
```

### 4.4 Eixo CPR↔CPMQL (a única lógica genuinamente nova)
- Por ad: `costActual = costAxis==="cpmql" ? cpmql : cpr`, onde `cpmql = spend/mql_count` (de `computeMqlMetricsFromLeadscore`).
- Média: `avgCPMQL = Σspend / Σmql_count` sobre o set validado (estender `computeValidatedAveragesFromAdPerformance`).
- `classifyGoldBucket`/`computeAdDerivedMetrics` recebem `costAxis` e comparam `costActual` vs `costAvg` (mesma lógica below/above).
- **Disponibilidade:** CPMQL habilitado quando o set validado tem `Σmql_count > 0`. Default CPMQL quando disponível, senão CPR (toggle escondido). Mostrar "baseado em N MQLs".

### 4.5 Componentes: reuso vs novo
- **Reuso sem mudança:** `getAdPerformance`, `useFilters`, `evaluateValidationCriteria`, `computeOpportunityScores`, `computeMqlMetricsFromLeadscore`, `AdDetailsDialog`, `AdPlayArea`, `StandardCard`, `AdStatusIcon`, utils de currency.
- **Estender (param pequeno):** `splitAdsIntoGoldBuckets` + `classifyGoldBucket` + `computeAdDerivedMetrics` (add `costAxis`); `computeValidatedAveragesFromAdPerformance` (add avg CPMQL).
- **Novo (fino):** `lib/utils/actionPlan.ts` (mapeamento + ordenação + join → `ActionItem[]`); `app/plano/page.tsx` (espelha o fetch do `gold/page.tsx`); `components/plano/ActionPlanList.tsx` + `ActionPlanRow.tsx`; entrada de nav + gate de tier da rota.

### 4.6 UI da página
- Header: seletor de packs/período (`useFilters`), toggle **CPR | CPMQL** (quando disponível), `actionType`.
- Corpo: seções por veredito com contagem — **⏸ Pause · N**, **📈 Scale · N**, **🔧 Fix · N**, **👀 Observe · N**.
- Cada seção: linhas ordenadas por prioridade. Linha = thumbnail (`AdPlayArea`) + ad_name + chip de veredito + custo atual vs média (cor por `getValueColor`) + o "porquê"+número. Clique → `AdDetailsDialog`.
- **Observe** colapsado por default (pode ser grande).
- Empty state: se `validation_criteria` vazio → CTA "configure seus critérios" (o gate depende disso).

---

## 5. Riscos reconhecidos
- **R1 — Gate só por validation_criteria:** veredito sobre dados ralos se o usuário não incluir condição de volume. *Mitigação:* guidance ("adicione `impressions >` / `spend >`") + empty state; sem lógica nova.
- **R2 — CPMQL depende de sync de leadscore:** lag → ads parecem ruins. *Mitigação:* só habilita CPMQL com `mql_count>0`; exibir "baseado em N MQLs".
- **R3 — Médias relativas ao pack:** num pack todo-perdedor, "Scale" = o menos-pior. *RESOLVIDO no v0* pelo eixo absoluto `target_cpr` (ver §8.1) — **não** usar `cpr_max` legado.
- **R4 — Divergência de CPR** (spend/results vs funil) pode confundir. *Mitigação:* exibir `spend/results` como CPR; rotular o do funil como "meta".
- **R5 — Confiança:** um veredito errado destrói a confiança (risco make-or-break). *Mitigação:* read-only; sempre mostrar o "porquê"+números; Observe segura o incerto.

## 6. Não-objetivos (v0) / fases futuras
- Ações de escrita (pausar/escalar 1-clique) → **fase 2**.
- Modos **Recycle/Create** → futuro (hook-abaixo-da-média já roteia p/ cá).
- Níveis adset/campaign.
- Endpoint/cache backend (só se a performance client-side exigir).

## 7. Open questions menores (defaults propostos)
- Copy pt-BR exata por veredito (definir na implementação).
- Observe colapsado por default → **sim**.
- Empty state quando `validation_criteria` vazio → **sim**.
- Tier final → **Insider** (A7).

---

## 8. Refinamentos pós-revisão (cientista de dados — 2026-06-16)

A revisão estatística apontou que vereditos de **ação** (Pausar/Escalar) sobre base **100% relativa** (vs média do pack) são perigosos. Ajustes a seguir **entram no v0** (eixo CPR). Atualizam 4.3 (o `ActionItem` ganha `costTarget?: number` e `lowData?: boolean`).

### 8.1 Eixo absoluto — nova `user_preference` (resolve o R3; substitui o `cpr_max` legado)
- **`target_cpr`**: mapa **por actionType** (`{ [actionType]: number }`); a UI seta para o tipo selecionado. Espelha `mql_leadscore_min` em `user_preferences`. (`target_cpmql` = número único → fase 2.)
- É o eixo **ABSOLUTO**; G.O.L.D. segue o **RELATIVO**. Combinam como **override fino sobre o balde** (4.2):
  - bucket → veredito tentativo;
  - se `custo > target_cpr[actionType]` → rebaixa **Scale → Fix** (relativamente bom, mas no prejuízo: não escalar perdedor);
  - se `custo ≤ target_cpr[actionType]` → promove **Pause → Manter/Fix** (relativamente ruim, mas lucrativo: não pausar vencedor);
  - `target_cpr` vazio → **fallback relativo-only** (degradação graciosa).
- **Não** usar `cpr_max` legado (a ser removido).

### 8.2 Gate = `validation_criteria` (confirma D5) + badge de confiança
- Gate do **Observar** continua sendo o `validation_criteria` do usuário (autonomia — não proibir).
- **Badge "poucos dados"** por anúncio quando `impressions < 3000` (default sugerido) — informa sem bloquear. *Impressões = volume de dados real (exposição); resultados são consequência* (analogia: A/B test mede por visitas). Para métricas de taxa, impressões é literalmente o `n`.
- Opcional: alerta agregado data-driven ("X% dos anúncios têm < 3000 impressões — vereditos podem ser imprecisos").

### 8.3 Descartado do v0 (e por quê)
- **Zona morta / banda fixa:** só move o penhasco, não remove (crítica correta do founder). Seguro descartar porque o `target_cpr` absoluto agora carrega a decisão de dinheiro; o penhasco *relativo* só afeta nuance/alavanca.
- **Banda por significância (z-test de proporção, n-aware):** uniria 8.2/8.3 corretamente, mas adiciona complexidade e parece arbitrária ao usuário. Registrada como "talvez um dia", **não planejada**.
- **Footnote de contagem de resultados:** o ruído do CPR (poucos resultados) só importa colado no alvo → descartável.

### 8.4 Backlog fase 2 (registrado)
- `target_cpmql` + eixo CPR↔CPMQL (4.4) + **validação de cobertura de leadscore na conexão da planilha** (cobertura por **resultado** ≥ 90%; ad sem resultado não conta; rechecar integrações antigas).
- **Funil de custo multi-alvo:** usar todos os alvos do usuário (ex.: cpc R$0,50 / IC R$5 / purchase R$15) como cascata absoluta que **localiza onde o custo quebra** — gêmeo absoluto do `opportunity.ts`; veredito num evento primário, demais como diagnóstico.
- Banda por significância (8.3).

### 8.5 Loop de medição — RESOLVIDO
- v0 indica o **QUÊ** (veredito), não o **COMO** (quanto escalar, saturação) — fora de escopo.
- **Nada de telemetria no v0.** Única exigência: `buildActionPlan` **puro/determinístico** (já no design) — mantém a porta aberta de graça.
- **Tier 0 (historizar `target_cpr`) DESCARTADO:** reconstruir o veredito exigiria (a) historizar *todas* as entradas (target_cpr + validation_criteria + mql_leadscore_min), (b) re-rodar o `buildActionPlan` sobre dados históricos, e (c) confiar num `ad_metrics` que é **upsertado/enriquecido depois** (leadscore entra dias depois). Resultado: reconstrução dá "o que diríamos hoje sobre o passado", **não** "o que o usuário viu" → inútil para medir **adesão**.
- **Medição de adesão = Tier 1, só ao lançar:** tabela `action_plan_log` (1 insert/dia/ad com a saída exibida). Fiel ao que o usuário viu, sem re-rodar pipeline. Prematuro pré-lançamento (sem usuários).

### 8.6 Modelo de veredito hierárquico (DEFINITIVO — supersede a 4.2 e o "override" da 8.1)

Cascata. **Alvo absoluto = eixo primário** (decide Escalar vs Pausar); métricas vs média só **refinam**. Sem caso de borda:

```
1. Reprovou no validation_criteria → OBSERVAR
2. Passou. custo (CPR spend/results) vs target_cpr[actionType]:
   custo ≤ alvo → ESCALAR
       métricas todas acima da média → GEM       (lateralizar/duplicar — seu melhor)
       senão                          → OTIMIZAR  (escalar + corrigir as métricas fracas)
   custo > alvo → PAUSAR
       métricas todas abaixo da média → DESCARTAR (pausar)
       senão (≥1 acima)               → LIÇÃO     (pausar, mas aprender/reciclar a métrica forte)
```

- **Vocabulário = G.O.L.D. reancorado:** Gem / Otimizar / Lição / Descartar + Observar. Duas ações primárias: **Escalar** (Gem+Otimizar) e **Pausar** (Lição+Descartar).
- **"Fix" deixa de ser veredito de topo:** vira **Otimizar** (lucrativo, melhora in-place) ou **Lição** (no prejuízo, extrai o que presta → bridge Recycle/Create). Mapeamento aproximado ao vocabulário antigo: Escalar≈Scale, Pausar≈Pause.
- **Métricas vs média** = mesma contagem do `classifyGoldBucket` (hook, website_ctr, page_conv). Anotação ("qual métrica corrigir") + ordenação por impacto R$ vêm do `computeOpportunityScores`.
- **Sem `target_cpr` (fallback):** eixo primário volta a CPR vs média → reusa `splitAdsIntoGoldBuckets` verbatim e mapeia golds→Gem, oportunidades→Otimizar, licoes→Lição, descartes→Descartar, neutros→Observar (tabela 4.2).
- **Implementação:** `classifyActionVerdict(custo, alvo, metricsAboveCount)` — função nova e pequena, espelha a estrutura do `classifyGoldBucket` trocando só o eixo primário. Atualiza 4.3 (`ActionItem.verdict` = `"gem"|"otimizar"|"licao"|"descartar"|"observar"`) e 4.6 (seções da UI: Escalar [Gem/Otimizar] · Pausar [Lição/Descartar] · Observar).
- **`target_cpr` configurado no onboarding/preferências** (espelhando `mql_leadscore_min`, com um valor por actionType). ✅ decidido.
