import { apiClient } from './client'
import {
  GetMeResponse,
  GetAdAccountsResponse,
  GetAdsRequest,
  GetAdsResponse,
  GetVideoSourceRequest,
  GetVideoSourceResponse,
  AuthTokenRequest,
  AuthTokenResponse,
  AuthUrlResponse,
} from './schemas'
import { env } from '@/lib/config/env'

export const api = {
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
    
    getAdAccounts: (): Promise<GetAdAccountsResponse> =>
      apiClient.get('/facebook/adaccounts'),
    
    getAds: (params: GetAdsRequest): Promise<GetAdsResponse> =>
      apiClient.postAds('/facebook/ads', params),
    
    startAdsJob: (params: GetAdsRequest): Promise<{ job_id: string; status: string; message: string }> =>
      apiClient.post('/facebook/ads-progress', params),
    
    getJobProgress: (jobId: string): Promise<{ status: string; progress: number; message: string; data?: any }> =>
      apiClient.get(`/facebook/ads-progress/${jobId}`),
    
    getVideoSource: (params: GetVideoSourceRequest): Promise<GetVideoSourceResponse> =>
      apiClient.get('/facebook/video-source', { params }),
  },
}
