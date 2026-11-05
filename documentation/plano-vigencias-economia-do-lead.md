# Plano: vigências na economia do lead (conversão por data de captação)

Data: 2026-11-02. Estado (2026-11-05): **F0 a F4 FEITAS; migration 184 aplicada; falta a P1 e a F5. Nada commitado nem deployado.**

Continua o [plano-economia-do-lead.md](plano-economia-do-lead.md). Decisões numeradas a
partir de **D33** (lá, a última é a D32 — que aparece duas vezes por engano: ajustes do
cálculo e CPL Real/CPL Max).

---

## 1. Por que

A conversão por faixa de nota é medida **por turma de captação**: compradores ÷ leads que
entraram naquela semana. A turma da Semana 1 converte diferente da turma da Semana 2.

Hoje o pack tem **um** conjunto de taxas. Um pack com duas semanas de dados aplica as taxas
da Semana 2 também aos leads da Semana 1. Para enxergar certo, o usuário precisa filtrar o
período no Manager e trocar as taxas no cadastro a cada troca de semana. É lento, dá erro
e, no fim, o pack inteiro nunca fica certo de uma vez.

**Depois:** o cadastro guarda as taxas de **todas as semanas**. Qualquer período escolhido
no Manager (uma semana, duas, o mês) usa a taxa certa para os leads de cada dia, sem trocar
nada.

**Premissas confirmadas pelo idealizador (2026-11-02):**
1. A taxa de uma semana vale para os leads **captados** naquela semana, mesmo que a venda
   aconteça depois.
2. A data gravada em cada nota (`ad_performance_daily.date`, vinda da coluna de data da
   planilha) é o **dia em que o lead entrou**.

## 2. O que muda para quem usa

| Onde | Hoje | Depois |
|---|---|---|
| Cadastro do pack | Produtos + uma lista de faixas | Produtos + **uma lista de faixas por vigência** ("a partir de dd/mm") |
| Manager | Uma taxa para todos os leads da linha | Cada lead usa a taxa da vigência do dia em que entrou |
| Linha de média, resumo do topo | Idem | Idem, somando por vigência |
| Modal do anúncio | Conta aberta por faixa | Conta aberta por faixa **dentro de cada vigência** |
| Pack sem vigências | — | **Nada muda**: mesmo documento, mesma conta, mesmo número |

## 3. A ideia: vigência é um corte no tempo, como a faixa é um corte na nota

As faixas já são **cortes contíguos**: a primeira não tem piso, cada corte abre uma faixa
nova. Não existe buraco nem sobreposição por construção (premissa 1 do plano original).

A vigência segue a mesma regra, no tempo:

- A **primeira vigência não tem data de início** ("até o próximo corte").
- Cada vigência seguinte tem só uma **data de início**; ela vale até a véspera da próxima.
- A última vale para sempre, até alguém criar outra.

Exemplo do Eu Investidor: `Semana 1 (sem início)` · `Semana 2 (a partir de 13/10)` ·
`Semana 3 (a partir de 20/10)`.

**Por que assim, e não "de dd/mm a dd/mm":** com início e fim livres, aparecem dias fora de
qualquer vigência (buraco) e dias em duas (sobreposição). O "dia sem taxa" teria que sair
da conta do teto — mas o gasto dele continua no CPL, e aí **teto e margem passam a
discordar** (o invariante `margem ≥ meta ⇔ CPL ≤ teto` quebra). Com cortes contíguos, todo
lead tem exatamente uma taxa e o problema não existe. (Na conversa de 2026-11-02 eu tinha
falado em "dia fora de vigência fica de fora com aviso": esta regra substitui aquela.)

**O que varia por vigência:** só as **faixas** (cortes de nota, produto e conversão). A
faixa inteira, e não só a conversão, porque o idealizador já juntou faixas (240+) e outra
semana pode pedir outros cortes.

**O que NÃO varia (v1):** produtos (ticket, sobra, margem) e os ajustes D32 (fatia do
tráfego, imposto, cobertura de vendas). São do negócio, não da turma. Ver pergunta aberta
na seção 10.

## 4. Dados

Mesmo campo `packs.lead_economics` (jsonb) — **sem migration de tabela**.

