"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useUserTier } from "@/lib/hooks/useUserTier";
import { IconBook2, IconChevronLeft, IconChevronRight, IconFileText, IconShieldLock, IconTrash } from "@tabler/icons-react";
import { cn } from "@/lib/utils/cn";
import { env } from "@/lib/config/env";
import { Button } from "@/components/ui/button";
import { useSidebar } from "./SidebarContext";
import { getMenuItems, getDevelopmentItems } from "@/lib/config/pageConfig";
import { GlobalSearch } from "@/components/common/GlobalSearch";

const SIDEBAR_ANIMATION_DURATION = 300; // ms

export default function Sidebar() {
  const pathname = usePathname();
  const { isCollapsed, toggleCollapse } = useSidebar();
  const [showLabels, setShowLabels] = useState(!isCollapsed);
  const { data: userTier = "standard" } = useUserTier();

  useEffect(() => {
    if (isCollapsed) {
      setShowLabels(false);
    } else {
      const timer = setTimeout(() => {
        setShowLabels(true);
      }, SIDEBAR_ANIMATION_DURATION);
      return () => clearTimeout(timer);
    }
  }, [isCollapsed]);

  return (
    <aside className={cn("hidden md:flex fixed left-0 top-0 h-screen bg-sidebar text-sidebar-foreground border-r border-border backdrop-blur supports-[backdrop-filter]:bg-background-60 z-sticky flex-col transition-all duration-300 overflow-hidden", isCollapsed ? "w-16 ease-in" : "w-64 ease-out")}>
      {/* Logo and Collapse Button */}
      <div className={cn("pl-6 pr-3 py-4 flex items-center justify-between border-b border-border transition-all duration-300", isCollapsed ? "px-3 ease-in" : "ease-out")}>
        <Link href="/" className={cn("flex items-center hover:opacity-80 transition-all duration-300", isCollapsed ? "opacity-0 w-0 pointer-events-none ease-in" : "opacity-100 w-auto ease-out")}>
          <Image src="/logo-hookify-alpha.png" alt="Hookify" width={80} height={21} className="h-[21px] w-[80px]" priority />
        </Link>
        <Button variant="ghost" size="sm" onClick={toggleCollapse} className={cn("w-8 p-0 hover:bg-border transition-all duration-300", isCollapsed && "mx-auto")}>
          {isCollapsed ? <IconChevronRight className="h-4 w-4" /> : <IconChevronLeft className="h-4 w-4" />}
        </Button>
      </div>

      {/* Spacing */}
      <div className="h-6" />

      {/* Search Bar */}
      <div className={cn("px-4 transition-all duration-300", isCollapsed ? "px-2 ease-in" : "ease-out")}>
        <div className={cn("transition-all duration-300", isCollapsed ? "opacity-0 absolute w-0 pointer-events-none overflow-hidden invisible ease-in" : "opacity-100 relative w-full visible ease-out")} style={isCollapsed ? undefined : { transitionDelay: "50ms" }}>
          <GlobalSearch isCollapsed={isCollapsed} />
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
          {getMenuItems(userTier).map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.path;

            return (
              <li key={item.path}>
                <Link href={item.path as any} className={cn("flex items-center rounded-md text-sm font-normal text-text transition-all duration-300", isCollapsed ? "justify-center px-2 py-2 ease-in" : "gap-3 px-3 py-2 ease-out", isActive ? "bg-primary text-text" : "text-text hover:bg-input-30 hover:text-text")} title={isCollapsed ? item.label : undefined}>
                  <Icon className={cn("h-5 w-5 flex-shrink-0 transition-colors duration-300", isActive ? "text-text" : "text-muted-foreground")} />
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
          <div className="h-8" />

          <div className={cn("px-6 mb-2 transition-all duration-300 overflow-hidden", showLabels ? "opacity-100 max-h-10 ease-out" : "opacity-0 max-h-0 mb-0 ease-in")}>
            <h2 className="text-sm font-medium text-muted-foreground">Development</h2>
          </div>

          <nav className={cn("px-3 transition-all duration-300", isCollapsed ? "px-2 ease-in" : "ease-out")}>
            <ul className="space-y-1">
              {getDevelopmentItems().map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.path;

                return (
                  <li key={item.path}>
                    <Link href={item.path as any} className={cn("flex items-center rounded text-sm font-normal text-text transition-all duration-300", isCollapsed ? "justify-center px-2 py-2 ease-in" : "gap-3 px-3 py-2 ease-out", isActive ? "bg-primary text-text" : "text-text hover:bg-border hover:text-text")} title={isCollapsed ? item.label : undefined}>
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

      {/* Footer Links */}
      <div className="mt-auto border-t border-border">
        <div className={cn("px-3 py-4 space-y-1 transition-all duration-300", isCollapsed ? "px-2 ease-in" : "ease-out")}>
          <Link href="/docs" className={cn("flex items-center rounded-md text-xs font-normal text-text transition-all duration-300", isCollapsed ? "justify-center px-2 py-2 ease-in" : "gap-2 px-3 py-2 ease-out", pathname === "/docs" ? "bg-primary text-text" : "text-text hover:bg-input-30 hover:text-text")} title={isCollapsed ? "Docs" : undefined}>
            <IconBook2 className={cn("h-4 w-4 flex-shrink-0 transition-colors duration-300", pathname === "/docs" ? "text-text" : "text-muted-foreground")} />
            <span className={cn("transition-all duration-300 whitespace-nowrap", showLabels ? "opacity-100 max-w-full ease-out" : "opacity-0 max-w-0 overflow-hidden ease-in")}>Docs</span>
          </Link>
          <Link href="/termos-de-uso" className={cn("flex items-center rounded-md text-xs font-normal text-text transition-all duration-300", isCollapsed ? "justify-center px-2 py-2 ease-in" : "gap-2 px-3 py-2 ease-out", pathname === "/termos-de-uso" ? "bg-primary text-text" : "text-text hover:bg-input-30 hover:text-text")} title={isCollapsed ? "Termos de Uso" : undefined}>
            <IconFileText className={cn("h-4 w-4 flex-shrink-0 transition-colors duration-300", pathname === "/termos-de-uso" ? "text-text" : "text-muted-foreground")} />
            <span className={cn("transition-all duration-300 whitespace-nowrap", showLabels ? "opacity-100 max-w-full ease-out" : "opacity-0 max-w-0 overflow-hidden ease-in")}>Termos de Uso</span>
          </Link>
          <Link href="/politica-de-privacidade" className={cn("flex items-center rounded-md text-xs font-normal text-text transition-all duration-300", isCollapsed ? "justify-center px-2 py-2 ease-in" : "gap-2 px-3 py-2 ease-out", pathname === "/politica-de-privacidade" ? "bg-primary text-text" : "text-text hover:bg-input-30 hover:text-text")} title={isCollapsed ? "Política de Privacidade" : undefined}>
            <IconShieldLock className={cn("h-4 w-4 flex-shrink-0 transition-colors duration-300", pathname === "/politica-de-privacidade" ? "text-text" : "text-muted-foreground")} />
            <span className={cn("transition-all duration-300 whitespace-nowrap", showLabels ? "opacity-100 max-w-full ease-out" : "opacity-0 max-w-0 overflow-hidden ease-in")}>Política de Privacidade</span>
          </Link>
          <Link href="/exclusao-de-dados" className={cn("flex items-center rounded-md text-xs font-normal text-text transition-all duration-300", isCollapsed ? "justify-center px-2 py-2 ease-in" : "gap-2 px-3 py-2 ease-out", pathname === "/exclusao-de-dados" ? "bg-primary text-text" : "text-text hover:bg-input-30 hover:text-text")} title={isCollapsed ? "Exclusão de Dados" : undefined}>
            <IconTrash className={cn("h-4 w-4 flex-shrink-0 transition-colors duration-300", pathname === "/exclusao-de-dados" ? "text-text" : "text-muted-foreground")} />
            <span className={cn("transition-all duration-300 whitespace-nowrap", showLabels ? "opacity-100 max-w-full ease-out" : "opacity-0 max-w-0 overflow-hidden ease-in")}>Exclusão de Dados</span>
          </Link>
        </div>
      </div>
    </aside>
  );
}
