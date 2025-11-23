/**
 * Utilitário para filtrar apenas anúncios de vídeo
 * 
 * Um anúncio é considerado de vídeo se tiver adcreatives_videos_ids e adcreatives_videos_thumbs
 * preenchidos (não null, não undefined, e não arrays vazios)
 */

export function isVideoAd(ad: any): boolean {
  if (!ad) return false;

  const videosIds = ad.adcreatives_videos_ids;
  const videosThumbs = ad.adcreatives_videos_thumbs;

  // Verificar se ambos os campos existem e são arrays não vazios
  const hasVideosIds = Array.isArray(videosIds) && videosIds.length > 0;
  const hasVideosThumbs = Array.isArray(videosThumbs) && videosThumbs.length > 0;

  // Um anúncio de vídeo deve ter pelo menos um dos dois campos preenchidos
  // Mas idealmente ambos devem estar presentes
  return hasVideosIds || hasVideosThumbs;
}

/**
 * Filtra um array de ads para retornar apenas anúncios de vídeo
 */
export function filterVideoAds<T extends any>(ads: T[]): T[] {
  if (!Array.isArray(ads)) return [];
  return ads.filter(isVideoAd);
}

