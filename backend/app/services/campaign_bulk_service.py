from __future__ import annotations

import logging
import os
import platform
import threading
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

class _JobCancelledError(Exception):
    pass


class _ProgressStream:
    """Wraps a file-like object, tracking bytes read without blocking on callbacks."""

    def __init__(self, file_obj, file_size: int, job_id: str = "?"):
        self._file = file_obj
        self._file_size = file_size
        self.bytes_read = 0  # read by heartbeat thread — GIL makes int writes atomic
        self._job_id = job_id
        self._read_count = 0
        self._size_hist: Dict[int, int] = {}  # requested size -> count
        self._start_time = time.monotonic()
        self._last_log_bytes = 0
        self._last_log_time = self._start_time
        self._first_read_time: Optional[float] = None

    def __len__(self) -> int:
        return self._file_size

    def read(self, n=-1):
        t_read_start = time.monotonic()
        chunk = self._file.read(n)
        if chunk:
            chunk_len = len(chunk)
            self.bytes_read += chunk_len
            self._read_count += 1
            # track requested size distribution (top hint about urllib3 chunking behavior)
            key = int(n) if isinstance(n, int) else -1
            self._size_hist[key] = self._size_hist.get(key, 0) + 1
            if self._first_read_time is None:
                self._first_read_time = t_read_start
                logger.info(
                    "[UPLOAD_DEBUG] stream_first_read job_id=%s requested_size=%s chunk_len=%s "
                    "time_since_start_ms=%d",
                    self._job_id, n, chunk_len,
                    int((t_read_start - self._start_time) * 1000),
                )

            now = time.monotonic()
            bytes_since_last = self.bytes_read - self._last_log_bytes
            time_since_last = now - self._last_log_time
            # log every ~4MB or every 3s, whichever comes first
            if bytes_since_last >= 4 * 1024 * 1024 or time_since_last >= 3.0:
                instant_kbs = (bytes_since_last / 1024) / max(time_since_last, 0.001)
                total_elapsed = now - self._start_time
                overall_kbs = (self.bytes_read / 1024) / max(total_elapsed, 0.001)
                # top 3 most-requested sizes
                top_sizes = sorted(self._size_hist.items(), key=lambda x: -x[1])[:3]
                logger.info(
                    "[UPLOAD_DEBUG] stream_progress job_id=%s bytes=%d/%d reads=%d "
                    "instant_kbs=%.1f overall_kbs=%.1f top_sizes=%s elapsed_s=%.1f",
                    self._job_id, self.bytes_read, self._file_size, self._read_count,
                    instant_kbs, overall_kbs, top_sizes, total_elapsed,
                )
                self._last_log_bytes = self.bytes_read
                self._last_log_time = now
        else:
            # EOF — final stats
            total_elapsed = time.monotonic() - self._start_time
            overall_kbs = (self.bytes_read / 1024) / max(total_elapsed, 0.001)
            top_sizes = sorted(self._size_hist.items(), key=lambda x: -x[1])[:5]
            logger.info(
                "[UPLOAD_DEBUG] stream_eof job_id=%s total_bytes=%d total_reads=%d "
                "overall_kbs=%.1f elapsed_s=%.1f size_histogram=%s",
                self._job_id, self.bytes_read, self._read_count,
                overall_kbs, total_elapsed, top_sizes,
            )
        return chunk


class _HeartbeatThread(threading.Thread):
    """Fires heartbeats from a background thread so upload is never blocked by Supabase calls."""

    def __init__(self, heartbeat_fn, get_message_fn, interval: float = 5.0):
        super().__init__(daemon=True)
        self._heartbeat_fn = heartbeat_fn
        self._get_message_fn = get_message_fn  # () -> (message, progress)
        self._interval = interval
        self._stop_event = threading.Event()

    def stop(self):
        self._stop_event.set()

    def run(self):
        while not self._stop_event.wait(self._interval):
            try:
                message, progress = self._get_message_fn()
                self._heartbeat_fn(message, progress)
            except Exception:
                pass  # never crash the upload over a heartbeat failure


AD_NAME_VAR = "{ad_name}"
INDEX_VAR = "{index}"
TEMPLATE_ADSET_NAME_VAR = "{template_adset_name}"

_LOG_STR_MAX = 120


def _log_str(value: Any, max_len: int = _LOG_STR_MAX) -> str:
    s = str(value if value is not None else "")
    return s if len(s) <= max_len else s[: max_len - 3] + "..."


def _elapsed_ms(start: float) -> int:
    return int((time.monotonic() - start) * 1000)


