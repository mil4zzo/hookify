"""
Testa a reconciliação do verify pós-write de status e o retry com backoff.

Contexto: o read-after-write de `effective_status` no Meta é eventualmente consistente —
medido ~18% de leituras transitórias (IN_PROCESS) logo após um batch de pause. Congelar
essa leitura como verdade (cache local + resposta ao frontend) era a causa do toggle
"pausado com sucesso" que continuava ativo mesmo após F5.

Regras cobertas:
- `_reconcile_verified_status`: matriz de leituras impossíveis/transitórias vs informativas.
- Individual (`_activate_or_pause`): retry até assentar; esgotado → vale o status pedido.
- Batch (`batch_update_ad_status`): retry só dos não-assentados; esgotado → status pedido.
- `_read_effective_statuses`: leitura filtrada por conta com fallback em Batch GET.
"""

import unittest
from unittest.mock import patch

from app.services.graph_api import GraphAPI, _reconcile_verified_status


class TestReconcileVerifiedStatus(unittest.TestCase):
    def test_pause_rejects_active_and_in_process(self):
        # ACTIVE após pausa aceita é impossível (leitura defasada); IN_PROCESS é transitório.
        self.assertIsNone(_reconcile_verified_status("PAUSED", "ACTIVE"))
        self.assertIsNone(_reconcile_verified_status("PAUSED", "IN_PROCESS"))

    def test_activate_rejects_paused_and_in_process(self):
        # PAUSED como effective_status significa pausa PRÓPRIA — impossível após ativação aceita.
        self.assertIsNone(_reconcile_verified_status("ACTIVE", "PAUSED"))
        self.assertIsNone(_reconcile_verified_status("ACTIVE", "IN_PROCESS"))

    def test_informative_states_are_accepted(self):
        # Estados que o write NÃO afeta — a razão de ser do verify — passam direto.
        for verified in ("ADSET_PAUSED", "CAMPAIGN_PAUSED", "PENDING_REVIEW", "WITH_ISSUES", "DISAPPROVED"):
            self.assertEqual(_reconcile_verified_status("ACTIVE", verified), verified)
            self.assertEqual(_reconcile_verified_status("PAUSED", verified), verified)

    def test_settled_expected_values_are_accepted(self):
        self.assertEqual(_reconcile_verified_status("PAUSED", "PAUSED"), "PAUSED")
        self.assertEqual(_reconcile_verified_status("ACTIVE", "ACTIVE"), "ACTIVE")

    def test_empty_is_unsettled(self):
        self.assertIsNone(_reconcile_verified_status("PAUSED", None))
        self.assertIsNone(_reconcile_verified_status("PAUSED", ""))

    def test_case_insensitive(self):
        self.assertIsNone(_reconcile_verified_status("paused", "in_process"))
        self.assertEqual(_reconcile_verified_status("active", "adset_paused"), "ADSET_PAUSED")


class _RetryStubGraphAPI(GraphAPI):
    """Verify scriptado por sequência: cada get_entity_status consome o próximo valor."""

    def __init__(self, verify_sequence):
        super().__init__(access_token="tok", user_id="u1")
        self._verify_sequence = list(verify_sequence)
        self.get_calls = 0
        self.write_calls = 0

    def get_entity_status(self, entity_id):  # type: ignore[override]
        self.get_calls += 1
        eff = self._verify_sequence.pop(0) if self._verify_sequence else None
        return {"status": "success", "own_status": eff, "effective_status": eff}

    def _update_entity_status(self, entity_id, status):  # type: ignore[override]
        self.write_calls += 1
        return {"status": "success", "data": {"success": True}}


