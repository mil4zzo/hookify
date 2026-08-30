# Plano: um motor de filtros para Manager, Boards e Critério de validação

Data: 2026-08-28. Estado: **fases 0, 1 e 2 implementadas** (268 testes verdes, `tsc` e
design-system limpos, nada commitado ainda). Fases 3–6 pendentes.

Achados durante a execução, que valem mais que o texto original das fases:

- A fase 0 sabotou 4 vezes o congelamento e **duas sabotagens escaparam**. A primeira revelou
  que 4 dos 9 avaliadores congelados não tinham prova nenhuma (são privados dentro de `.tsx`
  e não dá para importá-los num teste de node); nasceu daí o `referenceIsVerbatim.test.ts`,
  que compara o TEXTO-FONTE dos dois lados. A segunda revelou um bug no próprio teste
  (`extractBody` procurava `{` e `new Set([...])` usa colchete: os dois lados extraíam outra
  declaração e coincidiam). Sem sabotar, as duas teriam passado por rede de segurança.
- A alavanca da regra "sem dado" **não é `media_type`**, como o plano dizia: é o divisor zero.
  Cobre CPR (que `media_type` não alcança) e não depende de um classificador com estado
  `"unknown"`. `media_type` acabou não sendo usado.
- `Board` e `BoardGroup` **não** foram para `lib/rules`: são domínio do Board (um board tem
  grupos), não do motor. Só a árvore de regra mudou de casa.
- As pontes de compatibilidade de `lib/boards/{evaluate,fields}` foram criadas e **apagadas no
  mesmo passe** — os consumidores eram 6 arquivos, não valia deixar código morto até a fase 6.
- `AdsetDetailsDialog` tinha um `?? 0` que engolia o estado novo: CTR de anúncio sem
  impressões apareceria como `0,00%`. Corrigido para "—".
- O campo default de uma condição nova (`tags`) não existe em `manager-children`; o
  `RuleBuilder` passou a derivar o default da lista disponível no contexto.

Decisões do usuário (2026-08-28), fechadas nesta ordem:

1. **Escala de porcentagem = a que o usuário digita.** `2` é 2%, `0,5` é 0,5%. Sem camada de
   compatibilidade: o app é usado pelo idealizador e, esporadicamente, pela equipe; critérios
   antigos são redigitados uma vez (ou apagados).
2. **"Não se aplica" ⇔ divisor zero.** Métrica que é divisão (hook, CTR, CPR, page conv…) fica
   *sem dado* quando o divisor é zero; métrica que é contagem (gasto, plays, resultados…) nunca
   fica sem dado — zero é zero de verdade. Linha sem dado **não casa com a condição nem com a
   contrária**; quem quer essas linhas pede "está vazio".
3. **Campanha e conjunto viram listas na linha** (`campaign_ids`, `adset_ids`, como `pack_ids` e
   `account_ids` já são), com um dicionário `id → nome` na raiz da resposta. O motor de regra
   roda **100% na tela**; nada de filtro por nome no servidor.

---

## 1. Por que — o diagnóstico em três linhas

- Três motores para a mesma pergunta, nascidos em três meses diferentes (Critério 2025-11,
  Manager 2025-12, Boards 2026-08), nenhum olhando para o anterior. O comentário do Boards que
  parecia decisão ("não reusa `adMetricsFields`") é gestão de risco: *"mexer nele reclassificaria
  quem já salvou critérios"*.
- Cada um erra num lugar diferente: o Manager combina tudo em **E** (não existe "X ou Y"); o
  Critério oferece 22 campos dos quais **11 rejeitam todo anúncio sempre** (os mappers nunca os
  constroem e campo ausente devolve `false`) e não oferece `hook`; o filtro de campanha do Manager
  compara com o **representante** do grupo (a campanha do ad com mais impressões) e mente para
  criativos que rodam em mais de uma; quatro convenções de porcentagem para a mesma coluna.
- Zero é confundido com "não se aplica": anúncio de imagem tem `hook = 0` e aparece em
  "hook < 5%"; anúncio sem conversão tem `cpr = 0` e lidera "CPR mais barato".

## 2. O que muda para quem usa (a camada prática)

