"""
Routes for the Meta Usage page.

- GET /meta-usage/summary : live gauges + top routes for the current user
- GET /meta-usage/calls   : paginated + filterable list of the user's Meta calls
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.auth import get_current_user
from app.core.supabase_client import get_supabase_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/meta-usage", tags=["meta-usage"])


_SELECT_COLUMNS = (
    "id,created_at,user_id,route,page_route,service_name,ad_account_id,meta_endpoint,"
    "http_method,http_status,response_ms,call_count_pct,cputime_pct,"
    "total_time_pct,business_use_case_usage,ad_account_usage"
)


@router.get("/summary")
def get_summary(current_user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    """Current quota state + quick top-routes breakdown for the user."""
    user_id = current_user["user_id"]
    sb = get_supabase_service()

    # Latest call — drives the live gauges.
    # Include rows where user_id IS NULL (background job calls) since they belong
    # to the same app instance and represent real quota consumption.
    latest_resp = (
        sb.table("meta_api_usage")
        .select(
            "created_at,call_count_pct,cputime_pct,total_time_pct,"
            "business_use_case_usage,ad_account_usage"
        )
        .or_(f"user_id.eq.{user_id},user_id.is.null")
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    latest = (latest_resp.data or [None])[0]

    now = datetime.now(timezone.utc)
    since_24h = (now - timedelta(hours=24)).isoformat()
    since_7d = (now - timedelta(days=7)).isoformat()

    calls_24h = _count_since(sb, user_id, since_24h)
    calls_7d = _count_since(sb, user_id, since_7d)

    top_routes = _top_routes_last_24h(sb, user_id, since_24h)

    return {
        "latest": latest,
        "calls_24h": calls_24h,
        "calls_7d": calls_7d,
        "top_routes_24h": top_routes,
    }


@router.get("/calls")
def list_calls(
    current_user: Dict[str, Any] = Depends(get_current_user),
    route: Optional[str] = Query(default=None),
    service_name: Optional[str] = Query(default=None),
    ad_account_id: Optional[str] = Query(default=None),
    from_: Optional[str] = Query(default=None, alias="from"),
    to: Optional[str] = Query(default=None),
    min_cputime: Optional[float] = Query(default=None, ge=0),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
) -> Dict[str, Any]:
    """Paginated, filterable list of Meta API calls for the user."""
    user_id = current_user["user_id"]
    sb = get_supabase_service()

    query = (
        sb.table("meta_api_usage")
        .select(_SELECT_COLUMNS, count="exact")
        .or_(f"user_id.eq.{user_id},user_id.is.null")
    )

    if route:
        query = query.eq("route", route)
    if service_name:
        query = query.eq("service_name", service_name)
    if ad_account_id:
        query = query.eq("ad_account_id", ad_account_id)
    if from_:
        query = query.gte("created_at", from_)
    if to:
        query = query.lte("created_at", to)
    if min_cputime is not None:
        query = query.gte("cputime_pct", min_cputime)

    offset = (page - 1) * page_size
    try:
        resp = (
            query.order("created_at", desc=True)
            .range(offset, offset + page_size - 1)
            .execute()
        )
    except Exception as e:
        logger.exception("meta-usage /calls query failed")
        raise HTTPException(status_code=500, detail=f"query failed: {e}") from e

    return {
        "items": resp.data or [],
        "total": getattr(resp, "count", None),
        "page": page,
        "page_size": page_size,
    }


@router.get("/distinct")
def distinct_filters(
    current_user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, List[str]]:
    """Distinct values for filter dropdowns: routes, services, ad accounts."""
    user_id = current_user["user_id"]
    sb = get_supabase_service()

    resp = (
        sb.table("meta_api_usage")
        .select("route,service_name,ad_account_id")
        .or_(f"user_id.eq.{user_id},user_id.is.null")
        .order("created_at", desc=True)
        .limit(2000)
        .execute()
    )

    rows = resp.data or []
    routes = sorted({r["route"] for r in rows if r.get("route")})
    services = sorted({r["service_name"] for r in rows if r.get("service_name")})
    accounts = sorted({r["ad_account_id"] for r in rows if r.get("ad_account_id")})

    return {"routes": routes, "services": services, "ad_accounts": accounts}


def _count_since(sb, user_id: str, since_iso: str) -> int:
    resp = (
        sb.table("meta_api_usage")
        .select("id", count="exact")
        .or_(f"user_id.eq.{user_id},user_id.is.null")
        .gte("created_at", since_iso)
        .limit(1)
        .execute()
    )
    return getattr(resp, "count", 0) or 0


def _top_routes_last_24h(sb, user_id: str, since_iso: str) -> List[Dict[str, Any]]:
    """
    Aggregates client-side because Supabase PostgREST doesn't support GROUP BY
    in simple selects. We read up to 5000 recent rows and aggregate in Python.
    For users under heavy load this may need a DB-side RPC, but at current
    scale a capped client-side roll-up is sufficient.
    """
    resp = (
        sb.table("meta_api_usage")
        .select("route,cputime_pct")
        .or_(f"user_id.eq.{user_id},user_id.is.null")
        .gte("created_at", since_iso)
        .order("created_at", desc=True)
        .limit(5000)
        .execute()
    )

    totals: Dict[str, Dict[str, float]] = {}
    for row in resp.data or []:
        route = row.get("route") or "(unknown)"
        cputime = row.get("cputime_pct")
        entry = totals.setdefault(route, {"route": route, "calls": 0, "cputime_sum": 0.0})
        entry["calls"] += 1
        if isinstance(cputime, (int, float)):
            entry["cputime_sum"] += float(cputime)

    ranked = sorted(totals.values(), key=lambda e: e["cputime_sum"], reverse=True)
    return ranked[:5]
