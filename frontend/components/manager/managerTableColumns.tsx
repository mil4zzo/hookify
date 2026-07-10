"use client";

import React from "react";
import type { ColumnDef, ColumnHelper } from "@tanstack/react-table";
import type { RankingsItem } from "@/lib/api/schemas";
import type { ManagerColumnType } from "@/components/common/ManagerColumnFilter";
import type { FilterValue, TextFilterValue, StatusFilterValue } from "@/components/common/ColumnFilter";
import type { GroupedMetricSeriesByKey, ManagerAverages } from "@/lib/metrics";
import type { SettingsTab } from "@/lib/store/settingsModal";
import type { ColumnFiltersState } from "@tanstack/react-table";
import { buildMetricColumns, SortIcon } from "@/components/manager/managerTableMetricColumns";
import { AdNameCell } from "@/components/manager/AdNameCell";
import { StatusCell } from "@/components/manager/StatusCell";
import { BudgetCell, getRowBudgetMinor } from "@/components/manager/BudgetCell";
import { Checkbox } from "@/components/ui/checkbox";

export type ViewMode = "detailed" | "minimal";

export type CreateManagerTableColumnsParams = {
  columnHelper: ColumnHelper<RankingsItem>;
  activeColumns: Set<ManagerColumnType>;
  groupByAdNameEffective: boolean;
  byKey: GroupedMetricSeriesByKey;
  /** Acionado ao clicar no chevron de uma linha — abre o modal de drill. */
  onOpenDrill?: (original: RankingsItem) => void;

  currentTab: "individual" | "por-anuncio" | "por-conjunto" | "por-campanha";
  getRowKey: (row: { original?: RankingsItem } | RankingsItem) => string;

  endDate?: string;
  showTrends: boolean;
  averagesRef: React.MutableRefObject<ManagerAverages>;
  formatAverageRef: React.MutableRefObject<(metricId: string) => string>;
  filteredAveragesRef: React.MutableRefObject<ManagerAverages | null>;
  formatFilteredAverageRef: React.MutableRefObject<(metricId: string) => string>;

  formatCurrencyRef: React.MutableRefObject<(n: number) => string>;
  formatPct: (v: number) => string;

  viewMode: ViewMode;
  /** Quando true, colore o número de cada métrica pela distância da média (escala de 5 tons). */
  colorMetricValue: boolean;
  hasSheetIntegration: boolean;
  mqlLeadscoreMin: number;
  actionTypeRef: React.MutableRefObject<string>;
  /** Âncora do último checkbox clicado sem shift — habilita seleção em intervalo (shift+click). */
  selectionAnchorRef: React.MutableRefObject<string | null>;

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

function numericFilterFnMaybeArray(rowValue: number | null | undefined, filterValue: FilterValue | FilterValue[] | undefined, applyNumericFilter: (rowValue: number | null | undefined, filterValue: FilterValue | undefined) => boolean): boolean {
  if (!filterValue) return true;
  if (Array.isArray(filterValue)) {
    return filterValue.every((fv) => applyNumericFilter(rowValue, fv));
  }
  return applyNumericFilter(rowValue, filterValue);
}

/** Considera ativo apenas ACTIVE; demais (PAUSED, ADSET_PAUSED, etc.) são inativos. */
function isActiveStatus(status?: string | null): boolean {
  if (!status) return false;
  return String(status).toUpperCase() === "ACTIVE";
}

/** Ordenação por orçamento: budget próprio (daily ?? lifetime); linhas sem budget (CBO/ABO no outro nível ou não sincronizado) por último no desc. */
function budgetSortingFn(rowA: { original: RankingsItem }, rowB: { original: RankingsItem }): number {
  const a = getRowBudgetMinor(rowA.original) ?? -1;
  const b = getRowBudgetMinor(rowB.original) ?? -1;
  return a === b ? 0 : a < b ? -1 : 1;
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
  const { columnHelper, currentTab, onOpenDrill, groupByAdNameEffective, viewMode, selectionAnchorRef } = params;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cols: ColumnDef<RankingsItem, any>[] = [];

  // Coluna de seleção em lote — abas com id de entidade por linha: individual (ad_id),
  // por-conjunto (adset_id) e por-campanha (campaign_id). A mecânica de shift/âncora abaixo é
  // agnóstica à aba: usa row.id (definido por getRowId conforme a aba) e a ordem visível atual.
  if (currentTab === "individual" || currentTab === "por-conjunto" || currentTab === "por-campanha") {
    cols.push({
      id: "select",
      header: ({ table }) => {
        const allSelected = table.getIsAllPageRowsSelected();
        const someSelected = table.getIsSomePageRowsSelected();
        return (
          <Checkbox
            checked={allSelected ? true : someSelected ? "indeterminate" : false}
            onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)}
            aria-label="Selecionar todos"
            onClick={(e) => e.stopPropagation()}
          />
        );
      },
      cell: ({ row, table }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(v) => row.toggleSelected(!!v)}
          onMouseDown={(e) => {
            // Evita que shift+click destaque texto da página (seleção de texto do navegador).
            if (e.shiftKey) e.preventDefault();
          }}
          onClick={(e) => {
            e.stopPropagation();
            // Shift+click: aplica a TODAS as linhas do intervalo (na ordem visível atual, pós-filtro/sort)
            // o mesmo estado que este checkbox passaria a ter. Assim marca ou desmarca o intervalo inteiro.
            const anchorId = selectionAnchorRef.current;
            if (e.shiftKey && anchorId && anchorId !== row.id) {
              const visibleRows = table.getRowModel().rows;
              const anchorPos = visibleRows.findIndex((r) => r.id === anchorId);
              const clickedPos = visibleRows.findIndex((r) => r.id === row.id);
              if (anchorPos !== -1 && clickedPos !== -1) {
                // Suprime o toggle nativo do Radix (Root usa composeEventHandlers → checa defaultPrevented),
                // senão onCheckedChange re-alternaria a própria linha clicada.
                e.preventDefault();
                const [start, end] = anchorPos < clickedPos ? [anchorPos, clickedPos] : [clickedPos, anchorPos];
                const value = !row.getIsSelected();
                table.setRowSelection((prev) => {
                  const next = { ...prev };
                  for (let i = start; i <= end; i++) {
                    const r = visibleRows[i];
                    if (!r.getCanSelect()) continue;
                    if (value) next[r.id] = true;
                    else delete next[r.id];
                  }
                  return next;
                });
                return;
              }
            }
            // Clique normal (ou shift sem âncora válida): ancora nesta linha; o toggle ocorre via onCheckedChange.
            selectionAnchorRef.current = row.id;
          }}
          aria-label="Selecionar linha"
          disabled={!row.getCanSelect()}
        />
      ),
      enableSorting: false,
      enableColumnFilters: false,
      enableResizing: false,
      size: 44,
      minSize: 44,
    } as ColumnDef<RankingsItem, any>);
  }

  // Status column (visível exceto na aba "por-anuncio")
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
        return <AdNameCell original={original} value={name} groupByAdNameEffective={groupByAdNameEffective} currentTab={currentTab} minimal={viewMode === "minimal"} onOpenDrill={onOpenDrill} />;
      },
    }),
  );

  // Orçamento — só nas abas cuja linha é uma entidade que pode ter budget próprio
  if (currentTab === "por-conjunto" || currentTab === "por-campanha") {
    const budgetTab = currentTab;
    cols.push(
      columnHelper.accessor("budget_daily", {
        id: "budget",
        header: ({ column }) => (
          <div className="flex items-center justify-center gap-1 w-full">
            <SortIcon column={column} />
            <span>Orçamento</span>
          </div>
        ),
        size: 130,
        minSize: 110,
        enableResizing: true,
        enableSorting: true,
        enableColumnFilter: false,
        sortingFn: budgetSortingFn,
        cell: (info) => <BudgetCell original={info.row.original as RankingsItem} currentTab={budgetTab} />,
      }),
    );
  }

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

  // Coluna oculta: quantidade de anúncios ativos no grupo (por-anúncio/por-conjunto/por-campanha).
  // Fallback ad_count espelha o mesmo critério do AdNameCell (active_count ausente = assume todos ativos).
  cols.push(
    columnHelper.accessor("active_count", {
      id: "active_count_filter",
      header: () => null,
      enableSorting: false,
      enableResizing: false,
      size: 0,
      minSize: 0,
      maxSize: 0,
      filterFn: (row, _columnId, filterValue: FilterValue | FilterValue[] | undefined) => {
        const original = row.original as RankingsItem;
        const activeCount = original.active_count ?? original.ad_count ?? 0;
        return numericFilterFnMaybeArray(activeCount, filterValue, params.applyNumericFilter);
      },
      cell: () => null,
    }),
  );

  cols.push(...buildMetricColumns(params));

  return cols;
}
