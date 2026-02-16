import { apiClient } from './client'
import {
  GetMeResponse,
  GetAdsRequest,
  GetAdsResponse,
  GetVideoSourceRequest,
  GetVideoSourceResponse,
  AuthTokenRequest,
  AuthTokenResponse,
  AuthUrlResponse,
  RankingsRequest,
  RankingsResponse,
  RankingsChildrenItem,
  AdCreativeResponse,
  GlobalSearchResponse,
  ListSpreadsheetsResponse,
  ListWorksheetsResponse,
  ListGoogleConnectionsResponse,
  SheetColumnsResponse,
  SheetIntegrationRequest,
  SaveSheetIntegrationResponse,
  SheetSyncResponse,
  SheetSyncJobProgress,
  UpdateEntityStatusResponse,
} from './schemas'
import { env } from '@/lib/config/env'

// Tipos simples para o fluxo de onboarding inicial
export interface OnboardingStatusResponse {
  has_completed_onboarding: boolean
  facebook_connected: boolean
  validation_criteria_configured: boolean
}

export type OnboardingCompleteResponse = OnboardingStatusResponse

export interface InitialSettingsRequest {
  language: string
  currency: string
  niche?: string
}

export type InitialSettingsResponse = OnboardingStatusResponse

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
    saveInitialSettings: (data: InitialSettingsRequest): Promise<InitialSettingsResponse> =>
      apiClient.post('/onboarding/initial-settings', data),
    complete: (): Promise<OnboardingCompleteResponse> =>
      apiClient.post('/onboarding/complete'),
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
    
    getAdAccounts: (): Promise<any[]> =>
      apiClient.get('/facebook/adaccounts'),
    
    syncAdAccounts: (): Promise<{ ok: boolean; count: number }> =>
      apiClient.post('/facebook/adaccounts/sync'),
    
    getAds: (params: GetAdsRequest): Promise<GetAdsResponse> =>
      apiClient.postAds('/facebook/ads', params),
    
    startAdsJob: (params: GetAdsRequest): Promise<{ job_id: string; status: string; message: string }> =>
      apiClient.post('/facebook/ads-progress', params),
    
    getJobProgress: (jobId: string): Promise<{ status: string; progress: number; message: string; data?: any; pack_id?: string; result_count?: number; details?: any }> =>
      apiClient.getWithTimeout(`/facebook/ads-progress/${jobId}`, 60000), // 60 segundos (requests agora são rápidos com arquitetura "2 fases")
    
    getVideoSource: (params: GetVideoSourceRequest): Promise<GetVideoSourceResponse> =>
      apiClient.get('/facebook/video-source', { params }),
    
    refreshPack: (packId: string, untilDate: string, refreshType: "since_last_refresh" | "full_period" = "since_last_refresh"): Promise<{ job_id: string; status: string; message: string; pack_id: string; date_range: { since: string; until: string } }> =>
      apiClient.post(`/facebook/refresh-pack/${packId}`, { until_date: untilDate, refresh_type: refreshType }),
    
    cancelJobsBatch: (jobIds: string[], reason?: string): Promise<{ cancelled_count: number; total_requested: number; message: string }> =>
      apiClient.post('/facebook/jobs/cancel-batch', { job_ids: jobIds, reason: reason || 'Cancelado durante logout' }),

    updateAdStatus: (adId: string, status: "PAUSED" | "ACTIVE"): Promise<UpdateEntityStatusResponse> =>
      apiClient.post(`/facebook/ads/${encodeURIComponent(adId)}/status`, { status }),

    updateAdsetStatus: (adsetId: string, status: "PAUSED" | "ACTIVE"): Promise<UpdateEntityStatusResponse> =>
      apiClient.post(`/facebook/adsets/${encodeURIComponent(adsetId)}/status`, { status }),

    updateCampaignStatus: (campaignId: string, status: "PAUSED" | "ACTIVE"): Promise<UpdateEntityStatusResponse> =>
      apiClient.post(`/facebook/campaigns/${encodeURIComponent(campaignId)}/status`, { status }),
  },

  // Analytics (Supabase)
  analytics: {
    // Endpoint histórico, mantido por compatibilidade
    getRankings: (params: RankingsRequest): Promise<RankingsResponse> =>
      apiClient.post('/analytics/rankings', params),
    // Alias semântico para evolução futura: mesma payload, rota nova
    getAdPerformance: (params: RankingsRequest): Promise<RankingsResponse> =>
      apiClient.post('/analytics/ad-performance', params),
    getRankingsChildren: (
      adName: string,
      params: { date_start: string; date_stop: string; order_by?: string }
    ): Promise<{ data: any[] }> =>
      apiClient.get(`/analytics/rankings/ad-name/${encodeURIComponent(adName)}/children`, { params }),
    getAdDetails: (
      adId: string,
      params: { date_start: string; date_stop: string }
    ): Promise<RankingsChildrenItem> =>
      apiClient.get(`/analytics/rankings/ad-id/${encodeURIComponent(adId)}`, { params }),
    getAdCreative: (adId: string): Promise<AdCreativeResponse> =>
      apiClient.get(`/analytics/rankings/ad-id/${encodeURIComponent(adId)}/creative`),
    getAdHistory: (
      adId: string,
      params: { date_start: string; date_stop: string }
    ): Promise<{ data: any[] }> =>
      apiClient.get(`/analytics/rankings/ad-id/${encodeURIComponent(adId)}/history`, { params }),
    getAdNameHistory: (
      adName: string,
      params: { date_start: string; date_stop: string }
    ): Promise<{ data: any[] }> =>
      apiClient.get(`/analytics/rankings/ad-name/${encodeURIComponent(adName)}/history`, { params }),
    getAdsetDetails: (
      adsetId: string,
      params: { date_start: string; date_stop: string }
    ): Promise<any> =>
      apiClient.get(`/analytics/rankings/adset-id/${encodeURIComponent(adsetId)}`, { params }),
    getAdsetChildren: (
      adsetId: string,
      params: { date_start: string; date_stop: string; order_by?: string }
    ): Promise<{ data: any[] }> =>
      apiClient.get(`/analytics/rankings/adset-id/${encodeURIComponent(adsetId)}/children`, { params }),
    searchGlobal: (query: string, limit: number = 20): Promise<GlobalSearchResponse> =>
      apiClient.get('/analytics/search', { params: { query, limit } }),
    getCampaignChildren: (
      campaignId: string,
      params: { date_start: string; date_stop: string; order_by?: string }
    ): Promise<{ data: any[] }> =>
      apiClient.get(`/analytics/rankings/campaign-id/${encodeURIComponent(campaignId)}/children`, { params }),
    listPacks: (includeAds?: boolean): Promise<{ success: boolean; packs: any[] }> =>
      apiClient.get('/analytics/packs', { params: { include_ads: includeAds || false } }),
    getPack: (packId: string, includeAds: boolean = true): Promise<{ success: boolean; pack: any }> =>
      apiClient.get(`/analytics/packs/${packId}`, { params: { include_ads: includeAds } }),
    deletePack: (packId: string, adIds: string[] = []): Promise<{ success: boolean; pack_id: string; stats: { pack_deleted: boolean; ads_deleted: number; metrics_deleted: number } }> =>
      apiClient.deleteWithBody(`/analytics/packs/${packId}`, { ad_ids: adIds }),
    updatePackAutoRefresh: (packId: string, autoRefresh: boolean): Promise<{ success: boolean; pack_id: string; auto_refresh: boolean }> =>
      apiClient.patch(`/analytics/packs/${packId}/auto-refresh`, { auto_refresh: autoRefresh }),
    updatePackName: (packId: string, name: string): Promise<{ success: boolean; pack_id: string; name: string }> =>
      apiClient.patch(`/analytics/packs/${packId}/name`, { name }),
  },

  // User account management
  user: {
    deleteData: (): Promise<{ success: boolean; type: string; summary: Record<string, any> }> =>
      apiClient.delete('/user/data'),
    deleteAccount: (): Promise<{ success: boolean; type: string; summary: Record<string, any> }> =>
      apiClient.delete('/user/account'),
  },

  // Google Sheets integration (ads enrichment)
  integrations: {
    google: {
      getAuthUrl: (state: string, redirectUri?: string): Promise<AuthUrlResponse> =>
        apiClient.post('/integrations/google/auth-url', {
          redirect_uri: redirectUri || env.FB_REDIRECT_URI,
          state,
        }),

      exchangeCode: (code: string, redirectUri: string): Promise<{ connection: { id: string; scopes?: string[] } }> =>
        apiClient.post('/integrations/google/callback', {
          code,
          redirect_uri: redirectUri,
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

      syncSheetIntegration: (integrationId: string): Promise<SheetSyncResponse> =>
        apiClient.post(`/integrations/google/ad-sheet-integrations/${integrationId}/sync`),

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
}
