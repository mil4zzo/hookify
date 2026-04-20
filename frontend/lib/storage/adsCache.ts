/**
 * IndexedDB cache for pack ads.
 *
 * Pack rows can contain long-lived data, but thumbnail rendering must only use
 * Supabase Storage URLs. The schema version invalidates old cached rows that
 * still depended on expiring Meta CDN thumbnail fields.
 */

const DB_NAME = "hookify-storage";
const DB_VERSION = 2;
const CACHE_STORE_NAME = "ads_cache";
const CACHE_SCHEMA_VERSION = 2;

const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const PENDING_THUMBNAIL_CACHE_TTL_MS = 30 * 60 * 1000;

export type ThumbnailCacheStatus = "pending" | "ready";

interface CachedAds {
  packId: string;
  ads: any[];
  cachedAt: number;
  expiresAt: number;
  schemaVersion?: number;
  thumbnailStatus?: ThumbnailCacheStatus;
}

interface IDBResult<T> {
  success: boolean;
  data?: T;
  error?: Error;
}

interface CacheReadOptions {
  allowPending?: boolean;
}

interface ThumbnailPatch {
  ad_id: string;
  thumbnail?: string | null;
  thumb_storage_path?: string | null;
}

export function canReadCachedAds(
  result: CachedAds | undefined,
  now: number = Date.now(),
  options: CacheReadOptions = {}
): { readable: boolean; error?: Error; shouldRemove?: boolean } {
  if (!result) {
    return { readable: false, error: new Error("Cache not found") };
  }

  if (result.schemaVersion !== CACHE_SCHEMA_VERSION) {
    return { readable: false, error: new Error("Cache schema mismatch"), shouldRemove: true };
  }

  if (now > result.expiresAt) {
    return { readable: false, error: new Error("Cache expired"), shouldRemove: true };
  }

  if (result.thumbnailStatus === "pending" && !options.allowPending) {
    return { readable: false, error: new Error("Thumbnail cache pending") };
  }

  return { readable: true };
}

export function mergeThumbnailCache(ads: any[], thumbnails: ThumbnailPatch[]): any[] {
  const byAdId = new Map(
    thumbnails
      .filter((thumb) => thumb?.ad_id)
      .map((thumb) => [String(thumb.ad_id), thumb])
  );

  return ads.map((ad) => {
    const patch = byAdId.get(String(ad?.ad_id || ""));
    if (!patch) return ad;

    return {
      ...ad,
      thumbnail: patch.thumbnail ?? ad.thumbnail ?? null,
      thumb_storage_path: patch.thumb_storage_path ?? ad.thumb_storage_path ?? null,
    };
  });
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      reject(new Error("IndexedDB is not available in this environment"));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      if (!db.objectStoreNames.contains(CACHE_STORE_NAME)) {
        const store = db.createObjectStore(CACHE_STORE_NAME, { keyPath: "packId" });
        store.createIndex("expiresAt", "expiresAt", { unique: false });
      }
    };
  });
}

export async function cachePackAds(
  packId: string,
  ads: any[],
  ttlMs: number = DEFAULT_TTL_MS,
  thumbnailStatus: ThumbnailCacheStatus = "ready"
): Promise<IDBResult<void>> {
  try {
    const db = await openDB();
    const transaction = db.transaction([CACHE_STORE_NAME], "readwrite");
    const store = transaction.objectStore(CACHE_STORE_NAME);

    const now = Date.now();
    const cachedData: CachedAds = {
      packId,
      ads,
      cachedAt: now,
      expiresAt: now + ttlMs,
      schemaVersion: CACHE_SCHEMA_VERSION,
      thumbnailStatus,
    };

    return new Promise((resolve) => {
      const request = store.put(cachedData);
      request.onsuccess = () => resolve({ success: true });
      request.onerror = () =>
        resolve({ success: false, error: request.error || new Error("Failed to save cache") });
    });
  } catch (error) {
    return { success: false, error: error as Error };
  }
}

export async function cachePendingPackAds(packId: string, ads: any[]): Promise<IDBResult<void>> {
  return cachePackAds(packId, ads, PENDING_THUMBNAIL_CACHE_TTL_MS, "pending");
}

export async function getCachedPackAds(
  packId: string,
  options: CacheReadOptions = {}
): Promise<IDBResult<any[]>> {
  try {
    const db = await openDB();
    const transaction = db.transaction([CACHE_STORE_NAME], "readonly");
    const store = transaction.objectStore(CACHE_STORE_NAME);

    return new Promise((resolve) => {
      const request = store.get(packId);
      request.onsuccess = () => {
        const result: CachedAds | undefined = request.result;
        const readState = canReadCachedAds(result, Date.now(), options);
        if (!readState.readable) {
          if (readState.shouldRemove) {
            removeCachedPackAds(packId).catch(() => {});
          }
          resolve({ success: false, error: readState.error || new Error("Cache unavailable") });
          return;
        }

        resolve({ success: true, data: result!.ads });
      };
      request.onerror = () =>
        resolve({ success: false, error: request.error || new Error("Failed to read cache") });
    });
  } catch (error) {
    return { success: false, error: error as Error };
  }
}

export async function promoteCachedPackAdsThumbnails(
  packId: string,
  thumbnails: ThumbnailPatch[]
): Promise<IDBResult<void>> {
  const cached = await getCachedPackAds(packId, { allowPending: true });
  if (!cached.success || !Array.isArray(cached.data)) {
    return { success: false, error: cached.error || new Error("Cache not found") };
  }

  const mergedAds = mergeThumbnailCache(cached.data, thumbnails);
  return cachePackAds(packId, mergedAds);
}

export async function removeCachedPackAds(packId: string): Promise<IDBResult<void>> {
  try {
    const db = await openDB();
    const transaction = db.transaction([CACHE_STORE_NAME], "readwrite");
    const store = transaction.objectStore(CACHE_STORE_NAME);

    return new Promise((resolve) => {
      const request = store.delete(packId);
      request.onsuccess = () => resolve({ success: true });
      request.onerror = () =>
        resolve({ success: false, error: request.error || new Error("Failed to remove cache") });
    });
  } catch (error) {
    return { success: false, error: error as Error };
  }
}

export async function clearExpiredCache(): Promise<IDBResult<number>> {
  try {
    const db = await openDB();
    const transaction = db.transaction([CACHE_STORE_NAME], "readwrite");
    const store = transaction.objectStore(CACHE_STORE_NAME);
    const index = store.index("expiresAt");

    const now = Date.now();
    let deletedCount = 0;

    return new Promise((resolve) => {
      const request = index.openCursor(IDBKeyRange.upperBound(now));

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          cursor.delete();
          deletedCount++;
          cursor.continue();
        } else {
          resolve({ success: true, data: deletedCount });
        }
      };

      request.onerror = () =>
        resolve({ success: false, error: request.error || new Error("Failed to clear expired cache") });
    });
  } catch (error) {
    return { success: false, error: error as Error };
  }
}

export async function clearAllAdsCache(): Promise<IDBResult<void>> {
  try {
    const db = await openDB();
    const transaction = db.transaction([CACHE_STORE_NAME], "readwrite");
    const store = transaction.objectStore(CACHE_STORE_NAME);

    return new Promise((resolve) => {
      const request = store.clear();
      request.onsuccess = () => resolve({ success: true });
      request.onerror = () =>
        resolve({ success: false, error: request.error || new Error("Failed to clear cache") });
    });
  } catch (error) {
    return { success: false, error: error as Error };
  }
}

export async function hasValidCache(packId: string): Promise<boolean> {
  const result = await getCachedPackAds(packId);
  return result.success;
}
