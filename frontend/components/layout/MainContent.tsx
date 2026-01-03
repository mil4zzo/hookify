"use client";

import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/cn";

export function MainContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  
  // Não adicionar padding em rotas de autenticação
  const isAuthRoute = pathname?.startsWith("/login") || pathname?.startsWith("/signup") || pathname?.startsWith("/callback");
  
  return (
    <main
      className={cn(
        "flex-1 container mx-auto flex flex-col h-full min-h-0",
        isAuthRoute ? "p-0" : "px-4 md:px-6 lg:px-8 py-8 pb-20 md:pb-8"
      )}
    >
      {children}
    </main>
  );
}





















