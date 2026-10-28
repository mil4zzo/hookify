"""
Ajuste de orçamento em lote: `compute_budget_target` (cálculo puro) e
`GraphAPI.batch_update_entity_budget` (lê vigente → escreve → relê, em Batch API).

O que precisa valer:
- percentual incide sobre o valor VIGENTE, arredonda ao centavo (meio para cima) e vale
  para diário e total;
- soma/valor fixo pulam quem tem o outro tipo de orçamento; sem budget próprio é pulado;
- resultado ≤ 0 falha sem escrever; resultado igual ao vigente não escreve;
- o verify relê TAMBÉM os que voltaram com erro no write: timeout aplicado na Meta conta
  como atualizado (é isso que torna o "tentar de novo" seguro);
- recusa da Meta volta com a mensagem amigável; sem resposta nem releitura = "unconfirmed".
"""

import json
import unittest

from app.services.graph_api import GraphAPI, compute_budget_target


class TestComputeBudgetTarget(unittest.TestCase):
    def test_percent_rounds_half_up_to_cent(self):
        # R$ 33,33 + 15% = 38,3295 → 38,33
        t = compute_budget_target(3333, None, mode="percent", percent=15)
        self.assertEqual(t, {"outcome": "write", "field": "daily_budget", "value": 3833, "current": 3333})
        # 0,5 centavo sobe: 1003 × 1,5 = 1504,5 → 1505 (arredondamento bancário daria 1504)
        self.assertEqual(compute_budget_target(1003, None, mode="percent", percent=50)["value"], 1505)

    def test_percent_applies_to_lifetime_in_its_own_type(self):
        t = compute_budget_target(None, 100000, mode="percent", percent=-20)
        self.assertEqual((t["outcome"], t["field"], t["value"]), ("write", "lifetime_budget", 80000))

    def test_percent_float_is_not_binary_rounded(self):
        # 10,1% em float binário vira 10,0999…; Decimal(str()) mantém exato.
        self.assertEqual(compute_budget_target(10000, None, mode="percent", percent=10.1)["value"], 11010)
        # Mesmo caso do teste do frontend (applyBudgetPercent): 50 × 1,15 = 57,5 → 58.
        self.assertEqual(compute_budget_target(50, None, mode="percent", percent=15)["value"], 58)

    def test_delta_and_fixed(self):
        self.assertEqual(compute_budget_target(10000, None, mode="delta", amount=5000, budget_type="daily")["value"], 15000)
        self.assertEqual(compute_budget_target(10000, None, mode="delta", amount=-2500, budget_type="daily")["value"], 7500)
        self.assertEqual(compute_budget_target(10000, None, mode="fixed", amount=20000, budget_type="daily")["value"], 20000)

    def test_money_modes_skip_other_budget_type(self):
        t = compute_budget_target(None, 50000, mode="fixed", amount=20000, budget_type="daily")
        self.assertEqual((t["outcome"], t["reason"]), ("skipped", "type_mismatch"))
        t = compute_budget_target(10000, None, mode="delta", amount=100, budget_type="lifetime")
        self.assertEqual(t["outcome"], "skipped")

    def test_no_own_budget_is_skipped(self):
        t = compute_budget_target(None, None, mode="percent", percent=10)
        self.assertEqual((t["outcome"], t["reason"]), ("skipped", "no_own_budget"))

    def test_non_positive_result_fails(self):
        t = compute_budget_target(10000, None, mode="delta", amount=-10000, budget_type="daily")
        self.assertEqual((t["outcome"], t["reason"]), ("failed", "invalid_value"))

    def test_same_value_is_unchanged(self):
        self.assertEqual(compute_budget_target(10000, None, mode="fixed", amount=10000, budget_type="daily")["outcome"], "unchanged")
        # 1 centavo + 1% = 1,01 centavo → arredonda para 1: nada a escrever
        self.assertEqual(compute_budget_target(1, None, mode="percent", percent=1)["outcome"], "unchanged")


def _ok_body(body):
    return {"ok": True, "body": body, "error": {}}


def _err(error):
    return {"ok": False, "body": {}, "error": error}


