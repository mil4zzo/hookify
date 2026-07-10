"""
Regressão da robustez do JobTracker sob drops transitórios de HTTP/2.

Contexto: refresh de 3 packs simultâneos compartilha o mesmo pool httpx (cliente
Supabase singleton). Sob multiplexação alta, o gateway envia GOAWAY e streams em
voo morrem com ConnectionTerminated -> httpx.RemoteProtocolError.

Antes, o `except Exception: return False` do heartbeat colapsava esse blip em
"lease perdido" e MATAVA o job ("Lease de processamento perdido durante
atualização de progresso"). Estes testes travam o novo contrato:

  - Falha transitória no UPDATE do heartbeat  -> retorna True (job segue).
  - Falha transitória no RPC de renovação     -> renew=None -> heartbeat True.
  - Lease genuinamente negado (renewed=False) -> heartbeat False (para de verdade).
  - Job cancelado por fora                      -> heartbeat False (para de verdade).
"""
import unittest
from types import SimpleNamespace
from unittest import mock

import httpx

from app.services.job_tracker import JobTracker, STATUS_PROCESSING, STATUS_CANCELLED


class _FakeResp:
    def __init__(self, data):
        self.data = data


class _Fluent:
    """Query builder falso: todo método encadeável retorna self; execute() delega."""

    def __init__(self, on_execute):
        self._on_execute = on_execute

    def __getattr__(self, _name):
        # select/update/upsert/insert/eq/in_/neq/ilike/order/limit/range -> self
        return lambda *a, **k: self

    def execute(self):
        return self._on_execute()


class _FakeSb:
    def __init__(self, table_execute=None, rpc_execute=None):
        self._table_execute = table_execute or (lambda: _FakeResp([]))
        self._rpc_execute = rpc_execute or (lambda: _FakeResp({"renewed": True}))

    def table(self, _name):
        return _Fluent(self._table_execute)

    def rpc(self, _name, _params=None):
        return _Fluent(self._rpc_execute)


def _raise_transient():
    raise httpx.RemoteProtocolError("<ConnectionTerminated error_code:1, last_stream_id:111>")


class TestJobTrackerHeartbeatResilience(unittest.TestCase):
    def setUp(self):
        # Sem sleeps reais entre retries do with_postgrest_retry.
        patcher = mock.patch("app.core.supabase_retry.time.sleep", return_value=None)
        self.addCleanup(patcher.stop)
        patcher.start()

    def _tracker(self, sb):
        t = JobTracker("jwt", "uid", processing_owner="owner-1")
        t._sb = sb  # bypass do lazy property
        return t

    def test_transient_update_failure_keeps_job_alive(self):
        """UPDATE do heartbeat falha transitório em todas as tentativas -> True."""
        sb = _FakeSb(table_execute=_raise_transient)
        t = self._tracker(sb)
        with mock.patch.object(t, "get_job", return_value={"status": STATUS_PROCESSING}), \
             mock.patch.object(t, "get_payload", return_value={}), \
             mock.patch.object(t, "renew_processing_claim", return_value=True):
            result = t.heartbeat("job-1", status=STATUS_PROCESSING, progress=100)
        self.assertTrue(result, "blip transitório no UPDATE não pode matar o job")

    def test_transient_renew_none_keeps_job_alive(self):
        """RPC de renovação falha transitório (None) -> heartbeat segue (True)."""
        sb = _FakeSb(table_execute=lambda: _FakeResp([{"id": "job-1"}]))
        t = self._tracker(sb)
        with mock.patch.object(t, "get_job", return_value={"status": STATUS_PROCESSING}), \
             mock.patch.object(t, "get_payload", return_value={}), \
             mock.patch.object(t, "renew_processing_claim", return_value=None):
            result = t.heartbeat("job-1", status=STATUS_PROCESSING, progress=100)
        self.assertTrue(result)

    def test_genuine_lease_loss_stops_job(self):
        """renew retorna False genuíno (outro worker assumiu) -> heartbeat False."""
        sb = _FakeSb()
        t = self._tracker(sb)
        with mock.patch.object(t, "get_job", return_value={"status": STATUS_PROCESSING}), \
             mock.patch.object(t, "get_payload", return_value={}), \
             mock.patch.object(t, "renew_processing_claim", return_value=False):
            result = t.heartbeat("job-1", status=STATUS_PROCESSING, progress=100)
        self.assertFalse(result, "lease genuinamente perdido deve parar o job")

    def test_cancelled_status_stops_job(self):
        """Job cancelado por fora -> heartbeat False (cancelamento cooperativo)."""
        sb = _FakeSb()
        t = self._tracker(sb)
        with mock.patch.object(t, "get_job", return_value={"status": STATUS_CANCELLED}), \
             mock.patch.object(t, "get_payload", return_value={}):
            result = t.heartbeat("job-1", status=STATUS_PROCESSING, progress=100)
        self.assertFalse(result)


class TestRenewProcessingClaimTriState(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch("app.core.supabase_retry.time.sleep", return_value=None)
        self.addCleanup(patcher.stop)
        patcher.start()

    def _tracker(self, rpc_execute):
        t = JobTracker("jwt", "uid", processing_owner="owner-1")
        t._sb = _FakeSb(rpc_execute=rpc_execute)
        return t

    def test_transient_returns_none(self):
        t = self._tracker(_raise_transient)
        self.assertIsNone(t.renew_processing_claim("job-1"))

    def test_genuine_denied_returns_false(self):
        t = self._tracker(lambda: _FakeResp({"renewed": False}))
        self.assertIs(t.renew_processing_claim("job-1"), False)

    def test_renewed_returns_true(self):
        t = self._tracker(lambda: _FakeResp({"renewed": True}))
        self.assertIs(t.renew_processing_claim("job-1"), True)

    def test_no_owner_returns_false(self):
        t = JobTracker("jwt", "uid", processing_owner=None)
        t._sb = _FakeSb()
        self.assertIs(t.renew_processing_claim("job-1"), False)


if __name__ == "__main__":
    unittest.main()
