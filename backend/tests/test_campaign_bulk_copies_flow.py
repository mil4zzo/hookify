"""
Testes do novo fluxo de duplicacao via /copies.

Cobre os helpers que carregam o peso da nova arquitetura:
  - _is_meta_datetime_in_past — detecta schedule herdado expirado
  - CampaignBulkProcessor._resolve_copy_response — sync vs async response shape
  - CampaignBulkProcessor._wait_for_async_session — polling completion/failure/timeout

Os 3 cenarios end-to-end (modelo BR ABO, modelo UE com DSA, modelo BR com regional regulation)
sao validados em ambiente real apos o spike. Aqui ficam apenas as logicas de orquestracao
que dao pra testar com mocks deterministicos.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

import pytest

from app.services.bulk_ad_service import BulkAdJobContext
from app.services.campaign_bulk_service import (
    CampaignBulkProcessor,
    _is_meta_datetime_in_past,
)
from app.services.meta_api_errors import MetaAPIError


# ── _is_meta_datetime_in_past ────────────────────────────────────────────────


class TestIsMetaDatetimeInPast:
    def test_none_is_not_past(self):
        assert _is_meta_datetime_in_past(None) is False

    def test_empty_string_is_not_past(self):
        assert _is_meta_datetime_in_past("") is False

    def test_iso_with_z_in_past(self):
        past = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat().replace("+00:00", "Z")
        assert _is_meta_datetime_in_past(past) is True

    def test_iso_with_offset_no_colon_in_past(self):
        # Meta as vezes envia "+0000" sem dois pontos — fromisoformat exige "+00:00".
        past = (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%S+0000")
        assert _is_meta_datetime_in_past(past) is True

    def test_iso_in_future(self):
        future = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat().replace("+00:00", "Z")
        assert _is_meta_datetime_in_past(future) is False

    def test_epoch_int_in_past(self):
        past_epoch = int((datetime.now(timezone.utc) - timedelta(hours=1)).timestamp())
        assert _is_meta_datetime_in_past(past_epoch) is True

    def test_epoch_string_in_future(self):
        future_epoch = str(int((datetime.now(timezone.utc) + timedelta(hours=1)).timestamp()))
        assert _is_meta_datetime_in_past(future_epoch) is False

    def test_malformed_returns_false(self):
        assert _is_meta_datetime_in_past("nao-eh-data") is False


# ── CampaignBulkProcessor helpers (com mocks) ────────────────────────────────


def _make_processor() -> CampaignBulkProcessor:
    """Instancia processor com tracker/api/sb mockados — suficiente pra helpers isolados."""
    ctx = BulkAdJobContext(
        user_jwt="jwt",
        user_id="user-1",
        access_token="tok",
        job_id="job-1",
        account_id="123",
    )
    proc = CampaignBulkProcessor.__new__(CampaignBulkProcessor)
    proc.context = ctx
    proc.api = MagicMock()
    proc.tracker = MagicMock()
    proc.tracker.heartbeat.return_value = True  # nunca bloqueia
    proc.sb = MagicMock()
    proc.story_builder = MagicMock()
    proc.asset_feed_builder = MagicMock()
    return proc


class TestResolveCopyResponse:
    def test_sync_with_id(self):
        proc = _make_processor()
        out = proc._resolve_copy_response({"id": "999"}, item_id="x")
        assert out == "999"

    def test_sync_with_copied_campaign_id(self):
        proc = _make_processor()
        out = proc._resolve_copy_response({"copied_campaign_id": "888"}, item_id="x")
        assert out == "888"

    def test_async_only_polls_until_complete_and_extracts_id(self):
        proc = _make_processor()
        proc.api.get_async_session.side_effect = [
            {"status": "success", "data": {"status": "Job Started", "percent_completed": 0}},
            {"status": "success", "data": {"status": "Job Running", "percent_completed": 50}},
            {
                "status": "success",
                "data": {
                    "status": "Job Completed",
                    "percent_completed": 100,
                    "result": {"copied_campaign_id": "777"},
                },
            },
        ]
        out = proc._resolve_copy_response(
            {"async_session_id": "ses-1"},
            item_id="x",
        )
        assert out == "777"
        assert proc.api.get_async_session.call_count == 3

    def test_async_result_as_json_string(self):
        # Meta as vezes retorna result como string JSON em vez de dict.
        proc = _make_processor()
        proc.api.get_async_session.return_value = {
            "status": "success",
            "data": {
                "status": "Job Completed",
                "result": '{"copied_campaign_id":"666"}',
            },
        }
        out = proc._resolve_copy_response({"async_session_id": "ses-1"}, item_id="x")
        assert out == "666"

    def test_both_direct_and_async_uses_direct_after_polling(self):
        # Quando vem os dois, usa direct_id mas ainda assim polla pra garantir que filhos
        # terminaram de copiar.
        proc = _make_processor()
        proc.api.get_async_session.return_value = {
            "status": "success",
            "data": {"status": "Job Completed"},
        }
        out = proc._resolve_copy_response(
            {"id": "555", "async_session_id": "ses-1"},
            item_id="x",
        )
        assert out == "555"
        assert proc.api.get_async_session.called

    def test_no_id_at_all_raises(self):
        proc = _make_processor()
        with pytest.raises(MetaAPIError) as exc:
            proc._resolve_copy_response({}, item_id="x")
        assert exc.value.error_code == "copy_response_missing_id"


class TestWaitForAsyncSession:
    def test_completes_immediately(self):
        proc = _make_processor()
        proc.api.get_async_session.return_value = {
            "status": "success",
            "data": {"status": "Job Completed", "result": {"copied_campaign_id": "1"}},
        }
        out = proc._wait_for_async_session("ses-1", item_id="x")
        assert out["status"] == "Job Completed"

    def test_failed_raises_with_error_details(self):
        proc = _make_processor()
        proc.api.get_async_session.return_value = {
            "status": "success",
            "data": {"status": "Job Failed", "error_code": 42, "exception": "boom"},
        }
        with pytest.raises(MetaAPIError) as exc:
            proc._wait_for_async_session("ses-1", item_id="x")
        assert exc.value.error_code == "async_session_failed"
        assert "42" in exc.value.message
        assert "boom" in exc.value.message

    def test_timeout_raises(self, monkeypatch):
        proc = _make_processor()
        # Sempre running — vai bater timeout.
        proc.api.get_async_session.return_value = {
            "status": "success",
            "data": {"status": "Job Running"},
        }
        # Patch sleep e time.monotonic pra fast-forward
        import app.services.campaign_bulk_service as svc

        monkeypatch.setattr(svc.time, "sleep", lambda *_: None)
        # Simula que cada chamada a monotonic adiciona 100s
        clock = [0.0]

        def fake_monotonic():
            clock[0] += 100.0
            return clock[0]

        monkeypatch.setattr(svc.time, "monotonic", fake_monotonic)
        with pytest.raises(MetaAPIError) as exc:
            proc._wait_for_async_session("ses-1", item_id="x", max_wait_seconds=300)
        assert exc.value.error_code == "async_session_timeout"


class TestCopyAdsetWithTargetingNormalization:
    """Subcode 2490392 — explore_home sem explore — fallback create_adset com normalizacao."""

    def test_happy_path_no_fallback_needed(self):
        proc = _make_processor()
        proc.api.copy_adset.return_value = {
            "status": "success",
            "data": {"id": "new-adset-1"},
        }
        out = proc._copy_adset_with_targeting_normalization(
            "src-adset-1",
            {"campaign_id": "new-camp", "deep_copy": False, "status_option": "PAUSED"},
            item_id="item-1",
        )
        assert out["id"] == "new-adset-1"
        # Caminho feliz: nao chamou get nem create
        assert proc.api.get_adset_fields.call_count == 0
        assert proc.api.create_adset.call_count == 0

    def test_fallback_to_create_adset_on_explore_home_issue(self):
        proc = _make_processor()
        proc.api.copy_adset.return_value = {
            "status": "http_error",
            "error": {
                "code": 100,
                "error_subcode": 2490392,
                "error_data": {"blame_field_specs": [["instagram_positions"]]},
                "message": "Invalid parameter",
            },
        }
        proc.api.get_adset_fields.return_value = {
            "status": "success",
            "data": {
                "name": "Adset Original",
                "targeting": {
                    "geo_locations": {"countries": ["BR"]},
                    "instagram_positions": ["stream", "explore_home"],
                },
                "optimization_goal": "OFFSITE_CONVERSIONS",
                "billing_event": "IMPRESSIONS",
                "daily_budget": 5000,
            },
        }
        proc.api.create_adset.return_value = {
            "status": "success",
            "data": {"id": "manual-adset-1"},
        }

        out = proc._copy_adset_with_targeting_normalization(
            "src-adset-1",
            {"campaign_id": "new-camp", "deep_copy": False, "status_option": "PAUSED"},
            item_id="item-1",
        )
        assert out["id"] == "manual-adset-1"

        # Source NAO foi mutado — update_adset nao foi chamado.
        assert proc.api.update_adset.call_count == 0

        # create_adset recebeu targeting com 'explore' adicionado.
        create_call = proc.api.create_adset.call_args
        params = create_call.args[1]
        ig = params["targeting"]["instagram_positions"]
        assert ig == ["explore", "stream", "explore_home"]
        assert params["campaign_id"] == "new-camp"
        assert params["daily_budget"] == 5000

    def test_propagates_other_subcodes(self):
        proc = _make_processor()
        proc.api.copy_adset.return_value = {
            "status": "http_error",
            "error": {"code": 100, "error_subcode": 9999, "message": "Something else"},
        }
        with pytest.raises(MetaAPIError):
            proc._copy_adset_with_targeting_normalization(
                "src-adset-1",
                {"campaign_id": "new-camp", "deep_copy": False, "status_option": "PAUSED"},
                item_id="item-1",
            )
        assert proc.api.create_adset.call_count == 0
        assert proc.api.update_adset.call_count == 0

    def test_propagates_2490392_without_instagram_positions_blame(self):
        proc = _make_processor()
        proc.api.copy_adset.return_value = {
            "status": "http_error",
            "error": {
                "code": 100,
                "error_subcode": 2490392,
                "error_data": {"blame_field_specs": [["facebook_positions"]]},
                "message": "Invalid parameter",
            },
        }
        with pytest.raises(MetaAPIError):
            proc._copy_adset_with_targeting_normalization(
                "src-adset-1",
                {"campaign_id": "new-camp", "deep_copy": False, "status_option": "PAUSED"},
                item_id="item-1",
            )
        assert proc.api.create_adset.call_count == 0


if __name__ == "__main__":
    import sys

    sys.exit(pytest.main([__file__, "-v"]))
