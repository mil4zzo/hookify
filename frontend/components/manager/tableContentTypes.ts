import React from "react";
import type { Table, ColumnFiltersState } from "@tanstack/react-table";
import type { RankingsItem } from "@/lib/api/schemas";
import type { ManagerColumnType } from "@/components/common/ManagerColumnFilter";

export type ManagerTab = "individual" | "por-anuncio" | "por-conjunto" | "por-campanha";

/**
 * Props compartilhadas entre TableContent e MinimalTableContent
 * para evitar drift e duplicação de tipos
 */
export interface SharedTableContentProps {
  table: Table<RankingsItem>;
  isLoadingEffective: boolean;
  getRowKey: (row: { original?: RankingsItem } | RankingsItem) => string;
  expanded: Record<string, boolean>;
  setExpanded: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  groupByAdNameEffective: boolean;
  currentTab: ManagerTab;
  setSelectedAd: (ad: RankingsItem) => void;
  setSelectedAdset: React.Dispatch<React.SetStateAction<{ adsetId: string; adsetName?: string | null } | null>>;
  dateStart?: string;
  dateStop?: string;
  actionType: string;
  formatCurrency: (n: number) => string;
  formatPct: (v: number) => string;
  columnFilters: ColumnFiltersState;
  setColumnFilters: React.Dispatch<React.SetStateAction<ColumnFiltersState>>;
  activeColumns: Set<ManagerColumnType>;
  hasSheetIntegration?: boolean;
  mqlLeadscoreMin?: number;
  // Adicionado para comparação confiável no React.memo
  sorting: { id: string; desc: boolean }[];
  // Adicionado para detectar quando dados chegam do servidor (evita cache incorreto)
  dataLength: number;
}

