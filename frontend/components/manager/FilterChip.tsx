"use client";

import React from "react";
import { IconCheck, IconFilter, IconX } from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils/cn";

/**
 * Peças presentacionais do chip de filtro do FilterBar (status/texto/numérico).
 * A lógica de valor (apply/cancel/validação) fica no FilterBar — aqui só o visual comum.
 */

/** Shell do chip: badge outline com ícone de filtro à esquerda. */
export function FilterChip({ children }: { children: React.ReactNode }) {
  return (
    <Badge variant="outline" className="inline-flex items-center gap-1.5 px-2 py-1 h-8 text-xs font-medium bg-card border-border hover:bg-muted">
      <IconFilter className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
      {children}
    </Badge>
  );
}

/** Select de operador embutido no chip (trigger borderless compacto). */
export function FilterChipOperatorSelect({ value, onValueChange, operators }: { value: string; onValueChange: (value: string) => void; operators: { value: string; label: string }[] }) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className="h-auto w-fit gap-1.5 border-0 bg-transparent px-2 py-0 text-xs hover:bg-muted-50 focus:ring-0 focus:ring-offset-0">
        <SelectValue className="text-xs" />
      </SelectTrigger>
      <SelectContent disablePortal={true}>
        {operators.map((op) => (
          <SelectItem key={op.value} value={op.value}>
            {op.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Input inline embutido no chip (borderless, aplica no Enter — handlers vêm do chamador). */
export const FilterChipInput = React.forwardRef<HTMLInputElement, Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> & { widthClassName?: string }>(function FilterChipInput({ widthClassName = "w-32", className, ...props }, ref) {
  return (
    <Input
      ref={ref}
      type="text"
      // design-system-exception: control-height-override - input embutido em chip h-8; segue a altura do chip, não a escala de controles
      className={cn("h-6 min-w-0 px-2 py-0 text-xs border-0 bg-transparent hover:bg-muted-50 focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0", widthClassName, className)}
      onClick={(e) => e.stopPropagation()}
      {...props}
    />
  );
});

/** Botão de ação do chip: check verde (aplicar) quando há mudança não salva, senão X (remover). */
export function FilterChipAction({ hasUnsavedChanges, onApply, onRemove, label }: { hasUnsavedChanges?: boolean; onApply?: () => void; onRemove: () => void; label: string }) {
  if (hasUnsavedChanges && onApply) {
    return (
      <button
        onMouseDown={(e) => {
          // Prevenir que o blur do input seja disparado antes do clique
          e.preventDefault();
          onApply();
        }}
        className="ml-1 hover:bg-success-90 rounded-full p-0.5 transition-colors flex-shrink-0 bg-success"
        aria-label={`Aplicar filtro ${label}`}
      >
        <IconCheck className="w-3 h-3 text-success-foreground" />
      </button>
    );
  }
  return (
    <button onClick={onRemove} className="ml-1 hover:bg-muted rounded-full p-0.5 transition-colors flex-shrink-0 text-text hover:text-destructive" aria-label={`Remover filtro ${label}`}>
      <IconX className="w-3 h-3" />
    </button>
  );
}
