import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { DEFAULT_PACK_SORT, PACK_SORT_DEFAULT_DIRECTION, isPackSortDirection, isPackSortKey, type PackSortDirection, type PackSortKey } from '@/lib/utils/packSort'

const STORAGE_KEY = 'hookify:packs-sort'
const STORAGE_VERSION = 1

/**
 * Preferência de ordenação dos packs (critério + direção), persistida em localStorage.
 *
 * É um store (e não useState + localStorage) porque a página /packs e o seletor
 * do topbar ficam montados ao mesmo tempo: sem reatividade compartilhada, mudar
 * a ordem em um lugar deixaria o outro exibindo a ordem antiga até remontar.
 */
interface PackSortStore {
  sortKey: PackSortKey
  direction: PackSortDirection
  /** Troca o critério e reseta a direção para a natural dele (mesmo padrão do Manager: getManagerChildSortInitialDirection). */
  setSortKey: (sortKey: PackSortKey) => void
  toggleDirection: () => void
}

export const usePackSortStore = create<PackSortStore>()(
  persist(
    (set) => ({
      sortKey: DEFAULT_PACK_SORT,
      direction: PACK_SORT_DEFAULT_DIRECTION[DEFAULT_PACK_SORT],
      setSortKey: (sortKey) => set({ sortKey, direction: PACK_SORT_DEFAULT_DIRECTION[sortKey] }),
      toggleDirection: () => set((state) => ({ direction: state.direction === 'asc' ? 'desc' : 'asc' })),
    }),
    {
      name: STORAGE_KEY,
      version: STORAGE_VERSION,
      storage: createJSONStorage(() => localStorage),
      // Valor corrompido ou de uma versão que renomeou as chaves não pode quebrar
      // a listagem — cai no default em vez de ordenar por um critério/direção inexistente.
      merge: (persisted, current) => {
        const saved = persisted as Partial<PackSortStore> | undefined
        const sortKey = isPackSortKey(saved?.sortKey) ? saved.sortKey : DEFAULT_PACK_SORT
        const direction = isPackSortDirection(saved?.direction) ? saved.direction : PACK_SORT_DEFAULT_DIRECTION[sortKey]
        return { ...current, sortKey, direction }
      },
    }
  )
)
