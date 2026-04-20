from datetime import datetime, timedelta
from typing import Dict, List, Any

from app.services.ad_media import resolve_media_type, resolve_primary_video_id

def split_date_range(date_range: Dict[str, str], max_days: int = 7) -> List[Dict[str, str]]:
    start_date = datetime.strptime(date_range["since"], "%Y-%m-%d")
    end_date = datetime.strptime(date_range["until"], "%Y-%m-%d")
    if start_date == end_date:
        return [date_range]
    chunks: List[Dict[str, str]] = []
    current = start_date
    while current < end_date:
        chunk_end = min(current + timedelta(days=max_days - 1), end_date)
        chunks.append({"since": current.strftime("%Y-%m-%d"), "until": chunk_end.strftime("%Y-%m-%d")})
        current = chunk_end + timedelta(days=1)
    return chunks

# ========================= API FORMATTER ========================= #
def _to_number(value: Any, default: float = 0) -> float:
    try:
        if value is None:
            return default
        if isinstance(value, (int, float)):
            return float(value)
        return float(str(value))
    except Exception:
        return default

def _first_value_from_array(arr: Any) -> float:
    if isinstance(arr, list) and len(arr) > 0:
        first = arr[0]
        if isinstance(first, dict) and "value" in first:
            return _to_number(first.get("value"), 0)
        return _to_number(first, 0)
    return 0.0

def _normalize_actions(actions: Any) -> List[Dict[str, Any]]:
    if not isinstance(actions, list):
        return []
    normalized: List[Dict[str, Any]] = []
    for item in actions:
        if not isinstance(item, dict):
            continue
        action_type = item.get("action_type")
        value = _to_number(item.get("value"), 0)
        if action_type is not None:
            normalized.append({"action_type": str(action_type), "value": value})
    return normalized

def _normalize_curve(curve: Any) -> List[float]:
    if isinstance(curve, list) and len(curve) > 0 and isinstance(curve[0], dict) and "value" in curve[0]:
        value_list = curve[0].get("value", [])
        if isinstance(value_list, list):
            return [ _to_number(v, 0) for v in value_list ]
        return []
    if isinstance(curve, list) and (len(curve) == 0 or isinstance(curve[0], (int, float))):
        return [ _to_number(v, 0) for v in curve ]
    return []

def format_ads_for_api(json_data: List[Dict[str, Any]], account_id: str) -> List[Dict[str, Any]]:
    """Converte os registros brutos da Meta API para o formato do FormattedAdSchema (frontend).

    Mantém estruturas nested (ex.: creative) e arrays (actions, conversions, cost_per_conversion).
    Calcula e renomeia métricas derivadas, garantindo tipos numéricos corretos.
    """
    formatted: List[Dict[str, Any]] = []

    for ad in json_data or []:
        # Métricas base
        spend = _to_number(ad.get("spend", 0))
        cpm = _to_number(ad.get("cpm", 0))
        impressions = int(_to_number(ad.get("impressions", 0)))
        reach = int(_to_number(ad.get("reach", 0)))
        frequency = _to_number(ad.get("frequency", 0))
        clicks = int(_to_number(ad.get("clicks", 0)))
        inline_link_clicks = int(_to_number(ad.get("inline_link_clicks", 0)))
        ctr = _to_number(ad.get("ctr", 0)) / 100
        website_ctr = _first_value_from_array(ad.get("website_ctr", [])) / 100

        # Vídeo e curva
        total_plays = int(_first_value_from_array(ad.get("video_play_actions", [])))
        video_thruplay_watched_actions_raw = ad.get("video_thruplay_watched_actions", [])
        total_thruplays = int(_first_value_from_array(video_thruplay_watched_actions_raw))
        p50 = int(_first_value_from_array(ad.get("video_p50_watched_actions", [])))
        video_watched_p50 = int(round((p50 / total_plays) * 100)) if total_plays else 0
        curve = _normalize_curve(ad.get("video_play_curve_actions", []))

        # Actions / Conversions
        actions = _normalize_actions(ad.get("actions", []))
        conversions = _normalize_actions(ad.get("conversions", []))
        cost_per_conversion = _normalize_actions(ad.get("cost_per_conversion", []))

        # Derivadas
        lpv = 0.0
        for a in actions:
            if a.get("action_type") == "landing_page_view":
                lpv = _to_number(a.get("value"), 0)
                break
        connect_rate = (lpv / inline_link_clicks) if inline_link_clicks else 0.0
        profile_ctr = (ctr - website_ctr if website_ctr is not None else ctr)

        # Creative e videos (já enriquecidos em graph_api)
        creative = ad.get("creative") or {}
        adcreatives_videos_ids = ad.get("adcreatives_videos_ids") or []
        adcreatives_videos_thumbs = ad.get("adcreatives_videos_thumbs") or []

        # Data diária do insight (com time_increment=1, start == stop)
        day = str(ad.get("date_start", "")) or str(ad.get("date_stop", ""))

        # Montagem final
        formatted_ad = {
            # Identificadores
            "account_id": str(account_id),
            "ad_id": str(ad.get("ad_id", "")),
            "ad_name": str(ad.get("ad_name", "")),
            "adset_id": str(ad.get("adset_id", "")),
            "adset_name": str(ad.get("adset_name", "")),
            "campaign_id": str(ad.get("campaign_id", "")),
            "campaign_name": str(ad.get("campaign_name", "")),
            "effective_status": str(ad.get("effective_status", "")) if ad.get("effective_status") else None,

            # Métricas inteiras
            "clicks": clicks,
            "impressions": impressions,
            "inline_link_clicks": inline_link_clicks,
            "reach": reach,
            "video_total_plays": total_plays,
            "video_total_thruplays": total_thruplays,
            "video_watched_p50": video_watched_p50,

            # Métricas float
            "spend": spend,
            "cpm": cpm,
            "ctr": ctr,
            "frequency": frequency,
            "website_ctr": website_ctr,

            # Arrays
            "actions": actions,
            "conversions": conversions if conversions else None,
            "cost_per_conversion": cost_per_conversion if cost_per_conversion else None,
            "video_play_curve_actions": curve,

            # Creative
            "creative": creative or {},

            # Videos associados
            "adcreatives_videos_ids": [str(v) for v in adcreatives_videos_ids if v],
            "adcreatives_videos_thumbs": [str(v) for v in adcreatives_videos_thumbs if v],

            # Derivadas
            "connect_rate": connect_rate,
            "profile_ctr": profile_ctr,

            # Data do registro (útil para agrupamentos no frontend)
            "date": day,
        }
        primary_video_id = resolve_primary_video_id(formatted_ad)
        formatted_ad["primary_video_id"] = primary_video_id
        formatted_ad["media_type"] = resolve_media_type(formatted_ad, primary_video_id)
        formatted.append(formatted_ad)

    return formatted
