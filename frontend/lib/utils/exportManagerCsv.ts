import type { Table } from "@tanstack/react-table"
import type { RankingsItem } from "@/lib/api/schemas"
import { getVisibleManagerColumns } from "@/components/manager/managerColumnPreferences"
import type { ManagerColumnType } from "@/components/common/ManagerColumnFilter"
import { getRowAccountNames, getRowPackNames, type ProvenanceIndex } from "@/lib/manager/provenance"
import { api } from "@/lib/api/endpoints"

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
}): Promise<void> {
  const rows = table.getSortedRowModel().rows
  const showTranscriptions = withTranscriptions && TABS_WITH_TRANSCRIPTION.has(currentTab)
  const showMediaType = TABS_WITH_MEDIA_TYPE.has(currentTab)

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
    for (const col of visibleMetricColumns) {
      // Nome de pack/conta é texto livre (o usuário nomeia o pack) → anti formula-injection.
      // Métricas nunca passam por aqui: podem ser negativas e o apóstrofo as corromperia.
      if (col.isDimension) {
        cells.push(neutralizeFormula(dimensionValue(col.id, row.original, provenanceIndex)))
        continue
      }
      cells.push(formatValue(col.id, row.getValue(col.id)))
    }
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
