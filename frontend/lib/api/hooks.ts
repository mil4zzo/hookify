import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { api } from './endpoints'
import { showError } from '@/lib/utils/toast'
import { AppError } from '@/lib/utils/errors'
import {
  GetAdsRequest,
  GetVideoSourceRequest,
  GetImageSourceRequest,
  FacebookAdAccount,
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
  TagItem,
  RankingsRowTag,
  BoardItem,
  BoardGroupItem,
} from './schemas'
import { useSessionStore } from '@/lib/store/session'
import { useSupabaseAuth } from '@/lib/hooks/useSupabaseAuth'
import { getCachedPackAds, cachePackAds, removeCachedPackAds } from '@/lib/storage/adsCache'
import { filterVideoAds } from '@/lib/utils/filterVideoAds'
import { usePacksLoading } from '@/components/layout/PacksLoader'
import { computePacksFreshnessStamp } from '@/lib/utils/packsFreshness'

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
  packActivity: (packId: string, actorId: string = '') => ['analytics', 'pack-activity', packId, actorId] as const,
  rankings: (params: RankingsRequest, freshness: string = '') => [
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
    freshness,
  ] as const,
  // Alias semântico para consultas de performance agregada de anúncios
  adPerformance: (params: RankingsRequest, freshness: string = '') => [
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
    freshness,
  ] as const,
  // `freshness` = carimbo dos packs selecionados (updated_at do refresh + last_successful_sync_at
  // da planilha). Vai no FIM da chave: o prefixo ['analytics', 'rankings'] continua batendo em
  // todas as invalidacoes existentes. Ver lib/utils/packsFreshness.ts para o porque.
  adPerformanceSeries: (params: RankingsSeriesRequest, groupKeysHash: string, freshness: string = '') =>
    ['analytics', 'rankings-series', params.date_start, params.date_stop, params.group_by, params.action_type, params.pack_ids, params.window, groupKeysHash, freshness] as const,
  adPerformanceRetention: (params: RankingsRetentionRequest) =>
    ['analytics', 'rankings-retention', params.date_start, params.date_stop, params.group_by, params.group_key, params.pack_ids] as const,
}

