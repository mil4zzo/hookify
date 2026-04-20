"""
AdsEnricher: enriquece dados de anuncios com detalhes da Meta API.

Responsavel por:
- deduplicar anuncios por nome
- buscar detalhes (creative, adcreatives, effective_status)
- mesclar detalhes nos dados brutos
"""
import logging
import time
import urllib.parse
import json
from typing import TYPE_CHECKING, Any, Callable, Dict, List, Optional

import requests

from app.core.config import META_GRAPH_BASE_URL
from app.services.meta_usage_logger import log_meta_usage

if TYPE_CHECKING:
    from app.services.job_tracker import JobTracker

logger = logging.getLogger(__name__)

BATCH_SIZE = 50
REQUEST_TIMEOUT = 90
MAX_RETRIES = 3
RETRY_DELAYS = [2, 4, 8]
BATCH_DELAY_S = 2
MAX_SPLIT_DEPTH = 3

# HTTP status codes que justificam retry
_RETRYABLE_STATUS_CODES = {429, 500, 502, 503}


class MetaRateLimitError(RuntimeError):
    """Raised when Meta rejects requests due to rate limiting."""


class EnrichmentBatchError(RuntimeError):
    """Raised when a batch fails after all retries."""


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


def _is_retryable(exc: Exception) -> bool:
    if isinstance(exc, requests.exceptions.Timeout):
        return True
    if isinstance(exc, requests.exceptions.HTTPError) and exc.response is not None:
        return exc.response.status_code in _RETRYABLE_STATUS_CODES
    if isinstance(exc, requests.exceptions.ConnectionError):
        return True
    return False


