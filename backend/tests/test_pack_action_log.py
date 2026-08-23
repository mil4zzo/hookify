# -*- coding: utf-8 -*-
"""Registro de autoria de acoes num pack (P3.5).

A tabela existe por uma razao unica: num pack compartilhado a credencial e do
DONO, entao a Meta atribui a acao do convidado ao dono. Se este modulo registrar
o silo em vez do ator, o Hookify repete dentro de casa exatamente a cegueira que
a tabela foi criada para corrigir — e ninguem percebe, porque a linha existe e
parece certa. E o que o primeiro teste trava.
"""
import unittest
from unittest import mock

from fastapi import HTTPException

from app.services import pack_action_log as PAL


class _Ctx:
    """Substituto de _WriteCtx com os campos que o registro le."""

    def __init__(self, *, user_id, actor_id, actor_role, pack_ids):
        self.user_id = user_id
        self.actor_id = actor_id
        self.actor_role = actor_role
        self.pack_ids = pack_ids


class TestAutoria(unittest.TestCase):
    def test_ator_e_quem_pediu_nao_o_silo_de_destino(self):
        """Convidado escreve no silo do dono: ator=convidado, owner=dono."""
        from app.routes import facebook as FB

        ctx = FB._WriteCtx(
            api=mock.Mock(), user_jwt=None, user_id="owner-uuid", allowed_ids=["ad1"],
            is_guest=True, actor_id="guest-uuid", actor_role="editor",
            pack_ids=("pack-1",),
        )
        with mock.patch.object(PAL, "log_pack_action") as logged:
            with FB._record_entity_action(ctx, PAL.ACTION_AD_STATUS, "ad", ["ad1"],
                                          detail={"to": "PAUSED"}):
                pass

        kwargs = logged.call_args.kwargs
        self.assertEqual(kwargs["actor_id"], "guest-uuid")
        self.assertEqual(kwargs["owner_id"], "owner-uuid")
        self.assertEqual(kwargs["actor_role"], "editor")

    def test_ctx_sem_ator_cai_no_silo_como_ultimo_recurso(self):
        """Caminho legado (dono agindo no proprio silo): ator == silo."""
        from app.routes import facebook as FB

        ctx = FB._WriteCtx(
            api=mock.Mock(), user_jwt="jwt", user_id="owner-uuid", allowed_ids=None,
            is_guest=False, actor_id="", actor_role="dono", pack_ids=("pack-1",),
        )
        with mock.patch.object(PAL, "log_pack_action") as logged:
            with FB._record_entity_action(ctx, PAL.ACTION_AD_STATUS, "ad", ["ad1"]):
                pass

        self.assertEqual(logged.call_args.kwargs["actor_id"], "owner-uuid")


class TestFormaDaLinha(unittest.TestCase):
    def test_bulk_grande_trunca_ids_mas_preserva_a_contagem(self):
        ids = [f"ad{i}" for i in range(500)]
        row = PAL.build_row(
            action=PAL.ACTION_AD_STATUS, actor_id="a", actor_role="dono", owner_id="o",
            pack_ids=["p"], target_ids=ids,
        )
        self.assertEqual(len(row["target_ids"]), PAL._MAX_TARGET_IDS)
        self.assertEqual(row["target_count"], 500)

    def test_erro_longo_e_cortado(self):
        row = PAL.build_row(
            action=PAL.ACTION_AD_STATUS, actor_id="a", actor_role="dono", owner_id="o",
            pack_ids=["p"], status="error", error="x" * 5000,
        )
        self.assertEqual(len(row["error"]), PAL._MAX_ERROR_CHARS)

    def test_ids_vazios_sao_descartados(self):
        row = PAL.build_row(
            action=PAL.ACTION_AD_STATUS, actor_id="a", actor_role="dono", owner_id="o",
            pack_ids=["p", "", None, "  "], target_ids=["ad1", "", None],
        )
        self.assertEqual(row["pack_ids"], ["p"])
        self.assertEqual(row["target_ids"], ["ad1"])


