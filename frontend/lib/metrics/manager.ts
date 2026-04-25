import { METRIC_DEFINITIONS, type MetricKey } from "./definitions";
import { formatMetricValueByKind } from "./formatMetricValueCore";
import { getMetricNumericValueOrNull, getResultsForActionType, type MetricValueContext, type MetricValueSource } from "./calculations";

export type ManagerMetricKey = Extract<MetricKey, "spend" | "impressions" | "results" | "mqls" | "cpr" | "cpc" | "cplc" | "cpmql" | "cpm" | "hook" | "ctr" | "website_ctr" | "connect_rate" | "page_conv">;

export interface ManagerAverages {
  count: number;
  spend: number;
  impressions: number;
  clicks: number;
  inline_link_clicks: number;
  lpv: number;
  plays: number;
  results: number;
  hook: number | null;
  hold_rate: number | null;
  video_watched_p50: number | null;
  scroll_stop: number | null;
  ctr: number | null;
  website_ctr: number | null;
  connect_rate: number | null;
  cpm: number | null;
  cpr: number | null;
  cpc: number | null;
  cplc: number | null;
  page_conv: number | null;
  cpmql: number | null;
  mqls: number;
  sumSpend: number;
  sumImpressions: number;
  sumResults: number;
  sumMqls: number;
}

const EMPTY_MANAGER_AVERAGES: ManagerAverages = {
  count: 0,
  spend: 0,
  impressions: 0,
  clicks: 0,
  inline_link_clicks: 0,
  lpv: 0,
  plays: 0,
  results: 0,
  hook: null,
  hold_rate: null,
  video_watched_p50: null,
  scroll_stop: null,
  ctr: null,
  website_ctr: null,
  connect_rate: null,
  cpm: null,
  cpr: null,
  cpc: null,
  cplc: null,
  page_conv: null,
  cpmql: null,
  mqls: 0,
  sumSpend: 0,
  sumImpressions: 0,
  sumResults: 0,
  sumMqls: 0,
};

export const MANAGER_METRIC_KEYS: readonly ManagerMetricKey[] = ["spend", "impressions", "results", "mqls", "cpr", "cpc", "cplc", "cpmql", "cpm", "hook", "ctr", "website_ctr", "connect_rate", "page_conv"] as const;

const MANAGER_SUMMARY_METRICS = new Set<ManagerMetricKey>(["spend", "impressions", "results", "mqls"]);

function getMetricDefinitionLocal(metricKey: string) {
  if (metricKey in METRIC_DEFINITIONS) {
    return METRIC_DEFINITIONS[metricKey as MetricKey];
  }

  return Object.values(METRIC_DEFINITIONS).find((definition) => definition.aliases?.includes(metricKey));
}

function getMetricDisplayLabelLocal(metricKey: string, options: { preferShortLabel?: boolean } = {}): string {
  const definition = getMetricDefinitionLocal(metricKey);
  if (!definition) return metricKey;
  if (options.preferShortLabel && definition.shortLabel) {
    return definition.shortLabel;
  }
  return definition.label;
}

export function isManagerSummaryMetric(metricKey: string): boolean {
  return MANAGER_SUMMARY_METRICS.has(metricKey as ManagerMetricKey);
}

export function isManagerPercentageMetric(metricKey: string): boolean {
  const formatKind = getMetricDefinitionLocal(metricKey)?.formatKind;
  return formatKind === "ratioPercent" || formatKind === "rawPercent";
}

export function getManagerMetricLabel(metricKey: string): string {
  return getMetricDisplayLabelLocal(metricKey, { preferShortLabel: true });
}

export function formatManagerMetricValue(metricKey: string, value: number | null | undefined, options: { currencyFormatter?: (value: number) => string } = {}): string {
  if (value == null || !Number.isFinite(value)) {
    return "";
  }

  const definition = getMetricDefinitionLocal(metricKey);
  if (!definition) {
    return "—";
  }

  return formatMetricValueByKind(value, definition.formatKind, options);
}

