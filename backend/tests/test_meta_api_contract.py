"""Contrato das chamadas à Meta: o que o app ENVIA, travado num snapshot.

Cada método público do GraphAPI é chamado com argumentos fictícios contra uma rede
falsa que só grava as requisições. O resultado (método HTTP, caminho sem versão,
`fields` e nomes de parâmetro) é comparado com `fixtures/meta_api_contract.json`.

- Mudou sem querer (campo sumiu, parâmetro renomeado) → o teste falha e mostra a diferença.
- Mudou de propósito → regenerar: `UPDATE_META_CONTRACT=1 pytest tests/test_meta_api_contract.py`
  e revisar o diff do JSON no commit.

Também garante que TODA chamada sai na versão configurada (nada de URL com versão
escrita à mão) — é a rede de segurança das migrações de versão. Não fala com a Meta:
o que a Meta RESPONDE é coberto por `scripts/meta_version_diff.py`.
"""
from __future__ import annotations

import inspect
import json
import os
import re
from pathlib import Path
from typing import Any, Dict, List
from urllib.parse import parse_qsl, urlparse

import pytest
import requests

from app.core import config
from app.services import graph_api as graph_api_module
from app.services.graph_api import GraphAPI

SNAPSHOT = Path(__file__).parent / "fixtures" / "meta_api_contract.json"
VERSION_RE = re.compile(r"^/v[^/]+/")
BASE = "https://graph.facebook.com/vTEST.0/"

# Métodos que não são chamadas à Meta (ou dependem de arquivo/stream real).
SKIP = {"upload_ad_video_chunked"}
# Argumentos explícitos onde o fictício genérico não chega à chamada.
OVERRIDES: Dict[str, tuple] = {
    "start_ads_job": (("act_123", {"since": "2026-10-01", "until": "2026-10-03"}, []), {}),
    "get_ad_statuses_by_parent": (("act_123", "campaign.id", "123"), {}),
    "get_entity_statuses_for_account": (("act_123", "ads"), {}),
    "update_entity_budget": (("123", "campaign"), {"daily_budget": 1000}),
    "get_video_source_url": ((), {"video_id": "123", "video_owner_page_id": "9"}),
}


class FakeResponse:
    status_code = 200
    ok = True
    headers: Dict[str, str] = {}
    text = "{}"
    content = b"{}"
    url = ""

    def json(self) -> Dict[str, Any]:
        return {"data": [], "id": "1", "report_run_id": "1", "success": True}

    def raise_for_status(self) -> None:
        return None

    def iter_content(self, *a, **k):
        return iter(())


def _shape(method: str, url: str, params: Any, data: Any, json_payload: Any, files: Any) -> Dict[str, Any]:
    parsed = urlparse(url)
    query = dict(parse_qsl(parsed.query))
    merged: Dict[str, Any] = {**query, **(params or {})}
    body = {**(data or {}), **(json_payload or {})} if isinstance(data or {}, dict) else {}
    fields = merged.get("fields")
    return {
        "method": method.upper(),
        "path": VERSION_RE.sub("/", parsed.path) if parsed.netloc == "graph.facebook.com" else url,
        "host_versioned": parsed.netloc != "graph.facebook.com" or url.startswith(BASE),
        "fields": fields,
        "params": sorted(k for k in merged if k not in ("fields", "access_token")),
        "body": sorted(body),
        "files": sorted(files or {}),
    }


def _dummy(param: inspect.Parameter) -> Any:
    ann = str(param.annotation)
    name = param.name
    if "List" in ann or name.endswith("_ids") or name in ("ids",):
        return ["111", "222"]
    if "Dict" in ann:
        return {"since": "2026-10-01", "until": "2026-10-03"} if "time_range" in name else {}
    if "int" in ann and "str" not in ann:
        return 1
    if "bool" in ann:
        return False
    if name in ("act_id",):
        return "act_123"
    if name == "status":
        return "PAUSED"
    if name == "entity_type":
        return "campaign"
    return "123"


def _record_all(monkeypatch) -> Dict[str, List[Dict[str, Any]]]:
    calls: List[Dict[str, Any]] = []

    def fake_request(method, url, params=None, data=None, json=None, files=None, **kw):
        calls.append(_shape(method, url, params, data, json, files))
        return FakeResponse()

    monkeypatch.setattr(requests, "request", fake_request)
    monkeypatch.setattr(requests, "get", lambda url, params=None, **kw: fake_request("GET", url, params, **kw))
    monkeypatch.setattr(requests, "post", lambda url, params=None, data=None, json=None, files=None, **kw: fake_request("POST", url, params, data, json, files))
    monkeypatch.setattr(graph_api_module, "get_page_access_token_for_page_id", lambda **kw: None)
    monkeypatch.setattr(graph_api_module.time, "sleep", lambda *_: None)
    # O registrador de uso grava no banco: num teste nunca.
    monkeypatch.setattr(graph_api_module, "log_meta_usage", lambda *a, **k: None)

    api = GraphAPI("TOKEN", user_id="user", base_url=BASE)
    contract: Dict[str, List[Dict[str, Any]]] = {}
    for name, fn in sorted(inspect.getmembers(api, predicate=inspect.ismethod)):
        if name.startswith("_") or name in SKIP:
            continue
        params = [p for p in inspect.signature(fn).parameters.values()
                  if p.default is inspect.Parameter.empty and p.kind not in (p.VAR_POSITIONAL, p.VAR_KEYWORD)]
        calls.clear()
        args, kwargs = OVERRIDES.get(name) or (
            [_dummy(p) for p in params if p.kind != p.KEYWORD_ONLY],
            {p.name: _dummy(p) for p in params if p.kind == p.KEYWORD_ONLY},
        )
        try:
            fn(*args, **kwargs)
        except Exception as exc:  # noqa: BLE001 — resposta fictícia pode não satisfazer o parser
            if not calls:
                contract[name] = [{"error": type(exc).__name__}]
                continue
        contract[name] = list(calls)
    return contract


def test_every_call_uses_configured_version(monkeypatch):
    contract = _record_all(monkeypatch)
    wrong = {name: c["path"] for name, cs in contract.items() for c in cs if not c.get("host_versioned", True)}
    assert not wrong, f"chamadas fora da versão configurada: {wrong}"


def test_contract_matches_snapshot(monkeypatch):
    contract = _record_all(monkeypatch)
    if os.getenv("UPDATE_META_CONTRACT") == "1" or not SNAPSHOT.exists():
        SNAPSHOT.parent.mkdir(exist_ok=True)
        SNAPSHOT.write_text(json.dumps(contract, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        pytest.skip("snapshot regenerado — revise o diff de fixtures/meta_api_contract.json")
    expected = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    changed = sorted(k for k in set(expected) | set(contract) if expected.get(k) != contract.get(k))
    assert not changed, (
        f"contrato com a Meta mudou em {changed}. Se foi de propósito: "
        "UPDATE_META_CONTRACT=1 pytest tests/test_meta_api_contract.py"
    )


def test_global_urls_follow_version():
    # Login/troca de token sobem junto com a versão (sem URL fixada no .env).
    assert config.META_API_VERSION in config.META_GRAPH_BASE_URL
    if not os.getenv("FACEBOOK_AUTH_BASE_URL"):
        assert config.META_API_VERSION in config.FACEBOOK_AUTH_BASE_URL
    if not os.getenv("FACEBOOK_TOKEN_URL"):
        assert config.META_API_VERSION in config.FACEBOOK_TOKEN_URL
