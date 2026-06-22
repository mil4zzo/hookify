"""Testes do _extract_video_info do transcription_worker.

Cobre as 3 origens de mídia para transcrever: clássico/multi-asset (video_id) e
SHARE single-asset (effective_instagram_media_id, sem video_id).
"""
from app.services.transcription_worker import _extract_video_info


def test_classic_video_included_with_video_id():
    ads = [{"ad_name": "A", "media_type": "video", "primary_video_id": "v1",
            "creative": {"actor_id": "act1"}}]
    out = _extract_video_info(ads)
    assert out["A"]["video_id"] == "v1"
    assert out["A"]["ig_media_id"] == ""


def test_single_asset_video_included_via_igm():
    """SHARE single-asset: media_type=video, sem video_id, só igm → entra com ig_media_id."""
    ads = [{"ad_name": "B", "media_type": "video", "primary_video_id": None,
            "creative": {"actor_id": "act1", "effective_instagram_media_id": "igm1"}}]
    out = _extract_video_info(ads)
    assert "B" in out
    assert out["B"]["video_id"] == ""
    assert out["B"]["ig_media_id"] == "igm1"


def test_image_excluded():
    ads = [{"ad_name": "C", "media_type": "image", "primary_video_id": None,
            "creative": {"actor_id": "act1", "effective_instagram_media_id": "igm2"}}]
    out = _extract_video_info(ads)
    assert "C" not in out


def test_unknown_without_video_id_or_igm_excluded():
    ads = [{"ad_name": "D", "media_type": "unknown", "primary_video_id": None,
            "creative": {"actor_id": "act1"}}]
    out = _extract_video_info(ads)
    assert "D" not in out


def test_first_occurrence_per_name_wins():
    ads = [
        {"ad_name": "E", "media_type": "video", "primary_video_id": "v1", "creative": {}},
        {"ad_name": "E", "media_type": "video", "primary_video_id": "v2", "creative": {}},
    ]
    out = _extract_video_info(ads)
    assert out["E"]["video_id"] == "v1"