class TestNuncaDerrubaAAcao(unittest.TestCase):
    def test_sem_contexto_de_pack_nao_registra_e_nao_levanta(self):
        with mock.patch.object(PAL._persist_pool, "submit") as submit:
            PAL.log_pack_action(
                action=PAL.ACTION_AD_STATUS, actor_id="a", actor_role="dono",
                owner_id="o", pack_ids=[],
            )
        submit.assert_not_called()

    def test_falha_ao_montar_a_linha_e_engolida(self):
        with mock.patch.object(PAL, "build_row", side_effect=RuntimeError("boom")):
            PAL.log_pack_action(
                action=PAL.ACTION_AD_STATUS, actor_id="a", actor_role="dono",
                owner_id="o", pack_ids=["p"],
            )  # nao levanta

    def test_falha_do_insert_morre_na_thread(self):
        with mock.patch("app.core.supabase_client.get_supabase_service",
                        side_effect=RuntimeError("banco fora")):
            PAL._persist({"action": "x"})  # nao levanta


class TestDesfecho(unittest.TestCase):
    def test_sucesso_registra_ok(self):
        with mock.patch.object(PAL, "log_pack_action") as logged:
            with PAL.record_action(action=PAL.ACTION_PACK_JUDGMENT, actor_id="a",
                                   actor_role="dono", owner_id="o", pack_ids=["p"]):
                pass
        self.assertEqual(logged.call_args.kwargs["status"], "ok")

    def test_httpexception_registra_erro_com_a_mensagem_e_repropaga(self):
        with mock.patch.object(PAL, "log_pack_action") as logged:
            with self.assertRaises(HTTPException):
                with PAL.record_action(action=PAL.ACTION_AD_STATUS, actor_id="a",
                                       actor_role="editor", owner_id="o", pack_ids=["p"]):
                    raise HTTPException(status_code=409, detail={
                        "error": "parent_paused", "message": "O conjunto esta pausado."})

        kwargs = logged.call_args.kwargs
        self.assertEqual(kwargs["status"], "error")
        self.assertEqual(kwargs["error"], "O conjunto esta pausado.")

    def test_excecao_generica_tambem_registra(self):
        with mock.patch.object(PAL, "log_pack_action") as logged:
            with self.assertRaises(RuntimeError):
                with PAL.record_action(action=PAL.ACTION_AD_STATUS, actor_id="a",
                                       actor_role="editor", owner_id="o", pack_ids=["p"]):
                    raise RuntimeError("rede caiu")
        self.assertEqual(logged.call_args.kwargs["status"], "error")

    def test_dict_cedido_alimenta_detail_e_desfecho(self):
        with mock.patch.object(PAL, "log_pack_action") as logged:
            with PAL.record_action(action=PAL.ACTION_ADSET_BUDGET, actor_id="a",
                                   actor_role="dono", owner_id="o", pack_ids=["p"],
                                   detail={"daily_budget": 8000}) as extra:
                extra["from"] = 5000
                extra["status"] = "partial"

        kwargs = logged.call_args.kwargs
        self.assertEqual(kwargs["status"], "partial")
        self.assertEqual(kwargs["detail"], {"daily_budget": 8000, "from": 5000})


class TestLoteParcial(unittest.TestCase):
    """A Meta aceita lote parcial: 47 de 50 pausados volta como sucesso."""

    def test_tudo_certo_e_ok(self):
        from app.routes import facebook as FB

        entry = {}
        FB._mark_batch_outcome(entry, updated_ids=["a", "b"], failed_ids=[], blocked={})
        self.assertNotIn("status", entry)
        self.assertEqual(entry["target_count"], 2)

    def test_parte_falhou_e_partial_com_so_os_que_mudaram(self):
        from app.routes import facebook as FB

        entry = {}
        FB._mark_batch_outcome(entry, updated_ids=["a"], failed_ids=["b"], blocked={"c": "adset"})
        self.assertEqual(entry["status"], "partial")
        self.assertEqual(entry["target_ids"], ["a"])
        self.assertEqual(entry["target_count"], 1)

    def test_nada_mudou_e_erro(self):
        from app.routes import facebook as FB

        entry = {}
        FB._mark_batch_outcome(entry, updated_ids=[], failed_ids=["a", "b"], blocked={})
        self.assertEqual(entry["status"], "error")
        self.assertEqual(entry["target_count"], 0)


class TestVocabulario(unittest.TestCase):
    def test_todo_verbo_exportado_esta_no_conjunto_conhecido(self):
        """A UI traduz verbo -> texto; um verbo fora da lista apareceria cru."""
        exported = {
            v for k, v in vars(PAL).items()
            if k.startswith("ACTION_") and isinstance(v, str)
        }
        self.assertEqual(exported, set(PAL._KNOWN_ACTIONS))


if __name__ == "__main__":
    unittest.main()
