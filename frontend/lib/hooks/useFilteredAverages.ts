"use client";

import { useMemo } from "react";
import type { Table } from "@tanstack/react-table";
import type { ColumnFiltersState } from "@tanstack/react-table";
import { RankingsItem } from "@/lib/api/schemas";
import { computeManagerAverages, type ManagerAverages } from "@/lib/metrics";
import type { CustomColumnDef } from "@/lib/metrics/customColumns";

interface UseFilteredAveragesOptions {
  table: Table<RankingsItem>;
  dataLength: number;
  columnFilters: ColumnFiltersState;
  globalFilter: string;
  actionType?: string;
  hasSheetIntegration?: boolean;
  mqlLeadscoreMin: number | null;
  /** 140: colunas vinculadas da planilha (médias em `custom`). */
  customColumns?: ReadonlyArray<CustomColumnDef>;
}

/**
 * Calcula médias dos dados filtrados (visíveis após filtros/sorting).
 * Retorna `null` quando não há filtro efetivo (i.e. n === dataLength) ou n === 0.
 */
export function useFilteredAverages({
  table,
  dataLength,
  columnFilters,
  globalFilter,
  actionType,
  hasSheetIntegration = false,
  mqlLeadscoreMin,
  customColumns,
}: UseFilteredAveragesOptions): ManagerAverages | null {
  return useMemo(() => {
    const filteredRows = table.getFilteredRowModel().rows;
    const filteredAds = filteredRows.map((row) => row.original as RankingsItem);
    const n = filteredAds.length;

    if (n === 0 || n === dataLength) return null;

    return computeManagerAverages(filteredAds, {
      actionType,
      hasSheetIntegration,
      includeScrollStop: false,
      mqlLeadscoreMin,
      customColumns,
    });
  }, [table, dataLength, columnFilters, globalFilter, actionType, hasSheetIntegration, mqlLeadscoreMin, customColumns]);
}
