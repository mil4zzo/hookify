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
| **F1** | Varredura de `ads` por OFFSET → RPC que agrega no servidor | ~1 h | −350 s/dia de banco, −46 requisições por refresh | nenhum | 🚢 **no ar desde 13/09** — confirmar ganho em 24 h |
| ~~**F2a-v1**~~ | ~~Restaurar a detecção no read-path (a "camada 2")~~ | — | — | — | ❌ **rejeitado pelo dono** — seria desfazer o −12% da 145 de propósito. Ver §5-bis |
| **F2a** | **Bloqueio falha fechado** — grafo indisponível liberava tudo em silêncio | ~1 tarde | **correção**, custo zero no caminho normal | baixo | 🚢 **no ar desde 13/09** — confirmar ganho em 24 h |
| **F2b** | Grafo de conflito: 6 s a frio, 79×/dia. Incremental por pack custa 196 ms | ~2 dias | −1,2 a 6 s de disputa, 79×/dia | **decisão de segurança** — alarga a janela de grafo velho | ⏸️ depois da feature de editar data |
| **F3** | Linha-zero sintética nunca sobrescreve linha real | ~2 h | fecha a classe de bug dos R$ 12 mil | baixo | ⏸️ **absorvido pelo F5** (a linha sintética deixa de existir) — só fazer se o F5 atrasar |
| **F4** | Página de 1.000 + espera curta guiada pelo uso + espera e nova tentativa no limite da Meta | ~meio dia | −10 a −12 s num refresh de ~3,8 mil linhas (medido); limite da Meta deixa de derrubar o job | baixo | 🚢 **no ar desde 13/09** — confirmar ganho em 24 h |
| **F5** | Inventário fora de `ad_metrics` (fim das linhas-zero gravadas) | ~1 semana | −550 mil linhas (−78% em `ad_metrics`, rollup e mapa); refresh grava menos; F2 fica leve | médio — mapeado item a item (§8) | ✅ **modelo aprovado 13/09** · ⬜ não iniciado · 1 decisão pendente (§8.7) |
| **M1** | `thumbnail-cache` devolvendo 404 — 267× em 10 h | ? | ruído + requisição inútil em laço | ? | ⬜ |
| **M2** | `AD_METRICS_IMPORT` falha ao parsear data — 230× em 10 h | ? | dado da planilha possivelmente perdido | ? | ⬜ |
| **M3** | `deque mutated during iteration` no logger de uso — 5× em 10 h | ? | perde registro de uso da API da Meta | ? | ⬜ |
| **M4** | Quedas transitórias de HTTP/2 — 69× em 10 h | — | já absorvidas pelo retry; só monitorar | — | 📊 |
| **M5** | 7–9 refreshes por pack por dia | decisão | −60% de leitura da Meta se cair para 3–4 | — | ⏸️ |
| **F6** | Tooltip no card da planilha: leads por situação, com nº e % (§8-bis) | ~meio dia | descarte hoje é silencioso | baixo | ⬜ aprovado 13/09 |
| **M6** | Filtros `CPM / CTR de link / Connect rate / Page conv < X` casam com anúncio sem impressão (0 fabricado) | ? | filtro, Board e Critério errados | ? | ⬜ |

**Ordem recomendada (revista em 13/09):** deploy de F1 + F2a + F4 → **F5** (absorve o F3) → F6 → F2b → M1/M2/M3/M6.

F1 (feito) e F2b são os que atacam a queixa de lentidão de 09/09. Mas o **F2a entrou na
frente do F2b**: a investigação do F2 descobriu que o grafo de conflito é a única proteção
contra somar packs sobrepostos — e que o bloqueio **falhava aberto** quando o grafo não
podia ser obtido. Enquanto isso não estivesse fechado, reduzir a frequência do grafo
**pioraria a segurança em vez de melhorar a velocidade**. Ver §5-bis.

Uma proposta minha foi **rejeitada pelo dono** e o registro está em §5-bis: restaurar a
detecção no read-path seria desfazer o −12% que a 145 comprou de propósito. A decisão do
produto é **prevenir, não deduplicar** — recortes que se cruzam se comparam separados.

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

**Estado:** ✅ implementado e testado em 2026-09-09 — **falta aplicar a migration em
produção e fazer o deploy**. Migration `151_escopo_de_pais_sem_varredura.sql`.

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

### A ideia original foi descartada na implementação

O plano dizia: "filtrar pelos ids que o chamador já tem" (`where campaign_id = any(...)`).
Parecia o caminho óbvio e mais barato. **Não serve, e o motivo é um velho conhecido deste
projeto:** o PostgREST devolveria uma linha por **anúncio**, não por campanha — uma
campanha com 5.000 anúncios traz 5.000 linhas — e o **teto silencioso de 1.000 linhas**
(memória `supabase_silent_1000_row_cap`) cortaria a resposta **sem erro**.

Consequência: campanhas reais sumiriam do escopo e ficariam com orçamento e status por
gravar, em silêncio. É a mesma família de bug que apagou os R$ 12 mil — ausência
interpretada como "não existe".

### O que foi feito

**Migration 151** cria `public.present_parent_ids(p_user_id uuid)`, que agrega no servidor
e devolve **dois arrays** — não há linha para truncar. O backend faz **uma** chamada.

