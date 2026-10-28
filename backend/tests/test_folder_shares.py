"""
Pasta compartilhada (migration 181): a borda HTTP e o antes/depois.

O que concede e retira acesso sao os gatilhos do banco — provados em
`supabase/tests/181_pastas_compartilhadas.test.sql`. Aqui fica o que o Python faz ao redor:

  - a regra "quem e dono" nao vem do cliente (owner_id sai do ATOR);
  - o acesso que vem de pasta e SOMENTE LEITURA no pack (409 com o motivo, nunca um
    sucesso que o gatilho desfaria na proxima mudanca);
  - o antes/depois que alimenta o feed e a tela ("agora visivel para N") conta certo
    e nao custa nada a quem nunca compartilhou pasta;
  - as pastas recebidas chegam na lista, e toda escrita de pasta vai pelas RPCs (que
    conferem o papel), com os erros de regra virando 4xx legiveis;
  - excluir pack: dono, ou editor que recebeu o pack POR PASTA — nunca por convite direto.
"""
from __future__ import annotations

from types import SimpleNamespace
from typing import Any, Dict, List

import pytest
from fastapi import HTTPException

from app.routes import folder_shares, folders as folders_route, pack_shares
from app.services import folder_scope

ACTOR = "11111111-1111-4111-8111-111111111111"
GUEST = "22222222-2222-4222-8222-222222222222"
F_ROOT = "aaaaaaaa-0000-4000-8000-000000000001"
F_SUB = "aaaaaaaa-0000-4000-8000-000000000002"
F_OTHER = "aaaaaaaa-0000-4000-8000-000000000003"
P1 = "bbbbbbbb-0000-4000-8000-000000000001"
P2 = "bbbbbbbb-0000-4000-8000-000000000002"
P3 = "bbbbbbbb-0000-4000-8000-000000000003"
USER = {"user_id": ACTOR, "token": "jwt"}


# ── Cliente falso: grava as chamadas, responde por (tabela, operacao) ────────

class FakeQuery:
    def __init__(self, sb: "FakeSB", table: str):
        self.sb, self.table, self.op = sb, table, "select"
        self.payload: Any = None
        self.kwargs: Dict[str, Any] = {}
        self.calls: List[tuple] = []

    def _rec(self, name: str, *args, **kwargs):
        self.calls.append((name, args, kwargs))
        return self

    def select(self, *a, **k): return self._rec("select", *a, **k)
    def eq(self, *a, **k): return self._rec("eq", *a, **k)
    def in_(self, *a, **k): return self._rec("in_", *a, **k)
    def is_(self, *a, **k): return self._rec("is_", *a, **k)
    def limit(self, *a, **k): return self._rec("limit", *a, **k)
    def order(self, *a, **k): return self._rec("order", *a, **k)

    @property
    def not_(self): return self

    def upsert(self, payload, **kw):
        self.op, self.payload, self.kwargs = "upsert", payload, kw
        return self

    def update(self, payload):
        self.op, self.payload = "update", payload
        return self

    def delete(self):
        self.op = "delete"
        return self

    def execute(self):
        self.sb.queries.append(self)
        return SimpleNamespace(data=self.sb.respond(self), count=None)


class FakeSB:
    def __init__(self, responses: Dict[tuple, Any]):
        self.responses = responses
        self.queries: List[FakeQuery] = []
        self.rpcs: List[tuple] = []

    def table(self, name: str) -> FakeQuery:
        return FakeQuery(self, name)

    def rpc(self, name: str, params: Dict[str, Any]):
        self.rpcs.append((name, params))
        value = self.responses.get(("rpc", name), [])
        if isinstance(value, Exception):
            raise value
        data = value(params) if callable(value) else value
        return SimpleNamespace(execute=lambda: SimpleNamespace(data=data))

    def respond(self, q: FakeQuery):
        value = self.responses.get((q.table, q.op), [])
        return value(q) if callable(value) else value

    def find(self, table: str, op: str) -> List[FakeQuery]:
        return [q for q in self.queries if q.table == table and q.op == op]


@pytest.fixture
def no_names(monkeypatch):
    monkeypatch.setattr(folder_shares, "_hydrate_display_names", lambda ids: {})
    monkeypatch.setattr(folder_shares, "get_supabase_service", lambda: FakeSB({}))


def _tree_responses() -> Dict[tuple, Any]:
    """R > S com P1 em R, P2 em S e P3 (de outro dono) em S."""
    return {
        ("folders", "select"): [
            {"id": F_ROOT, "name": "Cliente A", "parent_id": None},
            {"id": F_SUB, "name": "Q4", "parent_id": F_ROOT},
        ],
        ("pack_folder_members", "select"): lambda q: (
            # Pergunta "quais o proprio dono pos aqui": nenhum.
            [] if ("eq", ("contributed", True), {}) in q.calls else [
                {"pack_id": P1, "folder_id": F_ROOT},
                {"pack_id": P2, "folder_id": F_SUB},
                {"pack_id": P3, "folder_id": F_SUB},
            ]
        ),
        ("packs", "select"): [{"id": P1}, {"id": P2}],  # P3 nao e do ator
    }


