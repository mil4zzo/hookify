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
  selectedPackIds?: string[];
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
  /** Referência direta ao array de dados para detectar mudanças de conteúdo (ex: series data) no React.memo */
  dataRef: readonly any[] | any[];
  /** Toggle Médias vs Tendências: quando muda, a tabela deve re-renderizar para mostrar sparklines ou médias */
  showTrends?: boolean;
  /** Filtros das tabelas expandidas (compartilhados por aba) */
  expandedTableColumnFilters?: ColumnFiltersState;
  setExpandedTableColumnFilters?: React.Dispatch<React.SetStateAction<ColumnFiltersState>>;
  /** Chaves de grupo visiveis no viewport virtualizado (ordem atual da tabela). */
  onVisibleRowKeysChange?: (keys: string[]) => void;
  /** Indica que a requisição falhou (ex: timeout do RPC). Exibe estado de erro no lugar de "Nenhum resultado". */
  isError?: boolean;
}

