"""
Resolução em lote de URL de imagem em alta resolução, com cache no banco.

Espelho do video_source_cache para ads de imagem, com duas diferenças a favor:

1. O caminho principal usa os image_hashes já presentes em ads.creative (banco) e o
   /act_{id}/adimages aceita LOTE de hashes — uma chamada por conta resolve dezenas
   de imagens. Não há ad-read por anúncio nem page token.
2. O permalink_url retornado (facebook.com/ads/image/?d=...) redireciona para o CDN
   com assinatura fresca a cada acesso — é efetivamente permanente (verificado com
   download anônimo: HTTP 200 image/jpeg no tamanho original). Gravamos expiry longo
   e renovamos barato no cache-miss. Fallbacks (igm media_url, url do CDN) são
   perecíveis com oe= e usam o parse de expiry compartilhado.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from app.services.graph_api import GraphAPI
from app.services import supabase_repo
from app.services.video_source_cache import (
    EXPORT_MIN_TTL_S,
    FALLBACK_TTL_S,
    _is_transient_error_status,
    _parse_iso,
    parse_meta_url_expiry,
)

logger = logging.getLogger(__name__)

# permalink_url re-assina o CDN a cada acesso; 30 dias é margem confortável e o
# cache-miss renova com 1 chamada por conta.
IMAGE_PERMALINK_TTL_S = 30 * 24 * 3600

# Lote de hashes por chamada ao /adimages (limite prático de tamanho de URL)
_ADIMAGES_HASH_BATCH = 50


def extract_image_hashes(creative: Dict[str, Any]) -> List[str]:
    """Hashes candidatos do creative, na mesma ordem de prioridade do
    GraphAPI.get_image_source_url (asset_feed → link_data → photo_data → creative)."""
    creative = creative or {}
    hashes: List[str] = []
    seen = set()

    def _add(h: Any) -> None:
        if h and isinstance(h, str) and h not in seen:
            seen.add(h)
            hashes.append(h)

    for img in ((creative.get("asset_feed_spec") or {}).get("images") or []):
        if isinstance(img, dict):
            _add(img.get("hash"))
    oss = creative.get("object_story_spec") or {}
    _add((oss.get("link_data") or {}).get("image_hash"))
    _add((oss.get("photo_data") or {}).get("image_hash"))
    _add(creative.get("image_hash"))
    return hashes


def resolve_image_sources_batch(
    api: GraphAPI,
    *,
    user_jwt: str,
    user_id: str,
    representatives: Dict[str, Dict[str, Any]],
    min_ttl_seconds: int = EXPORT_MIN_TTL_S,
) -> Dict[str, Dict[str, Any]]:
    """Resolve URLs de imagem para {ad_name: rep} em lote.

    Cada rep: {"ad_id", "account_id", "hashes": [...], "ig_media_id",
    "cached_url", "cached_expires_at"}.

    Retorna {ad_name: {"url", "expires_at" (datetime), "from_cache"} | {"error", "transient"}}.
    """
    now = datetime.now(timezone.utc)
    results: Dict[str, Dict[str, Any]] = {}

    # 1) Cache-first
    pending: Dict[str, Dict[str, Any]] = {}
    for name, rep in representatives.items():
        cached_url = rep.get("cached_url")
        cached_expiry = _parse_iso(rep.get("cached_expires_at"))
        if cached_url and cached_expiry and (cached_expiry - now).total_seconds() > min_ttl_seconds:
            results[name] = {"url": cached_url, "expires_at": cached_expiry, "from_cache": True}
        else:
            pending[name] = rep

    if not pending:
        return results

    # 2) Uma chamada (em lotes de hashes) por CONTA cobre todos os pendentes com hash
    hashes_by_account: Dict[str, List[str]] = {}
    for rep in pending.values():
        act = str(rep.get("account_id") or "").strip()
        if not act:
            continue
        bucket = hashes_by_account.setdefault(act, [])
        for h in rep.get("hashes") or []:
            if h not in bucket:
                bucket.append(h)

    image_by_hash: Dict[str, Dict[str, Any]] = {}
    account_errors: Dict[str, Dict[str, Any]] = {}
    for act, hashes in hashes_by_account.items():
        for i in range(0, len(hashes), _ADIMAGES_HASH_BATCH):
            chunk = hashes[i : i + _ADIMAGES_HASH_BATCH]
            res = api.get_ad_images_by_hashes(act, chunk)
            if "images" in res:
                image_by_hash.update(res["images"])
            else:
                account_errors[act] = {
                    "error": str(res.get("message") or "Falha ao consultar imagens da conta"),
                    "transient": _is_transient_error_status(str(res.get("status") or "")),
                }
                break  # demais lotes da mesma conta falhariam igual

    # 3) Montar resultado por nome; igm como fallback pontual (raro, ~4% dos ads)
    write_back_groups: Dict[str, Dict[str, Any]] = {}  # url -> {"expires_at", "names": []}
    for name, rep in pending.items():
        act = str(rep.get("account_id") or "").strip()
        url: Optional[str] = None
        for h in rep.get("hashes") or []:
            item = image_by_hash.get(h)
            if item:
                url = item.get("permalink_url") or item.get("url")
                if url:
                    break

        if not url:
            ig_media_id = str(rep.get("ig_media_id") or "").strip()
            if ig_media_id:
                try:
                    url = api._fetch_igm_media_url(ig_media_id)
                except Exception as e:
                    logger.warning(f"[IMAGE_SOURCE_CACHE] igm fallback falhou para {name!r}: {e}")

        if not url:
            if act in account_errors:
                results[name] = dict(account_errors[act])
            elif rep.get("hashes") or rep.get("ig_media_id"):
                results[name] = {"error": "Imagem não encontrada na Meta", "transient": False}
            else:
                results[name] = {"error": "Anúncio sem imagem identificável", "transient": False}
            continue

        # permalink não tem oe= — é o caso permanente; CDN/igm têm oe= real
        expires_at = parse_meta_url_expiry(url)
        if expires_at is None:
            ttl = IMAGE_PERMALINK_TTL_S if "facebook.com/ads/image" in url else FALLBACK_TTL_S
            expires_at = now + timedelta(seconds=ttl)
        results[name] = {"url": url, "expires_at": expires_at, "from_cache": False}
        group = write_back_groups.setdefault(url, {"expires_at": expires_at, "names": []})
        group["names"].append(name)

    # 4) Write-back best-effort, uma escrita por URL distinta (grupo de nomes)
    if user_id:
        for url, group in write_back_groups.items():
            supabase_repo.update_ads_image_source(
                user_jwt=user_jwt,
                user_id=user_id,
                ad_names=group["names"],
                url=url,
                expires_at_iso=group["expires_at"].isoformat(),
            )

    return results