class _StubBatchAPI(GraphAPI):
    """
    Simula a Meta: `state` é o orçamento vivo por id. GETs leem o estado; POSTs aplicam
    (ou não) conforme `write_behavior[id]`: "ok" | ("reject", err) | "timeout_applied" |
    "timeout_lost". `unreadable_after_write` simula releitura falhando.
    """

    def __init__(self, state, write_behavior=None, unreadable_after_write=()):
        super().__init__(access_token="tok", user_id="u1")
        self.state = {k: dict(v) for k, v in state.items()}
        self.write_behavior = write_behavior or {}
        self.unreadable_after_write = set(unreadable_after_write)
        self.calls = []

    def _batch_graph(self, items, operation_name):  # type: ignore[override]
        results = {}
        is_write = items and items[0][1]["method"] == "POST"
        self.calls.append(("POST" if is_write else "GET", [eid for eid, _ in items]))
        writes_done = sum(1 for kind, _ in self.calls if kind == "POST") > 0
        for eid, item in items:
            if is_write:
                field, value = item["body"].split("=")
                behavior = self.write_behavior.get(eid, "ok")
                if behavior == "ok":
                    self.state[eid][field] = int(value)
                    results[eid] = _ok_body({"success": True})
                elif behavior == "timeout_applied":
                    self.state[eid][field] = int(value)
                    results[eid] = _err({"message": "Sem resposta da Meta"})
                elif behavior == "timeout_lost":
                    results[eid] = _err({"message": "Sem resposta da Meta"})
                else:
                    results[eid] = _err(behavior[1])
            else:
                if eid not in self.state or (writes_done and eid in self.unreadable_after_write):
                    results[eid] = _err({"code": 100, "message": "Unsupported get request"})
                    continue
                s = self.state[eid]
                body = {k: str(v) for k, v in s.items() if v is not None}
                results[eid] = _ok_body(body)
        return {"status": "success", "results": results}


