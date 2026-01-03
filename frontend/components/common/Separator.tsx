"use client";

import { cn } from "@/lib/utils/cn";

type SeparatorSize = "xs" | "sm" | "md" | "lg" | "xl";

interface SeparatorProps {
  /** Margin top - pode ser um tamanho (xs, sm, md, lg, xl) ou usar notação t-{size} */
  top?: SeparatorSize | `t-${SeparatorSize}`;
  /** Margin bottom - pode ser um tamanho (xs, sm, md, lg, xl) ou usar notação b-{size} */
  bottom?: SeparatorSize | `b-${SeparatorSize}`;
  /** Margin vertical (aplica tanto top quanto bottom) - pode ser um tamanho (xs, sm, md, lg, xl) ou usar notação y-{size} */
  vertical?: SeparatorSize | `y-${SeparatorSize}`;
  /** Classe CSS adicional */
  className?: string;
}

const sizeMap: Record<SeparatorSize, { top: string; bottom: string }> = {
  xs: { top: "mt-1", bottom: "mb-1" },
  sm: { top: "mt-2", bottom: "mb-2" },
  md: { top: "mt-4", bottom: "mb-4" },
  lg: { top: "mt-6", bottom: "mb-6" },
  xl: { top: "mt-8", bottom: "mb-8" },
};

/**
 * Componente de separador horizontal com margens customizáveis.
 *
 * @example
 * // Separador com margin bottom pequeno
 * <Separator bottom="sm" />
 *
 * @example
 * // Separador com margin top e bottom diferentes
 * <Separator top="md" bottom="lg" />
 *
 * @example
 * // Separador com margin vertical
 * <Separator vertical="md" />
 *
 * @example
 * // Usando notação alternativa
 * <Separator bottom="b-sm" top="t-md" />
 */
export function Separator({ top, bottom, vertical, className }: SeparatorProps) {
  // Se vertical está definido, aplicar a ambos
  const effectiveTop = vertical || top;
  const effectiveBottom = vertical || bottom;

  // Função para extrair o tamanho da notação (ex: "t-md" -> "md", "y-sm" -> "sm")
  const extractSize = (value: string | undefined): SeparatorSize | undefined => {
    if (!value) return undefined;
    // Se começa com t-, b- ou y-, remover o prefixo
    if (value.startsWith("t-") || value.startsWith("b-") || value.startsWith("y-")) {
      return value.substring(2) as SeparatorSize;
    }
    return value as SeparatorSize;
  };

  const topSize = extractSize(effectiveTop);
  const bottomSize = extractSize(effectiveBottom);

  // Construir classes de margin
  const marginClasses = cn(topSize && sizeMap[topSize].top, bottomSize && sizeMap[bottomSize].bottom);

  return <div className={cn("w-full border-b border-border", marginClasses, className)} />;
}
