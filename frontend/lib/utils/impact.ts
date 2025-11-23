import { RankingsItem } from "@/lib/api/schemas";

type AnyAd = RankingsItem | (Record<string, any> & { ad_id?: string | number });

export interface LandingPageImpactParams {
  avgPageConv: number | null | undefined;
}

export interface LandingPageImpactResult {
  impactAbsConversions: number;
  score: number;
}

export interface CpmImpactParams {
  avgCpm: number | null | undefined;
}

export interface CpmImpactResult {
  impactAbsSavings: number;
  score: number;
}

// Cache simples em memória para evitar recalcular impacto quando ad e médias não mudam
type CacheKey = string;

const landingPageImpactCache = new Map<CacheKey, LandingPageImpactResult>();
const cpmImpactCache = new Map<CacheKey, CpmImpactResult>();

function getAdId(ad: AnyAd): string {
  const rawId = (ad as any).ad_id ?? (ad as any).id ?? "";
  return String(rawId);
}

/**
 * Calcula o impacto absoluto em conversões de melhorar apenas a Page Conv
 * até pelo menos a média, mantendo o spend fixo.
 *
 * Usado para ordenar a coluna "Landing Page".
 */
export function computeLandingPageImpact(
  ad: AnyAd,
  params: LandingPageImpactParams
): LandingPageImpactResult {
  const { avgPageConv } = params;

  const cacheKey: CacheKey = `${getAdId(ad)}|lp|${avgPageConv ?? "null"}`;
  const cached = landingPageImpactCache.get(cacheKey);
  if (cached) return cached;

  const spend = Number((ad as any).spend || 0);
  const impressions = Number((ad as any).impressions || 0);
  const lpv = Number((ad as any).lpv || 0);

  const cpm =
    impressions > 0 ? (spend * 1000) / impressions : Number((ad as any).cpm || 0);

  const websiteCtr = Math.max(Number((ad as any).websiteCtr || 0), 0);
  const connectRate = Math.max(Number((ad as any).connectRate || 0), 0);
  const pageConv = Math.max(Number((ad as any).pageConv || 0), 0);

  // CPR atual
  const denomActual = websiteCtr * connectRate * pageConv;
  const cprActual =
    denomActual > 0 ? cpm / (1000 * denomActual) : Number.POSITIVE_INFINITY;

  // CPR se melhorarmos apenas Page Conv até no mínimo a média
  const pageConvPot = Math.max(pageConv, avgPageConv || 0, 0);
  const denomPageConvOnly = websiteCtr * connectRate * pageConvPot;
  const cprIfPageConvOnly =
    denomPageConvOnly > 0
      ? cpm / (1000 * denomPageConvOnly)
      : Number.POSITIVE_INFINITY;

  // Conversões atuais e potenciais (mantendo spend fixo)
  const conversionsActual =
    Number.isFinite(cprActual) && cprActual > 0 ? spend / cprActual : 0;
  const conversionsPotential =
    Number.isFinite(cprIfPageConvOnly) && cprIfPageConvOnly > 0
      ? spend / cprIfPageConvOnly
      : 0;

  const impactAbsConversions = Math.max(
    0,
    conversionsPotential - conversionsActual
  );

  const result: LandingPageImpactResult = {
    impactAbsConversions,
    score: impactAbsConversions,
  };

  landingPageImpactCache.set(cacheKey, result);
  return result;
}

/**
 * Calcula o impacto absoluto em economia de mídia ao reduzir o CPM
 * até a média, mantendo o volume de impressões.
 *
 * Usado para ordenar a coluna "CPM".
 */
export function computeCpmImpact(ad: AnyAd, params: CpmImpactParams): CpmImpactResult {
  const { avgCpm } = params;

  const cacheKey: CacheKey = `${getAdId(ad)}|cpm|${avgCpm ?? "null"}`;
  const cached = cpmImpactCache.get(cacheKey);
  if (cached) return cached;

  const impressions = Number((ad as any).impressions || 0);
  const cpm = Number((ad as any).cpm || 0);

  const cpmReduction = Math.max(0, cpm - (avgCpm || 0));
  const potentialSavings = (cpmReduction * impressions) / 1000;

  const result: CpmImpactResult = {
    impactAbsSavings: potentialSavings,
    score: potentialSavings,
  };

  cpmImpactCache.set(cacheKey, result);
  return result;
}


