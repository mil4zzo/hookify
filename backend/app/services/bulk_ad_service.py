from __future__ import annotations

import copy
import io
import logging
import os
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from app.core.supabase_client import get_supabase_service
from app.services.graph_api import GraphAPI
from app.services.job_tracker import STATUS_COMPLETED, get_job_tracker
from app.services import supabase_repo
from app.services.meta_api_errors import MetaAPIError, TokenExpiredError, extract_data_or_raise
from app.services.creative_template import (
    CreativeMediaSlot,
    CreativeTemplate,
    CreativeTemplateError,
    parse_creative_template,
    validate_template_for_bulk_clone,
)

logger = logging.getLogger(__name__)

META_RATE_LIMIT_DELAY_SECONDS = 0.2


class TemplateError(RuntimeError):
    pass


def _normalize_story_spec_for_creation(story_spec: Dict[str, Any]) -> Dict[str, Any]:
    """
    Normaliza object_story_spec antes do POST /adcreatives.

    A documentação atual da Meta para Object Story Spec documenta `page_id` e
    `instagram_user_id`, mas não `actor_id`/`instagram_actor_id`. Alguns
    templates retornados pela leitura do creative trazem esses campos legados;
    reenviá-los pode fazer a criação apontar para um perfil errado ou sem
    permissão. Quando só houver `instagram_actor_id`, promovemos para o campo
    documentado `instagram_user_id`.
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


@dataclass
class BulkAdJobContext:
    user_jwt: str
    user_id: str
    access_token: str
    job_id: str
    account_id: str


@dataclass
class MediaRef:
    file_index: int
    file_name: str
    media_type: str
    image_hash: Optional[str] = None
    video_id: Optional[str] = None

    def to_payload(self) -> Dict[str, Any]:
        return {
            "file_index": self.file_index,
            "file_name": self.file_name,
            "media_type": self.media_type,
            "image_hash": self.image_hash,
            "video_id": self.video_id,
        }


@dataclass
class BundleMediaRef:
    bundle_id: str
    slot_refs: Dict[str, MediaRef]


class StorySpecCreativeBuilder:
    def build(self, item: Dict[str, Any], template: CreativeTemplate, bundle_media_ref: BundleMediaRef) -> Dict[str, Any]:
        media_ref = self._get_primary_media_ref(bundle_media_ref)
        story_spec = _normalize_story_spec_for_creation(template.story_spec_base or {})
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
            video_data.pop("image_hash", None)
            story_spec["video_data"] = video_data
            return story_spec

        if link_data:
            link_data["video_id"] = media_ref.video_id
            link_data.pop("image_hash", None)
            story_spec["link_data"] = link_data
            return story_spec

        story_spec["video_data"] = {"video_id": media_ref.video_id}
        return story_spec

    def _apply_image_media_to_story_spec(self, story_spec: Dict[str, Any], media_ref: MediaRef) -> Dict[str, Any]:
        if not story_spec:
            story_spec = {}
        if story_spec.get("link_data"):
            story_spec["link_data"]["image_hash"] = media_ref.image_hash
            story_spec["link_data"].pop("video_id", None)
            return story_spec
        if story_spec.get("photo_data"):
            story_spec["photo_data"]["image_hash"] = media_ref.image_hash
            return story_spec
        if story_spec.get("video_data"):
            story_spec["video_data"]["image_hash"] = media_ref.image_hash
            story_spec["video_data"].pop("video_id", None)
            return story_spec
        story_spec["link_data"] = {"image_hash": media_ref.image_hash}
        return story_spec


class AssetFeedCreativeBuilder:
    def build(self, item: Dict[str, Any], template: CreativeTemplate, bundle_media_ref: BundleMediaRef) -> Dict[str, Any]:
        story_spec = _normalize_story_spec_for_creation(template.story_spec_base or {})
        asset_feed_spec = copy.deepcopy(template.asset_feed_spec_base or {})
        slot_by_key = {slot.slot_key: slot for slot in template.media_slots}
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
                media_assets.append(
                    {
                        "video_id": media_ref.video_id,
                        "adlabels": [{"name": media_label}],
                    }
                )
            else:
                media_assets.append(
                    {
                        "hash": media_ref.image_hash,
                        "adlabels": [{"name": media_label}],
                    }
                )

        primary_media_type = template.media_slots[0].media_type if template.media_slots else template.media_kind
        if primary_media_type == "video":
            asset_feed_spec["videos"] = media_assets
            asset_feed_spec.pop("images", None)
            rule_key = "video_label"
            opposite_rule_key = "image_label"
        else:
            asset_feed_spec["images"] = media_assets
            asset_feed_spec.pop("videos", None)
            rule_key = "image_label"
            opposite_rule_key = "video_label"

        rules = copy.deepcopy(asset_feed_spec.get("asset_customization_rules") or [])
        rewritten_rules: List[Dict[str, Any]] = []
        for rule in rules:
            rewritten_rule = copy.deepcopy(rule)
            original_label = str(((rewritten_rule.get(rule_key) or {}).get("name")) or "").strip()
            slot = self._resolve_rule_slot(rule_key, original_label, template.media_slots, slot_by_key)
            rewritten_rule[rule_key] = {"name": new_labels[slot.slot_key]}
            rewritten_rule.pop(opposite_rule_key, None)
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
        slot_by_key: Dict[str, CreativeMediaSlot],
    ) -> CreativeMediaSlot:
        del slot_by_key  # kept for future readability / symmetry in callers
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


class BulkAdProcessor:
    def __init__(self, context: BulkAdJobContext):
        self.context = context
        self.sb = get_supabase_service()
        self.tracker = get_job_tracker(
            context.user_jwt,
            context.user_id,
            use_service_role=True,
        )
        self.api = GraphAPI(context.access_token, user_id=context.user_id)
        self.story_builder = StorySpecCreativeBuilder()
        self.asset_feed_builder = AssetFeedCreativeBuilder()

    def process(self, files_data: List[Dict[str, Any]], file_metas: List[Dict[str, Any]]) -> None:
        try:
            self._mark_job_processing("Preparando criacao em massa...", progress=1)
            creative_template = self._load_creative_template()
            media_refs = self._upload_all_media(files_data, file_metas)
            self._create_all_ads(creative_template, media_refs)
            self._mark_job_completed()
        except TokenExpiredError as exc:
            logger.warning("[BULK_ADS] Token expirado durante job %s", self.context.job_id)
            self.tracker.mark_failed(
                self.context.job_id,
                exc.message,
                error_code=exc.error_code or "token_expired",
            )
        except TemplateError as exc:
            logger.exception("[BULK_ADS] Template error job=%s", self.context.job_id)
            self.tracker.mark_failed(self.context.job_id, str(exc), error_code="template_error")
        except Exception as exc:
            logger.exception("[BULK_ADS] Unexpected error job=%s", self.context.job_id)
            self.tracker.mark_failed(self.context.job_id, str(exc), error_code="bulk_ads_failed")
        finally:
            self._cleanup_temp_files(file_metas)
            self.tracker.release_processing_claim(self.context.job_id)

    def _load_creative_template(self) -> CreativeTemplate:
        payload = self._get_payload()
        cached_template = payload.get("creative_template")
        if cached_template:
            template = CreativeTemplate.from_payload(cached_template)
            return validate_template_for_bulk_clone(template)

        template_ad_id = str(payload.get("template_ad_id") or "").strip()
        if not template_ad_id:
            raise TemplateError("template_ad_id nao encontrado no job")

        result = self.api.get_ad_creative_details(template_ad_id)
        data = self._extract_data_or_raise(result)
        creative = data.get("creative")
        if not creative:
            raise TemplateError("Nao foi possivel carregar o creative do anuncio modelo")

        try:
            template = validate_template_for_bulk_clone(parse_creative_template(data))
        except CreativeTemplateError as exc:
            raise TemplateError(exc.message) from exc

        self.tracker.merge_payload(
            self.context.job_id,
            {
                "template_creative_data": data,
                "creative_template": template.to_payload(),
                "creative_family": template.family,
                "template_validation": template.capabilities.to_payload(),
            },
        )
        return template

    def _upload_all_media(
        self,
        files_data: List[Dict[str, Any]],
        file_metas: List[Dict[str, Any]],
    ) -> Dict[int, MediaRef]:
        payload = self._get_payload()
        cached_refs = payload.get("media_refs") or {}
        by_index = {int(meta["file_index"]): meta for meta in file_metas}
        refs: Dict[int, MediaRef] = {}

        for file_index, meta in by_index.items():
            if str(file_index) in cached_refs:
                cached = cached_refs[str(file_index)]
                refs[file_index] = MediaRef(
                    file_index=file_index,
                    file_name=str(cached.get("file_name") or meta["file_name"]),
                    media_type=str(cached.get("media_type") or "image"),
                    image_hash=cached.get("image_hash"),
                    video_id=cached.get("video_id"),
                )
                continue

            self._mark_items_for_file(file_index, "uploading_media")
            media_ref = self._upload_single_media(files_data[file_index], meta)
            refs[file_index] = media_ref
            cached_refs[str(file_index)] = media_ref.to_payload()
            self.tracker.merge_payload(self.context.job_id, {"media_refs": cached_refs})

        return refs

    def _create_all_ads(self, creative_template: CreativeTemplate, media_refs: Dict[int, MediaRef]) -> None:
        items = supabase_repo.fetch_bulk_ad_items_for_job(self.sb, self.context.job_id)
        total = len(items)

        for index, item in enumerate(items, start=1):
            try:
                bundle_media_ref = self._build_item_media_refs(item, creative_template, media_refs)
                self._create_single_ad(item, creative_template, bundle_media_ref)
            except TokenExpiredError:
                raise
            except MetaAPIError as exc:
                supabase_repo.update_bulk_ad_item_status(
                    self.sb,
                    item["id"],
                    "error",
                    error_message=exc.message,
                    error_code=exc.error_code,
                )
            except Exception as exc:
                supabase_repo.update_bulk_ad_item_status(
                    self.sb,
                    item["id"],
                    "error",
                    error_message=str(exc),
                    error_code="unexpected_error",
                )

            self.tracker.heartbeat(
                self.context.job_id,
                status="processing",
                progress=max(5, int((index / max(total, 1)) * 100)),
                message=f"Criando anuncios: {index}/{total}...",
            )

    def _create_single_ad(
        self,
        item: Dict[str, Any],
        creative_template: CreativeTemplate,
        bundle_media_ref: BundleMediaRef,
    ) -> None:
        supabase_repo.update_bulk_ad_item_status(self.sb, item["id"], "creating_creative")
        creative_params = self._build_creative_params(item, creative_template, bundle_media_ref)
        creative_result = self.api.create_ad_creative(f"act_{self.context.account_id}", creative_params)
        creative_response = self._extract_data_or_raise(creative_result)
        creative_id = creative_response.get("id")
        if not creative_id:
            raise MetaAPIError("Meta nao retornou creative_id", "creative_missing_id")

        supabase_repo.update_bulk_ad_item_status(
            self.sb,
            item["id"],
            "creating_ad",
            meta_creative_id=creative_id,
        )

        ad_params = {
            "name": item["ad_name"],
            "adset_id": item["adset_id"],
            "creative": {"creative_id": creative_id},
            "status": self._get_payload().get("status", "PAUSED"),
        }
        ad_result = self.api.create_ad(f"act_{self.context.account_id}", ad_params)
        ad_response = self._extract_data_or_raise(ad_result)
        ad_id = ad_response.get("id")
        if not ad_id:
            raise MetaAPIError("Meta nao retornou ad_id", "ad_missing_id")

        supabase_repo.update_bulk_ad_item_status(
            self.sb,
            item["id"],
            "success",
            meta_ad_id=ad_id,
            meta_creative_id=creative_id,
        )

    def _upload_single_media(self, file_data: Dict[str, Any], meta: Dict[str, Any]) -> MediaRef:
        file_name = str(meta["file_name"])
        content_type = str(meta.get("content_type") or "")
        media_type = "video" if content_type.startswith("video/") else "image"
        act_id = f"act_{self.context.account_id}"

        if media_type == "video":
            file_size = self._get_file_size(file_data, meta)
            file_source = self._open_seekable_source(file_data)
            try:
                uploaded = self.api.upload_ad_video_chunked(
                    act_id, file_name, file_source, file_size,
                )
            finally:
                try:
                    file_source.close()
                except Exception:
                    pass
            data = self._extract_data_or_raise(uploaded)
            video_id = str(data.get("id") or "")
            if not video_id:
                raise MetaAPIError("Meta nao retornou video_id", "video_missing_id")
            self._wait_for_video_ready(video_id)
            self._sleep_rate_limit()
            return MediaRef(
                file_index=int(meta["file_index"]),
                file_name=file_name,
                media_type=media_type,
                video_id=video_id,
            )

        upload_content = self._get_upload_content(file_data)
        try:
            uploaded = self.api.upload_ad_image(act_id, file_name, upload_content)
        finally:
            if hasattr(upload_content, "close"):
                try:
                    upload_content.close()
                except Exception:
                    logger.debug("[BULK_ADS] Falha ao fechar upload content", exc_info=True)
        data = self._extract_data_or_raise(uploaded)
        image_info = ((data.get("images") or {}).get(file_name) or {})
        image_hash = image_info.get("hash") or data.get("hash")
        if not image_hash:
            raise MetaAPIError("Meta nao retornou image_hash", "image_missing_hash")
        self._sleep_rate_limit()
        return MediaRef(
            file_index=int(meta["file_index"]),
            file_name=file_name,
            media_type=media_type,
            image_hash=str(image_hash),
        )

    def _wait_for_video_ready(self, video_id: str, max_wait_seconds: int = 300) -> None:
        started_at = time.monotonic()
        while (time.monotonic() - started_at) < max_wait_seconds:
            result = self.api.get_video_status(video_id)
            data = self._extract_data_or_raise(result)
            status = data.get("status") or {}
            video_status = str(status.get("video_status") or "").lower()
            processing_phase = str(status.get("processing_phase") or "").lower()
            if video_status in {"ready", "active"}:
                return
            if video_status in {"error", "failed"}:
                raise MetaAPIError("Meta falhou ao processar o video", "video_processing_failed")
            if processing_phase in {"error", "failed"}:
                raise MetaAPIError("Meta falhou ao processar o video", "video_processing_failed")
            time.sleep(5)
        raise MetaAPIError("Timeout aguardando processamento do video no Meta", "video_processing_timeout")

    def _build_creative_params(
        self,
        item: Dict[str, Any],
        creative_template: CreativeTemplate,
        bundle_media_ref: BundleMediaRef,
    ) -> Dict[str, Any]:
        for slot_key, media_ref in bundle_media_ref.slot_refs.items():
            if creative_template.media_kind != media_ref.media_type:
                raise MetaAPIError(
                    f"Template espera midia do tipo {creative_template.media_kind}, mas o slot {slot_key} recebeu {media_ref.media_type}",
                    "media_type_mismatch",
                )
        if creative_template.family == "story_spec_simple":
            return self.story_builder.build(item, creative_template, bundle_media_ref)
        if creative_template.family == "asset_feed_spec_labeled":
            return self.asset_feed_builder.build(item, creative_template, bundle_media_ref)
        raise TemplateError(f"Creative family nao suportada: {creative_template.family}")

    def _build_item_media_refs(
        self,
        item: Dict[str, Any],
        creative_template: CreativeTemplate,
        media_refs: Dict[int, MediaRef],
    ) -> BundleMediaRef:
        bundle_id = str(item.get("bundle_id") or item.get("id") or f"item_{item.get('file_index')}")
        slot_files = copy.deepcopy(item.get("slot_files") or {})
        if slot_files:
            slot_refs: Dict[str, MediaRef] = {}
            for slot_key, file_index in slot_files.items():
                media_ref = media_refs.get(int(file_index))
                if not media_ref:
                    raise MetaAPIError(
                        f"Midia nao encontrada para o slot {slot_key}",
                        "missing_media_ref",
                    )
                slot_refs[str(slot_key)] = media_ref
            return BundleMediaRef(bundle_id=bundle_id, slot_refs=slot_refs)

        fallback_media_ref = media_refs.get(int(item["file_index"]))
        if not fallback_media_ref:
            raise MetaAPIError("Midia nao encontrada para o item", "missing_media_ref")
        fallback_slot_key = creative_template.media_slots[0].slot_key if creative_template.media_slots else "slot_1"
        return BundleMediaRef(
            bundle_id=bundle_id,
            slot_refs={fallback_slot_key: fallback_media_ref},
        )

    def _extract_data_or_raise(self, result: Dict[str, Any]) -> Dict[str, Any]:
        return extract_data_or_raise(
            result,
            log_context=f"[BULK_ADS] job={self.context.job_id}",
        )

    def _mark_job_processing(self, message: str, progress: int) -> None:
        self.tracker.heartbeat(
            self.context.job_id,
            status="processing",
            progress=progress,
            message=message,
        )

    def _mark_job_completed(self) -> None:
        items = supabase_repo.fetch_bulk_ad_items_for_job(self.sb, self.context.job_id)
        summary = self._build_summary(items)
        message = f"Criacao finalizada: {summary['success']} sucesso(s), {summary['error']} erro(s)"
        self.tracker.heartbeat(
            self.context.job_id,
            status=STATUS_COMPLETED,
            progress=100,
            message=message,
            result_count=summary["success"],
            details={"summary": summary},
        )

    def _build_summary(self, items: List[Dict[str, Any]]) -> Dict[str, int]:
        summary = {
            "total": len(items),
            "success": 0,
            "error": 0,
            "pending": 0,
        }
        for item in items:
            status = str(item.get("status") or "")
            if status == "success":
                summary["success"] += 1
            elif status == "error":
                summary["error"] += 1
            else:
                summary["pending"] += 1
        return summary

    def _mark_items_for_file(self, file_index: int, status: str) -> None:
        items = supabase_repo.fetch_bulk_ad_items_for_job(self.sb, self.context.job_id)
        for item in items:
            slot_files = item.get("slot_files") or {}
            references_file = int(item.get("file_index", -1)) == file_index
            if slot_files:
                references_file = any(int(index) == file_index for index in slot_files.values())
            if references_file and item.get("status") == "pending":
                supabase_repo.update_bulk_ad_item_status(self.sb, item["id"], status)

    def _get_payload(self) -> Dict[str, Any]:
        return self.tracker.get_payload(self.context.job_id) or {}

    def _sleep_rate_limit(self) -> None:
        time.sleep(META_RATE_LIMIT_DELAY_SECONDS)

    def _get_upload_content(self, file_data: Dict[str, Any]) -> Any:
        temp_path = file_data.get("temp_path")
        if temp_path:
            return open(temp_path, "rb")
        return file_data.get("content") or b""

    def _open_seekable_source(self, file_data: Dict[str, Any]):
        """Returns a seekable binary stream for chunked upload. Caller must close."""
        temp_path = file_data.get("temp_path")
        if temp_path:
            return open(temp_path, "rb")
        return io.BytesIO(file_data.get("content") or b"")

    def _get_file_size(self, file_data: Dict[str, Any], meta: Dict[str, Any]) -> int:
        size = meta.get("size")
        if isinstance(size, int) and size > 0:
            return size
        temp_path = file_data.get("temp_path")
        if temp_path:
            return os.path.getsize(temp_path)
        return len(file_data.get("content") or b"")

    def _cleanup_temp_files(self, file_metas: List[Dict[str, Any]]) -> None:
        for meta in file_metas:
            temp_path = meta.get("temp_path")
            if temp_path and os.path.exists(temp_path):
                try:
                    os.remove(temp_path)
                except OSError:
                    logger.warning("[BULK_ADS] Falha ao remover arquivo temporario %s", temp_path)
