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


def _has_video_play_evidence(ad: Dict[str, Any]) -> bool:
    """Um ad com video plays registrados é vídeo por definição — só vídeo gera
    video_play_actions. Sinal decisivo para creatives SHARE (post boostado) cujo
    video_id não aparece no creative.

    NÃO usamos a curva de retenção (video_play_curve_actions): em casos raros ela
    aparece com valor > 0 em ads de imagem, enquanto video_total_plays é confiável."""
    try:
        return float(ad.get("video_total_plays") or 0) > 0
    except (TypeError, ValueError):
        return False


def resolve_structural_media_type(ad: Dict[str, Any], primary_video_id: Optional[str] = None) -> Optional[str]:
    """Tipo derivável APENAS de sinais estruturais (o asset está presente no payload):
    video_id (clássico ou asset_feed) ou campos de imagem (image_hash/url, photo_data,
    asset_feed images). Retorna None quando a estrutura não determina o tipo — caso dos
    ads SHARE single-asset, cuja mídia só existe como effective_instagram_media_id.

    Serve tanto à classificação (resolve_media_type) quanto ao gate do enricher, que só
    dispara o lookup do igm para ads cujo tipo estrutural é None (evita chamadas redundantes
    para clássicos e SHARE multi-asset, que já vêm categorizados)."""
    if primary_video_id or resolve_primary_video_id(ad):
        return MEDIA_TYPE_VIDEO

    creative = ad.get("creative") or {}
    object_story_spec = creative.get("object_story_spec") or {}
    asset_feed_spec = creative.get("asset_feed_spec") or {}

    # thumbnail_url e thumb_storage_path existem em todos os ads (inclusive vídeo) —
    # não são indicadores confiáveis de imagem
    image_candidates = [
        creative.get("image_url"),
        creative.get("image_hash"),
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

    if _first_non_empty(image_candidates):
        return MEDIA_TYPE_IMAGE

    return None


def resolve_media_type(ad: Dict[str, Any], primary_video_id: Optional[str] = None) -> str:
    # ig_media_type is set from effective_instagram_media_id lookup (authoritative; only "video"/"image" accepted)
    ig_media_type = str(ad.get("ig_media_type") or "").strip().lower()
    if ig_media_type in (MEDIA_TYPE_VIDEO, MEDIA_TYPE_IMAGE):
        return ig_media_type

    # Sinais estruturais (asset presente) têm precedência sobre evidência de métrica —
    # uma imagem pode registrar plays/curva espúrios em casos raros
    structural = resolve_structural_media_type(ad, primary_video_id)
    if structural:
        return structural

    if _has_video_play_evidence(ad):
        return MEDIA_TYPE_VIDEO

    # Sem evidência nova: preservar classificação definitiva anterior (vinda do DB via
    # enricher) em vez de regredir para unknown — dias sem delivery não apagam o tipo
    preserved = str(ad.get("media_type") or "").strip().lower()
    if preserved in (MEDIA_TYPE_VIDEO, MEDIA_TYPE_IMAGE):
        return preserved

    return MEDIA_TYPE_UNKNOWN
