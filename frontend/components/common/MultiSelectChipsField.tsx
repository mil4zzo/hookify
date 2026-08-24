"use client";

import { useMemo } from "react";
import { IconX } from "@tabler/icons-react";

import { FilterListPopover } from "@/components/common/FilterListPopover";
import { FilterSelectButton } from "@/components/common/FilterSelectButton";
import { cn } from "@/lib/utils/cn";

export interface MultiSelectChipsFieldProps {
  options: { value: string; label: string }[];
  selectedIds: readonly string[];
  onChange: (ids: string[]) => void;
  /** Texto do botão quando nada foi escolhido. */
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  /** Rótulo da unidade no botão ("2 tags"). */
  itemLabel?: { one: string; many: string };
  /** Altura do botão — contrato de controles: "default" 40px | "sm" 32px. */
  size?: "default" | "sm";
  /** Repassa para o popover: obrigatório quando o campo vive dentro de outro popover. */
  disablePortal?: boolean;
  disabled?: boolean;
  className?: string;
}

/**
 * Campo de múltipla escolha: um botão que abre a lista pesquisável (FilterListPopover)
 * e, abaixo, chips removíveis do que já foi escolhido.
 *
 * Existe porque a parede de checkboxes inline não escala — com vocabulário grande
 * ela ocupava mais altura do que o popover inteiro. Os chips ficam FORA do botão de
 * propósito: um "×" dentro do trigger seria botão dentro de botão.
 */
export function MultiSelectChipsField({
  options,
  selectedIds,
  onChange,
  placeholder = "Selecionar...",
  searchPlaceholder = "Buscar...",
  emptyMessage = "Nenhum resultado encontrado.",
  itemLabel = { one: "item", many: "itens" },
  size = "sm",
  disablePortal = false,
  disabled = false,
  className,
}: MultiSelectChipsFieldProps) {
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const listOptions = useMemo(() => options.map((option) => ({ id: option.value, label: option.label })), [options]);
  // Chips na ordem em que foram escolhidos; label resolvido na hora (a tag pode ter sido renomeada).
  const labelByValue = useMemo(() => new Map(options.map((option) => [option.value, option.label])), [options]);

  const toggle = (id: string) => {
    onChange(selectedSet.has(id) ? selectedIds.filter((selected) => selected !== id) : [...selectedIds, id]);
  };

  const buttonLabel = selectedIds.length === 0 ? placeholder : `${selectedIds.length} ${selectedIds.length === 1 ? itemLabel.one : itemLabel.many}`;

  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <FilterListPopover
        options={listOptions}
        selectedIds={selectedSet}
        onSelect={toggle}
        searchable={options.length > 5}
        searchPlaceholder={searchPlaceholder}
        emptyMessage={emptyMessage}
        onSelectAll={() => onChange(options.map((option) => option.value))}
        onDeselectAll={() => onChange([])}
        disablePortal={disablePortal}
        disabled={disabled}
        contentClassName="w-[240px]"
        trigger={<FilterSelectButton size={size}>{buttonLabel}</FilterSelectButton>}
      />
      {selectedIds.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selectedIds.map((id) => (
            <span key={id} className="inline-flex max-w-full items-center gap-1 rounded border border-border bg-input-30 py-0.5 pl-1.5 pr-1 text-2xs text-text">
              <span className="truncate">{labelByValue.get(id) ?? id}</span>
              <button type="button" onClick={() => toggle(id)} className="shrink-0 text-muted-foreground transition-colors hover:text-destructive" aria-label={`Remover ${labelByValue.get(id) ?? id}`}>
                <IconX className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
