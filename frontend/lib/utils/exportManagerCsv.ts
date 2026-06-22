import type { Table } from "@tanstack/react-table"
import type { RankingsItem } from "@/lib/api/schemas"
import { MANAGER_COLUMNS } from "@/components/manager/managerColumns"
import type { ManagerColumnType } from "@/components/common/ManagerColumnFilter"
import { api } from "@/lib/api/endpoints"

type ManagerTab = "individual" | "por-anuncio" | "por-conjunto" | "por-campanha"

const RATIO_COLUMNS = new Set<ManagerColumnType>(["hook", "ctr", "website_ctr", "connect_rate", "page_conv"])
const INTEGER_COLUMNS = new Set<ManagerColumnType>(["impressions", "results", "mqls"])

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

const MEDIA_TYPE_LABEL: Record<string, string> = {
  video: "Vídeo",
  image: "Imagem",
}

export async function exportManagerToCsv({
  table,
  activeColumns,
  hasSheetIntegration,
  currentTab,
  dateStart,
  dateStop,
  withTranscriptions = false,
}: {
  table: Table<RankingsItem>
  activeColumns: Set<ManagerColumnType>
  hasSheetIntegration: boolean
  currentTab: ManagerTab
  dateStart?: string
  dateStop?: string
  withTranscriptions?: boolean
}): Promise<void> {
  const rows = table.getSortedRowModel().rows
  const showTranscriptions = withTranscriptions && TABS_WITH_TRANSCRIPTION.has(currentTab)
  const showMediaType = TABS_WITH_MEDIA_TYPE.has(currentTab)

  const visibleMetricColumns = MANAGER_COLUMNS.filter((col) => {
    if (!activeColumns.has(col.id)) return false
    if ((col.id === "mqls" || col.id === "cpmql") && !hasSheetIntegration) return false
    return true
  })

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

  // Ordem: Nome | Status | Media type | [métricas] | Transcrição
  const headers: string[] = [TAB_NAME_HEADER[currentTab]]
  headers.push("Status")
  if (showMediaType) headers.push("Media type")
  for (const col of visibleMetricColumns) headers.push(col.name)
  if (showTranscriptions) headers.push("Transcrição")

  const dataRows = rows.map((row) => {
    const cells: string[] = [neutralizeFormula(getNameValue(currentTab, row))]
    cells.push(neutralizeFormula(String(row.original.effective_status ?? "")))
    if (showMediaType) {
      const mt = row.original.media_type ?? ""
      cells.push(MEDIA_TYPE_LABEL[mt] ?? "")
    }
    for (const col of visibleMetricColumns) cells.push(formatValue(col.id, row.getValue(col.id)))
    if (showTranscriptions) {
      const adName = String(row.original.ad_name ?? "")
      cells.push(neutralizeFormula(transcriptionMap[adName] ?? ""))
    }
    return cells
  })

  const csvLines = [headers, ...dataRows].map((row) => row.map(escapeCell).join(";"))
  const csvContent = "﻿" + csvLines.join("\n")

  triggerDownload(csvContent, `hookify-manager-${currentTab}-${dateStart ?? "inicio"}-${dateStop ?? "fim"}.csv`)
}
