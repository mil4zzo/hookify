// Estado do assistente de duplicação de campanha.
//
// Num store (e não em useState da página) para sobreviver à troca de passo: o legado
// reconstruía a revisão a cada volta e apagava as edições do usuário. Trocar de modelo
// reagrupa as mídias contra os slots NOVOS (o legado mandava slot do modelo anterior).
import { create } from "zustand"
import { groupIntoCreatives, type CreativeDraft, type PoolMedia } from "./grouping"
import type { DriveFile, LibraryMedia, LibraryMediaStatus, MediaSlot } from "./types"

export type PoolStatus = "queued" | LibraryMediaStatus

export interface PoolEntry {
  key: string
  name: string
  mediaType: "image" | "video"
  source: "upload" | "drive"
  sizeBytes: number
  width: number | null
  height: number | null
  durationMs: number | null
  group: string | null
  previewUrl: string | null
  file?: File
  driveFile?: DriveFile
  accountId: string
  mediaId: string | null
  status: PoolStatus
  bytesSent: number
  error: string | null
}

export type LaunchStep = 1 | 2 | 3

interface LaunchWizardState {
  step: LaunchStep
  templateAdId: string | null
  accountId: string | null
  slots: MediaSlot[]
  selectedAdsetIds: string[]
  pool: Record<string, PoolEntry>
  creatives: CreativeDraft[]
  campaignNameTemplate: string
  adsetNameTemplate: string
  launchStatus: "PAUSED" | "ACTIVE"
  budgetAmount: number | null
  activeJobId: string | null

  setStep: (step: LaunchStep) => void
  selectTemplate: (args: {
    adId: string
    accountId: string
    slots: MediaSlot[]
    adsetIds: string[]
    campaignName: string
  }) => void
  toggleAdset: (adsetId: string, selected: boolean) => void
  setSelectedAdsets: (adsetIds: string[]) => void
  addToPool: (entries: PoolEntry[]) => void
  updatePoolEntry: (key: string, patch: Partial<PoolEntry>) => void
  applyLibraryMedia: (media: LibraryMedia[]) => void
  removeCreative: (key: string) => void
  renameCreative: (key: string, name: string) => void
  setCreativeSlot: (key: string, slotKey: string, mediaKey: string) => void
  setNaming: (patch: Partial<Pick<LaunchWizardState, "campaignNameTemplate" | "adsetNameTemplate">>) => void
  setLaunchStatus: (status: "PAUSED" | "ACTIVE") => void
  setBudgetAmount: (amount: number | null) => void
  setActiveJob: (jobId: string | null) => void
  reset: () => void
}

const toPoolMedia = (e: PoolEntry): PoolMedia => ({
  key: e.key,
  name: e.name,
  width: e.width,
  height: e.height,
  group: e.group,
})

const initial = {
  step: 1 as LaunchStep,
  templateAdId: null,
  accountId: null,
  slots: [] as MediaSlot[],
  selectedAdsetIds: [] as string[],
  pool: {} as Record<string, PoolEntry>,
  creatives: [] as CreativeDraft[],
  campaignNameTemplate: "{ad_name}",
  adsetNameTemplate: "{template_adset_name}",
  launchStatus: "PAUSED" as const,
  budgetAmount: null,
  activeJobId: null,
}

function revokePreviews(pool: Record<string, PoolEntry>) {
  for (const entry of Object.values(pool)) {
    if (entry.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(entry.previewUrl)
  }
}

export const useLaunchWizard = create<LaunchWizardState>((set, get) => ({
  ...initial,

  setStep: (step) => set({ step }),

  selectTemplate: ({ adId, accountId, slots, adsetIds, campaignName }) => {
    const state = get()
    // Mídia vive na biblioteca de UMA conta: outro modelo em outra conta = começar a pool de novo.
    const pool = state.accountId && state.accountId !== accountId ? {} : state.pool
    if (pool !== state.pool) revokePreviews(state.pool)
    set({
      templateAdId: adId,
      accountId,
      slots,
      selectedAdsetIds: adsetIds,
      pool,
      creatives: groupIntoCreatives(Object.values(pool).map(toPoolMedia), slots),
      campaignNameTemplate: campaignName ? `${campaignName} | {ad_name}` : "{ad_name}",
      budgetAmount: null,
    })
  },

  toggleAdset: (adsetId, selected) =>
    set((s) => ({
      selectedAdsetIds: selected
        ? [...new Set([...s.selectedAdsetIds, adsetId])]
        : s.selectedAdsetIds.filter((id) => id !== adsetId),
    })),

  setSelectedAdsets: (adsetIds) => set({ selectedAdsetIds: adsetIds }),

  addToPool: (entries) =>
    set((s) => {
      const fresh = entries.filter((e) => !s.pool[e.key])
      if (!fresh.length) return s
      const pool = { ...s.pool }
      for (const e of fresh) pool[e.key] = e
      // Só as mídias novas são agrupadas: criativos já editados ficam como estão.
      const created = groupIntoCreatives(fresh.map(toPoolMedia), s.slots)
      const existingKeys = new Set(s.creatives.map((c) => c.key))
      return { pool, creatives: [...s.creatives, ...created.filter((c) => !existingKeys.has(c.key))] }
    }),

  updatePoolEntry: (key, patch) =>
    set((s) => (s.pool[key] ? { pool: { ...s.pool, [key]: { ...s.pool[key], ...patch } } } : s)),

  applyLibraryMedia: (media) =>
    set((s) => {
      const byId = new Map(media.map((m) => [m.id, m]))
      let changed = false
      const pool = { ...s.pool }
      for (const entry of Object.values(pool)) {
        const m = entry.mediaId ? byId.get(entry.mediaId) : undefined
        if (!m) continue
        if (m.status !== entry.status || m.bytes_sent !== entry.bytesSent || m.error_message !== entry.error) {
          pool[entry.key] = { ...entry, status: m.status, bytesSent: m.bytes_sent, error: m.error_message }
          changed = true
        }
      }
      return changed ? { pool } : s
    }),

  removeCreative: (key) =>
    set((s) => {
      const creatives = s.creatives.filter((c) => c.key !== key)
      const used = new Set(creatives.flatMap((c) => Object.values(c.slots)))
      const pool: Record<string, PoolEntry> = {}
      for (const [k, entry] of Object.entries(s.pool)) {
        if (used.has(k)) pool[k] = entry
        else if (entry.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(entry.previewUrl)
      }
      return { creatives, pool }
    }),

  renameCreative: (key, name) =>
    set((s) => ({ creatives: s.creatives.map((c) => (c.key === key ? { ...c, name } : c)) })),

  setCreativeSlot: (key, slotKey, mediaKey) =>
    set((s) => ({
      creatives: s.creatives.map((c) => (c.key === key ? { ...c, slots: { ...c.slots, [slotKey]: mediaKey } } : c)),
    })),

  setNaming: (patch) => set(patch),
  setLaunchStatus: (launchStatus) => set({ launchStatus }),
  setBudgetAmount: (budgetAmount) => set({ budgetAmount }),
  setActiveJob: (activeJobId) => set({ activeJobId }),

  reset: () => {
    revokePreviews(get().pool)
    set({ ...initial })
  },
}))
