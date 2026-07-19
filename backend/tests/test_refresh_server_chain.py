"""
Cadeia server-side Meta→Leadscore (REFRESH_SERVER_CHAIN_ENABLED).

Trava o contrato:
- JobProcessor._prepare_chained_sheet_sync: cria o sync job só com intenção
  válida no payload; reusa chained_sync_job_id no resume; falha de criação é
  best-effort (retorna None, Meta completa sem cadeia).
- JobProcessor._finalize_chained_sheet_sync: completed_ok inicia a thread;
  mark_completed recusado só cancela o sync se o PAI foi cancelado (perda de
  lease deixa o sync para o worker que assumiu).
- refresh_pack guard 409: pack com job de refresh ativo ⇒ REFRESH_ALREADY_RUNNING
  com job_id no detail; sem job ativo ⇒ passa do guard; flag off ⇒ nem consulta.
"""
import unittest
from unittest import mock

from fastapi import HTTPException

from app.services.job_processor import JobProcessor
from app.services.job_tracker import STATUS_CANCELLED, STATUS_PROCESSING


def _make_processor() -> JobProcessor:
    with mock.patch("app.services.job_processor.get_job_tracker") as get_tracker:
        get_tracker.return_value = mock.Mock()
        processor = JobProcessor("jwt", "user-1", "token")
    return processor


class TestPrepareChainedSheetSync(unittest.TestCase):
    def test_sem_intencao_retorna_none(self) -> None:
        processor = _make_processor()
        self.assertIsNone(processor._prepare_chained_sheet_sync("job-1", {}))
        self.assertIsNone(
            processor._prepare_chained_sheet_sync("job-1", {"chain_sheet_sync": True})
        )

    @mock.patch("app.services.google_sheet_sync_job.create_sync_job", return_value="sync-1")
    def test_cria_sync_job_e_persiste_no_payload(self, create_sync_job: mock.Mock) -> None:
        processor = _make_processor()
        payload = {"chain_sheet_sync": True, "sheet_integration_id": "integ-1"}

        result = processor._prepare_chained_sheet_sync("job-1", payload)

        self.assertEqual(result, "sync-1")
        create_sync_job.assert_called_once_with(
            user_jwt="jwt", user_id="user-1", integration_id="integ-1"
        )
        processor.tracker.merge_payload.assert_called_once_with(
            "job-1", {"chained_sync_job_id": "sync-1"}
        )

    @mock.patch("app.services.google_sheet_sync_job.create_sync_job")
    def test_resume_reusa_sync_job_existente(self, create_sync_job: mock.Mock) -> None:
        processor = _make_processor()
        payload = {
            "chain_sheet_sync": True,
            "sheet_integration_id": "integ-1",
            "chained_sync_job_id": "sync-preexistente",
        }

        result = processor._prepare_chained_sheet_sync("job-1", payload)

        self.assertEqual(result, "sync-preexistente")
        create_sync_job.assert_not_called()
        processor.tracker.merge_payload.assert_not_called()

    @mock.patch(
        "app.services.google_sheet_sync_job.create_sync_job",
        side_effect=RuntimeError("boom"),
    )
    def test_falha_na_criacao_e_best_effort(self, _create: mock.Mock) -> None:
        processor = _make_processor()
        payload = {"chain_sheet_sync": True, "sheet_integration_id": "integ-1"}

        self.assertIsNone(processor._prepare_chained_sheet_sync("job-1", payload))


class TestFinalizeChainedSheetSync(unittest.TestCase):
    def test_completed_ok_inicia_thread(self) -> None:
        processor = _make_processor()
        with mock.patch.object(processor, "_start_chained_sheet_sync") as start:
            processor._finalize_chained_sheet_sync("job-1", "sync-1", "integ-1", True)
        start.assert_called_once_with("sync-1", "integ-1")
        processor.tracker.mark_cancelled.assert_not_called()

    def test_pai_cancelado_cancela_sync_sem_iniciar(self) -> None:
        processor = _make_processor()
        processor.tracker.get_job.return_value = {"id": "job-1", "status": STATUS_CANCELLED}
        with mock.patch.object(processor, "_start_chained_sheet_sync") as start:
            processor._finalize_chained_sheet_sync("job-1", "sync-1", "integ-1", False)
        start.assert_not_called()
        processor.tracker.mark_cancelled.assert_called_once()
        self.assertEqual(processor.tracker.mark_cancelled.call_args.args[0], "sync-1")

    def test_lease_perdido_nao_toca_no_sync(self) -> None:
        # mark_completed False mas pai NÃO cancelado (outro worker assumiu):
        # o sync fica intacto para o worker vencedor reusar.
        processor = _make_processor()
        processor.tracker.get_job.return_value = {"id": "job-1", "status": STATUS_PROCESSING}
        with mock.patch.object(processor, "_start_chained_sheet_sync") as start:
            processor._finalize_chained_sheet_sync("job-1", "sync-1", "integ-1", False)
        start.assert_not_called()
        processor.tracker.mark_cancelled.assert_not_called()

    @mock.patch("app.services.google_sheet_sync_job.process_sync_job")
    def test_start_roda_process_sync_job_em_thread(self, process_sync_job: mock.Mock) -> None:
        import threading

        processor = _make_processor()
        done = threading.Event()
        process_sync_job.side_effect = lambda **kw: done.set()

        processor._start_chained_sheet_sync("sync-1", "integ-1")

        self.assertTrue(done.wait(timeout=5), "process_sync_job não rodou na thread")
        process_sync_job.assert_called_once_with(
            user_jwt="jwt", user_id="user-1", job_id="sync-1", integration_id="integ-1"
        )


