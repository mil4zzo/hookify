"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useClientAuth } from "@/lib/hooks/useClientSession";
import { useOnboardingStatus } from "@/lib/hooks/useOnboardingStatus";
import { IconChevronLeft, IconChevronRight, IconSearch } from "@tabler/icons-react";
import { cn } from "@/lib/utils/cn";
import { env } from "@/lib/config/env";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSidebar } from "./SidebarContext";
import { getMenuItems, getDevelopmentItems } from "@/lib/config/pageConfig";

const SIDEBAR_ANIMATION_DURATION = 300; // ms

export default function Sidebar() {
  const pathname = usePathname();
  const { isAuthenticated, isClient } = useClientAuth();
  const { isCollapsed, toggleCollapse } = useSidebar();
  const [showLabels, setShowLabels] = useState(!isCollapsed);
  const { data: onboardingData } = useOnboardingStatus(isAuthenticated);

  // Controla a exibição dos labels baseado no estado de colapso e na animação
  useEffect(() => {
    if (isCollapsed) {
      // Quando colapsa, esconde os labels imediatamente
      setShowLabels(false);
    } else {
      // Quando expande, aguarda o fim da animação antes de mostrar os labels
      const timer = setTimeout(() => {
        setShowLabels(true);
      }, SIDEBAR_ANIMATION_DURATION);

      return () => clearTimeout(timer);
    }
  }, [isCollapsed]);

  // Não mostrar em rotas de autenticação
  const isAuthRoute = pathname?.startsWith("/login") || pathname?.startsWith("/signup") || pathname?.startsWith("/callback");
  
  // Não mostrar durante o onboarding (rota /onboarding ou onboarding não completo)
  const isOnboardingRoute = pathname?.startsWith("/onboarding");
  const hasCompletedOnboarding = onboardingData?.has_completed_onboarding ?? false;

  if (!isClient || !isAuthenticated || isAuthRoute || isOnboardingRoute || !hasCompletedOnboarding) {
    return null;
  }

  return (
    <aside className={cn("hidden md:flex fixed left-0 top-0 h-screen bg-sidebar text-sidebar-foreground border-r border-border backdrop-blur supports-[backdrop-filter]:bg-background/60 z-40 flex-col transition-all duration-300 overflow-hidden", isCollapsed ? "w-16 ease-in" : "w-64 ease-out")}>
      {/* Logo and Collapse Button */}
      <div className={cn("pl-6 pr-3 py-4 flex items-center justify-between border-b border-border transition-all duration-300", isCollapsed ? "px-3 ease-in" : "ease-out")}>
        <Link href="/" className={cn("flex items-center hover:opacity-80 transition-all duration-300", isCollapsed ? "opacity-0 w-0 pointer-events-none ease-in" : "opacity-100 w-auto ease-out")}>
          <Image src="/logo-hookify-alpha.png" alt="Hookify" width={80} height={21} className="h-[21px] w-[80px]" priority />
        </Link>
        <Button variant="ghost" size="sm" onClick={toggleCollapse} className={cn("h-8 w-8 p-0 hover:bg-border transition-all duration-300", isCollapsed && "mx-auto")}>
          {isCollapsed ? <IconChevronRight className="h-4 w-4" /> : <IconChevronLeft className="h-4 w-4" />}
        </Button>
      </div>

      {/* Spacing */}
      <div className="h-6" />

      {/* Search Bar */}
      <div className={cn("px-4 transition-all duration-300", isCollapsed ? "px-2 ease-in" : "ease-out")}>
        <div className="relative w-full">
          {/* Search Input - visível quando expandido */}
          <div className={cn("transition-all duration-300", isCollapsed ? "opacity-0 absolute w-0 pointer-events-none overflow-hidden invisible ease-in" : "opacity-100 relative w-full visible ease-out")} style={isCollapsed ? undefined : { transitionDelay: "50ms" }}>
            <IconSearch className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input type="search" placeholder="Search" className="pl-9 h-9 bg-input-30 border-border text-text placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-info" />
          </div>
          {/* Search Button - visível quando colapsado */}
          <Button variant="ghost" size="sm" className={cn("justify-center h-9 hover:bg-input-30 transition-opacity duration-300", isCollapsed ? "opacity-100 relative pointer-events-auto visible w-full ease-in" : "opacity-0 absolute w-0 pointer-events-none overflow-hidden invisible ease-out")} style={isCollapsed ? undefined : { width: 0, transitionDuration: "0ms" }} title="Search">
            <IconSearch className="h-5 w-5 text-muted-foreground" />
          </Button>
        </div>
      </div>

      {/* Spacing */}
      <div className="h-6" />

      {/* Menu Label */}
      <div className={cn("px-6 mb-2 transition-all duration-300 overflow-hidden", showLabels ? "opacity-100 max-h-10 ease-out" : "opacity-0 max-h-0 mb-0 ease-in")}>
        <h2 className="text-sm font-medium text-sidebar-foreground/70">Menu</h2>
      </div>

      {/* Menu Items */}
      <nav className={cn("px-3 transition-all duration-300", isCollapsed ? "px-2 ease-in" : "ease-out")}>
        <ul className="space-y-1">
          {getMenuItems().map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.path;

            return (
              <li key={item.path}>
                <Link href={item.path as any} className={cn("flex items-center rounded-md text-sm font-normal text-text transition-all duration-300", isCollapsed ? "justify-center px-2 py-2 ease-in" : "gap-3 px-3 py-2 ease-out", isActive ? "bg-border text-text" : "text-text hover:bg-input-30 hover:text-text")} title={isCollapsed ? item.label : undefined}>
                  <Icon className={cn("h-5 w-5 flex-shrink-0 transition-colors duration-300", isActive ? "text-primary" : "text-muted-foreground")} />
                  <span className={cn("transition-all duration-300 whitespace-nowrap", showLabels ? "opacity-100 max-w-full ease-out" : "opacity-0 max-w-0 overflow-hidden ease-in")}>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Development Section */}
      {env.IS_DEV && (
        <>
          {/* Spacing */}
          <div className="h-8" />

          {/* Development Label */}
          <div className={cn("px-6 mb-2 transition-all duration-300 overflow-hidden", showLabels ? "opacity-100 max-h-10 ease-out" : "opacity-0 max-h-0 mb-0 ease-in")}>
            <h2 className="text-sm font-medium text-muted-foreground">Development</h2>
          </div>

          {/* Development Items */}
          <nav className={cn("px-3 transition-all duration-300", isCollapsed ? "px-2 ease-in" : "ease-out")}>
            <ul className="space-y-1">
              {getDevelopmentItems().map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.path;

                return (
                  <li key={item.path}>
                    <Link href={item.path as any} className={cn("flex items-center rounded text-sm font-normal text-text transition-all duration-300", isCollapsed ? "justify-center px-2 py-2 ease-in" : "gap-3 px-3 py-2 ease-out", isActive ? "bg-border text-text" : "text-text hover:bg-border hover:text-text")} title={isCollapsed ? item.label : undefined}>
                      <Icon className={cn("h-5 w-5 flex-shrink-0 text-text transition-colors duration-300")} />
                      <span className={cn("transition-all duration-300 whitespace-nowrap", showLabels ? "opacity-100 max-w-full ease-out" : "opacity-0 max-w-0 overflow-hidden ease-in")}>{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </>
      )}
    </aside>
  );
}
