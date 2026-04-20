import test from "node:test";
import assert from "node:assert/strict";
import {
  canReadCachedAds,
  mergeThumbnailCache,
  PENDING_THUMBNAIL_CACHE_TTL_MS,
} from "../adsCache";

test("pending thumbnail cache is not readable by default", () => {
  const now = 1_000;
  const pendingEntry = {
    packId: "pack-1",
    ads: [{ ad_id: "ad-1" }],
    cachedAt: now,
    expiresAt: now + PENDING_THUMBNAIL_CACHE_TTL_MS,
    schemaVersion: 2,
    thumbnailStatus: "pending" as const,
  };

  assert.equal(canReadCachedAds(pendingEntry, now).readable, false);
  assert.equal(canReadCachedAds(pendingEntry, now, { allowPending: true }).readable, true);
});

test("thumbnail patch merges storage fields into cached ads", () => {
  const ads = [
    { ad_id: "ad-1", ad_name: "A", thumbnail: null, thumb_storage_path: null },
    { ad_id: "ad-2", ad_name: "B", thumbnail: null, thumb_storage_path: null },
  ];

  const merged = mergeThumbnailCache(ads, [
    {
      ad_id: "ad-2",
      thumbnail: "https://project.supabase.co/storage/v1/object/public/ad-thumbs/u/ad-2.jpg",
      thumb_storage_path: "u/ad-2.jpg",
    },
  ]);

  assert.equal(merged[0].thumbnail, null);
  assert.equal(merged[1].thumbnail, "https://project.supabase.co/storage/v1/object/public/ad-thumbs/u/ad-2.jpg");
  assert.equal(merged[1].thumb_storage_path, "u/ad-2.jpg");
});
