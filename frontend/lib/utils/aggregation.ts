import { FormattedAd } from '@/lib/api/schemas'

/**
 * Utilitários de agregação de dados para Dashboard
 * Migrado de libs/dataformatter.py
 */

export interface AggregatedData {
  // Hook metrics
  retention_at_3: number;
  video_total_plays: number;
  video_total_thruplays: number;
  
  // Budget metrics
  spend: number;
  cpm: number;
  
  // Audience metrics
  impressions: number;
  reach: number;
  frequency: number;
  
  // Click metrics
  clicks: number;
  ctr: number;
  inline_link_clicks: number;
  website_ctr: number;
  profile_ctr: number;
  
  // Landing page metrics
  connect_rate: number;
  landing_page_views: number;
  
  // Loaded ADs metrics
  ad_id: string[];
  adset_id: string[];
  campaign_id: string[];
  
  // Video play curve (retention curve)
  video_play_curve_actions: number[];
}

// Usar FormattedAd em vez de duplicar interface
export type AdData = FormattedAd

/**
 * Abrevia números grandes (K, M, B)
 */
export function abbreviateNumber(number: number, decimals: number = 0): string {
  if (number >= 1_000_000_000) {
    return `${(number / 1_000_000_000).toFixed(decimals > 0 ? decimals : 2)}B`;
  } else if (number >= 1_000_000) {
    return `${(number / 1_000_000).toFixed(decimals > 0 ? decimals : 2)}M`;
  } else if (number >= 10_000) {
    return `${(number / 1_000).toFixed(decimals > 0 ? decimals : 2)}K`;
  } else {
    return `${number.toFixed(decimals)}`;
  }
}

/**
 * Agrega dados de anúncios em um único conjunto de métricas
 */
export function aggregateAdsData(ads: AdData[]): AggregatedData {
  if (!ads || ads.length === 0) {
    return createEmptyAggregatedData();
  }

  // Agregação simples (soma)
  const simpleSumFields: (keyof AdData)[] = [
    'clicks', 'impressions', 'inline_link_clicks', 'reach', 'spend',
    'video_total_plays', 'video_total_thruplays'
  ];

  const aggregated: Partial<AggregatedData> = {};

  // Soma simples
  simpleSumFields.forEach(field => {
    const fieldKey = field as keyof AggregatedData;
    (aggregated as any)[fieldKey] = ads.reduce((sum, ad) => {
      const value = (ad as any)[field];
      return sum + (typeof value === 'number' ? value : 0);
    }, 0);
  });

  // Agregação de arrays únicos
  aggregated.ad_id = [...new Set(ads.map(ad => ad.ad_id))];
  aggregated.adset_id = [...new Set(ads.map(ad => ad.adset_id))];
  aggregated.campaign_id = [...new Set(ads.map(ad => ad.campaign_id))];

  // Cálculos complexos
  const totalSpend = aggregated.spend || 0;
  const totalImpressions = aggregated.impressions || 0;
  const totalClicks = aggregated.clicks || 0;
  const totalReach = aggregated.reach || 0;
  const totalInlineLinkClicks = aggregated.inline_link_clicks || 0;
  const totalPlays = aggregated.video_total_plays || 0;
  const totalThruplays = aggregated.video_total_thruplays || 0;
  
  // Calcular landing page views separadamente - extrair do array actions
  const totalLandingPageViews = ads.reduce((sum, ad) => {
    const landingPageAction = ad.actions?.find(action => action.action_type === 'landing_page_view');
    return sum + (landingPageAction?.value || 0);
  }, 0);

  // CTR (decimal)
  aggregated.ctr = totalImpressions > 0 ? (totalClicks / totalImpressions) : 0;

  // CPM (mantém unidade em moeda por mil)
  aggregated.cpm = totalImpressions > 0 ? (totalSpend * 1000) / totalImpressions : 0;

  // Frequency
  aggregated.frequency = totalReach > 0 ? totalImpressions / totalReach : 0;

  // Website CTR (decimal)
  aggregated.website_ctr = totalImpressions > 0 ? (totalInlineLinkClicks / totalImpressions) : 0;

  // Profile CTR (decimal)
  aggregated.profile_ctr = totalImpressions > 0 ? ((totalClicks - totalInlineLinkClicks) / totalImpressions) : 0;

  // Connect Rate (decimal)
  aggregated.connect_rate = totalInlineLinkClicks > 0 ? (totalLandingPageViews / totalInlineLinkClicks) : 0;

  // Landing page views
  aggregated.landing_page_views = totalLandingPageViews;

  // Retention at 3s (decimal)
  aggregated.retention_at_3 = calculateRetentionAt3s(ads);

  // Video play curve (média ponderada por plays)
  aggregated.video_play_curve_actions = calculateWeightedVideoCurve(ads);

  return aggregated as AggregatedData;
}

