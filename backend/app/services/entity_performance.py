"""Detalhe de UMA entidade (anúncio, criativo, conjunto) sobre o read model.

Migration 133 (2026-08-27). Antes, as 7 rotas de detalhe do Manager baixavam as
linhas cruas de `ad_metrics` via PostgREST (com os JSONs de actions/conversions/
leadscore/curva) e somavam em Python — sete cópias do mesmo bloco e uma SEGUNDA
implementação da matemática que `ad_performance_daily` já faz em SQL. O número do
modal e o número da tabela saíam de códigos diferentes.

Agora a RPC `fetch_entity_performance_v133` devolve, por grupo (a entidade ou cada
ad_id dela), os TOTAIS do período e as linhas por DIA da janela pedida, já com as
somas ponderadas (Σ hook×plays etc.), as conversões {chave: valor} e o histograma
de leads {score: qtd}. Este módulo é o ÚNICO lugar que transforma isso no formato
das rotas: razões (ctr, cpm…), série de 5 dias, curva, histórico por dia.

Contrato das rotas: inalterado — provado por `backend/scripts/diff_entity_routes.py`
(rota antiga × rota nova, sobre o laboratório).
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from app.core.client_disconnect import abort_if_client_gone
from app.core.supabase_retry import with_postgrest_retry

RPC_NAME = "fetch_entity_performance_v135"

# Campos inteiros e somas ponderadas que a RPC devolve em `totals` e em cada dia.
INT_FIELDS = ("impressions", "clicks", "inline_link_clicks", "lpv", "plays", "thruplays", "reach")
WSUM_FIELDS = (
    "hook_wsum",
    "scroll_stop_wsum",
    "hold_rate_wsum",
    "video_watched_p50_wsum",
    "video_watched_p75_wsum",
)


class EntityPerformanceForbidden(Exception):
    """A RPC recusou o escopo (pack inacessível na seleção / ator ≠ p_user_id)."""


class EntityPerformanceBadRequest(Exception):
    """Parâmetro inválido (entidade desconhecida, id vazio)."""


# ---------------------------------------------------------------------------
# Datas e divisão segura (eram helpers privados de analytics.py; vivem aqui para
# que o agregador e as rotas usem a MESMA implementação)
# ---------------------------------------------------------------------------

def to_date(s: str) -> datetime:
    return datetime(int(s[0:4]), int(s[5:7]), int(s[8:10]))


def axis_5_days(end_date: str) -> List[str]:
    end = to_date(end_date)
    return [(end - timedelta(days=i)).strftime("%Y-%m-%d") for i in range(4, -1, -1)]


def axis_date_range(start_date: str, end_date: str) -> List[str]:
    """Datas entre start_date e end_date (inclusive); vazio se start > end."""
    start = to_date(start_date)
    end = to_date(end_date)
    dates: List[str] = []
    current = start
    while current <= end:
        dates.append(current.strftime("%Y-%m-%d"))
        current += timedelta(days=1)
    return dates


def safe_div(a: float, b: float) -> float:
    return (a / b) if b else 0.0


# ---------------------------------------------------------------------------
# Chamada da RPC
# ---------------------------------------------------------------------------

def clean_pack_ids(pack_ids: Optional[List[str]]) -> Optional[List[str]]:
    """Lista limpa ou None (None = ramo legado: o silo do ator, sem filtro de pack)."""
    cleaned = [str(p).strip() for p in (pack_ids or []) if str(p or "").strip()]
    return cleaned or None


def fetch_entity_performance(
    sb,
    *,
    user_id: str,
    date_start: str,
    date_stop: str,
    entity: str,
    entity_id: str,
    pack_ids: Optional[List[str]] = None,
    group_by: str = "entity",
    include_curve: bool = False,
    series_days: Optional[int] = None,
    include_custom: bool = False,
) -> Dict[str, Any]:
    """Uma chamada à RPC; devolve {"mql_leadscore_min": float|None, "groups": [...]}.

    `include_custom` (migration 140): liga `totals.custom_histograms` — os histogramas
    das colunas vinculadas da planilha, somados no período. Desligado, a RPC nem os
    agrega (custo zero para quem não vincula coluna).

    `entity`: ad_id | ad_name | adset_id. `group_by`: 'entity' (um grupo) ou 'ad_id'
    (um grupo por anúncio — telas de filhos). `series_days`: quantos dias, contados
    do fim do período, vêm como linhas por dia (None = todos; histórico).
    """
    params: Dict[str, Any] = {
        "p_user_id": str(user_id),
        "p_date_start": date_start,
        "p_date_stop": date_stop,
        "p_entity": entity,
        "p_entity_id": entity_id,
        "p_pack_ids": clean_pack_ids(pack_ids),
        "p_group_by": group_by,
        "p_include_curve": bool(include_curve),
        "p_series_days": series_days,
        "p_include_custom": bool(include_custom),
    }

    # Leitura pura: quem já desligou não ocupa o banco.
    abort_if_client_gone(f"drill:{entity}")

    def _run():
        return sb.rpc(RPC_NAME, params).execute()

    try:
        res = with_postgrest_retry("entity_performance_rpc", _run)
    except Exception as e:  # noqa: BLE001 - classificação por código do Postgres
        code = str(getattr(e, "code", "") or "")
        if code == "42501":
            raise EntityPerformanceForbidden(str(e)) from e
        if code == "22023":
            raise EntityPerformanceBadRequest(str(e)) from e
        raise

    data = getattr(res, "data", None)
    if not isinstance(data, dict):
        data = {}
    groups = [g for g in (data.get("groups") or []) if isinstance(g, dict)]
    return {"mql_leadscore_min": _float_or_none(data.get("mql_leadscore_min")), "groups": groups}


def single_group(payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    groups = payload.get("groups") or []
    return groups[0] if groups else None


# ---------------------------------------------------------------------------
# Números
# ---------------------------------------------------------------------------

def _float_or_none(v: Any) -> Optional[float]:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _f(v: Any) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def _i(v: Any) -> int:
    try:
        return int(float(v or 0))
    except (TypeError, ValueError):
        return 0


def _num(v: Any) -> Any:
    """Número JSON → int quando inteiro (a RPC soma numeric: 11.0), senão float."""
    if isinstance(v, bool):
        return int(v)
    if isinstance(v, int):
        return v
    try:
        f = float(v)
    except (TypeError, ValueError):
        return 0
    return int(f) if f.is_integer() else f


def expand_leads(leads: Any) -> List[float]:
    """Histograma {score: qtd} → lista de scores (ordenada por score)."""
    out: List[float] = []
    if not isinstance(leads, dict):
        return out
    items: List[Tuple[float, int]] = []
    for k, v in leads.items():
        try:
            items.append((float(k), int(v or 0)))
        except (TypeError, ValueError):
            continue
    for score, qty in sorted(items):
        if qty > 0:
            out.extend([score] * qty)
    return out


def count_mql(leads: Any, mql_leadscore_min: Optional[float]) -> Optional[int]:
    """Quantos leads ≥ corte; None quando o corte é indefinido (não é zero)."""
    if mql_leadscore_min is None:
        return None
    cnt = 0
    if isinstance(leads, dict):
        for k, v in leads.items():
            try:
                if float(k) >= mql_leadscore_min:
                    cnt += int(v or 0)
            except (TypeError, ValueError):
                continue
    return cnt


def sum_count_leads(leads: Any) -> Tuple[float, int]:
    total = 0.0
    cnt = 0
    if isinstance(leads, dict):
        for k, v in leads.items():
            try:
                q = int(v or 0)
                total += float(k) * q
                cnt += q
            except (TypeError, ValueError):
                continue
    return total, cnt


def conversions_of(raw: Any) -> Dict[str, Any]:
    """{chave prefixada: valor} — chaves `conversion:*` e `action:*`, como sempre."""
    out: Dict[str, Any] = {}
    if isinstance(raw, dict):
        for k, v in raw.items():
            if k:
                out[str(k)] = _num(v)
    return out


def plain_conversions_of(raw: Any) -> Dict[str, Any]:
    """Só `conversions` da Meta, SEM prefixo — contrato histórico do detalhe do conjunto."""
    out: Dict[str, Any] = {}
    if isinstance(raw, dict):
        for k, v in raw.items():
            key = str(k or "")
            if key.startswith("conversion:") and len(key) > len("conversion:"):
                out[key[len("conversion:"):]] = _num(v)
    return out


# ---------------------------------------------------------------------------
# Agregação de um grupo
# ---------------------------------------------------------------------------

def totals_of(group: Dict[str, Any]) -> Dict[str, Any]:
    t = group.get("totals") or {}
    out: Dict[str, Any] = {k: _i(t.get(k)) for k in INT_FIELDS}
    out.update({k: _f(t.get(k)) for k in WSUM_FIELDS})
    out["spend"] = _f(t.get("spend"))
    out["conversions"] = conversions_of(t.get("conversions"))
    out["leads"] = t.get("leads") if isinstance(t.get("leads"), dict) else {}
    out["leadscore_values"] = expand_leads(out["leads"])
    # 140: {"<mapping_id>": {"<valor>": qtd}} — {} quando não pedido ou sem dado
    out["custom_histograms"] = t.get("custom_histograms") if isinstance(t.get("custom_histograms"), dict) else {}
    return out


def derived_of(t: Dict[str, Any]) -> Dict[str, Any]:
    """Razões do período — as MESMAS fórmulas das rotas antigas e do Manager."""
    plays = t["plays"]
    impressions = t["impressions"]
    inline = t["inline_link_clicks"]
    p50 = safe_div(t["video_watched_p50_wsum"], plays) if plays else 0
    p75 = safe_div(t["video_watched_p75_wsum"], plays) if plays else 0
    return {
        "ctr": safe_div(t["clicks"], impressions) if impressions else 0,
        "hook": safe_div(t["hook_wsum"], plays) if plays else 0,
        "hold_rate": safe_div(t["hold_rate_wsum"], plays) if plays else 0,
        "scroll_stop": safe_div(t["scroll_stop_wsum"], plays) if plays else 0,
        "video_watched_p50": int(round(p50)) if p50 else 0,
        "video_watched_p75": int(round(p75)) if p75 else 0,
        "connect_rate": safe_div(t["lpv"], inline) if inline else 0,
        "cpm": (safe_div(t["spend"], impressions) * 1000.0) if impressions else 0,
        "website_ctr": safe_div(inline, impressions) if impressions else 0,
        "frequency": round(impressions / t["reach"], 2) if t["reach"] > 0 else None,
    }


def new_series_acc(axis: List[str]) -> Dict[str, Any]:
    return {
        "impressions": {d: 0 for d in axis},
        "clicks": {d: 0 for d in axis},
        "inline": {d: 0 for d in axis},
        "spend": {d: 0.0 for d in axis},
        "plays": {d: 0 for d in axis},
        "lpv": {d: 0 for d in axis},
        "hook_wsum": {d: 0.0 for d in axis},
        "scroll_stop_wsum": {d: 0.0 for d in axis},
        "hold_rate_wsum": {d: 0.0 for d in axis},
        "video_watched_p50_wsum": {d: 0.0 for d in axis},
        "video_watched_p75_wsum": {d: 0.0 for d in axis},
        "conversions": {d: {} for d in axis},
        "mql_count": {d: 0 for d in axis},
        "leadscore_sum": {d: 0.0 for d in axis},
        "leadscore_count": {d: 0 for d in axis},
    }


def series_acc_of(
    group: Dict[str, Any],
    axis: List[str],
    mql_leadscore_min: Optional[float],
    *,
    plain_conversions: bool = False,
) -> Dict[str, Any]:
    """Acumulador por dia no formato que `build_rankings_series` consome.

    `plain_conversions`: chaves sem prefixo e só as conversões da Meta — o contrato
    histórico do detalhe do conjunto (totais E série).
    """
    S = new_series_acc(axis)
    conv_fn = plain_conversions_of if plain_conversions else conversions_of
    for day in group.get("days") or []:
        if not isinstance(day, dict):
            continue
        d = str(day.get("date") or "")[:10]
        if d not in S["impressions"]:
            continue
        S["impressions"][d] += _i(day.get("impressions"))
        S["clicks"][d] += _i(day.get("clicks"))
        S["inline"][d] += _i(day.get("inline_link_clicks"))
        S["spend"][d] += _f(day.get("spend"))
        S["plays"][d] += _i(day.get("plays"))
        S["lpv"][d] += _i(day.get("lpv"))
        for k in WSUM_FIELDS:
            S[k][d] += _f(day.get(k))
        conv_day = S["conversions"][d]
        for k, v in conv_fn(day.get("conversions")).items():
            conv_day[k] = conv_day.get(k, 0) + v
        leads = day.get("leads")
        S["mql_count"][d] += count_mql(leads, mql_leadscore_min) or 0
        ls_sum, ls_cnt = sum_count_leads(leads)
        S["leadscore_sum"][d] += ls_sum
        S["leadscore_count"][d] += ls_cnt
    return S


def curve_of(group: Dict[str, Any]) -> Optional[List[int]]:
    """Curva de retenção ponderada por plays: round(Σ ponto×plays / Σ plays) por índice."""
    wsum = group.get("curve_wsum")
    psum = group.get("curve_psum")
    if not isinstance(wsum, list) or not isinstance(psum, list) or not wsum:
        return None
    out: List[int] = []
    for w, p in zip(wsum, psum):
        pf = _f(p)
        out.append(int(round(_f(w) / pf)) if pf > 0 else 0)
    return out or None


def history_rows(group: Optional[Dict[str, Any]], axis: List[str], mql_leadscore_min: Optional[float]) -> List[Dict[str, Any]]:
    """Uma linha por dia do eixo (dias sem dado = zeros), no contrato de /history."""
    by_date: Dict[str, Dict[str, Any]] = {}
    for day in (group.get("days") if group else None) or []:
        if isinstance(day, dict):
            by_date[str(day.get("date") or "")[:10]] = day

    result: List[Dict[str, Any]] = []
    for d in axis:
        day = by_date.get(d) or {}
        impressions = _i(day.get("impressions"))
        clicks = _i(day.get("clicks"))
        inline = _i(day.get("inline_link_clicks"))
        spend = _f(day.get("spend"))
        lpv = _i(day.get("lpv"))
        plays = _i(day.get("plays"))
        reach = _i(day.get("reach"))
        p50 = safe_div(_f(day.get("video_watched_p50_wsum")), plays) if plays else 0
        if mql_leadscore_min is None:
            mqls: Optional[int] = None
            cpmql: Optional[float] = None
        else:
            mqls = count_mql(day.get("leads"), mql_leadscore_min) or 0
            cpmql = safe_div(spend, mqls) if mqls else 0
        result.append({
            "date": d,
            "impressions": impressions,
            "clicks": clicks,
            "inline_link_clicks": inline,
            "spend": spend,
            "lpv": lpv,
            "plays": plays,
            "hook": safe_div(_f(day.get("hook_wsum")), plays) if plays else 0,
            "video_watched_p50": int(round(p50)) if p50 else 0,
            "ctr": safe_div(clicks, impressions),
            "connect_rate": safe_div(lpv, inline) if inline else 0,
            "cpm": (safe_div(spend, impressions) * 1000.0) if impressions else 0,
            "hold_rate": safe_div(_f(day.get("hold_rate_wsum")), plays) if plays else 0,
            "scroll_stop": safe_div(_f(day.get("scroll_stop_wsum")), plays) if plays else 0,
            "frequency": safe_div(impressions, reach) if reach else 0,
            "mqls": mqls,
            "cpmql": cpmql,
            "conversions": conversions_of(day.get("conversions")),
        })
    return result


# ---------------------------------------------------------------------------
# Série de 5 dias (sparklines) — era `_build_rankings_series` em analytics.py
# ---------------------------------------------------------------------------

def build_rankings_series(
    axis: List[str],
    S: Optional[Dict[str, Any]],
    include_cpmql: bool = True,
    mql_available: bool = True,
) -> Dict[str, Any]:
    """Payload `series` no formato consumido pelo frontend (sparklines).

    `mql_available=False` (corte de leadscore indefinido ou divergente entre os
    packs) zera a AFIRMAÇÃO, não o valor: cpmql/mqls/mql_rate saem como null.
    `leadscore_avg` continua saindo, porque a média não depende do corte.

    A decisão olha o corte, nunca o acumulador. `mql_count` zerado é ambíguo —
    pode ser "nenhum lead atingiu o corte", que é um fato publicável.
    """
    if S is None:
        S = {}
    hook_series: List[Optional[float]] = []
    scroll_stop_series: List[Optional[float]] = []
    hold_rate_series: List[Optional[float]] = []
    video_watched_p50_series: List[Optional[float]] = []
    video_watched_p75_series: List[Optional[float]] = []
    plays_series: List[Optional[int]] = []
    thruplays_series: List[Optional[int]] = []
    reach_series: List[Optional[int]] = []
    spend_series: List[Optional[float]] = []
    clicks_series: List[Optional[int]] = []
    inline_link_clicks_series: List[Optional[int]] = []
    ctr_series: List[Optional[float]] = []
    connect_series: List[Optional[float]] = []
    lpv_series: List[Optional[int]] = []
    impressions_series: List[Optional[int]] = []
    cpm_series: List[Optional[float]] = []
    cpc_series: List[Optional[float]] = []
    cplc_series: List[Optional[float]] = []
    website_ctr_series: List[Optional[float]] = []
    conversions_series: List[Dict[str, int]] = []
    cpmql_series: List[Optional[float]] = []
    mqls_series: List[Optional[int]] = []
    leadscore_avg_series: List[Optional[float]] = []
    mql_rate_series: List[Optional[float]] = []

    for d in axis:
        plays = (S.get("plays") or {}).get(d, 0) or 0
        hook_wsum = (S.get("hook_wsum") or {}).get(d, 0.0) or 0.0
        hook_day = safe_div(hook_wsum, plays) if plays else None

        scroll_stop_wsum = (S.get("scroll_stop_wsum") or {}).get(d, 0.0) or 0.0
        scroll_stop_day = safe_div(scroll_stop_wsum, plays) if plays else None

        hold_rate_wsum = (S.get("hold_rate_wsum") or {}).get(d, 0.0) or 0.0
        hold_rate_day = safe_div(hold_rate_wsum, plays) if plays else None

        video_watched_p50_wsum = (S.get("video_watched_p50_wsum") or {}).get(d, 0.0) or 0.0
        video_watched_p50_day = safe_div(video_watched_p50_wsum, plays) if plays else None

        video_watched_p75_wsum = (S.get("video_watched_p75_wsum") or {}).get(d, 0.0) or 0.0
        video_watched_p75_day = safe_div(video_watched_p75_wsum, plays) if plays else None

        thruplays_day = (S.get("thruplays") or {}).get(d, 0) or 0
        reach_day = (S.get("reach") or {}).get(d, 0) or 0

        spend_day = (S.get("spend") or {}).get(d, 0.0) or 0.0
        clicks_day = (S.get("clicks") or {}).get(d, 0) or 0
        impr_day = (S.get("impressions") or {}).get(d, 0) or 0
        inline_day = (S.get("inline") or {}).get(d, 0) or 0
        lpv_day = (S.get("lpv") or {}).get(d, 0) or 0

        ctr_day = (clicks_day / impr_day) if impr_day else None
        connect_day = (lpv_day / inline_day) if inline_day else None
        cpm_day = (spend_day * 1000.0 / impr_day) if impr_day else None
        cpc_day = (spend_day / clicks_day) if clicks_day else None
        cplc_day = (spend_day / inline_day) if inline_day else None
        website_ctr_day = (inline_day / impr_day) if impr_day else None

        conversions_day = ((S.get("conversions") or {}).get(d, {})) or {}

        hook_series.append(hook_day)
        scroll_stop_series.append(scroll_stop_day)
        hold_rate_series.append(hold_rate_day)
        video_watched_p50_series.append(video_watched_p50_day)
        video_watched_p75_series.append(video_watched_p75_day)
        plays_series.append(plays if plays else None)
        thruplays_series.append(thruplays_day if thruplays_day else None)
        reach_series.append(reach_day if reach_day else None)
        spend_series.append(spend_day if spend_day else None)
        clicks_series.append(clicks_day if clicks_day else None)
        inline_link_clicks_series.append(inline_day if inline_day else None)
        ctr_series.append(ctr_day)
        connect_series.append(connect_day)
        lpv_series.append(lpv_day)
        impressions_series.append(impr_day if impr_day else None)
        cpm_series.append(cpm_day)
        cpc_series.append(cpc_day)
        cplc_series.append(cplc_day)
        website_ctr_series.append(website_ctr_day)
        conversions_series.append(conversions_day)

        if include_cpmql:
            leadscore_sum_day = ((S.get("leadscore_sum") or {}).get(d, 0.0)) or 0.0
            leadscore_count_day = ((S.get("leadscore_count") or {}).get(d, 0)) or 0
            # Independe do corte: é a média dos leads, não a fatia qualificada.
            leadscore_avg_series.append((leadscore_sum_day / leadscore_count_day) if leadscore_count_day > 0 else None)

            if not mql_available:
                cpmql_series.append(None)
                mqls_series.append(None)
                mql_rate_series.append(None)
            else:
                mql_count_day = ((S.get("mql_count") or {}).get(d, 0)) or 0
                cpmql_day = (spend_day / mql_count_day) if (mql_count_day and spend_day > 0) else None
                cpmql_series.append(cpmql_day)
                mqls_series.append(mql_count_day if mql_count_day > 0 else None)
                # Taxa de qualificação: MQLs sobre o TOTAL de leads do dia.
                mql_rate_series.append((mql_count_day / leadscore_count_day) if leadscore_count_day > 0 else None)

    series: Dict[str, Any] = {
        "axis": axis,
        "hook": hook_series,
        "scroll_stop": scroll_stop_series,
        "hold_rate": hold_rate_series,
        "video_watched_p50": video_watched_p50_series,
        "video_watched_p75": video_watched_p75_series,
        "plays": plays_series,
        "thruplays": thruplays_series,
        "reach": reach_series,
        "spend": spend_series,
        "clicks": clicks_series,
        "inline_link_clicks": inline_link_clicks_series,
        "ctr": ctr_series,
        "connect_rate": connect_series,
        "lpv": lpv_series,
        "impressions": impressions_series,
        "cpm": cpm_series,
        "cpc": cpc_series,
        "cplc": cplc_series,
        "website_ctr": website_ctr_series,
        "conversions": conversions_series,
    }
    if include_cpmql:
        series["cpmql"] = cpmql_series
        series["mqls"] = mqls_series
        series["leadscore_avg"] = leadscore_avg_series
        series["mql_rate"] = mql_rate_series
    return series


def series_of(
    group: Dict[str, Any],
    axis: List[str],
    mql_leadscore_min: Optional[float],
    *,
    plain_conversions: bool = False,
) -> Dict[str, Any]:
    """Série de sparkline (5 dias) de um grupo, pronta para a resposta."""
    return build_rankings_series(
        axis,
        series_acc_of(group, axis, mql_leadscore_min, plain_conversions=plain_conversions),
        include_cpmql=True,
        mql_available=mql_leadscore_min is not None,
    )
