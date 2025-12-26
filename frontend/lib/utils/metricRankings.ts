import { RankingsItem } from "@/lib/api/schemas";
import { ValidationCondition } from "@/components/common/ValidationCriteriaBuilder";
import { evaluateValidationCriteria, AdMetricsData } from "@/lib/utils/validateAdCriteria";
import { OpportunityRow } from "./opportunity";
import { computeMqlMetricsFromLeadscore } from "./mqlMetrics";

/**
 * Rankings globais de métricas por ad_id
 */
export type MetricRanks = {
  hookRank: Map<string | null, number>;
  holdRateRank: Map<string | null, number>;
  websiteCtrRank: Map<string | null, number>;
  connectRateRank: Map<string | null, number>;
  pageConvRank: Map<string | null, number>;
  ctrRank: Map<string | null, number>;
  cprRank: Map<string | null, number>;
  cpmqlRank: Map<string | null, number>;
  spendRank: Map<string | null, number>;
};

/**
 * Opções para cálculo de rankings
 */
export interface MetricRankingsOptions {
  /** Critérios de validação para filtrar anúncios */
  validationCriteria?: ValidationCondition[];
  /** ActionType para calcular page_conv */
  actionType?: string;
  /** Se true, inclui apenas anúncios com métricas válidas (> 0 e finitas) */
  filterValidOnly?: boolean;
  /** Leadscore mínimo para calcular MQL/CPMQL */
  mqlLeadscoreMin?: number;
}

/**
 * Mapeia RankingsItem para AdMetricsData para validação
 */
function mapRankingToMetrics(ad: RankingsItem, actionType: string): AdMetricsData {
  const impressions = Number((ad as any).impressions || 0);
  const spend = Number((ad as any).spend || 0);
  // CPM: priorizar valor do backend, senão calcular
  const cpm = typeof (ad as any).cpm === "number" && !Number.isNaN((ad as any).cpm) && isFinite((ad as any).cpm) ? (ad as any).cpm : impressions > 0 ? (spend * 1000) / impressions : 0;
  const website_ctr = Number((ad as any).website_ctr || 0);
  const connect_rate = Number((ad as any).connect_rate || 0);
  const lpv = Number((ad as any).lpv || 0);
  const results = actionType ? Number((ad as any).conversions?.[actionType] || 0) : 0;
  const page_conv = lpv > 0 ? results / lpv : 0;
  const overall_conversion = website_ctr * connect_rate * page_conv;

  return {
    ad_name: (ad as any).ad_name,
    ad_id: (ad as any).ad_id,
    account_id: (ad as any).account_id,
    impressions,
    spend,
    cpm,
    website_ctr,
    connect_rate,
    inline_link_clicks: Number((ad as any).inline_link_clicks || 0),
    clicks: Number((ad as any).clicks || 0),
    plays: Number((ad as any).plays || 0),
    hook: Number((ad as any).hook || 0),
    ctr: Number((ad as any).ctr || 0),
    page_conv,
    overall_conversion,
  };
}

/**
 * Obtém o valor de uma métrica específica de um RankingsItem
 */
