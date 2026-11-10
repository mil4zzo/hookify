# -*- coding: utf-8 -*-
"""Pasta guarda o criterio de julgamento e o pack que entra o herda (migration 185).

Trava:
- a fusao do documento da pasta: valor define, null remove a chave, evento null tira so
  aquele evento, e sem sobra a pasta deixa de definir (None);
- a heranca: o criterio resolvido (ja subindo pelos pais, no banco) vai aos packs que
  entraram, com o papel conferido pelo mesmo caminho da acao em massa;
- pasta sem criterio nao toca em pack nenhum;
- falha na heranca NUNCA levanta (o pack ja esta na pasta).

Sabotagens feitas: gravar null no lugar de tirar a chave -> test_limpar_nao_propaga falha;
trocar o merge de target_cpr por substituicao do mapa -> test_target_cpr_funde_por_evento
falha; deixar a excecao escapar de inherit_folder_judgment -> test_falha_nao_levanta falha.
"""
from app.routes import analytics
from app.services import folders_judgment as fj


def test_valor_define_e_funde_com_o_que_ja_estava():
    stored = {"mql_leadscore_min": 60, "target_cpr": {"conversion:lead": 10}}
    out = fj.merge_folder_judgment(stored, {"mql_leadscore_min": 70, "lead_economics": {"products": []}})
    assert out == {"mql_leadscore_min": 70, "target_cpr": {"conversion:lead": 10}, "lead_economics": {"products": []}}


def test_limpar_nao_propaga():
    out = fj.merge_folder_judgment({"mql_leadscore_min": 60, "lead_economics": {"x": 1}}, {"mql_leadscore_min": None})
    assert out == {"lead_economics": {"x": 1}}  # a chave sai; null nunca e gravado
    assert fj.merge_folder_judgment({"mql_leadscore_min": 60}, {"mql_leadscore_min": None}) is None


def test_target_cpr_funde_por_evento():
    stored = {"target_cpr": {"a": 1, "b": 2}}
    assert fj.merge_folder_judgment(stored, {"target_cpr": {"b": None, "c": 3}}) == {"target_cpr": {"a": 1, "c": 3}}
    assert fj.merge_folder_judgment(stored, {"target_cpr": None}) is None  # null no topo limpa todas
    assert fj.merge_folder_judgment({"target_cpr": {"a": 1}}, {"target_cpr": {"a": None}}) is None


def _user():
    return {"user_id": "u1", "token": "tok"}


class _Rpc:
    def __init__(self, data):
        self._data = data

    def execute(self):
        class R:
            pass
        r = R()
        r.data = self._data
        return r


class _SB:
    def __init__(self, judgment):
        self.judgment = judgment
        self.calls = []

    def rpc(self, name, params):
        self.calls.append((name, params))
        return _Rpc(self.judgment)


def test_pack_que_entra_herda(monkeypatch):
    sb = _SB({"mql_leadscore_min": 60, "target_cpr": {"conversion:lead": 12}, "outro": 1})
    monkeypatch.setattr(fj, "get_supabase_for_user", lambda token: sb)
    seen = {}
    monkeypatch.setattr(analytics, "apply_judgment_to_packs", lambda actor, ids, fields: seen.update(actor=actor, ids=ids, fields=fields) or [{"pack_id": "p1", "status": "updated"}])

    out = fj.inherit_folder_judgment(_user(), "f1", ["p1"])

    assert out == [{"pack_id": "p1", "status": "updated"}]
    assert seen == {"actor": "u1", "ids": ["p1"], "fields": {"mql_leadscore_min": 60, "target_cpr": {"conversion:lead": 12}}}
    assert sb.calls == [("resolve_folder_judgment", {"p_folder_id": "f1", "p_own_only": False})]


def test_pasta_sem_criterio_nao_toca_em_nada(monkeypatch):
    monkeypatch.setattr(fj, "get_supabase_for_user", lambda token: _SB(None))
    monkeypatch.setattr(analytics, "apply_judgment_to_packs", lambda *a: (_ for _ in ()).throw(AssertionError("nao devia gravar")))
    assert fj.inherit_folder_judgment(_user(), "f1", ["p1"]) is None


def test_falha_nao_levanta(monkeypatch):
    monkeypatch.setattr(fj, "get_supabase_for_user", lambda token: _SB({"mql_leadscore_min": 60}))
    monkeypatch.setattr(analytics, "apply_judgment_to_packs", lambda *a: (_ for _ in ()).throw(RuntimeError("banco caiu")))
    assert fj.inherit_folder_judgment(_user(), "f1", ["p1"]) is None


# ── Pack compartilhado nao entra em pasta propria com criterio (migration 187) ──
# Sabotagem: tirar a checagem de move_conflicts da rota -> este teste falha (a RPC de mover roda).

def test_mover_pack_compartilhado_para_pasta_com_criterio_e_recusado(monkeypatch):
    import pytest
    from fastapi import HTTPException
    from app.routes import folders as folders_route

    rpcs = []

    class SB:
        def rpc(self, name, params):
            rpcs.append(name)
            return _Rpc(1)

    monkeypatch.setattr(folders_route, "get_supabase_for_user", lambda token: SB())
    monkeypatch.setattr(fj, "move_conflicts", lambda token, ids, folder: ["00000000-0000-4000-8000-0000000000d1"])
    with pytest.raises(HTTPException) as e:
        folders_route.move_packs(
            folders_route.MoveRequest(pack_ids=["00000000-0000-4000-8000-0000000000d1"], folder_id="00000000-0000-4000-8000-0000000000f1"),
            _user(),
        )
    assert e.value.status_code == 409 and "compartilhado" in e.value.detail
    assert "move_packs_to_folder" not in rpcs


