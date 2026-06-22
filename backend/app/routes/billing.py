from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, Literal

import stripe
from fastapi import APIRouter, Depends, HTTPException, Request
from postgrest.exceptions import APIError
from pydantic import BaseModel

from app.core.auth import get_current_user
from app.core.config import (
    FRONTEND_BASE_URL,
    STRIPE_PRICE_INSIDER_ANNUAL,
    STRIPE_PRICE_INSIDER_MONTHLY,
    STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET,
)
from app.core.supabase_client import get_supabase_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/billing", tags=["billing"])

stripe.api_key = STRIPE_SECRET_KEY

PlanType = Literal["monthly", "annual"]

# Tier states that constitute an active/paid subscription
_ACTIVE_STATUSES = {"active", "trialing", "past_due"}


# ── Stripe API compatibility helpers ─────────────────────────────────────────
# The "basil" Stripe API (2025+) moved several fields. These helpers read both
# locations so the code works regardless of the API version on the dashboard.


def _invoice_subscription_id(invoice: dict) -> str:
    """Return subscription id from an invoice object (basil-proof)."""
    sid = invoice.get("subscription") or ""
    if not sid:
        # basil API: invoice.parent.subscription_details.subscription
        parent = invoice.get("parent") or {}
        sid = (parent.get("subscription_details") or {}).get("subscription") or ""
    return sid


def _subscription_period_end(sub: dict) -> int | None:
    """Return current_period_end from a subscription object (basil-proof).

    Never returns a value that would justify writing expires_at=None — callers
    should omit expires_at from the update dict when this returns None.
    """
    ts = sub.get("current_period_end")
    if ts:
        return ts
    # basil API: items.data[].current_period_end
    items_data = (sub.get("items") or {}).get("data") or []
    ends = [item.get("current_period_end") for item in items_data if item.get("current_period_end")]
    return max(ends) if ends else None


