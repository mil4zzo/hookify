# -*- coding: utf-8 -*-
"""Edição de período pela rota de refresh (`refresh_type = "window_edit"`).

A conta das datas vive em `pack_window` (test_pack_window_edit.py). Aqui o que
se trava é a fiação da rota:
- só o DONO edita (editor/viewer → 403, antes de qualquer conta);
- o `time_range` entregue à Meta é a FATIA do plano, e o payload leva
  `window_edit` com o período NOVO — que é o que o fim do job aplica;
- reduzir SÓ o fim não abre relatório nenhum: é banco puro, resolvido na própria
  rota, e as datas mudam depois do recorte;
- a auditoria registra `pack.date_range` com from/to, não `pack.refresh`.

Sabotagens já feitas: tirar o `access.role != "dono"` → test_editor_recebe_403
falha; trocar a ordem (datas antes do recorte) → test_reducao_pura_aplica_datas_
depois_do_recorte falha.
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


def _call_reducao_pura(pack_row, *, date_start, date_stop, trim_falha=False):
    """Encurtar só o fim: nenhuma chamada à Meta. Devolve (api, ordem, log, resposta),
    onde `ordem` registra a sequência real das escritas — o recorte TEM de vir antes
    das datas novas."""
    from app.routes.facebook import refresh_pack
    from app.schemas import RefreshPackRequest
    from app.services.pack_access import PackAccess

    request = RefreshPackRequest(
        until_date=HOJE, refresh_type="window_edit", skip_sheets_sync=True,
        date_start=date_start, date_stop=date_stop,
    )
    user = {"token": "jwt", "user_id": "user-1"}
    api = mock.Mock()
    sb = _FakeSb({"packs": lambda: _FakeResp([dict(pack_row)]), "jobs": lambda: _FakeResp([])})
    log = mock.Mock()
    ordem = []

    def _trim(*a, **k):
        if trim_falha:
            raise RuntimeError("apagamento falhou no meio")
        ordem.append("recorte")
        return {"dias_apagados": 16, "cabeca_apagada": 0, "inventario_ajustado": 2,
                "inventario_removido": 1, "ads_removidos": 3, "thumbs_removidas": 0}

    def _datas(*a, **k):
        ordem.append("datas")

    with mock.patch("app.routes.facebook.assert_pack_role", return_value=PackAccess(role="dono", owner_id="user-1")), \
         mock.patch("app.routes.facebook.get_supabase_service", return_value=sb), \
         mock.patch("app.routes.facebook.get_facebook_token_for_silo", return_value="tok"), \
         mock.patch("app.routes.facebook.GraphAPI", return_value=api), \
         mock.patch("app.routes.facebook.REFRESH_SERVER_CHAIN_ENABLED", False), \
         mock.patch("app.routes.facebook.supabase_repo.acquire_pack_refresh_lock", return_value=True), \
         mock.patch("app.routes.facebook.supabase_repo.trim_pack_to_window", side_effect=_trim), \
         mock.patch("app.routes.facebook.supabase_repo.apply_pack_window_edit", side_effect=_datas), \
         mock.patch("app.routes.facebook.supabase_repo.calculate_pack_stats_essential", return_value={"totalSpend": 1}), \
         mock.patch("app.routes.facebook.supabase_repo.update_pack_stats"), \
         mock.patch("app.routes.facebook.pack_action_log.log_pack_action", log), \
         mock.patch("app.routes.facebook.supabase_repo.update_pack_refresh_status") as status:
        try:
            resposta = refresh_pack("pack-1", request, user)
        except HTTPException as e:
            return api, ordem, log, e, status
    return api, ordem, log, resposta, status


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

    def test_comecar_depois_busca_a_cabeca_e_leva_o_que_apagar(self) -> None:
        """Reduzir o início: a busca é a cabeça de 7 dias (onde ausência = saiu do
        pack) e o payload leva o que o fim do job tem de apagar."""
        api, record_job, _, _ = _call(PACK, date_start="2026-07-15", date_stop="2026-08-31")
        self.assertEqual(api.start_ads_job.call_args.args[1], {"since": "2026-07-15", "until": "2026-07-21"})
        we = record_job.call_args.kwargs["payload"]["window_edit"]
        self.assertEqual(we["delete_before"], "2026-07-15")
        self.assertIsNone(we["delete_after"])
        self.assertEqual(we["head"], ["2026-07-15", "2026-07-21"])

    def test_reducao_pura_nao_abre_relatorio_na_meta(self) -> None:
        api, _, _, resposta, _ = _call_reducao_pura(PACK, date_start="2026-07-01", date_stop="2026-08-15")
        api.start_ads_job.assert_not_called()
        self.assertEqual(resposta["status"], "completed")
        self.assertEqual(resposta["date_range"], {"since": "2026-07-01", "until": "2026-08-15"})
        self.assertEqual(resposta["removido"]["dias_apagados"], 16)

    def test_reducao_pura_aplica_datas_depois_do_recorte(self) -> None:
        """A ordem é a proteção: se as datas fossem primeiro e o apagamento
        falhasse, o pack declararia um período que não tem."""
        _, ordem, _, _, _ = _call_reducao_pura(PACK, date_start="2026-07-01", date_stop="2026-08-15")
        self.assertEqual(ordem, ["recorte", "datas"])

    def test_reducao_que_falha_nao_muda_as_datas_e_libera_o_pack(self) -> None:
        _, ordem, log, erro, status = _call_reducao_pura(
            PACK, date_start="2026-07-01", date_stop="2026-08-15", trim_falha=True)
        self.assertEqual(erro.status_code, 500)
        self.assertNotIn("datas", ordem)
        log.assert_not_called()
        self.assertEqual(status.call_args.kwargs["refresh_status"], "failed")

    def test_reducao_pura_registra_o_que_saiu_na_auditoria(self) -> None:
        _, _, log, _, _ = _call_reducao_pura(PACK, date_start="2026-07-01", date_stop="2026-08-15")
        detalhe = log.call_args.kwargs["detail"]
        self.assertEqual(log.call_args.kwargs["action"], "pack.date_range")
        self.assertEqual(detalhe["to"], {"date_start": "2026-07-01", "date_stop": "2026-08-15"})
        self.assertEqual(detalhe["removido"]["inventario_removido"], 1)

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
