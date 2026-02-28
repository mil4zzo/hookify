"use client";

import React, { useState, useMemo } from "react";
import { IconArrowsSort, IconSearch } from "@tabler/icons-react";
import { useCampaignChildren } from "@/lib/api/hooks";
import type { RankingsItem } from "@/lib/api/schemas";
import { StatusCell } from "@/components/manager/StatusCell";
import { Input } from "@/components/ui/input";
import { MANAGER_COLUMN_OPTIONS, MANAGER_COLUMN_RENDER_ORDER } from "@/components/manager/managerColumns";
import type { ManagerColumnType } from "@/components/common/ManagerColumnFilter";
import { computeMqlMetricsFromLeadscore } from "@/lib/utils/mqlMetrics";

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
}

function areCampaignChildrenRowPropsEqual(
  prev: CampaignChildrenRowProps,
  next: CampaignChildrenRowProps
): boolean {
  const activeColumnsEqual =
    prev.activeColumns.size === next.activeColumns.size &&
    Array.from(prev.activeColumns).every((col) => next.activeColumns.has(col));

  return (
    prev.campaignId === next.campaignId &&
    prev.dateStart === next.dateStart &&
    prev.dateStop === next.dateStop &&
    prev.actionType === next.actionType &&
    prev.formatCurrency === next.formatCurrency &&
    prev.formatPct === next.formatPct &&
    activeColumnsEqual &&
    prev.hasSheetIntegration === next.hasSheetIntegration &&
    prev.mqlLeadscoreMin === next.mqlLeadscoreMin
  );
}

export const CampaignChildrenRow = React.memo(function CampaignChildrenRow({
  campaignId,
  dateStart,
  dateStop,
  actionType,
  formatCurrency,
  formatPct,
  activeColumns,
  hasSheetIntegration = false,
  mqlLeadscoreMin = 0,
}: CampaignChildrenRowProps) {
  const { data: childrenData, isLoading, isError } = useCampaignChildren(
    campaignId,
    dateStart,
    dateStop,
    true
  );

  const [sortConfig, setSortConfig] = useState<{
    column: string | null;
    direction: "asc" | "desc";
  }>({ column: null, direction: "asc" });

  const [searchTerm, setSearchTerm] = useState<string>("");

  const visibleColumns = useMemo(() => {
    return MANAGER_COLUMN_RENDER_ORDER.filter((colId) => {
      if ((colId === "cpmql" || colId === "mqls") && !hasSheetIntegration) {
        return false;
      }
      return activeColumns.has(colId);
    }).map((colId) => MANAGER_COLUMN_OPTIONS.find((c) => c.id === colId)!);
  }, [activeColumns, hasSheetIntegration]);

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
          results = Number(
            conversions[`conversion:${actionType}`] || conversions[`action:${actionType}`] || 0
          );
        }
      }

      const page_conv = lpv > 0 ? results / lpv : 0;
      const cpr = results > 0 ? spend / results : 0;
      const cpm = typeof (child as any).cpm === "number" ? (child as any).cpm : 0;
      const website_ctr = impressions > 0 ? inline_link_clicks / impressions : 0;

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
        mqls,
        cpmql,
        website_ctr,
      };
    });

    const filteredData = searchTerm.trim()
      ? dataWithCalculations.filter((child) => {
          const search = searchTerm.toLowerCase();
          const adsetName = String((child as any).adset_name || "").toLowerCase();
          const adsetId = String((child as any).adset_id || "").toLowerCase();
          return adsetName.includes(search) || adsetId.includes(search);
        })
      : dataWithCalculations;

    if (!sortConfig.column) return filteredData;

    const sorted = [...filteredData].sort((a, b) => {
      let aVal: any;
      let bVal: any;

      switch (sortConfig.column) {
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
        return sortConfig.direction === "asc"
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }
      return sortConfig.direction === "asc" ? aVal - bVal : bVal - aVal;
    });

    return sorted;
  }, [childrenData, sortConfig, actionType, searchTerm, hasSheetIntegration, mqlLeadscoreMin]);

  const handleSort = (column: string) => {
    setSortConfig((prev) => {
      if (prev.column === column) {
        return { column, direction: prev.direction === "asc" ? "desc" : "asc" };
      }
      return { column, direction: column === "adset_name" ? "asc" : "desc" };
    });
  };

  const renderCellValue = (child: any, columnId: ManagerColumnType) => {
    switch (columnId) {
      case "hook":
        return formatPct(Number(child.hook * 100));
      case "cpr":
        return child.results > 0 ? formatCurrency(child.cpr) : "—";
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

  if (isLoading) {
    return (
      <tr className="bg-border">
        <td className="p-0" colSpan={colspan}>
          <div className="p-2 pl-8">
            <div className="text-sm text-muted-foreground">Carregando conjuntos...</div>
          </div>
        </td>
      </tr>
    );
  }

  if (isError) {
    return (
      <tr className="bg-border">
        <td className="p-0" colSpan={colspan}>
          <div className="p-2 pl-8">
            <div className="text-sm text-destructive">Erro ao carregar conjuntos.</div>
          </div>
        </td>
      </tr>
    );
  }

  if (!childrenData || childrenData.length === 0) {
    return (
      <tr className="bg-border">
        <td className="p-0" colSpan={colspan}>
          <div className="p-2 pl-8">
            <div className="text-sm text-muted-foreground">Sem conjuntos no período.</div>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className="bg-card">
      <td className="p-0" colSpan={colspan}>
        <div>
          <div className="px-4 py-3 bg-muted/50">
            <div className="flex items-center gap-3">
              <div className="relative flex-1 max-w-sm">
                <IconSearch className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  type="search"
                  placeholder="Buscar por nome ou ID do conjunto..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9 h-9 text-xs"
                />
              </div>
              {searchTerm.trim() && (
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {sortedData.length} de {childrenData?.length || 0} conjuntos
                </span>
              )}
            </div>
          </div>

          {searchTerm.trim() && sortedData.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm text-muted-foreground">
                Nenhum conjunto encontrado para "{searchTerm}"
              </p>
              <button
                onClick={() => setSearchTerm("")}
                className="mt-2 text-xs text-primary hover:underline"
              >
                Limpar busca
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-border">
                    <th className="p-4 text-center w-20"></th>
                    <th
                      className={`p-4 text-left cursor-pointer select-none hover:text-brand ${
                        sortConfig.column === "adset_name" ? "text-primary" : ""
                      }`}
                      onClick={() => handleSort("adset_name")}
                    >
                      <div className="flex items-center gap-1">
                        Conjunto
                        <IconArrowsSort className="w-3 h-3" />
                      </div>
                    </th>
                    {visibleColumns.map((col) => (
                      <th
                        key={col.id}
                        className={`${childMetricsColumnClass} ${
                          sortConfig.column === col.id ? "text-primary" : ""
                        }`}
                        onClick={() => handleSort(col.id)}
                      >
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
                    const key =
                      String((child as any).adset_id || "") ||
                      String((child as any).adset_name || "") ||
                      String((child as any).ad_name || "");
                    return (
                      <tr
                        key={key}
                        className="hover:bg-muted border-b border-border"
                      >
                        <td className="px-4 py-3 text-center">
                          <StatusCell original={child as any} currentTab="por-conjunto" />
                        </td>
                        <td className="px-4 py-3 text-left">
                          <div className="flex-1 min-w-0">
                            <div className="truncate text-xs font-medium">
                              {String((child as any).adset_name || (child as any).ad_name || "Sem nome")}
                            </div>
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
      </td>
    </tr>
  );
}, areCampaignChildrenRowPropsEqual);