export function formatManagerAverageValue(metricKey: ManagerMetricKey, averages: ManagerAverages | null | undefined, options: { currencyFormatter?: (value: number) => string } = {}): string {
  if (!averages) {
    return "";
  }

  if (metricKey === "spend") {
    return formatManagerMetricValue(metricKey, averages.sumSpend, options);
  }

  if (metricKey === "impressions") {
    return formatManagerMetricValue(metricKey, averages.sumImpressions, options);
  }

  if (metricKey === "results") {
    return formatManagerMetricValue(metricKey, averages.sumResults, options);
  }

  if (metricKey === "mqls") {
    return formatManagerMetricValue(metricKey, averages.sumMqls, options);
  }

  return formatManagerMetricValue(metricKey, averages[metricKey], options);
}

function getWeightedMetricValue(source: MetricValueSource, metricKey: Extract<MetricKey, "hook" | "hold_rate" | "video_watched_p50" | "scroll_stop">): number | null {
  if (metricKey === "scroll_stop") {
    const explicitScrollStop = source.scroll_stop ?? source.scroll_stop_value ?? source.scroll_stop_rate;
    const explicitValue = explicitScrollStop == null ? null : Number(explicitScrollStop);
    if (Number.isFinite(explicitValue)) {
      return explicitValue! > 1 ? explicitValue! / 100 : explicitValue;
    }

    const curve = source.video_play_curve_actions;
    if (Array.isArray(curve) && curve.length > 1) {
      const curveValue = Number(curve[1] ?? 0);
      if (Number.isFinite(curveValue) && curveValue >= 0) {
        return curveValue > 1 ? curveValue / 100 : curveValue;
      }
    }
  }

  const value = getMetricNumericValueOrNull(source, metricKey);
  return value != null && Number.isFinite(value) ? value : null;
}

export interface ComputeManagerAveragesOptions extends MetricValueContext {
  hasSheetIntegration?: boolean;
  includeScrollStop?: boolean;
}

export function computeManagerAverages(rows: MetricValueSource[], options: ComputeManagerAveragesOptions = {}): ManagerAverages {
  const { actionType, hasSheetIntegration = false, includeScrollStop = true, mqlLeadscoreMin = 0 } = options;

  if (!Array.isArray(rows) || rows.length === 0) {
    return EMPTY_MANAGER_AVERAGES;
  }

  let sumSpend = 0;
  let sumImpressions = 0;
  let sumClicks = 0;
  let sumInlineLinkClicks = 0;
  let sumLpv = 0;
  let sumPlays = 0;
  let sumResults = 0;
  let sumMqls = 0;

  let hookWeighted = 0;
  let hookWeight = 0;
  let holdRateWeighted = 0;
  let holdRateWeight = 0;
  let watched50Weighted = 0;
  let watched50Weight = 0;
  let scrollStopWeighted = 0;
  let scrollStopWeight = 0;

  for (const row of rows) {
    const spend = getMetricNumericValueOrNull(row, "spend") ?? 0;
    const impressions = getMetricNumericValueOrNull(row, "impressions") ?? 0;
    const clicks = getMetricNumericValueOrNull(row, "clicks") ?? 0;
    const inlineLinkClicks = Number(row.inline_link_clicks ?? 0);
    const lpv = getMetricNumericValueOrNull(row, "lpv") ?? 0;
    const plays = getMetricNumericValueOrNull(row, "plays") ?? 0;
    const results = getResultsForActionType(row, actionType) ?? 0;
    const weight = plays > 0 ? plays : 1;

    sumSpend += spend;
    sumImpressions += impressions;
    sumClicks += clicks;
    sumInlineLinkClicks += Number.isFinite(inlineLinkClicks) ? inlineLinkClicks : 0;
    sumLpv += lpv;
    sumPlays += plays;
    sumResults += results;

    const hook = getWeightedMetricValue(row, "hook");
    if (hook != null) {
      hookWeighted += hook * weight;
      hookWeight += weight;
    }

    const holdRate = getWeightedMetricValue(row, "hold_rate");
    if (holdRate != null) {
      holdRateWeighted += holdRate * weight;
      holdRateWeight += weight;
    }

    const watched50 = getWeightedMetricValue(row, "video_watched_p50");
    if (watched50 != null) {
      watched50Weighted += watched50 * weight;
      watched50Weight += weight;
    }

    if (includeScrollStop) {
      const scrollStop = getWeightedMetricValue(row, "scroll_stop");
      if (scrollStop != null) {
        scrollStopWeighted += scrollStop * weight;
        scrollStopWeight += weight;
      }
    }

    if (hasSheetIntegration) {
      const mqls = getMetricNumericValueOrNull(row, "mqls", { mqlLeadscoreMin }) ?? 0;
      sumMqls += mqls;
    }
  }

  return {
    count: rows.length,
    spend: sumSpend / rows.length,
    impressions: sumImpressions / rows.length,
    clicks: sumClicks / rows.length,
    inline_link_clicks: sumInlineLinkClicks / rows.length,
    lpv: sumLpv / rows.length,
    plays: sumPlays / rows.length,
    results: sumResults / rows.length,
    hook: hookWeight > 0 ? hookWeighted / hookWeight : null,
    hold_rate: holdRateWeight > 0 ? holdRateWeighted / holdRateWeight : null,
    video_watched_p50: watched50Weight > 0 ? watched50Weighted / watched50Weight : null,
    scroll_stop: includeScrollStop && scrollStopWeight > 0 ? scrollStopWeighted / scrollStopWeight : null,
    ctr: sumImpressions > 0 ? sumClicks / sumImpressions : null,
    website_ctr: sumImpressions > 0 ? sumInlineLinkClicks / sumImpressions : null,
    connect_rate: sumInlineLinkClicks > 0 ? sumLpv / sumInlineLinkClicks : null,
    cpm: sumImpressions > 0 ? (sumSpend * 1000) / sumImpressions : null,
    cpr: sumResults > 0 ? sumSpend / sumResults : null,
    cpc: sumClicks > 0 ? sumSpend / sumClicks : null,
    cplc: sumInlineLinkClicks > 0 ? sumSpend / sumInlineLinkClicks : null,
    page_conv: sumLpv > 0 ? sumResults / sumLpv : null,
    cpmql: hasSheetIntegration && sumMqls > 0 ? sumSpend / sumMqls : null,
    mqls: hasSheetIntegration ? sumMqls / rows.length : 0,
    sumSpend,
    sumImpressions,
    sumResults,
    sumMqls,
  };
}

