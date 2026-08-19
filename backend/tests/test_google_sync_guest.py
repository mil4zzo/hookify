# -*- coding: utf-8 -*-
"""P3.3b — sync de planilha em contexto de DONO quando disparado por membro.

A credencial Google e SEMPRE a do dono da integracao (decisao travada). A
convencao do pipeline: user_jwt=None => service role + silo explicito. O gate
de acesso deriva da PROPRIA integracao (pack_id -> assert_pack_role), nunca de
parametro do cliente.
"""
import unittest
from unittest import mock

from fastapi import HTTPException

from app.services.pack_access import PackAccess


class _FakeResp:
    def __init__(self, data):
        self.data = data


class _Fluent:
    def __init__(self, on_execute):
        self._on_execute = on_execute

    def __getattr__(self, name):
        def _chain(*args, **kwargs):
            return self

        return _chain

    def execute(self):
        return self._on_execute()


class _FakeSb:
    def __init__(self, responses):
        self._responses = responses

    def table(self, name):
        return _Fluent(self._responses.get(name, lambda: _FakeResp([])))


class TestStartSyncJobGuest(unittest.TestCase):
    def _call(self, *, own_rows, svc_rows, gate=None):
        from app.routes.google_integration import start_sync_job

        own_sb = _FakeSb({"ad_sheet_integrations": lambda: _FakeResp(own_rows)})
        svc_sb = _FakeSb({"ad_sheet_integrations": lambda: _FakeResp(svc_rows)})
        gate_mock = mock.Mock(side_effect=gate) if gate else mock.Mock(
            return_value=PackAccess(role="viewer", owner_id="owner-1")
        )
        bg = mock.Mock()

        with mock.patch("app.routes.google_integration.get_supabase_for_user", return_value=own_sb), \
             mock.patch("app.routes.google_integration.get_supabase_service", return_value=svc_sb), \
             mock.patch("app.routes.google_integration.assert_pack_role", gate_mock), \
             mock.patch("app.routes.google_integration.create_sync_job", return_value="job-1") as create_sync:
            result = start_sync_job("integ-1", bg, user={"token": "jwt", "user_id": "guest-9"})
        return result, create_sync, gate_mock, bg

    def test_dono_caminho_proprio_inalterado(self) -> None:
        """Integracao do proprio ator: JWT real, silo proprio, sem gate."""
        result, create_sync, gate, bg = self._call(
            own_rows=[{"id": "integ-1", "owner_id": "guest-9"}], svc_rows=[]
        )
        self.assertEqual(result["job_id"], "job-1")
        gate.assert_not_called()
        create_sync.assert_called_once_with(user_jwt="jwt", user_id="guest-9", integration_id="integ-1")

    def test_membro_dispara_sync_do_dono(self) -> None:
        """Integracao alheia de pack com grant: gate consultado; job criado no
        silo do DONO com user_jwt=None (service role)."""
        result, create_sync, gate, bg = self._call(
            own_rows=[],
            svc_rows=[{"id": "integ-1", "owner_id": "owner-1", "pack_id": "pack-1"}],
        )
        self.assertEqual(result["job_id"], "job-1")
        gate.assert_called_once_with("guest-9", "pack-1", roles=("dono", "editor", "viewer"))
        create_sync.assert_called_once_with(user_jwt=None, user_id="owner-1", integration_id="integ-1")
        # o background task recebe o MESMO contexto de dono
        _, kwargs = bg.add_task.call_args
        self.assertIsNone(kwargs["user_jwt"])
        self.assertEqual(kwargs["user_id"], "owner-1")

    def test_sem_grant_e_404(self) -> None:
        with self.assertRaises(HTTPException) as ctx:
            self._call(
                own_rows=[],
                svc_rows=[{"id": "integ-1", "owner_id": "owner-1", "pack_id": "pack-1"}],
                gate=HTTPException(status_code=404, detail="Pack nao encontrado"),
            )
        self.assertEqual(ctx.exception.status_code, 404)

    def test_integracao_sem_pack_e_invisivel(self) -> None:
        """Integracao alheia GLOBAL (sem pack): nao ha grant possivel -> 404."""
        with self.assertRaises(HTTPException) as ctx:
            self._call(own_rows=[], svc_rows=[{"id": "integ-1", "owner_id": "owner-1", "pack_id": None}])
        self.assertEqual(ctx.exception.status_code, 404)


class TestSyncJobPollingSilo(unittest.TestCase):
    def _poll(self, *, actor_id, job_rows, integ_rows=None):
        from app.routes.google_integration import get_sync_job_progress

        tracker = mock.Mock()
        tracker.get_public_progress.return_value = {"status": "completed"}
        tracker.get_job.return_value = {"payload": {}}
        svc = _FakeSb({
            "jobs": lambda: _FakeResp(job_rows),
            "ad_sheet_integrations": lambda: _FakeResp(integ_rows or []),
        })
        gate = mock.Mock(return_value=PackAccess(role="viewer", owner_id="owner-1"))

        with mock.patch("app.routes.google_integration.get_supabase_service", return_value=svc), \
             mock.patch("app.routes.google_integration.assert_pack_role", gate), \
             mock.patch("app.routes.google_integration.get_job_tracker", return_value=tracker) as get_tracker:
            result = get_sync_job_progress("job-1", user={"token": "jwt", "user_id": actor_id})
        return result, gate, get_tracker

    def test_job_proprio_sem_gate(self) -> None:
        result, gate, get_tracker = self._poll(
            actor_id="owner-1", job_rows=[{"user_id": "owner-1", "payload": {}}]
        )
        self.assertEqual(result["status"], "completed")
        gate.assert_not_called()
        get_tracker.assert_called_once_with("jwt", "owner-1", use_service_role=False)

    def test_job_do_dono_polado_por_membro(self) -> None:
        result, gate, get_tracker = self._poll(
            actor_id="guest-9",
            job_rows=[{"user_id": "owner-1", "payload": {"integration_id": "integ-1"}}],
            integ_rows=[{"pack_id": "pack-1"}],
        )
        self.assertEqual(result["status"], "completed")
        gate.assert_called_once_with("guest-9", "pack-1", roles=("dono", "editor", "viewer"))
        get_tracker.assert_called_once_with("jwt", "owner-1", use_service_role=True)

    def test_job_alheio_sem_integracao_e_404(self) -> None:
        with self.assertRaises(HTTPException) as ctx:
            self._poll(actor_id="guest-9", job_rows=[{"user_id": "owner-1", "payload": {}}])
        self.assertEqual(ctx.exception.status_code, 404)


if __name__ == "__main__":
    unittest.main()
