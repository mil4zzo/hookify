import { RankingsItem } from "@/lib/api/schemas";
import { formatMetricValue, getMetricNumericValue, isLowerBetterMetric, type MetricKey } from "@/lib/metrics";

export type GemsMetricKey = Extract<MetricKey, "hook" | "website_ctr" | "ctr" | "page_conv" | "hold_rate" | "cpr" | "cpmql">;

export type GemsTopItem = RankingsItem & {
  metricValue: number;
  metricFormatted: string;
};

function formatMetric(value: number, metric: GemsMetricKey): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return "—";
  return formatMetricValue(metric, value);
}

export function getMetricValue(ad: any, metric: GemsMetricKey, actionType: string, mqlLeadscoreMin: number = 0): number {
  return getMetricNumericValue(ad, metric, { actionType, mqlLeadscoreMin });
}

export function computeTopMetric(ads: RankingsItem[], metric: GemsMetricKey, actionType: string, limit: number, mqlLeadscoreMin: number = 0): GemsTopItem[] {
  if (!Array.isArray(ads) || ads.length === 0 || limit <= 0) return [];

  const withMetric = ads
    .map((ad) => {
      const metricValue = getMetricValue(ad, metric, actionType, mqlLeadscoreMin);
      return {
        ...(ad as any),
        metricValue,
      };
    })
    .filter((ad) => ad.metricValue > 0 && !isNaN(ad.metricValue))
    .sort((a, b) => (isLowerBetterMetric(metric) ? a.metricValue - b.metricValue : b.metricValue - a.metricValue))
    .slice(0, limit)
    .map((ad) => ({
      ...(ad as any),
      metricValue: ad.metricValue,
      metricFormatted: formatMetric(ad.metricValue, metric),
    }));

  return withMetric;
}


