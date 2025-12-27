import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

const STORAGE_KEY = 'hookify-mql-leadscore-min'
const DEFAULT_MQL_LEADSCORE_MIN = 0

interface MqlLeadscoreState {
  mqlLeadscoreMin: number
  isLoading: boolean
  isSaving: boolean
  error: string | null
}

interface MqlLeadscoreActions {
  setMqlLeadscoreMin: (value: number) => void
  setIsLoading: (value: boolean) => void
  setIsSaving: (value: boolean) => void
  setError: (value: string | null) => void
  reset: () => void
}

type MqlLeadscoreStore = MqlLeadscoreState & MqlLeadscoreActions

export const useMqlLeadscoreStore = create<MqlLeadscoreStore>()(
  persist(
    (set) => ({
      mqlLeadscoreMin: DEFAULT_MQL_LEADSCORE_MIN,
      isLoading: false,
      isSaving: false,
      error: null,

      setMqlLeadscoreMin: (value) => {
        set({ mqlLeadscoreMin: value })
      },

      setIsLoading: (value) => {
        set({ isLoading: value })
      },

      setIsSaving: (value) => {
        set({ isSaving: value })
      },

      setError: (value) => {
        set({ error: value })
      },

      reset: () => {
        set({
          mqlLeadscoreMin: DEFAULT_MQL_LEADSCORE_MIN,
          isLoading: false,
          isSaving: false,
          error: null,
        })
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        mqlLeadscoreMin: state.mqlLeadscoreMin,
      }),
    }
  )
)


