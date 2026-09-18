# Plano — editar o período de um pack existente

Escrito em 2026-09-17. Decisão do idealizador: implementar, em duas etapas, com cada
risco medido no laboratório antes de tocar produção. Junto vai um conserto que vale
por si: a atualização passa a respeitar o fim de um pack fechado.

Este documento é o roteiro. Cada passo tem o que fazer, como provar que funcionou e o
que NÃO fazer. Execução cautelosa, um passo por vez, sem pular a prova.

---

## 1. Por que fazer, e por que não "apagar e recriar"

Recriar um pack perde coisas que o usuário não vê na hora:

| Perde | Consequência |
|---|---|
| Compartilhamentos (`pack_shares`, cascata) | Todo membro precisa ser convidado de novo; a seleção de packs de cada um some |
| Integração com a planilha e colunas vinculadas (`ad_sheet_integrations` → `sheet_column_mappings`, cascata) | Refazer; e **quebra em silêncio** regras de Boards e preferências de coluna do Manager que usam `custom:<id>` — passam a mostrar "Coluna excluída" e nunca mais casam |
| Leadscore importado (`ad_metrics.leadscore_values`, `custom_hist`) | Some até ressincronizar |
| Julgamento (`mql_leadscore_min`, `target_cpr`) | Redefinir; não há herança (schema.sql `resolve_pack_mql_leadscore_min`) |
| Histórico de atividade (`pack_action_log.pack_ids`) | O pack novo nasce sem histórico |

Para quem usa planilha ou compartilhamento, a quebra silenciosa dos Boards é pior que
qualquer risco de uma edição bem feita.

## 2. Por que só trocar as datas não funciona (medido no código em 17/09)

1. **Nada lê o período do pack para filtrar dado.** Nenhuma função SQL usa
   `packs.date_start/date_stop`; as telas usam o filtro de datas; os totais do card somam
   tudo o que está no mapa (`calculate_pack_stats_essential`). Encolher sem apagar deixa o
   card somando os dias "removidos".
2. **Toda atualização reescreve o fim do pack** para o `until` da busca
   (`job_processor.py`, `update_pack_refresh_status(date_stop=...)`), inclusive com
   "manter atualizado" desligado — porque o `until` do incremental é sempre hoje
   (`usePackRefresh.ts` manda `getTodayLocal()`; `refresh_pack` não limita).
3. **O inventário só cresce** (`merge_ad_pack_inventory`: `least/greatest`). Anúncio sem
   entrega continuaria aparecendo com zero nos dias removidos.
4. **`packs.ad_ids`, `ads.pack_ids` e `conversion_types` só crescem.**
5. **A trava de atualização é só um aviso.** `refresh_status='running'` é UPDATE sem
   compare-and-set; ninguém lê `refresh_lock_until` antes de começar; o 409 do servidor
   depende de `REFRESH_SERVER_CHAIN_ENABLED` (não confirmado em produção). A fila que o
   usuário vê é do navegador (`REFRESH_MAX_CONCURRENCY = 1` em `usePackRefresh.ts`) — não
   protege contra outro membro nem outra aba.
6. **Sobreposição dobra os números.** Desde a 145 cada pack tem as próprias linhas; dois
   packs cobrindo o mesmo anúncio-dia, selecionados juntos, somam em dobro (medido em
   10/09: R$ 450,99 → R$ 901,98) e o único guarda é o bloqueio de seleção. Editar data é a
   única ação capaz de criar essa sobreposição.
7. **Gravar nunca apaga.** O upsert por (user, pack, ad, date) só escreve o que a Meta
   devolveu; linha que a busca não trouxe fica onde estava. Tudo que "reduz" precisa apagar
   de propósito.
8. **Existem linhas fora do período declarado** (847 no mapa, em produção, migration 146).
   A prévia tem de contar o que existe, não o que a data declara.

## 3. Regras de produto (travadas)

