"""
Helpers que sobreviveram a refatoracao de "Duplicar Campanhas" (uso de /copies).

Hoje este modulo guarda apenas:
  - extracao de page_id/atores do creative.object_story_spec
  - resolucao de link de destino do creative

Tudo relacionado a recriar adsets/campanhas manualmente foi removido —
agora o Meta `POST /{campaign_id}/copies` cuida disso.
"""
from __future__ import annotations

import json
from typing import Any, Dict, Optional


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
