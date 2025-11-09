"use client";

import * as React from "react";
import { IconCheck, IconChevronDown } from "@tabler/icons-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils/cn";

interface ComboboxProps {
  value?: string;
  onValueChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  className?: string;
}

export function Combobox({
  value,
  onValueChange,
  options,
  placeholder = "Selecione...",
  searchPlaceholder = "Buscar...",
  emptyMessage = "Nenhum resultado encontrado.",
  className,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");

  const filteredOptions = React.useMemo(() => {
    if (!search) return options;
    const searchLower = search.toLowerCase();
    return options.filter(
      (option) =>
        option.label.toLowerCase().includes(searchLower) ||
        option.value.toLowerCase().includes(searchLower)
    );
  }, [options, search]);

  const selectedOption = options.find((opt) => opt.value === value);

  // Resetar busca quando fechar
  React.useEffect(() => {
    if (!open) {
      setSearch("");
    }
  }, [open]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "h-10 w-full items-center justify-between rounded-md border border-border bg-input-30 px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1",
            className
          )}
        >
          <span className="truncate text-left">
            {selectedOption ? selectedOption.label : placeholder}
          </span>
          <IconChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0 z-[10000] rounded-md border border-border bg-secondary text-text shadow-md"
        align="start"
        sideOffset={4}
      >
        <div className="flex flex-col">
          <div className="border-b border-border p-2">
            <Input
              placeholder={searchPlaceholder}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9"
              onKeyDown={(e) => {
                // Prevenir que Enter feche o popover
                if (e.key === "Enter") {
                  e.preventDefault();
                  // Se houver apenas uma opção filtrada, selecionar ela
                  if (filteredOptions.length === 1) {
                    onValueChange(filteredOptions[0].value);
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
          <div className="max-h-[300px] overflow-y-auto custom-scrollbar">
            {filteredOptions.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                {emptyMessage}
              </div>
            ) : (
              <div className="p-1">
                {filteredOptions.map((option) => {
                  const isSelected = value === option.value;
                  return (
                    <button
                      key={option.value}
                      onClick={() => {
                        // Garantir que o valor existe na lista original
                        const isValid = options.some((opt) => opt.value === option.value);
                        if (isValid) {
                          onValueChange(option.value);
                          setOpen(false);
                        }
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
                      {option.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

