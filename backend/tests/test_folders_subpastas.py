"""
Subpastas (migration 174): a rota traduz as regras que o banco impõe.

O que o banco barra (ciclo, pai alheio) está provado no teste SQL
`supabase/tests/174_subpastas.test.sql`. Aqui fica só a borda HTTP:
  - erro de regra vira 4xx legível, não 500 opaco;
  - a RPC recebe os argumentos com os nomes certos (um nome errado de parâmetro
    no PostgREST é 404 "function not found" em produção, calado nos testes);
  - a validação barata acontece ANTES de gastar uma ida ao banco.
"""

from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient
from postgrest.exceptions import APIError

import app.main as main
from app.core.auth import get_current_user
from app.routes import folders

F = "17400000-0000-4000-8000-00000000000a"
P = "17400000-0000-4000-8000-00000000000b"


@pytest.fixture
def sb(monkeypatch):
    main.app.dependency_overrides[get_current_user] = lambda: {"user_id": "u1", "token": "tok"}
    client = MagicMock()
    monkeypatch.setattr(folders, "get_supabase_for_user", lambda token: client)
    yield client
    main.app.dependency_overrides.pop(get_current_user, None)


def _rpc_returns(sb, data):
    sb.rpc.return_value.execute.return_value = MagicMock(data=data)


def _rpc_raises(sb, message):
    sb.rpc.return_value.execute.side_effect = APIError({"message": message, "code": "P0001", "hint": None, "details": None})


def test_place_manda_os_argumentos_da_rpc(sb):
    _rpc_returns(sb, 2)
    r = TestClient(main.app).post(f"/folders/{F}/place", json={"parent_id": P, "sibling_ids": [F]})
    assert r.status_code == 200, r.text
    assert r.json()["changed"] == 2
    sb.rpc.assert_called_once_with("place_folder", {"p_folder_id": F, "p_parent_id": P, "p_sibling_ids": [F]})


def test_place_na_raiz_manda_parent_nulo(sb):
    _rpc_returns(sb, 1)
    r = TestClient(main.app).post(f"/folders/{F}/place", json={"parent_id": None, "sibling_ids": [F]})
    assert r.status_code == 200, r.text
    assert sb.rpc.call_args.args[1]["p_parent_id"] is None


def test_place_sem_a_pasta_na_lista_nem_chega_no_banco(sb):
    r = TestClient(main.app).post(f"/folders/{F}/place", json={"parent_id": None, "sibling_ids": [P]})
    assert r.status_code == 422
    sb.rpc.assert_not_called()


def test_ciclo_vira_422_legivel(sb):
    _rpc_raises(sb, "folder_cycle")
    r = TestClient(main.app).post(f"/folders/{F}/place", json={"parent_id": P, "sibling_ids": [F]})
    assert r.status_code == 422
    assert "dentro dela mesma" in r.json()["detail"]


def test_pai_inexistente_vira_404(sb):
    _rpc_raises(sb, "folder_parent_not_found")
    r = TestClient(main.app).post(f"/folders/{F}/place", json={"parent_id": P, "sibling_ids": [F]})
    assert r.status_code == 404


def test_erro_desconhecido_continua_500(sb):
    _rpc_raises(sb, "algo inesperado")
    r = TestClient(main.app).post(f"/folders/{F}/place", json={"parent_id": P, "sibling_ids": [F]})
    assert r.status_code == 500


def test_desfazer_usa_dissolve_e_devolve_o_que_subiu(sb):
    _rpc_returns(sb, {"parent_id": P, "folders_moved": 2, "packs_moved": 3})
    r = TestClient(main.app).delete(f"/folders/{F}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert (body["parent_id"], body["folders_moved"], body["packs_moved"]) == (P, 2, 3)
    sb.rpc.assert_called_once_with("dissolve_folder", {"p_folder_id": F})
    # Nada de DELETE direto na tabela: ele levaria o conteúdo para a raiz.
    sb.table.return_value.delete.assert_not_called()


def test_desfazer_pasta_inexistente_vira_404(sb):
    _rpc_raises(sb, "folder_not_found")
    r = TestClient(main.app).delete(f"/folders/{F}")
    assert r.status_code == 404