# ── Funcoes puras ───────────────────────────────────────────────────────────

FOLDERS = [
    {"id": "r", "parent_id": None},
    {"id": "s", "parent_id": "r"},
    {"id": "t", "parent_id": "s"},
    {"id": "x", "parent_id": None},
]


def test_subarvore_inclui_a_pasta_e_todas_as_descendentes():
    assert sorted(folder_scope.subtree_folder_ids(FOLDERS, "r")) == ["r", "s", "t"]
    assert folder_scope.subtree_folder_ids(FOLDERS, "x") == ["x"]
    assert folder_scope.subtree_folder_ids(FOLDERS, "t") == ["t"]


def test_subarvore_termina_mesmo_com_ciclo_corrompido():
    cyclic = [{"id": "a", "parent_id": "b"}, {"id": "b", "parent_id": "a"}]
    assert sorted(folder_scope.subtree_folder_ids(cyclic, "a")) == ["a", "b"]
    assert folder_scope.ancestor_ids(cyclic, "a") == ["b"]


def test_ancestrais_da_mais_proxima_ate_a_raiz():
    assert folder_scope.ancestor_ids(FOLDERS, "t") == ["s", "r"]
    assert folder_scope.ancestor_ids(FOLDERS, "r") == []


def test_packs_das_pastas():
    members = {"p1": "r", "p2": "s", "p3": "x"}
    assert sorted(folder_scope.pack_ids_in_folders(members, ["r", "s"])) == ["p1", "p2"]


def test_diff_separa_concedido_retirado_e_papel_trocado():
    before = {
        ("p1", "g"): {"role": "editor", "folder_id": "r"},
        ("p2", "g"): {"role": "viewer", "folder_id": "r"},
        ("p3", "g"): {"role": "editor", "folder_id": "r"},
    }
    after = {
        ("p1", "g"): {"role": "editor", "folder_id": "r"},   # igual
        ("p2", "g"): {"role": "editor", "folder_id": "r"},   # papel mudou
        ("p4", "g"): {"role": "viewer", "folder_id": "r"},   # novo
    }
    diff = folder_scope.diff_snapshots(before, after)
    assert diff["granted"] == {("g", "viewer", None): ["p4"]}
    assert diff["changed"] == {("g", "editor", None): ["p2"]}
    assert diff["revoked"] == {("g", "editor", None): ["p3"]}


def test_diff_separa_por_dono_do_pack():
    # Gesto do editor numa pasta compartilhada: o pack que ele pos la e DELE, os outros
    # do dono da arvore. Cada linha do feed vai para o silo de um dono.
    after = {
        ("p1", "g"): {"role": "editor", "folder_id": "r", "owner_id": "dono"},
        ("p9", "g"): {"role": "editor", "folder_id": "r", "owner_id": "editor"},
    }
    diff = folder_scope.diff_snapshots({}, after)
    assert diff["granted"] == {("g", "editor", "dono"): ["p1"], ("g", "editor", "editor"): ["p9"]}


# ── tracked_access_changes ──────────────────────────────────────────────────

def test_quem_nunca_compartilhou_pasta_nao_paga_foto_nenhuma(monkeypatch):
    monkeypatch.setattr(folder_scope, "actor_has_folder_shares", lambda sb: False)

    shots: List[Any] = []
    # Lista e nao `raise`: a foto e best-effort e engole excecao, entao um assert
    # dentro dela passaria calado.
    monkeypatch.setattr(folder_scope, "derived_snapshot", lambda ids: shots.append(ids) or {})
    with folder_scope.tracked_access_changes(object(), ACTOR, [P1]) as changes:
        pass
    assert changes == {"granted": 0, "revoked": 0, "changed": 0}
    assert shots == []


def test_antes_e_depois_contam_e_registram_no_feed(monkeypatch):
    shots = iter([
        {},
        {(P1, GUEST): {"role": "editor", "folder_id": F_ROOT}, (P2, GUEST): {"role": "editor", "folder_id": F_ROOT}},
    ])
    logged: List[Dict[str, Any]] = []
    monkeypatch.setattr(folder_scope, "actor_has_folder_shares", lambda sb: True)
    monkeypatch.setattr(folder_scope, "derived_snapshot", lambda ids: next(shots))
    monkeypatch.setattr(folder_scope.pack_action_log, "log_pack_action", lambda **kw: logged.append(kw))

    with folder_scope.tracked_access_changes(object(), ACTOR, [P1, P2]) as changes:
        pass

    assert changes == {"granted": 2, "revoked": 0, "changed": 0}
    assert len(logged) == 1
    row = logged[0]
    assert row["action"] == folder_scope.pack_action_log.ACTION_SHARE_GRANT
    assert row["owner_id"] == ACTOR and row["actor_id"] == ACTOR
    assert sorted(row["pack_ids"]) == [P1, P2]
    assert row["target_ids"] == [GUEST]
    # O feed do pack e lido tambem pelo convidado: so a marca, nunca o nome da pasta.
    assert row["detail"] == {"role": "editor", "via_folder": True}


