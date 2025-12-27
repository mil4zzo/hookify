import { FacebookUser, FacebookAdAccount, FormattedAd, FilterRule, SheetIntegration } from '../api/schemas'

// Pack de Ads (equivalente ao sistema atual do Streamlit)
export interface AdsPack {
  id: string
  name: string
  adaccount_id: string
  date_start: string
  date_stop: string
  level: 'campaign' | 'adset' | 'ad'
  filters?: FilterRule[]
  ads: FormattedAd[]
  auto_refresh?: boolean
  stats?: {  // Stats agregados do pack (calculados no backend)
    totalAds: number
    uniqueAds: number
    uniqueCampaigns: number
    uniqueAdsets: number
    totalSpend: number
    totalClicks: number
    totalImpressions: number
    totalReach: number
    totalInlineLinkClicks: number
    totalPlays: number
    totalThruplays: number
    ctr: number
    cpm: number
    frequency: number
    // Métricas adicionais agregadas
    holdRate?: number
    connectRate?: number
    websiteCtr?: number
    profileCtr?: number
    videoWatchedP50?: number
    totalLandingPageViews?: number
    actions?: Record<string, number>  // {action_type: total_value}
    conversions?: Record<string, number>  // {action_type: total_value}
  }
  sheet_integration?: SheetIntegration & {
    spreadsheet_name?: string // Adicionado pelo backend ao buscar nomes das planilhas
  }
  created_at: string
  updated_at: string
}

// Estado da sessão
export interface SessionState {
  // Autenticação
  accessToken: string | null
  user: FacebookUser | null
  
  // Dados do Facebook
  adAccounts: FacebookAdAccount[]
  
  // Packs de Ads
  packs: AdsPack[]
  
  // Estado da UI
  isLoading: boolean
  error: string | null
}

// Ações do store
export interface SessionActions {
  // Autenticação
  setAccessToken: (token: string | null) => void
  setUser: (user: FacebookUser | null) => void
  logout: () => void
  
  // Dados do Facebook
  setAdAccounts: (accounts: FacebookAdAccount[]) => void
  
  // Packs de Ads
  addPack: (pack: AdsPack) => void
  removePack: (packId: string) => void
  updatePack: (packId: string, updates: Partial<AdsPack>) => void
  
  // Estado da UI
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  clearError: () => void
}

// Store completo
export type SessionStore = SessionState & SessionActions

// Tipos para filtros e busca
export interface AdsFilter {
  adaccount_id?: string
  date_start?: string
  date_stop?: string
  level?: 'campaign' | 'adset' | 'ad'
  status?: string
  campaign_id?: string
  adset_id?: string
}

export interface AdsSearchParams {
  query?: string
  filters?: AdsFilter
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
  page?: number
  limit?: number
}

// Tipos para métricas e analytics
export interface AdMetrics {
  impressions: number
  clicks: number
  inline_link_clicks: number
  spend: number
  reach: number
  frequency: number
  cpm: number
  cpc: number
  ctr: number
  cpp: number
}

export interface PackMetrics {
  pack_id: string
  total_ads: number
  total_impressions: number
  total_clicks: number
  total_inline_link_clicks: number
  total_spend: number
  avg_cpm: number
  avg_cpc: number
  avg_ctr: number
}

// Tipos para configurações
export interface AppConfig {
  theme: 'dark' | 'light'
  language: 'pt-BR' | 'en-US'
  dateFormat: string
  currency: string
  timezone: string
}

// Tipos para notificações
export interface Notification {
  id: string
  type: 'success' | 'error' | 'warning' | 'info'
  title: string
  message: string
  timestamp: string
  read: boolean
}
