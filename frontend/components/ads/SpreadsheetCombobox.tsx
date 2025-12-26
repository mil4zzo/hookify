"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IconCheck, IconChevronDown, IconLoader2 } from "@tabler/icons-react";
import { cn } from "@/lib/utils/cn";
import { api } from "@/lib/api/endpoints";
import { SpreadsheetItem } from "@/lib/api/schemas";
import { AppError } from "@/lib/utils/errors";
import { handleGoogleAuthError } from "@/lib/utils/googleAuthError";
import { useInfiniteQuery } from "@tanstack/react-query";

interface SpreadsheetComboboxProps {
  value?: string;
  valueLabel?: string;
  onValueChange: (value: string) => void;
  onValueLabelChange?: (label: string) => void;
  placeholder?: string;
  className?: string;
  connectionId?: string;
  disabled?: boolean;
  active?: boolean;
}

export function SpreadsheetCombobox({ value, valueLabel, onValueChange, onValueLabelChange, placeholder = "Selecione uma planilha...", className, connectionId, disabled = false, active = true }: SpreadsheetComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Debounce para busca
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage, refetch } = useInfiniteQuery({
    queryKey: ["google-spreadsheets", connectionId, debouncedSearch],
    enabled: open && !disabled,
    initialPageParam: undefined as string | undefined,
    retry: 0,
    queryFn: async ({ pageParam }) => {
      try {
        const res = await api.integrations.google.listSpreadsheets({
          query: debouncedSearch || undefined,
          page_size: 20,
          page_token: pageParam,
          connection_id: connectionId || undefined,
        });
        setError(null);
        return res;
      } catch (err) {
        const appError = err as AppError;
        const { shouldReconnect, message } = handleGoogleAuthError(appError, connectionId);
        console.error("Erro ao carregar planilhas:", {
          err,
          shouldReconnect,
          code: appError?.code,
          status: appError?.status,
          details: appError?.details,
        });
        setError(message || "Erro ao carregar planilhas. Tente novamente.");
        throw err;
      }
    },
    getNextPageParam: (lastPage) => lastPage.next_page_token || undefined,
    staleTime: 60_000,
    gcTime: 2 * 60_000,
  });

  const options = useMemo(() => {
    const pages = data?.pages || [];
    const all = pages.flatMap((page) =>
      page.spreadsheets.map((sheet: SpreadsheetItem) => ({
        label: sheet.name,
        value: sheet.id,
      }))
    );
    // dedupe por id (podem ocorrer repetições em edge cases de paginação)
    const seen = new Set<string>();
    return all.filter((opt) => {
      if (seen.has(opt.value)) return false;
      seen.add(opt.value);
      return true;
    });
  }, [data]);

  // Recarregar quando busca mudar (debounced)
  useEffect(() => {
    if (!open) return;
    // React Query já revalida pela queryKey; apenas garantir scroll top
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
  }, [debouncedSearch, open]);

  // Lazy load on scroll
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const scrollBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
    if (scrollBottom < 100 && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  };

  // Filtrar opções localmente (busca instantânea enquanto digita)
  const filteredOptions = options.filter((option) => {
    if (!search) return true;
    const searchLower = search.toLowerCase();
    return option.label.toLowerCase().includes(searchLower) || option.value.toLowerCase().includes(searchLower);
  });

  const selectedOption = options.find((opt) => opt.value === value);

  // Exibir label imediatamente: preferir valueLabel (estado do wizard), depois option carregada, senão placeholder
  const displayLabel = (value && valueLabel) || selectedOption?.label || placeholder;

  // Resetar busca e erro quando fechar
  useEffect(() => {
    if (!open) {
      setSearch("");
      setError(null);
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
        <Button variant="outline" role="combobox" aria-expanded={open} disabled={disabled} className={cn("h-10 w-full items-center justify-between rounded-md border border-border bg-input-30 px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1", className)}>
          <span className="truncate text-left">{displayLabel}</span>
          <IconChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0 z-[10000] rounded-md border border-border bg-secondary text-text shadow-md" align="start" sideOffset={4}>
        <div className="flex flex-col">
          <div className="border-b border-border p-2">
            <Input
              placeholder="Buscar planilha por nome..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9"
              disabled={disabled}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (filteredOptions.length === 1) {
                    onValueChange(filteredOptions[0].value);
                    onValueLabelChange?.(filteredOptions[0].label);
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
          <div ref={scrollContainerRef} className="max-h-[300px] overflow-y-auto" onScroll={handleScroll}>
            {error ? (
              <div className="py-6 px-4 text-center">
                <p className="text-sm text-destructive mb-2">{error}</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setError(null);
                    refetch();
                  }}
                >
                  Tentar novamente
                </Button>
              </div>
            ) : isLoading ? (
              <div className="flex items-center justify-center gap-2 py-6">
                <IconLoader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm text-muted-foreground">Carregando planilhas...</span>
              </div>
            ) : filteredOptions.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">{search ? "Nenhuma planilha encontrada." : "Nenhuma planilha disponível."}</div>
            ) : (
              <div className="p-1">
                {filteredOptions.map((option) => {
                  const isSelected = value === option.value;
                  return (
                    <button
                      key={option.value}
                      onClick={() => {
                        onValueChange(option.value);
                        onValueLabelChange?.(option.label);
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
                {isFetchingNextPage && (
                  <div className="flex items-center justify-center gap-2 py-2">
                    <IconLoader2 className="h-4 w-4 animate-spin" />
                    <span className="text-sm text-muted-foreground">Carregando mais...</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