def test_gesto_do_editor_registra_no_silo_do_dono_de_cada_pack(monkeypatch):
    OWNER = "33333333-3333-4333-8333-333333333333"
    shots = iter([{}, {(P1, GUEST): {"role": "viewer", "folder_id": F_ROOT, "owner_id": OWNER}}])
    logged: List[Dict[str, Any]] = []
    monkeypatch.setattr(folder_scope, "actor_has_folder_shares", lambda sb: True)
    monkeypatch.setattr(folder_scope, "derived_snapshot", lambda ids: next(shots))
    monkeypatch.setattr(folder_scope.pack_action_log, "log_pack_action", lambda **kw: logged.append(kw))

    with folder_scope.tracked_access_changes(object(), ACTOR, [P1]):
        pass

    assert (logged[0]["owner_id"], logged[0]["actor_id"], logged[0]["actor_role"]) == (OWNER, ACTOR, "editor")


def test_falha_da_foto_nunca_derruba_o_gesto(monkeypatch):
    monkeypatch.setattr(folder_scope, "actor_has_folder_shares", lambda sb: (_ for _ in ()).throw(RuntimeError("rede")))
    ran = []
    with folder_scope.tracked_access_changes(object(), ACTOR, [P1]):
        ran.append(True)
    assert ran == [True]


def test_excecao_dentro_do_bloco_propaga_sem_foto_posterior(monkeypatch):
    calls = []
    monkeypatch.setattr(folder_scope, "actor_has_folder_shares", lambda sb: True)
    monkeypatch.setattr(folder_scope, "derived_snapshot", lambda ids: calls.append(ids) or {})
    with pytest.raises(HTTPException):
        with folder_scope.tracked_access_changes(object(), ACTOR, [P1]):
            raise HTTPException(status_code=404, detail="x")
    assert len(calls) == 1  # so a anterior


# ── /folder-shares ──────────────────────────────────────────────────────────

def test_compartilhar_grava_dono_do_ator_e_nao_do_cliente(monkeypatch, no_names):
    responses = {**_tree_responses(), ("folder_shares", "upsert"): [{"id": "s1", "folder_id": F_ROOT, "role": "editor"}]}
    sb = FakeSB(responses)
    monkeypatch.setattr(folder_shares, "get_supabase_for_user", lambda token: sb)
    monkeypatch.setattr(folder_scope, "actor_has_folder_shares", lambda s: False)

    out = folder_shares.create_folder_share(F_ROOT, folder_shares.CreateFolderShareRequest(grantee_id=GUEST, role="viewer"), USER)

    upsert = sb.find("folder_shares", "upsert")[0]
    assert upsert.payload == {"folder_id": F_ROOT, "owner_id": ACTOR, "grantee_id": GUEST, "role": "viewer"}
    assert upsert.kwargs == {"on_conflict": "folder_id,grantee_id"}
    # P3 e de outro dono: conta como "fora", nao como coberto.
    assert out["scope"] == {"subfolders": 1, "owned_packs": 2, "foreign_packs": 1}
    assert out["absorbed"] == 0


def test_compartilhar_conta_o_direto_que_a_pasta_absorve(monkeypatch):
    responses = {**_tree_responses(), ("folder_shares", "upsert"): [{"id": "s1"}]}
    sb = FakeSB(responses)
    monkeypatch.setattr(folder_shares, "get_supabase_for_user", lambda token: sb)
    monkeypatch.setattr(folder_shares, "_hydrate_display_names", lambda ids: {})
    monkeypatch.setattr(folder_scope, "actor_has_folder_shares", lambda s: False)
    service = FakeSB({("pack_shares", "select"): [{"pack_id": P1}]})
    monkeypatch.setattr(folder_shares, "get_supabase_service", lambda: service)

    out = folder_shares.create_folder_share(F_ROOT, folder_shares.CreateFolderShareRequest(grantee_id=GUEST, role="viewer"), USER)

    assert out["absorbed"] == 1
    # Contado ANTES de gravar (depois, o gatilho ja o transformou em "via pasta").
    order = [q.table for q in sb.queries + service.queries]
    assert service.queries[0].calls[-1] == ("is_", ("source_folder_id", "null"), {})
    assert sb.find("folder_shares", "upsert")
    assert "pack_shares" in order


