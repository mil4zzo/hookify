"""O deploy precisa de um check que reprove quando o app nao consegue servir.

Contexto (2026-08-25): o backend passou horas respondendo 500 em toda rota que
toca o banco -- o cliente Supabase estourava TypeError na construcao -- e os
dois deploys fecharam verdes, porque o unico check era o `/health`, que nao
consulta o banco. Estes testes travam as duas metades da correcao: o
`/health/ready` REPROVA quando o banco nao responde, e o `/health` continua
raso de proposito.
"""

import pytest
from fastapi.testclient import TestClient

import app.core.supabase_client as sc
import app.main as main


@pytest.fixture
def client():
    return TestClient(main.app)


class _ClienteFalso:
    """Imita o encadeamento do supabase-py so ate onde o endpoint usa."""

    def __init__(self, erro=None):
        self._erro = erro
        self.consultou = False

    def table(self, _nome):
        return self

    def select(self, *_a, **_kw):
        return self

    def limit(self, *_a, **_kw):
        return self

    def execute(self):
        if self._erro is not None:
            raise self._erro
        self.consultou = True
        return self


def test_ready_200_quando_o_banco_responde(client, monkeypatch):
    falso = _ClienteFalso()
    monkeypatch.setattr(sc, "get_supabase_service", lambda: falso)

    r = client.get("/health/ready")

    assert r.status_code == 200
    corpo = r.json()
    assert corpo["status"] == "ready"
    assert corpo["db"] == "ok"
    assert falso.consultou, "readiness tem de CONSULTAR, nao so construir o cliente"


def test_ready_503_quando_o_cliente_nao_constroi(client, monkeypatch):
    """O modo de falha real do outage: estouro na CONSTRUCAO do cliente."""

    def explode():
        raise TypeError("ClientOptions.__init__() got an unexpected keyword argument")

    monkeypatch.setattr(sc, "get_supabase_service", explode)

    r = client.get("/health/ready")

    assert r.status_code == 503, "um deploy com o banco inalcancavel nao pode passar"
    assert r.json()["db"] == "erro"
    assert "TypeError" in r.json()["detail"], "o corpo precisa dizer QUAL erro"


def test_ready_503_quando_a_consulta_falha(client, monkeypatch):
    monkeypatch.setattr(
        sc, "get_supabase_service", lambda: _ClienteFalso(erro=RuntimeError("timeout"))
    )

    r = client.get("/health/ready")

    assert r.status_code == 503


def test_health_continua_raso(client, monkeypatch):
    """Liveness NAO pode consultar o banco.

    Se consultasse, uma indisponibilidade do Supabase marcaria os containers
    como unhealthy e o Traefik os tiraria da rotacao: um solucao de banco
    viraria queda total. A protecao contra outage nao pode ser a causa dele.
    """
    def nao_deveria_ser_chamado():
        raise AssertionError("/health nao pode tocar no banco")

    monkeypatch.setattr(sc, "get_supabase_service", nao_deveria_ser_chamado)

    r = client.get("/health")

    assert r.status_code == 200
    assert r.json()["status"] == "healthy"
