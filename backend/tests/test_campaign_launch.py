"""Duplicação de campanha (campaign_launch_service): checkpoints, retomada e fallbacks.

O teste que importa é o de retomada: uma falha no meio do item NÃO pode fazer a
segunda passada recopiar a campanha (o bug do legado: "tentar novamente" deixava
uma campanha meio montada e criava outra).
"""
from __future__ import annotations

import copy
from typing import Any, Dict, List

import pytest

from app.services import ad_media_library, campaign_launch_service
from app.services.campaign_launch_service import CampaignLaunchProcessor, LaunchContext
from app.services.creative_media_swap import (
    BundleMediaRef,
    MediaRef,
    build_creative_parameters,
    sanitize_degrees_of_freedom_spec,
)
from app.services.creative_template import parse_creative_template
from app.services.google_drive_service import parse_folder_id


def ok(data: Dict[str, Any]) -> Dict[str, Any]:
    return {"status": "success", "data": data}


def meta_error(code: int, subcode: int | None = None, message: str = "erro", **extra: Any) -> Dict[str, Any]:
    error = {"code": code, "message": message, **extra}
    if subcode is not None:
        error["error_subcode"] = subcode
    return {"status": "http_error", "error": error}


VIDEO_TEMPLATE_CREATIVE = {
    "id": "cr_tpl",
    "url_tags": "utm_source=meta",
    "object_story_spec": {
        "page_id": "page_1",
        "instagram_actor_id": "ig_1",
        "video_data": {
            "video_id": "video_tpl",
            "image_url": "https://scontent.cdn/capa-do-modelo.jpg",
            "message": "Texto do modelo",
            "call_to_action": {"type": "LEARN_MORE", "value": {"link": "https://site"}},
        },
    },
    "degrees_of_freedom_spec": {
        "creative_features_spec": {
            "standard_enhancements": {"enroll_status": "OPT_IN"},
            "image_touchups": {"enroll_status": "OPT_OUT"},
            "text_optimizations": {"enroll_status": "OPT_IN"},
        },
        "degrees_of_freedom_type": "USER_ENROLLED_AUTOFLOW",
    },
    "contextual_multi_ads": {"enroll_status": "OPT_OUT"},
}


class FakeAPI:
    """Graph API em memória. `fail` mapeia método → lista de respostas de erro a
    devolver nas próximas chamadas (consumidas em ordem)."""

    def __init__(self) -> None:
        self.calls: List[tuple] = []
        self.fail: Dict[str, List[Dict[str, Any]]] = {}
        self._seq = 0

    def _next(self, prefix: str) -> str:
        self._seq += 1
        return f"{prefix}_{self._seq}"

    def _maybe_fail(self, name: str):
        queue = self.fail.get(name) or []
        return queue.pop(0) if queue else None

    def _record(self, name: str, *args: Any) -> Dict[str, Any] | None:
        self.calls.append((name, *copy.deepcopy(args)))
        return self._maybe_fail(name)

    def copy_campaign(self, source_id, params):
        return self._record("copy_campaign", source_id, params) or ok({"copied_campaign_id": self._next("camp")})

    def update_campaign(self, campaign_id, params):
        return self._record("update_campaign", campaign_id, params) or ok({"success": True})

    def copy_adset(self, source_id, params):
        return self._record("copy_adset", source_id, params) or ok({"copied_adset_id": self._next("adset")})

    def update_adset(self, adset_id, params):
        return self._record("update_adset", adset_id, params) or ok({"success": True})

    def copy_ad(self, source_id, params):
        return self._record("copy_ad", source_id, params) or ok({"copied_ad_id": self._next("ad")})

    def update_ad(self, ad_id, params):
        return self._record("update_ad", ad_id, params) or ok({"success": True})

    def create_ad_creative(self, act_id, params):
        return self._record("create_ad_creative", act_id, params) or ok({"id": self._next("creative")})

    def create_ad(self, act_id, params):
        return self._record("create_ad", act_id, params) or ok({"id": self._next("ad")})

    def get_adset_fields(self, adset_id, fields):
        self._record("get_adset_fields", adset_id)
        return ok({"name": "Conjunto", "targeting": {"instagram_positions": ["explore_home", "stream"]}})

    def create_adset(self, act_id, params):
        return self._record("create_adset", act_id, params) or ok({"id": self._next("adset")})

    copies: Dict[str, List[Dict[str, Any]]] = {}

    def get_copies(self, source_id):
        self._record("get_copies", source_id)
        return ok({"data": copy.deepcopy(self.copies.get(source_id) or [])})

    def names(self) -> List[str]:
        return [c[0] for c in self.calls]


