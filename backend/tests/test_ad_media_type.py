"""Testes de classificação de media_type (ad_media.resolve_media_type).

Cobre o caso real dos creatives SHARE (post boostado do Instagram): o creative
não traz video_id nem campos de imagem — apenas thumbnail_url, que existe em
QUALQUER tipo de ad e não pode ser usado como sinal de imagem.
"""
import pytest

from app.services.ad_media import (
    MEDIA_TYPE_IMAGE,
    MEDIA_TYPE_UNKNOWN,
    MEDIA_TYPE_VIDEO,
    resolve_media_type,
    resolve_structural_media_type,
)


SHARE_CREATIVE_NO_MEDIA = {
    "id": "1244107624544197",
    "actor_id": "693869070480113",
    "object_type": "SHARE",
    "thumbnail_url": "https://scontent.example/thumb.jpg",
    "instagram_permalink_url": "https://www.instagram.com/p/XXX/",
    "effective_object_story_id": "693869070480113_122169447488931025",
}


def test_share_with_thumbnail_only_is_unknown_not_image():
    """Regressão do bug: thumbnail_url sozinho classificava SHARE como image."""
    ad = {"creative": dict(SHARE_CREATIVE_NO_MEDIA), "thumbnail_url": "https://scontent.example/thumb.jpg"}
    assert resolve_media_type(ad) == MEDIA_TYPE_UNKNOWN


def test_video_id_wins():
    ad = {"creative": {"video_id": "123"}}
    assert resolve_media_type(ad) == MEDIA_TYPE_VIDEO


def test_video_metric_evidence_total_plays():
    ad = {"creative": dict(SHARE_CREATIVE_NO_MEDIA), "video_total_plays": 1500}
    assert resolve_media_type(ad) == MEDIA_TYPE_VIDEO


def test_curve_alone_is_not_evidence():
    """Curva pode aparecer espúria em imagens — só video_total_plays é confiável."""
    ad = {"creative": dict(SHARE_CREATIVE_NO_MEDIA), "video_play_curve_actions": [100, 72, 51]}
    assert resolve_media_type(ad) == MEDIA_TYPE_UNKNOWN


def test_empty_curve_is_not_evidence():
    ad = {"creative": dict(SHARE_CREATIVE_NO_MEDIA), "video_total_plays": 0, "video_play_curve_actions": []}
    assert resolve_media_type(ad) == MEDIA_TYPE_UNKNOWN


def test_zero_plays_is_not_evidence():
    ad = {"creative": dict(SHARE_CREATIVE_NO_MEDIA), "video_total_plays": 0}
    assert resolve_media_type(ad) == MEDIA_TYPE_UNKNOWN


def test_genuine_image_with_spurious_curve_stays_image():
    """Campos de imagem genuínos têm precedência sobre curva/plays espúrios."""
    ad = {"creative": {"image_hash": "abc123"}, "video_play_curve_actions": [100, 50], "video_total_plays": 3}
    assert resolve_media_type(ad) == MEDIA_TYPE_IMAGE


def test_genuine_image_fields_classify_image():
    ad = {"creative": {"image_hash": "abc123"}}
    assert resolve_media_type(ad) == MEDIA_TYPE_IMAGE


def test_photo_data_classifies_image():
    ad = {"creative": {"object_story_spec": {"photo_data": {"image_hash": "abc123"}}}}
    assert resolve_media_type(ad) == MEDIA_TYPE_IMAGE


def test_preserved_video_classification_survives_zero_delivery_day():
    """Dia sem delivery (sem plays) não pode regredir um vídeo conhecido para unknown."""
    ad = {"creative": dict(SHARE_CREATIVE_NO_MEDIA), "media_type": "video", "video_total_plays": 0}
    assert resolve_media_type(ad) == MEDIA_TYPE_VIDEO


def test_preserved_image_classification_survives():
    ad = {"creative": dict(SHARE_CREATIVE_NO_MEDIA), "media_type": "image"}
    assert resolve_media_type(ad) == MEDIA_TYPE_IMAGE


