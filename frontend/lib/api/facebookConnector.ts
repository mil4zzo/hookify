import { apiClient } from '@/lib/api/client'

export const facebookConnectorApi = {
  async getAuthUrl(redirect_uri: string, state?: string) {
    const params = new URLSearchParams({ redirect_uri })
    if (state) params.set('state', state)
    return apiClient.post<{ auth_url: string }>(`/facebook/connect/url?${params.toString()}`)
  },

  async callback(code: string, redirect_uri: string) {
    return apiClient.post<{ connection: any }>(`/facebook/connect/callback`, { code, redirect_uri })
  },

  async listConnections() {
    return apiClient.get<any[]>(`/facebook/connections`)
  },

  async deleteConnection(id: string) {
    return apiClient.delete(`/facebook/connections/${id}`)
  },

  async setPrimary(id: string) {
    return apiClient.post(`/facebook/connections/${id}/primary`)
  },

  async testConnection(id: string) {
    return apiClient.get<{ valid: boolean; expired?: boolean; message?: string }>(`/facebook/connections/${id}/test`)
  },
}