| Regra | Decisão |
|---|---|
| Quem edita | **Só o dono** — mesma classe de renomear/excluir |
| Quando as datas mudam | **Só quando o dado novo chegou completo.** Falhou a busca (GK, teto de páginas, parcial): nada muda, o usuário vê "Não foi possível alterar o período. Nada foi modificado." |
| Encosto | Toda fatia que começa dentro do histórico pede 7 dias (`attribution_window_days` do pack, 7 se nulo) **antes** do primeiro dia que vai ser gravado — a Meta só atribui a conversão ao dia se o clique estiver na janela pedida (medido em 07/09: 204 vs 441 pré-matrículas). O início do pack não leva encosto: é onde o Gerenciador também começa |
| Aviso ao reduzir | "**X dias** saem deste pack, somando **R$ Y**." Sem contagem de anúncios |
| "Manter atualizado" | Terminar antes de hoje **desliga** o toggle. Ampliar não mexe |
| Sobreposição | A edição força a releitura do grafo de conflito; se o período novo cruza outro pack com os mesmos anúncios, o diálogo avisa que os dois não poderão ser analisados juntos |
| Auditoria | `pack_action_log` ganha `pack.date_range` com `{from, to, dias_removidos, investimento_removido, fatia_buscada}` |

### Os quatro casos (pack 01/07 → 31/08, N = 7)

| Edição | Busca na Meta | Grava | Apaga |
|---|---|---|---|
| **Começar antes** → 01/06 | `01/06 → 07/07` | tudo que voltou | nada |
| **Terminar depois** → 15/09 | `25/08 → 15/09` | tudo que voltou | nada |
| **Começar depois** → 15/07 | `15/07 → 21/07` | tudo que voltou | 01–14/07 inteiros; em 15–21/07, só os pares (anúncio, dia) que a busca **não** trouxe (a cauda de cliques anteriores a 15/07) |
| **Terminar antes** → 15/08 | nenhuma | — | 16/08–31/08 |
| As duas pontas | uma busca só, cobrindo o que os casos acima pedem (se as duas ampliam, a janela nova inteira) | | conforme acima |

Por que 07/07 e 25/08: `início_antigo + N − 1` é o último dia que ainda estava sem os
cliques do período novo; `fim_antigo + 1 − N` é onde a consulta precisa começar para o
primeiro dia novo (01/09) vir inteiro.

Por que a cabeça de 15–21/07 apaga só o que não voltou, e nunca "tudo que a busca não
trouxe" em outros dias: um filtro de campanha que deixou de casar faria a busca voltar
vazia e o apagamento levaria o pack inteiro. O apagamento por ausência fica restrito à
cabeça de N dias, que é o único lugar onde ausência tem significado (o clique saiu da
janela). Fora dela, apaga-se por **período**, nunca por ausência.

## 4. Etapa 0 — pré-requisitos (valem sem a feature)

### 0.1 Atualização respeita o fim do pack fechado

**Hoje:** `refresh_pack` usa `until = request.until_date` (hoje) nos dois tipos quando
`auto_refresh` está ligado, e também no `since_last_refresh` quando está desligado. O job
grava `date_stop = until`. Resultado: pack fechado em 15/08 vira "até hoje" no primeiro
"Atualizar pack".

**Conserto:** em `refresh_pack`, com `auto_refresh = false`,
`until = min(request.until_date, pack.date_stop)` nos dois tipos. Se `since > until`
(pack fechado já totalmente lido), a rota devolve 200 com `nothing_to_do` e o frontend
mostra "Este pack está fechado em DD/MM e já está completo" — sem abrir job, sem trava.
Espelho no `refreshWindow.ts` (o diálogo mostra a data que vai ser pedida de fato).

**Prova:** `backend/tests/test_refresh_closed_pack.py` — pack fechado com
`until_date = hoje`: o payload tem `date_stop = pack.date_stop`. Sabotar: remover o
`min()` e ver o teste falhar. Frontend: `refreshWindow.test.ts` com o mesmo caso.

**Efeito em produção:** packs fechados que hoje "andam" a cada atualização param de andar.
É o comportamento certo; registrar em `como-funciona-o-app.md`.

### 0.2 Trava de verdade, compartilhada por atualização e edição

**Hoje:** `update_pack_refresh_status(..., 'running')` é um UPDATE incondicional.

