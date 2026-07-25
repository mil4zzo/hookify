"""
Tests for backend/app/routes/shares.py (links públicos de criativos em stories).

Trava o contrato de segurança do share:
- snapshot sanitizado (allowlist de métricas, nada entra por acidente);
- ownership: ad_name sem linha em ads (RLS) → 422;
- mídia inacessível degrada o slide (thumbnail), nunca bloqueia o share;
- read-path público: 404 genérico p/ inexistente/revogado/expirado, payload
  allowlist (nunca user_id/id/token), view_count best-effort.

Pure unittest mocks — no server started.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from app.routes.shares import (
    MAX_SHARE_ITEMS,
    build_share_items,
    create_share,
    get_share_public,
    is_share_viewable,
    public_share_payload,
    revoke_share,
    sanitize_metrics,
    summarize_media_rows,
    validate_share_payload,
)


_USER = {"user_id": "user-1", "token": "jwt-1", "claims": {}}


def _future_iso(days: int = 10) -> str:
    return (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()


def _past_iso(days: int = 1) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()


# ── sanitize_metrics ─────────────────────────────────────────────────────────

class TestSanitizeMetrics:
    def test_drops_unknown_keys(self):
        out = sanitize_metrics({"spend": 12.5, "user_id": "evil", "campaign_name": "x"})
        assert out == {"spend": 12.5}

    def test_non_numeric_becomes_none(self):
        out = sanitize_metrics({"ctr": "0.02", "hook": True, "cpr": None})
        assert out == {"ctr": None, "hook": None, "cpr": None}

    def test_non_finite_becomes_none(self):
        out = sanitize_metrics({"cpm": float("nan"), "cpc": float("inf"), "spend": 1})
        assert out == {"cpm": None, "cpc": None, "spend": 1.0}

    def test_non_dict_returns_empty(self):
        assert sanitize_metrics(None) == {}
        assert sanitize_metrics([1, 2]) == {}


# ── validate_share_payload ───────────────────────────────────────────────────

def _valid_body(**overrides):
    body = {
        "date_start": "2026-07-01",
        "date_stop": "2026-07-20",
        "currency": "brl",
        "items": [
            {"ad_name": "Criativo A", "metrics": {"spend": 10}},
            {"ad_name": "Criativo B", "metrics": {"ctr": 0.02}},
        ],
    }
    body.update(overrides)
    return body


class TestValidateSharePayload:
    def test_happy_path_normalizes(self):
        payload = validate_share_payload(_valid_body())
        assert payload["date_start"] == "2026-07-01"
        assert payload["currency"] == "BRL"
        assert [i["ad_name"] for i in payload["items"]] == ["Criativo A", "Criativo B"]
        assert payload["items"][0]["metrics"] == {"spend": 10.0}

    def test_invalid_currency_becomes_none(self):
        assert validate_share_payload(_valid_body(currency="R$"))["currency"] is None
        assert validate_share_payload(_valid_body(currency=""))["currency"] is None

    def test_bad_date_422(self):
        with pytest.raises(HTTPException) as exc:
            validate_share_payload(_valid_body(date_start="01/07/2026"))
        assert exc.value.status_code == 422

    def test_start_after_stop_422(self):
        with pytest.raises(HTTPException) as exc:
            validate_share_payload(_valid_body(date_start="2026-07-21"))
        assert exc.value.status_code == 422

    def test_empty_items_422(self):
        with pytest.raises(HTTPException) as exc:
            validate_share_payload(_valid_body(items=[]))
        assert exc.value.status_code == 422

    def test_too_many_items_422(self):
        items = [{"ad_name": f"c{i}", "metrics": {}} for i in range(MAX_SHARE_ITEMS + 1)]
        with pytest.raises(HTTPException) as exc:
            validate_share_payload(_valid_body(items=items))
        assert exc.value.status_code == 422

    def test_duplicate_ad_name_422(self):
        items = [{"ad_name": "dup"}, {"ad_name": " dup "}]
        with pytest.raises(HTTPException) as exc:
            validate_share_payload(_valid_body(items=items))
        assert exc.value.status_code == 422


# ── summarize_media_rows ─────────────────────────────────────────────────────

class TestSummarizeMediaRows:
    @patch("app.routes.shares.build_public_storage_url", return_value="https://sb/thumb.webp")
    def test_video_flag_and_first_thumb_wins(self, _build):
        rows = [
            {"ad_name": "A", "media_type": "image", "thumb_storage_path": ""},
            {"ad_name": "A", "media_type": "video", "thumb_storage_path": "u/a1.webp"},
            {"ad_name": "A", "media_type": "video", "thumb_storage_path": "u/a2.webp"},
        ]
        summary = summarize_media_rows(rows)
        assert summary["A"]["is_video"] is True
        assert summary["A"]["thumbnail_url"] == "https://sb/thumb.webp"
        _build.assert_called_once()  # a1 resolve; a2 nem é tentado

    def test_no_thumb_is_none(self):
        summary = summarize_media_rows([{"ad_name": "B", "media_type": "image"}])
        assert summary["B"] == {"is_video": False, "thumbnail_url": None}


# ── build_share_items ────────────────────────────────────────────────────────

class TestBuildShareItems:
    def test_video_resolved(self):
        expires = datetime.now(timezone.utc) + timedelta(hours=20)
        slides = build_share_items(
            [{"ad_name": "V", "metrics": {"spend": 5.0}}],
            {"V": {"is_video": True, "thumbnail_url": "https://sb/t.webp"}},
            {"V": {"url": "https://cdn/video.mp4", "expires_at": expires, "video_id": "123"}},
        )
        media = slides[0]["media"]
        assert media["type"] == "video"
        assert media["video_url"] == "https://cdn/video.mp4"
        assert media["video_expires_at"] == expires.isoformat()
        assert media["image_url"] is None
        assert slides[0]["metrics"] == {"spend": 5.0}

    def test_video_error_degrades_to_thumbnail(self):
        slides = build_share_items(
            [{"ad_name": "V", "metrics": {}}],
            {"V": {"is_video": True, "thumbnail_url": "https://sb/t.webp"}},
            {"V": {"url": None, "error": "Vídeo removido"}},
        )
        media = slides[0]["media"]
        assert media["type"] == "video"
        assert media["video_url"] is None
        assert media["thumbnail_url"] == "https://sb/t.webp"

    def test_image_uses_image_url(self):
        slides = build_share_items(
            [{"ad_name": "I", "metrics": {}}],
            {"I": {"is_video": False, "thumbnail_url": "https://sb/t.webp"}},
            {"I": {"url": "https://fb/ads/image?d=x", "expires_at": _future_iso(30), "video_id": None}},
        )
        media = slides[0]["media"]
        assert media["type"] == "image"
        assert media["image_url"] == "https://fb/ads/image?d=x"
        assert media["video_url"] is None
        assert media["video_expires_at"] is None

    def test_missing_media_result_still_builds_slide(self):
        slides = build_share_items(
            [{"ad_name": "X", "metrics": {"ctr": 0.01}}],
            {"X": {"is_video": False, "thumbnail_url": None}},
            {},
        )
        assert slides[0]["media"]["type"] == "image"
        assert slides[0]["media"]["image_url"] is None


# ── is_share_viewable / public_share_payload ─────────────────────────────────

class TestViewability:
    def test_active(self):
        assert is_share_viewable({"revoked_at": None, "expires_at": _future_iso()}) is True

    def test_null_expiry_is_viewable(self):
        assert is_share_viewable({"revoked_at": None, "expires_at": None}) is True

    def test_revoked(self):
        assert is_share_viewable({"revoked_at": _past_iso(), "expires_at": _future_iso()}) is False

    def test_expired(self):
        assert is_share_viewable({"revoked_at": None, "expires_at": _past_iso()}) is False

    def test_missing_row(self):
        assert is_share_viewable(None) is False


class TestPublicPayload:
    def test_allowlist_only(self):
        row = {
            "id": "uuid-1",
            "user_id": "user-1",
            "token": "secret",
            "view_count": 7,
            "items": [{"ad_name": "A"}],
            "date_start": "2026-07-01",
            "date_stop": "2026-07-20",
            "currency": "BRL",
            "created_at": "2026-07-25T00:00:00+00:00",
            "expires_at": _future_iso(),
        }
        payload = public_share_payload(row)
        assert set(payload.keys()) == {
            "items", "date_start", "date_stop", "currency", "created_at", "expires_at",
        }
        assert "user_id" not in str(payload)


# ── create_share (endpoint, mocks) ───────────────────────────────────────────

def _fake_sb_insert(results):
    """sb fake onde table('ad_shares').insert(payload).execute() consome `results`
    (exceção ou MagicMock(data=[...])), na ordem."""
    sb = MagicMock()
    sb.table.return_value.insert.return_value.execute.side_effect = results
    return sb


_MEDIA_BATCH_OK = {
    "results": {
        "Criativo A": {"url": "https://cdn/v.mp4", "expires_at": _future_iso(), "video_id": "9"},
        "Criativo B": {"url": None, "expires_at": None, "video_id": None, "error": "sem mídia"},
    }
}


class TestCreateShare:
    @patch("app.routes.shares.get_supabase_for_user")
    @patch("app.routes.shares.get_media_source_urls_batch", return_value=_MEDIA_BATCH_OK)
    @patch("app.services.supabase_repo.get_ads_media_summary_by_names")
    def test_happy_path(self, get_rows, _batch, get_sb):
        get_rows.return_value = [
            {"ad_name": "Criativo A", "media_type": "video", "thumb_storage_path": "u/a.webp"},
            {"ad_name": "Criativo B", "media_type": "image", "thumb_storage_path": ""},
        ]
        sb = _fake_sb_insert([MagicMock(data=[{"id": "uuid-1"}])])
        get_sb.return_value = sb

        result = create_share(body=_valid_body(), api=MagicMock(), user=dict(_USER))

        assert result["id"] == "uuid-1"
        assert len(result["token"]) >= 30
        inserted = sb.table.return_value.insert.call_args[0][0]
        assert inserted["user_id"] == "user-1"
        assert inserted["currency"] == "BRL"
        assert len(inserted["items"]) == 2
        assert inserted["items"][0]["media"]["video_url"] == "https://cdn/v.mp4"
        # Slide sem mídia resolvida existe mesmo assim (degrada p/ thumb/placeholder)
        assert inserted["items"][1]["media"]["video_url"] is None

    @patch("app.routes.shares.get_supabase_for_user")
    @patch("app.routes.shares.get_media_source_urls_batch", return_value=_MEDIA_BATCH_OK)
    @patch("app.services.supabase_repo.get_ads_media_summary_by_names", return_value=[])
    def test_unknown_ad_name_422(self, *_mocks):
        with pytest.raises(HTTPException) as exc:
            create_share(body=_valid_body(), api=MagicMock(), user=dict(_USER))
        assert exc.value.status_code == 422
        assert "não encontrados" in str(exc.value.detail)

    @patch("app.routes.shares.get_supabase_for_user")
    @patch("app.routes.shares.get_media_source_urls_batch", return_value=_MEDIA_BATCH_OK)
    @patch("app.services.supabase_repo.get_ads_media_summary_by_names")
    def test_token_collision_retries(self, get_rows, _batch, get_sb):
        get_rows.return_value = [
            {"ad_name": "Criativo A", "media_type": "video", "thumb_storage_path": ""},
            {"ad_name": "Criativo B", "media_type": "image", "thumb_storage_path": ""},
        ]
        sb = _fake_sb_insert([
            Exception('duplicate key value violates unique constraint "ad_shares_token_key"'),
            MagicMock(data=[{"id": "uuid-2"}]),
        ])
        get_sb.return_value = sb

        result = create_share(body=_valid_body(), api=MagicMock(), user=dict(_USER))

        assert result["id"] == "uuid-2"
        first = sb.table.return_value.insert.call_args_list[0][0][0]
        second = sb.table.return_value.insert.call_args_list[1][0][0]
        assert first["token"] != second["token"]

    @patch("app.routes.shares.get_supabase_for_user")
    @patch("app.routes.shares.get_media_source_urls_batch", return_value=_MEDIA_BATCH_OK)
    @patch("app.services.supabase_repo.get_ads_media_summary_by_names")
    def test_non_collision_error_propagates(self, get_rows, _batch, get_sb):
        get_rows.return_value = [
            {"ad_name": "Criativo A", "media_type": "video", "thumb_storage_path": ""},
            {"ad_name": "Criativo B", "media_type": "image", "thumb_storage_path": ""},
        ]
        get_sb.return_value = _fake_sb_insert([Exception("statement timeout")])

        with pytest.raises(Exception, match="statement timeout"):
            create_share(body=_valid_body(), api=MagicMock(), user=dict(_USER))


# ── get_share_public / revoke_share (endpoint, mocks) ────────────────────────

def _fake_sb_public(row):
    sb = MagicMock()
    sb.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value = MagicMock(
        data=[row] if row else []
    )
    return sb


_PUBLIC_ROW = {
    "id": "uuid-1",
    "user_id": "user-1",
    "token": "tok_" + "x" * 28,
    "view_count": 5,
    "items": [{"ad_name": "A", "media": {}, "metrics": {}}],
    "date_start": "2026-07-01",
    "date_stop": "2026-07-20",
    "currency": "BRL",
    "created_at": "2026-07-25T00:00:00+00:00",
    "expires_at": _future_iso(),
    "revoked_at": None,
}


class TestGetSharePublic:
    @patch("app.routes.shares.get_supabase_service")
    def test_happy_path_sanitized_and_counted(self, get_sb):
        sb = _fake_sb_public(dict(_PUBLIC_ROW))
        get_sb.return_value = sb

        payload = get_share_public(_PUBLIC_ROW["token"])

        assert payload["items"] == _PUBLIC_ROW["items"]
        assert "user_id" not in payload and "token" not in payload
        counted = sb.table.return_value.update.call_args[0][0]
        assert counted == {"view_count": 6}

    @patch("app.routes.shares.get_supabase_service")
    def test_not_found_404(self, get_sb):
        get_sb.return_value = _fake_sb_public(None)
        with pytest.raises(HTTPException) as exc:
            get_share_public("tok_" + "x" * 28)
        assert exc.value.status_code == 404

    @patch("app.routes.shares.get_supabase_service")
    def test_revoked_404(self, get_sb):
        get_sb.return_value = _fake_sb_public({**_PUBLIC_ROW, "revoked_at": _past_iso()})
        with pytest.raises(HTTPException) as exc:
            get_share_public(_PUBLIC_ROW["token"])
        assert exc.value.status_code == 404

    @patch("app.routes.shares.get_supabase_service")
    def test_expired_404(self, get_sb):
        get_sb.return_value = _fake_sb_public({**_PUBLIC_ROW, "expires_at": _past_iso()})
        with pytest.raises(HTTPException) as exc:
            get_share_public(_PUBLIC_ROW["token"])
        assert exc.value.status_code == 404

    def test_malformed_token_404_without_db(self):
        with pytest.raises(HTTPException) as exc:
            get_share_public("abc")
        assert exc.value.status_code == 404

    @patch("app.routes.shares.get_supabase_service")
    def test_view_count_failure_is_best_effort(self, get_sb):
        sb = _fake_sb_public(dict(_PUBLIC_ROW))
        sb.table.return_value.update.return_value.eq.return_value.execute.side_effect = Exception("boom")
        get_sb.return_value = sb

        payload = get_share_public(_PUBLIC_ROW["token"])  # não levanta
        assert payload["currency"] == "BRL"


class TestRevokeShare:
    @patch("app.routes.shares.get_supabase_for_user")
    def test_revoke_marks_timestamp(self, get_sb):
        sb = MagicMock()
        sb.table.return_value.update.return_value.eq.return_value.eq.return_value.execute.return_value = MagicMock(
            data=[{"id": "uuid-1"}]
        )
        get_sb.return_value = sb

        assert revoke_share("uuid-1", user=dict(_USER)) == {"ok": True}
        updated = sb.table.return_value.update.call_args[0][0]
        assert "revoked_at" in updated

    @patch("app.routes.shares.get_supabase_for_user")
    def test_revoke_not_found_404(self, get_sb):
        sb = MagicMock()
        sb.table.return_value.update.return_value.eq.return_value.eq.return_value.execute.return_value = MagicMock(data=[])
        get_sb.return_value = sb

        with pytest.raises(HTTPException) as exc:
            revoke_share("uuid-x", user=dict(_USER))
        assert exc.value.status_code == 404
