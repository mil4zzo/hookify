# Plano mestre — eficiência do carregamento de packs

**Aberto em:** 2026-09-09
**Branch:** `perf/eficiencia-carregamento` (worktree `.claude/worktrees/perf-carregamento`, base `9b001c3`)
**Origem:** investigação de 07–09/09/2026, depois do incidente dos R$ 12 mil e da queixa de
lentidão ao carregar packs relatada por um usuário em 09/09.

Este é um **documento de trabalho**. O placar da seção 2 é atualizado a cada passo — quem
retomar a tarefa lê o placar primeiro e continua de onde parou. Nada aqui é implementado
"de memória": cada item tem evidência medida, teste de aceitação e a linha de base contra
a qual o ganho é comprovado.

---

## 1. Regras do jogo

Herdadas da filosofia do projeto (`CLAUDE.md`) e do que já custou caro neste app:

1. **Medir antes e depois, com o mesmo comando.** A seção 10 traz os comandos exatos que
   produziram a linha de base. Repetir esses comandos é o único jeito honesto de dizer
   "melhorou".
2. **A frio e a quente são números diferentes.** Registrar os dois. Uma medição isolada
   num banco ocioso mente sobre a vida real.
3. **Toda troca de cálculo passa por teste diferencial** contra a implementação anterior,
   com dado de produção, antes do cutover. Sem exceção — foi o que salvou o rollup.
4. **Teste de mecanismo novo tem que ter sido sabotado de propósito uma vez.** Um teste que
   nunca falhou não provou nada.
5. **Um item por commit.** Se um deles der problema em produção, o `revert` tem que ser
   cirúrgico.
6. **Nada de "otimizar" o que não tem consumidor.** A primeira pergunta é sempre "o que
   está sendo feito que não precisava?", só depois "como fazer mais rápido".
7. **Ordem de deploy quando houver migration:** migration primeiro, backend depois — a menos
   que a nota do item diga o contrário e explique por quê.

### Convenção do placar

| marca | significado |
|---|---|
| ⬜ | não começou |
| 🟡 | em andamento |
| ✅ | implementado, testado e medido |
| 🚢 | em produção, com o ganho confirmado no ambiente real |
| ⏸️ | parado à espera de decisão do idealizador |
| ❌ | descartado (com o porquê registrado no item) |

---

## 2. Placar

| # | Item | Esforço | Ganho esperado | Risco | Estado |
|---|---|---|---|---|---|
| **F1** | Varredura de `ads` por OFFSET → filtro pelos ids pedidos | ~1 h | −350 s/dia de banco, −47 requisições por refresh | nenhum | ⬜ |
| **F2** | Grafo de conflito: 6 s a cada refresh | ~1 tarde | −1,2 a 6 s de disputa, ~60×/dia | baixo | ⬜ |
| **F3** | Linha-zero sintética nunca sobrescreve linha real | ~2 h | zero de velocidade — fecha a classe de bug dos R$ 12 mil | baixo | ⬜ |
| **F4** | Página de 1.000 + espera guiada pelo cabeçalho da Meta | ~meio dia | −5% no refresh incremental, −14% na recarga completa | baixo | ⬜ |
| **F5** | Inventário fora de `ad_metrics` (fim das linhas-zero gravadas) | ~1 semana | tabela 4× menor; resolve o F2 de graça | **alto** | ⏸️ |
| **M1** | `thumbnail-cache` devolvendo 404 — 267× em 10 h | ? | ruído + requisição inútil em laço | ? | ⬜ |
| **M2** | `AD_METRICS_IMPORT` falha ao parsear data — 230× em 10 h | ? | dado da planilha possivelmente perdido | ? | ⬜ |
| **M3** | `deque mutated during iteration` no logger de uso — 5× em 10 h | ? | perde registro de uso da API da Meta | ? | ⬜ |
| **M4** | Quedas transitórias de HTTP/2 — 69× em 10 h | — | já absorvidas pelo retry; só monitorar | — | 📊 |
| **M5** | 7–9 refreshes por pack por dia | decisão | −60% de leitura da Meta se cair para 3–4 | — | ⏸️ |

