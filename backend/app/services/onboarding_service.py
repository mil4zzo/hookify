from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from app.core.supabase_client import get_supabase_for_user

logger = logging.getLogger(__name__)


def _safe_first(data: Optional[list]) -> Optional[Dict[str, Any]]:
  if not data:
    return None
  return data[0]


def get_onboarding_status(user_jwt: str, user_id: str) -> Dict[str, Any]:
  """
  Calcula o status de onboarding do usuário com base em:
  - Flag has_completed_onboarding em user_preferences
  - Existência de conexão ativa do Facebook
  - Existência de critérios de validação configurados

  A flag has_completed_onboarding é a fonte da verdade para o fluxo de UI.
  Os outros campos são expostos apenas para fins de UX (exibir progresso).
  """
  sb = get_supabase_for_user(user_jwt)

  # 1) Buscar preferências do usuário (inclui flag de onboarding e critérios)
  prefs = None
  try:
    res = (
      sb.table("user_preferences")
      .select("has_completed_onboarding, validation_criteria")
      .eq("user_id", user_id)
      .limit(1)
      .execute()
    )
    prefs = _safe_first(res.data or [])
  except Exception as e:
    logger.warning(f"[ONBOARDING] Erro ao buscar user_preferences para {user_id}: {e}")
    prefs = None

  has_completed = bool(prefs and prefs.get("has_completed_onboarding"))

  # 2) Verificar se há conexão ativa do Facebook
  facebook_connected = False
  try:
    fb_res = (
      sb.table("facebook_connections")
      .select("id")
      .eq("user_id", user_id)
      .eq("status", "active")
      .limit(1)
      .execute()
    )
    facebook_connected = bool(fb_res.data)
  except Exception as e:
    logger.warning(f"[ONBOARDING] Erro ao buscar facebook_connections para {user_id}: {e}")

  # 3) Verificar se há critérios de validação configurados
  validation_criteria_configured = False
  if prefs is not None:
    try:
      criteria = prefs.get("validation_criteria") or []
      # Considera configurado se há pelo menos uma condição
      validation_criteria_configured = isinstance(criteria, list) and len(criteria) > 0
    except Exception:
      validation_criteria_configured = False

  return {
    "has_completed_onboarding": has_completed,
    "facebook_connected": facebook_connected,
    "validation_criteria_configured": validation_criteria_configured,
  }


def save_initial_settings(
  user_jwt: str,
  user_id: str,
  language: str,
  currency: str,
  niche: str,
) -> Dict[str, Any]:
  """
  Salva as configurações iniciais do usuário (idioma, moeda, nicho).
  
  Valida os valores e salva na tabela user_preferences.
  Cria o registro se ainda não existir.
  """
  sb = get_supabase_for_user(user_jwt)

  # Validar idioma
  supported_languages = ["pt-BR", "en-US", "es-ES"]
  if language not in supported_languages:
    raise ValueError(f"Idioma não suportado. Use um dos seguintes: {', '.join(supported_languages)}")

  # Validar moeda (código ISO 4217 básico)
  if not currency or len(currency) != 3:
    raise ValueError("Moeda deve ser um código válido de 3 letras (ex: BRL, USD, EUR)")

  try:
    # Usar upsert para criar/atualizar em uma única operação.
    update_payload = {
      "user_id": user_id,
      "locale": language,
      "currency": currency,
      "niche": niche or "",
    }

    res = (
      sb.table("user_preferences")
      .upsert(update_payload, on_conflict="user_id")
      .execute()
    )

    logger.info(f"[ONBOARDING] Configurações iniciais salvas para user {user_id}: language={language}, currency={currency}, niche={niche}")
  except Exception as e:
    logger.exception(f"[ONBOARDING] Erro ao salvar configurações iniciais para {user_id}: {e}")
    raise

  # Retornar status consolidado após atualização
  return get_onboarding_status(user_jwt, user_id)


def complete_onboarding(user_jwt: str, user_id: str) -> Dict[str, Any]:
  """
  Marca o onboarding como concluído na tabela user_preferences.

  Cria o registro se ainda não existir.
  """
  sb = get_supabase_for_user(user_jwt)

  try:
    # Usar upsert para criar/atualizar em uma única operação.
    update_payload = {
      "user_id": user_id,
      "has_completed_onboarding": True,
    }

    res = (
      sb.table("user_preferences")
      .upsert(update_payload, on_conflict="user_id")
      .execute()
    )

    logger.info(f"[ONBOARDING] has_completed_onboarding=true salvo para user {user_id}")
  except Exception as e:
    logger.exception(f"[ONBOARDING] Erro ao completar onboarding para {user_id}: {e}")
    # Não levantar exceção dura aqui; quem chama pode decidir o que fazer.
    raise

  # Retornar status consolidado após atualização
  return get_onboarding_status(user_jwt, user_id)



