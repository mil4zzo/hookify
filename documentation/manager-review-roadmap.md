# Roadmap — Revisão da página Manager (Otimize)

> Origem: `/comprehensive-review-full-review` da página Manager (2026-06).
> Este documento é o **roadmap vivo** dos achados dessa revisão. Itens novos podem
> ser adicionados por nós conforme surgirem. A coluna **Estado** reflete o que já
> foi implementado.

**Legenda de estado:** ✅ implementado · 🔲 pendente · 🟡 parcial · ⛔ decidido não fazer

---

## TL;DR da revisão

Nenhum problema crítico (P0). A segurança está sólida — todas as RPCs `SECURITY DEFINER`
validam `auth.uid() = p_user_id` e o backend usa o JWT do usuário. A arquitetura de
performance é madura (virtualização, séries sob demanda, patch in-place de status).
A revisão encontrou **1 bug P1**, um punhado de P2s reais e dívida de duplicação
considerável no `page.tsx`. Cobertura de testes da camada de analytics era zero.

**Escopo revisado:** [page.tsx](../frontend/app/manager/page.tsx) (650 linhas),
[ManagerTable.tsx](../frontend/components/manager/ManagerTable.tsx) (1.113 linhas),
[TableContent.tsx](../frontend/components/manager/TableContent.tsx), hooks
([useFilters.ts](../frontend/lib/hooks/useFilters.ts),
[usePacksAds.ts](../frontend/lib/hooks/usePacksAds.ts),
[useLoadPacks.ts](../frontend/lib/hooks/useLoadPacks.ts),
[useAdStatusControl.ts](../frontend/lib/hooks/useAdStatusControl.ts),
[hooks.ts](../frontend/lib/api/hooks.ts)), backend
[analytics.py](../backend/app/routes/analytics.py) (3.286 linhas) e as RPCs
`fetch_manager_rankings_*` no schema.

---

## Tabela-resumo (status de implementação)