// Retry das queries analíticas pesadas (rankings/series/retention).
//
// Elas acionam RPCs caras no Supabase. Uma resposta HTTP de erro — inclusive 5xx —
// significa que a RPC rodou e falhou: re-tentar cai na mesma conexão do pool, refaz o
// mesmo trabalho e só multiplica a carga no banco (o retry do frontend compõe com o do
// backend, então 1 falha vira várias execuções). Só vale re-tentar quando NÃO houve
// resposta: aí o request pode nem ter chegado.
//
// parseError() só preenche `status` quando existe response HTTP; erro de rede
// (NETWORK/ECONNABORTED/ETIMEDOUT) vem sem `status`. Isso também evita re-tentar a
// rejeição sintética do guard de logout (`{ cancelled: true, status: 0 }`).
const retryOnlyNetworkErrors = (failureCount: number, error: unknown): boolean => {
  const status = (error as AppError | null)?.status
  if (status !== undefined) return false
  return failureCount < 2
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
    // `isEmpty` NAO pode disparar o sync: ele curto-circuitava o TTL e criava um
    // laco infinito em toda conta sem Facebook (o caso do convidado, P3.4) —
    // lista vazia -> sync -> invalidate -> refetch -> lista vazia de novo. Medido:
    // 9 chamadas a /adaccounts/sync e 11 a /adaccounts numa unica sessao de pagina.
    // `markSynced` vai ANTES de disparar: dentro do .then ele nunca rodava quando o
    // sync nao tinha o que fazer, e o laco se realimentava. Uma tentativa por janela
    // de TTL, deu ou nao deu. Quem acabou de conectar sincroniza pelo caminho
    // explicito (useFacebookConnections / Topbar), nao por este efeito.
    if (shouldAutoSync(userId)) {
      markSynced(userId)
      api.facebook.syncAdAccounts()
        .then(() => {
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
    queryFn: async ({ signal }) => {
      const response = await api.analytics.getRankingsChildren(adName, {
        date_start: dateStart,
        date_stop: dateStop,
        pack_ids: packIds,
      }, { signal });
      // Retornar apenas o array de dados, tipado corretamente
      return (response.data || []) as RankingsChildrenItem[];
    },
    enabled: enabled && !!adName && !!dateStart && !!dateStop,
    staleTime: 5 * 60 * 1000, // Cache de 5 minutos
    retry: retryOnlyNetworkErrors,
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
    queryFn: async ({ signal }) => {
      const response = await api.analytics.getCampaignChildren(campaignId, {
        date_start: dateStart,
        date_stop: dateStop,
        action_type: actionTypeKey || undefined,
        pack_ids: packIds,
      }, { signal })
      return (response.data || []) as RankingsItem[]
    },
    enabled: enabled && !!campaignId && !!dateStart && !!dateStop,
    staleTime: 5 * 60 * 1000,
    retry: retryOnlyNetworkErrors,
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
    queryFn: async ({ signal }) => {
      const response = await api.analytics.getAdsetChildren(adsetId, {
        date_start: dateStart,
        date_stop: dateStop,
        pack_ids: packIds,
      }, { signal })
      return (response.data || []) as RankingsChildrenItem[]
    },
    enabled: enabled && !!adsetId && !!dateStart && !!dateStop,
    staleTime: 5 * 60 * 1000,
    retry: retryOnlyNetworkErrors,
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
    queryFn: ({ signal }) => api.analytics.getAdDetails(adId, {
      date_start: dateStart,
      date_stop: dateStop,
      pack_ids: packIds,
    }, { signal }),
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
export const useAdCreative = (adId: string, enabled: boolean = false, packIds: string[] = []) => {
  const packIdsKey = [...packIds].sort().join("|");
  return useQuery({
    // packIdsKey entra na chave: o mesmo ad_id resolve para silos diferentes.
    queryKey: [...queryKeys.adCreative(adId), packIdsKey],
    queryFn: ({ signal }) => api.analytics.getAdCreative(adId, { signal, packIds }),
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
    queryFn: ({ signal }) => api.analytics.getAdHistory(adId, {
      date_start: dateStart,
      date_stop: dateStop,
      pack_ids: packIds,
    }, { signal }),
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
    queryFn: ({ signal }) => api.analytics.getAdNameDetails(adName, {
      date_start: dateStart,
      date_stop: dateStop,
      pack_ids: packIds,
    }, { signal }),
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
    queryFn: ({ signal }) => api.analytics.getAdNameHistory(adName, {
      date_start: dateStart,
      date_stop: dateStop,
      pack_ids: packIds,
    }, { signal }),
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
    queryFn: ({ signal }) => api.analytics.getRankings(params, { signal }),
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
/**
 * Carimbo de frescor dos packs selecionados, lido direto do store (zustand, seletor
 * barato). NAO usar useClientPacks/useClientSession aqui: cada instancia deles abre
 * uma assinatura onAuthStateChange, e este hook e chamado em varias telas.
 *
 * O gate em `packsLoading` e o que impede um fetch com carimbo VELHO: o store
 * rehidrata packs persistidos (updated_at antigo) antes do /packs fresco chegar;
 * sem o gate, a chave mudaria quando os packs sincronizassem e a tela pagaria a
 * consulta pesada DUAS vezes. Fora do PacksLoader o contexto vale isLoading=true
 * de proposito -- toda tela que usa este hook vive dentro do AppLayout.
 */
function usePacksFreshness(packIds: RankingsRequest['pack_ids']) {
  const packs = useSessionStore((s) => s.packs)
  const { isLoading: packsLoading } = usePacksLoading()
  return { freshness: computePacksFreshnessStamp(packs, packIds), packsLoading }
}

export const useAdPerformance = (params: RankingsRequest, enabled: boolean = true) => {
  const { freshness, packsLoading } = usePacksFreshness(params.pack_ids)
  return useQuery<RankingsResponse>({
    queryKey: queryKeys.adPerformance(params, freshness),
    queryFn: ({ signal }) => api.analytics.getAdPerformance(params, { signal }),
    enabled: enabled && !!params.date_start && !!params.date_stop && !packsLoading,
    staleTime: Infinity, // só muda com pack refresh (invalidação manual)
    gcTime: 60 * 1000,
    retry: retryOnlyNetworkErrors,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
}

export const useAdPerformanceSeries = (params: RankingsSeriesRequest, enabled: boolean = true) => {
  const normalizedKeys = [...(params.group_keys || [])].map(String).sort()
  const groupKeysHash = hashStringArray(normalizedKeys)
  const { freshness, packsLoading } = usePacksFreshness(params.pack_ids)

  return useQuery<RankingsSeriesResponse>({
    queryKey: queryKeys.adPerformanceSeries(params, groupKeysHash, freshness),
    queryFn: ({ signal }) =>
      api.analytics.getRankingsSeries({
        ...params,
        group_keys: normalizedKeys,
      }, { signal }),
    enabled:
      enabled &&
      !!params.date_start &&
      !!params.date_stop &&
      normalizedKeys.length > 0 &&
      !packsLoading,
    staleTime: Infinity, // só muda com pack refresh (invalidação manual)
    gcTime: 2 * 60 * 1000,
    retry: retryOnlyNetworkErrors,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
}

export const useAdPerformanceRetention = (params: RankingsRetentionRequest, enabled: boolean = true) => {
  return useQuery<RankingsRetentionResponse>({
    queryKey: queryKeys.adPerformanceRetention(params),
    queryFn: ({ signal }) => api.analytics.getRankingsRetention(params, { signal }),
    enabled: enabled && !!params.date_start && !!params.date_stop && !!params.group_key,
    staleTime: Infinity, // só muda com pack refresh (invalidação manual)
    gcTime: 10 * 60 * 1000,
    retry: retryOnlyNetworkErrors,
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

export const useTranscribeAd = (packIds?: string[]) => {
  const queryClient = useQueryClient()
  return useMutation({
    // packIds: transcrever anuncio de pack COMPARTILHADO (silo/credencial do dono).
    mutationFn: (adName: string) => api.facebook.transcribeAd(adName, packIds),
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

// ========== Tags de criativo ==========
//
// A marcacao e por `ad_name`. Todas as mutations abaixo atualizam o cache de
// rankings IN PLACE em vez de invalidar: `['analytics','rankings']` dispara uma
// RPC medida em ~2,6s quente, e invalidar em massa apos cada clique de tag
// reproduziria a amplificacao que ja estourou statement_timeout no toggle de
// status. So a lista de tags (barata) e invalidada de fato.

export const tagQueryKeys = {
  list: ['tags', 'list'] as const,
}

/** Aplica `mutate` nas tags de toda linha de rankings ja cacheada. */
function patchCachedRankingTags(
  queryClient: ReturnType<typeof useQueryClient>,
  mutate: (tags: RankingsRowTag[], adName: string) => RankingsRowTag[],
) {
  queryClient.setQueriesData<unknown>({ queryKey: ['analytics', 'rankings'] }, (cached: unknown) => {
    const payload = cached as { data?: unknown } | undefined
    if (!payload || !Array.isArray(payload.data)) return cached

    let touched = false
    const nextRows = (payload.data as Array<Record<string, unknown>>).map((row) => {
      // group_key e o proprio ad_name no agrupamento por criativo; na aba por
      // anuncio o nome vem em `ad_name`. Sem nome nao ha como casar a tag.
      const adName = String(row?.ad_name ?? row?.group_key ?? '')
      if (!adName) return row

      const current = Array.isArray(row.tags) ? (row.tags as RankingsRowTag[]) : []
      const next = mutate(current, adName)
      if (next === current) return row

      touched = true
      return { ...row, tags: next }
    })

    return touched ? { ...payload, data: nextRows } : cached
  })
}

/** Aplica `mutate` na lista de tags cacheada, sem ida ao servidor. */
function patchCachedTagList(
  queryClient: ReturnType<typeof useQueryClient>,
  mutate: (tags: TagItem[]) => TagItem[],
) {
  queryClient.setQueryData<{ data: TagItem[] }>(tagQueryKeys.list, (cached) => {
    if (!cached?.data) return cached
    return { ...cached, data: mutate(cached.data) }
  })
}

/** Insere mantendo a ordem por nome que o servidor usa (`.order("name")`). */
function insertTagSorted(tags: TagItem[], created: TagItem): TagItem[] {
  if (tags.some((t) => t.id === created.id)) return tags
  return [...tags, created].sort((a, b) => a.name.localeCompare(b.name))
}

export const useTags = (enabled: boolean = true) => {
  return useQuery<{ data: TagItem[] }>({
    queryKey: tagQueryKeys.list,
    queryFn: ({ signal }) => api.tags.list({ signal }),
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  })
}

export const useCreateTag = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ name, color }: { name: string; color: string }) => api.tags.create(name, color),
    onSuccess: (result) => {
      // Escreve a tag criada direto no cache em vez de invalidar. Invalidar deixava a
      // lista exibindo a versão ANTIGA (sem a tag nova) até o refetch chegar — o usuário
      // via a opção "Criar" sumir e a tag não aparecer, parecendo que falhou.
      // O POST já devolve a linha autoritativa, então não há o que buscar.
      const created = result?.data
      if (created) patchCachedTagList(queryClient, (tags) => insertTagSorted(tags, { ...created, usage_count: created.usage_count ?? 0 }))
    },
    onError: (error) => showError(error),
  })
}

export const useUpdateTag = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ tagId, patch }: { tagId: string; patch: { name?: string; color?: string } }) =>
      api.tags.update(tagId, patch),
    onSuccess: (result, { tagId }) => {
      const updated = result?.data
      if (updated) {
        // Renomear preserva o id, entao a linha cacheada so precisa do rotulo novo.
        patchCachedRankingTags(queryClient, (tags) =>
          tags.some((t) => t.id === tagId)
            ? tags.map((t) => (t.id === tagId ? { ...t, name: updated.name, color: updated.color } : t))
            : tags,
        )
      }
      queryClient.invalidateQueries({ queryKey: tagQueryKeys.list })
    },
    onError: (error) => showError(error),
  })
}

export const useDeleteTag = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (tagId: string) => api.tags.remove(tagId),
    onSuccess: (_result, tagId) => {
      // O ON DELETE CASCADE ja removeu as marcacoes no banco; o cache acompanha.
      patchCachedRankingTags(queryClient, (tags) =>
        tags.some((t) => t.id === tagId) ? tags.filter((t) => t.id !== tagId) : tags,
      )
      queryClient.invalidateQueries({ queryKey: tagQueryKeys.list })
    },
    onError: (error) => showError(error),
  })
}

export const useAssignTags = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ tags, adNames }: { tags: TagItem[]; adNames: string[] }) =>
      api.tags.assign(tags.map((t) => t.id), adNames),
    onSuccess: (_result, { tags, adNames }) => {
      const targets = new Set(adNames)
      patchCachedRankingTags(queryClient, (current, adName) => {
        if (!targets.has(adName)) return current
        const missing = tags.filter((t) => !current.some((c) => c.id === t.id))
        if (missing.length === 0) return current
        const merged = [...current, ...missing.map((t) => ({ id: t.id, name: t.name, color: t.color }))]
        return merged.sort((a, b) => a.name.localeCompare(b.name))
      })
      queryClient.invalidateQueries({ queryKey: tagQueryKeys.list })
    },
    onError: (error) => showError(error),
  })
}