```json
{
  "products": [ { "id": "p1", "name": "Eu Investidor", "ticket": 2570, "contribution_margin": 0.77, "target_margin": 0.40 } ],
  "bands": [ { "min": null, "product": "p1", "conversion": 0.003 }, { "min": 240, "product": "p1", "conversion": 0.0197 } ],
  "periods": [
    { "start": "2026-10-13", "bands": [ { "min": null, "product": "p1", "conversion": 0.004 }, { "min": 240, "product": "p1", "conversion": 0.0210 } ] }
  ],
  "pack_spend_share": 0.8, "ad_tax": 0.1383, "sales_coverage": 0.8
}
```

- **A primeira vigência são as `bands` da raiz** (a que não tem data de início);
  `periods` lista só as **seguintes**, cada uma com `start`. (Revisto na F1: o rascunho
  do plano punha a primeira dentro de `periods` com `start: null`. Assim, o documento de
  antes da D33 já é um cadastro de uma vigência, sem regra de "`bands` ou `periods`".)
- **Compatibilidade (mesma técnica da D32):** sem vigência seguinte, o canônico não grava
  `periods` (nem vazio). Os documentos já salvos não mudam um byte.
- `start`: `AAAA-MM-DD` de um dia que existe (ano de 1000 em diante), no fuso da conta de
  anúncios (o mesmo de `date` no rollup). Estritamente crescentes, com a mesma postura dos
  `min` das faixas (uma data inválida no meio não apaga a última válida).
- Cada vigência valida as faixas com as regras de hoje (D31: sem teto de quantidade). O
  validador continua linear no tamanho do documento.
- **Sem nome de vigência no v1:** a aba mostra a data ("Início", "A partir de 13/10").
- **Chave D20** (a que decide se dois packs têm "o mesmo cadastro", usada pela linha que
  junta packs): passa a incluir as vigências. Sem vigências, é a chave de antes.

## 5. A conta

Para uma linha do Manager, cada vigência `j` tem `L_j` leads com nota e calcula, com as
faixas dela, os valores **por lead** de hoje: `R_j`, `K_j`, `Teto_j`, `Meta_j`.

| | Fórmula |
|---|---|
| Faturamento por lead `R` | `Σ_j L_j · R_j ÷ Σ_j L_j` |
| Contribuição `K`, Teto, Meta | idem, ponderados por `L_j` |
| CPL Real | gasto total ÷ `Σ_j L_j` (como hoje) |
| Margem | `(K − CPL) ÷ R` (como hoje) |

Como tudo é somado com o mesmo peso (leads), o invariante continua valendo. Com uma
vigência só, cada fórmula cai **exatamente** na de hoje. É a mesma regra da linha de média
(D27), aplicada dentro da linha.

**Gasto:** fica inteiro, não é dividido por vigência. Ele já é a soma do período escolhido;
a vigência só decide **quanto vale** cada lead.

## 6. Onde o dado nasce: o banco

**Hoje:** a RPC (função no banco) do Manager monta o histograma (nota → quantidade de leads)
de cada linha no CTE `leads_by_group`. Ela lê `ad_performance_daily` (o rollup diário:
uma linha por pack, anúncio e dia, com `lead_scores`/`lead_qtys`) e soma **o período
inteiro**. A data se perde aí. Lido em `schema.sql`, `fetch_manager_rankings_v162`; a
cadeia viva precisa ser confirmada no banco (F0), porque o `schema.sql` defasa.

**Proposta:** parâmetro novo `p_lead_period_starts date[]`, a lista ordenada de **todas**
as datas de corte dos packs selecionados (a união). Com a lista vazia ou nula, a RPC faz
exatamente o que faz hoje. Com a lista, ela devolve também
`leadscore_histogram_by_period`: um histograma por **trecho** entre cortes.

- O trecho de cada dia é "quantos cortes são ≤ esse dia" — uma conta, sem leitura nova. O
  `group by` do CTE ganha uma coluna.
- **Por que a união serve para vários packs:** ela corta o tempo em pedaços menores que as
  vigências de qualquer pack. Cada pedaço cai inteiro dentro de uma vigência de cada pack, e
  o navegador sabe qual. O SQL não precisa conhecer a economia: continua só contando leads.
- `leadscore_histogram` (o total) continua vindo igual, para o MQL, o leadscore médio e
  tudo o que já o usa.

**Custo esperado:** só o pedaço de leads da resposta cresce, e só para quem tem vigências.
Com 6 semanas, até 6 histogramas por linha em vez de 1. No Manager o histograma é uma
fração pequena da resposta, mas **isto se mede, não se supõe** (F0). Regra da memória
"Produção é disco e memória": tempo se mede no plano de produção, memória no laboratório
(resposta grande ocupa ~11× em RAM).