**Ordem recomendada:** F1 → F2 → F3 → F4 → (decisão sobre F5) → M1/M2/M3.

F1 e F2 são os que atacam a queixa de lentidão de 09/09. Nenhum dos dois toca em como o
dado é calculado.

---

## 3. Linha de base — produção, 2026-09-09

Tudo aqui foi medido, não estimado. Os comandos estão na seção 10.

### 3.1 Tamanho do dado

| Tabela | Total | Linhas | Observação |
|---|---|---|---|
| `ad_metrics` | **1.018 MB** | 695.089 | **567.351 (81,6%) são zeros sintéticos** |
| `ad_performance_daily` | 581 MB | 691.946 | read model do rollup |
| `ads` | 533 MB | 63.422 | 276 heap + 173 TOAST + 83 índices |
| `ad_metric_pack_map` | 270 MB | 695.089 | 660.682 delas de um único usuário |

Índices de `ad_metrics` depois da migration 145: **169 MB** (eram 233 MB antes).

### 3.2 Consultas mais caras (`pg_stat_statements`, desde 26/08 — 14 dias)

| Posição | O quê | Chamadas | Média | **Total** |
|---|---|---|---|---|
| 1 | `SELECT campaign_id, adset_id FROM ads WHERE user_id=$1 LIMIT/OFFSET` | **175.008** | 26–35 ms | **5.011 s** |
| 2 | `fetch_manager_rankings_core_v2` (várias formas) | 6.775 | 203–3.577 ms | 3.588 s |
| 3 | `detect_pack_conflicts` | 485 | 2.217 ms | **1.075 s** |
| 4 | `batch_update_ad_metrics_enrichment` | 3.767 | 259 ms | 977 s |
| 5 | `INSERT INTO ad_metrics` (upsert) | 7.467 | 98 ms | 729 s |

### 3.3 Latência ao vivo

| Operação | A frio | A quente |
|---|---|---|
| Manager (`core_v2`, ad_name, 1 pack, 40 dias) | 2.414 ms | **907–937 ms** |
| `detect_pack_conflicts` (38 packs, 660.682 linhas do mapa) | **6.058 ms** | 1.205 ms (2ª: 3.937 ms) |
| Página de `ads` no OFFSET 0 | 2,0 ms | — |
| Página de `ads` no OFFSET 20.000 | 34,3 ms | — |
| Página de `ads` no OFFSET 40.000 | 59,0 ms | — |
| Página de `ads` no OFFSET 60.000 | 53,7 ms — **22.151 buffers para devolver 0 linhas** | — |

> O Manager **não regrediu** com a migration 145: o laboratório previa 1,38–1,41 s a quente
> e a produção entrega 0,91 s. A leitura está melhor que o previsto.

### 3.4 Saúde dos jobs

| Métrica | Valor |
|---|---|
| Jobs em 48 h | 206 completos, **1 falha**, 1 cancelado |
| Refreshes por pack em 24 h | **7 a 9** (7 packs `EI.31`) |
| Incremental típico | 131 s / 3.566 linhas |
| Incremental pesado (CA4) | 256 s / 8.634 linhas |
| Todo o período | 289 s / 19.810 linhas |

### 3.5 Ruído no log (10 h)

| Evento | Contagem |
|---|---|
| `thumbnail-cache` → HTTP 404 | **267** |
| `AD_METRICS_IMPORT` falha ao parsear data | **230** |
| Retry transitório de HTTP/2 (`RemoteProtocolError`) | 69 |
| `deque mutated during iteration` | 5 |

### 3.6 Constantes do coletor (hoje)

```python
MAX_PAGES   = 100    # teto de 50.000 linhas
PAGE_LIMIT  = 500
PAGE_DELAY_S = 1     # espera cega entre páginas
```

---

## 4. F1 — a varredura de `ads` por OFFSET

