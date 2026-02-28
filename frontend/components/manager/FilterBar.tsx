"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { IconX, IconPlus, IconFilter, IconCheck, IconChevronDown } from "@tabler/icons-react";
import type { ColumnFiltersState } from "@tanstack/react-table";
import type { FilterValue, FilterOperator, TextFilterValue, TextFilterOperator, StatusFilterValue } from "@/components/common/ColumnFilter";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Separator } from "@/components/common/Separator";
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
  table: any; // TanStack Table instance
}

const filterOperators: { value: FilterOperator; label: string }[] = [
  { value: ">", label: "Maior que" },
  { value: "<", label: "Menor que" },
  { value: ">=", label: "Maior ou igual" },
  { value: "<=", label: "Menor ou igual" },
];

const textFilterOperators: { value: TextFilterOperator; label: string }[] = [
  { value: "contains", label: "Contém" },
  { value: "not_contains", label: "Não contém" },
  { value: "starts_with", label: "Começa com" },
  { value: "ends_with", label: "Termina com" },
  { value: "equals", label: "Igual a" },
  { value: "not_equals", label: "Diferente de" },
];

// Custom comparison function for React.memo
function arePropsEqual(prev: FilterBarProps, next: FilterBarProps): boolean {
  // ColumnFilters comparison (shallow - reference equality is fine since it's from useState)
  if (prev.columnFilters !== next.columnFilters) return false;

  // FilterableColumns comparison (should be stable from parent's useMemo)
  if (prev.filterableColumns !== next.filterableColumns) return false;

  // Table reference should be stable
  if (prev.table !== next.table) return false;

  // setColumnFilters should be stable (from useState)
  if (prev.setColumnFilters !== next.setColumnFilters) return false;

  return true;
}