class FakeTracker:
    def __init__(self, payload: Dict[str, Any]) -> None:
        self.payload = payload
        self.heartbeats: List[Dict[str, Any]] = []
        self.failed: List[str] = []

    def try_claim_processing(self, job_id):
        return True

    def release_processing_claim(self, job_id):
        return True

    def get_payload(self, job_id):
        return self.payload

    def heartbeat(self, job_id, **kwargs):
        self.heartbeats.append(kwargs)
        return True

    def mark_failed(self, job_id, message, error_code=None):
        self.failed.append(message)


@pytest.fixture
def store(monkeypatch):
    """Itens em memória + mídias sempre prontas."""
    items: Dict[str, Dict[str, Any]] = {}

    def fetch_items(sb, job_id):
        return [copy.deepcopy(i) for i in sorted(items.values(), key=lambda i: i["position"])]

    def update_item(sb, item_id, patch):
        items[item_id].update(copy.deepcopy(patch))

    def wait_until_ready(sb, api, user_id, media_ids, **kwargs):
        return {
            m: {"id": m, "file_name": "novo.mp4", "media_type": "video", "video_id": "video_new", "thumbnail_hash": "thumb_new"}
            for m in media_ids
        }

    monkeypatch.setattr(campaign_launch_service, "fetch_items", fetch_items)
    monkeypatch.setattr(campaign_launch_service, "update_item", update_item)
    monkeypatch.setattr(ad_media_library, "wait_until_ready", wait_until_ready)
    monkeypatch.setattr(campaign_launch_service, "_META_WRITE_DELAY_SECONDS", 0)
    monkeypatch.setattr(campaign_launch_service, "_LOST_COPY_PROBE_DELAYS_SECONDS", (0, 0), raising=False)
    return items


def _payload(status: str = "PAUSED", budget_override=None, end_time_override=None) -> Dict[str, Any]:
    template = parse_creative_template({"creative": VIDEO_TEMPLATE_CREATIVE})
    return {
        "type": "campaign_launch",
        "template_ad_id": "ad_tpl",
        "template_ad_name": "Anúncio modelo",
        "template_campaign_id": "camp_tpl",
        "template_campaign_name": "Campanha modelo",
        "account_id": "123",
        "status": status,
        "total_items": 1,
        "budget_override": budget_override,
        "end_time_override": end_time_override,
        "creative_template": template.to_payload(),
        "template_creative": VIDEO_TEMPLATE_CREATIVE,
        "template_ad_fields": {"tracking_specs": [{"action.type": ["offsite_conversion"]}], "conversion_domain": "site.com"},
    }


def _add_item(items, adset_count: int = 2) -> str:
    item_id = "item-1"
    items[item_id] = {
        "id": item_id,
        "position": 1,
        "ad_name": "AD07",
        "campaign_name": "Teste AD07",
        "adset_name_template": "{template_adset_name} | {ad_name} #{index}",
        "media": {"slot_1": "media-1"},
        "status": "pending",
        "meta_campaign_id": None,
        "meta_creative_id": None,
        "adsets": [
            {"source_adset_id": f"src_{n}", "source_adset_name": f"Público {n}", "source_end_time": None}
            for n in range(1, adset_count + 1)
        ],
    }
    return item_id


def _processor(api: FakeAPI, payload: Dict[str, Any]) -> CampaignLaunchProcessor:
    ctx = LaunchContext(user_jwt="jwt", user_id="user-1", access_token="tok", job_id="job-1", account_id="123")
    return CampaignLaunchProcessor(ctx, api=api, sb=object(), tracker=FakeTracker(payload))


