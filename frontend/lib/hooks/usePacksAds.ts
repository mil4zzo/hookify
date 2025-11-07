/**
 * Hook para buscar ads de múltiplos packs de forma eficiente
 * Usa useQueries do TanStack Query para buscar múltiplos packs em paralelo
 */

import { useMemo } from 'react'
import { useQueries } from '@tanstack/react-query'
import { api } from '@/lib/api/endpoints'
import * as adsCache from '@/lib/storage/adsCache'
import { queryKeys } from '@/lib/api/hooks'
import { AdsPack } from '@/lib/types'

/**
 * Hook para buscar ads de todos os packs fornecidos
 * Retorna um mapa de packId -> ads e um array com todos os ads combinados
 */
export function usePacksAds(packs: AdsPack[]) {
  // Usar useQueries para buscar múltiplos packs em paralelo (sem violar regras dos hooks)
  const queries = useQueries({
    queries: packs.map((pack) => ({
      queryKey: queryKeys.packAds(pack.id),
      queryFn: async () => {
        if (!pack.id) {
          throw new Error('packId é obrigatório')
        }

        // 1. Verifica cache IndexedDB primeiro
        const cachedResult = await adsCache.getCachedPackAds(pack.id)
        if (cachedResult.success && cachedResult.data && Array.isArray(cachedResult.data)) {
          return cachedResult.data
        }

        // 2. Se não tem cache, busca do Supabase
        const response = await api.analytics.getPack(pack.id, true)
        
        if (!response.success) {
          throw new Error('Falha ao buscar ads do pack')
        }

        const ads = Array.isArray(response.pack?.ads) ? response.pack.ads : []

        // 3. Salva no cache IndexedDB para próximas vezes
        if (ads.length > 0) {
          await adsCache.cachePackAds(pack.id, ads).catch((error) => {
            console.warn('Erro ao salvar ads no cache:', error)
          })
        }

        return ads
      },
      enabled: !!pack.id,
      // Packs só mudam via Ads Loader (criação/refresh/delete), invalidamos manualmente
      staleTime: Infinity,
      gcTime: 30 * 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      refetchOnReconnect: false,
      placeholderData: async () => {
        const cached = await adsCache.getCachedPackAds(pack.id)
        return cached.success ? cached.data : undefined
      },
    })),
  })

  // Mapa de packId -> ads
  const packsAdsMap = useMemo(() => {
    const map = new Map<string, any[]>()
    // Usar os packIds originais para garantir correspondência correta
    const packIds = packs.map(p => p.id)
    queries.forEach((query, index) => {
      const packId = packIds[index]
      // Verificar se query.data existe e é um array
      if (packId && query.data && Array.isArray(query.data)) {
        map.set(packId, query.data)
      }
    })
    return map
  }, [packs, queries])

  // Array com todos os ads combinados
  const allAds = useMemo(() => {
    const ads: any[] = []
    queries.forEach((query) => {
      // Verificar se query.data existe e é um array antes de fazer spread
      if (query.data && Array.isArray(query.data)) {
        ads.push(...query.data)
      }
    })
    return ads
  }, [queries])

  // Verificar se algum está carregando
  const isLoading = queries.some((query) => query.isLoading)

  // Verificar se algum teve erro
  const hasError = queries.some((query) => query.isError)

  return {
    packsAdsMap, // Map<packId, ads[]>
    allAds, // Array com todos os ads combinados
    isLoading,
    hasError,
    // Função helper para obter ads de um pack específico
    getPackAds: (packId: string) => packsAdsMap.get(packId) || [],
  }
}

