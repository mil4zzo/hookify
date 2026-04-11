"use client";

import { useMemo, useState } from "react";
import { IconArrowsSort, IconLoader2 } from "@tabler/icons-react";
import type { ColumnFiltersState } from "@tanstack/react-table";
import type { RankingsChildrenItem } from "@/lib/api/schemas";
import type { ManagerColumnType } from "@/components/common/ManagerColumnFilter";
import { SearchInputWithClear } from "@/components/common/SearchInputWithClear";
import { ThumbnailImage } from "@/components/common/ThumbnailImage";
import { FilterBar } from "@/components/manager/FilterBar";
import { StatusCell } from "@/components/manager/StatusCell";
import { getManagerFilterableColumns, getVisibleManagerColumns } from "@/components/manager/managerColumnPreferences";
import { getAdThumbnail } from "@/lib/utils/thumbnailFallback";
import { applyRowFilters } from "@/lib/utils/applyRowFilters";
import { buildManagerComputedRow, compareManagerChildRows, formatManagerChildMetricValue, getManagerChildSortInitialDirection, type ManagerChildSortColumn } from "@/lib/metrics";

interface ManagerChildrenTableProps {
  childrenData?: RankingsChildrenItem[];
  isLoading?: boolean;
  isError?: boolean;
  adsetId?: string;
  actionType?: string;
  formatCurrency: (n: number) => string;
  formatPct: (v: number) => string;
  activeColumns: Set<ManagerColumnType>;
  hasSheetIntegration?: boolean;
  mqlLeadscoreMin?: number;
  columnFilters?: ColumnFiltersState;
  setColumnFilters?: React.Dispatch<React.SetStateAction<ColumnFiltersState>>;
  asContent?: boolean;
}

