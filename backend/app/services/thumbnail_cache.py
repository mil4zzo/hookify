from __future__ import annotations

import hashlib
import io
import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Dict, Iterable, List, Optional, Tuple
from urllib.parse import urlparse, quote
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests
from PIL import Image

from app.core.config import SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY


logger = logging.getLogger(__name__)


DEFAULT_BUCKET = "ad-thumbs"
DEFAULT_TIMEOUT_SECONDS = 10
DEFAULT_MAX_BYTES = 4_000_000  # 4MB: mais que suficiente para thumbnail
DEFAULT_MAX_WORKERS = 8
DEFAULT_WEBP_QUALITY = 82  # Qualidade WebP (0-100): 82 é bom balanço qualidade/tamanho
DEFAULT_MAX_WIDTH = 640  # Largura máxima em pixels (mantém aspect ratio)
PROFILE_PIC_MAX_WIDTH = 256  # Largura máxima para avatar de perfil (Facebook)


@dataclass(frozen=True)
class CachedThumb:
    storage_path: str
    public_url: str
    cached_at: str  # ISO Z
    source_url: str


def _now_iso() -> str:
    return datetime.utcnow().isoformat(timespec="seconds") + "Z"


def _is_http_url(u: str) -> bool:
    try:
        p = urlparse(u)
        return p.scheme in ("http", "https") and bool(p.netloc)
    except Exception:
        return False


