from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from typing import Any, Dict

from app.core.auth import get_current_user
from app.services import onboarding_service
from app.schemas import InitialSettingsRequest

router = APIRouter(prefix="/onboarding", tags=["onboarding"])


@router.get("/status")
def get_status(user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
  """
  Retorna o status de onboarding do usuário autenticado.
  """
  try:
    return onboarding_service.get_onboarding_status(
      user_jwt=user["token"],
      user_id=user["user_id"],
    )
  except Exception as e:
    # Não vazar detalhes internos
    raise HTTPException(status_code=500, detail="Erro ao buscar status de onboarding") from e


@router.post("/initial-settings")
def save_initial_settings(
  settings: InitialSettingsRequest,
  user: Dict[str, Any] = Depends(get_current_user)
) -> Dict[str, Any]:
  """
  Salva as configurações iniciais do usuário (idioma, moeda, nicho).
  Este é o primeiro passo do onboarding.
  """
  try:
    return onboarding_service.save_initial_settings(
      user_jwt=user["token"],
      user_id=user["user_id"],
      language=settings.language,
      currency=settings.currency,
      niche=settings.niche or "",
    )
  except Exception as e:
    raise HTTPException(status_code=500, detail="Erro ao salvar configurações iniciais") from e


@router.post("/complete")
def mark_complete(user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
  """
  Marca o onboarding como concluído para o usuário autenticado.
  """
  try:
    return onboarding_service.complete_onboarding(
      user_jwt=user["token"],
      user_id=user["user_id"],
    )
  except Exception as e:
    raise HTTPException(status_code=500, detail="Erro ao completar onboarding") from e



