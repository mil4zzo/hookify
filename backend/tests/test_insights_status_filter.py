"""Cobertura da inclusão de ads ARCHIVED/DELETED no pipeline de insights.

Contexto (decisoes-tecnicas 2026-07-19): o /insights com level=ad OMITE por default
o histórico de ads deletados/arquivados — o spend deles some da soma e o pack fica
menor que o Gerenciador. O fix tem duas pontas:

1. `start_ads_job` injeta filtering de ad.effective_status com a lista COMPLETA de
   status (superset do default) — o gasto histórico volta a vir.
2. `enrich()` resolve o status real desses ads pelo NÓ (Batch API), porque o edge
   /ads (inventário) não os devolve; sem nó legível, DELETED presumido.
"""
import json

import pytest

from app.services.ads_enricher import AdsEnricher
from app.services.graph_api import GraphAPI


class _FakeResp:
    status_code = 200
    headers: dict = {}

    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self._payload


# ---------------------------------------------------------------------------
# start_ads_job: injeção do filtering de status
# ---------------------------------------------------------------------------

def _run_start_ads_job(monkeypatch, filters):
    captured = {}

    def fake_post(url, params=None, timeout=None):
        captured["params"] = params
        return _FakeResp({"report_run_id": "rr1"})

    monkeypatch.setattr("app.services.graph_api.requests.post", fake_post)
    api = GraphAPI("test-token")
    report_id = api.start_ads_job(
        "act_1", {"since": "2026-01-01", "until": "2026-01-31"}, filters
    )
    assert report_id == "rr1"
    return json.loads(captured["params"]["filtering"])


def test_start_ads_job_injects_full_status_filter(monkeypatch):
    filtering = _run_start_ads_job(
        monkeypatch,
        [{"field": "campaign.name", "operator": "CONTAIN", "value": "CAP"}],
    )
    fields = [f["field"] for f in filtering]
    assert "campaign.name" in fields
    assert "ad.effective_status" in fields
    status_filter = next(f for f in filtering if f["field"] == "ad.effective_status")
    # Superset do default: sem ARCHIVED/DELETED aqui, o gasto histórico deles some.
    assert "ARCHIVED" in status_filter["value"]
    assert "DELETED" in status_filter["value"]
    assert "ACTIVE" in status_filter["value"]
    assert status_filter["operator"] == "IN"


def test_start_ads_job_respects_caller_status_filter(monkeypatch):
    custom = {"field": "ad.effective_status", "operator": "IN", "value": ["ACTIVE"]}
    filtering = _run_start_ads_job(monkeypatch, [custom])
    status_filters = [f for f in filtering if f["field"] == "ad.effective_status"]
    assert status_filters == [custom]  # sem duplicar


def test_start_ads_job_without_pack_filters_still_filters_status(monkeypatch):
    filtering = _run_start_ads_job(monkeypatch, [])
    assert [f["field"] for f in filtering] == ["ad.effective_status"]


# ---------------------------------------------------------------------------
# enrich(): status por nó para ads fora do inventário
# ---------------------------------------------------------------------------

def _enricher_for_enrich(monkeypatch):
    enricher = AdsEnricher(access_token="test-token")
    monkeypatch.setattr(enricher, "fetch_details", lambda act_id, rep_ids: [])
    monkeypatch.setattr(
        enricher, "fetch_parent_entities", lambda act_id: {"campaigns": {}, "adsets": {}}
    )
    return enricher


RAW = lambda: [  # noqa: E731 — factory curta, cada teste muta sua cópia
    {"ad_id": "111", "ad_name": "A"},
    {"ad_id": "222", "ad_name": "B"},
    {"ad_id": "333", "ad_name": "C"},
]
STATUS_DETAILS = [{"id": "111", "effective_status": "ACTIVE"}]


def test_enrich_resolves_insights_only_ads_via_node_batch(monkeypatch):
    enricher = _enricher_for_enrich(monkeypatch)
    seen = {}

    def fake_batch(self, ad_ids, **kwargs):
        seen["ids"] = list(ad_ids)
        return {"status": "success", "statuses": {"222": "ARCHIVED"}}

    monkeypatch.setattr(GraphAPI, "batch_get_effective_status", fake_batch)
    result = enricher.enrich("act_1", RAW(), status_details=STATUS_DETAILS)
    assert result["success"]
    by_id = {a["ad_id"]: a for a in result["data"]}
    assert by_id["111"]["effective_status"] == "ACTIVE"  # inventário manda
    assert by_id["222"]["effective_status"] == "ARCHIVED"  # nó resolveu
    # Batch OK mas nó ilegível → deletado de verdade (nó some após retenção).
    assert by_id["333"]["effective_status"] == "DELETED"
    assert sorted(seen["ids"]) == ["222", "333"]  # só os fora do inventário


def test_enrich_batch_failure_leaves_status_unset(monkeypatch):
    """Falha TOTAL do batch não presume DELETED — fail-open, sem rotular errado."""
    enricher = _enricher_for_enrich(monkeypatch)

    def fake_batch(self, ad_ids, **kwargs):
        return {"status": "auth_error", "message": "token expirado"}

    monkeypatch.setattr(GraphAPI, "batch_get_effective_status", fake_batch)
    result = enricher.enrich("act_1", RAW(), status_details=STATUS_DETAILS)
    by_id = {a["ad_id"]: a for a in result["data"]}
    assert by_id["222"].get("effective_status") is None
    assert by_id["333"].get("effective_status") is None


def test_enrich_refresh_skips_persisted_terminal_statuses(monkeypatch):
    """DELETED/ARCHIVED persistidos não são relidos a cada refresh: DELETED não volta;
    ARCHIVED desarquivado reaparece no inventário e se corrige via status_map."""
    enricher = _enricher_for_enrich(monkeypatch)
    seen = {}

    def fake_batch(self, ad_ids, **kwargs):
        seen["ids"] = list(ad_ids)
        return {"status": "success", "statuses": {}}

    monkeypatch.setattr(GraphAPI, "batch_get_effective_status", fake_batch)
    existing = {
        "222": {"effective_status": "ARCHIVED"},
    }
    result = enricher.enrich(
        "act_1", RAW(), is_refresh=True, existing_ads_map=existing,
        status_details=STATUS_DETAILS,
    )
    by_id = {a["ad_id"]: a for a in result["data"]}
    # 222 reusa o status do banco (fixed fields) sem nova chamada de nó.
    assert by_id["222"]["effective_status"] == "ARCHIVED"
    assert seen["ids"] == ["333"]
