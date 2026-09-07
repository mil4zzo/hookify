# -*- coding: utf-8 -*-
"""Janela de atribuicao vem de uma consulta SEPARADA, no nivel de conjunto.

Pedir `attribution_setting` no relatorio de anuncios infla o relatorio 3-4x (a
Meta passa a devolver linha para todo par anuncio/dia, com ou sem entrega) e
estoura o teto de paginas do coletor — foi o gatilho do incidente de
2026-09-07. Este arquivo trava:
- o relatorio de anuncios NAO pede o campo (nos dois clientes);
- a consulta de janela e `level=adset`, sem `time_increment`, so 2 campos;
- devolve o maior `<N>d` visto e o setting mais completo no empate;
- fail-open: qualquer erro -> (None, None), nunca levanta.
"""
import json
from unittest import mock

from app.services import graph_api as ga
from app.services import meta_job_client as mjc


class _Resp:
    def __init__(self, payload, status=200):
        self._payload = payload
        self.headers = {}
        self.status_code = status

    def raise_for_status(self):
        if self.status_code >= 400:
            raise ga.requests.exceptions.HTTPError(f"HTTP {self.status_code}")

    def json(self):
        return self._payload


def test_relatorio_de_anuncios_nao_pede_attribution_setting(monkeypatch):
    seen = {}

    def _post(url, params=None, timeout=None):
        seen["fields"] = params["fields"]
        return _Resp({"report_run_id": "r1"})

    monkeypatch.setattr(ga.requests, "post", _post)
    monkeypatch.setattr(ga, "log_meta_usage", lambda *a, **k: None)
    ga.GraphAPI("tok").start_ads_job("act_1", {"since": "2026-09-01", "until": "2026-09-02"}, [])
    assert "attribution_setting" not in seen["fields"]
    assert "video_play_curve_actions" in seen["fields"]   # a curva continua (e inocente)

    seen.clear()
    monkeypatch.setattr(mjc.requests, "post", _post)
    monkeypatch.setattr(mjc, "log_meta_usage", lambda *a, **k: None)
    mjc.MetaJobClient("tok").start_job("act_1", {"since": "2026-09-01", "until": "2026-09-02"})
    assert "attribution_setting" not in seen["fields"]


def test_consulta_de_janela_e_por_conjunto_sem_serie_diaria(monkeypatch):
    seen = {}

    def _get(url, params=None, timeout=None):
        seen["url"] = url
        seen["params"] = params
        return _Resp({"data": [
            {"adset_id": "1", "attribution_setting": "7d_click"},
            {"adset_id": "2", "attribution_setting": "1d_view_7d_click"},
            {"adset_id": "3", "attribution_setting": "1d_click"},
        ]})

    monkeypatch.setattr(ga.requests, "get", _get)
    monkeypatch.setattr(ga, "log_meta_usage", lambda *a, **k: None)
    filters = [{"field": "campaign.name", "operator": "CONTAIN", "value": "x"}]

    days, setting = ga.GraphAPI("tok").fetch_attribution_window("act_1", {"since": "2026-07-07", "until": "2026-08-17"}, filters)

    assert (days, setting) == (7, "1d_view_7d_click")
    assert "act_1/insights" in seen["url"]
    p = seen["params"]
    assert p["level"] == "adset"
    assert p["fields"] == "adset_id,attribution_setting"
    assert "time_increment" not in p                      # sem serie diaria: ~1 linha por conjunto
    assert json.loads(p["filtering"]) == filters
    assert json.loads(p["time_range"]) == {"since": "2026-07-07", "until": "2026-08-17"}


def test_pagina_e_para_no_teto_proprio(monkeypatch):
    calls = {"n": 0}

    def _get(url, params=None, timeout=None):
        calls["n"] += 1
        return _Resp({"data": [{"adset_id": str(calls["n"]), "attribution_setting": "1d_click"}],
                      "paging": {"next": "https://x/next"}})

    monkeypatch.setattr(ga.requests, "get", _get)
    monkeypatch.setattr(ga, "log_meta_usage", lambda *a, **k: None)
    days, _ = ga.GraphAPI("tok").fetch_attribution_window("act_1", {"since": "a", "until": "b"}, max_pages=3)
    assert days == 1
    assert calls["n"] == 3


def test_fail_open_em_erro_http_e_em_excecao(monkeypatch):
    monkeypatch.setattr(ga, "log_meta_usage", lambda *a, **k: None)

    monkeypatch.setattr(ga.requests, "get", lambda *a, **k: _Resp({"error": {"code": 3}}, status=500))
    assert ga.GraphAPI("tok").fetch_attribution_window("act_1", {"since": "a", "until": "b"}) == (None, None)

    def _boom(*a, **k):
        raise RuntimeError("socket")
    monkeypatch.setattr(ga.requests, "get", _boom)
    assert ga.GraphAPI("tok").fetch_attribution_window("act_1", {"since": "a", "until": "b"}) == (None, None)


def test_sem_nenhum_setting_legivel_devolve_none(monkeypatch):
    monkeypatch.setattr(ga.requests, "get", lambda *a, **k: _Resp({"data": [{"adset_id": "1"}]}))
    monkeypatch.setattr(ga, "log_meta_usage", lambda *a, **k: None)
    assert ga.GraphAPI("tok").fetch_attribution_window("act_1", {"since": "a", "until": "b"}) == (None, None)
