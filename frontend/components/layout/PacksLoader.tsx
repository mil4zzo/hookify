"use client"

import { useLoadPacks } from '@/lib/hooks/useLoadPacks'
import { createContext, useContext, ReactNode } from 'react'

/**
 * Context para compartilhar estado de loading dos packs
 */
const PacksLoadingContext = createContext<{ isLoading: boolean }>({ isLoading: true })

export function usePacksLoading() {
  return useContext(PacksLoadingContext)
}

/**
 * Componente que dispara o carregamento global de packs e fornece contexto de loading.
 * Deve ser renderizado no layout raiz para cobrir todas as páginas.
 */
export function PacksLoader({ children }: { children: ReactNode }) {
  const { isLoading } = useLoadPacks()
  return <PacksLoadingContext.Provider value={{ isLoading }}>{children}</PacksLoadingContext.Provider>
}