def test_pasta_que_o_editor_pos_pack_dele_conta_como_coberta(monkeypatch, no_names):
    responses = {
        **_tree_responses(),
        ("pack_folder_members", "select"): lambda q: (
            [{"pack_id": P3}] if ("eq", ("contributed", True), {}) in q.calls else [
                {"pack_id": P1, "folder_id": F_ROOT},
                {"pack_id": P3, "folder_id": F_SUB},
            ]
        ),
    }
    monkeypatch.setattr(folder_shares, "get_supabase_for_user", lambda token: FakeSB(responses))
    out = folder_shares.list_folder_shares(F_ROOT, USER)
    assert out["scope"] == {"subfolders": 1, "owned_packs": 2, "foreign_packs": 0}


def test_compartilhar_consigo_mesmo_ou_papel_invalido_nao_chega_ao_banco(monkeypatch):
    sb = FakeSB(_tree_responses())
    monkeypatch.setattr(folder_shares, "get_supabase_for_user", lambda token: sb)
    with pytest.raises(HTTPException) as e:
        folder_shares.create_folder_share(F_ROOT, folder_shares.CreateFolderShareRequest(grantee_id=ACTOR, role="editor"), USER)
    assert e.value.status_code == 400
    with pytest.raises(HTTPException) as e:
        folder_shares.create_folder_share(F_ROOT, folder_shares.CreateFolderShareRequest(grantee_id=GUEST, role="dono"), USER)
    assert e.value.status_code == 400
    assert sb.queries == []


def test_pasta_alheia_e_404_nunca_403(monkeypatch):
    responses = {**_tree_responses(), ("folders", "select"): []}
    monkeypatch.setattr(folder_shares, "get_supabase_for_user", lambda token: FakeSB(responses))
    with pytest.raises(HTTPException) as e:
        folder_shares.create_folder_share(F_OTHER, folder_shares.CreateFolderShareRequest(grantee_id=GUEST, role="editor"), USER)
    assert e.value.status_code == 404


def test_id_que_nao_e_uuid_e_400(monkeypatch):
    monkeypatch.setattr(folder_shares, "get_supabase_for_user", lambda token: FakeSB({}))
    with pytest.raises(HTTPException) as e:
        folder_shares.list_folder_shares("nao-e-uuid", USER)
    assert e.value.status_code == 400


def test_trocar_papel_de_quem_nao_esta_na_pasta_e_404(monkeypatch):
    responses = {**_tree_responses(), ("folder_shares", "update"): []}
    monkeypatch.setattr(folder_shares, "get_supabase_for_user", lambda token: FakeSB(responses))
    monkeypatch.setattr(folder_scope, "actor_has_folder_shares", lambda s: False)
    with pytest.raises(HTTPException) as e:
        folder_shares.update_folder_share_role(F_ROOT, GUEST, folder_shares.UpdateFolderShareRequest(role="viewer"), USER)
    assert e.value.status_code == 404


def test_revogar_responde_o_que_mudou(monkeypatch):
    responses = {**_tree_responses(), ("folder_shares", "delete"): [{"id": "s1"}]}
    monkeypatch.setattr(folder_shares, "get_supabase_for_user", lambda token: FakeSB(responses))
    shots = iter([
        {(P1, GUEST): {"role": "editor", "folder_id": F_ROOT}, (P2, GUEST): {"role": "editor", "folder_id": F_ROOT}},
        {},
    ])
    monkeypatch.setattr(folder_scope, "actor_has_folder_shares", lambda s: True)
    monkeypatch.setattr(folder_scope, "derived_snapshot", lambda ids: next(shots))
    monkeypatch.setattr(folder_scope.pack_action_log, "log_pack_action", lambda **kw: None)

    out = folder_shares.revoke_folder_share(F_ROOT, GUEST, USER)
    assert out["access_changes"] == {"granted": 0, "revoked": 2, "changed": 0}


def test_convidado_sai_da_pasta_so_apagando_a_propria_linha(monkeypatch):
    guest = {"user_id": GUEST, "token": "jwt-guest"}
    sb = FakeSB({("folder_shares", "delete"): [{"id": "s1"}]})
    monkeypatch.setattr(folder_shares, "get_supabase_for_user", lambda token: sb)
    monkeypatch.setattr(folder_scope, "subtree_pack_ids", lambda fid: [P1])
    monkeypatch.setattr(folder_scope, "actor_has_folder_shares", lambda s: False)

    out = folder_shares.leave_folder(F_ROOT, guest)

    assert out["left"] is True
    delete = sb.find("folder_shares", "delete")[0]
    assert ("eq", ("grantee_id", GUEST), {}) in delete.calls
    assert ("eq", ("folder_id", F_ROOT), {}) in delete.calls


