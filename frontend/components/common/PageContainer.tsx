"use client";

import { ReactNode } from "react";
import { PageSectionHeader } from "./PageSectionHeader";
import { cn } from "@/lib/utils/cn";

export interface PageContainerProps {
  // Props do header
  title: string;
  description?: string;
  icon?: ReactNode;
  actions?: ReactNode;
  headerClassName?: string;
  titleClassName?: string;
  descriptionClassName?: string;
  
  // Props do container
  children: ReactNode;
  className?: string;
  spacing?: "sm" | "md" | "lg"; // sm=4, md=6, lg=8
}

/**
 * Container padronizado para páginas da aplicação.
 * Garante consistência no espaçamento e estrutura entre páginas.
 * 
 * @example
 * <PageContainer
 *   title="Biblioteca"
 *   description="Gerencie seus Packs de anúncios"
 *   icon={<IconStack2Filled className="w-6 h-6 text-yellow-500" />}
 *   actions={<Button>Carregar Pack</Button>}
 * >
 *   <div>Conteúdo da página</div>
 * </PageContainer>
 */
export function PageContainer({
  title,
  description,
  icon,
  actions,
  headerClassName,
  titleClassName,
  descriptionClassName,
  children,
  className,
  spacing = "md", // padrão: space-y-6
}: PageContainerProps) {
  const spacingClasses = {
    sm: "space-y-4",
    md: "space-y-6",
    lg: "space-y-8",
  };

  return (
    <div className={cn(spacingClasses[spacing], className)}>
      <PageSectionHeader
        title={title}
        description={description}
        icon={icon}
        actions={actions}
        className={headerClassName}
        titleClassName={titleClassName}
        descriptionClassName={descriptionClassName}
      />
      {children}
    </div>
  );
}

