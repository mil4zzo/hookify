"""
Rota do Manager pela v161 (migration 161): colunas, bytes repassados, volta atrás.

CONTEXTO (2026-09-16)
---------------------
A aba "Por anúncio" do Igor caía em 57014 (39–44 s) e, quando terminava, trazia só
10 mil de 26 mil linhas. A 161 entrega todas as linhas numa lista por campo, com a
hidratação que a rota fazia em Python já pronta — e a rota passa a só REPASSAR os
bytes. Medido: o `jsonable_encoder` custava 1–3 s a cada 10 mil linhas.

O que este arquivo trava (nenhum teste cobria esta rota de ponta a ponta antes):
  1. format=columns devolve os bytes do banco SEM reserializar;
  2. a chamada leva o prefixo da miniatura (senão a URL do Storage não sai);
  3. format=rows (JavaScript anterior ao deploy) recebe o formato antigo;
  4. a flag desligada volta ao caminho antigo;
  5. 57014 não é repetido; queda de conexão é;
  6. filhos de campanha leem linhas da v161, sem prefixo (como antes);
  7. o leitor de colunas falha alto em coluna desalinhada.

162 (16/09, à tarde): a mesma resposta EM PEDAÇOS (lista de objetos, sem envelope),
para o banco não montar um JSON gigante na memória. Aqui: a rota chama a v162 por
padrão e volta à v161 pela configuração; os bytes em pedaços passam intactos; o
leitor funde os pedaços em qualquer ordem e falha alto sem (ou com dois) metadados.

SABOTAGENS (16/09): `Response(content=json.dumps(json.loads(raw)))` no ramo de
colunas -> test_colunas_repassa_os_bytes falha; `thumb_prefix=None` na rota ->
test_chamada_leva_o_prefixo falha; tirar a checagem de tamanho em
rows_from_columns -> test_coluna_desalinhada_falha_alto falha.
"""

import httpx
import pytest
from fastapi.testclient import TestClient

import app.main as main
from app.core import config
from app.core.auth import get_current_user
from app.routes import analytics as A
from app.services.manager_columns import ColumnarPayloadError, as_row_payload, from_parts, rows_from_columns
from app.services.thumbnail_cache import (
    DEFAULT_BUCKET,
    _quote_path,
    build_public_storage_url,
    public_storage_prefix,
)

# Espaçamento proposital: se a rota reserializar, os bytes mudam.
RAW = (
    b'{"data_columns" : [ {"group_key": ["a1", "a2"], "spend": [10.50, 3]},'
    b' {"ad_name": ["X", "Y"]} ], "row_count": 2, "averages": {"hook": 0.1},'
    b' "pagination": {"limit": 100000, "offset": 0, "total": 2, "has_more": false},'
    b' "names": {"campaigns": {}, "adsets": {}}, "available_conversion_types": [],'
    b' "header_aggregates": {}}'
)

# A mesma resposta em pedaços (v162), com os pedaços fora de ordem.
RAW_PARTS = (
    b'[{"ad_name" : ["X", "Y"]}, {"row_count": 2, "averages": {"hook": 0.1},'
    b' "pagination": {"limit": 100000, "offset": 0, "total": 2, "has_more": false},'
    b' "names": {"campaigns": {}, "adsets": {}}, "available_conversion_types": [],'
    b' "header_aggregates": {}}, {"group_key": ["a1", "a2"]}, {"spend": [10.50, 3]}]'
)


class _Sessao:
    def __init__(self, respostas):
        self.respostas = list(respostas)
        self.chamadas = 0

    def request(self, method, path, json=None, params=None, headers=None):
        self.chamadas += 1
        r = self.respostas.pop(0) if len(self.respostas) > 1 else self.respostas[0]
        if isinstance(r, Exception):
            raise r
        return r


class _Builder:
    def __init__(self, sessao, nome, params):
        self.session = sessao
        self.http_method = "POST"
        self.path = f"/rpc/{nome}"
        self.json = params
        self.params = {}
        self.headers = {}


class _Sb:
    def __init__(self, *respostas):
        self.sessao = _Sessao(respostas)
        self.rpcs = []

    def rpc(self, nome, params):
        self.rpcs.append((nome, params))
        return _Builder(self.sessao, nome, params)


