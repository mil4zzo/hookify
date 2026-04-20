import unittest
from unittest.mock import Mock, patch

import requests

from app.services.thumbnail_cache import CachedThumb


class TestStorageThumbExists(unittest.TestCase):
    def test_returns_true_when_storage_confirms_object(self) -> None:
        from app.services.thumbnail_cache import storage_thumb_exists

        response = Mock(status_code=200)
        response.raise_for_status.return_value = None

        with patch("app.services.thumbnail_cache.requests.head", return_value=response) as head:
            self.assertTrue(storage_thumb_exists("thumbs/user/by-adname/a.webp"))

        self.assertIn("/storage/v1/object/ad-thumbs/thumbs/user/by-adname/a.webp", head.call_args.args[0])

    def test_returns_false_for_404(self) -> None:
        from app.services.thumbnail_cache import storage_thumb_exists

        response = Mock(status_code=404)

        with patch("app.services.thumbnail_cache.requests.head", return_value=response):
            self.assertFalse(storage_thumb_exists("thumbs/user/missing.webp"))

    def test_returns_false_for_empty_path(self) -> None:
        from app.services.thumbnail_cache import storage_thumb_exists

        self.assertFalse(storage_thumb_exists(""))

    def test_returns_false_without_leaking_request_errors(self) -> None:
        from app.services.thumbnail_cache import storage_thumb_exists

        with patch("app.services.thumbnail_cache.requests.head", side_effect=requests.Timeout("slow")):
            self.assertFalse(storage_thumb_exists("thumbs/user/slow.webp"))


class TestBackgroundCachedThumbClassification(unittest.TestCase):
    def test_valid_existing_cache_is_reusable(self) -> None:
        from app.services.background_tasks import _classify_existing_cached_thumb

        cached = CachedThumb(
            storage_path="thumbs/user/by-adname/a.webp",
            public_url="https://example.test/a.webp",
            cached_at="2026-04-18T00:00:00+00:00",
            source_url="https://meta.test/a.jpg",
        )

        result = _classify_existing_cached_thumb(
            cached,
            pack_id="pack-1",
            thumb_key="ad name",
            storage_exists=lambda _: True,
        )

        self.assertEqual(result, "valid")

    def test_missing_storage_object_is_not_reused(self) -> None:
        from app.services.background_tasks import _classify_existing_cached_thumb

        cached = CachedThumb(
            storage_path="thumbs/user/by-adname/deleted.webp",
            public_url="https://example.test/deleted.webp",
            cached_at="2026-04-18T00:00:00+00:00",
            source_url="https://meta.test/a.jpg",
        )

        result = _classify_existing_cached_thumb(
            cached,
            pack_id="pack-1",
            thumb_key="ad name",
            storage_exists=lambda _: False,
        )

        self.assertEqual(result, "missing_object")

    def test_validation_error_is_not_reused(self) -> None:
        from app.services.background_tasks import _classify_existing_cached_thumb

        cached = CachedThumb(
            storage_path="thumbs/user/by-adname/error.webp",
            public_url="https://example.test/error.webp",
            cached_at="2026-04-18T00:00:00+00:00",
            source_url="https://meta.test/a.jpg",
        )

        def fail(_: str) -> bool:
            raise RuntimeError("storage unavailable")

        result = _classify_existing_cached_thumb(
            cached,
            pack_id="pack-1",
            thumb_key="ad name",
            storage_exists=fail,
        )

        self.assertEqual(result, "validation_error")


class TestAnalyticsStorageThumbnailSelection(unittest.TestCase):
    def test_prefers_representative_storage_thumbnail(self) -> None:
        from app.routes.analytics import _select_storage_thumbnail_for_group

        thumbnail, source_ad_id = _select_storage_thumbnail_for_group(
            "ad-1",
            {"ad-1", "ad-2"},
            {
                "ad-1": "https://example.supabase.co/storage/v1/object/public/ad-thumbs/ad-1.webp",
                "ad-2": "https://example.supabase.co/storage/v1/object/public/ad-thumbs/ad-2.webp",
            },
        )

        self.assertEqual(thumbnail, "https://example.supabase.co/storage/v1/object/public/ad-thumbs/ad-1.webp")
        self.assertEqual(source_ad_id, "ad-1")

    def test_uses_sibling_storage_thumbnail_when_representative_is_missing(self) -> None:
        from app.routes.analytics import _select_storage_thumbnail_for_group

        thumbnail, source_ad_id = _select_storage_thumbnail_for_group(
            "ad-1",
            {"ad-1", "ad-2"},
            {
                "ad-2": "https://example.supabase.co/storage/v1/object/public/ad-thumbs/ad-2.webp",
            },
        )

        self.assertEqual(thumbnail, "https://example.supabase.co/storage/v1/object/public/ad-thumbs/ad-2.webp")
        self.assertEqual(source_ad_id, "ad-2")

    def test_returns_empty_when_group_has_no_storage_thumbnail(self) -> None:
        from app.routes.analytics import _select_storage_thumbnail_for_group

        thumbnail, source_ad_id = _select_storage_thumbnail_for_group("ad-1", {"ad-1", "ad-2"}, {})

        self.assertIsNone(thumbnail)
        self.assertIsNone(source_ad_id)


if __name__ == "__main__":
    unittest.main()