export function buildManagerComputedRow<T extends MetricValueSource>(row: T, context: MetricValueContext = {}): T & {
  results: number;
  page_conv: number;
  cpr: number;
  cpm: number;
  cpc: number;
  cplc: number;
  website_ctr: number;
  mqls: number;
  cpmql: number;
  lpv: number;
  spend: number;
  impressions: number;
  clicks: number;
  inline_link_clicks: number;
} {
  const spend = getMetricNumericValueOrNull(row, "spend", context) ?? 0;
  const impressions = getMetricNumericValueOrNull(row, "impressions", context) ?? 0;
  const clicks = getMetricNumericValueOrNull(row, "clicks", context) ?? 0;
  const inlineLinkClicks = Number(row.inline_link_clicks ?? 0) || 0;
  const lpv = getMetricNumericValueOrNull(row, "lpv", context) ?? 0;
  const results = getMetricNumericValueOrNull(row, "results", context) ?? 0;
  const pageConv = getMetricNumericValueOrNull(row, "page_conv", context) ?? 0;
  const cpr = getMetricNumericValueOrNull(row, "cpr", context) ?? 0;
  const cpm = getMetricNumericValueOrNull(row, "cpm", context) ?? 0;
  const cpc = getMetricNumericValueOrNull(row, "cpc", context) ?? 0;
  const cplc = getMetricNumericValueOrNull(row, "cplc", context) ?? 0;
  const websiteCtr = getMetricNumericValueOrNull(row, "website_ctr", context) ?? 0;
  const mqls = getMetricNumericValueOrNull(row, "mqls", context) ?? 0;
  const cpmql = getMetricNumericValueOrNull(row, "cpmql", context) ?? 0;

  return {
    ...row,
    results,
    page_conv: pageConv,
    cpr,
    cpm,
    cpc,
    cplc,
    website_ctr: websiteCtr,
    mqls,
    cpmql,
    lpv,
    spend,
    impressions,
    clicks,
    inline_link_clicks: inlineLinkClicks,
  };
}
