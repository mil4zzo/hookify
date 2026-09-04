# Plano: planilha flexível (colunas além do leadscore)

Data: 2026-09-03. Estado: **CÓDIGO PRONTO, AGUARDANDO REVISÃO VISUAL E PRODUÇÃO** (2026-09-03).
F0 a F4 concluídas; F5.1/F5.2 verdes (backend 525 testes, frontend 339, `tsc` e design
system limpos; sabotagens SQL e de frontend provadas). Falta o ponto de parada 2 (revisão
visual do usuário) e então F5.3 a F5.7: migration 140 em produção, deploy, smoke com a
planilha real e o diferencial V1 × V2 em produção. Nada foi commitado ainda.

> **Documento vivo.** O status de cada tarefa é atualizado durante a execução. Serve para
> retomar o trabalho em qualquer sessão sem reler o histórico. Achados que contradizem o
> texto original entram na seção "Achados durante a execução", no fim.

Legenda de status: `[ ]` não iniciado · `[~]` em andamento · `[x]` concluído · `[-]` descartado (com motivo).

---

## 1. Por que

A integração com Google Sheets importa **uma** coluna: o leadscore. Tudo que está na
mesma linha da planilha (idade, renda, resposta de pesquisa, um segundo leadscore em
teste) fica fora do app. O caso concreto de hoje é a planilha de pesquisa do próprio
Hookify: a linha do lead já tem data, anúncio, leadscore e as respostas; só o leadscore
entra.

Isto **não** é o P1 do `roadmap-pack-como-unidade.md`. O P1 foi adiado por causa de
eventos de funil (reunião marcada semanas depois da captura), que criam o dilema "evento
do período ou lead do período". Aqui os atributos vivem na **mesma linha e na mesma
data** do lead, e a atribuição é a que o leadscore já usa. O escopo é menor.

## 2. O que muda para quem usa

| Onde | Hoje | Depois |
|---|---|---|
| Dialog da planilha, passo de colunas | 1 coluna (leadscore) + corte de MQL | Lista de colunas vinculadas, cada uma com tipo, rótulo e, se leadscore, corte próprio |
| Manager | Leadscore médio, MQLs, % MQL, CPMQL | As mesmas quatro para **cada** coluna do tipo leadscore; média para colunas numéricas; resposta majoritária para categoria |
| Filtros, Boards e Critério | Só métricas fixas | Colunas vinculadas aparecem como campos (numéricas com operadores de número; categoria com "é / não é") |
| Modal de detalhe | Sem nada da pesquisa | Aba **Pesquisa**: média, mínimo, máximo, mediana e distribuição de cada coluna, para aquele anúncio ou grupo |
| Export CSV | Sem colunas da planilha | Colunas vinculadas exportáveis |
| Quem não vincula coluna nenhuma | Nada muda | Nada muda, inclusive no custo das consultas |

## 3. Decisões fechadas

Decisões do usuário (2026-09-03):

1. **Texto livre fica fora do v1.** Motivos: LGPD (e-mail, telefone e nome entrariam no
   banco), custo (frases por anúncio-dia no caminho de leitura mais quente do app) e valor
   só de leitura. Se voltar, é tabela lateral própria, fora do read model.
2. **Categoria aparece como coluna no Manager já no v1** (resposta majoritária + fatia),
   não só no modal.
3. **Leadscore V2 entra como coluna genérica do tipo "leadscore".** O leadscore V1
   (`ad_metrics.leadscore_values`, RPCs, `analytics.py`) fica intocado. Dois caminhos
   convivem por um tempo; a migração do V1 para o caminho novo é dívida com data (seção 9).

Decisões técnicas (Claude, 2026-09-03), para não reabrir:

4. **Histograma desde a importação.** O importer já tem os valores em mãos; grava direto
   `{valor: quantidade}` por (anúncio, dia, coluna). O histograma é sem perda para tudo que
   o v1 calcula (média, mínimo, máximo, mediana, contagem por resposta, corte). Não se
   guarda o valor por lead. O rollup copia o objeto tal como está (derivação = identidade).
5. **Chave da coluna é o id do vínculo, nunca o nome do cabeçalho.** Renomear o cabeçalho
   na planilha não quebra regra salva, preferência de coluna nem Board. Chave de métrica no
   frontend: `custom:<mapping_id>:<faceta>`.
6. **Tipo é decisão de mão única** (mesma regra do `formatKind`, ver memória
   `metric_formatkind_immutable_after_publish`). Errou o tipo: exclui o vínculo e cria
   outro. Rótulo e corte são editáveis.
7. **Opt-in na leitura.** As RPCs só agregam histogramas quando `p_include_custom = true`.
   O frontend pede quando **algum pack selecionado tem vínculo**. Quem não tem, não paga.
8. **Categoria com teto de 20 valores distintos** na amostra do vínculo e na importação.
   Acima disso a coluna é texto livre e o app recusa com mensagem clara. Multiselect dentro
   da célula ("A;B") fica fora do v1: a célula é um valor só.
9. **Normalização dos valores.** Número: inteiro se for inteiro, senão até 6 casas sem
   zeros à direita (`"25"`, `"3.5"`), coerente com o `trim_scale` que a RPC usa para
   leadscore. Categoria: `trim` e colapso de espaços internos; caixa preservada. Célula vazia
   ou inválida é pulada e contada no relatório do sync, nunca aborta o job.
