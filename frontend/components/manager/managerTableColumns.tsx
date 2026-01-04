"use client";

import React from "react";
import type { ColumnDef, ColumnHelper } from "@tanstack/react-table";
import type { RankingsItem } from "@/lib/api/schemas";
import type { ManagerColumnType } from "@/components/common/ManagerColumnFilter";
import type { FilterValue, TextFilterValue } from "@/components/common/ColumnFilter";
import type { DailySeriesByKey } from "@/lib/utils/metricsTimeSeries";
import type { ManagerAverages } from "@/lib/hooks/useManagerAverages";
import type { SettingsTab } from "@/lib/store/settingsModal";
import type { ColumnFiltersState } from "@tanstack/react-table";
import { buildMetricColumns } from "@/components/manager/managerTableMetricColumns";
import { AdNameCell } from "@/components/manager/AdNameCell";
import { StatusCell } from "@/components/manager/StatusCell";

export type ViewMode = "detailed" | "minimal";

export type CreateManagerTableColumnsParams = {
  columnHelper: ColumnHelper<RankingsItem>;
  activeColumns: Set<ManagerColumnType>;
  groupByAdNameEffective: boolean;
  byKey: DailySeriesByKey;
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

export function createManagerTableColumns(params: CreateManagerTableColumnsParams): ColumnDef<RankingsItem, unknown>[] {
  const { columnHelper, currentTab, getRowKey, expandedRef, setExpanded, groupByAdNameEffective } = params;

  const cols: ColumnDef<RankingsItem, unknown>[] = [];

  // Status column (primeira coluna - visível exceto na aba "por-anuncio")
  if (currentTab !== "por-anuncio") {
    cols.push(
      columnHelper.display({
        id: "status",
        header: "Status",
        size: 80,
        minSize: 80,
        enableResizing: false,
        enableSorting: false,
        cell: (info) => {
          const original = info.row.original as RankingsItem;
          return <StatusCell original={original} currentTab={currentTab} showConfirm={true} />;
        },
      })
    );
  }

  // AD name (sempre visível)
  cols.push(
    columnHelper.accessor("ad_name", {
      header: currentTab === "por-conjunto" ? "Conjunto" : currentTab === "por-campanha" ? "Campanha" : "Anúncio",
      size: 300,
      minSize: 160,
      enableResizing: true,
      sortingFn: "auto",
      filterFn: (row, columnId, filterValue: TextFilterValue | undefined) => {
        if (!filterValue || filterValue.value === null || filterValue.value === undefined) {
          return true;
        }

        const original = row.original as RankingsItem;
        const adName = String(original?.ad_name || "").toLowerCase();
        const searchValue = String(filterValue.value).toLowerCase();

        switch (filterValue.operator) {
          case "contains":
            return adName.includes(searchValue);
          case "not_contains":
            return !adName.includes(searchValue);
          case "starts_with":
            return adName.startsWith(searchValue);
          case "ends_with":
            return adName.endsWith(searchValue);
          case "equals":
            return adName === searchValue;
          case "not_equals":
            return adName !== searchValue;
          default:
            return true;
        }
      },
      cell: (info) => {
        const original = info.row.original as RankingsItem;
        const name = String(info.getValue() || "—");
        return <AdNameCell original={original} value={name} getRowKey={getRowKey} expanded={expandedRef.current} setExpanded={setExpanded} groupByAdNameEffective={groupByAdNameEffective} currentTab={currentTab} />;
      },
    })
  );

  cols.push(...buildMetricColumns(params));

  return cols;
}
