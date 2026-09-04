# -*- coding: utf-8 -*-
"""Migration 140 — colunas vinculadas da planilha: normalização, sugestão de tipo,
validação de entrada e o gate de papel das rotas de edição/exclusão.

O que este arquivo prova:
- número vira chave canônica ("80" e "80.0" são a MESMA chave; "1.000,50" → "1000.5");
- categoria é trim + colapso de espaços, com teto de valores distintos;
- tipo é sugerido pelas amostras e recusado quando a amostra prova que não cabe;
- leadscore exige corte; rótulo tem limite; tipo desconhecido é recusado;
- PUT/DELETE: viewer → 403 (o gate real é assert_pack_role, aqui simulado), integração
  sem pack só o dono, kind/column_index não passam pelo PUT.
"""
import unittest
from unittest import mock

from fastapi import HTTPException

from app.services import sheet_column_mappings as m
from app.services.pack_access import PackAccess


class TestNormalizacao(unittest.TestCase):
    def test_numero_inteiro_e_decimal(self):
        self.assertEqual(m.normalize_number("25"), "25")
        self.assertEqual(m.normalize_number("25.0"), "25")
        self.assertEqual(m.normalize_number("80,0"), "80")
        self.assertEqual(m.normalize_number("3.5"), "3.5")
        self.assertEqual(m.normalize_number("1.000,50"), "1000.5")
        self.assertEqual(m.normalize_number("3.14159265"), "3.141593")
        self.assertEqual(m.normalize_number("-0"), "0")

    def test_numero_invalido(self):
        self.assertIsNone(m.normalize_number("abc"))
        self.assertIsNone(m.normalize_number(""))
        self.assertIsNone(m.normalize_number(None))

    def test_categoria(self):
        self.assertEqual(m.normalize_category("  Faixa   B "), "Faixa B")
        self.assertEqual(m.normalize_category("a"), "a")  # caixa preservada
        self.assertIsNone(m.normalize_category("   "))
        self.assertIsNone(m.normalize_category("x" * (m.CATEGORY_MAX_LEN + 1)))


class TestSugestaoDeTipo(unittest.TestCase):
    def test_numerica(self):
        info = m.classify_samples(["1", "2", "", "3.5"])
        self.assertEqual(info["suggested"], "number")
        self.assertEqual(info["non_empty"], 3)

    def test_categoria(self):
        info = m.classify_samples(["A", "B", "A", ""])
        self.assertEqual(info["suggested"], "category")
        self.assertEqual(info["distinct"], 2)

    def test_texto_livre(self):
        values = [f"resposta {i}" for i in range(m.CATEGORY_MAX_DISTINCT + 1)]
        self.assertEqual(m.classify_samples(values)["suggested"], "text")

    def test_amostra_vazia(self):
        self.assertIsNone(m.classify_samples(["", None])["suggested"])
        self.assertIsNone(m.validate_kind_against_samples("number", ["", None]))

    def test_recusa_pelo_que_a_amostra_prova(self):
        self.assertIsNotNone(m.validate_kind_against_samples("number", ["1", "x"]))
        self.assertIsNone(m.validate_kind_against_samples("number", ["1", "2"]))
        many = [f"r{i}" for i in range(m.CATEGORY_MAX_DISTINCT + 1)]
        self.assertIsNotNone(m.validate_kind_against_samples("category", many))
        self.assertIsNone(m.validate_kind_against_samples("category", ["A", "B"]))


class TestEntradaDasRotas(unittest.TestCase):
    def test_kind(self):
        self.assertEqual(m.clean_kind(" Leadscore "), "leadscore")
        with self.assertRaises(m.SheetColumnMappingError):
            m.clean_kind("text")

    def test_label(self):
        self.assertEqual(m.clean_label("  Idade   do lead "), "Idade do lead")
        with self.assertRaises(m.SheetColumnMappingError):
            m.clean_label("   ")
        with self.assertRaises(m.SheetColumnMappingError):
            m.clean_label("x" * (m.LABEL_MAX_LEN + 1))

    def test_config_leadscore_exige_corte(self):
        with self.assertRaises(m.SheetColumnMappingError):
            m.clean_config("leadscore", None)
        with self.assertRaises(m.SheetColumnMappingError):
            m.clean_config("leadscore", -1)
        self.assertEqual(m.clean_config("leadscore", "70"), {"mql_min": 70.0})
        self.assertEqual(m.clean_config("number", 70), {})
        self.assertEqual(m.clean_config("category", None), {})


class _FakeResp:
    def __init__(self, data):
        self.data = data


class _Fluent:
    def __init__(self, on_execute, log, name):
        self._on_execute = on_execute
        self._log = log
        self._name = name

    def __getattr__(self, name):
        def _chain(*args, **kwargs):
            self._log.append((self._name, name, args, kwargs))
            return self

        return _chain

    def execute(self):
        return self._on_execute()


