from __future__ import annotations

from typing import Any, Dict, List, Optional, Literal, Set
from datetime import datetime, timedelta
import logging
import random
import time

from fastapi import APIRouter, BackgroundTasks, HTTPException, Body, Depends, Query
from pydantic import BaseModel, Field

from app.core.supabase_client import get_supabase_for_user
from app.core.auth import get_current_user
from app.core.config import (
    ANALYTICS_MANAGER_RPC_ENABLED,
    ANALYTICS_MANAGER_RPC_AB_COMPARE_ENABLED,
    ANALYTICS_MANAGER_RPC_AB_SAMPLE_RATE,
    ANALYTICS_MANAGER_RPC_FAIL_OPEN,
    ANALYTICS_MANAGER_POSTGREST_TIMEOUT_SECONDS,
)
from app.services import supabase_repo
from app.services.ad_media import resolve_media_type
from app.services.thumbnail_cache import build_public_storage_url, DEFAULT_BUCKET

try:
    import httpx
except Exception:  # pragma: no cover - optional at runtime
    httpx = None  # type: ignore

try:
    import httpcore
except Exception:  # pragma: no cover - optional at runtime
    httpcore = None  # type: ignore


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/analytics", tags=["analytics"])


def _get_analytics_supabase(jwt_token: str):
    return get_supabase_for_user(
        jwt_token,
        postgrest_timeout_seconds=ANALYTICS_MANAGER_POSTGREST_TIMEOUT_SECONDS,
    )


def _is_transient_analytics_rpc_error(error: Exception) -> bool:
    text = str(error or "")
    transient_markers = (
        "ReadTimeout",
        "ConnectTimeout",
        "Timeout",
        "timed out",
        "connection reset",
        "temporarily unavailable",
    )
    if any(marker in text for marker in transient_markers):
        return True

    transient_types: List[type] = []
    if httpx is not None:
        transient_types.extend(
            [
                getattr(httpx, "ReadTimeout", tuple()),
                getattr(httpx, "ConnectTimeout", tuple()),
                getattr(httpx, "TimeoutException", tuple()),
                getattr(httpx, "ReadError", tuple()),
                getattr(httpx, "ConnectError", tuple()),
                getattr(httpx, "NetworkError", tuple()),
            ]
        )
    if httpcore is not None:
        transient_types.extend(
            [
                getattr(httpcore, "ReadTimeout", tuple()),
                getattr(httpcore, "ConnectTimeout", tuple()),
                getattr(httpcore, "TimeoutException", tuple()),
                getattr(httpcore, "ReadError", tuple()),
                getattr(httpcore, "ConnectError", tuple()),
                getattr(httpcore, "NetworkError", tuple()),
            ]
        )
    transient_types = [t for t in transient_types if isinstance(t, type)]
    return bool(transient_types and isinstance(error, tuple(transient_types)))


