"use client";

import { ReactNode, useEffect, useMemo } from "react";
import { DEFAULT_MAIN_CONTENT_LAYOUT_CONFIG, type PageSidebarMobileBehavior, useMainContentLayout } from "@/components/layout/MainContent";
import { PageSectionHeader } from "./PageSectionHeader";
import { cn } from "@/lib/utils/cn";

export type PageContainerVariant = "standard" | "analytics";

export interface PageContainerProps {
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;

  /** Escolha semantica do layout da pagina autenticada. */
  variant?: PageContainerVariant;

  /** Escape hatch legado. Faz o wrapper ter h-full para permitir scroll interno dos filhos. */
  fullHeight?: boolean;

  /** Uso restrito (Explorer). Remove o header (título/descrição) mas preserva o layout. */
  hideHeader?: boolean;

  /** Uso restrito (Explorer). Faz o shell ocupar largura total da main. */
  fullWidth?: boolean;

  /**
   * A rolagem passa a ser de um container DENTRO da página, não da página.
   * A página fica responsável por marcar qual pedaço rola (`overflow-y-auto` +
   * `min-h-0`); o shell só trava a altura, a partir de `lg`.
   */
  contentScroll?: boolean;

  /** Uso restrito (Explorer). Conteúdo lateral fixo ao lado do children. */
  pageSidebar?: ReactNode;
  pageSidebarClassName?: string;
  pageSidebarMobileBehavior?: PageSidebarMobileBehavior;

  /** Uso restrito (Explorer). Classe extra no wrapper do content (ex: min-w-0). */
  contentClassName?: string;
}

export function PageContainer({
  title,
  description,
  icon,
  actions,
  children,
  className,
  contentClassName,
  variant = "standard",
  fullHeight = false,
  fullWidth = false,
  contentScroll = false,
  pageSidebar = null,
  pageSidebarClassName,
  pageSidebarMobileBehavior = "stack",
  hideHeader = false,
}: PageContainerProps) {
  const layout = useMainContentLayout();
  const setLayoutConfig = layout?.setLayoutConfig;
  const layoutConfig = useMemo(
    () => ({
      fullWidth,
      contentScroll,
      pageSidebar,
      pageSidebarClassName,
      pageSidebarMobileBehavior,
    }),
    [fullWidth, contentScroll, pageSidebar, pageSidebarClassName, pageSidebarMobileBehavior],
  );

  useEffect(() => {
    if (!setLayoutConfig) {
      return;
    }

    setLayoutConfig(layoutConfig);
  }, [layoutConfig, setLayoutConfig]);

  useEffect(() => {
    if (!setLayoutConfig) {
      return;
    }

    return () => {
      setLayoutConfig(DEFAULT_MAIN_CONTENT_LAYOUT_CONFIG);
    };
  }, [setLayoutConfig]);

  const shouldUseFullHeight = variant === "analytics" || fullHeight;

  return (
    <div
      className={cn(
        shouldUseFullHeight ? "h-full flex-1 flex flex-col min-h-0" : !hideHeader ? "space-y-5" : "",
        className,
      )}
    >
      {!hideHeader && <PageSectionHeader title={title} description={description} icon={icon} actions={actions} />}
      <div className={cn(shouldUseFullHeight ? "flex-1 flex flex-col min-h-0" : "min-w-0", contentClassName)}>{children}</div>
    </div>
  );
}
