# -*- coding: utf-8 -*-
"""Critérios de julgamento em massa: `POST /analytics/packs/bulk-judgment`.

O que se trava aqui é a FIAÇÃO do lote (as regras de cada campo já estão em
test_pack_lead_economics.py e na fixture de paridade):
- papel por pack numa chamada só: dono e editor recebem; viewer e pack sem acesso
  voltam como `skipped`, sem derrubar o lote;
- `target_cpr` é PATCH por evento: valor define, null remove, o resto de cada pack
  fica; `target_cpr: null` limpa tudo sem ler as metas atuais;
- a economia do lead é validada UMA vez e o canônico vai a todos;
- um pack que falha ao gravar vira `failed` e os outros seguem;
- autoria: uma linha por (dono, papel), com os packs daquele silo e `bulk: True`;
- o PATCH de um pack continua recusando null num evento (a validação é compartilhada).

Sabotagens feitas: trocar `_merge_target_cpr` por "patch substitui o mapa" →
test_target_cpr_e_patch_por_evento falha; deixar o viewer passar no filtro de
papel → test_papel_por_pack falha; validar a economia por pack (ou gravar o cru)
→ test_economia_canonica_uma_vez falha; logar uma linha só → test_autoria falha.
"""
import copy

import pytest
from fastapi.testclient import TestClient

import app.main as main
from app.core.auth import get_current_user
from app.routes import analytics
from app.services import pack_action_log, supabase_repo
from app.services.lead_economics import LEAD_ECONOMICS_MESSAGES as M
from app.services.pack_access import PackAccess

URL = "/analytics/packs/bulk-judgment"

VALIDO = {
    "products": [{"id": "p1", "name": "Mentoria", "ticket": 3000, "contribution_margin": 0.55, "target_margin": 0.40}],
    "bands": [{"min": None, "product": "p1", "conversion": 0.005}, {"min": 60, "product": "p1", "conversion": 0.04}],
}

ROLES = {
    "meu": PackAccess(role="dono", owner_id="u1"),
    "meu2": PackAccess(role="dono", owner_id="u1"),
    "editavel": PackAccess(role="editor", owner_id="dono-2"),
    "leitura": PackAccess(role="viewer", owner_id="dono-3"),
}


@pytest.fixture
def ctx(monkeypatch):
    """Cliente + espiões. `roles` e `targets` podem ser trocados pelo teste."""
    state = {"roles": dict(ROLES), "targets": {}, "fail": set(), "writes": [], "logs": [], "target_reads": 0, "validations": 0}

    main.app.dependency_overrides[get_current_user] = lambda: {"user_id": "u1", "token": "tok"}
    monkeypatch.setattr(analytics, "resolve_pack_roles", lambda actor, ids: {i: state["roles"][i] for i in ids if i in state["roles"]})

    def read_targets(ids):
        state["target_reads"] += 1
        return {i: state["targets"][i] for i in ids if i in state["targets"]}

    def write(pack_id, fields, actor):
        if pack_id in state["fail"]:
            raise RuntimeError("banco caiu")
        state["writes"].append((pack_id, copy.deepcopy(fields), actor))
        return dict(fields)

    monkeypatch.setattr(supabase_repo, "get_packs_target_cpr", read_targets)
    monkeypatch.setattr(supabase_repo, "update_pack_judgment", write)
    monkeypatch.setattr(pack_action_log, "log_pack_action", lambda **kw: state["logs"].append(kw))

    real_validate = analytics.validate_lead_economics

    def counting_validate(raw):
        state["validations"] += 1
        return real_validate(raw)

    monkeypatch.setattr(analytics, "validate_lead_economics", counting_validate)

    state["client"] = TestClient(main.app)
    yield state
    main.app.dependency_overrides.pop(get_current_user, None)


def _post(ctx, body):
    return ctx["client"].post(URL, json=body)


def _by_pack(r):
    return {item["pack_id"]: item for item in r.json()["results"]}


# ── Papel ───────────────────────────────────────────────────────────────────


