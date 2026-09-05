# -*- coding: utf-8 -*-
"""Quem esta atualizando (nome no selo) e o logout que NAO mata mais o refresh.

CONTEXTO (2026-09-05)
---------------------
Duas decisoes tomadas juntas:

1. `attach_refresh_actor_names` resolve QUEM disparou o refresh, em nome. A lista
   de packs e carregada em TODA pagina do app, entao a RPC de nomes so pode sair
   quando ha de fato alguem atualizando — caso contrario vira imposto permanente
   por um dado que quase sempre nao existe. O uuid do ator nunca vai para o
   cliente, e quando o ator e o proprio leitor o nome fica nulo de proposito.

2. O logout parou de cancelar o refresh do pack. Cancelar nunca foi necessidade
   tecnica (o job roda com service role); era escolha, e incoerente: fechar a aba
   deixava terminar, logout matava. Num pack compartilhado, o logout de um membro
   derrubava a atualizacao que o outro esperava. O sync de planilha ENCADEADO no
   refresh e preservado junto; um sync AVULSO continua sendo cancelado.
"""
from unittest import mock

import pytest
from fastapi.testclient import TestClient

import app.main as main
from app.core.auth import get_current_user
from app.routes import facebook
from app.services import supabase_repo


# ─────────────────────────── quem esta atualizando ───────────────────────────

def _packs():
    return [
        {"id": "p1", "refresh_status": "running", "refresh_actor_id": "ator-1"},
        {"id": "p2", "refresh_status": "running", "refresh_actor_id": "leitor"},
        {"id": "p3", "refresh_status": "success", "refresh_actor_id": "ator-1"},
        {"id": "p4", "refresh_status": "idle", "refresh_actor_id": None},
    ]


def test_resolve_nome_do_ator_e_nunca_vaza_uuid(monkeypatch):
    sb = mock.Mock()
    # O nome do PROPRIO leitor tambem volta da RPC de proposito: se o filtro de
    # "sou eu" sumisse, o teste precisa ver o nome aparecer indevidamente em p2.
    sb.rpc.return_value.execute.return_value = mock.Mock(
        data=[
            {"user_id": "ator-1", "display_name": "Fulano"},
            {"user_id": "leitor", "display_name": "Eu Mesmo"},
        ]
    )
    monkeypatch.setattr(supabase_repo, "get_supabase_service", lambda: sb)

    packs = _packs()
    supabase_repo.attach_refresh_actor_names(packs, viewer_id="leitor")

    por_id = {p["id"]: p for p in packs}
    assert por_id["p1"]["refresh_actor_name"] == "Fulano"
    # O leitor disparou o proprio refresh: nome nulo, o estado local ja cobre.
    assert por_id["p2"]["refresh_actor_name"] is None
    # Pack que nao esta atualizando nao ganha nome, mesmo tendo ator antigo na linha.
    assert por_id["p3"]["refresh_actor_name"] is None
    # O uuid do ator sai do payload em TODOS os packs.
    for pack in packs:
        assert "refresh_actor_id" not in pack


def test_sem_pack_atualizando_nao_ha_ida_ao_banco(monkeypatch):
    """A lista de packs abre em toda pagina: a RPC de nomes nao pode ser incondicional."""
    chamou = []
    monkeypatch.setattr(
        supabase_repo, "get_supabase_service", lambda: chamou.append(1) or mock.Mock()
    )

    packs = [
        {"id": "p3", "refresh_status": "success", "refresh_actor_id": "ator-1"},
        {"id": "p4", "refresh_status": "idle", "refresh_actor_id": None},
    ]
    supabase_repo.attach_refresh_actor_names(packs, viewer_id="leitor")

    assert chamou == [], "nenhum pack atualizando => zero RPC"
    assert all(p["refresh_actor_name"] is None for p in packs)


def test_falha_ao_resolver_nome_nao_derruba_a_lista(monkeypatch):
    def _explode():
        raise RuntimeError("RPC fora do ar")

    monkeypatch.setattr(supabase_repo, "get_supabase_service", _explode)
    packs = _packs()
    supabase_repo.attach_refresh_actor_names(packs, viewer_id="leitor")
    assert packs[0]["refresh_actor_name"] is None  # cai no selo generico


# ────────────────────────── logout preserva o refresh ─────────────────────────

@pytest.fixture
def client(monkeypatch):
    main.app.dependency_overrides[get_current_user] = lambda: {
        "user_id": "u1", "token": "tok"
    }

    linhas = [
        {"id": "job-refresh", "user_id": "u1",
         "payload": {"is_refresh": True, "pack_id": "p1", "chained_sync_job_id": "job-sync-colado"}},
        {"id": "job-sync-colado", "user_id": "u1", "payload": {"type": "google_sheet_sync"}},
        {"id": "job-sync-avulso", "user_id": "u1", "payload": {"type": "google_sheet_sync"}},
        {"id": "job-transcricao", "user_id": "u1", "payload": {"type": "transcription"}},
    ]

    sb = mock.Mock()
    sb.table.return_value.select.return_value.in_.return_value.execute.return_value = mock.Mock(data=linhas)
    monkeypatch.setattr(facebook, "get_supabase_service", lambda: sb)

    cancelados = []

    class _Tracker:
        def cancel_jobs_batch(self, ids, reason):
            cancelados.extend(ids)
            return len(ids)

    monkeypatch.setattr(facebook, "get_job_tracker", lambda *a, **k: _Tracker())
    monkeypatch.setattr(supabase_repo, "clear_pack_refresh_if_running", lambda *a, **k: 0)

    c = TestClient(main.app)
    c.cancelados = cancelados
    yield c
    main.app.dependency_overrides.pop(get_current_user, None)


TODOS = ["job-refresh", "job-sync-colado", "job-sync-avulso", "job-transcricao"]


def test_logout_preserva_refresh_e_a_planilha_colada_nele(client):
    r = client.post("/facebook/jobs/cancel-batch",
                    json={"job_ids": TODOS, "reason": "logout", "skip_refresh": True})
    assert r.status_code == 200
    assert r.json()["preserved_count"] == 2

    assert "job-refresh" not in client.cancelados
    assert "job-sync-colado" not in client.cancelados, "a cadeia colada no refresh vai junto"
    # O que NAO e refresh continua morrendo no logout, como antes.
    assert "job-sync-avulso" in client.cancelados
    assert "job-transcricao" in client.cancelados


def test_botao_de_cancelar_explicito_continua_matando_tudo(client):
    """Sem skip_refresh o comportamento e o de sempre: ali o usuario disse "pare"."""
    r = client.post("/facebook/jobs/cancel-batch",
                    json={"job_ids": TODOS, "reason": "cancelado pelo usuario"})
    assert r.status_code == 200
    assert r.json()["preserved_count"] == 0
    assert set(client.cancelados) == set(TODOS)
