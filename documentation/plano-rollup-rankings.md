# Plano: rollup + RPC em passada única + leadscore em histograma

Data: 2026-08-26. Estado: **fases A–E concluídas em produção em 2026-08-26.** Cutover
medido no banco, alternando as versões: v116 8-12 s → v130 **1,2 s** (a RPC do Manager),
zero arquivo temporário; série (131) 4-11,6 s → 0,33 s. Pendente: fase F (remedir instância e `work_mem` com CPU
saudável, rename §9) e a fase 2 do cache (IndexedDB), agora conforto e não urgência.
Decisões do usuário: histograma de leadscore entra na v1; instância continua MICRO até o
rollup medir; a nomenclatura nova é **"performance"** (artefatos novos nascem
`ad_performance_*`; a entry `fetch_manager_rankings_core_v2` e as rotas `/rankings` só mudam
num passe dedicado depois do cutover — ver §9).

> **Duas mudanças de desenho medidas no lab (2026-08-26), nesta ordem:**
>
> 1. As duas tabelas "altas" do plano (`ad_conversions_daily` com uma linha por chave e
>    `ad_leads_daily` com uma linha por score) viraram **uma tabela `ad_performance_daily`
>    com uma linha por anúncio-dia e arrays paralelos** (migration 128). A forma alta custava
>    **352 MB + 38 MB** (1,95 M + 212 mil linhas; o cabeçalho fixo por linha do Postgres pesava
>    mais que o dado); com arrays, 61 MB.
> 2. Essa tabela virou o **read model completo** do anúncio-dia (migration 129): também os
>    números e as chaves de agrupamento. Motivo: a RPC nova ainda fazia 42 mil lookups em
>    `ad_metrics` só para ler 14 números — e selecionar poucas colunas não reduz I/O, a página
>    de heap é lida inteira (linha de ~1 KB, 8 por página). O plano original acertou sobre CPU
>    e errou sobre I/O. Custo: 154 MB (260.709 linhas, ~500 B — os `numeric` e os 4 arrays
>    pesam), 3× mais estreita que `ad_metrics` e sem JSON. A RPC (§3) não lê `ad_metrics`
>    além das ~77 linhas representantes.
>
> **Resultado medido no lab (mesma máquina, quente, work_mem 3,5 MB na sessão):** cenário real
> (3 packs, 57 dias, `action:purchase`): v116 **1.100 ms → v130 470 ms**, payload 1.052 KB →
> 569 KB (leads como histograma); cenário pesado (30 packs, 1 ano, tipos disponíveis): v116
> **3,6 s → 1,8 s**. Saída idêntica (diferencial da fase C).

## 0. O problema, em uma linha por número

- Uma carga do Manager custa **~3,3 s de CPU do banco** (2,5 s da RPC + 0,75 s series) e
  **470 MB de arquivos temporários**, para devolver 77 linhas. Um app CRUD custa ~3 ms.
- Dos 2,5 s: ~40% são **releituras** das mesmas 64 mil linhas por 8 etapas; ~20% a
  deduplicação (que em pack de dono único remove zero linhas); ~20-25% **abrir JSON** de
  conversões linha a linha; 17% (quente) a 45% (frio) buscar linhas largas de ~1 KB.
- A instância (`t4g.micro`, 1 GB) está em **swap a 98% a semana inteira**; 30 usuários
  simultâneos gerariam 14 GB de temporários — não escala com dinheiro, só com desenho.

## 1. Desenho alvo

```
ESCRITA (refresh de pack / sync de planilha)          LEITURA (Manager, Explorer, Plano, GOLD, Insights)
ad_metrics  ─trigger─►  ad_conversions_daily            RPC nova: UMA passada
   (cru, verdade,       ad_leads_daily (histograma)       map ⋈ ad_metrics[colunas estreitas]
    fica como está)                                        ⋈ conversões pré-somadas por (ad, dia)
                                                           ⋈ leads pré-somados por (ad, dia)
                                                         → GROUP BY grupo → 77 linhas
```

Princípios:
- **`ad_metrics` continua a fonte da verdade.** O rollup é derivado e descartável; pode ser
  reconstruído a qualquer momento com uma passada local (sem voltar ao Meta).
