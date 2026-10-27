# -*- coding: utf-8 -*-
"""Economia do lead no pack: gravação por `PATCH /packs/{id}/judgment` e leitura
por `GET /analytics/packs` (migration 179).

O que se trava aqui é a FIAÇÃO — as regras em si estão na fixture de paridade
(test_lead_economics_validation.py):
- documento inválido → 400 com a mensagem do contrato (a primeira);
- documento válido → o que chega ao banco é o CANÔNICO do validador, nunca o
  JSON cru do cliente (o banco só confere "null ou objeto");
- `null` limpa; chave ausente não entra no update;
- viewer → 403 antes de qualquer escrita;
- a lista de packs (própria e compartilhada) leva a coluna ao cliente.

A gravação passa pelo `supabase_repo.update_pack_judgment` REAL, com um cliente
Supabase falso que registra o `.update(...)` — mockar a função do repo esconderia
o conjunto `allowed`, que é justamente o que descarta chave desconhecida.

Sabotagens feitas: remover a checagem de ordem crescente das notas de corte no
validador → test_cortes_fora_de_ordem_400 falha; tirar "lead_economics" do
`allowed` do repo → test_grava_documento_canonico falha (o repo devolve {} sem
chamar o banco); tirar o teto de produtos da rota → os testes de 200 mil
produtos falham (o validador recebe a lista inteira); tirar o corte das faixas
→ os de 200 mil faixas falham; exigir só `products` lista no teto de produtos
(sem `bands` lista) → o diferencial "11 produtos e bands string" falha.
"""
import copy
import json
import time

import pytest
from fastapi.testclient import TestClient

import app.main as main
from app.core.auth import get_current_user
from app.routes import analytics
from app.services import pack_access, supabase_repo
from app.services.lead_economics import (
    LEAD_ECONOMICS_MAX_PRODUCTS,
    LEAD_ECONOMICS_MESSAGES as M,
    validate_lead_economics,
)
from app.services.pack_access import PackAccess

PACK_ID = "pack-1"
URL = f"/analytics/packs/{PACK_ID}/judgment"

VALIDO = {
    "products": [
        {"id": "p1", "name": "Mentoria", "ticket": 3000, "contribution_margin": 0.55, "target_margin": 0.40},
        {"id": "p2", "name": "Ebook", "ticket": 300, "contribution_margin": 0.90, "target_margin": 0.40},
    ],
    "bands": [
        {"min": None, "product": "p2", "conversion": 0.005},
        {"min": 60, "product": "p1", "conversion": 0.04},
        {"min": 80, "product": "p1", "conversion": 0.12},
    ],
}


# ── Cliente Supabase falso ───────────────────────────────────────────────────


class _Result:
    def __init__(self, data):
        self.data = data


class _Query:
    """Só o que list_packs/list_shared_packs/update_pack_judgment usam.

    O `select` PROJETA as colunas pedidas: se um caminho trocar `select("*")` por
    uma lista explícita sem `lead_economics`, o teste de leitura enxerga o furo.
    """

    def __init__(self, sb, table):
        self.sb = sb
        self.table_name = table
        self.fields = "*"
        self.filters = []
        self.eqs = []
        self.payload = None
        self.window = None

    def select(self, fields="*", **_kw):
        self.fields = fields
        return self

    def update(self, data):
        self.payload = data
        return self

    def eq(self, col, val):
        self.eqs.append((col, val))
        self.filters.append((col, lambda v, x=val: str(v) == str(x)))
        return self

    def in_(self, col, vals):
        wanted = {str(v) for v in vals}
        self.filters.append((col, lambda v, w=wanted: str(v) in w))
        return self

    def order(self, *_a, **_kw):
        return self

    def limit(self, *_a, **_kw):
        return self

    def range(self, start, end):
        self.window = (start, end)
        return self

    def execute(self):
        if self.payload is not None:
            self.sb.updates.append(
                {"table": self.table_name, "data": copy.deepcopy(self.payload), "eq": list(self.eqs)}
            )
            return _Result([{"id": dict(self.eqs).get("id"), **self.payload}])

        rows = [
            r for r in self.sb.tables.get(self.table_name, [])
            if all(pred(r.get(col)) for col, pred in self.filters)
        ]
        if self.fields.strip() != "*":
            cols = [c.strip() for c in self.fields.split(",")]
            rows = [{c: r.get(c) for c in cols} for r in rows]
        else:
            rows = [copy.deepcopy(r) for r in rows]
        if self.window:
            rows = rows[self.window[0]: self.window[1] + 1]
        return _Result(rows)


