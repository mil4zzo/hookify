"use client"

import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { facebookConnectorApi } from '@/lib/api/facebookConnector'
import { showSuccess } from '@/lib/utils/toast'
import { useClientAuth } from '@/lib/hooks/useClientSession'

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
      const popup = window.open(auth_url, 'facebook-connect', 'width=600,height=700,scrollbars=yes')
      return new Promise((resolve, reject) => {
        let resolved = false
        const listener = async (event: MessageEvent) => {
          // Verificar origem e tipo antes de processar
          if (event.origin !== window.location.origin) return
          
          // Prevenir processamento duplicado
          if (resolved) return
          
          if (event.data?.type === 'FACEBOOK_AUTH_SUCCESS') {
            resolved = true
            try {
              await facebookConnectorApi.callback(event.data.code, redirectUri)
              await qc.invalidateQueries({ queryKey: qk.connections })
              showSuccess('Facebook conectado com sucesso!')
              resolve(true)
            } catch (e) {
              reject(e)
            } finally {
              window.removeEventListener('message', listener)
              popup?.close()
            }
          }
          if (event.data?.type === 'FACEBOOK_AUTH_ERROR') {
            resolved = true
            window.removeEventListener('message', listener)
            popup?.close()
            reject(new Error(event.data?.error_description || 'Falha na conexão com o Facebook'))
          }
        }
        window.addEventListener('message', listener)
        
        // Cleanup se popup for fechado manualmente
        const checkClosed = setInterval(() => {
          if (popup?.closed) {
            clearInterval(checkClosed)
            if (!resolved) {
              resolved = true
              window.removeEventListener('message', listener)
              reject(new Error('Popup fechado pelo usuário'))
            }
          }
        }, 500)
      })
    },
  })

  const disconnect = useMutation({
    mutationFn: async (id: string) => {
      await facebookConnectorApi.deleteConnection(id)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.connections }),
  })

  const setPrimary = useMutation({
    mutationFn: async (id: string) => {
      await facebookConnectorApi.setPrimary(id)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.connections }),
  })

  return { connections, connect, disconnect, setPrimary }
}