export const useUnassignTags = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ tags, adNames }: { tags: TagItem[]; adNames: string[] }) =>
      api.tags.unassign(tags.map((t) => t.id), adNames),
    onSuccess: (_result, { tags, adNames }) => {
      const targets = new Set(adNames)
      const removing = new Set(tags.map((t) => t.id))
      patchCachedRankingTags(queryClient, (current, adName) => {
        if (!targets.has(adName)) return current
        const next = current.filter((t) => !removing.has(t.id))
        return next.length === current.length ? current : next
      })
      queryClient.invalidateQueries({ queryKey: tagQueryKeys.list })
    },
    onError: (error) => showError(error),
  })
}


// ========== Boards ==========
//
// Barato de propria natureza: uma lista pequena (teto de 30 boards x 20 grupos)
// que nao toca em `['analytics','rankings']`. Editar uma regra NAO refaz fetch
// nenhum — os criativos do grupo sao derivados no cliente das linhas que o
// Manager ja trouxe. Por isso aqui e invalidacao simples, sem patch in-place:
// nao existe query cara para proteger.

export const boardQueryKeys = {
  list: ['boards', 'list'] as const,
}

export const useBoards = (enabled: boolean = true) => {
  return useQuery<{ data: BoardItem[] }>({
    queryKey: boardQueryKeys.list,
    queryFn: ({ signal }) => api.boards.list({ signal }),
    enabled,
    staleTime: 5 * 60 * 1000,
  })
}