class _Rpc:
    def __init__(self, data):
        self.data = data

    def execute(self):
        return _Result(self.data)


class _FakeSupabase:
    def __init__(self, tables=None):
        self.tables = tables or {}
        self.updates = []

    def table(self, name):
        return _Query(self, name)

    def rpc(self, name, _params=None):
        if name == "lookup_users_by_ids":
            return _Rpc([{"user_id": "dono-2", "display_name": "Dona"}])
        return _Rpc([])


# ── Fixtures ────────────────────────────────────────────────────────────────


def _usuario_falso():
    return {"user_id": "u1", "token": "tok"}


@pytest.fixture
def sb(monkeypatch):
    fake = _FakeSupabase()
    monkeypatch.setattr(supabase_repo, "get_supabase_service", lambda: fake)
    monkeypatch.setattr(supabase_repo, "get_supabase_for_user", lambda *_a, **_k: fake)
    return fake


@pytest.fixture
def client(monkeypatch, sb):
    main.app.dependency_overrides[get_current_user] = _usuario_falso
    monkeypatch.setattr(
        analytics, "assert_pack_role", lambda *_a, **_k: PackAccess(role="editor", owner_id="dono-2")
    )
    yield TestClient(main.app)
    main.app.dependency_overrides.pop(get_current_user, None)


def _patch(client, body):
    return client.patch(URL, json=body)


# ── Gravação ────────────────────────────────────────────────────────────────


def test_grava_documento_canonico(client, sb, _no_real_action_log):
    sujo = copy.deepcopy(VALIDO)
    sujo["products"][0]["id"] = "  p1  "
    sujo["products"][0]["name"] = "  Mentoria    Premium "
    sujo["products"][0]["cor"] = "azul"          # chave desconhecida no produto
    sujo["bands"][1]["product"] = " p1 "
    sujo["bands"][1]["rotulo"] = "60 a 79"        # chave desconhecida na faixa
    sujo["observacao"] = "lixo no topo"            # chave desconhecida no topo

    r = _patch(client, {"lead_economics": sujo})
    assert r.status_code == 200, r.text

    esperado = copy.deepcopy(VALIDO)
    esperado["products"][0]["name"] = "Mentoria Premium"

    assert len(sb.updates) == 1, "o repo real tem de chegar ao banco"
    update = sb.updates[0]
    assert update["table"] == "packs"
    assert update["eq"] == [("id", PACK_ID)]
    assert set(update["data"]) == {"lead_economics", "updated_at"}
    assert update["data"]["lead_economics"] == esperado

    # O cliente recebe o mesmo documento que foi gravado (para ecoar no store).
    assert r.json()["judgment"] == {"lead_economics": esperado}

    # Autoria: o registro leva o documento canônico, não o cru.
    linhas = [l for l in _no_real_action_log if l["action"] == "pack.judgment"]
    assert len(linhas) == 1
    assert linhas[0]["detail"] == {"lead_economics": esperado}
    assert linhas[0]["actor_role"] == "editor"


def test_grava_junto_com_os_outros_campos(client, sb):
    r = _patch(client, {"mql_leadscore_min": 70, "lead_economics": VALIDO})
    assert r.status_code == 200, r.text
    assert sb.updates[0]["data"]["mql_leadscore_min"] == 70
    assert sb.updates[0]["data"]["lead_economics"] == VALIDO


def _com_mins(*mins):
    doc = {"products": [copy.deepcopy(VALIDO["products"][0])], "bands": []}
    for m in mins:
        doc["bands"].append({"min": m, "product": "p1", "conversion": 0.04})
    return doc


def test_cortes_fora_de_ordem_400(client, sb):
    r = _patch(client, {"lead_economics": _com_mins(None, 80, 60)})
    assert r.status_code == 400
    assert r.json()["detail"] == M["bandMinNotIncreasing"]
    assert sb.updates == []


def test_corte_repetido_400(client, sb):
    r = _patch(client, {"lead_economics": _com_mins(None, 60, 60)})
    assert r.status_code == 400
    assert r.json()["detail"] == M["bandMinNotIncreasing"]
    assert sb.updates == []


def test_primeira_faixa_com_min_400(client, sb):
    r = _patch(client, {"lead_economics": _com_mins(10, 60)})
    assert r.status_code == 400
    assert r.json()["detail"] == M["firstBandHasMin"]
    assert sb.updates == []


