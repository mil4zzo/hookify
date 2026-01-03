"use client";

import { usePathname } from "next/navigation";
import { useSidebar } from "./SidebarContext";
import { useClientAuth } from "@/lib/hooks/useClientSession";
import { useOnboardingStatus } from "@/lib/hooks/useOnboardingStatus";
import { cn } from "@/lib/utils/cn";

export default function LayoutContent({ children }: { children: React.ReactNode }) {
  const { isCollapsed } = useSidebar();
  const pathname = usePathname();
  const { isAuthenticated } = useClientAuth();
  const { data: onboardingData, isLoading: isLoadingOnboarding } = useOnboardingStatus(isAuthenticated);
  
  // Não adicionar margem em rotas de autenticação
  const isAuthRoute = pathname?.startsWith('/login') || pathname?.startsWith('/signup') || pathname?.startsWith('/callback');
  
  // Não adicionar margem durante o onboarding
  const isOnboardingRoute = pathname?.startsWith('/onboarding');
  
  // Aplicar margem otimisticamente quando autenticado (evita flick)
  // Se ainda está carregando, assumimos que deve mostrar sidebar para manter espaço
  const hasCompletedOnboarding = onboardingData?.has_completed_onboarding ?? (isLoadingOnboarding ? true : false);
  const shouldShowSidebar = !isAuthRoute && !isOnboardingRoute && isAuthenticated && (isLoadingOnboarding || hasCompletedOnboarding);

  return (
    <div
      className={cn(
        "flex flex-col transition-all duration-300",
        isAuthRoute ? "h-screen" : "min-h-screen",
        shouldShowSidebar && (isCollapsed ? "md:ml-16" : "md:ml-64")
      )}
    >
      {children}
    </div>
  );
}

