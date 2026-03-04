"""
AdsEnricher: enriquece dados de anuncios com detalhes da Meta API.

Responsavel por:
- deduplicar anuncios por nome
- buscar detalhes (creative, adcreatives, effective_status)
- mesclar detalhes nos dados brutos
"""
import logging
import urllib.parse
from typing import TYPE_CHECKING, Any, Callable, Dict, List, Optional

import requests

from app.core.config import META_GRAPH_BASE_URL

if TYPE_CHECKING:
    from app.services.job_tracker import JobTracker

logger = logging.getLogger(__name__)

BATCH_SIZE = 50
REQUEST_TIMEOUT = 90


class MetaRateLimitError(RuntimeError):
    """Raised when Meta rejects requests due to rate limiting."""


def _is_meta_rate_limit_error(decoded_text: str) -> bool:
    text = str(decoded_text or "").lower()
    return (
        '"code":17' in text
        or '"code": 17' in text
        or '"error_subcode":2446079' in text
        or '"error_subcode": 2446079' in text
        or "user request limit reached" in text
    )


def _build_meta_rate_limit_message() -> str:
    return (
        "A Meta limitou temporariamente as requisicoes desta conta de anuncios. "
        "Tente novamente em alguns minutos."
    )


class AdsEnricher:
    """Enriquece dados de anuncios com detalhes da Meta API."""

    def __init__(
        self,
        access_token: str,
        base_url: str = META_GRAPH_BASE_URL,
        limit: int = 5000,
        on_progress: Optional[Callable[[int, int, int], None]] = None,
        job_tracker: Optional["JobTracker"] = None,
        job_id: Optional[str] = None,
    ):
        self.access_token = access_token
        self.base_url = base_url
        self.limit = limit
        self.on_progress = on_progress
        self.job_tracker = job_tracker
        self.job_id = job_id

    def _ensure_not_cancelled(self, batch_label: str) -> bool:
        if self.job_tracker and self.job_id:
            from app.services.job_tracker import STATUS_CANCELLED

            job = self.job_tracker.get_job(self.job_id)
            if job and job.get("status") == STATUS_CANCELLED:
                logger.info(
                    f"[AdsEnricher] Job {self.job_id} cancelado, interrompendo {batch_label}"
                )
                return False
        return True

    def deduplicate_by_name(self, raw_data: List[Dict[str, Any]]) -> Dict[str, str]:
        unique_ads: Dict[str, str] = {}
        for ad in raw_data:
            ad_name = ad.get("ad_name")
            ad_id = ad.get("ad_id")
            if ad_name and ad_id and ad_name not in unique_ads:
                unique_ads[ad_name] = ad_id

        logger.info(
            f"[AdsEnricher] Deduplicacao: {len(raw_data)} -> {len(unique_ads)} anuncios unicos"
        )
        return unique_ads

    def _hydrate_creative_from_existing(self, existing_ad: Dict[str, Any]) -> Dict[str, Any]:
        creative = dict(existing_ad.get("creative") or {})
        if existing_ad.get("creative_video_id") and not creative.get("video_id"):
            creative["video_id"] = existing_ad.get("creative_video_id")
        if existing_ad.get("thumbnail_url") and not creative.get("thumbnail_url"):
            creative["thumbnail_url"] = existing_ad.get("thumbnail_url")
        if existing_ad.get("instagram_permalink_url") and not creative.get("instagram_permalink_url"):
            creative["instagram_permalink_url"] = existing_ad.get("instagram_permalink_url")
        return creative

    def _apply_existing_fixed_fields(
        self,
        raw_data: List[Dict[str, Any]],
        existing_ads_map: Dict[str, Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        if not existing_ads_map:
            return raw_data

        fixed_fields = (
            "account_id",
            "campaign_id",
            "campaign_name",
            "adset_id",
            "adset_name",
            "ad_name",
        )

        for ad in raw_data:
            ad_id = str(ad.get("ad_id") or "").strip()
            if not ad_id:
                continue
            existing_ad = existing_ads_map.get(ad_id)
            if not existing_ad:
                continue

            for field in fixed_fields:
                existing_value = existing_ad.get(field)
                if existing_value not in (None, ""):
                    ad[field] = existing_value

            ad["creative"] = self._hydrate_creative_from_existing(existing_ad)
            ad["adcreatives_videos_ids"] = list(existing_ad.get("adcreatives_videos_ids") or [])
            ad["adcreatives_videos_thumbs"] = list(existing_ad.get("adcreatives_videos_thumbs") or [])

            if existing_ad.get("effective_status") and not ad.get("effective_status"):
                ad["effective_status"] = existing_ad.get("effective_status")

        return raw_data

    def fetch_details(self, act_id: str, ad_ids: List[str]) -> Optional[List[Dict[str, Any]]]:
        if not ad_ids:
            return []

        all_results: List[Dict[str, Any]] = []
        total_batches = (len(ad_ids) + BATCH_SIZE - 1) // BATCH_SIZE

        logger.info(
            f"[AdsEnricher] Iniciando busca de detalhes para {len(ad_ids)} anuncios "
            f"em {total_batches} lote(s)"
        )

        for i in range(0, len(ad_ids), BATCH_SIZE):
            if not self._ensure_not_cancelled(f"detalhes no lote {(i // BATCH_SIZE) + 1}"):
                return all_results if all_results else None

            batch_ids = ad_ids[i:i + BATCH_SIZE]
            batch_num = (i // BATCH_SIZE) + 1

            logger.info(
                f"[AdsEnricher] Processando lote {batch_num}/{total_batches} "
                f"({len(batch_ids)} anuncios)"
            )

            url = f"{self.base_url}{act_id}/ads?access_token={self.access_token}"
            payload = {
                "fields": (
                    "id,name,effective_status,"
                    "creative{actor_id,body,call_to_action_type,instagram_permalink_url,"
                    "object_type,title,video_id,thumbnail_url,effective_object_story_id{attachments,properties}},"
                    "adcreatives{asset_feed_spec}"
                ),
                "limit": self.limit,
                "filtering": "[{'field':'id','operator':'IN','value':['" + "','".join(batch_ids) + "']}]",
            }

            try:
                response = requests.get(url, params=payload, timeout=REQUEST_TIMEOUT)
                response.raise_for_status()
                batch_data = response.json().get("data", [])
                all_results.extend(batch_data)

                logger.info(
                    f"[AdsEnricher] Lote {batch_num} concluido: {len(batch_data)} anuncios retornados"
                )

                if self.on_progress:
                    self.on_progress(batch_num, total_batches, len(all_results))
            except requests.exceptions.Timeout:
                logger.error(
                    f"[AdsEnricher] Timeout no lote {batch_num} apos {REQUEST_TIMEOUT} segundos"
                )
                continue
            except requests.exceptions.HTTPError as http_err:
                decoded_text = urllib.parse.unquote(http_err.response.text)
                if _is_meta_rate_limit_error(decoded_text):
                    raise MetaRateLimitError(_build_meta_rate_limit_message()) from http_err
                if '"code":1' in decoded_text and "reduce the amount of data" in decoded_text:
                    logger.warning(
                        f"[AdsEnricher] Meta pediu para reduzir dados no lote {batch_num}, dividindo"
                    )
                    mid = len(batch_ids) // 2
                    first = self.fetch_details(act_id, batch_ids[:mid])
                    second = self.fetch_details(act_id, batch_ids[mid:])
                    if first is not None:
                        all_results.extend(first)
                    if second is not None:
                        all_results.extend(second)
                    continue
                logger.error(
                    f"[AdsEnricher] HTTP error no lote {batch_num}: "
                    f"{http_err.response.status_code} - {decoded_text[:200]}"
                )
                continue
            except Exception as err:
                logger.exception(f"[AdsEnricher] Erro inesperado no lote {batch_num}: {err}")
                continue

        logger.info(
            f"[AdsEnricher] Busca de detalhes concluida: {len(all_results)} de {len(ad_ids)} anuncios"
        )
        return all_results if all_results else None

    def fetch_status_only(self, act_id: str, ad_ids: List[str]) -> Optional[List[Dict[str, Any]]]:
        if not ad_ids:
            return []

        all_results: List[Dict[str, Any]] = []
        total_batches = (len(ad_ids) + BATCH_SIZE - 1) // BATCH_SIZE

        logger.info(
            f"[AdsEnricher] Iniciando busca de STATUS para {len(ad_ids)} anuncios em "
            f"{total_batches} lote(s)"
        )

        for i in range(0, len(ad_ids), BATCH_SIZE):
            if not self._ensure_not_cancelled(f"status no lote {(i // BATCH_SIZE) + 1}"):
                return all_results if all_results else None

            batch_ids = ad_ids[i:i + BATCH_SIZE]
            batch_num = (i // BATCH_SIZE) + 1

            logger.info(
                f"[AdsEnricher] Processando lote STATUS {batch_num}/{total_batches} "
                f"({len(batch_ids)} anuncios)"
            )

            url = f"{self.base_url}{act_id}/ads?access_token={self.access_token}"
            payload = {
                "fields": "id,effective_status",
                "limit": self.limit,
                "filtering": "[{'field':'id','operator':'IN','value':['" + "','".join(batch_ids) + "']}]",
            }

            try:
                response = requests.get(url, params=payload, timeout=REQUEST_TIMEOUT)
                response.raise_for_status()
                batch_data = response.json().get("data", [])
                all_results.extend(batch_data)

                logger.info(
                    f"[AdsEnricher] Lote STATUS {batch_num} concluido: "
                    f"{len(batch_data)} anuncios retornados"
                )
                if self.on_progress:
                    self.on_progress(batch_num, total_batches, len(all_results))
            except requests.exceptions.Timeout:
                logger.error(
                    f"[AdsEnricher] Timeout no lote STATUS {batch_num} apos {REQUEST_TIMEOUT} segundos"
                )
                continue
            except requests.exceptions.HTTPError as http_err:
                decoded_text = urllib.parse.unquote(http_err.response.text)
                if _is_meta_rate_limit_error(decoded_text):
                    raise MetaRateLimitError(_build_meta_rate_limit_message()) from http_err
                if '"code":1' in decoded_text and "reduce the amount of data" in decoded_text:
                    logger.warning(
                        f"[AdsEnricher] Meta pediu para reduzir dados no lote STATUS {batch_num}, dividindo"
                    )
                    mid = len(batch_ids) // 2
                    first = self.fetch_status_only(act_id, batch_ids[:mid])
                    second = self.fetch_status_only(act_id, batch_ids[mid:])
                    if first is not None:
                        all_results.extend(first)
                    if second is not None:
                        all_results.extend(second)
                    continue
                logger.error(
                    f"[AdsEnricher] HTTP error no lote STATUS {batch_num}: "
                    f"{http_err.response.status_code} - {decoded_text[:200]}"
                )
                continue
            except Exception as err:
                logger.exception(f"[AdsEnricher] Erro inesperado no lote STATUS {batch_num}: {err}")
                continue

        logger.info(
            f"[AdsEnricher] Busca de STATUS concluida: {len(all_results)} de {len(ad_ids)} anuncios"
        )
        return all_results if all_results else None

    def merge_details(
        self,
        raw_data: List[Dict[str, Any]],
        details: List[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        if not details:
            return raw_data

        creative_map = {d.get("name"): d.get("creative") for d in details}
        status_map = {d.get("name"): d.get("effective_status") for d in details}

        videos_map: Dict[str, List[Dict[str, Any]]] = {}
        for detail in details:
            name = detail.get("name")
            adcreatives = detail.get("adcreatives", {})
            if adcreatives and "data" in adcreatives and len(adcreatives["data"]) > 0:
                first_creative = adcreatives["data"][0]
                asset_feed_spec = first_creative.get("asset_feed_spec", {})
                if "videos" in asset_feed_spec:
                    videos_map[name] = asset_feed_spec["videos"]

        for ad in raw_data:
            ad_name = ad.get("ad_name")
            if not ad_name:
                continue
            ad["creative"] = creative_map.get(ad_name)
            if not ad.get("effective_status"):
                ad["effective_status"] = status_map.get(ad_name)

            videos = videos_map.get(ad_name, [])
            video_ids = []
            video_thumbs = []
            for video in videos:
                if video.get("video_id"):
                    video_ids.append(video.get("video_id"))
                if video.get("thumbnail_url"):
                    video_thumbs.append(video.get("thumbnail_url"))
            ad["adcreatives_videos_ids"] = video_ids
            ad["adcreatives_videos_thumbs"] = video_thumbs

        logger.info(f"[AdsEnricher] Detalhes mesclados em {len(raw_data)} anuncios")
        return raw_data

    def enrich(
        self,
        act_id: str,
        raw_data: List[Dict[str, Any]],
        *,
        is_refresh: bool = False,
        existing_ads_map: Optional[Dict[str, Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        try:
            if not raw_data:
                return {
                    "success": True,
                    "data": [],
                    "unique_count": 0,
                    "enriched_count": 0,
                }

            unique_ad_ids: List[str] = sorted(
                list({str(ad.get("ad_id")) for ad in raw_data if ad.get("ad_id")})
            )
            unique_ads = self.deduplicate_by_name(raw_data)
            rep_ids = list(unique_ads.values())
            existing_ads_map = existing_ads_map or {}

            new_ad_ids = unique_ad_ids
            if is_refresh and existing_ads_map:
                self._apply_existing_fixed_fields(raw_data, existing_ads_map)

                new_ad_ids = [
                    ad_id for ad_id in unique_ad_ids if ad_id not in existing_ads_map
                ]
                new_ad_ids_set = set(new_ad_ids)
                new_unique_ads = self.deduplicate_by_name(
                    [
                        ad
                        for ad in raw_data
                        if str(ad.get("ad_id") or "").strip() in new_ad_ids_set
                    ]
                )
                rep_ids = list(new_unique_ads.values())

                logger.info(
                    "[AdsEnricher] Refresh otimizado: %s ads existentes reutilizados, %s ads novos para enriquecimento completo",
                    len(existing_ads_map),
                    len(rep_ids),
                )

            media_details = self.fetch_details(act_id, rep_ids)
            status_details = self.fetch_status_only(act_id, unique_ad_ids)

            enriched = self.merge_details(raw_data, media_details or [])
            if is_refresh and existing_ads_map:
                self._apply_existing_fixed_fields(enriched, existing_ads_map)

            status_by_ad_id: Dict[str, Any] = {}
            if status_details:
                for detail in status_details:
                    ad_id = detail.get("id")
                    if ad_id:
                        status_by_ad_id[str(ad_id)] = detail.get("effective_status")

            for ad in enriched:
                ad_id = ad.get("ad_id")
                if ad_id:
                    status = status_by_ad_id.get(str(ad_id))
                    if status is not None:
                        ad["effective_status"] = status

            return {
                "success": True,
                "data": enriched,
                "unique_count": len(unique_ads),
                "enriched_count": len(media_details) if media_details else 0,
            }
        except MetaRateLimitError as e:
            logger.warning(f"[AdsEnricher] Rate limit da Meta detectado: {e}")
            return {
                "success": False,
                "data": raw_data,
                "unique_count": len({ad.get('ad_name') for ad in raw_data if ad.get('ad_name')}),
                "enriched_count": 0,
                "error": str(e),
                "error_code": "meta_rate_limited",
            }
        except Exception as e:
            logger.exception(f"[AdsEnricher] Erro no pipeline de enriquecimento: {e}")
            return {
                "success": False,
                "data": raw_data,
                "unique_count": 0,
                "enriched_count": 0,
                "error": str(e),
            }


def get_ads_enricher(
    access_token: str,
    on_progress: Optional[Callable[[int, int, int], None]] = None,
    job_tracker: Optional["JobTracker"] = None,
    job_id: Optional[str] = None,
) -> AdsEnricher:
    """Factory function para criar AdsEnricher."""
    return AdsEnricher(
        access_token,
        on_progress=on_progress,
        job_tracker=job_tracker,
        job_id=job_id,
    )
