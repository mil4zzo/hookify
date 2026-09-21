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
  /**
   * Quem rola é um container DENTRO da página, não a página.
   * O shell então trava a altura (`overflow-hidden` + `min-h-0` na cadeia) e a
   * página fica responsável por dizer qual pedaço rola. Serve para tela de duas
   * colunas onde uma delas deve ficar sempre visível — na /packs, o explorer.
   * Só a partir de `lg`: em tela estreita a rolagem volta a ser da página, porque
   * altura travada em viewport de celular briga com a barra do navegador.
   */
  contentScroll: boolean;
};

export const DEFAULT_MAIN_CONTENT_LAYOUT_CONFIG: MainContentLayoutConfig = {
  fullWidth: false,
  pageSidebar: null,
  pageSidebarClassName: undefined,
  pageSidebarMobileBehavior: "stack",
  contentScroll: false,
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
        current.pageSidebarMobileBehavior === value.pageSidebarMobileBehavior &&
        current.contentScroll === value.contentScroll
      ) {
        return current;
      }

      return value;
    });
  }, []);

  const isAuthRoute = pathname?.startsWith("/login") || pathname?.startsWith("/callback");
  const isManagerRoute = pathname?.startsWith("/manager");
  const hasPageSidebar = Boolean(layoutConfig.pageSidebar);
  const usesWideShell = layoutConfig.fullWidth || hasPageSidebar;
  const shouldHideMobileSidebar = layoutConfig.pageSidebarMobileBehavior === "hidden" || layoutConfig.pageSidebarMobileBehavior === "drawer";
  const usesSidebarShell = hasPageSidebar;
  // Rolagem interna só onde a página pediu, e nunca nas rotas que já têm casca própria.
  const usesContentScroll = layoutConfig.contentScroll && !usesSidebarShell && !isAuthRoute && !isManagerRoute;

  const layoutValue = useMemo(() => ({ layoutConfig, setLayoutConfig: updateLayoutConfig }), [layoutConfig, updateLayoutConfig]);

  // Non-sidebar-shell, non-wide pages use a contained layout — the scroll lives on <main>
  // (full-width) so the scrollbar appears at the viewport edge, while the inner div
  // applies the container + padding constraint for content centering.
  const isContainedPage = !usesSidebarShell && !usesWideShell && !isAuthRoute && !isManagerRoute;

  return (
    <MainContentLayoutContext.Provider value={layoutValue}>
      <main
        className={cn(
          "flex-1 min-h-0",
          usesSidebarShell ? "flex w-full max-w-none flex-col md:flex-row" : "flex flex-col",
          !usesSidebarShell && "w-full max-w-none",
          isAuthRoute && "p-0",
          usesSidebarShell ? (isManagerRoute ? "overflow-hidden" : "overflow-y-auto md:overflow-hidden") : !isAuthRoute && !isManagerRoute ? cn("overflow-y-auto", usesContentScroll && "lg:overflow-hidden", !isContainedPage && cn(APP_PAGE_SHELL_X, APP_PAGE_SHELL_Y)) : undefined,
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
            "min-w-0 flex flex-1 flex-col",
            (usesSidebarShell || isManagerRoute) && "min-h-0",
            usesContentScroll && "lg:min-h-0",
            isContainedPage && "container mx-auto",
            usesSidebarShell && !isAuthRoute && APP_PAGE_SHELL_X,
            usesSidebarShell && !isAuthRoute && APP_PAGE_SHELL_Y,
            isContainedPage && APP_PAGE_SHELL_X,
            isContainedPage && APP_PAGE_SHELL_Y,
            !isAuthRoute && !isManagerRoute && APP_PAGE_SHELL_BOTTOM_SCROLL,
            // Com rolagem interna o respiro de baixo é do CONTAINER QUE ROLA, não do
            // shell: aqui fora ele vira uma faixa morta que corta o conteúdo no meio
            // em vez de aparecer no fim da rolagem. Vem depois do `pb-*` acima de
            // propósito — `lg` é gerado depois de `md`, então ganha a partir do lg.
            usesContentScroll && "lg:pb-0",
            usesSidebarShell && (isManagerRoute ? "overflow-hidden" : "md:overflow-y-auto"),
          )}
        >
          {children}
        </div>
      </main>
    </MainContentLayoutContext.Provider>
  );
}
