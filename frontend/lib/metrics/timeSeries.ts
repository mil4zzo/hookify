import type { FormattedAd } from "@/lib/api/schemas";
import { getHookAt, normalizeCurveToDecimal } from "@/lib/utils/metricsShared";
import { buildMetricSeriesFromSourceSeries, getResultsForActionType, type MetricValueContext } from "./calculations";
import type { MetricKey } from "./definitions";

export type MetricSeriesPoint = number | null;

export type MetricBaseSeries = {
  spend?: MetricSeriesPoint[];
  impressions?: MetricSeriesPoint[];
  clicks?: MetricSeriesPoint[];
  inline_link_clicks?: MetricSeriesPoint[];
  lpv?: MetricSeriesPoint[];
  plays?: MetricSeriesPoint[];
  hook?: MetricSeriesPoint[];
  conversions?: Array<Record<string, number>>;
  leadscore_values?: unknown[];
  mqls?: MetricSeriesPoint[];
  results?: MetricSeriesPoint[];
  ctr?: MetricSeriesPoint[];
  connect_rate?: MetricSeriesPoint[];
  cpm?: MetricSeriesPoint[];
  cpc?: MetricSeriesPoint[];
  cplc?: MetricSeriesPoint[];
  website_ctr?: MetricSeriesPoint[];
  page_conv?: MetricSeriesPoint[];
  cpr?: MetricSeriesPoint[];
  cpmql?: MetricSeriesPoint[];
  [key: string]: unknown;
};

export interface GroupedMetricSeriesEntry {
  axis: string[];
  series: MetricBaseSeries;
}

export type GroupedMetricSeriesByKey = Map<string, GroupedMetricSeriesEntry>;

export type TimeSeriesGroupBy = "ad_id" | "ad_name";

export type MetricSparklineKey = Extract<
  MetricKey,
  "hook" | "cpr" | "cpc" | "cplc" | "spend" | "ctr" | "website_ctr" | "connect_rate" | "page_conv" | "cpm" | "cpmql" | "results" | "mqls"
>;

export interface BuildGroupedMetricBaseSeriesOptions extends MetricValueContext {
  groupBy: TimeSeriesGroupBy;
  endDate: string;
  dateField?: string;
  windowDays?: number;
}

export interface MetricSeriesAvailability {
  dataAvailability: boolean[];
  zeroValueLabel?: string;
}

type AccumulatorPoint = {
  spend: number;
  impressions: number;
  clicks: number;
  inline_link_clicks: number;
  lpv: number;
  plays: number;
  hookWeightedSum: number;
  conversions: Record<string, number>;
};

function toDay(value: string): string {
  return value.slice(0, 10);
}

export function buildTimeSeriesAxis(endDate: string, windowDays: number): string[] {
  const [year, month, day] = endDate.split("-").map(Number);
  if (!year || !month || !day) {
    return [];
  }

  const axis: string[] = [];
  for (let index = windowDays - 1; index >= 0; index -= 1) {
    const targetDay = day - index;
    let finalYear = year;
    let finalMonth = month;
    let finalDay = targetDay;

    if (finalDay <= 0) {
      finalMonth -= 1;
      if (finalMonth <= 0) {
        finalMonth = 12;
        finalYear -= 1;
      }
      const daysInPreviousMonth = new Date(finalYear, finalMonth, 0).getDate();
      finalDay = daysInPreviousMonth + finalDay;
    }

    axis.push(`${finalYear}-${String(finalMonth).padStart(2, "0")}-${String(finalDay).padStart(2, "0")}`);
  }

  return axis;
}

function createEmptyAccumulator(windowDays: number): AccumulatorPoint[] {
  return Array.from({ length: windowDays }, () => ({
    spend: 0,
    impressions: 0,
    clicks: 0,
    inline_link_clicks: 0,
    lpv: 0,
    plays: 0,
    hookWeightedSum: 0,
    conversions: {},
  }));
}

function getSeriesGroupingKey(ad: FormattedAd, groupBy: TimeSeriesGroupBy): string | null {
  const accountId = String(ad.account_id || "");
  const adId = String(ad.ad_id || "");
  const adName = String(ad.ad_name || "");

  if (groupBy === "ad_id") {
    if (!adId) return null;
    return `${accountId}:${adId}`;
  }

  return String(adName || adId || "");
}

