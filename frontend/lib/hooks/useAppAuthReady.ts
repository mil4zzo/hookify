"use client";

import { useOnboardingGate } from "@/lib/hooks/useOnboardingGate";

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
  const isAppReady = isAuthorized && gate.onboardingStatus === "completed";

  return {
    ...gate,
    isAuthorized,
    isAppReady,
  } as const;
}