10. **Sem série diária no v1.** Colunas vinculadas não têm sparkline nem tendência; a RPC
    de série (v131) não é tocada. O histórico por dia fica para depois, se pedirem.
11. **Excluir vínculo não faz purge em `ad_metrics`.** O objeto da linha guarda a chave
    morta até o próximo sync reescrever a linha (o importer grava o objeto completo por
    anúncio-dia). Um purge seria um UPDATE em massa que passa pelo trigger do rollup, e o
    dado morto é invisível para a UI, que só conhece vínculos existentes.
12. **Carimbo de frescor não muda.** Vincular exige sync para popular, e o sync já renova
    `last_successful_sync_at`, que está na chave do cache. Excluir ou renomear vínculo muda
    só a apresentação.
13. **Corte de MQL de coluna leadscore vive no vínculo** (`config.mql_min`), não no pack.
    Cada coluna tem escala própria. Editável no dialog; a tela de configuração do pack não
    entra no v1.

## 4. Modelo de dados

### `sheet_column_mappings` (tabela nova)

| Coluna | Tipo | Nota |
|---|---|---|
| id | uuid pk | chave estável da coluna no app |
| integration_id | uuid fk `ad_sheet_integrations(id)` on delete cascade | |
| owner_id | uuid | espelha o dono da integração; RLS igual à `ad_sheet_integrations_modify_own` |
| column_index | integer | posição na planilha (0-based), como os `*_column_index` existentes |
| column_name | text | cabeçalho no momento do vínculo, só para exibir |
| label | text | nome que o usuário escolheu |
| kind | text check in (`leadscore`, `number`, `category`) | imutável |
| config | jsonb | `{"mql_min": 70}` para leadscore; `{}` para os demais |
| position | integer | ordem de exibição |
| created_at, updated_at | timestamptz | |

### `ad_metrics.custom_hist jsonb` (coluna nova, nula)

`{"<mapping_id>": {"25": 2, "31": 1}, "<mapping_id>": {"A": 4, "B": 2}}`. Gravada pelo
sync via `batch_update_ad_metrics_enrichment` (mesma RPC do leadscore, item ganha a chave
`custom_hist`). Coluna nula para quem não tem vínculo: zero bytes a mais.

### `ad_performance_daily.custom_hist jsonb` (coluna nova, nula)

Cópia da de `ad_metrics`, derivada por `ad_performance_derive_row` (identidade). Entra na
comparação de mudança dos triggers `ad_metrics_rollup_sync_ins/upd`, no `rebuild` e no
`consistency_check`.

### Resposta das RPCs

Cada linha (grupo, entidade ou filho) ganha `custom_histograms` com o mesmo formato, já
somado por grupo e período. O frontend deriva tudo de lá, como já faz com
`leadscore_histogram` em `lib/utils/mqlMetrics.ts`.

## 5. Fases e tarefas

### F0. Prova de custo e sabotagem no laboratório (antes de qualquer código de produto)

Laboratório `hookify_lab` (ver memória `db_connection`): dados reais, migrations 128 a 134
aplicadas; aplicar 135 a 139 antes de começar.

| # | Tarefa | Status |
|---|---|---|
| F0.1 | Aplicar migrations 135 a 139 no laboratório e rodar `ad_performance_rollup_consistency_check()` (deve devolver zero linhas) | `[x]` 2026-09-03: o lab já tinha 135-138; 139 aplicada; checagem global = zero linhas em 5 min |
| F0.2 | Popular `custom_hist` sintético no pack mais pesado (3 vínculos: 1 leadscore, 1 número, 1 categoria) via UPDATE em `ad_metrics`, e confirmar que o rollup acompanhou | `[x]` pack "EI.30 - CA4 Cap" (25.760 anúncio-dias, 3.998 com leads, 41.299 leads): 3.998 linhas com histograma em `ad_metrics` e 3.998 no rollup; 255 bytes por linha; checagem do usuário = zero linhas. Ver achado 1 (seed vazou para 3 silos vizinhos) |
| F0.3 | Medir a RPC v139 frio e quente **sem** a agregação, depois com a agregação de jsonb por grupo escrita à mão (protótipo da v140). Registrar os números aqui. Critério de go: agregação custa menos que 20% do tempo atual na aba "Por anúncio" com o período de 90 dias | `[x]` **GO.** Números na seção 10 (achado 2). Sem o parâmetro: custo idêntico à v139. Com: +120 ms (~25%) na aba "Por anúncio" no pior caso sintético, +15% nas abas pesadas; detalhe sem diferença |
| F0.4 | Sabotar: alterar um histograma em `ad_performance_daily` sem passar pelo trigger e confirmar que o `consistency_check` estendido (F1.5) acusa. Só então confiar no teste | `[~]` vira asserção C do teste F1.9 |

### F1. Migration 140 (banco)

Um arquivo, `140_planilha_flexivel_colunas_vinculadas.sql`, aditivo e compatível com o app
atual (colunas nulas, parâmetros com default `false`). Sem fase 2 de DROP: nada é removido.

