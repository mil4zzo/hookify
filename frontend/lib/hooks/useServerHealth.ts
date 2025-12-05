import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, useRef } from 'react'
import { parseError, AppError } from '@/lib/utils/errors'
import { env } from '@/lib/config/env'
import { api } from '@/lib/api/endpoints'
import { useClientAuth, useClientPacks } from '@/lib/hooks/useClientSession'
import { useInvalidatePackAds } from '@/lib/api/hooks'
import { showSuccess } from '@/lib/utils/toast'
import { getAdStatistics } from '@/lib/utils/adCounting'

type ServerStatus = 'online' | 'offline' | 'checking'

interface UseServerHealthOptions {
  /** Intervalo em milissegundos para verificar o status (padrão: 30s) */
  checkInterval?: number
  /** Se deve verificar automaticamente (padrão: true) */
  enabled?: boolean
  /** Timeout para cada verificação em ms (padrão: 5s) */
  timeout?: number
}

interface UseServerHealthReturn {
  /** Status atual do servidor */
  status: ServerStatus
  /** Se está verificando no momento */
  isChecking: boolean
  /** Último erro ocorrido, se houver */
  error: AppError | null
  /** Última vez que o servidor foi detectado como online */
  lastOnlineAt: Date | null
  /** Se já foi feita pelo menos uma verificação (para evitar flicker no primeiro carregamento) */
  hasCheckedOnce: boolean
  /** Força uma nova verificação */
  refetch: () => void
}

/**
 * Hook para monitorar o status de saúde do servidor backend.
 * 
 * Faz verificações periódicas do endpoint /health e detecta quando
 * o servidor está offline (ECONNREFUSED, ENOTFOUND, timeout).
 * 
 * @example
 * ```tsx
 * const { status, isChecking } = useServerHealth({
 *   checkInterval: 30000, // 30 segundos
 *   enabled: true
 * });
 * 
 * if (status === 'offline') {
 *   return <ServerOfflineBanner />
 * }
 * ```
 */