class TestBatchUpdateEntityBudget(unittest.TestCase):
    def _by_id(self, result):
        return {it["id"]: it for it in result["items"]}

    def test_mixed_lot_each_with_its_outcome(self):
        api = _StubBatchAPI({
            "c1": {"daily_budget": 10000},
            "c2": {"lifetime_budget": 500000},
            "c3": {},                                   # ABO: sem budget próprio
            "c4": {"daily_budget": 10000},
        }, write_behavior={"c4": ("reject", {"code": 100, "error_user_title": "Orçamento baixo", "error_user_msg": "Mínimo R$ 6,00"})})
        result = api.batch_update_entity_budget(["c1", "c2", "c3", "c4"], "campaign", mode="percent", percent=10)
        items = self._by_id(result)
        self.assertEqual([it["id"] for it in result["items"]], ["c1", "c2", "c3", "c4"])  # ordem preservada
        self.assertEqual((items["c1"]["outcome"], items["c1"]["daily_budget"], items["c1"]["before_daily"]), ("updated", 11000, 10000))
        self.assertEqual((items["c2"]["outcome"], items["c2"]["lifetime_budget"]), ("updated", 550000))
        self.assertEqual((items["c3"]["outcome"], items["c3"]["reason"]), ("skipped", "no_own_budget"))
        self.assertEqual((items["c4"]["outcome"], items["c4"]["reason"]), ("failed", "meta_error"))
        self.assertEqual(items["c4"]["message"], "Orçamento baixo — Mínimo R$ 6,00")
        self.assertEqual(items["c4"]["daily_budget"], 10000)  # verdade relida: não mudou
        # 3 viagens: lê todos, escreve 3, relê os 3 que tentaram (inclusive o recusado)
        self.assertEqual([k for k, _ in api.calls], ["GET", "POST", "GET"])
        self.assertEqual(api.calls[1][1], ["c1", "c2", "c4"])
        self.assertEqual(api.calls[2][1], ["c1", "c2", "c4"])

    def test_timeout_that_applied_counts_as_updated(self):
        api = _StubBatchAPI({"a1": {"daily_budget": 10000}}, write_behavior={"a1": "timeout_applied"})
        items = self._by_id(api.batch_update_entity_budget(["a1"], "adset", mode="percent", percent=10))
        self.assertEqual((items["a1"]["outcome"], items["a1"]["daily_budget"], items["a1"]["verified"]), ("updated", 11000, True))

    def test_retry_after_lost_timeout_applies_once(self):
        # 1ª tentativa perdeu o write; a 2ª parte do vigente (inalterado) → +10% uma vez só.
        api = _StubBatchAPI({"a1": {"daily_budget": 10000}}, write_behavior={"a1": "timeout_lost"})
        first = self._by_id(api.batch_update_entity_budget(["a1"], "adset", mode="percent", percent=10))
        self.assertEqual(first["a1"]["outcome"], "failed")
        api.write_behavior = {}
        second = self._by_id(api.batch_update_entity_budget(["a1"], "adset", mode="percent", percent=10))
        self.assertEqual(second["a1"]["daily_budget"], 11000)

    def test_unconfirmed_when_no_write_answer_and_no_read_back(self):
        api = _StubBatchAPI({"a1": {"daily_budget": 10000}}, write_behavior={"a1": "timeout_lost"}, unreadable_after_write=["a1"])
        items = self._by_id(api.batch_update_entity_budget(["a1"], "adset", mode="percent", percent=10))
        self.assertEqual((items["a1"]["outcome"], items["a1"]["reason"]), ("failed", "unconfirmed"))

    def test_write_ok_but_read_back_failed_is_unverified_update(self):
        api = _StubBatchAPI({"a1": {"daily_budget": 10000}}, unreadable_after_write=["a1"])
        items = self._by_id(api.batch_update_entity_budget(["a1"], "adset", mode="fixed", amount=20000, budget_type="daily"))
        self.assertEqual((items["a1"]["outcome"], items["a1"]["verified"], items["a1"]["daily_budget"]), ("updated", False, None))

    def test_unreadable_before_write_fails_without_writing(self):
        api = _StubBatchAPI({"a1": {"daily_budget": 10000}})
        items = self._by_id(api.batch_update_entity_budget(["a1", "ghost"], "adset", mode="percent", percent=10))
        self.assertEqual((items["ghost"]["outcome"], items["ghost"]["reason"]), ("failed", "read_failed"))
        self.assertEqual(api.calls[1][1], ["a1"])  # ghost nunca é escrito

    def test_nothing_to_write_makes_single_read(self):
        api = _StubBatchAPI({"a1": {"daily_budget": 10000}, "a2": {"lifetime_budget": 900}})
        items = self._by_id(api.batch_update_entity_budget(["a1", "a2"], "adset", mode="fixed", amount=10000, budget_type="daily"))
        self.assertEqual(items["a1"]["outcome"], "unchanged")
        self.assertEqual((items["a2"]["outcome"], items["a2"]["reason"]), ("skipped", "type_mismatch"))
        self.assertEqual([k for k, _ in api.calls], ["GET"])

    def test_auth_error_propagates(self):
        class _Auth(_StubBatchAPI):
            def _batch_graph(self, items, operation_name):  # type: ignore[override]
                return {"status": "auth_error", "message": "expirado"}

        api = _Auth({"a1": {"daily_budget": 10000}})
        self.assertEqual(api.batch_update_entity_budget(["a1"], "adset", mode="percent", percent=10)["status"], "auth_error")

    def test_auth_lost_mid_write_keeps_what_was_applied(self):
        # Token cai depois do 1º chunk de writes: a1 já foi aplicado na Meta. Um 401 inteiro
        # faria a tela oferecer repetir o +10% — a1 tem que sair "updated" e a2 "unconfirmed".
        class _AuthMidWrite(_StubBatchAPI):
            def _batch_graph(self, items, operation_name):  # type: ignore[override]
                if items and items[0][1]["method"] == "POST":
                    partial = super()._batch_graph(items[:1], operation_name)
                    return {"status": "auth_error", "message": "expirado", "results": partial["results"]}
                if any(kind == "POST" for kind, _ in self.calls):
                    return {"status": "auth_error", "message": "expirado", "results": {}}
                return super()._batch_graph(items, operation_name)

        api = _AuthMidWrite({"a1": {"daily_budget": 10000}, "a2": {"daily_budget": 10000}})
        result = api.batch_update_entity_budget(["a1", "a2"], "adset", mode="percent", percent=10)
        self.assertEqual(result["status"], "success")
        items = self._by_id(result)
        self.assertEqual((items["a1"]["outcome"], items["a1"]["verified"]), ("updated", False))
        self.assertEqual((items["a2"]["outcome"], items["a2"]["reason"]), ("failed", "unconfirmed"))
        self.assertIn("expirou", items["a2"]["message"])

    def test_auth_lost_on_verify_does_not_drop_applied_writes(self):
        class _AuthOnVerify(_StubBatchAPI):
            def _batch_graph(self, items, operation_name):  # type: ignore[override]
                if items and items[0][1]["method"] == "GET" and any(kind == "POST" for kind, _ in self.calls):
                    return {"status": "auth_error", "message": "expirado", "results": {}}
                return super()._batch_graph(items, operation_name)

        api = _AuthOnVerify({"a1": {"daily_budget": 10000}})
        result = api.batch_update_entity_budget(["a1"], "adset", mode="percent", percent=10)
        self.assertEqual(result["status"], "success")
        self.assertEqual(self._by_id(result)["a1"]["outcome"], "updated")