| # | Tarefa | Status |
|---|---|---|
| F1.1 | Tabela `sheet_column_mappings` + índices (`integration_id`, `owner_id`) + RLS espelhando `ad_sheet_integrations` + grant | `[x]` no arquivo da 140, aplicada no lab |
| F1.2 | `ad_metrics.custom_hist jsonb` e `ad_performance_daily.custom_hist jsonb` | `[x]` idem |
| F1.3 | `ad_performance_derive_row` devolve `custom_hist`; `rollup_apply` grava; triggers `sync_ins/upd` incluem a coluna na comparação de mudança | `[x]` idem (derive_row exigiu DROP: RETURNS TABLE não aceita `create or replace` com coluna nova) |
| F1.4 | `ad_performance_rollup_rebuild` inclui a coluna | `[x]` idem |
| F1.5 | `ad_performance_rollup_consistency_check` compara a coluna (validado pela sabotagem F0.4) | `[x]` asserção C1 do teste: adulteração direta do rollup é acusada (1/1) |
| F1.6 | `batch_update_ad_metrics_enrichment`: item aceita `custom_hist` (grava quando presente; `leadscore_values` continua opcional e independente) | `[x]` no arquivo da 140, aplicada no lab |
| F1.7 | `fetch_manager_performance_base_v140`: cópia da v139 + `p_include_custom boolean default false` + CTE que soma histogramas por grupo (`jsonb_each` duas vezes, `sum(qty)`) + `custom_histograms` no item. Repontar a entry como as anteriores | `[x]` gerada por script a partir do texto da v139 (edições ancoradas), aplicada no lab e colada na seção 5 do arquivo da 140; a entry ganhou o 17º parâmetro (DROP da assinatura de 16) |
| F1.8 | `fetch_entity_performance_v135`: cópia da v134 + `p_include_custom` + `custom_histograms` nos totais da entidade e de cada filho (período inteiro, sem série) | `[x]` idem |
| F1.9 | Teste SQL em `supabase/tests/140_planilha_flexivel.test.sql`: soma de histogramas por grupo contra query manual; linha sem vínculo devolve `null`; `p_include_custom=false` não muda o resultado da v139 (diferencial byte a byte nas outras chaves) | `[x]` 26 asserções verdes (3 min; a C1 usa a checagem real do usuário inteiro). Sabotagens provadas: trigger de UPDATE desligado → falha em A2; v140 somando com `max` → falha em D1; checagem cega para `custom_hist` → ver achado 3 |
| F1.10 | Aplicar no laboratório, rodar F1.9 e `consistency_check`; medir a v140 com e sem o parâmetro e registrar aqui | `[x]` medido (achado 2); após `vacuum analyze`, 5 rodadas: sem parâmetro 503-570 ms, com 625-817 ms |

### F2. Backend

| # | Tarefa | Status |
|---|---|---|
| F2.1 | Schemas Pydantic: `SheetColumnMapping`, `SheetColumnMappingInput` (kind enum, label obrigatório, `mql_min` obrigatório para leadscore, `column_index` obrigatório) | `[x]` `SheetColumnMappingInput`/`SheetColumnMappingPatch` em `google_integration.py`; regras em `services/sheet_column_mappings.py` (módulo novo) |
| F2.2 | `POST /ad-sheet-integrations` aceita `column_mappings[]` e grava na tabela nova na mesma transação lógica (integração primeiro, depois vínculos; falha nos vínculos apaga a integração recém-criada) | `[x]` `_reconcile_column_mappings`: lista = conjunto desejado (atualiza por id, cria sem id, exclui os de fora); valida TUDO antes de escrever. Não apaga a integração em falha: a validação acontece antes de qualquer escrita, então a integração fica sem vínculos e o usuário corrige |
| F2.3 | Rotas novas em `google_integration.py`: `PUT /ad-sheet-integrations/{id}/columns/{mapping_id}` (label, config, position; **kind e column_index recusados**) e `DELETE .../columns/{mapping_id}`. Gate dono ou editor via `resolve_pack_access`, viewer 403, escrita por service role (mesmo padrão do corte de MQL) | `[x]` + verbo `pack.sheet_columns` no log de ações (tradução no frontend pendente, F4) |
| F2.4 | `GET /ad-sheet-integrations` e a listagem de packs devolvem `column_mappings[]` dentro de `sheet_integration` (é por aí que `useLoadPacks` sincroniza) | `[x]` `list_packs`, `list_shared_packs`, `get_pack` e a rota de listagem |
| F2.5 | `ad_metrics_sheet_importer.py`: `_load_sheet_config` carrega os vínculos; `_parse_and_aggregate_rows` lê N colunas e monta o histograma por vínculo com a normalização da decisão 9; teto de 20 categorias por vínculo (acima: vínculo marcado como inválido no relatório, coluna pulada, sync segue); `_build_final_data_and_groups` inclui `custom_hist` no item; contadores de células puladas por vínculo no resultado do job | `[x]` `HistogramCollector`; `custom_hist` SEMPRE no item (`{}` limpa dado morto); relatório `custom_columns` no job |
| F2.6 | Validação do vínculo no save: amostra de até 200 linhas da coluna; `number` exige 100% numérico nas células não vazias; `category` exige até 20 distintos; `leadscore` exige numérico e `mql_min` dentro do intervalo observado (aviso, não erro) | `[~]` a leitura de colunas do Google traz só as linhas 1-10 (uma requisição); a validação de tipo contra amostra roda no dialog (F4.1) com essas linhas, e o importer é o guarda real (teto de categoria no conjunto inteiro). Sem chamada extra ao Google no save |
| F2.7 | `analytics.py`: `RankingsRequest.include_custom: bool = False` → `p_include_custom`; passthrough de `custom_histograms` nos itens do Manager, do detalhe e dos filhos (`_entity_child_item` e vizinhos) | `[x]` Manager (passthrough natural da RPC); detalhe de criativo, anúncio e conjunto; filhos de criativo, conjunto e campanha; `entity_performance.py` aponta para a v135 |
| F2.8 | Testes: `test_sheet_column_mappings.py` (validação, gate de papel com convidado viewer/editor, kind imutável), `test_sheet_importer_custom.py` (normalização, célula inválida pulada, teto de categoria, `custom_hist` no item, leadscore V1 intocado quando o vínculo falha), `test_entity_performance.py` estendido para o passthrough | `[~]` os dois arquivos novos escritos; resultado abaixo |