@patch("app.services.graph_api.time.sleep")
class TestActivateOrPauseRetry(unittest.TestCase):
    def test_transient_in_process_settles_on_retry(self, mock_sleep):
        api = _RetryStubGraphAPI(["IN_PROCESS", "PAUSED"])
        res = api._activate_or_pause("123", "PAUSED", "ad")
        self.assertEqual(res["status"], "success")
        self.assertEqual(res["effective_status"], "PAUSED")
        self.assertEqual(api.get_calls, 2)
        # 1ª leitura imediata (delay 0), retry com backoff de 2s.
        self.assertEqual([c.args[0] for c in mock_sleep.call_args_list], [2.0])

    def test_exhausted_retries_fall_back_to_requested(self, mock_sleep):
        # Meta lento: todas as releituras vêm defasadas (ACTIVE após pausa aceita).
        api = _RetryStubGraphAPI(["ACTIVE", "IN_PROCESS", "ACTIVE"])
        res = api._activate_or_pause("123", "PAUSED", "ad")
        self.assertEqual(res["status"], "success")
        # Nunca congela a leitura impossível: vale o status pedido (write aceito).
        self.assertEqual(res["effective_status"], "PAUSED")
        self.assertEqual(api.get_calls, 3)
        self.assertEqual([c.args[0] for c in mock_sleep.call_args_list], [2.0, 3.0])

    def test_settled_first_read_does_not_retry(self, mock_sleep):
        api = _RetryStubGraphAPI(["PAUSED"])
        res = api._activate_or_pause("123", "PAUSED", "ad")
        self.assertEqual(res["effective_status"], "PAUSED")
        self.assertEqual(api.get_calls, 1)
        mock_sleep.assert_not_called()

    def test_activate_stale_paused_falls_back_to_active(self, mock_sleep):
        # Caminho inverso: ativar com releitura presa em PAUSED (pausa própria é impossível
        # após ativação aceita) → ACTIVE. Pre-check consome a 1ª leitura da sequência.
        api = _RetryStubGraphAPI(["PAUSED", "PAUSED", "PAUSED", "PAUSED"])
        res = api._activate_or_pause("123", "ACTIVE", "ad")
        self.assertEqual(res["status"], "success")
        self.assertEqual(res["effective_status"], "ACTIVE")

    def test_activate_verify_parent_paused_blocks_without_retry(self, mock_sleep):
        # ADSET_PAUSED é informativo (não transitório): aceita na 1ª leitura e bloqueia.
        api = _RetryStubGraphAPI(["PAUSED", "ADSET_PAUSED"])
        res = api._activate_or_pause("123", "ACTIVE", "ad")
        self.assertEqual(res["status"], "blocked")
        self.assertEqual(res["reason"], "adset")
        mock_sleep.assert_not_called()


class _BatchRetryStubGraphAPI(GraphAPI):
    """Batch com verify scriptado por RODADA: rounds[i] responde a i-ésima leitura pós-write."""

    def __init__(self, verify_rounds, pre_map=None):
        super().__init__(access_token="tok", user_id="u1")
        self._verify_rounds = [dict(r) for r in verify_rounds]
        self._pre_map = dict(pre_map or {})
        self.written = None
        self.read_rounds = []  # ids pedidos em cada leitura pós-write

    def batch_get_effective_status(self, ad_ids, **kwargs):  # type: ignore[override]
        if self.written is None:
            source = self._pre_map
        else:
            self.read_rounds.append(list(ad_ids))
            source = self._verify_rounds.pop(0) if self._verify_rounds else {}
        return {"status": "success", "statuses": {aid: source[aid] for aid in ad_ids if aid in source}}

    def _batch_write_status(self, ad_ids, status):  # type: ignore[override]
        self.written = list(ad_ids)
        return {"status": "success", "updated_ids": list(ad_ids), "failed_ids": []}


