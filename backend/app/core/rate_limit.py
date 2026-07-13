"""Rate limiting em memória, por usuário (JWT sub) com fallback por IP.

Por que em memória e não Redis/slowapi: o backend roda em UM container
(deploy/docker-compose.yml), então um sliding window local é suficiente e
evita dependência nova. Se o backend escalar horizontalmente, este módulo
precisa migrar para um storage compartilhado (Redis) — os limites passariam
a valer por réplica, o que os multiplica silenciosamente.

Chave do bucket:
- Requests com Bearer token: ``user:{sub}`` extraído SEM verificar assinatura.
  Um sub forjado troca de bucket, mas o request morre logo em seguida no
  get_current_user (401 barato, sem tocar Meta/Supabase); flood bruto sem
  token válido é contido pelo rateLimit por IP do Traefik (camada de borda).
- Sem token: ``ip:{client}`` usando o ÚLTIMO hop do X-Forwarded-For — o que
  o Traefik anexou e o cliente não controla. Nunca usar o primeiro hop
  (spoofável pelo atacante).

Os limites são disjuntores anti-abuso, não traffic shaping: foram calibrados
contra picos reais de uso medidos no banco (2026-07: 12 jobs/min num único
usuário durante auto-refresh de packs) com folga de 3-5x. Usuário legítimo
nunca deve ver 429. Todo 429 é logado com user/rota para auditoria — se um
limite disparar em produção para uso legítimo, suba o limite, não silencie o log.
"""
from __future__ import annotations

import logging
import re
import threading
import time
from collections import deque
from typing import Callable, Deque, Dict, Optional, Tuple

from fastapi import Request
from fastapi.responses import JSONResponse
from jose import jwt as jose_jwt

from app.core.config import RATE_LIMIT_ENABLED

logger = logging.getLogger(__name__)

WINDOW_SECONDS = 60.0
DEFAULT_LIMIT = 300  # rede de segurança para rotas autenticadas comuns

# Avaliadas em ordem; a primeira que casar (método + path) define o limite.
# Limites por ROTA, não por classe compartilhada: o burst legítimo de
# refresh-pack (até 12/min medidos) não pode consumir o orçamento de outra rota.
_RULES: Tuple[Tuple[str, re.Pattern[str], str, int], ...] = tuple(
    (method, re.compile(pattern), name, limit)
    for method, pattern, name, limit in [
        # Mutações caras (1 request humano -> fan-out de chamadas Meta/custo $)
        ("POST", r"^/facebook/refresh-pack/", "refresh-pack", 30),
        ("POST", r"^/google/ad-sheet-integrations/[^/]+/sync(-job)?$", "sheet-sync", 30),
        ("POST", r"^/facebook/packs/[^/]+/transcribe$", "transcribe-pack", 10),
        ("POST", r"^/facebook/transcription/start$", "transcribe-ad", 30),
        ("POST", r"^/facebook/bulk-ads", "bulk-ads", 10),  # inclui /{job_id}/retry
        ("POST", r"^/facebook/campaign-bulk", "campaign-bulk", 10),
        ("POST", r"^/facebook/ads-progress$", "load-ads", 20),
        ("POST", r"^/facebook/adaccounts/sync$", "adaccounts-sync", 10),
        ("POST", r"^/facebook/packs/status-sync$", "status-sync", 20),
        # Billing (cliques humanos; evita spam de sessões Stripe)
        ("POST", r"^/billing/(checkout-session|portal-session|sync)$", "billing", 10),
        # Destrutivas
        ("DELETE", r"^/user/(account|data)$", "user-delete", 5),
        # Sem auth (chave vira IP): assinatura Stripe/Meta é a defesa real,
        # o limite só contém flood.
        ("POST", r"^/billing/webhook$", "stripe-webhook", 240),
        ("POST", r"^/user/meta-data-deletion-callback$", "meta-deletion", 60),
        # Analytics pesados (RPCs Supabase com histórico de statement_timeout)
        ("POST", r"^/analytics/(rankings|ad-performance)(/series|/retention)?$", "analytics-heavy", 120),
        ("POST", r"^/analytics/dashboard$", "analytics-heavy", 120),
        ("GET", r"^/analytics/rankings/", "analytics-heavy", 120),
    ]
)

_EXEMPT_PATHS = frozenset({"/", "/health"})

# (bucket_key, rule_name) -> timestamps dos hits dentro da janela.
# maxlen = limite: bucket nunca cresce além do necessário.
_buckets: Dict[Tuple[str, str], Deque[float]] = {}
_lock = threading.Lock()
_checks_since_sweep = 0
_SWEEP_EVERY = 2048

# Indireção para testes controlarem o relógio.
_now: Callable[[], float] = time.monotonic


def _match_rule(method: str, path: str) -> Tuple[str, int]:
    for rule_method, pattern, name, limit in _RULES:
        if method == rule_method and pattern.match(path):
            return name, limit
    return "default", DEFAULT_LIMIT


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        # Último hop = anexado pelo proxy confiável (Traefik); os anteriores
        # são controláveis pelo cliente.
        last = forwarded.split(",")[-1].strip()
        if last:
            return last
    return request.client.host if request.client else "unknown"


def _bucket_key(request: Request) -> str:
    auth = request.headers.get("authorization", "")
    if auth.startswith("Bearer "):
        token = auth[7:].strip()
        try:
            sub = jose_jwt.get_unverified_claims(token).get("sub")
            if sub:
                return f"user:{sub}"
        except Exception:
            pass  # token malformado -> cai para IP; a auth vai rejeitar depois
    return f"ip:{_client_ip(request)}"


def _sweep_stale(now: float) -> None:
    """Remove buckets sem hit dentro da janela (memória não cresce sem fim)."""
    stale = [k for k, dq in _buckets.items() if not dq or now - dq[-1] > WINDOW_SECONDS]
    for k in stale:
        del _buckets[k]


def check_rate_limit(key: str, rule: str, limit: int) -> Optional[float]:
    """Registra um hit. Retorna None se permitido, ou segundos de retry se excedeu."""
    global _checks_since_sweep
    now = _now()
    with _lock:
        _checks_since_sweep += 1
        if _checks_since_sweep >= _SWEEP_EVERY:
            _checks_since_sweep = 0
            _sweep_stale(now)

        dq = _buckets.get((key, rule))
        if dq is None:
            dq = deque(maxlen=limit)
            _buckets[(key, rule)] = dq

        while dq and now - dq[0] > WINDOW_SECONDS:
            dq.popleft()

        if len(dq) >= limit:
            return max(1.0, WINDOW_SECONDS - (now - dq[0]))

        dq.append(now)
        return None


async def rate_limit_middleware(request: Request, call_next):
    # Preflight CORS e health checks não contam.
    if not RATE_LIMIT_ENABLED or request.method == "OPTIONS" or request.url.path in _EXEMPT_PATHS:
        return await call_next(request)

    rule, limit = _match_rule(request.method, request.url.path)
    key = _bucket_key(request)
    retry_after = check_rate_limit(key, rule, limit)

    if retry_after is not None:
        logger.warning(
            "[RATE_LIMIT] 429 key=%s rule=%s limit=%d/min path=%s %s",
            key, rule, limit, request.method, request.url.path,
        )
        return JSONResponse(
            status_code=429,
            content={"detail": "Muitas requisições. Tente novamente em instantes."},
            headers={
                "Retry-After": str(int(retry_after) + 1),
                "X-RateLimit-Limit": str(limit),
                "X-RateLimit-Remaining": "0",
            },
        )

    return await call_next(request)