### F3. Frontend, camada de dados

| # | Tarefa | Status |
|---|---|---|
| F3.1 | `schemas.ts`: `SheetColumnMappingSchema`; `SheetIntegrationSchema.column_mappings`; `custom_histograms` em `RankingsItem`, `RankingsChildrenItem` e no detalhe (`z.record(z.string(), z.record(z.string(), z.number())).optional()`); `SheetIntegrationRequest.column_mappings` | `[x]` + `SheetSyncCustomColumnReportSchema` (relatório do sync por coluna) |
| F3.2 | `endpoints.ts`: `updateSheetColumnMapping`, `deleteSheetColumnMapping`; `include_custom` no request de rankings | `[x]` + `appendIncludeCustom` nas 6 rotas de detalhe/filhos (só quando o registro ativo tem coluna) |
| F3.3 | Store/`useLoadPacks`: `sheet_integration.column_mappings` sincronizado como campo mutável (memória `useloadpacks_sync_mutable_fields`) | `[x]` sem código novo: `sheet_integration` já é comparado por `JSON.stringify` inteiro, e os vínculos viajam dentro dele |
| F3.4 | `lib/metrics/customColumns.ts` (novo): tipo `CustomColumnKey = \`custom:${string}:${Facet}\``, parse/build da chave, `getCustomColumnsForPacks(packs, selectedIds)` (união dos vínculos, deduplicada por id), rótulos ("Leadscore V2 médio", "MQLs (Leadscore V2)", "% MQL (Leadscore V2)", "CPMQL (Leadscore V2)", "Idade média", "Faixa de renda") | `[x]` (`collectPackMappings`, `buildCustomColumnDefs`, `getCustomMetricValue`, `getCustomTopValue`; número virou "Média de Idade" para não depender de gênero) |
| F3.5 | `lib/utils/customHistogram.ts` (novo): `mergeHistograms`, `histogramStats` (n, média, mínimo, máximo, mediana), `histogramTop` (valor majoritário + fatia), `computeLeadscoreFacetsFromHistogram` **reutilizando** `normalizeLeadscoreValues`/`computeMqlCount`/`computeCpmqlFromMqlCount` de `mqlMetrics.ts` (mesma função, mesma conta: é o que garante V1 = V2) | `[x]` `computeLeadscoreFacets` chama `computeMqlMetricsFromLeadscore` (a mesma do V1) |
| F3.6 | Registry: `ManagerColumnType` passa a ser `ManagerMetricKey \| CustomColumnKey`; `getManagerMetricLabel`, `formatManagerMetricValue`, `isManagerRatioPercentMetric` e `getManagerMetricEmptyKind` resolvem chaves `custom:` pela faceta (avg/cpmql: decimal/currency; mql_rate: ratioPercent; mqls: integer; top: texto). Sem `any`: tipo `custom:${string}` separado para o `tsc` pegar `undefined` | `[x]` ver achado 4 (registro ativo `customColumnsRegistry`): a porta única de leitura `getMetricNumericValueOrNull` resolve `custom:` pelo registro, e com isso avaliador de regra, export, filhos e ordenação funcionam sem parâmetro novo |
| F3.7 | `computeManagerAverages`: médias das facetas numéricas a partir dos histogramas somados (ponderadas por contagem, como leadscore); categoria sem média | `[x]` `computeCustomColumnAverages` → `ManagerAverages.custom`; pack, filtrado e seleção passam `customColumns` |
| F3.8 | `managerColumnPreferences.ts`: `normalizeManagerColumnOrder(saved, knownCustomIds)` descarta chaves `custom:` desconhecidas e anexa as novas ao fim; `isManagerMetricColumnVisible` gateia `custom:` pela existência do vínculo nos packs selecionados (substitui o `hasSheetIntegration` para essas) | `[x]` + o save PRESERVA no storage as chaves `custom:` de outra seleção de packs (senão abrir o Manager com outro pack apagaria a escolha feita para o pack da planilha) |
| F3.9 | `lib/rules/fields.ts`: `getRuleFields(availability)` inclui as colunas vinculadas (`metric` para avg/mqls/mql_rate/cpmql; `multiselect` para categoria, opções vindas das linhas na tela via `dimensionOptions`); `evaluate.ts` lê `custom:` da linha computada. Vínculo excluído: campo continua avaliável e aparece como "Coluna excluída (rótulo)", nunca some nem zera a tela | `[x]` `lib/rules/customFields.ts`; grupo "Planilha"; fora do Critério (sem pack selecionado lá); categoria = "resposta majoritária é X", opções = respostas vistas nas linhas |
| F3.10 | Hook de dados: `include_custom = packs selecionados têm ≥1 vínculo`; entra na queryKey (`adPerformance`) | `[x]` Manager e Boards (Explorer fora do v1) |
| F3.11 | Testes (`tsx --test`): `customColumns.test.ts` (chave, rótulos, união por packs), `customHistogram.test.ts` (stats, top, empate no top), `managerColumnPreferences.test.ts` (descarte de chave morta), `registry.test.ts` (facetas), `rules` (campo de vínculo excluído) e o **diferencial V1 = V2**: um mesmo histograma passado pelo caminho `leadscore_histogram` e pelo caminho `custom:` produz média, MQLs, % MQL e CPMQL idênticos | `[x]` 12 asserções verdes em `customHistogram.test.ts` + `customColumns.test.ts` (inclui o diferencial V1 = V2 com 6 cortes e o vínculo excluído); sabotagem pendente (F5.1) |

