"use client";

import React, { createContext, useContext, useMemo } from "react";

/**
 * Contexto de pack para as operações de tag.
 *
 * A tag vive no silo do pack (migration 139), então toda chamada precisa dizer
 * em qual pack ela acontece — é isso que o backend usa para resolver o dono e
 * conferir o papel do ator.
 *
 * É contexto, e não prop, porque a célula de tags é renderizada lá dentro da
 * fábrica de colunas do TanStack. Passar por prop obrigaria a atravessar
 * `createManagerTableColumns` e a entrar no comparador do memo da tabela — o
 * caminho que já causou célula sem re-render neste projeto.
 */
interface TagScope {
  packIds: string[];
}

const TagScopeContext = createContext<TagScope>({ packIds: [] });

export function TagScopeProvider({
  packIds,
  children,
}: {
  packIds: string[];
  children: React.ReactNode;
}) {
  // A identidade do array vem de `Array.from(Set)` no pai e muda a cada render;
  // estabilizar aqui evita refazer a query de tags à toa.
  const key = packIds.join(",");
  const value = useMemo<TagScope>(() => ({ packIds }), [key]); // eslint-disable-line react-hooks/exhaustive-deps

  return <TagScopeContext.Provider value={value}>{children}</TagScopeContext.Provider>;
}

export function useTagScope(): TagScope {
  return useContext(TagScopeContext);
}
