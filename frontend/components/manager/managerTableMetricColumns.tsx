"use client";

import React from "react";
import type { ColumnDef, Column } from "@tanstack/react-table";
import { IconAlertTriangle, IconArrowNarrowDown, IconArrowNarrowUp, IconFilter } from "@tabler/icons-react";
import { ColumnFilter, type FilterValue } from "@/components/common/ColumnFilter";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { MetricCell } from "@/components/manager/MetricCell";
import type { RankingsItem } from "@/lib/api/schemas";
import type { CreateManagerTableColumnsParams } from "@/components/manager/managerTableColumns";
import type { ManagerColumnType } from "@/components/common/ManagerColumnFilter";
import { formatMetricValue, getManagerMetricLabel, getMetricNumericValue, getMetricNumericValueOrNull } from "@/lib/metrics";
import { isManagerMetricColumnVisible } from "@/components/manager/managerColumnPreferences";

export const SortIcon = ({
  column,
  invertDirection = false,
}: {
  column: Column<RankingsItem, unknown>;
  /** Quando true: asc mostra seta baixo, desc mostra seta cima (primeiro clique = seta baixo) */
  invertDirection?: boolean;
}) => {
  const sorted = column.getIsSorted();
  if (sorted === "asc") return invertDirection ? <IconArrowNarrowDown className="w-4 h-4" /> : <IconArrowNarrowUp className="w-4 h-4" />;
  if (sorted === "desc") return invertDirection ? <IconArrowNarrowUp className="w-4 h-4" /> : <IconArrowNarrowDown className="w-4 h-4" />;
  return null;
};

function applyNumericFilterMaybeArray(rowValue: number | null | undefined, filterValue: FilterValue | FilterValue[] | undefined, applyNumericFilter: (rowValue: number | null | undefined, filterValue: FilterValue | undefined) => boolean): boolean {
  if (!filterValue) return true;
  if (Array.isArray(filterValue)) {
    return filterValue.every((fv) => applyNumericFilter(rowValue, fv));
  }
  return applyNumericFilter(rowValue, filterValue);
}

