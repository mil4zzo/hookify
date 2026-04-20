import { useMemo } from "react";
import { useAdCreative, useAdNameDetails, useAdPerformanceRetention, useVideoSource } from "@/lib/api/hooks";
import type { AdCreativeResponse, FacebookVideoSource, RankingsItem, RankingsRetentionResponse } from "@/lib/api/schemas";
import { buildMetricSeriesFromSourceSeries, getMetricNumericValueOrNull } from "@/lib/metrics";
import { useFilters } from "@/lib/hooks/useFilters";
import { useMqlLeadscore } from "@/lib/hooks/useMqlLeadscore";
import { computeMqlMetricsFromLeadscore } from "@/lib/utils/mqlMetrics";
import { getAdThumbnail } from "@/lib/utils/thumbnailFallback";
import { extractActorIdFromCreative, normalizeMediaType, resolvePrimaryVideoId } from "@/lib/ads/mediaDetection";

type SharedMetricSource = RankingsItem & Record<string, any>;

export interface SharedAdDetailModel {
  source: SharedMetricSource;
  thumbnailUrl: string | null;
  videoSourceUrl: string | null;
  videoId: string | null;
  mediaType: "video" | "image" | "unknown" | null;
  actorId: string | null;
  videoOwnerPageId: string | null;
  retentionSeries: number[];
  scrollStop: number;
  videoWatchedP50: number | undefined;
  results: number | null;
  cpr: number | null;
  cpc: number | null;
  cpm: number | null;
  ctr: number | null;
  websiteCtr: number | null;
  connectRate: number | null;
  hook: number | null;
  holdRate: number | null;
  pageConv: number | null;
  mqlCount: number;
  cpmql: number | null;
  hasCpr: boolean;
  hasCpc: boolean;
  hasSheetIntegration: boolean;
  series: Record<string, any> | null;
}

export interface BuildSharedAdDetailModelParams {
  baseAd: RankingsItem;
  detailAd?: Partial<SharedMetricSource> | null;
  retentionFallback?: RankingsRetentionResponse | null;
  creativeData?: AdCreativeResponse | null;
  videoData?: FacebookVideoSource | null;
  actionType?: string;
  mqlLeadscoreMin?: number;
}

function toNumberOrNull(value: unknown): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  return numeric;
}

function normalizeCurve(values: unknown): number[] {
  if (!Array.isArray(values) || values.length === 0) {
    return [];
  }

  return values.map((value) => Number(value || 0));
}

export function buildSharedAdDetailModel({
  baseAd,
  detailAd,
  retentionFallback,
  creativeData,
  videoData,
  actionType,
  mqlLeadscoreMin = 0,
}: BuildSharedAdDetailModelParams): SharedAdDetailModel {
  const source = {
    ...baseAd,
    ...(detailAd || {}),
  } as SharedMetricSource;

  const retentionSeries =
    normalizeCurve(source.video_play_curve_actions) ||
    normalizeCurve(baseAd.video_play_curve_actions) ||
    normalizeCurve(retentionFallback?.video_play_curve_actions);
  const resolvedRetentionSeries =
    retentionSeries.length > 0
      ? retentionSeries
      : normalizeCurve(retentionFallback?.video_play_curve_actions);

  const seriesBase = (source.series ?? baseAd.series) as Record<string, any> | null | undefined;
  const series = seriesBase
    ? {
        ...seriesBase,
        cpc: buildMetricSeriesFromSourceSeries(seriesBase as any, "cpc"),
        cplc: buildMetricSeriesFromSourceSeries(seriesBase as any, "cplc"),
        results: buildMetricSeriesFromSourceSeries(seriesBase as any, "results", { actionType }),
        cpr: buildMetricSeriesFromSourceSeries(seriesBase as any, "cpr", { actionType }),
        page_conv: buildMetricSeriesFromSourceSeries(seriesBase as any, "page_conv", { actionType }),
        website_ctr: buildMetricSeriesFromSourceSeries(seriesBase as any, "website_ctr"),
      }
    : null;

  const sourceForMedia = {
    ...source,
    adcreatives_videos_thumbs: source.adcreatives_videos_thumbs ?? baseAd.adcreatives_videos_thumbs,
  };

  const mqlMetrics = computeMqlMetricsFromLeadscore({
    spend: Number(source.spend || 0),
    leadscoreRaw: source.leadscore_values,
    mqlLeadscoreMin,
  });

  const creative = creativeData?.creative || {};
  const resolvedVideoId = resolvePrimaryVideoId(creativeData as any, creative, creativeData?.adcreatives_videos_ids);
  const resolvedMediaType = normalizeMediaType((creativeData as any)?.media_type);
  const resolvedActorId = extractActorIdFromCreative(creative);
  const resolvedVideoOwnerPageId = String((creativeData as any)?.video_owner_page_id || "");
  const videoWatchedP50Raw =
    source.video_watched_p50 ??
    baseAd.video_watched_p50 ??
    detailAd?.video_watched_p50;

  const cpc = getMetricNumericValueOrNull(source, "cpc");
  const cpr = actionType ? getMetricNumericValueOrNull(source, "cpr", { actionType }) : null;
  const pageConv = actionType ? getMetricNumericValueOrNull(source, "page_conv", { actionType }) : null;

  return {
    source,
    thumbnailUrl: getAdThumbnail(sourceForMedia),
    videoSourceUrl: videoData?.source_url || null,
    videoId: resolvedVideoId || null,
    mediaType: resolvedMediaType,
    actorId: resolvedActorId || null,
    videoOwnerPageId: resolvedVideoOwnerPageId || null,
    retentionSeries: resolvedRetentionSeries,
    scrollStop: resolvedRetentionSeries.length > 1 ? resolvedRetentionSeries[1] / 100 : 0,
    videoWatchedP50: videoWatchedP50Raw != null ? Number(videoWatchedP50Raw) : undefined,
    results: actionType ? getMetricNumericValueOrNull(source, "results", { actionType }) : null,
    cpr,
    cpc,
    cpm: getMetricNumericValueOrNull(source, "cpm"),
    ctr: getMetricNumericValueOrNull(source, "ctr"),
    websiteCtr: getMetricNumericValueOrNull(source, "website_ctr"),
    connectRate: getMetricNumericValueOrNull(source, "connect_rate"),
    hook: getMetricNumericValueOrNull(source, "hook"),
    holdRate: getMetricNumericValueOrNull(source, "hold_rate"),
    pageConv,
    mqlCount: mqlMetrics.mqlCount,
    cpmql: toNumberOrNull(mqlMetrics.cpmql),
    hasCpr: cpr != null,
    hasCpc: cpc != null,
    hasSheetIntegration: source.leadscore_values != null || mqlMetrics.cpmql > 0,
    series,
  };
}

