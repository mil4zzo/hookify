from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from typing import Any, Dict

from app.core.auth import get_current_user
from app.services import onboarding_service

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



