"use client";

import React from "react";
import type { ColumnDef, ColumnHelper } from "@tanstack/react-table";
import type { RankingsItem } from "@/lib/api/schemas";
import type { ManagerColumnType } from "@/components/common/ManagerColumnFilter";
import type { FilterValue, TextFilterValue, StatusFilterValue } from "@/components/common/ColumnFilter";
import type { DailySeriesByKey } from "@/lib/utils/metricsTimeSeries";
import type { ManagerAverages } from "@/lib/hooks/useManagerAverages";
import type { SettingsTab } from "@/lib/store/settingsModal";
import type { ColumnFiltersState } from "@tanstack/react-table";
import { buildMetricColumns, SortIcon } from "@/components/manager/managerTableMetricColumns";
import { AdNameCell } from "@/components/manager/AdNameCell";
import { StatusCell } from "@/components/manager/StatusCell";

export type ViewMode = "detailed" | "minimal";

export type CreateManagerTableColumnsParams = {
  columnHelper: ColumnHelper<RankingsItem>;
  activeColumns: Set<ManagerColumnType>;
  groupByAdNameEffective: boolean;
  byKey: DailySeriesByKey;
  expanded: Record<string, boolean>;
  expandedRef: React.MutableRefObject<Record<string, boolean>>;
  setExpanded: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;

  currentTab: "individual" | "por-anuncio" | "por-conjunto" | "por-campanha";
  getRowKey: (row: { original?: RankingsItem } | RankingsItem) => string;

  endDate?: string;
  showTrends: boolean;
  averages: ManagerAverages;
  formatAverage: (metricId: string) => string;
  filteredAveragesRef: React.MutableRefObject<ManagerAverages | null>;
  formatFilteredAverageRef: React.MutableRefObject<(metricId: string) => string>;

  formatCurrency: (n: number) => string;
  formatPct: (v: number) => string;

  viewMode: ViewMode;
  hasSheetIntegration: boolean;
  mqlLeadscoreMin: number;
  actionType: string;

  applyNumericFilter: (rowValue: number | null | undefined, filterValue: FilterValue | undefined) => boolean;
  openSettings: (tab?: SettingsTab) => void;
  columnFiltersRef: React.MutableRefObject<ColumnFiltersState>;
  globalFilterRef: React.MutableRefObject<string>;
};

function textFilterFnSingle(row: any, filterValue: TextFilterValue | undefined, fieldName: keyof RankingsItem): boolean {
  if (!filterValue || filterValue.value === null || filterValue.value === undefined) {
    return true;
  }
  const fieldValue = String((row.original as RankingsItem)?.[fieldName] || "").toLowerCase();
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

function textFilterFn(row: any, _columnId: string, filterValue: TextFilterValue | TextFilterValue[] | undefined, fieldName: keyof RankingsItem): boolean {
  if (!filterValue) return true;
  if (Array.isArray(filterValue)) {
    return filterValue.every((fv) => textFilterFnSingle(row, fv, fieldName));
  }
  return textFilterFnSingle(row, filterValue, fieldName);
}

/** Considera ativo apenas ACTIVE; demais (PAUSED, ADSET_PAUSED, etc.) são inativos. */
function isActiveStatus(status?: string | null): boolean {
  if (!status) return false;
  return String(status).toUpperCase() === "ACTIVE";
}

/** Ordenação por status: ativos primeiro (asc) ou inativos primeiro (desc). */
function statusSortingFn(rowA: { getValue: (id: string) => unknown; original: RankingsItem }, rowB: { getValue: (id: string) => unknown; original: RankingsItem }): number {
  const activeA = isActiveStatus(rowA.original?.effective_status);
  const activeB = isActiveStatus(rowB.original?.effective_status);
  if (activeA === activeB) return 0;
  // Valor menor = vir primeiro quando asc → ativos primeiro
  return activeA && !activeB ? -1 : 1;
}

export function createManagerTableColumns(params: CreateManagerTableColumnsParams): ColumnDef<RankingsItem, any>[] {
  const { columnHelper, currentTab, getRowKey, expanded, expandedRef, setExpanded, groupByAdNameEffective } = params;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cols: ColumnDef<RankingsItem, any>[] = [];

  // Status column (primeira coluna - visível exceto na aba "por-anuncio")
  if (currentTab !== "por-anuncio") {
    cols.push(
      columnHelper.accessor("effective_status", {
        id: "status",
        header: ({ column }) => (
          <div className="flex items-center gap-1">
            <SortIcon column={column} invertDirection />
            <span>Status</span>
          </div>
        ),
        size: 80,
        minSize: 80,
        enableResizing: false,
        enableSorting: true,
        sortDescFirst: false, // primeiro clique = ativos primeiro, exibimos como seta baixo (invertDirection)
        sortingFn: statusSortingFn,
        filterFn: (row, _columnId, filterValue: StatusFilterValue | StatusFilterValue[] | undefined) => {
          const checkOne = (fv: StatusFilterValue | undefined) => {
            if (!fv || !fv.selectedStatuses || fv.selectedStatuses.length === 0) return true;
            const status = row.original.effective_status;
            if (!status) return false;
            return fv.selectedStatuses.includes(status);
          };
          if (!filterValue) return true;
          if (Array.isArray(filterValue)) return filterValue.every(checkOne);
          return checkOne(filterValue);
        },
        cell: (info) => {
          const original = info.row.original as RankingsItem;
          return <StatusCell original={original} currentTab={currentTab} />;
        },
      }),
    );
  }

  // AD name (sempre visível)
  const nameColumnLabel = currentTab === "por-conjunto" ? "Conjunto" : currentTab === "por-campanha" ? "Campanha" : "Anúncio";
  cols.push(
    columnHelper.accessor("ad_name", {
      sortDescFirst: false, // primeiro clique = A-Z, exibimos como seta baixo (invertDirection)
      header: ({ column }) => (
        <div className="flex items-center gap-1">
          <SortIcon column={column} invertDirection />
          <span>{nameColumnLabel}</span>
        </div>
      ),
      size: 300,
      minSize: 160,
      enableResizing: true,
      sortingFn: "auto",
      filterFn: (row, columnId, filterValue: TextFilterValue | undefined) => textFilterFn(row, columnId, filterValue, "ad_name"),
      cell: (info) => {
        const original = info.row.original as RankingsItem;
        const name = String(info.getValue() || "—");
        return <AdNameCell original={original} value={name} getRowKey={getRowKey} expanded={expanded} setExpanded={setExpanded} groupByAdNameEffective={groupByAdNameEffective} currentTab={currentTab} />;
      },
    }),
  );

  // Colunas ocultas para filtros de nome cruzados (adset_name e campaign_name)
  cols.push(
    columnHelper.accessor("adset_name", {
      id: "adset_name_filter",
      header: () => null,
      enableSorting: false,
      enableResizing: false,
      size: 0,
      minSize: 0,
      maxSize: 0,
      filterFn: (row, columnId, filterValue: TextFilterValue | undefined) => textFilterFn(row, columnId, filterValue, "adset_name"),
      cell: () => null,
    }),
  );

  cols.push(
    columnHelper.accessor("campaign_name", {
      id: "campaign_name_filter",
      header: () => null,
      enableSorting: false,
      enableResizing: false,
      size: 0,
      minSize: 0,
      maxSize: 0,
      filterFn: (row, columnId, filterValue: TextFilterValue | undefined) => textFilterFn(row, columnId, filterValue, "campaign_name"),
      cell: () => null,
    }),
  );

  cols.push(...buildMetricColumns(params));

  return cols;
}
