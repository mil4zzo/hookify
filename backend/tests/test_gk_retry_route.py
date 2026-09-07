# -*- coding: utf-8 -*-
"""Fiação do retry de GK dentro do polling (`get_job_progress`).

A decisão vive em `gk_retry` (testado à parte, com sabotagem). Aqui o que se
trava é o encaixe no endpoint:
- o id do job NUNCA muda; o relatório atual é lido do payload
  (`meta_report_run_id`) e é ELE que se consulta na Meta;
- primeira falha transitória: agenda o respiro no payload, job continua
  `meta_running` com `stage=meta_retry_wait` (o toast mostra a espera) e
  `mark_failed` NÃO é chamado;
- na hora: reabre o relatório e grava o novo id + tentativa;
- esgotou: `mark_failed` com a mensagem curta, `meta_error.transient=True`, e o
  pack é liberado ('failed') em vez de ficar 'running' até o lock vencer;
- GK sem `business_management`: falha de vez, `transient=False` (o frontend
  manda reautorizar), sem reabrir nada.
"""
from datetime import datetime, timedelta, timezone
from unittest import mock

import pytest

from app.services.job_tracker import STATUS_META_RUNNING

GK_MSG = "(#3) AdAccount must pass GK: plr_beta_gk_existing_feature"
GK_ERROR = {"code": 3, "type": "OAuthException", "message": GK_MSG, "fbtrace_id": "Ax"}
BASE_PAYLOAD = {
    "pack_id": "pack-1", "is_refresh": True, "type": "pack_refresh",
    "adaccount_id": "act_1", "date_start": "2026-08-30", "date_stop": "2026-09-06",
    "filters": [{"field": "campaign.name", "operator": "CONTAIN", "value": "x"}],
}


class _FakeResp:
    def __init__(self, data):
        self.data = data


class _Fluent:
    def __init__(self, on_execute):
        self._on_execute = on_execute

    def __getattr__(self, name):
        return lambda *a, **k: self

    def execute(self):
        return self._on_execute()


class _FakeSb:
    def __init__(self, responses):
        self._responses = responses

    def table(self, name):
        return _Fluent(self._responses.get(name, lambda: _FakeResp([])))


def _poll(payload, *, scopes, restart_returns="report-2"):
    """Roda um poll de job próprio cujo relatório atual a Meta diz ter falhado com GK."""
    from app.routes import facebook as fb

    tracker = mock.Mock()
    tracker.get_job.return_value = {"status": STATUS_META_RUNNING, "payload": dict(payload)}
    tracker.get_public_progress.return_value = {"status": STATUS_META_RUNNING}
    tracker.processing_owner = "w"

    meta_client = mock.Mock()
    meta_client.get_status.return_value = {
        "success": True, "status": "failed", "percent": 46,
        "error": f"Meta async report falhou (job=1, 46%): {GK_MSG}",
        "meta_error": dict(GK_ERROR),
    }
    sb = _FakeSb({"jobs": lambda: _FakeResp([{"user_id": "owner-1", "payload": dict(payload)}])})
    restart = mock.Mock(return_value=restart_returns)
    release = mock.Mock()

    with mock.patch.object(fb, "get_supabase_service", return_value=sb), \
         mock.patch.object(fb, "get_job_tracker", return_value=tracker), \
         mock.patch.object(fb, "get_facebook_token_for_user", return_value="tok"), \
         mock.patch.object(fb, "get_meta_job_client", return_value=meta_client), \
         mock.patch.object(fb, "get_primary_connection_scopes_for_silo", return_value=scopes), \
         mock.patch.object(fb, "_restart_meta_report", restart), \
         mock.patch.object(fb, "_release_pack_after_meta_failure", release), \
         mock.patch.object(fb, "get_background_status", return_value=None):
        fb.get_job_progress("job-1", background_tasks=mock.Mock(), user={"token": "jwt", "user_id": "owner-1"})

    return tracker, meta_client, restart, release


GRANTED = ["ads_read", "ads_management", "business_management"]