def _unix_to_iso(ts: int | float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()


# ── Customer helpers ──────────────────────────────────────────────────────────


def _get_or_create_stripe_customer(user_id: str, user_email: str | None) -> str:
    """Return existing stripe_customer_id or create one and persist it."""
    sb = get_supabase_service()
    result = (
        sb.table("subscriptions")
        .select("stripe_customer_id")
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    row = result.data[0] if result.data else None
    if row and row.get("stripe_customer_id"):
        return row["stripe_customer_id"]

    # idempotency_key prevents duplicate customers on concurrent calls
    customer = stripe.Customer.create(
        email=user_email,
        metadata={"user_id": user_id},
        idempotency_key=f"customer-create-{user_id}",
    )
    # Upsert in case the subscription row doesn't exist yet (pre-068 user who
    # hits checkout before migration 084 backfill runs)
    sb.table("subscriptions").upsert(
        {"user_id": user_id, "stripe_customer_id": customer.id},
        on_conflict="user_id",
    ).execute()
    return customer.id


# ── POST /billing/checkout-session ───────────────────────────────────────────


class CheckoutSessionRequest(BaseModel):
    plan: PlanType


@router.post("/checkout-session")
async def create_checkout_session(
    body: CheckoutSessionRequest,
    current_user: Dict[str, Any] = Depends(get_current_user),
):
    user_id: str = current_user["user_id"]
    user_email: str | None = current_user.get("claims", {}).get("email")

    if not STRIPE_SECRET_KEY:
        raise HTTPException(status_code=503, detail="Stripe not configured")

    price_id = _price_id_for_plan(body.plan)

    try:
        customer_id = _get_or_create_stripe_customer(user_id, user_email)

        session_params: Dict[str, Any] = {
            "customer": customer_id,
            "mode": "subscription",
            "payment_method_types": ["card"],
            "line_items": [{"price": price_id, "quantity": 1}],
            "client_reference_id": user_id,
            "metadata": {"user_id": user_id, "plan": body.plan},
            "success_url": f"{FRONTEND_BASE_URL}/planos?checkout=success",
            "cancel_url": f"{FRONTEND_BASE_URL}/planos?checkout=cancel",
            "allow_promotion_codes": True,
        }

        if body.plan == "annual":
            session_params["payment_method_options"] = {
                "card": {"installments": {"enabled": True}}
            }

        session = stripe.checkout.Session.create(**session_params)
        return {"url": session.url}

    except stripe.StripeError as e:
        logger.error(f"[BILLING] Checkout session error for user={user_id}: {e}")
        raise HTTPException(status_code=502, detail="Failed to create checkout session") from e


def _price_id_for_plan(plan: PlanType) -> str:
    if plan == "monthly":
        if not STRIPE_PRICE_INSIDER_MONTHLY:
            raise HTTPException(status_code=503, detail="Monthly price not configured")
        return STRIPE_PRICE_INSIDER_MONTHLY
    if not STRIPE_PRICE_INSIDER_ANNUAL:
        raise HTTPException(status_code=503, detail="Annual price not configured")
    return STRIPE_PRICE_INSIDER_ANNUAL


# ── POST /billing/portal-session ─────────────────────────────────────────────


@router.post("/portal-session")
async def create_portal_session(
    current_user: Dict[str, Any] = Depends(get_current_user),
):
    user_id: str = current_user["user_id"]

    if not STRIPE_SECRET_KEY:
        raise HTTPException(status_code=503, detail="Stripe not configured")

    sb = get_supabase_service()
    result = (
        sb.table("subscriptions")
        .select("stripe_customer_id")
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    row = result.data[0] if result.data else None
    customer_id = row.get("stripe_customer_id") if row else None
    if not customer_id:
        raise HTTPException(status_code=404, detail="No Stripe customer found for this account")

    try:
        session = stripe.billing_portal.Session.create(
            customer=customer_id,
            return_url=f"{FRONTEND_BASE_URL}/planos",
        )
        return {"url": session.url}
    except stripe.StripeError as e:
        logger.error(f"[BILLING] Portal session error for user={user_id}: {e}")
        raise HTTPException(status_code=502, detail="Failed to create portal session") from e


# ── POST /billing/webhook ─────────────────────────────────────────────────────

EVENT_HANDLERS = {
    "checkout.session.completed": "_handle_checkout_completed",
    "customer.subscription.updated": "_handle_subscription_updated",
    "customer.subscription.deleted": "_handle_subscription_deleted",
    "invoice.payment_succeeded": "_handle_invoice_succeeded",
    "invoice.payment_failed": "_handle_invoice_failed",
    "invoice.payment_action_required": "_handle_invoice_action_required",
}


def _record_event(sb, event_id: str, event_type: str) -> str:
    """Insert event with status='processing'. Returns 'new', 'processing', or 'processed'.

    Only treats duplicate-key (23505) as already-seen. Any other insert error
    propagates so Stripe retries the delivery instead of silently losing it.
    """
    try:
        sb.table("stripe_events").insert(
            {"event_id": event_id, "type": event_type, "status": "processing"}
        ).execute()
        return "new"
    except APIError as e:
        if getattr(e, "code", None) == "23505":
            # Truly duplicate — fetch current status
            row = (
                sb.table("stripe_events")
                .select("status")
                .eq("event_id", event_id)
                .limit(1)
                .execute()
            )
            return (row.data[0].get("status") or "processed") if row.data else "processed"
        raise


def _mark_event_processed(sb, event_id: str) -> None:
    sb.table("stripe_events").update(
        {"status": "processed", "processed_at": datetime.now(tz=timezone.utc).isoformat()}
    ).eq("event_id", event_id).execute()


@router.post("/webhook")
async def stripe_webhook(request: Request):
    """Stripe sends events here. No JWT auth — verified by signature instead.

    Idempotency model: event is inserted as 'processing' before the handler
    runs; marked 'processed' only on success. If the handler raises, the event
    stays 'processing' and Stripe will retry — the retry finds 'processing'
    and re-runs the handler (handlers are idempotent via live Stripe retrieve).
    Concurrent duplicate delivery is benign for the same reason.
    """
    if not STRIPE_WEBHOOK_SECRET:
        raise HTTPException(status_code=503, detail="Webhook secret not configured")

    payload = await request.body()
    sig_header = request.headers.get("stripe-signature", "")

    try:
        event = stripe.Webhook.construct_event(payload, sig_header, STRIPE_WEBHOOK_SECRET)
    except stripe.errors.SignatureVerificationError:
        logger.warning("[BILLING] Webhook signature verification failed")
        raise HTTPException(status_code=400, detail="Invalid signature")
    except Exception as e:
        logger.error(f"[BILLING] Webhook construct_event failed: {e}")
        raise HTTPException(status_code=400, detail="Invalid payload")

    event_id: str = event["id"]
    event_type: str = event["type"]

    sb = get_supabase_service()
    record_status = _record_event(sb, event_id, event_type)

    if record_status == "processed":
        logger.info(f"[BILLING] Skipping already-processed event {event_id} ({event_type})")
        return {"received": True}

    # record_status is 'new' or 'processing' (retry) — run handler
    logger.info(f"[BILLING] Processing event {event_id} type={event_type}")

    handler_name = EVENT_HANDLERS.get(event_type)
    try:
        if handler_name:
            _HANDLER_FN_MAP[handler_name](sb, event["data"]["object"])
        else:
            logger.debug(f"[BILLING] Unhandled event type {event_type}, acking")
    except Exception as e:
        logger.error(f"[BILLING] Handler error for {event_id} ({event_type}): {e}", exc_info=True)
        # Do NOT mark processed — stay 'processing' so Stripe retries
        raise HTTPException(status_code=500, detail="Handler error") from e

    _mark_event_processed(sb, event_id)
    return {"received": True}


# ── Webhook handlers ──────────────────────────────────────────────────────────


def _find_user_by_subscription_id(sb, subscription_id: str) -> dict | None:
    row = (
        sb.table("subscriptions")
        .select("user_id, source, tier")
        .eq("stripe_subscription_id", subscription_id)
        .limit(1)
        .execute()
    )
    return row.data[0] if row.data else None


def _is_stripe_managed(row: dict | None) -> bool:
    """Only mutate rows that Stripe owns; don't clobber manual admin/promo grants."""
    return row is not None and row.get("source") in ("stripe", None, "")


def _handle_checkout_completed(sb, session: dict) -> None:
    user_id: str | None = session.get("client_reference_id") or (
        session.get("metadata") or {}
    ).get("user_id")
    if not user_id:
        logger.warning("[BILLING] checkout.session.completed missing user_id")
        return

    subscription_id: str = session.get("subscription", "")
    if not subscription_id:
        return

    # Fetch live subscription — guards against out-of-order deleted events
    sub = stripe.Subscription.retrieve(subscription_id)
    live_status = sub.get("status", "")
    period_end = _subscription_period_end(sub)
    price_id = ((sub.get("items") or {}).get("data") or [{}])[0].get("price", {}).get("id", "")

    # Read current tier to protect admin rows
    existing = (
        sb.table("subscriptions")
        .select("tier, source")
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    current_tier = (existing.data[0].get("tier") or "standard") if existing.data else "standard"

    payload: dict = {
        "source": "stripe",
        "stripe_subscription_id": subscription_id,
        "stripe_status": live_status,
        "plan_id": price_id,
        "cancel_at_period_end": sub.get("cancel_at_period_end", False),
    }
    if period_end:
        payload["expires_at"] = _unix_to_iso(period_end)

    # Grant insider only for active-ish status and never overwrite admin tier
    if live_status in _ACTIVE_STATUSES and current_tier != "admin":
        payload["tier"] = "insider"

    sb.table("subscriptions").upsert(
        {"user_id": user_id, **payload},
        on_conflict="user_id",
    ).execute()

    logger.info(
        f"[BILLING] checkout completed user={user_id} sub={subscription_id} "
        f"live_status={live_status} tier_granted={payload.get('tier', 'unchanged')}"
    )


def _handle_subscription_updated(sb, sub: dict) -> None:
    subscription_id: str = sub.get("id", "")
    row_info = _find_user_by_subscription_id(sb, subscription_id)
    if not row_info or not _is_stripe_managed(row_info):
        return

    period_end = _subscription_period_end(sub)
    update: dict = {
        "stripe_status": sub.get("status"),
        "cancel_at_period_end": sub.get("cancel_at_period_end", False),
    }
    if period_end:
        update["expires_at"] = _unix_to_iso(period_end)
    # Intentionally omitting expires_at when unknown — NULL means never-expire,
    # so writing None would silently grant permanent access.

    sb.table("subscriptions").update(update).eq(
        "stripe_subscription_id", subscription_id
    ).execute()

    logger.info(f"[BILLING] Updated subscription {subscription_id} status={sub.get('status')}")


def _handle_subscription_deleted(sb, sub: dict) -> None:
    subscription_id: str = sub.get("id", "")
    row_info = _find_user_by_subscription_id(sb, subscription_id)
    if not row_info or not _is_stripe_managed(row_info):
        return

    if row_info.get("tier") == "admin":
        logger.info(f"[BILLING] Skipping deleted handler for admin user sub={subscription_id}")
        return

    sb.table("subscriptions").update({
        "tier": "standard",
        "stripe_status": "canceled",
        "cancel_at_period_end": False,
    }).eq("stripe_subscription_id", subscription_id).execute()

    logger.info(f"[BILLING] Downgraded to standard for sub={subscription_id}")


def _handle_invoice_succeeded(sb, invoice: dict) -> None:
    subscription_id: str = _invoice_subscription_id(invoice)
    if not subscription_id:
        return
    row_info = _find_user_by_subscription_id(sb, subscription_id)
    if not row_info or not _is_stripe_managed(row_info):
        return

    # Fetch live subscription to refresh period_end and re-grant tier on recovery
    sub = stripe.Subscription.retrieve(subscription_id)
    live_status = sub.get("status", "")
    period_end = _subscription_period_end(sub)

    update: dict = {"stripe_status": live_status}
    if period_end:
        update["expires_at"] = _unix_to_iso(period_end)

    # Re-grant insider on payment recovery (past_due → active after retried charge)
    if live_status in {"active", "trialing"} and row_info.get("tier") != "admin":
        update["tier"] = "insider"

    sb.table("subscriptions").update(update).eq(
        "stripe_subscription_id", subscription_id
    ).execute()

    logger.info(f"[BILLING] Invoice paid, renewed sub={subscription_id} live_status={live_status}")


def _handle_invoice_failed(sb, invoice: dict) -> None:
    subscription_id: str = _invoice_subscription_id(invoice)
    if not subscription_id:
        return
    row_info = _find_user_by_subscription_id(sb, subscription_id)
    if not row_info or not _is_stripe_managed(row_info):
        return

    sb.table("subscriptions").update({
        "stripe_status": "past_due",
    }).eq("stripe_subscription_id", subscription_id).execute()

    logger.warning(f"[BILLING] Invoice failed, past_due sub={subscription_id}")


def _handle_invoice_action_required(sb, invoice: dict) -> None:
    """Fires when a recurring payment requires 3DS authentication (common with BR
    installments). Access is kept during the grace period; status flags that the
    user must act. The hosted_invoice_url lets the customer complete auth."""
    subscription_id: str = _invoice_subscription_id(invoice)
    if not subscription_id:
        return
    row_info = _find_user_by_subscription_id(sb, subscription_id)
    if not row_info or not _is_stripe_managed(row_info):
        return

    hosted_url: str = invoice.get("hosted_invoice_url", "")
    sb.table("subscriptions").update({
        "stripe_status": "requires_action",
    }).eq("stripe_subscription_id", subscription_id).execute()

    logger.warning(
        f"[BILLING] Payment requires action for sub={subscription_id} "
        f"— customer must authenticate at: {hosted_url}"
    )


# Late binding map so handler functions are defined before this dict
_HANDLER_FN_MAP = {
    "_handle_checkout_completed": _handle_checkout_completed,
    "_handle_subscription_updated": _handle_subscription_updated,
    "_handle_subscription_deleted": _handle_subscription_deleted,
    "_handle_invoice_succeeded": _handle_invoice_succeeded,
    "_handle_invoice_failed": _handle_invoice_failed,
    "_handle_invoice_action_required": _handle_invoice_action_required,
}
