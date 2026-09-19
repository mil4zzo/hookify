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
from typing import Any, Dict, Optional, Tuple

from app.services.attribution_window import lookback_days_for_pack

# "window_edit" = edição do período do pack: a busca é a fatia que o período novo
# pede (ver plan_window_edit) e, no fim do job, as datas do pack passam a ser as
# novas — só se a coleta chegou completa.
REFRESH_TYPES = ("since_last_refresh", "full_period", "window_edit")
WINDOW_EDIT = "window_edit"


class RefreshWindowError(ValueError):
    """Pedido de atualização impossível de planejar (pack sem datas, range invertido)."""


@dataclass(frozen=True)
class WindowEditPlan:
    """O que a edição de período pede à Meta e o que muda no pack.

    `fetch` é UMA fatia (since, until) — ou None quando só se encurta o fim, caso
    em que não há nada a pedir à Meta e a rota resolve no banco. Os campos de
    redução (`delete_before`, `delete_after`, `head`) dizem o que sai do pack.
    """
    new_start: str
    new_stop: str
    fetch: Optional[Tuple[str, str]]
    lookback_days: int
    # Etapa 2 — reduzir:
    delete_before: Optional[str]   # apaga dias < delete_before (= new_start)
    delete_after: Optional[str]    # apaga dias > delete_after (= new_stop)
    head: Optional[Tuple[str, str]]  # dias em que "ausente na resposta" = sai do pack
    # Terminar antes de hoje fecha o pack (desliga "manter atualizado").
    auto_refresh_off: bool

    @property
    def reduces(self) -> bool:
        return self.delete_before is not None or self.delete_after is not None

    def as_payload(self) -> Dict[str, Any]:
        """Forma gravada no payload do job — o que o fim do job aplica no pack."""
        return {
            "date_start": self.new_start,
            "date_stop": self.new_stop,
            "auto_refresh_off": self.auto_refresh_off,
            "head": list(self.head) if self.head else None,
            "delete_before": self.delete_before,
            "delete_after": self.delete_after,
        }


@dataclass(frozen=True)
class RefreshWindow:
    since: str
    until: str
    lookback_days: int
    # O fim pedido foi limitado pelo fim do pack fechado (informativo — log/UI).
    clamped_to_stop: bool
    # Só em refresh_type = "window_edit".
    window_edit: Optional[WindowEditPlan] = None

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


