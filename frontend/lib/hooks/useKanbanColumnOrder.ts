"use client";

import { useState, useCallback } from "react";

/**
 * Hook genérico para gerenciar a ordem das colunas de um Kanban com persistência no localStorage.
 * 
 * @template T - Tipo das colunas (ex: string, GemsColumnType)
 * @param storageKey - Chave única para armazenar no localStorage
 * @param defaultOrder - Ordem padrão das colunas
 * @returns Objeto com a ordem atual e função para atualizar
 */
export function useKanbanColumnOrder<T extends string>(
  storageKey: string,
  defaultOrder: readonly T[]
): {
  columnOrder: T[];
  setColumnOrder: (order: T[] | ((prev: T[]) => T[])) => void;
  saveColumnOrder: (order: T[]) => void;
} {
  // Função para carregar ordem do localStorage
  const loadColumnOrder = useCallback((): T[] => {
    if (typeof window === "undefined") {
      return [...defaultOrder];
    }

    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          // Sanitizar: manter apenas valores válidos que estão no defaultOrder
          const sanitized = parsed.filter(
            (value: unknown): value is T =>
              typeof value === "string" && defaultOrder.includes(value as T)
          );
          // Adicionar colunas faltantes do defaultOrder
          const missing = defaultOrder.filter((column) => !sanitized.includes(column));
          return [...sanitized, ...missing];
        }
      }
    } catch (error) {
      console.error(`Erro ao carregar ordem das colunas (${storageKey}):`, error);
    }

    return [...defaultOrder];
  }, [storageKey, defaultOrder]);

  // Função para salvar ordem no localStorage
  const saveColumnOrder = useCallback(
    (order: T[]) => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(order));
      } catch (error) {
        console.error(`Erro ao salvar ordem das colunas (${storageKey}):`, error);
      }
    },
    [storageKey]
  );

  // Estado inicial carregado do localStorage
  const [columnOrder, setColumnOrderState] = useState<T[]>(() => loadColumnOrder());

  // Wrapper para setColumnOrder que também salva no localStorage
  const setColumnOrder = useCallback(
    (orderOrUpdater: T[] | ((prev: T[]) => T[])) => {
      setColumnOrderState((prev) => {
        const newOrder = typeof orderOrUpdater === "function" ? orderOrUpdater(prev) : orderOrUpdater;
        saveColumnOrder(newOrder);
        return newOrder;
      });
    },
    [saveColumnOrder]
  );

  return {
    columnOrder,
    setColumnOrder,
    saveColumnOrder,
  };
}

