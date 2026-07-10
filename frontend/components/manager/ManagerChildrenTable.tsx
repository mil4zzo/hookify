"use client";

import { useMemo, useState } from "react";
import { IconArrowsSort } from "@tabler/icons-react";
import type { ColumnFiltersState } from "@tanstack/react-table";
import type { RankingsChildrenItem } from "@/lib/api/schemas";
import type { ManagerColumnType } from "@/components/common/ManagerColumnFilter";
import { StatePanel } from "@/components/common/States";
import { SearchInputWithClear } from "@/components/common/SearchInputWithClear";
import { ThumbnailImage } from "@/components/common/ThumbnailImage";
import { FilterBar } from "@/components/manager/FilterBar";
import { StatusCell } from "@/components/manager/StatusCell";
import { getManagerFilterableColumns, getVisibleManagerColumns } from "@/components/manager/managerColumnPreferences";
import { getAdThumbnail } from "@/lib/utils/thumbnailFallback";
import { applyRowFilters } from "@/lib/utils/applyRowFilters";
import { buildManagerComputedRow, compareManagerChildRows, formatManagerChildMetricValue, getManagerChildSortInitialDirection, type ManagerChildSortColumn } from "@/lib/metrics";

/** Tipo de filho renderizado: anúncios de um adset, variações de um ad name, ou adsets de uma campanha. */
export type ChildrenEntity = "ads" | "variations" | "adsets";

type EntityConfig = {
  plural: string;
  nameHeader: string;
  nameSortKey: string;
  statusTab: "individual" | "por-conjunto";
  /** Campos usados pela busca textual */
  searchFields: (child: any) => string[];
  /** Mostra thumbnail + subtítulo de campanha na coluna de nome */
  richNameCell: boolean;
  /** Injeta ad_count: 1 nas linhas (não para adsets, que têm ad_count real) */
  addAdCount: boolean;
  textColumns: { id: string; label: string; isText: true }[];
  rowKey: (child: any) => string;
  nameTitle: (child: any) => string;
  colspanExtra: number;
  emptyForSearch: (term: string) => string;
  emptyForSearchAndFilters: (term: string) => string;
  emptyForFilters: string;
};

const ENTITY_CONFIG: Record<ChildrenEntity, EntityConfig> = {
  ads: {
    plural: "anúncios",
    nameHeader: "Anúncios",
    nameSortKey: "ad_id",
    statusTab: "individual",
    searchFields: (child) => [String(child.ad_name || ""), String(child.ad_id || "")],
    richNameCell: true,
    addAdCount: true,
    textColumns: [
      { id: "ad_name", label: "Anúncio", isText: true },
      { id: "campaign_name_filter", label: "Campanha", isText: true },
    ],
    rowKey: (child) => String(child.ad_id),
    nameTitle: (child) => child.ad_name || "Sem nome",
    colspanExtra: 2,
    emptyForSearch: (term) => `Nenhum anúncio encontrado para "${term}".`,
    emptyForSearchAndFilters: (term) => `Nenhum anúncio encontrado para "${term}" com os filtros aplicados.`,
    emptyForFilters: "Nenhum anúncio corresponde aos filtros aplicados.",
  },
  variations: {
    plural: "variações",
    nameHeader: "Variações",
    nameSortKey: "ad_id",
    statusTab: "individual",
    searchFields: (child) => [String(child.ad_name || ""), String(child.ad_id || "")],
    richNameCell: true,
    addAdCount: true,
    textColumns: [
      { id: "adset_name_filter", label: "Conjunto", isText: true },
      { id: "campaign_name_filter", label: "Campanha", isText: true },
    ],
    rowKey: (child) => String(child.ad_id),
    nameTitle: (child) => child.adset_name || "Sem nome",
    colspanExtra: 1,
    emptyForSearch: (term) => `Nenhuma variação encontrada para "${term}".`,
    emptyForSearchAndFilters: (term) => `Nenhuma variação encontrada para "${term}" com os filtros aplicados.`,
    emptyForFilters: "Nenhuma variação corresponde aos filtros aplicados.",
  },
  adsets: {
    plural: "conjuntos",
    nameHeader: "Conjuntos",
    nameSortKey: "adset_name",
    statusTab: "por-conjunto",
    searchFields: (child) => [String(child.adset_name || ""), String(child.adset_id || "")],
    richNameCell: false,
    addAdCount: false,
    textColumns: [{ id: "adset_name_filter", label: "Conjunto", isText: true }],
    rowKey: (child) => String(child.adset_id || "") || String(child.adset_name || "") || String(child.ad_name || ""),
    nameTitle: (child) => child.adset_name || child.ad_name || "Sem nome",
    colspanExtra: 2,
    emptyForSearch: (term) => `Nenhum conjunto encontrado para "${term}".`,
    emptyForSearchAndFilters: (term) => `Nenhum conjunto encontrado para "${term}" com os filtros aplicados.`,
    emptyForFilters: "Nenhum conjunto corresponde aos filtros aplicados.",
  },
};

