"""Troca de mídia em criativo-modelo.

Recebe o criativo do anúncio modelo (já classificado em `CreativeTemplate`) e as
mídias novas, e devolve o bloco de mídia reescrito — `object_story_spec` (criativo
simples) ou `asset_feed_spec` (criativo com ajuste por posicionamento). Todo o resto
do criativo (texto, CTA, link, identidade) vem do modelo.

Usado pela duplicação de campanha de duas formas:
- `build_creative_parameters`: sobrescrita de nível de cima no `POST /{ad_id}/copies`
  (o anúncio copiado herda o resto do criativo e do anúncio por construção);
- `build_creative_create_params`: fallback de criação manual (`POST /adcreatives`),
  quando a cópia do anúncio é recusada pela validação mais estrita do `/copies`.
"""
from __future__ import annotations

import copy
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from app.services.creative_template import CreativeMediaSlot, CreativeTemplate
from app.services.meta_api_errors import MetaAPIError
from app.services.meta_campaign_clone import resolve_creative_destination_url


@dataclass
class MediaRef:
    file_index: int
    file_name: str
    media_type: str
    image_hash: Optional[str] = None
    video_id: Optional[str] = None
    # Capa do vídeo (image_hash em /adimages). Sem ela, o legado herdava a capa do
    # vídeo do MODELO — o anúncio novo aparecia com o frame do criativo antigo.
    thumbnail_hash: Optional[str] = None

    def to_payload(self) -> Dict[str, Any]:
        return {
            "file_index": self.file_index,
            "file_name": self.file_name,
            "media_type": self.media_type,
            "image_hash": self.image_hash,
            "video_id": self.video_id,
            "thumbnail_hash": self.thumbnail_hash,
        }


@dataclass
class BundleMediaRef:
    bundle_id: str
    slot_refs: Dict[str, MediaRef]


def normalize_story_spec_for_creation(story_spec: Dict[str, Any]) -> Dict[str, Any]:
    """
    Normaliza object_story_spec antes do envio à Meta.

    `actor_id`/`instagram_actor_id` não existem mais (substituídos por
    `instagram_user_id` em 2025-09-09). Templates lidos de criativos antigos ainda
    podem trazê-los; quando só houver `instagram_actor_id`, promovemos para o campo
    atual.
    """
    if not isinstance(story_spec, dict):
        return {}

    normalized = copy.deepcopy(story_spec)

    def _sanitize_node(node: Dict[str, Any], *, top_level: bool = False) -> None:
        if top_level:
            instagram_actor_id = node.get("instagram_actor_id")
            instagram_user_id = node.get("instagram_user_id")
            if instagram_actor_id not in (None, "") and instagram_user_id in (None, ""):
                node["instagram_user_id"] = str(instagram_actor_id)

        node.pop("actor_id", None)
        node.pop("instagram_actor_id", None)

        for child_key in ("link_data", "photo_data", "video_data", "template_data"):
            child = node.get(child_key)
            if isinstance(child, dict):
                _sanitize_node(child, top_level=False)

        children = node.get("child_attachments")
        if isinstance(children, list):
            for child in children:
                if isinstance(child, dict):
                    _sanitize_node(child, top_level=False)

    _sanitize_node(normalized, top_level=True)
    return normalized