function collectConversionsByActionType(ad: FormattedAd): Record<string, number> {
  const conversions = Array.isArray(ad.conversions) ? ad.conversions : [];
  return conversions.reduce<Record<string, number>>((accumulator, item) => {
    const actionType = String(item?.action_type || "");
    if (!actionType) return accumulator;
    accumulator[actionType] = (accumulator[actionType] ?? 0) + Number(item?.value || 0);
    return accumulator;
  }, {});
}

function collectLandingPageViews(ad: FormattedAd): number {
  const actions = Array.isArray(ad.actions) ? ad.actions : [];
  const lpv = actions.find((item) => item?.action_type === "landing_page_view")?.value;
  return Number(lpv || 0);
}

function toNullableSeries(values: number[]): MetricSeriesPoint[] {
  return values.map((value) => (value > 0 ? value : null));
}

function deriveSeriesFromBase(baseSeries: MetricBaseSeries, context: MetricValueContext): MetricBaseSeries {
  const hookFromBase = Array.isArray(baseSeries.hook)
    ? baseSeries.hook
    : Array.isArray(baseSeries.plays)
      ? baseSeries.plays.map((_, index) => {
          const plays = baseSeries.plays?.[index];
          const hook = baseSeries.hook?.[index];
          if (hook != null) return hook;
          return plays != null && plays > 0 ? 0 : null;
        })
      : undefined;

  return {
    ...baseSeries,
    hook: hookFromBase,
    results: buildMetricSeriesFromSourceSeries(baseSeries, "results", context),
    website_ctr: buildMetricSeriesFromSourceSeries(baseSeries, "website_ctr", context),
    page_conv: buildMetricSeriesFromSourceSeries(baseSeries, "page_conv", context),
    cpr: buildMetricSeriesFromSourceSeries(baseSeries, "cpr", context),
    cpc: buildMetricSeriesFromSourceSeries(baseSeries, "cpc", context),
    cplc: buildMetricSeriesFromSourceSeries(baseSeries, "cplc", context),
    cpm: buildMetricSeriesFromSourceSeries(baseSeries, "cpm", context),
    mqls: buildMetricSeriesFromSourceSeries(baseSeries, "mqls", context),
    cpmql: buildMetricSeriesFromSourceSeries(baseSeries, "cpmql", context),
  };
}

export function buildGroupedMetricBaseSeries(
  ads: FormattedAd[] = [],
  { groupBy, endDate, dateField = "date", windowDays = 5, actionType, mqlLeadscoreMin }: BuildGroupedMetricBaseSeriesOptions,
): { byKey: GroupedMetricSeriesByKey; axis: string[] } {
  const axis = buildTimeSeriesAxis(endDate, windowDays);
  const indexByDay = new Map(axis.map((day, index) => [day, index] as const));
  const accumulator = new Map<string, AccumulatorPoint[]>();

  for (const ad of ads) {
    const rawDate = ad?.[dateField as keyof FormattedAd];
    if (!rawDate) continue;

    const day = toDay(String(rawDate));
    const axisIndex = indexByDay.get(day);
    if (axisIndex == null) continue;

    const groupingKey = getSeriesGroupingKey(ad, groupBy);
    if (!groupingKey) continue;

    if (!accumulator.has(groupingKey)) {
      accumulator.set(groupingKey, createEmptyAccumulator(axis.length));
    }

    const point = accumulator.get(groupingKey)![axisIndex];
    const plays = Number(ad.video_total_plays || 0);
    const curve = normalizeCurveToDecimal(ad.video_play_curve_actions);
    const hookValue = getHookAt(curve, 3);
    const conversionsByActionType = collectConversionsByActionType(ad);

    point.spend += Number(ad.spend || 0);
    point.impressions += Number(ad.impressions || 0);
    point.clicks += Number(ad.clicks || 0);
    point.inline_link_clicks += Number(ad.inline_link_clicks || 0);
    point.lpv += collectLandingPageViews(ad);
    point.plays += plays;
    point.hookWeightedSum += hookValue * plays;

    for (const [conversionKey, conversionValue] of Object.entries(conversionsByActionType)) {
      point.conversions[conversionKey] = (point.conversions[conversionKey] ?? 0) + conversionValue;
    }
  }

  const byKey: GroupedMetricSeriesByKey = new Map();
  for (const [groupingKey, points] of accumulator.entries()) {
    const baseSeries: MetricBaseSeries = {
      spend: toNullableSeries(points.map((point) => point.spend)),
      impressions: toNullableSeries(points.map((point) => point.impressions)),
      clicks: toNullableSeries(points.map((point) => point.clicks)),
      inline_link_clicks: toNullableSeries(points.map((point) => point.inline_link_clicks)),
      lpv: toNullableSeries(points.map((point) => point.lpv)),
      plays: toNullableSeries(points.map((point) => point.plays)),
      hook: points.map((point) => (point.plays > 0 ? point.hookWeightedSum / point.plays : null)),
      conversions: points.map((point) => point.conversions),
      ctr: points.map((point) => (point.impressions > 0 ? point.clicks / point.impressions : null)),
      connect_rate: points.map((point) => (point.inline_link_clicks > 0 ? point.lpv / point.inline_link_clicks : null)),
    };

    byKey.set(groupingKey, {
      axis,
      series: deriveSeriesFromBase(baseSeries, {
        actionType,
        mqlLeadscoreMin,
      }),
    });
  }

  return { byKey, axis };
}

