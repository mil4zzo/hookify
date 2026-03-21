"use client";

import React from "react";
import { IconSearch, IconX } from "@tabler/icons-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils/cn";

export interface SearchInputWithClearProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Classes do wrapper (ex: w-72, flex-shrink-0) */
  wrapperClassName?: string;
  /** Classes do input (ex: h-9, h-10, text-xs) - pl-9 pr-9 são sempre aplicados */
  inputClassName?: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  /** Callback ao limpar - default: onChange("") */
  onClear?: () => void;
}

/**
 * Input de busca padrão com ícone de lupa à esquerda e botão de limpar à direita.
 * Padrão do app: IconX com cores text-text (default) e text-destructive (hover) aplicadas ao button.
 */
export function SearchInputWithClear({
  value,
  onChange,
  placeholder = "Buscar...",
  wrapperClassName,
  inputClassName,
  inputRef,
  onClear,
  ...inputProps
}: SearchInputWithClearProps) {
  const handleClear = () => {
    if (onClear) {
      onClear();
    } else {
      onChange("");
    }
  };

  return (
    <div className={cn("relative", wrapperClassName)}>
      <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
      <Input
        ref={inputRef}
        type="search"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn("pl-9 pr-9", inputClassName)}
        {...inputProps}
      />
      {value && (
        <button
          type="button"
          onClick={handleClear}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-muted transition-colors text-text hover:text-destructive"
          aria-label="Limpar busca"
        >
          <IconX className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
