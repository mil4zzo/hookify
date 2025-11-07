import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { api } from './endpoints'
import { showError } from '@/lib/utils/toast'
import { AppError } from '@/lib/utils/errors'
import {
  GetAdsRequest,
  GetVideoSourceRequest,
  AuthTokenRequest,
  FacebookUser,
  FacebookAdAccount,
  FacebookVideoSource,
  RankingsChildrenItem,
  RankingsRequest,
  RankingsResponse,
} from './schemas'
import { useSessionStore } from '@/lib/store/session'
import { useSupabaseAuth } from '@/lib/hooks/useSupabaseAuth'
import { getCachedPackAds, cachePackAds, removeCachedPackAds } from '@/lib/storage/adsCache'

// Query Keys
export const queryKeys = {
  me: ['facebook', 'me'] as const,
  adAccounts: ['facebook', 'adaccounts'] as const,
  ads: (params: GetAdsRequest) => ['facebook', 'ads', params] as const,
  videoSource: (params: GetVideoSourceRequest) => ['facebook', 'video-source', params] as const,
  adVariations: (adName: string, dateStart: string, dateStop: string) => ['analytics', 'rankings', 'children', adName, dateStart, dateStop] as const,
  adDetails: (adId: string, dateStart: string, dateStop: string) => ['analytics', 'rankings', 'ad-details', adId, dateStart, dateStop] as const,
  adCreative: (adId: string) => ['analytics', 'rankings', 'ad-creative', adId] as const,
  adHistory: (adId: string, dateStart: string, dateStop: string) => ['analytics', 'rankings', 'ad-history', adId, dateStart, dateStop] as const,
  adNameHistory: (adName: string, dateStart: string, dateStop: string) => ['analytics', 'rankings', 'ad-name-history', adName, dateStart, dateStop] as const,
  packAds: (packId: string) => ['analytics', 'pack-ads', packId] as const,
  rankings: (params: RankingsRequest) => ['analytics', 'rankings', params.date_start, params.date_stop, params.group_by, params.filters] as const,
}

// Hooks para queries
export const useMe = () => {
  const token = useSessionStore(s => s.accessToken)
  const setUser = useSessionStore(s => s.setUser)
  const setAdAccounts = useSessionStore(s => s.setAdAccounts)
  const result = useQuery({
    queryKey: queryKeys.me,
    queryFn: api.facebook.getMe,
    enabled: !!token,
    staleTime: 5 * 60 * 1000, // 5 minutos
    retry: 2,
  })
  useEffect(() => {
    if (result.data) {
      setUser(result.data)
      setAdAccounts(result.data.adaccounts ?? [])
    }
  }, [result.data, setUser, setAdAccounts])
  return result
}

export const useAdAccountsDb = () => {
  const { session } = useSupabaseAuth() // Usar sessão do Supabase ao invés de accessToken do store
  const setAdAccounts = useSessionStore(s => s.setAdAccounts)
  const result = useQuery({
    queryKey: queryKeys.adAccounts,
    queryFn: api.facebook.getAdAccounts,
    enabled: !!session, // Verificar sessão do Supabase ao invés de token do store
    staleTime: 10 * 60 * 1000,
    retry: 2,
  })
  useEffect(() => {
    if (Array.isArray(result.data)) {
      setAdAccounts(result.data as unknown as FacebookAdAccount[])
    }
  }, [result.data, setAdAccounts])
  return result
}

export const useAds = (params: GetAdsRequest, enabled = true) => {
  return useQuery({
    queryKey: queryKeys.ads(params),
    queryFn: () => api.facebook.getAds(params),
    enabled,
    staleTime: 2 * 60 * 1000, // 2 minutos
    retry: 2,
  })
}

export const useVideoSource = (params: GetVideoSourceRequest, enabled = true) => {
  return useQuery({
    queryKey: queryKeys.videoSource(params),
    queryFn: () => api.facebook.getVideoSource(params),
    enabled,
    staleTime: 30 * 60 * 1000, // 30 minutos (videos são mais estáveis)
    retry: 2,
  })
}

/**
 * Hook centralizado para buscar variações de um anúncio agrupado por nome.
 * Utiliza cache compartilhado do React Query, evitando requisições duplicadas.
 * 
 * @param adName - Nome do anúncio para buscar variações
 * @param dateStart - Data de início do período
 * @param dateStop - Data de fim do período
 * @param enabled - Se deve habilitar a query automaticamente (padrão: false para carregamento sob demanda)
 * 
 * @example
 * ```tsx
 * const { data, isLoading, refetch } = useAdVariations('My Ad Name', '2024-01-01', '2024-01-31');
 * // Carregar sob demanda:
 * if (needsData) refetch();
 * ```
 */