export const FilterBar = React.memo(function FilterBar({ columnFilters, setColumnFilters, filterableColumns, table }: FilterBarProps) {
  // Estado local para valores dos inputs (para não aplicar imediatamente)
  const [localInputValues, setLocalInputValues] = useState<Record<string, string>>({});
  const [savedValues, setSavedValues] = useState<Record<string, number | string | null>>({});
  // Estado para controlar o valor do Select de adicionar filtro
  const [selectValue, setSelectValue] = useState<string>("");
  // Key para forçar re-mount do Select após cada seleção (limpa estado interno do Radix)
  const [selectKey, setSelectKey] = useState(0);
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
        // Quando value é null, significa que o filtro está sendo configurado, não que deve limpar o valor salvo
        if (filterValue.value !== null && filterValue.value !== undefined) {
          setSavedValues((prev) => ({
            ...prev,
            [filter.id]: filterValue.value,
          }));
        }
      }
    });
  }, [columnFilters]);

  const handleRemoveFilter = (filterInstanceId: string) => {
    setColumnFilters((prev) => prev.filter((f) => f.id !== filterInstanceId));
    // A sincronização com a tabela é feita pelo ManagerTable via useEffect
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
    setSelectKey((prev) => prev + 1);
  };

  const handleAddFilter = (columnId: string) => {
    const filterableColumn = filterableColumns.find((c) => c.id === columnId);
    if (!filterableColumn) return;

    const filterValue = filterableColumn.isStatus ? ({ selectedStatuses: STATUS_OPTIONS.map((o) => o.value) } as StatusFilterValue) : filterableColumn.isText ? ({ operator: "contains", value: null } as TextFilterValue) : ({ operator: ">", value: null } as FilterValue);

    const uniqueId = `${columnId}__${Date.now()}`;
    setColumnFilters((prev) => [...prev, { id: uniqueId, value: filterValue }]);
    setSelectValue("");
    setSelectKey((prev) => prev + 1);
  };

  // Todas as colunas filtráveis sempre disponíveis (permite múltiplos filtros por coluna)
  const availableColumns = useMemo(() => filterableColumns, [filterableColumns]);

  // Focar no input quando um novo filtro é criado (value === null)
  useEffect(() => {
    activeFilters.forEach((filter) => {
      const filterValue = filter.value as FilterValue | TextFilterValue;
      // Só focar se o filtro tem value === null E ainda não foi focado
      if (filterValue && filterValue.value === null && !focusedFilters.current.has(filter.id)) {
        // Marcar como focado antes de focar
        focusedFilters.current.add(filter.id);
        // Novo filtro criado, focar no input após renderização
        setTimeout(() => {
          const input = inputRefs.current[filter.id];
          if (input) {
            input.focus();
            input.select(); // Selecionar o texto para facilitar substituição
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

  return (
    <>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-muted-foreground whitespace-nowrap">{activeFilters.length > 0 ? "Filtrando por" : "Nenhum filtro aplicado"}</span>
          {activeFilters.map((filter) => {
            const column = filterableColumns.find((c) => c.id === getColumnId(filter.id));
            if (!column) return null;

            // RENDERIZAÇÃO DE FILTRO DE STATUS (multi-select)
            if (column.isStatus) {
              const statusFilterValue = filter.value as StatusFilterValue;
              if (!statusFilterValue) return null;

              const handleToggleStatus = (statusValue: string) => {
                const currentSelected = statusFilterValue.selectedStatuses || [];
                const newSelected = currentSelected.includes(statusValue) ? currentSelected.filter((s) => s !== statusValue) : [...currentSelected, statusValue];

                const newFilterValue: StatusFilterValue = { selectedStatuses: newSelected };

                setColumnFilters((prev) => {
                  const existingIndex = prev.findIndex((f) => f.id === filter.id);
                  const newFilter = { id: filter.id, value: newFilterValue };
                  if (existingIndex >= 0) {
                    const updated = [...prev];
                    updated[existingIndex] = newFilter;
                    return updated;
                  }
                  return [...prev, newFilter];
                });
              };

              const selectedCount = statusFilterValue.selectedStatuses?.length ?? 0;
              const allSelected = selectedCount === STATUS_OPTIONS.length;
              const selectedLabels = STATUS_OPTIONS.filter((o) => statusFilterValue.selectedStatuses?.includes(o.value)).map((o) => o.label);

              return (
                <Badge key={filter.id} variant="outline" className="inline-flex items-center gap-1.5 px-2 py-1 h-8 text-xs font-medium bg-card border-border hover:bg-muted">
                  <IconFilter className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                  <Popover>
                    <PopoverTrigger asChild>
                      <button className="flex items-center gap-1 text-foreground hover:text-foreground/80 transition-colors">
                        <span className="whitespace-nowrap">{allSelected ? "Status: Todos" : selectedCount === 0 ? "Status: Nenhum" : `Status: ${selectedLabels.join(", ")}`}</span>
                        <IconChevronDown className="w-3 h-3 text-muted-foreground" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-auto min-w-[160px] p-2">
                      <div className="flex flex-col gap-1">
                        {STATUS_OPTIONS.map((option) => {
                          const isChecked = statusFilterValue.selectedStatuses?.includes(option.value) ?? false;
                          return (
                            <button key={option.value} onClick={() => handleToggleStatus(option.value)} className="flex items-center gap-2 px-2 py-1.5 text-xs rounded-md hover:bg-muted transition-colors text-left">
                              <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${isChecked ? "bg-primary border-primary" : "border-border"}`}>{isChecked && <IconCheck className="w-3 h-3 text-primary-foreground" />}</div>
                              <span>{option.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </PopoverContent>
                  </Popover>
                  <button onClick={() => handleRemoveFilter(filter.id)} className="ml-1 hover:bg-muted rounded-full p-0.5 transition-colors flex-shrink-0" aria-label="Remover filtro Status">
                    <IconX className="w-3 h-3 text-muted-foreground hover:text-foreground" />
                  </button>
                </Badge>
              );
            }

            // Detectar se é filtro de texto ou numérico
            const isTextFilter = column.isText;

            // RENDERIZAÇÃO DE FILTRO DE TEXTO
            if (isTextFilter) {
              const textFilterValue = filter.value as TextFilterValue;
              if (!textFilterValue) return null;

              const handleOperatorChange = (newOperator: string) => {
                const newFilterValue: TextFilterValue = {
                  operator: newOperator as TextFilterOperator,
                  value: textFilterValue.value,
                };

                setColumnFilters((prev) => {
                  const existingIndex = prev.findIndex((f) => f.id === filter.id);
                  const newFilter = {
                    id: filter.id,
                    value: newFilterValue,
                  };

                  if (existingIndex >= 0) {
                    const updated = [...prev];
                    updated[existingIndex] = newFilter;
                    return updated;
                  } else {
                    return [...prev, newFilter];
                  }
                });
              };

              const savedValue = savedValues[filter.id] !== undefined ? savedValues[filter.id] : textFilterValue.value;

              const applyFilterValue = (inputValue: string) => {
                const trimmedValue = inputValue.trim();
                const textValue = trimmedValue !== "" ? trimmedValue : null;

                setColumnFilters((prev) => {
                  const existingIndex = prev.findIndex((f) => f.id === filter.id);
                  const newFilter = {
                    id: filter.id,
                    value: {
                      operator: textFilterValue.operator,
                      value: textValue,
                    } as TextFilterValue,
                  };

                  if (existingIndex >= 0) {
                    const updated = [...prev];
                    updated[existingIndex] = newFilter;
                    return updated;
                  } else {
                    return [...prev, newFilter];
                  }
                });

                setSavedValues((prev) => ({
                  ...prev,
                  [filter.id]: textValue,
                }));

                setLocalInputValues((prev) => {
                  const updated = { ...prev };
                  delete updated[filter.id];
                  return updated;
                });
              };

              const cancelEdit = () => {
                setLocalInputValues((prev) => {
                  const updated = { ...prev };
                  delete updated[filter.id];
                  return updated;
                });
              };

              const handleValueChange = (e: React.ChangeEvent<HTMLInputElement>) => {
                setLocalInputValues((prev) => ({
                  ...prev,
                  [filter.id]: e.target.value,
                }));
              };

              const handleValueBlur = () => {
                cancelEdit();
              };

              const handleValueKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const currentInputValue = localInputValues[filter.id] ?? "";
                  applyFilterValue(currentInputValue);
                  e.currentTarget.blur();
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  cancelEdit();
                  e.currentTarget.blur();
                }
              };

              const displayValue = localInputValues[filter.id] !== undefined ? localInputValues[filter.id] : savedValue !== null && savedValue !== undefined ? String(savedValue) : "";

              const hasUnsavedChanges = (() => {
                if (localInputValues[filter.id] === undefined) return false;
                const localValue = localInputValues[filter.id].trim();
                const savedValueStr = savedValue !== null && savedValue !== undefined ? String(savedValue) : "";
                return localValue !== savedValueStr;
              })();

              return (
                <Badge key={filter.id} variant="outline" className="inline-flex items-center gap-1.5 px-2 py-1 h-8 text-xs font-medium bg-card border-border hover:bg-muted">
                  <IconFilter className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                  <span className="text-foreground whitespace-nowrap">{column.label}</span>

                  <Select value={textFilterValue.operator} onValueChange={handleOperatorChange}>
                    <SelectTrigger className="h-6 px-2 py-0 text-xs border-0 bg-transparent hover:bg-muted/50 focus:ring-0 focus:ring-offset-0 w-fit h-auto gap-1.5">
                      <SelectValue className="text-xs" />
                    </SelectTrigger>
                    <SelectContent disablePortal={true}>
                      {textFilterOperators.map((op) => (
                        <SelectItem key={op.value} value={op.value}>
                          {op.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Input
                    ref={(el) => {
                      inputRefs.current[filter.id] = el;
                    }}
                    type="text"
                    value={displayValue}
                    onChange={handleValueChange}
                    onBlur={handleValueBlur}
                    onKeyDown={handleValueKeyDown}
                    placeholder="Texto..."
                    className="h-6 min-w-0 w-32 px-2 py-0 text-xs border-0 bg-transparent hover:bg-muted/50 focus-visible:ring-1 focus-visible:ring-info focus-visible:ring-offset-0"
                    onClick={(e) => e.stopPropagation()}
                  />

                  {hasUnsavedChanges ? (
                    <button
                      onMouseDown={(e) => {
                        e.preventDefault();
                        const currentInputValue = localInputValues[filter.id] ?? "";
                        applyFilterValue(currentInputValue);
                      }}
                      className="ml-1 hover:bg-green-600 rounded-full p-0.5 transition-colors flex-shrink-0 bg-green-500"
                      aria-label={`Aplicar filtro ${column.label}`}
                    >
                      <IconCheck className="w-3 h-3 text-white" />
                    </button>
                  ) : (
                    <button onClick={() => handleRemoveFilter(filter.id)} className="ml-1 hover:bg-muted rounded-full p-0.5 transition-colors flex-shrink-0" aria-label={`Remover filtro ${column.label}`}>
                      <IconX className="w-3 h-3 text-muted-foreground hover:text-foreground" />
                    </button>
                  )}
                </Badge>
              );
            }

            // RENDERIZAÇÃO DE FILTRO NUMÉRICO (código original)
            const numericFilterValue = filter.value as FilterValue;
            if (!numericFilterValue) return null;

            const handleOperatorChange = (newOperator: string) => {
              const newFilterValue: FilterValue = {
                operator: newOperator as FilterOperator,
                value: numericFilterValue.value,
              };

              setColumnFilters((prev) => {
                const existingIndex = prev.findIndex((f) => f.id === filter.id);
                const newFilter = {
                  id: filter.id,
                  value: newFilterValue,
                };

                if (existingIndex >= 0) {
                  const updated = [...prev];
                  updated[existingIndex] = newFilter;
                  return updated;
                } else {
                  return [...prev, newFilter];
                }
              });
            };

            // Valor salvo atual (para comparação)
            // Priorizar savedValues, mas se não existir, usar filterValue.value diretamente
            const savedValue = savedValues[filter.id] !== undefined ? savedValues[filter.id] : numericFilterValue.value;

            // Função para aplicar o valor do filtro
            const applyFilterValue = (inputValue: string) => {
              let numericValue: number | null = null;

              if (inputValue.trim() !== "") {
                const parsed = parseFloat(inputValue.replace(",", "."));
                if (!isNaN(parsed) && isFinite(parsed)) {
                  // Para porcentagens: limitar entre 0.00 e 100.00
                  // Para outras métricas: apenas garantir que seja >= 0 (sem limite superior)
                  const clampedValue = column.isPercentage ? Math.max(0, Math.min(100, parsed)) : Math.max(0, parsed);
                  // Arredondar para 2 casas decimais
                  const roundedValue = Math.round(clampedValue * 100) / 100;
                  // Se for porcentagem, normalizar para decimal (usuário digita 25, armazenamos 0.25)
                  numericValue = column.isPercentage ? roundedValue / 100 : roundedValue;
                }
              }

              setColumnFilters((prev) => {
                const existingIndex = prev.findIndex((f) => f.id === filter.id);
                const newFilter = {
                  id: filter.id,
                  value: {
                    operator: numericFilterValue.operator,
                    value: numericValue,
                  } as FilterValue,
                };

                if (existingIndex >= 0) {
                  const updated = [...prev];
                  updated[existingIndex] = newFilter;
                  return updated;
                } else {
                  return [...prev, newFilter];
                }
              });

              setSavedValues((prev) => ({
                ...prev,
                [filter.id]: numericValue,
              }));

              // Limpar valor local (volta ao estado salvo)
              setLocalInputValues((prev) => {
                const updated = { ...prev };
                delete updated[filter.id];
                return updated;
              });
            };

            // Função para cancelar edição (voltar ao valor salvo)
            const cancelEdit = () => {
              setLocalInputValues((prev) => {
                const updated = { ...prev };
                delete updated[filter.id];
                return updated;
              });
            };

            const handleValueChange = (e: React.ChangeEvent<HTMLInputElement>) => {
              let inputValue = e.target.value;

              // Permitir apenas números (0-9) e separadores decimais ("," ou ".")
              // Remover qualquer caractere que não seja número ou separador decimal
              inputValue = inputValue.replace(/[^0-9,.]/g, "");

              // Converter ponto para vírgula (padrão brasileiro)
              inputValue = inputValue.replace(/\./g, ",");

              // Garantir que há no máximo um separador decimal
              const parts = inputValue.split(",");
              if (parts.length > 2) {
                // Se houver mais de uma vírgula, manter apenas a primeira
                inputValue = parts[0] + "," + parts.slice(1).join("");
              }

              // Limitar a 2 casas decimais
              const decimalIndex = inputValue.indexOf(",");
              if (decimalIndex !== -1) {
                const integerPart = inputValue.substring(0, decimalIndex);
                const decimalPart = inputValue.substring(decimalIndex + 1);
                // Limitar a parte decimal a 2 dígitos
                const limitedDecimalPart = decimalPart.substring(0, 2);
                inputValue = integerPart + "," + limitedDecimalPart;
              }

              // Validar valor: sempre >= 0, e para porcentagens também <= 100
              if (inputValue.trim() !== "") {
                const parsed = parseFloat(inputValue.replace(",", "."));
                if (!isNaN(parsed) && isFinite(parsed)) {
                  if (parsed < 0) {
                    inputValue = "0";
                  } else if (column.isPercentage && parsed > 100) {
                    // Apenas porcentagens têm limite superior de 100
                    inputValue = "100";
                  }
                }
              }

              // Atualizar apenas o estado local (não aplicar o filtro ainda)
              setLocalInputValues((prev) => ({
                ...prev,
                [filter.id]: inputValue,
              }));
            };

            const handleValueBlur = () => {
              // Cancelar edição quando perder o foco (voltar ao valor salvo)
              cancelEdit();
            };

            const handleValueKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
              // Aplicar o filtro quando pressionar Enter
              if (e.key === "Enter") {
                e.preventDefault();
                const currentInputValue = localInputValues[filter.id] ?? "";
                applyFilterValue(currentInputValue);
                e.currentTarget.blur();
              }
              // Cancelar edição quando pressionar Escape
              if (e.key === "Escape") {
                e.preventDefault();
                cancelEdit();
                e.currentTarget.blur();
              }
            };

            // Valor para exibir no input (usar estado local se disponível, senão usar valor salvo)
            // Sempre usar vírgula como separador decimal (padrão brasileiro)
            const formatValueWithComma = (value: number) => {
              return value.toFixed(2).replace(".", ",");
            };
            const displayValue = localInputValues[filter.id] !== undefined ? localInputValues[filter.id] : savedValue !== null && savedValue !== undefined ? (column.isPercentage ? formatValueWithComma(Number(savedValue) * 100) : formatValueWithComma(Number(savedValue))) : "";

            // Verificar se há mudança não salva
            const hasUnsavedChanges = (() => {
              if (localInputValues[filter.id] === undefined) return false;
              const localValue = localInputValues[filter.id];
              if (localValue.trim() === "") {
                return savedValue !== null;
              }
              const parsed = parseFloat(localValue.replace(",", "."));
              if (isNaN(parsed) || !isFinite(parsed) || parsed < 0) return false;
              const numericValue = column.isPercentage ? parsed / 100 : parsed;
              return numericValue !== savedValue;
            })();

            // Placeholder
            const placeholder = "Valor...";

            return (
              <Badge key={filter.id} variant="outline" className="inline-flex items-center gap-1.5 px-2 py-1 h-8 text-xs font-medium bg-card border-border hover:bg-muted">
                <IconFilter className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                <span className="text-foreground whitespace-nowrap">{column.label}</span>

                <Select value={numericFilterValue.operator} onValueChange={handleOperatorChange}>
                  <SelectTrigger className="h-6 px-2 py-0 text-xs border-0 bg-transparent hover:bg-muted/50 focus:ring-0 focus:ring-offset-0 w-fit h-auto gap-1.5">
                    <SelectValue className="text-xs" />
                  </SelectTrigger>
                  <SelectContent disablePortal={true}>
                    {filterOperators.map((op) => (
                      <SelectItem key={op.value} value={op.value}>
                        {op.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <div className="flex items-center gap-0.5">
                  <Input
                    ref={(el) => {
                      inputRefs.current[filter.id] = el;
                    }}
                    type="text"
                    value={displayValue}
                    onChange={handleValueChange}
                    onBlur={handleValueBlur}
                    onKeyDown={handleValueKeyDown}
                    placeholder={placeholder}
                    className="h-6 min-w-0 w-16 px-2 py-0 text-xs border-0 bg-transparent hover:bg-muted/50 focus-visible:ring-1 focus-visible:ring-info focus-visible:ring-offset-0 [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none [-moz-appearance:textfield]"
                    onClick={(e) => e.stopPropagation()}
                  />
                  {column.isPercentage && <span className="text-muted-foreground text-xs">%</span>}
                </div>

                {hasUnsavedChanges ? (
                  <button
                    onMouseDown={(e) => {
                      // Prevenir que o blur do input seja disparado antes do clique
                      e.preventDefault();
                      const currentInputValue = localInputValues[filter.id] ?? "";
                      applyFilterValue(currentInputValue);
                    }}
                    className="ml-1 hover:bg-green-600 rounded-full p-0.5 transition-colors flex-shrink-0 bg-green-500"
                    aria-label={`Aplicar filtro ${column.label}`}
                  >
                    <IconCheck className="w-3 h-3 text-white" />
                  </button>
                ) : (
                  <button onClick={() => handleRemoveFilter(filter.id)} className="ml-1 hover:bg-muted rounded-full p-0.5 transition-colors flex-shrink-0" aria-label={`Remover filtro ${column.label}`}>
                    <IconX className="w-3 h-3 text-muted-foreground hover:text-foreground" />
                  </button>
                )}
              </Badge>
            );
          })}
        </div>

        {availableColumns.length > 0 && (
          <Select key={selectKey} value={selectValue || undefined} onValueChange={handleAddFilter}>
            <SelectTrigger className="h-8 w-auto border-border bg-input-30 px-3">
              <div className="flex items-center gap-1.5">
                <IconPlus className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-xs">Add filter</span>
              </div>
            </SelectTrigger>
            <SelectContent disablePortal={true}>
              {availableColumns.map((col) => (
                <SelectItem key={col.id} value={col.id}>
                  {col.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      <Separator vertical="md" />
    </>
  );
}, arePropsEqual);