def test_sair_de_pasta_que_nao_tem_e_404(monkeypatch):
    guest = {"user_id": GUEST, "token": "jwt-guest"}
    monkeypatch.setattr(folder_shares, "get_supabase_for_user", lambda token: FakeSB({("folder_shares", "delete"): []}))
    monkeypatch.setattr(folder_scope, "subtree_pack_ids", lambda fid: [])
    with pytest.raises(HTTPException) as e:
        folder_shares.leave_folder(F_ROOT, guest)
    assert e.value.status_code == 404


def test_rota_de_sair_vem_antes_da_de_revogar():
    paths = [r.path for r in folder_shares.router.routes if "DELETE" in getattr(r, "methods", set())]
    assert paths.index("/folder-shares/{folder_id}/me") < paths.index("/folder-shares/{folder_id}/{grantee_id}")


def test_listagem_separa_o_que_e_da_pasta_do_que_vem_de_cima(monkeypatch, no_names):
    responses = {
        **_tree_responses(),
        ("folder_shares", "select"): [
            {"id": "a", "folder_id": F_ROOT, "grantee_id": GUEST, "role": "editor", "created_at": "t1"},
            {"id": "b", "folder_id": F_SUB, "grantee_id": GUEST, "role": "viewer", "created_at": "t2"},
        ],
    }
    monkeypatch.setattr(folder_shares, "get_supabase_for_user", lambda token: FakeSB(responses))
    out = folder_shares.list_folder_shares(F_SUB, USER)
    assert [s["folder_id"] for s in out["shares"]] == [F_SUB]
    assert [s["folder_id"] for s in out["inherited"]] == [F_ROOT]
    assert out["inherited"][0]["folder_name"] == "Cliente A"


# ── /pack-shares: acesso por pasta e somente leitura ────────────────────────

def _derived_sb(extra: Dict[tuple, Any] | None = None) -> FakeSB:
    responses = {
        ("packs", "select"): [{"id": P1, "name": "p", "user_id": ACTOR}],
        ("pack_shares", "select"): [{"id": "s", "role": "editor", "source_folder_id": F_ROOT}],
        ("folders", "select"): [{"name": "Cliente A"}],
        **(extra or {}),
    }
    return FakeSB(responses)


@pytest.mark.parametrize("call", ["create", "role", "revoke"])
def test_acesso_vindo_de_pasta_nao_se_edita_pelo_pack(monkeypatch, call):
    sb = _derived_sb()
    monkeypatch.setattr(pack_shares, "get_supabase_for_user", lambda token: sb)
    with pytest.raises(HTTPException) as e:
        if call == "create":
            pack_shares.create_pack_share(P1, pack_shares.CreatePackShareRequest(grantee_id=GUEST, role="viewer"), USER)
        elif call == "role":
            pack_shares.update_pack_share_role(P1, GUEST, pack_shares.UpdatePackShareRequest(role="viewer"), USER)
        else:
            pack_shares.revoke_pack_share(P1, GUEST, USER)
    assert e.value.status_code == 409
    assert e.value.detail["error"] == "share_managed_by_folder"
    assert "Cliente A" in e.value.detail["message"]
    # Nada foi gravado: o 409 vem ANTES de qualquer escrita.
    assert not [q for q in sb.queries if q.op in ("upsert", "update", "delete")]


def test_acesso_direto_continua_editavel(monkeypatch):
    sb = _derived_sb({("pack_shares", "select"): [{"id": "s", "role": "editor", "source_folder_id": None}],
                      ("pack_shares", "upsert"): [{"id": "s"}]})
    monkeypatch.setattr(pack_shares, "get_supabase_for_user", lambda token: sb)
    monkeypatch.setattr(pack_shares.pack_action_log, "log_pack_action", lambda **kw: None)
    out = pack_shares.create_pack_share(P1, pack_shares.CreatePackShareRequest(grantee_id=GUEST, role="viewer"), USER)
    assert out["success"] is True
    assert sb.find("pack_shares", "upsert")[0].payload["role"] == "viewer"


def test_convidado_nao_sai_sozinho_de_acesso_por_pasta(monkeypatch):
    guest = {"user_id": GUEST, "token": "jwt-guest"}
    sb = FakeSB({
        ("pack_shares", "delete"): [],
        ("pack_shares", "select"): [{"id": "s", "role": "editor", "source_folder_id": F_ROOT}],
    })
    monkeypatch.setattr(pack_shares, "get_supabase_for_user", lambda token: sb)
    with pytest.raises(HTTPException) as e:
        pack_shares.leave_pack(P1, guest)
    assert e.value.status_code == 409
    # O DELETE so alcanca acesso direto: o filtro viaja na propria chamada.
    delete = sb.find("pack_shares", "delete")[0]
    assert ("is_", ("source_folder_id", "null"), {}) in delete.calls
    # E a resposta ao convidado nao revela o nome da pasta do dono.
    assert "Cliente A" not in str(e.value.detail)