A forma da consulta também foi medida antes de escolher:

| formulação | tempo | por quê |
|---|---|---|
| `array_agg(distinct ...)` direto sobre as 46.581 linhas | 468 ms | ordena em disco (2,2 MB) |
| **`distinct` dos pares primeiro, agrega os 5.090 sobreviventes** | **84 ms** | HashAggregate, 593 kB, zero temporário |

**47 idas e ~1.400 ms → 1 ida e 84 ms.**

`SECURITY INVOKER` de propósito (o default), para se comportar **exatamente** como o
`select` que substitui nos dois clientes que a chamam: com JWT do usuário a RLS de `ads`
se aplica; em service role (pack compartilhado, convenção P3.3b) o `p_user_id` é o silo.
Marcá-la `SECURITY DEFINER` criaria um vazamento que hoje não existe.

**Índice descartado:** `(user_id) INCLUDE (campaign_id, adset_id)` levaria os 84 ms a ~20 ms,
mas `ads` é upsertada em massa a cada refresh e todo índice novo é imposto a toda escrita.
84 ms uma vez por refresh não é mais o problema.

### O que foi testado

**SQL — `supabase/tests/151_escopo_de_pais.test.sql`**, no laboratório (5 silos reais,
60.645 ads):

- **Diferencial** contra a lógica da varredura antiga, conjunto a conjunto, em **todo**
  silo — real e sintético. Zero divergências.
- 8 asserções de borda, **ordenadas de propósito** para que cada uma seja provável
  isoladamente (a rede ampla do diferencial pegaria tudo primeiro e deixaria as bordas
  sem prova).
- **4 sabotagens rodadas**, cada uma falhando na asserção que lhe corresponde:

  | sabotagem | falha em |
  |---|---|
  | `limit 1000` na função | `B4.mil-e-duzentas-campanhas` |
  | tirar o `filter (where ... is not null)` | `B2.nulos-fora-do-array` |
  | tirar o `where user_id = p_user_id` | `B5.grande-nao-ve-vizinho` |
  | trocar `coalesce(..., '{}')` por NULL | `B3.vazio-nao-e-null` |

  `B1` é guarda de **forma**, não de lógica (agregação sem `GROUP BY` sempre devolve uma
  linha) — está anotado como tal no arquivo, sem fingir prova que não tem.

**Python — `backend/tests/test_present_parent_ids.py`** (10 testes): forma da chamada,
tradução dos arrays em conjuntos, resposta vazia/`None`, ids não-texto, e a passagem pelo
`with_postgrest_retry`. Sabotagem verificada: remover o filtro de vazio faz
`test_vazio_e_espaco_sao_descartados_como_antes` falhar.

**Guarda contra regressão:** os fakes de `test_parent_entities_changed_only.py` e
`test_parent_entities_double_write.py` agora **levantam exceção** se alguém voltar a fazer
`select` em `ads` por esse caminho.

**Suíte completa: 650 testes passando** (com o venv do projeto — o Python global tem
httpx 0.28/postgrest 2.27 contra os 0.27.2/0.16.11 fixados, e 3 testes de concorrência
falham só por isso).

### Detalhe preservado de propósito

O código antigo filtrava valor *falsy* (`if r.get("campaign_id")`), o que descartava
**string vazia**; a RPC só descarta NULL. O filtro de vazio ficou no Python para o
contrato do chamador não mudar. Medido em produção: **zero** strings vazias hoje
(1.837 NULLs), então na prática é cinto e suspensório.

### Deploy — nesta ordem

1. `psql "$DB" -f supabase/migrations/151_escopo_de_pais_sem_varredura.sql`
2. Só então o backend. **A ordem importa:** o backend novo chama uma função que precisa
   existir. O backend antigo convive com a função nova sem problema (não a chama).

### Como comprovar o ganho

Depois de 24 h em produção, repetir a consulta 10.2 do apêndice: a linha
`SELECT campaign_id, adset_id FROM ads ...` deve **parar de crescer** em `calls`, e
`present_parent_ids` deve aparecer com ~1 chamada por refresh e média perto de 84 ms.

---

## 5. F2 — o grafo de conflito refeito a cada refresh

**Estado:** 🟡 investigado a fundo em 2026-09-09. O passo 1 **confirmou** a causa da
lentidão; o passo 2 **derrubou o meu diagnóstico**; e no caminho apareceu um achado de
**correção** que é mais grave que os 6 segundos e que inverte o passo 3. Ver §5-bis.

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

---

## 5-bis. O que a investigação do F2 realmente encontrou (2026-09-09)

### Passo 1 — CONFIRMADO: o carimbo global é a causa da frequência

79 chamadas a `GET /pack-shares/conflicts` em 24 h, em rajadas. Correlação exata com o
término dos jobs:

| jobs terminaram | grafo foi rebuscado |
|---|---|
| 20:20, 20:21, 20:23, 20:25, 20:27, 20:29, 20:35 | 20:20, 20:21, 20:24, 20:25, 20:25, 20:27, 20:29, 20:31, 20:31, 20:34, 20:35, 20:36, 20:37, 20:37, 20:41 |

