import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { AdsPack } from '@/lib/types'
import { FacebookUser, FacebookAdAccount } from '@/lib/api/schemas'
import { setAuthToken } from '@/lib/api/client'

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
        // Limpar localStorage
        if (typeof window !== 'undefined') {
          localStorage.removeItem(STORAGE_KEY)
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
      },

      removePack: (packId) => {
        set((state) => ({
          packs: state.packs.filter(pack => pack.id !== packId)
        }))
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
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        accessToken: state.accessToken,
        user: state.user,
        adAccounts: state.adAccounts,
        packs: state.packs,
      }),
      migrate: (persistedState: any, version: number) => {
        // Migração de versões futuras se necessário
        if (version < STORAGE_VERSION) {
          // Implementar migração aqui se necessário
        }
        return persistedState
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
