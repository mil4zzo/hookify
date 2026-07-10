import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios'
import * as Sentry from '@sentry/nextjs'
import { parseError, AppError } from '@/lib/utils/errors'
import { env } from '@/lib/config/env'
import { getSupabaseClient } from '@/lib/supabase/client'

const SESSION_CACHE_TTL_MS = 30_000
// Refresca o token proativamente quando falta menos que isso para expirar, em vez
// de mandar um token vencido (ou nenhum) e tomar 401 → logout global.
const EXPIRY_MARGIN_MS = 60_000

type SessionCacheEntry = {
  session: { access_token?: string; expires_at?: number } | null
  expiresAt: number
}

let sessionCache: SessionCacheEntry | null = null
let loggingOut = false
let authSessionExpiredNotified = false
// Refresh em voo compartilhado: vários requests batendo 401/near-expiry ao mesmo
// tempo (ex.: os polls de um refresh de packs) disparam UM único refreshSession e
// recebem o mesmo token novo — evita tempestade de refreshes concorrentes.
let refreshPromise: Promise<string | null> | null = null

export const AUTH_SESSION_EXPIRED_EVENT = 'hookify:auth-session-expired'

export function invalidateSessionCache() {
  sessionCache = null
}

export function setLoggingOut(value: boolean) {
  loggingOut = value
}

export function getIsLoggingOut() {
  return loggingOut
}

export function notifyAuthSessionExpired(detail?: { source?: string }) {
  if (typeof window === 'undefined' || authSessionExpiredNotified) return

  authSessionExpiredNotified = true
  window.dispatchEvent(new CustomEvent(AUTH_SESSION_EXPIRED_EVENT, { detail }))
}

function isAppAuthUnauthorized(error: any) {
  const detail = error?.response?.data?.detail
  if (typeof detail !== 'string') return false

  const message = detail.toLowerCase()
  return (
    message.includes('missing bearer token') ||
    message.includes('invalid token payload') ||
    message.includes('invalid token key') ||
    message.includes('token missing key id') ||
    message.includes('token expired') ||
    message.includes('invalid or expired token') ||
    message.includes('token validation')
  )
}

/**
 * Refresca a sessão do Supabase de forma deduplicada: chamadas concorrentes
 * compartilham UM único refresh e recebem o mesmo token novo. Atualiza o
 * sessionCache com a sessão nova. Retorna null se o refresh falhar (refresh token
 * realmente expirado/revogado) — nesse caso o caller decide o logout.
 */
async function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise

  refreshPromise = (async () => {
    try {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.auth.refreshSession()
      if (error || !data.session) {
        return null
      }
      sessionCache = {
        session: data.session,
        expiresAt: Date.now() + SESSION_CACHE_TTL_MS,
      }
      return data.session.access_token ?? null
    } catch {
      return null
    } finally {
      refreshPromise = null
    }
  })()

  return refreshPromise
}

/**
 * Retorna um access token válido para anexar à requisição, refrescando
 * proativamente se a sessão sumiu do cache ou está perto de expirar. Só retorna
 * null se não há sessão E o refresh também falhou — nunca "estripa" um token que
 * ainda dá pra usar (era o que gerava o 401 "Missing Bearer token" → logout).
 */
async function getValidAccessToken(): Promise<string | null> {
  let session: { access_token?: string; expires_at?: number } | null = null

  if (sessionCache && Date.now() < sessionCache.expiresAt) {
    session = sessionCache.session
  } else {
    const supabase = getSupabaseClient()
    const { data, error } = await supabase.auth.getSession()
    if (error) {
      if (env.NODE_ENV !== 'production') {
        console.warn('[API Client] Erro ao buscar sessão:', error.message)
      }
      // Sessão ilegível — tenta refrescar antes de desistir do token.
      return refreshAccessToken()
    }
    session = data.session ?? null
    sessionCache = {
      session,
      expiresAt: Date.now() + SESSION_CACHE_TTL_MS,
    }
  }

  const accessToken = session?.access_token
  const expiresAtMs = session?.expires_at ? session.expires_at * 1000 : null
  const nearExpiry = expiresAtMs !== null && expiresAtMs - Date.now() < EXPIRY_MARGIN_MS

  // Token presente e longe de expirar → usa direto.
  if (accessToken && !nearExpiry) {
    return accessToken
  }

  // Ausente ou perto/depois de expirar → refresca proativamente.
  const refreshed = await refreshAccessToken()
  if (refreshed) return refreshed

  // Refresh falhou mas ainda temos um token (mesmo perto de expirar): manda ele —
  // o backend tem leeway de clock skew e, se vier 401, o response interceptor ainda
  // faz refresh+retry antes de qualquer logout. Melhor que estripar e forçar o 401.
  return accessToken ?? null
}

