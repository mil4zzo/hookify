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
