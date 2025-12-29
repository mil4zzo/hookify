import { RankingsItem, RankingsResponse } from "@/lib/api/schemas";

/**
 * Calcula métricas derivadas de um anúncio (CPR e page_conv)
 * seguindo a mesma lógica usada em outras partes do app.
 */
export function computeAdDerivedMetrics(ad: RankingsItem, actionType?: string): {
  cpr: number;
  page_conv: number;
  hook: number;
  website_ctr: number;
} {
  const spend = Number((ad as any).spend || 0);
  const lpv = Number((ad as any).lpv || 0);
  const results = actionType ? Number((ad as any).conversions?.[actionType] || 0) : 0;
  
  // CPR: se não houver results, tratar como Infinity (acima da média)
  const cpr = results > 0 ? spend / results : Infinity;
  
  // Page conversion: se não houver lpv, tratar como 0
  const page_conv = lpv > 0 ? results / lpv : 0;
  
  const hook = Number((ad as any).hook || 0);
  const website_ctr = Number((ad as any).website_ctr || 0);
  
  return {
    cpr,
    page_conv,
    hook,
    website_ctr,
  };
}

/**
 * Tipo para representar um bucket de classificação G.O.L.D.
 */
export type GoldBucket = "golds" | "oportunidades" | "licoes" | "descartes" | "neutros";

/**
 * Classifica um anúncio em um dos buckets G.O.L.D. baseado nas métricas e médias.
 * 
 * Regras:
 * - Golds: CPR abaixo da média E todas as métricas acima da média
 * - Oportunidades: CPR abaixo da média E pelo menos 1 métrica acima (mas não todas)
 * - Lições: CPR acima da média E pelo menos 1 métrica acima da média
 * - Descartes: CPR acima da média E todas as métricas abaixo da média
 * - Neutros: qualquer outro caso
 */
export function classifyGoldBucket(params: {
  adMetrics: ReturnType<typeof computeAdDerivedMetrics>;
  averages: RankingsResponse["averages"];
  actionType?: string;
}): GoldBucket {
  const { adMetrics, averages, actionType } = params;
  
  // Obter médias
  const avgCpr = actionType && averages?.per_action_type?.[actionType] 
    ? averages.per_action_type[actionType].cpr 
    : null;
  const avgHook = averages?.hook ?? null;
  const avgWebsiteCtr = averages?.website_ctr ?? null;
  const avgPageConv = actionType && averages?.per_action_type?.[actionType]
    ? averages.per_action_type[actionType].page_conv
    : null;
  
  // Se não houver médias, classificar como neutro
  if (avgCpr === null || avgHook === null || avgWebsiteCtr === null || avgPageConv === null) {
    return "neutros";
  }
  
  // Comparar métricas com médias
  const cprBelowAvg = adMetrics.cpr < avgCpr;
  const cprAboveAvg = adMetrics.cpr > avgCpr;
  
  const hookAboveAvg = adMetrics.hook > avgHook;
  const websiteCtrAboveAvg = adMetrics.website_ctr > avgWebsiteCtr;
  const pageConvAboveAvg = adMetrics.page_conv > avgPageConv;
  
  // Contar quantas métricas estão acima da média
  const metricsAboveCount = [
    hookAboveAvg,
    websiteCtrAboveAvg,
    pageConvAboveAvg,
  ].filter(Boolean).length;
  
  const allMetricsAbove = metricsAboveCount === 3;
  const atLeastOneMetricAbove = metricsAboveCount >= 1;
  const allMetricsBelow = metricsAboveCount === 0;
  
  // Aplicar regras de classificação
  if (cprBelowAvg && allMetricsAbove) {
    return "golds";
  }
  
  if (cprBelowAvg && atLeastOneMetricAbove && !allMetricsAbove) {
    return "oportunidades";
  }
  
  if (cprAboveAvg && atLeastOneMetricAbove) {
    return "licoes";
  }
  
  if (cprAboveAvg && allMetricsBelow) {
    return "descartes";
  }
  
  // Caso padrão: neutros
  return "neutros";
}

/**
 * Divide uma lista de anúncios nos buckets G.O.L.D.
 * Retorna um objeto com arrays de anúncios por bucket.
 */
export function splitAdsIntoGoldBuckets(
  ads: RankingsItem[],
  averages: RankingsResponse["averages"],
  actionType?: string
): Record<GoldBucket, RankingsItem[]> {
  const buckets: Record<GoldBucket, RankingsItem[]> = {
    golds: [],
    oportunidades: [],
    licoes: [],
    descartes: [],
    neutros: [],
  };
  
  for (const ad of ads) {
    const adMetrics = computeAdDerivedMetrics(ad, actionType);
    const bucket = classifyGoldBucket({ adMetrics, averages, actionType });
    buckets[bucket].push(ad);
  }
  
  return buckets;
}

