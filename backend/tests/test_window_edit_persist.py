# -*- coding: utf-8 -*-
"""Fim do job numa edição de período (Etapa 1 do plano de edição de período).

O que se trava:
- com `window_edit` no payload, o job aplica as datas NOVAS (não o `until` da
  fatia) — `_finish_pack_refresh` → `apply_pack_window_edit`;
- `last_refreshed_at` nunca retrocede: fatia para trás termina no passado e não
  vira âncora (senão a próxima atualização incremental releria meses);
- sem `window_edit`, o comportamento atual continua idêntico (grava
  `date_stop = until`);
- coleta vazia: refresh comum libera a trava sem mexer em data; edição de
  período aplica as datas (período sem entrega é período válido).

Sabotagens já feitas: trocar `max(candidates)` por `slice_until` em
apply_pack_window_edit → test_ancora_nao_retrocede falha; tirar o ramo
`window_edit` de `_finish_pack_refresh` → test_window_edit_aplica_datas falha.
"""
import unittest
from unittest import mock

from app.services import supabase_repo
from app.services.job_processor import JobProcessor
from tests.test_refresh_server_chain import _FakeResp, _FakeSb


def _processor() -> JobProcessor:
    with mock.patch("app.services.job_processor.get_job_tracker") as get_tracker:
        get_tracker.return_value = mock.Mock()
        p = JobProcessor("jwt", "user-1", "token")
    p._sb = object()
    return p


class TestFinishPackRefresh(unittest.TestCase):
    def test_window_edit_aplica_datas_novas(self) -> None:
        p = _processor()
        payload = {
            "date_start": "2026-06-01", "date_stop": "2026-07-07",   # a FATIA
            "window_edit": {"date_start": "2026-06-01", "date_stop": "2026-08-31", "auto_refresh_off": True},
        }
        with mock.patch.object(supabase_repo, "apply_pack_window_edit") as apply, \
             mock.patch.object(supabase_repo, "update_pack_refresh_status") as status:
            p._finish_pack_refresh("pack-1", payload)
        status.assert_not_called()
        apply.assert_called_once()
        kw = apply.call_args.kwargs
        self.assertEqual((kw["date_start"], kw["date_stop"]), ("2026-06-01", "2026-08-31"))
        self.assertEqual(kw["slice_until"], "2026-07-07")
        self.assertTrue(kw["auto_refresh_off"])

    def test_refresh_comum_continua_gravando_until(self) -> None:
        p = _processor()
        with mock.patch.object(supabase_repo, "apply_pack_window_edit") as apply, \
             mock.patch.object(supabase_repo, "update_pack_refresh_status") as status:
            p._finish_pack_refresh("pack-1", {"date_start": "2026-09-10", "date_stop": "2026-09-17"})
        apply.assert_not_called()
        kw = status.call_args.kwargs
        self.assertEqual(kw["refresh_status"], "success")
        self.assertEqual(kw["date_stop"], "2026-09-17")
        self.assertEqual(kw["last_refreshed_at"], "2026-09-17")

    def test_coleta_vazia_em_refresh_comum_libera_sem_mexer_em_data(self) -> None:
        p = _processor()
        with mock.patch.object(supabase_repo, "update_pack_refresh_status") as status:
            p._finish_pack_refresh("pack-1", {"date_start": "2026-09-10", "date_stop": "2026-09-17"}, empty=True)
        kw = status.call_args.kwargs
        self.assertEqual(kw["refresh_status"], "success")
        self.assertIsNone(kw["date_stop"])
        self.assertIsNone(kw["last_refreshed_at"])

    def test_coleta_vazia_em_window_edit_aplica_datas(self) -> None:
        p = _processor()
        payload = {"date_start": "2026-06-01", "date_stop": "2026-07-07",
                   "window_edit": {"date_start": "2026-06-01", "date_stop": "2026-08-31", "auto_refresh_off": False}}
        with mock.patch.object(supabase_repo, "apply_pack_window_edit") as apply:
            p._finish_pack_refresh("pack-1", payload, empty=True)
        apply.assert_called_once()