def _interpolate_name(
    template: str,
    ad_name: str,
    index: int = 1,
    template_adset_name: Optional[str] = None,
) -> str:
    result = template.replace(AD_NAME_VAR, ad_name).replace(INDEX_VAR, str(index))
    if template_adset_name is not None:
        result = result.replace(TEMPLATE_ADSET_NAME_VAR, template_adset_name)
    return result


def _map_slot_files_to_template(
    slot_media: Dict[str, int],
    media_refs: Dict[int, MediaRef],
    template: CreativeTemplate,
    bundle_id: str,
) -> BundleMediaRef:
    if not template.media_slots:
        raise MetaAPIError("Template sem media_slots definidos", "template_missing_slots")

    slot_refs: Dict[str, MediaRef] = {}

    for slot in template.media_slots:
        file_index = slot_media.get(slot.slot_key)
        if file_index is None:
            if slot.required:
                raise MetaAPIError(
                    f"Slot obrigatorio '{slot.display_name}' ({slot.slot_key}) nao recebeu midia.",
                    "bundle_missing_slot",
                )
            continue
        ref = media_refs.get(file_index)
        if not ref:
            raise MetaAPIError(
                f"Indice {file_index} nao corresponde a nenhum arquivo enviado.",
                "invalid_file_index",
            )
        if slot.media_type != ref.media_type:
            raise MetaAPIError(
                f"Slot '{slot.display_name}' espera {slot.media_type}, recebeu {ref.media_type}.",
                "media_type_mismatch",
            )
        slot_refs[slot.slot_key] = ref

    if not slot_refs:
        raise MetaAPIError("Nenhuma midia mapeada para o template.", "missing_media_ref")

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
        except _JobCancelledError:
            logger.info(
                "[CAMPAIGN_BULK] process_cancelled job_id=%s duration_ms=%s",
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

        # Pre-fetch items once so we can mark per-file status without extra DB round-trips
        all_items = supabase_repo.fetch_bulk_ad_items_for_job(self.sb, self.context.job_id)

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

            # Mark items that use this file as uploading_media so the frontend reflects progress
            for item in all_items:
                slot_media = item.get("slot_media") or {}
                if file_index in slot_media.values():
                    supabase_repo.update_bulk_ad_item_status(self.sb, item["id"], "uploading_media")

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
        act_id = f"act_{self.context.account_id}"

        if media_type == "video":
            video_id = self._upload_video_non_resumable(
                act_id=act_id,
                file_name=file_name,
                file_data=file_data,
                meta=meta,
                file_index=file_index,
            )
            self._heartbeat("Vídeo enviado! Aguardando processamento no Meta...", progress=15)
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

        upload_content = self._get_upload_content(file_data)
        try:
            result = self.api.upload_ad_image(act_id, file_name, upload_content)
        finally:
            if hasattr(upload_content, "close"):
                try:
                    upload_content.close()
                except Exception:
                    pass
        data = self._extract_data_or_raise(result)

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
            uploading_phase = status.get("uploading_phase") or {}
            processing_phase = status.get("processing_phase") or {}
            publishing_phase = status.get("publishing_phase") or {}
            uploading_status = str(uploading_phase.get("status") or "").lower()
            processing_status = str(processing_phase.get("status") or "").lower()
            publishing_status = str(publishing_phase.get("status") or "").lower()
            logger.debug(
                "[CAMPAIGN_BULK] video_status_poll job_id=%s video_id=%s "
                "video_status=%s uploading_status=%s processing_status=%s publishing_status=%s",
                self.context.job_id, video_id, video_status, uploading_status, processing_status, publishing_status,
            )
            if video_status in {"ready", "active"}:
                return
            if video_status in {"error", "failed"} or processing_status in {"error", "failed"} or uploading_status in {"error", "failed"}:
                logger.error(
                    "[CAMPAIGN_BULK] video_processing_failed job_id=%s video_id=%s "
                    "video_status=%s uploading_status=%s uploading_bytes=%s processing_status=%s publishing_status=%s full_status=%s",
                    self.context.job_id, video_id, video_status, uploading_status, uploading_phase.get("bytes_transferred"),
                    processing_status, publishing_status, status,
                )
                raise MetaAPIError(
                    f"Meta falhou ao processar o video (video_status={video_status}, uploading={uploading_status}, processing={processing_status}, publishing={publishing_status})",
                    "video_processing_failed",
                )
            elapsed = int(time.monotonic() - started_at)
            self._heartbeat(f"Processando vídeo no Meta... ({elapsed}s)", progress=17)
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
                    "error_code=%s message=%s raw_error=%s",
                    self.context.job_id,
                    index,
                    total,
                    item.get("id"),
                    exc.error_code,
                    _log_str(exc.message, 500),
                    exc.raw_error,
                )
                supabase_repo.update_bulk_ad_item_status(
                    self.sb, item["id"], "error",
                    error_message=exc.message, error_code=exc.error_code,
                    error_details=exc.raw_error,
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

        # 1. Resolve mídias — slot_media = {"slot_1": N, "slot_2": M, ...}
        slot_media: Dict[str, int] = item.get("slot_media") or {}
        bundle_id = f"campaign_bulk_{item_id}"
        bundle_media_ref = _map_slot_files_to_template(slot_media, media_refs, template, bundle_id)

        logger.debug(
            "[CAMPAIGN_BULK] item_media_resolved job_id=%s item_id=%s slot_media=%s",
            self.context.job_id,
            item_id,
            slot_media,
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
        # Nome da campanha: valor por item tem prioridade sobre o template global
        campaign_name_override = item.get("campaign_name")
        if campaign_name_override:
            campaign_name = str(campaign_name_override)
        else:
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
        # Meta exige is_adset_budget_sharing_enabled quando a campanha não tem orçamento CBO.
        if not uses_cbo_budget and "is_adset_budget_sharing_enabled" not in campaign_params:
            template_val = campaign_template.get("is_adset_budget_sharing_enabled")
            campaign_params["is_adset_budget_sharing_enabled"] = bool(template_val) if template_val is not None else False

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
        # Template do conjunto: valor por item (coluna adset_name) tem prioridade sobre o template global
        adset_name_template = str(
            item.get("adset_name")
            or payload.get("adset_name_template")
            or "{ad_name}"
        )
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
            original_adset_name = str(adset_cfg.get("name") or "")
            adset_name = _interpolate_name(
                adset_name_template,
                ad_name,
                index=adset_ord,
                template_adset_name=original_adset_name,  # substitui {template_adset_name} pelo nome original
            )
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

    # ── Non-resumable video upload (graph.facebook.com/advideos) ──────────────
    # Endpoint padrão que Meta recomenda para vídeos <1GB. Multipart/form-data
    # simples, um único POST. Evita rupload.facebook.com que throttla uploads
    # em ~70 KB/s para clientes não-browser.

    def _upload_video_non_resumable(
        self,
        act_id: str,
        file_name: str,
        file_data: Dict[str, Any],
        meta: Dict[str, Any],
        file_index: int,
    ) -> str:
        t0 = time.monotonic()
        file_size = self._get_file_size(file_data, meta)

        logger.info(
            "[CAMPAIGN_BULK] non_resumable_upload_start job_id=%s file_index=%s file_size=%s",
            self.context.job_id, file_index, file_size,
        )
        self._heartbeat("Enviando mídia ao Meta...", progress=5)

        upload_content = self._get_upload_content(file_data)
        try:
            t_read = time.monotonic()
            if hasattr(upload_content, "read"):
                upload_bytes = upload_content.read()
            else:
                upload_bytes = upload_content or b""
            logger.info(
                "[UPLOAD_DEBUG] bytes_loaded job_id=%s size=%d read_ms=%d",
                self.context.job_id, len(upload_bytes), _elapsed_ms(t_read),
            )

            def _get_progress_msg():
                return ("Enviando mídia ao Meta...", 8)

            heartbeat_thread = _HeartbeatThread(self._heartbeat, _get_progress_msg, interval=5.0)
            heartbeat_thread.start()
            try:
                t_send = time.monotonic()
                if platform.system() == "Windows":
                    result = self.api.upload_ad_video_curl(act_id, file_name, upload_bytes)
                else:
                    result = self.api.upload_ad_video(act_id, file_name, upload_bytes)
                elapsed_s = time.monotonic() - t_send
                effective_kbs = (file_size / 1024) / max(elapsed_s, 0.001)
                effective_mbps = (file_size * 8 / (1024 * 1024)) / max(elapsed_s, 0.001)
                logger.info(
                    "[UPLOAD_DEBUG] non_resumable_completed job_id=%s elapsed_s=%.2f file_size=%d "
                    "effective_kbs=%.1f effective_mbps=%.1f",
                    self.context.job_id, elapsed_s, file_size, effective_kbs, effective_mbps,
                )
            finally:
                heartbeat_thread.stop()
                heartbeat_thread.join(timeout=10)

            data = self._extract_data_or_raise(result)
            video_id = str(data.get("id") or data.get("video_id") or "")
            if not video_id:
                raise MetaAPIError(
                    f"Meta nao retornou video_id (data={data})",
                    "video_missing_id",
                )
            logger.info(
                "[CAMPAIGN_BULK] non_resumable_upload_ok job_id=%s video_id=%s duration_ms=%s",
                self.context.job_id, video_id, _elapsed_ms(t0),
            )
            return video_id
        finally:
            if hasattr(upload_content, "close"):
                try:
                    upload_content.close()
                except Exception:
                    pass

    # ── Resumable video upload (rupload.facebook.com) ─────────────────────────
    # Mantido como fallback para vídeos >1GB se necessário no futuro.

    def _upload_video_resumable(
        self,
        act_id: str,
        file_name: str,
        file_data: Dict[str, Any],
        meta: Dict[str, Any],
        file_index: int,
    ) -> str:
        t0 = time.monotonic()
        file_size = self._get_file_size(file_data, meta)

        # Phase 1 — Start
        logger.info(
            "[CAMPAIGN_BULK] resumable_upload_start job_id=%s file_index=%s file_size=%s",
            self.context.job_id, file_index, file_size,
        )
        self._heartbeat("Enviando mídia ao Meta...", progress=5)
        start_result = self.api.start_video_upload(act_id)
        start_data = self._extract_data_or_raise(start_result)
        video_id = str(start_data["video_id"])
        upload_url = start_data.get("upload_url")
        logger.info(
            "[CAMPAIGN_BULK] resumable_upload_session job_id=%s video_id=%s file_size=%s start_keys=%s upload_url=%s",
            self.context.job_id, video_id, file_size, sorted(start_data.keys()), upload_url,
        )

        # Phase 2 — Transfer (single POST to rupload.facebook.com)
        # IMPORTANT: read the full file into bytes before sending. Passing a file-like
        # object makes urllib3 iterate read(16384) and send each 16KB chunk as its own
        # socket write, which serializes with TCP ACKs across a high-latency link to
        # rupload.facebook.com and throttles upload to ~80 KB/s. Passing bytes lets
        # urllib3 call sock.sendall() once, so the OS can stream at full bandwidth.
        upload_content = self._get_upload_content(file_data)
        try:
            t_read = time.monotonic()
            if hasattr(upload_content, "read"):
                upload_bytes = upload_content.read()
            else:
                upload_bytes = upload_content or b""
            logger.info(
                "[UPLOAD_DEBUG] bytes_loaded job_id=%s size=%d read_ms=%d",
                self.context.job_id, len(upload_bytes), _elapsed_ms(t_read),
            )

            # Heartbeat thread still runs so the UI shows progress messages
            # during the transfer, even though we can't report byte-level progress
            # when sending bytes in a single call.
            def _get_progress_msg():
                return ("Enviando mídia ao Meta...", 8)

            heartbeat_thread = _HeartbeatThread(self._heartbeat, _get_progress_msg, interval=5.0)
            heartbeat_thread.start()
            try:
                self._heartbeat("Enviando mídia ao Meta...", progress=6)
                transfer_result = self.api.transfer_video_resumable(
                    video_id=video_id,
                    data=upload_bytes,
                    file_size=file_size,
                )
            finally:
                heartbeat_thread.stop()
                heartbeat_thread.join(timeout=10)

            logger.info(
                "[CAMPAIGN_BULK] resumable_upload_transfer_response job_id=%s video_id=%s "
                "status=%s data=%s bytes_sent=%s",
                self.context.job_id, video_id,
                transfer_result.get("status"), transfer_result.get("data"), len(upload_bytes),
            )
            self._extract_data_or_raise(transfer_result)
        finally:
            if hasattr(upload_content, "close"):
                try:
                    upload_content.close()
                except Exception:
                    pass

        logger.info(
            "[CAMPAIGN_BULK] resumable_upload_transfer_done job_id=%s video_id=%s duration_ms=%s",
            self.context.job_id, video_id, _elapsed_ms(t0),
        )

        # Phase 3 — Finish
        self._heartbeat("Finalizando envio da mídia...", progress=15)
        finish_result = self.api.finish_video_upload(act_id, video_id)
        self._extract_data_or_raise(finish_result)
        logger.info(
            "[CAMPAIGN_BULK] resumable_upload_finish_ok job_id=%s video_id=%s duration_ms=%s",
            self.context.job_id, video_id, _elapsed_ms(t0),
        )

        return video_id

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _extract_data_or_raise(self, result: Dict[str, Any]) -> Dict[str, Any]:
        return extract_data_or_raise(
            result,
            log_context=f"[CAMPAIGN_BULK] job={self.context.job_id}",
        )

    def _heartbeat(self, message: str, progress: int) -> None:
        accepted = self.tracker.heartbeat(
            self.context.job_id,
            status="processing",
            progress=progress,
            message=message,
        )
        if accepted is False:
            raise _JobCancelledError()

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
                    logger.warning("[CAMPAIGN_BULK] Falha ao remover arquivo temporario %s", temp_path)
