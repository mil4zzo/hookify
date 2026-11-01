"""Duplicação de campanha com criativos novos (documentation/plano-duplicacao-de-campanha.md).

Fluxo:
    GET  /campaign-launch/template/{ad_id}   pré-voo do anúncio modelo
    POST /campaign-launch/media/image          mídia → biblioteca da Meta (imagem)
    POST /campaign-launch/media/video/start    abre envio em pedaços (vídeo)
    POST /campaign-launch/media/video/{id}/chunk   1 pedaço navegador→Meta
    GET  /campaign-launch/media?ids=           status (avança processamento/capa)
    GET  /campaign-launch/drive/folder         lista mídias de uma pasta do Drive
    POST /campaign-launch/drive/import         servidor importa Drive→Meta
    POST /campaign-launch                      cria o lançamento (só ids de mídia)
    GET  /campaign-launch/latest               último lançamento (retomar a tela)
    GET  /campaign-launch/{job_id}             progresso (+ retomada se o lease venceu)
    POST /campaign-launch/{job_id}/retry       reprocessa itens com erro dos checkpoints
"""
from __future__ import annotations

import logging
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, List, Literal, Optional, Tuple

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field, field_validator

from app.core.config import META_LAUNCH_GRAPH_BASE_URL
from app.core.supabase_client import get_supabase_for_user, get_supabase_service
from app.core.supabase_retry import with_postgrest_retry
from app.core.tier import require_insider
from app.routes.facebook import (
    _assert_entity_belongs_to_user,
    _normalize_account_id,
    _raise_meta_error,
    _resolve_facebook_token_for_ad_account,
    get_graph_api,
)
from app.services import ad_media_library, campaign_launch_service, google_drive_service, supabase_repo
from app.services.creative_media_swap import normalize_story_spec_for_creation
from app.services.creative_template import parse_creative_template
from app.services.facebook_page_token_service import get_user_page_access_info
from app.services.graph_api import GraphAPI
from app.services.job_tracker import STATUS_COMPLETED, STATUS_FAILED, STATUS_PROCESSING, get_job_tracker
from app.services.meta_api_errors import MetaAPIError
from app.services.meta_campaign_clone import (
    merge_page_id_from_promoted_object,
    object_story_actor_from_creative,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/campaign-launch", tags=["campaign-launch"])

MAX_ITEMS = 50

# Advantage+ (ASC/AAC legado e Advantage+ unificado) não pode ser copiado pela API.
_LEGACY_SMART_TYPES = {"AUTOMATED_SHOPPING_ADS", "SMART_APP_PROMOTION"}
_ADVANTAGE_PLUS_STATES = {"ADVANTAGE_PLUS_SALES", "ADVANTAGE_PLUS_APP", "ADVANTAGE_PLUS_LEADS"}


# ── Token por conta (cache curto: cada pedaço de vídeo é uma requisição) ─────

_TOKEN_TTL_SECONDS = 600
_token_cache: Dict[Tuple[str, str], Tuple[float, str, Optional[str]]] = {}
_token_lock = threading.Lock()


def _account_api(user: Dict[str, Any], account_id: str) -> Tuple[GraphAPI, Optional[str]]:
    account_id = _normalize_account_id(account_id)
    key = (str(user["user_id"]), account_id)
    now = time.monotonic()
    with _token_lock:
        cached = _token_cache.get(key)
    if cached and now - cached[0] < _TOKEN_TTL_SECONDS:
        return GraphAPI(cached[1], user_id=user["user_id"], base_url=META_LAUNCH_GRAPH_BASE_URL), cached[2]

    owned = {
        _normalize_account_id(str(a.get("id") or ""))
        for a in supabase_repo.list_ad_accounts(user["token"], user["user_id"])
    }
    if account_id not in owned:
        raise HTTPException(status_code=403, detail={"error": "account_forbidden", "message": "Conta de anúncios não pertence ao usuário."})
    token, connection_id = _resolve_facebook_token_for_ad_account(
        user_jwt=user["token"], user_id=user["user_id"], account_id=account_id,
    )
    with _token_lock:
        _token_cache[key] = (now, token, connection_id)
    return GraphAPI(token, user_id=user["user_id"], base_url=META_LAUNCH_GRAPH_BASE_URL), connection_id


def _meta_http_error(exc: MetaAPIError) -> HTTPException:
    return HTTPException(
        status_code=502,
        detail={"error": exc.error_code or "meta_api_error", "message": exc.message},
    )


# ── Pré-voo do modelo ────────────────────────────────────────────────────────

@dataclass
class LaunchTemplate:
    ad_id: str
    ad_name: str
    account_id: str
    connection_id: Optional[str]
    campaign: Dict[str, Any]
    adsets: List[Dict[str, Any]]
    creative_template: Any
    template_creative: Dict[str, Any]
    template_ad_fields: Dict[str, Any]
    budget: Dict[str, Any]
    currency: Optional[str]
    requires_transparency: bool
    blocking_reasons: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)