export function ManagerChildrenTable({
  childrenData,
  isLoading = false,
  isError = false,
  adsetId,
  actionType,
  formatCurrency,
  formatPct,
  activeColumns,
  hasSheetIntegration = false,
  mqlLeadscoreMin = 0,
  columnFilters = [],
  setColumnFilters,
  asContent = false,
}: ManagerChildrenTableProps) {
  const [sortConfig, setSortConfig] = useState<{ column: string | null; direction: "asc" | "desc" }>({
    column: "spend",
    direction: "desc",
  });
  const [searchTerm, setSearchTerm] = useState("");

  const visibleColumns = useMemo(() => getVisibleManagerColumns({ activeColumns, hasSheetIntegration }), [activeColumns, hasSheetIntegration]);
  const childrenLabel = adsetId ? "anúncios" : "variações";
  const singularLabel = adsetId ? "anúncio" : "variação";

  const sortedData = useMemo(() => {
    if (!childrenData || childrenData.length === 0) {
      return [];
    }

    const dataWithCalculations = childrenData.map((child) => {
      let conversions = child.conversions || {};

      if (Object.keys(conversions).length === 0 && child.series?.conversions) {
        conversions = {};

        for (const dayConversions of child.series.conversions) {
          if (dayConversions && typeof dayConversions === "object") {
            for (const [conversionActionType, value] of Object.entries(dayConversions)) {
              if (!conversions[conversionActionType]) {
                conversions[conversionActionType] = 0;
              }
              conversions[conversionActionType] += Number(value || 0);
            }
          }
        }
      }
      return {
        ...buildManagerComputedRow(
          {
            ...child,
            conversions,
          },
          {
            actionType,
            mqlLeadscoreMin,
          },
        ),
        conversions,
        ad_count: 1,
      };
    });

    let filteredData = searchTerm.trim()
      ? dataWithCalculations.filter((child) => {
          const search = searchTerm.toLowerCase();
          const childAdName = String(child.ad_name || "").toLowerCase();
          const childAdId = String(child.ad_id || "").toLowerCase();
          return childAdName.includes(search) || childAdId.includes(search);
        })
      : dataWithCalculations;

    if (columnFilters.length > 0) {
      filteredData = filteredData.filter((row) => applyRowFilters(row as Record<string, unknown>, columnFilters));
    }

    if (!sortConfig.column) {
      return filteredData;
    }

    return [...filteredData].sort((a, b) => {
      return compareManagerChildRows(a, b, sortConfig.column as ManagerChildSortColumn, sortConfig.direction);
    });
  }, [actionType, childrenData, columnFilters, hasSheetIntegration, mqlLeadscoreMin, searchTerm, sortConfig]);

  const filterableColumns = useMemo(() => {
    return getManagerFilterableColumns({
      visibleColumns,
      includeStatus: true,
      textColumns: adsetId
        ? [
            { id: "ad_name", label: "Anúncio", isText: true },
            { id: "campaign_name_filter", label: "Campanha", isText: true },
          ]
        : [
            { id: "adset_name_filter", label: "Conjunto", isText: true },
            { id: "campaign_name_filter", label: "Campanha", isText: true },
          ],
    });
  }, [adsetId, visibleColumns]);

  const colspan = visibleColumns.length + (adsetId ? 2 : 1);

  const handleSort = (column: string) => {
    setSortConfig((previous) => {
      if (previous.column === column) {
        return { column, direction: previous.direction === "asc" ? "desc" : "asc" };
      }

      return { column, direction: getManagerChildSortInitialDirection(column) };
    });
  };

  const renderCellValue = (child: any, columnId: ManagerColumnType) => {
    return formatManagerChildMetricValue(columnId, child, { currencyFormatter: formatCurrency });
  };

  const metricColumnClass = "cursor-pointer select-none px-4 py-3 text-center hover:text-brand";

  const loadingContent = (
    <div className="p-2 pl-8">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <IconLoader2 className="h-4 w-4 shrink-0 animate-spin" />
        <span>{`Carregando ${childrenLabel}...`}</span>
      </div>
    </div>
  );

  const errorContent = (
    <div className="p-2 pl-8">
      <div className="text-sm text-destructive">{`Erro ao carregar ${childrenLabel}.`}</div>
    </div>
  );

  const emptyContent = (
    <div className="p-2 pl-8">
      <div className="text-sm text-muted-foreground">{`Sem ${childrenLabel} no período.`}</div>
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
      <div className="bg-muted/50 px-4 py-3" role="region" aria-label="Busca e filtros da tabela expandida">
        <div className="flex flex-nowrap items-center gap-3">
          <SearchInputWithClear
            value={searchTerm}
            onChange={setSearchTerm}
            placeholder="Buscar por nome ou ID..."
            wrapperClassName="flex-shrink-0 w-72 max-w-[min(18rem,100%)]"
            inputClassName="h-9 w-full text-xs"
          />
          {(searchTerm.trim() || columnFilters.length > 0) && (
            <span className="flex-shrink-0 whitespace-nowrap text-xs text-muted-foreground">
              {`${sortedData.length} de ${childrenData.length || 0} ${childrenLabel}`}
            </span>
          )}
          {setColumnFilters && (
            <div className="min-w-0 flex-1">
              <FilterBar columnFilters={columnFilters} setColumnFilters={setColumnFilters} filterableColumns={filterableColumns} />
            </div>
          )}
        </div>
      </div>

      {sortedData.length === 0 && (searchTerm.trim() || columnFilters.length > 0) ? (
        <div className="p-8 text-center">
          <p className="text-sm text-muted-foreground">
            {searchTerm.trim()
              ? columnFilters.length > 0
                ? `Nenhuma ${singularLabel} encontrada para "${searchTerm}" com os filtros aplicados.`
                : `Nenhuma ${singularLabel} encontrada para "${searchTerm}".`
              : `Nenhuma ${singularLabel} corresponde aos filtros aplicados.`}
          </p>
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
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="bg-border">
                <th className={`w-20 cursor-pointer select-none p-4 text-center hover:text-brand ${sortConfig.column === "status" ? "text-primary" : ""}`} onClick={() => handleSort("status")}>
                  <div className="flex items-center justify-center gap-1">
                    Status
                    <IconArrowsSort className="h-3 w-3" />
                  </div>
                </th>
                <th className={`cursor-pointer select-none p-4 text-left hover:text-brand ${sortConfig.column === "ad_id" ? "text-primary" : ""}`} onClick={() => handleSort("ad_id")}>
                  <div className="flex items-center gap-1">
                    {adsetId ? "Anúncios" : "Variações"}
                    <IconArrowsSort className="h-3 w-3" />
                  </div>
                </th>
                {visibleColumns.map((column) => (
                  <th key={column.id} className={`${metricColumnClass} ${sortConfig.column === column.id ? "text-primary" : ""}`} onClick={() => handleSort(column.id)}>
                    <div className="flex items-center justify-center gap-1">
                      {column.name}
                      <IconArrowsSort className="h-3 w-3" />
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedData.map((child) => (
                <tr key={child.ad_id} className="border-b border-border hover:bg-muted">
                  <td className="px-4 py-3 text-center">
                    <StatusCell original={child} currentTab="individual" />
                  </td>
                  <td className="px-4 py-3 text-left">
                    <div className="flex items-center gap-2">
                      <ThumbnailImage src={getAdThumbnail(child)} alt="thumb" size="sm" />
                      <div className="min-w-0 flex-1">
                        {adsetId ? (
                          <>
                            <div className="truncate text-xs font-medium">{child.ad_name || "Sem nome"}</div>
                            <div className="flex items-center gap-2 truncate">
                              <span className="truncate text-xs text-muted-foreground">{child.campaign_name}</span>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="truncate text-xs font-medium">{child.adset_name}</div>
                            <div className="flex items-center gap-2 truncate">
                              <span className="truncate text-xs text-muted-foreground">{child.campaign_name}</span>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </td>
                  {visibleColumns.map((column) => (
                    <td key={column.id} className="p-2 text-center">
                      {renderCellValue(child, column.id)}
                    </td>
                  ))}
                </tr>
              ))}
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
}