- **Manutenção por trigger, não por código Python.** Há 4 escritores de `ad_metrics`
  (2 upserts em `supabase_repo`, 1 delete, e a RPC `batch_update_ad_metrics_enrichment`
  do sync de leadscore). Um trigger cobre todos — inclusive os futuros — sem ninguém
  precisar lembrar. Delete propaga por FK `ON DELETE CASCADE`.
- **A RPC nova é reescrita em passada única.** Copiar as 25 etapas apontando para as
  tabelas novas desperdiçaria o ganho.
- **Contrato de saída idêntico**, exceto `leadscore_values` (array) → `leadscore_histogram`
  (objeto `{score: quantidade}`). Provado por teste diferencial antes da troca.

## 2. Tabelas (migration 128) — forma final, implementada e provada no lab

Arquivos: `supabase/migrations/128_rollup_de_performance_conversoes_e_leads.sql` (mecanismo),
`supabase/scripts/backfill_128_rollup_de_performance.sql` (backfill por usuário via psql),
`supabase/tests/128_rollup_de_performance.test.sql` (32 asserções; 3 sabotagens provadas),
`supabase/tests/README.md` + `lab_prep.sql` (como montar o laboratório local).

### `conversion_keys` — dicionário
`id integer identity`, `key text unique` no formato `'conversion:<action_type>'` /
`'action:<action_type>'` (**o mesmo** de `p_action_type` e de `packs.conversion_types`).
Append-only; 81 chaves hoje, 31 bytes em média — no array cabem em 4.

### `ad_performance_daily` — o read model do anúncio-dia (128 + 129)
| coluna | tipo | nota |
|---|---|---|
| user_id, ad_id, date | | PK; FK → `ad_metrics(user_id, ad_id, date)` `ON DELETE CASCADE ON UPDATE CASCADE` |
| account_id, campaign_id, adset_id, ad_name | text | chaves de agrupamento/filtro (129). Nomes de campanha/conjunto ficam FORA (68/48 B em média; vêm da linha representante) |
| impressions, clicks, inline_link_clicks, lpv, plays, thruplays, reach | bigint | saneados (`coalesce 0`) como a v116 (129) |
| spend, video_watched_p50/p75, hold_rate, frequency | numeric | idem |
| hook_value, scroll_stop_value | numeric | `coalesce(hook_rate, curva[3]/100)` — a expressão da v116 calculada na escrita (129) |
| conv_key_ids | integer[] | ordenado por id; `conv_values[i]` é o valor de `conv_key_ids[i]` |
| conv_values | numeric[] | SUM por chave, saneado como a RPC (`[^0-9.-]`); inválido conta 0 em vez de estourar |
| lead_scores | numeric[] | ordenado; histograma — `lead_qtys[i]` é quantas vezes `lead_scores[i]` aparece |
| lead_qtys | integer[] | |

- Uma linha por anúncio-dia, sempre (desde a 129). CHECK: cardinalidades pareadas.
- Medido no lab (dump de 2026-08-26): **260.709 linhas, 129 MB heap + 13 MB PK = 154 MB**
  (só eventos+leads, na 128: 164.661 linhas / 61 MB). Escala linear com anúncio-dias.
- Leitura da chave pedida: `conv_values[array_position(conv_key_ids, :id)]` (~7 inteiros).

### Derivação — uma fonte de verdade
`ad_performance_parse_value(text)`, `ad_performance_derive_conversions(actions, conversions)`
→ (chave, valor), `ad_performance_derive_leads(numeric[])` → (score, qty),
`ad_performance_curve_point(curva, i)`, `ad_performance_derive_row(ad_metrics)` → a linha
completa. Trigger, rebuild e checagem usam as mesmas funções: mudar a semântica num lugar
muda em todos. O teste da 128 pegou um bug real da 129 (curva NULL → `hook_value` NULL).

### Triggers `ad_metrics_rollup_sync_ins` / `_upd` (por STATEMENT, tabelas de transição)
Worker único `ad_performance_rollup_apply(ad_metric_key[])`: apaga e recomputa as chaves
recebidas relendo `ad_metrics`. O de UPDATE compara OLD/NEW e só recomputa linhas cujas
`actions`/`conversions`/`leadscore_values` **mudaram de fato** (o Postgres não aceita
tabela de transição com `UPDATE OF colunas`; comparar é melhor: upsert que regrava o mesmo
JSON não paga nada). Mudança só de chave propaga pela FK.
Custo medido (lote de 500 linhas reais): upsert com JSON alterado 28 → 171 ms
(+0,29 ms/linha); upsert idêntico 52 ms; insert 125 ms; delete com cascade 15 ms.