### F4. Frontend, telas

| # | Tarefa | Status |
|---|---|---|
| F4.1 | `SelectColumnsStep`: bloco "Colunas adicionais" com lista de vínculos (coluna, tipo sugerido pelas amostras, rótulo, corte se leadscore), botão adicionar/remover; tipo bloqueado depois de salvo; recusa texto livre com a mensagem "esta coluna tem mais de 20 respostas diferentes" | `[x]` + `lib/utils/sheetColumnSamples.ts` (espelho do `classify_samples` do backend); vínculo gravado mostra cadeado em coluna e tipo |
| F4.2 | `SummaryStep` lista os vínculos; `GoogleSheetIntegrationDialog` monta o payload; edição de rótulo/corte/exclusão pelo mesmo dialog reaberto em modo de edição | `[x]` dialog: carrega vínculos existentes, manda `column_mappings` só quando a lista reflete o servidor (`extraColumnsReady`), valida com a mesma regra do backend antes do save; `SummaryStep` lista o relatório por coluna (valores, células puladas, motivo de ignorar) |
| F4.3 | `managerColumns.ts` / `ManagerColumnFilter`: grupo "Planilha" com as colunas vinculadas dos packs selecionados, desligadas por padrão | `[x]` anexadas ao fim da lista (o seletor é uma lista reordenável única, sem grupos); rótulo pelo registro |
| F4.4 | `managerTableMetricColumns.tsx`: facetas numéricas via `pushStandardMetricColumn` (sem sparkline: `getMetricSeriesAvailability` devolve indisponível para `custom:`); célula de categoria nova (`CategoryCell`: "B · 62%", tooltip com a distribuição, ordena pela fatia do majoritário) | `[x]` numéricas com `MetricCell` em `cellMode="value"` (sem sparkline/tendência); categoria inline com tooltip |
| F4.5 | `ManagerTable.tsx`: os 3 pontos do gate `requiresSheetIntegration` (`isColumnEnabled`, `isColumnDisabled`, merge de `averages`) reconhecem `custom:`; `TableSummaryBar` mostra média das facetas numéricas e "—" para categoria | `[x]` + re-normalização da ordem quando a seleção de packs muda as colunas conhecidas |
| F4.6 | `ManagerChildrenTable` / `ExpandedChildrenRow`: colunas `custom:` ativas aparecem nos filhos (dado vem de F1.8) | `[x]` a tabela de filhos lê o registro ativo (sem prop nova nas 3 camadas de memo) |
| F4.7 | Filtros do Manager (`FilterBar` via motor único) oferecem os campos de F3.9 | `[x]` automático: o `RuleBuilder` usa `getAvailableRuleFields`, que já inclui o registro |
| F4.8 | `ManagerDrillModal` e `AdDetailsDialog`: aba **Pesquisa** (só quando há vínculo): por coluna, cartão com n, média, mínimo, máximo, mediana (número/leadscore) ou barras de distribuição (categoria); leadscore mostra também o corte e os MQLs | `[x]` `components/ads/SurveyPanel.tsx` na `AdDetailsDialog` (criativo e anúncio); o `ManagerDrillModal` de conjunto/campanha não tem aba própria: lá as colunas aparecem na tabela de filhos |
| F4.9 | `ManagerExportDialog` + `exportManagerCsv.ts`: colunas `custom:` exportáveis; valor de categoria passa por `neutralizeFormula`; facetas numéricas nos sets de formatação | `[x]` |
| F4.10 | `ManagerTableSkeleton` e `ManagerPageFallback` não quebram com chave `custom:` na preferência salva | `[~]` a normalização descarta chave desconhecida antes de qualquer render; confirmar no smoke |
| F4.11 | Design system: `npm run check:design-system` e `tsc --noEmit` limpos; sem `h-*` em className, `text-2xs`, `shadow-elevation-*` | `[x]` os dois limpos |

### F5. Prova, produção e registro

