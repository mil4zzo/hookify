"""
`GET /analytics/packs` nao carrega `ad_ids` quando o cliente nao pediu os ads.

CONTEXTO (2026-08-26)
---------------------
O repo faz `select("*")` e trazia o array `ad_ids` inteiro em toda listagem.
Medido: 6 packs = 504 kB, dos quais ~425 kB eram ad_ids (ate 5.701 ids por
pack). O frontend nunca le `pack.ad_ids` desta lista -- o store copia campos
explicitos e o contador de anuncios vem de `stats.uniqueAds` -- e a lista e
carregada em TODA pagina do app, nao so no Manager.

O caminho `include_ads=true` nao depende do array: `get_ads_for_pack` deriva os
ids da `ad_metric_pack_map` (fonte de verdade desde a migration 072).
"""

import pytest
from fastapi.testclient import TestClient

import app.main as main
from app.core.auth import get_current_user
from app.routes import analytics
from app.services import supabase_repo


def _usuario_falso():
    return {"user_id": "u1", "token": "tok"}


@pytest.fixture
def client(monkeypatch):
    main.app.dependency_overrides[get_current_user] = _usuario_falso

    packs = [
        {
            "id": "p1",
            "user_id": "u1",
            "name": "Pack A",
            "ad_ids": [f"ad{i}" for i in range(5000)],
            "stats": {"totalSpend": 10.0, "uniqueAds": 5000},
            "conversion_types": ["action:purchase"],
        },
        {
            "id": "p2",
            "user_id": "u1",
            "name": "Pack B",
            "ad_ids": ["x1", "x2"],
            "stats": {"totalSpend": 1.0, "uniqueAds": 2},
        },
    ]
    monkeypatch.setattr(supabase_repo, "list_packs", lambda *_a, **_k: [dict(p) for p in packs])
    monkeypatch.setattr(supabase_repo, "list_shared_packs", lambda *_a, **_k: [])
    monkeypatch.setattr(supabase_repo, "get_ads_for_pack", lambda *_a, **_k: [{"ad_id": "x1"}])
    monkeypatch.setattr(analytics, "get_supabase_service", lambda: object())

    yield TestClient(main.app)
    main.app.dependency_overrides.pop(get_current_user, None)


def test_sem_include_ads_nao_traz_ad_ids(client):
    r = client.get("/analytics/packs", params={"include_ads": "false"})
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    assert len(body["packs"]) == 2
    for pack in body["packs"]:
        assert "ad_ids" not in pack, "ad_ids e peso morto na listagem"
    # O que o frontend realmente usa continua vindo.
    assert body["packs"][0]["stats"]["uniqueAds"] == 5000
    assert body["packs"][0]["conversion_types"] == ["action:purchase"]


def test_default_e_sem_ads(client):
    # `include_ads` default e False -- e o caminho de useLoadPacks.
    r = client.get("/analytics/packs")
    assert r.status_code == 200
    assert all("ad_ids" not in p for p in r.json()["packs"])


def test_com_include_ads_traz_ads_e_preserva_o_resto(client):
    r = client.get("/analytics/packs", params={"include_ads": "true"})
    assert r.status_code == 200
    packs = r.json()["packs"]
    assert all("ads" in p for p in packs)
    assert packs[0]["ads"] == [{"ad_id": "x1"}]
    # Caminho conservador: aqui nada foi removido do que ja vinha.
    assert "ad_ids" in packs[0]
