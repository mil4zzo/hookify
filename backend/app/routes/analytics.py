from __future__ import annotations

from typing import Any, Dict, List, Optional, Literal
from datetime import datetime, timedelta
import logging

from fastapi import APIRouter, HTTPException, Body, Depends, Query
from pydantic import BaseModel, Field

from app.core.supabase_client import get_supabase_for_user
from app.core.auth import get_current_user
from app.services import supabase_repo
from app.services.thumbnail_cache import build_public_storage_url, cache_first_thumbs_for_ads, DEFAULT_BUCKET


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/analytics", tags=["analytics"])


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


GroupBy = Literal["ad_id", "ad_name"]


class RankingsFilters(BaseModel):
    adaccount_ids: Optional[List[str]] = None
    campaign_name_contains: Optional[str] = None
    adset_name_contains: Optional[str] = None
    ad_name_contains: Optional[str] = None


class RankingsRequest(BaseModel):
    date_start: str
    date_stop: str
    group_by: GroupBy = "ad_id"
    action_type: Optional[str] = None
    order_by: Optional[str] = Field(default=None, description="hook|hold_rate|cpr|spend|ctr|connect_rate|page_conv")
    limit: int = 500
    filters: Optional[RankingsFilters] = None


class DashboardRequest(BaseModel):
    date_start: str
    date_stop: str
    adaccount_ids: Optional[List[str]] = None


class DeletePackRequest(BaseModel):
    ad_ids: Optional[List[str]] = Field(default=None, description="Fallback opcional para packs antigos sem ad_ids salvos (geralmente não necessário)")


class UpdatePackAutoRefreshRequest(BaseModel):
    auto_refresh: bool = Field(..., description="Valor booleano para ativar/desativar auto_refresh")


class UpdatePackNameRequest(BaseModel):
    name: str = Field(..., description="Novo nome do pack", min_length=1)


def _to_date(s: str) -> datetime:
    return datetime(int(s[0:4]), int(s[5:7]), int(s[8:10]))


def _axis_5_days(end_date: str) -> List[str]:
    end = _to_date(end_date)
    return [(end - timedelta(days=i)).strftime("%Y-%m-%d") for i in range(4, -1, -1)]


def _axis_date_range(start_date: str, end_date: str) -> List[str]:
    """Gera array de datas entre start_date e end_date (inclusive)."""
    start = _to_date(start_date)
    end = _to_date(end_date)
    dates = []
    current = start
    while current <= end:
        dates.append(current.strftime("%Y-%m-%d"))
        current += timedelta(days=1)
    return dates


def _safe_div(a: float, b: float) -> float:
    return (a / b) if b else 0.0


def _get_user_mql_leadscore_min(sb, user_id: str) -> float:
    """Busca mql_leadscore_min do usuário. Fallback seguro para 0."""
    try:
        res = sb.table("user_preferences").select("mql_leadscore_min").eq("user_id", user_id).limit(1).execute()
        if res and res.data:
            raw = res.data[0].get("mql_leadscore_min")
            v = float(raw) if raw is not None else 0.0
            return v if v >= 0 else 0.0
    except Exception:
        pass
    return 0.0


def _count_mql(leadscore_values: Any, mql_leadscore_min: float) -> int:
    """Conta quantos leadscores são >= mql_leadscore_min (valores inválidos são ignorados)."""
    if not isinstance(leadscore_values, list) or not leadscore_values:
        return 0
    cnt = 0
    for v in leadscore_values:
        try:
            n = float(v)
        except Exception:
            continue
        if n >= mql_leadscore_min:
            cnt += 1
    return cnt


def _build_rankings_series(axis: List[str], S: Dict[str, Any], include_cpmql: bool = True) -> Dict[str, Any]:
    """Constrói payload `series` no formato consumido pelo frontend (sparklines)."""
    hook_series: List[Optional[float]] = []
    spend_series: List[Optional[float]] = []
    ctr_series: List[Optional[float]] = []
    connect_series: List[Optional[float]] = []
    lpv_series: List[Optional[int]] = []
    impressions_series: List[Optional[int]] = []
    cpm_series: List[Optional[float]] = []
    website_ctr_series: List[Optional[float]] = []
    conversions_series: List[Dict[str, int]] = []  # conversions por dia
    cpmql_series: List[Optional[float]] = []

    for d in axis:
        plays = (S.get("plays") or {}).get(d, 0) or 0
        hook_wsum = (S.get("hook_wsum") or {}).get(d, 0.0) or 0.0
        hook_day = _safe_div(hook_wsum, plays) if plays else None

        spend_day = (S.get("spend") or {}).get(d, 0.0) or 0.0
        clicks_day = (S.get("clicks") or {}).get(d, 0) or 0
        impr_day = (S.get("impressions") or {}).get(d, 0) or 0
        inline_day = (S.get("inline") or {}).get(d, 0) or 0
        lpv_day = (S.get("lpv") or {}).get(d, 0) or 0

        ctr_day = (clicks_day / impr_day) if impr_day else None
        connect_day = (lpv_day / inline_day) if inline_day else None
        cpm_day = (spend_day * 1000.0 / impr_day) if impr_day else None
        website_ctr_day = (inline_day / impr_day) if impr_day else None

        conversions_day = ((S.get("conversions") or {}).get(d, {})) or {}

        hook_series.append(hook_day)
        spend_series.append(spend_day if spend_day else None)
        ctr_series.append(ctr_day)
        connect_series.append(connect_day)
        lpv_series.append(lpv_day)
        impressions_series.append(impr_day if impr_day else None)
        cpm_series.append(cpm_day)
        website_ctr_series.append(website_ctr_day)
        conversions_series.append(conversions_day)

        if include_cpmql:
            mql_count_day = ((S.get("mql_count") or {}).get(d, 0)) or 0
            cpmql_day = (spend_day / mql_count_day) if (mql_count_day and spend_day > 0) else None
            cpmql_series.append(cpmql_day)

    series: Dict[str, Any] = {
        "axis": axis,
        "hook": hook_series,
        "spend": spend_series,
        "ctr": ctr_series,
        "connect_rate": connect_series,
        "lpv": lpv_series,
        "impressions": impressions_series,
        "cpm": cpm_series,
        "website_ctr": website_ctr_series,
        "conversions": conversions_series,
    }
    if include_cpmql:
        series["cpmql"] = cpmql_series
    return series

def _hook_at_3_from_curve(curve: Any) -> float:
    try:
        if not isinstance(curve, list) or not curve:
            return 0.0
        v = float(curve[min(3, len(curve) - 1)] or 0)
        return v / 100.0 if v > 1 else v
    except Exception:
        return 0.0

def _get_thumbnail_with_fallback(ad_row: Dict[str, Any]) -> Optional[str]:
    """Obtém thumbnail com fallback para adcreatives_videos_thumbs.
    
    Prioridade:
    1. thumbnail_url (de creative)
    2. adcreatives_videos_thumbs[0] (primeiro item do array de fallback)
    3. None
    """
    thumbnail_url = ad_row.get("thumbnail_url")
    if thumbnail_url and thumbnail_url.strip():
        return thumbnail_url
    
    # Fallback: usar primeiro thumbnail de adcreatives_videos_thumbs
    adcreatives_thumbs = ad_row.get("adcreatives_videos_thumbs")
    if isinstance(adcreatives_thumbs, list) and len(adcreatives_thumbs) > 0:
        first_thumb = adcreatives_thumbs[0]
        if first_thumb and str(first_thumb).strip():
            return str(first_thumb)
    
    return None


def _get_storage_thumb_if_any(ad_row: Dict[str, Any]) -> Optional[str]:
    """Retorna URL pública do Storage se `thumb_storage_path` existir; senão None."""
    try:
        p = str(ad_row.get("thumb_storage_path") or "").strip()
        if not p:
            return None
        return build_public_storage_url(DEFAULT_BUCKET, p)
    except Exception:
        return None


