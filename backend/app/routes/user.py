from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import uuid
from typing import Any, Dict

from fastapi import APIRouter, Depends, Form, HTTPException

from app.core.auth import get_current_user
from app.core.config import FACEBOOK_CLIENT_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
from app.core.supabase_client import get_supabase_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/user", tags=["user"])


# ---------------------------------------------------------------------------
# Shared deletion logic
# ---------------------------------------------------------------------------

def _delete_user_data(user_id: str) -> Dict[str, Any]:
    """Delete all user data from the database and storage.

    Uses the service client (bypasses RLS) to ensure complete deletion.
    Returns a summary dict with counts of deleted rows per table.
    """
    sb = get_supabase_service()
    summary: Dict[str, Any] = {}

    # 1) Delete thumbnails from Supabase Storage (ad-thumbs bucket)
    try:
        prefix = f"thumbs/{user_id}/"
        files = sb.storage.from_("ad-thumbs").list(prefix)
        if files:
            paths = [f"{prefix}{f['name']}" for f in files if f.get("name")]
            if paths:
                sb.storage.from_("ad-thumbs").remove(paths)
                summary["storage_files"] = len(paths)
            else:
                summary["storage_files"] = 0
        else:
            summary["storage_files"] = 0
    except Exception as e:
        logger.warning(f"[DELETE_USER_DATA] Storage cleanup error for {user_id}: {e}")
        summary["storage_files"] = "error"

    # 2) Delete records from tables in order (child → parent to avoid FK issues)
    tables_to_delete = [
        ("jobs", "user_id"),
        ("ad_sheet_integrations", "owner_id"),
        ("ad_metrics", "user_id"),
        ("ads", "user_id"),
        ("packs", "user_id"),
        ("ad_accounts", "user_id"),
        ("google_accounts", "user_id"),
        ("facebook_connections", "user_id"),
        ("user_preferences", "user_id"),
        ("profiles", "user_id"),
    ]

    for table, column in tables_to_delete:
        try:
            result = sb.table(table).delete().eq(column, user_id).execute()
            summary[table] = len(result.data) if result.data else 0
        except Exception as e:
            logger.warning(f"[DELETE_USER_DATA] Error deleting from {table} for {user_id}: {e}")
            summary[table] = "error"

    logger.info(f"[DELETE_USER_DATA] Completed for user {user_id}: {summary}")
    return summary


def _delete_auth_user(user_id: str) -> None:
    """Delete the user from Supabase auth.users (irreversible)."""
    sb = get_supabase_service()
    sb.auth.admin.delete_user(user_id)
    logger.info(f"[DELETE_AUTH_USER] Deleted auth user {user_id}")


# ---------------------------------------------------------------------------
# Endpoint 1: Delete user DATA only (keep account)
# ---------------------------------------------------------------------------

@router.delete("/data")
async def delete_user_data(current_user: Dict[str, Any] = Depends(get_current_user)):
    """Delete all user data but keep the Supabase Auth account."""
    user_id = current_user["user_id"]
    logger.info(f"[DELETE /user/data] User {user_id} requested data deletion (keep account)")

    try:
        summary = _delete_user_data(user_id)
        return {"success": True, "type": "data_only", "summary": summary}
    except Exception as e:
        logger.error(f"[DELETE /user/data] Failed for user {user_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to delete user data") from e


# ---------------------------------------------------------------------------
# Endpoint 2: Delete user ACCOUNT + all data (irreversible)
# ---------------------------------------------------------------------------

@router.delete("/account")
async def delete_user_account(current_user: Dict[str, Any] = Depends(get_current_user)):
    """Delete all user data AND the Supabase Auth account. Irreversible."""
    user_id = current_user["user_id"]
    logger.info(f"[DELETE /user/account] User {user_id} requested full account deletion")

    try:
        summary = _delete_user_data(user_id)
        _delete_auth_user(user_id)
        return {"success": True, "type": "full_account", "summary": summary}
    except Exception as e:
        logger.error(f"[DELETE /user/account] Failed for user {user_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to delete user account") from e


# ---------------------------------------------------------------------------
# Endpoint 3: Meta Data Deletion Callback (no JWT — Meta calls this directly)
# ---------------------------------------------------------------------------

def _parse_signed_request(signed_request: str, app_secret: str) -> Dict[str, Any]:
    """Decode and verify a Facebook signed_request.

    See: https://developers.facebook.com/docs/games/gamesonfacebook/login#parsingsr
    """
    parts = signed_request.split(".", 1)
    if len(parts) != 2:
        raise ValueError("Invalid signed_request format")

    encoded_sig, payload = parts

    # Decode signature
    sig = base64.urlsafe_b64decode(encoded_sig + "==")

    # Decode payload
    data = json.loads(base64.urlsafe_b64decode(payload + "=="))

    # Verify signature
    expected_sig = hmac.new(
        app_secret.encode("utf-8"),
        payload.encode("utf-8"),
        hashlib.sha256,
    ).digest()

    if not hmac.compare_digest(sig, expected_sig):
        raise ValueError("Invalid signed_request signature")

    return data


@router.post("/meta-data-deletion-callback")
async def meta_data_deletion_callback(signed_request: str = Form(...)):
    """Meta Platform Data Deletion Callback.

    When a user removes the app from Facebook settings, Meta sends a POST
    with a signed_request. We verify it and delete the user's data.
    """
    if not FACEBOOK_CLIENT_SECRET:
        raise HTTPException(status_code=500, detail="Facebook app secret not configured")

    # 1) Parse and verify the signed request
    try:
        data = _parse_signed_request(signed_request, FACEBOOK_CLIENT_SECRET)
    except ValueError as e:
        logger.warning(f"[META_DELETION_CALLBACK] Invalid signed_request: {e}")
        raise HTTPException(status_code=400, detail="Invalid signed_request") from e

    fb_user_id = data.get("user_id")
    if not fb_user_id:
        raise HTTPException(status_code=400, detail="Missing user_id in signed_request")

    logger.info(f"[META_DELETION_CALLBACK] Received deletion request for FB user {fb_user_id}")

    # 2) Find the Hookify user by facebook_user_id
    sb = get_supabase_service()
    try:
        result = (
            sb.table("facebook_connections")
            .select("user_id")
            .eq("facebook_user_id", str(fb_user_id))
            .limit(1)
            .execute()
        )
    except Exception as e:
        logger.error(f"[META_DELETION_CALLBACK] DB lookup failed: {e}")
        raise HTTPException(status_code=500, detail="Internal error") from e

    confirmation_code = str(uuid.uuid4())

    if result.data and len(result.data) > 0:
        hookify_user_id = result.data[0]["user_id"]
        logger.info(f"[META_DELETION_CALLBACK] Found Hookify user {hookify_user_id} for FB user {fb_user_id}")
        try:
            _delete_user_data(hookify_user_id)
        except Exception as e:
            logger.error(f"[META_DELETION_CALLBACK] Deletion failed for {hookify_user_id}: {e}")
    else:
        logger.info(f"[META_DELETION_CALLBACK] No Hookify user found for FB user {fb_user_id}")

    # 3) Return the format Meta expects
    return {
        "url": f"https://hookifyads.com/exclusao-de-dados",
        "confirmation_code": confirmation_code,
    }
