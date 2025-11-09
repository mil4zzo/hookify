import { RankingsItem, RankingsResponse } from "@/lib/api/schemas";

export type OpportunityInputs = {
  ads: RankingsItem[];
  averages?: RankingsResponse["averages"];
  actionType: string;
  spendTotal?: number; // opcional: se não vier, calculamos dos anúncios elegíveis
  limit?: number;
};

export type OpportunityRow = {
  account_id?: string | null;
  ad_id?: string | null;
  ad_name?: string | null;
  thumbnail?: string | null;
  adcreatives_videos_thumbs?: string[] | null;
  ad_count?: number;

  spend: number;
  cpm: number;
  hook: number;
  website_ctr: number;
  connect_rate: number;
  page_conv: number;

  cpr_actual: number;
  cpr_potential: number;
  improvement_pct: number;
  impact_relative: number;
  impact_abs_savings: number;
  impact_abs_conversions: number;

  // CPR individual ao melhorar apenas uma métrica
  cpr_if_website_ctr_only: number; // CPR se melhorar apenas website_ctr
  cpr_if_connect_rate_only: number; // CPR se melhorar apenas connect_rate
  cpr_if_page_conv_only: number; // CPR se melhorar apenas page_conv

  below_avg_flags: {
    website_ctr: boolean;
    connect_rate: boolean;
    page_conv: boolean;
  };
};

const EPS = 1e-9;

