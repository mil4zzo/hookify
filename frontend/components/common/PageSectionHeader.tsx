"use client";

import { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export interface PageSectionHeaderProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  actions?: ReactNode;
  className?: string;
  titleClassName?: string;
  descriptionClassName?: string;
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
export function PageSectionHeader({ title, description, icon, actions, className, titleClassName, descriptionClassName }: PageSectionHeaderProps) {
  return (
    <div className={cn("flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-4", className)}>
      <div>
        <div className={cn("flex items-center", icon && "gap-2")}>
          {icon && <div>{icon}</div>}
          <h1 className={cn("text-3xl font-semibold", titleClassName)}>{title}</h1>
        </div>
        {description && <p className={cn("text-muted-foreground", descriptionClassName)}>{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-4 flex-shrink-0">{actions}</div>}
    </div>
  );
}
