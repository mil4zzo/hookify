# -*- coding: utf-8 -*-
"""Janela de atribuicao do pack -> recuo do refresh incremental (migration 143).

O /insights so conta a conversao se o clique estiver dentro da janela consultada;
o recuo do refresh precisa ser a janela de atribuicao da conta, que a Meta devolve
por linha em `attribution_setting`. Este arquivo trava:
- o parse extrai o MAIOR `<N>d` do setting (1d_view_7d_click -> 7);
- linhas sem o campo (linhas-zero sinteticas) nao contaminam o maximo;
- pack nao calibrado (NULL) recua pelo teto atual da Meta (7), nunca por 1;
- nada passa do teto de seguranca (28), venha o que vier do campo.
"""
import pytest

from app.services.attribution_window import (
    DEFAULT_ATTRIBUTION_WINDOW_DAYS,
    MAX_ATTRIBUTION_WINDOW_DAYS,
    lookback_days_for_pack,
    max_attribution_window,
    parse_attribution_setting_days,
)


@pytest.mark.parametrize(
    "setting, esperado",
    [
        ("1d_view_7d_click", 7),
        ("7d_click", 7),
        ("1d_click", 1),
        ("1d_view_1d_click", 1),
        ("1d_ev_7d_click", 7),      # engaged-view (2023+)
        ("28d_click", 28),          # conjuntos anteriores a 2021 ainda podem carregar
        ("default", None),
        ("", None),
        (None, None),
        (7, None),                  # tipo errado nao vira numero por acidente
    ],
)
def test_parse_extrai_o_maior_numero_de_dias(setting, esperado):
    assert parse_attribution_setting_days(setting) == esperado


def test_maximo_entre_linhas_ignora_linhas_sem_o_campo():
    rows = [
        {"ad_id": "1", "attribution_setting": "1d_click"},
        {"ad_id": "2"},                                  # linha-zero sintetica
        {"ad_id": "3", "attribution_setting": "1d_view_7d_click"},
        {"ad_id": "4", "attribution_setting": "default"},
    ]
    assert max_attribution_window(rows) == (7, "1d_view_7d_click")


def test_empate_de_dias_fica_com_o_setting_mais_completo():
    # Caso real (pack EI.31 - CA4 Cap (BM1)): conjuntos com '7d_click' e outros com
    # '1d_view_7d_click' — mesmos 7 dias; a UI deve mostrar "7d clique · 1d view".
    rows = [
        {"attribution_setting": "7d_click"},
        {"attribution_setting": "1d_view_7d_click"},
        {"attribution_setting": "7d_click"},
    ]
    assert max_attribution_window(rows) == (7, "1d_view_7d_click")


def test_maximo_sem_nenhum_valor_legivel_e_none():
    assert max_attribution_window([{"ad_id": "1"}, {"attribution_setting": "skan"}]) == (None, None)
    assert max_attribution_window([]) == (None, None)


def test_pack_nao_calibrado_recua_pelo_teto_atual_e_nao_por_um_dia():
    # Antes da migration 143 o recuo era 1 dia fixo — e perdia 14,5% das
    # pre-matriculas. NULL tem que cair no 7, nunca no 1.
    assert lookback_days_for_pack({}) == DEFAULT_ATTRIBUTION_WINDOW_DAYS
    assert lookback_days_for_pack({"attribution_window_days": None}) == DEFAULT_ATTRIBUTION_WINDOW_DAYS
    assert lookback_days_for_pack(None) == DEFAULT_ATTRIBUTION_WINDOW_DAYS


def test_pack_calibrado_usa_o_proprio_valor():
    assert lookback_days_for_pack({"attribution_window_days": 1}) == 1
    assert lookback_days_for_pack({"attribution_window_days": 7}) == 7
    assert lookback_days_for_pack({"attribution_window_days": "7"}) == 7


def test_teto_de_seguranca_e_valores_invalidos():
    assert lookback_days_for_pack({"attribution_window_days": 90}) == MAX_ATTRIBUTION_WINDOW_DAYS
    assert lookback_days_for_pack({"attribution_window_days": 0}) == DEFAULT_ATTRIBUTION_WINDOW_DAYS
    assert lookback_days_for_pack({"attribution_window_days": -3}) == DEFAULT_ATTRIBUTION_WINDOW_DAYS
    assert lookback_days_for_pack({"attribution_window_days": "abc"}) == DEFAULT_ATTRIBUTION_WINDOW_DAYS
