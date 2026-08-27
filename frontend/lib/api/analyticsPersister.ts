/**
 * Persister das queries analíticas pesadas (ad-performance e série) — fase 2 do
 * plano de cache (documentation/plano-rollup-rankings.md).
 *
 * O PRINCÍPIO
 * -----------
 * O banco só é tocado quando o dado mudou. A fase 1 pôs o carimbo de frescor dos
 * packs (refresh + sync de planilha) na queryKey: dado novo = chave nova. Logo a
 * resposta de uma chave é imutável — pode viver em disco e ser servida em qualquer
 * recarga, aba ou dia, sem refetch. `staleTime: Infinity` nos hooks e
 * `refetchOnRestore: false` aqui fecham o circuito: restaurar do disco NÃO dispara
 * busca. As invalidações explícitas (toggle de status, tags, status-sync) continuam
 * funcionando pelo prefixo da chave e regravam a entrada.
 *
 * ISOLAMENTO POR USUÁRIO
 * ----------------------
 * A queryKey não carrega user_id, e tags são do ATOR (um pack compartilhado tem o
 * mesmo id para dois usuários). `buster` = user id: entrada de outro usuário é
 * descartada na leitura. E o logout apaga o store inteiro (session.ts).
 *
 * TAMANHO
 * -------
 * ~570 kB por resposta do ad-performance; cada (período × packs × agrupamento ×
 * evento × frescor) é uma entrada. `persisterGc()` no primeiro uso da sessão
 * remove o que passou de `maxAge` ou é de outro usuário.
 */

import { experimental_createQueryPersister } from '@tanstack/query-persist-client-core'
import type { AsyncStorage } from '@tanstack/query-persist-client-core'
import type { Query, QueryKey } from '@tanstack/react-query'
import { queryPersistStorage } from '@/lib/storage/queryPersistStorage'

export const ANALYTICS_PERSIST_PREFIX = 'hookify-analytics'
export const ANALYTICS_PERSIST_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
// Bump para descartar tudo de uma vez (ex.: mudança de contrato do payload).
export const ANALYTICS_PERSIST_VERSION = 'v1'

export type AnalyticsPersister = ReturnType<typeof experimental_createQueryPersister<string>>

/** Prefixos de queryKey que este persister cobre. */
export const PERSISTED_ANALYTICS_PREFIXES: ReadonlyArray<ReadonlyArray<string>> = [
  ['analytics', 'rankings'],
  ['analytics', 'rankings-series'],
]

export function isPersistedAnalyticsKey(queryKey: QueryKey): boolean {
  if (!Array.isArray(queryKey)) return false
  return PERSISTED_ANALYTICS_PREFIXES.some((p) => p.every((part, i) => queryKey[i] === part))
    // as chaves de drill (children) compartilham o prefixo ['analytics','rankings'] mas
    // têm um marcador de texto na posição 2; as persistidas têm a data (YYYY-MM-DD) ali.
    && typeof queryKey[2] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(queryKey[2] as string)
}

export function busterFor(userId: string): string {
  return `${ANALYTICS_PERSIST_VERSION}:${userId}`
}

const byUser = new Map<string, AnalyticsPersister>()
let current: AnalyticsPersister | null = null

/**
 * Um persister por usuário, criado uma vez. Na criação, agenda o GC das entradas
 * vencidas/de outro usuário. `storage` injetável para teste.
 */
export function getAnalyticsPersister(
  userId: string | null | undefined,
  storage: AsyncStorage<string> | null = queryPersistStorage,
): AnalyticsPersister | undefined {
  if (!userId) return undefined
  let p = byUser.get(userId)
  if (!p) {
    p = experimental_createQueryPersister<string>({
      storage,
      prefix: ANALYTICS_PERSIST_PREFIX,
      buster: busterFor(userId),
      maxAge: ANALYTICS_PERSIST_MAX_AGE_MS,
      refetchOnRestore: false,
    })
    byUser.set(userId, p)
    void p.persisterGc().catch(() => { /* best-effort */ })
  }
  current = p
  return p
}

/** O persister do usuário ativo — para o provider regravar updates manuais (setQueryData). */
export function getCurrentAnalyticsPersister(): AnalyticsPersister | null {
  return current
}

/**
 * Regrava a entrada de uma query analítica após um update MANUAL (toggle de status,
 * tag): o persisterFn só grava no caminho de fetch. Sem isto, a recarga restauraria
 * o estado de antes do toggle.
 */
export function persistManualAnalyticsUpdate(query: Query): void {
  if (!current || !isPersistedAnalyticsKey(query.queryKey)) return
  void current.persistQuery(query).catch(() => { /* best-effort */ })
}

/** Só para testes: esquece as instâncias. */
export function __resetAnalyticsPersisters(): void {
  byUser.clear()
  current = null
}
