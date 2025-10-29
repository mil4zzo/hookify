import { useEffect, useState } from 'react'
import { useSessionStore } from '../store/session'

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
    }
  }, [])

  return {
    ...store,
    isClient,
  }
}

/**
 * Hook de autenticação que só funciona no cliente
 */
export const useClientAuth = () => {
  const { isClient, accessToken, user, setAccessToken, setUser, logout } = useClientSession()
  
  return {
    isAuthenticated: isClient && !!accessToken && !!user,
    accessToken: isClient ? accessToken : null,
    user: isClient ? user : null,
    setAccessToken,
    setUser,
    logout,
    isClient,
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
