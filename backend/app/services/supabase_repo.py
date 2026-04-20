from __future__ import annotations

import logging
import time
import random
from typing import Any, Callable, Dict, List, Optional, Tuple, TYPE_CHECKING
from datetime import datetime, timedelta, date, timezone

from app.core.supabase_client import get_supabase_for_user, get_supabase_service
from app.core.supabase_retry import with_postgrest_retry
from app.services.ad_media import resolve_media_type, resolve_primary_video_id
from app.services.thumbnail_cache import CachedThumb, DEFAULT_BUCKET, build_public_storage_url, normalize_ad_name

try:
    import httpx
except Exception:  # pragma: no cover - dependência opcional em runtime
    httpx = None  # type: ignore

try:
    import httpcore
except Exception:  # pragma: no cover - dependência opcional em runtime
    httpcore = None  # type: ignore

if TYPE_CHECKING:
    from supabase import Client

logger = logging.getLogger(__name__)


def _attach_storage_thumbnail(ad: Dict[str, Any]) -> Dict[str, Any]:
    """Return a copy with a renderable Storage thumbnail URL, if cached."""
    row = dict(ad or {})
    storage_path = str(row.get("thumb_storage_path") or "").strip()
    row["thumbnail"] = build_public_storage_url(DEFAULT_BUCKET, storage_path) if storage_path else None
    return row


def _get_sb(user_jwt: Optional[str] = None, sb_client: Optional["Client"] = None) -> "Client":
    """Retorna cliente Supabase: sb_client se fornecido, senão get_supabase_for_user(user_jwt)."""
    if sb_client is not None:
        return sb_client
    if user_jwt:
        return get_supabase_for_user(user_jwt)
    raise ValueError("Either user_jwt or sb_client is required")


class PackNameConflictError(ValueError):
    """Raised when a pack name already exists for the user."""


def normalize_pack_name(name: str) -> str:
    """Normaliza nome do pack para persistência e validação."""
    return str(name or "").strip()


def _normalized_pack_name_key(name: str) -> str:
    """Chave normalizada para unicidade case-insensitive."""
    return normalize_pack_name(name).lower()


def _is_pack_name_unique_violation(error: Exception) -> bool:
    """Detecta violação da constraint/índice único de nome de pack."""
    error_text = str(error or "").lower()
    return (
        "packs_user_normalized_name_unique_idx" in error_text
        or "duplicate key value violates unique constraint" in error_text
    )


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _hook_at_3_from_curve(curve: Any) -> float:
    """Calcula hook (retenção aos 3 segundos) a partir da curva de retenção.
    
    Args:
        curve: Array de valores de retenção (pode estar em percentual 0-100 ou decimal 0-1)
    
    Returns:
        Hook como decimal (0-1)
    """
    try:
        if not isinstance(curve, list) or not curve:
            return 0.0
        v = float(curve[min(3, len(curve) - 1)] or 0)
        return v / 100.0 if v > 1 else v
    except Exception:
        return 0.0


def _safe_div(a: float, b: float) -> float:
    """Divisão segura que retorna 0 se divisor for 0."""
    return (a / b) if b else 0.0


def _fetch_all_paginated(sb, table_name: str, select_fields: str, filters_func, max_per_page: int = 1000) -> List[Dict[str, Any]]:
    """Busca todos os registros de uma tabela usando paginação para contornar limite de 1000 linhas do Supabase.
    
    Args:
        sb: Cliente Supabase
        table_name: Nome da tabela
        select_fields: Campos a selecionar (ex: "id, pack_ids")
        filters_func: Função que recebe um query builder e retorna o query com filtros aplicados
        max_per_page: Máximo de registros por página (padrão 1000, limite do Supabase)
    
    Returns:
        Lista com todos os registros encontrados
    """
    all_rows = []
    page_size = max_per_page
    offset = 0
    
    while True:
        q = sb.table(table_name).select(select_fields)
        q = filters_func(q)
        q = q.range(offset, offset + page_size - 1)
        
        result = q.execute()
        page_data = result.data or []
        
        if not page_data:
            break
        
        all_rows.extend(page_data)
        
        # Se retornou menos que page_size, chegamos ao fim
        if len(page_data) < page_size:
            break
        
        offset += page_size
    
    return all_rows


def _process_pack_deletion_in_batches(
    sb, 
    table_name: str, 
    id_field: str,  # "id" para ad_metrics, "ad_id" para ads
    filters_func, 
    pack_id: str, 
    user_id: str,
    batch_size: int = 500
) -> Tuple[List[str], List[str], List[str]]:
    """Processa registros durante a busca em lotes, separando IDs para atualizar vs deletar.

    Otimiza uso de memória ao processar durante a busca em vez de carregar tudo primeiro.

    Args:
        sb: Cliente Supabase
        table_name: Nome da tabela ("ad_metrics" ou "ads")
        id_field: Nome do campo ID ("id" ou "ad_id")
        filters_func: Função que recebe query builder e retorna query com filtros
        pack_id: ID do pack a ser removido
        user_id: ID do usuário
        batch_size: Tamanho do lote para batch updates

    Returns:
        Tuple[List[str], List[str], List[str]]: (ids_updated, ids_to_delete, ids_failed)
    """
    to_update_ids: List[str] = []
    to_delete_ids: List[str] = []
    failed_ids: List[str] = []
    current_batch_ids: List[str] = []
    offset = 0
    page_size = 1000
    total_processed = 0
    
    while True:
        # Buscar página
        q = sb.table(table_name).select(f"{id_field}, pack_ids")
        q = filters_func(q)
        q = q.range(offset, offset + page_size - 1)
        
        result = q.execute()
        page_data = result.data or []
        
        if not page_data:
            break
        
        # Processar página atual
        for row in page_data:
            packs_arr = row.get("pack_ids") or []
            row_id = str(row.get(id_field))
            
            if pack_id in packs_arr:
                if len(packs_arr) > 1:
                    # Usado por outros packs - adicionar ao batch de atualização
                    current_batch_ids.append(row_id)
                    
                    # Se batch cheio, processar via RPC
                    if len(current_batch_ids) >= batch_size:
                        try:
                            rpc_result = sb.rpc(
                                "batch_remove_pack_id_from_arrays",
                                {
                                    "p_user_id": user_id,
                                    "p_pack_id": pack_id,
                                    "p_table_name": table_name,
                                    "p_ids_to_update": current_batch_ids
                                }
                            ).execute()
                            
                            if rpc_result.data and rpc_result.data.get("status") == "success":
                                to_update_ids.extend(current_batch_ids)
                            else:
                                logger.warning(f"Erro no batch update durante streaming: {rpc_result.data}")
                                failed_ids.extend(current_batch_ids)
                        except Exception as batch_err:
                            logger.warning(f"Erro ao fazer batch update durante streaming: {batch_err}")
                            failed_ids.extend(current_batch_ids)
                        
                        current_batch_ids = []
                else:
                    # Único pack - marcar para deleção
                    to_delete_ids.append(row_id)
        
        total_processed += len(page_data)
        
        # Se retornou menos que page_size, chegamos ao fim
        if len(page_data) < page_size:
            break
        
        offset += page_size
    
    # Processar batch restante
    if current_batch_ids:
        try:
            rpc_result = sb.rpc(
                "batch_remove_pack_id_from_arrays",
                {
                    "p_user_id": user_id,
                    "p_pack_id": pack_id,
                    "p_table_name": table_name,
                    "p_ids_to_update": current_batch_ids
                }
            ).execute()
            
            if rpc_result.data and rpc_result.data.get("status") == "success":
                to_update_ids.extend(current_batch_ids)
            else:
                logger.warning(f"Erro no batch update final: {rpc_result.data}")
                failed_ids.extend(current_batch_ids)
        except Exception as batch_err:
            logger.warning(f"Erro ao fazer batch update final: {batch_err}")
            failed_ids.extend(current_batch_ids)

    if failed_ids:
        logger.error(
            f"[PACK_DELETION] {len(failed_ids)} registros de {table_name} falharam no batch_remove_pack_id "
            f"para pack {pack_id}. IDs afetados precisam de cleanup manual."
        )
    logger.info(
        f"Processados {total_processed} registros de {table_name} (streaming): "
        f"{len(to_update_ids)} atualizados, {len(to_delete_ids)} para deletar, {len(failed_ids)} falharam"
    )

    return (to_update_ids, to_delete_ids, failed_ids)


def _get_pack_thumb_storage_paths(
    sb,
    user_id: str,
    pack_id: str,
) -> List[str]:
    """Retorna thumb_storage_path dos ads que pertencem ao pack (antes da deleção)."""
    try:
        def ads_filters(q):
            return q.eq("user_id", user_id).filter("pack_ids", "cs", f"{{{pack_id}}}")

        rows = _fetch_all_paginated(sb, "ads", "thumb_storage_path", ads_filters)
    except Exception as e:
        logger.warning(f"[PACK_DELETION] Falha ao coletar thumb_storage_path do pack {pack_id}: {e}")
        return []

    prefix = f"thumbs/{user_id}/"
    paths = {
        str(r.get("thumb_storage_path") or "").strip()
        for r in rows
        if str(r.get("thumb_storage_path") or "").strip()
    }
    # Segurança: remover apenas paths de thumbs de ads do usuário
    filtered = sorted([p for p in paths if p.startswith(prefix)])
    logger.info(
        f"[PACK_DELETION] Thumb paths candidatos coletados para pack {pack_id}: {len(filtered)}"
    )
    return filtered


def _delete_unreferenced_thumb_paths(
    sb,
    user_id: str,
    candidate_paths: List[str],
    *,
    storage_batch_size: int = 200,
    lookup_batch_size: int = 200,
) -> int:
    """Remove do Storage somente paths sem referência restante em ads do usuário."""
    if not candidate_paths:
        logger.info("[PACK_DELETION] Nenhum thumb path candidato para cleanup no storage")
        return 0

    unique_paths = sorted({str(p).strip() for p in candidate_paths if str(p).strip()})
    if not unique_paths:
        logger.info("[PACK_DELETION] Thumb paths candidatos vazios após normalização")
        return 0

    still_referenced: set[str] = set()
    logger.info(
        f"[PACK_DELETION] Iniciando verificação de referências de thumbs: candidates={len(unique_paths)}"
    )

    for i in range(0, len(unique_paths), lookup_batch_size):
        batch = unique_paths[i:i + lookup_batch_size]
        try:
            def ads_filters(q):
                return q.eq("user_id", user_id).in_("thumb_storage_path", batch)

            rows = _fetch_all_paginated(sb, "ads", "thumb_storage_path", ads_filters)
            for row in rows:
                p = str(row.get("thumb_storage_path") or "").strip()
                if p:
                    still_referenced.add(p)
        except Exception as e:
            logger.warning(f"[PACK_DELETION] Falha ao verificar referências de thumbs: {e}")
            # Em caso de erro de verificação, manter segurança (não deletar)
            return 0

    to_delete = [p for p in unique_paths if p not in still_referenced]
    logger.info(
        f"[PACK_DELETION] Resultado verificação de thumbs: referenced={len(still_referenced)}, "
        f"orphans={len(to_delete)}"
    )
    if not to_delete:
        return 0

    sb_service = get_supabase_service()
    deleted_count = 0

    for i in range(0, len(to_delete), storage_batch_size):
        batch = to_delete[i:i + storage_batch_size]
        try:
            sb_service.storage.from_("ad-thumbs").remove(batch)
            deleted_count += len(batch)
        except Exception as e:
            logger.warning(
                f"[PACK_DELETION] Falha ao remover lote de thumbs do storage "
                f"(pack cleanup): {e}"
            )

    logger.info(
        f"[PACK_DELETION] Cleanup de thumbs no storage concluído: deleted={deleted_count}, "
        f"attempted={len(to_delete)}"
    )
    return deleted_count