class StorySpecCreativeBuilder:
    def build(self, item: Dict[str, Any], template: CreativeTemplate, bundle_media_ref: BundleMediaRef) -> Dict[str, Any]:
        media_ref = self._get_primary_media_ref(bundle_media_ref)
        story_spec = normalize_story_spec_for_creation(template.story_spec_base or {})
        if media_ref.media_type == "video":
            story_spec = self._apply_video_media_to_story_spec(story_spec, media_ref)
        else:
            story_spec = self._apply_image_media_to_story_spec(story_spec, media_ref)

        params: Dict[str, Any] = {"name": f"{item['ad_name']} - Creative"}
        if story_spec:
            params["object_story_spec"] = story_spec
        if template.url_tags:
            params["url_tags"] = template.url_tags
        return params

    def _get_primary_media_ref(self, bundle_media_ref: BundleMediaRef) -> MediaRef:
        if not bundle_media_ref.slot_refs:
            raise MetaAPIError("Nenhuma midia encontrada para o item", "bundle_missing_media")
        return next(iter(bundle_media_ref.slot_refs.values()))

    def _apply_video_media_to_story_spec(self, story_spec: Dict[str, Any], media_ref: MediaRef) -> Dict[str, Any]:
        if not story_spec:
            story_spec = {}
        video_data = copy.deepcopy(story_spec.get("video_data") or {})
        link_data = copy.deepcopy(story_spec.get("link_data") or {})

        if video_data:
            video_data["video_id"] = media_ref.video_id
            _set_video_thumbnail(video_data, media_ref)
            story_spec["video_data"] = video_data
            return story_spec

        if link_data:
            # cross-type: image template + video upload → keep link_data shape with video_id (Meta accepts)
            link_data["video_id"] = media_ref.video_id
            link_data.pop("picture", None)
            _set_video_thumbnail(link_data, media_ref)
            story_spec["link_data"] = link_data
            return story_spec

        if story_spec.get("photo_data"):
            # photo_data has no video_id support → convert to video_data
            story_spec.pop("photo_data")
        video_data = {"video_id": media_ref.video_id}
        _set_video_thumbnail(video_data, media_ref)
        story_spec["video_data"] = video_data
        return story_spec

    def _apply_image_media_to_story_spec(self, story_spec: Dict[str, Any], media_ref: MediaRef) -> Dict[str, Any]:
        if not story_spec:
            story_spec = {}
        if story_spec.get("link_data"):
            story_spec["link_data"]["image_hash"] = media_ref.image_hash
            story_spec["link_data"].pop("video_id", None)
            story_spec["link_data"].pop("picture", None)
            return story_spec
        if story_spec.get("photo_data"):
            story_spec["photo_data"]["image_hash"] = media_ref.image_hash
            story_spec["photo_data"].pop("url", None)
            return story_spec
        if story_spec.get("video_data"):
            # cross-type: video template + image upload → convert video_data → link_data
            video_data = story_spec.pop("video_data") or {}
            link_data: Dict[str, Any] = {"image_hash": media_ref.image_hash}
            for key in ("message", "call_to_action", "name", "description"):
                if video_data.get(key) is not None:
                    link_data[key] = video_data[key]
            if video_data.get("title") is not None and "name" not in link_data:
                link_data["name"] = video_data["title"]
            if video_data.get("link_description") is not None and "description" not in link_data:
                link_data["description"] = video_data["link_description"]
            link_url = resolve_creative_destination_url({
                "link_url": video_data.get("link"),
                "call_to_action": video_data.get("call_to_action"),
            })
            if link_url:
                link_data["link"] = link_url
            story_spec["link_data"] = link_data
            return story_spec
        # fallback: bare spec — photo_data does not require link
        story_spec["photo_data"] = {"image_hash": media_ref.image_hash}
        return story_spec


def _set_video_thumbnail(node: Dict[str, Any], media_ref: MediaRef) -> None:
    """Capa do vídeo NOVO; nunca a herdada do modelo (image_url/image_hash antigos)."""
    node.pop("image_url", None)
    node.pop("image_hash", None)
    if media_ref.thumbnail_hash:
        node["image_hash"] = media_ref.thumbnail_hash


