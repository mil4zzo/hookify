from __future__ import annotations

import logging
from typing import Any, Dict, Literal

import stripe
from fastapi import APIRouter, Depends, HTTPException, Request
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


def _price_id_for_plan(plan: PlanType) -> str:
    if plan == "monthly":
        if not STRIPE_PRICE_INSIDER_MONTHLY:
            raise HTTPException(status_code=503, detail="Monthly price not configured")
        return STRIPE_PRICE_INSIDER_MONTHLY
    if not STRIPE_PRICE_INSIDER_ANNUAL:
        raise HTTPException(status_code=503, detail="Annual price not configured")
    return STRIPE_PRICE_INSIDER_ANNUAL


def _get_or_create_stripe_customer(user_id: str, user_email: str | None) -> str:
    """Return existing stripe_customer_id or create one and persist it."""
    sb = get_supabase_service()
    row = (
        sb.table("subscriptions")
        .select("stripe_customer_id")
        .eq("user_id", user_id)
        .single()
        .execute()
    )
    if row.data and row.data.get("stripe_customer_id"):
        return row.data["stripe_customer_id"]

    customer = stripe.Customer.create(
        email=user_email,
        metadata={"user_id": user_id},
    )
    sb.table("subscriptions").update({"stripe_customer_id": customer.id}).eq(
        "user_id", user_id
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
            "line_items": [{"price": price_id, "quantity": 1}],
            "client_reference_id": user_id,
            "metadata": {"user_id": user_id, "plan": body.plan},
            "success_url": f"{FRONTEND_BASE_URL}/planos?checkout=success",
            "cancel_url": f"{FRONTEND_BASE_URL}/planos?checkout=cancel",
            "allow_promotion_codes": True,
        }

        # Enable Brazilian card installments for annual plan
        if body.plan == "annual":
            session_params["payment_method_options"] = {
                "card": {"installments": {"enabled": True}}
            }

        session = stripe.checkout.Session.create(**session_params)
        return {"url": session.url}

    except stripe.StripeError as e:
        logger.error(f"[BILLING] Checkout session error for user={user_id}: {e}")
        raise HTTPException(status_code=502, detail="Failed to create checkout session") from e


# ── POST /billing/portal-session ─────────────────────────────────────────────


@router.post("/portal-session")
async def create_portal_session(
    current_user: Dict[str, Any] = Depends(get_current_user),
):
    user_id: str = current_user["user_id"]

    if not STRIPE_SECRET_KEY:
        raise HTTPException(status_code=503, detail="Stripe not configured")

    sb = get_supabase_service()
    row = (
        sb.table("subscriptions")
        .select("stripe_customer_id")
        .eq("user_id", user_id)
        .single()
        .execute()
    )
    customer_id = row.data.get("stripe_customer_id") if row.data else None
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


@router.post("/webhook")
async def stripe_webhook(request: Request):
    """Stripe sends events here. No JWT auth — verified by signature instead."""
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

    # Idempotency: skip if already processed
    sb = get_supabase_service()
    try:
        sb.table("stripe_events").insert(
            {"event_id": event_id, "type": event_type}
        ).execute()
    except Exception:
        # Duplicate key → already processed
        logger.info(f"[BILLING] Skipping duplicate event {event_id} ({event_type})")
        return {"received": True}

    logger.info(f"[BILLING] Processing event {event_id} type={event_type}")

    try:
        if event_type == "checkout.session.completed":
            _handle_checkout_completed(sb, event["data"]["object"])
        elif event_type == "customer.subscription.updated":
            _handle_subscription_updated(sb, event["data"]["object"])
        elif event_type == "customer.subscription.deleted":
            _handle_subscription_deleted(sb, event["data"]["object"])
        elif event_type == "invoice.payment_succeeded":
            _handle_invoice_succeeded(sb, event["data"]["object"])
        elif event_type == "invoice.payment_failed":
            _handle_invoice_failed(sb, event["data"]["object"])
    except Exception as e:
        logger.error(f"[BILLING] Handler error for {event_id} ({event_type}): {e}", exc_info=True)
        # Return 500 so Stripe retries
        raise HTTPException(status_code=500, detail="Handler error") from e

    return {"received": True}


