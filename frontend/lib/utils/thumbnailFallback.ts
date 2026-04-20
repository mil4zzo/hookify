const STORAGE_PUBLIC_PATH = "/storage/v1/object/public/";

function isStorageThumbnailUrl(value: unknown): value is string {
  const url = String(value || "").trim();
  if (!url) return false;
  return url.includes(STORAGE_PUBLIC_PATH);
}

function buildStorageUrlFromPath(path: unknown): string | null {
  const storagePath = String(path || "").trim();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!storagePath || !supabaseUrl) return null;

  const encodedPath = storagePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/ad-thumbs/${encodedPath}`;
}

/**
 * Legacy compatibility shim.
 *
 * Meta CDN thumbnail URLs expire and must not be used for rendering. Callers
 * should pass Storage-backed `thumbnail` or `thumb_storage_path` data instead.
 */
export function getThumbnailWithFallback(
  thumbnailUrl?: string | null,
  adcreativesVideosThumbs?: string[] | null
): string | null {
  void adcreativesVideosThumbs;
  if (isStorageThumbnailUrl(thumbnailUrl)) return thumbnailUrl.trim();
  return null;
}

/**
 * Helper for ad-like objects with thumbnail data.
 *
 * Only Storage-backed thumbnails are renderable. Meta URLs from `thumbnail_url`
 * or `adcreatives_videos_thumbs` are intentionally ignored so expired CDN links
 * cannot mask cache failures.
 */
export function getAdThumbnail(ad: any): string | null {
  if (isStorageThumbnailUrl(ad?.thumbnail)) {
    return String(ad.thumbnail).trim();
  }

  const storageUrl = buildStorageUrlFromPath(ad?.thumb_storage_path);
  if (storageUrl) return storageUrl;

  return null;
}