class _FakeSb:
    def __init__(self, responses):
        self._responses = responses
        self.log = []

    def table(self, name):
        return _Fluent(self._responses.get(name, lambda: _FakeResp([])), self.log, name)


MAPPING = {
    "id": "map-1", "integration_id": "integ-1", "owner_id": "owner-1", "column_index": 7,
    "column_name": "IDADE", "label": "Idade", "kind": "number", "config": {}, "position": 0,
}
LS_MAPPING = {**MAPPING, "id": "map-ls", "kind": "leadscore", "label": "LS V2", "config": {"mql_min": 70}}


class TestRotasDeVinculo(unittest.TestCase):
    def _svc(self, integ, mapping):
        return _FakeSb({
            "ad_sheet_integrations": lambda: _FakeResp([integ] if integ else []),
            "sheet_column_mappings": lambda: _FakeResp([mapping] if mapping else []),
        })

    def _put(self, *, integ, mapping, gate, payload, actor="guest-9"):
        from app.routes.google_integration import SheetColumnMappingPatch, update_sheet_column_mapping

        sb = self._svc(integ, mapping)
        with mock.patch("app.routes.google_integration.get_supabase_service", return_value=sb), \
             mock.patch("app.routes.google_integration.assert_pack_role", gate):
            return update_sheet_column_mapping("integ-1", mapping["id"] if mapping else "map-x",
                                               SheetColumnMappingPatch(**payload), user={"token": "jwt", "user_id": actor}), sb

    def test_viewer_leva_403_no_put(self):
        gate = mock.Mock(side_effect=HTTPException(status_code=403, detail="viewer"))
        with self.assertRaises(HTTPException) as ctx:
            self._put(integ={"id": "integ-1", "owner_id": "owner-1", "pack_id": "pack-1"},
                      mapping=MAPPING, gate=gate, payload={"label": "Idade 2"})
        self.assertEqual(ctx.exception.status_code, 403)
        gate.assert_called_once_with("guest-9", "pack-1")

    def test_editor_edita_rotulo(self):
        gate = mock.Mock(return_value=PackAccess(role="editor", owner_id="owner-1"))
        result, sb = self._put(integ={"id": "integ-1", "owner_id": "owner-1", "pack_id": "pack-1"},
                               mapping=MAPPING, gate=gate, payload={"label": "  Idade do lead "})
        self.assertEqual(result["mapping"]["id"], "map-1")
        updates = [entry for entry in sb.log if entry[0] == "sheet_column_mappings" and entry[1] == "update"]
        self.assertEqual(len(updates), 1)
        self.assertEqual(updates[0][2][0], {"label": "Idade do lead"})

    def test_corte_so_em_leadscore(self):
        gate = mock.Mock(return_value=PackAccess(role="dono", owner_id="owner-1"))
        with self.assertRaises(HTTPException) as ctx:
            self._put(integ={"id": "integ-1", "owner_id": "owner-1", "pack_id": "pack-1"},
                      mapping=MAPPING, gate=gate, payload={"mql_min": 50})
        self.assertEqual(ctx.exception.status_code, 400)
        result, sb = self._put(integ={"id": "integ-1", "owner_id": "owner-1", "pack_id": "pack-1"},
                               mapping=LS_MAPPING, gate=gate, payload={"mql_min": 50})
        updates = [entry for entry in sb.log if entry[0] == "sheet_column_mappings" and entry[1] == "update"]
        self.assertEqual(updates[0][2][0], {"config": {"mql_min": 50.0}})

    def test_put_nao_aceita_kind_nem_coluna(self):
        from app.routes.google_integration import SheetColumnMappingPatch

        fields = set(SheetColumnMappingPatch.model_fields.keys())
        self.assertNotIn("kind", fields)
        self.assertNotIn("column_index", fields)

    def test_integracao_sem_pack_so_o_dono(self):
        gate = mock.Mock()
        with self.assertRaises(HTTPException) as ctx:
            self._put(integ={"id": "integ-1", "owner_id": "owner-1", "pack_id": None},
                      mapping=MAPPING, gate=gate, payload={"label": "x"}, actor="guest-9")
        self.assertEqual(ctx.exception.status_code, 404)
        gate.assert_not_called()
        result, _ = self._put(integ={"id": "integ-1", "owner_id": "owner-1", "pack_id": None},
                              mapping=MAPPING, gate=gate, payload={"label": "x"}, actor="owner-1")
        self.assertEqual(result["mapping"]["id"], "map-1")

    def test_delete_registra_autoria_com_o_papel(self):
        from app.routes.google_integration import delete_sheet_column_mapping

        gate = mock.Mock(return_value=PackAccess(role="editor", owner_id="owner-1"))
        sb = self._svc({"id": "integ-1", "owner_id": "owner-1", "pack_id": "pack-1"}, MAPPING)
        with mock.patch("app.routes.google_integration.get_supabase_service", return_value=sb), \
             mock.patch("app.routes.google_integration.assert_pack_role", gate), \
             mock.patch("app.routes.google_integration.pack_action_log.log_pack_action") as log:
            result = delete_sheet_column_mapping("integ-1", "map-1", user={"token": "jwt", "user_id": "guest-9"})
        self.assertTrue(result["success"])
        deletes = [entry for entry in sb.log if entry[0] == "sheet_column_mappings" and entry[1] == "delete"]
        self.assertEqual(len(deletes), 1)
        log.assert_called_once()
        self.assertEqual(log.call_args.kwargs["actor_role"], "editor")
        self.assertEqual(log.call_args.kwargs["action"], "pack.sheet_columns")