| Onde | Hoje | Depois |
|---|---|---|
| Filtros do Manager | Lista plana, sempre E | Mesmo construtor do Boards: **E/OU**, subgrupos, "contém regex", "está vazio" |
| Nome de campanha/conjunto no Manager | Compara com 1 campanha (a do representante) | "**Alguma** campanha do criativo contém X" |
| Anúncio de imagem em "hook < 5%" | Aparece (hook = 0) | Não aparece; nem em "hook ≥ 5%". Aparece em "hook está vazio" |
| Anúncio sem conversão ordenado por CPR ↑ | Primeiro (CPR = 0) | Último (sem dado), célula mostra "—" |
| Campo de porcentagem | Sem unidade; escala varia por tela | Sufixo `%` e leitura ao lado ("2 → 2%"); `0,5` funciona |
| Critério de validação | Rótulos em inglês, 11 campos mortos, sem hook | Mesmo vocabulário do Manager/Boards; critérios antigos são redigitados |
| Filtros salvos na sessão do navegador | — | Perdidos uma vez no deploy (vivem em `sessionStorage`) |

### Como a célula vazia aparece (decidido em 2026-08-28, já implementado)

São **duas ausências**, e a tela usa símbolos diferentes para cada uma:

| Situação | Símbolo | Sparkline |
|---|---|---|
| Métrica de vídeo num anúncio de **imagem** (`media_type === "image"`) | ícone de imagem, 20 px, centralizado | **não desenha** |
| Métrica sem denominador (CPR sem conversão, CPMQL sem MQL, CTR sem impressão) | travessão `—` | mantém, como hoje |

Por que o ícone e não um símbolo mais discreto: **nada mais na linha revela o formato**.
`AdNameCell` mostra miniatura, nome e `5 / 124 anúncios` com ponto de status; o microfone do
canto da miniatura significa "tem transcrição", não "é vídeo". A célula vazia é o único lugar
onde o usuário consegue aprender o motivo. (A alternativa — um marcador de formato na coluna
Anúncio — foi levantada e **não** entrou: é escopo novo, fica como sugestão.)

Quem decide é `getManagerMetricEmptyKind` (`lib/metrics/managerPresentation.ts`), sobre a flag
`requiresVideo` do registry de métricas. A regra é conservadora: só vira "formato" quem tem
`media_type === "image"`. **Vídeo sem entrega no período** e **formato desconhecido** caem no
travessão — afirmar "é imagem" sem saber seria inventar. Linhas-filhas não recebem `media_type`
da RPC (`RankingsChildrenItemSchema`), então ficam sempre com travessão: o fallback honesto.

`plays` e `thruplays` seguem mostrando `0` num estático — são contagem, e zero reprodução num
anúncio de imagem é fato, não ausência.

## 3. Arquitetura-alvo

```
lib/rules/                      ← motor único (puro, sem React)
  types.ts      RuleTree { logic: AND|OR, conditions: (Leaf|Group)[] }   (= BoardRules de hoje)
  fields.ts     registry: id, label, kind, group, isRatioPercent, availableIn[], requires*
  operators.ts  por kind: metric | text | tags | status | date | multiselect
  evaluate.ts   rowMatchesRules(row, tree, ctx) / filterRowsByRules(...)
components/rules/RuleBuilder.tsx ← UI única (= BoardRuleBuilder de hoje, com "contexto")
```

Os três consumidores passam a ser **contextos** do mesmo motor, e o que difere entre eles é só
disponibilidade de campo, declarada no registry (`availableIn: ["manager","boards","criteria"]`,
mais `availableTabs` para as abas do Manager e `requiresSheetIntegration`/`requiresActionType`
que já existem):

| Campo | Manager | Boards | Critério | Obs |
|---|---|---|---|---|
| Métricas (26 de `MANAGER_METRIC_KEYS`) | ✓ | ✓ | ✓ | MQL só com planilha; CPR/page conv/results só com evento |
| `ad_name` | ✓ | ✓ | ✓ | texto |
| `tags` | ✓ (não em filhos) | ✓ | ✓ | linhas-filhas não carregam tags |
| `status` | ✓ | ✓ | ✓ | `is_active` / `is_paused` (substitui `active_count_filter`) |
| `meta_created_time` | ✓ | ✓ | ✓ | data |
| `pack_ids` / `account_ids` | ✓ | ✓ | ✓ | "é alguma de" |
| `campaign_ids` / `adset_ids` | ✓ | ✓ | ✓ | "é alguma de" — **depende da fase 5** |
| `campaign_name` / `adset_name` | ✓ | ✓ | ✓ | texto resolvido pelo dicionário de nomes — **fase 5** |
| `ad_id` | só aba individual | — | ✓ | igualdade |

Regras do avaliador (as três decisões, em código):