def test_papel_por_pack(ctx):
    r = _post(ctx, {"pack_ids": ["meu", "editavel", "leitura", "alheio"], "mql_leadscore_min": 70})
    assert r.status_code == 200, r.text
    res = _by_pack(r)
    assert res["meu"]["status"] == "updated" and res["meu"]["judgment"] == {"mql_leadscore_min": 70}
    assert res["editavel"]["status"] == "updated"
    assert res["leitura"] == {"pack_id": "leitura", "status": "skipped", "reason": "viewer"}
    assert res["alheio"] == {"pack_id": "alheio", "status": "skipped", "reason": "no_access"}
    assert [w[0] for w in ctx["writes"]] == ["meu", "editavel"], "viewer e sem acesso nunca chegam ao banco"
    assert all(w[2] == "u1" for w in ctx["writes"])


def test_autoria_uma_linha_por_silo_e_papel(ctx):
    _post(ctx, {"pack_ids": ["meu", "editavel", "meu2", "leitura"], "mql_leadscore_min": None})
    logs = {(l["owner_id"], l["actor_role"]): l for l in ctx["logs"]}
    assert set(logs) == {("u1", "dono"), ("dono-2", "editor")}
    assert logs[("u1", "dono")]["pack_ids"] == ["meu", "meu2"]
    assert logs[("dono-2", "editor")]["pack_ids"] == ["editavel"]
    for l in logs.values():
        assert l["action"] == pack_action_log.ACTION_PACK_JUDGMENT
        assert l["actor_id"] == "u1"
        assert l["detail"] == {"mql_leadscore_min": None, "bulk": True}


# ── target_cpr: patch por evento ────────────────────────────────────────────


def test_target_cpr_e_patch_por_evento(ctx):
    ctx["targets"] = {"meu": {"a": 10, "b": 5, "d": 1}, "editavel": {"b": 7, "e": 2}}
    r = _post(ctx, {"pack_ids": ["meu", "editavel", "meu2"], "target_cpr": {"a": 20, "b": None, "c": 3}})
    assert r.status_code == 200, r.text
    written = {w[0]: w[1] for w in ctx["writes"]}
    assert written["meu"] == {"target_cpr": {"a": 20, "c": 3, "d": 1}}, "b removido, a trocado, c novo, d (não citado) fica"
    assert written["editavel"] == {"target_cpr": {"a": 20, "c": 3, "e": 2}}, "o b que só ele tinha sai; o e que só ele tem fica"
    assert written["meu2"] == {"target_cpr": {"a": 20, "c": 3}}, "pack sem meta começa do patch"
    assert ctx["target_reads"] == 1, "as metas atuais saem numa leitura só"
    # O cliente recebe o mapa RESULTANTE de cada pack, para espelhar no store.
    assert _by_pack(r)["meu"]["judgment"] == {"target_cpr": {"a": 20, "c": 3, "d": 1}}


def test_target_cpr_patch_que_remove_tudo_vira_null(ctx):
    ctx["targets"] = {"meu": {"a": 10}}
    _post(ctx, {"pack_ids": ["meu"], "target_cpr": {"a": None}})
    assert ctx["writes"][0][1] == {"target_cpr": None}, "mapa vazio e 'sem meta' são o mesmo estado"


def test_target_cpr_null_limpa_sem_ler_metas(ctx):
    ctx["targets"] = {"meu": {"a": 10}}
    _post(ctx, {"pack_ids": ["meu", "editavel"], "target_cpr": None})
    assert [w[1] for w in ctx["writes"]] == [{"target_cpr": None}, {"target_cpr": None}]
    assert ctx["target_reads"] == 0


def test_target_cpr_valor_invalido_400(ctx):
    r = _post(ctx, {"pack_ids": ["meu"], "target_cpr": {"a": 0}})
    assert r.status_code == 400
    assert ctx["writes"] == []


def test_patch_de_um_pack_continua_recusando_null_no_evento(ctx, monkeypatch):
    """A validação é compartilhada; só o lote aceita null por evento."""
    monkeypatch.setattr(analytics, "assert_pack_role", lambda *_a, **_k: PackAccess(role="dono", owner_id="u1"))
    r = ctx["client"].patch("/analytics/packs/meu/judgment", json={"target_cpr": {"a": None}})
    # O modelo do PATCH é Dict[str, float]: o null nem chega à validação (422).
    assert r.status_code == 422
    assert ctx["writes"] == []


