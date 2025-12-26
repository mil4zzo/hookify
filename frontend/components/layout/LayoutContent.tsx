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
  const { data: onboardingData } = useOnboardingStatus(isAuthenticated);
  
  // Não adicionar margem em rotas de autenticação
  const isAuthRoute = pathname?.startsWith('/login') || pathname?.startsWith('/signup') || pathname?.startsWith('/callback');
  
  // Não adicionar margem durante o onboarding
  const isOnboardingRoute = pathname?.startsWith('/onboarding');
  const hasCompletedOnboarding = onboardingData?.has_completed_onboarding ?? false;
  const shouldShowSidebar = !isAuthRoute && !isOnboardingRoute && hasCompletedOnboarding;

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

