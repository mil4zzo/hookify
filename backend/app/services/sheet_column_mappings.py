# -*- coding: utf-8 -*-
"""Colunas vinculadas da planilha além do leadscore (migration 140).

Um VÍNCULO (`sheet_column_mappings`) diz: "a coluna N desta planilha entra no app com
este rótulo e este tipo". Três tipos, decisão de mão única:

- ``leadscore``: número com corte de MQL próprio (``config.mql_min``). Rende média,
  MQLs, % MQL e CPMQL — as mesmas quatro do leadscore V1, calculadas no cliente com
  as MESMAS funções.
- ``number``: média, mínimo, máximo, mediana.
- ``category``: distribuição de respostas (até CATEGORY_MAX_DISTINCT valores).

O que este módulo NÃO faz: guardar valor por lead. O importer agrega em histograma
``{valor: quantidade}`` por anúncio-dia e é isso que vai para ``ad_metrics.custom_hist``.
Ver documentation/plano-planilha-flexivel.md, seção 3 (decisões 4 a 13).
"""
from __future__ import annotations

import logging
import re
from collections import Counter
from typing import Any, Dict, Iterable, List, Optional, Sequence

logger = logging.getLogger(__name__)

KIND_LEADSCORE = "leadscore"
KIND_NUMBER = "number"
KIND_CATEGORY = "category"
KINDS: tuple[str, ...] = (KIND_LEADSCORE, KIND_NUMBER, KIND_CATEGORY)

# Acima disto a coluna não é categoria, é texto livre — e texto livre está fora do v1
# (LGPD + custo no read model). O mesmo teto vale na sugestão de tipo e na importação.
CATEGORY_MAX_DISTINCT = 20
# Uma resposta fechada cabe aqui; acima é texto livre disfarçado.
CATEGORY_MAX_LEN = 120
LABEL_MAX_LEN = 60
# Amostra máxima usada para sugerir/validar o tipo no save (linhas da planilha).
SAMPLE_MAX_ROWS = 200

MAPPING_SELECT = "id, integration_id, owner_id, column_index, column_name, label, kind, config, position, created_at, updated_at"

_WS_RE = re.compile(r"\s+")


class SheetColumnMappingError(ValueError):
    """Entrada de vínculo inválida (vira 400 na rota)."""


# ---------------------------------------------------------------------------
# Normalização de valores (decisão 9 do plano)
# ---------------------------------------------------------------------------

def parse_number(value: Any) -> Optional[float]:
    """Mesma leitura tolerante do leadscore: aceita '1.000,50' e '1,000.50'."""
    # import tardio: o importer também importa este módulo
    from app.services.ad_metrics_sheet_importer import _to_float_or_none

    try:
        return _to_float_or_none(value)
    except Exception:  # noqa: BLE001 - qualquer coisa que não vira número é inválida
        return None


def normalize_number(value: Any) -> Optional[str]:
    """Chave canônica do histograma para número.

    Inteiro fica inteiro (``"25"``), decimal até 6 casas sem zeros à direita
    (``"3.5"``). Coerente com o ``trim_scale`` que a RPC usa no leadscore V1: o mesmo
    valor nunca vira duas chaves ("80" e "80.0").
    """
    num = parse_number(value)
    if num is None or num != num or num in (float("inf"), float("-inf")):
        return None
    rounded = round(num, 6)
    if rounded == 0:
        return "0"
    if float(rounded).is_integer():
        return str(int(rounded))
    text = f"{rounded:.6f}".rstrip("0").rstrip(".")
    return text


def normalize_category(value: Any) -> Optional[str]:
    """Chave canônica para categoria: trim + colapso de espaços internos; caixa preservada."""
    if value is None:
        return None
    text = _WS_RE.sub(" ", str(value)).strip()
    if not text or len(text) > CATEGORY_MAX_LEN:
        return None
    return text


def normalize_value(kind: str, value: Any) -> Optional[str]:
    if kind in (KIND_LEADSCORE, KIND_NUMBER):
        return normalize_number(value)
    if kind == KIND_CATEGORY:
        return normalize_category(value)
    return None


def _is_blank(value: Any) -> bool:
    return value is None or str(value).strip() == ""


# ---------------------------------------------------------------------------
# Sugestão e validação de tipo a partir de amostras
# ---------------------------------------------------------------------------

