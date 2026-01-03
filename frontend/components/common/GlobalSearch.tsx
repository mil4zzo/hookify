"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { IconSearch, IconLoader2, IconDeviceTablet, IconPlayCardA, IconBorderAll, IconFolder } from "@tabler/icons-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import { useGlobalSearch } from "@/lib/hooks/useGlobalSearch";
import type { GlobalSearchResult } from "@/lib/api/schemas";

interface GlobalSearchProps {
  isCollapsed?: boolean;
  className?: string;
}

const RESULT_TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  ad_id: IconDeviceTablet,
  ad_name: IconPlayCardA,
  adset_name: IconBorderAll,
  campaign_name: IconFolder,
};

const RESULT_TYPE_TABS: Record<string, "individual" | "por-anuncio" | "por-conjunto" | "por-campanha"> = {
  ad_id: "individual",
  ad_name: "por-anuncio",
  adset_name: "por-conjunto",
  campaign_name: "por-campanha",
};

const RESULT_TYPE_FILTER_COLUMNS: Record<string, string> = {
  ad_id: "ad_id",
  ad_name: "ad_name",
  adset_name: "adset_name",
  campaign_name: "campaign_name",
};

interface SearchResultItemProps {
  result: GlobalSearchResult;
  onClick: () => void;
}

function SearchResultItem({ result, onClick }: SearchResultItemProps) {
  const textRef = useRef<HTMLDivElement>(null);

  return (
    <button
      onClick={onClick}
      className="w-full px-4 py-2 text-left hover:bg-muted transition-colors focus:outline-none focus:bg-muted group"
      onMouseLeave={() => {
        // Resetar scroll ao sair do hover
        if (textRef.current) {
          textRef.current.scrollLeft = 0;
        }
      }}
    >
      <div className="flex items-center gap-3">
        {RESULT_TYPE_ICONS[result.type] && (
          <div className="flex-shrink-0">
            {(() => {
              const Icon = RESULT_TYPE_ICONS[result.type];
              return <Icon className="h-4 w-4 text-muted-foreground" />;
            })()}
          </div>
        )}
        <div className="flex-1 min-w-0 overflow-hidden">
          <div ref={textRef} className="text-sm font-medium text-foreground truncate group-hover:[text-overflow:clip] group-hover:overflow-x-auto group-hover:overflow-y-hidden group-hover:scroll-smooth">
            {result.label}
          </div>
        </div>
      </div>
    </button>
  );
}

export function GlobalSearch({ isCollapsed = false, className }: GlobalSearchProps) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const { data, isLoading } = useGlobalSearch(query, {
    enabled: !isCollapsed,
    limit: 20,
    debounceMs: 300,
  });

  const results = data?.results || [];

  // Fechar dropdown ao clicar fora
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  // Fechar ao pressionar Escape
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
        inputRef.current?.blur();
      }
    };

    if (isOpen) {
      document.addEventListener("keydown", handleEscape);
      return () => document.removeEventListener("keydown", handleEscape);
    }
  }, [isOpen]);

  // Abrir dropdown quando há resultados ou está carregando
  useEffect(() => {
    if (query.trim().length >= 2 && (isLoading || results.length > 0)) {
      setIsOpen(true);
    } else if (query.trim().length === 0) {
      setIsOpen(false);
    }
  }, [query, isLoading, results.length]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
  };

  const handleInputFocus = () => {
    if (query.trim().length >= 2 && results.length > 0) {
      setIsOpen(true);
    }
  };

  const handleResultClick = (result: GlobalSearchResult) => {
    const tab = RESULT_TYPE_TABS[result.type];
    const filterColumn = RESULT_TYPE_FILTER_COLUMNS[result.type];

    if (!tab || !filterColumn) return;

    // Navegar para Manager com query params
    const params = new URLSearchParams({
      tab,
      filter: filterColumn,
      value: result.value,
    });

    router.push(`/manager?${params.toString()}`);
    setIsOpen(false);
    setQuery("");
  };

  // Quando colapsado, mostrar apenas botão
  if (isCollapsed) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className={cn("justify-center h-9 hover:bg-input-30 w-full", className)}
        title="Search"
        onClick={() => {
          // Quando clicar no botão colapsado, não faz nada por enquanto
          // Poderia abrir um modal de busca no futuro
        }}
      >
        <IconSearch className="h-5 w-5 text-muted-foreground" />
      </Button>
    );
  }

  return (
    <div ref={containerRef} className={cn("relative w-full", className)}>
      {/* Search Input */}
      <div className="relative">
        <IconSearch className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input ref={inputRef} type="search" placeholder="Buscar..." value={query} onChange={handleInputChange} onFocus={handleInputFocus} className="pl-9 h-9 bg-input-30 border-border text-text placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-info" />
      </div>

      {/* Dropdown de Resultados */}
      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-popover border border-border rounded-md shadow-lg z-50 max-h-[400px] overflow-y-auto">
          {isLoading && results.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              <IconLoader2 className="h-4 w-4 animate-spin mx-auto mb-2" />
              Buscando...
            </div>
          ) : results.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">Nenhum resultado encontrado</div>
          ) : (
            <div className="py-1">
              {results.map((result, index) => (
                <SearchResultItem key={`${result.type}-${result.value}-${index}`} result={result} onClick={() => handleResultClick(result)} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
