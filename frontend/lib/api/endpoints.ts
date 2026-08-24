import { apiClient } from './client'
import {
  GetMeResponse,
  GetAdsRequest,
  GetAdsResponse,
  GetVideoSourceRequest,
  GetVideoSourceResponse,
  MediaSourceUrlsBatchResponse,
  GetImageSourceRequest,
  GetImageSourceResponse,
  AuthTokenRequest,
  AuthTokenResponse,
  AuthUrlResponse,
  FacebookAdAccount,
  RankingsRequest,
  RankingsFilters,
  RankingsResponse,
  RankingsSeriesRequest,
  RankingsSeriesResponse,
  RankingsRetentionRequest,
  RankingsRetentionResponse,
  RankingsChildrenItem,
  AdCreativeResponse,
  GlobalSearchResponse,
  ListSpreadsheetsResponse,
  ListWorksheetsResponse,
  ListGoogleConnectionsResponse,
  SheetColumnsResponse,
  SheetIntegrationRequest,
  SaveSheetIntegrationResponse,
  SheetSyncJobProgress,
  UpdateEntityStatusResponse,
  UpdateEntityBudgetResponse,
  BatchStatusResponse,
  StatusSyncResponse,
  AdsTreeResponse,
  AdsSearchResponse,
  AdCreativeDetailResponse,
  BulkAdConfig,
  BulkAdProgressResponse,
  CampaignTemplateResponse,
  CampaignBulkConfig,
  CampaignBulkProgressResponse,
  AdTranscriptionResponse,
  PackTranscriptionStatus,
  MetaUsageSummaryResponse,
  MetaUsageCallsParams,
  MetaUsageCallsResponse,
  MetaUsageDistinctResponse,
  PackActivityResponse,
  TagItem,
  TagAssignResult,
} from './schemas'
import { env } from '@/lib/config/env'
import type { CreateSharePayload, CreateShareResponse, ShareSummary } from '@/lib/share/types'

// Tipos simples para o fluxo de onboarding inicial
export interface OnboardingStatusResponse {
  has_completed_onboarding: boolean
  initial_settings_configured: boolean
  facebook_connected: boolean
  validation_criteria_configured: boolean
}

export interface InitialSettingsRequest {
  language: string
  currency: string
  niche?: string
}

export interface SuccessResponse {
  success: boolean
}

