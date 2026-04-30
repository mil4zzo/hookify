"use client";

import React from "react";
import type { ColumnFiltersState } from "@tanstack/react-table";
import type { ManagerColumnType } from "@/components/common/ManagerColumnFilter";
import { ManagerChildrenTable } from "@/components/manager/ManagerChildrenTable";
import { useAdVariations, useAdsetChildren } from "@/lib/api/hooks";

interface ExpandedChildrenRowProps {
  adName?: string;
  adsetId?: string;
  dateStart: string;
  dateStop: string;
  actionType?: string;
  /**
   * Packs selecionados no Manager. Quando não vazio, restringe variações/filhos
   * a métricas que pertencem a esses packs (via ad_metric_pack_map). Sem isso,
   * ads compartilhados entre packs com date_ranges diferentes super-contam.
   */
  packIds?: string[];
  formatCurrency: (n: number) => string;
  formatPct: (v: number) => string;
  activeColumns: Set<ManagerColumnType>;
  hasSheetIntegration?: boolean;
  mqlLeadscoreMin?: number;
  columnFilters?: ColumnFiltersState;
  setColumnFilters?: React.Dispatch<React.SetStateAction<ColumnFiltersState>>;
  /** Quando true, retorna apenas o conteúdo interno (sem tr/td) para uso dentro de uma célula pai */
  asContent?: boolean;
}

function areExpandedChildrenRowPropsEqual(prev: ExpandedChildrenRowProps, next: ExpandedChildrenRowProps): boolean {
  const activeColumnsEqual = prev.activeColumns.size === next.activeColumns.size && Array.from(prev.activeColumns).every((column) => next.activeColumns.has(column));
  const columnFiltersEqual = (prev.columnFilters?.length ?? 0) === (next.columnFilters?.length ?? 0) && JSON.stringify(prev.columnFilters ?? []) === JSON.stringify(next.columnFilters ?? []);
  const prevPackKey = [...(prev.packIds ?? [])].sort().join("|");
  const nextPackKey = [...(next.packIds ?? [])].sort().join("|");

  return (
    prev.asContent === next.asContent &&
    prev.adName === next.adName &&
    prev.adsetId === next.adsetId &&
    prev.dateStart === next.dateStart &&
    prev.dateStop === next.dateStop &&
    prev.actionType === next.actionType &&
    prevPackKey === nextPackKey &&
    prev.formatCurrency === next.formatCurrency &&
    prev.formatPct === next.formatPct &&
    activeColumnsEqual &&
    prev.hasSheetIntegration === next.hasSheetIntegration &&
    prev.mqlLeadscoreMin === next.mqlLeadscoreMin &&
    columnFiltersEqual &&
    prev.setColumnFilters === next.setColumnFilters
  );
}

export const ExpandedChildrenRow = React.memo(function ExpandedChildrenRow({
  adName,
  adsetId,
  dateStart,
  dateStop,
  actionType,
  packIds = [],
  formatCurrency,
  formatPct,
  activeColumns,
  hasSheetIntegration = false,
  mqlLeadscoreMin = 0,
  columnFilters = [],
  setColumnFilters,
  asContent = false,
}: ExpandedChildrenRowProps) {
  const adVariationsQuery = useAdVariations(adName || "", dateStart, dateStop, packIds, !!adName);
  const adsetChildrenQuery = useAdsetChildren(adsetId || "", dateStart, dateStop, packIds, !!adsetId);
  const { data: childrenData, isLoading, isError } = adsetId ? adsetChildrenQuery : adVariationsQuery;

  return (
    <ManagerChildrenTable
      childrenData={childrenData}
      isLoading={isLoading}
      isError={isError}
      adsetId={adsetId}
      actionType={actionType}
      formatCurrency={formatCurrency}
      formatPct={formatPct}
      activeColumns={activeColumns}
      hasSheetIntegration={hasSheetIntegration}
      mqlLeadscoreMin={mqlLeadscoreMin}
      columnFilters={columnFilters}
      setColumnFilters={setColumnFilters}
      asContent={asContent}
    />
  );
}, areExpandedChildrenRowPropsEqual);
