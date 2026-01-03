"use client";

import React, { useState, useMemo } from "react";
import { IconArrowsSort } from "@tabler/icons-react";
import { useAdVariations } from "@/lib/api/hooks";
import { RankingsChildrenItem } from "@/lib/api/schemas";
import { AdStatusIcon } from "@/components/common/AdStatusIcon";
import { ThumbnailImage } from "@/components/common/ThumbnailImage";
import { getAdThumbnail } from "@/lib/utils/thumbnailFallback";

interface ExpandedChildrenRowProps {
  row: { getVisibleCells: () => any[] };
  adName: string;
  dateStart: string;
  dateStop: string;
  actionType?: string;
  formatCurrency: (n: number) => string;
  formatPct: (v: number) => string;
}

// Função de comparação customizada para React.memo
function areExpandedChildrenRowPropsEqual(prev: ExpandedChildrenRowProps, next: ExpandedChildrenRowProps): boolean {
  return (
    prev.adName === next.adName &&
    prev.dateStart === next.dateStart &&
    prev.dateStop === next.dateStop &&
    prev.actionType === next.actionType &&
    prev.formatCurrency === next.formatCurrency &&
    prev.formatPct === next.formatPct &&
    prev.row === next.row
  );
}

export const ExpandedChildrenRow = React.memo(function ExpandedChildrenRow({
  row,
  adName,
  dateStart,
  dateStop,
  actionType,
  formatCurrency,
  formatPct,
}: ExpandedChildrenRowProps) {
  const { data: childrenData, isLoading, isError } = useAdVariations(adName, dateStart, dateStop, true);
  const [sortConfig, setSortConfig] = useState<{ column: string | null; direction: "asc" | "desc" }>({
    column: null,
    direction: "asc",
  });

  // Preparar dados com cálculos e ordenar
  // IMPORTANTE: useMemo deve ser chamado antes de qualquer retorno condicional para seguir as regras dos Hooks
  const sortedData = useMemo(() => {
    // Se não há dados, retornar array vazio
    if (!childrenData || childrenData.length === 0) {
      return [];
    }
    const dataWithCalculations = childrenData.map((child: RankingsChildrenItem) => {
      const lpv = Number(child.lpv || 0);
      const spend = Number(child.spend || 0);
      const impressions = Number(child.impressions || 0);
      // O backend pode não retornar conversions agregadas, então calcular a partir das séries se disponível
      let conversions = child.conversions || {};
      // Se conversions está vazio mas temos séries, calcular total a partir das séries
      if (Object.keys(conversions).length === 0 && child.series?.conversions) {
        const seriesConversions = child.series.conversions;
        conversions = {};
        // Somar todas as conversões de todos os dias da série
        for (const dayConversions of seriesConversions) {
          if (dayConversions && typeof dayConversions === "object") {
            for (const [actionType, value] of Object.entries(dayConversions)) {
              if (!conversions[actionType]) {
                conversions[actionType] = 0;
              }
              conversions[actionType] += Number(value || 0);
            }
          }
        }
      }
      // Calcular results: usar actionType se disponível, senão 0 (mesma lógica da linha principal)
      const results = actionType && typeof actionType === "string" && actionType.trim() ? Number(conversions[actionType] || 0) : 0;
      // Calcular page_conv: mesmo cálculo da linha principal
      const page_conv = lpv > 0 ? results / lpv : 0;
      // Calcular cpr: mesmo cálculo da linha principal
      const cpr = results > 0 ? spend / results : 0;
      // Usar cpm do backend se disponível, senão calcular
      // cpm sempre vem do backend
      const cpm = typeof child.cpm === "number" ? child.cpm : 0;
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
      };
    });

    if (!sortConfig.column) {
      return dataWithCalculations;
    }

    const sorted = [...dataWithCalculations].sort((a, b) => {
      let aVal: any;
      let bVal: any;

      switch (sortConfig.column) {
        case "ad_id":
          aVal = String(a.ad_id || "");
          bVal = String(b.ad_id || "");
          break;
        case "hook":
          aVal = Number(a.hook || 0);
          bVal = Number(b.hook || 0);
          break;
        case "cpr":
          aVal = a.cpr || 0;
          bVal = b.cpr || 0;
          break;
        case "spend":
          aVal = a.spend || 0;
          bVal = b.spend || 0;
          break;
        case "ctr":
          aVal = Number(a.ctr || 0);
          bVal = Number(b.ctr || 0);
          break;
        case "cpm":
          aVal = a.cpm || 0;
          bVal = b.cpm || 0;
          break;
        case "connect_rate":
          aVal = Number(a.connect_rate || 0);
          bVal = Number(b.connect_rate || 0);
          break;
        case "page_conv":
          aVal = a.page_conv || 0;
          bVal = b.page_conv || 0;
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
  }, [childrenData, sortConfig, actionType]);

  const handleSort = (column: string) => {
    setSortConfig((prev) => {
      if (prev.column === column) {
        // Se já está ordenando por esta coluna, inverter direção
        return { column, direction: prev.direction === "asc" ? "desc" : "asc" };
      }
      // Nova coluna: começar com desc (exceto para ad_id que começa com asc)
      return { column, direction: column === "ad_id" ? "asc" : "desc" };
    });
  };

  const childMetricsColumnClass = `px-4 py-3 text-center cursor-pointer select-none hover:text-brand`;

  // Retornos condicionais após todos os hooks
  if (isLoading) {
    return (
      <tr className="bg-border">
        <td className="p-0" colSpan={row.getVisibleCells().length}>
          <div className="p-2 pl-8">
            <div className="text-sm text-muted-foreground">Carregando variações...</div>
          </div>
        </td>
      </tr>
    );
  }

  if (isError) {
    return (
      <tr className="bg-border">
        <td className="p-0" colSpan={row.getVisibleCells().length}>
          <div className="p-2 pl-8">
            <div className="text-sm text-destructive">Erro ao carregar variações.</div>
          </div>
        </td>
      </tr>
    );
  }

  if (!childrenData || childrenData.length === 0) {
    return (
      <tr className="bg-border">
        <td className="p-0" colSpan={row.getVisibleCells().length}>
          <div className="p-2 pl-8">
            <div className="text-sm text-muted-foreground">Sem variações no período.</div>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className="bg-card">
      <td className="p-0" colSpan={row.getVisibleCells().length}>
        <div className="">
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-border">
                  <th
                    className={`p-4 text-left cursor-pointer select-none hover:text-brand ${
                      sortConfig.column === "ad_id" ? "text-primary" : ""
                    }`}
                    onClick={() => handleSort("ad_id")}
                  >
                    <div className="flex items-center gap-1">
                      Variações
                      <IconArrowsSort className="w-3 h-3" />
                    </div>
                  </th>
                  <th
                    className={`${childMetricsColumnClass} ${sortConfig.column === "hook" ? "text-primary" : ""}`}
                    onClick={() => handleSort("hook")}
                  >
                    <div className="flex items-center justify-center gap-1">
                      Hook
                      <IconArrowsSort className="w-3 h-3" />
                    </div>
                  </th>
                  <th
                    className={`${childMetricsColumnClass} ${sortConfig.column === "cpr" ? "text-primary" : ""}`}
                    onClick={() => handleSort("cpr")}
                  >
                    <div className="flex items-center justify-center gap-1">
                      CPR
                      <IconArrowsSort className="w-3 h-3" />
                    </div>
                  </th>
                  <th
                    className={`${childMetricsColumnClass} ${sortConfig.column === "spend" ? "text-primary" : ""}`}
                    onClick={() => handleSort("spend")}
                  >
                    <div className="flex items-center justify-center gap-1">
                      Spend
                      <IconArrowsSort className="w-3 h-3" />
                    </div>
                  </th>
                  <th
                    className={`${childMetricsColumnClass} ${sortConfig.column === "ctr" ? "text-primary" : ""}`}
                    onClick={() => handleSort("ctr")}
                  >
                    <div className="flex items-center justify-center gap-1">
                      CTR
                      <IconArrowsSort className="w-3 h-3" />
                    </div>
                  </th>
                  <th
                    className={`${childMetricsColumnClass} ${sortConfig.column === "cpm" ? "text-primary" : ""}`}
                    onClick={() => handleSort("cpm")}
                  >
                    <div className="flex items-center justify-center gap-1">
                      CPM
                      <IconArrowsSort className="w-3 h-3" />
                    </div>
                  </th>
                  <th
                    className={`${childMetricsColumnClass} ${sortConfig.column === "connect_rate" ? "text-primary" : ""}`}
                    onClick={() => handleSort("connect_rate")}
                  >
                    <div className="flex items-center justify-center gap-1">
                      Connect
                      <IconArrowsSort className="w-3 h-3" />
                    </div>
                  </th>
                  <th
                    className={`${childMetricsColumnClass} ${sortConfig.column === "page_conv" ? "text-primary" : ""}`}
                    onClick={() => handleSort("page_conv")}
                  >
                    <div className="flex items-center justify-center gap-1">
                      Page
                      <IconArrowsSort className="w-3 h-3" />
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedData.map((child) => {
                  return (
                    <tr key={child.ad_id} className="hover:bg-muted border-b border-border">
                      <td className="px-4 py-3 text-left">
                        <div className="flex items-center gap-2">
                          <ThumbnailImage src={getAdThumbnail(child)} alt="thumb" size="sm" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 truncate">
                              <AdStatusIcon status={(child as any).effective_status} />
                              <span className="text-xs text-muted-foreground truncate">{child.campaign_name}</span>
                            </div>
                            <div className="truncate text-xs font-medium">{child.adset_name}</div>
                          </div>
                        </div>
                      </td>
                      <td className="p-2 text-center">{formatPct(Number(child.hook * 100))}</td>
                      <td className="p-2 text-center">{child.results > 0 ? formatCurrency(child.cpr) : "—"}</td>
                      <td className="p-2 text-center">{formatCurrency(child.spend)}</td>
                      <td className="p-2 text-center">{formatPct(Number(child.ctr * 100))}</td>
                      <td className="p-2 text-center">{formatCurrency(child.cpm)}</td>
                      <td className="p-2 text-center">{formatPct(Number(child.connect_rate * 100))}</td>
                      <td className="p-2 text-center">{child.lpv > 0 ? formatPct(Number(child.page_conv * 100)) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </td>
    </tr>
  );
}, areExpandedChildrenRowPropsEqual);
