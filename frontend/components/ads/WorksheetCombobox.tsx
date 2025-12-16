"use client";

import { useEffect, useState, useCallback } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IconCheck, IconChevronDown, IconLoader2 } from "@tabler/icons-react";
import { cn } from "@/lib/utils/cn";
import { api } from "@/lib/api/endpoints";
import { WorksheetItem } from "@/lib/api/schemas";

interface WorksheetComboboxProps {
  spreadsheetId?: string;
  value?: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export function WorksheetCombobox({ spreadsheetId, value, onValueChange, placeholder = "Selecione uma aba...", className, disabled = false }: WorksheetComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<Array<{ label: string; value: string }>>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Carregar abas quando abrir e tiver spreadsheetId
  const loadWorksheets = useCallback(async () => {
    if (!spreadsheetId) {
      setOptions([]);
      return;
    }

    setIsLoading(true);
    try {
      const res = await api.integrations.google.listWorksheets(spreadsheetId);
      const newOptions = res.worksheets.map((worksheet: WorksheetItem) => ({
        label: worksheet.title,
        value: worksheet.title,
      }));
      setOptions(newOptions);
    } catch (error) {
      console.error("Erro ao carregar abas:", error);
      setOptions([]);
    } finally {
      setIsLoading(false);
    }
  }, [spreadsheetId]);

  // Carregar abas quando abrir o popover e tiver spreadsheetId
  useEffect(() => {
    if (open && spreadsheetId) {
      loadWorksheets();
    }
  }, [open, spreadsheetId, loadWorksheets]);

  // Limpar seleção quando spreadsheetId mudar
  useEffect(() => {
    if (!spreadsheetId) {
      setOptions([]);
      onValueChange("");
    }
  }, [spreadsheetId, onValueChange]);

  // Filtrar opções localmente (busca instantânea enquanto digita)
  const filteredOptions = options.filter((option) => {
    if (!search) return true;
    const searchLower = search.toLowerCase();
    return option.label.toLowerCase().includes(searchLower) || option.value.toLowerCase().includes(searchLower);
  });

  const selectedOption = options.find((opt) => opt.value === value);

  // Resetar busca quando fechar
  useEffect(() => {
    if (!open) {
      setSearch("");
    }
  }, [open]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} disabled={disabled || !spreadsheetId} className={cn("h-10 w-full items-center justify-between rounded-md border border-border bg-input-30 px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1", className)}>
          <span className="truncate text-left">{selectedOption ? selectedOption.label : placeholder}</span>
          <IconChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0 z-[10000] rounded-md border border-border bg-secondary text-text shadow-md" align="start" sideOffset={4}>
        <div className="flex flex-col">
          <div className="border-b border-border p-2">
            <Input
              placeholder="Buscar aba por nome..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (filteredOptions.length === 1) {
                    onValueChange(filteredOptions[0].value);
                    setOpen(false);
                  }
                }
                if (e.key === "Escape") {
                  setOpen(false);
                }
              }}
              onClick={(e) => {
                e.stopPropagation();
              }}
              autoFocus
            />
          </div>
          <div className="max-h-[300px] overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center gap-2 py-6">
                <IconLoader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm text-muted-foreground">Carregando abas...</span>
              </div>
            ) : !isLoading && filteredOptions.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">{!spreadsheetId ? "Selecione uma planilha primeiro." : search ? "Nenhuma aba encontrada." : "Nenhuma aba disponível."}</div>
            ) : (
              <div className="p-1">
                {filteredOptions.map((option) => {
                  const isSelected = value === option.value;
                  return (
                    <button
                      key={option.value}
                      onClick={() => {
                        onValueChange(option.value);
                        setOpen(false);
                      }}
                      className={cn("relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 hover:bg-accent hover:text-accent-foreground", isSelected && "bg-accent")}
                    >
                      <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
                        <IconCheck className={cn("h-4 w-4", isSelected ? "opacity-100" : "opacity-0")} />
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
