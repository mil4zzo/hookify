/**
 * Utilitário para obter thumbnail com fallback para adcreatives_videos_thumbs
 * 
 * Prioridade:
 * 1. adcreatives_videos_thumbs[0] (primeiro item do array de fallback - geralmente melhor qualidade)
 * 2. thumbnail_url (de creative ou campo direto)
 * 3. null
 */

export function getThumbnailWithFallback(
  thumbnailUrl?: string | null,
  adcreativesVideosThumbs?: string[] | null
): string | null {
  // Prioridade 1: primeiro item de adcreatives_videos_thumbs (geralmente melhor qualidade)
  if (Array.isArray(adcreativesVideosThumbs) && adcreativesVideosThumbs.length > 0) {
    const firstThumb = adcreativesVideosThumbs[0];
    if (firstThumb && String(firstThumb).trim()) {
      return String(firstThumb);
    }
  }

  // Prioridade 2: thumbnail_url
  if (thumbnailUrl && thumbnailUrl.trim()) {
    return thumbnailUrl;
  }

  return null;
}

/**
 * Helper para objetos ad que podem ter thumbnail em diferentes formatos
 * 
 * Prioridade:
 * 1. ad.thumbnail (URL do Storage/WebP quando disponível - prioridade máxima)
 * 2. ad.adcreatives_videos_thumbs[0] (geralmente melhor qualidade que thumbnail_url)
 * 3. ad.thumbnail_url (fallback final)
 */
export function getAdThumbnail(ad: any): string | null {
  // Prioridade 1: thumbnail do Storage (quando cacheado)
  if (ad?.thumbnail && String(ad.thumbnail).trim()) {
    return String(ad.thumbnail).trim();
  }
  
  // Prioridade 2 e 3: usar função de fallback (adcreatives_videos_thumbs[0] > thumbnail_url)
  const thumbnailUrl = 
    ad?.thumbnail_url || 
    ad?.creative?.thumbnail_url ||
    ad?.["creative.thumbnail_url"];
  
  const adcreativesThumbs = 
    ad?.adcreatives_videos_thumbs || 
    ad?.creative?.adcreatives_videos_thumbs;

  return getThumbnailWithFallback(thumbnailUrl, adcreativesThumbs);
}