**Conserto:** função SQL `pack_acquire_refresh_lock(p_owner, p_pack, p_actor, p_ttl)`
que faz `UPDATE packs SET refresh_status='running', refresh_lock_until=now()+ttl,
refresh_actor_id=... WHERE id=... AND (refresh_status IS DISTINCT FROM 'running' OR
refresh_lock_until < now()) RETURNING id`. Sem linha de volta = 409
`REFRESH_ALREADY_RUNNING` (o frontend já trata esse código). `refresh_pack` e a rota de
edição passam a chamar a função **antes** de abrir o relatório na Meta. A liberação
continua como está (`success`/`failed` zeram o lock; varredura das 04:37 cobre órfãos).

**Prova:** `supabase/tests/166_trava_de_refresh.test.sql` — duas aquisições seguidas: a
segunda não retorna linha; após `refresh_lock_until` no passado, retorna. Sabotar:
tirar o `WHERE` e ver a asserção falhar. `backend/tests/test_refresh_lock_route.py`:
segunda chamada recebe 409.

**Não fazer:** não depender de `REFRESH_SERVER_CHAIN_ENABLED` para isto. A trava vale
sempre.

### 0.3 Laboratório restaurado do dump atual

`supabase/tests/README.md` tem o roteiro. Conferir que as migrations até a 165 estão
aplicadas (`\df pack_*`, `\d ad_pack_inventory`). `jit=off`. Sem isso nenhuma medição da
Etapa 2 vale.

## 5. Etapa 1 — ampliar (começar antes / terminar depois)

Nada é apagado. Na prática é uma atualização com período escolhido, mais a troca das
datas no fim. Risco baixo; entrega o caso "preciso de mais histórico".

### 1.1 Peça compartilhada: `window_edit_plan(pack, novo_inicio, novo_fim)`

Módulo puro `backend/app/services/pack_window.py`: dado o pack (datas atuais, N) e as
datas pedidas, devolve `{fatia: (since, until) | None, apagar: [...], cabeca: (a, b) |
None, novo_inicio, novo_fim}` seguindo a tabela da seção 3. Sem I/O. Espelho em
`frontend/lib/utils/packWindow.ts` para o diálogo mostrar exatamente o que vai ser
pedido. É a peça que o fatiamento futuro também usará.

**Prova:** `backend/tests/test_pack_window.py` e `packWindow.test.ts` com os quatro
casos, os dois combinados, N = 1 e N nulo (→ 7), e o clamp "nunca antes do início do
pack". Sabotar: trocar `− 1` por `+ 1` e ver os dois falharem.

### 1.2 Rota `PATCH /packs/{id}/date-range` (só ampliar nesta etapa)

Molde: `update_pack_name` (`analytics.py`). Fluxo:

1. `assert_pack_role(dono)`; valida `inicio <= fim`, `fim <= hoje`; rejeita 400 se
   qualquer ponta **reduz** (Etapa 2 libera).
2. Adquire a trava (0.2) — 409 se ocupado.
3. `window_edit_plan` → fatia.
4. Abre o relatório na Meta pela **mesma máquina** de `refresh_pack` (fatoração: a parte
   de "abrir job + payload + chain" vira função reusada pelos dois), com
   `refresh_type = "window_edit"` e no payload `window_edit = {date_start, date_stop,
   dias_removidos: 0, investimento_removido: 0, cabeca: null}`.
5. Registra `pack.date_range` no log com o plano.

### 1.3 Fim do job com `window_edit` no payload

Em `job_processor.py`, no bloco que hoje grava `date_stop = payload.date_stop`:

- Se `window_edit` presente **e** `collection_is_complete()`: grava `date_start` e
  `date_stop` **de `window_edit`**, `last_refreshed_at = max(atual, until da fatia)`
  (nunca retrocede — uma fatia para trás termina no passado), e `updated_at` (já
  acontece; é o que gira a chave do grafo de conflito e do Manager).
- Se a coleta não é completa: o job já falha antes de gravar (`_release_pack_after_failure`).
  Nada a fazer; garantir que `window_edit` não é consumido em nenhum caminho de falha.
