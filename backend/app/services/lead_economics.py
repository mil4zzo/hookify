"""
Economia do lead — validação do cadastro de produtos e faixas do pack.

POR QUE EXISTE
--------------
`packs.lead_economics` (migration 179) é um documento jsonb e o banco só garante
que ele é null ou objeto (decisão D8): a validação do conteúdo vive na
aplicação. O endpoint `PATCH /packs/{id}/judgment` passa o que o cliente mandou
por aqui e grava o documento CANÔNICO devolvido — nunca o JSON cru.

ESPELHO DO FRONTEND
-------------------
Este arquivo é o espelho de `validateLeadEconomics` em
`frontend/lib/utils/leadEconomics.ts` (o contrato): mesma ordem de checagens,
mesmas mensagens, mesma dedupe, mesmo documento de saída. A tela valida antes de
enviar e mostra as mensagens; o backend recusa o que escapar com a primeira
delas. Mudar uma regra é mudar as duas — e a fixture compartilhada
`frontend/lib/utils/__tests__/fixtures/lead_economics_validation_cases.json`
(gerada por `frontend/scripts/generate-lead-economics-fixture.ts`, que roda o
validador TS) roda nos dois lados para pegar a divergência.

Só a ESCRITA estrita é espelhada. A leitura tolerante do frontend
(`normalizeLeadEconomics`, que ignora as regras de nome) não tem par aqui: o
backend não relê o cadastro para fazer conta.

Onde Python e JS diferem por natureza, a diferença é neutralizada aqui:
- bool é subclasse de int no Python; no JS `typeof true` não é "number".
  Bool é recusado explicitamente como número.
- `str.strip()`/`str.split()` do Python conhecem espaços que o `trim()`/`\\s` do
  JS não conhece (e vice-versa, U+FEFF). O conjunto do JS está escrito à mão.
- `.length` do JS conta unidades UTF-16: um emoji vale 2. O limite de 60/40
  caracteres é medido igual.
- O `json.loads` do Python guarda inteiro exato; o `JSON.parse` do navegador
  arredonda acima de 2^53. Inteiro grande vira o double que o JS vai ler (ver
  `_to_finite`).

Id e nome passam por `_sanitize_text` antes de aparar: controle C0/DEL vira
espaço e surrogate sem par some. Não é diferença de runtime — é o Postgres, que
recusa U+0000 e surrogate solto dentro de jsonb (500 no PATCH inteiro).

DIVERGÊNCIA ACEITA, DEPENDENTE DO RUNTIME: A CHAVE DE NOME
----------------------------------------------------------
`product_name_key` usa `str.lower()`; o contrato usa `toLocaleLowerCase("pt-BR")`.
A regra é a mesma (minúscula completa do Unicode, com sigma final; nenhuma das
duas dobra "ß" em "ss" — por isso NÃO trocar por `casefold()`, que acusaria nome
duplicado onde a tela aceita). Mas cada runtime traz a SUA tabela Unicode: a
imagem de produção roda Python 3.11 (Unicode 14), o venv local 3.13 (15.1), e o
Node 22 e os navegadores atuais a 16. Conferido code point a code point (Python
3.12/3.13 × Node 22): as minúsculas coincidem em tudo, menos em 27 letras que
ganharam minúscula na 16 (cirílico U+1C89, latinas U+A7CB, U+A7CC, U+A7DA,
U+A7DC e 22 maiúsculas do alfabeto Garay). Dois produtos que só diferem na caixa
de uma dessas letras são "o mesmo nome" de um lado e nomes distintos do outro: a
tela recusa e o backend aceitaria — ou o contrário, com navegador mais velho que o
Python. A cada versão nova do Unicode a lista muda.

Aceita porque o efeito fica em alfabetos raros e só na regra de NOME: a leitura
tolerante do frontend (`normalizeLeadEconomics`) ignora as regras de nome, então
um cadastro que o backend gravou nunca some da tela por isso — no pior caso o
próximo salvamento cobra renomear o produto. Espelhar a tabela Unicode à mão
custaria mais do que o caso vale. A fixture de paridade evita esses code points de
propósito (o gerador recusa um caso com eles): o esperado dependeria da versão do
runtime, não da regra.

Plano: documentation/plano-economia-do-lead.md (seções 4 e 12.2).
"""
from __future__ import annotations

import math
import re
from typing import Any, Dict, List, Optional, Tuple

LEAD_ECONOMICS_MAX_PRODUCTS = 10
LEAD_ECONOMICS_PRODUCT_ID_MAX = 40
LEAD_ECONOMICS_PRODUCT_NAME_MAX = 60