class TestHappyPath:
    def test_copies_everything_once_and_stores_checkpoints(self, store):
        item_id = _add_item(store, adset_count=2)
        api = FakeAPI()
        _processor(api, _payload()).run()

        item = store[item_id]
        assert item["status"] == "success"
        assert item["meta_campaign_id"] == "camp_1"
        assert [a["adset_id"] for a in item["adsets"]] == ["adset_2", "adset_4"]
        assert all(a["ad_id"] and a["ad_path"] == "copy" for a in item["adsets"])
        assert api.names().count("copy_campaign") == 1
        assert api.names().count("copy_ad") == 2

    def test_names_are_interpolated_per_adset(self, store):
        _add_item(store, adset_count=2)
        api = FakeAPI()
        _processor(api, _payload()).run()
        adset_names = [c[2]["name"] for c in api.calls if c[0] == "update_adset"]
        assert adset_names == ["Público 1 | AD07 #1", "Público 2 | AD07 #2"]
        campaign_patch = next(c for c in api.calls if c[0] == "update_campaign")
        assert campaign_patch[2] == {"name": "Teste AD07"}

    def test_ad_copy_swaps_only_media_and_uses_new_thumbnail(self, store):
        _add_item(store, adset_count=1)
        api = FakeAPI()
        _processor(api, _payload()).run()
        _, source, params = next(c for c in api.calls if c[0] == "copy_ad")
        assert source == "ad_tpl"
        assert params["status_option"] == "PAUSED"
        video = params["creative_parameters"]["object_story_spec"]["video_data"]
        assert video["video_id"] == "video_new"
        assert video["image_hash"] == "thumb_new"
        assert "image_url" not in video  # capa do modelo NÃO vai junto
        assert video["message"] == "Texto do modelo"
        oss = params["creative_parameters"]["object_story_spec"]
        assert oss["instagram_user_id"] == "ig_1" and "instagram_actor_id" not in oss
        # o resto do criativo é herdado pela cópia — não reenviamos
        assert "url_tags" not in params["creative_parameters"]


class TestResume:
    def test_failure_mid_item_then_retry_never_recopies_campaign(self, store):
        """Teste sabotado: o anúncio do 2º conjunto falha (erro transitório)."""
        item_id = _add_item(store, adset_count=2)
        api = FakeAPI()
        # 1ª cópia de anúncio passa; a 2ª recebe a falha enfileirada
        api.fail["copy_ad"] = [meta_error(2, message="Service temporarily unavailable")]
        original = api.copy_ad
        calls = {"n": 0}

        def copy_ad(source, params):
            calls["n"] += 1
            if calls["n"] == 1:
                api.calls.append(("copy_ad", source, params))
                return ok({"copied_ad_id": "ad_first"})
            return original(source, params)

        api.copy_ad = copy_ad
        _processor(api, _payload()).run()

        item = store[item_id]
        assert item["status"] == "error"
        assert item["meta_campaign_id"] == "camp_1"
        assert item["adsets"][0]["ad_id"] == "ad_first"
        assert item["adsets"][1]["adset_id"] and not item["adsets"][1].get("ad_id")

        # "Tentar novamente": volta a pending mantendo checkpoints
        item["status"] = "pending"
        api2 = FakeAPI()
        _processor(api2, _payload()).run()

        assert store[item_id]["status"] == "success"
        assert "copy_campaign" not in api2.names()
        assert "copy_adset" not in api2.names()
        assert api2.names().count("copy_ad") == 1
        assert store[item_id]["meta_campaign_id"] == "camp_1"

    def test_rename_failure_after_ad_copy_never_copies_the_ad_twice(self, store):
        """Teste sabotado: a cópia do anúncio passa e o rename cai (transitório)."""
        item_id = _add_item(store, adset_count=1)
        api = FakeAPI()
        api.fail["update_ad"] = [meta_error(2, message="Service temporarily unavailable")]
        _processor(api, _payload()).run()
        assert store[item_id]["status"] == "error"
        assert store[item_id]["adsets"][0]["ad_id"] == "ad_3"

        store[item_id]["status"] = "pending"
        api2 = FakeAPI()
        _processor(api2, _payload()).run()
        assert store[item_id]["status"] == "success"
        assert "copy_ad" not in api2.names() and "create_ad" not in api2.names()
        assert ("update_ad", "ad_3", {"name": "AD07"}) in api2.calls

    def test_retry_after_failed_job_resumes_pending_and_running_items(self, store):
        """Token expirado derruba o job com itens pending/running: o retry precisa pegá-los."""
        _add_item(store, adset_count=1)
        store["item-2"] = {**copy.deepcopy(store["item-1"]), "id": "item-2", "position": 2, "status": "running"}
        store["item-3"] = {**copy.deepcopy(store["item-1"]), "id": "item-3", "position": 3, "status": "success"}
        assert campaign_launch_service.reset_failed_items(None, "job") == 2
        assert [store[i]["status"] for i in ("item-1", "item-2", "item-3")] == ["pending", "pending", "success"]

    def test_running_item_from_dead_worker_is_resumed(self, store):
        item_id = _add_item(store, adset_count=1)
        store[item_id].update({"status": "running", "meta_campaign_id": "camp_old"})
        api = FakeAPI()
        _processor(api, _payload()).run()
        assert store[item_id]["status"] == "success"
        assert "copy_campaign" not in api.names()