- **Escala.** Valor gravado é o digitado. `formatKind: "ratioPercent"` → divide por 100 na
  comparação; `"rawPercent"` (p50/p75) → não divide. **Regra nova do projeto: o `formatKind` de
  uma métrica é imutável depois de publicado** — valores gravados dependem dele.
- **Sem dado.** `getMetricNumericValueOrNull` é a única porta de leitura de métrica. `null` →
  comparadores devolvem `false`; `is_empty` devolve `true`; `is_not_empty` devolve `false`.
  Hoje `OrNull` já devolve `null` para cpr/cpc/cplc/cpmql/page_conv/connect_rate/website_ctr/cpm/
  frequency; **falta** hook, hold_rate, scroll_stop, p50, p75 (`null` quando `plays = 0`) e ctr
  (`null` quando `impressions = 0`).
- **Condição malformada** (campo fora do registry, valor em branco, regex inválida) → ignorada,
  como filtro vazio. É o comportamento do Boards; fica.
- **Multi-valor** (pack, conta, campanha, conjunto): semântica "alguma", sempre. Texto sobre
  campanha/conjunto resolve os ids pelo dicionário `ctx.names` e casa se **algum** nome casa.
- **Regex:** `matches_regex` compila com `try/catch`, flag `i`, tamanho máximo 200 chars;
  inválida = condição ignorada. Sem guarda contra backtracking catastrófico (app de uso interno;
  registrar se abrir para terceiros).

## 4. Fases

Cada fase fecha com: testes passando, **um teste sabotado de propósito** (provar que ele falha),
`tsc --noEmit`, e a tela conferida à mão. Ordem pensada para o risco crescer devagar: motor puro
→ consumidor que já tem o mesmo shape → o maior consumidor → o que toca dado persistido → banco.
A fase 5 (RPC) é independente e pode ser feita a qualquer momento depois da 1.

### Fase 0 — Rede de segurança (P) — ✅ FEITA

Hoje os 19 arquivos de teste do frontend rodam só à mão (`npx tsx --test …`); nem o pre-commit
nem o CI os executam.

- `package.json`: script `test` = `tsx --test "**/__tests__/*.test.ts"`; `pre-push` passa a
  rodá-lo junto com o `pytest`.
- Congelar o comportamento **atual** como referência para os testes diferenciais das fases 1 e 3:
  copiar `matchesTextFilter` (managerTableColumns), `applyNumericFilter` (applyRowFilters),
  `compareText`/`compareNumeric` (boards/evaluate) e `evaluateCondition` (validateAdCriteria) para
  `lib/rules/__tests__/reference/` como funções mortas, só para comparação.

### Fase 1 — Motor único `lib/rules/` (M) — ✅ FEITA

1. Mover `lib/boards/{types,fields,evaluate}.ts` → `lib/rules/`, renomeando `Board*` → `Rule*`.
   `lib/boards/*` vira re-export por um commit; some na fase 6.
2. `fields.ts`: adicionar `availableIn`, `availableTabs`; campos novos `ad_id`, `campaign_ids`,
   `adset_ids`, `campaign_name`, `adset_name` (os quatro últimos já declarados, só ativos após a
   fase 5). Operadores: `matches_regex` em texto; `is_empty`/`is_not_empty` em métrica.
3. `evaluate.ts`: as regras da §3. Contexto ganha `names?: { campaigns, adsets }`.
4. `lib/metrics/calculations.ts`: `OrNull` devolve `null` para hook/hold_rate/scroll_stop/p50/p75
   quando `plays = 0` e para ctr quando `impressions = 0`. Conferir os 5 consumidores diretos
   (`managerTableMetricColumns`, `BoardCreativeCard`, `AdDetailsDialog`, `AdsetDetailsDialog`,
   `boards/evaluate`): `null` deve virar "—", nunca `NaN`. `getMetricNumericValue` (`?? 0`)
   continua igual para quem soma.
5. Testes (`lib/rules/__tests__/`): portar `boardRules.test.ts`; **diferencial** contra as
   referências da fase 0 sobre uma matriz adversarial (vazio, espaços, `,` vs `.`, 0, null,
   maiúsculas) — igualdade obrigatória em tudo **exceto** os casos intencionalmente mudados,
   listados um a um no teste (heurística `> 1`, `null` em métrica, regex); um caso por métrica
   da tabela da §2 ("anúncio de imagem em hook < 5%", "R$ 300 e 0 resultados em CPR < 50"…).

### Fase 2 — Boards no motor (P) — ✅ FEITA

