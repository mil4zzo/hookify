import { create } from 'zustand'

type SettingsTab = "general" | "accounts" | "validation" | "integrations" | "leadscore"

interface SettingsModalState {
  isOpen: boolean
  activeTab: SettingsTab
}

interface SettingsModalActions {
  openSettings: (tab?: SettingsTab) => void
  closeSettings: () => void
  setActiveTab: (tab: SettingsTab) => void
}

type SettingsModalStore = SettingsModalState & SettingsModalActions

export const useSettingsModalStore = create<SettingsModalStore>((set) => ({
  isOpen: false,
  activeTab: "general",

  openSettings: (tab = "general") => {
    set({ isOpen: true, activeTab: tab })
  },

  closeSettings: () => {
    set({ isOpen: false, activeTab: "general" })
  },

  setActiveTab: (tab) => {
    set({ activeTab: tab })
  },
}))