def test_produto_inexistente_400(client, sb):
    doc = copy.deepcopy(VALIDO)
    doc["bands"][2]["product"] = "p9"
    r = _patch(client, {"lead_economics": doc})
    assert r.status_code == 400
    assert r.json()["detail"] == M["bandProductMissing"]
    assert sb.updates == []


@pytest.mark.parametrize("target", [0.55, 0.60])
def test_margem_desejada_nao_menor_que_a_sobra_400(client, sb, target):
    doc = copy.deepcopy(VALIDO)
    doc["products"][0]["target_margin"] = target  # sobra de Mentoria = 0.55
    r = _patch(client, {"lead_economics": doc})
    assert r.status_code == 400
    assert r.json()["detail"] == M["targetNotBelowContribution"].format(name="Mentoria")
    assert sb.updates == []


@pytest.mark.parametrize("quantidade", [11, 300, 5_000])
def test_faixas_nao_tem_teto(client, sb, quantidade):
    # 2026-10-27: o limite de 10 faixas deixou de existir. Uma faixa por décimo de nota
    # (e muito mais) grava, com a ordem dos cortes preservada.
    doc = _com_mins(None, *[i / 10 for i in range(1, quantidade)])
    r = _patch(client, {"lead_economics": doc})
    assert r.status_code == 200, r.text
    gravado = sb.updates[0]["data"]["lead_economics"]
    assert len(gravado["bands"]) == quantidade
    assert [b["min"] for b in gravado["bands"]] == [b["min"] for b in doc["bands"]]


@pytest.mark.parametrize("cru", [[], "abc", 42, {"products": []}])
def test_forma_invalida_400(client, sb, cru):
    r = _patch(client, {"lead_economics": cru})
    assert r.status_code == 400
    assert r.json()["detail"] == M["invalidShape"]
    assert sb.updates == []


def test_varios_erros_devolve_o_primeiro(client, sb):
    doc = copy.deepcopy(VALIDO)
    doc["products"][1]["ticket"] = 0          # erro de produto vem antes...
    doc["bands"][0]["conversion"] = 2         # ...do erro de faixa
    r = _patch(client, {"lead_economics": doc})
    assert r.status_code == 400
    assert r.json()["detail"] == M["ticket"].format(name="Ebook")
    assert sb.updates == []


# ── Teto de custo antes de validar ──────────────────────────────────────────


@pytest.fixture
def validador_espiao(monkeypatch):
    """Registra o tamanho do que a rota entrega ao validador REAL."""
    vistos = []

    def _espiao(raw):
        if isinstance(raw, dict):
            vistos.append({
                "products": len(raw.get("products") or []) if isinstance(raw.get("products"), list) else None,
                "bands": len(raw.get("bands") or []) if isinstance(raw.get("bands"), list) else None,
            })
        return validate_lead_economics(raw)

    monkeypatch.setattr(analytics, "validate_lead_economics", _espiao)
    return vistos


def _patch_cronometrado(client, body):
    inicio = time.perf_counter()
    r = _patch(client, body)
    return r, time.perf_counter() - inicio


def test_duzentos_mil_produtos_400_em_menos_de_1s(client, sb, validador_espiao):
    # 200 mil produtos vazios: sem teto, o validador percorre todos (e antes da
    # dedupe por set eram minutos de CPU num worker).
    doc = {"products": [{} for _ in range(200_000)], "bands": []}
    r, decorrido = _patch_cronometrado(client, {"mql_leadscore_min": 70, "lead_economics": doc})
    assert r.status_code == 400
    assert r.json()["detail"] == M["tooManyProducts"]
    assert decorrido < 1, f"rota levou {decorrido:.2f}s"
    assert validador_espiao == [], "a lista inteira não pode chegar ao validador"
    assert sb.updates == []


def test_duzentas_mil_faixas_invalidas_400_sem_travar_o_worker(client, sb, validador_espiao):
    # Sem teto de faixas, o validador percorre TODAS: o que segura o custo é ele ser
    # linear (dedupe por set), não um corte da lista. 200 mil faixas vazias.
    doc = {"products": copy.deepcopy(VALIDO["products"]), "bands": [{} for _ in range(200_000)]}
    _, erros_cheios = validate_lead_economics(copy.deepcopy(doc))
    r, decorrido = _patch_cronometrado(client, {"lead_economics": doc})
    assert r.status_code == 400
    assert r.json()["detail"] == erros_cheios[0]
    # Folga larga: a rota mede também a serialização de 200 mil itens pelo cliente de
    # teste (0,6–1,4 s); quem prova o custo linear é test_validador_e_linear_em_faixas.
    assert decorrido < 5, f"rota levou {decorrido:.2f}s"
    assert validador_espiao == [{"products": 2, "bands": 200_000}]
    assert sb.updates == []


