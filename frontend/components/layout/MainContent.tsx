"use client";

import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/cn";
import { APP_PAGE_SHELL_BOTTOM_SCROLL, APP_PAGE_SHELL_X, APP_PAGE_SHELL_Y } from "@/lib/constants/pageLayout";

export function MainContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  
  // Não adicionar padding em rotas de autenticação
  const isAuthRoute = pathname?.startsWith("/login") || pathname?.startsWith("/signup") || pathname?.startsWith("/callback");

  // Manager usa viewport controlado com scroll principal dentro da área de dados
  const isManagerRoute = pathname?.startsWith("/manager");

  return (
    <main
      className={cn(
        "flex-1 container mx-auto flex flex-col min-h-0",
        isAuthRoute && "p-0",
        !isAuthRoute && !isManagerRoute && cn("overflow-y-auto", APP_PAGE_SHELL_X, APP_PAGE_SHELL_Y, APP_PAGE_SHELL_BOTTOM_SCROLL),
        isManagerRoute && cn("overflow-hidden", APP_PAGE_SHELL_X, APP_PAGE_SHELL_Y),
      )}
    >
      {children}
    </main>
  );
}





