def _budget_model(campaign: Dict[str, Any], adsets: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Onde o modelo guarda orçamento: campanha (CBO) ou conjuntos (ABO); diário ou total."""
    for field_name in ("daily_budget", "lifetime_budget"):
        if campaign.get(field_name):
            return {"level": "campaign", "field": field_name, "amount": int(campaign[field_name])}
    for field_name in ("daily_budget", "lifetime_budget"):
        amounts = [int(a[field_name]) for a in adsets if a.get(field_name)]
        if amounts:
            return {"level": "adset", "field": field_name, "amount": amounts[0]}
    return {"level": None, "field": None, "amount": None}


def _account_flags(user: Dict[str, Any], account_id: str) -> Tuple[bool, Optional[str]]:
    try:
        sb = get_supabase_for_user(user["token"])
        res = (
            sb.table("ad_accounts")
            .select("requires_ads_transparency,currency")
            .in_("id", [account_id, f"act_{account_id}"])
            .eq("user_id", user["user_id"])
            .limit(1)
            .execute()
        )
        row = (res.data or [{}])[0]
        return bool(row.get("requires_ads_transparency")), row.get("currency")
    except Exception:  # noqa: BLE001 — flags são avisos, não bloqueiam
        logger.warning("[CAMPAIGN_LAUNCH] account_flags_failed account=%s", account_id, exc_info=True)
        return False, None


def load_launch_template(user: Dict[str, Any], ad_id: str, default_api: GraphAPI) -> LaunchTemplate:
    _assert_entity_belongs_to_user(user_jwt=user["token"], user_id=user["user_id"], entity_type="ad", entity_id=ad_id)

    # A instância injetada (get_graph_api) é da versão global; a leitura do modelo já vai em v26.
    first_api = GraphAPI(default_api.access_token, user_id=user["user_id"], base_url=META_LAUNCH_GRAPH_BASE_URL)
    ad_result = first_api.get_launch_template_ad(ad_id)
    if ad_result.get("status") != "success":
        _raise_meta_error(ad_result, user=user, default_not_found_error="ad_not_found")
    ad = ad_result.get("data") or {}
    account_id = _normalize_account_id(str(ad.get("account_id") or ""))
    api, connection_id = _account_api(user, account_id)

    campaign_id = str(ad.get("campaign_id") or "")
    campaign_result = api.get_campaign_config(campaign_id)
    if campaign_result.get("status") != "success":
        _raise_meta_error(campaign_result, user=user, default_not_found_error="campaign_not_found")
    campaign = campaign_result.get("data") or {}

    adsets_result = api.get_adsets_for_campaign(campaign_id)
    if adsets_result.get("status") != "success":
        _raise_meta_error(adsets_result, user=user, default_not_found_error="adsets_not_found")
    adsets = (adsets_result.get("data") or {}).get("data") or []

    creative = ad.get("creative") or {}
    template = parse_creative_template({"creative": creative, "name": ad.get("name")})

    # Identidade: page_id às vezes só aparece no promoted_object do conjunto.
    actor = object_story_actor_from_creative(creative)
    if not actor.get("page_id"):
        for row in adsets:
            if str(row.get("id")) == str(ad.get("adset_id")):
                merge_page_id_from_promoted_object(actor, row.get("promoted_object"))
    if actor.get("page_id") and not template.story_spec_base.get("page_id"):
        template.story_spec_base["page_id"] = str(actor["page_id"])
    instagram_user_id = actor.get("instagram_user_id") or actor.get("instagram_actor_id") or creative.get("instagram_user_id")
    if instagram_user_id and not template.story_spec_base.get("instagram_user_id"):
        template.story_spec_base["instagram_user_id"] = str(instagram_user_id)
    template.story_spec_base = normalize_story_spec_for_creation(template.story_spec_base)

    requires_transparency, currency = _account_flags(user, account_id)
    blocking: List[str] = []
    warnings: List[str] = list(template.capabilities.warnings)

    smart_type = str(campaign.get("smart_promotion_type") or "").upper()
    advantage_state = str(((campaign.get("advantage_state_info") or {}).get("advantage_state")) or "").upper()
    if smart_type in _LEGACY_SMART_TYPES or advantage_state in _ADVANTAGE_PLUS_STATES:
        blocking.append(
            "Campanhas Advantage+ não podem ser copiadas pela API da Meta. Escolha um anúncio de uma campanha manual."
        )
    if not template.capabilities.supports_bulk_clone:
        blocking.append(template.capabilities.blocking_reason or "Formato de criativo não suportado.")
    page_id = str(template.story_spec_base.get("page_id") or "")
    if page_id:
        try:
            administered, page_name = get_user_page_access_info(
                user_id=user["user_id"], user_access_token=api.access_token, page_id=page_id,
            )
            if not administered:
                blocking.append(
                    f"Sua conexão do Facebook não administra a página '{page_name or page_id}' usada neste anúncio."
                )
        except Exception:  # noqa: BLE001
            logger.warning("[CAMPAIGN_LAUNCH] page_access_check_failed page=%s", page_id, exc_info=True)

    adset_views: List[Dict[str, Any]] = []
    for row in adsets:
        compliant = bool(row.get("regional_regulated_categories") or row.get("dsa_beneficiary"))
        adset_views.append(
            {
                "id": str(row.get("id")),
                "name": str(row.get("name") or ""),
                "status": row.get("status"),
                "end_time": row.get("end_time"),
                "schedule_expired": campaign_launch_service.is_meta_datetime_in_past(row.get("end_time")),
                "daily_budget": int(row["daily_budget"]) if row.get("daily_budget") else None,
                "lifetime_budget": int(row["lifetime_budget"]) if row.get("lifetime_budget") else None,
                "has_ads_transparency": compliant,
                "blocked_reason": (
                    "Sem 'Transparência dos anúncios' — esta conta exige." if requires_transparency and not compliant else None
                ),
                "is_template_adset": str(row.get("id")) == str(ad.get("adset_id")),
            }
        )
    if adset_views and all(a["blocked_reason"] for a in adset_views):
        blocking.append("Nenhum conjunto desta campanha tem 'Transparência dos anúncios', que esta conta exige.")

    return LaunchTemplate(
        ad_id=ad_id,
        ad_name=str(ad.get("name") or ""),
        account_id=account_id,
        connection_id=connection_id,
        campaign=campaign,
        adsets=adset_views,
        creative_template=template,
        template_creative=creative,
        template_ad_fields={k: ad.get(k) for k in ("tracking_specs", "conversion_domain") if ad.get(k)},
        budget=_budget_model(campaign, adsets),
        currency=currency,
        requires_transparency=requires_transparency,
        blocking_reasons=blocking,
        warnings=warnings,
    )


@router.get("/template/{ad_id}")
def get_launch_template(
    ad_id: str,
    api: GraphAPI = Depends(get_graph_api),
    user: Dict[str, Any] = Depends(require_insider),
):
    t = load_launch_template(user, ad_id, api)
    preview = t.creative_template.to_preview_response(t.template_creative)
    preview["creative"] = {}  # contrato do CreativePreview; o cru não vai ao navegador
    return {
        "ad_id": t.ad_id,
        "ad_name": t.ad_name,
        "account_id": t.account_id,
        "currency": t.currency,
        "campaign": {
            "id": str(t.campaign.get("id") or ""),
            "name": str(t.campaign.get("name") or ""),
            "objective": t.campaign.get("objective"),
            "status": t.campaign.get("status"),
            "bid_strategy": t.campaign.get("bid_strategy"),
        },
        "budget": t.budget,
        "adsets": t.adsets,
        "creative": preview,
        "requires_ads_transparency": t.requires_transparency,
        "blocking_reasons": t.blocking_reasons,
        "warnings": t.warnings,
    }


# ── Lançar ───────────────────────────────────────────────────────────────────

class LaunchItemIn(BaseModel):
    ad_name: str = Field(min_length=1, max_length=400)
    campaign_name: str = Field(min_length=1, max_length=400)
    media: Dict[str, str]  # slot_key → ad_media_library.id

    @field_validator("ad_name", "campaign_name")
    @classmethod
    def _strip(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("não pode ser vazio")
        return value


class LaunchRequest(BaseModel):
    template_ad_id: str
    adset_ids: List[str] = Field(min_length=1)
    status: Literal["ACTIVE", "PAUSED"] = "PAUSED"
    adset_name_template: str = Field(default="{template_adset_name}", min_length=1, max_length=400)
    budget_amount: Optional[int] = Field(default=None, gt=0)  # subunidade da moeda (centavos)
    items: List[LaunchItemIn] = Field(min_length=1, max_length=MAX_ITEMS)


def _validation_error(message: str) -> HTTPException:
    return HTTPException(status_code=422, detail={"error": "validation_error", "message": message})


@router.post("", status_code=202)
def create_launch(
    request: LaunchRequest,
    api: GraphAPI = Depends(get_graph_api),
    user: Dict[str, Any] = Depends(require_insider),
):
    t = load_launch_template(user, request.template_ad_id, api)
    if t.blocking_reasons:
        raise HTTPException(status_code=422, detail={"error": "template_blocked", "message": t.blocking_reasons[0]})

    adsets_by_id = {a["id"]: a for a in t.adsets}
    unknown = [a for a in request.adset_ids if a not in adsets_by_id]
    if unknown:
        raise _validation_error("Conjunto selecionado não pertence à campanha modelo.")
    blocked = [adsets_by_id[a]["name"] for a in request.adset_ids if adsets_by_id[a]["blocked_reason"]]
    if blocked:
        raise _validation_error(f"Conjunto sem 'Transparência dos anúncios': {blocked[0]}")

    slot_keys = {s.slot_key for s in t.creative_template.media_slots}
    required = {s.slot_key for s in t.creative_template.media_slots if s.required}
    sb = get_supabase_service()
    all_media_ids = {m for item in request.items for m in item.media.values()}
    media_rows = ad_media_library.fetch_media(sb, user["user_id"], all_media_ids)
    for item in request.items:
        if set(item.media) - slot_keys:
            raise _validation_error(f"'{item.ad_name}': slot que não existe neste modelo.")
        if required - set(item.media):
            raise _validation_error(f"'{item.ad_name}': falta mídia em um dos posicionamentos do modelo.")
        for media_id in item.media.values():
            row = media_rows.get(media_id)
            if not row or row.get("account_id") != t.account_id:
                raise _validation_error(f"'{item.ad_name}': mídia não encontrada para esta conta.")
            if row.get("status") == "error":
                raise _validation_error(f"'{item.ad_name}': a mídia '{row.get('file_name')}' falhou no envio.")

    budget_override = None
    if request.budget_amount:
        if not t.budget.get("level"):
            raise _validation_error("O modelo não tem orçamento definido para sobrescrever.")
        budget_override = {**t.budget, "amount": request.budget_amount}

    job_id = str(uuid.uuid4())
    tracker = get_job_tracker(user["token"], user["user_id"], use_service_role=True)
    selected = [adsets_by_id[a] for a in request.adset_ids]
    created = tracker.create_job(
        job_id=job_id,
        status=STATUS_PROCESSING,
        message=f"Lançamento de {len(request.items)} campanha(s) na fila",
        payload={
            "type": campaign_launch_service.JOB_TYPE,
            "template_ad_id": t.ad_id,
            "template_ad_name": t.ad_name,
            "template_campaign_id": str(t.campaign.get("id") or ""),
            "template_campaign_name": str(t.campaign.get("name") or ""),
            "account_id": t.account_id,
            "connection_id": t.connection_id,
            "status": request.status,
            "total_items": len(request.items),
            "budget_override": budget_override,
            "creative_template": t.creative_template.to_payload(),
            "template_creative": t.template_creative,
            "template_ad_fields": t.template_ad_fields,
        },
    )
    if not created:
        raise HTTPException(status_code=503, detail={"error": "job_create_failed", "message": "Não foi possível criar o lançamento."})

    campaign_launch_service.insert_items(
        sb,
        [
            {
                "job_id": job_id,
                "user_id": user["user_id"],
                "position": position,
                "ad_name": item.ad_name,
                "campaign_name": item.campaign_name,
                "adset_name_template": request.adset_name_template,
                "media": item.media,
                "adsets": [
                    {
                        "source_adset_id": a["id"],
                        "source_adset_name": a["name"],
                        "source_end_time": a.get("end_time"),
                    }
                    for a in selected
                ],
            }
            for position, item in enumerate(request.items, start=1)
        ],
    )
    _start(user, job_id, t.account_id, t.connection_id)
    return {"job_id": job_id, "total_items": len(request.items)}


def _start(user: Dict[str, Any], job_id: str, account_id: str, connection_id: Optional[str]) -> None:
    token, _ = _resolve_facebook_token_for_ad_account(
        user_jwt=user["token"], user_id=user["user_id"], account_id=account_id, preferred_connection_id=connection_id,
    )
    campaign_launch_service.start_in_background(
        campaign_launch_service.LaunchContext(
            user_jwt=user["token"],
            user_id=user["user_id"],
            access_token=token,
            job_id=job_id,
            account_id=account_id,
        )
    )


def _progress(user: Dict[str, Any], job: Dict[str, Any]) -> Dict[str, Any]:
    payload = job.get("payload") or {}
    items = campaign_launch_service.fetch_items(get_supabase_service(), str(job["id"]))
    return {
        "job_id": job["id"],
        "status": job.get("status"),
        "progress": job.get("progress") or 0,
        "message": job.get("message") or "",
        "created_at": job.get("created_at"),
        "account_id": payload.get("account_id"),
        "launch_status": payload.get("status"),
        "template": {
            "ad_id": payload.get("template_ad_id"),
            "ad_name": payload.get("template_ad_name"),
            "campaign_name": payload.get("template_campaign_name"),
        },
        "summary": campaign_launch_service.summarize(items),
        "items": [campaign_launch_service.public_item(i) for i in items],
    }


def _get_launch_job(user: Dict[str, Any], job_id: str) -> Tuple[Any, Dict[str, Any]]:
    tracker = get_job_tracker(user["token"], user["user_id"], use_service_role=True)
    job = tracker.get_job(job_id)
    if not job or (job.get("payload") or {}).get("type") != campaign_launch_service.JOB_TYPE:
        raise HTTPException(status_code=404, detail={"error": "job_not_found", "message": "Lançamento não encontrado."})
    return tracker, job


@router.get("/latest")
def get_latest_launch(user: Dict[str, Any] = Depends(require_insider)):
    sb = get_supabase_service()
    res = with_postgrest_retry(
        "campaign_launch.latest",
        lambda: sb.table("jobs")
        .select("*")
        .eq("user_id", user["user_id"])
        .contains("payload", {"type": campaign_launch_service.JOB_TYPE})
        .order("created_at", desc=True)
        .limit(1)
        .execute(),
    )
    rows = res.data or []
    return {"launch": _progress(user, rows[0]) if rows else None}


# ── Mídia: computador ────────────────────────────────────────────────────────

@router.post("/media/image")
def upload_image(
    file: UploadFile = File(...),
    account_id: str = Form(...),
    fingerprint: str = Form(...),
    width: Optional[int] = Form(None),
    height: Optional[int] = Form(None),
    user: Dict[str, Any] = Depends(require_insider),
):
    content_type = str(file.content_type or "").lower()
    if content_type not in ad_media_library.IMAGE_CONTENT_TYPES:
        raise _validation_error("Imagem precisa ser JPG ou PNG.")
    content = file.file.read(ad_media_library.IMAGE_MAX_BYTES + 1)
    if len(content) > ad_media_library.IMAGE_MAX_BYTES:
        raise _validation_error("Imagem acima de 30 MB.")
    api, _ = _account_api(user, account_id)
    sb = get_supabase_service()
    row, reused = ad_media_library.register_media(
        sb,
        user_id=user["user_id"],
        account_id=account_id,
        source="upload",
        fingerprint=f"file:{fingerprint}",
        file_name=file.filename or "imagem",
        media_type="image",
        size_bytes=len(content),
        width=width,
        height=height,
    )
    if not reused:
        row = ad_media_library.store_image(sb, api, row, content)
    return ad_media_library.public_media(row)


class VideoStartRequest(BaseModel):
    account_id: str
    fingerprint: str = Field(min_length=1, max_length=500)
    file_name: str = Field(min_length=1, max_length=400)
    content_type: str
    size_bytes: int = Field(gt=0)
    width: Optional[int] = None
    height: Optional[int] = None
    duration_ms: Optional[int] = None


@router.post("/media/video/start")
def start_video(request: VideoStartRequest, user: Dict[str, Any] = Depends(require_insider)):
    if request.content_type.lower() not in ad_media_library.VIDEO_CONTENT_TYPES:
        raise _validation_error("Vídeo precisa ser MP4 ou MOV.")
    if request.size_bytes > ad_media_library.VIDEO_MAX_BYTES:
        raise _validation_error("Vídeo acima de 4 GB.")
    api, _ = _account_api(user, request.account_id)
    sb = get_supabase_service()
    row, reused = ad_media_library.register_media(
        sb,
        user_id=user["user_id"],
        account_id=request.account_id,
        source="upload",
        fingerprint=f"file:{request.fingerprint}",
        file_name=request.file_name,
        media_type="video",
        size_bytes=request.size_bytes,
        width=request.width,
        height=request.height,
        duration_ms=request.duration_ms,
    )
    if row.get("status") == "uploading":
        try:
            row = ad_media_library.start_video_session(sb, api, row)
        except MetaAPIError as exc:
            row = ad_media_library.mark_error(sb, str(row["id"]), exc.message)
    return ad_media_library.public_media(row)


@router.post("/media/video/{media_id}/chunk")
def upload_video_chunk(
    media_id: str,
    start_offset: int = Form(...),
    chunk: UploadFile = File(...),
    user: Dict[str, Any] = Depends(require_insider),
):
    sb = get_supabase_service()
    row = ad_media_library.fetch_media(sb, user["user_id"], [media_id]).get(media_id)
    if not row:
        raise HTTPException(status_code=404, detail={"error": "media_not_found", "message": "Mídia não encontrada."})
    api, _ = _account_api(user, row["account_id"])
    data = chunk.file.read()
    row = ad_media_library.transfer_video_chunk(sb, api, row, start_offset, data)
    return ad_media_library.public_media(row)


@router.get("/media")
def get_media(ids: str = Query(..., max_length=4000), user: Dict[str, Any] = Depends(require_insider)):
    media_ids = [m for m in ids.split(",") if m][:200]
    sb = get_supabase_service()
    rows = ad_media_library.fetch_media(sb, user["user_id"], media_ids)
    apis: Dict[str, GraphAPI] = {}
    for media_id, row in list(rows.items()):
        if row.get("status") != "processing":
            continue
        account_id = row["account_id"]
        if account_id not in apis:
            apis[account_id], _ = _account_api(user, account_id)
        rows[media_id] = ad_media_library.refresh_processing(sb, apis[account_id], row)
    return {"media": [ad_media_library.public_media(rows[m]) for m in media_ids if m in rows]}


# ── Mídia: Google Drive ──────────────────────────────────────────────────────

@router.get("/drive/folder")
def list_drive_folder(
    url: str = Query(..., max_length=2000),
    user: Dict[str, Any] = Depends(require_insider),
):
    folder_id = google_drive_service.parse_folder_id(url)
    if not folder_id:
        raise _validation_error("Link de pasta do Google Drive inválido.")
    try:
        folder, files = google_drive_service.list_folder_media(user["token"], user["user_id"], folder_id)
    except google_drive_service.DriveError as exc:
        raise HTTPException(status_code=exc.status_code, detail={"error": exc.code, "message": exc.message}) from exc
    return {"folder": folder, "files": files}


class DriveImportFile(BaseModel):
    id: str
    name: str
    mime_type: str
    size_bytes: int = Field(gt=0)
    md5: Optional[str] = None
    width: Optional[int] = None
    height: Optional[int] = None
    duration_ms: Optional[int] = None


class DriveImportRequest(BaseModel):
    account_id: str
    files: List[DriveImportFile] = Field(min_length=1, max_length=200)


@router.post("/drive/import", status_code=202)
def import_from_drive(request: DriveImportRequest, user: Dict[str, Any] = Depends(require_insider)):
    api, _ = _account_api(user, request.account_id)
    sb = get_supabase_service()
    rows: List[Dict[str, Any]] = []
    to_import: List[Dict[str, Any]] = []
    for f in request.files:
        media_type = google_drive_service.media_type_for(f.mime_type)
        if not media_type:
            raise _validation_error(f"'{f.name}' não é imagem (JPG/PNG) nem vídeo (MP4/MOV).")
        limit = ad_media_library.IMAGE_MAX_BYTES if media_type == "image" else ad_media_library.VIDEO_MAX_BYTES
        if f.size_bytes > limit:
            raise _validation_error(f"'{f.name}' passa do limite da Meta ({'30 MB' if media_type == 'image' else '4 GB'}).")
        row, reused = ad_media_library.register_media(
            sb,
            user_id=user["user_id"],
            account_id=request.account_id,
            source="drive",
            fingerprint=f"drive:{f.id}:{f.md5 or f.size_bytes}",
            file_name=f.name,
            media_type=media_type,
            size_bytes=f.size_bytes,
            width=f.width,
            height=f.height,
            duration_ms=f.duration_ms,
            drive_file_id=f.id,
        )
        rows.append(row)
        if not reused or ad_media_library.is_stale_upload(row):
            to_import.append(row)
    if to_import:
        google_drive_service.import_in_background(
            user_jwt=user["token"], user_id=user["user_id"], api=api, rows=to_import,
        )
    return {"media": [ad_media_library.public_media(r) for r in rows]}


# ── Rotas por id (por último: `/{job_id}` capturaria `/media`) ──────────────

@router.get("/{job_id}")
def get_launch(job_id: str, user: Dict[str, Any] = Depends(require_insider)):
    tracker, job = _get_launch_job(user, job_id)
    # Retomada: lease vencido = o worker morreu (deploy, crash). Quem consulta reassume;
    # os checkpoints garantem que nada é recriado.
    if job.get("status") == STATUS_PROCESSING and tracker.should_resume_processing(job_id):
        payload = job.get("payload") or {}
        logger.info("[CAMPAIGN_LAUNCH] resume job_id=%s", job_id)
        _start(user, job_id, str(payload.get("account_id") or ""), payload.get("connection_id"))
    return _progress(user, job)


class RetryRequest(BaseModel):
    item_ids: Optional[List[str]] = None


@router.post("/{job_id}/retry", status_code=202)
def retry_launch(job_id: str, request: RetryRequest, user: Dict[str, Any] = Depends(require_insider)):
    tracker, job = _get_launch_job(user, job_id)
    if job.get("status") not in (STATUS_COMPLETED, STATUS_FAILED):
        raise HTTPException(status_code=409, detail={"error": "job_running", "message": "O lançamento ainda está em andamento."})
    reset = campaign_launch_service.reset_failed_items(get_supabase_service(), job_id, request.item_ids)
    if not reset:
        raise _validation_error("Nenhum item com erro para tentar de novo.")
    tracker.heartbeat(job_id, status=STATUS_PROCESSING, progress=0, message=f"Tentando de novo {reset} item(ns)...")
    payload = job.get("payload") or {}
    _start(user, job_id, str(payload.get("account_id") or ""), payload.get("connection_id"))
    return {"job_id": job_id, "retried": reset}
