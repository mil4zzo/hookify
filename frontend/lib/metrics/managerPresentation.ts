import { getMetricQualityToneByAverage, type MetricQualityTone } from "@/lib/utils/metricQuality";
import { getMetricNumericValueOrNull, type MetricValueContext, type MetricValueSource } from "./calculations";
import { METRIC_DEFINITIONS } from "./definitions";
import { formatMetricValueByKind } from "./formatMetricValueCore";
import type { ManagerAverages, ManagerMetricKey } from "./manager";

export interface ManagerMetricTrendPresentation {
  useTrendMode: boolean;
  packAverage: number | null;
  inverseColors: boolean;
}

export interface ManagerMetricDeltaPresentation {
  kind: "hidden" | "text";
  text?: string;
  tone?: MetricQualityTone;
}

export type ManagerChildSortColumn = ManagerMetricKey | "status" | "ad_id" | "adset_name";
export type ManagerSortDirection = "asc" | "desc";

export interface GetManagerMetricPresentationOptions extends MetricValueContext {
  hasSheetIntegration?: boolean;
  currencyFormatter?: (value: number) => string;
}

function isInverseManagerMetric(metric: ManagerMetricKey): boolean {
  return METRIC_DEFINITIONS[metric].polarity === "lower";
}

function requiresSheetIntegration(metric: ManagerMetricKey): boolean {
  return METRIC_DEFINITIONS[metric].requiresSheetIntegration === true;
}

function formatManagerMetricValueLocal(
  metric: ManagerMetricKey,
  value: number,
  options: { currencyFormatter?: (value: number) => string } = {},
): string {
  return formatMetricValueByKind(value, METRIC_DEFINITIONS[metric].formatKind, options);
}

export function getManagerMetricTrendPresentation(
  metric: ManagerMetricKey,
  averages: ManagerAverages,
): ManagerMetricTrendPresentation {
  const useTrendMode = metric === "spend";
  const rawAverage = averages[metric];
  const packAverage = useTrendMode || rawAverage == null || !Number.isFinite(rawAverage) ? null : rawAverage;

  return {
    useTrendMode,
    packAverage,
    inverseColors: isInverseManagerMetric(metric),
  };
}

export function getManagerMetricCurrentValue(
  source: MetricValueSource,
  metric: ManagerMetricKey,
  options: GetManagerMetricPresentationOptions = {},
): number | null {
  if (requiresSheetIntegration(metric) && !options.hasSheetIntegration) {
    return null;
  }

  return getMetricNumericValueOrNull(source, metric, options);
}

export function getManagerMetricDeltaPresentation(
  source: MetricValueSource,
  metric: ManagerMetricKey,
  averages: ManagerAverages,
  options: GetManagerMetricPresentationOptions = {},
): ManagerMetricDeltaPresentation {
  const avgValue = averages[metric];
  if (avgValue == null || !Number.isFinite(avgValue)) {
    return { kind: "hidden" };
  }

  const currentValue = getManagerMetricCurrentValue(source, metric, options);
  if (currentValue == null || !Number.isFinite(currentValue)) {
    return { kind: "hidden" };
  }

  const inverse = isInverseManagerMetric(metric);

  if (avgValue === 0 && currentValue === 0) {
    return {
      kind: "text",
      text: "0%",
      tone: "muted-foreground",
    };
  }

  if (avgValue === 0 && currentValue !== 0) {
    return {
      kind: "text",
      text: "+∞",
      tone: inverse ? "destructive" : "success",
    };
  }

  let diffPercent: number;
  if (inverse) {
    diffPercent = ((avgValue - currentValue) / avgValue) * 100;
  } else {
    diffPercent = ((currentValue - avgValue) / avgValue) * 100;
  }

  const sign = inverse ? (diffPercent > 0 ? "-" : "+") : diffPercent > 0 ? "+" : "-";
  const tone = getMetricQualityToneByAverage(currentValue, avgValue, inverse);

  return {
    kind: "text",
    text: `${sign}${Math.abs(diffPercent).toFixed(1)}%`,
    tone,
  };
}

export function formatManagerChildMetricValue(
  metric: ManagerMetricKey,
  source: MetricValueSource,
  options: GetManagerMetricPresentationOptions = {},
): string {
  const value = Number(getMetricNumericValueOrNull(source, metric, options) ?? 0);
  const formatOptions = { currencyFormatter: options.currencyFormatter };

  switch (metric) {
    case "cpr":
      return Number(source.results || 0) > 0 ? formatManagerMetricValueLocal(metric, value, formatOptions) : "—";
    case "cpc":
      return Number(source.clicks || 0) > 0 ? formatManagerMetricValueLocal(metric, value, formatOptions) : "—";
    case "cplc":
      return Number(source.inline_link_clicks || 0) > 0 ? formatManagerMetricValueLocal(metric, value, formatOptions) : "—";
    case "cpmql":
      return Number(source.mqls || 0) > 0 ? formatManagerMetricValueLocal(metric, value, formatOptions) : "—";
    case "page_conv":
      return Number(source.lpv || 0) > 0 ? formatManagerMetricValueLocal(metric, value, formatOptions) : "—";
    default:
      return formatManagerMetricValueLocal(metric, value, formatOptions);
  }
}

function isActiveStatus(status?: string | null): boolean {
  return status != null && String(status).toUpperCase() === "ACTIVE";
}

export function getManagerChildSortInitialDirection(column: string): ManagerSortDirection {
  return column === "status" || column === "ad_id" || column === "adset_name" ? "asc" : "desc";
}

export function compareManagerChildRows(
  a: MetricValueSource,
  b: MetricValueSource,
  column: ManagerChildSortColumn,
  direction: ManagerSortDirection,
): number {
  if (column === "status") {
    const activeA = isActiveStatus(a.effective_status as string | null | undefined);
    const activeB = isActiveStatus(b.effective_status as string | null | undefined);
    if (activeA === activeB) return 0;
    const comparison = activeA && !activeB ? -1 : 1;
    return direction === "asc" ? comparison : -comparison;
  }

  if (column === "ad_id" || column === "adset_name") {
    const aValue = String(a[column] || "");
    const bValue = String(b[column] || "");
    return direction === "asc" ? aValue.localeCompare(bValue) : bValue.localeCompare(aValue);
  }

  const aValue = Number(a[column] || 0);
  const bValue = Number(b[column] || 0);
  return direction === "asc" ? aValue - bValue : bValue - aValue;
}