function getMetricValue(ad: RankingsItem, metric: "hook" | "website_ctr" | "ctr" | "page_conv" | "hold_rate" | "cpr" | "cpmql", actionType?: string, mqlLeadscoreMin: number = 0): number {
  switch (metric) {
    case "hook":
      return Number(ad.hook || 0);
    case "website_ctr": {
      // website_ctr pode não estar no schema, calcular se necessário
      const websiteCtr = (ad as any).website_ctr;
      if (typeof websiteCtr === "number" && !Number.isNaN(websiteCtr) && isFinite(websiteCtr)) {
        return websiteCtr;
      }
      // Fallback: calcular a partir de inline_link_clicks / impressions
      const impressions = Number(ad.impressions || 0);
      const inlineLinkClicks = Number((ad as any).inline_link_clicks || 0);
      return impressions > 0 ? inlineLinkClicks / impressions : 0;
    }
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
      if ("cpr" in ad && typeof (ad as any).cpr === "number" && (ad as any).cpr > 0) {
        return (ad as any).cpr;
      }
      // Caso contrário, calcular baseado no actionType
      if (!actionType) return 0;
      const spend = Number(ad.spend || 0);
      const results = Number((ad as any).conversions?.[actionType] || 0);
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


/**
 * Calcula rankings globais de métricas a partir de RankingsItem[]
 * 
 * IMPORTANTE: Os anúncios que entram no cálculo dos rankings devem todos obedecer
 * os critérios de validação definidos pelo usuário em "Configurações > Critérios de Validação",
 * a menos que não haja critérios definidos (array vazio ou undefined).
 * 
 * @param ads - Array de RankingsItem (todos os anúncios disponíveis)
 * @param options - Opções para cálculo de rankings
 * @param options.validationCriteria - Critérios de validação do usuário. Se undefined, null ou array vazio, todos os anúncios são considerados válidos.
 * @param options.actionType - ActionType para calcular page_conv
 * @param options.filterValidOnly - Se true, filtra apenas métricas válidas (> 0 e finitas)
 * @returns Rankings globais por métrica (Map<ad_id, rank>)
 */
export function calculateGlobalMetricRanks(ads: RankingsItem[], options: MetricRankingsOptions = {}): MetricRanks {
  const { validationCriteria, actionType, filterValidOnly = true, mqlLeadscoreMin = 0 } = options;

  // 1. Filtrar anúncios validados se houver critérios definidos
  // Se validationCriteria for undefined, null ou array vazio, todos os anúncios são válidos
  let validatedAds = ads;
  if (validationCriteria && Array.isArray(validationCriteria) && validationCriteria.length > 0) {
    validatedAds = ads.filter((ad) => {
      const metrics = mapRankingToMetrics(ad, actionType || "");
      return evaluateValidationCriteria(validationCriteria, metrics, "AND");
    });
  }

  // 2. Calcular rankings para cada métrica
  const hookRank = new Map<string | null, number>();
  const holdRateRank = new Map<string | null, number>();
  const websiteCtrRank = new Map<string | null, number>();
  const connectRateRank = new Map<string | null, number>();
  const pageConvRank = new Map<string | null, number>();
  const ctrRank = new Map<string | null, number>();
  const cprRank = new Map<string | null, number>();
  const cpmqlRank = new Map<string | null, number>();
  const spendRank = new Map<string | null, number>();

  // Hook: ordenar por valor decrescente
  const sortedHook = validatedAds
    .map((ad) => ({
      ad_id: ad.ad_id,
      value: getMetricValue(ad, "hook", actionType),
    }))
    .filter((item) => !filterValidOnly || (item.value > 0 && Number.isFinite(item.value)))
    .sort((a, b) => b.value - a.value);
  sortedHook.forEach((item, idx) => {
    if (item.ad_id) hookRank.set(item.ad_id, idx + 1);
  });

  // Hold Rate: ordenar por valor decrescente
  const sortedHoldRate = validatedAds
    .map((ad) => ({
      ad_id: ad.ad_id,
      value: getMetricValue(ad, "hold_rate", actionType),
    }))
    .filter((item) => !filterValidOnly || (item.value > 0 && Number.isFinite(item.value)))
    .sort((a, b) => b.value - a.value);
  sortedHoldRate.forEach((item, idx) => {
    if (item.ad_id) holdRateRank.set(item.ad_id, idx + 1);
  });

  // Website CTR: ordenar por valor decrescente
  const sortedWebsiteCtr = validatedAds
    .map((ad) => ({
      ad_id: ad.ad_id,
      value: getMetricValue(ad, "website_ctr", actionType),
    }))
    .filter((item) => !filterValidOnly || (item.value > 0 && Number.isFinite(item.value)))
    .sort((a, b) => b.value - a.value);
  sortedWebsiteCtr.forEach((item, idx) => {
    if (item.ad_id) websiteCtrRank.set(item.ad_id, idx + 1);
  });

  // Connect Rate: ordenar por valor decrescente
  const sortedConnectRate = validatedAds
    .map((ad) => ({
      ad_id: ad.ad_id,
      value: Number(ad.connect_rate || 0),
    }))
    .filter((item) => !filterValidOnly || (item.value > 0 && Number.isFinite(item.value)))
    .sort((a, b) => b.value - a.value);
  sortedConnectRate.forEach((item, idx) => {
    if (item.ad_id) connectRateRank.set(item.ad_id, idx + 1);
  });

  // Page Conv: ordenar por valor decrescente
  const sortedPageConv = validatedAds
    .map((ad) => ({
      ad_id: ad.ad_id,
      value: getMetricValue(ad, "page_conv", actionType),
    }))
    .filter((item) => !filterValidOnly || (item.value > 0 && Number.isFinite(item.value)))
    .sort((a, b) => b.value - a.value);
  sortedPageConv.forEach((item, idx) => {
    if (item.ad_id) pageConvRank.set(item.ad_id, idx + 1);
  });

  // CTR: ordenar por valor decrescente
  const sortedCtr = validatedAds
    .map((ad) => ({
      ad_id: ad.ad_id,
      value: getMetricValue(ad, "ctr", actionType),
    }))
    .filter((item) => !filterValidOnly || (item.value > 0 && Number.isFinite(item.value)))
    .sort((a, b) => b.value - a.value);
  sortedCtr.forEach((item, idx) => {
    if (item.ad_id) ctrRank.set(item.ad_id, idx + 1);
  });

  // CPR: ordenar por valor crescente (menor é melhor)
  const sortedCpr = validatedAds
    .map((ad) => ({
      ad_id: ad.ad_id,
      value: getMetricValue(ad, "cpr", actionType),
    }))
    .filter((item) => !filterValidOnly || (item.value > 0 && Number.isFinite(item.value)))
    .sort((a, b) => a.value - b.value);
  sortedCpr.forEach((item, idx) => {
    if (item.ad_id) cprRank.set(item.ad_id, idx + 1);
  });

  // CPMQL: ordenar por valor crescente (menor é melhor)
  const sortedCpmql = validatedAds
    .map((ad) => ({
      ad_id: ad.ad_id,
      value: getMetricValue(ad, "cpmql", actionType, mqlLeadscoreMin),
    }))
    .filter((item) => !filterValidOnly || (item.value > 0 && Number.isFinite(item.value)))
    .sort((a, b) => a.value - b.value);
  sortedCpmql.forEach((item, idx) => {
    if (item.ad_id) cpmqlRank.set(item.ad_id, idx + 1);
  });

  // Spend: ordenar por valor decrescente
  const sortedSpend = validatedAds
    .map((ad) => ({
      ad_id: ad.ad_id,
      value: Number(ad.spend || 0),
    }))
    .filter((item) => !filterValidOnly || (item.value > 0 && Number.isFinite(item.value)))
    .sort((a, b) => b.value - a.value);
  sortedSpend.forEach((item, idx) => {
    if (item.ad_id) spendRank.set(item.ad_id, idx + 1);
  });

  return {
    hookRank,
    holdRateRank,
    websiteCtrRank,
    connectRateRank,
    pageConvRank,
    ctrRank,
    cprRank,
    cpmqlRank,
    spendRank,
  };
}

/**
 * Calcula rankings de métricas a partir de OpportunityRow[]
 * 
 * NOTA: Esta função calcula rankings apenas entre os OpportunityRow fornecidos (rankings locais).
 * Ela NÃO aplica critérios de validação, pois assume que os OpportunityRow já foram filtrados.
 * Para rankings globais com critérios de validação, use calculateGlobalMetricRanks().
 * 
 * @param rows - Array de OpportunityRow (já filtrados e processados)
 * @returns Rankings por métrica (Map<ad_id, rank>)
 */
export function calculateMetricRanksFromOpportunityRows(rows: OpportunityRow[]): Omit<MetricRanks, "ctrRank" | "spendRank"> {
  const hookRank = new Map<string | null, number>();
  const holdRateRank = new Map<string | null, number>();
  const websiteCtrRank = new Map<string | null, number>();
  const connectRateRank = new Map<string | null, number>();
  const pageConvRank = new Map<string | null, number>();
  const cprRank = new Map<string | null, number>();
  const cpmqlRank = new Map<string | null, number>();

  // Hook: ordenar por valor decrescente
  const sortedHook = rows
    .filter((r) => r.hook > 0 && Number.isFinite(r.hook))
    .sort((a, b) => b.hook - a.hook);
  sortedHook.forEach((r, idx) => {
    if (r.ad_id) hookRank.set(r.ad_id, idx + 1);
  });

  // Hold Rate: ordenar por valor decrescente
  const sortedHoldRate = rows
    .filter((r) => r.hold_rate > 0 && Number.isFinite(r.hold_rate))
    .sort((a, b) => b.hold_rate - a.hold_rate);
  sortedHoldRate.forEach((r, idx) => {
    if (r.ad_id) holdRateRank.set(r.ad_id, idx + 1);
  });

  // Website CTR: ordenar por valor decrescente
  const sortedWebsiteCtr = rows
    .filter((r) => r.website_ctr > 0 && Number.isFinite(r.website_ctr))
    .sort((a, b) => b.website_ctr - a.website_ctr);
  sortedWebsiteCtr.forEach((r, idx) => {
    if (r.ad_id) websiteCtrRank.set(r.ad_id, idx + 1);
  });

  // Connect Rate: ordenar por valor decrescente
  const sortedConnectRate = rows
    .filter((r) => r.connect_rate > 0 && Number.isFinite(r.connect_rate))
    .sort((a, b) => b.connect_rate - a.connect_rate);
  sortedConnectRate.forEach((r, idx) => {
    if (r.ad_id) connectRateRank.set(r.ad_id, idx + 1);
  });

  // Page Conv: ordenar por valor decrescente
  const sortedPageConv = rows
    .filter((r) => r.page_conv > 0 && Number.isFinite(r.page_conv))
    .sort((a, b) => b.page_conv - a.page_conv);
  sortedPageConv.forEach((r, idx) => {
    if (r.ad_id) pageConvRank.set(r.ad_id, idx + 1);
  });

  // CPR: ordenar por valor crescente (menor é melhor)
  const sortedCpr = rows
    .filter((r) => r.cpr_actual > 0 && Number.isFinite(r.cpr_actual))
    .sort((a, b) => a.cpr_actual - b.cpr_actual);
  sortedCpr.forEach((r, idx) => {
    if (r.ad_id) cprRank.set(r.ad_id, idx + 1);
  });

  // CPMQL: ordenar por valor crescente (menor é melhor)
  const sortedCpmql = rows
    .filter((r) => r.cpmql != null && r.cpmql > 0 && Number.isFinite(r.cpmql))
    .sort((a, b) => (a.cpmql || 0) - (b.cpmql || 0));
  sortedCpmql.forEach((r, idx) => {
    if (r.ad_id) cpmqlRank.set(r.ad_id, idx + 1);
  });

  return {
    hookRank,
    holdRateRank,
    websiteCtrRank,
    connectRateRank,
    pageConvRank,
    cprRank,
    cpmqlRank,
  };
}

/**
 * Obtém o rank de um anúncio em uma métrica específica
 * 
 * @param ranks - Rankings globais
 * @param adId - ID do anúncio
 * @param metric - Nome da métrica
 * @returns Rank do anúncio ou null se não estiver no ranking
 */
export function getMetricRank(ranks: MetricRanks, adId: string | null | undefined, metric: keyof MetricRanks): number | null {
  if (!adId) return null;
  return ranks[metric].get(adId) ?? null;
}

