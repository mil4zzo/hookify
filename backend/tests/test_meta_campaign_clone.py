import unittest

from app.services.meta_campaign_clone import (
    merge_page_id_from_promoted_object,
    object_story_actor_from_creative,
    resolve_creative_destination_url,
)


class TestObjectStoryActorFromCreative(unittest.TestCase):
    def test_top_level_page_id(self) -> None:
        self.assertEqual(
            object_story_actor_from_creative(
                {"object_story_spec": {"page_id": "123", "link_data": {"message": "x"}}},
            ),
            {"page_id": "123"},
        )

    def test_page_id_inside_link_data(self) -> None:
        self.assertEqual(
            object_story_actor_from_creative(
                {"object_story_spec": {"link_data": {"page_id": "456", "link": "https://x.com"}}},
            ),
            {"page_id": "456"},
        )

    def test_merge_promoted_object(self) -> None:
        actor: dict = {}
        merge_page_id_from_promoted_object(actor, {"page_id": 789, "pixel_id": "px"})
        self.assertEqual(actor, {"page_id": "789"})

    def test_merge_promoted_skips_if_already_has_page(self) -> None:
        actor = {"page_id": "1"}
        merge_page_id_from_promoted_object(actor, {"page_id": "2"})
        self.assertEqual(actor["page_id"], "1")


class TestResolveDestinationUrl(unittest.TestCase):
    def test_from_link_url(self) -> None:
        self.assertEqual(
            resolve_creative_destination_url({"link_url": " https://a.com "}),
            "https://a.com",
        )

    def test_from_call_to_action_value(self) -> None:
        self.assertEqual(
            resolve_creative_destination_url(
                {
                    "call_to_action": {"type": "LEARN_MORE", "value": {"link": "https://b.com"}},
                },
            ),
            "https://b.com",
        )


if __name__ == "__main__":
    unittest.main()
