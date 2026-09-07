import { create } from 'zustand'

/**
 * Cards de erro terminal — os que hoje ficam presos no canto até o usuário fechar.
 *
 * Por que saíram do sonner: com a pilha fechada em baralho, TODO toast novo entra na frente.
 * Um erro é persistente e exige ação, mas as atualizações seguintes do lote nasciam depois
 * dele e o soterravam — sumia da vista e nunca fechava sozinho. E o sonner não resolve isso:
 * ele ordena por recência, não tem prioridade nem reordenação, e mantém UMA lista por posição.
 * Para o erro ficar no mesmo canto e ainda assim separado da pilha, ele precisa de região
 * própria (ErrorCardStack), fora do Toaster.
 *
 * `id` segue a convenção errorToastIdFor(toastId): uma tentativa nova do mesmo pack limpa o
 * card da tentativa anterior, e um erro repetido substitui em vez de empilhar.
 */

export type ErrorCardContext = 'meta' | 'sheets' | 'transcription'

export interface ErrorCard {
  id: string
  packName: string
  message: string
  context?: ErrorCardContext
  diagnosticLine?: string
}

interface ErrorCardsState {
  cards: ErrorCard[]
  push: (card: ErrorCard) => void
  dismiss: (id: string) => void
  clear: () => void
}

export const useErrorCardsStore = create<ErrorCardsState>((set) => ({
  cards: [],

  push: (card) => {
    set((state) => {
      const existing = state.cards.findIndex((c) => c.id === card.id)
      if (existing >= 0) {
        const cards = [...state.cards]
        cards[existing] = card
        return { cards }
      }
      return { cards: [...state.cards, card] }
    })
  },

  dismiss: (id) => {
    set((state) => {
      if (!state.cards.some((c) => c.id === id)) return state
      return { cards: state.cards.filter((c) => c.id !== id) }
    })
  },

  clear: () => set({ cards: [] }),
}))