**16 buscas para 7 refreshes.** O carimbo é o `max(updated_at)` de todos os packs: um
refresh de qualquer pack invalida o grafo inteiro.

### Passo 2 — DIAGNÓSTICO ERRADO, e três becos sem saída

Eu havia escrito que o `GROUP BY` ordenava 660 mil linhas e que um índice
`INCLUDE (pack_id)` tiraria o *sort*. **Não existe `Sort` no plano.** O plano real mostra
outros custos:

| custo real | número |
|---|---|
| `Heap Fetches` no index-only scan | **335.196** (metade das linhas vai ao heap — mapa de visibilidade defasado; 8,6% de tuplas mortas) |
| `HashAggregate` vazando para disco | **33 lotes, 62,7 MB** (661 mil grupos não cabem no `work_mem`) |
| Linhas lidas para descartar | 670.270 lidas, **661.395 descartadas** pelo `count(*) > 1` |

Três recortes foram testados e **descartados por medição**:

1. **Recorte por dia** — inútil: **99,7%** das linhas estão em dias que 2+ packs
   compartilham (205 de 370 dias). Os packs são recortes de criativo, não de tempo.
2. **Recorte por par de packs** (janela observada no mapa, não no metadado): 197 dos 703
   pares se cruzam. Reduz pares, não linhas.
3. **Duas passadas** (agrupar por `ad_id` primeiro, 47 mil grupos, depois por
   `(ad_id, dia)`): parecia 10,7 s → 4,8 s. **Era cache.** Alternando as duas na mesma
   condição: **1.392 ms × 1.314 ms**. Ganho zero.

> Lição para o próximo: a primeira comparação foi feita com a consulta antiga a frio e a
> nova logo depois, com o buffer já quente. A regra 2 deste plano existe por isso.

### O que sobrou de real para performance

Recalcular **um** pack (arestas incidentes a ele) custa **196 ms**, contra 1.350 ms do
grafo inteiro a quente e 6.000–10.700 ms a frio. E desde a 145 isso é **provavelmente
correto**: cada linha pertence a UM pack, então um refresh do pack A só pode criar ou
destruir arestas **incidentes a A** — arestas (B,C) não podem mudar sem tocar B ou C.

### O ACHADO GRANDE — a camada 2 está morta desde a migration 145

`usePackConflicts.ts` documenta uma rede de segurança: *"se o grafo envelhecer, a camada 2
(sinal `overlap` no read-path) bloqueia a tela — nunca se mostra número impreciso"*.

**Essa camada não existe mais.** Na migration 145, o CTE `keys` da RPC do Manager passou a
declarar `false as x_cross_silo` — literalmente constante — nos dois ramos (linhas 666 e
684). Logo `overlap_stat.conflict_rows` é sempre 0, a chave `overlap` nunca é emitida,
`serverOverlapRows` é sempre `null` e o `PackConflictGuard` nunca dispara por esse sinal.

> **Precisão de 10/09, porque a primeira redação foi ampla demais.** O *dedup* ainda existe
> — na rota de DETALHE (`fetch_entity_performance_v145`, `row_number() over (partition by
> ad_id, date)`, schema.sql:1488). Quem não tem dedup é o **Manager**
> (`fetch_manager_performance_base_v145`; o único `row_number() over ()` de lá é ordinal de
> paginação). A *sentinela* (`overlap`) é que não existe em lugar nenhum. Medido com dois
> packs sintéticos, em transação revertida: Manager R$ 450,99 → **R$ 901,98** (o dobro
> exato), impressões 11.403 → 22.806, `overlap` não emitido; e o detalhe devolve o anúncio
> como **2 grupos** — o dedup dele funciona (cada grupo com R$ 450,99), mas o join da linha
> representante aceita qualquer pack da seleção e fana o grupo. As duas rotas erram, cada uma
> do seu jeito; **nenhuma é rede para a outra** — o que reforça bloquear em vez de deduplicar.

**E o dano que ela vigiava passou a ser real.** Antes da 145, dois packs do mesmo dono
liam a MESMA linha física, e o `GROUP BY (ad_id, dia)` dedupava. Desde a 145 são duas
linhas, `keys` emite uma por `(ad_id, dia, pack_id)`, `filtered` é filtro puro (sem
dedup) e `per_ad` faz `group by group_key, user_id, ad_id` com `sum(spend)`,
`sum(impressions)`, `sum(results)`. **Dois packs que compartilham um anúncio-dia somam
esse dia duas vezes, em silêncio.**

Hoje não há dano em produção: zero conflitos, e o seletor (camada 1) impede entrar no
estado. Mas a conclusão inverte o plano:

> **O carimbo de conteúdo é load-bearing.** O grafo do cliente é a ÚNICA proteção que
> restou. Reduzir a frequência — o passo 3 — deixaria de ser uma otimização e passaria a
> ser uma **regressão de segurança**. Não fazer antes de restaurar a camada 2.

### A proposta de restaurar a detecção foi REJEITADA — e estava errada

Eu propus recolocar a detecção no read-path. **O dono rejeitou, e com razão.** A decisão
de tirar o dedup foi deliberada e está registrada em `decisoes-tecnicas.md` sob o título
literal **"Por que bloquear e não deduplicar"** (07/09, migration 145):

