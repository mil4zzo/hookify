# -*- coding: utf-8 -*-
"""Carimbo de validade do "este pack esta atualizando" (`packs.refresh_lock_until`).

CONTEXTO
--------
O selo de atualizacao no card do pack sempre veio de estado LOCAL do navegador,
preenchido pelo fluxo de refresh daquela aba. Num pack compartilhado os demais
membros ficavam cegos: o colega atualizava e eles viam o pack parado.

`packs.refresh_status` e do PACK (nao de quem disparou) e ja era gravado — mas
sozinho ele MENTE: ha caminhos que nunca escrevem o status final. Dois reais:
`JobProcessor.mark_failed` (job morre no meio) e o cancelamento em lote do
logout. Um pack ficaria 'running' para sempre e TODO membro veria selo eterno.

Dai o par status + prazo. Este arquivo trava:
- 'running' carimba o prazo; qualquer status terminal o limpa;
- o prazo vai gravado em UTC *naive* — a coluna e `timestamp` SEM timezone, e um
  offset seria descartado em silencio pelo Postgres;
- o cancelamento derruba o 'running' do pack, mas NUNCA sobrescreve um 'success'
  que ja tinha pousado (o `.eq("refresh_status", "running")` e a trava).
"""
from datetime import datetime, timedelta, timezone

import pytest

from app.services import supabase_repo


class _FakeQuery:
    """Registra `update(...).eq(...).eq(...).execute()` sem tocar em rede."""

    def __init__(self, log):
        self._log = log
        self._payload = None
        self._filters = {}

    def update(self, data):
        self._payload = data
        return self

    def eq(self, coluna, valor):
        self._filters[coluna] = valor
        return self

    def execute(self):
        self._log.append({"payload": self._payload, "filters": dict(self._filters)})
        return type("Res", (), {"data": [{"id": self._filters.get("id")}]})()


class _FakeClient:
    def __init__(self):
        self.calls = []

    def table(self, _nome):
        return _FakeQuery(self.calls)


def _chamar(status: str, actor_id=None) -> dict:
    sb = _FakeClient()
    supabase_repo.update_pack_refresh_status(
        None, "pack-1", "owner-1", refresh_status=status, actor_id=actor_id, sb_client=sb
    )
    assert len(sb.calls) == 1
    return sb.calls[0]["payload"]


def test_running_grava_quem_disparou():
    """O ator vai no MESMO update do status e do prazo — nenhuma ida extra ao banco."""
    payload = _chamar("running", actor_id="convidado-7")
    assert payload["refresh_actor_id"] == "convidado-7"


@pytest.mark.parametrize("status", ["success", "failed", "canceled"])
def test_status_terminal_limpa_quem_disparou(status):
    payload = _chamar(status, actor_id="convidado-7")
    assert payload["refresh_actor_id"] is None


def test_running_carimba_prazo_no_futuro():
    payload = _chamar("running")
    assert payload["refresh_status"] == "running"
    prazo = payload["refresh_lock_until"]
    assert prazo is not None

    agora = datetime.now(timezone.utc).replace(tzinfo=None)
    faltam = datetime.fromisoformat(prazo) - agora
    # Janela folgada so para absorver o tempo de execucao do teste.
    assert timedelta(minutes=supabase_repo.REFRESH_LOCK_TTL_MINUTES - 1) < faltam
    assert faltam <= timedelta(minutes=supabase_repo.REFRESH_LOCK_TTL_MINUTES)


def test_prazo_vai_sem_offset_de_timezone():
    """A coluna e `timestamp` SEM timezone: mandar "+00:00" faria o Postgres
    descartar o offset em silencio. Gravamos ja em UTC naive para que o valor
    guardado seja inequivoco — o frontend reanexa o "Z" ao ler."""
    prazo = _chamar("running")["refresh_lock_until"]
    assert "+" not in prazo and not prazo.endswith("Z")
    # E parseavel como naive (nao levanta e nao carrega tzinfo).
    assert datetime.fromisoformat(prazo).tzinfo is None


@pytest.mark.parametrize("status", ["success", "failed", "canceled", "idle"])
def test_status_terminal_limpa_o_prazo(status):
    payload = _chamar(status)
    assert payload["refresh_status"] == status
    assert "refresh_lock_until" in payload, "a chave precisa ir no update, senao o prazo velho fica"
    assert payload["refresh_lock_until"] is None


def test_cancelamento_so_derruba_pack_que_esta_running(monkeypatch):
    """Trava o `.eq("refresh_status", "running")`.

    Sem ele, um job que ja tinha CONCLUIDO (e portanto nao foi de fato cancelado)
    teria seu 'success' sobrescrito por 'canceled' — o pack passaria a mentir que
    o refresh foi abortado quando na verdade os dados chegaram.
    """
    sb = _FakeClient()
    monkeypatch.setattr(supabase_repo, "get_supabase_service", lambda: sb)

    limpos = supabase_repo.clear_pack_refresh_if_running("owner-1", ["pack-1", "pack-2"])

    assert limpos == 2
    assert len(sb.calls) == 2
    for chamada in sb.calls:
        assert chamada["payload"] == {
            "refresh_status": "canceled",
            "refresh_lock_until": None,
            "refresh_actor_id": None,
        }
        assert chamada["filters"]["user_id"] == "owner-1", "silo do DONO, nunca o de quem cancelou"
        assert chamada["filters"]["refresh_status"] == "running"


def test_cancelamento_ignora_pack_vazio_e_nao_quebra_no_erro(monkeypatch):
    """Best-effort: o prazo expira sozinho, entao falha aqui nao pode derrubar o
    cancelamento (que e o que o usuario pediu)."""
    class _Explode(_FakeClient):
        def table(self, _nome):
            raise RuntimeError("PostgREST fora do ar")

    monkeypatch.setattr(supabase_repo, "get_supabase_service", _Explode)
    assert supabase_repo.clear_pack_refresh_if_running("owner-1", ["pack-1"]) == 0
    assert supabase_repo.clear_pack_refresh_if_running("owner-1", ["", None]) == 0
