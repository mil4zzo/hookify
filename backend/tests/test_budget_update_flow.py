"""
Testa GraphAPI.update_entity_budget — o fluxo de edição de orçamento com verificação
contra o Meta (pre-check → write → verify), espelho do _activate_or_pause do status.

Regras cobertas:
- Entidade sem budget próprio (campanha ABO / adset sob CBO) => "no_own_budget", sem escrever.
- Tipo pedido ≠ tipo vigente (daily↔lifetime) => "budget_type_mismatch", sem escrever.
- Valor pedido == vigente => "noop", sem escrever (economiza rate limit).
- Sucesso => escreve e devolve budgets RELIDOS do Meta (verify), verified=True.
- Verify falhou pós-write => success com verified=False (caller não persiste local).
- auth_error no pre-check e erro no write => propagados sem escrever/verificar.
"""

import unittest

from app.services.graph_api import GraphAPI


class _StubGraphAPI(GraphAPI):
    """GraphAPI com pre-check/write/verify stubados por scripts sequenciais."""

    def __init__(
        self,
        pre=None,
        verify=None,
        write_result=None,
    ):
        super().__init__(access_token="tok", user_id="u1")
        # Dicts devolvidos pelo GET antes (pre-check) e depois (verify) do write.
        self._pre = pre or {"status": "success", "daily_budget": None, "lifetime_budget": None}
        self._verify = verify or {"status": "success", "daily_budget": None, "lifetime_budget": None}
        self._write_result = write_result or {"status": "success", "data": {"success": True}}
        self.get_calls = 0
        self.write_calls = 0
        self.write_payloads = []

    def get_entity_budget_config(self, entity_id, entity_type):  # type: ignore[override]
        self.get_calls += 1
        return dict(self._verify if self.write_calls > 0 else self._pre)

    def _handle_graph_request(self, *, method, path, operation_name, params=None, json_payload=None, data=None, files=None, timeout=60):  # type: ignore[override]
        # update_entity_budget só chega aqui no WRITE (o GET está stubado acima).
        assert method == "POST", f"esperava só POST no _handle_graph_request stubado, veio {method}"
        self.write_calls += 1
        self.write_payloads.append(json_payload)
        return dict(self._write_result)


def _ok(daily=None, lifetime=None):
    return {"status": "success", "daily_budget": daily, "lifetime_budget": lifetime}


class TestUpdateEntityBudget(unittest.TestCase):
    def test_happy_path_daily(self):
        api = _StubGraphAPI(pre=_ok(daily=10000), verify=_ok(daily=15000))
        result = api.update_entity_budget("c1", "campaign", daily_budget=15000)
        self.assertEqual(result["status"], "success")
        self.assertTrue(result["verified"])
        self.assertEqual(result["daily_budget"], 15000)
        self.assertIsNone(result["lifetime_budget"])
        self.assertEqual(api.write_calls, 1)
        self.assertEqual(api.write_payloads[0], {"daily_budget": 15000})
        self.assertEqual(api.get_calls, 2)  # pre-check + verify

    def test_happy_path_lifetime(self):
        api = _StubGraphAPI(pre=_ok(lifetime=300000), verify=_ok(lifetime=500000))
        result = api.update_entity_budget("a1", "adset", lifetime_budget=500000)
        self.assertEqual(result["status"], "success")
        self.assertEqual(result["lifetime_budget"], 500000)
        self.assertEqual(api.write_payloads[0], {"lifetime_budget": 500000})

    def test_no_own_budget_blocks_write(self):
        # Campanha ABO (sem budget próprio) ou adset sob CBO: nunca escrever.
        api = _StubGraphAPI(pre=_ok())
        result = api.update_entity_budget("c1", "campaign", daily_budget=15000)
        self.assertEqual(result["status"], "no_own_budget")
        self.assertEqual(api.write_calls, 0)

    def test_type_mismatch_blocks_write(self):
        api = _StubGraphAPI(pre=_ok(lifetime=300000))
        result = api.update_entity_budget("c1", "campaign", daily_budget=15000)
        self.assertEqual(result["status"], "budget_type_mismatch")
        self.assertEqual(result["current"], "lifetime")
        self.assertEqual(api.write_calls, 0)

    def test_same_value_is_noop(self):
        api = _StubGraphAPI(pre=_ok(daily=15000))
        result = api.update_entity_budget("a1", "adset", daily_budget=15000)
        self.assertEqual(result["status"], "noop")
        self.assertEqual(result["daily_budget"], 15000)
        self.assertEqual(api.write_calls, 0)

    def test_precheck_auth_error_propagates(self):
        api = _StubGraphAPI(pre={"status": "auth_error", "message": "token expirado"})
        result = api.update_entity_budget("c1", "campaign", daily_budget=15000)
        self.assertEqual(result["status"], "auth_error")
        self.assertEqual(api.write_calls, 0)

    def test_write_error_propagates_with_meta_error_obj(self):
        error_obj = {"code": 100, "error_user_msg": "O orçamento é muito baixo."}
        api = _StubGraphAPI(
            pre=_ok(daily=10000),
            write_result={"status": "http_error", "message": "Invalid parameter", "error": error_obj},
        )
        result = api.update_entity_budget("a1", "adset", daily_budget=1)
        self.assertEqual(result["status"], "http_error")
        self.assertEqual(result["error"], error_obj)
        self.assertEqual(api.get_calls, 1)  # sem verify após write falho

    def test_verify_failure_returns_unverified_success(self):
        api = _StubGraphAPI(
            pre=_ok(daily=10000),
            verify={"status": "http_error", "message": "boom"},
        )
        result = api.update_entity_budget("c1", "campaign", daily_budget=15000)
        self.assertEqual(result["status"], "success")
        self.assertFalse(result["verified"])
        self.assertIsNone(result["daily_budget"])  # sem verdade lida → caller não persiste

    def test_invalid_value_rejected_before_any_call(self):
        api = _StubGraphAPI()
        result = api.update_entity_budget("c1", "campaign", daily_budget=0)
        self.assertEqual(result["status"], "error")
        self.assertEqual(api.get_calls, 0)
        self.assertEqual(api.write_calls, 0)


if __name__ == "__main__":
    unittest.main()