def _ok(body=RAW):
    return httpx.Response(200, content=body, headers={"content-type": "application/json"})


def _erro(code, status=500):
    return httpx.Response(status, json={"code": code, "message": "canceling statement", "hint": None, "details": None})


BODY = {"date_start": "2026-08-26", "date_stop": "2026-09-15", "group_by": "ad_id",
        "pack_ids": ["p1"], "limit": 100000, "format": "columns"}


@pytest.fixture
def cliente(monkeypatch):
    main.app.dependency_overrides[get_current_user] = lambda: {"user_id": "u1", "token": "tok"}
    monkeypatch.setattr(config, "ANALYTICS_MANAGER_V161", True)
    yield TestClient(main.app)
    main.app.dependency_overrides.pop(get_current_user, None)


def _com_sb(monkeypatch, sb):
    monkeypatch.setattr(A, "_get_analytics_supabase", lambda token: sb)
    monkeypatch.setattr(A, "get_supabase_for_user", lambda token, **kw: sb)
    return sb


def test_colunas_repassa_os_bytes(cliente, monkeypatch):
    _com_sb(monkeypatch, _Sb(_ok()))
    r = cliente.post("/analytics/ad-performance", json=BODY)
    assert r.status_code == 200
    assert r.content == RAW, "a rota reserializou a resposta do banco"
    assert r.headers["content-type"].startswith("application/json")


def test_chamada_leva_o_prefixo(cliente, monkeypatch):
    sb = _com_sb(monkeypatch, _Sb(_ok()))
    cliente.post("/analytics/ad-performance", json=BODY)
    nome, params = sb.rpcs[0]
    assert nome == "fetch_manager_rankings_v162"
    assert params["p_thumb_public_prefix"] == public_storage_prefix(DEFAULT_BUCKET)
    assert params["p_limit"] == 100000


def test_linhas_para_o_javascript_antigo(cliente, monkeypatch):
    _com_sb(monkeypatch, _Sb(_ok()))
    r = cliente.post("/analytics/ad-performance", json=dict(BODY, format="rows"))
    corpo = r.json()
    assert "data_columns" not in corpo and "row_count" not in corpo
    assert corpo["data"] == [
        {"group_key": "a1", "spend": 10.5, "ad_name": "X"},
        {"group_key": "a2", "spend": 3, "ad_name": "Y"},
    ]
    assert corpo["pagination"]["total"] == 2


def test_configuracao_volta_para_a_v161(cliente, monkeypatch):
    monkeypatch.setattr(config, "ANALYTICS_MANAGER_COLUMNS_RPC", "fetch_manager_rankings_v161")
    sb = _com_sb(monkeypatch, _Sb(_ok()))
    cliente.post("/analytics/ad-performance", json=BODY)
    assert sb.rpcs[0][0] == "fetch_manager_rankings_v161"


@pytest.mark.parametrize("valor,esperado", [
    ("", "fetch_manager_rankings_v162"),
    ("fetch_manager_rankings_v161", "fetch_manager_rankings_v161"),
    ("drop_tudo", "fetch_manager_rankings_v162"),
])
def test_nome_da_funcao_so_aceita_a_lista(monkeypatch, valor, esperado):
    import importlib
    monkeypatch.setenv("ANALYTICS_MANAGER_COLUMNS_RPC", valor)
    try:
        assert importlib.reload(config).ANALYTICS_MANAGER_COLUMNS_RPC == esperado
    finally:
        monkeypatch.delenv("ANALYTICS_MANAGER_COLUMNS_RPC")
        importlib.reload(config)


def test_pedacos_passam_intactos(cliente, monkeypatch):
    _com_sb(monkeypatch, _Sb(_ok(RAW_PARTS)))
    r = cliente.post("/analytics/ad-performance", json=BODY)
    assert r.content == RAW_PARTS


def test_pedacos_viram_linhas_para_o_javascript_antigo(cliente, monkeypatch):
    _com_sb(monkeypatch, _Sb(_ok(RAW_PARTS)))
    corpo = cliente.post("/analytics/ad-performance", json=dict(BODY, format="rows")).json()
    assert corpo["data"] == [
        {"ad_name": "X", "group_key": "a1", "spend": 10.5},
        {"ad_name": "Y", "group_key": "a2", "spend": 3},
    ]
    assert corpo["pagination"]["total"] == 2
    assert "row_count" not in corpo


