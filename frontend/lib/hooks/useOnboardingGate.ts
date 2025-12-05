"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useRequireAuth } from "@/lib/hooks/useRequireAuth";
import { useOnboardingStatus } from "@/lib/hooks/useOnboardingStatus";

export type OnboardingGateTarget = "app" | "onboarding";

export type OnboardingStatus =
  | "checking"
  | "requires_onboarding"
  | "completed";

export function useOnboardingGate(target: OnboardingGateTarget) {
  const { status: authStatus, isClient, isAuthenticated } = useRequireAuth("/login");
  const router = useRouter();

  const {
    data,
    isLoading: isLoadingOnboarding,
    error,
  } = useOnboardingStatus(authStatus === "authorized");

  const hasCompleted = !!data?.has_completed_onboarding;

  useEffect(() => {
    if (!isClient) return;
    if (authStatus !== "authorized") return;
    if (isLoadingOnboarding) return;

    if (target === "app" && !hasCompleted) {
      router.replace("/onboarding");
    }

    // Removido: redirect automático quando onboarding já foi completado
    // Usuários podem acessar /onboarding mesmo após completar
  }, [isClient, authStatus, isLoadingOnboarding, hasCompleted, target, router]);

  let onboardingStatus: OnboardingStatus = "checking";

  if (authStatus === "authorized" && !isLoadingOnboarding) {
    onboardingStatus = hasCompleted ? "completed" : "requires_onboarding";
  }

  return {
    authStatus,
    isClient,
    isAuthenticated,
    onboardingStatus,
    data,
    isLoading: isLoadingOnboarding,
    error,
  } as const;
}



