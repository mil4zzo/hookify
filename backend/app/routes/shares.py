"""
Compartilhamento público de criativos (stories) — /shares.

Fluxo: o Manager (aba Criativos) envia os ad_names selecionados + snapshot de
métricas (dados que a própria tabela recebeu do servidor). O backend valida
ownership (RLS), resolve a mídia dos representantes reusando a máquina do
export (cache-first, dedupe por vídeo, lote de imagens por conta) e grava um
snapshot AUTOCONTIDO em ad_shares. O read-path público (GET /shares/{token})
lê somente essa tabela via service role — nunca toca ads/ad_metrics nem a Meta.

Expiração é comportamento, não bug: o video_url da CDN da Meta expira (oe=) e
o viewer degrada o slide para aviso; o link inteiro expira em SHARE_TTL_DAYS.
"""
from __future__ import annotations

import logging
import math
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException

from app.core.auth import get_current_user
from app.core.supabase_client import get_supabase_for_user, get_supabase_service
from app.routes.facebook import get_graph_api, get_media_source_urls_batch
from app.services import supabase_repo
from app.services.graph_api import GraphAPI
from app.services.thumbnail_cache import DEFAULT_BUCKET, build_public_storage_url
from app.services.video_source_cache import _parse_iso

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/shares", tags=["shares"])

SHARE_TTL_DAYS = 30
MAX_SHARE_ITEMS = 20
_MAX_AD_NAME_LEN = 300
_INSERT_RETRIES = 3

# Token curto (URL "elegante") mas ainda seguro contra brute-force: alfabeto
# Base58 (sem 0/O/1/l ambíguos — legível para copiar/ditar em voz alta) em 10
# posições dá ~58.6 bits de entropia (log2(58)*10). Ordem de grandeza: mesmo a
# 1000 req/s sustentados (rate limit dedicado abaixo torna isso já difícil),
# variar um span de milhares de shares ativos levaria décadas para colidir —
# muito acima do necessário para dados de performance de anúncio (sensível,
# mas não credencial). NÃO reduzir sem also apertar o rate limit da rota.
_TOKEN_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
_TOKEN_LENGTH = 10


def _generate_share_token() -> str:
    return "".join(secrets.choice(_TOKEN_ALPHABET) for _ in range(_TOKEN_LENGTH))

# Chaves aceitas no snapshot de métricas — as do modal de detalhamento
# (Resultados/Funil/Retenção/Visibilidade) + contagens usadas como subtítulo.
ALLOWED_METRIC_KEYS = frozenset({
    # Resultados
    "cpmql", "cpr", "cpc", "cpm",
    # Funil
    "ctr", "website_ctr", "connect_rate", "page_conv",
    # Retenção
    "scroll_stop", "hook", "hold_rate", "video_watched_p50",
    # Visibilidade
    "spend", "frequency", "impressions", "reach",
    # Contagens de contexto (subtítulos)
    "results", "clicks", "mql_count",
})


# ── Helpers puros (unit-testáveis) ───────────────────────────────────────────

def sanitize_metrics(metrics: Any) -> Dict[str, Optional[float]]:
    """Filtra o snapshot para chaves conhecidas e valores numéricos finitos.

    Valores ausentes/não-numéricos viram None (o viewer esconde a métrica);
    chaves fora do contrato são descartadas — o snapshot é conteúdo público,
    nada entra por acidente."""
    out: Dict[str, Optional[float]] = {}
    if not isinstance(metrics, dict):
        return out
    for key, value in metrics.items():
        if key not in ALLOWED_METRIC_KEYS:
            continue
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            out[key] = None
        elif not math.isfinite(float(value)):
            out[key] = None
        else:
            out[key] = float(value)
    return out


def _parse_date(value: Any, field: str) -> str:
    try:
        return datetime.strptime(str(value or ""), "%Y-%m-%d").date().isoformat()
    except ValueError:
        raise HTTPException(status_code=422, detail=f"{field} inválido (esperado YYYY-MM-DD)")


