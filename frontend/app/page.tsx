"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useClientAuth } from "@/lib/hooks/useClientSession";
import { useOnboardingStatus } from "@/lib/hooks/useOnboardingStatus";
import { LoadingState } from "@/components/common/States";

export default function HomePage() {
  const { isAuthenticated, isClient, isLoading } = useClientAuth();
  const { data, isLoading: isLoadingOnboarding } = useOnboardingStatus(isAuthenticated);
  const router = useRouter();

  useEffect(() => {
    if (!isClient || isLoading) return;

    // Se não está autenticado, redirecionar para login
    if (!isAuthenticated) {
      router.push("/login");
      return;
    }

    // Autenticado: decidir entre onboarding e app principal
    if (isLoadingOnboarding) return;

    if (data?.has_completed_onboarding) {
      router.replace("/packs");
    } else {
      router.replace("/onboarding");
    }
  }, [isClient, isAuthenticated, isLoading, isLoadingOnboarding, data?.has_completed_onboarding, router]);

  // Mostrar loading enquanto verifica autenticação/onboarding
  return (
    <div>
      <LoadingState label="Redirecionando..." />
    </div>
  );
}
