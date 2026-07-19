import type { Row, Table } from "@tanstack/react-table"
import type { RankingsItem } from "@/lib/api/schemas"
import { getVisibleManagerColumns } from "@/components/manager/managerColumnPreferences"
import type { ManagerColumnType } from "@/components/common/ManagerColumnFilter"
import { getRowAccountNames, getRowPackNames, type ProvenanceIndex } from "@/lib/manager/provenance"
import { getMetricNumericValueOrNull, type MetricValueContext } from "@/lib/metrics/calculations"
import { api } from "@/lib/api/endpoints"
import type { VideoSourceUrlsBatchResponse } from "@/lib/api/schemas"
import { getAdThumbnail } from "@/lib/utils/thumbnailFallback"

type ManagerTab = "individual" | "por-anuncio" | "por-conjunto" | "por-campanha"

const RATIO_COLUMNS = new Set<ManagerColumnType>(["hook", "scroll_stop", "hold_rate", "ctr", "website_ctr", "connect_rate", "page_conv", "mql_rate"])
const INTEGER_COLUMNS = new Set<ManagerColumnType>(["impressions", "clicks", "reach", "lpv", "plays", "thruplays", "results", "mqls", "video_watched_p50", "video_watched_p75"])

function formatValue(colId: ManagerColumnType, value: unknown): string {
  if (value === null || value === undefined) return ""
  const num = typeof value === "number" ? value : parseFloat(String(value))
  if (isNaN(num) || !isFinite(num)) return ""

  if (RATIO_COLUMNS.has(colId)) return num.toFixed(4).replace(".", ",")
  if (INTEGER_COLUMNS.has(colId)) return Math.round(num).toString()
  return num.toFixed(2).replace(".", ",")
}

const TAB_NAME_HEADER: Record<ManagerTab, string> = {
  "por-anuncio": "Criativo",
  individual: "Anúncio (ID)",
  "por-conjunto": "Conjunto",
  "por-campanha": "Campanha",
}

function getNameValue(tab: ManagerTab, row: { original: RankingsItem; getValue: (id: string) => unknown }): string {
  const original = row.original
  if (tab === "individual") {
    const name = String(original.ad_name ?? "")
    const id = String(original.ad_id ?? "")
    return id ? `${name} (${id})` : name
  }
  return String(row.getValue("ad_name") ?? original.ad_name ?? "")
}

/**
 * Neutraliza CSV/formula injection: uma célula que começa com = + - @ (ou tab/CR)
 * é interpretada como fórmula ao abrir no Excel/Sheets. Prefixar com apóstrofo força
 * o app a tratá-la como texto. Aplicar APENAS em campos de texto livre (nome,
 * transcrição, status) — NÃO em métricas numéricas, que podem ser negativas.
 */
function neutralizeFormula(value: string): string {
  if (/^[=+\-@\t\r]/.test(value)) return `'${value}`
  return value
}

function escapeCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