`app/boards/page.tsx`, `BoardGroupBand`, `BoardGroupDialog`, `BoardRuleBuilder` importam de
`lib/rules`. `BoardRuleBuilder` → `components/rules/RuleBuilder.tsx` com prop
`context: "boards"`. Nada muda de comportamento; é o teste de que o motor movido é o mesmo.

### Fase 3 — Manager no motor (G)

É a maior fase e a que mais apaga código.

1. **Estado.** `columnFilters: ColumnFiltersState` (shapes `FilterValue`/`TextFilterValue`/
   `StatusFilterValue`/`DateFilterValue`/`TagFilterValue`) vira **uma `RuleTree` por aba**, em
   `sessionStorage` `hookify-manager-rules:${tab}`. As chaves antigas são ignoradas (sem migração:
   é sessão). Default da aba individual: `status is_active` (hoje `selectedStatuses: ["ACTIVE"]`).
2. **Avaliação em um lugar só.** Hoje são ~30 `filterFn` por coluna mais o `globalFilter` fora do
   TanStack. Passa a ser **uma** chamada `filterRowsByRules` no memo `data` (onde o `globalFilter`
   já é aplicado), com o TanStack recebendo linhas já filtradas. Somem: todos os `filterFn`, o
   memo `tableColumnFilters` (colapso de instâncias em array), `applyNumericFilterMaybeArray`,
   `applyPercentageFilterMaybeArray`, as colunas ocultas `adset_name_filter` /
   `campaign_name_filter` / `active_count_filter`, e os comparadores de `columnFilters` no memo de
   `TableContent`/`ExpandedChildrenRow`/`CampaignChildrenRow`.
3. **Busca por nome** (caixa) continua separada — é atalho — mas usa o `compareText` do motor.
4. **FilterBar.** O popover "Filtros (N)" passa a hospedar o `RuleBuilder` (`context:
   "manager"`, `tab`), com E/OU no topo e subgrupos. Clicar no funil de uma coluna abre o popover
   com uma folha nova já naquele campo. `N` = `countRuleConditions`. Inputs de porcentagem: sufixo
   `%`, apoio em `text-2xs` com a leitura ("2 → 2%"), vírgula aceita.
5. **Funil no header** = existe folha com `field === coluna` (`getFilteredColumnIds` reescrito
   sobre a árvore). Uma folha dentro de um OU cruzando colunas acende o funil das duas — honesto.
6. **Linhas-filhas e drill.** `ManagerChildrenTable` e `ManagerDrillModal` usam o mesmo
   `RuleBuilder`/`filterRowsByRules` com `context: "manager-children"` (sem tags). **Apaga
   `lib/utils/applyRowFilters.ts` inteiro** (e com ele a heurística `> 1`).
7. **URL.** `app/manager/page.tsx` (`?filter=campaign_name&value=X`, vindo da busca global) monta
   uma folha em vez de `{ operator: "contains" }`. Contrato da URL não muda.
8. **Médias filtradas** (`useFilteredAverages`) já leem as linhas filtradas; conferir que seguem
   iguais. Export CSV lê `getSortedRowModel` — não muda.
9. **Ordenação com "—".** N/A vai para o fim nas duas direções (TanStack `sortUndefined: "last"`
   nas colunas de métrica). Sem isso o "—" do CPR viraria o novo "0 no topo".
10. Apagar `components/common/ColumnFilter.tsx` (tipos + popover readonly),
    `lib/utils/columnFilters.ts` (substituído), `getManagerFilterableColumns` (o registry decide).
11. Testes: `tagFilter.test.ts` continua; novo `managerRules.test.ts` cobrindo URL → folha,
    default da aba individual, funil por coluna, e um diferencial "filtro antigo × árvore" para
    os casos que existiam (contém / > / status / tags / data) via as referências da fase 0.

### Fase 4 — Critério de validação no motor (M)

1. **Formato gravado.** `user_preferences.validation_criteria` passa a ser uma `RuleTree`
   (`{logic, conditions}`) — o mesmo jsonb dos grupos do Board. O único leitor de forma no
   backend é `onboarding_service.py` (`isinstance(criteria, list) and len > 0`): vira "árvore com
   ≥ 1 condição". Nenhuma outra rota lê o campo.
2. **Migration 134** (ver fase 5 para a numeração): `update user_preferences set
   validation_criteria = '{"logic":"AND","conditions":[]}'` — reset combinado. Antes de rodar,
   `SELECT` dos critérios atuais para o usuário redigitar (regra `sql_update_verify_before_run`).
