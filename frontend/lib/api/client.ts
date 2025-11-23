import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios'
import { parseError, AppError } from '@/lib/utils/errors'
import { env } from '@/lib/config/env'
import { getSupabaseClient } from '@/lib/supabase/client'

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
    // Request interceptor - adiciona JWT do Supabase
    this.client.interceptors.request.use(
      async (config) => {
        if (typeof window !== 'undefined') {
          try {
            const supabase = getSupabaseClient()
            const { data, error } = await supabase.auth.getSession()
            
            if (error) {
              // Se houver erro ao buscar sessão, não adiciona header mas também não bloqueia a requisição
              // A API pode ter endpoints públicos que não precisam de autenticação
              if (env.NODE_ENV !== 'production') {
                console.warn('[API Client] Erro ao buscar sessão:', error.message)
              }
              // Remove header se existir
              if (config.headers && 'Authorization' in config.headers) {
                delete (config.headers as any).Authorization
              }
              return config
            }
            
            const accessToken = data.session?.access_token
            // Verificar se há token E se a sessão ainda é válida (não expirada)
            const isSessionValid = accessToken && data.session && 
              (!data.session.expires_at || data.session.expires_at * 1000 > Date.now())
            
            if (isSessionValid && accessToken) {
              config.headers.Authorization = `Bearer ${accessToken}`
              if (env.NODE_ENV !== 'production') {
                console.debug(`[API Client] Token adicionado ao header para: ${config.url}`)
              }
            } else {
              // Remove header se não houver token válido
              if (config.headers && 'Authorization' in config.headers) {
                delete (config.headers as any).Authorization
              }
              // Log apenas em desenvolvimento para ajudar no debug
              if (env.NODE_ENV !== 'production' && config.url) {
                if (!accessToken) {
                  console.warn(`[API Client] Requisição sem token para: ${config.url}`)
                } else if (!isSessionValid) {
                  console.warn(`[API Client] Sessão expirada, removendo token para: ${config.url}`)
                }
              }
            }
          } catch (err) {
            // Erro inesperado ao buscar sessão - remove header se existir
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
        // DEBUG: Log detalhado das respostas do Meta
        if (env.NODE_ENV !== 'production' && response.config.url?.includes('/facebook/')) {
          console.log('=== FRONTEND DEBUG - Meta API Response ===')
          console.log('URL:', response.config.url)
          console.log('Method:', response.config.method)
          console.log('Status:', response.status)
          console.log('Headers:', response.headers)
          console.log('Data:', JSON.stringify(response.data, null, 2))
          console.log('=== END DEBUG ===')
        }
        return response
      },
      (error) => {
        const appError = parseError(error)
        
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