class TestFallbacks:
    def test_ad_copy_validation_error_falls_back_to_create_with_fidelity(self, store):
        item_id = _add_item(store, adset_count=2)
        api = FakeAPI()
        api.fail["copy_ad"] = [meta_error(100, 1885183, "Invalid parameter"), meta_error(100, message="Invalid")]
        _processor(api, _payload()).run()

        assert store[item_id]["status"] == "success"
        assert api.names().count("create_ad_creative") == 1  # 1 criativo reusado nos 2 conjuntos
        creative = next(c for c in api.calls if c[0] == "create_ad_creative")[2]
        features = creative["degrees_of_freedom_spec"]["creative_features_spec"]
        assert "standard_enhancements" not in features
        assert features["image_touchups"] == {"enroll_status": "OPT_OUT"}
        assert creative["contextual_multi_ads"] == {"enroll_status": "OPT_OUT"}
        ads = [c[2] for c in api.calls if c[0] == "create_ad"]
        assert len(ads) == 2 and all(a["conversion_domain"] == "site.com" for a in ads)
        assert all(a["ad_path"] == "create" for a in store[item_id]["adsets"])

    def test_transient_ad_copy_error_does_not_fall_back(self, store):
        item_id = _add_item(store, adset_count=1)
        api = FakeAPI()
        api.fail["copy_ad"] = [meta_error(2, message="temporário")]
        _processor(api, _payload()).run()
        assert store[item_id]["status"] == "error"
        assert "create_ad_creative" not in api.names()

    def test_compliance_error_flags_account(self, store, monkeypatch):
        item_id = _add_item(store, adset_count=1)
        api = FakeAPI()
        api.fail["copy_adset"] = [meta_error(100, 3858495, "compliance")]
        flagged = []
        monkeypatch.setattr(
            CampaignLaunchProcessor, "_flag_account_requires_transparency", lambda self: flagged.append(True)
        )
        _processor(api, _payload()).run()
        assert store[item_id]["status"] == "error"
        assert store[item_id]["error_code"] == "adset_missing_compliance"
        assert flagged == [True]

    def test_explore_home_falls_back_to_create_adset_without_touching_source(self, store):
        item_id = _add_item(store, adset_count=1)
        api = FakeAPI()
        api.fail["copy_adset"] = [
            meta_error(100, 2490392, "explore", error_data={"blame_field_specs": [["instagram_positions"]]})
        ]
        _processor(api, _payload()).run()
        assert store[item_id]["status"] == "success"
        created = next(c for c in api.calls if c[0] == "create_adset")[2]
        # v26 removeu o Feed do Explorar: o plano B nunca pede "explore"
        assert created["targeting"]["instagram_positions"] == ["explore_home", "stream"]
        assert all(c[0] != "update_adset" or c[1] != "src_1" for c in api.calls)


class TestActivationAndBudget:
    def test_active_launch_activates_campaign_last(self, store):
        _add_item(store, adset_count=1)
        api = FakeAPI()
        _processor(api, _payload(status="ACTIVE")).run()
        assert api.calls[-1][0] == "update_campaign" and api.calls[-1][2] == {"status": "ACTIVE"}
        adset_patch = next(c for c in api.calls if c[0] == "update_adset")[2]
        assert adset_patch["status"] == "ACTIVE"

    def test_abo_budget_override_goes_to_each_adset(self, store):
        _add_item(store, adset_count=2)
        api = FakeAPI()
        override = {"level": "adset", "field": "daily_budget", "amount": 5000}
        _processor(api, _payload(budget_override=override)).run()
        assert all(c[2]["daily_budget"] == 5000 for c in api.calls if c[0] == "update_adset")
        assert all("daily_budget" not in c[2] for c in api.calls if c[0] == "update_campaign")


