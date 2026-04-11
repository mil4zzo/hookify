from __future__ import annotations

import logging
import os
import time
from typing import Any, Dict, List, Optional

from app.core.supabase_client import get_supabase_service
from app.services.graph_api import GraphAPI
from app.services.job_tracker import STATUS_COMPLETED, get_job_tracker
from app.services import supabase_repo
from app.services.bulk_ad_service import (
    AssetFeedCreativeBuilder,
    BulkAdJobContext,
    BundleMediaRef,
    MediaRef,
    META_RATE_LIMIT_DELAY_SECONDS,
    StorySpecCreativeBuilder,
)
from app.services.creative_template import CreativeMediaSlot, CreativeTemplate
from app.services.meta_api_errors import MetaAPIError, TokenExpiredError, extract_data_or_raise
from app.services.meta_campaign_clone import (
    adset_budget_params_from_template,
    adset_clone_fields_for_create,
    campaign_has_campaign_level_budget,
    merge_template_campaign_fields,
)

logger = logging.getLogger(__name__)

AD_NAME_VAR = "{ad_name}"
INDEX_VAR = "{index}"

_LOG_STR_MAX = 120


def _log_str(value: Any, max_len: int = _LOG_STR_MAX) -> str:
    s = str(value if value is not None else "")
    return s if len(s) <= max_len else s[: max_len - 3] + "..."


def _elapsed_ms(start: float) -> int:
    return int((time.monotonic() - start) * 1000)


def _interpolate_name(template: str, ad_name: str, index: int = 1) -> str:
    return template.replace(AD_NAME_VAR, ad_name).replace(INDEX_VAR, str(index))


_STORY_PLACEMENT_TOKENS = frozenset({"story", "stories", "reels", "facebook_reels", "profile_reels"})


def _is_story_slot(slot: CreativeMediaSlot) -> bool:
    """Heuristica: slot e considerado story quando placements incluem story/reels."""
    for summary in slot.placements_summary or []:
        summary_str = str(summary).lower()
        if any(token in summary_str for token in _STORY_PLACEMENT_TOKENS):
            return True
    return False


def _map_slot_files_to_template(
    slot_files: Dict[str, Any],
    media_refs: Dict[int, MediaRef],
    template: CreativeTemplate,
    bundle_id: str,
) -> BundleMediaRef:
    feed_ref = media_refs.get(int(slot_files["feed"])) if slot_files.get("feed") is not None else None
    story_ref = media_refs.get(int(slot_files["story"])) if slot_files.get("story") is not None else None

    if not template.media_slots:
        raise MetaAPIError("Template sem media_slots definidos", "template_missing_slots")

    slot_refs: Dict[str, MediaRef] = {}

    if len(template.media_slots) == 1:
        only = template.media_slots[0]
        chosen = feed_ref or story_ref
        if not chosen:
            raise MetaAPIError("Nenhuma midia enviada para o item", "missing_media_ref")
        if only.media_type != chosen.media_type:
            raise MetaAPIError(
                f"Template espera midia do tipo {only.media_type}, mas recebeu {chosen.media_type}",
                "media_type_mismatch",
            )
        slot_refs[only.slot_key] = chosen
    else:
        for slot in template.media_slots:
            wants_story = _is_story_slot(slot)
            ref = story_ref if wants_story else feed_ref
            if not ref:
                missing = "story" if wants_story else "feed"
                raise MetaAPIError(
                    f"Template requer midia para o slot '{slot.display_name}' "
                    f"({slot.slot_key}); envie o arquivo de {missing}.",
                    "bundle_missing_slot",
                )
            if slot.media_type != ref.media_type:
                raise MetaAPIError(
                    f"Template espera midia do tipo {slot.media_type} no slot {slot.slot_key}, "
                    f"mas recebeu {ref.media_type}",
                    "media_type_mismatch",
                )
            slot_refs[slot.slot_key] = ref

    return BundleMediaRef(bundle_id=bundle_id, slot_refs=slot_refs)


