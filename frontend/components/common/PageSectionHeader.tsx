"use client";

import { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export interface PageSectionHeaderProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  actions?: ReactNode;
  className?: string;
  actionsClassName?: string;
  titleClassName?: string;
  descriptionClassName?: string;
  variant?: "standard" | "analytics";
}

/**
 * Componente reutilizável para headers de seções de página.
 * Segue o padrão visual usado na página Insights.
 *
 * @example
 * <PageSectionHeader
 *   title="Oportunidades"
 *   description="Insights acionáveis para alavancar seus anúncios"
 *   actions={<FiltersDropdown ... />}
 * />
 */
export function PageSectionHeader({ title, description, icon, actions, className, actionsClassName, titleClassName, descriptionClassName, variant = "standard" }: PageSectionHeaderProps) {
  return (
    <div className={cn("mb-4 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between", variant === "analytics" && "mb-5 gap-5", className)}>
      <div>
        <div className={cn("flex items-center", icon && "gap-2")}>
          {icon && <div>{icon}</div>}
          <h1 className={cn("text-3xl font-semibold tracking-tight", variant === "analytics" && "text-3xl xl:text-[2rem]", titleClassName)}>{title}</h1>
        </div>
        {description && <p className={cn("text-muted-foreground", variant === "analytics" && "max-w-3xl", descriptionClassName)}>{description}</p>}
      </div>
      {actions && <div className={cn("flex w-full min-w-0 flex-col gap-3 lg:w-auto lg:flex-shrink-0 lg:items-end", actionsClassName)}>{actions}</div>}
    </div>
  );
}