**Estado:** ⬜

### O que acontece

`backend/app/services/supabase_repo.py:677` — `_fetch_present_parent_ids(sb, user_id)`.
Chamada em `:800`, dentro de `upsert_parent_entities`, que roda em **todo refresh** e no
**sync on-focus** (a cada 5 min por pack).

Para responder "quais campanhas e conjuntos têm anúncio importado?", ela baixa as
**46.581 linhas de `ads` do usuário**, de mil em mil, e descarta tudo menos duas colunas.

O agravante é a forma da paginação. `.range(offset, offset+999)` do PostgREST vira
`LIMIT/OFFSET`, e o Postgres precisa **produzir e jogar fora** tudo que veio antes:

```
OFFSET      0 →  2,0 ms
OFFSET 20.000 → 34,3 ms
OFFSET 40.000 → 59,0 ms
OFFSET 60.000 → 53,7 ms, 22.151 buffers lidos, 0 linhas devolvidas
```

Uma varredura completa: **47 páginas, ~1,4 s de banco, 47 idas e voltas HTTP**.

O custo já era conhecido — há um comentário em `:922` explicando que outro caminho evita
essa varredura de propósito ("medido: 65 ms × 71 páginas"). O que faltava era notar que
ela é o **maior consumidor do banco inteiro**: 5.011 s em 14 dias, 358 s/dia.

### Por que é desperdício, não lentidão

Quem chama já **tem em mãos** os ids que quer testar: o `entities` que veio da Meta, com as
campanhas e conjuntos do snapshot. O laço seguinte faz `if eid not in present: continue`.
Ou seja: só interessa saber a presença **dos ids perguntados** — nunca a lista completa.

### O que fazer

Trocar a varredura por consulta filtrada pelos ids pedidos:

```python
def _fetch_present_parent_ids(sb, user_id, campaign_ids, adset_ids) -> Tuple[set, set]:
    # lotes de 200 ids por causa do limite de URL do PostgREST
    # (memória: supabase_in_clause_url_limit)
```

Índices que já existem e servem: `ads_campaign_idx (campaign_id)` e
`ads_user_adset_idx (user_id, adset_id)`.

### Teste de aceitação

1. **Diferencial obrigatório.** Script que roda a versão antiga (varredura) e a nova
   (filtrada) para o mesmo `user_id` e afirma que
   `nova ∩ perguntados == antiga ∩ perguntados`, **conjunto a conjunto**, para os 3 usuários
   de produção. Sem isso, não vai.
2. `EXPLAIN (ANALYZE, BUFFERS)` da consulta nova com um lote real de ids — anexar o plano
   ao commit. Se não for index scan, o índice está errado e é preciso resolver antes.
3. Teste unitário com lote > 200 ids, provando que o loteamento não perde id.
4. Teste unitário com lista vazia (não pode disparar consulta).

### Como comprovar o ganho

Depois de 24 h em produção, repetir a consulta 10.2 do apêndice: a linha
`SELECT campaign_id, adset_id FROM ads ...` deve **parar de crescer** em `calls`. Comparar
`total_exec_time` acumulado.

### Riscos

Nenhum identificado. A semântica é comprovadamente equivalente para o único consumidor.
**Atenção:** se algum dia surgir um segundo consumidor que precise da lista completa, ele
não pode reintroduzir a varredura — a assinatura nova, que exige os ids, é a proteção.

---

## 5. F2 — o grafo de conflito refeito a cada refresh

**Estado:** ⬜

### O que acontece

`public.detect_pack_conflicts(p_pack_ids, p_actor_id)` (migration 146) varre as
**660.682 linhas** de `ad_metric_pack_map` do usuário, agrupa por `(ad_id, metric_date)` e
procura grupos com mais de um pack — **mesmo quando não há nenhum conflito** (hoje: zero).

Medido em 09/09 com os 38 packs reais:

```
a frio ..... 6.058 ms   (254.329 buffers + 12.349 leituras; 130 MB de arquivo temporário)
2ª vez ..... 3.937 ms
a quente ... 1.205 ms
```

