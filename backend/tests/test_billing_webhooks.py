"""
Tests for backend/app/routes/billing.py webhook handlers.

Covers P0 regression, idempotency, basil API compatibility, admin protection,
and payment recovery. Uses pure unittest mocks — no server started.
"""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from postgrest.exceptions import APIError

from app.routes.billing import (
    _handle_checkout_completed,
    _handle_invoice_action_required,
    _handle_invoice_succeeded,
    _handle_subscription_deleted,
    _invoice_subscription_id,
    _mark_event_processed,
    _record_event,
    _subscription_period_end,
)


# ── Fake Supabase builder ─────────────────────────────────────────────────────

class _FakeQuery:
    """Chainable fake for sb.table(...).select(...).eq(...).limit(...).execute()"""

    def __init__(self, rows=None):
        self._rows = rows or []
        self._updates = []

    def select(self, *a, **kw): return self
    def eq(self, *a, **kw): return self
    def limit(self, *a, **kw): return self
    def upsert(self, payload, **kw):
        self._updates.append(("upsert", payload))
        return self
    def update(self, payload):
        self._updates.append(("update", payload))
        return self
    def insert(self, payload):
        self._updates.append(("insert", payload))
        return self
    def execute(self):
        return MagicMock(data=self._rows)


def _make_sb(sub_rows=None, event_insert_raises=None):
    """Build a minimal fake sb where table() returns the same _FakeQuery."""
    q = _FakeQuery(sub_rows or [])
    if event_insert_raises:
        event_q = MagicMock()
        event_q.insert.return_value = event_q
        event_q.execute.side_effect = event_insert_raises
        event_q.select.return_value = event_q
        event_q.eq.return_value = event_q
        event_q.limit.return_value = event_q
        event_q.update.return_value = event_q
    else:
        event_q = _FakeQuery()

    def _table(name):
        if name == "stripe_events":
            return event_q
        return q

    sb = MagicMock()
    sb.table.side_effect = _table
    sb._sub_q = q
    sb._event_q = event_q
    return sb


# ── _invoice_subscription_id helper ─────────────────────────────────────────

class TestInvoiceSubscriptionId:
    def test_legacy_field(self):
        assert _invoice_subscription_id({"subscription": "sub_123"}) == "sub_123"

    def test_basil_field(self):
        invoice = {
            "parent": {
                "subscription_details": {"subscription": "sub_basil"}
            }
        }
        assert _invoice_subscription_id(invoice) == "sub_basil"

    def test_missing_returns_empty(self):
        assert _invoice_subscription_id({}) == ""


# ── _subscription_period_end helper ─────────────────────────────────────────

class TestSubscriptionPeriodEnd:
    def test_top_level_field(self):
        assert _subscription_period_end({"current_period_end": 9999}) == 9999

    def test_basil_items_field(self):
        sub = {"items": {"data": [{"current_period_end": 8888}]}}
        assert _subscription_period_end(sub) == 8888

    def test_basil_picks_max(self):
        sub = {"items": {"data": [{"current_period_end": 1000}, {"current_period_end": 2000}]}}
        assert _subscription_period_end(sub) == 2000

    def test_missing_returns_none(self):
        assert _subscription_period_end({}) is None


# ── _handle_checkout_completed ────────────────────────────────────────────────

def _make_live_sub(status="active", period_end=9_999_999_999):
    sub = MagicMock()
    sub.get.side_effect = lambda k, default=None: {
        "status": status,
        "current_period_end": period_end,
        "items": {"data": [{"price": {"id": "price_monthly"}}]},
        "cancel_at_period_end": False,
    }.get(k, default)
    return sub


class TestCheckoutCompleted:
    SESSION = {
        "client_reference_id": "user-abc",
        "subscription": "sub_xyz",
        "metadata": {},
    }

    def test_p0_regression_manual_source_gets_insider(self):
        """P0: row with source='manual' must receive the insider grant."""
        sb = _make_sb(sub_rows=[{"tier": "standard", "source": "manual"}])
        live_sub = _make_live_sub("active")

        with patch("app.routes.billing.stripe.Subscription.retrieve", return_value=live_sub):
            _handle_checkout_completed(sb, self.SESSION)

        upsert_calls = [p for op, p in sb._sub_q._updates if op == "upsert"]
        assert upsert_calls, "upsert was not called"
        payload = upsert_calls[0]
        assert payload.get("tier") == "insider"
        assert payload.get("source") == "stripe"
        assert payload.get("stripe_subscription_id") == "sub_xyz"

    def test_admin_tier_preserved_on_checkout(self):
        """checkout.session.completed must NOT overwrite admin tier."""
        sb = _make_sb(sub_rows=[{"tier": "admin", "source": "manual"}])
        live_sub = _make_live_sub("active")

        with patch("app.routes.billing.stripe.Subscription.retrieve", return_value=live_sub):
            _handle_checkout_completed(sb, self.SESSION)

        upsert_calls = [p for op, p in sb._sub_q._updates if op == "upsert"]
        # stripe fields should still be written, but tier must not be 'insider'
        assert upsert_calls, "upsert was not called — stripe fields should still be persisted"
        payload = upsert_calls[0]
        assert "tier" not in payload or payload.get("tier") != "insider", \
            "admin tier must not be overwritten with insider"

    def test_canceled_sub_does_not_grant(self):
        """If Stripe subscription is already canceled, no tier grant."""
        sb = _make_sb(sub_rows=[{"tier": "standard", "source": "manual"}])
        live_sub = _make_live_sub("canceled", period_end=None)

        with patch("app.routes.billing.stripe.Subscription.retrieve", return_value=live_sub):
            _handle_checkout_completed(sb, self.SESSION)

        upsert_calls = [p for op, p in sb._sub_q._updates if op == "upsert"]
        for payload in upsert_calls:
            assert payload.get("tier") != "insider", "canceled sub must not grant insider"

    def test_missing_period_end_does_not_write_expires_at(self):
        """When period_end is absent (basil edge case), expires_at must not be written."""
        sub_with_no_end = MagicMock()
        sub_with_no_end.get.side_effect = lambda k, default=None: {
            "status": "active",
            "current_period_end": None,
            "items": {"data": []},
            "cancel_at_period_end": False,
        }.get(k, default)

        sb = _make_sb(sub_rows=[{"tier": "standard", "source": "manual"}])
        with patch("app.routes.billing.stripe.Subscription.retrieve", return_value=sub_with_no_end):
            _handle_checkout_completed(sb, self.SESSION)

        upsert_calls = [p for op, p in sb._sub_q._updates if op == "upsert"]
        for payload in upsert_calls:
            assert "expires_at" not in payload, "expires_at must not be set when period_end is unknown"


