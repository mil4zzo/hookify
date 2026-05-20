import type { Table } from "@tanstack/react-table"
import type { RankingsItem } from "@/lib/api/schemas"
import { MANAGER_COLUMNS } from "@/components/manager/managerColumns"
import type { ManagerColumnType } from "@/components/common/ManagerColumnFilter"

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

function escapeCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

export function exportManagerToCsv({
  table,
  activeColumns,
  hasSheetIntegration,
  currentTab,
  dateStart,
  dateStop,
}: {
  table: Table<RankingsItem>
  activeColumns: Set<ManagerColumnType>
  hasSheetIntegration: boolean
  currentTab: ManagerTab
  dateStart?: string
  dateStop?: string
}): void {
  const rows = table.getSortedRowModel().rows
  const showStatus = currentTab !== "por-anuncio"

  const visibleMetricColumns = MANAGER_COLUMNS.filter((col) => {
    if (!activeColumns.has(col.id)) return false
    if ((col.id === "mqls" || col.id === "cpmql") && !hasSheetIntegration) return false
    return true
  })

  const headers: string[] = [TAB_NAME_HEADER[currentTab]]
  if (showStatus) headers.push("Status")
  for (const col of visibleMetricColumns) {
    headers.push(col.name)
  }

  const dataRows = rows.map((row) => {
    const cells: string[] = [getNameValue(currentTab, row)]
    if (showStatus) cells.push(String(row.original.effective_status ?? ""))
    for (const col of visibleMetricColumns) {
      cells.push(formatValue(col.id, row.getValue(col.id)))
    }
    return cells
  })

  const csvLines = [headers, ...dataRows].map((row) => row.map(escapeCell).join(";"))
  const csvContent = "﻿" + csvLines.join("\n")

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = `hookify-manager-${currentTab}-${dateStart ?? "inicio"}-${dateStop ?? "fim"}.csv`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
