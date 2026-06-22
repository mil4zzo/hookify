from app.services.creative_template import CreativeTemplateError, parse_creative_template, validate_template_for_bulk_clone


def test_parse_story_spec_simple_template():
    payload = {
        "name": "Simple Ad",
        "creative": {
            "id": "creative-1",
            "thumbnail_url": "https://example.com/thumb.jpg",
            "url_tags": "utm_source=test",
            "object_story_spec": {
                "page_id": "123",
                "link_data": {
                    "message": "Body text",
                    "name": "Title text",
                    "link": "https://example.com",
                    "call_to_action": {"type": "LEARN_MORE"},
                    "image_hash": "hash-1",
                },
            },
        },
    }

    template = validate_template_for_bulk_clone(parse_creative_template(payload))

    assert template.family == "story_spec_simple"
    assert template.media_kind == "image"
    assert len(template.media_slots) == 0
    assert template.preview.body == "Body text"
    assert template.preview.title == "Title text"
    assert template.preview.call_to_action == "LEARN_MORE"
    assert template.preview.link_url == "https://example.com"


def test_parse_asset_feed_template_with_rules():
    payload = {
        "name": "Asset Feed Ad",
        "creative": {
            "id": "creative-2",
            "thumbnail_url": "https://example.com/thumb.jpg",
            "object_story_spec": {
                "page_id": "123",
                "instagram_user_id": "456",
            },
            "asset_feed_spec": {
                "images": [
                    {
                        "hash": "hash-1",
                        "adlabels": [{"name": "image_label_a"}],
                    }
                ],
                "bodies": [{"text": "Asset body"}],
                "titles": [{"text": "Asset title"}],
                "call_to_action_types": ["LEARN_MORE"],
                "link_urls": [{"website_url": "https://example.com"}],
                "asset_customization_rules": [
                    {
                        "customization_spec": {"publisher_platforms": ["facebook"]},
                        "image_label": {"name": "image_label_a"},
                        "body_label": {"name": "body_label_a"},
                        "priority": 1,
                    }
                ],
            },
        },
    }

    template = validate_template_for_bulk_clone(parse_creative_template(payload))

    assert template.family == "asset_feed_spec_labeled"
    assert template.media_kind == "image"
    assert len(template.media_slots) == 1
    assert template.media_slots[0].slot_key == "slot_1"
    assert template.media_slots[0].label_name == "image_label_a"
    assert template.preview.body == "Asset body"
    assert template.preview.title == "Asset title"
    assert template.preview.call_to_action == "LEARN_MORE"
    assert template.preview.link_url == "https://example.com"


def test_parse_unsupported_catalog_template():
    payload = {
        "name": "Catalog Ad",
        "creative": {
            "id": "creative-3",
            "object_type": "PRODUCT_CATALOG",
            "object_story_spec": {
                "page_id": "123",
                "template_data": {"message": "Catalog body"},
            },
        },
    }

    template = parse_creative_template(payload)

    try:
        validate_template_for_bulk_clone(template)
    except CreativeTemplateError as exc:
        assert "catalogo" in exc.message.lower()
        return

    raise AssertionError("Catalog template deveria ser rejeitado")


def test_parse_multi_slot_asset_feed_template():
    payload = {
        "name": "Multi Slot Ad",
        "creative": {
            "id": "creative-4",
            "thumbnail_url": "https://example.com/thumb.jpg",
            "object_story_spec": {
                "page_id": "123",
                "instagram_user_id": "456",
            },
            "asset_feed_spec": {
                "images": [
                    {"hash": "hash-1", "adlabels": [{"name": "slot_default"}]},
                    {"hash": "hash-2", "adlabels": [{"name": "slot_reels"}]},
                ],
                "bodies": [{"text": "Asset body"}],
                "titles": [{"text": "Asset title"}],
                "call_to_action_types": ["LEARN_MORE"],
                "link_urls": [{"website_url": "https://example.com"}],
                "asset_customization_rules": [
                    {
                        "customization_spec": {"publisher_platforms": ["facebook"]},
                        "image_label": {"name": "slot_default"},
                        "priority": 1,
                    },
                    {
                        "customization_spec": {"publisher_platforms": ["instagram"], "instagram_positions": ["story", "reels"]},
                        "image_label": {"name": "slot_reels"},
                        "priority": 2,
                    },
                ],
            },
        },
    }

    template = validate_template_for_bulk_clone(parse_creative_template(payload))

    assert len(template.media_slots) == 2
    assert template.media_slots[0].slot_key == "slot_1"
    assert template.media_slots[1].slot_key == "slot_2"
    assert template.media_slots[1].rules_count == 1
