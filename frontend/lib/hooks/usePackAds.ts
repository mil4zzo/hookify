/**
 * Hook para buscar ads de um pack com cache automático em IndexedDB
 * Usa TanStack Query para cache em memória + IndexedDB para persistência
 */

import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api/endpoints'
import * as adsCache from '@/lib/storage/adsCache'

interface UsePackAdsOptions {
  enabled?: boolean
  ttl?: number // TTL em ms (padrão: 1 hora)
  refetchOnMount?: boolean
}

/**
 * Hook que busca ads de um pack com cache automático
 * 
 * Estratégia:
 * 1. Verifica IndexedDB primeiro (cache persistente)
 * 2. Se não tem cache válido, busca do Supabase
 * 3. Salva no IndexedDB para próximas vezes
 * 4. TanStack Query faz cache em memória também
 */
export function usePackAds(packId: string | null, options: UsePackAdsOptions = {}) {
  const { enabled = true, ttl, refetchOnMount = false } = options

  return useQuery({
    queryKey: ['pack-ads', packId],
    queryFn: async () => {
      if (!packId) {
        throw new Error('packId é obrigatório')
      }

      // 1. Tenta buscar do cache IndexedDB primeiro
      const cached = await adsCache.getCachedPackAds(packId)
      if (cached.success && cached.data) {
        console.log(`[Cache] Ads do pack ${packId} encontrados no cache`)
        return cached.data
      }

      // 2. Se não tem cache válido, busca do Supabase
      console.log(`[Cache] Buscando ads do pack ${packId} do Supabase...`)
      const response = await api.analytics.getPack(packId, true)

      if (!response.success || !response.pack?.ads) {
        throw new Error('Falha ao buscar ads do pack')
      }

      const ads = response.pack.ads

      // 3. Salva no cache IndexedDB para próximas vezes
      await adsCache.cachePackAds(packId, ads, ttl).catch((error) => {
        console.warn(`[Cache] Erro ao salvar cache:`, error)
        // Não falha a query se o cache falhar
      })

      return ads
    },
    enabled: enabled && !!packId,
    staleTime: 5 * 60 * 1000, // 5 minutos - considera dados "frescos" por 5min
    gcTime: 30 * 60 * 1000, // 30 minutos - mantém em memória por 30min
    refetchOnMount: refetchOnMount,
    retry: 2,
  })
}

/**
 * Hook para buscar ads de múltiplos packs simultaneamente
 */
export function useMultiplePackAds(packIds: string[], options: UsePackAdsOptions = {}) {
  const { enabled = true } = options

  return useQuery({
    queryKey: ['multiple-pack-ads', packIds.sort().join(',')],
    queryFn: async () => {
      const results: Record<string, any[]> = {}

      // Busca ads de cada pack em paralelo
      await Promise.all(
        packIds.map(async (packId) => {
          try {
            // Tenta cache primeiro
            const cached = await adsCache.getCachedPackAds(packId)
            if (cached.success && cached.data) {
              results[packId] = cached.data
              return
            }

            // Busca do Supabase
            const response = await api.analytics.getPack(packId, true)
            if (response.success && response.pack?.ads) {
              results[packId] = response.pack.ads
              // Salva no cache
              await adsCache.cachePackAds(packId, response.pack.ads).catch(() => {})
            }
          } catch (error) {
            console.error(`Erro ao buscar ads do pack ${packId}:`, error)
            results[packId] = []
          }
        })
      )

      return results
    },
    enabled: enabled && packIds.length > 0,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 2,
  })
}

/**
 * Função utilitária para invalidar cache de um pack
 * (útil quando pack é atualizado/refresh)
 */
export async function invalidatePackAdsCache(packId: string): Promise<void> {
  await adsCache.removeCachedPackAds(packId)
}

/**
 * Função utilitária para limpar caches expirados
 * (pode ser chamada periodicamente)
 */
export async function cleanupExpiredCache(): Promise<number> {
  const result = await adsCache.clearExpiredCache()
  if (result.success && result.data) {
    console.log(`[Cache] Limpos ${result.data} caches expirados`)
    return result.data
  }
  return 0
}