interface ManagerChildrenTableProps {
  childrenData?: RankingsChildrenItem[];
  isLoading?: boolean;
  isError?: boolean;
  adsetId?: string;
  /** Default: "ads" quando adsetId presente, senão "variations". "adsets" = filhos de campanha. */
  entity?: ChildrenEntity;
  actionType?: string;
  formatCurrency: (n: number) => string;
  formatPct: (v: number) => string;
  activeColumns: Set<ManagerColumnType>;
  hasSheetIntegration?: boolean;
  mqlLeadscoreMin?: number;
  columnFilters?: ColumnFiltersState;
  setColumnFilters?: React.Dispatch<React.SetStateAction<ColumnFiltersState>>;
  asContent?: boolean;
  /** Quando definido, cada linha vira clicável e dispara este callback. */
  onRowClick?: (child: RankingsChildrenItem) => void;
}

export function ManagerChildrenTable({
  childrenData,
  isLoading = false,
  isError = false,
  adsetId,
  entity,
  actionType,
  formatCurrency,
  formatPct,
  activeColumns,
  hasSheetIntegration = false,
  mqlLeadscoreMin = 0,
  columnFilters = [],
  setColumnFilters,
  asContent = false,
  onRowClick,
}: ManagerChildrenTableProps) {
  const resolvedEntity: ChildrenEntity = entity ?? (adsetId ? "ads" : "variations");
  const config = ENTITY_CONFIG[resolvedEntity];
  const [sortConfig, setSortConfig] = useState<{ column: string | null; direction: "asc" | "desc" }>({
    column: "spend",
    direction: "desc",
  });
  const [searchTerm, setSearchTerm] = useState("");

  const visibleColumns = useMemo(() => getVisibleManagerColumns({ activeColumns, hasSheetIntegration }), [activeColumns, hasSheetIntegration]);
  const childrenLabel = config.plural;

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
        // adsets têm ad_count real vindo do backend — não sobrescrever
        ad_count: config.addAdCount ? 1 : Number((child as any).ad_count ?? 0),
      };
    });

    let filteredData = searchTerm.trim()
      ? dataWithCalculations.filter((child) => {
          const search = searchTerm.toLowerCase();
          return config.searchFields(child).some((field) => field.toLowerCase().includes(search));
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
      textColumns: config.textColumns,
    });
  }, [config, visibleColumns]);

  const colspan = visibleColumns.length + config.colspanExtra;

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
    <StatePanel kind="loading" message={`Carregando ${childrenLabel}...`} framed={false} density="compact" align="left" />
  );

  const errorContent = (
    <StatePanel kind="error" message={`Erro ao carregar ${childrenLabel}.`} framed={false} density="compact" align="left" />
  );

  const emptyContent = (
    <StatePanel kind="empty" message={`Sem ${childrenLabel} no período.`} framed={false} density="compact" align="left" />
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
    <div className={asContent ? "flex h-full min-h-0 flex-1 flex-col overflow-hidden" : undefined}>
      <div className="flex-shrink-0 px-4 py-3" role="region" aria-label="Busca e filtros da tabela expandida">
        <div className="flex flex-nowrap items-center gap-3">
          <SearchInputWithClear
            value={searchTerm}
            onChange={setSearchTerm}
            placeholder="Buscar por nome ou ID..."
            wrapperClassName="flex-shrink-0 w-72 max-w-[min(18rem,100%)]"
            size="sm"
            inputClassName="w-full text-xs"
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
        <div className="p-4">
          <StatePanel
            kind="empty"
            message={
              searchTerm.trim()
                ? columnFilters.length > 0
                  ? config.emptyForSearchAndFilters(searchTerm)
                  : config.emptyForSearch(searchTerm)
                : config.emptyForFilters
            }
            framed={false}
            density="compact"
          />
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
        <div className={asContent ? "min-h-0 flex-1 overflow-auto" : "overflow-x-auto"}>
          <table className="w-full border-collapse text-xs">
            <thead className={asContent ? "sticky top-0 z-sticky" : undefined}>
              <tr className="bg-card">
                <th className={`w-20 cursor-pointer select-none p-4 text-center hover:text-brand ${sortConfig.column === "status" ? "text-primary" : ""}`} onClick={() => handleSort("status")}>
                  <div className="flex items-center justify-center gap-1">
                    Status
                    <IconArrowsSort className="h-3 w-3" />
                  </div>
                </th>
                <th className={`cursor-pointer select-none p-4 text-left hover:text-brand ${sortConfig.column === config.nameSortKey ? "text-primary" : ""}`} onClick={() => handleSort(config.nameSortKey)}>
                  <div className="flex items-center gap-1">
                    {config.nameHeader}
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
                <tr
                  key={config.rowKey(child)}
                  className={`bg-background border-b border-border hover:bg-muted ${onRowClick ? "cursor-pointer" : ""}`}
                  onClick={onRowClick ? () => onRowClick(child as RankingsChildrenItem) : undefined}
                >
                  <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                    <StatusCell original={child} currentTab={config.statusTab} />
                  </td>
                  <td className="px-4 py-3 text-left">
                    {config.richNameCell ? (
                      <div className="flex items-center gap-2">
                        <ThumbnailImage src={getAdThumbnail(child)} alt="thumb" size="sm" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-medium">{config.nameTitle(child)}</div>
                          <div className="flex items-center gap-2 truncate">
                            <span className="truncate text-xs text-muted-foreground">{child.campaign_name}</span>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium">{config.nameTitle(child)}</div>
                      </div>
                    )}
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
