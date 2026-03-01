/**
 * Aplica filtros de coluna a um único row (para tabelas expandidas que não usam TanStack Table).
 * Replica a lógica da tabela pai: status, texto e numérico (com suporte a múltiplas condições AND por coluna).
 */

import { getColumnId } from "./columnFilters";
import type { FilterValue, TextFilterValue, StatusFilterValue } from "@/components/common/ColumnFilter";

const PERCENTAGE_COLUMNS = new Set([
  "hook",
  "ctr",
  "website_ctr",
  "connect_rate",
  "page_conv",
]);

const TEXT_COLUMN_TO_FIELD: Record<string, string> = {
  ad_name: "ad_name",
  adset_name_filter: "adset_name",
  campaign_name_filter: "campaign_name",
};

function applyNumericFilter(
  rowValue: number | null | undefined,
  filterValue: FilterValue | undefined,
  isPercentage: boolean
): boolean {
  if (!filterValue || filterValue.value === null || filterValue.value === undefined || isNaN(filterValue.value)) {
    return true;
  }
  if (rowValue === null || rowValue === undefined || isNaN(rowValue) || !isFinite(rowValue)) {
    return false;
  }
  let filterNum = filterValue.value!;
  if (isPercentage && filterNum > 1) {
    filterNum = filterNum / 100;
  }
  switch (filterValue.operator) {
    case ">":
      return rowValue > filterNum;
    case "<":
      return rowValue < filterNum;
    case ">=":
      return rowValue >= filterNum;
    case "<=":
      return rowValue <= filterNum;
    case "=":
      return Math.abs(rowValue - filterNum) < 0.0001;
    case "!=":
      return Math.abs(rowValue - filterNum) >= 0.0001;
    default:
      return true;
  }
}

function applyTextFilter(row: Record<string, unknown>, filterValue: TextFilterValue | undefined, fieldName: string): boolean {
  if (!filterValue || filterValue.value === null || filterValue.value === undefined) {
    return true;
  }
  const fieldValue = String((row[fieldName] ?? "") as string).toLowerCase();
  const searchValue = String(filterValue.value).toLowerCase();
  switch (filterValue.operator) {
    case "contains":
      return fieldValue.includes(searchValue);
    case "not_contains":
      return !fieldValue.includes(searchValue);
    case "starts_with":
      return fieldValue.startsWith(searchValue);
    case "ends_with":
      return fieldValue.endsWith(searchValue);
    case "equals":
      return fieldValue === searchValue;
    case "not_equals":
      return fieldValue !== searchValue;
    default:
      return true;
  }
}

function applyStatusFilter(row: Record<string, unknown>, filterValue: StatusFilterValue | undefined): boolean {
  if (!filterValue?.selectedStatuses?.length) return true;
  const status = row.effective_status as string | undefined;
  if (!status) return false;
  return filterValue.selectedStatuses.includes(status);
}

export type ColumnFilterEntry = { id: string; value: unknown };

/**
 * Aplica os filtros ao row. Retorna true se o row passa em todos os filtros (AND).
 * @param row - Objeto com effective_status, ad_name, adset_name, campaign_name, métricas
 * @param columnFilters - Array de { id, value } (pode ter ids com sufixo tipo "spend__123")
 */
export function applyRowFilters(row: Record<string, unknown>, columnFilters: ColumnFilterEntry[]): boolean {
  if (!columnFilters.length) return true;

  const byColumn = new Map<string, unknown[]>();
  for (const f of columnFilters) {
    if (!f.value) continue;
    const colId = getColumnId(f.id);
    const arr = byColumn.get(colId) ?? [];
    arr.push(f.value);
    byColumn.set(colId, arr);
  }

  for (const [colId, values] of byColumn) {
    for (const v of values) {
      if (!v || typeof v !== "object") continue;

      if ("selectedStatuses" in v) {
        if (!applyStatusFilter(row, v as StatusFilterValue)) return false;
        continue;
      }

      if ("operator" in v) {
        const fv = v as FilterValue | TextFilterValue;
        if ("value" in fv && typeof (fv as TextFilterValue).value === "string") {
          const fieldName = TEXT_COLUMN_TO_FIELD[colId] ?? colId;
          if (!applyTextFilter(row, fv as TextFilterValue, fieldName)) return false;
        } else {
          const numericValue = colId === "results" ? (row.results as number) : (row[colId] as number);
          const isPct = PERCENTAGE_COLUMNS.has(colId);
          if (!applyNumericFilter(numericValue ?? null, fv as FilterValue, isPct)) return false;
        }
        continue;
      }
    }
  }
  return true;
}
