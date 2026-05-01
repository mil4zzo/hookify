import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { api } from './endpoints'
import { showError } from '@/lib/utils/toast'
import { AppError } from '@/lib/utils/errors'
import {
  GetAdsRequest,
  GetVideoSourceRequest,
  GetImageSourceRequest,
  AuthTokenRequest,
  FacebookUser,
  FacebookAdAccount,
  FacebookVideoSource,
  RankingsChildrenItem,
  RankingsItem,
  RankingsRequest,
  RankingsResponse,
  RankingsSeriesRequest,
  RankingsSeriesResponse,
  RankingsRetentionRequest,
  RankingsRetentionResponse,
  AdTranscriptionResponse,
  MetaUsageCallsParams,
  MetaUsageCallsResponse,
  MetaUsageSummaryResponse,
  MetaUsageDistinctResponse,
} from './schemas'
import { useSessionStore } from '@/lib/store/session'
import { useSupabaseAuth } from '@/lib/hooks/useSupabaseAuth'
import { getCachedPackAds, cachePackAds, removeCachedPackAds } from '@/lib/storage/adsCache'
import { filterVideoAds } from '@/lib/utils/filterVideoAds'

// Query Keys
export const queryKeys = {
  me: ['facebook', 'me'] as const,
  adAccounts: ['facebook', 'adaccounts'] as const,
  ads: (params: GetAdsRequest) => ['facebook', 'ads', params] as const,
  videoSource: (params: GetVideoSourceRequest) => ['facebook', 'video-source', params] as const,
  imageSource: (params: GetImageSourceRequest) => ['facebook', 'image-source', params] as const,
  adVariations: (adName: string, dateStart: string, dateStop: string, packIdsKey: string = '') => ['analytics', 'rankings', 'children', adName, dateStart, dateStop, packIdsKey] as const,
  adDetails: (adId: string, dateStart: string, dateStop: string, packIdsKey: string = '') => ['analytics', 'rankings', 'ad-details', adId, dateStart, dateStop, packIdsKey] as const,
  adCreative: (adId: string) => ['analytics', 'rankings', 'ad-creative', adId] as const,
  adHistory: (adId: string, dateStart: string, dateStop: string, packIdsKey: string = '') => ['analytics', 'rankings', 'ad-history', adId, dateStart, dateStop, packIdsKey] as const,
  adNameDetails: (adName: string, dateStart: string, dateStop: string, packIdsKey: string = '') => ['analytics', 'rankings', 'ad-name-details', adName, dateStart, dateStop, packIdsKey] as const,
  adNameHistory: (adName: string, dateStart: string, dateStop: string, packIdsKey: string = '') => ['analytics', 'rankings', 'ad-name-history', adName, dateStart, dateStop, packIdsKey] as const,
  adTranscription: (adName: string) => ['analytics', 'transcription', adName] as const,
  campaignChildren: (campaignId: string, dateStart: string, dateStop: string, actionType: string, packIdsKey: string) => ['analytics', 'rankings', 'campaign-children', campaignId, dateStart, dateStop, actionType, packIdsKey] as const,
  adsetChildren: (adsetId: string, dateStart: string, dateStop: string, packIdsKey: string = '') => ['analytics', 'rankings', 'adset-children', adsetId, dateStart, dateStop, packIdsKey] as const,
  packAds: (packId: string) => ['analytics', 'pack-ads', packId] as const,
  rankings: (params: RankingsRequest) => [
    'analytics',
    'rankings',
    params.date_start,
    params.date_stop,
    params.group_by,
    params.action_type,
    params.filters,
    params.pack_ids,
    params.include_series,
    params.include_leadscore,
    params.series_window,
    params.offset,
    params.limit,
    params.include_available_conversion_types,
  ] as const,
  // Alias semântico para consultas de performance agregada de anúncios
  adPerformance: (params: RankingsRequest) => [
    'analytics',
    'rankings',
    params.date_start,
    params.date_stop,
    params.group_by,
    params.action_type,
    params.filters,
    params.pack_ids,
    params.include_series,
    params.include_leadscore,
    params.series_window,
    params.offset,
    params.limit,
    params.include_available_conversion_types,
  ] as const,
  adPerformanceSeries: (params: RankingsSeriesRequest, groupKeysHash: string) =>
    ['analytics', 'rankings-series', params.date_start, params.date_stop, params.group_by, params.action_type, params.pack_ids, params.window, groupKeysHash] as const,
  adPerformanceRetention: (params: RankingsRetentionRequest) =>
    ['analytics', 'rankings-retention', params.date_start, params.date_stop, params.group_by, params.group_key, params.pack_ids] as const,
  // Lookup leve para available_conversion_types — persistido em localStorage
  // (ver ReactQueryProvider.tsx). userId no key garante isolamento entre usuários
  // que compartilhem o mesmo browser.
  conversionTypes: (
    userId: string,
    dateStart: string,
    dateStop: string,
    packIdsKey: string,
    filtersKey: string = '',
  ) => ['analytics', 'conversion-types', userId, dateStart, dateStop, packIdsKey, filtersKey] as const,
}