/**
 * Calcula retenção aos 3 segundos (índice 3 do array video_play_curve_actions)
 */
function calculateRetentionAt3s(ads: AdData[]): number {
  const totalPlays = ads.reduce((sum, ad) => sum + (ad.video_total_plays || 0), 0);
  
  if (totalPlays === 0) return 0;

  const weightedRetention = ads.reduce((sum, ad) => {
    const plays = ad.video_total_plays || 0;
    const curve = (ad.video_play_curve_actions || []).map(v => (v > 1 ? v / 100 : v));
    // Índice 3 = retenção aos 3 segundos (decimal)
    const retention3s = curve[3] || 0;
    return sum + (retention3s * plays);
  }, 0);

  return weightedRetention / totalPlays;
}

/**
 * Calcula média ponderada de uma métrica
 */
function calculateWeightedAverage(ads: AdData[], metric: keyof AdData, weightField: keyof AdData): number {
  const totalWeight = ads.reduce((sum, ad) => {
    const weight = ad[weightField];
    return sum + (typeof weight === 'number' ? weight : 0);
  }, 0);

  if (totalWeight === 0) return 0;

  const weightedSum = ads.reduce((sum, ad) => {
    const value = ad[metric];
    const weight = ad[weightField];
    // Para campos opcionais, usar 0 se não existir
    const numValue = typeof value === 'number' ? value : 0;
    const numWeight = typeof weight === 'number' ? weight : 0;
    return sum + (numValue * numWeight);
  }, 0);

  return weightedSum / totalWeight;
}

/**
 * Calcula curva de retenção ponderada por plays
 */
function calculateWeightedVideoCurve(ads: AdData[]): number[] {
  const curveLength = 22; // 15 segundos + 7 buckets
  const curve = new Array(curveLength).fill(0);
  
  const totalPlays = ads.reduce((sum, ad) => sum + (ad.video_total_plays || 0), 0);
  
  if (totalPlays === 0) return curve;

  ads.forEach(ad => {
    const plays = ad.video_total_plays || 0;
    const adCurve = (ad.video_play_curve_actions || []).map(v => (v > 1 ? v / 100 : v));
    
    for (let i = 0; i < Math.min(curveLength, adCurve.length); i++) {
      curve[i] += (adCurve[i] || 0) * plays;
    }
  });

  return curve.map(value => value / totalPlays);
}

/**
 * Cria dados agregados vazios
 */
function createEmptyAggregatedData(): AggregatedData {
  return {
    retention_at_3: 0,
    video_total_plays: 0,
    video_total_thruplays: 0,
    spend: 0,
    cpm: 0,
    impressions: 0,
    reach: 0,
    frequency: 0,
    clicks: 0,
    ctr: 0,
    inline_link_clicks: 0,
    website_ctr: 0,
    profile_ctr: 0,
    connect_rate: 0,
    landing_page_views: 0,
    ad_id: [],
    adset_id: [],
    campaign_id: [],
    video_play_curve_actions: new Array(22).fill(0),
  };
}

/**
 * Formata moeda para exibição
 * @deprecated Use formatCurrency from '@/lib/utils/currency' instead
 */
export function formatCurrency(value: number): string {
  // Importar dinamicamente para evitar dependência circular
  const { formatCurrency: formatCurrencyWithSettings } = require('@/lib/utils/currency')
  return formatCurrencyWithSettings(value)
}

/**
 * Formata porcentagem para exibição
 */
export function formatPercentage(value: number, decimals: number = 2): string {
  return `${value.toFixed(decimals)}%`;
}

/**
 * Formata número com separadores de milhares
 */
export function formatNumber(value: number): string {
  return new Intl.NumberFormat('pt-BR').format(value);
}
