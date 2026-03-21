"use client";

import React, { useState, useMemo } from "react";
import { IconArrowsSort, IconLoader2 } from "@tabler/icons-react";
import type { ColumnFiltersState } from "@tanstack/react-table";
import { useCampaignChildren } from "@/lib/api/hooks";
import type { RankingsItem } from "@/lib/api/schemas";
import { StatusCell } from "@/components/manager/StatusCell";
import { SearchInputWithClear } from "@/components/common/SearchInputWithClear";
import { FilterBar } from "@/components/manager/FilterBar";
import { MANAGER_COLUMN_OPTIONS, MANAGER_COLUMN_RENDER_ORDER } from "@/components/manager/managerColumns";
import type { ManagerColumnType } from "@/components/common/ManagerColumnFilter";
import { computeMqlMetricsFromLeadscore } from "@/lib/utils/mqlMetrics";
import { applyRowFilters } from "@/lib/utils/applyRowFilters";

interface CampaignChildrenRowProps {
  campaignId: string;
  dateStart: string;
  dateStop: string;
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

  return prev.asContent === next.asContent && prev.campaignId === next.campaignId && prev.dateStart === next.dateStart && prev.dateStop === next.dateStop && prev.actionType === next.actionType && prev.formatCurrency === next.formatCurrency && prev.formatPct === next.formatPct && activeColumnsEqual && prev.hasSheetIntegration === next.hasSheetIntegration && prev.mqlLeadscoreMin === next.mqlLeadscoreMin && columnFiltersEqual && prev.setColumnFilters === next.setColumnFilters;
}