A migration 146 documenta ter medido 2,4 s a frio. O dado cresceu desde então.

### Por que ficou caro agora

Até a migration 145, packs do **mesmo dono** nunca conflitavam — eles liam a mesma linha
física de `ad_metrics`, então somar não duplicava. Desde a 145 cada linha pertence a um
pack, e a regra passou a valer para **qualquer par**. A 146 então tirou o pré-filtro por
metadado (que era inseguro e escondia conflito real) e deixou a varredura agrupada.

Ambas as decisões estão certas. O que não foi previsto foi a **frequência**.

### O agravante da frequência

`frontend/lib/hooks/usePackConflicts.ts` põe `computePacksContentStamp(packs)` — o
`max(updated_at)` de **todos** os packs — na chave do cache do TanStack. É deliberado: o
grafo não pode ficar velho depois de um refresh.

Efeito colateral: **um refresh de qualquer pack invalida o grafo inteiro.** Com 7 packs
atualizando 8–9× por dia, são ~60 buscas de 1,2 a 6 s por dia, e elas caem exatamente
quando o usuário vai olhar o dado.

O `PackConflictGuard` não trava a tela enquanto carrega (renderiza os filhos normalmente),
mas a consulta disputa o mesmo banco e o mesmo pool de conexões que a RPC do Manager, na
mesma janela de tempo. **É a explicação mais provável para o "mais lento hoje"** — e bate
com a data: 145/146 entraram em 08/09 à noite, o deploy foi em 09/09 de manhã, a queixa é
de 09/09.

> Isto é hipótese com forte evidência circunstancial, **não** causa provada. O passo 1
> abaixo é o que a transforma em prova ou a derruba.

### O que fazer — em ordem

**Passo 1 — provar a causa antes de consertar.** Com o app aberto, medir o tempo de parede
do `POST /pack-shares/conflicts` na aba de rede do navegador, logo após um refresh
terminar, e comparar com uma carga sem refresh recente. Se a diferença não aparecer, a
hipótese cai e este item vira só uma otimização de fundo.

**Passo 2 — tornar a consulta barata (o caminho principal).**
Hipótese a testar no laboratório: o `GROUP BY (ad_id, metric_date)` hoje precisa ordenar
660 mil linhas (daí os 130 MB de temporário). O índice
`ad_metric_pack_map_user_ad_date_idx (user_id, ad_id, metric_date)` **já está na ordem do
agrupamento**, mas não carrega `pack_id`, então o Postgres tem que ir ao heap e acaba
optando por ordenar.

Trocar por `(user_id, ad_id, metric_date) INCLUDE (pack_id)` deve permitir *index-only scan*
+ `GroupAggregate` em fluxo, **sem sort e sem temporário**.

- Custo do índice: ~55 MB → ~70 MB.
- Ganho esperado: **a confirmar no lab**. Se não eliminar o sort, descartar e ir ao passo 3.

**Passo 3 — só se o passo 2 não bastar: reduzir a frequência.** O grafo só precisa mudar
quando muda o conteúdo de um pack, e um refresh do pack A só pode alterar arestas que
**tocam A**. Recalcular por pack, guardando o resto, elimina a maior parte das buscas.
Mais complexo e mais fácil de errar — por isso é o plano B.

**Nota:** o item F5 encolhe o mapa em ~5×, o que resolve este item de graça. Se o F5 for
aprovado logo, o passo 2 daqui pode virar desnecessário.

### Teste de aceitação

1. **Diferencial de resultado:** a lista de pares devolvida pela versão nova tem que ser
   **idêntica** à da atual, para os 38 packs reais. Rodar as duas na mesma transação.
2. **Teste sabotado:** inserir artificialmente (em transação com `ROLLBACK`) um par
   `(ad_id, metric_date)` em dois packs e confirmar que **ambas** as versões o encontram.
   Um teste de detecção de conflito que nunca viu um conflito não provou nada.
