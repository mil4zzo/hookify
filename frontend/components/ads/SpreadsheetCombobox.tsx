"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IconCheck, IconChevronDown, IconLoader2 } from "@tabler/icons-react";
import { cn } from "@/lib/utils/cn";
import { api } from "@/lib/api/endpoints";
import { SpreadsheetItem } from "@/lib/api/schemas";

interface SpreadsheetComboboxProps {
  value?: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export function SpreadsheetCombobox({
  value,
  onValueChange,
  placeholder = "Selecione uma planilha...",
  className,
}: SpreadsheetComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<Array<{ label: string; value: string }>>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isLoadingMoreRef = useRef(false);

  // Debounce para busca
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Carregar planilhas
  const loadSpreadsheets = useCallback(
    async (query?: string, pageToken?: string, append = false) => {
      if (isLoadingMoreRef.current) return;
      isLoadingMoreRef.current = true;
      setIsLoading(true);

      try {
        const res = await api.integrations.google.listSpreadsheets({
          query: query || undefined,
          page_size: 20,
          page_token: pageToken || undefined,
        });

        const newOptions = res.spreadsheets.map((sheet: SpreadsheetItem) => ({
          label: sheet.name,
          value: sheet.id,
        }));

        if (append) {
          setOptions((prev) => [...prev, ...newOptions]);
        } else {
          setOptions(newOptions);
        }

        setNextPageToken(res.next_page_token || null);
        setHasMore(!!res.next_page_token);
      } catch (error) {
        console.error("Erro ao carregar planilhas:", error);
      } finally {
        setIsLoading(false);
        isLoadingMoreRef.current = false;
      }
    },
    [],
  );

  // Carregar inicialmente quando abrir
  useEffect(() => {
    if (open && options.length === 0) {
      loadSpreadsheets();
    }
  }, [open, options.length, loadSpreadsheets]);

  // Recarregar quando busca mudar (debounced)
  useEffect(() => {
    if (open && debouncedSearch !== undefined) {
      setNextPageToken(null);
      setHasMore(true);
      loadSpreadsheets(debouncedSearch || undefined, undefined, false);
    }
  }, [debouncedSearch, open, loadSpreadsheets]);

  // Lazy load on scroll
  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const target = e.currentTarget;
      const scrollBottom = target.scrollHeight - target.scrollTop - target.clientHeight;

      // Carregar mais quando estiver a 100px do fim
      if (scrollBottom < 100 && hasMore && nextPageToken && !isLoadingMoreRef.current) {
        loadSpreadsheets(debouncedSearch || undefined, nextPageToken, true);
      }
    },
    [hasMore, nextPageToken, debouncedSearch, loadSpreadsheets],
  );

  // Filtrar opções localmente (busca instantânea enquanto digita)
  const filteredOptions = options.filter((option) => {
    if (!search) return true;
    const searchLower = search.toLowerCase();
    return (
      option.label.toLowerCase().includes(searchLower) ||
      option.value.toLowerCase().includes(searchLower)
    );
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
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "h-10 w-full items-center justify-between rounded-md border border-border bg-input-30 px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1",
            className,
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
              placeholder="Buscar planilha por nome..."
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
          <div
            ref={scrollContainerRef}
            className="max-h-[300px] overflow-y-auto custom-scrollbar"
            onScroll={handleScroll}
          >
            {isLoading && options.length === 0 ? (
              <div className="flex items-center justify-center gap-2 py-6">
                <IconLoader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm text-muted-foreground">Carregando planilhas...</span>
              </div>
            ) : filteredOptions.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                {search ? "Nenhuma planilha encontrada." : "Nenhuma planilha disponível."}
              </div>
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
                      className={cn(
                        "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 hover:bg-accent hover:text-accent-foreground",
                        isSelected && "bg-accent",
                      )}
                    >
                      <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
                        <IconCheck
                          className={cn("h-4 w-4", isSelected ? "opacity-100" : "opacity-0")}
                        />
                      </span>
                      {option.label}
                    </button>
                  );
                })}
                {isLoading && options.length > 0 && (
                  <div className="flex items-center justify-center gap-2 py-2">
                    <IconLoader2 className="h-4 w-4 animate-spin" />
                    <span className="text-xs text-muted-foreground">Carregando mais...</span>
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
