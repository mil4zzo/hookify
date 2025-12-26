import { RankingsItem } from "@/lib/api/schemas";
import { computeMqlMetricsFromLeadscore } from "./mqlMetrics";

export type GemsMetricKey = "hook" | "website_ctr" | "ctr" | "page_conv" | "hold_rate" | "cpr" | "cpmql";

export type GemsTopItem = RankingsItem & {
  metricValue: number;
  metricFormatted: string;
};

function formatMetric(value: number, metric: GemsMetricKey): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return "—";
  // CPR e CPMQL são em moeda (R$), as outras são percentuais
  if (metric === "cpr" || metric === "cpmql") {
    return `R$ ${value.toFixed(2)}`;
  }
  return `${(value * 100).toFixed(2)}%`;
}

export function getMetricValue(ad: any, metric: GemsMetricKey, actionType: string, mqlLeadscoreMin: number = 0): number {
  switch (metric) {
    case "hook":
      return Number(ad.hook || 0);
    case "website_ctr":
      return Number(ad.website_ctr || 0);
    case "ctr":
      return Number(ad.ctr || 0);
    case "hold_rate":
      return Number((ad as any).hold_rate || 0);
    case "page_conv": {
      const lpv = Number(ad.lpv || 0);
      const results = actionType ? Number(ad.conversions?.[actionType] || 0) : 0;
      return lpv > 0 ? results / lpv : 0;
    }
    case "cpr": {
      // Se o ad já tem CPR calculado (vem do ranking), usar esse valor
      if ("cpr" in ad && typeof ad.cpr === "number" && ad.cpr > 0) {
        return ad.cpr;
      }
      // Caso contrário, calcular baseado no actionType
      if (!actionType) return 0;
      const spend = Number(ad.spend || 0);
      const results = Number(ad.conversions?.[actionType] || 0);
      if (!results) return 0;
      return spend / results;
    }
    case "cpmql": {
      // Calcular CPMQL usando a função centralizada
      const spend = Number(ad.spend || 0);
      const { cpmql } = computeMqlMetricsFromLeadscore({
        spend,
        leadscoreRaw: (ad as any).leadscore_values,
        mqlLeadscoreMin,
      });
      return Number.isFinite(cpmql) && cpmql > 0 ? cpmql : 0;
    }
    default:
      return 0;
  }
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
    // Para CPR e CPMQL, ordenar crescente (menor é melhor), para outras métricas, decrescente (maior é melhor)
    .sort((a, b) => (metric === "cpr" || metric === "cpmql" ? a.metricValue - b.metricValue : b.metricValue - a.metricValue))
    .slice(0, limit)
    .map((ad) => ({
      ...(ad as any),
      metricValue: ad.metricValue,
      metricFormatted: formatMetric(ad.metricValue, metric),
    }));

  return withMetric;
}


