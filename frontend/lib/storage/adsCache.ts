/**
 * Cache de ads no IndexedDB com TTL (Time To Live)
 * Cache temporário para evitar requests repetidos ao trocar de tela
 */

const DB_NAME = 'hookify-storage'
const DB_VERSION = 2 // Incrementar versão para criar nova store
const CACHE_STORE_NAME = 'ads_cache'

// TTL padrão elevado: 30 dias
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 dias

interface CachedAds {
  packId: string
  ads: any[]
  cachedAt: number
  expiresAt: number
}

interface IDBResult<T> {
  success: boolean
  data?: T
  error?: Error
}

/**
 * Abre a conexão com IndexedDB e cria a store de cache se necessário
 */
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB não está disponível neste ambiente'))
      return
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      
      // Criar store de cache de ads se não existir
      if (!db.objectStoreNames.contains(CACHE_STORE_NAME)) {
        const store = db.createObjectStore(CACHE_STORE_NAME, { keyPath: 'packId' })
        store.createIndex('expiresAt', 'expiresAt', { unique: false })
      }
    }
  })
}

/**
 * Salva ads de um pack no cache com TTL
 */
export async function cachePackAds(packId: string, ads: any[], ttlMs: number = DEFAULT_TTL_MS): Promise<IDBResult<void>> {
  try {
    const db = await openDB()
    const transaction = db.transaction([CACHE_STORE_NAME], 'readwrite')
    const store = transaction.objectStore(CACHE_STORE_NAME)

    const now = Date.now()
    const cachedData: CachedAds = {
      packId,
      ads,
      cachedAt: now,
      expiresAt: now + ttlMs,
    }

    return new Promise((resolve) => {
      const request = store.put(cachedData)
      request.onsuccess = () => resolve({ success: true })
      request.onerror = () => resolve({ success: false, error: request.error || new Error('Erro ao salvar cache') })
    })
  } catch (error) {
    return { success: false, error: error as Error }
  }
}

/**
 * Busca ads de um pack do cache (retorna null se expirado ou não encontrado)
 */
export async function getCachedPackAds(packId: string): Promise<IDBResult<any[]>> {
  try {
    const db = await openDB()
    const transaction = db.transaction([CACHE_STORE_NAME], 'readonly')
    const store = transaction.objectStore(CACHE_STORE_NAME)

    return new Promise((resolve) => {
      const request = store.get(packId)
      request.onsuccess = () => {
        const result: CachedAds | undefined = request.result
        if (!result) {
          resolve({ success: false, error: new Error('Cache não encontrado') })
          return
        }

        // Verifica se o cache expirou
        const now = Date.now()
        if (now > result.expiresAt) {
          // Cache expirado, remove e retorna erro
          removeCachedPackAds(packId).catch(() => {}) // Remove em background
          resolve({ success: false, error: new Error('Cache expirado') })
          return
        }

        resolve({ success: true, data: result.ads })
      }
      request.onerror = () => resolve({ success: false, error: request.error || new Error('Erro ao buscar cache') })
    })
  } catch (error) {
    return { success: false, error: error as Error }
  }
}

/**
 * Remove ads de um pack do cache
 */
export async function removeCachedPackAds(packId: string): Promise<IDBResult<void>> {
  try {
    const db = await openDB()
    const transaction = db.transaction([CACHE_STORE_NAME], 'readwrite')
    const store = transaction.objectStore(CACHE_STORE_NAME)

    return new Promise((resolve) => {
      const request = store.delete(packId)
      request.onsuccess = () => resolve({ success: true })
      request.onerror = () => resolve({ success: false, error: request.error || new Error('Erro ao remover cache') })
    })
  } catch (error) {
    return { success: false, error: error as Error }
  }
}

/**
 * Limpa todos os caches expirados
 */
export async function clearExpiredCache(): Promise<IDBResult<number>> {
  try {
    const db = await openDB()
    const transaction = db.transaction([CACHE_STORE_NAME], 'readwrite')
    const store = transaction.objectStore(CACHE_STORE_NAME)
    const index = store.index('expiresAt')

    const now = Date.now()
    let deletedCount = 0

    return new Promise((resolve) => {
      const request = index.openCursor(IDBKeyRange.upperBound(now))
      
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result
        if (cursor) {
          cursor.delete()
          deletedCount++
          cursor.continue()
        } else {
          resolve({ success: true, data: deletedCount })
        }
      }
      
      request.onerror = () => resolve({ success: false, error: request.error || new Error('Erro ao limpar cache') })
    })
  } catch (error) {
    return { success: false, error: error as Error }
  }
}

/**
 * Limpa todo o cache de ads (útil para logout ou limpeza manual)
 */
export async function clearAllAdsCache(): Promise<IDBResult<void>> {
  try {
    const db = await openDB()
    const transaction = db.transaction([CACHE_STORE_NAME], 'readwrite')
    const store = transaction.objectStore(CACHE_STORE_NAME)

    return new Promise((resolve) => {
      const request = store.clear()
      request.onsuccess = () => resolve({ success: true })
      request.onerror = () => resolve({ success: false, error: request.error || new Error('Erro ao limpar cache') })
    })
  } catch (error) {
    return { success: false, error: error as Error }
  }
}

/**
 * Verifica se existe cache válido para um pack
 */
export async function hasValidCache(packId: string): Promise<boolean> {
  const result = await getCachedPackAds(packId)
  return result.success
}