| # | Prioridade | Item | Arquivo | Estado |
|---|---|---|---|---|
| 1 | P1 | `useLoadPacks` não atualiza datas de packs já existentes no store | `useLoadPacks.ts` | ✅ |
| 2 | P2 | Cache local de séries (`seriesCacheByTab`) não invalidado no pack refresh | `page.tsx` | ✅ |
| 3 | P2 | `placeholderData` assíncrono inerte em `usePacksAds` | `usePacksAds.ts` | ✅ |
| 4 | P2 | Hooks de drill/children não threadam o abort signal | `hooks.ts` / `endpoints.ts` | ✅ |
| 5 | P2 | Batch `.in_()` de 500 itens na hidratação de transcrição (regra: 200) | `analytics.py` | ✅ |
| 6 | P2 | RPC pesada de "Criativos" dispara mesmo em outras abas | `page.tsx` | ✅ Fase 1 + 2 |
| 7 | P2 | `actionTypeOptions` nunca encolhe | `page.tsx` / `filters.ts` | ✅ |
| 8 | P2 | Datas sem validação no contrato do backend (422 vs 500) | `analytics.py` | ✅ |
| B1 | P3 | Duplicação dos 4 blocos request→map→series em `page.tsx` (~300 linhas) | `page.tsx` | ✅ (= #6 Fase 2) |
| B2 | P3 | `setActiveManagerTab` dentro de `useMemo` (setState em render phase) | `page.tsx` | ✅ |
| B3 | P3 | CSV sem guard de formula injection | `exportManagerCsv.ts` | ✅ |
| B4 | P3 | Seleção em lote (`rowSelection`) sobrevive a mudança de filtro | `ManagerTable.tsx` | ✅ |
| B5 | P3 | `serverAverages` nunca resetado (médias do período anterior) | `page.tsx` | ✅ (resolvido junto do #6 Fase 1) |
| B6 | P3 | Toast de slow-loading sem cleanup no unmount | `ManagerTable.tsx` | ✅ |
| B7 | P3 | Reset de `actionType` para conjunto vazio de opções | `filters.ts` | ✅ |
| B8 | P3 | `graceCutoff` morto | `tierConfig.ts` | ✅ |
| B9 | P3 | Migração `any` → tipado na matemática de métricas / cache de séries | `page.tsx` | 🔲 |
| T1 | — | Cobertura de testes da camada de analytics (backend + frontend) | — | 🔲 |

---

## Detalhamento dos achados

### P1 — Corrigir antes do próximo release

**#1 — `useLoadPacks` não atualiza datas de packs já existentes no store** ✅
[useLoadPacks.ts:123-141](../frontend/lib/hooks/useLoadPacks.ts#L123-L141)
Para packs que já existem no store Zustand (rehidratado do persist), o loop só atualizava
`stats`, `sheet_integration` e `conversion_types` — **nunca `date_start`/`date_stop`** (nem
`name`/`auto_refresh`). Como o `useFilters` deriva o `effectiveDateRange` das datas dos packs
quando `usePackDates` está ativo, um pack com `auto_refresh` cujo range foi estendido fora desta
sessão de browser (cron, outro device) fazia o Manager consultar o período antigo — dados novos
existiam no banco mas nunca apareciam, sem nenhum erro visível. **Confirmado em produção**: o
store de packs é persistido (zustand `persist`), então o branch buggy era atingido a cada reload.
→ **Fix aplicado:** branch `existing` agora acumula patch e sincroniza `date_start/stop/name/auto_refresh/last_refreshed_at`
além dos campos-objeto. Memória registrada: `useloadpacks_sync_mutable_fields`.

### P2 — Planejar para o próximo sprint

**#2 — Cache local de séries não invalidado no pack refresh** ✅
[page.tsx:120-194](../frontend/app/manager/page.tsx#L120-L194)
`seriesCacheByTab` (state do componente) só era limpo quando filtros mudavam. O refresh de pack
invalida as queries TanStack (`rankings-series`), mas só as *ativas* refetcham — chaves fora do
viewport permaneciam no cache local com séries pré-refresh.
→ **Fix aplicado:** `useEffect` ouvindo `hookify:pack-ads-cache-updated` zera `seriesCacheByTab`.

**#3 — `placeholderData` assíncrono inerte em `usePacksAds`** ✅
[usePacksAds.ts:76-82](../frontend/lib/hooks/usePacksAds.ts#L76-L82)
TanStack Query espera valor síncrono em `placeholderData`; a função async retornava uma `Promise`.
Pior: com placeholder presente o status vira `success`, fazendo `isLoading` reportar `false` no
primeiro fetch. (O `isLoading` do `usePacksAds` não é consumido no Manager, então impacto real era
nulo — limpeza por higiene.)
→ **Fix aplicado:** bloco `placeholderData` async removido.

**#4 — Hooks de drill/children não threadam o abort signal** ✅
[hooks.ts](../frontend/lib/api/hooks.ts)
`useAdVariations`, `useCampaignChildren`, `useAdsetChildren`, `useAdDetails`, `useAdCreative`,
`useAdHistory`, `useAdNameDetails`, `useAdNameHistory` não passavam `{ signal }` ao Axios — contra
a decisão registrada em `analytics_queries_must_thread_abort_signal` (logout não aborta HTTP em voo;
RPC segue até `statement_timeout` 57014 + ruído no Sentry).
→ **Fix aplicado:** 9 endpoints GET em `endpoints.ts` ganharam `options?: { signal }`; hooks
threadam o `signal` do contexto do TanStack Query. Memória atualizada.

**#5 — Batch `.in_()` de 500 itens na hidratação de transcrição** ✅
[analytics.py:956](../backend/app/routes/analytics.py#L956)
Regra do projeto (`supabase_in_clause_url_limit`) é 200. Com `ad_names` longos URL-encoded, 500
nomes podiam estourar o limite de URL do PostgREST (HTTP 400 silenciosamente engolido → ícone de
transcrição sumindo de linhas aleatórias). O batch de thumbnails usa `ad_id` curto — mantido em 500.
→ **Fix aplicado:** `batch_size 500 → 200` em `_hydrate_transcription_flags_for_rankings_rows`.

**#6 — RPC pesada de "Criativos" dispara mesmo em outras abas** 🟡 (Fase 1 feita)
[page.tsx:217](../frontend/app/manager/page.tsx#L217)
A query `por-anuncio` (group_by=ad_name, limit 10000, leadscore) ficava `enabled`
independentemente da aba ativa — entrar direto em "Por campanha" disparava duas RPCs pesadas em
paralelo. Na revisão original foi marcado "não mexer" porque alimentava o `averagesOverride` dos
headers de todas as abas; análise posterior provou que **as médias da RPC são invariantes ao
`group_by`** (o CTE `totals` soma quantidades aditivas), então qualquer aba já traz as mesmas médias.
→ **Fase 1 aplicada:** gate `activeManagerTab === "por-anuncio"`; médias derivadas da aba ativa
(`activeServerAverages` useMemo, removido o `serverAverages` state + `useEffect`); loading/erro de
topo cientes da aba ativa (`activeLoading`/`activeError`) — evita bleed entre abas.
→ **Fase 2 pendente (= B1):** colapsar as 4 cópias de query/map/series numa única query
parametrizada por `group_by`, com `placeholderData: keepPreviousData`. Invasivo (muda a interface
do `ManagerTable`); sessão dedicada após a Fase 1 rodar como baseline em produção.

**#7 — `actionTypeOptions` nunca encolhe** ✅
[page.tsx:305-309](../frontend/app/manager/page.tsx#L305-L309) / [filters.ts:146-162](../frontend/lib/store/filters.ts#L146-L162)
O efeito só propagava quando `length > 0`. Ao trocar para packs sem os tipos antigos, o dropdown
mantinha opções órfãs e um `actionType` selecionado inexistente produzia `results = 0` em tudo, sem
aviso.
→ **Fix aplicado:** guard trocado de `length > 0` para `selectedPackIds.size > 0`; o setter
`setActionTypeOptions` no store reseta `actionType` órfão (inclusive limpando para `''` quando a
lista fica vazia — ver B7).

**#8 — Datas sem validação no contrato do backend** ✅
[analytics.py:178-214](../backend/app/routes/analytics.py#L178-L214)
`date_start`/`date_stop` eram `str` livres; valor malformado virava erro de cast na RPC → 500
genérico em vez de 422.
→ **Fix aplicado:** `field_validator` ISO (`%Y-%m-%d`) nos 3 models POST (`RankingsRequest`,
`RankingsSeriesRequest`, `RankingsRetentionRequest`), padrão já usado em `schemas.py`.

### P3 — Backlog

**B1 — Duplicação dos 4 blocos em `page.tsx`** ✅ (= #6 Fase 2)
Os 4 blocos request→map→attach-series por aba (~300 linhas, [page.tsx](../frontend/app/manager/page.tsx))
foram colapsados em 1 versão parametrizada por `activeGroupBy` (derivado de `GROUP_BY_BY_TAB[activeManagerTab]`).
→ Novo util puro [mapRankingRow.ts](../frontend/lib/utils/mapRankingRow.ts) com `mapRankingRow` +
`resolveAdName` + `resolveGroupKey` + 20 testes unitários. Correção acidental: `cpm` com `NaN`
(aba Criativos usava `typeof row.cpm === "number"`, que deixa NaN passar) unificado em
`Number.isFinite(row.cpm) ? row.cpm : 0`. Escopo conservador — ManagerTable não tocado.

**B2 — `setActiveManagerTab` dentro de `useMemo`** 🔲
[page.tsx:94](../frontend/app/manager/page.tsx#L94) — setState em render phase; mover para `useEffect`.

**B3 — CSV sem guard de formula injection** ✅
[exportManagerCsv.ts:45](../frontend/lib/utils/exportManagerCsv.ts#L45)
`escapeCell` só tratava aspas; `ad_name` começando com `= + - @` executava fórmula no Excel/Sheets.
→ **Fix aplicado:** `neutralizeFormula(value)` prefixa `'` quando o regex `/^[=+\-@\t\r]/` casa,
aplicado **só em texto livre** (nome, status, transcrição) — nunca em métricas numéricas (quebraria
negativos). Memória: `csv_export_formula_injection`.

**B4 — Seleção em lote sobrevive a mudanças de filtro** 🔲
[ManagerTable.tsx:400](../frontend/components/manager/ManagerTable.tsx#L400) — `rowSelection` não é
limpa ao filtrar; "Pausar" pode atingir ads que saíram da vista. Limpar seleção quando
`columnFilters`/`globalFilter` mudam (afeta só a aba Individual).

**B5 — `serverAverages` nunca resetado** ✅ (resolvido junto do #6 Fase 1)
Resposta sem `averages` mantinha médias do período anterior nos headers (edge case). Com a Fase 1
do #6, `serverAverages` (state) foi substituído por `activeServerAverages` (useMemo derivado da
resposta da aba ativa) — sem state stale possível.

**B6 — Toast de slow-loading sem cleanup no unmount** 🔲
[ManagerTable.tsx:309-324](../frontend/components/manager/ManagerTable.tsx#L309-L324) — navegar para
fora durante o loading deixa o toast vivo.

**B7 — Reset de `actionType` para conjunto vazio** ✅
[filters.ts:154-160](../frontend/lib/store/filters.ts#L154-L160) — `setActionTypeOptions` agora
limpa o `actionType` órfão para `''` quando `options` chega vazio (nenhum tipo nos packs/período).

**B8 — `graceCutoff` morto** 🔲
[tierConfig.ts:20](../frontend/lib/config/tierConfig.ts#L20) — variável calculada e nunca usada.
Deletar 1 linha. Atenção: a *lógica* do `if` está correta — é só a variável que sobrou.

**B9 — Migração `any` → tipado** 🔲
O mapeamento de linhas e o cache de séries operam quase inteiramente em `any` — exatamente onde a
matemática de métricas (`page_conv`, `cpr`, `overall_conversion`) vive. Dívida real, projeto à parte.

### Testes e documentação

**T1 — Cobertura de testes da camada de analytics** 🔲
A camada de analytics tinha **cobertura zero**: nenhum `test_analytics*` no backend e no frontend só
`managerColumnPreferences`. Maior retorno por esforço:
1. Testes pytest para `_normalize_rankings_rpc_response`, `_build_rankings_series` e os helpers de
   hidratação (incluindo o caso de batch/URL do #5).
2. Testes unitários para `mergeSeriesCache`/`pendingSeriesKeys` e para a matemática de mapeamento de
   linhas — funções puras, fáceis de extrair e testar.

---

## O que está bem feito (não mexer)

- **Segurança**: as três RPCs (`core_v2_base_v060`, `series_v2`, `retention_v2`) rejeitam
  `p_user_id ≠ auth.uid()` com `42501`; wrappers v066/v067 delegam à base que valida. Hidratações
  filtram por `user_id`, thumbnails Storage-only, JWT via JWKS, sem service role no caminho de
  leitura (respeitando a assimetria de `statement_timeout`).
- **Performance**: virtualização + `useDeferredValue` + `startTransition`, séries por viewport com
  debounce de 120ms e cap de 100 keys, `staleTime: Infinity` com invalidação manual, patch in-place
  de `effective_status`, conversion types materializados no metadado do pack (zero RPC no read-path),
  retry de RPC restrito a erros transitórios.
- **Gate de carregamento** (`packsReady`) correto, com comentário exemplar explicando o porquê.

---

## Próximos passos sugeridos (ordem de ROI)

1. ~~**B8** + **B2** + **B4** + **B6** — limpeza trivial, feito.~~ ✅
2. ~~**#6 Fase 2 / B1** (colapsar as 4 cópias) — `mapRankingRow.ts` + page.tsx colapsado.~~ ✅
3. **T1** (testes de analytics) — maior gap estrutural; começar pelas funções puras do frontend.
4. **B9** (migração de tipos) — projeto à parte.
