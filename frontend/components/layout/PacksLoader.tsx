"use client"

import { useFiltersUserScope } from '@/lib/hooks/useFiltersUserScope'
import { useLoadPacks } from '@/lib/hooks/useLoadPacks'
import { usePackRefreshSync } from '@/lib/hooks/usePackRefreshSync'
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
  // Antes de qualquer leitura de packs: apontar os filtros para a chave do
  // usuário logado, senão a seleção de um vaza para o outro no mesmo navegador.
  useFiltersUserScope()
  const { isLoading } = useLoadPacks()
  // useLoadPacks lê os packs uma vez por carregamento de página; isto mantém vivo
  // o "outro membro está atualizando" sem reler o resto do pack.
  usePackRefreshSync()
  return <PacksLoadingContext.Provider value={{ isLoading }}>{children}</PacksLoadingContext.Provider>
}