### Backfill e checagem
`ad_performance_rollup_rebuild(user_id)` — apaga e regrava o silo do usuário (idempotente).
O script roda um usuário por transação, do menor para o maior, **via psql direto** (o
maior tem 122 mil linhas; PostgREST estouraria o `statement_timeout`). Lab: 2,3 min no
total; na t4g.micro esperar 3-5× isso — rodar com o app ocioso.
`ad_performance_rollup_consistency_check([user_id])` compara a derivação **completa** nos
dois sentidos (`EXCEPT ALL`), não só contagens. **Tem de devolver zero linhas** (lab: zero).

## 3. RPC nova (migration 130): `fetch_manager_performance_base_v130`

(Nome novo já na família "performance". A entry `fetch_manager_rankings_core_v2` continua
com o nome antigo até o passe de renomeação da §9 — é o contrato com o backend e o ponto
de rollback.) Com a forma final da §2, os itens 2-4 abaixo viram: `left join
ad_performance_daily d` pela chave de `ad_metrics`; valor pedido =
`coalesce(d.conv_values[array_position(d.conv_key_ids, v_key_id)], 0)`; tipos disponíveis
= `distinct unnest(d.conv_key_ids)` ⋈ `conversion_keys`; histograma por grupo =
`unnest(d.lead_scores, d.lead_qtys)` → `sum(qty) group by score` → `jsonb_object_agg`.

Regras herdadas das memórias do projeto (não negociáveis):
- `SET plan_cache_mode = force_custom_plan` **e** `SET search_path` na `CREATE FUNCTION`
  (o `CREATE OR REPLACE` descarta cláusulas não repetidas; gate de CI cobra).
- Entrada = ator; donos vêm de `resolve_pack_access`; pack inacessível → erro, nunca
  agregado parcial.
- Dirigir a consulta pelo mapa (`unnest(owners) ⋈ ad_metric_pack_map`), nunca por
  `user_id = any(...)` (perde o índice composto; medido 67 → 4010 ms).
- Dedup cross-silo **só quando há mais de um dono** (ramo condicional; dono único pula o
  `DISTINCT ON` que hoje ordena 64 mil linhas para remover zero).

Forma:
1. `sel` — o mapa filtrado (pack, período) ⋈ `ad_metrics` **selecionando só as colunas
   necessárias** (ids, nomes, os ~15 números). Sem `select am.*`: a largura da linha é o
   que faz as ordenações caberem (ou não) em memória.
2. `conv_sel` — `SUM(value)` de `ad_conversions_daily` para `conv_key = p_action_type`,
   por `(ad_id, date)` — subconsulta agregada, **nunca join que multiplique linhas**.
3. `conv_all` — quando `p_include_available_conversion_types` (só o Explorer): `GROUP BY
   conv_key` sobre as linhas da seleção. Barato com o índice.
4. `leads_sel` — `SUM(qty) GROUP BY (ad_id, date, score)` → depois por grupo.
5. **Um `GROUP BY group_key`** que produz de uma vez: somas, contagens, representante
   (argmax por impressões, via `max(row(impressions, ad_id))` ou janela única), packs e
   contas por grupo, histograma de leads (`jsonb_object_agg(score, sum(qty))`).
6. Totais/médias/`per_action_type`/paginação como hoje, sobre as ~77 linhas de saída.
7. A **entry** (`fetch_manager_rankings_core_v2`, status/budget/ad_count/tags) continua
   igual e é repontada para a base nova. Repontar de volta é o rollback (2 s).

Saída: os mesmos 5 blocos (`data`, `averages`, `header_aggregates`, `pagination`,
`available_conversion_types`) e os mesmos 39 campos por linha, com `leadscore_values`
substituído por `leadscore_histogram`.

Meta medida: fase A (buscar) cai ~10× em bytes; B some no dono único; C e D deixam de
existir. Esperado **~0,3-0,5 s** quente, sem arquivo temporário.

## 4. Teste diferencial (obrigatório antes da troca)

Script `backend/scripts/diff_rankings_rollup.py`:
- Para cada usuário × {cada pack sozinho, todos os packs} × 4 `group_by` × {sem evento,
  evento mais usado do pack} × período do pack: chama a base antiga e a nova com os
  **mesmos parâmetros** e compara JSON canônico (linhas por `group_key`, médias, header,
  paginação, tipos disponíveis). Leads: `sorted(array)` vs expansão do histograma.