def classify_samples(values: Iterable[Any]) -> Dict[str, Any]:
    """Olha as células não vazias e diz o que a coluna parece ser.

    Retorna ``{"suggested": "number"|"category"|"text"|None, "non_empty", "numeric",
    "distinct"}``. ``None`` quando não há célula preenchida (não dá para dizer).
    """
    non_empty = [v for v in values if not _is_blank(v)]
    if not non_empty:
        return {"suggested": None, "non_empty": 0, "numeric": 0, "distinct": 0}
    numeric = sum(1 for v in non_empty if normalize_number(v) is not None)
    distinct = len({normalize_category(v) for v in non_empty if normalize_category(v) is not None})
    if numeric == len(non_empty):
        suggested = KIND_NUMBER
    elif distinct <= CATEGORY_MAX_DISTINCT:
        suggested = KIND_CATEGORY
    else:
        suggested = "text"
    return {"suggested": suggested, "non_empty": len(non_empty), "numeric": numeric, "distinct": distinct}


def validate_kind_against_samples(kind: str, values: Sequence[Any]) -> Optional[str]:
    """Motivo de recusa (texto para o usuário) ou None quando o tipo cabe na amostra.

    Amostra vazia não recusa: a planilha pode estar começando. A recusa é só para o
    que a amostra PROVA que não funciona.
    """
    info = classify_samples(values)
    if info["non_empty"] == 0:
        return None
    if kind in (KIND_LEADSCORE, KIND_NUMBER):
        if info["numeric"] < info["non_empty"]:
            bad = info["non_empty"] - info["numeric"]
            return (
                f"{bad} de {info['non_empty']} células preenchidas não são números. "
                "Uma coluna numérica precisa de números em todas as células preenchidas."
            )
        return None
    if kind == KIND_CATEGORY:
        if info["distinct"] > CATEGORY_MAX_DISTINCT:
            return (
                f"Esta coluna tem {info['distinct']} respostas diferentes na amostra; categoria "
                f"aceita até {CATEGORY_MAX_DISTINCT}. Texto livre ainda não é suportado."
            )
        return None
    return f"Tipo desconhecido: {kind}"


# ---------------------------------------------------------------------------
# Entrada das rotas
# ---------------------------------------------------------------------------

def clean_label(label: Any) -> str:
    text = _WS_RE.sub(" ", str(label or "")).strip()
    if not text:
        raise SheetColumnMappingError("Dê um nome à coluna (rótulo).")
    if len(text) > LABEL_MAX_LEN:
        raise SheetColumnMappingError(f"O rótulo pode ter até {LABEL_MAX_LEN} caracteres.")
    return text


def clean_kind(kind: Any) -> str:
    text = str(kind or "").strip().lower()
    if text not in KINDS:
        raise SheetColumnMappingError(
            "Tipo inválido. Use 'leadscore' (número com corte de MQL), 'number' ou 'category'."
        )
    return text


def clean_config(kind: str, mql_min: Any) -> Dict[str, Any]:
    """``config`` canônico por tipo. Leadscore exige corte; os outros ignoram."""
    if kind == KIND_LEADSCORE:
        if mql_min is None or _is_blank(mql_min):
            raise SheetColumnMappingError("Uma coluna do tipo leadscore precisa do leadscore mínimo para MQL.")
        num = parse_number(mql_min)
        if num is None or num < 0:
            raise SheetColumnMappingError("O leadscore mínimo para MQL precisa ser um número maior ou igual a zero.")
        return {"mql_min": round(float(num), 6)}
    return {}


