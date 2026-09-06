import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { DateRange, formatDateLocal } from '@/lib/utils/dateFilters'
import { logger } from '@/lib/utils/logger'

const BASE_STORAGE_KEY = 'hookify-filters'
const STORAGE_VERSION = 1

/**
 * A seleção de packs é POR USUÁRIO, mas mora no navegador (não há coluna para
 * ela em `user_preferences`). Com uma chave única, trocar de conta no mesmo
 * navegador fazia o mapa do usuário anterior ser lido pelo seguinte: os ids não
 * batiam, `syncPacksOnLoad` reconstruía tudo e o default de pack desconhecido é
 * `true` — daí o "voltei e está tudo marcado". Pior, num pack COMPARTILHADO os
 * ids batem, e a desmarcação de um vazava para o outro.
 */
function storageKeyForUser(userId: string): string {
  return `${BASE_STORAGE_KEY}:${userId}`
}

/**
 * Conteúdo da chave global (era pré-escopo), lido no import — antes de qualquer
 * gravação desta sessão. Ler aqui, e não dentro de `bindFiltersToUser`, evita
 * que uma escrita ocorrida entre o boot e o login sobrescreva a seleção que
 * ainda estava esperando para ser adotada.
 */
let legacyGlobalSnapshot: string | null = readLegacyGlobalSnapshot()

function readLegacyGlobalSnapshot(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return localStorage.getItem(BASE_STORAGE_KEY)
  } catch {
    return null
  }
}

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
  /**
   * Usuário cujo mapa já foi lido do localStorage. `null` = ainda não amarrado;
   * nesse estado o que está em memória é o default, não a preferência do
   * usuário — quem grava precisa esperar. transient — NOT persisted.
   */
  boundUserId: string | null
}

interface FiltersActions {
  togglePack: (packId: string) => void
  setPackPreferences: (prefs: PackPreferences) => void
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
      boundUserId: null,

      togglePack: (packId) => {
        const { packPreferences } = get()
        const isEnabled = packPreferences[packId] ?? false
        const enabledCount = Object.values(packPreferences).filter(Boolean).length

        // Guard: keep at least one pack selected
        if (isEnabled && enabledCount <= 1) return

        set({ packPreferences: { ...packPreferences, [packId]: !isEnabled } })
      },

      setPackPreferences: (prefs) => set({ packPreferences: prefs }),

      setDateRange: (range) => set({ dateRange: range }),

      setActionType: (value) => set({ actionType: value }),

      setUsePackDates: (value) => set({ usePackDates: value }),

      setActionTypeOptions: (options) => {
        const { actionType, actionTypeOptions } = get()
        // Só reescreve a lista se ela realmente mudou — evita re-render redundante de todos
        // os subscribers de actionTypeOptions quando um fetch devolve a mesma lista (chamado
        // a cada resolução de query no useAdPerformancePipeline).
        const sameOptions =
          options.length === actionTypeOptions.length &&
          options.every((t, i) => t === actionTypeOptions[i])
        const updates: Partial<FiltersStore> = sameOptions ? {} : { actionTypeOptions: options }
        if (options.length > 0) {
          // Auto-select first option if current is empty or no longer available
          if (!actionType || !options.includes(actionType)) {
            updates.actionType = options[0]
          }
        } else if (actionType) {
          // Nenhum tipo disponível nos packs/período atuais → limpar seleção órfã.
          // Sem isso, um actionType selecionado que não existe nos dados atuais produz
          // results=0 em tudo, sem aviso. Seguro: Explorer só chama com length>0;
          // Insights/Gold/Manager só chamam após dados reais (não em loading transiente).
          updates.actionType = ''
        }
        if (Object.keys(updates).length > 0) set(updates)
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

        // Nota: NÃO forçamos ao menos 1 pack habilitado. Selecionar 0 packs é um estado
        // válido e intencional (o usuário pode limpar tudo pelo Topbar). Os hooks de
        // analytics gateiam em selectedPackIds.size > 0, então 0 packs só mostra o empty
        // state — sem query disparada. Forçar ≥1 aqui reverteria a limpeza a cada navegação.

        if (changed || Object.keys(newPrefs).length !== Object.keys(packPreferences).length) {
          set({ packPreferences: newPrefs })
        }
      },
    }),
    {
      name: BASE_STORAGE_KEY, // reamarrado ao usuário em bindFiltersToUser()
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
          // Nada persistido para ESTA chave → zerar todo filtro. Antes daqui
          // saía `...currentState` puro: inofensivo no boot (estado já vazio),
          // mas no rehydrate da troca de usuário preservava o mapa de packs do
          // usuário anterior — exatamente o vazamento que o escopo corrige.
          return {
            ...currentState,
            packPreferences: {},
            dateRange: getDefaultDateRange(),
            actionType: '',
            usePackDates: false,
            actionTypeOptions: [],
          }
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

// ── Escopo por usuário ─────────────────────────────────────────────────────────

let boundKeyUserId: string | null = null

/**
 * Amarra o store persistido ao usuário logado (`hookify-filters:<user_id>`) e
 * relê o localStorage nessa chave.
 *
 * Chamado uma vez por carregamento de página, assim que a sessão do Supabase
 * resolve (ver `useFiltersUserScope`). Enquanto não roda, `boundUserId` é null e
 * `useFilters` segura o `syncPacksOnLoad` — sem isso a sincronização gravaria
 * "tudo marcado" por cima da seleção que ainda não foi lida.
 *
 * O `rehydrate()` é assíncrono na assinatura, mas o storage é o localStorage
 * (síncrono): a leitura acontece no mesmo tick, não há janela de pisca.
 */
export async function bindFiltersToUser(userId: string): Promise<void> {
  if (typeof window === 'undefined' || !userId) return
  if (boundKeyUserId === userId) return
  boundKeyUserId = userId

  const key = storageKeyForUser(userId)

  try {
    // Adoção única do mapa global: o primeiro usuário a logar depois deste
    // deploy herda a seleção que já existia, em vez de recomeçar com tudo
    // marcado. Depois disso a chave global deixa de existir e o próximo usuário
    // não tem o que herdar.
    if (legacyGlobalSnapshot !== null && localStorage.getItem(key) === null) {
      localStorage.setItem(key, legacyGlobalSnapshot)
    }
    legacyGlobalSnapshot = null
    localStorage.removeItem(BASE_STORAGE_KEY)
  } catch (e) {
    logger.error('Erro ao migrar filtros para a chave por usuário:', e)
  }

  useFiltersStore.persist.setOptions({ name: key })
  await useFiltersStore.persist.rehydrate()
  useFiltersStore.setState({ boundUserId: userId })
}