@router.post("/rankings")
@router.post("/ad-performance")
def get_rankings(req: RankingsRequest, user=Depends(get_current_user)):
    sb = get_supabase_for_user(user["token"])
    mql_leadscore_min = _get_user_mql_leadscore_min(sb, user["user_id"])

    # Window para sparklines (5 dias terminando em date_stop)
    axis = _axis_5_days(req.date_stop)
    window_start = axis[0]
    full_start = req.date_start
    full_stop = req.date_stop

    # Buscar linhas diárias no período completo (para totais) e na janela de 5 dias (para séries)
    # Para simplificar, trazemos toda a janela completa (full) e processamos em memória.
    # RLS garante que apenas dados do usuário são retornados
    # Usar paginação para contornar limite de 1000 linhas do Supabase
    f = req.filters or RankingsFilters()
    
    def metrics_filters(q):
        q = q.gte("date", full_start).lte("date", full_stop)
        if f.adaccount_ids:
            q = q.in_("account_id", f.adaccount_ids)
        return q
    
    data = _fetch_all_paginated(
        sb,
        "ad_metrics",
        "ad_id,ad_name,account_id,campaign_name,adset_name,date,clicks,impressions,inline_link_clicks,spend,video_total_plays,video_total_thruplays,video_watched_p50,conversions,actions,video_play_curve_actions,hold_rate,reach,frequency,leadscore_values",
        metrics_filters
    )
    
    # LOG TEMPORÁRIO PARA DEBUG
    logger.info(f"[INSIGHTS DEBUG] Dados brutos do Supabase: data_count={len(data)}, date_start={full_start}, date_stop={full_stop}")
    if len(data) > 0:
        logger.info(f"[INSIGHTS DEBUG] Primeiro registro: ad_name={data[0].get('ad_name')}, date={data[0].get('date')}, impressions={data[0].get('impressions')}")
    
    # Filtros por contains serão aplicados em memória (pode-se otimizar com ilike + expressões geradas futuramente)

    # Extrair tipos únicos de conversão e actions de todos os dados
    available_conversion_types = set()
    for r in data:
        # Extrair de conversions
        conversions = r.get("conversions") or []
        if isinstance(conversions, list):
            for conv in conversions:
                if isinstance(conv, dict):
                    action_type = conv.get("action_type")
                    if action_type:
                        # Prefixar com categoria para diferenciar origem
                        available_conversion_types.add(f"conversion:{str(action_type)}")
        
        # Extrair de actions
        actions = r.get("actions") or []
        if isinstance(actions, list):
            for action in actions:
                if isinstance(action, dict):
                    action_type = action.get("action_type")
                    if action_type:
                        # Prefixar com categoria para diferenciar origem
                        available_conversion_types.add(f"action:{str(action_type)}")
    
    available_conversion_types = sorted(list(available_conversion_types))

    def name_ok(val: Optional[str], needle: Optional[str]) -> bool:
        if not needle:
            return True
        v = (val or "").lower()
        return needle.lower() in v

    rows: List[Dict[str, Any]] = [r for r in data if name_ok(r.get("campaign_name"), f.campaign_name_contains) and name_ok(r.get("adset_name"), f.adset_name_contains) and name_ok(r.get("ad_name"), f.ad_name_contains)]

    # LOG TEMPORÁRIO PARA DEBUG
    logger.info(f"[INSIGHTS DEBUG] Após filtros: rows_count={len(rows)}, data_count={len(data)}")

    # Agregar por chave (NO NOVO MODELO: sempre por ad_name para ranking pai)
    from collections import defaultdict

    agg: Dict[str, Dict[str, Any]] = {}
    series_acc: Dict[str, Dict[str, Any]] = defaultdict(lambda: {
        "impressions": {d: 0 for d in axis},
        "clicks": {d: 0 for d in axis},
        "inline": {d: 0 for d in axis},
        "spend": {d: 0 for d in axis},
        "plays": {d: 0 for d in axis},
        "lpv": {d: 0 for d in axis},
        "hook_wsum": {d: 0.0 for d in axis},
        "conversions": {d: {} for d in axis},  # conversions por dia: {date: {action_type: value}}
        "mql_count": {d: 0 for d in axis},  # MQLs por dia (a partir de leadscore_values)
    })

    for r in rows:
        ad_id = str(r.get("ad_id") or "")
        ad_name = str(r.get("ad_name") or "")
        key = ad_name or ad_id  # ranking pai sempre por ad_name; fallback para ad_id se faltar
        # Preservar key original para usar em series_acc (não pode ser sobrescrita)
        series_key = key

        # Extrair e normalizar data de forma robusta
        date_raw = r.get("date")
        if date_raw is None:
            continue
        
        # Normalizar para string YYYY-MM-DD
        if isinstance(date_raw, str):
            date = date_raw[:10] if len(date_raw) >= 10 else date_raw
        elif hasattr(date_raw, 'strftime'):
            # Se for objeto date/datetime do Python
            date = date_raw.strftime("%Y-%m-%d")
        else:
            # Tentar converter para string e pegar primeiros 10 caracteres
            date = str(date_raw)[:10]
        
        # Validar formato (deve ser YYYY-MM-DD)
        if len(date) != 10 or date[4] != '-' or date[7] != '-':
            continue

        clicks = int(r.get("clicks") or 0)
        impressions = int(r.get("impressions") or 0)
        inline_link_clicks = int(r.get("inline_link_clicks") or 0)
        spend = float(r.get("spend") or 0)
        plays = int(r.get("video_total_plays") or 0)
        thruplays = int(r.get("video_total_thruplays") or 0)
        curve = r.get("video_play_curve_actions") or []
        hook = _hook_at_3_from_curve(curve)
        video_watched_p50 = int(r.get("video_watched_p50") or 0)
        # hold_rate já vem calculado do banco, mas podemos recalcular se necessário
        hold_rate = float(r.get("hold_rate") or 0)
        reach = int(r.get("reach") or 0)
        frequency = float(r.get("frequency") or 0)
        leadscore_values = r.get("leadscore_values") or []

        # landing_page_views
        lpv = 0
        try:
            for a in (r.get("actions") or []):
                if str(a.get("action_type")) == "landing_page_view":
                    lpv += int(a.get("value") or 0)
        except Exception:
            lpv = 0

        # Totais por chave (ao longo do full range)
        if key not in agg:
            agg[key] = {
                "account_id": r.get("account_id"),
                # Para ranking por nome, manter um ad_id representativo (pelo maior impressions)
                "rep_ad_id": ad_id,
                "rep_impr": 0,
                "ad_name": ad_name,
                "impressions": 0,
                "clicks": 0,
                "inline_link_clicks": 0,
                "spend": 0.0,
                "lpv": 0,
                "plays": 0,
                "thruplays": 0,  # Total de thruplays agregado
                "hook_wsum": 0.0,
                "hold_rate_wsum": 0.0,  # Soma ponderada de hold_rate
                "video_watched_p50_wsum": 0.0,  # Soma ponderada de video_watched_p50
                "reach": 0,
                "frequency_wsum": 0.0,  # Soma ponderada de frequency (por impressions)
                "leadscore_values": [],  # Array agregado de todos os leadscore_values
                # Curva de retenção agregada (ponderada por plays)
                "curve_weighted": {},  # {segundo_index: {"weighted_sum": float, "plays_sum": int}}
                # Conjunto de ad_ids distintos para calcular ad_scale
                "ad_ids": set(),
                # ad_count (antigo) deixa de ser usado para pais; manteremos preenchimento ao final
                "ad_count": 0,
                "thumbnail": None,
                "conversions": {},  # Agregar conversions por action_type
            }
        A = agg[key]
        A["impressions"] += impressions
        A["clicks"] += clicks
        A["inline_link_clicks"] += inline_link_clicks
        A["spend"] += spend
        A["lpv"] += lpv
        A["plays"] += plays
        A["thruplays"] += thruplays
        A["hook_wsum"] += hook * plays
        A["hold_rate_wsum"] += hold_rate * plays  # Agregar hold_rate ponderado por plays
        A["video_watched_p50_wsum"] += video_watched_p50 * plays  # Agregar video_watched_p50 ponderado por plays
        A["reach"] += reach  # Agregar reach (soma simples)
        A["frequency_wsum"] += frequency * impressions  # Agregar frequency ponderado por impressions
        # Agregar leadscore_values (juntar arrays)
        if isinstance(leadscore_values, list) and len(leadscore_values) > 0:
            try:
                A["leadscore_values"].extend([float(v) for v in leadscore_values if v is not None])
            except Exception:
                pass
        
        # Agregar curva de retenção ponderada por plays (mesma lógica do hook)
        if isinstance(curve, list) and plays > 0:
            try:
                for i, val in enumerate(curve):
                    val_num = int(val or 0)
                    if i not in A["curve_weighted"]:
                        A["curve_weighted"][i] = {"weighted_sum": 0.0, "plays_sum": 0}
                    A["curve_weighted"][i]["weighted_sum"] += val_num * plays
                    A["curve_weighted"][i]["plays_sum"] += plays
            except Exception:
                pass
        
        # Registrar ad_id distinto
        if ad_id:
            try:
                A["ad_ids"].add(ad_id)
            except Exception:
                pass
        # Atualizar ad_id representativo pelo maior impressions
        try:
            if impressions >= int(A.get("rep_impr") or 0):
                A["rep_impr"] = impressions
                if ad_id:
                    A["rep_ad_id"] = ad_id
        except Exception:
            pass
        
        # Agregar conversions e actions por action_type (com prefixos para diferenciar)
        try:
            # Processar conversions
            for c in (r.get("conversions") or []):
                action_type = str(c.get("action_type") or "")
                value = int(c.get("value") or 0)
                if action_type:
                    conv_key = f"conversion:{action_type}"
                    if conv_key not in A["conversions"]:
                        A["conversions"][conv_key] = 0
                    A["conversions"][conv_key] += value
            
            # Processar actions
            for a in (r.get("actions") or []):
                action_type = str(a.get("action_type") or "")
                value = int(a.get("value") or 0)
                if action_type:
                    action_key = f"action:{action_type}"
                    if action_key not in A["conversions"]:
                        A["conversions"][action_key] = 0
                    A["conversions"][action_key] += value
        except Exception:
            pass

        # Série 5 dias
        if date in axis:
            S = series_acc[series_key]
            
            S["impressions"][date] += impressions
            S["clicks"][date] += clicks
            S["inline"][date] += inline_link_clicks
            S["spend"][date] += spend
            S["lpv"][date] += lpv
            S["plays"][date] += plays
            S["hook_wsum"][date] += hook * plays
            # MQLs por dia
            try:
                S["mql_count"][date] += _count_mql(leadscore_values, mql_leadscore_min)
            except Exception:
                pass
            
            # Agregar conversions e actions por dia
            try:
                # Processar conversions
                for c in (r.get("conversions") or []):
                    action_type = str(c.get("action_type") or "")
                    value = int(c.get("value") or 0)
                    if action_type:
                        conv_key = f"conversion:{action_type}"
                        if conv_key not in S["conversions"][date]:
                            S["conversions"][date][conv_key] = 0
                        S["conversions"][date][conv_key] += value
                
                # Processar actions
                for a in (r.get("actions") or []):
                    action_type = str(a.get("action_type") or "")
                    value = int(a.get("value") or 0)
                    if action_type:
                        action_key = f"action:{action_type}"
                        if action_key not in S["conversions"][date]:
                            S["conversions"][date][action_key] = 0
                        S["conversions"][date][action_key] += value
            except Exception:
                pass

    # LOG TEMPORÁRIO PARA DEBUG - após processar todos os rows
    logger.info(f"[INSIGHTS DEBUG] Após processar rows: agg_keys_count={len(agg.keys())}, agg_keys_sample={list(agg.keys())[:5]}")

    # Buscar thumbnails da tabela ads (usar ad_id representativo por ad_name)
    # Também buscar todos os ad_ids do grupo para verificar se há pelo menos um ACTIVE
    ad_ids_in_results = set()
    for A in agg.values():
        rep_ad_id = A.get("rep_ad_id")
        if rep_ad_id:
            ad_ids_in_results.add(str(rep_ad_id))  # Garantir string
        # Adicionar TODOS os ad_ids do grupo para verificar status
        ad_ids_set = A.get("ad_ids") or set()
        for ad_id_in_group in ad_ids_set:
            ad_ids_in_results.add(str(ad_id_in_group))
    
    thumbnails_map: Dict[str, Optional[str]] = {}
    adcreatives_map: Dict[str, Optional[List[str]]] = {}  # Map para adcreatives_videos_thumbs
    effective_status_map: Dict[str, Optional[str]] = {}  # Map para effective_status
    if ad_ids_in_results:
        try:
            # Processar ad_ids em lotes para evitar URLs muito longas
            # Limite conservador: 500 IDs por lote (ajustado para evitar erro 400 do Supabase)
            batch_size = 500
            ad_ids_list = list(ad_ids_in_results)
            all_ads_rows = []
            
            for i in range(0, len(ad_ids_list), batch_size):
                batch_ad_ids = ad_ids_list[i:i + batch_size]
                
                def ads_filters(q):
                    return q.eq("user_id", user["user_id"]).in_("ad_id", batch_ad_ids)
                
                batch_ads_rows = _fetch_all_paginated(
                    sb,
                    "ads",
                    "ad_id,thumb_storage_path,thumbnail_url,adcreatives_videos_thumbs,effective_status",
                    ads_filters
                )
                
                all_ads_rows.extend(batch_ads_rows)
            
            for ad_row in all_ads_rows:
                ad_id_val = str(ad_row.get("ad_id") or "")
                thumb = _get_storage_thumb_if_any(ad_row) or _get_thumbnail_with_fallback(ad_row)
                adcreatives = ad_row.get("adcreatives_videos_thumbs")
                effective_status = ad_row.get("effective_status")
                if ad_id_val:
                    thumbnails_map[ad_id_val] = thumb
                    effective_status_map[ad_id_val] = effective_status
                    # Armazenar array completo de adcreatives_videos_thumbs
                    if isinstance(adcreatives, list) and len(adcreatives) > 0:
                        # Filtrar valores válidos (não vazios)
                        valid_thumbs = [str(t) for t in adcreatives if t and str(t).strip()]
                        adcreatives_map[ad_id_val] = valid_thumbs if valid_thumbs else None
                    else:
                        adcreatives_map[ad_id_val] = None
        except Exception as e:
            logger.warning(f"Erro ao buscar thumbnails: {e}")

    # Finalizar métricas derivadas e montar séries
    items: List[Dict[str, Any]] = []
    key_index = 0
    for key, A in agg.items():
        key_index += 1
        ctr = _safe_div(A["clicks"], A["impressions"])
        connect_rate = _safe_div(A["lpv"], A["inline_link_clicks"])
        hook = _safe_div(A["hook_wsum"], A["plays"]) if A["plays"] else 0
        hold_rate = _safe_div(A["hold_rate_wsum"], A["plays"]) if A["plays"] else 0
        video_watched_p50 = _safe_div(A["video_watched_p50_wsum"], A["plays"]) if A["plays"] else 0
        cpm = (_safe_div(A["spend"], A["impressions"]) * 1000.0) if A["impressions"] else 0
        website_ctr = _safe_div(A["inline_link_clicks"], A["impressions"]) if A["impressions"] else 0
        # results, cpr e page_conv serão calculados no frontend baseado no action_type selecionado

        # Buscar thumbnail, adcreatives_videos_thumbs e effective_status do map usando rep_ad_id
        ad_id_for_thumb = A.get("rep_ad_id")
        ad_id_str = str(ad_id_for_thumb or "") if ad_id_for_thumb else ""
        thumbnail = thumbnails_map.get(ad_id_str) if ad_id_str else None
        adcreatives_thumbs = adcreatives_map.get(ad_id_str) if ad_id_str else None
        
        # NOVA LÓGICA: Verificar se há pelo menos um ad_id com effective_status = 'ACTIVE' no grupo
        # Se houver, usar 'ACTIVE' como status do grupo (indica que pelo menos um anúncio está rodando)
        effective_status = None
        ad_ids_in_group = A.get("ad_ids") or set()
        has_active = False
        
        # Verificar todos os ad_ids do grupo
        for ad_id_in_group in ad_ids_in_group:
            ad_id_group_str = str(ad_id_in_group)
            status = effective_status_map.get(ad_id_group_str)
            if status and str(status).upper() == "ACTIVE":
                has_active = True
                effective_status = "ACTIVE"
                break  # Encontrou um ACTIVE, pode parar
        
        # Se não encontrou ACTIVE, usar o status do rep_ad_id (ou primeiro disponível)
        if not has_active:
            effective_status = effective_status_map.get(ad_id_str) if ad_id_str else None
            # Se ainda não tiver, tentar pegar o primeiro status disponível do grupo
            if not effective_status:
                for ad_id_in_group in ad_ids_in_group:
                    ad_id_group_str = str(ad_id_in_group)
                    status = effective_status_map.get(ad_id_group_str)
                    if status:
                        effective_status = status
                        break
        
        # Fallback: buscar diretamente na tabela se não encontrar no map
        if not thumbnail and ad_id_str:
            try:
                fallback_res = sb.table("ads").select("ad_id,thumb_storage_path,thumbnail_url,adcreatives_videos_thumbs,effective_status").eq("user_id", user["user_id"]).eq("ad_id", ad_id_str).limit(1).execute()
                if fallback_res.data and len(fallback_res.data) > 0:
                    fallback_row = fallback_res.data[0]
                    thumbnail = _get_storage_thumb_if_any(fallback_row) or _get_thumbnail_with_fallback(fallback_row)
                    # Atualizar effective_status apenas se ainda não foi definido
                    if not effective_status:
                        effective_status = fallback_row.get("effective_status")
                    # Também buscar adcreatives_videos_thumbs no fallback
                    fallback_adcreatives = fallback_row.get("adcreatives_videos_thumbs")
                    if isinstance(fallback_adcreatives, list) and len(fallback_adcreatives) > 0:
                        valid_thumbs = [str(t) for t in fallback_adcreatives if t and str(t).strip()]
                        adcreatives_thumbs = valid_thumbs if valid_thumbs else None
            except Exception as e:
                pass

        S = series_acc.get(key)
        series = _build_rankings_series(axis, S, include_cpmql=True) if S else None

        # Calcular ad_scale (distinct ad_ids) e preencher ad_count com este valor
        ad_scale = 0
        try:
            ad_scale = len(A.get("ad_ids") or [])
        except Exception:
            ad_scale = 0

        # Calcular curva de retenção agregada (média ponderada por plays)
        aggregated_curve: List[int] = []
        if A.get("curve_weighted"):
            max_curve_len = max(A["curve_weighted"].keys()) + 1 if A["curve_weighted"] else 0
            for i in range(max_curve_len):
                if i in A["curve_weighted"]:
                    w = A["curve_weighted"][i]
                    if w["plays_sum"] > 0:
                        aggregated_curve.append(int(round(w["weighted_sum"] / w["plays_sum"])))
                    else:
                        aggregated_curve.append(0)
                else:
                    aggregated_curve.append(0)

        # Calcular frequency agregado (média ponderada por impressions)
        frequency_agg = _safe_div(A["frequency_wsum"], A["impressions"]) if A["impressions"] else 0
        
        items.append({
            "unique_id": None,
            "account_id": A.get("account_id"),
            # Devolver rep_ad_id para facilitar thumb e ações no frontend
            "ad_id": A.get("rep_ad_id"),
            "ad_name": A.get("ad_name"),
            "effective_status": effective_status,
            "impressions": A["impressions"],
            "clicks": A["clicks"],
            "inline_link_clicks": A["inline_link_clicks"],
            "spend": A["spend"],
            "lpv": A["lpv"],
            "plays": A["plays"],
            "video_total_thruplays": A["thruplays"],
            "hook": hook,
            "hold_rate": hold_rate,
            "video_watched_p50": int(round(video_watched_p50)) if video_watched_p50 else 0,
            "ctr": ctr,
            "connect_rate": connect_rate,
            "cpm": cpm,
            "website_ctr": website_ctr,
            "reach": A["reach"],
            "frequency": frequency_agg,
            "leadscore_values": A.get("leadscore_values") or [],  # Array agregado de leadscore_values
            "conversions": A.get("conversions", {}),  # {action_type: total_value} para o frontend calcular results/cpr/page_conv
            "ad_count": ad_scale,
            "thumbnail": thumbnail,
            "adcreatives_videos_thumbs": adcreatives_thumbs,  # Array completo de thumbnails dos vídeos
            "video_play_curve_actions": aggregated_curve if aggregated_curve else None,
            "series": series,
        })

    # Calcular médias globais (antes de ordenar/limitar), incluindo por action_type
    # Também calcular médias de retenção (hook no índice 3 e scroll stop no índice 1)
    total_spend = 0.0
    total_impr = 0
    total_clicks = 0
    total_inline = 0
    total_lpv = 0
    total_plays = 0
    total_hook_wsum = 0.0
    total_hold_rate_wsum = 0.0  # Soma ponderada de hold_rate
    total_scroll_stop_wsum = 0.0  # Soma ponderada para índice 1 (scroll stop)

    # results por action_type
    per_action_results: Dict[str, int] = {t: 0 for t in available_conversion_types}

    for A in agg.values():
        total_spend += float(A.get("spend") or 0)
        total_impr += int(A.get("impressions") or 0)
        total_clicks += int(A.get("clicks") or 0)
        total_inline += int(A.get("inline_link_clicks") or 0)
        total_lpv += int(A.get("lpv") or 0)
        total_plays += int(A.get("plays") or 0)
        total_hook_wsum += float(A.get("hook_wsum") or 0.0)
        total_hold_rate_wsum += float(A.get("hold_rate_wsum") or 0.0)
        
        # Calcular scroll stop (índice 1) ponderado por plays
        # Pegar a curva agregada do item para extrair o valor no índice 1
        # A curva vem em porcentagem (0-100), então normalizamos para decimal (0-1) como o hook
        curve_weighted = A.get("curve_weighted") or {}
        if 1 in curve_weighted:
            w = curve_weighted[1]
            plays_for_item = int(A.get("plays") or 0)
            if w.get("plays_sum", 0) > 0 and plays_for_item > 0:
                scroll_stop_raw = w["weighted_sum"] / w["plays_sum"]
                # Normalizar: se valor > 1, assume que está em porcentagem e divide por 100
                scroll_stop_val = scroll_stop_raw / 100.0 if scroll_stop_raw > 1 else scroll_stop_raw
                total_scroll_stop_wsum += scroll_stop_val * plays_for_item

        convs = A.get("conversions") or {}
        if isinstance(convs, dict):
            for t in available_conversion_types:
                try:
                    per_action_results[t] += int(convs.get(t) or 0)
                except Exception:
                    pass

    averages_base = {
        "hook": _safe_div(total_hook_wsum, total_plays) if total_plays else 0,
        "hold_rate": _safe_div(total_hold_rate_wsum, total_plays) if total_plays else 0,
        "scroll_stop": _safe_div(total_scroll_stop_wsum, total_plays) if total_plays else 0,
        "ctr": _safe_div(total_clicks, total_impr) if total_impr else 0,
        "website_ctr": _safe_div(total_inline, total_impr) if total_impr else 0,
        "connect_rate": _safe_div(total_lpv, total_inline) if total_inline else 0,
        "cpm": (_safe_div(total_spend, total_impr) * 1000.0) if total_impr else 0,
    }

    per_action_type: Dict[str, Dict[str, float]] = {}
    for t in available_conversion_types:
        res_total = per_action_results.get(t, 0)
        cpr_val = _safe_div(total_spend, res_total) if res_total else 0
        page_conv_val = _safe_div(res_total, total_lpv) if total_lpv else 0
        per_action_type[t] = {
            "results": float(res_total),
            "cpr": cpr_val,
            "page_conv": page_conv_val,
        }

    averages_payload = {
        **averages_base,
        "per_action_type": per_action_type,
    }

    # Ordenação opcional
    order = (req.order_by or "").lower()
    if order in {"hook", "hold_rate", "cpr", "spend", "ctr", "connect_rate", "page_conv"}:
        reverse = order not in {"cpr"}  # cpr menor é melhor; os demais maior é melhor
        items.sort(key=lambda x: (x.get(order) or 0), reverse=reverse)

    # LOG TEMPORÁRIO PARA DEBUG
    logger.info(f"[INSIGHTS DEBUG] Retornando resposta: items_count={len(items)}, available_conversion_types_count={len(available_conversion_types)}, has_averages={bool(averages_payload)}")
    if len(items) == 0:
        logger.warning(f"[INSIGHTS DEBUG] Nenhum item retornado! data_count={len(data)}, rows_count={len(rows)}, agg_keys_count={len(agg.keys())}, agg_keys={list(agg.keys())[:5]}")
    
    return {
        "data": items[: max(1, req.limit)],
        "available_conversion_types": available_conversion_types,
        "averages": averages_payload,
    }


