"use client";

import { useOnboardingGate } from "@/lib/hooks/useOnboardingGate";
import { getCachedOnboardingStatus } from "@/lib/hooks/useOnboardingStatus";

/**
 * Hook de conveniência que centraliza o estado de autenticação/onboarding
 * para páginas da aplicação principal ("app").
 *
 * - `isAuthorized`: cliente + authStatus === "authorized"
 * - `isAppReady`: authorized + onboardingStatus === "completed"
 *
 * Mantém compatibilidade com o retorno original de `useOnboardingGate`.
 */
export function useAppAuthReady() {
  const gate = useOnboardingGate("app");

  const isAuthorized = gate.isClient && gate.authStatus === "authorized";

  // Em caso de erro, usar cache local como fallback.
  // Se não houver cache, permitir acesso para não travar novos usuários.
  let isAppReady = isAuthorized && gate.onboardingStatus === "completed";
  if (isAuthorized && gate.onboardingStatus === "error") {
    const cached = getCachedOnboardingStatus();
    isAppReady = cached ? cached.has_completed_onboarding : true;
  }

  return {
    ...gate,
    isAuthorized,
    isAppReady,
  } as const;
}