**Rejeitado — uma consulta por vigência, juntando no navegador:** não mexe no SQL, mas
multiplica as chamadas da tela mais cara do app (N vigências = N RPCs completas, e a
agregação inteira roda antes do limit — memória "Custo da RPC do Manager").

**Rejeitado — devolver o histograma de cada dia:** o navegador escolheria a vigência, mas a
resposta cresceria com o número de dias (30 dias = 30×), para todo mundo, inclusive quem
não usa.

## 7. Cadastro (tela)

- O bloco "Quem compra" (faixas) ganha um **seletor de vigência** no topo:
  `Semana 1 · Semana 2 · + Nova vigência`. Abas de 32px, `state-pressed` na ativa.
- **Rótulo da aba:** a data ("Início"; "A partir de 13/10"). Nome livre ficou fora do v1.
- **"+ Nova vigência"** pede a data de início e **copia as faixas da vigência anterior**:
  o caso comum é trocar só as taxas.
- A importação de CSV cai **na vigência aberta**.
- Remover uma vigência junta os dias dela com a anterior. A primeira não se remove; se é a
  única, a tela fica igual à de hoje, sem seletor, com o botão "+ Nova vigência" discreto.
- O teto ao vivo de cada faixa (o que já existe) mostra o da vigência aberta.

## 8. Exibição

- **Célula do Manager:** mesmo número, mesma cor. O tooltip ganha uma linha quando a linha
  cruza vigências: "Leads de 2 vigências: Semana 1 (120), Semana 2 (80)".
- **Modal do anúncio** (`LeadEconomicsBreakdown`): uma tabela de faixas por vigência e o
  total ponderado embaixo. Com uma vigência, igual a hoje.
- **Link público:** guarda os números já calculados, como hoje. Confirmar na F0 que o
  snapshot sai do resultado e não refaz a conta.
- **Linha "mista"** (D27, a que junta packs com cadastros diferentes): mesma regra, com a
  chave D20 incluindo as vigências.

## 9. Testes (filosofia do projeto: todo teste sabotado de propósito)

- **Diferencial no banco** (no laboratório e depois em produção, só leitura): para cada
  pack real, `Σ` dos histogramas por trecho = `leadscore_histogram`, nota a nota. E, sem o
  parâmetro, a resposta da RPC nova é **idêntica** à da atual.
- **Diferencial no navegador:** com uma vigência, o resultado é idêntico ao de hoje em
  todos os casos da fixture compartilhada.
- **Conta com duas vigências**, conferida contra um cálculo feito à mão (como o teste (o)
  da D32), e o invariante teto × margem em 1.000 casos aleatórios.
- **Paridade TS × Python** na validação de `periods`, pela fixture gerada.
- **Sabotagens previstas:** trecho calculado com `<` em vez de `≤` (o lead do dia do corte
  cai na semana errada); a união perdendo um corte de um dos packs; a chave D20 sem as
  vigências; o canônico gravando `periods` com uma vigência só; o CSV importando para a
  primeira vigência em vez da aberta; o total vindo do histograma por trecho em vez do
  original.

## 10. Pergunta aberta (não bloqueia a F0)

**A "cobertura de vendas" (D32, % das vendas com leadscore) muda por semana?** Ela depende
de quantos compradores casaram por e-mail, o que pode variar por turma. O v1 a mantém única
no pack. Se variar muito, ela vai para dentro da vigência numa fase seguinte. O documento
comporta isso sem quebrar o que já estiver salvo.

## 11. Fora do v1

- Produtos e ajustes por vigência (ver seção 10).
- Sparkline de teto e margem (já fora do v0: exigiria a série diária no SQL).
- Vigência automática a partir do nome da campanha (EI.31, EI.32…).
- Taxa medida da planilha (D1 do plano original).

---

# Plano de implementação

Legenda: `[ ]` não iniciado · `[~]` em andamento · `[x]` concluído · `[-]` descartado.

## F0 — Rastrear e medir (não muda produção) — FEITA em 2026-11-03