class AssetFeedCreativeBuilder:
    def build(self, item: Dict[str, Any], template: CreativeTemplate, bundle_media_ref: BundleMediaRef) -> Dict[str, Any]:
        story_spec = normalize_story_spec_for_creation(template.story_spec_base or {})
        asset_feed_spec = copy.deepcopy(template.asset_feed_spec_base or {})
        new_labels: Dict[str, str] = {}
        media_assets: List[Dict[str, Any]] = []

        for slot in template.media_slots:
            media_ref = bundle_media_ref.slot_refs.get(slot.slot_key)
            if not media_ref:
                raise MetaAPIError(
                    f"Bundle nao possui arquivo para o slot {slot.slot_key}",
                    "bundle_missing_slot",
                )
            media_label = self._build_media_label(bundle_media_ref.bundle_id, slot, media_ref)
            new_labels[slot.slot_key] = media_label
            if media_ref.media_type == "video":
                asset: Dict[str, Any] = {
                    "video_id": media_ref.video_id,
                    "adlabels": [{"name": media_label}],
                }
                if media_ref.thumbnail_hash:
                    asset["thumbnail_hash"] = media_ref.thumbnail_hash
                media_assets.append(asset)
            else:
                media_assets.append(
                    {
                        "hash": media_ref.image_hash,
                        "adlabels": [{"name": media_label}],
                    }
                )

        # Dispatch wrapper key by ACTUAL uploaded media type, not template's expected.
        # Handles cross-type swap (video template + image upload) and mixed-type bundles.
        videos_assets = [a for a in media_assets if "video_id" in a]
        images_assets = [a for a in media_assets if "hash" in a]
        if videos_assets:
            asset_feed_spec["videos"] = videos_assets
        else:
            asset_feed_spec.pop("videos", None)
        if images_assets:
            asset_feed_spec["images"] = images_assets
        else:
            asset_feed_spec.pop("images", None)

        slot_actual_type: Dict[str, str] = {
            slot.slot_key: bundle_media_ref.slot_refs[slot.slot_key].media_type
            for slot in template.media_slots
            if slot.slot_key in bundle_media_ref.slot_refs
        }

        rules = copy.deepcopy(asset_feed_spec.get("asset_customization_rules") or [])
        rewritten_rules: List[Dict[str, Any]] = []
        for rule in rules:
            rewritten_rule = copy.deepcopy(rule)
            src_key = "video_label" if rewritten_rule.get("video_label") else (
                "image_label" if rewritten_rule.get("image_label") else None
            )
            if not src_key:
                rewritten_rules.append(rewritten_rule)
                continue
            original_label = str(((rewritten_rule.get(src_key) or {}).get("name")) or "").strip()
            slot = self._resolve_rule_slot(src_key, original_label, template.media_slots)
            actual = slot_actual_type.get(slot.slot_key, slot.media_type)
            target_key = "video_label" if actual == "video" else "image_label"
            rewritten_rule.pop("video_label", None)
            rewritten_rule.pop("image_label", None)
            rewritten_rule[target_key] = {"name": new_labels[slot.slot_key]}
            rewritten_rules.append(rewritten_rule)
        if rewritten_rules:
            asset_feed_spec["asset_customization_rules"] = rewritten_rules

        params: Dict[str, Any] = {
            "name": f"{item['ad_name']} - Creative",
            "asset_feed_spec": asset_feed_spec,
        }
        if story_spec:
            params["object_story_spec"] = story_spec
        if template.url_tags:
            params["url_tags"] = template.url_tags
        return params

    def _resolve_rule_slot(
        self,
        rule_key: str,
        original_label: str,
        media_slots: List[CreativeMediaSlot],
    ) -> CreativeMediaSlot:
        if original_label:
            for slot in media_slots:
                if slot.source == rule_key and slot.label_name == original_label:
                    return slot
        if len(media_slots) == 1:
            return media_slots[0]
        raise MetaAPIError(
            f"Nao foi possivel resolver o slot da rule para o label {original_label or '<vazio>'}",
            "unresolved_rule_slot",
        )

    def _build_media_label(self, bundle_id: str, slot: CreativeMediaSlot, media_ref: MediaRef) -> str:
        safe_bundle = "".join(char if char.isalnum() else "_" for char in (bundle_id or ""))[:24].strip("_")
        safe_slot = "".join(char if char.isalnum() else "_" for char in (slot.slot_key or ""))[:24].strip("_")
        safe_name = "".join(char if char.isalnum() else "_" for char in (media_ref.file_name or ""))[:24].strip("_")
        prefix = safe_bundle or "bundle"
        slot_name = safe_slot or "slot"
        suffix = safe_name or f"file_{media_ref.file_index}"
        return f"bulk_upload_{prefix}_{slot_name}_{suffix}"