3. `EXPLAIN (ANALYZE, BUFFERS)` antes e depois, anexado ao commit, mostrando que o
   `Sort`/`temp written` sumiu.
4. Medir a frio e a quente, 3 execuções cada.

### Riscos

- Índice novo custa espaço e torna a escrita do mapa um pouco mais cara. Medir o efeito na
  gravação (a tabela recebe milhares de linhas por refresh).
- Se o passo 3 for necessário: **cuidado com correção**. Um grafo parcialmente atualizado
  que perca uma aresta faz o app somar dado duplicado sem avisar — exatamente o que o
  bloqueio existe para impedir. "Impreciso é impreciso."

---

## 6. F3 — linha-zero sintética nunca sobrescreve linha real

**Estado:** ⬜

### O que acontece

Anúncio que está no inventário do pack mas não apareceu no relatório do dia recebe uma
linha diária zerada sintetizada (`FASE 1.5` do `job_processor`, via
`ad_inventory.synthesize_zero_raw_rows`). Essas linhas entram no mesmo upsert das linhas
reais — ou seja, com `ON CONFLICT DO UPDATE`.

**É o mecanismo que apagou R$ 11.780,89 do `EI.30 - CA4 Cap` em 07/09.** Quando o relatório
volta incompleto (teto de páginas, fatia, início cortado), o anúncio some da resposta, a
síntese conclui "não entregou" e grava zeros por cima do gasto real.

O conserto de 07/09 (commit `432dee6`) fechou **uma** porta: coleta parcial não é mais
tratada como sucesso. Mas o caminho continua aberto para qualquer outro recorte futuro.

Medição de 09/09 no `EI.31 - CA4 Cap (BM1)`: **0 ocorrências** hoje. O caminho existe, o
dano não está acontecendo agora.

### A invariante certa

> **Linha-zero sintética nunca sobrescreve linha existente.**

*Insert-if-absent* para as sintéticas; upsert normal para o que veio da Meta.

Isto é **correção, não velocidade** — precisa estar escrito porque a pergunta já foi feita:
não reduz o número de linhas gravadas, não encolhe a tabela, não acelera refresh nem
criação de pack. O que resolve o volume é o F5. O ganho de tempo aqui é ruído
(`ON CONFLICT DO NOTHING` gera um pouco menos de WAL que `DO UPDATE`).

Também **não** é para dobrar o recuo da janela para 14 dias — isso foi medido e descartado
(seção "Por que não congela" em `decisoes-tecnicas.md`): o upsert não apaga, e o dia
degradado devolve *menos linhas*, não valores menores.

### O que fazer

1. Marcar a procedência da linha desde a síntese e **carregá-la** através do
   formatter/enricher até a persistência (hoje a marca se perde: a linha sintética vira
   indistinguível de uma real logo na FASE 1.5).
2. Na gravação, separar em dois lotes:
   - reais → upsert como hoje (`resolution=merge-duplicates`);
   - sintéticas → `resolution=ignore-duplicates` (`ON CONFLICT DO NOTHING`).

**Cuidado de projeto:** hoje a síntese é injetada no nível RAW justamente para que tudo
depois dela trate a linha-zero como linha normal. Carregar a marca não pode reintroduzir
ramificações `if sintética` no meio do pipeline — a marca é só um campo que viaja e é lido
**uma vez**, na hora de escolher o lote.

### Teste de aceitação

1. **Sabotado, e este é o teste que importa:** gravar uma linha real com gasto; rodar o
   caminho de síntese para um dia/anúncio em que essa linha existe; afirmar que o gasto
   **sobreviveu**.
2. **Controle negativo:** com o fix revertido, o mesmo teste tem que **falhar**. Registrar
   no commit que ele falhou. Sem isso, o teste não provou nada.
3. Linha sintética para chave **inexistente** continua sendo criada (não pode virar
   "não escreve nunca").
4. Reprocessar o `EI.30 - CA4 Cap` no laboratório com o dump e conferir que o total bate
   com o Gerenciador (R$ 532.191,11), como em 07/09.