> *Bloquear é decisão de produto: analisar packs sobrepostos juntos não é o uso esperado —
> recortes que se cruzam se comparam separados, ou num pack que junte os dois.*

E foi de lá que veio o ganho: *"Manager 1,59 s → 1,38–1,41 s (−12%, só porque o `keys`
perdeu um `GROUP BY` que o bloqueio tornou desnecessário)"*. **Restaurar a detecção é
refazer esse `GROUP BY`** — desfazer o −12% de propósito. Medido em 09/09: como consulta
separada sobre 3 packs selecionados, 295 ms estáveis, num Manager de 907 ms.

**O que me enganou** (registrado porque vai enganar o próximo): o mesmo parágrafo que
decidiu bloquear diz que o dedup *"não pode sair: é a rede de segurança... vira sentinela"*.
O código entregue não tem dedup **nem** sentinela. Fui conferir se a promessa era cumprida
e li a ausência como bug, quando era decisão. A correção já está no `decisoes-tecnicas.md`,
no próprio parágrafo.

**Dano verificado: nenhum.** Zero anúncio-dia em 2+ packs em **qualquer** silo (09/09),
zero na época da 145, e nenhum pack criado ou editado desde então (`pack_action_log` só tem
refresh, sync, status, orçamento, share) — e sobreposição só nasce quando a *definição* de
dois packs passa a se cruzar.

### O que sobrou, e virou o F2a de verdade: **o bloqueio falhava aberto**

A conclusão que fica de pé é outra, e é da forma que o produto prefere — prevenção:

> **O grafo é a única proteção, sem rede atrás.** Então mapa vazio **por falha** não pode
> ser lido como "não há conflito".

E era. Se a busca do grafo falhasse (`retry: 1`, depois desiste), `conflictMap` vinha
vazio: nada era desabilitado no `PackFilter`, o `PackConflictGuard` não bloqueava (deriva
do mesmo mapa) e **"Selecionar todos" marcava tudo** — essa é a porta larga, ela não passa
pelo veto de item nenhum. Na única situação em que o app não sabia se havia conflito, ele
liberava.

**Implementado em 09/09.** A regra virou uma função pura,
`frontend/components/common/packConflictGate.ts`, compartilhada pelos três caminhos (veto
por item, atalho bulk, bloqueio da área) — porque escrita três vezes ela **já havia
divergido uma**: o veto por item é calculado contra a seleção do momento, então com nada
marcado nenhum pack aparecia desabilitado e um "Selecionar todos" ingênuo montava o estado
proibido.

Regras:
- quem **já está** selecionado nunca é vetado (desmarcar tem de continuar possível, senão
  o usuário fica preso sem saída);
- o corte é no **segundo** pack (um pack sozinho não soma em duplicidade, e travar a
  seleção inteira puniria quem só quer trocar de pack);
- conflito **nomeado** tem precedência sobre o "não sei" (a mensagem útil ganha);
- `isLoading` **não** entra: bloquear durante a primeira busca piscaria a tela em toda
  carga de página, e o risco real só existe depois que a busca falha em definitivo;
- "Selecionar todos" recusa o clique **inteiro** em vez de deixar o primeiro passar — o que
  a regra pura permitiria, e ela segue valendo como rede: um atalho que marca um pack
  arbitrário se lê como bug, não como proteção.

### O que foi testado (F2a)

`frontend/components/common/__tests__/packConflictGate.test.ts` — 13 testes, e a suíte
inteira do frontend em **446 passando**, `tsc --noEmit` limpo.

**4 sabotagens rodadas**, cada uma falhando na asserção que lhe corresponde:

| sabotagem | falha em |
|---|---|
| `graphUnavailable` ignorado | `sem grafo, o segundo pack é vetado` |
| veto aplicado a quem já está selecionado | `desmarcar continua possível` |
| corte no primeiro pack em vez do segundo | `sem grafo, o primeiro pack entra` |
| flag não repassada ao atalho bulk | `selecionar todos não passa por cima do grafo indisponível` |

Há também um teste de **excesso de zelo**: com grafo disponível, dois packs sem conflito
continuam somáveis — falhar fechado não pode virar "só um pack, sempre".

### Riscos do F2a

- **Falso bloqueio:** se a rota do grafo ficar instável, o usuário perde a seleção múltipla
  sem que exista conflito. É o lado certo do erro (mostrar menos, nunca mostrar errado),
  mas se acontecer com frequência a rota é que precisa de conserto, não a regra.
- **`serverOverlapRows` continua código morto**, agora rotulado como tal em três lugares
  (o `prop`, o ramo do render, e o `usePackConflicts`). Deliberado: a fiação fica para o dia
  em que a detecção server-side voltar; o que não pode é alguém confiar nela como rede.

### Riscos do F2b (quando for a hora)