def test_convidado_sem_acesso_algum_segue_recebendo_404(monkeypatch):
    guest = {"user_id": GUEST, "token": "jwt-guest"}
    sb = FakeSB({("pack_shares", "delete"): [], ("pack_shares", "select"): []})
    monkeypatch.setattr(pack_shares, "get_supabase_for_user", lambda token: sb)
    with pytest.raises(HTTPException) as e:
        pack_shares.leave_pack(P1, guest)
    assert e.value.status_code == 404


def test_lista_do_dono_traz_origem_e_nome_da_pasta(monkeypatch):
    sb = FakeSB({
        ("packs", "select"): [{"id": P1, "name": "p", "user_id": ACTOR}],
        ("pack_shares", "select"): [
            {"id": "a", "grantee_id": GUEST, "role": "editor", "created_at": "t", "source_folder_id": F_ROOT},
            {"id": "b", "grantee_id": "x", "role": "viewer", "created_at": "t", "source_folder_id": None},
        ],
        ("folders", "select"): [{"id": F_ROOT, "name": "Cliente A"}],
    })
    monkeypatch.setattr(pack_shares, "get_supabase_for_user", lambda token: sb)
    monkeypatch.setattr(pack_shares, "_hydrate_display_names", lambda ids: {})
    out = pack_shares.list_pack_shares(P1, USER)
    by_id = {s["id"]: s for s in out["shares"]}
    assert by_id["a"]["source_folder_name"] == "Cliente A"
    assert by_id["b"]["source_folder_id"] is None and by_id["b"]["source_folder_name"] is None


# ── /folders: quem tem cada pasta, para a tela avisar antes de mover ────────

def test_lista_de_pastas_traz_quem_tem_cada_uma_com_nome(monkeypatch):
    sb = FakeSB({
        ("folders", "select"): [{"id": F_ROOT, "name": "Cliente A", "parent_id": None, "position": 0}],
        ("pack_folder_members", "select"): [{"pack_id": P1, "folder_id": F_ROOT}],
        ("folder_shares", "select"): [{"folder_id": F_ROOT, "grantee_id": GUEST, "role": "editor"}],
    })
    monkeypatch.setattr(folders_route, "get_supabase_for_user", lambda token: sb)
    monkeypatch.setattr(folders_route, "_hydrate_display_names", lambda ids: {GUEST: "Ana"})
    out = folders_route.list_folders(USER)
    assert out["folder_shares"] == [{"folder_id": F_ROOT, "grantee_id": GUEST, "role": "editor", "display_name": "Ana"}]


def test_lista_de_pastas_traz_as_recebidas_com_o_nome_do_dono(monkeypatch):
    OWNER = "33333333-3333-4333-8333-333333333333"
    sb = FakeSB({
        ("folders", "select"): [{"id": F_OTHER, "name": "Minha", "parent_id": None, "position": 0}],
        ("pack_folder_members", "select"): [{"pack_id": P1, "folder_id": F_OTHER}],
        ("folder_shares", "select"): [],
        ("rpc", "list_shared_folders"): {
            "folders": [{"id": F_ROOT, "name": "Cliente A", "parent_id": None, "position": 0,
                         "owner_id": OWNER, "access": "editor", "shared_root": True}],
            # P1 tambem esta na pasta compartilhada: e la que ele aparece.
            "members": [{"pack_id": P1, "folder_id": F_ROOT}, {"pack_id": P2, "folder_id": F_ROOT}],
        },
    })
    monkeypatch.setattr(folders_route, "get_supabase_for_user", lambda token: sb)
    monkeypatch.setattr(folders_route, "_hydrate_display_names", lambda ids: {OWNER: "Bruno"})

    out = folders_route.list_folders(USER)

    by_id = {f["id"]: f for f in out["folders"]}
    assert by_id[F_OTHER]["access"] == "dono" and by_id[F_OTHER]["owner_id"] == ACTOR
    assert by_id[F_ROOT]["access"] == "editor" and by_id[F_ROOT]["owner_name"] == "Bruno"
    assert out["members"] == {P1: F_ROOT, P2: F_ROOT}
    # Sem pasta propria compartilhada, nao ha direto a absorver: nem le.
    assert out["direct_shares"] == [] and not sb.find("pack_shares", "select")