const hashStringArray = (values: string[]): string => {
  let hash = 2166136261
  for (const value of values) {
    const text = `${value}|`
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i)
      hash = (hash * 16777619) >>> 0
    }
  }
  return hash.toString(16)
}

// Hooks para queries
export const useMe = () => {
  const { session, sessionReady } = useSupabaseAuth()
  const setUser = useSessionStore(s => s.setUser)
  const setAdAccounts = useSessionStore(s => s.setAdAccounts)
  const result = useQuery({
    queryKey: queryKeys.me,
    queryFn: api.facebook.getMe,
    enabled: !!session && sessionReady,
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

const AD_ACCOUNTS_SYNC_KEY = 'hookify:adaccounts:last_sync'
const AD_ACCOUNTS_SYNC_TTL_MS = 12 * 60 * 60 * 1000 // 12 horas

function shouldAutoSync(userId: string): boolean {
  try {
    const raw = localStorage.getItem(`${AD_ACCOUNTS_SYNC_KEY}:${userId}`)
    if (!raw) return true
    return Date.now() - Number(raw) > AD_ACCOUNTS_SYNC_TTL_MS
  } catch {
    return true
  }
}

function markSynced(userId: string): void {
  try {
    localStorage.setItem(`${AD_ACCOUNTS_SYNC_KEY}:${userId}`, String(Date.now()))
  } catch { /* localStorage indisponível */ }
}

interface UseAdAccountsDbOptions {
  enabled?: boolean
  populateStore?: boolean
}

export const useAdAccountsDb = (options: UseAdAccountsDbOptions = {}) => {
  const { session, sessionReady } = useSupabaseAuth()
  const setAdAccounts = useSessionStore(s => s.setAdAccounts)
  const qc = useQueryClient()
  const { enabled = true, populateStore = true } = options
  const result = useQuery({
    queryKey: queryKeys.adAccounts,
    queryFn: api.facebook.getAdAccounts,
    enabled: enabled && !!session && sessionReady,
    staleTime: 10 * 60 * 1000,
    retry: 2,
  })
  useEffect(() => {
    if (!session || !sessionReady || !Array.isArray(result.data)) return
    const userId = session.user.id
    const isEmpty = result.data.length === 0
    if (isEmpty || shouldAutoSync(userId)) {
      api.facebook.syncAdAccounts()
        .then(() => {
          markSynced(userId)
          qc.invalidateQueries({ queryKey: queryKeys.adAccounts })
        })
        .catch(() => {/* sem conexão Facebook ou token expirado — silencioso */})
    }
    if (!isEmpty && populateStore) {
      setAdAccounts(result.data as unknown as FacebookAdAccount[])
    }
  }, [result.data, setAdAccounts, session, sessionReady, qc, populateStore])
  return result
}

export function useSyncAdAccounts() {
  const { session } = useSupabaseAuth()
  const qc = useQueryClient()
  const mutation = useMutation({
    mutationFn: api.facebook.syncAdAccounts,
    onSuccess: () => {
      if (session) markSynced(session.user.id)
      qc.invalidateQueries({ queryKey: queryKeys.adAccounts })
    },
  })
  return mutation
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
    staleTime: 30 * 60 * 1000,
    retry: (failureCount, error) => {
      const status = (error as AppError)?.status;
      if (status !== undefined && status >= 400 && status < 500) return false;
      return failureCount < 2;
    },
  })
}

export const useImageSource = (params: GetImageSourceRequest, enabled = true) => {
  return useQuery({
    queryKey: queryKeys.imageSource(params),
    queryFn: () => api.facebook.getImageSource(params),
    enabled,
    staleTime: 30 * 60 * 1000,
    retry: 1,
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
  packIds: string[] = [],
  enabled: boolean = false
) => {
  const packIdsKey = [...packIds].sort().join("|");
  return useQuery({
    queryKey: queryKeys.adVariations(adName, dateStart, dateStop, packIdsKey),
    queryFn: async () => {
      const response = await api.analytics.getRankingsChildren(adName, {
        date_start: dateStart,
        date_stop: dateStop,
        pack_ids: packIds,
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
 * Hook para buscar filhos de uma campanha (agrupados por adset_id) para expansão inline.
 */
export const useCampaignChildren = (
  campaignId: string,
  dateStart: string,
  dateStop: string,
  actionType?: string,
  packIds: string[] = [],
  enabled: boolean = false
) => {
  const packIdsKey = [...packIds].sort().join("|")
  const actionTypeKey = String(actionType || "").trim()
  return useQuery({
    queryKey: queryKeys.campaignChildren(campaignId, dateStart, dateStop, actionTypeKey, packIdsKey),
    queryFn: async () => {
      const response = await api.analytics.getCampaignChildren(campaignId, {
        date_start: dateStart,
        date_stop: dateStop,
        action_type: actionTypeKey || undefined,
        pack_ids: packIds,
      })
      return (response.data || []) as RankingsItem[]
    },
    enabled: enabled && !!campaignId && !!dateStart && !!dateStop,
    staleTime: 5 * 60 * 1000,
    retry: 2,
  })
}

/**
 * Hook para buscar filhos de um adset (anúncios individuais) para expansão inline.
 */
export const useAdsetChildren = (
  adsetId: string,
  dateStart: string,
  dateStop: string,
  packIds: string[] = [],
  enabled: boolean = false
) => {
  const packIdsKey = [...packIds].sort().join("|");
  return useQuery({
    queryKey: queryKeys.adsetChildren(adsetId, dateStart, dateStop, packIdsKey),
    queryFn: async () => {
      const response = await api.analytics.getAdsetChildren(adsetId, {
        date_start: dateStart,
        date_stop: dateStop,
        pack_ids: packIds,
      })
      return (response.data || []) as RankingsChildrenItem[]
    },
    enabled: enabled && !!adsetId && !!dateStart && !!dateStop,
    staleTime: 5 * 60 * 1000,
    retry: 2,
  })
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
  packIds: string[] = [],
  enabled: boolean = false
) => {
  const packIdsKey = [...packIds].sort().join("|");
  return useQuery({
    queryKey: queryKeys.adDetails(adId, dateStart, dateStop, packIdsKey),
    queryFn: () => api.analytics.getAdDetails(adId, {
      date_start: dateStart,
      date_stop: dateStop,
      pack_ids: packIds,
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
  packIds: string[] = [],
  enabled: boolean = false
) => {
  const packIdsKey = [...packIds].sort().join("|");
  return useQuery({
    queryKey: queryKeys.adHistory(adId, dateStart, dateStop, packIdsKey),
    queryFn: () => api.analytics.getAdHistory(adId, {
      date_start: dateStart,
      date_stop: dateStop,
      pack_ids: packIds,
    }),
    enabled: enabled && !!adId && !!dateStart && !!dateStop,
    staleTime: 5 * 60 * 1000, // Cache de 5 minutos
    retry: 2,
  });
};

/**
 * Detalhes agregados por ad_name: métricas de todos os ad_ids que compartilham o mesmo ad_name no período.
 * Equivalente a useAdDetails mas agrupado por ad_name.
 */
export const useAdNameDetails = (
  adName: string,
  dateStart: string,
  dateStop: string,
  packIds: string[] = [],
  enabled: boolean = false
) => {
  const packIdsKey = [...packIds].sort().join("|");
  return useQuery({
    queryKey: queryKeys.adNameDetails(adName, dateStart, dateStop, packIdsKey),
    queryFn: () => api.analytics.getAdNameDetails(adName, {
      date_start: dateStart,
      date_stop: dateStop,
      pack_ids: packIds,
    }),
    enabled: enabled && !!adName && !!dateStart && !!dateStop,
    staleTime: 5 * 60 * 1000,
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
  packIds: string[] = [],
  enabled: boolean = false
) => {
  const packIdsKey = [...packIds].sort().join("|");
  return useQuery({
    queryKey: queryKeys.adNameHistory(adName, dateStart, dateStop, packIdsKey),
    queryFn: () => api.analytics.getAdNameHistory(adName, {
      date_start: dateStart,
      date_stop: dateStop,
      pack_ids: packIds,
    }),
    enabled: enabled && !!adName && !!dateStart && !!dateStop,
    staleTime: 5 * 60 * 1000,
    retry: 2,
  });
};

/**
 * Hook para buscar rankings/agregados de anúncios (nome histórico).
 *
 * Preferir `useAdPerformance` em código novo.
 */
export const useRankings = (params: RankingsRequest, enabled: boolean = true) => {
  return useQuery<RankingsResponse>({
    queryKey: queryKeys.rankings(params),
    queryFn: () => api.analytics.getRankings(params),
    enabled: enabled && !!params.date_start && !!params.date_stop,
    staleTime: Infinity, // só muda com pack refresh (invalidação manual)
    gcTime: 10 * 60 * 1000,
    retry: 2,
  })
}

/**
 * Hook semântico para buscar performance agregada de anúncios.
 * Usa a mesma estrutura de dados de `useRankings`, mas aponta para o novo alias de rota.
 */
export const useAdPerformance = (params: RankingsRequest, enabled: boolean = true) => {
  return useQuery<RankingsResponse>({
    queryKey: queryKeys.adPerformance(params),
    queryFn: () => api.analytics.getAdPerformance(params),
    enabled: enabled && !!params.date_start && !!params.date_stop,
    staleTime: Infinity, // só muda com pack refresh (invalidação manual)
    gcTime: 60 * 1000,
    retry: 2,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
}

/**
 * Lookup leve para `available_conversion_types`. Substitui o probe (`limit=1`)
 * que era feito em `useAdPerformance`. Persiste em localStorage por 7 dias
 * (ver ReactQueryProvider.tsx) — em sessões repetidas o dropdown popula
 * instantaneamente sem rede.
 */
export const useConversionTypes = (
  params: { date_start: string; date_stop: string; pack_ids: string[]; filters?: any },
  enabled: boolean = true,
) => {
  const { user } = useSupabaseAuth()
  const userId = String(user?.id || '')
  const packIdsKey = [...(params.pack_ids || [])].sort().join('|')
  const filtersKey = params.filters ? JSON.stringify(params.filters) : ''
  return useQuery<{ available_conversion_types: string[] }>({
    queryKey: queryKeys.conversionTypes(userId, params.date_start, params.date_stop, packIdsKey, filtersKey),
    queryFn: () => api.analytics.getConversionTypes({
      date_start: params.date_start,
      date_stop: params.date_stop,
      pack_ids: params.pack_ids,
      filters: params.filters,
    }),
    enabled: enabled && !!userId && !!params.date_start && !!params.date_stop && (params.pack_ids?.length ?? 0) > 0,
    staleTime: 24 * 60 * 60 * 1000, // 24h — conversion types raramente mudam
    gcTime: 7 * 24 * 60 * 60 * 1000, // 7d — alinhado com maxAge do persister
    retry: 1,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
}

export const useAdPerformanceSeries = (params: RankingsSeriesRequest, enabled: boolean = true) => {
  const normalizedKeys = [...(params.group_keys || [])].map(String).sort()
  const groupKeysHash = hashStringArray(normalizedKeys)

  return useQuery<RankingsSeriesResponse>({
    queryKey: queryKeys.adPerformanceSeries(params, groupKeysHash),
    queryFn: () =>
      api.analytics.getRankingsSeries({
        ...params,
        group_keys: normalizedKeys,
      }),
    enabled:
      enabled &&
      !!params.date_start &&
      !!params.date_stop &&
      normalizedKeys.length > 0,
    staleTime: Infinity, // só muda com pack refresh (invalidação manual)
    gcTime: 2 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
}

export const useAdPerformanceRetention = (params: RankingsRetentionRequest, enabled: boolean = true) => {
  return useQuery<RankingsRetentionResponse>({
    queryKey: queryKeys.adPerformanceRetention(params),
    queryFn: () => api.analytics.getRankingsRetention(params),
    enabled: enabled && !!params.date_start && !!params.date_stop && !!params.group_key,
    staleTime: Infinity, // só muda com pack refresh (invalidação manual)
    gcTime: 10 * 60 * 1000,
    retry: 1,
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
        return filterVideoAds(cachedResult.data)
      }

      // 2) Sem cache -> busca do Supabase (fonte de verdade)
      const response = await api.analytics.getPack(packId, true)
      if (!response.success) {
        throw new Error('Falha ao buscar ads do pack')
      }
      const ads = Array.isArray(response.pack?.ads) ? response.pack.ads : []
      const videoAds = filterVideoAds(ads)
      if (ads.length > 0) {
        await cachePackAds(packId, ads).catch(() => {})
      }
      return videoAds
    },
    enabled: enabled && !!packId,
    // Packs só mudam via Ads Loader (criação/refresh/delete), invalidamos manualmente
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
  })
}

export const useAdTranscription = (adName: string, enabled: boolean = false, forcePolling: boolean = false) => {
  return useQuery<AdTranscriptionResponse | null>({
    queryKey: queryKeys.adTranscription(adName),
    queryFn: () => api.analytics.getTranscription(adName),
    enabled: enabled && !!adName,
    staleTime: 5 * 60 * 1000,
    retry: 0,
    refetchInterval: (query) => {
      if (query.state.data?.status === 'processing') return 3000;
      // Keep polling when transcription was just started but backend hasn't saved yet (null data)
      if (forcePolling && !query.state.data) return 2000;
      return false;
    },
  })
}

export const useTranscribeAd = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (adName: string) => api.facebook.transcribeAd(adName),
    onSuccess: (_data, adName) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.adTranscription(adName) })
    },
  })
}

// ========== Meta API Usage ==========
export const metaUsageQueryKeys = {
  summary: ['meta-usage', 'summary'] as const,
  calls: (params: MetaUsageCallsParams) => ['meta-usage', 'calls', params] as const,
  distinct: ['meta-usage', 'distinct'] as const,
}

export const useMetaUsageSummary = (enabled: boolean = true) => {
  return useQuery<MetaUsageSummaryResponse>({
    queryKey: metaUsageQueryKeys.summary,
    queryFn: api.metaUsage.getSummary,
    enabled,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
    retry: 1,
  })
}

export const useMetaUsageCalls = (params: MetaUsageCallsParams, enabled: boolean = true) => {
  return useQuery<MetaUsageCallsResponse>({
    queryKey: metaUsageQueryKeys.calls(params),
    queryFn: () => api.metaUsage.listCalls(params),
    enabled,
    staleTime: 30 * 1000,
    retry: 1,
  })
}

export const useMetaUsageDistinct = (enabled: boolean = true) => {
  return useQuery<MetaUsageDistinctResponse>({
    queryKey: metaUsageQueryKeys.distinct,
    queryFn: api.metaUsage.getDistinct,
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: 1,
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
      // Invalida cache do React Query e força refetch imediato das queries ativas
      queryClient.invalidateQueries({ 
        queryKey: queryKeys.packAds(packId),
        refetchType: 'active' // Força refetch imediato das queries ativas (páginas abertas)
      })
    },
    invalidateAllPacksAds: async () => {
      // Invalida todos os packs e força refetch imediato das queries ativas
      queryClient.invalidateQueries({ 
        queryKey: ['analytics', 'pack-ads'],
        refetchType: 'active' // Força refetch imediato das queries ativas (páginas abertas)
      })
    },
    invalidateRankings: () => {
      queryClient.invalidateQueries({ queryKey: ['analytics', 'rankings'], refetchType: 'active' })
      queryClient.invalidateQueries({ queryKey: ['analytics', 'rankings-series'], refetchType: 'active' })
    },
    invalidateAdPerformance: () => {
      queryClient.invalidateQueries({ queryKey: ['analytics', 'rankings'], refetchType: 'active' })
      queryClient.invalidateQueries({ queryKey: ['analytics', 'rankings-series'], refetchType: 'active' })
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
