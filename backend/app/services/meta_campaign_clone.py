from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Set

logger = logging.getLogger(__name__)

_OBJECT_STORY_ACTOR_KEYS: tuple[str, ...] = (
    "page_id",
    "instagram_user_id",
    "instagram_actor_id",
    "actor_id",
)


def _normalize_object_story_spec(raw: Any) -> Dict[str, Any]:
    if raw is None:
        return {}
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
            return parsed if isinstance(parsed, dict) else {}
        except (json.JSONDecodeError, TypeError):
            return {}
    return raw if isinstance(raw, dict) else {}


def _merge_actor_from_mapping(src: Dict[str, Any], dest: Dict[str, Any]) -> None:
    for k in _OBJECT_STORY_ACTOR_KEYS:
        v = src.get(k)
        if v not in (None, "") and k not in dest:
            dest[k] = str(v)


def object_story_actor_from_creative(creative: Dict[str, Any]) -> Dict[str, Any]:
    """
    Extrai page_id / atores do creative.object_story_spec.
    A Meta as vezes aninha page_id em link_data, video_data ou child_attachments.
    """
    oss = _normalize_object_story_spec(creative.get("object_story_spec"))
    out: Dict[str, Any] = {}
    _merge_actor_from_mapping(oss, out)
    for child_key in ("link_data", "video_data", "photo_data"):
        child = oss.get(child_key)
        if isinstance(child, dict):
            _merge_actor_from_mapping(child, out)
    children = oss.get("child_attachments")
    if isinstance(children, list):
        for ch in children:
            if isinstance(ch, dict):
                _merge_actor_from_mapping(ch, out)
                ld = ch.get("link_data")
                if isinstance(ld, dict):
                    _merge_actor_from_mapping(ld, out)
    return out


def merge_page_id_from_promoted_object(
    object_story_actor: Dict[str, Any],
    promoted_object: Optional[Dict[str, Any]],
) -> None:
    """Preenche page_id a partir do promoted_object do ad set (criativos so com asset_feed_spec)."""
    if object_story_actor.get("page_id") or not isinstance(promoted_object, dict):
        return
    pid = promoted_object.get("page_id")
    if pid not in (None, ""):
        object_story_actor["page_id"] = str(pid)

# Campos opcionais da campanha (GET) que podem ser repassados no POST se ainda não definidos.
CAMPAIGN_CREATE_EXTRA_KEYS: Set[str] = frozenset(
    {
        "spend_cap",
        "special_ad_category_country",
    },
)

READONLY_CAMPAIGN_KEYS: Set[str] = frozenset(
    {
        "id",
        "account_id",
        "effective_status",
        "configured_status",
        "issues_info",
        "recommendations",
    },
)

READONLY_ADSET_KEYS: Set[str] = frozenset(
    {
        "id",
        "account_id",
        "campaign_id",
        "effective_status",
        "configured_status",
        "issues_info",
        "recommendations",
        "bid_info",
        "budget_remaining",
    },
)

# Campos de ad set (além dos obrigatórios manuais) seguros para clonar no POST.
ADSET_CLONE_FIELD_KEYS: tuple[str, ...] = (
    "targeting",
    "bid_amount",
    "promoted_object",
    "attribution_spec",
    "destination_type",
    "frequency_control_specs",
    "bid_constraints",
    "pacing_type",
    "start_time",
    "end_time",
    "bid_strategy",
)


def _positive_budget(val: Any) -> bool:
    try:
        if val is None:
            return False
        return int(val) > 0
    except (TypeError, ValueError):
        return False


def campaign_has_campaign_level_budget(campaign_params: Dict[str, Any]) -> bool:
    """
    True se a campanha nova usa orçamento no nível de campanha (CBO).
    Nesse caso os ad sets não devem enviar daily_budget/lifetime_budget.
    """
    return _positive_budget(campaign_params.get("daily_budget")) or _positive_budget(
        campaign_params.get("lifetime_budget"),
    )


def adset_budget_params_from_template(
    adset_cfg: Dict[str, Any],
    campaign_uses_cbo: bool,
) -> Dict[str, Any]:
    """Retorna apenas daily_budget ou lifetime_budget do template, exceto em CBO."""
    if campaign_uses_cbo:
        return {}
    out: Dict[str, Any] = {}
    if _positive_budget(adset_cfg.get("daily_budget")):
        out["daily_budget"] = adset_cfg["daily_budget"]
    elif _positive_budget(adset_cfg.get("lifetime_budget")):
        out["lifetime_budget"] = adset_cfg["lifetime_budget"]
    return out


