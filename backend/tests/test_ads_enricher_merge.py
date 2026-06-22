"""Testes do merge_details do AdsEnricher: indexação por ad_id com fallback por nome.

Contexto: a dedup por nome faz com que só um representante por nome seja fetched.
O representante deve receber o próprio creative (por id); homônimos (mesmo nome,
ad_id diferente) herdam por nome — comportamento documentado e aceito.
"""
from app.services.ads_enricher import AdsEnricher


def _enricher() -> AdsEnricher:
    return AdsEnricher(access_token="test-token")


def test_representative_gets_creative_by_id_and_homonym_inherits_by_name():
    raw = [
        {"ad_id": "111", "ad_name": "ADNV116"},
        {"ad_id": "222", "ad_name": "ADNV116"},  # homônimo não-fetched
    ]
    details = [
        {"id": "111", "name": "ADNV116", "creative": {"id": "cr1", "effective_instagram_media_id": "igm1"}},
    ]
    merged = _enricher().merge_details(raw, details)
    assert merged[0]["creative"]["effective_instagram_media_id"] == "igm1"
    assert merged[1]["creative"]["effective_instagram_media_id"] == "igm1"


def test_id_match_takes_precedence_over_name_collision():
    """Se dois details homônimos existem, o lookup por ad_id devolve o creative certo
    para cada um — o mapa por nome (last-write-wins) não contamina o representante."""
    raw = [
        {"ad_id": "111", "ad_name": "X"},
        {"ad_id": "222", "ad_name": "X"},
    ]
    details = [
        {"id": "111", "name": "X", "creative": {"id": "cr1", "video_id": "v1"}},
        {"id": "222", "name": "X", "creative": {"id": "cr2", "video_id": "v2"}},
    ]
    merged = _enricher().merge_details(raw, details)
    assert merged[0]["creative"]["id"] == "cr1"
    assert merged[1]["creative"]["id"] == "cr2"


def test_ad_without_detail_keeps_existing_creative():
    raw = [{"ad_id": "999", "ad_name": "SEM-DETAIL", "creative": {"id": "hydrated", "video_id": "v9"}}]
    details = [{"id": "111", "name": "OUTRO", "creative": {"id": "cr1"}}]
    merged = _enricher().merge_details(raw, details)
    assert merged[0]["creative"]["id"] == "hydrated"


def test_asset_feed_subset_injected_into_creative():
    """adcreatives.asset_feed_spec alimenta resolve_primary_video_id/resolve_media_type
    via subset enxuto injetado no creative (sem inflar o JSONB com o spec completo)."""
    details = [
        {
            "id": "111",
            "name": "X",
            "creative": {"id": "cr1"},
            "adcreatives": {
                "data": [
                    {
                        "asset_feed_spec": {
                            "videos": [{"video_id": "v1", "thumbnail_url": "t1", "adlabels": ["ruido"]}],
                            "images": [{"hash": "h1", "url": "u1"}],
                        },
                        "object_story_spec": {"page_id": "p1"},
                    }
                ]
            },
        },
    ]
    raw = [{"ad_id": "111", "ad_name": "X"}]
    merged = _enricher().merge_details(raw, details)
    creative = merged[0]["creative"]
    assert creative["asset_feed_spec"]["videos"] == [{"video_id": "v1", "thumbnail_url": "t1"}]
    assert creative["asset_feed_spec"]["images"] == [{"hash": "h1", "url": "u1"}]
    assert merged[0]["primary_video_id"] == "v1"
    assert merged[0]["video_owner_page_id"] == "p1"
    assert merged[0]["adcreatives_videos_ids"] == ["v1"]


def test_asset_feed_subset_does_not_overwrite_existing_spec():
    details = [
        {
            "id": "111",
            "name": "X",
            "creative": {"id": "cr1", "asset_feed_spec": {"videos": [{"video_id": "original"}]}},
            "adcreatives": {"data": [{"asset_feed_spec": {"videos": [{"video_id": "outro"}]}}]},
        },
    ]
    raw = [{"ad_id": "111", "ad_name": "X"}]
    merged = _enricher().merge_details(raw, details)
    assert merged[0]["creative"]["asset_feed_spec"]["videos"][0]["video_id"] == "original"


def test_row_without_name_and_id_is_left_untouched():
    raw = [{"adcreatives_videos_ids": ["preexistente"]}]
    details = [{"id": "111", "name": "X", "creative": {"id": "cr1"}}]
    merged = _enricher().merge_details(raw, details)
    assert merged[0]["adcreatives_videos_ids"] == ["preexistente"]
