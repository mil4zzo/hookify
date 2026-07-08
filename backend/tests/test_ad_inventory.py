"""Testes do ad_inventory: seleção de ads zerados e síntese de linhas-zero.

Contexto: /insights omite ads sem entrega; o inventário do /ads edge define o
universo do pack. Ads entregáveis ausentes do insights viram linhas-zero diárias
clampadas ao created_time (ver decisoes-tecnicas 2026-06-12).
"""
from app.services.ad_inventory import (
    DELIVERABLE_STATUSES,
    select_zero_delivery_ads,
    synthesize_zero_raw_rows,
)
from app.services.dataformatter import format_ads_for_api


def _inv(ad_id, status="ACTIVE", created="2026-05-01T10:00:00-0300", name=None):
    return {
        "id": ad_id,
        "name": name or f"AD-{ad_id}",
        "effective_status": status,
        "created_time": created,
        "adset_id": "as1",
        "campaign_id": "c1",
        "adset": {"id": "as1", "name": "Adset 1"},
        "campaign": {"id": "c1", "name": "Campanha 1"},
    }


# ---------- select_zero_delivery_ads ----------

def test_selects_only_deliverable_ads_missing_from_insights():
    inventory = [
        _inv("1", "ACTIVE"),          # já no insights → fora
        _inv("2", "ACTIVE"),          # zerado ativo → entra
        _inv("3", "PAUSED"),          # zerado pausado → fora (ruído histórico)
        _inv("4", "ADSET_PAUSED"),    # idem
        _inv("5", "ARCHIVED"),        # idem
        _inv("6", "DELETED"),         # idem
        _inv("7", "PENDING_REVIEW"),  # tentando entregar → entra
        _inv("8", "WITH_ISSUES"),     # idem
    ]
    zero = select_zero_delivery_ads(inventory, known_ad_ids={"1"})
    assert {a["id"] for a in zero} == {"2", "7", "8"}


def test_paused_statuses_are_not_deliverable():
    # Regra acordada: pausado sem métricas no range não entra no universo
    for status in ("PAUSED", "ADSET_PAUSED", "CAMPAIGN_PAUSED", "ARCHIVED", "DELETED", "DISAPPROVED"):
        assert status not in DELIVERABLE_STATUSES


def test_user_scenario_16_plus_8_equals_24():
    """Caso real que motivou o fix: adset com 24 ads, 16 no insights, 8 ativos zerados."""
    insights_ids = {str(i) for i in range(16)}
    inventory = [_inv(str(i)) for i in range(24)]
    zero = select_zero_delivery_ads(inventory, insights_ids)
    assert len(zero) == 8


# ---------- synthesize_zero_raw_rows ----------

def test_one_row_per_day_in_range():
    rows = synthesize_zero_raw_rows([_inv("9", created="2026-01-01T00:00:00+0000")], "2026-06-01", "2026-06-30")
    assert len(rows) == 30
    assert rows[0]["date_start"] == "2026-06-01"
    assert rows[-1]["date_start"] == "2026-06-30"
    assert all(r["ad_id"] == "9" for r in rows)


def test_created_time_clamps_start():
    """Ad criado há 3 dias num range de 30 → só 3 linhas (não existia antes)."""
    rows = synthesize_zero_raw_rows(
        [_inv("9", created="2026-06-28T15:30:00-0300")], "2026-06-01", "2026-06-30"
    )
    assert len(rows) == 3
    assert rows[0]["date_start"] == "2026-06-28"


def test_ad_created_after_range_yields_nothing():
    rows = synthesize_zero_raw_rows(
        [_inv("9", created="2026-07-05T00:00:00+0000")], "2026-06-01", "2026-06-30"
    )
    assert rows == []


def test_identity_fields_from_inventory_expansions():
    rows = synthesize_zero_raw_rows([_inv("9")], "2026-06-30", "2026-06-30")
    assert rows[0]["ad_name"] == "AD-9"
    assert rows[0]["adset_name"] == "Adset 1"
    assert rows[0]["campaign_name"] == "Campanha 1"
    assert rows[0]["effective_status"] == "ACTIVE"


def test_invalid_range_yields_nothing():
    assert synthesize_zero_raw_rows([_inv("9")], "", "2026-06-30") == []
    assert synthesize_zero_raw_rows([_inv("9")], "2026-06-30", "2026-06-01") == []


def test_missing_created_time_uses_full_range():
    ad = _inv("9")
    ad["created_time"] = None
    rows = synthesize_zero_raw_rows([ad], "2026-06-29", "2026-06-30")
    assert len(rows) == 2


def test_max_rows_cap_prioritizes_recent_ads():
    ads = [
        _inv("old", created="2026-01-01T00:00:00+0000"),
        _inv("new", created="2026-06-01T00:00:00+0000"),
    ]
    # Range de 10 dias, teto de 10 linhas → só cabe um ad; o mais recente vence
    rows = synthesize_zero_raw_rows(ads, "2026-06-21", "2026-06-30", max_rows=10)
    assert {r["ad_id"] for r in rows} == {"new"}


# ---------- integração com o formatter ----------

def test_synthesized_rows_survive_formatter_with_all_zero_metrics():
    """Linha-zero passa pelo format_ads_for_api sem divisão por zero e com métricas 0."""
    raw = synthesize_zero_raw_rows([_inv("9")], "2026-06-30", "2026-06-30")
    formatted = format_ads_for_api(raw, account_id="act_123")
    assert len(formatted) == 1
    ad = formatted[0]
    assert ad["ad_id"] == "9"
    assert ad["date"] == "2026-06-30"
    assert ad["spend"] == 0
    assert ad["impressions"] == 0
    assert ad["video_watched_p50"] == 0
    assert ad["connect_rate"] == 0
    assert ad["effective_status"] == "ACTIVE"
    assert ad["account_id"] == "act_123"
