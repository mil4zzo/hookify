"""Sondagem da coluna de data no wizard de integração com o Sheets.

POR QUE EXISTE
--------------
Duas perguntas que hoje só se respondem depois do sync, tarde demais:

1. **O formato está certo?** Escolher DD/MM quando a planilha é MM/DD não dá
   erro: dias 13–31 viram mês inválido e são descartados, mas os dias 1–12
   parseiam e vão para o DIA ERRADO, em silêncio. `05/03` lido como MM/DD vira
   3 de maio em vez de 5 de março. É corrupção silenciosa, não falha.

2. **A planilha tem a ver com este pack?** Uma planilha cujo período não cruza
   o do pack não atualiza nada — e antes disso ser um aviso, saía como
   "Importação concluída com sucesso".

A DEDUÇÃO DO FORMATO NÃO É UM CHUTE
-----------------------------------
É uma prova por contradição, com um "não sei" bem definido:

  primeiro numero > 12 em alguma linha  => só pode ser dia  => DD/MM provado
  segundo  numero > 12 em alguma linha  => só pode ser dia  => MM/DD provado
  os dois aparecem                      => a coluna não é uniformemente nenhum
  nenhum aparece                        => ambíguo de verdade (toda data cai
                                           entre os dias 1 e 12)

Só o último caso deixa o seletor neutro, e ele é raro: exige que NENHUMA data
da coluna caia depois do dia 12.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

# _parse_date é o parser do importador de propósito: a sonda precisa prever o
# que o sync fará, não dar um segundo parecer. Duas implementações divergiriam
# com o tempo e a sonda passaria a mentir.
from app.services.ad_metrics_sheet_importer import _parse_date

logger = logging.getLogger(__name__)

DD_MM = "DD/MM/YYYY"
MM_DD = "MM/DD/YYYY"

# Amostra de células ilegíveis devolvida para o tooltip explicar o problema.
_MAX_SAMPLES = 3


def _split_numeric_date(raw: str) -> Optional[tuple[int, int]]:
    """Extrai (primeiro, segundo) de um 'a/b/c'. None quando não tem essa forma.

    Só olha a parte antes do espaço (a planilha costuma trazer hora junto) e só
    aceita barra — que é o único separador que o parser do sync entende.
    """
    text = " ".join(str(raw).split()).strip()
    if not text:
        return None
    date_part = text.split()[0]
    parts = date_part.split("/")
    if len(parts) != 3:
        return None
    try:
        first, second = int(parts[0]), int(parts[1])
    except ValueError:
        return None
    if not (1 <= first <= 31) or not (1 <= second <= 31):
        return None
    return first, second


def analyze_date_column(values: List[str]) -> Dict[str, Any]:
    """Lê a coluna e devolve o veredito de formato + a janela de datas.

    `format_verdict`:
      "DD/MM/YYYY" | "MM/DD/YYYY" — provado pelos dados
      "ambiguous"   — toda data cai entre os dias 1 e 12; impossível decidir
      "conflicting" — há evidência dos dois; a coluna mistura formatos
      "unreadable"  — nenhuma célula tem a forma a/b/c (ISO, outro separador,
                      ou simplesmente não é uma coluna de data)
      "empty"       — a coluna não tem nenhuma célula preenchida
    """
    non_empty: List[str] = [v for v in values if str(v).strip()]
    total_cells = len(values)

    evidence_dd_mm = 0   # primeiro componente > 12
    evidence_mm_dd = 0   # segundo componente > 12
    shaped = 0           # células com a forma a/b/c
    unparseable_samples: List[str] = []

    for raw in non_empty:
        pair = _split_numeric_date(raw)
        if pair is None:
            if len(unparseable_samples) < _MAX_SAMPLES:
                unparseable_samples.append(str(raw).strip()[:40])
            continue
        shaped += 1
        first, second = pair
        if first > 12:
            evidence_dd_mm += 1
        if second > 12:
            evidence_mm_dd += 1

    if not non_empty:
        # Coluna vazia e coluna ilegivel pedem mensagens diferentes: "essa coluna
        # esta vazia" x "essa coluna nao parece ter datas".
        verdict = "empty"
    elif shaped == 0:
        verdict = "unreadable"
    elif evidence_dd_mm and evidence_mm_dd:
        verdict = "conflicting"
    elif evidence_dd_mm:
        verdict = DD_MM
    elif evidence_mm_dd:
        verdict = MM_DD
    else:
        verdict = "ambiguous"

    result: Dict[str, Any] = {
        "total_cells": total_cells,
        "non_empty_cells": len(non_empty),
        "format_verdict": verdict,
        "evidence_dd_mm": evidence_dd_mm,
        "evidence_mm_dd": evidence_mm_dd,
        "unparseable_samples": unparseable_samples,
        "resolved_format": verdict if verdict in (DD_MM, MM_DD) else None,
        "readable_cells": 0,
        "date_min": None,
        "date_max": None,
    }

    # Janela de datas: só faz sentido com um formato decidido — com o formato
    # errado o min/max sairia deslocado e enganaria mais do que ajudaria.
    fmt = result["resolved_format"]
    if fmt:
        parsed = [d for d in (_parse_date(v, fmt) for v in non_empty) if d]
        result["readable_cells"] = len(parsed)
        if parsed:
            result["date_min"] = min(parsed)
            result["date_max"] = max(parsed)

    return result