3. Apagar `lib/config/adMetricsFields.ts`, o avaliador de `lib/utils/validateAdCriteria.ts`
   (`evaluateCondition`, `evaluateGroup`, `resolveGlobalLogic`, `applyGlobalLogic`,
   `buildAdMetricsData`, `aggregateMetricsForGroup` — conferir consumidores de cada um),
   `components/common/ValidationCriteriaForm.tsx` (morto, sem importadores) e o tipo
   `ValidationCondition` que vive dentro do `.tsx`.
4. `ValidationCriteriaBuilder` → `RuleBuilder` com `context: "criteria"` (mesmo componente do
   Boards e do Manager). Renderizado em `Topbar` (aba "Validação") e em
   `onboarding/steps/ValidationStep.tsx` (semente default no formato novo).
5. Consumidores do avaliador passam a chamar `rowMatchesRules(ad, criteria, { actionType,
   mqlLeadscoreMin })` **direto sobre a linha da RPC**, sem `buildAdMetricsData`/
   `mapRankingToMetrics`: `useAdPerformancePipeline`, `metricRankings`, `GoldKanbanWidget`,
   `InsightsKanbanWidget`, `GemsWidget`. É o que o Boards já faz sobre as mesmas linhas.
6. Ganhos automáticos: `hook`, `page_conv` e as MQL entram no critério; os 11 campos mortos
   somem; a escala de porcentagem passa a ser a mesma das outras telas.
7. Testes: `validationGlobalLogic.test.ts` é reescrito sobre a árvore (10 casos preservados:
   E/OU global, grupos, lógica do grupo não desce). Diferencial da fase 0 vale para os 11 campos
   que **passam a funcionar** — a divergência é intencional e listada.

### Fase 5 — RPC: `campaign_ids`, `adset_ids` e dicionário de nomes (M)

Independente das fases 2–4; destrava os campos de campanha/conjunto no registry.

1. **Migration 136** (134 = pack_ids nas filhas; 135 = reset do Critério): `fetch_manager_performance_base_v135` a partir
   da v132, e a entry `fetch_manager_rankings_core_v2` re-apontada (mesmo padrão da 132):
   - `per_ad`: `+ min(nullif(f.campaign_id, '')) as campaign_id` (o rollup já tem a coluna;
     `adset_id` já está lá).
   - `grouped`: `+ array_agg(distinct p.campaign_id) filter (…) as campaign_ids`, idem
     `adset_ids` — mesmo `group by` do `account_ids`, sem passada nova.
   - item: `'campaign_ids', 'adset_ids'`.
   - raiz: `'names', jsonb_build_object('campaigns', {id: nome}, 'adsets', {id: nome})` — só dos
     ids presentes nas linhas **paginadas**; nomes vêm de `public.ads` (tem `campaign_name` /
     `adset_name`; `per_ad_status` já faz o join por `(user_id, ad_id)`, o que cobre pack
     compartilhado — o nome vem do silo do dono). `campaign_name`/`adset_name` do representante
     continuam na linha por compatibilidade até a fase 6.
2. **Backend** `analytics.py`: `_normalize_rankings_rpc_response` deixa `names` passar (é
   whitelist — sem isso o frontend nunca vê). Parâmetros `p_*_name_contains` ficam na assinatura
   (compatibilidade), continuam não enviados pelo frontend.
3. **Frontend** `lib/api/schemas.ts`: `campaign_ids`/`adset_ids` em `RankingsItemSchema` e
   `names` em `RankingsResponseSchema` — os dois são `z.object` **sem passthrough**, chave não
   declarada é descartada em silêncio. `useAdPerformance` entrega `names` ao contexto do motor
   (Manager, Boards, pipeline do Critério).
4. Registry: ativar `campaign_ids`/`adset_ids` (multiselect, opções do dicionário) e
   `campaign_name`/`adset_name` (texto). Boards: `dimensionOptions` ganha campanha/conjunto.
   Manager: colunas opcionais "Campanha"/"Conjunto" iguais a Pack/Conta (chips, "alguma") —
   pode ficar para depois; o filtro não depende delas.
5. **Diferencial no lab** (`backend/scripts/diff_rankings_rollup.py`, v132 × v135): todas as
   chaves antigas idênticas; as novas presentes e coerentes (`campaign_ids` ⊇ `campaign_id` do
   representante; toda id do array tem nome no dicionário). Todos os cenários do script.
