from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict

from fastapi import Depends, HTTPException

from app.core.auth import get_current_user
from app.core.supabase_client import get_supabase_service

logger = logging.getLogger(__name__)

# Grace period after expires_at before downgrading to standard.
# Mirrors frontend/lib/config/tierConfig.ts GRACE_PERIOD_DAYS.
GRACE_PERIOD_DAYS = 7

TIER_HIERARCHY = ["standard", "insider", "admin"]


def get_effective_tier(row: dict | None, now: datetime | None = None) -> str:
    """Return the enforced tier given a subscriptions row.

    Rules:
    - row is None or tier absent → 'standard'
    - expires_at is NULL → tier (never expires; used for manual/promo grants)
    - expires_at is in the future, or within grace period → tier
    - expires_at is more than GRACE_PERIOD_DAYS ago → 'standard'
    """
    if not row:
        return "standard"
    tier = row.get("tier") or "standard"
    expires_at_raw = row.get("expires_at")
    if not expires_at_raw:
        return tier  # NULL = never expires

    if now is None:
        now = datetime.now(tz=timezone.utc)

    try:
        # Normalize both 'Z' suffix and '+00:00' offset
        expires_at = datetime.fromisoformat(expires_at_raw.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        logger.warning(f"[TIER] Could not parse expires_at={expires_at_raw!r}, treating as never")
        return tier

    if expires_at >= now - timedelta(days=GRACE_PERIOD_DAYS):
        return tier
    return "standard"


def require_min_tier(minimum: str):
    """FastAPI dependency factory — raises 403/503 if caller's tier is insufficient.

    Fail-open policy for 'insider': a DB error doesn't lock out paying users.
    For 'admin', fail-closed (503) because the stakes are higher.
    """
    async def _dependency(
        current_user: Dict[str, Any] = Depends(get_current_user),
    ) -> Dict[str, Any]:
        user_id = current_user["user_id"]
        sb = get_supabase_service()

        try:
            result = (
                sb.table("subscriptions")
                .select("tier, expires_at")
                .eq("user_id", user_id)
                .limit(1)
                .execute()
            )
            row = result.data[0] if result.data else None
        except Exception as e:
            if minimum == "admin":
                logger.error(f"[TIER] DB error checking admin tier for user={user_id}: {e}")
                raise HTTPException(status_code=503, detail="Tier check unavailable") from e
            logger.warning(f"[TIER] DB error checking tier for user={user_id}, failing open: {e}")
            return current_user

        effective = get_effective_tier(row)
        if TIER_HIERARCHY.index(effective) < TIER_HIERARCHY.index(minimum):
            raise HTTPException(
                status_code=403,
                detail=f"This feature requires {minimum} tier",
            )
        return current_user

    return _dependency


require_insider = require_min_tier("insider")
