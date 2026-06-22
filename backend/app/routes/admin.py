from __future__ import annotations

import logging
from typing import Any, Dict, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.core.supabase_client import get_supabase_service
from app.core.tier import require_min_tier

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/admin", tags=["admin"])

VALID_TIERS = {"standard", "insider", "admin"}

_require_admin = require_min_tier("admin")


# ── GET /admin/users ──────────────────────────────────────────────────────────

@router.get("/users")
async def list_users(_admin: Dict[str, Any] = Depends(_require_admin)):
    """Return all users with subscription info, packs count, and Meta account."""
    sb = get_supabase_service()
    try:
        result = sb.rpc("get_admin_users_list").execute()
        return result.data or []
    except Exception as e:
        logger.error(f"[ADMIN] list_users failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to fetch users") from e


# ── PATCH /admin/users/{user_id}/tier ────────────────────────────────────────

class UpdateTierRequest(BaseModel):
    tier: Literal["standard", "insider", "admin"]


@router.patch("/users/{user_id}/tier")
async def update_user_tier(
    user_id: str,
    body: UpdateTierRequest,
    current_user: Dict[str, Any] = Depends(_require_admin),
):
    """Update the tier for a given user. Caller must be admin."""
    caller_id = current_user["user_id"]
    sb = get_supabase_service()

    try:
        result = (
            sb.table("subscriptions")
            .update({"tier": body.tier, "granted_by": caller_id})
            .eq("user_id", user_id)
            .execute()
        )
    except Exception as e:
        logger.error(f"[ADMIN] update_user_tier failed for {user_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to update tier") from e

    if not result.data:
        raise HTTPException(status_code=404, detail="User subscription not found")

    logger.info(f"[ADMIN] Tier updated: user={user_id} tier={body.tier} by={caller_id}")
    return result.data[0]
