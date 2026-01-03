"use client";

import { ReactNode } from "react";
import { PageSectionHeader } from "./PageSectionHeader";
import { cn } from "@/lib/utils/cn";
import { PAGE_SPACING_DEFAULT, PAGE_SPACING_OPTIONS } from "@/lib/constants/pageLayout";

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
  /** Espaçamento vertical entre elementos (padrão: "md" = space-y-6) */
  spacing?: keyof typeof PAGE_SPACING_OPTIONS;
  /** Se true, o container ocupará toda a altura disponível com flex (use apenas quando necessário) */
  fullHeight?: boolean;
}

/**
 * Container padronizado para páginas da aplicação.
 * 
 * **Padrões estabelecidos:**
 * - Espaçamento padrão: `md` (space-y-6)
 * - Ícones: `w-6 h-6 text-yellow-500` (use PageIcon helper)
 * - Header: mb-4 (definido em PageSectionHeader)
 * 
 * **Quando usar `fullHeight`:**
 * - Apenas quando o conteúdo precisa ocupar toda a altura disponível
 * - Exemplo: tabelas que precisam de scroll interno
 * - ⚠️ Evite usar se não for necessário, pois remove o espaçamento padrão
 * 
 * @example
 * // Uso básico (recomendado)
 * <PageContainer
 *   title="Biblioteca"
 *   description="Gerencie seus Packs de anúncios"
 *   icon={<PageIcon icon={IconStack2Filled} />}
 *   actions={<Button>Carregar Pack</Button>}
 * >
 *   <div>Conteúdo da página</div>
 * </PageContainer>
 * 
 * @example
 * // Com fullHeight (apenas quando necessário)
 * <PageContainer
 *   title="Explore"
 *   description="Dados de performance"
 *   icon={<PageIcon icon={IconCompass} />}
 *   fullHeight={true}
 * >
 *   <ManagerTable ... />
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
  spacing = PAGE_SPACING_DEFAULT,
  fullHeight = false,
}: PageContainerProps) {

  return (
    <div className={cn(
      !fullHeight && PAGE_SPACING_OPTIONS[spacing], 
      fullHeight && "h-full flex-1 flex flex-col min-h-0",
      className
    )}>
      <PageSectionHeader
        title={title}
        description={description}
        icon={icon}
        actions={actions}
        className={headerClassName}
        titleClassName={titleClassName}
        descriptionClassName={descriptionClassName}
      />
      <div className={fullHeight ? "flex-1 flex flex-col min-h-0" : ""}>
        {children}
      </div>
    </div>
  );
}