export function getMetricSeriesAvailability(
  seriesData: MetricBaseSeries | undefined,
  metric: MetricSparklineKey,
  context: MetricValueContext = {},
): MetricSeriesAvailability {
  if (!seriesData) {
    return { dataAvailability: [] };
  }

  switch (metric) {
    case "hook": {
      const impressions = seriesData.impressions || [];
      return {
        dataAvailability: impressions.map((value) => value != null && value > 0),
        zeroValueLabel: "Sem hook",
      };
    }
    case "ctr":
    case "website_ctr":
    case "cpm": {
      const impressions = seriesData.impressions || [];
      return {
        dataAvailability: impressions.map((value) => value != null && value > 0),
        zeroValueLabel: metric === "cpm" ? undefined : "Sem cliques",
      };
    }
    case "connect_rate": {
      const impressions = seriesData.impressions || [];
      return {
        dataAvailability: impressions.map((value) => value != null && value > 0),
        zeroValueLabel: "Sem conexões",
      };
    }
    case "page_conv": {
      const lpv = seriesData.lpv || [];
      return {
        dataAvailability: lpv.map((value) => value != null && value > 0),
        zeroValueLabel: "Sem leads",
      };
    }
    case "cpr": {
      const spend = seriesData.spend || [];
      return {
        dataAvailability: spend.map((value) => value != null && value > 0),
        zeroValueLabel: "Sem leads",
      };
    }
    case "cpc": {
      const clicks = seriesData.clicks || [];
      const spend = seriesData.spend || [];
      return {
        dataAvailability:
          clicks.length > 0
            ? clicks.map((value) => value != null && value > 0)
            : spend.map((value) => value != null && value > 0),
        zeroValueLabel: "Sem cliques",
      };
    }
    case "cplc": {
      const inlineClicks = seriesData.inline_link_clicks || [];
      const spend = seriesData.spend || [];
      return {
        dataAvailability:
          inlineClicks.length > 0
            ? inlineClicks.map((value) => value != null && value > 0)
            : spend.map((value) => value != null && value > 0),
        zeroValueLabel: "Sem link clicks",
      };
    }
    case "cpmql": {
      const spend = seriesData.spend || [];
      return {
        dataAvailability: spend.map((value) => value != null && value > 0),
        zeroValueLabel: "Sem MQLs",
      };
    }
    case "results": {
      const conversions = seriesData.conversions || [];
      return {
        dataAvailability: conversions.map((dayConversion) => {
          if (!dayConversion || typeof dayConversion !== "object" || Array.isArray(dayConversion)) {
            return false;
          }
          const result = context.actionType
            ? Number(getResultsForActionType({ conversions: dayConversion }, context.actionType) || 0)
            : 0;
          return result > 0;
        }),
        zeroValueLabel: "Sem leads",
      };
    }
    case "mqls": {
      const mqls = seriesData.mqls || [];
      const leadscoreValues = seriesData.leadscore_values || [];
      if (mqls.length > 0) {
        return {
          dataAvailability: mqls.map((value) => value != null && value > 0),
          zeroValueLabel: "Sem MQLs",
        };
      }
      if (leadscoreValues.length > 0) {
        return {
          dataAvailability: leadscoreValues.map((value) => value != null),
          zeroValueLabel: "Sem MQLs",
        };
      }
      return {
        dataAvailability: [],
        zeroValueLabel: "Sem MQLs",
      };
    }
    case "spend": {
      const spend = seriesData.spend || [];
      return {
        dataAvailability: spend.map((value) => value != null && value > 0),
      };
    }
    default: {
      const spend = seriesData.spend || [];
      return {
        dataAvailability: spend.map((value) => value != null && value > 0),
      };
    }
  }
}
