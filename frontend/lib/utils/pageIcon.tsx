"use client";

import { ComponentType } from "react";
import { PAGE_ICON_CLASSES } from "@/lib/constants/pageLayout";

/**
 * Helper para renderizar ícones padronizados no header das páginas
 * 
 * Garante que todos os ícones tenham o mesmo tamanho e cor,
 * facilitando a manutenção e consistência visual.
 * 
 * @example
 * ```tsx
 * import { PageIcon } from "@/lib/utils/pageIcon";
 * import { IconCompass } from "@tabler/icons-react";
 * 
 * <PageContainer
 *   title="Explore"
 *   icon={<PageIcon icon={IconCompass} />}
 * >
 *   ...
 * </PageContainer>
 * ```
 */
export function PageIcon({ 
  icon: Icon, 
  className = "" 
}: { 
  icon: ComponentType<{ className?: string }>;
  className?: string;
}) {
  return <Icon className={`${PAGE_ICON_CLASSES} ${className}`} />;
}

