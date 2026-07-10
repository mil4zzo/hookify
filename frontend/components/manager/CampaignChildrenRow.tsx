"use client";

import React from "react";
import type { ColumnFiltersState } from "@tanstack/react-table";
import { useCampaignChildren } from "@/lib/api/hooks";
import type { RankingsChildrenItem, RankingsItem } from "@/lib/api/schemas";
import type { ManagerColumnType } from "@/components/common/ManagerColumnFilter";
import { ManagerChildrenTable } from "@/components/manager/ManagerChildrenTable";

interface CampaignChildrenRowProps {
  campaignId: string;
  dateStart: string;
  dateStop: string;
  packIds?: string[];
  actionType?: string;
  formatCurrency: (n: number) => string;
  formatPct: (v: number) => string;
  activeColumns: Set<ManagerColumnType>;
  hasSheetIntegration?: boolean;
  mqlLeadscoreMin?: number;
  columnFilters?: ColumnFiltersState;
  setColumnFilters?: React.Dispatch<React.SetStateAction<ColumnFiltersState>>;
  /** Quando true, retorna apenas o conteúdo interno (sem tr/td) para uso dentro de uma célula pai */
  asContent?: boolean;
  /** Quando definido, cada linha vira clicável e dispara este callback (passa o adset). */
  onRowClick?: (adset: RankingsItem) => void;
}

function areCampaignChildrenRowPropsEqual(prev: CampaignChildrenRowProps, next: CampaignChildrenRowProps): boolean {
  const activeColumnsEqual = prev.activeColumns.size === next.activeColumns.size && Array.from(prev.activeColumns).every((col) => next.activeColumns.has(col));

  const columnFiltersEqual = (prev.columnFilters?.length ?? 0) === (next.columnFilters?.length ?? 0) && JSON.stringify(prev.columnFilters ?? []) === JSON.stringify(next.columnFilters ?? []);

  const prevPackIdsKey = [...(prev.packIds || [])].sort().join("|");
  const nextPackIdsKey = [...(next.packIds || [])].sort().join("|");

  return prev.asContent === next.asContent && prev.campaignId === next.campaignId && prev.dateStart === next.dateStart && prev.dateStop === next.dateStop && prev.actionType === next.actionType && prev.formatCurrency === next.formatCurrency && prev.formatPct === next.formatPct && activeColumnsEqual && prev.hasSheetIntegration === next.hasSheetIntegration && prev.mqlLeadscoreMin === next.mqlLeadscoreMin && columnFiltersEqual && prevPackIdsKey === nextPackIdsKey && prev.setColumnFilters === next.setColumnFilters && prev.onRowClick === next.onRowClick;
}

/** Filhos (adsets) de uma campanha — wrapper fino: só escolhe a query e delega ao ManagerChildrenTable. */
export const CampaignChildrenRow = React.memo(function CampaignChildrenRow({ campaignId, dateStart, dateStop, packIds = [], actionType, formatCurrency, formatPct, activeColumns, hasSheetIntegration = false, mqlLeadscoreMin = 0, columnFilters = [], setColumnFilters, asContent = false, onRowClick }: CampaignChildrenRowProps) {
  const { data: childrenData, isLoading, isError } = useCampaignChildren(campaignId, dateStart, dateStop, actionType, packIds, true);

  return (
    <ManagerChildrenTable
      entity="adsets"
      childrenData={childrenData as unknown as RankingsChildrenItem[] | undefined}
      isLoading={isLoading}
      isError={isError}
      actionType={actionType}
      formatCurrency={formatCurrency}
      formatPct={formatPct}
      activeColumns={activeColumns}
      hasSheetIntegration={hasSheetIntegration}
      mqlLeadscoreMin={mqlLeadscoreMin}
      columnFilters={columnFilters}
      setColumnFilters={setColumnFilters}
      asContent={asContent}
      onRowClick={onRowClick ? (child) => onRowClick(child as unknown as RankingsItem) : undefined}
    />
  );
}, areCampaignChildrenRowPropsEqual);
