"""Testes do ad_inventory: seleção de ads zerados, intervalo ativo e linha só de inventário.

Contexto: /insights omite ads sem entrega; o inventário do /ads edge define o
universo do pack. Desde a F5 os ads entregáveis gravam o INTERVALO ativo em
ad_pack_inventory (clampado ao created_time), e o ad ausente do insights passa pelo
pipeline como UMA linha, fora de ad_metrics (ver plano-eficiencia-carregamento §8).
"""
from app.services.ad_inventory import (
    DELIVERABLE_STATUSES,
    build_active_intervals,
    count_ads_by_adset,
    inventory_only_raw_rows,
    select_zero_delivery_ads,
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


# ---------- build_active_intervals ----------

def test_intervalo_inclui_quem_entregou_e_so_entregaveis():
    """Todo ad entregável entra — inclusive o que veio do insights (divergência (e))."""
    inventory = [_inv("1", "ACTIVE"), _inv("2", "PAUSED"), _inv("3", "PENDING_REVIEW"), _inv("4", "ARCHIVED")]
    rows = build_active_intervals(inventory, "2026-06-01", "2026-06-30", "act_1")
    assert {r["ad_id"] for r in rows} == {"1", "3"}


def test_intervalo_janela_inteira_quando_criado_antes():
    [row] = build_active_intervals([_inv("9", created="2026-01-01T00:00:00+0000")], "2026-06-01", "2026-06-30", "act_1")
    assert (row["first_active_date"], row["last_active_date"]) == ("2026-06-01", "2026-06-30")
    assert row["account_id"] == "act_1"
    assert (row["ad_name"], row["adset_name"], row["campaign_name"]) == ("AD-9", "Adset 1", "Campanha 1")
    assert (row["adset_id"], row["campaign_id"]) == ("as1", "c1")


def test_intervalo_comeca_na_criacao():
    """Ad criado no meio da janela não ganha dias de antes de existir."""
    [row] = build_active_intervals([_inv("9", created="2026-06-28T15:30:00-0300")], "2026-06-01", "2026-06-30", "act_1")
    assert row["first_active_date"] == "2026-06-28"


def test_intervalo_ignora_criado_depois_da_janela_e_janela_invalida():
    assert build_active_intervals([_inv("9", created="2026-07-05T00:00:00+0000")], "2026-06-01", "2026-06-30", "a") == []
    assert build_active_intervals([_inv("9")], "", "2026-06-30", "a") == []
    assert build_active_intervals([_inv("9")], "2026-06-30", "2026-06-01", "a") == []


def test_intervalo_sem_criacao_usa_janela_e_ad_repetido_vira_um():
    ad = _inv("9")
    ad["created_time"] = None
    rows = build_active_intervals([ad, dict(ad)], "2026-06-29", "2026-06-30", "a")
    assert len(rows) == 1 and rows[0]["first_active_date"] == "2026-06-29"


# ---------- inventory_only_raw_rows ----------

def test_uma_linha_por_ad_no_primeiro_dia_ativo():
    rows = inventory_only_raw_rows(
        [_inv("9", created="2026-01-01T00:00:00+0000"), _inv("8", created="2026-06-28T15:30:00-0300")],
        "2026-06-01", "2026-06-30",
    )
    by_id = {r["ad_id"]: r for r in rows}
    assert len(rows) == 2
    assert by_id["9"]["date_start"] == by_id["9"]["date_stop"] == "2026-06-01"
    assert by_id["8"]["date_start"] == "2026-06-28"


def test_linha_so_de_inventario_carrega_identidade():
    [row] = inventory_only_raw_rows([_inv("9")], "2026-06-30", "2026-06-30")
    assert row["ad_name"] == "AD-9"
    assert row["adset_name"] == "Adset 1"
    assert row["campaign_name"] == "Campanha 1"
    assert row["effective_status"] == "ACTIVE"


def test_linha_so_de_inventario_ignora_criado_depois_e_janela_invalida():
    assert inventory_only_raw_rows([_inv("9", created="2026-07-05T00:00:00+0000")], "2026-06-01", "2026-06-30") == []
    assert inventory_only_raw_rows([_inv("9")], "", "2026-06-30") == []


def test_teto_de_ads_prioriza_os_mais_recentes():
    ads = [
        _inv("old", created="2026-01-01T00:00:00+0000"),
        _inv("new", created="2026-06-01T00:00:00+0000"),
    ]
    rows = inventory_only_raw_rows(ads, "2026-06-21", "2026-06-30", max_ads=1)
    assert {r["ad_id"] for r in rows} == {"new"}


# ---------- count_ads_by_adset (denominador "N / M anúncios") ----------

def test_count_ads_by_adset_includes_paused_ads():
    """O caso real: 19 no Gerenciador, 12 em ad_metrics. O total tem que contar TODOS."""
    inventory = [_inv(str(i), "ACTIVE") for i in range(10)]          # 10 ativos
    inventory += [_inv(f"p{i}", "PAUSED") for i in range(9)]          # 9 pausados
    counts = count_ads_by_adset(inventory)
    # Pausados NÃO são deliverable (ficam fora de ad_metrics), mas contam no total.
    assert counts == {"as1": 19}
    assert len(select_zero_delivery_ads(inventory, known_ad_ids=set())) == 10


def test_count_ads_by_adset_groups_por_adset():
    inventory = [
        _inv("1"), _inv("2"),
        {**_inv("3"), "adset_id": "as2"},
    ]
    assert count_ads_by_adset(inventory) == {"as1": 2, "as2": 1}


def test_count_ads_by_adset_ignores_missing_adset_id():
    inventory = [_inv("1"), {**_inv("2"), "adset_id": ""}, {**_inv("3"), "adset_id": None}]
    assert count_ads_by_adset(inventory) == {"as1": 1}


def test_count_ads_by_adset_empty():
    assert count_ads_by_adset([]) == {}


# ---------- integração com o formatter ----------

def test_inventory_only_row_survives_formatter_with_all_zero_metrics():
    """Linha só de inventário passa pelo format_ads_for_api sem divisão por zero e com métricas 0."""
    raw = inventory_only_raw_rows([_inv("9")], "2026-06-30", "2026-06-30")
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