@router.get("/rankings/ad-name/{ad_name}/children")
def get_rankings_children(
    ad_name: str,
    date_start: str,
    date_stop: str,
    order_by: Optional[str] = None,
    user=Depends(get_current_user)
):
    """Retorna linhas-filhas agregadas por ad_id para um ad_name no período.
    Inclui séries de 5 dias (hook, spend, ctr, connect_rate, lpv, impressions, conversions).
    """
    sb = get_supabase_for_user(user["token"])
    mql_leadscore_min = _get_user_mql_leadscore_min(sb, user["user_id"])

    axis = _axis_5_days(date_stop)
    
    # Usar paginação para contornar limite de 1000 linhas do Supabase
    # ALTO RISCO: Pode haver muitos registros se o período for longo ou múltiplos ad_ids com o mesmo nome
    def metrics_filters(q):
        return q.eq("ad_name", ad_name).gte("date", date_start).lte("date", date_stop)
    
    data = _fetch_all_paginated(
        sb,
        "ad_metrics",
        "ad_id,account_id,campaign_name,adset_name,date,clicks,impressions,inline_link_clicks,spend,video_total_plays,video_total_thruplays,video_watched_p50,conversions,actions,video_play_curve_actions,hold_rate,leadscore_values",
        metrics_filters
    )

    from collections import defaultdict

    agg: Dict[str, Dict[str, Any]] = {}
    series_acc: Dict[str, Dict[str, Any]] = defaultdict(lambda: {
        "impressions": {d: 0 for d in axis},
        "clicks": {d: 0 for d in axis},
        "inline": {d: 0 for d in axis},
        "spend": {d: 0 for d in axis},
        "plays": {d: 0 for d in axis},
        "lpv": {d: 0 for d in axis},
        "hook_wsum": {d: 0.0 for d in axis},
        "conversions": {d: {} for d in axis},
        "mql_count": {d: 0 for d in axis},
    })

    for r in data:
        ad_id = str(r.get("ad_id") or "")
        key = ad_id

        date = str(r.get("date"))[:10]
        clicks = int(r.get("clicks") or 0)
        impressions = int(r.get("impressions") or 0)
        inline_link_clicks = int(r.get("inline_link_clicks") or 0)
        spend = float(r.get("spend") or 0)
        leadscore_values = r.get("leadscore_values") or []
        plays = int(r.get("video_total_plays") or 0)
        thruplays = int(r.get("video_total_thruplays") or 0)
        video_watched_p50 = int(r.get("video_watched_p50") or 0)
        curve = r.get("video_play_curve_actions") or []
        hook = _hook_at_3_from_curve(curve)
        hold_rate = float(r.get("hold_rate") or 0)

        # landing_page_views
        lpv = 0
        try:
            for a in (r.get("actions") or []):
                if str(a.get("action_type")) == "landing_page_view":
                    lpv += int(a.get("value") or 0)
        except Exception:
            lpv = 0

        if key not in agg:
            agg[key] = {
                "account_id": r.get("account_id"),
                "ad_id": ad_id,
                "ad_name": ad_name,
                "campaign_name": r.get("campaign_name"),
                "adset_name": r.get("adset_name"),
                "impressions": 0,
                "clicks": 0,
                "inline_link_clicks": 0,
                "spend": 0.0,
                "lpv": 0,
                "plays": 0,
                "thruplays": 0,  # Total de thruplays agregado
                "hook_wsum": 0.0,
                "hold_rate_wsum": 0.0,  # Soma ponderada de hold_rate
                "video_watched_p50_wsum": 0.0,  # Soma ponderada de video_watched_p50
                "conversions": {},
            }
        A = agg[key]
        A["impressions"] += impressions
        A["clicks"] += clicks
        A["inline_link_clicks"] += inline_link_clicks
        A["spend"] += spend
        A["lpv"] += lpv
        A["plays"] += plays
        A["thruplays"] += thruplays
        A["hook_wsum"] += hook * plays
        A["hold_rate_wsum"] += hold_rate * plays  # Agregar hold_rate ponderado por plays
        A["video_watched_p50_wsum"] += video_watched_p50 * plays  # Agregar video_watched_p50 ponderado por plays

        # Agregar conversions e actions no total (não apenas nas séries)
        try:
            # Processar conversions
            for c in (r.get("conversions") or []):
                action_type = str(c.get("action_type") or "")
                value = int(c.get("value") or 0)
                if action_type:
                    key_conv = f"conversion:{action_type}"
                    if key_conv not in A["conversions"]:
                        A["conversions"][key_conv] = 0
                    A["conversions"][key_conv] += value
            
            # Processar actions
            for a in (r.get("actions") or []):
                action_type = str(a.get("action_type") or "")
                value = int(a.get("value") or 0)
                if action_type:
                    key_act = f"action:{action_type}"
                    if key_act not in A["conversions"]:
                        A["conversions"][key_act] = 0
                    A["conversions"][key_act] += value
        except Exception:
            pass

        # Séries 5 dias
        if date in axis:
            S = series_acc[key]
            S["impressions"][date] += impressions
            S["clicks"][date] += clicks
            S["inline"][date] += inline_link_clicks
            S["spend"][date] += spend
            S["lpv"][date] += lpv
            S["plays"][date] += plays
            S["hook_wsum"][date] += hook * plays
            try:
                S["mql_count"][date] += _count_mql(leadscore_values, mql_leadscore_min)
            except Exception:
                pass
            try:
                # Processar conversions
                for c in (r.get("conversions") or []):
                    action_type = str(c.get("action_type") or "")
                    value = int(c.get("value") or 0)
                    if action_type:
                        key_conv = f"conversion:{action_type}"
                        if key_conv not in S["conversions"][date]:
                            S["conversions"][date][key_conv] = 0
                        S["conversions"][date][key_conv] += value
                
                # Processar actions
                for a in (r.get("actions") or []):
                    action_type = str(a.get("action_type") or "")
                    value = int(a.get("value") or 0)
                    if action_type:
                        key_act = f"action:{action_type}"
                        if key_act not in S["conversions"][date]:
                            S["conversions"][date][key_act] = 0
                        S["conversions"][date][key_act] += value
            except Exception:
                pass

    # Buscar thumbnails e effective_status dos filhos
    ad_ids_in_results = list(agg.keys())
    thumbnails_map: Dict[str, Optional[str]] = {}
    effective_status_map: Dict[str, Optional[str]] = {}
    if ad_ids_in_results:
        try:
            # Processar ad_ids em lotes para evitar URLs muito longas
            # Limite conservador: 500 IDs por lote (ajustado para evitar erro 400 do Supabase)
            batch_size = 500
            all_ads_rows = []
            
            for i in range(0, len(ad_ids_in_results), batch_size):
                batch_ad_ids = ad_ids_in_results[i:i + batch_size]
                
                def ads_filters(q):
                    return q.in_("ad_id", batch_ad_ids)
                
                batch_ads_rows = _fetch_all_paginated(
                    sb,
                    "ads",
                    "ad_id,thumb_storage_path,thumbnail_url,adcreatives_videos_thumbs,creative_video_id,effective_status",
                    ads_filters
                )
                
                all_ads_rows.extend(batch_ads_rows)
            
            for ad_row in all_ads_rows:
                aid = str(ad_row.get("ad_id") or "")
                thumbnails_map[aid] = _get_storage_thumb_if_any(ad_row) or _get_thumbnail_with_fallback(ad_row)
                effective_status_map[aid] = ad_row.get("effective_status")
        except Exception as e:
            logger.warning(f"Erro ao buscar thumbnails (children): {e}")

    items: List[Dict[str, Any]] = []
    for key, A in agg.items():
        ctr = _safe_div(A["clicks"], A["impressions"]) if A["impressions"] else 0
        hook = _safe_div(A["hook_wsum"], A["plays"]) if A["plays"] else 0
        hold_rate = _safe_div(A["hold_rate_wsum"], A["plays"]) if A["plays"] else 0
        video_watched_p50 = _safe_div(A["video_watched_p50_wsum"], A["plays"]) if A["plays"] else 0
        cpm = (_safe_div(A["spend"], A["impressions"]) * 1000.0) if A["impressions"] else 0
        website_ctr = _safe_div(A["inline_link_clicks"], A["impressions"]) if A["impressions"] else 0

        S = series_acc.get(key)
        series = _build_rankings_series(axis, S, include_cpmql=True) if S else None

        items.append({
            "account_id": A.get("account_id"),
            "ad_id": A.get("ad_id"),
            "ad_name": ad_name,
            "effective_status": effective_status_map.get(key),
            "campaign_name": A.get("campaign_name"),
            "adset_name": A.get("adset_name"),
            "impressions": A["impressions"],
            "clicks": A["clicks"],
            "inline_link_clicks": A["inline_link_clicks"],
            "spend": A["spend"],
            "lpv": A["lpv"],
            "plays": A["plays"],
            "video_total_thruplays": A["thruplays"],
            "hook": hook,
            "hold_rate": hold_rate,
            "video_watched_p50": int(round(video_watched_p50)) if video_watched_p50 else 0,
            "ctr": ctr,
            "connect_rate": _safe_div(A["lpv"], A["inline_link_clicks"]) if A["inline_link_clicks"] else 0,
            "cpm": cpm,
            "website_ctr": website_ctr,
            "conversions": A.get("conversions", {}),
            "thumbnail": thumbnails_map.get(key),
            "series": series,
        })

    order = (order_by or "").lower()
    if order in {"hook", "hold_rate", "cpr", "spend", "ctr", "connect_rate", "page_conv"}:
        reverse = order not in {"cpr"}
        items.sort(key=lambda x: (x.get(order) or 0), reverse=reverse)

    return { "data": items }


