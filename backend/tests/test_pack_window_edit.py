# -*- coding: utf-8 -*-
"""Edição do período do pack (`pack_window.plan_window_edit`).

Os quatro casos da tabela do plano (documentation/plano-edicao-periodo-pack.md
§3), com o pack 01/07 → 31/08 e N = 7. A regra de borda medida em 07/09: todo
dia gravado pela primeira vez precisa de 7 dias de história na consulta, menos o
início do pack.

Sabotagens já feitas:
- trocar `n - 1` por `n + 1` na emenda → falha em test_comecar_antes (07/07 vira 09/07)
- trocar `1 - n` por `-n` no fim → falha em test_terminar_depois (25/08 vira 24/08)
- tirar o `max(..., new_start)` → falha em test_terminar_depois_em_pack_curto
"""
import pytest

from app.services.pack_window import RefreshWindowError, plan_refresh_window, plan_window_edit

HOJE = "2026-09-17"
PACK = {
    "date_start": "2026-07-01",
    "date_stop": "2026-08-31",
    "last_refreshed_at": "2026-08-31",
    "auto_refresh": False,
    "attribution_window_days": 7,
}


# ── Ampliar (Etapa 1) ────────────────────────────────────────────────────────

def test_comecar_antes():
    p = plan_window_edit(PACK, "2026-06-01", "2026-08-31", HOJE)
    assert p.fetch == ("2026-06-01", "2026-07-07")   # emenda: 7 primeiros dias antigos
    assert not p.reduces and p.head is None
    assert (p.new_start, p.new_stop) == ("2026-06-01", "2026-08-31")
    assert p.auto_refresh_off is True                 # fim antes de hoje: pack fechado


def test_terminar_depois():
    p = plan_window_edit(PACK, "2026-07-01", "2026-09-15", HOJE)
    assert p.fetch == ("2026-08-25", "2026-09-15")   # 01/09 precisa de 25/08 em cena
    assert not p.reduces


def test_terminar_depois_ate_hoje_nao_desliga_o_toggle():
    p = plan_window_edit(PACK, "2026-07-01", HOJE, HOJE)
    assert p.fetch == ("2026-08-25", HOJE)
    assert p.auto_refresh_off is False


def test_as_duas_pontas_ampliam_uma_busca_so():
    p = plan_window_edit(PACK, "2026-06-01", "2026-09-15", HOJE)
    assert p.fetch == ("2026-06-01", "2026-09-15")
    assert not p.reduces


def test_terminar_depois_em_pack_curto_nao_recua_antes_do_inicio():
    curto = {**PACK, "date_start": "2026-08-29", "date_stop": "2026-08-31"}
    p = plan_window_edit(curto, "2026-08-29", "2026-09-05", HOJE)
    assert p.fetch == ("2026-08-29", "2026-09-05")


def test_comecar_antes_em_pack_curto_emenda_ate_o_fim():
    curto = {**PACK, "date_start": "2026-08-29", "date_stop": "2026-08-31"}
    p = plan_window_edit(curto, "2026-08-20", "2026-08-31", HOJE)
    assert p.fetch == ("2026-08-20", "2026-08-31")


def test_recuo_do_pack_calibrado_em_1_dia():
    p = plan_window_edit({**PACK, "attribution_window_days": 1}, "2026-07-01", "2026-09-15", HOJE)
    assert p.fetch == ("2026-08-31", "2026-09-15")


# ── Reduzir ─────────────────────────────────────────────────────────────────

def test_comecar_depois():
    p = plan_window_edit(PACK, "2026-07-15", "2026-08-31", HOJE)
    assert p.reduces
    assert p.delete_before == "2026-07-15"
    assert p.head == ("2026-07-15", "2026-07-21")
    assert p.fetch == ("2026-07-15", "2026-07-21")


def test_terminar_antes():
    p = plan_window_edit(PACK, "2026-07-01", "2026-08-15", HOJE)
    assert p.reduces
    assert p.delete_after == "2026-08-15"
    assert p.fetch is None
    assert p.auto_refresh_off is True


def test_mover_a_janela_inteira():
    p = plan_window_edit(PACK, "2026-07-15", "2026-09-15", HOJE)
    assert p.delete_before == "2026-07-15" and p.delete_after is None
    assert p.head == ("2026-07-15", "2026-07-21")
    assert p.fetch == ("2026-07-15", "2026-09-15")


def test_as_payload_carrega_o_que_o_fim_do_job_precisa():
    p = plan_window_edit(PACK, "2026-06-01", "2026-08-31", HOJE)
    assert p.as_payload() == {
        "date_start": "2026-06-01", "date_stop": "2026-08-31",
        "auto_refresh_off": True, "head": None, "delete_before": None, "delete_after": None,
    }


# ── Validação ────────────────────────────────────────────────────────────────

def test_mesmo_periodo_e_erro():
    with pytest.raises(RefreshWindowError, match="mesmo"):
        plan_window_edit(PACK, "2026-07-01", "2026-08-31", HOJE)


def test_inicio_depois_do_fim():
    with pytest.raises(RefreshWindowError, match="inicial"):
        plan_window_edit(PACK, "2026-09-01", "2026-08-31", HOJE)


def test_fim_no_futuro():
    with pytest.raises(RefreshWindowError, match="futuro"):
        plan_window_edit(PACK, "2026-07-01", "2026-09-18", HOJE)


def test_data_invalida():
    with pytest.raises(RefreshWindowError, match="inválidas"):
        plan_window_edit(PACK, "01/07/2026", "2026-08-31", HOJE)


# ── Entrada pela rota: plan_refresh_window("window_edit") ────────────────────

def test_window_edit_pela_rota_devolve_fatia_e_plano():
    w = plan_refresh_window(PACK, "window_edit", HOJE, date_start="2026-06-01", date_stop="2026-08-31")
    assert (w.since, w.until) == ("2026-06-01", "2026-07-07")
    assert w.lookback_days == 7
    assert w.window_edit is not None and w.window_edit.new_start == "2026-06-01"


def test_window_edit_sem_datas_e_erro():
    with pytest.raises(RefreshWindowError, match="exige"):
        plan_refresh_window(PACK, "window_edit", HOJE)


def test_window_edit_so_reducao_nao_pede_nada_a_meta():
    """Encurtar o fim é banco puro: o plano volta sem fatia, e a rota resolve
    sem abrir relatório. `since`/`until` viram a janela nova (informativos)."""
    w = plan_refresh_window(PACK, "window_edit", HOJE, date_start="2026-07-01", date_stop="2026-08-15")
    assert w.window_edit is not None
    assert w.window_edit.fetch is None
    assert w.window_edit.delete_after == "2026-08-15"
    assert (w.since, w.until) == ("2026-07-01", "2026-08-15")
