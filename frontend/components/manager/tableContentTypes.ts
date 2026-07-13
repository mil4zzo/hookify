import React from "react";
import type { Table, ColumnFiltersState, RowSelectionState } from "@tanstack/react-table";
import type { RankingsItem } from "@/lib/api/schemas";
import type { ManagerColumnType } from "@/components/common/ManagerColumnFilter";

export type ManagerTab = "individual" | "por-anuncio" | "por-conjunto" | "por-campanha";

/**
 * Alturas de linha das tabelas do manager (estimativa do virtualizador; a altura real
 * é medida via measureElement). Espelham os tokens `row-compact` (2.5rem) e
 * `row-detailed` (7.5rem) de tailwind.config.ts — alterar lá e aqui juntos.
 */
export const MANAGER_ROW_HEIGHT = {
  /** viewMode "minimal" — token row-compact */
  minimal: 40,
  /** viewMode "detailed" (com thumbnail) — token row-detailed */
  detailed: 120,
} as const;

/**
 * Props do TableContent (compartilhadas pelas variantes "detailed" e "minimal")
 */
export interface SharedTableContentProps {
  table: Table<RankingsItem>;
  isLoadingEffective: boolean;
  getRowKey: (row: { original?: RankingsItem } | RankingsItem) => string;
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
  /** Ordem das colunas de métrica. Não é lida no render (a tabela já vem ordenada por state.columnOrder),
   * mas precisa ser prop explícita: `table` é instância mutável estável e o React.memo não veria o reorder. */
  columnOrder: readonly ManagerColumnType[];
  hasSheetIntegration?: boolean;
  mqlLeadscoreMin?: number;
  // Adicionado para comparação confiável no React.memo
  sorting: { id: string; desc: boolean }[];
  /** Seleção de linhas (aba individual). Precisa ser prop explícita: table.getState() não detecta mudança
   * porque table é instância mutável estável. Comparada por referência no React.memo — setRowSelection gera
   * objeto novo a cada toggle. Sem isso, o checkbox fica visualmente defasado até um render não relacionado. */
  rowSelection: RowSelectionState;
  // Adicionado para detectar quando dados chegam do servidor (evita cache incorreto)
  dataLength: number;
  /** Referência direta ao array de dados para detectar mudanças de conteúdo (ex: series data) no React.memo */
  dataRef: readonly any[] | any[];
  /** Toggle Médias vs Tendências: quando muda, a tabela deve re-renderizar para mostrar sparklines ou médias */
  showTrends?: boolean;
  /** Toggle Comparar com a média: quando muda, a tabela deve re-renderizar para (des)colorir os números. Não é usado diretamente aqui — serve de sinal para o React.memo re-renderizar com os novos closures de célula. */
  colorMetricValue?: boolean;
  /** Chaves de grupo visiveis no viewport virtualizado (ordem atual da tabela). */
  onVisibleRowKeysChange?: (keys: string[]) => void;
  /** Indica que a requisição falhou (ex: timeout do RPC). Exibe estado de erro no lugar de "Nenhum resultado". */
  isError?: boolean;
  /** Acionado ao clicar no chevron / linha de uma row drillable (campanha, conjunto, anúncio agrupado). */
  onOpenDrill?: (original: RankingsItem) => void;
}

