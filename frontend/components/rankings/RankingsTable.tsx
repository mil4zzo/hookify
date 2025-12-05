"use client";

import React, { useMemo, useState, useEffect, Fragment, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/common/Modal";
import { useFormatCurrency } from "@/lib/utils/currency";
import { AdInfoCard } from "@/components/ads/AdInfoCard";
import { AdDetailsDialog } from "@/components/ads/AdDetailsDialog";
import { VideoDialog } from "@/components/ads/VideoDialog";
import { createColumnHelper, getCoreRowModel, getSortedRowModel, useReactTable, flexRender } from "@tanstack/react-table";
import { IconArrowsSort, IconPlayerPlay, IconEye } from "@tabler/icons-react";
import { SparklineBars } from "@/components/common/SparklineBars";
import { MetricCard } from "@/components/common/MetricCard";
import { buildDailySeries } from "@/lib/utils/metricsTimeSeries";
import { api } from "@/lib/api/endpoints";
import { useAdVariations } from "@/lib/api/hooks";
import { RankingsItem, RankingsChildrenItem } from "@/lib/api/schemas";
import { getAdThumbnail } from "@/lib/utils/thumbnailFallback";
import { useMqlLeadscore } from "@/lib/hooks/useMqlLeadscore";
import { computeMqlMetricsFromLeadscore } from "@/lib/utils/mqlMetrics";

type Ad = RankingsItem;

interface RankingsTableProps {
  ads: Ad[];
  groupByAdName?: boolean;
  actionType?: string;
  endDate?: string;
  dateStart?: string;
  dateStop?: string;
  availableConversionTypes?: string[];
  showTrends?: boolean;
  averagesOverride?: {
    hook: number | null;
    scroll_stop: number | null;
    ctr: number | null;
    website_ctr: number | null;
    connect_rate: number | null;
    cpm: number | null;
    cpr: number | null;
    page_conv: number | null;
  };
  /** Indica se há integração de planilha (Google Sheets) em pelo menos um dos packs selecionados */
  hasSheetIntegration?: boolean;
}

const columnHelper = createColumnHelper<Ad>();

// Componente interno para renderizar linha expandida de variações
function ExpandedChildrenRow({ row, adName, dateStart, dateStop, actionType, formatCurrency, formatPct }: { row: { getVisibleCells: () => any[] }; adName: string; dateStart: string; dateStop: string; actionType?: string; formatCurrency: (n: number) => string; formatPct: (v: number) => string }) {
  const { data: childrenData, isLoading, isError } = useAdVariations(adName, dateStart, dateStop, true);
  const [sortConfig, setSortConfig] = useState<{ column: string | null; direction: "asc" | "desc" }>({ column: null, direction: "asc" });

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

  // Preparar dados com cálculos e ordenar
  const sortedData = useMemo(() => {
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

  return (
    <tr className="bg-card">
      <td className="p-0" colSpan={row.getVisibleCells().length}>
        <div className="">
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-border">
                  <th className={`p-4 text-left cursor-pointer select-none hover:text-brand ${sortConfig.column === "ad_id" ? "text-primary" : ""}`} onClick={() => handleSort("ad_id")}>
                    <div className="flex items-center gap-1">
                      Variações
                      <IconArrowsSort className="w-3 h-3" />
                    </div>
                  </th>
                  <th className={`${childMetricsColumnClass} ${sortConfig.column === "hook" ? "text-primary" : ""}`} onClick={() => handleSort("hook")}>
                    <div className="flex items-center justify-center gap-1">
                      Hook
                      <IconArrowsSort className="w-3 h-3" />
                    </div>
                  </th>
                  <th className={`${childMetricsColumnClass} ${sortConfig.column === "cpr" ? "text-primary" : ""}`} onClick={() => handleSort("cpr")}>
                    <div className="flex items-center justify-center gap-1">
                      CPR
                      <IconArrowsSort className="w-3 h-3" />
                    </div>
                  </th>
                  <th className={`${childMetricsColumnClass} ${sortConfig.column === "spend" ? "text-primary" : ""}`} onClick={() => handleSort("spend")}>
                    <div className="flex items-center justify-center gap-1">
                      Spend
                      <IconArrowsSort className="w-3 h-3" />
                    </div>
                  </th>
                  <th className={`${childMetricsColumnClass} ${sortConfig.column === "ctr" ? "text-primary" : ""}`} onClick={() => handleSort("ctr")}>
                    <div className="flex items-center justify-center gap-1">
                      CTR
                      <IconArrowsSort className="w-3 h-3" />
                    </div>
                  </th>
                  <th className={`${childMetricsColumnClass} ${sortConfig.column === "cpm" ? "text-primary" : ""}`} onClick={() => handleSort("cpm")}>
                    <div className="flex items-center justify-center gap-1">
                      CPM
                      <IconArrowsSort className="w-3 h-3" />
                    </div>
                  </th>
                  <th className={`${childMetricsColumnClass} ${sortConfig.column === "connect_rate" ? "text-primary" : ""}`} onClick={() => handleSort("connect_rate")}>
                    <div className="flex items-center justify-center gap-1">
                      Connect
                      <IconArrowsSort className="w-3 h-3" />
                    </div>
                  </th>
                  <th className={`${childMetricsColumnClass} ${sortConfig.column === "page_conv" ? "text-primary" : ""}`} onClick={() => handleSort("page_conv")}>
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
                          {(() => {
                            const thumb = getAdThumbnail(child);
                            return thumb ? <img src={thumb} alt="thumb" className="w-10 h-10 object-cover rounded" /> : <div className="w-10 h-10 bg-border rounded" />;
                          })()}
                          <div>
                            <div className="truncate text-xs text-muted-foreground">{child.campaign_name}</div>
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
}

export function RankingsTable({ ads, groupByAdName = true, actionType = "", endDate, dateStart, dateStop, availableConversionTypes = [], showTrends = true, averagesOverride, hasSheetIntegration = false }: RankingsTableProps) {
  const [selectedAd, setSelectedAd] = useState<Ad | null>(null);
  const [videoOpen, setVideoOpen] = useState(false);
  const [selectedVideo, setSelectedVideo] = useState<{ videoId: string; actorId: string; title: string } | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Os dados já vêm agregados do servidor quando pais; não re-agregar aqui
  const data = useMemo(() => {
    if (!ads || !Array.isArray(ads)) {
      return [];
    }
    return ads;
  }, [ads]);
  const formatCurrency = useFormatCurrency();
  const { mqlLeadscoreMin } = useMqlLeadscore();

  const formatPct = (v: number) => (v != null && !isNaN(v) ? `${Number(v).toFixed(2)}%` : "—");
  const formatNum = (v: number) => (v ? v.toLocaleString("pt-BR") : "—");
  // formatUsd agora usa formatCurrency diretamente dentro dos cells para reatividade

  type RankingsAverages = {
    count: number;
    spend: number;
    impressions: number;
    clicks: number;
    inline_link_clicks: number;
    lpv: number;
    plays: number;
    results: number;
    hook: number | null;
    scroll_stop: number | null;
    ctr: number | null;
    website_ctr: number | null;
    connect_rate: number | null;
    cpm: number | null;
    cpr: number | null;
    page_conv: number | null;
    cpmql: number | null;
  };

  const computedAverages: RankingsAverages = useMemo(() => {
    const n = ads.length;
    if (n === 0) {
      return {
        count: 0,
        spend: 0,
        impressions: 0,
        clicks: 0,
        inline_link_clicks: 0,
        lpv: 0,
        plays: 0,
        results: 0,
        hook: null,
        scroll_stop: null,
        ctr: null,
        website_ctr: null,
        connect_rate: null,
        cpm: null,
        cpr: null,
        page_conv: null,
        cpmql: null,
      };
    }

    let sumSpend = 0;
    let sumImpr = 0;
    let sumClicks = 0;
    let sumInlineLinkClicks = 0;
    let sumLPV = 0;
    let sumPlays = 0;
    let sumResults = 0;

    let hookWeighted = 0;
    let hookWeight = 0;

    let scrollStopWeighted = 0;
    let scrollStopWeight = 0;

    for (const ad of ads) {
      const spend = Number((ad as any).spend || 0);
      const impressions = Number((ad as any).impressions || 0);
      const clicks = Number((ad as any).clicks || 0);
      const inlineLinkClicks = Number((ad as any).inline_link_clicks || 0);
      const lpv = Number((ad as any).lpv || 0);
      // Nem todos os objetos têm plays; usar fallback em video_total_plays se disponível
      const plays = Number((ad as any).plays ?? (ad as any).video_total_plays ?? 0);
      const hook = Number((ad as any).hook ?? 0);
      const convs = (ad as any).conversions || {};
      const res = actionType ? Number(convs[actionType] || 0) : 0;

      sumSpend += spend;
      sumImpr += impressions;
      sumClicks += clicks;
      sumInlineLinkClicks += inlineLinkClicks;
      sumLPV += lpv;
      sumPlays += plays;
      sumResults += res;

      const w = plays > 0 ? plays : 1;
      if (!Number.isNaN(hook)) {
        hookWeighted += hook * w;
        hookWeight += w;
      }

      // Calcular scroll_stop (índice 1 da curva de retenção) ponderado por plays
      // A curva vem em porcentagem (0-100), então normalizamos para decimal (0-1) antes de ponderar
      const curve = (ad as any).video_play_curve_actions;
      if (Array.isArray(curve) && curve.length > 1) {
        const scrollStopRaw = Number(curve[1] || 0);
        if (!Number.isNaN(scrollStopRaw) && isFinite(scrollStopRaw) && scrollStopRaw >= 0) {
          // Normalizar: se valor > 1, assume que está em porcentagem e divide por 100
          const scrollStopVal = scrollStopRaw > 1 ? scrollStopRaw / 100 : scrollStopRaw;
          if (scrollStopVal >= 0 && scrollStopVal <= 1) {
            scrollStopWeighted += scrollStopVal * w;
            scrollStopWeight += w;
          }
        }
      }
    }

    // Métricas que dependem de actionType (calculadas localmente)
    const hookAvg = hookWeight > 0 ? hookWeighted / hookWeight : null;
    const scrollStopAvg = scrollStopWeight > 0 ? scrollStopWeighted / scrollStopWeight : null;
    const cpr = sumResults > 0 ? sumSpend / sumResults : null;
    const pageConv = sumLPV > 0 ? sumResults / sumLPV : null;

    // Métricas que não dependem de actionType - usar valores do backend quando disponíveis
    // Se todos os ads têm a métrica do backend, usar média ponderada; senão, calcular
    const adsWithCtr = ads.filter((ad) => typeof (ad as any).ctr === "number" && !Number.isNaN((ad as any).ctr));
    const ctr = adsWithCtr.length === ads.length && sumImpr > 0 ? ads.reduce((sum, ad) => sum + ((ad as any).ctr || 0) * Number((ad as any).impressions || 0), 0) / sumImpr : sumImpr > 0 ? sumClicks / sumImpr : null;

    const adsWithWebsiteCtr = ads.filter((ad) => typeof (ad as any).website_ctr === "number" && !Number.isNaN((ad as any).website_ctr));
    const websiteCtr = adsWithWebsiteCtr.length === ads.length && sumImpr > 0 ? ads.reduce((sum, ad) => sum + ((ad as any).website_ctr || 0) * Number((ad as any).impressions || 0), 0) / sumImpr : sumImpr > 0 ? sumInlineLinkClicks / sumImpr : null;

    const adsWithCpm = ads.filter((ad) => typeof (ad as any).cpm === "number" && !Number.isNaN((ad as any).cpm));
    const cpm = adsWithCpm.length === ads.length && sumImpr > 0 ? ads.reduce((sum, ad) => sum + ((ad as any).cpm || 0) * Number((ad as any).impressions || 0), 0) / sumImpr : sumImpr > 0 ? (sumSpend * 1000) / sumImpr : null;

    const adsWithConnectRate = ads.filter((ad) => typeof (ad as any).connect_rate === "number" && !Number.isNaN((ad as any).connect_rate));
    const connectAvg =
      adsWithConnectRate.length === ads.length && sumInlineLinkClicks > 0
        ? ads.reduce((sum, ad) => {
            const connectRate = (ad as any).connect_rate || 0;
            const inlineLinkClicks = Number((ad as any).inline_link_clicks || 0);
            return sum + connectRate * inlineLinkClicks;
          }, 0) / sumInlineLinkClicks
        : sumInlineLinkClicks > 0
        ? sumLPV / sumInlineLinkClicks
        : null;

    // Calcular média de CPMQL (só quando há integração de planilha)
    let cpmqlAvg: number | null = null;
    if (hasSheetIntegration) {
      const cpmqlValues: number[] = [];
      for (const ad of ads) {
        const spend = Number((ad as any).spend || 0);
        const { cpmql } = computeMqlMetricsFromLeadscore({
          spend,
          leadscoreRaw: (ad as any).leadscore_values,
          mqlLeadscoreMin,
        });
        // Aceitar qualquer valor finito para calcular a média (incluindo 0 se for válido)
        if (Number.isFinite(cpmql)) {
          cpmqlValues.push(cpmql);
        }
      }
      if (cpmqlValues.length > 0) {
        cpmqlAvg = cpmqlValues.reduce((sum, val) => sum + val, 0) / cpmqlValues.length;
      }
    }

    return {
      count: n,
      // Métricas de soma: dividir por n para calcular média aritmética
      spend: n > 0 ? sumSpend / n : 0,
      impressions: n > 0 ? sumImpr / n : 0,
      clicks: n > 0 ? sumClicks / n : 0,
      inline_link_clicks: n > 0 ? sumInlineLinkClicks / n : 0,
      lpv: n > 0 ? sumLPV / n : 0,
      plays: n > 0 ? sumPlays / n : 0,
      results: n > 0 ? sumResults / n : 0,
      // Métricas já calculadas como médias/razões: não dividir
      hook: hookAvg,
      scroll_stop: scrollStopAvg,
      ctr,
      website_ctr: websiteCtr,
      connect_rate: connectAvg,
      cpm,
      cpr,
      page_conv: pageConv,
      cpmql: cpmqlAvg,
    };
  }, [ads, actionType, hasSheetIntegration, mqlLeadscoreMin]);

  const averages = useMemo(() => {
    if (averagesOverride) {
      // Verificar inconsistências para métricas que dependem de actionType
      if (actionType) {
        // Se o actionType está selecionado mas não há média do servidor, pode ser um problema
        if (averagesOverride.cpr === null && computedAverages.cpr !== null) {
          console.warn(`[RankingsTable] CPR média não retornada pelo servidor para actionType "${actionType}", usando cálculo local.`, { actionType, availableConversionTypes });
        }
        if (averagesOverride.page_conv === null && computedAverages.page_conv !== null) {
          console.warn(`[RankingsTable] Page Conv média não retornada pelo servidor para actionType "${actionType}", usando cálculo local.`, { actionType, availableConversionTypes });
        }
      }

      return {
        count: computedAverages.count,
        spend: computedAverages.spend,
        impressions: computedAverages.impressions,
        clicks: computedAverages.clicks,
        inline_link_clicks: computedAverages.inline_link_clicks,
        lpv: computedAverages.lpv,
        plays: computedAverages.plays,
        results: computedAverages.results,
        hook: averagesOverride.hook,
        scroll_stop: averagesOverride.scroll_stop,
        ctr: averagesOverride.ctr,
        website_ctr: averagesOverride.website_ctr ?? computedAverages.website_ctr,
        connect_rate: averagesOverride.connect_rate,
        cpm: averagesOverride.cpm,
        // CPR e page_conv dependem do actionType, usar computedAverages como fallback se null
        // Mas logar quando isso acontecer para identificar problemas
        cpr: averagesOverride.cpr ?? computedAverages.cpr,
        page_conv: averagesOverride.page_conv ?? computedAverages.page_conv,
        // CPMQL é calculado localmente e não vem do servidor
        cpmql: computedAverages.cpmql,
      } as RankingsAverages;
    }
    return computedAverages;
  }, [computedAverages, averagesOverride, actionType, availableConversionTypes]);

  const getRowKey = useCallback(
    (row: { original?: RankingsItem } | RankingsItem) => {
      const original = "original" in row ? row.original : row;
      if (!original) return "";
      const item = original as RankingsItem;
      return groupByAdName ? String(item.ad_name || item.ad_id) : String(item.unique_id || `${item.account_id}:${item.ad_id}`);
    },
    [groupByAdName]
  );

  // Pre-aggregate 5-day daily series ending at provided endDate (fallback se não vier do servidor)
  const { byKey } = useMemo(() => {
    if (!endDate) return { byKey: new Map<string, any>() };
    // Verificar se os dados já vêm com séries do servidor
    const hasServerSeries = ads.length > 0 && ads[0]?.series;
    if (hasServerSeries) {
      // Construir mapa a partir das séries do servidor
      const map = new Map<string, any>();
      ads.forEach((ad: RankingsItem) => {
        const key = getRowKey({ original: ad });
        if (ad.series) {
          map.set(key, { series: ad.series, axis: ad.series.axis });
        }
      });
      return { byKey: map };
    }
    // Fallback: calcular séries client-side
    return buildDailySeries(ads as any, {
      groupBy: groupByAdName ? "ad_name" : "ad_id",
      actionType,
      endDate,
      dateField: "date",
      windowDays: 5,
    });
  }, [ads, groupByAdName, actionType, endDate, getRowKey]);

  const MetricCell = ({ row, value, metric }: { row: RankingsItem | { original?: RankingsItem }; value: React.ReactNode; metric: "hook" | "cpr" | "spend" | "ctr" | "website_ctr" | "connect_rate" | "page_conv" | "cpm" | "cpmql" }) => {
    // row já é o objeto agregado (info.row.original), então precisamos ajustar
    const original: RankingsItem = ("original" in row ? row.original : row) as RankingsItem;
    const serverSeries = original.series ? (original.series as any)[metric] : undefined;
    const rowKey = getRowKey(row);
    const s = serverSeries || (endDate ? (byKey.get(rowKey)?.series as any)?.[metric] : null);

    // Determinar se a métrica é "inversa" (menor é melhor: CPR, CPM e CPMQL)
    const isInverseMetric = metric === "cpr" || metric === "cpm" || metric === "cpmql";

    // Se showTrends estiver ativo, mostrar sparklines
    if (showTrends) {
      return (
        <div className="flex flex-col items-center gap-3">
          {s ? (
            <SparklineBars
              series={s}
              size="small"
              valueFormatter={(n: number) => {
                if (metric === "spend" || metric === "cpr" || metric === "cpm" || metric === "cpmql") {
                  return formatCurrency(n || 0);
                }
                // percent-based metrics
                return `${(n * 100).toFixed(2)}%`;
              }}
              inverseColors={isInverseMetric}
            />
          ) : null}
          <span className="text-base font-medium leading-none">{value}</span>
        </div>
      );
    }

    // Modo Performance: mostrar diferença percentual em relação à média
    // Para CPMQL, acessar explicitamente para evitar problemas de tipagem
    const avgValue = metric === "cpmql" ? (averages as any).cpmql : averages[metric];
    if (avgValue === null || avgValue === undefined) {
      // Se não há média disponível, mostrar apenas o valor
      return (
        <div className="flex flex-col items-center gap-3">
          <span className="text-base font-medium leading-none">{value}</span>
        </div>
      );
    }

    // Extrair valor numérico diretamente do original (mais confiável)
    let currentValue: number | null = null;
    switch (metric) {
      case "hook":
        currentValue = (original as any).hook != null ? Number((original as any).hook) : null;
        // hook vem em decimal (0-1), média também vem em decimal
        break;
      case "cpr":
        if (actionType) {
          const results = (original as any).conversions?.[actionType] || 0;
          currentValue = results > 0 ? Number((original as any).spend || 0) / results : null;
        }
        break;
      case "spend":
        currentValue = Number((original as any).spend || 0);
        break;
      case "ctr":
        currentValue = (original as any).ctr != null ? Number((original as any).ctr) : null;
        // ctr vem em decimal (0-1), média também vem em decimal
        break;
      case "website_ctr":
        currentValue = (original as any).website_ctr != null ? Number((original as any).website_ctr) : null;
        // website_ctr vem em decimal (0-1), média também vem em decimal
        break;
      case "connect_rate":
        currentValue = (original as any).connect_rate != null ? Number((original as any).connect_rate) : null;
        // connect_rate vem em decimal (0-1), média também vem em decimal
        break;
      case "page_conv":
        // Se o ad já tem page_conv calculado (vem do ranking), usar esse valor
        if ("page_conv" in original && typeof (original as any).page_conv === "number" && !Number.isNaN((original as any).page_conv) && isFinite((original as any).page_conv)) {
          currentValue = (original as any).page_conv;
        } else if (actionType) {
          // Caso contrário, calcular baseado no actionType
          const results = (original as any).conversions?.[actionType] || 0;
          const lpv = Number((original as any).lpv || 0);
          currentValue = lpv > 0 ? results / lpv : null;
        }
        break;
      case "cpm":
        currentValue = typeof (original as any).cpm === "number" ? (original as any).cpm : null;
        break;
      case "cpmql":
        // CPMQL só é calculado quando há integração de planilha
        if (hasSheetIntegration) {
          const { cpmql: computedCpmql } = computeMqlMetricsFromLeadscore({
            spend: Number((original as any).spend || 0),
            leadscoreRaw: (original as any).leadscore_values,
            mqlLeadscoreMin,
          });
          // Aceitar qualquer valor finito, mesmo que seja 0 (pode ser válido)
          currentValue = Number.isFinite(computedCpmql) ? computedCpmql : null;
        } else {
          currentValue = null;
        }
        break;
    }

    if (currentValue === null || isNaN(currentValue) || !isFinite(currentValue)) {
      // Se não conseguimos extrair o valor, mostrar apenas o valor original
      return (
        <div className="flex flex-col items-center gap-3">
          <span className="text-base font-medium leading-none">{value}</span>
        </div>
      );
    }

    // Verificar se a média é válida
    // Para page_conv, avgValue pode ser 0 (nenhuma conversão), o que é válido
    if (isNaN(avgValue) || !isFinite(avgValue)) {
      return (
        <div className="flex flex-col items-center gap-3">
          <span className="text-base font-medium leading-none">{value}</span>
        </div>
      );
    }

    // Se a média for 0 e o valor atual também for 0, não há diferença para mostrar
    if (avgValue === 0 && currentValue === 0) {
      return (
        <div className="flex flex-col items-center gap-3">
          <span className="text-xs font-medium text-muted-foreground">0%</span>
          <span className="text-base font-medium leading-none">{value}</span>
        </div>
      );
    }

    // Se a média for 0 mas o valor atual não for 0
    if (avgValue === 0 && currentValue !== 0) {
      if (isInverseMetric) {
        // Para métricas inversas: valor > 0 quando média é 0 = pior (acima da média) = vermelho com "+"
        return (
          <div className="flex flex-col items-center gap-3">
            <span className="text-xs font-medium text-red-600 dark:text-red-400">+∞</span>
            <span className="text-base font-medium leading-none">{value}</span>
          </div>
        );
      } else {
        // Para métricas normais: valor > 0 quando média é 0 = melhor (acima da média) = verde com "+"
        return (
          <div className="flex flex-col items-center gap-3">
            <span className="text-xs font-medium text-green-600 dark:text-green-400">+∞</span>
            <span className="text-base font-medium leading-none">{value}</span>
          </div>
        );
      }
    }

    // Calcular diferença percentual
    // Para métricas inversas (CPR, CPM), a lógica é invertida: menor que a média é melhor
    let diffPercent: number;
    if (isInverseMetric) {
      // Para métricas inversas: se currentValue < avgValue, isso é melhor (positivo)
      // diffPercent = ((avgValue - currentValue) / avgValue) * 100
      diffPercent = ((avgValue - currentValue) / avgValue) * 100;
    } else {
      // Para métricas normais: se currentValue > avgValue, isso é melhor (positivo)
      // diffPercent = ((currentValue - avgValue) / avgValue) * 100
      diffPercent = ((currentValue - avgValue) / avgValue) * 100;
    }

    // Determinar cor baseado na diferença
    // Para métricas normais: positivo (acima da média) = verde, negativo (abaixo) = vermelho
    // Para métricas inversas: positivo (menor que média) = verde, negativo (maior que média) = vermelho
    const isPositive = diffPercent > 0;
    const colorClass = isPositive ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400";

    // Para métricas inversas, inverter o sinal exibido: quando está melhor (positivo), mostrar "-" porque está abaixo da média numericamente
    // Para métricas normais, manter o sinal original
    let sign: string;
    if (isInverseMetric) {
      // Métricas inversas: diffPercent positivo = melhor = abaixo da média numericamente = mostrar "-"
      // diffPercent negativo = pior = acima da média numericamente = mostrar "+"
      sign = isPositive ? "-" : "+";
    } else {
      // Métricas normais: diffPercent positivo = melhor = acima da média = mostrar "+"
      // diffPercent negativo = pior = abaixo da média = mostrar "-"
      sign = isPositive ? "+" : "-";
    }

    return (
      <div className="flex flex-col items-center gap-3">
        <span className={`text-xs font-medium ${colorClass}`}>
          {sign}
          {Math.abs(diffPercent).toFixed(1)}%
        </span>
        <span className="text-base font-medium leading-none">{value}</span>
      </div>
    );
  };

  // Função helper para formatar a média de uma métrica
  const formatAverage = useMemo(
    () =>
      (metricId: string): string => {
        const metricMap: Record<string, keyof RankingsAverages> = {
          hook: "hook",
          cpr: "cpr",
          cpmql: "cpmql",
          spend: "spend",
          ctr: "ctr",
          website_ctr: "website_ctr",
          cpm: "cpm",
          connect_rate: "connect_rate",
          page_conv: "page_conv",
        };

        const metricKey = metricMap[metricId];
        if (!metricKey) return "";

        const avgValue = averages[metricKey];
        if (avgValue === null || avgValue === undefined || !Number.isFinite(avgValue)) {
          return "";
        }

        // Formatar baseado no tipo de métrica
        if (metricId === "hook" || metricId === "ctr" || metricId === "website_ctr" || metricId === "connect_rate" || metricId === "page_conv") {
          // Métricas em porcentagem (decimal 0-1)
          return formatPct(Number(avgValue) * 100);
        } else {
          // Métricas monetárias (cpr, cpmql, spend, cpm)
          return formatCurrency(Number(avgValue));
        }
      },
    [averages, formatPct, formatCurrency]
  );

  const columns = useMemo(() => {
    const cols = [
      // AD name
      columnHelper.accessor("ad_name", {
        header: "AD",
        size: 140,
        minSize: 140,
        cell: (info) => {
          const original = info.row.original as RankingsItem;
          const thumbnail = getAdThumbnail(original);
          const name = String(info.getValue() || "—");
          const id = original?.ad_id;
          const adCount = original?.ad_count || 1;
          const key = getRowKey(info.row);
          const isExpanded = !!expanded[key];

          let secondLine = "";
          if (groupByAdName) {
            secondLine = adCount === 1 ? "1 anúncio" : `+ ${adCount} anúncios`;
          } else {
            secondLine = adCount === 1 ? `ID: ${id || "-"}` : `ID: ${id || "-"} (${adCount} dias)`;
          }

          const handleToggleExpand = (e?: React.MouseEvent) => {
            e?.stopPropagation();
            const next = !isExpanded;
            setExpanded((prev) => ({ ...prev, [key]: next }));
          };

          return (
            <div className="flex items-center gap-3">
              {thumbnail ? <img src={thumbnail} alt="thumb" className="w-14 h-14 object-cover rounded" /> : <div className="w-14 h-14 bg-border rounded" />}
              <div className="min-w-0">
                <div className="truncate">{name}</div>
                {groupByAdName ? (
                  <div className="mt-1">
                    <Button size="sm" variant={isExpanded ? "default" : "ghost"} onClick={handleToggleExpand} className={`h-auto py-1 px-2 text-xs ${isExpanded ? "text-primary-foreground" : "text-muted-foreground"} hover:text-text`}>
                      {isExpanded ? "- Recolher" : secondLine}
                    </Button>
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground truncate">{secondLine}</div>
                )}
              </div>
            </div>
          );
        },
      }),
      // Hook (retention at 3s)
      columnHelper.accessor("hook", {
        header: () => (
          <div className="flex flex-col items-center gap-0.5">
            <span>Hook</span>
            {formatAverage("hook") && <span className="text-xs text-muted-foreground font-normal">{formatAverage("hook")}</span>}
          </div>
        ),
        size: 140,
        minSize: 100,
        cell: (info) => {
          // Pegar hook diretamente do row.original em caso do accessor não funcionar
          const original = info.row.original as RankingsItem;
          const hookValue = info.getValue() ?? original?.hook ?? 0;
          const hookAsPct = Number(hookValue) * 100;
          return <MetricCell row={info.row.original} value={<span className="text-center inline-block w-full">{formatPct(hookAsPct)}</span>} metric="hook" />;
        },
        sortingFn: "auto",
      }),
      // CPR
      columnHelper.display({
        id: "cpr",
        header: () => (
          <div className="flex flex-col items-center gap-0.5">
            <span>CPR</span>
            {formatAverage("cpr") && <span className="text-xs text-muted-foreground font-normal">{formatAverage("cpr")}</span>}
          </div>
        ),
        size: 140,
        minSize: 100,
        cell: (info) => {
          const ad = info.row.original;
          const results = actionType ? ad.conversions?.[actionType] || 0 : 0;
          const cpr = results > 0 ? ad.spend / results : 0;
          return <MetricCell row={ad} value={<span className="text-center inline-block w-full">{formatCurrency(cpr)}</span>} metric="cpr" />;
        },
      }),
    ];

    // CPMQL só deve aparecer quando houver integração de planilha em pelo menos um pack
    if (hasSheetIntegration) {
      cols.push(
        columnHelper.display({
          id: "cpmql",
          header: () => (
            <div className="flex flex-col items-center gap-0.5">
              <span>CPMQL</span>
              {formatAverage("cpmql") && <span className="text-xs text-muted-foreground font-normal">{formatAverage("cpmql")}</span>}
            </div>
          ),
          size: 140,
          minSize: 100,
          cell: (info) => {
            const ad = info.row.original as RankingsItem;

            const spend = Number((ad as any).spend || 0);
            const { leadscoreValues, mqlCount, cpmql } = computeMqlMetricsFromLeadscore({
              spend,
              leadscoreRaw: (ad as any).leadscore_values,
              mqlLeadscoreMin,
            });

            const value = cpmql > 0 ? formatCurrency(cpmql) : "—";
            return <MetricCell row={ad} value={<span className="text-center inline-block w-full">{value}</span>} metric="cpmql" />;
          },
        })
      );
    }

    cols.push(
      // Spend
      columnHelper.accessor("spend", {
        header: () => (
          <div className="flex flex-col items-center gap-0.5">
            <span>Spend</span>
            {formatAverage("spend") && <span className="text-xs text-muted-foreground font-normal">{formatAverage("spend")}</span>}
          </div>
        ),
        size: 140,
        minSize: 100,
        cell: (info) => <MetricCell row={info.row.original} value={<span className="text-center inline-block w-full">{formatCurrency(Number(info.getValue()) || 0)}</span>} metric="spend" />,
      }) as any,
      // CTR
      columnHelper.accessor("ctr", {
        header: () => (
          <div className="flex flex-col items-center gap-0.5">
            <span>CTR</span>
            {formatAverage("ctr") && <span className="text-xs text-muted-foreground font-normal">{formatAverage("ctr")}</span>}
          </div>
        ),
        size: 140,
        minSize: 100,
        cell: (info) => <MetricCell row={info.row.original} value={<span className="text-center inline-block w-full">{formatPct(Number(info.getValue() * 100))}</span>} metric="ctr" />,
      }) as any,
      // Link CTR (Website CTR)
      columnHelper.display({
        id: "website_ctr",
        header: () => (
          <div className="flex flex-col items-center gap-0.5">
            <span>Link CTR</span>
            {formatAverage("website_ctr") && <span className="text-xs text-muted-foreground font-normal">{formatAverage("website_ctr")}</span>}
          </div>
        ),
        size: 140,
        minSize: 100,
        cell: (info) => {
          const ad = info.row.original;
          // Usar website_ctr do backend se disponível, senão calcular
          const websiteCtr = typeof (ad as any).website_ctr === "number" && !Number.isNaN((ad as any).website_ctr) && isFinite((ad as any).website_ctr) ? (ad as any).website_ctr : (ad as any).impressions > 0 ? Number((ad as any).inline_link_clicks || 0) / Number((ad as any).impressions || 0) : 0;
          return <MetricCell row={ad} value={<span className="text-center inline-block w-full">{formatPct(websiteCtr * 100)}</span>} metric="website_ctr" />;
        },
      }),
      // CPM
      columnHelper.display({
        id: "cpm",
        header: () => (
          <div className="flex flex-col items-center gap-0.5">
            <span>CPM</span>
            {formatAverage("cpm") && <span className="text-xs text-muted-foreground font-normal">{formatAverage("cpm")}</span>}
          </div>
        ),
        size: 140,
        minSize: 100,
        cell: (info) => {
          const ad = info.row.original;
          // Usar cpm do backend se disponível, senão calcular
          // cpm sempre vem do backend
          const cpm = typeof ad.cpm === "number" ? ad.cpm : 0;
          return <MetricCell row={ad} value={<span className="text-center inline-block w-full">{formatCurrency(cpm)}</span>} metric="cpm" />;
        },
      }),
      // Connect Rate
      columnHelper.accessor("connect_rate", {
        header: () => (
          <div className="flex flex-col items-center gap-0.5">
            <span>Connect Rate</span>
            {formatAverage("connect_rate") && <span className="text-xs text-muted-foreground font-normal">{formatAverage("connect_rate")}</span>}
          </div>
        ),
        size: 160,
        minSize: 120,
        cell: (info) => <MetricCell row={info.row.original} value={<span className="text-center inline-block w-full">{formatPct(Number(info.getValue() * 100))}</span>} metric="connect_rate" />,
      }) as any,
      // Page Conversion
      columnHelper.display({
        id: "page_conv",
        header: () => (
          <div className="flex flex-col items-center gap-0.5">
            <span>Page</span>
            {formatAverage("page_conv") && <span className="text-xs text-muted-foreground font-normal">{formatAverage("page_conv")}</span>}
          </div>
        ),
        size: 140,
        minSize: 100,
        cell: (info) => {
          const ad = info.row.original;
          // Se o ad já tem page_conv calculado (vem do ranking), usar esse valor
          if ("page_conv" in ad && typeof (ad as any).page_conv === "number" && !Number.isNaN((ad as any).page_conv) && isFinite((ad as any).page_conv)) {
            const pageConv = (ad as any).page_conv;
            return <MetricCell row={ad} value={<span className="text-center inline-block w-full">{formatPct(pageConv * 100)}</span>} metric="page_conv" />;
          }
          // Caso contrário, calcular baseado no actionType
          const results = actionType ? ad.conversions?.[actionType] || 0 : 0;
          const pageConv = ad.lpv > 0 ? results / ad.lpv : 0;
          return <MetricCell row={ad} value={<span className="text-center inline-block w-full">{formatPct(pageConv * 100)}</span>} metric="page_conv" />;
        },
      })
    );

    return cols;
  }, [groupByAdName, byKey, expanded, dateStart, dateStop, formatCurrency, actionType, formatPct, showTrends, averages, formatAverage, hasSheetIntegration, mqlLeadscoreMin, getRowKey]);

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    columnResizeMode: "onChange",
    initialState: {
      sorting: [{ id: "spend", desc: true }],
    },
    defaultColumn: {
      size: 120,
      minSize: 80,
    },
  });

  return (
    <div className="w-full">
      <div className="overflow-x-auto custom-scrollbar">
        <table className="w-full text-sm border-separate border-spacing-y-4">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="sticky top-0 z-10 text-text/80">
                {hg.headers.map((header) => {
                  const headerAlign = header.column.id === "ad_name" ? "text-left" : "text-center";
                  const justify = header.column.id === "ad_name" ? "justify-start" : "justify-center";
                  const fixedWidth = "";
                  return (
                    <th key={header.id} className={`text-base font-normal py-4 ${headerAlign} ${fixedWidth} relative`} style={{ width: header.getSize() }}>
                      {header.isPlaceholder ? null : (
                        <div className={`flex items-center ${justify} gap-1 ${header.column.getCanSort() ? "cursor-pointer select-none hover:text-brand" : ""} ${header.column.getIsSorted() ? "text-primary" : ""}`} onClick={header.column.getToggleSortingHandler()}>
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          <IconArrowsSort className="w-3 h-3" />
                        </div>
                      )}
                      {header.column.getCanResize() && <div onMouseDown={header.getResizeHandler()} onTouchStart={header.getResizeHandler()} className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize select-none touch-none" />}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={table.getAllColumns().length} className="p-8 text-center text-muted-foreground">
                  Nenhum dado disponível para exibir.
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row, index) => {
                const key = getRowKey(row);
                const isExpanded = !!expanded[key];
                const original = row.original as RankingsItem;
                const adName = String(original?.ad_name || "");

                return (
                  <Fragment key={row.id}>
                    <tr
                      key={`${row.id}-parent`}
                      className="bg-background hover:bg-input-30 cursor-pointer"
                      onClick={() => {
                        const original = row.original as RankingsItem;
                        setSelectedAd(original);
                      }}
                    >
                      {row.getVisibleCells().map((cell) => {
                        const cellAlign = cell.column.id === "ad_name" ? "text-left" : "text-center";
                        const fixedWidth = "";
                        const cellIndex = row.getVisibleCells().indexOf(cell);
                        const isFirst = cellIndex === 0;
                        const isLast = cellIndex === row.getVisibleCells().length - 1;
                        return (
                          <td key={cell.id} className={`p-4 ${cellAlign} ${fixedWidth} border-y border-border ${isFirst ? "rounded-l-md border-l" : ""} ${isLast ? "rounded-r-md border-r" : ""}`} style={{ width: cell.column.getSize() }}>
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </td>
                        );
                      })}
                    </tr>
                    {groupByAdName && isExpanded && adName ? <ExpandedChildrenRow row={row} adName={adName} dateStart={dateStart || ""} dateStop={dateStop || ""} actionType={actionType} formatCurrency={formatCurrency} formatPct={formatPct} /> : null}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Details Dialog */}
      <Modal isOpen={!!selectedAd} onClose={() => setSelectedAd(null)} size="4xl" padding="md">
        {selectedAd && <AdDetailsDialog ad={selectedAd} groupByAdName={groupByAdName} dateStart={dateStart} dateStop={dateStop} actionType={actionType} availableConversionTypes={availableConversionTypes} averages={averages} />}
      </Modal>

      {/* Video Dialog - Único para toda a tabela */}
      <VideoDialog
        open={videoOpen}
        onOpenChange={(open) => {
          setVideoOpen(open);
          if (!open) setSelectedVideo(null);
        }}
        videoId={selectedVideo?.videoId}
        actorId={selectedVideo?.actorId}
        title={selectedVideo?.title}
      />
    </div>
  );
}