def _sha256_hex(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def _quote_path(path: str) -> str:
    # Preserva separadores "/" e escapa cada segmento individualmente
    return "/".join(quote(seg, safe="") for seg in (path or "").split("/"))


def build_public_storage_url(bucket: str, storage_path: str) -> Optional[str]:
    if not SUPABASE_URL:
        return None
    b = (bucket or "").strip()
    p = (storage_path or "").strip()
    if not b or not p:
        return None
    base = SUPABASE_URL.rstrip("/")
    return f"{base}/storage/v1/object/public/{b}/{_quote_path(p)}"


def _detect_ext_and_content_type(header_content_type: Optional[str], first_bytes: bytes) -> Tuple[str, str]:
    ct = (header_content_type or "").split(";")[0].strip().lower()

    # Heurística simples por content-type
    if ct in ("image/jpeg", "image/jpg"):
        return ".jpg", "image/jpeg"
    if ct == "image/png":
        return ".png", "image/png"
    if ct == "image/webp":
        return ".webp", "image/webp"
    if ct == "image/gif":
        return ".gif", "image/gif"

    # Fallback por assinatura (magic numbers)
    if first_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png", "image/png"
    if first_bytes[:3] == b"\xff\xd8\xff":
        return ".jpg", "image/jpeg"
    if first_bytes[:4] == b"RIFF" and first_bytes[8:12] == b"WEBP":
        return ".webp", "image/webp"
    if first_bytes[:6] in (b"GIF87a", b"GIF89a"):
        return ".gif", "image/gif"

    # Último fallback (serve na maioria dos casos)
    return ".jpg", "image/jpeg"


def _download_image_bytes(url: str, timeout_seconds: int, max_bytes: int) -> Tuple[bytes, str]:
    headers = {
        "User-Agent": "Hookify/1.0 (+thumbnail-cache)",
        "Accept": "image/*,*/*;q=0.8",
    }
    resp = requests.get(url, stream=True, timeout=timeout_seconds, allow_redirects=True, headers=headers)
    resp.raise_for_status()

    content_type = (resp.headers.get("Content-Type") or "").strip()

    buf = bytearray()
    for chunk in resp.iter_content(chunk_size=64 * 1024):
        if not chunk:
            continue
        buf.extend(chunk)
        if len(buf) > max_bytes:
            raise ValueError(f"thumbnail too large (>{max_bytes} bytes)")

    data = bytes(buf)
    if not data:
        raise ValueError("empty thumbnail content")

    # Content-Type pode vir vazio/errado; vamos revalidar depois pelo magic
    ext, normalized_ct = _detect_ext_and_content_type(content_type, data[:32])
    return data, normalized_ct


def _convert_to_webp(
    image_bytes: bytes,
    max_width: int = DEFAULT_MAX_WIDTH,
    quality: int = DEFAULT_WEBP_QUALITY,
) -> bytes:
    """Converte imagem para WebP com redimensionamento e compressão.
    
    Args:
        image_bytes: Bytes da imagem original (qualquer formato suportado pelo Pillow)
        max_width: Largura máxima em pixels (mantém aspect ratio)
        quality: Qualidade WebP (0-100, maior = melhor qualidade mas arquivo maior)
    
    Returns:
        Bytes da imagem convertida em WebP
    """
    try:
        img = Image.open(io.BytesIO(image_bytes))
        
        # Converter RGBA para RGB se necessário (WebP suporta RGBA, mas RGB é menor)
        if img.mode in ("RGBA", "LA", "P"):
            # Criar fundo branco para imagens com transparência
            background = Image.new("RGB", img.size, (255, 255, 255))
            if img.mode == "P":
                img = img.convert("RGBA")
            if img.mode in ("RGBA", "LA"):
                background.paste(img, mask=img.split()[-1] if img.mode == "RGBA" else None)
            img = background
        elif img.mode != "RGB":
            img = img.convert("RGB")
        
        # Redimensionar se necessário (mantém aspect ratio)
        if img.width > max_width:
            ratio = max_width / img.width
            new_height = int(img.height * ratio)
            img = img.resize((max_width, new_height), Image.Resampling.LANCZOS)
        
        # Converter para WebP
        output = io.BytesIO()
        img.save(output, format="WEBP", quality=quality, method=6)  # method=6 = melhor compressão
        return output.getvalue()
    except Exception as e:
        logger.warning(f"[THUMB_CACHE] Erro ao converter para WebP: {e}, usando imagem original")
        # Fallback: retornar original se conversão falhar
        return image_bytes


def _upload_to_supabase_storage(bucket: str, storage_path: str, content: bytes, content_type: str, timeout_seconds: int) -> None:
    """Upload para Supabase Storage usando REST API direto (mais confiável que biblioteca).
    
    Usa requests diretamente para ter controle total e evitar bugs internos da biblioteca supabase-py.
    """
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise RuntimeError("Supabase Storage not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)")

    base = SUPABASE_URL.rstrip("/")
    # Path encoding: cada segmento é codificado individualmente, preservando "/"
    encoded_path = "/".join(quote(seg, safe="") for seg in storage_path.split("/"))
    url = f"{base}/storage/v1/object/{bucket}/{encoded_path}"

    headers = {
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Content-Type": content_type,
        "x-upsert": "true",  # Permite re-upload (idempotência)
    }

    try:
        resp = requests.put(url, data=content, headers=headers, timeout=timeout_seconds)
        resp.raise_for_status()
        
        # Log de sucesso (apenas para debug, pode ser removido em produção)
        logger.debug(f"[THUMB_CACHE] Upload bem-sucedido: {storage_path} ({len(content)} bytes)")
        
    except requests.exceptions.HTTPError as e:
        # Log detalhado de erro HTTP
        error_body = ""
        try:
            error_body = e.response.text[:500] if e.response else "No response"
        except Exception:
            pass
        
        logger.error(f"[THUMB_CACHE] HTTP error ao fazer upload: {e.response.status_code if e.response else 'N/A'}")
        logger.error(f"[THUMB_CACHE] URL: {url}")
        logger.error(f"[THUMB_CACHE] Bucket: {bucket}, Path: {storage_path}, Content-Type: {content_type}, Size: {len(content)} bytes")
        logger.error(f"[THUMB_CACHE] Error body: {error_body}")
        raise RuntimeError(f"Supabase Storage upload HTTP error: {e.response.status_code if e.response else 'Unknown'}") from e
        
    except requests.exceptions.Timeout:
        logger.error(f"[THUMB_CACHE] Timeout ao fazer upload: {storage_path}")
        raise RuntimeError(f"Supabase Storage upload timeout após {timeout_seconds}s") from None
        
    except Exception as e:
        logger.error(f"[THUMB_CACHE] Erro ao fazer upload no Storage: {e}")
        logger.error(f"[THUMB_CACHE] Bucket: {bucket}, Path: {storage_path}, Content-Type: {content_type}, Size: {len(content)} bytes")
        logger.error(f"[THUMB_CACHE] Exception type: {type(e).__name__}")
        raise


def cache_first_thumb_for_ad(
    *,
    user_id: str,
    ad_id: str,
    thumb_url: str,
    bucket: str = DEFAULT_BUCKET,
    timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
    max_bytes: int = DEFAULT_MAX_BYTES,
) -> Optional[CachedThumb]:
    """Baixa e cacheia um thumbnail no Supabase Storage (bucket público).

    Retorna metadados para persistir no DB (ads.thumb_storage_path/cached_at/source_url).
    """
    user_id = str(user_id or "").strip()
    ad_id = str(ad_id or "").strip()
    thumb_url = str(thumb_url or "").strip()

    if not user_id or not ad_id or not thumb_url:
        return None
    if not _is_http_url(thumb_url):
        return None

    try:
        # Baixar imagem original
        content, content_type = _download_image_bytes(thumb_url, timeout_seconds=timeout_seconds, max_bytes=max_bytes)
        
        # Converter para WebP (com redimensionamento e compressão)
        webp_content = _convert_to_webp(content, max_width=DEFAULT_MAX_WIDTH, quality=DEFAULT_WEBP_QUALITY)
        
        # Sempre usar extensão .webp e content-type image/webp
        digest16 = _sha256_hex(thumb_url)[:16]
        storage_path = f"thumbs/{user_id}/{ad_id}/{digest16}.webp"
        webp_content_type = "image/webp"

        _upload_to_supabase_storage(bucket, storage_path, webp_content, webp_content_type, timeout_seconds=timeout_seconds)

        public_url = build_public_storage_url(bucket, storage_path) or ""
        cached_at = _now_iso()
        return CachedThumb(storage_path=storage_path, public_url=public_url, cached_at=cached_at, source_url=thumb_url)
    except Exception as e:
        logger.info(f"[THUMB_CACHE] Falha ao cachear thumb ad_id={ad_id}: {e}")
        return None


def cache_first_thumbs_for_ads(
    *,
    user_id: str,
    ad_id_to_thumb_url: Dict[str, str],
    bucket: str = DEFAULT_BUCKET,
    max_workers: int = DEFAULT_MAX_WORKERS,
    timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
    max_bytes: int = DEFAULT_MAX_BYTES,
) -> Dict[str, CachedThumb]:
    """Cacheia thumbnails em paralelo (best-effort). Retorna apenas os sucessos."""
    if not ad_id_to_thumb_url:
        return {}

    results: Dict[str, CachedThumb] = {}
    items = [(str(ad_id), str(u)) for ad_id, u in ad_id_to_thumb_url.items() if ad_id and u]
    if not items:
        return {}

    workers = max(1, min(int(max_workers or 1), 16))
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {
            ex.submit(
                cache_first_thumb_for_ad,
                user_id=user_id,
                ad_id=ad_id,
                thumb_url=thumb_url,
                bucket=bucket,
                timeout_seconds=timeout_seconds,
                max_bytes=max_bytes,
            ): ad_id
            for ad_id, thumb_url in items
        }
        for fut in as_completed(futs):
            ad_id = futs.get(fut) or ""
            try:
                r = fut.result()
                if r and r.storage_path:
                    results[ad_id] = r
            except Exception:
                # cache_first_thumb_for_ad já faz best-effort, mas manter robustez
                continue

    return results


def cache_profile_picture(
    *,
    user_id: str,
    facebook_user_id: str,
    picture_url: str,
    bucket: str = DEFAULT_BUCKET,
    timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
    max_bytes: int = DEFAULT_MAX_BYTES,
) -> Optional[CachedThumb]:
    """Baixa e cacheia a foto de perfil do Facebook no Supabase Storage (bucket público).

    Path: profile-pics/{user_id}/{facebook_user_id}.webp.
    Retorna metadados para persistir no DB (facebook_connections.picture_storage_path/cached_at/source_url).
    """
    user_id = str(user_id or "").strip()
    facebook_user_id = str(facebook_user_id or "").strip()
    picture_url = str(picture_url or "").strip()

    if not user_id or not facebook_user_id or not picture_url:
        return None
    if not _is_http_url(picture_url):
        return None

    try:
        content, _ = _download_image_bytes(
            picture_url, timeout_seconds=timeout_seconds, max_bytes=max_bytes
        )
        webp_content = _convert_to_webp(
            content, max_width=PROFILE_PIC_MAX_WIDTH, quality=DEFAULT_WEBP_QUALITY
        )
        storage_path = f"profile-pics/{user_id}/{facebook_user_id}.webp"
        webp_content_type = "image/webp"

        _upload_to_supabase_storage(
            bucket, storage_path, webp_content, webp_content_type, timeout_seconds=timeout_seconds
        )

        public_url = build_public_storage_url(bucket, storage_path) or ""
        cached_at = _now_iso()
        return CachedThumb(
            storage_path=storage_path,
            public_url=public_url,
            cached_at=cached_at,
            source_url=picture_url,
        )
    except Exception as e:
        logger.info(
            f"[THUMB_CACHE] Falha ao cachear profile picture user_id={user_id[:8]}... fb={facebook_user_id[:8]}...: {e}"
        )
        return None