def test_cinquenta_mil_faixas_validas_gravam(client, sb):
    doc = _com_mins(None, *range(1, 50_000))
    r = _patch(client, {"lead_economics": doc})
    assert r.status_code == 200, r.text
    assert len(sb.updates[0]["data"]["lead_economics"]["bands"]) == 50_000


def test_validador_e_linear_em_faixas():
    # Prova "linear, não quadrático" por RAZÃO entre tamanhos — não por segundos, que
    # variam com a máquina (0,4 s a 2 s para o mesmo documento). Quadrupicar as faixas
    # quadruplica o tempo se for linear (razão ~4) e o multiplica por 16 se não for.
    def melhor_tempo(quantidade):
        doc = _com_mins(None, *range(1, quantidade))
        tempos = []
        for _ in range(3):
            inicio = time.perf_counter()
            valor, erros = validate_lead_economics(doc)
            tempos.append(time.perf_counter() - inicio)
            assert erros == [] and valor is not None
        return min(tempos)

    pequeno, grande = melhor_tempo(20_000), melhor_tempo(80_000)
    assert grande / pequeno < 9, f"80 mil faixas levaram {grande / pequeno:.1f}x o tempo de 20 mil (linear ~4x)"


def _faixas(n, **extra):
    return [{"min": None if i == 0 else i, "product": "p1", "conversion": 0.04, **extra} for i in range(n)]


_ACIMA_DO_TETO = {
    # O caso que o teto ingênuo erraria: products é lista grande, mas bands não é
    # lista — a primeira mensagem é invalidShape, não tooManyProducts.
    "11 produtos e bands string": {"products": [{}] * (LEAD_ECONOMICS_MAX_PRODUCTS + 1), "bands": "x"},
    "11 produtos e bands ausente": {"products": [{}] * (LEAD_ECONOMICS_MAX_PRODUCTS + 1)},
    "11 produtos validos e 50 faixas": {
        "products": [
            {"id": f"p{i}", "name": f"P{i}", "ticket": 1, "contribution_margin": 1, "target_margin": 0}
            for i in range(LEAD_ECONOMICS_MAX_PRODUCTS + 1)
        ],
        "bands": _faixas(50),
    },
    "produto com erro e 50 faixas": {
        "products": [{**VALIDO["products"][0], "ticket": 0}, VALIDO["products"][1]],
        "bands": _faixas(50),
    },
    "produto sem id e 50 faixas": {"products": [{**VALIDO["products"][0], "id": ""}], "bands": _faixas(50)},
    "produto que nao e objeto e 50 faixas": {"products": ["x"], "bands": _faixas(50)},
    "0 produtos e 50 faixas": {"products": [], "bands": _faixas(50)},
    "produtos validos e 50 faixas com erro ja na primeira": {
        "products": copy.deepcopy(VALIDO["products"]),
        "bands": [{"min": 5, "product": "p9", "conversion": 2}] + _faixas(49),
    },
}


@pytest.mark.parametrize("nome", list(_ACIMA_DO_TETO))
def test_teto_devolve_a_mesma_primeira_mensagem_do_documento_inteiro(client, sb, nome):
    # Diferencial: a rota corta antes de validar; a mensagem tem de ser a que o
    # validador daria ao documento INTEIRO (é a prova do comentário da rota).
    doc = _ACIMA_DO_TETO[nome]
    _, erros_cheios = validate_lead_economics(copy.deepcopy(doc))
    assert erros_cheios, "pré-condição: o documento inteiro é inválido"
    r = _patch(client, {"lead_economics": doc})
    assert r.status_code == 400
    assert r.json()["detail"] == erros_cheios[0]
    assert sb.updates == []


# ── Texto que o Postgres recusaria ──────────────────────────────────────────


def test_nome_com_nul_grava_limpo(client, sb):
    # U+0000 dentro de jsonb o Postgres recusa: o PATCH caía com 500 e levava
    # junto o corte de MQL do mesmo save.
    doc = copy.deepcopy(VALIDO)
    doc["products"][0]["name"] = "Mentoria\u0000VIP"
    r = _patch(client, {"mql_leadscore_min": 70, "lead_economics": doc})
    assert r.status_code == 200, r.text
    gravado = sb.updates[0]["data"]
    assert gravado["mql_leadscore_min"] == 70
    assert gravado["lead_economics"]["products"][0]["name"] == "Mentoria VIP"
    assert "\u0000" not in json.dumps(gravado["lead_economics"])


