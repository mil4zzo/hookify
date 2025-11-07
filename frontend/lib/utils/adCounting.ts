/**
 * Utility functions for counting ads and related metrics
 * Centralizes the logic for counting unique ads by ad_id across the app
 */

export interface AdData {
  ad_id?: string;
  campaign_id?: string;
  adset_id?: string;
  [key: string]: any;
}

/**
 * Counts unique ads by ad_id from an array of ad data
 * @param ads Array of ad objects
 * @returns Number of unique ads
 */
export const countUniqueAds = (ads: AdData[]): number => {
  if (!Array.isArray(ads) || ads.length === 0) return 0;
  
  const uniqueIds = new Set<string>();
  ads.forEach((ad) => {
    if (ad && ad.ad_id) {
      uniqueIds.add(String(ad.ad_id));
    }
  });
  
  return uniqueIds.size;
};

/**
 * Counts unique campaigns by campaign_id from an array of ad data
 * @param ads Array of ad objects
 * @returns Number of unique campaigns
 */
export const countUniqueCampaigns = (ads: AdData[]): number => {
  if (!Array.isArray(ads) || ads.length === 0) return 0;
  
  const uniqueIds = new Set<string>();
  ads.forEach((ad) => {
    if (ad && ad.campaign_id) {
      uniqueIds.add(String(ad.campaign_id));
    }
  });
  
  return uniqueIds.size;
};

/**
 * Counts unique adsets by adset_id from an array of ad data
 * @param ads Array of ad objects
 * @returns Number of unique adsets
 */
export const countUniqueAdsets = (ads: AdData[]): number => {
  if (!Array.isArray(ads) || ads.length === 0) return 0;
  
  const uniqueIds = new Set<string>();
  ads.forEach((ad) => {
    if (ad && ad.adset_id) {
      uniqueIds.add(String(ad.adset_id));
    }
  });
  
  return uniqueIds.size;
};

/**
 * Calculates total spend from an array of ad data
 * @param ads Array of ad objects
 * @returns Total spend amount
 */
export const calculateTotalSpend = (ads: AdData[]): number => {
  if (!Array.isArray(ads) || ads.length === 0) return 0;
  
  return ads.reduce((total, ad) => {
    const spend = ad?.spend || 0;
    return total + (typeof spend === 'number' ? spend : 0);
  }, 0);
};

/**
 * Gets comprehensive ad statistics for a single pack or array of ads
 * @param ads Array of ad objects
 * @returns Object with all relevant counts and totals
 */
export const getAdStatistics = (ads: AdData[]) => {
  return {
    totalAds: ads.length,
    uniqueAds: countUniqueAds(ads),
    uniqueCampaigns: countUniqueCampaigns(ads),
    uniqueAdsets: countUniqueAdsets(ads),
    totalSpend: calculateTotalSpend(ads),
  };
};

/**
 * Gets aggregated statistics across multiple packs
 * @param packs Array of pack objects with ads property and optional stats
 * @returns Object with aggregated statistics
 */
export const getAggregatedPackStatistics = (packs: Array<{ ads?: AdData[], stats?: { totalAds?: number, uniqueAds?: number, uniqueCampaigns?: number, uniqueAdsets?: number, totalSpend?: number } | null }>) => {
  if (!packs || packs.length === 0) {
    return {
      totalPacks: 0,
      totalAds: 0,
      uniqueAds: 0,
      uniqueCampaigns: 0,
      uniqueAdsets: 0,
      totalSpend: 0,
    };
  }

  // Filtrar packs que têm stats válidos (não null, não undefined, e com pelo menos um campo numérico)
  const packsWithStats = packs.filter(p => {
    const stats = p.stats;
    if (!stats || typeof stats !== 'object') return false;
    // Verificar se tem pelo menos um campo numérico válido
    return (
      (typeof stats.uniqueAds === 'number' && stats.uniqueAds > 0) ||
      (typeof stats.totalAds === 'number' && stats.totalAds > 0) ||
      (typeof stats.totalSpend === 'number' && stats.totalSpend > 0) ||
      (typeof stats.uniqueCampaigns === 'number' && stats.uniqueCampaigns > 0) ||
      (typeof stats.uniqueAdsets === 'number' && stats.uniqueAdsets > 0)
    );
  });
  
  // Se pelo menos um pack tem stats válidos, usar stats (preferencial)
  if (packsWithStats.length > 0) {
    // Agregar usando stats (fonte de verdade do backend)
    const aggregated = packs.reduce((acc, pack) => {
      const stats = pack.stats;
      if (stats && typeof stats === 'object') {
        // Usar totalAds se disponível, senão uniqueAds
        const totalAds = typeof stats.totalAds === 'number' ? stats.totalAds : (stats.uniqueAds || 0);
        acc.uniqueAds += stats.uniqueAds || 0;
        acc.uniqueCampaigns += stats.uniqueCampaigns || 0;
        acc.uniqueAdsets += stats.uniqueAdsets || 0;
        acc.totalSpend += stats.totalSpend || 0;
        // Usar totalAds para totalAds se disponível
        if (typeof stats.totalAds === 'number') {
          acc.totalAds = (acc.totalAds || 0) + stats.totalAds;
        }
      }
      return acc;
    }, {
      totalAds: 0,
      uniqueAds: 0,
      uniqueCampaigns: 0,
      uniqueAdsets: 0,
      totalSpend: 0,
    });

    return {
      totalPacks: packs.length,
      totalAds: aggregated.totalAds > 0 ? aggregated.totalAds : aggregated.uniqueAds,
      uniqueAds: aggregated.uniqueAds,
      uniqueCampaigns: aggregated.uniqueCampaigns,
      uniqueAdsets: aggregated.uniqueAdsets,
      totalSpend: aggregated.totalSpend,
    };
  }

  // Fallback: se nenhum pack tem stats válidos, retornar zeros
  // Não tentar calcular de pack.ads porque ads estão no cache IndexedDB
  return {
    totalPacks: packs.length,
    totalAds: 0,
    uniqueAds: 0,
    uniqueCampaigns: 0,
    uniqueAdsets: 0,
    totalSpend: 0,
  };
};