- [x] **Cadeia viva do Manager:** `/rankings` → `fetch_manager_rankings_v170` (padrão de
  `ANALYTICS_MANAGER_COLUMNS_RPC` em `config.py`; sem sobrescrita no `.env` da VPS nem no
  container). Voltas atrás configuráveis: v162, v161 e `core_v2` → `performance_base_v155`.
  O histograma nasce em `leads_by_group` (rollup `ad_performance_daily`) e vai à linha pelo
  dicionário `leads_dict`.
- [x] **Caminhos que alimentam uma conta de economia:**
  - Manager (linhas, média, resumo, regra, export CSV, link público): a resposta da v170.
    O link público e o CSV usam os resultados já calculados na linha, sem SQL próprio.
  - Modal do anúncio e tabela de filhos (`/rankings/.../details`, `/children`):
    `fetch_entity_performance_v171` (padrão de `ANALYTICS_ENTITY_RPC`). Ela **já devolve
    os leads por dia** (`days[].leads`), mas só nos últimos `p_series_days` dias. Com
    `p_series_days = null` vêm todos os dias, porém com todas as métricas de cada dia.
    Decidir na F2 entre o mesmo parâmetro de cortes (simetria com a v170) e reaproveitar os dias.
  - Série diária (sparkline): não calcula economia. Fora.
  - **Volta atrás (v162/v161/v155) não terá o histograma por trecho:** pack com 2+
    vigências deve ficar **indisponível** nesse caso, nunca calcular com uma taxa só.
- [x] **Medição em produção** (só leitura; a conta isolada de `leads_by_group`, que é o
  único pedaço que muda; cortes espalhados por igual no período). Tamanho do histograma
  (jsonb):

  | Caso | Linhas | Hoje | 3 trechos | 6 trechos | 12 trechos |
  |---|---|---|---|---|---|
  | EI.29 (maior pack, 1 mês), por nome | 73 | 29 kB | 46 kB | 59 kB | 82 kB (2,85×) |
  | EI.32 (o com economia), por nome | 312 | 48 kB | 66 kB | 77 kB | 92 kB (1,93×) |
  | MDV Perpétuo (8 meses), por nome | 274 | 9 kB | 15 kB | 16 kB | 18 kB (2,03×) |

  **Pior caso:** usuário inteiro (32 packs, 44.730 anúncio-dias com lead, 14 meses), **por
  anúncio** (27.816 linhas), com **63 trechos** (vigência semanal no período todo):
  histograma de 2,47 MB → 3,08 MB (**1,25×**, +0,6 MB). A resposta inteira desse caso é
  da ordem de 55 MB (medida da 161), então o acréscimo é ~1% dela. Tempo da conta
  isolada, 3 rodadas: 0,85–0,91 s → 0,99–1,02 s (**+0,1 a 0,17 s**).
  - Por que cresce bem menos que N×: cada anúncio vive poucas semanas, então cai em poucos
    trechos, e cada trecho tem menos notas distintas.
  - **Prova:** a soma dos trechos bate com o histograma de hoje, nota a nota, em todos os
    casos (0 divergências). Sabotada: descartando um trecho, aparecem 433 divergências.
  - Script: `f0_measure.sql` (scratchpad da sessão; reescrever na F2 como teste do lab).
- [x] **Laboratório:** não usado na F0. Ele parou na migration 134 e não tem a v170. A
  medida em produção foi possível porque a conta isolada é pequena e só lê o rollup. A
  **memória** da RPC completa se mede no lab na F2, depois de atualizar o lab.
- [x] **Parada P0:** números mostrados ao idealizador em 2026-11-03; aprovou seguir.

## F1 — Contrato (TS + Python + fixture) — FEITA em 2026-11-03 (não commitada)

- [x] `periods` no `validateLeadEconomics` e no espelho Python (`_check_bands` extraído
  nos dois lados); mensagens `periodStart` e `periodStartNotIncreasing`.
- [x] Conta por vigência: a linha carrega `leadscore_by_period = { cuts, histograms }` (o
  formato que a F2 vai produzir). `periodCountsFromSplit` leva cada trecho à vigência dele;
  `computeFromPeriodCounts` faz a conta de cada uma e pondera pelos leads. Sem vigências,
  o caminho é o de antes, intocado.