# ── Webhook handlers ──────────────────────────────────────────────────────────


def _find_user_by_subscription_id(sb, subscription_id: str) -> str | None:
    row = (
        sb.table("subscriptions")
        .select("user_id, source")
        .eq("stripe_subscription_id", subscription_id)
        .execute()
    )
    if row.data:
        return row.data[0]
    return None


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

    # Fetch subscription to get period end
    sub = stripe.Subscription.retrieve(subscription_id)
    period_end = sub.get("current_period_end")
    price_id = (sub.get("items", {}).get("data") or [{}])[0].get("price", {}).get("id", "")
    expires_at = (
        f"{_unix_to_iso(period_end)}" if period_end else None
    )

    row = sb.table("subscriptions").select("source").eq("user_id", user_id).execute()
    existing = row.data[0] if row.data else None
    if not _is_stripe_managed(existing):
        logger.info(f"[BILLING] Skipping checkout grant: user={user_id} has source={existing and existing.get('source')}")
        return

    sb.table("subscriptions").update({
        "tier": "insider",
        "source": "stripe",
        "stripe_subscription_id": subscription_id,
        "stripe_status": sub.get("status"),
        "plan_id": price_id,
        "expires_at": expires_at,
        "cancel_at_period_end": sub.get("cancel_at_period_end", False),
    }).eq("user_id", user_id).execute()

    logger.info(f"[BILLING] Granted insider to user={user_id} sub={subscription_id}")


def _handle_subscription_updated(sb, sub: dict) -> None:
    subscription_id: str = sub.get("id", "")
    row_info = _find_user_by_subscription_id(sb, subscription_id)
    if not row_info or not _is_stripe_managed(row_info):
        return

    period_end = sub.get("current_period_end")
    sb.table("subscriptions").update({
        "stripe_status": sub.get("status"),
        "expires_at": _unix_to_iso(period_end) if period_end else None,
        "cancel_at_period_end": sub.get("cancel_at_period_end", False),
    }).eq("stripe_subscription_id", subscription_id).execute()

    logger.info(f"[BILLING] Updated subscription {subscription_id} status={sub.get('status')}")


def _handle_subscription_deleted(sb, sub: dict) -> None:
    subscription_id: str = sub.get("id", "")
    row_info = _find_user_by_subscription_id(sb, subscription_id)
    if not row_info or not _is_stripe_managed(row_info):
        return

    sb.table("subscriptions").update({
        "tier": "standard",
        "stripe_status": "canceled",
        "cancel_at_period_end": False,
    }).eq("stripe_subscription_id", subscription_id).execute()

    logger.info(f"[BILLING] Downgraded to standard for sub={subscription_id}")


def _handle_invoice_succeeded(sb, invoice: dict) -> None:
    subscription_id: str = invoice.get("subscription", "")
    if not subscription_id:
        return
    row_info = _find_user_by_subscription_id(sb, subscription_id)
    if not row_info or not _is_stripe_managed(row_info):
        return

    # Refresh period end from the subscription object
    sub = stripe.Subscription.retrieve(subscription_id)
    period_end = sub.get("current_period_end")
    if period_end:
        sb.table("subscriptions").update({
            "expires_at": _unix_to_iso(period_end),
            "stripe_status": sub.get("status"),
        }).eq("stripe_subscription_id", subscription_id).execute()

    logger.info(f"[BILLING] Invoice paid, renewed sub={subscription_id}")


def _handle_invoice_failed(sb, invoice: dict) -> None:
    subscription_id: str = invoice.get("subscription", "")
    if not subscription_id:
        return
    row_info = _find_user_by_subscription_id(sb, subscription_id)
    if not row_info or not _is_stripe_managed(row_info):
        return

    sb.table("subscriptions").update({
        "stripe_status": "past_due",
    }).eq("stripe_subscription_id", subscription_id).execute()

    logger.warning(f"[BILLING] Invoice failed, past_due sub={subscription_id}")


def _unix_to_iso(ts: int | float) -> str:
    from datetime import datetime, timezone
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
