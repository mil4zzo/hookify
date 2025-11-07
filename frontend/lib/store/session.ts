import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { AdsPack } from '@/lib/types'
import { FacebookUser, FacebookAdAccount } from '@/lib/api/schemas'
import { setAuthToken } from '@/lib/api/client'
import { hybridStorage } from '@/lib/storage/hybridStorage'
import * as indexedDB from '@/lib/storage/indexedDB'

const STORAGE_KEY = 'hookify-session'
const STORAGE_VERSION = 1

interface SessionState {
  // Autenticação
  accessToken: string | null
  user: FacebookUser | null
  
  // Dados do Facebook
  adAccounts: FacebookAdAccount[]
  
  // Packs de Ads
  packs: AdsPack[]
  
  // Estado da UI
  isLoading: boolean
  error: string | null
}

interface SessionActions {
  // Autenticação
  setAccessToken: (token: string | null) => void
  setUser: (user: FacebookUser | null) => void
  logout: () => void
  
  // Dados do Facebook
  setAdAccounts: (accounts: FacebookAdAccount[]) => void
  
  // Packs de Ads
  addPack: (pack: AdsPack) => void
  removePack: (packId: string) => void
  updatePack: (packId: string, updates: Partial<AdsPack>) => void
  
  // Estado da UI
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  clearError: () => void
}

type SessionStore = SessionState & SessionActions

const initialState: SessionState = {
  accessToken: null,
  user: null,
  adAccounts: [],
  packs: [],
  isLoading: false,
  error: null,
}

export const useSessionStore = create<SessionStore>()(
  persist(
    (set, get) => ({
      ...initialState,

      // Autenticação
      setAccessToken: (token) => {
        set({ accessToken: token })
        setAuthToken(token)
      },

      setUser: (user) => {
        set({ user })
      },

      logout: () => {
        set(initialState)
        setAuthToken(null)
        // Limpar localStorage e IndexedDB (async em background)
        if (typeof window !== 'undefined') {
          try {
            localStorage.removeItem(STORAGE_KEY)
            localStorage.removeItem('hookify-pack-ids')
            // Limpar IndexedDB em background
            indexedDB.clearAllPacks().catch((error) => {
              console.error('Erro ao limpar IndexedDB no logout:', error)
            })
            // Limpar cache de ads também
            import('@/lib/storage/adsCache').then(({ clearAllAdsCache }) => {
              clearAllAdsCache().catch((error) => {
                console.error('Erro ao limpar cache de ads no logout:', error)
              })
            })
          } catch (error) {
            console.error('Erro ao limpar storage no logout:', error)
          }
        }
      },

      // Dados do Facebook
      setAdAccounts: (accounts) => {
        set({ adAccounts: accounts })
      },

      // Packs de Ads
      addPack: (pack) => {
        set((state) => ({
          packs: [...state.packs, pack]
        }))
        // O storage híbrido gerencia automaticamente a persistência
        // Se der erro de quota, ele automaticamente move para IndexedDB
      },

      removePack: (packId) => {
        set((state) => ({
          packs: state.packs.filter(pack => pack.id !== packId)
        }))
        // Remove também do IndexedDB se existir (async em background)
        if (typeof window !== 'undefined') {
          indexedDB.removePack(packId).catch((error) => {
            console.error('Erro ao remover pack do IndexedDB:', error)
          })
        }
      },

      updatePack: (packId, updates) => {
        set((state) => ({
          packs: state.packs.map(pack =>
            pack.id === packId ? { ...pack, ...updates } : pack
          )
        }))
      },

      // Estado da UI
      setLoading: (loading) => {
        set({ isLoading: loading })
      },

      setError: (error) => {
        set({ error })
      },

      clearError: () => {
        set({ error: null })
      },
    }),
    {
      name: STORAGE_KEY,
      version: STORAGE_VERSION,
      storage: hybridStorage as any,
      partialize: (state) => ({
        accessToken: state.accessToken,
        user: state.user,
        adAccounts: state.adAccounts,
        // Não persistir ads - eles são carregados sob demanda e cacheados no IndexedDB
        packs: state.packs.map((pack) => ({
          ...pack,
          ads: [], // Sempre salvar packs sem ads no store persistente
        })),
      }),
      migrate: (persistedState: any, version: number) => {
        // Migração de versões futuras se necessário
        if (version < STORAGE_VERSION) {
          // Implementar migração aqui se necessário
        }
        return persistedState
      },
      onRehydrateStorage: () => {
        return (state, error) => {
          if (error) {
            console.error('Erro ao reidratar estado do storage:', error)
          }
        }
      },
    }
  )
)

// Hooks utilitários
export const useAuth = () => {
  const { accessToken, user, setAccessToken, setUser, logout } = useSessionStore()
  
  return {
    isAuthenticated: !!accessToken && !!user,
    accessToken,
    user,
    setAccessToken,
    setUser,
    logout,
  }
}

export const usePacks = () => {
  const { packs, addPack, removePack, updatePack } = useSessionStore()
  
  return {
    packs,
    addPack,
    removePack,
    updatePack,
    getPackById: (id: string) => packs.find(pack => pack.id === id),
  }
}

export const useAdAccounts = () => {
  const { adAccounts, setAdAccounts } = useSessionStore()
  
  return {
    adAccounts,
    setAdAccounts,
    getAdAccountById: (id: string) => adAccounts.find(account => account.id === id),
  }
}