- [x] **Dois motivos de célula vazia, porque são duas situações diferentes** (revisto a
  pedido do idealizador: a primeira versão dizia "recarregue a página" para as duas, o que
  instruía errado):
  - `period-split-stale` — os trechos vieram de uma consulta de ANTES da última edição das
    vigências. É transitório: a consulta nova já está a caminho. Texto: "Atualizando com as
    vigências novas…". **F3: desenhar como carregando, não como vazio.**
  - `no-period-split` — os trechos não vieram (volta atrás da RPC) ou vieram fora da forma.
    É falha do sistema; o usuário não tem o que fazer, e a mensagem diz isso: o número fica
    de fora porque, sem a separação, sairia com uma taxa só; o cadastro está certo. Ícone
    de alerta, como os vazios estruturais. **F3: registrar no Sentry.**
  - Trecho fora da forma (cortes fora de ordem, trecho `""`, `" 1"` ou além do último
    corte) cai no segundo, nunca em "nenhum lead com nota no período".
  - A média conta as duas em `excludedNoPeriodSplit`. `computeLeadEconomicsForRows` (soma
    de contagens, D17) devolve null com vigências.
- [x] **Mensagens de validação dizem QUAL vigência** (mesma revisão): "A vigência 2 precisa
  de uma data de início válida."; "A vigência a partir de 13/10/2026 precisa começar depois
  da anterior, sem repetir o dia."; e todo erro de faixa de uma vigência seguinte ganha a
  vigência na frente ("Na vigência a partir de 13/10/2026: a conversão de cada faixa…").
  Sem isso, a frase não dizia em qual aba estava a faixa errada. A primeira vigência mantém
  as frases de antes. Data por fatia de texto (DD/MM/AAAA) nos dois lados, sem fuso nem idioma.
- [x] Chave D20 com as vigências; sem vigências, a chave é byte a byte a de antes (teste).
- [x] Fixture: 184 casos (26 novos de vigência, incluindo dígito árabe-índico, que o `\d`
  do Python aceitaria). Paridade TS × Python verde.
- [x] Testes (q)–(u) em `leadEconomics.test.ts`: conta à mão com duas vigências e o lead do
  dia do corte; 300 casos em que vigências com as mesmas faixas dão o número de uma só;
  invariante teto × margem em 500 casos; indisponibilidade; chave.
- [x] **18 sabotagens, 18 pegas** (as 12 da primeira rodada, mais 6 da revisão das mensagens: numeração, vigência na frente do erro, item fora da forma na numeração (TS e Python), trecho velho tratado como falha, trecho fora da forma tratado como "sem lead") (lead do dia do corte na vigência errada; conta pelo
  histograma total; teto sem ponderar; linha sem trecho passando; trecho velho na conta
  direta; chave sem vigências; canônico com `periods` vazio, em TS e em Python; data fora
  de ordem, em TS e em Python; `\d` Unicode e 30 de fevereiro no Python). Uma 13ª sabotagem
  foi descartada por ser inválida: trocava só a chave do cache, e a conta seguia certa.
- **Atenção — F1 e F4 sobem juntas:** o rascunho do editor (`leadEconomicsToDraft`) ainda
  não conhece `periods`. Um pack com vigências gravado por API, aberto e salvo no editor
  atual, perderia as vigências. Nada na tela cria vigência antes da F4.

## F2 — Banco e backend — FEITA em 2026-11-03 (migration aplicada; backend não deployado; não commitada)

- [x] **Migration 184** (`184_leads_por_vigencia.sql` + `184_rollback.sql`), gerada das
  definições VIVAS da v170 e da v171 (não do `schema.sql`). Número conferido contra os
  arquivos, o banco e o worktree do chat (que parou na 178).
  - `fetch_manager_rankings_v184`: `p_lead_period_starts date[]`; CTE `leads_by_period` só
    com cortes; pedaço novo `leadscore_by_period` (`{trecho: {nota: qtd}}`, `{}` para a
    linha sem lead, nunca null) só com cortes.
  - `fetch_entity_performance_v184` (modal e filhos): `totals.leads_by_period`, só com cortes.
  - Os cortes NÃO voltam na resposta: o navegador usa a lista que mandou (o backend a manda
    distinta e ordenada, e o SQL a normaliza do mesmo jeito).
