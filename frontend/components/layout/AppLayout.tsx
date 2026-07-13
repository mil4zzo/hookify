"use client";

import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";
import LayoutContent from "./LayoutContent";
import Topbar from "./Topbar";
import { MainContent } from "./MainContent";
import BottomNavigationBar from "./BottomNavigationBar";
import { PacksLoader } from "./PacksLoader";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  
  // Rotas que não devem ter layout completo (sidebar, topbar, etc.)
  const isAuthRoute = pathname?.startsWith("/login") ||
                      pathname?.startsWith("/callback");
  const isPublicRoute = pathname?.startsWith("/politica-de-privacidade") ||
                       pathname?.startsWith("/termos-de-uso") ||
                       pathname?.startsWith("/exclusao-de-dados") ||
                       pathname?.startsWith("/pv") ||
                       pathname?.startsWith("/waitlist") ||
                       pathname?.startsWith("/suporte");
  
  // Onboarding: experiência focada — sem sidebar nem bottom-nav (o Topbar entra
  // em modo mínimo internamente). LayoutContent já remove a margem lateral.
  const isOnboardingRoute = pathname?.startsWith("/onboarding");

  // Se for rota de autenticação ou pública, renderiza apenas o conteúdo
  if (isAuthRoute || isPublicRoute) {
    return <>{children}</>;
  }

  // Para todas as rotas autenticadas, renderiza o layout completo
  return (
    <PacksLoader>
      {!isOnboardingRoute && <Sidebar />}
      <LayoutContent>
        <Topbar />
        <MainContent>{children}</MainContent>
      </LayoutContent>
      {!isOnboardingRoute && <BottomNavigationBar />}
    </PacksLoader>
  );
}
