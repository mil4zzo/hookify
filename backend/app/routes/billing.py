from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Literal

import stripe
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from postgrest.exceptions import APIError
from pydantic import BaseModel

from app.core.auth import get_current_user
from app.core.config import (
    FRONTEND_BASE_URL,
    STRIPE_PIX_ANNUAL_AMOUNT_CENTS,
    STRIPE_PIX_ENABLED,
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


def _subscription_price_id(sub: dict) -> str:
    """Return the first item's price id ('' when absent). Null-safe: 'price'
    can be present-but-None on partial objects."""
    items_data = (sub.get("items") or {}).get("data") or [{}]
    return (((items_data[0] or {}).get("price") or {}).get("id")) or ""


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

# Local statuses that suggest a subscription we must not duplicate. Broad on
# purpose — a blocking-looking row is always confirmed live before rejecting.
_BLOCKING_LOCAL_STATUSES = {"active", "trialing", "past_due", "unpaid", "requires_action"}
# Live statuses that confirm the subscription still exists and bills (or is in
# dunning and can resume billing). 'incomplete' is excluded: it never billed
# and auto-expires within 24h.
_BLOCKING_LIVE_STATUSES = {"active", "trialing", "past_due", "unpaid"}


def _find_blocking_subscription(sb, user_id: str) -> str | None:
    """Return the live status of existing paid access that blocks a new
    checkout ('active', 'past_due', ..., or 'prepaid'), or None when allowed.

    Without this, a stale tab / double click / lost webhook lets a user create
    a second live subscription (or re-buy a prepaid year) and be double-charged.
    The local row can be stale, so subscriptions are confirmed against Stripe
    before rejecting — and healed when the live status shows they're over.
    """
    result = (
        sb.table("subscriptions")
        .select("stripe_subscription_id, stripe_status, tier, source, expires_at")
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    row = result.data[0] if result.data else None
    if not row:
        return None
    sub_id = row.get("stripe_subscription_id")
    local_status = row.get("stripe_status")

    if sub_id and local_status in _BLOCKING_LOCAL_STATUSES:
        live_status = None
        try:
            live_status = stripe.Subscription.retrieve(sub_id).get("status", "")
        except stripe.InvalidRequestError:
            pass  # subscription no longer exists on Stripe
        if live_status in _BLOCKING_LIVE_STATUSES:
            return live_status
        # Stale local status (lost webhook / gone sub) — heal so the UI offers
        # checkout again, then still consider prepaid access below
        sb.table("subscriptions").update({"stripe_status": live_status or "canceled"}).eq(
            "user_id", user_id
        ).execute()

    # One-time (Pix) prepaid access still running? Prepaid grants clear
    # stripe_subscription_id, so no-sub-id + stripe-sourced insider + future
    # expiry means a paid year in progress — buying again would double-pay.
    if row.get("source") == "stripe" and row.get("tier") == "insider" and row.get("expires_at"):
        try:
            expires = datetime.fromisoformat(row["expires_at"].replace("Z", "+00:00"))
            if expires > datetime.now(tz=timezone.utc):
                return "prepaid"
        except (ValueError, AttributeError):
            pass
    return None


class CheckoutSessionRequest(BaseModel):
    plan: PlanType
    payment_method: Literal["card", "pix"] = "card"


# Sync route (`def`, not `async def`): FastAPI runs it in a threadpool, so the
# blocking Stripe/Supabase calls don't stall the event loop for other requests.
@router.post("/checkout-session")
def create_checkout_session(
    body: CheckoutSessionRequest,
    current_user: Dict[str, Any] = Depends(get_current_user),
):
    user_id: str = current_user["user_id"]
    user_email: str | None = current_user.get("claims", {}).get("email")

    if not STRIPE_SECRET_KEY:
        raise HTTPException(status_code=503, detail="Stripe not configured")

    if body.payment_method == "pix":
        if not STRIPE_PIX_ENABLED:
            raise HTTPException(status_code=503, detail="pix_not_configured")
        if body.plan != "annual":
            raise HTTPException(status_code=400, detail="Pix is only available for the annual plan")
        price_id = None  # pix uses inline price_data (one-time payment)
    else:
        price_id = _price_id_for_plan(body.plan)

    try:
        blocking_status = _find_blocking_subscription(get_supabase_service(), user_id)
        if blocking_status:
            logger.info(
                f"[BILLING] Checkout blocked for user={user_id}: "
                f"existing subscription is {blocking_status}"
            )
            raise HTTPException(status_code=409, detail="already_subscribed")

        customer_id = _get_or_create_stripe_customer(user_id, user_email)

        session_params: Dict[str, Any] = {
            "customer": customer_id,
            "client_reference_id": user_id,
            "success_url": f"{FRONTEND_BASE_URL}/planos?checkout=success",
            "cancel_url": f"{FRONTEND_BASE_URL}/planos?checkout=cancel",
            # CPF/CNPJ na invoice; customer_update.name é exigência da Stripe
            # ao combinar tax_id_collection com customer existente
            "tax_id_collection": {"enabled": True},
            "customer_update": {"name": "auto"},
        }

        if body.payment_method == "pix":
            # Pagamento avulso de 12 meses — Pix não suporta recorrência.
            # O grant acontece no webhook (checkout.session.completed /
            # async_payment_succeeded) via _grant_prepaid_access.
            session_params.update({
                "mode": "payment",
                "payment_method_types": ["pix"],
                "line_items": [{
                    "price_data": {
                        "currency": "brl",
                        "unit_amount": STRIPE_PIX_ANNUAL_AMOUNT_CENTS,
                        "product_data": {
                            "name": "Hookify Insider — Anual (12 meses, sem renovação automática)",
                        },
                    },
                    "quantity": 1,
                }],
                "metadata": {"user_id": user_id, "plan": "annual_pix"},
                "payment_method_options": {"pix": {"expires_after_seconds": 3600}},
            })
        else:
            session_params.update({
                "mode": "subscription",
                "payment_method_types": ["card"],
                "line_items": [{"price": price_id, "quantity": 1}],
                "metadata": {"user_id": user_id, "plan": body.plan},
                "allow_promotion_codes": True,
            })
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
def create_portal_session(
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


# ── POST /billing/sync ────────────────────────────────────────────────────────

# Priority when picking which live subscription represents the account state
_SYNC_STATUS_PRIORITY = [
    "active", "trialing", "past_due", "unpaid", "incomplete", "canceled", "incomplete_expired",
]


@router.post("/sync")
def sync_subscription_state(
    current_user: Dict[str, Any] = Depends(get_current_user),
):
    """Reconcile the caller's subscription row against live Stripe state.

    Recovery path for lost/lagging webhooks: the frontend calls this when the
    user returns from a successful checkout instead of blind-polling until the
    webhook lands. Covers both subscriptions and one-time Pix purchases. Only
    ever touches the caller's own row; applies the same rules as the webhooks
    (never downgrades a tier, never touches admin).
    """
    user_id: str = current_user["user_id"]

    if not STRIPE_SECRET_KEY:
        raise HTTPException(status_code=503, detail="Stripe not configured")

    sb = get_supabase_service()
    result = (
        sb.table("subscriptions")
        .select("tier, source, stripe_customer_id")
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    row = result.data[0] if result.data else None
    customer_id = (row or {}).get("stripe_customer_id")
    current_tier = (row or {}).get("tier") or "standard"
    if not customer_id:
        return {"synced": False, "reason": "no_customer", "tier": current_tier}

    try:
        subs = stripe.Subscription.list(customer=customer_id, status="all", limit=10).data
    except stripe.StripeError as e:
        logger.error(f"[BILLING] Sync list error for user={user_id}: {e}")
        raise HTTPException(status_code=502, detail="Failed to reach Stripe") from e

    def _rank(s: dict) -> tuple:
        status = s.get("status", "")
        pri = (
            _SYNC_STATUS_PRIORITY.index(status)
            if status in _SYNC_STATUS_PRIORITY
            else len(_SYNC_STATUS_PRIORITY)
        )
        return (pri, -(s.get("created") or 0))

    best = min(subs, key=_rank) if subs else None
    live_status = best.get("status", "") if best else ""

    if best and live_status in _ACTIVE_STATUSES:
        payload = _apply_subscription_state(sb, user_id, best.get("id", ""), best)
        tier = payload.get("tier") or current_tier
        logger.info(
            f"[BILLING] Synced user={user_id} sub={best.get('id')} live_status={live_status}"
        )
        return {"synced": True, "stripe_status": live_status, "tier": tier}

    # No billing subscription — a paid one-time Pix checkout may still grant
    # access (recovers a lost checkout webhook for the prepaid annual plan).
    try:
        sessions = stripe.checkout.Session.list(customer=customer_id, limit=10).data
    except stripe.StripeError:
        sessions = []
    pix_paid = [
        s for s in sessions
        if s.get("mode") == "payment"
        and s.get("payment_status") == "paid"
        and (s.get("metadata") or {}).get("plan") == "annual_pix"
    ]
    if pix_paid:
        newest = max(pix_paid, key=lambda s: s.get("created") or 0)
        payload = _grant_prepaid_access(sb, user_id, newest) or {}
        tier = payload.get("tier") or current_tier
        logger.info(f"[BILLING] Synced prepaid pix access user={user_id}")
        return {"synced": True, "stripe_status": "prepaid", "tier": tier}

    if not subs:
        return {"synced": False, "reason": "no_subscriptions", "tier": current_tier}

    # Subscriptions exist but none bills — refresh status fields only on
    # stripe-managed rows; tier downgrades stay owned by webhooks + expiry.
    if _is_stripe_managed(row):
        sb.table("subscriptions").update({
            "stripe_status": live_status,
            "cancel_at_period_end": best.get("cancel_at_period_end", False),
        }).eq("user_id", user_id).execute()

    return {"synced": True, "stripe_status": live_status, "tier": current_tier}


# ── POST /billing/webhook ─────────────────────────────────────────────────────

EVENT_HANDLERS = {
    "checkout.session.completed": "_handle_checkout_completed",
    # Delayed payment methods (Pix pendente): completed chega unpaid e este
    # evento confirma depois — mesmo handler, que gate por payment_status
    "checkout.session.async_payment_succeeded": "_handle_checkout_completed",
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
    except stripe.SignatureVerificationError:
        logger.warning("[BILLING] Webhook signature verification failed")
        raise HTTPException(status_code=400, detail="Invalid signature")
    except Exception as e:
        logger.error(f"[BILLING] Webhook construct_event failed: {e}")
        raise HTTPException(status_code=400, detail="Invalid payload")

    event_id: str = event["id"]
    event_type: str = event["type"]

    sb = get_supabase_service()
    # Blocking DB/Stripe work runs in the threadpool so this async route
    # doesn't stall the event loop for other requests.
    record_status = await run_in_threadpool(_record_event, sb, event_id, event_type)

    if record_status == "processed":
        logger.info(f"[BILLING] Skipping already-processed event {event_id} ({event_type})")
        return {"received": True}

    # record_status is 'new' or 'processing' (retry) — run handler
    logger.info(f"[BILLING] Processing event {event_id} type={event_type}")

    handler_name = EVENT_HANDLERS.get(event_type)
    try:
        if handler_name:
            await run_in_threadpool(_HANDLER_FN_MAP[handler_name], sb, event["data"]["object"])
        else:
            logger.debug(f"[BILLING] Unhandled event type {event_type}, acking")
    except Exception as e:
        logger.error(f"[BILLING] Handler error for {event_id} ({event_type}): {e}", exc_info=True)
        # Do NOT mark processed — stay 'processing' so Stripe retries
        raise HTTPException(status_code=500, detail="Handler error") from e

    await run_in_threadpool(_mark_event_processed, sb, event_id)
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


def _apply_subscription_state(
    sb, user_id: str, subscription_id: str, sub: dict, customer_id: str | None = None
) -> dict:
    """Upsert the subscriptions row from a live Stripe subscription object.

    Shared by checkout.session.completed and POST /billing/sync. Grants insider
    only for active-ish live statuses and never overwrites the admin tier. Never
    downgrades here — expiry enforcement and subscription.deleted own that.
    Returns the written payload.
    """
    live_status = sub.get("status", "")
    period_end = _subscription_period_end(sub)

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
        "plan_id": _subscription_price_id(sub),
        "cancel_at_period_end": sub.get("cancel_at_period_end", False),
    }
    if customer_id:
        payload["stripe_customer_id"] = customer_id
    if period_end:
        payload["expires_at"] = _unix_to_iso(period_end)

    # Grant insider only for active-ish status and never overwrite admin tier
    if live_status in _ACTIVE_STATUSES and current_tier != "admin":
        payload["tier"] = "insider"

    sb.table("subscriptions").upsert(
        {"user_id": user_id, **payload},
        on_conflict="user_id",
    ).execute()
    return payload


# Prepaid (Pix) access length. Pix doesn't support recurring charges, so the
# annual plan via Pix is a one-time payment granting a fixed window.
PREPAID_ANNUAL_DAYS = 365


def _grant_prepaid_access(sb, user_id: str, session: dict) -> dict | None:
    """Grant 12 months of insider from a paid one-time (Pix) checkout session.

    Idempotent by construction: expiry derives from the session's `created`
    timestamp, so webhook retries and /billing/sync recompute the same absolute
    date instead of stacking. Never shortens a later existing expiry and never
    touches the admin tier. Returns the written payload (None when skipped).
    """
    if session.get("payment_status") != "paid":
        # Pix pendente — checkout.session.async_payment_succeeded re-runs this
        return None
    created = session.get("created")
    if not created:
        logger.warning(f"[BILLING] Prepaid session without created ts for user={user_id}")
        return None
    new_expiry = datetime.fromtimestamp(created, tz=timezone.utc) + timedelta(
        days=PREPAID_ANNUAL_DAYS
    )

    existing = (
        sb.table("subscriptions")
        .select("tier, expires_at")
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    row = existing.data[0] if existing.data else {}
    current_tier = row.get("tier") or "standard"

    keep_current_expiry = False
    current_raw = row.get("expires_at")
    if current_raw:
        try:
            current_expiry = datetime.fromisoformat(current_raw.replace("Z", "+00:00"))
            keep_current_expiry = current_expiry >= new_expiry
        except (ValueError, AttributeError):
            pass

    payload: dict = {
        "source": "stripe",
        "plan_id": "pix_annual",
        # No subscription behind this grant — clear stale sub pointers so old
        # subscription webhooks can't touch this row and the checkout guard
        # recognizes the prepaid state.
        "stripe_subscription_id": None,
        "stripe_status": None,
        "cancel_at_period_end": False,
    }
    if not keep_current_expiry:
        payload["expires_at"] = new_expiry.isoformat()
    if current_tier != "admin":
        payload["tier"] = "insider"

    sb.table("subscriptions").upsert(
        {"user_id": user_id, **payload},
        on_conflict="user_id",
    ).execute()
    logger.info(
        f"[BILLING] Prepaid pix grant user={user_id} expires_at={payload.get('expires_at', 'kept')}"
    )
    return payload


def _handle_checkout_completed(sb, session: dict) -> None:
    user_id: str | None = session.get("client_reference_id") or (
        session.get("metadata") or {}
    ).get("user_id")
    if not user_id:
        logger.warning("[BILLING] checkout.session.completed missing user_id")
        return

    # One-time payment (Pix anual) — no subscription to track
    if session.get("mode") == "payment":
        if (session.get("metadata") or {}).get("plan") == "annual_pix":
            _grant_prepaid_access(sb, user_id, session)
        return

    subscription_id: str = session.get("subscription", "")
    if not subscription_id:
        return

    # Fetch live subscription — guards against out-of-order deleted events
    sub = stripe.Subscription.retrieve(subscription_id)
    # Persist the customer id too (defense-in-depth: covers rows where the
    # pre-checkout persist was lost)
    customer_raw = session.get("customer")
    customer_id = customer_raw if isinstance(customer_raw, str) else None

    payload = _apply_subscription_state(sb, user_id, subscription_id, sub, customer_id)

    logger.info(
        f"[BILLING] checkout completed user={user_id} sub={subscription_id} "
        f"live_status={payload.get('stripe_status')} tier_granted={payload.get('tier', 'unchanged')}"
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
    price_id = _subscription_price_id(sub)
    if price_id:
        update["plan_id"] = price_id  # keeps plan switches via portal in sync
    # Dunning guard: only extend paid-through when the subscription actually
    # bills. The period advances at cycle start regardless of payment — writing
    # expires_at for past_due/unpaid would hand out the unpaid cycle for free
    # (indefinitely, if the Dashboard is set to mark unpaid instead of cancel).
    # Recovery payments extend via invoice.payment_succeeded.
    if period_end and sub.get("status") in {"active", "trialing"}:
        update["expires_at"] = _unix_to_iso(period_end)
    # Intentionally omitting expires_at when unknown — NULL means never-expire,
    # so writing None would silently grant permanent access.

    # Self-heal: event says the subscription bills but the row lost the tier
    # (e.g. a missed invoice.payment_succeeded). Confirm live before granting —
    # the event snapshot may be stale/out-of-order relative to a deletion.
    if sub.get("status") in {"active", "trialing"} and row_info.get("tier") == "standard":
        live_status = stripe.Subscription.retrieve(subscription_id).get("status", "")
        if live_status in {"active", "trialing"}:
            update["tier"] = "insider"
            logger.info(f"[BILLING] Self-healed insider tier for sub={subscription_id}")

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

    # Write the LIVE status instead of a blind 'past_due': this event can land
    # after customer.subscription.deleted (Stripe doesn't order deliveries), and
    # overwriting 'canceled' would make the UI offer the portal forever instead
    # of a new checkout. expires_at is intentionally untouched — a failed cycle
    # must not extend access.
    sub = stripe.Subscription.retrieve(subscription_id)
    live_status = sub.get("status", "") or "past_due"

    sb.table("subscriptions").update({
        "stripe_status": live_status,
    }).eq("stripe_subscription_id", subscription_id).execute()

    logger.warning(f"[BILLING] Invoice failed, status={live_status} sub={subscription_id}")


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