@router.get("/rankings/ad-id/{ad_id}")
def get_ad_details(
    ad_id: str,
    date_start: str,
    date_stop: str,
    user=Depends(get_current_user)
):
    """Retorna detalhes completos de um ad_id específico no período.
    Inclui séries de 5 dias (hook, spend, ctr, connect_rate, lpv, impressions, conversions).
    Reutiliza a lógica de get_rankings_children, mas retorna um único item.
    """
    sb = get_supabase_for_user(user["token"])
    mql_leadscore_min = _get_user_mql_leadscore_min(sb, user["user_id"])

    axis = _axis_5_days(date_stop)
    
    # Usar paginação para contornar limite de 1000 linhas do Supabase
    # ALTO RISCO: Pode haver mais de 1000 registros se o período for longo (ex: vários anos)
    def metrics_filters(q):
        return q.eq("user_id", user["user_id"]).eq("ad_id", ad_id).gte("date", date_start).lte("date", date_stop)
    
    data = _fetch_all_paginated(
        sb,
        "ad_metrics",
        "ad_id,ad_name,account_id,campaign_name,adset_name,date,clicks,impressions,inline_link_clicks,spend,video_total_plays,video_watched_p50,conversions,actions,video_play_curve_actions,leadscore_values",
        metrics_filters
    )
    
    if not data:
        raise HTTPException(status_code=404, detail=f"Ad ID {ad_id} não encontrado no período especificado")

    from collections import defaultdict

    # Agregar dados do período completo
    agg: Dict[str, Any] = {
        "account_id": None,
        "ad_id": ad_id,
        "ad_name": None,
        "campaign_name": None,
        "adset_name": None,
        "impressions": 0,
        "clicks": 0,
        "inline_link_clicks": 0,
        "spend": 0.0,
        "lpv": 0,
        "plays": 0,
        "hook_wsum": 0.0,
        "video_watched_p50_wsum": 0.0,  # Soma ponderada de video_watched_p50
        # Curva de retenção agregada (ponderada por plays, mesma lógica do hook)
        "curve_weighted": {},  # {segundo_index: {"weighted_sum": float, "plays_sum": int}}
        "conversions": {},
    }
    
    # Series accumulator (5 dias)
    series_acc: Dict[str, Any] = {
        "impressions": {d: 0 for d in axis},
        "clicks": {d: 0 for d in axis},
        "inline": {d: 0 for d in axis},
        "spend": {d: 0.0 for d in axis},
        "plays": {d: 0 for d in axis},
        "lpv": {d: 0 for d in axis},
        "hook_wsum": {d: 0.0 for d in axis},
        "conversions": {d: {} for d in axis},
        "mql_count": {d: 0 for d in axis},
    }

    for r in data:
        # Preencher metadados uma vez (devem ser consistentes para o mesmo ad_id)
        if not agg["account_id"]:
            agg["account_id"] = r.get("account_id")
            agg["ad_name"] = r.get("ad_name")
            agg["campaign_name"] = r.get("campaign_name")
            agg["adset_name"] = r.get("adset_name")

        date = str(r.get("date"))[:10]
        clicks = int(r.get("clicks") or 0)
        impressions = int(r.get("impressions") or 0)
        inline_link_clicks = int(r.get("inline_link_clicks") or 0)
        spend = float(r.get("spend") or 0)
        leadscore_values = r.get("leadscore_values") or []
        plays = int(r.get("video_total_plays") or 0)
        curve = r.get("video_play_curve_actions") or []
        hook = _hook_at_3_from_curve(curve)
        video_watched_p50 = int(r.get("video_watched_p50") or 0)

        # landing_page_views
        lpv = 0
        try:
            for a in (r.get("actions") or []):
                if str(a.get("action_type")) == "landing_page_view":
                    lpv += int(a.get("value") or 0)
        except Exception:
            lpv = 0

        # Agregar totais
        agg["impressions"] += impressions
        agg["clicks"] += clicks
        agg["inline_link_clicks"] += inline_link_clicks
        agg["spend"] += spend
        agg["lpv"] += lpv
        agg["plays"] += plays
        agg["hook_wsum"] += hook * plays
        agg["video_watched_p50_wsum"] += video_watched_p50 * plays  # Agregar video_watched_p50 ponderado por plays

        # Agregar curva de retenção ponderada por plays (mesma lógica do hook)
        if isinstance(curve, list) and plays > 0:
            try:
                for i, val in enumerate(curve):
                    val_num = int(val or 0)
                    if i not in agg["curve_weighted"]:
                        agg["curve_weighted"][i] = {"weighted_sum": 0.0, "plays_sum": 0}
                    agg["curve_weighted"][i]["weighted_sum"] += val_num * plays
                    agg["curve_weighted"][i]["plays_sum"] += plays
            except Exception:
                pass

        # Agregar conversions e actions
        try:
            # Processar conversions
            for c in (r.get("conversions") or []):
                action_type = str(c.get("action_type") or "")
                value = int(c.get("value") or 0)
                if action_type:
                    key = f"conversion:{action_type}"
                    if key not in agg["conversions"]:
                        agg["conversions"][key] = 0
                    agg["conversions"][key] += value
            
            # Processar actions
            for a in (r.get("actions") or []):
                action_type = str(a.get("action_type") or "")
                value = int(a.get("value") or 0)
                if action_type:
                    key = f"action:{action_type}"
                    if key not in agg["conversions"]:
                        agg["conversions"][key] = 0
                    agg["conversions"][key] += value
        except Exception:
            pass

        # Séries 5 dias
        if date in axis:
            series_acc["impressions"][date] += impressions
            series_acc["clicks"][date] += clicks
            series_acc["inline"][date] += inline_link_clicks
            series_acc["spend"][date] += spend
            series_acc["lpv"][date] += lpv
            series_acc["plays"][date] += plays
            series_acc["hook_wsum"][date] += hook * plays
            try:
                series_acc["mql_count"][date] += _count_mql(leadscore_values, mql_leadscore_min)
            except Exception:
                pass
            try:
                # Processar conversions
                for c in (r.get("conversions") or []):
                    action_type = str(c.get("action_type") or "")
                    value = int(c.get("value") or 0)
                    if action_type:
                        key = f"conversion:{action_type}"
                        if key not in series_acc["conversions"][date]:
                            series_acc["conversions"][date][key] = 0
                        series_acc["conversions"][date][key] += value
                
                # Processar actions
                for a in (r.get("actions") or []):
                    action_type = str(a.get("action_type") or "")
                    value = int(a.get("value") or 0)
                    if action_type:
                        key = f"action:{action_type}"
                        if key not in series_acc["conversions"][date]:
                            series_acc["conversions"][date][key] = 0
                        series_acc["conversions"][date][key] += value
            except Exception:
                pass

    # Buscar thumbnail e informações adicionais da tabela ads
    thumbnail: Optional[str] = None
    try:
        ads_res = sb.table("ads").select("ad_id,thumb_storage_path,thumbnail_url,adcreatives_videos_thumbs,creative_video_id").eq("user_id", user["user_id"]).eq("ad_id", ad_id).limit(1).execute()
        if ads_res.data:
            thumbnail = _get_storage_thumb_if_any(ads_res.data[0]) or _get_thumbnail_with_fallback(ads_res.data[0])
    except Exception as e:
        logger.warning(f"Erro ao buscar thumbnail (ad details): {e}")

    # Calcular métricas derivadas
    ctr = _safe_div(agg["clicks"], agg["impressions"]) if agg["impressions"] else 0
    hook = _safe_div(agg["hook_wsum"], agg["plays"]) if agg["plays"] else 0
    video_watched_p50 = _safe_div(agg["video_watched_p50_wsum"], agg["plays"]) if agg["plays"] else 0
    connect_rate = _safe_div(agg["lpv"], agg["inline_link_clicks"]) if agg["inline_link_clicks"] else 0
    cpm = (_safe_div(agg["spend"], agg["impressions"]) * 1000.0) if agg["impressions"] else 0
    website_ctr = _safe_div(agg["inline_link_clicks"], agg["impressions"]) if agg["impressions"] else 0

    # Calcular curva de retenção agregada (média ponderada por plays)
    aggregated_curve: List[int] = []
    if agg.get("curve_weighted"):
        max_curve_len = max(agg["curve_weighted"].keys()) + 1 if agg["curve_weighted"] else 0
        for i in range(max_curve_len):
            if i in agg["curve_weighted"]:
                w = agg["curve_weighted"][i]
                if w["plays_sum"] > 0:
                    aggregated_curve.append(int(round(w["weighted_sum"] / w["plays_sum"])))
                else:
                    aggregated_curve.append(0)
            else:
                aggregated_curve.append(0)

    series = _build_rankings_series(axis, series_acc, include_cpmql=True)

    return {
        "account_id": agg["account_id"],
        "ad_id": agg["ad_id"],
        "ad_name": agg["ad_name"],
        "campaign_name": agg["campaign_name"],
        "adset_name": agg["adset_name"],
        "impressions": agg["impressions"],
        "clicks": agg["clicks"],
        "inline_link_clicks": agg["inline_link_clicks"],
        "spend": agg["spend"],
        "lpv": agg["lpv"],
        "plays": agg["plays"],
        "hook": hook,
        "video_watched_p50": int(round(video_watched_p50)) if video_watched_p50 else 0,
        "ctr": ctr,
        "connect_rate": connect_rate,
        "cpm": cpm,
        "website_ctr": website_ctr,
        "conversions": agg["conversions"],
        "thumbnail": thumbnail,
        "video_play_curve_actions": aggregated_curve if aggregated_curve else None,
        "series": series,
    }