class TestCreativeHelpers:
    def test_sanitize_dof_drops_deprecated_and_output_keys(self):
        out = sanitize_degrees_of_freedom_spec(VIDEO_TEMPLATE_CREATIVE["degrees_of_freedom_spec"])
        assert out == {
            "creative_features_spec": {
                "image_touchups": {"enroll_status": "OPT_OUT"},
                "text_optimizations": {"enroll_status": "OPT_IN"},
            }
        }

    def test_image_into_video_template_becomes_link_data(self):
        template = parse_creative_template({"creative": VIDEO_TEMPLATE_CREATIVE})
        media = BundleMediaRef("b", {"slot_1": MediaRef(0, "img.jpg", "image", image_hash="hash_img")})
        params = build_creative_parameters({"ad_name": "AD"}, template, media)
        link = params["object_story_spec"]["link_data"]
        assert link["image_hash"] == "hash_img" and link["link"] == "https://site"
        assert "video_data" not in params["object_story_spec"]


@pytest.mark.parametrize(
    "value,expected",
    [
        ("https://drive.google.com/drive/folders/1AbCdEfGhIjKlMn?usp=sharing", "1AbCdEfGhIjKlMn"),
        ("https://drive.google.com/drive/u/1/folders/1AbCdEfGhIjKlMn", "1AbCdEfGhIjKlMn"),
        ("https://drive.google.com/open?id=1AbCdEfGhIjKlMn", "1AbCdEfGhIjKlMn"),
        ("1AbCdEfGhIjKlMn", "1AbCdEfGhIjKlMn"),
        ("https://evil.example.com/folders/1AbCdEfGhIjKlMn", None),
        ("pasta", None),
    ],
)
def test_parse_folder_id(value, expected):
    assert parse_folder_id(value) == expected


class TestApiVersion:
    def test_launch_graph_api_uses_v26_while_default_stays(self):
        from app.core.config import META_GRAPH_BASE_URL, META_LAUNCH_GRAPH_BASE_URL
        from app.services.graph_api import GraphAPI

        assert "/v26.0/" in META_LAUNCH_GRAPH_BASE_URL
        launch = GraphAPI("tok", base_url=META_LAUNCH_GRAPH_BASE_URL)
        default = GraphAPI("tok")
        assert launch.base_url == META_LAUNCH_GRAPH_BASE_URL
        assert default.base_url == META_GRAPH_BASE_URL


class TestFidelityMeasuredOnMeta:
    """Dois achados do teste de escrita real em v26 (scripts/meta_write_smoke.py, 2026-11-01)."""

    SOURCING = {"videos": [{"video_id": "video_tpl", "original_video_id": "video_tpl", "source": "multi_media",
                            "opt_in_status": "opt_in", "thumbnail_url": "https://scontent.cdn/x.jpg"}]}

    def _media(self, kind="video"):
        ref = MediaRef(0, "n", kind, video_id="video_new", thumbnail_hash="t") if kind == "video" else MediaRef(0, "n", "image", image_hash="hash_new")
        return BundleMediaRef("b", {"slot_1": ref})

    def test_media_sourcing_spec_points_to_new_media(self):
        # Sem isso: subcode 4931013 "video ... not present in media_sourcing_spec.videos".
        template = parse_creative_template({"creative": VIDEO_TEMPLATE_CREATIVE})
        params = build_creative_parameters({"ad_name": "AD"}, template, self._media(),
                                           template_creative={**VIDEO_TEMPLATE_CREATIVE, "media_sourcing_spec": self.SOURCING})
        assert params["media_sourcing_spec"] == {"videos": [{"video_id": "video_new", "source": "multi_media", "opt_in_status": "opt_in"}]}

    def test_cross_type_drops_stale_sourcing_list(self):
        template = parse_creative_template({"creative": VIDEO_TEMPLATE_CREATIVE})
        params = build_creative_parameters({"ad_name": "AD"}, template, self._media("image"),
                                           template_creative={**VIDEO_TEMPLATE_CREATIVE, "media_sourcing_spec": self.SOURCING})
        assert "video_tpl" not in str(params["media_sourcing_spec"])

    def test_copy_sends_template_enhancements_explicitly(self):
        # Sem isso: video_filtering OPT_OUT no modelo nasceu OPT_IN na cópia.
        template = parse_creative_template({"creative": VIDEO_TEMPLATE_CREATIVE})
        params = build_creative_parameters({"ad_name": "AD"}, template, self._media(), template_creative=VIDEO_TEMPLATE_CREATIVE)
        feats = params["degrees_of_freedom_spec"]["creative_features_spec"]
        assert feats["image_touchups"] == {"enroll_status": "OPT_OUT"}
        assert "standard_enhancements" not in feats


