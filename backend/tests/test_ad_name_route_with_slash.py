"""
Nome de anúncio com "/" chega às rotas /rankings/ad-name/{nome}/...

CONTEXTO (2026-09-15)
---------------------
O frontend manda o nome com encodeURIComponent ("a/b" -> "a%2Fb"), mas o servidor
decodifica o caminho ANTES de escolher a rota. Com `{ad_name}` (que não aceita "/"),
"/rankings/ad-name/a/b/children" não casava com nada: 404 "Not Found" e o modal de
variações mostrava "Erro ao carregar variações." para todo anúncio com barra no nome.
Medido em produção antes da correção: `ADOV167 - a%2Fb` -> 404; `%25`, `%23`, `%3F`,
`%3B`, `%5C` -> chegam normalmente.

O teste verifica que a rota foi escolhida E que o nome chegou inteiro à RPC — um 404
da própria rota (nome sem dados) é outra coisa e não pode mascarar o problema.
"""

import pytest
from fastapi.testclient import TestClient
from urllib.parse import quote

import app.main as main
from app.core.auth import get_current_user
from app.routes import analytics


@pytest.fixture
def chamadas(monkeypatch):
    main.app.dependency_overrides[get_current_user] = lambda: {"user_id": "u1", "token": "tok"}
    recebidos = []

    def _payload_falso(user, **kw):
        recebidos.append((kw["entity"], kw["entity_id"]))
        return {"mql_leadscore_min": None, "groups": []}

    monkeypatch.setattr(analytics, "_entity_payload", _payload_falso)
    yield recebidos
    main.app.dependency_overrides.pop(get_current_user, None)


NOMES = [
    "ADOV167 - react olhaso rufino sentado cx/40kcdb",
    "a/b/c",
    "termina com barra/",
    "/comeca com barra",
    "nome que termina em /children",
    "nome que termina em /details",
    "sem barra % # ? ; \\ normal",
]


@pytest.mark.parametrize("sufixo", ["children", "details", "history"])
@pytest.mark.parametrize("nome", NOMES)
def test_nome_com_barra_chega_inteiro(chamadas, nome, sufixo):
    client = TestClient(main.app)
    url = f"/analytics/rankings/ad-name/{quote(nome, safe='')}/{sufixo}"
    r = client.get(url, params={"date_start": "2026-09-01", "date_stop": "2026-09-07"})

    assert chamadas == [("ad_name", nome)], (r.status_code, r.text[:200])
    assert r.json().get("detail") != "Not Found"