### Riscos

- Se a marca vazar para o read-path, o app passa a tratar linha-zero diferente de linha
  real na leitura — mudança de comportamento não pedida. A marca **não** vai para o banco.
- Se a separação em dois lotes dobrar o número de requisições ao PostgREST, o refresh fica
  mais lento. Medir; se acontecer, agrupar por lote em vez de por linha.

---

## 7. F4 — página de 1.000 e espera guiada pelo cabeçalho

**Estado:** ⬜

### O que acontece

O coletor lê o relatório da Meta em páginas de 500 e **dorme 1 segundo cego** entre uma e
outra. Quanto isso pesa, no job inteiro:

| Tipo de job | Duração | Linhas | Páginas | **Espera cega** | % do job |
|---|---|---|---|---|---|
| Incremental típico | 131 s | 3.566 | 8 | 8 s | 6% |
| Incremental pesado (CA4) | 256 s | 8.634 | 18 | 18 s | 7% |
| Todo o período | 289 s | 19.810 | 40 | 40 s | **14%** |

### O que fazer

1. **`PAGE_LIMIT` 500 → 1.000.** Testado contra a Meta em 07/09: 1.000 funciona; 2.000
   devolve HTTP 500. Ajustar `MAX_PAGES` de 100 → 50 para **preservar o teto de 50.000
   linhas** — o teto é proteção contra corromper dado, não um detalhe de paginação.
2. **Trocar `PAGE_DELAY_S` por espera guiada** pelos cabeçalhos de uso
   (`x-business-use-case-usage` / `x-ad-account-usage`) que o `meta_usage_logger` já lê e
   grava em `meta_api_usage`. Recuar de verdade acima de ~75% de uso; quase não esperar
   abaixo de ~25%.

### Ganho esperado

−5% no refresh do dia a dia, −14% na recarga completa. **Real, mas modesto** — não é aqui
que mora a lentidão de 09/09.

### O revés, que é o ponto importante deste item

A espera de 1 s **é proteção**. Em 07/09 batemos no limite de requisições **no nível do
app** (`(#4) Application request limit reached`) depois de 40+ relatórios num dia.

Simplesmente remover a espera aumenta esse risco. A versão guiada pelo cabeçalho é
**mais segura** que a atual — ela recua quando a Meta avisa que está carregada, coisa que o
sleep cego não faz (espera de menos quando precisa e de mais quando não precisa). Mas
"só tirar a espera" seria um erro, e não é isso que este item propõe.

### Teste de aceitação

1. **Diferencial:** coletar o **mesmo** `report_run_id` com página de 500 e de 1.000 e
   afirmar que o conjunto de linhas é idêntico (chave `{date}-{ad_id}`, e os valores).
2. O teste de teto existente (`backend/tests/test_insights_collector_cap.py`) tem que
   continuar passando **com os números novos** — 50 páginas × 1.000 = as mesmas 50.000
   linhas. Ajustar as constantes do teste, jamais o significado.
3. Teste da espera: alimentar cabeçalhos sintéticos (5%, 50%, 90% de uso) e afirmar que a
   espera cresce monotonicamente. Sabotar: com o cabeçalho a 90%, se a espera não crescer,
   o teste falha.
4. Não medir contra a conta `act_375919623592885` em horário comercial enquanto houver
   risco de throttle. Preferir fora do expediente.

---

## 8. F5 — inventário fora de `ad_metrics`

**Estado:** ⏸️ **aguardando decisão do idealizador**

### O problema

**81,6% de `ad_metrics` são zeros sintéticos** — 567.351 de 695.089 linhas. Elas são
regravadas por inteiro a cada "todo o período" e varridas por toda RPC de leitura.

### A proposta

Guardar o inventário do pack como **uma linha por anúncio** (não uma por anúncio-por-dia) e
deixar a leitura completar com zero, que é onde o zero de fato importa.