- [x] **Diferencial em produção, sem deixar nada no banco** (`backend/scripts/diff_v184.sql`:
  as funções novas são criadas DENTRO de uma transação que termina em ROLLBACK). 5 casos do
  Manager (1 a 2 packs; por nome, anúncio, conjunto e campanha; 1 a 4 cortes, com corte
  repetido, nulo, antes e depois dos dados) e 2 do detalhe:
  - sem cortes, a v184 é a v170/v171 **byte a byte** (todos os pedaços);
  - com cortes, a única diferença é o pedaço/campo novo;
  - soma dos trechos = histograma total, nota a nota: **0 divergências** em ~165 mil leads.
  - Sabotado: trecho 0 descartado → 620 a 1.414 divergências; pedaço novo saindo sem
    cortes → "igual" vira falso nos 7 casos.
- [x] **Custo medido** (3 packs EI por anúncio, 7 meses, 29 cortes semanais, 3 rodadas):
  v170 3,35–3,4 s; v184 sem cortes igual (3,34–3,5 s); **v184 com cortes 3,75–4,43 s
  (+0,4 a +0,9 s)**. Resposta: 13,7 MB + 0,43 MB do pedaço novo (+3%). Mais que a conta
  isolada da F0 (+0,1 a 0,17 s) porque o CTE novo refaz a junção com a seleção. Só paga
  quem tem vigência. Se incomodar: derivar o total do próprio `leads_by_period` quando há
  cortes (uma passada só).
- [x] **Backend:** `lead_period_starts` no corpo do `/rankings` (validado: ISO, distintas,
  ordenadas, no máximo 1000; inválido = 422) e como query nas rotas de detalhe e filhos
  (inválido = 400). Vai à função só se ela o conhece (`config.LEAD_PERIOD_RPCS`): a volta
  atrás para v170/v171 não quebra. Padrão novo: v184 nas duas. `leadscore_by_period` só
  aparece no item quando a consulta mandou cortes (o contrato de antes fica intacto).
  15 testes novos; 6 sabotagens, 6 pegas.
- [x] **184 aplicada em produção** em 2026-11-03 (liberada pelo idealizador). Conferido:
  `anon` sem EXECUTE; `authenticated` e `service_role` com.
- [ ] Ordem de deploy: **migration antes do backend** (o backend novo chama a v184 por padrão).

## F3 — Manager — FEITA em 2026-11-03 (não commitada)

- [x] **Cortes na consulta:** `leadEconomicsPeriodCuts` (união dos inícios de vigência dos
  packs, distinta e em ordem) e o hook `useLeadPeriodCuts(packIds)`, que lê os packs do
  store como o carimbo de frescor. Manager: `lead_period_starts` no `/rankings` só com
  planilha; filhos (por nome, conjunto, campanha) e detalhes (anúncio, criativo) pelos
  hooks. Sem vigências, `undefined`: a consulta e a **chave do cache são as de antes**
  (o cache em disco do Manager não se perde no deploy).
- [x] **Chave do cache:** os cortes entram só quando existem, antes do carimbo de frescor
  (que segue no fim). Editar a data de uma vigência muda a chave e busca de novo.
- [x] **Cortes na linha:** a RPC devolve só `{trecho: histograma}`; `attachLeadPeriodCuts`
  junta os cortes que a consulta MANDOU, no ponto único das chamadas (`endpoints.ts`).
  Linha sem o campo fica sem — `no-period-split`, nunca a taxa da primeira vigência.
- [x] **Modal:** os trechos saem da MESMA fonte do histograma (período do modal ou da linha
  do Manager); o detalhe sem trechos apaga os do Manager (`sharedAdDetail`), como já
  fazia com o histograma.
- [x] **Célula, média, resumo, regra, CSV, link:** todos já passam por
  `getRowLeadEconomics`/`aggregateRowsLeadEconomics` com a linha inteira — nada a mudar.
- [x] `period-split-stale` desenhado como carregando (célula: barra pulsando, sem
  travessão; modal: `StatePanel` de carregando). `no-period-split`: ícone de alerta,
  `StatePanel` de erro no modal e **um** aviso ao Sentry por carga da página
  (`logger.error`). O cabeçalho da média conta as linhas de `excludedNoPeriodSplit`
  ("N chegaram sem os leads separados por vigência").
- [x] Testes (v) e (w) em `leadEconomics.test.ts`, célula, modal e chave. **7 sabotagens,
  7 pegas** (cortes não embrulhados; sem ordenar; união perdendo corte; trecho velho como
  vazio; modal misturando períodos; chave sem os cortes; chave mudando sem vigência).