@patch("app.services.graph_api.time.sleep")
class TestBatchUpdateRetry(unittest.TestCase):
    def test_only_unsettled_ids_are_retried(self, mock_sleep):
        api = _BatchRetryStubGraphAPI(
            verify_rounds=[
                {"a": "PAUSED", "b": "IN_PROCESS"},  # rodada 1: b transitório
                {"b": "PAUSED"},                       # rodada 2: b assentou
            ],
        )
        res = api.batch_update_ad_status(["a", "b"], "PAUSED")
        self.assertEqual(res["verified_statuses"], {"a": "PAUSED", "b": "PAUSED"})
        # A 2ª rodada relê SÓ o não-assentado.
        self.assertEqual(api.read_rounds, [["a", "b"], ["b"]])
        self.assertEqual([c.args[0] for c in mock_sleep.call_args_list], [2.0])

    def test_exhausted_ids_assume_requested_status(self, mock_sleep):
        api = _BatchRetryStubGraphAPI(
            verify_rounds=[{"a": "IN_PROCESS"}, {"a": "ACTIVE"}, {"a": "IN_PROCESS"}],
        )
        res = api.batch_update_ad_status(["a"], "PAUSED")
        # ACTIVE (rodada 2) contradiz o write aceito e IN_PROCESS é transitório: esgotou → PAUSED.
        self.assertEqual(res["verified_statuses"], {"a": "PAUSED"})
        self.assertEqual([c.args[0] for c in mock_sleep.call_args_list], [2.0, 3.0])

    def test_unreadable_ids_are_not_retried(self, mock_sleep):
        # Ausente da leitura (fail-open) ≠ não-assentado: fica sem verify (heurística no caller).
        api = _BatchRetryStubGraphAPI(verify_rounds=[{}])
        res = api.batch_update_ad_status(["x"], "PAUSED")
        self.assertEqual(res["verified_statuses"], {})
        mock_sleep.assert_not_called()

    def test_activate_reclassifies_blocked_after_settled_verify(self, mock_sleep):
        # Pre-check fail-open; verify assentado mostra pausa herdada → blocked (sem retry).
        api = _BatchRetryStubGraphAPI(verify_rounds=[{"x": "ADSET_PAUSED", "y": "ACTIVE"}])
        res = api.batch_update_ad_status(["x", "y"], "ACTIVE")
        self.assertEqual(res["blocked"], {"x": "adset"})
        self.assertEqual(res["updated_ids"], ["y"])
        mock_sleep.assert_not_called()


class _FilteredReadStubGraphAPI(GraphAPI):
    """Stub para _read_effective_statuses: leitura filtrada por conta + fallback batch."""

    def __init__(self, by_account, batch_map=None):
        super().__init__(access_token="tok", user_id="u1")
        self._by_account = by_account  # {act_id: {ad_id: status}}
        self._batch_map = dict(batch_map or {})
        self.filtered_calls = []
        self.batch_calls = []

    def get_ad_statuses_by_ids(self, act_id, ad_ids, **kwargs):  # type: ignore[override]
        self.filtered_calls.append((act_id, list(ad_ids)))
        source = self._by_account.get(act_id, {})
        return {"status": "success", "statuses": {aid: source[aid] for aid in ad_ids if aid in source}}

    def batch_get_effective_status(self, ad_ids, **kwargs):  # type: ignore[override]
        self.batch_calls.append(list(ad_ids))
        return {"status": "success", "statuses": {aid: self._batch_map[aid] for aid in ad_ids if aid in self._batch_map}}


class TestReadEffectiveStatuses(unittest.TestCase):
    def test_groups_read_via_filtered_edge_one_call_per_account(self):
        api = _FilteredReadStubGraphAPI({
            "act_1": {"a": "PAUSED", "b": "PAUSED"},
            "act_2": {"c": "ACTIVE"},
        })
        res = api._read_effective_statuses(
            ["a", "b", "c"], account_groups={"act_1": ["a", "b"], "act_2": ["c"]}
        )
        self.assertEqual(res["statuses"], {"a": "PAUSED", "b": "PAUSED", "c": "ACTIVE"})
        self.assertEqual(len(api.filtered_calls), 2)
        # Tudo coberto pela leitura filtrada → nenhum fallback via Batch API.
        self.assertEqual(api.batch_calls, [])

    def test_missing_ids_fall_back_to_batch_get(self):
        # Conta rejeitou o filtro (ou ad não retornou): o id ausente cai no Batch GET —
        # se a Meta não suportar ad.id no filtering, degrada exatamente para o fluxo atual.
        api = _FilteredReadStubGraphAPI({"act_1": {"a": "PAUSED"}}, batch_map={"b": "PAUSED"})
        res = api._read_effective_statuses(["a", "b"], account_groups={"act_1": ["a", "b"]})
        self.assertEqual(res["statuses"], {"a": "PAUSED", "b": "PAUSED"})
        self.assertEqual(api.batch_calls, [["b"]])

    def test_without_groups_uses_batch_get_only(self):
        api = _FilteredReadStubGraphAPI({}, batch_map={"a": "PAUSED"})
        res = api._read_effective_statuses(["a"])
        self.assertEqual(res["statuses"], {"a": "PAUSED"})
        self.assertEqual(api.filtered_calls, [])
        self.assertEqual(api.batch_calls, [["a"]])


if __name__ == "__main__":
    unittest.main()
