# -*- coding: utf-8 -*-
"""Janela da atualização (`pack_window.plan_refresh_window`).

O que se trava aqui:
- o recuo pela janela de atribuição e o clamp "nunca antes do início do pack"
  (regra da 143, agora fora da rota);
- a REGRA NOVA (0.1 do plano de edição de período): pack com "manter atualizado"
  desligado é fechado — o `until` nunca passa de `date_stop`, nos dois tipos de
  atualização. Sabotagem já feita: sem o `min()` em `effective_until`, os dois
  testes de pack fechado falham (o until vira hoje).
- pack aberto continua acompanhando o `until_date` pedido (hoje).
"""
import pytest

from app.services.pack_window import RefreshWindowError, effective_until, plan_refresh_window
from datetime import date

HOJE = "2026-09-17"

PACK_FECHADO = {
    "date_start": "2026-07-01",
    "date_stop": "2026-08-15",
    "last_refreshed_at": "2026-08-15",
    "auto_refresh": False,
    "attribution_window_days": 7,
}
PACK_ABERTO = {**PACK_FECHADO, "auto_refresh": True, "date_stop": "2026-09-16", "last_refreshed_at": "2026-09-16"}


# ── Pack fechado: o fim não anda ─────────────────────────────────────────────

def test_fechado_since_last_refresh_nao_passa_do_date_stop():
    w = plan_refresh_window(PACK_FECHADO, "since_last_refresh", HOJE)
    assert w.until == "2026-08-15"
    assert w.since == "2026-08-08"          # 15/08 − 7 dias de recuo
    assert w.clamped_to_stop is True
    assert w.lookback_days == 7


def test_fechado_full_period_vai_do_inicio_ao_date_stop():
    w = plan_refresh_window(PACK_FECHADO, "full_period", HOJE)
    assert (w.since, w.until) == ("2026-07-01", "2026-08-15")
    assert w.lookback_days == 0


def test_fechado_pedido_anterior_ao_fim_nao_e_limitado():
    # until_date antes do date_stop (cliente com relógio atrasado): vale o pedido.
    w = plan_refresh_window(PACK_FECHADO, "since_last_refresh", "2026-08-12")
    assert w.until == "2026-08-12"
    assert w.clamped_to_stop is False


# ── Pack aberto: o fim acompanha hoje ────────────────────────────────────────

def test_aberto_since_last_refresh_vai_ate_hoje():
    w = plan_refresh_window(PACK_ABERTO, "since_last_refresh", HOJE)
    assert w.until == HOJE
    assert w.since == "2026-09-09"
    assert w.clamped_to_stop is False


def test_aberto_full_period_vai_ate_hoje():
    w = plan_refresh_window(PACK_ABERTO, "full_period", HOJE)
    assert (w.since, w.until) == ("2026-07-01", HOJE)


# ── Regras herdadas da 143 ───────────────────────────────────────────────────

def test_recuo_nunca_antes_do_inicio_do_pack():
    pack = {**PACK_ABERTO, "date_start": "2026-09-14"}
    w = plan_refresh_window(pack, "since_last_refresh", HOJE)
    assert w.since == "2026-09-14"


def test_pack_nao_calibrado_recua_7():
    pack = {**PACK_ABERTO, "attribution_window_days": None}
    w = plan_refresh_window(pack, "since_last_refresh", HOJE)
    assert w.since == "2026-09-09"
    assert w.lookback_days == 7


def test_legado_sem_last_refreshed_usa_date_stop_como_ancora():
    pack = {**PACK_ABERTO, "last_refreshed_at": None}
    w = plan_refresh_window(pack, "since_last_refresh", HOJE)
    assert w.since == "2026-09-09"


def test_ancora_com_hora_e_lida_pela_data():
    pack = {**PACK_ABERTO, "last_refreshed_at": "2026-09-16T03:00:00+00:00"}
    w = plan_refresh_window(pack, "since_last_refresh", HOJE)
    assert w.since == "2026-09-09"


# ── Erros com mensagem pronta ────────────────────────────────────────────────

def test_tipo_invalido():
    with pytest.raises(RefreshWindowError, match="refresh_type"):
        plan_refresh_window(PACK_ABERTO, "tudo", HOJE)


def test_until_invalido():
    with pytest.raises(RefreshWindowError, match="until_date inválido"):
        plan_refresh_window(PACK_ABERTO, "since_last_refresh", "17/09/2026")


def test_since_depois_do_until_e_erro():
    with pytest.raises(RefreshWindowError, match="Range inválido"):
        plan_refresh_window(PACK_ABERTO, "since_last_refresh", "2026-09-01")


def test_sem_ancora_nenhuma_pede_full_period():
    pack = {**PACK_ABERTO, "last_refreshed_at": None, "date_stop": None}
    with pytest.raises(RefreshWindowError, match="full_period"):
        plan_refresh_window(pack, "since_last_refresh", HOJE)


def test_full_period_sem_date_start():
    with pytest.raises(RefreshWindowError, match="date_start"):
        plan_refresh_window({**PACK_ABERTO, "date_start": None}, "full_period", HOJE)


def test_effective_until_sem_date_stop_legivel_nao_limita():
    until, clamped = effective_until({"auto_refresh": False, "date_stop": "??"}, date(2026, 9, 17))
    assert (until.isoformat(), clamped) == ("2026-09-17", False)