def test_surrogate_solto_grava_limpo_e_emoji_fica(client, sb):
    # O navegador manda surrogate solto escapado ("\ud800" no texto do JSON); o
    # TestClient não serializa isso sozinho, então o corpo vai cru.
    doc = copy.deepcopy(VALIDO)
    doc["products"][0]["name"] = "__NOME__"
    corpo = json.dumps({"lead_economics": doc}).replace(
        "__NOME__", "Mentoria\\ud800 VIP \\ud83d\\ude00"
    )
    r = client.patch(URL, content=corpo, headers={"content-type": "application/json"})
    assert r.status_code == 200, r.text
    nome = sb.updates[0]["data"]["lead_economics"]["products"][0]["name"]
    assert nome == "Mentoria VIP \U0001F600"
    json.dumps(sb.updates[0]["data"], ensure_ascii=False).encode("utf-8")  # não levanta


def test_null_limpa(client, sb):
    r = _patch(client, {"lead_economics": None})
    assert r.status_code == 200, r.text
    assert len(sb.updates) == 1
    assert "lead_economics" in sb.updates[0]["data"]
    assert sb.updates[0]["data"]["lead_economics"] is None
    assert r.json()["judgment"] == {"lead_economics": None}


def test_chave_ausente_nao_entra_no_update(client, sb):
    r = _patch(client, {"mql_leadscore_min": 50})
    assert r.status_code == 200, r.text
    assert len(sb.updates) == 1
    assert "lead_economics" not in sb.updates[0]["data"]
    assert sb.updates[0]["data"]["mql_leadscore_min"] == 50


def test_viewer_recebe_403_sem_escrever(monkeypatch, sb):
    # assert_pack_role REAL; só o resolvedor de papel é falso.
    main.app.dependency_overrides[get_current_user] = _usuario_falso
    monkeypatch.setattr(
        pack_access, "resolve_pack_role", lambda *_a, **_k: PackAccess(role="viewer", owner_id="dono-2")
    )
    try:
        r = TestClient(main.app).patch(URL, json={"lead_economics": VALIDO})
    finally:
        main.app.dependency_overrides.pop(get_current_user, None)
    assert r.status_code == 403
    assert sb.updates == []


# ── Leitura: GET /analytics/packs ───────────────────────────────────────────


def test_lista_de_packs_leva_lead_economics_proprio_e_compartilhado(monkeypatch, sb):
    """list_packs e list_shared_packs REAIS sobre o cliente falso (que projeta colunas)."""
    compartilhado_doc = copy.deepcopy(VALIDO)
    compartilhado_doc["products"] = compartilhado_doc["products"][:1]
    compartilhado_doc["bands"] = [{"min": None, "product": "p1", "conversion": 0.04}]

    sb.tables = {
        "packs": [
            {"id": "p-own", "user_id": "u1", "name": "Meu", "created_at": "2026-09-02",
             "stats": {"totalSpend": 1.0}, "ad_ids": ["a1"], "lead_economics": copy.deepcopy(VALIDO)},
            {"id": "p-own-vazio", "user_id": "u1", "name": "Sem cadastro", "created_at": "2026-09-01",
             "stats": {"totalSpend": 1.0}, "ad_ids": [], "lead_economics": None},
            {"id": "p-shared", "user_id": "dono-2", "name": "Da Dona", "created_at": "2026-09-03",
             "stats": {"totalSpend": 2.0}, "ad_ids": ["b1"], "lead_economics": compartilhado_doc},
        ],
        "pack_shares": [
            {"pack_id": "p-shared", "owner_id": "dono-2", "role": "viewer", "grantee_id": "u1"},
        ],
    }
    main.app.dependency_overrides[get_current_user] = _usuario_falso
    try:
        r = TestClient(main.app).get("/analytics/packs")
    finally:
        main.app.dependency_overrides.pop(get_current_user, None)

    assert r.status_code == 200, r.text
    por_id = {p["id"]: p for p in r.json()["packs"]}
    assert set(por_id) == {"p-own", "p-own-vazio", "p-shared"}

    assert por_id["p-own"]["lead_economics"] == VALIDO
    # null atravessa como null (não configurado), não some nem vira {}.
    assert "lead_economics" in por_id["p-own-vazio"]
    assert por_id["p-own-vazio"]["lead_economics"] is None
    # Compartilhado: o leitor vê o cadastro do dono (só não pode gravar).
    assert por_id["p-shared"]["shared_role"] == "viewer"
    assert por_id["p-shared"]["lead_economics"] == compartilhado_doc
