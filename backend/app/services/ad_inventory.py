"""
Seleção de ads sem entrega a partir do inventário (/act_X/ads) e intervalo de atividade.

O endpoint /insights da Meta é de performance, não de inventário: ads sem atividade
(impressions/spend = 0) no time_range simplesmente não retornam. O inventário do /ads
edge define o universo real do pack.

Até a F5 (documentation/plano-eficiencia-carregamento.md, §8) os ads entregáveis
ausentes do insights viravam linhas-zero diárias em ad_metrics — 79% da tabela. Agora:
  - todo ad entregável do inventário grava o INTERVALO em que esteve ativo em
    ad_pack_inventory (migration 154), e as leituras do Manager completam a lista por ele
    (migration 155);
  - o ad só de inventário ainda passa pelo pipeline como UMA linha (não uma por dia),
    para ganhar registro em `ads`, lista do pack e miniatura — mas fica fora de
    ad_metrics e do mapa (job_processor._persist_data).
"""
import logging
from datetime import datetime
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

# Teto de segurança para packs sem filtro em contas gigantes: ads só de inventário que
# passam pelo enriquecimento (criativo, miniatura) num job. Ads mais recentes têm
# prioridade; o corte é logado. Não limita o INTERVALO: todo ad entregável vai para
# ad_pack_inventory e aparece nas leituras, com ou sem enriquecimento.
MAX_INVENTORY_ONLY_ADS = 5000


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


def _active_start(ad: Dict[str, Any], range_start: datetime) -> datetime:
    """Primeiro dia ativo do ad dentro da janela: a janela ou a criação, o que vier depois."""
    created = _parse_date(ad.get("created_time"))
    return max(range_start, created) if created else range_start


def _window(date_start: str, date_stop: str) -> Optional[tuple]:
    range_start = _parse_date(date_start)
    range_stop = _parse_date(date_stop)
    if not range_start or not range_stop or range_start > range_stop:
        logger.warning(
            "[AdInventory] Range inválido (%s → %s); nada de inventário neste job",
            date_start,
            date_stop,
        )
        return None
    return range_start, range_stop


def build_active_intervals(
    inventory: List[Dict[str, Any]],
    date_start: str,
    date_stop: str,
    account_id: str,
) -> List[Dict[str, Any]]:
    """Linhas para `merge_ad_pack_inventory`: todo ad ENTREGÁVEL do inventário, com o
    intervalo [max(date_start, criação), date_stop] desta janela.

    Inclui quem teve entrega (veio do insights): é isso que faz o ad ativo que gastou num
    trecho aparecer com zero nos outros dias do período (divergência (e) do plano). O
    merge no banco só ESTENDE o intervalo — um refresh que não vê o ad não o apaga.
    """
    window = _window(date_start, date_stop)
    if not window:
        return []
    range_start, range_stop = window
    out: Dict[str, Dict[str, Any]] = {}
    for ad in inventory or []:
        ad_id = str(ad.get("id") or "").strip()
        if not ad_id:
            continue
        if str(ad.get("effective_status") or "").upper() not in DELIVERABLE_STATUSES:
            continue
        start = _active_start(ad, range_start)
        if start > range_stop:
            continue  # criado depois do fim da janela
        adset = ad.get("adset") or {}
        campaign = ad.get("campaign") or {}
        out[ad_id] = {
            "ad_id": ad_id,
            "account_id": str(account_id or ""),
            "ad_name": str(ad.get("name") or ""),
            "adset_id": str(ad.get("adset_id") or ""),
            "adset_name": str(adset.get("name") or ""),
            "campaign_id": str(ad.get("campaign_id") or ""),
            "campaign_name": str(campaign.get("name") or ""),
            "first_active_date": start.strftime("%Y-%m-%d"),
            "last_active_date": range_stop.strftime("%Y-%m-%d"),
        }
    return list(out.values())


def inventory_only_raw_rows(
    zero_ads: List[Dict[str, Any]],
    date_start: str,
    date_stop: str,
    *,
    max_ads: int = MAX_INVENTORY_ONLY_ADS,
) -> List[Dict[str, Any]]:
    """UMA linha raw por ad só de inventário, no shape do /insights, para o pipeline
    enriquecer e gravar em `ads` (criativo, status, miniatura) e na lista do pack.

    Métricas ficam ausentes de propósito (format_ads_for_api default-a tudo para 0). A
    linha NÃO vai para ad_metrics: quem a separa é o job, pelo ad_id.
    """
    window = _window(date_start, date_stop)
    if not window:
        return []
    range_start, range_stop = window

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
        start = _active_start(ad, range_start)
        if start > range_stop:
            continue
        if len(rows) >= max_ads:
            truncated_ads += 1
            continue
        adset = ad.get("adset") or {}
        campaign = ad.get("campaign") or {}
        day = start.strftime("%Y-%m-%d")
        rows.append({
            "ad_id": ad_id,
            "ad_name": str(ad.get("name") or ""),
            "adset_id": str(ad.get("adset_id") or ""),
            "adset_name": str(adset.get("name") or ""),
            "campaign_id": str(ad.get("campaign_id") or ""),
            "campaign_name": str(campaign.get("name") or ""),
            "effective_status": str(ad.get("effective_status") or "").upper() or None,
            "date_start": day,
            "date_stop": day,
        })

    if truncated_ads:
        logger.warning(
            "[AdInventory] Teto de %d ads só de inventário atingido: %d ficaram sem "
            "enriquecimento neste job (continuam no inventário; priorizados os mais recentes)",
            max_ads,
            truncated_ads,
        )
    logger.info(
        "[AdInventory] %d ads só de inventário (%s → %s)",
        len(rows),
        date_start,
        date_stop,
    )
    return rows