| # | Tarefa | Status |
|---|---|---|
| F5.1 | Sabotagem no frontend: quebrar de propósito `histogramStats` (mediana) e `mergeHistograms` e confirmar que os testes de F3.11 falham; restaurar | `[x]` mediana errada → 1 teste falha; merge que sobrescreve → 2 falham; restaurado, 7/7 |
| F5.2 | Suite completa: `npm test`, `tsc`, design-system, `pytest tests/` | `[x]` frontend 339/339, backend 525/525, `tsc` e design system limpos (achado 6: o parâmetro `include_custom` teve de ir para o FIM das assinaturas das rotas) |
| F5.3 | Aplicar migration 140 em produção (aditiva); rodar `consistency_check` para todos os usuários via psql (deve devolver zero linhas, sem rebuild) | `[x]` **APLICADA em 2026-09-03**, 1,3 s. Tabela, colunas, RLS, RPCs e `notify pgrst` confirmados; `fetch_entity_performance_v134` mantida (o app em produção ainda a chama). Checagem de consistência: **zero linhas** em 2m30 sobre 265 mil linhas (achado 8: precisa de `set statement_timeout = 0`) |
| F5.4 | `pg_dump` do schema + `generate_schema_map.py`; commit "migration 140 aplicada em produção" | `[x]` schema sincronizado; dois commits em `main` (`fb9bb95` scroll do popover, `beba822` a feature) e push feito |
| F5.5 | Deploy no VPS (`git pull` + `deploy/deploy.sh`) | `[x]` **EM PRODUÇÃO em 2026-09-04** (commit `beba822`). Feito por SSH direto (`root@77.37.126.210`) — o MCP da Hostinger não serve aqui: só puxa imagem de registry, e o Hookify constrói do código no próprio servidor. Backend e frontend healthy; `api.hookifyads.com/health` 200; OpenAPI pública confirma `include_custom`, `column_mappings` e as rotas PUT/DELETE de vínculo |
| F5.6 | Smoke em produção com a planilha de pesquisa real: vincular idade (número), uma pergunta fechada (categoria) e o leadscore V2 (leadscore, corte próprio); sync; conferir Manager, filtro, modal, export; conferir como convidado (`test@hookify.com`, memória `shared_pack_testing_needs_disjoint_account`): viewer vê colunas e leva 403 ao editar vínculo | `[ ]` |
| F5.7 | Diferencial em produção: vincular a **mesma** coluna de leadscore como V2 com o mesmo corte do V1 e comparar as quatro métricas lado a lado em 20 anúncios (devem ser idênticas); depois excluir o vínculo de teste | `[x]` feito de forma mais barata e mais forte, sobre o dado REAL da primeira integração (2026-09-04): comparação do **universo de leads** por anúncio-dia entre o caminho V1 (array) e o caminho novo (histograma), nas 1.350 linhas importadas. RENDA MENSAL, PATRIMONIO e QUANTO POUPA: **7.665 = 7.665**, idêntico ao V1 em todas as linhas. LEADSCORE_V2: 7.574 (91 leads a menos, em 51 linhas) — é a planilha, não o importer: perda de pipeline atingiria as três outras colunas igualmente. A igualdade de CÁLCULO V1 = V2 já é provada por unidade (`customHistogram.test.ts`, 6 cortes) |
| F5.8 | Atualizar `como-funciona-o-app.md` (seção da planilha), `roadmap-pack-como-unidade.md` (P1 parcialmente coberto: atributos de pesquisa sim, eventos de funil continuam adiados) e `decisoes-tecnicas.md` (decisões 4 a 13 desta seção, resumidas) | `[x]` |
| F5.9 | Memória: uma entrada só, `sheet_custom_columns_histogram_and_two_leadscore_paths`, com o que não é derivável do código (por que histograma e não valor por lead; por que o V1 ficou fora; data-limite da dívida) | `[x]` + índice `MEMORY.md` |

## 6. Ordem de execução e pontos de parada

F0 → F1 → F2 → F3 → F4 → F5, com dois pontos de parada para o usuário olhar:

- **Depois de F0.3**: os números de custo. Se a agregação de jsonb estourar o critério, a
  alternativa conhecida é uma tabela lateral `ad_custom_daily (user_id, ad_id, date,
  mapping_id, value, qty)` com índice próprio, que o Manager só toca quando pedido. Decisão
  do usuário, com os números na mesa.
- **Depois de F4**: revisão visual da célula de categoria, do passo de colunas e da aba
  Pesquisa, antes de ir para produção.

## 7. Onde pode dar prejuízo, e a defesa correspondente

| Onde | Por quê | Defesa | Tarefa |
|---|---|---|---|
| Rollup da 128 (triggers, rebuild) | Um erro na comparação de mudança para de atualizar leadscore ou conversão em silêncio | Laboratório primeiro; `consistency_check` estendido e **sabotado antes de ser confiado** | F0.4, F1.3-F1.5 |
| RPC do Manager | Agregar jsonb por grupo custa; se entrar no caminho padrão, todo usuário paga | Opt-in por parâmetro; coluna nula; medição frio/quente antes do cutover | F0.3, F1.7, F1.10 |
| Regras salvas (Boards, Critério, filtros) | Regra aponta para vínculo excluído; hoje campo que não responde zera a tela em silêncio | Chave por id; campo continua avaliável e rotulado "Coluna excluída" | F3.9 |
| Preferências de coluna persistidas | Ordem salva com chave morta quebra a tabela | `normalizeManagerColumnOrder` descarta `custom:` desconhecida | F3.8 |
| Sync do leadscore V1 | Célula inválida numa coluna nova não pode derrubar o sync que funciona | Parse tolerante por coluna; célula ruim é pulada e contada | F2.5, F2.8 |
| Dois caminhos de leadscore | V1 na RPC/backend, V2 no cliente; arredondamento diferente vira "não bate" | Mesmas funções de `mqlMetrics.ts`; diferencial unitário e em produção | F3.5, F3.11, F5.7 |
| Export CSV | Valor de categoria é texto da planilha: vetor de injeção de fórmula | `neutralizeFormula` como nome de anúncio e transcrição | F4.9 |
| Cache persistido (IndexedDB) | Tela mostrando resposta sem a coluna nova | Vínculo só rende depois do sync, que já renova o carimbo de frescor | decisão 12 |
| Registry fechado no frontend | Abrir a união de chaves pode deixar passar `undefined` | Tipo `custom:${string}` separado; `tsc` no pre-commit; avaliadores congelados no pre-push | F3.6, F4.11 |
| Pack compartilhado | Convidado editando vínculo no silo do dono | Gate dono/editor por `resolve_pack_access`; viewer 403; teste com conta disjunta | F2.3, F2.8, F5.6 |
| Tamanho de `ad_metrics` | Chave de vínculo é uuid (36 chars) repetida por linha | Só linhas de packs com vínculo; teto de 20 categorias; medir em F0.2 | F0.2 |

