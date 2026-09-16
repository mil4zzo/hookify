"""
Leitor do formato em COLUNAS das `fetch_manager_rankings_v161/v162` (migrations 161 e 162).

POR QUE COLUNAS
---------------
A resposta do Manager tem um objeto por linha, com os mesmos ~50 nomes de campo
repetidos em todas elas. Medido em 16/09 com 10 mil linhas reais: com uma lista
por campo, a resposta cai de 1,98 MB para 1,08 MB na rede (os valores parecidos
ficam juntos e comprimem melhor). O navegador volta a montar as linhas num ponto
só — ele lê linhas muito bem; colunas servem para trafegar e para gravar.

O FORMATO
---------
    {
      "data_columns": [ {"group_key": [...], "spend": [...], ...}, {...}, ... ],
      "row_count": N,
      ...demais campos de topo iguais aos de antes (averages, names, pagination...)
    }

`data_columns` é uma lista de BLOCOS porque o `json_build_object` do Postgres
aceita no máximo 100 argumentos (50 campos). Cada bloco tem listas de tamanho N,
e a linha i é a união de `bloco[campo][i]` de todos os blocos.

`row_order` (lista de tamanho N): a POSIÇÃO final da linha i. As listas saem do
banco numa ordem qualquer — ordenar as linhas largas lá custava 75–80 MB em disco
por requisição (medido, 16/09) — e o leitor as põe na ordem aqui. Sem `row_order`,
a ordem das listas já é a final (é o que a gravação no navegador produz).

EM PEDAÇOS (162)
----------------
A v162 entrega a MESMA resposta como uma lista de objetos, sem o envelope:

    [ {"row_count": N, "row_order": [...], "names": ..., ...}, {"group_key": [...]},
      {"spend": [...]}, ... ]

Montar o envelope dentro do banco custava ~11x o tamanho da resposta em memória
(medido em 16/09: 957 MB de pico com 55 MB de resposta, numa máquina de ~950 MB);
em pedaços, cada um vai para o disco assim que fica pronto. O pedaço de metadados é o
que tem `row_count`; os demais são blocos de colunas. A ordem dos pedaços não importa.
`from_parts` devolve o formato de cima, e o resto do leitor não muda.

O leitor do navegador (`frontend/lib/api/managerColumns.ts`) faz exatamente isto;
os dois são conferidos contra o mesmo fixture.
"""
from __future__ import annotations

from typing import Any, Dict, List


class ColumnarPayloadError(ValueError):
    """A resposta em colunas veio malformada — melhor falhar alto do que mostrar
    linhas trocadas (um campo deslocado casaria o gasto de um anúncio com o nome
    de outro, sem erro nenhum)."""


def from_parts(parts: List[Any]) -> Dict[str, Any]:
    """Resposta em pedaços (v162) -> o formato com `data_columns` (v161)."""
    metas = [p for p in parts if isinstance(p, dict) and "row_count" in p]
    if len(metas) != 1:
        raise ColumnarPayloadError(f"esperado 1 pedaço de metadados, vieram {len(metas)}")
    blocos = []
    for p in parts:
        if p is metas[0]:
            continue
        if not isinstance(p, dict):
            raise ColumnarPayloadError("pedaço da resposta não é objeto")
        blocos.append(p)
    out = dict(metas[0])
    if "data_columns" in out:
        raise ColumnarPayloadError("pedaço de metadados com data_columns")
    out["data_columns"] = blocos
    return out


def rows_from_columns(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    n = payload.get("row_count")
    if not isinstance(n, int) or n < 0:
        raise ColumnarPayloadError(f"row_count inválido: {n!r}")
    if n == 0:
        return []
    blocos = payload.get("data_columns")
    if not isinstance(blocos, list) or not blocos:
        raise ColumnarPayloadError("data_columns ausente com row_count > 0")

    campos: List[tuple] = []
    vistos: set = set()
    for bloco in blocos:
        if not isinstance(bloco, dict):
            raise ColumnarPayloadError("bloco de data_columns não é objeto")
        for nome, valores in bloco.items():
            if nome in vistos:
                raise ColumnarPayloadError(f"campo repetido entre blocos: {nome}")
            if not isinstance(valores, list) or len(valores) != n:
                tam = len(valores) if isinstance(valores, list) else type(valores).__name__
                raise ColumnarPayloadError(f"coluna {nome} com {tam} valores, esperado {n}")
            vistos.add(nome)
            campos.append((nome, valores))

    ordem = payload.get("row_order")
    if ordem is None:
        indices = range(n)
    else:
        if not isinstance(ordem, list) or len(ordem) != n:
            raise ColumnarPayloadError(f"row_order com tamanho errado (esperado {n})")
        indices = sorted(range(n), key=ordem.__getitem__)
    return [{nome: valores[i] for nome, valores in campos} for i in indices]


def as_row_payload(payload: Any) -> Dict[str, Any]:
    """A resposta em colunas (inteira ou em pedaços) no formato ANTIGO (`data` =
    lista de linhas).

    Para consumidores internos do backend que leem linhas (filhos de campanha) e
    para os diferenciais da 161/162.
    """
    if isinstance(payload, list):
        payload = from_parts(payload)
    if "data_columns" not in payload:
        return payload
    out = {k: v for k, v in payload.items() if k not in ("data_columns", "row_count", "row_order")}
    out["data"] = rows_from_columns(payload)
    return out
