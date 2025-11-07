import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

const STORAGE_KEY = 'hookify-settings'
const STORAGE_VERSION = 1

export interface AppSettings {
  language: string
  niche: string
  currency: string
}

interface SettingsState {
  settings: AppSettings
}

interface SettingsActions {
  setLanguage: (language: string) => void
  setNiche: (niche: string) => void
  setCurrency: (currency: string) => void
  updateSettings: (settings: Partial<AppSettings>) => void
}

type SettingsStore = SettingsState & SettingsActions

const defaultSettings: AppSettings = {
  language: 'pt-BR',
  niche: '',
  currency: 'BRL',
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      settings: defaultSettings,

      setLanguage: (language) => {
        set((state) => ({
          settings: { ...state.settings, language }
        }))
      },

      setNiche: (niche) => {
        set((state) => ({
          settings: { ...state.settings, niche }
        }))
      },

      setCurrency: (currency) => {
        set((state) => ({
          settings: { ...state.settings, currency }
        }))
      },

      updateSettings: (newSettings) => {
        set((state) => ({
          settings: { ...state.settings, ...newSettings }
        }))
      },
    }),
    {
      name: STORAGE_KEY,
      version: STORAGE_VERSION,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        settings: state.settings,
      }),
    }
  )
)

// Hook utilitário
export const useSettings = () => {
  const store = useSettingsStore()
  return {
    settings: store.settings,
    setLanguage: store.setLanguage,
    setNiche: store.setNiche,
    setCurrency: store.setCurrency,
    updateSettings: store.updateSettings,
  }
}