- Fora de propósito: Boards, Explorer e o detalhe de conjunto não mostram economia e não
  mandam cortes. O modal do anúncio aberto pelos Boards, com pack de vigências, mostraria
  a falha (`no-period-split`) — nunca número errado. Revisitar se os Boards ganharem a coluna.
- Não testado: a costura de `endpoints.ts` (mandar e embrulhar) só pelo `tsc`; a prova de
  ponta a ponta é a P1 com o backend no ar.

## F4 — Cadastro e modal — FEITA em 2026-11-05 (não commitada; falta a P1)

- [x] **Rascunho com vigências** (`LeadEconomicsDraft.periods`): ida e volta documento ↔
  rascunho é ponto fixo; sem vigência seguinte a chave nem existe (o documento é o de
  antes). Resolve o aviso "F1 e F4 sobem juntas": abrir e salvar não perde vigência.
- [x] **Uma vigência por vez na tela:** `draftPeriodView` dá às funções de faixa (rótulo,
  teto ao vivo, campo com erro, adicionar/remover, CSV) o rascunho "como se só existisse
  a aberta"; `setDraftPeriodView` grava de volta. As funções de faixa não mudaram.
- [x] **Abas** (`Tabs`, `state-pressed`): "Início" · "A partir de 13/10" · …; sem data
  ainda, "Vigência N". Uma vigência só = a tela de antes, com "+ Nova vigência" discreto.
  "+ Nova vigência" copia as faixas da ÚLTIMA e sugere a data uma semana depois dela
  (sem nenhuma, hoje). Data pelo calendário do app (o mesmo da data de fim do
  lançamento); remover junta os dias com a anterior, e a anterior fica aberta.
- [x] **CSV na vigência aberta.** Se o CSV cria o 2º produto, as faixas das outras
  vigências passam a apontar para o produto que já existia (mesma regra de "adicionar
  produto").
- [x] **Produto em todas as vigências:** adicionar prende as faixas de todas ao produto
  existente; remover pergunta para onde vão as faixas de TODAS (a lista diz a vigência:
  `"abaixo de 80" (A partir de 13/10)`).
- [x] **Erros:** os de todas as vigências aparecem no bloco das faixas, com a vigência na
  frase (F1). Data em branco só acusa depois de tentar salvar, como os outros campos.
- [x] **Corrigido de passagem:** adicionar o 2º produto apagava os ajustes digitados (fatia
  do tráfego, imposto, cobertura) — a função montava o rascunho sem eles.
- [x] **Modal:** um bloco por vigência ("Início · 15 leads com nota") e a fatia de cada
  faixa sobre os leads de TODAS, para "Entra no teto" continuar somando o CPL Max.
  **Tooltip da célula:** "Leads de 2 vigências: Início (12), A partir de 13/10 (8)".
- [x] Testes: 7 do rascunho, 1 do editor, 1 do modal, 1 do tooltip. **12 sabotagens, 12
  pegas** (a 12ª — data inválida na frase — só foi pega depois de um teste a mais).
- Não testado: trocar de aba e o calendário (o projeto não tem DOM de teste; a decisão é
  função pura, testada). Verificar no navegador na P1.
- [x] **Revisão (2026-11-05), 4 achados corrigidos:** (1) o modal aberto pelos Boards,
  Insights ou Plano (linha sem as datas) mostrava a falha — agora pede o detalhe do anúncio
  com as datas (`modalLeadEconomicsOutcome`, carregando enquanto ele vem); (2) teste da
  costura de `endpoints.ts` (mandar as datas e embrulhar a resposta, nas 7 rotas);
  (3) duas vigências com a mesma data apagavam o aviso de corte ilegível uma da outra;
  (4) a conferência dos trechos fica guardada por objeto (rodava a cada célula, filtro e
  média). 7 sabotagens, 7 pegas.
- [ ] **Parada P1:** o idealizador cadastra as semanas do Eu Investidor e compara com a
  planilha, semana a semana e no pack inteiro.

## F5 — Fechamento

- [ ] `como-funciona-o-app.md`, D33 no log do plano original, `schema.sql`/`schema_map.md`.

## Ordem de commits

1. `feat(economia-do-lead): vigências no contrato e na conta (F1)`
2. `feat(manager): histograma por trecho de vigência na RPC (F2)` — com a migration
3. `feat(manager): economia do lead por vigência no Manager (F3)`
4. `feat(packs): cadastro de vigências e conta aberta por vigência (F4)`
5. `docs: vigências da economia do lead (F5)`
