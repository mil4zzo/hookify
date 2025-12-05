"use client"

import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { facebookConnectorApi } from '@/lib/api/facebookConnector'
import { showSuccess } from '@/lib/utils/toast'
import { useClientAuth } from '@/lib/hooks/useClientSession'
import { openAuthPopup, AuthPopupError } from '@/lib/utils/authPopup'
import { queryKeys } from '@/lib/api/hooks'
import { api } from '@/lib/api/endpoints'

const qk = {
  connections: ['facebook', 'connections'] as const,
}

export function useFacebookConnections() {
  const qc = useQueryClient()
  const { isAuthenticated } = useClientAuth()

  // Cancelar queries ativas quando o usuário deslogar
  useEffect(() => {
    if (!isAuthenticated) {
      // Cancelar todas as queries relacionadas quando não autenticado
      qc.cancelQueries({ queryKey: qk.connections })
    }
  }, [isAuthenticated, qc])

  const connections = useQuery({
    queryKey: qk.connections,
    queryFn: facebookConnectorApi.listConnections,
    staleTime: 60_000,
    enabled: isAuthenticated, // Só executa quando o usuário estiver autenticado
    retry: false, // Não tenta novamente em caso de erro 401
    refetchOnWindowFocus: isAuthenticated, // Só refaz quando focado na janela se autenticado
    refetchOnMount: isAuthenticated, // Só refaz ao montar se autenticado
    refetchOnReconnect: isAuthenticated, // Só refaz ao reconectar se autenticado
  })

  const connect = useMutation({
    mutationFn: async () => {
      const redirectUri = window.location.origin + '/callback'
      const state = Math.random().toString(36).slice(2)
      const { auth_url } = await facebookConnectorApi.getAuthUrl(redirectUri, state)

      const messageData = await openAuthPopup<{
        type?: string
        code?: string
        error?: string
        errorDescription?: string
        error_description?: string
        state?: string
      }>({
        url: auth_url,
        windowName: 'facebook-connect',
        windowFeatures: 'width=600,height=700,scrollbars=yes',
        successType: 'FACEBOOK_AUTH_SUCCESS',
        errorType: 'FACEBOOK_AUTH_ERROR',
        expectedState: state,
        // timeout padrão de 5min é suficiente aqui
      })

      if (!messageData.code) {
        throw new Error('Código de autorização não recebido do Facebook.')
      }

      try {
        await facebookConnectorApi.callback(messageData.code, redirectUri)
        
        // Sincronizar contas de anúncios explicitamente após conectar
        // (o backend também tenta sincronizar, mas chamar aqui garante que funcione)
        try {
          await api.facebook.syncAdAccounts()
        } catch (syncError) {
          // Não falhar o fluxo se a sincronização falhar - o backend já tentou
          console.warn('Erro ao sincronizar ad accounts após conectar Facebook:', syncError)
        }
        
        // Invalidar e recarregar queries relacionados ao Facebook
        await qc.invalidateQueries({ queryKey: qk.connections })
        await qc.invalidateQueries({ queryKey: queryKeys.adAccounts })
        await qc.invalidateQueries({ queryKey: queryKeys.me })
        
        // Forçar refetch imediato para garantir que os dados sejam atualizados
        await Promise.all([
          qc.refetchQueries({ queryKey: qk.connections }),
          qc.refetchQueries({ queryKey: queryKeys.adAccounts }),
          qc.refetchQueries({ queryKey: queryKeys.me }),
        ])
        showSuccess('Facebook conectado com sucesso!')
        return true
      } catch (e: any) {
        const authError = e as AuthPopupError
        // Tratar cancelamento silenciosamente (se necessário o chamador pode exibir algo)
        if (authError?.code === 'AUTH_POPUP_CLOSED') {
          return false
        }
        throw e
      }
    },
  })

  const disconnect = useMutation({
    mutationFn: async (id: string) => {
      await facebookConnectorApi.deleteConnection(id)
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: qk.connections })
      await qc.invalidateQueries({ queryKey: queryKeys.adAccounts })
      await qc.invalidateQueries({ queryKey: queryKeys.me })
    },
  })

  const setPrimary = useMutation({
    mutationFn: async (id: string) => {
      await facebookConnectorApi.setPrimary(id)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.connections }),
  })

  return { connections, connect, disconnect, setPrimary }
}


