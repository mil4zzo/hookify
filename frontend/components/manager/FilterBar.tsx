"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { IconChevronDown, IconFilter, IconPlus, IconTrash } from "@tabler/icons-react";
import type { ColumnFiltersState } from "@tanstack/react-table";
import type { FilterValue, FilterOperator, TextFilterValue, TextFilterOperator, StatusFilterValue } from "@/components/common/ColumnFilter";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { CheckSquare } from "@/components/common/CheckSquare";
import { getColumnId } from "@/lib/utils/columnFilters";

interface FilterableColumn {
  id: string;
  label: string;
  isPercentage?: boolean;
  isText?: boolean;
  isStatus?: boolean;
}

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "ACTIVE", label: "Ativo" },
  { value: "PAUSED", label: "Pausado" },
  { value: "ADSET_PAUSED", label: "Pausado (Conjunto)" },
  { value: "CAMPAIGN_PAUSED", label: "Pausado (Campanha)" },
];

interface FilterBarProps {
  columnFilters: ColumnFiltersState;
  setColumnFilters: React.Dispatch<React.SetStateAction<ColumnFiltersState>>;
  filterableColumns: FilterableColumn[];
  filteredCount?: number;
  totalCount?: number;
  itemLabel?: string;
  /** Renderizado no início da linha de controles (ex.: input de busca). */
  leadingSlot?: React.ReactNode;
  /** Renderizado no fim da linha de controles (ex.: barra de ações em massa). */
  trailingSlot?: React.ReactNode;
}

const filterOperators: { value: FilterOperator; label: string }[] = [
  { value: ">", label: "Maior que" },
  { value: "<", label: "Menor que" },
  { value: ">=", label: "Maior ou igual" },
  { value: "<=", label: "Menor ou igual" },
  { value: "=", label: "Igual a" },
];

const textFilterOperators: { value: TextFilterOperator; label: string }[] = [
  { value: "contains", label: "Contém" },
  { value: "not_contains", label: "Não contém" },
  { value: "starts_with", label: "Começa com" },
  { value: "ends_with", label: "Termina com" },
  { value: "equals", label: "Igual a" },
  { value: "not_equals", label: "Diferente de" },
];

/** Valor default de um filtro recém-criado, conforme o tipo da coluna. */
function defaultFilterValue(column: FilterableColumn): FilterValue | TextFilterValue | StatusFilterValue {
  if (column.isStatus) return { selectedStatuses: STATUS_OPTIONS.map((o) => o.value) } as StatusFilterValue;
  if (column.isText) return { operator: "contains", value: null } as TextFilterValue;
  return { operator: ">", value: null } as FilterValue;
}

// Custom comparison function for React.memo
function arePropsEqual(prev: FilterBarProps, next: FilterBarProps): boolean {
  // ColumnFilters comparison (shallow - reference equality is fine since it's from useState)
  if (prev.columnFilters !== next.columnFilters) return false;

  // FilterableColumns comparison (should be stable from parent's useMemo)
  if (prev.filterableColumns !== next.filterableColumns) return false;

  // setColumnFilters should be stable (from useState)
  if (prev.setColumnFilters !== next.setColumnFilters) return false;

  if (prev.filteredCount !== next.filteredCount) return false;
  if (prev.totalCount !== next.totalCount) return false;
  if (prev.itemLabel !== next.itemLabel) return false;

  // Slots são ReactNodes; comparar por referência (os parents devem memoizá-los).
  if (prev.leadingSlot !== next.leadingSlot) return false;
  if (prev.trailingSlot !== next.trailingSlot) return false;

  return true;
}

/**
 * Barra de filtros da tabela: linha única com busca (leadingSlot), contagem, botão
 * "Filtros (N)" e ações em massa (trailingSlot). Os filtros vivem num popover com linhas
 * verticais [coluna | operador | valor | remover] — mesmo estilo dos filtros do modal de
 * criar packs. O "onde" cada filtro atua é sinalizado pelo funil no header da coluna.
 */
