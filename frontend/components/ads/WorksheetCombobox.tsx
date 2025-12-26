"use client";

import { useEffect, useMemo, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IconCheck, IconChevronDown, IconLoader2 } from "@tabler/icons-react";
import { cn } from "@/lib/utils/cn";
import { api } from "@/lib/api/endpoints";
import { WorksheetItem } from "@/lib/api/schemas";
import { AppError } from "@/lib/utils/errors";
import { handleGoogleAuthError } from "@/lib/utils/googleAuthError";
import { useQuery } from "@tanstack/react-query";

interface WorksheetComboboxProps {
  spreadsheetId?: string;
  value?: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  connectionId?: string;
  active?: boolean;
}

export function WorksheetCombobox({ spreadsheetId, value, onValueChange, placeholder = "Selecione uma aba...", className, disabled = false, connectionId, active = true }: WorksheetComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const {
    data,
    isLoading,
    error: queryError,
  } = useQuery({
    queryKey: ["google-worksheets", connectionId, spreadsheetId],
    enabled: open && !!spreadsheetId && !disabled,
    retry: 0,
    queryFn: async () => {
      try {
        const res = await api.integrations.google.listWorksheets(spreadsheetId as string, connectionId);
        return res.worksheets || [];
      } catch (err) {
        const appError = err as AppError;
        handleGoogleAuthError(appError, connectionId);
        throw err;
      }
    },
    staleTime: 60_000,
    gcTime: 2 * 60_000,
  });

  // Se trocar a planilha no wizard, limpar a aba selecionada (o wizard também faz isso, mas aqui evitamos UI inconsistente)
  useEffect(() => {
    if (!spreadsheetId) {
      onValueChange("");
    }
  }, [spreadsheetId, onValueChange]);

  // Filtrar opções localmente (busca instantânea enquanto digita)
  const options = useMemo(() => {
    const rows = data || [];
    return rows.map((worksheet: WorksheetItem) => ({
      label: worksheet.title,
      value: worksheet.title,
    }));
  }, [data]);

  const filteredOptions = useMemo(() => {
    if (!search) return options;
    const searchLower = search.toLowerCase();
    return options.filter((option) => option.label.toLowerCase().includes(searchLower));
  }, [options, search]);

  const selectedOption = options.find((opt) => opt.value === value);

  // Como worksheetTitle == label, podemos exibir `value` mesmo sem options carregadas
  const displayLabel = selectedOption?.label || value || placeholder;

  // Resetar busca quando fechar
  useEffect(() => {
    if (!open) {
      setSearch("");
    }
  }, [open]);

  // Se o step ficar inativo (wizard mudou de etapa), fechar o popover para não "vazar" UI
  useEffect(() => {
    if (!active && open) {
      setOpen(false);
    }
    if (!active) {
      setSearch("");
    }
  }, [active, open]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} disabled={disabled || !spreadsheetId} className={cn("h-10 w-full items-center justify-between rounded-md border border-border bg-input-30 px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1", className)}>
          <span className="truncate text-left">{displayLabel}</span>
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
              disabled={disabled || !spreadsheetId}
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
            {queryError ? (
              <div className="py-6 px-4 text-center">
                <p className="text-sm text-destructive mb-2">{(queryError as any)?.message || "Erro ao carregar abas. Tente novamente."}</p>
              </div>
            ) : isLoading ? (
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
