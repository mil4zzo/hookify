from __future__ import annotations

import copy
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional, Tuple


SUPPORTED_CREATIVE_FAMILIES = {
    "story_spec_simple",
    "asset_feed_spec_labeled",
}


class CreativeTemplateError(RuntimeError):
    def __init__(self, message: str, error_code: str = "unsupported_template"):
        super().__init__(message)
        self.message = message
        self.error_code = error_code


@dataclass
class CreativePreview:
    body: Optional[str] = None
    title: Optional[str] = None
    call_to_action: Optional[str] = None
    link_url: Optional[str] = None
    thumbnail_url: Optional[str] = None
    format: Optional[str] = None

    def to_payload(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_payload(cls, payload: Optional[Dict[str, Any]]) -> "CreativePreview":
        payload = payload or {}
        return cls(
            body=payload.get("body"),
            title=payload.get("title"),
            call_to_action=payload.get("call_to_action"),
            link_url=payload.get("link_url"),
            thumbnail_url=payload.get("thumbnail_url"),
            format=payload.get("format"),
        )


@dataclass
class CreativeMediaSlot:
    slot_key: str
    display_name: str
    media_type: str
    source: str
    label_name: Optional[str]
    rules_count: int
    placements_summary: List[str] = field(default_factory=list)
    required: bool = True

    def to_payload(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_payload(cls, payload: Optional[Dict[str, Any]]) -> "CreativeMediaSlot":
        payload = payload or {}
        return cls(
            slot_key=str(payload.get("slot_key") or ""),
            display_name=str(payload.get("display_name") or payload.get("slot_key") or ""),
            media_type=str(payload.get("media_type") or "image"),
            source=str(payload.get("source") or "image_label"),
            label_name=payload.get("label_name"),
            rules_count=int(payload.get("rules_count") or 0),
            placements_summary=list(payload.get("placements_summary") or []),
            required=bool(payload.get("required", True)),
        )


@dataclass
class CreativeCloneCapabilities:
    supports_bulk_clone: bool
    supports_media_swap: bool
    warnings: List[str] = field(default_factory=list)
    blocking_reason: Optional[str] = None

    def to_payload(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_payload(cls, payload: Optional[Dict[str, Any]]) -> "CreativeCloneCapabilities":
        payload = payload or {}
        return cls(
            supports_bulk_clone=bool(payload.get("supports_bulk_clone")),
            supports_media_swap=bool(payload.get("supports_media_swap")),
            warnings=list(payload.get("warnings") or []),
            blocking_reason=payload.get("blocking_reason"),
        )


@dataclass
class CreativeTemplate:
    family: str
    media_kind: Optional[str]
    actor_context: Dict[str, Any]
    url_tags: Optional[str]
    story_spec_base: Dict[str, Any]
    asset_feed_spec_base: Dict[str, Any]
    rules: List[Dict[str, Any]]
    media_slots: List[CreativeMediaSlot]
    preview: CreativePreview
    capabilities: CreativeCloneCapabilities
    creative_id: Optional[str] = None
    creative_name: Optional[str] = None

    def to_payload(self) -> Dict[str, Any]:
        return {
            "family": self.family,
            "media_kind": self.media_kind,
            "actor_context": copy.deepcopy(self.actor_context),
            "url_tags": self.url_tags,
            "story_spec_base": copy.deepcopy(self.story_spec_base),
            "asset_feed_spec_base": copy.deepcopy(self.asset_feed_spec_base),
            "rules": copy.deepcopy(self.rules),
            "media_slots": [slot.to_payload() for slot in self.media_slots],
            "preview": self.preview.to_payload(),
            "capabilities": self.capabilities.to_payload(),
            "creative_id": self.creative_id,
            "creative_name": self.creative_name,
        }

    @classmethod
    def from_payload(cls, payload: Optional[Dict[str, Any]]) -> "CreativeTemplate":
        payload = payload or {}
        return cls(
            family=str(payload.get("family") or "unsupported"),
            media_kind=payload.get("media_kind"),
            actor_context=copy.deepcopy(payload.get("actor_context") or {}),
            url_tags=payload.get("url_tags"),
            story_spec_base=copy.deepcopy(payload.get("story_spec_base") or {}),
            asset_feed_spec_base=copy.deepcopy(payload.get("asset_feed_spec_base") or {}),
            rules=copy.deepcopy(payload.get("rules") or []),
            media_slots=[CreativeMediaSlot.from_payload(slot) for slot in (payload.get("media_slots") or [])],
            preview=CreativePreview.from_payload(payload.get("preview")),
            capabilities=CreativeCloneCapabilities.from_payload(payload.get("capabilities")),
            creative_id=payload.get("creative_id"),
            creative_name=payload.get("creative_name"),
        )

    def to_preview_response(self, creative: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "creative": creative,
            "body": self.preview.body,
            "title": self.preview.title,
            "call_to_action": self.preview.call_to_action,
            "link_url": self.preview.link_url,
            "thumbnail_url": self.preview.thumbnail_url,
            "format": self.preview.format,
            "family": self.family,
            "supports_bulk_clone": self.capabilities.supports_bulk_clone,
            "supports_media_swap": self.capabilities.supports_media_swap,
            "warnings": self.capabilities.warnings,
            "media_slots": [slot.to_payload() for slot in self.media_slots],
            "is_multi_slot": len(self.media_slots) > 1,
            "slot_count": len(self.media_slots),
        }


def parse_creative_template(creative_payload: Dict[str, Any]) -> CreativeTemplate:
    creative = copy.deepcopy(creative_payload.get("creative") or {})
    object_story_spec = copy.deepcopy(creative.get("object_story_spec") or {})
    asset_feed_spec = copy.deepcopy(creative.get("asset_feed_spec") or {})
    rules = copy.deepcopy(asset_feed_spec.get("asset_customization_rules") or [])

    family = _classify_family(creative, object_story_spec, asset_feed_spec, rules)
    media_kind = _detect_media_kind(creative, object_story_spec, asset_feed_spec)
    media_slots = _detect_media_slots(asset_feed_spec, rules, media_kind)
    preview = _build_preview(creative, object_story_spec, asset_feed_spec, media_kind)
    capabilities = _build_capabilities(
        creative=creative,
        object_story_spec=object_story_spec,
        asset_feed_spec=asset_feed_spec,
        family=family,
        media_kind=media_kind,
        rules=rules,
        media_slots=media_slots,
    )

    return CreativeTemplate(
        family=family,
        media_kind=media_kind,
        actor_context=_extract_actor_context(object_story_spec),
        url_tags=creative.get("url_tags"),
        story_spec_base=object_story_spec,
        asset_feed_spec_base=asset_feed_spec,
        rules=rules,
        media_slots=media_slots,
        preview=preview,
        capabilities=capabilities,
        creative_id=str(creative.get("id") or "") or None,
        creative_name=creative_payload.get("name"),
    )


def validate_template_for_bulk_clone(template: CreativeTemplate) -> CreativeTemplate:
    if not template.capabilities.supports_bulk_clone:
        raise CreativeTemplateError(
            template.capabilities.blocking_reason or "Creative nao suportado para upload em massa",
            error_code="unsupported_template",
        )
    if not template.capabilities.supports_media_swap:
        raise CreativeTemplateError(
            "Creative nao suporta troca automatica de midia",
            error_code="unsupported_template",
        )
    return template


def get_template_media_type(content_type: str) -> str:
    return "video" if str(content_type or "").lower().startswith("video/") else "image"


def _classify_family(
    creative: Dict[str, Any],
    object_story_spec: Dict[str, Any],
    asset_feed_spec: Dict[str, Any],
    rules: List[Dict[str, Any]],
) -> str:
    has_story_media = any(object_story_spec.get(key) for key in ("link_data", "photo_data", "video_data"))
    has_labeled_assets = _asset_feed_has_labeled_media(asset_feed_spec)
    if asset_feed_spec and (rules or has_labeled_assets):
        return "asset_feed_spec_labeled"
    if has_story_media:
        return "story_spec_simple"
    if creative.get("image_hash") or creative.get("video_id"):
        return "story_spec_simple"
    return "unsupported"


def _detect_media_kind(
    creative: Dict[str, Any],
    object_story_spec: Dict[str, Any],
    asset_feed_spec: Dict[str, Any],
) -> Optional[str]:
    link_data = object_story_spec.get("link_data") or {}
    photo_data = object_story_spec.get("photo_data") or {}
    video_data = object_story_spec.get("video_data") or {}

    if asset_feed_spec.get("videos") or creative.get("video_id") or video_data.get("video_id") or link_data.get("video_id"):
        return "video"
    if asset_feed_spec.get("images") or creative.get("image_hash") or photo_data.get("image_hash") or link_data.get("image_hash"):
        return "image"
    return None


def _build_preview(
    creative: Dict[str, Any],
    object_story_spec: Dict[str, Any],
    asset_feed_spec: Dict[str, Any],
    media_kind: Optional[str],
) -> CreativePreview:
    video_data = object_story_spec.get("video_data") or {}
    link_data = object_story_spec.get("link_data") or {}
    photo_data = object_story_spec.get("photo_data") or {}

    body = (
        creative.get("body")
        or video_data.get("message")
        or link_data.get("message")
        or photo_data.get("message")
        or _first_text(asset_feed_spec.get("bodies"))
    )
    title = (
        creative.get("title")
        or link_data.get("name")
        or video_data.get("title")
        or _first_text(asset_feed_spec.get("titles"))
    )
    call_to_action = (
        creative.get("call_to_action_type")
        or (creative.get("call_to_action") or {}).get("type")
        or (link_data.get("call_to_action") or {}).get("type")
        or (video_data.get("call_to_action") or {}).get("type")
        or _first_string(asset_feed_spec.get("call_to_action_types"))
    )
    link_url = (
        creative.get("link_url")
        or link_data.get("link")
        or video_data.get("link")
        or _first_link_url(asset_feed_spec.get("link_urls"))
    )

    return CreativePreview(
        body=body,
        title=title,
        call_to_action=call_to_action,
        link_url=link_url,
        thumbnail_url=creative.get("thumbnail_url"),
        format=media_kind,
    )


def _build_capabilities(
    *,
    creative: Dict[str, Any],
    object_story_spec: Dict[str, Any],
    asset_feed_spec: Dict[str, Any],
    family: str,
    media_kind: Optional[str],
    rules: List[Dict[str, Any]],
    media_slots: List[CreativeMediaSlot],
) -> CreativeCloneCapabilities:
    warnings: List[str] = []

    if _is_catalog_creative(creative, object_story_spec):
        return CreativeCloneCapabilities(
            supports_bulk_clone=False,
            supports_media_swap=False,
            warnings=warnings,
            blocking_reason="Creatives de catalogo/produto ainda nao sao suportados",
        )

    if family == "unsupported":
        return CreativeCloneCapabilities(
            supports_bulk_clone=False,
            supports_media_swap=False,
            warnings=warnings,
            blocking_reason="Formato de creative nao suportado para clonagem em massa",
        )

    if media_kind not in {"image", "video"}:
        return CreativeCloneCapabilities(
            supports_bulk_clone=False,
            supports_media_swap=False,
            warnings=warnings,
            blocking_reason="Nao foi possivel identificar o tipo de midia do creative",
        )

    if family == "story_spec_simple":
        story_shapes = sum(1 for key in ("link_data", "photo_data", "video_data") if object_story_spec.get(key))
        if story_shapes > 1:
            return CreativeCloneCapabilities(
                supports_bulk_clone=False,
                supports_media_swap=False,
                warnings=warnings,
                blocking_reason="Creative simples com multiplas estruturas de story spec nao e suportado",
            )
        return CreativeCloneCapabilities(
            supports_bulk_clone=True,
            supports_media_swap=True,
            warnings=warnings,
        )

    if not media_slots:
        return CreativeCloneCapabilities(
            supports_bulk_clone=False,
            supports_media_swap=False,
            warnings=warnings,
            blocking_reason="Nao foi possivel detectar os slots de midia do template",
        )

    ad_formats = [str(value).upper() for value in (asset_feed_spec.get("ad_formats") or [])]
    if any("CAROUSEL" in value for value in ad_formats):
        return CreativeCloneCapabilities(
            supports_bulk_clone=False,
            supports_media_swap=False,
            warnings=warnings,
            blocking_reason="Creatives em carrossel ainda nao sao suportados",
        )

    if any(object_story_spec.get(key) for key in ("link_data", "photo_data", "video_data")):
        return CreativeCloneCapabilities(
            supports_bulk_clone=False,
            supports_media_swap=False,
            warnings=warnings,
            blocking_reason="Creative com asset feed e story spec de midia ao mesmo tempo nao e suportado",
        )

    has_images = bool(asset_feed_spec.get("images"))
    has_videos = bool(asset_feed_spec.get("videos"))
    if has_images and has_videos:
        return CreativeCloneCapabilities(
            supports_bulk_clone=False,
            supports_media_swap=False,
            warnings=warnings,
            blocking_reason="Creative com imagens e videos no mesmo asset feed nao e suportado",
        )

    slot_media_types = {slot.media_type for slot in media_slots}
    if len(slot_media_types) > 1:
        return CreativeCloneCapabilities(
            supports_bulk_clone=False,
            supports_media_swap=False,
            warnings=warnings,
            blocking_reason="Template com slots de imagem e video ao mesmo tempo nao e suportado",
        )

    if rules:
        media_rule_keys = {
            key
            for rule in rules
            for key in ("image_label", "video_label")
            if rule.get(key)
        }
        if len(media_rule_keys) > 1:
            return CreativeCloneCapabilities(
                supports_bulk_clone=False,
                supports_media_swap=False,
                warnings=warnings,
                blocking_reason="Rules com multiplos slots de midia nao sao suportadas",
            )

    if len(media_slots) > 1 and not rules:
        return CreativeCloneCapabilities(
            supports_bulk_clone=False,
            supports_media_swap=False,
            warnings=warnings,
            blocking_reason="Template multi-slot sem rules explicitas nao e suportado",
        )

    original_media_count = len(asset_feed_spec.get("videos") or []) if media_kind == "video" else len(asset_feed_spec.get("images") or [])
    if original_media_count > 1:
        warnings.append("O template possui multiplos assets de midia e usara bundles por slot quando configurado.")

    return CreativeCloneCapabilities(
        supports_bulk_clone=True,
        supports_media_swap=True,
        warnings=warnings,
    )


def _extract_actor_context(object_story_spec: Dict[str, Any]) -> Dict[str, Any]:
    actor_keys = (
        "page_id",
        "instagram_user_id",
        "instagram_actor_id",
        "actor_id",
    )
    return {
        key: value
        for key, value in object_story_spec.items()
        if key in actor_keys and value not in (None, "")
    }


def _asset_feed_has_labeled_media(asset_feed_spec: Dict[str, Any]) -> bool:
    for key in ("images", "videos"):
        for asset in asset_feed_spec.get(key) or []:
            if asset.get("adlabels"):
                return True
    return False


def _detect_media_slots(
    asset_feed_spec: Dict[str, Any],
    rules: List[Dict[str, Any]],
    media_kind: Optional[str],
) -> List[CreativeMediaSlot]:
    if media_kind not in {"image", "video"}:
        return []

    source_key = "video_label" if media_kind == "video" else "image_label"
    assets_key = "videos" if media_kind == "video" else "images"
    seen: Dict[Tuple[str, str], CreativeMediaSlot] = {}
    ordered_keys: List[Tuple[str, str]] = []

    for rule in rules:
        label_obj = rule.get(source_key) or {}
        label_name = str(label_obj.get("name") or "").strip()
        if not label_name:
            continue
        key = (source_key, label_name)
        if key not in seen:
            seen[key] = CreativeMediaSlot(
                slot_key=f"slot_{len(seen) + 1}",
                display_name="",
                media_type=media_kind,
                source=source_key,
                label_name=label_name,
                rules_count=0,
                placements_summary=[],
                required=True,
            )
            ordered_keys.append(key)
        seen[key].rules_count += 1
        seen[key].placements_summary = _merge_placements_summary(
            seen[key].placements_summary,
            _summarize_rule_placements(rule.get("customization_spec") or {}),
        )

    for asset in asset_feed_spec.get(assets_key) or []:
        for label in asset.get("adlabels") or []:
            label_name = str((label or {}).get("name") or "").strip()
            if not label_name:
                continue
            key = (source_key, label_name)
            if key not in seen:
                seen[key] = CreativeMediaSlot(
                    slot_key=f"slot_{len(seen) + 1}",
                    display_name="",
                    media_type=media_kind,
                    source=source_key,
                    label_name=label_name,
                    rules_count=0,
                    placements_summary=[],
                    required=True,
                )
                ordered_keys.append(key)

    if not seen:
        assets = asset_feed_spec.get(assets_key) or []
        if len(assets) == 1:
            label_name = None
            adlabels = assets[0].get("adlabels") or []
            if adlabels:
                label_name = str((adlabels[0] or {}).get("name") or "").strip() or None
            return [
                CreativeMediaSlot(
                    slot_key="slot_1",
                    display_name="Midia principal",
                    media_type=media_kind,
                    source=source_key,
                    label_name=label_name,
                    rules_count=0,
                    placements_summary=[],
                    required=True,
                )
            ]
        return []

    slots = [seen[key] for key in ordered_keys]
    for index, slot in enumerate(slots, start=1):
        slot.display_name = _build_slot_display_name(index, slot.placements_summary)
    return slots


def _build_slot_display_name(index: int, placements_summary: List[str]) -> str:
    if not placements_summary:
        return "Midia principal" if index == 1 else f"Midia {index}"
    summary = ", ".join(placements_summary[:2])
    return summary if summary else (f"Midia {index}")


def _summarize_rule_placements(customization_spec: Dict[str, Any]) -> List[str]:
    if not customization_spec:
        return []
    parts: List[str] = []
    if customization_spec.get("publisher_platforms"):
        parts.append("/".join(str(value) for value in customization_spec.get("publisher_platforms") or []))
    for key in ("facebook_positions", "instagram_positions", "messenger_positions", "audience_network_positions"):
        values = customization_spec.get(key) or []
        if values:
            normalized = key.replace("_positions", "")
            parts.append(f"{normalized}:{'/'.join(str(value) for value in values)}")
    if not parts and customization_spec.get("age_min") is not None and customization_spec.get("age_max") is not None:
        parts.append(f"idade {customization_spec.get('age_min')}-{customization_spec.get('age_max')}")
    return parts


def _merge_placements_summary(current: List[str], incoming: List[str]) -> List[str]:
    merged = list(current)
    for value in incoming:
        if value not in merged:
            merged.append(value)
    return merged


def _is_catalog_creative(creative: Dict[str, Any], object_story_spec: Dict[str, Any]) -> bool:
    object_type = str(creative.get("object_type") or "").upper()
    if object_type in {"PRODUCT_CATALOG", "PRODUCT_SET"}:
        return True
    return bool(object_story_spec.get("template_data") or object_story_spec.get("product_data"))


def _first_text(items: Any) -> Optional[str]:
    if not isinstance(items, list):
        return None
    for item in items:
        text = (item or {}).get("text")
        if text not in (None, ""):
            return str(text)
    return None


def _first_string(items: Any) -> Optional[str]:
    if not isinstance(items, list):
        return None
    for item in items:
        if item not in (None, ""):
            return str(item)
    return None


def _first_link_url(items: Any) -> Optional[str]:
    if not isinstance(items, list):
        return None
    for item in items:
        candidate = (item or {}).get("website_url") or (item or {}).get("url") or (item or {}).get("link")
        if candidate not in (None, ""):
            return str(candidate)
    return None