export const useAdVariations = (
  adName: string,
  dateStart: string,
  dateStop: string,
  enabled: boolean = false
) => {
  return useQuery({
    queryKey: queryKeys.adVariations(adName, dateStart, dateStop),
    queryFn: async () => {
      const response = await api.analytics.getRankingsChildren(adName, {
        date_start: dateStart,
        date_stop: dateStop,
      });
      // Retornar apenas o array de dados, tipado corretamente
      return (response.data || []) as RankingsChildrenItem[];
    },
    enabled: enabled && !!adName && !!dateStart && !!dateStop,
    staleTime: 5 * 60 * 1000, // Cache de 5 minutos
    retry: 2,
  });
}

/**
 * Hook para buscar detalhes completos de um ad_id específico.
 * Útil quando você precisa de dados completos de um anúncio individual,
 * especialmente quando não está agrupado por nome ou quando precisa de dados
 * que não estão disponíveis no ranking agregado.
 * 
 * @param adId - ID do anúncio para buscar detalhes
 * @param dateStart - Data de início do período
 * @param dateStop - Data de fim do período
 * @param enabled - Se deve habilitar a query automaticamente (padrão: false para carregamento sob demanda)
 * 
 * @example
 * ```tsx
 * const { data, isLoading } = useAdDetails('123456789', '2024-01-01', '2024-01-31');
 * // Carregar sob demanda:
 * if (needsData) refetch();
 * ```
 */
export const useAdDetails = (
  adId: string,
  dateStart: string,
  dateStop: string,
  enabled: boolean = false
) => {
  return useQuery({
    queryKey: queryKeys.adDetails(adId, dateStart, dateStop),
    queryFn: () => api.analytics.getAdDetails(adId, {
      date_start: dateStart,
      date_stop: dateStop,
    }),
    enabled: enabled && !!adId && !!dateStart && !!dateStop,
    staleTime: 5 * 60 * 1000, // Cache de 5 minutos
    retry: 2,
  });
}

/**
 * Hook para buscar creative e video_ids de um anúncio.
 * Útil para obter dados de vídeo quando necessário (ex: player de vídeo).
 * 
 * @param adId - ID do anúncio para buscar creative
 * @param enabled - Se deve habilitar a query automaticamente (padrão: false para carregamento sob demanda)
 * 
 * @example
 * ```tsx
 * const { data, isLoading } = useAdCreative('123456789');
 * // Carregar sob demanda:
 * if (needsData) refetch();
 * ```
 */
export const useAdCreative = (adId: string, enabled: boolean = false) => {
  return useQuery({
    queryKey: queryKeys.adCreative(adId),
    queryFn: () => api.analytics.getAdCreative(adId),
    enabled: enabled && !!adId,
    staleTime: 30 * 60 * 1000, // Cache de 30 minutos (dados raramente mudam)
    retry: 2,
  });
};

/**
 * Hook para buscar dados históricos diários de um anúncio.
 * Retorna um array de objetos, um para cada dia do período, contendo todas as métricas diárias.
 * 
 * @param adId - ID do anúncio para buscar histórico
 * @param dateStart - Data de início do período
 * @param dateStop - Data de fim do período
 * @param enabled - Se deve habilitar a query automaticamente (padrão: false para carregamento sob demanda)
 * 
 * @example
 * ```tsx
 * const { data, isLoading } = useAdHistory('123456789', '2024-01-01', '2024-01-31');
 * // Carregar sob demanda:
 * if (needsData) refetch();
 * ```
 */
export const useAdHistory = (
  adId: string,
  dateStart: string,
  dateStop: string,
  enabled: boolean = false
) => {
  return useQuery({
    queryKey: queryKeys.adHistory(adId, dateStart, dateStop),
    queryFn: () => api.analytics.getAdHistory(adId, {
      date_start: dateStart,
      date_stop: dateStop,
    }),
    enabled: enabled && !!adId && !!dateStart && !!dateStop,
    staleTime: 5 * 60 * 1000, // Cache de 5 minutos
    retry: 2,
  });
};

/**
 * Histórico agregado por ad_name: soma métricas de todos os ad_ids que compartilham o mesmo ad_name, por dia.
 */
export const useAdNameHistory = (
  adName: string,
  dateStart: string,
  dateStop: string,
  enabled: boolean = false
) => {
  return useQuery({
    queryKey: queryKeys.adNameHistory(adName, dateStart, dateStop),
    queryFn: () => api.analytics.getAdNameHistory(adName, {
      date_start: dateStart,
      date_stop: dateStop,
    }),
    enabled: enabled && !!adName && !!dateStart && !!dateStop,
    staleTime: 5 * 60 * 1000,
    retry: 2,
  });
};