def test_mover_vai_pela_rpc_e_recusa_vira_403_legivel(monkeypatch):
    from postgrest.exceptions import APIError

    sb = FakeSB({("rpc", "move_packs_to_folder"): APIError({"message": "pack_move_forbidden", "code": "P0001", "hint": None, "details": "1"})})
    monkeypatch.setattr(folders_route, "get_supabase_for_user", lambda token: sb)
    monkeypatch.setattr(folder_scope, "actor_has_folder_shares", lambda s: False)
    with pytest.raises(HTTPException) as e:
        folders_route.move_packs(folders_route.MoveRequest(pack_ids=[P1], folder_id=F_ROOT), USER)
    assert e.value.status_code == 403
    assert "so entram os packs que sao seus" in e.value.detail
    assert sb.rpcs == [("move_packs_to_folder", {"p_pack_ids": [P1], "p_folder_id": F_ROOT})]
    # Nenhuma escrita direta na tabela: a RLS nao deixaria o editor, e a RPC confere o papel.
    assert not [q for q in sb.queries if q.op in ("upsert", "update", "delete")]


def test_criar_pasta_com_packs_desfaz_a_pasta_se_o_mover_for_recusado(monkeypatch):
    from postgrest.exceptions import APIError

    sb = FakeSB({
        ("rpc", "create_folder"): {"id": F_SUB, "name": "Nova", "parent_id": F_ROOT, "position": 3},
        ("rpc", "move_packs_to_folder"): APIError({"message": "pack_move_forbidden", "code": "P0001", "hint": None, "details": "1"}),
        ("rpc", "dissolve_folder"): {"parent_id": F_ROOT, "folders_moved": 0, "packs_moved": 0},
    })
    monkeypatch.setattr(folders_route, "get_supabase_for_user", lambda token: sb)
    monkeypatch.setattr(folder_scope, "actor_has_folder_shares", lambda s: False)
    with pytest.raises(HTTPException) as e:
        folders_route.create_folder(folders_route.FolderCreate(name="  Nova  ", pack_ids=[P1], parent_id=F_ROOT), USER)
    assert e.value.status_code == 403
    assert [name for name, _ in sb.rpcs] == ["create_folder", "move_packs_to_folder", "dissolve_folder"]
    assert sb.rpcs[0][1] == {"p_name": "Nova", "p_parent_id": F_ROOT}
    assert sb.rpcs[2][1] == {"p_folder_id": F_SUB}


def test_lista_de_pastas_sem_compartilhamento_nao_chama_a_rpc_de_nomes(monkeypatch):
    sb = FakeSB({("folders", "select"): [], ("pack_folder_members", "select"): [], ("folder_shares", "select"): []})
    monkeypatch.setattr(folders_route, "get_supabase_for_user", lambda token: sb)

    def boom(ids):
        raise AssertionError("sem compartilhamento nao ha nome a buscar")

    monkeypatch.setattr(folders_route, "_hydrate_display_names", boom)
    assert folders_route.list_folders(USER)["folder_shares"] == []


# ── Redefinir o pack (excluir, renomear, periodo): dono ou editor DA PASTA ─────

OWNER = "33333333-3333-4333-8333-333333333333"


@pytest.mark.parametrize("role, via_folder, allowed", [
    ("dono", False, True),
    ("editor", True, True),     # editor da pasta age como o dono
    ("editor", False, False),   # editor por convite direto: so calibra
])
def test_poderes_de_dono_so_para_dono_ou_editor_da_pasta(monkeypatch, role, via_folder, allowed):
    from app.services import pack_access

    monkeypatch.setattr(pack_access, "assert_pack_role", lambda actor, pack, roles: pack_access.PackAccess(role, OWNER))
    monkeypatch.setattr(pack_access, "is_folder_editor", lambda actor, pack: via_folder)
    if allowed:
        assert pack_access.assert_owner_powers(ACTOR, P1).owner_id == OWNER
    else:
        with pytest.raises(HTTPException) as e:
            pack_access.assert_owner_powers(ACTOR, P1)
        assert e.value.status_code == 403


@pytest.mark.parametrize("role, via_folder, expected", [
    ("dono", False, True), ("editor", True, True), ("editor", False, False), ("viewer", True, False),
])
def test_editar_periodo_no_refresh_usa_a_mesma_regra(monkeypatch, role, via_folder, expected):
    # O refresh aceita viewer (atualizar e de todos); editar o periodo, nao: e esta checagem.
    from app.services import pack_access

    monkeypatch.setattr(pack_access, "is_folder_editor", lambda actor, pack: via_folder)
    assert pack_access.has_owner_powers(pack_access.PackAccess(role, OWNER), ACTOR, P1) is expected


def test_viewer_nunca_tem_poderes_de_dono(monkeypatch):
    from app.services import pack_access

    def refuse(actor, pack, roles):
        assert "viewer" not in roles
        raise HTTPException(status_code=403, detail="x")

    monkeypatch.setattr(pack_access, "assert_pack_role", refuse)
    with pytest.raises(HTTPException):
        pack_access.assert_owner_powers(ACTOR, P1)