| | hoje | depois (estimado) |
|---|---|---|
| Linhas em `ad_metrics` | 695 mil | ~130 mil |
| `ad_metrics` | 1.018 MB | ~250 MB |
| `ad_performance_daily` | 581 MB | ~140 MB |
| `ad_metric_pack_map` | 270 MB | ~65 MB |
| Linhas gravadas por refresh | 3.500–20.000 | ~1.000–4.000 |
| Varredura do Manager | 695 mil linhas | ~130 mil |
| `detect_pack_conflicts` | 660 mil linhas | ~130 mil |

**F2 e F5 são o mesmo problema visto de dois ângulos:** a função de conflito é lenta porque
varre um mapa inflado por zeros. Encolher o mapa a resolve sem tocá-la.

### Por que está parado

É mudar o **read model do app inteiro**: o que a leitura recebe passa a ser montado, não
lido. Toda RPC do Manager, do detalhe, das séries e do diagnóstico precisa aprender a
completar o zero.

Merece o mesmo tratamento do rollup: laboratório com o dump de produção, diferencial de
JSON contra a versão atual, cutover só depois. **~1 semana**, conversa própria.

**Não começar sem decisão explícita.**

---

## 9. Achados menores

### M1 — `thumbnail-cache` devolvendo 404, 267× em 10 h ⬜

`GET /analytics/packs/{pack_id}/thumbnail-cache` responde **404 "Pack não encontrado"** em
laço, para packs que **existem** (ex.: `6250198f-…`, `ceb9d9cb-…`, ambos reais).

Hipótese: `get_pack(user["token"], pack_id, user["user_id"])` em
`backend/app/routes/analytics.py:1881` não enxerga pack **compartilhado** — o convidado
consulta com o próprio `user_id` e o pack é de outro dono. Casa com o padrão já registrado
em `shared_pack_meta_credential_and_graph_api_dependency`.

Investigar: confirmar quem é o requisitante dos 404. Se for convidado, a rota precisa de
`resolve_pack_access`/`assert_pack_role` como as outras rotas de pack compartilhado.

### M2 — `AD_METRICS_IMPORT` falha ao parsear data, 230× em 10 h ⬜

```
[AD_METRICS_IMPORT] Falha ao parsear data para ad_id=120254727752180029: ''
[AD_METRICS_IMPORT] Falha ao parsear data para ad_id=indefinido: ''
```

Data vazia e um `ad_id=indefinido` (string literal vinda do frontend?). Precisa descobrir
se a linha é **descartada em silêncio** — se for, é dado da planilha do usuário sendo
perdido sem aviso, o que é mais grave que ruído de log.

### M3 — `deque mutated during iteration`, 5× em 10 h ⬜

```
[MetaUsage] falha ao persistir uso: deque mutated during iteration
```

Corrida entre threads no `meta_usage_logger`: alguém itera a fila enquanto outra thread
escreve. Perde registro de uso da API da Meta — justamente o dado de que o F4 depende para
a espera guiada. **Conferir antes de implementar o F4.**

### M4 — quedas transitórias de HTTP/2, 69× em 10 h 📊

`RemoteProtocolError` / `ConnectionTerminated` contra o Supabase, todas absorvidas pelo
`with_postgrest_retry`. Comportamento conhecido e tratado (memória
`supabase_http2_transient_drops`). **Só monitorar** — se passar de ~10/h, investigar.

### M5 — 7 a 9 refreshes por pack por dia ⏸️

A regra em `useAutoRefreshPacks` é: a cada abertura do app, se `updated_at` tem mais de
1 hora, atualiza. Com vários packs e o app aberto o dia todo, vira uma bateria.

Com o campo inflador (`attribution_setting`) removido isso já custa ~4× menos. Fica a
**pergunta de produto**, que é do idealizador: o dado da Meta muda o suficiente para
justificar 9 leituras por dia, ou 3–4 dariam o mesmo? Trocar o intervalo é uma linha de
código; qual intervalo é a decisão.

---

## 10. Apêndice — como reproduzir cada medição