export function buildMetricColumns(params: CreateManagerTableColumnsParams): ColumnDef<RankingsItem, unknown>[] {
  const { columnHelper, activeColumns, byKey, endDate, showTrends, averagesRef, formatAverageRef, filteredAveragesRef, formatFilteredAverageRef, formatCurrencyRef, formatPct, globalFilterRef, columnFiltersRef, viewMode, hasSheetIntegration, mqlLeadscoreMin, actionTypeRef, applyNumericFilter, getRowKey, openSettings } = params;

  const shouldShow = (id: ManagerColumnType) => isManagerMetricColumnVisible(id, { activeColumns, hasSheetIntegration });

  const isMinimal = viewMode === "minimal";

  const sumMetrics = new Set(["spend", "results", "mqls"]);

  const renderMetricHeader = (metricId: string, label: string, column: Column<RankingsItem, unknown>, filterValue: FilterValue | FilterValue[] | undefined) => {
    const hasActiveFilters = (globalFilterRef.current && globalFilterRef.current.trim() !== "") || (columnFiltersRef.current && columnFiltersRef.current.length > 0);
    const hasFilters = hasActiveFilters && !!filteredAveragesRef.current;
    const filteredAvg = formatFilteredAverageRef.current(metricId);
    const displayFilterValue: FilterValue | undefined = Array.isArray(filterValue) ? (filterValue.length > 0 ? filterValue[0] : undefined) : (filterValue ?? undefined);
    const textSize = isMinimal ? "text-[10px]" : "text-xs";
    const iconSize = isMinimal ? "w-2.5 h-2.5" : "w-3 h-3";
    const avgLeading = isMinimal ? "leading-none" : "";
    const isSum = sumMetrics.has(metricId);

    return (
      <div className={`flex flex-col items-center ${isMinimal ? "gap-1" : "gap-0.5"}`}>
        <div className={`flex items-center ${isMinimal ? "gap-0.5" : "gap-1"}`}>
          <SortIcon column={column} />
          <span className={isMinimal ? "text-xs" : ""}>{label}</span>
          <ColumnFilter value={displayFilterValue} readonly={true} />
        </div>
        {formatAverageRef.current(metricId) && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className={`${textSize} text-muted-foreground font-normal cursor-help ${avgLeading}`}>{formatAverageRef.current(metricId)}</span>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p className="text-xs">{isSum ? "Soma total do pack" : "Média dos anúncios validáveis do pack"}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        {hasFilters && filteredAvg && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className={`${textSize} text-primary font-semibold flex items-center gap-0.5 cursor-help ${avgLeading}`}>
                  <IconFilter className={iconSize} />
                  {filteredAvg}
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p className="text-xs">{isSum ? "Soma total dos filtrados" : "Média dos anúncios filtrados"}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
    );
  };

  const getMetricContext = () => ({
    actionType: actionTypeRef.current,
    mqlLeadscoreMin,
  });

  const getMetricValueOrNull = (row: RankingsItem, metricId: string) => getMetricNumericValueOrNull(row, metricId, getMetricContext());

  const getMetricValue = (row: RankingsItem, metricId: string) => getMetricNumericValue(row, metricId, getMetricContext());

  const formatMetricCellValue = (metricId: string, value: number | null | undefined) => {
    if (value == null || !Number.isFinite(value)) return "—";
    return formatMetricValue(metricId, value, { currencyFormatter: formatCurrencyRef.current });
  };

  const applyPercentageFilterMaybeArray = (rowValue: number | null | undefined, filterValue: FilterValue | FilterValue[] | undefined) => {
    const normalizeFilter = (singleFilter: FilterValue | undefined) => {
      if (!singleFilter) return true;
      const filterNum = singleFilter.value;
      if (filterNum !== null && filterNum !== undefined && !isNaN(filterNum)) {
        const normalizedFilter = filterNum > 1 ? filterNum / 100 : filterNum;
        return applyNumericFilter(rowValue, { ...singleFilter, value: normalizedFilter });
      }
      return true;
    };

    if (!filterValue) return true;
    if (Array.isArray(filterValue)) return filterValue.every(normalizeFilter);
    return normalizeFilter(filterValue);
  };

  const cols: ColumnDef<RankingsItem, unknown>[] = [];

  // Spend
  if (shouldShow("spend")) {
    cols.push(
      columnHelper.accessor("spend", {
        header: ({ column }) => {
          const filterValue = column.getFilterValue() as FilterValue | undefined;
          return renderMetricHeader("spend", getManagerMetricLabel("spend"), column, filterValue);
        },
        filterFn: (row, columnId, filterValue: FilterValue | FilterValue[] | undefined) => {
          const ad = row.original as RankingsItem;
          const spend = Number(ad.spend || 0);
          return applyNumericFilterMaybeArray(spend, filterValue, applyNumericFilter);
        },
        sortingFn: "auto",
        cell: (info) => <MetricCell row={info.row.original} value={<span className="text-center inline-block w-full">{formatCurrencyRef.current(Number(info.getValue()) || 0)}</span>} metric="spend" getRowKey={getRowKey} byKey={byKey} endDate={endDate} showTrends={showTrends} averages={averagesRef.current} formatCurrency={formatCurrencyRef.current} actionType={actionTypeRef.current} hasSheetIntegration={hasSheetIntegration} mqlLeadscoreMin={mqlLeadscoreMin} minimal={isMinimal} lightweight />,
      }) as any,
    );
  }

  // Results
  if (shouldShow("results")) {
    cols.push(
      columnHelper.accessor(
        (row) => getMetricValue(row as RankingsItem, "results"),
        {
          id: "results",
          header: ({ column }) => {
            const filterValue = column.getFilterValue() as FilterValue | undefined;
          return renderMetricHeader("results", getManagerMetricLabel("results"), column, filterValue);
          },
          filterFn: (row, columnId, filterValue: FilterValue | FilterValue[] | undefined) => {
            const ad = row.original as RankingsItem;
          return applyNumericFilterMaybeArray(getMetricValue(ad, "results"), filterValue, applyNumericFilter);
          },
          sortingFn: "auto",
          cell: (info) => {
            const results = Number(info.getValue() || 0);
            return <MetricCell row={info.row.original} value={<span className="text-center inline-block w-full">{formatMetricCellValue("results", results)}</span>} metric="results" getRowKey={getRowKey} byKey={byKey} endDate={endDate} showTrends={showTrends} averages={averagesRef.current} formatCurrency={formatCurrencyRef.current} actionType={actionTypeRef.current} hasSheetIntegration={hasSheetIntegration} mqlLeadscoreMin={mqlLeadscoreMin} minimal={isMinimal} lightweight />;
          },
        },
      ) as any,
    );
  }

  // MQLs
  if (shouldShow("mqls")) {
    cols.push(
      columnHelper.accessor(
        (row) => getMetricValue(row as RankingsItem, "mqls"),
        {
          id: "mqls",
          header: ({ column }) => {
            const filterValue = column.getFilterValue() as FilterValue | undefined;
          return renderMetricHeader("mqls", getManagerMetricLabel("mqls"), column, filterValue);
          },
          filterFn: (row, columnId, filterValue: FilterValue | FilterValue[] | undefined) => {
            const ad = row.original as RankingsItem;
          return applyNumericFilterMaybeArray(getMetricValue(ad, "mqls"), filterValue, applyNumericFilter);
          },
          sortingFn: "auto",
          cell: (info) => {
            const mqls = Number(info.getValue() || 0);
            return <MetricCell row={info.row.original} value={<span className="text-center inline-block w-full">{formatMetricCellValue("mqls", mqls)}</span>} metric="mqls" getRowKey={getRowKey} byKey={byKey} endDate={endDate} showTrends={showTrends} averages={averagesRef.current} formatCurrency={formatCurrencyRef.current} actionType={actionTypeRef.current} hasSheetIntegration={hasSheetIntegration} mqlLeadscoreMin={mqlLeadscoreMin} minimal={isMinimal} lightweight />;
          },
        },
      ) as any,
    );
  }

  // CPR
  if (shouldShow("cpr")) {
    cols.push(
      columnHelper.accessor(
        (row) => getMetricValueOrNull(row as RankingsItem, "cpr"),
        {
          id: "cpr",
          header: ({ column }) => {
            const filterValue = column.getFilterValue() as FilterValue | undefined;
            return renderMetricHeader("cpr", getManagerMetricLabel("cpr"), column, filterValue);
          },
          filterFn: (row, columnId, filterValue: FilterValue | FilterValue[] | undefined) => {
            return applyNumericFilterMaybeArray(getMetricValueOrNull(row.original as RankingsItem, "cpr"), filterValue, applyNumericFilter);
          },
          sortingFn: "auto",
          cell: (info) => {
            const ad = info.row.original as RankingsItem;
            const cpr = info.getValue() as number | null;
            const value = formatMetricCellValue("cpr", cpr);
            return <MetricCell row={ad} value={<span className="text-center inline-block w-full">{value}</span>} metric="cpr" getRowKey={getRowKey} byKey={byKey} endDate={endDate} showTrends={showTrends} averages={averagesRef.current} formatCurrency={formatCurrencyRef.current} actionType={actionTypeRef.current} hasSheetIntegration={hasSheetIntegration} mqlLeadscoreMin={mqlLeadscoreMin} minimal={isMinimal} lightweight />;
          },
        },
      ) as any,
    );
  }

  // CPC
  if (shouldShow("cpc")) {
    cols.push(
      columnHelper.accessor(
        (row) => getMetricValueOrNull(row as RankingsItem, "cpc"),
        {
          id: "cpc",
          header: ({ column }) => {
            const filterValue = column.getFilterValue() as FilterValue | undefined;
            return renderMetricHeader("cpc", getManagerMetricLabel("cpc"), column, filterValue);
          },
          filterFn: (row, columnId, filterValue: FilterValue | FilterValue[] | undefined) => {
            return applyNumericFilterMaybeArray(getMetricValueOrNull(row.original as RankingsItem, "cpc"), filterValue, applyNumericFilter);
          },
          sortingFn: "auto",
          cell: (info) => {
            const ad = info.row.original as RankingsItem;
            const cpc = info.getValue() as number | null;
            const value = formatMetricCellValue("cpc", cpc);
            return <MetricCell row={ad} value={<span className="text-center inline-block w-full">{value}</span>} metric="cpc" getRowKey={getRowKey} byKey={byKey} endDate={endDate} showTrends={showTrends} averages={averagesRef.current} formatCurrency={formatCurrencyRef.current} actionType={actionTypeRef.current} hasSheetIntegration={hasSheetIntegration} mqlLeadscoreMin={mqlLeadscoreMin} minimal={isMinimal} lightweight />;
          },
        },
      ) as any,
    );
  }

  // CPLC
  if (shouldShow("cplc")) {
    cols.push(
      columnHelper.accessor(
        (row) => getMetricValueOrNull(row as RankingsItem, "cplc"),
        {
          id: "cplc",
          header: ({ column }) => {
            const filterValue = column.getFilterValue() as FilterValue | undefined;
            return renderMetricHeader("cplc", getManagerMetricLabel("cplc"), column, filterValue);
          },
          filterFn: (row, columnId, filterValue: FilterValue | FilterValue[] | undefined) => {
            return applyNumericFilterMaybeArray(getMetricValueOrNull(row.original as RankingsItem, "cplc"), filterValue, applyNumericFilter);
          },
          sortingFn: "auto",
          cell: (info) => {
            const ad = info.row.original as RankingsItem;
            const cplc = info.getValue() as number | null;
            const value = formatMetricCellValue("cplc", cplc);
            return <MetricCell row={ad} value={<span className="text-center inline-block w-full">{value}</span>} metric="cplc" getRowKey={getRowKey} byKey={byKey} endDate={endDate} showTrends={showTrends} averages={averagesRef.current} formatCurrency={formatCurrencyRef.current} actionType={actionTypeRef.current} hasSheetIntegration={hasSheetIntegration} mqlLeadscoreMin={mqlLeadscoreMin} minimal={isMinimal} lightweight />;
          },
        },
      ) as any,
    );
  }

  // CPMQL
  if (shouldShow("cpmql")) {
    cols.push(
      columnHelper.accessor(
        (row) => getMetricValueOrNull(row as RankingsItem, "cpmql"),
        {
          id: "cpmql",
          header: ({ column }) => {
            const filterValue = column.getFilterValue() as FilterValue | FilterValue[] | undefined;
            const displayFilterValue: FilterValue | undefined = Array.isArray(filterValue) ? (filterValue.length > 0 ? filterValue[0] : undefined) : (filterValue ?? undefined);
            const hasActiveFilters = (globalFilterRef.current && globalFilterRef.current.trim() !== "") || (columnFiltersRef.current && columnFiltersRef.current.length > 0);
            const hasFilters = hasActiveFilters && !!filteredAveragesRef.current;
            const textSize = isMinimal ? "text-[10px]" : "text-xs";
            const iconSize = isMinimal ? "w-2.5 h-2.5" : "w-3 h-3";
            const avgLeading = isMinimal ? "leading-none" : "";
            return (
              <div className={`flex flex-col items-center ${isMinimal ? "gap-1" : "gap-0.5"}`}>
                <div className={`flex items-center ${isMinimal ? "gap-0.5" : "gap-1.5"}`}>
                  {mqlLeadscoreMin === 0 && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              openSettings("leadscore");
                            }}
                            className="text-warning hover:text-warning/80 transition-colors"
                          >
                            <IconAlertTriangle className={isMinimal ? "h-3 w-3" : "h-4 w-4"} />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>
                            Configure seu leadscore mínimo{" "}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                openSettings("leadscore");
                              }}
                              className="underline font-medium hover:text-primary"
                            >
                              clicando aqui
                            </button>
                            .
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                  <SortIcon column={column} />
                  <span className={isMinimal ? "text-xs" : ""}>{getManagerMetricLabel("cpmql")}</span>
                  <ColumnFilter value={displayFilterValue} readonly={true} />
                </div>
                {formatAverageRef.current("cpmql") && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className={`${textSize} text-muted-foreground font-normal cursor-help ${avgLeading}`}>{formatAverageRef.current("cpmql")}</span>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">
                        <p className="text-xs">Média dos anúncios validáveis do pack</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
                {hasFilters && formatFilteredAverageRef.current("cpmql") && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className={`${textSize} text-primary font-semibold flex items-center gap-0.5 cursor-help ${avgLeading}`}>
                          <IconFilter className={iconSize} />
                          {formatFilteredAverageRef.current("cpmql")}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">
                        <p className="text-xs">Média dos anúncios filtrados</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </div>
            );
          },
          filterFn: (row, columnId, filterValue: FilterValue | FilterValue[] | undefined) => {
            return applyNumericFilterMaybeArray(getMetricValueOrNull(row.original as RankingsItem, "cpmql"), filterValue, applyNumericFilter);
          },
          sortingFn: "auto",
          cell: (info) => {
            const ad = info.row.original as RankingsItem;
            const cpmql = info.getValue() as number | null;
            const value = formatMetricCellValue("cpmql", cpmql);
            return <MetricCell row={ad} value={<span className="text-center inline-block w-full">{value}</span>} metric="cpmql" getRowKey={getRowKey} byKey={byKey} endDate={endDate} showTrends={showTrends} averages={averagesRef.current} formatCurrency={formatCurrencyRef.current} actionType={actionTypeRef.current} hasSheetIntegration={hasSheetIntegration} mqlLeadscoreMin={mqlLeadscoreMin} minimal={isMinimal} lightweight />;
          },
        },
      ) as any,
    );
  }

  // CPM
  if (shouldShow("cpm")) {
    cols.push(
      columnHelper.accessor(
        (row) => {
          const ad = row as RankingsItem;
          const cpm = typeof ad.cpm === "number" ? ad.cpm : 0;
          return Number.isFinite(cpm) ? cpm : 0;
        },
        {
          id: "cpm",
          header: ({ column }) => {
            const filterValue = column.getFilterValue() as FilterValue | undefined;
          return renderMetricHeader("cpm", getManagerMetricLabel("cpm"), column, filterValue);
          },
          filterFn: (row, columnId, filterValue: FilterValue | FilterValue[] | undefined) => {
            const ad = row.original as RankingsItem;
            const cpm = typeof ad.cpm === "number" ? ad.cpm : null;
            return applyNumericFilterMaybeArray(cpm, filterValue, applyNumericFilter);
          },
          sortingFn: "auto",
          cell: (info) => {
            const ad = info.row.original as RankingsItem;
            const cpm = Number(info.getValue() || 0);
            return <MetricCell row={ad} value={<span className="text-center inline-block w-full">{formatCurrencyRef.current(cpm)}</span>} metric="cpm" getRowKey={getRowKey} byKey={byKey} endDate={endDate} showTrends={showTrends} averages={averagesRef.current} formatCurrency={formatCurrencyRef.current} actionType={actionTypeRef.current} hasSheetIntegration={hasSheetIntegration} mqlLeadscoreMin={mqlLeadscoreMin} minimal={isMinimal} lightweight />;
          },
        },
      ) as any,
    );
  }

  // Hook
  if (shouldShow("hook")) {
    cols.push(
      columnHelper.accessor("hook", {
        header: ({ column }) => {
          const filterValue = column.getFilterValue() as FilterValue | undefined;
          return renderMetricHeader("hook", getManagerMetricLabel("hook"), column, filterValue);
        },
        filterFn: (row, columnId, filterValue: FilterValue | FilterValue[] | undefined) => {
          const original = row.original as RankingsItem;
          const hookValue = Number(original.hook ?? 0);
          return applyPercentageFilterMaybeArray(hookValue, filterValue);
        },
        cell: (info) => {
          const original = info.row.original as RankingsItem;
          const hookValue = info.getValue() ?? original.hook ?? 0;
          const hookAsPct = Number(hookValue) * 100;
          return <MetricCell row={info.row.original} value={<span className="text-center inline-block w-full">{formatPct(hookAsPct)}</span>} metric="hook" getRowKey={getRowKey} byKey={byKey} endDate={endDate} showTrends={showTrends} averages={averagesRef.current} formatCurrency={formatCurrencyRef.current} actionType={actionTypeRef.current} hasSheetIntegration={hasSheetIntegration} mqlLeadscoreMin={mqlLeadscoreMin} minimal={isMinimal} lightweight />;
        },
        sortingFn: "auto",
      }) as any,
    );
  }

  // Link CTR
  if (shouldShow("website_ctr")) {
    cols.push(
      columnHelper.accessor(
        (row) => getMetricValueOrNull(row as RankingsItem, "website_ctr"),
        {
          id: "website_ctr",
          header: ({ column }) => {
            const filterValue = column.getFilterValue() as FilterValue | undefined;
            return renderMetricHeader("website_ctr", getManagerMetricLabel("website_ctr"), column, filterValue);
          },
          filterFn: (row, columnId, filterValue: FilterValue | FilterValue[] | undefined) => {
            return applyPercentageFilterMaybeArray(getMetricValueOrNull(row.original as RankingsItem, "website_ctr"), filterValue);
          },
          sortingFn: "auto",
          cell: (info) => {
            const ad = info.row.original as RankingsItem;
            const websiteCtr = Number(info.getValue() || 0);
            return <MetricCell row={ad} value={<span className="text-center inline-block w-full">{formatPct(websiteCtr * 100)}</span>} metric="website_ctr" getRowKey={getRowKey} byKey={byKey} endDate={endDate} showTrends={showTrends} averages={averagesRef.current} formatCurrency={formatCurrencyRef.current} actionType={actionTypeRef.current} hasSheetIntegration={hasSheetIntegration} mqlLeadscoreMin={mqlLeadscoreMin} minimal={isMinimal} lightweight />;
          },
        },
      ) as any,
    );
  }

  // Connect Rate
  if (shouldShow("connect_rate")) {
    cols.push(
      columnHelper.accessor("connect_rate", {
        header: ({ column }) => {
          const filterValue = column.getFilterValue() as FilterValue | undefined;
          return renderMetricHeader("connect_rate", getManagerMetricLabel("connect_rate"), column, filterValue);
        },
        filterFn: (row, columnId, filterValue: FilterValue | FilterValue[] | undefined) => {
          const original = row.original as RankingsItem;
          const connectRateValue = Number(original.connect_rate ?? 0);
          return applyPercentageFilterMaybeArray(connectRateValue, filterValue);
        },
        sortingFn: "auto",
        cell: (info) => <MetricCell row={info.row.original} value={<span className="text-center inline-block w-full">{formatPct(Number(Number(info.getValue()) * 100))}</span>} metric="connect_rate" getRowKey={getRowKey} byKey={byKey} endDate={endDate} showTrends={showTrends} averages={averagesRef.current} formatCurrency={formatCurrencyRef.current} actionType={actionTypeRef.current} hasSheetIntegration={hasSheetIntegration} mqlLeadscoreMin={mqlLeadscoreMin} minimal={isMinimal} lightweight />,
      }) as any,
    );
  }

  // Page Conversion
  if (shouldShow("page_conv")) {
    cols.push(
      columnHelper.accessor(
        (row) => getMetricValueOrNull(row as RankingsItem, "page_conv"),
        {
          id: "page_conv",
          header: ({ column }) => {
            const filterValue = column.getFilterValue() as FilterValue | undefined;
            return renderMetricHeader("page_conv", getManagerMetricLabel("page_conv"), column, filterValue);
          },
          filterFn: (row, columnId, filterValue: FilterValue | FilterValue[] | undefined) => {
            return applyPercentageFilterMaybeArray(getMetricValueOrNull(row.original as RankingsItem, "page_conv"), filterValue);
          },
          sortingFn: "auto",
          cell: (info) => {
            const ad = info.row.original as RankingsItem;
            const pageConv = Number(info.getValue() || 0);
            return <MetricCell row={ad} value={<span className="text-center inline-block w-full">{formatPct(pageConv * 100)}</span>} metric="page_conv" getRowKey={getRowKey} byKey={byKey} endDate={endDate} showTrends={showTrends} averages={averagesRef.current} formatCurrency={formatCurrencyRef.current} actionType={actionTypeRef.current} hasSheetIntegration={hasSheetIntegration} mqlLeadscoreMin={mqlLeadscoreMin} minimal={isMinimal} lightweight />;
          },
        },
      ) as any,
    );
  }

  // CTR
  if (shouldShow("ctr")) {
    cols.push(
      columnHelper.accessor("ctr", {
        header: ({ column }) => {
          const filterValue = column.getFilterValue() as FilterValue | undefined;
          return renderMetricHeader("ctr", getManagerMetricLabel("ctr"), column, filterValue);
        },
        filterFn: (row, columnId, filterValue: FilterValue | FilterValue[] | undefined) => {
          const original = row.original as RankingsItem;
          const ctrValue = Number(original.ctr ?? 0);
          return applyPercentageFilterMaybeArray(ctrValue, filterValue);
        },
        sortingFn: "auto",
        cell: (info) => <MetricCell row={info.row.original} value={<span className="text-center inline-block w-full">{formatPct(Number(Number(info.getValue()) * 100))}</span>} metric="ctr" getRowKey={getRowKey} byKey={byKey} endDate={endDate} showTrends={showTrends} averages={averagesRef.current} formatCurrency={formatCurrencyRef.current} actionType={actionTypeRef.current} hasSheetIntegration={hasSheetIntegration} mqlLeadscoreMin={mqlLeadscoreMin} minimal={isMinimal} lightweight />,
      }) as any,
    );
  }

  return cols;
}
