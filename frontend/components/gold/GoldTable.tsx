"use client";

import { useMemo, useState } from "react";
import { RankingsItem, RankingsResponse } from "@/lib/api/schemas";
import { useFormatCurrency } from "@/lib/utils/currency";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils/cn";
import { isLowerBetterMetric } from "@/lib/constants/metrics";
import { computeAdDerivedMetrics, classifyGoldBucket, GoldBucket } from "@/lib/utils/goldClassification";
import { IconArrowsSort, IconChevronUp, IconChevronDown } from "@tabler/icons-react";

interface GoldTableProps {
  ads: RankingsItem[];
  averages?: RankingsResponse["averages"];
  actionType: string;
}

/**
 * Tabela que exibe anúncios com métricas principais (CPR, CPM, Spend, CTR, Connect Rate, Link CTR, Page Conversion)
 */
export function GoldTable({ ads, averages, actionType }: GoldTableProps) {
  const formatCurrency = useFormatCurrency();
  const [sortConfig, setSortConfig] = useState<{ column: string | null; direction: "asc" | "desc" }>({ column: null, direction: "asc" });

  // Calcular métricas e categoria para cada anúncio
  const adsWithMetrics = useMemo(() => {
    return ads.map((ad) => {
      const impressions = Number((ad as any).impressions || 0);
      const spend = Number((ad as any).spend || 0);
      const clicks = Number((ad as any).clicks || 0);
      const inlineLinkClicks = Number((ad as any).inline_link_clicks || 0);
      const lpv = Number((ad as any).lpv || 0);
      const results = actionType ? Number((ad as any).conversions?.[actionType] || 0) : 0;

      // CPM: priorizar valor do backend, senão calcular
      const cpm = typeof (ad as any).cpm === "number" && !Number.isNaN((ad as any).cpm) && isFinite((ad as any).cpm) ? (ad as any).cpm : impressions > 0 ? (spend * 1000) / impressions : 0;

      // CPR
      const cpr = results > 0 ? spend / results : 0;

      // CTR
      const ctr = typeof (ad as any).ctr === "number" && !Number.isNaN((ad as any).ctr) && isFinite((ad as any).ctr) ? (ad as any).ctr : impressions > 0 ? clicks / impressions : 0;

      // Website CTR (Link CTR)
      const websiteCtr = typeof (ad as any).website_ctr === "number" && !Number.isNaN((ad as any).website_ctr) && isFinite((ad as any).website_ctr) ? (ad as any).website_ctr : impressions > 0 ? inlineLinkClicks / impressions : 0;

      // Connect Rate
      const connectRate = typeof (ad as any).connect_rate === "number" && !Number.isNaN((ad as any).connect_rate) && isFinite((ad as any).connect_rate) ? (ad as any).connect_rate : inlineLinkClicks > 0 ? lpv / inlineLinkClicks : 0;

      // Page Conversion
      const pageConv = lpv > 0 ? results / lpv : 0;

      // Hook
      const hook = Number((ad as any).hook || 0);

      // Calcular categoria G.O.L.D.
      let category: GoldBucket = "neutros";
      if (averages) {
        const adMetrics = computeAdDerivedMetrics(ad, actionType);
        category = classifyGoldBucket({ adMetrics, averages, actionType });
      }

      return {
        ...ad,
        cpr,
        cpm,
        ctr,
        hook,
        websiteCtr,
        connectRate,
        pageConv,
        category,
      };
    });
  }, [ads, actionType, averages]);

  // Ordenar dados baseado na configuração de ordenação
  const sortedAds = useMemo(() => {
    if (!sortConfig.column) {
      return adsWithMetrics;
    }

    return [...adsWithMetrics].sort((a, b) => {
      let aVal: any;
      let bVal: any;

      switch (sortConfig.column) {
        case "ad_name":
          aVal = String(a.ad_name || a.ad_id || "");
          bVal = String(b.ad_name || b.ad_id || "");
          break;
        case "category":
          // Ordenar por categoria (ordem: golds, oportunidades, licoes, descartes, neutros)
          const categoryOrder: Record<GoldBucket, number> = {
            golds: 0,
            oportunidades: 1,
            licoes: 2,
            descartes: 3,
            neutros: 4,
          };
          aVal = categoryOrder[a.category] ?? 4;
          bVal = categoryOrder[b.category] ?? 4;
          break;
        case "cpr":
          aVal = a.cpr || 0;
          bVal = b.cpr || 0;
          break;
        case "cpm":
          aVal = a.cpm || 0;
          bVal = b.cpm || 0;
          break;
        case "hook":
          aVal = a.hook || 0;
          bVal = b.hook || 0;
          break;
        case "spend":
          aVal = Number((a as any).spend || 0);
          bVal = Number((b as any).spend || 0);
          break;
        case "ctr":
          aVal = a.ctr || 0;
          bVal = b.ctr || 0;
          break;
        case "connectRate":
          aVal = a.connectRate || 0;
          bVal = b.connectRate || 0;
          break;
        case "websiteCtr":
          aVal = a.websiteCtr || 0;
          bVal = b.websiteCtr || 0;
          break;
        case "pageConv":
          aVal = a.pageConv || 0;
          bVal = b.pageConv || 0;
          break;
        default:
          return 0;
      }

      if (typeof aVal === "string") {
        return sortConfig.direction === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return sortConfig.direction === "asc" ? aVal - bVal : bVal - aVal;
    });
  }, [adsWithMetrics, sortConfig]);

  // Handler para ordenação
  const handleSort = (column: string) => {
    setSortConfig((prev) => {
      if (prev.column === column) {
        // Se já está ordenando por esta coluna, inverter direção
        return { column, direction: prev.direction === "asc" ? "desc" : "asc" };
      }
      // Nova coluna: começar com desc (exceto para ad_name que começa com asc)
      return { column, direction: column === "ad_name" ? "asc" : "desc" };
    });
  };

  // Componente para header clicável com ícone de ordenação (alinhado à direita)
  const SortableHeader = ({ column, children }: { column: string; children: React.ReactNode }) => {
    const isSorted = sortConfig.column === column;
    const isAsc = sortConfig.direction === "asc";

    return (
      <TableHead
        className="text-right cursor-pointer select-none hover:bg-muted-hover transition-colors"
        onClick={() => handleSort(column)}
      >
        <div className="flex items-center justify-end gap-1">
          {children}
          {isSorted ? (
            isAsc ? (
              <IconChevronUp className="h-4 w-4" />
            ) : (
              <IconChevronDown className="h-4 w-4" />
            )
          ) : (
            <IconArrowsSort className="h-4 w-4 opacity-40" />
          )}
        </div>
      </TableHead>
    );
  };

  // Componente para header clicável com ícone de ordenação (alinhado à esquerda)
  const SortableHeaderCenter = ({ column, children }: { column: string; children: React.ReactNode }) => {
    const isSorted = sortConfig.column === column;
    const isAsc = sortConfig.direction === "asc";

    return (
      <TableHead
        className="cursor-pointer select-none hover:bg-muted-hover transition-colors"
        onClick={() => handleSort(column)}
      >
        <div className="flex items-center gap-1">
          {children}
          {isSorted ? (
            isAsc ? (
              <IconChevronUp className="h-4 w-4" />
            ) : (
              <IconChevronDown className="h-4 w-4" />
            )
          ) : (
            <IconArrowsSort className="h-4 w-4 opacity-40" />
          )}
        </div>
      </TableHead>
    );
  };

  const SortableHeaderLeft = ({ column, children }: { column: string; children: React.ReactNode }) => {
    const isSorted = sortConfig.column === column;
    const isAsc = sortConfig.direction === "asc";

    return (
      <TableHead
        className="min-w-[200px] cursor-pointer select-none hover:bg-muted-hover transition-colors"
        onClick={() => handleSort(column)}
      >
        <div className="flex items-center gap-1">
          {children}
          {isSorted ? (
            isAsc ? (
              <IconChevronUp className="h-4 w-4" />
            ) : (
              <IconChevronDown className="h-4 w-4" />
            )
          ) : (
            <IconArrowsSort className="h-4 w-4 opacity-40" />
          )}
        </div>
      </TableHead>
    );
  };

  // Obter médias
  const avgCpr = actionType && averages?.per_action_type?.[actionType] && typeof averages.per_action_type[actionType].cpr === "number" ? averages.per_action_type[actionType].cpr : null;
  const avgCpm = averages?.cpm ?? null;
  const avgHook = averages?.hook ?? null;
  const avgCtr = averages?.ctr ?? null;
  const avgWebsiteCtr = averages?.website_ctr ?? null;
  const avgConnectRate = averages?.connect_rate ?? null;
  const avgPageConv = actionType && averages?.per_action_type?.[actionType] ? averages.per_action_type[actionType].page_conv ?? null : null;

  // Função para formatar porcentagem
  const formatPct = (value: number): string => {
    if (!Number.isFinite(value) || value < 0) return "—";
    return `${(value * 100).toFixed(1)}%`;
  };

  // Função para determinar cor baseada na comparação com média
  const getMetricColor = (value: number, average: number | null, isLowerBetter: boolean): string => {
    if (average == null || average <= 0 || !Number.isFinite(value)) return "text-foreground";
    
    if (isLowerBetter) {
      // Para métricas onde menor é melhor (CPR, CPM)
      if (value <= average) return "text-green-600 dark:text-green-400";
      const ratio = value / average;
      if (ratio <= 1.25) return "text-yellow-600 dark:text-yellow-400";
      if (ratio <= 1.5) return "text-orange-600 dark:text-orange-400";
      return "text-red-600 dark:text-red-400";
    } else {
      // Para métricas onde maior é melhor (CTR, Connect Rate, Page Conv)
      if (value >= average) return "text-green-600 dark:text-green-400";
      const ratio = value / average;
      if (ratio >= 0.75) return "text-yellow-600 dark:text-yellow-400";
      if (ratio >= 0.5) return "text-orange-600 dark:text-orange-400";
      return "text-red-600 dark:text-red-400";
    }
  };

  // Função para obter cor e label da categoria
  const getCategoryInfo = (category: GoldBucket): { label: string; color: string; bgColor: string } => {
    switch (category) {
      case "golds":
        return {
          label: "Golds",
          color: "text-yellow-600 dark:text-yellow-400",
          bgColor: "bg-yellow-500/10 border-yellow-500/30",
        };
      case "oportunidades":
        return {
          label: "Oportunidades",
          color: "text-blue-600 dark:text-blue-400",
          bgColor: "bg-blue-500/10 border-blue-500/30",
        };
      case "licoes":
        return {
          label: "Lições",
          color: "text-purple-600 dark:text-purple-400",
          bgColor: "bg-purple-500/10 border-purple-500/30",
        };
      case "descartes":
        return {
          label: "Descartes",
          color: "text-red-600 dark:text-red-400",
          bgColor: "bg-red-500/10 border-red-500/30",
        };
      case "neutros":
      default:
        return {
          label: "Neutros",
          color: "text-gray-600 dark:text-gray-400",
          bgColor: "bg-gray-500/10 border-gray-500/30",
        };
    }
  };

  if (adsWithMetrics.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
        Nenhum anúncio encontrado
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHeaderLeft column="ad_name">Anúncio</SortableHeaderLeft>
              <SortableHeaderCenter column="category">Categoria</SortableHeaderCenter>
              <SortableHeader column="spend">Spend</SortableHeader>
              <SortableHeader column="cpr">CPR</SortableHeader>
              <SortableHeader column="cpm">CPM</SortableHeader>
              <SortableHeader column="hook">Hook</SortableHeader>
              <SortableHeader column="ctr">CTR</SortableHeader>
              <SortableHeader column="websiteCtr">Link CTR</SortableHeader>
              <SortableHeader column="connectRate">Connect Rate</SortableHeader>
              <SortableHeader column="pageConv">Conversão Página</SortableHeader>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedAds.map((ad) => {
              const categoryInfo = getCategoryInfo(ad.category);
              return (
                <TableRow key={ad.ad_id || ad.ad_name}>
                  <TableCell className="font-medium">
                    {ad.ad_name || ad.ad_id || "—"}
                  </TableCell>
                  <TableCell>
                    <span className={cn("inline-flex items-center px-2 py-1 rounded-md text-xs font-medium border", categoryInfo.bgColor, categoryInfo.color)}>
                      {categoryInfo.label}
                    </span>
                  </TableCell>
                  <TableCell className="text-right text-foreground">
                    {formatCurrency(Number((ad as any).spend || 0))}
                  </TableCell>
                  <TableCell className={cn("text-right", getMetricColor(ad.cpr, avgCpr, true))}>
                    {ad.cpr > 0 ? formatCurrency(ad.cpr) : "—"}
                  </TableCell>
                <TableCell className={cn("text-right", getMetricColor(ad.cpm, avgCpm, true))}>
                  {ad.cpm > 0 ? formatCurrency(ad.cpm) : "—"}
                </TableCell>
                <TableCell className={cn("text-right", getMetricColor(ad.hook, avgHook, false))}>
                  {formatPct(ad.hook)}
                </TableCell>
                <TableCell className={cn("text-right", getMetricColor(ad.ctr, avgCtr, false))}>
                  {formatPct(ad.ctr)}
                </TableCell>
                <TableCell className={cn("text-right", getMetricColor(ad.websiteCtr, avgWebsiteCtr, false))}>
                  {formatPct(ad.websiteCtr)}
                </TableCell>
                <TableCell className={cn("text-right", getMetricColor(ad.connectRate, avgConnectRate, false))}>
                  {formatPct(ad.connectRate)}
                </TableCell>
                <TableCell className={cn("text-right", getMetricColor(ad.pageConv, avgPageConv, false))}>
                  {formatPct(ad.pageConv)}
                </TableCell>
              </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

