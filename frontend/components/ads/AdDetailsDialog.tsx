"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import type { ColumnFiltersState } from "@tanstack/react-table";
import { useFormatCurrency } from "@/lib/utils/currency";
import { VideoMetricCell } from "@/components/common/VideoMetricCell";
import { StatePanel } from "@/components/common/States";
import { RetentionChart } from "@/components/charts/RetentionChart";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAdVariations, useAdDetails, useAdCreative, useVideoSource, useImageSource, useAdHistory, useAdNameHistory, useAdTranscription, useTranscribeAd } from "@/lib/api/hooks";
import { RankingsItem } from "@/lib/api/schemas";
import { getAdThumbnail } from "@/lib/utils/thumbnailFallback";
import { MetricHistoryChart, AVAILABLE_METRICS } from "@/components/charts/MetricHistoryChart";
import { DateRangeFilter, DateRangeValue } from "@/components/common/DateRangeFilter";
import { TabbedContent, TabbedContentItem, type TabItem } from "@/components/common/TabbedContent";
import { ActionTypeFilter } from "@/components/common/ActionTypeFilter";
import { computeMqlMetricsFromLeadscore } from "@/lib/utils/mqlMetrics";
import { useMqlLeadscore } from "@/lib/hooks/useMqlLeadscore";
import { buildMetricSeriesFromSourceSeries, getMetricAverageTooltip, getMetricBetterDirection, getMetricDisplayLabel, getMetricNumericValue, getMetricNumericValueOrNull } from "@/lib/metrics";
import type { ManagerColumnType } from "@/components/common/ManagerColumnFilter";
import { ManagerChildrenTable } from "@/components/manager/ManagerChildrenTable";
import { loadManagerColumnsPreference } from "@/components/manager/managerColumnPreferences";
import { IconAlignLeft, IconBrandParsinta, IconChartAreaLine, IconChartFunnel, IconCheck, IconCopy, IconCurrencyDollar, IconLayoutGrid, IconMicrophone, IconWorld } from "@tabler/icons-react";
import { retentionToColor, findHookBoundary, secondToRetentionIndex } from "@/lib/utils/retentionColor";
import type { TimestampedWord } from "@/lib/api/schemas";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useSharedAdNameDetail } from "@/lib/ads/sharedAdDetail";
import { extractActorIdFromCreative, normalizeMediaType, resolvePrimaryVideoId } from "@/lib/ads/mediaDetection";
import { RetentionVideoPlayer, RetentionVideoPlayerSkeleton } from "@/components/common/RetentionVideoPlayer";
import { ThumbnailImage } from "@/components/common/ThumbnailImage";
import { showProgressToast, finishProgressToast, buildTranscriptionToastContent } from "@/lib/utils/toast";