@router.get("/rankings/ad-id/{ad_id}/creative")
def get_ad_creative(ad_id: str, user=Depends(get_current_user)):
    """Retorna apenas creative e video_ids de um anúncio (leve, para uso em player de vídeo)."""
    sb = get_supabase_for_user(user["token"])
    try:
        ads_res = sb.table("ads").select("creative,adcreatives_videos_ids,creative_video_id").eq("user_id", user["user_id"]).eq("ad_id", ad_id).limit(1).execute()
        if ads_res.data and len(ads_res.data) > 0:
            ad_row = ads_res.data[0]
            creative = ad_row.get("creative") or {}
            # Garantir que creative_video_id esteja no creative se não estiver
            if not creative.get("video_id") and ad_row.get("creative_video_id"):
                creative["video_id"] = ad_row.get("creative_video_id")
            return {
                "creative": creative,
                "adcreatives_videos_ids": ad_row.get("adcreatives_videos_ids") or [],
            }
        return {"creative": {}, "adcreatives_videos_ids": []}
    except Exception as e:
        logger.warning(f"Erro ao buscar creative para ad_id={ad_id}: {e}")
        return {"creative": {}, "adcreatives_videos_ids": []}


@router.get("/rankings/ad-id/{ad_id}/history")
def get_ad_history(
    ad_id: str,
    date_start: str,
    date_stop: str,
    user=Depends(get_current_user)
):
    """Retorna dados históricos diários de um anúncio para o período especificado.
    
    Retorna um array de objetos, um para cada dia do período, contendo todas as métricas diárias.
    """
    sb = get_supabase_for_user(user["token"])
    
    # Gerar array de datas do período
    axis = _axis_date_range(date_start, date_stop)
    
    # Buscar dados diários do período
    def metrics_filters(q):
        return q.eq("ad_id", ad_id).gte("date", date_start).lte("date", date_stop)
    
    data = _fetch_all_paginated(
        sb,
        "ad_metrics",
        "ad_id,ad_name,account_id,campaign_name,adset_name,date,clicks,impressions,inline_link_clicks,spend,video_total_plays,video_watched_p50,conversions,actions,video_play_curve_actions",
        metrics_filters
    )
    
    # Criar mapa de dados por data
    data_by_date: Dict[str, Dict[str, Any]] = {}
    for r in data:
        date = str(r.get("date"))[:10]
        if date not in data_by_date:
            data_by_date[date] = {
                "date": date,
                "impressions": 0,
                "clicks": 0,
                "inline_link_clicks": 0,
                "spend": 0.0,
                "lpv": 0,
                "plays": 0,
                "hook_wsum": 0.0,
                "video_watched_p50_wsum": 0.0,
                "conversions": {},
            }
        
        clicks = int(r.get("clicks") or 0)
        impressions = int(r.get("impressions") or 0)
        inline_link_clicks = int(r.get("inline_link_clicks") or 0)
        spend = float(r.get("spend") or 0)
        plays = int(r.get("video_total_plays") or 0)
        curve = r.get("video_play_curve_actions") or []
        hook = _hook_at_3_from_curve(curve)
        video_watched_p50 = int(r.get("video_watched_p50") or 0)
        
        # landing_page_views
        lpv = 0
        try:
            for a in (r.get("actions") or []):
                if str(a.get("action_type")) == "landing_page_view":
                    lpv += int(a.get("value") or 0)
        except Exception:
            lpv = 0
        
        # Conversões e actions
        conversions = r.get("conversions") or {}
        if isinstance(conversions, list):
            for conv in conversions:
                if isinstance(conv, dict):
                    action_type = str(conv.get("action_type") or "")
                    value = int(conv.get("value") or 0)
                    if action_type:
                        key = f"conversion:{action_type}"
                        data_by_date[date]["conversions"][key] = data_by_date[date]["conversions"].get(key, 0) + value
        
        actions = r.get("actions") or {}
        if isinstance(actions, list):
            for action in actions:
                if isinstance(action, dict):
                    action_type = str(action.get("action_type") or "")
                    value = int(action.get("value") or 0)
                    if action_type:
                        key = f"action:{action_type}"
                        data_by_date[date]["conversions"][key] = data_by_date[date]["conversions"].get(key, 0) + value
        
        data_by_date[date]["impressions"] += impressions
        data_by_date[date]["clicks"] += clicks
        data_by_date[date]["inline_link_clicks"] += inline_link_clicks
        data_by_date[date]["spend"] += spend
        data_by_date[date]["lpv"] += lpv
        data_by_date[date]["plays"] += plays
        data_by_date[date]["hook_wsum"] += hook * plays
        data_by_date[date]["video_watched_p50_wsum"] += video_watched_p50 * plays
    
    # Construir array de resultados com todas as datas do período
    result = []
    for date in axis:
        day_data = data_by_date.get(date, {
            "date": date,
            "impressions": 0,
            "clicks": 0,
            "inline_link_clicks": 0,
            "spend": 0.0,
            "lpv": 0,
            "plays": 0,
            "hook_wsum": 0.0,
            "video_watched_p50_wsum": 0.0,
            "conversions": {},
        })
        
        # Calcular métricas derivadas
        ctr = _safe_div(day_data["clicks"], day_data["impressions"])
        hook = _safe_div(day_data["hook_wsum"], day_data["plays"]) if day_data["plays"] else 0
        video_watched_p50 = _safe_div(day_data["video_watched_p50_wsum"], day_data["plays"]) if day_data["plays"] else 0
        connect_rate = _safe_div(day_data["lpv"], day_data["inline_link_clicks"]) if day_data["inline_link_clicks"] else 0
        cpm = (_safe_div(day_data["spend"], day_data["impressions"]) * 1000.0) if day_data["impressions"] else 0
        
        result.append({
            "date": date,
            "impressions": day_data["impressions"],
            "clicks": day_data["clicks"],
            "inline_link_clicks": day_data["inline_link_clicks"],
            "spend": day_data["spend"],
            "lpv": day_data["lpv"],
            "plays": day_data["plays"],
            "hook": hook,
            "video_watched_p50": int(round(video_watched_p50)) if video_watched_p50 else 0,
            "ctr": ctr,
            "connect_rate": connect_rate,
            "cpm": cpm,
            "conversions": day_data["conversions"],
        })
    
    return {"data": result}