def _is_reduce_data_error(http_err: requests.exceptions.HTTPError) -> bool:
    decoded_text = urllib.parse.unquote(http_err.response.text)
    return '"code":1' in decoded_text and "reduce the amount of data" in decoded_text


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
                    "[AdsEnricher] Job %s cancelado, interrompendo %s",
                    self.job_id, batch_label,
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
            "[AdsEnricher] Deduplicacao por nome: %d registros -> %d anuncios (para detalhes)",
            len(raw_data), len(unique_ads),
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
            if existing_ad.get("primary_video_id"):
                ad["primary_video_id"] = existing_ad.get("primary_video_id")
            if existing_ad.get("media_type"):
                ad["media_type"] = existing_ad.get("media_type")
            ad["adcreatives_videos_ids"] = list(existing_ad.get("adcreatives_videos_ids") or [])
            ad["adcreatives_videos_thumbs"] = list(existing_ad.get("adcreatives_videos_thumbs") or [])

            if existing_ad.get("effective_status") and not ad.get("effective_status"):
                ad["effective_status"] = existing_ad.get("effective_status")

        return raw_data

    def _fetch_batch_with_retry(
        self,
        url: str,
        payload: Dict[str, Any],
        batch_label: str,
        *,
        return_full: bool = False,
    ) -> Any:
        """Faz GET de um batch com retry e backoff. Levanta excecao se todas as tentativas falharem."""
        last_exc: Optional[Exception] = None
        for attempt in range(MAX_RETRIES):
            try:
                response = requests.get(url, params=payload, timeout=REQUEST_TIMEOUT)
                response.raise_for_status()
                log_meta_usage(response, "AdsEnricher")
                response_json = response.json()
                if return_full:
                    return response_json
                return response_json.get("data", [])
            except requests.exceptions.HTTPError as http_err:
                decoded_text = urllib.parse.unquote(http_err.response.text)
                if _is_meta_rate_limit_error(decoded_text):
                    raise MetaRateLimitError(_build_meta_rate_limit_message()) from http_err
                if _is_reduce_data_error(http_err):
                    raise  # propagar para tratamento de split
                last_exc = http_err
                if not _is_retryable(http_err) or attempt >= MAX_RETRIES - 1:
                    raise EnrichmentBatchError(
                        f"Falha no {batch_label} apos {MAX_RETRIES} tentativas: "
                        f"{http_err.response.status_code} - {decoded_text[:200]}"
                    ) from http_err
            except requests.exceptions.Timeout as exc:
                last_exc = exc
                if attempt >= MAX_RETRIES - 1:
                    raise EnrichmentBatchError(
                        f"Timeout no {batch_label} apos {MAX_RETRIES} tentativas"
                    ) from exc
            except Exception as exc:
                raise EnrichmentBatchError(
                    f"Erro inesperado no {batch_label}: {exc}"
                ) from exc
            delay = RETRY_DELAYS[attempt]
            logger.warning(
                "[AdsEnricher] %s: tentativa %d/%d falhou (%s), retry em %ds...",
                batch_label, attempt + 1, MAX_RETRIES, last_exc, delay,
            )
            time.sleep(delay)
        raise last_exc  # type: ignore[misc]

    def _fetch_in_batches(
        self,
        act_id: str,
        ad_ids: List[str],
        fields: str,
        label_prefix: str,
        *,
        _split_depth: int = 0,
    ) -> List[Dict[str, Any]]:
        if not ad_ids:
            return []

        all_results: List[Dict[str, Any]] = []
        total_batches = (len(ad_ids) + BATCH_SIZE - 1) // BATCH_SIZE

        logger.info(
            "[AdsEnricher] %s: %d anuncios em %d lote(s)",
            label_prefix, len(ad_ids), total_batches,
        )

        for i in range(0, len(ad_ids), BATCH_SIZE):
            batch_num = (i // BATCH_SIZE) + 1
            if not self._ensure_not_cancelled(f"{label_prefix} no lote {batch_num}"):
                return all_results

            batch_ids = ad_ids[i:i + BATCH_SIZE]
            batch_label = f"lote {label_prefix} {batch_num}/{total_batches}"

            logger.info("[AdsEnricher] Processando %s (%d anuncios)", batch_label, len(batch_ids))

            url = f"{self.base_url}{act_id}/ads?access_token={self.access_token}"
            payload = {
                "fields": fields,
                "limit": self.limit,
                "filtering": "[{'field':'id','operator':'IN','value':['" + "','".join(batch_ids) + "']}]",
            }

            try:
                batch_data = self._fetch_batch_with_retry(url, payload, batch_label)
                all_results.extend(batch_data)
                logger.info("[AdsEnricher] %s concluido: %d anuncios retornados", batch_label, len(batch_data))

                if self.on_progress:
                    self.on_progress(batch_num, total_batches, len(all_results))

                if batch_num < total_batches:
                    time.sleep(BATCH_DELAY_S)
            except requests.exceptions.HTTPError as http_err:
                if _is_reduce_data_error(http_err):
                    if _split_depth >= MAX_SPLIT_DEPTH:
                        raise EnrichmentBatchError(
                            f"Meta continua pedindo reducao de dados apos {MAX_SPLIT_DEPTH} splits no {batch_label}"
                        ) from http_err
                    logger.warning("[AdsEnricher] Meta pediu para reduzir dados no %s, dividindo (depth=%d)", batch_label, _split_depth)
                    mid = len(batch_ids) // 2
                    first = self._fetch_in_batches(act_id, batch_ids[:mid], fields, label_prefix, _split_depth=_split_depth + 1)
                    second = self._fetch_in_batches(act_id, batch_ids[mid:], fields, label_prefix, _split_depth=_split_depth + 1)
                    all_results.extend(first)
                    all_results.extend(second)
                    continue
                raise

        logger.info(
            "[AdsEnricher] %s concluida: %d de %d anuncios",
            label_prefix, len(all_results), len(ad_ids),
        )
        return all_results

    def _fetch_by_filter_paginated(
        self,
        act_id: str,
        fields: str,
        meta_filters: List[Dict[str, Any]],
        label: str,
    ) -> List[Dict[str, Any]]:
        if not meta_filters:
            return []

        all_results: List[Dict[str, Any]] = []
        page = 0
        url = f"{self.base_url}{act_id}/ads"
        payload: Dict[str, Any] = {
            "access_token": self.access_token,
            "fields": fields,
            "limit": 1000,
            "filtering": json.dumps(meta_filters),
        }

        logger.info("[AdsEnricher] %s: iniciando busca paginada por filtros", label)

        while True:
            page += 1
            if not self._ensure_not_cancelled(f"{label} na pagina {page}"):
                return all_results

            page_label = f"{label} pag.{page}"
            response_data = self._fetch_batch_with_retry(
                url,
                payload,
                page_label,
                return_full=True,
            )
            data = response_data.get("data", [])
            all_results.extend(data)

            logger.info(
                "[AdsEnricher] %s concluida: %d ads retornados (total=%d)",
                page_label,
                len(data),
                len(all_results),
            )

            if self.on_progress:
                self.on_progress(page, 0, len(all_results))

            next_url = str(response_data.get("paging", {}).get("next") or "").strip()
            if not next_url:
                break
            url = next_url
            payload = {}

        logger.info(
            "[AdsEnricher] %s concluida: %d ads em %d pagina(s)",
            label,
            len(all_results),
            page,
        )
        return all_results

    _DETAILS_FIELDS = (
        "id,name,effective_status,"
        "creative{actor_id,body,call_to_action_type,instagram_permalink_url,"
        "object_type,title,video_id,thumbnail_url,effective_object_story_id{attachments,properties}},"
        "adcreatives{asset_feed_spec}"
    )

    def fetch_details(
        self, act_id: str, ad_ids: List[str], *, _split_depth: int = 0
    ) -> List[Dict[str, Any]]:
        return self._fetch_in_batches(act_id, ad_ids, self._DETAILS_FIELDS, "detalhes", _split_depth=_split_depth)

    def fetch_status_only(
        self, act_id: str, ad_ids: List[str], *, _split_depth: int = 0
    ) -> List[Dict[str, Any]]:
        return self._fetch_in_batches(act_id, ad_ids, "id,effective_status", "status", _split_depth=_split_depth)

    def fetch_status_by_filter(
        self, act_id: str, meta_filters: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        return self._fetch_by_filter_paginated(
            act_id,
            "id,effective_status",
            meta_filters,
            "status-filter",
        )

    def merge_details(
        self,
        raw_data: List[Dict[str, Any]],
        details: List[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        if not details:
            return raw_data

        creative_map = {d.get("name"): d.get("creative") for d in details}

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

            creative = creative_map.get(ad_name)
            if creative is not None:
                ad["creative"] = creative

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

        logger.info("[AdsEnricher] Detalhes mesclados em %d anuncios", len(raw_data))
        return raw_data

    def enrich(
        self,
        act_id: str,
        raw_data: List[Dict[str, Any]],
        *,
        is_refresh: bool = False,
        existing_ads_map: Optional[Dict[str, Dict[str, Any]]] = None,
        meta_filters: Optional[List[Dict[str, Any]]] = None,
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

            if is_refresh and existing_ads_map:
                self._apply_existing_fixed_fields(raw_data, existing_ads_map)

                new_ad_ids_set = set(
                    ad_id for ad_id in unique_ad_ids if ad_id not in existing_ads_map
                )
                new_unique_ads = self.deduplicate_by_name(
                    [
                        ad
                        for ad in raw_data
                        if str(ad.get("ad_id") or "").strip() in new_ad_ids_set
                    ]
                )
                rep_ids = list(new_unique_ads.values())

                logger.info(
                    "[AdsEnricher] Refresh otimizado: %d ads existentes reutilizados, %d ads novos para enriquecimento completo",
                    len(existing_ads_map),
                    len(rep_ids),
                )

            media_details = self.fetch_details(act_id, rep_ids)
            if meta_filters:
                status_details = self.fetch_status_by_filter(act_id, meta_filters)
            else:
                status_details = self.fetch_status_only(act_id, unique_ad_ids)

            enriched = self.merge_details(raw_data, media_details)

            status_map = {d.get("id"): d.get("effective_status") for d in status_details}
            for ad in enriched:
                ad_id = str(ad.get("ad_id") or "")
                if ad_id and ad_id in status_map:
                    ad["effective_status"] = status_map[ad_id]

            return {
                "success": True,
                "data": enriched,
                "unique_count": len(unique_ads),
                "enriched_count": len(media_details),
            }
        except MetaRateLimitError as e:
            logger.warning("[AdsEnricher] Rate limit da Meta detectado: %s", e)
            return {
                "success": False,
                "data": raw_data,
                "unique_count": len({ad.get('ad_name') for ad in raw_data if ad.get('ad_name')}),
                "enriched_count": 0,
                "error": str(e),
                "error_code": "meta_rate_limited",
            }
        except EnrichmentBatchError as e:
            logger.error("[AdsEnricher] Falha no enriquecimento: %s", e)
            return {
                "success": False,
                "data": raw_data,
                "unique_count": 0,
                "enriched_count": 0,
                "error": str(e),
            }
        except Exception as e:
            logger.exception("[AdsEnricher] Erro no pipeline de enriquecimento: %s", e)
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