class TestBatchGraphParsing(unittest.TestCase):
    """O parser real do Batch API (só o requests.post é simulado)."""

    def test_per_item_error_and_auth_abort(self):
        import app.services.graph_api as mod

        class _Resp:
            def __init__(self, payload):
                self._payload = payload

            def raise_for_status(self):
                return None

            def json(self):
                return self._payload

        payload = [
            {"code": 200, "body": json.dumps({"daily_budget": "1000"})},
            {"code": 400, "body": json.dumps({"error": {"code": 100, "message": "bad"}})},
            None,
        ]
        original_post, original_log = mod.requests.post, mod.log_meta_usage
        mod.requests.post = lambda *a, **k: _Resp(payload)
        mod.log_meta_usage = lambda *a, **k: None
        try:
            api = GraphAPI(access_token="tok", user_id="u1")
            out = api._batch_graph([("a", {}), ("b", {}), ("c", {})], "test")["results"]
            self.assertTrue(out["a"]["ok"])
            self.assertFalse(out["b"]["ok"])
            self.assertEqual(out["b"]["error"]["code"], 100)
            self.assertFalse(out["c"]["ok"])

            payload[1] = {"code": 400, "body": json.dumps({"error": {"code": 190, "message": "expired"}})}
            self.assertEqual(api._batch_graph([("a", {}), ("b", {}), ("c", {})], "test")["status"], "auth_error")
        finally:
            mod.requests.post, mod.log_meta_usage = original_post, original_log


if __name__ == "__main__":
    unittest.main()


class TestSummarizeBudgetFailures(unittest.TestCase):
    """Resumo que vai para o histórico do pack: tem que trazer o MOTIVO, não só a contagem."""

    def test_groups_by_message_most_frequent_first(self):
        from app.routes.facebook import _summarize_budget_failures

        items = [
            {"id": "1", "outcome": "updated"},
            {"id": "2", "outcome": "failed", "reason": "meta_error", "message": "Orçamento baixo — Mínimo R$ 6,00"},
            {"id": "3", "outcome": "failed", "reason": "read_failed", "message": "Não foi possível ler"},
            {"id": "4", "outcome": "failed", "reason": "meta_error", "message": "Orçamento baixo — Mínimo R$ 6,00"},
            {"id": "5", "outcome": "skipped", "reason": "no_own_budget"},  # avisada antes: não é erro
        ]
        self.assertEqual(
            _summarize_budget_failures(items),
            "3 de 4 não mudaram: Orçamento baixo — Mínimo R$ 6,00 (2); Não foi possível ler (1)",
        )

    def test_none_when_nothing_failed(self):
        from app.routes.facebook import _summarize_budget_failures

        self.assertIsNone(_summarize_budget_failures([{"id": "1", "outcome": "updated"}, {"id": "2", "outcome": "skipped"}]))
