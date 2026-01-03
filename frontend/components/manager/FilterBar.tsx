"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { IconX, IconPlus, IconFilter, IconCheck } from "@tabler/icons-react";
import type { ColumnFiltersState } from "@tanstack/react-table";
import type { FilterValue, FilterOperator, TextFilterValue, TextFilterOperator } from "@/components/common/ColumnFilter";
import { Separator } from "@/components/common/Separator";

interface FilterableColumn {
  id: string;
  label: string;
  isPercentage?: boolean;
  isText?: boolean;
}

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
  const [selectValue, setSelectValue] = useState<string | undefined>(undefined);
  // Refs para os inputs de cada filtro (para poder focar automaticamente)
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  // Rastrear quais filtros já receberam foco para não focar novamente
  const focusedFilters = useRef<Set<string>>(new Set());

  // Filtros ativos são aqueles que têm um valor FilterValue ou TextFilterValue definido
  const activeFilters = columnFilters.filter((f) => {
    if (!f.value) return false;
    const filterValue = f.value as FilterValue | TextFilterValue;
    return filterValue && typeof filterValue === "object" && "operator" in filterValue;
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

  const handleRemoveFilter = (columnId: string) => {
    setColumnFilters((prev) => prev.filter((f) => f.id !== columnId));
    // Também limpar o filtro da coluna na tabela
    const column = table.getColumn(columnId);
    if (column) {
      column.setFilterValue(undefined);
    }
    // Limpar estados locais relacionados ao filtro removido
    setSavedValues((prev) => {
      const updated = { ...prev };
      delete updated[columnId];
      return updated;
    });
    setLocalInputValues((prev) => {
      const updated = { ...prev };
      delete updated[columnId];
      return updated;
    });
  };

  const handleAddFilter = (columnId: string) => {
    // Encontrar a coluna na lista de filtráveis para saber o tipo
    const filterableColumn = filterableColumns.find((c) => c.id === columnId);
    const column = table.getColumn(columnId);
    if (column && filterableColumn) {
      // Definir um valor inicial baseado no tipo de coluna
      if (filterableColumn.isText) {
        column.setFilterValue({ operator: "contains", value: null } as TextFilterValue);
      } else {
        column.setFilterValue({ operator: ">", value: null } as FilterValue);
      }
    }
    // Resetar o valor do Select após adicionar o filtro
    setSelectValue(undefined);
  };

  // Colunas disponíveis são aquelas que não têm um filtro FilterValue definido
  // Memoizar para evitar recálculo desnecessário a cada render
  const availableColumns = useMemo(() => {
    return filterableColumns.filter((col) => {
      const hasFilter = columnFilters.some((f) => {
        if (f.id !== col.id) return false;
        if (!f.value) return false;
        const filterValue = f.value as FilterValue | TextFilterValue;
        return filterValue && typeof filterValue === "object" && "operator" in filterValue;
      });
      return !hasFilter;
    });
  }, [filterableColumns, columnFilters]);

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
            const column = filterableColumns.find((c) => c.id === filter.id);
            if (!column) return null;

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

                const tableColumn = table.getColumn(filter.id);
                if (tableColumn) {
                  tableColumn.setFilterValue(newFilterValue);
                }
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

                const tableColumn = table.getColumn(filter.id);
                if (tableColumn) {
                  tableColumn.setFilterValue({
                    operator: textFilterValue.operator,
                    value: textValue,
                  });
                }

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

              // Atualizar o estado dos filtros diretamente
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

              // Também atualizar na coluna da tabela
              const tableColumn = table.getColumn(filter.id);
              if (tableColumn) {
                tableColumn.setFilterValue(newFilterValue);
              }
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
                  // Limitar entre 0.00 e 100.00
                  const clampedValue = Math.max(0, Math.min(100, parsed));
                  // Arredondar para 2 casas decimais
                  const roundedValue = Math.round(clampedValue * 100) / 100;
                  // Se for porcentagem, normalizar para decimal (usuário digita 25, armazenamos 0.25)
                  numericValue = column.isPercentage ? roundedValue / 100 : roundedValue;
                }
              }

              // Atualizar o estado dos filtros diretamente para garantir sincronização
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
                  // Atualizar filtro existente
                  const updated = [...prev];
                  updated[existingIndex] = newFilter;
                  return updated;
                } else {
                  // Adicionar novo filtro
                  return [...prev, newFilter];
                }
              });

              // Também atualizar na coluna da tabela para manter sincronização
              const tableColumn = table.getColumn(filter.id);
              if (tableColumn) {
                tableColumn.setFilterValue({
                  operator: numericFilterValue.operator,
                  value: numericValue,
                });
              }

              // Atualizar valor salvo
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

              // Validar e limitar o valor entre 0.00 e 100.00
              if (inputValue.trim() !== "") {
                const parsed = parseFloat(inputValue.replace(",", "."));
                if (!isNaN(parsed) && isFinite(parsed)) {
                  // Limitar entre 0.00 e 100.00
                  if (parsed < 0) {
                    inputValue = "0";
                  } else if (parsed > 100) {
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
          <Select value={selectValue} onValueChange={handleAddFilter}>
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
