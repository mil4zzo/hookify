"""
Retry do relatório assíncrono da Meta quando ele morre com o Gate Keeper
`(#3) AdAccount must pass GK: plr_beta_gk_existing_feature`.

O QUE SE SABE (medido em 2026-09-06, 30+ relatórios no request real)
----------------------------------------------------------------------
* A mesma mensagem tem DUAS causas: scope `business_management` ausente
  (permanente — toda tentativa naquela conta falha) e instabilidade da Meta
  (intermitente — o mesmo request passou 3 de 6 vezes). Distingue-se pelos
  scopes concedidos da conexão, que o banco já tem.
* Não é determinístico: retry funciona. Falhas morrem em 15–45 s, em qualquer
  percentual, e se agrupam no relógio (dois relatórios paralelos caíram juntos
  em 3 de 4 rodadas com falha) — por isso o respiro entre tentativas.
* O job do frontend é identificado pelo `report_run_id` da PRIMEIRA tentativa.
  Re-tentar abre um relatório novo; o id do job não muda, o id do relatório
  atual vive no payload (`meta_report_run_id`).

Este módulo é puro: decide, não executa. O polling (`get_job_progress`) lê a
decisão e faz a chamada à Meta. Sem thread dormindo — o "esperar" é um carimbo
no payload que o próximo poll do frontend (a cada 2 s) respeita.
"""
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, Optional

GK_MARKER = "must pass GK"

# Tentativas TOTAIS (a primeira inclusa). 3 = a original + 2 retries.
MAX_ATTEMPTS = 3

# Espera antes da 2ª e da 3ª tentativa. As falhas se agrupam no tempo; um
# respiro curto evita bater no mesmo mau momento.
BACKOFF_SECONDS = (15, 60)

# Scope cuja ausência produz o MESMO GK de forma permanente (causa A).
SCOPE_REQUIRED = "business_management"


def is_gk_error(meta_error: Optional[Dict[str, Any]], error_message: str = "") -> bool:
    """A falha é o Gate Keeper (independente da causa)?"""
    msg = ""
    if isinstance(meta_error, dict):
        msg = str(meta_error.get("message") or "")
    return GK_MARKER in msg or GK_MARKER in (error_message or "")


def is_transient_gk(meta_error: Optional[Dict[str, Any]], granted_scopes: Optional[Iterable[str]], error_message: str = "") -> bool:
    """GK com o scope concedido = instabilidade da Meta (vale re-tentar).

    Sem a lista de scopes (conexão antiga, coluna nula) assume-se transitório:
    o custo de um retry inútil é 20 s; o custo de mandar o usuário reautorizar
    à toa é o tempo dele.
    """
    if not is_gk_error(meta_error, error_message):
        return False
    if granted_scopes is None:
        return True
    return SCOPE_REQUIRED in set(granted_scopes)


@dataclass(frozen=True)
class RetryPlan:
    # "retry_now" abre relatório novo já; "wait" espera até `not_before`;
    # "give_up" fecha o job em failed.
    action: str
    attempt: int              # tentativa atual (1 = a original)
    not_before: Optional[datetime] = None
    wait_seconds: int = 0

    @property
    def next_attempt(self) -> int:
        return self.attempt + 1


def plan_retry(payload: Optional[Dict[str, Any]], now: datetime, max_attempts: int = MAX_ATTEMPTS) -> RetryPlan:
    """Decide o que fazer com um GK transitório dado o estado no payload.

    Estado lido/gravado no payload:
      gk_attempts        tentativas já feitas (default 1: a original)
      gk_retry_not_before ISO-8601 UTC; quando presente e no futuro, esperar
    """
    payload = payload or {}
    attempt = int(payload.get("gk_attempts") or 1)

    if attempt >= max_attempts:
        return RetryPlan(action="give_up", attempt=attempt)

    not_before_raw = payload.get("gk_retry_not_before")
    if not_before_raw:
        not_before = _parse_iso(not_before_raw)
        if not_before and now < not_before:
            return RetryPlan(action="wait", attempt=attempt, not_before=not_before,
                             wait_seconds=int((not_before - now).total_seconds()) + 1)
        return RetryPlan(action="retry_now", attempt=attempt)

    # Primeira vez que este GK aparece nesta tentativa: agenda o respiro.
    wait = BACKOFF_SECONDS[min(attempt - 1, len(BACKOFF_SECONDS) - 1)]
    return RetryPlan(action="wait", attempt=attempt,
                     not_before=now + timedelta(seconds=wait), wait_seconds=wait)


def waiting_message(plan: RetryPlan, max_attempts: int = MAX_ATTEMPTS) -> str:
    """Texto do toast enquanto espera: 'Instabilidade na Meta. Tentativa 2 de 3 em 15 s…'."""
    return f"Instabilidade na Meta. Tentativa {plan.next_attempt} de {max_attempts} em {plan.wait_seconds} s…"


def exhausted_message() -> str:
    return "Instabilidade na Meta. Tente de novo em alguns minutos."


def _parse_iso(value: Any) -> Optional[datetime]:
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except (TypeError, ValueError):
        return None
