"use client";

import { usePathname } from "next/navigation";
import { useSidebar } from "./SidebarContext";
import { cn } from "@/lib/utils/cn";

export default function LayoutContent({ children }: { children: React.ReactNode }) {
  const { isCollapsed } = useSidebar();
  const pathname = usePathname();
  
  // Não adicionar margem em rotas de autenticação
  const isAuthRoute = pathname?.startsWith('/login') || pathname?.startsWith('/signup') || pathname?.startsWith('/callback');

  return (
    <div
      className={cn(
        "flex flex-col min-h-screen transition-all duration-300",
        !isAuthRoute && (isCollapsed ? "md:ml-16" : "md:ml-64")
      )}
    >
      {children}
    </div>
  );
}