def serialize(row: Dict[str, Any]) -> Dict[str, Any]:
    """Forma pública de um vínculo (o que o frontend recebe)."""
    config = row.get("config") if isinstance(row.get("config"), dict) else {}
    return {
        "id": str(row.get("id")),
        "integration_id": str(row.get("integration_id")),
        "column_index": int(row.get("column_index") or 0),
        "column_name": str(row.get("column_name") or ""),
        "label": str(row.get("label") or ""),
        "kind": str(row.get("kind") or ""),
        "config": config,
        "position": int(row.get("position") or 0),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


# ---------------------------------------------------------------------------
# Leitura
# ---------------------------------------------------------------------------

def list_for_integrations(sb: Any, integration_ids: Sequence[str]) -> Dict[str, List[Dict[str, Any]]]:
    """``{integration_id: [vínculos ordenados por position]}``. Vazio quando não há.

    ``sb`` pode ser o cliente do usuário (RLS: só o próprio silo) ou o service role
    (packs compartilhados: o vínculo vive no silo do dono).
    """
    ids = [str(i) for i in integration_ids if i]
    if not ids:
        return {}
    out: Dict[str, List[Dict[str, Any]]] = {}
    # .in_() com muitos ids estoura a URL (memória supabase_in_clause_url_limit): lotes.
    for start in range(0, len(ids), 200):
        chunk = ids[start:start + 200]
        try:
            res = (
                sb.table("sheet_column_mappings")
                .select(MAPPING_SELECT)
                .in_("integration_id", chunk)
                .order("position")
                .order("created_at")
                .execute()
            )
        except Exception as e:  # noqa: BLE001
            logger.warning("[SHEET_COLUMNS] Falha ao listar vínculos: %s", e)
            continue
        for row in (res.data or []):
            if not isinstance(row, dict):
                continue
            out.setdefault(str(row.get("integration_id")), []).append(serialize(row))
    return out


def attach_to_integrations(sb: Any, integrations: Iterable[Dict[str, Any]]) -> None:
    """Põe ``column_mappings`` em cada integração (lista vazia quando não há)."""
    rows = [i for i in integrations if isinstance(i, dict) and i.get("id")]
    by_id = list_for_integrations(sb, [str(i["id"]) for i in rows])
    for integration in rows:
        integration["column_mappings"] = by_id.get(str(integration["id"]), [])


# ---------------------------------------------------------------------------
# Histogramas por anúncio-dia (usado pelo importer)
# ---------------------------------------------------------------------------

class HistogramCollector:
    """Acumula, por (anúncio, dia), o histograma de cada vínculo.

    Também vigia o teto de categorias no conjunto INTEIRO da planilha: uma coluna
    que passa de CATEGORY_MAX_DISTINCT valores distintos é invalidada por completo
    (o histograma dela sai de todas as linhas) e reportada — nunca aborta o sync.
    """

    def __init__(self, mappings: Sequence[Dict[str, Any]]):
        self.mappings = [m for m in mappings if isinstance(m, dict) and m.get("kind") in KINDS]
        self._hist: Dict[tuple, Dict[str, Counter]] = {}
        self.values_count: Dict[str, int] = {str(m["id"]): 0 for m in self.mappings}
        self.skipped_count: Dict[str, int] = {str(m["id"]): 0 for m in self.mappings}
        self._distinct: Dict[str, set] = {
            str(m["id"]): set() for m in self.mappings if m.get("kind") == KIND_CATEGORY
        }

    @property
    def enabled(self) -> bool:
        return bool(self.mappings)

    def add_row(self, key: tuple, row: Sequence[Any]) -> None:
        if not self.mappings:
            return
        per_key = self._hist.setdefault(key, {})
        for m in self.mappings:
            mid = str(m["id"])
            idx = m.get("column_index")
            raw = row[idx] if isinstance(idx, int) and 0 <= idx < len(row) else None
            if _is_blank(raw):
                continue
            norm = normalize_value(str(m["kind"]), raw)
            if norm is None:
                self.skipped_count[mid] += 1
                continue
            if mid in self._distinct:
                self._distinct[mid].add(norm)
            per_key.setdefault(mid, Counter())[norm] += 1
            self.values_count[mid] += 1

    def invalid_mappings(self) -> Dict[str, str]:
        """``{mapping_id: motivo}`` das colunas que não podem entrar."""
        out: Dict[str, str] = {}
        for mid, distinct in self._distinct.items():
            if len(distinct) > CATEGORY_MAX_DISTINCT:
                out[mid] = (
                    f"{len(distinct)} respostas diferentes (teto: {CATEGORY_MAX_DISTINCT}); "
                    "coluna ignorada neste sync"
                )
        return out

    def histogram_for(self, key: tuple, invalid: Dict[str, str]) -> Dict[str, Dict[str, int]]:
        """Objeto completo da linha: ``{mapping_id: {valor: qtd}}`` sem as colunas inválidas.

        Vazio (``{}``) quando a linha não tem valor nenhum: o RPC grava NULL, e é assim
        que um vínculo excluído some da linha no próximo sync (decisão 11 do plano).
        """
        per_key = self._hist.get(key) or {}
        return {
            mid: dict(counter)
            for mid, counter in per_key.items()
            if mid not in invalid and counter
        }

    def report(self) -> Dict[str, Dict[str, Any]]:
        invalid = self.invalid_mappings()
        out: Dict[str, Dict[str, Any]] = {}
        for m in self.mappings:
            mid = str(m["id"])
            out[mid] = {
                "label": m.get("label"),
                "kind": m.get("kind"),
                "values": self.values_count.get(mid, 0),
                "skipped": self.skipped_count.get(mid, 0),
                "invalid_reason": invalid.get(mid),
            }
        return out
