# -*- coding: utf-8 -*-
"""P3.3 — polling de job por SILO, não por ator.

O job de refresh vive no silo do DONO do pack. Quem faz polling pode ser um
convidado (que pode nem ter Meta conectada). O endpoint precisa:

- localizar o job sem assumir ator == dono;
- se o silo é alheio, exigir acesso ao pack do payload (404 sem acesso — não
  confirmar a existência de job alheio);
- criar o tracker no silo do job (service role quando alheio);
- NUNCA exigir conexão Facebook do ator (a dependency get_graph_api saiu).
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


def _completed_tracker() -> mock.Mock:
    tracker = mock.Mock()
    tracker.get_job.return_value = {"status": "completed"}
    tracker.get_public_progress.return_value = {"status": "completed"}
    return tracker


class TestJobPollingSilo(unittest.TestCase):
    def _poll(self, *, actor_id: str, job_rows, gate=None):
        from app.routes.facebook import get_job_progress

        tracker = _completed_tracker()
        sb = _FakeSb({"jobs": lambda: _FakeResp(job_rows)})
        gate_mock = mock.Mock(side_effect=gate) if gate else mock.Mock(
            return_value=PackAccess(role="viewer", owner_id="owner-1")
        )

        with mock.patch("app.routes.facebook.get_supabase_service", return_value=sb), \
             mock.patch("app.routes.facebook.assert_pack_role", gate_mock), \
             mock.patch("app.routes.facebook.get_job_tracker", return_value=tracker) as get_tracker, \
             mock.patch("app.routes.facebook.get_background_status", return_value=None):
            result = get_job_progress(
                "job-1", background_tasks=mock.Mock(), user={"token": "jwt", "user_id": actor_id}
            )
        return result, gate_mock, get_tracker

    def test_job_proprio_nao_consulta_gate(self) -> None:
        """Ator == silo (todo o tráfego atual): comportamento idêntico ao de
        sempre — sem gate, tracker no próprio silo SEM service role."""
        result, gate, get_tracker = self._poll(
            actor_id="owner-1",
            job_rows=[{"user_id": "owner-1", "payload": {"pack_id": "pack-1"}}],
        )
        self.assertEqual(result["status"], "completed")
        gate.assert_not_called()
        get_tracker.assert_called_once_with("jwt", "owner-1", use_service_role=False)

    def test_job_alheio_exige_acesso_ao_pack(self) -> None:
        """Convidado com grant: gate consultado com o pack do payload; tracker no
        silo do DONO com service role."""
        result, gate, get_tracker = self._poll(
            actor_id="guest-9",
            job_rows=[{"user_id": "owner-1", "payload": {"pack_id": "pack-1"}}],
        )
        self.assertEqual(result["status"], "completed")
        gate.assert_called_once_with("guest-9", "pack-1", roles=("dono", "editor", "viewer"))
        get_tracker.assert_called_once_with("jwt", "owner-1", use_service_role=True)

    def test_job_alheio_sem_acesso_e_404(self) -> None:
        """Sem grant: 404 — não confirmar a existência de job alheio."""
        with self.assertRaises(HTTPException) as ctx:
            self._poll(
                actor_id="guest-9",
                job_rows=[{"user_id": "owner-1", "payload": {"pack_id": "pack-1"}}],
                gate=HTTPException(status_code=404, detail="Pack nao encontrado"),
            )
        self.assertEqual(ctx.exception.status_code, 404)

    def test_job_alheio_sem_pack_no_payload_e_404(self) -> None:
        """Job alheio que não é de pack (payload sem pack_id): invisível."""
        with self.assertRaises(HTTPException) as ctx:
            self._poll(
                actor_id="guest-9",
                job_rows=[{"user_id": "owner-1", "payload": {}}],
            )
        self.assertEqual(ctx.exception.status_code, 404)

    def test_job_inexistente_cai_no_fluxo_proprio(self) -> None:
        """Job não registrado no Supabase (fase Meta-only): silo = ator, fluxo de
        sempre — nada de gate nem service role."""
        result, gate, get_tracker = self._poll(actor_id="owner-1", job_rows=[])
        self.assertEqual(result["status"], "completed")
        gate.assert_not_called()
        get_tracker.assert_called_once_with("jwt", "owner-1", use_service_role=False)


if __name__ == "__main__":
    unittest.main()
