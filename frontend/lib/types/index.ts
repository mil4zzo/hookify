import { FacebookUser, FacebookAdAccount, FormattedAd, FilterRule, SheetIntegration } from '../api/schemas'
import type { LeadEconomics } from '../utils/leadEconomics'

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
  stats?: {
    totalSpend: number
    uniqueAds: number
    uniqueAdNames: number
    uniqueCampaigns: number
    uniqueAdsets: number
  }
  sheet_integration?: SheetIntegration & {
    spreadsheet_name?: string // Adicionado pelo backend ao buscar nomes das planilhas
    // 147: nome com que o vínculo NASCEU, quando o arquivo foi renomeado desde então.
    // Sobrevive à revalidação passiva de propósito: consertar o nome em silêncio
    // apagaria a evidência de que aquela planilha pode não ser mais a mesma.
    // Limpo pelo primeiro sync que aplica linhas.
    spreadsheet_renamed_from?: string | null
  }
  last_refreshed_at?: string // Data do último refresh no formato YYYY-MM-DD
  // ── Refresh em andamento, legível por QUALQUER membro (pack compartilhado) ──
  // O estado local (`updatingPacks`) só conhece o refresh disparado nesta aba.
  // Estes dois campos vêm do banco e são do pack, não de quem disparou.
  // `refresh_lock_until` é o prazo de validade do 'running' — sempre leia os dois
  // juntos, via `isPackRefreshingOnServer()`, nunca o status sozinho.
  refresh_status?: 'idle' | 'queued' | 'running' | 'cancel_requested' | 'canceled' | 'success' | 'failed' | null
  refresh_lock_until?: string | null
  // Nome de quem disparou. NULO quando é você mesmo (o backend omite de propósito:
  // "Atualizando por <você>" é ruído) ou quando o nome não pôde ser resolvido.
  refresh_actor_name?: string | null
  // Lista materializada (union incremental no refresh) dos conversion types do pack.
  // Chaves: 'conversion:<type>' / 'action:<type>'. Fonte do dropdown de eventos no Manager.
  conversion_types?: string[]
  // ── Janela de atribuição (migration 143) ───────────────────────────────────
  // Recuo (dias) do refresh "desde a última atualização": a Meta só conta a
  // conversão se o clique estiver dentro da janela consultada, então o refresh
  // recua pela janela de atribuição da conta. Vem das linhas do /insights
  // (`attribution_setting`, ex. '1d_view_7d_click'); null = ainda não calibrado
  // (o backend recua 7 até a primeira carga).
  attribution_window_days?: number | null
  attribution_setting?: string | null
  // ── Configuração de julgamento (inerente ao pack) ──────────────────────────
  // Sem herança de user_preferences: null/undefined = NÃO DEFINIDO.
  // Sem corte de leadscore, MQL e CPMQL ficam indisponíveis — nunca zero.
  mql_leadscore_min?: number | null
  target_cpr?: Record<string, number> | null
  // Economia do lead (migration 179): produtos e faixas de nota que dão o teto de
  // CPL e a margem por anúncio. null/undefined = não configurado (colunas
  // indisponíveis, nunca zero). Cru do banco: só vale depois de
  // `normalizeLeadEconomics`, que `resolveJudgment` já aplica.
  lead_economics?: LeadEconomics | null
  // ── Compartilhamento (P3.7) ────────────────────────────────────────────────
  // Presente APENAS em packs recebidos de outra conta. Ausente = pack próprio.
  // O papel gateia a UI; a autorização real é do backend (assert_pack_role).
  shared_role?: 'editor' | 'viewer' | null
  shared_owner_name?: string | null
  /** O acesso vem de uma pasta compartilhada (181): o editor dela age como o dono, inclusive exclui. */
  shared_via_folder?: boolean
  /** Dono do pack (o silo). Numa pasta compartilhada, o pack posto pelo editor é dele. */
  owner_id?: string
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

/**
 * Pasta da Biblioteca (migration 168). Na árvore do próprio usuário, é de QUEM
 * ORGANIZA: um convidado arquiva pack compartilhado na pasta dele sem tocar no pack.
 *
 * Pasta compartilhada (migration 181), como no Drive: quem recebe vê a MESMA pasta
 * do dono, com o papel dele nela em `access`. A pasta compartilhada mais alta de cada
 * ramo chega com `shared_root` e `parent_id` nulo — é a raiz do que ele enxerga.
 */
export interface PackFolder {
  id: string
  name: string
  parent_id: string | null
  position: number
  created_at?: string
  updated_at?: string
  /** Papel do usuário na pasta. Ausente = da árvore dele (como 'dono'). */
  access?: 'dono' | 'editor' | 'viewer'
  /** Dono da árvore onde a pasta mora. */
  owner_id?: string
  /** Nome do dono, nas pastas compartilhadas com o usuário. */
  owner_name?: string | null
  shared_root?: boolean
}

/** Convite DIRETO num pack do usuário: a pasta o absorve ao cobrir a pessoa (181). */
export interface DirectShareEntry {
  pack_id: string
  grantee_id: string
  role: 'editor' | 'viewer'
}

/** {pack_id: folder_id} — o vínculo, resolvido no cliente sobre os packs já carregados. */
export type PackFolderMembers = Record<string, string>

/**
 * Pasta compartilhada (migration 181): a pasta é de `grantee_id`, com este papel, com
 * tudo que tem debaixo dela hoje e o que entrar depois. A lista é a do dono da pasta.
 */
export interface FolderShareEntry {
  folder_id: string
  grantee_id: string
  display_name?: string | null
  role: 'editor' | 'viewer'
}

/** O que uma pasta compartilhada cobre: subpastas, packs do dono e packs que não são dele (ficam de fora). */
export interface FolderShareScope {
  subfolders: number
  owned_packs: number
  foreign_packs: number
}

/** Uma linha de `/folder-shares/{id}`: a pessoa na pasta (própria ou herdada das de cima). */
export interface FolderShareMember {
  id: string
  folder_id: string
  folder_name: string | null
  grantee_id: string
  display_name: string | null
  role: 'editor' | 'viewer'
  created_at: string
}

export interface FolderShareDetail {
  success: boolean
  folder: { id: string; name: string }
  shares: FolderShareMember[]
  /** Compartilhamentos das pastas de cima: valem aqui também e só se mudam lá. */
  inherited: FolderShareMember[]
  scope: FolderShareScope
}

/** Quanto acesso um gesto de pasta concedeu/retirou (pares pack × pessoa). */
export interface FolderAccessChanges {
  granted: number
  revoked: number
  changed: number
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