export const FilterBar = React.memo(function FilterBar({ columnFilters, setColumnFilters, filterableColumns, filteredCount, totalCount, itemLabel, leadingSlot, trailingSlot }: FilterBarProps) {
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  // Estado local para valores dos inputs (para não aplicar imediatamente a cada tecla)
  const [localInputValues, setLocalInputValues] = useState<Record<string, string>>({});
  const [savedValues, setSavedValues] = useState<Record<string, number | string | null>>({});
  // Refs para os inputs de cada filtro (para poder focar automaticamente)
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  // Rastrear quais filtros já receberam foco para não focar novamente
  const focusedFilters = useRef<Set<string>>(new Set());

  // Filtros ativos são aqueles que têm um valor FilterValue, TextFilterValue ou StatusFilterValue definido
  const activeFilters = columnFilters.filter((f) => {
    if (!f.value) return false;
    const filterValue = f.value as FilterValue | TextFilterValue | StatusFilterValue;
    if (!filterValue || typeof filterValue !== "object") return false;
    return "operator" in filterValue || "selectedStatuses" in filterValue;
  });

  // Sincronizar valores salvos quando os filtros mudarem externamente
  useEffect(() => {
    columnFilters.forEach((filter) => {
      if (!filter.value) return;
      const filterValue = filter.value as FilterValue | TextFilterValue;
      if (filterValue && typeof filterValue === "object" && "operator" in filterValue) {
        // Só atualizar savedValues se o valor não for null (para não sobrescrever valores válidos)
        if (filterValue.value !== null && filterValue.value !== undefined) {
          setSavedValues((prev) => ({
            ...prev,
            [filter.id]: filterValue.value,
          }));
        }
      }
    });
  }, [columnFilters]);

  const clearFilterLocalState = (filterInstanceId: string) => {
    setSavedValues((prev) => {
      const updated = { ...prev };
      delete updated[filterInstanceId];
      return updated;
    });
    setLocalInputValues((prev) => {
      const updated = { ...prev };
      delete updated[filterInstanceId];
      return updated;
    });
  };

  const handleRemoveFilter = (filterInstanceId: string) => {
    setColumnFilters((prev) => prev.filter((f) => f.id !== filterInstanceId));
    clearFilterLocalState(filterInstanceId);
  };

  const handleClearAllFilters = () => {
    setColumnFilters([]);
    setSavedValues({});
    setLocalInputValues({});
  };

  const handleAddFilter = () => {
    // Default: primeira coluna de texto (ex.: nome) — convida a digitar; senão a primeira disponível.
    const column = filterableColumns.find((c) => c.isText) ?? filterableColumns[0];
    if (!column) return;
    const uniqueId = `${column.id}__${Date.now()}`;
    setColumnFilters((prev) => [...prev, { id: uniqueId, value: defaultFilterValue(column) }]);
  };

  /** Troca a coluna de um filtro existente: substitui a instância preservando a posição. */
  const handleChangeFilterColumn = (filterInstanceId: string, newColumnId: string) => {
    const column = filterableColumns.find((c) => c.id === newColumnId);
    if (!column || getColumnId(filterInstanceId) === newColumnId) return;
    const uniqueId = `${newColumnId}__${Date.now()}`;
    setColumnFilters((prev) => prev.map((f) => (f.id === filterInstanceId ? { id: uniqueId, value: defaultFilterValue(column) } : f)));
    clearFilterLocalState(filterInstanceId);
  };

  // Colunas únicas para o Select de coluna (permite múltiplos filtros por coluna)
  const availableColumns = useMemo(() => filterableColumns, [filterableColumns]);

  // Focar no input quando um novo filtro é criado (value === null)
  useEffect(() => {
    activeFilters.forEach((filter) => {
      const filterValue = filter.value as FilterValue | TextFilterValue;
      if (filterValue && filterValue.value === null && !focusedFilters.current.has(filter.id)) {
        focusedFilters.current.add(filter.id);
        setTimeout(() => {
          const input = inputRefs.current[filter.id];
          if (input) {
            input.focus();
            input.select();
          }
        }, 0);
      }
    });

    // Limpar filtros removidos do Set de focados
    const activeFilterIds = new Set(activeFilters.map((f) => f.id));
    focusedFilters.current.forEach((filterId) => {
      if (!activeFilterIds.has(filterId)) {
        focusedFilters.current.delete(filterId);
      }
    });
  }, [activeFilters]);

  const renderColumnSelect = (filter: { id: string }) => (
    <Select value={getColumnId(filter.id)} onValueChange={(value) => handleChangeFilterColumn(filter.id, value)}>
      <SelectTrigger size="sm" className="w-full">
        <SelectValue placeholder="Coluna" />
      </SelectTrigger>
      <SelectContent disablePortal={true}>
        {availableColumns.map((col) => (
          <SelectItem key={col.id} value={col.id}>
            {col.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const renderRemoveButton = (filterInstanceId: string) => (
    <Button type="button" variant="ghost" size="sm" className="w-8 shrink-0 px-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" onClick={() => handleRemoveFilter(filterInstanceId)} aria-label="Remover filtro">
      <IconTrash className="h-3.5 w-3.5" />
    </Button>
  );

  const renderFilterRow = (filter: (typeof activeFilters)[number]) => {
    const column = filterableColumns.find((c) => c.id === getColumnId(filter.id));
    if (!column) return null;

    // LINHA DE FILTRO DE STATUS (multi-select inline — evita popover aninhado)
    if (column.isStatus) {
      const statusFilterValue = filter.value as StatusFilterValue;
      if (!statusFilterValue) return null;

      const handleToggleStatus = (statusValue: string) => {
        const currentSelected = statusFilterValue.selectedStatuses || [];
        const newSelected = currentSelected.includes(statusValue) ? currentSelected.filter((s) => s !== statusValue) : [...currentSelected, statusValue];
        setColumnFilters((prev) => prev.map((f) => (f.id === filter.id ? { id: filter.id, value: { selectedStatuses: newSelected } as StatusFilterValue } : f)));
      };

      return (
        <div key={filter.id} className="grid grid-cols-12 items-start gap-2">
          <div className="col-span-4">{renderColumnSelect(filter)}</div>
          <div className="col-span-7 flex flex-wrap items-center gap-x-3 gap-y-1 pt-1.5">
            {STATUS_OPTIONS.map((option) => {
              const isChecked = statusFilterValue.selectedStatuses?.includes(option.value) ?? false;
              return (
                <button key={option.value} type="button" onClick={() => handleToggleStatus(option.value)} className="flex items-center gap-1.5 text-xs hover:text-foreground-80 transition-colors">
                  <CheckSquare checked={isChecked} />
                  <span className="whitespace-nowrap">{option.label}</span>
                </button>
              );
            })}
          </div>
          <div className="col-span-1">{renderRemoveButton(filter.id)}</div>
        </div>
      );
    }

    const isTextFilter = column.isText;

    // ---- Handlers comuns de valor (texto e numérico compartilham o fluxo local→aplicar) ----
    const savedValue = savedValues[filter.id] !== undefined ? savedValues[filter.id] : (filter.value as FilterValue | TextFilterValue).value;

    const applyTextValue = (inputValue: string) => {
      const trimmedValue = inputValue.trim();
      const textValue = trimmedValue !== "" ? trimmedValue : null;
      const operator = (filter.value as TextFilterValue).operator;
      setColumnFilters((prev) => prev.map((f) => (f.id === filter.id ? { id: filter.id, value: { operator, value: textValue } as TextFilterValue } : f)));
      setSavedValues((prev) => ({ ...prev, [filter.id]: textValue }));
      setLocalInputValues((prev) => {
        const updated = { ...prev };
        delete updated[filter.id];
        return updated;
      });
    };

    const applyNumericValue = (inputValue: string) => {
      let numericValue: number | null = null;
      if (inputValue.trim() !== "") {
        const parsed = parseFloat(inputValue.replace(",", "."));
        if (!isNaN(parsed) && isFinite(parsed)) {
          // Porcentagens: 0.00–100.00; demais métricas: >= 0 sem teto.
          const clampedValue = column.isPercentage ? Math.max(0, Math.min(100, parsed)) : Math.max(0, parsed);
          const roundedValue = Math.round(clampedValue * 100) / 100;
          // Porcentagem é normalizada para decimal (usuário digita 25, armazenamos 0.25)
          numericValue = column.isPercentage ? roundedValue / 100 : roundedValue;
        }
      }
      const operator = (filter.value as FilterValue).operator;
      setColumnFilters((prev) => prev.map((f) => (f.id === filter.id ? { id: filter.id, value: { operator, value: numericValue } as FilterValue } : f)));
      setSavedValues((prev) => ({ ...prev, [filter.id]: numericValue }));
      setLocalInputValues((prev) => {
        const updated = { ...prev };
        delete updated[filter.id];
        return updated;
      });
    };

    const applyValue = isTextFilter ? applyTextValue : applyNumericValue;

    const cancelEdit = () => {
      setLocalInputValues((prev) => {
        const updated = { ...prev };
        delete updated[filter.id];
        return updated;
      });
    };

    // No popover, blur APLICA (em vez de cancelar): clicar em outro controle do popover não
    // pode descartar o que o usuário digitou. Escape continua cancelando.
    const handleValueBlur = () => {
      const localValue = localInputValues[filter.id];
      if (localValue !== undefined) applyValue(localValue);
    };

    const handleValueKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        applyValue(localInputValues[filter.id] ?? "");
        e.currentTarget.blur();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        cancelEdit();
        e.currentTarget.blur();
      }
    };

    const handleOperatorChange = (newOperator: string) => {
      setColumnFilters((prev) =>
        prev.map((f) => {
          if (f.id !== filter.id) return f;
          const current = f.value as FilterValue | TextFilterValue;
          return { id: f.id, value: { operator: newOperator, value: current.value } as FilterValue | TextFilterValue };
        }),
      );
    };

    // LINHA DE FILTRO DE TEXTO
    if (isTextFilter) {
      const displayValue = localInputValues[filter.id] !== undefined ? localInputValues[filter.id] : savedValue !== null && savedValue !== undefined ? String(savedValue) : "";

      return (
        <div key={filter.id} className="grid grid-cols-12 items-center gap-2">
          <div className="col-span-4">{renderColumnSelect(filter)}</div>
          <div className="col-span-3">
            <Select value={(filter.value as TextFilterValue).operator} onValueChange={handleOperatorChange}>
              <SelectTrigger size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent disablePortal={true}>
                {textFilterOperators.map((op) => (
                  <SelectItem key={op.value} value={op.value}>
                    {op.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-4">
            <Input
              ref={(el) => {
                inputRefs.current[filter.id] = el;
              }}
              size="sm"
              value={displayValue}
              onChange={(e) => setLocalInputValues((prev) => ({ ...prev, [filter.id]: e.target.value }))}
              onBlur={handleValueBlur}
              onKeyDown={handleValueKeyDown}
              placeholder="Texto..."
            />
          </div>
          <div className="col-span-1">{renderRemoveButton(filter.id)}</div>
        </div>
      );
    }

    // LINHA DE FILTRO NUMÉRICO
    const handleNumericChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      let inputValue = e.target.value;
      // Apenas números e separador decimal; ponto vira vírgula (padrão brasileiro)
      inputValue = inputValue.replace(/[^0-9,.]/g, "").replace(/\./g, ",");
      const parts = inputValue.split(",");
      if (parts.length > 2) {
        inputValue = parts[0] + "," + parts.slice(1).join("");
      }
      const decimalIndex = inputValue.indexOf(",");
      if (decimalIndex !== -1) {
        inputValue = inputValue.substring(0, decimalIndex) + "," + inputValue.substring(decimalIndex + 1).substring(0, 2);
      }
      if (inputValue.trim() !== "") {
        const parsed = parseFloat(inputValue.replace(",", "."));
        if (!isNaN(parsed) && isFinite(parsed)) {
          if (parsed < 0) inputValue = "0";
          else if (column.isPercentage && parsed > 100) inputValue = "100";
        }
      }
      setLocalInputValues((prev) => ({ ...prev, [filter.id]: inputValue }));
    };

    const formatValueWithComma = (value: number) => value.toFixed(2).replace(".", ",");
    const displayValue = localInputValues[filter.id] !== undefined ? localInputValues[filter.id] : savedValue !== null && savedValue !== undefined ? (column.isPercentage ? formatValueWithComma(Number(savedValue) * 100) : formatValueWithComma(Number(savedValue))) : "";

    return (
      <div key={filter.id} className="grid grid-cols-12 items-center gap-2">
        <div className="col-span-4">{renderColumnSelect(filter)}</div>
        <div className="col-span-3">
          <Select value={(filter.value as FilterValue).operator} onValueChange={handleOperatorChange}>
            <SelectTrigger size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent disablePortal={true}>
              {filterOperators.map((op) => (
                <SelectItem key={op.value} value={op.value}>
                  {op.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="col-span-4 flex items-center gap-1">
          <Input
            ref={(el) => {
              inputRefs.current[filter.id] = el;
            }}
            size="sm"
            value={displayValue}
            onChange={handleNumericChange}
            onBlur={handleValueBlur}
            onKeyDown={handleValueKeyDown}
            placeholder="Valor..."
            className="[&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none [-moz-appearance:textfield]"
          />
          {column.isPercentage && <span className="text-muted-foreground text-xs">%</span>}
        </div>
        <div className="col-span-1">{renderRemoveButton(filter.id)}</div>
      </div>
    );
  };

  return (
    <div className="flex w-full flex-wrap items-center gap-2">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{leadingSlot}</div>
      <div className="flex flex-shrink-0 flex-wrap items-center gap-3">
        {filteredCount !== undefined && totalCount !== undefined && itemLabel && (
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            Exibindo {filteredCount} de {totalCount} {itemLabel}
          </span>
        )}
        {availableColumns.length > 0 && (
          <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline">
                <IconFilter className="h-4 w-4" />
                <span>Filtros</span>
                {activeFilters.length > 0 && <span className="ml-1 rounded-full bg-primary text-primary-foreground text-xs px-2 py-0.5">{activeFilters.length}</span>}
                <IconChevronDown className="ml-1 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[520px] max-w-[95vw] p-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Filtros</h3>
                  {activeFilters.length > 0 && (
                    <button type="button" onClick={handleClearAllFilters} className="text-xs text-primary hover:underline">
                      Limpar todos
                    </button>
                  )}
                </div>

                {activeFilters.length === 0 ? <p className="text-xs text-muted-foreground">Nenhum filtro ativo. Adicione um filtro para refinar a tabela.</p> : <div className="space-y-2">{activeFilters.map(renderFilterRow)}</div>}

                <Button type="button" variant="outline" size="sm" onClick={handleAddFilter}>
                  <IconPlus className="h-4 w-4 mr-1" />
                  Adicionar filtro
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        )}
        {trailingSlot}
      </div>
    </div>
  );
}, arePropsEqual);
