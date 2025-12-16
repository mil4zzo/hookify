"use client";

import React, { useMemo, useState, useEffect } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { IconCheck, IconFocus2 } from "@tabler/icons-react";
import { cn } from "@/lib/utils/cn";
import { FilterSelectButton } from "@/components/common/FilterSelectButton";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface ActionTypeFilterProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  className?: string;
  placeholder?: string;
  isLoading?: boolean; // Se true, mostra loading state
}

export function ActionTypeFilter({ 
  label = "Evento de Conversão", 
  value, 
  onChange, 
  options, 
  className,
  placeholder = "Evento de Conversão",
  isLoading = false
}: ActionTypeFilterProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  
  // Determinar se está carregando (prop explícita ou quando não há opções ainda)
  const isActuallyLoading = isLoading || options.length === 0;

  // Função para formatar o label exibido (remover prefixo)
  const formatLabel = (option: string) => {
    if (option.includes(":")) {
      return option.split(":", 2)[1];
    }
    return option;
  };

  // Agrupar opções por categoria
  const groupedOptions = useMemo(() => {
    const groups: { conversions: string[]; actions: string[] } = {
      conversions: [],
      actions: []
    };
    
    options.forEach(option => {
      if (option.startsWith("conversion:")) {
        groups.conversions.push(option);
      } else if (option.startsWith("action:")) {
        groups.actions.push(option);
      }
    });
    
    return groups;
  }, [options]);

  // Filtrar opções baseado na busca
  const filteredGroups = useMemo(() => {
    if (!search) return groupedOptions;
    
    const searchLower = search.toLowerCase();
    const filtered: { conversions: string[]; actions: string[] } = {
      conversions: [],
      actions: []
    };

    groupedOptions.conversions.forEach(option => {
      const label = formatLabel(option);
      if (label.toLowerCase().includes(searchLower) || option.toLowerCase().includes(searchLower)) {
        filtered.conversions.push(option);
      }
    });

    groupedOptions.actions.forEach(option => {
      const label = formatLabel(option);
      if (label.toLowerCase().includes(searchLower) || option.toLowerCase().includes(searchLower)) {
        filtered.actions.push(option);
      }
    });

    return filtered;
  }, [groupedOptions, search]);

  // Encontrar opção selecionada
  const selectedOption = options.find(opt => opt === value);

  // Resetar busca quando fechar
  useEffect(() => {
    if (!open) {
      setSearch("");
    }
  }, [open]);

  // Verificar se há resultados filtrados
  const hasResults = filteredGroups.conversions.length > 0 || filteredGroups.actions.length > 0;

  return (
    <div className={cn("space-y-2", className)}>
      {label && <label className="text-sm font-medium">{label}</label>}
      <TooltipProvider>
        <Popover open={open} onOpenChange={setOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <FilterSelectButton
                  aria-expanded={open}
                  disabled={isActuallyLoading}
                  iconPosition="start"
                  icon={<IconFocus2 className="mr-2 h-4 w-4 flex-shrink-0" />}
                >
                  {isActuallyLoading ? (
                    <span className="text-muted-foreground flex items-center gap-2">
                      <Skeleton className="h-4 w-32" />
                    </span>
                  ) : (
                    <span className="truncate text-left">
                      {selectedOption ? formatLabel(selectedOption) : placeholder}
                    </span>
                  )}
                </FilterSelectButton>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent>
              <p>Evento de conversão</p>
            </TooltipContent>
          </Tooltip>
        <PopoverContent
          className="w-[var(--radix-popover-trigger-width)] p-0 z-[10000] rounded-md border border-border bg-secondary text-text shadow-md"
          align="start"
          sideOffset={4}
        >
          <div className="flex flex-col">
            <div className="border-b border-border p-2">
              <Input
                placeholder="Buscar evento de conversão..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9"
                onKeyDown={(e) => {
                  // Prevenir que Enter feche o popover
                  if (e.key === "Enter") {
                    e.preventDefault();
                    // Se houver apenas uma opção filtrada, selecionar ela
                    const allFiltered = [...filteredGroups.conversions, ...filteredGroups.actions];
                    if (allFiltered.length === 1) {
                      onChange(allFiltered[0]);
                      setOpen(false);
                    }
                  }
                  // Permitir Escape fechar
                  if (e.key === "Escape") {
                    setOpen(false);
                  }
                }}
                onClick={(e) => {
                  // Prevenir que o clique no input feche o popover
                  e.stopPropagation();
                }}
                autoFocus
              />
            </div>
            <div className="max-h-[300px] overflow-y-auto">
              {!hasResults ? (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  Nenhum evento encontrado.
                </div>
              ) : (
                <div className="p-1">
                  {/* Grupo Conversions */}
                  {filteredGroups.conversions.length > 0 && (
                    <div className="mb-1">
                      <div className="px-2 py-1.5 text-xs font-semibold text-primary">
                        Conversions
                      </div>
                      {filteredGroups.conversions.map((option) => {
                        const isSelected = value === option;
                        return (
                          <button
                            key={option}
                            onClick={() => {
                              onChange(option);
                              setOpen(false);
                            }}
                            className={cn(
                              "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 hover:bg-accent hover:text-accent-foreground",
                              isSelected && "bg-accent"
                            )}
                          >
                            <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
                              <IconCheck
                                className={cn(
                                  "h-4 w-4",
                                  isSelected ? "opacity-100" : "opacity-0"
                                )}
                              />
                            </span>
                            {formatLabel(option)}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Grupo Actions */}
                  {filteredGroups.actions.length > 0 && (
                    <div>
                      <div className="px-2 py-1.5 text-xs font-semibold text-brand">
                        Actions
                      </div>
                      {filteredGroups.actions.map((option) => {
                        const isSelected = value === option;
                        return (
                          <button
                            key={option}
                            onClick={() => {
                              onChange(option);
                              setOpen(false);
                            }}
                            className={cn(
                              "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 hover:bg-accent hover:text-accent-foreground",
                              isSelected && "bg-accent"
                            )}
                          >
                            <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
                              <IconCheck
                                className={cn(
                                  "h-4 w-4",
                                  isSelected ? "opacity-100" : "opacity-0"
                                )}
                              />
                            </span>
                            {formatLabel(option)}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </PopoverContent>
      </Popover>
      </TooltipProvider>
    </div>
  );
}