export const useCreateBoard = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => api.boards.create(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: boardQueryKeys.list })
    },
    onError: (error) => showError(error),
  })
}

export const useUpdateBoard = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ boardId, patch }: { boardId: string; patch: { name?: string; position?: number } }) =>
      api.boards.update(boardId, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: boardQueryKeys.list })
    },
    onError: (error) => showError(error),
  })
}

export const useDeleteBoard = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (boardId: string) => api.boards.remove(boardId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: boardQueryKeys.list })
    },
    onError: (error) => showError(error),
  })
}

export const useCreateBoardGroup = () => {
  const queryClient = useQueryClient()
  return useMutation<{ data: BoardGroupItem }, unknown, { boardId: string; payload: { name: string; color?: string; rules?: unknown; sort_metric?: string; sort_direction?: string } }>({
    mutationFn: ({ boardId, payload }) => api.boards.createGroup(boardId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: boardQueryKeys.list })
    },
    onError: (error) => showError(error),
  })
}

export const useUpdateBoardGroup = () => {
  const queryClient = useQueryClient()
  return useMutation<
    { data: BoardGroupItem },
    unknown,
    { boardId: string; groupId: string; patch: { name?: string; color?: string; rules?: unknown; position?: number; sort_metric?: string; sort_direction?: string } }
  >({
    mutationFn: ({ boardId, groupId, patch }) => api.boards.updateGroup(boardId, groupId, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: boardQueryKeys.list })
    },
    onError: (error) => showError(error),
  })
}

export const useDeleteBoardGroup = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ boardId, groupId }: { boardId: string; groupId: string }) => api.boards.removeGroup(boardId, groupId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: boardQueryKeys.list })
    },
    onError: (error) => showError(error),
  })
}

export const useReorderBoardGroups = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ boardId, groupIds }: { boardId: string; groupIds: string[] }) => api.boards.reorderGroups(boardId, groupIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: boardQueryKeys.list })
    },
    onError: (error) => showError(error),
  })
}
