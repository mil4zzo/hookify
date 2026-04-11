"use client";

import { ReactNode, createContext, useCallback, useContext, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/cn";
import { APP_PAGE_SHELL_BOTTOM_SCROLL, APP_PAGE_SHELL_X, APP_PAGE_SHELL_Y } from "@/lib/constants/pageLayout";

export type PageSidebarMobileBehavior = "stack" | "hidden" | "drawer";

export type MainContentLayoutConfig = {
  fullWidth: boolean;
  pageSidebar: ReactNode | null;
  pageSidebarClassName?: string;
  pageSidebarMobileBehavior: PageSidebarMobileBehavior;
};

export const DEFAULT_MAIN_CONTENT_LAYOUT_CONFIG: MainContentLayoutConfig = {
  fullWidth: false,
  pageSidebar: null,
  pageSidebarClassName: undefined,
  pageSidebarMobileBehavior: "stack",
};

type MainContentLayoutContextValue = {
  layoutConfig: MainContentLayoutConfig;
  setLayoutConfig: (value: MainContentLayoutConfig) => void;
};

const MainContentLayoutContext = createContext<MainContentLayoutContextValue | null>(null);

export function useMainContentLayout() {
  return useContext(MainContentLayoutContext);
}

export function MainContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [layoutConfig, setLayoutConfig] = useState<MainContentLayoutConfig>(DEFAULT_MAIN_CONTENT_LAYOUT_CONFIG);
  const updateLayoutConfig = useCallback((value: MainContentLayoutConfig) => {
    setLayoutConfig((current) => {
      if (
        current.fullWidth === value.fullWidth &&
        current.pageSidebar === value.pageSidebar &&
        current.pageSidebarClassName === value.pageSidebarClassName &&
        current.pageSidebarMobileBehavior === value.pageSidebarMobileBehavior
      ) {
        return current;
      }

      return value;
    });
  }, []);

  const isAuthRoute = pathname?.startsWith("/login") || pathname?.startsWith("/signup") || pathname?.startsWith("/callback");
  const isManagerRoute = pathname?.startsWith("/manager");
  const hasPageSidebar = Boolean(layoutConfig.pageSidebar);
  const usesWideShell = layoutConfig.fullWidth || hasPageSidebar;
  const shouldHideMobileSidebar = layoutConfig.pageSidebarMobileBehavior === "hidden" || layoutConfig.pageSidebarMobileBehavior === "drawer";
  const usesSidebarShell = hasPageSidebar;

  const layoutValue = useMemo(() => ({ layoutConfig, setLayoutConfig: updateLayoutConfig }), [layoutConfig, updateLayoutConfig]);

  return (
    <MainContentLayoutContext.Provider value={layoutValue}>
      <main
        className={cn(
          "flex-1 min-h-0",
          usesSidebarShell ? "flex w-full max-w-none flex-col md:flex-row" : "flex flex-col",
          !usesSidebarShell && (usesWideShell ? "w-full max-w-none" : "container mx-auto"),
          isAuthRoute && "p-0",
          usesSidebarShell ? (isManagerRoute ? "overflow-hidden" : "overflow-y-auto md:overflow-hidden") : !isAuthRoute && !isManagerRoute ? cn("overflow-y-auto", APP_PAGE_SHELL_X, APP_PAGE_SHELL_Y, APP_PAGE_SHELL_BOTTOM_SCROLL) : undefined,
          !usesSidebarShell && isManagerRoute && cn("overflow-hidden", APP_PAGE_SHELL_X, APP_PAGE_SHELL_Y),
        )}
      >
        <aside
          className={cn(
            "min-w-0 shrink-0 overflow-x-hidden",
            usesSidebarShell ? "px-4 py-8" : "hidden p-0",
            usesSidebarShell && (shouldHideMobileSidebar ? "hidden" : "block border-b border-border md:border-b-0"),
            usesSidebarShell && "md:flex md:min-h-0 md:border-r md:border-border md:overflow-y-auto",
            layoutConfig.pageSidebarClassName,
          )}
        >
          {layoutConfig.pageSidebar}
        </aside>

        <div
          className={cn(
            "min-w-0 flex flex-1 min-h-0 flex-col",
            usesSidebarShell && !isAuthRoute && APP_PAGE_SHELL_X,
            usesSidebarShell && !isAuthRoute && APP_PAGE_SHELL_Y,
            usesSidebarShell && !isAuthRoute && !isManagerRoute && APP_PAGE_SHELL_BOTTOM_SCROLL,
            usesSidebarShell && (isManagerRoute ? "overflow-hidden" : "md:overflow-y-auto"),
          )}
        >
          {children}
        </div>
      </main>
    </MainContentLayoutContext.Provider>
  );
}
