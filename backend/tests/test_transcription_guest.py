# -*- coding: utf-8 -*-
"""Transcricao em pack compartilhado (P3.3b-resto).

Transcricao CUSTA (AssemblyAI): disparar exige dono|editor — viewer nao gasta o
saldo do dono. Ler o estado e leitura: viewer passa. O pipeline inteiro roda no
silo do DONO pela convencao `user_jwt=None => service role`.
"""
import json
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


class TestPackTranscribeAdNamesFilter(unittest.TestCase):
    """O filtro `ad_names` vale mesmo quando nao casa nada.

    Antes havia um `if filtered:` na rota: uma lista de nomes que nao batesse com
    nenhum anuncio do pack fazia o pedido "transcreva estes 3" virar "transcreva o
    pack inteiro" -- e transcricao gasta o saldo de AssemblyAI DO DONO. Basta um
    chamador com o pack errado, ou um ad renomeado entre a leitura da tela e o
    clique, para a conta chegar.

    SABOTAGEM (rodada em 2026-09-05): repor o `if filtered:` na rota faz
    `test_nomes_sem_correspondencia_nao_transcrevem_nada` falhar.
    """

    ADS = [
        {"ad_name": "A", "creative": {}},
        {"ad_name": "B", "creative": {}},
        {"ad_name": "C", "creative": {}},
    ]

    def _call(self, ad_names):
        from app.routes import facebook as FB

        sb = _FakeSb({"packs": lambda: _Resp([{"id": "pack-1", "name": "P"}])})
        body = FB.TranscribePackRequest(ad_names=ad_names) if ad_names is not None else None
        # Espelha a realidade: o worker so tem o que sobrou do filtro para contar.
        pending = mock.Mock(side_effect=lambda **kw: len(kw["formatted_ads"]))

        with mock.patch.object(FB, "assert_pack_role",
                               return_value=PackAccess(role="dono", owner_id="owner-1")),              mock.patch.object(FB, "_sb_for", return_value=sb),              mock.patch.object(FB, "get_facebook_token_for_user", return_value="tok"),              mock.patch.object(FB, "GraphAPI", lambda tok, user_id=None: mock.Mock(access_token=tok)),              mock.patch.object(FB, "get_job_tracker", return_value=mock.Mock()),              mock.patch.object(FB.supabase_repo, "get_ads_for_pack", return_value=list(self.ADS)),              mock.patch("app.services.transcription_worker.count_pending_transcriptions", pending),              mock.patch("app.services.transcription_worker.run_transcription_batch"),              mock.patch.object(FB.threading, "Thread"),              mock.patch.object(FB.pack_action_log, "log_pack_action"):
            resp = FB.start_pack_transcription("pack-1", body, user={"token": "jwt", "user_id": "owner-1"})
        enviados = ([a["ad_name"] for a in pending.call_args.kwargs["formatted_ads"]]
                    if pending.call_args else [])
        return resp, enviados

    def test_sem_body_transcreve_o_pack_inteiro(self):
        resp, enviados = self._call(None)
        self.assertEqual(enviados, ["A", "B", "C"])
        self.assertIsNotNone(json.loads(resp.body)["transcription_job_id"])

    def test_subconjunto_vai_so_com_os_pedidos(self):
        resp, enviados = self._call(["B"])
        self.assertEqual(enviados, ["B"])
        self.assertIsNotNone(json.loads(resp.body)["transcription_job_id"])

    def test_nomes_sem_correspondencia_nao_transcrevem_nada(self):
        """O caso que o `if filtered:` transformava em transcricao do pack inteiro."""
        resp, enviados = self._call(["nao-existe-neste-pack"])
        self.assertEqual(enviados, [])
        payload = json.loads(resp.body)
        self.assertIsNone(payload["transcription_job_id"])
        self.assertEqual(payload["message"], "Nenhuma transcricao pendente".replace("transcricao", "transcrição"))

if __name__ == "__main__":
    unittest.main()
