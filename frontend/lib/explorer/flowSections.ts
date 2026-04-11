import { formatMetricValue, getMetricAverageTooltip, getMetricBetterDirection, getMetricDisplayLabel, type MetricKey } from "@/lib/metrics";
import type { SharedAdDetailModel } from "@/lib/ads/sharedAdDetail";
import type { ExplorerMetricAverages, ExplorerMetricCard } from "./types";

export interface ExplorerFlowSections {
  auction: ExplorerMetricCard[];
  retention: ExplorerMetricCard[];
  funnel: ExplorerMetricCard[];
  results: ExplorerMetricCard[];
}

interface BuildMetricCardOptions {
  metricKey: MetricKey;
  value: number | null | undefined;
  averageValue: number | null | undefined;
  detail: SharedAdDetailModel;
  currencyFormatter?: (value: number) => string;
  subtitle?: string;
  subtitleInLabelRow?: boolean;
  colorMode?: "series" | "per-bar";
  disableSeriesFallback?: boolean;
}

function formatDisplayValue(metricKey: MetricKey, value: number | null | undefined, currencyFormatter?: (value: number) => string): string {
  return value != null ? formatMetricValue(metricKey, value, { currencyFormatter }) : "—";
}

function formatDeltaDisplay(valueRaw: number | null | undefined, avgRaw: number | null | undefined): string | undefined {
  if (
    valueRaw == null ||
    avgRaw == null ||
    Number.isNaN(valueRaw) ||
    Number.isNaN(avgRaw) ||
    !Number.isFinite(valueRaw) ||
    !Number.isFinite(avgRaw) ||
    avgRaw === 0
  ) {
    return undefined;
  }

  const diff = (valueRaw - avgRaw) / Math.abs(avgRaw);
  const sign = diff > 0 ? "+" : "";
  return `${sign}${(diff * 100).toFixed(1)}%`;
}

function buildMetricCard({
  metricKey,
  value,
  averageValue,
  detail,
  currencyFormatter,
  subtitle,
  subtitleInLabelRow = false,
  colorMode,
  disableSeriesFallback = false,
}: BuildMetricCardOptions): ExplorerMetricCard {
  const better = getMetricBetterDirection(metricKey);

  return {
    label: getMetricDisplayLabel(metricKey),
    value: formatDisplayValue(metricKey, value, currencyFormatter),
    deltaDisplay: formatDeltaDisplay(value, averageValue),
    subtitle,
    subtitleInLabelRow,
    averageDisplay: averageValue != null ? formatDisplayValue(metricKey, averageValue, currencyFormatter) : undefined,
    averageTooltip: getMetricAverageTooltip(metricKey),
    series: (detail.series?.[metricKey] as Array<number | null | undefined> | undefined) ?? undefined,
    inverse: better === "lower",
    formatFn: (metricValue: number) => formatDisplayValue(metricKey, metricValue, currencyFormatter),
    valueRaw: value ?? null,
    avgRaw: averageValue ?? null,
    better,
    packAverage: averageValue ?? null,
    colorMode,
    disableSeriesFallback,
  };
}

export function buildExplorerFlowSections(
  detail: SharedAdDetailModel,
  averages: ExplorerMetricAverages | undefined,
  currencyFormatter?: (value: number) => string,
): ExplorerFlowSections {
  const auction = [
    buildMetricCard({
      metricKey: "cpm",
      value: detail.cpm,
      averageValue: averages?.cpm,
      detail,
      currencyFormatter,
    }),
  ];

  const retention = [
    buildMetricCard({
      metricKey: "scroll_stop",
      value: detail.scrollStop,
      averageValue: averages?.scroll_stop,
      detail,
      currencyFormatter,
    }),
    buildMetricCard({
      metricKey: "hook",
      value: detail.hook,
      averageValue: averages?.hook,
      detail,
      currencyFormatter,
    }),
    buildMetricCard({
      metricKey: "hold_rate",
      value: detail.holdRate,
      averageValue: averages?.hold_rate,
      detail,
      currencyFormatter,
    }),
    buildMetricCard({
      metricKey: "video_watched_p50",
      value: detail.videoWatchedP50,
      averageValue: averages?.video_watched_p50,
      detail,
      currencyFormatter,
    }),
  ];

  const funnel = [
    buildMetricCard({
      metricKey: "website_ctr",
      value: detail.websiteCtr,
      averageValue: averages?.website_ctr,
      detail,
      currencyFormatter,
    }),
    buildMetricCard({
      metricKey: "connect_rate",
      value: detail.connectRate,
      averageValue: averages?.connect_rate,
      detail,
      currencyFormatter,
    }),
    buildMetricCard({
      metricKey: "page_conv",
      value: detail.pageConv,
      averageValue: averages?.page_conv,
      detail,
      currencyFormatter,
    }),
  ];

  const results = [
    buildMetricCard({
      metricKey: "cpc",
      value: detail.hasCpc ? detail.cpc : null,
      averageValue: averages?.cpc,
      detail,
      currencyFormatter,
      subtitle: `${detail.source.clicks?.toLocaleString("pt-BR") ?? "0"} clicks`,
      subtitleInLabelRow: true,
    }),
    buildMetricCard({
      metricKey: "cpr",
      value: detail.hasCpr ? detail.cpr : null,
      averageValue: averages?.cpr,
      detail,
      currencyFormatter,
      subtitle: `${detail.results?.toLocaleString("pt-BR") ?? "0"} results`,
      subtitleInLabelRow: true,
    }),
    buildMetricCard({
      metricKey: "cpmql",
      value: detail.cpmql != null && detail.cpmql > 0 ? detail.cpmql : null,
      averageValue: averages?.cpmql,
      detail,
      currencyFormatter,
      subtitle: `${detail.mqlCount.toLocaleString("pt-BR")} MQLs`,
      subtitleInLabelRow: true,
    }),
  ];

  return {
    auction,
    retention,
    funnel,
    results,
  };
}