function toNumber(v: any, def = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function safeDivide(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

/**
 * Calcula valores de oportunidade para uma lista de anúncios já agregados pelo backend
 * Mantém as fórmulas definidas para o MVP e usa apenas médias vindas do backend.
 */
export function computeOpportunityScores({
  ads,
  averages,
  actionType,
  spendTotal,
  limit,
}: OpportunityInputs): OpportunityRow[] {
  if (!Array.isArray(ads) || ads.length === 0) return [];

  const avgWebsiteCtr = toNumber(averages?.website_ctr, 0);
  const avgConnectRate = toNumber(averages?.connect_rate, 0);
  const avgPageConv = toNumber(averages?.per_action_type?.[actionType]?.page_conv, 0);

  // Calcular spend total se não fornecido (depois de elegibilidade, mas como entrada simples usamos de todos)
  const totalSpend = spendTotal != null ? spendTotal : ads.reduce((s, a) => s + toNumber((a as any).spend, 0), 0);
  const totalSpendSafe = totalSpend > 0 ? totalSpend : EPS;

  const rows: OpportunityRow[] = [];

  for (const ad of ads) {
    const impressions = toNumber((ad as any).impressions, 0);
    const spend = toNumber((ad as any).spend, 0);
    const cpm = impressions > 0 ? (spend * 1000) / impressions : toNumber((ad as any).cpm, 0);

    const hook = toNumber((ad as any).hook, 0);
    const websiteCtr = toNumber((ad as any).website_ctr, 0);
    const connectRate = toNumber((ad as any).connect_rate, 0);
    const lpv = toNumber((ad as any).lpv, 0);

    const results = actionType ? toNumber((ad as any).conversions?.[actionType], 0) : 0;
    const pageConv = lpv > 0 ? results / lpv : 0;

    // CPR atual via fórmula do MVP (equivalente a spend/results quando coerente)
    const denomActual = Math.max(websiteCtr, 0) * Math.max(connectRate, 0) * Math.max(pageConv, 0);
    const cprActual =
      denomActual > 0 ? cpm / (1000 * denomActual) : Number.POSITIVE_INFINITY;

    // CPR potencial: elevar cada etapa abaixo da média para no mínimo a média
    const websiteCtrPot = Math.max(websiteCtr, avgWebsiteCtr, 0);
    const connectRatePot = Math.max(connectRate, avgConnectRate, 0);
    const pageConvPot = Math.max(pageConv, avgPageConv, 0);
    const denomPotential = websiteCtrPot * connectRatePot * pageConvPot;
    const cprPotential =
      denomPotential > 0 ? cpm / (1000 * denomPotential) : Number.POSITIVE_INFINITY;

    // Melhoria esperada %
    const improvementPct =
      isFinite(cprActual) && cprActual > 0
        ? 1 - cprPotential / cprActual
        : 0;

    // Impacto relativo
    const impactRelative = improvementPct * safeDivide(spend, totalSpendSafe);

    // Impactos absolutos
    const conversionsActual = isFinite(cprActual) && cprActual > 0 ? spend / cprActual : 0;
    const conversionsPotential = isFinite(cprPotential) && cprPotential > 0 ? spend / cprPotential : 0;
    const impactAbsConversions = conversionsPotential - conversionsActual;
    const impactAbsSavings =
      isFinite(cprActual) && cprActual > 0
        ? (cprActual - cprPotential) * (spend / cprActual)
        : 0;

    // Calcular CPR individual ao melhorar apenas uma métrica por vez
    // Website CTR apenas
    const websiteCtrOnlyPot = Math.max(websiteCtr, avgWebsiteCtr, 0);
    const denomWebsiteCtrOnly = websiteCtrOnlyPot * Math.max(connectRate, 0) * Math.max(pageConv, 0);
    const cprIfWebsiteCtrOnly = denomWebsiteCtrOnly > 0 ? cpm / (1000 * denomWebsiteCtrOnly) : Number.POSITIVE_INFINITY;

    // Connect Rate apenas
    const connectRateOnlyPot = Math.max(connectRate, avgConnectRate, 0);
    const denomConnectRateOnly = Math.max(websiteCtr, 0) * connectRateOnlyPot * Math.max(pageConv, 0);
    const cprIfConnectRateOnly = denomConnectRateOnly > 0 ? cpm / (1000 * denomConnectRateOnly) : Number.POSITIVE_INFINITY;

    // Page Conv apenas
    const pageConvOnlyPot = Math.max(pageConv, avgPageConv, 0);
    const denomPageConvOnly = Math.max(websiteCtr, 0) * Math.max(connectRate, 0) * pageConvOnlyPot;
    const cprIfPageConvOnly = denomPageConvOnly > 0 ? cpm / (1000 * denomPageConvOnly) : Number.POSITIVE_INFINITY;

    const row: OpportunityRow = {
      account_id: (ad as any).account_id,
      ad_id: (ad as any).ad_id,
      ad_name: (ad as any).ad_name,
      thumbnail: (ad as any).thumbnail || null,
      adcreatives_videos_thumbs: (ad as any).adcreatives_videos_thumbs || null,
      ad_count: (ad as any).ad_count || 1,

      spend,
      cpm,
      hook,
      website_ctr: websiteCtr,
      connect_rate: connectRate,
      page_conv: pageConv,

      cpr_actual: isFinite(cprActual) ? cprActual : 0,
      cpr_potential: isFinite(cprPotential) ? cprPotential : 0,
      improvement_pct: improvementPct,
      impact_relative: impactRelative,
      impact_abs_savings: impactAbsSavings,
      impact_abs_conversions: impactAbsConversions,

      cpr_if_website_ctr_only: isFinite(cprIfWebsiteCtrOnly) ? cprIfWebsiteCtrOnly : 0,
      cpr_if_connect_rate_only: isFinite(cprIfConnectRateOnly) ? cprIfConnectRateOnly : 0,
      cpr_if_page_conv_only: isFinite(cprIfPageConvOnly) ? cprIfPageConvOnly : 0,

      below_avg_flags: {
        website_ctr: avgWebsiteCtr > 0 ? websiteCtr < avgWebsiteCtr : false,
        connect_rate: avgConnectRate > 0 ? connectRate < avgConnectRate : false,
        page_conv: avgPageConv > 0 ? pageConv < avgPageConv : false,
      },
    };

    rows.push(row);
  }

  // Filtrar apenas anúncios com pelo menos uma métrica abaixo da média
  const withDeficit = rows.filter(
    (r) =>
      r.below_avg_flags.website_ctr ||
      r.below_avg_flags.connect_rate ||
      r.below_avg_flags.page_conv
  );

  // Ordenar por impacto relativo desc e aplicar limite
  const sorted = withDeficit.sort((a, b) => b.impact_relative - a.impact_relative);
  return (limit && limit > 0 ? sorted.slice(0, limit) : sorted).filter((r) => Number.isFinite(r.cpr_actual) && Number.isFinite(r.cpr_potential));
}


