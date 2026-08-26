"""
A API comprime respostas grandes.

CONTEXTO (2026-08-26)
---------------------
Medido em producao: a API respondia SEM compressao nenhuma -- nem no FastAPI,
nem no Traefik. `/openapi.json` (128 kB) saia com `Content-Length: 128175` e
sem `Content-Encoding`. A resposta do Manager (~1 MB de JSON com arrays
numericos) atravessava a rede crua, e comprime 4-6x.

Estes testes travam tres coisas: comprime quando o cliente aceita e o corpo e
grande; NAO comprime corpo pequeno (o cabecalho custaria mais que o ganho); e
NAO comprime quando o cliente nao pediu (curl sem flag, clientes antigos).
"""

import pytest
from fastapi.testclient import TestClient

import app.main as main


@pytest.fixture
def client():
    return TestClient(main.app)


def test_resposta_grande_sai_comprimida(client):
    r = client.get("/openapi.json", headers={"Accept-Encoding": "gzip"})
    assert r.status_code == 200
    assert r.headers.get("content-encoding") == "gzip"
    # O TestClient descomprime de forma transparente: o JSON continua legivel.
    assert "paths" in r.json()


def test_resposta_pequena_nao_e_comprimida(client):
    # /health tem ~300 bytes -- abaixo do minimum_size de 1000.
    r = client.get("/health", headers={"Accept-Encoding": "gzip"})
    assert r.status_code == 200
    assert "content-encoding" not in r.headers


def test_sem_accept_encoding_nao_comprime(client):
    # httpx manda Accept-Encoding por padrao; zerar para simular cliente que nao aceita.
    r = client.get("/openapi.json", headers={"Accept-Encoding": "identity"})
    assert r.status_code == 200
    assert "content-encoding" not in r.headers
