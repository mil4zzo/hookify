"""
Tests for backend/app/core/tier.py

Covers get_effective_tier logic and require_min_tier FastAPI dependency.
Follows the existing pattern: unittest, fakes, no conftest.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.core.tier import GRACE_PERIOD_DAYS, get_effective_tier, require_min_tier


# ── get_effective_tier ────────────────────────────────────────────────────────

NOW = datetime(2026, 6, 12, 12, 0, 0, tzinfo=timezone.utc)


def _row(tier: str, expires_at: str | None) -> dict:
    return {"tier": tier, "expires_at": expires_at}


class TestGetEffectiveTier:
    def test_none_row_returns_standard(self):
        assert get_effective_tier(None, now=NOW) == "standard"

    def test_null_expires_at_returns_tier(self):
        assert get_effective_tier(_row("insider", None), now=NOW) == "insider"

    def test_future_expiry_returns_tier(self):
        future = (NOW + timedelta(days=30)).isoformat()
        assert get_effective_tier(_row("insider", future), now=NOW) == "insider"

    def test_within_grace_period_returns_tier(self):
        # Expired 6 days ago — still within 7-day grace
        expired = (NOW - timedelta(days=6)).isoformat()
        assert get_effective_tier(_row("insider", expired), now=NOW) == "insider"

    def test_exactly_at_grace_boundary_returns_tier(self):
        # Expired exactly GRACE_PERIOD_DAYS ago — boundary is inclusive
        expired = (NOW - timedelta(days=GRACE_PERIOD_DAYS)).isoformat()
        assert get_effective_tier(_row("insider", expired), now=NOW) == "insider"

    def test_past_grace_period_returns_standard(self):
        # Expired 8 days ago — past 7-day grace
        expired = (NOW - timedelta(days=8)).isoformat()
        assert get_effective_tier(_row("insider", expired), now=NOW) == "standard"

    def test_z_suffix_normalized(self):
        future = NOW.strftime("%Y-%m-%dT%H:%M:%SZ")
        # Not expired yet — same moment as NOW
        result = get_effective_tier(_row("insider", future), now=NOW)
        assert result == "insider"

    def test_plus00_suffix_normalized(self):
        future = (NOW + timedelta(days=1)).isoformat()  # already has +00:00
        assert get_effective_tier(_row("admin", future), now=NOW) == "admin"

    def test_admin_tier_no_expiry(self):
        assert get_effective_tier(_row("admin", None), now=NOW) == "admin"


# ── require_min_tier ─────────────────────────────────────────────────────────

def _make_sb_with_row(tier: str | None, expires_at: str | None) -> MagicMock:
    """Return a fake supabase client whose subscriptions query returns one row."""
    row = {"tier": tier, "expires_at": expires_at} if tier is not None else None
    sb = MagicMock()
    query = MagicMock()
    query.execute.return_value = MagicMock(data=[row] if row else [])
    sb.table.return_value.select.return_value.eq.return_value.limit.return_value = query
    return sb


class TestRequireMinTier:
    """Run the async dependency synchronously via asyncio."""

    def _run(self, coro):
        import asyncio
        return asyncio.get_event_loop().run_until_complete(coro)

    def test_insider_user_passes_insider_gate(self):
        future = (NOW + timedelta(days=30)).isoformat()
        sb = _make_sb_with_row("insider", future)
        dep = require_min_tier("insider")
        user = {"user_id": "u1"}

        with patch("app.core.tier.get_current_user", return_value=user), \
             patch("app.core.tier.get_supabase_service", return_value=sb):
            result = self._run(dep(current_user=user))
        assert result == user

    def test_standard_user_blocked_by_insider_gate(self):
        from fastapi import HTTPException
        future = (NOW + timedelta(days=30)).isoformat()
        sb = _make_sb_with_row("standard", None)
        dep = require_min_tier("insider")
        user = {"user_id": "u2"}

        with patch("app.core.tier.get_current_user", return_value=user), \
             patch("app.core.tier.get_supabase_service", return_value=sb):
            with pytest.raises(HTTPException) as exc_info:
                self._run(dep(current_user=user))
        assert exc_info.value.status_code == 403

    def test_no_subscription_row_returns_403(self):
        from fastapi import HTTPException
        sb = _make_sb_with_row(None, None)
        dep = require_min_tier("insider")
        user = {"user_id": "u3"}

        with patch("app.core.tier.get_current_user", return_value=user), \
             patch("app.core.tier.get_supabase_service", return_value=sb):
            with pytest.raises(HTTPException) as exc_info:
                self._run(dep(current_user=user))
        assert exc_info.value.status_code == 403

    def test_db_error_fails_open_for_insider_gate(self):
        """DB error should not lock out a paying insider user."""
        sb = MagicMock()
        sb.table.side_effect = Exception("connection timeout")
        dep = require_min_tier("insider")
        user = {"user_id": "u4"}

        with patch("app.core.tier.get_current_user", return_value=user), \
             patch("app.core.tier.get_supabase_service", return_value=sb):
            result = self._run(dep(current_user=user))
        assert result == user

    def test_db_error_fails_closed_for_admin_gate(self):
        """DB error for admin gate should return 503."""
        from fastapi import HTTPException
        sb = MagicMock()
        sb.table.side_effect = Exception("timeout")
        dep = require_min_tier("admin")
        user = {"user_id": "u5"}

        with patch("app.core.tier.get_current_user", return_value=user), \
             patch("app.core.tier.get_supabase_service", return_value=sb):
            with pytest.raises(HTTPException) as exc_info:
                self._run(dep(current_user=user))
        assert exc_info.value.status_code == 503

    def test_expired_past_grace_is_blocked(self):
        from fastapi import HTTPException
        expired = (NOW - timedelta(days=8)).isoformat()
        sb = _make_sb_with_row("insider", expired)
        dep = require_min_tier("insider")
        user = {"user_id": "u6"}

        with patch("app.core.tier.get_current_user", return_value=user), \
             patch("app.core.tier.get_supabase_service", return_value=sb):
            with pytest.raises(HTTPException) as exc_info:
                self._run(dep(current_user=user))
        assert exc_info.value.status_code == 403
