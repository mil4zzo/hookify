# -*- coding: utf-8 -*-
"""A atualização respeita o fim de um pack FECHADO (0.1 do plano de edição de período).

A regra pura vive em `pack_window` (testada em test_pack_window.py). Aqui o que
se trava é a fiação: o `time_range` que a rota entrega à Meta e o `date_stop`
que vai para o payload do job — porque é o payload que o job grava de volta no
pack ao terminar. Se o payload levar "hoje", o fim do pack fechado anda.

Sabotagem já feita: com `until_str = request.until_date` de volta na rota, o
teste do pack fechado falha (payload date_stop = hoje).
"""
import unittest
from unittest import mock

from tests.test_refresh_server_chain import _FakeResp, _FakeSb, _PACK_ROW

HOJE = "2026-09-17"


def _call_refresh(pack_row, refresh_type):
    """Roda refresh_pack até a abertura do relatório e devolve (time_range, payload)."""
    from app.routes.facebook import refresh_pack
    from app.schemas import RefreshPackRequest
    from app.services.pack_access import PackAccess

    request = RefreshPackRequest(until_date=HOJE, refresh_type=refresh_type, skip_sheets_sync=True)
    user = {"token": "jwt", "user_id": "user-1"}

    api = mock.Mock()
    api.start_ads_job.return_value = "report-1"
    sb = _FakeSb({"packs": lambda: _FakeResp([dict(pack_row)]), "jobs": lambda: _FakeResp([])})
    record_job = mock.Mock()

    with mock.patch("app.routes.facebook.assert_pack_role", return_value=PackAccess(role="dono", owner_id="user-1")), \
         mock.patch("app.routes.facebook.get_supabase_service", return_value=sb), \
         mock.patch("app.routes.facebook.get_facebook_token_for_silo", return_value="tok"), \
         mock.patch("app.routes.facebook.GraphAPI", return_value=api), \
         mock.patch("app.routes.facebook.REFRESH_SERVER_CHAIN_ENABLED", False), \
         mock.patch("app.routes.facebook.supabase_repo.acquire_pack_refresh_lock", return_value=True), \
         mock.patch("app.routes.facebook.supabase_repo.record_job", record_job), \
         mock.patch("app.routes.facebook.supabase_repo.update_pack_refresh_status"):
        refresh_pack("pack-1", request, user)

    time_range = api.start_ads_job.call_args.args[1]
    payload = record_job.call_args.kwargs["payload"]
    return time_range, payload


class TestFimDoPackFechado(unittest.TestCase):
    FECHADO = {
        **_PACK_ROW,
        "auto_refresh": False,
        "date_start": "2026-07-01",
        "date_stop": "2026-08-15",
        "last_refreshed_at": "2026-08-15",
        "attribution_window_days": 7,
    }

    def test_desde_ultima_atualizacao_nao_passa_do_fim(self) -> None:
        time_range, payload = _call_refresh(self.FECHADO, "since_last_refresh")
        self.assertEqual(time_range, {"since": "2026-08-08", "until": "2026-08-15"})
        self.assertEqual(payload["date_stop"], "2026-08-15")
        self.assertEqual(payload["date_start"], "2026-08-08")

    def test_todo_o_periodo_nao_passa_do_fim(self) -> None:
        time_range, payload = _call_refresh(self.FECHADO, "full_period")
        self.assertEqual(time_range, {"since": "2026-07-01", "until": "2026-08-15"})
        self.assertEqual(payload["date_stop"], "2026-08-15")

    def test_pack_aberto_continua_indo_ate_hoje(self) -> None:
        aberto = {**self.FECHADO, "auto_refresh": True, "date_stop": "2026-09-16", "last_refreshed_at": "2026-09-16"}
        time_range, payload = _call_refresh(aberto, "since_last_refresh")
        self.assertEqual(time_range["until"], HOJE)
        self.assertEqual(payload["date_stop"], HOJE)


if __name__ == "__main__":
    unittest.main()