# Mensagens idênticas às do contrato TS. As que lá são funções aqui são
# templates com `{name}` (use `.format(name=...)`).
LEAD_ECONOMICS_MESSAGES: Dict[str, str] = {
    "invalidShape": "O cadastro da economia do lead está em um formato inválido.",
    "noProducts": "Cadastre ao menos um produto.",
    "tooManyProducts": f"Cadastre no máximo {LEAD_ECONOMICS_MAX_PRODUCTS} produtos.",
    "noBands": "Cadastre ao menos uma faixa de nota.",
    "productNameMissing": "Dê um nome a cada produto.",
    "productNameTooLong": f"O nome do produto pode ter no máximo {LEAD_ECONOMICS_PRODUCT_NAME_MAX} caracteres.",
    "productNameDuplicate": 'Dois produtos com o nome "{name}".',
    "ticket": 'O ticket de "{name}" precisa ser maior que zero.',
    "contributionMargin": 'Quanto sobra de cada venda de "{name}" precisa ser maior que 0% e no máximo 100%.',
    "targetMargin": 'A margem desejada de "{name}" precisa ser de 0% a menos de 100%.',
    "targetNotBelowContribution": (
        'Nenhum lead de "{name}" se paga: a margem desejada precisa ser menor do que o que sobra de cada venda.'
    ),
    "firstBandHasMin": "A primeira faixa não tem nota mínima.",
    "bandMinMissing": "Toda faixa depois da primeira precisa de uma nota de corte.",
    "bandMinNotIncreasing": "As notas de corte precisam ser crescentes, sem repetir.",
    "bandProductMissing": "Toda faixa precisa apontar para um produto cadastrado.",
    "bandConversion": "A conversão de cada faixa precisa estar entre 0% e 100%.",
}

# Espaço em branco do JS (`trim()` e `\s`): WhiteSpace + LineTerminator da spec,
# com a categoria Zs expandida. Diferente do `str.isspace()` do Python, que
# inclui U+001C–U+001F e U+0085 e não inclui U+FEFF.
_JS_WHITESPACE = "".join(
    chr(code)
    for code in (
        0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0xA0, 0x1680,
        *range(0x2000, 0x200B),
        0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF,
    )
)
_JS_WHITESPACE_RUN = re.compile("[" + re.escape(_JS_WHITESPACE) + "]+")

# Controle C0 e DEL: o Postgres recusa U+0000 dentro de jsonb ("unsupported
# Unicode escape sequence") e o PATCH inteiro caía com 500 — levando junto o
# corte de MQL do mesmo save. Os outros controles não têm lugar num nome e seguem
# o mesmo caminho: viram espaço e colapsam com os vizinhos. Espelho de
# `CONTROL_CHARS` (TS).
_CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f]")
# Surrogate sem par (o JSON "\ud800" sozinho): o Postgres também recusa. O par
# válido casa inteiro na primeira alternativa e fica. Espelho de `SURROGATES` (TS).
_SURROGATES = re.compile(r"[\ud800-\udbff][\udc00-\udfff]|[\ud800-\udfff]")

# Acima disto o `JSON.parse` do navegador já não representa todo inteiro.
_JS_MAX_SAFE_INTEGER = 2 ** 53

_NAN = float("nan")


def _js_trim(value: str) -> str:
    return value.strip(_JS_WHITESPACE)


def _collapse_spaces(value: str) -> str:
    """`trim()` + `replace(/\\s+/g, " ")` do JS."""
    return _JS_WHITESPACE_RUN.sub(" ", _js_trim(value))


def _js_length(value: str) -> int:
    """`.length` do JS: unidades UTF-16 (emoji fora do BMP conta 2)."""
    return len(value.encode("utf-16-le", "surrogatepass")) // 2


def _sanitize_text(value: str) -> str:
    """Limpa id e nome ANTES de aparar/colapsar (espelho de `sanitizeText`)."""
    value = _CONTROL_CHARS.sub(" ", value)
    value = _SURROGATES.sub(lambda m: m.group(0) if len(m.group(0)) == 2 else "", value)
    # Par que sobreviveu como dois code points (string montada no próprio Python;
    # o json.loads já os junta) vira o caractere de verdade: o canônico sai
    # sempre codificável em UTF-8.
    return value.encode("utf-16-le", "surrogatepass").decode("utf-16-le")


def _to_finite(raw: Any) -> float:
    """Só número finito; string, bool e o resto viram NaN (espelho de `toFinite`).

    Devolve o PRÓPRIO valor (int continua int) para o documento canônico não
    trocar 3000 por 3000.0. Int grande demais para float é Infinity no JS.

    Int acima de 2^53 vira float: o Python compara exato, o navegador lê o double
    mais próximo. Sem isto, os cortes 9007199254740992 e 9007199254740993 eram
    "crescentes" aqui e iguais no JS — o backend gravava um cadastro que o
    `normalizeLeadEconomics` da tela descartava. O canônico guarda o double que o
    JS vai ler.
    """
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        return _NAN
    try:
        if not math.isfinite(float(raw)):
            return _NAN
    except OverflowError:
        return _NAN
    if isinstance(raw, int) and abs(raw) > _JS_MAX_SAFE_INTEGER:
        return float(raw)
    return raw


