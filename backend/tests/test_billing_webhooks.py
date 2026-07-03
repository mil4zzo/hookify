"""
Tests for backend/app/routes/billing.py webhook handlers.

Covers P0 regression, idempotency, basil API compatibility, admin protection,
and payment recovery. Uses pure unittest mocks — no server started.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest
import stripe
from postgrest.exceptions import APIError

from app.routes.billing import (
    PREPAID_ANNUAL_DAYS,
    _find_blocking_subscription,
    _grant_prepaid_access,
    _handle_checkout_completed,
    _handle_invoice_action_required,
    _handle_invoice_failed,
    _handle_invoice_succeeded,
    _handle_subscription_deleted,
    _handle_subscription_updated,
    _invoice_subscription_id,
    _mark_event_processed,
    _record_event,
    _subscription_period_end,
    _subscription_price_id,
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


# ── _subscription_price_id helper ────────────────────────────────────────────

class TestSubscriptionPriceId:
    def test_reads_first_item_price(self):
        sub = {"items": {"data": [{"price": {"id": "price_1"}}]}}
        assert _subscription_price_id(sub) == "price_1"

    def test_none_price_is_safe(self):
        sub = {"items": {"data": [{"price": None}]}}
        assert _subscription_price_id(sub) == ""

    def test_missing_items_is_safe(self):
        assert _subscription_price_id({}) == ""


# ── _handle_invoice_failed ────────────────────────────────────────────────────

class TestInvoiceFailed:
    INVOICE = {"subscription": "sub_fail"}

    def test_writes_live_status_past_due(self):
        sb = _make_sb(sub_rows=[{"user_id": "u1", "source": "stripe", "tier": "insider"}])
        with patch(
            "app.routes.billing.stripe.Subscription.retrieve",
            return_value={"status": "past_due"},
        ):
            _handle_invoice_failed(sb, self.INVOICE)
        update_calls = [p for op, p in sb._sub_q._updates if op == "update"]
        assert any(p.get("stripe_status") == "past_due" for p in update_calls)

    def test_does_not_overwrite_canceled_with_past_due(self):
        """Out-of-order: payment_failed landing after subscription.deleted must
        keep 'canceled', otherwise the UI offers the portal instead of checkout."""
        sb = _make_sb(sub_rows=[{"user_id": "u1", "source": "stripe", "tier": "standard"}])
        with patch(
            "app.routes.billing.stripe.Subscription.retrieve",
            return_value={"status": "canceled"},
        ):
            _handle_invoice_failed(sb, self.INVOICE)
        update_calls = [p for op, p in sb._sub_q._updates if op == "update"]
        assert update_calls, "status update expected"
        assert all(p.get("stripe_status") == "canceled" for p in update_calls)

    def test_never_touches_expires_at(self):
        """A failed cycle must not extend paid-through access."""
        sb = _make_sb(sub_rows=[{"user_id": "u1", "source": "stripe", "tier": "insider"}])
        with patch(
            "app.routes.billing.stripe.Subscription.retrieve",
            return_value={"status": "past_due", "current_period_end": 9_999_999_999},
        ):
            _handle_invoice_failed(sb, self.INVOICE)
        update_calls = [p for op, p in sb._sub_q._updates if op == "update"]
        assert all("expires_at" not in p for p in update_calls)


# ── _handle_subscription_updated ─────────────────────────────────────────────

class TestSubscriptionUpdated:
    @staticmethod
    def _event_sub(status="active", price="price_new"):
        return {
            "id": "sub_upd",
            "status": status,
            "cancel_at_period_end": False,
            "current_period_end": 9_999_999_999,
            "items": {"data": [{"price": {"id": price}}]},
        }

    def test_syncs_plan_id_on_plan_switch(self):
        sb = _make_sb(sub_rows=[{"user_id": "u1", "source": "stripe", "tier": "insider"}])
        _handle_subscription_updated(sb, self._event_sub(price="price_annual"))
        update_calls = [p for op, p in sb._sub_q._updates if op == "update"]
        assert any(p.get("plan_id") == "price_annual" for p in update_calls)

    def test_self_heals_tier_when_live_active(self):
        """Row standard + event/live active → re-grant insider (covers a missed
        invoice.payment_succeeded)."""
        sb = _make_sb(sub_rows=[{"user_id": "u1", "source": "stripe", "tier": "standard"}])
        with patch(
            "app.routes.billing.stripe.Subscription.retrieve",
            return_value={"status": "active"},
        ):
            _handle_subscription_updated(sb, self._event_sub())
        update_calls = [p for op, p in sb._sub_q._updates if op == "update"]
        assert any(p.get("tier") == "insider" for p in update_calls)

    def test_no_heal_when_live_says_canceled(self):
        """Stale/out-of-order event: live status wins, no tier grant."""
        sb = _make_sb(sub_rows=[{"user_id": "u1", "source": "stripe", "tier": "standard"}])
        with patch(
            "app.routes.billing.stripe.Subscription.retrieve",
            return_value={"status": "canceled"},
        ):
            _handle_subscription_updated(sb, self._event_sub())
        update_calls = [p for op, p in sb._sub_q._updates if op == "update"]
        assert not any(p.get("tier") == "insider" for p in update_calls)

    def test_manual_source_row_untouched(self):
        sb = _make_sb(sub_rows=[{"user_id": "u1", "source": "manual", "tier": "insider"}])
        _handle_subscription_updated(sb, self._event_sub())
        update_calls = [p for op, p in sb._sub_q._updates if op == "update"]
        assert not update_calls, "manual grants must not be mutated by stripe webhooks"

    def test_active_extends_expires_at(self):
        sb = _make_sb(sub_rows=[{"user_id": "u1", "source": "stripe", "tier": "insider"}])
        _handle_subscription_updated(sb, self._event_sub(status="active"))
        update_calls = [p for op, p in sb._sub_q._updates if op == "update"]
        assert any("expires_at" in p for p in update_calls)

    def test_past_due_does_not_extend_expires_at(self):
        """Dunning guard: the period advances at cycle start regardless of
        payment — extending expires_at for past_due/unpaid would hand out the
        unpaid cycle for free."""
        sb = _make_sb(sub_rows=[{"user_id": "u1", "source": "stripe", "tier": "insider"}])
        _handle_subscription_updated(sb, self._event_sub(status="past_due"))
        update_calls = [p for op, p in sb._sub_q._updates if op == "update"]
        assert update_calls, "status update expected"
        assert all("expires_at" not in p for p in update_calls)

    def test_unpaid_does_not_extend_expires_at(self):
        sb = _make_sb(sub_rows=[{"user_id": "u1", "source": "stripe", "tier": "insider"}])
        _handle_subscription_updated(sb, self._event_sub(status="unpaid"))
        update_calls = [p for op, p in sb._sub_q._updates if op == "update"]
        assert all("expires_at" not in p for p in update_calls)


# ── _find_blocking_subscription (checkout duplicate guard) ───────────────────

class TestFindBlockingSubscription:
    def test_no_row_allows_checkout(self):
        sb = _make_sb(sub_rows=[])
        assert _find_blocking_subscription(sb, "u1") is None

    def test_canceled_local_status_allows_checkout(self):
        sb = _make_sb(sub_rows=[{"stripe_subscription_id": "sub_1", "stripe_status": "canceled"}])
        assert _find_blocking_subscription(sb, "u1") is None

    def test_live_active_blocks_checkout(self):
        """Double click / stale tab must not create a second live subscription."""
        sb = _make_sb(sub_rows=[{"stripe_subscription_id": "sub_1", "stripe_status": "active"}])
        with patch(
            "app.routes.billing.stripe.Subscription.retrieve",
            return_value={"status": "active"},
        ):
            assert _find_blocking_subscription(sb, "u1") == "active"

    def test_stale_local_status_heals_and_allows(self):
        """Local says active but Stripe says canceled (lost webhook) → heal + allow."""
        sb = _make_sb(sub_rows=[{"stripe_subscription_id": "sub_1", "stripe_status": "active"}])
        with patch(
            "app.routes.billing.stripe.Subscription.retrieve",
            return_value={"status": "canceled"},
        ):
            assert _find_blocking_subscription(sb, "u1") is None
        update_calls = [p for op, p in sb._sub_q._updates if op == "update"]
        assert any(p.get("stripe_status") == "canceled" for p in update_calls)

    def test_missing_subscription_on_stripe_heals_and_allows(self):
        sb = _make_sb(sub_rows=[{"stripe_subscription_id": "sub_gone", "stripe_status": "active"}])
        err = stripe.InvalidRequestError("No such subscription", None)
        with patch("app.routes.billing.stripe.Subscription.retrieve", side_effect=err):
            assert _find_blocking_subscription(sb, "u1") is None
        update_calls = [p for op, p in sb._sub_q._updates if op == "update"]
        assert any(p.get("stripe_status") == "canceled" for p in update_calls)


# ── Pix prepaid grant ────────────────────────────────────────────────────────

_PIX_CREATED = 1_750_000_000  # unix ts of the paid session


def _pix_session(payment_status="paid", created=_PIX_CREATED):
    return {
        "mode": "payment",
        "payment_status": payment_status,
        "created": created,
        "client_reference_id": "user-pix",
        "metadata": {"user_id": "user-pix", "plan": "annual_pix"},
    }


def _expected_pix_expiry(created=_PIX_CREATED) -> str:
    return (
        datetime.fromtimestamp(created, tz=timezone.utc) + timedelta(days=PREPAID_ANNUAL_DAYS)
    ).isoformat()


class TestPrepaidGrant:
    def test_paid_session_grants_one_year(self):
        sb = _make_sb(sub_rows=[{"tier": "standard", "expires_at": None}])
        payload = _grant_prepaid_access(sb, "user-pix", _pix_session())
        assert payload is not None
        assert payload.get("tier") == "insider"
        assert payload.get("expires_at") == _expected_pix_expiry()
        # no subscription behind this grant — stale sub pointers must be cleared
        assert payload.get("stripe_subscription_id") is None
        assert payload.get("stripe_status") is None

    def test_unpaid_session_is_skipped(self):
        """Pix pendente: grant only happens on async_payment_succeeded."""
        sb = _make_sb(sub_rows=[{"tier": "standard", "expires_at": None}])
        assert _grant_prepaid_access(sb, "user-pix", _pix_session(payment_status="unpaid")) is None
        assert not sb._sub_q._updates

    def test_idempotent_on_retry_and_keeps_later_expiry(self):
        """Expiry derives from session.created — retries recompute the same
        date, and an existing LATER expiry is never shortened."""
        later = (
            datetime.fromtimestamp(_PIX_CREATED, tz=timezone.utc)
            + timedelta(days=PREPAID_ANNUAL_DAYS + 30)
        ).isoformat()
        sb = _make_sb(sub_rows=[{"tier": "insider", "expires_at": later}])
        payload = _grant_prepaid_access(sb, "user-pix", _pix_session())
        assert payload is not None
        assert "expires_at" not in payload, "must not shorten a later existing expiry"

    def test_admin_tier_untouched(self):
        sb = _make_sb(sub_rows=[{"tier": "admin", "expires_at": None}])
        payload = _grant_prepaid_access(sb, "user-pix", _pix_session())
        assert payload is not None
        assert "tier" not in payload

    def test_checkout_completed_routes_payment_mode_to_grant(self):
        """mode=payment com plan=annual_pix concede sem tocar em Subscription.retrieve
        (não há subscription — retrieve explodiria se fosse chamado, pois não está mockado)."""
        sb = _make_sb(sub_rows=[{"tier": "standard", "expires_at": None}])
        _handle_checkout_completed(sb, _pix_session())
        upsert_calls = [p for op, p in sb._sub_q._updates if op == "upsert"]
        assert upsert_calls and upsert_calls[0].get("tier") == "insider"

    def test_checkout_completed_ignores_unknown_payment_mode(self):
        sb = _make_sb(sub_rows=[{"tier": "standard", "expires_at": None}])
        session = {**_pix_session(), "metadata": {"user_id": "user-pix"}}  # sem plan=annual_pix
        _handle_checkout_completed(sb, session)
        assert not sb._sub_q._updates


class TestFindBlockingPrepaid:
    def test_active_prepaid_blocks_checkout(self):
        future = (datetime.now(tz=timezone.utc) + timedelta(days=100)).isoformat()
        sb = _make_sb(sub_rows=[{
            "stripe_subscription_id": None, "stripe_status": None,
            "source": "stripe", "tier": "insider", "expires_at": future,
        }])
        assert _find_blocking_subscription(sb, "u1") == "prepaid"

    def test_expired_prepaid_allows_checkout(self):
        past = (datetime.now(tz=timezone.utc) - timedelta(days=1)).isoformat()
        sb = _make_sb(sub_rows=[{
            "stripe_subscription_id": None, "stripe_status": None,
            "source": "stripe", "tier": "insider", "expires_at": past,
        }])
        assert _find_blocking_subscription(sb, "u1") is None

    def test_manual_grant_does_not_block_checkout(self):
        future = (datetime.now(tz=timezone.utc) + timedelta(days=100)).isoformat()
        sb = _make_sb(sub_rows=[{
            "stripe_subscription_id": None, "stripe_status": None,
            "source": "manual", "tier": "insider", "expires_at": future,
        }])
        assert _find_blocking_subscription(sb, "u1") is None


# ── checkout persists stripe_customer_id ─────────────────────────────────────

class TestCheckoutCustomerId:
    def test_customer_id_persisted_from_session(self):
        sb = _make_sb(sub_rows=[{"tier": "standard", "source": "manual"}])
        session = {
            "client_reference_id": "user-abc",
            "subscription": "sub_xyz",
            "customer": "cus_123",
            "metadata": {},
        }
        with patch(
            "app.routes.billing.stripe.Subscription.retrieve",
            return_value=_make_live_sub("active"),
        ):
            _handle_checkout_completed(sb, session)
        upsert_calls = [p for op, p in sb._sub_q._updates if op == "upsert"]
        assert upsert_calls and upsert_calls[0].get("stripe_customer_id") == "cus_123"


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
