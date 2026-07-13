"""Testes do rate limiting em memória (app.core.rate_limit).

Cobrem: matching de regras por método+path, enforcement do sliding window,
expiração da janela, isolamento entre buckets (rotas e usuários) e a
extração da chave (JWT sub sem verificação; fallback pro último hop do XFF).
"""
import sys
from pathlib import Path

import pytest
from jose import jwt as jose_jwt
from starlette.requests import Request

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core import rate_limit as rl


@pytest.fixture(autouse=True)
def _clean_buckets():
    rl._buckets.clear()
    yield
    rl._buckets.clear()


def make_request(method="GET", path="/x", headers=None, client=("9.9.9.9", 1234)):
    raw_headers = [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()]
    scope = {
        "type": "http",
        "method": method,
        "path": path,
        "headers": raw_headers,
        "client": client,
        "query_string": b"",
    }
    return Request(scope)


# ---------------------------------------------------------------- regras

def test_match_rule_expensive_mutations():
    assert rl._match_rule("POST", "/facebook/refresh-pack/abc-123") == ("refresh-pack", 30)
    assert rl._match_rule("POST", "/facebook/packs/p1/transcribe") == ("transcribe-pack", 10)
    assert rl._match_rule("POST", "/facebook/transcription/start") == ("transcribe-ad", 30)
    assert rl._match_rule("POST", "/facebook/bulk-ads") == ("bulk-ads", 10)
    assert rl._match_rule("POST", "/facebook/bulk-ads/j1/retry") == ("bulk-ads", 10)
    assert rl._match_rule("POST", "/facebook/adaccounts/sync") == ("adaccounts-sync", 10)
    assert rl._match_rule("POST", "/google/ad-sheet-integrations/i1/sync-job") == ("sheet-sync", 30)
    assert rl._match_rule("POST", "/google/ad-sheet-integrations/i1/sync") == ("sheet-sync", 30)


def test_match_rule_polling_gets_default_not_mutation_limit():
    # Polling de jobs cai no default (300/min), não no limite da mutação.
    assert rl._match_rule("GET", "/facebook/bulk-ads/job123") == ("default", rl.DEFAULT_LIMIT)
    assert rl._match_rule("GET", "/facebook/ads-progress/job123") == ("default", rl.DEFAULT_LIMIT)
    assert rl._match_rule("GET", "/facebook/campaign-bulk/job123") == ("default", rl.DEFAULT_LIMIT)


def test_match_rule_analytics_heavy():
    assert rl._match_rule("POST", "/analytics/rankings") == ("analytics-heavy", 120)
    assert rl._match_rule("POST", "/analytics/ad-performance/series") == ("analytics-heavy", 120)
    assert rl._match_rule("POST", "/analytics/rankings/retention") == ("analytics-heavy", 120)
    assert rl._match_rule("GET", "/analytics/rankings/ad-id/123/history") == ("analytics-heavy", 120)
    # Leituras leves de packs ficam no default
    assert rl._match_rule("GET", "/analytics/packs") == ("default", rl.DEFAULT_LIMIT)


def test_match_rule_unauth_and_destructive():
    assert rl._match_rule("POST", "/billing/webhook") == ("stripe-webhook", 240)
    assert rl._match_rule("DELETE", "/user/account") == ("user-delete", 5)
    assert rl._match_rule("DELETE", "/user/data") == ("user-delete", 5)


# ---------------------------------------------------------------- janela

def test_limit_enforced_and_recovers_after_window(monkeypatch):
    clock = {"t": 1000.0}
    monkeypatch.setattr(rl, "_now", lambda: clock["t"])

    for _ in range(5):
        assert rl.check_rate_limit("user:u1", "user-delete", 5) is None

    retry = rl.check_rate_limit("user:u1", "user-delete", 5)
    assert retry is not None and 0 < retry <= rl.WINDOW_SECONDS

    # Janela expira -> volta a permitir
    clock["t"] += rl.WINDOW_SECONDS + 1
    assert rl.check_rate_limit("user:u1", "user-delete", 5) is None


def test_buckets_are_isolated_per_rule_and_user(monkeypatch):
    monkeypatch.setattr(rl, "_now", lambda: 1000.0)

    for _ in range(5):
        assert rl.check_rate_limit("user:u1", "user-delete", 5) is None
    assert rl.check_rate_limit("user:u1", "user-delete", 5) is not None

    # Outra rota do MESMO usuário não é afetada
    assert rl.check_rate_limit("user:u1", "billing", 10) is None
    # Mesmo bucket para OUTRO usuário não é afetado
    assert rl.check_rate_limit("user:u2", "user-delete", 5) is None


def test_sliding_window_partial_expiry(monkeypatch):
    clock = {"t": 0.0}
    monkeypatch.setattr(rl, "_now", lambda: clock["t"])

    # 3 hits em t=0, 2 hits em t=30 -> cheio (limite 5)
    for _ in range(3):
        rl.check_rate_limit("user:u1", "r", 5)
    clock["t"] = 30.0
    for _ in range(2):
        rl.check_rate_limit("user:u1", "r", 5)
    assert rl.check_rate_limit("user:u1", "r", 5) is not None

    # t=61: os 3 primeiros saíram da janela -> permite de novo
    clock["t"] = 61.0
    assert rl.check_rate_limit("user:u1", "r", 5) is None


# ---------------------------------------------------------------- chave

def test_bucket_key_uses_jwt_sub_without_verification():
    token = jose_jwt.encode({"sub": "user-abc"}, "qualquer-secret", algorithm="HS256")
    req = make_request(headers={"Authorization": f"Bearer {token}"})
    assert rl._bucket_key(req) == "user:user-abc"


def test_bucket_key_malformed_token_falls_back_to_ip():
    req = make_request(headers={"Authorization": "Bearer nao-e-um-jwt"}, client=("5.6.7.8", 1))
    assert rl._bucket_key(req) == "ip:5.6.7.8"


def test_bucket_key_ip_uses_last_xff_hop_not_first():
    # Primeiro hop é spoofável pelo cliente; o último foi anexado pelo Traefik.
    req = make_request(headers={"X-Forwarded-For": "6.6.6.6, 203.0.113.9"})
    assert rl._bucket_key(req) == "ip:203.0.113.9"


def test_bucket_key_no_xff_uses_peer():
    req = make_request(client=("10.0.0.2", 1))
    assert rl._bucket_key(req) == "ip:10.0.0.2"


# ---------------------------------------------------------------- sweep

def test_sweep_removes_stale_buckets(monkeypatch):
    clock = {"t": 0.0}
    monkeypatch.setattr(rl, "_now", lambda: clock["t"])

    rl.check_rate_limit("user:u1", "r", 5)
    assert ("user:u1", "r") in rl._buckets

    clock["t"] = rl.WINDOW_SECONDS + 10
    rl._sweep_stale(clock["t"])
    assert ("user:u1", "r") not in rl._buckets