def upsert_ads(
    user_jwt: str,
    formatted_ads: List[Dict[str, Any]],
    user_id: Optional[str],
    pack_id: Optional[str] = None,
    on_batch_progress: Optional[Callable[[int, int], None]] = None,
    *,
    sb_client: Optional["Client"] = None,
) -> None:
    """Upsert de identidade + creative dos anúncios na tabela ads.

    - Requer: ad_id
    - Campos achatados para consultas: account_id, campaign_id/name, adset_id/name, ad_name, effective_status, creative_video_id, thumbnail_url, instagram_permalink_url
    - Campos de fallback: adcreatives_videos_ids, adcreatives_videos_thumbs (arrays JSONB)
    - Campo rico: creative (jsonb)
    - NOTA: Deduplica por ad_id (mantém apenas um registro por anúncio, independente da data)
    """
    if not user_id:
        logger.warning("Supabase upsert_ads skipped: missing user_id")
        return
    if not formatted_ads:
        return

    # Deduplicar por ad_id (manter apenas um registro por anúncio)
    # Se houver duplicatas, mantém a última ocorrência (mais recente)
    rows_dict: Dict[str, Dict[str, Any]] = {}
    
    for ad in formatted_ads:
        ad_id = str(ad.get("ad_id") or "").strip()
        if not ad_id:
            continue

        creative = ad.get("creative") or {}
        
        # Extrair arrays de fallback (normalizar para lista de strings)
        adcreatives_videos_ids = ad.get("adcreatives_videos_ids") or []
        adcreatives_videos_thumbs = ad.get("adcreatives_videos_thumbs") or []
        
        # Garantir que são listas de strings (filtrar None/empty)
        videos_ids_list = [str(v) for v in adcreatives_videos_ids if v]
        videos_thumbs_list = [str(v) for v in adcreatives_videos_thumbs if v]
        
        media_probe = {
            **ad,
            "creative": creative,
            "adcreatives_videos_ids": videos_ids_list,
            "adcreatives_videos_thumbs": videos_thumbs_list,
            "creative_video_id": creative.get("video_id"),
            "thumbnail_url": creative.get("thumbnail_url"),
        }
        primary_video_id = resolve_primary_video_id(media_probe)
        media_type = resolve_media_type(media_probe, primary_video_id)

        row = {
            "ad_id": ad_id,
            "user_id": user_id,
            "account_id": ad.get("account_id"),
            "campaign_id": ad.get("campaign_id"),
            "campaign_name": ad.get("campaign_name"),
            "adset_id": ad.get("adset_id"),
            "adset_name": ad.get("adset_name"),
            "ad_name": ad.get("ad_name"),
            "effective_status": ad.get("effective_status"),
            "creative": creative,
            "creative_video_id": creative.get("video_id"),
            "primary_video_id": primary_video_id,
            "media_type": media_type,
            "thumbnail_url": creative.get("thumbnail_url"),
            "instagram_permalink_url": creative.get("instagram_permalink_url"),
            # Adicionar campos de fallback
            "adcreatives_videos_ids": videos_ids_list if videos_ids_list else None,
            "adcreatives_videos_thumbs": videos_thumbs_list if videos_thumbs_list else None,
            "updated_at": _now_iso(),
        }
        # Mantém apenas uma ocorrência por ad_id (sobrescreve se houver duplicata)
        rows_dict[ad_id] = row

    if not rows_dict:
        return

    rows = list(rows_dict.values())
    
    # Log para debug se houver deduplicação
    if len(formatted_ads) > len(rows):
        logger.info(f"[UPSERT_ADS] Deduplicados {len(formatted_ads) - len(rows)} registros duplicados de ads. Total único: {len(rows)}")

    sb = _get_sb(user_jwt, sb_client)
    
    total_rows = len(rows)
    logger.info(f"[UPSERT_ADS] Processando {total_rows} registros de ads")

    # Cache de thumbnails movido para background (run_pack_background_tasks).
    # Frontend usa fallback: thumbnail_url / adcreatives_videos_thumbs via thumbnailFallback.ts

    # Upsert em lotes para evitar timeout em grandes volumes de dados
    # Tamanho de lote: 200 registros (reduzido de 1000 para evitar ReadTimeout do httpx)
    # Alinhado à estratégia de ad_metrics; JSONB (creative, etc.) e concorrência exigem lotes menores
    batch_size = 200
    total_batches = (total_rows + batch_size - 1) // batch_size
    
    for batch_idx in range(0, total_rows, batch_size):
        batch = rows[batch_idx:batch_idx + batch_size]
        batch_num = (batch_idx // batch_size) + 1
        
        try:
            sb.table("ads").upsert(batch, on_conflict="ad_id,user_id").execute()
            logger.info(f"[UPSERT_ADS] Lote {batch_num}/{total_batches} processado com sucesso ({len(batch)} registros)")
            # Chamar callback ANTES do delay para feedback imediato
            if on_batch_progress:
                try:
                    on_batch_progress(batch_num, total_batches)
                except Exception:
                    # Callback é best-effort e não deve quebrar persistência
                    pass
            # Pequeno delay entre batches para não sobrecarregar Supabase e dar tempo de processar updates
            if batch_num < total_batches:  # Não delay no último batch
                time.sleep(0.1)
        except Exception as e:
            # Se a migration ainda não foi aplicada no ambiente, reprocessar removendo colunas novas
            msg = str(e or "")
            if (
                "thumb_storage_path" in msg
                or "thumb_cached_at" in msg
                or "thumb_source_url" in msg
                or "primary_video_id" in msg
                or "media_type" in msg
            ):
                logger.warning(
                    f"[UPSERT_ADS] Colunas novas parecem ausentes no DB; "
                    f"reprocessando lote {batch_num}/{total_batches} sem thumb_*/media normalizada"
                )
                cleaned = []
                for r in batch:
                    rr = dict(r)
                    rr.pop("thumb_storage_path", None)
                    rr.pop("thumb_cached_at", None)
                    rr.pop("thumb_source_url", None)
                    rr.pop("primary_video_id", None)
                    rr.pop("media_type", None)
                    cleaned.append(rr)
                sb.table("ads").upsert(cleaned, on_conflict="ad_id,user_id").execute()
                logger.info(f"[UPSERT_ADS] Lote {batch_num}/{total_batches} reprocessado sem thumb_* ({len(cleaned)} registros)")
                if on_batch_progress:
                    try:
                        on_batch_progress(batch_num, total_batches)
                    except Exception:
                        pass
            else:
                logger.error(f"[UPSERT_ADS] Erro ao processar lote {batch_num}/{total_batches}: {e}")
                # Re-lançar para que o caller possa tratar o erro
                raise

    if pack_id and rows:
        ad_ids = [r["ad_id"] for r in rows]
        batch_size_attach = 200
        total_attach_batches = (len(ad_ids) + batch_size_attach - 1) // batch_size_attach
        failed_attach_ids: List[str] = []

        for attach_idx in range(0, len(ad_ids), batch_size_attach):
            batch_ids = ad_ids[attach_idx:attach_idx + batch_size_attach]
            batch_num = (attach_idx // batch_size_attach) + 1
            for attempt in range(3):
                try:
                    sb.rpc(
                        "batch_add_pack_id_to_arrays",
                        {
                            "p_user_id": user_id,
                            "p_pack_id": pack_id,
                            "p_table_name": "ads",
                            "p_ids_to_update": batch_ids,
                        },
                    ).execute()
                    logger.debug(
                        f"[UPSERT_ADS] pack_id anexado ao lote {batch_num}/{total_attach_batches} "
                        f"({len(batch_ids)} registros)"
                    )
                    break
                except Exception as e:
                    if attempt < 2:
                        delay = 0.5 * (attempt + 1)
                        logger.warning(
                            f"[UPSERT_ADS] Tentativa {attempt + 1}/3 para attach pack_id lote {batch_num}: {e}"
                        )
                        time.sleep(delay)
                    else:
                        logger.critical(
                            f"[UPSERT_ADS] Falha definitiva ao anexar pack_id no lote {batch_num}/{total_attach_batches}. "
                            f"pack_id={pack_id}, ad_ids afetados={batch_ids}. Erro: {e}"
                        )
                        failed_attach_ids.extend(batch_ids)

        if failed_attach_ids:
            logger.error(
                f"[UPSERT_ADS] {len(failed_attach_ids)} ads ficaram sem pack_id={pack_id} vinculado. "
                f"Necessario cleanup manual."
            )
            raise RuntimeError(
                f"Falha ao vincular {len(failed_attach_ids)} ads ao pack {pack_id} apos retries"
            )

    logger.info(f"[UPSERT_ADS] ✓ Todos os {total_rows} registros processados com sucesso em {total_batches} lote(s)")

    # Sync transcription_id em ads e ad_ids em ad_transcriptions (best-effort)
    try:
        ad_id_name_pairs = [(str(r.get("ad_id") or ""), str(r.get("ad_name") or "")) for r in rows]
        _sync_ads_transcription_links(user_jwt, user_id, ad_id_name_pairs, sb_client=sb)
    except Exception as e:
        logger.warning(f"[UPSERT_ADS] Erro ao sync transcription links (best-effort): {e}")


def get_cached_thumbs_by_ad_names(
    user_id: str,
    ad_names: List[str],
    *,
    sb_client: Optional["Client"] = None,
) -> Dict[str, CachedThumb]:
    """Resolve thumbs já cacheadas para ad_names informados (por chave normalizada)."""
    if not user_id or not ad_names:
        return {}

    sb = sb_client or get_supabase_service()
    unique_names = sorted({str(n or "").strip() for n in ad_names if str(n or "").strip()})
    target_keys = {normalize_ad_name(n) for n in unique_names if normalize_ad_name(n)}
    if not unique_names or not target_keys:
        return {}

    cached_by_key: Dict[str, CachedThumb] = {}

    def _register_row(row: Dict[str, Any]) -> None:
        ad_name = str(row.get("ad_name") or "").strip()
        thumb_storage_path = str(row.get("thumb_storage_path") or "").strip()
        if not ad_name or not thumb_storage_path:
            return
        thumb_key = normalize_ad_name(ad_name)
        if not thumb_key or thumb_key not in target_keys or thumb_key in cached_by_key:
            return

        thumb_cached_at = str(row.get("thumb_cached_at") or "").strip() or _now_iso()
        thumb_source_url = str(row.get("thumb_source_url") or "").strip()
        cached_by_key[thumb_key] = CachedThumb(
            storage_path=thumb_storage_path,
            public_url="",
            cached_at=thumb_cached_at,
            source_url=thumb_source_url,
        )

    # Passo 1 (rápido): busca direta por nomes exatos.
    batch_size = 200
    for i in range(0, len(unique_names), batch_size):
        batch_names = unique_names[i : i + batch_size]
        try:
            response = (
                sb.table("ads")
                .select("ad_name,thumb_storage_path,thumb_cached_at,thumb_source_url")
                .eq("user_id", user_id)
                .in_("ad_name", batch_names)
                .execute()
            )
        except Exception as e:
            logger.warning(f"[GET_CACHED_THUMBS_BY_AD_NAMES] Erro ao buscar lote de nomes: {e}")
            continue

        for row in response.data or []:
            _register_row(row)

    missing_keys = target_keys - set(cached_by_key.keys())
    if missing_keys:
        # Passo 2 (fallback): varrer ads do usuário para cobrir diferenças de caixa/whitespace.
        page_size = 1000
        offset = 0
        scanned = 0
        max_scan_rows = 20000

        while missing_keys and scanned < max_scan_rows:
            try:
                response = (
                    sb.table("ads")
                    .select("ad_name,thumb_storage_path,thumb_cached_at,thumb_source_url")
                    .eq("user_id", user_id)
                    .range(offset, offset + page_size - 1)
                    .execute()
                )
            except Exception as e:
                logger.warning(f"[GET_CACHED_THUMBS_BY_AD_NAMES] Erro no fallback paginado: {e}")
                break

            rows = response.data or []
            if not rows:
                break

            for row in rows:
                _register_row(row)
            missing_keys = target_keys - set(cached_by_key.keys())

            scanned += len(rows)
            offset += page_size
            if len(rows) < page_size:
                break

    return cached_by_key


def _is_transient_supabase_error(error: Exception) -> bool:
    text = str(error or "")
    transient_markers = (
        "WinError 10035",
        "temporarily unavailable",
        "ReadError",
        "ConnectError",
        "Timeout",
        "connection reset",
    )
    if any(m in text for m in transient_markers):
        return True

    transient_types = []
    if httpx is not None:
        transient_types.extend(
            [
                getattr(httpx, "ReadError", tuple()),
                getattr(httpx, "ConnectError", tuple()),
                getattr(httpx, "TimeoutException", tuple()),
                getattr(httpx, "NetworkError", tuple()),
                getattr(httpx, "RemoteProtocolError", tuple()),
            ]
        )
    if httpcore is not None:
        transient_types.extend(
            [
                getattr(httpcore, "ReadError", tuple()),
                getattr(httpcore, "ConnectError", tuple()),
                getattr(httpcore, "TimeoutException", tuple()),
                getattr(httpcore, "NetworkError", tuple()),
                getattr(httpcore, "ProtocolError", tuple()),
            ]
        )
    transient_types = [t for t in transient_types if isinstance(t, type)]
    return bool(transient_types and isinstance(error, tuple(transient_types)))


def update_ads_thumbnail_cache(
    user_id: str,
    ad_id_to_cached: Dict[str, "CachedThumb"],
) -> Dict[str, int]:
    """Atualiza ads.thumb_* após cache em background (best-effort + retry transitório).

    Returns:
        Dict com métricas de execução:
        {
            "updated": int,         # total de linhas alvo
            "retries": int,         # tentativas extras executadas
            "failed_batches": int,  # batches que falharam definitivamente
        }
    """
    if not ad_id_to_cached:
        return {"updated": 0, "retries": 0, "failed_batches": 0}

    sb = get_supabase_service()
    rows = [
        {
            "ad_id": ad_id,
            "user_id": user_id,
            "thumb_storage_path": c.storage_path,
            "thumb_cached_at": c.cached_at,
            "thumb_source_url": c.source_url,
        }
        for ad_id, c in ad_id_to_cached.items()
    ]

    batch_size = 100
    max_attempts = 4
    retries = 0
    failed_batches = 0
    updated_rows = 0

    for i in range(0, len(rows), batch_size):
        batch = rows[i : i + batch_size]
        success = False
        for attempt in range(1, max_attempts + 1):
            try:
                sb.table("ads").upsert(batch, on_conflict="ad_id,user_id").execute()
                success = True
                updated_rows += len(batch)
                break
            except Exception as e:
                is_transient = _is_transient_supabase_error(e)
                if is_transient and attempt < max_attempts:
                    retries += 1
                    delay = min(2.0, 0.25 * (2 ** (attempt - 1))) + random.uniform(0, 0.2)
                    logger.warning(
                        f"[UPDATE_ADS_THUMB_CACHE] Erro transitório no lote (tentativa {attempt}/{max_attempts}): {e}. "
                        f"Retry em {delay:.2f}s"
                    )
                    time.sleep(delay)
                    continue
                logger.warning(f"[UPDATE_ADS_THUMB_CACHE] Erro no lote: {e}")
                break

        if not success:
            failed_batches += 1

    return {
        "updated": updated_rows,
        "retries": retries,
        "failed_batches": failed_batches,
    }


def update_ad_video_owner(
    user_jwt: str,
    user_id: str,
    ad_id: str,
    video_owner_page_id: str,
) -> None:
    """Persiste o video_owner_page_id resolvido na coluna dedicada da tabela ads."""
    try:
        sb = get_supabase_for_user(user_jwt)
        sb.table("ads").update({"video_owner_page_id": video_owner_page_id}).eq(
            "ad_id", ad_id
        ).eq("user_id", user_id).execute()
        logger.info(f"[UPDATE_AD_VIDEO_OWNER] ad_id={ad_id} → video_owner_page_id={video_owner_page_id}")
    except Exception as e:
        logger.warning(f"[UPDATE_AD_VIDEO_OWNER] Falha (best-effort) para ad_id={ad_id}: {e}")


def upsert_ad_metrics(
    user_jwt: str,
    formatted_ads: List[Dict[str, Any]],
    user_id: Optional[str],
    pack_id: Optional[str] = None,
    on_batch_progress: Optional[Callable[[int, int], None]] = None,
    *,
    sb_client: Optional["Client"] = None,
) -> None:
    """Upsert diário por (ad_id, date) com métricas agregáveis/derivadas e jsonb auxiliares.
    - Requer: ad_id e date (YYYY-MM-DD)
    - Denormaliza ids/nomes para evitar joins em rankings/dashboards
    - ID composto: {date}-{ad_id} para organização cronológica e semântica
    """
    if not user_id:
        logger.warning("Supabase upsert_ad_metrics skipped: missing user_id")
        return
    if not formatted_ads:
        return

    rows = []
    for ad in formatted_ads:
        ad_id = str(ad.get("ad_id") or "").strip()
        day = str(ad.get("date") or "").strip()[:10]
        if not ad_id or not day:
            # métricas diárias exigem date
            continue

        # Gerar ID composto: date primeiro para organização cronológica
        # Formato: YYYY-MM-DD-ad_id (ex: "2024-01-15-123456789")
        metric_id = f"{day}-{ad_id}"

        clicks = int(ad.get("clicks") or 0)
        impressions = int(ad.get("impressions") or 0)
        inline_link_clicks = int(ad.get("inline_link_clicks") or 0)
        reach = int(ad.get("reach") or 0)
        plays = int(ad.get("video_total_plays") or 0)
        thruplays = int(ad.get("video_total_thruplays") or 0)
        watched_p50 = int(ad.get("video_watched_p50") or 0)
        spend = float(ad.get("spend") or 0)
        cpm = float(ad.get("cpm") or 0)
        ctr = float(ad.get("ctr") or 0)
        frequency = float(ad.get("frequency") or 0)
        website_ctr = float(ad.get("website_ctr") or 0)

        actions = ad.get("actions") or []
        conversions = ad.get("conversions") or []
        cost_per_conversion = ad.get("cost_per_conversion") or []
        curve = ad.get("video_play_curve_actions") or []

        # Derivadas úteis (opcional regravar se vierem)
        # connect_rate = landing_page_views / inline_link_clicks
        lpv = 0
        try:
            lpv = next((int(a.get("value") or 0) for a in actions if a.get("action_type") == "landing_page_view"), 0)
        except Exception:
            lpv = 0
        connect_rate = float(ad.get("connect_rate") or (lpv / inline_link_clicks if inline_link_clicks > 0 else 0))

        # page_conv = results / lpv para um actionType escolhido no frontend; como não sabemos aqui, mantemos 0
        page_conv = float(ad.get("page_conv") or 0)

        # Calcular hold_rate = (video_total_thruplays / plays) / hook (retention at 3 seconds)
        # Fórmula: (thruplay_rate) / hook_rate
        # IMPORTANTE: Garantir que ambos estejam na mesma escala (decimal 0-1)
        # - thruplay_rate = thruplays / plays (já é decimal 0-1)
        # - hook vem da curva que pode estar em 0-100, então normalizamos para 0-1
        # Usar video_total_thruplays que já existe no banco (não criar coluna duplicada)
        hook = _hook_at_3_from_curve(curve)  # already normalized to decimal 0-1
        try:
            if isinstance(curve, list) and len(curve) > 0:
                scroll_raw = float(curve[min(1, len(curve) - 1)] or 0)
                scroll_stop_rate = (scroll_raw / 100.0) if scroll_raw > 1 else scroll_raw
            else:
                scroll_stop_rate = 0.0
        except Exception:
            scroll_stop_rate = 0.0
        thruplay_rate = _safe_div(float(thruplays), float(plays)) if plays > 0 else 0.0
        # Ambos estão em decimal (0-1), então a divisão está correta
        # IMPORTANTE: Limitar hold_rate a no máximo 1.0 (100%) devido a arredondamentos da curva de retenção
        # Não faz sentido ter mais pessoas que chegaram ao thruplay do que as que passaram do hook
        hold_rate_raw = _safe_div(thruplay_rate, hook) if hook > 0 else 0.0
        hold_rate = min(hold_rate_raw, 1.0)  # Cap em 100% (1.0)

        row = {
            "id": metric_id,  # ID composto gerado no backend: {date}-{ad_id}
            "user_id": user_id,
            "ad_id": ad_id,
            "account_id": ad.get("account_id"),
            "campaign_id": ad.get("campaign_id"),
            "campaign_name": ad.get("campaign_name"),
            "adset_id": ad.get("adset_id"),
            "adset_name": ad.get("adset_name"),
            "ad_name": ad.get("ad_name"),
            "date": day,
            "clicks": clicks,
            "impressions": impressions,
            "inline_link_clicks": inline_link_clicks,
            "reach": reach,
            "video_total_plays": plays,
            "video_total_thruplays": thruplays,
            "video_watched_p50": watched_p50,
            "spend": spend,
            "cpm": cpm,
            "ctr": ctr,
            "frequency": frequency,
            "website_ctr": website_ctr,
            "actions": actions,
            "conversions": conversions,
            "cost_per_conversion": cost_per_conversion,
            "video_play_curve_actions": curve,
            "hook_rate": hook,
            "scroll_stop_rate": scroll_stop_rate,
            "hold_rate": hold_rate,
            "connect_rate": connect_rate,
            # Denominador explícito para métricas de funil (ex: page_conv = results / lpv)
            # Evita parsing de JSONB (actions) em endpoints de rankings.
            "lpv": lpv,
            "profile_ctr": float(ad.get("profile_ctr") or 0),
            "updated_at": _now_iso(),
        }
        rows.append(row)

    if not rows:
        return

    sb = _get_sb(user_jwt, sb_client)
    
    total_rows = len(rows)
    logger.info(f"[UPSERT_AD_METRICS] Processando {total_rows} registros de métricas")

    # Upsert em lotes para evitar timeout em grandes volumes de dados
    # Tamanho de lote: 150 registros (reduzido de 300 para evitar statement timeout em produção)
    # JSONB fields (actions, conversions, etc.) podem ser grandes, e com múltiplos usuários
    # simultâneos, lotes menores reduzem contenção e evitam timeout do Supabase (~8s)
    batch_size = 150
    total_batches = (total_rows + batch_size - 1) // batch_size
    
    for batch_idx in range(0, total_rows, batch_size):
        batch = rows[batch_idx:batch_idx + batch_size]
        batch_num = (batch_idx // batch_size) + 1
        
        try:
            sb.table("ad_metrics").upsert(batch, on_conflict="id,user_id").execute()
            logger.info(f"[UPSERT_AD_METRICS] Lote {batch_num}/{total_batches} processado com sucesso ({len(batch)} registros)")
            # Chamar callback ANTES do delay para feedback imediato
            if on_batch_progress:
                try:
                    on_batch_progress(batch_num, total_batches)
                except Exception:
                    pass
            # Pequeno delay entre batches para não sobrecarregar Supabase e dar tempo de processar updates
            if batch_num < total_batches:  # Não delay no último batch
                time.sleep(0.1)
        except Exception as e:
            logger.error(f"[UPSERT_AD_METRICS] Erro ao processar lote {batch_num}/{total_batches}: {e}")
            msg = str(e or "")
            # Compatibilidade: se o DB ainda não tem a coluna `lpv`, reprocessar removendo o campo
            missing_optional_cols = []
            for col in ("lpv", "hook_rate", "scroll_stop_rate"):
                if col in msg and ("column" in msg or "does not exist" in msg):
                    missing_optional_cols.append(col)

            if missing_optional_cols:
                logger.warning(
                    f"[UPSERT_AD_METRICS] Colunas {missing_optional_cols} parecem ausentes no DB; "
                    f"reprocessando lote {batch_num}/{total_batches} sem essas colunas"
                )
                cleaned = []
                for r in batch:
                    rr = dict(r)
                    for col in missing_optional_cols:
                        rr.pop(col, None)
                    cleaned.append(rr)
                sb.table("ad_metrics").upsert(cleaned, on_conflict="id,user_id").execute()
                logger.info(
                    f"[UPSERT_AD_METRICS] Lote {batch_num}/{total_batches} reprocessado "
                    f"sem {missing_optional_cols} ({len(cleaned)} registros)"
                )
                if on_batch_progress:
                    try:
                        on_batch_progress(batch_num, total_batches)
                    except Exception:
                        pass
            else:
                # Re-lançar para que caller possa tratar o erro
                raise

    if pack_id and rows:
        map_rows = [
            {
                "user_id": user_id,
                "pack_id": pack_id,
                "ad_id": str(r.get("ad_id") or ""),
                "metric_date": r.get("date"),
            }
            for r in rows
            if str(r.get("ad_id") or "").strip() and r.get("date")
        ]

        if map_rows:
            map_batch_size = 500
            total_map_batches = (len(map_rows) + map_batch_size - 1) // map_batch_size
            for map_idx in range(0, len(map_rows), map_batch_size):
                map_batch = map_rows[map_idx:map_idx + map_batch_size]
                map_batch_num = (map_idx // map_batch_size) + 1
                try:
                    sb.table("ad_metric_pack_map").upsert(
                        map_batch,
                        on_conflict="user_id,pack_id,ad_id,metric_date",
                    ).execute()
                    logger.debug(
                        f"[UPSERT_AD_METRICS] ad_metric_pack_map lote {map_batch_num}/{total_map_batches} "
                        f"({len(map_batch)} vínculos)"
                    )
                except Exception as e:
                    # Durante rollout, ambientes sem a tabela nova devem continuar funcionando.
                    logger.warning(
                        f"[UPSERT_AD_METRICS] Falha ao upsert em ad_metric_pack_map "
                        f"(fallback legado pack_ids[] mantido): {e}"
                    )
                    break

    if pack_id and rows:
        metric_ids = [r["id"] for r in rows]
        batch_size_attach = 200
        total_attach_batches = (len(metric_ids) + batch_size_attach - 1) // batch_size_attach
        failed_attach_ids: List[str] = []

        for attach_idx in range(0, len(metric_ids), batch_size_attach):
            batch_ids = metric_ids[attach_idx:attach_idx + batch_size_attach]
            batch_num = (attach_idx // batch_size_attach) + 1
            for attempt in range(3):
                try:
                    sb.rpc(
                        "batch_add_pack_id_to_arrays",
                        {
                            "p_user_id": user_id,
                            "p_pack_id": pack_id,
                            "p_table_name": "ad_metrics",
                            "p_ids_to_update": batch_ids,
                        },
                    ).execute()
                    logger.debug(
                        f"[UPSERT_AD_METRICS] pack_id anexado ao lote {batch_num}/{total_attach_batches} "
                        f"({len(batch_ids)} registros)"
                    )
                    break
                except Exception as e:
                    if attempt < 2:
                        delay = 0.5 * (attempt + 1)
                        logger.warning(
                            f"[UPSERT_AD_METRICS] Tentativa {attempt + 1}/3 para attach pack_id lote {batch_num}: {e}"
                        )
                        time.sleep(delay)
                    else:
                        logger.critical(
                            f"[UPSERT_AD_METRICS] Falha definitiva ao anexar pack_id no lote {batch_num}/{total_attach_batches}. "
                            f"pack_id={pack_id}, metric_ids afetados={batch_ids}. Erro: {e}"
                        )
                        failed_attach_ids.extend(batch_ids)

        if failed_attach_ids:
            logger.error(
                f"[UPSERT_AD_METRICS] {len(failed_attach_ids)} metricas ficaram sem pack_id={pack_id} vinculado. "
                f"Necessario cleanup manual."
            )
            raise RuntimeError(
                f"Falha ao vincular {len(failed_attach_ids)} metricas ao pack {pack_id} apos retries"
            )

    logger.info(f"[UPSERT_AD_METRICS] Todos os {total_rows} registros processados com sucesso em {total_batches} lote(s)")



def update_pack_stats(
    user_jwt: str,
    pack_id: str,
    stats: Dict[str, Any],
    user_id: Optional[str],
    *,
    sb_client: Optional["Client"] = None,
) -> None:
    if not user_id:
        return
    sb = _get_sb(user_jwt, sb_client)
    sb.table("packs").update({"stats": stats, "updated_at": _now_iso()}).eq("id", pack_id).eq("user_id", user_id).execute()


def update_pack_ad_ids(
    user_jwt: str,
    pack_id: str,
    ad_ids: List[str],
    user_id: Optional[str],
    *,
    sb_client: Optional["Client"] = None,
) -> None:
    """Atualiza packs.ad_ids com a lista fornecida (deduplicada).
    """
    if not user_id or not pack_id:
        return
    sb = _get_sb(user_jwt, sb_client)
    unique_ad_ids = sorted(list({str(a) for a in (ad_ids or [])}))
    sb.table("packs").update({"ad_ids": unique_ad_ids, "updated_at": _now_iso()}).eq("id", pack_id).eq("user_id", user_id).execute()


def get_existing_ads_map(
    user_jwt: str,
    ad_ids: List[str],
    user_id: Optional[str],
    *,
    sb_client: Optional["Client"] = None,
) -> Dict[str, Dict[str, Any]]:
    """Busca ads ja persistidos por ad_id para reaproveito no refresh."""
    if not user_id or not ad_ids:
        return {}

    sb = _get_sb(user_jwt, sb_client)
    unique_ad_ids = sorted({str(ad_id).strip() for ad_id in ad_ids if str(ad_id).strip()})
    if not unique_ad_ids:
        return {}

    select_fields = (
        "ad_id,account_id,campaign_id,campaign_name,adset_id,adset_name,ad_name,"
        "effective_status,creative,creative_video_id,thumbnail_url,"
        "instagram_permalink_url,primary_video_id,media_type,"
        "adcreatives_videos_ids,adcreatives_videos_thumbs"
    )
    batch_size = 200  # Reduzido de 400 para evitar timeout/URL longa
    existing_ads: Dict[str, Dict[str, Any]] = {}

    logger.info(
        f"[GET_EXISTING_ADS_MAP] Buscando {len(unique_ad_ids)} ads existentes em lotes de {batch_size}"
    )

    for i in range(0, len(unique_ad_ids), batch_size):
        batch_ids = unique_ad_ids[i : i + batch_size]
        response = (
            sb.table("ads")
            .select(select_fields)
            .eq("user_id", user_id)
            .in_("ad_id", batch_ids)
            .execute()
        )
        for row in response.data or []:
            ad_id = str(row.get("ad_id") or "").strip()
            if ad_id:
                existing_ads[ad_id] = row

    logger.info(
        f"[GET_EXISTING_ADS_MAP] Reaproveitando {len(existing_ads)} ads ja persistidos"
    )
    return existing_ads


def calculate_pack_stats_essential(
    user_jwt: str,
    pack_id: str,
    user_id: Optional[str],
    *,
    sb_client: Optional["Client"] = None,
) -> Dict[str, Any]:
    """Calcula apenas os stats essenciais para exibição nos cards de /packs.
    
    Query leve (5 colunas) para permitir redirect rápido. O restante é calculado em background.
    
    Returns:
        Dict com: totalSpend, uniqueAds, uniqueAdNames, uniqueCampaigns, uniqueAdsets
    """
    if not user_id:
        return {}
    
    sb = _get_sb(user_jwt, sb_client)
    
    try:
        pack_res = sb.table("packs").select("id").eq("id", pack_id).eq("user_id", user_id).limit(1).execute()
        if not pack_res.data or len(pack_res.data) == 0:
            logger.warning(f"[CALCULATE_PACK_STATS_ESSENTIAL] Pack {pack_id} não encontrado")
            return {}
        
        def metrics_filters(q):
            return q.eq("user_id", user_id).filter("pack_ids", "cs", f"{{{pack_id}}}")
        
        metrics = _fetch_all_paginated(
            sb,
            "ad_metrics",
            "ad_id, ad_name, campaign_id, adset_id, spend",
            metrics_filters,
        )
    except Exception as e:
        logger.warning(f"[CALCULATE_PACK_STATS_ESSENTIAL] Erro ao buscar métricas para pack {pack_id}: {e}")
        return {}
    
    if not metrics:
        return {
            "totalSpend": 0.0,
            "uniqueAds": 0,
            "uniqueAdNames": 0,
            "uniqueCampaigns": 0,
            "uniqueAdsets": 0,
        }
    
    unique_ad_ids = set()
    unique_ad_names = set()
    unique_campaign_ids = set()
    unique_adset_ids = set()
    total_spend = 0.0
    
    for metric in metrics:
        if metric.get("ad_id"):
            unique_ad_ids.add(str(metric["ad_id"]))
        if metric.get("ad_name"):
            unique_ad_names.add(str(metric["ad_name"]))
        if metric.get("campaign_id"):
            unique_campaign_ids.add(str(metric["campaign_id"]))
        if metric.get("adset_id"):
            unique_adset_ids.add(str(metric["adset_id"]))
        total_spend += float(metric.get("spend", 0) or 0)
    
    return {
        "totalSpend": round(total_spend, 2),
        "uniqueAds": len(unique_ad_ids),
        "uniqueAdNames": len(unique_ad_names),
        "uniqueCampaigns": len(unique_campaign_ids),
        "uniqueAdsets": len(unique_adset_ids),
    }


def calculate_pack_stats(
    user_jwt: str,
    pack_id: str,
    user_id: Optional[str],
    *,
    sb_client: Optional["Client"] = None,
) -> Dict[str, Any]:
    """Calcula estatísticas agregadas de um pack baseado nas métricas de ad_metrics.
    
    Filtra métricas por pack_ids (não por período) para incluir todos os dados do pack,
    incluindo dados de refresh que podem ter datas diferentes do período original.
    
    Returns:
        Dict com stats: {
            "totalAds": int,
            "uniqueAds": int,
            "uniqueAdNames": int,
            "uniqueCampaigns": int,
            "uniqueAdsets": int,
            "totalSpend": float,
            "totalClicks": int,
            "totalImpressions": int,
            "totalReach": int,
            "totalInlineLinkClicks": int,
            "totalPlays": int,
            "totalThruplays": int,
            "ctr": float,
            "cpm": float,
            "frequency": float,
            "holdRate": float,
            "connectRate": float,
            "websiteCtr": float,
            "profileCtr": float,
            "videoWatchedP50": float,
            "totalLandingPageViews": int,
            "actions": Dict[str, int],
            "conversions": Dict[str, int],
        }
    """
    if not user_id:
        return {}
    
    sb = _get_sb(user_jwt, sb_client)
    
    try:
        # Verificar se pack existe (apenas para validação)
        pack_res = sb.table("packs")\
            .select("id")\
            .eq("id", pack_id)\
            .eq("user_id", user_id)\
            .limit(1)\
            .execute()
        
        if not pack_res.data or len(pack_res.data) == 0:
            logger.warning(f"[CALCULATE_PACK_STATS] Pack {pack_id} não encontrado")
            return {}
        
        # Buscar métricas que pertencem ao pack (via pack_ids array)
        # Isso inclui TODAS as métricas do pack, independente da data (criadas + refresh)
        # Usar operador PostgREST @> (contains) via query parameter
        # Incluir campos adicionais para novas métricas agregadas
        try:
            # Tentar usar filtro direto com contains (PostgREST @> operator)
            def metrics_filters(q):
                return q.eq("user_id", user_id).filter("pack_ids", "cs", f"{{{pack_id}}}")
            
            metrics = _fetch_all_paginated(
                sb,
                "ad_metrics",
                "ad_id, ad_name, campaign_id, adset_id, spend, clicks, impressions, reach, inline_link_clicks, video_total_plays, video_total_thruplays, cpm, ctr, frequency, hold_rate, connect_rate, website_ctr, profile_ctr, video_watched_p50, actions, conversions",
                metrics_filters
            )
        except Exception as filter_error:
            # IMPORTANTE:
            # O fallback antigo varria TODAS as métricas do usuário e filtrava em Python.
            # Em produção isso pode ser enorme e travar requests e jobs (especialmente durante persistência).
            # Melhor prática aqui é degradar com segurança (stats best-effort) e preservar a saúde do sistema.
            logger.warning(
                f"[CALCULATE_PACK_STATS] Erro ao filtrar ad_metrics por pack_ids (cs) para pack {pack_id}; "
                f"pulando cálculo de stats (best-effort). Erro: {filter_error}"
            )
            return {}
        
        if not metrics:
            return {
                "totalAds": 0,
                "uniqueAds": 0,
                "uniqueAdNames": 0,
                "uniqueCampaigns": 0,
                "uniqueAdsets": 0,
                "totalSpend": 0.0,
                "totalClicks": 0,
                "totalImpressions": 0,
                "totalReach": 0,
                "totalInlineLinkClicks": 0,
                "totalPlays": 0,
                "totalThruplays": 0,
                "ctr": 0.0,
                "cpm": 0.0,
                "frequency": 0.0,
                "holdRate": 0.0,
                "connectRate": 0.0,
                "websiteCtr": 0.0,
                "profileCtr": 0.0,
                "videoWatchedP50": 0.0,
                "totalLandingPageViews": 0,
                "actions": {},
                "conversions": {},
            }
        
        # Agregar métricas
        unique_ad_ids = set()
        unique_ad_names = set()
        unique_campaign_ids = set()
        unique_adset_ids = set()
        
        total_spend = 0.0
        total_clicks = 0
        total_impressions = 0
        total_reach = 0
        total_inline_link_clicks = 0
        total_plays = 0
        total_thruplays = 0
        
        # Métricas ponderadas (para médias)
        hold_rate_wsum = 0.0  # Soma ponderada de hold_rate por plays
        video_watched_p50_wsum = 0.0  # Soma ponderada de video_watched_p50 por plays
        profile_ctr_wsum = 0.0  # Soma ponderada de profile_ctr por impressions
        connect_rate_wsum = 0.0  # Soma ponderada de connect_rate por inline_link_clicks
        
        # Agregar actions e conversions
        total_landing_page_views = 0
        actions_agg: Dict[str, int] = {}  # {action_type: total_value}
        conversions_agg: Dict[str, int] = {}  # {action_type: total_value}
        
        for metric in metrics:
            ad_id = metric.get("ad_id")
            ad_name = metric.get("ad_name")
            campaign_id = metric.get("campaign_id")
            adset_id = metric.get("adset_id")
            
            if ad_id:
                unique_ad_ids.add(str(ad_id))
            if ad_name:
                unique_ad_names.add(str(ad_name))
            if campaign_id:
                unique_campaign_ids.add(str(campaign_id))
            if adset_id:
                unique_adset_ids.add(str(adset_id))
            
            # Somar valores numéricos básicos
            spend = float(metric.get("spend", 0) or 0)
            clicks = int(metric.get("clicks", 0) or 0)
            impressions = int(metric.get("impressions", 0) or 0)
            reach = int(metric.get("reach", 0) or 0)
            inline_link_clicks = int(metric.get("inline_link_clicks", 0) or 0)
            plays = int(metric.get("video_total_plays", 0) or 0)
            thruplays = int(metric.get("video_total_thruplays", 0) or 0)
            
            total_spend += spend
            total_clicks += clicks
            total_impressions += impressions
            total_reach += reach
            total_inline_link_clicks += inline_link_clicks
            total_plays += plays
            total_thruplays += thruplays
            
            # Agregar métricas ponderadas
            hold_rate = float(metric.get("hold_rate", 0) or 0)
            if hold_rate > 0 and plays > 0:
                hold_rate_wsum += hold_rate * plays
            
            video_watched_p50 = float(metric.get("video_watched_p50", 0) or 0)
            if video_watched_p50 > 0 and plays > 0:
                video_watched_p50_wsum += video_watched_p50 * plays
            
            profile_ctr = float(metric.get("profile_ctr", 0) or 0)
            if profile_ctr > 0 and impressions > 0:
                profile_ctr_wsum += profile_ctr * impressions
            
            connect_rate = float(metric.get("connect_rate", 0) or 0)
            if connect_rate > 0 and inline_link_clicks > 0:
                connect_rate_wsum += connect_rate * inline_link_clicks
            
            # Agregar actions e conversions
            actions = metric.get("actions") or []
            if isinstance(actions, list):
                for action in actions:
                    action_type = str(action.get("action_type") or "").strip()
                    value = int(action.get("value") or 0)
                    if action_type:
                        if action_type not in actions_agg:
                            actions_agg[action_type] = 0
                        actions_agg[action_type] += value
                        
                        # Extrair landing_page_views para calcular connect_rate agregado
                        if action_type == "landing_page_view":
                            total_landing_page_views += value
            
            conversions = metric.get("conversions") or []
            if isinstance(conversions, list):
                for conversion in conversions:
                    action_type = str(conversion.get("action_type") or "").strip()
                    value = int(conversion.get("value") or 0)
                    if action_type:
                        if action_type not in conversions_agg:
                            conversions_agg[action_type] = 0
                        conversions_agg[action_type] += value
        
        # Calcular métricas derivadas
        calculated_ctr = _safe_div(total_clicks, total_impressions)
        calculated_cpm = _safe_div(total_spend * 1000, total_impressions)
        calculated_frequency = _safe_div(total_impressions, total_reach)
        
        # Calcular médias ponderadas
        calculated_hold_rate = _safe_div(hold_rate_wsum, total_plays)
        calculated_video_watched_p50 = _safe_div(video_watched_p50_wsum, total_plays)
        calculated_profile_ctr = _safe_div(profile_ctr_wsum, total_impressions)
        
        # Calcular connect_rate agregado: total_landing_page_views / total_inline_link_clicks
        # Priorizar cálculo agregado a partir das actions (mais preciso)
        # Se não houver landing_page_views nas actions, usar valor ponderado do banco
        if total_landing_page_views > 0:
            calculated_connect_rate = _safe_div(total_landing_page_views, total_inline_link_clicks)
        else:
            # Fallback: usar valor ponderado do banco
            calculated_connect_rate = _safe_div(connect_rate_wsum, total_inline_link_clicks)
        
        # Calcular website_ctr agregado: total_inline_link_clicks / total_impressions
        calculated_website_ctr = _safe_div(total_inline_link_clicks, total_impressions)
        
        stats = {
            "totalAds": len(metrics),
            "uniqueAds": len(unique_ad_ids),
            "uniqueAdNames": len(unique_ad_names),
            "uniqueCampaigns": len(unique_campaign_ids),
            "uniqueAdsets": len(unique_adset_ids),
            "totalSpend": round(total_spend, 2),
            "totalClicks": total_clicks,
            "totalImpressions": total_impressions,
            "totalReach": total_reach,
            "totalInlineLinkClicks": total_inline_link_clicks,
            "totalPlays": total_plays,
            "totalThruplays": total_thruplays,
            "ctr": round(calculated_ctr, 4),
            "cpm": round(calculated_cpm, 2),
            "frequency": round(calculated_frequency, 2),
            "holdRate": round(calculated_hold_rate, 4),
            "connectRate": round(calculated_connect_rate, 4),
            "websiteCtr": round(calculated_website_ctr, 4),
            "profileCtr": round(calculated_profile_ctr, 4),
            "videoWatchedP50": round(calculated_video_watched_p50, 0),  # Arredondar para inteiro (segundos)
            "totalLandingPageViews": total_landing_page_views,
            "actions": actions_agg,
            "conversions": conversions_agg,
        }
        
        logger.info(f"[CALCULATE_PACK_STATS] Stats calculados para pack {pack_id}: {stats}")
        return stats
        
    except Exception as e:
        logger.exception(f"[CALCULATE_PACK_STATS] Erro ao calcular stats do pack {pack_id}: {e}")
        raise


def upsert_pack(
    user_jwt: str,
    user_id: str,
    adaccount_id: str,
    name: str,
    date_start: str,
    date_stop: str,
    level: str,
    filters: List[Dict[str, Any]],
    auto_refresh: bool = False,
    pack_id: Optional[str] = None,
    today_local: Optional[str] = None,
    *,
    sb_client: Optional["Client"] = None,
) -> Optional[str]:
    """Cria ou atualiza um pack na tabela packs do Supabase.
    
    Args:
        user_jwt: JWT do Supabase do usuário
        user_id: ID do usuário
        adaccount_id: ID da conta de anúncios
        name: Nome do pack
        date_start: Data de início no formato YYYY-MM-DD
        date_stop: Data de fim no formato YYYY-MM-DD
        level: Nível ('campaign', 'adset', ou 'ad')
        filters: Lista de filtros (será convertida para JSONB)
        auto_refresh: Se o pack deve ser atualizado automaticamente
        pack_id: ID do pack se for atualização (opcional, gera novo UUID se None)
        today_local: Data lógica do usuário (YYYY-MM-DD) para last_prompted_at e last_refreshed_at
    
    Returns:
        UUID do pack criado/atualizado ou None se houver erro
    """
    normalized_name = normalize_pack_name(name)
    logger.info(f"[UPSERT_PACK] Iniciando upsert_pack - user_id={user_id}, name={normalized_name}, pack_id={pack_id}")
    
    if not user_id:
        raise ValueError("[UPSERT_PACK] missing user_id")

    if not normalized_name:
        raise ValueError("[UPSERT_PACK] missing name")
    
    # Usar today_local se fornecido, senão usar date_stop como fallback (já vem do frontend no fuso local)
    # Nunca usar UTC para datas lógicas
    today_str = today_local if today_local else date_stop
    
    sb = _get_sb(user_jwt, sb_client)
    
    pack_data = {
        "user_id": user_id,
        "adaccount_id": adaccount_id,
        "name": normalized_name,
        "date_start": date_start,
        "date_stop": date_stop,
        "level": level,
        "filters": filters if filters else [],
        "auto_refresh": auto_refresh,
        "last_refreshed_at": today_str,
        "last_prompted_at": today_str,
        "refresh_status": "success",
        "updated_at": _now_iso(),
    }
    
    logger.info(f"[UPSERT_PACK] Dados do pack preparados: {pack_data}")
    
    try:
        if pack_id:
            # Atualizar pack existente
            logger.info(f"[UPSERT_PACK] Atualizando pack existente: {pack_id}")
            pack_data["id"] = pack_id
            res = sb.table("packs").upsert(pack_data, on_conflict="id").execute()
            logger.info(f"[UPSERT_PACK] Resposta do upsert (update): data={res.data is not None}, len={len(res.data) if res.data else 0}")
        else:
            # Criar novo pack (o ID será gerado pelo Supabase)
            logger.info(f"[UPSERT_PACK] Criando novo pack")
            
            # Verificar se já existe um pack com o mesmo nome
            if check_pack_name_exists(user_jwt, user_id, normalized_name, sb_client=sb):
                logger.warning(f"[UPSERT_PACK] ✗ Pack com nome '{normalized_name}' já existe para user_id={user_id}")
                raise PackNameConflictError(f"Já existe um pack com o nome '{normalized_name}'")
            
            logger.info(f"[UPSERT_PACK] Executando insert na tabela packs...")
            res = sb.table("packs").insert(pack_data).execute()
            logger.info(f"[UPSERT_PACK] Insert executado. Resposta: data={res.data is not None}, len={len(res.data) if res.data else 0}")
            if res.data:
                logger.info(f"[UPSERT_PACK] Dados retornados: {res.data}")
            else:
                logger.warning(f"[UPSERT_PACK] Nenhum dado retornado do insert. Verificar RLS ou constraints.")
                # Tentar buscar o pack criado para confirmar se foi salvo
                try:
                    check_res = sb.table("packs").select("id, name").eq("user_id", user_id).ilike("name", normalized_name).order("created_at", desc=True).limit(1).execute()
                    if check_res.data:
                        logger.info(f"[UPSERT_PACK] Pack encontrado após insert: {check_res.data[0].get('id')}")
                        return check_res.data[0].get("id")
                except Exception as check_err:
                    logger.error(f"[UPSERT_PACK] Erro ao verificar pack criado: {check_err}")
        
        if res.data and len(res.data) > 0:
            pack_created_id = res.data[0].get("id")
            logger.info(f"[UPSERT_PACK] ✓ Pack {'atualizado' if pack_id else 'criado'} no Supabase: {pack_created_id} (nome: {normalized_name})")
            return pack_created_id
        else:
            raise RuntimeError(
                f"[UPSERT_PACK] Pack {'criado' if not pack_id else 'atualizado'} mas nenhum dado retornado do Supabase. "
                f"Response: {res}"
            )
    except PackNameConflictError:
        raise
    except Exception as e:
        if _is_pack_name_unique_violation(e):
            raise PackNameConflictError(f"Já existe um pack com o nome '{normalized_name}'") from e
        logger.exception(f"[UPSERT_PACK] ✗ Erro ao criar/atualizar pack no Supabase: {e}")
        raise


def record_job(user_jwt: str, job_id: str, status: str, user_id: Optional[str], progress: int = 0, message: Optional[str] = None, payload: Optional[Dict[str, Any]] = None, result_count: Optional[int] = None, details: Optional[Dict[str, Any]] = None) -> None:
    if not user_id:
        return
    sb = get_supabase_for_user(user_jwt)
    
    data = {
        "status": status,
        "progress": progress,
        "updated_at": _now_iso(),
    }
    
    if message is not None:
        data["message"] = message
    
    if result_count is not None:
        data["result_count"] = result_count
    
    # Mesclar details no payload se fornecido
    # IMPORTANTE: Se apenas details for fornecido (sem payload), buscar payload existente para preservar campos como 'name'
    final_payload = payload.copy() if payload else {}
    
    # Se apenas details foi fornecido (sem payload), buscar payload existente do banco
    if details is not None and not payload:
        try:
            existing_job = sb.table("jobs").select("payload").eq("id", job_id).eq("user_id", user_id).limit(1).execute()
            if existing_job.data and len(existing_job.data) > 0:
                existing_payload = existing_job.data[0].get("payload")
                if existing_payload and isinstance(existing_payload, dict):
                    final_payload = existing_payload.copy()
        except Exception:
            # Se falhar ao buscar, continuar com payload vazio (não é crítico)
            pass
    
    if details is not None:
        if "details" not in final_payload:
            final_payload["details"] = {}
        final_payload["details"].update(details)
    
    # Estratégia de otimização:
    # - Se payload foi fornecido ou details foi fornecido: usar UPSERT (pode criar ou atualizar)
    # - Se payload NÃO foi fornecido: usar UPDATE (preserva campos não incluídos, como payload)
    if final_payload or details is not None:
        # Com payload: fazer UPSERT completo (pode criar novo job ou atualizar existente)
        data["id"] = job_id
        data["user_id"] = user_id
        data["payload"] = final_payload if final_payload else None
        sb.table("jobs").upsert(data, on_conflict="id").execute()
    else:
        # Sem payload: fazer UPDATE direto (UPDATE preserva campos não fornecidos)
        # Isso é mais eficiente que SELECT + UPSERT, pois evita query extra
        update_result = sb.table("jobs").update(data).eq("id", job_id).eq("user_id", user_id).execute()
        
        # Se nenhuma linha foi afetada (job não existe), criar com payload None
        # Isso só acontece em casos raros de race condition ou erro
        if not update_result.data:
            logger.warning(f"[RECORD_JOB] Job {job_id} não existe, criando novo registro sem payload")
            data["id"] = job_id
            data["user_id"] = user_id
            data["payload"] = None
            sb.table("jobs").insert(data).execute()


def insert_bulk_ad_items(
    sb,
    items_list: List[Dict[str, Any]],
) -> None:
    if not items_list:
        return
    job_id = str((items_list[0] or {}).get("job_id") or "")
    logger.info(
        "[BULK_AD_ITEMS] insert begin rows=%s job_id=%s",
        len(items_list),
        job_id or "?",
    )
    with_postgrest_retry(
        "insert_bulk_ad_items",
        lambda: sb.table("bulk_ad_items").insert(items_list).execute(),
    )
    logger.info("[BULK_AD_ITEMS] insert ok job_id=%s", job_id or "?")


def update_bulk_ad_item_status(
    sb,
    item_id: str,
    status: str,
    error_message: Optional[str] = None,
    meta_ad_id: Optional[str] = None,
    meta_creative_id: Optional[str] = None,
    error_code: Optional[str] = None,
) -> None:
    update_data: Dict[str, Any] = {
        "status": status,
        "updated_at": _now_iso(),
    }
    if error_message is not None:
        update_data["error_message"] = error_message
    if meta_ad_id is not None:
        update_data["meta_ad_id"] = meta_ad_id
    if meta_creative_id is not None:
        update_data["meta_creative_id"] = meta_creative_id
    if error_code is not None:
        update_data["error_code"] = error_code
    logger.debug(
        "[BULK_AD_ITEMS] update item_id=%s status=%s error_code=%s",
        item_id,
        status,
        error_code,
    )
    with_postgrest_retry(
        "update_bulk_ad_item_status",
        lambda: sb.table("bulk_ad_items").update(update_data).eq("id", item_id).execute(),
    )


def fetch_bulk_ad_items_for_job(
    sb,
    job_id: str,
) -> List[Dict[str, Any]]:
    result = with_postgrest_retry(
        "fetch_bulk_ad_items_for_job",
        lambda: sb.table("bulk_ad_items")
        .select("*")
        .eq("job_id", job_id)
        .order("file_index")
        .order("created_at")
        .execute(),
    )
    rows = result.data or []
    logger.debug("[BULK_AD_ITEMS] fetch job_id=%s rows=%s", job_id, len(rows))
    return rows


def validate_adsets_ownership(
    sb,
    user_id: str,
    adset_ids: List[str],
) -> bool:
    if not adset_ids:
        return False
    unique_ids = sorted({str(adset_id).strip() for adset_id in adset_ids if str(adset_id).strip()})
    if not unique_ids:
        return False
    result = (
        sb.table("ads")
        .select("adset_id")
        .eq("user_id", user_id)
        .in_("adset_id", unique_ids)
        .execute()
    )
    found_ids = {str(row.get("adset_id")).strip() for row in (result.data or []) if row.get("adset_id")}
    return found_ids == set(unique_ids)


def validate_ad_account_ownership(
    sb,
    user_id: str,
    account_id: str,
) -> bool:
    result = (
        sb.table("ad_accounts")
        .select("id")
        .eq("user_id", user_id)
        .eq("id", account_id)
        .limit(1)
        .execute()
    )
    return bool(result.data)


def delete_pack(
    user_jwt: str,
    pack_id: str,
    ad_ids: Optional[List[str]] = None,
    user_id: Optional[str] = None,
    *,
    sb_client: Optional["Client"] = None,
) -> Dict[str, Any]:
    """Remove pack e ajusta ads/ad_metrics conforme referência pack_ids.
    
    A função sempre processa ad_metrics e ads baseado no pack_id no array pack_ids,
    mesmo se ad_ids estiver vazio. Preserva dados que são usados por outros packs:
    - Se um registro é usado por múltiplos packs: remove apenas o pack_id do array
    - Se um registro é usado apenas por este pack: deleta completamente
    
    Args:
        user_jwt: JWT do Supabase do usuário
        pack_id: ID do pack a ser deletado (pode ser UUID do Supabase ou ID local)
        ad_ids: Lista de ad_ids opcional (usado apenas como filtro adicional para performance)
        user_id: ID do usuário para garantir segurança (RLS)
    
    Returns:
        Dict com estatísticas da deleção: {
            "pack_deleted": bool,
            "ads_deleted": int,
            "metrics_deleted": int,
            "storage_thumbs_candidates": int,
            "storage_thumbs_deleted": int,
            "storage_thumbs_kept": int
        }
    """
    if not user_id:
        logger.warning("Supabase delete_pack skipped: missing user_id")
        return {
            "pack_deleted": False,
            "ads_deleted": 0,
            "metrics_deleted": 0,
            "storage_thumbs_candidates": 0,
            "storage_thumbs_deleted": 0,
            "storage_thumbs_kept": 0,
        }
    
    # Sempre buscar pack para obter ad_ids e período (fonte de verdade)
    sb = _get_sb(user_jwt, sb_client)
    pack = None
    pack_ad_ids = None
    date_start = None
    date_stop = None
    thumb_paths_candidates: List[str] = []
    
    try:
        pres = sb.table("packs").select("ad_ids, date_start, date_stop").eq("id", pack_id).eq("user_id", user_id).limit(1).execute()
        if pres.data:
            pack = pres.data[0]
            pack_ad_ids = pack.get("ad_ids") or []
            date_start = pack.get("date_start")
            date_stop = pack.get("date_stop")
    except Exception as e:
        logger.warning(f"Erro ao buscar pack {pack_id}: {e}")
    
    # Usar ad_ids do pack (preferencial) ou fallback para packs antigos
    if pack_ad_ids:
        ad_ids = pack_ad_ids
        logger.info(f"Usando ad_ids do pack ({len(ad_ids)} ads) para deleção")
    elif ad_ids:
        logger.warning(f"Pack {pack_id} não tem ad_ids salvos, usando fallback ({len(ad_ids)} ads)")
    else:
        logger.warning(f"Pack {pack_id} não tem ad_ids e nenhum fallback fornecido - pode não deletar todos os dados relacionados")
        ad_ids = []
    
    result = {
        "pack_deleted": False,
        "ads_deleted": 0,
        "metrics_deleted": 0,
        "storage_thumbs_candidates": 0,
        "storage_thumbs_deleted": 0,
        "storage_thumbs_kept": 0,
    }
    
    try:
        # Coletar paths de thumbs antes da deleção/ajustes em ads
        thumb_paths_candidates = _get_pack_thumb_storage_paths(sb, user_id, pack_id)
        result["storage_thumbs_candidates"] = len(thumb_paths_candidates)

        # 1. Deletar o pack (se existir no Supabase)
        # Tenta tanto por UUID quanto por id local (pack_xxx)
        try:
            # Primeiro tenta como UUID
            pack_res = sb.table("packs").delete().eq("id", pack_id).eq("user_id", user_id).execute()
            if pack_res.data:
                result["pack_deleted"] = True
                logger.info(f"Pack deletado do Supabase: {pack_id}")
        except Exception as e:
            logger.debug(f"Pack {pack_id} não encontrado no Supabase ou não é UUID: {e}")

        # 1.1 Remover vínculos relacionais do pack nas métricas (dual-write v2).
        #      Em ambientes sem a tabela nova, seguimos normalmente com o fluxo legado.
        try:
            sb.table("ad_metric_pack_map").delete().eq("user_id", user_id).eq("pack_id", pack_id).execute()
        except Exception as e:
            logger.warning(f"Erro ao remover vínculos de ad_metric_pack_map para pack {pack_id}: {e}")

        # 2. Ajustar/deletar ad_metrics do período do pack
        # Processar sempre, mesmo se ad_ids estiver vazio - usar pack_id no array pack_ids como filtro principal
        # Preserva dados que são usados por outros packs (remove apenas o pack_id do array se houver múltiplos)
        # Otimizado: processa em lotes durante a busca (streaming) para economizar memória
        try:
            def metrics_filters(q):
                q = q.eq("user_id", user_id).filter("pack_ids", "cs", f"{{{pack_id}}}")
                if date_start and date_stop:
                    q = q.gte("date", date_start).lte("date", date_stop)
                return q
            
            # Processar em lotes durante a busca (streaming) - mais eficiente em memória
            to_update_ids, to_delete_ids, failed_metric_ids = _process_pack_deletion_in_batches(
                sb=sb,
                table_name="ad_metrics",
                id_field="id",
                filters_func=metrics_filters,
                pack_id=pack_id,
                user_id=user_id,
                batch_size=500
            )
            
            # IDs que não foram processados durante streaming (erros) - processar agora
            if to_update_ids:
                batch_size = 500
                total_batches = (len(to_update_ids) + batch_size - 1) // batch_size
                total_updated = 0
                
                logger.info(f"Processando {len(to_update_ids)} registros de ad_metrics restantes em {total_batches} lote(s)")
                
                for i in range(0, len(to_update_ids), batch_size):
                    batch = to_update_ids[i:i + batch_size]
                    batch_num = (i // batch_size) + 1
                    
                    try:
                        rpc_result = sb.rpc(
                            "batch_remove_pack_id_from_arrays",
                            {
                                "p_user_id": user_id,
                                "p_pack_id": pack_id,
                                "p_table_name": "ad_metrics",
                                "p_ids_to_update": batch
                            }
                        ).execute()
                        
                        if rpc_result.data:
                            batch_updated = rpc_result.data.get("rows_updated", 0)
                            total_updated += batch_updated
                            if rpc_result.data.get("status") == "error":
                                logger.warning(f"Erro no batch update {batch_num}/{total_batches}: {rpc_result.data.get('error_message')}")
                        logger.debug(f"Batch update {batch_num}/{total_batches}: {len(batch)} IDs processados")
                    except Exception as batch_err:
                        logger.warning(f"Erro ao fazer batch update {batch_num}/{total_batches} de ad_metrics: {batch_err}")
                        continue
                
                logger.info(f"Atualizados {total_updated} registros de ad_metrics (removido pack_id, mantidos por outros packs)")
            
            if to_delete_ids:
                # Deletar em lotes para evitar problemas com muitos IDs
                # IDs de métricas são compostos e longos (ex: "2025-11-10-120236981806920782" ~30 chars)
                # Reduzir batch_size para evitar URLs muito longas que excedem limite do Supabase (~8KB)
                # Com IDs de ~30 caracteres, 200 IDs = ~6000 chars na URL (seguro para limite de ~8KB)
                batch_size = 200  # Reduzido de 1000 para 200 devido ao tamanho dos IDs compostos
                total_batches = (len(to_delete_ids) + batch_size - 1) // batch_size
                
                logger.info(f"Deletando {len(to_delete_ids)} registros de ad_metrics em {total_batches} lote(s) de até {batch_size} IDs")
                
                for i in range(0, len(to_delete_ids), batch_size):
                    batch = to_delete_ids[i:i + batch_size]
                    batch_num = (i // batch_size) + 1
                    
                    try:
                        sb.table("ad_metrics").delete().in_("id", batch).eq("user_id", user_id).execute()
                        logger.debug(f"Lote de deleção {batch_num}/{total_batches}: {len(batch)} registros deletados")
                    except Exception as batch_err:
                        logger.warning(f"Erro ao deletar lote {batch_num}/{total_batches} de ad_metrics: {batch_err}")
                        # Continuar com próximos lotes mesmo se um falhar
                        continue
                
                result["metrics_deleted"] = len(to_delete_ids)
                logger.info(f"Deletados {len(to_delete_ids)} registros de ad_metrics (não usados por outros packs)")
        except Exception as e:
            logger.warning(f"Erro ao ajustar ad_metrics ao deletar pack: {e}")

        # 3. Ajustar/deletar ads
        # Processar sempre, mesmo se ad_ids estiver vazio - usar pack_id no array pack_ids como filtro principal
        # Preserva dados que são usados por outros packs (remove apenas o pack_id do array se houver múltiplos)
        # Otimizado: processa em lotes durante a busca (streaming) para economizar memória
        try:
            def ads_filters(q):
                q = q.eq("user_id", user_id).filter("pack_ids", "cs", f"{{{pack_id}}}")
                return q
            
            # Processar em lotes durante a busca (streaming) - mais eficiente em memória
            to_update_ad_ids, to_delete_ad_ids, failed_ad_ids = _process_pack_deletion_in_batches(
                sb=sb,
                table_name="ads",
                id_field="ad_id",
                filters_func=ads_filters,
                pack_id=pack_id,
                user_id=user_id,
                batch_size=500
            )
            
            # IDs que não foram processados durante streaming (erros) - processar agora
            if to_update_ad_ids:
                batch_size = 500
                total_batches = (len(to_update_ad_ids) + batch_size - 1) // batch_size
                total_updated = 0
                
                logger.info(f"Processando {len(to_update_ad_ids)} registros de ads restantes em {total_batches} lote(s)")
                
                for i in range(0, len(to_update_ad_ids), batch_size):
                    batch = to_update_ad_ids[i:i + batch_size]
                    batch_num = (i // batch_size) + 1
                    
                    try:
                        rpc_result = sb.rpc(
                            "batch_remove_pack_id_from_arrays",
                            {
                                "p_user_id": user_id,
                                "p_pack_id": pack_id,
                                "p_table_name": "ads",
                                "p_ids_to_update": batch
                            }
                        ).execute()
                        
                        if rpc_result.data:
                            batch_updated = rpc_result.data.get("rows_updated", 0)
                            total_updated += batch_updated
                            if rpc_result.data.get("status") == "error":
                                logger.warning(f"Erro no batch update {batch_num}/{total_batches}: {rpc_result.data.get('error_message')}")
                        logger.debug(f"Batch update {batch_num}/{total_batches}: {len(batch)} IDs processados")
                    except Exception as batch_err:
                        logger.warning(f"Erro ao fazer batch update {batch_num}/{total_batches} de ads: {batch_err}")
                        continue
                
                logger.info(f"Atualizados {total_updated} registros de ads (removido pack_id, mantidos por outros packs)")
            
            if to_delete_ad_ids:
                # Deletar em lotes para evitar problemas com muitos IDs
                # IDs de ads são longos (ex: "120236981806920782" ~18-19 chars)
                # Reduzir batch_size para evitar URLs muito longas e timeout (~8KB / ReadTimeout)
                batch_size = 200  # Reduzido de 400 para 200 (alinhado a upsert/select)
                total_batches = (len(to_delete_ad_ids) + batch_size - 1) // batch_size
                
                logger.info(f"Deletando {len(to_delete_ad_ids)} registros de ads em {total_batches} lote(s) de até {batch_size} IDs")
                
                for i in range(0, len(to_delete_ad_ids), batch_size):
                    batch = to_delete_ad_ids[i:i + batch_size]
                    batch_num = (i // batch_size) + 1
                    
                    try:
                        sb.table("ads").delete().in_("ad_id", batch).eq("user_id", user_id).execute()
                        logger.debug(f"Lote de deleção {batch_num}/{total_batches}: {len(batch)} registros deletados")
                    except Exception as batch_err:
                        logger.warning(f"Erro ao deletar lote {batch_num}/{total_batches} de ads: {batch_err}")
                        # Continuar com próximos lotes mesmo se um falhar
                        continue
                
                result["ads_deleted"] = len(to_delete_ad_ids)
                logger.info(f"Deletados {len(to_delete_ad_ids)} registros de ads (não usados por outros packs)")
        except Exception as e:
            logger.warning(f"Erro ao ajustar ads ao deletar pack: {e}")

        # 4. Cleanup de storage (best-effort): remover apenas thumbs sem referência restante em ads
        try:
            deleted_files = _delete_unreferenced_thumb_paths(
                sb,
                user_id=user_id,
                candidate_paths=thumb_paths_candidates,
            )
            result["storage_thumbs_deleted"] = int(deleted_files or 0)
            result["storage_thumbs_kept"] = max(
                0,
                int(result["storage_thumbs_candidates"]) - int(result["storage_thumbs_deleted"]),
            )
            if deleted_files:
                logger.info(
                    f"[PACK_DELETION] Removidos {deleted_files} arquivos de thumbnails órfãos "
                    f"do storage para pack {pack_id}"
                )
        except Exception as e:
            logger.warning(f"[PACK_DELETION] Erro no cleanup de thumbnails do storage: {e}")
        
    except Exception as e:
        logger.exception(f"Erro ao deletar pack {pack_id}: {e}")
        raise
    
    logger.info(
        f"[PACK_DELETION] Resumo pack={pack_id}: pack_deleted={result.get('pack_deleted')}, "
        f"ads_deleted={result.get('ads_deleted')}, metrics_deleted={result.get('metrics_deleted')}, "
        f"storage_thumbs_candidates={result.get('storage_thumbs_candidates')}, "
        f"storage_thumbs_deleted={result.get('storage_thumbs_deleted')}, "
        f"storage_thumbs_kept={result.get('storage_thumbs_kept')}"
    )

    return result


# ===== Ad Accounts =====
def upsert_ad_accounts(user_jwt: str, ad_accounts: List[Dict[str, Any]], user_id: Optional[str]) -> None:
    """Upsert de contas de anúncios na tabela ad_accounts.

    Campos suportados na tabela:
    - id (PK)
    - user_id
    - name
    - account_status
    - user_tasks (text[])
    - instagram_accounts (jsonb)
    """
    if not user_id:
        logger.warning("Supabase upsert_ad_accounts skipped: missing user_id")
        return
    if not ad_accounts:
        return

    rows: List[Dict[str, Any]] = []
    for acc in ad_accounts:
        acc_id = str(acc.get("id") or "").strip()
        if not acc_id:
            continue
        
        # Garantir que user_tasks seja uma lista válida para text[]
        user_tasks = acc.get("user_tasks")
        if not isinstance(user_tasks, list):
            user_tasks = list(user_tasks) if user_tasks and hasattr(user_tasks, '__iter__') else []
        
        # Garantir que instagram_accounts seja uma lista válida para jsonb
        instagram_accounts = acc.get("instagram_accounts")
        if instagram_accounts is None:
            instagram_accounts = []
        elif not isinstance(instagram_accounts, list):
            instagram_accounts = [instagram_accounts] if instagram_accounts else []
        
        row = {
            "id": acc_id,
            "user_id": user_id,
            "name": acc.get("name"),
            "account_status": acc.get("account_status"),
            "user_tasks": user_tasks,
            "instagram_accounts": instagram_accounts,
            "updated_at": _now_iso(),
        }
        rows.append(row)

    if not rows:
        logger.info(f"upsert_ad_accounts: no valid ad accounts to save for user {user_id}")
        return

    try:
        sb = get_supabase_for_user(user_jwt)
        sb.table("ad_accounts").upsert(rows, on_conflict="id,user_id").execute()
        logger.info(f"Successfully saved {len(rows)} ad accounts to Supabase for user {user_id}")
    except Exception as e:
        logger.error(f"Error saving ad accounts to Supabase for user {user_id}: {e}", exc_info=True)
        raise  # Re-lança para que caller possa tratar se necessário


def list_ad_accounts(user_jwt: str, user_id: Optional[str]) -> List[Dict[str, Any]]:
    """Lista contas de anúncios do usuário a partir do Supabase."""
    if not user_id:
        return []
    sb = get_supabase_for_user(user_jwt)
    
    def filters(q):
        return q.eq("user_id", user_id).order("name", desc=False)
    
    return _fetch_all_paginated(sb, "ad_accounts", "*", filters)


def list_packs(user_jwt: str, user_id: Optional[str]) -> List[Dict[str, Any]]:
    """Lista packs do usuário a partir do Supabase, incluindo dados de integrações de planilhas."""
    if not user_id:
        return []
    sb = get_supabase_for_user(user_jwt)
    
    # Buscar packs
    def filters(q):
        return q.eq("user_id", user_id).order("created_at", desc=True)
    
    packs = _fetch_all_paginated(sb, "packs", "*", filters)
    
    # Buscar integrações dos packs que têm sheet_integration_id
    pack_ids_with_integration = [p["id"] for p in packs if p.get("sheet_integration_id")]
    if pack_ids_with_integration:
        # Buscar integrações por sheet_integration_id
        integration_ids = [p["sheet_integration_id"] for p in packs if p.get("sheet_integration_id")]
        if integration_ids:
            try:
                integrations = _fetch_all_paginated(
                    sb,
                    "ad_sheet_integrations",
                    "id, spreadsheet_id, spreadsheet_name, worksheet_title, connection_id, last_synced_at, last_sync_status, last_successful_sync_at",
                    lambda q: q.in_("id", integration_ids)
                )
                # Criar mapa id -> integration
                integrations_map = {str(int["id"]): int for int in integrations}
                
                # Enriquecer packs com dados da integração já persistidos.
                for pack in packs:
                    if not isinstance(pack, dict):
                        continue
                    sheet_integration_id = pack.get("sheet_integration_id")
                    if sheet_integration_id and str(sheet_integration_id) in integrations_map:
                        integration = integrations_map[str(sheet_integration_id)]
                        pack["sheet_integration"] = integration
            except Exception as e:
                logger.warning(f"[LIST_PACKS] Erro ao buscar integrações: {e}")
                # Continuar sem dados de integração se falhar
    
    return packs


def get_pack(
    user_jwt: str,
    pack_id: str,
    user_id: Optional[str],
    *,
    sb_client: Optional["Client"] = None,
) -> Optional[Dict[str, Any]]:
    """Busca um pack específico do Supabase, incluindo dados de integração de planilha."""
    if not user_id or not pack_id:
        return None
    sb = _get_sb(user_jwt, sb_client)
    res = sb.table("packs").select("*").eq("id", pack_id).eq("user_id", user_id).limit(1).execute()
    if res.data and len(res.data) > 0:
        pack = res.data[0]
        
        # Buscar integração se pack tiver sheet_integration_id
        sheet_integration_id = pack.get("sheet_integration_id")
        if sheet_integration_id:
            try:
                int_res = (
                    sb.table("ad_sheet_integrations")
                    .select("id, spreadsheet_id, spreadsheet_name, worksheet_title, connection_id, last_synced_at, last_sync_status, last_successful_sync_at")
                    .eq("id", sheet_integration_id)
                    .limit(1)
                    .execute()
                )
                if int_res.data and len(int_res.data) > 0:
                    integration = int_res.data[0]
                    pack["sheet_integration"] = integration
            except Exception as e:
                logger.warning(f"[GET_PACK] Erro ao buscar integração para pack {pack_id}: {e}")
                # Continuar sem dados de integração se falhar
        
        return pack
    return None


def update_pack_refresh_status(
    user_jwt: str,
    pack_id: str,
    user_id: Optional[str],
    last_refreshed_at: Optional[str] = None,
    refresh_status: str = "success",
    date_stop: Optional[str] = None,
    *,
    sb_client: Optional["Client"] = None,
) -> None:
    """Atualiza o status de refresh de um pack no Supabase.
    
    Args:
        user_jwt: JWT do Supabase do usuário
        pack_id: ID do pack a atualizar
        user_id: ID do usuário
        last_refreshed_at: Data de último refresh no formato YYYY-MM-DD (None = hoje)
        refresh_status: Status do refresh ('success', 'failed', 'running', etc.)
        date_stop: Data final do pack no formato YYYY-MM-DD (opcional, atualiza date_stop do pack)
    """
    if not user_id or not pack_id:
        logger.warning("[UPDATE_REFRESH_STATUS] Skipped: missing user_id or pack_id")
        return

    sb = _get_sb(user_jwt, sb_client)

    update_data = {
        "refresh_status": refresh_status,
    }

    # Só atualizar last_refreshed_at e updated_at quando o refresh completar com sucesso.
    # Atualizar em "running"/"failed"/"cancelled" corrompe o cálculo de since_last_refresh.
    if refresh_status == "success":
        if last_refreshed_at is None:
            last_refreshed_at = datetime.now(timezone.utc).date().strftime("%Y-%m-%d")
        update_data["last_refreshed_at"] = last_refreshed_at
        update_data["updated_at"] = _now_iso()
    
    # Atualizar date_stop se fornecido (útil para manter o pack sincronizado com a data de atualização)
    if date_stop:
        update_data["date_stop"] = date_stop
    
    try:
        sb.table("packs").update(update_data).eq("id", pack_id).eq("user_id", user_id).execute()
        log_msg = f"[UPDATE_REFRESH_STATUS] ✓ Pack {pack_id} atualizado - status={refresh_status}"
        if last_refreshed_at is not None:
            log_msg += f", last_refreshed_at={last_refreshed_at}"
        if date_stop:
            log_msg += f", date_stop={date_stop}"
        logger.info(log_msg)
    except Exception as e:
        logger.exception(f"[UPDATE_REFRESH_STATUS] ✗ Erro ao atualizar pack {pack_id}: {e}")
        raise


def update_pack_auto_refresh(
    user_jwt: str,
    pack_id: str,
    user_id: Optional[str],
    auto_refresh: bool,
) -> None:
    """Atualiza o campo auto_refresh de um pack no Supabase.
    
    Args:
        user_jwt: JWT do Supabase do usuário
        pack_id: ID do pack a atualizar
        user_id: ID do usuário
        auto_refresh: Valor booleano para auto_refresh
    """
    if not user_id or not pack_id:
        logger.warning("[UPDATE_AUTO_REFRESH] Skipped: missing user_id or pack_id")
        return
    
    sb = get_supabase_for_user(user_jwt)
    
    update_data = {
        "auto_refresh": auto_refresh,
        "updated_at": _now_iso(),
    }
    
    try:
        sb.table("packs").update(update_data).eq("id", pack_id).eq("user_id", user_id).execute()
        logger.info(f"[UPDATE_AUTO_REFRESH] ✓ Pack {pack_id} atualizado - auto_refresh={auto_refresh}")
    except Exception as e:
        logger.exception(f"[UPDATE_AUTO_REFRESH] ✗ Erro ao atualizar pack {pack_id}: {e}")
        raise


def check_pack_name_exists(
    user_jwt: str,
    user_id: str,
    name: str,
    exclude_pack_id: Optional[str] = None,
    *,
    sb_client: Optional["Client"] = None,
) -> bool:
    """Verifica se já existe um pack com o mesmo nome para o usuário.
    
    Args:
        user_jwt: JWT do Supabase do usuário
        user_id: ID do usuário
        name: Nome do pack a verificar
        exclude_pack_id: ID do pack a excluir da verificação (útil para atualizações)
    
    Returns:
        True se já existe um pack com o mesmo nome, False caso contrário
    """
    normalized_name = normalize_pack_name(name)
    if not user_id or not normalized_name:
        return False
    
    try:
        sb = _get_sb(user_jwt, sb_client)
        query = sb.table("packs").select("id").eq("user_id", user_id).ilike("name", normalized_name)
        
        # Excluir o pack atual se for uma atualização
        if exclude_pack_id:
            query = query.neq("id", exclude_pack_id)
        
        res = query.limit(1).execute()
        exists = res.data and len(res.data) > 0
        logger.info(f"[CHECK_PACK_NAME] Nome '{normalized_name}' {'já existe' if exists else 'disponível'} para user_id={user_id}")
        return exists
    except Exception as e:
        logger.exception(f"[CHECK_PACK_NAME] ✗ Erro ao verificar nome do pack: {e}")
        # Em caso de erro, retornar False para não bloquear a operação
        # Mas logar o erro para investigação
        return False


def update_pack_name(
    user_jwt: str,
    pack_id: str,
    user_id: Optional[str],
    name: str,
) -> None:
    """Atualiza o campo name de um pack no Supabase.
    
    Args:
        user_jwt: JWT do Supabase do usuário
        pack_id: ID do pack a atualizar
        user_id: ID do usuário
        name: Novo nome do pack
    
    Raises:
        ValueError: Se o nome estiver vazio ou se já existir outro pack com o mesmo nome
    """
    if not user_id or not pack_id:
        logger.warning("[UPDATE_PACK_NAME] Skipped: missing user_id or pack_id")
        return
    
    normalized_name = normalize_pack_name(name)
    if not normalized_name:
        raise ValueError("Nome do pack não pode ser vazio")
    
    # Verificar se já existe outro pack com o mesmo nome
    if check_pack_name_exists(user_jwt, user_id, normalized_name, exclude_pack_id=pack_id):
        raise PackNameConflictError(f"Já existe um pack com o nome '{normalized_name}'")
    
    sb = get_supabase_for_user(user_jwt)
    
    # Não atualizar updated_at ao renomear - essa data deve ser exclusiva para atualizações de métricas
    update_data = {
        "name": normalized_name,
    }
    
    try:
        sb.table("packs").update(update_data).eq("id", pack_id).eq("user_id", user_id).execute()
        logger.info(f"[UPDATE_PACK_NAME] ✓ Pack {pack_id} atualizado - name={normalized_name}")
    except Exception as e:
        if _is_pack_name_unique_violation(e):
            raise PackNameConflictError(f"Já existe um pack com o nome '{normalized_name}'") from e
        logger.exception(f"[UPDATE_PACK_NAME] ✗ Erro ao atualizar pack {pack_id}: {e}")
        raise


def get_ads_for_pack(user_jwt: str, pack: Dict[str, Any], user_id: Optional[str]) -> List[Dict[str, Any]]:
    """Busca ads relacionados a um pack baseado nos parâmetros do pack.
    
    Nota: Os ads são filtrados por:
    - user_id
    - date_start e date_stop (via ad_metrics)
    - filters do pack (aplicados em memória)
    """
    if not user_id or not pack:
        return []
    
    date_start = pack.get("date_start")
    date_stop = pack.get("date_stop")
    
    sb = get_supabase_for_user(user_jwt)
    ads = []
    
    try:
        # Buscar ad_ids que têm métricas no período do pack
        if date_start and date_stop:
            def metrics_filters(q):
                return q.eq("user_id", user_id).gte("date", date_start).lte("date", date_stop)
            
            metrics_rows = _fetch_all_paginated(
                sb,
                "ad_metrics",
                "ad_id",
                metrics_filters
            )
            
            ad_ids = list(set([m.get("ad_id") for m in metrics_rows if m.get("ad_id")]))
            
            if ad_ids:
                # Processar ad_ids em lotes para evitar URLs muito longas e timeout
                # IDs de ads são longos (ex: "120236981806920782" ~18-19 chars)
                batch_size = 200  # Reduzido de 400 para 200 (alinhado a outros selects)
                all_ads = []

                logger.info(f"[GET_ADS_FOR_PACK] Processando {len(ad_ids)} ad_ids em lotes de {batch_size}")
                
                for i in range(0, len(ad_ids), batch_size):
                    batch_ad_ids = ad_ids[i:i + batch_size]
                    
                    def ads_filters(q):
                        return q.eq("user_id", user_id).in_("ad_id", batch_ad_ids)
                    
                    batch_ads = _fetch_all_paginated(
                        sb,
                        "ads",
                        "*",
                        ads_filters
                    )
                    
                    all_ads.extend(batch_ads)
                    logger.debug(f"[GET_ADS_FOR_PACK] Lote {i // batch_size + 1}: {len(batch_ads)} ads encontrados")
                
                ads = all_ads
                logger.info(f"[GET_ADS_FOR_PACK] Total de {len(ads)} ads encontrados após processar todos os lotes")
            else:
                ads = []
        else:
            # Se não tem período, buscar todos os ads do usuário
            def all_ads_filters(q):
                return q.eq("user_id", user_id)
            
            ads = _fetch_all_paginated(
                sb,
                "ads",
                "*",
                all_ads_filters
            )
        
        # Aplicar filtros do pack em memória (simplificado - pode ser otimizado depois)
        filters = pack.get("filters") or []
        if filters and ads:
            # Implementação básica de filtros
            filtered_ads = []
            for ad in ads:
                matches = True
                for filter_rule in filters:
                    field = filter_rule.get("field", "")
                    operator = filter_rule.get("operator", "")
                    value = filter_rule.get("value", "").lower()
                    
                    ad_value = ""
                    if field == "campaign.name":
                        ad_value = str(ad.get("campaign_name", "")).lower()
                    elif field == "adset.name":
                        ad_value = str(ad.get("adset_name", "")).lower()
                    elif field == "ad.name":
                        ad_value = str(ad.get("ad_name", "")).lower()
                    
                    if operator == "CONTAIN" and value not in ad_value:
                        matches = False
                        break
                    elif operator == "EQUALS" and ad_value != value:
                        matches = False
                        break
                
                if matches:
                    filtered_ads.append(ad)
            
            ads = filtered_ads

        ads = [_attach_storage_thumbnail(ad) for ad in ads]
        
    except Exception as e:
        logger.error(f"Erro ao buscar ads para pack {pack.get('id')}: {e}")
        return []
    
    return ads


def get_pack_thumbnail_cache(user_jwt: str, pack: Dict[str, Any], user_id: Optional[str]) -> List[Dict[str, Any]]:
    """Return lightweight Storage thumbnail rows for the ads explicitly attached to a pack."""
    if not user_id:
        return []

    ad_ids = [
        str(ad_id).strip()
        for ad_id in (pack.get("ad_ids") or [])
        if str(ad_id).strip()
    ]
    if not ad_ids:
        return []

    sb = get_supabase_for_user(user_jwt)
    rows: List[Dict[str, Any]] = []
    batch_size = 500

    for i in range(0, len(ad_ids), batch_size):
        batch_ids = ad_ids[i : i + batch_size]
        res = (
            sb.table("ads")
            .select("ad_id,thumb_storage_path,primary_video_id,media_type,creative_video_id")
            .eq("user_id", user_id)
            .in_("ad_id", batch_ids)
            .execute()
        )

        for row in res.data or []:
            storage_path = str(row.get("thumb_storage_path") or "").strip()
            rows.append({
                "ad_id": row.get("ad_id"),
                "thumb_storage_path": storage_path or None,
                "thumbnail": build_public_storage_url(DEFAULT_BUCKET, storage_path) if storage_path else None,
            })

    return rows


# ============ TRANSCRIPTION ============

# Frase que indica falha permanente (vídeo sem áudio/fala) — não retentar
_NO_SPOKEN_AUDIO_PHRASE = "no spoken audio"


def _is_no_audio_failure(metadata: Any) -> bool:
    """True se metadata indica erro de vídeo sem áudio/fala (falha permanente)."""
    if not metadata or not isinstance(metadata, dict):
        return False
    msg = str(metadata.get("error_message") or "").strip().lower()
    return _NO_SPOKEN_AUDIO_PHRASE in msg


def get_existing_transcriptions(
    user_jwt: str,
    user_id: str,
    ad_names: List[str],
) -> Dict[str, str]:
    """Retorna mapa {ad_name: status} para ad_names que devem ser ignorados ao transcrever.

    Inclui: completed, processing, pending e failed com erro de 'no spoken audio'
    (vídeo sem áudio/fala — falha permanente). Outros failed são excluídos para permitir retry.
    """
    if not user_id or not ad_names:
        return {}

    sb = get_supabase_for_user(user_jwt)
    result: Dict[str, str] = {}
    batch_size = 200  # Reduzido de 400 para alinhar a outros selects em lote

    for i in range(0, len(ad_names), batch_size):
        batch = ad_names[i : i + batch_size]
        try:
            rows = (
                sb.table("ad_transcriptions")
                .select("ad_name,status,metadata")
                .eq("user_id", user_id)
                .in_("ad_name", batch)
                .execute()
            ).data or []
            for row in rows:
                name = str(row.get("ad_name") or "").strip()
                if not name:
                    continue
                status = str(row.get("status") or "").strip()
                if status in ("completed", "processing", "pending"):
                    result[name] = status
                elif status == "failed" and _is_no_audio_failure(row.get("metadata")):
                    result[name] = status
        except Exception as e:
            logger.warning(f"[TRANSCRIPTION] Erro ao consultar transcriptions existentes: {e}")

    return result


def _sync_ads_transcription_links(
    user_jwt: str,
    user_id: str,
    ad_id_name_pairs: List[Tuple[str, str]],
    *,
    sb_client: Optional["Client"] = None,
) -> None:
    """Atualiza ads.transcription_id e ad_transcriptions.ad_ids quando ads são upsertados."""
    if not user_id or not ad_id_name_pairs:
        return
    sb = _get_sb(user_jwt, sb_client)
    ad_name_to_ad_ids: Dict[str, List[str]] = {}
    for ad_id, ad_name in ad_id_name_pairs:
        aid = str(ad_id).strip()
        aname = str(ad_name).strip()
        if not aid or not aname:
            continue
        ad_name_to_ad_ids.setdefault(aname, []).append(aid)
    if not ad_name_to_ad_ids:
        return
    try:
        for ad_name, batch_ad_ids in ad_name_to_ad_ids.items():
            tr = (
                sb.table("ad_transcriptions")
                .select("id, ad_ids")
                .eq("user_id", user_id)
                .eq("ad_name", ad_name)
                .limit(1)
                .execute()
            )
            if not tr.data or len(tr.data) == 0:
                continue
            rec = tr.data[0]
            transcription_id = rec.get("id")
            if not transcription_id:
                continue
            existing = rec.get("ad_ids") or []
            merged = list(set(existing + batch_ad_ids))
            sb.table("ad_transcriptions").update(
                {"ad_ids": merged, "updated_at": _now_iso()}
            ).eq("id", transcription_id).eq("user_id", user_id).execute()
            for i in range(0, len(batch_ad_ids), 200):
                batch = batch_ad_ids[i : i + 200]
                sb.table("ads").update(
                    {"transcription_id": str(transcription_id), "updated_at": _now_iso()}
                ).eq("user_id", user_id).in_("ad_id", batch).execute()
        logger.debug(f"[UPSERT_ADS] Sync transcription links para {len(ad_name_to_ad_ids)} ad_names")
    except Exception as e:
        logger.warning(f"[UPSERT_ADS] Erro em _sync_ads_transcription_links: {e}")
        raise


def _sync_transcription_links_after_upsert(
    user_jwt: str,
    user_id: str,
    ad_name: str,
) -> None:
    """Atualiza ads.transcription_id e ad_transcriptions.ad_ids após upsert de transcrição."""
    if not user_id or not ad_name:
        return
    sb = get_supabase_for_user(user_jwt)
    try:
        tr = (
            sb.table("ad_transcriptions")
            .select("id")
            .eq("user_id", user_id)
            .eq("ad_name", ad_name)
            .limit(1)
            .execute()
        )
        if not tr.data or len(tr.data) == 0:
            return
        transcription_id = tr.data[0].get("id")
        if not transcription_id:
            return
        ads_rows = (
            sb.table("ads")
            .select("ad_id")
            .eq("user_id", user_id)
            .eq("ad_name", ad_name)
            .execute()
        )
        ad_ids = [str(r.get("ad_id", "")).strip() for r in (ads_rows.data or []) if r.get("ad_id")]
        if not ad_ids:
            sb.table("ad_transcriptions").update(
                {"ad_ids": ad_ids, "updated_at": _now_iso()}
            ).eq("id", transcription_id).eq("user_id", user_id).execute()
            return
        sb.table("ad_transcriptions").update(
            {"ad_ids": ad_ids, "updated_at": _now_iso()}
        ).eq("id", transcription_id).eq("user_id", user_id).execute()
        batch_size = 200
        for i in range(0, len(ad_ids), batch_size):
            batch = ad_ids[i : i + batch_size]
            sb.table("ads").update(
                {"transcription_id": str(transcription_id), "updated_at": _now_iso()}
            ).eq("user_id", user_id).in_("ad_id", batch).execute()
        logger.debug(f"[TRANSCRIPTION] Sync links: ad_name={ad_name!r} ad_ids={len(ad_ids)}")
    except Exception as e:
        logger.warning(f"[TRANSCRIPTION] Erro ao sync transcription links: {e}")


def upsert_transcription(
    user_jwt: str,
    user_id: str,
    ad_name: str,
    status: str,
    full_text: Optional[str] = None,
    timestamped_text: Optional[Any] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> None:
    """Insere ou atualiza transcrição na tabela ad_transcriptions."""
    if not user_id or not ad_name:
        return

    sb = get_supabase_for_user(user_jwt)
    row: Dict[str, Any] = {
        "user_id": user_id,
        "ad_name": ad_name,
        "status": status,
        "full_text": full_text,
        "timestamped_text": timestamped_text,
        "metadata": metadata,
        "updated_at": _now_iso(),
    }
    try:
        sb.table("ad_transcriptions").upsert(
            row, on_conflict="user_id,ad_name"
        ).execute()
        logger.info(f"[TRANSCRIPTION] Upsert ok: ad_name={ad_name!r} status={status}")
        try:
            _sync_transcription_links_after_upsert(user_jwt, user_id, ad_name)
        except Exception as sync_err:
            logger.warning(f"[TRANSCRIPTION] Sync links falhou (best-effort): {sync_err}")
    except Exception as e:
        logger.error(f"[TRANSCRIPTION] Erro ao upsert transcription ad_name={ad_name!r}: {e}")
        raise


def get_transcription_by_id(
    user_jwt: str,
    user_id: str,
    transcription_id: str,
) -> Optional[Dict[str, Any]]:
    """Busca transcrição por user_id + transcription_id. Retorna None se não existir."""
    if not user_id or not transcription_id:
        return None
    sb = get_supabase_for_user(user_jwt)
    try:
        res = (
            sb.table("ad_transcriptions")
            .select("*")
            .eq("id", transcription_id)
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
        if res.data and len(res.data) > 0:
            return res.data[0]
        return None
    except Exception as e:
        logger.warning(f"[TRANSCRIPTION] Erro ao buscar transcription por id: {e}")
        return None


def get_transcription(
    user_jwt: str,
    user_id: str,
    ad_name: str,
) -> Optional[Dict[str, Any]]:
    """Busca transcrição por user_id + ad_name. Retorna None se não existir."""
    if not user_id or not ad_name:
        return None

    sb = get_supabase_for_user(user_jwt)
    try:
        res = (
            sb.table("ad_transcriptions")
            .select("*")
            .eq("user_id", user_id)
            .eq("ad_name", ad_name)
            .limit(1)
            .execute()
        )
        if res.data and len(res.data) > 0:
            return res.data[0]
        return None
    except Exception as e:
        logger.warning(f"[TRANSCRIPTION] Erro ao buscar transcription: {e}")
        return None