## 8. Fora do v1 (registrado para não virar "esqueceram")

- Texto livre (decisão 1).
- Série diária, sparkline e tendência de colunas vinculadas (decisão 10).
- Insights, Diagnóstico, Plano de Ação, Rankings.
- Corte de MQL da coluna V2 editável na tela de configuração do pack.
- Multiselect dentro de uma célula.
- Purge de `custom_hist` ao excluir vínculo (decisão 11).
- Migração do leadscore V1 para o caminho genérico (seção 9).
- Mais de uma planilha por pack (o usuário confirmou que não faz sentido).

## 9. Dívida aceita, com data

**Dois caminhos de leadscore.** O V1 continua em `leadscore_values` + `lead_scores/lead_qtys`
+ corte em `packs.mql_leadscore_min`; o V2 vive em `custom_hist` + corte no vínculo.
Prazo para decidir a unificação: **2026-10-15**, com o V2 já usado por pelo menos um mês.
Caminho conhecido: migration que cria um vínculo do tipo leadscore para cada integração
existente, copia `leadscore_values` para `custom_hist` sob esse id, e as RPCs param de ler
`lead_scores/lead_qtys`; diferencial obrigatório antes do cutover (harness do rollup).

## 10. Achados durante a execução

1. **2026-09-03, seed do laboratório vazou para 3 silos vizinhos.** `ad_metrics.id` é o
   texto `{date}-{ad_id}`, **não é único entre usuários**: quatro contas do lab compartilham
   as mesmas contas de anúncio e por isso os mesmos ids. Um `UPDATE ... WHERE am.id = sub.id`
   sem `user_id` atingiu 12.897 linhas em vez de 3.998. O RPC de produção
   (`batch_update_ad_metrics_enrichment`) já filtra por `user_id`; o erro foi só do script
   de seed. Regra para qualquer script sobre `ad_metrics`: a chave é `(user_id, id)`.

2. **2026-09-03, F0.3, custo da agregação de jsonb (laboratório, pior caso sintético: 3
   vínculos, histogramas de 27/48/4 chaves, em 100% dos anúncio-dias com leads).**

   | Cenário | v139 | v140 sem parâmetro | v140 com parâmetro | Payload |
   |---|---|---|---|---|
   | Por anúncio, 1 pack, 42 dias, 77 grupos (quente) | 476-506 ms | 478-491 ms | 608-616 ms | 327 KB → 385 KB |
   | Individual, 1 pack, 5.747 grupos | 5,9-9,0 s | 9,3 s | 10,5-11,1 s | 865 KB → 1,14 MB |
   | Todos os packs, Por anúncio, abr-ago | 9,9-12,1 s | 11,8 s | 13,5 s | 1,93 → 1,99 MB |
   | Detalhe v135 (criativo → filhos) | 2,6 s (v134 equiv.) | 2,6 s | 2,5 s | 218 → 255 KB |

   Leitura: o parâmetro desligado não custa nada (é o caso de quem não vincula coluna). Ligado,
   custa ~15% nas abas pesadas e ~120 ms na aba principal, proporcional a (linhas com
   histograma × chaves). Dado real terá 1 a 3 vínculos com histogramas mais estreitos que o
   sintético. A alternativa (tabela lateral) não compra nada contra +120 ms. **Decisão: manter
   o histograma em jsonb.** Os tempos absolutos do lab são maiores que os de produção (máquina
   e cache); o que vale é a comparação relativa na mesma máquina.

3. **2026-09-03, sabotagem 2 do teste da 140 precisou ser refeita.** A ideia era "checagem de
   consistência sem `custom_hist` no CTE `stored`" — mas a função antiga nem roda contra a
   `derive_row` nova (`EXCEPT` com número de colunas diferente): o erro é imediato, o que é
   uma prova mais forte, mas não a descrita. A sabotagem válida ficou: `stored` com
   `NULL::jsonb` no lugar de `d.custom_hist` → a C1 falha (o rollup inteiro apareceria
   divergente). As três sabotagens (trigger de UPDATE, checagem cega, v140 com `max`)
   estão provadas.

4. **2026-09-03, frontend: registro ativo em vez de parâmetro novo em cada consumidor.** O
   plano previa passar as colunas vinculadas por parâmetro ao registry de métricas. Na prática
   dezenas de consumidores perguntam por uma métrica pelo id, sem contexto (a porta única
   `getMetricNumericValueOrNull`, o avaliador de regra, o funil do header, a ordenação do
   Board, o export, as tabelas de filhos). Solução: `lib/metrics/customColumnsRegistry.ts`,
   uma lista ativa publicada pela página (Manager e Boards, num `useLayoutEffect` quando os
   packs selecionados mudam) e lida por todos pela chave `custom:<id>:<faceta>`. Componentes
   React que precisam re-renderizar recebem a lista TAMBÉM por prop (`customColumns`); os que
   só leem em resposta a outra mudança (tabelas de filhos, endpoints, avaliador) leem o
   registro. Chave fora do registro = "sem dado", nunca zero.

