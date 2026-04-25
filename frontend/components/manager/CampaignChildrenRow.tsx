"use client";

import React, { useState, useMemo } from "react";
import { IconArrowsSort, IconLoader2 } from "@tabler/icons-react";
import type { ColumnFiltersState } from "@tanstack/react-table";
import { useCampaignChildren } from "@/lib/api/hooks";
import type { RankingsItem } from "@/lib/api/schemas";
import { StatusCell } from "@/components/manager/StatusCell";
import { SearchInputWithClear } from "@/components/common/SearchInputWithClear";
import { FilterBar } from "@/components/manager/FilterBar";
import type { ManagerColumnType } from "@/components/common/ManagerColumnFilter";
import { applyRowFilters } from "@/lib/utils/applyRowFilters";
import { buildManagerComputedRow, compareManagerChildRows, formatManagerChildMetricValue, getManagerChildSortInitialDirection, type ManagerChildSortColumn } from "@/lib/metrics";
import { getManagerFilterableColumns, getVisibleManagerColumns } from "@/components/manager/managerColumnPreferences";

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
}

function areCampaignChildrenRowPropsEqual(prev: CampaignChildrenRowProps, next: CampaignChildrenRowProps): boolean {
  const activeColumnsEqual = prev.activeColumns.size === next.activeColumns.size && Array.from(prev.activeColumns).every((col) => next.activeColumns.has(col));

  const columnFiltersEqual = (prev.columnFilters?.length ?? 0) === (next.columnFilters?.length ?? 0) && JSON.stringify(prev.columnFilters ?? []) === JSON.stringify(next.columnFilters ?? []);

  const prevPackIdsKey = [...(prev.packIds || [])].sort().join("|");
  const nextPackIdsKey = [...(next.packIds || [])].sort().join("|");

  return prev.asContent === next.asContent && prev.campaignId === next.campaignId && prev.dateStart === next.dateStart && prev.dateStop === next.dateStop && prev.actionType === next.actionType && prev.formatCurrency === next.formatCurrency && prev.formatPct === next.formatPct && activeColumnsEqual && prev.hasSheetIntegration === next.hasSheetIntegration && prev.mqlLeadscoreMin === next.mqlLeadscoreMin && columnFiltersEqual && prevPackIdsKey === nextPackIdsKey && prev.setColumnFilters === next.setColumnFilters;
}