interface AdDetailsDialogProps {
  ad: RankingsItem;
  groupByAdName: boolean;
  dateStart?: string;
  dateStop?: string;
  actionType?: string;
  /**
   * Packs selecionados no contexto que abriu o dialog. Quando não vazio, restringe
   * variações/detalhes/histórico a métricas que pertencem a esses packs (via
   * ad_metric_pack_map). Sem isso, ads compartilhados entre packs com date_ranges
   * diferentes super-contam spend/CTR/etc.
   */
  packIds?: string[];
  availableConversionTypes?: string[]; // Tipos de conversão disponíveis (mesmos do seletor)
  initialTab?: "variations" | "video" | "history"; // Aba inicial
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

export function AdDetailsDialog({ ad, groupByAdName, dateStart, dateStop, actionType, packIds = [], availableConversionTypes = [], initialTab = "video", averages }: AdDetailsDialogProps) {
  const [activeTab, setActiveTab] = useState<"variations" | "video" | "copy" | "history">(initialTab);
  const [shouldAutoplay, setShouldAutoplay] = useState(false);
  const [initialVideoTime, setInitialVideoTime] = useState<number | null>(null);
  const [retentionViewMode, setRetentionViewMode] = useState<"chart" | "metrics">("metrics");
  const [variationColumnFilters, setVariationColumnFilters] = useState<ColumnFiltersState>([]);
  const [variationActiveColumns] = useState<Set<ManagerColumnType>>(() => loadManagerColumnsPreference());
  const [transcriptionPending, setTranscriptionPending] = useState(false);
  const [copiedTranscription, setCopiedTranscription] = useState(false);
  const [transcriptionViewMode, setTranscriptionViewMode] = useState<"plain" | "retention">("retention");
  const transcriptionToastId = useRef<string>("");

  // Atualizar aba quando initialTab mudar (quando o modal é reaberto com outro anúncio)
  useEffect(() => {
    setActiveTab(initialTab);
    setShouldAutoplay(false);
    setInitialVideoTime(null); // Resetar tempo inicial quando mudar de anúncio
    setRetentionViewMode("metrics");
    setVariationColumnFilters([]);
    setHistoryDateRange({ start: dateStart, end: dateStop }); // Resetar date range quando mudar de anúncio
    setUsePackDates(true); // Resetar para "usar datas do pack" quando mudar de anúncio
    setTranscriptionPending(false);
    setTranscriptionViewMode("retention");
  }, [initialTab, ad?.ad_id]); // Resetar quando o anúncio mudar
  // Local actionType que pode ser alterado dentro do dialog sem afetar o Manager
  const [localActionType, setLocalActionType] = useState<string>(actionType || "");
  useEffect(() => {
    setLocalActionType(actionType || "");
  }, [actionType, ad?.ad_id]);

  const [selectedMetrics, setSelectedMetrics] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem("history_selected_metrics");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return ["spend"];
  });
  const handleMetricsChange = (metrics: string[]) => {
    setSelectedMetrics(metrics);
    try {
      localStorage.setItem("history_selected_metrics", JSON.stringify(metrics));
    } catch {}
  };
  // Date range específico para o histórico (inicializa com o date range principal ou vazio para mostrar todos)
  const [historyDateRange, setHistoryDateRange] = useState<DateRangeValue>(() => ({
    start: dateStart,
    end: dateStop,
  }));
  const [usePackDates, setUsePackDates] = useState<boolean>(true);
  // Auto-aplicar datas do pack quando o toggle for ativado
  useEffect(() => {
    if (!usePackDates) return;
    setHistoryDateRange({ start: dateStart, end: dateStop });
  }, [usePackDates, dateStart, dateStop]);

  const adName = String(ad?.ad_name || "");
  const adId = String(ad?.ad_id || "");
  const totalVariations = Number(ad?.ad_count ?? 0);
  const activeVariations = Number(ad?.active_count ?? totalVariations);
  const adStatus = String(ad?.effective_status || "—");
  const isAdActive = adStatus.toUpperCase() === "ACTIVE";
  const detailDateStart = historyDateRange.start || dateStart || "";
  const detailDateStop = historyDateRange.end || dateStop || "";
  const shouldLoadVariations = groupByAdName && activeTab === "variations" && !!adName && !!dateStart && !!dateStop;
  const shouldLoadDetails = !groupByAdName && activeTab === "video" && !!adId && !!dateStart && !!dateStop;
  const shouldLoadCreative = !groupByAdName && (activeTab === "video" || activeTab === "copy") && !!adId;
  const shouldLoadTranscription = activeTab === "copy" && !!adName;
  const shouldLoadHistoryById = activeTab === "history" && !groupByAdName && !!adId && !!dateStart && !!dateStop;
  const shouldLoadHistoryByName = activeTab === "history" && groupByAdName && !!adName && !!dateStart && !!dateStop;

  const groupedSharedDetail = useSharedAdNameDetail({
    ad: groupByAdName ? ad : null,
    dateStart: detailDateStart,
    dateStop: detailDateStop,
    actionType: localActionType,
    enabled: groupByAdName && !!detailDateStart && !!detailDateStop,
  });

  const { data: childrenData, isLoading: loadingChildren } = useAdVariations(adName, dateStart || "", dateStop || "", packIds, shouldLoadVariations);

  const { data: adDetails, isLoading: loadingAdDetails } = useAdDetails(adId, dateStart || "", dateStop || "", packIds, shouldLoadDetails);

  // Detectar se o date range foi alterado pelo usuário (override)
  const isDateRangeOverridden = useMemo(() => {
    if (!historyDateRange.start || !historyDateRange.end) return false;
    return historyDateRange.start !== dateStart || historyDateRange.end !== dateStop;
  }, [historyDateRange, dateStart, dateStop]);

  // Override de métricas: buscar dados frescos quando date range diferente do pai
  const shouldLoadOverriddenById = isDateRangeOverridden && !groupByAdName && !!adId;
  const { data: overriddenById, isLoading: loadingOverriddenById } = useAdDetails(adId, historyDateRange.start || "", historyDateRange.end || "", packIds, shouldLoadOverriddenById);
  const overriddenDetails = overriddenById;
  const loadingOverridden = isDateRangeOverridden && loadingOverriddenById;

  // Métricas efetivas: override quando date range alterado, senão usar ad original
  const effectiveAd = useMemo(() => {
    if (!isDateRangeOverridden || !overriddenDetails) return null;
    const src = overriddenDetails as any;
    return {
      hook: Number(src.hook ?? 0),
      hold_rate: src.hold_rate != null ? Number(src.hold_rate) : null,
      ctr: Number(src.ctr ?? 0),
      connect_rate: Number(src.connect_rate ?? 0),
      cpm: Number(src.cpm ?? 0),
      website_ctr: Number(src.website_ctr ?? 0),
      spend: Number(src.spend ?? 0),
      clicks: Number(src.clicks ?? 0),
      inline_link_clicks: Number(src.inline_link_clicks ?? 0),
      impressions: Number(src.impressions ?? 0),
      lpv: Number(src.lpv ?? 0),
      plays: Number(src.plays ?? 0),
      reach: src.reach != null ? Number(src.reach) : null,
      frequency: src.frequency != null ? Number(src.frequency) : null,
      video_watched_p50: src.video_watched_p50 ?? undefined,
      video_play_curve_actions: src.video_play_curve_actions ?? null,
      conversions: src.conversions ?? {},
      leadscore_values: src.leadscore_values ?? null,
      series: src.series ?? null,
    };
  }, [isDateRangeOverridden, overriddenDetails]);

  // Buscar creative e video_ids quando a tab de vídeo estiver ativa
  const { data: creativeData, isLoading: loadingCreative } = useAdCreative(adId, shouldLoadCreative);

  // Extrair video_id e actor_id do creative buscado
  const creative = creativeData?.creative || {};
  const videoId = resolvePrimaryVideoId(creativeData as any, creative, creativeData?.adcreatives_videos_ids);
  const mediaType = normalizeMediaType((creativeData as any)?.media_type);
  const actorId = extractActorIdFromCreative(creative);
  const videoOwnerPageId = (creativeData as any)?.video_owner_page_id;
  const shouldLoadVideo = (activeTab === "video" || activeTab === "copy") && mediaType !== "image" && !!videoId && !loadingCreative;

  const { data: videoData, isLoading: loadingVideo, error: videoError } = useVideoSource({ video_id: videoId || "", actor_id: actorId || undefined, ad_id: adId, video_owner_page_id: videoOwnerPageId || undefined }, shouldLoadVideo);

  const { data: historyDataById, isLoading: loadingHistoryById } = useAdHistory(adId, dateStart || "", dateStop || "", packIds, shouldLoadHistoryById);
  const { data: historyDataByName, isLoading: loadingHistoryByName } = useAdNameHistory(adName, dateStart || "", dateStop || "", packIds, shouldLoadHistoryByName);
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
  const getMetricLabel = (metricKey: string, preferShortLabel = false) => getMetricDisplayLabel(metricKey, { preferShortLabel });

  function getDeltaDisplay({ valueRaw, avgRaw }: { valueRaw?: number | null; avgRaw?: number | null }) {
    if (valueRaw == null || avgRaw == null || Number.isNaN(valueRaw as number) || Number.isNaN(avgRaw as number) || !isFinite(valueRaw as number) || !isFinite(avgRaw as number) || (avgRaw as number) === 0) {
      return null;
    }
    const diff = (valueRaw as number) / (avgRaw as number) - 1;
    const sign = diff >= 0 ? "+" : "";
    return `${sign}${(diff * 100).toFixed(1)}%`;
  }

  function MetricSection({ title, children, contentBeforeChildren, headerAction }: { title: string; children: React.ReactNode; contentBeforeChildren?: React.ReactNode; headerAction?: React.ReactNode }) {
    const sectionIconMap = {
      Retenção: IconBrandParsinta,
      Funil: IconChartFunnel,
      Resultados: IconCurrencyDollar,
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
      <div className={`flex-1 flex flex-col md:flex-row min-h-0 ${detailsTabContentGapClassName}`}>
        <div className="relative ml-8 h-[min(70vh,42rem)] min-h-0 flex-shrink-0 aspect-[9/16] md:h-full md:max-h-full">
          <RetentionVideoPlayerSkeleton />
        </div>

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
    const c = effectiveAd?.conversions ?? ad?.conversions;
    if (!c || typeof c !== "object" || Array.isArray(c)) return 0;
    const numValue = Number((c as Record<string, unknown>)[localActionType]);
    if (Number.isNaN(numValue) || !isFinite(numValue)) return 0;
    return numValue;
  }, [effectiveAd, ad, localActionType]);

  // CPR: usar o valor já calculado do ranking se disponível, senão calcular
  const _spend = effectiveAd?.spend ?? Number(ad?.spend || 0);
  const _clicks = effectiveAd?.clicks ?? Number(ad?.clicks || 0);
  const _inlineLinkClicks = effectiveAd?.inline_link_clicks ?? Number((ad as any)?.inline_link_clicks || 0);

  const cpr = useMemo(() => getMetricNumericValue({ ...(ad as any), ...(effectiveAd as any) }, "cpr", { actionType: localActionType }), [ad, effectiveAd, localActionType]);

  const hasCpr = useMemo(() => {
    return getMetricNumericValueOrNull({ ...(ad as any), ...(effectiveAd as any) }, "cpr", { actionType: localActionType }) != null;
  }, [ad, effectiveAd, localActionType]);

  const pageConv = useMemo(() => getMetricNumericValue({ ...(ad as any), ...(effectiveAd as any) }, "page_conv", { actionType: localActionType }), [ad, effectiveAd, localActionType]);

  const cpm = useMemo(() => getMetricNumericValue({ ...(ad as any), ...(effectiveAd as any) }, "cpm"), [ad, effectiveAd]);

  const cpc = useMemo(() => getMetricNumericValue({ ...(ad as any), ...(effectiveAd as any) }, "cpc"), [ad, effectiveAd]);

  const hasCpc = useMemo(() => _clicks > 0, [_clicks]);

  const cplc = useMemo(() => getMetricNumericValue({ ...(ad as any), ...(effectiveAd as any) }, "cplc"), [ad, effectiveAd]);

  const hasCplc = useMemo(() => _inlineLinkClicks > 0, [_inlineLinkClicks]);

  const websiteCtr = useMemo(() => getMetricNumericValue({ ...(ad as any), ...(effectiveAd as any) }, "website_ctr"), [ad, effectiveAd]);

  // MQL / CPMQL
  const { mqlLeadscoreMin } = useMqlLeadscore();
  const mqlMetrics = useMemo(() => {
    return computeMqlMetricsFromLeadscore({
      spend: _spend,
      leadscoreRaw: effectiveAd?.leadscore_values ?? (ad as any)?.leadscore_values,
      mqlLeadscoreMin,
    });
  }, [_spend, effectiveAd?.leadscore_values, (ad as any)?.leadscore_values, mqlLeadscoreMin]);

  const hasSheetIntegration = useMemo(() => {
    if ((ad as any)?.leadscore_values != null || averages?.cpmql != null) {
      return true;
    }

    return Boolean(childrenData?.some((child) => (child as any)?.leadscore_values != null));
  }, [ad, averages?.cpmql, childrenData]);

  // Calcular séries dinâmicas (cpr, cpc, cplc e page_conv)
  const series = useMemo(() => {
    const baseSeries = effectiveAd?.series ?? ad?.series;
    if (!baseSeries) return baseSeries;

    return {
      ...baseSeries,
      cpc: buildMetricSeriesFromSourceSeries(baseSeries as any, "cpc"),
      cplc: buildMetricSeriesFromSourceSeries(baseSeries as any, "cplc"),
      results: buildMetricSeriesFromSourceSeries(baseSeries as any, "results", { actionType: localActionType }),
      cpr: buildMetricSeriesFromSourceSeries(baseSeries as any, "cpr", { actionType: localActionType }),
      page_conv: buildMetricSeriesFromSourceSeries(baseSeries as any, "page_conv", { actionType: localActionType }),
      website_ctr: buildMetricSeriesFromSourceSeries(baseSeries as any, "website_ctr"),
    } as any;
  }, [ad?.series, effectiveAd?.series, localActionType]);

  // Retenção de vídeo (array 0..100 por segundo) - priorizar effectiveAd > ad > adDetails
  const retentionSeries: number[] = useMemo(() => {
    // Se date range override ativo, priorizar dados do override
    if (effectiveAd?.video_play_curve_actions) {
      const fromOverride = effectiveAd.video_play_curve_actions as number[];
      if (Array.isArray(fromOverride) && fromOverride.length > 0) {
        return fromOverride.map((v) => Number(v || 0));
      }
    }
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
  }, [ad, adDetails, effectiveAd]);

  // Calcular scroll_stop a partir da curva de retenção (índice 1)
  const scrollStop = useMemo(() => {
    if (retentionSeries && retentionSeries.length > 1) {
      // A curva vem em porcentagem (0-100), então dividimos por 100 para converter para decimal (0-1)
      return retentionSeries[1] / 100;
    }
    return 0;
  }, [retentionSeries]);

  // video_watched_p50 - priorizar effectiveAd > ad > adDetails
  const videoWatchedP50 = useMemo(() => {
    // Se date range override ativo, priorizar dados do override
    if (effectiveAd?.video_watched_p50 != null && !Number.isNaN(effectiveAd.video_watched_p50)) {
      return Number(effectiveAd.video_watched_p50);
    }
    const fromAd = (ad as any)?.video_watched_p50 as number | undefined;
    if (fromAd != null && !Number.isNaN(fromAd)) {
      return Number(fromAd);
    }
    const fromDetails = (adDetails as any)?.video_watched_p50 as number | undefined;
    if (fromDetails != null && !Number.isNaN(fromDetails)) {
      return Number(fromDetails);
    }
    return undefined;
  }, [ad, adDetails, effectiveAd]);

  const isRetentionLoadingForVideo = activeTab === "video" && loadingAdDetails && retentionSeries.length === 0;

  const resolvedDetailModel = groupByAdName ? groupedSharedDetail.model : null;
  const resolvedThumbnail = groupByAdName ? (resolvedDetailModel?.thumbnailUrl ?? getAdThumbnail(ad)) : getAdThumbnail(ad);
  const resolvedVideoId = groupByAdName ? (resolvedDetailModel?.videoId ?? null) : videoId || null;
  const resolvedMediaType = groupByAdName ? (resolvedDetailModel?.mediaType ?? null) : mediaType;
  const resolvedActorId = groupByAdName ? (resolvedDetailModel?.actorId ?? null) : actorId || null;
  const resolvedLoadingVideo = groupByAdName ? groupedSharedDetail.isLoadingMedia : loadingVideo;
  const resolvedVideoError = groupByAdName ? groupedSharedDetail.error : videoError;
  const resolvedVideoSourceUrl = groupByAdName ? (resolvedDetailModel?.videoSourceUrl ?? null) : ((videoData as any)?.source_url ?? null);
  const resolvedRetentionSeries = groupByAdName ? (resolvedDetailModel?.retentionSeries ?? []) : retentionSeries;
  const resolvedScrollStop = groupByAdName ? (resolvedDetailModel?.scrollStop ?? 0) : scrollStop;
  const resolvedVideoWatchedP50 = groupByAdName ? resolvedDetailModel?.videoWatchedP50 : videoWatchedP50;
  const resolvedHookValue = groupByAdName ? (resolvedDetailModel?.hook ?? Number(ad?.hook ?? 0)) : (effectiveAd?.hook ?? Number(ad?.hook ?? 0));
  const resolvedHoldRateValue = groupByAdName
    ? (resolvedDetailModel?.holdRate ?? null)
    : (() => {
        const hr = effectiveAd?.hold_rate ?? (ad as any)?.hold_rate;
        return hr != null ? Number(hr) : null;
      })();
  const resolvedCtrValue = groupByAdName ? (resolvedDetailModel?.ctr ?? Number(ad?.ctr ?? 0)) : (effectiveAd?.ctr ?? Number(ad?.ctr ?? 0));
  const resolvedWebsiteCtr = groupByAdName ? (resolvedDetailModel?.websiteCtr ?? 0) : websiteCtr;
  const resolvedConnectRate = groupByAdName ? (resolvedDetailModel?.connectRate ?? Number(ad?.connect_rate ?? 0)) : (effectiveAd?.connect_rate ?? Number(ad?.connect_rate ?? 0));
  const resolvedPageConv = groupByAdName ? (resolvedDetailModel?.pageConv ?? 0) : pageConv;
  const resolvedCpm = groupByAdName ? (resolvedDetailModel?.cpm ?? 0) : cpm;
  const resolvedCpc = groupByAdName ? (resolvedDetailModel?.cpc ?? 0) : cpc;
  const resolvedHasCpc = groupByAdName ? (resolvedDetailModel?.hasCpc ?? false) : hasCpc;
  const resolvedCpr = groupByAdName ? (resolvedDetailModel?.cpr ?? 0) : cpr;
  const resolvedHasCpr = groupByAdName ? (resolvedDetailModel?.hasCpr ?? false) : hasCpr;
  const resolvedResultsForActionType = groupByAdName ? Number(resolvedDetailModel?.results ?? 0) : resultsForActionType;
  const resolvedMqlMetrics = groupByAdName ? { cpmql: Number(resolvedDetailModel?.cpmql ?? 0), mqlCount: Number(resolvedDetailModel?.mqlCount ?? 0) } : mqlMetrics;
  const resolvedSeries = groupByAdName ? ((resolvedDetailModel?.series as any) ?? null) : series;
  const resolvedSpend = groupByAdName ? Number((resolvedDetailModel?.source?.spend ?? ad?.spend) || 0) : _spend;
  const resolvedClicks = groupByAdName ? Number((resolvedDetailModel?.source?.clicks ?? ad?.clicks) || 0) : _clicks;
  const resolvedFrequency = groupByAdName
    ? (() => {
        const value = resolvedDetailModel?.source?.frequency;
        return value != null ? Number(value) : null;
      })()
    : (() => {
        const value = effectiveAd?.frequency ?? (ad as any)?.frequency;
        return value != null ? Number(value) : null;
      })();
  const resolvedImpressions = groupByAdName ? Number((resolvedDetailModel?.source?.impressions ?? ad?.impressions) || 0) : (effectiveAd?.impressions ?? Number(ad?.impressions || 0));
  const resolvedReach = groupByAdName
    ? (() => {
        const value = resolvedDetailModel?.source?.reach;
        return value != null ? Number(value) : null;
      })()
    : (() => {
        const value = effectiveAd?.reach ?? (ad as any)?.reach;
        return value != null ? Number(value) : null;
      })();
  const resolvedHasSheetIntegration = groupByAdName ? (resolvedDetailModel?.hasSheetIntegration ?? false) : hasSheetIntegration;
  const isRetentionLoadingForResolvedVideo = activeTab === "video" && (groupByAdName ? groupedSharedDetail.isLoadingDetail && resolvedRetentionSeries.length === 0 : loadingAdDetails && resolvedRetentionSeries.length === 0);

  const isCreativeLoading = (!groupByAdName && loadingCreative) || (groupByAdName && groupedSharedDetail.isLoadingMedia);
  const hasCreativeMediaData = groupByAdName ? !!groupedSharedDetail.creativeData : !!creativeData;
  const isImageAd = !isCreativeLoading && hasCreativeMediaData && (resolvedMediaType === "image" || (!resolvedMediaType && !resolvedVideoId));
  const imageActorId = groupByAdName ? (groupedSharedDetail.creativeData as any)?.creative?.actor_id || null : actorId || null;
  const shouldLoadImageSource = isImageAd && !!adId && !!imageActorId;
  const { data: imageSourceData, isLoading: loadingImageSource } = useImageSource({ ad_id: adId, actor_id: imageActorId || "" }, shouldLoadImageSource);
  const resolvedCreativeImageUrl = imageSourceData?.image_url ?? null;

  const { data: transcriptionData, isLoading: loadingTranscription, isError: transcriptionError } = useAdTranscription(adName, shouldLoadTranscription, transcriptionPending);
  const { mutate: transcribeAdMutation, isPending: isTranscribing } = useTranscribeAd();

  // Handler para quando um ponto do gráfico de retenção é clicado
  const handleRetentionPointClick = (second: number) => {
    setInitialVideoTime(second);
    setActiveTab("video");
    setShouldAutoplay(false); // Não autoplay quando vem do gráfico
  };

  const handleCopyTranscription = () => {
    if (!transcriptionData?.full_text) return;

    let text: string;
    const words = transcriptionData.timestamped_text;

    if (transcriptionViewMode === "retention" && words && words.length > 0) {
      const boundary = findHookBoundary(words);
      const hookText = words
        .slice(0, boundary)
        .map((w) => w.text)
        .join(" ");
      const bodyText = words
        .slice(boundary)
        .map((w) => w.text)
        .join(" ");
      text = `## ${adName}\n### Hook\n${hookText}\n\n### Body\n${bodyText}`;
    } else {
      text = `## ${adName}\n${transcriptionData.full_text}`;
    }

    navigator.clipboard.writeText(text);
    setCopiedTranscription(true);
    setTimeout(() => setCopiedTranscription(false), 3000);
  };

  const handleTranscribeAd = () => {
    const toastId = `transcription-${adName}-${Date.now()}`;
    transcriptionToastId.current = toastId;
    showProgressToast(toastId, adName, 1, 2, undefined, undefined, <IconMicrophone className="h-5 w-5 flex-shrink-0" />, buildTranscriptionToastContent("processing", { total: 1, done: 0 }));
    setTranscriptionPending(true);
    transcribeAdMutation(adName, {
      onError: () => {
        finishProgressToast(toastId, false, "Falha ao iniciar transcrição");
        setTranscriptionPending(false);
      },
    });
  };

  useEffect(() => {
    if (!transcriptionPending || !transcriptionToastId.current) return;
    if (transcriptionData?.status === "completed") {
      finishProgressToast(transcriptionToastId.current, true, "Transcrição concluída", {
        context: "transcription",
        packName: adName,
        visibleDurationOnly: 5,
      });
      setTranscriptionPending(false);
    } else if (transcriptionData?.status === "failed") {
      finishProgressToast(transcriptionToastId.current, false, "Transcrição falhou");
      setTranscriptionPending(false);
    }
  }, [transcriptionData, transcriptionPending, adName]);

  const statusDotClass = groupByAdName ? (activeVariations > 0 ? "bg-success" : "bg-muted") : isAdActive ? "bg-success" : "bg-muted";
  const detailsTabContentGapClassName = "gap-4 md:gap-8";

  return (
    <div className="h-full flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-start gap-4 pr-8 flex-shrink-0">
        <ThumbnailImage src={resolvedThumbnail} alt="thumb" size="lg" />
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
        <DateRangeFilter label="Período do histórico" value={historyDateRange} onChange={setHistoryDateRange} className="w-auto shrink-0" showLabel={false} requireConfirmation={true} usePackDates={usePackDates} onUsePackDatesChange={setUsePackDates} showPackDatesSwitch={true} packDatesRange={{ start: dateStart, end: dateStop }} />
      </div>

      {/* Tabs */}
      <TabbedContent
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as typeof activeTab)}
        variant="with-controls"
        tabs={[{ value: "video", label: "Geral" }, { value: "copy", label: "Copy" }, { value: "history", label: "Histórico" }, ...(groupByAdName ? [{ value: "variations", label: "Variações" }] : [])]}
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
        {groupByAdName && (
          <TabbedContentItem value="variations" variant="simple" className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <ManagerChildrenTable childrenData={childrenData} isLoading={loadingChildren} actionType={localActionType} formatCurrency={formatCurrency} formatPct={formatPct} activeColumns={variationActiveColumns} hasSheetIntegration={resolvedHasSheetIntegration} mqlLeadscoreMin={mqlLeadscoreMin} columnFilters={variationColumnFilters} setColumnFilters={setVariationColumnFilters} asContent />
          </TabbedContentItem>
        )}

        {/* Layout compartilhado entre "Geral" e "Copy": renderizado fora de TabsContent para manter o vídeo montado ao trocar de aba */}
        <div className={`flex-1 flex flex-col min-h-0 ${activeTab !== "video" && activeTab !== "copy" ? "hidden" : ""}`}>
          {isCreativeLoading ? (
            <VideoTabSkeleton showConversionFilter={allConversionTypes.length > 0} />
          ) : !isImageAd && (!resolvedVideoId || !resolvedActorId) ? (
            <StatePanel kind="empty" message="Mídia não disponível para este anúncio." framed={false} fill />
          ) : (
            <div className={`flex-1 flex flex-col md:flex-row min-h-0 ${detailsTabContentGapClassName}`}>
              {/* Player de vídeo ou imagem (compartilhado — nunca desmonta ao trocar entre Geral e Copy) */}
              <div className="ml-8 flex h-[min(70vh,42rem)] min-h-0 flex-shrink-0 aspect-[9/16] items-center justify-center rounded-lg md:h-full md:max-h-full">
                {isImageAd ? (
                  loadingImageSource ? (
                    <RetentionVideoPlayerSkeleton />
                  ) : resolvedCreativeImageUrl ? (
                    <img src={resolvedCreativeImageUrl} alt={adName} className="w-full h-full object-contain rounded-lg" />
                  ) : (
                    <StatePanel kind="empty" message="Imagem não disponível." framed={false} fill />
                  )
                ) : (
                  <>
                    {resolvedLoadingVideo && <RetentionVideoPlayerSkeleton />}
                    {resolvedVideoError && <StatePanel kind="error" message="Falha ao carregar o vídeo. Tente novamente mais tarde." framed={false} fill />}
                    {!resolvedLoadingVideo && !resolvedVideoError && resolvedVideoSourceUrl && <RetentionVideoPlayer src={resolvedVideoSourceUrl} autoplay={shouldAutoplay} initialTime={initialVideoTime} onTimeSet={() => setInitialVideoTime(null)} retentionCurve={resolvedRetentionSeries} showRetentionLoadingOverlay={isRetentionLoadingForResolvedVideo} />}
                    {!resolvedLoadingVideo && !resolvedVideoError && !resolvedVideoSourceUrl && <StatePanel kind="empty" message="URL do vídeo não disponível." framed={false} fill />}
                  </>
                )}
              </div>

              {/* Conteúdo direito: métricas (Geral) ou transcrição (Copy) */}
              {activeTab === "video" && (
                <div className={`flex-1 overflow-y-auto min-h-0 flex flex-col gap-4 justify-between transition-opacity duration-200 ${loadingOverridden ? "opacity-50 pointer-events-none" : ""}`}>
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
                    contentBeforeChildren={retentionViewMode === "chart" && resolvedRetentionSeries && resolvedRetentionSeries.length > 0 ? <RetentionChart videoPlayCurve={resolvedRetentionSeries} videoWatchedP50={resolvedVideoWatchedP50} showTitle={false} chartHeightClassName="h-52" averagesHook={averages?.hook ?? null} averagesScrollStop={averages?.scroll_stop ?? null} hookValue={resolvedHookValue} onPointClick={handleRetentionPointClick} /> : null}
                  >
                    {retentionViewMode === "metrics" && (
                      <>
                        <VideoMetricCell label={getMetricLabel("scroll_stop")} value={formatPct(resolvedScrollStop * 100)} deltaDisplay={getDeltaDisplay({ valueRaw: resolvedScrollStop, avgRaw: averages?.scroll_stop ?? null })} averageDisplay={averages?.scroll_stop != null ? formatPct(averages.scroll_stop * 100) : undefined} averageTooltip={getMetricAverageTooltip("scroll_stop")} series={resolvedSeries?.scroll_stop} formatFn={(n: number) => formatPct(n * 100)} valueRaw={resolvedScrollStop} avgRaw={averages?.scroll_stop ?? null} better={getMetricBetterDirection("scroll_stop")} packAverage={averages?.scroll_stop ?? null} />
                        <VideoMetricCell label={getMetricLabel("hook")} value={formatPct(resolvedHookValue * 100)} deltaDisplay={getDeltaDisplay({ valueRaw: resolvedHookValue, avgRaw: averages?.hook ?? null })} averageDisplay={averages?.hook != null ? formatPct(averages.hook * 100) : undefined} averageTooltip={getMetricAverageTooltip("hook")} series={resolvedSeries?.hook} formatFn={(n: number) => formatPct(n * 100)} valueRaw={resolvedHookValue} avgRaw={averages?.hook ?? null} better={getMetricBetterDirection("hook")} packAverage={averages?.hook ?? null} />
                        <VideoMetricCell label={getMetricLabel("hold_rate")} value={resolvedHoldRateValue != null ? formatPct(Number(resolvedHoldRateValue) * 100) : "—"} deltaDisplay={getDeltaDisplay({ valueRaw: resolvedHoldRateValue, avgRaw: averages?.hold_rate ?? null })} averageDisplay={averages?.hold_rate != null ? formatPct(averages.hold_rate * 100) : undefined} averageTooltip={getMetricAverageTooltip("hold_rate")} series={resolvedSeries?.hold_rate} formatFn={(n: number) => formatPct(n * 100)} valueRaw={resolvedHoldRateValue} avgRaw={averages?.hold_rate ?? null} better={getMetricBetterDirection("hold_rate")} packAverage={averages?.hold_rate ?? null} />
                        <VideoMetricCell label={getMetricLabel("video_watched_p50")} value={resolvedVideoWatchedP50 != null ? `${resolvedVideoWatchedP50}%` : "—"} deltaDisplay={getDeltaDisplay({ valueRaw: resolvedVideoWatchedP50 ?? null, avgRaw: averages?.video_watched_p50 ?? null })} averageDisplay={averages?.video_watched_p50 != null ? `${Math.round(averages.video_watched_p50)}%` : undefined} averageTooltip={getMetricAverageTooltip("video_watched_p50")} series={resolvedSeries?.video_watched_p50} formatFn={(n: number) => `${Math.round(n)}%`} valueRaw={resolvedVideoWatchedP50 ?? null} avgRaw={averages?.video_watched_p50 ?? null} better={getMetricBetterDirection("video_watched_p50")} packAverage={averages?.video_watched_p50 ?? null} />
                      </>
                    )}
                  </MetricSection>

                  {/* Funil */}
                  <MetricSection title="Funil">
                    <VideoMetricCell label={getMetricLabel("ctr")} value={formatPct(resolvedCtrValue * 100)} deltaDisplay={getDeltaDisplay({ valueRaw: resolvedCtrValue, avgRaw: averages?.ctr ?? null })} averageDisplay={averages?.ctr != null ? formatPct(averages.ctr * 100) : undefined} averageTooltip={getMetricAverageTooltip("ctr")} series={resolvedSeries?.ctr} formatFn={(n: number) => formatPct(n * 100)} valueRaw={resolvedCtrValue} avgRaw={averages?.ctr ?? null} better={getMetricBetterDirection("ctr")} packAverage={averages?.ctr ?? null} />
                    <VideoMetricCell label={getMetricLabel("website_ctr")} value={formatPct(Number(resolvedWebsiteCtr * 100))} deltaDisplay={getDeltaDisplay({ valueRaw: resolvedWebsiteCtr, avgRaw: averages?.website_ctr ?? null })} averageDisplay={averages?.website_ctr != null ? formatPct(averages.website_ctr * 100) : undefined} averageTooltip={getMetricAverageTooltip("website_ctr")} series={resolvedSeries?.website_ctr} formatFn={(n: number) => formatPct(n * 100)} valueRaw={resolvedWebsiteCtr} avgRaw={averages?.website_ctr ?? null} better={getMetricBetterDirection("website_ctr")} packAverage={averages?.website_ctr ?? null} />
                    <VideoMetricCell label={getMetricLabel("connect_rate")} value={formatPct(resolvedConnectRate * 100)} deltaDisplay={getDeltaDisplay({ valueRaw: resolvedConnectRate, avgRaw: averages?.connect_rate ?? null })} averageDisplay={averages?.connect_rate != null ? formatPct(averages.connect_rate * 100) : undefined} averageTooltip={getMetricAverageTooltip("connect_rate")} series={resolvedSeries?.connect_rate} formatFn={(n: number) => formatPct(n * 100)} valueRaw={resolvedConnectRate} avgRaw={averages?.connect_rate ?? null} better={getMetricBetterDirection("connect_rate")} packAverage={averages?.connect_rate ?? null} />
                    <VideoMetricCell label={getMetricLabel("page_conv")} value={formatPct(Number(resolvedPageConv * 100))} deltaDisplay={getDeltaDisplay({ valueRaw: Number(resolvedPageConv ?? 0), avgRaw: averages?.page_conv ?? null })} averageDisplay={averages?.page_conv != null ? formatPct(averages.page_conv * 100) : undefined} averageTooltip={getMetricAverageTooltip("page_conv")} series={resolvedSeries?.page_conv} formatFn={(n: number) => formatPct(n * 100)} valueRaw={Number(resolvedPageConv ?? 0)} avgRaw={averages?.page_conv ?? null} better={getMetricBetterDirection("page_conv")} packAverage={averages?.page_conv ?? null} />
                  </MetricSection>

                  {/* Resultados */}
                  <MetricSection title="Resultados">
                    <VideoMetricCell label={getMetricLabel("cpmql")} value={resolvedMqlMetrics.cpmql > 0 ? formatCurrency(resolvedMqlMetrics.cpmql) : "—"} deltaDisplay={getDeltaDisplay({ valueRaw: resolvedMqlMetrics.cpmql > 0 ? resolvedMqlMetrics.cpmql : null, avgRaw: averages?.cpmql ?? null })} subtitle={`${resolvedMqlMetrics.mqlCount} MQLs`} subtitleInLabelRow averageDisplay={averages?.cpmql != null ? formatCurrency(averages.cpmql) : undefined} averageTooltip={getMetricAverageTooltip("cpmql")} series={resolvedSeries?.cpmql} inverse formatFn={(n: number) => formatCurrency(n)} valueRaw={resolvedMqlMetrics.cpmql > 0 ? resolvedMqlMetrics.cpmql : null} avgRaw={averages?.cpmql ?? null} better={getMetricBetterDirection("cpmql")} packAverage={averages?.cpmql ?? null} />
                    <VideoMetricCell label={getMetricLabel("cpr")} value={resolvedHasCpr ? formatCurrency(resolvedCpr) : "—"} deltaDisplay={getDeltaDisplay({ valueRaw: resolvedHasCpr ? resolvedCpr : null, avgRaw: averages?.cpr ?? null })} subtitle={`${resolvedResultsForActionType} results`} subtitleInLabelRow averageDisplay={averages?.cpr != null ? formatCurrency(averages.cpr) : undefined} averageTooltip={getMetricAverageTooltip("cpr")} series={resolvedSeries?.cpr} inverse formatFn={(n: number) => formatCurrency(n)} valueRaw={resolvedHasCpr ? resolvedCpr : null} avgRaw={averages?.cpr ?? null} better={getMetricBetterDirection("cpr")} packAverage={averages?.cpr ?? null} />
                    <VideoMetricCell label={getMetricLabel("cpc")} value={resolvedHasCpc ? formatCurrency(resolvedCpc) : "—"} deltaDisplay={getDeltaDisplay({ valueRaw: resolvedHasCpc ? resolvedCpc : null, avgRaw: averages?.cpc ?? null })} subtitle={`${resolvedClicks.toLocaleString("pt-BR")} clicks`} subtitleInLabelRow averageDisplay={averages?.cpc != null ? formatCurrency(averages.cpc) : undefined} averageTooltip={getMetricAverageTooltip("cpc")} series={resolvedSeries?.cpc} inverse formatFn={(n: number) => formatCurrency(n)} valueRaw={resolvedHasCpc ? resolvedCpc : null} avgRaw={averages?.cpc ?? null} better={getMetricBetterDirection("cpc")} packAverage={averages?.cpc ?? null} />
                    <VideoMetricCell label={getMetricLabel("cpm")} value={formatCurrency(resolvedCpm)} deltaDisplay={getDeltaDisplay({ valueRaw: resolvedCpm, avgRaw: averages?.cpm ?? null })} averageDisplay={averages?.cpm != null ? formatCurrency(averages.cpm) : undefined} averageTooltip={getMetricAverageTooltip("cpm")} series={resolvedSeries?.cpm} inverse formatFn={(n: number) => formatCurrency(n)} valueRaw={resolvedCpm} avgRaw={averages?.cpm ?? null} better={getMetricBetterDirection("cpm")} packAverage={averages?.cpm ?? null} />
                  </MetricSection>

                  {/* Absolutas (sem sparklines) */}
                  <MetricSection title="Visibilidade">
                    <VideoMetricCell label="Spend" value={formatCurrency(resolvedSpend)} series={resolvedSeries?.spend} formatFn={(n: number) => formatCurrency(n)} colorMode="series" disableSeriesFallback />
                    <VideoMetricCell label="Frequency" value={resolvedFrequency != null ? resolvedFrequency.toFixed(2) : "—"} />
                    <VideoMetricCell label="Impressions" value={resolvedImpressions.toLocaleString("pt-BR")} />
                    <VideoMetricCell label="Reach" value={resolvedReach != null ? resolvedReach.toLocaleString("pt-BR") : "—"} />
                  </MetricSection>
                </div>
              )}

              {activeTab === "copy" && (
                <div className="flex-1 overflow-y-auto min-h-0 flex flex-col gap-4">
                  {/* Título da seção */}
                  <div className="flex items-center justify-between gap-3 text-sm font-semibold text-muted-foreground flex-shrink-0">
                    <div className="flex items-center gap-1.5">
                      <IconMicrophone className="h-4 w-4 flex-shrink-0" />
                      <span>Transcrição</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {transcriptionData?.timestamped_text && resolvedRetentionSeries.length > 0 && (
                        <TooltipProvider>
                          <div className="flex rounded-lg border border-input bg-background" role="group" aria-label="Modo de visualização da transcrição">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant={transcriptionViewMode === "plain" ? "secondary" : "ghost"} size="sm" onClick={() => setTranscriptionViewMode("plain")} className="h-8 px-2.5 rounded-md" aria-label="Texto simples" aria-pressed={transcriptionViewMode === "plain"}>
                                  <IconAlignLeft className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p className="text-xs">Texto simples</p>
                              </TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant={transcriptionViewMode === "retention" ? "secondary" : "ghost"} size="sm" onClick={() => setTranscriptionViewMode("retention")} className="h-8 px-2.5 rounded-md" aria-label="Mapa de retenção" aria-pressed={transcriptionViewMode === "retention"}>
                                  <IconBrandParsinta className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p className="text-xs">Mapa de retenção</p>
                              </TooltipContent>
                            </Tooltip>
                          </div>
                        </TooltipProvider>
                      )}
                      {transcriptionData?.full_text && (
                        <Button variant="ghost" size="sm" onClick={handleCopyTranscription} aria-label="Copiar transcrição" className={`h-8 px-2.5 rounded-md transition-colors duration-200 ${copiedTranscription ? "bg-success/15 hover:bg-success/20 text-success" : ""}`}>
                          {copiedTranscription ? <IconCheck className="h-4 w-4 text-success animate-in zoom-in-50 duration-150" /> : <IconCopy className="h-4 w-4" />}
                        </Button>
                      )}
                    </div>
                  </div>

                  {loadingTranscription ? (
                    <div className="flex flex-col gap-3">
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-4 w-5/6" />
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-4 w-4/5" />
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-4 w-5/6" />
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-4 w-4/5" />
                    </div>
                  ) : isTranscribing || transcriptionPending || transcriptionData?.status === "processing" ? (
                    <StatePanel kind="loading" icon={IconMicrophone} message="Transcrevendo..." framed={false} fill />
                  ) : transcriptionError ? (
                    <StatePanel
                      kind="error"
                      icon={IconMicrophone}
                      message="Erro ao carregar transcrição."
                      framed={false}
                      fill
                      action={
                        <Button variant="outline" size="sm" disabled={isTranscribing || transcriptionPending} onClick={handleTranscribeAd}>
                          Transcrever
                        </Button>
                      }
                    />
                  ) : !transcriptionData ? (
                    <StatePanel
                      kind="empty"
                      icon={IconMicrophone}
                      message="Esse anúncio ainda não foi transcrito."
                      framed={false}
                      fill
                      action={
                        <Button variant="outline" size="sm" disabled={isTranscribing || transcriptionPending} onClick={handleTranscribeAd}>
                          Transcrever
                        </Button>
                      }
                    />
                  ) : transcriptionData.status === "failed" ? (
                    <StatePanel
                      kind="error"
                      icon={IconMicrophone}
                      message="A transcrição falhou para este anúncio."
                      framed={false}
                      fill
                      action={
                        <Button variant="outline" size="sm" disabled={isTranscribing || transcriptionPending} onClick={handleTranscribeAd}>
                          Tentar novamente
                        </Button>
                      }
                    />
                  ) : transcriptionData.full_text ? (
                    <>
                      {transcriptionViewMode === "plain" && <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground">{transcriptionData.full_text}</p>}
                      {transcriptionViewMode === "retention" &&
                        (() => {
                          const words = transcriptionData.timestamped_text;
                          if (!words || words.length === 0) {
                            return <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground">{transcriptionData.full_text}</p>;
                          }
                          const boundary = findHookBoundary(words);
                          const hookWords = words.slice(0, boundary);
                          const bodyWords = words.slice(boundary);
                          const renderWords = (ws: TimestampedWord[]) =>
                            ws.map((w, i) => {
                              const second = Math.floor(w.start / 1000);
                              const idx = secondToRetentionIndex(second);
                              const pct = resolvedRetentionSeries[idx] ?? resolvedRetentionSeries[resolvedRetentionSeries.length - 1] ?? 50;
                              const mm = Math.floor(second / 60);
                              const ss = String(second % 60).padStart(2, "0");
                              return (
                                <span key={i} style={{ color: retentionToColor(pct) }} title={`${mm}:${ss} — ${pct.toFixed(0)}% retenção`}>
                                  {w.text}{" "}
                                </span>
                              );
                            });
                          return (
                            <div className="flex flex-col gap-4 text-sm leading-relaxed">
                              <div>
                                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Hook</div>
                                <p className="leading-relaxed">{renderWords(hookWords)}</p>
                              </div>
                              {bodyWords.length > 0 && (
                                <div>
                                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Body</div>
                                  <p className="leading-relaxed">{renderWords(bodyWords)}</p>
                                </div>
                              )}
                            </div>
                          );
                        })()}
                    </>
                  ) : null}
                </div>
              )}
            </div>
          )}
        </div>

        <TabbedContentItem value="history" variant="simple" className="flex-1 flex flex-col min-h-0">
          <div className="flex-1 flex flex-col min-h-0">
            {loadingHistory ? (
              <div className={`flex-1 min-h-0 flex ${detailsTabContentGapClassName}`}>
                {/* Skeleton do seletor de métricas */}
                <div className="flex-shrink-0 w-56 flex flex-col gap-4">
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
              <StatePanel kind="empty" message="Sem dados históricos disponíveis para o período selecionado." framed={false} fill />
            ) : (
              <div className="flex-1 min-h-0">
                <MetricHistoryChart data={historyData.data} dateStart={historyDateRange.start || dateStart || ""} dateStop={historyDateRange.end || dateStop || ""} actionType={localActionType} availableMetrics={AVAILABLE_METRICS} selectedMetrics={selectedMetrics} onMetricsChange={handleMetricsChange} layoutGapClassName={detailsTabContentGapClassName} />
              </div>
            )}
          </div>
        </TabbedContentItem>
      </TabbedContent>
    </div>
  );
}