function triggerDownload(csvContent: string, filename: string): void {
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

const TABS_WITH_TRANSCRIPTION = new Set<ManagerTab>(["por-anuncio", "individual"])
const TABS_WITH_MEDIA_TYPE = new Set<ManagerTab>(["por-anuncio", "individual"])
const TABS_WITH_MEDIA_URLS = new Set<ManagerTab>(["por-anuncio", "individual"])

// Limite do endpoint batch de URLs (backend rejeita acima disso) — fatiar
const VIDEO_URL_BATCH_CHUNK = 500

export type VideoUrlMap = VideoSourceUrlsBatchResponse["results"]

export interface VideoUrlFetchResult {
  map: VideoUrlMap
  resolved: number
  /** ad_names que falharam — entrada do "Tentar novamente" (re-resolve só estes). */
  failedNames: string[]
  /** motivo → ad_names que falharam com ele, para exibição agrupada no dialog. */
  failuresByReason: Record<string, string[]>
}

/** ad_names de vídeo do conjunto exportado (filtrado+ordenado), dedupe preservando ordem.
 * Recebe as LINHAS (não a table) para operar sobre o snapshot congelado do dialog. */
export function getVideoAdNames(rows: readonly Row<RankingsItem>[]): string[] {
  return Array.from(
    new Set(
      rows
        .filter((r) => r.original.media_type === "video")
        .map((r) => String(r.original.ad_name ?? ""))
        .filter(Boolean)
    )
  )
}

/** Resolve URLs de vídeo em batch. `baseMap` (retry) preserva sucessos anteriores — o
 * backend serve os já-resolvidos do cache, mas manter o merge deixa o retry incremental. */
export async function fetchVideoUrls(adNames: string[], baseMap: VideoUrlMap = {}): Promise<VideoUrlFetchResult> {
  const map: VideoUrlMap = { ...baseMap }
  for (let i = 0; i < adNames.length; i += VIDEO_URL_BATCH_CHUNK) {
    const chunk = adNames.slice(i, i + VIDEO_URL_BATCH_CHUNK)
    const res = await api.facebook.getVideoSourceUrlsBatch(chunk)
    Object.assign(map, res.results)
  }
  let resolved = 0
  const failedNames: string[] = []
  const failuresByReason: Record<string, string[]> = {}
  for (const [name, entry] of Object.entries(map)) {
    if (entry.url) {
      resolved++
    } else {
      failedNames.push(name)
      const reason = entry.error ?? "Falha desconhecida"
      if (!failuresByReason[reason]) failuresByReason[reason] = []
      failuresByReason[reason].push(name)
    }
  }
  return { map, resolved, failedNames, failuresByReason }
}

const MEDIA_TYPE_LABEL: Record<string, string> = {
  video: "Vídeo",
  image: "Imagem",
}

/**
 * Valor de uma coluna de dimensão (Pack/Conta) para o CSV.
 *
 * Resolvido a partir de `row.original`, e NÃO de `row.getValue(id)`: o dialog de export permite
 * escolher colunas que não estão ativas na tabela, e para essas o TanStack devolveria `undefined`
 * (a coluna nem foi construída) — a coluna sairia vazia no CSV.
 */
function dimensionValue(colId: ManagerColumnType, original: RankingsItem, provenanceIndex: ProvenanceIndex): string {
  const names = colId === "pack" ? getRowPackNames(original, provenanceIndex) : getRowAccountNames(original, provenanceIndex)
  return names.join(" | ")
}

export async function exportManagerToCsv({
  table,
  activeColumns,
  columnOrder,
  hasSheetIntegration,
  currentTab,
  dateStart,
  dateStop,
  withTranscriptions = false,
  withMediaUrls = false,
  videoUrlMap,
  rowsSnapshot,
  metricContext,
  provenanceIndex,
}: {
  table: Table<RankingsItem>
  activeColumns: Set<ManagerColumnType>
  /** Índice id→nome de packs/contas — as colunas Pack/Conta saem com nome, não com UUID. */
  provenanceIndex: ProvenanceIndex
  /** Ordem das colunas escolhida no Manager — o CSV sai na mesma ordem da tabela. */
  columnOrder?: readonly ManagerColumnType[]
  hasSheetIntegration: boolean
  currentTab: ManagerTab
  dateStart?: string
  dateStop?: string
  withTranscriptions?: boolean
  withMediaUrls?: boolean
  /** Mapa pré-resolvido pelo dialog (fase de revisão). Sem ele, resolve aqui. */
  videoUrlMap?: VideoUrlMap
  /** Linhas congeladas pelo dialog no início do fluxo. Sem isso, um refetch da tabela
   * entre a resolução de URLs e o download reclassificaria linhas e o arquivo
   * divergiria da tela de revisão (vídeo sem entrada no mapa → célula vazia). */
  rowsSnapshot?: readonly Row<RankingsItem>[]
  /** Contexto das métricas (actionType p/ results/CPR, mqlLeadscoreMin p/ MQL) — necessário
   * para calcular colunas que NÃO estão ativas na tabela (sem accessor no TanStack). */
  metricContext?: MetricValueContext
}): Promise<void> {
  const rows = rowsSnapshot ?? table.getSortedRowModel().rows
  // Colunas realmente construídas na tabela: só nessas row.getValue() é válido —
  // para as demais (escolhidas no dialog mas inativas), TanStack loga erro e devolve
  // undefined; calculamos direto de row.original com a função compartilhada.
  const tableColumnIds = new Set(table.getAllFlatColumns().map((c) => c.id))
  const showTranscriptions = withTranscriptions && TABS_WITH_TRANSCRIPTION.has(currentTab)
  const showMediaType = TABS_WITH_MEDIA_TYPE.has(currentTab)
  const showMediaUrls = withMediaUrls && TABS_WITH_MEDIA_URLS.has(currentTab)

  const visibleMetricColumns = getVisibleManagerColumns({ activeColumns, columnOrder, hasSheetIntegration })

  // Buscar transcrições em batch se necessário
  let transcriptionMap: Record<string, string> = {}
  if (showTranscriptions) {
    const adNamesWithTranscription = Array.from(
      new Set(
        rows
          .filter((r) => r.original.has_transcription)
          .map((r) => String(r.original.ad_name ?? ""))
          .filter(Boolean)
      )
    )
    if (adNamesWithTranscription.length > 0) {
      transcriptionMap = await api.analytics.getTranscriptionsBatch(adNamesWithTranscription)
    }
  }

  // URLs de vídeo: usa o mapa pré-resolvido do dialog ou resolve aqui (só linhas
  // de vídeo; imagens usam a thumb do Storage)
  let resolvedVideoUrlMap: VideoUrlMap = videoUrlMap ?? {}
  if (showMediaUrls && !videoUrlMap) {
    const videoAdNames = getVideoAdNames(rows)
    if (videoAdNames.length > 0) {
      resolvedVideoUrlMap = (await fetchVideoUrls(videoAdNames)).map
    }
  }

  // Ordem: Nome | Status | Media type | [métricas] | Transcrição | URL da mídia | URL expira em | Video ID
  const headers: string[] = [TAB_NAME_HEADER[currentTab]]
  headers.push("Status")
  if (showMediaType) headers.push("Media type")
  for (const col of visibleMetricColumns) headers.push(col.name)
  if (showTranscriptions) headers.push("Transcrição")
  if (showMediaUrls) headers.push("URL da mídia", "URL expira em", "Video ID")

  const dataRows = rows.map((row) => {
    const cells: string[] = [neutralizeFormula(getNameValue(currentTab, row))]
    cells.push(neutralizeFormula(String(row.original.effective_status ?? "")))
    if (showMediaType) {
      const mt = row.original.media_type ?? ""
      cells.push(MEDIA_TYPE_LABEL[mt] ?? "")
    }
    for (const col of visibleMetricColumns) {
      // Nome de pack/conta é texto livre (o usuário nomeia o pack) → anti formula-injection.
      // Métricas nunca passam por aqui: podem ser negativas e o apóstrofo as corromperia.
      if (col.isDimension) {
        cells.push(neutralizeFormula(dimensionValue(col.id, row.original, provenanceIndex)))
        continue
      }
      const raw = tableColumnIds.has(col.id)
        ? row.getValue(col.id)
        : getMetricNumericValueOrNull(row.original, col.id, metricContext ?? {})
      cells.push(formatValue(col.id, raw))
    }
    if (showTranscriptions) {
      const adName = String(row.original.ad_name ?? "")
      cells.push(neutralizeFormula(transcriptionMap[adName] ?? ""))
    }
    if (showMediaUrls) {
      const original = row.original
      if (original.media_type === "video") {
        const entry = resolvedVideoUrlMap[String(original.ad_name ?? "")]
        // Falha vira "ERRO: <motivo>" — quem consome a planilha (IA) distingue
        // "sem vídeo" de "falhou ao resolver"
        const urlCell = entry?.url ?? (entry?.error ? `ERRO: ${entry.error}` : "")
        cells.push(neutralizeFormula(urlCell), entry?.expires_at ?? "", entry?.video_id ?? "")
      } else {
        // Imagem: thumbnail do Storage (permanente) — sem expiry, sem video_id
        cells.push(getAdThumbnail(original) ?? "", "", "")
      }
    }
    return cells
  })

  const csvLines = [headers, ...dataRows].map((row) => row.map(escapeCell).join(";"))
  const csvContent = "﻿" + csvLines.join("\n")

  triggerDownload(csvContent, `hookify-manager-${currentTab}-${dateStart ?? "inicio"}-${dateStop ?? "fim"}.csv`)
}