class TestReconcile(unittest.TestCase):
    """Save da integração com `column_mappings`: valida tudo antes de escrever."""

    def _run(self, wanted, existing, *, ad_idx=0, date_idx=1):
        from app.routes.google_integration import (
            SheetColumnMappingInput, SheetIntegrationRequest, _reconcile_column_mappings,
        )

        sb = _FakeSb({"sheet_column_mappings": lambda: _FakeResp(existing)})
        payload = SheetIntegrationRequest(
            spreadsheet_id="s", worksheet_title="w", ad_id_column="AD", date_column="DATA",
            date_format="DD/MM/YYYY", leadscore_column="LS", ad_id_column_index=ad_idx,
            date_column_index=date_idx, leadscore_column_index=2,
            column_mappings=[SheetColumnMappingInput(**w) for w in wanted],
        )
        with mock.patch("app.services.sheet_column_mappings.list_for_integrations", return_value={"integ-1": []}):
            _reconcile_column_mappings(sb, owner_id="owner-1", integration_id="integ-1", payload=payload)
        return sb.log

    def test_cria_atualiza_e_exclui(self):
        existing = [dict(MAPPING), {**MAPPING, "id": "map-2", "column_index": 8, "label": "Velho"}]
        log = self._run(
            [
                {"id": "map-1", "column_index": 7, "label": "Idade nova", "kind": "number"},
                {"column_index": 9, "label": "Faixa", "kind": "category"},
            ],
            existing,
        )
        ops = [(e[1], e[2][0] if e[2] else None) for e in log if e[0] == "sheet_column_mappings" and e[1] in ("insert", "update", "delete")]
        kinds = [op for op, _ in ops]
        self.assertEqual(kinds, ["delete", "update", "insert"])
        self.assertEqual(ops[1][1]["label"], "Idade nova")
        self.assertEqual(ops[2][1][0]["column_index"], 9)
        self.assertEqual(ops[2][1][0]["kind"], "category")

    def test_tipo_e_de_mao_unica(self):
        with self.assertRaises(HTTPException) as ctx:
            self._run([{"id": "map-1", "column_index": 7, "label": "Idade", "kind": "category"}], [dict(MAPPING)])
        self.assertEqual(ctx.exception.status_code, 400)

    def test_coluna_de_ad_id_e_data_sao_recusadas(self):
        with self.assertRaises(HTTPException):
            self._run([{"column_index": 0, "label": "x", "kind": "number"}], [])
        with self.assertRaises(HTTPException):
            self._run([{"column_index": 1, "label": "x", "kind": "number"}], [])
        # a coluna do leadscore V1 PODE (comparação V1 × V2 lado a lado)
        self._run([{"column_index": 2, "label": "LS V2", "kind": "leadscore", "mql_min": 80}], [])

    def test_leadscore_sem_corte_e_indice_repetido(self):
        with self.assertRaises(HTTPException):
            self._run([{"column_index": 5, "label": "LS", "kind": "leadscore"}], [])
        with self.assertRaises(HTTPException):
            self._run([
                {"column_index": 5, "label": "A", "kind": "number"},
                {"column_index": 5, "label": "B", "kind": "number"},
            ], [])

    def test_nada_e_escrito_quando_um_vinculo_falha(self):
        from app.routes.google_integration import (
            SheetColumnMappingInput, SheetIntegrationRequest, _reconcile_column_mappings,
        )

        sb = _FakeSb({"sheet_column_mappings": lambda: _FakeResp([dict(MAPPING)])})
        payload = SheetIntegrationRequest(
            spreadsheet_id="s", worksheet_title="w", ad_id_column="AD", date_column="DATA",
            date_format="DD/MM/YYYY", leadscore_column="LS",
            column_mappings=[
                SheetColumnMappingInput(column_index=9, label="ok", kind="number"),
                SheetColumnMappingInput(column_index=10, label="ruim", kind="leadscore"),  # sem corte
            ],
        )
        with self.assertRaises(HTTPException):
            _reconcile_column_mappings(sb, owner_id="owner-1", integration_id="integ-1", payload=payload)
        writes = [e for e in sb.log if e[0] == "sheet_column_mappings" and e[1] in ("insert", "update", "delete")]
        self.assertEqual(writes, [])


if __name__ == "__main__":
    unittest.main()