- Exige guardar o grafo do lado do servidor (arestas + marca d'água por pack) e tratar pack
  apagado, pack compartilhado e dois refreshes simultâneos. É a parte cara.
- **É decisão de segurança, não de performance:** alarga a janela de grafo velho. E a
  feature de **editar a data do pack** (em construção em outro chat) é a única ação capaz
  de criar sobreposição onde não havia — o F2b deve vir depois dela, e essa feature precisa
  revalidar o grafo ao salvar.
- **Índice `INCLUDE (pack_id)`:** já não se justifica — não havia `Sort` para eliminar.
- **`Heap Fetches` e o vazamento de 62 MB:** continuam valendo como afinação barata
  (autovacuum mais agressivo no mapa; `work_mem` na função), independentes do resto.

---

## 6. F3 — linha-zero sintética nunca sobrescreve linha real

**Estado:** ⏸️ **absorvido pelo F5** (13/09). Com o modelo aprovado a linha sintética deixa de
existir, e com ela a classe de bug. Só vale fazer se o F5 atrasar. O texto abaixo fica como registro.

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

## 7. F4 — página de 1.000, espera curta e limite da Meta com nova tentativa

**Estado:** ✅ implementado, testado e medido em 2026-09-13 — **falta só o deploy** (sem
migration). O desenho original ("espera guiada pelo cabeçalho") **caiu por medição** e foi
trocado; o registro do porquê está abaixo.

### O que a medição derrubou

O plano dizia que a espera de 1 s entre páginas era proteção e que guiá-la pelo cabeçalho de
uso da Meta seria mais seguro. Os dados de `meta_api_usage` mostram outra coisa:

| Medida | Resultado |
|---|---|
| Uso informado nas 4.291 páginas de relatório dos últimos 14 dias | **nunca passou de 1%** |
| Maior uso informado em qualquer chamada no dia 07/09, quando deu `(#4)` | **2%** — o cabeçalho não avisou |
| Origem do `(#4)` de 07/09 | **40+ relatórios criados** no dia de experimentos (decisoes-tecnicas.md:1457), não leitura de páginas |
| Erros de limite da Meta nos logs de produção, 7 dias | **0** |
| Tempo de resposta de uma página (500 linhas) | mediana 1,5 s, p90 2,4 s |

Conclusão: a espera guiada escolheria sempre a mínima, e o cabeçalho não teria evitado o
incidente. A proteção real contra limite é **reagir ao erro**, não dormir às cegas.

### Diferencial contra a Meta (mesmo relatório, 13/09)

Relatório `28505175629078202` (EI.31 - CA8, 3.758 linhas), lido com página de 500 e de 1.000:

- **Linhas idênticas**: mesmo multiconjunto de linhas com valores, 0 só num lado, 0 chaves
  duplicadas.
- **Tempo, com a ordem alternada** (a 1ª rodada, 1.000 depois de 500, deu 29,8 s × 22,8 s por
  uma página de 15,7 s — acaso da Meta; a regra 2 deste plano existe por isso):

| rodada | 1.000 | 500 |
|---|---|---|
| 1 | 17,3 s (4 páginas) | 28,0 s (8 páginas) |
| 2 | 15,4 s (4 páginas) | 25,5 s (8 páginas) |

### O que foi feito (`insights_collector.py`)

1. **`PAGE_LIMIT` 500 → 1.000** e **`MAX_PAGES` 100 → 50**: o teto continua em 50.000 linhas.
2. **Espera entre páginas `_page_delay`**: 0,25 s com folga; 2 s a partir de 50% de uso, 5 s a
   partir de 75%, 15 s a partir de 90% ou com conta já bloqueada. Olha o maior valor entre
   `x-business-use-case-usage`, `x-app-usage` e `x-ad-account-usage`. **Sem cabecalho legível,
   1 s, como antes**: sem sinal, não acelera.
3. **Limite da Meta com espera e nova tentativa**: antes, `(#4)`, `(#17)`, `(#32)`, `(#613)` e
   800xx derrubavam o job na hora. Agora espera 15, 30 e 60 s e tenta de novo; se persistir,
   desiste e a coleta sai **incompleta** (nunca vira sucesso). As esperas somadas (105 s)
   cabem no lease de processamento do job (300 s).

### O que foi testado

`backend/tests/test_insights_collector_pacing.py` (22 testes) e o teste de teto existente.

**4 sabotagens rodadas**, cada uma falhando nos testes da regra correspondente:

| sabotagem | falha em |
|---|---|
| espera fixa, ignorando o uso | degraus, monotonia, uso do app, "coleta usa o uso da página anterior" (6) |
| sem nova tentativa no limite | reconhecimento dos 7 códigos, espera e nova tentativa, limite no meio da paginação, limite persistente (10) |
| página de 2.000 | `teto de produção continua em 50 mil linhas` |
| acelerar sem cabeçalho | `sem cabeçalho não acelera`, `cabeçalho ilegível` |

**Suíte completa do backend: 672 passando.**

### Ganho

Num refresh do tamanho do CA8 (3,8 mil linhas): **−10 a −12 s** na coleta. Recarga completa
(~20 mil linhas, 40 → 20 páginas): estimado **−40 a −55 s**. Com o resto do refresh intacto
(inventário, enriquecimento, gravação), o refresh do dia a dia continua dominado por outras etapas.

### Riscos

- **Mais leituras por segundo na mesma conta.** Mitigado: cada página já leva ~1,5–4 s para
  responder, a fila de refresh é serial por usuário, e o limite agora é tratado com espera.
- **A espera reativa não cobre a criação de relatórios** (`start_ads_job`), que foi a origem do
  `(#4)` de 07/09. Fora do escopo do F4; é o assunto do M5 (quantos refreshes por dia).

### Como comprovar em produção

Depois de 24 h: em `meta_api_usage`, as linhas `InsightsCollector` por job devem cair pela
metade; a duração média dos jobs de refresh (consulta 10.6) deve cair; e nenhum job deve
falhar com erro de limite.

---

## 8. F5 — inventário fora de `ad_metrics` (fim das linhas-zero gravadas)

**Estado:** ✅ **modelo aprovado pelo idealizador em 2026-09-13** · ⬜ não iniciado · ⏸️ uma
decisão pendente (§8.7)

Revisão completa em 2026-09-13: medições em produção e mapa de todos os leitores das
linhas-zero no SQL, no backend e no frontend. Os números abaixo substituem a estimativa de 09/09.

### 8.1 O que a linha-zero faz de verdade

Regra atual (`ad_inventory.py:73`, `job_processor.py:404-417`): a cada refresh, o anúncio com
status **entregável agora** e **nenhuma atividade na janela inteira do job** ganha uma linha
zerada por dia da janela, a partir do `created_time`.

Na tela, **dia com linha-zero e dia sem linha dão o mesmo resultado**. Séries e histórico já
preenchem o eixo, e as médias são soma sobre soma. A única função real da linha-zero é
**presença**, isto é, fazer o anúncio existir no período:
- lista do Manager, `active_count` e `ad_count`;
- detalhe (sem linha, a rota devolve 404);
- Boards, Explorer, G.O.L.D., Plano e Oportunidades;
- stats do pack.

Ela também é a porta de entrada do anúncio que nunca entregou em `ads`, `ad_metric_pack_map`,
`get_ads_for_pack` (transcrição), miniaturas, `parent_entities` e status-sync.

### 8.2 Medido em produção (13/09)

| Medida | Valor |
|---|---|
| `ad_metrics`, total | 705.075 linhas |
| Totalmente vazias (sintéticas) | **549.625 (78%)**. Não são 81,6%: ~22 mil linhas "zeradas" são reais da Meta (conversão ou lpv sem entrega) e ficam |
| Linhas de anúncios hoje **não** entregáveis (PAUSED 39%, CAMPAIGN_PAUSED 31%, ARCHIVED 12%, ADSET_PAUSED 12%) | **94%** |
| Depois do último gasto do anúncio | 310.437 |
| Antes do primeiro gasto | 198.912 |
| **Antes de o anúncio existir** (2 a 26 dias antes de `meta_created_time`). Todas gravadas na noite 06→07/09; não se repetiu | **162.960** |
| Anúncio que nunca entregou no pack (6.114 anúncios só existem por elas) | 22.274 |
| Compressão em intervalos contínuos | 549.625 → **61.250**, nenhum com nome ou pai mudando |
| Rollup `ad_performance_daily` | espelha 1:1 (549.625 vazias) |
| Leadscore gravado em cima de linha sintética | 49 linhas, 8 packs |

`meta_created_time` é confiável: em 2.796 casos, a entrega real nunca antecede a criação em mais
de 1 dia, e esse dia é só a diferença de fuso (UTC × conta).

### 8.3 O que está errado hoje

1. **Status de agora aplicado ao passado.**
   - Anúncio pausado de 03 a 05 e reativado depois ganha zeros nos dias em que estava pausado.
   - Anúncio ativo de 01 a 05 e pausado depois não ganha os zeros desses dias no refresh seguinte.
2. **Dois tratamentos para a mesma situação.**
   - Se gastou em 1 dia da janela, os outros dias ficam sem linha (24.344 dias assim).
   - Se não gastou nenhum dia, ganha zero em todos (18.002 dias no meio da vida do anúncio).
3. **Acumula para sempre.** O anúncio ativo sem entrega ganha um zero por dia; quando é pausado,
   as linhas ficam.
4. **Zeros antes de o anúncio existir:** 162.960 linhas, evento único.
5. **Teto silencioso.** O limite de 25 mil linhas-zero por job corta anúncios antigos sem aviso.

### 8.4 O modelo aprovado

1. **`ad_metrics` guarda só dia com dado real da Meta.** A síntese (FASE 1.5) sai do pipeline.
2. **Inventário do pack, com 1 linha por (pack, anúncio):**
   - identidade: nome, conjunto, campanha e conta;
   - `meta_created_time` e status atual;
   - **`primeira_vez_ativo`** e **`ultima_vez_ativo`**: as datas em que algum refresh viu o
     anúncio entregável, atualizadas a cada refresh.
3. **Presença no período P:** o anúncio aparece, com zero onde não há dado, se teve dado real em
   P **ou** se o intervalo `[max(primeira_vez_ativo, criação), ultima_vez_ativo]` cruza P.
4. **Contagem de ativos:** vem direto do inventário (status atual), sem depender de gasto nem de
   linha.
5. **Portas laterais continuam alimentadas pelo inventário:** `ads` (criativo, miniatura, status,
   criação), lista do pack e transcrição, `parent_entities` e status-sync.
6. **Migração do histórico:**
   - `primeira_vez_ativo` e `ultima_vez_ativo` saem das linhas-zero existentes, **descartando as
     162.960 anteriores à criação**;
   - só então as linhas sintéticas são apagadas de `ad_metrics`, e com elas as do rollup e as do
     mapa.

**Diferença consciente em relação a hoje:** um anúncio pausado e reativado sem nunca gastar
aparece com zero também nos dias em que ficou pausado, porque o modelo guarda um intervalo único.
Na prática o gasto é 0; está aceito.

### 8.5 Onde a completude precisa entrar (mapa de 13/09)

| Leitor | Depende? | O que muda |
|---|---|---|
| `fetch_manager_performance_base_v145` (+ `core_v2`) | **sim** | UNION das chaves com o inventário; `ad_count`, `active_count`, `has_active`, `pack_ids`, arrays de procedência, `meta_created_min` |
| `fetch_entity_performance_v145` | **sim** | detalhe e filhos de anúncio que só existe no inventário (senão 404); `ad_count` |
| `fetch_manager_performance_series_v145` | não | zero e ausência já geram o mesmo JSON; só precisa aceitar os `group_keys` novos |
| `fetch_manager_rankings_retention_v2` | não | a curva só usa linhas com `plays > 0` |
| `calculate_pack_stats_essential`, `get_ads_for_pack` | **sim** | contar e listar pelo inventário |
| `detect_pack_conflicts` | sim (hoje gera falso-positivo) | **não** levar o inventário à detecção: somar zero duas vezes não altera nada |
| `batch_update_ad_metrics_enrichment` (planilha) | **sim** | ver §8.7 |
| Médias, números do diagnóstico, rankings, gráficos | não | — |

### 8.6 Teste de aceitação

1. **Diferencial de JSON por tela**, contra a versão atual, no laboratório com o dump de produção
   e vários períodos. Telas: Manager (todas as abas), detalhe, séries, stats do pack e lista do
   pack.
   - Divergências **aceitas e listadas de antemão**:
     - (a) somem os dias anteriores à criação;
     - (b) passam a aparecer os anúncios que o teto de 25 mil cortava;
     - (c) o caso pausa-e-reativa sem gasto (§8.4);
     - (d) conflitos formados só por linha-zero deixam de bloquear.
   - Qualquer outra divergência bloqueia o cutover.
2. **Sabotagens:** cada uma precisa fazer o teste falhar.
   - Tirar o UNION do inventário: o anúncio ativo sem gasto some.
   - Ignorar `ultima_vez_ativo`: um pausado antigo aparece.
   - Ignorar a criação: aparece dia anterior à criação.
3. **Contagem de ativos batendo com o Gerenciador** num conjunto real que tenha anúncios ativos
   sem gasto (o caso 16 + 8 = 24 de junho).
4. **Antes e depois:** tamanho de `ad_metrics`, rollup e mapa; tempo do Manager a frio e a quente;
   duração do refresh.

### 8.7 Leads da planilha em dia sem linha — decisão parcial

A planilha só **atualiza** linha existente. Sem as linhas-zero, o lead de anúncio ativo num dia
sem entrega fica sem onde cair. Hoje são **49 linhas, em 8 packs**.

**Decisão do idealizador (13/09): a planilha NÃO cria linha nesta versão.** Motivo: quem preenche a
data é uma automação do CRM, que às vezes grava data anterior. Foram medidos 129 leads com captura
anterior à criação do anúncio. Criar linha nesses casos inventaria entrega que não houve.

**Em aberto:** aceitar a perda desses ~49 leads, ou criar linha **só** quando a data estiver
dentro da vida do anúncio (`[criação, ultima_vez_ativo]`). É a regra que o idealizador descreveu
como segura, e ela exclui exatamente os casos do CRM.

### 8.8 Riscos

- **Esquecer um leitor:** a tela afetada perde anúncios sem dar erro. O diferencial do §8.6 cobre
  cada rota.
- **`ultima_vez_ativo` depende de o refresh continuar lendo o inventário.** Uma falha do inventário
  (fail-open) não pode **zerar** as datas; elas só deixam de avançar.
- **Custo do UNION nas RPCs do Manager:** medir a frio e a quente. O inventário tem ~60 mil linhas,
  contra as 550 mil que saem.

---

## 8-bis. F6 — descarte da planilha visível num tooltip

**Estado:** ⬜ **aprovado em 2026-09-13**, entra junto com o F5

### O que acontece

A sincronização da planilha diz "sucesso" mesmo quando parte dos leads não entra, e o descarte é
silencioso. Medido em 13/09 na aba DADOS (7 packs do EI.31): 60.308 leads válidos.

| Situação | Leads | Natureza |
|---|---|---|
| `AD_ID = indefinido` | 2.845 | ~2.700 orgânicos (bio do IG, WhatsApp, popup), 95 do WhatsApp do comercial, 34 do YouTube. **Só 3 pagos da Meta** (linhas 3802, 12198, 12641) |
| `AD_ID = {{ad.id}}` | 218 | Todas as variáveis sem preencher: clique pela Biblioteca de Anúncios (bots e espiões) |
| Captura anterior à criação do anúncio | 129 | Data do CRM anterior à real; os UTMs batem com o anúncio |
| ID real que não está em nenhum pack | 46 | 22 de hoje (o próximo refresh resolve); 24 de anúncios fora dos filtros |
| Linha sem ID | 115 | Sem origem rastreável |
| Linha com ID e sem data | 89 | Célula vazia |
| Em outro pack | milhares por pack | Normal: a planilha serve 7 packs |

### O que fazer

Um **tooltip discreto no card da integração**, sem mudar o layout do card, com cada situação,
número e porcentagem. O caso mais crítico, que precisa se destacar, é **ID real ausente dos
packs**.

- Hoje o RPC só separa `not_found` e `out_of_pack`.
- `indefinido`, `{{ad.id}}`, ID vazio e data vazia são classificáveis no Python, antes do RPC.
- "Data fora da vida do anúncio" usa o inventário do F5.
- Seguir o contrato de design (Tooltip do shadcn, `text-2xs`, sem altura por className).

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

### M6 — filtros que casam com anúncio sem impressão ⬜

Achado na revisão do F5 (13/09). Para anúncio sem impressão, a RPC fabrica **0** em CPM, CTR de
link, connect rate e page conv (`schema.sql:2338-2344`). O frontend usa esse valor como veio
(`calculations.ts:148-219`), então uma regra como `CPM < R$ 20` ou `CTR de link < 1%` **inclui
anúncios que nunca rodaram**. Isso afeta os filtros do Manager, os grupos de Board e o Critério.

As outras taxas (hook, CTR, CPR, CPC, CPMQL) já tratam o caso como "sem dado" e não casam com
nada (`evaluate.ts:19-29`).

É independente do F5, mas o F5 **não pode** carregar o erro para os anúncios completados pelo
inventário. Conferir a memória `rule_engine_offered_field_must_be_answerable` antes de mexer.

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
| 2026-09-09 | **F2a** | Proposta de restaurar a detecção **rejeitada pelo dono** (seria desfazer o −12% da 145; medido: 295 ms num Manager de 907 ms). Dano verificado: **nenhum**. O que ficou: o bloqueio **falhava aberto** — grafo indisponível liberava seleção múltipla e "Selecionar todos". Regra extraída em `packConflictGate.ts`, compartilhada pelos 3 caminhos; 13 testes + 4 sabotagens; 446 na suíte | grafo indisponível ⇒ **libera tudo** | grafo indisponível ⇒ **1 pack por vez** — *aguardando deploy* |
| 2026-09-09 | **F2** | Investigação. Passo 1 confirmado (16 buscas p/ 7 refreshes). Passo 2 **derrubado**: não há `Sort`; recorte por dia inútil (99,7% compartilhados); duas passadas com ganho zero (1.392 × 1.314 ms — o "10,7→4,8 s" era cache). Achado: `x_cross_silo` fixo em `false` desde a 145 → camada 2 morta e soma duplicada silenciosa. F2 vira F2a (correção) + F2b (performance) | grafo 6 s a frio, 79×/dia | *diagnóstico corrigido; nada implementado* |
| 2026-09-09 | **F1** | Migration 151 + `_fetch_present_parent_ids` pela RPC. Ideia original (filtrar por ids) **descartada** — teto de 1.000 linhas do PostgREST truncaria em silêncio. Diferencial em 5 silos + 4 sabotagens + 10 testes Python; 650 na suíte | 47 idas, ~1.400 ms, 358 s/dia | 1 ida, **84 ms** — *aguardando deploy* |
| 2026-09-13 | **F5** | Revisão de colaterais: 549.625 linhas sintéticas (78%, não 81,6%); 94% de anúncios hoje não entregáveis; 162.960 anteriores à criação (noite 06→07/09); mapa de leitores em SQL/backend/frontend. **Modelo aprovado**: métricas só com dado real + inventário com primeira/última vez ativo. F3 absorvido. Planilha não cria linha nesta versão (CRM grava data anterior); 49 leads em aberto (§8.7). F6 (tooltip) e M6 (filtros com 0 fabricado) abertos | 550 mil linhas-zero | *aprovado, não iniciado* |
| 2026-09-13 | **F4** | Espera guiada **caiu por medição** (uso ≤ 1% em 4.291 páginas; 2% no dia do `(#4)`, que veio de relatórios criados). Página de 1.000 (diferencial contra a Meta: linhas idênticas; 15–17 s × 25–28 s com ordem alternada) + espera curta crescente com o uso + espera e nova tentativa no limite da Meta. 22 testes, 4 sabotagens, 672 na suíte | 8 páginas, ~27 s, limite derruba o job | 4 páginas, ~16 s, limite espera — *aguardando deploy* |
| 2026-09-13 | **deploy** | F1 (migration renumerada 149→151, aplicada antes do backend) + F2a + F4 + leadscore 147/148 no ar (`095e04f`). 7 refreshes depois do deploy, todos ok, 0 erro de limite. Mesmo pack, tamanho parecido: CA8 135 s → 89 s; CA6 79 s → 57 s. **A observar:** `present_parent_ids` via PostgREST com média ~0,6 s (algumas ~1,8 s), não os 84 ms do lab — suspeita: RLS por linha com JWT do usuário | CA8 135 s · CA6 79 s | CA8 89 s · CA6 57 s — *confirmar em 24 h* |
