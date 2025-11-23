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
  DashboardRequest,
  DashboardResponse,
  RankingsChildrenItem,
  AdCreativeResponse,
  ListSpreadsheetsResponse,
  ListWorksheetsResponse,
  ListGoogleConnectionsResponse,
  SheetColumnsResponse,
  SheetIntegrationRequest,
  SaveSheetIntegrationResponse,
  SheetSyncResponse,
} from './schemas'
import { env } from '@/lib/config/env'

export const api = {
  // Health check
  health: {
    check: (): Promise<{ status: string; service: string; version: string }> =>
      apiClient.get('/health'),
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
    
    getJobProgress: (jobId: string): Promise<{ status: string; progress: number; message: string; data?: any }> =>
      apiClient.getWithTimeout(`/facebook/ads-progress/${jobId}`, 300000), // 5 minutos para getJobProgress (backend pode estar processando)
    
    getVideoSource: (params: GetVideoSourceRequest): Promise<GetVideoSourceResponse> =>
      apiClient.get('/facebook/video-source', { params }),
    
    refreshPack: (packId: string, untilDate: string): Promise<{ job_id: string; status: string; message: string; pack_id: string; date_range: { since: string; until: string } }> =>
      apiClient.post(`/facebook/refresh-pack/${packId}`, { until_date: untilDate }),
  },

  // Analytics (Supabase)
  analytics: {
    getDashboard: (params: DashboardRequest): Promise<DashboardResponse> =>
      apiClient.post('/analytics/dashboard', params),
    getRankings: (params: RankingsRequest): Promise<RankingsResponse> =>
      apiClient.post('/analytics/rankings', params),
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

      listSpreadsheets: (params?: { query?: string; page_size?: number; page_token?: string }): Promise<ListSpreadsheetsResponse> =>
        apiClient.get('/integrations/google/spreadsheets', { params }),

      listWorksheets: (spreadsheetId: string): Promise<ListWorksheetsResponse> =>
        apiClient.get(`/integrations/google/spreadsheets/${encodeURIComponent(spreadsheetId)}/worksheets`),

      listColumns: (spreadsheetId: string, worksheetTitle: string): Promise<SheetColumnsResponse> =>
        apiClient.get(
          `/integrations/google/sheets/${encodeURIComponent(
            spreadsheetId,
          )}/worksheets/${encodeURIComponent(worksheetTitle)}/columns`,
        ),

      saveSheetIntegration: (payload: SheetIntegrationRequest): Promise<SaveSheetIntegrationResponse> =>
        apiClient.post('/integrations/google/ad-sheet-integrations', payload),

      syncSheetIntegration: (integrationId: string): Promise<SheetSyncResponse> =>
        apiClient.post(`/integrations/google/ad-sheet-integrations/${integrationId}/sync`),

      listSheetIntegrations: (packId?: string): Promise<{ integrations: any[] }> =>
        apiClient.get('/integrations/google/ad-sheet-integrations', { params: packId ? { pack_id: packId } : {} }),
    },
  },
}
