"use client";

import { useCallback, useMemo, useRef, useState } from "react";

export interface MultiSelect {
  /** Seleção crua. Inclui chaves que saíram da lista visível por filtro/busca. */
  selectedKeys: Set<string>;
  selectedCount: number;
  allSelected: boolean;
  /** Há seleção, mas não é tudo — estado "indeterminate" do checkbox de cabeçalho. */
  someSelected: boolean;
  isSelected: (key: string) => boolean;
  /**
   * Seleção intersectada com a lista visível, na ordem da tela. Use quando a ação
   * deve respeitar o filtro atual ou rodar em série (a ordem vira ordem de execução);
   * use `selectedKeys` quando a ação deve atingir tudo que foi marcado.
   */
  selectedInOrder: string[];
  toggleOne: (key: string, checked: boolean) => void;
  toggleAll: (checked: boolean) => void;
  /** onClick do checkbox de linha: mantém a âncora e resolve o intervalo com shift. */
  handleCheckboxClick: (event: React.MouseEvent, key: string) => void;
  clear: () => void;
}

/**
 * Seleção múltipla por Set de chaves, com shift+click para intervalo.
 *
 * `orderedSelectableKeys` é a lista visível (pós-filtro/sort) das chaves que PODEM
 * ser selecionadas, na ordem da tela — é a base do "selecionar todos" e do intervalo.
 *
 * A seleção NÃO é podada quando essa lista muda: filtrar ou buscar não deve descartar
 * silenciosamente o que o usuário já marcou (ele pode limpar a busca e esperar a seleção
 * de volta). Quando o conjunto de dados realmente troca — outro drill, outra entidade,
 * itens deletados — o caller chama `clear()` explicitamente.
 */
export function useMultiSelect(orderedSelectableKeys: string[]): MultiSelect {
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const anchorRef = useRef<string | null>(null);

  const clear = useCallback(() => {
    setSelectedKeys(new Set());
    anchorRef.current = null;
  }, []);

  const toggleOne = useCallback((key: string, checked: boolean) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  const toggleAll = useCallback(
    (checked: boolean) => {
      setSelectedKeys(checked ? new Set(orderedSelectableKeys) : new Set());
      anchorRef.current = null;
    },
    [orderedSelectableKeys],
  );

  const handleCheckboxClick = useCallback(
    (event: React.MouseEvent, key: string) => {
      event.stopPropagation();
      const anchor = anchorRef.current;
      if (event.shiftKey && anchor && anchor !== key) {
        const anchorPos = orderedSelectableKeys.indexOf(anchor);
        const clickedPos = orderedSelectableKeys.indexOf(key);
        if (anchorPos !== -1 && clickedPos !== -1) {
          // Suprime o toggle nativo do Radix (ele checa defaultPrevented) — senão a
          // linha clicada re-alterna por cima do intervalo que acabamos de aplicar.
          event.preventDefault();
          const [start, end] = anchorPos < clickedPos ? [anchorPos, clickedPos] : [clickedPos, anchorPos];
          setSelectedKeys((prev) => {
            const next = new Set(prev);
            const value = !prev.has(key);
            for (let i = start; i <= end; i++) {
              if (value) next.add(orderedSelectableKeys[i]);
              else next.delete(orderedSelectableKeys[i]);
            }
            return next;
          });
          return;
        }
      }
      anchorRef.current = key;
    },
    [orderedSelectableKeys],
  );

  const selectedCount = selectedKeys.size;
  const allSelected = orderedSelectableKeys.length > 0 && orderedSelectableKeys.every((key) => selectedKeys.has(key));
  const someSelected = selectedCount > 0 && !allSelected;

  const isSelected = useCallback((key: string) => selectedKeys.has(key), [selectedKeys]);
  const selectedInOrder = useMemo(() => orderedSelectableKeys.filter((key) => selectedKeys.has(key)), [orderedSelectableKeys, selectedKeys]);

  return { selectedKeys, selectedCount, allSelected, someSelected, isSelected, selectedInOrder, toggleOne, toggleAll, handleCheckboxClick, clear };
}
