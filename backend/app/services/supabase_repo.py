from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Tuple
from datetime import datetime, timedelta, date

from app.core.supabase_client import get_supabase_for_user


logger = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.utcnow().isoformat(timespec="seconds") + "Z"


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


def upsert_ads(user_jwt: str, formatted_ads: List[Dict[str, Any]], user_id: Optional[str], pack_id: Optional[str] = None) -> None:
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
        
        row = {
            "ad_id": ad_id,
            "user_id": user_id,
            "account_id": ad.get("account_id"),
            "campaign_id": ad.get("campaign_id"),
            "campaign_name": ad.get("campaign_name"),
            "adset_id": ad.get("adset_id"),
            "adset_name": ad.get("adset_name"),
            "ad_name": ad.get("ad_name"),
            "effective_status": creative.get("status"),
            "creative": creative,
            "creative_video_id": creative.get("video_id"),
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

    sb = get_supabase_for_user(user_jwt)
    
    total_rows = len(rows)
    logger.info(f"[UPSERT_ADS] Processando {total_rows} registros de ads")

    # Se pack_id foi fornecido, fazer merge de pack_ids com estado existente
    if pack_id and rows:
        ad_ids = [r["ad_id"] for r in rows]
        existing_map: Dict[str, List[str]] = {}
        
        # Processar busca de pack_ids existentes em lotes para evitar problemas com muitos IDs
        # IDs de ads são longos (ex: "120236981806920782" ~18-19 chars)
        # Reduzir batch_size para evitar URLs muito longas que excedem limite do Supabase (~8KB)
        # Com IDs de ~19 caracteres, 400 IDs = ~7.600 chars na URL (seguro para limite de ~8KB)
        batch_size_lookup = 400  # Reduzido de 1000 para 400 devido ao tamanho dos ad_ids
        try:
            for i in range(0, len(ad_ids), batch_size_lookup):
                batch_ids = ad_ids[i:i + batch_size_lookup]
                
                def ads_filters(q):
                    return q.eq("user_id", user_id).in_("ad_id", batch_ids)
                
                existing_rows = _fetch_all_paginated(
                    sb,
                    "ads",
                    "ad_id, pack_ids",
                    ads_filters
                )
                
                for item in existing_rows:
                    existing_map[str(item.get("ad_id"))] = (item.get("pack_ids") or [])
            
            logger.info(f"[UPSERT_ADS] Encontrados {len(existing_map)} registros existentes para merge de pack_ids")
        except Exception as e:
            logger.warning(f"[UPSERT_ADS] Erro ao buscar pack_ids existentes, continuando sem merge: {e}")
            existing_map = {}

        for row in rows:
            existing_pack_ids = existing_map.get(row["ad_id"], []) or []
            # garantir tipos string -> uuid no banco; aqui mantemos como strings
            if pack_id not in existing_pack_ids:
                existing_pack_ids.append(pack_id)
            row["pack_ids"] = existing_pack_ids

    # Upsert em lotes para evitar timeout em grandes volumes de dados
    # Tamanho de lote: 1000 registros (maior que ad_metrics pois ads não têm dados por data)
    # Cada ad é único (deduplicado), então volume geralmente menor
    batch_size = 1000
    total_batches = (total_rows + batch_size - 1) // batch_size
    
    for batch_idx in range(0, total_rows, batch_size):
        batch = rows[batch_idx:batch_idx + batch_size]
        batch_num = (batch_idx // batch_size) + 1
        
        try:
            sb.table("ads").upsert(batch, on_conflict="ad_id").execute()
            logger.info(f"[UPSERT_ADS] Lote {batch_num}/{total_batches} processado com sucesso ({len(batch)} registros)")
        except Exception as e:
            logger.error(f"[UPSERT_ADS] Erro ao processar lote {batch_num}/{total_batches}: {e}")
            # Re-lançar para que o caller possa tratar o erro
            raise
    
    logger.info(f"[UPSERT_ADS] ✓ Todos os {total_rows} registros processados com sucesso em {total_batches} lote(s)")


def upsert_ad_metrics(user_jwt: str, formatted_ads: List[Dict[str, Any]], user_id: Optional[str], pack_id: Optional[str] = None) -> None:
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
        hook_raw = _hook_at_3_from_curve(curve)  # hook já vem normalizado em decimal (0-1) pela função
        # Garantir que hook está em decimal (0-1): se > 1, assume que está em 0-100 e normaliza
        hook = hook_raw / 100.0 if hook_raw > 1.0 else hook_raw
        thruplay_rate = _safe_div(float(thruplays), float(plays)) if plays > 0 else 0.0  # decimal (0-1)
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
            "hold_rate": hold_rate,
            "connect_rate": connect_rate,
            "profile_ctr": float(ad.get("profile_ctr") or 0),
            "raw_data": ad,
            "updated_at": _now_iso(),
        }
        rows.append(row)

    if not rows:
        return

    sb = get_supabase_for_user(user_jwt)
    
    total_rows = len(rows)
    logger.info(f"[UPSERT_AD_METRICS] Processando {total_rows} registros de métricas")

    # Merge de pack_ids por id (metric_id) se pack_id fornecido
    if pack_id and rows:
        metric_ids = [r["id"] for r in rows]
        existing_map: Dict[str, List[str]] = {}
        
        # Processar busca de pack_ids existentes em lotes para evitar problemas com muitos IDs
        # IDs de métricas são compostos e longos (ex: "2025-11-10-120236981806920782" ~30 chars)
        # Reduzir batch_size para evitar URLs muito longas que excedem limite do Supabase (~8KB)
        # Com IDs de ~30 caracteres, 200 IDs = ~6000 chars na URL (seguro para limite de ~8KB)
        batch_size_lookup = 200  # Reduzido de 1000 para 200 devido ao tamanho dos IDs compostos
        total_lookup_batches = (len(metric_ids) + batch_size_lookup - 1) // batch_size_lookup
        
        logger.info(f"[UPSERT_AD_METRICS] Buscando pack_ids existentes em {total_lookup_batches} lote(s) de até {batch_size_lookup} IDs")
        
        try:
            for i in range(0, len(metric_ids), batch_size_lookup):
                batch_ids = metric_ids[i:i + batch_size_lookup]
                batch_num = (i // batch_size_lookup) + 1
                
                def metrics_filters(q):
                    return q.eq("user_id", user_id).in_("id", batch_ids)
                
                try:
                    existing_rows = _fetch_all_paginated(
                        sb,
                        "ad_metrics",
                        "id, pack_ids",
                        metrics_filters
                    )
                    
                    for item in existing_rows:
                        existing_map[str(item.get("id"))] = (item.get("pack_ids") or [])
                    
                    logger.debug(f"[UPSERT_AD_METRICS] Lote de lookup {batch_num}/{total_lookup_batches}: {len(existing_rows)} registros encontrados")
                except Exception as batch_err:
                    logger.warning(f"[UPSERT_AD_METRICS] Erro ao buscar pack_ids no lote {batch_num}/{total_lookup_batches}: {batch_err}")
                    # Continuar com próximos lotes mesmo se um falhar
                    continue
            
            logger.info(f"[UPSERT_AD_METRICS] Encontrados {len(existing_map)} registros existentes para merge de pack_ids")
        except Exception as e:
            logger.warning(f"[UPSERT_AD_METRICS] Erro geral ao buscar pack_ids existentes, continuando sem merge: {e}")
            existing_map = {}

        for row in rows:
            existing_pack_ids = existing_map.get(row["id"], []) or []
            if pack_id not in existing_pack_ids:
                existing_pack_ids.append(pack_id)
            row["pack_ids"] = existing_pack_ids

    # Upsert em lotes para evitar timeout em grandes volumes de dados
    # Tamanho de lote: 500 registros (ajustado para balancear performance e evitar timeout)
    # JSONB fields (actions, conversions, etc.) podem ser grandes, então lote menor é mais seguro
    batch_size = 500
    total_batches = (total_rows + batch_size - 1) // batch_size
    
    for batch_idx in range(0, total_rows, batch_size):
        batch = rows[batch_idx:batch_idx + batch_size]
        batch_num = (batch_idx // batch_size) + 1
        
        try:
            sb.table("ad_metrics").upsert(batch, on_conflict="id").execute()
            logger.info(f"[UPSERT_AD_METRICS] Lote {batch_num}/{total_batches} processado com sucesso ({len(batch)} registros)")
        except Exception as e:
            logger.error(f"[UPSERT_AD_METRICS] Erro ao processar lote {batch_num}/{total_batches}: {e}")
            # Re-lançar para que o caller possa tratar o erro
            raise
    
    logger.info(f"[UPSERT_AD_METRICS] ✓ Todos os {total_rows} registros processados com sucesso em {total_batches} lote(s)")


def verify_metrics_persisted(
    user_jwt: str, 
    pack_id: str, 
    user_id: Optional[str],
    expected_min_count: int = 1,
    max_retries: int = 5,
    initial_delay: float = 0.2
) -> Tuple[bool, int]:
    """Verifica se as métricas foram realmente persistidas no banco.
    
    Args:
        user_jwt: JWT do Supabase do usuário
        pack_id: ID do pack
        user_id: ID do usuário
        expected_min_count: Número mínimo de métricas esperadas
        max_retries: Número máximo de tentativas
        initial_delay: Delay inicial em segundos (dobra a cada retry)
    
    Returns:
        Tuple[bool, int]: (sucesso, número_de_métricas_encontradas)
    """
    if not user_id or not pack_id:
        return False, 0
    
    sb = get_supabase_for_user(user_jwt)
    delay = initial_delay
    
    for attempt in range(max_retries):
        try:
            # Buscar métricas do pack
            def metrics_filters(q):
                return q.eq("user_id", user_id).filter("pack_ids", "cs", f"{{{pack_id}}}")
            
            metrics = _fetch_all_paginated(
                sb,
                "ad_metrics",
                "id",
                metrics_filters
            )
            
            count = len(metrics) if metrics else 0
            
            if count >= expected_min_count:
                logger.info(f"[VERIFY_METRICS] ✓ Métricas verificadas: {count} encontradas para pack {pack_id} (tentativa {attempt + 1})")
                return True, count
            
            # Se não encontrou o suficiente e não é a última tentativa, aguardar
            if attempt < max_retries - 1:
                logger.debug(f"[VERIFY_METRICS] Métricas ainda não disponíveis: {count} encontradas, esperando {delay}s...")
                import time
                time.sleep(delay)
                delay *= 2  # Backoff exponencial
        
        except Exception as e:
            logger.warning(f"[VERIFY_METRICS] Erro ao verificar métricas (tentativa {attempt + 1}): {e}")
            if attempt < max_retries - 1:
                import time
                time.sleep(delay)
                delay *= 2
    
    logger.warning(f"[VERIFY_METRICS] ✗ Não foi possível verificar métricas após {max_retries} tentativas")
    return False, 0


def update_pack_stats(user_jwt: str, pack_id: str, stats: Dict[str, Any], user_id: Optional[str]) -> None:
    if not user_id:
        return
    sb = get_supabase_for_user(user_jwt)
    sb.table("packs").update({"stats": stats, "updated_at": _now_iso()}).eq("id", pack_id).eq("user_id", user_id).execute()


def update_pack_ad_ids(user_jwt: str, pack_id: str, ad_ids: List[str], user_id: Optional[str]) -> None:
    """Atualiza packs.ad_ids com a lista fornecida (deduplicada).
    """
    if not user_id or not pack_id:
        return
    sb = get_supabase_for_user(user_jwt)
    unique_ad_ids = sorted(list({str(a) for a in (ad_ids or [])}))
    sb.table("packs").update({"ad_ids": unique_ad_ids, "updated_at": _now_iso()}).eq("id", pack_id).eq("user_id", user_id).execute()


def calculate_pack_stats(user_jwt: str, pack_id: str, user_id: Optional[str]) -> Dict[str, Any]:
    """Calcula estatísticas agregadas de um pack baseado nas métricas de ad_metrics.
    
    Filtra métricas por pack_ids (não por período) para incluir todos os dados do pack,
    incluindo dados de refresh que podem ter datas diferentes do período original.
    
    Returns:
        Dict com stats: {
            "totalAds": int,
            "uniqueAds": int,
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
        }
    """
    if not user_id:
        return {}
    
    sb = get_supabase_for_user(user_jwt)
    
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
        try:
            # Tentar usar filtro direto com contains (PostgREST @> operator)
            def metrics_filters(q):
                return q.eq("user_id", user_id).filter("pack_ids", "cs", f"{{{pack_id}}}")
            
            metrics = _fetch_all_paginated(
                sb,
                "ad_metrics",
                "ad_id, campaign_id, adset_id, spend, clicks, impressions, reach, inline_link_clicks, video_total_plays, video_total_thruplays, cpm, ctr, frequency",
                metrics_filters
            )
        except Exception as filter_error:
            # Fallback: buscar todas métricas do usuário e filtrar em Python
            logger.warning(f"[CALCULATE_PACK_STATS] Erro ao usar filtro pack_ids, usando fallback: {filter_error}")
            
            def all_metrics_filters(q):
                return q.eq("user_id", user_id)
            
            all_metrics = _fetch_all_paginated(
                sb,
                "ad_metrics",
                "ad_id, campaign_id, adset_id, spend, clicks, impressions, reach, inline_link_clicks, video_total_plays, video_total_thruplays, cpm, ctr, frequency, pack_ids",
                all_metrics_filters
            )
            
            # Filtrar em Python
            metrics = [
                m for m in all_metrics 
                if m.get("pack_ids") and pack_id in (m.get("pack_ids") or [])
            ]
        
        if not metrics:
            return {
                "totalAds": 0,
                "uniqueAds": 0,
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
            }
        
        # Agregar métricas
        unique_ad_ids = set()
        unique_campaign_ids = set()
        unique_adset_ids = set()
        
        total_spend = 0.0
        total_clicks = 0
        total_impressions = 0
        total_reach = 0
        total_inline_link_clicks = 0
        total_plays = 0
        total_thruplays = 0
        
        for metric in metrics:
            ad_id = metric.get("ad_id")
            campaign_id = metric.get("campaign_id")
            adset_id = metric.get("adset_id")
            
            if ad_id:
                unique_ad_ids.add(str(ad_id))
            if campaign_id:
                unique_campaign_ids.add(str(campaign_id))
            if adset_id:
                unique_adset_ids.add(str(adset_id))
            
            # Somar valores numéricos
            total_spend += float(metric.get("spend", 0) or 0)
            total_clicks += int(metric.get("clicks", 0) or 0)
            total_impressions += int(metric.get("impressions", 0) or 0)
            total_reach += int(metric.get("reach", 0) or 0)
            total_inline_link_clicks += int(metric.get("inline_link_clicks", 0) or 0)
            total_plays += int(metric.get("video_total_plays", 0) or 0)
            total_thruplays += int(metric.get("video_total_thruplays", 0) or 0)
        
        # Calcular métricas derivadas
        calculated_ctr = (total_clicks / total_impressions) if total_impressions > 0 else 0.0
        calculated_cpm = (total_spend * 1000 / total_impressions) if total_impressions > 0 else 0.0
        calculated_frequency = (total_impressions / total_reach) if total_reach > 0 else 0.0
        
        stats = {
            "totalAds": len(metrics),
            "uniqueAds": len(unique_ad_ids),
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
        }
        
        logger.info(f"[CALCULATE_PACK_STATS] Stats calculados para pack {pack_id}: {stats}")
        return stats
        
    except Exception as e:
        logger.exception(f"[CALCULATE_PACK_STATS] Erro ao calcular stats do pack {pack_id}: {e}")
        return {}


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
    logger.info(f"[UPSERT_PACK] Iniciando upsert_pack - user_id={user_id}, name={name}, pack_id={pack_id}")
    
    if not user_id:
        logger.warning("[UPSERT_PACK] ✗ Skipped: missing user_id")
        return None
    
    if not name:
        logger.warning("[UPSERT_PACK] ✗ Skipped: missing name")
        return None
    
    # Usar today_local se fornecido, senão usar date_stop como fallback (já vem do frontend no fuso local)
    # Nunca usar UTC para datas lógicas
    today_str = today_local if today_local else date_stop
    
    try:
        sb = get_supabase_for_user(user_jwt)
        logger.info(f"[UPSERT_PACK] Cliente Supabase obtido com sucesso")
    except Exception as e:
        logger.error(f"[UPSERT_PACK] ✗ Erro ao obter cliente Supabase: {e}")
        return None
    
    pack_data = {
        "user_id": user_id,
        "adaccount_id": adaccount_id,
        "name": name,
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
            logger.info(f"[UPSERT_PACK] Executando insert na tabela packs...")
            res = sb.table("packs").insert(pack_data).execute()
            logger.info(f"[UPSERT_PACK] Insert executado. Resposta: data={res.data is not None}, len={len(res.data) if res.data else 0}")
            if res.data:
                logger.info(f"[UPSERT_PACK] Dados retornados: {res.data}")
            else:
                logger.warning(f"[UPSERT_PACK] Nenhum dado retornado do insert. Verificar RLS ou constraints.")
                # Tentar buscar o pack criado para confirmar se foi salvo
                try:
                    check_res = sb.table("packs").select("id, name").eq("user_id", user_id).eq("name", name).order("created_at", desc=True).limit(1).execute()
                    if check_res.data:
                        logger.info(f"[UPSERT_PACK] Pack encontrado após insert: {check_res.data[0].get('id')}")
                        return check_res.data[0].get("id")
                except Exception as check_err:
                    logger.error(f"[UPSERT_PACK] Erro ao verificar pack criado: {check_err}")
        
        if res.data and len(res.data) > 0:
            pack_created_id = res.data[0].get("id")
            logger.info(f"[UPSERT_PACK] ✓ Pack {'atualizado' if pack_id else 'criado'} no Supabase: {pack_created_id} (nome: {name})")
            return pack_created_id
        else:
            logger.error(f"[UPSERT_PACK] ✗ Pack {'criado' if not pack_id else 'atualizado'} mas nenhum dado retornado do Supabase")
            logger.error(f"[UPSERT_PACK] Response object: {res}")
            logger.error(f"[UPSERT_PACK] Response type: {type(res)}")
            if hasattr(res, 'data'):
                logger.error(f"[UPSERT_PACK] Response.data: {res.data}")
            if hasattr(res, 'status_code'):
                logger.error(f"[UPSERT_PACK] Response.status_code: {res.status_code}")
            return None
    except Exception as e:
        logger.exception(f"[UPSERT_PACK] ✗ Erro ao criar/atualizar pack no Supabase: {e}")
        # Log detalhado do erro
        if hasattr(e, 'message'):
            logger.error(f"[UPSERT_PACK] Mensagem do erro: {e.message}")
        if hasattr(e, 'details'):
            logger.error(f"[UPSERT_PACK] Detalhes do erro: {e.details}")
        if hasattr(e, 'hint'):
            logger.error(f"[UPSERT_PACK] Hint do erro: {e.hint}")
        return None


def record_job(user_jwt: str, job_id: str, status: str, user_id: Optional[str], progress: int = 0, message: Optional[str] = None, payload: Optional[Dict[str, Any]] = None, result_count: Optional[int] = None) -> None:
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
    
    # Estratégia de otimização:
    # - Se payload foi fornecido: usar UPSERT (pode criar ou atualizar)
    # - Se payload NÃO foi fornecido: usar UPDATE (preserva campos não incluídos, como payload)
    if payload is not None:
        # Com payload: fazer UPSERT completo (pode criar novo job ou atualizar existente)
        data["id"] = job_id
        data["user_id"] = user_id
        data["payload"] = payload
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


def delete_pack(user_jwt: str, pack_id: str, ad_ids: Optional[List[str]] = None, user_id: Optional[str] = None) -> Dict[str, Any]:
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
            "metrics_deleted": int
        }
    """
    if not user_id:
        logger.warning("Supabase delete_pack skipped: missing user_id")
        return {"pack_deleted": False, "ads_deleted": 0, "metrics_deleted": 0}
    
    # Sempre buscar pack para obter ad_ids e período (fonte de verdade)
    sb = get_supabase_for_user(user_jwt)
    pack = None
    pack_ad_ids = None
    date_start = None
    date_stop = None
    
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
        "metrics_deleted": 0
    }
    
    try:
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
        
        # 2. Ajustar/deletar ad_metrics do período do pack
        # Processar sempre, mesmo se ad_ids estiver vazio - usar pack_id no array pack_ids como filtro principal
        # Preserva dados que são usados por outros packs (remove apenas o pack_id do array se houver múltiplos)
        try:
            # Buscar apenas ad_metrics que TÊM esse pack_id no array pack_ids
            # O filtro pack_ids é suficiente e preciso - é a fonte de verdade
            def metrics_filters(q):
                q = q.eq("user_id", user_id).filter("pack_ids", "cs", f"{{{pack_id}}}")
                if date_start and date_stop:
                    q = q.gte("date", date_start).lte("date", date_stop)
                return q
            
            metrics_rows = _fetch_all_paginated(
                sb, 
                "ad_metrics", 
                "id, pack_ids", 
                metrics_filters
            )
            
            logger.info(f"Encontrados {len(metrics_rows)} registros de ad_metrics com pack_id {pack_id} para processar")

            to_delete_ids: List[str] = []
            to_update_rows: List[Dict[str, Any]] = []
            for m in metrics_rows:
                packs_arr = m.get("pack_ids") or []
                # Verificar se o pack_id está no array (sempre deve estar devido ao filtro, mas verificamos por segurança)
                if pack_id in packs_arr:
                    # Se o registro é usado por outros packs, apenas remove o pack_id do array
                    if len(packs_arr) > 1:
                        new_arr = [p for p in packs_arr if p != pack_id]
                        to_update_rows.append({"id": m.get("id"), "pack_ids": new_arr, "updated_at": _now_iso()})
                    else:
                        # Se é o único pack usando esse registro, deleta completamente
                        to_delete_ids.append(str(m.get("id")))

            if to_update_rows:
                # Usar .update() ao invés de .upsert() já que sabemos que os registros existem
                # Isso evita problemas de validação de campos obrigatórios
                for row in to_update_rows:
                    sb.table("ad_metrics").update({
                        "pack_ids": row["pack_ids"],
                        "updated_at": row["updated_at"]
                    }).eq("id", row["id"]).eq("user_id", user_id).execute()
                logger.info(f"Atualizados {len(to_update_rows)} registros de ad_metrics (removido pack_id, mantidos por outros packs)")
            
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
        try:
            # Buscar apenas ads que TÊM esse pack_id no array pack_ids
            # O filtro pack_ids é suficiente e preciso - é a fonte de verdade
            def ads_filters(q):
                q = q.eq("user_id", user_id).filter("pack_ids", "cs", f"{{{pack_id}}}")
                return q
            
            ads_rows = _fetch_all_paginated(
                sb,
                "ads",
                "ad_id, pack_ids",
                ads_filters
            )
            
            logger.info(f"Encontrados {len(ads_rows)} registros de ads com pack_id {pack_id} para processar")

            to_delete_ad_ids: List[str] = []
            to_update_ads: List[Dict[str, Any]] = []
            for ad in ads_rows:
                packs_arr = ad.get("pack_ids") or []
                # Verificar se o pack_id está no array (sempre deve estar devido ao filtro, mas verificamos por segurança)
                if pack_id in packs_arr:
                    # Se o registro é usado por outros packs, apenas remove o pack_id do array
                    if len(packs_arr) > 1:
                        new_arr = [p for p in packs_arr if p != pack_id]
                        to_update_ads.append({"ad_id": ad.get("ad_id"), "pack_ids": new_arr, "updated_at": _now_iso()})
                    else:
                        # Se é o único pack usando esse registro, deleta completamente
                        to_delete_ad_ids.append(str(ad.get("ad_id")))

            if to_update_ads:
                # Usar .update() ao invés de .upsert() já que sabemos que os registros existem
                # Isso evita problemas de validação de campos obrigatórios
                for row in to_update_ads:
                    sb.table("ads").update({
                        "pack_ids": row["pack_ids"],
                        "updated_at": row["updated_at"]
                    }).eq("ad_id", row["ad_id"]).eq("user_id", user_id).execute()
                logger.info(f"Atualizados {len(to_update_ads)} registros de ads (removido pack_id, mantidos por outros packs)")
            
            if to_delete_ad_ids:
                # Deletar em lotes para evitar problemas com muitos IDs
                # IDs de ads são longos (ex: "120236981806920782" ~18-19 chars)
                # Reduzir batch_size para evitar URLs muito longas que excedem limite do Supabase (~8KB)
                # Com IDs de ~19 caracteres, 400 IDs = ~7.600 chars na URL (seguro para limite de ~8KB)
                batch_size = 400  # Reduzido de 1000 para 400 devido ao tamanho dos ad_ids
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
        
    except Exception as e:
        logger.exception(f"Erro ao deletar pack {pack_id}: {e}")
        raise
    
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
    - business_id
    - business_name
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
        business = acc.get("business") or {}
        
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
            "business_id": business.get("id"),
            "business_name": business.get("name"),
            "instagram_accounts": instagram_accounts,
            "updated_at": _now_iso(),
        }
        rows.append(row)

    if not rows:
        logger.info(f"upsert_ad_accounts: no valid ad accounts to save for user {user_id}")
        return

    try:
        sb = get_supabase_for_user(user_jwt)
        sb.table("ad_accounts").upsert(rows, on_conflict="id").execute()
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
                    "id, spreadsheet_id, worksheet_title, last_synced_at, last_sync_status",
                    lambda q: q.in_("id", integration_ids)
                )
                # Criar mapa id -> integration
                integrations_map = {str(int["id"]): int for int in integrations}
                
                # Enriquecer packs com dados da integração
                # Também buscar nomes das planilhas via Google API
                from app.services.google_sheets_service import list_spreadsheets
                try:
                    # Buscar todas as planilhas de uma vez (até 100)
                    spreadsheets, _ = list_spreadsheets(
                        user_jwt=user_jwt,
                        user_id=user_id,
                        query=None,
                        page_size=100,
                    )
                    spreadsheets_map = {s.get("id"): s.get("name") for s in spreadsheets}
                except Exception as e:
                    logger.warning(f"[LIST_PACKS] Erro ao buscar nomes das planilhas: {e}")
                    spreadsheets_map = {}
                
                for pack in packs:
                    sheet_integration_id = pack.get("sheet_integration_id")
                    if sheet_integration_id and str(sheet_integration_id) in integrations_map:
                        integration = integrations_map[str(sheet_integration_id)]
                        # Adicionar nome da planilha se disponível
                        spreadsheet_id = integration.get("spreadsheet_id")
                        if spreadsheet_id and spreadsheet_id in spreadsheets_map:
                            integration["spreadsheet_name"] = spreadsheets_map[spreadsheet_id]
                        pack["sheet_integration"] = integration
            except Exception as e:
                logger.warning(f"[LIST_PACKS] Erro ao buscar integrações: {e}")
                # Continuar sem dados de integração se falhar
    
    return packs


def get_pack(user_jwt: str, pack_id: str, user_id: Optional[str]) -> Optional[Dict[str, Any]]:
    """Busca um pack específico do Supabase, incluindo dados de integração de planilha."""
    if not user_id or not pack_id:
        return None
    sb = get_supabase_for_user(user_jwt)
    res = sb.table("packs").select("*").eq("id", pack_id).eq("user_id", user_id).limit(1).execute()
    if res.data and len(res.data) > 0:
        pack = res.data[0]
        
        # Buscar integração se pack tiver sheet_integration_id
        sheet_integration_id = pack.get("sheet_integration_id")
        if sheet_integration_id:
            try:
                int_res = (
                    sb.table("ad_sheet_integrations")
                    .select("id, spreadsheet_id, worksheet_title, last_synced_at, last_sync_status")
                    .eq("id", sheet_integration_id)
                    .limit(1)
                    .execute()
                )
                if int_res.data and len(int_res.data) > 0:
                    integration = int_res.data[0]
                    # Buscar nome da planilha via Google API
                    spreadsheet_id = integration.get("spreadsheet_id")
                    if spreadsheet_id:
                        try:
                            from app.services.google_sheets_service import list_spreadsheets
                            spreadsheets, _ = list_spreadsheets(
                                user_jwt=user_jwt,
                                user_id=user_id,
                                query=None,
                                page_size=100,
                            )
                            matching_spreadsheet = next(
                                (s for s in spreadsheets if s.get("id") == spreadsheet_id),
                                None
                            )
                            if matching_spreadsheet:
                                integration["spreadsheet_name"] = matching_spreadsheet.get("name", "Planilha desconhecida")
                        except Exception as e:
                            logger.warning(f"[GET_PACK] Erro ao buscar nome da planilha: {e}")
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
) -> None:
    """Atualiza o status de refresh de um pack no Supabase.
    
    Args:
        user_jwt: JWT do Supabase do usuário
        pack_id: ID do pack a atualizar
        user_id: ID do usuário
        last_refreshed_at: Data de último refresh no formato YYYY-MM-DD (None = hoje)
        refresh_status: Status do refresh ('success', 'failed', 'running', etc.)
    """
    if not user_id or not pack_id:
        logger.warning("[UPDATE_REFRESH_STATUS] Skipped: missing user_id or pack_id")
        return
    
    if last_refreshed_at is None:
        today = datetime.utcnow().date()
        last_refreshed_at = today.strftime("%Y-%m-%d")
    
    sb = get_supabase_for_user(user_jwt)
    
    update_data = {
        "last_refreshed_at": last_refreshed_at,
        "refresh_status": refresh_status,
        "updated_at": _now_iso(),
    }
    
    try:
        sb.table("packs").update(update_data).eq("id", pack_id).eq("user_id", user_id).execute()
        logger.info(f"[UPDATE_REFRESH_STATUS] ✓ Pack {pack_id} atualizado - last_refreshed_at={last_refreshed_at}, status={refresh_status}")
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
    """
    if not user_id or not pack_id:
        logger.warning("[UPDATE_PACK_NAME] Skipped: missing user_id or pack_id")
        return
    
    if not name or not name.strip():
        raise ValueError("Nome do pack não pode ser vazio")
    
    sb = get_supabase_for_user(user_jwt)
    
    update_data = {
        "name": name.strip(),
        "updated_at": _now_iso(),
    }
    
    try:
        sb.table("packs").update(update_data).eq("id", pack_id).eq("user_id", user_id).execute()
        logger.info(f"[UPDATE_PACK_NAME] ✓ Pack {pack_id} atualizado - name={name}")
    except Exception as e:
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
                # Processar ad_ids em lotes para evitar URLs muito longas
                # IDs de ads são longos (ex: "120236981806920782" ~18-19 chars)
                # Reduzir batch_size para evitar URLs muito longas que excedem limite do Supabase (~8KB)
                # Com IDs de ~19 caracteres, 400 IDs = ~7.600 chars na URL (seguro para limite de ~8KB)
                batch_size = 400  # Reduzido de 500 para 400 devido ao tamanho dos ad_ids
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
        
    except Exception as e:
        logger.error(f"Erro ao buscar ads para pack {pack.get('id')}: {e}")
        return []
    
    return ads