def test_editor_da_pasta_so_pela_pasta_e_falha_de_leitura_nega(monkeypatch):
    from app.services import pack_access

    def svc(rows):
        return SimpleNamespace(table=lambda name: FakeSB({("pack_shares", "select"): rows}).table(name))

    monkeypatch.setattr(pack_access, "get_supabase_service", lambda: svc([{"role": "editor", "source_folder_id": F_ROOT}]))
    assert pack_access.is_folder_editor(ACTOR, P1) is True
    monkeypatch.setattr(pack_access, "get_supabase_service", lambda: svc([{"role": "editor", "source_folder_id": None}]))
    assert pack_access.is_folder_editor(ACTOR, P1) is False
    monkeypatch.setattr(pack_access, "get_supabase_service", lambda: svc([{"role": "viewer", "source_folder_id": F_ROOT}]))
    assert pack_access.is_folder_editor(ACTOR, P1) is False

    def boom():
        raise RuntimeError("rede")

    monkeypatch.setattr(pack_access, "get_supabase_service", boom)
    assert pack_access.is_folder_editor(ACTOR, P1) is False


def test_excluir_pelo_editor_da_pasta_apaga_no_silo_do_dono(monkeypatch):
    from app.routes import analytics
    from app.services.pack_access import PackAccess

    deleted: List[Dict[str, Any]] = []
    monkeypatch.setattr(analytics, "assert_owner_powers", lambda actor, pack: PackAccess("editor", OWNER))
    monkeypatch.setattr(analytics, "_pack_name_snapshot", lambda pack: "p")
    service = object()
    monkeypatch.setattr(analytics, "get_supabase_service", lambda: service)
    monkeypatch.setattr(analytics.supabase_repo, "delete_pack", lambda token, **kw: deleted.append(kw) or {"pack_deleted": True})
    monkeypatch.setattr(analytics.pack_action_log, "log_pack_action", lambda **kw: None)

    out = analytics.delete_pack(P1, analytics.DeletePackRequest(ad_ids=[]), USER)

    assert out["success"] is True
    # Apaga no silo do DONO, por service role (a RLS de packs so deixa o proprio dono).
    assert deleted[0]["user_id"] == OWNER and deleted[0]["sb_client"] is service


def test_renomear_pelo_editor_da_pasta_confere_nome_no_silo_do_dono(monkeypatch):
    from app.routes import analytics
    from app.services.pack_access import PackAccess

    renamed: List[Dict[str, Any]] = []
    logged: List[Dict[str, Any]] = []
    monkeypatch.setattr(analytics, "assert_owner_powers", lambda actor, pack: PackAccess("editor", OWNER))
    monkeypatch.setattr(analytics, "_pack_name_snapshot", lambda pack: "velho")
    monkeypatch.setattr(analytics.supabase_repo, "update_pack_name", lambda pack, name, actor_id: renamed.append({"name": name, "silo": actor_id}))
    monkeypatch.setattr(analytics.pack_action_log, "log_pack_action", lambda **kw: logged.append(kw))

    analytics.update_pack_name(P1, analytics.UpdatePackNameRequest(name=" novo "), USER)

    # "Ja existe um pack com esse nome" e por silo: o do dono, nao o de quem renomeia.
    assert renamed == [{"name": "novo", "silo": OWNER}]
    # O historico registra QUEM renomeou, com o papel dele.
    assert (logged[0]["actor_id"], logged[0]["actor_role"], logged[0]["owner_id"]) == (ACTOR, "editor", OWNER)


@pytest.mark.parametrize("route", ["rename", "preview"])
def test_renomear_e_previa_de_periodo_usam_o_guard_de_dono(monkeypatch, route):
    from app.routes import analytics

    calls: List[str] = []

    def guard(actor, pack):
        calls.append(pack)
        raise HTTPException(status_code=403, detail="x")

    monkeypatch.setattr(analytics, "assert_owner_powers", guard)
    with pytest.raises(HTTPException) as e:
        if route == "rename":
            analytics.update_pack_name(P1, analytics.UpdatePackNameRequest(name="n"), USER)
        else:
            analytics.preview_pack_date_range(P1, "2026-01-01", "2026-01-02", USER)
    assert e.value.status_code == 403 and calls == [P1]


def test_mover_pack_do_editor_para_fora_do_alcance_dele_vira_403_legivel(monkeypatch):
    from postgrest.exceptions import APIError

    sb = FakeSB({("rpc", "move_packs_to_folder"): APIError({"message": "pack_owner_outside", "code": "P0001", "hint": None, "details": None})})
    monkeypatch.setattr(folders_route, "get_supabase_for_user", lambda token: sb)
    monkeypatch.setattr(folder_scope, "actor_has_folder_shares", lambda s: False)
    with pytest.raises(HTTPException) as e:
        folders_route.move_packs(folders_route.MoveRequest(pack_ids=[P1], folder_id=F_ROOT), USER)
    assert e.value.status_code == 403
    assert "pastas que essa pessoa ve" in e.value.detail
