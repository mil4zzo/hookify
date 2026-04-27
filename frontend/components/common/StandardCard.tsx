"use client";

import React from "react";
import { cn } from "@/lib/utils/cn";

export interface StandardCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Variante visual do card */
  variant?: "default" | "muted" | "card";
  /** Tamanho do padding interno */
  padding?: "sm" | "md" | "lg" | "none";
  /** Densidade semantica do conteudo quando padding nao e informado */
  density?: "compact" | "default" | "spacious";
  /** Nivel de elevacao padronizado */
  elevation?: "flat" | "raised" | "overlay";
  /** Se o card deve ter efeitos de hover (default: true quando onClick presente) */
  interactive?: boolean;
  /** Se o card está desabilitado (desabilita interações) */
  disabled?: boolean;
  /** Handler de click - quando presente, torna o card clicável */
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
}

/**
 * Componente base padronizado para cards no app.
 * Centraliza estilos de borda, padding, background e transições/animações.
 *
 * Baseado no estilo usado em GenericCard.tsx:
 * - rounded-md border border-border
 * - bg-card (variante padrão)
 * - transition-all duration-420
 * - hover:border-primary hover:bg-card-hover hover:shadow-lg (quando interactive)
 * - padding padrão: p-4
 */
export const StandardCard = React.forwardRef<HTMLDivElement, StandardCardProps>(({ children, className, variant = "default", padding, density = "default", elevation = "flat", interactive, disabled = false, onClick, ...props }, ref) => {
  // Determinar se é interativo: true se onClick presente, senão usa prop interactive
  const isInteractive = interactive !== undefined ? interactive : !!onClick;

  // Variantes de background
  const variantStyles = {
    default: "bg-card",
    muted: "bg-muted-50",
    card: "bg-card",
  };

  // Variantes de padding
  const paddingStyles = {
    sm: "p-2",
    md: "p-4",
    lg: "p-6",
    none: "",
  };
  const densityPaddingStyles = {
    compact: "p-widget-compact",
    default: "p-widget-default",
    spacious: "p-widget-spacious",
  };
  const elevationStyles = {
    flat: "shadow-elevation-flat",
    raised: "shadow-elevation-raised",
    overlay: "shadow-elevation-overlay",
  };

  // Classes base
  const baseClasses = cn(
    "rounded-md border border-border",
    variantStyles[variant],
    padding ? paddingStyles[padding] : densityPaddingStyles[density],
    elevationStyles[elevation],
    "transition-all duration-420",
    // Hover effects apenas quando interativo e não desabilitado
    isInteractive && !disabled && "hover:border-primary hover:bg-card-hover hover:shadow-lg",
    // Cursor pointer apenas quando clicável e não desabilitado
    onClick && !disabled && "cursor-pointer",
    // Opacidade reduzida quando desabilitado
    disabled && "opacity-50 cursor-not-allowed",
    className
  );

  return (
    <div ref={ref} className={baseClasses} onClick={disabled ? undefined : onClick} {...props}>
      {children}
    </div>
  );
});

StandardCard.displayName = "StandardCard";
