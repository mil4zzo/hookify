"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import { useFormatCurrency } from "@/lib/utils/currency";
import { MetricCard } from "@/components/common/MetricCard";
import { RetentionChart } from "@/components/charts/RetentionChart";
import { RetentionChartOverlay } from "@/components/charts/RetentionChartOverlay";
import { SparklineBars } from "@/components/common/SparklineBars";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAdVariations, useAdDetails, useAdCreative, useVideoSource, useAdHistory, useAdNameHistory } from "@/lib/api/hooks";
import { RankingsItem, RankingsChildrenItem } from "@/lib/api/schemas";
import { getAdThumbnail } from "@/lib/utils/thumbnailFallback";
import { MetricHistoryChart, AVAILABLE_METRICS } from "@/components/charts/MetricHistoryChart";
import { DateRangeFilter, DateRangeValue } from "@/components/common/DateRangeFilter";
import { TabbedContent, TabbedContentItem, type TabItem } from "@/components/common/TabbedContent";
import { ActionTypeFilter } from "@/components/common/ActionTypeFilter";
import { computeMqlMetricsFromLeadscore } from "@/lib/utils/mqlMetrics";
import { useMqlLeadscore } from "@/lib/hooks/useMqlLeadscore";
import { getMetricCardSurfaceClass, getMetricQualityToneByAverage, getMetricSeriesTrendPct, getMetricTrendTone, getMetricValueTextClass } from "@/lib/utils/metricQuality";
import { Play } from "lucide-react";
import { IconBrandParsinta, IconChartAreaLine, IconChartFunnel, IconCurrencyDollar, IconLayoutGrid, IconWorld } from "@tabler/icons-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface AdDetailsDialogProps {
  ad: RankingsItem;
  groupByAdName: boolean;
  dateStart?: string;
  dateStop?: string;
  actionType?: string;
  availableConversionTypes?: string[]; // Tipos de conversão disponíveis (mesmos do seletor)
  initialTab?: "conversions" | "variations" | "video" | "history"; // Aba inicial
  averages?: {
    hook: number | null;
    hold_rate?: number | null;
    video_watched_p50?: number | null;
    cpmql?: number | null;
    scroll_stop: number | null;
    ctr: number | null;
    website_ctr: number | null;
    connect_rate: number | null;
    cpm: number | null;
    cpr: number | null;
    cpc?: number | null;
    cplc?: number | null;
    page_conv: number | null;
  };
}

