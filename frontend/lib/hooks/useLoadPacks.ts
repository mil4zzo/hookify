"use client"

import { useEffect, useRef, useState } from 'react'
import { useClientAuth, useClientPacks } from '@/lib/hooks/useClientSession'
import { api } from '@/lib/api/endpoints'
import { getAdStatistics } from '@/lib/utils/adCounting'

/**
 * Carrega packs do Supabase na inicialização da sessão
 * - Usa stats do backend quando presentes
 * - Se stats ausentes, tenta calcular a partir do cache IndexedDB
 * - Atualiza/adiciona packs no Zustand store
 * @returns isLoading - true enquanto carrega packs do Supabase
 */
export function useLoadPacks() {
  const { isClient, isAuthenticated, user } = useClientAuth()
  const { packs, addPack, updatePack } = useClientPacks()
  const loadedRef = useRef(false)
  const userIdRef = useRef<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    // Handler para recarregar packs quando integração for atualizada
    const handleIntegrationUpdate = async (event: CustomEvent) => {
      const { packId } = event.detail
      if (packId) {
        try {
          const response = await api.analytics.listPacks(false)
          if (response.success && response.packs) {
            const updatedPack = response.packs.find((p: any) => p.id === packId)
            if (updatedPack) {
              updatePack(packId, { sheet_integration: updatedPack.sheet_integration } as any)
            }
          }
        } catch (error) {
          console.error('Erro ao atualizar pack após integração:', error)
        }
      }
    }

    window.addEventListener('pack-integration-updated', handleIntegrationUpdate as EventListener)

    // Resetar loadedRef se o usuário mudou (novo login)
    if (user?.id && userIdRef.current !== user.id) {
      loadedRef.current = false
      userIdRef.current = user.id
    }

    if (!isClient || !isAuthenticated || loadedRef.current) {
      setIsLoading(false)
      return () => {
        window.removeEventListener('pack-integration-updated', handleIntegrationUpdate as EventListener)
      }
    }

    const loadPacks = async () => {
      loadedRef.current = true
      setIsLoading(true)
      
      try {
        const response = await api.analytics.listPacks(false)
        if (response.success && response.packs) {
          const supabasePacks = await Promise.all(
            response.packs.map(async (pack: any) => {
              let stats = pack.stats
              // Verificar se stats está completo e válido
              // Um objeto stats válido deve ter pelo menos as propriedades essenciais
              // (backend agora sempre calcula stats, mas manter fallback para compatibilidade)
              const essentialStatsKeys = ['totalSpend', 'uniqueAds', 'uniqueCampaigns', 'uniqueAdsets'];
              const hasValidStats = stats && 
                                   typeof stats === 'object' && 
                                   Object.keys(stats).length > 0 &&
                                   essentialStatsKeys.every(key => 
                                     key in stats && 
                                     stats[key] !== null && 
                                     stats[key] !== undefined
                                   );
              
              if (!hasValidStats) {
                try {
                  const { getCachedPackAds } = await import('@/lib/storage/adsCache')
                  const cached = await getCachedPackAds(pack.id)
                  if (cached.success && cached.data && cached.data.length > 0) {
                    const calculated = getAdStatistics(cached.data)
                    stats = {
                      totalAds: cached.data.length,
                      uniqueAds: calculated.uniqueAds,
                      uniqueCampaigns: calculated.uniqueCampaigns,
                      uniqueAdsets: calculated.uniqueAdsets,
                      totalSpend: calculated.totalSpend,
                    }
                  }
                } catch (e) {
                  // silencioso: sem cache disponível
                }
              }

              return {
                id: pack.id,
                name: pack.name,
                adaccount_id: pack.adaccount_id,
                date_start: pack.date_start,
                date_stop: pack.date_stop,
                level: pack.level || 'ad',
                filters: pack.filters || [],
                ads: [],
                auto_refresh: pack.auto_refresh || false,
                stats: stats || undefined,
                created_at: pack.created_at,
                updated_at: pack.updated_at,
                sheet_integration: pack.sheet_integration || undefined, // Incluir dados de integração se disponível
              }
            })
          )

          supabasePacks.forEach((pack: any) => {
            const existing = packs.find((p) => p.id === pack.id)
            if (!existing) {
              addPack(pack)
            } else {
              // Atualizar stats se mudou
              if (pack.stats && (!existing.stats || JSON.stringify(existing.stats) !== JSON.stringify(pack.stats))) {
                updatePack(pack.id, { stats: pack.stats })
              }
              // Atualizar sheet_integration se mudou
              if (JSON.stringify(pack.sheet_integration) !== JSON.stringify(existing.sheet_integration)) {
                updatePack(pack.id, { sheet_integration: pack.sheet_integration } as any)
              }
            }
          })
        }
      } catch (error) {
        console.error('Erro ao carregar packs do Supabase:', error)
        loadedRef.current = false
      } finally {
        setIsLoading(false)
      }
    }

    loadPacks()

    return () => {
      window.removeEventListener('pack-integration-updated', handleIntegrationUpdate as EventListener)
    }
  }, [isClient, isAuthenticated, user?.id, packs.length, addPack, updatePack])

  return { isLoading }
}


