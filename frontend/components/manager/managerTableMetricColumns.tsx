"use client";

import React from "react";
import type { ColumnDef, Column } from "@tanstack/react-table";
import { IconAlertTriangle, IconArrowNarrowDown, IconArrowNarrowUp, IconFilter } from "@tabler/icons-react";
import { ColumnFilter, type FilterValue } from "@/components/common/ColumnFilter";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { MetricCell } from "@/components/manager/MetricCell";
import type { RankingsItem } from "@/lib/api/schemas";
import { computeMqlMetricsFromLeadscore } from "@/lib/utils/mqlMetrics";
import type { CreateManagerTableColumnsParams } from "@/components/manager/managerTableColumns";
import type { ManagerColumnType } from "@/components/common/ManagerColumnFilter";

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
  const { columnHelper, activeColumns, byKey, endDate, showTrends, averages, formatAverage, filteredAveragesRef, formatFilteredAverageRef, formatCurrency, formatPct, globalFilterRef, columnFiltersRef, viewMode, hasSheetIntegration, mqlLeadscoreMin, actionType, applyNumericFilter, getRowKey, openSettings } = params;

  const shouldShow = (id: ManagerColumnType) => {
    if (!activeColumns.has(id)) return false;
    if (id === "cpmql" || id === "mqls") return hasSheetIntegration;
    return true;
  };

  const isMinimal = viewMode === "minimal";

  const sumMetrics = new Set(["spend", "results", "mqls"]);

  const renderMetricHeader = (metricId: string, label: string, column: Column<RankingsItem, unknown>, filterValue: FilterValue | FilterValue[] | undefined) => {
    const hasActiveFilters = (globalFilterRef.current && globalFilterRef.current.trim() !== "") || (columnFiltersRef.current && columnFiltersRef.current.length > 0);
    const hasFilters = hasActiveFilters && !!filteredAveragesRef.current;
    const filteredAvg = formatFilteredAverageRef.current(metricId);
    const displayFilterValue: FilterValue | undefined = Array.isArray(filterValue) ? (filterValue.length > 0 ? filterValue[0] : undefined) : (filterValue ?? undefined);
    const textSize = isMinimal ? "text-[10px]" : "text-xs";
    const iconSize = isMinimal ? "w-2.5 h-2.5" : "w-3 h-3";
    const isSum = sumMetrics.has(metricId);

    return (
      <div className={`flex flex-col items-center ${isMinimal ? "gap-0.5" : "gap-0.5"}`}>
        <div className={`flex items-center ${isMinimal ? "gap-0.5" : "gap-1"}`}>
          <SortIcon column={column} />
          <span className={isMinimal ? "text-xs" : ""}>{label}</span>
          <ColumnFilter value={displayFilterValue} readonly={true} />
        </div>
        {formatAverage(metricId) && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className={`${textSize} text-muted-foreground font-normal cursor-help`}>{formatAverage(metricId)}</span>
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
                <span className={`${textSize} text-info font-semibold flex items-center gap-0.5 cursor-help`}>
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

  const cols: ColumnDef<RankingsItem, unknown>[] = [];

  // Spend
  if (shouldShow("spend")) {
    cols.push(
      columnHelper.accessor("spend", {
        header: ({ column }) => {
          const filterValue = column.getFilterValue() as FilterValue | undefined;
          return renderMetricHeader("spend", "Spend", column, filterValue);
        },
        filterFn: (row, columnId, filterValue: FilterValue | FilterValue[] | undefined) => {
          const ad = row.original as RankingsItem;
          const spend = Number(ad.spend || 0);
          return applyNumericFilterMaybeArray(spend, filterValue, applyNumericFilter);
        },
        sortingFn: "auto",
        cell: (info) => <MetricCell row={info.row.original} value={<span className="text-center inline-block w-full">{formatCurrency(Number(info.getValue()) || 0)}</span>} metric="spend" getRowKey={getRowKey} byKey={byKey} endDate={endDate} showTrends={showTrends} averages={averages} formatCurrency={formatCurrency} actionType={actionType} hasSheetIntegration={hasSheetIntegration} mqlLeadscoreMin={mqlLeadscoreMin} minimal={isMinimal} />,
      }) as any,
    );
  }

  // Results
  if (shouldShow("results")) {
    cols.push(
      columnHelper.accessor(
        (row) => {
          const ad = row as RankingsItem;
          const results = actionType ? ad.conversions?.[actionType] || 0 : 0;
          return Number(results);
        },
        {
          id: "results",
          header: ({ column }) => {
            const filterValue = column.getFilterValue() as FilterValue | undefined;
            return renderMetricHeader("results", "Results", column, filterValue);
          },
          filterFn: (row, columnId, filterValue: FilterValue | FilterValue[] | undefined) => {
            const ad = row.original as RankingsItem;
            const results = actionType ? ad.conversions?.[actionType] || 0 : 0;
            return applyNumericFilterMaybeArray(Number(results), filterValue, applyNumericFilter);
          },
          sortingFn: "auto",
          cell: (info) => {
            const results = Number(info.getValue() || 0);
            return <MetricCell row={info.row.original} value={<span className="text-center inline-block w-full">{Math.round(results)}</span>} metric="results" getRowKey={getRowKey} byKey={byKey} endDate={endDate} showTrends={showTrends} averages={averages} formatCurrency={formatCurrency} actionType={actionType} hasSheetIntegration={hasSheetIntegration} mqlLeadscoreMin={mqlLeadscoreMin} minimal={isMinimal} />;
          },
        },
      ) as any,
    );
  }

  // MQLs
  if (hasSheetIntegration && shouldShow("mqls")) {
    cols.push(
      columnHelper.accessor(
        (row) => {
          const ad = row as RankingsItem;
          const { mqlCount } = computeMqlMetricsFromLeadscore({
            spend: Number(ad.spend || 0),
            leadscoreRaw: ad.leadscore_values,
            mqlLeadscoreMin,
          });
          return mqlCount;
        },
        {
          id: "mqls",
          header: ({ column }) => {
            const filterValue = column.getFilterValue() as FilterValue | undefined;
            return renderMetricHeader("mqls", "MQLs", column, filterValue);
          },
          filterFn: (row, columnId, filterValue: FilterValue | FilterValue[] | undefined) => {
            const ad = row.original as RankingsItem;
            const { mqlCount } = computeMqlMetricsFromLeadscore({
              spend: Number(ad.spend || 0),
              leadscoreRaw: ad.leadscore_values,
              mqlLeadscoreMin,
            });
            return applyNumericFilterMaybeArray(mqlCount, filterValue, applyNumericFilter);
          },
          sortingFn: "auto",
          cell: (info) => {
            const mqls = Number(info.getValue() || 0);
            return <MetricCell row={info.row.original} value={<span className="text-center inline-block w-full">{Math.round(mqls)}</span>} metric="mqls" getRowKey={getRowKey} byKey={byKey} endDate={endDate} showTrends={showTrends} averages={averages} formatCurrency={formatCurrency} actionType={actionType} hasSheetIntegration={hasSheetIntegration} mqlLeadscoreMin={mqlLeadscoreMin} minimal={isMinimal} />;
          },
        },
      ) as any,
    );
  }

  // CPR
  if (shouldShow("cpr")) {
    cols.push(
      columnHelper.accessor(
        (row) => {
          const ad = row as RankingsItem;
          const results = actionType ? ad.conversions?.[actionType] || 0 : 0;
          return results > 0 ? Number(ad.spend || 0) / Number(results) : 0;
        },
        {
          id: "cpr",
          header: ({ column }) => {
            const filterValue = column.getFilterValue() as FilterValue | undefined;
            return renderMetricHeader("cpr", "CPR", column, filterValue);
          },
          filterFn: (row, columnId, filterValue: FilterValue | FilterValue[] | undefined) => {
            const ad = row.original as RankingsItem;
            const results = actionType ? ad.conversions?.[actionType] || 0 : 0;
            const cpr = results > 0 ? Number(ad.spend || 0) / results : null;
            return applyNumericFilterMaybeArray(cpr, filterValue, applyNumericFilter);
          },
          sortingFn: "auto",
          cell: (info) => {
            const ad = info.row.original as RankingsItem;
            const results = actionType ? ad.conversions?.[actionType] || 0 : 0;
            const cpr = results > 0 ? Number(info.getValue() || 0) : 0;
            const value = cpr > 0 && Number.isFinite(cpr) ? formatCurrency(cpr) : "—";
            return <MetricCell row={ad} value={<span className="text-center inline-block w-full">{value}</span>} metric="cpr" getRowKey={getRowKey} byKey={byKey} endDate={endDate} showTrends={showTrends} averages={averages} formatCurrency={formatCurrency} actionType={actionType} hasSheetIntegration={hasSheetIntegration} mqlLeadscoreMin={mqlLeadscoreMin} minimal={isMinimal} />;
          },
        },
      ) as any,
    );
  }

  // CPMQL
  if (hasSheetIntegration && shouldShow("cpmql")) {
    cols.push(
      columnHelper.accessor(
        (row) => {
          const ad = row as RankingsItem;
          const spend = Number(ad.spend || 0);
          const { cpmql } = computeMqlMetricsFromLeadscore({
            spend,
            leadscoreRaw: ad.leadscore_values,
            mqlLeadscoreMin,
          });
          return Number.isFinite(cpmql) ? cpmql : 0;
        },
        {
          id: "cpmql",
          header: ({ column }) => {
            const filterValue = column.getFilterValue() as FilterValue | FilterValue[] | undefined;
            const displayFilterValue: FilterValue | undefined = Array.isArray(filterValue) ? (filterValue.length > 0 ? filterValue[0] : undefined) : (filterValue ?? undefined);
            const hasActiveFilters = (globalFilterRef.current && globalFilterRef.current.trim() !== "") || (columnFiltersRef.current && columnFiltersRef.current.length > 0);
            const hasFilters = hasActiveFilters && !!filteredAveragesRef.current;
            return (
              <div className="flex flex-col items-center gap-0.5">
                <div className="flex items-center gap-1.5">
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
                            <IconAlertTriangle className="h-4 w-4" />
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
                  <span>CPMQL</span>
                  <ColumnFilter value={displayFilterValue} readonly={true} />
                </div>
                {formatAverage("cpmql") && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="text-xs text-muted-foreground font-normal cursor-help">{formatAverage("cpmql")}</span>
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
                        <span className="text-xs text-info font-semibold flex items-center gap-0.5 cursor-help">
                          <IconFilter className="w-3 h-3" />
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
            const ad = row.original as RankingsItem;
            const spend = Number(ad.spend || 0);
            const { cpmql } = computeMqlMetricsFromLeadscore({
              spend,
              leadscoreRaw: ad.leadscore_values,
              mqlLeadscoreMin,
            });
            return applyNumericFilterMaybeArray(Number.isFinite(cpmql) ? cpmql : null, filterValue, applyNumericFilter);
          },
          sortingFn: "auto",
          cell: (info) => {
            const ad = info.row.original as RankingsItem;
            const spend = Number(ad.spend || 0);
            const { cpmql } = computeMqlMetricsFromLeadscore({
              spend,
              leadscoreRaw: ad.leadscore_values,
              mqlLeadscoreMin,
            });
            const value = cpmql > 0 && Number.isFinite(cpmql) ? formatCurrency(cpmql) : "—";
            return <MetricCell row={ad} value={<span className="text-center inline-block w-full">{value}</span>} metric="cpmql" getRowKey={getRowKey} byKey={byKey} endDate={endDate} showTrends={showTrends} averages={averages} formatCurrency={formatCurrency} actionType={actionType} hasSheetIntegration={hasSheetIntegration} mqlLeadscoreMin={mqlLeadscoreMin} minimal={isMinimal} />;
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
            return renderMetricHeader("cpm", "CPM", column, filterValue);
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
            return <MetricCell row={ad} value={<span className="text-center inline-block w-full">{formatCurrency(cpm)}</span>} metric="cpm" getRowKey={getRowKey} byKey={byKey} endDate={endDate} showTrends={showTrends} averages={averages} formatCurrency={formatCurrency} actionType={actionType} hasSheetIntegration={hasSheetIntegration} mqlLeadscoreMin={mqlLeadscoreMin} minimal={isMinimal} />;
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
          return renderMetricHeader("hook", "Hook", column, filterValue);
        },
        filterFn: (row, columnId, filterValue: FilterValue | FilterValue[] | undefined) => {
          const original = row.original as RankingsItem;
          const hookValue = Number(original.hook ?? 0);
          const checkOne = (fv: FilterValue | undefined) => {
            if (!fv) return true;
            const filterNum = fv.value;
            if (filterNum !== null && filterNum !== undefined && !isNaN(filterNum)) {
              const normalizedFilter = filterNum > 1 ? filterNum / 100 : filterNum;
              return applyNumericFilter(hookValue, { ...fv, value: normalizedFilter });
            }
            return true;
          };
          if (!filterValue) return true;
          if (Array.isArray(filterValue)) return filterValue.every(checkOne);
          return checkOne(filterValue);
        },
        cell: (info) => {
          const original = info.row.original as RankingsItem;
          const hookValue = info.getValue() ?? original.hook ?? 0;
          const hookAsPct = Number(hookValue) * 100;
          return <MetricCell row={info.row.original} value={<span className="text-center inline-block w-full">{formatPct(hookAsPct)}</span>} metric="hook" getRowKey={getRowKey} byKey={byKey} endDate={endDate} showTrends={showTrends} averages={averages} formatCurrency={formatCurrency} actionType={actionType} hasSheetIntegration={hasSheetIntegration} mqlLeadscoreMin={mqlLeadscoreMin} minimal={isMinimal} />;
        },
        sortingFn: "auto",
      }) as any,
    );
  }

  // Link CTR
  if (shouldShow("website_ctr")) {
    cols.push(
      columnHelper.accessor(
        (row) => {
          const ad = row as RankingsItem;
          // website_ctr pode não estar no schema, então verificamos se existe
          const websiteCtrValue = (ad as RankingsItem & { website_ctr?: number }).website_ctr;
          const websiteCtr = typeof websiteCtrValue === "number" && !Number.isNaN(websiteCtrValue) && isFinite(websiteCtrValue) ? websiteCtrValue : ad.impressions > 0 ? Number(ad.inline_link_clicks || 0) / Number(ad.impressions || 0) : 0;
          return Number.isFinite(websiteCtr) ? websiteCtr : 0;
        },
        {
          id: "website_ctr",
          header: ({ column }) => {
            const filterValue = column.getFilterValue() as FilterValue | undefined;
            return renderMetricHeader("website_ctr", "Link CTR", column, filterValue);
          },
          filterFn: (row, columnId, filterValue: FilterValue | FilterValue[] | undefined) => {
            const ad = row.original as RankingsItem;
            const websiteCtrValueRaw = (ad as RankingsItem & { website_ctr?: number }).website_ctr;
            const websiteCtr = typeof websiteCtrValueRaw === "number" && !Number.isNaN(websiteCtrValueRaw) && isFinite(websiteCtrValueRaw) ? websiteCtrValueRaw : ad.impressions > 0 ? Number(ad.inline_link_clicks || 0) / Number(ad.impressions || 0) : 0;
            const websiteCtrValue = Number.isFinite(websiteCtr) ? websiteCtr : null;
            const checkOne = (fv: FilterValue | undefined) => {
              if (!fv) return true;
              const filterNum = fv.value;
              if (filterNum !== null && filterNum !== undefined && !isNaN(filterNum)) {
                const normalizedFilter = filterNum > 1 ? filterNum / 100 : filterNum;
                return applyNumericFilter(websiteCtrValue, { ...fv, value: normalizedFilter });
              }
              return true;
            };
            if (!filterValue) return true;
            if (Array.isArray(filterValue)) return filterValue.every(checkOne);
            return checkOne(filterValue);
          },
          sortingFn: "auto",
          cell: (info) => {
            const ad = info.row.original as RankingsItem;
            const websiteCtr = Number(info.getValue() || 0);
            return <MetricCell row={ad} value={<span className="text-center inline-block w-full">{formatPct(websiteCtr * 100)}</span>} metric="website_ctr" getRowKey={getRowKey} byKey={byKey} endDate={endDate} showTrends={showTrends} averages={averages} formatCurrency={formatCurrency} actionType={actionType} hasSheetIntegration={hasSheetIntegration} mqlLeadscoreMin={mqlLeadscoreMin} minimal={isMinimal} />;
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
          return renderMetricHeader("connect_rate", "Connect", column, filterValue);
        },
        filterFn: (row, columnId, filterValue: FilterValue | FilterValue[] | undefined) => {
          const original = row.original as RankingsItem;
          const connectRateValue = Number(original.connect_rate ?? 0);
          const checkOne = (fv: FilterValue | undefined) => {
            if (!fv) return true;
            const filterNum = fv.value;
            if (filterNum !== null && filterNum !== undefined && !isNaN(filterNum)) {
              const normalizedFilter = filterNum > 1 ? filterNum / 100 : filterNum;
              return applyNumericFilter(connectRateValue, { ...fv, value: normalizedFilter });
            }
            return true;
          };
          if (!filterValue) return true;
          if (Array.isArray(filterValue)) return filterValue.every(checkOne);
          return checkOne(filterValue);
        },
        sortingFn: "auto",
        cell: (info) => <MetricCell row={info.row.original} value={<span className="text-center inline-block w-full">{formatPct(Number(Number(info.getValue()) * 100))}</span>} metric="connect_rate" getRowKey={getRowKey} byKey={byKey} endDate={endDate} showTrends={showTrends} averages={averages} formatCurrency={formatCurrency} actionType={actionType} hasSheetIntegration={hasSheetIntegration} mqlLeadscoreMin={mqlLeadscoreMin} minimal={isMinimal} />,
      }) as any,
    );
  }

  // Page Conversion
  if (shouldShow("page_conv")) {
    cols.push(
      columnHelper.accessor(
        (row) => {
          const ad = row as RankingsItem;
          // page_conv pode não estar no schema, então verificamos se existe
          const pageConvValue = (ad as RankingsItem & { page_conv?: number }).page_conv;
          if ("page_conv" in ad && typeof pageConvValue === "number" && !Number.isNaN(pageConvValue) && isFinite(pageConvValue)) {
            return pageConvValue;
          }
          const results = actionType ? ad.conversions?.[actionType] || 0 : 0;
          const lpv = Number(ad.lpv || 0);
          return lpv > 0 ? Number(results) / lpv : 0;
        },
        {
          id: "page_conv",
          header: ({ column }) => {
            const filterValue = column.getFilterValue() as FilterValue | undefined;
            return renderMetricHeader("page_conv", "Page", column, filterValue);
          },
          filterFn: (row, columnId, filterValue: FilterValue | FilterValue[] | undefined) => {
            const ad = row.original as RankingsItem;
            let pageConv: number | null = null;
            const pageConvValue = (ad as RankingsItem & { page_conv?: number }).page_conv;
            if ("page_conv" in ad && typeof pageConvValue === "number" && !Number.isNaN(pageConvValue) && isFinite(pageConvValue)) {
              pageConv = pageConvValue;
            } else if (actionType) {
              const results = ad.conversions?.[actionType] || 0;
              const lpv = Number(ad.lpv || 0);
              pageConv = lpv > 0 ? Number(results) / lpv : null;
            }
            const checkOne = (fv: FilterValue | undefined) => {
              if (!fv) return true;
              const filterNum = fv.value;
              if (filterNum !== null && filterNum !== undefined && !isNaN(filterNum)) {
                const normalizedFilter = filterNum > 1 ? filterNum / 100 : filterNum;
                return applyNumericFilter(pageConv, { ...fv, value: normalizedFilter });
              }
              return true;
            };
            if (!filterValue) return true;
            if (Array.isArray(filterValue)) return filterValue.every(checkOne);
            return checkOne(filterValue);
          },
          sortingFn: "auto",
          cell: (info) => {
            const ad = info.row.original as RankingsItem;
            const pageConv = Number(info.getValue() || 0);
            return <MetricCell row={ad} value={<span className="text-center inline-block w-full">{formatPct(pageConv * 100)}</span>} metric="page_conv" getRowKey={getRowKey} byKey={byKey} endDate={endDate} showTrends={showTrends} averages={averages} formatCurrency={formatCurrency} actionType={actionType} hasSheetIntegration={hasSheetIntegration} mqlLeadscoreMin={mqlLeadscoreMin} minimal={isMinimal} />;
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
          return renderMetricHeader("ctr", "CTR", column, filterValue);
        },
        filterFn: (row, columnId, filterValue: FilterValue | FilterValue[] | undefined) => {
          const original = row.original as RankingsItem;
          const ctrValue = Number(original.ctr ?? 0);
          const checkOne = (fv: FilterValue | undefined) => {
            if (!fv) return true;
            const filterNum = fv.value;
            if (filterNum !== null && filterNum !== undefined && !isNaN(filterNum)) {
              const normalizedFilter = filterNum > 1 ? filterNum / 100 : filterNum;
              return applyNumericFilter(ctrValue, { ...fv, value: normalizedFilter });
            }
            return true;
          };
          if (!filterValue) return true;
          if (Array.isArray(filterValue)) return filterValue.every(checkOne);
          return checkOne(filterValue);
        },
        sortingFn: "auto",
        cell: (info) => <MetricCell row={info.row.original} value={<span className="text-center inline-block w-full">{formatPct(Number(Number(info.getValue()) * 100))}</span>} metric="ctr" getRowKey={getRowKey} byKey={byKey} endDate={endDate} showTrends={showTrends} averages={averages} formatCurrency={formatCurrency} actionType={actionType} hasSheetIntegration={hasSheetIntegration} mqlLeadscoreMin={mqlLeadscoreMin} minimal={isMinimal} />,
      }) as any,
    );
  }

  return cols;
}
