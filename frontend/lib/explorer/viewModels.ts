import type { RankingsItem, RankingsResponse } from "@/lib/api/schemas";
import type { SharedAdDetailModel } from "@/lib/ads/sharedAdDetail";
import { formatMetricValue, getMetricDisplayLabel, getMetricNumericValueOrNull, isLowerBetterMetric } from "@/lib/metrics";
import type { ExplorerDetailViewModel, ExplorerKanbanMetricKey, ExplorerListItemViewModel, ExplorerSortDirection, ExplorerSortState } from "./types";

interface ExplorerMetricContext {
  actionType?: string;
  mqlLeadscoreMin?: number;
}

export const DEFAULT_EXPLORER_SORT_STATE: ExplorerSortState = {
  metricKey: "spend",
  direction: "desc",
};

function isFiniteMetricValue(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function getAverageFromRows(rows: RankingsItem[], metricKey: ExplorerKanbanMetricKey, context: ExplorerMetricContext = {}): number | null {
  const values = rows
    .map((row) => getMetricNumericValueOrNull(row, metricKey, context))
    .filter(isFiniteMetricValue);

  if (values.length === 0) {
    return null;
  }

  return values.reduce((accumulator, value) => accumulator + value, 0) / values.length;
}

function getResponseMetricAverage(
  response: RankingsResponse | undefined,
  metricKey: ExplorerKanbanMetricKey,
  context: ExplorerMetricContext = {},
): number | null {
  switch (metricKey) {
    case "hook":
      return response?.averages?.hook ?? null;
    case "hold_rate":
      return response?.averages?.hold_rate ?? null;
    case "video_watched_p50":
      return response?.averages?.video_watched_p50 ?? null;
    case "scroll_stop":
      return response?.averages?.scroll_stop ?? null;
    case "website_ctr":
      return response?.averages?.website_ctr ?? null;
    case "connect_rate":
      return response?.averages?.connect_rate ?? null;
    case "cpm":
      return response?.averages?.cpm ?? null;
    case "cpc":
      return response?.averages?.cpc ?? null;
    case "cpr":
      return context.actionType ? response?.averages?.per_action_type?.[context.actionType]?.cpr ?? null : null;
    case "page_conv":
      return context.actionType ? response?.averages?.per_action_type?.[context.actionType]?.page_conv ?? null : null;
    default:
      return null;
  }
}

export function getExplorerGroupKey(ad: RankingsItem): string {
  return String(ad.group_key || ad.ad_name || ad.unique_id || ad.ad_id || "");
}

export function getExplorerMetricValue(
  ad: RankingsItem,
  metricKey: ExplorerKanbanMetricKey,
  context: ExplorerMetricContext = {},
): number | null {
  return getMetricNumericValueOrNull(ad, metricKey, context);
}

export function getExplorerMetricLabel(metricKey: ExplorerKanbanMetricKey): string {
  return getMetricDisplayLabel(metricKey, { preferShortLabel: true });
}

export function getExplorerInitialSortDirection(metricKey: ExplorerKanbanMetricKey): ExplorerSortDirection {
  if (metricKey === "spend") {
    return "desc";
  }

  return isLowerBetterMetric(metricKey) ? "asc" : "desc";
}

export function compareExplorerAdsByMetric(
  a: RankingsItem,
  b: RankingsItem,
  sortState: ExplorerSortState,
  context: ExplorerMetricContext = {},
): number {
  const aValue = getExplorerMetricValue(a, sortState.metricKey, context);
  const bValue = getExplorerMetricValue(b, sortState.metricKey, context);
  const aMissing = !isFiniteMetricValue(aValue);
  const bMissing = !isFiniteMetricValue(bValue);

  if (aMissing && !bMissing) {
    return 1;
  }

  if (!aMissing && bMissing) {
    return -1;
  }

  if (!aMissing && !bMissing) {
    const difference = sortState.direction === "asc" ? aValue - bValue : bValue - aValue;
    if (difference !== 0) {
      return difference;
    }
  }

  const nameDifference = String(a.ad_name || "").localeCompare(String(b.ad_name || ""), "pt-BR");
  if (nameDifference !== 0) {
    return nameDifference;
  }

  return getExplorerGroupKey(a).localeCompare(getExplorerGroupKey(b), "pt-BR");
}

export function buildExplorerListItemViewModel(
  ad: RankingsItem,
  metricKey: ExplorerKanbanMetricKey,
  context: ExplorerMetricContext = {},
): ExplorerListItemViewModel {
  const metricValue = getExplorerMetricValue(ad, metricKey, context);
  const metricFormatted = isFiniteMetricValue(metricValue) ? formatMetricValue(metricKey, metricValue) : "—";

  return {
    groupKey: getExplorerGroupKey(ad),
    adName: String(ad.ad_name || "Criativo sem nome"),
    campaignName: String(ad.campaign_name || "Campanha indisponivel"),
    accountLabel: String(ad.account_id || "Conta indisponivel"),
    searchableStatus: ad.effective_status || null,
    primaryMetricLabel: getExplorerMetricLabel(metricKey),
    primaryMetricKey: metricKey,
    primaryMetricValue: metricValue,
    primaryMetricFormatted: metricFormatted,
    cardData: {
      ...ad,
      ad_id: ad.ad_id,
      ad_name: ad.ad_name,
      thumbnail: ad.thumbnail || null,
      metricValue,
      metricFormatted,
      effective_status: ad.effective_status,
    },
  };
}

export function buildExplorerDetailViewModel(ad: RankingsItem, detail: SharedAdDetailModel): ExplorerDetailViewModel {
  return {
    groupKey: getExplorerGroupKey(ad),
    adName: String(ad.ad_name || "Criativo sem nome"),
    campaignName: String(ad.campaign_name || "Campanha indisponivel"),
    accountLabel: String(ad.account_id || "Conta indisponivel"),
    rawAd: ad,
    detail,
  };
}

export function getExplorerMetricAverage(
  response: RankingsResponse | undefined,
  rows: RankingsItem[],
  metricKey: ExplorerKanbanMetricKey,
  context: ExplorerMetricContext = {},
): number | null {
  const responseAverage = getResponseMetricAverage(response, metricKey, context);
  if (isFiniteMetricValue(responseAverage)) {
    return responseAverage;
  }

  return getAverageFromRows(rows, metricKey, context);
}
