import { computeMqlMetricsFromLeadscore } from "@/lib/utils/mqlMetrics";
import { type MetricKey, METRIC_DEFINITIONS } from "./definitions";

type MetricKeyLike = MetricKey | string;

export interface MetricValueContext {
  actionType?: string;
  mqlLeadscoreMin?: number;
}

export type MetricValueSource = {
  [key: string]: any;
  score?: number | null;
  spend?: number | null;
  impressions?: number | null;
  clicks?: number | null;
  inline_link_clicks?: number | null;
  lpv?: number | null;
  reach?: number | null;
  ctr?: number | null;
  website_ctr?: number | null;
  connect_rate?: number | null;
  hook?: number | null;
  hold_rate?: number | null;
  scroll_stop?: number | null;
  video_watched_p50?: number | null;
  cpm?: number | null;
  cpr?: number | null;
  cpc?: number | null;
  cplc?: number | null;
  cpmql?: number | null;
  page_conv?: number | null;
  mqls?: number | null;
  mql_count?: number | null;
  plays?: number | null;
  video_total_plays?: number | null;
  conversions?: Record<string, number> | null;
  leadscore_values?: unknown;
};

function toFiniteNumber(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function resolveMetricKey(metricKey: MetricKeyLike): MetricKey | null {
  if (metricKey in METRIC_DEFINITIONS) {
    return metricKey as MetricKey;
  }

  const match = Object.values(METRIC_DEFINITIONS).find((definition) => definition.aliases?.includes(metricKey));
  return match?.key ?? null;
}

export function getResultsForActionType(source: MetricValueSource, actionType?: string): number | null {
  if (!actionType) return null;
  const conversions = source.conversions;
  if (!conversions || typeof conversions !== "object" || Array.isArray(conversions)) {
    return null;
  }

  const candidateKeys = [actionType];

  if (actionType.startsWith("conversion:") || actionType.startsWith("action:")) {
    candidateKeys.push(actionType.replace(/^(conversion|action):/, ""));
  } else {
    candidateKeys.push(`conversion:${actionType}`, `action:${actionType}`);
  }

  for (const candidateKey of candidateKeys) {
    const result = toFiniteNumber(conversions[candidateKey]);
    if (result != null) {
      return result;
    }
  }

  return 0;
}

export function getMetricNumericValueOrNull(source: MetricValueSource, metricKey: MetricKeyLike, context: MetricValueContext = {}): number | null {
  const canonicalKey = resolveMetricKey(metricKey);
  if (!canonicalKey) return null;

  switch (canonicalKey) {
    case "score":
      return toFiniteNumber(source.score);
    case "spend":
    case "ctr":
    case "hook":
    case "hold_rate":
    case "scroll_stop":
    case "video_watched_p50":
    case "impressions":
    case "clicks":
    case "lpv":
    case "reach": {
      return toFiniteNumber(source[canonicalKey]);
    }
    case "plays": {
      return toFiniteNumber(source.plays ?? source.video_total_plays);
    }
    case "results":
      return getResultsForActionType(source, context.actionType);
    case "website_ctr": {
      const fromBackend = toFiniteNumber(source.website_ctr);
      if (fromBackend != null) return fromBackend;

      const impressions = toFiniteNumber(source.impressions);
      const inlineLinkClicks = toFiniteNumber(source.inline_link_clicks);
      if (!impressions || impressions <= 0 || inlineLinkClicks == null) return null;
      return inlineLinkClicks / impressions;
    }
    case "connect_rate": {
      const fromBackend = toFiniteNumber(source.connect_rate);
      if (fromBackend != null) return fromBackend;

      const lpv = toFiniteNumber(source.lpv);
      const inlineLinkClicks = toFiniteNumber(source.inline_link_clicks);
      if (lpv == null || !inlineLinkClicks || inlineLinkClicks <= 0) return null;
      return lpv / inlineLinkClicks;
    }
    case "page_conv": {
      const fromBackend = toFiniteNumber(source.page_conv);
      if (fromBackend != null) return fromBackend;

      const lpv = toFiniteNumber(source.lpv);
      const results = getResultsForActionType(source, context.actionType);
      if (!lpv || lpv <= 0 || results == null) return null;
      return results / lpv;
    }
    case "cpm": {
      const fromBackend = toFiniteNumber(source.cpm);
      if (fromBackend != null) return fromBackend;

      const spend = toFiniteNumber(source.spend);
      const impressions = toFiniteNumber(source.impressions);
      if (spend == null || !impressions || impressions <= 0) return null;
      return (spend * 1000) / impressions;
    }
    case "cpr": {
      const fromBackend = toFiniteNumber(source.cpr);
      if (fromBackend != null && fromBackend > 0) return fromBackend;

      const spend = toFiniteNumber(source.spend);
      const results = getResultsForActionType(source, context.actionType);
      if (spend == null || !results || results <= 0) return null;
      return spend / results;
    }
    case "cpc": {
      const fromBackend = toFiniteNumber(source.cpc);
      if (fromBackend != null && fromBackend > 0) return fromBackend;

      const spend = toFiniteNumber(source.spend);
      const clicks = toFiniteNumber(source.clicks);
      if (spend == null || !clicks || clicks <= 0) return null;
      return spend / clicks;
    }
    case "cplc": {
      const fromBackend = toFiniteNumber(source.cplc);
      if (fromBackend != null && fromBackend > 0) return fromBackend;

      const spend = toFiniteNumber(source.spend);
      const inlineLinkClicks = toFiniteNumber(source.inline_link_clicks);
      if (spend == null || !inlineLinkClicks || inlineLinkClicks <= 0) return null;
      return spend / inlineLinkClicks;
    }
    case "frequency": {
      const fromBackend = toFiniteNumber(source.frequency);
      if (fromBackend != null) return fromBackend;

      const impressions = toFiniteNumber(source.impressions);
      const reach = toFiniteNumber(source.reach);
      if (!impressions || impressions <= 0 || !reach || reach <= 0) return null;
      return impressions / reach;
    }
    case "mqls": {
      const fromBackend = toFiniteNumber(source.mqls ?? source.mql_count);
      if (fromBackend != null) return fromBackend;

      const { mqlCount } = computeMqlMetricsFromLeadscore({
        spend: toFiniteNumber(source.spend) ?? 0,
        leadscoreRaw: source.leadscore_values,
        mqlLeadscoreMin: context.mqlLeadscoreMin ?? 0,
      });

      return Number.isFinite(mqlCount) ? mqlCount : null;
    }
    case "cpmql": {
      const fromBackend = toFiniteNumber(source.cpmql);
      if (fromBackend != null && fromBackend > 0) return fromBackend;

      const spend = toFiniteNumber(source.spend);
      const mqls = getMetricNumericValueOrNull(source, "mqls", context);
      if (spend == null || !mqls || mqls <= 0) return null;
      return spend / mqls;
    }
    default:
      return null;
  }
}

export function getMetricNumericValue(source: MetricValueSource, metricKey: MetricKeyLike, context: MetricValueContext = {}): number {
  return getMetricNumericValueOrNull(source, metricKey, context) ?? 0;
}

function toNumericSeries(series: unknown): Array<number | null> | undefined {
  if (!Array.isArray(series)) return undefined;
  return series.map((value) => {
    const numeric = toFiniteNumber(value);
    return numeric == null ? null : numeric;
  });
}

function divideSeries(numerator: Array<number | null>, denominator: Array<number | null>): Array<number | null> {
  return denominator.map((denominatorValue, index) => {
    const numeratorValue = numerator[index];
    if (numeratorValue == null || denominatorValue == null || denominatorValue <= 0) {
      return null;
    }
    return numeratorValue / denominatorValue;
  });
}

export function buildMetricSeriesFromSourceSeries(seriesData: Record<string, unknown> | undefined, metricKey: MetricKeyLike, context: MetricValueContext = {}): Array<number | null> | undefined {
  if (!seriesData) return undefined;

  const canonicalKey = resolveMetricKey(metricKey);
  if (!canonicalKey) return undefined;

  const directSeries = toNumericSeries(seriesData[canonicalKey] ?? seriesData[metricKey]);
  if (directSeries) {
    return directSeries;
  }

  switch (canonicalKey) {
    case "results": {
      if (!context.actionType || !Array.isArray(seriesData.conversions)) return undefined;
      return (seriesData.conversions as Array<Record<string, number>>).map((conversionMap) => {
        if (!conversionMap || typeof conversionMap !== "object" || Array.isArray(conversionMap)) {
          return null;
        }

        const result = getResultsForActionType({ conversions: conversionMap }, context.actionType);
        return result ?? 0;
      });
    }
    case "website_ctr": {
      const impressionsSeries = toNumericSeries(seriesData.impressions);
      const inlineLinkClicksSeries = toNumericSeries(seriesData.inline_link_clicks);
      if (!impressionsSeries || !inlineLinkClicksSeries) return undefined;
      return divideSeries(inlineLinkClicksSeries, impressionsSeries);
    }
    case "connect_rate": {
      const lpvSeries = toNumericSeries(seriesData.lpv);
      const inlineLinkClicksSeries = toNumericSeries(seriesData.inline_link_clicks);
      if (!lpvSeries || !inlineLinkClicksSeries) return undefined;
      return divideSeries(lpvSeries, inlineLinkClicksSeries);
    }
    case "page_conv": {
      const lpvSeries = toNumericSeries(seriesData.lpv);
      const resultsSeries = buildMetricSeriesFromSourceSeries(seriesData, "results", context);
      if (!lpvSeries || !resultsSeries) return undefined;
      return divideSeries(resultsSeries, lpvSeries);
    }
    case "cpr": {
      const spendSeries = toNumericSeries(seriesData.spend);
      const resultsSeries = buildMetricSeriesFromSourceSeries(seriesData, "results", context);
      if (!spendSeries || !resultsSeries) return undefined;
      return divideSeries(spendSeries, resultsSeries);
    }
    case "cpc": {
      const spendSeries = toNumericSeries(seriesData.spend);
      const clicksSeries = toNumericSeries(seriesData.clicks);
      if (!spendSeries || !clicksSeries) return undefined;
      return divideSeries(spendSeries, clicksSeries);
    }
    case "cplc": {
      const spendSeries = toNumericSeries(seriesData.spend);
      const inlineLinkClicksSeries = toNumericSeries(seriesData.inline_link_clicks);
      if (!spendSeries || !inlineLinkClicksSeries) return undefined;
      return divideSeries(spendSeries, inlineLinkClicksSeries);
    }
    case "cpm": {
      const spendSeries = toNumericSeries(seriesData.spend);
      const impressionsSeries = toNumericSeries(seriesData.impressions);
      if (!spendSeries || !impressionsSeries) return undefined;
      return impressionsSeries.map((impressionsValue, index) => {
        const spendValue = spendSeries[index];
        if (spendValue == null || impressionsValue == null || impressionsValue <= 0) {
          return null;
        }
        return (spendValue * 1000) / impressionsValue;
      });
    }
    case "frequency": {
      const impressionsSeries = toNumericSeries(seriesData.impressions);
      const reachSeries = toNumericSeries(seriesData.reach);
      if (!impressionsSeries || !reachSeries) return undefined;
      return divideSeries(impressionsSeries, reachSeries);
    }
    case "mqls": {
      const mqlsSeries = toNumericSeries(seriesData.mqls);
      if (mqlsSeries) return mqlsSeries;

      const leadscoreSeries = Array.isArray(seriesData.leadscore_values) ? seriesData.leadscore_values : undefined;
      const spendSeries = toNumericSeries(seriesData.spend);
      if (!leadscoreSeries || !spendSeries) return undefined;

      return leadscoreSeries.map((leadscoreRaw, index) => {
        const { mqlCount } = computeMqlMetricsFromLeadscore({
          spend: spendSeries[index] ?? 0,
          leadscoreRaw,
          mqlLeadscoreMin: context.mqlLeadscoreMin ?? 0,
        });

        return Number.isFinite(mqlCount) ? mqlCount : null;
      });
    }
    case "cpmql": {
      const spendSeries = toNumericSeries(seriesData.spend);
      const mqlSeries = buildMetricSeriesFromSourceSeries(seriesData, "mqls", context);
      if (!spendSeries || !mqlSeries) return undefined;
      return divideSeries(spendSeries, mqlSeries);
    }
    default:
      return undefined;
  }
}
