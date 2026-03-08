import { useQueryClient } from '@tanstack/react-query'
import { useSessionStore } from '../store/session'
import { useActiveJobsStore } from '../store/activeJobs'
import { setAuthToken, setLoggingOut } from '@/lib/api/client'
import { showSuccess, showError } from '@/lib/utils/toast'
import { queryKeys } from '@/lib/api/hooks'
import { useSupabaseAuth } from './useSupabaseAuth'
import { api } from '@/lib/api/endpoints'
import { logger } from '@/lib/utils/logger'

export const useAuthManager = () => {
  const queryClient = useQueryClient()
  const { setUser, logout } = useSessionStore()
  const { signOut } = useSupabaseAuth()
  const { activeJobIds, clearAll: clearAllActiveJobs } = useActiveJobsStore()

  const handleLoginSuccess = (_accessToken: string, userInfo?: any) => {
    try {
      // Atualizar dados do usuário se fornecidos (opcional)
      if (userInfo) {
        setUser(userInfo)
      }
      
      // Invalidar queries para recarregar dados
      queryClient.invalidateQueries({ queryKey: queryKeys.me })
      
      // Mostrar sucesso
      showSuccess('Autenticação realizada com sucesso!')
      
      return true
    } catch (error) {
      showError(error as any)
      return false
    }
  }

  const handleLogout = async () => {
    // Sinalizar imediatamente que logout está em andamento.
    // O interceptor do Axios vai rejeitar qualquer nova requisição e silenciar 401s em-voo.
    setLoggingOut(true)

    try {
      // 1. Cancelar queries no React Query (soft-cancel — não aborta HTTP em-voo, mas
      //    impede que novos fetches sejam disparados pelo React Query)
      queryClient.cancelQueries()

      // 2. Cancelar jobs ativos no backend ANTES de limpar o token
      const jobIdsArray = Array.from(activeJobIds)
      if (jobIdsArray.length > 0) {
        try {
          await api.facebook.cancelJobsBatch(jobIdsArray, 'Cancelado durante logout')
          logger.debug(`[LOGOUT] ${jobIdsArray.length} job(s) cancelado(s)`)
        } catch (error) {
          logger.error('[LOGOUT] Erro ao cancelar jobs (continuando logout):', error)
        }
      }

      // 3. Limpar estado local
      setAuthToken(null) // cosmético — o interceptor já bloqueia novas requisições
      logout()
      clearAllActiveJobs()
      queryClient.clear()

      // 4. Encerrar sessão Supabase (limpa cookies)
      try {
        await signOut()
      } catch (signOutError) {
        logger.error('[LOGOUT] Erro ao fazer signOut do Supabase (continuando logout):', signOutError)
      }
    } catch (error) {
      logger.error('[LOGOUT] Erro inesperado durante logout:', error)
      showError(error as any)
    } finally {
      // Redirect garantido: executa mesmo que qualquer etapa acima falhe.
      // O flag loggingOut não precisa ser resetado pois o reload da página reinicia o módulo.
      window.location.href = '/login?logout=true'
    }
  }

  return {
    handleLoginSuccess,
    handleLogout,
  }
}