Conexão de produção: ver `memory/db_connection.md` (nunca no código, nunca em commit).

```bash
DB="postgresql://postgres:***@db.yyhiwayyvawsdsptdklx.supabase.co:5432/postgres"
```

### 10.1 Tamanho e proporção de zeros

```sql
select count(*) as linhas,
       count(*) filter (where coalesce(impressions,0)=0
                          and coalesce(spend,0)=0
                          and coalesce(clicks,0)=0) as zeradas,
       round(100.0*count(*) filter (where coalesce(impressions,0)=0
                                      and coalesce(spend,0)=0
                                      and coalesce(clicks,0)=0)/nullif(count(*),0),1) as pct
from public.ad_metrics;

select relname, pg_size_pretty(pg_total_relation_size(relid)) total, n_live_tup, n_dead_tup
from pg_stat_user_tables where n_live_tup > 1000
order by pg_total_relation_size(relid) desc limit 12;
```

### 10.2 Consultas mais caras

```sql
select left(regexp_replace(query,'\s+',' ','g'),90) q, calls,
       round(mean_exec_time::numeric,0) ms_medio,
       round((total_exec_time/1000)::numeric,0) seg_total
from pg_stat_statements order by total_exec_time desc limit 20;
```

`pg_stat_statements` foi zerado em **2026-08-26**; os totais são acumulados desde então.

### 10.3 Custo do OFFSET em `ads` (F1)

```sql
explain (analyze, buffers, costs off)
select campaign_id, adset_id from public.ads
where user_id='<uuid>' limit 1000 offset 60000;
```

### 10.4 Grafo de conflito (F2)

```sql
-- monta o array com todos os packs do usuário
select array_agg(id) from public.packs where user_id='<uuid>';

explain (analyze, buffers, costs off)
select * from public.detect_pack_conflicts('<array>'::uuid[], '<uuid>'::uuid);
```

Rodar 3× seguidas: a 1ª é o número a frio, a 3ª é o número a quente.

### 10.5 RPC do Manager

A função barra chamada direta (`p_user_id must match auth.uid()`). Fingir a autenticação
dentro da transação:

```sql
begin;
select set_config('request.jwt.claims','{"sub":"<uuid>"}',true);
explain (analyze, costs off)
select public.fetch_manager_rankings_core_v2(
  '<uuid>'::uuid,'2026-08-01','2026-09-09','ad_name',
  array['<pack_id>']::uuid[],null,null,null,null,null,true,false,50,0,'spend',null,false);
rollback;
```

### 10.6 Saúde dos jobs

```sql
select status, count(*) from public.jobs
where created_at > now() - interval '48 hours' group by 1 order by 2 desc;

select p.name, count(*) refreshes_24h,
       round(avg(extract(epoch from (j.updated_at-j.created_at)))::numeric,0) seg_medio,
       round(avg(j.result_count)::numeric,0) linhas
from public.jobs j join public.packs p on p.id=(j.payload->>'pack_id')::uuid
where j.created_at > now() - interval '24 hours' and j.status='completed'
group by 1 order by 2 desc;
```

### 10.7 Ruído no log

```bash
ssh root@77.37.126.210 \
  "docker logs hookify-backend --since 10h 2>&1 | grep -c 'transitoria'"
```

Trocar o padrão por `thumbnail-cache HTTP/1.1\" 404`, `deque mutated`,
`AD_METRICS_IMPORT.*Falha ao parsear` para os demais.

### 10.8 Laboratório local

`hookify_lab` já está montado na máquina (porta 5432, papel `hookify_lab`) — ver
`memory/db_connection.md`. É onde os diferenciais de RPC rodam **antes** de tocar produção.

---

## 11. Diário de bordo

Uma linha por passo concluído: data, item, o que mudou, o número antes e depois.

| Data | Item | O que foi feito | Antes | Depois |
|---|---|---|---|---|
| 2026-09-09 | — | Linha de base medida; plano aberto; worktree `perf/eficiencia-carregamento` criado | — | — |