export const CampaignChildrenRow = React.memo(function CampaignChildrenRow({ campaignId, dateStart, dateStop, actionType, formatCurrency, formatPct, activeColumns, hasSheetIntegration = false, mqlLeadscoreMin = 0, columnFilters = [], setColumnFilters, asContent = false }: CampaignChildrenRowProps) {
  const { data: childrenData, isLoading, isError } = useCampaignChildren(campaignId, dateStart, dateStop, true);

  const [sortConfig, setSortConfig] = useState<{
    column: string | null;
    direction: "asc" | "desc";
  }>({ column: "spend", direction: "desc" });

  const [searchTerm, setSearchTerm] = useState<string>("");

  const visibleColumns = useMemo(() => {
    return MANAGER_COLUMN_RENDER_ORDER.filter((colId) => {
      if ((colId === "cpmql" || colId === "mqls") && !hasSheetIntegration) {
        return false;
      }
      return activeColumns.has(colId);
    }).map((colId) => MANAGER_COLUMN_OPTIONS.find((c) => c.id === colId)!);
  }, [activeColumns, hasSheetIntegration]);

  const filterableColumns = useMemo(() => {
    const cols: Array<{ id: string; label: string; isPercentage?: boolean; isText?: boolean; isStatus?: boolean }> = [];
    cols.push({ id: "status", label: "Status", isStatus: true });
    cols.push({ id: "adset_name_filter", label: "Conjunto", isText: true });
    for (const col of visibleColumns) {
      const isPct = ["hook", "ctr", "website_ctr", "connect_rate", "page_conv"].includes(col.id);
      cols.push({ id: col.id, label: col.name, isPercentage: isPct });
    }
    return cols;
  }, [visibleColumns]);

  const sortedData = useMemo(() => {
    if (!childrenData || childrenData.length === 0) return [];

    const dataWithCalculations = (childrenData as RankingsItem[]).map((child) => {
      const lpv = Number((child as any).lpv || 0);
      const spend = Number((child as any).spend || 0);
      const impressions = Number((child as any).impressions || 0);
      const inline_link_clicks = Number((child as any).inline_link_clicks || 0);

      let conversions: Record<string, number> = (child as any).conversions || {};

      let results = 0;
      if (actionType && typeof actionType === "string" && actionType.trim()) {
        results = Number(conversions[actionType] || 0);
        if (results === 0 && (actionType.startsWith("conversion:") || actionType.startsWith("action:"))) {
          const unprefixed = actionType.replace(/^(conversion|action):/, "");
          results = Number(conversions[unprefixed] || 0);
        }
        if (results === 0 && !actionType.startsWith("conversion:") && !actionType.startsWith("action:")) {
          results = Number(conversions[`conversion:${actionType}`] || conversions[`action:${actionType}`] || 0);
        }
      }

      const page_conv = lpv > 0 ? results / lpv : 0;
      const cpr = results > 0 ? spend / results : 0;
      const clicks = Number((child as any).clicks || 0);
      const cpm = typeof (child as any).cpm === "number" ? (child as any).cpm : 0;
      const website_ctr = impressions > 0 ? inline_link_clicks / impressions : 0;
      const cpc = clicks > 0 ? spend / clicks : 0;
      const cplc = inline_link_clicks > 0 ? spend / inline_link_clicks : 0;

      const { mqlCount } = hasSheetIntegration
        ? computeMqlMetricsFromLeadscore({
            spend,
            leadscoreRaw: (child as any).leadscore_values,
            mqlLeadscoreMin,
          })
        : { mqlCount: 0 };

      const mqls = mqlCount;
      const cpmql = mqls > 0 ? spend / mqls : 0;

      return {
        ...child,
        conversions,
        results,
        page_conv,
        cpr,
        cpm,
        lpv,
        spend,
        impressions,
        clicks,
        inline_link_clicks,
        mqls,
        cpmql,
        cpc,
        cplc,
        website_ctr,
      };
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

    const isActiveStatus = (status?: string | null) => status != null && String(status).toUpperCase() === "ACTIVE";

    const sorted = [...filteredData].sort((a, b) => {
      let aVal: any;
      let bVal: any;

      switch (sortConfig.column) {
        case "status": {
          const activeA = isActiveStatus((a as any).effective_status);
          const activeB = isActiveStatus((b as any).effective_status);
          if (activeA === activeB) return 0;
          const cmp = activeA && !activeB ? -1 : 1;
          return sortConfig.direction === "asc" ? cmp : -cmp;
        }
        case "adset_name":
          aVal = String((a as any).adset_name || "");
          bVal = String((b as any).adset_name || "");
          break;
        case "hook":
          aVal = Number((a as any).hook || 0);
          bVal = Number((b as any).hook || 0);
          break;
        case "cpr":
          aVal = (a as any).cpr || 0;
          bVal = (b as any).cpr || 0;
          break;
        case "cpc":
          aVal = (a as any).cpc || 0;
          bVal = (b as any).cpc || 0;
          break;
        case "cplc":
          aVal = (a as any).cplc || 0;
          bVal = (b as any).cplc || 0;
          break;
        case "cpmql":
          aVal = (a as any).cpmql || 0;
          bVal = (b as any).cpmql || 0;
          break;
        case "spend":
          aVal = (a as any).spend || 0;
          bVal = (b as any).spend || 0;
          break;
        case "ctr":
          aVal = Number((a as any).ctr || 0);
          bVal = Number((b as any).ctr || 0);
          break;
        case "website_ctr":
          aVal = Number((a as any).website_ctr || 0);
          bVal = Number((b as any).website_ctr || 0);
          break;
        case "cpm":
          aVal = (a as any).cpm || 0;
          bVal = (b as any).cpm || 0;
          break;
        case "connect_rate":
          aVal = Number((a as any).connect_rate || 0);
          bVal = Number((b as any).connect_rate || 0);
          break;
        case "page_conv":
          aVal = (a as any).page_conv || 0;
          bVal = (b as any).page_conv || 0;
          break;
        case "results":
          aVal = (a as any).results || 0;
          bVal = (b as any).results || 0;
          break;
        case "mqls":
          aVal = (a as any).mqls || 0;
          bVal = (b as any).mqls || 0;
          break;
        default:
          return 0;
      }

      if (typeof aVal === "string") {
        return sortConfig.direction === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return sortConfig.direction === "asc" ? aVal - bVal : bVal - aVal;
    });

    return sorted;
  }, [childrenData, sortConfig, actionType, searchTerm, hasSheetIntegration, mqlLeadscoreMin, columnFilters]);

  const handleSort = (column: string) => {
    setSortConfig((prev) => {
      if (prev.column === column) {
        return { column, direction: prev.direction === "asc" ? "desc" : "asc" };
      }
      // Status e adset_name: primeiro clique = asc (ativos primeiro / ordem natural)
      return { column, direction: column === "adset_name" || column === "status" ? "asc" : "desc" };
    });
  };

  const renderCellValue = (child: any, columnId: ManagerColumnType) => {
    switch (columnId) {
      case "hook":
        return formatPct(Number(child.hook * 100));
      case "cpr":
        return child.results > 0 ? formatCurrency(child.cpr) : "—";
      case "cpc":
        return child.clicks > 0 ? formatCurrency(child.cpc) : "—";
      case "cplc":
        return child.inline_link_clicks > 0 ? formatCurrency(child.cplc) : "—";
      case "cpmql":
        return child.mqls > 0 ? formatCurrency(child.cpmql) : "—";
      case "spend":
        return formatCurrency(child.spend);
      case "ctr":
        return formatPct(Number(child.ctr * 100));
      case "website_ctr":
        return formatPct(Number(child.website_ctr * 100));
      case "cpm":
        return formatCurrency(child.cpm);
      case "connect_rate":
        return formatPct(Number(child.connect_rate * 100));
      case "page_conv":
        return child.lpv > 0 ? formatPct(Number(child.page_conv * 100)) : "—";
      case "results":
        return child.results > 0 ? child.results.toLocaleString("pt-BR") : "—";
      case "mqls":
        return child.mqls > 0 ? child.mqls.toLocaleString("pt-BR") : "—";
      default:
        return "—";
    }
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
      <div className="px-4 py-3 bg-muted/50" role="region" aria-label="Busca e filtros da tabela expandida">
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
