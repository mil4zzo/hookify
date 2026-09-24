# -*- coding: utf-8 -*-
"""Paridade do validador da economia do lead: Python × contrato TS.

A fixture `frontend/lib/utils/__tests__/fixtures/lead_economics_validation_cases.json`
é GERADA por `frontend/scripts/generate-lead-economics-fixture.ts`, que roda o
`validateLeadEconomics` do frontend (`frontend/lib/utils/leadEconomics.ts`) sobre
a lista de entradas — os `expected_errors` e o `expected_value` são o que o
contrato de fato produz. Caso novo entra na lista do gerador, nunca à mão no JSON
(o teste do frontend compara a fixture com a saída do gerador). O teste irmão do
frontend (`lib/utils/__tests__/leadEconomicsValidation.test.ts`) lê a MESMA
fixture. Se um lado mudar uma regra ou uma vírgula de mensagem sem o outro, um dos
dois quebra.

Ela mora no frontend, e não em `backend/tests/fixtures/`, porque o .gitignore
ignora `*.json` fora de `**/__tests__/fixtures/` — no backend não seria
versionada. Mesmo arranjo de `test_manager_v161.py`.

Leitura da fixture: o `input` é lido como o FastAPI lê o corpo (`json.loads`,
inteiro exato); o `expected_*` é lido como o navegador leu quando o validador TS
o gerou (inteiro acima de 2^53 vira o double mais próximo). Ao regenerar a
fixture, os literais inteiros de módulo acima de 2^53 dos inputs precisam sair
EXATOS no texto (o gerador os escreve a partir de bigint) — um `JSON.parse` +
`JSON.stringify` os arredonda e o caso deixa de provar alguma coisa
(test_fixture_preserva_inteiro_acima_de_2_53 pega isso).

Sabotagens feitas: remover a checagem de ordem crescente das notas de corte →
"min repetida", "min decrescente" e os casos de vários erros falham; tirar o
`isinstance(raw, bool)` de `_to_finite` → "ticket true", "conversion true",
"conversion false", "target_margin false" e afins falham; tirar a troca de int
acima de 2^53 por float → "min inteira acima de 2^53..." falha; tirar o
`_sanitize_text` → os casos de NUL/controle/surrogate falham; voltar a dedupe
para `message not in errors` → test_vinte_mil_produtos_sem_nome_em_menos_de_2s
falha (≈11 s). Com os casos do gerador: tirar U+3000 de `_JS_WHITESPACE` →
"espaco do JS U+3000..." falha (id "\\u3000p1\\u3000" != "p1"); aceitar `bands`
como dict → "bands objeto vazio ({})..." falha (vira "0 faixas"); trocar
`.lower()` por `.casefold()` em `product_name_key` → os casos 'STRASSE'/'straße'
e 'ΟΔΟΣ'/'οδοσ' falham (nome duplicado); `raw > 2^53` no lugar de
`abs(raw) > 2^53` → "min inteira abaixo de -2^53..." falha; gravar a fixture
antiga de 108 casos → o piso de casos e o guarda do literal negativo falham;
escrever o -2^53 - 1 como number (e não bigint) no gerador → só
test_fixture_preserva_inteiro_acima_de_2_53 falha (a paridade passa: o caso
perdeu a força).
"""
import json
import time
from pathlib import Path

import pytest

from app.services.lead_economics import (
    LEAD_ECONOMICS_MESSAGES,
    product_name_key,
    validate_lead_economics,
)

FIXTURE = (
    Path(__file__).resolve().parents[2]
    / "frontend" / "lib" / "utils" / "__tests__" / "fixtures" / "lead_economics_validation_cases.json"
)
_JS_MAX_SAFE_INTEGER = 2 ** 53


def _as_js_reads(text: str):
    """`parse_int` do JSON.parse: acima de 2^53 o navegador guarda o double."""
    n = int(text)
    return n if abs(n) <= _JS_MAX_SAFE_INTEGER else float(n)


_TEXT = FIXTURE.read_text(encoding="utf-8")
_AS_PYTHON_READS = json.loads(_TEXT)
_AS_JS_READS = json.loads(_TEXT, parse_int=_as_js_reads)
CASES = [
    {**expected, "input": raw["input"]}
    for raw, expected in zip(_AS_PYTHON_READS, _AS_JS_READS)
]


def test_fixture_tem_casos_validos_e_invalidos():
    # Guarda contra fixture truncada/vazia: sem isto, zero casos passariam "verde".
    # Piso = total atual (143 casos, 55 válidos) menos uma folga pequena: uma
    # regeneração que perca um bloco de casos falha aqui.
    assert len(CASES) >= 140
    assert sum(1 for c in CASES if c["expected_value"] is not None) >= 50
    assert len({c["name"] for c in CASES}) == len(CASES)


def test_fixture_preserva_inteiro_acima_de_2_53():
    # O caso só prova algo se o Python ler o literal EXATO (o JS lê o vizinho par).
    caso = next(c for c in CASES if c["name"].startswith("min inteira acima de 2^53"))
    assert [b["min"] for b in caso["input"]["bands"]] == [None, 9007199254740992, 9007199254740993]
    # O espelho negativo: é ele que pega `raw > 2^53` no lugar de `abs(raw) > 2^53`.
    negativo = next(c for c in CASES if c["name"].startswith("min inteira abaixo de -2^53"))
    assert [b["min"] for b in negativo["input"]["bands"]] == [None, -9007199254740993, -9007199254740992]
    enorme = next(c for c in CASES if c["name"].startswith("valido: ticket inteiro enorme"))
    assert enorme["input"]["products"][0]["ticket"] == 12345678901234567890


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_paridade_com_o_contrato_ts(case):
    value, errors = validate_lead_economics(case["input"])
    assert errors == case["expected_errors"]
    assert value == case["expected_value"]
    # Erro e valor são exclusivos: nunca documento "meio válido".
    assert (value is None) == bool(errors)


