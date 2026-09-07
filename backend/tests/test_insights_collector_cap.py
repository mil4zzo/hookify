# -*- coding: utf-8 -*-
"""Teto de paginas do coletor: recorte NUNCA vira sucesso.

O que aconteceu (2026-09-07): `attribution_setting` no relatorio de anuncios
inflou o relatorio 3-4x, seis packs passaram do teto de 100 paginas, o coletor
parou no teto e devolveu `success=True` com 50.000 linhas. A sintese de
linhas-zero do inventario tratou os anuncios das paginas nao lidas como
"entregou 0" e gravou zero por cima de gasto real (R$ 12 mil num pack so).

Este arquivo trava:
- teto atingido com paginas sobrando -> success=False, complete=False, data vazio,
  erro legivel (nada e gravado);
- relatorio que termina exatamente no teto (sem `next`) -> sucesso completo;
- `collection_is_complete` e a UNICA porta para a sintese de linhas-zero;
- sabotagem: com o teto alto o mesmo relatorio passa — prova que o teste ve o teto.
"""
from unittest import mock

import pytest

from app.services import insights_collector as ic


class _Resp:
    def __init__(self, payload):
        self._payload = payload
        self.headers = {}
        self.status_code = 200

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


def _pages(n_pages, rows_per_page=2, endless=False):
    """Simula /<report>/insights paginado: cada pagina tem `next` menos a ultima
    (ou sempre, se endless)."""
    def _get(url, timeout=None):
        page = int(url.split("page=")[1]) if "page=" in url else 1
        data = [{"ad_id": f"ad{page}-{i}", "date_start": "2026-09-01", "spend": "1"} for i in range(rows_per_page)]
        payload = {"data": data}
        if endless or page < n_pages:
            payload["paging"] = {"next": f"https://x/insights?page={page + 1}"}
        return _Resp(payload)
    return _get


@pytest.fixture(autouse=True)
def _sem_delay_nem_usage(monkeypatch):
    monkeypatch.setattr(ic, "PAGE_DELAY_S", 0)
    monkeypatch.setattr(ic, "log_meta_usage", lambda *a, **k: None)


def test_teto_com_paginas_sobrando_e_coleta_incompleta_e_nao_grava_nada(monkeypatch):
    monkeypatch.setattr(ic, "MAX_PAGES", 3)
    monkeypatch.setattr(ic.requests, "get", _pages(999, endless=True))

    res = ic.InsightsCollector("tok").collect("report-1")

    assert res["success"] is False
    assert res["complete"] is False
    assert res["data"] == []                      # recorte nao sai do coletor
    assert res["page_count"] == 3
    assert "limite" in res["error"].lower()
    assert "nada foi gravado" in res["error"].lower()
    assert ic.collection_is_complete(res) is False


def test_relatorio_que_cabe_exatamente_no_teto_e_completo(monkeypatch):
    monkeypatch.setattr(ic, "MAX_PAGES", 3)
    monkeypatch.setattr(ic.requests, "get", _pages(3))   # 3a pagina sem `next`

    res = ic.InsightsCollector("tok").collect("report-1")

    assert res["success"] is True
    assert res["complete"] is True
    assert res["page_count"] == 3
    assert len(res["data"]) == 6
    assert ic.collection_is_complete(res) is True


def test_sabotado_teto_alto_o_mesmo_relatorio_passa(monkeypatch):
    # Prova que o primeiro teste falha POR CAUSA do teto, nao por outro motivo.
    monkeypatch.setattr(ic, "MAX_PAGES", 10)
    monkeypatch.setattr(ic.requests, "get", _pages(5))

    res = ic.InsightsCollector("tok").collect("report-1")

    assert res["success"] is True and res["complete"] is True
    assert res["page_count"] == 5


@pytest.mark.parametrize(
    "result, esperado",
    [
        ({"success": True, "complete": True}, True),
        ({"success": True}, False),                 # coletor antigo / caminho sem flag
        ({"success": True, "complete": False}, False),
        ({"success": False, "complete": True}, False),
        ({"success": False, "cancelled": True}, False),
        (None, False),
        ({}, False),
    ],
)
def test_collection_is_complete_exige_success_e_complete(result, esperado):
    assert ic.collection_is_complete(result) is esperado


def test_erro_de_rede_no_meio_tambem_e_incompleto(monkeypatch):
    monkeypatch.setattr(ic, "MAX_PAGES", 10)
    monkeypatch.setattr(ic, "MAX_RETRIES", 1)
    calls = {"n": 0}

    def _get(url, timeout=None):
        calls["n"] += 1
        if calls["n"] == 1:
            return _Resp({"data": [{"ad_id": "a"}], "paging": {"next": "https://x/insights?page=2"}})
        raise ic.requests.exceptions.ConnectionError("queda")

    monkeypatch.setattr(ic.requests, "get", _get)
    res = ic.InsightsCollector("tok").collect("report-1")
    assert res["success"] is False
    assert ic.collection_is_complete(res) is False
