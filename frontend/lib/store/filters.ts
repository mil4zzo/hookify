import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { DateRange, formatDateLocal } from '@/lib/utils/dateFilters'
import { logger } from '@/lib/utils/logger'

const STORAGE_KEY = 'hookify-filters'
const STORAGE_VERSION = 1

// ── Types ──────────────────────────────────────────────────────────────────────

// packPreferences: Record<packId, isEnabled>
// Tracks both selected AND deselected packs, so deselected packs aren't
// re-enabled when syncPacksOnLoad runs after navigation.
type PackPreferences = Record<string, boolean>

interface FiltersState {
  packPreferences: PackPreferences
  dateRange: DateRange
  actionType: string
  usePackDates: boolean
  actionTypeOptions: string[] // transient — NOT persisted
}

interface FiltersActions {
  togglePack: (packId: string) => void
  setDateRange: (range: DateRange) => void
  setActionType: (value: string) => void
  setUsePackDates: (value: boolean) => void
  /** Called by pages after each successful API fetch to populate the dropdown */
  setActionTypeOptions: (options: string[]) => void
  /** Syncs preferences when packs list changes (new packs → enabled, deleted → removed) */
  syncPacksOnLoad: (allPackIds: string[]) => void
}

export type FiltersStore = FiltersState & FiltersActions

// ── Default values ─────────────────────────────────────────────────────────────

function getDefaultDateRange(): DateRange {
  if (typeof window === 'undefined') return {}
  const end = new Date()
  const start = new Date()
  start.setDate(start.getDate() - 30)
  return {
    start: formatDateLocal(start),
    end: formatDateLocal(end),
  }
}

// ── Migration from legacy localStorage keys ────────────────────────────────────

const LEGACY_KEYS = [
  'hookify-selected-packs',
  'hookify-date-range',
  'hookify-action-type',
  'hookify-use-pack-dates',
] as const

function migrateFromLegacyKeys(): Partial<FiltersState> | null {
  if (typeof window === 'undefined') return null

  const hasLegacyData = LEGACY_KEYS.some((k) => localStorage.getItem(k) !== null)
  if (!hasLegacyData) return null

  const result: Partial<FiltersState> = {}

  // Migrate pack preferences
  try {
    const raw = localStorage.getItem('hookify-selected-packs')
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        // Old format: string[] — all were enabled
        const prefs: PackPreferences = {}
        parsed.forEach((id: string) => { prefs[id] = true })
        result.packPreferences = prefs
      } else if (typeof parsed === 'object' && parsed !== null) {
        // Current shared format: Record<string, boolean>
        result.packPreferences = parsed as PackPreferences
      }
    }
  } catch (e) {
    logger.error('Erro ao migrar hookify-selected-packs:', e)
  }

  // Migrate date range
  try {
    const raw = localStorage.getItem('hookify-date-range')
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && parsed.start && parsed.end) {
        result.dateRange = parsed as DateRange
      }
    }
  } catch (e) {
    logger.error('Erro ao migrar hookify-date-range:', e)
  }

  // Migrate action type
  const savedAction = localStorage.getItem('hookify-action-type')
  if (savedAction) result.actionType = savedAction

  // Migrate usePackDates
  const savedUsePack = localStorage.getItem('hookify-use-pack-dates')
  if (savedUsePack !== null) result.usePackDates = savedUsePack === 'true'

  // Remove legacy keys
  LEGACY_KEYS.forEach((k) => {
    try { localStorage.removeItem(k) } catch {}
  })

  return result
}

// ── Store ───────────────────────────────────────────────────────────────────────

export const useFiltersStore = create<FiltersStore>()(
  persist(
    (set, get) => ({
      packPreferences: {},
      dateRange: getDefaultDateRange(),
      actionType: '',
      usePackDates: false,
      actionTypeOptions: [],

      togglePack: (packId) => {
        const { packPreferences } = get()
        const isEnabled = packPreferences[packId] ?? false
        const enabledCount = Object.values(packPreferences).filter(Boolean).length

        // Guard: keep at least one pack selected
        if (isEnabled && enabledCount <= 1) return

        set({ packPreferences: { ...packPreferences, [packId]: !isEnabled } })
      },

      setDateRange: (range) => set({ dateRange: range }),

      setActionType: (value) => set({ actionType: value }),

      setUsePackDates: (value) => set({ usePackDates: value }),

      setActionTypeOptions: (options) => {
        const { actionType } = get()
        const updates: Partial<FiltersStore> = { actionTypeOptions: options }
        // Auto-select first option if current is empty or no longer available
        if (options.length > 0 && (!actionType || !options.includes(actionType))) {
          updates.actionType = options[0]
        }
        set(updates)
      },

      syncPacksOnLoad: (allPackIds) => {
        const { packPreferences } = get()
        const allSet = new Set(allPackIds)
        let changed = false
        const newPrefs: PackPreferences = {}

        // For each existing pack: keep current preference; for new packs: enable by default
        allPackIds.forEach((packId) => {
          if (packId in packPreferences) {
            newPrefs[packId] = packPreferences[packId]
          } else {
            newPrefs[packId] = true // new pack: enable by default
            changed = true
          }
        })

        // Detect removed packs
        Object.keys(packPreferences).forEach((packId) => {
          if (!allSet.has(packId)) changed = true
        })

        // Guarantee at least one pack enabled
        const enabledCount = Object.values(newPrefs).filter(Boolean).length
        if (enabledCount === 0 && allPackIds.length > 0) {
          newPrefs[allPackIds[0]] = true
          changed = true
        }

        if (changed || Object.keys(newPrefs).length !== Object.keys(packPreferences).length) {
          set({ packPreferences: newPrefs })
        }
      },
    }),
    {
      name: STORAGE_KEY,
      version: STORAGE_VERSION,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        packPreferences: state.packPreferences,
        dateRange: state.dateRange,
        actionType: state.actionType,
        usePackDates: state.usePackDates,
        // actionTypeOptions intentionally omitted (transient)
      }),
      merge: (persistedState: unknown, currentState) => {
        // persistedState is null/undefined on first use (new storage key)
        if (!persistedState || typeof persistedState !== 'object') {
          const migrated = migrateFromLegacyKeys()
          if (migrated) {
            return {
              ...currentState,
              packPreferences: migrated.packPreferences ?? {},
              dateRange: migrated.dateRange ?? getDefaultDateRange(),
              actionType: migrated.actionType ?? '',
              usePackDates: migrated.usePackDates ?? false,
              actionTypeOptions: [],
            }
          }
          return { ...currentState, dateRange: getDefaultDateRange(), actionTypeOptions: [] }
        }

        const ps = persistedState as Partial<FiltersState>
        return {
          ...currentState,
          packPreferences: ps.packPreferences ?? {},
          dateRange: ps.dateRange ?? getDefaultDateRange(),
          actionType: ps.actionType ?? '',
          usePackDates: ps.usePackDates ?? false,
          actionTypeOptions: [], // always reset transient field on rehydration
        }
      },
    }
  )
)

// ── Selector helpers (avoid re-renders when unrelated state changes) ────────────

/** Returns the set of currently selected pack IDs (derived from packPreferences) */
export const useSelectedPackIds = () =>
  useFiltersStore((s) =>
    new Set(Object.entries(s.packPreferences).filter(([, v]) => v).map(([k]) => k))
  )