/**
 * Hook para buscar rankings de anúncios
 * 
 * @param params - Parâmetros da requisição de rankings
 * @param enabled - Se deve habilitar a query automaticamente (padrão: true)
 * 
 * @example
 * ```tsx
 * const { data, isLoading } = useRankings({
 *   date_start: '2024-01-01',
 *   date_stop: '2024-01-31',
 *   group_by: 'ad_name',
 * });
 * ```
 */
export const useRankings = (params: RankingsRequest, enabled: boolean = true) => {
  return useQuery<RankingsResponse>({
    queryKey: queryKeys.rankings(params),
    queryFn: () => api.analytics.getRankings(params),
    enabled: enabled && !!params.date_start && !!params.date_stop,
    staleTime: 2 * 60 * 1000, // 2 minutos - rankings podem mudar com novos dados
    gcTime: 10 * 60 * 1000, // 10 minutos - manter em cache por 10min
    retry: 2,
  })
}

/**
 * Hook para buscar ads de um pack com cache automático em IndexedDB.
 * 
 * Estratégia de cache em camadas:
 * 1. TanStack Query (memória) - cache rápido, perde ao recarregar
 * 2. IndexedDB (persistente) - cache permanente com TTL de 1 hora
 * 3. Supabase API - fonte de verdade
 * 
 * @param packId - ID do pack para buscar ads
 * @param enabled - Se deve habilitar a query automaticamente (padrão: true)
 * 
 * @example
 * ```tsx
 * const { data: ads, isLoading } = usePackAds(packId);
 * // Usar os ads diretamente
 * {ads?.map(ad => <div key={ad.ad_id}>{ad.ad_name}</div>)}
 * ```
 */
export const usePackAds = (packId: string, enabled: boolean = true) => {
  return useQuery({
    queryKey: queryKeys.packAds(packId),
    queryFn: async () => {
      if (!packId) {
        throw new Error('packId é obrigatório')
      }

      // 1) Tenta ler do cache (para resposta rápida)
      const cachedResult = await getCachedPackAds(packId)
      if (cachedResult.success && cachedResult.data && Array.isArray(cachedResult.data)) {
        return cachedResult.data
      }

      // 2) Sem cache -> busca do Supabase (fonte de verdade)
      const response = await api.analytics.getPack(packId, true)
      if (!response.success) {
        throw new Error('Falha ao buscar ads do pack')
      }
      const ads = Array.isArray(response.pack?.ads) ? response.pack.ads : []
      if (ads.length > 0) {
        await cachePackAds(packId, ads).catch(() => {})
      }
      return ads
    },
    enabled: enabled && !!packId,
    // Packs só mudam via Ads Loader (criação/refresh/delete), invalidamos manualmente
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    // Usar cache IndexedDB como placeholder
    placeholderData: async () => {
      const cached = await getCachedPackAds(packId)
      return cached.success ? cached.data : undefined
    },
  })
}

// Hooks para mutations
export const useAuthToken = () => {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: api.auth.exchangeToken,
    onSuccess: (data) => {
      // Invalidar queries relacionadas ao usuário
      queryClient.invalidateQueries({ queryKey: queryKeys.me })
    },
  })
}

export const useAuthUrl = () => {
  return useMutation({
    mutationFn: api.auth.getUrl,
  })
}

// Hooks utilitários para invalidar cache
export const useInvalidateUserData = () => {
  const queryClient = useQueryClient()
  
  return {
    invalidateMe: () => queryClient.invalidateQueries({ queryKey: queryKeys.me }),
    invalidateAll: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.me })
    },
  }
}

/**
 * Hook utilitário para invalidar cache de ads de um pack
 * Útil quando um pack é atualizado, refresh ou deletado
 */
export const useInvalidatePackAds = () => {
  const queryClient = useQueryClient()
  
  return {
    invalidatePackAds: async (packId: string) => {
      // Remove do cache IndexedDB
      await removeCachedPackAds(packId).catch((error) => {
        console.error('Erro ao remover cache de ads:', error)
      })
      // Invalida cache do React Query
      queryClient.invalidateQueries({ queryKey: queryKeys.packAds(packId) })
    },
    invalidateAllPacksAds: async () => {
      // Invalida todos os packs
      queryClient.invalidateQueries({ queryKey: ['analytics', 'pack-ads'] })
    },
    invalidateRankings: () => {
      // Invalida todas as queries de rankings (para atualizar após refresh de packs)
      queryClient.invalidateQueries({ queryKey: ['analytics', 'rankings'] })
    },
  }
}

// Hook para prefetch de dados
export const usePrefetchUserData = () => {
  const queryClient = useQueryClient()
  
  return {
    prefetchMe: () => queryClient.prefetchQuery({
      queryKey: queryKeys.me,
      queryFn: api.facebook.getMe,
      staleTime: 5 * 60 * 1000,
    }),
  }
}
