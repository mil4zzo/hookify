from app.services.bulk_ad_service import MediaRef
from app.services.campaign_bulk_service import _map_slot_files_to_template
from app.services.creative_template import (
    CreativeCloneCapabilities,
    CreativeMediaSlot,
    CreativePreview,
    CreativeTemplate,
)
from app.services.meta_api_errors import MetaAPIError


def _template_with_slots(*slots: CreativeMediaSlot) -> CreativeTemplate:
    return CreativeTemplate(
        family="asset_feed_spec_labeled",
        media_kind="image",
        actor_context={},
        url_tags=None,
        story_spec_base={"page_id": "123"},
        asset_feed_spec_base={},
        rules=[],
        media_slots=list(slots),
        preview=CreativePreview(),
        capabilities=CreativeCloneCapabilities(
            supports_bulk_clone=True,
            supports_media_swap=True,
        ),
    )


def _image_ref(file_index: int) -> MediaRef:
    return MediaRef(
        file_index=file_index,
        file_name=f"image-{file_index}.png",
        media_type="image",
        image_hash=f"hash-{file_index}",
    )


def test_single_slot_uses_feed_ref():
    template = _template_with_slots(
        CreativeMediaSlot(
            slot_key="slot_1",
            display_name="Principal",
            media_type="image",
            source="image_label",
            label_name="main",
            rules_count=1,
            placements_summary=["facebook_feed"],
        )
    )

    result = _map_slot_files_to_template(
        {"slot_1": 0},
        {0: _image_ref(0)},
        template,
        "bundle-1",
    )

    assert result.slot_refs["slot_1"].file_index == 0


def test_single_slot_falls_back_to_story_ref():
    template = _template_with_slots(
        CreativeMediaSlot(
            slot_key="slot_1",
            display_name="Principal",
            media_type="image",
            source="image_label",
            label_name="main",
            rules_count=1,
            placements_summary=["instagram_story"],
        )
    )

    result = _map_slot_files_to_template(
        {"slot_1": 1},
        {1: _image_ref(1)},
        template,
        "bundle-1",
    )

    assert result.slot_refs["slot_1"].file_index == 1


def test_dual_slot_maps_story_via_placements_summary():
    template = _template_with_slots(
        CreativeMediaSlot(
            slot_key="slot_feed",
            display_name="Feed",
            media_type="image",
            source="image_label",
            label_name="feed",
            rules_count=1,
            placements_summary=["facebook_feed"],
        ),
        CreativeMediaSlot(
            slot_key="slot_story",
            display_name="Story",
            media_type="image",
            source="image_label",
            label_name="story",
            rules_count=1,
            placements_summary=["instagram_story", "facebook_reels"],
        ),
    )

    result = _map_slot_files_to_template(
        {"slot_feed": 1, "slot_story": 2},
        {1: _image_ref(1), 2: _image_ref(2)},
        template,
        "bundle-1",
    )

    assert result.slot_refs["slot_feed"].file_index == 1
    assert result.slot_refs["slot_story"].file_index == 2


def test_dual_slot_missing_feed_raises():
    template = _template_with_slots(
        CreativeMediaSlot(
            slot_key="slot_feed",
            display_name="Feed",
            media_type="image",
            source="image_label",
            label_name="feed",
            rules_count=1,
            placements_summary=["facebook_feed"],
        ),
        CreativeMediaSlot(
            slot_key="slot_story",
            display_name="Story",
            media_type="image",
            source="image_label",
            label_name="story",
            rules_count=1,
            placements_summary=["instagram_story"],
        ),
    )

    try:
        _map_slot_files_to_template(
            {"slot_story": 2},
            {2: _image_ref(2)},
            template,
            "bundle-1",
        )
        assert False, "Expected MetaAPIError"
    except MetaAPIError as exc:
        assert exc.error_code == "bundle_missing_slot"
        assert "feed" in exc.message.lower()


def test_dual_slot_missing_story_raises():
    template = _template_with_slots(
        CreativeMediaSlot(
            slot_key="slot_feed",
            display_name="Feed",
            media_type="image",
            source="image_label",
            label_name="feed",
            rules_count=1,
            placements_summary=["facebook_feed"],
        ),
        CreativeMediaSlot(
            slot_key="slot_story",
            display_name="Story",
            media_type="image",
            source="image_label",
            label_name="story",
            rules_count=1,
            placements_summary=["instagram_story"],
        ),
    )

    try:
        _map_slot_files_to_template(
            {"slot_feed": 1},
            {1: _image_ref(1)},
            template,
            "bundle-1",
        )
        assert False, "Expected MetaAPIError"
    except MetaAPIError as exc:
        assert exc.error_code == "bundle_missing_slot"
        assert "story" in exc.message.lower()
