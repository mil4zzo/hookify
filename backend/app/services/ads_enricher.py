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
from app.services.ad_media import resolve_structural_media_type
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
            if existing_ad.get("video_owner_page_id"):
                ad["video_owner_page_id"] = existing_ad.get("video_owner_page_id")
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

    # Teto defensivo de paginação do /ads edge (40 páginas × 1000 = 40k ads);
    # inventários maiores são cortados com warning em vez de loop sem fim.
    _FILTER_PAGE_CAP = 40

    def _fetch_by_filter_paginated(
        self,
        act_id: str,
        fields: str,
        meta_filters: List[Dict[str, Any]],
        label: str,
        *,
        allow_empty_filters: bool = False,
    ) -> List[Dict[str, Any]]:
        if not meta_filters and not allow_empty_filters:
            return []

        all_results: List[Dict[str, Any]] = []
        page = 0
        url = f"{self.base_url}{act_id}/ads"
        payload: Dict[str, Any] = {
            "access_token": self.access_token,
            "fields": fields,
            "limit": 1000,
        }
        if meta_filters:
            payload["filtering"] = json.dumps(meta_filters)

        logger.info("[AdsEnricher] %s: iniciando busca paginada por filtros", label)

        while True:
            page += 1
            if page > self._FILTER_PAGE_CAP:
                logger.warning(
                    "[AdsEnricher] %s: teto de %d páginas atingido; resultado truncado em %d ads",
                    label, self._FILTER_PAGE_CAP, len(all_results),
                )
                break
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

    # source_ad e buscado apenas como fallback de AUSENCIA TOTAL (detail sem creative
    # e sem adcreatives proprios). A identidade da midia vem SEMPRE do creative/adcreatives
    # do PROPRIO ad: source_ad e rastreio de duplicacao, nao garantia de mesma midia —
    # quando o usuario duplica um ad e TROCA a midia, o creative do source e OUTRA midia
    # (bug do "shift" de thumb/video entre ads vizinhos, ver decisoes-tecnicas 2026-07-06).
    # O erro #10 ao acessar o video_id de uma copia e resolvido no playback/transcricao
    # pelo fallback via effective_instagram_media_id (get_video_source_url), nao aqui.
    # object_story_spec.page_id permite popular video_owner_page_id no enrichment,
    # eliminando o GET /{video_id}?fields=from que ocorria lazily no primeiro acesso ao modal.
    _DETAILS_FIELDS = (
        "id,name,effective_status,source_ad_id,"
        "source_ad{creative{actor_id,body,call_to_action_type,instagram_permalink_url,"
        "object_type,title,video_id,thumbnail_url,"
        "effective_instagram_media_id,image_url,image_hash,"
        "effective_object_story_id{attachments,properties}},"
        "adcreatives{asset_feed_spec,object_story_spec}},"
        "creative{actor_id,body,call_to_action_type,instagram_permalink_url,"
        "object_type,title,video_id,thumbnail_url,"
        "effective_instagram_media_id,image_url,image_hash,"
        "effective_object_story_id{attachments,properties}},"
        "adcreatives{asset_feed_spec,object_story_spec}"
    )

    def fetch_ig_media_types(self, igm_ids: List[str]) -> Dict[str, str]:
        """Batch GET effective_instagram_media_id -> normalized media_type ("video"/"image").

        Best-effort: batch errors split-on-error per-chunk. Never raises.
        """
        if not igm_ids:
            return {}

        result: Dict[str, str] = {}
        base = self.base_url.rstrip("/") + "/"

        def _fetch_chunk(chunk: List[str], depth: int = 0) -> None:
            if not chunk:
                return
            if not self._ensure_not_cancelled(f"igm batch {chunk[0][:8]}"):
                return
            try:
                resp = requests.get(
                    base,
                    params={
                        "ids": ",".join(chunk),
                        "fields": "id,media_type,children{media_type}",
                        "access_token": self.access_token,
                    },
                    timeout=REQUEST_TIMEOUT,
                )
                if resp.status_code >= 400 and len(chunk) > 1 and depth < 3:
                    logger.warning(
                        "[AdsEnricher] igm batch status=%s len=%d, splitting", resp.status_code, len(chunk)
                    )
                    mid = len(chunk) // 2
                    _fetch_chunk(chunk[:mid], depth + 1)
                    _fetch_chunk(chunk[mid:], depth + 1)
                    return
                resp.raise_for_status()
                log_meta_usage(resp, "AdsEnricher.igm")
                data = resp.json()
                if not isinstance(data, dict):
                    return
                for igm_id, payload in data.items():
                    if not isinstance(payload, dict) or "error" in payload:
                        continue
                    raw_type = str(payload.get("media_type") or "").upper()
                    if raw_type == "VIDEO":
                        result[igm_id] = "video"
                    elif raw_type == "IMAGE":
                        result[igm_id] = "image"
                    elif raw_type == "CAROUSEL_ALBUM":
                        # Categorizar pelo primeiro filho (consistente com _fetch_igm_media_url,
                        # que serve a media_url do primeiro filho do álbum)
                        children = (payload.get("children") or {}).get("data") or []
                        child_type = str((children[0] if children else {}).get("media_type") or "").upper()
                        if child_type == "VIDEO":
                            result[igm_id] = "video"
                        elif child_type == "IMAGE":
                            result[igm_id] = "image"
            except Exception as exc:
                if len(chunk) > 1 and depth < 3:
                    logger.warning("[AdsEnricher] igm fetch exception (%s), splitting chunk", exc)
                    mid = len(chunk) // 2
                    _fetch_chunk(chunk[:mid], depth + 1)
                    _fetch_chunk(chunk[mid:], depth + 1)
                else:
                    logger.warning("[AdsEnricher] igm fetch failed for %d ids: %s", len(chunk), exc)

        total = len(igm_ids)
        logger.info("[AdsEnricher] fetch_ig_media_types: %d igm ids", total)
        for i in range(0, total, BATCH_SIZE):
            _fetch_chunk(igm_ids[i:i + BATCH_SIZE])
            if i + BATCH_SIZE < total:
                time.sleep(0.2)

        logger.info("[AdsEnricher] fetch_ig_media_types: resolved %d/%d", len(result), total)
        return result

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

    # Campos de identidade do inventário (validados no SDK oficial — Ad.Field):
    # adset{name}/campaign{name} via field expansion (o nó Ad não tem adset_name direto);
    # created_time permite clampar a síntese de linhas-zero à vida real do ad.
    _INVENTORY_FIELDS = (
        "id,name,effective_status,created_time,"
        "adset_id,campaign_id,adset{name},campaign{name}"
    )

    def fetch_inventory(
        self, act_id: str, meta_filters: Optional[List[Dict[str, Any]]]
    ) -> List[Dict[str, Any]]:
        """Inventário canônico do pack: TODOS os ads que casam com os filtros,
        independente de terem entregado no range (o /insights omite os zerados).

        Sem filtros, pagina a conta inteira (bounded pelo _FILTER_PAGE_CAP).
        O resultado também serve de status_details para enrich() — substitui o
        antigo passe separado de status, que baixava os mesmos dados e descartava
        os ads sem métricas.
        """
        return self._fetch_by_filter_paginated(
            act_id,
            self._INVENTORY_FIELDS,
            meta_filters or [],
            "inventario",
            allow_empty_filters=True,
        )

    def _fetch_edge_statuses(self, act_id: str, edge: str) -> Dict[str, Optional[str]]:
        """id → effective_status de um edge da conta (campaigns/adsets), paginado (limit=500)."""
        result: Dict[str, Optional[str]] = {}
        url = f"{self.base_url}{act_id}/{edge}"
        payload: Dict[str, Any] = {
            "access_token": self.access_token,
            "fields": "id,effective_status",
            "limit": 500,
        }
        page = 0
        while True:
            page += 1
            response_data = self._fetch_batch_with_retry(
                url, payload, f"status-{edge} pag.{page}", return_full=True
            )
            for row in response_data.get("data", []):
                entity_id = str(row.get("id") or "").strip()
                if entity_id:
                    result[entity_id] = str(row.get("effective_status") or "").upper() or None
            next_url = str(response_data.get("paging", {}).get("next") or "").strip()
            if not next_url or page >= 40:
                break
            url = next_url
            payload = {}
        return result

    def fetch_parent_statuses(self, act_id: str) -> Dict[str, Dict[str, Optional[str]]]:
        """
        effective_status oficial de TODAS as campanhas e adsets da conta (2+ chamadas
        paginadas de 500). Alimenta as colunas denormalizadas ads.campaign_status/adset_status
        — o status do PAI não é inferível dos filhos (a ausência de marcadores X_PAUSED nos
        filhos NÃO implica pai ativo).

        Retorna {"campaigns": {campaign_id: status}, "adsets": {adset_id: status}}.
        """
        return {
            "campaigns": self._fetch_edge_statuses(act_id, "campaigns"),
            "adsets": self._fetch_edge_statuses(act_id, "adsets"),
        }

    def merge_details(
        self,
        raw_data: List[Dict[str, Any]],
        details: List[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        if not details:
            return raw_data

        # Prioriza creative/adcreatives do PROPRIO ad; source_ad e usado somente quando o
        # detail nao traz NENHUM dado proprio (ver comentario em _DETAILS_FIELDS — herdar
        # do source com dado proprio presente atribuia a midia do ad de origem a copias
        # que trocaram de midia).
        # Indexacao dupla: por ad_id (detail["id"]) E por nome — o representante fica exato por id,
        # homônimos herdam por nome (comportamento mantido por decisao de custo/beneficio).
        creative_by_id: Dict[str, Optional[Dict[str, Any]]] = {}
        creative_by_name: Dict[str, Optional[Dict[str, Any]]] = {}
        videos_by_id: Dict[str, List[Dict[str, Any]]] = {}
        videos_by_name: Dict[str, List[Dict[str, Any]]] = {}
        images_by_id: Dict[str, List[Dict[str, Any]]] = {}
        images_by_name: Dict[str, List[Dict[str, Any]]] = {}
        primary_video_id_by_id: Dict[str, str] = {}
        primary_video_id_by_name: Dict[str, str] = {}
        page_id_by_id: Dict[str, str] = {}
        page_id_by_name: Dict[str, str] = {}
        source_ad_fallbacks = 0

        for detail in details:
            name = detail.get("name")
            ad_id = str(detail.get("id") or "").strip()
            source_ad = detail.get("source_ad") or {}

            own_creative = detail.get("creative")
            own_adcreatives = detail.get("adcreatives") or {}
            own_data = own_adcreatives.get("data") if isinstance(own_adcreatives, dict) else None

            if own_creative or own_data:
                creative = own_creative
                data = own_data
            else:
                # Detail sem NENHUM dado proprio: unico caso em que herdar do source_ad
                # e melhor que nada (comportamento legado).
                source_ad_fallbacks += 1
                creative = source_ad.get("creative")
                src_adcreatives = source_ad.get("adcreatives") or {}
                data = src_adcreatives.get("data") if isinstance(src_adcreatives, dict) else None

            if ad_id:
                creative_by_id[ad_id] = creative
            if name:
                creative_by_name[name] = creative

            if data:
                first = data[0] or {}
                asset_feed_spec = first.get("asset_feed_spec") or {}

                videos = asset_feed_spec.get("videos")
                if isinstance(videos, list) and videos:
                    if ad_id:
                        videos_by_id[ad_id] = videos
                    if name:
                        videos_by_name[name] = videos
                    first_video = next(
                        (v for v in videos if isinstance(v, dict) and v.get("video_id")),
                        None,
                    )
                    if first_video:
                        pvid = str(first_video.get("video_id"))
                        if ad_id:
                            primary_video_id_by_id[ad_id] = pvid
                        if name:
                            primary_video_id_by_name[name] = pvid

                images = asset_feed_spec.get("images")
                if isinstance(images, list) and images:
                    if ad_id:
                        images_by_id[ad_id] = images
                    if name:
                        images_by_name[name] = images

                page_id = (first.get("object_story_spec") or {}).get("page_id")
                if page_id:
                    if ad_id:
                        page_id_by_id[ad_id] = page_id
                    if name:
                        page_id_by_name[name] = page_id

        logger.info(
            "[AdsEnricher] merge_details: %d/%d detalhes sem dado proprio (fallback source_ad)",
            source_ad_fallbacks,
            len(details),
        )

        for ad in raw_data:
            ad_name = ad.get("ad_name")
            ad_id_key = str(ad.get("ad_id") or "").strip()
            if not ad_id_key and not ad_name:
                continue

            creative = creative_by_id.get(ad_id_key) if ad_id_key else None
            if creative is None and ad_name:
                creative = creative_by_name.get(ad_name)
            if creative is not None:
                ad["creative"] = creative

            videos = (
                (videos_by_id.get(ad_id_key) if ad_id_key else None)
                or (videos_by_name.get(ad_name) if ad_name else None)
                or []
            )
            video_ids = []
            video_thumbs = []
            for video in videos:
                if not isinstance(video, dict) or not video.get("video_id"):
                    # Entrada sem video_id nao contribui thumb — evita desalinhar
                    # thumbs[0] com um asset que nao e o primeiro video do ad
                    continue
                video_ids.append(video.get("video_id"))
                if video.get("thumbnail_url"):
                    video_thumbs.append(video.get("thumbnail_url"))
            ad["adcreatives_videos_ids"] = video_ids
            ad["adcreatives_videos_thumbs"] = video_thumbs

            primary_video_id = (
                (primary_video_id_by_id.get(ad_id_key) if ad_id_key else None)
                or (primary_video_id_by_name.get(ad_name) if ad_name else None)
            )
            if primary_video_id:
                ad["primary_video_id"] = primary_video_id

            page_id = (
                (page_id_by_id.get(ad_id_key) if ad_id_key else None)
                or (page_id_by_name.get(ad_name) if ad_name else None)
            )
            if page_id:
                ad["video_owner_page_id"] = page_id

            # Injetar asset_feed_spec enxuto no creative quando ele nao tem um proprio —
            # permite que resolve_primary_video_id / resolve_media_type usem os dados do adcreatives
            if isinstance(ad.get("creative"), dict) and not ad["creative"].get("asset_feed_spec"):
                afs_videos = (
                    (videos_by_id.get(ad_id_key) if ad_id_key else None)
                    or (videos_by_name.get(ad_name) if ad_name else None)
                )
                afs_images = (
                    (images_by_id.get(ad_id_key) if ad_id_key else None)
                    or (images_by_name.get(ad_name) if ad_name else None)
                )
                afs_subset: Dict[str, Any] = {}
                if afs_videos:
                    afs_subset["videos"] = [
                        {"video_id": v.get("video_id"), "thumbnail_url": v.get("thumbnail_url")}
                        for v in afs_videos if isinstance(v, dict) and v.get("video_id")
                    ]
                if afs_images:
                    afs_subset["images"] = [
                        {"hash": img.get("hash"), "url": img.get("url")}
                        for img in afs_images if isinstance(img, dict)
                    ]
                if afs_subset:
                    ad["creative"]["asset_feed_spec"] = afs_subset

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
        status_details: Optional[List[Dict[str, Any]]] = None,
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
                missing_owner_ad_ids_set = set(
                    ad_id for ad_id in unique_ad_ids
                    if ad_id in existing_ads_map
                    and not str(existing_ads_map[ad_id].get("video_owner_page_id") or "").strip()
                )
                enrich_ad_ids_set = new_ad_ids_set | missing_owner_ad_ids_set
                new_unique_ads = self.deduplicate_by_name(
                    [
                        ad
                        for ad in raw_data
                        if str(ad.get("ad_id") or "").strip() in enrich_ad_ids_set
                    ]
                )
                rep_ids = list(new_unique_ads.values())

                logger.info(
                    "[AdsEnricher] Refresh otimizado: %d ads existentes reutilizados, %d ads novos, %d existentes sem video_owner_page_id para re-enriquecimento",
                    len(existing_ads_map) - len(missing_owner_ad_ids_set),
                    len(new_ad_ids_set),
                    len(missing_owner_ad_ids_set),
                )

            media_details = self.fetch_details(act_id, rep_ids)
            # status_details pré-buscado = inventário do caller (job_processor);
            # evita repetir a mesma chamada /ads que o inventário já fez.
            if status_details is None:
                if meta_filters:
                    status_details = self.fetch_status_by_filter(act_id, meta_filters)
                else:
                    status_details = self.fetch_status_only(act_id, unique_ad_ids)

            enriched = self.merge_details(raw_data, media_details)

            # Passe de ig_media_type: resolver media_type oficial via effective_instagram_media_id
            # APENAS para ads enriquecidos neste ciclo (creative fresco vindo de media_details).
            # Ads reusados no refresh (creative hidratado do DB, media_type ja definitivo) NAO sao
            # re-buscados — sem isso, todo refresh re-buscaria o igm de todo o inventario, custo que
            # contradiz a otimizacao de refresh (fetch_details ja parte do rep_ids reduzido).
            fresh_ids = {str(d.get("id") or "").strip() for d in media_details if d.get("id")}
            fresh_names = {d.get("name") for d in media_details if d.get("name")}
            igm_to_ads: Dict[str, List[Dict[str, Any]]] = {}
            igm_ids_list: List[str] = []
            for ad in enriched:
                ad_id_key = str(ad.get("ad_id") or "").strip()
                ad_name = ad.get("ad_name")
                if ad_id_key not in fresh_ids and ad_name not in fresh_names:
                    continue
                # Só SHARE single-asset precisa do igm pra categorizar: clássicos (video_id/
                # image_hash diretos) e SHARE multi-asset (asset_feed videos/images) já têm tipo
                # estrutural seguro. Pular esses evita lookups redundantes (ex.: ~95/120 do bucket
                # share_video_with_id têm igm mas ja sao video pelo video_id).
                if resolve_structural_media_type(ad) is not None:
                    continue
                igm = str((ad.get("creative") or {}).get("effective_instagram_media_id") or "").strip()
                if igm:
                    if igm not in igm_to_ads:
                        igm_to_ads[igm] = []
                        igm_ids_list.append(igm)
                    igm_to_ads[igm].append(ad)
            if igm_ids_list:
                igm_types = self.fetch_ig_media_types(igm_ids_list)
                for igm, ads_list in igm_to_ads.items():
                    ig_type = igm_types.get(igm)
                    if ig_type:
                        for ad in ads_list:
                            ad["ig_media_type"] = ig_type

            status_map = {d.get("id"): d.get("effective_status") for d in status_details}
            for ad in enriched:
                ad_id = str(ad.get("ad_id") or "")
                if ad_id and ad_id in status_map:
                    ad["effective_status"] = status_map[ad_id]

            # Status oficial dos PAIS (campanha/adset) — devolvido no resultado para o caller
            # gravar POR parent_id (nunca por linha de ad; ver supabase_repo.write_parent_statuses).
            # Best-effort: falha aqui não derruba o enrich (colunas mantêm o valor anterior).
            parent_statuses: Dict[str, Dict[str, Optional[str]]] = {}
            try:
                parent_statuses = self.fetch_parent_statuses(act_id)
            except Exception as exc:
                logger.warning("[AdsEnricher] fetch_parent_statuses falhou (%s); colunas de pai mantêm valor anterior", exc)

            return {
                "success": True,
                "data": enriched,
                "unique_count": len(unique_ads),
                "enriched_count": len(media_details),
                "parent_statuses": parent_statuses,
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
