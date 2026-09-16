"""
As rotas de filhos não pedem nem devolvem mini-série por anúncio (160).

CONTEXTO (2026-09-15)
---------------------
A tabela de variações do Manager recebia, para CADA anúncio, uma série de 5 dias
que ela não desenha. Medido em produção com 630 anúncios em 13 dias:

    p_series_days = 5 (antes) .... 1.396 KB saindo do banco, ~301 ms
    p_series_days = 0 (agora) ....   909 KB,                 ~229 ms
                                   -> 35% menos dado, 24% menos tempo

Quem desenha série é o modal de UM anúncio, e ele a busca por
`/rankings/ad-id/{id}` — mesma função, mesmo `EP.series_of`, mesmos 5 dias.

Este arquivo prova as duas metades da decisão:
  1. o que sai do backend (`series` é sempre `null` nas rotas de filhos);
  2. o que o backend PEDE ao banco (`series_days=0`), que é onde está a economia.
     Sem (2), a resposta ficaria menor mas o banco continuaria montando os dias
     e mandando tudo para o backend — o ganho principal passaria despercebido.

E prova o contorno: as rotas de DETALHE continuam pedindo os 5 dias. Se elas
perdessem a série junto, os mini-gráficos do modal ficariam vazios — o jeito
errado de fazer esta mesma economia.

SABOTAGENS PROVADAS (15/09/2026)
--------------------------------
  - `series_days=5` de volta na rota de filhos  -> test_filhos_pedem_zero_dias falha
  - `incluir_serie=False` removido               -> test_filhos_devolvem_series_null falha
  - `series_days=0` na rota de detalhe           -> test_detalhe_continua_com_5_dias falha
"""

import pytest
from fastapi.testclient import TestClient

import app.main as main
from app.core.auth import get_current_user
from app.routes import analytics


GRUPO = {
    "group_key": "ad_1",
    "ad_id": "ad_1",
    "ad_name": "Criativo",
    "account_id": "act_1",
    "campaign_name": "Camp",
    "adset_name": "Conj",
    "adset_id": "s1",
    "effective_status": "ACTIVE",
    "pack_ids": ["11111111-1111-4111-8111-000000000001"],
    "totals": {
        "impressions": 100, "clicks": 5, "inline_link_clicks": 4, "spend": 10,
        "lpv": 3, "plays": 50, "thruplays": 20, "reach": 90,
        "conversions": {"purchase": 2}, "leadscore_values": [], "custom_histograms": {},
        "hook_wsum": 0, "scroll_stop_wsum": 0, "hold_rate_wsum": 0,
        "video_watched_p50_wsum": 0, "video_watched_p75_wsum": 0,
    },
    # Dias presentes DE PROPÓSITO: se a rota voltasse a montar a série, ela teria
    # com que montá-la — o teste falharia em vez de passar por falta de dado.
    "days": [
        {"date": "2026-09-10", "impressions": 100, "clicks": 5, "spend": 10,
         "inline_link_clicks": 4, "lpv": 3, "plays": 50, "thruplays": 20, "reach": 90,
         "conversions": {"purchase": 2}, "leads": {},
         "hook_wsum": 0, "scroll_stop_wsum": 0, "hold_rate_wsum": 0,
         "video_watched_p50_wsum": 0, "video_watched_p75_wsum": 0},
    ],
    "curve_wsum": None,
    "curve_w": 0,
    "ad_count": 1,
}


@pytest.fixture
def espiao(monkeypatch):
    """Intercepta a chamada à RPC e guarda os argumentos, sem tocar no banco."""
    main.app.dependency_overrides[get_current_user] = lambda: {"user_id": "u1", "token": "tok"}
    chamadas = []

    def _payload_falso(user, **kw):
        chamadas.append(kw)
        return {"mql_leadscore_min": None, "groups": [dict(GRUPO)]}

    monkeypatch.setattr(analytics, "_entity_payload", _payload_falso)
    yield chamadas
    main.app.dependency_overrides.pop(get_current_user, None)


PERIODO = {"date_start": "2026-09-01", "date_stop": "2026-09-10"}

ROTAS_DE_FILHOS = [
    "/analytics/rankings/ad-name/Criativo/children",
    "/analytics/rankings/adset-id/s1/children",
]

ROTAS_DE_DETALHE = [
    "/analytics/rankings/ad-name/Criativo/details",
    "/analytics/rankings/ad-id/ad_1",
    "/analytics/rankings/adset-id/s1",
]


@pytest.mark.parametrize("url", ROTAS_DE_FILHOS)
def test_filhos_pedem_zero_dias(espiao, url):
    """Onde a economia acontece: o banco não chega a montar os dias."""
    r = TestClient(main.app).get(url, params=PERIODO)
    assert r.status_code == 200, r.text[:300]
    assert espiao[0]["series_days"] == 0, (
        f"{url} pediu series_days={espiao[0]['series_days']}. Com 5, o banco monta a "
        "mini-série de cada anúncio e manda tudo para o backend — 35% a mais de dado."
    )


@pytest.mark.parametrize("url", ROTAS_DE_FILHOS)
def test_filhos_devolvem_series_null(espiao, url):
    """E o contrato para o frontend é `null`, não um objeto de nulls."""
    r = TestClient(main.app).get(url, params=PERIODO)
    linhas = r.json()["data"]
    assert linhas, "sem linhas, o teste não provaria nada"
    for linha in linhas:
        assert "series" in linha, "o campo tem de continuar existindo no contrato"
        assert linha["series"] is None, f"{url} devolveu série: {str(linha['series'])[:120]}"


@pytest.mark.parametrize("url", ROTAS_DE_DETALHE)
def test_detalhe_continua_com_5_dias(espiao, url):
    """O contorno: quem DESENHA série é o modal, e ele não pode perdê-la."""
    r = TestClient(main.app).get(url, params=PERIODO)
    assert r.status_code == 200, r.text[:300]
    assert espiao[0]["series_days"] == 5, (
        f"{url} pediu series_days={espiao[0]['series_days']}; o modal desenha os "
        "mini-gráficos a partir desta série e ficaria vazio."
    )


@pytest.mark.parametrize("url", ROTAS_DE_DETALHE)
def test_detalhe_devolve_a_serie(espiao, url):
    r = TestClient(main.app).get(url, params=PERIODO)
    assert r.json().get("series") is not None, f"{url} perdeu a série do modal"
