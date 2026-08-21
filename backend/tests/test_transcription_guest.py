# -*- coding: utf-8 -*-
"""Transcricao em pack compartilhado (P3.3b-resto).

Transcricao CUSTA (AssemblyAI): disparar exige dono|editor — viewer nao gasta o
saldo do dono. Ler o estado e leitura: viewer passa. O pipeline inteiro roda no
silo do DONO pela convencao `user_jwt=None => service role`.
"""
import unittest
from unittest import mock

from fastapi import HTTPException

from app.services.pack_access import PackAccess


class _Resp:
    def __init__(self, data):
        self.data = data


class _Fluent:
    def __init__(self, on_execute):
        self._on_execute = on_execute

    def __getattr__(self, name):
        def _chain(*a, **k):
            return self
        return _chain

    def execute(self):
        return self._on_execute()


class _FakeSb:
    def __init__(self, responses):
        self._responses = responses

    def table(self, name):
        return _Fluent(self._responses.get(name, lambda: _Resp([])))


class TestPackTranscribeGuest(unittest.TestCase):
    def _call(self, *, role_access, owner_token="owner-tok", actor="guest-9"):
        from app.routes import facebook as FB

        sb = _FakeSb({"packs": lambda: _Resp([{"id": "pack-1", "name": "P"}])})
        gate = (mock.Mock(side_effect=role_access) if isinstance(role_access, Exception)
                else mock.Mock(return_value=role_access))
        tracker = mock.Mock()

        with mock.patch.object(FB, "assert_pack_role", gate), \
             mock.patch.object(FB, "_sb_for", return_value=sb), \
             mock.patch.object(FB, "get_facebook_token_for_silo", return_value=owner_token), \
             mock.patch.object(FB, "get_facebook_token_for_user", return_value="actor-tok"), \
             mock.patch.object(FB, "GraphAPI", lambda tok, user_id=None: mock.Mock(access_token=tok)), \
             mock.patch.object(FB, "get_job_tracker", return_value=tracker) as get_tracker, \
             mock.patch.object(FB.supabase_repo, "get_ads_for_pack", return_value=[{"ad_name": "A", "creative": {}}]), \
             mock.patch("app.services.transcription_worker.count_pending_transcriptions", return_value=2) as pending, \
             mock.patch("app.services.transcription_worker.run_transcription_batch"), \
             mock.patch.object(FB.threading, "Thread"):
            resp = FB.start_pack_transcription(
                "pack-1", None, user={"token": "jwt", "user_id": actor},
            )
        return resp, gate, get_tracker, pending

    def test_editor_convidado_dispara_no_silo_do_dono(self):
        resp, gate, get_tracker, pending = self._call(
            role_access=PackAccess(role="editor", owner_id="owner-1")
        )
        gate.assert_called_once_with("guest-9", "pack-1", roles=("dono", "editor"))
        # tracker e contagem no silo do DONO, com service role
        get_tracker.assert_called_once_with(None, "owner-1", use_service_role=True)
        self.assertIsNone(pending.call_args.kwargs["user_jwt"])
        self.assertEqual(pending.call_args.kwargs["user_id"], "owner-1")

    def test_dono_mantem_caminho_proprio(self):
        resp, gate, get_tracker, pending = self._call(
            role_access=PackAccess(role="dono", owner_id="guest-9")
        )
        get_tracker.assert_called_once_with("jwt", "guest-9", use_service_role=False)
        self.assertEqual(pending.call_args.kwargs["user_jwt"], "jwt")

    def test_viewer_bloqueado(self):
        with self.assertRaises(HTTPException) as ctx:
            self._call(role_access=HTTPException(status_code=403, detail="Papel insuficiente"))
        self.assertEqual(ctx.exception.status_code, 403)

    def test_dono_sem_meta_e_403_do_dono(self):
        with self.assertRaises(HTTPException) as ctx:
            self._call(role_access=PackAccess(role="editor", owner_id="owner-1"), owner_token=None)
        self.assertEqual(ctx.exception.status_code, 403)
        self.assertEqual(ctx.exception.detail["error"], "owner_facebook_connection_missing")


class TestTranscriptionProgressSilo(unittest.TestCase):
    """O silo sai do JOB, nunca do ator — convidado polando job do dono."""

    def _poll(self, *, actor, job_rows):
        from app.routes import facebook as FB

        tracker = mock.Mock()
        tracker.get_public_progress.return_value = {"status": "processing"}
        tracker.get_job.return_value = {"payload": {"type": "transcription"}}
        svc = _FakeSb({"jobs": lambda: _Resp(job_rows)})
        gate = mock.Mock(return_value=PackAccess(role="viewer", owner_id="owner-1"))

        with mock.patch.object(FB, "get_supabase_service", return_value=svc), \
             mock.patch.object(FB, "assert_pack_role", gate), \
             mock.patch.object(FB, "get_job_tracker", return_value=tracker) as get_tracker:
            res = FB.get_transcription_progress("job-1", user={"token": "jwt", "user_id": actor})
        return res, gate, get_tracker

    def test_job_do_dono_polado_por_convidado(self):
        res, gate, get_tracker = self._poll(
            actor="guest-9",
            job_rows=[{"user_id": "owner-1", "payload": {"type": "transcription", "pack_id": "pack-1"}}],
        )
        self.assertEqual(res["status"], "processing")
        gate.assert_called_once_with("guest-9", "pack-1", roles=("dono", "editor", "viewer"))
        get_tracker.assert_called_once_with("jwt", "owner-1", use_service_role=True)

    def test_job_proprio_sem_gate(self):
        res, gate, get_tracker = self._poll(
            actor="owner-1",
            job_rows=[{"user_id": "owner-1", "payload": {"type": "transcription"}}],
        )
        gate.assert_not_called()
        get_tracker.assert_called_once_with("jwt", "owner-1", use_service_role=False)

    def test_job_alheio_sem_pack_e_404(self):
        with self.assertRaises(HTTPException) as ctx:
            self._poll(actor="guest-9", job_rows=[{"user_id": "owner-1", "payload": {"type": "transcription"}}])
        self.assertEqual(ctx.exception.status_code, 404)


if __name__ == "__main__":
    unittest.main()