def _is_finite(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def product_name_key(name: str) -> str:
    """Chave de comparação de nomes: caixa e espaços não distinguem produtos."""
    return _collapse_spaces(name).lower()


def validate_lead_economics(raw: Any) -> Tuple[Optional[Dict[str, Any]], List[str]]:
    """Cadastro cru → (documento canônico, []) ou (None, erros em ordem estável).

    O documento canônico tem só as chaves conhecidas, nome aparado e com espaços
    colapsados, ids aparados, sem controle nem surrogate solto. Espelho exato de
    `validateLeadEconomics` (TS).

    Custo: linear no tamanho do documento, que aqui não tem teto — a rota corta
    produtos e faixas em excesso antes de chamar (ver `update_pack_judgment`).
    """
    M = LEAD_ECONOMICS_MESSAGES
    errors: List[str] = []
    # Dedupe por texto exato num set ao lado da lista (o `seen` do contrato):
    # `message not in errors` era O(n) por mensagem, e produto sem nome gera
    # mensagem única ("produto 1", "produto 2"...) — 20 mil produtos vazios eram
    # 14 s de CPU num worker. A lista continua dando a ordem.
    seen: set = set()

    def push(message: str) -> None:
        if message not in seen:
            seen.add(message)
            errors.append(message)

    if (
        not isinstance(raw, dict)
        or not isinstance(raw.get("products"), list)
        or not isinstance(raw.get("bands"), list)
    ):
        return None, [M["invalidShape"]]

    # Produtos
    raw_products: List[Any] = raw["products"]
    if len(raw_products) == 0:
        push(M["noProducts"])
    if len(raw_products) > LEAD_ECONOMICS_MAX_PRODUCTS:
        push(M["tooManyProducts"])

    products: List[Dict[str, Any]] = []
    product_ids: set = set()
    name_keys: set = set()

    for index, item in enumerate(raw_products):
        if not isinstance(item, dict):
            push(M["invalidShape"])
            continue

        raw_id = item.get("id")
        product_id = _js_trim(_sanitize_text(raw_id)) if isinstance(raw_id, str) else ""
        if not product_id or _js_length(product_id) > LEAD_ECONOMICS_PRODUCT_ID_MAX or product_id in product_ids:
            push(M["invalidShape"])
        else:
            product_ids.add(product_id)

        raw_name = item.get("name")
        name = _collapse_spaces(_sanitize_text(raw_name)) if isinstance(raw_name, str) else ""
        display_name = name or f"produto {index + 1}"
        if not name:
            push(M["productNameMissing"])
        elif _js_length(name) > LEAD_ECONOMICS_PRODUCT_NAME_MAX:
            push(M["productNameTooLong"])
        else:
            key = product_name_key(name)
            if key in name_keys:
                push(M["productNameDuplicate"].format(name=name))
            name_keys.add(key)

        ticket = _to_finite(item.get("ticket"))
        if not (ticket > 0):
            push(M["ticket"].format(name=display_name))

        contribution = _to_finite(item.get("contribution_margin"))
        contribution_ok = 0 < contribution <= 1
        if not contribution_ok:
            push(M["contributionMargin"].format(name=display_name))

        target = _to_finite(item.get("target_margin"))
        target_ok = 0 <= target < 1
        if not target_ok:
            push(M["targetMargin"].format(name=display_name))

        # Só compara quando os dois são válidos: senão a mensagem repetiria o mesmo erro.
        if contribution_ok and target_ok and target >= contribution:
            push(M["targetNotBelowContribution"].format(name=display_name))

        products.append({
            "id": product_id,
            "name": name,
            "ticket": ticket,
            "contribution_margin": contribution,
            "target_margin": target,
        })

    # Faixas
    raw_bands: List[Any] = raw["bands"]
    if len(raw_bands) == 0:
        push(M["noBands"])

    bands: List[Dict[str, Any]] = []
    # Última nota de corte VÁLIDA vista. Uma nota inválida no meio não a apaga;
    # uma fora de ordem a substitui (é o que o contrato faz).
    previous_min: Optional[float] = None

    for index, item in enumerate(raw_bands):
        if not isinstance(item, dict):
            push(M["invalidShape"])
            continue

        band_min: Optional[float] = None
        if index == 0:
            # JS: `item.min !== null && item.min !== undefined`.
            if item.get("min") is not None:
                push(M["firstBandHasMin"])
        else:
            parsed = _to_finite(item.get("min"))
            if not _is_finite(parsed):
                push(M["bandMinMissing"])
            else:
                if previous_min is not None and not (parsed > previous_min):
                    push(M["bandMinNotIncreasing"])
                band_min = parsed
                previous_min = parsed

        # A referência passa pela mesma limpeza do id do produto: senão um id com
        # controle viraria "p 1" no produto e continuaria com o controle na faixa.
        raw_product = item.get("product")
        product = _js_trim(_sanitize_text(raw_product)) if isinstance(raw_product, str) else ""
        if not product or product not in product_ids:
            push(M["bandProductMissing"])

        conversion = _to_finite(item.get("conversion"))
        if not (0 <= conversion <= 1):
            push(M["bandConversion"])

        bands.append({"min": band_min, "product": product, "conversion": conversion})

    if errors:
        return None, errors
    return {"products": products, "bands": bands}, []