def _fetch_ad_metrics_via_rpc(
    sb,
    user_id: str,
    date_start: str,
    date_stop: str,
    pack_ids: Optional[List[str]] = None,
    account_ids: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    """Fetch ad_metrics via RPC with pagination to bypass PostgREST 1000-row limit.

    Uses the && (overlap) operator with GIN index instead of multiple
    paginated PostgREST queries with OR-chained contains operators.
    """
    params: Dict[str, Any] = {
        "p_user_id": user_id,
        "p_date_start": date_start,
        "p_date_stop": date_stop,
    }
    if pack_ids:
        params["p_pack_ids"] = pack_ids
    if account_ids:
        params["p_account_ids"] = account_ids

    all_rows: List[Dict[str, Any]] = []
    page_size = 1000
    offset = 0

    while True:
        result = sb.rpc("fetch_ad_metrics_for_analytics", params).range(offset, offset + page_size - 1).execute()
        page_data = result.data or []

        if not page_data:
            break

        all_rows.extend(page_data)

        if len(page_data) < page_size:
            break

        offset += page_size

    return all_rows


def _fetch_all_paginated(sb, table_name: str, select_fields: str, filters_func, max_per_page: int = 1000) -> List[Dict[str, Any]]:
    """Busca todos os registros de uma tabela usando paginaÃ§Ã£o para contornar limite de 1000 linhas do Supabase.
    
    Args:
        sb: Cliente Supabase
        table_name: Nome da tabela
        select_fields: Campos a selecionar (ex: "id, pack_ids")
        filters_func: FunÃ§Ã£o que recebe um query builder e retorna o query com filtros aplicados
        max_per_page: MÃ¡ximo de registros por pÃ¡gina (padrÃ£o 1000, limite do Supabase)
    
    Returns:
        Lista com todos os registros encontrados
    """
    all_rows = []
    page_size = max_per_page
    offset = 0
    
    while True:
        q = sb.table(table_name).select(select_fields)
        q = filters_func(q)
        q = q.range(offset, offset + page_size - 1)
        
        result = q.execute()
        page_data = result.data or []
        
        if not page_data:
            break
        
        all_rows.extend(page_data)
        
        # Se retornou menos que page_size, chegamos ao fim
        if len(page_data) < page_size:
            break
        
        offset += page_size
    
    return all_rows


GroupBy = Literal["ad_id", "ad_name", "adset_id", "campaign_id"]


class RankingsFilters(BaseModel):
    adaccount_ids: Optional[List[str]] = None
    campaign_name_contains: Optional[str] = None
    adset_name_contains: Optional[str] = None
    ad_name_contains: Optional[str] = None
    campaign_id: Optional[str] = None


class RankingsRequest(BaseModel):
    date_start: str
    date_stop: str
    group_by: GroupBy = "ad_id"
    action_type: Optional[str] = None
    order_by: Optional[str] = Field(default=None, description="hook|hold_rate|cpr|spend|ctr|connect_rate|page_conv")
    limit: int = 500
    filters: Optional[RankingsFilters] = None
    pack_ids: Optional[List[str]] = Field(default=None, description="Lista de pack IDs para filtrar mÃ©tricas. Se vazio/None, nÃ£o retorna dados.")
    include_series: bool = Field(default=True, description="Se False, omite series (sparklines) da resposta para economizar memÃ³ria/payload")
    include_leadscore: bool = Field(default=True, description="Se False, omite leadscore_values da resposta")
    series_window: Optional[int] = Field(default=None, description="Limitar series aos Ãºltimos N dias do range. Se None, usa range completo.")
    offset: int = Field(default=0, ge=0, description="Offset para paginaÃ§Ã£o server-side")
    include_available_conversion_types: bool = Field(
        default=True,
        description="Se False, omite available_conversion_types para reduzir processamento.",
    )


class RankingsSeriesRequest(BaseModel):
    date_start: str
    date_stop: str
    group_by: GroupBy = "ad_id"
    action_type: Optional[str] = None
    pack_ids: Optional[List[str]] = Field(default=None, description="Lista de pack IDs para filtrar mÃ©tricas.")
    filters: Optional[RankingsFilters] = None
    group_keys: List[str] = Field(default_factory=list, description="Chaves dos grupos para retornar sÃ©ries.")
    window: int = Field(default=5, ge=1, le=30, description="Janela da sÃ©rie em dias.")


class RankingsRetentionRequest(BaseModel):
    date_start: str
    date_stop: str
    group_by: GroupBy = "ad_id"
    pack_ids: Optional[List[str]] = Field(default=None, description="Lista de pack IDs para filtrar mÃ©tricas.")
    filters: Optional[RankingsFilters] = None
    group_key: str = Field(..., description="Chave do grupo para calcular curva de retenÃ§Ã£o.")


class DashboardRequest(BaseModel):
    date_start: str
    date_stop: str
    adaccount_ids: Optional[List[str]] = None


class DeletePackRequest(BaseModel):
    ad_ids: Optional[List[str]] = Field(default=None, description="Fallback opcional para packs antigos sem ad_ids salvos (geralmente nÃ£o necessÃ¡rio)")


class UpdatePackAutoRefreshRequest(BaseModel):
    auto_refresh: bool = Field(..., description="Valor booleano para ativar/desativar auto_refresh")


class UpdatePackNameRequest(BaseModel):
    name: str = Field(..., description="Novo nome do pack", min_length=1)


def _to_date(s: str) -> datetime:
    return datetime(int(s[0:4]), int(s[5:7]), int(s[8:10]))


def _axis_5_days(end_date: str) -> List[str]:
    end = _to_date(end_date)
    return [(end - timedelta(days=i)).strftime("%Y-%m-%d") for i in range(4, -1, -1)]


def _axis_date_range(start_date: str, end_date: str) -> List[str]:
    """Gera array de datas entre start_date e end_date (inclusive)."""
    start = _to_date(start_date)
    end = _to_date(end_date)
    dates = []
    current = start
    while current <= end:
        dates.append(current.strftime("%Y-%m-%d"))
        current += timedelta(days=1)
    return dates


def _safe_div(a: float, b: float) -> float:
    return (a / b) if b else 0.0


def _extract_lpv(row: Dict[str, Any]) -> int:
    """Extrai LPV (landing_page_view) de forma consistente.

    PreferÃªncia:
    1) coluna explÃ­cita `lpv` (quando disponÃ­vel no ad_metrics)
    2) soma de actions[].value onde action_type == landing_page_view

    Retorna 0 quando nÃ£o houver dados.
    """
    try:
        v = row.get("lpv")
        if v is not None:
            n = int(v or 0)
            if n > 0:
                return n
    except Exception:
        pass

    lpv = 0
    try:
        for a in (row.get("actions") or []):
            if str(a.get("action_type")) == "landing_page_view":
                lpv += int(a.get("value") or 0)
    except Exception:
        return 0
    return int(lpv or 0)


def _get_user_mql_leadscore_min(sb, user_id: str) -> float:
    """Busca mql_leadscore_min do usuÃ¡rio. Fallback seguro para 0."""
    try:
        res = sb.table("user_preferences").select("mql_leadscore_min").eq("user_id", user_id).limit(1).execute()
        if res and res.data:
            raw = res.data[0].get("mql_leadscore_min")
            v = float(raw) if raw is not None else 0.0
            return v if v >= 0 else 0.0
    except Exception:
        pass
    return 0.0


def _count_mql(leadscore_values: Any, mql_leadscore_min: float) -> int:
    """Conta quantos leadscores sÃ£o >= mql_leadscore_min (valores invÃ¡lidos sÃ£o ignorados)."""
    if not isinstance(leadscore_values, list) or not leadscore_values:
        return 0
    cnt = 0
    for v in leadscore_values:
        try:
            n = float(v)
        except Exception:
            continue
        if n >= mql_leadscore_min:
            cnt += 1
    return cnt


def _build_rankings_series(axis: List[str], S: Optional[Dict[str, Any]], include_cpmql: bool = True) -> Dict[str, Any]:
    """ConstrÃ³i payload `series` no formato consumido pelo frontend (sparklines)."""
    # Se S for None, usar dict vazio para evitar AttributeError
    if S is None:
        S = {}
    hook_series: List[Optional[float]] = []
    scroll_stop_series: List[Optional[float]] = []
    hold_rate_series: List[Optional[float]] = []
    video_watched_p50_series: List[Optional[float]] = []
    spend_series: List[Optional[float]] = []
    clicks_series: List[Optional[int]] = []
    inline_link_clicks_series: List[Optional[int]] = []
    ctr_series: List[Optional[float]] = []
    connect_series: List[Optional[float]] = []
    lpv_series: List[Optional[int]] = []
    impressions_series: List[Optional[int]] = []
    cpm_series: List[Optional[float]] = []
    cpc_series: List[Optional[float]] = []
    cplc_series: List[Optional[float]] = []
    website_ctr_series: List[Optional[float]] = []
    conversions_series: List[Dict[str, int]] = []  # conversions por dia
    cpmql_series: List[Optional[float]] = []
    mqls_series: List[Optional[int]] = []  # MQLs por dia

    for d in axis:
        plays = (S.get("plays") or {}).get(d, 0) or 0
        hook_wsum = (S.get("hook_wsum") or {}).get(d, 0.0) or 0.0
        hook_day = _safe_div(hook_wsum, plays) if plays else None

        scroll_stop_wsum = (S.get("scroll_stop_wsum") or {}).get(d, 0.0) or 0.0
        scroll_stop_day = _safe_div(scroll_stop_wsum, plays) if plays else None

        hold_rate_wsum = (S.get("hold_rate_wsum") or {}).get(d, 0.0) or 0.0
        hold_rate_day = _safe_div(hold_rate_wsum, plays) if plays else None

        video_watched_p50_wsum = (S.get("video_watched_p50_wsum") or {}).get(d, 0.0) or 0.0
        video_watched_p50_day = _safe_div(video_watched_p50_wsum, plays) if plays else None

        spend_day = (S.get("spend") or {}).get(d, 0.0) or 0.0
        clicks_day = (S.get("clicks") or {}).get(d, 0) or 0
        impr_day = (S.get("impressions") or {}).get(d, 0) or 0
        inline_day = (S.get("inline") or {}).get(d, 0) or 0
        lpv_day = (S.get("lpv") or {}).get(d, 0) or 0

        ctr_day = (clicks_day / impr_day) if impr_day else None
        connect_day = (lpv_day / inline_day) if inline_day else None
        cpm_day = (spend_day * 1000.0 / impr_day) if impr_day else None
        cpc_day = (spend_day / clicks_day) if clicks_day else None
        cplc_day = (spend_day / inline_day) if inline_day else None
        website_ctr_day = (inline_day / impr_day) if impr_day else None

        conversions_day = ((S.get("conversions") or {}).get(d, {})) or {}

        hook_series.append(hook_day)
        scroll_stop_series.append(scroll_stop_day)
        hold_rate_series.append(hold_rate_day)
        video_watched_p50_series.append(video_watched_p50_day)
        spend_series.append(spend_day if spend_day else None)
        clicks_series.append(clicks_day if clicks_day else None)
        inline_link_clicks_series.append(inline_day if inline_day else None)
        ctr_series.append(ctr_day)
        connect_series.append(connect_day)
        lpv_series.append(lpv_day)
        impressions_series.append(impr_day if impr_day else None)
        cpm_series.append(cpm_day)
        cpc_series.append(cpc_day)
        cplc_series.append(cplc_day)
        website_ctr_series.append(website_ctr_day)
        conversions_series.append(conversions_day)

        if include_cpmql:
            mql_count_day = ((S.get("mql_count") or {}).get(d, 0)) or 0
            cpmql_day = (spend_day / mql_count_day) if (mql_count_day and spend_day > 0) else None
            cpmql_series.append(cpmql_day)
            mqls_series.append(mql_count_day if mql_count_day > 0 else None)

    series: Dict[str, Any] = {
        "axis": axis,
        "hook": hook_series,
        "scroll_stop": scroll_stop_series,
        "hold_rate": hold_rate_series,
        "video_watched_p50": video_watched_p50_series,
        "spend": spend_series,
        "clicks": clicks_series,
        "inline_link_clicks": inline_link_clicks_series,
        "ctr": ctr_series,
        "connect_rate": connect_series,
        "lpv": lpv_series,
        "impressions": impressions_series,
        "cpm": cpm_series,
        "cpc": cpc_series,
        "cplc": cplc_series,
        "website_ctr": website_ctr_series,
        "conversions": conversions_series,
    }
    if include_cpmql:
        series["cpmql"] = cpmql_series
        series["mqls"] = mqls_series
    return series


def _group_key_from_rankings_item(item: Dict[str, Any], group_by: GroupBy) -> str:
    if group_by == "ad_id":
        return str(item.get("ad_id") or "")
    if group_by == "ad_name":
        return str(item.get("ad_name") or item.get("ad_id") or "")
    if group_by == "adset_id":
        return str(item.get("adset_id") or "")
    return str(item.get("campaign_id") or "")


def _group_key_from_metric_row(row: Dict[str, Any], group_by: GroupBy) -> str:
    ad_id = str(row.get("ad_id") or "")
    if group_by == "ad_id":
        return ad_id
    if group_by == "ad_name":
        return str(row.get("ad_name") or ad_id)
    if group_by == "adset_id":
        return str(row.get("adset_id") or "")
    return str(row.get("campaign_id") or "")


def _normalize_date_str(date_raw: Any) -> Optional[str]:
    if date_raw is None:
        return None
    if isinstance(date_raw, str):
        d = date_raw[:10] if len(date_raw) >= 10 else date_raw
    elif hasattr(date_raw, "strftime"):
        d = date_raw.strftime("%Y-%m-%d")
    else:
        d = str(date_raw)[:10]
    if len(d) != 10 or d[4] != "-" or d[7] != "-":
        return None
    return d


def _build_header_aggregates(items: List[Dict[str, Any]], action_type: Optional[str], averages: Dict[str, Any]) -> Dict[str, Any]:
    selected_key = str(action_type or "").strip()
    sum_spend = 0.0
    sum_results = 0.0

    for row in items:
        spend = float(row.get("spend") or 0)
        convs = row.get("conversions") or {}
        results = float(convs.get(selected_key) or 0) if selected_key and isinstance(convs, dict) else 0.0
        sum_spend += spend
        sum_results += results

    weighted = {
        "hook": float((averages or {}).get("hook") or 0),
        "scroll_stop": float((averages or {}).get("scroll_stop") or 0),
        "ctr": float((averages or {}).get("ctr") or 0),
        "website_ctr": float((averages or {}).get("website_ctr") or 0),
        "connect_rate": float((averages or {}).get("connect_rate") or 0),
        "cpm": float((averages or {}).get("cpm") or 0),
        "page_conv": 0.0,
    }

    per_action = (averages or {}).get("per_action_type") or {}
    if selected_key and isinstance(per_action, dict):
        selected_avg = per_action.get(selected_key) or {}
        if isinstance(selected_avg, dict):
            weighted["page_conv"] = float(selected_avg.get("page_conv") or 0)

    return {
        "sums": {
            "spend": sum_spend,
            "results": sum_results,
            "mqls": None,
        },
        "weighted_averages": weighted,
    }


def _get_rankings_core_v2(req: RankingsRequest, user: Dict[str, Any], sb, mql_leadscore_min: float) -> Dict[str, Any]:
    # Reusa agregaÃ§Ã£o validada do legado, mas com shape de resposta "core".
    req_legacy = req.model_copy(deep=True)
    req_legacy.include_series = False
    req_legacy.limit = 100000  # obter universo filtrado para paginaÃ§Ã£o server-side

    legacy = _get_rankings_legacy(req_legacy, user, sb, mql_leadscore_min)
    all_items = list(legacy.get("data") or [])

    selected_action = str(req.action_type or "").strip()
    for item in all_items:
        item.pop("series", None)
        item.pop("video_play_curve_actions", None)

        convs = item.get("conversions") or {}
        if not isinstance(convs, dict):
            convs = {}

        if selected_action:
            results = float(convs.get(selected_action) or 0)
            spend = float(item.get("spend") or 0)
            lpv = float(item.get("lpv") or 0)
            item["conversions"] = {selected_action: results}
            item["results"] = results
            item["cpr"] = (spend / results) if results > 0 else 0
            item["page_conv"] = (results / lpv) if lpv > 0 else 0
        else:
            item["conversions"] = {}
            item["results"] = 0
            item["cpr"] = 0
            item["page_conv"] = 0

    total = len(all_items)
    limit = max(1, int(req.limit or 500))
    offset = max(0, int(req.offset or 0))
    page_items = all_items[offset: offset + limit]

    available = legacy.get("available_conversion_types") or []
    if not req.include_available_conversion_types:
        available = []

    averages = legacy.get("averages") if isinstance(legacy.get("averages"), dict) else {}
    header_aggregates = _build_header_aggregates(all_items, req.action_type, averages)

    return {
        "data": page_items,
        "available_conversion_types": available,
        "averages": averages,
        "header_aggregates": header_aggregates,
        "pagination": {
            "limit": limit,
            "offset": offset,
            "total": total,
            "has_more": (offset + limit) < total,
        },
    }


def _get_rankings_series_v2(req: RankingsSeriesRequest, user: Dict[str, Any], sb, mql_leadscore_min: float) -> Dict[str, Any]:
    group_keys_set = {str(k) for k in (req.group_keys or []) if str(k).strip()}
    if not group_keys_set:
        return {"series_by_group": {}, "window": req.window}

    legacy_req = RankingsRequest(
        date_start=req.date_start,
        date_stop=req.date_stop,
        group_by=req.group_by,
        action_type=req.action_type,
        order_by="spend",
        limit=100000,
        filters=req.filters,
        pack_ids=req.pack_ids,
        include_series=True,
        include_leadscore=False,
        series_window=req.window,
    )
    legacy = _get_rankings_legacy(legacy_req, user, sb, mql_leadscore_min)
    rows = legacy.get("data") or []

    action_key = str(req.action_type or "").strip()
    out: Dict[str, Any] = {}
    for row in rows:
        key = _group_key_from_rankings_item(row, req.group_by)
        if key not in group_keys_set:
            continue
        series = dict(row.get("series") or {})
        if not series:
            continue

        if action_key:
            conv_series = series.get("conversions") or []
            if isinstance(conv_series, list):
                reduced = []
                for c in conv_series:
                    if isinstance(c, dict):
                        reduced.append({action_key: float(c.get(action_key) or 0)})
                    else:
                        reduced.append({})
                series["conversions"] = reduced
        out[key] = series

    # Mirror RPC behaviour: emit an empty stub for every requested key that had
    # no rows in the series window, so the frontend cache treats them as resolved
    # instead of perpetually pending.
    missing_keys = group_keys_set - out.keys()
    if missing_keys:
        axis = _series_axis_for_request(req.date_start, req.date_stop, req.window)
        for k in missing_keys:
            out[k] = _empty_series_for_axis(axis)

    return {"series_by_group": out, "window": req.window}


def _get_rankings_retention_v2(req: RankingsRetentionRequest, user: Dict[str, Any], sb) -> Dict[str, Any]:
    f = req.filters or RankingsFilters()
    data = _fetch_ad_metrics_via_rpc(
        sb,
        user["user_id"],
        req.date_start,
        req.date_stop,
        pack_ids=req.pack_ids,
        account_ids=f.adaccount_ids,
    )

    target = str(req.group_key or "")
    weighted: Dict[int, Dict[str, float]] = {}

    for r in data:
        if f.campaign_name_contains and f.campaign_name_contains.lower() not in str(r.get("campaign_name") or "").lower():
            continue
        if f.adset_name_contains and f.adset_name_contains.lower() not in str(r.get("adset_name") or "").lower():
            continue
        if f.ad_name_contains and f.ad_name_contains.lower() not in str(r.get("ad_name") or "").lower():
            continue

        key = _group_key_from_metric_row(r, req.group_by)
        if key != target:
            continue

        plays = int(r.get("video_total_plays") or 0)
        curve = r.get("video_play_curve_actions") or []
        if plays <= 0 or not isinstance(curve, list):
            continue

        for idx, val in enumerate(curve):
            try:
                numeric = float(val or 0)
            except Exception:
                numeric = 0.0
            slot = weighted.setdefault(idx, {"weighted_sum": 0.0, "plays_sum": 0.0})
            slot["weighted_sum"] += numeric * plays
            slot["plays_sum"] += plays

    if not weighted:
        return {"group_key": target, "video_play_curve_actions": []}

    max_idx = max(weighted.keys())
    curve_out: List[int] = []
    for i in range(max_idx + 1):
        slot = weighted.get(i)
        if not slot or slot["plays_sum"] <= 0:
            curve_out.append(0)
            continue
        curve_out.append(int(round(slot["weighted_sum"] / slot["plays_sum"])))

    return {"group_key": target, "video_play_curve_actions": curve_out}


def _extract_rpc_object_payload(raw_payload: Any, rpc_name: str) -> Dict[str, Any]:
    payload: Any = raw_payload
    if isinstance(payload, list):
        if len(payload) == 1 and isinstance(payload[0], dict):
            payload = payload[0]
        else:
            return {}
    if isinstance(payload, dict) and rpc_name in payload:
        payload = payload.get(rpc_name)
    return payload if isinstance(payload, dict) else {}


def _series_axis_for_request(date_start: str, date_stop: str, window: int) -> List[str]:
    full_axis = _axis_date_range(date_start, date_stop)
    w = max(1, int(window or 5))
    return full_axis[-w:] if len(full_axis) > w else full_axis


def _empty_series_for_axis(axis: List[str]) -> Dict[str, Any]:
    n = len(axis)
    return {
        "axis": axis,
        "hook": [None] * n,
        "spend": [None] * n,
        "clicks": [None] * n,
        "inline_link_clicks": [None] * n,
        "ctr": [None] * n,
        "connect_rate": [None] * n,
        "lpv": [0] * n,
        "impressions": [None] * n,
        "cpm": [None] * n,
        "cpc": [None] * n,
        "cplc": [None] * n,
        "website_ctr": [None] * n,
        "conversions": [{} for _ in axis],
        "cpmql": [None] * n,
        "mqls": [None] * n,
    }


def _get_rankings_core_v2_rpc(req: RankingsRequest, user: Dict[str, Any], sb) -> Dict[str, Any]:
    f = req.filters or RankingsFilters()
    params: Dict[str, Any] = {
        "p_user_id": user["user_id"],
        "p_date_start": req.date_start,
        "p_date_stop": req.date_stop,
        "p_group_by": req.group_by,
        "p_pack_ids": req.pack_ids,
        "p_account_ids": f.adaccount_ids,
        "p_campaign_name_contains": f.campaign_name_contains,
        "p_adset_name_contains": f.adset_name_contains,
        "p_ad_name_contains": f.ad_name_contains,
        "p_campaign_id": f.campaign_id,
        "p_action_type": req.action_type,
        "p_include_leadscore": bool(req.include_leadscore),
        "p_include_available_conversion_types": bool(req.include_available_conversion_types),
        "p_limit": max(1, int(req.limit or 500)),
        "p_offset": max(0, int(req.offset or 0)),
        "p_order_by": (req.order_by or "spend"),
    }
    rpc_result = sb.rpc("fetch_manager_rankings_core_v2", params).execute()
    return _normalize_rankings_rpc_response(rpc_result.data)


def _get_rankings_core_v2_rpc_with_retry(
    req: RankingsRequest,
    user: Dict[str, Any],
    sb,
    *,
    max_attempts: int,
) -> Dict[str, Any]:
    """Executa RPC agregada com retry curto apenas para falhas transitÃ³rias."""
    attempts = max(1, int(max_attempts or 1))
    for attempt in range(1, attempts + 1):
        try:
            return _get_rankings_core_v2_rpc(req, user, sb)
        except Exception as e:
            is_transient = _is_transient_analytics_rpc_error(e)
            is_last = attempt >= attempts
            if is_last or not is_transient:
                raise

            delay_s = min(1.0, 0.25 * attempt)
            logger.warning(
                "[rankings_cutover] aggregated_rpc_retry attempt=%s/%s delay_s=%.2f group_by=%s range=%s..%s packs=%s error=%s",
                attempt + 1,
                attempts,
                delay_s,
                req.group_by,
                req.date_start,
                req.date_stop,
                len(req.pack_ids or []),
                e,
            )
            time.sleep(delay_s)


def _get_rankings_series_v2_rpc(req: RankingsSeriesRequest, user: Dict[str, Any], sb) -> Dict[str, Any]:
    keys = [str(k) for k in (req.group_keys or []) if str(k).strip()]
    if not keys:
        return {"series_by_group": {}, "window": req.window}

    f = req.filters or RankingsFilters()
    params: Dict[str, Any] = {
        "p_user_id": user["user_id"],
        "p_date_start": req.date_start,
        "p_date_stop": req.date_stop,
        "p_group_by": req.group_by,
        "p_pack_ids": req.pack_ids,
        "p_account_ids": f.adaccount_ids,
        "p_campaign_name_contains": f.campaign_name_contains,
        "p_adset_name_contains": f.adset_name_contains,
        "p_ad_name_contains": f.ad_name_contains,
        "p_action_type": req.action_type,
        "p_group_keys": keys,
        "p_window": req.window,
    }

    rpc_result = sb.rpc("fetch_manager_rankings_series_v2", params).execute()
    payload = _extract_rpc_object_payload(rpc_result.data, "fetch_manager_rankings_series_v2")
    raw_map = payload.get("series_by_group") if isinstance(payload.get("series_by_group"), dict) else {}

    axis = _series_axis_for_request(req.date_start, req.date_stop, req.window)
    series_by_group: Dict[str, Any] = {}
    for k in keys:
        entry = raw_map.get(k)
        if isinstance(entry, dict):
            series_by_group[k] = entry
        else:
            series_by_group[k] = _empty_series_for_axis(axis)

    return {
        "series_by_group": series_by_group,
        "window": int(payload.get("window") or req.window),
    }


def _get_rankings_series_v2_rpc_with_retry(
    req: RankingsSeriesRequest,
    user: Dict[str, Any],
    sb,
    *,
    max_attempts: int,
) -> Dict[str, Any]:
    """Executes series RPC with short retry only for transient failures."""
    attempts = max(1, int(max_attempts or 1))
    for attempt in range(1, attempts + 1):
        try:
            return _get_rankings_series_v2_rpc(req, user, sb)
        except Exception as e:
            is_transient = _is_transient_analytics_rpc_error(e)
            is_last = attempt >= attempts
            if is_last or not is_transient:
                raise

            delay_s = min(1.0, 0.25 * attempt)
            logger.warning(
                "[rankings_series] rpc_retry attempt=%s/%s delay_s=%.2f group_by=%s range=%s..%s packs=%s group_keys=%s error=%s",
                attempt + 1,
                attempts,
                delay_s,
                req.group_by,
                req.date_start,
                req.date_stop,
                len(req.pack_ids or []),
                len(req.group_keys or []),
                e,
            )
            time.sleep(delay_s)


def _get_rankings_retention_v2_rpc(req: RankingsRetentionRequest, user: Dict[str, Any], sb) -> Dict[str, Any]:
    f = req.filters or RankingsFilters()
    params: Dict[str, Any] = {
        "p_user_id": user["user_id"],
        "p_date_start": req.date_start,
        "p_date_stop": req.date_stop,
        "p_group_by": req.group_by,
        "p_pack_ids": req.pack_ids,
        "p_account_ids": f.adaccount_ids,
        "p_campaign_name_contains": f.campaign_name_contains,
        "p_adset_name_contains": f.adset_name_contains,
        "p_ad_name_contains": f.ad_name_contains,
        "p_group_key": req.group_key,
    }
    rpc_result = sb.rpc("fetch_manager_rankings_retention_v2", params).execute()
    payload = _extract_rpc_object_payload(rpc_result.data, "fetch_manager_rankings_retention_v2")

    group_key = str(payload.get("group_key") or req.group_key or "")
    curve = payload.get("video_play_curve_actions")
    if not isinstance(curve, list):
        curve = []

    return {
        "group_key": group_key,
        "video_play_curve_actions": curve,
    }

def _merge_row_conversions_actions(r: Dict[str, Any], target: Dict[str, Any]) -> None:
    """Agrega conversions e actions de uma linha de ad_metrics em `target` usando chaves prefixadas.

    Chaves no target:
      - "conversion:{action_type}" para itens de r["conversions"]
      - "action:{action_type}"     para itens de r["actions"]

    Usado pelos trÃªs endpoints de children (ad-name, adset-id, campaign-id) para garantir
    um contrato uniforme de conversions consumido pelo frontend.
    """
    try:
        for c in (r.get("conversions") or []):
            action_type = str(c.get("action_type") or "")
            value = int(c.get("value") or 0)
            if action_type:
                key = f"conversion:{action_type}"
                target[key] = target.get(key, 0) + value
        for a in (r.get("actions") or []):
            action_type = str(a.get("action_type") or "")
            value = int(a.get("value") or 0)
            if action_type:
                key = f"action:{action_type}"
                target[key] = target.get(key, 0) + value
    except Exception:
        pass


def _hook_at_3_from_curve(curve: Any) -> float:
    try:
        if not isinstance(curve, list) or not curve:
            return 0.0
        v = float(curve[min(3, len(curve) - 1)] or 0)
        return v / 100.0 if v > 1 else v
    except Exception:
        return 0.0

def _get_thumbnail_with_fallback(ad_row: Dict[str, Any]) -> Optional[str]:
    """Meta CDN thumbnail fallback is disabled; callers must use Storage thumbs."""
    _ = ad_row
    return None


def _get_storage_thumb_if_any(ad_row: Dict[str, Any]) -> Optional[str]:
    """Retorna URL pÃºblica do Storage se `thumb_storage_path` existir; senÃ£o None."""
    try:
        p = str(ad_row.get("thumb_storage_path") or "").strip()
        if not p:
            return None
        return build_public_storage_url(DEFAULT_BUCKET, p)
    except Exception:
        return None


def _select_storage_thumbnail_for_group(
    rep_ad_id: Any,
    ad_ids_in_group: Any,
    storage_thumbnails_map: Dict[str, str],
) -> tuple[Optional[str], Optional[str]]:
    """Select a Storage thumbnail for an aggregated group, preferring the representative ad."""
    rep_ad_id_str = str(rep_ad_id or "").strip()
    if rep_ad_id_str:
        rep_thumb = storage_thumbnails_map.get(rep_ad_id_str)
        if rep_thumb:
            return rep_thumb, rep_ad_id_str

    try:
        ad_ids = sorted(str(ad_id or "").strip() for ad_id in (ad_ids_in_group or []) if str(ad_id or "").strip())
    except Exception:
        ad_ids = []

    for ad_id in ad_ids:
        if ad_id == rep_ad_id_str:
            continue
        thumb = storage_thumbnails_map.get(ad_id)
        if thumb:
            return thumb, ad_id

    return None, None


def _is_storage_thumbnail_url(value: Any) -> bool:
    try:
        v = str(value or "").strip()
        return "/storage/v1/object/public/" in v
    except Exception:
        return False


def _hydrate_storage_thumbnails_for_rankings_rows(
    sb,
    user_id: str,
    rows: List[Dict[str, Any]],
) -> Dict[str, int]:
    """Ensure rankings rows use Storage thumbnail URLs when available in ads.thumb_storage_path."""
    if not rows:
        return {"rows": 0, "candidates": 0, "storage_found": 0, "overridden": 0}

    candidate_ad_ids: Set[str] = set()
    for row in rows:
        ad_id = str(row.get("ad_id") or "").strip()
        if not ad_id:
            continue
        current_thumb = row.get("thumbnail")
        if _is_storage_thumbnail_url(current_thumb):
            continue
        candidate_ad_ids.add(ad_id)

    if not candidate_ad_ids:
        return {"rows": len(rows), "candidates": 0, "storage_found": 0, "overridden": 0}

    ad_id_to_storage: Dict[str, str] = {}
    batch_size = 500
    candidate_list = sorted(candidate_ad_ids)
    for i in range(0, len(candidate_list), batch_size):
        batch = candidate_list[i : i + batch_size]
        try:
            res = (
                sb.table("ads")
                .select("ad_id,thumb_storage_path")
                .eq("user_id", user_id)
                .in_("ad_id", batch)
                .execute()
            )
            for ad_row in (res.data or []):
                ad_id = str(ad_row.get("ad_id") or "").strip()
                storage_url = _get_storage_thumb_if_any(ad_row)
                if ad_id and storage_url:
                    ad_id_to_storage[ad_id] = storage_url
        except Exception as e:
            logger.warning("[rankings_cutover] failed to hydrate storage thumbnails batch=%s err=%s", len(batch), e)

    overridden = 0
    for row in rows:
        ad_id = str(row.get("ad_id") or "").strip()
        if not ad_id:
            continue
        storage_url = ad_id_to_storage.get(ad_id)
        if not storage_url:
            continue
        if row.get("thumbnail") != storage_url:
            row["thumbnail"] = storage_url
            overridden += 1

    return {
        "rows": len(rows),
        "candidates": len(candidate_ad_ids),
        "storage_found": len(ad_id_to_storage),
        "overridden": overridden,
    }


def _hydrate_transcription_flags_for_rankings_rows(
    sb,
    user_id: str,
    rows: List[Dict[str, Any]],
) -> int:
    """Set has_transcription=True on rows whose ad_name has a completed transcription."""
    if not rows:
        return 0

    ad_names: List[str] = []
    for row in rows:
        name = str(row.get("ad_name") or "").strip()
        if name:
            ad_names.append(name)

    if not ad_names:
        return 0

    unique_names = list(set(ad_names))
    completed_names: Set[str] = set()
    batch_size = 500
    for i in range(0, len(unique_names), batch_size):
        batch = unique_names[i : i + batch_size]
        try:
            res = (
                sb.table("ad_transcriptions")
                .select("ad_name")
                .eq("user_id", user_id)
                .eq("status", "completed")
                .in_("ad_name", batch)
                .execute()
            )
            for tr_row in (res.data or []):
                name = str(tr_row.get("ad_name") or "").strip()
                if name:
                    completed_names.add(name)
        except Exception as e:
            logger.warning("[rankings_transcription_hydration] batch failed batch=%s err=%s", len(batch), e)

    flagged = 0
    for row in rows:
        name = str(row.get("ad_name") or "").strip()
        if name in completed_names:
            row["has_transcription"] = True
            flagged += 1

    return flagged


GlobalSearchResultType = Literal["ad_id", "ad_name", "adset_name", "campaign_name"]


class GlobalSearchResult(BaseModel):
    type: GlobalSearchResultType
    value: str
    label: str
    # Campos auxiliares para navegaÃ§Ã£o/UX (opcionais)
    ad_id: Optional[str] = None
    ad_name: Optional[str] = None
    adset_name: Optional[str] = None
    campaign_name: Optional[str] = None


class GlobalSearchResponse(BaseModel):
    results: List[GlobalSearchResult]


@router.get("/search", response_model=GlobalSearchResponse)
def search_global(
    query: str = Query(..., min_length=1),
    limit: int = Query(20, ge=1, le=50),
    user=Depends(get_current_user),
):
    """
    Busca global para o Sidebar.

    Fonte: tabela `ads` (um registro por ad_id), mais eficiente do que `ad_metrics`.
    - ad_id: match exato
    - ad_name / adset_name / campaign_name: contains (ilike)
    """
    sb = get_supabase_for_user(user["token"])

    q = (query or "").strip()
    if not q:
        return {"results": []}

    # Regras simples para evitar queries muito amplas:
    # - contains: mÃ­nimo 2 caracteres
    # - ad_id exato: permite se parecer ID (dÃ­gitos) e for razoÃ¡vel
    q_is_digits = q.isdigit()
    can_contains = len(q) >= 2
    can_exact_id = q_is_digits and len(q) >= 3

    per_type = max(1, min(10, limit // 2 or 1))  # equilÃ­brio simples

    results: List[GlobalSearchResult] = []
    seen: set[tuple[str, str]] = set()

    def push(r: GlobalSearchResult) -> None:
        key = (r.type, r.value)
        if key in seen:
            return
        seen.add(key)
        results.append(r)

    # 1) ad_id (match exato)
    if can_exact_id:
        try:
            res = (
                sb.table("ads")
                .select("ad_id,ad_name,adset_name,campaign_name")
                .eq("user_id", user["user_id"])
                .eq("ad_id", q)
                .limit(1)
                .execute()
            )
            if res and res.data:
                row = res.data[0]
                ad_id = str(row.get("ad_id") or "").strip()
                ad_name = str(row.get("ad_name") or "").strip()
                label = ad_name if ad_name else ad_id
                push(
                    GlobalSearchResult(
                        type="ad_id",
                        value=ad_id,
                        label=label,
                        ad_id=ad_id,
                        ad_name=ad_name or None,
                        adset_name=(str(row.get("adset_name") or "").strip() or None),
                        campaign_name=(str(row.get("campaign_name") or "").strip() or None),
                    )
                )
        except Exception as e:
            logger.warning("[search_global] Falha ao buscar ad_id exato: %s", e)

    # 2) ad_name contains
    if can_contains and len(results) < limit:
        try:
            res = (
                sb.table("ads")
                .select("ad_id,ad_name")
                .eq("user_id", user["user_id"])
                .ilike("ad_name", f"%{q}%")
                .order("updated_at", desc=True)
                .limit(per_type)
                .execute()
            )
            for row in (res.data or [])[:per_type]:
                ad_name = str(row.get("ad_name") or "").strip()
                if not ad_name:
                    continue
                ad_id = str(row.get("ad_id") or "").strip() or None
                push(
                    GlobalSearchResult(
                        type="ad_name",
                        value=ad_name,
                        label=ad_name,
                        ad_id=ad_id,
                        ad_name=ad_name,
                    )
                )
        except Exception as e:
            logger.warning("[search_global] Falha ao buscar ad_name: %s", e)

    # 3) adset_name contains
    if can_contains and len(results) < limit:
        try:
            res = (
                sb.table("ads")
                .select("adset_name,ad_id,ad_name")
                .eq("user_id", user["user_id"])
                .ilike("adset_name", f"%{q}%")
                .order("updated_at", desc=True)
                .limit(per_type)
                .execute()
            )
            for row in (res.data or [])[:per_type]:
                adset_name = str(row.get("adset_name") or "").strip()
                if not adset_name:
                    continue
                push(
                    GlobalSearchResult(
                        type="adset_name",
                        value=adset_name,
                        label=adset_name,
                        ad_id=(str(row.get("ad_id") or "").strip() or None),
                        ad_name=(str(row.get("ad_name") or "").strip() or None),
                        adset_name=adset_name,
                    )
                )
        except Exception as e:
            logger.warning("[search_global] Falha ao buscar adset_name: %s", e)

    # 4) campaign_name contains
    if can_contains and len(results) < limit:
        try:
            res = (
                sb.table("ads")
                .select("campaign_name,ad_id,ad_name")
                .eq("user_id", user["user_id"])
                .ilike("campaign_name", f"%{q}%")
                .order("updated_at", desc=True)
                .limit(per_type)
                .execute()
            )
            for row in (res.data or [])[:per_type]:
                campaign_name = str(row.get("campaign_name") or "").strip()
                if not campaign_name:
                    continue
                push(
                    GlobalSearchResult(
                        type="campaign_name",
                        value=campaign_name,
                        label=campaign_name,
                        ad_id=(str(row.get("ad_id") or "").strip() or None),
                        ad_name=(str(row.get("ad_name") or "").strip() or None),
                        campaign_name=campaign_name,
                    )
                )
        except Exception as e:
            logger.warning("[search_global] Falha ao buscar campaign_name: %s", e)

    # Cap final
    if len(results) > limit:
        results = results[:limit]

    return {"results": results}


_AB_COMPARE_EPSILON = 1e-6
_AB_AVERAGE_KEYS = ("hook", "hold_rate", "scroll_stop", "ctr", "website_ctr", "connect_rate", "cpm", "cpc", "cplc")
_AB_PER_ACTION_KEYS = ("results", "cpr", "page_conv")


def _normalize_rankings_rpc_response(raw_payload: Any) -> Dict[str, Any]:
    """Normaliza payload da RPC para o contrato esperado do endpoint de rankings."""
    payload: Any = raw_payload

    if isinstance(payload, dict) and "fetch_manager_analytics_aggregated" in payload:
        payload = payload.get("fetch_manager_analytics_aggregated")
    elif isinstance(payload, dict) and "fetch_manager_rankings_core_v2" in payload:
        payload = payload.get("fetch_manager_rankings_core_v2")
    elif isinstance(payload, list):
        if len(payload) == 1 and isinstance(payload[0], dict):
            first = payload[0]
            if "fetch_manager_analytics_aggregated" in first:
                payload = first.get("fetch_manager_analytics_aggregated")
            else:
                payload = first
        else:
            payload = {"data": payload}

    if not isinstance(payload, dict):
        payload = {}

    data = payload.get("data")
    if not isinstance(data, list):
        data = []

    raw_conv = payload.get("available_conversion_types")
    available_conversion_types: List[str] = []
    if isinstance(raw_conv, list):
        available_conversion_types = [str(v) for v in raw_conv if v is not None]

    out: Dict[str, Any] = {
        "data": data,
        "available_conversion_types": available_conversion_types,
    }

    averages = payload.get("averages")
    if isinstance(averages, dict):
        out["averages"] = averages

    header_aggregates = payload.get("header_aggregates")
    if isinstance(header_aggregates, dict):
        out["header_aggregates"] = header_aggregates

    pagination = payload.get("pagination")
    if isinstance(pagination, dict):
        out["pagination"] = pagination

    return out


def _to_float_or_none(value: Any) -> Optional[float]:
    try:
        if value is None:
            return None
        return float(value)
    except Exception:
        return None


def _floats_close(a: Any, b: Any, eps: float = _AB_COMPARE_EPSILON) -> bool:
    fa = _to_float_or_none(a)
    fb = _to_float_or_none(b)
    if fa is None and fb is None:
        return True
    if fa is None or fb is None:
        return False
    return abs(fa - fb) <= eps


def _compare_rankings_payloads(primary: Dict[str, Any], shadow: Dict[str, Any], context: Dict[str, Any]) -> None:
    """Compara payload principal vs sombra e loga divergÃªncias."""
    mismatches: List[str] = []

    primary_data = primary.get("data") or []
    shadow_data = shadow.get("data") or []
    if len(primary_data) != len(shadow_data):
        mismatches.append(f"data_len:{len(primary_data)}!={len(shadow_data)}")

    primary_conv: Set[str] = set(str(v) for v in (primary.get("available_conversion_types") or []))
    shadow_conv: Set[str] = set(str(v) for v in (shadow.get("available_conversion_types") or []))
    if primary_conv != shadow_conv:
        mismatches.append("available_conversion_types")

    primary_avg = primary.get("averages") or {}
    shadow_avg = shadow.get("averages") or {}
    if isinstance(primary_avg, dict) and isinstance(shadow_avg, dict):
        for key in _AB_AVERAGE_KEYS:
            if not _floats_close(primary_avg.get(key), shadow_avg.get(key)):
                mismatches.append(f"averages.{key}:{primary_avg.get(key)}!={shadow_avg.get(key)}")

        primary_per = primary_avg.get("per_action_type") or {}
        shadow_per = shadow_avg.get("per_action_type") or {}
        if isinstance(primary_per, dict) and isinstance(shadow_per, dict):
            action_keys: Set[str] = set(str(k) for k in primary_per.keys()) | set(str(k) for k in shadow_per.keys())
            for action_key in sorted(action_keys):
                p_entry = primary_per.get(action_key) if isinstance(primary_per.get(action_key), dict) else {}
                s_entry = shadow_per.get(action_key) if isinstance(shadow_per.get(action_key), dict) else {}
                for metric_key in _AB_PER_ACTION_KEYS:
                    if not _floats_close(p_entry.get(metric_key), s_entry.get(metric_key)):
                        mismatches.append(
                            f"averages.per_action_type[{action_key}].{metric_key}:{p_entry.get(metric_key)}!={s_entry.get(metric_key)}"
                        )

    if mismatches:
        logger.warning(
            "[rankings_ab] divergence_detected count=%s context=%s mismatches=%s",
            len(mismatches),
            context,
            mismatches[:40],
        )


def _should_sample_ab_compare() -> bool:
    if not ANALYTICS_MANAGER_RPC_AB_COMPARE_ENABLED:
        return False
    return random.random() < ANALYTICS_MANAGER_RPC_AB_SAMPLE_RATE


def _run_rankings_ab_shadow(req: Any, user: Dict[str, Any], primary_payload: Dict[str, Any], context: Dict[str, Any]) -> None:
    """Shadow A/B comparison — runs as a background task so it never blocks the HTTP response."""
    try:
        sb_bg = _get_analytics_supabase(user["token"])
        shadow_started = time.perf_counter()
        mql_leadscore_min = _get_user_mql_leadscore_min(sb_bg, str(user["user_id"]))
        shadow = _get_rankings_legacy(req, user, sb_bg, mql_leadscore_min)
        shadow_elapsed_ms = (time.perf_counter() - shadow_started) * 1000.0
        _compare_rankings_payloads(primary_payload, shadow, context)
        logger.info(
            "[rankings_ab] compare_done shadow_elapsed_ms=%.2f context=%s",
            shadow_elapsed_ms,
            context,
        )
    except Exception as e:
        logger.exception("[rankings_ab] compare_failed context=%s error=%s", context, e)


def _get_rankings_via_aggregated_rpc(sb, req: RankingsRequest, user_id: str) -> Dict[str, Any]:
    """Executa RPC agregada do Manager e retorna payload no contrato de rankings."""
    f = req.filters or RankingsFilters()
    params: Dict[str, Any] = {
        "p_user_id": user_id,
        "p_date_start": req.date_start,
        "p_date_stop": req.date_stop,
        "p_group_by": req.group_by,
        "p_pack_ids": req.pack_ids,
        "p_account_ids": f.adaccount_ids,
        "p_campaign_name_contains": f.campaign_name_contains,
        "p_adset_name_contains": f.adset_name_contains,
        "p_ad_name_contains": f.ad_name_contains,
        "p_include_series": bool(req.include_series),
        "p_include_leadscore": bool(req.include_leadscore),
        "p_series_window": req.series_window if (req.series_window and req.series_window > 0) else 5,
        "p_limit": max(1, int(req.limit or 500)),
        "p_order_by": (req.order_by or "spend"),
    }
    rpc_result = sb.rpc("fetch_manager_analytics_aggregated", params).execute()
    return _normalize_rankings_rpc_response(rpc_result.data)


def _get_rankings_legacy(req: RankingsRequest, user: Dict[str, Any], sb, mql_leadscore_min: float):
    # NOVO: Se pack_ids estiver vazio ou None, retornar resposta vazia
    if not req.pack_ids or len(req.pack_ids) == 0:
        return {
            "data": [],
            "available_conversion_types": [],
        }

    full_start = req.date_start
    full_stop = req.date_stop

    # Normalizar intervalo invertido (defensivo) e gerar eixo base no range solicitado.
    # Quando series_window Ã© fornecido, recorta para os Ãºltimos N dias.
    # Sem series_window, mantÃ©m compatibilidade histÃ³rica: atÃ© 5 dias.
    try:
        start_dt = _to_date(full_start)
        stop_dt = _to_date(full_stop)
        if stop_dt < start_dt:
            full_start, full_stop = full_stop, full_start
            start_dt, stop_dt = stop_dt, start_dt
    except Exception:
        # Se houver formato inesperado, segue com os valores recebidos.
        pass

    axis_full = _axis_date_range(full_start, full_stop)
    if req.series_window and req.series_window > 0:
        axis = axis_full[-req.series_window:]
    else:
        axis = axis_full[-5:] if len(axis_full) > 5 else axis_full

    # Buscar linhas diÃ¡rias no perÃ­odo completo (para totais) e na janela de 5 dias (para sÃ©ries)
    # Para simplificar, trazemos toda a janela completa (full) e processamos em memÃ³ria.
    # RLS garante que apenas dados do usuÃ¡rio sÃ£o retornados
    # Usar paginaÃ§Ã£o para contornar limite de 1000 linhas do Supabase
    f = req.filters or RankingsFilters()

    data = _fetch_ad_metrics_via_rpc(
        sb, user["user_id"], full_start, full_stop,
        pack_ids=req.pack_ids,
        account_ids=f.adaccount_ids,
    )
    # Filtros por contains serÃ£o aplicados em memÃ³ria (pode-se otimizar com ilike + expressÃµes geradas futuramente)

    # Extrair tipos Ãºnicos de conversÃ£o e actions de todos os dados
    available_conversion_types = set()
    for r in data:
        # Extrair de conversions
        conversions = r.get("conversions") or []
        if isinstance(conversions, list):
            for conv in conversions:
                if isinstance(conv, dict):
                    action_type = conv.get("action_type")
                    if action_type:
                        # Prefixar com categoria para diferenciar origem
                        available_conversion_types.add(f"conversion:{str(action_type)}")
        
        # Extrair de actions
        actions = r.get("actions") or []
        if isinstance(actions, list):
            for action in actions:
                if isinstance(action, dict):
                    action_type = action.get("action_type")
                    if action_type:
                        # Prefixar com categoria para diferenciar origem
                        available_conversion_types.add(f"action:{str(action_type)}")
    
    available_conversion_types = sorted(list(available_conversion_types))

    def name_ok(val: Optional[str], needle: Optional[str]) -> bool:
        if not needle:
            return True
        v = (val or "").lower()
        return needle.lower() in v

    rows: List[Dict[str, Any]] = [r for r in data if name_ok(r.get("campaign_name"), f.campaign_name_contains) and name_ok(r.get("adset_name"), f.adset_name_contains) and name_ok(r.get("ad_name"), f.ad_name_contains)]

    # Agregar por chave (req.group_by)
    from collections import defaultdict

    agg: Dict[str, Dict[str, Any]] = {}
    series_acc: Dict[str, Dict[str, Any]] = defaultdict(lambda: {
        "impressions": {d: 0 for d in axis},
        "clicks": {d: 0 for d in axis},
        "inline": {d: 0 for d in axis},
        "spend": {d: 0 for d in axis},
        "plays": {d: 0 for d in axis},
        "lpv": {d: 0 for d in axis},
        "hook_wsum": {d: 0.0 for d in axis},
        "scroll_stop_wsum": {d: 0.0 for d in axis},
        "hold_rate_wsum": {d: 0.0 for d in axis},
        "video_watched_p50_wsum": {d: 0.0 for d in axis},
        "conversions": {d: {} for d in axis},  # conversions por dia: {date: {action_type: value}}
        "mql_count": {d: 0 for d in axis},  # MQLs por dia (a partir de leadscore_values)
    })

    for r in rows:
        ad_id = str(r.get("ad_id") or "")
        ad_name = str(r.get("ad_name") or "")
        campaign_id = str(r.get("campaign_id") or "")
        campaign_name = str(r.get("campaign_name") or "")
        adset_id = str(r.get("adset_id") or "")
        adset_name = str(r.get("adset_name") or "")

        # REMOVER FALLBACK: Usar apenas o identificador correto para cada group_by
        if req.group_by == "ad_name":
            key = ad_name or ad_id  # Fallback OK aqui (ad_name pode ser vazio em casos raros)
        elif req.group_by == "campaign_id":
            # NOVO: ValidaÃ§Ã£o rigorosa
            if not campaign_id:
                logger.error(f"[rankings] campaign_id ausente em ad_metrics: ad_id={ad_id}, date={r.get('date')}")
                raise HTTPException(
                    status_code=500,
                    detail=f"Dados inconsistentes: campaign_id ausente em ad_metrics (ad_id={ad_id}, date={r.get('date')})"
                )
            key = campaign_id
        elif req.group_by == "adset_id":
            # NOVO: ValidaÃ§Ã£o rigorosa
            if not adset_id:
                logger.error(f"[rankings] adset_id ausente em ad_metrics: ad_id={ad_id}, date={r.get('date')}")
                raise HTTPException(
                    status_code=500,
                    detail=f"Dados inconsistentes: adset_id ausente em ad_metrics (ad_id={ad_id}, date={r.get('date')})"
                )
            key = adset_id
        else:
            key = ad_id
        # Preservar key original para usar em series_acc (nÃ£o pode ser sobrescrita)
        series_key = key

        # Extrair e normalizar data de forma robusta
        date_raw = r.get("date")
        if date_raw is None:
            continue
        
        # Normalizar para string YYYY-MM-DD
        if isinstance(date_raw, str):
            date = date_raw[:10] if len(date_raw) >= 10 else date_raw
        elif hasattr(date_raw, 'strftime'):
            # Se for objeto date/datetime do Python
            date = date_raw.strftime("%Y-%m-%d")
        else:
            # Tentar converter para string e pegar primeiros 10 caracteres
            date = str(date_raw)[:10]
        
        # Validar formato (deve ser YYYY-MM-DD)
        if len(date) != 10 or date[4] != '-' or date[7] != '-':
            continue

        clicks = int(r.get("clicks") or 0)
        impressions = int(r.get("impressions") or 0)
        inline_link_clicks = int(r.get("inline_link_clicks") or 0)
        spend = float(r.get("spend") or 0)
        plays = int(r.get("video_total_plays") or 0)
        thruplays = int(r.get("video_total_thruplays") or 0)
        curve = r.get("video_play_curve_actions") or []
        hook = _hook_at_3_from_curve(curve)
        video_watched_p50 = int(r.get("video_watched_p50") or 0)
        hold_rate = float(r.get("hold_rate") or 0)
        _ss_raw = float(r.get("scroll_stop_value") or r.get("scroll_stop_rate") or 0)
        scroll_stop = _ss_raw / 100.0 if _ss_raw > 1 else _ss_raw
        reach = int(r.get("reach") or 0)
        frequency = float(r.get("frequency") or 0)
        leadscore_values = r.get("leadscore_values") or []

        # landing_page_views (preferir coluna lpv quando disponÃ­vel)
        lpv = _extract_lpv(r)

        # Totais por chave (ao longo do full range)
        if key not in agg:
            agg[key] = {
                "account_id": r.get("account_id"),
                "campaign_id": r.get("campaign_id") if req.group_by != "campaign_id" else (campaign_id or None),
                "campaign_name": r.get("campaign_name") if req.group_by != "campaign_id" else (campaign_name or None),
                # No agrupamento por campanha, nÃ£o faz sentido fixar um adset/campaign secundÃ¡rio representativo
                "adset_id": r.get("adset_id") if req.group_by != "campaign_id" else None,
                "adset_name": r.get("adset_name") if req.group_by != "campaign_id" else None,
                # Manter um ad_id representativo (pelo maior impressions) para thumbnail e compatibilidade
                "rep_ad_id": ad_id,
                "rep_impr": 0,
                # Compat: o frontend historicamente usa ad_name como label principal
                "ad_name": (
                    (campaign_name or campaign_id)
                    if req.group_by == "campaign_id"
                    else ((adset_name or adset_id) if req.group_by == "adset_id" else ad_name)
                ),
                "impressions": 0,
                "clicks": 0,
                "inline_link_clicks": 0,
                "spend": 0.0,
                "lpv": 0,
                "plays": 0,
                "thruplays": 0,  # Total de thruplays agregado
                "hook_wsum": 0.0,
                "hold_rate_wsum": 0.0,  # Soma ponderada de hold_rate
                "video_watched_p50_wsum": 0.0,  # Soma ponderada de video_watched_p50
                "reach": 0,
                "frequency_wsum": 0.0,  # Soma ponderada de frequency (por impressions)
                "leadscore_values": [],  # Array agregado de todos os leadscore_values
                # Curva de retenÃ§Ã£o agregada (ponderada por plays)
                "curve_weighted": {},  # {segundo_index: {"weighted_sum": float, "plays_sum": int}}
                # Conjunto de ad_ids distintos para calcular ad_scale
                "ad_ids": set(),
                # Conjunto de adset_ids distintos (Ãºtil para agrupamento por campanha)
                "adset_ids": set(),
                # ad_count (antigo) deixa de ser usado para pais; manteremos preenchimento ao final
                "ad_count": 0,
                "thumbnail": None,
                "conversions": {},  # Agregar conversions por action_type
            }
        A = agg[key]
        A["impressions"] += impressions
        A["clicks"] += clicks
        A["inline_link_clicks"] += inline_link_clicks
        A["spend"] += spend
        A["lpv"] += lpv
        A["plays"] += plays
        A["thruplays"] += thruplays
        A["hook_wsum"] += hook * plays
        A["hold_rate_wsum"] += hold_rate * plays  # Agregar hold_rate ponderado por plays
        A["video_watched_p50_wsum"] += video_watched_p50 * plays  # Agregar video_watched_p50 ponderado por plays
        A["reach"] += reach  # Agregar reach (soma simples)
        A["frequency_wsum"] += frequency * impressions  # Agregar frequency ponderado por impressions
        # Agregar leadscore_values (juntar arrays)
        if isinstance(leadscore_values, list) and len(leadscore_values) > 0:
            try:
                A["leadscore_values"].extend([float(v) for v in leadscore_values if v is not None])
            except Exception:
                pass
        
        # Agregar curva de retenÃ§Ã£o ponderada por plays (mesma lÃ³gica do hook)
        if isinstance(curve, list) and plays > 0:
            try:
                for i, val in enumerate(curve):
                    val_num = int(val or 0)
                    if i not in A["curve_weighted"]:
                        A["curve_weighted"][i] = {"weighted_sum": 0.0, "plays_sum": 0}
                    A["curve_weighted"][i]["weighted_sum"] += val_num * plays
                    A["curve_weighted"][i]["plays_sum"] += plays
            except Exception:
                pass
        
        # Registrar ad_id distinto
        if ad_id:
            try:
                A["ad_ids"].add(ad_id)
            except Exception:
                pass

        # Registrar adset_id distinto (para agrupamento por campanha)
        if adset_id:
            try:
                A["adset_ids"].add(adset_id)
            except Exception:
                pass
        # Atualizar ad_id representativo pelo maior impressions
        try:
            if impressions >= int(A.get("rep_impr") or 0):
                A["rep_impr"] = impressions
                if ad_id:
                    A["rep_ad_id"] = ad_id
        except Exception:
            pass
        
        # Agregar conversions e actions por action_type (com prefixos para diferenciar)
        try:
            # Processar conversions
            for c in (r.get("conversions") or []):
                action_type = str(c.get("action_type") or "")
                value = int(c.get("value") or 0)
                if action_type:
                    conv_key = f"conversion:{action_type}"
                    if conv_key not in A["conversions"]:
                        A["conversions"][conv_key] = 0
                    A["conversions"][conv_key] += value
            
            # Processar actions
            for a in (r.get("actions") or []):
                action_type = str(a.get("action_type") or "")
                value = int(a.get("value") or 0)
                if action_type:
                    action_key = f"action:{action_type}"
                    if action_key not in A["conversions"]:
                        A["conversions"][action_key] = 0
                    A["conversions"][action_key] += value
        except Exception:
            pass

        # SÃ©rie 5 dias
        if date in axis:
            S = series_acc[series_key]
            
            S["impressions"][date] += impressions
            S["clicks"][date] += clicks
            S["inline"][date] += inline_link_clicks
            S["spend"][date] += spend
            S["lpv"][date] += lpv
            S["plays"][date] += plays
            S["hook_wsum"][date] += hook * plays
            S["scroll_stop_wsum"][date] += scroll_stop * plays
            S["hold_rate_wsum"][date] += hold_rate * plays
            S["video_watched_p50_wsum"][date] += video_watched_p50 * plays
            # MQLs por dia
            try:
                S["mql_count"][date] += _count_mql(leadscore_values, mql_leadscore_min)
            except Exception:
                pass

            # Agregar conversions e actions por dia
            try:
                # Processar conversions
                for c in (r.get("conversions") or []):
                    action_type = str(c.get("action_type") or "")
                    value = int(c.get("value") or 0)
                    if action_type:
                        conv_key = f"conversion:{action_type}"
                        if conv_key not in S["conversions"][date]:
                            S["conversions"][date][conv_key] = 0
                        S["conversions"][date][conv_key] += value
                
                # Processar actions
                for a in (r.get("actions") or []):
                    action_type = str(a.get("action_type") or "")
                    value = int(a.get("value") or 0)
                    if action_type:
                        action_key = f"action:{action_type}"
                        if action_key not in S["conversions"][date]:
                            S["conversions"][date][action_key] = 0
                        S["conversions"][date][action_key] += value
            except Exception:
                pass

    # Buscar thumbnails da tabela ads (usar ad_id representativo por ad_name)
    # TambÃ©m buscar todos os ad_ids do grupo para verificar se hÃ¡ pelo menos um ACTIVE
    ad_ids_in_results = set()
    for A in agg.values():
        rep_ad_id = A.get("rep_ad_id")
        if rep_ad_id:
            ad_ids_in_results.add(str(rep_ad_id))  # Garantir string
        # Adicionar TODOS os ad_ids do grupo para verificar status
        ad_ids_set = A.get("ad_ids") or set()
        for ad_id_in_group in ad_ids_set:
            ad_ids_in_results.add(str(ad_id_in_group))
    
    thumbnails_map: Dict[str, Optional[str]] = {}
    storage_thumbnails_map: Dict[str, str] = {}  # ad_id -> Storage URL (apenas quando thumb_storage_path existe)
    adcreatives_map: Dict[str, Optional[List[str]]] = {}  # Map para adcreatives_videos_thumbs
    effective_status_map: Dict[str, Optional[str]] = {}  # Map para effective_status
    if ad_ids_in_results:
        try:
            # Processar ad_ids em lotes para evitar URLs muito longas
            # Limite conservador: 500 IDs por lote (ajustado para evitar erro 400 do Supabase)
            batch_size = 500
            ad_ids_list = list(ad_ids_in_results)
            all_ads_rows = []
            
            for i in range(0, len(ad_ids_list), batch_size):
                batch_ad_ids = ad_ids_list[i:i + batch_size]
                
                def ads_filters(q):
                    return q.eq("user_id", user["user_id"]).in_("ad_id", batch_ad_ids)
                
                batch_ads_rows = _fetch_all_paginated(
                    sb,
                    "ads",
                    "ad_id,thumb_storage_path,thumbnail_url,adcreatives_videos_thumbs,effective_status",
                    ads_filters
                )
                
                all_ads_rows.extend(batch_ads_rows)
            
            for ad_row in all_ads_rows:
                ad_id_val = str(ad_row.get("ad_id") or "")
                storage_thumb = _get_storage_thumb_if_any(ad_row)
                thumb = storage_thumb or _get_thumbnail_with_fallback(ad_row)
                adcreatives = ad_row.get("adcreatives_videos_thumbs")
                effective_status = ad_row.get("effective_status")
                if ad_id_val:
                    thumbnails_map[ad_id_val] = thumb
                    if storage_thumb:
                        storage_thumbnails_map[ad_id_val] = storage_thumb
                    effective_status_map[ad_id_val] = effective_status
                    # Armazenar array completo de adcreatives_videos_thumbs
                    if isinstance(adcreatives, list) and len(adcreatives) > 0:
                        # Filtrar valores vÃ¡lidos (nÃ£o vazios)
                        valid_thumbs = [str(t) for t in adcreatives if t and str(t).strip()]
                        adcreatives_map[ad_id_val] = valid_thumbs if valid_thumbs else None
                    else:
                        adcreatives_map[ad_id_val] = None
        except Exception as e:
            logger.warning(f"Erro ao buscar thumbnails: {e}")

    # Finalizar mÃ©tricas derivadas e montar sÃ©ries
    items: List[Dict[str, Any]] = []
    key_index = 0
    for key, A in agg.items():
        key_index += 1
        ctr = _safe_div(A["clicks"], A["impressions"])
        connect_rate = _safe_div(A["lpv"], A["inline_link_clicks"])
        hook = _safe_div(A["hook_wsum"], A["plays"]) if A["plays"] else 0
        hold_rate = _safe_div(A["hold_rate_wsum"], A["plays"]) if A["plays"] else 0
        video_watched_p50 = _safe_div(A["video_watched_p50_wsum"], A["plays"]) if A["plays"] else 0
        cpm = (_safe_div(A["spend"], A["impressions"]) * 1000.0) if A["impressions"] else 0
        cpc = _safe_div(A["spend"], A["clicks"]) if A["clicks"] else None
        cplc = _safe_div(A["spend"], A["inline_link_clicks"]) if A["inline_link_clicks"] else None
        website_ctr = _safe_div(A["inline_link_clicks"], A["impressions"]) if A["impressions"] else 0
        # results, cpr e page_conv serÃ£o calculados no frontend baseado no action_type selecionado

        # Buscar thumbnail, adcreatives_videos_thumbs e effective_status do map usando rep_ad_id
        ad_id_for_thumb = A.get("rep_ad_id")
        ad_id_str = str(ad_id_for_thumb or "") if ad_id_for_thumb else ""

        # Prioridade 1: Storage URL do rep_ad_id; se ele estiver sem cache, usar
        # outro ad_id do mesmo grupo jÃ¡ carregado evita placeholder em linhas agregadas.
        ad_ids_in_group = A.get("ad_ids") or set()
        thumbnail, thumbnail_source_ad_id = _select_storage_thumbnail_for_group(
            ad_id_for_thumb,
            ad_ids_in_group,
            storage_thumbnails_map,
        )
        if thumbnail and thumbnail_source_ad_id and thumbnail_source_ad_id != ad_id_str:
            logger.warning(
                "[ANALYTICS_THUMBNAIL] rep_ad_id sem thumb Storage; usando sibling "
                "group_by=%s ad_name=%s rep_ad_id=%s source_ad_id=%s pack_ids=%s",
                req.group_by,
                A.get("ad_name"),
                ad_id_str,
                thumbnail_source_ad_id,
                req.pack_ids,
            )
        adcreatives_thumbs = adcreatives_map.get(ad_id_str) if ad_id_str else None

        if not thumbnail:
            thumbnail = thumbnails_map.get(ad_id_str) if ad_id_str else None
        
        # NOVA LÃ“GICA: Verificar se hÃ¡ pelo menos um ad_id com effective_status = 'ACTIVE' no grupo
        # Se houver, usar 'ACTIVE' como status do grupo (indica que pelo menos um anÃºncio estÃ¡ rodando)
        effective_status = None
        has_active = False
        
        # Verificar todos os ad_ids do grupo e contar ativos (para active_count)
        active_count = 0
        for ad_id_in_group in ad_ids_in_group:
            ad_id_group_str = str(ad_id_in_group)
            status = effective_status_map.get(ad_id_group_str)
            if status and str(status).upper() == "ACTIVE":
                has_active = True
                effective_status = "ACTIVE"
                active_count += 1
        if not has_active:
            effective_status = effective_status_map.get(ad_id_str) if ad_id_str else None
            # Se ainda nÃ£o tiver, tentar pegar o primeiro status disponÃ­vel do grupo
            if not effective_status:
                for ad_id_in_group in ad_ids_in_group:
                    ad_id_group_str = str(ad_id_in_group)
                    status = effective_status_map.get(ad_id_group_str)
                    if status:
                        effective_status = status
                        break
        
        # Fallback: buscar diretamente na tabela se nÃ£o encontrar no map
        if not thumbnail and ad_id_str:
            try:
                fallback_res = sb.table("ads").select("ad_id,thumb_storage_path,thumbnail_url,adcreatives_videos_thumbs,effective_status").eq("user_id", user["user_id"]).eq("ad_id", ad_id_str).limit(1).execute()
                if fallback_res.data and len(fallback_res.data) > 0:
                    fallback_row = fallback_res.data[0]
                    thumbnail = _get_storage_thumb_if_any(fallback_row) or _get_thumbnail_with_fallback(fallback_row)
                    # Atualizar effective_status apenas se ainda nÃ£o foi definido
                    if not effective_status:
                        effective_status = fallback_row.get("effective_status")
                    # TambÃ©m buscar adcreatives_videos_thumbs no fallback
                    fallback_adcreatives = fallback_row.get("adcreatives_videos_thumbs")
                    if isinstance(fallback_adcreatives, list) and len(fallback_adcreatives) > 0:
                        valid_thumbs = [str(t) for t in fallback_adcreatives if t and str(t).strip()]
                        adcreatives_thumbs = valid_thumbs if valid_thumbs else None
            except Exception as e:
                pass

        S = series_acc.get(key)
        # Recortar axis para Ãºltimos N dias quando series_window definido (reduz payload ~92%)
        series_axis = axis[-req.series_window:] if (req.series_window and req.series_window < len(axis)) else axis
        series = _build_rankings_series(series_axis, S, include_cpmql=True) if (S and req.include_series) else None

        # Calcular ad_scale e preencher ad_count:
        # - por campanha: quantidade de adsets distintos
        # - demais: quantidade de ads distintos
        ad_scale = 0
        try:
            if req.group_by == "campaign_id":
                ad_scale = len(A.get("adset_ids") or [])
            else:
                ad_scale = len(A.get("ad_ids") or [])
        except Exception:
            ad_scale = 0

        # Calcular curva de retenÃ§Ã£o agregada (mÃ©dia ponderada por plays)
        aggregated_curve: List[int] = []
        if A.get("curve_weighted"):
            max_curve_len = max(A["curve_weighted"].keys()) + 1 if A["curve_weighted"] else 0
            for i in range(max_curve_len):
                if i in A["curve_weighted"]:
                    w = A["curve_weighted"][i]
                    if w["plays_sum"] > 0:
                        aggregated_curve.append(int(round(w["weighted_sum"] / w["plays_sum"])))
                    else:
                        aggregated_curve.append(0)
                else:
                    aggregated_curve.append(0)

        # Calcular frequency agregado (mÃ©dia ponderada por impressions)
        frequency_agg = _safe_div(A["frequency_wsum"], A["impressions"]) if A["impressions"] else 0
        
        items.append({
            "unique_id": None,
            "account_id": A.get("account_id"),
            "campaign_id": A.get("campaign_id"),
            "campaign_name": A.get("campaign_name"),
            "adset_id": A.get("adset_id"),
            "adset_name": A.get("adset_name"),
            # Devolver rep_ad_id para facilitar thumb e aÃ§Ãµes no frontend
            "ad_id": A.get("rep_ad_id"),
            "ad_name": A.get("ad_name"),
            "effective_status": effective_status,
            "active_count": active_count if req.group_by != "campaign_id" else None,
            "impressions": A["impressions"],
            "clicks": A["clicks"],
            "inline_link_clicks": A["inline_link_clicks"],
            "spend": A["spend"],
            "lpv": A["lpv"],
            "plays": A["plays"],
            "video_total_thruplays": A["thruplays"],
            "hook": hook,
            "hold_rate": hold_rate,
            "video_watched_p50": int(round(video_watched_p50)) if video_watched_p50 else 0,
            "ctr": ctr,
            "connect_rate": connect_rate,
            "cpm": cpm,
            "cpc": cpc,
            "cplc": cplc,
            "website_ctr": website_ctr,
            "reach": A["reach"],
            "frequency": frequency_agg,
            "leadscore_values": (A.get("leadscore_values") or []) if req.include_leadscore else [],  # Array agregado de leadscore_values
            "conversions": A.get("conversions", {}),  # {action_type: total_value} para o frontend calcular results/cpr/page_conv
            "ad_count": ad_scale,
            "thumbnail": thumbnail,
            "adcreatives_videos_thumbs": adcreatives_thumbs,  # Array completo de thumbnails dos vÃ­deos
            "video_play_curve_actions": aggregated_curve if aggregated_curve else None,
            "series": series,
        })

    # Calcular mÃ©dias globais (antes de ordenar/limitar), incluindo por action_type
    # TambÃ©m calcular mÃ©dias de retenÃ§Ã£o (hook no Ã­ndice 3 e scroll stop no Ã­ndice 1)
    total_spend = 0.0
    total_impr = 0
    total_clicks = 0
    total_inline = 0
    total_lpv = 0
    total_plays = 0
    total_hook_wsum = 0.0
    total_hold_rate_wsum = 0.0  # Soma ponderada de hold_rate
    total_video_watched_p50_wsum = 0.0  # Soma ponderada de video_watched_p50
    total_scroll_stop_wsum = 0.0  # Soma ponderada para Ã­ndice 1 (scroll stop)

    # results por action_type
    per_action_results: Dict[str, int] = {t: 0 for t in available_conversion_types}

    for A in agg.values():
        total_spend += float(A.get("spend") or 0)
        total_impr += int(A.get("impressions") or 0)
        total_clicks += int(A.get("clicks") or 0)
        total_inline += int(A.get("inline_link_clicks") or 0)
        total_lpv += int(A.get("lpv") or 0)
        total_plays += int(A.get("plays") or 0)
        total_hook_wsum += float(A.get("hook_wsum") or 0.0)
        total_hold_rate_wsum += float(A.get("hold_rate_wsum") or 0.0)
        total_video_watched_p50_wsum += float(A.get("video_watched_p50_wsum") or 0.0)

        # Calcular scroll stop (Ã­ndice 1) ponderado por plays
        # Pegar a curva agregada do item para extrair o valor no Ã­ndice 1
        # A curva vem em porcentagem (0-100), entÃ£o normalizamos para decimal (0-1) como o hook
        curve_weighted = A.get("curve_weighted") or {}
        if 1 in curve_weighted:
            w = curve_weighted[1]
            plays_for_item = int(A.get("plays") or 0)
            if w.get("plays_sum", 0) > 0 and plays_for_item > 0:
                scroll_stop_raw = w["weighted_sum"] / w["plays_sum"]
                # Normalizar: se valor > 1, assume que estÃ¡ em porcentagem e divide por 100
                scroll_stop_val = scroll_stop_raw / 100.0 if scroll_stop_raw > 1 else scroll_stop_raw
                total_scroll_stop_wsum += scroll_stop_val * plays_for_item

        convs = A.get("conversions") or {}
        if isinstance(convs, dict):
            for t in available_conversion_types:
                try:
                    per_action_results[t] += int(convs.get(t) or 0)
                except Exception:
                    pass

    averages_base = {
        "hook": _safe_div(total_hook_wsum, total_plays) if total_plays else 0,
        "hold_rate": _safe_div(total_hold_rate_wsum, total_plays) if total_plays else 0,
        "video_watched_p50": _safe_div(total_video_watched_p50_wsum, total_plays) if total_plays else 0,
        "scroll_stop": _safe_div(total_scroll_stop_wsum, total_plays) if total_plays else 0,
        "ctr": _safe_div(total_clicks, total_impr) if total_impr else 0,
        "website_ctr": _safe_div(total_inline, total_impr) if total_impr else 0,
        "connect_rate": _safe_div(total_lpv, total_inline) if total_inline else 0,
        "cpm": (_safe_div(total_spend, total_impr) * 1000.0) if total_impr else 0,
        "cpc": _safe_div(total_spend, total_clicks) if total_clicks else 0,
        "cplc": _safe_div(total_spend, total_inline) if total_inline else 0,
    }

    per_action_type: Dict[str, Dict[str, float]] = {}
    for t in available_conversion_types:
        res_total = per_action_results.get(t, 0)
        cpr_val = _safe_div(total_spend, res_total) if res_total else 0
        page_conv_val = _safe_div(res_total, total_lpv) if total_lpv else 0
        per_action_type[t] = {
            "results": float(res_total),
            "cpr": cpr_val,
            "page_conv": page_conv_val,
        }

    averages_payload = {
        **averages_base,
        "per_action_type": per_action_type,
    }

    # OrdenaÃ§Ã£o opcional
    order = (req.order_by or "").lower()
    if order in {"hook", "hold_rate", "cpr", "cpc", "cplc", "spend", "ctr", "connect_rate", "page_conv"}:
        reverse = order not in {"cpr", "cpc", "cplc"}  # custo menor Ã© melhor; os demais maior Ã© melhor
        items.sort(key=lambda x: (x.get(order) or 0), reverse=reverse)

    return {
        "data": items[: max(1, req.limit)],
        "available_conversion_types": available_conversion_types,
        "averages": averages_payload,
    }


@router.post("/rankings")
@router.post("/ad-performance")
def get_rankings(req: RankingsRequest, background_tasks: BackgroundTasks, user=Depends(get_current_user)):
    sb = _get_analytics_supabase(user["token"])
    user_id = str(user["user_id"])

    # Se pack_ids estiver vazio ou None, manter contrato legado (sem averages).
    if not req.pack_ids or len(req.pack_ids) == 0:
        return {
            "data": [],
            "available_conversion_types": [],
        }

    if not ANALYTICS_MANAGER_RPC_ENABLED:
        mql_leadscore_min = _get_user_mql_leadscore_min(sb, user_id)
        return _get_rankings_core_v2(req, user, sb, mql_leadscore_min)

    started_at = time.perf_counter()
    logger.info(
        "[rankings_cutover] request_start group_by=%s range=%s..%s packs=%s include_series=%s include_leadscore=%s limit=%s offset=%s",
        req.group_by,
        req.date_start,
        req.date_stop,
        len(req.pack_ids or []),
        bool(req.include_series),
        bool(req.include_leadscore),
        int(req.limit or 0),
        int(req.offset or 0),
    )
    try:
        max_rpc_attempts = 2 if req.group_by == "ad_id" else 1
        primary = _get_rankings_core_v2_rpc_with_retry(
            req,
            user,
            sb,
            max_attempts=max_rpc_attempts,
        )
    except Exception as e:
        elapsed_ms = (time.perf_counter() - started_at) * 1000.0
        if ANALYTICS_MANAGER_RPC_FAIL_OPEN:
            logger.exception(
                "[rankings_cutover] aggregated_rpc_failed fallback_legacy=true elapsed_ms=%.2f group_by=%s range=%s..%s packs=%s error=%s",
                elapsed_ms,
                req.group_by,
                req.date_start,
                req.date_stop,
                len(req.pack_ids or []),
                e,
            )
            mql_leadscore_min = _get_user_mql_leadscore_min(sb, user_id)
            return _get_rankings_core_v2(req, user, sb, mql_leadscore_min)
        logger.exception(
            "[rankings_cutover] aggregated_rpc_failed fallback_legacy=false elapsed_ms=%.2f group_by=%s range=%s..%s packs=%s error=%s",
            elapsed_ms,
            req.group_by,
            req.date_start,
            req.date_stop,
            len(req.pack_ids or []),
            e,
        )
        raise HTTPException(status_code=500, detail="Erro ao consultar analytics agregados.")

    elapsed_ms = (time.perf_counter() - started_at) * 1000.0
    hydration_stats = _hydrate_storage_thumbnails_for_rankings_rows(
        sb=sb,
        user_id=user_id,
        rows=primary.get("data") or [],
    )
    transcription_flagged = _hydrate_transcription_flags_for_rankings_rows(
        sb=sb,
        user_id=user_id,
        rows=primary.get("data") or [],
    )
    logger.info(
        "[rankings_cutover] aggregated_rpc_success elapsed_ms=%.2f group_by=%s range=%s..%s packs=%s rows=%s hydrated=%s transcription_flagged=%s",
        elapsed_ms,
        req.group_by,
        req.date_start,
        req.date_stop,
        len(req.pack_ids or []),
        len(primary.get("data") or []),
        hydration_stats,
        transcription_flagged,
    )

    # Compare apenas quando pedimos conversion types completos para reduzir ruído
    # (nas abas secundárias usamos payload reduzido focado no action_type selecionado).
    # Roda como background task para não bloquear a resposta HTTP.
    if _should_sample_ab_compare() and bool(req.include_available_conversion_types):
        context = {
            "group_by": req.group_by,
            "date_start": req.date_start,
            "date_stop": req.date_stop,
            "pack_count": len(req.pack_ids or []),
            "include_series": bool(req.include_series),
            "series_window": req.series_window if req.series_window else 5,
            "limit": req.limit,
        }
        background_tasks.add_task(_run_rankings_ab_shadow, req, user, primary, context)

    return primary


@router.post("/rankings/series")
@router.post("/ad-performance/series")
def get_rankings_series(req: RankingsSeriesRequest, user=Depends(get_current_user)):
    started_at = time.perf_counter()
    context = {
        "group_by": req.group_by,
        "date_start": req.date_start,
        "date_stop": req.date_stop,
        "pack_count": len(req.pack_ids or []),
        "group_keys_count": len(req.group_keys or []),
        "window": req.window,
    }
    sb = _get_analytics_supabase(user["token"])
    logger.info("[rankings_series] request_start context=%s", context)
    if not req.pack_ids or len(req.pack_ids) == 0:
        logger.info(
            "[rankings_series] skip_empty_packs elapsed_ms=%.2f context=%s",
            (time.perf_counter() - started_at) * 1000.0,
            context,
        )
        return {"series_by_group": {}, "window": req.window}

    try:
        if ANALYTICS_MANAGER_RPC_ENABLED:
            max_rpc_attempts = 2 if req.group_by == "ad_id" else 1
            payload = _get_rankings_series_v2_rpc_with_retry(
                req,
                user,
                sb,
                max_attempts=max_rpc_attempts,
            )
        else:
            mql_leadscore_min = _get_user_mql_leadscore_min(sb, str(user["user_id"]))
            payload = _get_rankings_series_v2(req, user, sb, mql_leadscore_min)
        series_by_group = payload.get("series_by_group") if isinstance(payload, dict) else {}

        def _series_has_signal(series: Any) -> bool:
            if not isinstance(series, dict):
                return False

            for metric in ("spend", "clicks", "inline_link_clicks", "hook", "ctr", "connect_rate", "lpv", "impressions", "cpm", "cpc", "cplc", "website_ctr", "cpmql", "mqls"):
                values = series.get(metric)
                if isinstance(values, list) and any(isinstance(v, (int, float)) and float(v) != 0.0 for v in values):
                    return True

            conv_values = series.get("conversions")
            if isinstance(conv_values, list):
                for item in conv_values:
                    if isinstance(item, dict) and any(float(v or 0) != 0.0 for v in item.values()):
                        return True

            return False

        non_empty_groups = sum(1 for s in (series_by_group or {}).values() if _series_has_signal(s))
        logger.info(
            "[rankings_series] success elapsed_ms=%.2f context=%s returned_groups=%s non_empty_groups=%s",
            (time.perf_counter() - started_at) * 1000.0,
            context,
            len(series_by_group or {}),
            non_empty_groups,
        )
        return payload
    except Exception as e:
        if ANALYTICS_MANAGER_RPC_ENABLED and ANALYTICS_MANAGER_RPC_FAIL_OPEN:
            try:
                mql_leadscore_min = _get_user_mql_leadscore_min(sb, str(user["user_id"]))
                payload = _get_rankings_series_v2(req, user, sb, mql_leadscore_min)
                logger.warning(
                    "[rankings_series] rpc_failed_fallback_legacy elapsed_ms=%.2f context=%s error=%s",
                    (time.perf_counter() - started_at) * 1000.0,
                    context,
                    e,
                )
                return payload
            except Exception:
                pass
        logger.exception(
            "[rankings_series] failed elapsed_ms=%.2f context=%s error=%s",
            (time.perf_counter() - started_at) * 1000.0,
            context,
            e,
        )
        raise HTTPException(status_code=500, detail="Erro ao consultar sÃ©ries do Manager.")


@router.post("/rankings/retention")
@router.post("/ad-performance/retention")
def get_rankings_retention(req: RankingsRetentionRequest, user=Depends(get_current_user)):
    started_at = time.perf_counter()
    context = {
        "group_by": req.group_by,
        "group_key": req.group_key,
        "date_start": req.date_start,
        "date_stop": req.date_stop,
        "pack_count": len(req.pack_ids or []),
    }
    sb = _get_analytics_supabase(user["token"])
    if not req.pack_ids or len(req.pack_ids) == 0:
        logger.info(
            "[rankings_retention] skip_empty_packs elapsed_ms=%.2f context=%s",
            (time.perf_counter() - started_at) * 1000.0,
            context,
        )
        return {"group_key": req.group_key, "video_play_curve_actions": []}

    try:
        if ANALYTICS_MANAGER_RPC_ENABLED:
            payload = _get_rankings_retention_v2_rpc(req, user, sb)
        else:
            payload = _get_rankings_retention_v2(req, user, sb)
        curve = payload.get("video_play_curve_actions") if isinstance(payload, dict) else []
        logger.info(
            "[rankings_retention] success elapsed_ms=%.2f context=%s curve_points=%s",
            (time.perf_counter() - started_at) * 1000.0,
            context,
            len(curve or []),
        )
        return payload
    except Exception as e:
        if ANALYTICS_MANAGER_RPC_ENABLED and ANALYTICS_MANAGER_RPC_FAIL_OPEN:
            try:
                payload = _get_rankings_retention_v2(req, user, sb)
                logger.warning(
                    "[rankings_retention] rpc_failed_fallback_legacy elapsed_ms=%.2f context=%s error=%s",
                    (time.perf_counter() - started_at) * 1000.0,
                    context,
                    e,
                )
                return payload
            except Exception:
                pass
        logger.exception(
            "[rankings_retention] failed elapsed_ms=%.2f context=%s error=%s",
            (time.perf_counter() - started_at) * 1000.0,
            context,
            e,
        )
        raise HTTPException(status_code=500, detail="Erro ao consultar curva de retenÃ§Ã£o do Manager.")


@router.get("/rankings/ad-name/{ad_name}/details")
def get_ad_name_details(
    ad_name: str,
    date_start: str,
    date_stop: str,
    include_leadscore: bool = True,
    user=Depends(get_current_user)
):
    """Retorna detalhes agregados de todos os ad_ids com o mesmo ad_name no perÃ­odo.
    Equivalente a get_ad_details, mas agrupado por ad_name.
    """
    sb = get_supabase_for_user(user["token"])
    mql_leadscore_min = _get_user_mql_leadscore_min(sb, user["user_id"])

    axis = _axis_5_days(date_stop)

    def metrics_filters(q):
        return q.eq("user_id", user["user_id"]).eq("ad_name", ad_name).gte("date", date_start).lte("date", date_stop)

    select_with_lpv = (
        "ad_id,ad_name,account_id,campaign_name,adset_name,date,clicks,impressions,inline_link_clicks,spend,"
        "video_total_plays,video_total_thruplays,video_watched_p50,conversions,actions,video_play_curve_actions,"
        "hold_rate,scroll_stop_rate,reach,frequency,leadscore_values,lpv"
    )
    select_without_lpv = (
        "ad_id,ad_name,account_id,campaign_name,adset_name,date,clicks,impressions,inline_link_clicks,spend,"
        "video_total_plays,video_total_thruplays,video_watched_p50,conversions,actions,video_play_curve_actions,"
        "hold_rate,scroll_stop_rate,reach,frequency,leadscore_values"
    )
    try:
        data = _fetch_all_paginated(sb, "ad_metrics", select_with_lpv, metrics_filters)
    except Exception as e:
        msg = str(e or "")
        if "lpv" in msg and ("column" in msg or "does not exist" in msg):
            logger.warning("[ad_name_details] Coluna `lpv` ausente no DB; seguindo sem ela (fallback via actions).")
            data = _fetch_all_paginated(sb, "ad_metrics", select_without_lpv, metrics_filters)
        else:
            raise

    if not data:
        raise HTTPException(status_code=404, detail=f"Ad name '{ad_name}' nÃ£o encontrado no perÃ­odo especificado")

    # Agregar dados do perÃ­odo completo (todos os ad_ids com esse nome)
    agg: Dict[str, Any] = {
        "account_id": None,
        "ad_name": ad_name,
        "campaign_name": None,
        "adset_name": None,
        "impressions": 0,
        "clicks": 0,
        "inline_link_clicks": 0,
        "spend": 0.0,
        "lpv": 0,
        "plays": 0,
        "thruplays": 0,
        "hook_wsum": 0.0,
        "hold_rate_wsum": 0.0,
        "video_watched_p50_wsum": 0.0,
        "reach": 0,
        "curve_weighted": {},
        "conversions": {},
        "leadscore_values": [],
        "ad_ids": set(),
    }

    series_acc: Dict[str, Any] = {
        "impressions": {d: 0 for d in axis},
        "clicks": {d: 0 for d in axis},
        "inline": {d: 0 for d in axis},
        "spend": {d: 0.0 for d in axis},
        "plays": {d: 0 for d in axis},
        "lpv": {d: 0 for d in axis},
        "hook_wsum": {d: 0.0 for d in axis},
        "scroll_stop_wsum": {d: 0.0 for d in axis},
        "hold_rate_wsum": {d: 0.0 for d in axis},
        "video_watched_p50_wsum": {d: 0.0 for d in axis},
        "conversions": {d: {} for d in axis},
        "mql_count": {d: 0 for d in axis},
    }

    for r in data:
        if not agg["account_id"]:
            agg["account_id"] = r.get("account_id")
            agg["campaign_name"] = r.get("campaign_name")
            agg["adset_name"] = r.get("adset_name")

        aid = str(r.get("ad_id") or "")
        if aid:
            agg["ad_ids"].add(aid)

        date = str(r.get("date"))[:10]
        clicks = int(r.get("clicks") or 0)
        impressions = int(r.get("impressions") or 0)
        inline_link_clicks = int(r.get("inline_link_clicks") or 0)
        spend = float(r.get("spend") or 0)
        leadscore_values = r.get("leadscore_values") or []
        plays = int(r.get("video_total_plays") or 0)
        thruplays = int(r.get("video_total_thruplays") or 0)
        curve = r.get("video_play_curve_actions") or []
        hook = _hook_at_3_from_curve(curve)
        hold_rate = float(r.get("hold_rate") or 0)
        _ss_raw = float(r.get("scroll_stop_value") or r.get("scroll_stop_rate") or 0)
        scroll_stop = _ss_raw / 100.0 if _ss_raw > 1 else _ss_raw
        video_watched_p50 = int(r.get("video_watched_p50") or 0)
        reach = int(r.get("reach") or 0)
        lpv = _extract_lpv(r)

        agg["impressions"] += impressions
        agg["clicks"] += clicks
        agg["inline_link_clicks"] += inline_link_clicks
        agg["spend"] += spend
        agg["lpv"] += lpv
        agg["plays"] += plays
        agg["thruplays"] += thruplays
        agg["hook_wsum"] += hook * plays
        agg["hold_rate_wsum"] += hold_rate * plays
        agg["video_watched_p50_wsum"] += video_watched_p50 * plays
        agg["reach"] += reach

        if isinstance(leadscore_values, list) and len(leadscore_values) > 0:
            try:
                agg["leadscore_values"].extend([float(v) for v in leadscore_values if v is not None])
            except Exception:
                pass

        if isinstance(curve, list) and plays > 0:
            try:
                for i, val in enumerate(curve):
                    val_num = int(val or 0)
                    if i not in agg["curve_weighted"]:
                        agg["curve_weighted"][i] = {"weighted_sum": 0.0, "plays_sum": 0}
                    agg["curve_weighted"][i]["weighted_sum"] += val_num * plays
                    agg["curve_weighted"][i]["plays_sum"] += plays
            except Exception:
                pass

        _merge_row_conversions_actions(r, agg["conversions"])

        if date in axis:
            series_acc["impressions"][date] += impressions
            series_acc["clicks"][date] += clicks
            series_acc["inline"][date] += inline_link_clicks
            series_acc["spend"][date] += spend
            series_acc["lpv"][date] += lpv
            series_acc["plays"][date] += plays
            series_acc["hook_wsum"][date] += hook * plays
            series_acc["scroll_stop_wsum"][date] += scroll_stop * plays
            series_acc["hold_rate_wsum"][date] += hold_rate * plays
            series_acc["video_watched_p50_wsum"][date] += video_watched_p50 * plays
            try:
                series_acc["mql_count"][date] += _count_mql(leadscore_values, mql_leadscore_min)
            except Exception:
                pass
            _merge_row_conversions_actions(r, series_acc["conversions"][date])

    # Buscar thumbnail cacheada do ad_id representativo. Se a propagaÃ§Ã£o por ad_name
    # estiver correta, qualquer ad_id do grupo deve ter a mesma thumb_storage_path.
    thumbnail: Optional[str] = None
    representative_ad_id = next(iter(sorted(str(ad_id) for ad_id in (agg.get("ad_ids") or set()) if ad_id)), None)
    if representative_ad_id:
        try:
            ads_res = (
                sb.table("ads")
                .select("ad_id,thumb_storage_path,primary_video_id,media_type,creative_video_id")
                .eq("user_id", user["user_id"])
                .eq("ad_id", representative_ad_id)
                .limit(1)
                .execute()
            )
            if ads_res.data:
                thumbnail = _get_storage_thumb_if_any(ads_res.data[0])
        except Exception as e:
            logger.warning(f"Erro ao buscar thumbnail (ad_name details): {e}")

    # Calcular mÃ©tricas derivadas
    ctr = _safe_div(agg["clicks"], agg["impressions"]) if agg["impressions"] else 0
    hook = _safe_div(agg["hook_wsum"], agg["plays"]) if agg["plays"] else 0
    hold_rate = _safe_div(agg["hold_rate_wsum"], agg["plays"]) if agg["plays"] else 0
    video_watched_p50 = _safe_div(agg["video_watched_p50_wsum"], agg["plays"]) if agg["plays"] else 0
    connect_rate = _safe_div(agg["lpv"], agg["inline_link_clicks"]) if agg["inline_link_clicks"] else 0
    cpm = (_safe_div(agg["spend"], agg["impressions"]) * 1000.0) if agg["impressions"] else 0
    website_ctr = _safe_div(agg["inline_link_clicks"], agg["impressions"]) if agg["impressions"] else 0
    frequency = round(agg["impressions"] / agg["reach"], 2) if agg["reach"] > 0 else None

    # Calcular curva de retenÃ§Ã£o agregada
    aggregated_curve: List[int] = []
    if agg.get("curve_weighted"):
        max_curve_len = max(agg["curve_weighted"].keys()) + 1 if agg["curve_weighted"] else 0
        for i in range(max_curve_len):
            if i in agg["curve_weighted"]:
                w = agg["curve_weighted"][i]
                if w["plays_sum"] > 0:
                    aggregated_curve.append(int(round(w["weighted_sum"] / w["plays_sum"])))
                else:
                    aggregated_curve.append(0)
            else:
                aggregated_curve.append(0)

    series = _build_rankings_series(axis, series_acc, include_cpmql=True)

    return {
        "account_id": agg["account_id"],
        "ad_name": agg["ad_name"],
        "campaign_name": agg["campaign_name"],
        "adset_name": agg["adset_name"],
        "impressions": agg["impressions"],
        "clicks": agg["clicks"],
        "inline_link_clicks": agg["inline_link_clicks"],
        "spend": agg["spend"],
        "lpv": agg["lpv"],
        "plays": agg["plays"],
        "video_total_thruplays": agg["thruplays"],
        "hook": hook,
        "hold_rate": hold_rate,
        "video_watched_p50": int(round(video_watched_p50)) if video_watched_p50 else 0,
        "ctr": ctr,
        "connect_rate": connect_rate,
        "cpm": cpm,
        "website_ctr": website_ctr,
        "reach": agg["reach"],
        "frequency": frequency,
        "conversions": agg["conversions"],
        "leadscore_values": (agg.get("leadscore_values") or []) if include_leadscore else [],
        "thumbnail": thumbnail,
        "video_play_curve_actions": aggregated_curve if aggregated_curve else None,
        "ad_count": len(agg["ad_ids"]),
        "series": series,
    }


@router.get("/rankings/ad-name/{ad_name}/children")
def get_rankings_children(
    ad_name: str,
    date_start: str,
    date_stop: str,
    order_by: Optional[str] = None,
    include_leadscore: bool = True,
    user=Depends(get_current_user)
):
    """Retorna linhas-filhas agregadas por ad_id para um ad_name no perÃ­odo.
    Inclui sÃ©ries de 5 dias (hook, spend, ctr, connect_rate, lpv, impressions, conversions).
    """
    sb = get_supabase_for_user(user["token"])
    mql_leadscore_min = _get_user_mql_leadscore_min(sb, user["user_id"])

    axis = _axis_5_days(date_stop)
    
    # Usar paginaÃ§Ã£o para contornar limite de 1000 linhas do Supabase
    # ALTO RISCO: Pode haver muitos registros se o perÃ­odo for longo ou mÃºltiplos ad_ids com o mesmo nome
    def metrics_filters(q):
        return q.eq("ad_name", ad_name).gte("date", date_start).lte("date", date_stop)
    
    select_with_lpv = (
        "ad_id,account_id,campaign_name,adset_name,date,clicks,impressions,inline_link_clicks,spend,"
        "video_total_plays,video_total_thruplays,video_watched_p50,conversions,actions,video_play_curve_actions,"
        "hold_rate,scroll_stop_rate,leadscore_values,lpv"
    )
    select_without_lpv = (
        "ad_id,account_id,campaign_name,adset_name,date,clicks,impressions,inline_link_clicks,spend,"
        "video_total_plays,video_total_thruplays,video_watched_p50,conversions,actions,video_play_curve_actions,"
        "hold_rate,scroll_stop_rate,leadscore_values"
    )
    try:
        data = _fetch_all_paginated(sb, "ad_metrics", select_with_lpv, metrics_filters)
    except Exception as e:
        msg = str(e or "")
        if "lpv" in msg and ("column" in msg or "does not exist" in msg):
            logger.warning("[rankings_children] Coluna `lpv` ausente no DB; seguindo sem ela (fallback via actions).")
            data = _fetch_all_paginated(sb, "ad_metrics", select_without_lpv, metrics_filters)
        else:
            raise

    from collections import defaultdict

    agg: Dict[str, Dict[str, Any]] = {}
    series_acc: Dict[str, Dict[str, Any]] = defaultdict(lambda: {
        "impressions": {d: 0 for d in axis},
        "clicks": {d: 0 for d in axis},
        "inline": {d: 0 for d in axis},
        "spend": {d: 0 for d in axis},
        "plays": {d: 0 for d in axis},
        "lpv": {d: 0 for d in axis},
        "hook_wsum": {d: 0.0 for d in axis},
        "scroll_stop_wsum": {d: 0.0 for d in axis},
        "hold_rate_wsum": {d: 0.0 for d in axis},
        "video_watched_p50_wsum": {d: 0.0 for d in axis},
        "conversions": {d: {} for d in axis},
        "mql_count": {d: 0 for d in axis},
    })

    for r in data:
        ad_id = str(r.get("ad_id") or "")
        key = ad_id

        date = str(r.get("date"))[:10]
        clicks = int(r.get("clicks") or 0)
        impressions = int(r.get("impressions") or 0)
        inline_link_clicks = int(r.get("inline_link_clicks") or 0)
        spend = float(r.get("spend") or 0)
        leadscore_values = r.get("leadscore_values") or []
        plays = int(r.get("video_total_plays") or 0)
        thruplays = int(r.get("video_total_thruplays") or 0)
        video_watched_p50 = int(r.get("video_watched_p50") or 0)
        curve = r.get("video_play_curve_actions") or []
        hook = _hook_at_3_from_curve(curve)
        hold_rate = float(r.get("hold_rate") or 0)
        _ss_raw = float(r.get("scroll_stop_value") or r.get("scroll_stop_rate") or 0)
        scroll_stop = _ss_raw / 100.0 if _ss_raw > 1 else _ss_raw

        # landing_page_views (preferir coluna lpv quando disponÃ­vel)
        lpv = _extract_lpv(r)

        if key not in agg:
            agg[key] = {
                "account_id": r.get("account_id"),
                "ad_id": ad_id,
                "ad_name": ad_name,
                "campaign_name": r.get("campaign_name"),
                "adset_name": r.get("adset_name"),
                "impressions": 0,
                "clicks": 0,
                "inline_link_clicks": 0,
                "spend": 0.0,
                "lpv": 0,
                "plays": 0,
                "thruplays": 0,  # Total de thruplays agregado
                "hook_wsum": 0.0,
                "hold_rate_wsum": 0.0,  # Soma ponderada de hold_rate
                "video_watched_p50_wsum": 0.0,  # Soma ponderada de video_watched_p50
                "conversions": {},
                "leadscore_values": [],
            }
        A = agg[key]
        A["impressions"] += impressions
        A["clicks"] += clicks
        A["inline_link_clicks"] += inline_link_clicks
        A["spend"] += spend
        A["lpv"] += lpv
        A["plays"] += plays
        A["thruplays"] += thruplays
        A["hook_wsum"] += hook * plays
        A["hold_rate_wsum"] += hold_rate * plays  # Agregar hold_rate ponderado por plays
        A["video_watched_p50_wsum"] += video_watched_p50 * plays  # Agregar video_watched_p50 ponderado por plays

        if isinstance(leadscore_values, list) and len(leadscore_values) > 0:
            try:
                A["leadscore_values"].extend([float(v) for v in leadscore_values if v is not None])
            except Exception:
                pass

        # Agregar conversions e actions no total
        _merge_row_conversions_actions(r, A["conversions"])

        # SÃ©ries 5 dias
        if date in axis:
            S = series_acc[key]
            S["impressions"][date] += impressions
            S["clicks"][date] += clicks
            S["inline"][date] += inline_link_clicks
            S["spend"][date] += spend
            S["lpv"][date] += lpv
            S["plays"][date] += plays
            S["hook_wsum"][date] += hook * plays
            S["scroll_stop_wsum"][date] += scroll_stop * plays
            S["hold_rate_wsum"][date] += hold_rate * plays
            S["video_watched_p50_wsum"][date] += video_watched_p50 * plays
            try:
                S["mql_count"][date] += _count_mql(leadscore_values, mql_leadscore_min)
            except Exception:
                pass
            _merge_row_conversions_actions(r, S["conversions"][date])

    # Buscar thumbnails e effective_status dos filhos
    ad_ids_in_results = list(agg.keys())
    thumbnails_map: Dict[str, Optional[str]] = {}
    effective_status_map: Dict[str, Optional[str]] = {}
    if ad_ids_in_results:
        try:
            # Processar ad_ids em lotes para evitar URLs muito longas
            # Limite conservador: 500 IDs por lote (ajustado para evitar erro 400 do Supabase)
            batch_size = 500
            all_ads_rows = []
            
            for i in range(0, len(ad_ids_in_results), batch_size):
                batch_ad_ids = ad_ids_in_results[i:i + batch_size]
                
                def ads_filters(q):
                    return q.in_("ad_id", batch_ad_ids)
                
                batch_ads_rows = _fetch_all_paginated(
                    sb,
                    "ads",
                    "ad_id,thumb_storage_path,thumbnail_url,adcreatives_videos_thumbs,primary_video_id,media_type,creative_video_id,effective_status",
                    ads_filters
                )
                
                all_ads_rows.extend(batch_ads_rows)
            
            for ad_row in all_ads_rows:
                aid = str(ad_row.get("ad_id") or "")
                thumbnails_map[aid] = _get_storage_thumb_if_any(ad_row) or _get_thumbnail_with_fallback(ad_row)
                effective_status_map[aid] = ad_row.get("effective_status")
        except Exception as e:
            logger.warning(f"Erro ao buscar thumbnails (children): {e}")

    items: List[Dict[str, Any]] = []
    for key, A in agg.items():
        ctr = _safe_div(A["clicks"], A["impressions"]) if A["impressions"] else 0
        hook = _safe_div(A["hook_wsum"], A["plays"]) if A["plays"] else 0
        hold_rate = _safe_div(A["hold_rate_wsum"], A["plays"]) if A["plays"] else 0
        video_watched_p50 = _safe_div(A["video_watched_p50_wsum"], A["plays"]) if A["plays"] else 0
        cpm = (_safe_div(A["spend"], A["impressions"]) * 1000.0) if A["impressions"] else 0
        website_ctr = _safe_div(A["inline_link_clicks"], A["impressions"]) if A["impressions"] else 0

        S = series_acc.get(key)
        series = _build_rankings_series(axis, S, include_cpmql=True) if S else None

        items.append({
            "account_id": A.get("account_id"),
            "ad_id": A.get("ad_id"),
            "ad_name": ad_name,
            "effective_status": effective_status_map.get(key),
            "campaign_name": A.get("campaign_name"),
            "adset_name": A.get("adset_name"),
            "impressions": A["impressions"],
            "clicks": A["clicks"],
            "inline_link_clicks": A["inline_link_clicks"],
            "spend": A["spend"],
            "lpv": A["lpv"],
            "plays": A["plays"],
            "video_total_thruplays": A["thruplays"],
            "hook": hook,
            "hold_rate": hold_rate,
            "video_watched_p50": int(round(video_watched_p50)) if video_watched_p50 else 0,
            "ctr": ctr,
            "connect_rate": _safe_div(A["lpv"], A["inline_link_clicks"]) if A["inline_link_clicks"] else 0,
            "cpm": cpm,
            "website_ctr": website_ctr,
            "conversions": A.get("conversions", {}),
            "leadscore_values": (A.get("leadscore_values") or []) if include_leadscore else [],
            "thumbnail": thumbnails_map.get(key),
            "series": series,
        })

    order = (order_by or "").lower()
    if order in {"hook", "hold_rate", "cpr", "spend", "ctr", "connect_rate", "page_conv"}:
        reverse = order not in {"cpr"}
        items.sort(key=lambda x: (x.get(order) or 0), reverse=reverse)

    return { "data": items }


@router.get("/rankings/campaign-id/{campaign_id}/children")
def get_campaign_children(
    campaign_id: str,
    date_start: str,
    date_stop: str,
    order_by: Optional[str] = None,
    action_type: Optional[str] = None,
    include_leadscore: bool = True,
    pack_ids: Optional[List[str]] = Query(default=None),
    user=Depends(get_current_user),
):
    """Retorna linhas-filhas agregadas por adset_id para um campaign_id no perÃ­odo.
    Inclui sÃ©ries de 5 dias (hook, spend, ctr, connect_rate, lpv, impressions, conversions).
    """
    req = RankingsRequest(
        date_start=date_start,
        date_stop=date_stop,
        group_by="adset_id",
        action_type=action_type,
        order_by=order_by,
        limit=10000,
        offset=0,
        filters=RankingsFilters(campaign_id=campaign_id),
        pack_ids=pack_ids,
        include_series=False,
        include_leadscore=include_leadscore,
        include_available_conversion_types=False,
    )
    sb = get_supabase_for_user(user["token"])
    result = _get_rankings_core_v2_rpc(req, user, sb)
    items: List[Dict[str, Any]] = []
    for row in (result.get("data") or []):
        if not isinstance(row, dict):
            continue
        status = row.get("effective_status")
        items.append(
            {
                **row,
                "status_resolved": bool(str(status).strip()) if status is not None else False,
            }
        )
    return {"data": items}

    mql_leadscore_min = _get_user_mql_leadscore_min(sb, user["user_id"])

    axis = _axis_5_days(date_stop)

    def metrics_filters(q):
        return (
            q.eq("user_id", user["user_id"])
            .eq("campaign_id", campaign_id)
            .gte("date", date_start)
            .lte("date", date_stop)
        )

    select_with_lpv = (
        "ad_id,ad_name,account_id,campaign_id,campaign_name,adset_id,adset_name,date,clicks,impressions,"
        "inline_link_clicks,spend,video_total_plays,video_total_thruplays,video_watched_p50,conversions,actions,"
        "video_play_curve_actions,hold_rate,scroll_stop_rate,leadscore_values,lpv"
    )
    select_without_lpv = (
        "ad_id,ad_name,account_id,campaign_id,campaign_name,adset_id,adset_name,date,clicks,impressions,"
        "inline_link_clicks,spend,video_total_plays,video_total_thruplays,video_watched_p50,conversions,actions,"
        "video_play_curve_actions,hold_rate,scroll_stop_rate,leadscore_values"
    )
    try:
        data = _fetch_all_paginated(sb, "ad_metrics", select_with_lpv, metrics_filters)
    except Exception as e:
        msg = str(e or "")
        if "lpv" in msg and ("column" in msg or "does not exist" in msg):
            logger.warning("[campaign_children] Coluna `lpv` ausente no DB; seguindo sem ela (fallback via actions).")
            data = _fetch_all_paginated(sb, "ad_metrics", select_without_lpv, metrics_filters)
        else:
            raise

    from collections import defaultdict

    agg: Dict[str, Dict[str, Any]] = {}
    series_acc: Dict[str, Dict[str, Any]] = defaultdict(
        lambda: {
            "impressions": {d: 0 for d in axis},
            "clicks": {d: 0 for d in axis},
            "inline": {d: 0 for d in axis},
            "spend": {d: 0.0 for d in axis},
            "plays": {d: 0 for d in axis},
            "lpv": {d: 0 for d in axis},
            "hook_wsum": {d: 0.0 for d in axis},
            "scroll_stop_wsum": {d: 0.0 for d in axis},
            "hold_rate_wsum": {d: 0.0 for d in axis},
            "video_watched_p50_wsum": {d: 0.0 for d in axis},
            "conversions": {d: {} for d in axis},
            "mql_count": {d: 0 for d in axis},
        }
    )

    for r in data:
        ad_id = str(r.get("ad_id") or "")
        adset_id = str(r.get("adset_id") or "")
        adset_name = str(r.get("adset_name") or "")
        if not adset_id:
            continue
        key = adset_id
        series_key = key

        date = str(r.get("date"))[:10]
        clicks = int(r.get("clicks") or 0)
        impressions = int(r.get("impressions") or 0)
        inline_link_clicks = int(r.get("inline_link_clicks") or 0)
        spend = float(r.get("spend") or 0)
        leadscore_values = r.get("leadscore_values") or []
        plays = int(r.get("video_total_plays") or 0)
        thruplays = int(r.get("video_total_thruplays") or 0)
        video_watched_p50 = int(r.get("video_watched_p50") or 0)
        curve = r.get("video_play_curve_actions") or []
        hook = _hook_at_3_from_curve(curve)
        hold_rate = float(r.get("hold_rate") or 0)
        _ss_raw = float(r.get("scroll_stop_value") or r.get("scroll_stop_rate") or 0)
        scroll_stop = _ss_raw / 100.0 if _ss_raw > 1 else _ss_raw

        # landing_page_views (preferir coluna lpv quando disponÃ­vel)
        lpv = _extract_lpv(r)

        if key not in agg:
            agg[key] = {
                "account_id": r.get("account_id"),
                "campaign_id": r.get("campaign_id"),
                "campaign_name": r.get("campaign_name"),
                "adset_id": adset_id,
                "adset_name": adset_name,
                # Manter um ad_id representativo (pelo maior impressions) para thumbnail
                "rep_ad_id": ad_id,
                "rep_impr": 0,
                # Compat: usar ad_name como label principal na tabela
                "ad_name": adset_name or adset_id,
                "impressions": 0,
                "clicks": 0,
                "inline_link_clicks": 0,
                "spend": 0.0,
                "lpv": 0,
                "plays": 0,
                "thruplays": 0,
                "hook_wsum": 0.0,
                "hold_rate_wsum": 0.0,
                "video_watched_p50_wsum": 0.0,
                "leadscore_values": [],
                "conversions": {},
                "ad_ids": set(),
            }

        A = agg[key]
        A["impressions"] += impressions
        A["clicks"] += clicks
        A["inline_link_clicks"] += inline_link_clicks
        A["spend"] += spend
        A["lpv"] += lpv
        A["plays"] += plays
        A["thruplays"] += thruplays
        A["hook_wsum"] += hook * plays
        A["hold_rate_wsum"] += hold_rate * plays
        A["video_watched_p50_wsum"] += video_watched_p50 * plays

        if isinstance(leadscore_values, list) and len(leadscore_values) > 0:
            try:
                A["leadscore_values"].extend([float(v) for v in leadscore_values if v is not None])
            except Exception:
                pass

        if ad_id:
            try:
                A["ad_ids"].add(ad_id)
            except Exception:
                pass

        # Atualizar ad_id representativo pelo maior impressions
        try:
            if impressions >= int(A.get("rep_impr") or 0):
                A["rep_impr"] = impressions
                if ad_id:
                    A["rep_ad_id"] = ad_id
        except Exception:
            pass

        # Agregar conversions e actions por action_type (com prefixos para diferenciar)
        _merge_row_conversions_actions(r, A["conversions"])

        # SÃ©rie 5 dias
        if date in axis:
            S = series_acc[series_key]
            S["impressions"][date] += impressions
            S["clicks"][date] += clicks
            S["inline"][date] += inline_link_clicks
            S["spend"][date] += spend
            S["lpv"][date] += lpv
            S["plays"][date] += plays
            S["hook_wsum"][date] += hook * plays
            S["scroll_stop_wsum"][date] += scroll_stop * plays
            S["hold_rate_wsum"][date] += hold_rate * plays
            S["video_watched_p50_wsum"][date] += video_watched_p50 * plays
            try:
                S["mql_count"][date] += _count_mql(leadscore_values, mql_leadscore_min)
            except Exception:
                pass
            _merge_row_conversions_actions(r, S["conversions"][date])

    items: List[Dict[str, Any]] = []
    for key, A in agg.items():
        S = series_acc.get(key)
        series = _build_rankings_series(axis, S, include_cpmql=True) if S else None

        hook = _safe_div(A["hook_wsum"], A["plays"]) if A["plays"] else 0
        hold_rate = _safe_div(A["hold_rate_wsum"], A["plays"]) if A["plays"] else 0
        video_watched_p50 = _safe_div(A["video_watched_p50_wsum"], A["plays"]) if A["plays"] else 0
        ctr = _safe_div(A["clicks"], A["impressions"]) if A["impressions"] else 0
        cpm = (_safe_div(A["spend"], A["impressions"]) * 1000) if A["impressions"] else 0
        website_ctr = _safe_div(A["inline_link_clicks"], A["impressions"]) if A["impressions"] else 0

        # Para filhos por adset_id (campanha), nÃ£o temos um mapeamento de thumbnails por adset.
        # Mantemos None (o frontend pode usar fallback se necessÃ¡rio).
        thumbnail = None

        ad_count = 0
        try:
            ad_count = len(A.get("ad_ids") or [])
        except Exception:
            ad_count = 0

        items.append(
            {
                "unique_id": None,
                "account_id": A.get("account_id"),
                "campaign_id": A.get("campaign_id"),
                "campaign_name": A.get("campaign_name"),
                "adset_id": A.get("adset_id"),
                "adset_name": A.get("adset_name"),
                "ad_id": A.get("rep_ad_id"),
                "ad_name": A.get("ad_name"),
                "effective_status": None,
                "impressions": A["impressions"],
                "clicks": A["clicks"],
                "inline_link_clicks": A["inline_link_clicks"],
                "spend": A["spend"],
                "lpv": A["lpv"],
                "plays": A["plays"],
                "video_total_thruplays": A["thruplays"],
                "hook": hook,
                "hold_rate": hold_rate,
                "video_watched_p50": int(round(video_watched_p50)) if video_watched_p50 else 0,
                "ctr": ctr,
                "connect_rate": _safe_div(A["lpv"], A["inline_link_clicks"]) if A["inline_link_clicks"] else 0,
                "cpm": cpm,
                "website_ctr": website_ctr,
                "leadscore_values": (A.get("leadscore_values") or []) if include_leadscore else [],
                "conversions": A.get("conversions", {}),
                "ad_count": ad_count,
                "thumbnail": thumbnail,
                "series": series,
            }
        )

    order = (order_by or "").lower()
    if order in {"hook", "hold_rate", "spend", "ctr", "connect_rate"}:
        reverse = True
        items.sort(key=lambda x: (x.get(order) or 0), reverse=reverse)

    return {"data": items}


@router.get("/rankings/adset-id/{adset_id}/children")
def get_adset_children(
    adset_id: str,
    date_start: str,
    date_stop: str,
    order_by: Optional[str] = None,
    include_leadscore: bool = True,
    user=Depends(get_current_user),
):
    """Retorna linhas-filhas agregadas por ad_id para um adset_id no perÃ­odo.
    Inclui sÃ©ries de 5 dias (hook, spend, ctr, connect_rate, lpv, impressions, conversions).
    """
    sb = get_supabase_for_user(user["token"])
    mql_leadscore_min = _get_user_mql_leadscore_min(sb, user["user_id"])

    axis = _axis_5_days(date_stop)

    def metrics_filters(q):
        return q.eq("user_id", user["user_id"]).eq("adset_id", adset_id).gte("date", date_start).lte("date", date_stop)

    select_with_lpv = (
        "ad_id,ad_name,account_id,campaign_id,campaign_name,adset_id,adset_name,date,clicks,impressions,"
        "inline_link_clicks,spend,video_total_plays,video_total_thruplays,video_watched_p50,conversions,actions,"
        "video_play_curve_actions,hold_rate,scroll_stop_rate,leadscore_values,lpv"
    )
    select_without_lpv = (
        "ad_id,ad_name,account_id,campaign_id,campaign_name,adset_id,adset_name,date,clicks,impressions,"
        "inline_link_clicks,spend,video_total_plays,video_total_thruplays,video_watched_p50,conversions,actions,"
        "video_play_curve_actions,hold_rate,scroll_stop_rate,leadscore_values"
    )
    try:
        data = _fetch_all_paginated(sb, "ad_metrics", select_with_lpv, metrics_filters)
    except Exception as e:
        msg = str(e or "")
        if "lpv" in msg and ("column" in msg or "does not exist" in msg):
            logger.warning("[adset_children] Coluna `lpv` ausente no DB; seguindo sem ela (fallback via actions).")
            data = _fetch_all_paginated(sb, "ad_metrics", select_without_lpv, metrics_filters)
        else:
            raise

    from collections import defaultdict

    agg: Dict[str, Dict[str, Any]] = {}
    series_acc: Dict[str, Dict[str, Any]] = defaultdict(
        lambda: {
            "impressions": {d: 0 for d in axis},
            "clicks": {d: 0 for d in axis},
            "inline": {d: 0 for d in axis},
            "spend": {d: 0.0 for d in axis},
            "plays": {d: 0 for d in axis},
            "lpv": {d: 0 for d in axis},
            "hook_wsum": {d: 0.0 for d in axis},
            "scroll_stop_wsum": {d: 0.0 for d in axis},
            "hold_rate_wsum": {d: 0.0 for d in axis},
            "video_watched_p50_wsum": {d: 0.0 for d in axis},
            "conversions": {d: {} for d in axis},
            "mql_count": {d: 0 for d in axis},
        }
    )

    for r in data:
        ad_id = str(r.get("ad_id") or "")
        if not ad_id:
            continue
        key = ad_id

        date = str(r.get("date"))[:10]
        clicks = int(r.get("clicks") or 0)
        impressions = int(r.get("impressions") or 0)
        inline_link_clicks = int(r.get("inline_link_clicks") or 0)
        spend = float(r.get("spend") or 0)
        leadscore_values = r.get("leadscore_values") or []
        plays = int(r.get("video_total_plays") or 0)
        thruplays = int(r.get("video_total_thruplays") or 0)
        video_watched_p50 = int(r.get("video_watched_p50") or 0)
        curve = r.get("video_play_curve_actions") or []
        hook = _hook_at_3_from_curve(curve)
        hold_rate = float(r.get("hold_rate") or 0)
        _ss_raw = float(r.get("scroll_stop_value") or r.get("scroll_stop_rate") or 0)
        scroll_stop = _ss_raw / 100.0 if _ss_raw > 1 else _ss_raw

        # landing_page_views (preferir coluna lpv quando disponÃ­vel)
        lpv = _extract_lpv(r)

        if key not in agg:
            agg[key] = {
                "account_id": r.get("account_id"),
                "campaign_id": r.get("campaign_id"),
                "campaign_name": r.get("campaign_name"),
                "adset_id": r.get("adset_id"),
                "adset_name": r.get("adset_name"),
                "ad_id": ad_id,
                "ad_name": r.get("ad_name"),
                "impressions": 0,
                "clicks": 0,
                "inline_link_clicks": 0,
                "spend": 0.0,
                "lpv": 0,
                "plays": 0,
                "thruplays": 0,
                "hook_wsum": 0.0,
                "hold_rate_wsum": 0.0,
                "video_watched_p50_wsum": 0.0,
                "conversions": {},
                "leadscore_values": [],
            }

        A = agg[key]
        A["impressions"] += impressions
        A["clicks"] += clicks
        A["inline_link_clicks"] += inline_link_clicks
        A["spend"] += spend
        A["lpv"] += lpv
        A["plays"] += plays
        A["thruplays"] += thruplays
        A["hook_wsum"] += hook * plays
        A["hold_rate_wsum"] += hold_rate * plays
        A["video_watched_p50_wsum"] += video_watched_p50 * plays

        if isinstance(leadscore_values, list) and len(leadscore_values) > 0:
            try:
                A["leadscore_values"].extend([float(v) for v in leadscore_values if v is not None])
            except Exception:
                pass

        # conversions e actions agregado no perÃ­odo
        _merge_row_conversions_actions(r, A["conversions"])

        # series (Ãºltimos 5 dias)
        if date in axis:
            S = series_acc[key]
            S["impressions"][date] += impressions
            S["clicks"][date] += clicks
            S["inline"][date] += inline_link_clicks
            S["spend"][date] += spend
            S["plays"][date] += plays
            S["lpv"][date] += lpv
            S["hook_wsum"][date] += hook * plays
            S["scroll_stop_wsum"][date] += scroll_stop * plays
            S["hold_rate_wsum"][date] += hold_rate * plays
            S["video_watched_p50_wsum"][date] += video_watched_p50 * plays
            _merge_row_conversions_actions(r, S["conversions"][date])

            # MQLs por dia
            try:
                S["mql_count"][date] += _count_mql(leadscore_values, mql_leadscore_min)
            except Exception:
                pass

    # Buscar thumbnails e effective_status dos filhos (mesma lÃ³gica de get_rankings_children)
    ad_ids_in_results = list(agg.keys())
    thumbnails_map: Dict[str, Optional[str]] = {}
    effective_status_map: Dict[str, Optional[str]] = {}
    if ad_ids_in_results:
        try:
            # Processar ad_ids em lotes para evitar URLs muito longas
            batch_size = 500
            all_ads_rows = []

            for i in range(0, len(ad_ids_in_results), batch_size):
                batch_ad_ids = ad_ids_in_results[i:i + batch_size]

                def ads_filters(q):
                    return q.in_("ad_id", batch_ad_ids)

                batch_ads_rows = _fetch_all_paginated(
                    sb,
                    "ads",
                    "ad_id,thumb_storage_path,thumbnail_url,adcreatives_videos_thumbs,primary_video_id,media_type,creative_video_id,effective_status",
                    ads_filters
                )

                all_ads_rows.extend(batch_ads_rows)

            for ad_row in all_ads_rows:
                aid = str(ad_row.get("ad_id") or "")
                thumbnails_map[aid] = _get_storage_thumb_if_any(ad_row) or _get_thumbnail_with_fallback(ad_row)
                effective_status_map[aid] = ad_row.get("effective_status")
        except Exception as e:
            logger.warning(f"Erro ao buscar thumbnails (adset_children): {e}")

    items: List[Dict[str, Any]] = []
    for key, A in agg.items():
        ctr = _safe_div(A["clicks"], A["impressions"]) if A["impressions"] else 0
        hook = _safe_div(A["hook_wsum"], A["plays"]) if A["plays"] else 0
        hold_rate = _safe_div(A["hold_rate_wsum"], A["plays"]) if A["plays"] else 0
        video_watched_p50 = _safe_div(A["video_watched_p50_wsum"], A["plays"]) if A["plays"] else 0
        connect_rate = _safe_div(A["lpv"], A["inline_link_clicks"]) if A["inline_link_clicks"] else 0
        cpm = (_safe_div(A["spend"], A["impressions"]) * 1000.0) if A["impressions"] else 0
        website_ctr = _safe_div(A["inline_link_clicks"], A["impressions"]) if A["impressions"] else 0

        series = _build_rankings_series(axis, series_acc.get(key), include_cpmql=True)

        items.append(
            {
                "unique_id": None,
                "account_id": A.get("account_id"),
                "campaign_id": A.get("campaign_id"),
                "campaign_name": A.get("campaign_name"),
                "adset_id": A.get("adset_id"),
                "adset_name": A.get("adset_name"),
                "ad_id": A.get("ad_id"),
                "ad_name": A.get("ad_name"),
                "effective_status": effective_status_map.get(key),
                "impressions": A["impressions"],
                "clicks": A["clicks"],
                "inline_link_clicks": A["inline_link_clicks"],
                "spend": A["spend"],
                "lpv": A["lpv"],
                "plays": A["plays"],
                "video_total_thruplays": A["thruplays"],
                "hook": hook,
                "hold_rate": hold_rate,
                "video_watched_p50": int(round(video_watched_p50)) if video_watched_p50 else 0,
                "ctr": ctr,
                "connect_rate": connect_rate,
                "cpm": cpm,
                "website_ctr": website_ctr,
                "leadscore_values": (A.get("leadscore_values") or []) if include_leadscore else [],
                "conversions": A.get("conversions", {}),
                "ad_count": 1,
                "thumbnail": thumbnails_map.get(key),
                "series": series,
            }
        )

    return {"data": items}


@router.get("/rankings/adset-id/{adset_id}")
def get_adset_details(
    adset_id: str,
    date_start: str,
    date_stop: str,
    user=Depends(get_current_user),
):
    """Retorna detalhes completos de um adset_id no perÃ­odo.
    Inclui sÃ©ries de 5 dias (hook, spend, ctr, connect_rate, lpv, impressions, conversions).
    """
    sb = get_supabase_for_user(user["token"])
    mql_leadscore_min = _get_user_mql_leadscore_min(sb, user["user_id"])

    axis = _axis_5_days(date_stop)

    def metrics_filters(q):
        return q.eq("user_id", user["user_id"]).eq("adset_id", adset_id).gte("date", date_start).lte("date", date_stop)

    select_with_lpv = (
        "ad_id,ad_name,account_id,campaign_id,campaign_name,adset_id,adset_name,date,clicks,impressions,"
        "inline_link_clicks,spend,video_total_plays,video_total_thruplays,video_watched_p50,conversions,actions,"
        "video_play_curve_actions,leadscore_values,lpv"
    )
    select_without_lpv = (
        "ad_id,ad_name,account_id,campaign_id,campaign_name,adset_id,adset_name,date,clicks,impressions,"
        "inline_link_clicks,spend,video_total_plays,video_total_thruplays,video_watched_p50,conversions,actions,"
        "video_play_curve_actions,leadscore_values"
    )
    try:
        data = _fetch_all_paginated(sb, "ad_metrics", select_with_lpv, metrics_filters)
    except Exception as e:
        msg = str(e or "")
        if "lpv" in msg and ("column" in msg or "does not exist" in msg):
            logger.warning("[adset_details] Coluna `lpv` ausente no DB; seguindo sem ela (fallback via actions).")
            data = _fetch_all_paginated(sb, "ad_metrics", select_without_lpv, metrics_filters)
        else:
            raise

    if not data:
        raise HTTPException(status_code=404, detail=f"Adset ID {adset_id} nÃ£o encontrado no perÃ­odo especificado")

    from collections import defaultdict

    agg: Dict[str, Any] = {
        "account_id": None,
        "campaign_id": None,
        "campaign_name": None,
        "adset_id": adset_id,
        "adset_name": None,
        "impressions": 0,
        "clicks": 0,
        "inline_link_clicks": 0,
        "spend": 0.0,
        "lpv": 0,
        "plays": 0,
        "thruplays": 0,
        "hook_wsum": 0.0,
        "video_watched_p50_wsum": 0.0,
        "conversions": {},
        "leadscore_values": [],
        "ad_ids": set(),
    }

    series_acc: Dict[str, Any] = {
        "impressions": {d: 0 for d in axis},
        "clicks": {d: 0 for d in axis},
        "inline": {d: 0 for d in axis},
        "spend": {d: 0.0 for d in axis},
        "plays": {d: 0 for d in axis},
        "lpv": {d: 0 for d in axis},
        "hook_wsum": {d: 0.0 for d in axis},
        "conversions": {d: {} for d in axis},
        "mql_count": {d: 0 for d in axis},
    }

    for r in data:
        if not agg["account_id"]:
            agg["account_id"] = r.get("account_id")
        if not agg["campaign_id"]:
            agg["campaign_id"] = r.get("campaign_id")
        if not agg["campaign_name"]:
            agg["campaign_name"] = r.get("campaign_name")
        if not agg["adset_name"]:
            agg["adset_name"] = r.get("adset_name")

        ad_id = str(r.get("ad_id") or "")
        if ad_id:
            agg["ad_ids"].add(ad_id)

        date = str(r.get("date"))[:10]
        clicks = int(r.get("clicks") or 0)
        impressions = int(r.get("impressions") or 0)
        inline_link_clicks = int(r.get("inline_link_clicks") or 0)
        spend = float(r.get("spend") or 0)
        plays = int(r.get("video_total_plays") or 0)
        thruplays = int(r.get("video_total_thruplays") or 0)
        curve = r.get("video_play_curve_actions") or []
        hook = _hook_at_3_from_curve(curve)
        video_watched_p50 = int(r.get("video_watched_p50") or 0)
        leadscore_values = r.get("leadscore_values") or []

        # landing_page_views (preferir coluna lpv quando disponÃ­vel)
        lpv = _extract_lpv(r)

        agg["impressions"] += impressions
        agg["clicks"] += clicks
        agg["inline_link_clicks"] += inline_link_clicks
        agg["spend"] += spend
        agg["lpv"] += lpv
        agg["plays"] += plays
        agg["thruplays"] += thruplays
        agg["hook_wsum"] += hook * plays
        agg["video_watched_p50_wsum"] += video_watched_p50 * plays

        if isinstance(leadscore_values, list) and len(leadscore_values) > 0:
            try:
                agg["leadscore_values"].extend([float(v) for v in leadscore_values if v is not None])
            except Exception:
                pass

        conversions = r.get("conversions") or []
        if isinstance(conversions, list):
            for conv in conversions:
                if isinstance(conv, dict):
                    t = conv.get("action_type")
                    v = conv.get("value")
                    if t:
                        try:
                            agg["conversions"][str(t)] = agg["conversions"].get(str(t), 0) + int(v or 0)
                        except Exception:
                            pass

        if date in axis:
            series_acc["impressions"][date] += impressions
            series_acc["clicks"][date] += clicks
            series_acc["inline"][date] += inline_link_clicks
            series_acc["spend"][date] += spend
            series_acc["plays"][date] += plays
            series_acc["lpv"][date] += lpv
            series_acc["hook_wsum"][date] += hook * plays

            conversions_day = series_acc["conversions"][date]
            conversions = r.get("conversions") or []
            if isinstance(conversions, list):
                for conv in conversions:
                    if isinstance(conv, dict):
                        t = conv.get("action_type")
                        v = conv.get("value")
                        if t:
                            try:
                                conversions_day[str(t)] = conversions_day.get(str(t), 0) + int(v or 0)
                            except Exception:
                                pass
            series_acc["conversions"][date] = conversions_day

            try:
                series_acc["mql_count"][date] += _count_mql(leadscore_values, mql_leadscore_min)
            except Exception:
                pass

    ctr = _safe_div(agg["clicks"], agg["impressions"]) if agg["impressions"] else 0
    hook = _safe_div(agg["hook_wsum"], agg["plays"]) if agg["plays"] else 0
    video_watched_p50 = _safe_div(agg["video_watched_p50_wsum"], agg["plays"]) if agg["plays"] else 0
    connect_rate = _safe_div(agg["lpv"], agg["inline_link_clicks"]) if agg["inline_link_clicks"] else 0
    cpm = (_safe_div(agg["spend"], agg["impressions"]) * 1000.0) if agg["impressions"] else 0
    website_ctr = _safe_div(agg["inline_link_clicks"], agg["impressions"]) if agg["impressions"] else 0

    series = _build_rankings_series(axis, series_acc, include_cpmql=True)

    return {
        "account_id": agg["account_id"],
        "campaign_id": agg["campaign_id"],
        "campaign_name": agg["campaign_name"],
        "adset_id": agg["adset_id"],
        "adset_name": agg["adset_name"],
        "ad_id": None,
        "ad_name": agg["adset_name"] or agg["adset_id"],
        "impressions": agg["impressions"],
        "clicks": agg["clicks"],
        "inline_link_clicks": agg["inline_link_clicks"],
        "spend": agg["spend"],
        "lpv": agg["lpv"],
        "plays": agg["plays"],
        "video_total_thruplays": agg["thruplays"],
        "hook": hook,
        "ctr": ctr,
        "connect_rate": connect_rate,
        "cpm": cpm,
        "website_ctr": website_ctr,
        "leadscore_values": agg.get("leadscore_values") or [],
        "conversions": agg.get("conversions", {}),
        "ad_count": len(agg.get("ad_ids") or []),
        "thumbnail": None,
        "series": series,
    }


@router.get("/rankings/ad-id/{ad_id}")
def get_ad_details(
    ad_id: str,
    date_start: str,
    date_stop: str,
    user=Depends(get_current_user)
):
    """Retorna detalhes completos de um ad_id especÃ­fico no perÃ­odo.
    Inclui sÃ©ries de 5 dias (hook, spend, ctr, connect_rate, lpv, impressions, conversions).
    Reutiliza a lÃ³gica de get_rankings_children, mas retorna um Ãºnico item.
    """
    sb = get_supabase_for_user(user["token"])
    mql_leadscore_min = _get_user_mql_leadscore_min(sb, user["user_id"])

    axis = _axis_5_days(date_stop)
    
    # Usar paginaÃ§Ã£o para contornar limite de 1000 linhas do Supabase
    # ALTO RISCO: Pode haver mais de 1000 registros se o perÃ­odo for longo (ex: vÃ¡rios anos)
    def metrics_filters(q):
        return q.eq("user_id", user["user_id"]).eq("ad_id", ad_id).gte("date", date_start).lte("date", date_stop)
    
    select_with_lpv = (
        "ad_id,ad_name,account_id,campaign_name,adset_name,date,clicks,impressions,inline_link_clicks,spend,"
        "video_total_plays,video_total_thruplays,video_watched_p50,conversions,actions,video_play_curve_actions,"
        "hold_rate,scroll_stop_rate,reach,frequency,leadscore_values,lpv"
    )
    select_without_lpv = (
        "ad_id,ad_name,account_id,campaign_name,adset_name,date,clicks,impressions,inline_link_clicks,spend,"
        "video_total_plays,video_total_thruplays,video_watched_p50,conversions,actions,video_play_curve_actions,"
        "hold_rate,scroll_stop_rate,reach,frequency,leadscore_values"
    )
    try:
        data = _fetch_all_paginated(sb, "ad_metrics", select_with_lpv, metrics_filters)
    except Exception as e:
        msg = str(e or "")
        if "lpv" in msg and ("column" in msg or "does not exist" in msg):
            logger.warning("[ad_details] Coluna `lpv` ausente no DB; seguindo sem ela (fallback via actions).")
            data = _fetch_all_paginated(sb, "ad_metrics", select_without_lpv, metrics_filters)
        else:
            raise

    if not data:
        raise HTTPException(status_code=404, detail=f"Ad ID {ad_id} nÃ£o encontrado no perÃ­odo especificado")

    from collections import defaultdict

    # Agregar dados do perÃ­odo completo
    agg: Dict[str, Any] = {
        "account_id": None,
        "ad_id": ad_id,
        "ad_name": None,
        "campaign_name": None,
        "adset_name": None,
        "impressions": 0,
        "clicks": 0,
        "inline_link_clicks": 0,
        "spend": 0.0,
        "lpv": 0,
        "plays": 0,
        "thruplays": 0,
        "hook_wsum": 0.0,
        "hold_rate_wsum": 0.0,
        "video_watched_p50_wsum": 0.0,
        "reach": 0,
        # Curva de retenÃ§Ã£o agregada (ponderada por plays, mesma lÃ³gica do hook)
        "curve_weighted": {},  # {segundo_index: {"weighted_sum": float, "plays_sum": int}}
        "conversions": {},
        "leadscore_values": [],
    }

    # Series accumulator (5 dias)
    series_acc: Dict[str, Any] = {
        "impressions": {d: 0 for d in axis},
        "clicks": {d: 0 for d in axis},
        "inline": {d: 0 for d in axis},
        "spend": {d: 0.0 for d in axis},
        "plays": {d: 0 for d in axis},
        "lpv": {d: 0 for d in axis},
        "hook_wsum": {d: 0.0 for d in axis},
        "scroll_stop_wsum": {d: 0.0 for d in axis},
        "hold_rate_wsum": {d: 0.0 for d in axis},
        "video_watched_p50_wsum": {d: 0.0 for d in axis},
        "conversions": {d: {} for d in axis},
        "mql_count": {d: 0 for d in axis},
    }

    for r in data:
        # Preencher metadados uma vez (devem ser consistentes para o mesmo ad_id)
        if not agg["account_id"]:
            agg["account_id"] = r.get("account_id")
            agg["ad_name"] = r.get("ad_name")
            agg["campaign_name"] = r.get("campaign_name")
            agg["adset_name"] = r.get("adset_name")

        date = str(r.get("date"))[:10]
        clicks = int(r.get("clicks") or 0)
        impressions = int(r.get("impressions") or 0)
        inline_link_clicks = int(r.get("inline_link_clicks") or 0)
        spend = float(r.get("spend") or 0)
        leadscore_values = r.get("leadscore_values") or []
        plays = int(r.get("video_total_plays") or 0)
        thruplays = int(r.get("video_total_thruplays") or 0)
        curve = r.get("video_play_curve_actions") or []
        hook = _hook_at_3_from_curve(curve)
        hold_rate = float(r.get("hold_rate") or 0)
        _ss_raw = float(r.get("scroll_stop_value") or r.get("scroll_stop_rate") or 0)
        scroll_stop = _ss_raw / 100.0 if _ss_raw > 1 else _ss_raw
        video_watched_p50 = int(r.get("video_watched_p50") or 0)
        reach = int(r.get("reach") or 0)

        # landing_page_views (preferir coluna lpv quando disponÃ­vel)
        lpv = _extract_lpv(r)

        # Agregar totais
        agg["impressions"] += impressions
        agg["clicks"] += clicks
        agg["inline_link_clicks"] += inline_link_clicks
        agg["spend"] += spend
        agg["lpv"] += lpv
        agg["plays"] += plays
        agg["thruplays"] += thruplays
        agg["hook_wsum"] += hook * plays
        agg["hold_rate_wsum"] += hold_rate * plays
        agg["video_watched_p50_wsum"] += video_watched_p50 * plays
        agg["reach"] += reach

        if isinstance(leadscore_values, list) and len(leadscore_values) > 0:
            try:
                agg["leadscore_values"].extend([float(v) for v in leadscore_values if v is not None])
            except Exception:
                pass

        # Agregar curva de retenÃ§Ã£o ponderada por plays (mesma lÃ³gica do hook)
        if isinstance(curve, list) and plays > 0:
            try:
                for i, val in enumerate(curve):
                    val_num = int(val or 0)
                    if i not in agg["curve_weighted"]:
                        agg["curve_weighted"][i] = {"weighted_sum": 0.0, "plays_sum": 0}
                    agg["curve_weighted"][i]["weighted_sum"] += val_num * plays
                    agg["curve_weighted"][i]["plays_sum"] += plays
            except Exception:
                pass

        # Agregar conversions e actions
        _merge_row_conversions_actions(r, agg["conversions"])

        # SÃ©ries 5 dias
        if date in axis:
            series_acc["impressions"][date] += impressions
            series_acc["clicks"][date] += clicks
            series_acc["inline"][date] += inline_link_clicks
            series_acc["spend"][date] += spend
            series_acc["lpv"][date] += lpv
            series_acc["plays"][date] += plays
            series_acc["hook_wsum"][date] += hook * plays
            series_acc["scroll_stop_wsum"][date] += scroll_stop * plays
            series_acc["hold_rate_wsum"][date] += hold_rate * plays
            series_acc["video_watched_p50_wsum"][date] += video_watched_p50 * plays
            try:
                series_acc["mql_count"][date] += _count_mql(leadscore_values, mql_leadscore_min)
            except Exception:
                pass
            _merge_row_conversions_actions(r, series_acc["conversions"][date])

    # Buscar thumbnail e informaÃ§Ãµes adicionais da tabela ads
    thumbnail: Optional[str] = None
    try:
        ads_res = sb.table("ads").select("ad_id,thumb_storage_path,thumbnail_url,adcreatives_videos_thumbs,primary_video_id,media_type,creative_video_id").eq("user_id", user["user_id"]).eq("ad_id", ad_id).limit(1).execute()
        if ads_res.data:
            thumbnail = _get_storage_thumb_if_any(ads_res.data[0]) or _get_thumbnail_with_fallback(ads_res.data[0])
    except Exception as e:
        logger.warning(f"Erro ao buscar thumbnail (ad details): {e}")

    # Calcular mÃ©tricas derivadas
    ctr = _safe_div(agg["clicks"], agg["impressions"]) if agg["impressions"] else 0
    hook = _safe_div(agg["hook_wsum"], agg["plays"]) if agg["plays"] else 0
    hold_rate = _safe_div(agg["hold_rate_wsum"], agg["plays"]) if agg["plays"] else 0
    video_watched_p50 = _safe_div(agg["video_watched_p50_wsum"], agg["plays"]) if agg["plays"] else 0
    connect_rate = _safe_div(agg["lpv"], agg["inline_link_clicks"]) if agg["inline_link_clicks"] else 0
    cpm = (_safe_div(agg["spend"], agg["impressions"]) * 1000.0) if agg["impressions"] else 0
    website_ctr = _safe_div(agg["inline_link_clicks"], agg["impressions"]) if agg["impressions"] else 0
    frequency = round(agg["impressions"] / agg["reach"], 2) if agg["reach"] > 0 else None

    # Calcular curva de retenÃ§Ã£o agregada (mÃ©dia ponderada por plays)
    aggregated_curve: List[int] = []
    if agg.get("curve_weighted"):
        max_curve_len = max(agg["curve_weighted"].keys()) + 1 if agg["curve_weighted"] else 0
        for i in range(max_curve_len):
            if i in agg["curve_weighted"]:
                w = agg["curve_weighted"][i]
                if w["plays_sum"] > 0:
                    aggregated_curve.append(int(round(w["weighted_sum"] / w["plays_sum"])))
                else:
                    aggregated_curve.append(0)
            else:
                aggregated_curve.append(0)

    series = _build_rankings_series(axis, series_acc, include_cpmql=True)

    return {
        "account_id": agg["account_id"],
        "ad_id": agg["ad_id"],
        "ad_name": agg["ad_name"],
        "campaign_name": agg["campaign_name"],
        "adset_name": agg["adset_name"],
        "impressions": agg["impressions"],
        "clicks": agg["clicks"],
        "inline_link_clicks": agg["inline_link_clicks"],
        "spend": agg["spend"],
        "lpv": agg["lpv"],
        "plays": agg["plays"],
        "video_total_thruplays": agg["thruplays"],
        "hook": hook,
        "hold_rate": hold_rate,
        "video_watched_p50": int(round(video_watched_p50)) if video_watched_p50 else 0,
        "ctr": ctr,
        "connect_rate": connect_rate,
        "cpm": cpm,
        "website_ctr": website_ctr,
        "reach": agg["reach"],
        "frequency": frequency,
        "conversions": agg["conversions"],
        "leadscore_values": agg.get("leadscore_values") or [],
        "thumbnail": thumbnail,
        "video_play_curve_actions": aggregated_curve if aggregated_curve else None,
        "series": series,
    }


@router.get("/rankings/ad-id/{ad_id}/creative")
def get_ad_creative(ad_id: str, user=Depends(get_current_user)):
    """Retorna apenas creative e video_ids de um anÃºncio (leve, para uso em player de vÃ­deo)."""
    sb = get_supabase_for_user(user["token"])
    try:
        select_fields = "creative,adcreatives_videos_ids,creative_video_id,primary_video_id,media_type,thumbnail_url,video_owner_page_id"
        try:
            ads_res = sb.table("ads").select(select_fields).eq("user_id", user["user_id"]).eq("ad_id", ad_id).limit(1).execute()
        except Exception as select_error:
            if "primary_video_id" not in str(select_error) and "media_type" not in str(select_error):
                raise
            ads_res = sb.table("ads").select("creative,adcreatives_videos_ids,creative_video_id,thumbnail_url,video_owner_page_id").eq("user_id", user["user_id"]).eq("ad_id", ad_id).limit(1).execute()
        if ads_res.data and len(ads_res.data) > 0:
            ad_row = ads_res.data[0]
            creative = ad_row.get("creative") or {}
            oss = creative.get("object_story_spec") or {}
            asset_feed = creative.get("asset_feed_spec") or {}
            videos = asset_feed.get("videos") if isinstance(asset_feed, dict) else []
            derived_video_ids = []
            for candidate in [
                ad_row.get("primary_video_id"),
                *(ad_row.get("adcreatives_videos_ids") or []),
                creative.get("video_id"),
                ad_row.get("creative_video_id"),
                (oss.get("video_data") or {}).get("video_id") if isinstance(oss, dict) else None,
                (oss.get("link_data") or {}).get("video_id") if isinstance(oss, dict) else None,
            ]:
                candidate_str = str(candidate or "").strip()
                if candidate_str and candidate_str not in derived_video_ids:
                    derived_video_ids.append(candidate_str)
            if isinstance(videos, list):
                for video in videos:
                    if isinstance(video, dict):
                        candidate_str = str(video.get("video_id") or "").strip()
                        if candidate_str and candidate_str not in derived_video_ids:
                            derived_video_ids.append(candidate_str)
            if not creative.get("video_id") and derived_video_ids:
                creative["video_id"] = derived_video_ids[0]
            if not creative.get("actor_id") and isinstance(oss, dict):
                actor_id = str(oss.get("page_id") or oss.get("instagram_actor_id") or "").strip()
                if actor_id:
                    creative["actor_id"] = actor_id
            primary_video_id = str(ad_row.get("primary_video_id") or "").strip()
            if not primary_video_id and derived_video_ids:
                primary_video_id = derived_video_ids[0]
            media_type = str(ad_row.get("media_type") or "").strip()
            if not media_type:
                media_type = resolve_media_type(
                    {
                        **ad_row,
                        "creative": creative,
                        "primary_video_id": primary_video_id,
                        "adcreatives_videos_ids": derived_video_ids,
                    },
                    primary_video_id,
                )
            return {
                "creative": creative,
                "adcreatives_videos_ids": derived_video_ids,
                "creative_video_id": ad_row.get("creative_video_id"),
                "primary_video_id": primary_video_id or None,
                "media_type": media_type,
                "video_owner_page_id": ad_row.get("video_owner_page_id"),
            }
        return {"creative": {}, "adcreatives_videos_ids": [], "primary_video_id": None, "media_type": "unknown"}
    except Exception as e:
        logger.warning(f"Erro ao buscar creative para ad_id={ad_id}: {e}")
        return {"creative": {}, "adcreatives_videos_ids": [], "primary_video_id": None, "media_type": "unknown"}


@router.get("/rankings/ad-id/{ad_id}/history")
def get_ad_history(
    ad_id: str,
    date_start: str,
    date_stop: str,
    user=Depends(get_current_user)
):
    """Retorna dados histÃ³ricos diÃ¡rios de um anÃºncio para o perÃ­odo especificado.
    
    Retorna um array de objetos, um para cada dia do perÃ­odo, contendo todas as mÃ©tricas diÃ¡rias.
    """
    sb = get_supabase_for_user(user["token"])
    mql_leadscore_min = _get_user_mql_leadscore_min(sb, user["user_id"])

    # Gerar array de datas do perÃ­odo
    axis = _axis_date_range(date_start, date_stop)

    # Buscar dados diÃ¡rios do perÃ­odo
    def metrics_filters(q):
        return q.eq("ad_id", ad_id).gte("date", date_start).lte("date", date_stop)

    select_with_lpv = (
        "ad_id,ad_name,account_id,campaign_name,adset_name,date,clicks,impressions,inline_link_clicks,spend,"
        "video_total_plays,video_watched_p50,conversions,actions,video_play_curve_actions,"
        "hold_rate,scroll_stop_rate,reach,leadscore_values,lpv"
    )
    select_without_lpv = (
        "ad_id,ad_name,account_id,campaign_name,adset_name,date,clicks,impressions,inline_link_clicks,spend,"
        "video_total_plays,video_watched_p50,conversions,actions,video_play_curve_actions,"
        "hold_rate,scroll_stop_rate,reach,leadscore_values"
    )
    try:
        data = _fetch_all_paginated(sb, "ad_metrics", select_with_lpv, metrics_filters)
    except Exception as e:
        msg = str(e or "")
        if "lpv" in msg and ("column" in msg or "does not exist" in msg):
            logger.warning("[ad_history] Coluna `lpv` ausente no DB; seguindo sem ela (fallback via actions).")
            data = _fetch_all_paginated(sb, "ad_metrics", select_without_lpv, metrics_filters)
        else:
            raise

    # Criar mapa de dados por data
    data_by_date: Dict[str, Dict[str, Any]] = {}
    for r in data:
        date = str(r.get("date"))[:10]
        if date not in data_by_date:
            data_by_date[date] = {
                "date": date,
                "impressions": 0,
                "clicks": 0,
                "inline_link_clicks": 0,
                "spend": 0.0,
                "lpv": 0,
                "plays": 0,
                "hook_wsum": 0.0,
                "video_watched_p50_wsum": 0.0,
                "hold_rate_wsum": 0.0,
                "scroll_stop_wsum": 0.0,
                "reach": 0,
                "mql_count": 0,
                "conversions": {},
            }

        clicks = int(r.get("clicks") or 0)
        impressions = int(r.get("impressions") or 0)
        inline_link_clicks = int(r.get("inline_link_clicks") or 0)
        spend = float(r.get("spend") or 0)
        plays = int(r.get("video_total_plays") or 0)
        curve = r.get("video_play_curve_actions") or []
        hook = _hook_at_3_from_curve(curve)
        video_watched_p50 = int(r.get("video_watched_p50") or 0)
        hold_rate_val = float(r.get("hold_rate") or 0)
        _ss_raw = float(r.get("scroll_stop_value") or r.get("scroll_stop_rate") or 0)
        scroll_stop_val = _ss_raw / 100.0 if _ss_raw > 1 else _ss_raw
        reach = int(r.get("reach") or 0)
        leadscore_values = r.get("leadscore_values") or []

        # landing_page_views (preferir coluna lpv quando disponÃ­vel)
        lpv = _extract_lpv(r)

        # ConversÃµes e actions
        conversions = r.get("conversions") or {}
        if isinstance(conversions, list):
            for conv in conversions:
                if isinstance(conv, dict):
                    action_type = str(conv.get("action_type") or "")
                    value = int(conv.get("value") or 0)
                    if action_type:
                        key = f"conversion:{action_type}"
                        data_by_date[date]["conversions"][key] = data_by_date[date]["conversions"].get(key, 0) + value

        actions = r.get("actions") or {}
        if isinstance(actions, list):
            for action in actions:
                if isinstance(action, dict):
                    action_type = str(action.get("action_type") or "")
                    value = int(action.get("value") or 0)
                    if action_type:
                        key = f"action:{action_type}"
                        data_by_date[date]["conversions"][key] = data_by_date[date]["conversions"].get(key, 0) + value

        data_by_date[date]["impressions"] += impressions
        data_by_date[date]["clicks"] += clicks
        data_by_date[date]["inline_link_clicks"] += inline_link_clicks
        data_by_date[date]["spend"] += spend
        data_by_date[date]["lpv"] += lpv
        data_by_date[date]["plays"] += plays
        data_by_date[date]["hook_wsum"] += hook * plays
        data_by_date[date]["video_watched_p50_wsum"] += video_watched_p50 * plays
        data_by_date[date]["hold_rate_wsum"] += hold_rate_val * plays
        data_by_date[date]["scroll_stop_wsum"] += scroll_stop_val * plays
        data_by_date[date]["reach"] += reach
        data_by_date[date]["mql_count"] += _count_mql(leadscore_values, mql_leadscore_min)

    # Construir array de resultados com todas as datas do perÃ­odo
    result = []
    for date in axis:
        day_data = data_by_date.get(date, {
            "date": date,
            "impressions": 0,
            "clicks": 0,
            "inline_link_clicks": 0,
            "spend": 0.0,
            "lpv": 0,
            "plays": 0,
            "hook_wsum": 0.0,
            "video_watched_p50_wsum": 0.0,
            "hold_rate_wsum": 0.0,
            "scroll_stop_wsum": 0.0,
            "reach": 0,
            "mql_count": 0,
            "conversions": {},
        })

        # Calcular mÃ©tricas derivadas
        ctr = _safe_div(day_data["clicks"], day_data["impressions"])
        hook = _safe_div(day_data["hook_wsum"], day_data["plays"]) if day_data["plays"] else 0
        video_watched_p50 = _safe_div(day_data["video_watched_p50_wsum"], day_data["plays"]) if day_data["plays"] else 0
        connect_rate = _safe_div(day_data["lpv"], day_data["inline_link_clicks"]) if day_data["inline_link_clicks"] else 0
        cpm = (_safe_div(day_data["spend"], day_data["impressions"]) * 1000.0) if day_data["impressions"] else 0
        hold_rate = _safe_div(day_data["hold_rate_wsum"], day_data["plays"]) if day_data["plays"] else 0
        scroll_stop = _safe_div(day_data["scroll_stop_wsum"], day_data["plays"]) if day_data["plays"] else 0
        frequency = _safe_div(day_data["impressions"], day_data["reach"]) if day_data["reach"] else 0
        mqls = day_data["mql_count"]
        cpmql = _safe_div(day_data["spend"], mqls) if mqls else 0

        result.append({
            "date": date,
            "impressions": day_data["impressions"],
            "clicks": day_data["clicks"],
            "inline_link_clicks": day_data["inline_link_clicks"],
            "spend": day_data["spend"],
            "lpv": day_data["lpv"],
            "plays": day_data["plays"],
            "hook": hook,
            "video_watched_p50": int(round(video_watched_p50)) if video_watched_p50 else 0,
            "ctr": ctr,
            "connect_rate": connect_rate,
            "cpm": cpm,
            "hold_rate": hold_rate,
            "scroll_stop": scroll_stop,
            "frequency": frequency,
            "mqls": mqls,
            "cpmql": cpmql,
            "conversions": day_data["conversions"],
        })

    return {"data": result}


@router.get("/rankings/ad-name/{ad_name}/history")
def get_ad_name_history(
    ad_name: str,
    date_start: str,
    date_stop: str,
    user=Depends(get_current_user)
):
    """Retorna dados histÃ³ricos diÃ¡rios agregados por *ad_name* para o perÃ­odo especificado.

    Soma mÃ©tricas de todos os `ad_metrics` que possuem o mesmo `ad_name`, agrupando por `date`.
    """
    sb = get_supabase_for_user(user["token"])
    mql_leadscore_min = _get_user_mql_leadscore_min(sb, user["user_id"])

    # Gerar array de datas do perÃ­odo (inclusive)
    axis = _axis_date_range(date_start, date_stop)

    # Buscar dados diÃ¡rios do perÃ­odo filtrando por ad_name
    def metrics_filters(q):
        return q.eq("ad_name", ad_name).gte("date", date_start).lte("date", date_stop)

    select_with_lpv = (
        "ad_id,ad_name,account_id,campaign_name,adset_name,date,clicks,impressions,inline_link_clicks,spend,"
        "video_total_plays,video_watched_p50,conversions,actions,video_play_curve_actions,"
        "hold_rate,scroll_stop_rate,reach,leadscore_values,lpv"
    )
    select_without_lpv = (
        "ad_id,ad_name,account_id,campaign_name,adset_name,date,clicks,impressions,inline_link_clicks,spend,"
        "video_total_plays,video_watched_p50,conversions,actions,video_play_curve_actions,"
        "hold_rate,scroll_stop_rate,reach,leadscore_values"
    )
    try:
        data = _fetch_all_paginated(sb, "ad_metrics", select_with_lpv, metrics_filters)
    except Exception as e:
        msg = str(e or "")
        if "lpv" in msg and ("column" in msg or "does not exist" in msg):
            logger.warning("[ad_name_history] Coluna `lpv` ausente no DB; seguindo sem ela (fallback via actions).")
            data = _fetch_all_paginated(sb, "ad_metrics", select_without_lpv, metrics_filters)
        else:
            raise

    # Agregar por data
    data_by_date: Dict[str, Dict[str, Any]] = {}
    for r in data:
        date = str(r.get("date"))[:10]
        if date not in data_by_date:
            data_by_date[date] = {
                "date": date,
                "impressions": 0,
                "clicks": 0,
                "inline_link_clicks": 0,
                "spend": 0.0,
                "lpv": 0,
                "plays": 0,
                "hook_wsum": 0.0,
                "video_watched_p50_wsum": 0.0,
                "hold_rate_wsum": 0.0,
                "scroll_stop_wsum": 0.0,
                "reach": 0,
                "mql_count": 0,
                "conversions": {},
            }

        clicks = int(r.get("clicks") or 0)
        impressions = int(r.get("impressions") or 0)
        inline_link_clicks = int(r.get("inline_link_clicks") or 0)
        spend = float(r.get("spend") or 0)
        plays = int(r.get("video_total_plays") or 0)
        curve = r.get("video_play_curve_actions") or []
        hook = _hook_at_3_from_curve(curve)
        video_watched_p50 = int(r.get("video_watched_p50") or 0)
        hold_rate_val = float(r.get("hold_rate") or 0)
        _ss_raw = float(r.get("scroll_stop_value") or r.get("scroll_stop_rate") or 0)
        scroll_stop_val = _ss_raw / 100.0 if _ss_raw > 1 else _ss_raw
        reach = int(r.get("reach") or 0)
        leadscore_values = r.get("leadscore_values") or []

        # landing_page_views (preferir coluna lpv quando disponÃ­vel)
        lpv = _extract_lpv(r)

        # ConversÃµes e actions
        conversions = r.get("conversions") or {}
        if isinstance(conversions, list):
            for conv in conversions:
                if isinstance(conv, dict):
                    action_type = str(conv.get("action_type") or "")
                    value = int(conv.get("value") or 0)
                    if action_type:
                        key = f"conversion:{action_type}"
                        data_by_date[date]["conversions"][key] = data_by_date[date]["conversions"].get(key, 0) + value

        actions = r.get("actions") or {}
        if isinstance(actions, list):
            for action in actions:
                if isinstance(action, dict):
                    action_type = str(action.get("action_type") or "")
                    value = int(action.get("value") or 0)
                    if action_type:
                        key = f"action:{action_type}"
                        data_by_date[date]["conversions"][key] = data_by_date[date]["conversions"].get(key, 0) + value

        data_by_date[date]["impressions"] += impressions
        data_by_date[date]["clicks"] += clicks
        data_by_date[date]["inline_link_clicks"] += inline_link_clicks
        data_by_date[date]["spend"] += spend
        data_by_date[date]["lpv"] += lpv
        data_by_date[date]["plays"] += plays
        data_by_date[date]["hook_wsum"] += hook * plays
        data_by_date[date]["video_watched_p50_wsum"] += video_watched_p50 * plays
        data_by_date[date]["hold_rate_wsum"] += hold_rate_val * plays
        data_by_date[date]["scroll_stop_wsum"] += scroll_stop_val * plays
        data_by_date[date]["reach"] += reach
        data_by_date[date]["mql_count"] += _count_mql(leadscore_values, mql_leadscore_min)

    # Construir array de resultados com todas as datas do perÃ­odo
    result: List[Dict[str, Any]] = []
    for date in axis:
        day_data = data_by_date.get(date, {
            "date": date,
            "impressions": 0,
            "clicks": 0,
            "inline_link_clicks": 0,
            "spend": 0.0,
            "lpv": 0,
            "plays": 0,
            "hook_wsum": 0.0,
            "video_watched_p50_wsum": 0.0,
            "hold_rate_wsum": 0.0,
            "scroll_stop_wsum": 0.0,
            "reach": 0,
            "mql_count": 0,
            "conversions": {},
        })

        ctr = _safe_div(day_data["clicks"], day_data["impressions"])
        hook_val = _safe_div(day_data["hook_wsum"], day_data["plays"]) if day_data["plays"] else 0
        video_watched_p50_val = _safe_div(day_data["video_watched_p50_wsum"], day_data["plays"]) if day_data["plays"] else 0
        connect_rate = _safe_div(day_data["lpv"], day_data["inline_link_clicks"]) if day_data["inline_link_clicks"] else 0
        cpm = (_safe_div(day_data["spend"], day_data["impressions"]) * 1000.0) if day_data["impressions"] else 0
        hold_rate = _safe_div(day_data["hold_rate_wsum"], day_data["plays"]) if day_data["plays"] else 0
        scroll_stop = _safe_div(day_data["scroll_stop_wsum"], day_data["plays"]) if day_data["plays"] else 0
        frequency = _safe_div(day_data["impressions"], day_data["reach"]) if day_data["reach"] else 0
        mqls = day_data["mql_count"]
        cpmql = _safe_div(day_data["spend"], mqls) if mqls else 0

        result.append({
            "date": date,
            "impressions": day_data["impressions"],
            "clicks": day_data["clicks"],
            "inline_link_clicks": day_data["inline_link_clicks"],
            "spend": day_data["spend"],
            "lpv": day_data["lpv"],
            "plays": day_data["plays"],
            "hook": hook_val,
            "video_watched_p50": int(round(video_watched_p50_val)) if video_watched_p50_val else 0,
            "ctr": ctr,
            "connect_rate": connect_rate,
            "cpm": cpm,
            "hold_rate": hold_rate,
            "scroll_stop": scroll_stop,
            "frequency": frequency,
            "mqls": mqls,
            "cpmql": cpmql,
            "conversions": day_data["conversions"],
        })

    return {"data": result}

@router.post("/dashboard")
def get_dashboard(req: DashboardRequest, user=Depends(get_current_user)):
    sb = get_supabase_for_user(user["token"])
    
    # Usar paginaÃ§Ã£o para contornar limite de 1000 linhas do Supabase
    def metrics_filters(q):
        q = q.gte("date", req.date_start).lte("date", req.date_stop)
        if req.adaccount_ids:
            q = q.in_("account_id", req.adaccount_ids)
        return q
    
    rows = _fetch_all_paginated(
        sb,
        "ad_metrics",
        "clicks,impressions,inline_link_clicks,reach,video_total_plays,video_total_thruplays,spend,cpm,ctr,frequency,website_ctr,conversions,actions",
        metrics_filters
    )

    totals = {
        "spend": 0.0,
        "impressions": 0,
        "reach": 0,
        "clicks": 0,
        "inline_link_clicks": 0,
        "video_total_plays": 0,
        "video_total_thruplays": 0,
        "lpv": 0,
    }

    for r in rows:
        totals["spend"] += float(r.get("spend") or 0)
        totals["impressions"] += int(r.get("impressions") or 0)
        totals["reach"] += int(r.get("reach") or 0)
        totals["clicks"] += int(r.get("clicks") or 0)
        totals["inline_link_clicks"] += int(r.get("inline_link_clicks") or 0)
        totals["video_total_plays"] += int(r.get("video_total_plays") or 0)
        totals["video_total_thruplays"] += int(r.get("video_total_thruplays") or 0)
        try:
            for a in (r.get("actions") or []):
                if str(a.get("action_type")) == "landing_page_view":
                    totals["lpv"] += int(a.get("value") or 0)
        except Exception:
            pass

    ctr = _safe_div(totals["clicks"], totals["impressions"])
    cpm = (_safe_div(totals["spend"], totals["impressions"]) * 1000.0)
    frequency = _safe_div(totals["impressions"], totals["reach"]) if totals["reach"] else 0
    website_ctr = _safe_div(totals["inline_link_clicks"], totals["impressions"]) if totals["impressions"] else 0
    connect_rate = _safe_div(totals["lpv"], totals["inline_link_clicks"]) if totals["inline_link_clicks"] else 0

    return {
        "totals": {
            **totals,
            "ctr": ctr,
            "cpm": cpm,
            "frequency": frequency,
            "website_ctr": website_ctr,
            "connect_rate": connect_rate,
        }
    }


@router.get("/packs")
def list_packs(user=Depends(get_current_user), include_ads: bool = Query(default=False)):
    """Lista todos os packs do usuÃ¡rio do Supabase.
    
    Args:
        include_ads: Se True, tambÃ©m busca os ads de cada pack (pode ser lento)
    """
    try:
        packs = supabase_repo.list_packs(user["token"], user["user_id"])
        
        # Garantir que todos os packs tenham stats calculados
        # Se stats estiver ausente, vazio ou invÃ¡lido, calcular dinamicamente
        for pack in packs:
            pack_id = pack.get("id")
            if not pack_id:
                continue
                
            stats = pack.get("stats")
            # Verificar se stats estÃ¡ ausente, None, vazio ou invÃ¡lido
            if not stats or not isinstance(stats, dict) or len(stats) == 0 or stats.get("totalSpend") is None:
                # Calcular stats essenciais dinamicamente (fallback para packs legados)
                calculated_stats = supabase_repo.calculate_pack_stats_essential(
                    user["token"],
                    pack_id,
                    user_id=user["user_id"]
                )
                if calculated_stats:
                    # Atualizar pack com stats calculados
                    pack["stats"] = calculated_stats
                    # Salvar stats no banco para prÃ³ximas consultas
                    try:
                        supabase_repo.update_pack_stats(
                            user["token"],
                            pack_id,
                            calculated_stats,
                            user_id=user["user_id"]
                        )
                        logger.info(f"[LIST_PACKS] Stats calculados e salvos para pack {pack_id}")
                    except Exception as update_error:
                        logger.warning(f"[LIST_PACKS] Erro ao salvar stats do pack {pack_id}: {update_error}")
                        # Continuar mesmo se falhar ao salvar - stats jÃ¡ estÃ£o no pack
        
        # Se solicitado, buscar ads para cada pack
        if include_ads:
            packs_with_ads = []
            for pack in packs:
                ads = supabase_repo.get_ads_for_pack(user["token"], pack, user["user_id"])
                pack["ads"] = ads
                packs_with_ads.append(pack)
            return {"success": True, "packs": packs_with_ads}
        
        return {"success": True, "packs": packs}
    except Exception as e:
        logger.exception(f"Erro ao listar packs: {e}")
        raise HTTPException(status_code=500, detail=f"Erro ao listar packs: {str(e)}")


@router.get("/packs/{pack_id}")
def get_pack(pack_id: str, user=Depends(get_current_user), include_ads: bool = Query(default=True)):
    """Busca um pack especÃ­fico do Supabase.
    
    Args:
        include_ads: Se True, tambÃ©m busca os ads do pack (padrÃ£o: True)
    """
    try:
        pack = supabase_repo.get_pack(user["token"], pack_id, user["user_id"])
        if not pack:
            raise HTTPException(status_code=404, detail="Pack nÃ£o encontrado")
        
        # Garantir que o pack tenha stats calculados
        # Se stats estiver ausente, vazio ou invÃ¡lido, calcular dinamicamente
        stats = pack.get("stats")
        if not stats or not isinstance(stats, dict) or len(stats) == 0 or stats.get("totalSpend") is None:
            # Calcular stats essenciais dinamicamente (fallback para packs legados)
            calculated_stats = supabase_repo.calculate_pack_stats_essential(
                user["token"],
                pack_id,
                user_id=user["user_id"]
            )
            if calculated_stats:
                # Atualizar pack com stats calculados
                pack["stats"] = calculated_stats
                # Salvar stats no banco para prÃ³ximas consultas
                try:
                    supabase_repo.update_pack_stats(
                        user["token"],
                        pack_id,
                        calculated_stats,
                        user_id=user["user_id"]
                    )
                    logger.info(f"[GET_PACK] Stats calculados e salvos para pack {pack_id}")
                except Exception as update_error:
                    logger.warning(f"[GET_PACK] Erro ao salvar stats do pack {pack_id}: {update_error}")
                    # Continuar mesmo se falhar ao salvar - stats jÃ¡ estÃ£o no pack
        
        # Buscar ads se solicitado
        if include_ads:
            ads = supabase_repo.get_ads_for_pack(user["token"], pack, user["user_id"])
            pack["ads"] = ads
        
        return {"success": True, "pack": pack}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Erro ao buscar pack {pack_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Erro ao buscar pack: {str(e)}")


@router.get("/packs/{pack_id}/thumbnail-cache")
def get_pack_thumbnail_cache(pack_id: str, user=Depends(get_current_user)):
    """Busca apenas o patch de thumbnails Storage dos ads de um pack."""
    try:
        pack = supabase_repo.get_pack(user["token"], pack_id, user["user_id"])
        if not pack:
            raise HTTPException(status_code=404, detail="Pack nÃƒÂ£o encontrado")

        thumbnails = supabase_repo.get_pack_thumbnail_cache(user["token"], pack, user["user_id"])
        ready_count = sum(1 for thumb in thumbnails if thumb.get("thumb_storage_path"))
        total = len(thumbnails)
        return {
            "success": True,
            "pack_id": pack_id,
            "thumbnails": thumbnails,
            "ready": total > 0 and ready_count == total,
            "ready_count": ready_count,
            "total": total,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Erro ao buscar thumbnail cache do pack {pack_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Erro ao buscar thumbnail cache: {str(e)}")


@router.delete("/packs/{pack_id}")
def delete_pack(
    pack_id: str,
    request: DeletePackRequest = Body(...),
    user=Depends(get_current_user)
):
    """Deleta um pack e todos os dados relacionados (ads e ad_metrics) em cascata."""
    try:
        result = supabase_repo.delete_pack(
            user["token"],
            pack_id=pack_id,
            ad_ids=request.ad_ids or [],  # Opcional, backend busca do pack se nÃ£o fornecido
            user_id=user["user_id"]
        )
        
        return {
            "success": True,
            "pack_id": pack_id,
            "stats": {
                "pack_deleted": result.get("pack_deleted", False),
                "ads_deleted": result.get("ads_deleted", 0),
                "metrics_deleted": result.get("metrics_deleted", 0),
                "storage_thumbs_candidates": result.get("storage_thumbs_candidates", 0),
                "storage_thumbs_deleted": result.get("storage_thumbs_deleted", 0),
                "storage_thumbs_kept": result.get("storage_thumbs_kept", 0),
            }
        }
    except Exception as e:
        logger.exception(f"Erro ao deletar pack {pack_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Erro ao deletar pack: {str(e)}")


@router.patch("/packs/{pack_id}/auto-refresh")
def update_pack_auto_refresh(
    pack_id: str,
    request: UpdatePackAutoRefreshRequest = Body(...),
    user=Depends(get_current_user)
):
    """Atualiza o campo auto_refresh de um pack."""
    try:
        # Verificar se o pack existe e pertence ao usuÃ¡rio
        pack = supabase_repo.get_pack(user["token"], pack_id, user["user_id"])
        if not pack:
            raise HTTPException(status_code=404, detail="Pack nÃ£o encontrado")
        
        # Atualizar auto_refresh
        supabase_repo.update_pack_auto_refresh(
            user["token"],
            pack_id,
            user["user_id"],
            request.auto_refresh
        )
        
        return {
            "success": True,
            "pack_id": pack_id,
            "auto_refresh": request.auto_refresh
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Erro ao atualizar auto_refresh do pack {pack_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Erro ao atualizar auto_refresh: {str(e)}")


@router.patch("/packs/{pack_id}/name")
def update_pack_name(
    pack_id: str,
    request: UpdatePackNameRequest = Body(...),
    user=Depends(get_current_user)
):
    """Atualiza o nome de um pack."""
    try:
        # Verificar se o pack existe e pertence ao usuÃ¡rio
        pack = supabase_repo.get_pack(user["token"], pack_id, user["user_id"])
        if not pack:
            raise HTTPException(status_code=404, detail="Pack nÃ£o encontrado")
        
        # Validar nome
        if not request.name or not request.name.strip():
            raise HTTPException(status_code=400, detail="Nome do pack nÃ£o pode ser vazio")
        
        # Atualizar nome
        supabase_repo.update_pack_name(
            user["token"],
            pack_id,
            user["user_id"],
            request.name.strip()
        )
        
        return {
            "success": True,
            "pack_id": pack_id,
            "name": request.name.strip()
        }
    except HTTPException:
        raise
    except ValueError as e:
        # Tratar erros de validaÃ§Ã£o (nome vazio ou duplicado)
        error_msg = str(e)
        if "jÃ¡ existe" in error_msg.lower() or "already exists" in error_msg.lower():
            raise HTTPException(status_code=409, detail=error_msg)
        raise HTTPException(status_code=400, detail=error_msg)
    except Exception as e:
        logger.exception(f"Erro ao atualizar nome do pack {pack_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Erro ao atualizar nome: {str(e)}")


@router.get("/transcription")
def get_transcription(
    ad_name: str = Query(None, description="Nome do anÃºncio (alternativa a transcription_id)"),
    transcription_id: str = Query(None, description="ID da transcriÃ§Ã£o (lookup O(1) quando o ad jÃ¡ tem transcription_id)"),
    user: Dict[str, Any] = Depends(get_current_user),
):
    """Retorna a transcriÃ§Ã£o por transcription_id ou ad_name. Exatamente um deve ser fornecido."""
    tid = (transcription_id or "").strip()
    aname = (ad_name or "").strip()
    if tid and aname:
        raise HTTPException(status_code=400, detail="ForneÃ§a apenas transcription_id ou ad_name, nÃ£o ambos")
    if not tid and not aname:
        raise HTTPException(status_code=400, detail="ForneÃ§a transcription_id ou ad_name")

    if tid:
        result = supabase_repo.get_transcription_by_id(user["token"], user["user_id"], tid)
        if not result:
            raise HTTPException(status_code=404, detail=f"TranscriÃ§Ã£o nÃ£o encontrada para id={tid!r}")
    else:
        result = supabase_repo.get_transcription(user["token"], user["user_id"], aname)
        if not result:
            raise HTTPException(status_code=404, detail=f"TranscriÃ§Ã£o nÃ£o encontrada para ad_name={aname!r}")

    return {
        "id": result.get("id"),
        "ad_name": result.get("ad_name"),
        "status": result.get("status"),
        "full_text": result.get("full_text"),
        "timestamped_text": result.get("timestamped_text"),
        "metadata": result.get("metadata"),
        "updated_at": result.get("updated_at"),
    }
