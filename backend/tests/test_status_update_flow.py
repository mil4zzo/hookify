"""
Testa GraphAPI._activate_or_pause — o fluxo de mudança de status que corrige o bug do
"sucesso fantasma": ativar um conjunto/anúncio pausado POR UM PAI reportava sucesso mas
o Meta continuava pausado (revertia no refresh).

Regras cobertas:
- Ativar quando um PAI está pausado (CAMPAIGN_PAUSED/ADSET_PAUSED) => "blocked", sem escrever.
- Ativar quando já está ativo (ex.: conjunto ativo, anúncios pausados individualmente) => "noop_active".
- Ativar de fato => escreve e devolve effective_status real relido do Meta (verify).
- Pausar => nunca bloqueia; devolve effective_status real.
"""

import unittest

from app.services.graph_api import GraphAPI


class _StubGraphAPI(GraphAPI):
    """GraphAPI com as duas chamadas de rede stubadas por scripts sequenciais."""

    def __init__(self, pre_effective=None, verify_effective=None, write_status="success"):
        super().__init__(access_token="tok", user_id="u1")
        # effective_status devolvido pelo get antes de escrever (pre-check) e depois (verify)
        self._pre_effective = pre_effective
        self._verify_effective = verify_effective
        self._write_status = write_status
        self.get_calls = 0
        self.write_calls = 0

    def get_entity_status(self, entity_id):  # type: ignore[override]
        self.get_calls += 1
        # Antes de escrever = pre-check; depois de escrever = verify.
        eff = self._verify_effective if self.write_calls > 0 else self._pre_effective
        return {"status": "success", "own_status": eff, "effective_status": eff}

    def _update_entity_status(self, entity_id, status):  # type: ignore[override]
        self.write_calls += 1
        if self._write_status != "success":
            return {"status": self._write_status, "message": "boom"}
        return {"status": "success", "data": {"success": True}}


class TestActivateBlockedByParent(unittest.TestCase):
    def test_adset_blocked_when_campaign_paused(self):
        api = _StubGraphAPI(pre_effective="CAMPAIGN_PAUSED")
        res = api._activate_or_pause("123", "ACTIVE", "adset")
        self.assertEqual(res["status"], "blocked")
        self.assertEqual(res["reason"], "campaign")
        # Não deve escrever nada no Meta
        self.assertEqual(api.write_calls, 0)

    def test_ad_blocked_when_adset_paused(self):
        api = _StubGraphAPI(pre_effective="ADSET_PAUSED")
        res = api._activate_or_pause("123", "ACTIVE", "ad")
        self.assertEqual(res["status"], "blocked")
        self.assertEqual(res["reason"], "adset")
        self.assertEqual(api.write_calls, 0)

    def test_ad_blocked_when_campaign_paused(self):
        api = _StubGraphAPI(pre_effective="CAMPAIGN_PAUSED")
        res = api._activate_or_pause("123", "ACTIVE", "ad")
        self.assertEqual(res["status"], "blocked")
        self.assertEqual(res["reason"], "campaign")

    def test_campaign_never_blocked_by_parent(self):
        # Campanha não tem pai — mesmo effective estranho, ativa normalmente.
        api = _StubGraphAPI(pre_effective="PAUSED", verify_effective="ACTIVE")
        res = api._activate_or_pause("123", "ACTIVE", "campaign")
        self.assertEqual(res["status"], "success")
        self.assertEqual(api.write_calls, 1)


class TestActivateNoop(unittest.TestCase):
    def test_already_active_returns_noop(self):
        api = _StubGraphAPI(pre_effective="ACTIVE")
        res = api._activate_or_pause("123", "ACTIVE", "adset")
        self.assertEqual(res["status"], "noop_active")
        self.assertEqual(api.write_calls, 0)


class TestActivateSuccess(unittest.TestCase):
    def test_activate_writes_and_returns_verified_effective(self):
        # Conjunto pausado no próprio nível (effective=PAUSED) -> ativa, verify volta ACTIVE.
        api = _StubGraphAPI(pre_effective="PAUSED", verify_effective="ACTIVE")
        res = api._activate_or_pause("123", "ACTIVE", "adset")
        self.assertEqual(res["status"], "success")
        self.assertEqual(res["effective_status"], "ACTIVE")
        self.assertEqual(api.write_calls, 1)

    def test_write_success_but_verify_still_parent_paused_is_blocked(self):
        # pre-check passou (ex.: PAUSED próprio) mas o Meta relê CAMPAIGN_PAUSED após escrever:
        # trata como blocked honesto em vez de sucesso fantasma.
        api = _StubGraphAPI(pre_effective="PAUSED", verify_effective="CAMPAIGN_PAUSED")
        res = api._activate_or_pause("123", "ACTIVE", "adset")
        self.assertEqual(res["status"], "blocked")
        self.assertEqual(res["reason"], "campaign")


