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
from unittest.mock import patch, MagicMock

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
    """GraphAPI de batch com o read fresco e o write stubados.

    `effective_map` responde as leituras ANTES do write (pre-check); `verify_map` (se dado)
    responde as leituras DEPOIS do write (verify) — senão reusa `effective_map`.
    """

    def __init__(self, effective_map, write_ok=True, verify_map=None):
        super().__init__(access_token="tok", user_id="u1")
        self._effective_map = effective_map  # {ad_id: effective_status}
        self._verify_map = verify_map if verify_map is not None else effective_map
        self._write_ok = write_ok
        self.written = None            # ad_ids que chegaram ao write
        self.effective_calls = 0

    def batch_get_effective_status(self, ad_ids, **kwargs):  # type: ignore[override]
        self.effective_calls += 1
        source = self._verify_map if self.written is not None else self._effective_map
        # Contrato real: ads que o Meta não conseguiu ler ficam AUSENTES do dict (fail-open).
        return {"status": "success", "statuses": {aid: source[aid] for aid in ad_ids if aid in source}}

    def _batch_write_status(self, ad_ids, status):  # type: ignore[override]
        self.written = list(ad_ids)
        if not self._write_ok:
            return {"status": "success", "updated_ids": [], "failed_ids": list(ad_ids)}
        return {"status": "success", "updated_ids": list(ad_ids), "failed_ids": []}


class TestBatchActivateBlocksInheritedPause(unittest.TestCase):
    def test_activate_partitions_blocked_from_writable(self):
        api = _StubBatchGraphAPI(
            {
                "own_paused": "PAUSED",          # pausa própria → escreve
                "camp_paused": "CAMPAIGN_PAUSED",  # pai pausado → bloqueia
                "adset_paused": "ADSET_PAUSED",    # pai pausado → bloqueia
                "already_on": "ACTIVE",          # já ativo → deixa passar (no-op inofensivo)
            },
            # Verify pós-write realista: os escritos assentam em ACTIVE (sem isso o
            # PAUSED pré-write dispararia o retry de leitura não-assentada).
            verify_map={"own_paused": "ACTIVE", "already_on": "ACTIVE"},
        )
        res = api.batch_update_ad_status(
            ["own_paused", "camp_paused", "adset_paused", "already_on"], "ACTIVE"
        )
        self.assertEqual(res["blocked"], {"camp_paused": "campaign", "adset_paused": "adset"})
        # Só os não-herdados chegam ao write.
        self.assertEqual(api.written, ["own_paused", "already_on"])
        self.assertEqual(set(res["updated_ids"]), {"own_paused", "already_on"})
        # Verdade do pre-check dos BLOQUEADOS entra em verified_statuses (self-heal do cache,
        # espelhando o 409 do fluxo individual).
        self.assertEqual(res["verified_statuses"]["camp_paused"], "CAMPAIGN_PAUSED")
        self.assertEqual(res["verified_statuses"]["adset_paused"], "ADSET_PAUSED")

    def test_activate_all_inherited_writes_nothing(self):
        api = _StubBatchGraphAPI({"a": "CAMPAIGN_PAUSED", "b": "ADSET_PAUSED"})
        res = api.batch_update_ad_status(["a", "b"], "ACTIVE")
        self.assertEqual(api.written, [])
        self.assertEqual(res["updated_ids"], [])
        self.assertEqual(res["blocked"], {"a": "campaign", "b": "adset"})
        self.assertEqual(res["verified_statuses"], {"a": "CAMPAIGN_PAUSED", "b": "ADSET_PAUSED"})

    def test_activate_unknown_status_fails_open_to_write(self):
        # Ad ausente do read fresco (Meta não leu) → None → não bloqueia (fail-open).
        api = _StubBatchGraphAPI({})
        res = api.batch_update_ad_status(["x"], "ACTIVE")
        self.assertEqual(api.written, ["x"])
        self.assertEqual(res["blocked"], {})

    def test_activate_failopen_reclassified_blocked_by_verify(self):
        # Pre-check falhou em ler (fail-open → escreve), mas o verify pós-write mostra que o
        # ad segue pausado por um pai: reclassifica como blocked em vez de "sucesso fantasma".
        api = _StubBatchGraphAPI({}, verify_map={"x": "ADSET_PAUSED", "y": "ACTIVE"})
        res = api.batch_update_ad_status(["x", "y"], "ACTIVE")
        self.assertEqual(api.written, ["x", "y"])
        self.assertEqual(res["blocked"], {"x": "adset"})
        self.assertEqual(res["updated_ids"], ["y"])
        self.assertEqual(res["verified_statuses"], {"x": "ADSET_PAUSED", "y": "ACTIVE"})


