/**
 * Utilitário simples para IndexedDB
 * Usado para armazenar packs grandes que excedem a quota do localStorage
 */

const DB_NAME = 'hookify-storage'
const DB_VERSION = 1
const STORE_NAME = 'packs'

interface IDBResult<T> {
  success: boolean
  data?: T
  error?: Error
}

/**
 * Abre a conexão com IndexedDB
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
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
  })
}

/**
 * Salva um pack no IndexedDB
 */
export async function savePack(pack: { id: string; data: any }): Promise<IDBResult<void>> {
  try {
    const db = await openDB()
    const transaction = db.transaction([STORE_NAME], 'readwrite')
    const store = transaction.objectStore(STORE_NAME)

    return new Promise((resolve) => {
      const request = store.put(pack)
      request.onsuccess = () => resolve({ success: true })
      request.onerror = () => resolve({ success: false, error: request.error || new Error('Erro ao salvar pack') })
    })
  } catch (error) {
    return { success: false, error: error as Error }
  }
}

/**
 * Busca um pack do IndexedDB
 */
export async function getPack(packId: string): Promise<IDBResult<any>> {
  try {
    const db = await openDB()
    const transaction = db.transaction([STORE_NAME], 'readonly')
    const store = transaction.objectStore(STORE_NAME)

    return new Promise((resolve) => {
      const request = store.get(packId)
      request.onsuccess = () => {
        const result = request.result
        if (result) {
          resolve({ success: true, data: result.data })
        } else {
          resolve({ success: false, error: new Error('Pack não encontrado') })
        }
      }
      request.onerror = () => resolve({ success: false, error: request.error || new Error('Erro ao buscar pack') })
    })
  } catch (error) {
    return { success: false, error: error as Error }
  }
}

/**
 * Busca todos os packs do IndexedDB
 */
export async function getAllPacks(): Promise<IDBResult<any[]>> {
  try {
    const db = await openDB()
    const transaction = db.transaction([STORE_NAME], 'readonly')
    const store = transaction.objectStore(STORE_NAME)

    return new Promise((resolve) => {
      const request = store.getAll()
      request.onsuccess = () => {
        const packs = request.result.map((item: any) => item.data)
        resolve({ success: true, data: packs })
      }
      request.onerror = () => resolve({ success: false, error: request.error || new Error('Erro ao buscar packs') })
    })
  } catch (error) {
    return { success: false, error: error as Error }
  }
}

/**
 * Remove um pack do IndexedDB
 */
export async function removePack(packId: string): Promise<IDBResult<void>> {
  try {
    const db = await openDB()
    const transaction = db.transaction([STORE_NAME], 'readwrite')
    const store = transaction.objectStore(STORE_NAME)

    return new Promise((resolve) => {
      const request = store.delete(packId)
      request.onsuccess = () => resolve({ success: true })
      request.onerror = () => resolve({ success: false, error: request.error || new Error('Erro ao remover pack') })
    })
  } catch (error) {
    return { success: false, error: error as Error }
  }
}

/**
 * Remove todos os packs do IndexedDB
 */
export async function clearAllPacks(): Promise<IDBResult<void>> {
  try {
    const db = await openDB()
    const transaction = db.transaction([STORE_NAME], 'readwrite')
    const store = transaction.objectStore(STORE_NAME)

    return new Promise((resolve) => {
      const request = store.clear()
      request.onsuccess = () => resolve({ success: true })
      request.onerror = () => resolve({ success: false, error: request.error || new Error('Erro ao limpar packs') })
    })
  } catch (error) {
    return { success: false, error: error as Error }
  }
}

/**
 * Verifica se um pack é grande demais para localStorage
 * Limite aproximado: 4MB (deixando margem para outros dados)
 */
export function isPackTooLarge(pack: any): boolean {
  try {
    const jsonString = JSON.stringify(pack)
    const sizeInBytes = new Blob([jsonString]).size
    const sizeInMB = sizeInBytes / (1024 * 1024)
    // Considera grande se > 2MB (para ser seguro, já que o limite é ~5-10MB)
    return sizeInMB > 2
  } catch {
    // Se não conseguir serializar, assume que é grande
    return true
  }
}