def test_formato_padrao_e_linhas(cliente, monkeypatch):
    _com_sb(monkeypatch, _Sb(_ok()))
    corpo = cliente.post("/analytics/ad-performance", json={k: v for k, v in BODY.items() if k != "format"}).json()
    assert isinstance(corpo["data"], list)


def test_flag_desligada_volta_ao_caminho_antigo(cliente, monkeypatch):
    monkeypatch.setattr(config, "ANALYTICS_MANAGER_V161", False)
    sb = _com_sb(monkeypatch, _Sb(_ok()))
    chamado = []
    monkeypatch.setattr(A, "_get_rankings_core_v2_rpc", lambda req, user, s: chamado.append(1) or {"data": []})
    monkeypatch.setattr(A.supabase_repo, "resolve_pack_owner_map", lambda *a, **k: {})
    r = cliente.post("/analytics/ad-performance", json=BODY)
    assert r.status_code == 200
    assert chamado == [1]
    assert sb.rpcs == [], "com a flag desligada a v161 não pode ser chamada"


def test_statement_timeout_nao_repete(cliente, monkeypatch):
    sb = _com_sb(monkeypatch, _Sb(_erro("57014")))
    r = cliente.post("/analytics/ad-performance", json=BODY)
    assert r.status_code == 500
    assert sb.sessao.chamadas == 1


def test_queda_de_conexao_repete(cliente, monkeypatch):
    sb = _com_sb(monkeypatch, _Sb(httpx.ConnectError("recusou"), _ok()))
    r = cliente.post("/analytics/ad-performance", json=BODY)
    assert r.status_code == 200
    assert sb.sessao.chamadas == 2
    assert r.content == RAW


def test_resposta_grande_sai_comprimida(cliente, monkeypatch):
    grande = RAW.replace(b'"hook": 0.1', b'"hook": 0.1, "pad": "' + b"x" * 5000 + b'"')
    _com_sb(monkeypatch, _Sb(_ok(grande)))
    r = cliente.post("/analytics/ad-performance", json=BODY, headers={"Accept-Encoding": "gzip"})
    assert r.headers.get("content-encoding") == "gzip"
    assert r.content == grande  # o TestClient já descomprime


def test_filhos_de_campanha_leem_linhas_sem_prefixo(cliente, monkeypatch):
    sb = _com_sb(monkeypatch, _Sb(_ok()))
    r = cliente.get("/analytics/rankings/campaign-id/c1/children",
                    params={"date_start": "2026-08-26", "date_stop": "2026-09-15"})
    assert r.status_code == 200
    nome, params = sb.rpcs[0]
    assert nome == "fetch_manager_rankings_v162"
    assert params["p_thumb_public_prefix"] is None
    assert params["p_group_by"] == "adset_id"
    assert [x["group_key"] for x in r.json()["data"]] == ["a1", "a2"]


# ---------------------------------------------------------------------------
# Leitor de colunas
# ---------------------------------------------------------------------------

def test_colunas_viram_linhas_na_ordem():
    p = {"row_count": 3, "data_columns": [{"a": [1, 2, 3]}, {"b": ["x", None, "z"]}]}
    assert rows_from_columns(p) == [{"a": 1, "b": "x"}, {"a": 2, "b": None}, {"a": 3, "b": "z"}]


def test_pedacos_em_qualquer_ordem():
    meta = {"row_count": 2, "row_order": [2, 1], "names": {}}
    a, b = {"a": [1, 2]}, {"b": ["x", "y"]}
    esperado = [{"a": 2, "b": "y"}, {"a": 1, "b": "x"}]
    assert as_row_payload([meta, a, b])["data"] == esperado
    assert as_row_payload([b, meta, a])["data"] == esperado
    assert as_row_payload([b, meta, a])["names"] == {}


