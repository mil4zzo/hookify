"use client"

import { useEffect } from 'react'
import { useClientAuth } from '@/lib/hooks/useClientSession'
import { bindFiltersToUser } from '@/lib/store/filters'
import { logger } from '@/lib/utils/logger'

/**
 * Amarra os filtros do Topbar (seleção de packs, período, tipo de conversão) ao
 * usuário logado, assim que a sessão do Supabase resolve.
 *
 * Mora no PacksLoader, que embrulha todas as rotas autenticadas, e roda antes
 * de os packs chegarem da API — `useFilters` segura a sincronização até aqui
 * terminar.
 */
export function useFiltersUserScope(): void {
  const { user } = useClientAuth()
  const userId = user?.id ?? null

  useEffect(() => {
    if (!userId) return
    bindFiltersToUser(userId).catch((error) => {
      logger.error('Erro ao amarrar filtros ao usuário:', error)
    })
  }, [userId])
}