# ── _handle_subscription_deleted ─────────────────────────────────────────────

class TestSubscriptionDeleted:
    SUB = {"id": "sub_del"}

    def test_insider_downgraded_to_standard(self):
        sb = _make_sb(sub_rows=[{"user_id": "u1", "source": "stripe", "tier": "insider"}])

        _handle_subscription_deleted(sb, self.SUB)

        update_calls = [p for op, p in sb._sub_q._updates if op == "update"]
        assert any(p.get("tier") == "standard" for p in update_calls)

    def test_admin_not_downgraded(self):
        sb = _make_sb(sub_rows=[{"user_id": "u1", "source": "stripe", "tier": "admin"}])

        _handle_subscription_deleted(sb, self.SUB)

        update_calls = [p for op, p in sb._sub_q._updates if op == "update"]
        assert not any(p.get("tier") == "standard" for p in update_calls), \
            "admin tier must not be downgraded by subscription.deleted"


# ── _handle_invoice_succeeded ─────────────────────────────────────────────────

class TestInvoiceSucceeded:
    INVOICE = {"subscription": "sub_recover"}

    def test_re_grants_insider_on_recovery(self):
        """Payment recovery (past_due → active) must re-grant insider."""
        sb = _make_sb(sub_rows=[{"user_id": "u1", "source": "stripe", "tier": "standard"}])
        live_sub = _make_live_sub("active")

        with patch("app.routes.billing.stripe.Subscription.retrieve", return_value=live_sub):
            _handle_invoice_succeeded(sb, self.INVOICE)

        update_calls = [p for op, p in sb._sub_q._updates if op == "update"]
        assert any(p.get("tier") == "insider" for p in update_calls), \
            "invoice.payment_succeeded must re-grant insider on recovery"

    def test_no_regrant_for_canceled_sub(self):
        """Canceled sub (failed retry after cancellation) must not re-grant."""
        sb = _make_sb(sub_rows=[{"user_id": "u1", "source": "stripe", "tier": "standard"}])
        live_sub = _make_live_sub("canceled")

        with patch("app.routes.billing.stripe.Subscription.retrieve", return_value=live_sub):
            _handle_invoice_succeeded(sb, self.INVOICE)

        update_calls = [p for op, p in sb._sub_q._updates if op == "update"]
        assert not any(p.get("tier") == "insider" for p in update_calls)


# ── _handle_invoice_action_required ─────────────────────────────────────────

class TestInvoiceActionRequired:
    def test_sets_requires_action_status(self):
        sb = _make_sb(sub_rows=[{"user_id": "u1", "source": "stripe", "tier": "insider"}])
        invoice = {"subscription": "sub_action", "hosted_invoice_url": "https://stripe.com/pay"}

        _handle_invoice_action_required(sb, invoice)

        update_calls = [p for op, p in sb._sub_q._updates if op == "update"]
        assert any(p.get("stripe_status") == "requires_action" for p in update_calls)


# ── Idempotency (_record_event) ───────────────────────────────────────────────

def _make_api_error(code: str) -> APIError:
    return APIError({"code": code, "message": "error", "details": None, "hint": None})


class TestRecordEvent:
    def test_new_event_returns_new(self):
        sb = _make_sb()
        result = _record_event(sb, "evt_1", "checkout.session.completed")
        assert result == "new"

    def test_duplicate_key_returns_processed_status(self):
        dup_error = _make_api_error("23505")

        event_q = MagicMock()
        event_q.insert.return_value = event_q
        event_q.select.return_value = event_q
        event_q.eq.return_value = event_q
        event_q.limit.return_value = event_q

        # First execute() call (insert) raises dup error; second (select) returns row
        call_count = [0]
        def _execute_side_effect():
            call_count[0] += 1
            if call_count[0] == 1:
                raise dup_error
            return MagicMock(data=[{"status": "processed"}])
        event_q.execute.side_effect = _execute_side_effect

        sb = MagicMock()
        sb.table.return_value = event_q

        result = _record_event(sb, "evt_dup", "checkout.session.completed")
        assert result == "processed"

    def test_non_23505_error_propagates(self):
        """Network errors must propagate so Stripe retries (not silently swallowed)."""
        network_error = _make_api_error("connection_error")

        event_q = MagicMock()
        event_q.insert.return_value = event_q
        event_q.execute.side_effect = network_error

        sb = MagicMock()
        sb.table.return_value = event_q

        with pytest.raises(APIError):
            _record_event(sb, "evt_net", "checkout.session.completed")