def merge_template_campaign_fields(
    campaign_params: Dict[str, Any],
    campaign_template: Dict[str, Any],
) -> None:
    """
    Copia campos opcionais permitidos do GET da campanha modelo para o POST.
    Não sobrescreve chaves já definidas em campaign_params.
    """
    for key in CAMPAIGN_CREATE_EXTRA_KEYS:
        if key in campaign_params:
            continue
        if key in READONLY_CAMPAIGN_KEYS:
            continue
        if key not in campaign_template:
            continue
        val = campaign_template[key]
        if val is None:
            continue
        campaign_params[key] = val


def _normalize_graph_iso_datetime(s: str) -> str:
    """Graph API costuma enviar offset +0000 sem ':' — fromisoformat exige +00:00."""
    s = s.strip()
    # Sufixo [+-]HHMM (4 dígitos) sem dois pontos
    if len(s) >= 6 and s[-5] in "+-" and s[-4:].isdigit():
        return f"{s[:-5]}{s[-5]}{s[-4:-2]}:{s[-2:]}"
    return s


def _parse_meta_datetime(val: Any) -> Optional[datetime]:
    """Converte start_time/end_time retornados pela Graph API para datetime em UTC."""
    if val is None:
        return None
    if isinstance(val, (int, float)):
        try:
            return datetime.fromtimestamp(float(val), tz=timezone.utc)
        except (OSError, ValueError, OverflowError):
            return None
    s = str(val).strip()
    if not s:
        return None
    if s.isdigit():
        try:
            return datetime.fromtimestamp(int(s), tz=timezone.utc)
        except (OSError, ValueError, OverflowError):
            return None
    try:
        iso = _normalize_graph_iso_datetime(s.replace("Z", "+00:00"))
        dt = datetime.fromisoformat(iso)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except ValueError:
        return None


def _drop_adset_schedule_if_end_in_past(cloned: Dict[str, Any]) -> None:
    """
    Remove start_time/end_time se end_time do modelo ja passou.
    Evita OAuthException 100 / subcode 1487033 (time_stop no passado).
    """
    end_raw = cloned.get("end_time")
    if end_raw is None:
        return
    end_dt = _parse_meta_datetime(end_raw)
    if end_dt is None:
        return
    if end_dt > datetime.now(timezone.utc):
        return
    cloned.pop("start_time", None)
    cloned.pop("end_time", None)
    logger.debug(
        "adset_clone: removido agendamento (end_time modelo no passado), "
        "novo ad set fica sem datas — defina no Ads Manager se precisar."
    )


def adset_clone_fields_for_create(adset_cfg: Dict[str, Any]) -> Dict[str, Any]:
    """Subconjunto do ad set lido na Graph API que é aceito na criação (sem id, sem orçamento)."""
    out: Dict[str, Any] = {}
    for k in ADSET_CLONE_FIELD_KEYS:
        if k in READONLY_ADSET_KEYS:
            continue
        if k not in adset_cfg:
            continue
        v = adset_cfg[k]
        if v is not None:
            out[k] = v
    _drop_adset_schedule_if_end_in_past(out)
    return out


def resolve_creative_destination_url(creative_data: Dict[str, Any]) -> Optional[str]:
    """link_url no criativo ou call_to_action.value.link."""
    u = creative_data.get("link_url")
    if u:
        s = str(u).strip()
        if s:
            return s
    cta = creative_data.get("call_to_action")
    if isinstance(cta, dict):
        val = cta.get("value")
        if isinstance(val, dict):
            link = val.get("link")
            if link:
                s = str(link).strip()
                if s:
                    return s
    return None


# CTAs que tipicamente não exigem website_url no asset_feed_spec (heurística).
_CTAS_WITHOUT_WEBSITE_URL: Set[str] = frozenset(
    {
        "",
        "LIKE_PAGE",
        "MESSAGE_PAGE",
        "INSTAGRAM_MESSAGE",
        "WHATSAPP_MESSAGE",
        "CALL_NOW",
    },
)


def asset_feed_requires_destination_url(asset_feed_spec: Dict[str, Any]) -> bool:
    types = asset_feed_spec.get("call_to_action_types") or []
    if not types:
        return False
    t = str(types[0]).strip().upper()
    return t not in _CTAS_WITHOUT_WEBSITE_URL