def _iso(minutes_ago: int) -> str:
    from datetime import datetime, timedelta, timezone
    return (datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)).strftime("%Y-%m-%dT%H:%M:%S+0000")


class TestLostCopyResponse:
    """POST /copies sem resposta (timeout): a Meta pode ter criado. Adota em vez de copiar de novo."""

    def test_campaign_created_despite_timeout_is_adopted(self, store):
        item_id = _add_item(store, adset_count=1)
        api = FakeAPI()
        api.fail["copy_campaign"] = [{"status": "error", "message": "Read timed out"}]
        api.copies["camp_tpl"] = [
            {"id": "camp_old", "name": "Campanha modelo", "created_time": _iso(600)},  # velha: não é nossa
            {"id": "camp_other", "name": "Teste AD06", "created_time": _iso(2)},  # já renomeada: outra
            {"id": "camp_lost", "name": "Campanha modelo", "created_time": _iso(1)},
        ]
        _processor(api, _payload()).run()
        assert store[item_id]["status"] == "success"
        assert store[item_id]["meta_campaign_id"] == "camp_lost"
        assert api.names().count("copy_campaign") == 1

    def test_copy_already_used_by_another_item_is_not_adopted(self, store):
        item_id = _add_item(store, adset_count=1)
        store["item-0"] = {**copy.deepcopy(store[item_id]), "id": "item-0", "position": 0,
                           "status": "success", "meta_campaign_id": "camp_lost"}
        api = FakeAPI()
        api.fail["copy_campaign"] = [{"status": "error", "message": "Read timed out"}]
        api.copies["camp_tpl"] = [{"id": "camp_lost", "name": "Campanha modelo", "created_time": _iso(1)}]
        _processor(api, _payload()).run()
        assert store[item_id]["status"] == "error"
        assert not store[item_id].get("meta_campaign_id")

    def test_meta_rejection_never_probes_copies(self, store):
        _add_item(store, adset_count=1)
        api = FakeAPI()
        api.fail["copy_campaign"] = [meta_error(100, message="Invalid")]
        _processor(api, _payload()).run()
        assert "get_copies" not in api.names()


class TestAdvantageAudience:
    def test_copy_rejected_for_missing_flag_falls_back_with_explicit_flag(self, store):
        item_id = _add_item(store, adset_count=1)
        api = FakeAPI()
        api.fail["copy_adset"] = [meta_error(100, message="ADS_TARGETING__REQUIRE_EXPLICIT_ADVANTAGE_AUDIENCE_FLAG")]
        _processor(api, _payload()).run()
        assert store[item_id]["status"] == "success"
        created = next(c for c in api.calls if c[0] == "create_adset")[2]
        assert created["targeting"]["targeting_automation"] == {"advantage_audience": 0}


class TestBudgetField:
    def test_override_type_comes_from_selected_adsets(self):
        from app.routes.campaign_launch import _selected_adsets_budget_field

        assert _selected_adsets_budget_field([{"lifetime_budget": 5000}]) == "lifetime_budget"
        assert _selected_adsets_budget_field([{"daily_budget": 100}, {"daily_budget": 300}]) == "daily_budget"
        with pytest.raises(Exception) as exc:
            _selected_adsets_budget_field([{"daily_budget": 100}, {"lifetime_budget": 5000}])
        assert getattr(exc.value, "status_code", None) == 422