export const CampaignChildrenRow = React.memo(function CampaignChildrenRow({ campaignId, dateStart, dateStop, packIds = [], actionType, formatCurrency, formatPct, activeColumns, hasSheetIntegration = false, mqlLeadscoreMin = 0, columnFilters = [], setColumnFilters, asContent = false }: CampaignChildrenRowProps) {
  const { data: childrenData, isLoading, isError } = useCampaignChildren(campaignId, dateStart, dateStop, actionType, packIds, true);

  const [sortConfig, setSortConfig] = useState<{
    column: string | null;
    direction: "asc" | "desc";
  }>({ column: "spend", direction: "desc" });

  const [searchTerm, setSearchTerm] = useState<string>("");

  const visibleColumns = useMemo(() => getVisibleManagerColumns({ activeColumns, hasSheetIntegration }), [activeColumns, hasSheetIntegration]);

  const filterableColumns = useMemo(() => {
    return getManagerFilterableColumns({
      visibleColumns,
      includeStatus: true,
      textColumns: [{ id: "adset_name_filter", label: "Conjunto", isText: true }],
    });
  }, [visibleColumns]);

  const sortedData = useMemo(() => {
    if (!childrenData || childrenData.length === 0) return [];

    const dataWithCalculations = (childrenData as RankingsItem[]).map((child) => {
      let conversions: Record<string, number> = (child as any).conversions || {};

      return buildManagerComputedRow(
        {
          ...child,
          conversions,
        },
        {
          actionType,
          mqlLeadscoreMin,
        },
      );
    });

    let filteredData = searchTerm.trim()
      ? dataWithCalculations.filter((child) => {
          const search = searchTerm.toLowerCase();
          const adsetName = String((child as any).adset_name || "").toLowerCase();
          const adsetId = String((child as any).adset_id || "").toLowerCase();
          return adsetName.includes(search) || adsetId.includes(search);
        })
      : dataWithCalculations;

    // Filtrar por columnFilters (Status, nome, métricas)
    if (columnFilters.length > 0) {
      filteredData = filteredData.filter((row) => applyRowFilters(row as Record<string, unknown>, columnFilters));
    }

    if (!sortConfig.column) return filteredData;

    const sorted = [...filteredData].sort((a, b) => {
      return compareManagerChildRows(a, b, sortConfig.column as ManagerChildSortColumn, sortConfig.direction);
    });

    return sorted;
  }, [childrenData, sortConfig, actionType, searchTerm, hasSheetIntegration, mqlLeadscoreMin, columnFilters]);

  const handleSort = (column: string) => {
    setSortConfig((prev) => {
      if (prev.column === column) {
        return { column, direction: prev.direction === "asc" ? "desc" : "asc" };
      }
      return { column, direction: getManagerChildSortInitialDirection(column) };
    });
  };

  const renderCellValue = (child: any, columnId: ManagerColumnType) => {
    return formatManagerChildMetricValue(columnId, child, { currencyFormatter: formatCurrency });
  };

  // Status + nome (Conjunto) + métricas visíveis
  const colspan = visibleColumns.length + 2;

  const childMetricsColumnClass = `px-4 py-3 text-center cursor-pointer select-none hover:text-brand`;

  const loadingContent = (
    <div className="p-2 pl-8">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <IconLoader2 className="h-4 w-4 shrink-0 animate-spin" />
        <span>Carregando conjuntos...</span>
      </div>
    </div>
  );

  const errorContent = (
    <div className="p-2 pl-8">
      <div className="text-sm text-destructive">Erro ao carregar conjuntos.</div>
    </div>
  );

  const emptyContent = (
    <div className="p-2 pl-8">
      <div className="text-sm text-muted-foreground">Sem conjuntos no período.</div>
    </div>
  );

  if (isLoading) {
    return asContent ? (
      loadingContent
    ) : (
      <tr className="bg-border">
        <td className="p-0" colSpan={colspan}>
          {loadingContent}
        </td>
      </tr>
    );
  }

  if (isError) {
    return asContent ? (
      errorContent
    ) : (
      <tr className="bg-border">
        <td className="p-0" colSpan={colspan}>
          {errorContent}
        </td>
      </tr>
    );
  }

  if (!childrenData || childrenData.length === 0) {
    return asContent ? (
      emptyContent
    ) : (
      <tr className="bg-border">
        <td className="p-0" colSpan={colspan}>
          {emptyContent}
        </td>
      </tr>
    );
  }

  const innerContent = (
    <div>
      {/* Busca e filtros - flex horizontal: search à esquerda, filterbar à direita */}
      <div className="px-4 py-3 bg-muted-50" role="region" aria-label="Busca e filtros da tabela expandida">
        <div className="flex items-center gap-3 flex-nowrap">
          <SearchInputWithClear
            value={searchTerm}
            onChange={setSearchTerm}
            placeholder="Buscar por nome ou ID..."
            wrapperClassName="flex-shrink-0 w-72 max-w-[min(18rem,100%)]"
            inputClassName="h-9 text-xs w-full"
          />
          {(searchTerm.trim() || columnFilters.length > 0) && (
            <span className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0">
              {sortedData.length} de {childrenData?.length || 0} conjuntos
            </span>
          )}
          {setColumnFilters && (
            <div className="flex-1 min-w-0">
              <FilterBar columnFilters={columnFilters} setColumnFilters={setColumnFilters} filterableColumns={filterableColumns} />
            </div>
          )}
        </div>
      </div>

      {sortedData.length === 0 && (searchTerm.trim() || columnFilters.length > 0) ? (
        <div className="p-8 text-center">
          <p className="text-sm text-muted-foreground">{searchTerm.trim() ? (columnFilters.length > 0 ? `Nenhum conjunto encontrado para "${searchTerm}" com os filtros aplicados.` : `Nenhum conjunto encontrado para "${searchTerm}"`) : "Nenhum conjunto corresponde aos filtros aplicados."}</p>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
            {searchTerm.trim() && (
              <button onClick={() => setSearchTerm("")} className="text-xs text-primary hover:underline">
                Limpar busca
              </button>
            )}
            {searchTerm.trim() && columnFilters.length > 0 && <span className="text-muted-foreground">·</span>}
            {columnFilters.length > 0 && setColumnFilters && (
              <button onClick={() => setColumnFilters([])} className="text-xs text-primary hover:underline">
                Limpar filtros
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-border">
                <th className={`p-4 text-center w-20 cursor-pointer select-none hover:text-brand ${sortConfig.column === "status" ? "text-primary" : ""}`} onClick={() => handleSort("status")}>
                  <div className="flex items-center justify-center gap-1">
                    Status
                    <IconArrowsSort className="w-3 h-3" />
                  </div>
                </th>
                <th className={`p-4 text-left cursor-pointer select-none hover:text-brand ${sortConfig.column === "adset_name" ? "text-primary" : ""}`} onClick={() => handleSort("adset_name")}>
                  <div className="flex items-center gap-1">
                    Conjuntos
                    <IconArrowsSort className="w-3 h-3" />
                  </div>
                </th>
                {visibleColumns.map((col) => (
                  <th key={col.id} className={`${childMetricsColumnClass} ${sortConfig.column === col.id ? "text-primary" : ""}`} onClick={() => handleSort(col.id)}>
                    <div className="flex items-center justify-center gap-1">
                      {col.name}
                      <IconArrowsSort className="w-3 h-3" />
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedData.map((child) => {
                const key = String((child as any).adset_id || "") || String((child as any).adset_name || "") || String((child as any).ad_name || "");
                return (
                  <tr key={key} className="hover:bg-muted border-b border-border">
                    <td className="px-4 py-3 text-center">
                      <StatusCell original={child as any} currentTab="por-conjunto" />
                    </td>
                    <td className="px-4 py-3 text-left">
                      <div className="flex-1 min-w-0">
                        <div className="truncate text-xs font-medium">{String((child as any).adset_name || (child as any).ad_name || "Sem nome")}</div>
                      </div>
                    </td>
                    {visibleColumns.map((col) => (
                      <td key={col.id} className="p-2 text-center">
                        {renderCellValue(child, col.id)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  return asContent ? (
    innerContent
  ) : (
    <tr className="bg-card">
      <td className="p-0" colSpan={colspan}>
        {innerContent}
      </td>
    </tr>
  );
}, areCampaignChildrenRowPropsEqual);