class _FakeResp:
    def __init__(self, data):
        self.data = data


class _Fluent:
    """Query builder falso: métodos encadeáveis retornam self; execute() delega."""

    def __init__(self, on_execute):
        self._on_execute = on_execute
        self.calls = []

    def __getattr__(self, name):
        def _chain(*args, **kwargs):
            self.calls.append((name, args))
            return self

        return _chain

    def execute(self):
        return self._on_execute()


class _FakeSb:
    """Roteia .table(nome) para respostas configuradas por tabela."""

    def __init__(self, responses):
        self._responses = responses
        self.tables_queried = []

    def table(self, name):
        self.tables_queried.append(name)
        on_execute = self._responses.get(name, lambda: _FakeResp([]))
        return _Fluent(on_execute)


_PACK_ROW = {
    "id": "pack-1",
    "adaccount_id": "act_123",
    "name": "Pack Teste",
    "filters": [],
    "level": "ad",
    "auto_refresh": False,
    "last_refreshed_at": "2026-07-17",
    "sheet_integration_id": None,
}


class TestRefreshPackGuard409(unittest.TestCase):
    def _call_refresh(self, sb: _FakeSb, flag_on: bool):
        from app.routes.facebook import refresh_pack
        from app.schemas import RefreshPackRequest

        request = RefreshPackRequest(until_date="2026-07-18", skip_sheets_sync=True)
        user = {"token": "jwt", "user_id": "user-1"}
        api = mock.Mock()
        # Sentinela: se a execução passar do guard, para aqui (start_ads_job).
        api.start_ads_job.side_effect = RuntimeError("passou-do-guard")

        with mock.patch("app.routes.facebook.get_supabase_for_user", return_value=sb), \
             mock.patch("app.routes.facebook.REFRESH_SERVER_CHAIN_ENABLED", flag_on), \
             mock.patch("app.routes.facebook.supabase_repo.update_pack_refresh_status"):
            return refresh_pack("pack-1", request, api, user)

    def test_job_ativo_fresco_retorna_409(self) -> None:
        sb = _FakeSb({
            "packs": lambda: _FakeResp([dict(_PACK_ROW)]),
            "jobs": lambda: _FakeResp([{"id": "job-existente", "status": "processing", "updated_at": "x"}]),
        })

        with self.assertRaises(HTTPException) as ctx:
            self._call_refresh(sb, flag_on=True)

        self.assertEqual(ctx.exception.status_code, 409)
        detail = ctx.exception.detail
        self.assertEqual(detail["code"], "REFRESH_ALREADY_RUNNING")
        self.assertEqual(detail["details"]["job_id"], "job-existente")

    def test_sem_job_ativo_passa_do_guard(self) -> None:
        sb = _FakeSb({
            "packs": lambda: _FakeResp([dict(_PACK_ROW)]),
            "jobs": lambda: _FakeResp([]),
        })

        # Sem job ativo, a execução segue e bate no sentinela start_ads_job,
        # que o route converte em HTTPException 500 — o importante: NÃO é 409.
        with self.assertRaises(HTTPException) as ctx:
            self._call_refresh(sb, flag_on=True)
        self.assertEqual(ctx.exception.status_code, 500)
        self.assertIn("jobs", sb.tables_queried)

    def test_flag_off_nem_consulta_jobs(self) -> None:
        sb = _FakeSb({
            "packs": lambda: _FakeResp([dict(_PACK_ROW)]),
            "jobs": lambda: _FakeResp([{"id": "job-existente", "status": "processing", "updated_at": "x"}]),
        })

        with self.assertRaises(HTTPException) as ctx:
            self._call_refresh(sb, flag_on=False)
        self.assertEqual(ctx.exception.status_code, 500)
        self.assertNotIn("jobs", sb.tables_queried)


if __name__ == "__main__":
    unittest.main()