class TestTrimNoFimDoJob(unittest.TestCase):
    """Redução COM fatia: o job recorta antes de aplicar as datas, e só apaga por
    ausência na cabeça — com as chaves da resposta em mãos."""

    PAYLOAD = {
        "date_start": "2026-07-15", "date_stop": "2026-07-21",   # a fatia (cabeça)
        "window_edit": {
            "date_start": "2026-07-15", "date_stop": "2026-08-31",
            "auto_refresh_off": False, "head": ["2026-07-15", "2026-07-21"],
            "delete_before": "2026-07-15", "delete_after": None,
        },
    }
    LINHAS = [
        {"ad_id": "a1", "date": "2026-07-15"},
        {"ad_id": "a2", "date": "2026-07-16"},
        {"ad_id": "a3", "date": "2026-08-30"},   # fora da cabeça: não vira chave
    ]

    def test_recorta_antes_de_aplicar_as_datas(self) -> None:
        p = _processor()
        ordem = []
        with mock.patch.object(supabase_repo, "trim_pack_to_window",
                               side_effect=lambda *a, **k: ordem.append("recorte") or {}) as trim, \
             mock.patch.object(supabase_repo, "apply_pack_window_edit",
                               side_effect=lambda *a, **k: ordem.append("datas")):
            p._finish_pack_refresh("pack-1", self.PAYLOAD, formatted_data=self.LINHAS)
        self.assertEqual(ordem, ["recorte", "datas"])
        kw = trim.call_args.kwargs
        self.assertEqual(kw["head"], ("2026-07-15", "2026-07-21"))
        # Só os pares DENTRO da cabeça viram chave.
        self.assertEqual(kw["head_keys"], [["a1", "2026-07-15"], ["a2", "2026-07-16"]])
        self.assertEqual(trim.call_args.args[2:], ("2026-07-15", "2026-08-31"))

    def test_sem_resposta_nao_apaga_por_ausencia(self) -> None:
        """Sem `formatted_data` não há chaves: a cabeça fica intocada em vez de ser
        apagada inteira. `pack_trim_head` também recusa lista vazia do lado do banco."""
        p = _processor()
        with mock.patch.object(supabase_repo, "trim_pack_to_window", return_value={}) as trim, \
             mock.patch.object(supabase_repo, "apply_pack_window_edit"):
            p._finish_pack_refresh("pack-1", self.PAYLOAD, formatted_data=[])
        self.assertIsNone(trim.call_args.kwargs["head_keys"])

    def test_ampliar_nao_recorta(self) -> None:
        p = _processor()
        payload = {"date_start": "2026-06-01", "date_stop": "2026-07-07",
                   "window_edit": {"date_start": "2026-06-01", "date_stop": "2026-08-31",
                                   "auto_refresh_off": True, "head": None,
                                   "delete_before": None, "delete_after": None}}
        with mock.patch.object(supabase_repo, "trim_pack_to_window") as trim, \
             mock.patch.object(supabase_repo, "apply_pack_window_edit") as apply:
            p._finish_pack_refresh("pack-1", payload, formatted_data=self.LINHAS)
        trim.assert_not_called()
        apply.assert_called_once()


class TestApplyPackWindowEdit(unittest.TestCase):
    def _run(self, current_anchor, slice_until, **kw):
        writes = []

        class _Sb(_FakeSb):
            def table(self, name):
                fl = super().table(name)
                orig = fl.execute

                def execute():
                    writes.extend([c for c in fl.calls if c[0] == "update"])
                    return orig()
                fl.execute = execute
                return fl

        sb = _Sb({"packs": lambda: _FakeResp([{"last_refreshed_at": current_anchor}])})
        supabase_repo.apply_pack_window_edit(
            None, "pack-1", "user-1",
            date_start="2026-06-01", date_stop="2026-08-31",
            slice_until=slice_until, sb_client=sb, **kw,
        )
        self.assertEqual(len(writes), 1)
        return writes[0][1][0]

    def test_ancora_nao_retrocede_em_fatia_para_tras(self) -> None:
        data = self._run("2026-08-31", "2026-07-07", auto_refresh_off=True)
        self.assertEqual(data["last_refreshed_at"], "2026-08-31")
        self.assertEqual((data["date_start"], data["date_stop"]), ("2026-06-01", "2026-08-31"))
        self.assertEqual(data["refresh_status"], "success")
        self.assertIsNone(data["refresh_lock_until"])
        self.assertFalse(data["auto_refresh"])

    def test_ancora_avanca_em_fatia_para_frente(self) -> None:
        data = self._run("2026-08-31", "2026-09-15", auto_refresh_off=False)
        self.assertEqual(data["last_refreshed_at"], "2026-09-15")
        self.assertNotIn("auto_refresh", data)

    def test_sem_ancora_gravada_usa_a_fatia(self) -> None:
        data = self._run(None, "2026-07-07", auto_refresh_off=False)
        self.assertEqual(data["last_refreshed_at"], "2026-07-07")


if __name__ == "__main__":
    unittest.main()