6. **Medir o payload** por aba antes/depois (pior caso esperado: por-anúncio, ~600 B/linha em
   criativos com ~34 ads → ≤ 300 KB em 500 linhas; sparklines já pesam mais). Se passar de ~10%
   do total da aba, aí sim `p_include_parent_ids` (com custo de query key nova no cache).
7. Depois: `pg_dump` do `schema.sql` (está parado na base v116) + `generate_schema_map.py`.

### Fase 6 — Limpeza e registro (P)

- Apagar os re-exports de `lib/boards/{types,fields,evaluate}`, `campaign_name`/`adset_name`
  do representante na RPC (só quando nenhum consumidor ler), `p_*_name_contains` se o diferencial
  não os usar mais.
- `documentation/decisoes-tecnicas.md`: entrada "2026-08 — Um motor de filtros" com as três
  decisões e o porquê de **não** filtrar nome no servidor (OU inexpressável atravessando a
  agregação + forma `p_x is null or` dos 57014).
- `como-funciona-o-app.md`: seção de filtros (E/OU, "sem dado", `%`).
- Memória: candidata única — "`formatKind` imutável depois de publicado" (restrição que o código
  não revela). Decidir ao final, pelo teste do `CLAUDE.md`.

### Decisões de 2026-08-28 (funil, tags, procedência nas filhas)

- **O funil da coluna REVELA, não cria.** Numa árvore com grupos e OU não existe
  resposta óbvia para "onde entra a condição nova": no topo ela somaria (OU) ou
  apertaria (E) conforme um seletor que está em outro lugar da tela — o mesmo
  clique faria coisas opostas. O funil responde a pergunta que consegue responder
  sem ambiguidade ("onde este campo está sendo filtrado?"), abre o popover e rola
  até a condição, destacada. Criar continua sendo dentro do construtor.
- **Tags só nas abas Criativos e Anúncios.** A RPC devolve `tags: []` nas abas de
  Conjunto e Campanha de propósito (a tag do representante descreveria o grupo
  errado). Oferecer o campo lá era filtro que zerava a tabela sempre — parecia bug
  do filtro, não do dado. Conserto, não escopo novo.
- **Conta nas linhas-filhas:** sai de graça. A filha é UM anúncio e já traz
  `account_id` (exato, não representante). O campo declara `rowKeyFallback` e o
  motor trata um valor único como lista de um.
- **Pack nas linhas-filhas:** exige a migration 134. Rende só com dois ou mais
  packs selecionados — com um pack só, todas as linhas mostram o mesmo. O usuário
  confirmou que trabalha com vários.
- **Tags nas filhas: NÃO.** Tag é do criativo; derivá-la para o anúncio exigiria
  casar por nome, vínculo que não existe no dado.

## 5. Riscos e como cada um é tratado

| Risco | Tratamento |
|---|---|
| `OrNull` devolvendo `null` para hook & cia. muda células e sparklines | Fase 1 confere os 5 consumidores; `null` → "—"; somas usam `getMetricNumericValue` (`?? 0`), intocado |
| "—" no CPR sobe para o topo na ordenação | `sortUndefined: "last"` (fase 3.9); RPC ordena `nulls last` mas devolve 0 — conferir se a ordenação da tela é a do cliente |
| Regex do usuário trava a aba (backtracking) | Limite de 200 chars + `try/catch`; app interno; registrar se abrir |
| Zod sem passthrough engole `names`/`campaign_ids` | Item explícito na fase 5.3 |
| `_normalize_rankings_rpc_response` é whitelist | Item explícito na fase 5.2 |
| Reset dos critérios apaga o do idealizador | `SELECT` antes do `UPDATE`; redigitar no builder novo (uma vez) |
| Onboarding lê `validation_criteria` como lista | Fase 4.1 muda o check para "árvore com ≥ 1 condição" |
| Diferencial "passa" porque ninguém sabotou | Cada fase fecha com um teste quebrado de propósito |
| Plano generic `p_x is null or` na RPC nova | Nenhum parâmetro opcional novo; arrays entram no `group by` existente |

## 6. O que fica explicitamente de fora

- Filtro por nome no servidor (`p_*_name_contains` ligado na UI) — rejeitado, ver §1/fase 6.
- Persistir filtros do Manager no banco (continuam em `sessionStorage`).
- "Presets" de filtro / compartilhamento de regra — já rejeitados em `boards_rule_grouping_rejected_alternatives`.
- `overall_conversion` como campo de critério — não é `MetricKey`; entra só se virar métrica do registry.