interface UseSharedAdNameDetailOptions {
  ad: RankingsItem | null;
  dateStart?: string;
  dateStop?: string;
  actionType?: string;
  enabled?: boolean;
}

export function useSharedAdNameDetail({
  ad,
  dateStart,
  dateStop,
  actionType,
  enabled = true,
}: UseSharedAdNameDetailOptions) {
  const { selectedPackIds } = useFilters();
  const { mqlLeadscoreMin } = useMqlLeadscore();

  const adName = String(ad?.ad_name || "");
  const adId = String(ad?.ad_id || "");
  const groupKey = String(ad?.group_key || ad?.ad_name || "");
  const packIds = useMemo(() => Array.from(selectedPackIds), [selectedPackIds]);

  const detailsEnabled = enabled && !!ad && !!adName && !!dateStart && !!dateStop;
  const detailQuery = useAdNameDetails(adName, dateStart || "", dateStop || "", detailsEnabled);
  const creativeQuery = useAdCreative(adId, enabled && !!ad && !!adId);

  const creative = creativeQuery.data?.creative || {};
  const videoId = resolvePrimaryVideoId(creativeQuery.data as any, creative, creativeQuery.data?.adcreatives_videos_ids);
  const mediaType = normalizeMediaType((creativeQuery.data as any)?.media_type);
  const actorId = extractActorIdFromCreative(creative);
  const videoOwnerPageId = String((creativeQuery.data as any)?.video_owner_page_id || "");

  const hasCurveFromPrimarySource = useMemo(() => {
    return (
      normalizeCurve(ad?.video_play_curve_actions).length > 0 ||
      normalizeCurve((detailQuery.data as any)?.video_play_curve_actions).length > 0
    );
  }, [ad, detailQuery.data]);

  const retentionQuery = useAdPerformanceRetention(
    {
      date_start: dateStart || "",
      date_stop: dateStop || "",
      group_by: "ad_name",
      group_key: groupKey,
      pack_ids: packIds.length > 0 ? packIds : undefined,
    },
    enabled && !!ad && !!groupKey && !!dateStart && !!dateStop && !hasCurveFromPrimarySource,
  );

  const videoQuery = useVideoSource(
    {
      video_id: videoId,
      actor_id: actorId,
      ad_id: adId || undefined,
      video_owner_page_id: videoOwnerPageId || undefined,
    },
    enabled && !!ad && mediaType !== "image" && !!videoId && !!actorId,
  );

  const model = useMemo(() => {
    if (!ad) {
      return null;
    }

    return buildSharedAdDetailModel({
      baseAd: ad,
      detailAd: (detailQuery.data as any) || null,
      retentionFallback: retentionQuery.data || null,
      creativeData: creativeQuery.data || null,
      videoData: videoQuery.data || null,
      actionType,
      mqlLeadscoreMin,
    });
  }, [ad, actionType, creativeQuery.data, detailQuery.data, mqlLeadscoreMin, retentionQuery.data, videoQuery.data]);

  return {
    model,
    detailData: detailQuery.data,
    creativeData: creativeQuery.data,
    videoData: videoQuery.data,
    retentionData: retentionQuery.data,
    isLoadingDetail: detailQuery.isLoading || retentionQuery.isLoading,
    isLoadingMedia: creativeQuery.isLoading || videoQuery.isLoading,
    error: detailQuery.error || retentionQuery.error || creativeQuery.error || videoQuery.error || null,
  };
}
