"""Testes da cache/reparo de thumbnails (Storage-only).

Vivia em `app/services/thumbnail_cache_repair_checks.py` — fora de `tests/` e
sem o prefixo `test_`, então o pytest NUNCA o coletava. Eram 10 testes que
ninguém rodava: 3 já apontavam para `_select_storage_thumbnail_for_group`, que
saiu do analytics e só existe no `.backup` — a classe foi removida aqui. Um
teste que não roda não é uma rede de segurança, é um arquivo.
"""
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


if __name__ == "__main__":
    unittest.main()