export const api = {
  // Health check
  health: {
    check: (): Promise<{ status: string; service: string; version: string }> =>
      apiClient.get('/health'),
  },

  // Onboarding inicial
  onboarding: {
    getStatus: (): Promise<OnboardingStatusResponse> =>
      apiClient.get('/onboarding/status'),
    saveInitialSettings: (data: InitialSettingsRequest): Promise<SuccessResponse> =>
      apiClient.post('/onboarding/initial-settings', data),
    complete: (): Promise<SuccessResponse> =>
      apiClient.post('/onboarding/complete'),
    reset: (): Promise<SuccessResponse> =>
      apiClient.post('/onboarding/reset'),
  },

  // Facebook OAuth
  auth: {
    getUrl: (): Promise<AuthUrlResponse> => 
      apiClient.get('/facebook/auth/url', { params: { redirect_uri: env.FB_REDIRECT_URI } }),
    
    exchangeToken: (data: AuthTokenRequest): Promise<AuthTokenResponse> =>
      apiClient.post('/facebook/auth/token', { ...data, redirect_uri: env.FB_REDIRECT_URI }),
  },

  // Facebook API
  facebook: {
    getMe: (): Promise<GetMeResponse> =>
      apiClient.get('/facebook/me'),
    
    getAdAccounts: (): Promise<FacebookAdAccount[]> =>
      apiClient.get('/facebook/adaccounts'),
    
    syncAdAccounts: (): Promise<{ ok: boolean; count: number }> =>
      apiClient.post('/facebook/adaccounts/sync'),
    
    getAds: (params: GetAdsRequest): Promise<GetAdsResponse> =>
      apiClient.postAds('/facebook/ads', params),
    
    startAdsJob: (params: GetAdsRequest): Promise<{ job_id: string; status: string; message: string }> =>
      apiClient.post('/facebook/ads-progress', params),
    
    getJobProgress: (jobId: string): Promise<{ status: string; progress: number; message: string; data?: any; pack_id?: string; result_count?: number; details?: any }> =>
      apiClient.getWithTimeout(`/facebook/ads-progress/${jobId}`, 60000), // 60 segundos (requests agora são rápidos com arquitetura "2 fases")

    getTranscriptionProgress: (jobId: string): Promise<{ status: string; progress: number; message: string; details?: any }> =>
      apiClient.getWithTimeout(`/facebook/transcription-progress/${jobId}`, 60000),
    
    getVideoSource: (params: GetVideoSourceRequest): Promise<GetVideoSourceResponse> =>
      apiClient.get('/facebook/video-source', { params }),

    /** URLs de mídia (vídeo + imagem em alta) por ad_name — export CSV.
     * Timeout de 5min: uma rodada FRIA (centenas de mídias sem cache, vídeos a 4 por vez)
     * passa de 2min com folga; o backend cacheia conforme resolve, então retentar após
     * timeout é barato. Rodadas seguintes são majoritariamente cache. */
    getMediaSourceUrlsBatch: (adNames: string[]): Promise<MediaSourceUrlsBatchResponse> =>
      apiClient.post('/facebook/media-source-urls/batch', { ad_names: adNames }, { timeout: 300000 }),

    getImageSource: (params: GetImageSourceRequest): Promise<GetImageSourceResponse> =>
      apiClient.get('/facebook/image-source', { params }),
    
    /**
     * Inicia refresh do pack. `chainSheetsAfterMeta` pede ao BACKEND para
     * encadear o sync do Leadscore após o Meta; a response diz `server_chain`
     * (true ⇒ o frontend NÃO deve disparar sheets — orquestrador único; ausente
     * = backend antigo/flag off ⇒ fluxo client-side atual).
     */
    refreshPack: (packId: string, untilDate: string, refreshType: "since_last_refresh" | "full_period" = "since_last_refresh", skipSheetsSync: boolean = false, chainSheetsAfterMeta: boolean = false, sheetIntegrationId?: string): Promise<{ job_id: string; status: string; message: string; pack_id: string; date_range: { since: string; until: string }; sync_job_id?: string; server_chain?: boolean }> =>
      apiClient.post(`/facebook/refresh-pack/${packId}`, { until_date: untilDate, refresh_type: refreshType, skip_sheets_sync: skipSheetsSync, chain_sheets_after_meta: chainSheetsAfterMeta, sheet_integration_id: sheetIntegrationId }),

    /** Retorna contagens e listas de ads por categoria de transcrição para um pack. */
    getPackTranscriptionStatus: (packId: string): Promise<PackTranscriptionStatus> =>
      apiClient.get(`/facebook/packs/${packId}/transcription-status`),

    /** Inicia apenas a transcrição dos vídeos do pack (sem refresh). Retorna transcription_job_id para polling.
     * forceNoAudio retenta também os failed-sem-áudio (escape para falsos positivos). */
    startPackTranscription: (packId: string, adNames?: string[], forceNoAudio?: boolean): Promise<{ message: string; pack_id: string; pack_name: string; transcription_job_id: string | null }> =>
      apiClient.post(`/facebook/packs/${packId}/transcribe`, {
        ...(adNames ? { ad_names: adNames } : {}),
        ...(forceNoAudio ? { force_no_audio: true } : {}),
      }),

    /** Inicia ou reinicia a transcrição de um anúncio por ad_name. */
    transcribeAd: (adName: string, packIds?: string[]): Promise<{ message: string; ad_name: string }> =>
      apiClient.post('/facebook/transcription/start', { ad_name: adName, pack_ids: packIds }),
    
    /** Jobs ativos (heartbeat recente) do usuário — usado para re-attach de progresso após reload/login. */
    getActiveJobs: (): Promise<{ jobs: Array<{ job_id: string; status: string; progress: number; message: string | null; type: string | null; pack_id: string | null; pack_name: string | null; integration_id: string | null; updated_at: string }> }> =>
      apiClient.get('/facebook/jobs/active'),

    cancelJobsBatch: (jobIds: string[], reason?: string): Promise<{ cancelled_count: number; total_requested: number; message: string }> =>
      apiClient.post('/facebook/jobs/cancel-batch', { job_ids: jobIds, reason: reason || 'Cancelado durante logout' }),

    updateAdStatus: (adId: string, status: "PAUSED" | "ACTIVE", packIds?: string[]): Promise<UpdateEntityStatusResponse> =>
      // Contexto de pack: o backend so o usa p/ PROPOR silo (exige papel + entidade no pack).
      apiClient.post(`/facebook/ads/${encodeURIComponent(adId)}/status`, { status, pack_ids: packIds }),

    updateAdsetStatus: (adsetId: string, status: "PAUSED" | "ACTIVE", packIds?: string[]): Promise<UpdateEntityStatusResponse> =>
      apiClient.post(`/facebook/adsets/${encodeURIComponent(adsetId)}/status`, { status, pack_ids: packIds }),

    updateCampaignStatus: (campaignId: string, status: "PAUSED" | "ACTIVE", packIds?: string[]): Promise<UpdateEntityStatusResponse> =>
      apiClient.post(`/facebook/campaigns/${encodeURIComponent(campaignId)}/status`, { status, pack_ids: packIds }),

    /** Edita o orçamento de um conjunto (ABO). Valores em SUBUNIDADE da moeda da conta; exatamente um dos campos. */
    updateAdsetBudget: (adsetId: string, budget: { daily_budget?: number; lifetime_budget?: number }, packIds?: string[]): Promise<UpdateEntityBudgetResponse> =>
      apiClient.post(`/facebook/adsets/${encodeURIComponent(adsetId)}/budget`, { ...budget, pack_ids: packIds }),

    /** Edita o orçamento de uma campanha (CBO). Valores em SUBUNIDADE da moeda da conta; exatamente um dos campos. */
    updateCampaignBudget: (campaignId: string, budget: { daily_budget?: number; lifetime_budget?: number }, packIds?: string[]): Promise<UpdateEntityBudgetResponse> =>
      apiClient.post(`/facebook/campaigns/${encodeURIComponent(campaignId)}/budget`, { ...budget, pack_ids: packIds }),

    batchUpdateAdStatus: (adIds: string[], status: "PAUSED" | "ACTIVE", packIds?: string[]): Promise<BatchStatusResponse> =>
      apiClient.post("/facebook/ads/batch-status", { ad_ids: adIds, status, pack_ids: packIds }),

    batchUpdateAdsetStatus: (ids: string[], status: "PAUSED" | "ACTIVE", packIds?: string[]): Promise<BatchStatusResponse> =>
      apiClient.post("/facebook/adsets/batch-status", { ids, status, pack_ids: packIds }),

    batchUpdateCampaignStatus: (ids: string[], status: "PAUSED" | "ACTIVE", packIds?: string[]): Promise<BatchStatusResponse> =>
      apiClient.post("/facebook/campaigns/batch-status", { ids, status, pack_ids: packIds }),

    /** Sync leve on-focus: relê do Meta o effective_status dos ads e pais dos packs (TTL 5 min server-side). */
    syncPacksStatus: (packIds: string[]): Promise<StatusSyncResponse> =>
      apiClient.post("/facebook/packs/status-sync", { pack_ids: packIds }),
  },

  bulkAds: {
    getAdsTree: (): Promise<AdsTreeResponse> =>
      apiClient.get('/facebook/ads/tree'),
    searchAds: (params: {
      q?: string
      q_adset?: string
      q_campaign?: string
      pack_id?: string
      limit?: number
      offset?: number
    }): Promise<AdsSearchResponse> => {
      const qs = new URLSearchParams()
      if (params.q) qs.set('q', params.q)
      if (params.q_adset) qs.set('q_adset', params.q_adset)
      if (params.q_campaign) qs.set('q_campaign', params.q_campaign)
      if (params.pack_id) qs.set('pack_id', params.pack_id)
      if (params.limit !== undefined) qs.set('limit', String(params.limit))
      if (params.offset !== undefined) qs.set('offset', String(params.offset))
      const query = qs.toString()
      return apiClient.get(`/facebook/ads/search${query ? `?${query}` : ''}`)
    },
    getAdCreative: (adId: string): Promise<AdCreativeDetailResponse> =>
      apiClient.get(`/facebook/ads/${encodeURIComponent(adId)}/creative`),
    start: (
      files: File[],
      config: BulkAdConfig,
    ): Promise<{ job_id: string; status: string; message: string; total_items: number }> => {
      const formData = new FormData()
      files.forEach((file) => formData.append('files', file))
      formData.append('config', JSON.stringify(config))
      return apiClient.postMultipart('/facebook/bulk-ads', formData)
    },
    getProgress: (jobId: string): Promise<BulkAdProgressResponse> =>
      apiClient.getWithTimeout(`/facebook/bulk-ads/${encodeURIComponent(jobId)}`, 60000),
    retry: (
      jobId: string,
      itemIds: string[],
    ): Promise<{ job_id: string; status: string; message: string; total_items: number }> =>
      apiClient.post(`/facebook/bulk-ads/${encodeURIComponent(jobId)}/retry`, {
        job_id: jobId,
        item_ids: itemIds,
      }),
  },

  campaignBulk: {
    getCampaignTemplate: (adId: string): Promise<CampaignTemplateResponse> =>
      apiClient.get(`/facebook/campaign-template/${encodeURIComponent(adId)}`),

    start: (
      files: File[],
      config: CampaignBulkConfig,
    ): Promise<{ job_id: string; status: string; message: string; total_items: number }> => {
      const formData = new FormData()
      files.forEach((file) => formData.append('files', file))
      formData.append('config', JSON.stringify(config))
      return apiClient.postMultipart('/facebook/campaign-bulk', formData)
    },

    getProgress: (jobId: string): Promise<CampaignBulkProgressResponse> =>
      apiClient.getWithTimeout(`/facebook/campaign-bulk/${encodeURIComponent(jobId)}`, 60000),

    retry: (
      jobId: string,
      itemIds: string[],
    ): Promise<{ job_id: string; status: string; message: string; total_items: number }> =>
      apiClient.post(`/facebook/campaign-bulk/${encodeURIComponent(jobId)}/retry`, {
        job_id: jobId,
        item_ids: itemIds,
      }),
  },

  // Analytics (Supabase)
  analytics: {
    // Endpoint histórico, mantido por compatibilidade.
    // `options.signal` permite que o TanStack Query aborte o HTTP em-voo
    // (ex.: queryClient.cancelQueries() no logout) — sem ele a query pesada
    // continua rodando no backend até estourar o statement_timeout (57014).
    getRankings: (params: RankingsRequest, options?: { signal?: AbortSignal }): Promise<RankingsResponse> =>
      apiClient.post('/analytics/rankings', params, { signal: options?.signal }),
    // Alias semântico para evolução futura: mesma payload, rota nova
    getAdPerformance: (params: RankingsRequest, options?: { signal?: AbortSignal }): Promise<RankingsResponse> =>
      apiClient.post('/analytics/ad-performance', params, { signal: options?.signal }),
    getRankingsSeries: (params: RankingsSeriesRequest, options?: { signal?: AbortSignal }): Promise<RankingsSeriesResponse> =>
      apiClient.post('/analytics/rankings/series', params, { signal: options?.signal }),
    getRankingsRetention: (params: RankingsRetentionRequest, options?: { signal?: AbortSignal }): Promise<RankingsRetentionResponse> =>
      apiClient.post('/analytics/rankings/retention', params, { signal: options?.signal }),
    getRankingsChildren: (
      adName: string,
      params: { date_start: string; date_stop: string; order_by?: string; pack_ids?: string[] },
      options?: { signal?: AbortSignal }
    ): Promise<{ data: any[] }> => {
      const qs = new URLSearchParams()
      qs.append('date_start', params.date_start)
      qs.append('date_stop', params.date_stop)
      if (params.order_by) qs.append('order_by', params.order_by)
      params.pack_ids?.forEach((packId) => {
        if (packId) qs.append('pack_ids', packId)
      })
      return apiClient.get(`/analytics/rankings/ad-name/${encodeURIComponent(adName)}/children?${qs.toString()}`, { signal: options?.signal })
    },
    getAdDetails: (
      adId: string,
      params: { date_start: string; date_stop: string; pack_ids?: string[] },
      options?: { signal?: AbortSignal }
    ): Promise<RankingsChildrenItem> => {
      const qs = new URLSearchParams()
      qs.append('date_start', params.date_start)
      qs.append('date_stop', params.date_stop)
      params.pack_ids?.forEach((packId) => {
        if (packId) qs.append('pack_ids', packId)
      })
      return apiClient.get(`/analytics/rankings/ad-id/${encodeURIComponent(adId)}?${qs.toString()}`, { signal: options?.signal })
    },
    getAdCreative: (adId: string, options?: { signal?: AbortSignal; packIds?: string[] }): Promise<AdCreativeResponse> =>
      apiClient.get(`/analytics/rankings/ad-id/${encodeURIComponent(adId)}/creative`, {
        signal: options?.signal,
        // Pack compartilhado: o criativo vive no silo do dono.
        params: options?.packIds?.length ? { pack_ids: options.packIds.join(",") } : undefined,
      }),
    getAdHistory: (
      adId: string,
      params: { date_start: string; date_stop: string; pack_ids?: string[] },
      options?: { signal?: AbortSignal }
    ): Promise<{ data: any[] }> => {
      const qs = new URLSearchParams()
      qs.append('date_start', params.date_start)
      qs.append('date_stop', params.date_stop)
      params.pack_ids?.forEach((packId) => {
        if (packId) qs.append('pack_ids', packId)
      })
      return apiClient.get(`/analytics/rankings/ad-id/${encodeURIComponent(adId)}/history?${qs.toString()}`, { signal: options?.signal })
    },
    getAdNameDetails: (
      adName: string,
      params: { date_start: string; date_stop: string; pack_ids?: string[] },
      options?: { signal?: AbortSignal }
    ): Promise<RankingsChildrenItem> => {
      const qs = new URLSearchParams()
      qs.append('date_start', params.date_start)
      qs.append('date_stop', params.date_stop)
      params.pack_ids?.forEach((packId) => {
        if (packId) qs.append('pack_ids', packId)
      })
      return apiClient.get(`/analytics/rankings/ad-name/${encodeURIComponent(adName)}/details?${qs.toString()}`, { signal: options?.signal })
    },
    getAdNameHistory: (
      adName: string,
      params: { date_start: string; date_stop: string; pack_ids?: string[] },
      options?: { signal?: AbortSignal }
    ): Promise<{ data: any[] }> => {
      const qs = new URLSearchParams()
      qs.append('date_start', params.date_start)
      qs.append('date_stop', params.date_stop)
      params.pack_ids?.forEach((packId) => {
        if (packId) qs.append('pack_ids', packId)
      })
      return apiClient.get(`/analytics/rankings/ad-name/${encodeURIComponent(adName)}/history?${qs.toString()}`, { signal: options?.signal })
    },
    getTranscription: async (adName: string): Promise<AdTranscriptionResponse | null> => {
      try {
        return await (apiClient.get('/analytics/transcription', { params: { ad_name: adName } }) as Promise<AdTranscriptionResponse>);
      } catch (err: any) {
        if (err?.status === 404) return null;
        throw err;
      }
    },
    getTranscriptionsBatch: async (adNames: string[], packIds?: string[]): Promise<Record<string, string>> => {
      if (!adNames.length) return {};
      // Pack compartilhado: a transcricao vive no silo do dono.
      return apiClient.post('/analytics/transcriptions/batch', { ad_names: adNames, pack_ids: packIds }) as Promise<Record<string, string>>;
    },
    getAdsetDetails: (
      adsetId: string,
      params: { date_start: string; date_stop: string; pack_ids?: string[] },
      options?: { signal?: AbortSignal }
    ): Promise<any> => {
      const qs = new URLSearchParams()
      qs.append('date_start', params.date_start)
      qs.append('date_stop', params.date_stop)
      params.pack_ids?.forEach((packId) => {
        if (packId) qs.append('pack_ids', packId)
      })
      return apiClient.get(`/analytics/rankings/adset-id/${encodeURIComponent(adsetId)}?${qs.toString()}`, { signal: options?.signal })
    },
    getAdsetChildren: (
      adsetId: string,
      params: { date_start: string; date_stop: string; order_by?: string; pack_ids?: string[] },
      options?: { signal?: AbortSignal }
    ): Promise<{ data: any[] }> => {
      const qs = new URLSearchParams()
      qs.append('date_start', params.date_start)
      qs.append('date_stop', params.date_stop)
      if (params.order_by) qs.append('order_by', params.order_by)
      params.pack_ids?.forEach((packId) => {
        if (packId) qs.append('pack_ids', packId)
      })
      return apiClient.get(`/analytics/rankings/adset-id/${encodeURIComponent(adsetId)}/children?${qs.toString()}`, { signal: options?.signal })
    },
    searchGlobal: (query: string, limit: number = 20): Promise<GlobalSearchResponse> =>
      apiClient.get('/analytics/search', { params: { query, limit } }),
    getCampaignChildren: (
      campaignId: string,
      params: { date_start: string; date_stop: string; order_by?: string; action_type?: string; pack_ids?: string[] },
      options?: { signal?: AbortSignal }
    ): Promise<{ data: any[] }> => {
      const qs = new URLSearchParams()
      qs.set('date_start', params.date_start)
      qs.set('date_stop', params.date_stop)
      if (params.order_by) qs.set('order_by', params.order_by)
      if (params.action_type) qs.set('action_type', params.action_type)
      params.pack_ids?.forEach((packId) => {
        if (packId) qs.append('pack_ids', packId)
      })
      const query = qs.toString()
      return apiClient.get(`/analytics/rankings/campaign-id/${encodeURIComponent(campaignId)}/children${query ? `?${query}` : ''}`, { signal: options?.signal })
    },
    listPacks: (includeAds?: boolean): Promise<{ success: boolean; packs: any[] }> =>
      apiClient.get('/analytics/packs', { params: { include_ads: includeAds || false } }),
    getPack: (packId: string, includeAds: boolean = true): Promise<{ success: boolean; pack: any }> =>
      apiClient.get(`/analytics/packs/${packId}`, { params: { include_ads: includeAds } }),
    getPackThumbnailCache: (packId: string): Promise<{ success: boolean; pack_id: string; thumbnails: any[]; ready?: boolean; ready_count?: number; total?: number }> =>
      apiClient.get(`/analytics/packs/${packId}/thumbnail-cache`),
    deletePack: (packId: string, adIds: string[] = []): Promise<{ success: boolean; pack_id: string; stats: { pack_deleted: boolean; ads_deleted: number; metrics_deleted: number; storage_thumbs_candidates: number; storage_thumbs_deleted: number; storage_thumbs_kept: number } }> =>
      apiClient.deleteWithBody(`/analytics/packs/${packId}`, { ad_ids: adIds }),
    updatePackAutoRefresh: (packId: string, autoRefresh: boolean): Promise<{ success: boolean; pack_id: string; auto_refresh: boolean }> =>
      apiClient.patch(`/analytics/packs/${packId}/auto-refresh`, { auto_refresh: autoRefresh }),
    updatePackName: (packId: string, name: string): Promise<{ success: boolean; pack_id: string; name: string }> =>
      apiClient.patch(`/analytics/packs/${packId}/name`, { name }),
    /**
     * Overrides de julgamento do pack. Chave ausente = não mexe; chave com `null`
     * = limpa o override e volta a herdar de user_preferences. Por isso o payload
     * é montado pelo chamador, não normalizado aqui.
     */
    updatePackJudgment: (
      packId: string,
      // So os campos inerentes ao pack. diagnostic_cost_metric e controle de
      // visualizacao e vive em user_preferences — o backend recusa a chave.
      judgment: {
        mql_leadscore_min?: number | null
        target_cpr?: Record<string, number> | null
      }
    ): Promise<{ success: boolean; pack_id: string; judgment: Record<string, unknown> }> =>
      apiClient.patch(`/analytics/packs/${packId}/judgment`, judgment),
    /**
     * Histórico de ações do pack (P3.5). Qualquer membro lê — todos já veem os
     * efeitos das ações; esconder o autor não protegeria nada.
     *
     * Paginação por cursor (`before`), não por offset: o feed cresce pelo topo e
     * um offset passaria a apontar para a linha errada assim que entrasse ação nova.
     */
    getPackActivity: (
      packId: string,
      params: { limit?: number; before?: string; actorId?: string; signal?: AbortSignal } = {}
    ): Promise<PackActivityResponse> => {
      const qs = new URLSearchParams()
      if (params.limit !== undefined) qs.set('limit', String(params.limit))
      if (params.before) qs.set('before', params.before)
      if (params.actorId) qs.set('actor_id', params.actorId)
      const query = qs.toString()
      // `signal` threadado até o Axios: sem ele, sair da tela (ou deslogar) deixa
      // a request viva e o cancelamento do TanStack não chega ao backend.
      return apiClient.get(`/analytics/packs/${packId}/activity${query ? `?${query}` : ''}`, {
        signal: params.signal,
      })
    },
  },

  // Meta API usage (quota monitoring)
  metaUsage: {
    getSummary: (): Promise<MetaUsageSummaryResponse> =>
      apiClient.get('/meta-usage/summary'),

    listCalls: (params: MetaUsageCallsParams = {}): Promise<MetaUsageCallsResponse> => {
      const qs = new URLSearchParams()
      if (params.route) qs.set('route', params.route)
      if (params.service_name) qs.set('service_name', params.service_name)
      if (params.ad_account_id) qs.set('ad_account_id', params.ad_account_id)
      if (params.from) qs.set('from', params.from)
      if (params.to) qs.set('to', params.to)
      if (params.min_cputime !== undefined) qs.set('min_cputime', String(params.min_cputime))
      if (params.page !== undefined) qs.set('page', String(params.page))
      if (params.page_size !== undefined) qs.set('page_size', String(params.page_size))
      const query = qs.toString()
      return apiClient.get(`/meta-usage/calls${query ? `?${query}` : ''}`)
    },

    getDistinct: (): Promise<MetaUsageDistinctResponse> =>
      apiClient.get('/meta-usage/distinct'),
  },

  // User account management
  user: {
    deleteData: (): Promise<{ success: boolean; type: string; summary: Record<string, any> }> =>
      apiClient.delete('/user/data'),
    deleteAccount: (): Promise<{ success: boolean; type: string; summary: Record<string, any> }> =>
      apiClient.delete('/user/account'),
  },

  // Compartilhamento de packs entre usuarios (P3). NAO confundir com `shares`
  // (link publico com snapshot congelado) — aqui o dado permanece no silo do dono.
  packShares: {
    /**
     * Grafo de conflito cross-silo: pares de packs acessiveis que compartilham o
     * mesmo anuncio no mesmo dia entre DONOS diferentes. Alimenta o bloqueio de
     * selecao (camada 1) e o estado bloqueante (camada 3). Mesmo dono nunca conflita.
     */
    getConflicts: (
      packIds: string[],
      options?: { signal?: AbortSignal }
    ): Promise<{ success: boolean; pairs: [string, string][] }> => {
      const qs = new URLSearchParams()
      packIds.forEach((packId) => {
        if (packId) qs.append('pack_ids', packId)
      })
      return apiClient.get(`/pack-shares/conflicts?${qs.toString()}`, { signal: options?.signal })
    },
    /** Passo 1 do convite: e-mail EXATO -> (user_id, nome). 404 nunca; found=false. */
    lookupUser: (email: string): Promise<{ found: boolean; user_id?: string | null; display_name?: string | null }> =>
      apiClient.get(`/pack-shares/lookup?email=${encodeURIComponent(email)}`),
    /** Convidados de um pack. Só o dono enxerga (404 para os demais). */
    listShares: (packId: string): Promise<{ success: boolean; pack_id: string; shares: Array<{ id: string; grantee_id: string; display_name: string | null; role: 'editor' | 'viewer'; created_at: string }> }> =>
      apiClient.get(`/pack-shares/${packId}`),
    create: (packId: string, granteeId: string, role: 'editor' | 'viewer'): Promise<{ success: boolean }> =>
      apiClient.post(`/pack-shares/${packId}`, { grantee_id: granteeId, role }),
    updateRole: (packId: string, granteeId: string, role: 'editor' | 'viewer'): Promise<{ success: boolean }> =>
      apiClient.patch(`/pack-shares/${packId}/${granteeId}`, { role }),
    revoke: (packId: string, granteeId: string): Promise<{ success: boolean }> =>
      apiClient.delete(`/pack-shares/${packId}/${granteeId}`),
    /** Convidado sai do pack sem depender do dono. */
    leave: (packId: string): Promise<{ success: boolean }> =>
      apiClient.delete(`/pack-shares/${packId}/me`),
  },

  /**
   * Tags de criativo. A marcacao e por `ad_name` (criativo), nunca por ad_id —
   * o mesmo criativo roda em dezenas de anuncios e a tag descreve o criativo.
   * As tags sao pessoais: num pack compartilhado cada um ve as suas.
   */
  tags: {
    list: (options?: { signal?: AbortSignal }): Promise<{ data: TagItem[] }> =>
      apiClient.get('/tags', { signal: options?.signal }),
    create: (name: string, color: string): Promise<{ data: TagItem }> =>
      apiClient.post('/tags', { name, color }),
    update: (tagId: string, patch: { name?: string; color?: string }): Promise<{ data: TagItem }> =>
      apiClient.patch(`/tags/${tagId}`, patch),
    remove: (tagId: string): Promise<{ deleted: boolean; id: string }> =>
      apiClient.delete(`/tags/${tagId}`),
    /** Idempotente: reaplicar a mesma tag no mesmo criativo nao duplica nem falha. */
    assign: (tagIds: string[], adNames: string[]): Promise<TagAssignResult> =>
      apiClient.post('/tags/assign', { tag_ids: tagIds, ad_names: adNames }),
    unassign: (tagIds: string[], adNames: string[]): Promise<TagAssignResult> =>
      apiClient.post('/tags/unassign', { tag_ids: tagIds, ad_names: adNames }),
  },

  // Google Sheets integration (ads enrichment)
  integrations: {
    google: {
      getAuthUrl: (state: string, redirectUri?: string): Promise<AuthUrlResponse> =>
        apiClient.post('/integrations/google/auth-url', {
          redirect_uri: redirectUri || env.FB_REDIRECT_URI,
          state,
        }),

      exchangeCode: (code: string, redirectUri: string, packId?: string): Promise<{ connection: { id: string; scopes?: string[] } }> =>
        apiClient.post('/integrations/google/callback', {
          code,
          redirect_uri: redirectUri,
          // Pack compartilhado (Opcao B): direciona a credencial ao silo do dono; o
          // backend valida dono|editor via assert_pack_role antes de gravar.
          ...(packId ? { pack_id: packId } : {}),
        }),

      listConnections: (): Promise<ListGoogleConnectionsResponse> =>
        apiClient.get('/integrations/google/connections'),

      deleteConnection: (connectionId: string): Promise<{ success: boolean }> =>
        apiClient.delete(`/integrations/google/connections/${encodeURIComponent(connectionId)}`),

      testConnection: (connectionId: string): Promise<{ valid: boolean; expired?: boolean; message?: string }> =>
        apiClient.get(`/integrations/google/connections/${encodeURIComponent(connectionId)}/test`),

      listSpreadsheets: (params?: { query?: string; page_size?: number; page_token?: string; connection_id?: string }): Promise<ListSpreadsheetsResponse> =>
        apiClient.get('/integrations/google/spreadsheets', { params }),

      listWorksheets: (spreadsheetId: string, connectionId?: string): Promise<ListWorksheetsResponse> =>
        apiClient.get(`/integrations/google/spreadsheets/${encodeURIComponent(spreadsheetId)}/worksheets`, {
          params: connectionId ? { connection_id: connectionId } : undefined,
        }),

      listColumns: (spreadsheetId: string, worksheetTitle: string, connectionId?: string): Promise<SheetColumnsResponse> =>
        apiClient.get(
          `/integrations/google/sheets/${encodeURIComponent(
            spreadsheetId,
          )}/worksheets/${encodeURIComponent(worksheetTitle)}/columns`,
          {
            params: connectionId ? { connection_id: connectionId } : undefined,
          },
        ),

      saveSheetIntegration: (payload: SheetIntegrationRequest): Promise<SaveSheetIntegrationResponse> =>
        apiClient.post('/integrations/google/ad-sheet-integrations', payload),

      startSyncJob: (integrationId: string): Promise<{ job_id: string }> =>
        apiClient.post(`/integrations/google/ad-sheet-integrations/${integrationId}/sync-job`),

      getSyncJobProgress: (jobId: string): Promise<SheetSyncJobProgress> =>
        apiClient.get(`/integrations/google/sync-jobs/${encodeURIComponent(jobId)}`),

      listSheetIntegrations: (packId?: string): Promise<{ integrations: any[] }> =>
        apiClient.get('/integrations/google/ad-sheet-integrations', { params: packId ? { pack_id: packId } : {} }),

      deleteSheetIntegration: (integrationId: string): Promise<{ success: boolean }> =>
        apiClient.delete(`/integrations/google/ad-sheet-integrations/${encodeURIComponent(integrationId)}`),
    },
  },

  // Billing (Stripe)
  billing: {
    createCheckoutSession: (
      plan: 'monthly' | 'annual',
      paymentMethod: 'card' | 'pix' = 'card'
    ): Promise<{ url: string }> =>
      apiClient.post('/billing/checkout-session', { plan, payment_method: paymentMethod }),

    createPortalSession: (): Promise<{ url: string }> =>
      apiClient.post('/billing/portal-session'),

    // Reconcilia a assinatura direto com a Stripe (recuperação de webhook perdido/atrasado)
    syncSubscription: (): Promise<{
      synced: boolean
      stripe_status?: string
      tier: 'standard' | 'insider' | 'admin'
    }> => apiClient.post('/billing/sync'),
  },

  // Shares (links públicos de criativos em stories — /s/[token])
  shares: {
    // Resolve mídia na Meta (cache-first) — pode demorar em links com muitos vídeos
    create: (payload: CreateSharePayload): Promise<CreateShareResponse> =>
      apiClient.post('/shares', payload, { timeout: 300000 }),

    list: (): Promise<{ shares: ShareSummary[] }> =>
      apiClient.get('/shares'),

    revoke: (shareId: string): Promise<{ ok: boolean }> =>
      apiClient.delete(`/shares/${encodeURIComponent(shareId)}`),
  },

  // Admin
  admin: {
    listUsers: (): Promise<AdminUser[]> =>
      apiClient.get('/admin/users'),

    updateUserTier: (userId: string, tier: 'standard' | 'insider' | 'admin'): Promise<AdminUser> =>
      apiClient.patch(`/admin/users/${userId}/tier`, { tier }),
  },
}

export interface AdminUser {
  user_id: string
  email: string
  name: string
  tier: 'standard' | 'insider' | 'admin'
  meta_email: string | null
  packs_count: number
  created_at: string | null
  expires_at: string | null
  updated_at: string | null
  granted_by: string | null
}