class ApiClient {
  private client: AxiosInstance

  constructor() {
    this.client = axios.create({
      baseURL: env.API_BASE_URL,
      timeout: 120000, // 2 minutos para requisições gerais
      headers: {
        'Content-Type': 'application/json',
      },
    })

    this.setupInterceptors()
  }

  private setupInterceptors() {
    // Request interceptor - adiciona JWT do Supabase (com cache para reduzir corridas e 401 iniciais)
    this.client.interceptors.request.use(
      async (config) => {
        if (loggingOut) {
          return Promise.reject({ cancelled: true, status: 0, message: 'Request cancelled: logout in progress' })
        }
        if (typeof window !== 'undefined') {
          try {
            // Nunca estripar o token quando a sessão está perto de expirar — isso
            // gerava um 401 "Missing Bearer token" que disparava logout global.
            // getValidAccessToken refresca proativamente e só devolve null se o
            // refresh realmente falhar.
            const accessToken = await getValidAccessToken()

            if (accessToken) {
              config.headers.Authorization = `Bearer ${accessToken}`
            } else if (config.headers && 'Authorization' in config.headers) {
              delete (config.headers as any).Authorization
            }

            config.headers['X-Page-Route'] = window.location.pathname

            if (!accessToken && env.NODE_ENV !== 'production' && config.url) {
              console.warn(`[API Client] Requisição sem token (sessão ausente e refresh falhou) para: ${config.url}`)
            }
          } catch (err) {
            if (config.headers && 'Authorization' in config.headers) {
              delete (config.headers as any).Authorization
            }
            if (env.NODE_ENV !== 'production') {
              console.error('[API Client] Erro inesperado ao configurar autenticação:', err)
            }
          }
        }
        return config
      },
      (error) => {
        return Promise.reject(parseError(error))
      }
    )

    // Response interceptor - trata erros
    this.client.interceptors.response.use(
      (response: AxiosResponse) => {
        // Logs detalhados de respostas do Meta removidos para evitar poluição de console.
        return response
      },
      async (error) => {
        // Requisição cancelada durante logout — ignorar silenciosamente
        if (error?.cancelled === true) {
          return Promise.reject(error)
        }
        // Requisição abortada via AbortSignal (ex.: queryClient.cancelQueries() no
        // logout aborta queries de analytics em-voo). Não é erro de verdade: não
        // logar, não mandar pro Sentry, não disparar toasts — só propagar pro
        // TanStack Query tratar como cancelamento.
        if (axios.isCancel(error)) {
          return Promise.reject(error)
        }
        if (error?.response?.status === 401) {
          invalidateSessionCache()
          // Se estamos em processo de logout, silenciar o 401 — não propagar toasts/retries
          if (loggingOut) {
            return Promise.reject(error)
          }
          if (isAppAuthUnauthorized(error)) {
            // Um único 401 transitório (corrida no boundary do token durante um poll
            // longo de refresh de packs) NÃO deve deslogar globalmente. Tenta UM
            // refresh + re-dispara a request original; só desloga se o refresh também
            // falhar (refresh token de fato expirado/revogado). O _authRetry impede
            // loop infinito, e refreshAccessToken deduplica refreshes concorrentes.
            const originalConfig = error.config as
              | (AxiosRequestConfig & { _authRetry?: boolean })
              | undefined
            if (originalConfig && !originalConfig._authRetry) {
              originalConfig._authRetry = true
              const newToken = await refreshAccessToken()
              if (newToken) {
                originalConfig.headers = {
                  ...(originalConfig.headers as any),
                  Authorization: `Bearer ${newToken}`,
                }
                return this.client.request(originalConfig)
              }
            }
            // Refresh falhou (ou já re-tentamos uma vez) → sessão de fato encerrada.
            notifyAuthSessionExpired({ source: error?.config?.url })
          }
        }
        const appError = parseError(error)

        // Enviar erros relevantes para o Sentry (ignorar 401/403 que são esperados)
        if (appError.status && appError.status >= 500) {
          Sentry.captureException(error, {
            extra: {
              url: error?.config?.url,
              method: error?.config?.method,
              status: appError.status,
              responseData: error?.response?.data,
            },
          })
        }

        // Log detalhado apenas em desenvolvimento (sem usar console.error para evitar overlay do Next)
        if (env.NODE_ENV !== 'production') {
          try {
            const fullUrl = error?.config?.baseURL
              ? `${error.config.baseURL || ''}${error.config.url || ''}`
              : error?.config?.url
            
            // Detectar tipo específico de erro
            let errorType = 'unknown'
            let detailedMessage = appError.message
            
            if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
              errorType = 'connection'
              detailedMessage = `Falha de conexão com o servidor: ${error.message}`
            } else if (error.code === 'ECONNABORTED') {
              errorType = 'timeout'
              detailedMessage = `Timeout na requisição: ${error.message}`
            } else if (error.response?.status) {
              errorType = 'http'
              detailedMessage = `Erro HTTP ${error.response.status}: ${appError.message}`
            }
            
            const info = {
              url: fullUrl,
              method: error?.config?.method,
              status: appError.status,
              message: detailedMessage,
              errorType,
              originalError: error.message,
              responseData: error.response?.data,
            }
            
            console.warn('=== API ERROR DEBUG ===')
            console.warn('Error Info:', info)
            console.warn('Full Error:', error)
            console.warn('=== END ERROR DEBUG ===')
          } catch {
            // noop
          }
        }

        return Promise.reject(appError)
      }
    )
  }

  // Métodos HTTP
  async get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.get<T>(url, config)
    return response.data
  }

  // Método para requisições GET que podem demorar mais (ex: polling de jobs)
  async getWithTimeout<T>(url: string, timeoutMs: number, config?: AxiosRequestConfig): Promise<T> {
    const longTimeoutConfig = {
      ...config,
      timeout: timeoutMs,
    }
    const response = await this.client.get<T>(url, longTimeoutConfig)
    return response.data
  }

  async post<T>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.post<T>(url, data, config)
    return response.data
  }

  async postMultipart<T>(url: string, formData: FormData, config?: AxiosRequestConfig): Promise<T> {
    // The Axios instance default Content-Type is 'application/json'. In Axios 1.x,
    // the default transformRequest converts FormData to JSON when Content-Type is
    // 'application/json', which destroys file uploads. We bypass this by:
    // 1) Providing a custom transformRequest that returns FormData as-is
    // 2) Explicitly stripping Content-Type from the headers so the browser XHR
    //    sets 'multipart/form-data; boundary=...' automatically
    const response = await this.client.post<T>(url, formData, {
      ...config,
      timeout: 600000,
      headers: {
        ...(config?.headers || {}),
      },
      transformRequest: [(data, headers) => {
        if (headers && typeof headers === 'object') {
          const h = headers as { delete?: (name: string) => void } & Record<string, unknown>
          if (typeof h.delete === 'function') {
            h.delete('Content-Type')
          } else {
            delete h['Content-Type']
            delete h['content-type']
          }
        }
        return data
      }],
    })
    return response.data
  }

  // Método específico para requisições de ads que podem demorar mais
  async postAds<T>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
    const adsConfig = {
      ...config,
      timeout: 300000, // 5 minutos para requisições de ads
    }
    const response = await this.client.post<T>(url, data, adsConfig)
    return response.data
  }

  async put<T>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.put<T>(url, data, config)
    return response.data
  }

  async patch<T>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.patch<T>(url, data, config)
    return response.data
  }

  async delete<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.delete<T>(url, config)
    return response.data
  }
  
  // Método para DELETE com body
  async deleteWithBody<T>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.delete<T>(url, { ...config, data })
    return response.data
  }

  // Método para atualizar o token de autenticação
  setAuthToken(token: string | null) {
    if (token) {
      this.client.defaults.headers.Authorization = `Bearer ${token}`
    } else {
      delete this.client.defaults.headers.Authorization
    }
  }

  // Método legado (sem efeito) - mantido para compatibilidade temporária
  setSupabaseUserId(_userId: string | null) {}
}

// Instância singleton
export const apiClient = new ApiClient()

// Função para configurar token globalmente
export const setAuthToken = (token: string | null) => {
  apiClient.setAuthToken(token)
}

export const setSupabaseUserId = (userId: string | null) => {
  apiClient.setSupabaseUserId(userId)
}