- Inventário: `merge_ad_pack_inventory` com a janela da fatia, como hoje (só estende —
  correto ao ampliar).
- Stats, `ad_ids`, `conversion_types`, atribuição: como hoje.
- Cadeia da planilha: como hoje (`chain_sheet_sync`), para os dias novos ganharem leadscore.

**Prova:** `backend/tests/test_window_edit_persist.py` — (a) fatia para trás
(`until < last_refreshed_at`): `last_refreshed_at` não muda e `date_start` recebe o
novo; (b) coleta incompleta: nenhuma das duas datas muda; (c) sem `window_edit`, o
comportamento atual (grava `date_stop = until`) continua idêntico. Sabotar (a):
trocar o `max` por atribuição direta.

### 1.4 Frontend

- Item **"Editar período"** no menu do card (`PackCard.tsx`, ao lado de "Atualizar
  pack"), só para dono; escondido em viewer/editor.
- Diálogo `PackDateRangeDialog`: seletor de datas (o mesmo da criação), linha "Vai buscar
  DD/MM → DD/MM na Meta (inclui N dias de janela de atribuição)", botão desabilitado se
  nada muda. Nesta etapa, reduzir uma ponta mostra "Reduzir o período chega na próxima
  versão — por enquanto, para reduzir, recrie o pack" (texto provisório, sai na Etapa 2).
- Progresso: reusa o toast/polling de `usePackRefresh` (o job é um refresh).
- Ao concluir: `updatePack` com **as duas datas** (hoje o hook só atualiza `date_stop` —
  corrigir em `usePackRefresh.ts:658`), `invalidatePackAds` /
  `invalidateAdPerformance` / `invalidateRankingsRows`, e o grafo de conflito refaz
  sozinho pela chave (`updated_at`).
- Aviso de sobreposição: após concluir, se `usePackConflicts` acusar par novo envolvendo o
  pack, toast informativo "Este pack agora cruza com «X»; os dois não podem ser
  selecionados juntos".
- `useServerHealth.ts:221` derruba `last_refreshed_at` ao reconstruir packs — corrigir
  junto (é o que faz o diálogo de atualização cair no `date_stop`).

**Prova manual (checklist):** pack de teste na conta disjunta (`test@hookify.com`, ver
memória de compartilhamento): começar antes → card mostra o período novo, Manager com
"usar datas do pack" acompanha, os dias novos têm dado, os antigos não mudaram
(comparar gasto por dia antes/depois); terminar depois idem; falha simulada (token
inválido) → nada mudou.

### 1.5 Testes sabotados obrigatórios antes de fechar a etapa

- Falha da Meta não muda nenhuma data (1.3b).
- Fatia para trás não retrocede `last_refreshed_at` (1.3a).
- Atualização depois da edição não desfaz a edição (0.1 + 1.3: pack fechado ampliado
  para 15/09 e "atualizar" → `date_stop` continua 15/09).
- Segunda edição com a trava ocupada → 409 (0.2).

### 1.6 Deploy

Migration 166 (trava) → backend → frontend, nesta ordem. Sem migration de dado.

## 6. Etapa 2 — reduzir (começar depois / terminar antes)

Aqui mora tudo que apaga. Só começa depois da Etapa 1 em produção e das medições de 6.6.

### 2.1 Migration 167 — prévia e recorte

- `pack_trim_preview(p_owner uuid, p_pack uuid, p_start date, p_stop date)` →
  `{dias int, investimento numeric, linhas int}` somando `ad_metrics` do pack com
  `date < p_start OR date > p_stop` (**inclui** as linhas fora do período declarado).
  Sem parâmetro opcional (plano genérico, ver decisões). `SET statement_timeout` próprio
  se a medição de 6.6 pedir.
- `pack_clamp_inventory(p_owner, p_pack, p_start, p_stop)` → recorta
  `ad_pack_inventory.first/last` para dentro da janela e apaga intervalos que ficaram
  vazios; devolve contagens.
- **Sem** RPC de apagamento em massa: o apagamento de `ad_metrics` fica em Python, dia a
  dia por `(user, pack, date)` no índice `ad_metrics_user_pack_date_idx`, como
  `delete_pack` já faz — cada requisição bem abaixo do teto de 8 s do papel de serviço. A
  cascata da FK leva mapa e rollup.

**Prova:** `supabase/tests/167_recorte_de_pack.test.sql` — dois packs do mesmo dono com
o mesmo anúncio-dia (a 145 permite): recortar A **não toca** B; a prévia de A conta a
linha fora do período declarado; o inventário de A encolhe e o de B não. Sabotar: tirar o
`pack_id` do `WHERE` do clamp e ver B encolher.

### 2.2 Rota — ordem das operações (tudo sob a trava)

1. Validação e trava como na Etapa 1; agora aceita reduzir.
2. `window_edit_plan` → `{fatia?, apagar, cabeca?}`.
3. **Se há fatia** (começar depois): abre o job com `window_edit = {..., apagar, cabeca}`
   e devolve. O resto acontece no fim do job (2.3). Nada é apagado antes de a Meta
   responder.
4. **Se não há fatia** (só terminar antes): executa 2.3 direto na rota, síncrono, com
   progresso por heartbeat no mesmo `jobs` (o frontend já sabe acompanhar) — ou, se a
   medição de 6.6 mostrar que packs grandes passam de ~20 s, como job local sem Meta.
   Decidir com o número.

### 2.3 Conclusão da redução (fim do job, ou rota no caso sem fatia)

Só entra com `collection_is_complete()` verdadeiro (quando há fatia).

1. **Grava** o que a Meta devolveu (upsert normal).
2. **Cabeça:** nos dias `cabeca = [novo_inicio, novo_inicio + N − 1]`, apaga de
   `ad_metrics` os pares (pack, dia, anúncio) que **não** vieram na resposta. Lista vem
   do próprio `formatted_data`. Só nesses dias.
3. **Período:** apaga `ad_metrics` do pack dia a dia em `apagar` (dias fora da janela
   nova, do período antigo) **mais** uma varredura final por `(user, pack)` com
   `date < novo_inicio OR date > novo_fim` (as linhas fora do período declarado).
4. **Inventário:** `pack_clamp_inventory`.
5. **Anúncios:** `packs.ad_ids` := anúncios com alguma linha viva no mapa **ou** intervalo
   vivo no inventário; para os que saíram, `batch_remove_pack_id_from_arrays` em `ads`;
   se `pack_ids` ficou vazio, apaga o `ads` e a miniatura só se ninguém mais referencia
   (`_delete_unreferenced_thumb_paths`, como `delete_pack`).
6. **`conversion_types`:** recalcular do que sobrou (hoje só cresce).
7. **Datas:** `date_start`, `date_stop` novas; `last_refreshed_at = min(atual, novo_fim)`;
   `auto_refresh = false` se `novo_fim < hoje`.
8. **Stats:** `calculate_pack_stats_essential` (lê o mapa; a cascata já o limpou).
9. **Log:** `pack.date_range` com `dias_removidos`, `investimento_removido`, `linhas`.
10. Libera a trava (`success`).

Se qualquer passo de 2–6 falhar no meio: o pack fica marcado `failed` com o motivo, as
datas **não** mudam (passo 7 é o último), e a mensagem ao usuário diz que o período não
foi alterado e que uma "atualização de todo o período" repõe o que faltar. Não há
transação atravessando os passos (são requisições PostgREST separadas) — por isso a
ordem: primeiro o que é idempotente e recuperável por refresh (apagar), por último o que
muda o contrato (datas).

### 2.4 Frontend

- O diálogo passa a aceitar reduzir. Ao mudar as datas, chama a prévia (debounce 300 ms)
  e mostra: "**9 dias** saem deste pack, somando **R$ 3.240**. Para trazer de volta,
  amplie o período e atualize." Botão vira destrutivo (vermelho) quando há dias saindo.
- Sem contagem de anúncios no aviso (decisão).
- Se `novo_fim < hoje` e o toggle está ligado: linha "O «manter atualizado» será
  desligado".

### 2.5 Testes sabotados obrigatórios

- Recorte de A não toca B (2.1).
- Cabeça: pares ausentes na resposta somem; pares presentes ficam; dia fora da cabeça
  com par ausente **fica** (é a regra "ausência só vale na cabeça"). Sabotar: aplicar a
  regra de ausência a todos os dias e ver o teste pegar.
- Coleta incompleta: nada apagado, datas intactas.
- Inventário encolhe; anúncio sem dia e sem intervalo sai de `ad_ids` e de
  `ads.pack_ids`; miniatura referenciada por outro pack **não** é apagada.
- Linha fora do período declarado é apagada e contada na prévia.
- `auto_refresh` desliga ao fechar antes de hoje.
- Atualização depois do corte não traz os dias de volta (0.1 garante o `until`; o
  `since` é `last_refreshed_at − N ≥ novo_inicio` pelo clamp existente).

### 2.6 Medições no laboratório (antes do deploy da Etapa 2)

Tudo com dump atual, `jit=off`, sessão limpa, `VACUUM (ANALYZE)` entre medições (ver
armadilhas na decisão da 145).

| O que medir | Como | Critério para seguir |
|---|---|---|
| Apagamento grande | Recortar 60 dias do maior pack do dump (dia a dia, como 2.3) | Cada requisição < 2 s; total reportado; se > 20 s, redução vira job |
| Efeito no grafo de conflito | `detect_pack_conflicts` antes / logo depois / após `VACUUM (ANALYZE)` do mapa e de `ad_metrics` | Se "logo depois" degradar como em 08/09 (1,1 → 10,3 s), a rota roda `VACUUM (ANALYZE)` nas duas tabelas ao fim do recorte (via função SQL `SECURITY DEFINER` dedicada; medir o custo dela) |
| Prévia | `pack_trim_preview` no maior pack, frio e morno | < 500 ms; senão índice ou `SET statement_timeout` |
| Clamp do inventário | maior pack | < 2 s |
| Stats após recorte | `calculate_pack_stats_essential` | Bate com soma direta do que sobrou (diferencial) |
| Manager após recorte | `fetch_manager_performance_base_v155` com o pack recortado | Totais = soma de `ad_metrics` restante; nenhum dia removido aparece |

Registrar os números neste arquivo (seção 9) antes do deploy.

### 2.7 Deploy

Migration 167 → backend → frontend. Primeiro recorte em produção: num pack de teste da
conta disjunta, com `pack_trim_preview` conferida à mão contra `SELECT` direto antes de
confirmar.

## 7. Custo para o app

| Momento | Custo |
|---|---|
| Caminho de leitura (Manager, Insights, Boards) | **zero** — nenhuma consulta nova, nenhum campo novo |
| Diálogo aberto, datas mudando | 1 agregação por ajuste (debounce), dezenas de ms |
| Só terminar antes | sem Meta; apagamento dia a dia, alguns segundos (medir em 6.6) |
| Qualquer caso com busca | 1 relatório da Meta do tamanho da fatia + encosto — igual a um "Atualizar pack" daquele trecho, tipicamente 25–80 s; 30 dias × 50 anúncios cabem numa página (limite 5.000) |
| Disco | reduzir **libera** espaço (métricas + rollup + mapa + miniaturas órfãs) |

## 8. Riscos que ficam

| Risco | Onde mora | Controle |
|---|---|---|
| Período longo falha mais na Meta (GK) | busca da fatia | 3 tentativas automáticas já existem; falha não muda nada; fatiamento continua adiado |
| Apagamento em massa degrada consultas até o autovacuum | 2.3 passo 3 | medição 6.6 + `VACUUM (ANALYZE)` ao fim se necessário |
| Falha ao gravar o vínculo pack↔dia é engolida (já existe) | `upsert_ad_metrics` mapa | não piora; anotado para conserto separado (fazer o job falhar em vez de logar) |
| Filtro do pack que não casa mais | busca vazia | ausência só apaga na cabeça; fora dela apaga-se por período |
| Sobreposição criada pela edição | grafo de conflito | releitura pela chave `updated_at` + aviso no fim |
| Loja do navegador com data velha | `usePackRefresh`, `useServerHealth` | corrigidos em 1.4 |

## 9. Registro de execução

Preencher conforme os passos fecham: data, o que subiu, medições, surpresas.

| Passo | Data | Resultado |
|---|---|---|
| 0.1 | 2026-09-17 | Regra extraída para `backend/app/services/pack_window.py` (`plan_refresh_window`, `effective_until`); rota usa a peça; espelho `refreshUntil` em `refreshWindow.ts` e diálogo mostra o fim real. Testes: `test_pack_window.py` (15), `test_refresh_closed_pack.py` (3, pela rota até o `time_range` e o payload), `refreshWindow.test.ts` (+3). Sabotagem executada: sem o `min()`, 4 falham. Suíte do backend 864 verdes, `tsc` limpo. Decisão: o caso "pack fechado já completo" NÃO vira 200 `nothing_to_do` — com recuo ≥ 1 o `since` nunca passa do `date_stop`, então a atualização de um pack fechado sempre relê os últimos N dias (barato, converge); o único `since > until` real é `until_date` no passado, que continua 400. |
| 0.2 | 2026-09-17 | Migration `166_trava_de_atualizacao_do_pack.sql` (`pack_acquire_refresh_lock`, compare-and-set, SECURITY DEFINER, EXECUTE só para service_role). Aplicada no laboratório; `supabase/tests/166_trava_de_refresh.test.sql` = 12 asserções; sabotagem (sem o compare) falha em B1. Backend: `supabase_repo.acquire_pack_refresh_lock`; `refresh_pack` adquire ANTES de abrir o relatório e devolve 409 com o job ativo (helper `_find_active_refresh_job`) — a decisão deixou de depender de `REFRESH_SERVER_CHAIN_ENABLED`. Testes do guard reescritos (3); sabotagem na rota (ignorar o resultado) derruba 2. Suíte: 864 verdes. **DEPLOY: a 166 tem de estar em produção ANTES do backend** — sem a função, toda atualização cai em 500. |
| 0.3 | 2026-09-17 | Laboratório já no dia: 42 packs, 688 mil linhas, 141/154/155/165 presentes (`reloptions` do mapa em 0.02). Nada a refazer. |
| 1.1–1.6 | 2026-09-18 | **Desenho**: em vez de rota nova, `refresh_type = "window_edit"` na própria rota de refresh (herda trava, job, GK retry, cadeia da planilha, 409, log); `RefreshPackRequest` ganhou `date_start`/`date_stop`. **Peça**: `pack_window.plan_window_edit` (+ `WindowEditPlan.as_payload`), espelho `lib/utils/packWindow.ts`. **Fim do job**: `JobProcessor._finish_pack_refresh` → `supabase_repo.apply_pack_window_edit` (datas novas, âncora nunca retrocede, `auto_refresh_off`, `updated_at`); coleta vazia deixou de deixar o pack `running` (refresh comum libera sem mexer em data; edição aplica as datas — período sem entrega é válido). **Frontend**: `PackDateRangeDialog` (mostra a fatia e a janela), item "Editar período" no card (só dono), `usePackRefresh` leva `windowEdit` até o `refreshPack` e atualiza AS DUAS datas + `last_refreshed_at` no store; `useServerHealth` passou a carregar `last_refreshed_at`/atribuição; feed traduz `pack.date_range`. **Testes**: `test_pack_window_edit.py` (18), `test_window_edit_persist.py` (7), `test_refresh_window_edit_route.py` (8), `packWindow.test.ts` (9). Sabotagens: `n−1`→`n+1` (emenda), `1−n`→`−n` (fim), sem `max(new_start)`, sem o `dono`, sem o `reduces`, sem o ramo `window_edit` no job, `max(candidates)`→`slice_until` — todas derrubam o teste que deveriam. Suítes: backend 897 verdes, `tsc` limpo, design-system ok. **Pendente (manual, precisa da Meta)**: checklist 1.4 na conta disjunta. |
| 2.6 medições | | |
| 2.1–2.7 | | |
