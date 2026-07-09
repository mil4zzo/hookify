"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Store de hover de barra do sparkline, escopado por linha (rowKey).
 *
 * Objetivo: quando o usuário passa o mouse numa barra (dia) de QUALQUER coluna,
 * todas as outras colunas da MESMA linha reagem (fade + troca do valor exibido
 * pelo valor daquele dia). A única coisa compartilhada entre colunas é um número:
 * o índice do dia em hover.
 *
 * Por que um store externo indexado por rowKey (e não Context/prop):
 * - Não existe wrapper React por linha (flexRender joga as células direto no <tr>).
 * - Um Context global re-renderizaria toda célula visível a cada hover.
 * - Aqui cada MetricCell assina APENAS a sua própria rowKey via useSyncExternalStore,
 *   então só as ~10-14 células daquela linha re-renderizam. Isso também dribla o
 *   React.memo agressivo das células: o re-render é disparado internamente pelo hook,
 *   não por uma prop nova atravessando o comparador.
 */

type HoverState = { rowKey: string; index: number } | null;
type Listener = () => void;

let current: HoverState = null;
const listenersByRow = new Map<string, Set<Listener>>();

function notifyRow(rowKey: string | undefined): void {
  if (!rowKey) return;
  const set = listenersByRow.get(rowKey);
  if (!set) return;
  set.forEach((listener) => listener());
}

/** Marca a barra (dia `index`) da linha `rowKey` como em hover. */
export function setHoveredBar(rowKey: string, index: number): void {
  if (current && current.rowKey === rowKey && current.index === index) return;
  const prevRowKey = current?.rowKey;
  current = { rowKey, index };
  // Se saímos de uma linha diferente sem passar por clear, avisa a antiga também.
  if (prevRowKey && prevRowKey !== rowKey) notifyRow(prevRowKey);
  notifyRow(rowKey);
}

/**
 * Limpa o hover. Se `rowKey` for passado, só limpa quando o hover atual pertence
 * a essa linha (evita corrida quando o mouse já entrou em outra linha).
 */
export function clearHoveredBar(rowKey?: string): void {
  if (!current) return;
  if (rowKey && current.rowKey !== rowKey) return;
  const prevRowKey = current.rowKey;
  current = null;
  notifyRow(prevRowKey);
}

function subscribeRow(rowKey: string, listener: Listener): () => void {
  let set = listenersByRow.get(rowKey);
  if (!set) {
    set = new Set();
    listenersByRow.set(rowKey, set);
  }
  set.add(listener);
  return () => {
    const s = listenersByRow.get(rowKey);
    if (!s) return;
    s.delete(listener);
    if (s.size === 0) listenersByRow.delete(rowKey);
  };
}

function getIndexForRow(rowKey: string): number | null {
  return current && current.rowKey === rowKey ? current.index : null;
}

/** Índice do dia em hover para esta linha, ou null. Re-renderiza só quando muda. */
export function useRowHoveredDay(rowKey: string): number | null {
  const subscribe = useCallback((cb: Listener) => subscribeRow(rowKey, cb), [rowKey]);
  const getSnapshot = useCallback(() => getIndexForRow(rowKey), [rowKey]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
