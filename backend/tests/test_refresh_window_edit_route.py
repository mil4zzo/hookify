# -*- coding: utf-8 -*-
"""Edição de período pela rota de refresh (`refresh_type = "window_edit"`).

A conta das datas vive em `pack_window` (test_pack_window_edit.py). Aqui o que
se trava é a fiação da rota:
- só o DONO edita (editor/viewer → 403, antes de qualquer conta);
- o `time_range` entregue à Meta é a FATIA do plano, e o payload leva
  `window_edit` com o período NOVO — que é o que o fim do job aplica;
- reduzir (Etapa 2) é recusado com 400 e não abre relatório;
- a auditoria registra `pack.date_range` com from/to, não `pack.refresh`.

Sabotagens já feitas: tirar o `access.role != "dono"` → test_editor_recebe_403
falha; tirar o `reduces` → test_reduzir_e_recusado falha (abre relatório).
"""
import unittest
from unittest import mock

from fastapi import HTTPException

from tests.test_refresh_server_chain import _FakeResp, _FakeSb, _PACK_ROW

HOJE = "2026-09-17"
PACK = {
    **_PACK_ROW,
    "auto_refresh": False,
    "date_start": "2026-07-01",
    "date_stop": "2026-08-31",
    "last_refreshed_at": "2026-08-31",
    "attribution_window_days": 7,
}


def _call(pack_row, *, date_start, date_stop, role="dono"):
    from app.routes.facebook import refresh_pack
    from app.schemas import RefreshPackRequest
    from app.services.pack_access import PackAccess

    request = RefreshPackRequest(
        until_date=HOJE, refresh_type="window_edit", skip_sheets_sync=True,
        date_start=date_start, date_stop=date_stop,
    )
    user = {"token": "jwt", "user_id": "user-1" if role == "dono" else "guest-9"}
    api = mock.Mock()
    api.start_ads_job.return_value = "report-1"
    sb = _FakeSb({"packs": lambda: _FakeResp([dict(pack_row)]), "jobs": lambda: _FakeResp([])})
    record_job = mock.Mock()
    log = mock.Mock()

    with mock.patch("app.routes.facebook.assert_pack_role", return_value=PackAccess(role=role, owner_id="user-1")), \
         mock.patch("app.routes.facebook.get_supabase_service", return_value=sb), \
         mock.patch("app.routes.facebook.get_facebook_token_for_silo", return_value="tok"), \
         mock.patch("app.routes.facebook.GraphAPI", return_value=api), \
         mock.patch("app.routes.facebook.REFRESH_SERVER_CHAIN_ENABLED", False), \
         mock.patch("app.routes.facebook.supabase_repo.acquire_pack_refresh_lock", return_value=True), \
         mock.patch("app.routes.facebook.supabase_repo.record_job", record_job), \
         mock.patch("app.routes.facebook.pack_action_log.log_pack_action", log), \
         mock.patch("app.routes.facebook.supabase_repo.update_pack_refresh_status"):
        result = refresh_pack("pack-1", request, user)
    return api, record_job, log, result


class TestWindowEditRoute(unittest.TestCase):
    def test_comecar_antes_pede_a_fatia_e_leva_o_periodo_novo_no_payload(self) -> None:
        api, record_job, log, result = _call(PACK, date_start="2026-06-01", date_stop="2026-08-31")
        self.assertEqual(api.start_ads_job.call_args.args[1], {"since": "2026-06-01", "until": "2026-07-07"})
        payload = record_job.call_args.kwargs["payload"]
        self.assertEqual(payload["refresh_type"], "window_edit")
        self.assertEqual(payload["window_edit"]["date_start"], "2026-06-01")
        self.assertEqual(payload["window_edit"]["date_stop"], "2026-08-31")
        self.assertTrue(payload["window_edit"]["auto_refresh_off"])
        self.assertEqual(result["date_range"], {"since": "2026-06-01", "until": "2026-07-07"})

    def test_terminar_depois_recua_pela_janela(self) -> None:
        api, record_job, _, _ = _call(PACK, date_start="2026-07-01", date_stop="2026-09-15")
        self.assertEqual(api.start_ads_job.call_args.args[1], {"since": "2026-08-25", "until": "2026-09-15"})
        self.assertEqual(record_job.call_args.kwargs["payload"]["date_stop"], "2026-09-15")

    def test_auditoria_registra_pack_date_range_com_from_to(self) -> None:
        _, _, log, _ = _call(PACK, date_start="2026-06-01", date_stop="2026-08-31")
        kw = log.call_args.kwargs
        self.assertEqual(kw["action"], "pack.date_range")
        self.assertEqual(kw["detail"]["from"], {"date_start": "2026-07-01", "date_stop": "2026-08-31"})
        self.assertEqual(kw["detail"]["to"], {"date_start": "2026-06-01", "date_stop": "2026-08-31"})

    def test_editor_recebe_403_sem_abrir_relatorio(self) -> None:
        with self.assertRaises(HTTPException) as ctx:
            _call(PACK, date_start="2026-06-01", date_stop="2026-08-31", role="editor")
        self.assertEqual(ctx.exception.status_code, 403)

    def test_reduzir_e_recusado_com_400(self) -> None:
        with self.assertRaises(HTTPException) as ctx:
            _call(PACK, date_start="2026-07-15", date_stop="2026-08-31")
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("Reduzir", str(ctx.exception.detail))

    def test_so_terminar_antes_e_recusado_com_400(self) -> None:
        with self.assertRaises(HTTPException) as ctx:
            _call(PACK, date_start="2026-07-01", date_stop="2026-08-15")
        self.assertEqual(ctx.exception.status_code, 400)

    def test_mesmo_periodo_e_400(self) -> None:
        with self.assertRaises(HTTPException) as ctx:
            _call(PACK, date_start="2026-07-01", date_stop="2026-08-31")
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("mesmo", str(ctx.exception.detail))

    def test_refresh_comum_nao_leva_window_edit_no_payload(self) -> None:
        from tests.test_refresh_closed_pack import _call_refresh
        _, payload = _call_refresh(PACK, "since_last_refresh")
        self.assertNotIn("window_edit", payload)


if __name__ == "__main__":
    unittest.main()