- Tolerância numérica: zero em inteiros; `1e-9` relativo em razões (ordem de soma).
- **Onde rodar:** de preferência num Postgres 17 local com `pg_restore` do dump (o
  `pg_dump` já roda daqui; zero impacto na produção, milhares de pares em minutos). Se não
  houver Postgres local, amostra reduzida em produção **de madrugada** — cada par custa
  ~4-20 s de CPU numa máquina em burst.
- Critério: **zero divergências.** Qualquer diferença é bug ou semântica a decidir — não se
  troca com diferença conhecida.

## 5. Leadscore em histograma — o que muda fora do banco

Backend (`analytics.py`):
- `/rankings`: repassa `leadscore_histogram`. `_count_mql` / `_sum_count_leadscore` ganham
  versão para histograma (contar `qty` com `score >= corte`, soma `score*qty`). As 8 telas
  de detalhe continuam lendo o array cru de `ad_metrics` — **fora do escopo** desta v1.

Frontend (**feito, 2026-08-26** — mais simples que o desenhado):
- `lib/api/schemas.ts`: `leadscore_histogram: z.record(z.string(), z.number()).optional()`
  nos dois schemas de linha (o array continua aceito: telas de detalhe leem ad_metrics cru).
- `lib/utils/mqlMetrics.ts`: `normalizeLeadscoreValues` aceita o histograma e o EXPANDE
  para array (ordenado) — todo consumidor (média, corte de MQL ajustável, CPMQL, taxa) fica
  intocado na lógica. `getLeadscoreRaw(row)` (histograma ?? array) e `hasLeadscoreData(row)`
  centralizam a leitura; 11 pontos de leitura direta trocados (calculations, manager,
  opportunity, sharedAdDetail, AdDetailsDialog, GenericCard, InsightsModal, explorer/types).
- `lib/utils/__tests__/mqlMetrics.test.ts`: equivalência array × histograma em 100 casos
  gerados (multiconjunto, média, MQL em 5 cortes, CPMQL), grafias de chave, cache por
  referência. `tsc` limpo.
- O corte de MQL continua ajustável na tela sem refetch (regra da memória
  `manager_rpc_cost_model`: nunca mandar médias prontas; o histograma é somável).
- Payload medido (cenário real): 1.052 KB → 569 KB antes de gzip.

## 6. Ordem de execução e critérios de saída

| # | Entrega | Critério de pronto | Estado (2026-08-26) |
|---|---|---|---|
| A | Migration 128: tabela + trigger + backfill + consistency check | check = 0 diferenças; trigger provado por teste | **feito em produção** (backfill 3 min, zero divergências) |
| A' | Migration 129: read model completo (números + chaves) | idem; teste da 128 estendido (32 asserções, 3 sabotagens) | **feito em produção** (backfill 3 min, zero divergências, 154 MB) |
| B | Migration 130: `fetch_manager_performance_base_v130` + entry repontada | gate verde; medido no lab: 470 ms real / 1,8 s pesado | **aplicada em produção** (cutover, linha E) |
| C | Diferencial `backend/scripts/diff_rankings_rollup.py` | zero divergências no conjunto completo | **feito: 511/511 idênticos, 0 diferenças** (lab, 2026-08-26) |
| D | Histograma no frontend | `tsc` + `node:test` verdes | **feito** (backend não muda: `/rankings` repassa a linha) |
| E | Cutover | aplicar 130 + deploy D juntos; medir antes/depois em produção; rollback = reaplicar 122 | **feito 2026-08-26** (deploy `aec7f74`, 130 aplicada): em produção, alternando, v116 **8-12 s** (594 MB de temporário lidos, 345 escritos) → v130 **1,2 s**, zero temporário |
| F | Pós | memória + `decisoes-tecnicas.md`; remover `usePackAds`/`useMultiplePackAds` (mortos); refazer teste de `work_mem` com CPU saudável | pendente |

Regras de processo herdadas desta semana:
- Toda migration: `SET` explícitos, comentário com o porquê, `pg_dump` + `schema_map` depois.
- Todo mecanismo novo: **sabotagem deliberada** confirmando que o teste pega.
- Nenhuma medição vale sem o teste de CPU pura antes (`sum(generate_series(1,3e6))`
  ≈ 300-600 ms saudável). Nunca rodar carga enquanto alguém usa o app.