@router.get("/rankings/ad-name/{ad_name}/history")
def get_ad_name_history(
    ad_name: str,
    date_start: str,
    date_stop: str,
    user=Depends(get_current_user)
):
    """Retorna dados históricos diários agregados por *ad_name* para o período especificado.

    Soma métricas de todos os `ad_metrics` que possuem o mesmo `ad_name`, agrupando por `date`.
    """
    sb = get_supabase_for_user(user["token"])

    # Gerar array de datas do período (inclusive)
    axis = _axis_date_range(date_start, date_stop)

    # Buscar dados diários do período filtrando por ad_name
    def metrics_filters(q):
        return q.eq("ad_name", ad_name).gte("date", date_start).lte("date", date_stop)

    data = _fetch_all_paginated(
        sb,
        "ad_metrics",
        "ad_id,ad_name,account_id,campaign_name,adset_name,date,clicks,impressions,inline_link_clicks,spend,video_total_plays,video_watched_p50,conversions,actions,video_play_curve_actions",
        metrics_filters
    )

    # Agregar por data
    data_by_date: Dict[str, Dict[str, Any]] = {}
    for r in data:
        date = str(r.get("date"))[:10]
        if date not in data_by_date:
            data_by_date[date] = {
                "date": date,
                "impressions": 0,
                "clicks": 0,
                "inline_link_clicks": 0,
                "spend": 0.0,
                "lpv": 0,
                "plays": 0,
                "hook_wsum": 0.0,
                "video_watched_p50_wsum": 0.0,
                "conversions": {},
            }

        clicks = int(r.get("clicks") or 0)
        impressions = int(r.get("impressions") or 0)
        inline_link_clicks = int(r.get("inline_link_clicks") or 0)
        spend = float(r.get("spend") or 0)
        plays = int(r.get("video_total_plays") or 0)
        curve = r.get("video_play_curve_actions") or []
        hook = _hook_at_3_from_curve(curve)
        video_watched_p50 = int(r.get("video_watched_p50") or 0)

        # landing_page_views
        lpv = 0
        try:
            for a in (r.get("actions") or []):
                if str(a.get("action_type")) == "landing_page_view":
                    lpv += int(a.get("value") or 0)
        except Exception:
            lpv = 0

        # Conversões e actions
        conversions = r.get("conversions") or {}
        if isinstance(conversions, list):
            for conv in conversions:
                if isinstance(conv, dict):
                    action_type = str(conv.get("action_type") or "")
                    value = int(conv.get("value") or 0)
                    if action_type:
                        key = f"conversion:{action_type}"
                        data_by_date[date]["conversions"][key] = data_by_date[date]["conversions"].get(key, 0) + value
        
        actions = r.get("actions") or {}
        if isinstance(actions, list):
            for action in actions:
                if isinstance(action, dict):
                    action_type = str(action.get("action_type") or "")
                    value = int(action.get("value") or 0)
                    if action_type:
                        key = f"action:{action_type}"
                        data_by_date[date]["conversions"][key] = data_by_date[date]["conversions"].get(key, 0) + value

        data_by_date[date]["impressions"] += impressions
        data_by_date[date]["clicks"] += clicks
        data_by_date[date]["inline_link_clicks"] += inline_link_clicks
        data_by_date[date]["spend"] += spend
        data_by_date[date]["lpv"] += lpv
        data_by_date[date]["plays"] += plays
        data_by_date[date]["hook_wsum"] += hook * plays
        data_by_date[date]["video_watched_p50_wsum"] += video_watched_p50 * plays

    # Construir array de resultados com todas as datas do período
    result: List[Dict[str, Any]] = []
    for date in axis:
        day_data = data_by_date.get(date, {
            "date": date,
            "impressions": 0,
            "clicks": 0,
            "inline_link_clicks": 0,
            "spend": 0.0,
            "lpv": 0,
            "plays": 0,
            "hook_wsum": 0.0,
            "video_watched_p50_wsum": 0.0,
            "conversions": {},
        })

        ctr = _safe_div(day_data["clicks"], day_data["impressions"])
        hook_val = _safe_div(day_data["hook_wsum"], day_data["plays"]) if day_data["plays"] else 0
        video_watched_p50_val = _safe_div(day_data["video_watched_p50_wsum"], day_data["plays"]) if day_data["plays"] else 0
        connect_rate = _safe_div(day_data["lpv"], day_data["inline_link_clicks"]) if day_data["inline_link_clicks"] else 0
        cpm = (_safe_div(day_data["spend"], day_data["impressions"]) * 1000.0) if day_data["impressions"] else 0

        result.append({
            "date": date,
            "impressions": day_data["impressions"],
            "clicks": day_data["clicks"],
            "inline_link_clicks": day_data["inline_link_clicks"],
            "spend": day_data["spend"],
            "lpv": day_data["lpv"],
            "plays": day_data["plays"],
            "hook": hook_val,
            "video_watched_p50": int(round(video_watched_p50_val)) if video_watched_p50_val else 0,
            "ctr": ctr,
            "connect_rate": connect_rate,
            "cpm": cpm,
            "conversions": day_data["conversions"],
        })

    return {"data": result}

