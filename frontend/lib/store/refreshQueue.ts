import { create } from 'zustand'

/**
 * Estado do LOTE de atualizações de pack — o "placar" que fica acima da pilha de toasts.
 *
 * Por que existe: o refresh é serial (REFRESH_MAX_CONCURRENCY = 1 em usePackRefresh).
 * Quem está na fila não emite toast — 11 cards repetindo "Aguardando outras atualizações · 0%"
 * enchiam a tela sem informar nada. A fila vira um número aqui, e este store é o único lugar
 * onde os packs que ainda não começaram existem na interface.
 *
 * `items` guarda só quem está na fila ou rodando, na ordem de disparo. Concluído sai da lista
 * e vira contagem; quando a lista esvazia, as contagens zeram (o lote acabou).
 */

export type RefreshQueueStatus = 'queued' | 'running'

export interface RefreshQueueItem {
  packId: string
  packName: string
  status: RefreshQueueStatus
}

interface RefreshQueueState {
  items: RefreshQueueItem[]
  doneCount: number
  failedCount: number

  /** Pack entrou na fila (chamado no disparo, antes de saber se vai esperar). */
  enqueue: (packId: string, packName: string) => void
  /** Pack saiu da fila e começou a rodar de fato. */
  start: (packId: string) => void
  /** Pack terminou (com ou sem sucesso) e sai da lista. */
  finish: (packId: string, ok: boolean) => void
  /** Remove quem ainda não começou e devolve os removidos, para o chamador cancelá-los. */
  dropQueued: () => RefreshQueueItem[]
  reset: () => void
}

const EMPTY_COUNTS = { doneCount: 0, failedCount: 0 }

export const useRefreshQueueStore = create<RefreshQueueState>((set, get) => ({
  items: [],
  ...EMPTY_COUNTS,

  enqueue: (packId, packName) => {
    set((state) => {
      if (state.items.some((i) => i.packId === packId)) return state
      return { items: [...state.items, { packId, packName, status: 'queued' }] }
    })
  },

  start: (packId) => {
    set((state) => ({
      items: state.items.map((i) => (i.packId === packId ? { ...i, status: 'running' as const } : i)),
    }))
  },

  finish: (packId, ok) => {
    set((state) => {
      if (!state.items.some((i) => i.packId === packId)) return state
      const items = state.items.filter((i) => i.packId !== packId)
      // Lote encerrado: zera o placar para o próximo começar limpo.
      if (items.length === 0) return { items, ...EMPTY_COUNTS }
      return {
        items,
        doneCount: state.doneCount + (ok ? 1 : 0),
        failedCount: state.failedCount + (ok ? 0 : 1),
      }
    })
  },

  dropQueued: () => {
    const dropped = get().items.filter((i) => i.status === 'queued')
    if (dropped.length === 0) return dropped
    set((state) => {
      const items = state.items.filter((i) => i.status !== 'queued')
      if (items.length === 0) return { items, ...EMPTY_COUNTS }
      return { items }
    })
    return dropped
  },

  reset: () => set({ items: [], ...EMPTY_COUNTS }),
}))

/** Quantos ainda esperam a vez. */
export function selectQueuedCount(state: RefreshQueueState): number {
  return state.items.reduce((total, item) => total + (item.status === 'queued' ? 1 : 0), 0)
}
