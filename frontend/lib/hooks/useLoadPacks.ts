"use client"

import { useEffect, useRef, useState } from 'react'
import { useClientAuth, useClientPacks } from '@/lib/hooks/useClientSession'
import { api } from '@/lib/api/endpoints'
import { getAdStatistics } from '@/lib/utils/adCounting'
import { logger } from '@/lib/utils/logger'

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
          } else if (!response.success) {
            logger.error('useLoadPacks: listPacks retornou success:false no handler de integração', { packId, response })
          }
        } catch (error) {
          logger.error('Erro ao atualizar pack após integração:', error)
        }
      }
    }

    window.addEventListener('pack-integration-updated', handleIntegrationUpdate as unknown as EventListener)

    // Resetar loadedRef se o usuário mudou (novo login)
    if (user?.id && userIdRef.current !== user.id) {
      loadedRef.current = false
      userIdRef.current = user.id
    }

    if (!isClient || !isAuthenticated || loadedRef.current) {
      setIsLoading(false)
      return () => {
        window.removeEventListener('pack-integration-updated', handleIntegrationUpdate as unknown as EventListener)
      }
    }

    const loadPacks = async () => {
      loadedRef.current = true
      setIsLoading(true)
      
      try {
        const response = await api.analytics.listPacks(false)
        if (!response.success) {
          logger.error('useLoadPacks: listPacks retornou success:false', { response })
        }
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
                auto_refresh: pack.auto_refresh || false,
                stats: stats || undefined,
                created_at: pack.created_at,
                updated_at: pack.updated_at,
                last_refreshed_at: pack.last_refreshed_at || undefined, // Incluir last_refreshed_at se disponível
                // Refresh em andamento visível entre membros de um pack compartilhado.
                // Sempre os DOIS: o status sozinho não diz se ainda é verdade.
                refresh_status: pack.refresh_status ?? null,
                refresh_lock_until: pack.refresh_lock_until ?? null,
                refresh_actor_name: pack.refresh_actor_name ?? null,
                sheet_integration: pack.sheet_integration || undefined, // Incluir dados de integração se disponível
                conversion_types: Array.isArray(pack.conversion_types) ? pack.conversion_types : [], // Metadado materializado (dropdown de eventos)
                // Janela de atribuição (migration 143) — null = ainda não calibrado
                attribution_window_days: pack.attribution_window_days ?? null,
                attribution_setting: pack.attribution_setting ?? null,
                // Critério de julgamento do pack (migration 110) — null preservado:
                // null = NÃO DEFINIDO (MQL/CPMQL indisponíveis), nunca zero.
                mql_leadscore_min: pack.mql_leadscore_min ?? null,
                target_cpr: pack.target_cpr ?? null,
                // Compartilhamento (P3.7): ausente = pack próprio
                shared_role: pack.shared_role ?? null,
                shared_owner_name: pack.shared_owner_name ?? null,
              }
            })
          )

          supabasePacks.forEach((pack: any) => {
            const existing = packs.find((p) => p.id === pack.id)
            if (!existing) {
              addPack(pack)
            } else {
              const patch: Record<string, any> = {}
              // Campos escalares — comparação direta
              if (pack.date_start !== existing.date_start) patch.date_start = pack.date_start
              if (pack.date_stop !== existing.date_stop) patch.date_stop = pack.date_stop
              if (pack.name !== existing.name) patch.name = pack.name
              if (pack.auto_refresh !== existing.auto_refresh) patch.auto_refresh = pack.auto_refresh
              if (pack.last_refreshed_at !== (existing as any).last_refreshed_at) patch.last_refreshed_at = pack.last_refreshed_at
              // Refresh alheio em andamento: campo dos mais mutáveis que existem.
              // Sem entrar no patch, o store persistido reidrata um 'running' velho
              // e o pack fica com selo de atualização eterno após um reload.
              if ((pack.refresh_status ?? null) !== ((existing as any).refresh_status ?? null)) {
                patch.refresh_status = pack.refresh_status ?? null
              }
              if ((pack.refresh_lock_until ?? null) !== ((existing as any).refresh_lock_until ?? null)) {
                patch.refresh_lock_until = pack.refresh_lock_until ?? null
              }
              if ((pack.refresh_actor_name ?? null) !== ((existing as any).refresh_actor_name ?? null)) {
                patch.refresh_actor_name = pack.refresh_actor_name ?? null
              }
              // Campos objeto — JSON.stringify
              if (pack.stats && (!existing.stats || JSON.stringify(existing.stats) !== JSON.stringify(pack.stats))) {
                patch.stats = pack.stats
              }
              if (JSON.stringify(pack.sheet_integration) !== JSON.stringify(existing.sheet_integration)) {
                patch.sheet_integration = pack.sheet_integration
              }
              if (JSON.stringify(pack.conversion_types || []) !== JSON.stringify((existing as any).conversion_types || [])) {
                patch.conversion_types = Array.isArray(pack.conversion_types) ? pack.conversion_types : []
              }
              // Janela de atribuição: calibrada a cada carga — o store persistido
              // não pode reidratar o valor antigo e mostrar um recuo que já mudou.
              if ((pack.attribution_window_days ?? null) !== ((existing as any).attribution_window_days ?? null)) {
                patch.attribution_window_days = pack.attribution_window_days ?? null
              }
              if ((pack.attribution_setting ?? null) !== ((existing as any).attribution_setting ?? null)) {
                patch.attribution_setting = pack.attribution_setting ?? null
              }
              // Overrides de julgamento: campos mutáveis — sem isto, o store persistido
              // reidrata o valor antigo e a tela julga por um critério já alterado.
              if (pack.mql_leadscore_min !== ((existing as any).mql_leadscore_min ?? null)) {
                patch.mql_leadscore_min = pack.mql_leadscore_min
              }
              // Papel pode mudar (dono promove/demove) — o store persistido não
              // pode reidratar um papel antigo e liberar/esconder ação errada.
              if ((pack.shared_role ?? null) !== ((existing as any).shared_role ?? null)) {
                patch.shared_role = pack.shared_role ?? null
              }
              if (JSON.stringify(pack.target_cpr ?? null) !== JSON.stringify((existing as any).target_cpr ?? null)) {
                patch.target_cpr = pack.target_cpr
              }
              if (Object.keys(patch).length > 0) {
                updatePack(pack.id, patch as any)
              }
            }
          })
        }
      } catch (error) {
        logger.error('Erro ao carregar packs do Supabase:', error)
        loadedRef.current = false
      } finally {
        setIsLoading(false)
      }
    }

    loadPacks()

    return () => {
      window.removeEventListener('pack-integration-updated', handleIntegrationUpdate as unknown as EventListener)
    }
  }, [isClient, isAuthenticated, user?.id]) // Removido packs.length, addPack, updatePack para evitar re-execuções desnecessárias

  return { isLoading }
}


