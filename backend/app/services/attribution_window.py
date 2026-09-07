"""
Janela de atribuição do pack — de onde vem o recuo do refresh incremental.

POR QUE EXISTE
--------------
O /insights da Meta data a conversão pelo dia em que ela aconteceu, mas só a
conta se o clique que a originou estiver DENTRO da janela consultada. Um refresh
que pede "ontem → hoje" perde toda conversão de hoje cujo clique foi há 2..7 dias
— e o dia gravado nunca mais é relido, então a perda é permanente. Medido em
2026-09-06: pré-matrícula (converte dias depois do clique) 14,5% abaixo do
Gerenciador; captura de evento (converte na hora) 0,19%.

O tamanho certo do recuo é a própria janela de atribuição da conta, que a Meta
devolve por linha no campo `attribution_setting` (`1d_view_7d_click`, `7d_click`,
`1d_click`, `1d_ev_7d_click`, ...). O maior número de dias que aparece nas linhas
do pack é o recuo; fica gravado em `packs.attribution_window_days` (migration
143) e o refresh seguinte usa. Pack sem valor (ainda não calibrado) usa o teto
atual da Meta — 7 dias de clique — que é seguro por construção.

POR QUE NÃO 7 FIXO
------------------
Cliente com janela de 1 dia pagaria 4x de leitura todo dia sem ganhar nada
(1.645 → 6.585 linhas na consulta diária medida). O valor é do pack porque a
janela é do conjunto de anúncios, não da conta.
"""
import re
from typing import Any, Dict, Iterable, Optional, Tuple

# Teto atual da Meta: 7 dias de clique (28d saiu em 2021 com o iOS 14; 7d/28d
# de view saíram da API em jan/2026). É o que um pack ainda não calibrado usa.
DEFAULT_ATTRIBUTION_WINDOW_DAYS = 7

# Guarda contra um valor patológico (campo mal formado, mudança futura da Meta):
# o recuo nunca passa disto, aconteça o que acontecer com o attribution_setting.
MAX_ATTRIBUTION_WINDOW_DAYS = 28

_DAYS_RE = re.compile(r"(\d+)d")


def parse_attribution_setting_days(setting: Any) -> Optional[int]:
    """Maior número de dias num `attribution_setting` da Meta.

    `1d_view_7d_click` → 7; `1d_click` → 1; `7d_click` → 7. Devolve None quando
    o valor não tem nenhum `<N>d` reconhecível (vazio, 'default', 'skan', ...):
    quem chama decide o fallback — aqui não se inventa número.
    """
    if not isinstance(setting, str) or not setting:
        return None
    found = [int(m) for m in _DAYS_RE.findall(setting)]
    return max(found) if found else None


def max_attribution_window(rows: Iterable[Dict[str, Any]]) -> Tuple[Optional[int], Optional[str]]:
    """Maior janela entre as linhas de um relatório e o setting cru que a originou.

    Linhas sem `attribution_setting` (ex.: linhas-zero sintéticas do inventário)
    são ignoradas. (None, None) quando nenhuma linha trouxe um valor legível.
    """
    best_days: Optional[int] = None
    best_setting: Optional[str] = None
    for row in rows or []:
        setting = row.get("attribution_setting") if isinstance(row, dict) else None
        days = parse_attribution_setting_days(setting)
        if days is None:
            continue
        # Empate no número de dias (ex.: '7d_click' e '1d_view_7d_click' num mesmo
        # pack): fica o setting mais completo, que é o que a UI mostra.
        if best_days is None or days > best_days or (days == best_days and len(setting) > len(best_setting or "")):
            best_days, best_setting = days, setting
    return best_days, best_setting


def lookback_days_for_pack(pack: Optional[Dict[str, Any]]) -> int:
    """Recuo do refresh incremental para este pack.

    NULL/inválido → teto atual da Meta (7). Qualquer valor é limitado a
    [1, MAX_ATTRIBUTION_WINDOW_DAYS].
    """
    raw = (pack or {}).get("attribution_window_days")
    try:
        days = int(raw) if raw is not None else DEFAULT_ATTRIBUTION_WINDOW_DAYS
    except (TypeError, ValueError):
        days = DEFAULT_ATTRIBUTION_WINDOW_DAYS
    if days < 1:
        days = DEFAULT_ATTRIBUTION_WINDOW_DAYS
    return min(days, MAX_ATTRIBUTION_WINDOW_DAYS)