_STORY_BUILDER = StorySpecCreativeBuilder()
_ASSET_FEED_BUILDER = AssetFeedCreativeBuilder()


def _build_media_block(item: Dict[str, Any], template: CreativeTemplate, media: BundleMediaRef) -> Dict[str, Any]:
    if template.family == "story_spec_simple":
        return _STORY_BUILDER.build(item, template, media)
    if template.family == "asset_feed_spec_labeled":
        return _ASSET_FEED_BUILDER.build(item, template, media)
    raise MetaAPIError(
        f"Family de creative nao suportada: {template.family}",
        "unsupported_template_family",
    )


def build_creative_parameters(item: Dict[str, Any], template: CreativeTemplate, media: BundleMediaRef) -> Dict[str, Any]:
    """`creative_parameters` do `POST /{ad_id}/copies`: só o que muda.

    A Meta sobrescreve no nível de cima e herda o resto do criativo do anúncio de
    origem — por isso vai o bloco de mídia INTEIRO (object_story_spec ou
    asset_feed_spec), e não url_tags/degrees_of_freedom_spec, que já vêm do modelo.
    """
    block = _build_media_block(item, template, media)
    params: Dict[str, Any] = {"name": block["name"]}
    for key in ("object_story_spec", "asset_feed_spec"):
        if key in block:
            params[key] = block[key]
    return params


# Chaves de creative_features_spec que a Meta descontinuou como bundle (v22+): ler
# ainda as devolve, reenviar não tem efeito ou falha.
_DEPRECATED_FEATURE_KEYS = {"standard_enhancements", "standard_enhancements_catalog"}


def sanitize_degrees_of_freedom_spec(raw: Any) -> Optional[Dict[str, Any]]:
    """Reduz o degrees_of_freedom_spec lido do modelo ao que é aceito na criação.

    Só `creative_features_spec`, cada recurso com `enroll_status` explícito (+
    `customizations` quando houver) — as demais chaves do spec lido são saída.
    """
    if not isinstance(raw, dict):
        return None
    features = raw.get("creative_features_spec")
    if not isinstance(features, dict):
        return None
    cleaned: Dict[str, Any] = {}
    for key, detail in features.items():
        if key in _DEPRECATED_FEATURE_KEYS or not isinstance(detail, dict):
            continue
        status = detail.get("enroll_status")
        if status not in ("OPT_IN", "OPT_OUT"):
            continue
        entry: Dict[str, Any] = {"enroll_status": status}
        if detail.get("customizations"):
            entry["customizations"] = detail["customizations"]
        cleaned[key] = entry
    return {"creative_features_spec": cleaned} if cleaned else None


def build_creative_create_params(
    item: Dict[str, Any],
    template: CreativeTemplate,
    media: BundleMediaRef,
    *,
    template_creative: Dict[str, Any],
) -> Dict[str, Any]:
    """Params do `POST /act_X/adcreatives` (fallback): mídia nova + fidelidade explícita."""
    params = _build_media_block(item, template, media)
    dof = sanitize_degrees_of_freedom_spec(template_creative.get("degrees_of_freedom_spec"))
    if dof:
        params["degrees_of_freedom_spec"] = dof
    # Multi-anunciante: omitido vira OPT_IN por padrão na Meta — replicar o do modelo.
    contextual = template_creative.get("contextual_multi_ads")
    if isinstance(contextual, dict) and contextual.get("enroll_status") in ("OPT_IN", "OPT_OUT"):
        params["contextual_multi_ads"] = {"enroll_status": contextual["enroll_status"]}
    return params
