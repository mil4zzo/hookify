"use client";

import { usePathname } from "next/navigation";
import { useClientAuth } from "@/lib/hooks/useClientSession";
import { getMenuItems } from "@/lib/config/pageConfig";
import { NavBar } from "@/components/ui/tubelight-navbar";

export default function BottomNavigationBar() {
  const pathname = usePathname();
  const { isAuthenticated, isClient } = useClientAuth();

  // Não mostrar em rotas de autenticação
  const isAuthRoute = pathname?.startsWith("/login") || pathname?.startsWith("/signup") || pathname?.startsWith("/callback");

  if (!isClient || !isAuthenticated || isAuthRoute) {
    return null;
  }

  const menuItems = getMenuItems();

  // Converter PageConfig[] para NavItem[]
  const navItems = menuItems.map((item) => ({
    name: item.label,
    url: item.path,
    icon: item.icon,
  }));

  // Manter comportamento original: só mostrar no mobile (md:hidden)
  return (
    <div className="md:hidden">
      <NavBar items={navItems} />
    </div>
  );
}