# ── Pasta com pack compartilhado dentro (migration 187) ──
# Sabotagens: tirar place_conflicts da rota de mover pasta -> o primeiro teste falha (a RPC roda);
# tirar a checagem de create_folder -> o segundo falha (a pasta e criada).

_F1 = "00000000-0000-4000-8000-0000000000f1"
_F2 = "00000000-0000-4000-8000-0000000000f2"
_D1 = "00000000-0000-4000-8000-0000000000d1"


def test_mover_pasta_com_pack_compartilhado_para_pasta_com_criterio_e_recusado(monkeypatch):
    import pytest
    from fastapi import HTTPException
    from app.routes import folders as folders_route

    rpcs = []

    class SB:
        def rpc(self, name, params):
            rpcs.append(name)
            return _Rpc(1)

    monkeypatch.setattr(folders_route, "get_supabase_for_user", lambda token: SB())
    monkeypatch.setattr(fj, "place_conflicts", lambda token, folder_id, parent_id: [{"id": _D1, "name": "Pack do parceiro"}])
    with pytest.raises(HTTPException) as e:
        folders_route.place_folder(_F1, folders_route.PlaceRequest(parent_id=_F2, sibling_ids=[_F1]), _user())
    assert e.value.status_code == 409 and "compartilhados" in e.value.detail
    assert "place_folder" not in rpcs


def test_criar_pasta_com_pack_compartilhado_sob_criterio_nao_cria_nada(monkeypatch):
    import pytest
    from fastapi import HTTPException
    from app.routes import folders as folders_route

    rpcs = []

    class SB:
        def rpc(self, name, params):
            rpcs.append(name)
            return _Rpc({"id": _F1})

    monkeypatch.setattr(folders_route, "get_supabase_for_user", lambda token: SB())
    monkeypatch.setattr(fj, "move_conflicts", lambda token, ids, folder: [_D1])
    with pytest.raises(HTTPException) as e:
        folders_route.create_folder(folders_route.FolderCreate(name="Nova", pack_ids=[_D1], parent_id=_F2), _user())
    assert e.value.status_code == 409
    assert "create_folder" not in rpcs


def test_bloqueios_da_pasta_dizem_quais_packs(monkeypatch):
    from app.routes import folders as folders_route

    monkeypatch.setattr(fj, "archived_packs", lambda token, folder_id: [{"id": _D1, "name": "Pack do parceiro"}, {"id": _F2, "name": None}])
    out = folders_route.get_folder_judgment_blockers(_F1, _user())
    assert [p["id"] for p in out["packs"]] == [_D1, _F2]
    assert "Pack do parceiro" in out["message"] and "e mais 1 que voce nao enxerga" in out["message"]

    monkeypatch.setattr(fj, "archived_packs", lambda token, folder_id: [])
    assert folders_route.get_folder_judgment_blockers(_F1, _user()) == {"packs": [], "message": None}


# ── Reconciliacao depois de arrastar pasta (revisao da 187/188) ──
# Sabotagens: reconcile_on_place sem `reconciled` -> o primeiro falha; deixar a excecao do
# inherit passar calada (raise_errors ignorado) -> o segundo falha (failed fica False).

def test_arrastar_pasta_para_mae_que_manda_avisa_que_reconciliou_mesmo_sem_pack(monkeypatch):
    monkeypatch.setattr(fj, "get_supabase_for_user", lambda token: _SB({"mql_leadscore_min": 70}))
    monkeypatch.setattr(fj, "folder_governed_pack_ids", lambda token, folder_id: [])
    assert fj.reconcile_on_place(_user(), "f1") == {"reconciled": True, "inherited": None, "failed": False}


def test_mae_sem_criterio_nao_reconcilia_nada(monkeypatch):
    monkeypatch.setattr(fj, "get_supabase_for_user", lambda token: _SB(None))
    assert fj.reconcile_on_place(_user(), "f1") == {"reconciled": False, "inherited": None, "failed": False}


def test_reconciliacao_que_quebra_nao_levanta_mas_avisa(monkeypatch):
    monkeypatch.setattr(fj, "get_supabase_for_user", lambda token: _SB({"mql_leadscore_min": 70}))
    monkeypatch.setattr(fj, "folder_governed_pack_ids", lambda token, folder_id: ["p1"])
    monkeypatch.setattr(analytics, "apply_judgment_to_packs", lambda *a: (_ for _ in ()).throw(RuntimeError("banco caiu")))
    out = fj.reconcile_on_place(_user(), "f1")
    assert out["failed"] is True and out["reconciled"] is True and out["inherited"] is None


# ── Trava no banco (migration 190): a corrida cai no gatilho e vira 409, nao 500 ──
# Sabotagem: tirar "judgment_shared_pack_conflict" de _FOLDER_ERRORS -> este teste falha (500).

def test_conflito_do_gatilho_do_banco_vira_409(monkeypatch):
    import pytest
    from fastapi import HTTPException
    from postgrest.exceptions import APIError
    from app.routes import folders as folders_route

    class SB:
        def rpc(self, name, params):
            raise APIError({"message": "judgment_shared_pack_conflict", "code": "P0001"})

    monkeypatch.setattr(folders_route, "get_supabase_for_user", lambda token: SB())
    monkeypatch.setattr(fj, "place_conflicts", lambda *a, **k: [])
    with pytest.raises(HTTPException) as e:
        folders_route.place_folder(_F1, folders_route.PlaceRequest(parent_id=_F2, sibling_ids=[_F1]), _user())
    assert e.value.status_code == 409 and "compartilhados" in e.value.detail
