/**
 * Storage híbrido que usa localStorage para dados pequenos
 * e IndexedDB para packs grandes que excedem a quota
 */

import { StateStorage } from 'zustand/middleware'
import * as indexedDB from './indexedDB'

const LOCAL_STORAGE_KEY = 'hookify-session'
const PACK_IDS_KEY = 'hookify-pack-ids' // Lista de IDs de packs grandes

interface SessionData {
  accessToken?: string | null
  user?: any
  adAccounts?: any[]
  packs?: any[]
  // Estado da UI não é persistido
}

/**
 * Storage customizado que separa dados pequenos e grandes
 */
export const hybridStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    if (typeof window === 'undefined') {
      return null
    }

    try {
      // Busca dados pequenos do localStorage
      const smallDataJson = localStorage.getItem(LOCAL_STORAGE_KEY)
      const smallData: SessionData = smallDataJson ? JSON.parse(smallDataJson) : {}

      // Busca lista de IDs de packs grandes
      const packIdsJson = localStorage.getItem(PACK_IDS_KEY)
      const largePackIds: string[] = packIdsJson ? JSON.parse(packIdsJson) : []

      // Busca packs grandes do IndexedDB
      const largePacks: any[] = []
      if (largePackIds.length > 0) {
        for (const packId of largePackIds) {
          const result = await indexedDB.getPack(packId)
          if (result.success && result.data) {
            largePacks.push(result.data)
          }
        }
      }

      // Combina packs pequenos (do localStorage) com packs grandes (do IndexedDB)
      const allPacks = [
        ...(smallData.packs || []).filter((pack: any) => !largePackIds.includes(pack.id)),
        ...largePacks,
      ]

      // Retorna estado combinado
      const combinedState = {
        state: {
          ...smallData,
          packs: allPacks,
        },
        version: 1,
      }

      return JSON.stringify(combinedState)
    } catch (error) {
      console.error('Erro ao buscar dados do storage híbrido:', error)
      // Fallback: tenta buscar apenas do localStorage
      try {
        return localStorage.getItem(name)
      } catch {
        return null
      }
    }
  },

  setItem: async (name: string, value: string): Promise<void> => {
    if (typeof window === 'undefined') {
      return
    }

    try {
      // Verifica se value é uma string válida ou objeto
      let parsed: { state?: SessionData; version?: number }
      
      if (typeof value === 'string') {
        // Verifica se é a string literal "[object Object]" (erro comum)
        if (value === '[object Object]') {
          console.error('Erro: recebido "[object Object]" como string no setItem. Isso indica que um objeto foi convertido incorretamente para string.')
          // Retorna early - não tenta salvar dados inválidos
          return
        }
        
        try {
          parsed = JSON.parse(value)
        } catch (parseError) {
          console.error('Erro ao fazer parse do JSON no setItem:', parseError, 'Value type:', typeof value, 'Value preview:', value?.substring?.(0, 100))
          // Se falhar o parse, não salva dados inválidos para evitar corromper o storage
          return
        }
      } else if (typeof value === 'object' && value !== null) {
        // Se já é um objeto (caso raro do Zustand passar objeto diretamente)
        parsed = value as any
      } else {
        console.error('Valor inválido no setItem:', typeof value, value)
        // Retorna early - não salva dados inválidos
        return
      }

      const state = parsed.state || {}

      // Separa packs em pequenos e grandes
      const packs = state.packs || []
      const smallPacks: any[] = []
      const largePacks: any[] = []
      const largePackIds: string[] = []

      for (const pack of packs) {
        if (indexedDB.isPackTooLarge(pack)) {
          largePacks.push(pack)
          largePackIds.push(pack.id)
        } else {
          smallPacks.push(pack)
        }
      }

      // Salva dados pequenos no localStorage
      const smallData: SessionData = {
        accessToken: state.accessToken,
        user: state.user,
        adAccounts: state.adAccounts,
        packs: smallPacks,
      }

      // Tenta salvar no localStorage
      try {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(smallData))
        localStorage.setItem(PACK_IDS_KEY, JSON.stringify(largePackIds))
      } catch (error: any) {
        // Se ainda assim exceder a quota, move todos os packs para IndexedDB
        if (error.name === 'QuotaExceededError' || error.message?.includes('quota')) {
          console.warn('Quota do localStorage excedida, movendo todos os packs para IndexedDB')
          
          // Move todos os packs para IndexedDB
          const allPackIds: string[] = []
          for (const pack of packs) {
            try {
              const result = await indexedDB.savePack({ id: pack.id, data: pack })
              if (result.success) {
                allPackIds.push(pack.id)
              } else {
                console.warn(`Falha ao salvar pack ${pack.id} no IndexedDB:`, result.error)
              }
            } catch (packError) {
              console.error(`Erro ao salvar pack ${pack.id} no IndexedDB:`, packError)
            }
          }

          // Salva apenas dados essenciais no localStorage
          const essentialData: SessionData = {
            accessToken: state.accessToken,
            user: state.user,
            adAccounts: state.adAccounts,
            packs: [], // Packs vazios, todos estão no IndexedDB
          }

          try {
            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(essentialData))
            localStorage.setItem(PACK_IDS_KEY, JSON.stringify(allPackIds))
          } catch (finalError: any) {
            // Se ainda falhar, tenta salvar apenas o mínimo absoluto
            if (finalError.name === 'QuotaExceededError') {
              console.error('Erro crítico: localStorage completamente cheio')
              // Tenta limpar dados antigos e salvar apenas token
              try {
                localStorage.clear()
                const minimalData: SessionData = {
                  accessToken: state.accessToken,
                  user: state.user,
                  adAccounts: [],
                  packs: [],
                }
                localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(minimalData))
                localStorage.setItem(PACK_IDS_KEY, JSON.stringify(allPackIds))
              } catch {
                // Se tudo falhar, apenas loga o erro mas não quebra o fluxo
                console.error('Impossível salvar dados no localStorage')
              }
            }
          }
          return
        }
        throw error
      }

      // Salva packs grandes no IndexedDB (em background, não bloqueia)
      for (const pack of largePacks) {
        indexedDB.savePack({ id: pack.id, data: pack }).catch((error) => {
          console.error(`Erro ao salvar pack ${pack.id} no IndexedDB:`, error)
        })
      }
    } catch (error: any) {
      // Se for erro de quota, tenta estratégia alternativa
      if (error.name === 'QuotaExceededError' || error.message?.includes('quota')) {
        console.error('Erro de quota ao salvar dados:', error)
        
        // Tenta salvar apenas dados essenciais
        try {
          const parsed: { state?: SessionData; version?: number } = JSON.parse(value)
          const state = parsed.state || {}
          
          const essentialData: SessionData = {
            accessToken: state.accessToken,
            user: state.user,
            adAccounts: state.adAccounts,
            packs: [], // Remove packs para evitar quota
          }

          // Move todos os packs para IndexedDB
          const packs = state.packs || []
          const packIds: string[] = []
          for (const pack of packs) {
            try {
              const result = await indexedDB.savePack({ id: pack.id, data: pack })
              if (result.success) {
                packIds.push(pack.id)
              }
            } catch (packError) {
              console.error(`Erro ao salvar pack ${pack.id}:`, packError)
            }
          }

          try {
            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(essentialData))
            localStorage.setItem(PACK_IDS_KEY, JSON.stringify(packIds))
          } catch (finalError: any) {
            if (finalError.name === 'QuotaExceededError') {
              console.error('Erro crítico: localStorage completamente cheio')
              // Tenta limpar e salvar mínimo
              try {
                localStorage.clear()
                const minimalData: SessionData = {
                  accessToken: state.accessToken,
                  user: state.user,
                  adAccounts: [],
                  packs: [],
                }
                localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(minimalData))
                localStorage.setItem(PACK_IDS_KEY, JSON.stringify(packIds))
              } catch {
                console.error('Falha crítica ao salvar dados')
              }
            }
          }
        } catch (fallbackError) {
          console.error('Erro crítico ao salvar dados (fallback):', fallbackError)
          // Não lança erro para não quebrar o fluxo do Zustand
        }
      } else {
        // Para outros erros, apenas loga mas não quebra
        console.error('Erro ao salvar dados no storage:', error)
      }
    }
  },

  removeItem: async (name: string): Promise<void> => {
    if (typeof window === 'undefined') {
      return
    }

    try {
      // Remove dados do localStorage
      localStorage.removeItem(LOCAL_STORAGE_KEY)
      localStorage.removeItem(PACK_IDS_KEY)
      
      // Remove todos os packs do IndexedDB
      await indexedDB.clearAllPacks()
    } catch (error) {
      console.error('Erro ao remover dados do storage:', error)
    }
  },
}