@pytest.mark.parametrize("partes", [
    [{"a": [1]}],                                     # sem metadados
    [{"row_count": 1}, {"row_count": 1}, {"a": [1]}],  # dois metadados
    [{"row_count": 1}, [1]],                           # pedaço que não é objeto
    [{"row_count": 1, "data_columns": []}, {"a": [1]}],
])
def test_pedacos_malformados_falham_alto(partes):
    with pytest.raises(ColumnarPayloadError):
        from_parts(partes)


def test_pedaco_desalinhado_falha_alto():
    with pytest.raises(ColumnarPayloadError):
        as_row_payload([{"row_count": 2}, {"a": [1, 2]}, {"b": [1]}])


def test_zero_linhas():
    # com zero linhas o banco manda as listas como null (json_agg de nada)
    assert rows_from_columns({"row_count": 0, "data_columns": [{"a": None}]}) == []


def test_coluna_desalinhada_falha_alto():
    with pytest.raises(ColumnarPayloadError):
        rows_from_columns({"row_count": 2, "data_columns": [{"a": [1, 2]}, {"b": [1]}]})


def test_campo_repetido_entre_blocos_falha_alto():
    with pytest.raises(ColumnarPayloadError):
        rows_from_columns({"row_count": 1, "data_columns": [{"a": [1]}, {"a": [2]}]})


def test_row_order_poe_as_linhas_na_posicao():
    p = {"row_count": 3, "row_order": [3, 1, 2], "data_columns": [{"a": ["c", "a", "b"]}, {"b": [30, 10, 20]}]}
    assert rows_from_columns(p) == [{"a": "a", "b": 10}, {"a": "b", "b": 20}, {"a": "c", "b": 30}]


def test_row_order_nao_contiguo_ordena():
    # com filtro por campanha as posições pulam números
    p = {"row_count": 3, "row_order": [50, 7, 12], "data_columns": [{"a": ["x", "y", "z"]}]}
    assert [r["a"] for r in rows_from_columns(p)] == ["y", "z", "x"]


def test_row_order_com_tamanho_errado_falha_alto():
    with pytest.raises(ColumnarPayloadError):
        rows_from_columns({"row_count": 2, "row_order": [1], "data_columns": [{"a": [1, 2]}]})


def test_row_count_invalido_falha_alto():
    with pytest.raises(ColumnarPayloadError):
        rows_from_columns({"row_count": None, "data_columns": []})


# ---------------------------------------------------------------------------
# Prefixo da miniatura: uma regra só
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("caminho", ["thumbs/u1/abc-1_2.webp", "a b/ç€", "x~y/z.png"])
def test_prefixo_mais_caminho_e_a_url_de_sempre(caminho):
    prefixo = public_storage_prefix(DEFAULT_BUCKET)
    if prefixo is None:
        pytest.skip("SUPABASE_URL ausente neste ambiente")
    assert prefixo + _quote_path(caminho) == build_public_storage_url(DEFAULT_BUCKET, caminho)


# ---------------------------------------------------------------------------
# Paridade com o leitor do navegador: o mesmo fixture (formato real, anonimizado)
# ---------------------------------------------------------------------------

import json as _json
from pathlib import Path as _Path

_FIXTURE = _Path(__file__).resolve().parents[2] / "frontend" / "lib" / "api" / "__tests__" / "fixtures" / "manager_columns_v161.json"


@pytest.mark.parametrize("caso", _json.loads(_FIXTURE.read_text(encoding="utf-8"))["casos"], ids=lambda c: c["nome"])
def test_paridade_com_o_fixture_compartilhado(caso):
    assert caso["linhas"], "fixture sem linhas não prova nada"
    assert rows_from_columns(caso["payload"]) == caso["linhas"]


@pytest.mark.parametrize("caso", _json.loads(_FIXTURE.read_text(encoding="utf-8"))["casos"], ids=lambda c: c["nome"])
def test_paridade_em_pedacos(caso):
    # o mesmo fixture partido como a v162 entrega: metadados no meio, blocos invertidos
    p = caso["payload"]
    meta = {k: v for k, v in p.items() if k != "data_columns"}
    partes = list(reversed(p["data_columns"]))
    partes.insert(len(partes) // 2, meta)
    assert as_row_payload(partes)["data"] == caso["linhas"]
