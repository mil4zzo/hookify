"use client";

import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils/cn";
import { cva, type VariantProps } from "class-variance-authority";
import { ReactNode } from "react";

// Variantes para o container
const containerVariants = cva("flex items-center gap-2", {
  variants: {
    variant: {
      default: "px-4 py-2 bg-muted border border-border rounded-md",
      minimal: "p-0 bg-transparent border-0",
    },
    size: {
      sm: "gap-1.5",
      md: "gap-2",
      lg: "gap-3",
    },
  },
  defaultVariants: {
    variant: "default",
    size: "md",
  },
});

// Variantes para o label
const labelVariants = cva("font-medium cursor-pointer", {
  variants: {
    size: {
      sm: "text-xs",
      md: "text-sm",
      lg: "text-base",
    },
  },
  defaultVariants: {
    size: "md",
  },
});

export interface ToggleSwitchProps extends VariantProps<typeof containerVariants> {
  id: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label?: string; // Label genérico (usado como fallback se labelLeft/labelRight não estiverem definidos)
  labelLeft?: string; // Label à esquerda do switch
  labelRight?: string; // Label à direita do switch
  disabled?: boolean;
  helperText?: ReactNode;
  icon?: ReactNode; // Ícone para exibir junto com o label (geralmente à esquerda do texto)
  className?: string;
  labelClassName?: string;
  switchClassName?: string;
}

/**
 * Componente reutilizável para switches com label padronizado.
 * Centraliza o estilo e facilita a manutenção de toggles em toda a aplicação.
 *
 * Suporta:
 * - Com e sem label
 * - Variantes de container (default, minimal)
 * - Tamanhos diferentes (sm, md, lg)
 * - Labels à esquerda, direita ou ambos os lados (usando labelLeft e/ou labelRight)
 *
 * @example
 * // Switch com label à direita (usando label genérico)
 * <ToggleSwitch
 *   id="group-by-packs"
 *   checked={groupByPacks}
 *   onCheckedChange={handleToggleGroupByPacks}
 *   label="Agrupar por Packs"
 * />
 *
 * @example
 * // Switch com label à esquerda, sem container estilizado
 * <ToggleSwitch
 *   id="auto-refresh"
 *   checked={autoRefresh}
 *   onCheckedChange={setAutoRefresh}
 *   labelLeft="Atualização automática"
 *   variant="minimal"
 * />
 *
 * @example
 * // Switch com labels em ambos os lados
 * <ToggleSwitch
 *   id="toggle"
 *   checked={isEnabled}
 *   onCheckedChange={setIsEnabled}
 *   labelLeft="Desativado"
 *   labelRight="Ativado"
 * />
 *
 * @example
 * // Switch sem label, apenas o toggle, sem container estilizado
 * <ToggleSwitch
 *   id="simple-toggle"
 *   checked={value}
 *   onCheckedChange={setValue}
 *   variant="minimal"
 * />
 */
export function ToggleSwitch({ id, checked, onCheckedChange, label, labelLeft, labelRight, disabled = false, helperText, icon, className, labelClassName, switchClassName, variant = "default", size = "md" }: ToggleSwitchProps) {
  // Determinar labels: usar labelLeft/labelRight se definidos, senão usar label como fallback à direita
  // Se labelLeft estiver definido, mostra à esquerda
  // Se labelRight estiver definido, mostra à direita
  // Se apenas label estiver definido (sem labelLeft nem labelRight), mostra à direita (comportamento padrão)
  const effectiveLabelLeft = labelLeft;
  const effectiveLabelRight = labelRight || (label && !labelLeft ? label : undefined);

  // Quando ambos os labels estão presentes, alternar text-muted baseado no estado do toggle
  // Quando checked = false: labelLeft está ativo (sem muted), labelRight está inativo (com muted)
  // Quando checked = true: labelLeft está inativo (com muted), labelRight está ativo (sem muted)
  const hasBothLabels = effectiveLabelLeft && effectiveLabelRight;
  const leftLabelClasses = cn(
    "flex items-center gap-1",
    labelVariants({ size }),
    "transition-colors duration-200", // Transição suave para mudança de cor
    disabled && "text-muted-foreground cursor-not-allowed",
    !disabled && "cursor-pointer",
    hasBothLabels && checked && "text-muted-foreground", // Quando ligado, labelLeft está inativo
    labelClassName
  );
  const rightLabelClasses = cn(
    "flex items-center gap-1",
    labelVariants({ size }),
    "transition-colors duration-200", // Transição suave para mudança de cor
    disabled && "text-muted-foreground cursor-not-allowed",
    !disabled && "cursor-pointer",
    hasBothLabels && !checked && "text-muted-foreground", // Quando desligado, labelRight está inativo
    labelClassName
  );

  const content = (
    <>
      {effectiveLabelLeft && (
        <label htmlFor={id} className={leftLabelClasses}>
          {icon && <span className="flex-shrink-0">{icon}</span>}
          {effectiveLabelLeft}
        </label>
      )}

      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} className={switchClassName} />

      {effectiveLabelRight && (
        <label htmlFor={id} className={rightLabelClasses}>
          {icon && !effectiveLabelLeft && <span className="flex-shrink-0">{icon}</span>}
          {effectiveLabelRight}
        </label>
      )}

      {helperText && <span className={cn("text-muted-foreground", size === "sm" ? "text-xs" : size === "lg" ? "text-sm" : "text-xs", "ml-2")}>{helperText}</span>}
    </>
  );

  return (
    <div
      className={cn(containerVariants({ variant, size }), className)}
      onClick={(e) => {
        e.stopPropagation();
      }}
      onPointerDown={(e) => {
        e.stopPropagation();
      }}
      onMouseDown={(e) => {
        e.stopPropagation();
      }}
    >
      {content}
    </div>
  );
}