class TestPause(unittest.TestCase):
    def test_pause_never_pre_checks_and_returns_verified(self):
        api = _StubGraphAPI(verify_effective="PAUSED")
        res = api._activate_or_pause("123", "PAUSED", "adset")
        self.assertEqual(res["status"], "success")
        self.assertEqual(res["effective_status"], "PAUSED")
        self.assertEqual(api.write_calls, 1)
        # Pausar não faz pre-check: só o verify chama get_entity_status.
        self.assertEqual(api.get_calls, 1)


class _StubBatchGraphAPI(GraphAPI):
    """GraphAPI de batch com o read fresco e o write stubados."""

    def __init__(self, effective_map, write_ok=True):
        super().__init__(access_token="tok", user_id="u1")
        self._effective_map = effective_map  # {ad_id: effective_status}
        self._write_ok = write_ok
        self.written = None            # ad_ids que chegaram ao write
        self.effective_calls = 0

    def batch_get_effective_status(self, ad_ids):  # type: ignore[override]
        self.effective_calls += 1
        return {"status": "success", "statuses": {aid: self._effective_map.get(aid) for aid in ad_ids}}

    def _batch_write_status(self, ad_ids, status):  # type: ignore[override]
        self.written = list(ad_ids)
        if not self._write_ok:
            return {"status": "success", "updated_ids": [], "failed_ids": list(ad_ids)}
        return {"status": "success", "updated_ids": list(ad_ids), "failed_ids": []}


class TestBatchActivateBlocksInheritedPause(unittest.TestCase):
    def test_activate_partitions_blocked_from_writable(self):
        api = _StubBatchGraphAPI({
            "own_paused": "PAUSED",          # pausa própria → escreve
            "camp_paused": "CAMPAIGN_PAUSED",  # pai pausado → bloqueia
            "adset_paused": "ADSET_PAUSED",    # pai pausado → bloqueia
            "already_on": "ACTIVE",          # já ativo → deixa passar (no-op inofensivo)
        })
        res = api.batch_update_ad_status(
            ["own_paused", "camp_paused", "adset_paused", "already_on"], "ACTIVE"
        )
        self.assertEqual(res["blocked"], {"camp_paused": "campaign", "adset_paused": "adset"})
        # Só os não-herdados chegam ao write.
        self.assertEqual(api.written, ["own_paused", "already_on"])
        self.assertEqual(set(res["updated_ids"]), {"own_paused", "already_on"})

    def test_activate_all_inherited_writes_nothing(self):
        api = _StubBatchGraphAPI({"a": "CAMPAIGN_PAUSED", "b": "ADSET_PAUSED"})
        res = api.batch_update_ad_status(["a", "b"], "ACTIVE")
        self.assertEqual(api.written, [])
        self.assertEqual(res["updated_ids"], [])
        self.assertEqual(res["blocked"], {"a": "campaign", "b": "adset"})

    def test_activate_unknown_status_fails_open_to_write(self):
        # Ad ausente do read fresco (Meta não leu) → None → não bloqueia (fail-open).
        api = _StubBatchGraphAPI({})
        res = api.batch_update_ad_status(["x"], "ACTIVE")
        self.assertEqual(api.written, ["x"])
        self.assertEqual(res["blocked"], {})


class TestBatchPause(unittest.TestCase):
    def test_pause_skips_precheck_and_writes_all(self):
        api = _StubBatchGraphAPI({"a": "ACTIVE", "b": "ACTIVE"})
        res = api.batch_update_ad_status(["a", "b"], "PAUSED")
        # Pausar não lê effective_status (não bloqueia nunca).
        self.assertEqual(api.effective_calls, 0)
        self.assertEqual(api.written, ["a", "b"])
        self.assertEqual(res["blocked"], {})


if __name__ == "__main__":
    unittest.main()