def test_bool_nao_e_numero_mesmo_sendo_int_no_python():
    doc = {
        "products": [{"id": "p1", "name": "A", "ticket": True, "contribution_margin": 1, "target_margin": 0}],
        "bands": [{"min": None, "product": "p1", "conversion": False}],
    }
    _, errors = validate_lead_economics(doc)
    assert LEAD_ECONOMICS_MESSAGES["ticket"].format(name="A") in errors
    assert LEAD_ECONOMICS_MESSAGES["bandConversion"] in errors


@pytest.mark.parametrize("bad", [float("nan"), float("inf"), -float("inf"), 10**400])
def test_nao_finitos_que_o_json_do_python_aceita(bad):
    # json.loads do Python aceita NaN/Infinity e inteiros enormes; o JSON.parse do
    # JS não (ou vira Infinity). Nos dois casos o contrato recusa.
    doc = {
        "products": [{"id": "p1", "name": "A", "ticket": bad, "contribution_margin": 0.5, "target_margin": 0.1}],
        "bands": [{"min": None, "product": "p1", "conversion": 0.1}],
    }
    value, errors = validate_lead_economics(doc)
    assert value is None
    assert errors == [LEAD_ECONOMICS_MESSAGES["ticket"].format(name="A")]


def test_inteiro_continua_inteiro_no_documento_canonico():
    doc = {
        "products": [{"id": "p1", "name": "A", "ticket": 3000, "contribution_margin": 1, "target_margin": 0}],
        "bands": [{"min": None, "product": "p1", "conversion": 0}],
    }
    value, _ = validate_lead_economics(doc)
    assert type(value["products"][0]["ticket"]) is int
    assert json.dumps(value["products"][0]["ticket"]) == "3000"


def test_chave_de_nome_ignora_caixa_e_espacos():
    assert product_name_key("  Curso" + chr(0xA0) + "  ONLINE ") == "curso online"


def test_inteiro_enorme_grava_o_double_que_o_navegador_le():
    # Gravado como int exato, voltaria do banco como 12345678901234567890 e o
    # navegador leria um double diferente do que o Python comparou. Gravado como
    # float, o banco guarda exatamente o número que o JS vai ler.
    doc = {
        "products": [
            {"id": "p1", "name": "A", "ticket": 12345678901234567890, "contribution_margin": 1, "target_margin": 0}
        ],
        "bands": [{"min": None, "product": "p1", "conversion": 0}],
    }
    value, _ = validate_lead_economics(doc)
    ticket = value["products"][0]["ticket"]
    assert type(ticket) is float
    assert ticket == float(12345678901234567890)
    # 2^53 exato ainda é representável: continua int.
    doc["products"][0]["ticket"] = 2 ** 53
    value, _ = validate_lead_economics(doc)
    assert type(value["products"][0]["ticket"]) is int


def test_par_de_surrogates_montado_no_python_vira_um_caractere():
    # O json.loads já junta o par escapado; uma string montada no Python pode trazer
    # os dois code points separados — o canônico sai em UTF-8 válido.
    high, low = chr(0xD83D), chr(0xDE00)
    doc = {
        "products": [
            {"id": "p1", "name": "Curso " + high + low, "ticket": 1, "contribution_margin": 1, "target_margin": 0}
        ],
        "bands": [{"min": None, "product": "p1", "conversion": 0}],
    }
    value, errors = validate_lead_economics(doc)
    assert errors == []
    assert value["products"][0]["name"] == "Curso " + chr(0x1F600)
    json.dumps(value, ensure_ascii=False).encode("utf-8")  # não levanta


def test_vinte_mil_produtos_sem_nome_em_menos_de_2s():
    # Produto sem nome gera mensagens ÚNICAS ("produto 1", "produto 2"...): com a
    # dedupe numa lista eram 60 mil buscas lineares — 11-14 s de CPU por chamada.
    doc = {"products": [{} for _ in range(20_000)], "bands": []}
    inicio = time.perf_counter()
    value, errors = validate_lead_economics(doc)
    decorrido = time.perf_counter() - inicio
    assert decorrido < 2, f"validador levou {decorrido:.1f}s com 20 mil produtos"
    # A saída é a mesma da dedupe por lista: cada mensagem uma vez, em ordem.
    assert value is None
    assert errors[:3] == [
        LEAD_ECONOMICS_MESSAGES["tooManyProducts"],
        LEAD_ECONOMICS_MESSAGES["invalidShape"],
        LEAD_ECONOMICS_MESSAGES["productNameMissing"],
    ]
    assert errors[3] == LEAD_ECONOMICS_MESSAGES["ticket"].format(name="produto 1")
    assert errors[-1] == LEAD_ECONOMICS_MESSAGES["noBands"]
    assert len(errors) == len(set(errors)) == 3 + 3 * 20_000 + 1
