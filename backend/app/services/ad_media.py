from __future__ import annotations

from typing import Any, Dict, Iterable, Optional


MEDIA_TYPE_VIDEO = "video"
MEDIA_TYPE_IMAGE = "image"
MEDIA_TYPE_UNKNOWN = "unknown"


def _first_non_empty(values: Iterable[Any]) -> Optional[str]:
    for value in values:
        text = str(value or "").strip()
        if text:
            return text
    return None


def resolve_primary_video_id(ad: Dict[str, Any]) -> Optional[str]:
    creative = ad.get("creative") or {}
    adcreatives_videos_ids = ad.get("adcreatives_videos_ids") or []
    object_story_spec = creative.get("object_story_spec") or {}
    asset_feed_spec = creative.get("asset_feed_spec") or {}

    asset_feed_video_ids = []
    if isinstance(asset_feed_spec, dict):
        videos = asset_feed_spec.get("videos") or []
        if isinstance(videos, list):
            asset_feed_video_ids = [video.get("video_id") for video in videos if isinstance(video, dict)]

    candidates = [
        *(adcreatives_videos_ids if isinstance(adcreatives_videos_ids, list) else []),
        ad.get("primary_video_id"),
        ad.get("creative_video_id"),
        creative.get("video_id"),
        (object_story_spec.get("video_data") or {}).get("video_id") if isinstance(object_story_spec, dict) else None,
        (object_story_spec.get("link_data") or {}).get("video_id") if isinstance(object_story_spec, dict) else None,
        *asset_feed_video_ids,
    ]
    return _first_non_empty(candidates)


def resolve_media_type(ad: Dict[str, Any], primary_video_id: Optional[str] = None) -> str:
    if primary_video_id or resolve_primary_video_id(ad):
        return MEDIA_TYPE_VIDEO

    creative = ad.get("creative") or {}
    object_story_spec = creative.get("object_story_spec") or {}
    asset_feed_spec = creative.get("asset_feed_spec") or {}

    image_candidates = [
        ad.get("thumbnail_url"),
        creative.get("thumbnail_url"),
        creative.get("image_url"),
        creative.get("image_hash"),
        ad.get("thumb_storage_path"),
    ]

    if isinstance(object_story_spec, dict):
        photo_data = object_story_spec.get("photo_data") or {}
        link_data = object_story_spec.get("link_data") or {}
        if isinstance(photo_data, dict):
            image_candidates.extend([photo_data.get("image_hash"), photo_data.get("url")])
        if isinstance(link_data, dict):
            image_candidates.extend([link_data.get("image_hash"), link_data.get("picture")])

    if isinstance(asset_feed_spec, dict):
        images = asset_feed_spec.get("images") or []
        if isinstance(images, list):
            for image in images:
                if isinstance(image, dict):
                    image_candidates.extend([image.get("hash"), image.get("url")])

    return MEDIA_TYPE_IMAGE if _first_non_empty(image_candidates) else MEDIA_TYPE_UNKNOWN