def validate_share_payload(body: Dict[str, Any]) -> Dict[str, Any]:
    """Valida o body do POST /shares → {date_start, date_stop, currency, items}.

    items normalizados: [{"ad_name": str, "metrics": {...sanitizado}}], sem
    duplicatas, ordem preservada (é a ordem dos slides)."""
    date_start = _parse_date(body.get("date_start"), "date_start")
    date_stop = _parse_date(body.get("date_stop"), "date_stop")
    if date_start > date_stop:
        raise HTTPException(status_code=422, detail="date_start não pode ser depois de date_stop")

    currency_raw = str(body.get("currency") or "").strip().upper()
    currency = currency_raw if currency_raw.isalpha() and 3 <= len(currency_raw) <= 8 else None

    items_raw = body.get("items")
    if not isinstance(items_raw, list) or not items_raw:
        raise HTTPException(status_code=422, detail="items é obrigatório (lista não-vazia)")
    if len(items_raw) > MAX_SHARE_ITEMS:
        raise HTTPException(status_code=422, detail=f"Máximo de {MAX_SHARE_ITEMS} criativos por link")

    items: List[Dict[str, Any]] = []
    seen: set = set()
    for raw in items_raw:
        if not isinstance(raw, dict):
            raise HTTPException(status_code=422, detail="Cada item deve ser um objeto {ad_name, metrics}")
        ad_name = str(raw.get("ad_name") or "").strip()
        if not ad_name or len(ad_name) > _MAX_AD_NAME_LEN:
            raise HTTPException(status_code=422, detail="ad_name inválido em um dos itens")
        if ad_name in seen:
            raise HTTPException(status_code=422, detail=f"Criativo duplicado: {ad_name}")
        seen.add(ad_name)
        items.append({"ad_name": ad_name, "metrics": sanitize_metrics(raw.get("metrics"))})

    return {"date_start": date_start, "date_stop": date_stop, "currency": currency, "items": items}


