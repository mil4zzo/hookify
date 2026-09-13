# -*- coding: utf-8 -*-
"""Ritmo do coletor de insights (F4 do plano de eficiência, 2026-09-13).

O que mudou e por quê:
- página de 1000 (medido: mesmo relatório idêntico ao de 500, ~40% mais rápido);
- a espera fixa de 1 s entre páginas virou espera guiada pelo uso que a própria
  resposta da Meta informa: curta quando há folga, crescente com a carga, e 1 s
  (como antes) quando não há cabeçalho legível;
- "limite atingido" (#4/#17/#32/#613/800xx) deixa de derrubar o job: espera e tenta
  de novo, e só desiste depois de todas as esperas.

Este arquivo trava:
- teto de produção continua em 50.000 linhas e a página não passa de 1000;
- a espera nunca diminui quando o uso sobe (monotonia), com degraus conhecidos;
- sem sinal, não acelera (1 s);
- limite da Meta é retentado com as esperas longas; erro 400 comum não é;
- limite persistente desiste e a coleta sai incompleta (nunca vira sucesso).
"""
import json

import pytest

from app.services import insights_collector as ic


def _buc(pct=0, regain=0, account="123"):
    return json.dumps({account: [{
        "type": "ads_insights", "call_count": pct, "total_cputime": pct,
        "total_time": pct, "estimated_time_to_regain_access": regain,
    }]})


class _Resp:
    def __init__(self, payload, headers=None, status=200):
        self._payload = payload
        self.headers = headers or {}
        self.status_code = status

    def raise_for_status(self):
        if self.status_code >= 400:
            raise ic.requests.exceptions.HTTPError(f"{self.status_code}", response=self)

    def json(self):
        return self._payload


@pytest.fixture(autouse=True)
def _sem_usage_e_sem_dormir(monkeypatch):
    monkeypatch.setattr(ic, "log_meta_usage", lambda *a, **k: None)
    sleeps = []
    monkeypatch.setattr(ic.time, "sleep", lambda s: sleeps.append(s))
    return sleeps


# ---------------------------------------------------------------- teto e página

def test_teto_de_producao_continua_em_50_mil_linhas():
    assert ic.MAX_PAGES * ic.PAGE_LIMIT == 50_000
    assert ic.PAGE_LIMIT <= 1000          # 2000 devolveu HTTP 500 em 2026-09-07


# ---------------------------------------------------------------- espera guiada

def test_espera_nunca_diminui_quando_o_uso_sobe():
    niveis = [0, 10, 30, 49, 50, 60, 74, 75, 80, 89, 90, 99]
    esperas = [ic._page_delay({"x-business-use-case-usage": _buc(p)}) for p in niveis]
    assert esperas == sorted(esperas)
    assert esperas[0] < esperas[-1]


@pytest.mark.parametrize("pct, esperado", [(1, 0.25), (50, 2.0), (75, 5.0), (95, 15.0)])
def test_degraus_da_espera(pct, esperado):
    assert ic._page_delay({"x-business-use-case-usage": _buc(pct)}) == esperado


def test_sem_cabecalho_nao_acelera():
    assert ic._page_delay({}) == ic.PAGE_DELAY_NO_HEADER_S == 1.0
    assert ic._page_delay(None) == 1.0


def test_cabecalho_ilegivel_nao_quebra_e_nao_acelera():
    assert ic._page_delay({"x-business-use-case-usage": "{nao-e-json"}) == 1.0


def test_uso_do_app_alto_tambem_freia_mesmo_com_conta_folgada():
    headers = {
        "x-business-use-case-usage": _buc(1),
        "x-app-usage": json.dumps({"call_count": 92, "total_cputime": 3, "total_time": 3}),
    }
    assert ic._page_delay(headers) == 15.0


def test_conta_bloqueada_espera_o_degrau_do_limite():
    assert ic._page_delay({"x-business-use-case-usage": _buc(1, regain=5)}) == ic.RATE_LIMIT_DELAYS[0]


def test_coleta_usa_o_uso_informado_pela_pagina_anterior(monkeypatch, _sem_usage_e_sem_dormir):
    paginas = iter([
        _Resp({"data": [{"ad_id": "a"}], "paging": {"next": "https://x/p2"}},
              headers={"x-business-use-case-usage": _buc(80)}),
        _Resp({"data": [{"ad_id": "b"}]}, headers={"x-business-use-case-usage": _buc(1)}),
    ])
    monkeypatch.setattr(ic.requests, "get", lambda url, timeout=None: next(paginas))

    res = ic.InsightsCollector("tok").collect("report-1")

    assert res["success"] is True and res["complete"] is True
    assert _sem_usage_e_sem_dormir == [5.0]   # esperou pelo uso da 1a página (80%)


# ---------------------------------------------------------------- limite da Meta

def _limite(code=17):
    return _Resp({"error": {"code": code, "message": "User request limit reached"}}, status=400)


def test_limite_da_meta_espera_e_tenta_de_novo(monkeypatch, _sem_usage_e_sem_dormir):
    respostas = iter([_limite(17), _Resp({"data": [{"ad_id": "a"}]})])
    monkeypatch.setattr(ic.requests, "get", lambda url, timeout=None: next(respostas))

    res = ic.InsightsCollector("tok").collect("report-1")

    assert res["success"] is True and ic.collection_is_complete(res)
    assert _sem_usage_e_sem_dormir == [ic.RATE_LIMIT_DELAYS[0]]


@pytest.mark.parametrize("code", [4, 17, 32, 613, 80000, 80004, 80014])
def test_todos_os_codigos_de_limite_sao_reconhecidos(code):
    exc = ic.requests.exceptions.HTTPError("400", response=_limite(code))
    assert ic._rate_limit_code(exc) == code


def test_erro_400_que_nao_e_limite_nao_e_retentado(monkeypatch, _sem_usage_e_sem_dormir):
    chamadas = {"n": 0}

    def _get(url, timeout=None):
        chamadas["n"] += 1
        return _Resp({"error": {"code": 100, "message": "Invalid parameter"}}, status=400)

    monkeypatch.setattr(ic.requests, "get", _get)
    res = ic.InsightsCollector("tok").collect("report-1")

    assert res["success"] is False
    assert chamadas["n"] == 1
    assert _sem_usage_e_sem_dormir == []


def test_limite_persistente_desiste_e_a_coleta_sai_incompleta(monkeypatch, _sem_usage_e_sem_dormir):
    chamadas = {"n": 0}

    def _get(url, timeout=None):
        chamadas["n"] += 1
        return _limite(4)

    monkeypatch.setattr(ic.requests, "get", _get)
    res = ic.InsightsCollector("tok").collect("report-1")

    assert res["success"] is False
    assert ic.collection_is_complete(res) is False
    assert chamadas["n"] == len(ic.RATE_LIMIT_DELAYS) + 1
    assert _sem_usage_e_sem_dormir == ic.RATE_LIMIT_DELAYS
    assert sum(ic.RATE_LIMIT_DELAYS) < 300    # cabe no lease de processamento do job


def test_limite_no_meio_da_paginacao_nao_perde_paginas(monkeypatch):
    respostas = iter([
        _Resp({"data": [{"ad_id": "a"}], "paging": {"next": "https://x/p2"}}),
        _limite(80000),
        _Resp({"data": [{"ad_id": "b"}]}),
    ])
    monkeypatch.setattr(ic.requests, "get", lambda url, timeout=None: next(respostas))

    res = ic.InsightsCollector("tok").collect("report-1")

    assert res["success"] is True and res["complete"] is True
    assert [r["ad_id"] for r in res["data"]] == ["a", "b"]