@router.post("/dashboard")
def get_dashboard(req: DashboardRequest, user=Depends(get_current_user)):
    sb = get_supabase_for_user(user["token"])
    
    # Usar paginação para contornar limite de 1000 linhas do Supabase
    def metrics_filters(q):
        q = q.gte("date", req.date_start).lte("date", req.date_stop)
        if req.adaccount_ids:
            q = q.in_("account_id", req.adaccount_ids)
        return q
    
    rows = _fetch_all_paginated(
        sb,
        "ad_metrics",
        "clicks,impressions,inline_link_clicks,reach,video_total_plays,video_total_thruplays,spend,cpm,ctr,frequency,website_ctr,conversions,actions",
        metrics_filters
    )

    totals = {
        "spend": 0.0,
        "impressions": 0,
        "reach": 0,
        "clicks": 0,
        "inline_link_clicks": 0,
        "video_total_plays": 0,
        "video_total_thruplays": 0,
        "lpv": 0,
    }

    for r in rows:
        totals["spend"] += float(r.get("spend") or 0)
        totals["impressions"] += int(r.get("impressions") or 0)
        totals["reach"] += int(r.get("reach") or 0)
        totals["clicks"] += int(r.get("clicks") or 0)
        totals["inline_link_clicks"] += int(r.get("inline_link_clicks") or 0)
        totals["video_total_plays"] += int(r.get("video_total_plays") or 0)
        totals["video_total_thruplays"] += int(r.get("video_total_thruplays") or 0)
        try:
            for a in (r.get("actions") or []):
                if str(a.get("action_type")) == "landing_page_view":
                    totals["lpv"] += int(a.get("value") or 0)
        except Exception:
            pass

    ctr = _safe_div(totals["clicks"], totals["impressions"])
    cpm = (_safe_div(totals["spend"], totals["impressions"]) * 1000.0)
    frequency = _safe_div(totals["impressions"], totals["reach"]) if totals["reach"] else 0
    website_ctr = _safe_div(totals["inline_link_clicks"], totals["impressions"]) if totals["impressions"] else 0
    connect_rate = _safe_div(totals["lpv"], totals["inline_link_clicks"]) if totals["inline_link_clicks"] else 0

    return {
        "totals": {
            **totals,
            "ctr": ctr,
            "cpm": cpm,
            "frequency": frequency,
            "website_ctr": website_ctr,
            "connect_rate": connect_rate,
        }
    }


