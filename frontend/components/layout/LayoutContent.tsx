"use client";

import { usePathname } from "next/navigation";
import { useSidebar } from "./SidebarContext";
import { cn } from "@/lib/utils/cn";

export default function LayoutContent({ children }: { children: React.ReactNode }) {
  const { isCollapsed } = useSidebar();
  const pathname = usePathname();

  const isOnboardingRoute = pathname?.startsWith("/onboarding");

  return (
    <div
      className={cn(
        "flex flex-col transition-all duration-300",
        "h-screen overflow-hidden",
        !isOnboardingRoute && (isCollapsed ? "md:ml-16" : "md:ml-64")
      )}
    >
      {children}
    </div>
  );
}