# ── Economia do lead ────────────────────────────────────────────────────────


def test_economia_canonica_uma_vez(ctx):
    sujo = copy.deepcopy(VALIDO)
    sujo["products"][0]["name"] = "  Mentoria   Premium "
    sujo["products"][0]["cor"] = "azul"
    r = _post(ctx, {"pack_ids": ["meu", "editavel", "meu2"], "lead_economics": sujo, "mql_leadscore_min": 60})
    assert r.status_code == 200, r.text
    esperado = copy.deepcopy(VALIDO)
    esperado["products"][0]["name"] = "Mentoria Premium"
    assert len(ctx["writes"]) == 3
    for _pid, fields, _actor in ctx["writes"]:
        assert fields == {"lead_economics": esperado, "mql_leadscore_min": 60}
    assert ctx["validations"] == 1, "o mesmo documento vai a todos: valida uma vez"


def test_economia_invalida_400_sem_gravar_nada(ctx):
    invalido = copy.deepcopy(VALIDO)
    invalido["bands"].append({"min": 50, "product": "p1", "conversion": 0.1})  # 60 depois 50: fora de ordem
    r = _post(ctx, {"pack_ids": ["meu", "editavel"], "lead_economics": invalido})
    assert r.status_code == 400
    assert r.json()["detail"] == M["bandMinNotIncreasing"]
    assert ctx["writes"] == [] and ctx["logs"] == []


def test_economia_null_apaga_em_todos(ctx):
    _post(ctx, {"pack_ids": ["meu", "editavel"], "lead_economics": None})
    assert [w[1] for w in ctx["writes"]] == [{"lead_economics": None}, {"lead_economics": None}]


# ── Lote ────────────────────────────────────────────────────────────────────


def test_falha_num_pack_nao_derruba_os_outros(ctx):
    ctx["fail"] = {"meu"}
    r = _post(ctx, {"pack_ids": ["meu", "editavel"], "mql_leadscore_min": 70})
    assert r.status_code == 200
    res = _by_pack(r)
    assert res["meu"]["status"] == "failed" and "error" in res["meu"]
    assert res["editavel"]["status"] == "updated"
    # Só quem foi gravado entra na autoria.
    assert [l["pack_ids"] for l in ctx["logs"]] == [["editavel"]]


@pytest.mark.parametrize(
    "body, trecho",
    [
        ({"pack_ids": [], "mql_leadscore_min": 70}, "Nenhum pack"),
        ({"pack_ids": ["meu"]}, "Nenhum campo"),
        ({"pack_ids": ["meu"], "mql_leadscore_min": -1}, ">= 0"),
        ({"pack_ids": [f"p{i}" for i in range(analytics.BULK_JUDGMENT_MAX_PACKS + 1)], "mql_leadscore_min": 1}, "No máximo"),
    ],
)
def test_entradas_invalidas_400(ctx, body, trecho):
    r = _post(ctx, body)
    assert r.status_code == 400, r.text
    assert trecho in r.json()["detail"]
    assert ctx["writes"] == []


def test_campo_desconhecido_422(ctx):
    r = _post(ctx, {"pack_ids": ["meu"], "diagnostic_cost_metric": "cpr"})
    assert r.status_code == 422


def test_pack_repetido_grava_uma_vez(ctx):
    r = _post(ctx, {"pack_ids": ["meu", "meu", " meu "], "mql_leadscore_min": 5})
    assert r.status_code == 200
    assert [w[0] for w in ctx["writes"]] == ["meu"]


def test_target_cpr_patch_vazio_nao_mexe(ctx):
    """`{}` é um patch sem eventos: não pode virar "limpa as metas de todos"."""
    ctx["targets"] = {"meu": {"a": 10}}
    r = _post(ctx, {"pack_ids": ["meu"], "target_cpr": {}, "mql_leadscore_min": 5})
    assert r.status_code == 200, r.text
    assert ctx["writes"][0][1] == {"mql_leadscore_min": 5}, "target_cpr {} fica fora do update"
    r = _post(ctx, {"pack_ids": ["meu"], "target_cpr": {}})
    assert r.status_code == 400, "só um patch vazio = nada a gravar"
