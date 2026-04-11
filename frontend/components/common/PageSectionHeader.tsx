"use client";

import { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export interface PageSectionHeaderProps {
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

/**
 * Header padrão de páginas. Mesmo look em todo o app — não há variantes.
 *
 * @example
 * <PageSectionHeader
 *   title="Oportunidades"
 *   description="Insights acionáveis para alavancar seus anúncios"
 *   actions={<FiltersDropdown ... />}
 * />
 */
export function PageSectionHeader({ title, description, icon, actions, className }: PageSectionHeaderProps) {
  return (
    <div className={cn("mb-5 flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between", className)}>
      <div>
        <div className={cn("flex items-center", icon && "gap-2")}>
          {icon && <div>{icon}</div>}
          <h1 className="text-3xl font-semibold tracking-tight xl:text-[2rem]">{title}</h1>
        </div>
        {description && <div className="max-w-3xl text-muted-foreground">{description}</div>}
      </div>
      {actions && <div className="flex w-full min-w-0 flex-col gap-3 lg:w-auto lg:flex-shrink-0 lg:items-end">{actions}</div>}
    </div>
  );
}
