"use client";

import { useMemo } from "react";
import { IconFocus2 } from "@tabler/icons-react";
import { cn } from "@/lib/utils/cn";
import { FilterSelectButton } from "@/components/common/FilterSelectButton";
import { FilterListPopover, type FilterListGroup } from "@/components/common/FilterListPopover";
// design-system-exception: direct-skeleton-import - filter-option-shaped loading skeleton
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

const ACTION_TYPE_GROUPS: FilterListGroup[] = [
  { id: "conversions", label: "Conversions", labelClassName: "text-primary" },
  { id: "actions", label: "Actions", labelClassName: "text-brand" },
];

// Formata o label exibido (remove o prefixo "conversion:"/"action:")
function formatLabel(option: string) {
  if (option.includes(":")) {
    return option.split(":", 2)[1];
  }
  return option;
}

export function ActionTypeFilter({ label = "Evento de Conversão", value, onChange, options, className, placeholder = "Evento de Conversão", isLoading = false }: ActionTypeFilterProps) {
  // Determinar se está carregando (prop explícita ou quando não há opções ainda)
  const isActuallyLoading = isLoading || options.length === 0;

  const listOptions = useMemo(
    () =>
      options
        .filter((option) => option.startsWith("conversion:") || option.startsWith("action:"))
        .map((option) => ({
          id: option,
          label: formatLabel(option),
          group: option.startsWith("conversion:") ? "conversions" : "actions",
        })),
    [options],
  );

  const selectedIds = useMemo(() => new Set(value ? [value] : []), [value]);

  // Encontrar opção selecionada
  const selectedOption = options.find((opt) => opt === value);

  return (
    <div className={cn("space-y-2", className)}>
      {label && <label className="text-sm font-medium">{label}</label>}
      <TooltipProvider>
        <FilterListPopover
          options={listOptions}
          groups={ACTION_TYPE_GROUPS}
          mode="single"
          selectedIds={selectedIds}
          onSelect={onChange}
          searchable
          searchPlaceholder="Buscar evento de conversão..."
          emptyMessage="Nenhum evento encontrado."
          contentClassName="w-[var(--radix-popover-trigger-width)] bg-secondary text-text"
          disabled={isActuallyLoading}
          trigger={
            <FilterSelectButton disabled={isActuallyLoading} iconPosition="start" icon={<IconFocus2 className="mr-2 h-4 w-4 flex-shrink-0" />}>
              {isActuallyLoading ? (
                <span className="text-muted-foreground flex items-center gap-2">
                  <Skeleton className="h-4 w-32" />
                </span>
              ) : (
                <span className="truncate text-left">{selectedOption ? formatLabel(selectedOption) : placeholder}</span>
              )}
            </FilterSelectButton>
          }
          triggerWrap={(node) => (
            <Tooltip>
              <TooltipTrigger asChild>{node}</TooltipTrigger>
              <TooltipContent>
                <p>Evento de conversão</p>
              </TooltipContent>
            </Tooltip>
          )}
        />
      </TooltipProvider>
    </div>
  );
}