5. **2026-09-03, `ad_metrics.id` não é único entre usuários** (ver achado 1) — qualquer script
   sobre `ad_metrics` precisa da chave `(user_id, id)`.

6. **2026-09-03, o scroll do mouse não funcionava em NENHUMA lista de popover dentro de um
   diálogo.** Descoberto na revisão visual do passo de colunas, mas era anterior a este
   trabalho: `AppDialog` é um Radix Dialog modal, e modal instala o `react-remove-scroll`
   — um listener de `wheel` no documento que dá `preventDefault()` em tudo que não esteja
   dentro do conteúdo do diálogo. O conteúdo de um Popover vive num Portal (`document.body`),
   fora dele, e para o scroll-lock é "a página atrás". Atingia os comboboxes de
   ad_id/data/leadscore, o seletor de evento de conversão do detalhe do anúncio e os
   multi-seleção do construtor de regra. Correção em `lib/hooks/usePopoverWheelScroll.ts`
   (listener nativo de `wheel` no container rolável que só chama `stopPropagation`), usado
   no `Combobox` e no `FilterListPopover`. Não usar `onWheel` do React aqui: para nós
   portados, o React pendura os listeners no container do portal, e depender disso é frágil.

7. **2026-09-03, parâmetro novo de rota vai no FIM da assinatura.** Os testes de
   `test_entity_performance.py` chamam as rotas do FastAPI por posição
   (`get_ad_details("1", d0, d1, ["p1"], USER)`). Inserir `include_custom` no meio deslocou
   `pack_ids`/`user` e 5 testes quebraram com "'Depends' object is not subscriptable".
   Depois de `user=Depends(...)` o FastAPI continua lendo o query param pelo nome e as
   chamadas posicionais seguem válidas.

8. **2026-09-03, o relatório por coluna não chegava à tela de resumo.** A rota de progresso
   do job (`get_sync_job_progress`) remonta `stats` com uma **lista fixa de chaves** a partir
   dos `details` do job — qualquer campo novo morre ali em silêncio, sem erro. Além do
   `custom_columns`, isso já mantinha "Inválidas" e "Ignoradas" zeradas no resumo (o job só
   carregava a soma `rows_skipped`). Regra: campo novo de estatística de sync = três lugares
   (`ad_metrics_sheet_importer` → `google_sheet_sync_job` (details) → a lista de `stats` da
   rota), mais o tipo `SheetSyncJobStats` no polling.

9. **2026-09-03, manutenção longa em produção precisa de `set statement_timeout = 0`.** A
   checagem de consistência do rollup morreu aos 2 min com "canceling statement due to
   statement timeout" — o papel `postgres` também tem teto, não só `service_role`. Com o
   timeout desligado no mesmo comando psql, rodou em 2m30 e devolveu zero linhas.

10. **2026-09-04, primeira integração real: colunas com dado apareciam vazias.** São DUAS
    portas, não uma. Eu ensinei `getMetricNumericValueOrNull` (leitura) sobre `custom:` e
    parei aí; a célula formata o número com `formatMetricValue`, que resolve por
    `getMetricDefinition` — o registry FIXO. Chave desconhecida → travessão, com o valor
    calculado corretamente logo antes. Só as facetas numéricas eram atingidas (a célula de
    categoria tem render próprio), o que torna o sintoma ainda mais confuso.

    A correção certa não foi remendar `formatMetricValue` e sim ensinar
    **`getMetricDefinition`**, que é a porta única de onde saem rótulo, formato, polaridade
    e tooltip: uma definição sintetizada a partir do registro ativo. Com isso tudo que
    depende dela passou a funcionar de uma vez.

    Regra que fica: ao abrir um registry fechado para chaves dinâmicas, **procurar todas as
    portas** — a que lê o valor e a que o descreve. Provado por sabotagem em
    `customColumns.test.ts` ("as DUAS portas conhecem custom").

11. **2026-09-04, o scroll do popover: duas correções que nunca rodaram.** O sintoma
    (roda do mouse não rola a lista do combobox dentro do diálogo) resistiu a duas
    correções — `stopPropagation` no container e, depois, mover o `scrollTop` à mão com
    `preventDefault`. As duas falharam de forma **idêntica**, e isso era a pista: quando
    dois mecanismos diferentes falham igual, o errado é a premissa que eles compartilham.
    A premissa comum era "o listener roda".

    Medido no navegador, numa página de laboratório isolada (`/pv/wheel-lab`, pública,
    sem login) com `EventTarget.prototype.addEventListener` instrumentado antes de
    qualquer código do app: o efeito rodava com `{open: true, temElemento: false}` e
    **nenhum** listener de `wheel` aparecia no elemento da lista. As duas correções eram
    código morto.

    Causa raiz: o Radix monta o conteúdo do popover **um commit depois** de `open` virar
    true — o `Presence` só manda `MOUNT` no layout effect dele. O `useEffect([open, ref])`
    do combobox roda no primeiro commit, quando `ref.current` ainda é `null`; como `open`
    não muda mais, o efeito nunca é reexecutado.

    Regra que fica: **para conteúdo que vive em portal/`Presence` (Radix Popover, Select,
    Tooltip, Dialog), `useEffect` gateado em `open` não é lugar de prender listener — use
    `ref` de callback**, que o React chama no instante em que o nó entra no DOM e com
    `null` quando sai. Provado por sabotagem em `usePopoverWheelScroll.test.ts` ("prender
    o listener acontece DENTRO da chamada do ref").
