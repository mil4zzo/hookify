"use client";

import { type ReactElement, type ReactNode, useEffect, useMemo, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { IconCheck } from "@tabler/icons-react";
import { cn } from "@/lib/utils/cn";
import { CheckSquare } from "@/components/common/CheckSquare";

export interface FilterListOption {
  id: string;
  label: string;
  /** Conteúdo secundário à direita do label (ex: "(3 anúncios)") */
  meta?: ReactNode;
  /** Não pode ser habilitada (mas pode ser desmarcada se já estiver selecionada) */
  disabled?: boolean;
  /** Sufixo exibido quando desabilitada e não selecionada (ex: " (requer planilha)") */
  disabledHint?: string;
  /** Id do grupo — ver prop `groups` */
  group?: string;
}

export interface FilterListGroup {
  id: string;
  label: string;
  /** Classe do cabeçalho do grupo (ex: "text-primary") */
  labelClassName?: string;
}

export interface FilterListPopoverProps {
  options: FilterListOption[];
  /** Quando presente, as opções são renderizadas em seções na ordem dos grupos */
  groups?: FilterListGroup[];
  /** "multi": toggle com quadradinho, popover fica aberto. "single": check à esquerda, fecha ao selecionar. */
  mode?: "multi" | "single";
  selectedIds: ReadonlySet<string>;
  /** multi: toggle da opção; single: seleção (o popover fecha sozinho) */
  onSelect: (id: string) => void;
  /** Elemento de trigger (recebe as props do PopoverTrigger via asChild) */
  trigger: ReactElement;
  /** Envolve o PopoverTrigger (ex: Tooltip). Recebe o nó pronto do trigger. */
  triggerWrap?: (triggerNode: ReactNode) => ReactNode;
  /** Conteúdo extra acima da busca (ex: ToggleSwitch "Agrupar por packs") */
  header?: ReactNode;
  searchable?: boolean;
  searchPlaceholder?: string;
  emptyMessage?: string;
  /** Bulk (só multi): mostram a barra "Selecionar todos · Limpar  N/M" */
  onSelectAll?: () => void;
  onDeselectAll?: () => void;
  align?: "start" | "center" | "end";
  /** Sobrescreve classes do PopoverContent (default: w-[300px]) */
  contentClassName?: string;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
}

/**
 * Popover genérico de seleção em lista (multi ou single) com busca, atalhos bulk e grupos.
 * Base de GemsColumnFilter, ManagerColumnFilter, PackFilter e ActionTypeFilter — criar
 * novos filtros de lista SEMPRE por aqui, nunca reimplementando popover+lista+checkbox.
 */
export function FilterListPopover({ options, groups, mode = "multi", selectedIds, onSelect, trigger, triggerWrap, header, searchable = false, searchPlaceholder = "Buscar...", emptyMessage = "Nenhum resultado encontrado.", onSelectAll, onDeselectAll, align = "start", contentClassName, onOpenChange, disabled = false }: FilterListPopoverProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  // Reseta a busca ao fechar o popover
  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  const normalizedSearch = search.trim().toLowerCase();
  const filteredOptions = useMemo(() => {
    if (!normalizedSearch) return options;
    return options.filter((option) => option.label.toLowerCase().includes(normalizedSearch) || option.id.toLowerCase().includes(normalizedSearch));
  }, [options, normalizedSearch]);

  const selectedCount = selectedIds.size;
  const totalCount = options.length;
  const showBulkActions = mode === "multi" && totalCount > 1 && (!!onSelectAll || !!onDeselectAll);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };

  const canToggle = (option: FilterListOption) => !option.disabled || selectedIds.has(option.id);

  const handleSelect = (option: FilterListOption) => {
    if (!canToggle(option)) return;
    onSelect(option.id);
    if (mode === "single") handleOpenChange(false);
  };

  const renderOption = (option: FilterListOption) => {
    const isSelected = selectedIds.has(option.id);
    const showDisabledStyle = !!option.disabled && !isSelected;

    if (mode === "single") {
      return (
        <button
          key={option.id}
          type="button"
          onClick={() => handleSelect(option)}
          className={cn(
            "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground hover:bg-accent hover:text-accent-foreground",
            isSelected && "bg-accent",
            showDisabledStyle && "pointer-events-none opacity-50",
          )}
        >
          <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
            <IconCheck className={cn("h-4 w-4", isSelected ? "opacity-100" : "opacity-0")} />
          </span>
          <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
            <span className="truncate text-sm text-left">{option.label}</span>
            {option.meta != null && <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">{option.meta}</span>}
          </div>
        </button>
      );
    }

    return (
      <div
        key={option.id}
        className={cn(
          "relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground",
          isSelected && "bg-accent",
          showDisabledStyle && "opacity-50 cursor-not-allowed hover:bg-transparent hover:text-inherit",
        )}
        onClick={() => handleSelect(option)}
      >
        <div className="flex items-center space-x-2 flex-1 min-w-0">
          <CheckSquare checked={isSelected} />
          <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
            <span className="truncate text-sm">
              {option.label}
              {showDisabledStyle && option.disabledHint ? option.disabledHint : ""}
            </span>
            {option.meta != null && <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">{option.meta}</span>}
          </div>
        </div>
      </div>
    );
  };

  const renderList = () => {
    if (filteredOptions.length === 0) {
      return <div className="py-6 text-center text-sm text-muted-foreground">{emptyMessage}</div>;
    }
    if (groups && groups.length > 0) {
      return (
        <div className="p-1">
          {groups.map((group) => {
            const groupOptions = filteredOptions.filter((option) => option.group === group.id);
            if (groupOptions.length === 0) return null;
            return (
              <div key={group.id} className="mb-1 last:mb-0">
                <div className={cn("px-2 py-1.5 text-xs font-semibold", group.labelClassName)}>{group.label}</div>
                {groupOptions.map(renderOption)}
              </div>
            );
          })}
        </div>
      );
    }
    return (
      <div className="p-1">
        <div className="space-y-1">{filteredOptions.map(renderOption)}</div>
      </div>
    );
  };

  const triggerNode = (
    <PopoverTrigger asChild disabled={disabled}>
      {trigger}
    </PopoverTrigger>
  );

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      {triggerWrap ? triggerWrap(triggerNode) : triggerNode}
      <PopoverContent className={cn("w-[300px] p-0", contentClassName)} align={align} sideOffset={4}>
        {header}
        {searchable && (
          <div className="border-b border-border p-2">
            <Input
              placeholder={searchPlaceholder}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              size="sm"
              onKeyDown={(e) => {
                // Enter com um único resultado seleciona/alterna esse item
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (filteredOptions.length === 1) {
                    const only = filteredOptions[0];
                    if (canToggle(only)) {
                      handleSelect(only);
                      if (mode === "multi") setSearch("");
                    }
                  }
                }
                if (e.key === "Escape") handleOpenChange(false);
              }}
              onClick={(e) => e.stopPropagation()}
              autoFocus
            />
          </div>
        )}
        {showBulkActions && (
          <div className="flex items-center justify-between gap-2 border-b border-border px-2 py-1.5">
            <div className="flex items-center gap-2">
              {onSelectAll && (
                <button type="button" onClick={onSelectAll} disabled={selectedCount === totalCount} className="text-xs font-medium text-text hover:underline disabled:pointer-events-none disabled:opacity-40">
                  Selecionar todos
                </button>
              )}
              {onSelectAll && onDeselectAll && <span className="text-xs text-muted-foreground">·</span>}
              {onDeselectAll && (
                <button type="button" onClick={onDeselectAll} disabled={selectedCount === 0} className="text-xs font-medium text-text hover:underline disabled:pointer-events-none disabled:opacity-40">
                  Limpar
                </button>
              )}
            </div>
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {selectedCount}/{totalCount}
            </span>
          </div>
        )}
        <div className="max-h-[320px] overflow-y-auto">{renderList()}</div>
      </PopoverContent>
    </Popover>
  );
}