class CampaignBulkProcessor:
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
        t_job = time.monotonic()
        try:
            payload_preview = self._get_payload()
            logger.info(
                "[CAMPAIGN_BULK] process_start job_id=%s account_id=%s files=%s "
                "template_ad=%s adset_ids_count=%s",
                self.context.job_id,
                self.context.account_id,
                len(file_metas),
                _log_str(payload_preview.get("template_ad_id")),
                len(payload_preview.get("adset_ids") or []),
            )
            self._heartbeat("Preparando duplicacao de campanhas...", progress=1)
            media_refs = self._upload_all_media(files_data, file_metas)
            logger.info(
                "[CAMPAIGN_BULK] upload_phase_done job_id=%s duration_ms=%s media_slots=%s",
                self.context.job_id,
                _elapsed_ms(t_job),
                len(media_refs),
            )
            self._create_all_campaigns(media_refs)
            self._mark_completed()
            logger.info(
                "[CAMPAIGN_BULK] process_done job_id=%s total_duration_ms=%s",
                self.context.job_id,
                _elapsed_ms(t_job),
            )
        except TokenExpiredError as exc:
            logger.warning(
                "[CAMPAIGN_BULK] token_expired job_id=%s duration_ms=%s msg=%s",
                self.context.job_id,
                _elapsed_ms(t_job),
                _log_str(getattr(exc, "message", str(exc))),
            )
            self.tracker.mark_failed(
                self.context.job_id,
                exc.message,
                error_code=exc.error_code or "token_expired",
            )
        except Exception as exc:
            logger.exception(
                "[CAMPAIGN_BULK] process_fatal job_id=%s duration_ms=%s err_type=%s",
                self.context.job_id,
                _elapsed_ms(t_job),
                type(exc).__name__,
            )
            self.tracker.mark_failed(self.context.job_id, str(exc), error_code="campaign_bulk_failed")
        finally:
            self._cleanup_temp_files(file_metas)
            self.tracker.release_processing_claim(self.context.job_id)

    # ── Media upload ──────────────────────────────────────────────────────────

    def _upload_all_media(
        self,
        files_data: List[Dict[str, Any]],
        file_metas: List[Dict[str, Any]],
    ) -> Dict[int, MediaRef]:
        payload = self._get_payload()
        cached_refs = payload.get("media_refs") or {}
        refs: Dict[int, MediaRef] = {}

        cached_hits = 0
        for meta in file_metas:
            file_index = int(meta["file_index"])
            if str(file_index) in cached_refs:
                cached_hits += 1
                cached = cached_refs[str(file_index)]
                refs[file_index] = MediaRef(
                    file_index=file_index,
                    file_name=str(cached.get("file_name") or meta["file_name"]),
                    media_type=str(cached.get("media_type") or "image"),
                    image_hash=cached.get("image_hash"),
                    video_id=cached.get("video_id"),
                )
                continue

            self._heartbeat(f"Enviando midia {file_index + 1}/{len(file_metas)}...", progress=5)
            media_ref = self._upload_single_media(files_data[file_index], meta)
            refs[file_index] = media_ref
            cached_refs[str(file_index)] = media_ref.to_payload()
            self.tracker.merge_payload(self.context.job_id, {"media_refs": cached_refs})

        logger.info(
            "[CAMPAIGN_BULK] upload_all_media_done job_id=%s unique_refs=%s cached_hits=%s file_metas=%s",
            self.context.job_id,
            len(refs),
            cached_hits,
            len(file_metas),
        )
        return refs

    def _upload_single_media(self, file_data: Dict[str, Any], meta: Dict[str, Any]) -> MediaRef:
        file_name = str(meta["file_name"])
        file_index = int(meta["file_index"])
        content_type = str(meta.get("content_type") or "")
        media_type = "video" if content_type.startswith("video/") else "image"
        t0 = time.monotonic()
        logger.info(
            "[CAMPAIGN_BULK] upload_media_begin job_id=%s file_index=%s media_type=%s name=%s",
            self.context.job_id,
            file_index,
            media_type,
            _log_str(file_name, 80),
        )
        upload_content = self._get_upload_content(file_data)
        try:
            result = (
                self.api.upload_ad_video(f"act_{self.context.account_id}", file_name, upload_content)
                if media_type == "video"
                else self.api.upload_ad_image(f"act_{self.context.account_id}", file_name, upload_content)
            )
        finally:
            if hasattr(upload_content, "close"):
                try:
                    upload_content.close()
                except Exception:
                    pass
        data = self._extract_data_or_raise(result)

        if media_type == "video":
            video_id = str(data.get("id") or "")
            if not video_id:
                raise MetaAPIError("Meta nao retornou video_id", "video_missing_id")
            self._wait_for_video_ready(video_id)
            self._sleep_rate_limit()
            logger.info(
                "[CAMPAIGN_BULK] upload_media_ok job_id=%s file_index=%s kind=video video_id=%s duration_ms=%s",
                self.context.job_id,
                file_index,
                video_id,
                _elapsed_ms(t0),
            )
            return MediaRef(file_index=int(meta["file_index"]), file_name=file_name, media_type="video", video_id=video_id)

        image_info = ((data.get("images") or {}).get(file_name) or {})
        image_hash = image_info.get("hash") or data.get("hash")
        if not image_hash:
            raise MetaAPIError("Meta nao retornou image_hash", "image_missing_hash")
        self._sleep_rate_limit()
        logger.info(
            "[CAMPAIGN_BULK] upload_media_ok job_id=%s file_index=%s kind=image hash_prefix=%s duration_ms=%s",
            self.context.job_id,
            file_index,
            _log_str(str(image_hash), 16),
            _elapsed_ms(t0),
        )
        return MediaRef(file_index=int(meta["file_index"]), file_name=file_name, media_type="image", image_hash=str(image_hash))

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
            if video_status in {"error", "failed"} or processing_phase in {"error", "failed"}:
                raise MetaAPIError("Meta falhou ao processar o video", "video_processing_failed")
            time.sleep(5)
        raise MetaAPIError("Timeout aguardando processamento do video no Meta", "video_processing_timeout")

    # ── Campaign creation ─────────────────────────────────────────────────────

    def _create_all_campaigns(self, media_refs: Dict[int, MediaRef]) -> None:
        items = supabase_repo.fetch_bulk_ad_items_for_job(self.sb, self.context.job_id)
        total = len(items)
        logger.info(
            "[CAMPAIGN_BULK] create_campaigns_begin job_id=%s items=%s media_ref_indexes=%s",
            self.context.job_id,
            total,
            sorted(media_refs.keys()),
        )

        for index, item in enumerate(items, start=1):
            try:
                self._create_single_campaign(item, media_refs, index=index, total=total)
            except TokenExpiredError:
                raise
            except MetaAPIError as exc:
                logger.warning(
                    "[CAMPAIGN_BULK] item_meta_error job_id=%s item_index=%s/%s item_id=%s "
                    "error_code=%s message=%s",
                    self.context.job_id,
                    index,
                    total,
                    item.get("id"),
                    exc.error_code,
                    _log_str(exc.message, 500),
                )
                supabase_repo.update_bulk_ad_item_status(
                    self.sb, item["id"], "error",
                    error_message=exc.message, error_code=exc.error_code,
                )
            except Exception as exc:
                logger.exception(
                    "[CAMPAIGN_BULK] item_unexpected_error job_id=%s item_index=%s/%s item_id=%s err_type=%s",
                    self.context.job_id,
                    index,
                    total,
                    item.get("id"),
                    type(exc).__name__,
                )
                supabase_repo.update_bulk_ad_item_status(
                    self.sb, item["id"], "error",
                    error_message=str(exc), error_code="unexpected_error",
                )

            self.tracker.heartbeat(
                self.context.job_id,
                status="processing",
                progress=max(20, int((index / max(total, 1)) * 100)),
                message=f"Criando campanhas: {index}/{total}...",
            )

    def _create_single_campaign(
        self,
        item: Dict[str, Any],
        media_refs: Dict[int, MediaRef],
        *,
        index: int,
        total: int,
    ) -> None:
        t_item = time.monotonic()
        item_id = str(item.get("id") or "")
        payload = self._get_payload()
        ad_name = str(item.get("ad_name") or "")
        logger.info(
            "[CAMPAIGN_BULK] item_begin job_id=%s item=%s/%s item_id=%s ad_name=%s",
            self.context.job_id,
            index,
            total,
            item_id,
            _log_str(ad_name),
        )
        campaign_template = payload.get("campaign_config") or {}
        adset_configs: List[Dict[str, Any]] = payload.get("adset_configs") or []
        act_id = f"act_{self.context.account_id}"
        template_payload = payload.get("creative_template")
        if not template_payload:
            raise MetaAPIError(
                "creative_template ausente no payload do job. Reinicie a duplicacao.",
                "missing_creative_template",
            )
        template = CreativeTemplate.from_payload(template_payload)

        # 1. Resolve mídias — slot_files = {"feed": N, "story": M}
        slot_files: Dict[str, Any] = item.get("slot_files") or {}
        bundle_id = f"campaign_bulk_{item_id}"
        bundle_media_ref = _map_slot_files_to_template(slot_files, media_refs, template, bundle_id)

        logger.debug(
            "[CAMPAIGN_BULK] item_media_resolved job_id=%s item_id=%s feed_idx=%s story_idx=%s",
            self.context.job_id,
            item_id,
            slot_files.get("feed"),
            slot_files.get("story"),
        )

        # 2. Criar criativo
        supabase_repo.update_bulk_ad_item_status(self.sb, item["id"], "creating_creative")
        if template.family == "story_spec_simple":
            creative_params = self.story_builder.build(item, template, bundle_media_ref)
        elif template.family == "asset_feed_spec_labeled":
            creative_params = self.asset_feed_builder.build(item, template, bundle_media_ref)
        else:
            raise MetaAPIError(
                f"Family de creative nao suportada: {template.family}",
                "unsupported_template_family",
            )

        t_creative = time.monotonic()
        creative_result = self.api.create_ad_creative(act_id, creative_params)
        creative_response = self._extract_data_or_raise(creative_result)
        creative_id = creative_response.get("id")
        if not creative_id:
            raise MetaAPIError("Meta nao retornou creative_id", "creative_missing_id")
        logger.info(
            "[CAMPAIGN_BULK] creative_created job_id=%s item_id=%s creative_id=%s duration_ms=%s",
            self.context.job_id,
            item_id,
            creative_id,
            _elapsed_ms(t_creative),
        )

        supabase_repo.update_bulk_ad_item_status(
            self.sb, item["id"], "creating_campaign", meta_creative_id=creative_id,
        )
        self._sleep_rate_limit()

        # 3. Criar campanha
        campaign_name = _interpolate_name(
            str(item.get("campaign_name_template") or payload.get("campaign_name_template") or campaign_template.get("name") or ad_name),
            ad_name,
            index=index,
        )
        campaign_params: Dict[str, Any] = {
            "name": campaign_name,
            "objective": campaign_template.get("objective", "OUTCOME_TRAFFIC"),
            "status": payload.get("status", "ACTIVE"),
            "special_ad_categories": campaign_template.get("special_ad_categories") or [],
        }
        if campaign_template.get("buying_type"):
            campaign_params["buying_type"] = campaign_template["buying_type"]
        if campaign_template.get("bid_strategy"):
            campaign_params["bid_strategy"] = campaign_template["bid_strategy"]
        # Orçamento: override global > template
        budget_override = payload.get("campaign_budget_override")
        if budget_override:
            campaign_params["daily_budget"] = budget_override
        elif campaign_template.get("daily_budget"):
            campaign_params["daily_budget"] = campaign_template["daily_budget"]
        elif campaign_template.get("lifetime_budget"):
            campaign_params["lifetime_budget"] = campaign_template["lifetime_budget"]

        merge_template_campaign_fields(campaign_params, campaign_template)
        uses_cbo_budget = campaign_has_campaign_level_budget(campaign_params)

        t_camp = time.monotonic()
        campaign_result = self.api.create_campaign(act_id, campaign_params)
        campaign_response = self._extract_data_or_raise(campaign_result)
        new_campaign_id = campaign_response.get("id")
        if not new_campaign_id:
            raise MetaAPIError("Meta nao retornou campaign_id", "campaign_missing_id")
        logger.info(
            "[CAMPAIGN_BULK] campaign_created job_id=%s item_id=%s campaign_id=%s name=%s cbo=%s duration_ms=%s",
            self.context.job_id,
            item_id,
            new_campaign_id,
            _log_str(campaign_name),
            uses_cbo_budget,
            _elapsed_ms(t_camp),
        )
        self._sleep_rate_limit()

        supabase_repo.update_bulk_ad_item_status(self.sb, item["id"], "creating_adsets")

        # 4. Criar adsets e ads
        selected_adset_ids: List[str] = payload.get("adset_ids") or []
        adset_name_template = str(item.get("adset_name_template") or payload.get("adset_name_template") or "{ad_name}")
        n_adsets = sum(
            1 for c in adset_configs if c.get("id") in selected_adset_ids
        )
        logger.info(
            "[CAMPAIGN_BULK] adsets_phase job_id=%s item_id=%s new_campaign_id=%s adsets_to_create=%s cbo=%s",
            self.context.job_id,
            item_id,
            new_campaign_id,
            n_adsets,
            uses_cbo_budget,
        )
        # Com orçamento no nivel da campanha (CBO), a Meta nao aceita orcamento nos ad sets.
        adset_ord = 0
        for adset_cfg in adset_configs:
            if adset_cfg.get("id") not in selected_adset_ids:
                continue
            adset_ord += 1
            adset_name = _interpolate_name(adset_name_template, ad_name, index=adset_ord)
            adset_params: Dict[str, Any] = {
                "name": adset_name,
                "campaign_id": new_campaign_id,
                "status": payload.get("status", "ACTIVE"),
            }
            adset_params.update(adset_clone_fields_for_create(adset_cfg))
            if "optimization_goal" not in adset_params:
                adset_params["optimization_goal"] = adset_cfg.get("optimization_goal", "REACH")
            if "billing_event" not in adset_params:
                adset_params["billing_event"] = adset_cfg.get("billing_event", "IMPRESSIONS")
            adset_params.update(adset_budget_params_from_template(adset_cfg, uses_cbo_budget))
            # Doc Meta (AdSet end_time): 0 = conjunto contínuo, sem data de término — não herdar do modelo.
            adset_params["end_time"] = 0

            t_adset = time.monotonic()
            tpl_adset_id = str(adset_cfg.get("id") or "")
            adset_result = self.api.create_adset(act_id, adset_params)
            adset_response = self._extract_data_or_raise(adset_result)
            new_adset_id = adset_response.get("id")
            if not new_adset_id:
                raise MetaAPIError("Meta nao retornou adset_id", "adset_missing_id")
            logger.info(
                "[CAMPAIGN_BULK] adset_created job_id=%s item_id=%s ord=%s/%s template_adset_id=%s new_adset_id=%s duration_ms=%s",
                self.context.job_id,
                item_id,
                adset_ord,
                n_adsets,
                tpl_adset_id,
                new_adset_id,
                _elapsed_ms(t_adset),
            )
            self._sleep_rate_limit()

            # 5. Criar anúncio
            t_ad = time.monotonic()
            ad_params = {
                "name": ad_name,
                "adset_id": new_adset_id,
                "creative": {"creative_id": creative_id},
                "status": payload.get("status", "ACTIVE"),
            }
            ad_result = self.api.create_ad(act_id, ad_params)
            ad_response = self._extract_data_or_raise(ad_result)
            new_ad_id = ad_response.get("id")
            if not new_ad_id:
                raise MetaAPIError("Meta nao retornou ad_id", "ad_missing_id")
            logger.info(
                "[CAMPAIGN_BULK] ad_created job_id=%s item_id=%s ad_id=%s adset_id=%s duration_ms=%s",
                self.context.job_id,
                item_id,
                new_ad_id,
                new_adset_id,
                _elapsed_ms(t_ad),
            )
            self._sleep_rate_limit()

        supabase_repo.update_bulk_ad_item_status(
            self.sb, item["id"], "success", meta_creative_id=creative_id,
        )
        logger.info(
            "[CAMPAIGN_BULK] item_success job_id=%s item_id=%s campaign_id=%s creative_id=%s duration_ms=%s",
            self.context.job_id,
            item_id,
            new_campaign_id,
            creative_id,
            _elapsed_ms(t_item),
        )

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _extract_data_or_raise(self, result: Dict[str, Any]) -> Dict[str, Any]:
        return extract_data_or_raise(
            result,
            log_context=f"[CAMPAIGN_BULK] job={self.context.job_id}",
        )

    def _heartbeat(self, message: str, progress: int) -> None:
        self.tracker.heartbeat(
            self.context.job_id,
            status="processing",
            progress=progress,
            message=message,
        )

    def _mark_completed(self) -> None:
        items = supabase_repo.fetch_bulk_ad_items_for_job(self.sb, self.context.job_id)
        success = sum(1 for i in items if i.get("status") == "success")
        error = sum(1 for i in items if i.get("status") == "error")
        message = f"Criacao finalizada: {success} sucesso(s), {error} erro(s)"
        self.tracker.heartbeat(
            self.context.job_id,
            status=STATUS_COMPLETED,
            progress=100,
            message=message,
            result_count=success,
            details={"summary": {"total": len(items), "success": success, "error": error, "pending": 0}},
        )

    def _get_payload(self) -> Dict[str, Any]:
        return self.tracker.get_payload(self.context.job_id) or {}

    def _sleep_rate_limit(self) -> None:
        time.sleep(META_RATE_LIMIT_DELAY_SECONDS)

    def _get_upload_content(self, file_data: Dict[str, Any]) -> Any:
        temp_path = file_data.get("temp_path")
        if temp_path:
            return open(temp_path, "rb")
        return file_data.get("content") or b""

    def _cleanup_temp_files(self, file_metas: List[Dict[str, Any]]) -> None:
        for meta in file_metas:
            temp_path = meta.get("temp_path")
            if temp_path and os.path.exists(temp_path):
                try:
                    os.remove(temp_path)
                except OSError:
                    logger.warning("[CAMPAIGN_BULK] Falha ao remover arquivo temporario %s", temp_path)