- Deploy: conferir `📌 Código a deployar` contra o último commit.

## 7. O que fica de fora, de propósito

- **Fase 2 do cache (IndexedDB)**: depois; com leitura a ~0,4 s, vira conforto, não urgência.
- **Telas de detalhe (8) migrarem para o rollup**: v2. Hoje leem `ad_metrics` cru.
- **Tirar os JSON pesados de `ad_metrics`** (deixá-la estreita): v2, depois das telas.
- **Cache de resultado no servidor**: só com número mostrando repetição entre usuários.
- **Instância**: decisão adiada por escolha do usuário; remedir após o cutover com a
  mesma régua (`carga.sh` + CPU pura).

## 8. Escalabilidade — como isso se comporta com 100× o volume

- Escrita: trigger por linha = custo constante por anúncio-dia importado; refresh cresce
  linear. Sem `REFRESH` global de view materializada (que seria O(tudo) por refresh e foi
  descartado por isso).
- Leitura: custo ∝ linhas da seleção (período × packs), não do banco inteiro. Com
  linhas estreitas e sem JSON, 30 cargas simultâneas ≈ 12 s de CPU total em vez de 99 s e
  zero temporários em vez de 14 GB.
- Armazenamento: +~150 MB hoje; a 100× (~15 GB de derivadas) → particionar
  `ad_conversions_daily` por mês; a consulta não muda.
- Ponto de atenção real em escala: o **Meta API** (limite de chamadas) e o refresh,
  não o banco. Fica para o plano de produção.

## 10. Série diária (sparklines) no read model — migration 131 (2026-08-26)

Depois do cutover da 130, os prints do Manager mostraram o próximo gargalo: `series`
**11 s** na tela (produção: 181 chamadas, 1,7 s de média, 12,6 s no pior caso, 1,3 GB de
temporário acumulado). Dois desperdícios: lia `ad_metrics` cru (o mesmo custo que a 130
tirou da core) **e lia o período inteiro (57 dias) para usar só a janela (`SERIES_WINDOW =
5`)**.

`fetch_manager_performance_series_v131`: seleção no mapa restrita à janela, linhas do read
model, MQLs/soma/contagem do dia direto do histograma (`unnest(lead_scores, lead_qtys)`),
conversão por `array_position`. `fetch_manager_rankings_series_v2` vira wrapper fino
(padrão da core); rollback = reaplicar a função da migration 110. **Contrato idêntico e
nenhuma mudança fora do banco**: a série nunca expôs arrays de leadscore (calcula por dia
com o corte do pack). Lab: saída byte a byte igual no cenário real, 405–478 ms → 146–152
ms. Diferencial: `diff_rankings_rollup.py --series` — **496/496 cenários idênticos**.
**Produção (2026-08-26, aplicada):** mesmas 150 chaves, janela 5 — **11,6 s fria / 4,0 s quente → 0,33 s**.

## 9. Passe de renomeação "rankings" → "performance" (depois do cutover, não junto)

Decidido em 2026-08-26: o termo novo é **performance** (o alias `/analytics/ad-performance`
e os hooks `useAdPerformance*` já existiam em voo). Não se renomeia junto com o rollup —
tocaria os mesmos arquivos (`analytics.py`, `hooks.ts`, `schemas.ts`, `schema.sql`),
contaminaria o diferencial (uma divergência passaria a ter duas causas) e tiraria a
trivialidade do rollback (repontar uma entry de nome conhecido).

Regra até lá: **artefatos novos nascem com o nome novo** (`ad_performance_daily`,
`ad_performance_*`, `fetch_manager_performance_base_v130`); o que existe fica.

Depois, um passe mecânico em 3 commits por camada, cada um verificado (`tsc`, `pytest`,
testes de contrato): frontend (hooks/tipos/queryKeys) → backend (rotas novas ficam;
`/rankings/**` vira alias por um ciclo de deploy — frontend antigo em cache não pode
quebrar) → SQL por último (migration com `SET` explícitos + gate `check_plan_cache_mode_gaps`).
Tamanho medido: 914 ocorrências em 133 arquivos. **Fora do passe:** `lib/utils/metricRankings.ts`
(`calculateGlobalMetricRanks`, `getMetricRank`) é o conceito legítimo de *rank de um anúncio
por métrica*, não a nomenclatura depreciada.
