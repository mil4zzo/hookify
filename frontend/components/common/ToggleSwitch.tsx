"use client";

import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils/cn";
import { ReactNode } from "react";

export interface ToggleSwitchProps {
  id: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  helperText?: ReactNode;
  className?: string;
  labelClassName?: string;
}

/**
 * Componente reutilizável para switches com label padronizado.
 * Centraliza o estilo e facilita a manutenção de toggles em toda a aplicação.
 * 
 * @example
 * <ToggleSwitch
 *   id="group-by-packs"
 *   checked={groupByPacks}
 *   onCheckedChange={handleToggleGroupByPacks}
 *   label="Agrupar por Packs"
 * />
 */
export function ToggleSwitch({
  id,
  checked,
  onCheckedChange,
  label,
  disabled = false,
  helperText,
  className,
  labelClassName,
}: ToggleSwitchProps) {
  return (
    <div className={cn("flex items-center gap-2 p-2 bg-card border border-border rounded-md", className)}>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
      <label
        htmlFor={id}
        className={cn(
          "text-sm font-medium cursor-pointer",
          disabled && "text-muted-foreground",
          labelClassName
        )}
      >
        {label}
      </label>
      {helperText && (
        <span className="text-xs text-muted-foreground ml-2">{helperText}</span>
      )}
    </div>
  );
}