def test_video_metric_evidence_overrides_stale_image_classification():
    """Auto-correção: ad marcado image que registra plays vira video."""
    ad = {"creative": dict(SHARE_CREATIVE_NO_MEDIA), "media_type": "image", "video_total_plays": 50}
    assert resolve_media_type(ad) == MEDIA_TYPE_VIDEO


def test_preserved_unknown_stays_unknown():
    ad = {"creative": dict(SHARE_CREATIVE_NO_MEDIA), "media_type": "unknown"}
    assert resolve_media_type(ad) == MEDIA_TYPE_UNKNOWN


# --- ig_media_type (effective_instagram_media_id): sinal autoritativo, vence tudo ---

def test_ig_media_type_image_wins_over_play_evidence():
    """Caso real dos 5 falso-vídeo da auditoria: heurística de plays marcou video,
    mas o IG media oficial diz IMAGE."""
    ad = {"creative": dict(SHARE_CREATIVE_NO_MEDIA), "video_total_plays": 50, "ig_media_type": "image"}
    assert resolve_media_type(ad) == MEDIA_TYPE_IMAGE


def test_ig_media_type_image_wins_over_video_id():
    ad = {"creative": {"video_id": "123"}, "ig_media_type": "image"}
    assert resolve_media_type(ad) == MEDIA_TYPE_IMAGE


def test_ig_media_type_video_wins_over_empty_creative():
    ad = {"creative": dict(SHARE_CREATIVE_NO_MEDIA), "ig_media_type": "video"}
    assert resolve_media_type(ad) == MEDIA_TYPE_VIDEO


def test_ig_media_type_video_wins_over_image_fields():
    ad = {"creative": {"image_hash": "abc"}, "ig_media_type": "video"}
    assert resolve_media_type(ad) == MEDIA_TYPE_VIDEO


def test_ig_media_type_absent_falls_through_to_chain():
    ad = {"creative": dict(SHARE_CREATIVE_NO_MEDIA), "video_total_plays": 10}
    assert resolve_media_type(ad) == MEDIA_TYPE_VIDEO


def test_ig_media_type_invalid_value_falls_through_to_chain():
    """carousel_album (ou lixo) não é aceito — cai na chain normal."""
    ad = {"creative": dict(SHARE_CREATIVE_NO_MEDIA), "video_total_plays": 10, "ig_media_type": "carousel_album"}
    assert resolve_media_type(ad) == MEDIA_TYPE_VIDEO
    ad_unknown = {"creative": dict(SHARE_CREATIVE_NO_MEDIA), "ig_media_type": "CAROUSEL_ALBUM"}
    assert resolve_media_type(ad_unknown) == MEDIA_TYPE_UNKNOWN


# --- resolve_structural_media_type: gate do enricher (None = precisa do igm) ---

def test_structural_video_id_direct():
    assert resolve_structural_media_type({"creative": {"video_id": "123"}}) == MEDIA_TYPE_VIDEO


def test_structural_video_from_asset_feed():
    ad = {"creative": {"asset_feed_spec": {"videos": [{"video_id": "v1"}]}}}
    assert resolve_structural_media_type(ad) == MEDIA_TYPE_VIDEO


def test_structural_image_hash_direct():
    assert resolve_structural_media_type({"creative": {"image_hash": "abc"}}) == MEDIA_TYPE_IMAGE


def test_structural_image_from_asset_feed():
    ad = {"creative": {"asset_feed_spec": {"images": [{"hash": "h1"}]}}}
    assert resolve_structural_media_type(ad) == MEDIA_TYPE_IMAGE


def test_structural_share_single_asset_is_none():
    """SHARE single-asset (só igm, sem video_id/image_hash/asset_feed) → None → precisa do igm."""
    creative = dict(SHARE_CREATIVE_NO_MEDIA)
    creative["effective_instagram_media_id"] = "igm123"
    assert resolve_structural_media_type({"creative": creative}) is None


def test_structural_ignores_play_evidence():
    """plays NÃO é sinal estrutural — gate deve deixar passar pro igm mesmo com plays."""
    ad = {"creative": dict(SHARE_CREATIVE_NO_MEDIA), "video_total_plays": 9999}
    assert resolve_structural_media_type(ad) is None
