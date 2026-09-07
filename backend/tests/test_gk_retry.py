# -*- coding: utf-8 -*-
"""Retry do relatorio assincrono no Gate Keeper `(#3) AdAccount must pass GK`.

Trava tres coisas medidas em 2026-09-06:
- GK com `business_management` concedido e INSTABILIDADE (re-tentar); sem o
  scope e permissao faltando (nao re-tentar, mandar reautorizar);
- o plano e uma maquina de estados no payload: agenda o respiro (15 s, depois
  60 s), espera enquanto nao chega a hora, re-tenta, e desiste na 3a;
- teste sabotado: com max_attempts=1 o plano desiste de cara — se um dia o
  retry for "desligado" por engano, este arquivo acusa.
"""
from datetime import datetime, timedelta, timezone

from app.services.gk_retry import (
    BACKOFF_SECONDS,
    MAX_ATTEMPTS,
    exhausted_message,
    is_gk_error,
    is_transient_gk,
    plan_retry,
    waiting_message,
)

GK = {"code": 3, "type": "OAuthException",
      "message": "(#3) AdAccount must pass GK: plr_beta_gk_existing_feature"}
AGORA = datetime(2026, 9, 6, 17, 0, 0, tzinfo=timezone.utc)


# ---------------------------------------------------------------- classificacao
def test_gk_e_reconhecido_pelo_meta_error_ou_pela_mensagem():
    assert is_gk_error(GK)
    assert is_gk_error(None, "Meta async report falhou (job=1, 46%): (#3) AdAccount must pass GK: x")
    assert not is_gk_error({"code": 100, "message": "(#100) Invalid parameter"})
    assert not is_gk_error(None, "")


def test_gk_com_scope_concedido_e_transitorio():
    assert is_transient_gk(GK, ["ads_read", "business_management"])


def test_gk_sem_business_management_e_scope_faltando_nao_retry():
    # Causa A (caso real EI.29 - Captacao CA5, julho/2026): toda tentativa falha.
    assert not is_transient_gk(GK, ["ads_read", "ads_management"])


def test_gk_sem_lista_de_scopes_assume_transitorio():
    # Conexao antiga com `scopes` nulo: um retry inutil custa 20 s; mandar o
    # usuario reautorizar a toa custa o tempo dele.
    assert is_transient_gk(GK, None)


def test_erro_que_nao_e_gk_nunca_e_transitorio():
    assert not is_transient_gk({"code": 190, "message": "token expired"}, ["business_management"])


# ------------------------------------------------------------ maquina de estados
def test_primeira_falha_agenda_o_respiro_de_15s():
    plan = plan_retry({}, AGORA)
    assert plan.action == "wait"
    assert plan.attempt == 1
    assert plan.wait_seconds == BACKOFF_SECONDS[0]
    assert plan.not_before == AGORA + timedelta(seconds=BACKOFF_SECONDS[0])
    assert waiting_message(plan) == f"Instabilidade na Meta. Tentativa 2 de {MAX_ATTEMPTS} em 15 s…"


def test_enquanto_nao_chega_a_hora_continua_esperando():
    not_before = AGORA + timedelta(seconds=15)
    payload = {"gk_attempts": 1, "gk_retry_not_before": not_before.isoformat()}
    plan = plan_retry(payload, AGORA + timedelta(seconds=5))
    assert plan.action == "wait"
    assert plan.not_before == not_before
    assert plan.wait_seconds == 11  # 10 s restantes + 1 de arredondamento


def test_chegou_a_hora_re_tenta():
    not_before = AGORA + timedelta(seconds=15)
    payload = {"gk_attempts": 1, "gk_retry_not_before": not_before.isoformat()}
    plan = plan_retry(payload, not_before)
    assert plan.action == "retry_now"
    assert plan.next_attempt == 2


def test_segunda_falha_espera_60s():
    plan = plan_retry({"gk_attempts": 2}, AGORA)
    assert plan.action == "wait"
    assert plan.wait_seconds == BACKOFF_SECONDS[1]
    assert waiting_message(plan) == f"Instabilidade na Meta. Tentativa 3 de {MAX_ATTEMPTS} em 60 s…"


def test_na_ultima_tentativa_desiste():
    plan = plan_retry({"gk_attempts": MAX_ATTEMPTS}, AGORA)
    assert plan.action == "give_up"
    assert exhausted_message() == "Instabilidade na Meta. Tente de novo em alguns minutos."


def test_carimbo_sem_timezone_e_lido_como_utc():
    # O payload e JSON; um isoformat sem offset nao pode virar hora local do servidor.
    payload = {"gk_attempts": 1, "gk_retry_not_before": "2026-09-06T17:00:15"}
    assert plan_retry(payload, AGORA + timedelta(seconds=14)).action == "wait"
    assert plan_retry(payload, AGORA + timedelta(seconds=15)).action == "retry_now"


def test_carimbo_ilegivel_nao_trava_o_job():
    payload = {"gk_attempts": 1, "gk_retry_not_before": "quando der"}
    assert plan_retry(payload, AGORA).action == "retry_now"


# --------------------------------------------------------------------- sabotagem
def test_sabotado_com_uma_unica_tentativa_desiste_na_primeira_falha():
    # Prova que o teste acima esta vendo o retry de verdade: sem tentativas
    # extras, a mesma entrada que agenda respiro passa a desistir.
    assert plan_retry({}, AGORA, max_attempts=1).action == "give_up"
    assert plan_retry({}, AGORA, max_attempts=MAX_ATTEMPTS).action == "wait"
