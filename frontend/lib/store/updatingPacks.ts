import { create } from 'zustand'

/**
 * Store simples para rastrear quais packs estão sendo atualizados
 * Usado para feedback visual nos cards
 */
interface UpdatingPacksState {
  updatingPackIds: Set<string>
  addUpdatingPack: (packId: string) => void
  removeUpdatingPack: (packId: string) => void
  isPackUpdating: (packId: string) => boolean
  clearAll: () => void
}

export const useUpdatingPacksStore = create<UpdatingPacksState>((set, get) => ({
  updatingPackIds: new Set<string>(),

  addUpdatingPack: (packId: string) => {
    set((state) => {
      const newSet = new Set(state.updatingPackIds)
      newSet.add(packId)
      return { updatingPackIds: newSet }
    })
  },

  removeUpdatingPack: (packId: string) => {
    set((state) => {
      const newSet = new Set(state.updatingPackIds)
      newSet.delete(packId)
      return { updatingPackIds: newSet }
    })
  },

  isPackUpdating: (packId: string) => {
    return get().updatingPackIds.has(packId)
  },

  clearAll: () => {
    set({ updatingPackIds: new Set<string>() })
  },
}))