def summarize_media_rows(rows: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """{ad_name: {"is_video": bool, "thumbnail_url": str|None}} a partir das
    linhas de ads. Representante de thumb: primeira linha com thumb_storage_path
    (Storage-only — nunca CDN da Meta)."""
    summary: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        name = str(row.get("ad_name") or "").strip()
        if not name:
            continue
        entry = summary.setdefault(name, {"is_video": False, "thumbnail_url": None})
        if str(row.get("media_type") or "").strip().lower() == "video":
            entry["is_video"] = True
        if not entry["thumbnail_url"]:
            storage_path = str(row.get("thumb_storage_path") or "").strip()
            if storage_path:
                entry["thumbnail_url"] = build_public_storage_url(DEFAULT_BUCKET, storage_path)
    return summary


def build_share_items(
    items: List[Dict[str, Any]],
    media_summary: Dict[str, Dict[str, Any]],
    media_results: Dict[str, Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Monta os slides do snapshot. Mídia inacessível NÃO bloqueia o share —
    o slide degrada para thumbnail (permanente) e o viewer mostra o aviso."""
    slides: List[Dict[str, Any]] = []
    for item in items:
        name = item["ad_name"]
        info = media_summary.get(name) or {"is_video": False, "thumbnail_url": None}
        result = media_results.get(name) or {}
        url = result.get("url")
        resolved_video = bool(result.get("video_id"))
        is_video = bool(info["is_video"] or resolved_video)

        expires_at = result.get("expires_at")
        if hasattr(expires_at, "isoformat"):
            expires_at = expires_at.isoformat()

        media = {
            "type": "video" if is_video else "image",
            "thumbnail_url": info["thumbnail_url"],
            "video_url": url if (is_video and resolved_video) else None,
            "video_expires_at": expires_at if (is_video and resolved_video and url) else None,
            "image_url": url if (url and not is_video) else None,
        }
        slides.append({"ad_name": name, "media": media, "metrics": item["metrics"]})
    return slides


def is_share_viewable(row: Dict[str, Any], now: Optional[datetime] = None) -> bool:
    """Ativo = não revogado e não expirado. expires_at NULL = sem expiração."""
    if not row or row.get("revoked_at"):
        return False
    now = now or datetime.now(timezone.utc)
    expires_at = _parse_iso(row.get("expires_at"))
    if expires_at is not None and expires_at <= now:
        return False
    return True


def public_share_payload(row: Dict[str, Any]) -> Dict[str, Any]:
    """Projeção pública do share — allowlist explícita, nunca user_id/id."""
    return {
        "items": row.get("items") or [],
        "date_start": row.get("date_start"),
        "date_stop": row.get("date_stop"),
        "currency": row.get("currency"),
        "created_at": row.get("created_at"),
        "expires_at": row.get("expires_at"),
    }


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post("")
def create_share(
    body: Dict[str, Any] = Body(...),
    api: GraphAPI = Depends(get_graph_api),
    user: Dict[str, Any] = Depends(get_current_user),
):
    """Cria um link público de compartilhamento a partir de ad_names + snapshot.

    Ownership: nome sem linha em ads (client RLS) → 422. Mídia: reusa a máquina
    do export (cache-first, EXPORT_MIN_TTL_S) — falha pontual degrada o slide
    para thumbnail; token da Meta expirado propaga 401 (frontend reconecta)."""
    payload = validate_share_payload(body)
    names = [item["ad_name"] for item in payload["items"]]

    rows = supabase_repo.get_ads_media_summary_by_names(user["token"], user["user_id"], names)
    media_summary = summarize_media_rows(rows)
    unknown = [n for n in names if n not in media_summary]
    if unknown:
        raise HTTPException(
            status_code=422,
            detail=f"Criativos não encontrados na sua conta: {', '.join(unknown[:5])}",
        )

    media_results = get_media_source_urls_batch(
        body={"ad_names": names}, api=api, user=user
    ).get("results", {})

    slides = build_share_items(payload["items"], media_summary, media_results)
    expires_at = datetime.now(timezone.utc) + timedelta(days=SHARE_TTL_DAYS)

    sb = get_supabase_for_user(user["token"])
    last_error: Optional[Exception] = None
    for _ in range(_INSERT_RETRIES):
        token = _generate_share_token()
        try:
            res = (
                sb.table("ad_shares")
                .insert({
                    "user_id": user["user_id"],
                    "token": token,
                    "date_start": payload["date_start"],
                    "date_stop": payload["date_stop"],
                    "currency": payload["currency"],
                    "items": slides,
                    "expires_at": expires_at.isoformat(),
                })
                .execute()
            )
            row = (res.data or [{}])[0]
            logger.info(
                f"[SHARES] Criado share {str(row.get('id'))[:8]}… com {len(slides)} slides "
                f"({sum(1 for s in slides if s['media']['video_url'] or s['media']['image_url'])} com mídia resolvida)"
            )
            return {"id": row.get("id"), "token": token, "expires_at": expires_at.isoformat()}
        except Exception as e:
            # Colisão de token (unique) é a única falha que vale re-tentar
            message = str(e)
            if "23505" in message or "duplicate key" in message.lower():
                last_error = e
                continue
            raise
    raise HTTPException(status_code=500, detail=f"Falha ao gerar token único: {last_error}")


@router.get("")
def list_shares(user: Dict[str, Any] = Depends(get_current_user)):
    """Lista os shares do usuário (metadados; sem o snapshot completo)."""
    sb = get_supabase_for_user(user["token"])
    res = (
        sb.table("ad_shares")
        .select("id,token,date_start,date_stop,currency,view_count,created_at,expires_at,revoked_at")
        .eq("user_id", user["user_id"])
        .order("created_at", desc=True)
        .limit(100)
        .execute()
    )
    return {"shares": res.data or []}


@router.delete("/{share_id}")
def revoke_share(share_id: str, user: Dict[str, Any] = Depends(get_current_user)):
    """Revoga um share (marca revoked_at; preserva a linha para histórico)."""
    sb = get_supabase_for_user(user["token"])
    res = (
        sb.table("ad_shares")
        .update({"revoked_at": datetime.now(timezone.utc).isoformat()})
        .eq("id", share_id)
        .eq("user_id", user["user_id"])
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Share não encontrado")
    return {"ok": True}


@router.get("/public/{token}")
def get_share_public(token: str):
    """Read-path PÚBLICO do link compartilhado — sem autenticação.

    Lê exclusivamente ad_shares via service role, filtrado por token
    não-adivinhável. 404 genérico para inexistente/revogado/expirado (não
    distinguir — não vazar existência). Nunca retorna user_id/id."""
    token = str(token or "").strip()
    if len(token) != _TOKEN_LENGTH:
        raise HTTPException(status_code=404, detail="Link não encontrado")

    sb = get_supabase_service()
    res = (
        sb.table("ad_shares")
        .select("*")
        .eq("token", token)
        .limit(1)
        .execute()
    )
    row = (res.data or [None])[0]
    if not is_share_viewable(row):
        raise HTTPException(status_code=404, detail="Link não encontrado")

    # Contador best-effort (não-atômico por design; ver comment da coluna)
    try:
        sb.table("ad_shares").update(
            {"view_count": int(row.get("view_count") or 0) + 1}
        ).eq("id", row["id"]).execute()
    except Exception as e:
        logger.warning(f"[SHARES] Falha ao incrementar view_count (best-effort): {e}")

    return public_share_payload(row)
