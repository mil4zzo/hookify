"""
Seleção de ads sem entrega a partir do inventário (/act_X/ads) e síntese de linhas-zero.

O endpoint /insights da Meta é de performance, não de inventário: ads sem atividade
(impressions/spend = 0) no time_range simplesmente não retornam. O inventário do /ads
edge define o universo real do pack; ads presentes nele mas ausentes do insights
entram no pipeline como linhas-zero diárias — dado factual ("entregou 0 neste dia")
que materializa o ad em ad_metrics, de onde todo o read path (RPCs do Manager,
pack stats, ad_metric_pack_map) parte.
"""
import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Set

logger = logging.getLogger(__name__)

# Ads sem métricas só entram no universo se estiverem "tentando entregar".
# Pausados/arquivados/deletados sem métricas no range são ruído histórico
# (ver decisoes-tecnicas 2026-06-12). Valores validados no SDK oficial
# (facebook_business Ad.EffectiveStatus).
DELIVERABLE_STATUSES: Set[str] = {
    "ACTIVE",
    "PENDING_REVIEW",
    "IN_PROCESS",
    "WITH_ISSUES",
    "PREAPPROVED",
}

# Teto de segurança para packs sem filtro em contas gigantes: evita explodir
# formatted_data/upserts. Ads mais recentes têm prioridade; o corte é logado.
MAX_SYNTH_ROWS = 25000


def _parse_date(value: Any) -> Optional[datetime]:
    try:
        return datetime.strptime(str(value)[:10], "%Y-%m-%d")
    except Exception:
        return None


def count_ads_by_adset(inventory: List[Dict[str, Any]]) -> Dict[str, int]:
    """Total de ads por adset_id no inventário — TODOS os status, não só DELIVERABLE.

    É o denominador de "N / M anúncios" na aba Por conjunto. Ads pausados que nunca
    entregaram não existem em ad_metrics nem em ads (não vêm do /insights e não recebem
    linha-zero), então o count(distinct ad_id) da RPC os perdia e o total divergia do
    Gerenciador. O inventário é a única fonte que os enxerga.

    Espelha o Gerenciador: o edge /ads inclui pausados e exclui archived/deleted.
    """
    counts: Dict[str, int] = {}
    for ad in inventory or []:
        adset_id = str(ad.get("adset_id") or "").strip()
        if adset_id:
            counts[adset_id] = counts.get(adset_id, 0) + 1
    return counts


def select_zero_delivery_ads(
    inventory: List[Dict[str, Any]],
    known_ad_ids: Set[str],
) -> List[Dict[str, Any]]:
    """Filtra do inventário os ads entregáveis que não vieram no insights.

    `inventory`: linhas cruas do /ads edge (id, name, effective_status,
    created_time, adset_id, campaign_id, adset{name}, campaign{name}).
    `known_ad_ids`: ad_ids já presentes no raw_data do insights.
    """
    zero_ads: List[Dict[str, Any]] = []
    skipped_status = 0
    for row in inventory or []:
        ad_id = str(row.get("id") or "").strip()
        if not ad_id or ad_id in known_ad_ids:
            continue
        status = str(row.get("effective_status") or "").upper()
        if status not in DELIVERABLE_STATUSES:
            skipped_status += 1
            continue
        zero_ads.append(row)

    logger.info(
        "[AdInventory] Universo: %d ads no inventário, %d já no insights, "
        "%d zerados entregáveis adicionados, %d ignorados por status",
        len(inventory or []),
        len(known_ad_ids),
        len(zero_ads),
        skipped_status,
    )
    return zero_ads


def synthesize_zero_raw_rows(
    zero_ads: List[Dict[str, Any]],
    date_start: str,
    date_stop: str,
    *,
    max_rows: int = MAX_SYNTH_ROWS,
) -> List[Dict[str, Any]]:
    """Gera linhas raw diárias zeradas no shape do /insights para os ads do inventário.

    Uma linha por dia em [max(date_start, created_time), date_stop] — ad criado no
    meio do range não ganha zeros de antes de existir. Métricas ficam ausentes de
    propósito: format_ads_for_api default-a tudo para 0.
    """
    range_start = _parse_date(date_start)
    range_stop = _parse_date(date_stop)
    if not range_start or not range_stop or range_start > range_stop:
        logger.warning(
            "[AdInventory] Range inválido para síntese (%s → %s); nenhuma linha-zero gerada",
            date_start,
            date_stop,
        )
        return []

    # Prioriza ads mais recentes se o teto for atingido (corte determinístico e logado)
    ordered = sorted(
        zero_ads or [],
        key=lambda r: str(r.get("created_time") or ""),
        reverse=True,
    )

    rows: List[Dict[str, Any]] = []
    truncated_ads = 0
    for ad in ordered:
        ad_id = str(ad.get("id") or "").strip()
        if not ad_id:
            continue

        created = _parse_date(ad.get("created_time"))
        start = max(range_start, created) if created else range_start
        if start > range_stop:
            continue  # criado depois do fim do range

        n_days = (range_stop - start).days + 1
        if len(rows) + n_days > max_rows:
            truncated_ads += 1
            continue

        adset = ad.get("adset") or {}
        campaign = ad.get("campaign") or {}
        identity = {
            "ad_id": ad_id,
            "ad_name": str(ad.get("name") or ""),
            "adset_id": str(ad.get("adset_id") or ""),
            "adset_name": str(adset.get("name") or ""),
            "campaign_id": str(ad.get("campaign_id") or ""),
            "campaign_name": str(campaign.get("name") or ""),
            "effective_status": str(ad.get("effective_status") or "").upper() or None,
        }
        for offset in range(n_days):
            day = (start + timedelta(days=offset)).strftime("%Y-%m-%d")
            row = dict(identity)
            row["date_start"] = day
            row["date_stop"] = day
            rows.append(row)

    if truncated_ads:
        logger.warning(
            "[AdInventory] Teto de %d linhas-zero atingido: %d ads zerados ficaram de fora "
            "(priorizados os mais recentes)",
            max_rows,
            truncated_ads,
        )
    logger.info(
        "[AdInventory] Síntese: %d linhas-zero para %d ads zerados (%s → %s)",
        len(rows),
        len(ordered) - truncated_ads,
        date_start,
        date_stop,
    )
    return rows
