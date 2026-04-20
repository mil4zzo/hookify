export function extractVideoIdFromCreative(
  creative: Record<string, any> | null | undefined,
  fallbackVideoIds?: string[] | null,
): string {
  const c = creative || {};
  const objectStorySpec = c.object_story_spec || {};
  const assetFeedSpec = c.asset_feed_spec || {};

  const candidates = [
    ...(Array.isArray(fallbackVideoIds) ? fallbackVideoIds : []),
    c.video_id,
    objectStorySpec.video_data?.video_id,
    objectStorySpec.link_data?.video_id,
    ...(Array.isArray(assetFeedSpec.videos)
      ? assetFeedSpec.videos.map((video: any) => video?.video_id)
      : []),
  ];

  for (const candidate of candidates) {
    const videoId = String(candidate || "").trim();
    if (videoId) return videoId;
  }

  return "";
}

export function resolvePrimaryVideoId(
  creativeData: Record<string, any> | null | undefined,
  creative?: Record<string, any> | null | undefined,
  fallbackVideoIds?: string[] | null,
): string {
  const primaryVideoId = String(creativeData?.primary_video_id || "").trim();
  if (primaryVideoId) return primaryVideoId;

  return extractVideoIdFromCreative(
    creative || creativeData?.creative,
    fallbackVideoIds || creativeData?.adcreatives_videos_ids,
  );
}

export function normalizeMediaType(value: unknown): "video" | "image" | "unknown" | null {
  if (value === "video" || value === "image" || value === "unknown") {
    return value;
  }
  return null;
}

export function extractActorIdFromCreative(creative: Record<string, any> | null | undefined): string {
  const c = creative || {};
  const objectStorySpec = c.object_story_spec || {};

  const candidates = [
    c.actor_id,
    objectStorySpec.page_id,
    objectStorySpec.instagram_actor_id,
  ];

  for (const candidate of candidates) {
    const actorId = String(candidate || "").trim();
    if (actorId) return actorId;
  }

  return "";
}