class TestBatchPause(unittest.TestCase):
    def test_pause_skips_precheck_and_writes_all(self):
        api = _StubBatchGraphAPI({"a": "ACTIVE", "b": "ACTIVE"}, verify_map={"a": "PAUSED", "b": "PAUSED"})
        res = api.batch_update_ad_status(["a", "b"], "PAUSED")
        # Pausar não faz pre-check (não bloqueia nunca); a única leitura é o verify pós-write.
        self.assertEqual(api.effective_calls, 1)
        self.assertEqual(api.written, ["a", "b"])
        self.assertEqual(res["blocked"], {})
        # O verify devolve a verdade relida para o caller persistir no cache local.
        self.assertEqual(res["verified_statuses"], {"a": "PAUSED", "b": "PAUSED"})


class TestBatchEntityTypeInheritedPause(unittest.TestCase):
    """Generalização de batch_update_ad_status por `entity_type`: só o mapa de pausa herdada muda."""

    def test_adset_activate_blocks_only_on_campaign_paused(self):
        # Conjunto herda pausa só da CAMPANHA. ADSET_PAUSED não é pausa herdada para um adset
        # (é o próprio estado dele) → deve ser escrito; CAMPAIGN_PAUSED bloqueia.
        api = _StubBatchGraphAPI({"own": "ADSET_PAUSED", "under_paused_camp": "CAMPAIGN_PAUSED"})
        res = api.batch_update_ad_status(["own", "under_paused_camp"], "ACTIVE", entity_type="adset")
        self.assertEqual(res["blocked"], {"under_paused_camp": "campaign"})
        self.assertEqual(api.written, ["own"])
        self.assertEqual(set(res["updated_ids"]), {"own"})

    def test_campaign_activate_never_blocked(self):
        # Campanha não tem pai → nenhum status é pausa herdada; escreve tudo.
        api = _StubBatchGraphAPI({"a": "CAMPAIGN_PAUSED", "b": "PAUSED"}, verify_map={"a": "ACTIVE", "b": "ACTIVE"})
        res = api.batch_update_ad_status(["a", "b"], "ACTIVE", entity_type="campaign")
        self.assertEqual(res["blocked"], {})
        self.assertEqual(api.written, ["a", "b"])
        self.assertEqual(set(res["updated_ids"]), {"a", "b"})

    def test_pause_writes_all_regardless_of_entity_type(self):
        api = _StubBatchGraphAPI({"a": "ACTIVE"}, verify_map={"a": "PAUSED"})
        res = api.batch_update_ad_status(["a"], "PAUSED", entity_type="campaign")
        self.assertEqual(api.written, ["a"])
        self.assertEqual(res["blocked"], {})


def _fake_response(payload):
    resp = MagicMock()
    resp.json.return_value = payload
    resp.raise_for_status.return_value = None
    resp.headers = {}
    return resp


class TestGetAdStatusesByParent(unittest.TestCase):
    def test_single_page_maps_statuses(self):
        api = GraphAPI(access_token="tok", user_id="u1")
        payload = {
            "data": [
                {"id": "1", "effective_status": "ACTIVE"},
                {"id": "2", "effective_status": "campaign_paused"},
                {"id": "3"},  # sem status → None
            ],
            "paging": {},
        }
        with patch("app.services.graph_api.requests.get", return_value=_fake_response(payload)) as mock_get:
            res = api.get_ad_statuses_by_parent("act_1", "campaign.id", "c1")
        self.assertEqual(res["status"], "success")
        self.assertEqual(res["statuses"], {"1": "ACTIVE", "2": "CAMPAIGN_PAUSED", "3": None})
        # filtering deve apontar para o pai pedido
        params = mock_get.call_args.kwargs["params"]
        self.assertIn("campaign.id", params["filtering"])

    def test_follows_pagination(self):
        api = GraphAPI(access_token="tok", user_id="u1")
        page1 = {"data": [{"id": "1", "effective_status": "ACTIVE"}], "paging": {"next": "https://next.page/url"}}
        page2 = {"data": [{"id": "2", "effective_status": "PAUSED"}], "paging": {}}
        with patch("app.services.graph_api.requests.get", side_effect=[_fake_response(page1), _fake_response(page2)]):
            res = api.get_ad_statuses_by_parent("act_1", "adset.id", "a1")
        self.assertEqual(res["statuses"], {"1": "ACTIVE", "2": "PAUSED"})

    def test_invalid_parent_field_rejected(self):
        api = GraphAPI(access_token="tok", user_id="u1")
        res = api.get_ad_statuses_by_parent("act_1", "ad.id", "x")
        self.assertEqual(res["status"], "error")


if __name__ == "__main__":
    unittest.main()