def test_primeira_falha_transitoria_agenda_respiro_e_nao_mata_o_job():
    tracker, _, restart, release = _poll(BASE_PAYLOAD, scopes=GRANTED)

    tracker.mark_failed.assert_not_called()
    restart.assert_not_called()
    release.assert_not_called()

    patch = tracker.merge_payload.call_args.args[1]
    assert patch["gk_attempts"] == 1
    assert patch["gk_retry_not_before"]  # carimbo ISO gravado

    hb = tracker.heartbeat.call_args
    assert hb.kwargs["status"] == STATUS_META_RUNNING
    assert hb.kwargs["details"]["stage"] == "meta_retry_wait"
    assert hb.kwargs["details"]["meta_error"]["code"] == 3   # guardado para o encerramento
    assert hb.kwargs["message"].startswith("Instabilidade na Meta. Tentativa 2 de 3")


def test_enquanto_espera_nao_toca_na_meta():
    # O relatório antigo já morreu: consultá-lo a cada poll de 2 s custaria duas
    # chamadas por poll durante 15–60 s e encheria o log de erro. Esperando, o
    # endpoint devolve o progresso gravado e mais nada.
    payload = {**BASE_PAYLOAD, "gk_attempts": 1,
               "gk_retry_not_before": (datetime.now(timezone.utc) + timedelta(seconds=10)).isoformat()}
    tracker, meta_client, restart, release = _poll(payload, scopes=GRANTED)

    meta_client.get_status.assert_not_called()
    restart.assert_not_called()
    tracker.merge_payload.assert_not_called()
    tracker.heartbeat.assert_not_called()
    tracker.mark_failed.assert_not_called()
    release.assert_not_called()


def test_na_hora_reabre_o_relatorio_sem_trocar_o_id_do_job():
    payload = {**BASE_PAYLOAD, "gk_attempts": 1,
               "gk_retry_not_before": (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()}
    tracker, meta_client, restart, release = _poll(payload, scopes=GRANTED)

    meta_client.get_status.assert_not_called()   # decide antes de consultar a Meta
    restart.assert_called_once()
    tracker.mark_failed.assert_not_called()
    release.assert_not_called()

    patch = tracker.merge_payload.call_args.args[1]
    assert patch["meta_report_run_id"] == "report-2"
    assert patch["gk_attempts"] == 2
    assert patch["gk_retry_not_before"] is None
    # O job continua sendo "job-1" para o frontend: nenhum id novo sai do endpoint.
    assert tracker.merge_payload.call_args.args[0] == "job-1"


def test_polling_consulta_o_relatorio_atual_do_payload_e_nao_o_id_do_job():
    payload = {**BASE_PAYLOAD, "meta_report_run_id": "report-2", "gk_attempts": 2}
    _, meta_client, _, _ = _poll(payload, scopes=GRANTED)
    meta_client.get_status.assert_called_once_with("report-2")


def test_esgotou_falha_com_mensagem_curta_transient_true_e_libera_o_pack():
    payload = {**BASE_PAYLOAD, "meta_report_run_id": "report-3", "gk_attempts": 3}
    tracker, _, restart, release = _poll(payload, scopes=GRANTED)

    restart.assert_not_called()
    tracker.mark_failed.assert_called_once()
    args, kwargs = tracker.mark_failed.call_args
    assert args[1] == "Instabilidade na Meta. Tente de novo em alguns minutos."
    assert kwargs["details"]["meta_error"]["transient"] is True
    release.assert_called_once()


def test_reabertura_recusada_encerra_em_vez_de_insistir():
    payload = {**BASE_PAYLOAD, "gk_attempts": 1,
               "gk_retry_not_before": (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat(),
               "details": {"meta_error": dict(GK_ERROR)}}
    tracker, meta_client, restart, release = _poll(payload, scopes=GRANTED, restart_returns=None)

    meta_client.get_status.assert_not_called()
    restart.assert_called_once()
    tracker.mark_failed.assert_called_once()
    args, kwargs = tracker.mark_failed.call_args
    assert args[1] == "Instabilidade na Meta. Tente de novo em alguns minutos."
    assert kwargs["details"]["meta_error"]["transient"] is True
    assert kwargs["details"]["meta_error"]["code"] == 3   # diagnóstico da falha original preservado
    release.assert_called_once()


def test_gk_sem_business_management_falha_de_vez_como_permissao():
    tracker, _, restart, release = _poll(BASE_PAYLOAD, scopes=["ads_read", "ads_management"])

    restart.assert_not_called()
    tracker.merge_payload.assert_not_called()
    tracker.mark_failed.assert_called_once()
    args, kwargs = tracker.mark_failed.call_args
    assert GK_MSG in args[1]                       # mensagem original, com o diagnóstico
    assert kwargs["details"]["meta_error"]["transient"] is False
    release.assert_called_once()
