import { useEffect, useState } from 'react'
import { useSessionStore } from '../store/session'
import { useSettingsStore } from '../store/settings'
import { useSupabaseAuth } from './useSupabaseAuth'

/**
 * Hook que só funciona no cliente para evitar problemas de hidratação
 */
export const useClientSession = () => {
  const [isClient, setIsClient] = useState(false)
  const store = useSessionStore()

  useEffect(() => {
    setIsClient(true)
    
    // TEMPORÁRIO: Limpar packs antigos que podem ter formato incompatível
    // TODO: Remover este código após confirmar que todos os usuários migraram
    if (typeof window !== 'undefined') {
      const packs = localStorage.getItem('hookify_packs')
      if (packs) {
        try {
          const parsedPacks = JSON.parse(packs)
          // Se algum pack tem rawAds, limpar tudo para forçar recarregamento
          const hasOldFormat = parsedPacks.some((pack: any) => pack.rawAds !== undefined)
          if (hasOldFormat) {
            console.log('🧹 Limpando packs antigos com formato incompatível...')
            localStorage.removeItem('hookify_packs')
            localStorage.removeItem('hookify_adaccounts')
          }
        } catch (e) {
          // Se não conseguir fazer parse, limpar também
          localStorage.removeItem('hookify_packs')
          localStorage.removeItem('hookify_adaccounts')
        }
      }

      // Limpar caches expirados de ads periodicamente (a cada 10 minutos)
      const cleanupExpiredCache = async () => {
        try {
          const { clearExpiredCache } = await import('@/lib/storage/adsCache')
          await clearExpiredCache()
        } catch (error) {
          console.warn('Erro ao limpar caches expirados:', error)
        }
      }

      // Limpar imediatamente e depois periodicamente
      cleanupExpiredCache()
      const interval = setInterval(cleanupExpiredCache, 10 * 60 * 1000) // 10 minutos

      return () => clearInterval(interval)
    }
  }, [])

  return {
    ...store,
    isClient,
  }
}

/**
 * Hook de autenticação que só funciona no cliente
 * Agora usa Supabase Auth ao invés do token Facebook antigo
 */
export const useClientAuth = () => {
  const [isClient, setIsClient] = useState(false)
  const { user, session, isLoading } = useSupabaseAuth()
  
  useEffect(() => {
    setIsClient(true)
  }, [])
  
  return {
    isAuthenticated: isClient && !!user && !!session,
    user: isClient ? user : null,
    session: isClient ? session : null,
    isClient,
    isLoading,
  }
}

/**
 * Hook para packs que só funciona no cliente
 */
export const useClientPacks = () => {
  const { isClient, packs, addPack, removePack, updatePack } = useClientSession()
  
  return {
    packs: isClient ? packs : [],
    addPack,
    removePack,
    updatePack,
    isClient,
  }
}

/**
 * Hook para contas de anúncios que só funciona no cliente
 */
export const useClientAdAccounts = () => {
  const { isClient, adAccounts, setAdAccounts } = useClientSession()
  
  return {
    adAccounts: isClient ? adAccounts : [],
    setAdAccounts,
    isClient,
  }
}

/**
 * Hook para configurações que só funciona no cliente
 */
export const useClientSettings = () => {
  const [isClient, setIsClient] = useState(false)
  const store = useSettingsStore()
  
  useEffect(() => {
    setIsClient(true)
  }, [])
  
  return {
    ...store,
    isClient,
  }
}