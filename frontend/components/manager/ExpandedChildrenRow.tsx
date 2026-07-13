"use client";

import React from "react";
import type { ColumnFiltersState } from "@tanstack/react-table";
import type { ManagerColumnType } from "@/components/common/ManagerColumnFilter";
import { ManagerChildrenTable } from "@/components/manager/ManagerChildrenTable";
import { useAdVariations, useAdsetChildren } from "@/lib/api/hooks";
import type { RankingsChildrenItem } from "@/lib/api/schemas";

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
  /** Ordem das colunas de métrica escolhida no Manager. Ausente = ordem padrão. */
  columnOrder?: readonly ManagerColumnType[];
  hasSheetIntegration?: boolean;
  mqlLeadscoreMin?: number;
  columnFilters?: ColumnFiltersState;
  setColumnFilters?: React.Dispatch<React.SetStateAction<ColumnFiltersState>>;
  /** Quando true, retorna apenas o conteúdo interno (sem tr/td) para uso dentro de uma célula pai */
  asContent?: boolean;
  /** Quando definido, cada linha vira clicável e dispara este callback. */
  onRowClick?: (child: RankingsChildrenItem) => void;
}

function areExpandedChildrenRowPropsEqual(prev: ExpandedChildrenRowProps, next: ExpandedChildrenRowProps): boolean {
  const activeColumnsEqual = prev.activeColumns.size === next.activeColumns.size && Array.from(prev.activeColumns).every((column) => next.activeColumns.has(column));
  const columnOrderEqual = (prev.columnOrder?.length ?? 0) === (next.columnOrder?.length ?? 0) && (prev.columnOrder ?? []).every((column, i) => next.columnOrder?.[i] === column);
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
    columnOrderEqual &&
    prev.hasSheetIntegration === next.hasSheetIntegration &&
    prev.mqlLeadscoreMin === next.mqlLeadscoreMin &&
    columnFiltersEqual &&
    prev.setColumnFilters === next.setColumnFilters &&
    prev.onRowClick === next.onRowClick
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
  columnOrder,
  hasSheetIntegration = false,
  mqlLeadscoreMin = 0,
  columnFilters = [],
  setColumnFilters,
  asContent = false,
  onRowClick,
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
      columnOrder={columnOrder}
      hasSheetIntegration={hasSheetIntegration}
      mqlLeadscoreMin={mqlLeadscoreMin}
      columnFilters={columnFilters}
      setColumnFilters={setColumnFilters}
      asContent={asContent}
      onRowClick={onRowClick}
    />
  );
}, areExpandedChildrenRowPropsEqual);
