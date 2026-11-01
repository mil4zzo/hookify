// Agrupamento automático de mídias em criativos.
//
// Modelo de 1 slot: cada arquivo vira um criativo.
// Modelo multi-slot (ex.: Feed 4:5 + Stories/Reels 9:16): arquivos do mesmo criativo
// são reconhecidos pelo nome-base ("AD01_feed.mp4" + "AD01_story.mp4") ou pela
// subpasta do Drive, e cada arquivo cai no slot pela PROPORÇÃO real (largura/altura).
// Slot que sobrar vazio reaproveita a mídia de proporção mais próxima do grupo —
// o usuário corrige no cartão se quiser outra.
import type { MediaSlot } from "./types"

export interface PoolMedia {
  key: string
  name: string
  width: number | null
  height: number | null
  group?: string | null
}

export interface CreativeDraft {
  key: string
  name: string
  slots: Record<string, string> // slot_key → PoolMedia.key
}

const PLACEMENT_WORDS = [
  "feed", "story", "stories", "reels", "reel", "vertical", "horizontal", "quadrado", "square",
  "portrait", "retrato", "paisagem", "landscape", "vert", "horiz",
]
const RATIO_TOKEN = /\b\d{1,2}(?:[.,]\d+)?\s*[x:]\s*\d{1,2}(?:[.,]\d+)?\b/gi
const SEPARATORS = /[\s_\-.()[\]]+/g

export function stripExtension(name: string): string {
  const dot = name.lastIndexOf(".")
  return dot > 0 ? name.slice(0, dot) : name
}

/** Nome-base do criativo: sem extensão, sem proporção ("9x16") e sem palavra de posicionamento. */
export function creativeBaseName(fileName: string): string {
  const withoutRatio = stripExtension(fileName).replace(RATIO_TOKEN, " ")
  const tokens = withoutRatio.split(SEPARATORS).filter(Boolean)
  const kept = tokens.filter((t) => !PLACEMENT_WORDS.includes(t.toLowerCase()))
  const base = (kept.length ? kept : tokens).join(" ").trim()
  return base || stripExtension(fileName)
}

/** Proporções-alvo do slot ("9:16", "1:1 / 1.91:1 / 4:5") como largura/altura. */
export function slotRatios(slot: Pick<MediaSlot, "aspect_ratio">): number[] {
  const raw = String(slot.aspect_ratio ?? "")
  const ratios: number[] = []
  for (const part of raw.split("/")) {
    const m = part.trim().match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/)
    if (m) ratios.push(Number(m[1]) / Number(m[2]))
  }
  return ratios
}

function ratioDistance(media: PoolMedia, slot: MediaSlot): number {
  if (!media.width || !media.height) return Number.POSITIVE_INFINITY
  const ratios = slotRatios(slot)
  if (!ratios.length) return Number.POSITIVE_INFINITY
  const r = media.width / media.height
  return Math.min(...ratios.map((t) => Math.abs(Math.log(r) - Math.log(t))))
}

/** Distribui as mídias de um grupo nos slots, por proporção (sem repetir enquanto der). */
export function assignToSlots(media: PoolMedia[], slots: MediaSlot[]): Record<string, string> {
  const assigned: Record<string, string> = {}
  if (!media.length || !slots.length) return assigned
  const pairs = slots
    .flatMap((slot) => media.map((m) => ({ slot, m, d: ratioDistance(m, slot) })))
    .sort((a, b) => a.d - b.d)
  const usedMedia = new Set<string>()
  for (const { slot, m, d } of pairs) {
    if (assigned[slot.slot_key] || usedMedia.has(m.key) || !Number.isFinite(d)) continue
    assigned[slot.slot_key] = m.key
    usedMedia.add(m.key)
  }
  // Sem dimensões conhecidas: ordem de chegada nos slots ainda vazios.
  const unplaced = media.filter((m) => !usedMedia.has(m.key))
  for (const slot of slots) {
    if (assigned[slot.slot_key]) continue
    const next = unplaced.shift()
    if (next) {
      assigned[slot.slot_key] = next.key
      usedMedia.add(next.key)
    }
  }
  // Ainda vazio (grupo com menos arquivos que slots): reaproveita a mais próxima.
  for (const slot of slots) {
    if (assigned[slot.slot_key]) continue
    const closest = [...media].sort((a, b) => ratioDistance(a, slot) - ratioDistance(b, slot))[0]
    if (closest) assigned[slot.slot_key] = closest.key
  }
  return assigned
}

export function groupIntoCreatives(media: PoolMedia[], slots: MediaSlot[]): CreativeDraft[] {
  if (slots.length <= 1) {
    const slotKey = slots[0]?.slot_key ?? "slot_1"
    return media.map((m) => ({ key: m.key, name: stripExtension(m.name), slots: { [slotKey]: m.key } }))
  }
  const groups = new Map<string, { name: string; media: PoolMedia[] }>()
  for (const m of media) {
    const label = m.group?.trim() || creativeBaseName(m.name)
    const id = label.toLowerCase()
    const entry = groups.get(id) ?? { name: label, media: [] }
    entry.media.push(m)
    groups.set(id, entry)
  }
  return [...groups.values()].map((g) => ({
    key: g.media.map((m) => m.key).join("+"),
    name: g.name,
    slots: assignToSlots(g.media, slots),
  }))
}

export function isCreativeComplete(creative: CreativeDraft, slots: MediaSlot[]): boolean {
  if (!creative.name.trim()) return false
  return slots.filter((s) => s.required).every((s) => Boolean(creative.slots[s.slot_key]))
}

/** {ad_name}, {index}, {template_adset_name} — todas as ocorrências. */
export function renderName(
  template: string,
  vars: { ad_name: string; index: number; template_adset_name?: string },
): string {
  let out = template.replaceAll("{ad_name}", vars.ad_name).replaceAll("{index}", String(vars.index))
  if (vars.template_adset_name !== undefined) out = out.replaceAll("{template_adset_name}", vars.template_adset_name)
  return out.trim()
}