class TestEndDate:
    def test_new_end_date_goes_to_copy_and_expired_adset_patch(self, store):
        item_id = _add_item(store, adset_count=1)
        store[item_id]["adsets"][0]["source_end_time"] = "2020-01-01T00:00:00-0300"
        api = FakeAPI()
        _processor(api, _payload(end_time_override="2099-01-31T23:59:00")).run()
        assert next(c for c in api.calls if c[0] == "copy_adset")[2]["end_time"] == "2099-01-31T23:59:00"
        patch = next(c for c in api.calls if c[0] == "update_adset")[2]
        assert patch["end_time"] == "2099-01-31T23:59:00" and patch["start_time"] == ""

    def test_without_new_date_expired_schedule_is_cleared(self, store):
        item_id = _add_item(store, adset_count=1)
        store[item_id]["adsets"][0]["source_end_time"] = "2020-01-01T00:00:00-0300"
        api = FakeAPI()
        _processor(api, _payload()).run()
        assert "end_time" not in next(c for c in api.calls if c[0] == "copy_adset")[2]
        assert next(c for c in api.calls if c[0] == "update_adset")[2]["end_time"] == ""

    def test_fallback_create_uses_new_end_date(self, store):
        _add_item(store, adset_count=1)
        api = FakeAPI()
        api.fail["copy_adset"] = [meta_error(100, message="ADS_TARGETING__REQUIRE_EXPLICIT_ADVANTAGE_AUDIENCE_FLAG")]
        _processor(api, _payload(end_time_override="2099-01-31T23:59:00")).run()
        assert next(c for c in api.calls if c[0] == "create_adset")[2]["end_time"] == "2099-01-31T23:59:00"

    def test_route_requires_date_for_expired_lifetime_and_rejects_past(self):
        from datetime import date

        from app.routes.campaign_launch import _end_time_override

        expired = {"name": "A", "needs_end_date": True}
        with pytest.raises(Exception) as exc:
            _end_time_override(None, [expired])
        assert getattr(exc.value, "status_code", None) == 422
        with pytest.raises(Exception) as exc:
            _end_time_override(date(2020, 1, 1), [expired])
        assert getattr(exc.value, "status_code", None) == 422
        assert _end_time_override(None, [{"name": "B", "needs_end_date": False}]) is None
        assert _end_time_override(date(2099, 1, 31), [expired]) == "2099-01-31T23:59:00"


class TestMediaWait:
    def _rows(self, monkeypatch, row):
        monkeypatch.setattr(ad_media_library, "fetch_media", lambda sb, uid, ids: {"m1": row})
        monkeypatch.setattr(ad_media_library.time, "sleep", lambda s: None)

    def test_abandoned_upload_fails_fast(self, monkeypatch):
        self._rows(monkeypatch, {"id": "m1", "status": "uploading", "file_name": "a.mp4", "updated_at": _iso(30)})
        with pytest.raises(campaign_launch_service.MetaAPIError) as exc:
            ad_media_library.wait_until_ready(None, None, "u", ["m1"], heartbeat=lambda m: None, max_wait_seconds=10**6)
        assert exc.value.error_code == "media_upload_stalled"

    def test_live_upload_does_not_hit_the_deadline(self, monkeypatch):
        calls = {"n": 0}

        def fetch(sb, uid, ids):
            calls["n"] += 1
            status = "ready" if calls["n"] > 3 else "uploading"
            return {"m1": {"id": "m1", "status": status, "file_name": "a.mp4", "updated_at": _iso(0)}}

        monkeypatch.setattr(ad_media_library, "fetch_media", fetch)
        now = {"t": 0}  # cada espera "passa" 1000 s: sem o reset do prazo, a 1ª volta já estouraria
        monkeypatch.setattr(ad_media_library.time, "monotonic", lambda: now["t"])
        monkeypatch.setattr(ad_media_library.time, "sleep", lambda s: now.__setitem__("t", now["t"] + 1000))
        rows = ad_media_library.wait_until_ready(None, None, "u", ["m1"], heartbeat=lambda m: None, max_wait_seconds=900)
        assert rows["m1"]["status"] == "ready"
