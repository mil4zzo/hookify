"""
Janela de datas de um pack — o que pedir à Meta, sem I/O.

POR QUE EXISTE
--------------
Duas rotinas decidem "de que dia até que dia buscar" para um pack: a
atualização (`refresh_pack`) e, em breve, a edição do período. A regra estava
inline na rota e espelhada à mão no frontend (`refreshWindow.ts`); cada sutileza
nova (recuo pela janela de atribuição, início do pack sem recuo, fim do pack
fechado) tinha que ser caçada em dois lugares. Aqui ela mora uma vez, testável
sem banco e sem Meta. O frontend continua espelhando — este é o lado que vale.

A REGRA DO FIM (2026-09-17)
---------------------------
Um pack com "manter atualizado" DESLIGADO é um pack fechado: o período dele é
uma decisão do usuário, não uma âncora que anda. Até hoje toda atualização pedia
`até hoje` e o job gravava o fim do pack como o `until` da busca — o primeiro
"Atualizar pack" reabria o período em silêncio. Agora o `until` nunca passa de
`date_stop` num pack fechado. Com o toggle ligado, o fim acompanha o presente,
como antes.
"""
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any, Dict, Optional

from app.services.attribution_window import lookback_days_for_pack

REFRESH_TYPES = ("since_last_refresh", "full_period")


class RefreshWindowError(ValueError):
    """Pedido de atualização impossível de planejar (pack sem datas, range invertido)."""


@dataclass(frozen=True)
class RefreshWindow:
    since: str
    until: str
    lookback_days: int
    # O fim pedido foi limitado pelo fim do pack fechado (informativo — log/UI).
    clamped_to_stop: bool

    @property
    def time_range(self) -> Dict[str, str]:
        return {"since": self.since, "until": self.until}


def _parse_day(value: Any) -> Optional[date]:
    """'YYYY-MM-DD' ou ISO completo → date; None quando não dá para ler."""
    text = str(value or "")[:10]
    if not text:
        return None
    try:
        return date.fromisoformat(text)
    except ValueError:
        return None


def effective_until(pack: Dict[str, Any], requested_until: date) -> tuple[date, bool]:
    """Fim da busca: o pedido, limitado ao fim do pack quando ele é fechado.

    Devolve (until, clamped). Pack sem `date_stop` legível → o pedido, sem limite.
    """
    if pack.get("auto_refresh", False):
        return requested_until, False
    stop = _parse_day(pack.get("date_stop"))
    if stop is None or requested_until <= stop:
        return requested_until, False
    return stop, True


def plan_refresh_window(pack: Dict[str, Any], refresh_type: str, until_date: str) -> RefreshWindow:
    """Decide (since, until) de uma atualização.

    since_last_refresh: since = max(last_refreshed_at − recuo, date_start).
    full_period:        since = date_start, sem recuo.
    Nos dois: until = until_date, limitado a date_stop se o pack é fechado.

    Levanta RefreshWindowError com mensagem pronta para o usuário quando o
    pedido não faz sentido; a rota traduz em 400.
    """
    if refresh_type not in REFRESH_TYPES:
        raise RefreshWindowError("refresh_type deve ser 'since_last_refresh' ou 'full_period'")

    requested_until = _parse_day(until_date)
    if requested_until is None:
        raise RefreshWindowError(f"until_date inválido: '{until_date}'. Use formato YYYY-MM-DD.")

    pack_start = _parse_day(pack.get("date_start"))

    if refresh_type == "since_last_refresh":
        # Fallback em date_stop: packs legados criados antes de last_refreshed_at
        # ser preenchido na criação.
        anchor = _parse_day(pack.get("last_refreshed_at")) or _parse_day(pack.get("date_stop"))
        if anchor is None:
            raise RefreshWindowError(
                "Pack não tem last_refreshed_at configurado. Use 'full_period' para atualizar todo o período."
            )
        # Recuo = janela de atribuição do pack (migration 143): a Meta só atribui
        # a conversão ao dia se o clique estiver na janela pedida. Os dias do
        # recuo são reescritos por cima; o dado converge.
        lookback_days = lookback_days_for_pack(pack)
        since = anchor - timedelta(days=lookback_days)
        # Nunca antes do início do pack: o primeiro dia não leva recuo — é onde
        # o Gerenciador também começa (paridade conferida).
        if pack_start is not None:
            since = max(since, pack_start)
    else:
        lookback_days = 0
        if pack_start is None:
            raise RefreshWindowError("Pack não tem date_start configurado")
        since = pack_start
        if not pack.get("auto_refresh", False) and _parse_day(pack.get("date_stop")) is None:
            raise RefreshWindowError("Pack não tem date_stop configurado")

    until, clamped = effective_until(pack, requested_until)

    if since > until:
        raise RefreshWindowError(
            f"Range inválido: since ({since.isoformat()}) > until ({until.isoformat()})"
        )

    return RefreshWindow(
        since=since.isoformat(),
        until=until.isoformat(),
        lookback_days=lookback_days,
        clamped_to_stop=clamped,
    )