@router.get("/packs")
def list_packs(user=Depends(get_current_user), include_ads: bool = Query(default=False)):
    """Lista todos os packs do usuário do Supabase.
    
    Args:
        include_ads: Se True, também busca os ads de cada pack (pode ser lento)
    """
    try:
        packs = supabase_repo.list_packs(user["token"], user["user_id"])
        
        # Garantir que todos os packs tenham stats calculados
        # Se stats estiver ausente, vazio ou inválido, calcular dinamicamente
        for pack in packs:
            pack_id = pack.get("id")
            if not pack_id:
                continue
                
            stats = pack.get("stats")
            # Verificar se stats está ausente, None, vazio ou inválido
            if not stats or not isinstance(stats, dict) or len(stats) == 0 or stats.get("totalSpend") is None:
                # Calcular stats dinamicamente
                calculated_stats = supabase_repo.calculate_pack_stats(
                    user["token"],
                    pack_id,
                    user_id=user["user_id"]
                )
                if calculated_stats:
                    # Atualizar pack com stats calculados
                    pack["stats"] = calculated_stats
                    # Salvar stats no banco para próximas consultas
                    try:
                        supabase_repo.update_pack_stats(
                            user["token"],
                            pack_id,
                            calculated_stats,
                            user_id=user["user_id"]
                        )
                        logger.info(f"[LIST_PACKS] Stats calculados e salvos para pack {pack_id}")
                    except Exception as update_error:
                        logger.warning(f"[LIST_PACKS] Erro ao salvar stats do pack {pack_id}: {update_error}")
                        # Continuar mesmo se falhar ao salvar - stats já estão no pack
        
        # Se solicitado, buscar ads para cada pack
        if include_ads:
            packs_with_ads = []
            for pack in packs:
                ads = supabase_repo.get_ads_for_pack(user["token"], pack, user["user_id"])
                pack["ads"] = ads
                packs_with_ads.append(pack)
            return {"success": True, "packs": packs_with_ads}
        
        return {"success": True, "packs": packs}
    except Exception as e:
        logger.exception(f"Erro ao listar packs: {e}")
        raise HTTPException(status_code=500, detail=f"Erro ao listar packs: {str(e)}")


@router.get("/packs/{pack_id}")
def get_pack(pack_id: str, user=Depends(get_current_user), include_ads: bool = Query(default=True)):
    """Busca um pack específico do Supabase.
    
    Args:
        include_ads: Se True, também busca os ads do pack (padrão: True)
    """
    try:
        pack = supabase_repo.get_pack(user["token"], pack_id, user["user_id"])
        if not pack:
            raise HTTPException(status_code=404, detail="Pack não encontrado")
        
        # Garantir que o pack tenha stats calculados
        # Se stats estiver ausente, vazio ou inválido, calcular dinamicamente
        stats = pack.get("stats")
        if not stats or not isinstance(stats, dict) or len(stats) == 0 or stats.get("totalSpend") is None:
            # Calcular stats dinamicamente
            calculated_stats = supabase_repo.calculate_pack_stats(
                user["token"],
                pack_id,
                user_id=user["user_id"]
            )
            if calculated_stats:
                # Atualizar pack com stats calculados
                pack["stats"] = calculated_stats
                # Salvar stats no banco para próximas consultas
                try:
                    supabase_repo.update_pack_stats(
                        user["token"],
                        pack_id,
                        calculated_stats,
                        user_id=user["user_id"]
                    )
                    logger.info(f"[GET_PACK] Stats calculados e salvos para pack {pack_id}")
                except Exception as update_error:
                    logger.warning(f"[GET_PACK] Erro ao salvar stats do pack {pack_id}: {update_error}")
                    # Continuar mesmo se falhar ao salvar - stats já estão no pack
        
        # Buscar ads se solicitado
        if include_ads:
            ads = supabase_repo.get_ads_for_pack(user["token"], pack, user["user_id"])
            pack["ads"] = ads
        
        return {"success": True, "pack": pack}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Erro ao buscar pack {pack_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Erro ao buscar pack: {str(e)}")


@router.post("/packs/{pack_id}/cache-thumbnails")
def cache_pack_thumbnails(pack_id: str, user=Depends(get_current_user)):
    """Backfill (on-demand) de thumbnails no Storage para packs antigos.

    - Usa somente `adcreatives_videos_thumbs[0]`
    - Cacheia apenas quando `ads.thumb_storage_path` estiver vazio
    - Best-effort: falhas individuais não quebram o processo inteiro
    """
    sb = get_supabase_for_user(user["token"])
    user_id = user["user_id"]

    # 1) Carregar ad_ids do pack
    pres = sb.table("packs").select("id,ad_ids").eq("id", pack_id).eq("user_id", user_id).limit(1).execute()
    if not pres.data:
        raise HTTPException(status_code=404, detail="Pack não encontrado")
    ad_ids = pres.data[0].get("ad_ids") or []
    if not isinstance(ad_ids, list) or not ad_ids:
        return {"success": True, "pack_id": pack_id, "cached": 0, "eligible": 0, "skipped": 0, "failed": 0}

    # 2) Buscar ads e determinar elegíveis (sem thumb_storage_path e com thumbs[0])
    ad_id_to_thumb_url: Dict[str, str] = {}
    skipped = 0
    failed = 0

    batch_size = 400
    for i in range(0, len(ad_ids), batch_size):
        batch_ids = [str(x) for x in ad_ids[i:i + batch_size] if x]
        if not batch_ids:
            continue
        try:
            def ads_filters(q):
                return q.eq("user_id", user_id).in_("ad_id", batch_ids)

            ads_rows = _fetch_all_paginated(
                sb,
                "ads",
                "ad_id,thumb_storage_path,adcreatives_videos_thumbs",
                ads_filters,
            )
        except Exception as e:
            # Se o schema ainda não estiver aplicado em algum ambiente, degradar com mensagem clara
            raise HTTPException(status_code=500, detail=f"Falha ao ler ads para backfill: {str(e)}")

        for r in (ads_rows or []):
            ad_id = str(r.get("ad_id") or "").strip()
            if not ad_id:
                continue
            existing_path = str(r.get("thumb_storage_path") or "").strip()
            if existing_path:
                skipped += 1
                continue
            thumbs = r.get("adcreatives_videos_thumbs")
            if isinstance(thumbs, list) and thumbs:
                first = str(thumbs[0] or "").strip()
                if first:
                    ad_id_to_thumb_url[ad_id] = first
                else:
                    skipped += 1
            else:
                skipped += 1

    eligible = len(ad_id_to_thumb_url)
    if eligible == 0:
        return {"success": True, "pack_id": pack_id, "cached": 0, "eligible": 0, "skipped": skipped, "failed": failed}

    # 3) Cache em paralelo
    cached_map = cache_first_thumbs_for_ads(user_id=str(user_id), ad_id_to_thumb_url=ad_id_to_thumb_url)
    cached = 0
    upload_success = len(cached_map)

    # 4) Persistir no DB (update por ad_id)
    for ad_id, c in cached_map.items():
        try:
            sb.table("ads").update(
                {
                    "thumb_storage_path": c.storage_path,
                    "thumb_cached_at": c.cached_at,
                    "thumb_source_url": c.source_url,
                }
            ).eq("ad_id", ad_id).eq("user_id", user_id).execute()
            cached += 1
        except Exception:
            failed += 1

    return {
        "success": True,
        "pack_id": pack_id,
        "eligible": eligible,
        "upload_success": upload_success,
        "cached": cached,
        "skipped": skipped,
        "failed": max(0, eligible - cached),
    }


@router.delete("/packs/{pack_id}")
def delete_pack(
    pack_id: str,
    request: DeletePackRequest = Body(...),
    user=Depends(get_current_user)
):
    """Deleta um pack e todos os dados relacionados (ads e ad_metrics) em cascata."""
    try:
        result = supabase_repo.delete_pack(
            user["token"],
            pack_id=pack_id,
            ad_ids=request.ad_ids or [],  # Opcional, backend busca do pack se não fornecido
            user_id=user["user_id"]
        )
        
        return {
            "success": True,
            "pack_id": pack_id,
            "stats": {
                "pack_deleted": result.get("pack_deleted", False),
                "ads_deleted": result.get("ads_deleted", 0),
                "metrics_deleted": result.get("metrics_deleted", 0),
            }
        }
    except Exception as e:
        logger.exception(f"Erro ao deletar pack {pack_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Erro ao deletar pack: {str(e)}")


@router.patch("/packs/{pack_id}/auto-refresh")
def update_pack_auto_refresh(
    pack_id: str,
    request: UpdatePackAutoRefreshRequest = Body(...),
    user=Depends(get_current_user)
):
    """Atualiza o campo auto_refresh de um pack."""
    try:
        # Verificar se o pack existe e pertence ao usuário
        pack = supabase_repo.get_pack(user["token"], pack_id, user["user_id"])
        if not pack:
            raise HTTPException(status_code=404, detail="Pack não encontrado")
        
        # Atualizar auto_refresh
        supabase_repo.update_pack_auto_refresh(
            user["token"],
            pack_id,
            user["user_id"],
            request.auto_refresh
        )
        
        return {
            "success": True,
            "pack_id": pack_id,
            "auto_refresh": request.auto_refresh
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Erro ao atualizar auto_refresh do pack {pack_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Erro ao atualizar auto_refresh: {str(e)}")


@router.patch("/packs/{pack_id}/name")
def update_pack_name(
    pack_id: str,
    request: UpdatePackNameRequest = Body(...),
    user=Depends(get_current_user)
):
    """Atualiza o nome de um pack."""
    try:
        # Verificar se o pack existe e pertence ao usuário
        pack = supabase_repo.get_pack(user["token"], pack_id, user["user_id"])
        if not pack:
            raise HTTPException(status_code=404, detail="Pack não encontrado")
        
        # Validar nome
        if not request.name or not request.name.strip():
            raise HTTPException(status_code=400, detail="Nome do pack não pode ser vazio")
        
        # Atualizar nome
        supabase_repo.update_pack_name(
            user["token"],
            pack_id,
            user["user_id"],
            request.name.strip()
        )
        
        return {
            "success": True,
            "pack_id": pack_id,
            "name": request.name.strip()
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Erro ao atualizar nome do pack {pack_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Erro ao atualizar nome: {str(e)}")



