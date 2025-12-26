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
                      pathname?.startsWith("/signup") || 
                      pathname?.startsWith("/callback");
  const isOnboardingRoute = pathname?.startsWith("/onboarding");
  
  // Se for rota de autenticação, renderiza apenas o conteúdo
  if (isAuthRoute) {
    return <>{children}</>;
  }
  
  // Se for rota de onboarding, renderiza com Topbar mas sem Sidebar
  if (isOnboardingRoute) {
    return (
      <PacksLoader>
        <LayoutContent>
          <Topbar />
          <main className="flex-1 container mx-auto px-4 md:px-6 lg:px-8 py-8 pb-20 md:pb-8">{children}</main>
        </LayoutContent>
        <BottomNavigationBar />
      </PacksLoader>
    );
  }
  
  // Para rotas normais, renderiza o layout completo
  return (
    <PacksLoader>
      <Sidebar />
      <LayoutContent>
        <Topbar />
        <MainContent>{children}</MainContent>
      </LayoutContent>
      <BottomNavigationBar />
    </PacksLoader>
  );
}