export function AdDetailsDialog({ ad, groupByAdName, dateStart, dateStop, actionType, availableConversionTypes = [], initialTab = "video", averages }: AdDetailsDialogProps) {
  const [activeTab, setActiveTab] = useState<"conversions" | "variations" | "video" | "history">(initialTab);
  const [shouldAutoplay, setShouldAutoplay] = useState(false);
  const [initialVideoTime, setInitialVideoTime] = useState<number | null>(null);
  const [retentionViewMode, setRetentionViewMode] = useState<"chart" | "metrics">("metrics");

  // Atualizar aba quando initialTab mudar (quando o modal é reaberto com outro anúncio)
  useEffect(() => {
    setActiveTab(initialTab);
    setShouldAutoplay(false);
    setInitialVideoTime(null); // Resetar tempo inicial quando mudar de anúncio
    setRetentionViewMode("metrics");
  }, [initialTab, ad?.ad_id]); // Resetar quando o anúncio mudar
  // Local actionType que pode ser alterado dentro do dialog sem afetar o Manager
  const [localActionType, setLocalActionType] = useState<string>(actionType || "");
  useEffect(() => {
    setLocalActionType(actionType || "");
  }, [actionType, ad?.ad_id]);

  const [selectedMetrics, setSelectedMetrics] = useState<string[]>(["spend"]);
  // Date range específico para o histórico (inicializa com o date range principal ou vazio para mostrar todos)
  const [historyDateRange, setHistoryDateRange] = useState<DateRangeValue>(() => ({
    start: dateStart,
    end: dateStop,
  }));

  const adName = String(ad?.ad_name || "");
  const adId = String(ad?.ad_id || "");
  const totalVariations = Number(ad?.ad_count ?? 0);
  const activeVariations = Number(ad?.active_count ?? totalVariations);
  const adStatus = String(ad?.effective_status || "—");
  const isAdActive = adStatus.toUpperCase() === "ACTIVE";
  const shouldLoadVariations = groupByAdName && activeTab === "variations" && !!adName && !!dateStart && !!dateStop;
  const shouldLoadDetails = activeTab === "video" && !!adId && !!dateStart && !!dateStop;
  const shouldLoadCreative = activeTab === "video" && !!adId;
  const shouldLoadHistoryById = activeTab === "history" && !groupByAdName && !!adId && !!dateStart && !!dateStop;
  const shouldLoadHistoryByName = activeTab === "history" && groupByAdName && !!adName && !!dateStart && !!dateStop;

  const { data: childrenData, isLoading: loadingChildren, refetch: loadChildren } = useAdVariations(adName, dateStart || "", dateStop || "", shouldLoadVariations);

  const { data: adDetails, isLoading: loadingAdDetails } = useAdDetails(adId, dateStart || "", dateStop || "", shouldLoadDetails);

  // Buscar creative e video_ids quando a tab de vídeo estiver ativa
  const { data: creativeData, isLoading: loadingCreative } = useAdCreative(adId, shouldLoadCreative);

  // Extrair video_id e actor_id do creative buscado
  const creative = creativeData?.creative || {};
  const videoId = creative.video_id || creativeData?.adcreatives_videos_ids?.[0];
  const actorId = creative.actor_id;
  const videoOwnerPageId = (creativeData as any)?.video_owner_page_id;
  const shouldLoadVideo = activeTab === "video" && !!videoId && !!actorId && !loadingCreative;

  const { data: videoData, isLoading: loadingVideo, error: videoError } = useVideoSource({ video_id: videoId || "", actor_id: actorId || "", ad_id: adId, video_owner_page_id: videoOwnerPageId || undefined }, shouldLoadVideo);

  const { data: historyDataById, isLoading: loadingHistoryById } = useAdHistory(adId, dateStart || "", dateStop || "", shouldLoadHistoryById);
  const { data: historyDataByName, isLoading: loadingHistoryByName } = useAdNameHistory(adName, dateStart || "", dateStop || "", shouldLoadHistoryByName);
  const loadingHistory = loadingHistoryById || loadingHistoryByName;
  const historyDataRaw = groupByAdName ? historyDataByName : historyDataById;

  // Filtrar dados históricos baseado no date range do histórico
  const historyData = useMemo(() => {
    if (!historyDataRaw?.data || historyDataRaw.data.length === 0) {
      return historyDataRaw;
    }

    // Se não há filtro de data definido, retornar todos os dados
    if (!historyDateRange.start && !historyDateRange.end) {
      return historyDataRaw;
    }

    const filtered = historyDataRaw.data.filter((item: any) => {
      const itemDate = item.date;
      if (!itemDate) return false;

      // Normalizar datas para formato YYYY-MM-DD para comparação segura
      const normalizeDate = (dateStr: string) => {
        // Se já está no formato YYYY-MM-DD, retornar direto
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
          return dateStr;
        }
        // Caso contrário, tentar extrair a parte da data
        const match = dateStr.match(/^(\d{4}-\d{2}-\d{2})/);
        return match ? match[1] : dateStr;
      };

      const itemDateNormalized = normalizeDate(itemDate);
      const startDateNormalized = historyDateRange.start ? normalizeDate(historyDateRange.start) : null;
      const endDateNormalized = historyDateRange.end ? normalizeDate(historyDateRange.end) : null;

      // Comparação de strings (YYYY-MM-DD permite comparação lexicográfica)
      if (startDateNormalized && itemDateNormalized < startDateNormalized) {
        return false;
      }

      if (endDateNormalized && itemDateNormalized > endDateNormalized) {
        return false;
      }

      return true;
    });

    return {
      ...historyDataRaw,
      data: filtered,
    };
  }, [historyDataRaw, historyDateRange]);

  const formatCurrency = useFormatCurrency();
  const formatPct = (v: number | null | undefined) => {
    if (v == null || Number.isNaN(v)) return "—";
    return `${Number(v).toFixed(2)}%`;
  };

  function getDeltaDisplay({ valueRaw, avgRaw }: { valueRaw?: number | null; avgRaw?: number | null }) {
    if (valueRaw == null || avgRaw == null || Number.isNaN(valueRaw as number) || Number.isNaN(avgRaw as number) || !isFinite(valueRaw as number) || !isFinite(avgRaw as number) || (avgRaw as number) === 0) {
      return null;
    }
    const diff = (valueRaw as number) / (avgRaw as number) - 1;
    const sign = diff >= 0 ? "+" : "";
    return `${sign}${(diff * 100).toFixed(1)}%`;
  }

  function getMetricValueTone({ valueRaw, avgRaw, better, series, inverse, colorMode, disableSeriesFallback = false }: { valueRaw?: number | null; avgRaw?: number | null; better?: "higher" | "lower"; series?: Array<number | null | undefined>; inverse?: boolean; colorMode?: "series" | "per-bar"; disableSeriesFallback?: boolean }) {
    if (valueRaw != null && avgRaw != null && better && !Number.isNaN(valueRaw) && !Number.isNaN(avgRaw) && isFinite(valueRaw) && isFinite(avgRaw) && avgRaw !== 0) {
      return getMetricQualityToneByAverage(valueRaw, avgRaw, better === "lower");
    }

    if (!disableSeriesFallback && series && series.length > 0) {
      return getMetricTrendTone(getMetricSeriesTrendPct(series), inverse ?? false);
    }

    return null;
  }

  function getMetricQualitySurfaceClass({ valueRaw, avgRaw, better, series, inverse, colorMode, disableSeriesFallback = false }: { valueRaw?: number | null; avgRaw?: number | null; better?: "higher" | "lower"; series?: Array<number | null | undefined>; inverse?: boolean; colorMode?: "series" | "per-bar"; disableSeriesFallback?: boolean }) {
    const tone = getMetricValueTone({ valueRaw, avgRaw, better, series, inverse, colorMode, disableSeriesFallback });
    return getMetricCardSurfaceClass(tone ?? "muted-foreground");
  }

  function getMetricQualityValueClass({ valueRaw, avgRaw, better, series, inverse, colorMode, disableSeriesFallback = false }: { valueRaw?: number | null; avgRaw?: number | null; better?: "higher" | "lower"; series?: Array<number | null | undefined>; inverse?: boolean; colorMode?: "series" | "per-bar"; disableSeriesFallback?: boolean }) {
    const tone = getMetricValueTone({ valueRaw, avgRaw, better, series, inverse, colorMode, disableSeriesFallback });
    return tone ? getMetricValueTextClass(tone) : "";
  }

  function VideoMetricCell({
    label,
    value,
    deltaDisplay,
    subtitle,
    subtitleInLabelRow = false,
    averageDisplay,
    averageTooltip,
    series: cellSeries,
    inverse,
    formatFn,
    valueRaw,
    avgRaw,
    better,
    packAverage,
    colorMode,
    disableSeriesFallback = false,
  }: {
    label: string;
    value: React.ReactNode;
    deltaDisplay?: React.ReactNode;
    subtitle?: React.ReactNode;
    /** Se true, renderiza o subtitle na mesma linha do label (lado direito) */
    subtitleInLabelRow?: boolean;
    averageDisplay?: React.ReactNode;
    averageTooltip?: string;
    series?: Array<number | null | undefined>;
    inverse?: boolean;
    formatFn?: (n: number) => string;
    valueRaw?: number | null;
    avgRaw?: number | null;
    better?: "higher" | "lower";
    packAverage?: number | null;
    colorMode?: "series" | "per-bar";
    disableSeriesFallback?: boolean;
  }) {
    const hasSeries = cellSeries && cellSeries.length > 0 && cellSeries.some((v) => v != null && !Number.isNaN(v as number));
    const qualitySurfaceClass = getMetricQualitySurfaceClass({ valueRaw, avgRaw, better, series: cellSeries, inverse, colorMode, disableSeriesFallback });
    const qualityValueClass = getMetricQualityValueClass({ valueRaw, avgRaw, better, series: cellSeries, inverse, colorMode, disableSeriesFallback });
    const hasHeaderMeta = Boolean(subtitleInLabelRow && subtitle);

    return (
      <div className={`rounded border pb-2 transition-colors transition-shadow ${qualitySurfaceClass}`}>
        <div className={`p-2 mb-2 border-b border-border flex gap-2 text-[10px] text-muted-foreground ${hasHeaderMeta ? "items-center justify-between" : "flex-col"}`}>
          <span className={hasHeaderMeta ? "min-w-0 truncate" : ""}>{label}</span>
          {hasHeaderMeta ? <div className="min-w-0 flex flex-col items-end text-right leading-tight">{subtitleInLabelRow && subtitle ? <span className="truncate">{subtitle}</span> : null}</div> : null}
          {!subtitleInLabelRow && subtitle ? <span className="mt-0.5">{subtitle}</span> : null}
        </div>
        <div className="px-2 flex items-center justify-between gap-3">
          <div className="min-w-0 flex flex-col items-start text-left">
            <div className={`text-md font-semibold leading-tight ${qualityValueClass}`.trim()}>{value}</div>
            {averageDisplay ? (
              <div className="mt-0.5 text-left text-[10px] leading-tight text-muted-foreground">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-block cursor-help text-muted-foreground">{`vs. ${averageDisplay}`}</span>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{averageTooltip ?? `${label} medio`}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            ) : null}
          </div>
          {deltaDisplay ? <div className="shrink-0 text-xs text-muted-foreground">{deltaDisplay}</div> : null}
        </div>
        {hasSeries && (
          <div className="w-full mt-2 px-2">
            <SparklineBars series={cellSeries} size="small" className="w-full h-5" valueFormatter={formatFn} inverseColors={inverse} packAverage={packAverage} colorMode={colorMode} />
          </div>
        )}
      </div>
    );
  }

  function MetricSection({ title, children, contentBeforeChildren, headerAction }: { title: string; children: React.ReactNode; contentBeforeChildren?: React.ReactNode; headerAction?: React.ReactNode }) {
    const sectionIconMap = {
      Retenção: IconBrandParsinta,
      Funil: IconChartFunnel,
      Custos: IconCurrencyDollar,
      Visibilidade: IconWorld,
    } as const;

    const SectionIcon = sectionIconMap[title as keyof typeof sectionIconMap];

    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3 text-sm font-semibold text-muted-foreground">
          <div className="flex items-center gap-1.5">
            {SectionIcon ? <SectionIcon className="h-4 w-4 flex-shrink-0" /> : null}
            <span>{title}</span>
          </div>
          {headerAction}
        </div>
        {contentBeforeChildren}
        {children ? <div className="grid grid-cols-4 gap-3">{children}</div> : null}
      </div>
    );
  }

  function VideoMetricSkeletonCard({ showInlineSubtitle = false }: { showInlineSubtitle?: boolean }) {
    return (
      <div className="rounded border border-border p-2">
        {showInlineSubtitle ? (
          <div className="mb-1 flex items-center justify-between gap-2">
            <Skeleton className="h-2.5 w-14" />
            <Skeleton className="h-2.5 w-16" />
          </div>
        ) : (
          <Skeleton className="mb-1 h-2.5 w-14" />
        )}
        <Skeleton className="h-5 w-20" />
        {!showInlineSubtitle && <Skeleton className="mt-1 h-2.5 w-16" />}
        <Skeleton className="mt-1.5 h-5 w-full rounded-sm" />
      </div>
    );
  }

  function VideoSectionSkeleton({ rowCount = 4, showInlineSubtitle = false }: { rowCount?: number; showInlineSubtitle?: boolean }) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-1.5">
          <Skeleton className="h-4 w-4 rounded-sm" />
          <Skeleton className="h-3 w-20" />
        </div>
        <div className="grid grid-cols-4 gap-3">
          {Array.from({ length: rowCount }).map((_, index) => (
            <VideoMetricSkeletonCard key={index} showInlineSubtitle={showInlineSubtitle} />
          ))}
        </div>
      </div>
    );
  }

  function VideoTabSkeleton({ showConversionFilter }: { showConversionFilter: boolean }) {
    return (
      <div className="flex flex-col md:flex-row gap-4 md:gap-8">
        <VideoPlayerSkeleton className="ml-8" />

        <div className="flex-1 overflow-y-auto min-h-0 flex flex-col gap-4 justify-between">
          {showConversionFilter && (
            <div className="space-y-1.5">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-10 w-full max-w-xs rounded-md" />
            </div>
          )}

          <VideoSectionSkeleton />
          <VideoSectionSkeleton />
          <VideoSectionSkeleton showInlineSubtitle />
          <VideoSectionSkeleton />
        </div>
      </div>
    );
  }

  function VideoPlayerSkeleton({ className = "" }: { className?: string }) {
    const axisTicks = [
      { label: "100%", value: 100 },
      { label: "80%", value: 80 },
      { label: "60%", value: 60 },
      { label: "40%", value: 40 },
      { label: "20%", value: 20 },
      { label: "0%", value: 0 },
    ];

    return (
      <div className={`relative w-full md:max-w-[20rem] max-w-full overflow-visible ${className}`.trim()} style={{ aspectRatio: "9/16" }}>
        <div className="absolute left-[-2rem] top-0 bottom-[48px] pr-2 md:bottom-[80px] z-10 w-6 pointer-events-none">
          {axisTicks.map(({ label, value }) => (
            <span
              key={label}
              className="absolute right-0 block text-right text-[10px] font-normal leading-none"
              style={{
                top: `${100 - value}%`,
                transform: "translateY(0.33em);translateX(0.1rem)",
                color: "oklch(0.705 0.015 286.067)",
              }}
            >
              {label}
            </span>
          ))}
        </div>

        <div className="relative h-full w-full overflow-hidden rounded-lg">
          <Skeleton className="h-full w-full rounded-lg" />
        </div>

        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="flex items-center justify-center rounded-full bg-muted p-4">
            <Play className="h-9 w-9 fill-border text-border" strokeWidth={1.4} />
          </div>
        </div>
      </div>
    );
  }

  // Mapa de conversões do ad (objeto original do servidor contendo todos os tipos)
  const conversionsMap: Record<string, number> = useMemo(() => {
    const c = ad?.conversions;
    if (!c || typeof c !== "object" || Array.isArray(c)) {
      return {};
    }
    // Retornar todos os valores do objeto original (podem ser 0)
    const result: Record<string, number> = {};
    for (const [key, value] of Object.entries(c)) {
      const numValue = Number(value);
      if (key && !Number.isNaN(numValue) && isFinite(numValue)) {
        result[key] = numValue;
      }
    }
    return result;
  }, [ad]);

  // Obter todos os tipos de conversão disponíveis (priorizar availableConversionTypes, senão usar os do ad)
  const allConversionTypes = useMemo(() => {
    if (availableConversionTypes && availableConversionTypes.length > 0) {
      return availableConversionTypes;
    }
    // Fallback: extrair tipos únicos das conversões do ad e das variações
    const types = new Set<string>();
    // Do ad atual
    if (ad?.conversions && typeof ad.conversions === "object" && !Array.isArray(ad.conversions)) {
      Object.keys(ad.conversions).forEach((key) => {
        if (key && key.trim()) types.add(key);
      });
    }
    // Das variações (childrenData)
    if (childrenData && Array.isArray(childrenData)) {
      childrenData.forEach((child) => {
        if (child.conversions && typeof child.conversions === "object" && !Array.isArray(child.conversions)) {
          Object.keys(child.conversions).forEach((key) => {
            if (key && key.trim()) types.add(key);
          });
        }
      });
    }
    return Array.from(types).sort();
  }, [availableConversionTypes, ad?.conversions, childrenData]);

  const resultsForActionType = useMemo(() => {
    if (!localActionType) return 0;
    return Number(conversionsMap[localActionType] || 0);
  }, [conversionsMap, localActionType]);

  // CPR: usar o valor já calculado do ranking se disponível, senão calcular
  const cpr = useMemo(() => {
    // Se o ad já tem CPR calculado (vem do ranking), usar esse valor
    if ("cpr" in ad && typeof (ad as any).cpr === "number" && (ad as any).cpr > 0) {
      return (ad as any).cpr;
    }
    // Caso contrário, calcular baseado no actionType
    if (!resultsForActionType) return 0;
    const spend = Number(ad?.spend || 0);
    return spend / resultsForActionType;
  }, [ad, resultsForActionType]);

  // Determinar se deve mostrar CPR (se há valor calculado ou se há results para o actionType)
  const hasCpr = useMemo(() => {
    return ("cpr" in ad && typeof (ad as any).cpr === "number" && (ad as any).cpr > 0) || resultsForActionType > 0;
  }, [ad, resultsForActionType]);

  const lpv = Number(ad?.lpv || 0);
  const pageConv = useMemo(() => {
    // Se o ad já tem page_conv calculado (vem do ranking), usar esse valor
    if ("page_conv" in ad && typeof (ad as any).page_conv === "number" && !Number.isNaN((ad as any).page_conv) && isFinite((ad as any).page_conv)) {
      return (ad as any).page_conv;
    }
    // Caso contrário, calcular baseado no actionType
    if (!lpv || !resultsForActionType) return 0;
    return resultsForActionType / lpv;
  }, [ad, lpv, resultsForActionType]);

  // cpm e website_ctr sempre vêm do backend
  const cpm = useMemo(() => {
    return typeof ad?.cpm === "number" && !Number.isNaN(ad.cpm) && isFinite(ad.cpm) ? ad.cpm : 0;
  }, [ad?.cpm]);

  const cpc = useMemo(() => {
    const spend = Number(ad?.spend || 0);
    const clicks = Number(ad?.clicks || 0);
    return clicks > 0 ? spend / clicks : 0;
  }, [ad?.spend, ad?.clicks]);

  const hasCpc = useMemo(() => Number(ad?.clicks || 0) > 0, [ad?.clicks]);

  const cplc = useMemo(() => {
    const spend = Number(ad?.spend || 0);
    const inlineLinkClicks = Number((ad as any)?.inline_link_clicks || 0);
    return inlineLinkClicks > 0 ? spend / inlineLinkClicks : 0;
  }, [ad?.spend, (ad as any)?.inline_link_clicks]);

  const hasCplc = useMemo(() => Number((ad as any)?.inline_link_clicks || 0) > 0, [(ad as any)?.inline_link_clicks]);

  const websiteCtr = useMemo(() => {
    return typeof (ad as any)?.website_ctr === "number" && !Number.isNaN((ad as any).website_ctr) && isFinite((ad as any).website_ctr) ? (ad as any).website_ctr : 0;
  }, [ad]);

  // MQL / CPMQL
  const { mqlLeadscoreMin } = useMqlLeadscore();
  const mqlMetrics = useMemo(() => {
    return computeMqlMetricsFromLeadscore({
      spend: Number(ad?.spend || 0),
      leadscoreRaw: (ad as any)?.leadscore_values,
      mqlLeadscoreMin,
    });
  }, [ad?.spend, (ad as any)?.leadscore_values, mqlLeadscoreMin]);

  // Calcular séries dinâmicas (cpr, cpc, cplc e page_conv)
  const series = useMemo(() => {
    const baseSeries = ad?.series;
    if (!baseSeries) return baseSeries;

    const spendSeries = baseSeries.spend || [];
    const clicksSeries = (baseSeries as any).clicks || [];
    const inlineLinkClicksSeries = (baseSeries as any).inline_link_clicks || [];
    const lpvSeries = baseSeries.lpv || [];
    const cpc_series = spendSeries.map((spendDay: number | null, idx: number) => {
      const spend = Number(spendDay || 0);
      const clicksDay = Number(clicksSeries[idx] || 0);
      return clicksDay > 0 ? spend / clicksDay : null;
    });
    const cplc_series = spendSeries.map((spendDay: number | null, idx: number) => {
      const spend = Number(spendDay || 0);
      const inlineLinkClicksDay = Number(inlineLinkClicksSeries[idx] || 0);
      return inlineLinkClicksDay > 0 ? spend / inlineLinkClicksDay : null;
    });

    // Se não há actionType ou não há conversions, retornar série base com CPC/CPLC calculados
    if (!localActionType || !baseSeries.conversions) {
      return {
        ...baseSeries,
        cpc: cpc_series,
        cplc: cplc_series,
      } as any;
    }

    // Calcular results por dia para o action_type selecionado
    const resultsSeries = baseSeries.conversions.map((dayConversions: Record<string, number>) => {
      return dayConversions[localActionType] || 0;
    });

    const page_conv_series = resultsSeries.map((resultsDay: number, idx: number) => {
      const lpvDay = lpvSeries[idx] || 0;
      return lpvDay > 0 ? resultsDay / lpvDay : null;
    });

    const cpr_series = resultsSeries.map((resultsDay: number, idx: number) => {
      const spendDay = spendSeries[idx] || 0;
      return resultsDay > 0 ? spendDay / resultsDay : null;
    });

    return {
      ...baseSeries,
      cpc: cpc_series,
      cplc: cplc_series,
      cpr: cpr_series,
      page_conv: page_conv_series,
    } as any;
  }, [ad?.series, localActionType]);

  // Retenção de vídeo (array 0..100 por segundo) - priorizar do ad (já vem do ranking agregado)
  const retentionSeries: number[] = useMemo(() => {
    // Priorizar do ad (já vem agregado do ranking, ponderado por plays)
    const fromAd = (ad as any)?.video_play_curve_actions as number[] | undefined;
    if (Array.isArray(fromAd) && fromAd.length > 0) {
      return fromAd.map((v) => Number(v || 0));
    }
    // Fallback: buscar via useAdDetails se não tiver no ad
    const fromDetails = (adDetails as any)?.video_play_curve_actions as number[] | undefined;
    if (Array.isArray(fromDetails) && fromDetails.length > 0) {
      return fromDetails.map((v) => Number(v || 0));
    }
    return [];
  }, [ad, adDetails]);

  // Calcular scroll_stop a partir da curva de retenção (índice 1)
  const scrollStop = useMemo(() => {
    if (retentionSeries && retentionSeries.length > 1) {
      // A curva vem em porcentagem (0-100), então dividimos por 100 para converter para decimal (0-1)
      return retentionSeries[1] / 100;
    }
    return 0;
  }, [retentionSeries]);

  // video_watched_p50 - priorizar do ad (já vem do ranking agregado)
  const videoWatchedP50 = useMemo(() => {
    // Priorizar do ad (já vem agregado do ranking, ponderado por plays)
    const fromAd = (ad as any)?.video_watched_p50 as number | undefined;
    if (fromAd != null && !Number.isNaN(fromAd)) {
      return Number(fromAd);
    }
    // Fallback: buscar via useAdDetails se não tiver no ad
    const fromDetails = (adDetails as any)?.video_watched_p50 as number | undefined;
    if (fromDetails != null && !Number.isNaN(fromDetails)) {
      return Number(fromDetails);
    }
    return undefined;
  }, [ad, adDetails]);

  const isRetentionLoadingForVideo = activeTab === "video" && loadingAdDetails && retentionSeries.length === 0;

  const handleLoadChildren = () => {
    setActiveTab("variations");
    // Forçar refetch se ainda não há dados
    if (!childrenData && !loadingChildren) {
      loadChildren();
    }
  };

  // Handler para quando um ponto do gráfico de retenção é clicado
  const handleRetentionPointClick = (second: number) => {
    setInitialVideoTime(second);
    setActiveTab("video");
    setShouldAutoplay(false); // Não autoplay quando vem do gráfico
  };

  const statusDotClass = groupByAdName ? (activeVariations > 0 ? "bg-success" : "bg-muted") : (isAdActive ? "bg-success" : "bg-muted");

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start gap-4">
        {(() => {
          const thumbnail = getAdThumbnail(ad);
          return thumbnail ? <img src={thumbnail} alt="thumb" className="w-20 h-20 rounded object-cover" /> : <div className="w-20 h-20 rounded bg-border" />;
        })()}
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-semibold truncate">{ad?.ad_name || "—"}</h2>
          <div className="mt-1 flex flex-col gap-1 text-sm text-muted-foreground">
            {groupByAdName ? (
              <div className="flex items-center gap-1.5">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDotClass}`} aria-hidden />
                <span>{`Status: ${activeVariations} / ${totalVariations} ativos`}</span>
              </div>
            ) : (
              <>
                <div>{`Ad ID: ${adId || "—"}`}</div>
                <div className="flex items-center gap-1.5">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDotClass}`} aria-hidden />
                  <span>{`Status: ${adStatus}`}</span>
                </div>
              </>
            )}
          </div>
          <div className="mt-1">{groupByAdName ? <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">Agrupado</span> : <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">Individual</span>}</div>
        </div>
      </div>

      {/* Tabs */}
      <TabbedContent
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as typeof activeTab)}
        variant="with-controls"
        tabs={[{ value: "video", label: "Geral" }, { value: "history", label: "Histórico" }, { value: "conversions", label: "Conversões" }, ...(groupByAdName ? [{ value: "variations", label: "Variações" }] : [])]}
        tabsContainerClassName="mb-6"
        controls={
          allConversionTypes.length > 0 ? (
            <div className="flex items-center gap-2 min-w-0">
              <div className="text-sm font-semibold text-muted-foreground whitespace-nowrap">Evento de conversão</div>
              <div className="w-full max-w-xs min-w-[220px]">
                <ActionTypeFilter label="" value={localActionType} onChange={setLocalActionType} options={allConversionTypes} placeholder="Evento de Conversão" />
              </div>
            </div>
          ) : null
        }
      >
        <TabbedContentItem value="conversions" variant="simple">
          <div className="space-y-2">
            {allConversionTypes.length === 0 ? (
              <div className="text-sm text-muted-foreground">Sem dados de conversão.</div>
            ) : (
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="py-2">Tipo</th>
                    <th className="py-2 text-right">Conversões</th>
                    <th className="py-2 text-right">CPR</th>
                  </tr>
                </thead>
                <tbody>
                  {allConversionTypes.map((type) => {
                    const v = Number(conversionsMap[type] || 0);
                    const spend = Number(ad?.spend || 0);
                    const cprType = v > 0 && spend > 0 && !Number.isNaN(spend) ? spend / v : null;
                    const isSelected = localActionType && type === localActionType;
                    return (
                      <tr key={type} className={isSelected ? "bg-muted" : ""}>
                        <td className="py-2 pr-2">{type}</td>
                        <td className="py-2 pr-2 text-right">{v.toLocaleString("pt-BR")}</td>
                        <td className="py-2 pr-2 text-right">{cprType && cprType > 0 && !Number.isNaN(cprType) && isFinite(cprType) ? formatCurrency(cprType) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </TabbedContentItem>

        {groupByAdName && (
          <TabbedContentItem value="variations" variant="simple">
            <div className="space-y-2">
              {loadingChildren ? (
                <div className="text-sm text-muted-foreground">Carregando variações...</div>
              ) : !childrenData || childrenData.length === 0 ? (
                <div className="flex items-center justify-between">
                  <div className="text-sm text-muted-foreground">{childrenData?.length === 0 ? "Sem variações no período." : "Clique para carregar variações desse anúncio agrupado."}</div>
                  {!childrenData && (
                    <Button size="sm" onClick={handleLoadChildren} disabled={loadingChildren}>
                      {loadingChildren ? "Carregando..." : "Carregar"}
                    </Button>
                  )}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-border">
                        <th className="p-2 text-left">Ad ID</th>
                        <th className="p-2 text-right">Hook</th>
                        <th className="p-2 text-right">CPR</th>
                        <th className="p-2 text-right">Spend</th>
                        <th className="p-2 text-right">CTR</th>
                        <th className="p-2 text-right">CPM</th>
                        <th className="p-2 text-right">Connect</th>
                        <th className="p-2 text-right">Page</th>
                      </tr>
                    </thead>
                    <tbody>
                      {childrenData.map((child: RankingsChildrenItem) => {
                        const lpvC = Number(child.lpv || 0);
                        const spendC = Number(child.spend || 0);
                        const impressionsC = Number(child.impressions || 0);
                        const conversionsC = child.conversions || {};
                        // Calcular resultsC: usar localActionType se disponível, senão somar todas as conversões
                        let resultsC = 0;
                        if (localActionType && typeof localActionType === "string" && localActionType.trim()) {
                          resultsC = Number(conversionsC[localActionType] || 0);
                        } else {
                          // Se não há localActionType, somar todas as conversões disponíveis
                          resultsC = Object.values(conversionsC).reduce((sum, val) => {
                            const numVal = Number(val || 0);
                            return sum + (Number.isNaN(numVal) ? 0 : numVal);
                          }, 0);
                        }
                        const pageConvC = lpvC > 0 && resultsC > 0 ? resultsC / lpvC : 0;
                        const cprC = resultsC > 0 && spendC > 0 ? spendC / resultsC : 0;
                        // cpm sempre vem do backend
                        const cpmC = typeof child.cpm === "number" ? child.cpm : 0;
                        return (
                          <tr key={child.ad_id} className="hover:bg-muted">
                            <td className="p-2 text-left">
                              <div className="flex items-center gap-2">
                                {(() => {
                                  const thumb = getAdThumbnail(child);
                                  return thumb ? <img src={thumb} alt="thumb" className="w-8 h-8 object-cover rounded" /> : <div className="w-8 h-8 bg-border rounded" />;
                                })()}
                                <div className="truncate">{child.ad_id}</div>
                              </div>
                            </td>
                            <td className="p-2 text-right">{formatPct(Number(child.hook * 100))}</td>
                            <td className="p-2 text-right">{cprC > 0 ? formatCurrency(cprC) : "—"}</td>
                            <td className="p-2 text-right">{formatCurrency(spendC)}</td>
                            <td className="p-2 text-right">{formatPct(Number(child.ctr * 100))}</td>
                            <td className="p-2 text-right">{formatCurrency(cpmC)}</td>
                            <td className="p-2 text-right">{formatPct(Number(child.connect_rate * 100))}</td>
                            <td className="p-2 text-right">{pageConvC > 0 ? formatPct(Number(pageConvC * 100)) : "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </TabbedContentItem>
        )}

        <TabbedContentItem value="video" variant="simple">
          <div className="space-y-4">
            {loadingCreative ? (
              <VideoTabSkeleton showConversionFilter={allConversionTypes.length > 0} />
            ) : !videoId || !actorId ? (
              <div className="text-sm text-muted-foreground p-6 text-center">Vídeo não disponível para este anúncio.</div>
            ) : (
              <div className="flex flex-col md:flex-row gap-4 md:gap-8">
                {/* Player de vídeo */}
                <div className="w-full rounded-lg flex items-center justify-center md:max-w-[20rem] max-w-full ml-8" style={{ aspectRatio: "9/16" }}>
                  {loadingVideo && <VideoPlayerSkeleton />}
                  {videoError && <div className="text-sm text-destructive p-6">Falha ao carregar o vídeo. Tente novamente mais tarde.</div>}
                  {!loadingVideo && !videoError && (videoData as any)?.source_url && <VideoPlayer src={(videoData as any).source_url} autoplay={shouldAutoplay} initialTime={initialVideoTime} onTimeSet={() => setInitialVideoTime(null)} retentionCurve={retentionSeries} showRetentionLoadingOverlay={isRetentionLoadingForVideo} />}
                  {!loadingVideo && !videoError && !(videoData as any)?.source_url && <div className="text-sm text-muted-foreground p-6">URL do vídeo não disponível.</div>}
                </div>

                {/* Métricas em seções */}
                <div className="flex-1 overflow-y-auto min-h-0 flex flex-col gap-4 justify-between">
                  {/* Retenção */}
                  <MetricSection
                    title="Retenção"
                    headerAction={
                      <TooltipProvider>
                        <div className="flex rounded-lg border border-input bg-background" role="group" aria-label="Modo de visualização da retenção">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button variant={retentionViewMode === "chart" ? "secondary" : "ghost"} size="sm" onClick={() => setRetentionViewMode("chart")} className="h-8 px-2.5 rounded-md" aria-label="Visualização do gráfico de retenção" aria-pressed={retentionViewMode === "chart"}>
                                <IconChartAreaLine className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="text-xs">Visualização do gráfico</p>
                            </TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button variant={retentionViewMode === "metrics" ? "secondary" : "ghost"} size="sm" onClick={() => setRetentionViewMode("metrics")} className="h-8 px-2.5 rounded-md" aria-label="Visualização dos cards de retenção" aria-pressed={retentionViewMode === "metrics"}>
                                <IconLayoutGrid className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="text-xs">Visualização dos cards</p>
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      </TooltipProvider>
                    }
                    contentBeforeChildren={retentionViewMode === "chart" && retentionSeries && retentionSeries.length > 0 ? <RetentionChart videoPlayCurve={retentionSeries} videoWatchedP50={videoWatchedP50} showTitle={false} chartHeightClassName="h-52" averagesHook={averages?.hook ?? null} averagesScrollStop={averages?.scroll_stop ?? null} hookValue={ad?.hook != null ? Number(ad.hook) : null} onPointClick={handleRetentionPointClick} /> : null}
                  >
                    {retentionViewMode === "metrics" && (
                      <>
                        <VideoMetricCell label="Scroll Stop" value={formatPct(scrollStop * 100)} deltaDisplay={getDeltaDisplay({ valueRaw: scrollStop, avgRaw: averages?.scroll_stop ?? null })} averageDisplay={averages?.scroll_stop != null ? formatPct(averages.scroll_stop * 100) : undefined} averageTooltip="Scroll Stop medio" series={series?.scroll_stop} formatFn={(n: number) => formatPct(n * 100)} valueRaw={scrollStop} avgRaw={averages?.scroll_stop ?? null} better="higher" packAverage={averages?.scroll_stop ?? null} />
                        <VideoMetricCell label="Hook" value={formatPct(Number(ad?.hook * 100))} deltaDisplay={getDeltaDisplay({ valueRaw: Number(ad?.hook ?? 0), avgRaw: averages?.hook ?? null })} averageDisplay={averages?.hook != null ? formatPct(averages.hook * 100) : undefined} averageTooltip="Hook medio" series={series?.hook} formatFn={(n: number) => formatPct(n * 100)} valueRaw={Number(ad?.hook ?? 0)} avgRaw={averages?.hook ?? null} better="higher" packAverage={averages?.hook ?? null} />
                        <VideoMetricCell label="Hold Rate" value={(ad as any)?.hold_rate != null ? formatPct(Number((ad as any).hold_rate) * 100) : "—"} deltaDisplay={getDeltaDisplay({ valueRaw: (ad as any)?.hold_rate != null ? Number((ad as any).hold_rate) : null, avgRaw: averages?.hold_rate ?? null })} averageDisplay={averages?.hold_rate != null ? formatPct(averages.hold_rate * 100) : undefined} averageTooltip="Hold Rate medio" series={series?.hold_rate} formatFn={(n: number) => formatPct(n * 100)} valueRaw={(ad as any)?.hold_rate != null ? Number((ad as any).hold_rate) : null} avgRaw={averages?.hold_rate ?? null} better="higher" packAverage={averages?.hold_rate ?? null} />
                        <VideoMetricCell label="50% View" value={videoWatchedP50 != null ? `${videoWatchedP50}%` : "—"} deltaDisplay={getDeltaDisplay({ valueRaw: videoWatchedP50 ?? null, avgRaw: averages?.video_watched_p50 ?? null })} averageDisplay={averages?.video_watched_p50 != null ? `${Math.round(averages.video_watched_p50)}%` : undefined} averageTooltip="50% View medio" series={series?.video_watched_p50} formatFn={(n: number) => `${Math.round(n)}%`} valueRaw={videoWatchedP50 ?? null} avgRaw={averages?.video_watched_p50 ?? null} better="higher" packAverage={averages?.video_watched_p50 ?? null} />
                      </>
                    )}
                  </MetricSection>

                  {/* Funil */}
                  <MetricSection title="Funil">
                    <VideoMetricCell label="CTR" value={formatPct(Number(ad?.ctr * 100))} deltaDisplay={getDeltaDisplay({ valueRaw: Number(ad?.ctr ?? 0), avgRaw: averages?.ctr ?? null })} averageDisplay={averages?.ctr != null ? formatPct(averages.ctr * 100) : undefined} averageTooltip="CTR medio" series={series?.ctr} formatFn={(n: number) => formatPct(n * 100)} valueRaw={Number(ad?.ctr ?? 0)} avgRaw={averages?.ctr ?? null} better="higher" packAverage={averages?.ctr ?? null} />
                    <VideoMetricCell label="Link CTR" value={formatPct(Number(websiteCtr * 100))} deltaDisplay={getDeltaDisplay({ valueRaw: websiteCtr, avgRaw: averages?.website_ctr ?? null })} averageDisplay={averages?.website_ctr != null ? formatPct(averages.website_ctr * 100) : undefined} averageTooltip="Link CTR medio" series={(series as any)?.website_ctr} formatFn={(n: number) => formatPct(n * 100)} valueRaw={websiteCtr} avgRaw={averages?.website_ctr ?? null} better="higher" packAverage={averages?.website_ctr ?? null} />
                    <VideoMetricCell label="Connect Rate" value={formatPct(Number(ad?.connect_rate * 100))} deltaDisplay={getDeltaDisplay({ valueRaw: Number(ad?.connect_rate ?? 0), avgRaw: averages?.connect_rate ?? null })} averageDisplay={averages?.connect_rate != null ? formatPct(averages.connect_rate * 100) : undefined} averageTooltip="Connect Rate medio" series={series?.connect_rate} formatFn={(n: number) => formatPct(n * 100)} valueRaw={Number(ad?.connect_rate ?? 0)} avgRaw={averages?.connect_rate ?? null} better="higher" packAverage={averages?.connect_rate ?? null} />
                    <VideoMetricCell label="Page Conv" value={formatPct(Number(pageConv * 100))} deltaDisplay={getDeltaDisplay({ valueRaw: Number(pageConv ?? 0), avgRaw: averages?.page_conv ?? null })} averageDisplay={averages?.page_conv != null ? formatPct(averages.page_conv * 100) : undefined} averageTooltip="Page Conv medio" series={(series as any)?.page_conv} formatFn={(n: number) => formatPct(n * 100)} valueRaw={Number(pageConv ?? 0)} avgRaw={averages?.page_conv ?? null} better="higher" packAverage={averages?.page_conv ?? null} />
                  </MetricSection>

                  {/* Métricas */}
                  <MetricSection title="Custos">
                    <VideoMetricCell label="CPMQL" value={mqlMetrics.cpmql > 0 ? formatCurrency(mqlMetrics.cpmql) : "—"} deltaDisplay={getDeltaDisplay({ valueRaw: mqlMetrics.cpmql > 0 ? mqlMetrics.cpmql : null, avgRaw: averages?.cpmql ?? null })} subtitle={`${mqlMetrics.mqlCount} MQLs`} subtitleInLabelRow averageDisplay={averages?.cpmql != null ? formatCurrency(averages.cpmql) : undefined} averageTooltip="CPMQL medio" series={(series as any)?.cpmql} inverse formatFn={(n: number) => formatCurrency(n)} valueRaw={mqlMetrics.cpmql > 0 ? mqlMetrics.cpmql : null} avgRaw={averages?.cpmql ?? null} better="lower" packAverage={averages?.cpmql ?? null} />
                    <VideoMetricCell label="CPR" value={hasCpr ? formatCurrency(cpr) : "—"} deltaDisplay={getDeltaDisplay({ valueRaw: hasCpr ? cpr : null, avgRaw: averages?.cpr ?? null })} subtitle={`${resultsForActionType} results`} subtitleInLabelRow averageDisplay={averages?.cpr != null ? formatCurrency(averages.cpr) : undefined} averageTooltip="CPR medio" series={(series as any)?.cpr} inverse formatFn={(n: number) => formatCurrency(n)} valueRaw={hasCpr ? cpr : null} avgRaw={averages?.cpr ?? null} better="lower" packAverage={averages?.cpr ?? null} />
                    <VideoMetricCell label="CPC" value={hasCpc ? formatCurrency(cpc) : "—"} deltaDisplay={getDeltaDisplay({ valueRaw: hasCpc ? cpc : null, avgRaw: averages?.cpc ?? null })} subtitle={`${Number(ad?.clicks || 0).toLocaleString("pt-BR")} clicks`} subtitleInLabelRow averageDisplay={averages?.cpc != null ? formatCurrency(averages.cpc) : undefined} averageTooltip="CPC medio" series={(series as any)?.cpc} inverse formatFn={(n: number) => formatCurrency(n)} valueRaw={hasCpc ? cpc : null} avgRaw={averages?.cpc ?? null} better="lower" packAverage={averages?.cpc ?? null} />
                    <VideoMetricCell label="CPM" value={formatCurrency(cpm)} deltaDisplay={getDeltaDisplay({ valueRaw: cpm, avgRaw: averages?.cpm ?? null })} averageDisplay={averages?.cpm != null ? formatCurrency(averages.cpm) : undefined} averageTooltip="CPM medio" series={(series as any)?.cpm} inverse formatFn={(n: number) => formatCurrency(n)} valueRaw={cpm} avgRaw={averages?.cpm ?? null} better="lower" packAverage={averages?.cpm ?? null} />
                  </MetricSection>

                  {/* Absolutas (sem sparklines) */}
                  <MetricSection title="Visibilidade">
                    <VideoMetricCell label="Spend" value={formatCurrency(Number(ad?.spend || 0))} series={series?.spend} formatFn={(n: number) => formatCurrency(n)} colorMode="series" disableSeriesFallback />
                    <VideoMetricCell label="Frequency" value={(ad as any)?.frequency != null ? Number((ad as any).frequency).toFixed(2) : "—"} />
                    <VideoMetricCell label="Impressions" value={Number(ad?.impressions || 0).toLocaleString("pt-BR")} />
                    <VideoMetricCell label="Reach" value={(ad as any)?.reach != null ? Number((ad as any).reach).toLocaleString("pt-BR") : "—"} />
                  </MetricSection>
                </div>
              </div>
            )}
          </div>
        </TabbedContentItem>

        <TabbedContentItem value="history" variant="simple">
          <div className="flex flex-col h-full min-h-0">
            <div className="flex items-center justify-between mb-4 flex-shrink-0">
              <div className="text-lg font-semibold">Evolução Histórica</div>
              <DateRangeFilter label="Filtrar período" value={historyDateRange} onChange={setHistoryDateRange} className="w-auto" showLabel={false} />
            </div>

            {loadingHistory ? (
              <div className="flex-1 min-h-0 flex gap-12">
                {/* Skeleton do seletor de métricas */}
                <div className="flex-shrink-0 w-48 flex flex-col gap-4">
                  <Skeleton className="h-4 w-20" />
                  <div className="flex flex-col gap-2">
                    <Skeleton className="h-8 w-full rounded-md" />
                    <Skeleton className="h-8 w-full rounded-md" />
                    <Skeleton className="h-8 w-full rounded-md" />
                    <Skeleton className="h-8 w-full rounded-md" />
                    <Skeleton className="h-8 w-full rounded-md" />
                    <Skeleton className="h-8 w-full rounded-md" />
                  </div>
                </div>
                {/* Skeleton do gráfico */}
                <div className="flex-1 min-w-0 min-h-0">
                  <Skeleton className="h-full w-full rounded-md" />
                </div>
              </div>
            ) : !historyData?.data || historyData.data.length === 0 ? (
              <div className="text-sm text-muted-foreground p-6 text-center">Sem dados históricos disponíveis para o período selecionado.</div>
            ) : (
              <div className="flex-1 min-h-0">
                <MetricHistoryChart data={historyData.data} dateStart={historyDateRange.start || dateStart || ""} dateStop={historyDateRange.end || dateStop || ""} actionType={localActionType} availableMetrics={AVAILABLE_METRICS} selectedMetrics={selectedMetrics} onMetricsChange={setSelectedMetrics} />
              </div>
            )}
          </div>
        </TabbedContentItem>
      </TabbedContent>
    </div>
  );
}

// Componente para o player de vídeo com suporte a autoplay, tempo inicial e overlay
function VideoPlayer({ src, autoplay, initialTime, onTimeSet, retentionCurve, showRetentionLoadingOverlay = false }: { src: string; autoplay: boolean; initialTime?: number | null; onTimeSet?: () => void; retentionCurve?: number[]; showRetentionLoadingOverlay?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    if (autoplay && videoRef.current) {
      // Tentar reproduzir quando o vídeo estiver pronto
      const playPromise = videoRef.current.play();
      if (playPromise !== undefined) {
        playPromise.catch((error) => {
          // Autoplay pode ser bloqueado pelo navegador
          console.log("Autoplay bloqueado:", error);
        });
      }
    }
  }, [autoplay, src]);

  // Definir tempo inicial quando o vídeo estiver pronto
  useEffect(() => {
    if (initialTime != null && videoRef.current) {
      const video = videoRef.current;

      const handleLoadedMetadata = () => {
        if (video.duration >= initialTime) {
          video.currentTime = initialTime;
          if (onTimeSet) {
            onTimeSet();
          }
        }
      };

      // Se os metadados já foram carregados, definir o tempo imediatamente
      if (video.readyState >= 1) {
        handleLoadedMetadata();
      } else {
        video.addEventListener("loadedmetadata", handleLoadedMetadata);
        return () => {
          video.removeEventListener("loadedmetadata", handleLoadedMetadata);
        };
      }
    }
  }, [initialTime, src, onTimeSet]);

  // Atualizar tempo e duração do vídeo
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // RAF loop para atualizações suaves (~60fps) durante a reprodução
    let rafId: number | null = null;

    const tick = () => {
      setCurrentTime(video.currentTime);
      rafId = requestAnimationFrame(tick);
    };

    const startRaf = () => {
      if (rafId == null) rafId = requestAnimationFrame(tick);
    };

    const stopRaf = () => {
      if (rafId != null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      setCurrentTime(video.currentTime);
    };

    // timeupdate apenas para seeks enquanto pausado
    const handleTimeUpdate = () => {
      if (!video.paused) return;
      setCurrentTime(video.currentTime);
    };

    const handleLoadedMetadata = () => {
      setDuration(video.duration);
    };

    const handleDurationChange = () => {
      setDuration(video.duration);
    };

    const handlePlay = () => {
      setIsPlaying(true);
      startRaf();
    };

    const handlePause = () => {
      setIsPlaying(false);
      stopRaf();
    };

    const handleEnded = () => {
      setIsPlaying(false);
      stopRaf();
    };

    video.addEventListener("timeupdate", handleTimeUpdate);
    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.addEventListener("durationchange", handleDurationChange);
    video.addEventListener("play", handlePlay);
    video.addEventListener("pause", handlePause);
    video.addEventListener("ended", handleEnded);

    // Inicializar valores se já estiverem disponíveis
    if (video.readyState >= 1) {
      setDuration(video.duration);
      setCurrentTime(video.currentTime);
    }

    // Verificar se está reproduzindo inicialmente
    setIsPlaying(!video.paused && !video.ended);
    if (!video.paused && !video.ended) startRaf();

    return () => {
      stopRaf();
      video.removeEventListener("timeupdate", handleTimeUpdate);
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("durationchange", handleDurationChange);
      video.removeEventListener("play", handlePlay);
      video.removeEventListener("pause", handlePause);
      video.removeEventListener("ended", handleEnded);
    };
  }, [src]);

  // Handler para quando o usuário clica no overlay
  const handleTimeSeek = (second: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = second;
      setCurrentTime(second);
    }
  };

  return (
    <div className="relative w-full h-full flex justify-center overflow-visible">
      {/* Container com proporção 9:16 (vertical) */}
      <div className="relative w-full h-full overflow-visible">
        <div className="absolute inset-0 rounded-lg overflow-hidden bg-black">
          <video ref={videoRef} src={src} controls className="absolute inset-0 w-full h-full object-contain" playsInline autoPlay={autoplay} />
        </div>
        {showRetentionLoadingOverlay && (
          <div className="absolute inset-0 z-10 flex flex-col justify-between rounded-lg bg-black/24 p-4 pointer-events-none">
            <div className="self-start rounded-md bg-background/90 px-3 py-1.5 shadow-sm backdrop-blur-sm">
              <div className="text-[11px] font-medium text-foreground">Carregando retenção...</div>
            </div>
            <div className="space-y-2">
              <Skeleton className="h-24 w-full rounded-md bg-background/40" />
              <div className="grid grid-cols-3 gap-2">
                <Skeleton className="h-8 rounded-md bg-background/40" />
                <Skeleton className="h-8 rounded-md bg-background/40" />
                <Skeleton className="h-8 rounded-md bg-background/40" />
              </div>
            </div>
          </div>
        )}
        {retentionCurve && retentionCurve.length > 0 && <RetentionChartOverlay videoPlayCurve={retentionCurve} currentTime={currentTime} duration={duration} isPlaying={isPlaying} onTimeSeek={handleTimeSeek} />}
      </div>
    </div>
  );
}
