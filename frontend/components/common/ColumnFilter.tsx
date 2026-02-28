"use client";

import React, { useState, useRef, useEffect } from "react";
import { IconFilter, IconX } from "@tabler/icons-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

export type FilterOperator = ">" | "<" | ">=" | "<=" | "=" | "!=";
export type TextFilterOperator = "contains" | "not_contains" | "starts_with" | "ends_with" | "equals" | "not_equals";

export interface FilterValue {
  operator: FilterOperator;
  value: number | null;
}

export interface TextFilterValue {
  operator: TextFilterOperator;
  value: string | null;
}

export interface StatusFilterValue {
  selectedStatuses: string[];
}

interface ColumnFilterProps {
  value: FilterValue | undefined;
  onChange?: (value: FilterValue | undefined) => void;
  placeholder?: string;
  className?: string;
  /** Se true, o filtro é somente leitura - só mostra o ícone quando há filtro ativo, sem permitir interação */
  readonly?: boolean;
}

const OPERATORS: { value: FilterOperator; label: string }[] = [
  { value: ">", label: "Maior que" },
  { value: "<", label: "Menor que" },
  { value: ">=", label: "Maior ou igual" },
  { value: "<=", label: "Menor ou igual" },
  { value: "=", label: "Igual a" },
  { value: "!=", label: "Diferente de" },
];

export function ColumnFilter({ value, onChange, placeholder = "Filtrar...", className, readonly = false }: ColumnFilterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isSelectOpen, setIsSelectOpen] = useState(false);
  const [tempOperator, setTempOperator] = useState<FilterOperator>(">");
  const [tempValue, setTempValue] = useState<string>("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Inicializar valores temporários quando abrir o dropdown
  useEffect(() => {
    if (isOpen) {
      setTempOperator(value?.operator ?? ">");
      setTempValue(value?.value !== null && value?.value !== undefined ? String(value.value) : "");
      // Focar no input após um pequeno delay para garantir que o estado foi atualizado
      setTimeout(() => {
        inputRef.current?.focus();
      }, 0);
    }
  }, [isOpen, value]);

  // Fechar quando clicar fora (mas não quando o Select está aberto)
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      // Não fechar se o Select está aberto
      if (isSelectOpen) {
        return;
      }
      
      const target = event.target as Node;
      
      // Não fechar se o clique foi dentro do container do filtro
      if (containerRef.current && containerRef.current.contains(target)) {
        return;
      }
      
      // Não fechar se o clique foi no SelectContent (que é renderizado em um portal)
      const selectContent = document.querySelector('[role="listbox"]');
      if (selectContent && (selectContent.contains(target) || selectContent === target)) {
        return;
      }
      
      // Não fechar se o clique foi em qualquer elemento do Radix Select
      const radixSelectElements = document.querySelectorAll('[data-radix-select-content], [data-radix-select-viewport], [data-radix-select-item]');
      for (const element of radixSelectElements) {
        if (element.contains(target) || element === target) {
          return;
        }
      }
      
      // Fechar apenas se o clique foi realmente fora
      setIsOpen(false);
    };

    if (isOpen && !isSelectOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen, isSelectOpen]);

  const hasFilter = value && value.value !== null && value.value !== undefined && !isNaN(value.value);

  // Se for readonly, só mostrar o ícone quando há filtro ativo
  if (readonly) {
    if (!hasFilter) {
      return null;
    }
    return (
      <div className={cn("inline-flex items-center", className)}>
        <div
          className={cn(
            "flex items-center justify-center w-6 h-6 rounded",
            hasFilter && "text-primary"
          )}
          title="Filtro ativo"
        >
          <IconFilter className={cn("w-3.5 h-3.5", hasFilter && "fill-current")} />
        </div>
      </div>
    );
  }

  const handleOperatorChange = (operator: FilterOperator) => {
    setTempOperator(operator);
  };

  const handleValueChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTempValue(e.target.value);
  };

  const handleApply = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onChange) return;
    const numValue = tempValue === "" ? null : parseFloat(tempValue);
    if (tempValue === "" || (!isNaN(numValue!) && isFinite(numValue!))) {
      onChange({
        operator: tempOperator,
        value: numValue,
      });
    } else if (tempValue === "") {
      // Se estiver vazio, limpar o filtro
      onChange(undefined);
    }
    setIsOpen(false);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onChange) return;
    onChange(undefined);
    setTempValue("");
    setIsOpen(false);
  };

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsOpen(!isOpen);
  };

  return (
    <div ref={containerRef} className={cn("relative inline-flex items-center", className)}>
      <button
        type="button"
        onClick={handleToggle}
        className={cn(
          "flex items-center justify-center w-6 h-6 rounded hover:bg-muted transition-colors",
          hasFilter && "text-primary"
        )}
        title="Filtrar coluna"
      >
        <IconFilter className={cn("w-3.5 h-3.5", hasFilter && "fill-current")} />
      </button>

      {isOpen && (
        <div
          className="absolute top-full right-0 mt-1 z-50 bg-card border border-border rounded-md shadow-lg p-2 min-w-[200px]"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Select
                value={tempOperator}
                onValueChange={(val) => handleOperatorChange(val as FilterOperator)}
                onOpenChange={(open) => setIsSelectOpen(open)}
              >
                <SelectTrigger className="h-10 w-[120px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OPERATORS.map((op) => (
                    <SelectItem key={op.value} value={op.value}>
                      {op.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                ref={inputRef}
                type="number"
                step="any"
                value={tempValue}
                onChange={handleValueChange}
                placeholder={placeholder}
                className="h-10 text-xs flex-1 [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none [-moz-appearance:textfield]"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleApply(e as any);
                  }
                }}
              />
            </div>
            <div className="flex items-center gap-2">
              {hasFilter && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClear}
                  className="h-8 text-xs"
                >
                  <IconX className="w-3 h-3 mr-1" />
                  Limpar
                </Button>
              )}
              <Button
                variant="default"
                size="sm"
                onClick={handleApply}
                className="h-8 text-xs flex-1"
              >
                Aplicar
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

