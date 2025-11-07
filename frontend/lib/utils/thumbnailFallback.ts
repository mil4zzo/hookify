/**
 * Utilitário para obter thumbnail com fallback para adcreatives_videos_thumbs
 * 
 * Prioridade:
 * 1. thumbnail_url (de creative ou campo direto)
 * 2. adcreatives_videos_thumbs[0] (primeiro item do array de fallback)
 * 3. null
 */

export function getThumbnailWithFallback(
  thumbnailUrl?: string | null,
  adcreativesVideosThumbs?: string[] | null
): string | null {
  // Prioridade 1: thumbnail_url
  if (thumbnailUrl && thumbnailUrl.trim()) {
    return thumbnailUrl;
  }

  // Prioridade 2: primeiro item de adcreatives_videos_thumbs
  if (Array.isArray(adcreativesVideosThumbs) && adcreativesVideosThumbs.length > 0) {
    const firstThumb = adcreativesVideosThumbs[0];
    if (firstThumb && String(firstThumb).trim()) {
      return String(firstThumb);
    }
  }

  return null;
}

/**
 * Helper para objetos ad que podem ter thumbnail em diferentes formatos
 */
export function getAdThumbnail(ad: any): string | null {
  // Tentar diferentes campos possíveis
  const thumbnailUrl = 
    ad?.thumbnail || 
    ad?.thumbnail_url || 
    ad?.creative?.thumbnail_url ||
    ad?.["creative.thumbnail_url"];
  
  const adcreativesThumbs = 
    ad?.adcreatives_videos_thumbs || 
    ad?.creative?.adcreatives_videos_thumbs;

  return getThumbnailWithFallback(thumbnailUrl, adcreativesThumbs);
}