export function useServerHealth(
  options: UseServerHealthOptions = {}
): UseServerHealthReturn {
  const {
    checkInterval = 30000, // 30 segundos
    enabled = true,
    timeout = 5000, // 5 segundos
  } = options

  const [lastOnlineAt, setLastOnlineAt] = useState<Date | null>(null)
  const [serverStatus, setServerStatus] = useState<ServerStatus>('checking')
  const previousStatusRef = useRef<ServerStatus>('checking')
  const hasCheckedOnceRef = useRef(false) // Rastrear se já fez pelo menos uma verificação
  const shouldCheckRef = useRef(true) // Controlar se deve verificar (false quando online)
  const queryClient = useQueryClient()
  const { isAuthenticated, isClient } = useClientAuth()
  const { packs, addPack, updatePack } = useClientPacks()
  const { invalidateAllPacksAds, invalidateAdPerformance } = useInvalidatePackAds()

  // Query para verificar saúde do servidor
  // Desabilitar polling automático (provisório) - verifica apenas uma vez no mount
  const {
    data,
    error,
    isFetching,
    refetch: refetchQuery,
  } = useQuery({
    queryKey: ['server-health'],
    queryFn: async () => {
      // Usar timeout customizado para health check (mais rápido que o padrão)
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeout)

      try {
        // Fazer requisição com timeout customizado usando fetch diretamente
        // para ter controle total sobre o timeout
        const response = await fetch(`${env.API_BASE_URL}/health`, {
          method: 'GET',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
          },
        })

        clearTimeout(timeoutId)

        if (!response.ok) {
          throw new Error(`Health check failed: ${response.status}`)
        }

        return await response.json()
      } catch (err: any) {
        clearTimeout(timeoutId)
        
        // Se foi abortado por timeout, criar erro específico
        if (err.name === 'AbortError') {
          const timeoutError: any = new Error('Timeout na verificação de saúde do servidor')
          timeoutError.code = 'ETIMEDOUT'
          throw timeoutError
        }
        
        throw err
      }
    },
    enabled: enabled && shouldCheckRef.current, // Só verifica se shouldCheckRef permitir
    // refetchInterval: checkInterval, // DESABILITADO PROVISORIAMENTE - não fazer polling automático
    retry: false, // Não retry automático - queremos detectar offline rapidamente
    staleTime: Infinity, // Considerar sempre fresh quando online (não verificar novamente)
    gcTime: 0, // Não manter em cache
  })

  // Resetar shouldCheckRef quando o componente montar (nova página)
  useEffect(() => {
    shouldCheckRef.current = true
    // Forçar uma nova verificação ao montar (se habilitado)
    if (enabled) {
      // Pequeno delay para garantir que a query está pronta
      setTimeout(() => {
        refetchQuery()
      }, 100)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Apenas no mount

  // Função para refetch manual (usada pelo botão "Tentar novamente")
  const refetch = () => {
    shouldCheckRef.current = true // Permitir verificação manual
    refetchQuery()
  }

  // Função para recarregar todos os dados quando o servidor voltar
  const refreshAllData = async () => {
    if (!isClient || !isAuthenticated) return

    try {
      // 1. Invalidar todas as queries do React Query
      queryClient.invalidateQueries({ queryKey: ['facebook'] })
      queryClient.invalidateQueries({ queryKey: ['analytics'] })
      queryClient.invalidateQueries({ queryKey: ['server-health'] })
      
      // 2. Invalidar cache de packs e dados agregados (ad performance)
      await invalidateAllPacksAds()
      invalidateAdPerformance()

      // 3. Recarregar packs do backend (similar ao useLoadPacks)
      const response = await api.analytics.listPacks(false)
      if (response.success && response.packs) {
        const supabasePacks = await Promise.all(
          response.packs.map(async (pack: any) => {
            let stats = pack.stats

            // Verificar se stats é válido
            const hasValidStats = 
              stats && 
              typeof stats === 'object' && 
              Object.keys(stats).length > 0 &&
              stats.totalSpend !== null &&
              stats.totalSpend !== undefined

            // Se não tem stats válidos, tentar calcular do cache
            if (!hasValidStats) {
              try {
                const { getCachedPackAds } = await import('@/lib/storage/adsCache')
                const cached = await getCachedPackAds(pack.id)
                if (cached.success && cached.data && cached.data.length > 0) {
                  const calculated = getAdStatistics(cached.data)
                  stats = {
                    totalAds: cached.data.length,
                    uniqueAds: calculated.uniqueAds,
                    uniqueCampaigns: calculated.uniqueCampaigns,
                    uniqueAdsets: calculated.uniqueAdsets,
                    totalSpend: calculated.totalSpend,
                  }
                }
              } catch (e) {
                // silencioso: sem cache disponível
              }
            }

            return {
              id: pack.id,
              name: pack.name,
              adaccount_id: pack.adaccount_id,
              date_start: pack.date_start,
              date_stop: pack.date_stop,
              level: pack.level || 'ad',
              filters: pack.filters || [],
              ads: [],
              auto_refresh: pack.auto_refresh || false,
              stats: stats || undefined,
              created_at: pack.created_at,
              updated_at: pack.updated_at,
            }
          })
        )

        // Atualizar packs no store
        supabasePacks.forEach((pack: any) => {
          const existing = packs.find((p) => p.id === pack.id)
          if (!existing) {
            addPack(pack)
          } else {
            // Atualizar pack com novos dados
            updatePack(pack.id, {
              stats: pack.stats,
              updated_at: pack.updated_at,
              auto_refresh: pack.auto_refresh,
            })
          }
        })
      }

      // 4. Mostrar toast de sucesso
      showSuccess('Servidor reconectado! Dados atualizados.')
    } catch (error) {
      console.error('Erro ao recarregar dados após reconexão:', error)
      // Não mostrar erro ao usuário - apenas logar
    }
  }

  // Atualizar status baseado no resultado da query
  useEffect(() => {
    if (isFetching) {
      setServerStatus('checking')
      return
    }

    if (error) {
      // Detectar erros de conexão (tanto do axios quanto do fetch)
      const errorMessage = error?.message?.toLowerCase() || ''
      const errorCode = (error as any)?.code || ''
      
      const isConnectionError =
        errorCode === 'ECONNREFUSED' ||
        errorCode === 'ENOTFOUND' ||
        errorCode === 'NETWORK' ||
        errorCode === 'ETIMEDOUT' ||
        errorCode === 'ECONNABORTED' ||
        errorMessage.includes('failed to fetch') ||
        errorMessage.includes('network error') ||
        errorMessage.includes('connection') ||
        (error as any)?.name === 'AbortError' ||
        (error as any)?.name === 'TypeError'

      if (isConnectionError) {
        setServerStatus('offline')
      } else {
        // Outros erros (ex: 500) - considerar offline também para health check
        setServerStatus('offline')
      }
    } else if (data) {
      setServerStatus('online')
      setLastOnlineAt(new Date())
      hasCheckedOnceRef.current = true // Marcar que já verificou pelo menos uma vez
      shouldCheckRef.current = false // Se online, não verificar novamente até trocar de página
    }
  }, [data, error, isFetching])

  // Marcar que já verificou quando detecta erro (também conta como verificação)
  useEffect(() => {
    if (error && !hasCheckedOnceRef.current) {
      hasCheckedOnceRef.current = true
    }
    // Se offline, permitir verificações manuais (não desabilitar shouldCheckRef)
    if (error && serverStatus === 'offline') {
      shouldCheckRef.current = true // Permitir verificação manual quando offline
    }
  }, [error, serverStatus])

  // Detectar quando o servidor volta de offline para online e recarregar dados
  useEffect(() => {
    const previousStatus = previousStatusRef.current
    const currentStatus = serverStatus

    // Se mudou de offline para online, recarregar dados
    if (previousStatus === 'offline' && currentStatus === 'online') {
      refreshAllData()
      shouldCheckRef.current = false // Parar verificações quando voltar online
    }

    // Atualizar referência
    previousStatusRef.current = currentStatus
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverStatus, isClient, isAuthenticated])

  return {
    status: serverStatus,
    isChecking: isFetching,
    error: error ? parseError(error) : null,
    lastOnlineAt,
    hasCheckedOnce: hasCheckedOnceRef.current,
    refetch, // Função para verificação manual
  }
}

