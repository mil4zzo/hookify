/**
 * Storage assíncrono (IndexedDB) para o persister por query do TanStack
 * (`experimental_createQueryPersister`): UMA entrada por query, lida só quando a
 * query monta, gravada só quando ela resolve.
 *
 * POR QUE NÃO O localStorage DO PROVIDER
 * ---------------------------------------
 * O persister do provider (`createSyncStoragePersister`) serializa o cache INTEIRO
 * a cada mudança (throttle de 1 s), de forma síncrona na thread principal, num
 * espaço de 5 MB. Serve para as conexões (1 kB). Uma resposta do `ad-performance`
 * tem ~570 kB crus: no localStorage seriam serializações de meio megabyte a cada
 * segundo de interação e o limite estourado em poucas seleções.
 *
 * Aqui: `hookify-query-cache` (banco próprio, sem coordenar versão com o
 * `hookify-storage` do adsCache), store `queries`, chave = prefixo + hash da queryKey.
 * Sem IndexedDB (SSR, navegador bloqueando site data) todo método devolve "nada" —
 * o persister trata `undefined` como cache miss e a query busca normalmente.
 */

import type { AsyncStorage } from '@tanstack/query-persist-client-core'

const DB_NAME = 'hookify-query-cache'
const DB_VERSION = 1
const STORE = 'queries'

let dbPromise: Promise<IDBDatabase | null> | null = null

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') {
        resolve(null)
        return
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return dbPromise
}

function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise<T | undefined>((resolve) => {
        if (!db) {
          resolve(undefined)
          return
        }
        try {
          const tx = db.transaction(STORE, mode)
          const req = run(tx.objectStore(STORE))
          if (!req) {
            tx.oncomplete = () => resolve(undefined)
            tx.onerror = () => resolve(undefined)
            tx.onabort = () => resolve(undefined)
            return
          }
          req.onsuccess = () => resolve(req.result as T)
          req.onerror = () => resolve(undefined)
        } catch {
          resolve(undefined)
        }
      }),
  )
}

/** Implementa `AsyncStorage<string>` do TanStack, inclusive `entries()` (para o GC). */
export const queryPersistStorage: AsyncStorage<string> = {
  getItem: (key) => withStore<string>('readonly', (s) => s.get(key)).then((v) => (typeof v === 'string' ? v : null)),
  setItem: (key, value) => withStore<IDBValidKey>('readwrite', (s) => s.put(value, key)).then(() => undefined),
  removeItem: (key) => withStore<undefined>('readwrite', (s) => s.delete(key)).then(() => undefined),
  entries: async () => {
    const keys = (await withStore<IDBValidKey[]>('readonly', (s) => s.getAllKeys())) ?? []
    const values = (await withStore<string[]>('readonly', (s) => s.getAll())) ?? []
    return keys.map((k, i) => [String(k), values[i]] as [string, string])
  },
}

/** Apaga tudo — usado no logout (o cache é por usuário; ver analyticsPersister). */
export function clearQueryPersistStorage(): Promise<void> {
  return withStore<undefined>('readwrite', (s) => s.clear()).then(() => undefined)
}