def plan_window_edit(pack: Dict[str, Any], new_start_str: str, new_stop_str: str, today_str: str) -> WindowEditPlan:
    """Decide a fatia a buscar (e, na Etapa 2, o que apagar) para um período novo.

    A regra da borda, medida em 2026-09-07 no caminho de produção: a Meta só
    atribui a conversão ao dia se o CLIQUE estiver dentro da janela pedida. Então
    todo dia gravado pela primeira vez precisa de N dias de história antes dele
    na consulta — exceto o início do pack, que é onde o Gerenciador também começa.

    Com pack 01/07 → 31/08 e N = 7:
      começar antes  (01/06): busca 01/06 → 07/07  (os 7 primeiros dias antigos
                              estavam sem os cliques de junho; são regravados)
      terminar depois (15/09): busca 25/08 → 15/09  (o primeiro dia novo, 01/09,
                              precisa de 25/08 em cena)
      começar depois (15/07): busca 15/07 → 21/07 e apaga < 15/07; nesses 7 dias,
                              par ausente na resposta sai do pack (Etapa 2)
      terminar antes (15/08): apaga > 15/08, sem busca (Etapa 2)
    Duas pontas se movendo: UMA busca cobrindo a união das fatias.
    """
    new_start = _parse_day(new_start_str)
    new_stop = _parse_day(new_stop_str)
    today = _parse_day(today_str)
    if new_start is None or new_stop is None:
        raise RefreshWindowError("Datas inválidas. Use formato YYYY-MM-DD.")
    if today is None:
        raise RefreshWindowError(f"until_date inválido: '{today_str}'. Use formato YYYY-MM-DD.")
    if new_start > new_stop:
        raise RefreshWindowError("A data inicial não pode ser depois da data final.")
    if new_stop > today:
        raise RefreshWindowError("A data final não pode estar no futuro.")

    old_start = _parse_day(pack.get("date_start"))
    old_stop = _parse_day(pack.get("date_stop"))
    if old_start is None or old_stop is None:
        raise RefreshWindowError("Pack sem período definido; use 'full_period'.")
    if new_start == old_start and new_stop == old_stop:
        raise RefreshWindowError("O período informado é o mesmo que o pack já tem.")

    n = lookback_days_for_pack(pack)
    slices: list[Tuple[date, date]] = []
    delete_before: Optional[date] = None
    delete_after: Optional[date] = None
    head: Optional[Tuple[date, date]] = None

    if new_start < old_start:
        # Emenda: os N primeiros dias antigos ganham os cliques do período novo.
        slices.append((new_start, min(old_start + timedelta(days=n - 1), new_stop)))
    elif new_start > old_start:
        delete_before = new_start
        head = (new_start, min(new_start + timedelta(days=n - 1), new_stop))
        slices.append(head)

    if new_stop > old_stop:
        # O primeiro dia novo (old_stop + 1) precisa de N dias de clique em cena.
        slices.append((max(old_stop + timedelta(days=1 - n), new_start), new_stop))
    elif new_stop < old_stop:
        delete_after = new_stop

    fetch: Optional[Tuple[str, str]] = None
    if slices:
        since = min(s for s, _ in slices)
        until = max(u for _, u in slices)
        fetch = (since.isoformat(), until.isoformat())

    return WindowEditPlan(
        new_start=new_start.isoformat(),
        new_stop=new_stop.isoformat(),
        fetch=fetch,
        lookback_days=n,
        delete_before=delete_before.isoformat() if delete_before else None,
        delete_after=delete_after.isoformat() if delete_after else None,
        head=(head[0].isoformat(), head[1].isoformat()) if head else None,
        auto_refresh_off=new_stop < today,
    )


def plan_refresh_window(
    pack: Dict[str, Any],
    refresh_type: str,
    until_date: str,
    *,
    date_start: Optional[str] = None,
    date_stop: Optional[str] = None,
) -> RefreshWindow:
    """Decide (since, until) de uma atualização.

    since_last_refresh: since = max(last_refreshed_at − recuo, date_start).
    full_period:        since = date_start, sem recuo.
    Nos dois: until = until_date, limitado a date_stop se o pack é fechado.
    window_edit:        a fatia de plan_window_edit(date_start, date_stop);
                        `until_date` é o "hoje" do cliente.

    Levanta RefreshWindowError com mensagem pronta para o usuário quando o
    pedido não faz sentido; a rota traduz em 400.
    """
    if refresh_type not in REFRESH_TYPES:
        raise RefreshWindowError("refresh_type deve ser 'since_last_refresh', 'full_period' ou 'window_edit'")

    requested_until = _parse_day(until_date)
    if requested_until is None:
        raise RefreshWindowError(f"until_date inválido: '{until_date}'. Use formato YYYY-MM-DD.")

    if refresh_type == WINDOW_EDIT:
        if not date_start or not date_stop:
            raise RefreshWindowError("Edição de período exige date_start e date_stop.")
        plan = plan_window_edit(pack, date_start, date_stop, until_date)
        # Só redução (encurtar o fim): não há o que pedir à Meta. `since`/`until`
        # ficam sendo a janela nova — a rota vê `window_edit.fetch is None` e
        # resolve no banco, sem abrir relatório.
        since_str, until_str = plan.fetch or (plan.new_start, plan.new_stop)
        return RefreshWindow(
            since=since_str,
            until=until_str,
            lookback_days=plan.lookback_days,
            clamped_to_stop=False,
            window_edit=plan,
        )

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
